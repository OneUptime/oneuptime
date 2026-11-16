/*
 * THE FIRST TIME SOMETHING MEASURES A MONITOR, THROUGH monitorResource
 * (issue #8899), AND THE INCOMING REQUEST ARRIVAL KEPT FOR ITS PAGE (#8123).
 *
 * Monitor.firstMeasuredAt is empty until a probe result, an incoming
 * request, an email, a server report or an evaluation is accepted for the
 * monitor, and the lists and status pages say it is waiting for its first
 * check until then. These drive monitorResource, the one place every result
 * is accepted, with the evaluator, the lock, the monitor read and the
 * timeline stubbed at their edges and Redis a map:
 *
 *   - a result that measured the monitor stamps it, once, with a write that
 *     never queues behind another writer of the row;
 *   - a heartbeat sweep's look at what has not arrived stamps nothing, and
 *     neither does a result that is refused;
 *   - a monitor already stamped is not written again;
 *   - a stamp that fails does not fail the result;
 *   - an incoming request's arrival is kept by its monitor on every request,
 *     for the monitor's page - never for the sweep's own look.
 */

jest.mock("isolated-vm", () => {
  return {};
});

jest.mock("../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator", () => {
  return {
    __esModule: true,
    default: {
      processMonitorStep: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
      updateColumnsByIdIfUnlockedWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorStatusTimelineService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      create: jest.fn(),
    },
    MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE:
      "Monitor status is same as previous status.",
    MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE:
      "Could not acquire the monitor status timeline lock.",
  };
});

jest.mock("../../../../Server/Services/MonitorStatusService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorMetricUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorMetrics: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorLogUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorLog: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../../Server/Utils/Logger";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorDependencySuppression from "../../../../Server/Utils/Monitor/MonitorDependencySuppression";
import MonitorFirstMeasured from "../../../../Server/Utils/Monitor/MonitorFirstMeasured";
import MonitorHeartbeatState from "../../../../Server/Utils/Monitor/MonitorHeartbeatState";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorMaintenanceSuppression from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorProbeLastResults from "../../../../Server/Utils/Monitor/MonitorProbeLastResults";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import OneUptimeDate from "../../../../Types/Date";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import IncomingEmailMonitorRequest from "../../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ServerMonitorResponse from "../../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import LogMonitorResponse from "../../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const ONLINE: ObjectID = new ObjectID("abababab-0000-4000-8000-000000000011");
const MUTEX: { key: string } = { key: "the monitor's lock" };
const PROBE_ID: ObjectID = new ObjectID("abababab-0000-4000-8000-0000000000aa");

const processMonitorStep: jest.Mock =
  MonitorCriteriaEvaluator.processMonitorStep as unknown as jest.Mock;
const findOneById: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const updateColumns: jest.Mock =
  MonitorService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;
const stampWrite: jest.Mock =
  MonitorService.updateColumnsByIdIfUnlockedWithoutHooks as unknown as jest.Mock;
const lastTimelineRow: jest.Mock =
  MonitorStatusTimelineService.findOneBy as unknown as jest.Mock;
const createTimelineRow: jest.Mock =
  MonitorStatusTimelineService.create as unknown as jest.Mock;
const statusName: jest.Mock =
  MonitorStatusService.findOneBy as unknown as jest.Mock;
const lock: jest.Mock = Semaphore.lock as unknown as jest.Mock;

let redis: Map<string, string>;

function criteria(filters: Array<CriteriaFilter>): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.name = "Online";
  instance.data!.changeMonitorStatus = true;
  instance.data!.monitorStatusId = ONLINE;
  instance.data!.createIncidents = false;
  instance.data!.createAlerts = false;
  instance.data!.incidents = [];
  instance.data!.alerts = [];
  instance.data!.filters = filters;
  return instance;
}

function stepsWith(instances: Array<MonitorCriteriaInstance>): MonitorSteps {
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = { monitorCriteriaInstanceArray: instances };

  const step: MonitorStep = new MonitorStep();
  step.data!.monitorCriteria = monitorCriteria;

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };
  return steps;
}

