import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A TWO-DIGIT HOUR IS ASKED OF INTL ONLY ON A 24-HOUR CLOCK.
 *
 * A 12-hour time has no leading zero in any language: "5:14 AM", "오전
 * 5:14", "上午5:14", "5:14 am", "5:14 ص". Intl writes the zero wherever it
 * is asked for hour "2-digit", whatever the clock, so every localized date
 * on a 12-hour clock read "오전 05:14" (issue #7279). An Intl options object
 * that asks for a two-digit hour pins a 24-hour clock in the same object
 * (hour12: false, or hourCycle "h23" or "h24"); a time on the reader's clock
 * asks getHourOption, and one on its language's own clock (a calendar's
 * grid, a chart's axis) asks getLocaleClockHourOption
 * (Common/Types/DateLanguage).
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..");
const REPOSITORY: string = path.resolve(PACKAGES, "..");

const DIRECTORIES: Array<string> = [
  "packages/Common/UI",
  "packages/Common/Types",
  "packages/Common/Utils",
  "packages/Common/Server",
  "packages/App/FeatureSet",
  // The enterprise edition, when it is in the checkout.
  "ee",
];

const SKIPPED_DIRECTORIES: ReadonlyArray<string> = [
  "node_modules",
  "Tests",
  "build",
  "dist",
  "public",
];

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;
const TEST_FILE: RegExp = /\.(test|spec)\.tsx?$/;

// An options object's two-digit hour: hour: "2-digit".
const TWO_DIGIT_HOUR: RegExp = /\bhour\s*:\s*(["'`])2-digit\1/g;

// A two-digit hour set on its own, apart from the object's clock.
const TWO_DIGIT_HOUR_SET: RegExp = /\.hour\s*=\s*(["'`])2-digit\1/g;

// A 24-hour clock, pinned in the same object.
const TWENTY_FOUR_HOUR_CLOCK: RegExp =
  /\bhour12\s*:\s*false\b|\bhourCycle\s*:\s*(["'`])h2[34]\1/;

const WHITESPACE: RegExp = /\s+/g;

// The object literal around `index`: from its "{" to its "}".
const enclosingObject: (text: string, index: number) => string = (
  text: string,
  index: number,
): string => {
  let depth: number = 0;
  let start: number = index;

  while (start > 0) {
    start--;

    const character: string = text[start]!;

    if (character === "}") {
      depth++;
    } else if (character === "{") {
      if (depth === 0) {
        break;
      }

      depth--;
    }
  }

  depth = 0;
  let end: number = index;

  while (end < text.length) {
    const character: string = text[end]!;

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      if (depth === 0) {
        break;
      }

      depth--;
    }

    end++;
  }

  return text.slice(start, end + 1);
};

const lineOf: (text: string, index: number) => number = (
  text: string,
  index: number,
): number => {
  return text.slice(0, index).split("\n").length;
};

export const findTwoDigitHoursOnAnyClock: (
  file: string,
  text: string,
) => Array<string> = (file: string, text: string): Array<string> => {
  const found: Array<string> = [];

  for (const match of text.matchAll(TWO_DIGIT_HOUR)) {
    const options: string = enclosingObject(text, match.index!);

    if (!TWENTY_FOUR_HOUR_CLOCK.test(options)) {
      found.push(
        `${file}:${lineOf(text, match.index!)} ${options.replace(WHITESPACE, " ")}`,
      );
    }
  }

  for (const match of text.matchAll(TWO_DIGIT_HOUR_SET)) {
    found.push(`${file}:${lineOf(text, match.index!)} ${match[0]}`);
  }

  return found;
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

describe("a two-digit hour is asked for only on a 24-hour clock", () => {
  test("no product code asks Intl for a two-digit hour on a 12-hour clock", () => {
    const found: Array<string> = [];
    let twoDigitHours: number = 0;

    for (const directory of DIRECTORIES) {
      const full: string = path.join(REPOSITORY, directory);

      if (!fs.existsSync(full)) {
        continue;
      }

      for (const file of sourceFiles(full)) {
        const text: string = fs.readFileSync(file, "utf8");
        const relative: string = path
          .relative(REPOSITORY, file)
          .split(path.sep)
          .join("/");

        twoDigitHours += Array.from(text.matchAll(TWO_DIGIT_HOUR)).length;
        found.push(...findTwoDigitHoursOnAnyClock(relative, text));
      }
    }

    /*
     * The sweep reads the product's files: the 24-hour patterns (Date's
     * "HH:mm", a cron's next run, the zone probes) ask for two digits.
     */
    expect(twoDigitHours).toBeGreaterThanOrEqual(3);
    expect(found).toEqual([]);
  });

  test.each<[string, number]>([
    // The issue's form: two digits on whatever clock the reader keeps.
    ["{ hour: '2-digit', minute: '2-digit', hour12: use12HourFormat }", 1],
    ['{ hour: "2-digit", minute: "2-digit", hour12: true }', 1],
    // The language's own clock: "오전 05:14" in Korean.
    [
      'date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })',
      1,
    ],
    ['new Intl.DateTimeFormat(locale, {\n  hour: "2-digit",\n})', 1],
    ['{ hour: "2-digit", hourCycle: "h12" }', 1],
    ['options.hour = "2-digit";', 1],
    // A pinned 24-hour clock keeps its zero: "05:14".
    ['{ hour: "2-digit", minute: "2-digit", hour12: false }', 0],
    ['{ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }', 0],
    ["{ hourCycle: 'h24', hour: '2-digit' }", 0],
    ['{ timeZone, hour12: false, nested: { a: 1 }, hour: "2-digit" }', 0],
    // A numeric hour, or one asked of the helpers.
    ['{ hour: "numeric", minute: "2-digit", hour12: true }', 0],
    ["{ hour: getHourOption(use12HourFormat), minute: '2-digit' }", 0],
    ["{ hour: getLocaleClockHourOption(locale), minute: '2-digit' }", 0],
    ["options.hour = getHourOption(shape.use12HourFormat);", 0],
    // Two-digit minutes and seconds are not hours.
    ['{ minute: "2-digit", second: "2-digit" }', 0],
  ])("finds %p %p time(s)", (source: string, count: number) => {
    expect(findTwoDigitHoursOnAnyClock("Example.ts", source)).toHaveLength(
      count,
    );
  });

  test("each object is judged by its own clock, not a neighbour's", () => {
    expect(
      findTwoDigitHoursOnAnyClock(
        "Example.ts",
        [
          'const a = { hour: "2-digit", hour12: false };',
          'const b = { hour: "2-digit", minute: "2-digit" };',
        ].join("\n"),
      ),
    ).toEqual(['Example.ts:2 { hour: "2-digit", minute: "2-digit" }']);
  });
});
