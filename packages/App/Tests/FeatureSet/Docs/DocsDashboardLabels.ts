import {
  TemplateValues,
  Translator,
  createTranslator,
  translateNamedAction,
} from "Common/UI/Utils/TranslateTemplate";
import {
  SloBudgetRunwayKind,
  SloProjectionTone,
} from "Common/Utils/Slo/SloProjection";
import fs from "fs";
import path from "path";
import {
  getErrorBudgetRemainingOfTotalInLanguage,
  getRollingWindowFillTextInLanguage,
  getSloBudgetRunwayTextInLanguage,
} from "../../../FeatureSet/Dashboard/src/Components/Slo/SloOverviewTextInLanguage";

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

/*
 * The Dashboard's translator in this language, reading its locale file: a
 * value that is still the English is no wording at all, as on the screen.
 */
export const dashboardTranslator: (language: string) => Translator = (
  language: string,
): Translator => {
  const locale: Record<string, unknown> = dashboardLocale(language);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];

    return typeof value === "string" ? value : undefined;
  }, language);
};

// The seconds of each unit of an English compact duration: "4d 23m", "12m 30s".
const COMPACT_UNIT_SECONDS: Record<string, number> = {
  d: 86400,
  h: 3600,
  m: 60,
  s: 1,
};

// One part of an English compact duration: "23m".
const COMPACT_PART: RegExp = /^(\d+)([dhms])$/;

// The seconds an English compact duration says, or null for any other text.
const compactDurationSeconds: (text: string | undefined) => number | null = (
  text: string | undefined,
): number | null => {
  const parts: Array<string> = (text || "").split(" ");
  let seconds: number = 0;

  for (const part of parts) {
    const match: RegExpExecArray | null = COMPACT_PART.exec(part);

    if (!match) {
      return null;
    }

    seconds += Number(match[1]) * (COMPACT_UNIT_SECONDS[match[2]!] || 0);
  }

  return seconds;
};

interface TextWithFigures {
  // The text in English, each figure in it caught.
  english: RegExp;
  // The Dashboard's own drawing of it from those figures, or null when they are none.
  draw: (figures: Array<string>, translator: Translator) => string | null;
}

/*
 * The Dashboard's texts with figures in them that the docs quote: the SLO
 * Overview's window chip, "Window 23% full" - the locale's "Window
 * {{percent}}% full" with 23 put in - its error budget lines, "12m 30s left
 * of 43m 12s" and "4d 23m over budget · 5m 47s allowed", and its runway,
 * "~2d 5h". Each is drawn by the Dashboard's own helper
 * (SloOverviewTextInLanguage), handed the figures of the English text.
 */
const TEXTS_WITH_FIGURES: ReadonlyArray<TextWithFigures> = [
  {
    english: /^Window (\d+)% full$/,
    draw: (figures: Array<string>, translator: Translator): string => {
      const percent: number = Number(figures[0]);

      return getRollingWindowFillTextInLanguage(
        {
          fraction: percent / 100,
          percent: percent,
          label: `Window ${percent}% full`,
          isNotYetFull: true,
        },
        translator,
      );
    },
  },
  {
    english: /^(\d+[dhms](?: \d+[dhms])*) left of (\d+[dhms](?: \d+[dhms])*)$/,
    draw: (figures: Array<string>, translator: Translator): string | null => {
      const remaining: number | null = compactDurationSeconds(figures[0]);
      const total: number | null = compactDurationSeconds(figures[1]);

      if (remaining === null || total === null) {
        return null;
      }

      return getErrorBudgetRemainingOfTotalInLanguage(
        { remainingSeconds: remaining, totalSeconds: total },
        translator,
      );
    },
  },
  {
    english:
      /^(\d+[dhms](?: \d+[dhms])*) over budget · (\d+[dhms](?: \d+[dhms])*) allowed$/,
    draw: (figures: Array<string>, translator: Translator): string | null => {
      const overage: number | null = compactDurationSeconds(figures[0]);
      const total: number | null = compactDurationSeconds(figures[1]);

      if (overage === null || total === null) {
        return null;
      }

      // The tile is handed the budget left, which is negative once it is overspent.
      return getErrorBudgetRemainingOfTotalInLanguage(
        { remainingSeconds: -overage, totalSeconds: total },
        translator,
      );
    },
  },
  {
    english: /^~(\d+[dhms](?: \d+[dhms])*)$/,
    draw: (figures: Array<string>, translator: Translator): string | null => {
      const runway: number | null = compactDurationSeconds(figures[0]);

      if (runway === null) {
        return null;
      }

      return getSloBudgetRunwayTextInLanguage(
        {
          runway: {
            kind: SloBudgetRunwayKind.RunsOut,
            tone: SloProjectionTone.Warning,
            value: `~${figures[0]}`,
            description: "",
            runwaySeconds: runway,
            secondsUntilReset: null,
          },
          errorBudgetRemainingSeconds: null,
          windowDays: null,
        },
        translator,
      ).value;
    },
  },
];

