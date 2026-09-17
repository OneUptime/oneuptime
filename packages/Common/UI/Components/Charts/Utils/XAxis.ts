import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import OneUptimeDate from "../../../../Types/Date";
import NotImplementedException from "../../../../Types/Exception/NotImplementedException";
import SeriesPoints from "../Types/SeriesPoints";
import XAxisMaxMin from "../Types/XAxis/XAxisMaxMin";
import XAxisPrecision from "../Types/XAxis/XAxisPrecision";

export default class XAxisUtil {
  private static cloneDate(value: Date): Date {
    return new Date(value.getTime());
  }

  /*
   * The grid step a caller should pin when its points are buckets the
   * analytics backend produced, rather than raw samples.
   *
   * This is the bridge between the two ladders. AggregationInterval is what
   * the server was asked to bucket by (AggregationIntervalUtil owns that
   * decision, and the server compiles it into `toStartOfInterval`);
   * XAxisPrecision is the step this file walks the axis at. Pinning the
   * translation of one to the other is what makes "one slot == one backend
   * bucket" a fact rather than a coincidence of two duration ladders
   * agreeing.
   *
   * `Total` is the one interval with no grid at all — it collapses the whole
   * window into a single aggregate whose timestamp is the earliest sample,
   * not a bucket start — so it pins nothing and the duration ladder applies.
   */
  public static getPrecisionForAggregationInterval(
    interval: AggregationInterval,
  ): XAxisPrecision | undefined {
    switch (interval) {
      case AggregationInterval.Minute:
        return XAxisPrecision.EVERY_MINUTE;
      case AggregationInterval.FiveMinutes:
        return XAxisPrecision.EVERY_FIVE_MINUTES;
      case AggregationInterval.FifteenMinutes:
        return XAxisPrecision.EVERY_FIFTEEN_MINUTES;
      case AggregationInterval.ThirtyMinutes:
        return XAxisPrecision.EVERY_THIRTY_MINUTES;
      case AggregationInterval.Hour:
        return XAxisPrecision.EVERY_HOUR;
      case AggregationInterval.Day:
        return XAxisPrecision.EVERY_DAY;
      case AggregationInterval.Week:
        return XAxisPrecision.EVERY_WEEK;
      case AggregationInterval.Month:
        return XAxisPrecision.EVERY_MONTH;
      case AggregationInterval.Year:
        return XAxisPrecision.EVERY_YEAR;
      default:
        return undefined;
    }
  }

  /*
   * A chart's x-axis label is not decoration — it IS the identity of its
   * bucket. DataPointUtil places a series row by finding the first row
   * whose label matches, TimeAnnotationUtil resolves an event marker the
   * same way, and recharts' categorical scale resolves no category at all
   * once its domain holds a duplicate. So a repeated label does not just
   * read ambiguously: it merges other days' data into the first day's
   * buckets and silently drops the annotations that land on them.
   *
   * Everything from EVERY_HOUR up already carries the date for exactly
   * this reason. These two helpers decide when the finer tiers must too.
   */

  private static readonly MILLISECONDS_IN_A_DAY: number = 24 * 60 * 60 * 1000;

