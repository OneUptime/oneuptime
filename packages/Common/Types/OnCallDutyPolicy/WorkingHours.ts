import OneUptimeDate from "../Date";
import DayOfWeek from "../Day/DayOfWeek";
import { JSONObject } from "../JSON";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "./RestrictionTimes";
import moment from "moment-timezone";

/*
 * WORKING HOURS: WHEN AN ON-CALL RULE THAT WAITS FOR THEM MAY PAGE.
 *
 * An on-call rule can hold its page until working hours (OnCallRuleWhenToPage):
 * a P3 raised at 2am pages somebody at 9am instead of waking them. The hours
 * are a schedule layer's restriction times (RestrictionTimes) - one window
 * every day, or windows from one day and time of the week to another - read
 * on the clock of the rule's time zone, the way a schedule layer reads its
 * own: each time's hour and minute, and a weekly window's weekday, as that
 * zone sees them.
 *
 * Two questions are answered here, for any moment: is it inside the hours,
 * and when do they next begin. Both are asked of the zone's clock, never by
 * adding minutes, so a window that opens at 09:00 opens at 09:00 on the
 * morning after the clocks change too. On the morning the clocks spring
 * forward, a window that opens inside the hour that is skipped opens when the
 * clock reaches it again (02:30 opens at 03:30). On the night they fall back,
 * a time that comes twice is the first of the two.
 *
 * Hours that never open - none set, a window that ends when it starts, a
 * time zone nobody knows - hold nothing: getNextStart says so with null, and
 * whoever asked pages straight away. A page held for hours that never come
 * is a page lost.
 */

export const MINUTES_IN_A_DAY: number = 24 * 60;
export const MINUTES_IN_A_WEEK: number = 7 * MINUTES_IN_A_DAY;

// The working week a rule's hours start as: Monday to Friday, 09:00 to 17:00.
export const WORKING_WEEKDAYS: Array<DayOfWeek> = [
  DayOfWeek.Monday,
  DayOfWeek.Tuesday,
  DayOfWeek.Wednesday,
  DayOfWeek.Thursday,
  DayOfWeek.Friday,
];
export const DEFAULT_WORKDAY_START_HOUR: number = 9;
export const DEFAULT_WORKDAY_END_HOUR: number = 17;

// One window of the hours, on the zone's clock.
export interface WorkingHoursWindow {
  // The minute of the week it opens: Monday 00:00 is 0, Sunday 23:59 is 10079.
  startMinuteOfWeek: number;
  // How long it stays open, in minutes: at least one, at most a week.
  lengthInMinutes: number;
}

export interface WorkingHoursInput {
  hours: RestrictionTimes | JSONObject | null | undefined;
  // An IANA time zone: "Europe/London".
  timezone: string | null | undefined;
}

/*
 * Working hours as most people set them: the same hours on the days picked -
 * Monday to Friday, 09:00 to 17:00. What the rule form's picker edits
 * (toSimpleHours, fromSimpleHours).
 */
export interface SimpleWorkingHours {
  // The days they are on: Monday is 0, Sunday 6. In week order, once each.
  days: Array<number>;
  /*
   * When they begin and end on the zone's clock, "HH:mm". An end before the
   * start is the next morning: 22:00 to 06:00.
   */
  from: string;
  to: string;
}

/*
 * Hours that are alike on several days, to say them in a few words:
 * "Mon–Fri 09:00–17:00" (getSpans).
 */
export interface WorkingHoursSpan {
  // The days they begin on: Monday is 0. In week order.
  days: Array<number>;
  // When they begin and end on the zone's clock, "HH:mm".
  from: string;
  to: string;
  /*
   * How many days after they begin they end: 0 the same day, 1 the next
   * morning (22:00 to 06:00), more for hours that run over several days
   * (Friday 17:00 to Monday 09:00).
   */
  endsDaysLater: number;
}

