import Monitor from "Common/Models/DatabaseModels/Monitor";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import IncomingEmailMonitorRequest from "Common/Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import OnCallPageTiming from "Common/Server/Utils/OnCall/OnCallPageTiming";

/*
 * Regression tests for the IncomingEmailMonitor:CheckOnlineStatus cron's write
 * path — the email twin of IncomingRequestMonitor:CheckHeartbeat. The
 * heartbeat bookkeeping stamp is written for EVERY incoming-email monitor
 * every 30 seconds; it used to go through updateOneById, whose full pipeline
 * is ~4 statements per row plus — because Monitor is @EnableWorkflow +
 * @EnableAuditLog — an on-update workflow HTTP trigger and an audit-log
 * insert per monitor per tick. The perf fix rewired the stamp to the
 * single-UPDATE updateColumnsByIdWithoutHooks fast path. These tests pin:
 *   1. the stamp goes through the hookless fast path with EXACTLY the
 *      incomingEmailMonitorHeartbeatCheckedAt column, and updateOneById is
 *      never called (the regression the change removes),
 *   2. the per-monitor control flow around the stamp: one findBy query
 *      by type, paged by id, visits every monitor once; a monitor without
 *      monitorSteps is skipped with no write; only a monitor whose criteria check CheckOn.EmailReceivedAt
 *      (NOT the request monitor's CheckOn.IncomingRequest) is handed to
 *      MonitorResourceUtil.monitorResource; one failing monitor does not
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

import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import MonitorService from "Common/Server/Services/MonitorService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import MonitorHeartbeatState, {
  HeartbeatKind,
} from "Common/Server/Utils/Monitor/MonitorHeartbeatState";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/IncomingEmailMonitor/CheckOnlineStatus";

interface MonitorServiceMock {
  findBy: jest.Mock;
  getEnabledMonitorQuery: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
  updateOneById: jest.Mock;
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
  incomingEmailMonitorRequest?: IncomingEmailMonitorRequest | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor(data.id);
  monitor.projectId = PROJECT_ID;
  monitor.createdAt = CREATED_AT;

  if (data.monitorSteps) {
    monitor.monitorSteps = data.monitorSteps;
  }

  if (data.incomingEmailMonitorRequest) {
    monitor.incomingEmailMonitorRequest = data.incomingEmailMonitorRequest;
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
    mockCapturedJobs["IncomingEmailMonitor:CheckOnlineStatus"];

  if (!handler) {
    throw new Error(
      "IncomingEmailMonitor:CheckOnlineStatus did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler();
}

describe("IncomingEmailMonitor:CheckOnlineStatus worker", () => {
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
    projectService.getActiveProjectStatusQuery.mockReturnValue(
      ACTIVE_PROJECT_QUERY,
    );
    monitorResourceMock.mockResolvedValue(undefined);
  });

  test("visits every incoming email monitor once, with one query by type, and stamps each through the hookless fast path only", async () => {
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

    expect(batch.query["monitorType"]).toBe(MonitorType.IncomingEmail);
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
        "incomingEmailMonitorHeartbeatCheckedAt",
      ]);
      expect(
        (
          stamp.data["incomingEmailMonitorHeartbeatCheckedAt"] as Date
        ).getTime(),
      ).toBe(NOW.getTime());
    }

    // THE regression this change removed: the full hooked pipeline per tick.
    expect(monitorService.updateOneById).not.toHaveBeenCalled();
  });

  test("the cron waits for bounded email evaluations before completing", async () => {
    const rows: Array<Monitor> = Array.from(
      { length: 25 },
      (_: unknown, index: number) => {
        return makeMonitor({
          id: new ObjectID(`monitor-${String(index).padStart(3, "0")}`),
          monitorSteps: stepsWithCheckOn(CheckOn.EmailReceivedAt),
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
      expect("incomingEmailMonitorHeartbeatCheckedAt" in args.query).toBe(
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

  test("criteria checking CheckOn.EmailReceivedAt hand the monitor to monitorResource with the incoming-email payload", async () => {
    const receivedAt: Date = new Date("2026-07-27T09:55:00.000Z");
    const monitor: Monitor = makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.EmailReceivedAt),
      incomingEmailMonitorRequest: {
        emailReceivedAt: receivedAt,
        emailFrom: "alerts@acme.dev",
      } as IncomingEmailMonitorRequest,
    });

    monitorService.findBy.mockResolvedValueOnce([monitor]);

    await runWorkerTick();

    expect(monitorResourceMock).toHaveBeenCalledTimes(1);

    const payload: IncomingEmailMonitorRequest = monitorResourceMock.mock
      .calls[0]![0] as IncomingEmailMonitorRequest;

    expect(payload.monitorId.toString()).toBe(MONITOR_A_ID.toString());
    expect(payload.projectId.toString()).toBe(PROJECT_ID.toString());
    // the worker-side check only validates liveness, never re-runs criteria.
    expect(payload.onlyCheckForIncomingEmailReceivedAt).toBe(true);
    expect(payload.emailReceivedAt.getTime()).toBe(receivedAt.getTime());
    expect(payload.checkedAt.getTime()).toBe(NOW.getTime());
    expect(payload.emailFrom).toBe("alerts@acme.dev");
    // unset email fields are defaulted to empty strings, not undefined.
    expect(payload.emailTo).toBe("");
    expect(payload.emailSubject).toBe("");
    expect(payload.emailBody).toBe("");

    // the heartbeat stamp is written BEFORE the resource evaluation.
    expect(
      monitorService.updateColumnsByIdWithoutHooks.mock.invocationCallOrder[0],
    ).toBeLessThan(monitorResourceMock.mock.invocationCallOrder[0]!);
  });

  /*
   * The stored request now carries when OneUptime received the last email
   * (dataReceivedAt, issue #6647), and rides along on this check. A page
   * the check starts is still timed from the record's creation: its moment
   * is the last email's, long before what it found.
   */
  test("a check that no email came is not timed from when the last email was received", async () => {
    const lastEmailReceivedAt: Date = new Date("2026-07-27T09:55:01.000Z");
    const monitor: Monitor = makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.EmailReceivedAt),
      incomingEmailMonitorRequest: {
        emailReceivedAt: new Date("2026-07-27T09:55:00.000Z"),
        dataReceivedAt: lastEmailReceivedAt,
        emailFrom: "alerts@acme.dev",
      } as IncomingEmailMonitorRequest,
    });

    monitorService.findBy.mockResolvedValueOnce([monitor]);

    await runWorkerTick();

    const payload: IncomingEmailMonitorRequest = monitorResourceMock.mock
      .calls[0]![0] as IncomingEmailMonitorRequest;

    expect(payload.onlyCheckForIncomingEmailReceivedAt).toBe(true);
    expect(OnCallPageTiming.getMonitorDataReceivedAt(payload)).toBeUndefined();
  });

  test("a monitor that never received an email falls back to createdAt as the received timestamp", async () => {
    const monitor: Monitor = makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.EmailReceivedAt),
    });

    monitorService.findBy.mockResolvedValueOnce([monitor]);

    await runWorkerTick();

    const payload: IncomingEmailMonitorRequest = monitorResourceMock.mock
      .calls[0]![0] as IncomingEmailMonitorRequest;

    expect(payload.emailReceivedAt.getTime()).toBe(CREATED_AT.getTime());
  });

  test("criteria checking only CheckOn.IncomingRequest (the request monitor's filter) are stamped but never evaluated", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      makeMonitor({
        id: MONITOR_A_ID,
        monitorSteps: stepsWithCheckOn(CheckOn.IncomingRequest),
      }),
    ]);

    await runWorkerTick();

    expect(monitorService.updateColumnsByIdWithoutHooks).toHaveBeenCalledTimes(
      1,
    );
    expect(monitorResourceMock).not.toHaveBeenCalled();
  });

  /*
   * The out-of-the-box criteria for this monitor type check the EMAIL BODY,
   * not the arrival clock, so a monitor left on its defaults has nothing for
   * this cron to re-evaluate: it is stamped and skipped, and its status is
   * decided only when mail actually lands. Users who want a missing-email
   * alarm add a CheckOn.EmailReceivedAt criteria by hand, which the test
   * above covers.
   */
  test("a monitor on the default body criteria is stamped but never evaluated", async () => {
    monitorService.findBy.mockResolvedValueOnce([
      makeMonitor({
        id: MONITOR_A_ID,
        monitorSteps: stepsWithCheckOn(
          MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
            monitorType: MonitorType.IncomingEmail,
            monitorStatusId: new ObjectID("online-status"),
            monitorName: "Nightly Backup",
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
      monitorSteps: stepsWithCheckOn(CheckOn.EmailReceivedAt),
    });
    const healthy: Monitor = makeMonitor({
      id: MONITOR_B_ID,
      monitorSteps: stepsWithCheckOn(CheckOn.EmailReceivedAt),
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

    const payload: IncomingEmailMonitorRequest = monitorResourceMock.mock
      .calls[0]![0] as IncomingEmailMonitorRequest;
    expect(payload.monitorId.toString()).toBe(MONITOR_B_ID.toString());
  });
});

/*
 * The sweep visited every incoming email monitor every 30 seconds, wrote its
 * row, and evaluated it. It now writes the "status checked at" stamp at
 * most every few minutes, and evaluates a monitor only when something its
 * criteria judge can have changed since its last evaluation
 * (MonitorHeartbeatState): a new email, other criteria, another status, or
 * a heartbeat window that has passed. Redis is a map here.
 */
describe("IncomingEmailMonitor:CheckOnlineStatus writes and evaluates only when something can have changed", () => {
  const RECEIVED_AT: Date = new Date(NOW.getTime() - 10 * 60 * 1000);
  const ONLINE: ObjectID = new ObjectID("status-online");
  const OFFLINE: ObjectID = new ObjectID("status-offline");

  let redis: Map<string, string>;
  let redisFails: boolean;
  let clock: Date;

  function emailFilter(values: Partial<CriteriaFilter>): CriteriaFilter {
    return {
      checkOn: CheckOn.EmailReceivedAt,
      filterType: FilterType.RecievedInMinutes,
      value: 60,
      ...values,
    } as CriteriaFilter;
  }

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
                        filters: [emailFilter({ value: minutes }), ...others],
                      },
                    },
                    {
                      data: {
                        filters: [
                          emailFilter({
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

  function emailMonitor(
    values: { monitorSteps?: MonitorSteps; status?: ObjectID } = {},
  ): Monitor {
    const monitor: Monitor = makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: values.monitorSteps || stepsWithWindow(60),
      incomingEmailMonitorRequest: {
        projectId: PROJECT_ID,
        monitorId: MONITOR_A_ID,
        emailFrom: "backup@example.com",
        emailTo: "monitor@example.com",
        emailSubject: "Backup OK",
        emailBody: "OK",
        emailReceivedAt: RECEIVED_AT,
        checkedAt: RECEIVED_AT,
      },
    });
    monitor.currentMonitorStatusId = values.status || ONLINE;
    return monitor;
  }

  // What MonitorResource records after evaluating an email (mocked here).
  async function evaluatedBefore(monitor: Monitor): Promise<void> {
    await MonitorHeartbeatState.markEvaluated({
      kind: HeartbeatKind.IncomingEmail,
      monitorId: monitor.id!,
      receivedAt: RECEIVED_AT,
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
    projectService.getActiveProjectStatusQuery.mockReturnValue(
      ACTIVE_PROJECT_QUERY,
    );
    monitorResourceMock.mockResolvedValue(undefined);
  });

  test("the status-check stamp is written at most every few minutes", async () => {
    const monitor: Monitor = emailMonitor();

    await sweepAt(NOW, [monitor]);
    await sweepAt(new Date(NOW.getTime() + 30 * 1000), [monitor]);

    expect(stampCalls()).toHaveLength(1);

    expireFences();
    await sweepAt(new Date(NOW.getTime() + 60 * 1000), [monitor]);

    expect(stampCalls()).toHaveLength(2);
  });

  test("a monitor whose latest email was evaluated is not evaluated again inside its window", async () => {
    const monitor: Monitor = emailMonitor();
    await evaluatedBefore(monitor);

    await sweepAt(NOW, [monitor]);

    expect(monitorResourceMock).not.toHaveBeenCalled();
  });

  test("an inbox that stops getting email is judged missing in the first sweep after its window, as before", async () => {
    const monitor: Monitor = emailMonitor({
      monitorSteps: stepsWithWindow(15),
    });
    await evaluatedBefore(monitor);

    await sweepAt(new Date(RECEIVED_AT.getTime() + 14.5 * 60 * 1000), [
      monitor,
    ]);
    expect(monitorResourceMock).not.toHaveBeenCalled();

    await sweepAt(new Date(RECEIVED_AT.getTime() + 15 * 60 * 1000), [monitor]);
    expect(monitorResourceMock).toHaveBeenCalledTimes(1);

    await sweepAt(new Date(RECEIVED_AT.getTime() + 15.5 * 60 * 1000), [
      monitor,
    ]);
    expect(monitorResourceMock).toHaveBeenCalledTimes(2);
  });

  test("criteria edited, a status changed, or nothing evaluated: evaluated", async () => {
    const edited: Monitor = emailMonitor();
    await evaluatedBefore(edited);
    edited.monitorSteps = stepsWithWindow(120);
    await sweepAt(NOW, [edited]);
    expect(monitorResourceMock).toHaveBeenCalledTimes(1);

    redis.clear();
    const changed: Monitor = emailMonitor({ status: ONLINE });
    await evaluatedBefore(changed);
    changed.currentMonitorStatusId = OFFLINE;
    await sweepAt(NOW, [changed]);
    expect(monitorResourceMock).toHaveBeenCalledTimes(2);

    redis.clear();
    await sweepAt(NOW, [emailMonitor()]);
    expect(monitorResourceMock).toHaveBeenCalledTimes(3);
  });

  test("a monitor whose criteria judge more than emails is evaluated every sweep", async () => {
    const monitor: Monitor = emailMonitor({
      monitorSteps: stepsWithWindow(60, [
        emailFilter({ checkOn: CheckOn.JavaScriptExpression, value: "true" }),
      ]),
    });
    await evaluatedBefore(monitor);

    await sweepAt(NOW, [monitor]);

    expect(monitorResourceMock).toHaveBeenCalledTimes(1);
  });

  test("a Redis that cannot be reached stamps every visit and evaluates every sweep, as before", async () => {
    const monitor: Monitor = emailMonitor();
    await evaluatedBefore(monitor);
    redisFails = true;

    await sweepAt(NOW, [monitor]);
    await sweepAt(new Date(NOW.getTime() + 30 * 1000), [monitor]);

    expect(stampCalls()).toHaveLength(2);
    expect(monitorResourceMock).toHaveBeenCalledTimes(2);
  });
});
