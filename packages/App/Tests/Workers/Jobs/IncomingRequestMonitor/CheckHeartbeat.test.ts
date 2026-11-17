import Monitor from "Common/Models/DatabaseModels/Monitor";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { getTableColumn } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { JSONObject } from "Common/Types/JSON";

/*
 * Regression tests for the IncomingRequestMonitor:CheckHeartbeat cron's write
 * path. The heartbeat bookkeeping stamp is written for EVERY incoming-request
 * monitor every 30 seconds; it used to go through updateOneById, whose full
 * pipeline is ~4 statements per row plus — because Monitor is
 * @EnableWorkflow + @EnableAuditLog — an on-update workflow HTTP trigger and
 * an audit-log insert per monitor per tick. The perf fix rewired the stamp to
 * the single-UPDATE updateColumnsByIdWithoutHooks fast path. These tests pin:
 *   1. the stamp goes through the hookless fast path with EXACTLY the
 *      incomingRequestMonitorHeartbeatCheckedAt column, and updateOneById is
 *      never called (the regression the change removes),
 *   2. the per-monitor control flow around the stamp: one findBy query
 *      by type, paged by id, visits every monitor once; a monitor without
 *      monitorSteps is skipped with no write;
 *      only a monitor whose criteria check CheckOn.IncomingRequest is handed
 *      to MonitorResourceUtil.monitorResource; one failing monitor does not
 *      prevent the others.
 *
 * The job registers itself via RunCron at import time and exports nothing, so
 * the Cron util is mocked to CAPTURE the handler (the same recorder the other
 * App/Tests/Workers/Jobs suites use) and each test drives one full tick.
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

/*
 * updateOneById is mocked ALONGSIDE the fast path precisely so the suite can
 * prove it is never called: if the job regressed back to the hooked pipeline,
 * the assertion would flag it instead of the mock throwing "not a function".
 * rewriteLatestIncomingRequestForReaders likewise: the job no longer splits a
 * monitor's latest request (#8906), and the suite proves it never asks to.
 */
jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    SemaphoreLockTimeoutError: class extends Error {},
    default: {
      lock: jest.fn().mockImplementation(async () => {
        return { isAcquired: true };
      }),
      release: jest.fn().mockResolvedValue(undefined),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      getEnabledMonitorQuery: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
      updateOneById: jest.fn(),
      rewriteLatestIncomingRequestForReaders: jest.fn(),
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

/*
 * The arrival store is Redis-backed; its own logic is covered by
 * IncomingRequestReceivedAtStore.test.ts. Here track() answers whatever each
 * test needs, and the pure clamp is the real one.
 */
jest.mock("Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore", () => {
  const actual: {
    default: { getReceivedAtAsOf: (receivedAt: Date, checkedAt: Date) => Date };
  } = jest.requireActual(
    "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore",
  );

  return {
    __esModule: true,
    default: {
      track: jest.fn(),
      getReceivedAtAsOf: actual.default.getReceivedAtAsOf,
    },
  };
});

import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import MonitorService from "Common/Server/Services/MonitorService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import MonitorHeartbeatState, {
  HeartbeatKind,
} from "Common/Server/Utils/Monitor/MonitorHeartbeatState";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import IncomingRequestReceivedAtStore from "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import IncomingRequestCriteria from "Common/Server/Utils/Monitor/Criteria/IncomingRequestCriteria";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/IncomingRequestMonitor/CheckHeartbeat";

interface MonitorServiceMock {
  findBy: jest.Mock;
  getEnabledMonitorQuery: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
  updateOneById: jest.Mock;
  rewriteLatestIncomingRequestForReaders: jest.Mock;
}

const monitorService: MonitorServiceMock =
  MonitorService as unknown as MonitorServiceMock;
const projectService: { getActiveProjectStatusQuery: jest.Mock } =
  ProjectService as unknown as { getActiveProjectStatusQuery: jest.Mock };
const monitorResourceMock: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const mockedLogger: { error: jest.Mock; debug: jest.Mock } =
  logger as unknown as {
    error: jest.Mock;
    debug: jest.Mock;
  };
const trackMock: jest.Mock =
  IncomingRequestReceivedAtStore.track as unknown as jest.Mock;

const NOW: Date = new Date("2026-07-27T10:00:00.000Z");
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

