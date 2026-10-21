/*
 * WHICH MINUTES A LOG RECORDING RULE COMPUTES ON A RUN.
 *
 * The metric and trace recording rule workers compute one 1-minute bucket a
 * run: the minute that ended EVALUATION_LAG ago (30 seconds, so late logs
 * still land in their minute), every minute. A run that does not happen -
 * the worker restarting, a deploy, a queue backlog - is a minute nobody
 * ever computes, and two runs of the same minute write it twice.
 *
 * A log recording rule keeps the same buckets, lag and cadence, and adds a
 * watermark: LogRecordingRule.computedUntil, the end of the last minute the
 * rule has written. Each run computes the minutes from there up to the
 * newest one that has fully elapsed:
 *
 *   - a rule that never ran computes just that newest minute, as the other
 *     workers do;
 *   - after downtime the missed minutes are computed on the next runs, as
 *     long as they are at most MAX_CATCH_UP_IN_MINUTES old - older ones are
 *     given up, so a worker that was down for a day does not start with a
 *     day-long scan;
 *   - one run computes at most MAX_MINUTES_PER_RUN of them, so a long
 *     catch-up is spread over a few runs rather than one query that might
 *     time out and be retried forever;
 *   - a watermark at or past the newest minute (the run before already did
 *     it) computes nothing, so a minute is never written twice.
 *
 * The worker claims the window by moving the watermark with a
 * compare-and-set before it queries anything, and moves it back if the
 * query or the write fails (Workers/Jobs/Logs/ComputeLogRecordingRules).
 *
 * Pure: the worker, its tests and the docs read the same numbers.
 */

export const LOG_RECORDING_RULE_BUCKET_SIZE_IN_MINUTES: number = 1;

// Matches the metric and trace recording rule workers.
export const LOG_RECORDING_RULE_EVALUATION_LAG_IN_SECONDS: number = 30;

export const LOG_RECORDING_RULE_MAX_CATCH_UP_IN_MINUTES: number = 60;

export const LOG_RECORDING_RULE_MAX_MINUTES_PER_RUN: number = 10;

const MILLISECONDS_IN_A_MINUTE: number = 60 * 1000;

export interface LogRecordingRuleWindow {
  // Inclusive, on a minute boundary.
  startTime: Date;
  // Exclusive, on a minute boundary. The watermark once the run is done.
  endTime: Date;
  // How many 1-minute buckets the window holds.
  minutes: number;
  /*
   * Minutes after the watermark that were given up because they are older
   * than the catch-up bound. 0 in the steady state.
   */
  skippedMinutes: number;
}

export default class LogRecordingRuleWindowUtil {
  /*
   * The end of the newest minute that has fully elapsed, lag included: at
   * 10:05:20 that is 10:04 (10:04:50 rounded down), at 10:05:40 it is 10:05.
   */
  public static getNewestBucketEnd(now: Date): Date {
    const lagged: number =
      now.getTime() - LOG_RECORDING_RULE_EVALUATION_LAG_IN_SECONDS * 1000;

    return new Date(LogRecordingRuleWindowUtil.floorToMinute(lagged));
  }

  /*
   * The minutes this run computes, or null when there is nothing to compute
   * yet (the watermark is already at, or past, the newest elapsed minute).
   */
  public static getWindow(input: {
    now: Date;
    computedUntil?: Date | null | undefined;
  }): LogRecordingRuleWindow | null {
    const newestEnd: number = LogRecordingRuleWindowUtil.getNewestBucketEnd(
      input.now,
    ).getTime();

    const bucketSize: number =
      LOG_RECORDING_RULE_BUCKET_SIZE_IN_MINUTES * MILLISECONDS_IN_A_MINUTE;

    const computedUntil: number | null = LogRecordingRuleWindowUtil.readTime(
      input.computedUntil,
    );

    let start: number;
    let skippedMinutes: number = 0;

    if (computedUntil === null) {
      // Never ran: the newest minute only, as the other recording rules do.
      start = newestEnd - bucketSize;
    } else {
      /*
       * Rounded up: a watermark off the minute boundary (never written by
       * the worker, but a column can hold anything) must not reopen a
       * minute that may already have been written.
       */
      start = LogRecordingRuleWindowUtil.ceilToMinute(computedUntil);

      const earliest: number =
        newestEnd -
        LOG_RECORDING_RULE_MAX_CATCH_UP_IN_MINUTES * MILLISECONDS_IN_A_MINUTE;

      if (start < earliest) {
        skippedMinutes = Math.round(
          (earliest - start) / MILLISECONDS_IN_A_MINUTE,
        );
        start = earliest;
      }
    }

    if (start >= newestEnd) {
      return null;
    }

    const end: number = Math.min(
      newestEnd,
      start + LOG_RECORDING_RULE_MAX_MINUTES_PER_RUN * MILLISECONDS_IN_A_MINUTE,
    );

    return {
      startTime: new Date(start),
      endTime: new Date(end),
      minutes: Math.round((end - start) / MILLISECONDS_IN_A_MINUTE),
      skippedMinutes,
    };
  }

  // The start of every 1-minute bucket in the window, oldest first.
  public static getBucketStarts(window: LogRecordingRuleWindow): Array<Date> {
    const starts: Array<Date> = [];
    const bucketSize: number =
      LOG_RECORDING_RULE_BUCKET_SIZE_IN_MINUTES * MILLISECONDS_IN_A_MINUTE;

    for (
      let time: number = window.startTime.getTime();
      time < window.endTime.getTime();
      time += bucketSize
    ) {
      starts.push(new Date(time));
    }

    return starts;
  }

  private static floorToMinute(time: number): number {
    return (
      Math.floor(time / MILLISECONDS_IN_A_MINUTE) * MILLISECONDS_IN_A_MINUTE
    );
  }

  private static ceilToMinute(time: number): number {
    return (
      Math.ceil(time / MILLISECONDS_IN_A_MINUTE) * MILLISECONDS_IN_A_MINUTE
    );
  }

  // A watermark as read from Postgres or JSON; null when absent or unreadable.
  private static readTime(
    value: Date | string | null | undefined,
  ): number | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const time: number =
      value instanceof Date ? value.getTime() : new Date(value).getTime();

    return Number.isFinite(time) ? time : null;
  }
}