  /**
   * How much a wall-clock label has to say before it names exactly one
   * instant inside this window.
   *
   * Two ways that happens:
   *
   * 1. The window is at least a day long, so the clock wraps. Measured:
   *    a 23h window at the fifteen-minute tier yields 93 intervals and 93
   *    distinct labels, while 24h yields 97 and 96 — the first and last
   *    tick both read "00:00". A 48h window at the thirty-minute tier
   *    yields 97 intervals and only 48 distinct labels.
   *
   * 2. The clocks go back inside the window, which replays a wall-clock
   *    hour, and no duration is short enough to be safe from it.
   *
   *    It only bites when the configured timezone is not the one the
   *    browser reports: intervals are stepped in browser wall-clock time
   *    while labels are read in the configured zone, so a transition the
   *    browser cannot see gets walked straight through. Measured on a 4h
   *    window across London's fall-back — browser UTC, configured London:
   *    49 intervals, 37 distinct. With both zones London the walker steps
   *    over the repeated hour itself and the same window measures 37 and
   *    37, so the zone suffix is redundant there but never wrong.
   */
  private static getWallClockLabelDetail(data: {
    xAxisMin: XAxisMaxMin;
    xAxisMax: XAxisMaxMin;
  }): { withDate: boolean; withZone: boolean } {
    if (
      typeof data.xAxisMin === "number" ||
      typeof data.xAxisMax === "number"
    ) {
      return { withDate: false, withZone: false };
    }

    const startDate: Date = data.xAxisMin;
    const endDate: Date = data.xAxisMax;

    const wrapsTheClock: boolean =
      endDate.getTime() - startDate.getTime() >=
      XAxisUtil.MILLISECONDS_IN_A_DAY;

    /*
     * A drop in the offset is a fall-back; a rise is a spring-forward,
     * which skips an hour rather than repeating one and is harmless.
     *
     * The date does not settle a fall-back — both 01:00s are on the same
     * day — so the zone abbreviation goes on too, which is the only thing
     * that tells "01:00 BST" from "01:00 GMT".
     */
    const clocksGoBack: boolean =
      OneUptimeDate.getTimezoneOffsetInMinutes(endDate) <
      OneUptimeDate.getTimezoneOffsetInMinutes(startDate);

    return {
      withDate: wrapsTheClock || clocksGoBack,
      withZone: clocksGoBack,
    };
  }

  /**
   * The label for a bucket finer than an hour: a bare wall clock where
   * that is unambiguous, and a day-qualified one where it is not.
   */
  private static getWallClockLabel(
    value: Date,
    detail: { withDate: boolean; withZone: boolean },
    options?: { includeSeconds?: boolean | undefined },
  ): string {
    const includeSeconds: boolean = options?.includeSeconds ?? false;

    const base: string = detail.withDate
      ? OneUptimeDate.getDateAsLocalDayMonthTimeString(value, {
          includeSeconds,
        })
      : OneUptimeDate.getLocalTimeString(value, { includeSeconds });

    if (!detail.withZone) {
      return base;
    }

    return `${base} ${OneUptimeDate.getLocalZoneAbbr(value)}`;
  }

  public static getPrecision(data: {
    xAxisMin: XAxisMaxMin;
    xAxisMax: XAxisMaxMin;
    precision?: XAxisPrecision | undefined;
  }): XAxisPrecision {
    /*
     * An explicit pin wins outright — see XAxisOptions.precision for why a
     * caller that knows the bucket size must not have it re-guessed from the
     * window duration. Checked before the Date guard so a pinned axis stays
     * pinned regardless of how its bounds are expressed.
     */
    if (data.precision) {
      return data.precision;
    }

    if (
      typeof data.xAxisMax === "number" ||
      typeof data.xAxisMin === "number"
    ) {
      // number not yet supported.
      throw new NotImplementedException();
    }

    const startDate: Date = OneUptimeDate.fromString(data.xAxisMin as Date);
    const endDate: Date = OneUptimeDate.fromString(data.xAxisMax as Date);

    const totalMilliseconds: number = endDate.getTime() - startDate.getTime();
    const totalSeconds: number = totalMilliseconds / 1000;
    const totalMinutes: number = totalSeconds / 60;
    const totalHours: number = totalMinutes / 60;
    const totalDays: number = totalHours / 24;
    const totalWeeks: number = totalDays / 7;
    const totalMonths: number = totalDays / 30;

    /*
     * Mirror the server's aggregation interval ladder (see
     * AggregationIntervalUtil.getAggregationIntervalForWindow: 3h →
     * Minute, 12h → FiveMinutes, 24h → FifteenMinutes, 3d →
     * ThirtyMinutes, 7d → Hour, ...) so the chart renders one point
     * per backend bucket instead of re-bucketing them into coarser
     * groups. Previously a 1h range was rendered with EVERY_
     * FIVE_MINUTES (~12 points) even though the server returned 60
     * per-minute rows. Recharts thins the X-axis label set via
     * `interval="equidistantPreserveStart"`, so high point counts do
     * not crowd the labels.
     */
    if (totalSeconds <= 15) {
      return XAxisPrecision.EVERY_SECOND;
    }
    if (totalSeconds <= 75) {
      return XAxisPrecision.EVERY_FIVE_SECONDS;
    }
    if (totalSeconds <= 150) {
      return XAxisPrecision.EVERY_TEN_SECONDS;
    }
    if (totalSeconds <= 450) {
      return XAxisPrecision.EVERY_THIRTY_SECONDS;
    }
    if (totalHours <= 3) {
      return XAxisPrecision.EVERY_MINUTE;
    }
    if (totalHours <= 12) {
      return XAxisPrecision.EVERY_FIVE_MINUTES;
    }
    if (totalHours <= 24) {
      return XAxisPrecision.EVERY_FIFTEEN_MINUTES;
    }
    if (totalDays <= 3) {
      return XAxisPrecision.EVERY_THIRTY_MINUTES;
    }
    if (totalDays <= 7) {
      return XAxisPrecision.EVERY_HOUR;
    }
    if (totalWeeks <= 6) {
      return XAxisPrecision.EVERY_DAY;
    }
    if (totalMonths <= 6) {
      return XAxisPrecision.EVERY_WEEK;
    }
    if (totalMonths <= 72) {
      return XAxisPrecision.EVERY_MONTH;
    }
    return XAxisPrecision.EVERY_YEAR;
  }

