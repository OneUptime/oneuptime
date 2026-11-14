import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import {
  DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
  DEFAULT_ROLLING_WINDOW_DAYS,
} from "Common/Utils/Slo/SloHealth";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import type { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import {
  getGlobalTranslator,
  SentenceOptions,
  TemplateValues,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  formatSloNumber,
  formatSloPercent,
  SLI_DECIMALS,
} from "Common/Utils/Slo/SloWidgetFormat";

/*
 * The SLO form's field list and its client-side validators, kept in a plain
 * .ts module rather than inside Slos.tsx.
 *
 * App/tsconfig.json excludes FeatureSet/Dashboard because Dashboard is a
 * separate package with its own react — App's own npm install has none, so
 * anything App's tsc reaches inside a Dashboard .tsx fails with "Cannot find
 * module 'react'". `exclude` only drops files from the default include glob;
 * a test that imports one pulls it, and its whole component tree, straight
 * back in. Keeping the form definition here means App/Tests can type-check
 * it without dragging the SLOs page, its table, its bulk-action hook and
 * every owner/filter chip below them into the App compile.
 */

/*
 * The examples are the part people actually need: "99.9" means nothing
 * until it is translated into how much downtime it allows.
 *
 * One sentence with its figures as values, each written the reader's way:
 * "99,9 %" in German, "۹۹٫۹٪" in Persian (formatSloPercent). Written into
 * the English text, the help was no key of the locales and read in English,
 * with English figures, in every language (#6925). English reads it word
 * for word as before.
 */
export const SLO_TARGET_HELP_TEMPLATE: string = translationKey(
  "The share of time its monitors must be up. Over {{days}} days, {{target}} allows {{minutes}} minutes of downtime and {{stricterTarget}} about {{stricterMinutes}}.",
);

// The help's second example: one more nine.
export const SLO_TARGET_HELP_STRICTER_TARGET_PERCENTAGE: number = 99.99;

const MINUTES_PER_DAY: number = 24 * 60;

type DowntimeMinutesFunction = (data: {
  targetPercentage: number;
  windowDays: number;
}) => number;

// The whole minutes of downtime a target allows over a window: 99.9% of 30 days, 43.
const getAllowedDowntimeMinutes: DowntimeMinutesFunction = (data: {
  targetPercentage: number;
  windowDays: number;
}): number => {
  return Math.round(
    (data.windowDays * MINUTES_PER_DAY * (100 - data.targetPercentage)) / 100,
  );
};

/*
 * The create form's sentences set their figures apart from the words
 * around them, as the SLO Overview's notes do: on an Arabic or Persian page
 * each share is then drawn as the Settings page and the Overview draw it,
 * its figure first and its sign on the right. Left in the sentence, the
 * bidi algorithm read a share's sign with the right-to-left words around it
 * and drew it on the figure's left, a few lines under "99.9%". An English
 * sentence is filled as it always was.
 */
const FIGURES_SET_APART: SentenceOptions = { setsValuesApart: true };

export type GetSloTargetHelpTextFunction = (
  translator?: Translator | undefined,
) => string;

/*
 * The target field's help, in the reader's language: the reader's Translator,
 * or the language of the moment outside React (the forms are built from a
 * plain module).
 */
export const getSloTargetHelpText: GetSloTargetHelpTextFunction = (
  translator?: Translator | undefined,
): string => {
  const reader: Translator = translator || getGlobalTranslator();
  const days: number = DEFAULT_ROLLING_WINDOW_DAYS;

  const values: TemplateValues = {
    days: formatSloNumber(days, 0, reader) ?? String(days),
    target:
      formatSloPercent(SLO_SUGGESTED_TARGET_PERCENTAGE, SLI_DECIMALS, reader) ??
      `${SLO_SUGGESTED_TARGET_PERCENTAGE}%`,
    minutes:
      formatSloNumber(
        getAllowedDowntimeMinutes({
          targetPercentage: SLO_SUGGESTED_TARGET_PERCENTAGE,
          windowDays: days,
        }),
        0,
        reader,
      ) ?? "",
    stricterTarget:
      formatSloPercent(
        SLO_TARGET_HELP_STRICTER_TARGET_PERCENTAGE,
        SLI_DECIMALS,
        reader,
      ) ?? `${SLO_TARGET_HELP_STRICTER_TARGET_PERCENTAGE}%`,
    stricterMinutes:
      formatSloNumber(
        getAllowedDowntimeMinutes({
          targetPercentage: SLO_TARGET_HELP_STRICTER_TARGET_PERCENTAGE,
          windowDays: days,
        }),
        0,
        reader,
      ) ?? "",
  };

  return reader.translateTemplate(
    SLO_TARGET_HELP_TEMPLATE,
    values,
    FIGURES_SET_APART,
  );
};

/*
 * The limits the form's checks name, which the server holds too
 * (ServiceLevelObjectiveService): a target above 0 and at most 99.999, an
 * at-risk threshold from 0 to 100, a rolling window of 1 to 366 days.
 */
export const SLO_MAX_TARGET_PERCENTAGE: number = 99.999;
export const SLO_MAX_WINDOW_DAYS: number = 366;

/*
 * What each check says, one sentence with its limits as values, so a German
 * reader is told "99,999" and a Persian one "۹۹٫۹۹۹". Returned from a
 * check, a message is no key the extractor finds unless it is marked here.
 */
export const SLO_FORM_ERRORS: {
  target: string;
  atRiskThresholdRange: string;
  atRiskThresholdWhole: string;
  windowDaysRange: string;
  windowDaysWhole: string;
} = {
  target: translationKey(
    "Target must be greater than {{min}} and at most {{max}}.",
  ),
  atRiskThresholdRange: translationKey(
    "At-risk threshold must be a percentage between {{min}} and {{max}}.",
  ),
  atRiskThresholdWhole: translationKey(
    "At-risk threshold must be a whole number.",
  ),
  windowDaysRange: translationKey(
    "Window must be between {{min}} and {{max}} days.",
  ),
  windowDaysWhole: translationKey("Window must be a whole number of days."),
};

type RangeErrorFunction = (
  template: string,
  range: { min: number; max: number; maxDecimals: number },
) => string;

// A check's sentence with its limits, the way the reader writes them.
const rangeError: RangeErrorFunction = (
  template: string,
  range: { min: number; max: number; maxDecimals: number },
): string => {
  const reader: Translator = getGlobalTranslator();

  return reader.translateTemplate(template, {
    min: formatSloNumber(range.min, range.maxDecimals, reader) ?? "",
    max: formatSloNumber(range.max, range.maxDecimals, reader) ?? "",
  });
};

type WordedErrorFunction = (text: string) => string;

const wordedError: WordedErrorFunction = (text: string): string => {
  return getGlobalTranslator().translateText(text) || text;
};

/*
 * The create form is one page of three rows: the SLO's name, its target,
 * and one folded Advanced section. Only the target has no default, so it is
 * the one question asked beside the name, and it comes prefilled with the
 * usual "three nines": a suggestion people see and change, not a default
 * the server would store on its own (the column has none). Everything else
 * starts from the column's own default and waits, folded, under Advanced -
 * the description, the at-risk threshold (20), the window (a rolling 30
 * days, or a calendar month and its timezone) and the labels - and the
 * folded section says what those defaults do (getSloAdvancedSummary), so
 * nobody has to open it to know what 99.9 is measured over. The new SLO
 * then opens on its own page, whose getting-started card asks for its
 * monitors.
 *
 * It used to walk three steps for this - Basic Info, Objective, Period -
 * when a target was all it needed. A form of three rows has no stepper
 * (LongFormStepsGuard: findShortFormsWithSteps).
 *
 * How it measures has pages of its own, and every one of those settings
 * starts from a server default, so the form does not ask for them:
 *   - monitors: attached on the Monitors page, or by a Monitor Rule;
 *   - multiMonitorMode: the column's DB default, Any Monitor Down;
 *   - downtimeMonitorStatuses: every non-operational status of the project
 *     (ServiceLevelObjectiveService.onBeforeCreate);
 *   - isEnabled: the column's DB default, true.
 * ModelForm sends only the keys of the fields on the form, which is what
 * lets those defaults apply. The last three are edited on Settings.
 */
export const SLO_SUGGESTED_TARGET_PERCENTAGE: number = 99.9;

/*
 * Numbers are seeded here rather than through `defaultValue`, which
 * FormField treats as absent when it is falsy. Nothing is seeded for the
 * columns the form no longer carries: ModelForm would not send them anyway,
 * and a stray key here would only suggest the form still decides them.
 */
export const SLO_CREATE_INITIAL_VALUES: FormValues<ServiceLevelObjective> = {
  targetPercentage: SLO_SUGGESTED_TARGET_PERCENTAGE,
  windowType: SloWindowType.Rolling,
  windowDays: DEFAULT_ROLLING_WINDOW_DAYS,
  atRiskThresholdPercentage: DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
};

/*
 * What the folded Advanced section says while everything in it is at its
 * default: what the SLO is measured over, and when it warns. The threshold
 * is one value with its sign ("20 %" in German, "۲۰٪" in Persian), as the
 * help under Target (%) writes its shares.
 */
export const SLO_ADVANCED_DEFAULTS_SUMMARY: string = translationKey(
  "Measured over a rolling {{days}}-day window, and At Risk when less than {{threshold}} of the error budget is left.",
);

type ValueOfFunction = (value: unknown) => unknown;

/*
 * A dropdown can hold the option it was picked as ({ label, value }) rather
 * than its value; the value is what is compared.
 */
const valueOf: ValueOfFunction = (value: unknown): unknown => {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, "value") &&
    Object.prototype.hasOwnProperty.call(value, "label")
  ) {
    return (value as { value: unknown }).value;
  }

  return value;
};

