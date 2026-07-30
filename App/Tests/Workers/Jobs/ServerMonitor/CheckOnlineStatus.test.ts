import Monitor from "Common/Models/DatabaseModels/Monitor";
import OneUptimeDate from "Common/Types/Date";
import { CheckOn } from "Common/Types/Monitor/CriteriaFilter";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";

/*
 * Regression tests for the ServerMonitor:CheckOnlineStatus cron's read path.
 * The sweep query already selects monitorSteps for every stale Server
 * monitor; the job used to issue a per-monitor freshness re-fetch (WITH
 * monitorSteps — a potentially large jsonb column) for every stale monitor
 * and only THEN run the Is-Online-criteria filter on the re-fetched row. The
 * perf fix runs shouldProcessRequest on the SWEEP row first, so monitors
 * with no CheckOn.IsOnline criteria never pay the re-fetch query at all, and
 * the re-fetch select dropped monitorSteps (it keeps exactly _id, projectId,
 * serverMonitorRequestReceivedAt, createdAt, serverMonitorResponse). These
 * tests pin:
 *   1. no Is-Online filter on the sweep row => NO findOneBy re-fetch and no
 *      monitorResource call (the query the change eliminates),
 *   2. with an Is-Online filter => exactly one findOneBy whose select does
 *      NOT include monitorSteps and whose query re-checks
 *      serverMonitorRequestReceivedAt against the SAME lessThanEqualToOrNull
 *      threshold as the sweep; the ServerMonitorResponse handed to
 *      monitorResource is built from the RE-FETCHED row's fields (including
 *      the requestReceivedAt fallback chain and onlyCheckRequestReceivedAt),
 *   3. the surrounding control flow is unchanged: a null re-fetch (a
 *      response arrived since the sweep) is skipped silently, a re-fetched
 *      row missing projectId is logged and skipped, a monitor with no
 *      monitorSteps is skipped before everything, and one monitor's failure
 *      does not prevent the others.
 *
 * The job registers itself via RunCron at import time and exports nothing,
 * so the Cron util is mocked to CAPTURE the handler (the same recorder the
 * other App/Tests/Workers/Jobs suites use) and each test drives one tick.
 */

type CronHandler = () => Promise<void>;

/*
 * Captured cron handlers, keyed by job name. Must be declared before the job
 * import below so the mock factory closure can see it.
 */
const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      findOneBy: jest.fn(),
      getEnabledMonitorQuery: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { getActiveProjectStatusQuery: jest.fn() },
  };
});

/*
 * The real MonitorResource util transitively loads the native `isolated-vm`
 * addon (via MonitorCriteriaEvaluator -> VMRunner); the job only needs its
 * monitorResource entry point, so the whole module is replaced.
 */
jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: { monitorResource: jest.fn() },
  };
});

import MonitorService from "Common/Server/Services/MonitorService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/ServerMonitor/CheckOnlineStatus";

interface MonitorServiceMock {
  findAllBy: jest.Mock;
  findOneBy: jest.Mock;
  getEnabledMonitorQuery: jest.Mock;
}

const monitorService: MonitorServiceMock =
  MonitorService as unknown as MonitorServiceMock;
const projectService: { getActiveProjectStatusQuery: jest.Mock } =
  ProjectService as unknown as { getActiveProjectStatusQuery: jest.Mock };
