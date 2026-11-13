import {
  TemplateValues,
  Translator,
  createTranslator,
  translateNamedAction,
} from "Common/UI/Utils/TranslateTemplate";
import {
  DurationTextPart,
  DurationTextUnit,
  formatDurationText,
  withDateDisplayLanguage,
  writeInDateDisplayLanguage,
} from "Common/Types/DateLanguage";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import {
  SloBudgetRunwayKind,
  SloProjectionTone,
} from "Common/Utils/Slo/SloProjection";
import { formatSloPercent } from "Common/Utils/Slo/SloWidgetFormat";
import fs from "fs";
import path from "path";
import {
  getErrorBudgetRemainingOfTotalInLanguage,
  getRollingWindowFillTextInLanguage,
  getSloBudgetRunwayTextInLanguage,
} from "../../../FeatureSet/Dashboard/src/Components/Slo/SloOverviewTextInLanguage";
import { describeSloErrorBudget } from "../../../FeatureSet/Dashboard/src/Pages/Slo/SloSettingsFormFields";
import { getArchiveCardWords } from "../../../FeatureSet/Dashboard/src/Components/Archive/ArchiveCardWords";

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
 * Every docs language names the Dashboard this way, Persian included: the
 * Persian incident pages kept the Dashboard's English names while the
 * Persian Dashboard was mostly English, and name it as it draws it since it
 * draws them in Persian (#7100). dashboardLabel and drawnDashboardLabel are
 * one rule under two names.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const LOCALES_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Locales",
);

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
 * language: its value in the language's locale, or the English where the
 * locale has none.
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

/*
 * The title of a Settings page's Archive card, as the card draws it in this
 * language (#7195): "Archive SLO", "SLO archivieren", "بایگانی صفحه وضعیت".
 * It is built from "Archive {{itemName}}" and the name the page hands the
 * card, so no locale has it as a key and a page cannot look it up.
 */
export const drawnArchiveCardTitle: (
  language: string,
  singularName: string,
  isArchived?: boolean,
) => string = (
  language: string,
  singularName: string,
  isArchived?: boolean,
): string => {
  return getArchiveCardWords({
    singularName: singularName,
    isArchived: Boolean(isArchived),
    copy: {},
    translator: dashboardTranslator(language),
  }).title;
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

// The unit each letter of an English compact duration names.
const COMPACT_UNITS: Record<string, DurationTextUnit> = {
  d: "day",
  h: "hour",
  m: "minute",
  s: "second",
};

// A target the budget table lists: "99.9%".
const TABLE_TARGET: RegExp = /^(\d+(?:\.\d+)?)%$/;

const SECONDS_PER_DAY: number = 24 * 60 * 60;

/*
 * The parts an English compact duration writes, as it writes them - "1m 0s"
 * keeps its 0s - or null for any other text.
 */
const compactDurationParts: (text: string) => Array<DurationTextPart> | null = (
  text: string,
): Array<DurationTextPart> | null => {
  const parts: Array<DurationTextPart> = [];

  for (const part of text.split(" ")) {
    const match: RegExpExecArray | null = COMPACT_PART.exec(part);
    const unit: DurationTextUnit | undefined = match
      ? COMPACT_UNITS[match[2]!]
      : undefined;

    if (!match || !unit) {
      return null;
    }

    parts.push({ count: Number(match[1]), unit: unit });
  }

  return parts.length > 0 ? parts : null;
};

/*
 * A figure of the Error Budgets page's budget table, or of the sentence
 * under it, as this language's Dashboard writes such a figure: a target,
 * "99.9%", with the language's own percent (formatSloPercent: "99,9 %" in
 * German, "۹۹٫۹٪" in Persian), and a budget, "1h 40m 48s", with every part
 * the table writes named as the Dashboard names a duration's parts
 * (formatDurationCompactInLanguage: "1 Std., 40 Min., 48 Sek."). The
 * Dashboard draws the two largest parts of a budget; the table keeps the
 * third, so a reader can check it against the formula. Null for any other
 * text.
 */
export const drawnBudgetFigure: (
  language: string,
  english: string,
) => string | null = (language: string, english: string): string | null => {
  const target: RegExpExecArray | null = TABLE_TARGET.exec(english);

  if (target) {
    return formatSloPercent(
      Number(target[1]),
      3,
      dashboardTranslator(language),
    );
  }

  const parts: Array<DurationTextPart> | null = compactDurationParts(english);

  if (!parts) {
    return null;
  }

  return withDateDisplayLanguage(language, (): string => {
    return writeInDateDisplayLanguage(
      (): string => {
        return english;
      },
      (_language: string, locale: string): string | null => {
        return formatDurationText({
          parts: parts,
          locale: locale,
          unitDisplay: "short",
          listStyle: "narrow",
        });
      },
    );
  });
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
 * (SloOverviewTextInLanguage), handed the figures of the English text. And
 * the Settings page's Error Budget line, "43m 12s of downtime per 30-day
 * window" (describeSloErrorBudget, #6925).
 */
const TEXTS_WITH_FIGURES: ReadonlyArray<TextWithFigures> = [
  {
    english: /^(\d+[dhms](?: \d+[dhms])*) of downtime per (\d+)-day window$/,
    draw: (figures: Array<string>, translator: Translator): string | null => {
      const budget: number | null = compactDurationSeconds(figures[0]);
      const windowDays: number = Number(figures[1]);

      if (budget === null || !(windowDays > 0)) {
        return null;
      }

      // The target that leaves this budget: 43m 12s of 30 days is 99.9%.
      return describeSloErrorBudget(
        {
          targetPercentage:
            100 - (budget * 100) / (windowDays * SECONDS_PER_DAY),
          windowType: SloWindowType.Rolling,
          windowDays: windowDays,
        },
        translator,
      );
    },
  },
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

/*
 * What a page in this language calls the Dashboard label written in English:
 * the label as that language's Dashboard draws it, in every docs language. No
 * language keeps the Dashboard's English names (DocsDashboardLabelsEveryLanguage
 * holds every docs suite to that).
 */
export const dashboardLabel: DashboardLabelFunction = drawnDashboardLabel;

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