  public static getPrecisionIntervals(data: {
    xAxisMin: XAxisMaxMin;
    xAxisMax: XAxisMaxMin;
    precision?: XAxisPrecision | undefined;
  }): Array<Date> {
    const precision: XAxisPrecision = XAxisUtil.getPrecision(data);

    if (
      typeof data.xAxisMax === "number" ||
      typeof data.xAxisMin === "number"
    ) {
      // number not yet supported.
      throw new NotImplementedException();
    }

    const startDate: Date = new Date(data.xAxisMin as Date);
    const endDate: Date = new Date(data.xAxisMax as Date);
    const intervals: Array<Date> = [];

    const currentDate: Date = new Date(startDate);

    while (currentDate <= endDate) {
      intervals.push(new Date(currentDate));

      switch (precision) {
        case XAxisPrecision.EVERY_SECOND:
          currentDate.setSeconds(currentDate.getSeconds() + 1);
          break;
        case XAxisPrecision.EVERY_FIVE_SECONDS:
          currentDate.setSeconds(currentDate.getSeconds() + 5);
          break;
        case XAxisPrecision.EVERY_TEN_SECONDS:
          currentDate.setSeconds(currentDate.getSeconds() + 10);
          break;
        case XAxisPrecision.EVERY_THIRTY_SECONDS:
          currentDate.setSeconds(currentDate.getSeconds() + 30);
          break;
        case XAxisPrecision.EVERY_MINUTE:
          currentDate.setMinutes(currentDate.getMinutes() + 1);
          break;
        case XAxisPrecision.EVERY_FIVE_MINUTES:
          currentDate.setMinutes(currentDate.getMinutes() + 5);
          break;
        case XAxisPrecision.EVERY_TEN_MINUTES:
          currentDate.setMinutes(currentDate.getMinutes() + 10);
          break;
        case XAxisPrecision.EVERY_FIFTEEN_MINUTES:
          currentDate.setMinutes(currentDate.getMinutes() + 15);
          break;
        case XAxisPrecision.EVERY_THIRTY_MINUTES:
          currentDate.setMinutes(currentDate.getMinutes() + 30);
          break;
        case XAxisPrecision.EVERY_HOUR:
          currentDate.setHours(currentDate.getHours() + 1);
          break;
        case XAxisPrecision.EVERY_TWO_HOURS:
          currentDate.setHours(currentDate.getHours() + 2);
          break;
        case XAxisPrecision.EVERY_THREE_HOURS:
          currentDate.setHours(currentDate.getHours() + 3);
          break;
        case XAxisPrecision.EVERY_SIX_HOURS:
          currentDate.setHours(currentDate.getHours() + 6);
          break;
        case XAxisPrecision.EVERY_TWELVE_HOURS:
          currentDate.setHours(currentDate.getHours() + 12);
          break;
        case XAxisPrecision.EVERY_DAY:
          currentDate.setDate(currentDate.getDate() + 1);
          break;
        case XAxisPrecision.EVERY_TWO_DAYS:
          currentDate.setDate(currentDate.getDate() + 2);
          break;
        case XAxisPrecision.EVERY_WEEK:
          currentDate.setDate(currentDate.getDate() + 7);
          break;
        case XAxisPrecision.EVERY_TWO_WEEKS:
          currentDate.setDate(currentDate.getDate() + 14);
          break;
        case XAxisPrecision.EVERY_MONTH:
          currentDate.setMonth(currentDate.getMonth() + 1);
          break;
        case XAxisPrecision.EVERY_TWO_MONTHS:
          currentDate.setMonth(currentDate.getMonth() + 2);
          break;
        case XAxisPrecision.EVERY_THREE_MONTHS:
          currentDate.setMonth(currentDate.getMonth() + 3);
          break;
        case XAxisPrecision.EVERY_SIX_MONTHS:
          currentDate.setMonth(currentDate.getMonth() + 6);
          break;
        case XAxisPrecision.EVERY_YEAR:
          currentDate.setFullYear(currentDate.getFullYear() + 1);
          break;
      }
    }

    return intervals;
  }

