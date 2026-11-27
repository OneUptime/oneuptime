import Monitor from "Common/Models/DatabaseModels/Monitor";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import ObjectID from "Common/Types/ObjectID";

/*
 * Regression tests for the telemetry-monitor scheduler
 * (enqueueDueTelemetryMonitorEvaluationJobs, the EVERY_TEN_SECONDS cron body
 * registered by ScheduleTelemetryMonitorEvaluations.ts). They pin:
 *
 *   1. the stamps are scheduler bookkeeping: one hookless statement per
 *      step, carrying BOTH scheduler columns and each monitor's own next
 *      due time, and never the hooked pipeline (updateOneById) - which used
 *      to cost ~4 statements, an on-update workflow trigger and an audit
 *      entry per monitor per tick;
 *   2. each monitor is queued at the moment it is due - its own moment of
 *      its interval (TelemetryMonitorSchedule, issue #11060) - never before
 *      it, and stamped with its next run as it is queued; one never
 *      scheduled, or overdue, is queued at once;
 *   3. a run reads what is due before the next run's tick, and has
 *      finished by then;
 *   4. a monitor is stamped only while still due (another run that queued
 *      it first wins), only the monitors stamped are queued, and one whose
 *      job the queue refused is made due again;
 *   5. the sweep reads no monitor's steps: every due monitor is queued, and
 *      the evaluation job skips one without steps (2026-10-27);
 *   6. it reads a page at a time, in _id order (2026-11-14), stamps at most a
 *      page in one statement, queues a few jobs at a time, and stops at its
 *      deadline.
 */

/*
 * The part of typeorm's FindOperator these assertions read. typeorm is
 * Common's dependency, not App's, so its type cannot be imported here
 * (TestImportsResolveFromApp.test.ts): the structural type says exactly as
 * much as the assertions rely on.
 */
interface ReadFindOperator {
  getSql?: ((aliasPath: string) => string) | undefined;
  objectLiteralParameters?: Record<string, unknown> | undefined;
}

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
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import TelemetryMonitorSchedule from "Common/Server/Utils/Monitor/TelemetryMonitorSchedule";
import ReceivingCoverage from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import TelemetryQueueService from "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import {
  TELEMETRY_SCHEDULE_DISPATCH_MARGIN_MS,
  TELEMETRY_SCHEDULE_DISPATCH_STEP_MS,
  TELEMETRY_SCHEDULE_ENQUEUE_CONCURRENCY,
  TELEMETRY_SCHEDULE_PAGE_SIZE,
  TELEMETRY_SCHEDULE_TICK_MS,
  enqueueDueTelemetryMonitorEvaluationJobs,
  getTelemetryDispatchWindowEnd,
  getTelemetryEvaluationDueAt,
  getTelemetryEvaluationWindowEnd,
  getTelemetryMonitorNextMonitorAt,
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

// A run's tick: the scheduler runs at :00, :10, :20 ... of every minute.
const NOW: number = Date.UTC(2026, 6, 27, 10, 0, 0, 0);
const MINUTE_MS: number = 60 * 1000;

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const MONITOR_A_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-00000000000a",
);
const MONITOR_B_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-00000000000b",
);

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
  nextMonitorAt?: Date | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor(data.id);
  monitor.projectId = PROJECT_ID;

  if (data.monitorSteps) {
    monitor.monitorSteps = data.monitorSteps;
  }

  if (data.monitoringInterval) {
    monitor.monitoringInterval = data.monitoringInterval;
  }

  if (data.nextMonitorAt) {
    monitor.telemetryMonitorNextMonitorAt = data.nextMonitorAt;
  }

  return monitor;
}

const STAMP_SQL: string =
  'WITH "stamped" AS (UPDATE "Monitor" AS "monitor" SET "telemetryMonitorLastMonitorAt" = $1, "telemetryMonitorNextMonitorAt" = "due"."nextMonitorAt", "updatedAt" = CURRENT_TIMESTAMP FROM unnest($2::uuid[], $3::timestamptz[], $4::timestamptz[]) AS "due"("_id", "dueAt", "nextMonitorAt") WHERE "monitor"."_id" = "due"."_id" AND "monitor"."deletedAt" IS NULL AND ("monitor"."telemetryMonitorNextMonitorAt" IS NULL OR "monitor"."telemetryMonitorNextMonitorAt" < "due"."dueAt" + interval \'1 millisecond\') RETURNING "monitor"."_id") SELECT "_id" FROM "stamped"';

const RETURN_SQL: string =
  'UPDATE "Monitor" AS "monitor" SET "telemetryMonitorNextMonitorAt" = "failed"."dueAt" FROM unnest($1::uuid[], $2::timestamptz[], $3::timestamptz[]) AS "failed"("_id", "dueAt", "nextMonitorAt") WHERE "monitor"."_id" = "failed"."_id" AND "monitor"."telemetryMonitorNextMonitorAt" = "failed"."nextMonitorAt"';

// The scheduler's stamping statements: one per step.
interface StampStatement {
  sql: string;
  // When it was sent, on the test's clock.
  at: number;
  lastMonitorAt: Date;
  ids: Array<string>;
  dueAts: Array<Date>;
  nextMonitorAts: Array<Date>;
}

interface ReturnStatement {
  ids: Array<string>;
  dueAts: Array<Date>;
  nextMonitorAts: Array<Date>;
}

const sentAt: Array<number> = [];

