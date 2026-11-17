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
 * "WHO WAS TOLD" READS IN THE READER'S LANGUAGE (#7075).
 *
 * The card an incident's and an alert's overview draws - who OneUptime
 * told, by what, what failed and why, who was not paged, the channels and
 * the status page subscribers, and what the reader may not read, counted -
 * ships worded in each of the sixteen languages besides English, as the
 * toolchain counts it (`npm run i18n:check`): a value of its own, or the
 * same English the language keeps on purpose, or text with no words, or a
 * "one" form a language never reads. A translation keeps every
 * {{placeholder}} the English has, or the names and counts it carries are
 * lost. A word added to the card later is translated with it, or fails here.
 */

const WHO_WAS_TOLD_DIRECTORY: string =
  "packages/App/FeatureSet/Dashboard/src/Components/WhoWasTold";

const WHO_WAS_TOLD_ROOTS: Array<SourceRoot> = [
  "WhoWasToldCard.tsx",
  "WhoWasToldCopy.ts",
  "WhoWasToldWords.ts",
  "WhoWasToldApi.ts",
].map((file: string): SourceRoot => {
  return { directory: `${WHO_WAS_TOLD_DIRECTORY}/${file}`, kind: "ui" };
});

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

function placeholders(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || [])
    .map((placeholder: string): string => {
      return placeholder.replace(/\s+/g, "");
    })
    .sort();
}

const ENGLISH: Record<string, unknown> = readLocale("en");
const GLOBAL_SAME_AS_ENGLISH: Set<string> = new Set<string>(
  readGlobalSameAsEnglish(),
);

interface WordKey {
  key: string;
  file: string;
}

// Every key the card reads: each text, and a plural's "one" form.
function getKeys(): Array<WordKey> {
  const keys: Map<string, string> = new Map<string, string>();

  for (const entry of scanSourceRoots(WHO_WAS_TOLD_ROOTS).strings) {
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

  return Array.from(keys.entries()).map(
    ([key, file]: [string, string]): WordKey => {
      return { key, file };
    },
  );
}

const KEYS: Array<WordKey> = getKeys();
const KEY_SET: Set<string> = new Set<string>(
  KEYS.map((entry: WordKey): string => {
    return entry.key;
  }),
);

// Whether `language` words `key` its own way, as npm run i18n:check counts it.
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

function getUnworded(data: {
  language: string;
  locale: Record<string, unknown>;
}): Array<string> {
  const progress: LocaleProgress | undefined = readLocaleProgress(
    data.language,
  );
  const sameAsEnglish: Set<string> = new Set<string>(
    progress ? progress.sameAsEnglish : [],
  );

  return KEYS.filter((entry: WordKey): boolean => {
    return !isWorded({
      key: entry.key,
      language: data.language,
      locale: data.locale,
      sameAsEnglish,
    });
  }).map((entry: WordKey): string => {
    return `${entry.key} (${path.basename(entry.file)})`;
  });
}

function getPlaceholderMismatches(
  locale: Record<string, unknown>,
): Array<string> {
  return KEYS.filter((entry: WordKey): boolean => {
    const english: unknown = ENGLISH[entry.key];
    const value: unknown = locale[entry.key];

    if (typeof english !== "string" || typeof value !== "string") {
      return false;
    }

    return (
      JSON.stringify(placeholders(value)) !==
      JSON.stringify(placeholders(english))
    );
  }).map((entry: WordKey): string => {
    return entry.key;
  });
}

// The words #7075 added: the card's own.
const NEW_KEYS: Array<string> = [
  "Who Was Told",
  "Who OneUptime told about this incident, by what, and what failed, as it happened.",
  "Who OneUptime told about this alert, by what, and what failed, as it happened.",
  "Nobody has been told about this incident yet.",
  "Nobody has been told about this alert yet.",
  "OneUptime told {{count}} people.",
  "OneUptime told {{people}} and posted to {{channels}}.",
  "{{name}} acknowledged it {{time}} after the first page.",
  "{{count}} notifications failed.",
  "{{count}} notifications aren't listed: you can't open their logs.",
  "{{count}} on-call policy runs aren't listed: you can't see their policies.",
  "Paged by {{policy}}",
  "Paged directly",
  "Not notified",
];

describe("Who Was Told's words in every language", () => {
  test("the card draws words, every one of them in English", () => {
    expect(KEYS.length).toBeGreaterThan(30);
    expect(
      KEYS.filter((entry: WordKey): boolean => {
        return typeof ENGLISH[entry.key] !== "string";
      }),
    ).toEqual([]);

    for (const key of NEW_KEYS) {
      expect({ key, scanned: KEY_SET.has(key) }).toEqual({
        key,
        scanned: true,
      });
      expect(ENGLISH[key]).toBe(key);
    }
  });

  test.each(TRANSLATED_LOCALES)(
    "%s words every one of them",
    (language: string) => {
      expect(getUnworded({ language, locale: readLocale(language) })).toEqual(
        [],
      );
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s keeps every placeholder a sentence carries",
    (language: string) => {
      expect(getPlaceholderMismatches(readLocale(language))).toEqual([]);
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s words the card's own words its own way",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);

      for (const key of NEW_KEYS) {
        const value: unknown = locale[key];

        expect({ key, isString: typeof value === "string" }).toEqual({
          key,
          isString: true,
        });
        expect({ key, value }).not.toEqual({ key, value: key });
      }
    },
  );

  test("a language holding the card's English as placeholders fails it", () => {
    const danish: Record<string, unknown> = { ...readLocale("da") };

    for (const key of KEY_SET) {
      if (typeof ENGLISH[key] === "string") {
        danish[key] = ENGLISH[key];
      }
    }

    const unworded: Array<string> = getUnworded({
      language: "da",
      locale: danish,
    });

    expect(unworded).toContain("Who Was Told (WhoWasToldCopy.ts)");
    expect(unworded).toContain("Paged by {{policy}} (WhoWasToldCopy.ts)");
  });

  test("a translation that drops the names it carries fails it", () => {
    const german: Record<string, unknown> = { ...readLocale("de") };

    german["Paged by {{policy}}"] = "Alarmiert über eine Richtlinie";

    expect(getPlaceholderMismatches(german)).toEqual(["Paged by {{policy}}"]);
  });
});
