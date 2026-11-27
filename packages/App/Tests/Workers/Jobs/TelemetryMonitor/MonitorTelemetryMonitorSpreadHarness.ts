import Monitor from "Common/Models/DatabaseModels/Monitor";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import ObjectID from "Common/Types/ObjectID";
import { SeededRandom } from "Common/Tests/Helpers/SeededRandom";

/*
 * THE TELEMETRY SCHEDULER, RUN AGAINST MONITORS IN MEMORY (issue #11060).
 *
 * What MonitorTelemetryMonitorSpread.test.ts and
 * TelemetryMonitorEvaluationSpreadClickhouse.test.ts run the scheduler
 * with: monitors held in memory, served to the scheduler's reads as
 * Postgres serves them (due by the time a read asks for, a keyset page at a
 * time), and the scheduler's statements applied to them as Postgres applies
 * them - this release's (a monitor stamped only while still due, and made
 * due again when its job was refused) and the scheduler's before #11060
 * (every id stamped with one next due time), so the same tests run against
 * either. The scheduler and its schedule are the ones its cron
 * registration hands RunCron.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export const SECOND_MS: number = 1000;
export const MINUTE_MS: number = 60 * SECOND_MS;
export const HOUR_MS: number = 60 * MINUTE_MS;

/*
 * How late after its due time an evaluation may be queued and still count
 * as on time: the scheduler's step (100 ms), its margin before the next
 * tick (500 ms) and a run's start latency.
 */
export const ON_TIME_MS: number = 700;

// The simulation starts two minutes before the hour.
export const FROM: number = Date.UTC(2026, 10, 26, 8, 58, 0, 0);

/*
 * When every monitor has moved to its own moment: the old scheduler left
 * the last of them due at 09:00:00 (every 5 minutes, every hour), and each
 * is evaluated then once more, as it had it due, before its own moment.
 */
export const SETTLED: number = FROM + 3 * MINUTE_MS;

export type SchedulerRun = (deadline?: JobDeadline) => Promise<void>;

interface ReadFindOperator {
  getSql?: ((aliasPath: string) => string) | undefined;
  objectLiteralParameters?: Record<string, unknown> | undefined;
}

export interface StoredMonitor {
  id: string;
  monitoringInterval: string | undefined;
  intervalMs: number;
  nextMonitorAt: Date | null;
  lastMonitorAt: Date | null;
}

export interface Population {
  monitoringInterval: string | undefined;
  intervalMs: number;
  count: number;
}

// Most of an installation's telemetry monitors are the Dashboard's: no interval.
export const POPULATION: Array<Population> = [
  { monitoringInterval: undefined, intervalMs: MINUTE_MS, count: 200 },
  { monitoringInterval: "* * * * *", intervalMs: MINUTE_MS, count: 40 },
  { monitoringInterval: "*/2 * * * *", intervalMs: 2 * MINUTE_MS, count: 30 },
  { monitoringInterval: "*/5 * * * *", intervalMs: 5 * MINUTE_MS, count: 20 },
  { monitoringInterval: "0 * * * *", intervalMs: HOUR_MS, count: 10 },
];

export interface SimulationOptions {
  minutes: number;
  random: SeededRandom;
  // How many runs start together at a tick: more than one is a lock that failed open.
  runsPerTick?: number | undefined;
  // The run's deadline ends this long after it starts: a worker that dies.
  diesAfterMs?: ((run: number) => number | null) | undefined;
  // Before each run: a new process, say.
  beforeRun?: ((run: number) => void) | undefined;
}

// What a stretch of the simulation measured.
export interface SpreadReport {
  evaluations: number;
  // The share of them that started in the first 10 seconds of a minute.
  shareInTheFirstTenSeconds: number;
  // The most started in any one second.
  busiestSecond: number;
  // The most started in any one second of the minute, over the stretch.
  busiestSecondOfTheMinute: number;
  // Monitors that waited longer than their interval at least once.
  monitorsThatSkipped: number;
  // How many intervals in all went without an evaluation.
  intervalsSkipped: number;
}

/*
 * The scheduler's tick, from its schedule: a cron every N seconds, or every
 * minute.
 */
const EVERY_N_SECONDS: RegExp = /^\*\/\d+$/;

export function tickEveryMs(schedule: string): number {
  const fields: Array<string> = schedule.trim().split(/\s+/);

  if (fields.length === 6 && EVERY_N_SECONDS.test(fields[0]!)) {
    return Number(fields[0]!.slice(2)) * SECOND_MS;
  }

  if (
    fields.length === 5 &&
    fields.every((field: string): boolean => {
      return field === "*";
    })
  ) {
    return MINUTE_MS;
  }

  throw new Error(`The simulation does not know the schedule "${schedule}".`);
}

