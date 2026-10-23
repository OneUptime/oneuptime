import HostCollectorConfig from "Common/Models/DatabaseModels/HostCollectorConfig";
import Label from "Common/Models/DatabaseModels/Label";
import { sortLabelNames } from "Common/Utils/LabelOrder";
// Types only, so App tests (no React) can load this module.
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import type { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import {
  HOST_COLLECTOR_OS_NAMES,
  HostCollectorOsType,
} from "Common/Types/HostCollector/HostCollector";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Creating a Collector Config asks three things, on one page: a name, the
 * system of the hosts it is for, and - when it is for some of them - their
 * labels. Its config.yaml starts as OneUptime's default for that system
 * (the server fills it in), and is edited on the config's own page.
 *
 * React-free: App tests read it.
 */

// The choices, Linux first: most hosts run it.
export const HOST_COLLECTOR_CONFIG_OS_CHOICES: Array<RadioButton> = [
  {
    title: HOST_COLLECTOR_OS_NAMES[HostCollectorOsType.Linux],
    value: HostCollectorOsType.Linux,
  },
  {
    title: HOST_COLLECTOR_OS_NAMES[HostCollectorOsType.Windows],
    value: HostCollectorOsType.Windows,
  },
  {
    title: HOST_COLLECTOR_OS_NAMES[HostCollectorOsType.MacOS],
    value: HostCollectorOsType.MacOS,
  },
  {
    title: translationKey("Any system"),
    description: translationKey(
      "Host metrics only: what every system can collect.",
    ),
    value: HostCollectorOsType.Any,
  },
];

/*
 * What the System choice says: where a new config's YAML comes from, or -
 * editing one - that changing the system leaves its YAML as it is.
 */
export const HOST_COLLECTOR_CONFIG_SYSTEM_CREATE_DESCRIPTION: string =
  translationKey(
    "Its config.yaml starts as OneUptime's default for this system. Edit it on the config's page.",
  );
export const HOST_COLLECTOR_CONFIG_SYSTEM_EDIT_DESCRIPTION: string =
  translationKey("Changing it does not change config.yaml.");

export function getHostCollectorConfigFormFields(options?: {
  // The Edit Collector Config form of a config's page.
  isEditing?: boolean | undefined;
}): Array<ModelField<HostCollectorConfig>> {
  return [
    {
      // The placeholder says what a name is: what its hosts have in common.
      field: {
        name: true,
      },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Web servers",
      // Not the column's API description either: the placeholder says it.
      hideColumnDescription: true,
    },
    {
      field: {
        osType: true,
      },
      title: "System",
      fieldType: FormFieldSchemaType.RadioButton,
      radioButtonOptions: HOST_COLLECTOR_CONFIG_OS_CHOICES,
      required: true,
      defaultValue: HostCollectorOsType.Linux,
      description: options?.isEditing
        ? HOST_COLLECTOR_CONFIG_SYSTEM_EDIT_DESCRIPTION
        : HOST_COLLECTOR_CONFIG_SYSTEM_CREATE_DESCRIPTION,
    },
    {
      field: {
        labels: true,
      },
      title: "Host Labels",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Label,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Every host of this system",
      description:
        "Only hosts with one of these labels get this config. Leave empty for every host of its system.",
    },
  ];
}

/*
 * Who a config is for, in one line: "Linux hosts", "Windows hosts with
 * env:production or team:web", "Hosts on any system".
 */
export function describeHostCollectorConfigTarget(data: {
  osType: string | null | undefined;
  labelNames: Array<string>;
}): { template: string; labels: string } {
  // In natural order, as labels are listed everywhere (Utils/LabelOrder).
  const labelNames: Array<string> = sortLabelNames(data.labelNames);
  const labels: string = labelNames.join(", ");
  const hasLabels: boolean = labelNames.length > 0;

  switch (data.osType) {
    case HostCollectorOsType.Windows:
      return {
        template: hasLabels
          ? translationKey("Windows hosts with {{labels}}")
          : translationKey("Windows hosts"),
        labels,
      };
    case HostCollectorOsType.MacOS:
      return {
        template: hasLabels
          ? translationKey("macOS hosts with {{labels}}")
          : translationKey("macOS hosts"),
        labels,
      };
    case HostCollectorOsType.Any:
      return {
        template: hasLabels
          ? translationKey("Hosts on any system with {{labels}}")
          : translationKey("Hosts on any system"),
        labels,
      };
    default:
      return {
        template: hasLabels
          ? translationKey("Linux hosts with {{labels}}")
          : translationKey("Linux hosts"),
        labels,
      };
  }
}