type IsLeftAtFunction = (value: unknown, defaultValue: unknown) => boolean;

// Never touched, or still the default it was seeded with.
const isLeftAt: IsLeftAtFunction = (
  value: unknown,
  defaultValue: unknown,
): boolean => {
  const current: unknown = valueOf(value);

  if (current === undefined || current === null) {
    return true;
  }

  if (typeof defaultValue === "number") {
    return current !== "" && Number(current) === defaultValue;
  }

  return current === defaultValue;
};

type IsLeftEmptyFunction = (value: unknown) => boolean;

const isLeftEmpty: IsLeftEmptyFunction = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return false;
};

export type IsSloAdvancedAtDefaultsFunction = (
  values: FormValues<ServiceLevelObjective>,
) => boolean;

/*
 * Whether everything folded under Advanced is what a new SLO starts with:
 * no description, no labels, the at-risk threshold, window type and window
 * length at their column defaults, and no timezone.
 */
export const isSloAdvancedAtDefaults: IsSloAdvancedAtDefaultsFunction = (
  values: FormValues<ServiceLevelObjective>,
): boolean => {
  const formValues: Record<string, unknown> = (values || {}) as Record<
    string,
    unknown
  >;

  return (
    isLeftEmpty(formValues["description"]) &&
    isLeftEmpty(formValues["labels"]) &&
    isLeftEmpty(formValues["timezone"]) &&
    isLeftAt(formValues["windowType"], SloWindowType.Rolling) &&
    isLeftAt(formValues["windowDays"], DEFAULT_ROLLING_WINDOW_DAYS) &&
    isLeftAt(
      formValues["atRiskThresholdPercentage"],
      DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
    )
  );
};