function makeMonitor(data: {
  id: ObjectID;
  monitorSteps?: MonitorSteps | undefined;
  incomingMonitorRequest?: IncomingMonitorRequest | undefined;
  incomingMonitorRequestAsReceived?: IncomingMonitorRequest | undefined;
  incomingRequestSecretKey?: ObjectID | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor(data.id);
  monitor.projectId = PROJECT_ID;
  monitor.createdAt = CREATED_AT;

  if (data.incomingRequestSecretKey) {
    monitor.incomingRequestSecretKey = data.incomingRequestSecretKey;
  }

  if (data.monitorSteps) {
    monitor.monitorSteps = data.monitorSteps;
  }

  if (data.incomingMonitorRequest) {
    monitor.incomingMonitorRequest = data.incomingMonitorRequest;
  }

  if (data.incomingMonitorRequestAsReceived) {
    monitor.incomingMonitorRequestAsReceived =
      data.incomingMonitorRequestAsReceived;
  }

  return monitor;
}

interface FindByArgs {
  query: Record<string, unknown>;
  sort: Record<string, unknown>;
  select: Record<string, unknown>;
}

interface UpdateCallArgs {
  id: ObjectID;
  data: Record<string, unknown>;
}

function stampCalls(): Array<UpdateCallArgs> {
  return monitorService.updateColumnsByIdWithoutHooks.mock.calls.map(
    (args: Array<unknown>) => {
      return args[0] as UpdateCallArgs;
    },
  );
}

async function runWorkerTick(): Promise<void> {
  const handler: CronHandler | undefined =
    mockCapturedJobs["IncomingRequestMonitor:CheckHeartbeat"];

  if (!handler) {
    throw new Error(
      "IncomingRequestMonitor:CheckHeartbeat did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler();
}

describe("IncomingRequestMonitor:CheckHeartbeat worker", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Results queued for a page a test's sweep never asked for go with it.
    monitorService.findBy.mockReset();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW);
    });

    monitorService.findBy.mockResolvedValue([]);
    monitorService.getEnabledMonitorQuery.mockReturnValue(
      ENABLED_MONITOR_QUERY,
    );
    monitorService.updateColumnsByIdWithoutHooks.mockResolvedValue(undefined);
    monitorService.updateOneById.mockResolvedValue(undefined);
    monitorService.rewriteLatestIncomingRequestForReaders.mockResolvedValue(
      true,
    );
    projectService.getActiveProjectStatusQuery.mockReturnValue(
      ACTIVE_PROJECT_QUERY,
    );
    monitorResourceMock.mockResolvedValue(undefined);

    // Nothing newer than what Postgres holds - the store's fallback answer.
    trackMock.mockImplementation((input: { receivedAt: Date | string }) => {
      return Promise.resolve(OneUptimeDate.fromString(input.receivedAt));
    });
  });

  test("visits every incoming request monitor once, with one query by type, and stamps each through the hookless fast path only", async () => {
    const first: Monitor = makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.ResponseTime),
    });
    const second: Monitor = makeMonitor({
      id: MONITOR_B_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.ResponseTime),
    });

    monitorService.findBy.mockResolvedValueOnce([first, second]);

    await runWorkerTick();

    // One query, paged by the sweep's immutable ID cursor.
    expect(monitorService.findBy).toHaveBeenCalledTimes(1);

    const batch: FindByArgs = monitorService.findBy.mock
      .calls[0]![0] as FindByArgs;

    expect(batch.query["monitorType"]).toBe(MonitorType.IncomingRequest);
    // the enabled-monitor and active-project gates stay in the query.
    expect(batch.query["disableActiveMonitoring"]).toBe(false);
    expect(batch.query["project"]).toEqual(ACTIVE_PROJECT_QUERY);
    expect(batch.sort).toEqual({ _id: SortOrder.Ascending });

    // One fast-path stamp per monitor, batches concatenated in order.
    const stamps: Array<UpdateCallArgs> = stampCalls();
    expect(stamps).toHaveLength(2);
    expect(
      stamps.map((call: UpdateCallArgs) => {
        return call.id.toString();
      }),
    ).toEqual([MONITOR_A_ID.toString(), MONITOR_B_ID.toString()]);

    for (const stamp of stamps) {
      // EXACTLY the bookkeeping column - nothing else rides along.
      expect(Object.keys(stamp.data)).toEqual([
        "incomingRequestMonitorHeartbeatCheckedAt",
      ]);
      expect(
        (
          stamp.data["incomingRequestMonitorHeartbeatCheckedAt"] as Date
        ).getTime(),
      ).toBe(NOW.getTime());
    }

    // THE regression this change removed: the full hooked pipeline per tick.
    expect(monitorService.updateOneById).not.toHaveBeenCalled();
  });

  test("the cron waits for bounded request evaluations before completing", async () => {
    const rows: Array<Monitor> = Array.from(
      { length: 25 },
      (_: unknown, index: number) => {
        return makeMonitor({
          id: new ObjectID(`monitor-${String(index).padStart(3, "0")}`),
          monitorSteps: stepsWithCheckOn(CheckOn.IncomingRequest),
        });
      },
    );
    monitorService.findBy.mockResolvedValueOnce(rows);
    let resolveEvaluation!: () => void;
    const evaluation: Promise<void> = new Promise((resolve: () => void) => {
      resolveEvaluation = resolve;
    });
    monitorResourceMock.mockReturnValue(evaluation);
    let finished: boolean = false;
    const work: Promise<void> = runWorkerTick().then(() => {
      finished = true;
    });
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
    expect(monitorResourceMock).toHaveBeenCalledTimes(10);
    expect(monitorService.findBy).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    resolveEvaluation();
    await work;
    expect(monitorResourceMock).toHaveBeenCalledTimes(25);
    expect(finished).toBe(true);
  });

  test("no query asks for the status-check stamp: it is written every few minutes, and no longer says who was visited", async () => {
    await runWorkerTick();

    for (const call of monitorService.findBy.mock.calls) {
      const args: FindByArgs = call[0] as FindByArgs;
      expect("incomingRequestMonitorHeartbeatCheckedAt" in args.query).toBe(
        false,
      );
    }
  });

  test("a monitor without monitorSteps is skipped with no write at all", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      makeMonitor({ id: MONITOR_A_ID }),
    ]);

    await runWorkerTick();

    expect(monitorService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
    expect(monitorService.updateOneById).not.toHaveBeenCalled();
    expect(monitorResourceMock).not.toHaveBeenCalled();
  });

  test("criteria checking CheckOn.IncomingRequest hand the monitor to monitorResource with the incoming-request payload", async () => {
    const receivedAt: Date = new Date("2026-07-27T09:55:00.000Z");
    const monitor: Monitor = makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.IncomingRequest),
      incomingMonitorRequestAsReceived: {
        incomingRequestReceivedAt: receivedAt,
      } as IncomingMonitorRequest,
    });

    monitorService.findBy.mockResolvedValueOnce([monitor]);

    await runWorkerTick();

    expect(monitorResourceMock).toHaveBeenCalledTimes(1);

    const payload: IncomingMonitorRequest = monitorResourceMock.mock
      .calls[0]![0] as IncomingMonitorRequest;

    expect(payload.monitorId.toString()).toBe(MONITOR_A_ID.toString());
    expect(payload.projectId.toString()).toBe(PROJECT_ID.toString());
    // the worker-side check only validates liveness, never re-runs criteria.
    expect(payload.onlyCheckForIncomingRequestReceivedAt).toBe(true);
    expect(payload.incomingRequestReceivedAt.getTime()).toBe(
      receivedAt.getTime(),
    );
    expect(payload.checkedAt.getTime()).toBe(NOW.getTime());

    // the heartbeat stamp is written BEFORE the resource evaluation.
    expect(
      monitorService.updateColumnsByIdWithoutHooks.mock.invocationCallOrder[0],
    ).toBeLessThan(monitorResourceMock.mock.invocationCallOrder[0]!);
  });

  test("a monitor that never received a request falls back to createdAt as the received timestamp", async () => {
    const monitor: Monitor = makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.IncomingRequest),
    });

    monitorService.findBy.mockResolvedValueOnce([monitor]);

    await runWorkerTick();

    const payload: IncomingMonitorRequest = monitorResourceMock.mock
      .calls[0]![0] as IncomingMonitorRequest;

    expect(payload.incomingRequestReceivedAt.getTime()).toBe(
      CREATED_AT.getTime(),
    );
  });

  test("a monitor with steps but no IncomingRequest criteria is stamped but never evaluated", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      makeMonitor({
        id: MONITOR_A_ID,
        monitorSteps: stepsWithCheckOn(CheckOn.ResponseTime),
      }),
    ]);

    await runWorkerTick();

    expect(monitorService.updateColumnsByIdWithoutHooks).toHaveBeenCalledTimes(
      1,
    );
    expect(monitorResourceMock).not.toHaveBeenCalled();
  });

  /*
   * The out-of-the-box criteria for this monitor type check the REQUEST BODY,
   * not the arrival clock, so a monitor left on its defaults has nothing for
   * this cron to re-evaluate: it is stamped and skipped, and its status is
   * decided only when a request actually lands. Users who want a missing-
   * heartbeat alarm add a CheckOn.IncomingRequest criteria by hand, which the
   * test above covers.
   */
  test("a monitor on the default body criteria is stamped but never evaluated", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      makeMonitor({
        id: MONITOR_A_ID,
        monitorSteps: stepsWithCheckOn(
          MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
            monitorType: MonitorType.IncomingRequest,
            monitorStatusId: new ObjectID("online-status"),
            monitorName: "Payments API",
          })!.data!.filters[0]!.checkOn,
        ),
      }),
    ]);

    await runWorkerTick();

    expect(monitorService.updateColumnsByIdWithoutHooks).toHaveBeenCalledTimes(
      1,
    );
    expect(monitorResourceMock).not.toHaveBeenCalled();
  });

  test("one monitor whose stamp write fails does not prevent the other monitors from processing", async () => {
    const failing: Monitor = makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.IncomingRequest),
    });
    const healthy: Monitor = makeMonitor({
      id: MONITOR_B_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.IncomingRequest),
    });

    monitorService.findBy.mockResolvedValueOnce([failing, healthy]);

    monitorService.updateColumnsByIdWithoutHooks.mockImplementation(
      (args: UpdateCallArgs) => {
        if (args.id.toString() === MONITOR_A_ID.toString()) {
          return Promise.reject(new Error("db connection reset"));
        }
        return Promise.resolve(undefined);
      },
    );

    await runWorkerTick();

    expect(mockedLogger.error).toHaveBeenCalled();

    // the failing monitor aborts after its stamp; the healthy one still runs.
    expect(monitorResourceMock).toHaveBeenCalledTimes(1);

    const payload: IncomingMonitorRequest = monitorResourceMock.mock
      .calls[0]![0] as IncomingMonitorRequest;
    expect(payload.monitorId.toString()).toBe(MONITOR_B_ID.toString());
  });

  /*
   * A monitor paused, archived or disabled after the sweep read it is
   * refused by MonitorResource (issue #8069). The sweep reads only monitors
   * that are being monitored, so this is the race between the two reads:
   * nothing anyone can act on. It is logged at debug, never at error, and
   * the sweep goes on with the next monitor.
   */
  test.each([
    ExceptionMessages.MonitorDisabledBecauseOfManualIncident,
    ExceptionMessages.MonitorDisabledBecauseOfScheduledMaintenanceEvent,
    ExceptionMessages.MonitorDisabled,
    ExceptionMessages.MonitorArchived,
    ExceptionMessages.MonitorNotFound,
  ])(
    "a monitor refused mid-check ('%s') is logged at debug, not error, and the next monitor is evaluated",
    async (refusal: string) => {
      const paused: Monitor = makeMonitor({
        id: MONITOR_A_ID,
        monitorSteps: stepsWithCheckOn(CheckOn.IncomingRequest),
      });
      const next: Monitor = makeMonitor({
        id: MONITOR_B_ID,
        monitorSteps: stepsWithCheckOn(CheckOn.IncomingRequest),
      });

      monitorService.findBy.mockResolvedValueOnce([paused, next]);
      monitorResourceMock.mockImplementation(
        (request: IncomingMonitorRequest) => {
          if (request.monitorId.toString() === MONITOR_A_ID.toString()) {
            return Promise.reject(new BadDataException(refusal));
          }

          return Promise.resolve(undefined);
        },
      );

      await runWorkerTick();

      expect(mockedLogger.error).not.toHaveBeenCalled();

      const refusalLines: Array<string> = mockedLogger.debug.mock.calls
        .map((call: Array<unknown>): string => {
          return String(call[0]);
        })
        .filter((line: string): boolean => {
          return line.includes(refusal);
        });

      expect(refusalLines).toHaveLength(1);
      expect(refusalLines[0]).toContain(MONITOR_A_ID.toString());

      // The sweep went on: the next monitor was evaluated too.
      expect(
        monitorResourceMock.mock.calls.map((call: Array<unknown>): string => {
          return (call[0] as IncomingMonitorRequest).monitorId.toString();
        }),
      ).toEqual([MONITOR_A_ID.toString(), MONITOR_B_ID.toString()]);
    },
  );

  test("any other evaluation failure is still logged at error, and the next monitor is evaluated", async () => {
    const failing: Monitor = makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.IncomingRequest),
    });
    const next: Monitor = makeMonitor({
      id: MONITOR_B_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.IncomingRequest),
    });
    const failure: Error = new Error("Acquire mutex timeout");

    monitorService.findBy.mockResolvedValueOnce([failing, next]);
    monitorResourceMock.mockImplementation(
      (request: IncomingMonitorRequest) => {
        if (request.monitorId.toString() === MONITOR_A_ID.toString()) {
          return Promise.reject(failure);
        }

        return Promise.resolve(undefined);
      },
    );

    await runWorkerTick();

    expect(mockedLogger.error).toHaveBeenCalledWith(failure, {
      projectId: PROJECT_ID.toString(),
    });
    expect(monitorResourceMock).toHaveBeenCalledTimes(2);
  });
});