const WEEK: Array<DayOfWeek> = [
  DayOfWeek.Monday,
  DayOfWeek.Tuesday,
  DayOfWeek.Wednesday,
  DayOfWeek.Thursday,
  DayOfWeek.Friday,
  DayOfWeek.Saturday,
  DayOfWeek.Sunday,
];

const CLOCK: RegExp = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// "09:00" from minutes after midnight.
const toClock: (minuteOfDay: number) => string = (
  minuteOfDay: number,
): string => {
  const hour: number = Math.floor(minuteOfDay / 60);
  const minute: number = minuteOfDay % 60;

  return `${hour < 10 ? "0" : ""}${hour}:${minute < 10 ? "0" : ""}${minute}`;
};

export const WORKING_HOURS_NOT_SET_MESSAGE: string =
  "Set the working hours to page in.";
export const WORKING_HOURS_TIMEZONE_NOT_SET_MESSAGE: string =
  "Choose the time zone the working hours are in.";
export const WORKING_HOURS_DAILY_WINDOW_EMPTY_MESSAGE: string =
  "Working hours must end at a different time than they start.";
export const WORKING_HOURS_NO_WEEKLY_WINDOWS_MESSAGE: string =
  "Add at least one window of working hours.";
export const WORKING_HOURS_WEEKLY_WINDOW_EMPTY_MESSAGE: string =
  "Each window of working hours must end at a different time than it starts.";

export default class WorkingHours {
  // Whether the time zone is one OneUptime knows: "Europe/London".
  public static isKnownTimezone(timezone: string | null | undefined): boolean {
    if (!timezone || typeof timezone !== "string") {
      return false;
    }

    return Boolean(moment.tz.zone(timezone.trim()));
  }

  /*
   * The hours as restriction times, in whatever form they arrive: as a
   * column reads them, as JSON from an API call or a form. Null when there
   * is nothing to read.
   */
  public static toRestrictionTimes(
    hours: RestrictionTimes | JSONObject | null | undefined,
  ): RestrictionTimes | null {
    if (!hours) {
      return null;
    }

    if (hours instanceof RestrictionTimes) {
      return hours;
    }

    try {
      return RestrictionTimes.fromJSON(hours);
    } catch {
      return null;
    }
  }

  /*
   * Why these hours cannot hold a page - in words for the person setting
   * them - or null when they can.
   */
  public static getProblem(input: WorkingHoursInput): string | null {
    const hours: RestrictionTimes | null = this.toRestrictionTimes(input.hours);

    if (!hours || hours.restictionType === RestrictionType.None) {
      return WORKING_HOURS_NOT_SET_MESSAGE;
    }

    if (!this.isKnownTimezone(input.timezone)) {
      return WORKING_HOURS_TIMEZONE_NOT_SET_MESSAGE;
    }

    const timezone: string = input.timezone!.trim();

    if (hours.restictionType === RestrictionType.Daily) {
      if (!hours.dayRestrictionTimes) {
        return WORKING_HOURS_NOT_SET_MESSAGE;
      }

      const start: number | null = this.getMinuteOfDay(
        hours.dayRestrictionTimes.startTime,
        timezone,
      );
      const end: number | null = this.getMinuteOfDay(
        hours.dayRestrictionTimes.endTime,
        timezone,
      );

      if (start === null || end === null) {
        return WORKING_HOURS_NOT_SET_MESSAGE;
      }

      if (start === end) {
        return WORKING_HOURS_DAILY_WINDOW_EMPTY_MESSAGE;
      }

      return null;
    }

    if (hours.restictionType === RestrictionType.Weekly) {
      const windows: Array<WeeklyResctriction> =
        hours.weeklyRestrictionTimes || [];

      if (windows.length === 0) {
        return WORKING_HOURS_NO_WEEKLY_WINDOWS_MESSAGE;
      }

      for (const window of windows) {
        if (!this.getWeeklyWindow(window, timezone)) {
          return WORKING_HOURS_WEEKLY_WINDOW_EMPTY_MESSAGE;
        }
      }

      return null;
    }

    return WORKING_HOURS_NOT_SET_MESSAGE;
  }

