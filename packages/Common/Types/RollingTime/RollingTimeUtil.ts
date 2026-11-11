import InBetween from "../BaseDatabase/InBetween";
import OneUptimeDate from "../Date";
import RollingTime from "./RollingTime";

const MINUTES_IN_A_DAY: number = 24 * 60;

/*
 * How long each rolling time's window is, in minutes. A Record over the
 * enum, so a rolling time added without a length does not compile: a value
 * this did not know read as a window of no length at all, which finds no
 * data on any check.
 *
 * Days are fixed lengths, 24 hours a day, not calendar days: in a zone
 * whose clocks change inside the window, N calendar days back is an hour
 * more or less than N days. Past 1, 3 and 7 Days and Past 180 Days sit
 * exactly on the edge of a bucket width (AggregationIntervalUtil), so in
 * London after the clocks went back on 2026-10-25 Past 3 Days was bucketed
 * by the hour instead of every 30 minutes - in the browser, and on any
 * server not in UTC - and getWindowInMs, which stepped back from
 * 1970-01-01, read Past 90 and 180 Days an hour long in New York.
 */
const WINDOW_IN_MINUTES: Record<RollingTime, number> = {
  [RollingTime.Past1Minute]: 1,
  [RollingTime.Past5Minutes]: 5,
  [RollingTime.Past10Minutes]: 10,
  [RollingTime.Past15Minutes]: 15,
  [RollingTime.Past30Minutes]: 30,
  [RollingTime.Past1Hour]: 60,
  [RollingTime.Past2Hours]: 2 * 60,
  [RollingTime.Past3Hours]: 3 * 60,
  [RollingTime.Past6Hours]: 6 * 60,
  [RollingTime.Past12Hours]: 12 * 60,
  // "Past 1 Day": the key's name is older than its value.
  [RollingTime.Past1Hours]: MINUTES_IN_A_DAY,
  [RollingTime.Past2Days]: 2 * MINUTES_IN_A_DAY,
  [RollingTime.Past3Days]: 3 * MINUTES_IN_A_DAY,
  [RollingTime.Past7Days]: 7 * MINUTES_IN_A_DAY,
  [RollingTime.Past14Days]: 14 * MINUTES_IN_A_DAY,
  [RollingTime.Past30Days]: 30 * MINUTES_IN_A_DAY,
  [RollingTime.Past60Days]: 60 * MINUTES_IN_A_DAY,
  [RollingTime.Past90Days]: 90 * MINUTES_IN_A_DAY,
  [RollingTime.Past180Days]: 180 * MINUTES_IN_A_DAY,
  [RollingTime.Past365Days]: 365 * MINUTES_IN_A_DAY,
};

const ROLLING_TIMES: ReadonlyArray<RollingTime> = Object.values(RollingTime);

/*
 * The longest text read as a length of time. The longest way of writing
 * one ("previous 31536000 seconds", "P52W1DT0H0M0S") is a few dozen
 * characters; a longer text is not one, and is never handed to a pattern.
 */
const MAX_LENGTH_TEXT_LENGTH: number = 64;

/*
 * The enum's own name for Past 1 Day, "Past1Hours", whose words say an
 * hour. Whoever wrote it meant one or the other, and which is not for
 * OneUptime to guess: it reads as neither.
 */
const KEY_NAME_THAT_SAYS_ANOTHER_LENGTH: string = "past1hours";

/*
 * A length written in words or short units - "15 minutes", "Past 15
 * Minutes", "last 15m", "15min", "24h", "past hour" - read from text that
 * is already lower case, with each run of spaces, dashes and underscores
 * one space. Anchored at both ends, with every repeat bounded, so it reads
 * in time in line with the text (as does ISO_8601_DURATION below) - and
 * it is never handed more than MAX_LENGTH_TEXT_LENGTH characters.
 */
const LENGTH_IN_WORDS: RegExp =
  /^(?:(past|last|previous) ?)?(\d{1,9}(?:\.\d{1,9})?)? ?([a-z]{1,7})$/;

