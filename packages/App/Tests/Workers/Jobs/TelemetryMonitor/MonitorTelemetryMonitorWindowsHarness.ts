import JobDeadline from "Common/Server/Utils/JobDeadline";
import ObjectID from "Common/Types/ObjectID";
import { SeededRandom } from "Common/Tests/Helpers/SeededRandom";
import { TelemetryMonitorEvaluationJobData } from "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import {
  FROM,
  MINUTE_MS,
  SchedulerRun,
  onTheFakeClock,
  tickEveryMs,
} from "./MonitorTelemetryMonitorSpreadHarness";

/*
 * THE TELEMETRY QUEUE, AND THE WINDOWS ITS CHECKS JUDGE (issue #11248).
 *
 * What MonitorTelemetryMonitorWindows.test.ts runs the scheduler and the
 * evaluation job with: the real scheduler (its cron registration, on the
 * monitors MonitorTelemetryMonitorSpreadHarness keeps in memory) queueing
 * each check, and a model of the Telemetry queue running the real
 * evaluation job (processTelemetryMonitorEvaluationFromQueue) on each one
 * as BullMQ would:
 *
 *   - Its workers: `workers` at once, oldest job first; a check holds its
 *     worker for as long as its reads take (holdMs), and other monitoring
 *     work - a probe's results, all at once - holds them too (addWork).
 *   - Its deduplication: a monitor's evaluations are never run at once
 *     (TelemetryQueueService.addTelemetryMonitorEvaluationJob,
 *     keepLastIfActive). A check queued while the monitor's last one is
 *     still waiting is dropped; one queued while it runs waits for it to
 *     finish, the latest kept (Queue.addJob says so).
 *   - Its retries: a check that fails is tried again with the same data 5
 *     and 10 seconds later (three attempts, exponential backoff, as
 *     Queue.addJob sets them for the Telemetry queue); a check queued while
 *     the one before waits out its backoff is dropped.
 *   - How far behind ingest is: the oldest job still waiting, which
 *     TelemetryIngestBacklog reads - the oldest monitoring job that is not
 *     a retry, or the oldest bulk telemetry job waiting behind it
 *     (bulkHeadAt: telemetry is read only once monitoring work is done).
 *
 * Everything runs on jest's fake clock, moved on from timer to timer
 * (runWithQueue), so a worker finishes, a retry comes due and the
 * scheduler's next tick starts each at its own moment.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export const RETRY_BACKOFF_MS: number = 5000;
export const ATTEMPTS: number = 3;

// A job on the model's queue.
interface QueuedJob {
  id: number;
  // A monitor's check, or other monitoring work (no monitor).
  monitorId: string | null;
  data: TelemetryMonitorEvaluationJobData | null;
  addedAt: number;
  attemptsMade: number;
  holdMs: number;
}

export interface QueueModelOptions {
  workers: number;
  // How long a check holds its worker, after its evaluation has read.
  holdMs: (monitorId: string) => number;
  // Whether this attempt of a check fails (its read timed out, say).
  fails?: ((monitorId: string, attempt: number) => boolean) | undefined;
  /*
   * When the oldest bulk telemetry job still waiting was added, if one is:
   * none while ingest keeps up.
   */
  bulkHeadAt?: ((now: number) => number | null) | undefined;
  // What the job's evaluation is handed: the job's data, or less.
  dataForEvaluation?:
    | ((
        data: TelemetryMonitorEvaluationJobData,
      ) => TelemetryMonitorEvaluationJobData)
    | undefined;
}

// What the model saw happen to the checks the scheduler queued.
export interface QueueModelCounts {
  added: number;
  // Queued while the monitor's last check still waited: dropped.
  droppedWhileWaiting: number;
  // Queued while it ran: run once it finished, the latest kept.
  keptForAfterActive: number;
  // Kept, then replaced by a later one before it ran.
  replacedWhileActive: number;
  failedAttempts: number;
  retried: number;
  // Failed every attempt.
  failed: number;
  completed: number;
}

