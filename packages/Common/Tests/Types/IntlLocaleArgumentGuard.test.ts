import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NO NUMBER, DATE OR TIME IS FORMATTED FROM A BARE LANGUAGE CODE, OR FROM
 * NONE.
 *
 * Arabic writes Latin digits in OneUptime (DateLanguage's
 * LATIN_DIGIT_LANGUAGES), but Intl writes "ar" in Arabic-Indic digits in
 * Safari, so a count, a percentage or a date formatted from the reader's
 * bare language would read "٥" on one machine and "5" on another. Every
 * Intl.NumberFormat, Intl.DateTimeFormat, Intl.RelativeTimeFormat and
 * toLocale*String call in product code that is handed a language takes its
 * locale from getNumberLocale or getDateLocale (or getFeedLocale, which reads
 * getDateLocale), or names a fixed locale ("en-US").
 *
 * A call with no locale at all ("toLocaleString()", "undefined", "[]")
 * followed the browser, not the page: Safari or Chrome on an Arabic system
 * wrote Arabic-Indic digits on an Arabic page, and a German page read in an
 * English browser wrote "1,234" beside the translator's "1.234". Such a
 * call takes the page's language (getReaderNumberLocale,
 * getReaderDateLocale) for what the reader sees, or "en-US" for text that
 * stays English (a prompt for OneUptime AI, a server's message). Only the
 * probes of the browser's own settings listed below still ask for none.
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..");

const DIRECTORIES: Array<string> = [
  "Common/UI",
  "Common/Types",
  "Common/Utils",
  "Common/Server",
  "App/FeatureSet",
];

const SKIPPED_DIRECTORIES: ReadonlyArray<string> = [
  "node_modules",
  "Tests",
  "build",
  "dist",
  "public",
];

const CALL: RegExp =
  /(new\s+Intl\.(NumberFormat|DateTimeFormat|RelativeTimeFormat)\s*\(|\.toLocale(Date|Time)?String\s*\()\s*/g;

// A fixed locale that is not the reader's language: a literal.
const FIXED: RegExp = /^("[^"]*"|'[^']*'|`[^`]*`)$/;

// A locale made for the language by the helpers that pin its digits.
const PINNED: RegExp =
  /^(getNumberLocale|getDateLocale|getFeedLocale|getReaderNumberLocale|getReaderDateLocale)\(/;
// A TypeScript source file, and a test file, which the guard skips.
const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;
const TEST_FILE: RegExp = /\.test\.tsx?$/;

/*
 * The calls that may take another locale, or none, each for its reason.
 * Keyed by the file and the locale argument as written ("" for none), with
 * how many such calls the file may hold.
 */
const ALLOWED: ReadonlyMap<string, number> = new Map<string, number>([
  // English, when Intl does not know the reader's language.
  ["Common/UI/Components/Calendar/Calendar.tsx ENGLISH_LANGUAGE", 2],
  // getDateLocale's own probe of the locale it has just pinned.
  ["Common/Types/DateLanguage.ts locale", 1],
  // getLocaleClockHourOption's probe of a pinned locale's own clock.
  ["Common/Types/DateLanguage.ts pinnedLocale", 1],
  // getReaderNumberLocale's read of the runtime's own locale.
  ["Common/Types/DateLanguage.ts ", 1],
  // Whether the browser's clock is a 12-hour one, and that probe's fallback.
  ["Common/Types/Date.ts undefined", 1],
  ["Common/Types/Date.ts ", 1],
  // formatNumber's fallback when Intl refuses the language's locale.
  ["Common/Types/Translator.ts ", 1],
]);

// The first argument of the call whose "(" ends at `start`, as written.
const firstArgument: (text: string, start: number) => string = (
  text: string,
  start: number,
): string => {
  let depth: number = 0;
  let index: number = start;

  while (index < text.length) {
    const character: string = text[index]!;

    if ("([{".includes(character)) {
      depth++;
    } else if (")]}".includes(character)) {
      if (depth === 0) {
        break;
      }

      depth--;
    } else if (character === "," && depth === 0) {
      break;
    }

    index++;
  }

  return text.slice(start, index).trim();
};

export const findBareLocaleCalls: (
  file: string,
  text: string,
) => Array<string> = (file: string, text: string): Array<string> => {
  const found: Array<string> = [];
  const allowedSoFar: Map<string, number> = new Map<string, number>();

  for (const match of text.matchAll(CALL)) {
    const argument: string = firstArgument(
      text,
      match.index! + match[0].length,
    );

    if (FIXED.test(argument) || PINNED.test(argument)) {
      continue;
    }

    const key: string = `${file} ${argument}`;
    const allowed: number = ALLOWED.get(key) || 0;
    const used: number = allowedSoFar.get(key) || 0;

    if (used < allowed) {
      allowedSoFar.set(key, used + 1);
      continue;
    }

    const line: number = text.slice(0, match.index!).split("\n").length;

    found.push(`${file}:${line} ${argument.replace(/\s+/g, " ")}`);
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

describe("Intl formatters take a pinned locale, never a bare language", () => {
  test("no product code formats from a bare language code", () => {
    const found: Array<string> = [];
    let calls: number = 0;

    for (const directory of DIRECTORIES) {
      for (const file of sourceFiles(path.join(PACKAGES, directory))) {
        const text: string = fs.readFileSync(file, "utf8");
        const relative: string = path
          .relative(PACKAGES, file)
          .split(path.sep)
          .join("/");

        calls += Array.from(text.matchAll(CALL)).length;
        found.push(...findBareLocaleCalls(relative, text));
      }
    }

    // The sweep reads the product's files: hundreds of calls.
    expect(calls).toBeGreaterThan(200);
    expect(found).toEqual([]);
  });

  test.each<[string, number]>([
    ["new Intl.NumberFormat(language, { style: 'percent' })", 1],
    ["new Intl.DateTimeFormat(translator.language || 'en', {})", 1],
    ["new Intl.RelativeTimeFormat(data.locale, { numeric: 'auto' })", 1],
    ["value.toLocaleString(i18n.language)", 1],
    ["date.toLocaleDateString(code, { month: 'long' })", 1],
    ["new Intl.NumberFormat(getNumberLocale(language)).format(1)", 0],
    ["new Intl.DateTimeFormat(getDateLocale(language), {})", 0],
    ["value.toLocaleString('en-US')", 0],
    ["new Intl.PluralRules(language).select(1)", 0],
    // No locale at all: the browser's, not the page's.
    ["value.toLocaleString()", 1],
    ["value.toLocaleString(undefined, { maximumFractionDigits: 1 })", 1],
    ["date.toLocaleTimeString([], { hour: '2-digit' })", 1],
    ["date.toLocaleDateString()", 1],
    ["new Intl.NumberFormat().format(1)", 1],
    ["new Intl.NumberFormat(undefined, { style: 'percent' })", 1],
    ["new Intl.DateTimeFormat(undefined, { hour: 'numeric' })", 1],
    ["`${a.toLocaleString()} of ${b.toLocaleString()}`", 2],
    // The page's language, in its digits.
    ["value.toLocaleString(getReaderNumberLocale())", 0],
    ["value.toLocaleString(getReaderNumberLocale(), { style: 'percent' })", 0],
    ["date.toLocaleDateString(getReaderDateLocale())", 0],
    ["new Intl.NumberFormat(getReaderNumberLocale()).format(1)", 0],
  ])("finds %p %p time(s)", (source: string, count: number) => {
    expect(findBareLocaleCalls("Example.ts", source)).toHaveLength(count);
  });

  test("a probe of the browser is allowed in its own file, as often as listed", () => {
    expect(
      findBareLocaleCalls(
        "Common/Types/Date.ts",
        "new Intl.DateTimeFormat(undefined, { hour: 'numeric' })",
      ),
    ).toEqual([]);
    expect(
      findBareLocaleCalls(
        "Common/Types/Date.ts",
        "new Intl.DateTimeFormat(undefined, {}); new Intl.DateTimeFormat(undefined, {})",
      ),
    ).toHaveLength(1);
    expect(
      findBareLocaleCalls("Common/Types/Other.ts", "value.toLocaleString()"),
    ).toHaveLength(1);
  });

  test("an allowed call is allowed only in its own file", () => {
    expect(
      findBareLocaleCalls(
        "Common/UI/Components/Calendar/Calendar.tsx",
        "new Intl.DateTimeFormat(ENGLISH_LANGUAGE, options)",
      ),
    ).toEqual([]);
    expect(
      findBareLocaleCalls(
        "Common/UI/Components/Other.tsx",
        "new Intl.DateTimeFormat(ENGLISH_LANGUAGE, options)",
      ),
    ).toHaveLength(1);
  });
});
