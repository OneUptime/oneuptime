import fs from "fs";
import path from "path";
import { createTranslator, Translator } from "../../Types/Translator";
import { getSameAsEnglishMarks } from "../../UI/esbuild-locales";
import { DASHBOARD_LANGUAGES } from "./TranslatedLanguages";

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

/*
 * Every language the Dashboard is translated into, English aside: the list
 * the Dashboard offers its readers (TranslatedLanguages).
 */
export { DASHBOARD_LANGUAGES };

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

const shippedCache: Map<string, Record<string, string>> = new Map<
  string,
  Record<string, string>
>();

/*
 * `language`'s file with what the Dashboard's bundle adds to it: the mark of
 * each "_one" form the language words as English does on purpose
 * (getSameAsEnglishMarks, Common/UI/esbuild-locales.js), which tells the
 * lookup the form is the language's own - French "0 signal", not English's
 * "0 signals".
 */
function readShippedDashboardLocale(language: string): Record<string, string> {
  const cached: Record<string, string> | undefined = shippedCache.get(language);

  if (cached) {
    return cached;
  }

  const words: Record<string, string> = readDashboardLocale(language);
  const shipped: Record<string, string> =
    language === "en"
      ? words
      : {
          ...words,
          ...getSameAsEnglishMarks({
            language: language,
            locale: words,
            fallback: readDashboardLocale("en"),
            sameAsEnglish: readDashboardSameAsEnglish(language),
          }),
        };

  shippedCache.set(language, shipped);

  return shipped;
}

// A translator reading `language`'s file, as useTranslator does in the Dashboard.
export function dashboardTranslator(language: string): Translator {
  const words: Record<string, string> = readShippedDashboardLocale(language);

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
export function readDashboardSameAsEnglish(
  language: string,
): ReadonlyArray<string> {
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

  return readDashboardSameAsEnglish(language).includes(english);
}

// The {{placeholders}} of a text, each once, sorted.
export function placeholdersOf(text: string): Array<string> {
  return Array.from(new Set(text.match(PLACEHOLDER) || [])).sort();
}
