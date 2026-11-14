import Monitor from "Common/Models/DatabaseModels/Monitor";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import ObjectID from "Common/Types/ObjectID";
import { FindOperator } from "typeorm";

/*
 * Regression tests for the telemetry-monitor scheduler's write path
 * (enqueueDueTelemetryMonitorEvaluationJobs, the EVERY_MINUTE cron body
 * registered by ScheduleTelemetryMonitorEvaluations.ts). The scheduler bumps
 * telemetryMonitorLastMonitorAt / telemetryMonitorNextMonitorAt for every due
 * telemetry/infra monitor every minute; those stamps used to go through
 * updateOneById, whose full pipeline is ~4 statements per row plus — because
 * Monitor is @EnableWorkflow + @EnableAuditLog — an on-update workflow HTTP
 * trigger and an audit-log insert per monitor per tick. The perf fix rewired
 * them to the single-UPDATE updateColumnsByIdWithoutHooks fast path. These
 * tests pin:
 *   1. exactly one hookless stamp per due monitor carrying BOTH scheduler
 *      columns, and updateOneById is never called (the regression the change
 *      removes),
 *   2. the scheduling control flow is unchanged: a cron monitoringInterval
 *      drives nextMonitorAt through CronTab, an invalid interval falls back
 *      to now+1min (and the monitor is still stamped and enqueued), and one
 *      failed enqueue neither rejects the sweep nor starves the other
 *      monitors;
 *   3. the sweep reads no monitor's steps (their JSON, every due monitor,
 *      every minute): every due monitor is queued, and the evaluation job
 *      skips one without steps before it evaluates anything (2026-10-27);
 *   4. it goes a page at a time (2026-11-14): due monitors are read in _id
 *      order, each page after the last, and a page is stamped with ONE
 *      UPDATE per next-due time - not one per monitor, all at once - and its
 *      jobs queued a few at a time, before the next page is read. It stops
 *      between pages at its deadline.
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

/*
 * The worker transitively imports MonitorResource -> MonitorCriteriaEvaluator
 * -> VMAPI -> VMRunner, which loads the native `isolated-vm` addon. The
 * scheduler never evaluates JavaScript expressions, so stub the VM runner out
 * to keep the module importable in a plain jest environment.
 */
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
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
 * prove it is never called: if the scheduler regressed back to the hooked
 * pipeline, the assertion would flag it instead of the mock throwing
 * "not a function".
 */
const mockQuery: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      findBy: jest.fn(),
      findOneById: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
      updateOneById: jest.fn(),
      getEnabledMonitorQuery: jest.fn(),
      getRepository: jest.fn(() => {
        return { manager: { query: mockQuery } };
      }),
    },
  };
});

jest.mock(
  "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: { addTelemetryMonitorEvaluationJob: jest.fn() },
    };
  },
);

import MonitorService from "Common/Server/Services/MonitorService";
import CronTab from "Common/Server/Utils/CronTab";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import ReceivingCoverage from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import TelemetryQueueService from "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import {
  TELEMETRY_SCHEDULE_ENQUEUE_CONCURRENCY,
  TELEMETRY_SCHEDULE_PAGE_SIZE,
  enqueueDueTelemetryMonitorEvaluationJobs,
  processTelemetryMonitorEvaluationFromQueue,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

interface MonitorServiceMock {
  findAllBy: jest.Mock;
  findBy: jest.Mock;
  findOneById: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
  updateOneById: jest.Mock;
  getEnabledMonitorQuery: jest.Mock;
}

/*
 * What MonitorService.getEnabledMonitorQuery returns: none of the four pause
 * flags set. The scheduler spreads it into its sweep, so an archived or
 * disabled telemetry monitor is never stamped or queued.
 */
const ENABLED_MONITOR_QUERY: Record<string, boolean> = {
  isArchived: false,
  disableActiveMonitoring: false,
  disableActiveMonitoringBecauseOfManualIncident: false,
  disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: false,
};

const monitorService: MonitorServiceMock =
  MonitorService as unknown as MonitorServiceMock;
const enqueueJobMock: jest.Mock =
  TelemetryQueueService.addTelemetryMonitorEvaluationJob as unknown as jest.Mock;
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const NOW: Date = new Date("2026-07-27T10:00:00.000Z");
const CRON_NEXT: Date = new Date("2026-07-27T10:05:00.000Z");
const ONE_MINUTE_MS: number = 60 * 1000;

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const MONITOR_A_ID: ObjectID = new ObjectID("monitor-a");
const MONITOR_B_ID: ObjectID = new ObjectID("monitor-b");

