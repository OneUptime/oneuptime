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
 * CLOUD READS IN THE READER'S LANGUAGE (#5646's review, its gap 9: "older
 * Cloud words in English in most languages").
 *
 * Cloud's pages kept some 120 words in English in twelve to sixteen
 * languages: the connection guide an environment links to (its steps,
 * where to keep the token, what to check when nothing arrives), the (i)
 * of the live CPU and memory tiles, a resource's feed, the owner and label
 * rules' help, the AI access columns. Every string Cloud's components and
 * pages draw (Components/Cloud, Pages/Cloud, as `npm run i18n:extract`
 * finds them) is worded now in each of the sixteen languages besides
 * English, as the toolchain counts it (`npm run i18n:check`): a value of
 * its own, or the same English the language keeps on purpose (the
 * same-as-English lists: "USD"; "{{count}} app" in Danish), or text with
 * no words, or a "one" form a language never reads.
 *
 * A word added to Cloud's pages later is translated with it, or fails here.
 */

const CLOUD_ROOTS: Array<SourceRoot> = [
  {
    directory: "packages/App/FeatureSet/Dashboard/src/Components/Cloud",
    kind: "ui",
  },
  {
    directory: "packages/App/FeatureSet/Dashboard/src/Pages/Cloud",
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

interface CloudKey {
  key: string;
  file: string;
}

// Every key Cloud's pages read: each text, and a plural's "one" form.
function getCloudKeys(): Array<CloudKey> {
  const keys: Map<string, string> = new Map<string, string>();

  for (const entry of scanSourceRoots(CLOUD_ROOTS).strings) {
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
    ([key, file]: [string, string]): CloudKey => {
      return { key, file };
    },
  );
}

const CLOUD_KEYS: Array<CloudKey> = getCloudKeys();

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

describe("Cloud's words in every language", () => {
  test("Cloud's components and pages draw words, every one of them in English", () => {
    // The scan finds the pages' words, and each is an en.json key.
    expect(CLOUD_KEYS.length).toBeGreaterThan(500);
    expect(
      CLOUD_KEYS.filter((entry: CloudKey): boolean => {
        return typeof ENGLISH[entry.key] !== "string";
      }),
    ).toEqual([]);
    // The older words this follow-up worded, among them.
    const keys: Set<string> = new Set<string>(
      CLOUD_KEYS.map((entry: CloudKey): string => {
        return entry.key;
      }),
    );
    for (const key of [
      "Where does your app run?",
      "Store the token in Secrets Manager",
      "Waiting for telemetry",
      "No activity has been recorded for this cloud resource yet.",
      "Case-insensitive regex matched against the resource name and description.",
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

      const unworded: Array<string> = CLOUD_KEYS.filter(
        (entry: CloudKey): boolean => {
          return !isWorded({
            key: entry.key,
            language,
            locale,
            sameAsEnglish,
          });
        },
      ).map((entry: CloudKey): string => {
        return `${entry.key} (${path.basename(entry.file)})`;
      });

      expect(unworded).toEqual([]);
    },
  );
});
