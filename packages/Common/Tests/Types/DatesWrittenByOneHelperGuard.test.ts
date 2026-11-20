// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  CallArguments,
  lineOf,
  readCallArguments,
  readReceiver,
} from "../Helpers/CallScan";

/*
 * EVERY DATE, TIME, DAY NAME AND RANGE A PAGE SHOWS IS WRITTEN BY ONE PAIR
 * OF HELPERS: Common/Types/Date.ts (OneUptimeDate) and
 * Common/Types/DateLanguage.ts.
 *
 * Code that wrote its own dates drifted from them, one way at a time:
 *   - Intl formatters built with a timeZone read the hour from the
 *     browser's tz data, not OneUptime's: an hour early in Vancouver in a
 *     browser older than tzdata 2026b, and named "PDT" where every other
 *     date on the page said "MST" (#10038). DateLanguage's
 *     getDateTimeFormat works the wall clock out with moment-timezone and
 *     has Intl write only the words.
 *   - A calendar, a PDF axis and a connection's local time followed the
 *     language's own clock, not the reader's (#7651).
 *   - moment's "HH:mm" wrote a colon on a Danish page whose Intl times
 *     read "10.05" (#7914), and moment's English names ("Mon", "Sep") sat
 *     under a German page's schedule timeline (#7660).
 *
 * So in the front ends and the code they share, a date is never written by
 *   - `new Intl.DateTimeFormat(...)`, unless it is only read for the clock
 *     or the zone it resolves (`.resolvedOptions()`), which writes nothing;
 *   - `toLocaleDateString` or `toLocaleTimeString`, or `toLocaleString` on
 *     a date (a number's "1,234" is a number's);
 *   - moment's `.format("...")` with words, a 12-hour clock, a day period,
 *     a zone or a clock of the day in its pattern ("MMM D", "ddd", "h:mm
 *     A", "HH:mm"). A machine shape - digits only, its date first
 *     ("YYYY-MM-DD", "YYYY-MM-DDTHH:mm:ss") - is a key or a value, and
 *     is left alone.
 * Write it with OneUptimeDate (a moment, a day, a time, a range, a day's
 * name: getDayOfWeekName, getLocalDateTimeRangeEnds), with
 * Common/UI/Utils/ReaderMoments, or with DateLanguage's getDateTimeFormat
 * and writeClockInLocale for a shape of its own.
 *
 * Today's exceptions are listed below, each with its reason, and the list
 * only shrinks: an exception that is no longer in its file fails too.
 */

const REPOSITORY: string = path.resolve(__dirname, "..", "..", "..", "..");

// The front ends, and the Common code they draw words with.
export const SCANNED_DIRECTORIES: ReadonlyArray<string> = [
  "packages/Common/UI",
  "packages/Common/Types",
  "packages/Common/Utils",
  "packages/App/FeatureSet/Dashboard/src",
  "packages/App/FeatureSet/AdminDashboard/src",
  "packages/App/FeatureSet/Accounts/src",
  "packages/App/FeatureSet/StatusPage/src",
  "packages/App/FeatureSet/PublicDashboard/src",
  "packages/App/FeatureSet/MobileRecorder/src",
  // The enterprise edition's front ends, when it is in the checkout.
  "ee/AdminDashboard",
  "ee/Dashboard",
];

// The one writer: every other file asks it.
export const DATE_WRITERS: ReadonlyArray<string> = [
  "packages/Common/Types/Date.ts",
  "packages/Common/Types/DateLanguage.ts",
];

const SKIPPED_DIRECTORIES: ReadonlyArray<string> = [
  "node_modules",
  "Tests",
  "__tests__",
  "build",
  "dist",
  "public",
  "Locales",
];

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;
const TEST_FILE: RegExp = /\.(test|spec)\.tsx?$/;

export type DateWrite = "intl" | "toLocale" | "moment";

export interface FoundDateWrite {
  kind: DateWrite;
  line: number;
  // The pattern of a moment format; the call as written for the others.
  detail: string;
}