  /*
   * The windows of the hours on the zone's clock, Monday first. Empty when
   * the hours never open. A daily window is one window on each day of the
   * week; a window that runs past midnight - 22:00 to 06:00 - is one window
   * that ends the next morning.
   */
  public static getWindows(
    input: WorkingHoursInput,
  ): Array<WorkingHoursWindow> {
    const hours: RestrictionTimes | null = this.toRestrictionTimes(input.hours);

    if (!hours || !this.isKnownTimezone(input.timezone)) {
      return [];
    }

    const timezone: string = input.timezone!.trim();
    const windows: Array<WorkingHoursWindow> = [];

    if (
      hours.restictionType === RestrictionType.Daily &&
      hours.dayRestrictionTimes
    ) {
      const start: number | null = this.getMinuteOfDay(
        hours.dayRestrictionTimes.startTime,
        timezone,
      );
      const end: number | null = this.getMinuteOfDay(
        hours.dayRestrictionTimes.endTime,
        timezone,
      );

      if (start === null || end === null || start === end) {
        return [];
      }

      const lengthInMinutes: number =
        (end - start + MINUTES_IN_A_DAY) % MINUTES_IN_A_DAY;

      for (let day: number = 0; day < 7; day++) {
        windows.push({
          startMinuteOfWeek: day * MINUTES_IN_A_DAY + start,
          lengthInMinutes: lengthInMinutes,
        });
      }
    }

    if (hours.restictionType === RestrictionType.Weekly) {
      for (const weeklyWindow of hours.weeklyRestrictionTimes || []) {
        const window: WorkingHoursWindow | null = this.getWeeklyWindow(
          weeklyWindow,
          timezone,
        );

        if (window) {
          windows.push(window);
        }
      }
    }

    return windows.sort((a: WorkingHoursWindow, b: WorkingHoursWindow) => {
      return a.startMinuteOfWeek - b.startMinuteOfWeek;
    });
  }

  // Whether the moment is inside the hours, on the zone's clock.
  public static isWithin(input: WorkingHoursInput & { at: Date }): boolean {
    const windows: Array<WorkingHoursWindow> = this.getWindows(input);

    if (windows.length === 0) {
      return false;
    }

    return this.isWithinWindows({
      windows: windows,
      timezone: input.timezone!.trim(),
      at: input.at,
    });
  }

  /*
   * The first moment, from `at` on, that is inside the hours: `at` itself
   * when it is inside already. Null when the hours never open.
   */
  public static getNextStart(
    input: WorkingHoursInput & { at: Date },
  ): Date | null {
    const windows: Array<WorkingHoursWindow> = this.getWindows(input);

    if (windows.length === 0) {
      return null;
    }

    const timezone: string = input.timezone!.trim();
    const at: Date = OneUptimeDate.fromString(input.at);

    if (isNaN(at.getTime())) {
      return null;
    }

    if (
      this.isWithinWindows({
        windows: windows,
        timezone: timezone,
        at: at,
      })
    ) {
      return at;
    }

    const startOfToday: moment.Moment = moment.tz(at, timezone).startOf("day");
    let next: Date | null = null;

    for (const window of windows) {
      const weekday: number = Math.floor(
        window.startMinuteOfWeek / MINUTES_IN_A_DAY,
      );
      const minuteOfDay: number = window.startMinuteOfWeek % MINUTES_IN_A_DAY;

      /*
       * Today, or one of the seven days after it: a window opens once a
       * week, so its next opening is on one of them. A window that opened
       * earlier today and is over opens again a week from today.
       */
      for (let daysAhead: number = 0; daysAhead <= 7; daysAhead++) {
        const day: moment.Moment = startOfToday.clone().add(daysAhead, "days");

        if (this.getWeekdayIndex(day) !== weekday) {
          continue;
        }

        const opening: Date = moment
          .tz(
            {
              year: day.year(),
              month: day.month(),
              date: day.date(),
              hour: Math.floor(minuteOfDay / 60),
              minute: minuteOfDay % 60,
              second: 0,
              millisecond: 0,
            },
            timezone,
          )
          .toDate();

        if (opening.getTime() <= at.getTime()) {
          continue;
        }

        if (!next || opening.getTime() < next.getTime()) {
          next = opening;
        }

        break;
      }
    }

    return next;
  }

