import moment from "moment-timezone";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";

/*
 * When a feed entry happened, written the way a person reads a timeline.
 *
 * A feed used to say "4 days ago" on every entry, with the real time only in
 * a tooltip. A timeline is read to reconstruct what happened in what order,
 * and "4 days ago" four times over says nothing about that. So every entry
 * now shows its real time of day in the reader's time zone, each day of the
 * feed gets one heading with its full date and the zone the times are in,
 * and the relative "12 min ago" survives only where it helps: within the
 * last hour, under the time.
 *
 * The reader's time zone is the one they picked in User Settings, else the
 * browser's (OneUptimeDate.getCurrentTimezone). Words - month and weekday
 * names, "Today", "12 min ago" - are in the reader's language, from the
 * browser's Intl data rather than moment, whose locale the Dashboard never
 * sets (moment's fromNow said "a minute ago" on Japanese pages). The
 * calendar is always the Gregorian one and the digits always Latin, so a
 * Persian reader's feed lines up with every other date on the page.
 *
 * React-free so every rule can be tested on its own.
 */
export interface FeedClock {
  // The IANA zone the times are read in: "Asia/Singapore".
  timezone: string;
  // The reader's language: "en", "de", "zh-CN".
  language: string;
  // "3:25 PM" (true) or "15:25" (false).
  use12HourClock: boolean;
  // The moment the feed is read at: what "Today" and "12 min ago" count from.
  now: Date;
}

// The relative hint stops after this long: past an hour, the time says it.
export const FEED_RELATIVE_HINT_WINDOW_IN_MINUTES: number = 60;

/*
 * Below this an entry is "now". A clock a few seconds ahead of the server
 * would otherwise label a brand new entry as being in the future.
 */
const JUST_NOW_IN_SECONDS: number = 45;

/*
 * An entry stamped this far ahead of the reader's clock still reads as
 * "now": the server's clock and the browser's are rarely exactly in step.
 * Further ahead than this, no hint is given at all - "in 3 min" on
 * something that already happened would be wrong.
 */
const ALLOWED_CLOCK_SKEW_IN_SECONDS: number = 120;

const FALLBACK_LANGUAGE: string = "en";

/*
 * The parts of Intl.RelativeTimeFormat used here. Typed structurally: Common
 * compiles against the ES2017 library, which does not declare it, while
 * every browser the Dashboard supports has it.
 */
interface RelativeTimeFormatter {
  format: (value: number, unit: "second" | "minute" | "day") => string;
}

type RelativeTimeFormatConstructor = new (
  locale: string,
  options: { numeric: "auto" | "always"; style: "long" | "short" | "narrow" },
) => RelativeTimeFormatter;

const getRelativeTimeFormatConstructor: () =>
  | RelativeTimeFormatConstructor
  | undefined = (): RelativeTimeFormatConstructor | undefined => {
  return (
    Intl as unknown as {
      RelativeTimeFormat?: RelativeTimeFormatConstructor | undefined;
    }
  ).RelativeTimeFormat;
};

const localeCache: Map<string, string> = new Map<string, string>();

/*
 * The Intl locale for a Dashboard language: its own words and order, the
 * Gregorian calendar and Latin digits ("fa" alone would give the Solar Hijri
 * calendar in Persian digits). A language Intl does not know falls back to
 * English rather than to the browser's own default, so a page never mixes
 * two languages.
 */
export const getFeedLocale: (language: string | undefined) => string = (
  language: string | undefined,
): string => {
  const requested: string = (language || FALLBACK_LANGUAGE).trim();
  const cached: string | undefined = localeCache.get(requested);

  if (cached) {
    return cached;
  }

  let locale: string = `${FALLBACK_LANGUAGE}-u-ca-gregory-nu-latn`;

  try {
    const supported: Array<string> = Intl.DateTimeFormat.supportedLocalesOf([
      requested,
    ]);

    if (supported.length > 0 && supported[0]) {
      locale = `${supported[0]}-u-ca-gregory-nu-latn`;
      // Throws on a tag Intl cannot take an extension on.
      new Intl.DateTimeFormat(locale);
    }
  } catch {
    locale = `${FALLBACK_LANGUAGE}-u-ca-gregory-nu-latn`;
  }

  localeCache.set(requested, locale);
  return locale;
};

const formatterCache: Map<string, Intl.DateTimeFormat> = new Map<
  string,
  Intl.DateTimeFormat
>();

