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
     * returned verbatim (including `None`), so callers can pin a bucket
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

    if (diff <= 1000 * 60 * 60 * 3) {
      // if less than 3 hours, then get minute precision
      return AggregationInterval.Minute;
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
      case AggregationInterval.None:
        /*
         * `None` is a single whole-window bucket with no fixed width. The
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
}

export default AggregationIntervalUtil;