export function gapsOf(times: Array<number>): Array<number> {
  return times.slice(1).map((time: number, index: number): number => {
    return time - times[index]!;
  });
}

export function total(values: Array<number>): number {
  return values.reduce((sum: number, value: number): number => {
    return sum + value;
  }, 0);
}

/*
 * How far apart moments of an interval are, on its circle: the interval
 * less the longest stretch of it with none of them.
 */
export function circularSpread(moments: Array<number>, period: number): number {
  const sorted: Array<number> = [...moments].sort((a: number, b: number) => {
    return a - b;
  });
  let longestEmpty: number = sorted[0]! + period - sorted[sorted.length - 1]!;

  for (let index: number = 1; index < sorted.length; index++) {
    longestEmpty = Math.max(longestEmpty, sorted[index]! - sorted[index - 1]!);
  }

  return period - longestEmpty;
}

function cursorOf(query: Record<string, unknown>): string | undefined {
  const cursor: ReadFindOperator | undefined = query["_id"] as
    | ReadFindOperator
    | undefined;

  return cursor
    ? String(Object.values(cursor.objectLiteralParameters!)[0])
    : undefined;
}

function dueByOf(query: Record<string, unknown>): number {
  const operator: ReadFindOperator = query[
    "telemetryMonitorNextMonitorAt"
  ] as ReadFindOperator;

  return (
    Object.values(operator.objectLiteralParameters!)[0] as Date
  ).getTime();
}

async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 4; turn++) {
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
  }
}

/*
 * Runs the given runs to their end on jest's fake clock: whenever they wait
 * on a timer, the clock moves on to it.
 */
export async function onTheFakeClock(
  runs: Array<() => Promise<void>>,
): Promise<void> {
  const state: { isDone: boolean; failure: unknown } = {
    isDone: false,
    failure: undefined,
  };

  Promise.all(
    runs.map((run: () => Promise<void>): Promise<void> => {
      return run();
    }),
  ).then(
    () => {
      state.isDone = true;
    },
    (error: unknown) => {
      state.failure = error;
      state.isDone = true;
    },
  );

  for (let turn: number = 0; turn < 100000 && !state.isDone; turn++) {
    await settle();

    if (!state.isDone && jest.getTimerCount() > 0) {
      jest.advanceTimersToNextTimer();
    }
  }

  if (!state.isDone) {
    throw new Error("A run did not finish.");
  }

  if (state.failure) {
    throw state.failure;
  }
}

export class SpreadHarness {
  public readonly store: Map<string, StoredMonitor> = new Map();
  public sortedIds: Array<string> = [];

  // When each monitor's evaluation was queued, by monitor.
  public readonly dispatches: Map<string, Array<number>> = new Map();

  public constructor(
    private readonly data: {
      findBy: jest.Mock;
      query: jest.Mock;
      enqueueJob: jest.Mock;
      schedule: string;
      runScheduler: SchedulerRun;
      projectId: ObjectID;
    },
  ) {}

  /*
   * The monitors as the scheduler before #11060 left them a minute before
   * FROM: one with a schedule due at its next run, one without due a minute
   * after that run started (it started 37 ms after its tick).
   */
  public seed(population: Array<Population> = POPULATION): void {
    this.store.clear();
    this.dispatches.clear();

    let index: number = 0;
    const lastOldRun: number = FROM - MINUTE_MS;

    for (const group of population) {
      for (let member: number = 0; member < group.count; member++) {
        const id: string = `11060000-0000-4000-8000-${String(index).padStart(12, "0")}`;
        index++;

        let nextMonitorAt: number;

        if (!group.monitoringInterval) {
          nextMonitorAt = lastOldRun + 37 + MINUTE_MS;
        } else {
          // The schedule's run after the old run: a whole minute, hour ...
          nextMonitorAt = FROM;

          while (nextMonitorAt % group.intervalMs !== 0) {
            nextMonitorAt += MINUTE_MS;
          }
        }

        this.store.set(id, {
          id,
          monitoringInterval: group.monitoringInterval,
          intervalMs: group.intervalMs,
          nextMonitorAt: new Date(nextMonitorAt),
          lastMonitorAt: new Date(lastOldRun),
        });
      }
    }

    this.sortedIds = Array.from(this.store.keys()).sort();
  }