/*
 * What this language's Dashboard draws for a text with figures written in
 * English (TEXTS_WITH_FIGURES): its words, its units and its digits - "۲۳"
 * in Persian. Null when the Dashboard draws no such text, or draws it in
 * English other than as written, as a figure it would never write.
 */
export const drawnTextWithFigures: (
  language: string,
  english: string,
) => string | null = (language: string, english: string): string | null => {
  for (const text of TEXTS_WITH_FIGURES) {
    const match: RegExpExecArray | null = text.english.exec(english);

    if (!match) {
      continue;
    }

    const figures: Array<string> = match.slice(1);

    if (text.draw(figures, dashboardTranslator("en")) !== english) {
      continue;
    }

    return text.draw(figures, dashboardTranslator(language));
  }

  return null;
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

const CREATE_PREFIX: string = "Create ";

/*
 * The verbs a table's create button may name (BaseModelTable's
 * createVerb), each drawn from its own template.
 */
const TABLE_BUTTON_VERBS: ReadonlyArray<string> = ["Create", "Add"];

/*
 * A table's create button with any verb its table names, as the Dashboard
 * draws it in this language: "Create API Key", or "Add Item" where the
 * table's createVerb is "Add" (the Inventory list, an API key's
 * permissions). Like translateCreateAction: the whole phrase when the locale
 * words it, else the verb's template with the thing's name in it.
 */
export const drawnTableButton: DashboardLabelFunction = (
  language: string,
  english: string,
): string => {
  const verb: string | undefined = TABLE_BUTTON_VERBS.find(
    (candidate: string): boolean => {
      return english.startsWith(`${candidate} `);
    },
  );

  if (!verb) {
    throw new Error(`Not a table's create button: ${english}`);
  }

  const locale: Record<string, unknown> = dashboardLocale(language);

  return translateNamedAction(
    createTranslator((text: string): string | undefined => {
      const value: unknown = locale[text];

      return typeof value === "string" ? value : undefined;
    }, language),
    {
      template: `${verb} {{itemName}}`,
      itemName: english.slice(verb.length + 1),
    },
  );
};

/*
 * A table's create button, as the Dashboard draws it in this language: a
 * ModelTable names its button "Create <its singularName>" and draws it with
 * translateCreateAction - the whole phrase when the locale words it, else
 * the locale's "Create {{itemName}}" with the thing's name in it.
 *
 * The Dashboard's translator reads a value that is still the English as no
 * wording at all. drawnDashboardLabel takes such a value as the label, so
 * where a locale still holds "Create Twilio Config" as the English it names
 * the English phrase, while the Italian screen reads "Crea: Configurazione
 * Twilio". A page that names a table's create button reads it here.
 */
export const drawnCreateButton: DashboardLabelFunction = (
  language: string,
  english: string,
): string => {
  if (!english.startsWith(CREATE_PREFIX)) {
    throw new Error(`Not a create button: ${english}`);
  }

  const locale: Record<string, unknown> = dashboardLocale(language);

  return translateNamedAction(
    createTranslator((text: string): string | undefined => {
      const value: unknown = locale[text];

      return typeof value === "string" ? value : undefined;
    }, language),
    {
      template: "Create {{itemName}}",
      itemName: english.slice(CREATE_PREFIX.length),
    },
  );
};

/*
 * A label the Dashboard builds from a sentence and a value (#6703): the
 * Security Events diagnostics' "Preview {{records}}" with the records a
 * connector imports, the run details' "Returned by {{provider}}" with the
 * provider's name, the connection form's "Remove the stored {{field}}" with
 * a setting's title. The English label is no key, so a page cannot look it
 * up: it names the template and the values the Dashboard fills it with.
 */
export interface DashboardTemplateLabel {
  // The label as the English Dashboard draws it: "Preview detections".
  label: string;
  // The key it is drawn from: "Preview {{records}}".
  template: string;
  /*
   * What the Dashboard puts in each placeholder: a word it translates with
   * the sentence is a translatableTerm(), a name is a string.
   */
  values: TemplateValues;
}

type DrawnTemplateLabelFunction = (
  language: string,
  label: DashboardTemplateLabel,
) => string;

/*
 * What the Dashboard draws for a template-built label in this language: the
 * locale's whole sentence, filled with the same values, a word among them in
 * this language too; the English sentence where the locale has no wording of
 * it, as the Dashboard falls back.
 */
export const drawnTemplateLabel: DrawnTemplateLabelFunction = (
  language: string,
  label: DashboardTemplateLabel,
): string => {
  return dashboardTranslator(language).translateTemplate(
    label.template,
    label.values,
  );
};