export class TelemetryQueueModel {
  public readonly counts: QueueModelCounts = {
    added: 0,
    droppedWhileWaiting: 0,
    keptForAfterActive: 0,
    replacedWhileActive: 0,
    failedAttempts: 0,
    retried: 0,
    failed: 0,
    completed: 0,
  };

  // The longest a check waited in the queue before a worker took it.
  public longestWaitMs: number = 0;

  // When each check dropped while its monitor's last one still waited was queued.
  public readonly droppedAt: Array<number> = [];

  private waiting: Array<QueuedJob> = [];
  private active: number = 0;
  private nextId: number = 1;

  // A monitor's job waiting, waiting out a backoff, or running.
  private readonly holder: Map<string, { job: QueuedJob; isActive: boolean }> =
    new Map();

  // A monitor's check queued while its last one ran.
  private readonly keptForAfter: Map<
    string,
    TelemetryMonitorEvaluationJobData
  > = new Map();

  public constructor(
    private readonly options: QueueModelOptions,
    /*
     * The real evaluation job, handed what the queue's job holds (or less,
     * dataForEvaluation) and the job as the scheduler queued it.
     */
    private readonly evaluate: (
      data: TelemetryMonitorEvaluationJobData,
      queued: TelemetryMonitorEvaluationJobData,
    ) => Promise<void>,
  ) {}

  // A check, as the scheduler queues it.
  public addCheck(data: TelemetryMonitorEvaluationJobData): void {
    const monitorId: string = data.monitorId;
    const held: { job: QueuedJob; isActive: boolean } | undefined =
      this.holder.get(monitorId);

    this.counts.added++;

    if (held && !held.isActive) {
      this.counts.droppedWhileWaiting++;
      this.droppedAt.push(Date.now());
      return;
    }

    if (held && held.isActive) {
      if (this.keptForAfter.has(monitorId)) {
        this.counts.replacedWhileActive++;
      }

      this.keptForAfter.set(monitorId, data);
      this.counts.keptForAfterActive++;
      return;
    }

    this.enqueueCheck(data);
  }

  // Other monitoring work, all at once: `count` jobs of `holdMs` each.
  public addWork(count: number, holdMs: number): void {
    for (let index: number = 0; index < count; index++) {
      this.waiting.push({
        id: this.nextId++,
        monitorId: null,
        data: null,
        addedAt: Date.now(),
        attemptsMade: 0,
        holdMs: holdMs,
      });
    }

    this.pump();
  }

  /*
   * When the oldest job still waiting was added, as TelemetryIngestBacklog
   * reads it: a retry says nothing (its add time is its first), and bulk
   * telemetry waits behind the monitoring work.
   */
  public oldestWaitingSince(): Date | null {
    let oldest: number | null = this.options.bulkHeadAt?.(Date.now()) ?? null;

    const head: QueuedJob | undefined = this.waiting[0];

    if (head && head.attemptsMade === 0) {
      oldest = oldest === null ? head.addedAt : Math.min(oldest, head.addedAt);
    }

    return oldest === null ? null : new Date(oldest);
  }

  public isIdle(): boolean {
    return this.active === 0 && this.waiting.length === 0;
  }