  /*
   * The hours a rule starts with when somebody picks "Only during working
   * hours": Monday to Friday, 09:00 to 17:00, on the zone's clock - one
   * weekly window a day, so the evenings and the weekend wait. A zone
   * OneUptime does not know is read as UTC.
   */
  public static getDefaultHours(data: {
    timezone: string | null | undefined;
    now?: Date | undefined;
  }): RestrictionTimes {
    const timezone: string = this.isKnownTimezone(data.timezone)
      ? data.timezone!.trim()
      : "UTC";
    const monday: moment.Moment = moment
      .tz(data.now || OneUptimeDate.getCurrentDate(), timezone)
      .startOf("isoWeek");

    const atTime: (day: moment.Moment, hour: number) => Date = (
      day: moment.Moment,
      hour: number,
    ): Date => {
      return moment
        .tz(
          {
            year: day.year(),
            month: day.month(),
            date: day.date(),
            hour: hour,
            minute: 0,
            second: 0,
            millisecond: 0,
          },
          timezone,
        )
        .toDate();
    };

    const hours: RestrictionTimes = new RestrictionTimes();
    hours.restictionType = RestrictionType.Weekly;
    hours.dayRestrictionTimes = null;
    hours.weeklyRestrictionTimes = WORKING_WEEKDAYS.map(
      (weekday: DayOfWeek, index: number): WeeklyResctriction => {
        const day: moment.Moment = monday.clone().add(index, "days");

        return {
          startDay: weekday,
          endDay: weekday,
          startTime: atTime(day, DEFAULT_WORKDAY_START_HOUR),
          endTime: atTime(day, DEFAULT_WORKDAY_END_HOUR),
        };
      },
    );

    return hours;
  }

  /*
   * Minutes after midnight from "HH:mm" (or "H:mm"); null for anything else.
   */
  public static parseClock(clock: string | null | undefined): number | null {
    const match: RegExpMatchArray | null = (clock || "").trim().match(CLOCK);

    if (!match) {
      return null;
    }

    return parseInt(match[1]!, 10) * 60 + parseInt(match[2]!, 10);
  }

  /*
   * The hours, said in as few groups as they allow, on the zone's clock:
   * days alike - opening and closing at the same times - are one group, in
   * the order the week first opens them. Monday to Friday, 09:00 to 17:00 is
   * one group of five days; Monday to Thursday until 18:00 and Friday until
   * 15:00 are two. Empty when the hours never open.
   */
  public static getSpans(input: WorkingHoursInput): Array<WorkingHoursSpan> {
    const spans: Array<WorkingHoursSpan> = [];

    for (const window of this.getWindows(input)) {
      const day: number = Math.floor(
        window.startMinuteOfWeek / MINUTES_IN_A_DAY,
      );
      const startMinute: number = window.startMinuteOfWeek % MINUTES_IN_A_DAY;
      const endMinute: number = startMinute + window.lengthInMinutes;
      const from: string = toClock(startMinute);
      const to: string = toClock(endMinute % MINUTES_IN_A_DAY);
      const endsDaysLater: number = Math.floor(endMinute / MINUTES_IN_A_DAY);

      const alike: WorkingHoursSpan | undefined = spans.find(
        (span: WorkingHoursSpan): boolean => {
          return (
            span.from === from &&
            span.to === to &&
            span.endsDaysLater === endsDaysLater &&
            !span.days.includes(day)
          );
        },
      );

      if (alike) {
        alike.days.push(day);
        continue;
      }

      spans.push({ days: [day], from, to, endsDaysLater });
    }

    return spans;
  }

