import {
  ExtractedString,
  scanSourceRoots,
  SourceRoot,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  LocaleProgress,
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A TEST PAGE, IN THE READER'S LANGUAGE (#6811).
 *
 * The dialog that sends a test page - to yourself, to a member, or a policy's
 * test - its preview, its cost, and the result it shows as it happens, each
 * message and where to fix one that did not go out: every sentence they draw
 * (as `npm run i18n:extract` finds it) is worded in each of the sixteen
 * languages besides English, as `npm run i18n:check` counts it, with its
 * placeholders kept. And the words the pages it is offered on gained - "Test
 * your pages", "Send test page", "Test this policy", the execution logs'
 * "Test page" - with them.
 */

const TEST_PAGE_ROOTS: Array<SourceRoot> = [
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Components/OnCallTestPage",
    kind: "ui",
  },
];

// The words the pages that offer a test page gained, and where each is drawn.
const WORDS_ON_THE_PAGES: Array<{ key: string; file: string }> = [
  {
    key: "Send test page",
    file: "packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/Readiness.tsx",
  },
  {
    key: "Test page: no incident or alert",
    file: "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable.tsx",
  },
  {
    key: "Test page",
    file: "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable.tsx",
  },
];

const REPOSITORY_ROOT: string = path.join(__dirname, "..", "..", "..", "..");

// Languages whose plurals have no "one" form: their "_one" key is never read.
const LANGUAGES_WITHOUT_ONE: ReadonlyArray<string> = [
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
];

const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;
const LETTER: RegExp = /\p{L}/u;

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const ENGLISH: Record<string, unknown> = readLocale("en");
const GLOBAL_SAME_AS_ENGLISH: Set<string> = new Set<string>(
  readGlobalSameAsEnglish(),
);

interface TestPageKey {
  key: string;
  file: string;
}

function getTestPageKeys(): Array<TestPageKey> {
  const keys: Map<string, string> = new Map<string, string>();

  for (const entry of scanSourceRoots(TEST_PAGE_ROOTS).strings) {
    if (entry.nestedPath) {
      continue;
    }

    const found: ExtractedString = entry;

    if (!keys.has(found.text)) {
      keys.set(found.text, found.file);
    }

    if (found.pluralOne !== undefined && !keys.has(`${found.text}_one`)) {
      keys.set(`${found.text}_one`, found.file);
    }
  }

  for (const word of WORDS_ON_THE_PAGES) {
    if (!keys.has(word.key)) {
      keys.set(word.key, word.file);
    }
  }

  return Array.from(keys.entries()).map(
    ([key, file]: [string, string]): TestPageKey => {
      return { key, file };
    },
  );
}

const TEST_PAGE_KEYS: Array<TestPageKey> = getTestPageKeys();

function isWorded(data: {
  key: string;
  language: string;
  locale: Record<string, unknown>;
  sameAsEnglish: Set<string>;
}): boolean {
  const english: unknown = ENGLISH[data.key];
  const value: unknown = data.locale[data.key];

  if (typeof english !== "string" || typeof value !== "string") {
    return false;
  }

  if (!value.trim()) {
    return false;
  }

  if (value !== english) {
    return true;
  }

  if (
    data.key.endsWith("_one") &&
    LANGUAGES_WITHOUT_ONE.includes(data.language)
  ) {
    return true;
  }

  if (!LETTER.test(english.replace(PLACEHOLDER, ""))) {
    return true;
  }

  return GLOBAL_SAME_AS_ENGLISH.has(english) || data.sameAsEnglish.has(english);
}

function placeholdersOf(text: string): Array<string> {
  return Array.from(new Set(text.match(PLACEHOLDER) || [])).sort();
}

describe("a test page's words in every language", () => {
  test("the dialog and its result draw words, every one of them in English", () => {
    expect(TEST_PAGE_KEYS.length).toBeGreaterThan(50);
    expect(
      TEST_PAGE_KEYS.filter((entry: TestPageKey): boolean => {
        return typeof ENGLISH[entry.key] !== "string";
      }),
    ).toEqual([]);

    const keys: Set<string> = new Set<string>(
      TEST_PAGE_KEYS.map((entry: TestPageKey): string => {
        return entry.key;
      }),
    );

    for (const key of [
      "Test your pages",
      "Send me a test page",
      "Acknowledged",
      "Not answered",
      "Open Notification Methods",
    ]) {
      expect({ key, found: keys.has(key) }).toEqual({ key, found: true });
    }
  });

  test("each word the pages gained is drawn where it is said to be", () => {
    for (const word of WORDS_ON_THE_PAGES) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, word.file),
        "utf8",
      );

      expect({
        key: word.key,
        drawn: source.includes(`"${word.key}"`),
      }).toEqual({ key: word.key, drawn: true });
    }
  });

  test.each(TRANSLATED_LOCALES)(
    "%s words every one of them",
    (language: string) => {
      const progress: LocaleProgress | undefined = readLocaleProgress(language);
      const sameAsEnglish: Set<string> = new Set<string>(
        progress ? progress.sameAsEnglish : [],
      );
      const locale: Record<string, unknown> = readLocale(language);

      const unworded: Array<string> = TEST_PAGE_KEYS.filter(
        (entry: TestPageKey): boolean => {
          return !isWorded({ key: entry.key, language, locale, sameAsEnglish });
        },
      ).map((entry: TestPageKey): string => {
        return `${entry.key} (${path.basename(entry.file)})`;
      });

      expect(unworded).toEqual([]);
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s keeps every placeholder of every sentence",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);
      const lost: Array<string> = [];

      for (const entry of TEST_PAGE_KEYS) {
        const english: unknown = ENGLISH[entry.key];
        const value: unknown = locale[entry.key];

        if (typeof english !== "string" || typeof value !== "string") {
          continue;
        }

        if (
          entry.key.endsWith("_one") &&
          !value.match(PLACEHOLDER) &&
          placeholdersOf(english).length <= 1
        ) {
          // A "one" form may say "one" rather than {{count}}.
          continue;
        }

        if (
          JSON.stringify(placeholdersOf(value)) !==
          JSON.stringify(placeholdersOf(english))
        ) {
          lost.push(entry.key);
        }
      }

      expect(lost).toEqual([]);
    },
  );
});
