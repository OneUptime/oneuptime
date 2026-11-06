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
 * RECOMMENDED MONITORS IN THE READER'S LANGUAGE (#6150's UI review).
 *
 * The Recommendations pages - a host's, a cluster's, a database's, a cloud
 * resource's and a cloud account's, an App Platforms app's - share their
 * words: the coverage bar and the tiles, the search and the severity
 * filter, the cards, the selection bar, the create panel and its progress,
 * the dismiss dialog and the notes on why a resource is offered fewer.
 * Some ninety of them were English in twelve to fifteen languages: a
 * Persian or an Italian page read "Recommended Monitors", "Already created"
 * and "Create Monitors" in English around its own words, and the coverage
 * bar's "recommended monitors created" was English in every language - a
 * bare string the extractor never saw. Every string the shared
 * Recommendations components draw (Components/Recommendations, as `npm run
 * i18n:extract` finds them) is worded now in each of the sixteen languages
 * besides English, as the toolchain counts it (`npm run i18n:check`): a
 * value of its own, or the same English the language keeps on purpose (the
 * same-as-English lists), or text with no words, or a "one" form a
 * language never reads.
 *
 * A word added to these pages later is translated with it, or fails here.
 */

const RECOMMENDATION_ROOTS: Array<SourceRoot> = [
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Components/Recommendations",
    kind: "ui",
  },
];

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

interface RecommendationKey {
  key: string;
  file: string;
}

// Every key the pages read: each text, and a plural's "one" form.
function getRecommendationKeys(): Array<RecommendationKey> {
  const keys: Map<string, string> = new Map<string, string>();

  for (const entry of scanSourceRoots(RECOMMENDATION_ROOTS).strings) {
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
    ([key, file]: [string, string]): RecommendationKey => {
      return { key, file };
    },
  );
}

const RECOMMENDATION_KEYS: Array<RecommendationKey> = getRecommendationKeys();

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

describe("the Recommendations pages' words in every language", () => {
  test("the shared Recommendations components draw words, every one of them in English", () => {
    // The scan finds the pages' words, and each is an en.json key.
    expect(RECOMMENDATION_KEYS.length).toBeGreaterThan(150);
    expect(
      RECOMMENDATION_KEYS.filter((entry: RecommendationKey): boolean => {
        return typeof ENGLISH[entry.key] !== "string";
      }),
    ).toEqual([]);

    const keys: Set<string> = new Set<string>(
      RECOMMENDATION_KEYS.map((entry: RecommendationKey): string => {
        return entry.key;
      }),
    );

    // The words this review worded, among them.
    for (const key of [
      "Recommended Monitors",
      "Already created",
      "Create Monitors",
      "Search recommendations...",
      // The coverage bar's words, a key the extractor sees since.
      "recommended monitors created",
      // A cloud account's rows and its types.
      "Show resources",
      "Recommended for {{count}} resources",
      "Recommended for {{count}} resources_one",
    ]) {
      expect(keys.has(key)).toBe(true);
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

      const unworded: Array<string> = RECOMMENDATION_KEYS.filter(
        (entry: RecommendationKey): boolean => {
          return !isWorded({
            key: entry.key,
            language,
            locale,
            sameAsEnglish,
          });
        },
      ).map((entry: RecommendationKey): string => {
        return `${entry.key} (${path.basename(entry.file)})`;
      });

      expect(unworded).toEqual([]);
    },
  );
});