  // The monitors due by the time a read asks for, a keyset page at a time.
  public serveFromTheStore(): void {
    this.data.findBy.mockImplementation(
      async (args: {
        query: Record<string, unknown>;
        limit: number;
      }): Promise<Array<Monitor>> => {
        const after: string | undefined = cursorOf(args.query);
        const dueBy: number = dueByOf(args.query);

        return this.sortedIds
          .filter((id: string): boolean => {
            const next: Date | null = this.store.get(id)!.nextMonitorAt;

            return (
              (after === undefined || id > after) &&
              (next === null || next.getTime() <= dueBy)
            );
          })
          .slice(0, args.limit)
          .map((id: string): Monitor => {
            return this.asMonitor(this.store.get(id)!);
          });
      },
    );
  }

  // The scheduler's statements, applied to the monitors as Postgres applies them.
  public applyStatementsToTheStore(): void {
    this.data.query.mockImplementation(
      async (sql: string, params: Array<unknown>): Promise<unknown> => {
        if (sql.startsWith('WITH "stamped"')) {
          const [lastMonitorAt, ids, dueAts, nextMonitorAts]: [
            Date,
            Array<string>,
            Array<Date>,
            Array<Date>,
          ] = params as [Date, Array<string>, Array<Date>, Array<Date>];
          const stamped: Array<{ _id: string }> = [];

          ids.forEach((id: string, index: number) => {
            const monitor: StoredMonitor = this.store.get(id)!;

            if (
              monitor.nextMonitorAt === null ||
              monitor.nextMonitorAt.getTime() < dueAts[index]!.getTime() + 1
            ) {
              monitor.nextMonitorAt = new Date(nextMonitorAts[index]!);
              monitor.lastMonitorAt = new Date(lastMonitorAt);
              stamped.push({ _id: id });
            }
          });

          return stamped;
        }

        if (sql.includes('"failed"')) {
          const [ids, dueAts, nextMonitorAts]: [
            Array<string>,
            Array<Date>,
            Array<Date>,
          ] = params as [Array<string>, Array<Date>, Array<Date>];

          ids.forEach((id: string, index: number) => {
            const monitor: StoredMonitor = this.store.get(id)!;

            if (
              monitor.nextMonitorAt?.getTime() ===
              nextMonitorAts[index]!.getTime()
            ) {
              monitor.nextMonitorAt = new Date(dueAts[index]!);
            }
          });

          return [];
        }

        // The scheduler before #11060.
        if (
          sql.startsWith('UPDATE "Monitor" SET "telemetryMonitorLastMonitorAt"')
        ) {
          const [lastMonitorAt, nextMonitorAt, ids]: [
            Date,
            Date,
            Array<string>,
          ] = params as [Date, Date, Array<string>];

          for (const id of ids) {
            const monitor: StoredMonitor = this.store.get(id)!;
            monitor.nextMonitorAt = new Date(nextMonitorAt);
            monitor.lastMonitorAt = new Date(lastMonitorAt);
          }

          return [];
        }

        throw new Error(`An unexpected statement: ${sql}`);
      },
    );
  }

  /*
   * Each job queued is recorded with the time on the clock, and handed to
   * `onQueued` (a worker, say). A queue that `refuses` a monitor's job
   * throws instead.
   */
  public recordDispatches(options?: {
    refuses?: ((monitorId: string) => boolean) | undefined;
    onQueued?: ((monitorId: string) => void) | undefined;
  }): void {
    this.data.enqueueJob.mockImplementation(
      async (job: { monitorId: ObjectID }): Promise<void> => {
        const id: string = job.monitorId.toString();

        if (options?.refuses?.(id)) {
          throw new Error("the queue refused the job");
        }

        const times: Array<number> = this.dispatches.get(id) || [];
        times.push(Date.now());
        this.dispatches.set(id, times);

        options?.onQueued?.(id);
      },
    );
  }

