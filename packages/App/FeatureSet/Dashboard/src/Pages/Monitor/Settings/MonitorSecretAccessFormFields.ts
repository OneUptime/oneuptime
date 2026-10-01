import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorSecretAccess from "Common/Types/Monitor/MonitorSecretAccess";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

/*
 * The Access step of the monitor secret form (issue #1467): pick one of three
 * modes, and the picker for that mode appears below it - monitors for
 * Specific monitors, labels for Monitors with labels, nothing for All
 * monitors. Kept React-free, like SloSettingsFormFields.ts, so App tests can
 * import it without the Dashboard's react.
 *
 * The picker of a mode that is not chosen is hidden and not required, but
 * whatever was picked in it stays in the form while the user changes their
 * mind, and is sent with the rest. That is harmless: MonitorSecretService
 * empties the lists a mode does not use whenever the mode is saved.
 */

export const MONITOR_SECRET_ACCESS_STEP_ID: string = "access";

// How the table and the cards name each mode.
export const MONITOR_SECRET_ACCESS_TITLES: Record<MonitorSecretAccess, string> =
  {
    [MonitorSecretAccess.AllMonitors]: "All monitors",
    [MonitorSecretAccess.SpecificMonitors]: "Specific monitors",
    [MonitorSecretAccess.MonitorsWithLabels]: "Monitors with labels",
  };

// In the order the form offers them: widest first.
export const MONITOR_SECRET_ACCESS_OPTIONS: Array<CardSelectOption> = [
  {
    value: MonitorSecretAccess.AllMonitors,
    title: MONITOR_SECRET_ACCESS_TITLES[MonitorSecretAccess.AllMonitors],
    icon: IconProp.Squares,
    description:
      "Every monitor in this project can use this secret, including monitors you create later.",
  },
  {
    value: MonitorSecretAccess.SpecificMonitors,
    title: MONITOR_SECRET_ACCESS_TITLES[MonitorSecretAccess.SpecificMonitors],
    icon: IconProp.ListBullet,
    description: "Only the monitors you pick can use this secret.",
  },
  {
    value: MonitorSecretAccess.MonitorsWithLabels,
    title: MONITOR_SECRET_ACCESS_TITLES[MonitorSecretAccess.MonitorsWithLabels],
    icon: IconProp.Label,
    description:
      "Monitors with any of the labels you pick can use this secret. Adding one of these labels to a monitor gives it access.",
  },
];

/*
 * CardSelect shows option titles and descriptions as given, so the page
 * hands in its translator; the table's Access cell names the modes in the
 * same words. Without one the English text is used, as in tests.
 */
export type TranslateFunction = (text: string) => string;

const untranslated: TranslateFunction = (text: string): string => {
  return text;
};

export type GetMonitorSecretAccessOptionsFunction = (
  translate?: TranslateFunction,
) => Array<CardSelectOption>;

export const getMonitorSecretAccessOptions: GetMonitorSecretAccessOptionsFunction =
  (translate: TranslateFunction = untranslated): Array<CardSelectOption> => {
    return MONITOR_SECRET_ACCESS_OPTIONS.map(
      (option: CardSelectOption): CardSelectOption => {
        return {
          ...option,
          title: translate(option.title),
          description: translate(option.description),
        };
      },
    );
  };

type IsAccessFunction = (values: FormValues<MonitorSecret>) => boolean;

export const isSpecificMonitorsAccess: IsAccessFunction = (
  values: FormValues<MonitorSecret>,
): boolean => {
  return values.monitorAccess === MonitorSecretAccess.SpecificMonitors;
};

export const isMonitorsWithLabelsAccess: IsAccessFunction = (
  values: FormValues<MonitorSecret>,
): boolean => {
  return values.monitorAccess === MonitorSecretAccess.MonitorsWithLabels;
};

export type GetMonitorSecretAccessFormFieldsFunction = (
  translate?: TranslateFunction,
) => Array<ModelField<MonitorSecret>>;

export const getMonitorSecretAccessFormFields: GetMonitorSecretAccessFormFieldsFunction =
  (
    translate: TranslateFunction = untranslated,
  ): Array<ModelField<MonitorSecret>> => {
    return [
      {
        field: {
          monitorAccess: true,
        },
        title: "Which monitors can use this secret?",
        stepId: MONITOR_SECRET_ACCESS_STEP_ID,
        fieldType: FormFieldSchemaType.CardSelect,
        cardSelectSingleColumn: true,
        cardSelectOptions: getMonitorSecretAccessOptions(translate),
        /*
         * The narrowest mode that still lets a monitor use the secret, and
         * the only one there was before #1467.
         */
        defaultValue: MonitorSecretAccess.SpecificMonitors,
        required: true,
      },
      {
        field: {
          monitors: true,
        },
        title: "Monitors",
        stepId: MONITOR_SECRET_ACCESS_STEP_ID,
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        dropdownModal: {
          type: Monitor,
          labelField: "name",
          valueField: "_id",
        },
        showIf: isSpecificMonitorsAccess,
        required: isSpecificMonitorsAccess,
        description: "These monitors can use this secret.",
        placeholder: "Select monitors",
      },
      {
        field: {
          labels: true,
        },
        title: "Labels",
        stepId: MONITOR_SECRET_ACCESS_STEP_ID,
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        dropdownModal: {
          type: Label,
          labelField: "name",
          valueField: "_id",
        },
        showIf: isMonitorsWithLabelsAccess,
        required: isMonitorsWithLabelsAccess,
        description:
          "Monitors with at least one of these labels can use this secret.",
        placeholder: "Select labels",
      },
    ];
  };
