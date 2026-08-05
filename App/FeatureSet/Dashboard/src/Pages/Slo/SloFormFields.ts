import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Label from "Common/Models/DatabaseModels/Label";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import SloMultiMonitorMode from "Common/Types/ServiceLevelObjective/SloMultiMonitorMode";
import { DEFAULT_ROLLING_WINDOW_DAYS } from "Common/Utils/Slo/SloHealth";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import TimezoneUtil from "Common/UI/Utils/Timezone";

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

const SLO_TARGET_HELP_TEXT: string =
  "Reliability target as a percentage, e.g. 99.9. Must be greater than 0 and at most 99.999 — a 100% target leaves no error budget to track.";

/*
 * Client-side mirrors of ServiceLevelObjectiveService.validateTargetPercentage
 * and validateAtRiskThresholdPercentage. Without them the only feedback on a
 * bad number was a failed round-trip rendering the raw server exception, and
 * the whole create modal had to be re-submitted to find out.
 */
export type ValidateTargetPercentageFunction = (
  value: FormValues<ServiceLevelObjective>,
) => string | null;

export const validateTargetPercentage: ValidateTargetPercentageFunction = (
  value: FormValues<ServiceLevelObjective>,
): string | null => {
  const target: number = Number(value.targetPercentage);

  if (!isFinite(target) || target <= 0 || target > 99.999) {
    return "Target must be greater than 0 and at most 99.999.";
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
    return "At-risk threshold must be a percentage between 0 and 100.";
  }

  /*
   * The column is an integer, so 20.5 would clear the range check and then
   * fail the INSERT with a raw driver error the user cannot act on.
   */
  if (!Number.isInteger(threshold)) {
    return "At-risk threshold must be a whole number.";
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

  if (!isFinite(windowDays) || windowDays < 1 || windowDays > 366) {
    return "Window must be between 1 and 366 days.";
  }

  if (!Number.isInteger(windowDays)) {
    return "Window must be a whole number of days.";
  }

  return null;
};

/*
 * Shared by the create modal and the SLO Details edit form so the two can
 * never drift apart. The list previously offered only name, description,
 * monitors, target, window days and labels, which meant every SLO that
 * needed a calendar month, a custom at-risk threshold, a multi-monitor mode
 * or non-default downtime statuses had to be created and then immediately
 * edited. Worse, the seeded burn rate rules are scaled from the window at
 * create time, so a calendar-month SLO created as "30 days rolling" kept
 * rules calibrated for the wrong window.
 */
export interface GetSloFormFieldsOptions {
  /**
   * The edit form on the SLO Details card offers Enabled; the create modal
   * does not, because a brand-new SLO is always created enabled and the
   * toggle would only be a way to create something inert by accident.
   */
  includeIsEnabled?: boolean | undefined;
}

export type GetSloFormFieldsFunction = (
  options?: GetSloFormFieldsOptions | undefined,
) => Array<ModelField<ServiceLevelObjective>>;

export const getSloFormFields: GetSloFormFieldsFunction = (
  options?: GetSloFormFieldsOptions | undefined,
): Array<ModelField<ServiceLevelObjective>> => {
  const fields: Array<ModelField<ServiceLevelObjective>> = [
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
        description: true,
      },
      title: "Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "99.9% availability for the public API",
    },
    {
      field: {
        monitors: true,
      },
      title: "Monitors",
      description:
        "Monitors whose uptime is measured by this SLO. Time when any of these monitors is down spends error budget.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Monitor,
        labelField: "name",
        valueField: "_id",
      },
      /*
       * Required only when nothing else can fill the list. An SLO driven
       * entirely by the label rule below starts with no monitors picked by
       * hand, and the server attaches the matching ones the moment it is
       * saved — demanding a manual pick there would force the user to attach
       * a monitor they did not mean to curate.
       */
      required: (item: FormValues<ServiceLevelObjective>): boolean => {
        const monitorLabels: unknown = item.monitorLabels;
        return !Array.isArray(monitorLabels) || monitorLabels.length === 0;
      },
      placeholder: "Select Monitors",
    },
    {
      field: {
        monitorLabels: true,
      },
      title: "Auto-Add Monitors With Labels",
      description:
        "Keep this SLO's monitor list in step with your labels: every monitor carrying one of these labels is attached automatically, and is detached again when it stops carrying any of them. Monitors you attach by hand above are never removed.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Label,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Select Monitor Labels",
    },
    {
      field: {
        targetPercentage: true,
      },
      title: "Target (%)",
      description: SLO_TARGET_HELP_TEXT,
      fieldType: FormFieldSchemaType.Number,
      required: true,
      placeholder: "99.9",
      customValidation: validateTargetPercentage,
    },
    {
      field: {
        windowType: true,
      },
      title: "Window Type",
      description:
        "Rolling windows look back a fixed number of days and recover continuously. Calendar Month resets the whole budget on the first of each month.",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(SloWindowType),
      required: true,
      placeholder: "Rolling",
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
        "Length of the rolling compliance window the SLI is measured over. Between 1 and 366 days.",
      fieldType: FormFieldSchemaType.Number,
      required: true,
      placeholder: "30",
      customValidation: validateWindowDays,
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
        "Decides when the calendar month rolls over. Ignored for Rolling windows. Defaults to UTC.",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: TimezoneUtil.getTimezoneDropdownOptions(),
      required: false,
      placeholder: "Select Timezone",
      showIf: (item: FormValues<ServiceLevelObjective>): boolean => {
        return item.windowType === SloWindowType.CalendarMonth;
      },
    },
    {
      field: {
        atRiskThresholdPercentage: true,
      },
      title: "At-Risk Threshold (%)",
      description:
        "The SLO becomes At Risk when less than this percentage of the error budget remains. Default is 20.",
      fieldType: FormFieldSchemaType.Number,
      /*
       * Required because the column is NOT NULL with a DB default, so the
       * box is always prefilled: clearing a field the UI called optional
       * would otherwise submit "" into an integer column and fail the whole
       * save with an opaque server error.
       */
      required: true,
      placeholder: "20",
      customValidation: validateAtRiskThreshold,
    },
    {
      field: {
        multiMonitorMode: true,
      },
      title: "Multi Monitor Mode",
      description:
        "How downtime counts when several monitors are attached: time when any monitor is down, or an average across monitors.",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions:
        DropdownUtil.getDropdownOptionsFromEnum(SloMultiMonitorMode),
      required: true,
      placeholder: "Any Monitor Down",
    },
    {
      field: {
        downtimeMonitorStatuses: true,
      },
      title: "Downtime Monitor Statuses",
      description:
        "Monitor statuses that count as downtime for this SLO. Leave empty to use every non-operational status.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: MonitorStatus,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Select Statuses",
    },
    {
      field: {
        labels: true,
      },
      title: "Labels",
      description: "Organize and filter SLOs with labels.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Label,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Labels",
    },
  ];

  if (options?.includeIsEnabled) {
    fields.push({
      field: {
        isEnabled: true,
      },
      title: "Enabled",
      description:
        "Disabled SLOs are not evaluated and do not fire burn-rate alerts.",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    });
  }

  return fields;
};
