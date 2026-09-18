import OneUptimeDate from "../Date";
import moment from "moment-timezone";

/*
 * The geometry of the schedule timeline, kept free of React so every rule
 * that decides WHERE something is drawn is unit-tested on its own.
 *
 * Two ideas carry the whole file:
 *
 * 1. Days are computed in the VIEW timezone, never the browser's. A week is
 *    Monday 00:00 to the next Monday 00:00 on the wall clock of the zone the
 *    reader picked, so "Tuesday" means the same thing in the header and in
 *    the tooltip, whatever machine the page is open on.
 *
 * 2. Positions are in COLUMN space, not in raw time. Every day column has the
 *    same width, but a DST day lasts 23 or 25 hours, so a bar positioned by
 *    (t - rangeStart) / rangeLength would drift off its column by up to an
 *    hour across a clock change. Instead an instant is placed in the column
 *    of its day, at the fraction of that day that has elapsed, and a shift
 *    that ends at local midnight always ends exactly on a gridline.
 */

export enum TimelineViewMode {
  Week = "week",
  Month = "month",
}

export interface TimelineDay {
  // "YYYY-MM-DD" in the view timezone.
  key: string;
  start: Date;
  end: Date;
  dayOfMonth: number;
  // "Mon"
  weekdayShort: string;
  // "M"
  weekdayNarrow: string;
  // "Sep"
  monthShort: string;
  isWeekend: boolean;
  isFirstOfMonth: boolean;
}

export interface TimelineRange {
  mode: TimelineViewMode;
  timezone: string;
  start: Date;
  end: Date;
  days: Array<TimelineDay>;
}

export interface TimeInterval {
  start: Date;
  end: Date;
}

export interface PositionedInterval<T extends TimeInterval> {
  item: T;
  // Both in percent of the day area (0-100).
  left: number;
  width: number;
  // The interval is cut at the range edge; its true start / end is outside.
  continuesBefore: boolean;
  continuesAfter: boolean;
}

const MILLISECONDS_PER_MINUTE: number = 60 * 1000;

const HEX_COLOR_PATTERN: RegExp = /^[0-9a-fA-F]{6}$/;

export default class ScheduleTimelineLayout {
  /*
   * The days on screen for `mode` around `anchor`, in `timezone`:
   *   Week  -> the ISO week (Monday first) containing the anchor;
   *   Month -> the calendar month containing the anchor.
   */
  public static getRange(data: {
    mode: TimelineViewMode;
    anchor: Date;
    timezone: string;
  }): TimelineRange {
    const zoned: moment.Moment = moment.tz(data.anchor, data.timezone);

    const first: moment.Moment =
      data.mode === TimelineViewMode.Month
        ? zoned.clone().startOf("month")
        : zoned.clone().startOf("isoWeek");

    const last: moment.Moment =
      data.mode === TimelineViewMode.Month
        ? first.clone().add(1, "month")
        : first.clone().add(7, "days");

    const days: Array<TimelineDay> = [];
    const cursor: moment.Moment = first.clone();

    // Bounded: a month has at most 31 days; the guard only stops a bad zone.
    while (cursor.isBefore(last) && days.length < 32) {
      const next: moment.Moment = cursor.clone().add(1, "day");
      const isoWeekday: number = cursor.isoWeekday();

      days.push({
        key: cursor.format("YYYY-MM-DD"),
        start: cursor.toDate(),
        end: next.toDate(),
        dayOfMonth: cursor.date(),
        weekdayShort: cursor.format("ddd"),
        weekdayNarrow: cursor.format("dd").charAt(0),
        monthShort: cursor.format("MMM"),
        isWeekend: isoWeekday === 6 || isoWeekday === 7,
        isFirstOfMonth: cursor.date() === 1,
      });

      cursor.add(1, "day");
    }

    return {
      mode: data.mode,
      timezone: data.timezone,
      start: first.toDate(),
      end: last.toDate(),
      days,
    };
  }

  // The anchor one week / month before or after, keeping the wall clock.
  public static shiftAnchor(data: {
    mode: TimelineViewMode;
    anchor: Date;
    timezone: string;
    direction: 1 | -1;
  }): Date {
    const zoned: moment.Moment = moment.tz(data.anchor, data.timezone);

    if (data.mode === TimelineViewMode.Month) {
      return zoned
        .clone()
        .startOf("month")
        .add(data.direction, "month")
        .toDate();
    }

    return zoned
      .clone()
      .startOf("isoWeek")
      .add(data.direction * 7, "days")
      .toDate();
  }

  /*
   * "September 14 – 20, 2026", "Sep 28 – Oct 4, 2026",
   * "Dec 28, 2026 – Jan 3, 2027" or "September 2026".
   */
  public static getRangeLabel(range: TimelineRange): string {
    const first: moment.Moment = moment.tz(range.start, range.timezone);

    if (range.mode === TimelineViewMode.Month) {
      return first.format("MMMM YYYY");
    }

    const lastDay: TimelineDay | undefined = range.days[range.days.length - 1];
    const last: moment.Moment = moment.tz(
      lastDay ? lastDay.start : range.start,
      range.timezone,
    );

    if (first.year() !== last.year()) {
      return `${first.format("MMM D, YYYY")} – ${last.format("MMM D, YYYY")}`;
    }

    if (first.month() !== last.month()) {
      return `${first.format("MMM D")} – ${last.format("MMM D, YYYY")}`;
    }

    return `${first.format("MMMM D")} – ${last.format("D, YYYY")}`;
  }

