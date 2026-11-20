import InBetween from "./BaseDatabase/InBetween";
import DayOfWeek, { DayOfWeekUtil } from "./Day/DayOfWeek";
import BadDataException from "./Exception/BadDataException";
import { JSONObject, ObjectType } from "./JSON";
import PositiveNumber from "./PositiveNumber";
import moment from "moment-timezone";
import Timezone from "./Timezone";
import TimezoneAlias from "./TimezoneAlias";
import { refusedValue } from "../Utils/RefusedValue";
import {
  DateTextShape,
  DayNameContext,
  DurationTextPart,
  ReaderDateTimeFormat,
  formatDateText,
  formatDecimal,
  formatDurationText,
  formatRelativeDate,
  getDateTimeFormat,
  getHourOption,
  getZoneAbbreviation,
  isEnglishDateLanguage,
  rememberEnglishOf,
  writeClockInLocale,
  writeDigitsInLocale,
  writeInDateDisplayLanguage,
  writeStandAloneDayName,
} from "./DateLanguage";
import { NO_BREAK_SPACE, withDurationWordsHeld } from "./NoBreakSpaces";
import { Translator } from "./Translator";
import {
  CompactDuration,
  CompactDurationUnit,
  formatCompactDuration,
  formatDurationInUnit,
  formatMilliseconds,
} from "../Utils/Milliseconds";

export const Moment: typeof moment = moment;

/*
 * The custom shapes (getDateAsCustomFormattedStringInTimezone) a date's words
 * are written in the reader's language for, as Intl asks for them. A shape
 * with no words in it still takes the reader's digits: "HH:mm" here
 * ("۲۲:۲۷" on a Persian page), and READER_DIGIT_CUSTOM_DATE_FORMATS, whose
 * shapes keep moment's marks. A shape in neither list is moment's, in
 * English and in Latin digits ("YYYY-MM-DD", which callers compare rather
 * than show), so a shape a page shows belongs in one of them.
 *
 * English's "hh" keeps a 12-hour time's zero ("05:01 PM"), as moment writes
 * it; no other language writes one there ("오후 5:01", "5:01 م"), so the
 * reader's language takes the hour without it (getHourOption, issue #7279).
 * Nothing OneUptime writes asks for "hh" any more (#7652): a 12-hour time
 * is "h:mm A", "5:01 PM", in every language.
 */
const LOCALIZED_CUSTOM_DATE_FORMATS: Readonly<
  Record<string, Intl.DateTimeFormatOptions>
