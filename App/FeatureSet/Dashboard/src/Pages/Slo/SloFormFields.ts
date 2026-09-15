import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Label from "Common/Models/DatabaseModels/Label";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import {
  DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
  DEFAULT_ROLLING_WINDOW_DAYS,
} from "Common/Utils/Slo/SloHealth";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
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

/*
 * The examples are the part people actually need: "99.9" means nothing
 * until it is translated into how much downtime it allows.
 */
const SLO_TARGET_HELP_TEXT: string =
  "The share of time this SLO's monitors must be up, e.g. 99.9. Over 30 days, 99.9% allows 43 minutes of downtime and 99.99% allows about 4. Must be greater than 0 and at most 99.999 — a 100% target leaves no error budget to track.";

/*
 * The create form asks only what an SLO is: its name, the objective it
 * holds, the period it is measured over, and how it is filed.
 *
 * How it measures has pages of its own, and every one of those settings
 * starts from a server default, so the wizard no longer asks for them:
 *   - monitors: attached on the Monitors page, or by a Monitor Rule;
 *   - multiMonitorMode: the column's DB default, Any Monitor Down;
 *   - downtimeMonitorStatuses: every non-operational status of the project
 *     (ServiceLevelObjectiveService.onBeforeCreate);
 *   - isEnabled: the column's DB default, true.
 * ModelForm sends only the keys of the fields on the form, which is what
 * lets those defaults apply. The last three are edited on Settings.
 *
 * Objective and Period are separate steps because they answer separate
 * questions — "how reliable" and "over what time". The at-risk threshold
 * stays with the target, since it only means something next to it.
 *
 * Window Type stays on the same step as both conditional window fields:
 * validation only runs for the current step, and switching the type must
 * immediately reveal the field that belongs to that choice.
 */
export const SLO_FORM_STEPS: Array<FormStep<ServiceLevelObjective>> = [
  {
    id: "basic-info",
    title: "Basic Info",
  },
  {
    id: "objective",
    title: "Objective",
  },
  {
    id: "period",
    title: "Period",
  },
  {
    id: "labels",
    title: "Labels",
  },
];

/*
 * Numbers are seeded here rather than through `defaultValue`, which
 * FormField treats as absent when it is falsy. Nothing is seeded for the
 * columns the form no longer carries: ModelForm would not send them anyway,
 * and a stray key here would only suggest the form still decides them.
 */
export const SLO_CREATE_INITIAL_VALUES: FormValues<ServiceLevelObjective> = {
  windowType: SloWindowType.Rolling,
  windowDays: DEFAULT_ROLLING_WINDOW_DAYS,
  atRiskThresholdPercentage: DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
};

/*
 * One sentence per window type, shown under each option in the dropdown
 * and beside the chosen type on the Settings page, so the two can never
 * describe the same choice differently.
 */
export const SLO_WINDOW_TYPE_DESCRIPTIONS: Record<SloWindowType, string> = {
  [SloWindowType.Rolling]:
    "The last N days, recovering continuously as old downtime ages out of the window.",
  [SloWindowType.CalendarMonth]:
    "Each calendar month on its own. The whole error budget resets on the 1st.",
};

export type GetSloWindowTypeDropdownOptionsFunction =
  () => Array<DropdownOption>;

export const getSloWindowTypeDropdownOptions: GetSloWindowTypeDropdownOptionsFunction =
  (): Array<DropdownOption> => {
    return DropdownUtil.getDropdownOptionsFromEnum(SloWindowType).map(
      (option: DropdownOption): DropdownOption => {
        return {
          ...option,
          description:
            SLO_WINDOW_TYPE_DESCRIPTIONS[option.value as SloWindowType],
        };
      },
    );
  };

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
 * The create wizard's fields. Settings and the Overview's details card take
 * their fields from this list (see pickSloFormFields) rather than declaring
 * them a second time, so a help text or validator changed here changes
 * everywhere the same column is edited.
 */
export type GetSloFormFieldsFunction = () => Array<
  ModelField<ServiceLevelObjective>
>;

export const getSloFormFields: GetSloFormFieldsFunction = (): Array<
  ModelField<ServiceLevelObjective>
> => {
  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      stepId: "basic-info",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "API Availability",
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      stepId: "basic-info",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "99.9% availability for the public API",
    },
    {
      field: {
        targetPercentage: true,
      },
      title: "Target (%)",
      stepId: "objective",
      description: SLO_TARGET_HELP_TEXT,
      fieldType: FormFieldSchemaType.Number,
      required: true,
      placeholder: "99.9",
      customValidation: validateTargetPercentage,
    },
    {
      field: {
        atRiskThresholdPercentage: true,
      },
      title: "At-Risk Threshold (%)",
      stepId: "objective",
      description:
        "The SLO turns At Risk when less than this percentage of its error budget remains, so you hear about a burn before the budget is gone. A whole number from 0 to 100; the default is 20.",
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
        windowType: true,
      },
      title: "Window Type",
      stepId: "period",
      description:
        "Rolling suits services that should be reliable at every moment. Calendar Month suits objectives reported, or promised to customers, per month.",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getSloWindowTypeDropdownOptions(),
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
      stepId: "period",
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
      showIf: (item: FormValues<ServiceLevelObjective>): boolean => {
        return item.windowType !== SloWindowType.CalendarMonth;
      },
    },
    {
      field: {
        timezone: true,
      },
      title: "Timezone",
      stepId: "period",
      description:
        "Decides when each calendar month starts and ends. Defaults to UTC.",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: TimezoneUtil.getTimezoneDropdownOptions(),
      required: false,
      placeholder: "UTC",
      showIf: (item: FormValues<ServiceLevelObjective>): boolean => {
        return item.windowType === SloWindowType.CalendarMonth;
      },
    },
    {
      field: {
        labels: true,
      },
      title: "Labels",
      stepId: "labels",
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
};

/*
 * The create form's fields for the given columns, in the order asked for,
 * with their wizard step id dropped: the forms that reuse them (the
 * Overview's details card and the Settings cards) are single flat forms,
 * and a step id there would mean nothing.
 *
 * Everything else is kept as it is, including onChange and showIf, so the
 * Calendar Month backfill and the conditional window fields behave on
 * Settings exactly as they do in the wizard.
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

    const pickedField: ModelField<ServiceLevelObjective> = {
      ...createField,
    };
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