function stampStatements(): Array<StampStatement> {
  return mockQuery.mock.calls
    .map((args: Array<unknown>, index: number) => {
      return { args, at: sentAt[index]! };
    })
    .filter((call: { args: Array<unknown> }): boolean => {
      return (call.args[0] as string).startsWith('WITH "stamped"');
    })
    .map((call: { args: Array<unknown>; at: number }): StampStatement => {
      const params: Array<unknown> = call.args[1] as Array<unknown>;
      return {
        sql: call.args[0] as string,
        at: call.at,
        lastMonitorAt: params[0] as Date,
        ids: params[1] as Array<string>,
        dueAts: params[2] as Array<Date>,
        nextMonitorAts: params[3] as Array<Date>,
      };
    });
}

function returnStatements(): Array<ReturnStatement> {
  return mockQuery.mock.calls
    .filter((args: Array<unknown>): boolean => {
      return (args[0] as string).includes('"failed"');
    })
    .map((args: Array<unknown>): ReturnStatement => {
      expect(args[0]).toBe(RETURN_SQL);
      const params: Array<unknown> = args[1] as Array<unknown>;
      return {
        ids: params[0] as Array<string>,
        dueAts: params[1] as Array<Date>,
        nextMonitorAts: params[2] as Array<Date>,
      };
    });
}

interface MonitorStamp {
  lastMonitorAt: Date;
  dueAt: Date;
  nextMonitorAt: Date;
}

function stampFor(monitorId: ObjectID): MonitorStamp {
  const stamps: Array<MonitorStamp> = [];

  for (const statement of stampStatements()) {
    statement.ids.forEach((id: string, index: number) => {
      if (id === monitorId.toString()) {
        stamps.push({
          lastMonitorAt: statement.lastMonitorAt,
          dueAt: statement.dueAts[index]!,
          nextMonitorAt: statement.nextMonitorAts[index]!,
        });
      }
    });
  }

  expect(stamps).toHaveLength(1);
  return stamps[0]!;
}

// When each monitor's job was queued, on the test's clock, by id.
const queuedAt: Map<string, Array<number>> = new Map();

function queuedTimesOf(monitorId: ObjectID): Array<number> {
  return queuedAt.get(monitorId.toString()) || [];
}

// The id a keyset read starts after: none for the first page.
function cursorOf(query: Record<string, unknown>): string | undefined {
  const cursor: ReadFindOperator | undefined = query["_id"] as
    | ReadFindOperator
    | undefined;

  if (!cursor) {
    return undefined;
  }

  expect(cursor.getSql!("_id")).toMatch(/_id > :/);
  return String(Object.values(cursor.objectLiteralParameters!)[0]);
}

// The time a read asks for monitors due by (or never scheduled).
function dueByOf(query: Record<string, unknown>): Date {
  const operator: ReadFindOperator = query[
    "telemetryMonitorNextMonitorAt"
  ] as ReadFindOperator;

  expect(operator.getSql!("next")).toMatch(/\(next <= :\w+ or next IS NULL\)/);
  return Object.values(operator.objectLiteralParameters!)[0] as Date;
}

/*
 * The monitors the database holds, served a keyset page at a time: those
 * due by the time the read asks for, or never scheduled.
 */