  private enqueueCheck(data: TelemetryMonitorEvaluationJobData): void {
    const job: QueuedJob = {
      id: this.nextId++,
      monitorId: data.monitorId,
      data: data,
      addedAt: Date.now(),
      attemptsMade: 0,
      holdMs: 0,
    };

    this.holder.set(data.monitorId, { job, isActive: false });
    this.waiting.push(job);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.options.workers && this.waiting.length > 0) {
      const job: QueuedJob = this.waiting.shift()!;
      this.active++;
      void this.run(job);
    }
  }

  private async run(job: QueuedJob): Promise<void> {
    if (!job.monitorId || !job.data) {
      this.holdThenFree(job.holdMs, () => {
        // Other work: nothing follows it.
      });
      return;
    }

    const monitorId: string = job.monitorId;

    if (job.attemptsMade === 0) {
      this.longestWaitMs = Math.max(
        this.longestWaitMs,
        Date.now() - job.addedAt,
      );
    }

    this.holder.set(monitorId, { job, isActive: true });

    const attempt: number = job.attemptsMade + 1;
    let failure: unknown = undefined;

    try {
      if (this.options.fails?.(monitorId, attempt)) {
        throw new Error("the check's read timed out");
      }

      await this.evaluate(
        this.options.dataForEvaluation
          ? this.options.dataForEvaluation(job.data)
          : job.data,
        job.data,
      );
    } catch (error) {
      failure = error;
    }

    this.holdThenFree(this.options.holdMs(monitorId), () => {
      if (failure !== undefined) {
        this.counts.failedAttempts++;
        job.attemptsMade = attempt;

        if (attempt < ATTEMPTS) {
          // Waits out its backoff, holding its monitor's place.
          this.counts.retried++;
          this.holder.set(monitorId, { job, isActive: false });

          setTimeout(
            () => {
              this.waiting.push(job);
              this.pump();
            },
            RETRY_BACKOFF_MS * Math.pow(2, attempt - 1),
          );
          return;
        }

        this.counts.failed++;
      } else {
        this.counts.completed++;
      }

      this.holder.delete(monitorId);

      // The check queued while this one ran, now its own job.
      const kept: TelemetryMonitorEvaluationJobData | undefined =
        this.keptForAfter.get(monitorId);

      if (kept) {
        this.keptForAfter.delete(monitorId);
        this.enqueueCheck(kept);
      }
    });
  }

  private holdThenFree(holdMs: number, then: () => void): void {
    setTimeout(
      () => {
        this.active--;
        then();
        this.pump();
      },
      Math.max(0, holdMs),
    );
  }
}

// One window a check judged, as its evaluation handed it on.
export interface JudgedWindow {
  monitorId: string;
  startsAt: number;
  endsAt: number;
  // When the check ran, and when it was due (null: its job carried none).
  ranAt: number;
  dueAt: number | null;
}

// How a monitor's windows lie against one another, in a stretch.
export interface TilingReport {
  windows: number;
  // Consecutive windows where one does not start where the last ended.
  breaks: number;
  // Time between windows judged by no check, in all.
  gapMs: number;
  // Time judged by two checks, in all.
  overlapMs: number;
  largestGapMs: number;
  largestOverlapMs: number;
}

/*
 * Each monitor's windows ending in [from, to), in order: how many follow on
 * from the one before exactly, and the time between them judged by none or
 * by two.
 */
export function tilingOf(
  windows: Array<JudgedWindow>,
  data: { from: number; to: number },
): TilingReport {
  const byMonitor: Map<string, Array<JudgedWindow>> = new Map();

  for (const window of windows) {
    if (window.endsAt < data.from || window.endsAt >= data.to) {
      continue;
    }

    const list: Array<JudgedWindow> = byMonitor.get(window.monitorId) || [];
    list.push(window);
    byMonitor.set(window.monitorId, list);
  }

  const report: TilingReport = {
    windows: 0,
    breaks: 0,
    gapMs: 0,
    overlapMs: 0,
    largestGapMs: 0,
    largestOverlapMs: 0,
  };

  for (const list of byMonitor.values()) {
    list.sort((a: JudgedWindow, b: JudgedWindow): number => {
      return a.endsAt - b.endsAt;
    });

    report.windows += list.length;

    for (let index: number = 1; index < list.length; index++) {
      const between: number = list[index]!.startsAt - list[index - 1]!.endsAt;

      if (between !== 0) {
        report.breaks++;
      }

      if (between > 0) {
        report.gapMs += between;
        report.largestGapMs = Math.max(report.largestGapMs, between);
      }

      if (between < 0) {
        report.overlapMs += -between;
        report.largestOverlapMs = Math.max(report.largestOverlapMs, -between);
      }
    }
  }

  return report;
}