function makeMonitor(
  monitorType: MonitorType,
  values: Partial<Monitor> = {},
): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = new ObjectID("cdcdcdcd-0000-4000-8000-000000000011");
  monitor._id = monitor.id.toString();
  monitor.projectId = new ObjectID("efefefef-0000-4000-8000-000000000011");
  monitor.monitorType = monitorType;
  monitor.name = "New monitor";
  monitor.monitorSteps = stepsWith([
    criteria([
      {
        checkOn:
          monitorType === MonitorType.IncomingEmail
            ? CheckOn.EmailReceivedAt
            : CheckOn.IncomingRequest,
        filterType: FilterType.RecievedInMinutes,
        value: 5,
      } as CriteriaFilter,
    ]),
  ]);
  monitor.currentMonitorStatusId = ONLINE;
  // Nothing has measured it yet, as the read hands the empty column over.
  (monitor as unknown as Record<string, unknown>)["firstMeasuredAt"] = null;
  Object.assign(monitor, values);
  return monitor;
}

function serverReport(
  monitor: Monitor,
  values: Partial<ServerMonitorResponse> = {},
): ServerMonitorResponse {
  return {
    projectId: monitor.projectId!,
    monitorId: monitor.id!,
    hostname: "db-1",
    requestReceivedAt: OneUptimeDate.getCurrentDate(),
    onlyCheckRequestReceivedAt: false,
    timeNow: OneUptimeDate.getCurrentDate(),
    ...values,
  };
}

function incomingRequest(
  monitor: Monitor,
  values: Partial<IncomingMonitorRequest> = {},
): IncomingMonitorRequest {
  const now: Date = OneUptimeDate.getCurrentDate();

  return {
    projectId: monitor.projectId!,
    monitorId: monitor.id!,
    requestHeaders: { "user-agent": "curl/8.12.1" },
    requestBody: { status: "ok" },
    requestMethod: HTTPMethod.POST,
    incomingRequestReceivedAt: now,
    onlyCheckForIncomingRequestReceivedAt: false,
    checkedAt: now,
    ...values,
  };
}

function incomingEmail(
  monitor: Monitor,
  values: Partial<IncomingEmailMonitorRequest> = {},
): IncomingEmailMonitorRequest {
  const now: Date = OneUptimeDate.getCurrentDate();

  return {
    projectId: monitor.projectId!,
    monitorId: monitor.id!,
    emailFrom: "alerts@example.com",
    emailTo: "monitor@inbound.example.com",
    emailSubject: "Nightly backup finished",
    emailBody: "OK",
    emailReceivedAt: now,
    checkedAt: now,
    onlyCheckForIncomingEmailReceivedAt: false,
    ...values,
  } as IncomingEmailMonitorRequest;
}

