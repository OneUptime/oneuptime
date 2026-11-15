/*
 * What one result costs before it is judged, and what it still guarantees.
 *
 * - The monitor is read once, under the per-monitor lock (the race that
 *   needs it has a suite of its own: MonitorResourceStatusRefreshUnderLock).
 * - A caller that resolved the monitor from a secret key it kept
 *   (MonitorSecretKeyCache) has that read check the key is still the
 *   monitor's: a rotated key finds no monitor, as the caller's own lookup
 *   would have.
 * - A probe's result that waited for the lock behind a newer one from the
 *   same probe is dropped instead of judged after it - or failed and
 *   retried when it gave up waiting (MonitorProbeResultOrder).
 * - The Monitor Summary the records keep is built only when a record is
 *   really created, once for all of them, and shows the evaluation as it
 *   stood before any was.
 *
 * The evaluator, the lock, the monitor read and the record creators are
 * stubbed at their edges; Redis is a map.
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
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorMaintenanceSuppression from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorProbeResultOrder from "../../../../Server/Utils/Monitor/MonitorProbeResultOrder";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ExceptionMessages from "../../../../Types/Exception/ExceptionMessages";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorSummarySnapshot from "../../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../../../Types/Monitor/MonitorType";
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
import type { SpyInstance } from "jest-mock";

const ONLINE: ObjectID = new ObjectID("dddddddd-0000-4000-8000-000000000001");
const OFFLINE: ObjectID = new ObjectID("dddddddd-0000-4000-8000-000000000002");
const PROBE: ObjectID = new ObjectID("dddddddd-0000-4000-8000-0000000000a1");
const OTHER_PROBE: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-0000000000a2",
);
const SECRET_KEY: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-0000000000c1",
);

const MUTEX: { key: string } = { key: "the monitor's lock" };

// Longer than MonitorResource's LOCK_WAIT_WORTH_ORDERING_MS.
const A_WAIT_FOR_THE_LOCK_MS: number = 150;

const processMonitorStep: jest.Mock =
  MonitorCriteriaEvaluator.processMonitorStep as unknown as jest.Mock;
const findOneById: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const createTimelineRow: jest.Mock =
  MonitorStatusTimelineService.create as unknown as jest.Mock;
const lastTimelineRow: jest.Mock =
  MonitorStatusTimelineService.findOneBy as unknown as jest.Mock;
const statusName: jest.Mock =
  MonitorStatusService.findOneBy as unknown as jest.Mock;
const lock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
const release: jest.Mock = Semaphore.release as unknown as jest.Mock;

let redis: Map<string, string>;
let isProjectBlocked: SpyInstance<typeof ProjectService.isProjectBlocked>;

function criteria(data: {
  name: string;
  statusId: ObjectID;
  createIncidents?: boolean;
  createAlerts?: boolean;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.name = data.name;
  instance.data!.changeMonitorStatus = true;
  instance.data!.monitorStatusId = data.statusId;
  instance.data!.createIncidents = data.createIncidents === true;
  instance.data!.createAlerts = data.createAlerts === true;
  instance.data!.incidents = [];
  instance.data!.alerts = [];
  return instance;
}

const RECEIVED: MonitorCriteriaInstance = criteria({
  name: "Heartbeat received",
  statusId: ONLINE,
});

const MISSING_OPENS_RECORDS: MonitorCriteriaInstance = criteria({
  name: "Heartbeat missing",
  statusId: OFFLINE,
  createIncidents: true,
  createAlerts: true,
});

function makeMonitor(data: {
  monitorType: MonitorType;
  values?: Partial<Monitor>;
}): Monitor {
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [RECEIVED, MISSING_OPENS_RECORDS],
  };

  const step: MonitorStep = new MonitorStep();
  step.data!.monitorCriteria = monitorCriteria;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = new ObjectID("eeeeeeee-0000-4000-8000-000000000001");
  monitor._id = monitor.id.toString();
  monitor.projectId = new ObjectID("ffffffff-0000-4000-8000-000000000001");
  monitor.monitorType = data.monitorType;
  monitor.name = "Nightly export";
  monitor.monitorSteps = monitorSteps;
  monitor.currentMonitorStatusId = ONLINE;
  Object.assign(monitor, data.values || {});
  return monitor;
}

function heartbeat(monitor: Monitor): IncomingMonitorRequest {
  const now: Date = OneUptimeDate.getCurrentDate();

  return {
    projectId: monitor.projectId!,
    monitorId: monitor.id!,
    requestHeaders: {},
    requestBody: {},
    incomingRequestReceivedAt: now,
    onlyCheckForIncomingRequestReceivedAt: false,
    checkedAt: now,
  };
}

function probeResult(
  monitor: Monitor,
  monitoredAt: Date,
  probeId: ObjectID = PROBE,
): ProbeMonitorResponse {
  return {
    monitorId: monitor.id!,
    probeId: probeId,
    isOnline: true,
    monitoredAt: monitoredAt,
  } as unknown as ProbeMonitorResponse;
}

function evaluationMatches(matched: MonitorCriteriaInstance | null): void {
  processMonitorStep.mockImplementation(((input: {
    probeApiIngestResponse: ProbeApiIngestResponse;
  }) => {
    return Promise.resolve({
      ...input.probeApiIngestResponse,
      criteriaMetId: matched ? matched.data!.id : undefined,
      rootCause: matched ? `${matched.data!.name}.` : null,
    });
  }) as any);
}

function selectOfTheRead(): Record<string, unknown> {
  return (findOneById.mock.calls[0]![0] as { select: Record<string, unknown> })
    .select;
}

// A newer result from the same probe starts while this one waits.
function lockTakenAfterAWait(whileWaiting?: () => Promise<void>): void {
  lock.mockImplementation((async () => {
    if (whileWaiting) {
      await whileWaiting();
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, A_WAIT_FOR_THE_LOCK_MS);
    });

    return MUTEX;
  }) as any);
}

beforeEach(() => {
  jest.clearAllMocks();

  redis = new Map<string, string>();

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

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return redis.get(`${namespace}-${key}`) ?? null;
    });

  isProjectBlocked = jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockResolvedValue(false);
  jest.spyOn(ProjectService, "isSampleProject").mockResolvedValue(false);

  lock.mockResolvedValue(MUTEX as never);
  statusName.mockResolvedValue({ name: "Operational" } as never);
  lastTimelineRow.mockResolvedValue(null as never);
  createTimelineRow.mockImplementation(((args: { data: unknown }) => {
    return Promise.resolve(args.data);
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
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a result whose monitor was found by a secret key the caller kept", () => {
  function monitorWithKey(key: ObjectID | undefined): Monitor {
    return makeMonitor({
      monitorType: MonitorType.IncomingRequest,
      values: key ? { incomingRequestSecretKey: key } : {},
    });
  }

  test("the one read also reads the key, and only when the caller names one", async () => {
    const monitor: Monitor = monitorWithKey(SECRET_KEY);
    findOneById.mockResolvedValue(monitor as never);
    evaluationMatches(RECEIVED);

    await MonitorResourceUtil.monitorResource(heartbeat(monitor), {
      secretKey: {
        column: "incomingRequestSecretKey",
        value: SECRET_KEY.toString(),
      },
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(selectOfTheRead()["incomingRequestSecretKey"]).toBe(true);
    expect(selectOfTheRead()["serverMonitorSecretKey"]).toBeUndefined();

    findOneById.mockClear();

    await MonitorResourceUtil.monitorResource(heartbeat(monitor));

    expect(selectOfTheRead()["incomingRequestSecretKey"]).toBeUndefined();
  });

  test("a key that is still the monitor's is judged, in whatever case it came", async () => {
    const monitor: Monitor = monitorWithKey(SECRET_KEY);
    findOneById.mockResolvedValue(monitor as never);
    evaluationMatches(RECEIVED);

    await MonitorResourceUtil.monitorResource(heartbeat(monitor), {
      secretKey: {
        column: "incomingRequestSecretKey",
        value: ` ${SECRET_KEY.toString().toUpperCase()} `,
      },
    });

    expect(processMonitorStep).toHaveBeenCalledTimes(1);
  });

  test("a key that is no longer the monitor's finds no monitor: nothing is judged, and the lock is given back", async () => {
    // Rotated after the caller kept it.
    const monitor: Monitor = monitorWithKey(ObjectID.generate());
    findOneById.mockResolvedValue(monitor as never);
    evaluationMatches(RECEIVED);

    await expect(
      MonitorResourceUtil.monitorResource(heartbeat(monitor), {
        secretKey: {
          column: "incomingRequestSecretKey",
          value: SECRET_KEY.toString(),
        },
      }),
    ).rejects.toThrow(new BadDataException(ExceptionMessages.MonitorNotFound));

    expect(processMonitorStep).not.toHaveBeenCalled();
    expect(createTimelineRow).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(MUTEX);
  });

  test("a monitor that has no key at all finds no monitor", async () => {
    const monitor: Monitor = monitorWithKey(undefined);
    findOneById.mockResolvedValue(monitor as never);
    evaluationMatches(RECEIVED);

    await expect(
      MonitorResourceUtil.monitorResource(heartbeat(monitor), {
        secretKey: {
          column: "incomingRequestSecretKey",
          value: SECRET_KEY.toString(),
        },
      }),
    ).rejects.toThrow(ExceptionMessages.MonitorNotFound);

    expect(processMonitorStep).not.toHaveBeenCalled();
  });

  test("another kind's key on the monitor does not stand in for the one named", async () => {
    const monitor: Monitor = makeMonitor({
      monitorType: MonitorType.Server,
      values: {
        incomingRequestSecretKey: SECRET_KEY,
        serverMonitorSecretKey: ObjectID.generate(),
      },
    });
    findOneById.mockResolvedValue(monitor as never);
    evaluationMatches(RECEIVED);

    await expect(
      MonitorResourceUtil.monitorResource(heartbeat(monitor), {
        secretKey: {
          column: "serverMonitorSecretKey",
          value: SECRET_KEY.toString(),
        },
      }),
    ).rejects.toThrow(ExceptionMessages.MonitorNotFound);
  });
});

describe("a probe's result that waited for the lock behind a newer one from the same probe", () => {
  const T0: Date = new Date("2026-11-14T10:00:00.000Z");
  const T1: Date = new Date("2026-11-14T10:01:00.000Z");

  /*
   * What a result that is not dropped goes on to: the monitor is read.
   * It stops at the blocked-project gate right after - judging it is for
   * the suites of the probe path.
   */
  let website: Monitor;

  beforeEach(() => {
    website = makeMonitor({ monitorType: MonitorType.Website });
    findOneById.mockResolvedValue(website as never);
    isProjectBlocked.mockResolvedValue(true);
  });

  test("is dropped: the monitor is not read, nothing is judged, and the lock is given back", async () => {
    lockTakenAfterAWait(async () => {
      await MonitorProbeResultOrder.record({
        monitorId: website.id!,
        probeId: PROBE,
        checkedAt: T1,
      });
    });

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(probeResult(website, T0), {
        reportingProbeId: PROBE,
      });

    expect(response.monitorId.toString()).toBe(website.id!.toString());
    expect(response.criteriaMetId).toBeUndefined();
    expect(findOneById).not.toHaveBeenCalled();
    expect(processMonitorStep).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(MUTEX);
  });

  test("the newer one, judged after it, is not dropped", async () => {
    lockTakenAfterAWait(async () => {
      await MonitorProbeResultOrder.record({
        monitorId: website.id!,
        probeId: PROBE,
        checkedAt: T0,
      });
    });

    await MonitorResourceUtil.monitorResource(probeResult(website, T1), {
      reportingProbeId: PROBE,
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("one that waited with nothing newer behind it is judged as before", async () => {
    lockTakenAfterAWait();

    await MonitorResourceUtil.monitorResource(probeResult(website, T0), {
      reportingProbeId: PROBE,
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("another probe's newer result drops nothing: each probe's results are its own", async () => {
    lockTakenAfterAWait(async () => {
      await MonitorProbeResultOrder.record({
        monitorId: website.id!,
        probeId: OTHER_PROBE,
        checkedAt: T1,
      });
    });

    await MonitorResourceUtil.monitorResource(probeResult(website, T0), {
      reportingProbeId: PROBE,
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("one that got the lock at once is judged without asking", async () => {
    const isSuperseded: SpyInstance<
      typeof MonitorProbeResultOrder.isSuperseded
    > = jest.spyOn(MonitorProbeResultOrder, "isSuperseded");

    await MonitorResourceUtil.monitorResource(probeResult(website, T0), {
      reportingProbeId: PROBE,
    });

    expect(isSuperseded).not.toHaveBeenCalled();
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("is recorded as seen before it waits for the lock", async () => {
    const record: SpyInstance<typeof MonitorProbeResultOrder.record> =
      jest.spyOn(MonitorProbeResultOrder, "record");

    await MonitorResourceUtil.monitorResource(probeResult(website, T0), {
      reportingProbeId: PROBE,
    });

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.invocationCallOrder[0]!).toBeLessThan(
      lock.mock.invocationCallOrder[0]!,
    );
  });

  test("one that gave up waiting while a newer one is waiting too is completed, not failed and retried", async () => {
    lock.mockImplementation((async () => {
      await MonitorProbeResultOrder.record({
        monitorId: website.id!,
        probeId: PROBE,
        checkedAt: T1,
      });
      throw new Error("lock timeout");
    }) as any);

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(probeResult(website, T0), {
        reportingProbeId: PROBE,
      });

    expect(response.criteriaMetId).toBeUndefined();
    expect(findOneById).not.toHaveBeenCalled();
    expect(processMonitorStep).not.toHaveBeenCalled();
    // It never held the lock.
    expect(release).not.toHaveBeenCalled();
  });

  test("one that gave up waiting with nothing newer behind it fails, to be retried, as before", async () => {
    lock.mockRejectedValue(new Error("lock timeout") as never);

    await expect(
      MonitorResourceUtil.monitorResource(probeResult(website, T0), {
        reportingProbeId: PROBE,
      }),
    ).rejects.toThrow("lock timeout");

    expect(findOneById).not.toHaveBeenCalled();
  });

  test("results that name no probe are never ordered or dropped", async () => {
    const monitor: Monitor = makeMonitor({
      monitorType: MonitorType.IncomingRequest,
    });
    findOneById.mockResolvedValue(monitor as never);
    lock.mockRejectedValue(new Error("lock timeout") as never);

    await expect(
      MonitorResourceUtil.monitorResource(heartbeat(monitor)),
    ).rejects.toThrow("lock timeout");

    expect(GlobalCache.setNumberIfGreater).not.toHaveBeenCalled();
    expect(GlobalCache.getString).not.toHaveBeenCalled();
  });
});

describe("the Monitor Summary the records keep", () => {
  const SNAPSHOT: MonitorSummarySnapshot = {
    capturedAt: new Date("2026-11-14T10:00:00.000Z"),
  } as unknown as MonitorSummarySnapshot;

  let capture: SpyInstance<typeof MonitorSummaryCapture.capture>;
  let heartbeatMonitor: Monitor;

  beforeEach(() => {
    capture = jest
      .spyOn(MonitorSummaryCapture, "capture")
      .mockResolvedValue(SNAPSHOT as never);

    heartbeatMonitor = makeMonitor({
      monitorType: MonitorType.IncomingRequest,
    });
    findOneById.mockResolvedValue(heartbeatMonitor as never);
  });

  test("a result that creates nothing builds none", async () => {
    evaluationMatches(RECEIVED);

    await MonitorResourceUtil.monitorResource(heartbeat(heartbeatMonitor));

    expect(
      MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus,
    ).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();
  });

  test("a result that creates records builds it once, however many records keep it", async () => {
    evaluationMatches(MISSING_OPENS_RECORDS);

    const kept: Array<MonitorSummarySnapshot | null> = [];

    type Creator = (input: {
      monitorSummary?: MonitorSummarySnapshot | null | undefined;
      getMonitorSummary?:
        | (() => Promise<MonitorSummarySnapshot | null>)
        | undefined;
    }) => Promise<void>;

    // Two incidents (two series), then an alert.
    const createsRecords: (count: number) => Creator = (count: number) => {
      return async (input: {
        monitorSummary?: MonitorSummarySnapshot | null | undefined;
        getMonitorSummary?:
          | (() => Promise<MonitorSummarySnapshot | null>)
          | undefined;
      }): Promise<void> => {
        expect(input.monitorSummary).toBeUndefined();

        for (let i: number = 0; i < count; i++) {
          kept.push((await input.getMonitorSummary!()) || null);
        }
      };
    };

    jest
      .spyOn(
        MonitorIncident,
        "criteriaMetCreateIncidentsAndUpdateMonitorStatus",
      )
      .mockImplementation(createsRecords(2) as any);
    jest
      .spyOn(MonitorAlert, "criteriaMetCreateAlertsAndUpdateMonitorStatus")
      .mockImplementation(createsRecords(1) as any);

    await MonitorResourceUtil.monitorResource(heartbeat(heartbeatMonitor));

    expect(capture).toHaveBeenCalledTimes(1);
    expect(kept).toEqual([SNAPSHOT, SNAPSHOT, SNAPSHOT]);
  });

  test("what it shows is the evaluation as it stood before any record was created", async () => {
    evaluationMatches(MISSING_OPENS_RECORDS);

    let eventsWhenBuilt: Array<unknown> = [];

    capture.mockImplementation((async (input: {
      evaluationSummary: MonitorEvaluationSummary;
    }) => {
      eventsWhenBuilt = [...input.evaluationSummary.events];
      return SNAPSHOT;
    }) as any);

    let eventsBeforeCreating: number = -1;

    jest
      .spyOn(
        MonitorIncident,
        "criteriaMetCreateIncidentsAndUpdateMonitorStatus",
      )
      .mockImplementation((async (input: {
        evaluationSummary: MonitorEvaluationSummary;
        getMonitorSummary: () => Promise<MonitorSummarySnapshot | null>;
      }) => {
        eventsBeforeCreating = input.evaluationSummary.events.length;

        // What creating a record adds to the evaluation, before the summary is asked for.
        input.evaluationSummary.events.push({
          type: "incident-created",
          title: "Incident created",
          message: "Heartbeat missing.",
          at: OneUptimeDate.getCurrentDate(),
        } as any);

        await input.getMonitorSummary();
      }) as any);

    await MonitorResourceUtil.monitorResource(heartbeat(heartbeatMonitor));

    expect(capture).toHaveBeenCalledTimes(1);
    expect(eventsBeforeCreating).toBeGreaterThanOrEqual(0);
    expect(eventsWhenBuilt).toHaveLength(eventsBeforeCreating);
  });

  test("a summary that cannot be built is built once and kept as none", async () => {
    evaluationMatches(MISSING_OPENS_RECORDS);
    capture.mockResolvedValue(null as never);

    const kept: Array<MonitorSummarySnapshot | null | undefined> = [];

    const asksTwice: (input: {
      getMonitorSummary: () => Promise<MonitorSummarySnapshot | null>;
    }) => Promise<void> = async (input: {
      getMonitorSummary: () => Promise<MonitorSummarySnapshot | null>;
    }): Promise<void> => {
      kept.push(await input.getMonitorSummary());
      kept.push(await input.getMonitorSummary());
    };

    jest
      .spyOn(
        MonitorIncident,
        "criteriaMetCreateIncidentsAndUpdateMonitorStatus",
      )
      .mockImplementation(asksTwice as any);

    await MonitorResourceUtil.monitorResource(heartbeat(heartbeatMonitor));

    expect(capture).toHaveBeenCalledTimes(1);
    expect(kept).toEqual([null, null]);
  });
});
