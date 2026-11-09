import {
  ExtractedString,
  HardcodedString,
  SourceScanResult,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHY A RUM APPLICATION'S EXCEPTIONS AND LOGS ARE EMPTY, IN EVERY LANGUAGE
 * (issue #5770).
 *
 * The empty Exceptions and Logs charts, the empty Logs page, the dialogs
 * that set each up and the setup check on the Documentation tab say why a
 * signal is missing and what fixes it. A reader on a German or a Persian
 * Dashboard meets those words where nothing else explains the gap, so
 * every one is a key of the English locale, worded in all sixteen
 * languages with its placeholders and the code it names intact - and the
 * components draw no word of their own outside a lookup.
 */

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");
const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

const LANGUAGES: ReadonlyArray<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

type Locale = Record<string, unknown>;

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function localeOf(language: string): Locale {
  return readJson(
    path.join(DASHBOARD, `src/Locales/${language}.json`),
  ) as Locale;
}

const ENGLISH: Locale = localeOf("en");

// Brand and product names every language writes as English does.
const SAME_AS_ENGLISH: ReadonlyArray<string> = readJson(
  path.join(DASHBOARD, "i18n/SameAsEnglish.json"),
) as Array<string>;

/*
 * Words one language writes as English does on purpose - German says
 * "Traces" too - as its progress file lists them.
 */
function sameAsEnglishIn(language: string): ReadonlyArray<string> {
  const progress: { sameAsEnglish?: Array<string> } = readJson(
    path.join(DASHBOARD, `i18n/Progress/${language}.json`),
  ) as { sameAsEnglish?: Array<string> };

  return [...SAME_AS_ENGLISH, ...(progress.sameAsEnglish || [])];
}

const SETUP_CHECK_DIRECTORY: string = path.join(
  DASHBOARD,
  "src/Components/Rum/SetupCheck",
);

const SOURCE_FILE: RegExp = /\.tsx?$/;

// Every file of the diagnosis, and the setup dialogs' guide.
const SOURCE_FILES: ReadonlyArray<string> = [
  ...fs
    .readdirSync(SETUP_CHECK_DIRECTORY)
    .filter((name: string): boolean => {
      return SOURCE_FILE.test(name);
    })
    .map((name: string): string => {
      return path.join(SETUP_CHECK_DIRECTORY, name);
    }),
  path.join(DASHBOARD, "src/Components/Rum/RumSignalSetupGuide.ts"),
];

function scan(file: string): SourceScanResult {
  return scanSourceText(
    path.relative(REPOSITORY_ROOT, file),
    fs.readFileSync(file, "utf8"),
    { kind: "ui" },
  );
}

const SCANS: Array<{ file: string; result: SourceScanResult }> =
  SOURCE_FILES.map((file: string) => {
    return { file, result: scan(file) };
  });

/*
 * Each word, and a plural's "one" sentence beside it (its "_one" key).
 * Words the diagnosis borrows from screens that already translate them -
 * "Exceptions", "Logs", "Try again", "Done" - are among them, so a reader
 * never meets one of them in English here either.
 */
interface Word {
  key: string;
  english: string;
}

const WORDS: Array<Word> = [];

for (const { result } of SCANS) {
  for (const entry of result.strings as Array<ExtractedString>) {
    WORDS.push({ key: entry.text, english: entry.text });

    if (entry.pluralOne) {
      WORDS.push({ key: `${entry.text}_one`, english: entry.pluralOne });
    }
  }
}

// The Exceptions tile's word for an app that has never reported one.
WORDS.push({ key: "not set up", english: "not set up" });

// The arrival columns' titles, as a model's columns are listed.
for (const title of [
  "Traces Last Received At",
  "Logs Last Received At",
  "Metrics Last Received At",
  "Signal Arrivals Tracked Since",
]) {
  WORDS.push({ key: title, english: title });
}

function placeholdersOf(text: string): Array<string> {
  return (text.match(/\{\{\w+\}\}/g) || []).sort();
}

// Code a sentence names, which no language translates.
const CODE: RegExp = /src\/telemetry\.ts|web-vitals|try\/catch|OTLP/g;

function codeOf(text: string): Array<string> {
  return (text.match(CODE) || []).sort();
}

describe("the RUM setup diagnosis's words", () => {
  test("the scan finds the diagnosis's sentences", () => {
    const keys: Array<string> = WORDS.map((word: Word): string => {
      return word.key;
    });

    for (const sentence of [
      "Logs aren't set up",
      "Exceptions aren't set up",
      "The last log arrived {{time}}.",
      "Nothing has arrived from this app since {{date}}.",
      "Setup check",
      "Not set up. Nothing has arrived since {{date}}.",
      "Report the errors {{application}} throws, so they appear under Exceptions.",
      "Add a log pipeline to src/telemetry.ts",
      "Show the past 3 months",
      "Session Replay recorded {{count}} sessions with errors in this time range, so errors do happen._one",
    ]) {
      expect(keys).toContain(sentence);
    }

    expect(WORDS.length).toBeGreaterThan(70);
  });

  test("the components draw no word outside a lookup", () => {
    const hardcoded: Array<{ file: string; text: string }> = [];

    for (const { file, result } of SCANS) {
      for (const entry of result.hardcoded as Array<HardcodedString>) {
        hardcoded.push({
          file: path.relative(REPOSITORY_ROOT, file),
          text: entry.text,
        });
      }
    }

    expect(hardcoded).toEqual([]);
  });

  test("every one is a key of the English locale, holding its English", () => {
    for (const word of WORDS) {
      expect({ key: word.key, english: ENGLISH[word.key] }).toEqual({
        key: word.key,
        english: word.english,
      });
    }
  });

  test.each(LANGUAGES)("%s words every one of them", (language: string) => {
    const words: Locale = localeOf(language);
    const sameAsEnglish: ReadonlyArray<string> = sameAsEnglishIn(language);
    const english: Array<string> = WORDS.filter((word: Word): boolean => {
      const worded: unknown = words[word.key];

      if (typeof worded !== "string") {
        return true;
      }

      return worded === word.english && !sameAsEnglish.includes(word.key);
    }).map((word: Word): string => {
      return word.key;
    });

    expect({ language, english }).toEqual({ language, english: [] });
  });

  test.each(LANGUAGES)(
    "%s keeps every placeholder and every piece of code as written",
    (language: string) => {
      const words: Locale = localeOf(language);

      for (const word of WORDS) {
        const worded: string = String(words[word.key]);

        expect({
          language,
          key: word.key,
          placeholders: placeholdersOf(worded),
          code: codeOf(worded),
        }).toEqual({
          language,
          key: word.key,
          placeholders: placeholdersOf(word.english),
          code: codeOf(word.english),
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s keeps the not-set-up and quiet answers apart",
    (language: string) => {
      const words: Locale = localeOf(language);
      const answers: Array<string> = [
        "Logs aren't set up",
        "No logs in this time range",
        "Nothing has arrived from this app yet",
        "Couldn't check why there are no logs",
      ].map((key: string): string => {
        return String(words[key]);
      });

      expect(new Set(answers).size).toBe(answers.length);
    },
  );
});
