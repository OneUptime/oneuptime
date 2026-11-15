import AggregationInterval from "./AggregationInterval";
import OneUptimeDate from "../Date";
import Timezone from "../Timezone";
import TimezoneAlias from "../TimezoneAlias";

/*
 * The intervals whose buckets are units of a calendar: a day from midnight,
 * a week from Monday, a month from its 1st, a year from 1 January. Where
 * those begin depends on the time zone they are read in. An hour and
 * shorter are counted from the epoch, the same instants in every zone, and
 * Total is no bucket at all.
 */
const CALENDAR_INTERVALS: ReadonlyArray<AggregationInterval> = [
  AggregationInterval.Day,
  AggregationInterval.Week,
  AggregationInterval.Month,
  AggregationInterval.Year,
];

// What withReaderTimezone reads of a request, and sets on it.
export interface AggregateWindow {
  startTimestamp?: Date | undefined;
  endTimestamp?: Date | undefined;
  aggregationInterval?: AggregationInterval | undefined;
  timezone?: Timezone | undefined;
}

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
   * True for Day, Week, Month and Year: the buckets that start at the
   * reader's midnight, Monday, 1st or 1 January when an aggregate carries
   * the reader's zone (AggregateBy.timezone), and in UTC otherwise.
   */
  public static isCalendarInterval(interval: AggregationInterval): boolean {
    return CALENDAR_INTERVALS.includes(interval);
  }

  /*
   * The zone an aggregate over this window asks its buckets to follow: the
   * reader's (OneUptimeDate.getCurrentTimezone(), the zone User Settings
   * picked, or the browser's), when its buckets are days, weeks, months or
   * years. A chart draws those on the reader's calendar, so their buckets
   * must start where the reader's days do (issue #7277).
   *
   * Undefined for an hour and shorter and for Total, which no zone moves,
   * so those requests stay exactly as they were. Undefined too for a zone
   * the Timezone list does not name - a browser can report a zone newer
   * than the list, and the server refuses any other - so those buckets
   * follow UTC, as before, rather than the chart failing.
   */
  public static getReaderTimezone(data: {
    startDate: Date;
    endDate: Date;
    aggregationInterval?: AggregationInterval | undefined;
  }): Timezone | undefined {
    const interval: AggregationInterval =
      this.getAggregationIntervalForWindow(data);

    if (!this.isCalendarInterval(interval)) {
      return undefined;
    }

    const timezone: Timezone = OneUptimeDate.getCurrentTimezone();

    return TimezoneAlias.isListedName(timezone) ? timezone : undefined;
  }

  /*
   * The request with the reader's zone on it (getReaderTimezone), as the
   * dashboard sends every aggregate: a new object, the one given left as it
   * is. A request that names its zone keeps it - a cloud's cost is for a
   * UTC day, and its readers ask for Timezone.UTC - and one with no window
   * to read an interval from, or no zone to add, comes back unchanged.
   */
  public static withReaderTimezone<TRequest extends AggregateWindow>(
    aggregateBy: TRequest,
  ): TRequest {
    if (
      !aggregateBy ||
      (aggregateBy.timezone !== undefined && aggregateBy.timezone !== null)
    ) {
      return aggregateBy;
    }

    let timezone: Timezone | undefined = undefined;

    try {
      timezone = this.getReaderTimezone({
        startDate: aggregateBy.startTimestamp as Date,
        endDate: aggregateBy.endTimestamp as Date,
        aggregationInterval: aggregateBy.aggregationInterval,
      });
    } catch {
      /*
       * No window to read an interval from (fromString throws on a missing
       * date): the request goes as it is, and the server answers it as it
       * always has.
       */
      return aggregateBy;
    }

    if (!timezone) {
      return aggregateBy;
    }

    return { ...aggregateBy, timezone: timezone };
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
   *
   * `timezone` is the zone the request's buckets follow (its
   * AggregateBy.timezone, see getReaderTimezone): a Day then floors to that
   * zone's midnight, where the server starts the day, and not to UTC's - in
   * New York a UTC midnight is 19:00 the evening before, so the window's
   * first day would hold five hours of it. Every finer interval is the same
   * in every zone and ignores it.
   */
  public static floorDateToIntervalGrid(
    date: Date,
    interval: AggregationInterval,
    timezone?: Timezone | undefined,
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
    if (interval === AggregationInterval.Day && timezone) {
      return OneUptimeDate.getStartOfDay(new Date(ms), timezone);
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
   *
   * `timezone` is the zone the window's request will carry (see
   * floorDateToIntervalGrid); the caller reads it with getReaderTimezone,
   * as the request does, so the two always agree.
   */
  public static getIntervalAlignedWindow(data: {
    startDate: Date;
    endDate: Date;
    timezone?: Timezone | undefined;
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
      startDate: this.floorDateToIntervalGrid(
        data.startDate,
        interval,
        data.timezone,
      ),
      endDate: OneUptimeDate.fromString(data.endDate),
      interval,
    };
  }
}

export default AggregationIntervalUtil;
