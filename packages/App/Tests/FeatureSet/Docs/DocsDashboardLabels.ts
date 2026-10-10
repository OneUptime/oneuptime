import fs from "fs";
import path from "path";

/*
 * How each docs language names a piece of the Dashboard.
 *
 * A translated page names a screen, a menu item or a button the way the
 * Dashboard draws it in that language: the value of its English text in the
 * Dashboard's own locale file (Dashboard/src/Locales/<language>.json), or the
 * English text when the locale has no translation for it.
 *
 * A "Create <thing>" or "Add <thing>" button is drawn from the template
 * "Create {{itemName}}" or "Add {{itemName}}" with the thing's own translated
 * name, so it is translated the same way, unless the locale has the whole
 * phrase (translateCreateAction looks the phrase up first, too).
 *
 * Persian: the incident pages have always kept the Dashboard's English names,
 * and dashboardLabel reads them that way. The on-call pages name the Dashboard
 * as the Persian Dashboard draws it, like every other language, and read it
 * with drawnDashboardLabel.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const LOCALES_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Locales",
);

// The languages whose pages write the Dashboard's names in English.
export const ENGLISH_UI_NAME_LANGUAGES: ReadonlyArray<string> = ["en", "fa"];

const ITEM_NAME_PLACEHOLDER: string = "{{itemName}}";

// The create buttons drawn from a verb's template, by the verb they start with.
const ACTION_TEMPLATES: ReadonlyArray<{ prefix: string; template: string }> = [
  { prefix: "Create ", template: "Create {{itemName}}" },
  { prefix: "Add ", template: "Add {{itemName}}" },
];

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
 * English locale, or a "Create <thing>" or "Add <thing>" button whose thing
 * is one.
 */
export const isDashboardLabel: IsDashboardLabelFunction = (
  english: string,
): boolean => {
  if (translated("en", english) !== null) {
    return true;
  }

  return ACTION_TEMPLATES.some(
    (action: { prefix: string; template: string }): boolean => {
      return (
        english.startsWith(action.prefix) &&
        translated("en", english.slice(action.prefix.length)) !== null
      );
    },
  );
};

type DashboardLabelFunction = (language: string, english: string) => string;

/*
 * What the Dashboard draws for the label written in English, in this
 * language: Persian included.
 */
export const drawnDashboardLabel: DashboardLabelFunction = (
  language: string,
  english: string,
): string => {
  if (language === "en") {
    return english;
  }

  const direct: string | null = translated(language, english);

  if (direct !== null) {
    return direct;
  }

  for (const action of ACTION_TEMPLATES) {
    if (!english.startsWith(action.prefix)) {
      continue;
    }

    const item: string = english.slice(action.prefix.length);
    const itemName: string | null = translated(language, item);
    const template: string | null = translated(language, action.template);

    if (itemName !== null && template !== null) {
      return template.replace(ITEM_NAME_PLACEHOLDER, itemName);
    }
  }

  return english;
};

/*
 * The other buttons a page draws from a template with a model's name:
 * "Duplicate Workflow", "Export Workflow", "Edit Workflow" and "Delete
 * Workflow Variable" (translateNamedAction, Common/UI/Utils/TranslateTemplate).
 * As there, the whole phrase is looked up first, then the template is filled
 * with the model's translated name.
 */
const NAMED_ACTION_TEMPLATES: ReadonlyArray<{
  prefix: string;
  template: string;
}> = [
  { prefix: "Duplicate ", template: "Duplicate {{itemName}}" },
  { prefix: "Export ", template: "Export {{itemName}}" },
  { prefix: "Edit ", template: "Edit {{itemName}}" },
  { prefix: "Delete ", template: "Delete {{itemName}}" },
];

/*
 * Whether the Dashboard has this English text as a label, a Create or Add
 * button included (isDashboardLabel), or draws it as a named action on a
 * model: "Duplicate Workflow" on a workflow's Settings page.
 */
export const isActionLabel: IsDashboardLabelFunction = (
  english: string,
): boolean => {
  if (isDashboardLabel(english)) {
    return true;
  }

  return NAMED_ACTION_TEMPLATES.some(
    (action: { prefix: string; template: string }): boolean => {
      return (
        english.startsWith(action.prefix) &&
        translated("en", english.slice(action.prefix.length)) !== null
      );
    },
  );
};

/*
 * What the Dashboard draws for a label or a named action written in English,
 * in this language: drawnDashboardLabel, then the named-action templates.
 */
export const drawnActionLabel: DashboardLabelFunction = (
  language: string,
  english: string,
): string => {
  const drawn: string = drawnDashboardLabel(language, english);

  if (language === "en" || drawn !== english) {
    return drawn;
  }

  for (const action of NAMED_ACTION_TEMPLATES) {
    if (!english.startsWith(action.prefix)) {
      continue;
    }

    const itemName: string | null = translated(
      language,
      english.slice(action.prefix.length),
    );
    const template: string | null = translated(language, action.template);

    if (itemName !== null && template !== null) {
      return template.replace(ITEM_NAME_PLACEHOLDER, itemName);
    }
  }

  return english;
};

// What a page in this language calls the Dashboard label written in English.
export const dashboardLabel: DashboardLabelFunction = (
  language: string,
  english: string,
): string => {
  if (ENGLISH_UI_NAME_LANGUAGES.includes(language)) {
    return english;
  }

  return drawnDashboardLabel(language, english);
};
