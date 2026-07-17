import AggregationInterval from "./AggregationInterval";
import OneUptimeDate from "../Date";

/*
 * Single source of truth for "which time-bucket size does the
 * analytics aggregate API use for a given query window". The server
 * statement generator (AggregateUtil in
 * Common/Server/Types/AnalyticsDatabase/AggregateBy.ts) delegates
 * here when compiling `toStartOfInterval(...)`, and browser code that
 * needs to reconstruct the server's bucket grid client-side (e.g. the
 * heartbeat availability charts, which must synthesize the empty
 * buckets ClickHouse never returns rows for) imports the same
 * function — so the two sides can never drift apart.
 */
export class AggregationIntervalUtil {
  public static getAggregationIntervalForWindow(data: {
    startDate: Date;
    endDate: Date;
    /**
     * Explicit override. When set to a valid AggregationInterval it is
     * returned verbatim (including `Total`), so callers can pin a bucket
     * size independent of the window. Unknown/undefined falls through to
     * the window-derived interval below.
     */
    aggregationInterval?: AggregationInterval | undefined;
  }): AggregationInterval {
    if (
      data.aggregationInterval &&
      Object.values(AggregationInterval).includes(data.aggregationInterval)
    ) {
      return data.aggregationInterval;
    }

    const startDate: Date = OneUptimeDate.fromString(data.startDate);
    const endDate: Date = OneUptimeDate.fromString(data.endDate);

    const diff: number = endDate.getTime() - startDate.getTime();

    /*
     * ~180-point budget per chart: each tier keeps the rendered point
     * count in the tens-to-hundreds instead of collapsing a 4h window
     * to ~4 hourly points or exploding a 12h window into 720 minutes.
     */
    if (diff <= 1000 * 60 * 60 * 3) {
      // if less than 3 hours, then get minute precision
      return AggregationInterval.Minute;
    } else if (diff <= 1000 * 60 * 60 * 12) {
      // 12 hours
      return AggregationInterval.FiveMinutes;
    } else if (diff <= 1000 * 60 * 60 * 24) {
      // 24 hours
      return AggregationInterval.FifteenMinutes;
    } else if (diff <= 1000 * 60 * 60 * 24 * 3) {
      // 3 days
      return AggregationInterval.ThirtyMinutes;
    } else if (diff <= 1000 * 60 * 60 * 24 * 7) {
      // 7 days
      return AggregationInterval.Hour;
    } else if (diff <= 1000 * 60 * 60 * 24 * 7 * 6) {
      // 6 weeks
      return AggregationInterval.Day;
    } else if (diff <= 1000 * 60 * 60 * 24 * 30 * 6) {
      // 6 months
      return AggregationInterval.Week;
    } else if (diff <= 1000 * 60 * 60 * 24 * 365 * 6) {
      // 6 years
      return AggregationInterval.Month;
    }
    return AggregationInterval.Year;
  }

  /*
   * Nominal bucket width in milliseconds. Month and Year are
   * calendar-variable in ClickHouse (`toStartOfInterval` snaps to
   * calendar boundaries), so their values here are approximations —
   * callers that walk a fixed-step grid at those widths must match
   * rows to grid slots with tolerance (nearest slot), not by exact
   * timestamp equality.
   */
  public static getAggregationIntervalMs(
    interval: AggregationInterval,
  ): number {
    switch (interval) {
      case AggregationInterval.Minute:
        return 1000 * 60;
      case AggregationInterval.FiveMinutes:
        return 1000 * 60 * 5;
      case AggregationInterval.FifteenMinutes:
        return 1000 * 60 * 15;
      case AggregationInterval.ThirtyMinutes:
        return 1000 * 60 * 30;
      case AggregationInterval.Hour:
        return 1000 * 60 * 60;
      case AggregationInterval.Day:
        return 1000 * 60 * 60 * 24;
      case AggregationInterval.Week:
        return 1000 * 60 * 60 * 24 * 7;
      case AggregationInterval.Month:
        return 1000 * 60 * 60 * 24 * 30;
      case AggregationInterval.Year:
        return 1000 * 60 * 60 * 24 * 365;
      case AggregationInterval.Total:
        /*
         * `Total` is a single whole-window bucket with no fixed width. The
         * window-derived picker never returns it, so grid-reconstruction
         * callers (heartbeat charts, XAxis) never see it. Return a very
         * large finite width (~1000 years) so any defensive fixed-step
         * grid walk emits a single slot instead of looping forever.
         */
        return 1000 * 60 * 60 * 24 * 365 * 1000;
      default:
        return 1000 * 60;
    }
  }

  /*
   * Floor a timestamp DOWN to the start of its aggregation bucket, matching
   * the server's `toStartOfInterval(time, INTERVAL 1 <interval>)` grid. This
   * lets a chart align its query window to the bucket grid so the leading
   * edge lands on a real bucket boundary instead of mid-bucket — a
   * mid-bucket start renders as an empty gap before the first plotted point
   * (the first bucket is partial and its timestamp falls before the axis
   * origin).
   *
   * Only the sub-day intervals (Minute through Hour, plus Day) are aligned:
   * for those the fixed-ms epoch grid is an EXACT match for ClickHouse's
   * UTC bucketing (5/15/30-minute `toStartOfInterval` grids are counted in
   * whole intervals since the epoch, and epoch-day == UTC midnight), and
   * these are the windows where the leading gap is actually visible.
   * Week/Month/Year snap to calendar boundaries (Monday / 1st / Jan-1)
   * server-side, which a fixed-ms grid can't reproduce, so those (and
   * `Total`) are returned UNCHANGED rather than risk shifting the gap for
   * long windows — their pre-existing behavior is preserved.
   */
  public static floorDateToIntervalGrid(
    date: Date,
    interval: AggregationInterval,
  ): Date {
    const ms: number = OneUptimeDate.fromString(date).getTime();
    const alignableIntervals: Array<AggregationInterval> = [
      AggregationInterval.Minute,
      AggregationInterval.FiveMinutes,
      AggregationInterval.FifteenMinutes,
      AggregationInterval.ThirtyMinutes,
      AggregationInterval.Hour,
      AggregationInterval.Day,
    ];
    if (!alignableIntervals.includes(interval)) {
      return new Date(ms);
    }
    const bucketMs: number = this.getAggregationIntervalMs(interval);
    if (!Number.isFinite(bucketMs) || bucketMs <= 0) {
      return new Date(ms);
    }
    return new Date(Math.floor(ms / bucketMs) * bucketMs);
  }

  /*
   * Align a query window to the aggregation-bucket grid. The bucket size is
   * derived from the RAW window and returned alongside the aligned dates so
   * the caller can PIN it (AggregateBy.aggregationInterval): flooring the
   * start slightly widens the window, and without pinning that could bump a
   * window sitting exactly on a tier threshold (e.g. a 3h window) into the
   * next-coarser interval and change the whole chart's resolution. The start
   * is floored DOWN so the first bucket is complete and lands on the axis
   * origin (removing the leading gap); the end is left untouched so the
   * latest, still-in-progress bucket and its live data continue to show.
   */
  public static getIntervalAlignedWindow(data: {
    startDate: Date;
    endDate: Date;
  }): {
    startDate: Date;
    endDate: Date;
    interval: AggregationInterval;
  } {
    const interval: AggregationInterval = this.getAggregationIntervalForWindow({
      startDate: data.startDate,
      endDate: data.endDate,
    });
    return {
      startDate: this.floorDateToIntervalGrid(data.startDate, interval),
      endDate: OneUptimeDate.fromString(data.endDate),
      interval,
    };
  }
}

export default AggregationIntervalUtil;
