/*
 * Per-monitor, per-day status durations for the status-page uptime bars.
 *
 * WHY THIS TYPE EXISTS
 *
 * The bars used to be painted from raw MonitorStatusTimeline rows shipped to
 * the browser under a single `limit: LIMIT_MAX` (10,000) across EVERY monitor
 * on the page, sorted `startsAt DESC`.
 *
 * That cap is a silent, history-destroying bound. Measured on a real status
 * page: 254,550 rows matched the 60-day window and 10,000 came back - 3.9%.
 * The oldest surviving row started four days before the request, so 56 of the
 * 60 bars were painted from data that had been dropped.
 *
 * Worse, the cap is GLOBAL across monitors and the sort is newest-first, so a
 * few high-churn monitors starve the quiet ones out of the result set
 * entirely. On the page that reported this, three flapping monitors held
 * 9,995 of the 10,000 slots. A quiet, healthy monitor's covering row has an
 * OLD `startsAt` and therefore sorts last - so the healthier a monitor is,
 * the more likely it is to lose its whole history to a noisy neighbour.
 *
 * Shipping more rows cannot fix it. One row serializes to ~431 bytes in this
 * codebase's typed JSON, so 254,550 rows is ~105 MB - into a response that is
 * held in a 500-entry in-memory cache on the hottest public endpoint, and
 * then filtered per-bar on the client's main thread.
 *
 * So the server sends DURATIONS instead of rows. The size is structural -
 * O(monitors x days x statuses) - rather than O(status transitions), and it
 * cannot be blown up by a flapping monitor.
 */

import ObjectID from "../ObjectID";

/**
 * Seconds spent in one monitor status, inside one day bucket.
 */
export interface UptimeStatusDuration {
  monitorStatusId: ObjectID;
  seconds: number;
}

/**
 * One monitor's reading for one day bucket.
 */
export interface UptimeDayBucket {
  /* Start of the bucket, as a UTC instant. */
  bucketStart: Date;

  /* End of the bucket, as a UTC instant. */
  bucketEnd: Date;

  /*
   * Wall-clock seconds in the bucket.
   *
   * NOT hardcoded to 86400. The window's first and last buckets are clipped
   * to the window, and a local calendar day that crosses a DST boundary is
   * genuinely 23 or 25 hours long.
   */
  daySeconds: number;

  /*
   * Seconds of this bucket actually covered by a timeline row.
   *
   * This is the field the whole fix turns on. `coveredSeconds === 0` means
   * "nothing was ever recorded for this day" - the monitor did not exist yet,
   * or there is a hole in the record. Such a day must never be painted as
   * uptime, which is exactly what the old code did by falling through to the
   * status page's `defaultBarColor` (green on 4,642 status pages).
   *
   * `0 < coveredSeconds < daySeconds` is NOT a no-data day. It is a real
   * reading of a shorter interval - the day a monitor was created, say - and
   * its percentage is taken over what was measured.
   */
  coveredSeconds: number;

  /* Seconds spent in each status, summed within the bucket. */
  statusDurations: Array<UptimeStatusDuration>;
}

/**
 * Every day bucket for one monitor.
 */
export interface MonitorUptimeDailyAggregate {
  monitorId: ObjectID;
  buckets: Array<UptimeDayBucket>;
}

/**
 * The full aggregate for a status page request.
 */
export interface UptimeDailyAggregate {
  monitors: Array<MonitorUptimeDailyAggregate>;

  /*
   * False when the server could not vouch for the whole window.
   *
   * There is no silent cap in the aggregate path, so this is normally true.
   * It exists because a bound that is ever added later must SHOW, not be
   * absorbed into a green bar - which is the failure this whole change is
   * about. When false, `completeFrom` says where the trustworthy data starts
   * and the client renders everything older as no-data rather than guessing.
   */
  isComplete: boolean;

  /*
   * The earliest instant the aggregate can vouch for, when `isComplete` is
   * false. Null when the whole window is covered.
   */
  completeFrom: Date | null;
}
