/*
 * WHEN A CRON SCHEDULE RUNS - the web's reading, kept here because the app
 * is built without Common's runtime code. A copy of Common/Utils/CronTab's
 * parser and its next-run search, and nothing else of it:
 *
 *   - 5 fields, or 6 with a leading seconds field;
 *   - each field `*`, a value, `a-b`, `*` or `a-b` or `a` with `/step`, and
 *     comma lists of those; months and weekdays also by name (their first
 *     three letters), and 7 for Sunday as well as 0;
 *   - day of month and day of week OR-ed when both are restricted, as cron
 *     does, and only the restricted one deciding otherwise;
 *   - every time in UTC, as the server and the web read them;
 *   - an expression naming a workflow variable ({{...}}) is no schedule.
 *
 * The app asks it one question: when a monitor's first result is due
 * (utils/monitorFirstCheck). Common's suite runs this file next to CronTab
 * (MonitorHealthMobileParity), so the two cannot drift apart. It must import
 * nothing: that suite runs it as it is, outside the app.
 */

interface CronField {
  // The values the field allows, sorted, each once.
  values: Array<number>;
  // Whether it was written as a bare "*".
  isWildcard: boolean;
}

interface ParsedCron {
  second: CronField;
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

const DIGITS_ONLY: RegExp = /^\d+$/;
const FIELD_SEPARATOR: RegExp = /\s+/;

// Month names as a field reads them: their first three letters.
export const CRON_MONTH_NAMES: ReadonlyArray<string> = [
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

const DAY_NAMES: ReadonlyArray<string> = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

/*
 * CronTab's cap on the search for a run: each step moves at least a second,
 * usually a day or a month, so this covers centuries, and stops a schedule
 * that never runs (the 31st of February) from searching for ever.
 */
const MAX_SEARCH_ITERATIONS: number = 1_000_000;

function sortedValues(values: Set<number>): Array<number> {
  return Array.from(values).sort((a: number, b: number): number => {
    return a - b;
  });
}

function parseValue(
  raw: string,
  min: number,
  max: number,
  names?: ReadonlyArray<string>,
): number {
  const token: string = raw.trim().toLowerCase();
  let value: number;

  if (DIGITS_ONLY.test(token)) {
    value = parseInt(token, 10);
  } else if (names) {
    const index: number = names.indexOf(token.slice(0, 3));

    if (index === -1) {
      throw new Error(`"${raw}" is not a recognized value.`);
    }

    // Names count from the field's first value: months from 1, days from 0.
    value = index + min;
  } else {
    throw new Error(`"${raw}" is not a number.`);
  }

  if (value < min || value > max) {
    throw new Error(`"${value}" is out of range (${min}-${max}).`);
  }

  return value;
}

function parseField(
  field: string,
  min: number,
  max: number,
  names?: ReadonlyArray<string>,
): CronField {
  const values: Set<number> = new Set<number>();

  for (const rawTerm of field.split(",")) {
    const term: string = rawTerm.trim();

    if (term === "") {
      throw new Error(`An empty value in "${field}".`);
    }

    const [rangePart, stepPart, ...extra]: Array<string> = term.split("/");

    if (extra.length > 0 || rangePart === undefined) {
      throw new Error(`"${term}" has too many "/" separators.`);
    }

    let step: number = 1;

    if (stepPart !== undefined) {
      if (!DIGITS_ONLY.test(stepPart)) {
        throw new Error(`The step "${stepPart}" is not a positive number.`);
      }

      step = parseInt(stepPart, 10);

      if (step <= 0) {
        throw new Error("A step must be greater than 0.");
      }
    }

    let rangeStart: number;
    let rangeEnd: number;

    if (rangePart === "*") {
      rangeStart = min;
      rangeEnd = max;
    } else if (rangePart.includes("-")) {
      const [startText, endText, ...rangeExtra]: Array<string> =
        rangePart.split("-");

      if (
        rangeExtra.length > 0 ||
        startText === undefined ||
        endText === undefined
      ) {
        throw new Error(`"${rangePart}" is not a range.`);
      }

      rangeStart = parseValue(startText, min, max, names);
      rangeEnd = parseValue(endText, min, max, names);

      if (rangeStart > rangeEnd) {
        throw new Error(`"${rangePart}" starts after it ends.`);
      }
    } else {
      // A single value; with a step ("a/step") it runs from a to the end.
      rangeStart = parseValue(rangePart, min, max, names);
      rangeEnd = stepPart !== undefined ? max : rangeStart;
    }

    for (let value: number = rangeStart; value <= rangeEnd; value += step) {
      values.add(value);
    }
  }

  if (values.size === 0) {
    throw new Error(`"${field}" allows no value.`);
  }

  return { values: sortedValues(values), isWildcard: field === "*" };
}

// 0-7 or names, 7 being Sunday as 0 is.
function parseDayOfWeek(field: string): CronField {
  const parsed: CronField = parseField(field, 0, 7, DAY_NAMES);
  const days: Set<number> = new Set<number>();

  for (const value of parsed.values) {
    days.add(value === 7 ? 0 : value);
  }

  return { values: sortedValues(days), isWildcard: parsed.isWildcard };
}

function parse(expression: string): ParsedCron {
  if (typeof expression !== "string") {
    throw new Error("A cron expression is text.");
  }

  const fields: Array<string> = expression.trim().split(FIELD_SEPARATOR);

  if (fields.length !== 5 && fields.length !== 6) {
    throw new Error(
      `A cron expression has 5 or 6 fields (this has ${fields.length}).`,
    );
  }

  const offset: number = fields.length - 5;

  return {
    second: parseField(offset === 1 ? fields[0]! : "0", 0, 59),
    minute: parseField(fields[offset]!, 0, 59),
    hour: parseField(fields[offset + 1]!, 0, 23),
    dayOfMonth: parseField(fields[offset + 2]!, 1, 31),
    month: parseField(fields[offset + 3]!, 1, 12, CRON_MONTH_NAMES),
    dayOfWeek: parseDayOfWeek(fields[offset + 4]!),
  };
}

// Whether the expression names a workflow variable, resolved on the server.
export function isVariableCronExpression(expression: string): boolean {
  return (
    typeof expression === "string" &&
    expression.includes("{{") &&
    expression.includes("}}")
  );
}

// Whether the expression is a schedule this reading understands.
export function isValidCronExpression(expression: string): boolean {
  if (typeof expression !== "string" || expression.trim() === "") {
    return false;
  }

  if (isVariableCronExpression(expression)) {
    return false;
  }

  try {
    parse(expression);
    return true;
  } catch {
    return false;
  }
}

function dayMatches(cursor: Date, parsed: ParsedCron): boolean {
  const dayOfMonth: number = cursor.getUTCDate();
  const dayOfWeek: number = cursor.getUTCDay();
  const isDayOfMonthRestricted: boolean = !parsed.dayOfMonth.isWildcard;
  const isDayOfWeekRestricted: boolean = !parsed.dayOfWeek.isWildcard;

  if (isDayOfMonthRestricted && isDayOfWeekRestricted) {
    return (
      parsed.dayOfMonth.values.includes(dayOfMonth) ||
      parsed.dayOfWeek.values.includes(dayOfWeek)
    );
  }

  if (isDayOfMonthRestricted) {
    return parsed.dayOfMonth.values.includes(dayOfMonth);
  }

  if (isDayOfWeekRestricted) {
    return parsed.dayOfWeek.values.includes(dayOfWeek);
  }

  return true;
}

function nextAllowed(values: Array<number>, current: number): number | null {
  for (const value of values) {
    if (value >= current) {
      return value;
    }
  }

  return null;
}

function startOfNextDay(cursor: Date): Date {
  const next: Date = new Date(cursor.getTime());
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function startOfNextAllowedMonth(cursor: Date, months: Array<number>): Date {
  let year: number = cursor.getUTCFullYear();
  let month: number = cursor.getUTCMonth() + 1;

  do {
    month++;

    if (month > 12) {
      month = 1;
      year++;
    }
  } while (!months.includes(month));

  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

// The first run after `from`, to the second, or null when none is in reach.
function getNextRun(parsed: ParsedCron, from: Date): Date | null {
  let cursor: Date = new Date(Math.floor(from.getTime() / 1000) * 1000 + 1000);

  for (let step: number = 0; step < MAX_SEARCH_ITERATIONS; step++) {
    if (!parsed.month.values.includes(cursor.getUTCMonth() + 1)) {
      cursor = startOfNextAllowedMonth(cursor, parsed.month.values);
      continue;
    }

    if (!dayMatches(cursor, parsed)) {
      cursor = startOfNextDay(cursor);
      continue;
    }

    const hour: number = cursor.getUTCHours();

    if (!parsed.hour.values.includes(hour)) {
      const nextHour: number | null = nextAllowed(parsed.hour.values, hour);

      if (nextHour === null) {
        cursor = startOfNextDay(cursor);
      } else {
        cursor.setUTCHours(nextHour, 0, 0, 0);
      }

      continue;
    }

    const minute: number = cursor.getUTCMinutes();

    if (!parsed.minute.values.includes(minute)) {
      const nextMinute: number | null = nextAllowed(
        parsed.minute.values,
        minute,
      );

      if (nextMinute === null) {
        cursor.setUTCHours(cursor.getUTCHours() + 1, 0, 0, 0);
      } else {
        cursor.setUTCMinutes(nextMinute, 0, 0);
      }

      continue;
    }

    const second: number = cursor.getUTCSeconds();

    if (!parsed.second.values.includes(second)) {
      const nextSecond: number | null = nextAllowed(
        parsed.second.values,
        second,
      );

      if (nextSecond === null) {
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

/*
 * The schedule's next `count` runs after `after`, in order: fewer only when
 * no more are in reach. Throws for an expression that is not a schedule
 * (isValidCronExpression), as CronTab does.
 */
export function getNextCronRuns(
  expression: string,
  count: number,
  after: Date,
): Array<Date> {
  const parsed: ParsedCron = parse(expression);
  const runs: Array<Date> = [];
  let cursor: Date = after;

  for (let index: number = 0; index < count; index++) {
    const next: Date | null = getNextRun(parsed, cursor);

    if (!next) {
      break;
    }

    runs.push(next);
    cursor = next;
  }

  return runs;
}