export type GetSloAdvancedSummaryFunction = (
  values: FormValues<ServiceLevelObjective>,
) => Array<string> | undefined;

/*
 * The folded section's line while nothing in it is changed: what the
 * defaults do. Nothing once something is changed; the header then says
 * "Configured", as for any other folded setting.
 */
export const getSloAdvancedSummary: GetSloAdvancedSummaryFunction = (
  values: FormValues<ServiceLevelObjective>,
): Array<string> | undefined => {
  if (!isSloAdvancedAtDefaults(values)) {
    return undefined;
  }

  const reader: Translator = getGlobalTranslator();

  // "۳۰" and "۲۰٪" on a Persian page: the reader's digits and sign.
  return [
    reader.translateTemplate(
      SLO_ADVANCED_DEFAULTS_SUMMARY,
      {
        days: reader.formatNumber(DEFAULT_ROLLING_WINDOW_DAYS),
        threshold:
          formatSloPercent(DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE, 0, reader) ??
          `${DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE}%`,
      },
      FIGURES_SET_APART,
    ),
  ];
};

/*
 * One sentence per window type, shown under each option in the dropdown
 * and beside the chosen type on the Settings page, so the two can never
 * describe the same choice differently.
 */
export const SLO_WINDOW_TYPE_DESCRIPTIONS: Record<SloWindowType, string> = {
  [SloWindowType.Rolling]: translationKey(
    "The last N days, recovering continuously as old downtime ages out of the window.",
  ),
  [SloWindowType.CalendarMonth]: translationKey(
    "Each calendar month on its own. The whole error budget resets on the 1st.",
  ),
};

