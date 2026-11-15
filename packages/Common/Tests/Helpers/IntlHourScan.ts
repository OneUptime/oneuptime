import fs from "fs";
import path from "path";

/*
 * THE HOUR AN INTL OPTIONS OBJECT ASKS FOR, READ FROM THE PRODUCT'S CODE.
 *
 * Intl writes a time of day's hour two ways: "numeric" and "2-digit". Which
 * is right is the clock's. A 12-hour time has no leading zero in any
 * language ("5:14 AM", "오전 5:14", "5:14 ص"), and Intl writes the zero
 * wherever it is asked for a two-digit hour, whatever the clock: "오전
 * 05:14" (issue #7279), "Nov 5, 05:14 AM" in the mobile app (#7650). A
 * 24-hour time keeps its zero ("05:14"), and Intl drops it in German,
 * French, Japanese, Russian and most others when asked for a numeric hour:
 * "5:14" in a feed beside a table's "05:14" (#7649).
 *
 * So an options object that names its hour in so many words pins, in the
 * same object, the clock that hour is right on: "2-digit" with hour12: false
 * (or hourCycle "h23" or "h24"), "numeric" with hour12: true (or hourCycle
 * "h11" or "h12"). A time on the reader's clock asks getHourOption for its
 * hour, one on its language's own clock (a calendar's grid, a chart's axis)
 * getLocaleClockHourOption (both in Common/Types/DateLanguage), and the
 * mobile app its own getHourOption (packages/MobileApp/src/utils/date). An
 * object read only for the clock it resolves - new Intl.DateTimeFormat(
 * locale, { hour: "numeric" }).resolvedOptions() - writes no time, and is
 * how those helpers learn the clock.
 *
 * TwelveHourClockLeadingZeroGuard and TwentyFourHourClockLeadingZeroGuard
 * (Tests/Types) read every front end with these: the Dashboard and the
 * other web apps, Common, the enterprise edition and the mobile app.
 */

export const REPOSITORY: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
);

export const SCANNED_DIRECTORIES: ReadonlyArray<string> = [
  "packages/Common/UI",
  "packages/Common/Types",
  "packages/Common/Utils",
  "packages/Common/Server",
  "packages/App/FeatureSet",
  "packages/MobileApp/src",
  // The enterprise edition, when it is in the checkout.
  "ee",
];

const SKIPPED_DIRECTORIES: ReadonlyArray<string> = [
  "node_modules",
  "Tests",
  "__tests__",
  "build",
  "dist",
  "public",
];

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;
const TEST_FILE: RegExp = /\.(test|spec)\.tsx?$/;

