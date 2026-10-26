import { Moment } from "Common/Types/Date";
import {
  FeedClock,
  formatFeedTime,
  getFeedDayKey,
  getFeedLocale,
  getFeedZoneName,
} from "Common/UI/Components/Feed/FeedTime";

/*
 * HOW THE UPCOMING SHIFTS CARD WRITES TIMES.
 *
 * In the reader's zone (User Settings, else the browser's), language and
 * hour cycle - the clock the feeds read (FeedTime) - with the words from the
 * browser's Intl data, the Gregorian calendar and the language's own
 * digits. The card
 * used to write the start with moment in the BROWSER's zone and the end in
 * the profile's, in English, with the year and the zone on every row:
 * "17:20 – Oct 15 2026, 17:20 BST".
 *
 * Now a row says what a person needs and nothing twice: the day on a date
 * tile ("Oct" over "14"), the day in words beside it ("Today", "Tomorrow",
 * "Thursday"), the start time, and the end - its time alone on the day the
 * span starts, its day as well on any later one - and how long it lasts in
 * the reader's own words ("30 days", "1 Tag, 6 Stunden"). The zone is named
 * once, for the card. Wall-clock times are what a person keeps, so a span
 * that crosses the end of summer time still reads 17:20 to 17:20, and lasts
 * "1 day".
 *
 * React-free so every rule can be tested on its own.
 */

type ZonedMoment = ReturnType<typeof Moment>;

const formatCache: Map<string, Intl.DateTimeFormat | null> = new Map<
  string,
  Intl.DateTimeFormat | null
>();

/*
 * One formatter per locale, zone, hour cycle and shape, built once: the
 * card formats several times per row. Null where Intl cannot work in the
 * zone (moment knows a few zones some Intl builds do not), and the caller
 * falls back to moment's English.
 */
const getFormat: (data: {
  clock: FeedClock;
  shape: string;
  options: Intl.DateTimeFormatOptions;
}) => Intl.DateTimeFormat | null = (data: {
  clock: FeedClock;
  shape: string;
  options: Intl.DateTimeFormatOptions;
}): Intl.DateTimeFormat | null => {
  const locale: string = getFeedLocale(data.clock.language);
  const key: string = `${locale}|${data.clock.timezone}|${data.shape}|${
    data.clock.use12HourClock ? 12 : 24
  }`;

  if (formatCache.has(key)) {
    return formatCache.get(key) || null;
  }

  let format: Intl.DateTimeFormat | null = null;

  try {
    format = new Intl.DateTimeFormat(locale, {
      ...data.options,
      timeZone: data.clock.timezone,
    });
  } catch {
    format = null;
  }

  formatCache.set(key, format);
  return format;
};

const inZone: (date: Date, timezone: string) => ZonedMoment = (
  date: Date,
  timezone: string,
): ZonedMoment => {
  return Moment(date).tz(timezone);
};