const monitorResourceMock: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const NOW: Date = new Date("2026-07-27T10:00:00.000Z");
const THRESHOLD: Date = new Date("2026-07-27T09:57:00.000Z");
const CREATED_AT: Date = new Date("2026-07-01T00:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const MONITOR_A_ID: ObjectID = new ObjectID("monitor-a");
const MONITOR_B_ID: ObjectID = new ObjectID("monitor-b");

// Sentinels for the enabled-monitor / active-project sub-queries the job spreads in.
const ENABLED_MONITOR_QUERY: Record<string, unknown> = {
  disableActiveMonitoring: false,
};
const ACTIVE_PROJECT_QUERY: Record<string, unknown> = {
  markedForDeletion: false,
};

/*
 * The real QueryHelper.lessThanEqualToOrNull returns a TypeORM Raw with a
 * random parameter name, so two calls with the same date never compare
 * equal. The spy replaces it with a deterministic sentinel that carries the
 * threshold, letting the tests prove the re-fetch re-uses the SAME sweep
 * threshold.
 */
interface LessThanEqualToOrNullSentinel {
  lessThanEqualToOrNull: Date;
}

function lteOrNullSentinel(value: Date): LessThanEqualToOrNullSentinel {
  return { lessThanEqualToOrNull: value };
}

/*
 * shouldProcessRequest only walks the plain data shape
 * monitorSteps.data.monitorStepsInstanceArray[].data.monitorCriteria.data
 *   .monitorCriteriaInstanceArray[].data.filters[].checkOn
 * so a cast plain object stands in for a fully-constructed MonitorSteps.
 */
function stepsWithCheckOn(checkOn: CheckOn): MonitorSteps {
  return {
    data: {
      monitorStepsInstanceArray: [
        {
          data: {
            monitorCriteria: {
              data: {
                monitorCriteriaInstanceArray: [
                  { data: { filters: [{ checkOn: checkOn }] } },
                ],
              },
            },
          },
        },
      ],
    },
  } as unknown as MonitorSteps;
}

// A monitor as the SWEEP returns it: _id + monitorSteps only.
function makeSweepMonitor(data: {
  id: ObjectID;
  monitorSteps?: MonitorSteps | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor(data.id);

  if (data.monitorSteps) {
    monitor.monitorSteps = data.monitorSteps;
  }

  return monitor;
}

// A monitor as the RE-FETCH returns it: the slim select, no monitorSteps.
function makeRefetchedMonitor(data: {
  id: ObjectID;
  projectId?: ObjectID | undefined;
  serverMonitorRequestReceivedAt?: Date | undefined;
  serverMonitorResponse?: ServerMonitorResponse | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor(data.id);
  monitor.createdAt = CREATED_AT;

  if (data.projectId) {
    monitor.projectId = data.projectId;
  }

  if (data.serverMonitorRequestReceivedAt) {
    monitor.serverMonitorRequestReceivedAt =
      data.serverMonitorRequestReceivedAt;
  }

  if (data.serverMonitorResponse) {
    monitor.serverMonitorResponse = data.serverMonitorResponse;
  }

  return monitor;
}

interface FindArgs {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
}

async function runWorkerTick(): Promise<void> {
  const handler: CronHandler | undefined =
    mockCapturedJobs["ServerMonitor:CheckOnlineStatus"];

  if (!handler) {
    throw new Error(
      "ServerMonitor:CheckOnlineStatus did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler();
}

describe("ServerMonitor:CheckOnlineStatus worker", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW);
    });
    jest.spyOn(OneUptimeDate, "getSomeMinutesAgo").mockImplementation(() => {
      return new Date(THRESHOLD);
    });
    jest
      .spyOn(QueryHelper, "lessThanEqualToOrNull")
      .mockImplementation((value: number | Date) => {
        return lteOrNullSentinel(value as Date) as never;
      });

    monitorService.findAllBy.mockResolvedValue([]);
    monitorService.findOneBy.mockResolvedValue(null);
    monitorService.getEnabledMonitorQuery.mockReturnValue(
      ENABLED_MONITOR_QUERY,
    );
    projectService.getActiveProjectStatusQuery.mockReturnValue(
      ACTIVE_PROJECT_QUERY,
    );
    monitorResourceMock.mockResolvedValue(undefined);
  });

  test("sweeps stale Server monitors with monitorSteps in the select and the enabled/active gates", async () => {
    await runWorkerTick();

    expect(monitorService.findAllBy).toHaveBeenCalledTimes(1);

    const sweep: FindArgs = monitorService.findAllBy.mock
      .calls[0]![0] as FindArgs;

    expect(sweep.query["monitorType"]).toBe(MonitorType.Server);
    expect(sweep.query["disableActiveMonitoring"]).toBe(false);
    expect(sweep.query["project"]).toEqual(ACTIVE_PROJECT_QUERY);
    // 3-minute staleness threshold, tolerant of never-received (NULL).
    expect(sweep.query["serverMonitorRequestReceivedAt"]).toEqual(
      lteOrNullSentinel(THRESHOLD),
    );
    // the whole point of the change: the sweep row carries monitorSteps.
    expect(sweep.select).toEqual({ _id: true, monitorSteps: true });
  });

  test("a monitor whose steps have no Is Online filter is dropped on the sweep row: no re-fetch, no evaluation", async () => {
    monitorService.findAllBy.mockResolvedValue([
      makeSweepMonitor({
        id: MONITOR_A_ID,
        monitorSteps: stepsWithCheckOn(CheckOn.ResponseTime),
      }),
    ]);

    await runWorkerTick();

    // THE query this change eliminates: the per-monitor freshness re-fetch.
    expect(monitorService.findOneBy).not.toHaveBeenCalled();
    expect(monitorResourceMock).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("a monitor with no monitorSteps at all is skipped before everything", async () => {
    monitorService.findAllBy.mockResolvedValue([
      makeSweepMonitor({ id: MONITOR_A_ID }),
    ]);

    await runWorkerTick();

    expect(monitorService.findOneBy).not.toHaveBeenCalled();
    expect(monitorResourceMock).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("a monitor with an Is Online filter is re-fetched WITHOUT monitorSteps, against the same staleness threshold, and evaluated from the re-fetched row", async () => {
    const refetchedReceivedAt: Date = new Date("2026-07-27T09:50:00.000Z");

    monitorService.findAllBy.mockResolvedValue([
      makeSweepMonitor({
        id: MONITOR_A_ID,
        monitorSteps: stepsWithCheckOn(CheckOn.IsOnline),
      }),
    ]);
    monitorService.findOneBy.mockResolvedValue(
      makeRefetchedMonitor({
        id: MONITOR_A_ID,
        projectId: PROJECT_ID,
        serverMonitorRequestReceivedAt: refetchedReceivedAt,
        serverMonitorResponse: {
          requestReceivedAt: new Date("2026-07-27T09:40:00.000Z"),
          hostname: "refetched-host",
        } as ServerMonitorResponse,
      }),
    );

    await runWorkerTick();

    expect(monitorService.findOneBy).toHaveBeenCalledTimes(1);

    const refetch: FindArgs = monitorService.findOneBy.mock
      .calls[0]![0] as FindArgs;

    // the slim select: monitorSteps is deliberately NOT re-fetched.
    expect(refetch.select).toEqual({
      _id: true,
      projectId: true,
      serverMonitorRequestReceivedAt: true,
      createdAt: true,
      serverMonitorResponse: true,
    });
    expect(refetch.select["monitorSteps"]).toBeUndefined();

    // freshness is re-checked with the SAME threshold the sweep used.
    expect((refetch.query["_id"] as ObjectID).toString()).toBe(
      MONITOR_A_ID.toString(),
    );
    expect(refetch.query["serverMonitorRequestReceivedAt"]).toEqual(
      lteOrNullSentinel(THRESHOLD),
    );

    expect(monitorResourceMock).toHaveBeenCalledTimes(1);

    const payload: ServerMonitorResponse = monitorResourceMock.mock
      .calls[0]![0] as ServerMonitorResponse;

    expect(payload.monitorId.toString()).toBe(MONITOR_A_ID.toString());
    expect(payload.projectId.toString()).toBe(PROJECT_ID.toString());
    // the worker-side check only validates liveness, never re-runs criteria.
    expect(payload.onlyCheckRequestReceivedAt).toBe(true);
    // built from the RE-FETCHED row: the column wins over the response blob.
    expect(payload.requestReceivedAt.getTime()).toBe(
      refetchedReceivedAt.getTime(),
    );
    expect(payload.hostname).toBe("refetched-host");
    expect(payload.timeNow?.getTime()).toBe(NOW.getTime());
  });

  test("requestReceivedAt falls back to the stored response's requestReceivedAt when the column is unset", async () => {
    const responseReceivedAt: Date = new Date("2026-07-27T09:45:00.000Z");

    monitorService.findAllBy.mockResolvedValue([
      makeSweepMonitor({
        id: MONITOR_A_ID,
        monitorSteps: stepsWithCheckOn(CheckOn.IsOnline),
      }),
    ]);
    monitorService.findOneBy.mockResolvedValue(
      makeRefetchedMonitor({
        id: MONITOR_A_ID,
        projectId: PROJECT_ID,
        serverMonitorResponse: {
          requestReceivedAt: responseReceivedAt,
        } as ServerMonitorResponse,
      }),
    );

    await runWorkerTick();

    const payload: ServerMonitorResponse = monitorResourceMock.mock
      .calls[0]![0] as ServerMonitorResponse;

    expect(payload.requestReceivedAt.getTime()).toBe(
      responseReceivedAt.getTime(),
    );
  });

  test("a monitor that never received any response falls back to createdAt and an empty hostname", async () => {
    monitorService.findAllBy.mockResolvedValue([
      makeSweepMonitor({
        id: MONITOR_A_ID,
        monitorSteps: stepsWithCheckOn(CheckOn.IsOnline),
      }),
    ]);
    monitorService.findOneBy.mockResolvedValue(
      makeRefetchedMonitor({ id: MONITOR_A_ID, projectId: PROJECT_ID }),
    );

    await runWorkerTick();

    const payload: ServerMonitorResponse = monitorResourceMock.mock
      .calls[0]![0] as ServerMonitorResponse;

    expect(payload.requestReceivedAt.getTime()).toBe(CREATED_AT.getTime());
    expect(payload.hostname).toBe("");
  });

  test("a null re-fetch (a response arrived since the sweep) is skipped silently", async () => {
    monitorService.findAllBy.mockResolvedValue([
      makeSweepMonitor({
        id: MONITOR_A_ID,
        monitorSteps: stepsWithCheckOn(CheckOn.IsOnline),
      }),
    ]);
    monitorService.findOneBy.mockResolvedValue(null);

    await runWorkerTick();

    expect(monitorService.findOneBy).toHaveBeenCalledTimes(1);
    expect(monitorResourceMock).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("a re-fetched row missing projectId is logged and skipped", async () => {
    monitorService.findAllBy.mockResolvedValue([
      makeSweepMonitor({
        id: MONITOR_A_ID,
        monitorSteps: stepsWithCheckOn(CheckOn.IsOnline),
      }),
    ]);
    monitorService.findOneBy.mockResolvedValue(
      makeRefetchedMonitor({ id: MONITOR_A_ID }),
    );

    await runWorkerTick();

    expect(monitorResourceMock).not.toHaveBeenCalled();
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("does not have a projectId"),
    );
  });

  test("one monitor's evaluation rejecting does not prevent processing of the others", async () => {
    monitorService.findAllBy.mockResolvedValue([
      makeSweepMonitor({
        id: MONITOR_A_ID,
        monitorSteps: stepsWithCheckOn(CheckOn.IsOnline),
      }),
      makeSweepMonitor({
        id: MONITOR_B_ID,
        monitorSteps: stepsWithCheckOn(CheckOn.IsOnline),
      }),
    ]);

    monitorService.findOneBy.mockImplementation((args: FindArgs) => {
      const id: ObjectID = args.query["_id"] as ObjectID;
      return Promise.resolve(
        makeRefetchedMonitor({
          id: id,
          projectId: PROJECT_ID,
          serverMonitorRequestReceivedAt: new Date("2026-07-27T09:50:00.000Z"),
        }),
      );
    });

    monitorResourceMock.mockImplementation(
      (response: ServerMonitorResponse) => {
        if (response.monitorId.toString() === MONITOR_A_ID.toString()) {
          return Promise.reject(new Error("evaluation blew up"));
        }
        return Promise.resolve(undefined);
      },
    );

    await runWorkerTick();

    // both monitors were re-fetched and both handed to monitorResource...
    expect(monitorService.findOneBy).toHaveBeenCalledTimes(2);
    expect(monitorResourceMock).toHaveBeenCalledTimes(2);

    const monitorIds: Array<string> = monitorResourceMock.mock.calls.map(
      (args: Array<unknown>) => {
        return (args[0] as ServerMonitorResponse).monitorId.toString();
      },
    );
    expect(monitorIds).toEqual([
      MONITOR_A_ID.toString(),
      MONITOR_B_ID.toString(),
    ]);

    // ...and the failure was logged per-monitor, not swallowed globally.
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(MONITOR_A_ID.toString()),
    );
  });
});
