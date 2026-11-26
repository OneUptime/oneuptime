import CronParser, { CronExpression } from "cron-parser";
import { XcpNgBackupSchedule } from "../../../Types/XcpNg/XcpNgPoolEvents";

/*
 * ------------------------------------------------------------------
 * How late a VM's backup may be - from its jobs' schedules
 * ------------------------------------------------------------------
 *
 * A VM "has not had a successful backup in its interval" (#10997) when the
 * last one it had is older than the longest gap between two runs of the
 * jobs that back it up, plus some grace: a job that runs every night has
 * missed one once a VM's last good backup is more than a day and a quarter
 * old.
 *
 * The gap is read from the job's enabled schedules (Xen Orchestra's cron,
 * five fields, in the schedule's zone), so a job that runs on weekdays
 * only allows three days over a weekend, not one, and daylight saving's
 * 25-hour night counts as it falls. Several schedules of one job are read
 * together: the gaps are those of every run any of them makes.
 * ------------------------------------------------------------------
 */

// How far ahead a schedule's runs are read, and how many at most.
const HORIZON_MS: number = 400 * 24 * 60 * 60 * 1000;
const MAX_RUNS_PER_SCHEDULE: number = 500;

// The least grace a VM's backup is given, and the share of its interval.
export const XCP_NG_BACKUP_MIN_GRACE_SECONDS: number = 60 * 60;
export const XCP_NG_BACKUP_GRACE_SHARE: number = 0.25;

/*
 * The longest gap, in seconds, between two runs of these schedules, the
 * enabled ones, from `now` on. Null when none is enabled or parses, or
 * they run less than twice in the horizon.
 */
export function getXcpNgBackupJobIntervalSeconds(data: {
  schedules: Array<XcpNgBackupSchedule>;
  now: Date;
}): number | null {
  const nowMs: number = data.now.getTime();
  const runsBySchedule: Array<Array<number>> = [];
  let windowEnd: number = nowMs + HORIZON_MS;

  for (const schedule of data.schedules) {
    if (!schedule.enabled || !schedule.cron) {
      continue;
    }

    let expression: CronExpression;
    try {
      expression = CronParser.parseExpression(schedule.cron, {
        currentDate: new Date(nowMs),
        endDate: new Date(nowMs + HORIZON_MS),
        ...(schedule.timezone ? { tz: schedule.timezone } : {}),
      });
    } catch {
      // A cron or a zone cron-parser refuses tells nothing of the gap.
      continue;
    }

    const runs: Array<number> = [];
    let reachedEnd: boolean = false;

    while (runs.length < MAX_RUNS_PER_SCHEDULE) {
      if (!expression.hasNext()) {
        reachedEnd = true;
        break;
      }
      try {
        runs.push(expression.next().toDate().getTime());
      } catch {
        reachedEnd = true;
        break;
      }
    }

    if (runs.length === 0) {
      continue;
    }

    /*
     * A schedule cut at MAX_RUNS_PER_SCHEDULE (every minute, say) was read
     * only so far ahead: the gaps of the others are read no further, or a
     * daily job beside it would seem to leave a day between runs.
     */
    if (!reachedEnd) {
      windowEnd = Math.min(windowEnd, runs[runs.length - 1] as number);
    }

    runsBySchedule.push(runs);
  }

  const runs: Array<number> = Array.from(
    new Set(
      runsBySchedule.flat().filter((time: number): boolean => {
        return time <= windowEnd;
      }),
    ),
  ).sort((left: number, right: number): number => {
    return left - right;
  });

  if (runs.length < 2) {
    return null;
  }

  let longest: number = 0;
  for (let index: number = 1; index < runs.length; index++) {
    longest = Math.max(
      longest,
      (runs[index] as number) - (runs[index - 1] as number),
    );
  }

  return longest > 0 ? Math.round(longest / 1000) : null;
}

// The grace a VM's backup is given past its interval.
export function getXcpNgBackupGraceSeconds(intervalSeconds: number): number {
  return Math.max(
    XCP_NG_BACKUP_MIN_GRACE_SECONDS,
    Math.round(intervalSeconds * XCP_NG_BACKUP_GRACE_SHARE),
  );
}

/*
 * Whether a VM's backup is overdue. With no successful backup on record,
 * it is counted from when OneUptime started reading the pool's backups
 * (`watchedSince`): a VM whose last good backup is older than what the
 * first read looked back over is caught once its interval has passed
 * since then, never on the first minute.
 */
export function isXcpNgVmBackupOverdue(data: {
  intervalSeconds: number | null | undefined;
  lastSuccessfulBackupAt: Date | null | undefined;
  watchedSince: Date | null | undefined;
  now: Date;
}): boolean {
  if (
    data.intervalSeconds === null ||
    data.intervalSeconds === undefined ||
    !Number.isFinite(data.intervalSeconds) ||
    data.intervalSeconds <= 0
  ) {
    return false;
  }

  const reference: Date | null | undefined =
    data.lastSuccessfulBackupAt || data.watchedSince;

  if (!reference || isNaN(reference.getTime())) {
    return false;
  }

  const allowedMs: number =
    (data.intervalSeconds + getXcpNgBackupGraceSeconds(data.intervalSeconds)) *
    1000;

  return data.now.getTime() - reference.getTime() > allowedMs;
}
