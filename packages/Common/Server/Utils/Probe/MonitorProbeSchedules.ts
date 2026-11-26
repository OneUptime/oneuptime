import CronTab from "../CronTab";
import MonitoringIntervalValidator from "../Monitor/MonitoringIntervalValidator";

/*
 * THE SCHEDULES A PROCESS HANDS MONITORS OUT ON (issue #10819).
 *
 * A probe's claim (MonitorProbeService.claimMonitorProbesForProbing) moves
 * each monitor it hands out to its next run, in the claim's own statement.
 * Postgres cannot read a cron expression, so the next runs are worked out
 * here, in Node, BEFORE the statement - for every schedule (a Monitor's
 * monitoringInterval) this process has handed a monitor out on - and the
 * statement writes each row the next run of its own schedule. Thousands of
 * monitors share a handful of schedules ("* * * * *" most of all), and
 * CronTab keeps each one's next run for the rest of the minute, so this is
 * a few lookups a claim.
 *
 * A schedule the process has not seen yet - the first claim after a start,
 * a monitor given a new one - is written a minute on by the statement, then
 * worked out here and written right after it (and remembered); a schedule
 * that cannot be read stays at a minute on, as it always has. At most
 * MAX_KNOWN_SCHEDULES are remembered: past that, a new one is worked out
 * after each claim.
 */

export const MAX_KNOWN_SCHEDULES: number = 1000;

export interface ScheduledRun {
  // Its next run, or `fallback` when the schedule cannot be read.
  nextPingAt: Date;
  // Whether the schedule could be read.
  readable: boolean;
}

export interface KnownSchedules {
  intervals: Array<string>;
  // ISO strings: an array of them reads as timestamptz[] unambiguously.
  nextPingAts: Array<string>;
}

export type NextRunResolver = (data: {
  monitoringInterval: string;
  fallback: Date;
  onUnreadable: () => void;
}) => Date;

export default class MonitorProbeSchedules {
  private readonly known: Set<string> = new Set<string>();
  private readonly unreadable: Set<string> = new Set<string>();
  private readonly intervalInMs: Map<string, number | null> = new Map<
    string,
    number | null
  >();

  /*
   * `resolve` works out a schedule's next run (MonitorProbeService
   * .resolveNextPingAt, which reads a raw cron expression first and a human
   * cadence second, as every scheduling path must).
   */
  public constructor(private readonly resolve: NextRunResolver) {}

  // Whether the claim's statement wrote this schedule's next run itself.
  public isKnown(monitoringInterval: string): boolean {
    return this.known.has(monitoringInterval);
  }

  public isUnreadable(monitoringInterval: string): boolean {
    return this.unreadable.has(monitoringInterval);
  }

  // Every readable schedule seen so far, with its next run from now.
  public knownSchedules(fallback: Date): KnownSchedules {
    const intervals: Array<string> = [];
    const nextPingAts: Array<string> = [];

    for (const monitoringInterval of this.known) {
      const run: ScheduledRun = this.nextRun(monitoringInterval, fallback);

      if (run.readable) {
        intervals.push(monitoringInterval);
        nextPingAts.push(run.nextPingAt.toISOString());
      }
    }

    return { intervals, nextPingAts };
  }

  // A schedule's next run from now, remembering the schedule.
  public nextRun(monitoringInterval: string, fallback: Date): ScheduledRun {
    let readable: boolean = !this.unreadable.has(monitoringInterval);
    const nextPingAt: Date = readable
      ? this.resolve({
          monitoringInterval: monitoringInterval,
          fallback: fallback,
          onUnreadable: (): void => {
            readable = false;
          },
        })
      : fallback;

    this.remember(monitoringInterval, readable);

    return { nextPingAt, readable };
  }

  /*
   * The longest gap between two runs of a schedule, worked out once: how
   * late a monitor may be handed out before it has skipped a check. Null
   * when the schedule cannot be read.
   */
  public getIntervalInMs(monitoringInterval: string | null): number | null {
    if (!monitoringInterval) {
      return null;
    }

    if (this.intervalInMs.has(monitoringInterval)) {
      return this.intervalInMs.get(monitoringInterval) ?? null;
    }

    const cron: string =
      MonitoringIntervalValidator.normalizeForRead(monitoringInterval) ||
      monitoringInterval;
    let seconds: number | null = null;

    try {
      seconds = CronTab.getIntervalInSeconds(cron);
    } catch {
      seconds = null;
    }

    const intervalInMs: number | null = seconds ? seconds * 1000 : null;

    if (this.intervalInMs.size < MAX_KNOWN_SCHEDULES) {
      this.intervalInMs.set(monitoringInterval, intervalInMs);
    }

    return intervalInMs;
  }

  private remember(monitoringInterval: string, readable: boolean): void {
    if (!readable) {
      if (this.unreadable.size < MAX_KNOWN_SCHEDULES) {
        this.unreadable.add(monitoringInterval);
      }
      this.known.delete(monitoringInterval);
      return;
    }

    if (this.known.size < MAX_KNOWN_SCHEDULES) {
      this.known.add(monitoringInterval);
    }
  }

  // Forget every schedule (tests).
  public clear(): void {
    this.known.clear();
    this.unreadable.clear();
    this.intervalInMs.clear();
  }
}
