import { pickSloFormFields } from "./SloFormFields";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import SloMultiMonitorMode from "Common/Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import { formatDurationCompact } from "Common/Utils/Slo/SloDuration";
import { DEFAULT_ROLLING_WINDOW_DAYS } from "Common/Utils/Slo/SloHealth";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import DropdownUtil from "Common/UI/Utils/Dropdown";

/*
 * The SLO Settings page's edit forms and the plain-language summaries its
 * cards show, kept React-free for the same reason as SloFormFields.ts: App
 * tests can import this without pulling the Dashboard's react into App.
 *
 * Settings owns how an SLO measures. The create wizard asks only for the
 * objective and period and leaves the rest to server defaults, so this page
 * is the one place the downtime rules and evaluation switch can be changed.
 * Objective and period are editable here too, because they are what the
 * SLO measures against and the Overview's details card no longer edits
 * them.
 */

const SECONDS_PER_DAY: number = 24 * 60 * 60;

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
 * budget and when to pick it, and are shown both under each dropdown option
 * and beside the chosen mode on the Settings card.
 */
export const SLO_MULTI_MONITOR_MODE_DESCRIPTIONS: Record<
  SloMultiMonitorMode,
  string
> = {
  [SloMultiMonitorMode.AnyDown]:
    "A moment counts as downtime when any attached monitor is down. Pick this when every monitor is essential, such as an API and the database behind it.",
  [SloMultiMonitorMode.MonitorSecondsAverage]:
    "Downtime is averaged across monitors, so one of four monitors down for an hour costs the budget a quarter of an hour. Pick this for redundant replicas or regions, where one being down is a partial outage.",
};

export type GetSloMultiMonitorModeDropdownOptionsFunction =
  () => Array<DropdownOption>;

export const getSloMultiMonitorModeDropdownOptions: GetSloMultiMonitorModeDropdownOptionsFunction =
  (): Array<DropdownOption> => {
    return DropdownUtil.getDropdownOptionsFromEnum(SloMultiMonitorMode).map(
      (option: DropdownOption): DropdownOption => {
        return {
          ...option,
          description:
            SLO_MULTI_MONITOR_MODE_DESCRIPTIONS[
              option.value as SloMultiMonitorMode
            ],
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
          "How downtime is combined when this SLO measures more than one monitor. With a single monitor both modes measure the same thing.",
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: getSloMultiMonitorModeDropdownOptions(),
        /*
         * Required because the column is NOT NULL: clearing the dropdown
         * would otherwise send an empty value the save then rejects.
         */
        required: true,
        placeholder: SloMultiMonitorMode.AnyDown,
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
          "Time a monitor spends in any of these statuses spends error budget. Leave empty to always count every non-operational status, including ones added later.",
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        dropdownModal: {
          type: MonitorStatus,
          labelField: "name",
          valueField: "_id",
        },
        required: false,
        placeholder: "Every non-operational status",
      },
    ];
  };

export const getSloEvaluationSettingsFormFields: GetSloSettingsFormFieldsFunction =
  (): Array<ModelField<ServiceLevelObjective>> => {
    return [
      {
        field: {
          isEnabled: true,
        },
        title: "Enabled",
        /*
         * Worth spelling out: disabling is not only "stop measuring".
         * ServiceLevelObjectiveService.onUpdateSuccess resolves every alert
         * and incident the burn rate rules have open, because nothing would
         * ever resolve them once the worker stops looking at this SLO.
         */
        description:
          "Disabled SLOs are not evaluated and their burn rate rules do not fire. Disabling also resolves the burn-rate alerts and incidents this SLO has open.",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
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

export type DescribeSloWindowFunction = (data: SloWindowSummaryData) => string;

/** "Rolling 30-day window" or "Calendar month (Europe/Berlin)". */
export const describeSloWindow: DescribeSloWindowFunction = (
  data: SloWindowSummaryData,
): string => {
  if (data.windowType === SloWindowType.CalendarMonth) {
    return `Calendar month (${data.timezone || "UTC"})`;
  }

  const windowDays: number =
    toFinitePositiveNumber(data.windowDays) ?? DEFAULT_ROLLING_WINDOW_DAYS;

  return `Rolling ${windowDays}-day window`;
};

export interface SloErrorBudgetSummaryData extends SloWindowSummaryData {
  targetPercentage?: number | undefined | null;
}

export type DescribeSloErrorBudgetFunction = (
  data: SloErrorBudgetSummaryData,
) => string | null;

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
 */
export const describeSloErrorBudget: DescribeSloErrorBudgetFunction = (
  data: SloErrorBudgetSummaryData,
): string | null => {
  const target: number | null = toFinitePositiveNumber(data.targetPercentage);

  if (target === null || target >= 100) {
    return null;
  }

  /*
   * 100 - 99.9 is 0.09999999999999432 in floating point; round it back to
   * the number the user typed before showing it.
   */
  const allowedPercentage: number = Number((100 - target).toFixed(6));
  const allowedFraction: number = allowedPercentage / 100;

  if (data.windowType === SloWindowType.CalendarMonth) {
    const thirtyDayBudget: string = formatDurationCompact(
      Math.round(allowedFraction * 30 * SECONDS_PER_DAY),
    );

    return `${allowedPercentage}% of each month: ${thirtyDayBudget} of downtime in a 30-day month`;
  }

  const windowDays: number =
    toFinitePositiveNumber(data.windowDays) ?? DEFAULT_ROLLING_WINDOW_DAYS;
  const budget: string = formatDurationCompact(
    Math.round(allowedFraction * windowDays * SECONDS_PER_DAY),
  );

  return `${budget} of downtime per ${windowDays}-day window`;
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