  /*
   * How much of the LAST slot's bucket has to lie inside the window before
   * an empty slot is worth an axis position. Half.
   *
   * The bound has to sit somewhere between the two ends it separates, and
   * both ends are real:
   *
   *  - Near zero coverage means the bucket is not in the window in any
   *    meaningful sense. The alert snapshot that prompted this covered
   *    243 MILLISECONDS of a 60-second bucket (its window ends at the
   *    instant the alert was declared, which fell just past a minute
   *    boundary); a window that ends exactly on a boundary covers none of
   *    the next bucket at all. Those slots cannot carry data, and an
   *    unfillable slot at the right-hand edge is the reported gap.
   *  - Most-of-the-bucket coverage means an empty slot is INFORMATION.
   *    "Last 7 days" ends mid-afternoon, so today's bucket is ~60% inside
   *    the window; if a count chart has nothing in it, that empty final bar
   *    says "nothing today", and dropping the tick would hide it.
   *
   * A half-covered bucket is the natural line between "barely touched" and
   * "genuinely part of this window", and it keeps every rolling window
   * anchored at `now` — where the in-progress bucket is on average half
   * elapsed — on the safe side.
   */
  private static readonly MIN_TRAILING_BUCKET_COVERAGE: number = 0.5;

  /*
   * The intervals a chart should actually RENDER, which is the raw grid
   * minus a trailing slot that no data could ever land in.
   *
   * getPrecisionIntervals walks inclusively to the window end, so the final
   * slot is the start of whichever bucket CONTAINS that end. That bucket
   * runs past the end of the window, so the query never covered all of it —
   * and when the window ends at or just after a bucket boundary it covered
   * essentially none of it. The backend returns rows only for buckets that
   * had samples, so such a slot comes back empty every time; and because the
   * recharts x-axis is categorical over exactly these slots, an empty one at
   * the end is not a rounding detail — it stretches the axis a whole bucket
   * past the last plotted point. On a 5-minute alert snapshot that is a
   * fifth of the chart left blank.
   *
   * Only ever ONE slot is dropped, and only when BOTH hold:
   *
   *  - it carries no data, so a live in-progress bucket keeps rendering
   *    (dropping populated trailing buckets would make every now-anchored
   *    chart lag by a bucket — the opposite complaint), and
   *  - the window covers less than half of it, so an empty bucket that the
   *    window really does span stays on the axis.
   *
   * Dropping at most one is what keeps a genuine outage visible: a source
   * that stopped reporting three buckets before the window end still leaves
   * two blank slots on the axis, which is the truth. Callers with no series
   * to check get the raw grid unchanged.
   */
  public static getRenderableIntervals(data: {
    xAxisMin: XAxisMaxMin;
    xAxisMax: XAxisMaxMin;
    precision?: XAxisPrecision | undefined;
    seriesPoints?: Array<SeriesPoints> | undefined;
  }): Array<Date> {
    const intervals: Array<Date> = XAxisUtil.getPrecisionIntervals(data);

    if (!data.seriesPoints || intervals.length < 2) {
      return intervals;
    }

    const lastInterval: Date = intervals[intervals.length - 1]!;
    const previousInterval: Date = intervals[intervals.length - 2]!;

    /*
     * Bucket width read off the grid itself rather than recomputed from the
     * precision: the walk steps in wall-clock time, so a month, a year or a
     * daylight-saving day is exactly as wide as the grid says it is.
     */
    const bucketWidthInMs: number =
      lastInterval.getTime() - previousInterval.getTime();
    if (bucketWidthInMs <= 0) {
      return intervals;
    }

    /*
     * Emptiness — and the bucket boundary below — are decided with the SAME
     * formatter that DataPointUtil uses to place a datapoint on a row.
     * Anything else would let the two disagree about which bucket the last
     * slot IS, and the whole point of trimming here rather than in
     * DataPointUtil is that the rows, the categorical axis and the
     * annotation indexes are built from one array.
     */
    const formatter: (value: Date) => string = XAxisUtil.getFormatter(data);
    const lastLabel: string = formatter(lastInterval);

    /*
     * A slot's DATE and the bucket it collects into are not the same thing.
     * The walk starts at the window's own start, so on most charts the grid
     * is anchored mid-bucket: a "last 7 days" axis stepping a day from
     * 28 Aug 14:42 ends on a slot dated 4 Sep 14:42, which the formatter
     * floors to the label "4 Sep" — the bucket [4 Sep 00:00, 5 Sep 00:00),
     * of which the window covers nearly fifteen hours.
     *
     * Coverage can therefore only be measured off the slot's date when the
     * slot IS its bucket's start, which is what this asks: a slot on a
     * boundary has a different label one millisecond before it. When the
     * grid is anchored mid-bucket the window necessarily spans everything
     * from the bucket's real start up to the window end, which is most of
     * it, so the slot stays — the conservative answer, and the one that
     * keeps an empty "today" bar on a daily count chart.
     *
     * The alert snapshot is the aligned case (MetricView floors the window
     * start onto the bucket grid), which is exactly when the slot date is
     * the bucket start and the coverage measured below is the real one.
     */
    const isSlotOnBucketBoundary: boolean =
      formatter(new Date(lastInterval.getTime() - 1)) !== lastLabel;
    if (!isSlotOnBucketBoundary) {
      return intervals;
    }

    const windowEndInMs: number =
      typeof data.xAxisMax === "number"
        ? data.xAxisMax
        : OneUptimeDate.fromString(data.xAxisMax).getTime();
    const coverage: number =
      (windowEndInMs - lastInterval.getTime()) / bucketWidthInMs;
    if (coverage >= XAxisUtil.MIN_TRAILING_BUCKET_COVERAGE) {
      return intervals;
    }

    const slotLabels: Set<string> = new Set<string>(
      intervals.map((interval: Date) => {
        return formatter(interval);
      }),
    );

    let hasAnyData: boolean = false;
    for (const series of data.seriesPoints) {
      for (const point of series.data) {
        const label: string = formatter(point.x);
        if (label === lastLabel) {
          // The trailing bucket is populated — it stays.
          return intervals;
        }
        if (!hasAnyData && slotLabels.has(label)) {
          hasAnyData = true;
        }
      }
    }

    /*
     * A chart with nothing on it anywhere keeps its full grid, so an empty
     * chart still draws an axis spanning the window the user asked for
     * instead of one silently a bucket short.
     */
    if (!hasAnyData) {
      return intervals;
    }

    return intervals.slice(0, intervals.length - 1);
  }