const capitalizeFirst: (text: string, locale: string) => string = (
  text: string,
  locale: string,
): string => {
  if (!text) {
    return text;
  }

  try {
    return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
  } catch {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
};

export interface ShiftDateTile {
  // "Oct", "Okt", "10月".
  month: string;
  // "14": the number alone, in every language.
  day: string;
}

/*
 * The date tile on a row: the month and the day of the month the span
 * starts on, in the reader's zone.
 */
export const getShiftDateTile: (
  date: Date,
  clock: FeedClock,
) => ShiftDateTile = (date: Date, clock: FeedClock): ShiftDateTile => {
  const monthFormat: Intl.DateTimeFormat | null = getFormat({
    clock: clock,
    shape: "tile-month",
    options: { month: "short" },
  });
  const dayFormat: Intl.DateTimeFormat | null = getFormat({
    clock: clock,
    shape: "tile-day",
    options: { day: "numeric" },
  });

  const zoned: ZonedMoment = inZone(date, clock.timezone);

  let day: string = zoned.format("D");

  if (dayFormat && typeof dayFormat.formatToParts === "function") {
    const part: Intl.DateTimeFormatPart | undefined = dayFormat
      .formatToParts(date)
      .find((item: Intl.DateTimeFormatPart): boolean => {
        return item.type === "day";
      });

    if (part && part.value) {
      day = part.value;
    }
  }

  return {
    month: monthFormat ? monthFormat.format(date) : zoned.format("MMM"),
    day: day,
  };
};

/*
 * The parts of Intl.RelativeTimeFormat used here, typed structurally:
 * Common compiles against the ES2017 library, which does not declare it.
 */
interface RelativeDayFormatter {
  format: (value: number, unit: "day") => string;
}

type RelativeDayFormatConstructor = new (
  locale: string,
  options: { numeric: "auto" },
) => RelativeDayFormatter;

const relativeFormatCache: Map<string, RelativeDayFormatter | null> = new Map<
  string,
  RelativeDayFormatter | null
>();

const getRelativeDayFormatter: (
  locale: string,
) => RelativeDayFormatter | null = (
  locale: string,
): RelativeDayFormatter | null => {
  if (relativeFormatCache.has(locale)) {
    return relativeFormatCache.get(locale) || null;
  }

  let formatter: RelativeDayFormatter | null = null;

  try {
    const RelativeTimeFormat: RelativeDayFormatConstructor | undefined = (
      Intl as unknown as {
        RelativeTimeFormat?: RelativeDayFormatConstructor | undefined;
      }
    ).RelativeTimeFormat;

    if (RelativeTimeFormat) {
      formatter = new RelativeTimeFormat(locale, { numeric: "auto" });
    }
  } catch {
    formatter = null;
  }

  relativeFormatCache.set(locale, formatter);
  return formatter;
};

/*
 * The day a span starts on, in words: "Today", "Tomorrow", else its weekday
 * ("Thursday") - a shift list is read against a week, and the tile beside
 * it has the date. Counted in calendar days of the reader's zone.
 */
export const getShiftDayLabel: (date: Date, clock: FeedClock) => string = (
  date: Date,
  clock: FeedClock,
): string => {
  const locale: string = getFeedLocale(clock.language);
  const dayKey: string = getFeedDayKey(date, clock.timezone);
  const todayKey: string = getFeedDayKey(clock.now, clock.timezone);
  const tomorrowKey: string = inZone(clock.now, clock.timezone)
    .clone()
    .add(1, "day")
    .format("YYYY-MM-DD");

  const offset: number | null =
    dayKey === todayKey ? 0 : dayKey === tomorrowKey ? 1 : null;

  if (offset !== null) {
    const formatter: RelativeDayFormatter | null =
      getRelativeDayFormatter(locale);

    if (formatter) {
      return capitalizeFirst(formatter.format(offset, "day"), locale);
    }

    return offset === 0 ? "Today" : "Tomorrow";
  }

  const weekday: Intl.DateTimeFormat | null = getFormat({
    clock: clock,
    shape: "weekday",
    options: { weekday: "long" },
  });

  return weekday
    ? capitalizeFirst(weekday.format(date), locale)
    : inZone(date, clock.timezone).format("dddd");
};

// "17:20", "5:20 PM": the time of day, as the feeds write it.
export const formatShiftTime: (date: Date, clock: FeedClock) => string = (
  date: Date,
  clock: FeedClock,
): string => {
  return formatFeedTime(date, clock);
};

// "Fri, Nov 13, 17:20": a time on a day the row does not already name.
export const formatShiftDateTime: (date: Date, clock: FeedClock) => string = (
  date: Date,
  clock: FeedClock,
): string => {
  const format: Intl.DateTimeFormat | null = getFormat({
    clock: clock,
    shape: "date-time",
    options: {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: clock.use12HourClock,
    },
  });

  return format
    ? format.format(date)
    : inZone(date, clock.timezone).format(
        clock.use12HourClock ? "ddd, MMM D, h:mm A" : "ddd, MMM D, HH:mm",
      );
};

// Whether two instants fall on one calendar day of the reader's zone.
export const isSameShiftDay: (a: Date, b: Date, clock: FeedClock) => boolean = (
  a: Date,
  b: Date,
  clock: FeedClock,
): boolean => {
  return getFeedDayKey(a, clock.timezone) === getFeedDayKey(b, clock.timezone);
};

/*
 * Where a span ends, as its row writes it after the start: the time alone
 * on the day the span starts ("17:00"), the day as well on a later one
 * ("Fri, Nov 13, 17:20").
 */
export const formatShiftEnd: (data: {
  start: Date;
  end: Date;
  clock: FeedClock;
}) => string = (data: { start: Date; end: Date; clock: FeedClock }): string => {
  if (isSameShiftDay(data.start, data.end, data.clock)) {
    return formatShiftTime(data.end, data.clock);
  }

  return formatShiftDateTime(data.end, data.clock);
};

/*
 * Everything about an instant, for the tooltip on a row's times: "Wednesday,
 * October 14, 2026, 17:20 BST". The zone's name is the one in force then,
 * so the two ends of a span across the end of summer time say BST and GMT.
 */
export const formatShiftFullDateTime: (
  date: Date,
  clock: FeedClock,
) => string = (date: Date, clock: FeedClock): string => {
  const format: Intl.DateTimeFormat | null = getFormat({
    clock: clock,
    shape: "full",
    options: {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: clock.use12HourClock,
    },
  });

  const written: string = format
    ? format.format(date)
    : inZone(date, clock.timezone).format(
        clock.use12HourClock
          ? "dddd, MMMM D, YYYY, h:mm A"
          : "dddd, MMMM D, YYYY, HH:mm",
      );

  const zone: string = getFeedZoneName(date, clock.timezone);

  return zone ? `${written} ${zone}` : written;
};

export interface ShiftLength {
  days: number;
  hours: number;
  minutes: number;
}

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

/*
 * How long a span lasts, as a person counts it: whole calendar days of the
 * reader's zone, then the time left over. 17:20 one day to 17:20 the next is
 * "1 day" even across the end of summer time, when the clock gave it an
 * hour more; a night inside a day that changes the clock counts its real
 * hours ("9 hours" from 00:00 to 08:00 the night the clocks go back).
 */
export const getShiftLength: (data: {
  start: Date;
  end: Date;
  timezone: string;
}) => ShiftLength = (data: {
  start: Date;
  end: Date;
  timezone: string;
}): ShiftLength => {
  const startTime: number = data.start.getTime();
  const endTime: number = data.end.getTime();

  if (
    Number.isNaN(startTime) ||
    Number.isNaN(endTime) ||
    endTime <= startTime
  ) {
    return { days: 0, hours: 0, minutes: 0 };
  }

  let from: ZonedMoment;

  try {
    from = inZone(data.start, data.timezone);
  } catch {
    from = Moment(data.start).utc();
  }

  const addDays: (count: number) => number = (count: number): number => {
    return from.clone().add(count, "days").valueOf();
  };

  let days: number = Math.max(0, Math.floor((endTime - startTime) / DAY_MS));

  while (addDays(days + 1) <= endTime) {
    days++;
  }

  while (days > 0 && addDays(days) > endTime) {
    days--;
  }

  const rest: number = endTime - addDays(days);

  let hours: number = Math.floor(rest / HOUR_MS);
  let minutes: number = Math.round((rest - hours * HOUR_MS) / MINUTE_MS);

  if (minutes === 60) {
    hours++;
    minutes = 0;
  }

  return { days: days, hours: hours, minutes: minutes };
};

export interface ShiftLengthOptions {
  /*
   * The time left of a shift under way. Its row says the end to the minute,
   * so from two hours up the time left is said in whole hours: "5 hours
   * left", not "5 hours, 4 minutes left" ticking on every visit.
   */
  isTimeLeft?: boolean | undefined;
}

// From this many hours left, the minutes are left out.
export const TIME_LEFT_WHOLE_HOURS_FROM: number = 2;

/*
 * A length as it is said, at the precision it is read at: minutes under an
 * hour; hours (and any minutes) under a day; days (and any whole hours)
 * under a week; whole days from a week up, where "29 days, 23 hours" would
 * only be noise.
 */
export const roundShiftLength: (
  length: ShiftLength,
  options?: ShiftLengthOptions | undefined,
) => ShiftLength = (
  length: ShiftLength,
  options?: ShiftLengthOptions | undefined,
): ShiftLength => {
  if (length.days >= 7) {
    const roundUp: boolean = length.hours >= 12;

    return { days: length.days + (roundUp ? 1 : 0), hours: 0, minutes: 0 };
  }

  if (length.days > 0) {
    let hours: number = length.hours + (length.minutes >= 30 ? 1 : 0);
    let days: number = length.days;

    if (hours >= 24) {
      days++;
      hours -= 24;
    }

    return { days: days, hours: hours, minutes: 0 };
  }

  if (options?.isTimeLeft && length.hours >= TIME_LEFT_WHOLE_HOURS_FROM) {
    const hours: number = length.hours + (length.minutes >= 30 ? 1 : 0);

    return hours >= 24
      ? { days: 1, hours: hours - 24, minutes: 0 }
      : { days: 0, hours: hours, minutes: 0 };
  }

  if (length.hours > 0) {
    return { days: 0, hours: length.hours, minutes: length.minutes };
  }

  return { days: 0, hours: 0, minutes: Math.max(1, length.minutes) };
};

/*
 * The parts of Intl.NumberFormat's unit style and Intl.ListFormat used here,
 * typed structurally for the same reason as the relative day above. Their
 * words are the language's own, plurals included: "21 день", "2 дня", "5
 * дней" - which a translated "{{count}} days" cannot say in Russian.
 */
interface UnitFormatter {
  format: (value: number) => string;
}

interface ListFormatter {
  format: (items: Array<string>) => string;
}

type ListFormatConstructor = new (
  locale: string,
  options: { type: "unit"; style: "long" },
) => ListFormatter;

type LengthUnit = "day" | "hour" | "minute";

const ENGLISH_UNITS: Record<LengthUnit, [string, string]> = {
  day: ["day", "days"],
  hour: ["hour", "hours"],
  minute: ["minute", "minutes"],
};

const unitFormatCache: Map<string, UnitFormatter | null> = new Map<
  string,
  UnitFormatter | null
>();

const formatUnit: (
  value: number,
  unit: LengthUnit,
  locale: string,
) => string = (value: number, unit: LengthUnit, locale: string): string => {
  const key: string = `${locale}|${unit}`;

  if (!unitFormatCache.has(key)) {
    let formatter: UnitFormatter | null = null;

    try {
      formatter = new Intl.NumberFormat(locale, {
        style: "unit",
        unit: unit,
        unitDisplay: "long",
      } as Intl.NumberFormatOptions);

      // An engine without the unit style ignores it and writes a bare number.
      if (formatter.format(2) === "2") {
        formatter = null;
      }
    } catch {
      formatter = null;
    }

    unitFormatCache.set(key, formatter);
  }

  const formatter: UnitFormatter | null = unitFormatCache.get(key) || null;

  if (formatter) {
    return formatter.format(value);
  }

  const names: [string, string] = ENGLISH_UNITS[unit];

  return `${value} ${value === 1 ? names[0] : names[1]}`;
};

const listFormatCache: Map<string, ListFormatter | null> = new Map<
  string,
  ListFormatter | null
>();

const joinUnits: (items: Array<string>, locale: string) => string = (
  items: Array<string>,
  locale: string,
): string => {
  if (items.length < 2) {
    return items[0] || "";
  }

  if (!listFormatCache.has(locale)) {
    let formatter: ListFormatter | null = null;

    try {
      const ListFormat: ListFormatConstructor | undefined = (
        Intl as unknown as { ListFormat?: ListFormatConstructor | undefined }
      ).ListFormat;

      if (ListFormat) {
        formatter = new ListFormat(locale, { type: "unit", style: "long" });
      }
    } catch {
      formatter = null;
    }

    listFormatCache.set(locale, formatter);
  }

  const formatter: ListFormatter | null = listFormatCache.get(locale) || null;

  return formatter ? formatter.format(items) : items.join(", ");
};

// "30 days", "8 hours", "1 day, 6 hours", "45 minutes" - in the reader's words.
export const formatShiftLength: (
  length: ShiftLength,
  language: string,
  options?: ShiftLengthOptions | undefined,
) => string = (
  length: ShiftLength,
  language: string,
  options?: ShiftLengthOptions | undefined,
): string => {
  const locale: string = getFeedLocale(language);
  const rounded: ShiftLength = roundShiftLength(length, options);
  const parts: Array<string> = [];

  if (rounded.days > 0) {
    parts.push(formatUnit(rounded.days, "day", locale));
  }

  if (rounded.hours > 0) {
    parts.push(formatUnit(rounded.hours, "hour", locale));
  }

  if (rounded.minutes > 0) {
    parts.push(formatUnit(rounded.minutes, "minute", locale));
  }

  return joinUnits(parts, locale);
};