const INTL_DATE_TIME_FORMAT: RegExp = /new\s+Intl\.DateTimeFormat\s*\(/g;

// What follows the call when it is only read for its clock or its zone.
const READ_FOR_ITS_SETTINGS: RegExp = /^\s*\.\s*resolvedOptions\s*\(/;

const ALWAYS_A_DATE: RegExp = /\.(toLocaleDateString|toLocaleTimeString)\s*\(/g;

const TO_LOCALE_STRING: RegExp = /\.toLocaleString\s*\(/g;

// toLocaleString given a date's locale, or a date's options.
const DATE_ARGUMENTS: RegExp =
  /\b(getReaderDateLocale|getDateLocale|getFeedLocale)\s*\(|\b(month|weekday|hour|minute|timeZone|dateStyle|timeStyle)\s*:/;

// A receiver that holds a date: `new Date(...)`, `date`, `startDate`, `createdAt`.
const DATE_RECEIVER: RegExp =
  /(^new\s+Date\b|(^|\.)date$|[a-z0-9_$](Date|At)$)/;

// `.format("...")`, `.format('...')`, `.format(`...`)` with one literal.
const LITERAL_FORMAT: RegExp = /\.format\(\s*(["'`])([^"'`$]*)\1\s*\)/g;

// Every character a moment pattern is made of, escapes ([...]) aside.
const MOMENT_PATTERN: RegExp = /^[\sYMDdHhmsSAaLZzEeWwQXxGgo:.,/\-()T]+$/;

const MOMENT_ESCAPES: RegExp = /\[[^\]]*\]/g;

/*
 * A pattern a person reads: a month's or a day's name, an ordinal, a day
 * period, a 12-hour hour, a locale's own format or a zone.
 */
const WORDS_IN_PATTERN: RegExp = /MMM|ddd|\bdd\b|\bd\b|Do|A|a|h|L|z|Z/;

// A clock of the day: hours with no year before them ("HH:mm", "HH:mm:ss").
const CLOCK_IN_PATTERN: RegExp = /H/;
const YEAR_IN_PATTERN: RegExp = /Y/;

// Whether a moment pattern writes something a person reads.
export const isDisplayPattern: (pattern: string) => boolean = (
  pattern: string,
): boolean => {
  const unescaped: string = pattern.replace(MOMENT_ESCAPES, "");

  if (!unescaped.trim() || !MOMENT_PATTERN.test(unescaped)) {
    return false;
  }

  if (WORDS_IN_PATTERN.test(unescaped)) {
    return true;
  }

  return CLOCK_IN_PATTERN.test(unescaped) && !YEAR_IN_PATTERN.test(unescaped);
};

// The receiver with what only types it ("!", "?") taken off its end.
const receiverName: (receiver: string) => string = (
  receiver: string,
): string => {
  return receiver.replace(/[!?]+$/, "");
};

const WHITESPACE: RegExp = /\s+/g;

// Every date `text` writes itself, as its file reads.
export const findDateWrites: (text: string) => Array<FoundDateWrite> = (
  text: string,
): Array<FoundDateWrite> => {
  const found: Array<FoundDateWrite> = [];

  for (const match of text.matchAll(INTL_DATE_TIME_FORMAT)) {
    const open: number = match.index! + match[0].length - 1;
    const call: CallArguments | null = readCallArguments(text, open);
    const after: string = call
      ? text.slice(open + call.text.length + 2)
      : text.slice(open);

    if (READ_FOR_ITS_SETTINGS.test(after)) {
      continue;
    }

    found.push({
      kind: "intl",
      line: lineOf(text, match.index!),
      detail: `new Intl.DateTimeFormat(${(call?.text || "")
        .replace(WHITESPACE, " ")
        .trim()})`,
    });
  }

  for (const match of text.matchAll(ALWAYS_A_DATE)) {
    found.push({
      kind: "toLocale",
      line: lineOf(text, match.index!),
      detail: `${receiverName(readReceiver(text, match.index!))}.${match[1]}`,
    });
  }

  for (const match of text.matchAll(TO_LOCALE_STRING)) {
    const call: CallArguments | null = readCallArguments(
      text,
      match.index! + match[0].length - 1,
    );
    const receiver: string = receiverName(readReceiver(text, match.index!));

    if (
      DATE_RECEIVER.test(receiver) ||
      (call !== null && DATE_ARGUMENTS.test(call.text))
    ) {
      found.push({
        kind: "toLocale",
        line: lineOf(text, match.index!),
        detail: `${receiver}.toLocaleString`,
      });
    }
  }

  for (const match of text.matchAll(LITERAL_FORMAT)) {
    const pattern: string = match[2]!;

    if (isDisplayPattern(pattern)) {
      found.push({
        kind: "moment",
        line: lineOf(text, match.index!),
        detail: pattern,
      });
    }
  }

  return found;
};

interface AllowedDateWrite {
  file: string;
  kind: DateWrite;
  detail: string;
  reason: string;
}

const ZONE_NOBODY_KNOWS: string =
  "English for a zone neither OneUptime's zone data nor the browser's knows, when DateLanguage's getDateTimeFormat has no formatter to give.";

const RUN_LOG_IN_ENGLISH: string =
  "The words a waiting on-call run stores with itself (OnCallDutyPolicyRunWait), written by the server in English like every stored run message, the rule's zone named after them.";

export const ALLOWED_DATE_WRITES: ReadonlyArray<AllowedDateWrite> = [
  {
    file: "packages/Common/UI/Components/Feed/FeedTime.ts",
    kind: "moment",
    detail: "dddd, MMMM D, YYYY",
    reason: ZONE_NOBODY_KNOWS,
  },
  {
    file: "packages/Common/UI/Components/StatusTimeline/StatusTimelineTime.ts",
    kind: "moment",
    detail: "MMM D",
    reason: ZONE_NOBODY_KNOWS,
  },
  {
    file: "packages/Common/UI/Components/StatusTimeline/StatusTimelineTime.ts",
    kind: "moment",
    detail: "MMM YYYY",
    reason: ZONE_NOBODY_KNOWS,
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftTime.ts",
    kind: "moment",
    detail: "MMM",
    reason: ZONE_NOBODY_KNOWS,
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftTime.ts",
    kind: "moment",
    detail: "dddd",
    reason: ZONE_NOBODY_KNOWS,
  },
  {
    file: "packages/Common/Types/OnCallDutyPolicy/WorkingHours.ts",
    kind: "moment",
    detail: "HH:mm",
    reason: RUN_LOG_IN_ENGLISH,
  },
  {
    file: "packages/Common/Types/OnCallDutyPolicy/WorkingHours.ts",
    kind: "moment",
    detail: "ddd",
    reason: RUN_LOG_IN_ENGLISH,
  },
  {
    file: "packages/Common/Types/OnCallDutyPolicy/WorkingHours.ts",
    kind: "moment",
    detail: "ddd, MMM D",
    reason: RUN_LOG_IN_ENGLISH,
  },
  {
    file: "packages/Common/Types/OnCallDutyPolicy/WorkingHours.ts",
    kind: "moment",
    detail: "ddd, MMM D, YYYY",
    reason: RUN_LOG_IN_ENGLISH,
  },
  {
    file: "packages/Common/Utils/Dashboard/ClockWidgetFormat.ts",
    kind: "moment",
    detail: "A",
    reason:
      "The clock widget's English face draws its AM or PM apart from its big digits; every other language takes Intl's day period from DateLanguage's getDateTimeFormat (getClockMeridiemInLocale).",
  },
];

const isAllowed: (file: string, write: FoundDateWrite) => boolean = (
  file: string,
  write: FoundDateWrite,
): boolean => {
  return ALLOWED_DATE_WRITES.some((allowed: AllowedDateWrite): boolean => {
    return (
      allowed.file === file &&
      allowed.kind === write.kind &&
      allowed.detail === write.detail
    );
  });
};

const sourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...sourceFiles(full));
      }

      continue;
    }

    if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
};

interface ScannedFile {
  // From the repository's root, with forward slashes.
  file: string;
  text: string;
}

const readScannedFiles: () => Array<ScannedFile> = (): Array<ScannedFile> => {
  const scanned: Array<ScannedFile> = [];

  for (const directory of SCANNED_DIRECTORIES) {
    const full: string = path.join(REPOSITORY, directory);

    if (!fs.existsSync(full)) {
      continue;
    }

    for (const file of sourceFiles(full)) {
      scanned.push({
        file: path.relative(REPOSITORY, file).split(path.sep).join("/"),
        text: fs.readFileSync(file, "utf8"),
      });
    }
  }

  return scanned;
};

describe("every date a page shows is written by OneUptimeDate or DateLanguage", () => {
  const scanned: Array<ScannedFile> = readScannedFiles();

  test("no front end, and no code they share, writes a date itself", () => {
    const found: Array<string> = [];

    for (const source of scanned) {
      if (DATE_WRITERS.includes(source.file)) {
        continue;
      }

      for (const write of findDateWrites(source.text)) {
        if (!isAllowed(source.file, write)) {
          found.push(
            `${source.file}:${write.line} ${write.kind} ${write.detail}`,
          );
        }
      }
    }

    // The sweep reads the front ends: thousands of files.
    expect(scanned.length).toBeGreaterThan(1000);
    expect(found).toEqual([]);
  });

  test("the two writers are there, and are the ones that write dates", () => {
    for (const writer of DATE_WRITERS) {
      const source: ScannedFile | undefined = scanned.find(
        (item: ScannedFile): boolean => {
          return item.file === writer;
        },
      );

      expect(source).toBeDefined();
    }

    const dateLanguage: ScannedFile = scanned.find(
      (item: ScannedFile): boolean => {
        return item.file === "packages/Common/Types/DateLanguage.ts";
      },
    )!;

    expect(
      findDateWrites(dateLanguage.text).filter(
        (write: FoundDateWrite): boolean => {
          return write.kind === "intl";
        },
      ).length,
    ).toBeGreaterThan(0);
  });

  test("every exception is still where it is listed, with its reason", () => {
    for (const allowed of ALLOWED_DATE_WRITES) {
      const source: ScannedFile | undefined = scanned.find(
        (item: ScannedFile): boolean => {
          return item.file === allowed.file;
        },
      );

      expect(source).toBeDefined();
      expect(
        findDateWrites(source!.text).some((write: FoundDateWrite): boolean => {
          return (
            write.kind === allowed.kind && write.detail === allowed.detail
          );
        }),
      ).toBe(true);
      expect(allowed.reason.length).toBeGreaterThan(40);
    }
  });

  test.each<[string, number]>([
    // Intl, writing: the forms #10038 found.
    [
      'new Intl.DateTimeFormat(getNumberLocale(locale), { ...options, timeZone: clock.timezone }).format(date)',
      1,
    ],
    [
      'const format = new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: zone });',
      1,
    ],
    ["new Intl.DateTimeFormat(getFeedLocale(language), options).format(date)", 1],
    // Read only for its clock or its zone: it writes nothing.
    [
      'new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12',
      0,
    ],
    ["Intl.DateTimeFormat().resolvedOptions().timeZone", 0],
    [
      'new Intl.DateTimeFormat("en-US", {\n  timeZone: value,\n}).resolvedOptions().timeZone',
      0,
    ],
    // The browser's own writers.
    ['date.toLocaleTimeString(getReaderDateLocale(), { hour: "numeric" })', 1],
    ['value.toLocaleDateString(locale, { timeZone: "UTC" })', 1],
    ['date.toLocaleString(getReaderDateLocale(), { month: "short" })', 1],
    ["startedAt.toLocaleString(locale)", 1],
    ['new Date(value).toLocaleString("en-US")', 1],
    // A number's toLocaleString is a number's.
    ["count.toLocaleString(getReaderNumberLocale())", 0],
    ['value.toLocaleString("en-US", { maximumFractionDigits: 2 })', 0],
    // moment's words, clocks and zones.
    ['inZone(date, timezone).format("dddd, MMMM D, YYYY")', 1],
    ['moment(date).format("MMM D")', 1],
    ['at.format("ddd")', 1],
    ['zoned.format("h:mm A")', 1],
    ['moment(date).format("HH:mm")', 1],
    ['moment(date).format("LT")', 1],
    ['zoned.format("A")', 1],
    // A machine's shape: a key or a value.
    ['moment(date).format("YYYY-MM-DD")', 0],
    ['moment.tz(anchor, zone).format("YYYY-MM-DDTHH:mm:ss")', 0],
    ['moment.utc(date).format("YYYYMMDD[T]HHmm[Z]")', 0],
    ['zoned.format("YYYY")', 0],
    // A translator's or a formatter's own format.
    ["format.format(date)", 0],
    ['translator.format("{{count}} items")', 0],
    // Written by the helpers.
    [
      "OneUptimeDate.getDateAsCustomFormattedStringInTimezone({ date, format: \"MMM D\" })",
      0,
    ],
    ["OneUptimeDate.getDayOfWeekName(day.start, { width: \"short\" })", 0],
  ])("finds %p %p time(s)", (source: string, count: number) => {
    expect(findDateWrites(source)).toHaveLength(count);
  });

  test("names the kind, the line and the write it finds", () => {
    expect(
      findDateWrites(
        ["const a = 1;", 'const day = zoned.format("ddd, MMM D");'].join("\n"),
      ),
    ).toEqual([{ kind: "moment", line: 2, detail: "ddd, MMM D" }]);
  });

  test("an exception is one file's, for one pattern", () => {
    expect(
      isAllowed("packages/Common/Utils/Dashboard/ClockWidgetFormat.ts", {
        kind: "moment",
        line: 1,
        detail: "A",
      }),
    ).toBe(true);
    expect(
      isAllowed("packages/Common/UI/Components/Other.tsx", {
        kind: "moment",
        line: 1,
        detail: "A",
      }),
    ).toBe(false);
    expect(
      isAllowed("packages/Common/Utils/Dashboard/ClockWidgetFormat.ts", {
        kind: "moment",
        line: 1,
        detail: "h:mm A",
      }),
    ).toBe(false);
  });
});