  public static getFormatter(data: {
    xAxisMin: XAxisMaxMin;
    xAxisMax: XAxisMaxMin;
    precision?: XAxisPrecision | undefined;
  }): (value: Date) => string {
    const precision: XAxisPrecision = XAxisUtil.getPrecision(data);

    /*
     * Computed once here rather than per tick: every sub-hour tier below
     * needs the same answer, and it does not vary within a window.
     */
    const labelDetail: { withDate: boolean; withZone: boolean } =
      XAxisUtil.getWallClockLabelDetail(data);

    switch (precision) {
      case XAxisPrecision.EVERY_SECOND:
        return (value: Date) => {
          return XAxisUtil.getWallClockLabel(value, labelDetail, {
            includeSeconds: true,
          });
        };
      case XAxisPrecision.EVERY_FIVE_SECONDS:
        // round down to nearest 5 seconds
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          const seconds: number = roundedValue.getSeconds();
          const roundedSeconds: number = Math.floor(seconds / 5) * 5;
          roundedValue.setSeconds(roundedSeconds, 0);

          return XAxisUtil.getWallClockLabel(roundedValue, labelDetail, {
            includeSeconds: true,
          });
        };
      case XAxisPrecision.EVERY_TEN_SECONDS:
        // round down to nearest 10 seconds
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          const seconds: number = roundedValue.getSeconds();
          const roundedSeconds: number = Math.floor(seconds / 10) * 10;
          roundedValue.setSeconds(roundedSeconds, 0);

          return XAxisUtil.getWallClockLabel(roundedValue, labelDetail, {
            includeSeconds: true,
          });
        };
      case XAxisPrecision.EVERY_THIRTY_SECONDS:
        // round down to nearest 30 seconds
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          const seconds: number = roundedValue.getSeconds();
          const roundedSeconds: number = Math.floor(seconds / 30) * 30;
          roundedValue.setSeconds(roundedSeconds, 0);

