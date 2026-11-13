import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { pickSloFormFields } from "./SloFormFields";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import SloMultiMonitorMode from "Common/Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import { DEFAULT_ROLLING_WINDOW_DAYS } from "Common/Utils/Slo/SloHealth";
import {
  formatSloNumber,
  formatSloPercent,
} from "Common/Utils/Slo/SloWidgetFormat";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import type { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import {
  getGlobalTranslator,
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The SLO Settings page's edit forms and the plain-language summaries its
 * cards show, kept React-free for the same reason as SloFormFields.ts: App
 * tests can import this without pulling the Dashboard's react into App.
 *
 * Settings owns how an SLO measures. The create form asks only for the
 * name and the target, with the threshold and period folded at their
 * defaults, and leaves the rest to server defaults, so this page is the
 * one place the downtime rules can be changed. Objective and period
 * are editable here too, because they are what the SLO measures against
 * and the Overview's details card no longer edits them. Whether the SLO is
 * evaluated at all is not a form: it is the Evaluation card's switch,
 * which saves when it is flipped (Components/Slo/SloEvaluationCard).
 */

const SECONDS_PER_DAY: number = 24 * 60 * 60;

/*
 * A calendar month's budget is worked out over a month of this many days,
 * and the line says so: "0.1% of each month: 43m 12s of downtime in a
 * 30-day month".
 */
export const SLO_EXAMPLE_MONTH_DAYS: number = 30;

/*
 * The share of the window the objective leaves to downtime, to as many
 * places as a target can be typed with: 0.1 for 99.9, 0.0875 for 99.9125.
 */
const ALLOWED_PERCENTAGE_DECIMALS: number = 6;

/*
 * Objective and period are not declared again here: they are taken from
 * the create form, so the validators, the Calendar Month backfill and the
 * help text are the same wherever those columns are edited.
 */
export const SLO_OBJECTIVE_SETTINGS_COLUMNS: Array<string> = [
  "targetPercentage",
  "atRiskThresholdPercentage",
];

export const SLO_PERIOD_SETTINGS_COLUMNS: Array<string> = [
  "windowType",
  "windowDays",
  "timezone",
];

export type GetSloSettingsFormFieldsFunction = () => Array<
  ModelField<ServiceLevelObjective>
>;

export const getSloObjectiveSettingsFormFields: GetSloSettingsFormFieldsFunction =
  (): Array<ModelField<ServiceLevelObjective>> => {
    return pickSloFormFields(SLO_OBJECTIVE_SETTINGS_COLUMNS);
  };

export const getSloPeriodSettingsFormFields: GetSloSettingsFormFieldsFunction =
  (): Array<ModelField<ServiceLevelObjective>> => {
    return pickSloFormFields(SLO_PERIOD_SETTINGS_COLUMNS);
  };

/*
 * The enum values ("Any Monitor Down", "Monitor Seconds Average") name the
 * maths, not the consequence. These say what each mode does to the error
 * budget and when to pick it, beside the chosen mode on the Settings card.
 */
export const SLO_MULTI_MONITOR_MODE_DESCRIPTIONS: Record<
  SloMultiMonitorMode,
  string
> = {
  [SloMultiMonitorMode.AnyDown]: translationKey(
    "A moment counts as downtime when any attached monitor is down. Pick this when every monitor is essential, such as an API and the database behind it.",
  ),
  [SloMultiMonitorMode.MonitorSecondsAverage]: translationKey(
    "Downtime is averaged across monitors, so one of four monitors down for an hour costs the budget a quarter of an hour. Pick this for redundant replicas or regions, where one being down is a partial outage.",
  ),
};

/*
 * The same two modes as answers to pick in Edit Downtime Calculation, each
 * with one line: what counts as downtime, and when to pick it. It was a
 * dropdown under a description about the field, with each mode's meaning
 * hidden in the closed list. Any Monitor Down - the column's default -
 * comes first.
 */
export const SLO_MULTI_MONITOR_MODE_CHOICE_DESCRIPTIONS: Record<
  SloMultiMonitorMode,
  string
> = {
  [SloMultiMonitorMode.AnyDown]: translationKey(
    "Down whenever any monitor is down. For monitors that must all be up.",
  ),
  [SloMultiMonitorMode.MonitorSecondsAverage]: translationKey(
    "Downtime averaged across monitors. For replicas, where one down is a partial outage.",
  ),
};

/*
 * Each mode's name, as its answer and the Settings card read it. The enum
 * value is its English name, which is what is stored; the name is looked
 * up from here, in the reader's language.
 */
export const SLO_MULTI_MONITOR_MODE_NAMES: Record<SloMultiMonitorMode, string> =
  {
    [SloMultiMonitorMode.AnyDown]: translationKey("Any Monitor Down"),
    [SloMultiMonitorMode.MonitorSecondsAverage]: translationKey(
      "Monitor Seconds Average",
    ),
  };

export type GetSloMultiMonitorModeChoicesFunction = () => Array<RadioButton>;

export const getSloMultiMonitorModeChoices: GetSloMultiMonitorModeChoicesFunction =
  (): Array<RadioButton> => {
    return Object.values(SloMultiMonitorMode).map(
      (mode: SloMultiMonitorMode): RadioButton => {
        return {
          title: SLO_MULTI_MONITOR_MODE_NAMES[mode],
          value: mode,
          description: SLO_MULTI_MONITOR_MODE_CHOICE_DESCRIPTIONS[mode],
        };
      },
    );
  };

export const getSloDowntimeSettingsFormFields: GetSloSettingsFormFieldsFunction =
  (): Array<ModelField<ServiceLevelObjective>> => {
    return [
      {
        field: {
          multiMonitorMode: true,
        },
        title: "Multi Monitor Mode",
        description:
          "Only matters when this SLO measures more than one monitor.",
        fieldType: FormFieldSchemaType.RadioButton,
        radioButtonOptions: getSloMultiMonitorModeChoices(),
        // The column is NOT NULL: a choice always holds one of the two.
        required: true,
        dataTestId: "slo-multi-monitor-mode",
      },
      {
        field: {
          downtimeMonitorStatuses: true,
        },
        title: "Downtime Monitor Statuses",
        /*
         * An empty list is a real choice, not a missing value: the
         * evaluation worker then counts every non-operational status of the
         * project, including statuses added after this SLO was created.
         * A new SLO instead starts with the statuses that existed at the
         * time (ServiceLevelObjectiveService.onBeforeCreate).
         */
        description:
          "Time in these statuses spends error budget. Leave empty to count every non-operational status.",
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        dropdownModal: {
          type: MonitorStatus,
          labelField: "name",
          valueField: "_id",
          sort: {
            priority: SortOrder.Ascending,
          },
        },
        required: false,
        placeholder: "Every non-operational status",
      },
    ];
  };

/*
 * Read-only summaries for the Settings cards. They take plain values rather
 * than the model so they can be unit tested, and return text rather than
 * elements so this module stays free of React.
 */

type ToFinitePositiveNumberFunction = (
  value: number | string | undefined | null,
) => number | null;

const toFinitePositiveNumber: ToFinitePositiveNumberFunction = (
  value: number | string | undefined | null,
): number | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numberValue: number = Number(value);

  if (!isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return numberValue;
};

export interface SloWindowSummaryData {
  windowType?: SloWindowType | undefined | null;
  windowDays?: number | undefined | null;
  timezone?: string | undefined | null;
}

export type DescribeSloWindowFunction = (
  data: SloWindowSummaryData,
  translator?: Translator | undefined,
) => string;

const ROLLING_WINDOW: PluralTemplate = {
  one: translationKey("Rolling {{count}}-day window"),
  other: translationKey("Rolling {{count}}-day window"),
};

/*
 * "Rolling 30-day window" or "Calendar month (Europe/Berlin)", in the
 * reader's language: the page's Translator, or the language of the moment.
 */
export const describeSloWindow: DescribeSloWindowFunction = (
  data: SloWindowSummaryData,
  translator?: Translator | undefined,
): string => {
  const reader: Translator = translator || getGlobalTranslator();

  if (data.windowType === SloWindowType.CalendarMonth) {
    return reader.translateTemplate("Calendar month ({{timezone}})", {
      timezone: data.timezone || "UTC",
    });
  }

  const windowDays: number =
    toFinitePositiveNumber(data.windowDays) ?? DEFAULT_ROLLING_WINDOW_DAYS;

  return reader.translatePlural(ROLLING_WINDOW, windowDays);
};

export interface SloErrorBudgetSummaryData extends SloWindowSummaryData {
  targetPercentage?: number | undefined | null;
}

export type DescribeSloErrorBudgetFunction = (
  data: SloErrorBudgetSummaryData,
  translator?: Translator | undefined,
) => string | null;

const ROLLING_ERROR_BUDGET: PluralTemplate = {
  one: translationKey("{{budget}} of downtime per {{count}}-day window"),
  other: translationKey("{{budget}} of downtime per {{count}}-day window"),
};

export const SLO_CALENDAR_MONTH_ERROR_BUDGET_TEMPLATE: string = translationKey(
  "{{percentage}} of each month: {{budget}} of downtime in a {{days}}-day month",
);

/*
 * The full-window budget the objective allows, in words: "43m 12s of
 * downtime per 30-day window".
 *
 * This is the budget the objective promises, not the one the worker is
 * currently measuring against. A young rolling SLO is measured over the
 * data it has so far, and a Monitor Seconds Average SLO counts budget in
 * monitor-seconds, so both would make errorBudgetTotalSeconds a confusing
 * thing to show on a settings page.
 *
 * Calendar months are 28 to 31 days long, so their budget is given as a
 * share of the month with a 30-day month as the worked example.
 *
 * Null when the target cannot produce a budget, rather than a misleading
 * "0s".
 *
 * Every figure is the reader's: "0,1 %" and "43 Min., 12 Sek." in German,
 * Persian digits and units in Persian (formatSloPercent,
 * formatDurationCompactInLanguage), as the Overview writes the same budget.
 * Filled with String() and the English durations, the line read "0.1 %
 * jedes Monats: 43m 12s" in German (#6925). An English reader reads it
 * word for word as before.
 */
export const describeSloErrorBudget: DescribeSloErrorBudgetFunction = (
  data: SloErrorBudgetSummaryData,
  translator?: Translator | undefined,
): string | null => {
  const reader: Translator = translator || getGlobalTranslator();
  const target: number | null = toFinitePositiveNumber(data.targetPercentage);

  if (target === null || target >= 100) {
    return null;
  }

  /*
   * 100 - 99.9 is 0.09999999999999432 in floating point; round it back to
   * the number the user typed before showing it.
   */
  const allowedPercentage: number = Number(
    (100 - target).toFixed(ALLOWED_PERCENTAGE_DECIMALS),
  );
  const allowedFraction: number = allowedPercentage / 100;

  if (data.windowType === SloWindowType.CalendarMonth) {
    const monthBudget: string = formatDurationCompactInLanguage(
      Math.round(allowedFraction * SLO_EXAMPLE_MONTH_DAYS * SECONDS_PER_DAY),
      reader.language,
    );

    return reader.translateTemplate(SLO_CALENDAR_MONTH_ERROR_BUDGET_TEMPLATE, {
      percentage:
        formatSloPercent(
          allowedPercentage,
          ALLOWED_PERCENTAGE_DECIMALS,
          reader,
        ) ?? `${allowedPercentage}%`,
      budget: monthBudget,
      days:
        formatSloNumber(SLO_EXAMPLE_MONTH_DAYS, 0, reader) ??
        String(SLO_EXAMPLE_MONTH_DAYS),
    });
  }

  const windowDays: number =
    toFinitePositiveNumber(data.windowDays) ?? DEFAULT_ROLLING_WINDOW_DAYS;
  const budget: string = formatDurationCompactInLanguage(
    Math.round(allowedFraction * windowDays * SECONDS_PER_DAY),
    reader.language,
  );

  return reader.translatePlural(ROLLING_ERROR_BUDGET, windowDays, {
    budget: budget,
  });
};

export type OrderDowntimeMonitorStatusesFunction = (
  statuses: Array<MonitorStatus> | undefined | null,
) => Array<MonitorStatus>;

/*
 * Statuses in the project's own order (MonitorStatus.priority), so the card
 * lists them the way the monitor status pages do rather than in whatever
 * order the join table returned. Statuses without a priority go last, and
 * the sort never mutates the row it was handed.
 */
export const orderDowntimeMonitorStatuses: OrderDowntimeMonitorStatusesFunction =
  (statuses: Array<MonitorStatus> | undefined | null): Array<MonitorStatus> => {
    return [...(statuses || [])].sort(
      (a: MonitorStatus, b: MonitorStatus): number => {
        const aPriority: number =
          typeof a.priority === "number"
            ? a.priority
            : Number.POSITIVE_INFINITY;
        const bPriority: number =
          typeof b.priority === "number"
            ? b.priority
            : Number.POSITIVE_INFINITY;

        if (aPriority === bPriority) {
          return 0;
        }

        return aPriority < bPriority ? -1 : 1;
      },
    );
  };