/*
 * The 2026-10-04/05 false Offline waves. Heartbeats are answered 2xx at the
 * endpoint and persisted later by a Telemetry worker; the cron judged only
 * the persisted time. When the Telemetry queue fell more than the window
 * behind (or a deploy's migration stalled processing), every heartbeat
 * monitor went Offline while its senders were still being answered 2xx.
 * The cron now judges the latest ARRIVAL, which the endpoint records in
 * IncomingRequestReceivedAtStore.
 */
describe("IncomingRequestMonitor:CheckHeartbeat judges arrivals, not processing", () => {
  const SECRET_KEY: ObjectID = new ObjectID(
    "2d229271-17c4-4b4f-9a3b-3c6ff1a1a2ee",
  );

  // What a Telemetry worker last persisted: 11 minutes before this tick.
  const LAST_PERSISTED: Date = new Date("2026-07-27T09:49:00.000Z");

  // What the endpoint last received: 20 seconds before this tick.
  const LAST_ARRIVAL: Date = new Date("2026-07-27T09:59:40.000Z");

  // The latest request as the ingest kept it as it came, which the job judges.
  function heartbeatMonitor(
    incomingMonitorRequestAsReceived?: IncomingMonitorRequest,
  ): Monitor {
    return makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.IncomingRequest),
      incomingRequestSecretKey: SECRET_KEY,
      incomingMonitorRequestAsReceived: incomingMonitorRequestAsReceived,
    });
  }

  function persistedAt(receivedAt: Date): IncomingMonitorRequest {
    return {
      incomingRequestReceivedAt: receivedAt,
    } as IncomingMonitorRequest;
  }

  function evaluatedPayload(): IncomingMonitorRequest {
    expect(monitorResourceMock).toHaveBeenCalledTimes(1);
    return monitorResourceMock.mock.calls[0]![0] as IncomingMonitorRequest;
  }

  const RECEIVED_IN_5_MINUTES: CriteriaFilter = {
    checkOn: CheckOn.IncomingRequest,
    filterType: FilterType.RecievedInMinutes,
    value: 5,
  };

  const NOT_RECEIVED_IN_5_MINUTES: CriteriaFilter = {
    checkOn: CheckOn.IncomingRequest,
    filterType: FilterType.NotRecievedInMinutes,
    value: 5,
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Results queued for a page a test's sweep never asked for go with it.
    monitorService.findBy.mockReset();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW);
    });

    monitorService.findBy.mockResolvedValue([]);
    monitorService.getEnabledMonitorQuery.mockReturnValue(
      ENABLED_MONITOR_QUERY,
    );
    monitorService.updateColumnsByIdWithoutHooks.mockResolvedValue(undefined);
    monitorService.rewriteLatestIncomingRequestForReaders.mockResolvedValue(
      true,
    );
    projectService.getActiveProjectStatusQuery.mockReturnValue(
      ACTIVE_PROJECT_QUERY,
    );
    monitorResourceMock.mockResolvedValue(undefined);

    trackMock.mockImplementation((input: { receivedAt: Date | string }) => {
      return Promise.resolve(OneUptimeDate.fromString(input.receivedAt));
    });
  });

  test("the sweep loads the secret key that the arrivals are kept under", async () => {
    await runWorkerTick();

    expect(monitorService.findBy).toHaveBeenCalledTimes(1);

    for (const call of monitorService.findBy.mock.calls) {
      const args: FindByArgs = call[0] as FindByArgs;
      expect(args.select["incomingRequestSecretKey"]).toBe(true);
    }
  });

  test("a heartbeat that arrived but is still queued keeps the monitor online", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      heartbeatMonitor(persistedAt(LAST_PERSISTED)),
    ]);

    trackMock.mockResolvedValue(new Date(LAST_ARRIVAL));

    await runWorkerTick();

    expect(trackMock).toHaveBeenCalledTimes(1);
    const trackInput: { secretKey: ObjectID; receivedAt: Date } = trackMock.mock
      .calls[0]![0] as { secretKey: ObjectID; receivedAt: Date };
    expect(trackInput.secretKey.toString()).toBe(SECRET_KEY.toString());
    // The persisted heartbeat is the floor the store is asked to beat.
    expect(new Date(trackInput.receivedAt).getTime()).toBe(
      LAST_PERSISTED.getTime(),
    );

    const payload: IncomingMonitorRequest = evaluatedPayload();
    expect(payload.incomingRequestReceivedAt.getTime()).toBe(
      LAST_ARRIVAL.getTime(),
    );
    expect(payload.checkedAt.getTime()).toBe(NOW.getTime());
    expect(payload.onlyCheckForIncomingRequestReceivedAt).toBe(true);

    // And the real evaluator agrees: received within 5 minutes, not missing.
    await expect(
      IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: payload,
        criteriaFilter: RECEIVED_IN_5_MINUTES,
      }),
    ).resolves.toBeTruthy();
    await expect(
      IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: payload,
        criteriaFilter: NOT_RECEIVED_IN_5_MINUTES,
      }),
    ).resolves.toBeNull();
  });

  /*
   * What the cron used to do: judge the persisted heartbeat, 11 minutes old,
   * which "Not Recieved In Minutes 5" reads as a dead sender.
   */
  test("the persisted heartbeat alone would have read as missing", async () => {
    const stalePayload: IncomingMonitorRequest = {
      projectId: PROJECT_ID,
      monitorId: MONITOR_A_ID,
      incomingRequestReceivedAt: LAST_PERSISTED,
      checkedAt: NOW,
      onlyCheckForIncomingRequestReceivedAt: true,
    };

    await expect(
      IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: stalePayload,
        criteriaFilter: NOT_RECEIVED_IN_5_MINUTES,
      }),
    ).resolves.toContain("not received in 5 minutes");
  });

  test("a sender that really stopped is still judged missing", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      heartbeatMonitor(persistedAt(LAST_PERSISTED)),
    ]);

    // No arrival newer than the persisted heartbeat.
    await runWorkerTick();

    const payload: IncomingMonitorRequest = evaluatedPayload();
    expect(payload.incomingRequestReceivedAt.getTime()).toBe(
      LAST_PERSISTED.getTime(),
    );

    await expect(
      IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: payload,
        criteriaFilter: NOT_RECEIVED_IN_5_MINUTES,
      }),
    ).resolves.toBeTruthy();
  });

  /*
   * On 2026-10-04 the bookkeeping write waited ~11 minutes behind a
   * migration's lock; the page had been read before the wait and was judged
   * against a clock read after it. The arrivals have to be read after that
   * write, right before the evaluation.
   */
  test("reads the arrivals after the bookkeeping write and before the evaluation", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      heartbeatMonitor(persistedAt(LAST_PERSISTED)),
    ]);

    await runWorkerTick();

    const stampOrder: number =
      monitorService.updateColumnsByIdWithoutHooks.mock.invocationCallOrder[0]!;
    const trackOrder: number = trackMock.mock.invocationCallOrder[0]!;
    const evaluationOrder: number =
      monitorResourceMock.mock.invocationCallOrder[0]!;

    expect(stampOrder).toBeLessThan(trackOrder);
    expect(trackOrder).toBeLessThan(evaluationOrder);
  });

  test("the check time is taken after the arrivals are read, so a fresh arrival is never judged against an older clock", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      heartbeatMonitor(persistedAt(LAST_PERSISTED)),
    ]);

    const clock: { now: Date } = { now: new Date(NOW) };
    (OneUptimeDate.getCurrentDate as unknown as jest.Mock).mockImplementation(
      () => {
        return new Date(clock.now);
      },
    );

    // The store read takes a while; the arrival it returns is "now" for it.
    trackMock.mockImplementation(() => {
      clock.now = new Date(NOW.getTime() + 2000);
      return Promise.resolve(new Date(clock.now));
    });

    await runWorkerTick();

    const payload: IncomingMonitorRequest = evaluatedPayload();
    expect(payload.checkedAt.getTime()).toBe(NOW.getTime() + 2000);
    expect(payload.incomingRequestReceivedAt.getTime()).toBe(
      NOW.getTime() + 2000,
    );
  });

  test("an arrival stamped after the check (pod clock skew) is clamped to the check", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      heartbeatMonitor(persistedAt(LAST_PERSISTED)),
    ]);

    trackMock.mockResolvedValue(new Date(NOW.getTime() + 7 * 60 * 1000));

    await runWorkerTick();

    const payload: IncomingMonitorRequest = evaluatedPayload();
    expect(payload.incomingRequestReceivedAt.getTime()).toBe(NOW.getTime());

    await expect(
      IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: payload,
        criteriaFilter: NOT_RECEIVED_IN_5_MINUTES,
      }),
    ).resolves.toBeNull();
  });

  test("a monitor that never received anything registers with its creation time", async () => {
    monitorService.findBy.mockResolvedValueOnce([heartbeatMonitor()]);

    await runWorkerTick();

    const trackInput: { receivedAt: Date } = trackMock.mock.calls[0]![0] as {
      receivedAt: Date;
    };
    expect(new Date(trackInput.receivedAt).getTime()).toBe(
      CREATED_AT.getTime(),
    );
    expect(evaluatedPayload().incomingRequestReceivedAt.getTime()).toBe(
      CREATED_AT.getTime(),
    );
  });

  test("a monitor with no heartbeat criteria is never registered", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      makeMonitor({
        id: MONITOR_A_ID,
        monitorSteps: stepsWithCheckOn(CheckOn.RequestBody),
        incomingRequestSecretKey: SECRET_KEY,
      }),
    ]);

    await runWorkerTick();

    expect(trackMock).not.toHaveBeenCalled();
    expect(monitorResourceMock).not.toHaveBeenCalled();
  });

  test("a monitor without steps never touches the store", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      makeMonitor({ id: MONITOR_A_ID, incomingRequestSecretKey: SECRET_KEY }),
    ]);

    await runWorkerTick();

    expect(trackMock).not.toHaveBeenCalled();
  });

  test("the persisted request's payload is kept; only the arrival time is replaced", async () => {
    const persisted: IncomingMonitorRequest = {
      ...persistedAt(LAST_PERSISTED),
      requestBody: { status: "ok" },
      requestHeaders: { "user-agent": "curl/8.12.1" },
    } as IncomingMonitorRequest;

    monitorService.findBy.mockResolvedValueOnce([heartbeatMonitor(persisted)]);

    trackMock.mockResolvedValue(new Date(LAST_ARRIVAL));

    await runWorkerTick();

    const payload: IncomingMonitorRequest = evaluatedPayload();
    expect(payload.requestBody).toEqual({ status: "ok" });
    expect(payload.requestHeaders).toEqual({ "user-agent": "curl/8.12.1" });
    expect(payload.incomingRequestReceivedAt.getTime()).toBe(
      LAST_ARRIVAL.getTime(),
    );
  });
});