          return XAxisUtil.getWallClockLabel(roundedValue, labelDetail, {
            includeSeconds: true,
          });
        };
      case XAxisPrecision.EVERY_MINUTE:
        // round down to nearest minute
        return (value: Date) => {
          return XAxisUtil.getWallClockLabel(value, labelDetail);
        };
      case XAxisPrecision.EVERY_FIVE_MINUTES:
        // round down to nearest 5 minutes
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          const minutes: number = roundedValue.getMinutes();
          const roundedMinutes: number = Math.floor(minutes / 5) * 5;
          roundedValue.setMinutes(roundedMinutes, 0, 0);

          return XAxisUtil.getWallClockLabel(roundedValue, labelDetail);
        };
      case XAxisPrecision.EVERY_TEN_MINUTES:
        // round down to nearest 10 minutes
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          const minutes: number = roundedValue.getMinutes();
          const roundedMinutes: number = Math.floor(minutes / 10) * 10;
          roundedValue.setMinutes(roundedMinutes, 0, 0);

          return XAxisUtil.getWallClockLabel(roundedValue, labelDetail);
        };
      case XAxisPrecision.EVERY_FIFTEEN_MINUTES:
        // round down to nearest 15 minutes
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          const minutes: number = roundedValue.getMinutes();
          const roundedMinutes: number = Math.floor(minutes / 15) * 15;
          roundedValue.setMinutes(roundedMinutes, 0, 0);

          return XAxisUtil.getWallClockLabel(roundedValue, labelDetail);
        };
      case XAxisPrecision.EVERY_THIRTY_MINUTES:
        // round down to nearest 30 minutes
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          const minutes: number = roundedValue.getMinutes();
          const roundedMinutes: number = Math.floor(minutes / 30) * 30;
          roundedValue.setMinutes(roundedMinutes, 0, 0);

          return XAxisUtil.getWallClockLabel(roundedValue, labelDetail);
        };
      case XAxisPrecision.EVERY_HOUR:
        /*
         * Include date — hourly buckets can span multiple days, where
         * a bare "HH" repeats and is ambiguous.
         */
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          roundedValue.setMinutes(0, 0, 0);
          return OneUptimeDate.getDateAsLocalDayMonthHourString(roundedValue);
        };
      case XAxisPrecision.EVERY_TWO_HOURS:
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          const hours: number = roundedValue.getHours();
          const roundedHours: number = Math.floor(hours / 2) * 2;
          roundedValue.setHours(roundedHours, 0, 0, 0);

          return OneUptimeDate.getDateAsLocalDayMonthHourString(roundedValue);
        };
      case XAxisPrecision.EVERY_THREE_HOURS:
        // round down to nearest 3 hours
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          const hours: number = roundedValue.getHours();
          const roundedHours: number = Math.floor(hours / 3) * 3;
          roundedValue.setHours(roundedHours, 0, 0, 0);

          return OneUptimeDate.getDateAsLocalDayMonthHourString(roundedValue);
        };
      case XAxisPrecision.EVERY_SIX_HOURS:
        // round down to nearest 6 hours // HH:00 DD MMM
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          const hours: number = roundedValue.getHours();
          const roundedHours: number = Math.floor(hours / 6) * 6;
          roundedValue.setHours(roundedHours, 0, 0, 0);

          return OneUptimeDate.getDateAsLocalDayMonthHourString(roundedValue);
        };
      case XAxisPrecision.EVERY_TWELVE_HOURS:
        // round down to nearest 12 hours  // DD MMM, HH:00
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          const hours: number = roundedValue.getHours();
          const roundedHours: number = Math.floor(hours / 12) * 12;
          roundedValue.setHours(roundedHours, 0, 0, 0);

          return OneUptimeDate.getDateAsLocalDayMonthHourString(roundedValue);
        };
      case XAxisPrecision.EVERY_DAY:
        // round down to nearest day
        return (value: Date) => {
          return OneUptimeDate.getDateAsLocalDayMonthString(value);
        };
      case XAxisPrecision.EVERY_TWO_DAYS:
        // round down to nearest 2 days
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          const days: number = roundedValue.getDate();
          const roundedDays: number = Math.floor(days / 2) * 2;
          roundedValue.setDate(roundedDays);

          return OneUptimeDate.getDateAsLocalDayMonthString(roundedValue);
        };
      case XAxisPrecision.EVERY_WEEK:
        /*
         * Day and month both read in the configured timezone. These used
         * to be mixed inside one label — value.getDate() is the BROWSER's
         * day — so a user whose zone put the tick on the other side of
         * midnight got a day from one date and a month from another.
         */
        return (value: Date) => {
          return OneUptimeDate.getDateAsLocalDayMonthString(value);
        };
      case XAxisPrecision.EVERY_TWO_WEEKS:
        // round down to nearest 2 weeks. // DD MMM
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          const days: number = roundedValue.getDate();
          const roundedDays: number = Math.floor(days / 2) * 2;
          roundedValue.setDate(roundedDays);

          // Day and month both in the configured zone; see EVERY_WEEK.
          return OneUptimeDate.getDateAsLocalDayMonthString(roundedValue);
        };
      case XAxisPrecision.EVERY_MONTH:
        // round down to nearest month // MM YYYY
        return (value: Date) => {
          return OneUptimeDate.getDateAsLocalMonthYearString(value);
        };

      case XAxisPrecision.EVERY_TWO_MONTHS:
        // round down to nearest 2 months // MM YYYY
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          const months: number = roundedValue.getMonth();
          const roundedMonths: number = Math.floor(months / 2) * 2;
          roundedValue.setMonth(roundedMonths);

          return OneUptimeDate.getDateAsLocalMonthYearString(roundedValue);
        };
      case XAxisPrecision.EVERY_THREE_MONTHS:
        // round down to nearest 3 months // MM YYYY
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          const months: number = roundedValue.getMonth();
          const roundedMonths: number = Math.floor(months / 3) * 3;
          roundedValue.setMonth(roundedMonths);

          return OneUptimeDate.getDateAsLocalMonthYearString(roundedValue);
        };
      case XAxisPrecision.EVERY_SIX_MONTHS:
        // round down to nearest 6 months // MM YYYY
        return (value: Date) => {
          const roundedValue: Date = this.cloneDate(value);
          const months: number = roundedValue.getMonth();
          const roundedMonths: number = Math.floor(months / 6) * 6;
          roundedValue.setMonth(roundedMonths);

          return OneUptimeDate.getDateAsLocalMonthYearString(roundedValue);
        };
      case XAxisPrecision.EVERY_YEAR:
        // round down to nearest year // YYYY
        return (value: Date) => {
          return value.getFullYear().toString();
        };
      default:
        throw new Error("Unsupported precision");
    }
  }
}