function stamps(): Array<{
  id: ObjectID;
  data: Record<string, unknown>;
  expectedData: Record<string, unknown>;
  skipUpdateDateColumn: boolean;
}> {
  return stampWrite.mock.calls.map((call: Array<unknown>) => {
    return call[0] as {
      id: ObjectID;
      data: Record<string, unknown>;
      expectedData: Record<string, unknown>;
      skipUpdateDateColumn: boolean;
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  redis = new Map<string, string>();

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return redis.get(`${namespace}-${key}`) ?? null;
    });

  jest
    .spyOn(GlobalCache, "getStrings")
    .mockImplementation(async (namespace: string, keys: Array<string>) => {
      return keys.map((key: string): string | null => {
        return redis.get(`${namespace}-${key}`) ?? null;
      });
    });

  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        redis.set(`${namespace}-${key}`, value);
      },
    );

  jest
    .spyOn(GlobalCache, "setNumberIfGreater")
    .mockImplementation(
      async (namespace: string, key: string, value: number) => {
        const name: string = `${namespace}-${key}`;
        const stored: number | undefined = redis.has(name)
          ? Number(redis.get(name))
          : undefined;

        if (stored === undefined || value > stored) {
          redis.set(name, String(value));
          return value;
        }

        return stored;
      },
    );

  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);

  lock.mockResolvedValue(MUTEX as never);
  updateColumns.mockResolvedValue(undefined as never);
  stampWrite.mockResolvedValue(true as never);
  statusName.mockResolvedValue({ name: "Operational" } as never);
  lastTimelineRow.mockResolvedValue(null as never);
  createTimelineRow.mockImplementation(((args: { data: unknown }) => {
    return Promise.resolve(args.data);
  }) as any);

  processMonitorStep.mockImplementation(((input: {
    probeApiIngestResponse: ProbeApiIngestResponse;
    monitorStep: MonitorStep;
  }) => {
    const met: MonitorCriteriaInstance | undefined =
      input.monitorStep.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray[0];

    return Promise.resolve({
      ...input.probeApiIngestResponse,
      criteriaMetId: met?.data?.id,
      rootCause: "Online.",
    });
  }) as any);

  jest
    .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
    .mockResolvedValue(true as never);
  jest
    .spyOn(MonitorIncident, "checkOpenIncidentsAndCloseIfResolved")
    .mockResolvedValue([] as never);
  jest
    .spyOn(MonitorAlert, "checkOpenAlertsAndCloseIfResolved")
    .mockResolvedValue([] as never);
  jest
    .spyOn(MonitorIncident, "criteriaMetCreateIncidentsAndUpdateMonitorStatus")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorAlert, "criteriaMetCreateAlertsAndUpdateMonitorStatus")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorMaintenanceSuppression, "getMaintenanceSuppression")
    .mockResolvedValue({
      suppressedSeriesFingerprints: new Set<string>(),
      suppressingDatabaseServerIds: [],
    } as never);
  jest
    .spyOn(MonitorDependencySuppression, "getDependencySuppression")
    .mockResolvedValue({ isSuppressed: false } as never);
  jest.spyOn(MonitorSummaryCapture, "capture").mockResolvedValue(null as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what measures a monitor stamps it, once", () => {
  test("the monitor is read with whether anything has measured it", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.Server);
    findOneById.mockResolvedValue(monitor as never);

    await MonitorResourceUtil.monitorResource(serverReport(monitor));

    const select: Record<string, unknown> = (
      findOneById.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["firstMeasuredAt"]).toBe(true);
  });

  test("a server agent's report", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.Server);
    findOneById.mockResolvedValue(monitor as never);

    const before: number = Date.now();
    await MonitorResourceUtil.monitorResource(serverReport(monitor));

    expect(stamps()).toHaveLength(1);
    expect(stamps()[0]!.id.toString()).toBe(monitor.id!.toString());
    expect(stamps()[0]!.expectedData).toEqual({ firstMeasuredAt: null });
    expect(stamps()[0]!.skipUpdateDateColumn).toBe(true);
    expect(
      (stamps()[0]!.data["firstMeasuredAt"] as Date).getTime(),
    ).toBeGreaterThanOrEqual(before);
  });

  test("an incoming request", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.IncomingRequest);
    findOneById.mockResolvedValue(monitor as never);

    await MonitorResourceUtil.monitorResource(incomingRequest(monitor));

    expect(stamps()).toHaveLength(1);
  });

  test("an email", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.IncomingEmail);
    findOneById.mockResolvedValue(monitor as never);

    await MonitorResourceUtil.monitorResource(incomingEmail(monitor));

    expect(stamps()).toHaveLength(1);
  });

  test("an evaluation of a monitor's telemetry", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.Logs);
    findOneById.mockResolvedValue(monitor as never);

    await MonitorResourceUtil.monitorResource({
      projectId: monitor.projectId!,
      monitorId: monitor.id!,
      logCount: 0,
    } as unknown as LogMonitorResponse);

    expect(stamps()).toHaveLength(1);
  });

  test("a probe's check result for one of the monitor's probes", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.Website);
    findOneById.mockResolvedValue(monitor as never);

    jest
      .spyOn(MonitorProbeLastResults, "storeResultAndReadProbes")
      .mockResolvedValue({
        probes: [
          {
            monitorProbeId: new ObjectID(
              "abababab-0000-4000-8000-0000000000bb",
            ),
            probeId: PROBE_ID,
            isEnabled: true,
            probeName: "London",
            probeConnectionStatus: undefined,
            resultForJudgedStep: undefined,
          },
        ],
        isResultStored: true,
      } as never);
    jest
      .spyOn(
        MonitorResourceUtil as unknown as {
          checkProbeAgreement: () => Promise<unknown>;
        },
        "checkProbeAgreement",
      )
      .mockResolvedValue({
        hasAgreement: true,
        agreementCount: 1,
        requiredCount: 1,
        totalActiveProbes: 1,
        agreedCriteriaId: null,
        agreedRootCause: null,
        agreedProbeNames: [],
      } as never);

    await MonitorResourceUtil.monitorResource({
      projectId: monitor.projectId!,
      monitorId: monitor.id!,
      probeId: PROBE_ID,
      monitorStepId:
        monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.id,
      isOnline: true,
      monitoredAt: OneUptimeDate.getCurrentDate(),
      responseTimeInMs: 120,
      responseCode: 200,
    } as unknown as ProbeMonitorResponse);

    expect(stamps()).toHaveLength(1);
  });

  test("a monitor already measured is not written again", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.Server, {
      firstMeasuredAt: new Date("2026-11-01T00:00:00.000Z"),
    });
    findOneById.mockResolvedValue(monitor as never);

    await MonitorResourceUtil.monitorResource(serverReport(monitor));
    await MonitorResourceUtil.monitorResource(incomingRequest(monitor));

    expect(stamps()).toHaveLength(0);
  });
});