/*
 * The scheduler only checks monitorSteps.data.monitorStepsInstanceArray for
 * non-emptiness, so a cast plain object stands in for a fully-constructed
 * MonitorSteps.
 */
const NON_EMPTY_STEPS: MonitorSteps = {
  data: { monitorStepsInstanceArray: [{}] },
} as unknown as MonitorSteps;

function makeMonitor(data: {
  id: ObjectID;
  monitorSteps?: MonitorSteps | undefined;
  monitoringInterval?: string | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor(data.id);
  monitor.projectId = PROJECT_ID;

  if (data.monitorSteps) {
    monitor.monitorSteps = data.monitorSteps;
  }

  if (data.monitoringInterval) {
    monitor.monitoringInterval = data.monitoringInterval;
  }

  return monitor;
}

interface UpdateCallArgs {
  id: ObjectID;
  data: Record<string, unknown>;
}

// The scheduler's UPDATE statements: one per page and next-due time.
interface StampStatement {
  sql: string;
  lastMonitorAt: Date;
  nextMonitorAt: Date;
  ids: Array<string>;
}

function stampStatements(): Array<StampStatement> {
  return mockQuery.mock.calls.map((args: Array<unknown>): StampStatement => {
    const params: Array<unknown> = args[1] as Array<unknown>;
    return {
      sql: args[0] as string,
      lastMonitorAt: params[0] as Date,
      nextMonitorAt: params[1] as Date,
      ids: params[2] as Array<string>,
    };
  });
}

// Each monitor's stamp, as the columns it was given.
function stampCalls(): Array<UpdateCallArgs> {
  const stamps: Array<UpdateCallArgs> = [];

  for (const statement of stampStatements()) {
    for (const id of statement.ids) {
      stamps.push({
        id: new ObjectID(id),
        data: {
          telemetryMonitorLastMonitorAt: statement.lastMonitorAt,
          telemetryMonitorNextMonitorAt: statement.nextMonitorAt,
        },
      });
    }
  }

  return stamps;
}

function stampFor(monitorId: ObjectID): UpdateCallArgs {
  const matches: Array<UpdateCallArgs> = stampCalls().filter(
    (call: UpdateCallArgs) => {
      return call.id.toString() === monitorId.toString();
    },
  );

  expect(matches).toHaveLength(1);
  return matches[0]!;
}

// The id a keyset read starts after: none for the first page.
function cursorOf(query: Record<string, unknown>): string | undefined {
  const cursor: FindOperator<ObjectID> | undefined = query["_id"] as
    | FindOperator<ObjectID>
    | undefined;

  if (!cursor) {
    return undefined;
  }

  expect(cursor.getSql!("_id")).toMatch(/_id > :/);
  return String(Object.values(cursor.objectLiteralParameters!)[0]);
}

// The due monitors the database holds, served a keyset page at a time.
function serveDueMonitors(monitors: Array<Monitor>): void {
  const sorted: Array<Monitor> = [...monitors].sort(
    (a: Monitor, b: Monitor) => {
      return a.id!.toString() < b.id!.toString() ? -1 : 1;
    },
  );

  monitorService.findBy.mockImplementation(
    async (args: {
      query: { _id?: unknown };
      limit: number;
    }): Promise<Array<Monitor>> => {
      const after: string | undefined = cursorOf(args.query);

      return sorted
        .filter((monitor: Monitor) => {
          return after === undefined || monitor.id!.toString() > after;
        })
        .slice(0, args.limit);
    },
  );
}

function manyMonitors(count: number): Array<Monitor> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return makeMonitor({
      id: new ObjectID(
        `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      ),
    });
  });
}

describe("TelemetryMonitor scheduler (enqueueDueTelemetryMonitorEvaluationJobs)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW);
    });

    serveDueMonitors([]);
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([]);
    monitorService.updateColumnsByIdWithoutHooks.mockResolvedValue(undefined);
    monitorService.updateOneById.mockResolvedValue(undefined);
    monitorService.getEnabledMonitorQuery.mockReturnValue({
      ...ENABLED_MONITOR_QUERY,
    });
    enqueueJobMock.mockResolvedValue(undefined);
  });

  test("sweeps only monitors that are checked: the enabled-monitor query, archived ones left out", async () => {
    await enqueueDueTelemetryMonitorEvaluationJobs();

    expect(monitorService.getEnabledMonitorQuery).toHaveBeenCalled();
    expect(monitorService.findBy).toHaveBeenCalledTimes(1);

    const query: Record<string, unknown> = (
      monitorService.findBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
      }
    ).query;

    expect(query).toMatchObject(ENABLED_MONITOR_QUERY);
    expect(query["isArchived"]).toBe(false);
  });

  test("stamps every due monitor exactly once, hookless, with BOTH scheduler columns", async () => {
    jest.spyOn(CronTab, "getNextExecutionTime").mockReturnValue(CRON_NEXT);

    const withInterval: Monitor = makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: NON_EMPTY_STEPS,
      monitoringInterval: "*/5 * * * *",
    });
    // stamped even though it has no steps: the bump is scheduler bookkeeping.
    const withoutSteps: Monitor = makeMonitor({ id: MONITOR_B_ID });

    serveDueMonitors([withInterval, withoutSteps]);

    await enqueueDueTelemetryMonitorEvaluationJobs();

    expect(monitorService.findBy).toHaveBeenCalledTimes(1);

    const stamps: Array<UpdateCallArgs> = stampCalls();
    expect(stamps).toHaveLength(2);

    for (const statement of stampStatements()) {
      // EXACTLY the two bookkeeping columns (and updatedAt, as before).
      expect(statement.sql).toBe(
        'UPDATE "Monitor" SET "telemetryMonitorLastMonitorAt" = $1, "telemetryMonitorNextMonitorAt" = $2, "updatedAt" = CURRENT_TIMESTAMP WHERE "_id" = ANY($3::uuid[])',
      );
      expect(statement.lastMonitorAt.getTime()).toBe(NOW.getTime());
    }

    // the cron interval drives nextMonitorAt through CronTab...
    expect(CronTab.getNextExecutionTime).toHaveBeenCalledWith("*/5 * * * *");
    expect(
      (
        stampFor(MONITOR_A_ID).data["telemetryMonitorNextMonitorAt"] as Date
      ).getTime(),
    ).toBe(CRON_NEXT.getTime());

    // ...and no interval means the default one-minute cadence.
    expect(
      (
        stampFor(MONITOR_B_ID).data["telemetryMonitorNextMonitorAt"] as Date
      ).getTime(),
    ).toBe(NOW.getTime() + ONE_MINUTE_MS);

    // THE regressions removed: the hooked pipeline, and a statement per monitor.
    expect(monitorService.updateOneById).not.toHaveBeenCalled();
    expect(monitorService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
  });

  test("an invalid monitoringInterval is logged, falls back to now+1min, and the monitor is still enqueued", async () => {
    // no CronTab spy: the real parser rejects the string, the job catches.
    serveDueMonitors([
      makeMonitor({
        id: MONITOR_A_ID,
        monitorSteps: NON_EMPTY_STEPS,
        monitoringInterval: "not-a-valid-cron",
      }),
    ]);

    await enqueueDueTelemetryMonitorEvaluationJobs();

    expect(mockedLogger.error).toHaveBeenCalled();

    const stamp: UpdateCallArgs = stampFor(MONITOR_A_ID);
    expect(
      (stamp.data["telemetryMonitorNextMonitorAt"] as Date).getTime(),
    ).toBe(NOW.getTime() + ONE_MINUTE_MS);
    expect(monitorService.updateOneById).not.toHaveBeenCalled();

    // the bad interval must not cost the monitor its evaluation.
    expect(enqueueJobMock).toHaveBeenCalledTimes(1);
  });

  test("reads only what scheduling needs: never a monitor's steps", async () => {
    await enqueueDueTelemetryMonitorEvaluationJobs();

    const select: Record<string, unknown> = (
      monitorService.findBy.mock.calls[0]![0] as {
        select: Record<string, unknown>;
      }
    ).select;

    expect(Object.keys(select).sort()).toEqual([
      "_id",
      "createdAt",
      "monitorType",
      "monitoringInterval",
      "projectId",
    ]);
    expect(select).not.toHaveProperty("monitorSteps");
  });

  test("every due monitor is stamped and enqueued with monitorId + projectId, steps or not: the evaluation job reads the steps", async () => {
    serveDueMonitors([
      makeMonitor({ id: MONITOR_A_ID, monitorSteps: NON_EMPTY_STEPS }),
      makeMonitor({ id: MONITOR_B_ID }),
    ]);

    await enqueueDueTelemetryMonitorEvaluationJobs();

    expect(stampCalls()).toHaveLength(2);
    expect(enqueueJobMock).toHaveBeenCalledTimes(2);

    const enqueued: Array<string> = enqueueJobMock.mock.calls.map(
      (args: Array<unknown>): string => {
        const job: { monitorId: ObjectID; projectId: ObjectID } = args[0] as {
          monitorId: ObjectID;
          projectId: ObjectID;
        };
        return `${job.monitorId.toString()}@${job.projectId.toString()}`;
      },
    );
    expect(enqueued.sort()).toEqual(
      [
        `${MONITOR_A_ID.toString()}@${PROJECT_ID.toString()}`,
        `${MONITOR_B_ID.toString()}@${PROJECT_ID.toString()}`,
      ].sort(),
    );
  });

  test("the evaluation job of a monitor without steps reads its steps and stops before it evaluates anything", async () => {
    const plan: jest.SpiedFunction<
      typeof ReceivingCoverage.planTelemetryEvaluation
    > = jest.spyOn(ReceivingCoverage, "planTelemetryEvaluation");

    for (const monitorSteps of [
      undefined,
      { data: { monitorStepsInstanceArray: [] } } as unknown as MonitorSteps,
    ]) {
      const monitor: Monitor = makeMonitor({ id: MONITOR_B_ID, monitorSteps });
      monitorService.findOneById.mockResolvedValue(monitor);

      await processTelemetryMonitorEvaluationFromQueue({
        monitorId: MONITOR_B_ID.toString(),
        projectId: PROJECT_ID.toString(),
      } as Parameters<typeof processTelemetryMonitorEvaluationFromQueue>[0]);
    }

    // The job asked for the steps itself...
    expect(monitorService.findOneById).toHaveBeenCalledTimes(2);
    expect(
      (
        monitorService.findOneById.mock.calls[0]![0] as {
          select: Record<string, unknown>;
        }
      ).select,
    ).toHaveProperty("monitorSteps", true);
    // ...and went no further: no window planned, nothing stamped or queued.
    expect(plan).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  test("one rejected enqueue is logged and neither rejects the sweep nor starves the other monitors", async () => {
    serveDueMonitors([
      makeMonitor({ id: MONITOR_A_ID, monitorSteps: NON_EMPTY_STEPS }),
      makeMonitor({ id: MONITOR_B_ID, monitorSteps: NON_EMPTY_STEPS }),
    ]);
    enqueueJobMock
      .mockRejectedValueOnce(new Error("redis connection reset"))
      .mockResolvedValue(undefined);

    await expect(
      enqueueDueTelemetryMonitorEvaluationJobs(),
    ).resolves.toBeUndefined();

    expect(enqueueJobMock).toHaveBeenCalledTimes(2);
    expect(mockedLogger.error).toHaveBeenCalled();
  });

  test("a tick with no due monitors writes nothing and enqueues nothing", async () => {
    serveDueMonitors([]);

    await enqueueDueTelemetryMonitorEvaluationJobs();

    expect(mockQuery).not.toHaveBeenCalled();
    expect(monitorService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
    expect(monitorService.updateOneById).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  test("reads due monitors a keyset page at a time, in _id order, each page after the last", async () => {
    const monitors: Array<Monitor> = manyMonitors(
      TELEMETRY_SCHEDULE_PAGE_SIZE * 2 + 201,
    );
    serveDueMonitors(monitors);

    await enqueueDueTelemetryMonitorEvaluationJobs();

    // Two full pages and a short one: three reads, never an OFFSET.
    expect(monitorService.findBy).toHaveBeenCalledTimes(3);
    expect(monitorService.findAllBy).not.toHaveBeenCalled();

    const reads: Array<{
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      skip: number;
      limit: number;
    }> = monitorService.findBy.mock.calls.map((args: Array<unknown>) => {
      return args[0] as {
        query: Record<string, unknown>;
        sort: Record<string, unknown>;
        skip: number;
        limit: number;
      };
    });

    for (const read of reads) {
      expect(read.sort).toEqual({ _id: SortOrder.Ascending });
      expect(read.skip).toBe(0);
      expect(read.limit).toBe(TELEMETRY_SCHEDULE_PAGE_SIZE);
    }

    expect(cursorOf(reads[0]!.query)).toBeUndefined();
    expect(cursorOf(reads[1]!.query)).toBe(
      monitors[TELEMETRY_SCHEDULE_PAGE_SIZE - 1]!.id!.toString(),
    );
    expect(cursorOf(reads[2]!.query)).toBe(
      monitors[TELEMETRY_SCHEDULE_PAGE_SIZE * 2 - 1]!.id!.toString(),
    );

    // Every monitor stamped and queued exactly once.
    expect(stampCalls()).toHaveLength(monitors.length);
    expect(
      new Set(
        stampCalls().map((stamp: UpdateCallArgs) => {
          return stamp.id.toString();
        }),
      ).size,
    ).toBe(monitors.length);
    expect(enqueueJobMock).toHaveBeenCalledTimes(monitors.length);
  });

  test("stamps a page with ONE UPDATE per next-due time, never one per monitor", async () => {
    // A page of 1,201 every-minute monitors: one statement per page.
    serveDueMonitors(manyMonitors(TELEMETRY_SCHEDULE_PAGE_SIZE * 2 + 201));

    await enqueueDueTelemetryMonitorEvaluationJobs();

    expect(stampStatements()).toHaveLength(3);
    expect(
      stampStatements().map((statement: StampStatement) => {
        return statement.ids.length;
      }),
    ).toEqual([
      TELEMETRY_SCHEDULE_PAGE_SIZE,
      TELEMETRY_SCHEDULE_PAGE_SIZE,
      201,
    ]);

    // Two cadences on one page: two statements for it.
    mockQuery.mockClear();
    jest.spyOn(CronTab, "getNextExecutionTime").mockReturnValue(CRON_NEXT);
    serveDueMonitors([
      makeMonitor({ id: MONITOR_A_ID, monitoringInterval: "*/5 * * * *" }),
      makeMonitor({ id: MONITOR_B_ID }),
    ]);

    await enqueueDueTelemetryMonitorEvaluationJobs();

    expect(stampStatements()).toHaveLength(2);
    expect(
      stampStatements()
        .map((statement: StampStatement) => {
          return statement.nextMonitorAt.getTime();
        })
        .sort(),
    ).toEqual([NOW.getTime() + ONE_MINUTE_MS, CRON_NEXT.getTime()].sort());
  });

  test("stamps a page before it queues the page's jobs, and reads the next page after both", async () => {
    const events: Array<string> = [];

    serveDueMonitors(manyMonitors(TELEMETRY_SCHEDULE_PAGE_SIZE + 1));
    const read: jest.Mock = monitorService.findBy;
    const serve: (...args: Array<unknown>) => unknown =
      read.getMockImplementation()!;
    read.mockImplementation(async (...args: Array<unknown>) => {
      events.push("read");
      return serve(...args);
    });
    mockQuery.mockImplementation(async () => {
      events.push("stamp");
      return [];
    });
    enqueueJobMock.mockImplementation(async () => {
      if (events[events.length - 1] !== "queue") {
        events.push("queue");
      }
    });

    await enqueueDueTelemetryMonitorEvaluationJobs();

    expect(events).toEqual([
      "read",
      "stamp",
      "queue",
      "read",
      "stamp",
      "queue",
    ]);
  });

  test("queues never more than its limit of a page's jobs at once", async () => {
    serveDueMonitors(manyMonitors(TELEMETRY_SCHEDULE_PAGE_SIZE));

    let inFlight: number = 0;
    let mostInFlight: number = 0;

    enqueueJobMock.mockImplementation(async () => {
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await new Promise<void>((resolve: () => void) => {
        setImmediate(resolve);
      });
      inFlight--;
    });

    await enqueueDueTelemetryMonitorEvaluationJobs();

    expect(enqueueJobMock).toHaveBeenCalledTimes(TELEMETRY_SCHEDULE_PAGE_SIZE);
    expect(mostInFlight).toBe(TELEMETRY_SCHEDULE_ENQUEUE_CONCURRENCY);
  });

  test("stops between pages once its deadline passes, leaving the rest due for the next run", async () => {
    serveDueMonitors(manyMonitors(TELEMETRY_SCHEDULE_PAGE_SIZE * 3));
    const deadline: JobDeadline = new JobDeadline();

    // The time limit runs out while the first page is being stamped.
    mockQuery.mockImplementation(async () => {
      deadline.end();
      return [];
    });

    await enqueueDueTelemetryMonitorEvaluationJobs(deadline);

    expect(monitorService.findBy).toHaveBeenCalledTimes(1);
    expect(stampStatements()).toHaveLength(1);
  });

  test("a page whose UPDATE fails fails the run before its jobs are queued", async () => {
    serveDueMonitors([makeMonitor({ id: MONITOR_A_ID })]);
    mockQuery.mockRejectedValue(
      new Error("canceling statement due to statement timeout"),
    );

    await expect(enqueueDueTelemetryMonitorEvaluationJobs()).rejects.toThrow(
      "statement timeout",
    );
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });
});
