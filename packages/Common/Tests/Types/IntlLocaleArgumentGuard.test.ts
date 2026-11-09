import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NO NUMBER, DATE OR TIME IS FORMATTED FROM A BARE LANGUAGE CODE.
 *
 * Arabic writes Latin digits in OneUptime (DateLanguage's
 * LATIN_DIGIT_LANGUAGES), but Intl writes "ar" in Arabic-Indic digits in
 * Safari, so a count, a percentage or a date formatted from the reader's
 * bare language would read "٥" on one machine and "5" on another. Every
 * Intl.NumberFormat, Intl.DateTimeFormat, Intl.RelativeTimeFormat and
 * toLocale*String call in product code that is handed a language takes its
 * locale from getNumberLocale or getDateLocale (or getFeedLocale, which reads
 * getDateLocale), or names a fixed locale ("en-US"). A call with no locale
 * at all follows the browser, and is not this guard's business.
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

// A locale that is not the reader's language: a literal, or none.
const FIXED: RegExp = /^("[^"]*"|'[^']*'|`[^`]*`|undefined|\[\]|)$/;

// A locale made for the language by the helpers that pin its digits.
const PINNED: RegExp = /^(getNumberLocale|getDateLocale|getFeedLocale)\(/;

/*
 * The calls that may take another locale, each for its reason. Keyed by the
 * file and the locale argument as written.
 */
const ALLOWED: ReadonlyArray<string> = [
  // English, when Intl does not know the reader's language.
  "Common/UI/Components/Calendar/Calendar.tsx ENGLISH_LANGUAGE",
  // getDateLocale's own probe of the locale it has just pinned.
  "Common/Types/DateLanguage.ts locale",
];

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

  for (const match of text.matchAll(CALL)) {
    const argument: string = firstArgument(
      text,
      match.index! + match[0].length,
    );

    if (FIXED.test(argument) || PINNED.test(argument)) {
      continue;
    }

    if (ALLOWED.includes(`${file} ${argument}`)) {
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

    if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
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
    ["value.toLocaleString()", 0],
    ["value.toLocaleString(undefined, { maximumFractionDigits: 1 })", 0],
    ["new Intl.PluralRules(language).select(1)", 0],
  ])("finds %p %p time(s)", (source: string, count: number) => {
    expect(findBareLocaleCalls("Example.ts", source)).toHaveLength(count);
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