  /*
   * Runs the scheduler at every tick of its schedule for `minutes` on jest's
   * fake clock, as the Worker queue runs it: one run at a time (a tick that
   * comes while a run holds the lock is skipped), each starting 2 to 80 ms
   * after its tick.
   */
  public async simulate(options: SimulationOptions): Promise<void> {
    const tickMs: number = tickEveryMs(this.data.schedule);
    let busyUntil: number = Number.NEGATIVE_INFINITY;
    let run: number = 0;

    for (
      let tick: number = FROM;
      tick < FROM + options.minutes * MINUTE_MS;
      tick += tickMs
    ) {
      const startsAt: number = tick + 2 + options.random(79);

      if (startsAt < busyUntil) {
        continue;
      }

      options.beforeRun?.(run);
      jest.setSystemTime(startsAt);

      const dieAfter: number | null = options.diesAfterMs?.(run) ?? null;

      await onTheFakeClock(
        Array.from({ length: options.runsPerTick || 1 }, () => {
          return async (): Promise<void> => {
            const deadline: JobDeadline = new JobDeadline();
            let timer: ReturnType<typeof setTimeout> | null = null;

            if (dieAfter !== null) {
              timer = setTimeout(() => {
                deadline.end();
              }, dieAfter);
            }

            try {
              await this.data.runScheduler(deadline);
            } finally {
              if (timer) {
                clearTimeout(timer);
              }
            }
          };
        }),
      );

      busyUntil = Date.now();
      run++;
    }
  }

  public intervalOf(id: string): number {
    return this.store.get(id)!.intervalMs;
  }

  // A monitor's evaluations from `from` on.
  public timesOf(id: string, from: number = FROM): Array<number> {
    return (this.dispatches.get(id) || []).filter((time: number): boolean => {
      return time >= from;
    });
  }

  /*
   * Every monitor's evaluations, from `from` on: each its interval after the
   * one before, within `toleranceMs`. What does not hold, by monitor.
   */
  public offIntervalGaps(data: {
    from: number;
    toleranceMs: number;
  }): Array<string> {
    const off: Array<string> = [];

    for (const id of this.sortedIds) {
      for (const gap of gapsOf(this.timesOf(id, data.from))) {
        if (Math.abs(gap - this.intervalOf(id)) > data.toleranceMs) {
          off.push(
            `${id} (${this.store.get(id)!.monitoringInterval || "no interval"}): ${gap} ms between two evaluations, its interval is ${this.intervalOf(id)} ms`,
          );
          break;
        }
      }
    }

    return off;
  }

  // The evaluations queued from `from` on, by second of the minute.
  public bySecondOfTheMinute(from: number): Array<number> {
    const seconds: Array<number> = new Array<number>(60).fill(0);

    for (const times of this.dispatches.values()) {
      for (const time of times) {
        if (time >= from) {
          seconds[Math.floor((time % MINUTE_MS) / SECOND_MS)]! += 1;
        }
      }
    }

    return seconds;
  }

  // The most evaluations queued in any one second, from `from` on.
  public busiestSecond(from: number): number {
    const perSecond: Map<number, number> = new Map();

    for (const times of this.dispatches.values()) {
      for (const time of times) {
        if (time >= from) {
          const second: number = Math.floor(time / SECOND_MS);
          perSecond.set(second, (perSecond.get(second) || 0) + 1);
        }
      }
    }

    return Math.max(0, ...perSecond.values());
  }

  // Every monitor's evaluations in [from, to): how many it had.
  public countsIn(from: number, to: number): Map<string, number> {
    const counts: Map<string, number> = new Map();

    for (const id of this.sortedIds) {
      counts.set(
        id,
        (this.dispatches.get(id) || []).filter((time: number): boolean => {
          return time >= from && time < to;
        }).length,
      );
    }

    return counts;
  }

  // What the stretch from `from` on measured.
  public report(from: number): SpreadReport {
    const seconds: Array<number> = this.bySecondOfTheMinute(from);
    const evaluations: number = total(seconds);
    let monitorsThatSkipped: number = 0;
    let intervalsSkipped: number = 0;

    for (const id of this.sortedIds) {
      let skipped: number = 0;

      for (const gap of gapsOf(this.timesOf(id, from))) {
        skipped += Math.max(0, Math.round(gap / this.intervalOf(id)) - 1);
      }

      if (skipped > 0) {
        monitorsThatSkipped++;
        intervalsSkipped += skipped;
      }
    }

    return {
      evaluations,
      shareInTheFirstTenSeconds:
        evaluations === 0 ? 0 : total(seconds.slice(0, 10)) / evaluations,
      busiestSecond: this.busiestSecond(from),
      busiestSecondOfTheMinute: Math.max(...seconds),
      monitorsThatSkipped,
      intervalsSkipped,
    };
  }

  private asMonitor(stored: StoredMonitor): Monitor {
    const monitor: Monitor = new Monitor(new ObjectID(stored.id));
    monitor.projectId = this.data.projectId;

    if (stored.monitoringInterval) {
      monitor.monitoringInterval = stored.monitoringInterval;
    }

    if (stored.nextMonitorAt) {
      monitor.telemetryMonitorNextMonitorAt = new Date(stored.nextMonitorAt);
    }

    return monitor;
  }
}