describe("what does not measure a monitor stamps nothing", () => {
  test("the server sweep's look at the last report it holds", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.Server);
    findOneById.mockResolvedValue(monitor as never);

    await MonitorResourceUtil.monitorResource(
      serverReport(monitor, { onlyCheckRequestReceivedAt: true }),
    );

    expect(stamps()).toHaveLength(0);
  });

  test("the incoming request sweep's look at the last request it holds", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.IncomingRequest);
    findOneById.mockResolvedValue(monitor as never);

    await MonitorResourceUtil.monitorResource(
      incomingRequest(monitor, { onlyCheckForIncomingRequestReceivedAt: true }),
    );

    expect(stamps()).toHaveLength(0);
  });

  test("the email sweep's look at the last email it holds", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.IncomingEmail);
    findOneById.mockResolvedValue(monitor as never);

    await MonitorResourceUtil.monitorResource(
      incomingEmail(monitor, { onlyCheckForIncomingEmailReceivedAt: true }),
    );

    expect(stamps()).toHaveLength(0);
  });

  test.each([
    ["archived", { isArchived: true }],
    ["with its monitoring turned off", { disableActiveMonitoring: true }],
    [
      "paused by an incident",
      { disableActiveMonitoringBecauseOfManualIncident: true },
    ],
    [
      "paused by a maintenance event",
      { disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true },
    ],
  ] as Array<[string, Partial<Monitor>]>)(
    "a result refused for a monitor %s",
    async (_name: string, values: Partial<Monitor>) => {
      const monitor: Monitor = makeMonitor(MonitorType.Server, values);
      findOneById.mockResolvedValue(monitor as never);

      await expect(
        MonitorResourceUtil.monitorResource(serverReport(monitor)),
      ).rejects.toThrow();

      expect(stamps()).toHaveLength(0);
    },
  );

  test("a probe's result for a monitor it is not assigned to", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.Website);
    findOneById.mockResolvedValue(monitor as never);

    jest
      .spyOn(MonitorProbeLastResults, "storeResultAndReadProbes")
      .mockResolvedValue({ probes: [], isResultStored: false } as never);

    await expect(
      MonitorResourceUtil.monitorResource({
        projectId: monitor.projectId!,
        monitorId: monitor.id!,
        probeId: PROBE_ID,
        monitorStepId:
          monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.id,
        isOnline: true,
        monitoredAt: OneUptimeDate.getCurrentDate(),
      } as unknown as ProbeMonitorResponse),
    ).rejects.toThrow();

    expect(stamps()).toHaveLength(0);
  });

  test("a result for a monitor whose project is blocked", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.Server);
    findOneById.mockResolvedValue(monitor as never);
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(true);

    await MonitorResourceUtil.monitorResource(serverReport(monitor));

    expect(stamps()).toHaveLength(0);
  });
});

describe("a stamp never stands in the way of the result", () => {
  test("a write that fails is logged, and the result is judged all the same", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.Server);
    findOneById.mockResolvedValue(monitor as never);
    stampWrite.mockRejectedValue(new Error("Postgres is busy") as never);

    await expect(
      MonitorResourceUtil.monitorResource(serverReport(monitor)),
    ).resolves.toBeDefined();

    expect(processMonitorStep).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  test("a row another writer holds is skipped, and the next result stamps it", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.Server);
    findOneById.mockResolvedValue(monitor as never);
    stampWrite.mockResolvedValueOnce(false as never);

    await MonitorResourceUtil.monitorResource(serverReport(monitor));
    await MonitorResourceUtil.monitorResource(serverReport(monitor));

    expect(stamps()).toHaveLength(2);
    expect(processMonitorStep).toHaveBeenCalledTimes(2);
  });
});