/*
 * An ISO 8601 duration without years or months, which have no fixed
 * length: "PT15M", "PT1H", "P1D", "P1W", "PT24H". Read lower case. Each
 * part ends at its own letter.
 */
const ISO_8601_DURATION: RegExp =
  /^p(?:(\d{1,9})w)?(?:(\d{1,9})d)?(?:t(?:(\d{1,9})h)?(?:(\d{1,9})m)?(?:(\d{1,9})s)?)?$/;

// Each unit a length may be written in, in seconds.
const UNIT_IN_SECONDS: Record<string, number> = {
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  m: 60,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  h: 60 * 60,
  hr: 60 * 60,
  hrs: 60 * 60,
  hour: 60 * 60,
  hours: 60 * 60,
  d: 24 * 60 * 60,
  day: 24 * 60 * 60,
  days: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
  wk: 7 * 24 * 60 * 60,
  wks: 7 * 24 * 60 * 60,
  week: 7 * 24 * 60 * 60,
  weeks: 7 * 24 * 60 * 60,
};

// The units "past" or "last" may stand before with no number: "past hour".
const UNITS_WITHOUT_A_NUMBER: ReadonlyArray<string> = [
  "minute",
  "hour",
  "day",
  "week",
];

export default class RollingTimeUtil {
  public static getDefault(): RollingTime {
    return RollingTime.Past1Minute;
  }

  // Whether a value is a rolling time exactly as OneUptime writes it.
  public static isRollingTime(value: unknown): value is RollingTime {
    return ROLLING_TIMES.includes(value as RollingTime);
  }

  /*
   * The rolling time a value means, or null when it means none.
   *
   * A monitor's steps are stored as JSON, and the API, Terraform, MCP, a
   * workflow or an AI writing them can spell a rolling time its own way.
   * A Metrics monitor created through the MCP server stored "15 minutes":
   * nothing read it, so every check judged a window of no length, found
   * no data, and its no-data rule opened an alert on every run - while its
   * charts showed nothing in one place and data in another.
   *
   * Read here:
   *   - each rolling time as OneUptime writes it ("Past 15 Minutes"), in
   *     any case and spacing, with dashes or underscores between words;
   *   - a number and a unit, after "past", "last" or "previous" or not:
   *     "15 minutes", "15 mins", "15m", "last 15 minutes", "24h", "1 week";
   *   - "past" or "last" and a unit: "past hour", "last day";
   *   - an ISO 8601 duration: "PT15M", "PT1H", "P1D", "P1W".
   *
   * A length is read as the rolling time exactly as long: "60 minutes" is
   * Past 1 Hour, "24 hours" Past 1 Day, "2 weeks" Past 14 Days. A length
   * no rolling time is as long as ("20 minutes"), a month or a year (which
   * have no fixed length), a number with no unit, the enum's key name
   * "Past1Hours" (above), and anything else is null - for the caller to
   * refuse, or to read as the default.
   */
  public static fromValue(value: unknown): RollingTime | null {
    if (RollingTimeUtil.isRollingTime(value)) {
      return value;
    }

    if (typeof value !== "string") {
      return null;
    }

    const trimmed: string = value.trim();

    if (trimmed.length === 0 || trimmed.length > MAX_LENGTH_TEXT_LENGTH) {
      return null;
    }

    const text: string = trimmed
      .toLowerCase()
      .replace(/[\s_-]+/g, " ")
      .trim();

    if (text === KEY_NAME_THAT_SAYS_ANOTHER_LENGTH) {
      return null;
    }

    const lengthInSeconds: number | null =
      RollingTimeUtil.readIso8601Duration(text) ??
      RollingTimeUtil.readLengthInWords(text);

    if (lengthInSeconds === null) {
      return null;
    }

    return RollingTimeUtil.fromWindowInMs(Math.round(lengthInSeconds * 1000));
  }

  // The rolling time whose window is exactly this long, or null.
  public static fromWindowInMs(windowInMs: number): RollingTime | null {
    if (!Number.isFinite(windowInMs) || windowInMs <= 0) {
      return null;
    }

    return (
      ROLLING_TIMES.find((rollingTime: RollingTime): boolean => {
        return WINDOW_IN_MINUTES[rollingTime] * 60 * 1000 === windowInMs;
      }) || null
    );
  }