> = {
  "MMM D": { month: "short", day: "numeric" },
  "MMM DD": { month: "short", day: "2-digit" },
  "MMM D, YYYY": { month: "short", day: "numeric", year: "numeric" },
  "MMM DD, YYYY": { month: "short", day: "2-digit", year: "numeric" },
  "MMM DD YYYY": { month: "short", day: "2-digit", year: "numeric" },
  "MMM YYYY": { month: "short", year: "numeric" },
  "MMMM YYYY": { month: "long", year: "numeric" },
  "MMMM D, YYYY": { month: "long", day: "numeric", year: "numeric" },
  "h:mm A": { hour: "numeric", minute: "2-digit", hour12: true },
  "hh:mm A": { hour: getHourOption(true), minute: "2-digit", hour12: true },
  // A 24-hour time of day, in the reader's digits: "۲۲:۲۷" on a Persian page.
  "HH:mm": { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
};

/*
 * The custom shapes with no words in them that are written as moment writes
 * them, with the reader's digits and the mark their language writes
 * between a time's parts (inReaderClock, DateLanguage's writeClockInLocale):
 * Persian's own digits and the Latin ones of every other language, Arabic
 * too; a point between the parts in Danish, as CLDR and Danish write a
 * time, and a colon in every other language (#7914). The milliseconds keep
 * moment's point where the parts take a colon, so the shape is the same in
 * every such language - Intl would put a comma before them in German
 * ("11:55:59,120") - and take the decimal comma in Danish
 * ("11.55.59,120"), where a point is the time's own mark.
 */
const READER_DIGIT_CUSTOM_DATE_FORMATS: ReadonlyArray<string> = [
  // An exception breadcrumb's Clock time: "۱۱:۵۵:۵۹.۱۲۰" on a Persian page.
  "HH:mm:ss.SSS",
];

// A whole number of nanoseconds, as fromUnixNano reads one exactly.
const UNIX_NANO_INTEGER_PATTERN: RegExp = /^[+-]?\d+$/;

/*
 * The most digits OneUptimeDate.readExactUnixNano reads. Below 1e21 ns a
 * time's millisecond has at most 15 digits, so it never leaves the integers
 * a double holds exactly (2^53), and every such time is inside the Date
 * range (8.64e21 ns). That is past every time a nanosecond column holds
 * (UInt64 ends near 1.8e19, int64 near 9.2e18); a longer text is left to the
 * caller's float read, which keeps what it did with one.
 */
const MAX_EXACT_UNIX_NANO_DIGITS: number = 21;

// The character codes readExactUnixNano reads.
const PLUS_SIGN_CODE: number = 43;
const DIGIT_ZERO_CODE: number = 48;

/*
 * A time in whole nanoseconds since the epoch, read exactly from its digits
 * by OneUptimeDate.readExactUnixNano.
 */
export interface ExactUnixNano {
  /*
   * The nanoseconds as digits, without a "+" or leading zeros ("0" for
   * zero): what a UInt64 nanosecond column stores, and what
   * toClickhouseDateTime64 takes a DateTime64(9) fraction from.
   */
  nano: string;
  // The millisecond the nanoseconds fall in, from the same digits.
  date: Date;
}

/*
 * The decimal point of a short duration's figure ("1.72 s", "2m 5.5s"): a
 * digit either side of it. Read on a few characters, so linear.
 */
const DURATION_DECIMAL_POINT: RegExp = /(\d)\.(\d)/g;

// Every digit, to find the separator a language writes between them.
const DIGITS: RegExp = /\d/g;

/*
 * A span's duration as getHumanizedDurationFromNanoseconds reads it, before
 * it is written: one spaced unit ("1.72 s", "960 ms"), or the compact parts
 * of a longer one ("2h 5m", "1m 5.5s"), with its sign. English and the
 * reader's language are both written from it, so the two always say the
 * same length.
 */
type HumanizedDurationReading =
  | { kind: "unknown" }
  | { kind: "zero" }
  | {
      kind: "nanosecond" | "microsecond" | "millisecond" | "second";
      isNegative: boolean;
      value: number;
    }
  | {
      kind: "compact";
      isNegative: boolean;
      parts: Array<{ unit: CompactDurationUnit; value: number }>;
    };

// The compact parts' units, largest first, and their seconds and English letter.
const HUMANIZED_DURATION_UNITS: ReadonlyArray<{
  unit: CompactDurationUnit;
  seconds: number;
  english: string;
}> = [
  { unit: "days", seconds: 86400, english: "d" },
  { unit: "hours", seconds: 3600, english: "h" },
  { unit: "minutes", seconds: 60, english: "m" },
  { unit: "seconds", seconds: 1, english: "s" },
];

// secondsToFormattedFriendlyTimeString's English unit words: one, many.
const FRIENDLY_TIME_ENGLISH_UNITS: Readonly<
  Partial<Record<DurationTextPart["unit"], [string, string]>>
> = {
  year: ["year", "years"],
  month: ["month", "months"],
  day: ["day", "days"],
  hour: ["hour", "hours"],
  minute: ["min", "mins"],
  second: ["sec", "secs"],
};

/*
 * A date written in the Arabic script - Arabic or Persian, whose comma is
 * turned ("،"). Read from the text rather than from the reader's language,
 * so a date a locale still writes in English keeps English's comma.
 */
const ARABIC_SCRIPT_DATE_REGEX: RegExp = /\p{Script=Arabic}/u;

// What goes between a date and its time: "Sep 14, 06:01 PM".
export const DATE_TIME_SEPARATOR: string = ", ";

// The same in a date written in the Arabic script: "14 سبتمبر، 06:01 م".
export const ARABIC_DATE_TIME_SEPARATOR: string = "، ";

/*
 * BigInt(1000000), made the first time fromUnixNano reads an integer string
 * rather than when this module loads: every frontend bundle loads Date.ts,
 * and a browser without BigInt must still load it. Only that one read needs
 * BigInt, as before.
 */
let nanosPerMillisecond: bigint | undefined;

/*
 * How many seconds OneUptimeDate.toClickhouseDateTime keeps the text of,
 * each in the slot its second picks (a power of two, so the slot is a mask).
 * A second's text is kept until another second takes its slot.
 */
const CLICKHOUSE_DATE_TIME_MEMO_SLOTS: number = 256;

// NaN never equals a second, so an empty slot is never read.
const clickhouseDateTimeMemoSeconds: Float64Array = new Float64Array(
  CLICKHOUSE_DATE_TIME_MEMO_SLOTS,
).fill(Number.NaN);

const clickhouseDateTimeMemoTexts: Array<string> = new Array<string>(
  CLICKHOUSE_DATE_TIME_MEMO_SLOTS,
).fill("");

/*
 * The units a calendar (rather than a fixed-length) interval can be measured in.
 * See getStartOfCalendarUnit / addRemoveCalendarUnits below.
 */
export type CalendarUnit = "hour" | "day" | "week" | "month" | "year";

// How secondsToFormattedFriendlyTimeString writes a duration.
export interface FriendlyTimeOptions {
  /*
   * At most this many units, the largest first: 2 keeps "29 days 23 hours"
   * of "29 days 23 hours 52 mins 12 secs". Cut before the duration is
   * written, so every language keeps each number with its unit - "29 日23
   * 時間" in Japanese, which writes no space between a unit and the next
   * number and so cannot be cut by its words. Left out, every unit that is
   * not zero.
   */
  maxUnits?: number | undefined;
  /*
   * A duration of nothing reads "0 secs" ("0 秒", "0 Sek.") instead of
   * nothing at all: right where a blank would read as "unknown".
   */
  writesZero?: boolean | undefined;
}

// What a duration of nothing reads in English, with writesZero.
export const ZERO_FRIENDLY_TIME_TEXT: string = `0${NO_BREAK_SPACE}secs`;

export default class OneUptimeDate {
  // get date time from unix timestamp

  /*
   * The timezone the signed-in user configured in User Settings, pushed in by
   * the UI (see UserUtil.initializeUserTimezone). Null on the server and on
   * signed-out pages, where the process / browser zone is used instead.
   */
  private static userTimezone: Timezone | null = null;

  private static padDatePart(value: number): string {
    return value.toString().padStart(2, "0");
  }

  /*
   * The comma between a date and its time, as the date is written: "، " in
   * the Arabic script ("14 سبتمبر، 06:01 م" in Arabic, "۱۴ سپتامبر، ۰۶:۰۱"
   * in Persian), ", " in every other ("Sep 14, 06:01 PM", "14. Sept.,
   * 06:01"). A caller that writes a date and a time apart, each from a
   * fixed pattern, joins them with this - joined with English's comma, an
   * Arabic tile read "14 سبتمبر, 06:01 م". The helpers that write both at
   * once (Intl) already join them as each language does.
   */
  public static getDateTimeSeparator(datePart: string): string {
    return ARABIC_SCRIPT_DATE_REGEX.test(datePart)
      ? ARABIC_DATE_TIME_SEPARATOR
      : DATE_TIME_SEPARATOR;
  }

  // A date and its time, joined as the date is written (getDateTimeSeparator).
  public static joinDateAndTime(datePart: string, timePart: string): string {
    return `${datePart}${this.getDateTimeSeparator(datePart)}${timePart}`;
  }

  /*
   * A clock moment wrote ("09:05", "14:30:12", "11:55:59.120") in the
   * digits the reader's language writes - Persian's own on a Persian page,
   * as every date Intl writes there, so a page never mixes "۲۶ اکتبر" with
   * "21:16" - and with the mark their language writes between a time's
   * parts: "09.05" in Danish, as Intl writes the times beside it
   * (DateLanguage's writeClockInLocale, #7914). Unchanged in every language
   * that writes Latin digits and a colon, and remembered with its English
   * as every localized date is.
   */
  private static inReaderClock(write: () => string): string {
    return writeInDateDisplayLanguage(
      write,
      (_language: string, locale: string): string | null => {
        const text: string = write();
        const written: string = writeClockInLocale(text, locale);

        // The colon and Latin digits: the English as it is.
        return written === text ? null : written;
      },
    );
  }

  private static isUtcDateTimeString(value: string): boolean {
    const utcDateTimePattern: RegExp =
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/;

    return utcDateTimePattern.test(value.trim());
  }

  private static normalizeUtcDateTimeString(value: string): string {
    const trimmedValue: string = value.trim();
    const [datePart, timePart] = trimmedValue.split(" ");

    if (!datePart || !timePart) {
      return trimmedValue;
    }

    const [baseTime, fractionalPart] = timePart.split(".");

    if (!fractionalPart) {
      return `${datePart}T${baseTime}Z`;
    }

    const milliseconds: string = fractionalPart.slice(0, 3).padEnd(3, "0");
    return `${datePart}T${baseTime}.${milliseconds}Z`;
  }

  /*
   * The month `date` falls in on the reader's calendar, short: "Oct" in
   * English, as moment writes every other English date; "Okt." in German
   * and every other language, as Intl writes it from the wall clock moment
   * works out (DateLanguage's getDateTimeFormat, #10038).
   *
   * English was the browser's own language: an English page read in a
   * German browser put "02 Okt." under a chart beside every table's "Oct
   * 2", and an en-GB one "Sept" beside a tooltip's "Sep".
   */
  private static getLocalShortMonthName(date: Date): string {
    const english: () => string = (): string => {
      return this.inCurrentTimezone(date).format("MMM");
    };

    return writeInDateDisplayLanguage(
      english,
      (_language: string, locale: string): string | null => {
        const format: ReaderDateTimeFormat | null = getDateTimeFormat({
          locale,
          timezones: this.getCurrentTimezoneNames(),
          options: { month: "short" },
        });

        return format ? format.format(date) : null;
      },
    );
  }

  /*
   * The current timezone and its legacy spellings, for Intl: an engine with
   * tzdata before 2022b throws a RangeError for "Europe/Kyiv", which is what
   * getCurrentTimezone reports for a browser that says "Europe/Kiev", but
   * knows the legacy name.
   */
  private static getCurrentTimezoneNames(): Array<string> {
    return this.getTimezoneNames(this.getCurrentTimezone());
  }

  private static getTimezoneNames(timezone: Timezone | string): Array<string> {
    return [
      timezone.toString(),
      ...TimezoneAlias.getLegacyNamesOf(timezone as Timezone).map(
        (name: Timezone): string => {
          return name.toString();
        },
      ),
    ];
  }

  /*
   * `date` in the reader's language, in the shape asked for, read in the
   * current timezone (or the runtime's own zone with `timezones` empty).
   * Null when the language is English or Intl cannot write it: the caller
   * then writes moment's English.
   */
  private static getLocalizedDateText(data: {
    date: Date;
    language: string;
    locale: string;
    shape: DateTextShape;
    timezones?: Array<string> | undefined;
  }): string | null {
    return formatDateText({
      date: data.date,
      locale: data.locale,
      timezones: data.timezones ?? this.getCurrentTimezoneNames(),
      shape: data.shape,
    });
  }

  public static getHoursAndMinutesFromMinutes(minutes: number): string {
    const hours: number = Math.floor(minutes / 60);
    const mins: number = minutes % 60;

    return writeInDateDisplayLanguage(
      (): string => {
        let formattedString: string = "";

        // Each number held to its word: "2 hours 5 minutes" (#8669).
        if (hours > 0) {
          formattedString += `${hours}${NO_BREAK_SPACE}hours `;
        }

        if (mins > 0) {
          formattedString += `${mins}${NO_BREAK_SPACE}minutes`;
        }

        return formattedString.trim() || `0${NO_BREAK_SPACE}minutes`;
      },
      (_language: string, locale: string): string | null => {
        // "2 Stunden 5 Minuten", "0 Minuten".
        const parts: Array<DurationTextPart> = [];

        if (hours > 0) {
          parts.push({ count: hours, unit: "hour" });
        }

        if (mins > 0) {
          parts.push({ count: mins, unit: "minute" });
        }

        return this.formatLocalizedDuration(
          parts.length > 0 ? parts : [{ count: 0, unit: "minute" }],
          locale,
          "long",
          "narrow",
        );
      },
    );
  }

  /*
   * A duration's parts in `locale`: "2 Tage, 3 Stunden", or with `listStyle`
   * "narrow" as a compact reading joins them ("2 Std. 5 Min."). Null when
   * Intl cannot write one of the units, and the caller writes English.
   */
  private static formatLocalizedDuration(
    parts: Array<DurationTextPart>,
    locale: string,
    unitDisplay: "long" | "short" | "narrow",
    listStyle: "long" | "short" | "narrow",
  ): string | null {
    return formatDurationText({ parts, locale, unitDisplay, listStyle });
  }

  public static fromUnixTimestamp(timestamp: number): Date {
    return new Date(timestamp * 1000);
  }

  public static getStartOfTheWeek(
    date: Date,
    timezone?: string | undefined,
  ): Date {
    date = this.fromString(date);
    if (timezone) {
      /*
       * Timezone-aware start of week so on-call weekly-restriction boundaries
       * anchor to the schedule's zone, consistent with the other boundary
       * computations (keepTimeButMoveDay / getStartOfDay). Without a timezone
       * the boundary is taken in the server's local zone (legacy behavior).
       */
      return moment.tz(date, timezone).startOf("week").toDate();
    }
    return moment(date).startOf("week").toDate();
  }

  public static getEndOfTheWeek(date: Date): Date {
    date = this.fromString(date);
    return moment(date).endOf("week").toDate();
  }

  public static getInBetweenDatesAsFormattedString(
    inBetween: InBetween<Date>,
  ): string {
    return (
      this.getDateAsFormattedString(inBetween.startValue) +
      " - " +
      this.getDateAsFormattedString(inBetween.endValue)
    );
  }
  public static convertMinutesToMilliseconds(minutes: number): number {
    return minutes * 60 * 1000;
  }

  public static getNanoSecondsFromSeconds(seconds: number): number {
    return seconds * 1000 * 1000 * 1000;
  }

  public static now(): Date {
    return this.getCurrentDate();
  }

  public static getDateFromYYYYMMDD(
    year: string,
    month: string,
    day: string,
  ): Date {
    return moment(`${year}-${month}-${day}`).toDate();
  }

  public getMicroSecondsFromSeconds(seconds: number): number {
    return seconds * 1000 * 1000;
  }

  public getMilliSecondsFromSeconds(seconds: number): number {
    return seconds * 1000;
  }

  public static getCurrentDateAsUnixNano(): number {
    return this.toUnixNano(this.getCurrentDate());
  }

  public static toUnixNano(date: Date): number {
    return date.getTime() * 1000000;
  }

  public static getLocalHourAndMinuteFromDate(date: Date | string): string {
    return this.getLocalTimeString(date);
  }

  /**
   * The hour / minute `date` reads at in the current timezone. Time pickers use
   * these instead of Date.getHours()/getMinutes() so the digits they show are
   * the ones the user expects in the zone they configured.
   */
  public static getLocalHours(date: Date | string): number {
    return this.inCurrentTimezone(date).hours();
  }

  public static getLocalMinutes(date: Date | string): number {
    return this.inCurrentTimezone(date).minutes();
  }

  public static getLocalShortMonthNameFromDate(date: Date | string): string {
    date = this.fromString(date);
    return this.getLocalShortMonthName(date);
  }

  /**
   * The wall clock `date` reads at in the current timezone - "14:30", or
   * "2:30 PM" when the caller asks for a 12-hour clock.
   *
   * `use12HourFormat` is opt-in rather than defaulted to
   * `getUserPrefers12HourFormat()`: the chart x-axes in
   * UI/Components/Charts/Utils/XAxis.ts label ticks with this and are laid out
   * for the fixed width of a 24-hour reading, so they must keep the clock they
   * were built against. Surfaces that show a person a timestamp - histogram
   * ticks and tooltips, span rows - pass
   * `use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat()` explicitly.
   */
  public static getLocalTimeString(
    date: Date | string,
    options?: {
      includeMinutes?: boolean;
      includeSeconds?: boolean;
      use12HourFormat?: boolean | undefined;
    },
  ): string {
    return this.writeTimeOfDay({
      date: this.fromString(date),
      timezone: this.getCurrentTimezone(),
      includeMinutes: options?.includeMinutes ?? true,
      includeSeconds: options?.includeSeconds ?? false,
      use12HourFormat: options?.use12HourFormat ?? false,
    });
  }

  /*
   * The wall clock `date` reads at in `timezone`, in the reader's language:
   * the one writer of a time of day alone.
   *
   * A 24-hour time is moment's, in the reader's digits and with their
   * language's mark between its parts: "14:30", "14.30" in Danish,
   * "۱۴:۳۰" in Persian (inReaderClock, #7914). A 12-hour clock's half of
   * the day is in the reader's words, as Intl writes it: "2:30 م",
   * "午後2:30", "۲:۳۰ ب.ظ.". Written by moment it was English's "PM" on
   * every page - the one English word in an Arabic monitor's "Refreshed
   * at" and under a histogram's bars.
   */
  private static writeTimeOfDay(data: {
    date: Date;
    timezone: Timezone | string;
    includeMinutes: boolean;
    includeSeconds: boolean;
    use12HourFormat: boolean;
  }): string {
    // "HH" and "h" are the zero-padded 24-hour and the bare 12-hour readings.
    let timeFormat: string = data.use12HourFormat ? "h" : "HH";

    if (data.includeMinutes) {
      timeFormat += ":mm";

      if (data.includeSeconds) {
        timeFormat += ":ss";
      }
    }

    if (data.use12HourFormat) {
      timeFormat += " A";
    }

    const instant: Date = data.date;
    const english: () => string = (): string => {
      return moment(instant).tz(data.timezone.toString()).format(timeFormat);
    };

    if (!data.use12HourFormat) {
      return this.inReaderClock(english);
    }

    return writeInDateDisplayLanguage(
      english,
      (_language: string, locale: string): string | null => {
        const format: ReaderDateTimeFormat | null = getDateTimeFormat({
          locale,
          timezones: this.getTimezoneNames(data.timezone),
          options: {
            hour: "numeric",
            ...(data.includeMinutes ? { minute: "2-digit" } : {}),
            ...(data.includeMinutes && data.includeSeconds
              ? { second: "2-digit" }
              : {}),
            hour12: true,
          },
        });

        return format ? format.format(instant) : null;
      },
    );
  }

  /*
   * A day and its month, as a chart's axis names a day: "02 Mar" in English.
   *
   * In another language, as that language writes them (Intl): "2. Okt.",
   * "2 oct.", "10月2日", "۲ اکتبر" - the day without English's leading zero,
   * which no other language writes, and which a Persian page drew as a
   * dot before the day ("۰۲"), Persian's zero being a dot.
   */
  public static getDateAsLocalDayMonthString(date: Date | string): string {
    const instant: Date = this.fromString(date);

    return writeInDateDisplayLanguage(
      (): string => {
        const day: string = this.padDatePart(
          this.inCurrentTimezone(instant).date(),
        );
        const month: string = this.getLocalShortMonthName(instant);

        return `${day} ${month}`;
      },
      (language: string, locale: string): string | null => {
        // "2. Okt.", "2 oct.", "10月2日", "۲ اکتبر".
        return this.getLocalizedDateText({
          date: instant,
          language,
          locale,
          shape: { onlyShowDate: true, hideYear: true },
        });
      },
    );
  }

  /*
   * A day with its month and its year, as a chart's axis names a day when
   * its window holds a year or more: "02 Mar 2026" in English. In such a
   * window "12 Nov" is two days, a year apart (XAxisUtil).
   *
   * In another language, as that language writes a short date with its year
   * (Intl): "2. März 2026", "2 mars 2026", "2026年3月2日", "۲ مارس ۲۰۲۶".
   */
  public static getDateAsLocalDayMonthYearString(date: Date | string): string {
    const instant: Date = this.fromString(date);

    return writeInDateDisplayLanguage(
      (): string => {
        const local: moment.Moment = this.inCurrentTimezone(instant);
        const day: string = this.padDatePart(local.date());
        const month: string = this.getLocalShortMonthName(instant);

        return `${day} ${month} ${local.year()}`;
      },
      (language: string, locale: string): string | null => {
        // "2. März 2026", "2 mars 2026", "2026年3月2日", "۲ مارس ۲۰۲۶".
        return this.getLocalizedDateText({
          date: instant,
          language,
          locale,
          shape: { onlyShowDate: true },
        });
      },
    );
  }

  /*
   * The hour a chart's bucket starts at, with its day: "02 Mar, 14:00" in
   * English.
   *
   * In another language the day and the time are written, and joined, as
   * that language writes a date with its time (Intl): "2. März, 14:00",
   * "2 mars, 14:00", "3月2日 14:00", "۲ مارس، ۱۴:۰۰". Joined by hand, every
   * language got English's Latin comma - "۰۲ مارس, ۱۴:۰۰" on a Persian
   * axis, where Persian writes its own comma ("،"), and "3月02日, 14:00"
   * where Japanese and Chinese write none - and the day's leading zero.
   */
  public static getDateAsLocalDayMonthHourString(date: Date | string): string {
    const instant: Date = this.fromString(date);

    return writeInDateDisplayLanguage(
      (): string => {
        return `${this.getDateAsLocalDayMonthString(instant)}, ${this.getLocalTimeString(instant, { includeMinutes: false })}:00`;
      },
      (language: string, locale: string): string | null => {
        return this.getLocalizedDateText({
          // The hour's start in the current timezone: its minutes are ":00".
          date: this.inCurrentTimezone(instant).startOf("hour").toDate(),
          language,
          locale,
          shape: { hideYear: true, use12HourFormat: false },
        });
      },
    );
  }

  /**
   * "02 Mar, 14:30" — a day-qualified wall clock, for chart axes whose
   * buckets are finer than an hour but whose window is long enough that a
   * bare "14:30" would name more than one instant.
   *
   * In another language, the day and the time as that language writes and
   * joins them (Intl, see getDateAsLocalDayMonthHourString): "2. März,
   * 14:30", "3月2日 14:30", "۲ مارس، ۱۴:۳۰".
   *
   * A 24-hour clock unless the caller asks for a 12-hour one (a time shown
   * to a person, in their clock: "02 Mar, 2:30 PM"); an axis keeps the
   * clock it is laid out for (see getLocalTimeString).
   */
  public static getDateAsLocalDayMonthTimeString(
    date: Date | string,
    options?: {
      includeSeconds?: boolean | undefined;
      use12HourFormat?: boolean | undefined;
    },
  ): string {
    const instant: Date = this.fromString(date);
    const includeSeconds: boolean = options?.includeSeconds ?? false;
    const use12HourFormat: boolean = options?.use12HourFormat ?? false;

    return writeInDateDisplayLanguage(
      (): string => {
        return `${this.getDateAsLocalDayMonthString(instant)}, ${this.getLocalTimeString(
          instant,
          { includeSeconds, use12HourFormat },
        )}`;
      },
      (language: string, locale: string): string | null => {
        return this.getLocalizedDateText({
          date: instant,
          language,
          locale,
          shape: {
            hideYear: true,
            use12HourFormat,
            showSeconds: includeSeconds,
          },
        });
      },
    );
  }

  /**
   * Minutes `date` sits ahead of UTC in the current timezone. Callers use it
   * to detect a DST transition inside a window: an offset that DROPS across
   * the window means the clock went back, and a wall-clock reading in that
   * hour names two different instants.
   */
  public static getTimezoneOffsetInMinutes(date: Date | string): number {
    return this.inCurrentTimezone(date).utcOffset();
  }

  /**
   * The current timezone's abbreviation AT `date` — "BST" in summer, "GMT"
   * in winter. The only thing that separates the two 01:00s on the day the
   * clocks go back, so chart axes append it when a window straddles one.
   */
  public static getLocalZoneAbbr(date: Date | string): string {
    return this.getZoneAbbrByTimezone(
      this.getCurrentTimezone(),
      this.fromString(date),
    );
  }

  /**
   * A compact "Mar 1, 14:30" (or "Mar 1, 2:30 PM") label for one instant, used
   * where a whole window has to fit on a button - the time range picker above
   * the metrics, traces and logs explorers, chiefly.
   *
   * Both halves follow the user's machine: the wall clock is resolved in the
   * configured timezone (falling back to the one the browser reports), and the
   * 12- vs 24-hour choice follows the operating system's clock preference
   * unless a caller overrides it.
   *
   * With `showYear`, the year too: "Mar 1, 2025, 14:30" - for a window whose
   * ends are not both in this year (isWindowInTheCurrentYear).
   */
  public static getDateAsLocalShortDateTimeString(
    date: Date | string,
    options?: {
      use12HourFormat?: boolean | undefined;
      includeSeconds?: boolean | undefined;
      showYear?: boolean | undefined;
    },
  ): string {
    date = this.fromString(date);

    const use12HourFormat: boolean =
      options?.use12HourFormat ?? this.getUserPrefers12HourFormat();
    const showYear: boolean = Boolean(options?.showYear);

    let timeFormat: string = use12HourFormat ? "h:mm" : "HH:mm";

    if (options?.includeSeconds) {
      timeFormat += ":ss";
    }

    if (use12HourFormat) {
      timeFormat += " A";
    }

    const instant: Date = date;
    const dateFormat: string = showYear ? "MMM D, YYYY" : "MMM D";

    return writeInDateDisplayLanguage(
      (): string => {
        return this.inCurrentTimezone(instant).format(
          `${dateFormat}, ${timeFormat}`,
        );
      },
      (language: string, locale: string): string | null => {
        /*
         * "1. März, 14:30", "1 mars, 14:30", "3月1日 14:30"; with the year,
         * "1. März 2025, 14:30", "1 mars 2025, 14:30", "2025年3月1日 14:30".
         */
        return this.getLocalizedDateText({
          date: instant,
          language,
          locale,
          shape: {
            hideYear: !showYear,
            use12HourFormat,
            showSeconds: Boolean(options?.includeSeconds),
          },
        });
      },
    );
  }

  /**
   * A moment as a list's cell writes it: "Oct 22, 7:25 AM" - a date of this
   * year without its year, and without the zone - or "Oct 22, 2025", the
   * date alone, for one of another year. With onlyShowDate, "Oct 22" and
   * "Oct 22, 2025". The whole of it - year, time and zone
   * (getDateAsUserFriendlyLocalFormattedString) - is what the cell shows
   * under the pointer (Table/TableDate).
   *
   * "Oct 22 2026, 07:25 AM BST" took some 180px in every table's date
   * column, the widest value left in the lists that still ran past their
   * card at a laptop's width - incidents, alerts, the on-call logs - and its
   * year and its zone said the same thing on every row.
   *
   * Read in the current timezone (the one the person picked in User
   * Settings, or the browser's), as every other local date: a year turns
   * there. The clock follows the person's 12- or 24-hour preference unless
   * the caller says.
   */
  public static getDateAsCompactLocalString(
    date: Date | string,
    options?: {
      onlyShowDate?: boolean | undefined;
      use12HourFormat?: boolean | undefined;
      // The moment "this year" is read from: now, unless a caller says.
      now?: Date | undefined;
    },
  ): string {
    const instant: Date = this.fromString(date);
    const now: Date = options?.now || this.getCurrentDate();
    const isThisYear: boolean =
      this.inCurrentTimezone(instant).year() ===
      this.inCurrentTimezone(now).year();

    if (isThisYear && !options?.onlyShowDate) {
      return this.getDateAsLocalShortDateTimeString(instant, {
        use12HourFormat: options?.use12HourFormat,
      });
    }

    const englishFormat: string = isThisYear ? "MMM D" : "MMM D, YYYY";

    return writeInDateDisplayLanguage(
      (): string => {
        return this.inCurrentTimezone(instant).format(englishFormat);
      },
      (language: string, locale: string): string | null => {
        // "22. Okt.", "22. Okt. 2025", "10月22日", "2025年10月22日".
        return this.getLocalizedDateText({
          date: instant,
          language,
          locale,
          shape: { onlyShowDate: true, hideYear: isThisYear },
        });
      },
    );
  }

  public static getDateAsLocalMonthYearString(date: Date | string): string {
    const instant: Date = this.fromString(date);

    return writeInDateDisplayLanguage(
      (): string => {
        const month: string = this.getLocalShortMonthName(instant);
        const year: string = this.inCurrentTimezone(instant).year().toString();

        return `${month} ${year}`;
      },
      (_language: string, locale: string): string | null => {
        // "Okt. 2026", "oct. 2026", "2026年10月".
        const format: ReaderDateTimeFormat | null = getDateTimeFormat({
          locale,
          timezones: this.getCurrentTimezoneNames(),
          options: { month: "short", year: "numeric" },
        });

        return format ? format.format(instant) : null;
      },
    );
  }

  /*
   * A moment's year on the reader's calendar (the configured timezone), as
   * the reader's language writes a year alone: "2026"; "۲۰۲۶" in Persian;
   * "2026年" in Japanese and Chinese; "2026년" in Korean. A yearly chart
   * axis names its ticks with it, as its month ticks are named with
   * getDateAsLocalMonthYearString ("2026年10月").
   */
  public static getDateAsLocalYearString(date: Date | string): string {
    const instant: Date = this.fromString(date);

    return writeInDateDisplayLanguage(
      (): string => {
        return this.inCurrentTimezone(instant).year().toString();
      },
      (_language: string, locale: string): string | null => {
        const format: ReaderDateTimeFormat | null = getDateTimeFormat({
          locale,
          timezones: this.getCurrentTimezoneNames(),
          options: { year: "numeric" },
        });

        return format ? format.format(instant) : null;
      },
    );
  }

  public static getMillisecondsBetweenTwoUnixNanoDates(
    startDate: number,
    endDate: number,
  ): number {
    return endDate - startDate;
  }

  public static moveDateToTheDayOfWeek(
    date: Date,
    moveToWeek: Date,
    dayOfWeek: DayOfWeek,
    timezone?: string | undefined,
  ): Date {
    // date will be moved to the week of "moveToWeek" and then to the day of week "dayOfWeek"

    date = this.fromString(date);
    date = this.keepTimeButMoveDay(date, moveToWeek, timezone);

    // now move the date to the day of week

    const dateDayOfWeek: DayOfWeek = this.getDayOfWeek(date, timezone);

    if (dateDayOfWeek === dayOfWeek) {
      return date;
    }

    const numberOfDayOfWeek: number =
      DayOfWeekUtil.getNumberOfDayOfWeek(dayOfWeek);

    const dateDayOfWeekNumber: number =
      DayOfWeekUtil.getNumberOfDayOfWeek(dateDayOfWeek);

    const difference: number = numberOfDayOfWeek - dateDayOfWeekNumber;

    if (difference === 0) {
      return date;
    }

    /*
     * Forward the timezone to the final day-shift too. The first two steps
     * (keepTimeButMoveDay, getDayOfWeek) are already timezone-aware; without
     * the timezone here this last shift used the process zone, so a shift that
     * straddles a DST transition in the target zone (but not the process zone)
     * drifted the resolved weekly-restriction boundary by the DST offset
     * (audit F9).
     */
    return this.addRemoveDays(date, difference, timezone);
  }

  public static getDayOfTheWeekIndex(date: Date): number {
    date = this.fromString(date);
    return moment(date).weekday();
  }

  /**
   * Format the wall-clock time (HH:mm, respecting the 12/24h preference) of an
   * instant AS SEEN IN `timezone`. With no timezone, falls back to the
   * process/browser local wall-clock. Used to show on-call restriction hours in
   * the schedule's timezone rather than the viewer's browser zone (audit F10).
   *
   * In the reader's language as every other time of day is
   * (writeTimeOfDay): a 12-hour time read "5:00 PM" in English on a German
   * or Arabic page, and a 24-hour one "17:00" on a Danish page whose other
   * times read "17.00".
   */
  public static getHourAndMinuteInTimezoneString(
    date: Date | string,
    timezone?: string | undefined,
  ): string {
    date = this.fromString(date);
    if (!timezone) {
      return this.getLocalHourAndMinuteFromDate(date);
    }

    return this.getTimeStringInTimezone(date, { timezone });
  }

  /*
   * The wall clock `date` reads at in `timezone` - a schedule's, a
   * rotation's - in the reader's language and on the clock asked for (the
   * reader's when left out): "17:00", "5:00 PM", "17.00" in Danish,
   * "오후 5:00" in Korean.
   */
  public static getTimeStringInTimezone(
    date: Date | string,
    options: {
      timezone: string;
      use12HourFormat?: boolean | undefined;
      includeSeconds?: boolean | undefined;
    },
  ): string {
    return this.writeTimeOfDay({
      date: this.fromString(date),
      timezone: options.timezone,
      includeMinutes: true,
      includeSeconds: Boolean(options.includeSeconds),
      use12HourFormat:
        options.use12HourFormat ?? this.getUserPrefers12HourFormat(),
    });
  }

  /*
   * A clock of the day - working hours' "09:00", a schedule's "9:00 AM" -
   * that is no instant, in the reader's language and on the clock asked
   * for (the reader's when left out): "09:00", "9:00 AM", "09.00" in
   * Danish, "오전 9:00" in Korean, "۰۹:۰۰" in Persian. Hand-written, it was
   * English's "9:00 AM" and a colon on every page.
   */
  public static getClockTimeString(
    hour: number,
    minute: number,
    options?: { use12HourFormat?: boolean | undefined },
  ): string {
    return this.writeTimeOfDay({
      date: new Date(Date.UTC(2024, 0, 1, hour, minute)),
      timezone: "UTC",
      includeMinutes: true,
      includeSeconds: false,
      use12HourFormat:
        options?.use12HourFormat ?? this.getUserPrefers12HourFormat(),
    });
  }

  /*
   * THE DAY OF THE WEEK `date` FALLS ON, BY ITS NAME (#7660).
   *
   * In `timezone` (the reader's when left out) and in the reader's
   * language: "Monday", "Mon", "M" in English, as moment writes them; Intl's
   * words in any other language, cased as that language writes a day's
   * name standing alone or in a menu (DateLanguage's
   * writeStandAloneDayName): "Lun" over a Spanish column, "man." over a
   * Danish one. A narrow name keeps Intl's case: CLDR's capitals are for
   * every width but the narrow one.
   */
  public static getDayOfWeekName(
    date: Date | string,
    options: {
      width: "long" | "short" | "narrow";
      context: DayNameContext;
      timezone?: string | undefined;
    },
  ): string {
    const instant: Date = this.fromString(date);
    const timezone: string = (
      options.timezone || this.getCurrentTimezone()
    ).toString();
    const zoned: () => moment.Moment = (): moment.Moment => {
      return moment(instant).tz(timezone);
    };

    return writeInDateDisplayLanguage(
      (): string => {
        if (options.width === "narrow") {
          return zoned().format("dd").charAt(0);
        }

        return zoned().format(options.width === "long" ? "dddd" : "ddd");
      },
      (language: string, locale: string): string | null => {
        const format: ReaderDateTimeFormat | null = getDateTimeFormat({
          locale,
          timezones: this.getTimezoneNames(timezone),
          options: { weekday: options.width },
        });

        if (!format) {
          return null;
        }

        const name: string = format.format(instant);

        return options.width === "narrow"
          ? name
          : writeStandAloneDayName({
              name: name,
              language: language,
              context: options.context,
            });
      },
    );
  }

  /*
   * A run of days in `timezone`, as a calendar's title names it: "September
   * 14 – 20, 2026", "Sep 28 – Oct 4, 2026", "Dec 28, 2026 – Jan 3, 2027"
   * in English, as moment writes them; in another language as Intl writes
   * a range of days, what the two share said once: "14.–20. Sept. 2026",
   * "2026年9月14日～20日". Each end is the day it falls on in the zone.
   */
  public static getDayRangeInTimezoneString(data: {
    start: Date | string;
    end: Date | string;
    timezone: string;
  }): string {
    const start: Date = this.fromString(data.start);
    const end: Date = this.fromString(data.end);

    return writeInDateDisplayLanguage(
      (): string => {
        const first: moment.Moment = moment(start).tz(data.timezone);
        const last: moment.Moment = moment(end).tz(data.timezone);

        if (first.year() !== last.year()) {
          return `${first.format("MMM D, YYYY")} – ${last.format("MMM D, YYYY")}`;
        }

        if (first.month() !== last.month()) {
          return `${first.format("MMM D")} – ${last.format("MMM D, YYYY")}`;
        }

        return `${first.format("MMMM D")} – ${last.format("D, YYYY")}`;
      },
      (_language: string, locale: string): string | null => {
        const format: ReaderDateTimeFormat | null = getDateTimeFormat({
          locale,
          timezones: this.getTimezoneNames(data.timezone),
          options: { year: "numeric", month: "short", day: "numeric" },
        });

        return format ? format.formatRange(start, end) : null;
      },
    );
  }

  /**
   * Format a single instant as a human-readable "weekday, month day, time"
   * string resolved in a specific IANA timezone (e.g. "America/New_York").
   *
   * Used by the on-call schedule summaries to render each shift's start / end in
   * the SAME zone the rotation engine schedules people in, with a DST-aware zone
   * abbreviation appended so the reader is never in doubt which wall clock the
   * time refers to. When `timezone` is omitted the instant is formatted in the
   * viewer's local zone (matching the rest of the local-time UI).
   *
   * A list that says its zone once, and whose moments are all of this year -
   * an on-call schedule's upcoming hand-offs - leaves both out of each
   * moment (`hideYear`, `hideZone`): "Mon, Nov 4, 9:00 AM", not "Mon, Nov 4,
   * 2026, 9:00 AM PST" twice a row.
   */
  public static getDateAsFormattedStringInTimezone(data: {
    date: Date | string;
    timezone?: string | undefined;
    onlyShowDate?: boolean | undefined;
    showWeekday?: boolean | undefined;
    use12HourFormat?: boolean | undefined;
    hideYear?: boolean | undefined;
    hideZone?: boolean | undefined;
  }): string {
    const date: Date = this.fromString(data.date);
    const use12HourFormat: boolean =
      data.use12HourFormat ?? this.getUserPrefers12HourFormat();

    return writeInDateDisplayLanguage(
      (): string => {
        return this.getEnglishDateInTimezone({
          date,
          timezone: data.timezone,
          onlyShowDate: data.onlyShowDate,
          showWeekday: data.showWeekday,
          use12HourFormat,
          hideYear: data.hideYear,
          hideZone: data.hideZone,
        });
      },
      (language: string, locale: string): string | null => {
        // "Di., 6. Okt. 2026, 10:05 BST".
        const timezone: Timezone = (data.timezone ||
          this.getCurrentTimezone()) as Timezone;
        const text: string | null = this.getLocalizedDateText({
          date,
          language,
          locale,
          shape: {
            onlyShowDate: data.onlyShowDate,
            showWeekday: data.showWeekday,
            use12HourFormat,
            hideYear: data.hideYear,
          },
          timezones: this.getTimezoneNames(timezone),
        });

        if (!text || data.onlyShowDate || data.hideZone) {
          return text;
        }

        return `${text} ${this.getZoneInLocale(
          this.getZoneAbbrByTimezone(timezone, date),
          locale,
        )}`.trim();
      },
    );
  }

  // getDateAsFormattedStringInTimezone's English, as moment writes it.
  private static getEnglishDateInTimezone(data: {
    date: Date;
    timezone?: string | undefined;
    onlyShowDate?: boolean | undefined;
    showWeekday?: boolean | undefined;
    use12HourFormat: boolean;
    hideYear?: boolean | undefined;
    hideZone?: boolean | undefined;
  }): string {
    const date: Date = data.date;
    const use12HourFormat: boolean = data.use12HourFormat;

    const timePart: string = use12HourFormat ? "h:mm A" : "HH:mm";
    const dayPart: string = data.showWeekday ? "ddd, MMM D" : "MMM D";
    const datePart: string = data.hideYear ? dayPart : `${dayPart}, YYYY`;
    const formatString: string = data.onlyShowDate
      ? datePart
      : `${datePart}, ${timePart}`;
    const withoutZone: boolean = Boolean(data.onlyShowDate || data.hideZone);

    if (!data.timezone) {
      const local: moment.Moment = this.inCurrentTimezone(date);
      return (
        local.format(formatString) +
        (withoutZone
          ? ""
          : // Same DST-aware lookup the explicit-timezone branch below uses.
            " " + this.getZoneAbbrByTimezone(this.getCurrentTimezone(), date))
      ).trim();
    }

    const zoned: moment.Moment = moment(date).tz(data.timezone);
    return (
      zoned.format(formatString) +
      (withoutZone
        ? ""
        : " " + this.getZoneAbbrByTimezone(data.timezone as Timezone, date))
    ).trim();
  }

  /*
   * Whether two moments fall in the same calendar year, as a clock in
   * `timezone` reads them - the viewer's zone without one. New Year's Eve in
   * one zone can be New Year's Day in another.
   */
  public static isSameYearInTimezone(
    a: Date | string,
    b: Date | string,
    timezone?: string | undefined,
  ): boolean {
    const yearOf: (date: Date | string) => number = (
      date: Date | string,
    ): number => {
      const instant: Date = this.fromString(date);

      return timezone
        ? moment(instant).tz(timezone).year()
        : this.inCurrentTimezone(instant).year();
    };

    return yearOf(a) === yearOf(b);
  }

  /**
   * Whether both ends of a window fall in the current year, on the reader's
   * calendar (the configured timezone, New Year included): a label of the
   * window can then leave the year out, as the time range button does
   * ("Mar 1, 14:30 – Mar 2, 09:00"). Otherwise it cannot: a custom range of
   * exactly a year read "Nov 12, 9:49 AM – Nov 12, 9:49 AM", as if it were
   * no time at all, and a range in an earlier year did not say which (issue
   * #7124).
   *
   * "The current year" is the one `now` is in: now, unless a caller says.
   */
  public static isWindowInTheCurrentYear(data: {
    start: Date | string;
    end: Date | string;
    now?: Date | undefined;
  }): boolean {
    const now: Date = data.now || this.getCurrentDate();

    return (
      this.isSameYearInTimezone(data.start, now) &&
      this.isSameYearInTimezone(data.end, now)
    );
  }

  /*
   * Format an instant with an explicit moment format string, resolved in an
   * IANA timezone. The formatted-string helpers above each bake in a layout;
   * this one is for callers that need a specific shape ("MMMM YYYY" for the
   * month a status page report covers) and know exactly which zone it must be
   * read in. Falls back to the viewer's / process's zone without one.
   */
  public static getDateAsCustomFormattedStringInTimezone(data: {
    date: Date | string;
    format: string;
    timezone?: string | undefined;
  }): string {
    const date: Date = this.fromString(data.date);
    const english: () => string = (): string => {
      if (!data.timezone) {
        return this.inCurrentTimezone(date).format(data.format);
      }

      return moment(date).tz(data.timezone).format(data.format);
    };
    const options: Intl.DateTimeFormatOptions | undefined =
      LOCALIZED_CUSTOM_DATE_FORMATS[data.format];

    if (!options) {
      return READER_DIGIT_CUSTOM_DATE_FORMATS.includes(data.format)
        ? this.inReaderClock(english)
        : english();
    }

    return writeInDateDisplayLanguage(
      english,
      (_language: string, locale: string): string | null => {
        const format: ReaderDateTimeFormat | null = getDateTimeFormat({
          locale,
          timezones: data.timezone
            ? this.getTimezoneNames(data.timezone)
            : this.getCurrentTimezoneNames(),
          options,
        });

        return format ? format.format(date) : null;
      },
    );
  }

  /**
   * Reinterpret the wall-clock components of `date` — read in the CURRENT
   * timezone, i.e. the one the pickers render in — as the SAME wall-clock in
   * `timezone`, and return that instant. Used to store a time the user typed
   * for the schedule's timezone even though the time picker captured it in the
   * viewer's own zone (audit F1). Inverse of
   * getLocalDateFromWallClockInTimezone.
   *
   * Only for widgets that read Dates through the current timezone, as the
   * datetime-local Input and the TimePicker do. A widget that reads a Date's
   * browser-local wall clock needs getInstantFromBrowserLocalWallClockInTimezone.
   */
  public static getInstantFromLocalWallClockInTimezone(
    date: Date | string,
    timezone: string,
  ): Date {
    const local: moment.Moment = this.inCurrentTimezone(date);
    return moment
      .tz(
        {
          year: local.year(),
          month: local.month(),
          day: local.date(),
          hour: local.hour(),
          minute: local.minute(),
          second: local.second(),
        },
        timezone,
      )
      .toDate();
  }

  /**
   * Inverse of getInstantFromLocalWallClockInTimezone: return a Date whose
   * wall-clock IN THE CURRENT TIMEZONE equals `date`'s wall-clock as seen in
   * `timezone`. Used to display a stored schedule-timezone time inside a picker
   * that renders in the viewer's own zone (audit F1).
   *
   * Only for widgets that read Dates through the current timezone. A widget
   * that draws a Date at its browser-local wall clock needs
   * getBrowserLocalDateFromWallClockInTimezone.
   */
  public static getLocalDateFromWallClockInTimezone(
    date: Date | string,
    timezone: string,
  ): Date {
    date = this.fromString(date);
    const zoned: moment.Moment = moment.tz(date, timezone);
    return moment
      .tz(
        {
          year: zoned.year(),
          month: zoned.month(),
          day: zoned.date(),
          hour: zoned.hour(),
          minute: zoned.minute(),
          second: zoned.second(),
        },
        this.getCurrentTimezone().toString(),
      )
      .toDate();
  }

  /**
   * The browser-zone twin of getLocalDateFromWallClockInTimezone: return a Date
   * whose BROWSER-LOCAL wall clock (getHours() and so on) equals `date`'s wall
   * clock in `timezone`.
   *
   * For widgets that draw a Date at its browser-local wall clock and know
   * nothing of the user's configured zone, such as react-big-calendar with the
   * plain moment localizer. getLocalDateFromWallClockInTimezone builds the wall
   * clock in the CURRENT timezone, which is the user's User Settings zone when
   * one is set. When that differs from the browser's zone, the widget draws
   * every Date off by the difference between the two. Inverse of
   * getInstantFromBrowserLocalWallClockInTimezone.
   */
  public static getBrowserLocalDateFromWallClockInTimezone(
    date: Date | string,
    timezone: string,
  ): Date {
    date = this.fromString(date);
    const zoned: moment.Moment = moment.tz(date, timezone);
    return new Date(
      zoned.year(),
      zoned.month(),
      zoned.date(),
      zoned.hour(),
      zoned.minute(),
      zoned.second(),
    );
  }

  /**
   * The browser-zone twin of getInstantFromLocalWallClockInTimezone: read
   * `date`'s BROWSER-LOCAL wall clock and return the instant that same wall
   * clock names in `timezone`. For turning a Date a browser-local widget
   * reported (a range react-big-calendar shows, say) back into an instant.
   * Inverse of getBrowserLocalDateFromWallClockInTimezone.
   */
  public static getInstantFromBrowserLocalWallClockInTimezone(
    date: Date | string,
    timezone: string,
  ): Date {
    date = this.fromString(date);
    return moment
      .tz(
        {
          year: date.getFullYear(),
          month: date.getMonth(),
          day: date.getDate(),
          hour: date.getHours(),
          minute: date.getMinutes(),
          second: date.getSeconds(),
        },
        timezone,
      )
      .toDate();
  }

  public static isOverlapping(
    start: Date,
    end: Date,
    start1: Date,
    end1: Date,
  ): unknown {
    start = this.fromString(start);
    end = this.fromString(end);
    start1 = this.fromString(start1);
    end1 = this.fromString(end1);

    let isOverlapping: boolean =
      moment(start).isBetween(start1, end1) ||
      moment(end).isBetween(start1, end1) ||
      moment(start).isSame(start1) ||
      moment(end).isSame(end1);

    if (!isOverlapping) {
      // check if the start1 and end1 are in between start and end

      isOverlapping =
        moment(start1).isBetween(start, end) ||
        moment(end1).isBetween(start, end) ||
        moment(start1).isSame(start) ||
        moment(end1).isSame(end);
    }

    return isOverlapping;
  }

  public static getCurrentDate(): Date {
    /*
     * Not moment().toDate(): this is called on per-record telemetry ingest
     * paths, and a moment wrapper allocation per call is pure overhead for
     * what is exactly `new Date()`.
     */
    return new Date();
  }

  /*
   * "5 hours ago", "in 3 days" - in the reader's language when a frontend set
   * one ("vor 5 Stunden"), rounded as moment rounds it. Counted from now, or
   * from the moment a view reads its own clock at (one its tests pin). The
   * number is held to its unit in every language: moment's English through
   * withDurationWordsHeld (#8669), Intl's through DateLanguage (#8456).
   */
  public static fromNow(date: Date, now?: Date | undefined): string {
    return writeInDateDisplayLanguage(
      (): string => {
        return withDurationWordsHeld(
          now ? moment(date).from(now) : moment(date).fromNow(),
        );
      },
      (_language: string, locale: string): string | null => {
        return formatRelativeDate({
          date: this.fromString(date),
          now: now || new Date(),
          locale,
        });
      },
    );
  }

  public static differenceBetweenTwoDatesAsFromattedString(
    date1: Date,
    date2: Date,
  ): string {
    const seconds: number = this.getSecondsBetweenTwoDates(date1, date2);
    return this.secondsToFormattedFriendlyTimeString(seconds);
  }

  public static isSame(date1: Date, date2: Date): boolean {
    date1 = this.fromString(date1);
    date2 = this.fromString(date2);
    return moment(date1).isSame(date2);
  }

  /*
   * Whole days of 24 hours from `startDate` to `endDate`, rounded toward
   * zero as moment's diff rounds: a length of time, the same in every zone
   * - an event's age, the days until a certificate expires. The calendar
   * day counts below (getDaysBetweenTwoDates, getNumberOfDaysBetweenDates)
   * read the runtime's own calendar, so on a server whose zone changes its
   * clocks 7 x 24 hours across the change counted 6 days (issue #8473).
   */
  public static getWholeDaysOfTimeBetween(
    startDate: Date | string,
    endDate: Date | string,
  ): number {
    const ms: number =
      this.fromString(endDate).getTime() - this.fromString(startDate).getTime();
    const days: number = Math.trunc(ms / (24 * 60 * 60 * 1000));

    // Never -0: a moment and itself are 0 days apart.
    return days === 0 ? 0 : days;
  }

  public static getDaysBetweenTwoDates(startDate: Date, endDate: Date): number {
    startDate = this.fromString(startDate);
    endDate = this.fromString(endDate);
    return moment(endDate).diff(moment(startDate), "days");
  }

  public static getDaysBetweenTwoDatesInclusive(
    startDate: Date,
    endDate: Date,
  ): number {
    return this.getDaysBetweenTwoDates(startDate, endDate) + 1;
  }

  public static getHoursBetweenTwoDates(
    startDate: Date,
    endDate: Date,
  ): number {
    startDate = this.fromString(startDate);
    endDate = this.fromString(endDate);
    return moment(endDate).diff(moment(startDate), "hours");
  }

  public static getHoursBetweenTwoDatesInclusive(
    startDate: Date,
    endDate: Date,
  ): number {
    return this.getHoursBetweenTwoDates(startDate, endDate) + 1;
  }

  public static getMinutesBetweenTwoDates(
    startDate: Date,
    endDate: Date,
  ): number {
    startDate = this.fromString(startDate);
    endDate = this.fromString(endDate);
    return moment(endDate).diff(moment(startDate), "minutes");
  }

  public static getMinutesBetweenTwoDatesInclusive(
    startDate: Date,
    endDate: Date,
  ): number {
    return this.getMinutesBetweenTwoDates(startDate, endDate) + 1;
  }

  public static getSecondsBetweenTwoDates(
    startDate: Date,
    endDate: Date,
  ): number {
    startDate = this.fromString(startDate);
    endDate = this.fromString(endDate);
    return moment(endDate).diff(moment(startDate), "seconds");
  }

  public static getSecondsBetweenTwoDatesInclusive(
    startDate: Date,
    endDate: Date,
  ): number {
    return this.getSecondsBetweenTwoDates(startDate, endDate) + 1;
  }

  public static getWeeksBetweenTwoDates(
    startDate: Date,
    endDate: Date,
  ): number {
    startDate = this.fromString(startDate);
    endDate = this.fromString(endDate);
    return moment(endDate).diff(moment(startDate), "weeks");
  }

  public static getWeeksBetweenTwoDatesInclusive(
    startDate: Date,
    endDate: Date,
  ): number {
    return this.getWeeksBetweenTwoDates(startDate, endDate) + 1;
  }

  public static getMonthsBetweenTwoDates(
    startDate: Date,
    endDate: Date,
  ): number {
    startDate = this.fromString(startDate);
    endDate = this.fromString(endDate);
    return moment(endDate).diff(moment(startDate), "months");
  }

  public static getMonthsBetweenTwoDatesInclusive(
    startDate: Date,
    endDate: Date,
  ): number {
    return this.getMonthsBetweenTwoDates(startDate, endDate) + 1;
  }

  public static getYearsBetweenTwoDates(
    startDate: Date,
    endDate: Date,
  ): number {
    startDate = this.fromString(startDate);
    endDate = this.fromString(endDate);
    return moment(endDate).diff(moment(startDate), "years");
  }

  public static getYearsBetweenTwoDatesInclusive(
    startDate: Date,
    endDate: Date,
  ): number {
    return this.getYearsBetweenTwoDates(startDate, endDate) + 1;
  }

  public static toString(date: Date | undefined): string {
    if (!date) {
      return "";
    }

    date = this.fromString(date);

    return date.toISOString();
  }

  /*
   * The ISO instant for a value that is *declared* a Date but may not be one
   * at runtime.
   *
   * TypeORM's save() hands back the entity it was given, so a date column read
   * off a freshly created model holds whatever the caller supplied — a real
   * Date once BaseModel.fromJSON has coerced it, a raw string from any caller
   * that bypasses that path. `.toISOString()` on the latter is a TypeError,
   * and post-create hooks are exactly where such a throw does the most damage:
   * the row is already committed, so it converts a completed write into a
   * server error the caller retries.
   *
   * Returns null for anything that is not a usable date, so a caller reporting
   * an optional timestamp reports "unknown" instead of failing.
   */
  public static toIsoStringOrNull(
    date: Date | string | undefined | null,
  ): string | null {
    if (!date) {
      return null;
    }

    let parsedDate: Date;

    try {
      parsedDate = this.fromString(date);
    } catch {
      return null;
    }

    if (!(parsedDate instanceof Date) || Number.isNaN(parsedDate.getTime())) {
      return null;
    }

    return parsedDate.toISOString();
  }

  public static getCurrentMomentDate(): moment.Moment {
    return moment();
  }

  public static keepTimeButMoveDay(
    keepTimeFor: Date,
    moveDayTo: Date,
    timezone?: string | undefined,
  ): Date {
    keepTimeFor = this.fromString(keepTimeFor);
    moveDayTo = this.fromString(moveDayTo);

    if (timezone) {
      /*
       * Timezone-aware: keep the wall-clock time of `keepTimeFor` AS SEEN IN
       * `timezone`, and place it on the day of `moveDayTo` (also in `timezone`).
       * This is what makes an on-call restriction like "09:00-17:00" resolve to
       * 09:00 in the schedule's zone regardless of the server's zone, and lets
       * moment-timezone handle DST transitions correctly.
       */
      const src: moment.Moment = moment.tz(keepTimeFor, timezone);
      return moment
        .tz(moveDayTo, timezone)
        .set({
          hour: src.hour(),
          minute: src.minute(),
          second: src.second(),
          millisecond: src.millisecond(),
        })
        .toDate();
    }

    return moment(moveDayTo)
      .set({
        hour: keepTimeFor.getHours(),
        minute: keepTimeFor.getMinutes(),
        second: keepTimeFor.getSeconds(),
        millisecond: keepTimeFor.getMilliseconds(),
      })
      .toDate();
  }

  public static getOneMinAgo(): Date {
    return this.getSomeMinutesAgo(new PositiveNumber(1));
  }

  public static getOneDayAgo(): Date {
    return this.getSomeDaysAgo(new PositiveNumber(1));
  }

  public static fromUnixNano(timestamp: string | number): Date {
    /*
     * Nanosecond epoch values are far larger than Number.MAX_SAFE_INTEGER, so
     * parsing them as a float (or dividing that float by 1e6) silently drops
     * up to a full millisecond of precision. When the raw value is an integer
     * string, divide with BigInt to keep exact millisecond precision; fall
     * back to numeric division for number inputs and non-integer strings.
     *
     * The Date is built directly, not through moment(millis).toDate(): every
     * ingested log, span and metric data point comes through here, and for a
     * number moment does nothing but `new Date(millis)` - wrapped in a moment
     * object, its input checks and a second Date - which cost about fifteen
     * times the work. Both give the same instant for every number, NaN and
     * out-of-range values (an Invalid Date) included.
     */
    if (typeof timestamp === "string") {
      const trimmed: string = timestamp.trim();
      if (UNIX_NANO_INTEGER_PATTERN.test(trimmed)) {
        if (nanosPerMillisecond === undefined) {
          nanosPerMillisecond = BigInt(1000000);
        }
        return new Date(Number(BigInt(trimmed) / nanosPerMillisecond));
      }
      return new Date(Number(trimmed) / 1000000);
    }
    return new Date(timestamp / 1000000);
  }

  /*
   * OTLP sends a time as whole nanoseconds since the epoch: an integer
   * string in OTLP/protobuf, and from most OTLP/JSON senders. Today's are
   * about 1.8e18, where doubles are 256 ns apart, so parseFloat moves such a
   * text by up to 128 ns, and a Date made from that float (fromUnixNano of a
   * number) can land a millisecond off: early on one whole millisecond in
   * eight, late just before a millisecond ends. A time up to 128 ns before a
   * whole second even reads as that second: its float is the second itself.
   *
   * This reads the digits instead. The Date, the stored nanoseconds and a
   * DateTime64(9) fraction (toClickhouseDateTime64 given `nano`) all come
   * from the same digits, so they always agree. Keep a float of the text
   * for arithmetic only - a duration, a comparison - never for what is
   * stored or shown.
   *
   * It reads a text of decimal digits with an optional leading "+" and
   * leading zeros, which parseFloat reads as the same number, and at most
   * MAX_EXACT_UNIX_NANO_DIGITS of them; `nano` drops the "+" and the zeros,
   * as the float's digits did. Anything else gives null, and the caller
   * reads it as it did before: a number (already a float), a "-", spaces, a
   * point or an exponent ("1.5e18"), any other character, an empty text,
   * more digits, or no text at all.
   *
   * Every ingested log, span and metric data point comes through here, so
   * it is one pass over the characters that sums the millisecond as it
   * goes: no regular expression, BigInt or float of the whole value, and
   * the stored digits are the text itself when it has no "+" or zeros to
   * drop. Like fromUnixNano it builds the Date directly, and it makes no
   * BigInt (see nanosPerMillisecond).
   */
  public static readExactUnixNano(value: unknown): ExactUnixNano | null {
    if (typeof value !== "string") {
      return null;
    }

    const text: string = value;
    const length: number = text.length;
    let start: number = 0;

    // A "+" and leading zeros read as nothing; the last digit always stays.
    if (length > 1 && text.charCodeAt(0) === PLUS_SIGN_CODE) {
      start = 1;
    }

    while (start < length - 1 && text.charCodeAt(start) === DIGIT_ZERO_CODE) {
      start++;
    }

    const digitCount: number = length - start;

    if (digitCount === 0 || digitCount > MAX_EXACT_UNIX_NANO_DIGITS) {
      return null;
    }

    /*
     * The millisecond is every digit but the last six. It is summed in two
     * parts that stay small integers - its last nine digits, and the up to
     * six before them - since one sum that grows past 2^31 is a float's
     * and made the whole read about 40% slower; joined, they stay below
     * 2^53, so exact. The last six digits are only checked.
     */
    const millisecondEnd: number = length - 6;
    // Not Math.max: in a vm context (Jest's) it is a call, a third of the read.
    const lowStart: number =
      millisecondEnd - 9 > start ? millisecondEnd - 9 : start;
    let high: number = 0;
    let low: number = 0;
    let index: number = start;

    for (; index < lowStart; index++) {
      const digit: number = text.charCodeAt(index) - DIGIT_ZERO_CODE;

      if (digit < 0 || digit > 9) {
        return null;
      }

      high = high * 10 + digit;
    }

    for (; index < millisecondEnd; index++) {
      const digit: number = text.charCodeAt(index) - DIGIT_ZERO_CODE;

      if (digit < 0 || digit > 9) {
        return null;
      }

      low = low * 10 + digit;
    }

    for (; index < length; index++) {
      const digit: number = text.charCodeAt(index) - DIGIT_ZERO_CODE;

      if (digit < 0 || digit > 9) {
        return null;
      }
    }

    return {
      nano: start === 0 ? text : text.slice(start),
      date: new Date(high * 1000000000 + low),
    };
  }

  public static parseRfc5424Timestamp(value: string): Date | undefined {
    if (!value || typeof value !== "string") {
      return undefined;
    }

    const parsed: moment.Moment = Moment(value, Moment.ISO_8601, true);

    if (!parsed.isValid()) {
      return undefined;
    }

    return parsed.toDate();
  }

  public static parseRfc3164Timestamp(value: string): Date | undefined {
    if (!value || typeof value !== "string") {
      return undefined;
    }

    const normalized: string = value.replace(/\s+/g, " ").trim();

    if (!normalized) {
      return undefined;
    }

    const currentYear: number = this.getCurrentYear();

    let parsed: moment.Moment = Moment(
      `${normalized} ${currentYear}`,
      "MMM D HH:mm:ss YYYY",
      true,
    );

    if (!parsed.isValid()) {
      return undefined;
    }

    const now: moment.Moment = Moment();

    if (parsed.isAfter(now.clone().add(1, "months"))) {
      parsed = parsed.subtract(1, "years");
    } else if (parsed.isBefore(now.clone().subtract(11, "months"))) {
      parsed = parsed.add(1, "years");
    }

    return parsed.toDate();
  }

  public static getSecondsTo(date: Date): number {
    date = this.fromString(date);
    const dif: number = date.getTime() - this.getCurrentDate().getTime();
    const Seconds_from_T1_to_T2: number = dif / 1000;
    return Math.abs(Seconds_from_T1_to_T2);
  }

  public static getSomeMinutesAgo(minutes: PositiveNumber | number): Date {
    if (!(minutes instanceof PositiveNumber)) {
      minutes = new PositiveNumber(minutes);
    }

    return this.getCurrentMomentDate()
      .add(-1 * minutes.toNumber(), "minutes")
      .toDate();
  }

  public static timezoneOffsetDate(date: Date): Date {
    date = this.fromString(date);
    return this.addRemoveMinutes(date, date.getTimezoneOffset());
  }

  /**
   * Render an instant as the value of an `<input type="datetime-local">` — a
   * bare wall-clock with no offset — read in the current timezone, to the
   * second ("2026-11-13T11:15:52").
   *
   * A field people schedule with shows toDateTimeLocalMinuteString instead:
   * a value with seconds makes the browser's picker show and ask for them
   * too. Only a field that compares with event timestamps (a telemetry time
   * range) keeps the seconds, by opting in (Input's showSecondsForDateTime).
   */
  public static toDateTimeLocalString(date: Date): string {
    return this.inCurrentTimezone(date).format("YYYY-MM-DDTHH:mm:ss");
  }

  /**
   * The value an `<input type="datetime-local">` shows a person who picks a
   * time to schedule or record something: the wall clock in the current
   * timezone, to the minute ("2026-11-13T11:15"). Without seconds in its
   * value, the browser's picker shows hours and minutes and no seconds
   * column, and what is picked comes back to the minute.
   *
   * The seconds of an instant stored with them are not shown, and not lost:
   * a field left as it was keeps the value it was given (Input changes its
   * value only when the person changes the field).
   */
  public static toDateTimeLocalMinuteString(date: Date): string {
    return this.inCurrentTimezone(date).format("YYYY-MM-DDTHH:mm");
  }

  /**
   * Inverse of toDateTimeLocalString: turn the offset-less wall-clock a user
   * typed into a `<input type="date">` / `<input type="datetime-local">` into
   * the instant it names in the current timezone. Without this the browser
   * zone is used to resolve the wall-clock, so a user whose machine reports a
   * different zone than the one they configured would have their times stored
   * hours off.
   */
  public static fromDateTimeLocalString(value: string): Date {
    return moment
      .tz(value.trim(), this.getCurrentTimezone().toString())
      .toDate();
  }

  public static fromJSON(json: JSONObject): Date {
    if (json["_type"] === ObjectType.DateTime) {
      return OneUptimeDate.fromString(json["value"] as string);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }

  public static toJSON(date: Date): JSONObject {
    return {
      _type: ObjectType.DateTime,
      value: OneUptimeDate.toString(date),
    };
  }

  public static areOnTheSameDay(date1: Date, date2: Date): boolean {
    date1 = this.fromString(date1);
    date2 = this.fromString(date2);
    return moment(date1).isSame(date2, "day");
  }

  /**
   * Whether the two instants fall on the same calendar day *in the current
   * timezone*, which is the question a UI is asking when it decides whether a
   * timestamp needs its date spelled out or a bare clock reading will do.
   *
   * `areOnTheSameDay` above answers it in the zone the process happens to run
   * in. Near midnight those two zones disagree, so asking the wrong one drops
   * the date from yesterday's buckets and adds it to today's.
   */
  public static areOnTheSameLocalDay(
    date1: Date | string,
    date2: Date | string,
  ): boolean {
    return this.inCurrentTimezone(date1).isSame(
      this.inCurrentTimezone(date2),
      "day",
    );
  }

  public static areOnTheSameMonth(date1: Date, date2: Date): boolean {
    date1 = this.fromString(date1);
    date2 = this.fromString(date2);
    return moment(date1).isSame(date2, "month");
  }

  public static areOnTheSameYear(date1: Date, date2: Date): boolean {
    date1 = this.fromString(date1);
    date2 = this.fromString(date2);
    return moment(date1).isSame(date2, "year");
  }

  public static areOnTheSameHour(date1: Date, date2: Date): boolean {
    date1 = this.fromString(date1);
    date2 = this.fromString(date2);
    return moment(date1).isSame(date2, "hour");
  }

  public static areOnTheSameMinute(date1: Date, date2: Date): boolean {
    date1 = this.fromString(date1);
    date2 = this.fromString(date2);
    return moment(date1).isSame(date2, "minute");
  }

  public static areOnTheSameSecond(date1: Date, date2: Date): boolean {
    date1 = this.fromString(date1);
    date2 = this.fromString(date2);
    return moment(date1).isSame(date2, "second");
  }

  public static areOnTheSameWeek(date1: Date, date2: Date): boolean {
    date1 = this.fromString(date1);
    date2 = this.fromString(date2);
    return moment(date1).isSame(date2, "week");
  }

  public static addRemoveMinutes(date: Date, minutes: number): Date {
    date = this.fromString(date);
    return moment(date).add(minutes, "minutes").toDate();
  }

  /*
   * Calendar-unit arithmetic. When `timezone` is provided the step preserves
   * the wall-clock time in that zone across DST transitions (e.g. an on-call
   * handoff/restriction authored for 09:00 stays at 09:00 local after
   * spring-forward/fall-back). Without a timezone the step is taken in the
   * server's local zone — fully backward compatible for existing callers.
   * Hours/minutes/seconds are absolute units and intentionally have no
   * timezone-aware variant.
   */
  public static addRemoveDays(
    date: Date,
    days: number,
    timezone?: string | undefined,
  ): Date {
    date = this.fromString(date);
    if (timezone) {
      return moment.tz(date, timezone).add(days, "days").toDate();
    }
    return moment(date).add(days, "days").toDate();
  }

  /*
   * `days` days as a length of time: days x 24 hours, the same in every
   * zone. For a range such as "the last 7 days" of a read, which is a span
   * of time rather than calendar days somewhere. addRemoveDays without a
   * zone steps the server's calendar, so on a server outside UTC a week
   * that crosses a clock change comes out an hour short or long (issue
   * #7623).
   */
  public static addRemoveDurationInDays(date: Date, days: number): Date {
    date = this.fromString(date);
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }

  public static addRemoveHours(date: Date, hours: number): Date {
    date = this.fromString(date);
    return moment(date).add(hours, "hours").toDate();
  }

  public static addRemoveYears(
    date: Date,
    years: number,
    timezone?: string | undefined,
  ): Date {
    date = this.fromString(date);
    if (timezone) {
      return moment.tz(date, timezone).add(years, "years").toDate();
    }
    return moment(date).add(years, "years").toDate();
  }

  public static addRemoveMonths(
    date: Date,
    months: number,
    timezone?: string | undefined,
  ): Date {
    date = this.fromString(date);
    if (timezone) {
      return moment.tz(date, timezone).add(months, "months").toDate();
    }
    return moment(date).add(months, "months").toDate();
  }

  public static addRemoveWeeks(
    date: Date,
    weeks: number,
    timezone?: string | undefined,
  ): Date {
    date = this.fromString(date);
    if (timezone) {
      return moment.tz(date, timezone).add(weeks, "weeks").toDate();
    }
    return moment(date).add(weeks, "weeks").toDate();
  }

  public static addRemoveSeconds(date: Date, seconds: number): Date {
    date = this.fromString(date);
    return moment(date).add(seconds, "seconds").toDate();
  }

  public static getSecondsInDays(days: PositiveNumber | number): number {
    if (!(days instanceof PositiveNumber)) {
      days = new PositiveNumber(days);
    }
    return days.positiveNumber * 24 * 60 * 60;
  }

  public static getMillisecondsInDays(days: PositiveNumber | number): number {
    return this.getSecondsInDays(days) * 1000;
  }

  public static getSecondsInHours(hours: PositiveNumber | number): number {
    if (!(hours instanceof PositiveNumber)) {
      hours = new PositiveNumber(hours);
    }
    return hours.positiveNumber * 60 * 60;
  }

  public static getMillisecondsInHours(hours: PositiveNumber | number): number {
    return this.getSecondsInHours(hours) * 1000;
  }

  public static getSomeHoursAgo(hours: PositiveNumber | number): Date {
    if (!(hours instanceof PositiveNumber)) {
      hours = new PositiveNumber(hours);
    }
    return this.getCurrentMomentDate()
      .add(-1 * hours.toNumber(), "hours")
      .toDate();
  }

  /*
   * THE getSomeDays FAMILY STEPS DAYS AS A LENGTH OF TIME: days x 24 hours,
   * the same in every zone (addRemoveDurationInDays), as getSomeHoursAgo
   * steps hours. Its callers ask for spans - a status page's last 90 days
   * of uptime, a session that lasts 30 days, a link that expires in a day,
   * rows older than 30 days - and stepped on the runtime's own calendar
   * (moment's add(n, "days")) each was an hour short or long whenever the
   * runtime's zone changed its clocks inside the span: on a self-hosted
   * server outside UTC, and in a browser in the zone of the machine, which
   * is not even the reader's (issue #8236, after #7623). CI runs in UTC,
   * where every calendar day is 24 hours, so nothing failed there.
   *
   * A walk over calendar days - a strip of a bar a day - is not a span. It
   * steps in the zone its days are in (addRemoveDays with a zone,
   * addRemoveCalendarUnits), or on the runtime's own calendar with
   * getSomeDaysAfterDate, as DayUptimeGraphUtil walks a strip with no zone.
   */
  private static toDayCount(days: PositiveNumber | number): number {
    if (!(days instanceof PositiveNumber)) {
      days = new PositiveNumber(days);
    }

    return Number(days.toNumber());
  }

  public static getSomeDaysAgo(days: PositiveNumber | number): Date {
    return this.addRemoveDurationInDays(
      this.getCurrentMomentDate().toDate(),
      -this.toDayCount(days),
    );
  }

  public static getSomeDaysAgoFromDate(
    date: Date,
    days: PositiveNumber | number,
  ): Date {
    return this.addRemoveDurationInDays(date, -this.toDayCount(days));
  }

  public static getSomeDaysAfterFromDate(
    date: Date,
    days: PositiveNumber | number,
  ): Date {
    return this.addRemoveDurationInDays(date, this.toDayCount(days));
  }

  public static getSomeDaysBeforeFromDate(
    date: Date,
    days: PositiveNumber | number,
  ): Date {
    return this.addRemoveDurationInDays(date, -this.toDayCount(days));
  }

  public static getSomeSecondsAgo(seconds: PositiveNumber | number): Date {
    if (!(seconds instanceof PositiveNumber)) {
      seconds = new PositiveNumber(seconds);
    }

    return this.getCurrentMomentDate()
      .add(-1 * seconds.toNumber(), "seconds")
      .toDate();
  }

  public static getOneMinAfter(): Date {
    return this.getSomeMinutesAfter(new PositiveNumber(1));
  }

  public static getOneDayAfter(): Date {
    return this.getSomeDaysAfter(new PositiveNumber(1));
  }

  public static getSomeMinutesAfter(minutes: PositiveNumber | number): Date {
    if (!(minutes instanceof PositiveNumber)) {
      minutes = new PositiveNumber(minutes);
    }

    return this.getCurrentMomentDate()
      .add(minutes.toNumber(), "minutes")
      .toDate();
  }

  public static getSomeHoursAfter(hours: PositiveNumber | number): Date {
    if (!(hours instanceof PositiveNumber)) {
      hours = new PositiveNumber(hours);
    }
    return this.getCurrentMomentDate().add(hours.toNumber(), "hours").toDate();
  }

  // A length of time, as the rest of the family (see getSomeDaysAgo).
  public static getSomeDaysAfter(days: PositiveNumber | number): Date {
    return this.addRemoveDurationInDays(
      this.getCurrentMomentDate().toDate(),
      this.toDayCount(days),
    );
  }

  public static toUnixTimestamp(date: Date): number {
    return Math.floor(date.getTime() / 1000);
  }

  /*
   * "1 year 2 months 3 days 4 hours 5 mins 6 secs", each unit that is not
   * zero, counted on the calendar from the epoch - and in the reader's
   * language when a frontend set one ("1 J. 2 Mon. 3 Tg."). `options` keeps
   * only the largest units, and writes a duration of nothing.
   */
  public static secondsToFormattedFriendlyTimeString(
    seconds: number,
    options?: FriendlyTimeOptions | undefined,
  ): string {
    const maxUnits: number | undefined = options?.maxUnits;
    const allParts: Array<DurationTextPart> =
      this.getFriendlyTimeParts(seconds);
    const parts: Array<DurationTextPart> =
      maxUnits !== undefined && maxUnits >= 1
        ? allParts.slice(0, Math.floor(maxUnits))
        : allParts;

    if (parts.length === 0 && options?.writesZero) {
      return writeInDateDisplayLanguage(
        (): string => {
          return ZERO_FRIENDLY_TIME_TEXT;
        },
        (_language: string, locale: string): string | null => {
          return this.formatLocalizedDuration(
            [{ count: 0, unit: "second" }],
            locale,
            "short",
            "narrow",
          );
        },
      );
    }

    return writeInDateDisplayLanguage(
      (): string => {
        return parts
          .map((part: DurationTextPart): string => {
            const names: [string, string] = FRIENDLY_TIME_ENGLISH_UNITS[
              part.unit
            ] || [part.unit, part.unit];

            // Each number held to its unit: "1 min 47 secs" (#8669).
            return `${part.count}${NO_BREAK_SPACE}${
              part.count === 1 ? names[0] : names[1]
            }`;
          })
          .join(" ");
      },
      (_language: string, locale: string): string | null => {
        return parts.length > 0
          ? this.formatLocalizedDuration(parts, locale, "short", "narrow")
          : null;
      },
    );
  }

  // The non-zero calendar units in `seconds` from the epoch, largest first.
  private static getFriendlyTimeParts(
    seconds: number,
  ): Array<DurationTextPart> {
    const startDate: moment.Moment = moment.utc(0);
    const date: moment.Moment = moment.utc(seconds * 1000);
    const parts: Array<DurationTextPart> = [];

    const units: Array<{
      unit: DurationTextPart["unit"];
      moment: moment.unitOfTime.Diff & moment.unitOfTime.DurationConstructor;
    }> = [
      { unit: "year", moment: "years" },
      { unit: "month", moment: "months" },
      { unit: "day", moment: "days" },
      { unit: "hour", moment: "hours" },
      { unit: "minute", moment: "minutes" },
      { unit: "second", moment: "seconds" },
    ];

    for (const unit of units) {
      const count: number = date.diff(startDate, unit.moment);

      if (count > 0) {
        startDate.add(count, unit.moment);
        parts.push({ count, unit: unit.unit });
      }
    }

    return parts;
  }

  public static getGreaterDate(a: Date, b: Date): Date {
    a = this.fromString(a);
    b = this.fromString(b);
    if (this.isAfter(a, b)) {
      return a;
    }

    return b;
  }

  public static getLesserDate(a: Date, b: Date): Date {
    a = this.fromString(a);
    b = this.fromString(b);
    if (this.isBefore(a, b)) {
      return a;
    }

    return b;
  }

  public static getSecondsBetweenDates(start: Date, end: Date): number {
    start = this.fromString(start);
    end = this.fromString(end);
    const duration: moment.Duration = moment.duration(
      moment(end).diff(moment(start)),
    );
    return duration.asSeconds();
  }

  /*
   * `days` days on, on the runtime's own calendar: the same wall clock on a
   * later day, 23 or 25 hours on where its clocks change. Unlike the rest
   * of the getSomeDays family, which steps lengths of time (getSomeDaysAgo),
   * this walks calendar days: DayUptimeGraphUtil walks a strip with no zone
   * a bar a day with it, and 24 hours on from a minute past midnight is the
   * same day again where the clocks go back.
   */
  public static getSomeDaysAfterDate(
    date: Date,
    days: PositiveNumber | number,
  ): Date {
    return moment(date).add(this.toDayCount(days), "days").toDate();
  }

  public static getSomeSecondsAfter(seconds: PositiveNumber | number): Date {
    if (!(seconds instanceof PositiveNumber)) {
      seconds = new PositiveNumber(seconds);
    }

    return this.getCurrentMomentDate()
      .add(seconds.toNumber(), "seconds")
      .toDate();
  }

  public static getNumberOfDaysBetweenDates(
    startDate: Date,
    endDate: Date,
  ): number {
    const a: moment.Moment = moment(startDate);
    const b: moment.Moment = moment(endDate);
    return b.diff(a, "days");
  }

  public static getNumberOfMinutesBetweenDates(
    startDate: Date,
    endDate: Date,
  ): number {
    const a: moment.Moment = moment(startDate);
    const b: moment.Moment = moment(endDate);
    return b.diff(a, "minutes");
  }

  public static getNumberOfDaysBetweenDatesInclusive(
    startDate: Date,
    endDate: Date,
  ): number {
    return this.getNumberOfDaysBetweenDates(startDate, endDate) + 1;
  }

  public static momentToDate(moment: moment.Moment): Date {
    return moment.toDate();
  }

  public static getCurrentYear(): number {
    return moment().year();
  }

  public static getStartOfDay(date: Date, timezone?: string | undefined): Date {
    date = this.fromString(date);
    if (timezone) {
      return moment.tz(date, timezone).startOf("day").toDate();
    }
    return moment(date).startOf("day").toDate();
  }

  public static getEndOfDay(date: Date, timezone?: string | undefined): Date {
    date = this.fromString(date);
    if (timezone) {
      return moment.tz(date, timezone).endOf("day").toDate();
    }
    return moment(date).endOf("day").toDate();
  }

  /*
   * The start of the minute `date` falls in: its seconds and milliseconds
   * dropped, as a new Date (the one given is left as it was). The same
   * instant in every timezone, since every zone's offset today is a whole
   * number of minutes.
   *
   * What "now" is in a field people schedule with: an override, a rotation
   * or an announcement that starts now starts at the minute the field shows
   * (11:15, never 11:15:52), which has already begun - never a minute late.
   */
  public static getStartOfMinute(date: Date | string): Date {
    const instant: Date = this.fromString(date);
    const millisecondsInAMinute: number = 60 * 1000;

    return new Date(
      Math.floor(instant.getTime() / millisecondsInAMinute) *
        millisecondsInAMinute,
    );
  }

  /*
   * The last millisecond of the minute `date` falls in: 11:15:59.999 for
   * anything from 11:15:00.000 on, as getEndOfDay is a day's 23:59:59.999.
   * With getStartOfMinute, the whole minute a field shows (11:15), so a
   * filter on "11:15" holds a row stamped 11:15:42 (#7719).
   */
  public static getEndOfMinute(date: Date | string): Date {
    const millisecondsInAMinute: number = 60 * 1000;

    return new Date(
      this.getStartOfMinute(date).getTime() + millisecondsInAMinute - 1,
    );
  }

  /*
   * Calendar arithmetic - "the previous calendar month", "add 3 calendar
   * months" - as opposed to the fixed-length arithmetic the rest of this class
   * does. A calendar month is 28-31 days long and a calendar day is 23-25 hours
   * long across a DST transition, so anything that has to line up with a wall
   * clock (a status page report that must read "Jul 1 - Jul 31", a schedule that
   * must keep firing at 09:00 local) cannot be expressed by adding milliseconds.
   *
   * Every helper below takes an optional IANA timezone. Without one the
   * boundaries land in the process's local zone, which on a server is UTC.
   */
  private static toMomentCalendarUnit(
    unit: CalendarUnit,
    forStartOf: boolean,
  ): moment.unitOfTime.StartOf & moment.unitOfTime.DurationConstructor {
    /*
     * moment's "week" starts on the locale's first day, which differs between
     * environments and would make a weekly report cover Sun-Sat on one host and
     * Mon-Sun on another. ISO weeks are always Monday-Sunday, so the boundary is
     * the same everywhere. Durations have no such ambiguity - a week is 7 days -
     * and moment has no "isoWeek" duration, so only startOf is remapped.
     */
    if (unit === "week" && forStartOf) {
      return "isoWeek" as moment.unitOfTime.StartOf &
        moment.unitOfTime.DurationConstructor;
    }

    return unit as moment.unitOfTime.StartOf &
      moment.unitOfTime.DurationConstructor;
  }

  private static inTimezone(
    date: Date,
    timezone?: string | undefined,
  ): moment.Moment {
    return timezone ? moment.tz(date, timezone) : moment(date);
  }

  /*
   * The instant the calendar unit containing `date` began - e.g. the first
   * millisecond of that month, in `timezone`.
   */
  public static getStartOfCalendarUnit(
    date: Date,
    unit: CalendarUnit,
    timezone?: string | undefined,
  ): Date {
    return this.inTimezone(this.fromString(date), timezone)
      .startOf(this.toMomentCalendarUnit(unit, true))
      .toDate();
  }

  /*
   * Move `date` by whole calendar units, keeping the wall clock in `timezone`.
   * Adding one month to Jan 31 lands on Feb 28/29 (moment clamps), and adding a
   * day across a DST boundary still lands at the same local time.
   */
  public static addRemoveCalendarUnits(
    date: Date,
    unit: CalendarUnit,
    count: number,
    timezone?: string | undefined,
  ): Date {
    return this.inTimezone(this.fromString(date), timezone)
      .add(count, this.toMomentCalendarUnit(unit, false))
      .toDate();
  }

  /*
   * How many whole calendar units fit between the two instants, measured in
   * `timezone`. Used to jump a recurrence forward to "now" in one step instead
   * of looping one interval at a time.
   */
  public static getCalendarUnitsBetween(
    startDate: Date,
    endDate: Date,
    unit: CalendarUnit,
    timezone?: string | undefined,
  ): number {
    return this.inTimezone(this.fromString(endDate), timezone).diff(
      this.inTimezone(this.fromString(startDate), timezone),
      this.toMomentCalendarUnit(unit, false),
    );
  }

  public static isBetween(date: Date, startDate: Date, endDate: Date): boolean {
    date = this.fromString(date);
    startDate = this.fromString(startDate);
    endDate = this.fromString(endDate);
    return moment(date).isBetween(startDate, endDate);
  }

  public static isAfter(date: Date, startDate: Date): boolean {
    date = this.fromString(date);
    startDate = this.fromString(startDate);
    return moment(date).isAfter(startDate, "seconds");
  }

  public static isOnOrAfter(date: Date, startDate: Date): boolean {
    date = this.fromString(date);
    startDate = this.fromString(startDate);
    return moment(date).isSameOrAfter(startDate, "seconds");
  }

  public static getDayOfWeek(
    date: Date,
    timezone?: string | undefined,
  ): DayOfWeek {
    const dayOfWeek: number = this.geyDayOfWeekAsNumber(date, timezone);

    if (dayOfWeek === 1) {
      return DayOfWeek.Monday;
    } else if (dayOfWeek === 2) {
      return DayOfWeek.Tuesday;
    } else if (dayOfWeek === 3) {
      return DayOfWeek.Wednesday;
    } else if (dayOfWeek === 4) {
      return DayOfWeek.Thursday;
    } else if (dayOfWeek === 5) {
      return DayOfWeek.Friday;
    } else if (dayOfWeek === 6) {
      return DayOfWeek.Saturday;
    } else if (dayOfWeek === 7) {
      return DayOfWeek.Sunday;
    }

    throw new BadDataException("Invalid day of week");
  }

  public static geyDayOfWeekAsNumber(
    date: Date,
    timezone?: string | undefined,
  ): number {
    date = this.fromString(date);
    if (timezone) {
      return moment.tz(date, timezone).isoWeekday();
    }
    return moment(date).isoWeekday();
  }

  public static isOnOrBefore(date: Date, endDate: Date): boolean {
    date = this.fromString(date);
    endDate = this.fromString(endDate);

    return moment(date).isSameOrBefore(endDate, "seconds");
  }

  public static isEqualBySeconds(date: Date, startDate: Date): boolean {
    date = this.fromString(date);
    startDate = this.fromString(startDate);
    return moment(date).isSame(startDate, "seconds");
  }

  public static hasExpired(expirationDate: Date): boolean {
    expirationDate = this.fromString(expirationDate);
    return !moment(this.getCurrentDate()).isBefore(expirationDate, "seconds");
  }

  public static isBefore(date: Date, endDate: Date): boolean {
    date = this.fromString(date);
    endDate = this.fromString(endDate);
    return moment(date).isBefore(endDate, "seconds");
  }

  public static getCurrentDateAsFormattedString(options?: {
    onlyShowDate?: boolean;
    showSeconds?: boolean;
    use12HourFormat?: boolean;
  }): string {
    return this.getDateAsFormattedString(new Date(), options);
  }

  /**
   * Whether the machine this is running on writes the time of day on a 12-hour
   * clock, read from the browser's resolved default locale - which browsers
   * derive from the operating system's language and region, so changing those
   * changes this. An explicit -u-hc- override on the locale is honoured too.
   *
   * Note what this cannot see: the standalone "24-Hour Time" switch macOS and
   * Windows offer separately from the region. Safari and recent Firefox fold
   * that into the locale they resolve; Chromium does not. A user who wants a
   * clock that ignores their region would need an explicit preference stored
   * alongside the timezone in User Settings - there is none today.
   *
   * Asked of Intl rather than inferred from a formatted string. The string
   * probe below only recognises the Latin "AM"/"PM", so it misread every
   * 12-hour locale that marks the day period some other way - ko-KR writes
   * the equivalent of "PM" in Hangul, ar-EG in Arabic script - and served
   * those users a 24-hour clock against their own convention.
   */
  public static getUserPrefers12HourFormat(): boolean {
    if (typeof window === "undefined") {
      // Server-side: default to 12-hour format for user-friendly display
      return true;
    }

    /*
     * `hour12` is only reported when the format actually asks for an hour, so
     * the probe has to request one.
     */
    try {
      /*
       * Typed structurally rather than as Intl.ResolvedDateTimeFormatOptions:
       * `hourCycle` only appears on that interface from the ES2021 lib, and
       * this file has to compile against the older one too.
       */
      const resolvedOptions: {
        hour12?: boolean | undefined;
        hourCycle?: string | undefined;
      } = new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
      }).resolvedOptions();

      if (typeof resolvedOptions.hour12 === "boolean") {
        return resolvedOptions.hour12;
      }

      /*
       * Older engines report the cycle but not the boolean. h11/h12 are the
       * two 12-hour cycles; h23/h24 are the 24-hour ones.
       */
      if (resolvedOptions.hourCycle) {
        return (
          resolvedOptions.hourCycle === "h11" ||
          resolvedOptions.hourCycle === "h12"
        );
      }
    } catch {
      /*
       * A missing or broken Intl must not take every timestamp in the UI down
       * with it - fall through to the string probe below.
       */
    }

    /*
     * Last resort: read a formatted time and look for a day-period marker.
     * This only recognises the Latin "AM"/"PM" - which is exactly why it is the
     * fallback and not the primary check, since locales like ko-KR and ar-EG
     * are 12-hour but mark the day period with characters this cannot see.
     */
    const timeString: string = new Date().toLocaleTimeString();
    return (
      timeString.toLowerCase().includes("am") ||
      timeString.toLowerCase().includes("pm")
    );
  }

  public static getDateAsUserFriendlyFormattedString(
    date: string | Date,
    options?: {
      onlyShowDate?: boolean;
      showSeconds?: boolean;
    },
  ): string {
    return this.getDateAsFormattedString(date, {
      ...options,
      use12HourFormat: this.getUserPrefers12HourFormat(),
    });
  }

  public static getDateAsUserFriendlyLocalFormattedString(
    date: string | Date,
    onlyShowDate?: boolean,
    showSeconds?: boolean,
  ): string {
    return this.getDateAsLocalFormattedString(
      date,
      onlyShowDate,
      this.getUserPrefers12HourFormat(),
      showSeconds,
    );
  }

  /*
   * A moment in full, with its zone: getDateAsLocalFormattedString's, on a
   * 24-hour clock unless the caller asks for a 12-hour one.
   *
   * It read the runtime's own wall clock and named the zone the reader
   * picked, as that zone is today: on a page whose reader picked New York
   * in a London browser, a January incident read "Jan 15 2026, 14:00 EDT"
   * - London's 14:00, New York's summer name. Now the wall clock and the
   * name are both the current timezone's at that moment. On the server,
   * where no reader picked a zone, that is the process's zone, as before.
   */
  public static getDateAsFormattedString(
    date: string | Date,
    options?: {
      onlyShowDate?: boolean;
      showSeconds?: boolean;
      use12HourFormat?: boolean;
    },
  ): string {
    return this.getDateAsLocalFormattedString(
      date,
      options?.onlyShowDate,
      options?.use12HourFormat,
      options?.showSeconds,
    );
  }

  /*
   * The English of a moment in full, as moment writes it: "Nov 5, 2025,
   * 5:14 AM", "Nov 5, 2025, 05:14", "Nov 5, 2025" - the short form's shape
   * with its year (getDateAsLocalShortDateTimeString), so English reads
   * one way everywhere. It read "Nov 05 2025, 05:14 AM": the day's zero,
   * and a 12-hour time's, which no short date and no other language
   * writes (#7652). A 24-hour time keeps its zero: "05:14".
   */
  private static getEnglishLongDateFormat(data: {
    onlyShowDate?: boolean | undefined;
    use12HourFormat?: boolean | undefined;
    showSeconds?: boolean | undefined;
  }): string {
    if (data.onlyShowDate) {
      return "MMM D, YYYY";
    }

    const seconds: string = data.showSeconds ? ":ss" : "";
    const time: string = data.use12HourFormat
      ? `h:mm${seconds} A`
      : `HH:mm${seconds}`;

    return `MMM D, YYYY, ${time}`;
  }

  public static getDifferenceInMinutes(date: Date, date2: Date): number {
    date = this.fromString(date);
    date2 = this.fromString(date2);
    const minutes: number = moment(date).diff(moment(date2), "minutes");

    if (minutes < 0) {
      return minutes * -1;
    }

    return minutes;
  }

  public static getDifferenceInSeconds(date: Date, date2: Date): number {
    date = this.fromString(date);
    date2 = this.fromString(date2);
    const seconds: number = moment(date).diff(moment(date2), "seconds");

    if (seconds < 0) {
      return seconds * -1;
    }

    return seconds;
  }

  public static getDifferenceInMonths(date: Date, date2: Date): number {
    date = this.fromString(date);
    date2 = this.fromString(date2);
    const months: number = moment(date).diff(moment(date2), "months");

    if (months < 0) {
      return months * -1;
    }

    return months;
  }

  public static convertSecondsToDaysHoursMinutesAndSeconds(
    seconds: number,
  ): string {
    // should output 2 days, 3 hours, 4 minutes and 5 seconds. If the days are 0, it should not show the days. If the hours are 0, it should not show the hours. If the minutes are 0, it should not show the minutes. If the seconds are 0, it should not show the seconds.

    const days: number = Math.floor(seconds / (24 * 60 * 60));
    const hours: number = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
    const minutes: number = Math.floor((seconds % (60 * 60)) / 60);
    const secs: number = seconds % 60;

    return writeInDateDisplayLanguage(
      (): string => {
        return this.getEnglishDaysHoursMinutesAndSeconds({
          days,
          hours,
          minutes,
          secs,
        });
      },
      (_language: string, locale: string): string | null => {
        // "2 Tage, 3 Stunden, 4 Minuten und 5 Sekunden".
        const parts: Array<DurationTextPart> = [
          { count: days, unit: "day" as const },
          { count: hours, unit: "hour" as const },
          { count: minutes, unit: "minute" as const },
          { count: secs, unit: "second" as const },
        ].filter((part: DurationTextPart): boolean => {
          return part.count > 0;
        });

        return parts.length > 0
          ? this.formatLocalizedDuration(parts, locale, "long", "long")
          : null;
      },
    );
  }

  // convertSecondsToDaysHoursMinutesAndSeconds's English, word for word.
  private static getEnglishDaysHoursMinutesAndSeconds(data: {
    days: number;
    hours: number;
    minutes: number;
    secs: number;
  }): string {
    const { days, hours, minutes, secs } = data;

    let formattedString: string = "";

    if (days > 0) {
      formattedString += `${days}${NO_BREAK_SPACE}days`;
    }

    if (hours > 0) {
      if (formattedString.length > 0) {
        formattedString += ", ";
      }

      formattedString += `${hours}${NO_BREAK_SPACE}hours`;
    }

    if (minutes > 0) {
      if (formattedString.length > 0) {
        formattedString += ", ";
      }

      formattedString += `${minutes}${NO_BREAK_SPACE}minutes`;
    }

    if (secs > 0) {
      if (formattedString.length > 0) {
        formattedString += ", ";
      }

      formattedString += `${secs}${NO_BREAK_SPACE}seconds`;
    }

    return formattedString;
  }

  public static convertMinutesToDaysHoursAndMinutes(minutes: number): string {
    // should output 2 days, 3 hours and 4 minutes. If the days are 0, it should not show the days. If the hours are 0, it should not show the hours. If the minutes are 0, it should not show the minutes.

    const days: number = Math.floor(minutes / (24 * 60));
    const hours: number = Math.floor((minutes % (24 * 60)) / 60);
    const mins: number = minutes % 60;

    return writeInDateDisplayLanguage(
      (): string => {
        return this.getEnglishDaysHoursAndMinutes({ days, hours, mins });
      },
      (_language: string, locale: string): string | null => {
        // "2 Tage, 3 Stunden und 0 Minuten": the minutes are always said.
        const parts: Array<DurationTextPart> = [
          { count: days, unit: "day" as const },
          { count: hours, unit: "hour" as const },
        ].filter((part: DurationTextPart): boolean => {
          return part.count > 0;
        });

        if (mins >= 0) {
          parts.push({ count: mins, unit: "minute" });
        }

        return this.formatLocalizedDuration(parts, locale, "long", "long");
      },
    );
  }

  // convertMinutesToDaysHoursAndMinutes's English, word for word.
  private static getEnglishDaysHoursAndMinutes(data: {
    days: number;
    hours: number;
    mins: number;
  }): string {
    const { days, hours, mins } = data;

    let formattedString: string = "";

    if (days > 0) {
      formattedString += `${days}${NO_BREAK_SPACE}days`;
    }

    if (hours > 0) {
      if (formattedString.length > 0) {
        formattedString += ", ";
      }

      formattedString += `${hours}${NO_BREAK_SPACE}hours`;
    }

    if (mins >= 0) {
      if (formattedString.length > 0) {
        formattedString += ", ";
      }

      formattedString += `${mins}${NO_BREAK_SPACE}minutes`;
    }

    return formattedString;
  }

  /*
   * "1.72 s", "960 ms", "2h 5m".
   *
   * Handed the reader's Translator, every language writes it its own way
   * (#8617): the Dashboard's spaced units ("1,72 Sek.", "۹۶۰ میلی‌ثانیه";
   * formatMilliseconds and formatDurationInUnit) and its compact keys for a
   * longer one ("2 Std. 5 Min.", "۲ ساعت ۵ دقیقه"; formatCompactDuration),
   * each figure the reader's, remembered with its English for a sentence
   * the language has not worded yet. English reads exactly as it always did.
   *
   * Without one - the server, a caller that has no reader - the unit
   * symbols stay English and only the figure follows the date display
   * language ("1,72 s" in German).
   */
  public static getHumanizedDurationFromNanoseconds(data: {
    nanoseconds: number;
    maxParts?: number;
    translator?: Translator | undefined;
  }): string {
    const english: string = this.getEnglishHumanizedDuration(data);

    if (data.translator) {
      if (isEnglishDateLanguage(data.translator.language)) {
        return english;
      }

      const localized: string = this.writeHumanizedDuration(
        this.readHumanizedDuration(data),
        data.translator,
      );

      if (localized !== english) {
        rememberEnglishOf(localized, (): string => {
          return english;
        });
      }

      return localized;
    }

    return writeInDateDisplayLanguage(
      (): string => {
        return english;
      },
      (_language: string, locale: string): string | null => {
        return this.withDecimalSeparatorOf(english, locale);
      },
    );
  }

  // `text`'s decimal points as `locale` writes them: "1.72 s" -> "1,72 s".
  private static withDecimalSeparatorOf(text: string, locale: string): string {
    const separator: string = (
      formatDecimal({ value: 1.5, locale, maximumFractionDigits: 1 }) || "1.5"
    ).replace(DIGITS, "");

    if (!separator || separator === ".") {
      return text;
    }

    return text.replace(DURATION_DECIMAL_POINT, `$1${separator}$2`);
  }

  /*
   * getHumanizedDurationFromNanoseconds's English, as it always read, each
   * figure held to its unit by a no-break space ("12 ms", "5 ns"), as the
   * other languages' are, so a span's narrow cell never ends a line with
   * "12" and starts the next with "ms" (#8826).
   */
  private static getEnglishHumanizedDuration(data: {
    nanoseconds: number;
    maxParts?: number;
  }): string {
    const reading: HumanizedDurationReading = this.readHumanizedDuration(data);

    if (reading.kind === "unknown") {
      return "-";
    }

    if (reading.kind === "zero") {
      return `0${NO_BREAK_SPACE}ms`;
    }

    const sign: string = reading.isNegative ? "-" : "";

    if (reading.kind === "compact") {
      // "2h 5m", "1m 5.5s": each unit's letter right after its count.
      return reading.parts
        .map(
          (
            part: { unit: CompactDurationUnit; value: number },
            index: number,
          ): string => {
            const count: string =
              part.unit === "seconds"
                ? OneUptimeDate.formatDurationValue(part.value)
                : part.value.toString();
            const letter: string =
              HUMANIZED_DURATION_UNITS.find(
                (unit: { unit: CompactDurationUnit }): boolean => {
                  return unit.unit === part.unit;
                },
              )?.english || "";

            return `${index === 0 ? sign : ""}${count}${letter}`;
          },
        )
        .join(" ");
    }

    if (reading.kind === "nanosecond") {
      return `${sign}${reading.value.toString()}${NO_BREAK_SPACE}ns`;
    }

    const symbol: string =
      reading.kind === "microsecond"
        ? "μs"
        : reading.kind === "millisecond"
          ? "ms"
          : "s";

    return `${sign}${OneUptimeDate.formatDurationValue(reading.value)}${NO_BREAK_SPACE}${symbol}`;
  }

  /*
   * How long `nanoseconds` is, as the humanized duration says it: under a
   * microsecond in nanoseconds, then in microseconds, milliseconds and
   * seconds, and from a minute up in at most `maxParts` of days, hours,
   * minutes and seconds - the seconds keeping their fraction ("1m 5.5s").
   */
  private static readHumanizedDuration(data: {
    nanoseconds: number;
    maxParts?: number;
  }): HumanizedDurationReading {
    const maxParts: number = data.maxParts ?? 2;

    if (!Number.isFinite(data.nanoseconds)) {
      return { kind: "unknown" };
    }

    if (data.nanoseconds === 0) {
      return { kind: "zero" };
    }

    const isNegative: boolean = data.nanoseconds < 0;
    const nanoseconds: number = Math.abs(data.nanoseconds);

    if (nanoseconds < 1000) {
      return {
        kind: "nanosecond",
        isNegative,
        value: Math.round(nanoseconds),
      };
    }

    const microseconds: number = nanoseconds / 1000;
    if (microseconds < 1000) {
      return { kind: "microsecond", isNegative, value: microseconds };
    }

    const milliseconds: number = nanoseconds / 1000000;
    if (milliseconds < 1000) {
      return { kind: "millisecond", isNegative, value: milliseconds };
    }

    const seconds: number = nanoseconds / 1000000000;

    if (seconds < 60) {
      return { kind: "second", isNegative, value: seconds };
    }

    let remainingSeconds: number = Math.floor(seconds);
    const parts: Array<{ unit: CompactDurationUnit; value: number }> = [];

    for (const unit of HUMANIZED_DURATION_UNITS) {
      if (parts.length >= maxParts) {
        break;
      }

      if (remainingSeconds < unit.seconds) {
        continue;
      }

      const value: number = Math.floor(remainingSeconds / unit.seconds);

      if (value > 0) {
        parts.push({ unit: unit.unit, value });
        remainingSeconds -= value * unit.seconds;
      }
    }

    const fractionalSeconds: number = seconds - Math.floor(seconds);
    const leftoverSeconds: number = remainingSeconds + fractionalSeconds;
    const last: { unit: CompactDurationUnit; value: number } | undefined =
      parts[parts.length - 1];

    if (leftoverSeconds > 0) {
      if (!last) {
        parts.push({ unit: "seconds", value: leftoverSeconds });
      } else if (last.unit === "seconds") {
        last.value += leftoverSeconds;
      } else if (parts.length < maxParts) {
        parts.push({ unit: "seconds", value: leftoverSeconds });
      }
    }

    if (parts.length === 0) {
      return { kind: "second", isNegative, value: seconds };
    }

    return { kind: "compact", isNegative, parts: parts.slice(0, maxParts) };
  }

  /*
   * A humanized duration in the reader's language: the Dashboard's spaced
   * units for one unit, its compact keys for several, each figure the
   * reader's, with the decimals the English writes (two, trailing zeros
   * dropped, and none from a hundred up).
   */
  private static writeHumanizedDuration(
    reading: HumanizedDurationReading,
    translator: Translator,
  ): string {
    if (reading.kind === "unknown") {
      return "-";
    }

    if (reading.kind === "zero") {
      return formatMilliseconds(translator, 0);
    }

    const signed: (value: number) => number = (value: number): number => {
      return reading.isNegative ? -value : value;
    };

    if (reading.kind === "compact") {
      const duration: CompactDuration = {};

      reading.parts.forEach(
        (
          part: { unit: CompactDurationUnit; value: number },
          index: number,
        ): void => {
          duration[part.unit] = index === 0 ? signed(part.value) : part.value;
        },
      );

      return formatCompactDuration(translator, duration, {
        decimals: 2,
        dropTrailingZeros: true,
      });
    }

    if (reading.kind === "nanosecond") {
      return formatDurationInUnit(
        translator,
        signed(reading.value),
        "nanosecond",
        { decimals: 0 },
      );
    }

    const decimals: number = reading.value >= 100 ? 0 : 2;

    if (reading.kind === "millisecond") {
      return formatMilliseconds(translator, signed(reading.value), {
        maximumFractionDigits: decimals,
      });
    }

    return formatDurationInUnit(
      translator,
      signed(reading.value),
      reading.kind,
      { decimals, dropTrailingZeros: true },
    );
  }

  private static formatDurationValue(value: number): string {
    const abs: number = Math.abs(value);

    if (abs >= 100) {
      return Math.round(value).toString();
    }

    const decimalPlaces: number = 2;
    const fixed: string = value.toFixed(decimalPlaces);
    return fixed.replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
  }

  public static getGmtOffsetByTimezone(timezone: Timezone): number {
    return moment.tz(timezone).utcOffset();
  }

  public static getGmtOffsetFriendlyStringByTimezone(
    timezone: Timezone,
  ): string {
    const offset: number = this.getGmtOffsetByTimezone(timezone);
    return this.getGmtOffsetFriendlyString(offset) + " " + timezone;
  }

  public static isValidDateString(date: string): boolean {
    return moment(date).isValid();
  }

  public static getGmtOffsetFriendlyString(offset: number): string {
    const hours: number = Math.abs(offset) / 60;
    const minutes: number = Math.abs(offset) % 60;

    let formattedString: string = "GMT";

    if (offset < 0) {
      formattedString += "-";
    } else {
      formattedString += "+";
    }

    // remove decimals from hours
    formattedString += Math.floor(hours);

    if (minutes > 0) {
      formattedString += ":" + minutes;
    }

    return formattedString;
  }

  public static getDateAsFormattedArrayInMultipleTimezones(data: {
    date: string | Date;
    onlyShowDate?: boolean | undefined;
    timezones?: Array<Timezone> | undefined;
    use12HourFormat?: boolean | undefined;
  }): Array<string> {
    let date: string | Date = data.date;
    const onlyShowDate: boolean | undefined = data.onlyShowDate;
    let timezones: Array<Timezone> | undefined = data.timezones;
    const use12HourFormat: boolean =
      data.use12HourFormat ?? this.getUserPrefers12HourFormat();

    date = this.fromString(date);

    const formatstring: string = this.getEnglishLongDateFormat({
      onlyShowDate,
      use12HourFormat,
    });

    const timezoneDates: Array<string> = [];

    if (!timezones || timezones.length === 0) {
      /*
       * Use IANA region zones (not fixed-offset zones like "EST") so the
       * abbreviation reflects DST at the event's date — e.g. EST/EDT for
       * America/New_York and GMT/BST for Europe/London.
       */
      timezones = [
        Timezone.UTC,
        Timezone.EuropeLondon,
        Timezone.AmericaNew_York,
        Timezone.AmericaLos_Angeles,
        Timezone.AsiaKolkata,
        Timezone.AustraliaSydney,
      ]; // default timezones.
    }

    const instant: Date = date;

    for (let i: number = 0; i < timezones.length; i++) {
      const timezone: Timezone = timezones[i] as Timezone;

      timezoneDates.push(
        writeInDateDisplayLanguage(
          (): string => {
            return (
              moment(instant).tz(timezone.toString()).format(formatstring) +
              " " +
              (onlyShowDate
                ? ""
                : this.getZoneAbbrByTimezone(timezone, instant))
            ).trim();
          },
          (language: string, locale: string): string | null => {
            const text: string | null = this.getLocalizedDateText({
              date: instant,
              language,
              locale,
              shape: {
                onlyShowDate,
                use12HourFormat,
              },
              timezones: this.getTimezoneNames(timezone),
            });

            if (!text || onlyShowDate) {
              return text;
            }

            return `${text} ${this.getZoneInLocale(
              this.getZoneAbbrByTimezone(timezone, instant),
              locale,
            )}`;
          },
        ),
      );
    }

    return timezoneDates;
  }

  public static getDateAsFormattedHTMLInMultipleTimezones(data: {
    date: string | Date;
    onlyShowDate?: boolean;
    timezones?: Array<Timezone> | undefined; // if skipped, defaults to UTC, Europe/London, America/New_York, America/Los_Angeles, Asia/Kolkata, Australia/Sydney (DST-aware)
    use12HourFormat?: boolean | undefined;
  }): string {
    const date: string | Date = data.date;
    const onlyShowDate: boolean | undefined = data.onlyShowDate;
    const timezones: Array<Timezone> | undefined = data.timezones;
    const use12HourFormat: boolean | undefined = data.use12HourFormat;

    return this.getDateAsFormattedArrayInMultipleTimezones({
      date,
      onlyShowDate,
      timezones,
      use12HourFormat,
    }).join("<br/>");
  }

  public static getDateAsFormattedStringInMultipleTimezones(data: {
    date: string | Date;
    onlyShowDate?: boolean | undefined;
    timezones?: Array<Timezone> | undefined; // if skipped, defaults to UTC, Europe/London, America/New_York, America/Los_Angeles, Asia/Kolkata, Australia/Sydney (DST-aware)
    use12HourFormat?: boolean | undefined;
  }): string {
    const date: string | Date = data.date;
    const onlyShowDate: boolean | undefined = data.onlyShowDate;
    const timezones: Array<Timezone> | undefined = data.timezones;
    const use12HourFormat: boolean | undefined = data.use12HourFormat;

    return this.getDateAsFormattedArrayInMultipleTimezones({
      date,
      onlyShowDate,
      timezones,
      use12HourFormat,
    }).join("\n");
  }

  public static getDateAsLocalFormattedString(
    date: string | Date,
    onlyShowDate?: boolean,
    use12HourFormat?: boolean,
    showSeconds?: boolean,
  ): string {
    return this.writeLocalLongDate({
      date: this.fromString(date),
      onlyShowDate,
      use12HourFormat,
      showSeconds,
      showZone: !onlyShowDate,
    });
  }

  /*
   * A moment in full in the current timezone: "Nov 5, 2025, 5:14 AM PST",
   * "5. Nov. 2025, 05:14 PST", "2025年11月5日 5:14 PST" - the day without a
   * zero in every language, as English now writes it (#7652) - with the
   * zone's name at that moment, or without it.
   */
  private static writeLocalLongDate(data: {
    date: Date;
    onlyShowDate?: boolean | undefined;
    use12HourFormat?: boolean | undefined;
    showSeconds?: boolean | undefined;
    showZone: boolean;
  }): string {
    const instant: Date = data.date;
    const formatstring: string = this.getEnglishLongDateFormat(data);

    /*
     * The abbreviation has to describe THIS date's offset, not today's. Asking
     * for it without the date labelled every January timestamp "EDT" all
     * summer — a wall clock paired with the wrong zone names a different
     * instant, which is worse than printing no zone at all.
     */
    const zoneAbbr: string = data.showZone
      ? this.getZoneAbbrByTimezone(this.getCurrentTimezone(), instant)
      : "";

    return writeInDateDisplayLanguage(
      (): string => {
        const momentDate: moment.Moment = this.inCurrentTimezone(instant);

        return (momentDate.format(formatstring) + " " + zoneAbbr).trim();
      },
      (language: string, locale: string): string | null => {
        // "6. Okt. 2026, 10:05 BST", "2026年10月6日 10:05 BST".
        const text: string | null = this.getLocalizedDateText({
          date: instant,
          language,
          locale,
          shape: {
            onlyShowDate: data.onlyShowDate,
            showSeconds: data.showSeconds,
            use12HourFormat: data.use12HourFormat,
          },
        });

        return text
          ? `${text} ${this.getZoneInLocale(zoneAbbr, locale)}`.trim()
          : null;
      },
    );
  }

  /*
   * A WINDOW'S TWO ENDS, ITS DAY AND ITS ZONE SAID ONCE (#7281, #7721).
   *
   * A window was written as its two ends in full, so one within a day said
   * its date twice, and a filter's chip its zone twice as well: "Nov 13
   * 2026, 09:00 GMT+08 and Nov 13 2026, 17:30 GMT+08", three lines on a
   * phone. When both ends fall on one day of the current timezone, in one
   * zone name, the end is its time alone: "Nov 5, 2025, 5:14 AM" to "6:14
   * AM". The day is written once, with the start, and the zone - where the
   * window shows one - once, after the end: "17:30 GMT+08". Across
   * midnight, or across a change of the clocks within the day ("1:30 AM
   * PDT" to "1:30 AM PST"), each end is written whole.
   *
   * Each end is written as a single moment is - the language's words,
   * order, digits and clock - so the end's time reads exactly as the
   * start's does. Intl's own formatRange was no help: it writes its own
   * shapes ("2025/11/5 5時14分～6時14分" in Japanese) and drops a 24-hour
   * time's zero in Spanish and Persian.
   *
   * `style` "short" is the time range button's shape (no zone, the year
   * only with showYear); "long" a sentence's (the year and the zone).
   */
  public static getLocalDateTimeRangeEnds(data: {
    start: Date | string;
    end: Date | string;
    style: "short" | "long";
    showYear?: boolean | undefined;
    use12HourFormat?: boolean | undefined;
  }): { start: string; end: string; isWithinOneDay: boolean } {
    const start: Date = this.fromString(data.start);
    const end: Date = this.fromString(data.end);
    const use12HourFormat: boolean =
      data.use12HourFormat ?? this.getUserPrefers12HourFormat();
    const isLong: boolean = data.style === "long";
    const timezone: Timezone = this.getCurrentTimezone();

    const isWithinOneDay: boolean =
      this.inCurrentTimezone(start).format("YYYY-MM-DD") ===
        this.inCurrentTimezone(end).format("YYYY-MM-DD") &&
      (!isLong ||
        this.getZoneAbbrByTimezone(timezone, start) ===
          this.getZoneAbbrByTimezone(timezone, end));

    const writeWhole: (date: Date, showZone: boolean) => string = (
      date: Date,
      showZone: boolean,
    ): string => {
      return isLong
        ? this.writeLocalLongDate({
            date: date,
            use12HourFormat: use12HourFormat,
            showZone: showZone,
          })
        : this.getDateAsLocalShortDateTimeString(date, {
            use12HourFormat: use12HourFormat,
            showYear: data.showYear,
          });
    };

    if (!isWithinOneDay) {
      return {
        start: writeWhole(start, isLong),
        end: writeWhole(end, isLong),
        isWithinOneDay: false,
      };
    }

    // The end's time, in whichever language it is asked for in.
    const endTime: () => string = (): string => {
      return this.getLocalTimeString(end, {
        use12HourFormat: use12HourFormat,
      });
    };

    if (!isLong) {
      return {
        start: writeWhole(start, false),
        end: endTime(),
        isWithinOneDay: true,
      };
    }

    const zoneAbbr: string = this.getZoneAbbrByTimezone(timezone, end);

    return {
      start: writeWhole(start, false),
      end: writeInDateDisplayLanguage(
        (): string => {
          return `${endTime()} ${zoneAbbr}`;
        },
        (_language: string, locale: string): string => {
          return `${endTime()} ${this.getZoneInLocale(zoneAbbr, locale)}`;
        },
      ),
      isWithinOneDay: true,
    };
  }

  public static getDayInSeconds(days?: number | undefined): number {
    if (!days) {
      days = 1;
    }
    return 24 * 60 * 60 * days;
  }

  /*
   * A zone's name after a date written in `locale`, in the digits the date
   * is in: "۲۶ اکتبر ۲۰۲۶، ۱۸:۳۷ GMT+۰۳۳۰" on a Persian page, where the
   * offset stood in Latin digits beside a date in Persian ones. A name of
   * letters only ("BST", "EDT") and every language that writes Latin digits
   * keep it as it is.
   */
  private static getZoneInLocale(zone: string, locale: string): string {
    return writeDigitsInLocale(zone, locale);
  }

  public static getCurrentTimezoneString(): string {
    return this.getZoneAbbrByTimezone(this.getCurrentTimezone());
  }

  public static getZoneAbbrByTimezone(
    timezone: Timezone,
    date?: string | Date | undefined,
  ): string {
    /*
     * Pass the reference date into moment so the abbreviation reflects DST
     * at that date (e.g. EST in winter, EDT in summer) rather than "now".
     * The one writer of a zone's name: Intl's formatters name theirs with
     * it too (DateLanguage's getDateTimeFormat, #10038).
     */
    return getZoneAbbreviation(
      timezone.toString(),
      date ? this.fromString(date) : new Date(),
    );
  }

  /**
   * Set the timezone the signed-in user picked in User Settings. Once set,
   * every "local" helper below resolves wall-clock times in THIS zone instead
   * of the zone the browser reports, so what the user reads and types matches
   * the timezone they configured — even when the machine, OS or VPN they are
   * on reports a different one. Pass null to fall back to the browser zone
   * (signed-out surfaces, or a user who has not picked a timezone).
   *
   * A legacy name is kept as its current name ("Asia/Calcutta" as
   * "Asia/Kolkata" — see TimezoneAlias), which is the name the picker
   * offers and the one getUserTimezone reports.
   */
  public static setUserTimezone(timezone: Timezone | null | undefined): void {
    if (!timezone || typeof timezone !== "string") {
      this.userTimezone = null;
      return;
    }

    /*
     * Translate before checking with moment. The saved value can be one an
     * older build cached in the browser, and one of those, US/Pacific-New,
     * has been removed from tzdata: moment no longer resolves it, but it is
     * still Los Angeles, not a reason to drop the user's zone.
     */
    const currentTimezone: Timezone =
      TimezoneAlias.getCanonicalTimezone(timezone);

    /*
     * Ignore anything moment does not recognise as an IANA zone. A stale or
     * corrupt saved value must not take every date in the UI down with it.
     */
    if (!moment.tz.zone(currentTimezone.toString())) {
      this.userTimezone = null;
      return;
    }

    this.userTimezone = currentTimezone;
  }

  public static getUserTimezone(): Timezone | null {
    return this.userTimezone;
  }

  /**
   * The zone every "local" helper reads: the user's own, else the one the
   * browser / process reports, in its current name. Chromium reports the
   * ICU spelling of many zones (Asia/Calcutta, Europe/Kiev, Asia/Saigon),
   * and this guess is what the dashboard saves to a new user's profile and
   * pre-selects in the on-call schedule pickers — neither of which offers
   * the legacy name. Called on every date format, so it stays a lookup:
   * moment caches its guess, and the translation is a map read.
   */
  public static getCurrentTimezone(): Timezone {
    return this.userTimezone || this.getRuntimeTimezone();
  }

  /*
   * The zone the browser (or the process) is in, in its current name:
   * moment's guess, kept for each guess it gives, so this stays a lookup.
   *
   * moment trusts the zone Intl names only when its name is longer than
   * three letters, so in a browser on UTC - Intl's "UTC" - it guessed from
   * the offsets instead, and named Africa/Abidjan: zones read "GMT" (and
   * "GMT+0" in German), a new user's profile was saved with Abidjan, and
   * an Ask AI chart said "Days are in Africa/Abidjan." of a reader on UTC
   * (issue #8475). Where Intl names such a zone, the Timezone list names it
   * and moment's guess keeps its clock (the same offset now and half a year
   * on), the zone is Intl's.
   */
  private static runtimeTimezoneOfGuess: {
    guess: string;
    timezone: Timezone;
  } | null = null;

  private static getRuntimeTimezone(): Timezone {
    const guess: string = moment.tz.guess();

    if (this.runtimeTimezoneOfGuess?.guess === guess) {
      return this.runtimeTimezoneOfGuess.timezone;
    }

    const timezone: Timezone = TimezoneAlias.getCanonicalTimezone(
      this.getShortIntlTimezoneFor(guess) || guess,
    );

    this.runtimeTimezoneOfGuess = { guess, timezone };

    return timezone;
  }

  // Intl's name for the runtime's zone, when moment passed it over for `guess`.
  private static getShortIntlTimezoneFor(guess: string): string | undefined {
    let intlName: string | undefined = undefined;

    try {
      intlName = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }

    if (
      !intlName ||
      intlName === guess ||
      intlName.length > 3 ||
      !TimezoneAlias.isListedName(intlName)
    ) {
      return undefined;
    }

    const intlZone: moment.MomentZone | null = moment.tz.zone(intlName);
    const guessedZone: moment.MomentZone | null = moment.tz.zone(guess);

    if (!intlZone || !guessedZone) {
      return undefined;
    }

    const nowMs: number = Date.now();

    for (const ms of [nowMs, nowMs + 182 * 24 * 60 * 60 * 1000]) {
      if (intlZone.utcOffset(ms) !== guessedZone.utcOffset(ms)) {
        return undefined;
      }
    }

    return intlName;
  }

  /**
   * The instant `date` viewed through the current timezone — the single place
   * that decides which wall clock the "local" helpers below read from.
   */
  private static inCurrentTimezone(date: Date | string): moment.Moment {
    return moment(this.fromString(date)).tz(this.getCurrentTimezone());
  }

  public static getDateString(date: Date): string {
    date = this.fromString(date);
    return this.getDateAsLocalFormattedString(date, true);
  }

  public static isInThePast(date: string | Date): boolean {
    date = this.fromString(date);
    return moment(date).isBefore(new Date(), "seconds");
  }

  public static isInTheFuture(date: string | Date): boolean {
    date = this.fromString(date);
    return moment(date).isAfter(new Date(), "seconds");
  }

  public static fromString(date: string | JSONObject | Date): Date {
    if (date instanceof Date) {
      return date;
    }

    if (typeof date === "string") {
      const trimmedDate: string = date.trim();

      if (this.isUtcDateTimeString(trimmedDate)) {
        return moment
          .utc(this.normalizeUtcDateTimeString(trimmedDate))
          .toDate();
      }

      /*
       * moment.js throws on non-ISO formats like TLS cert dates ("Mar 31 00:00:00 2026 GMT").
       * Fall back to native Date which handles this format correctly.
       */
      try {
        return moment(trimmedDate).toDate();
      } catch {
        return new Date(trimmedDate);
      }
    }

    if (
      date &&
      date["value"] &&
      typeof date["value"] === "string" &&
      date["_type"] &&
      (date["_type"] === "Date" || date["_type"] === "DateTime")
    ) {
      return moment(date["value"]).toDate();
    }

    throw new BadDataException(
      "Invalid date: " + refusedValue(date?.toString()),
    );
  }

  public static asDateForDatabaseQuery(date: string | Date): string {
    const formatstring: string = "YYYY-MM-DD";
    return this.inCurrentTimezone(date).format(formatstring);
  }

  public static asFilterDateForDatabaseQuery(
    date: string | Date,
  ): InBetween<Date> {
    date = this.fromString(date);
    const formattedDate: Date = moment(date).toDate();
    return new InBetween(
      OneUptimeDate.getStartOfDay(formattedDate),
      OneUptimeDate.getEndOfDay(formattedDate),
    );
  }

  public static getDateWithCustomTime(data: {
    hours: number;
    minutes: number;
    seconds: number;
  }): Date {
    const hour: number = data.hours;
    const minutes: number = data.minutes;
    const seconds: number = data.seconds;

    //validate the hour
    if (hour < 0 || hour > 23) {
      throw new BadDataException("Invalid hour");
    }

    //validate the minutes
    if (minutes < 0 || minutes > 59) {
      throw new BadDataException("Invalid minutes");
    }

    //validate the seconds
    if (seconds < 0 || seconds > 59) {
      throw new BadDataException("Invalid seconds");
    }

    /*
     * The hour/minute the user picked is a wall-clock reading in THEIR
     * timezone, so anchor it to today's date in that zone rather than setting
     * it on a browser-local Date.
     */
    return this.inCurrentTimezone(OneUptimeDate.getCurrentDate())
      .set({
        hour: hour,
        minute: minutes,
        second: seconds,
        millisecond: 0,
      })
      .toDate();
  }

  public static toDatabaseDate(date: Date): string {
    date = this.fromString(date);
    return moment(date).format("YYYY-MM-DD HH:mm:ss");
  }

  public static resetSecondsAndMilliseconds(date: Date): Date {
    date = this.fromString(date);
    date.setSeconds(0);
    date.setMilliseconds(0);
    return date;
  }

  /*
   * Hand-rolled UTC "YYYY-MM-DD HH:mm:ss" formatter. The two Clickhouse
   * formatters below run several times per ingested log / span / metric
   * datapoint — millions of calls per minute on a busy worker — and a
   * moment() wrapper plus format-token parsing per call is roughly an order
   * of magnitude more expensive than reading the UTC fields directly.
   * Output is byte-identical to moment's, including the "Invalid date"
   * sentinel for NaN dates.
   *
   * The text depends on nothing but the second the date falls in, and the
   * rows of one telemetry batch fall in a handful of seconds - a data
   * point's time and its start time, a span's start and end - so the text
   * of recent seconds is kept (CLICKHOUSE_DATE_TIME_MEMO_SLOTS): a second
   * already written is read back instead of formatted again.
   */
  private static formatUtcClickhouseDateTime(date: Date): string {
    const epochMs: number = date.getTime();

    if (Number.isNaN(epochMs)) {
      return "Invalid date";
    }

    // Floored, so an instant before 1970 keeps the second it falls in.
    const epochSecond: number = Math.floor(epochMs / 1000);

    /*
     * The slot only decides where a second is kept; a read checks the second
     * itself, so two seconds sharing a slot never read each other's text.
     */
    const slot: number = epochSecond & (CLICKHOUSE_DATE_TIME_MEMO_SLOTS - 1);

    if (clickhouseDateTimeMemoSeconds[slot] === epochSecond) {
      return clickhouseDateTimeMemoTexts[slot] as string;
    }

    const year: string = String(date.getUTCFullYear()).padStart(4, "0");
    const month: string = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day: string = String(date.getUTCDate()).padStart(2, "0");
    const hours: string = String(date.getUTCHours()).padStart(2, "0");
    const minutes: string = String(date.getUTCMinutes()).padStart(2, "0");
    const seconds: string = String(date.getUTCSeconds()).padStart(2, "0");

    const text: string = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

    clickhouseDateTimeMemoSeconds[slot] = epochSecond;
    clickhouseDateTimeMemoTexts[slot] = text;

    return text;
  }

  public static toClickhouseDateTime(date: Date | string): string {
    const parsedDate: Date = this.fromString(date);
    return this.formatUtcClickhouseDateTime(parsedDate);
  }

  /*
   * `nanoTimestamp` is the time in whole nanoseconds since the epoch, and
   * the fraction is read from it rather than from the Date's milliseconds:
   *
   *   - digits (ExactUnixNano.nano): their last nine, exactly. Pass the Date
   *     read from the same digits (readExactUnixNano), so the second and the
   *     fraction agree. A float's fraction cannot go with that Date: for a
   *     time up to 128 ns before a whole second the float is that second, so
   *     its fraction reads .000000000 while the exact Date is still in the
   *     second before - a second early.
   *   - a number: its remainder in a second, as exact as the float is. Pass
   *     the Date made from the same float (fromUnixNano), as before.
   *   - absent, zero or below: the Date's milliseconds.
   */
  public static toClickhouseDateTime64(
    date: Date | string,
    nanoTimestamp?: number | string,
  ): string {
    const parsedDate: Date = this.fromString(date);
    const base: string = this.formatUtcClickhouseDateTime(parsedDate);

    let nanoFraction: string;

    if (typeof nanoTimestamp === "string") {
      nanoFraction = nanoTimestamp.slice(-9).padStart(9, "0");
    } else if (nanoTimestamp !== undefined && nanoTimestamp > 0) {
      // Extract sub-second nanoseconds from the unix nano timestamp
      const subSecondNanos: number = nanoTimestamp % 1_000_000_000;
      nanoFraction = subSecondNanos.toString().padStart(9, "0");
    } else {
      // Fall back to milliseconds from the Date object
      const ms: number = parsedDate.getMilliseconds();
      nanoFraction = (ms * 1_000_000).toString().padStart(9, "0");
    }

    return `${base}.${nanoFraction}`;
  }
}