describe("an incoming request's arrival, kept by its monitor for its page (#8123)", () => {
  test("every request that arrived is kept, the latest of all", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.IncomingRequest, {
      firstMeasuredAt: new Date("2026-11-01T00:00:00.000Z"),
    });
    findOneById.mockResolvedValue(monitor as never);

    const first: Date = new Date(Date.now() - 2000);
    const second: Date = new Date(Date.now() - 1000);

    await MonitorResourceUtil.monitorResource(
      incomingRequest(monitor, { incomingRequestReceivedAt: second }),
    );
    await MonitorResourceUtil.monitorResource(
      incomingRequest(monitor, { incomingRequestReceivedAt: first }),
    );

    const arrivals: Map<string, Date> =
      await MonitorHeartbeatState.getLatestArrivals({
        kind: "incoming-request",
        monitorIds: [monitor.id!],
      });

    expect(arrivals.get(monitor.id!.toString())?.getTime()).toBe(
      second.getTime(),
    );
  });

  test("the sweep's look at the last request keeps nothing", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.IncomingRequest);
    findOneById.mockResolvedValue(monitor as never);

    await MonitorResourceUtil.monitorResource(
      incomingRequest(monitor, {
        onlyCheckForIncomingRequestReceivedAt: true,
        incomingRequestReceivedAt: new Date(),
      }),
    );

    expect(
      (
        await MonitorHeartbeatState.getLatestArrivals({
          kind: "incoming-request",
          monitorIds: [monitor.id!],
        })
      ).size,
    ).toBe(0);
  });

  test("keepIncomingRequestArrival keeps nothing without an arrival", async () => {
    await MonitorResourceUtil.keepIncomingRequestArrival({
      monitorId: new ObjectID("cdcdcdcd-0000-4000-8000-000000000099"),
      dataToProcess: {
        onlyCheckForIncomingRequestReceivedAt: false,
      } as IncomingMonitorRequest,
    });

    expect(redis.size).toBe(0);
  });
});

describe("MonitorFirstMeasured on its own", () => {
  test("a measurement is anything but a heartbeat sweep's own look", () => {
    expect(
      MonitorFirstMeasured.isMeasurement({} as unknown as ProbeMonitorResponse),
    ).toBe(true);
    expect(
      MonitorFirstMeasured.isMeasurement({
        onlyCheckForIncomingRequestReceivedAt: true,
      } as IncomingMonitorRequest),
    ).toBe(false);
    expect(
      MonitorFirstMeasured.isMeasurement({
        onlyCheckForIncomingEmailReceivedAt: true,
      } as IncomingEmailMonitorRequest),
    ).toBe(false);
    expect(
      MonitorFirstMeasured.isMeasurement({
        onlyCheckRequestReceivedAt: true,
      } as ServerMonitorResponse),
    ).toBe(false);
    expect(
      MonitorFirstMeasured.isMeasurement({
        onlyCheckRequestReceivedAt: false,
      } as ServerMonitorResponse),
    ).toBe(true);
  });

  test("a manual monitor is stamped when it is created, waiting for its row, with its creation time", async () => {
    const createdAt: Date = new Date("2026-11-16T09:00:00.000Z");
    const monitorId: ObjectID = new ObjectID(
      "cdcdcdcd-0000-4000-8000-000000000021",
    );

    expect(
      await MonitorFirstMeasured.stampManualMonitorOnCreate({
        monitorId: monitorId,
        monitorType: MonitorType.Manual,
        createdAt: createdAt,
      }),
    ).toBe(true);

    expect(updateColumns).toHaveBeenCalledTimes(1);
    expect(updateColumns.mock.calls[0]![0]).toEqual({
      id: monitorId,
      data: { firstMeasuredAt: createdAt },
      expectedData: { firstMeasuredAt: null },
      skipUpdateDateColumn: true,
    });
    // Not the write that skips a locked row: nothing else would stamp it.
    expect(stampWrite).not.toHaveBeenCalled();
  });

  test("any other monitor waits for its first result", async () => {
    for (const monitorType of [
      MonitorType.Website,
      MonitorType.IncomingRequest,
      MonitorType.Server,
      MonitorType.Logs,
      undefined,
    ]) {
      expect(
        await MonitorFirstMeasured.stampManualMonitorOnCreate({
          monitorId: new ObjectID("cdcdcdcd-0000-4000-8000-000000000022"),
          monitorType: monitorType,
          createdAt: new Date(),
        }),
      ).toBe(false);
    }

    expect(updateColumns).not.toHaveBeenCalled();
  });

  test("a manual stamp that fails is logged, and the create goes on", async () => {
    updateColumns.mockRejectedValue(new Error("Postgres is busy") as never);

    await expect(
      MonitorFirstMeasured.stampManualMonitorOnCreate({
        monitorId: new ObjectID("cdcdcdcd-0000-4000-8000-000000000023"),
        monitorType: MonitorType.Manual,
        createdAt: undefined,
      }),
    ).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  test("a monitor read without an id is never written", async () => {
    expect(
      await MonitorFirstMeasured.stampIfFirst({
        monitor: { firstMeasuredAt: undefined } as unknown as Monitor,
        dataToProcess: {} as unknown as ProbeMonitorResponse,
      }),
    ).toBe(false);
    expect(stampWrite).not.toHaveBeenCalled();
  });
});