  /*
   * The hours as the same hours on the days picked, when that is what they
   * are: one group of days (getSpans) that ends the same day, or the next
   * morning when it ends earlier than it begins. Null for anything else -
   * different hours on different days, hours over a weekend - and for hours
   * that never open.
   */
  public static toSimpleHours(
    input: WorkingHoursInput,
  ): SimpleWorkingHours | null {
    const spans: Array<WorkingHoursSpan> = this.getSpans(input);

    if (spans.length !== 1) {
      return null;
    }

    const span: WorkingHoursSpan = spans[0]!;
    const from: number = this.parseClock(span.from)!;
    const to: number = this.parseClock(span.to)!;

    if (from === to || span.endsDaysLater !== (to < from ? 1 : 0)) {
      return null;
    }

    return { days: [...span.days], from: span.from, to: span.to };
  }

  /*
   * The same hours on the days picked, as the rule keeps them: one weekly
   * window a day, on the zone's clock, ending the next morning when it ends
   * earlier than it begins. Hours that end when they begin are kept as
   * windows that never open, for getProblem to refuse; no day, as none. A
   * zone OneUptime does not know is read as UTC.
   *
   * Only each time's day of the week and time of day count, so they are kept
   * in one week the clocks change in nowhere - the week of Monday 12 January
   * 2026 - rather than this week: 01:30 on the Sunday the clocks spring
   * forward does not exist, and would be kept as 02:30.
   */
  public static fromSimpleHours(
    data: SimpleWorkingHours & {
      timezone: string | null | undefined;
    },
  ): RestrictionTimes {
    const timezone: string = this.isKnownTimezone(data.timezone)
      ? data.timezone!.trim()
      : "UTC";
    const monday: moment.Moment = moment.tz(
      { year: 2026, month: 0, date: 12 },
      timezone,
    );
    const from: number =
      this.parseClock(data.from) ?? DEFAULT_WORKDAY_START_HOUR * 60;
    const to: number =
      this.parseClock(data.to) ?? DEFAULT_WORKDAY_END_HOUR * 60;
    const endsNextDay: boolean = to < from;

    const atClock: (dayOfWeek: number, minuteOfDay: number) => Date = (
      dayOfWeek: number,
      minuteOfDay: number,
    ): Date => {
      const day: moment.Moment = monday.clone().add(dayOfWeek, "days");

      return moment
        .tz(
          {
            year: day.year(),
            month: day.month(),
            date: day.date(),
            hour: Math.floor(minuteOfDay / 60),
            minute: minuteOfDay % 60,
            second: 0,
            millisecond: 0,
          },
          timezone,
        )
        .toDate();
    };

    const days: Array<number> = Array.from(new Set(data.days || []))
      .filter((day: number): boolean => {
        return Number.isInteger(day) && day >= 0 && day <= 6;
      })
      .sort((a: number, b: number): number => {
        return a - b;
      });

    const hours: RestrictionTimes = new RestrictionTimes();
    hours.restictionType = RestrictionType.Weekly;
    hours.dayRestrictionTimes = null;
    hours.weeklyRestrictionTimes = days.map(
      (day: number): WeeklyResctriction => {
        const endDay: number = day + (endsNextDay ? 1 : 0);

        return {
          startDay: WEEK[day]!,
          endDay: WEEK[endDay % 7]!,
          startTime: atClock(day, from),
          endTime: atClock(endDay, to),
        };
      },
    );

    return hours;
  }

