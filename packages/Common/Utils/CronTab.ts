/**
 * CronTab
 *
 * A dependency-free, isomorphic (browser + server) helper for working with
 * standard cron expressions. It powers the workflow "Schedule" trigger picker
 * in the UI (human-readable descriptions + next-run previews + client-side
 * validation) and is safe to import from server code as well.
 *
 * Supported syntax (5 or 6 fields):
 *
 *   ┌───────────── second (0 - 59)      [optional, only when 6 fields]
 *   │ ┌─────────── minute (0 - 59)
 *   │ │ ┌───────── hour (0 - 23)
 *   │ │ │ ┌─────── day of month (1 - 31)
 *   │ │ │ │ ┌───── month (1 - 12 or JAN - DEC)
 *   │ │ │ │ │ ┌─── day of week (0 - 6 or SUN - SAT; 7 also means Sunday)
 *   │ │ │ │ │ │
 *   * * * * * *
 *
 * Each field supports: `*`, single values, `a-b` ranges, `a-b/step` and
 * `* / step` steps, and comma-separated lists of any of those.
 *
 * Notes on semantics (kept consistent with `cron-parser`, the library BullMQ
 * uses to actually fire the jobs):
 *  - Day-of-month and day-of-week are OR-ed together when BOTH are restricted
 *    (i.e. neither is `*`). When only one is restricted, only that one applies.
 *  - Next-run times are always computed and reported in UTC, because the
 *    workflow runner evaluates the pattern in the worker process timezone
 *    (UTC in production). Displaying UTC keeps the preview honest.
 */

export interface CronPreset {
  /*
   * In English: a key of the Dashboard's locales, which the picker's
   * dropdown looks up as it draws it.
   */
  label: string;
  value: string;
}

/*
 * Marks an English label as a key of the Dashboard's locales, so its
 * extractor (scripts/i18n/ExtractStrings.ts, which reads this file) finds
 * it - the same marker as Common/UI/Utils/TranslateTemplate's, kept here so
 * CronTab stays free of every dependency. It returns the text unchanged.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

/*
 * One field of a parsed expression, as parseFields hands it out: the values
 * it allows, sorted, and whether it was written as a bare "*" (which matters
 * for day of month and day of week, whose restrictions are OR-ed together
 * only when both are restricted).
 */
export interface CronFieldValues {
  readonly values: ReadonlyArray<number>;
  readonly isWildcard: boolean;
}

/*
 * A parsed expression, field by field, for code that matches it against a
 * clock of its own - a runbook schedule is matched against the wall clock of
 * its time zone (Types/Runbook/RunbookSchedule). Day of week is 0 (Sunday) -
 * 6 (Saturday), 7 already folded into 0; months are 1 - 12.
 */
export interface CronExpressionFields {
  readonly second: CronFieldValues;
  readonly minute: CronFieldValues;
  readonly hour: CronFieldValues;
  readonly dayOfMonth: CronFieldValues;
  readonly month: CronFieldValues;
  readonly dayOfWeek: CronFieldValues;
  // Six fields were given, the first being seconds.
  readonly hasSeconds: boolean;
}

/*
 * What a schedule's description says, before it is put in words: the shapes
 * CronTab describes as a sentence ("Every 5 minutes", "Every week on Monday
 * at 09:00 (UTC)"), each with its numbers. Common/Utils/CronScheduleText
 * words them in a reader's language; getHumanReadableDescription in English.
 * Any other schedule is "fieldByField": described one cron field at a time.
 * Hours and minutes are UTC; weekdays 0 (Sunday) - 6, months 1 - 12.
 */
export type CronScheduleShape =
  | { kind: "everyMinute" }
  | { kind: "everyMinutes"; step: number }
  | { kind: "everyHourOnTheHour" }
  // `step` 1 is every hour; `minute` 0 says no minute.
  | { kind: "everyHours"; step: number; minute: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekdays: Array<number>; hour: number; minute: number }
  // `monthStep` 1 is every month.
  | {
      kind: "monthly";
      daysOfMonth: Array<number>;
      monthStep: number;
      hour: number;
      minute: number;
    }
  | {
      kind: "yearly";
      daysOfMonth: Array<number>;
      months: Array<number>;
      hour: number;
      minute: number;
    }
  | { kind: "fieldByField" };