/*
 * An Incoming Request monitor's latest request is kept twice (#6402): as it
 * came, which no role reads, and the copy people read, cut as the
 * monitor's logs are, by its Keep request content switch
 * (LatestIncomingRequest). The heartbeat judges the request again, against
 * criteria that may read its body or its headers: it reads the request as
 * it came, and that one alone (#8906). Every server since 14.0.106 writes
 * the two in one statement, and 16 is upgraded to from 15 only, so the job
 * has no use for the copy people read: it neither reads it nor splits a
 * request kept once in it, which RedactLatestIncomingRequests does.
 */
describe("IncomingRequestMonitor:CheckHeartbeat judges the request as it came, never the copy people read", () => {
  const SECRET_KEY: ObjectID = new ObjectID(
    "6402bbbb-17c4-4b4f-9a3b-3c6ff1a1a2ee",
  );

  const RECEIVED_AT: Date = new Date("2026-07-27T09:58:00.000Z");

  // The deploy hook as its sender sent it.
  function asItCame(
    extra: Partial<IncomingMonitorRequest> = {},
  ): IncomingMonitorRequest {
    return {
      projectId: PROJECT_ID,
      monitorId: MONITOR_A_ID,
      requestMethod: "POST",
      requestHeaders: {
        "content-type": "application/json",
        authorization: "Bearer example-live-token-7f3a9c2b",
      },
      requestBody: { status: "deployed", apiKey: "ak_live_88c1" },
      incomingRequestReceivedAt: RECEIVED_AT,
      checkedAt: RECEIVED_AT,
      onlyCheckForIncomingRequestReceivedAt: false,
      ...extra,
    } as unknown as IncomingMonitorRequest;
  }

  // The copy people read of a monitor that keeps no request content.
  function cutCopy(
    extra: Partial<IncomingMonitorRequest> = {},
  ): IncomingMonitorRequest {
    return {
      projectId: PROJECT_ID,
      monitorId: MONITOR_A_ID,
      requestMethod: "POST",
      incomingRequestReceivedAt: RECEIVED_AT,
      checkedAt: RECEIVED_AT,
      onlyCheckForIncomingRequestReceivedAt: false,
      isResponseContentOmitted: true,
      ...extra,
    } as unknown as IncomingMonitorRequest;
  }

  /*
   * A monitor handed to the job with whichever copies a test gives it, as
   * if its read had returned them: the job must use the right one whatever
   * it is handed.
   */
  function heartbeatMonitor(copies: {
    incomingMonitorRequest?: IncomingMonitorRequest | undefined;
    incomingMonitorRequestAsReceived?: IncomingMonitorRequest | undefined;
    checkOn?: CheckOn | undefined;
  }): Monitor {
    return makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: stepsWithCheckOn(copies.checkOn || CheckOn.IncomingRequest),
      incomingRequestSecretKey: SECRET_KEY,
      incomingMonitorRequest: copies.incomingMonitorRequest,
      incomingMonitorRequestAsReceived: copies.incomingMonitorRequestAsReceived,
    });
  }

  function evaluatedPayload(): IncomingMonitorRequest {
    expect(monitorResourceMock).toHaveBeenCalledTimes(1);
    return monitorResourceMock.mock.calls[0]![0] as IncomingMonitorRequest;
  }

  function trackedFloor(): number {
    expect(trackMock).toHaveBeenCalledTimes(1);
    const trackInput: { receivedAt: Date | string } = trackMock.mock
      .calls[0]![0] as { receivedAt: Date | string };
    return new Date(trackInput.receivedAt).getTime();
  }

  const BODY_SAYS_DEPLOYED: CriteriaFilter = {
    checkOn: CheckOn.RequestBody,
    filterType: FilterType.Contains,
    value: '"status":"deployed"',
  };

  const SIGNED_WITH_THE_LIVE_KEY: CriteriaFilter = {
    checkOn: CheckOn.RequestHeaderValue,
    filterType: FilterType.Contains,
    value: "Bearer example-live-token-7f3a9c2b",
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Results queued for a page a test's sweep never asked for go with it.
    monitorService.findBy.mockReset();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW);
    });

    monitorService.findBy.mockResolvedValue([]);
    monitorService.getEnabledMonitorQuery.mockReturnValue(
      ENABLED_MONITOR_QUERY,
    );
    monitorService.updateColumnsByIdWithoutHooks.mockResolvedValue(undefined);
    monitorService.rewriteLatestIncomingRequestForReaders.mockResolvedValue(
      true,
    );
    projectService.getActiveProjectStatusQuery.mockReturnValue(
      ACTIVE_PROJECT_QUERY,
    );
    monitorResourceMock.mockResolvedValue(undefined);

    trackMock.mockImplementation((input: { receivedAt: Date | string }) => {
      return Promise.resolve(OneUptimeDate.fromString(input.receivedAt));
    });
  });

  test("the sweep reads one copy of the latest request: the request as it came, never the copy people read", async () => {
    await runWorkerTick();

    expect(monitorService.findBy).toHaveBeenCalledTimes(1);

    const args: FindByArgs = monitorService.findBy.mock
      .calls[0]![0] as FindByArgs;

    expect(args.select["incomingMonitorRequestAsReceived"]).toBe(true);
    expect("incomingMonitorRequest" in args.select).toBe(false);
  });

  /*
   * The sweep reads every incoming request monitor every 30 seconds, and a
   * request's copy can hold a body of megabytes. Both copies are JSON
   * columns, so the select holds one JSON column: a second copy of the
   * request, or any other JSON column, read here fails until it is
   * written down below, with why.
   */
  test("the sweep's select is pinned to its columns, and to one JSON column: the request as it came", async () => {
    await runWorkerTick();

    const args: FindByArgs = monitorService.findBy.mock
      .calls[0]![0] as FindByArgs;
    const monitor: Monitor = new Monitor();

    expect(Object.keys(args.select).sort()).toEqual(
      [
        "_id",
        "monitorSteps",
        "incomingMonitorRequestAsReceived",
        "incomingRequestSecretKey",
        "createdAt",
        "projectId",
        "currentMonitorStatusId",
      ].sort(),
    );

    expect(
      Object.keys(args.select).filter((column: string): boolean => {
        return getTableColumn(monitor, column)?.type === TableColumnType.JSON;
      }),
    ).toEqual(["incomingMonitorRequestAsReceived"]);

    // The copy people read is a JSON column too: selected, it would show above.
    expect(getTableColumn(monitor, "incomingMonitorRequest").type).toBe(
      TableColumnType.JSON,
    );
  });

  test("a split request is judged as it came: its headers and its body whole, never the cut copy", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      heartbeatMonitor({
        incomingMonitorRequest: cutCopy(),
        incomingMonitorRequestAsReceived: asItCame(),
      }),
    ]);

    await runWorkerTick();

    const payload: IncomingMonitorRequest = evaluatedPayload();

    expect(payload.requestHeaders).toEqual(asItCame().requestHeaders);
    expect(payload.requestBody).toEqual(asItCame().requestBody);
    expect(payload.isResponseContentOmitted).toBeUndefined();
    expect(payload.onlyCheckForIncomingRequestReceivedAt).toBe(true);
  });

  test("the real criteria agree: a filter on the body or on a header still matches the request the sender sent", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      heartbeatMonitor({
        incomingMonitorRequest: cutCopy(),
        incomingMonitorRequestAsReceived: asItCame(),
      }),
    ]);

    await runWorkerTick();

    const payload: IncomingMonitorRequest = evaluatedPayload();

    await expect(
      IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: payload,
        criteriaFilter: BODY_SAYS_DEPLOYED,
      }),
    ).resolves.toBeTruthy();
    await expect(
      IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: payload,
        criteriaFilter: SIGNED_WITH_THE_LIVE_KEY,
      }),
    ).resolves.toBeTruthy();

    // The cut copy would have failed both.
    await expect(
      IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: {
          ...cutCopy(),
          onlyCheckForIncomingRequestReceivedAt: true,
        },
        criteriaFilter: BODY_SAYS_DEPLOYED,
      }),
    ).resolves.toBeNull();
    await expect(
      IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: {
          ...cutCopy(),
          onlyCheckForIncomingRequestReceivedAt: true,
        },
        criteriaFilter: SIGNED_WITH_THE_LIVE_KEY,
      }),
    ).resolves.toBeNull();
  });

  test("the arrival floor is the request as it came", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      heartbeatMonitor({
        incomingMonitorRequest: cutCopy({
          incomingRequestReceivedAt: new Date("2026-07-27T09:00:00.000Z"),
        }),
        incomingMonitorRequestAsReceived: asItCame(),
      }),
    ]);

    await runWorkerTick();

    expect(trackedFloor()).toBe(RECEIVED_AT.getTime());
  });

  test("a split monitor writes nothing but its stamp", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      heartbeatMonitor({
        incomingMonitorRequest: cutCopy(),
        incomingMonitorRequestAsReceived: asItCame(),
      }),
    ]);

    await runWorkerTick();

    expect(
      monitorService.rewriteLatestIncomingRequestForReaders,
    ).not.toHaveBeenCalled();
    expect(
      stampCalls().map((call: UpdateCallArgs): Array<string> => {
        return Object.keys(call.data);
      }),
    ).toEqual([["incomingRequestMonitorHeartbeatCheckedAt"]]);
  });

  /*
   * No server writes a copy people read later than the request beside it
   * any more: every one since 14.0.106 writes the two together. A copy
   * that says so is still not the request to judge - it is cut - and the
   * job no longer compares the two.
   */
  test("a copy people read is never judged, even one that says it came later than the request beside it", async () => {
    const later: IncomingMonitorRequest = asItCame({
      requestBody: { status: "failed" },
      incomingRequestReceivedAt: new Date("2026-07-27T09:59:30.000Z"),
      checkedAt: new Date("2026-07-27T09:59:31.000Z"),
    });

    monitorService.findBy.mockResolvedValueOnce([
      heartbeatMonitor({
        incomingMonitorRequest: later,
        incomingMonitorRequestAsReceived: asItCame(),
      }),
    ]);

    await runWorkerTick();

    expect(evaluatedPayload().requestBody).toEqual(asItCame().requestBody);
    expect(trackedFloor()).toBe(RECEIVED_AT.getTime());
    expect(
      monitorService.rewriteLatestIncomingRequestForReaders,
    ).not.toHaveBeenCalled();
  });

  /*
   * A request a server older than 14.0.106 kept once, in the copy people
   * read, that nothing has split since: RedactLatestIncomingRequests splits
   * it, as do the monitor's next request and a change of its switch. Here
   * it is a monitor no request has reached, as far as the job can tell.
   */
  test("a request kept once in the copy people read is neither judged nor split here", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      heartbeatMonitor({ incomingMonitorRequest: asItCame() }),
    ]);

    await runWorkerTick();

    expect(
      monitorService.rewriteLatestIncomingRequestForReaders,
    ).not.toHaveBeenCalled();

    const payload: IncomingMonitorRequest = evaluatedPayload();

    expect(payload.requestBody).toBeUndefined();
    expect(payload.requestHeaders).toBeUndefined();
    expect(trackedFloor()).toBe(CREATED_AT.getTime());
    expect(payload.incomingRequestReceivedAt.getTime()).toBe(
      CREATED_AT.getTime(),
    );
  });

  test("a monitor with no heartbeat criteria writes nothing but its stamp, whichever copies it holds", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      heartbeatMonitor({
        incomingMonitorRequest: asItCame(),
        checkOn: CheckOn.RequestBody,
      }),
    ]);

    await runWorkerTick();

    expect(
      monitorService.rewriteLatestIncomingRequestForReaders,
    ).not.toHaveBeenCalled();
    expect(monitorResourceMock).not.toHaveBeenCalled();
    expect(stampCalls()).toHaveLength(1);
  });

  test("a monitor no request reached falls back to its creation time", async () => {
    monitorService.findBy.mockResolvedValueOnce([heartbeatMonitor({})]);

    await runWorkerTick();

    expect(
      monitorService.rewriteLatestIncomingRequestForReaders,
    ).not.toHaveBeenCalled();
    expect(evaluatedPayload().incomingRequestReceivedAt.getTime()).toBe(
      CREATED_AT.getTime(),
    );
  });
});