/*
 * Window Type's two answers, each with one line that says what the window
 * is and when to pick it. The field was a dropdown under one description
 * explaining both ("Rolling suits services that should be reliable at
 * every moment. Calendar Month suits objectives reported, or promised to
 * customers, per month."), with each answer's own meaning hidden in the
 * closed list. The answers keep the names the docs and the Settings card
 * use, and Rolling - what a new SLO starts with - comes first.
 */
export const SLO_WINDOW_TYPE_CHOICE_DESCRIPTIONS: Record<
  SloWindowType,
  string
> = {
  [SloWindowType.Rolling]: translationKey(
    "The last N days, always up to date. Suits services that must be reliable at every moment.",
  ),
  [SloWindowType.CalendarMonth]: translationKey(
    "Each month on its own, reset on the 1st. Suits targets reported or promised per month.",
  ),
};

/*
 * Each window type's name, as its answer reads. The enum value is its
 * English name, which is what is stored; the answer is looked up by the
 * name here (FormField draws a radio answer's title in the reader's
 * language), so "Calendar Month" is a key of its own and not only a value.
 */
export const SLO_WINDOW_TYPE_NAMES: Record<SloWindowType, string> = {
  [SloWindowType.Rolling]: translationKey("Rolling"),
  [SloWindowType.CalendarMonth]: translationKey("Calendar Month"),
};

export type GetSloWindowTypeChoicesFunction = () => Array<RadioButton>;

export const getSloWindowTypeChoices: GetSloWindowTypeChoicesFunction =
  (): Array<RadioButton> => {
    return Object.values(SloWindowType).map(
      (windowType: SloWindowType): RadioButton => {
        return {
          title: SLO_WINDOW_TYPE_NAMES[windowType],
          value: windowType,
          description: SLO_WINDOW_TYPE_CHOICE_DESCRIPTIONS[windowType],
        };
      },
    );
  };

/*
 * Client-side mirrors of ServiceLevelObjectiveService.validateTargetPercentage
 * and validateAtRiskThresholdPercentage. Without them the only feedback on a
 * bad number was a failed round-trip rendering the raw server exception, and
 * the whole create modal had to be re-submitted to find out.
 *
 * Each says what is wrong in the reader's language, with its limits written
 * the reader's way (SLO_FORM_ERRORS). An English reader reads the sentences
 * word for word as before.
 */
export type ValidateTargetPercentageFunction = (
  value: FormValues<ServiceLevelObjective>,
) => string | null;

export const validateTargetPercentage: ValidateTargetPercentageFunction = (
  value: FormValues<ServiceLevelObjective>,
): string | null => {
  const target: number = Number(value.targetPercentage);

  if (!isFinite(target) || target <= 0 || target > SLO_MAX_TARGET_PERCENTAGE) {
    return rangeError(SLO_FORM_ERRORS.target, {
      min: 0,
      max: SLO_MAX_TARGET_PERCENTAGE,
      maxDecimals: 3,
    });
  }

  return null;
};

export type ValidateAtRiskThresholdFunction = (
  value: FormValues<ServiceLevelObjective>,
) => string | null;

export const validateAtRiskThreshold: ValidateAtRiskThresholdFunction = (
  value: FormValues<ServiceLevelObjective>,
): string | null => {
  const threshold: number = Number(value.atRiskThresholdPercentage);

  if (!isFinite(threshold) || threshold < 0 || threshold > 100) {
    return rangeError(SLO_FORM_ERRORS.atRiskThresholdRange, {
      min: 0,
      max: 100,
      maxDecimals: 0,
    });
  }

  /*
   * The column is an integer, so 20.5 would clear the range check and then
   * fail the INSERT with a raw driver error the user cannot act on.
   */
  if (!Number.isInteger(threshold)) {
    return wordedError(SLO_FORM_ERRORS.atRiskThresholdWhole);
  }

  return null;
};