  /*
   * A stored time on the zone's clock: its day of the week (Monday is 0) and
   * its time of day, "HH:mm". Null when it is no time, or the zone is one
   * OneUptime does not know.
   */
  public static readClock(
    time: Date | string | JSONObject | null | undefined,
    timezone: string | null | undefined,
  ): { day: number; clock: string } | null {
    if (!this.isKnownTimezone(timezone)) {
      return null;
    }

    const zoned: moment.Moment | null = this.toZoned(time, timezone!.trim());

    if (!zoned) {
      return null;
    }

    return {
      day: this.getWeekdayIndex(zoned),
      clock: toClock(zoned.hour() * 60 + zoned.minute()),
    };
  }

  /*
   * The time paging starts at when the hours begin, if it is always the same
   * one: "09:00" for Monday to Friday, 09:00 to 17:00. Null when the days
   * begin at different times, or the hours never open.
   */
  public static getStartTime(input: WorkingHoursInput): string | null {
    const starts: Set<string> = new Set<string>(
      this.getSpans(input).map((span: WorkingHoursSpan): string => {
        return span.from;
      }),
    );

    return starts.size === 1 ? Array.from(starts)[0]! : null;
  }

  /*
   * The same hours on another zone's clock: every time keeps its day and its
   * time of day, so "Monday to Friday, 09:00 to 17:00" in one zone is
   * "Monday to Friday, 09:00 to 17:00" in the other. For a rule whose time
   * zone changes after its hours were set: the stored times are moments, and
   * read on the new zone's clock they would say other hours.
   */
  public static moveToTimezone(data: {
    hours: RestrictionTimes | JSONObject | null | undefined;
    fromTimezone: string | null | undefined;
    toTimezone: string | null | undefined;
  }): RestrictionTimes | null {
    const hours: RestrictionTimes | null = this.toRestrictionTimes(data.hours);

    if (
      !hours ||
      !this.isKnownTimezone(data.fromTimezone) ||
      !this.isKnownTimezone(data.toTimezone)
    ) {
      return hours;
    }

    const fromTimezone: string = data.fromTimezone!.trim();
    const toTimezone: string = data.toTimezone!.trim();

    const move: (time: Date | string | JSONObject) => Date = (
      time: Date | string | JSONObject,
    ): Date => {
      const zoned: moment.Moment | null = this.toZoned(time, fromTimezone);

      if (!zoned) {
        return OneUptimeDate.fromString(time);
      }

      return moment
        .tz(
          {
            year: zoned.year(),
            month: zoned.month(),
            date: zoned.date(),
            hour: zoned.hour(),
            minute: zoned.minute(),
            second: zoned.second(),
            millisecond: 0,
          },
          toTimezone,
        )
        .toDate();
    };

    const moved: RestrictionTimes = new RestrictionTimes();
    moved.restictionType = hours.restictionType;
    moved.dayRestrictionTimes = hours.dayRestrictionTimes
      ? {
          startTime: move(hours.dayRestrictionTimes.startTime),
          endTime: move(hours.dayRestrictionTimes.endTime),
        }
      : null;
    moved.weeklyRestrictionTimes = (hours.weeklyRestrictionTimes || []).map(
      (window: WeeklyResctriction): WeeklyResctriction => {
        return {
          ...window,
          startTime: move(window.startTime),
          endTime: move(window.endTime),
        };
      },
    );

    return moved;
  }

  /*
   * When paging starts, for the run's words: "Wed 09:00 (Europe/London)" -
   * the day of the week and the time on the zone's clock. Working hours
   * begin within a week, so the day of the week says which day; a moment a
   * week or more away names its date as well ("Wed, Oct 28 09:00"), and its
   * year when that is not this one. A 24-hour clock: whoever reads it may be
   * anywhere, and "09:00" reads the same everywhere.
   */
  public static describeMoment(data: {
    at: Date;
    timezone: string | null | undefined;
    now: Date;
  }): string {
    const timezone: string = this.isKnownTimezone(data.timezone)
      ? data.timezone!.trim()
      : "UTC";
    const at: moment.Moment = moment.tz(data.at, timezone).locale("en");
    const now: moment.Moment = moment.tz(data.now, timezone).locale("en");
    const time: string = at.format("HH:mm");
    const daysAhead: number = at
      .clone()
      .startOf("day")
      .diff(now.clone().startOf("day"), "days");

    if (daysAhead >= 0 && daysAhead < 7) {
      return `${at.format("ddd")} ${time} (${timezone})`;
    }

    const day: string =
      at.year() === now.year()
        ? at.format("ddd, MMM D")
        : at.format("ddd, MMM D, YYYY");

    return `${day} ${time} (${timezone})`;
  }