/*
 * Formatters are costly to build and a feed formats every entry, so each
 * one is built once per locale, zone and shape. Null when Intl cannot work
 * in this zone - moment knows a few zones some Intl builds do not - and the
 * caller falls back to moment's English.
 */
const getDateTimeFormat: (data: {
  locale: string;
  timezone: string;
  shape: string;
  options: Intl.DateTimeFormatOptions;
}) => Intl.DateTimeFormat | null = (data: {
  locale: string;
  timezone: string;
  shape: string;
  options: Intl.DateTimeFormatOptions;
}): Intl.DateTimeFormat | null => {
  const cacheKey: string = `${data.locale}|${data.timezone}|${data.shape}`;
  const cached: Intl.DateTimeFormat | undefined = formatterCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  try {
    const format: Intl.DateTimeFormat = new Intl.DateTimeFormat(data.locale, {
      ...data.options,
      timeZone: data.timezone,
    });

    formatterCache.set(cacheKey, format);
    return format;
  } catch {
    return null;
  }
};

const inZone: (date: Date, timezone: string) => moment.Moment = (
  date: Date,
  timezone: string,
): moment.Moment => {
  return moment(date).tz(timezone);
};

/*
 * The calendar day an instant falls on in the reader's zone, as
 * "2026-10-13": what entries are grouped under one day heading by. Two
 * entries an hour apart can sit on two different days in one zone and on
 * the same day in another.
 */
export const getFeedDayKey: (date: Date, timezone: string) => string = (
  date: Date,
  timezone: string,
): string => {
  return inZone(date, timezone).format("YYYY-MM-DD");
};

