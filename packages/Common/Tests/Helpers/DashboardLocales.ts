import fs from "fs";
import path from "path";
import { createTranslator, Translator } from "../../Types/Translator";

/*
 * The Dashboard's locale files, read as its translations are shipped: for
 * a test that says a word reaches the reader in their language, from the
 * files themselves (App/FeatureSet/Dashboard/src/Locales).
 */

const DASHBOARD_DIR: string = path.resolve(
  __dirname,
  "../../../App/FeatureSet/Dashboard",
);

const LOCALES_DIR: string = path.join(DASHBOARD_DIR, "src/Locales");

// Every language the Dashboard is translated into, English aside.
export const DASHBOARD_LANGUAGES: ReadonlyArray<string> = [
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

// The languages whose plurals have no "one" form: their "_one" key is never read.
const LANGUAGES_WITHOUT_ONE: ReadonlyArray<string> = [
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
];

const cache: Map<string, Record<string, string>> = new Map<
  string,
  Record<string, string>
>();

export function readDashboardLocale(language: string): Record<string, string> {
  const cached: Record<string, string> | undefined = cache.get(language);

  if (cached) {
    return cached;
  }

  const words: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;

  cache.set(language, words);

  return words;
}

// A translator reading `language`'s file, as useTranslator does in the Dashboard.
export function dashboardTranslator(language: string): Translator {
  const words: Record<string, string> = readDashboardLocale(language);

  return createTranslator((text: string): string | undefined => {
    return Object.prototype.hasOwnProperty.call(words, text)
      ? words[text]
      : undefined;
  }, language);
}

const sameAsEnglishCache: Map<string, ReadonlyArray<string>> = new Map<
  string,
  ReadonlyArray<string>
>();

// The English a language keeps on purpose: every language's, then its own.
function readSameAsEnglish(language: string): ReadonlyArray<string> {
  const cached: ReadonlyArray<string> | undefined =
    sameAsEnglishCache.get(language);

  if (cached) {
    return cached;
  }

  const global: Array<string> = JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_DIR, "i18n/SameAsEnglish.json"),
      "utf8",
    ),
  ) as Array<string>;
  const progress: { sameAsEnglish?: Array<string> } = JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_DIR, "i18n/Progress", `${language}.json`),
      "utf8",
    ),
  ) as { sameAsEnglish?: Array<string> };

  const kept: ReadonlyArray<string> = [
    ...global,
    ...(progress.sameAsEnglish || []),
  ];

  sameAsEnglishCache.set(language, kept);

  return kept;
}

const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;
const LETTER: RegExp = /\p{L}/u;

/*
 * Whether `language` words `key` its own way, as the toolchain counts it
 * (npm run i18n:check): a value other than the English - or the same
 * English the language keeps on purpose (the same-as-English lists), a
 * text with no words of its own, or a "one" form a language never reads.
 */
export function isWordedInDashboardLocale(
  key: string,
  language: string,
): boolean {
  const english: string | undefined = readDashboardLocale("en")[key];
  const value: string | undefined = readDashboardLocale(language)[key];

  if (english === undefined || value === undefined || !value.trim()) {
    return false;
  }

  if (value !== english) {
    return true;
  }

  if (key.endsWith("_one") && LANGUAGES_WITHOUT_ONE.includes(language)) {
    return true;
  }

  if (!LETTER.test(english.replace(PLACEHOLDER, ""))) {
    return true;
  }

  return readSameAsEnglish(language).includes(english);
}

// The {{placeholders}} of a text, each once, sorted.
export function placeholdersOf(text: string): Array<string> {
  return Array.from(new Set(text.match(PLACEHOLDER) || [])).sort();
}
