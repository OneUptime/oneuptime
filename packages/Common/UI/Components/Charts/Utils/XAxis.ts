import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import OneUptimeDate, { CalendarUnit } from "../../../../Types/Date";
import NotImplementedException from "../../../../Types/Exception/NotImplementedException";
import Timezone from "../../../../Types/Timezone";
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

  private static readonly MILLISECONDS_IN_AN_HOUR: number = 60 * 60 * 1000;

  private static readonly MILLISECONDS_IN_A_MINUTE: number = 60 * 1000;

  /*
   * HOW THE AXIS STEPS, AND WHERE A POINT FALLS.
   *
   * Every step is taken on the clock of the timezone the reader configured
   * (OneUptimeDate.getCurrentTimezone()), the zone the labels are read in,
   * and never on the browser's: the browser can be in another zone, and
   * when one of the two changes its clocks inside the window, a step of
   * the browser's day was 23 or 25 hours of the reader's. A day slot then
   * started an hour off the reader's midnight and named the day before:
   * two slots read "25 Oct", their points shared a row, and the window's
   * last day had no slot at all (issue #7127).
   *
   *  - A step of an hour or less is that many milliseconds. Clocks change
   *    by whole hours, so these steps lie on an even grid of the reader's
   *    clock through a change: the hour a fall-back repeats is two slots,
   *    told apart by their zone (getWallClockLabelDetail), never one slot
   *    holding both hours. (Lord Howe Island's change is half an hour, and
   *    leaves one hour half an hour long: see getStartOfStepOnTheClock.)
   *  - A step of two to twelve hours is a block of the reader's clock
   *    (00:00-02:00, 02:00-04:00), as long as the clock says: the block a
   *    clock change falls in is longer or shorter by the change, and still
   *    one slot.
   *  - A step of a day or more is a step of the reader's calendar: from
   *    midnight to midnight, the 23 hours of a spring-forward day and the
   *    25 of a fall-back day included.
   *
   * A point falls in the step its own instant does, read the same way
   * (getBucketStart), and no Date setter is used for either: a setter reads
   * and writes the browser's clock, and puts the second reading of a
   * repeated hour back on the first.
   */

  // The width of a step of an hour or less; undefined for a longer one.
  private static getStepOfAnHourOrLessInMs(
    precision: XAxisPrecision,
  ): number | undefined {
    switch (precision) {
      case XAxisPrecision.EVERY_SECOND:
        return 1000;
      case XAxisPrecision.EVERY_FIVE_SECONDS:
        return 5 * 1000;
      case XAxisPrecision.EVERY_TEN_SECONDS:
        return 10 * 1000;
      case XAxisPrecision.EVERY_THIRTY_SECONDS:
        return 30 * 1000;
      case XAxisPrecision.EVERY_MINUTE:
        return XAxisUtil.MILLISECONDS_IN_A_MINUTE;
      case XAxisPrecision.EVERY_FIVE_MINUTES:
        return 5 * XAxisUtil.MILLISECONDS_IN_A_MINUTE;
      case XAxisPrecision.EVERY_TEN_MINUTES:
        return 10 * XAxisUtil.MILLISECONDS_IN_A_MINUTE;
      case XAxisPrecision.EVERY_FIFTEEN_MINUTES:
        return 15 * XAxisUtil.MILLISECONDS_IN_A_MINUTE;
      case XAxisPrecision.EVERY_THIRTY_MINUTES:
        return 30 * XAxisUtil.MILLISECONDS_IN_A_MINUTE;
      case XAxisPrecision.EVERY_HOUR:
        return XAxisUtil.MILLISECONDS_IN_AN_HOUR;
      default:
        return undefined;
    }
  }

  // The length of a block of two to twelve hours; undefined for any other step.
  private static getClockBlockInMs(
    precision: XAxisPrecision,
  ): number | undefined {
    switch (precision) {
      case XAxisPrecision.EVERY_TWO_HOURS:
        return 2 * XAxisUtil.MILLISECONDS_IN_AN_HOUR;
      case XAxisPrecision.EVERY_THREE_HOURS:
        return 3 * XAxisUtil.MILLISECONDS_IN_AN_HOUR;
      case XAxisPrecision.EVERY_SIX_HOURS:
        return 6 * XAxisUtil.MILLISECONDS_IN_AN_HOUR;
      case XAxisPrecision.EVERY_TWELVE_HOURS:
        return 12 * XAxisUtil.MILLISECONDS_IN_AN_HOUR;
      default:
        return undefined;
    }
  }

  // A step of a day or more, in units of the calendar; undefined for a shorter one.
  private static getCalendarStep(
    precision: XAxisPrecision,
  ): { unit: CalendarUnit; count: number } | undefined {
    switch (precision) {
      case XAxisPrecision.EVERY_DAY:
        return { unit: "day", count: 1 };
      case XAxisPrecision.EVERY_TWO_DAYS:
        return { unit: "day", count: 2 };
      case XAxisPrecision.EVERY_WEEK:
        return { unit: "day", count: 7 };
      case XAxisPrecision.EVERY_TWO_WEEKS:
        return { unit: "day", count: 14 };
      case XAxisPrecision.EVERY_MONTH:
        return { unit: "month", count: 1 };
      case XAxisPrecision.EVERY_TWO_MONTHS:
        return { unit: "month", count: 2 };
      case XAxisPrecision.EVERY_THREE_MONTHS:
        return { unit: "month", count: 3 };
      case XAxisPrecision.EVERY_SIX_MONTHS:
        return { unit: "month", count: 6 };
      case XAxisPrecision.EVERY_YEAR:
        return { unit: "year", count: 1 };
      default:
        return undefined;
    }
  }

  // How far ahead of UTC the reader's clock is at `instant`, in milliseconds.
  private static getClockOffsetInMs(instant: number): number {
    return (
      OneUptimeDate.getTimezoneOffsetInMinutes(new Date(instant)) *
      XAxisUtil.MILLISECONDS_IN_A_MINUTE
    );
  }

  /*
   * What the reader's clock reads at `instant`, as the milliseconds of that
   * reading counted as if it were UTC: midnight is a whole number of days.
   */
  private static toClockReading(instant: number): number {
    return instant + XAxisUtil.getClockOffsetInMs(instant);
  }

  /*
   * The offsets the reader's clock can have around a reading: those of a day
   * before it and a day after it. A zone changes its clocks months apart, so
   * no other offset is in effect within a day of it.
   */
  private static getClockOffsetsAround(reading: number): Array<number> {
    return [
      XAxisUtil.getClockOffsetInMs(reading - XAxisUtil.MILLISECONDS_IN_A_DAY),
      XAxisUtil.getClockOffsetInMs(reading + XAxisUtil.MILLISECONDS_IN_A_DAY),
    ];
  }

  /*
   * Every instant at which the reader's clock reads `reading`, earliest
   * first: one; none in the hour a spring-forward skips; two in the hour a
   * fall-back repeats.
   */
  private static getInstantsReading(reading: number): Array<number> {
    const instants: Array<number> = [];

    for (const offset of XAxisUtil.getClockOffsetsAround(reading)) {
      const instant: number = reading - offset;

      if (
        XAxisUtil.toClockReading(instant) === reading &&
        !instants.includes(instant)
      ) {
        instants.push(instant);
      }
    }

    return instants.sort((a: number, b: number): number => {
      return a - b;
    });
  }

  /*
   * The instant the reader's clock changed between `before` and `after`,
   * whose offsets differ: the first one with the offset `after` has. A zone
   * changes its clocks months apart, so there is one change between them,
   * and halving the span finds it to the millisecond.
   */
  private static getClockChangeBetween(before: number, after: number): number {
    const offsetAfter: number = XAxisUtil.getClockOffsetInMs(after);
    let low: number = before;
    let high: number = after;

    while (high - low > 1) {
      const middle: number = Math.floor((low + high) / 2);

      if (XAxisUtil.getClockOffsetInMs(middle) === offsetAfter) {
        high = middle;
      } else {
        low = middle;
      }
    }

    return high;
  }

  /*
   * The instant the reader's clock resumes at after skipping `reading`: the
   * spring-forward itself. The clock reads `reading` minus the earlier
   * offset after it, and minus the later offset before it.
   */
  private static getClockResumingAfter(reading: number): number {
    const offsets: Array<number> = XAxisUtil.getClockOffsetsAround(reading);

    return XAxisUtil.getClockChangeBetween(
      reading - Math.max(...offsets),
      reading - Math.min(...offsets),
    );
  }

  /*
   * The instant a slot of a block of `blockInMs` stands at when the reader's
   * clock should read `reading`: in a repeated hour its first reading. In an
   * hour the clock skips, an instant of the same block, so every block keeps
   * its one slot; the first of these that is in the block:
   *
   *  - where the clock read `reading` less the change, before the gap, so
   *    the slot keeps the walk's minutes (London's 01:37 at 00:37 GMT);
   *  - the block's start, if the clock read it before the gap (Troll
   *    station's clocks go forward two hours, from 01:00 to 03:00, which
   *    leaves the block from 00:00 only its first hour);
   *  - where the clock resumes after the gap, the block's first instant
   *    (New York's 02:00 at 03:00 EDT).
   */
  private static getInstantForBlockReading(
    reading: number,
    blockInMs: number,
  ): number {
    const readings: Array<number> = XAxisUtil.getInstantsReading(reading);

    if (readings.length > 0) {
      return readings[0]!;
    }

    const blockStart: number = Math.floor(reading / blockInMs) * blockInMs;
    const offsets: Array<number> = XAxisUtil.getClockOffsetsAround(reading);
    const beforeTheGap: number = reading - Math.max(...offsets);

    if (XAxisUtil.toClockReading(beforeTheGap) >= blockStart) {
      return beforeTheGap;
    }

    const blockStartBeforeTheGap: number = blockStart - Math.min(...offsets);

    if (XAxisUtil.toClockReading(blockStartBeforeTheGap) === blockStart) {
      return blockStartBeforeTheGap;
    }

    return XAxisUtil.getClockResumingAfter(reading);
  }

  /*
   * The start of the step of an hour or less the reader's clock reads
   * `value` in. Taken with the offset of `value` itself, so the two
   * readings of a repeated hour are two different steps.
   *
   * A clock change on a whole hour falls between two steps. Lord Howe
   * Island's clocks change by half an hour, so its change falls inside an
   * hour: the hour starts where the clock took the offset of `value`, and
   * is half an hour long.
   */
  private static getStartOfStepOnTheClock(value: Date, stepInMs: number): Date {
    const instant: number = value.getTime();
    const offset: number = XAxisUtil.getClockOffsetInMs(instant);
    const start: number =
      Math.floor((instant + offset) / stepInMs) * stepInMs - offset;

    if (XAxisUtil.getClockOffsetInMs(start) === offset) {
      return new Date(start);
    }

    return new Date(XAxisUtil.getClockChangeBetween(start, instant));
  }

  /*
   * The start of the step after the one starting at `stepStart`: a step
   * later, or sooner where the clock changes inside the step (see
   * getStartOfStepOnTheClock).
   */
  private static getStartOfNextStepOnTheClock(
    stepStart: number,
    stepInMs: number,
  ): number {
    const lastStart: number = XAxisUtil.getStartOfStepOnTheClock(
      new Date(stepStart + stepInMs - 1),
      stepInMs,
    ).getTime();

    return lastStart === stepStart ? stepStart + stepInMs : lastStart;
  }

  /*
   * Gives a step the walk passed over its slot. A walk of steps of an hour
   * or less moves a fixed number of milliseconds, one slot in each step of
   * the clock, as long as every step is that long; Lord Howe Island's
   * half-hour change leaves an hour of half an hour, which a step of an
   * hour can pass over when the window starts late in an hour. Its points
   * would have no slot to go to.
   */
  private static withEveryStepOnTheClock(
    slots: Array<Date>,
    stepInMs: number,
  ): Array<Date> {
    const result: Array<Date> = [];

    for (const slot of slots) {
      const previous: Date | undefined = result[result.length - 1];

      if (
        previous &&
        XAxisUtil.getClockOffsetInMs(previous.getTime()) !==
          XAxisUtil.getClockOffsetInMs(slot.getTime())
      ) {
        const slotStart: number = XAxisUtil.getStartOfStepOnTheClock(
          slot,
          stepInMs,
        ).getTime();
        let next: number = XAxisUtil.getStartOfNextStepOnTheClock(
          XAxisUtil.getStartOfStepOnTheClock(previous, stepInMs).getTime(),
          stepInMs,
        );

        // Each step starts after the one before; anything else ends the search.
        while (next > previous.getTime() && next < slotStart) {
          result.push(new Date(next));

          const following: number = XAxisUtil.getStartOfNextStepOnTheClock(
            next,
            stepInMs,
          );

          if (following <= next) {
            break;
          }

          next = following;
        }
      }

      result.push(slot);
    }

    return result;
  }

  /*
   * The start of the block of the reader's clock (00:00-02:00, ...) `value`
   * falls in. A block a fall-back falls in holds the repeated hour twice and
   * starts at its first reading; a block whose first reading a
   * spring-forward skips starts where the clock resumes.
   */
  private static getClockBlockStart(value: Date, blockInMs: number): Date {
    const instant: number = value.getTime();
    const blockReading: number =
      Math.floor(XAxisUtil.toClockReading(instant) / blockInMs) * blockInMs;
    const readings: Array<number> = XAxisUtil.getInstantsReading(
      blockReading,
    ).filter((reading: number): boolean => {
      return reading <= instant;
    });

    if (readings.length > 0) {
      return new Date(readings[0]!);
    }

    return new Date(XAxisUtil.getClockResumingAfter(blockReading));
  }

  /*
   * An instant on the given day of the reader's calendar (a reading at
   * midnight of it, day 0 being the last day of the month before, as Date
   * counts): its noon, which no clock change moves to another day.
   */
  private static getNoonOfTheDay(
    year: number,
    month: number,
    day: number,
  ): Date {
    const noon: number = Date.UTC(year, month, day, 12);

    return new Date(noon - XAxisUtil.getClockOffsetInMs(noon));
  }

  /*
   * The day a two-day or two-week step files `value` under: its day of the
   * month on the reader's calendar, rounded down to an even one.
   */
  private static getEvenDayOfTheMonth(value: Date): Date {
    const reading: Date = new Date(XAxisUtil.toClockReading(value.getTime()));

    return XAxisUtil.getNoonOfTheDay(
      reading.getUTCFullYear(),
      reading.getUTCMonth(),
      Math.floor(reading.getUTCDate() / 2) * 2,
    );
  }

  /*
   * The first month of the step of `months` months `value` falls in, on the
   * reader's calendar: January, March, ... for two; January, April, ... for
   * three; January and July for six.
   */
  private static getFirstMonthOfTheStep(value: Date, months: number): Date {
    const reading: Date = new Date(XAxisUtil.toClockReading(value.getTime()));

    return XAxisUtil.getNoonOfTheDay(
      reading.getUTCFullYear(),
      Math.floor(reading.getUTCMonth() / months) * months,
      1,
    );
  }

  /*
   * The slot `steps` steps of this precision after `start`, counted from
   * `start` itself rather than from the slot before, so a month step from
   * the 31st lands on each month's last day instead of drifting to the
   * 28th, and a day step from 02:30 keeps 02:30 after a spring-forward.
   */
  private static getIntervalAfterSteps(
    start: Date,
    precision: XAxisPrecision,
    steps: number,
  ): Date {
    if (steps === 0) {
      return XAxisUtil.cloneDate(start);
    }

    const stepInMs: number | undefined =
      XAxisUtil.getStepOfAnHourOrLessInMs(precision);

    if (stepInMs !== undefined) {
      return new Date(start.getTime() + steps * stepInMs);
    }

    const blockInMs: number | undefined =
      XAxisUtil.getClockBlockInMs(precision);

    if (blockInMs !== undefined) {
      return new Date(
        XAxisUtil.getInstantForBlockReading(
          XAxisUtil.toClockReading(start.getTime()) + steps * blockInMs,
          blockInMs,
        ),
      );
    }

    const calendarStep: { unit: CalendarUnit; count: number } | undefined =
      XAxisUtil.getCalendarStep(precision);

    if (calendarStep) {
      return OneUptimeDate.addRemoveCalendarUnits(
        start,
        calendarStep.unit,
        steps * calendarStep.count,
        OneUptimeDate.getCurrentTimezone(),
      );
    }

    return XAxisUtil.cloneDate(start);
  }

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
   *    Steps of an hour or less are walked in milliseconds, so the walk
   *    passes through the repeated hour in every zone - browser and
   *    configured zone the same or not - and its two readings are two
   *    slots. Measured on a 4h window across London's fall-back: 49
   *    intervals, and without the zone 37 distinct labels. The zone
   *    abbreviation is what tells "01:00 BST" from "01:00 GMT", for the
   *    hourly tier as for the finer ones.
   *
   *    The offsets at the two ends find a change inside a window that
   *    holds one. Steps this fine are only drawn over windows far shorter
   *    than the months between a zone's two changes a year.
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
   * Whether a day-and-month label ("12 Nov") has to carry its year to name
   * exactly one day inside this window.
   *
   * Once a window holds a year, one day of the calendar falls in it twice:
   * "Past 1 Year" on 12 Nov 2026 runs from 12 Nov 2025, so both ends read
   * "12 Nov". A label is a bucket's identity (see above), so the two days
   * became one bucket - this year's point joined last year's, and the slot
   * at the right-hand end stayed empty. The day tiers only came from the
   * duration ladder for windows of six weeks or less, where this never
   * happens; a caller that pins them to its bucket size (a chart of one
   * point a day, issue #6564; an SLO's daily history) can draw a year.
   *
   * The test is the calendar's, in the configured timezone: the window
   * reaches the start of its first day a year on. A window that starts on
   * 29 February reaches "a year on" (28 February) a day early, so it shows
   * years one day sooner than it must, which reads just as well.
   */
  private static getDayLabelNeedsYear(data: {
    xAxisMin: XAxisMaxMin;
    xAxisMax: XAxisMaxMin;
  }): boolean {
    if (
      typeof data.xAxisMin === "number" ||
      typeof data.xAxisMax === "number"
    ) {
      return false;
    }

    const startDate: Date = OneUptimeDate.fromString(data.xAxisMin);
    const endDate: Date = OneUptimeDate.fromString(data.xAxisMax);
    const timezone: Timezone = OneUptimeDate.getCurrentTimezone();

    const firstDayAYearOn: Date = OneUptimeDate.addRemoveYears(
      OneUptimeDate.getStartOfDay(startDate, timezone),
      1,
      timezone,
    );

    return firstDayAYearOn.getTime() <= endDate.getTime();
  }

  /**
   * The label for a bucket of a day or longer that starts on `value`:
   * "12 Nov", or "12 Nov 2025" in a window of a year or more.
   */
  private static getDayLabel(value: Date, withYear: boolean): string {
    return withYear
      ? OneUptimeDate.getDateAsLocalDayMonthYearString(value)
      : OneUptimeDate.getDateAsLocalDayMonthString(value);
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

  /**
   * The label for an hour's bucket: "25 Oct, 01:00", with the zone when the
   * clocks go back inside the window ("25 Oct, 01:00 BST"), since the hour
   * they repeat is then two buckets with the same day and the same hour.
   */
  private static getHourLabel(value: Date, withZone: boolean): string {
    const base: string = OneUptimeDate.getDateAsLocalDayMonthHourString(value);

    if (!withZone) {
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

    if (
      !Number.isFinite(startDate.getTime()) ||
      !Number.isFinite(endDate.getTime())
    ) {
      return intervals;
    }

    /*
     * Each slot is counted from the window start (see
     * getIntervalAfterSteps); a slot that is not after the one before it
     * would walk for ever, so it ends the walk.
     */
    for (let steps: number = 0; ; steps++) {
      const slot: Date = XAxisUtil.getIntervalAfterSteps(
        startDate,
        precision,
        steps,
      );
      const previous: Date | undefined = intervals[intervals.length - 1];

      if (
        !(slot.getTime() <= endDate.getTime()) ||
        (previous && slot.getTime() <= previous.getTime())
      ) {
        break;
      }

      intervals.push(slot);
    }

    const stepInMs: number | undefined =
      XAxisUtil.getStepOfAnHourOrLessInMs(precision);

    return stepInMs === undefined
      ? intervals
      : XAxisUtil.withEveryStepOnTheClock(intervals, stepInMs);
  }

  /*
   * The slot after `interval` on a grid of this precision: one step of the
   * walk, on the reader's clock (see "How the axis steps" above), so a step
   * of a day across one of its clock changes is 23 or 25 hours, a block of
   * hours the change falls in is an hour longer or shorter, and a step of a
   * month is that month's length. Returns a new Date; `interval` is left as
   * it is.
   */
  public static getNextInterval(
    interval: Date,
    precision: XAxisPrecision,
  ): Date {
    return XAxisUtil.getIntervalAfterSteps(interval, precision, 1);
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

    /*
     * The trailing bucket's own width: one more step of the walk from its
     * start, rather than the precision's nominal length or the step before
     * it. The walk steps on the reader's clock and calendar, so a month, a
     * year or a day their clocks change on is exactly as wide as it really
     * is there - the 23 hours of a spring-forward day, the 25 of a
     * fall-back day, the 28 days of a February after a January of 31 -
     * whatever zone the browser is in.
     */
    const bucketWidthInMs: number =
      XAxisUtil.getNextInterval(
        lastInterval,
        XAxisUtil.getPrecision(data),
      ).getTime() - lastInterval.getTime();
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

  /**
   * The start of the bucket a point at `value` is grouped into on an axis
   * of this precision: exactly the instant getFormatter rounds `value` to
   * before labelling it.
   *
   * The axis walks its slots from the window start, which is rarely on the
   * grid - a rolling "past week" starts at now minus seven days, 10:23 say -
   * while points join rows by their formatted label, which IS on the grid.
   * So the row labelled "10:00" on an hourly axis draws the 10:00 bucket but
   * its slot starts at 10:23. Anything that turns a row back into time (a
   * drag-to-zoom, a bucket click) needs the bucket's start, not the slot's;
   * otherwise a zoom lands up to one bucket late and can cut out the very
   * spike it was aimed at.
   *
   * Every tier finer than a day rounds on the reader's clock, as the
   * formatter does (it labels exactly this instant), and EVERY_DAY groups
   * by the calendar day in the configured timezone, as its label does. The
   * coarser tiers label a day or a month that does not reduce to one
   * instant the slot could start at; they keep the slot start.
   */
  public static getBucketStart(value: Date, precision: XAxisPrecision): Date {
    const stepInMs: number | undefined =
      XAxisUtil.getStepOfAnHourOrLessInMs(precision);

    if (stepInMs !== undefined) {
      return XAxisUtil.getStartOfStepOnTheClock(value, stepInMs);
    }

    const blockInMs: number | undefined =
      XAxisUtil.getClockBlockInMs(precision);

    if (blockInMs !== undefined) {
      return XAxisUtil.getClockBlockStart(value, blockInMs);
    }

    if (precision === XAxisPrecision.EVERY_DAY) {
      return OneUptimeDate.getStartOfDay(
        value,
        OneUptimeDate.getCurrentTimezone(),
      );
    }

    return this.cloneDate(value);
  }

  public static getFormatter(data: {
    xAxisMin: XAxisMaxMin;
    xAxisMax: XAxisMaxMin;
    precision?: XAxisPrecision | undefined;
  }): (value: Date) => string {
    const precision: XAxisPrecision = XAxisUtil.getPrecision(data);

    /*
     * Computed once here rather than per tick: every tier of an hour or
     * less below needs the same answer, and it does not vary within a
     * window.
     */
    const labelDetail: { withDate: boolean; withZone: boolean } =
      XAxisUtil.getWallClockLabelDetail(data);
    // Asked of the day and week tiers alone: the finer ones never use it.
    const isDayTier: boolean =
      precision === XAxisPrecision.EVERY_DAY ||
      precision === XAxisPrecision.EVERY_TWO_DAYS ||
      precision === XAxisPrecision.EVERY_WEEK ||
      precision === XAxisPrecision.EVERY_TWO_WEEKS;
    const isDayLabelWithYear: boolean =
      isDayTier && XAxisUtil.getDayLabelNeedsYear(data);

    /*
     * Every tier finer than a day labels the start of the step its value
     * falls in, read on the reader's clock (getBucketStart), so a point and
     * the slot it belongs to always agree on the label.
     */
    const bucketStartOf: (value: Date) => Date = (value: Date): Date => {
      return XAxisUtil.getBucketStart(value, precision);
    };

    switch (precision) {
      case XAxisPrecision.EVERY_SECOND:
      case XAxisPrecision.EVERY_FIVE_SECONDS:
      case XAxisPrecision.EVERY_TEN_SECONDS:
      case XAxisPrecision.EVERY_THIRTY_SECONDS:
        return (value: Date) => {
          return XAxisUtil.getWallClockLabel(
            bucketStartOf(value),
            labelDetail,
            {
              includeSeconds: true,
            },
          );
        };
      case XAxisPrecision.EVERY_MINUTE:
      case XAxisPrecision.EVERY_FIVE_MINUTES:
      case XAxisPrecision.EVERY_TEN_MINUTES:
      case XAxisPrecision.EVERY_FIFTEEN_MINUTES:
      case XAxisPrecision.EVERY_THIRTY_MINUTES:
        return (value: Date) => {
          return XAxisUtil.getWallClockLabel(bucketStartOf(value), labelDetail);
        };
      case XAxisPrecision.EVERY_HOUR:
        /*
         * Include date — hourly buckets can span multiple days, where
         * a bare "HH" repeats and is ambiguous.
         */
        return (value: Date) => {
          return XAxisUtil.getHourLabel(
            bucketStartOf(value),
            labelDetail.withZone,
          );
        };
      case XAxisPrecision.EVERY_TWO_HOURS:
      case XAxisPrecision.EVERY_THREE_HOURS:
      case XAxisPrecision.EVERY_SIX_HOURS:
      case XAxisPrecision.EVERY_TWELVE_HOURS:
        /*
         * "02 Mar, 14:00": the block's start. A block holds a repeated
         * hour whole, so no two blocks ever read the same.
         */
        return (value: Date) => {
          return OneUptimeDate.getDateAsLocalDayMonthHourString(
            bucketStartOf(value),
          );
        };
      case XAxisPrecision.EVERY_DAY:
      case XAxisPrecision.EVERY_WEEK:
        /*
         * Day and month both read in the configured timezone. These used
         * to be mixed inside one label — value.getDate() is the BROWSER's
         * day — so a user whose zone put the tick on the other side of
         * midnight got a day from one date and a month from another.
         */
        return (value: Date) => {
          return XAxisUtil.getDayLabel(value, isDayLabelWithYear);
        };
      case XAxisPrecision.EVERY_TWO_DAYS:
      case XAxisPrecision.EVERY_TWO_WEEKS:
        // The day rounded down to an even one, on the configured calendar.
        return (value: Date) => {
          return XAxisUtil.getDayLabel(
            XAxisUtil.getEvenDayOfTheMonth(value),
            isDayLabelWithYear,
          );
        };
      case XAxisPrecision.EVERY_MONTH:
        // "Mar 2026", in the configured timezone.
        return (value: Date) => {
          return OneUptimeDate.getDateAsLocalMonthYearString(value);
        };
      case XAxisPrecision.EVERY_TWO_MONTHS:
        return (value: Date) => {
          return OneUptimeDate.getDateAsLocalMonthYearString(
            XAxisUtil.getFirstMonthOfTheStep(value, 2),
          );
        };
      case XAxisPrecision.EVERY_THREE_MONTHS:
        return (value: Date) => {
          return OneUptimeDate.getDateAsLocalMonthYearString(
            XAxisUtil.getFirstMonthOfTheStep(value, 3),
          );
        };
      case XAxisPrecision.EVERY_SIX_MONTHS:
        return (value: Date) => {
          return OneUptimeDate.getDateAsLocalMonthYearString(
            XAxisUtil.getFirstMonthOfTheStep(value, 6),
          );
        };
      case XAxisPrecision.EVERY_YEAR:
        /*
         * "2026": the year on the configured calendar, as the reader's
         * language writes it ("۲۰۲۶" in Persian, "2026年" in Japanese), like
         * the month and day ticks. Written with Latin digits on a Persian
         * page, it stood apart from every other tick.
         */
        return (value: Date) => {
          return OneUptimeDate.getDateAsLocalYearString(value);
        };
      default:
        throw new Error("Unsupported precision");
    }
  }
}
