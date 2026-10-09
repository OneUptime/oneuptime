import fs from "fs";
import path from "path";

/*
 * How each docs language names a piece of the Dashboard.
 *
 * A translated page names a screen, a menu item or a button the way the
 * Dashboard draws it in that language: the value of its English text in the
 * Dashboard's own locale file (Dashboard/src/Locales/<language>.json), or the
 * English text when the locale has no translation for it. Persian is the
 * exception: its pages have always kept the Dashboard's English names, and
 * its docs tests read them that way.
 *
 * A "Create <thing>" button is drawn from the template "Create {{itemName}}"
 * with the thing's own translated name, so it is translated the same way.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const LOCALES_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Locales",
);

// The languages whose pages write the Dashboard's names in English.
export const ENGLISH_UI_NAME_LANGUAGES: ReadonlyArray<string> = ["en", "fa"];

const CREATE_TEMPLATE: string = "Create {{itemName}}";
const ITEM_NAME_PLACEHOLDER: string = "{{itemName}}";
const CREATE_PREFIX: string = "Create ";

const cache: Map<string, Record<string, unknown>> = new Map();

type LocaleFunction = (language: string) => Record<string, unknown>;

export const dashboardLocale: LocaleFunction = (
  language: string,
): Record<string, unknown> => {
  const cached: Record<string, unknown> | undefined = cache.get(language);

  if (cached) {
    return cached;
  }

  const locale: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;

  cache.set(language, locale);

  return locale;
};

type TranslatedFunction = (language: string, english: string) => string | null;

// The locale's translation of a flat key, or null when it has none.
const translated: TranslatedFunction = (
  language: string,
  english: string,
): string | null => {
  const value: unknown = dashboardLocale(language)[english];

  return typeof value === "string" && value.trim() ? value : null;
};

type IsDashboardLabelFunction = (english: string) => boolean;

/*
 * Whether the Dashboard has this English text as a label: a key of its
 * English locale, or a "Create <thing>" button whose thing is one.
 */
export const isDashboardLabel: IsDashboardLabelFunction = (
  english: string,
): boolean => {
  if (translated("en", english) !== null) {
    return true;
  }

  return (
    english.startsWith(CREATE_PREFIX) &&
    translated("en", english.slice(CREATE_PREFIX.length)) !== null
  );
};

type DashboardLabelFunction = (language: string, english: string) => string;

// What a page in this language calls the Dashboard label written in English.
export const dashboardLabel: DashboardLabelFunction = (
  language: string,
  english: string,
): string => {
  if (ENGLISH_UI_NAME_LANGUAGES.includes(language)) {
    return english;
  }

  const direct: string | null = translated(language, english);

  if (direct !== null) {
    return direct;
  }

  if (english.startsWith(CREATE_PREFIX)) {
    const item: string = english.slice(CREATE_PREFIX.length);
    const itemName: string | null = translated(language, item);
    const template: string | null = translated(language, CREATE_TEMPLATE);

    if (itemName !== null && template !== null) {
      return template.replace(ITEM_NAME_PLACEHOLDER, itemName);
    }
  }

  return english;
};