// "Tuesday, October 13, 2026", "Dienstag, 13. Oktober 2026".
export const formatFeedDay: (date: Date, clock: FeedClock) => string = (
  date: Date,
  clock: FeedClock,
): string => {
  const format: Intl.DateTimeFormat | null = getDateTimeFormat({
    locale: getFeedLocale(clock.language),
    timezone: clock.timezone,
    shape: "day",
    options: {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  });

  if (!format) {
    return inZone(date, clock.timezone).format("dddd, MMMM D, YYYY");
  }

  return format.format(date);
};

// "3:25 PM", "15:25", "午後3:25".
export const formatFeedTime: (date: Date, clock: FeedClock) => string = (
  date: Date,
  clock: FeedClock,
): string => {
  const format: Intl.DateTimeFormat | null = getDateTimeFormat({
    locale: getFeedLocale(clock.language),
    timezone: clock.timezone,
    shape: clock.use12HourClock ? "time-12" : "time-24",
    options: {
      hour: "numeric",
      minute: "2-digit",
      hour12: clock.use12HourClock,
    },
  });

  if (!format) {
    return inZone(date, clock.timezone).format(
      clock.use12HourClock ? "h:mm A" : "HH:mm",
    );
  }

  return format.format(date);
};

/*
 * The zone's name at that instant - "EDT" in summer and "EST" in winter, or
 * "GMT+8" where the zone has no abbreviation - as every other date in the
 * product names it (OneUptimeDate.getZoneAbbrByTimezone).
 */
export const getFeedZoneName: (date: Date, timezone: string) => string = (
  date: Date,
  timezone: string,
): string => {
  try {
    return OneUptimeDate.getZoneAbbrByTimezone(timezone as Timezone, date);
  } catch {
    return "";
  }
};

/*
 * Everything about the instant, for the tooltip on an entry's time and its
 * <time> element: "Tuesday, October 13, 2026, 3:25:42 PM GMT+8".
 */
export const formatFeedFullTime: (date: Date, clock: FeedClock) => string = (
  date: Date,
  clock: FeedClock,
): string => {
  const format: Intl.DateTimeFormat | null = getDateTimeFormat({
    locale: getFeedLocale(clock.language),
    timezone: clock.timezone,
    shape: clock.use12HourClock ? "full-12" : "full-24",
    options: {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: clock.use12HourClock,
    },
  });

  const zoneName: string = getFeedZoneName(date, clock.timezone);

  const written: string = format
    ? format.format(date)
    : inZone(date, clock.timezone).format(
        clock.use12HourClock
          ? "dddd, MMMM D, YYYY, h:mm:ss A"
          : "dddd, MMMM D, YYYY, HH:mm:ss",
      );

  return zoneName ? `${written} ${zoneName}` : written;
};

const capitalizeFirst: (text: string, locale: string) => string = (
  text: string,
  locale: string,
): string => {
  if (!text) {
    return text;
  }

  const first: string = text.charAt(0);

  try {
    return first.toLocaleUpperCase(locale) + text.slice(1);
  } catch {
    return first.toUpperCase() + text.slice(1);
  }
};

const relativeFormatterCache: Map<string, RelativeTimeFormatter | null> =
  new Map<string, RelativeTimeFormatter | null>();

const getRelativeTimeFormatter: (
  locale: string,
  style: "long" | "short",
) => RelativeTimeFormatter | null = (
  locale: string,
  style: "long" | "short",
): RelativeTimeFormatter | null => {
  const cacheKey: string = `${locale}|${style}`;

  if (relativeFormatterCache.has(cacheKey)) {
    return relativeFormatterCache.get(cacheKey) || null;
  }

  let formatter: RelativeTimeFormatter | null = null;

  try {
    const RelativeTimeFormat: RelativeTimeFormatConstructor | undefined =
      getRelativeTimeFormatConstructor();

    if (RelativeTimeFormat) {
      formatter = new RelativeTimeFormat(locale, {
        numeric: "auto",
        style: style,
      });
    }
  } catch {
    formatter = null;
  }

  relativeFormatterCache.set(cacheKey, formatter);
  return formatter;
};

/*
 * "Today" or "Yesterday" for a day heading, in the reader's language, or
 * undefined for any earlier (or later) day - those are named by their date
 * alone. Counted in calendar days of the reader's zone, so an entry from
 * 11:58 PM read at 12:03 AM is "Yesterday".
 */
export const getFeedRelativeDay: (
  date: Date,
  clock: FeedClock,
) => string | undefined = (
  date: Date,
  clock: FeedClock,
): string | undefined => {
  const dayKey: string = getFeedDayKey(date, clock.timezone);
  const todayKey: string = getFeedDayKey(clock.now, clock.timezone);

  let offsetInDays: number | null = null;

  if (dayKey === todayKey) {
    offsetInDays = 0;
  } else {
    const yesterdayKey: string = inZone(clock.now, clock.timezone)
      .clone()
      .subtract(1, "day")
      .format("YYYY-MM-DD");

    if (dayKey === yesterdayKey) {
      offsetInDays = -1;
    }
  }

  if (offsetInDays === null) {
    return undefined;
  }

  const locale: string = getFeedLocale(clock.language);
  const formatter: RelativeTimeFormatter | null = getRelativeTimeFormatter(
    locale,
    "long",
  );

  if (!formatter) {
    return offsetInDays === 0 ? "Today" : "Yesterday";
  }

  return capitalizeFirst(formatter.format(offsetInDays, "day"), locale);
};

/*
 * "now", "12 min. ago" - the hint under the time of an entry from the last
 * hour, in the reader's language. Undefined for anything older (the time
 * says it), and for an entry stamped clearly in the future.
 */
export const getFeedRelativeHint: (
  date: Date,
  clock: FeedClock,
) => string | undefined = (
  date: Date,
  clock: FeedClock,
): string | undefined => {
  const ageInSeconds: number = (clock.now.getTime() - date.getTime()) / 1000;

  if (Number.isNaN(ageInSeconds)) {
    return undefined;
  }

  if (ageInSeconds < -ALLOWED_CLOCK_SKEW_IN_SECONDS) {
    return undefined;
  }

  if (ageInSeconds >= FEED_RELATIVE_HINT_WINDOW_IN_MINUTES * 60) {
    return undefined;
  }

  const locale: string = getFeedLocale(clock.language);
  const formatter: RelativeTimeFormatter | null = getRelativeTimeFormatter(
    locale,
    "short",
  );

  if (ageInSeconds < JUST_NOW_IN_SECONDS) {
    return formatter ? formatter.format(0, "second") : "now";
  }

  // 45 s to 1 min 29 s is "1 min ago", as a person would round it.
  const minutes: number = Math.max(1, Math.round(ageInSeconds / 60));

  if (minutes >= FEED_RELATIVE_HINT_WINDOW_IN_MINUTES) {
    return undefined;
  }

  return formatter
    ? formatter.format(-minutes, "minute")
    : `${minutes} min ago`;
};

/*
 * The clock a feed is read with right now: the reader's zone, language and
 * hour cycle, as every other time in the product reads them.
 */
export const getFeedClock: (data: {
  language: string;
  now?: Date | undefined;
}) => FeedClock = (data: {
  language: string;
  now?: Date | undefined;
}): FeedClock => {
  return {
    timezone: OneUptimeDate.getCurrentTimezone().toString(),
    language: data.language,
    use12HourClock: OneUptimeDate.getUserPrefers12HourFormat(),
    now: data.now || new Date(),
  };
};