export type ValidateWindowDaysFunction = (
  value: FormValues<ServiceLevelObjective>,
) => string | null;

export const validateWindowDays: ValidateWindowDaysFunction = (
  value: FormValues<ServiceLevelObjective>,
): string | null => {
  /*
   * Only meaningful for rolling windows; the field is hidden (and skipped
   * by Validation) for Calendar Month.
   */
  const windowDays: number = Number(value.windowDays);

  if (
    !isFinite(windowDays) ||
    windowDays < 1 ||
    windowDays > SLO_MAX_WINDOW_DAYS
  ) {
    return rangeError(SLO_FORM_ERRORS.windowDaysRange, {
      min: 1,
      max: SLO_MAX_WINDOW_DAYS,
      maxDecimals: 0,
    });
  }

  if (!Number.isInteger(windowDays)) {
    return wordedError(SLO_FORM_ERRORS.windowDaysWhole);
  }

  return null;
};

/*
 * The create form's fields. Settings and the Overview's details card take
 * their fields from this list (see pickSloFormFields) rather than declaring
 * them a second time, so a help text or validator changed here changes
 * everywhere the same column is edited.
 *
 * The folded fields stay next to each other, after the two open ones, all
 * with the one section built here: BasicForm draws fields next to each
 * other with one section as one header, and FormStepsScan counts them as
 * one row by that same section.
 */
export type GetSloFormFieldsFunction = () => Array<
  ModelField<ServiceLevelObjective>
>;

export const getSloFormFields: GetSloFormFieldsFunction = (): Array<
  ModelField<ServiceLevelObjective>
> => {
  const advancedSection: FormFieldCollapsibleSection<ServiceLevelObjective> =
    getAdvancedFormSection<ServiceLevelObjective>({
      getSummary: getSloAdvancedSummary,
    });

  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "API Availability",
    },
    {
      field: {
        targetPercentage: true,
      },
      title: "Target (%)",
      // Filled in now, in the language of the moment: a sentence, not a key.
      description: getSloTargetHelpText(),
      fieldType: FormFieldSchemaType.Number,
      required: true,
      placeholder: "99.9",
      customValidation: validateTargetPercentage,
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "99.9% availability for the public API",
      collapsibleSection: advancedSection,
    },
    {
      field: {
        atRiskThresholdPercentage: true,
      },
      title: "At-Risk Threshold (%)",
      description:
        "The SLO turns At Risk when less than this share of its error budget is left. 20 by default.",
      fieldType: FormFieldSchemaType.Number,
      /*
       * Required because the column is NOT NULL with a DB default, so the
       * box is always prefilled: clearing a field the UI called optional
       * would otherwise submit "" into an integer column and fail the whole
       * save with an opaque server error. A cleared box opens the folded
       * section by itself, on the error.
       */
      required: true,
      placeholder: "20",
      customValidation: validateAtRiskThreshold,
      collapsibleSection: advancedSection,
    },
    {
      field: {
        windowType: true,
      },
      title: "Window Type",
      fieldType: FormFieldSchemaType.RadioButton,
      radioButtonOptions: getSloWindowTypeChoices(),
      required: true,
      // Each answer says what it is and when to pick it.
      hideColumnDescription: true,
      dataTestId: "slo-window-type",
      collapsibleSection: advancedSection,
      /*
       * Switching to Calendar Month hides Window (Days), and hidden fields
       * are skipped by validation — so a box the user had cleared would
       * submit "" into a NOT NULL integer column and fail the save with a
       * message about a field that is no longer on screen. The column is
       * persisted either way (an SLO switched back to Rolling later reads
       * it), so backfill the default rather than sending an empty string.
       */
      onChange: (
        value: SloWindowType,
        currentFormValues: FormValues<ServiceLevelObjective>,
        setNewFormValues: (
          currentFormValues: FormValues<ServiceLevelObjective>,
        ) => void,
      ): void => {
        if (value !== SloWindowType.CalendarMonth) {
          return;
        }

        const windowDays: unknown = currentFormValues.windowDays;

        if (
          windowDays === undefined ||
          windowDays === null ||
          windowDays === "" ||
          !isFinite(Number(windowDays))
        ) {
          setNewFormValues({
            ...currentFormValues,
            windowDays: DEFAULT_ROLLING_WINDOW_DAYS,
          });
        }
      },
    },
    {
      field: {
        windowDays: true,
      },
      title: "Window (Days)",
      /*
       * A free number rather than the old 7/28/30/90 dropdown: the column
       * accepts 1-366 (ServiceLevelObjectiveService.validateWindowDays), so
       * an SLO created over the API with a 14-day window used to render a
       * blank required dropdown and get silently rewritten to one of the
       * four options on the next save.
       */
      description:
        "How many days the rolling window looks back, from 1 to 366. 28 or 30 is typical: a shorter window forgets downtime sooner, but also allows less of it.",
      fieldType: FormFieldSchemaType.Number,
      required: true,
      placeholder: "30",
      customValidation: validateWindowDays,
      collapsibleSection: advancedSection,
      showIf: (item: FormValues<ServiceLevelObjective>): boolean => {
        return item.windowType !== SloWindowType.CalendarMonth;
      },
    },
    {
      field: {
        timezone: true,
      },
      title: "Timezone",
      description:
        "Decides when each calendar month starts and ends. Defaults to UTC.",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: TimezoneUtil.getTimezoneDropdownOptions(),
      required: false,
      placeholder: "UTC",
      collapsibleSection: advancedSection,
      showIf: (item: FormValues<ServiceLevelObjective>): boolean => {
        return item.windowType === SloWindowType.CalendarMonth;
      },
    },
    // Last in the section, as on every form (LabelsFormFieldGuard).
    getLabelsFormField<ServiceLevelObjective>({
      collapsibleSection: advancedSection,
    }),
  ];
};