interface ParsedField {
  // Sorted, de-duplicated allowed values for this field.
  values: Array<number>;
  // Whether the field was a bare "*" (matters for day-of-month / day-of-week).
  isWildcard: boolean;
}

interface ParsedCron {
  second: ParsedField;
  minute: ParsedField;
  hour: ParsedField;
  dayOfMonth: ParsedField;
  month: ParsedField;
  dayOfWeek: ParsedField;
  hasSeconds: boolean;
}

/*
 * Matches a string of one or more ASCII digits. Kept as a named const so the
 * linter doesn't fight over wrapping an inline regex literal used with .test().
 */
const DIGITS_ONLY: RegExp = /^\d+$/;

const MONTH_NAMES: Array<string> = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const DAY_NAMES: Array<string> = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

const DAY_NAMES_LONG: Array<string> = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTH_NAMES_LONG: Array<string> = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default class CronTab {
  /**
   * Curated list of common schedules offered in the picker. Every value here
   * is a valid 5-field cron expression.
   */
  public static readonly PRESETS: Array<CronPreset> = [
    { label: translationKey("Every minute"), value: "* * * * *" },
    { label: translationKey("Every 5 minutes"), value: "*/5 * * * *" },
    { label: translationKey("Every 10 minutes"), value: "*/10 * * * *" },
    { label: translationKey("Every 15 minutes"), value: "*/15 * * * *" },
    { label: translationKey("Every 30 minutes"), value: "*/30 * * * *" },
    { label: translationKey("Every hour"), value: "0 * * * *" },
    { label: translationKey("Every 2 hours"), value: "0 */2 * * *" },
    { label: translationKey("Every 3 hours"), value: "0 */3 * * *" },
    { label: translationKey("Every 6 hours"), value: "0 */6 * * *" },
    { label: translationKey("Every 12 hours"), value: "0 */12 * * *" },
    { label: translationKey("Every day at midnight"), value: "0 0 * * *" },
    { label: translationKey("Every day at 9:00 AM"), value: "0 9 * * *" },
    { label: translationKey("Every Monday at 9:00 AM"), value: "0 9 * * 1" },
    {
      label: translationKey("Every week (Sunday at midnight)"),
      value: "0 0 * * 0",
    },
    {
      label: translationKey("Every month (1st at midnight)"),
      value: "0 0 1 * *",
    },
    {
      label: translationKey("Every 3 months (1st at midnight)"),
      value: "0 0 1 */3 *",
    },
    {
      label: translationKey("Every 6 months (1st at midnight)"),
      value: "0 0 1 */6 *",
    },
    {
      label: translationKey("Every year (Jan 1st at midnight)"),
      value: "0 0 1 1 *",
    },
  ];

  /**
   * True if the expression references a workflow variable ({{...}}). Such an
   * expression cannot be parsed as a cron until it is resolved on the server
   * (at workflow-save time), so validation / preview is skipped for it.
   */
  public static isVariableExpression(expression: string): boolean {
    if (typeof expression !== "string") {
      return false;
    }
    return expression.includes("{{") && expression.includes("}}");
  }

  /**
   * Returns a human-readable validation error for the expression, or null if it
   * is a valid cron expression. Variable expressions return null (not our job
   * to validate them here).
   */
  public static getValidationError(expression: string): string | null {
    if (typeof expression !== "string" || expression.trim() === "") {
      return "Schedule is required.";
    }

    if (this.isVariableExpression(expression)) {
      return null;
    }

    try {
      this.parse(expression);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }

  public static isValid(expression: string): boolean {
    if (this.isVariableExpression(expression)) {
      return false;
    }
    return this.getValidationError(expression) === null;
  }

  /**
   * A concise, human-readable description of when the schedule fires, e.g.
   * "Every 30 minutes" or "Every day at 09:30 (UTC)". Falls back to a
   * field-by-field description for uncommon patterns. Returns null when the
   * expression cannot be parsed.
   */
  public static getHumanReadableDescription(expression: string): string | null {
    let parsed: ParsedCron;
    try {
      parsed = this.parse(expression);
    } catch {
      return null;
    }

    return this.describe(parsed);
  }

  /*
   * The shape getHumanReadableDescription puts in words, for a caller that
   * words it in another language (Common/Utils/CronScheduleText). Null when
   * the expression cannot be parsed.
   */
  public static getScheduleShape(expression: string): CronScheduleShape | null {
    try {
      return this.getShapeOf(this.parse(expression));
    } catch {
      return null;
    }
  }

  /**
   * Computes the next `count` fire times (in UTC) at or after `from`
   * (exclusive). Returns fewer than `count` entries only if the pattern has no
   * further matches within the internal search horizon. Throws if the
   * expression is invalid.
   */
  public static getNextExecutionTimes(
    expression: string,
    count: number,
    from: Date = new Date(),
  ): Array<Date> {
    const parsed: ParsedCron = this.parse(expression);
    const results: Array<Date> = [];

    let cursor: Date = from;

    for (let i: number = 0; i < count; i++) {
      const next: Date | null = this.computeNext(parsed, cursor);
      if (!next) {
        break;
      }
      results.push(next);
      cursor = next;
    }

    return results;
  }

  /**
   * The expression's fields, parsed: what each allows. Throws, with the same
   * message getValidationError returns, when the expression is not valid.
   * A copy: changing it changes nothing here.
   */
  public static parseFields(expression: string): CronExpressionFields {
    const parsed: ParsedCron = this.parse(expression);

    const copy: (field: ParsedField) => CronFieldValues = (
      field: ParsedField,
    ): CronFieldValues => {
      return {
        values: [...field.values],
        isWildcard: field.isWildcard,
      };
    };

    return {
      second: copy(parsed.second),
      minute: copy(parsed.minute),
      hour: copy(parsed.hour),
      dayOfMonth: copy(parsed.dayOfMonth),
      month: copy(parsed.month),
      dayOfWeek: copy(parsed.dayOfWeek),
      hasSeconds: parsed.hasSeconds,
    };
  }

  // ----- Internal parsing -------------------------------------------------

  private static parse(expression: string): ParsedCron {
    if (typeof expression !== "string") {
      throw new Error("Cron expression must be a string.");
    }

    const fields: Array<string> = expression.trim().split(/\s+/);

    if (fields.length !== 5 && fields.length !== 6) {
      throw new Error(
        `A cron expression must have 5 or 6 fields (got ${fields.length}). Example: "0 */18 * * *".`,
      );
    }

    const hasSeconds: boolean = fields.length === 6;

    const secondField: string = hasSeconds ? fields[0]! : "0";
    const minuteField: string = hasSeconds ? fields[1]! : fields[0]!;
    const hourField: string = hasSeconds ? fields[2]! : fields[1]!;
    const domField: string = hasSeconds ? fields[3]! : fields[2]!;
    const monthField: string = hasSeconds ? fields[4]! : fields[3]!;
    const dowField: string = hasSeconds ? fields[5]! : fields[4]!;

    return {
      second: this.parseField(secondField, 0, 59, "second"),
      minute: this.parseField(minuteField, 0, 59, "minute"),
      hour: this.parseField(hourField, 0, 23, "hour"),
      dayOfMonth: this.parseField(domField, 1, 31, "day of month"),
      month: this.parseField(monthField, 1, 12, "month", MONTH_NAMES),
      dayOfWeek: this.parseDayOfWeek(dowField),
      hasSeconds,
    };
  }

  private static parseDayOfWeek(field: string): ParsedField {
    // Day-of-week accepts 0-7 (both 0 and 7 mean Sunday) plus names.
    const parsed: ParsedField = this.parseField(
      field,
      0,
      7,
      "day of week",
      DAY_NAMES,
    );

    // Normalize 7 -> 0 (Sunday) and de-duplicate.
    const normalized: Set<number> = new Set<number>();
    for (const value of parsed.values) {
      normalized.add(value === 7 ? 0 : value);
    }

    return {
      values: Array.from(normalized).sort((a: number, b: number) => {
        return a - b;
      }),
      isWildcard: parsed.isWildcard,
    };
  }

  private static parseField(
    field: string,
    min: number,
    max: number,
    fieldName: string,
    names?: Array<string>,
  ): ParsedField {
    const isWildcard: boolean = field === "*";
    const values: Set<number> = new Set<number>();

    const terms: Array<string> = field.split(",");

    for (const rawTerm of terms) {
      const term: string = rawTerm.trim();

      if (term === "") {
        throw new Error(
          `Invalid ${fieldName} field: empty value in "${field}".`,
        );
      }

      // Split off an optional step ("a-b/step" or "*/step").
      const [rangePart, stepPart, ...extra]: Array<string> = term.split("/");

      if (extra.length > 0 || rangePart === undefined) {
        throw new Error(
          `Invalid ${fieldName} field: "${term}" has too many "/" separators.`,
        );
      }

      let step: number = 1;
      if (stepPart !== undefined) {
        if (!DIGITS_ONLY.test(stepPart)) {
          throw new Error(
            `Invalid ${fieldName} field: step "${stepPart}" must be a positive number.`,
          );
        }
        step = parseInt(stepPart, 10);
        if (step <= 0) {
          throw new Error(
            `Invalid ${fieldName} field: step must be greater than 0.`,
          );
        }
      }

      let rangeStart: number;
      let rangeEnd: number;

      if (rangePart === "*") {
        rangeStart = min;
        rangeEnd = max;
      } else if (rangePart.includes("-")) {
        const [startStr, endStr, ...rangeExtra]: Array<string> =
          rangePart.split("-");
        if (
          rangeExtra.length > 0 ||
          startStr === undefined ||
          endStr === undefined
        ) {
          throw new Error(
            `Invalid ${fieldName} field: malformed range "${rangePart}".`,
          );
        }
        rangeStart = this.parseValue(startStr, min, max, fieldName, names);
        rangeEnd = this.parseValue(endStr, min, max, fieldName, names);
        if (rangeStart > rangeEnd) {
          throw new Error(
            `Invalid ${fieldName} field: range start (${rangeStart}) is greater than range end (${rangeEnd}).`,
          );
        }
      } else {
        // A single value. With a step ("a/step"), it means from a to max.
        rangeStart = this.parseValue(rangePart, min, max, fieldName, names);
        rangeEnd = stepPart !== undefined ? max : rangeStart;
      }

      for (let value: number = rangeStart; value <= rangeEnd; value += step) {
        values.add(value);
      }
    }

    if (values.size === 0) {
      throw new Error(`Invalid ${fieldName} field: "${field}".`);
    }

    return {
      values: Array.from(values).sort((a: number, b: number) => {
        return a - b;
      }),
      isWildcard,
    };
  }

  private static parseValue(
    raw: string,
    min: number,
    max: number,
    fieldName: string,
    names?: Array<string>,
  ): number {
    const token: string = raw.trim().toLowerCase();

    let value: number;

    if (DIGITS_ONLY.test(token)) {
      value = parseInt(token, 10);
    } else if (names) {
      const index: number = names.indexOf(token.slice(0, 3));
      if (index === -1) {
        throw new Error(
          `Invalid ${fieldName} field: "${raw}" is not a recognized value.`,
        );
      }
      // Names map to numbers starting at `min` (months start at 1, days at 0).
      value = index + min;
    } else {
      throw new Error(`Invalid ${fieldName} field: "${raw}" is not a number.`);
    }

    if (value < min || value > max) {
      throw new Error(
        `Invalid ${fieldName} field: "${value}" is out of range (${min}-${max}).`,
      );
    }

    return value;
  }

  // ----- Next-run computation --------------------------------------------

  /*
   * Generous safety cap. Each iteration advances the cursor by at least a
   * second (usually a day/month), so this comfortably covers >1000 years while
   * guarding against impossible patterns (e.g. Feb 31).
   */
  private static readonly MAX_SEARCH_ITERATIONS: number = 1_000_000;

  private static computeNext(parsed: ParsedCron, from: Date): Date | null {
    // Start at the next whole second after `from` (drop milliseconds).
    let cursor: Date = new Date(
      Math.floor(from.getTime() / 1000) * 1000 + 1000,
    );

    for (let i: number = 0; i < this.MAX_SEARCH_ITERATIONS; i++) {
      const month: number = cursor.getUTCMonth() + 1;
      if (!parsed.month.values.includes(month)) {
        cursor = this.advanceToNextMonth(cursor, parsed.month.values);
        continue;
      }

      if (!this.dayMatches(cursor, parsed)) {
        cursor = this.startOfNextDay(cursor);
        continue;
      }

      const hour: number = cursor.getUTCHours();
      if (!parsed.hour.values.includes(hour)) {
        const nextHour: number | null = this.nextAllowed(
          parsed.hour.values,
          hour,
        );
        if (nextHour === null) {
          cursor = this.startOfNextDay(cursor);
        } else {
          cursor.setUTCHours(nextHour, 0, 0, 0);
        }
        continue;
      }

      const minute: number = cursor.getUTCMinutes();
      if (!parsed.minute.values.includes(minute)) {
        const nextMinute: number | null = this.nextAllowed(
          parsed.minute.values,
          minute,
        );
        if (nextMinute === null) {
          // No allowed minute left this hour; roll to the next hour.
          cursor.setUTCHours(cursor.getUTCHours() + 1, 0, 0, 0);
        } else {
          cursor.setUTCMinutes(nextMinute, 0, 0);
        }
        continue;
      }

      const second: number = cursor.getUTCSeconds();
      if (!parsed.second.values.includes(second)) {
        const nextSecond: number | null = this.nextAllowed(
          parsed.second.values,
          second,
        );
        if (nextSecond === null) {
          // No allowed second left this minute; roll to the next minute.
          cursor.setUTCMinutes(cursor.getUTCMinutes() + 1, 0, 0);
        } else {
          cursor.setUTCSeconds(nextSecond, 0);
        }
        continue;
      }

      return cursor;
    }

    return null;
  }

  private static dayMatches(cursor: Date, parsed: ParsedCron): boolean {
    const dayOfMonth: number = cursor.getUTCDate();
    const dayOfWeek: number = cursor.getUTCDay(); // 0 (Sun) - 6 (Sat)

    const domRestricted: boolean = !parsed.dayOfMonth.isWildcard;
    const dowRestricted: boolean = !parsed.dayOfWeek.isWildcard;

    if (domRestricted && dowRestricted) {
      // Standard cron OR semantics when both are restricted.
      return (
        parsed.dayOfMonth.values.includes(dayOfMonth) ||
        parsed.dayOfWeek.values.includes(dayOfWeek)
      );
    }

    if (domRestricted) {
      return parsed.dayOfMonth.values.includes(dayOfMonth);
    }

    if (dowRestricted) {
      return parsed.dayOfWeek.values.includes(dayOfWeek);
    }

    return true;
  }

  private static nextAllowed(
    sortedValues: Array<number>,
    current: number,
  ): number | null {
    for (const value of sortedValues) {
      if (value >= current) {
        return value;
      }
    }
    return null;
  }

  private static startOfNextDay(cursor: Date): Date {
    const next: Date = new Date(cursor.getTime());
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0, 0, 0, 0);
    return next;
  }

  private static advanceToNextMonth(
    cursor: Date,
    allowedMonths: Array<number>,
  ): Date {
    let year: number = cursor.getUTCFullYear();
    let month: number = cursor.getUTCMonth() + 1; // 1-12

    do {
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    } while (!allowedMonths.includes(month));

    return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  }

  // ----- Human-readable description --------------------------------------

  private static getShapeOf(parsed: ParsedCron): CronScheduleShape {
    const minute: ParsedField = parsed.minute;
    const hour: ParsedField = parsed.hour;
    const dom: ParsedField = parsed.dayOfMonth;
    const month: ParsedField = parsed.month;
    const dow: ParsedField = parsed.dayOfWeek;
    const second: ParsedField = parsed.second;

    const minuteStep: number | null = this.detectStep(minute, 0, 59);
    const hourStep: number | null = this.detectStep(hour, 0, 23);

    const secondsAreDefault: boolean =
      !parsed.hasSeconds ||
      (second.values.length === 1 && second.values[0] === 0);

    // Only attempt the "nice" templates for the common seconds-at-zero case.
    if (secondsAreDefault) {
      // Every minute.
      if (
        minute.isWildcard &&
        hour.isWildcard &&
        dom.isWildcard &&
        month.isWildcard &&
        dow.isWildcard
      ) {
        return { kind: "everyMinute" };
      }

      // Every N minutes.
      if (
        minuteStep !== null &&
        hour.isWildcard &&
        dom.isWildcard &&
        month.isWildcard &&
        dow.isWildcard
      ) {
        return minuteStep === 1
          ? { kind: "everyMinute" }
          : { kind: "everyMinutes", step: minuteStep };
      }

      // Every hour (on the hour).
      if (
        minute.values.length === 1 &&
        minute.values[0] === 0 &&
        hour.isWildcard &&
        dom.isWildcard &&
        month.isWildcard &&
        dow.isWildcard
      ) {
        return { kind: "everyHourOnTheHour" };
      }

      // Every N hours (at minute M).
      if (
        minute.values.length === 1 &&
        hourStep !== null &&
        dom.isWildcard &&
        month.isWildcard &&
        dow.isWildcard
      ) {
        return {
          kind: "everyHours",
          step: hourStep,
          minute: minute.values[0]!,
        };
      }

      const isSingleTime: boolean =
        minute.values.length === 1 && hour.values.length === 1;

      if (isSingleTime) {
        const at: { hour: number; minute: number } = {
          hour: hour.values[0]!,
          minute: minute.values[0]!,
        };

        // Every day at HH:MM.
        if (dom.isWildcard && month.isWildcard && dow.isWildcard) {
          return { kind: "daily", ...at };
        }

        // Every week on <days> at HH:MM.
        if (dom.isWildcard && month.isWildcard && !dow.isWildcard) {
          return { kind: "weekly", weekdays: [...dow.values], ...at };
        }

        // Every month on the <day> at HH:MM.
        if (!dom.isWildcard && month.isWildcard && dow.isWildcard) {
          return {
            kind: "monthly",
            daysOfMonth: [...dom.values],
            monthStep: 1,
            ...at,
          };
        }

        // Every N months on the <day> at HH:MM.
        const monthStep: number | null = this.detectStep(month, 1, 12);
        if (!dom.isWildcard && monthStep !== null && dow.isWildcard) {
          return {
            kind: "monthly",
            daysOfMonth: [...dom.values],
            monthStep: monthStep,
            ...at,
          };
        }

        // Specific month(s) on the <day> at HH:MM (e.g. yearly).
        if (!dom.isWildcard && !month.isWildcard && dow.isWildcard) {
          return {
            kind: "yearly",
            daysOfMonth: [...dom.values],
            months: [...month.values],
            ...at,
          };
        }
      }
    }

    return { kind: "fieldByField" };
  }

  // A shape's time of day: "09:30".
  public static describeTimeOfDay(hour: number, minute: number): string {
    return `${this.pad(hour)}:${this.pad(minute)}`;
  }

  private static describe(parsed: ParsedCron): string {
    const shape: CronScheduleShape = this.getShapeOf(parsed);

    switch (shape.kind) {
      case "everyMinute":
        return "Every minute";
      case "everyMinutes":
        return `Every ${shape.step} minutes`;
      case "everyHourOnTheHour":
        return "Every hour, on the hour";
      case "everyHours": {
        const atMinute: string =
          shape.minute === 0 ? "" : ` at minute ${this.pad(shape.minute)}`;
        return shape.step === 1
          ? `Every hour${atMinute}`
          : `Every ${shape.step} hours${atMinute}`;
      }
      case "daily":
        return `Every day at ${this.describeTimeOfDay(
          shape.hour,
          shape.minute,
        )} (UTC)`;
      case "weekly":
        return `Every week on ${this.describeWeekdays(
          shape.weekdays,
        )} at ${this.describeTimeOfDay(shape.hour, shape.minute)} (UTC)`;
      case "monthly": {
        const everyMonths: string =
          shape.monthStep === 1 ? "month" : `${shape.monthStep} months`;
        return `Every ${everyMonths} on the ${this.describeDaysOfMonth(
          shape.daysOfMonth,
        )} at ${this.describeTimeOfDay(shape.hour, shape.minute)} (UTC)`;
      }
      case "yearly":
        return `On the ${this.describeDaysOfMonth(
          shape.daysOfMonth,
        )} of ${this.describeMonths(shape.months)} at ${this.describeTimeOfDay(
          shape.hour,
          shape.minute,
        )} (UTC)`;
      default:
        // Generic fallback: list only the constrained fields.
        return this.describeGeneric(parsed);
    }
  }

  private static describeGeneric(parsed: ParsedCron): string {
    const parts: Array<string> = [];

    if (parsed.hasSeconds && !this.isDefaultSecond(parsed.second)) {
      parts.push(`at ${this.describeFieldValues(parsed.second, "second")}`);
    }

    if (!parsed.minute.isWildcard) {
      parts.push(`minute ${this.describeFieldValues(parsed.minute, "minute")}`);
    } else {
      parts.push("every minute");
    }

    if (!parsed.hour.isWildcard) {
      parts.push(`hour ${this.describeFieldValues(parsed.hour, "hour")}`);
    }

    if (!parsed.dayOfMonth.isWildcard) {
      parts.push(
        `on day-of-month ${this.describeFieldValues(parsed.dayOfMonth, "dom")}`,
      );
    }

    if (!parsed.month.isWildcard) {
      parts.push(`in ${this.describeMonths(parsed.month.values)}`);
    }

    if (!parsed.dayOfWeek.isWildcard) {
      parts.push(`on ${this.describeWeekdays(parsed.dayOfWeek.values)}`);
    }

    return parts.join(", ") + " (UTC)";
  }

  private static isDefaultSecond(second: ParsedField): boolean {
    return second.values.length === 1 && second.values[0] === 0;
  }

  private static describeFieldValues(field: ParsedField, kind: string): string {
    const step: number | null =
      kind === "minute"
        ? this.detectStep(field, 0, 59)
        : kind === "hour"
          ? this.detectStep(field, 0, 23)
          : null;

    if (step !== null && step > 1) {
      return `every ${step}`;
    }

    return field.values.join(", ");
  }

  /**
   * Detects a "*\/step" pattern: an evenly-spaced set of values starting at the
   * field minimum and spanning to at least the last reachable step below max.
   * Returns the step, or null when the field isn't a clean step.
   */
  private static detectStep(
    field: ParsedField,
    min: number,
    max: number,
  ): number | null {
    const values: Array<number> = field.values;

    if (values.length < 2) {
      return null;
    }

    if (values[0] !== min) {
      return null;
    }

    const step: number = values[1]! - values[0]!;

    if (step <= 0) {
      return null;
    }

    // Every consecutive value must be exactly `step` apart.
    for (let i: number = 1; i < values.length; i++) {
      if (values[i]! - values[i - 1]! !== step) {
        return null;
      }
    }

    // The set must be complete: the next step would exceed max.
    const lastValue: number = values[values.length - 1]!;
    if (lastValue + step <= max) {
      return null;
    }

    return step;
  }

  // "Monday, Wednesday and Friday": weekdays 0 (Sunday) - 6, in English.
  public static describeWeekdays(values: Array<number>): string {
    return this.joinList(
      values.map((v: number) => {
        return DAY_NAMES_LONG[v] || `day ${v}`;
      }),
    );
  }

  // "January and July": months 1 - 12, in English.
  public static describeMonths(values: Array<number>): string {
    return this.joinList(
      values.map((v: number) => {
        return MONTH_NAMES_LONG[v - 1] || `month ${v}`;
      }),
    );
  }

  // "1st and 15th", in English.
  public static describeDaysOfMonth(values: Array<number>): string {
    return this.joinList(
      values.map((v: number) => {
        return this.ordinal(v);
      }),
    );
  }

  private static joinList(items: Array<string>): string {
    if (items.length === 0) {
      return "";
    }
    if (items.length === 1) {
      return items[0]!;
    }
    if (items.length === 2) {
      return `${items[0]} and ${items[1]}`;
    }
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  }

  private static ordinal(value: number): string {
    const mod100: number = value % 100;
    if (mod100 >= 11 && mod100 <= 13) {
      return `${value}th`;
    }
    switch (value % 10) {
      case 1:
        return `${value}st`;
      case 2:
        return `${value}nd`;
      case 3:
        return `${value}rd`;
      default:
        return `${value}th`;
    }
  }

  private static pad(value: number): string {
    return value < 10 ? `0${value}` : `${value}`;
  }
}