export interface WindowsSimulationOptions {
  minutes: number;
  random: SeededRandom;
  // The run's deadline ends this long after it starts: a worker that dies.
  diesAfterMs?: ((run: number) => number | null) | undefined;
  // At each tick, before its run: other monitoring work, say.
  atTick?: ((tick: number) => void) | undefined;
}

/*
 * Runs the scheduler at every tick of its schedule for `minutes`, one run at
 * a time (a tick that comes while a run holds the lock is skipped), each
 * starting 2 to 80 ms after its tick - as the spread harness does, except
 * that the clock is moved on to each tick through every timer before it, so
 * the queue's workers, retries and backoffs run at their own moments
 * between the scheduler's runs. Then lets the queue finish.
 */
export async function runWithQueue(data: {
  schedule: string;
  runScheduler: SchedulerRun;
  queue: TelemetryQueueModel;
  options: WindowsSimulationOptions;
}): Promise<void> {
  const tickMs: number = tickEveryMs(data.schedule);
  let busyUntil: number = Number.NEGATIVE_INFINITY;
  let run: number = 0;

  for (
    let tick: number = FROM;
    tick < FROM + data.options.minutes * MINUTE_MS;
    tick += tickMs
  ) {
    const startsAt: number = tick + 2 + data.options.random(79);

    if (startsAt < busyUntil) {
      continue;
    }

    await moveClockTo(startsAt);
    data.options.atTick?.(tick);

    const dieAfter: number | null = data.options.diesAfterMs?.(run) ?? null;

    await onTheFakeClock([
      async (): Promise<void> => {
        const deadline: JobDeadline = new JobDeadline();
        let timer: ReturnType<typeof setTimeout> | null = null;

        if (dieAfter !== null) {
          timer = setTimeout(() => {
            deadline.end();
          }, dieAfter);
        }

        try {
          await data.runScheduler(deadline);
        } finally {
          if (timer) {
            clearTimeout(timer);
          }
        }
      },
    ]);

    busyUntil = Date.now();
    run++;
  }

  // What is still queued or running finishes.
  for (let turn: number = 0; turn < 100000 && !data.queue.isIdle(); turn++) {
    await settleTurns();

    if (!data.queue.isIdle() && jest.getTimerCount() > 0) {
      jest.advanceTimersToNextTimer();
    }
  }

  await settleTurns();
}

async function settleTurns(): Promise<void> {
  for (let turn: number = 0; turn < 4; turn++) {
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
  }
}

/*
 * Moves the fake clock on to `atMs`, firing each timer before it in turn and
 * letting what each one starts run before the next: a timer of its own at
 * `atMs` keeps the clock from moving past it.
 */
async function moveClockTo(atMs: number): Promise<void> {
  if (Date.now() >= atMs) {
    return;
  }

  const state: { isThere: boolean } = { isThere: false };
  const there: ReturnType<typeof setTimeout> = setTimeout(() => {
    state.isThere = true;
  }, atMs - Date.now());

  for (let turn: number = 0; turn < 1000000 && !state.isThere; turn++) {
    await settleTurns();

    if (!state.isThere) {
      jest.advanceTimersToNextTimer();
    }
  }

  clearTimeout(there);
  await settleTurns();
}

// A job's data, as the queue keeps it: its dates as ISO text.
export function asQueued(data: {
  monitorId: ObjectID;
  projectId?: ObjectID | undefined;
  dueAt?: Date | undefined;
}): TelemetryMonitorEvaluationJobData {
  return JSON.parse(
    JSON.stringify({
      monitorId: data.monitorId.toString(),
      projectId: data.projectId?.toString(),
      queuedAt: new Date(),
      ...(data.dueAt ? { dueAt: data.dueAt } : {}),
    }),
  ) as TelemetryMonitorEvaluationJobData;
}