// An options object's two-digit hour: hour: "2-digit".
export const TWO_DIGIT_HOUR: RegExp = /\bhour\s*:\s*(["'`])2-digit\1/g;

// A two-digit hour set on its own, apart from the object's clock.
const TWO_DIGIT_HOUR_SET: RegExp = /\.hour\s*=\s*(["'`])2-digit\1/g;

/*
 * An options object's numeric hour: hour: "numeric" - not a type that
 * names it among others (let hour: "numeric" | "2-digit").
 */
export const NUMERIC_HOUR: RegExp = /\bhour\s*:\s*(["'`])numeric\1(?!\s*\|)/g;

// A numeric hour set on its own, apart from the object's clock.
const NUMERIC_HOUR_SET: RegExp = /\.hour\s*=\s*(["'`])numeric\1/g;

/*
 * The clock rule written out by hand: hour: twelveHour ? "numeric" :
 * "2-digit". It is getHourOption's, and is asked of it.
 */
const HAND_WRITTEN_HOUR_RULE: RegExp =
  /\bhour\s*:\s*[^,;{}()]*\?\s*(["'`])(?:numeric|2-digit)\1\s*:\s*(["'`])(?:numeric|2-digit)\2/g;

// A 24-hour clock, pinned in the same object.
const TWENTY_FOUR_HOUR_CLOCK: RegExp =
  /\bhour12\s*:\s*false\b|\bhourCycle\s*:\s*(["'`])h2[34]\1/;

// A 12-hour clock, pinned in the same object.
const TWELVE_HOUR_CLOCK: RegExp =
  /\bhour12\s*:\s*true\b|\bhourCycle\s*:\s*(["'`])h1[12]\1/;

// An object read only for its clock: `{ hour: "numeric" }).resolvedOptions()`.
const READ_FOR_ITS_CLOCK: RegExp = /^\s*\)\s*\.\s*resolvedOptions\s*\(/;

const WHITESPACE: RegExp = /\s+/g;

interface ObjectSpan {
  start: number;
  end: number;
}

// The object literal around `index`: from its "{" to its "}".
const enclosingObjectSpan: (text: string, index: number) => ObjectSpan = (
  text: string,
  index: number,
): ObjectSpan => {
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

  return { start, end };
};

const enclosingObject: (text: string, index: number) => string = (
  text: string,
  index: number,
): string => {
  const span: ObjectSpan = enclosingObjectSpan(text, index);

  return text.slice(span.start, span.end + 1);
};

const lineOf: (text: string, index: number) => number = (
  text: string,
  index: number,
): number => {
  return text.slice(0, index).split("\n").length;
};

const describeObject: (data: {
  file: string;
  text: string;
  index: number;
}) => string = (data: {
  file: string;
  text: string;
  index: number;
}): string => {
  return `${data.file}:${lineOf(data.text, data.index)} ${enclosingObject(
    data.text,
    data.index,
  ).replace(WHITESPACE, " ")}`;
};

/*
 * Every two-digit hour asked for on a clock that may be a 12-hour one:
 * "오전 05:14".
 */
export const findTwoDigitHoursOnAnyClock: (
  file: string,
  text: string,
) => Array<string> = (file: string, text: string): Array<string> => {
  const found: Array<string> = [];

  for (const match of text.matchAll(TWO_DIGIT_HOUR)) {
    const options: string = enclosingObject(text, match.index!);

    if (!TWENTY_FOUR_HOUR_CLOCK.test(options)) {
      found.push(describeObject({ file, text, index: match.index! }));
    }
  }

  for (const match of text.matchAll(TWO_DIGIT_HOUR_SET)) {
    found.push(`${file}:${lineOf(text, match.index!)} ${match[0]}`);
  }

  return found;
};

/*
 * Every numeric hour asked for on a clock that may be a 24-hour one -
 * "5:14" in German, French, Japanese - and every clock rule written out by
 * hand rather than asked of getHourOption.
 */
export const findNumericHoursOffATwelveHourClock: (
  file: string,
  text: string,
) => Array<string> = (file: string, text: string): Array<string> => {
  const found: Array<string> = [];

  for (const match of text.matchAll(NUMERIC_HOUR)) {
    const span: ObjectSpan = enclosingObjectSpan(text, match.index!);
    const options: string = text.slice(span.start, span.end + 1);

    if (READ_FOR_ITS_CLOCK.test(text.slice(span.end + 1))) {
      continue;
    }

    if (!TWELVE_HOUR_CLOCK.test(options)) {
      found.push(describeObject({ file, text, index: match.index! }));
    }
  }

  for (const match of text.matchAll(NUMERIC_HOUR_SET)) {
    found.push(`${file}:${lineOf(text, match.index!)} ${match[0]}`);
  }

  for (const match of text.matchAll(HAND_WRITTEN_HOUR_RULE)) {
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

export interface ScannedSource {
  // From the repository's root, with forward slashes: "packages/Common/...".
  file: string;
  text: string;
}

// The product's source files in every scanned front end, tests left out.
export const readScannedSources: () => Array<ScannedSource> =
  (): Array<ScannedSource> => {
    const sources: Array<ScannedSource> = [];

    for (const directory of SCANNED_DIRECTORIES) {
      const full: string = path.join(REPOSITORY, directory);

      if (!fs.existsSync(full)) {
        continue;
      }

      for (const file of sourceFiles(full)) {
        sources.push({
          file: path.relative(REPOSITORY, file).split(path.sep).join("/"),
          text: fs.readFileSync(file, "utf8"),
        });
      }
    }

    return sources;
  };