  // "YYYY-MM-DD" of the day containing `date` in `timezone`.
  public static getDayKey(date: Date, timezone: string): string {
    return moment.tz(date, timezone).format("YYYY-MM-DD");
  }

  public static isWithinRange(date: Date, range: TimeInterval): boolean {
    return (
      date.getTime() >= range.start.getTime() &&
      date.getTime() < range.end.getTime()
    );
  }

  /*
   * Where `instant` falls across the day columns, from 0 (the left edge of
   * the first day) to 1 (the right edge of the last). See the file comment
   * for why this is column space rather than raw time.
   */
  public static getFraction(instant: Date, range: TimelineRange): number {
    const days: Array<TimelineDay> = range.days;

    if (days.length === 0) {
      return 0;
    }

    const time: number = instant.getTime();

    if (time <= days[0]!.start.getTime()) {
      return 0;
    }

    if (time >= days[days.length - 1]!.end.getTime()) {
      return 1;
    }

    let low: number = 0;
    let high: number = days.length - 1;

    while (low < high) {
      const mid: number = Math.floor((low + high + 1) / 2);

      if (days[mid]!.start.getTime() <= time) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    const day: TimelineDay = days[low]!;
    const dayLength: number = day.end.getTime() - day.start.getTime();
    const withinDay: number =
      dayLength > 0 ? (time - day.start.getTime()) / dayLength : 0;

    return (low + Math.min(1, Math.max(0, withinDay))) / days.length;
  }

  /*
   * Place intervals on the day area. Anything that does not overlap the
   * range is dropped; anything that runs past an edge is cut there and says
   * so, so the bar can square off that end instead of pretending to start or
   * stop at the edge of the screen.
   */
  public static positionIntervals<T extends TimeInterval>(
    items: Array<T>,
    range: TimelineRange,
  ): Array<PositionedInterval<T>> {
    const out: Array<PositionedInterval<T>> = [];

    for (const item of items) {
      if (
        item.end.getTime() <= range.start.getTime() ||
        item.start.getTime() >= range.end.getTime()
      ) {
        continue;
      }

      const left: number =
        ScheduleTimelineLayout.getFraction(item.start, range) * 100;
      const right: number =
        ScheduleTimelineLayout.getFraction(item.end, range) * 100;

      if (right <= left) {
        continue;
      }

      out.push({
        item,
        left,
        width: right - left,
        continuesBefore: item.start.getTime() < range.start.getTime(),
        continuesAfter: item.end.getTime() > range.end.getTime(),
      });
    }

    return out;
  }

  /*
   * The stretches of [windowStart, windowEnd) that no interval covers,
   * ignoring holes shorter than `minimumGapMs` (the engine's one-second seams
   * and similar slivers would otherwise draw as hairlines). Overlapping and
   * unsorted input is fine.
   */
  public static computeGaps(
    intervals: Array<TimeInterval>,
    windowStart: Date,
    windowEnd: Date,
    minimumGapMs: number = MILLISECONDS_PER_MINUTE,
  ): Array<TimeInterval> {
    const startTime: number = windowStart.getTime();
    const endTime: number = windowEnd.getTime();

    if (endTime <= startTime) {
      return [];
    }

    const sorted: Array<TimeInterval> = intervals
      .filter((interval: TimeInterval) => {
        return (
          interval.end.getTime() > startTime &&
          interval.start.getTime() < endTime &&
          interval.end.getTime() > interval.start.getTime()
        );
      })
      .sort((a: TimeInterval, b: TimeInterval) => {
        return a.start.getTime() - b.start.getTime();
      });

    const gaps: Array<TimeInterval> = [];
    let cursor: number = startTime;

    const pushGap: (from: number, to: number) => void = (
      from: number,
      to: number,
    ): void => {
      if (to - from >= Math.max(1, minimumGapMs)) {
        gaps.push({ start: new Date(from), end: new Date(to) });
      }
    };

    for (const interval of sorted) {
      const intervalStart: number = Math.max(
        startTime,
        interval.start.getTime(),
      );
      const intervalEnd: number = Math.min(endTime, interval.end.getTime());

      if (intervalStart > cursor) {
        pushGap(cursor, intervalStart);
      }

      cursor = Math.max(cursor, intervalEnd);
    }

    if (cursor < endTime) {
      pushGap(cursor, endTime);
    }

    return gaps;
  }

  // The first interval containing `now`, if any.
  public static findActive<T extends TimeInterval>(
    items: Array<T>,
    now: Date,
  ): T | null {
    for (const item of items) {
      if (
        item.start.getTime() <= now.getTime() &&
        item.end.getTime() > now.getTime()
      ) {
        return item;
      }
    }

    return null;
  }

  /*
   * "Mon, Sep 14, 09:00 → Mon, Sep 21, 09:00", or
   * "Mon, Sep 14, 09:00 – 17:00" when both ends are on the same day. The end
   * is exclusive, so a shift ending at midnight reads "→ Tue, 00:00".
   */
  public static formatInterval(data: {
    start: Date;
    end: Date;
    timezone: string;
    use12HourFormat?: boolean | undefined;
  }): string {
    const use12HourFormat: boolean =
      data.use12HourFormat ?? OneUptimeDate.getUserPrefers12HourFormat();
    const timeFormat: string = use12HourFormat ? "h:mm A" : "HH:mm";
    const dateFormat: string = "ddd, MMM D";

    const start: moment.Moment = moment.tz(data.start, data.timezone);
    const end: moment.Moment = moment.tz(data.end, data.timezone);

    const startText: string = `${start.format(dateFormat)}, ${start.format(
      timeFormat,
    )}`;

    if (start.format("YYYY-MM-DD") === end.format("YYYY-MM-DD")) {
      return `${startText} – ${end.format(timeFormat)}`;
    }

    const sameYear: boolean = start.year() === end.year();
    const endDateFormat: string = sameYear ? dateFormat : "ddd, MMM D, YYYY";

    return `${startText} → ${end.format(endDateFormat)}, ${end.format(
      timeFormat,
    )}`;
  }

  // "7d", "3d 12h", "8h", "8h 30m", "45m", "<1m".
  public static formatDuration(milliseconds: number): string {
    if (
      !Number.isFinite(milliseconds) ||
      milliseconds < MILLISECONDS_PER_MINUTE
    ) {
      return "<1m";
    }

    const totalMinutes: number = Math.round(
      milliseconds / MILLISECONDS_PER_MINUTE,
    );
    const days: number = Math.floor(totalMinutes / (24 * 60));
    const hours: number = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes: number = totalMinutes % 60;

    if (days > 0) {
      return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }

    if (hours > 0) {
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    return `${minutes}m`;
  }

  /*
   * Hours on call inside the window, summed over the intervals (each cut to
   * the window). Overlaps are NOT merged: two schedules at once are two
   * rosters, and the legend reports load, not wall-clock presence.
   */
  public static sumWithin(
    intervals: Array<TimeInterval>,
    window: TimeInterval,
  ): number {
    let total: number = 0;

    for (const interval of intervals) {
      const start: number = Math.max(
        interval.start.getTime(),
        window.start.getTime(),
      );
      const end: number = Math.min(
        interval.end.getTime(),
        window.end.getTime(),
      );

      if (end > start) {
        total += end - start;
      }
    }

    return total;
  }

  /*
   * Whether the reader may page to the previous / next range: only while
   * part of that range is still inside the window the server can draw.
   */
  public static getNavigability(data: {
    mode: TimelineViewMode;
    anchor: Date;
    timezone: string;
    addressable: TimeInterval;
  }): { canGoBack: boolean; canGoForward: boolean } {
    const previous: TimelineRange = ScheduleTimelineLayout.getRange({
      mode: data.mode,
      timezone: data.timezone,
      anchor: ScheduleTimelineLayout.shiftAnchor({ ...data, direction: -1 }),
    });

    const next: TimelineRange = ScheduleTimelineLayout.getRange({
      mode: data.mode,
      timezone: data.timezone,
      anchor: ScheduleTimelineLayout.shiftAnchor({ ...data, direction: 1 }),
    });

    return {
      canGoBack: previous.end.getTime() > data.addressable.start.getTime(),
      canGoForward: next.start.getTime() < data.addressable.end.getTime(),
    };
  }

  /*
   * `#rrggbb` (or `#rgb`) at `alpha`, as an rgba() string. Anything that is
   * not a hex colour is returned untouched so a bad value degrades to a solid
   * colour rather than to no colour at all.
   */
  public static withAlpha(color: string, alpha: number): string {
    const rgb: [number, number, number] | null =
      ScheduleTimelineLayout.parseHex(color);

    if (!rgb) {
      return color;
    }

    const clamped: number = Math.min(1, Math.max(0, alpha));

    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamped})`;
  }

  /*
   * Near-black or white, whichever reads on `color`. The per-user palette
   * runs from black to yellow and lime, so a fixed text colour is unreadable
   * on some avatars.
   */
  public static getContrastTextColor(color: string): string {
    const rgb: [number, number, number] | null =
      ScheduleTimelineLayout.parseHex(color);

    if (!rgb) {
      return "#ffffff";
    }

    const luminance: number =
      (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;

    return luminance > 0.62 ? "#111827" : "#ffffff";
  }

  private static parseHex(color: string): [number, number, number] | null {
    const hex: string = color.trim().replace(/^#/, "");

    const full: string =
      hex.length === 3
        ? hex
            .split("")
            .map((char: string) => {
              return char + char;
            })
            .join("")
        : hex;

    if (!HEX_COLOR_PATTERN.test(full)) {
      return null;
    }

    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
}
