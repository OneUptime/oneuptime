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
  }): AggregationInterval {
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
      default:
        return 1000 * 60;
    }
  }
}

export default AggregationIntervalUtil;