/*
 * The create form's fields for the given columns, in the order asked for,
 * with the create form's Advanced section dropped: the forms that reuse
 * them - the Overview's details card and the Settings cards - are flat
 * forms of two or three fields, each card's own question, with nothing to
 * fold. Labels are the one exception: they fold under an Advanced section
 * of their own, as on every form (getLabelsFormField).
 *
 * Everything else is kept as it is, including onChange and showIf, so the
 * Calendar Month backfill and the conditional window fields behave on
 * Settings exactly as they do on the create form.
 */
export type PickSloFormFieldsFunction = (
  columns: Array<string>,
) => Array<ModelField<ServiceLevelObjective>>;

export const pickSloFormFields: PickSloFormFieldsFunction = (
  columns: Array<string>,
): Array<ModelField<ServiceLevelObjective>> => {
  const createFields: Array<ModelField<ServiceLevelObjective>> =
    getSloFormFields();
  const pickedFields: Array<ModelField<ServiceLevelObjective>> = [];

  for (const column of columns) {
    const createField: ModelField<ServiceLevelObjective> | undefined =
      createFields.find((field: ModelField<ServiceLevelObjective>): boolean => {
        return Object.keys(field.field || {})[0] === column;
      });

    if (!createField) {
      continue;
    }

    if (column === "labels") {
      pickedFields.push(getLabelsFormField<ServiceLevelObjective>());
      continue;
    }

    const pickedField: ModelField<ServiceLevelObjective> = {
      ...createField,
    };
    delete pickedField.collapsibleSection;
    delete pickedField.stepId;
    pickedFields.push(pickedField);
  }

  return pickedFields;
};

/*
 * The Overview's details card edits only what describes the SLO: its name,
 * description and labels. What it measures and how - objective, period,
 * downtime and evaluation - lives on the Settings page.
 */
const SLO_DETAILS_FORM_COLUMNS: Array<string> = [
  "name",
  "description",
  "labels",
];

export type GetSloDetailsFormFieldsFunction = () => Array<
  ModelField<ServiceLevelObjective>
>;

export const getSloDetailsFormFields: GetSloDetailsFormFieldsFunction =
  (): Array<ModelField<ServiceLevelObjective>> => {
    return pickSloFormFields(SLO_DETAILS_FORM_COLUMNS);
  };