function serveMonitors(monitors: Array<Monitor>): void {
  const sorted: Array<Monitor> = [...monitors].sort(
    (a: Monitor, b: Monitor) => {
      return a.id!.toString() < b.id!.toString() ? -1 : 1;
    },
  );

  monitorService.findBy.mockImplementation(
    async (args: {
      query: Record<string, unknown>;
      limit: number;
    }): Promise<Array<Monitor>> => {
      const after: string | undefined = cursorOf(args.query);
      const dueBy: number = dueByOf(args.query).getTime();

      return sorted
        .filter((monitor: Monitor) => {
          const next: Date | undefined = monitor.telemetryMonitorNextMonitorAt;

          return (
            (after === undefined || monitor.id!.toString() > after) &&
            (!next || next.getTime() <= dueBy)
          );
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

async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 4; turn++) {
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
  }
}

/*
 * Runs `work` to its end on the fake clock: whenever it waits on a timer,
 * the clock moves on to it. Returns how far the clock moved.
 */
async function onTheClock(work: () => Promise<void>): Promise<number> {
  const startedAt: number = Date.now();
  let isDone: boolean = false;
  let failure: unknown = undefined;

  work().then(
    () => {
      isDone = true;
    },
    (error: unknown) => {
      failure = error;
      isDone = true;
    },
  );

  for (let turn: number = 0; turn < 20000 && !isDone; turn++) {
    await settle();

    if (!isDone && jest.getTimerCount() > 0) {
      jest.advanceTimersToNextTimer();
    }
  }

  if (!isDone) {
    throw new Error("The run did not finish.");
  }

  if (failure) {
    throw failure;
  }

  return Date.now() - startedAt;
}

describe("TelemetryMonitor scheduler (enqueueDueTelemetryMonitorEvaluationJobs)", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        "performance",
        "hrtime",
        "nextTick",
        "setImmediate",
        "queueMicrotask",
      ],
    });

    TelemetryMonitorSchedule.clearReadings();
    serveMonitors([]);
    sentAt.length = 0;
    queuedAt.clear();
    mockQuery.mockReset();
    mockQuery.mockImplementation(
      async (sql: string, params: Array<unknown>): Promise<unknown> => {
        sentAt.push(Date.now());

        // Every monitor is still due: each one is stamped.
        if (sql.startsWith('WITH "stamped"')) {
          return (params[1] as Array<string>).map((id: string) => {
            return { _id: id };
          });
        }

        return [];
      },
    );
    monitorService.updateColumnsByIdWithoutHooks.mockResolvedValue(undefined);
    monitorService.updateOneById.mockResolvedValue(undefined);
    monitorService.getEnabledMonitorQuery.mockReturnValue({
      ...ENABLED_MONITOR_QUERY,
    });
    enqueueJobMock.mockImplementation(
      async (job: { monitorId: ObjectID }): Promise<void> => {
        const times: Array<number> =
          queuedAt.get(job.monitorId.toString()) || [];
        times.push(Date.now());
        queuedAt.set(job.monitorId.toString(), times);
      },
    );
  });

  test("sweeps only monitors that are checked: the enabled-monitor query, archived ones left out", async () => {
    await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

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

  test("reads the monitors due before the next run's tick - less its margin - and those never scheduled", async () => {
    await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

    const query: Record<string, unknown> = (
      monitorService.findBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
      }
    ).query;

    expect(dueByOf(query).getTime()).toBe(
      NOW + TELEMETRY_SCHEDULE_TICK_MS - TELEMETRY_SCHEDULE_DISPATCH_MARGIN_MS,
    );
  });

  test("a run's window ends before the next tick, wherever in its tick it starts, and never before it starts", () => {
    expect(getTelemetryDispatchWindowEnd(new Date(NOW)).getTime()).toBe(
      NOW + 9500,
    );
    expect(getTelemetryDispatchWindowEnd(new Date(NOW + 3210)).getTime()).toBe(
      NOW + 9500,
    );
    expect(getTelemetryDispatchWindowEnd(new Date(NOW + 9499)).getTime()).toBe(
      NOW + 9500,
    );
    // A run that started late: it queues what is due by its start.
    expect(getTelemetryDispatchWindowEnd(new Date(NOW + 9700)).getTime()).toBe(
      NOW + 9700,
    );
    expect(getTelemetryDispatchWindowEnd(new Date(NOW + 10000)).getTime()).toBe(
      NOW + 19500,
    );
  });

  test("queues each monitor at the moment it is due, never before it, and is done before the next tick", async () => {
    const dueIn: Array<number> = [0, 1, 99, 250, 2345, 5000, 7999, 9499];
    const monitors: Array<Monitor> = dueIn.map(
      (offset: number, index: number): Monitor => {
        return makeMonitor({
          id: new ObjectID(
            `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          ),
          nextMonitorAt: new Date(NOW + offset),
        });
      },
    );

    serveMonitors(monitors);

    const took: number = await onTheClock(
      enqueueDueTelemetryMonitorEvaluationJobs,
    );

    monitors.forEach((monitor: Monitor, index: number) => {
      const times: Array<number> = queuedTimesOf(monitor.id!);

      expect(times).toHaveLength(1);
      // Never before it is due, and within a step of it.
      expect(times[0]!).toBeGreaterThanOrEqual(NOW + dueIn[index]!);
      expect(times[0]! - (NOW + dueIn[index]!)).toBeLessThan(
        TELEMETRY_SCHEDULE_DISPATCH_STEP_MS,
      );
    });

    expect(took).toBeLessThanOrEqual(
      TELEMETRY_SCHEDULE_TICK_MS - TELEMETRY_SCHEDULE_DISPATCH_MARGIN_MS,
    );
  });

  test("monitors due within a step of each other share one statement, stamped as the last of them is due; others get their own", async () => {
    serveMonitors([
      makeMonitor({ id: MONITOR_A_ID, nextMonitorAt: new Date(NOW + 1000) }),
      makeMonitor({ id: MONITOR_B_ID, nextMonitorAt: new Date(NOW + 1060) }),
      makeMonitor({
        id: new ObjectID("00000000-0000-4000-8000-00000000000c"),
        nextMonitorAt: new Date(NOW + 1100),
      }),
    ]);

    await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

    const statements: Array<StampStatement> = stampStatements();

    expect(statements).toHaveLength(2);
    expect(statements[0]!.ids.sort()).toEqual(
      [MONITOR_A_ID.toString(), MONITOR_B_ID.toString()].sort(),
    );
    expect(statements[0]!.at).toBe(NOW + 1060);
    expect(statements[1]!.ids).toEqual([
      "00000000-0000-4000-8000-00000000000c",
    ]);
    expect(statements[1]!.at).toBe(NOW + 1100);
  });

  test("stamps hookless, BOTH scheduler columns, each monitor its own next run: its schedule's next run at its own moment", async () => {
    const withInterval: Monitor = makeMonitor({
      id: MONITOR_A_ID,
      monitorSteps: NON_EMPTY_STEPS,
      monitoringInterval: "*/5 * * * *",
    });
    // stamped even though it has no steps: the bump is scheduler bookkeeping.
    const withoutSteps: Monitor = makeMonitor({ id: MONITOR_B_ID });

    serveMonitors([withInterval, withoutSteps]);

    await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

    const statements: Array<StampStatement> = stampStatements();

    // Never scheduled: both queued at once, in one statement.
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toBe(STAMP_SQL);
    expect(statements[0]!.lastMonitorAt.getTime()).toBe(NOW);

    const a: MonitorStamp = stampFor(MONITOR_A_ID);
    const b: MonitorStamp = stampFor(MONITOR_B_ID);

    expect(a.dueAt.getTime()).toBe(NOW);
    expect(b.dueAt.getTime()).toBe(NOW);

    expect(a.nextMonitorAt.getTime()).toBe(
      TelemetryMonitorSchedule.getNextRunAt({
        monitorId: MONITOR_A_ID,
        monitoringInterval: "*/5 * * * *",
        after: new Date(NOW),
      }).getTime(),
    );
    // No interval: every minute, at its own second of the minute.
    expect(b.nextMonitorAt.getTime()).toBe(
      TelemetryMonitorSchedule.getNextRunAt({
        monitorId: MONITOR_B_ID,
        monitoringInterval: null,
        after: new Date(NOW),
      }).getTime(),
    );
    expect(b.nextMonitorAt.getTime()).toBeGreaterThan(NOW);
    expect(b.nextMonitorAt.getTime()).toBeLessThanOrEqual(NOW + MINUTE_MS);

    // THE regressions removed: the hooked pipeline, and a statement per monitor.
    expect(monitorService.updateOneById).not.toHaveBeenCalled();
    expect(monitorService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
  });

  test("a monitor queued at its own moment is next due exactly one interval later, and queued once", async () => {
    for (const [monitorId, interval, intervalMs] of [
      [MONITOR_A_ID, undefined, MINUTE_MS],
      [MONITOR_B_ID, "*/5 * * * *", 5 * MINUTE_MS],
    ] as Array<[ObjectID, string | undefined, number]>) {
      mockQuery.mockClear();
      sentAt.length = 0;
      queuedAt.clear();

      // Its own moment of the interval, as the scheduler last stamped it.
      const slot: number = TelemetryMonitorSchedule.getNextRunAt({
        monitorId,
        monitoringInterval: interval,
        after: new Date(NOW),
      }).getTime();

      const monitor: Monitor = makeMonitor({
        id: monitorId,
        monitoringInterval: interval,
        nextMonitorAt: new Date(slot),
      });

      serveMonitors([monitor]);

      // The run of the tick the slot is in, and the next, as the cron runs them.
      const tick: number =
        Math.floor(slot / TELEMETRY_SCHEDULE_TICK_MS) *
        TELEMETRY_SCHEDULE_TICK_MS;

      jest.setSystemTime(tick);
      await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

      if (queuedTimesOf(monitorId).length === 0) {
        // The slot was in the last half second: the next run queues it.
        jest.setSystemTime(tick + TELEMETRY_SCHEDULE_TICK_MS);
        await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);
      }

      const times: Array<number> = queuedTimesOf(monitorId);

      expect(times).toHaveLength(1);
      expect(times[0]!).toBeGreaterThanOrEqual(slot);
      expect(times[0]! - slot).toBeLessThan(
        TELEMETRY_SCHEDULE_DISPATCH_MARGIN_MS +
          TELEMETRY_SCHEDULE_DISPATCH_STEP_MS,
      );
      expect(stampFor(monitorId).nextMonitorAt.getTime()).toBe(
        slot + intervalMs,
      );
    }
  });

  test("an overdue monitor - the scheduler was stopped - is queued at once, and next due at its own moment after now, never in the past", async () => {
    jest.setSystemTime(NOW + 7 * MINUTE_MS + 3000);

    serveMonitors([
      makeMonitor({
        id: MONITOR_A_ID,
        nextMonitorAt: new Date(NOW + 21000),
      }),
    ]);

    await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

    const now: number = NOW + 7 * MINUTE_MS + 3000;
    const stamp: MonitorStamp = stampFor(MONITOR_A_ID);

    expect(queuedTimesOf(MONITOR_A_ID)).toEqual([now]);
    expect(stamp.dueAt.getTime()).toBe(now);
    expect(stamp.nextMonitorAt.getTime()).toBeGreaterThan(now);
    expect(stamp.nextMonitorAt.getTime()).toBe(
      getTelemetryMonitorNextMonitorAt({
        monitor: makeMonitor({ id: MONITOR_A_ID }),
        after: new Date(now),
      }).getTime(),
    );
  });

  test("a stamp the old scheduler wrote - the start of a minute - is honoured, then the monitor moves to its own moment", async () => {
    // Every monitor of the old scheduler was due at the start of the minute.
    serveMonitors(
      manyMonitors(50).map((monitor: Monitor): Monitor => {
        monitor.telemetryMonitorNextMonitorAt = new Date(NOW);
        return monitor;
      }),
    );

    await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

    expect(enqueueJobMock).toHaveBeenCalledTimes(50);

    const nexts: Array<number> = stampStatements().flatMap(
      (statement: StampStatement): Array<number> => {
        return statement.nextMonitorAts.map((next: Date): number => {
          return next.getTime();
        });
      },
    );

    // Each its own moment of the next minute, never more than a minute on.
    expect(new Set(nexts).size).toBe(50);
    for (const next of nexts) {
      expect(next).toBeGreaterThan(NOW);
      expect(next).toBeLessThanOrEqual(NOW + MINUTE_MS);
    }
  });

  test("an invalid monitoringInterval is logged, runs every minute, and the monitor is still enqueued", async () => {
    serveMonitors([
      makeMonitor({
        id: MONITOR_A_ID,
        monitorSteps: NON_EMPTY_STEPS,
        monitoringInterval: "not-a-valid-cron",
      }),
    ]);

    await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

    expect(mockedLogger.error).toHaveBeenCalled();

    expect(stampFor(MONITOR_A_ID).nextMonitorAt.getTime()).toBe(
      TelemetryMonitorSchedule.getNextRunAt({
        monitorId: MONITOR_A_ID,
        monitoringInterval: null,
        after: new Date(NOW),
      }).getTime(),
    );
    expect(monitorService.updateOneById).not.toHaveBeenCalled();

    // the bad interval must not cost the monitor its evaluation.
    expect(enqueueJobMock).toHaveBeenCalledTimes(1);
  });

  test("reads only what scheduling needs: never a monitor's steps", async () => {
    await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

    const select: Record<string, unknown> = (
      monitorService.findBy.mock.calls[0]![0] as {
        select: Record<string, unknown>;
      }
    ).select;

    expect(Object.keys(select).sort()).toEqual([
      "_id",
      "monitorType",
      "monitoringInterval",
      "projectId",
      "telemetryMonitorNextMonitorAt",
    ]);
    expect(select).not.toHaveProperty("monitorSteps");
  });

  test("every due monitor is stamped and enqueued with monitorId + projectId, steps or not: the evaluation job reads the steps", async () => {
    serveMonitors([
      makeMonitor({ id: MONITOR_A_ID, monitorSteps: NON_EMPTY_STEPS }),
      makeMonitor({ id: MONITOR_B_ID }),
    ]);

    await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

    expect(stampStatements()[0]!.ids).toHaveLength(2);
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

  test("a monitor another run stamped first - no longer due - is not queued", async () => {
    serveMonitors([
      makeMonitor({ id: MONITOR_A_ID }),
      makeMonitor({ id: MONITOR_B_ID }),
    ]);

    // B was stamped since it was read: the statement leaves it out.
    mockQuery.mockImplementation(
      async (sql: string, params: Array<unknown>): Promise<unknown> => {
        sentAt.push(Date.now());

        if (sql.startsWith('WITH "stamped"')) {
          return (params[1] as Array<string>)
            .filter((id: string) => {
              return id !== MONITOR_B_ID.toString();
            })
            .map((id: string) => {
              return { _id: id.toUpperCase() };
            });
        }

        return [];
      },
    );

    await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

    // Postgres's ids are compared whatever their case.
    expect(queuedTimesOf(MONITOR_A_ID)).toHaveLength(1);
    expect(queuedTimesOf(MONITOR_B_ID)).toHaveLength(0);
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

  test("one rejected enqueue is logged, neither rejects the sweep nor starves the others, and its monitor is made due again", async () => {
    serveMonitors([
      makeMonitor({ id: MONITOR_A_ID, monitorSteps: NON_EMPTY_STEPS }),
      makeMonitor({ id: MONITOR_B_ID, monitorSteps: NON_EMPTY_STEPS }),
    ]);
    enqueueJobMock
      .mockRejectedValueOnce(new Error("redis connection reset"))
      .mockResolvedValue(undefined);

    await expect(
      onTheClock(enqueueDueTelemetryMonitorEvaluationJobs),
    ).resolves.toBeGreaterThanOrEqual(0);

    expect(enqueueJobMock).toHaveBeenCalledTimes(2);
    expect(mockedLogger.error).toHaveBeenCalled();

    const failedId: string = (
      enqueueJobMock.mock.calls[0]![0] as { monitorId: ObjectID }
    ).monitorId.toString();
    const stamp: MonitorStamp = stampFor(new ObjectID(failedId));

    // Due again at the time it was due, while it still holds this stamp.
    expect(returnStatements()).toEqual([
      {
        ids: [failedId],
        dueAts: [stamp.dueAt],
        nextMonitorAts: [stamp.nextMonitorAt],
      },
    ]);
  });

  test("a statement that cannot make a refused monitor due again is logged, and the run goes on", async () => {
    serveMonitors([
      makeMonitor({ id: MONITOR_A_ID, nextMonitorAt: new Date(NOW) }),
      makeMonitor({ id: MONITOR_B_ID, nextMonitorAt: new Date(NOW + 5000) }),
    ]);
    enqueueJobMock.mockRejectedValueOnce(new Error("redis connection reset"));
    mockQuery.mockImplementation(
      async (sql: string, params: Array<unknown>): Promise<unknown> => {
        sentAt.push(Date.now());

        if (sql.includes('"failed"')) {
          throw new Error("connection terminated");
        }

        return (params[1] as Array<string>).map((id: string) => {
          return { _id: id };
        });
      },
    );

    await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

    // B, due later, was still queued.
    expect(enqueueJobMock).toHaveBeenCalledTimes(2);
    expect(
      mockedLogger.error.mock.calls.some((args: Array<unknown>) => {
        return String(args[0]).includes("could not be queued");
      }),
    ).toBe(true);
  });

  test("a tick with no due monitors writes nothing and enqueues nothing", async () => {
    serveMonitors([
      // Due after this run's window: the next run queues it.
      makeMonitor({
        id: MONITOR_A_ID,
        nextMonitorAt: new Date(NOW + TELEMETRY_SCHEDULE_TICK_MS - 1),
      }),
    ]);

    const took: number = await onTheClock(
      enqueueDueTelemetryMonitorEvaluationJobs,
    );

    expect(took).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(monitorService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
    expect(monitorService.updateOneById).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  test("reads due monitors a keyset page at a time, in _id order, each page after the last", async () => {
    const monitors: Array<Monitor> = manyMonitors(
      TELEMETRY_SCHEDULE_PAGE_SIZE * 2 + 201,
    );
    serveMonitors(monitors);

    await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

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
    const stamped: Array<string> = stampStatements().flatMap(
      (statement: StampStatement): Array<string> => {
        return statement.ids;
      },
    );
    expect(stamped).toHaveLength(monitors.length);
    expect(new Set(stamped).size).toBe(monitors.length);
    expect(enqueueJobMock).toHaveBeenCalledTimes(monitors.length);
  });

  test("stamps at most a page in one statement, however many are due at once", async () => {
    // 1,201 never scheduled: all due now, a page a statement.
    serveMonitors(manyMonitors(TELEMETRY_SCHEDULE_PAGE_SIZE * 2 + 201));

    await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

    expect(
      stampStatements().map((statement: StampStatement) => {
        return statement.ids.length;
      }),
    ).toEqual([
      TELEMETRY_SCHEDULE_PAGE_SIZE,
      TELEMETRY_SCHEDULE_PAGE_SIZE,
      201,
    ]);
  });

  test("reads every page before it queues anything, then stamps each step before it queues the step's jobs", async () => {
    const events: Array<string> = [];

    serveMonitors(manyMonitors(TELEMETRY_SCHEDULE_PAGE_SIZE + 1));
    const read: jest.Mock = monitorService.findBy;
    const serve: (...args: Array<unknown>) => unknown =
      read.getMockImplementation()!;
    read.mockImplementation(async (...args: Array<unknown>) => {
      events.push("read");
      return serve(...args);
    });
    mockQuery.mockImplementation(
      async (_sql: string, params: Array<unknown>) => {
        events.push("stamp");
        return (params[1] as Array<string>).map((id: string) => {
          return { _id: id };
        });
      },
    );
    enqueueJobMock.mockImplementation(async () => {
      if (events[events.length - 1] !== "queue") {
        events.push("queue");
      }
    });

    await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

    expect(events).toEqual([
      "read",
      "read",
      "stamp",
      "queue",
      "stamp",
      "queue",
    ]);
  });

  test("queues never more than its limit of a step's jobs at once", async () => {
    serveMonitors(manyMonitors(TELEMETRY_SCHEDULE_PAGE_SIZE));

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

    await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

    expect(enqueueJobMock).toHaveBeenCalledTimes(TELEMETRY_SCHEDULE_PAGE_SIZE);
    expect(mostInFlight).toBe(TELEMETRY_SCHEDULE_ENQUEUE_CONCURRENCY);
  });

  test("stops between pages once its deadline passes, and queues nothing it read: another run may hold its lock", async () => {
    serveMonitors(manyMonitors(TELEMETRY_SCHEDULE_PAGE_SIZE * 3));
    const deadline: JobDeadline = new JobDeadline();

    // The time limit runs out while the first page is being read.
    const read: jest.Mock = monitorService.findBy;
    const serve: (...args: Array<unknown>) => unknown =
      read.getMockImplementation()!;
    read.mockImplementation(async (...args: Array<unknown>) => {
      deadline.end();
      return serve(...args);
    });

    await onTheClock(() => {
      return enqueueDueTelemetryMonitorEvaluationJobs(deadline);
    });

    expect(monitorService.findBy).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  test("stops while it waits once its deadline passes: what it queued stays queued, the rest stays due for the next run", async () => {
    serveMonitors([
      makeMonitor({ id: MONITOR_A_ID, nextMonitorAt: new Date(NOW + 1000) }),
      makeMonitor({ id: MONITOR_B_ID, nextMonitorAt: new Date(NOW + 8000) }),
    ]);
    const deadline: JobDeadline = new JobDeadline();

    enqueueJobMock.mockImplementation(async (job: { monitorId: ObjectID }) => {
      queuedAt.set(job.monitorId.toString(), [Date.now()]);
      // The run loses its lock once A is queued.
      setTimeout(() => {
        deadline.end();
      }, 2000);
    });

    const took: number = await onTheClock(() => {
      return enqueueDueTelemetryMonitorEvaluationJobs(deadline);
    });

    expect(queuedTimesOf(MONITOR_A_ID)).toEqual([NOW + 1000]);
    expect(queuedTimesOf(MONITOR_B_ID)).toEqual([]);
    expect(stampStatements()).toHaveLength(1);
    // It stopped when the deadline passed, not when B was due.
    expect(took).toBe(3000);
  });

  test("a step whose UPDATE fails fails the run before its jobs are queued", async () => {
    serveMonitors([makeMonitor({ id: MONITOR_A_ID })]);
    mockQuery.mockRejectedValue(
      new Error("canceling statement due to statement timeout"),
    );

    await expect(
      onTheClock(enqueueDueTelemetryMonitorEvaluationJobs),
    ).rejects.toThrow("statement timeout");
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  /*
   * Issue #11248: each job carries when its check was due - the end of the
   * window it judges - so a check that runs late judges the window it was
   * due to, and a monitor's windows follow on from one another exactly.
   */
  describe("when each check was due, carried on its job (#11248)", () => {
    // The due time each queued job carries, by monitor.
    function dueAtsOf(monitorId: ObjectID): Array<number> {
      return enqueueJobMock.mock.calls
        .map((args: Array<unknown>) => {
          return args[0] as { monitorId: ObjectID; dueAt?: Date };
        })
        .filter((job: { monitorId: ObjectID }) => {
          return job.monitorId.toString() === monitorId.toString();
        })
        .map((job: { dueAt?: Date }): number => {
          expect(job.dueAt).toBeInstanceOf(Date);
          return job.dueAt!.getTime();
        });
    }

    // A monitor's own moment of its interval: the first after `after`.
    function slotOf(
      monitorId: ObjectID,
      monitoringInterval: string | undefined,
      after: number,
    ): number {
      return TelemetryMonitorSchedule.getNextRunAt({
        monitorId,
        monitoringInterval,
        after: new Date(after),
      }).getTime();
    }

    test("an on-time check carries its own moment, not the moment its step was queued", async () => {
      // One step: A is queued with B, 60 ms after A was due.
      serveMonitors([
        makeMonitor({ id: MONITOR_A_ID, nextMonitorAt: new Date(NOW + 1000) }),
        makeMonitor({ id: MONITOR_B_ID, nextMonitorAt: new Date(NOW + 1060) }),
      ]);

      await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

      expect(queuedTimesOf(MONITOR_A_ID)).toEqual([NOW + 1060]);
      expect(dueAtsOf(MONITOR_A_ID)).toEqual([NOW + 1000]);
      expect(dueAtsOf(MONITOR_B_ID)).toEqual([NOW + 1060]);
      expect(stampFor(MONITOR_A_ID).dueAt.getTime()).toBe(NOW + 1000);
    });

    test("a check the run before should have queued - it died - carries the moment it was due, and its next is an interval after that", async () => {
      const slot: number = slotOf(MONITOR_A_ID, undefined, NOW);

      // The run that should have queued it died; the next starts 7 s late.
      jest.setSystemTime(slot + 7000);
      serveMonitors([
        makeMonitor({ id: MONITOR_A_ID, nextMonitorAt: new Date(slot) }),
      ]);

      await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

      const stamp: MonitorStamp = stampFor(MONITOR_A_ID);

      // Queued at once, judging the window that ends when it was due.
      expect(queuedTimesOf(MONITOR_A_ID)).toEqual([slot + 7000]);
      expect(dueAtsOf(MONITOR_A_ID)).toEqual([slot]);
      // Stamped only while still due by then, and next due a minute after it.
      expect(stamp.dueAt.getTime()).toBe(slot);
      expect(stamp.nextMonitorAt.getTime()).toBe(slot + MINUTE_MS);
    });

    test("a monitor checked every 5 minutes keeps the moment it was due when it is queued 4 minutes late", async () => {
      const slot: number = slotOf(MONITOR_B_ID, "*/5 * * * *", NOW);

      jest.setSystemTime(slot + 4 * MINUTE_MS);
      serveMonitors([
        makeMonitor({
          id: MONITOR_B_ID,
          monitoringInterval: "*/5 * * * *",
          nextMonitorAt: new Date(slot),
        }),
      ]);

      await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

      expect(dueAtsOf(MONITOR_B_ID)).toEqual([slot]);
      expect(stampFor(MONITOR_B_ID).nextMonitorAt.getTime()).toBe(
        slot + 5 * MINUTE_MS,
      );
    });

    test("a refused job is made due again at the moment it was due, and the next run queues it with that moment", async () => {
      const slot: number = slotOf(MONITOR_A_ID, undefined, NOW);
      const tick: number =
        Math.floor(slot / TELEMETRY_SCHEDULE_TICK_MS) *
        TELEMETRY_SCHEDULE_TICK_MS;
      const monitor: Monitor = makeMonitor({
        id: MONITOR_A_ID,
        nextMonitorAt: new Date(slot),
      });

      serveMonitors([monitor]);
      enqueueJobMock.mockRejectedValueOnce(new Error("redis connection reset"));

      // The run of the tick it is due in - or, in its last half second, the next.
      jest.setSystemTime(tick);
      await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

      if (returnStatements().length === 0) {
        jest.setSystemTime(tick + TELEMETRY_SCHEDULE_TICK_MS);
        await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);
      }

      // Made due again at its moment, not at the run's start.
      expect(returnStatements()).toEqual([
        {
          ids: [MONITOR_A_ID.toString()],
          dueAts: [new Date(slot)],
          nextMonitorAts: [new Date(slot + MINUTE_MS)],
        },
      ]);

      // What the return wrote, as the database holds it now.
      monitor.telemetryMonitorNextMonitorAt = new Date(slot);
      mockQuery.mockClear();
      enqueueJobMock.mockClear();
      sentAt.length = 0;

      jest.setSystemTime(
        Math.floor(Date.now() / TELEMETRY_SCHEDULE_TICK_MS) *
          TELEMETRY_SCHEDULE_TICK_MS +
          TELEMETRY_SCHEDULE_TICK_MS +
          37,
      );
      await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

      // The same check, judging the same window: due at its moment.
      expect(dueAtsOf(MONITOR_A_ID)).toEqual([slot]);
      expect(stampFor(MONITOR_A_ID).dueAt.getTime()).toBe(slot);
      expect(stampFor(MONITOR_A_ID).nextMonitorAt.getTime()).toBe(
        slot + MINUTE_MS,
      );
    });

    test("a monitor never scheduled - a new one - is checked at once, judging the window that ends as the run starts", async () => {
      jest.setSystemTime(NOW + 2468);
      serveMonitors([makeMonitor({ id: MONITOR_A_ID })]);

      await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

      expect(dueAtsOf(MONITOR_A_ID)).toEqual([NOW + 2468]);
      expect(stampFor(MONITOR_A_ID).dueAt.getTime()).toBe(NOW + 2468);
    });

    test("a monitor whose runs went by while it was not checked - it was off, or the scheduler was - judges the window that ends as it is queued", async () => {
      const now: number = NOW + 7 * MINUTE_MS + 3000;

      jest.setSystemTime(now);
      serveMonitors([
        makeMonitor({ id: MONITOR_A_ID, nextMonitorAt: new Date(NOW + 21000) }),
      ]);

      await onTheClock(enqueueDueTelemetryMonitorEvaluationJobs);

      expect(dueAtsOf(MONITOR_A_ID)).toEqual([now]);
      expect(stampFor(MONITOR_A_ID).nextMonitorAt.getTime()).toBe(
        slotOf(MONITOR_A_ID, undefined, now),
      );
    });

    test("a monitor due again exactly an interval after it was due is late by its whole interval: its run went by", () => {
      const nextMonitorAtMs: number = NOW - MINUTE_MS;

      expect(
        getTelemetryEvaluationDueAt({
          nextMonitorAtMs,
          queueAtMs: NOW,
          runAfterNextMonitorAtMs: NOW,
          dispatchedAt: new Date(NOW),
        }),
      ).toBe(NOW);
    });

    test.each([
      {
        name: "never scheduled: the run's start",
        nextMonitorAtMs: null,
        runAfterNextMonitorAtMs: null,
        dispatchedAtMs: NOW + 5,
        expected: NOW,
      },
      {
        name: "on time: its own moment",
        nextMonitorAtMs: NOW + 4321,
        runAfterNextMonitorAtMs: NOW + 4321 + MINUTE_MS,
        dispatchedAtMs: NOW + 4330,
        expected: NOW + 4321,
      },
      {
        name: "late by less than its interval: its own moment",
        nextMonitorAtMs: NOW - 59000,
        runAfterNextMonitorAtMs: NOW + 1000,
        dispatchedAtMs: NOW + 20,
        expected: NOW - 59000,
      },
      {
        name: "its next run came while the run read it: the run's start",
        nextMonitorAtMs: NOW - 59990,
        runAfterNextMonitorAtMs: NOW + 10,
        dispatchedAtMs: NOW + 25,
        expected: NOW,
      },
      {
        name: "late by many intervals: the run's start",
        nextMonitorAtMs: NOW - 3 * MINUTE_MS,
        runAfterNextMonitorAtMs: NOW - 2 * MINUTE_MS,
        dispatchedAtMs: NOW,
        expected: NOW,
      },
    ])(
      "getTelemetryEvaluationDueAt - $name",
      (data: {
        nextMonitorAtMs: number | null;
        runAfterNextMonitorAtMs: number | null;
        dispatchedAtMs: number;
        expected: number;
      }) => {
        expect(
          getTelemetryEvaluationDueAt({
            nextMonitorAtMs: data.nextMonitorAtMs,
            queueAtMs: Math.max(data.nextMonitorAtMs ?? NOW, NOW),
            runAfterNextMonitorAtMs: data.runAfterNextMonitorAtMs,
            dispatchedAt: new Date(data.dispatchedAtMs),
          }),
        ).toBe(data.expected);
      },
    );

    test.each([
      {
        name: "the due time it carries, as a date",
        job: { dueAt: new Date(NOW - 5000), queuedAt: new Date(NOW - 4900) },
        expected: NOW - 5000,
      },
      {
        name: "the due time it carries, as the ISO text the queue keeps",
        job: {
          dueAt: new Date(NOW - 5000).toISOString(),
          queuedAt: new Date(NOW - 4900).toISOString(),
        },
        expected: NOW - 5000,
      },
      {
        name: "a job queued before due times were carried: when it was queued",
        job: { queuedAt: new Date(NOW - 4900).toISOString() },
        expected: NOW - 4900,
      },
      {
        name: "a due time that cannot be read: when it was queued",
        job: { dueAt: "yesterday", queuedAt: new Date(NOW - 4900) },
        expected: NOW - 4900,
      },
      {
        name: "an empty due time: when it was queued",
        job: { dueAt: "", queuedAt: new Date(NOW - 4900) },
        expected: NOW - 4900,
      },
      {
        name: "the start of the epoch is no due time",
        job: { dueAt: new Date(0), queuedAt: new Date(NOW - 4900) },
        expected: NOW - 4900,
      },
      {
        name: "neither: now",
        job: { queuedAt: "not a date" },
        expected: NOW,
      },
      {
        name: "a due time to come - another server's clock ahead: now",
        job: { dueAt: new Date(NOW + 900), queuedAt: new Date(NOW + 900) },
        expected: NOW,
      },
    ])(
      "getTelemetryEvaluationWindowEnd - $name",
      (data: { job: Record<string, unknown>; expected: number }) => {
        expect(
          getTelemetryEvaluationWindowEnd({
            job: {
              monitorId: MONITOR_A_ID.toString(),
              ...data.job,
            } as unknown as Parameters<
              typeof getTelemetryEvaluationWindowEnd
            >[0]["job"],
            now: new Date(NOW),
          }).getTime(),
        ).toBe(data.expected);
      },
    );
  });
});