/*
 * Right after an upgrade from 14.3.0, the last release of 14 - and so from
 * 15, which writes the same rows. 14.3.0 kept every request twice, in one
 * statement (LatestIncomingRequest.toColumns, unchanged since 14.0.106): as
 * it came, and cut for the people who read it by the monitor's Keep request
 * content switch. Its servers write the same two copies while they still
 * run beside this one, during the rollout. The rows below are what such a
 * server left, as Postgres hands jsonb back - ids as their JSON, times as
 * text - and the sweep's read returns only the columns its select names, as
 * Postgres does. Each monitor is judged on the request as its sender sent
 * it, as 14.3.0 judged it, and nothing but the stamp is written.
 */
describe("IncomingRequestMonitor:CheckHeartbeat right after an upgrade from 14.3.0", () => {
  const RECEIVED_AT: string = "2026-07-27T09:58:00.000Z";

  // How jsonb keeps an id.
  function storedId(id: ObjectID): JSONObject {
    return { _type: "ObjectID", value: id.toString() };
  }

  // The request as 14.3.0 kept it as it came.
  function asReceivedBy14(monitorId: ObjectID, status: string): JSONObject {
    return {
      projectId: storedId(PROJECT_ID),
      monitorId: storedId(monitorId),
      requestMethod: "POST",
      requestHeaders: {
        "content-type": "application/json",
        authorization: "Bearer example-live-token-7f3a9c2b",
      },
      requestBody: { status: status, apiKey: "ak_live_88c1" },
      incomingRequestReceivedAt: RECEIVED_AT,
      checkedAt: RECEIVED_AT,
      onlyCheckForIncomingRequestReceivedAt: false,
    };
  }

  // The copy 14.3.0 wrote beside it for people to read, content kept: masked.
  function readersCopyBy14(monitorId: ObjectID, status: string): JSONObject {
    return {
      projectId: storedId(PROJECT_ID),
      monitorId: storedId(monitorId),
      requestMethod: "POST",
      requestHeaders: {
        "content-type": "application/json",
        authorization: "[REDACTED]",
      },
      requestBody: { status: status, apiKey: "[REDACTED]" },
      incomingRequestReceivedAt: RECEIVED_AT,
      checkedAt: RECEIVED_AT,
      onlyCheckForIncomingRequestReceivedAt: false,
    };
  }

  // The same, for a monitor that keeps no request content.
  function readersCopyWithoutContentBy14(monitorId: ObjectID): JSONObject {
    return {
      projectId: storedId(PROJECT_ID),
      monitorId: storedId(monitorId),
      requestMethod: "POST",
      incomingRequestReceivedAt: RECEIVED_AT,
      checkedAt: RECEIVED_AT,
      onlyCheckForIncomingRequestReceivedAt: false,
      isResponseContentOmitted: true,
    };
  }

  const RECEIVED_IN_5_MINUTES: CriteriaFilter = {
    checkOn: CheckOn.IncomingRequest,
    filterType: FilterType.RecievedInMinutes,
    value: 5,
  };

  const BODY_SAYS_DEPLOYED: CriteriaFilter = {
    checkOn: CheckOn.RequestBody,
    filterType: FilterType.Contains,
    value: '"status":"deployed"',
  };

  const SIGNED_WITH_THE_LIVE_KEY: CriteriaFilter = {
    checkOn: CheckOn.RequestHeaderValue,
    filterType: FilterType.Contains,
    value: "Bearer example-live-token-7f3a9c2b",
  };

  // Received in 5 minutes, and a body and a header the sender sends.
  function heartbeatSteps(): MonitorSteps {
    return {
      data: {
        monitorStepsInstanceArray: [
          {
            data: {
              monitorCriteria: {
                data: {
                  monitorCriteriaInstanceArray: [
                    {
                      data: {
                        filters: [
                          RECEIVED_IN_5_MINUTES,
                          BODY_SAYS_DEPLOYED,
                          SIGNED_WITH_THE_LIVE_KEY,
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    } as unknown as MonitorSteps;
  }

  // A Monitor row as 14.3.0 left it, every column it wrote.
  type StoredRow = Record<string, unknown>;

  function rowBy14(data: {
    id: ObjectID;
    keepResponseContent: boolean;
    status?: string;
  }): StoredRow {
    const status: string = data.status || "deployed";

    return {
      _id: data.id.toString(),
      projectId: PROJECT_ID,
      createdAt: CREATED_AT,
      monitorSteps: heartbeatSteps(),
      keepResponseContent: data.keepResponseContent,
      incomingRequestSecretKey: new ObjectID(`secret-${data.id.toString()}`),
      currentMonitorStatusId: new ObjectID("status-online"),
      incomingRequestMonitorHeartbeatCheckedAt: new Date(RECEIVED_AT),
      incomingMonitorRequestAsReceived: asReceivedBy14(data.id, status),
      incomingMonitorRequest: data.keepResponseContent
        ? readersCopyBy14(data.id, status)
        : readersCopyWithoutContentBy14(data.id),
    };
  }

  // What the sweep's read returns of a row: the columns its select names.
  function readAsSelected(
    row: StoredRow,
    select: Record<string, unknown>,
  ): Monitor {
    const monitor: Monitor = new Monitor(new ObjectID(row["_id"] as string));

    for (const column of Object.keys(select)) {
      if (select[column] && column !== "_id" && column in row) {
        (monitor as unknown as Record<string, unknown>)[column] = row[column];
      }
    }

    return monitor;
  }

  function stored(rows: Array<StoredRow>): void {
    monitorService.findBy.mockImplementationOnce((args: FindByArgs) => {
      return Promise.resolve(
        rows.map((row: StoredRow): Monitor => {
          return readAsSelected(row, args.select);
        }),
      );
    });
  }

  function judged(): Array<IncomingMonitorRequest> {
    return monitorResourceMock.mock.calls.map(
      (call: Array<unknown>): IncomingMonitorRequest => {
        return call[0] as IncomingMonitorRequest;
      },
    );
  }

  function judgedFor(monitorId: ObjectID): IncomingMonitorRequest {
    const payload: IncomingMonitorRequest | undefined = judged().find(
      (request: IncomingMonitorRequest): boolean => {
        return request.monitorId.toString() === monitorId.toString();
      },
    );

    expect(payload).toBeDefined();
    return payload!;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Results queued for a page a test's sweep never asked for go with it.
    monitorService.findBy.mockReset();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW);
    });

    monitorService.findBy.mockResolvedValue([]);
    monitorService.getEnabledMonitorQuery.mockReturnValue(
      ENABLED_MONITOR_QUERY,
    );
    monitorService.updateColumnsByIdWithoutHooks.mockResolvedValue(undefined);
    monitorService.rewriteLatestIncomingRequestForReaders.mockResolvedValue(
      true,
    );
    projectService.getActiveProjectStatusQuery.mockReturnValue(
      ACTIVE_PROJECT_QUERY,
    );
    monitorResourceMock.mockResolvedValue(undefined);

    // No arrival newer than the one the row holds.
    trackMock.mockImplementation((input: { receivedAt: Date | string }) => {
      return Promise.resolve(OneUptimeDate.fromString(input.receivedAt));
    });
  });

  test("a monitor that keeps its request content is judged on the request as its sender sent it", async () => {
    stored([rowBy14({ id: MONITOR_A_ID, keepResponseContent: true })]);

    await runWorkerTick();

    const payload: IncomingMonitorRequest = judgedFor(MONITOR_A_ID);

    expect(payload.requestBody).toEqual({
      status: "deployed",
      apiKey: "ak_live_88c1",
    });
    expect(payload.requestHeaders).toEqual({
      "content-type": "application/json",
      authorization: "Bearer example-live-token-7f3a9c2b",
    });
    expect(JSON.stringify(payload)).not.toContain("[REDACTED]");
  });

  test("a monitor that keeps no request content is judged on the headers and the body its sender sent too", async () => {
    stored([rowBy14({ id: MONITOR_B_ID, keepResponseContent: false })]);

    await runWorkerTick();

    const payload: IncomingMonitorRequest = judgedFor(MONITOR_B_ID);

    expect(payload.isResponseContentOmitted).toBeUndefined();
    expect(payload.requestBody).toEqual({
      status: "deployed",
      apiKey: "ak_live_88c1",
    });
    expect(payload.requestHeaders?.["authorization"]).toBe(
      "Bearer example-live-token-7f3a9c2b",
    );
  });

  test("the real criteria judge both as 14.3.0 did: received in time, the body and the header met", async () => {
    stored([
      rowBy14({ id: MONITOR_A_ID, keepResponseContent: true }),
      rowBy14({ id: MONITOR_B_ID, keepResponseContent: false }),
    ]);

    await runWorkerTick();

    expect(judged()).toHaveLength(2);

    for (const payload of judged()) {
      // Received two minutes before the sweep, by the row's own time.
      expect(payload.incomingRequestReceivedAt.getTime()).toBe(
        new Date(RECEIVED_AT).getTime(),
      );
      expect(payload.checkedAt.getTime()).toBe(NOW.getTime());

      for (const filter of [
        RECEIVED_IN_5_MINUTES,
        BODY_SAYS_DEPLOYED,
        SIGNED_WITH_THE_LIVE_KEY,
      ]) {
        await expect(
          IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
            dataToProcess: payload,
            criteriaFilter: filter,
          }),
        ).resolves.toBeTruthy();
      }
    }
  });

  test("the copy people read never reaches the job: the read leaves it in the row", async () => {
    const seen: Array<Monitor> = [];

    monitorService.findBy.mockImplementationOnce((args: FindByArgs) => {
      const monitors: Array<Monitor> = [
        rowBy14({ id: MONITOR_A_ID, keepResponseContent: true }),
      ].map((row: StoredRow): Monitor => {
        return readAsSelected(row, args.select);
      });
      seen.push(...monitors);
      return Promise.resolve(monitors);
    });

    await runWorkerTick();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.incomingMonitorRequest).toBeUndefined();
    expect(seen[0]!.incomingMonitorRequestAsReceived).toBeDefined();
    expect(judgedFor(MONITOR_A_ID).requestBody).toEqual({
      status: "deployed",
      apiKey: "ak_live_88c1",
    });
  });

  test("the arrival floor is the time 14.3.0 kept, and an arrival the store has since is judged", async () => {
    const arrivedSince: Date = new Date(NOW.getTime() - 20 * 1000);

    stored([rowBy14({ id: MONITOR_A_ID, keepResponseContent: true })]);
    trackMock.mockResolvedValue(new Date(arrivedSince));

    await runWorkerTick();

    const trackInput: { secretKey: ObjectID; receivedAt: Date | string } =
      trackMock.mock.calls[0]![0] as {
        secretKey: ObjectID;
        receivedAt: Date | string;
      };

    expect(new Date(trackInput.receivedAt).getTime()).toBe(
      new Date(RECEIVED_AT).getTime(),
    );
    expect(trackInput.secretKey.toString()).toBe(
      `secret-${MONITOR_A_ID.toString()}`,
    );
    expect(judgedFor(MONITOR_A_ID).incomingRequestReceivedAt.getTime()).toBe(
      arrivedSince.getTime(),
    );
  });

  test("nothing is written but each monitor's stamp: no monitor is split again", async () => {
    stored([
      rowBy14({ id: MONITOR_A_ID, keepResponseContent: true }),
      rowBy14({ id: MONITOR_B_ID, keepResponseContent: false }),
    ]);

    await runWorkerTick();

    expect(
      monitorService.rewriteLatestIncomingRequestForReaders,
    ).not.toHaveBeenCalled();
    expect(monitorService.updateOneById).not.toHaveBeenCalled();
    expect(
      stampCalls().map((call: UpdateCallArgs): Array<string> => {
        return Object.keys(call.data);
      }),
    ).toEqual([
      ["incomingRequestMonitorHeartbeatCheckedAt"],
      ["incomingRequestMonitorHeartbeatCheckedAt"],
    ]);
  });

  /*
   * During the rollout a 14.3.0 server still takes requests, and writes
   * both copies of each one at once: the next sweep judges the new one.
   */
  test("a request a 14.3.0 server takes during the rollout is judged at the next sweep", async () => {
    stored([rowBy14({ id: MONITOR_A_ID, keepResponseContent: false })]);
    await runWorkerTick();

    stored([
      rowBy14({
        id: MONITOR_A_ID,
        keepResponseContent: false,
        status: "failed",
      }),
    ]);
    await runWorkerTick();

    expect(judged()).toHaveLength(2);
    expect(judged()[1]!.requestBody).toEqual({
      status: "failed",
      apiKey: "ak_live_88c1",
    });
    await expect(
      IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: judged()[1]!,
        criteriaFilter: BODY_SAYS_DEPLOYED,
      }),
    ).resolves.toBeNull();
  });
});

/*
 * The sweep visited every incoming request monitor every 30 seconds, wrote
 * its row, and evaluated it. It now writes the "status checked at" stamp at
 * most every few minutes, and evaluates a monitor only when something its
 * criteria judge can have changed since its last evaluation
 * (MonitorHeartbeatState): a new request, other criteria, another status,
 * or a heartbeat window that has passed. Redis is a map here.
 */
describe("IncomingRequestMonitor:CheckHeartbeat writes and evaluates only when something can have changed", () => {
  const ARRIVED_AT: Date = new Date(NOW.getTime() - 60 * 1000);
  const ONLINE: ObjectID = new ObjectID("status-online");
  const OFFLINE: ObjectID = new ObjectID("status-offline");

  let redis: Map<string, string>;
  let redisFails: boolean;
  let clock: Date;

  function filter(values: Partial<CriteriaFilter>): CriteriaFilter {
    return {
      checkOn: CheckOn.IncomingRequest,
      filterType: FilterType.RecievedInMinutes,
      value: 5,
      ...values,
    } as CriteriaFilter;
  }

  // Received in N minutes / not received in N minutes, and any others.
  function stepsWithWindow(
    minutes: number,
    others: Array<CriteriaFilter> = [],
  ): MonitorSteps {
    return {
      data: {
        monitorStepsInstanceArray: [
          {
            data: {
              monitorCriteria: {
                data: {
                  monitorCriteriaInstanceArray: [
                    {
                      data: {
                        filters: [filter({ value: minutes }), ...others],
                      },
                    },
                    {
                      data: {
                        filters: [
                          filter({
                            filterType: FilterType.NotRecievedInMinutes,
                            value: minutes,
                          }),
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    } as unknown as MonitorSteps;
  }

  function heartbeatMonitor(
    values: {
      monitorSteps?: MonitorSteps;
      status?: ObjectID;
      id?: ObjectID;
    } = {},
  ): Monitor {
    const monitor: Monitor = makeMonitor({
      id: values.id || MONITOR_A_ID,
      monitorSteps: values.monitorSteps || stepsWithWindow(5),
      incomingMonitorRequestAsReceived: {
        projectId: PROJECT_ID,
        monitorId: values.id || MONITOR_A_ID,
        requestHeaders: {},
        requestBody: {},
        incomingRequestReceivedAt: ARRIVED_AT,
        checkedAt: ARRIVED_AT,
      },
      incomingRequestSecretKey: new ObjectID("secret-a"),
    });
    monitor.currentMonitorStatusId = values.status || ONLINE;
    return monitor;
  }

  // What MonitorResource records after evaluating a request (mocked here).
  async function evaluatedBefore(
    monitor: Monitor,
    receivedAt: Date = ARRIVED_AT,
  ): Promise<void> {
    await MonitorHeartbeatState.markEvaluated({
      kind: HeartbeatKind.IncomingRequest,
      monitorId: monitor.id!,
      receivedAt: receivedAt,
      monitorSteps: monitor.monitorSteps,
      monitorStatusId: monitor.currentMonitorStatusId,
    });
  }

  async function sweepAt(at: Date, monitors: Array<Monitor>): Promise<void> {
    clock = at;
    monitorService.findBy.mockResolvedValueOnce(monitors);
    await runWorkerTick();
  }

  function expireFences(): void {
    for (const name of Array.from(redis.keys())) {
      if (name.includes("-write-")) {
        redis.delete(name);
      }
    }
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Results queued for a page a test's sweep never asked for go with it.
    monitorService.findBy.mockReset();

    redis = new Map<string, string>();
    redisFails = false;
    clock = NOW;

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(clock);
    });

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
        async (namespace: string, key: string, value: string) => {
          if (redisFails) {
            throw new Error("Redis is down");
          }

          redis.set(`${namespace}-${key}`, value);
        },
      );

    monitorService.findBy.mockResolvedValue([]);
    monitorService.getEnabledMonitorQuery.mockReturnValue(
      ENABLED_MONITOR_QUERY,
    );
    monitorService.updateColumnsByIdWithoutHooks.mockResolvedValue(undefined);
    monitorService.rewriteLatestIncomingRequestForReaders.mockResolvedValue(
      true,
    );
    projectService.getActiveProjectStatusQuery.mockReturnValue(
      ACTIVE_PROJECT_QUERY,
    );
    monitorResourceMock.mockResolvedValue(undefined);

    // No arrival newer than the one the monitor's row holds.
    trackMock.mockImplementation((input: { receivedAt: Date | string }) => {
      return Promise.resolve(OneUptimeDate.fromString(input.receivedAt));
    });
  });

  test("the status-check stamp is written at most every few minutes", async () => {
    const monitor: Monitor = heartbeatMonitor();

    await sweepAt(NOW, [monitor]);
    await sweepAt(new Date(NOW.getTime() + 30 * 1000), [monitor]);

    expect(stampCalls()).toHaveLength(1);

    expireFences();
    await sweepAt(new Date(NOW.getTime() + 60 * 1000), [monitor]);

    expect(stampCalls()).toHaveLength(2);
    expect(MonitorHeartbeatState.CHECK_STAMP_WRITE_EVERY_SECONDS).toBe(300);
  });

  test("a monitor whose latest request was evaluated is not evaluated again inside its window", async () => {
    const monitor: Monitor = heartbeatMonitor();
    await evaluatedBefore(monitor);

    await sweepAt(NOW, [monitor]);

    expect(monitorResourceMock).not.toHaveBeenCalled();
  });

  test("a sender that stops is judged missing in the first sweep after its window, as before", async () => {
    const monitor: Monitor = heartbeatMonitor();
    await evaluatedBefore(monitor);

    // Every 30 seconds until the 5-minute window has passed since the request.
    for (
      let at: number = ARRIVED_AT.getTime() + 30 * 1000;
      at < ARRIVED_AT.getTime() + 5 * 60 * 1000;
      at += 30 * 1000
    ) {
      await sweepAt(new Date(at), [monitor]);
    }

    expect(monitorResourceMock).not.toHaveBeenCalled();

    await sweepAt(new Date(ARRIVED_AT.getTime() + 5 * 60 * 1000), [monitor]);

    expect(monitorResourceMock).toHaveBeenCalledTimes(1);
    const judged: IncomingMonitorRequest = monitorResourceMock.mock
      .calls[0]![0] as IncomingMonitorRequest;
    expect(
      OneUptimeDate.fromString(judged.incomingRequestReceivedAt).getTime(),
    ).toBe(ARRIVED_AT.getTime());

    // And on every sweep after it, as before.
    await sweepAt(new Date(ARRIVED_AT.getTime() + 5.5 * 60 * 1000), [monitor]);
    expect(monitorResourceMock).toHaveBeenCalledTimes(2);
  });

  test("a request that arrived after the one evaluated is evaluated", async () => {
    const monitor: Monitor = heartbeatMonitor();
    await evaluatedBefore(monitor);

    // A newer arrival the endpoint saw; its own job has not run yet.
    trackMock.mockResolvedValue(new Date(NOW.getTime() - 5 * 1000));

    await sweepAt(NOW, [monitor]);

    expect(monitorResourceMock).toHaveBeenCalledTimes(1);
  });

  test("criteria edited since the last evaluation are evaluated", async () => {
    const monitor: Monitor = heartbeatMonitor();
    await evaluatedBefore(monitor);

    monitor.monitorSteps = stepsWithWindow(10);
    await sweepAt(NOW, [monitor]);

    expect(monitorResourceMock).toHaveBeenCalledTimes(1);
  });

  test("a status changed since the last evaluation is evaluated", async () => {
    const monitor: Monitor = heartbeatMonitor({ status: ONLINE });
    await evaluatedBefore(monitor);

    // Someone set the monitor's status by hand, or a maintenance event did.
    monitor.currentMonitorStatusId = OFFLINE;
    await sweepAt(NOW, [monitor]);

    expect(monitorResourceMock).toHaveBeenCalledTimes(1);
  });

  test("a monitor nothing was evaluated for is evaluated", async () => {
    await sweepAt(NOW, [heartbeatMonitor()]);

    expect(monitorResourceMock).toHaveBeenCalledTimes(1);
  });

  test("a monitor whose criteria judge more than requests is evaluated every sweep", async () => {
    const monitor: Monitor = heartbeatMonitor({
      monitorSteps: stepsWithWindow(5, [
        filter({ checkOn: CheckOn.JavaScriptExpression, value: "true" }),
      ]),
    });
    await evaluatedBefore(monitor);

    await sweepAt(NOW, [monitor]);

    expect(monitorResourceMock).toHaveBeenCalledTimes(1);
  });

  test("a Redis that cannot be reached stamps every visit and evaluates every sweep, as before", async () => {
    const monitor: Monitor = heartbeatMonitor();
    await evaluatedBefore(monitor);
    redisFails = true;

    await sweepAt(NOW, [monitor]);
    await sweepAt(new Date(NOW.getTime() + 30 * 1000), [monitor]);

    expect(stampCalls()).toHaveLength(2);
    expect(monitorResourceMock).toHaveBeenCalledTimes(2);
  });

  test("the sweep reads each monitor's status, to compare with its last evaluation", async () => {
    await runWorkerTick();

    const args: FindByArgs = monitorService.findBy.mock
      .calls[0]![0] as FindByArgs;
    expect(args.select["currentMonitorStatusId"]).toBe(true);
  });
});