  /*
   * The rolling time a value means, or the default (Past 1 Minute) - the
   * window a step read with no rolling time has always had - when it means
   * none. Never a window of no length.
   */
  public static fromValueOrDefault(value: unknown): RollingTime {
    return RollingTimeUtil.fromValue(value) || RollingTimeUtil.getDefault();
  }

  /*
   * Every rolling time, quoted and listed for a sentence: "Past 1 Minute",
   * "Past 5 Minutes", ... or "Past 365 Days".
   */
  public static getValuesText(): string {
    const quoted: Array<string> = ROLLING_TIMES.map(
      (rollingTime: RollingTime): string => {
        return `"${rollingTime}"`;
      },
    );

    return `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
  }

  /*
   * The window a rolling time covers, ending now - or at `endDate` when a
   * caller needs it to end earlier (a telemetry check while OneUptime's
   * ingest queue is behind, issue #2825). A value that is no rolling time
   * covers the default's window (fromValueOrDefault), never one of no
   * length.
   */
  public static convertToStartAndEndDate(
    rollingTime: RollingTime,
    endDate: Date = OneUptimeDate.getCurrentDate(),
  ): InBetween<Date> {
    const startDate: Date = OneUptimeDate.addRemoveMinutes(
      endDate,
      -WINDOW_IN_MINUTES[RollingTimeUtil.fromValueOrDefault(rollingTime)],
    );

    return new InBetween(startDate, endDate);
  }

  // How long a rolling time's window is, in milliseconds.
  public static getWindowInMs(rollingTime: RollingTime): number {
    return (
      WINDOW_IN_MINUTES[RollingTimeUtil.fromValueOrDefault(rollingTime)] *
      60 *
      1000
    );
  }

  private static readIso8601Duration(text: string): number | null {
    const match: RegExpExecArray | null = ISO_8601_DURATION.exec(text);

    if (!match) {
      return null;
    }

    // Weeks, days, hours, minutes and seconds, in the order they are written.
    const partUnits: Array<number> = [
      UNIT_IN_SECONDS["week"]!,
      UNIT_IN_SECONDS["day"]!,
      UNIT_IN_SECONDS["hour"]!,
      UNIT_IN_SECONDS["minute"]!,
      UNIT_IN_SECONDS["second"]!,
    ];

    let lengthInSeconds: number = 0;
    let hasPart: boolean = false;

    partUnits.forEach((unitInSeconds: number, index: number): void => {
      const part: string | undefined = match[index + 1];

      if (part !== undefined) {
        hasPart = true;
        lengthInSeconds += Number(part) * unitInSeconds;
      }
    });

    // "P" or "PT" alone is no length, nor is a "T" with no time after it.
    const hasTimePart: boolean =
      match[3] !== undefined ||
      match[4] !== undefined ||
      match[5] !== undefined;

    if (!hasPart || (text.includes("t") && !hasTimePart)) {
      return null;
    }

    return lengthInSeconds;
  }

  private static readLengthInWords(text: string): number | null {
    const match: RegExpExecArray | null = LENGTH_IN_WORDS.exec(text);

    if (!match) {
      return null;
    }

    const lookBack: string | undefined = match[1];
    const count: string | undefined = match[2];
    const unit: string = match[3] as string;

    const unitInSeconds: number | undefined =
      Object.prototype.hasOwnProperty.call(UNIT_IN_SECONDS, unit)
        ? UNIT_IN_SECONDS[unit]
        : undefined;

    if (unitInSeconds === undefined) {
      return null;
    }

    if (count === undefined) {
      /*
       * "past hour" is an hour; "hour" alone, or "past h", is not
       * written as a length.
       */
      return lookBack && UNITS_WITHOUT_A_NUMBER.includes(unit)
        ? unitInSeconds
        : null;
    }

    return Number(count) * unitInSeconds;
  }
}
