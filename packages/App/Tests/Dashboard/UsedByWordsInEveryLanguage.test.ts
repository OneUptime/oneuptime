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
 * "USED BY" READS IN THE READER'S LANGUAGE (#6813).
 *
 * Every string the card, its list and the Delete and Archive dialogs draw
 * (Components/UsedBy), as `npm run i18n:extract` finds them, is worded in
 * each of the languages besides English, as the toolchain counts it (`npm
 * run i18n:check`): a value of its own, or the same English the language
 * keeps on purpose, or text with no words, or a "one" form a language never
 * reads. A translation keeps every {{placeholder}} the English has: the
 * count is the sentence's point.
 *
 * A word added to the card later is translated with it, or fails here.
 */

const USED_BY_DIRECTORY: string =
  "packages/App/FeatureSet/Dashboard/src/Components/UsedBy";

const USED_BY_ROOTS: Array<SourceRoot> = fs
  .readdirSync(path.join(__dirname, "../../../..", USED_BY_DIRECTORY))
  .filter((file: string): boolean => {
    return /\.tsx?$/u.test(file);
  })
  .sort()
  .map((file: string): SourceRoot => {
    return { directory: `${USED_BY_DIRECTORY}/${file}`, kind: "ui" };
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

interface UsedByKey {
  key: string;
  file: string;
}

// Every key the card reads: each text, and a plural's "one" form.
function getUsedByKeys(): Array<UsedByKey> {
  const keys: Map<string, string> = new Map<string, string>();

  for (const entry of scanSourceRoots(USED_BY_ROOTS).strings) {
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
    ([key, file]: [string, string]): UsedByKey => {
      return { key, file };
    },
  );
}

const USED_BY_KEYS: Array<UsedByKey> = getUsedByKeys();

const KEYS: Set<string> = new Set<string>(
  USED_BY_KEYS.map((entry: UsedByKey): string => {
    return entry.key;
  }),
);

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

  return USED_BY_KEYS.filter((entry: UsedByKey): boolean => {
    return !isWorded({
      key: entry.key,
      language: data.language,
      locale: data.locale,
      sameAsEnglish,
    });
  }).map((entry: UsedByKey): string => {
    return `${entry.key} (${path.basename(entry.file)})`;
  });
}

function getPlaceholderMismatches(
  locale: Record<string, unknown>,
): Array<string> {
  return USED_BY_KEYS.filter((entry: UsedByKey): boolean => {
    const english: unknown = ENGLISH[entry.key];
    const value: unknown = locale[entry.key];

    if (typeof english !== "string" || typeof value !== "string") {
      return false;
    }

    return (
      JSON.stringify(placeholders(value)) !==
      JSON.stringify(placeholders(english))
    );
  }).map((entry: UsedByKey): string => {
    return entry.key;
  });
}

describe("Used by's words in every language", () => {
  test("the card, its list and its dialogs draw words, every one of them in English", () => {
    expect(USED_BY_KEYS.length).toBeGreaterThan(90);
    expect(
      USED_BY_KEYS.filter((entry: UsedByKey): boolean => {
        return typeof ENGLISH[entry.key] !== "string";
      }),
    ).toEqual([]);

    for (const key of [
      "Used by",
      "Showing now",
      "See all",
      "Still in use",
      "{{count}} status pages show this monitor.",
      "{{count}} status pages show this monitor._one",
      "{{count}} on-call policies page this schedule.",
      "and {{count}} you can't see",
      "Nothing uses this schedule yet",
      "No on-call policy pages it, so nobody on it is paged. Add it to an on-call policy's escalation rule.",
    ]) {
      expect({ key, scanned: KEYS.has(key) }).toEqual({ key, scanned: true });
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

  test("a language holding the card's English as placeholders fails it", () => {
    const danish: Record<string, unknown> = readLocale("da");
    const placeholderCopy: Record<string, unknown> = { ...danish };

    for (const key of KEYS) {
      if (typeof ENGLISH[key] === "string") {
        placeholderCopy[key] = ENGLISH[key];
      }
    }

    const unworded: Array<string> = getUnworded({
      language: "da",
      locale: placeholderCopy,
    });

    expect(unworded.length).toBeGreaterThan(80);
    expect(unworded).toContain(
      "Nothing uses this schedule yet (UsedByWords.ts)",
    );
  });

  test("a translation that drops the count fails it", () => {
    const german: Record<string, unknown> = { ...readLocale("de") };

    german["{{count}} status pages show this monitor."] =
      "Statusseiten zeigen diesen Monitor.";

    expect(getPlaceholderMismatches(german)).toEqual([
      "{{count}} status pages show this monitor.",
    ]);
  });
});