  private static isWithinWindows(data: {
    windows: Array<WorkingHoursWindow>;
    timezone: string;
    at: Date;
  }): boolean {
    const at: moment.Moment = moment.tz(data.at, data.timezone);

    if (!at.isValid()) {
      return false;
    }

    const minuteOfWeek: number =
      this.getWeekdayIndex(at) * MINUTES_IN_A_DAY +
      at.hour() * 60 +
      at.minute() +
      at.second() / 60 +
      at.millisecond() / 60_000;

    return data.windows.some((window: WorkingHoursWindow): boolean => {
      const intoWindow: number =
        (minuteOfWeek - window.startMinuteOfWeek + MINUTES_IN_A_WEEK) %
        MINUTES_IN_A_WEEK;

      return intoWindow < window.lengthInMinutes;
    });
  }

  /*
   * One weekly window on the zone's clock, from its start time to its end
   * time - each read with its own weekday, the way a schedule layer reads
   * them. A window that ends earlier in the week than it starts - Friday
   * 20:00 to Monday 08:00 - runs over the weekend. Null for one that ends
   * when it starts.
   */
  private static getWeeklyWindow(
    window: WeeklyResctriction,
    timezone: string,
  ): WorkingHoursWindow | null {
    if (!window) {
      return null;
    }

    const start: number | null = this.getMinuteOfWeek(
      window.startTime,
      timezone,
    );
    const end: number | null = this.getMinuteOfWeek(window.endTime, timezone);

    if (start === null || end === null) {
      return null;
    }

    const lengthInMinutes: number =
      (end - start + MINUTES_IN_A_WEEK) % MINUTES_IN_A_WEEK;

    if (lengthInMinutes === 0) {
      return null;
    }

    return {
      startMinuteOfWeek: start,
      lengthInMinutes: lengthInMinutes,
    };
  }

  // The time of day of a stored time, in minutes, on the zone's clock.
  private static getMinuteOfDay(
    time: Date | string | JSONObject | null | undefined,
    timezone: string,
  ): number | null {
    const zoned: moment.Moment | null = this.toZoned(time, timezone);

    if (!zoned) {
      return null;
    }

    return zoned.hour() * 60 + zoned.minute();
  }

  // The weekday and time of day of a stored time, in minutes from Monday 00:00.
  private static getMinuteOfWeek(
    time: Date | string | JSONObject | null | undefined,
    timezone: string,
  ): number | null {
    const zoned: moment.Moment | null = this.toZoned(time, timezone);

    if (!zoned) {
      return null;
    }

    return (
      this.getWeekdayIndex(zoned) * MINUTES_IN_A_DAY +
      zoned.hour() * 60 +
      zoned.minute()
    );
  }

  private static toZoned(
    time: Date | string | JSONObject | null | undefined,
    timezone: string,
  ): moment.Moment | null {
    if (!time) {
      return null;
    }

    let date: Date;

    try {
      date = OneUptimeDate.fromString(time as Date | string | JSONObject);
    } catch {
      return null;
    }

    if (!(date instanceof Date) || isNaN(date.getTime())) {
      return null;
    }

    return moment.tz(date, timezone);
  }

  // Monday is 0, Sunday is 6.
  private static getWeekdayIndex(date: moment.Moment): number {
    return date.isoWeekday() - 1;
  }
}
