/*
 * The heartbeat writes monitorResource makes, and what it keeps instead
 * (MonitorHeartbeatState).
 *
 * - A server agent's report (every 30 seconds) wrote the Monitor row every
 *   time. Now its arrival is kept in Redis on every report, the row is
 *   written at most every SERVER_REPORT_WRITE_EVERY_SECONDS, and a check of
 *   the monitor - the CheckOnlineStatus sweep - judges the latest arrival
 *   kept, so a report that was not written is never taken for silence.
 * - An incoming request wrote the row every time. Now it is written when
 *   it differs from the last one written in anything the heartbeat sweep
 *   judges again, and otherwise at most every half of the monitor's
 *   shortest window (at most two minutes).
 * - Every evaluation of an incoming request or email records what it
 *   judged, so a sweep that would judge the same again can skip it.
 *
 * The evaluator, the lock, the monitor read and the timeline are stubbed at
 * their edges; Redis is a map.
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
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorDependencySuppression from "../../../../Server/Utils/Monitor/MonitorDependencySuppression";
import MonitorHeartbeatState, {
  HeartbeatKind,
} from "../../../../Server/Utils/Monitor/MonitorHeartbeatState";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorMaintenanceSuppression from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import OneUptimeDate from "../../../../Types/Date";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
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
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const ONLINE: ObjectID = new ObjectID("abababab-0000-4000-8000-000000000001");
const OFFLINE: ObjectID = new ObjectID("abababab-0000-4000-8000-000000000002");
const MUTEX: { key: string } = { key: "the monitor's lock" };

const processMonitorStep: jest.Mock =
  MonitorCriteriaEvaluator.processMonitorStep as unknown as jest.Mock;
const findOneById: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const updateColumns: jest.Mock =
  MonitorService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;
const createTimelineRow: jest.Mock =
  MonitorStatusTimelineService.create as unknown as jest.Mock;
const lastTimelineRow: jest.Mock =
  MonitorStatusTimelineService.findOneBy as unknown as jest.Mock;
const statusName: jest.Mock =
  MonitorStatusService.findOneBy as unknown as jest.Mock;
const lock: jest.Mock = Semaphore.lock as unknown as jest.Mock;

let redis: Map<string, string>;
let expiries: Map<string, number>;
let redisFails: boolean;

function heartbeatFilter(values: Partial<CriteriaFilter>): CriteriaFilter {
  return {
    checkOn: CheckOn.IncomingRequest,
    filterType: FilterType.RecievedInMinutes,
    value: 5,
    ...values,
  } as CriteriaFilter;
}

function criteria(
  name: string,
  statusId: ObjectID,
  filters: Array<CriteriaFilter>,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.name = name;
  instance.data!.changeMonitorStatus = true;
  instance.data!.monitorStatusId = statusId;
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

function heartbeatCriteria(
  checkOn: CheckOn,
  minutes: number,
  extra: Array<CriteriaFilter> = [],
): Array<MonitorCriteriaInstance> {
  return [
    criteria("Received", ONLINE, [
      heartbeatFilter({ checkOn, value: minutes }),
      ...extra,
    ]),
    criteria("Missing", OFFLINE, [
      heartbeatFilter({
        checkOn,
        filterType: FilterType.NotRecievedInMinutes,
        value: minutes,
      }),
    ]),
  ];
}

function makeMonitor(
  monitorType: MonitorType,
  instances: Array<MonitorCriteriaInstance>,
): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = new ObjectID("cdcdcdcd-0000-4000-8000-000000000001");
  monitor._id = monitor.id.toString();
  monitor.projectId = new ObjectID("efefefef-0000-4000-8000-000000000001");
  monitor.monitorType = monitorType;
  monitor.name = "Heartbeat";
  monitor.monitorSteps = stepsWith(instances);
  monitor.currentMonitorStatusId = ONLINE;
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

function writes(): Array<Record<string, unknown>> {
  return updateColumns.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { data: Record<string, unknown> }).data;
  });
}

function judgedReceivedAt(): Date {
  const call: Array<unknown> | undefined =
    processMonitorStep.mock.calls[processMonitorStep.mock.calls.length - 1];

  return (
    call![0] as {
      dataToProcess: ServerMonitorResponse;
    }
  ).dataToProcess.requestReceivedAt;
}

function expireFences(): void {
  for (const name of Array.from(redis.keys())) {
    if (name.includes("-write-")) {
      redis.delete(name);
    }
  }
}

function fenceExpiry(write: string): number | undefined {
  for (const [name, seconds] of Array.from(expiries.entries())) {
    if (name.includes(`-write-${write}-`)) {
      return seconds;
    }
  }

  return undefined;
}

beforeEach(() => {
  jest.clearAllMocks();

  redis = new Map<string, string>();
  expiries = new Map<string, number>();
  redisFails = false;

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      if (redisFails) {
        throw new Error("Redis is down");
      }

      return redis.get(`${namespace}-${key}`) ?? null;
    });

  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: string,
        options?: { expiresInSeconds?: number | undefined },
      ) => {
        if (redisFails) {
          throw new Error("Redis is down");
        }

        redis.set(`${namespace}-${key}`, value);
        expiries.set(`${namespace}-${key}`, options?.expiresInSeconds || 0);
      },
    );

  jest
    .spyOn(GlobalCache, "setNumberIfGreater")
    .mockImplementation(
      async (namespace: string, key: string, value: number) => {
        if (redisFails) {
          throw new Error("Redis is down");
        }

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
  jest.spyOn(ProjectService, "isSampleProject").mockResolvedValue(false);

  lock.mockResolvedValue(MUTEX as never);
  updateColumns.mockResolvedValue(undefined as never);
  statusName.mockResolvedValue({ name: "Operational" } as never);
  lastTimelineRow.mockResolvedValue(null as never);
  createTimelineRow.mockImplementation(((args: { data: unknown }) => {
    return Promise.resolve(args.data);
  }) as any);

  // The monitor's "Received" criteria is met: nothing past the writes runs.
  processMonitorStep.mockImplementation(((input: {
    probeApiIngestResponse: ProbeApiIngestResponse;
    monitorStep: MonitorStep;
  }) => {
    const received: MonitorCriteriaInstance | undefined =
      input.monitorStep.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray[0];

    return Promise.resolve({
      ...input.probeApiIngestResponse,
      criteriaMetId: received?.data?.id,
      rootCause: "Received.",
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

describe("a server agent's reports", () => {
  let server: Monitor;

  beforeEach(() => {
    server = makeMonitor(MonitorType.Server, [
      criteria("Online", ONLINE, [
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
        } as CriteriaFilter,
      ]),
    ]);
    findOneById.mockResolvedValue(server as never);
  });

  test("the first report writes the monitor row; the next, moments later, does not", async () => {
    await MonitorResourceUtil.monitorResource(serverReport(server));
    await MonitorResourceUtil.monitorResource(serverReport(server));

    expect(writes()).toHaveLength(1);
    expect(writes()[0]!["serverMonitorRequestReceivedAt"]).toBeDefined();
    expect(writes()[0]!["serverMonitorResponse"]).toBeDefined();
    expect(fenceExpiry("server-report")).toBe(
      MonitorHeartbeatState.SERVER_REPORT_WRITE_EVERY_SECONDS,
    );
  });

  test("once the last write is old enough, the next report writes again", async () => {
    await MonitorResourceUtil.monitorResource(serverReport(server));
    expireFences();
    await MonitorResourceUtil.monitorResource(serverReport(server));

    expect(writes()).toHaveLength(2);
  });

  test("every report's arrival is kept, written or not", async () => {
    const first: Date = new Date(Date.now() - 1000);
    const second: Date = new Date();

    await MonitorResourceUtil.monitorResource(
      serverReport(server, { requestReceivedAt: first }),
    );
    await MonitorResourceUtil.monitorResource(
      serverReport(server, { requestReceivedAt: second }),
    );

    expect(writes()).toHaveLength(1);
    expect(
      (
        await MonitorHeartbeatState.getServerReportReceivedAt(server.id!)
      )?.getTime(),
    ).toBe(second.getTime());
  });

  test("a check of the monitor judges the latest arrival kept, not the older one written", async () => {
    const reportedAt: Date = new Date();
    await MonitorHeartbeatState.recordServerReport({
      monitorId: server.id!,
      receivedAt: reportedAt,
    });

    // What the CheckOnlineStatus sweep read from the row.
    const writtenAt: Date = new Date(reportedAt.getTime() - 4 * 60 * 1000);

    await MonitorResourceUtil.monitorResource(
      serverReport(server, {
        requestReceivedAt: writtenAt,
        onlyCheckRequestReceivedAt: true,
      }),
    );

    expect(judgedReceivedAt().getTime()).toBe(reportedAt.getTime());
    // A check writes nothing, as before.
    expect(writes()).toHaveLength(0);
  });

  test("a check whose written arrival is the newest keeps it", async () => {
    const writtenAt: Date = new Date();
    await MonitorHeartbeatState.recordServerReport({
      monitorId: server.id!,
      receivedAt: new Date(writtenAt.getTime() - 60 * 1000),
    });

    await MonitorResourceUtil.monitorResource(
      serverReport(server, {
        requestReceivedAt: writtenAt,
        onlyCheckRequestReceivedAt: true,
      }),
    );

    expect(judgedReceivedAt().getTime()).toBe(writtenAt.getTime());
  });

  test("a Redis that cannot be reached writes every report, as before", async () => {
    redisFails = true;

    await MonitorResourceUtil.monitorResource(serverReport(server));
    await MonitorResourceUtil.monitorResource(serverReport(server));

    expect(writes()).toHaveLength(2);
  });
});

describe("an incoming request's row", () => {
  function receiving(
    minutes: number,
    extra: Array<CriteriaFilter> = [],
  ): Monitor {
    const monitor: Monitor = makeMonitor(
      MonitorType.IncomingRequest,
      heartbeatCriteria(CheckOn.IncomingRequest, minutes, extra),
    );
    findOneById.mockResolvedValue(monitor as never);
    return monitor;
  }

  test("the same request twice is written once", async () => {
    const monitor: Monitor = receiving(5);

    await MonitorResourceUtil.monitorResource(incomingRequest(monitor));
    await MonitorResourceUtil.monitorResource(incomingRequest(monitor));

    expect(writes()).toHaveLength(1);
    expect(writes()[0]!["incomingMonitorRequest"]).toBeDefined();
    expect(writes()[0]!["incomingMonitorRequestAsReceived"]).toBeDefined();
    expect(
      writes()[0]!["incomingRequestMonitorHeartbeatCheckedAt"],
    ).toBeDefined();
  });

  test("a request whose body differs is written at once", async () => {
    const monitor: Monitor = receiving(5);

    await MonitorResourceUtil.monitorResource(incomingRequest(monitor));
    await MonitorResourceUtil.monitorResource(
      incomingRequest(monitor, { requestBody: { status: "degraded" } }),
    );

    expect(writes()).toHaveLength(2);
  });

  test("a request with another method is written at once", async () => {
    const monitor: Monitor = receiving(5);

    await MonitorResourceUtil.monitorResource(incomingRequest(monitor));
    await MonitorResourceUtil.monitorResource(
      incomingRequest(monitor, { requestMethod: HTTPMethod.GET }),
    );

    expect(writes()).toHaveLength(2);
  });

  test("a header a proxy adds to every request writes nothing new while no criteria reads a header", async () => {
    const monitor: Monitor = receiving(5);

    await MonitorResourceUtil.monitorResource(
      incomingRequest(monitor, {
        requestHeaders: { "x-request-id": "a1" },
      }),
    );
    await MonitorResourceUtil.monitorResource(
      incomingRequest(monitor, {
        requestHeaders: { "x-request-id": "b2" },
      }),
    );

    expect(writes()).toHaveLength(1);
  });

  test("with a criteria that reads headers, a header that differs is written at once", async () => {
    const monitor: Monitor = receiving(5, [
      {
        checkOn: CheckOn.RequestHeaderValue,
        filterType: FilterType.Contains,
        value: "secret",
      } as CriteriaFilter,
    ]);

    await MonitorResourceUtil.monitorResource(
      incomingRequest(monitor, { requestHeaders: { "x-token": "a1" } }),
    );
    await MonitorResourceUtil.monitorResource(
      incomingRequest(monitor, { requestHeaders: { "x-token": "b2" } }),
    );

    expect(writes()).toHaveLength(2);
  });

  test("an unchanged request is written again once its fence has passed", async () => {
    const monitor: Monitor = receiving(5);

    await MonitorResourceUtil.monitorResource(incomingRequest(monitor));
    expireFences();
    await MonitorResourceUtil.monitorResource(incomingRequest(monitor));

    expect(writes()).toHaveLength(2);
  });

  test("the fence is half the shortest window, between fifteen seconds and two minutes", async () => {
    for (const [minutes, seconds] of [
      [1, 30],
      [3, 90],
      [5, 120],
      [60, 120],
      [0.25, 15],
    ] as Array<[number, number]>) {
      redis.clear();
      expiries.clear();

      const monitor: Monitor = receiving(minutes);

      await MonitorResourceUtil.monitorResource(incomingRequest(monitor));

      expect(fenceExpiry("incoming-request")).toBe(seconds);
    }
  });

  test("a check of the monitor (the sweep) writes no request, as before", async () => {
    const monitor: Monitor = receiving(5);

    await MonitorResourceUtil.monitorResource(
      incomingRequest(monitor, { onlyCheckForIncomingRequestReceivedAt: true }),
    );

    expect(writes()).toHaveLength(0);
  });

  test("a Redis that cannot be reached writes every request, as before", async () => {
    const monitor: Monitor = receiving(5);
    redisFails = true;

    await MonitorResourceUtil.monitorResource(incomingRequest(monitor));
    await MonitorResourceUtil.monitorResource(incomingRequest(monitor));

    expect(writes()).toHaveLength(2);
  });
});

describe("what an evaluation of a heartbeat judged is recorded for the sweeps", () => {
  test("an incoming request's: a sweep inside the window would judge the same, and may skip", async () => {
    const monitor: Monitor = makeMonitor(
      MonitorType.IncomingRequest,
      heartbeatCriteria(CheckOn.IncomingRequest, 5),
    );
    findOneById.mockResolvedValue(monitor as never);
    const request: IncomingMonitorRequest = incomingRequest(monitor);

    await MonitorResourceUtil.monitorResource(request);

    expect(
      await MonitorHeartbeatState.canSkipEvaluation({
        kind: HeartbeatKind.IncomingRequest,
        monitorId: monitor.id!,
        receivedAt: request.incomingRequestReceivedAt,
        monitorSteps: monitor.monitorSteps,
        monitorStatusId: ONLINE,
        now: new Date(request.incomingRequestReceivedAt.getTime() + 60 * 1000),
      }),
    ).toBe(true);
  });

  test("an email's too", async () => {
    const monitor: Monitor = makeMonitor(
      MonitorType.IncomingEmail,
      heartbeatCriteria(CheckOn.EmailReceivedAt, 60),
    );
    findOneById.mockResolvedValue(monitor as never);

    const now: Date = OneUptimeDate.getCurrentDate();
    const email: IncomingEmailMonitorRequest = {
      projectId: monitor.projectId!,
      monitorId: monitor.id!,
      emailFrom: "backup@example.com",
      emailTo: "monitor@example.com",
      emailSubject: "Backup OK",
      emailBody: "OK",
      emailReceivedAt: now,
      checkedAt: now,
      onlyCheckForIncomingEmailReceivedAt: false,
    };

    await MonitorResourceUtil.monitorResource(email);

    expect(
      await MonitorHeartbeatState.canSkipEvaluation({
        kind: HeartbeatKind.IncomingEmail,
        monitorId: monitor.id!,
        receivedAt: now,
        monitorSteps: monitor.monitorSteps,
        monitorStatusId: ONLINE,
        now: new Date(now.getTime() + 10 * 60 * 1000),
      }),
    ).toBe(true);
  });

  test("an evaluation that fails records nothing", async () => {
    const monitor: Monitor = makeMonitor(
      MonitorType.IncomingRequest,
      heartbeatCriteria(CheckOn.IncomingRequest, 5),
    );
    findOneById.mockResolvedValue(monitor as never);
    processMonitorStep.mockRejectedValue(new Error("criteria failed") as never);
    const request: IncomingMonitorRequest = incomingRequest(monitor);

    await expect(MonitorResourceUtil.monitorResource(request)).rejects.toThrow(
      "criteria failed",
    );

    expect(
      Array.from(redis.keys()).some((name: string) => {
        return name.includes("-evaluated-");
      }),
    ).toBe(false);
  });

  test("a server monitor's report records no heartbeat evaluation", async () => {
    const server: Monitor = makeMonitor(MonitorType.Server, [
      criteria("Online", ONLINE, [
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
        } as CriteriaFilter,
      ]),
    ]);
    findOneById.mockResolvedValue(server as never);

    await MonitorResourceUtil.monitorResource(serverReport(server));

    expect(
      Array.from(redis.keys()).some((name: string) => {
        return name.includes("-evaluated-");
      }),
    ).toBe(false);
  });
});
