import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import NetworkDeviceAutoImportRule from "Common/Models/DatabaseModels/NetworkDeviceAutoImportRule";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Permission from "Common/Types/Permission";
import {
  DropdownOption,
  DropdownOptionGroup,
} from "Common/UI/Components/Dropdown/Dropdown";
import Column from "Common/UI/Components/ModelTable/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import DeviceMonitorTemplateUtil, {
  isDeviceAddressMonitorType,
  isDeviceMonitorTemplateType,
} from "Common/Utils/Monitor/DeviceMonitorTemplateUtil";
import {
  ADDRESS_TEMPLATES_GROUP_TITLE,
  POLL_TEMPLATES_GROUP_TITLE,
  UNNAMED_TEMPLATE_NAME,
  describeAddressTemplate,
} from "../../../Components/NetworkDevice/DiscoveryImport/DiscoveryImportTemplateCopy";

/*
 * THE MONITOR TEMPLATE A RULE GIVES ITS DEVICES (OneUptime issue #9510).
 *
 * The picker listed Network Device templates only, so a customer's Ping
 * template - labels, interval and criteria set up - could not be picked: the
 * list said "No options available", and every host the rule imported needed
 * its monitor added by hand. It lists every kind a device's monitor can be
 * made from now (DEVICE_MONITOR_TEMPLATE_TYPES), as Review Results does, in
 * the same two groups and with the same line under each address template;
 * the server refuses any other kind.
 */

// What the picker reads of each template: enough to name it and say what it checks.
export const AUTO_IMPORT_MONITOR_TEMPLATE_SELECT: {
  _id: true;
  templateName: true;
  monitorType: true;
  monitorSteps: true;
} = {
  _id: true,
  templateName: true,
  monitorType: true,
  monitorSteps: true,
};

/*
 * What the open list says when the project has no template a device's
 * monitor can be made from: which kinds it lists, and how to make one. The
 * field's Manage templates opens the templates in a new tab, and the step
 * reads the templates again whenever it is opened.
 */
export const NO_DEVICE_MONITOR_TEMPLATE_YET: string = translationKey(
  "No Network Device, Ping, IP, Port or NTP monitor template yet. Create one with Manage templates, and it is listed when you come back to this step.",
);

/*
 * The picker's options: Network Device templates, whose monitors read each
 * device's polls, then Ping, IP, Port and NTP templates, whose monitors
 * check each device's address - under a heading each when both kinds are
 * there, one kind alone needs none. A template of another kind, which the
 * list request should not have returned, is left out.
 */
export function getAutoImportMonitorTemplateOptions(data: {
  templates: ReadonlyArray<MonitorTemplate>;
  translator: Translator;
}): Array<DropdownOption | DropdownOptionGroup> {
  const toOption: (template: MonitorTemplate) => DropdownOption = (
    template: MonitorTemplate,
  ): DropdownOption => {
    const name: string = template.templateName?.trim() || "";

    return {
      value: template.id?.toString() || "",
      // Its own name as written; the word for none in the reader's words.
      label: name || UNNAMED_TEMPLATE_NAME,
      isUserContent: Boolean(name),
      ...(isDeviceAddressMonitorType(template.monitorType)
        ? {
            description: describeAddressTemplate(data.translator, {
              monitorType: template.monitorType,
              ports: DeviceMonitorTemplateUtil.readPorts(template.monitorSteps),
            }),
            // Worded above, in the reader's language.
            isDescriptionUserContent: true,
          }
        : {}),
    };
  };

  const offered: Array<MonitorTemplate> = data.templates.filter(
    (template: MonitorTemplate): boolean => {
      return (
        Boolean(template.id) &&
        isDeviceMonitorTemplateType(template.monitorType)
      );
    },
  );

  const pollOptions: Array<DropdownOption> = offered
    .filter((template: MonitorTemplate): boolean => {
      return template.monitorType === MonitorType.NetworkDevice;
    })
    .map(toOption);
  const addressOptions: Array<DropdownOption> = offered
    .filter((template: MonitorTemplate): boolean => {
      return isDeviceAddressMonitorType(template.monitorType);
    })
    .map(toOption);

  if (pollOptions.length > 0 && addressOptions.length > 0) {
    return [
      {
        label: data.translator.translateText(
          POLL_TEMPLATES_GROUP_TITLE,
        ) as string,
        options: pollOptions,
      },
      {
        label: data.translator.translateText(
          ADDRESS_TEMPLATES_GROUP_TITLE,
        ) as string,
        options: addressOptions,
      },
    ];
  }

  return [...pollOptions, ...addressOptions];
}

/*
 * The one behaviour a monitor template cannot go with: an exclusion rule
 * imports nothing, so it has nothing to monitor.
 *
 * Ping-only hosts used to be the second. They imported as monitor-backed
 * devices that nothing polled, so a Network Device monitor on one had no
 * polls to read. They import as probe-polled devices now - the probe pings
 * them - and a template's reachability check reads that ping, so a rule
 * that includes them gets them monitored like any other device, exactly as
 * an import from Review Results does. (The server has allowed it since
 * ping-first polling; only this form still refused it.)
 */
export type MonitorIncompatibleBehaviorField = "isExclusion";

export function canSelectAutoImportMonitorTemplate(
  values: FormValues<NetworkDeviceAutoImportRule>,
): boolean {
  return !values.isExclusion;
}

/*
 * Selecting an unreadable relation column fails the whole rule list request,
 * so the column is asked for only when the user may read it. A rule's
 * template is read with the rule itself (the model's read list), so every
 * rule reader sees which template a rule applies; the template's name rides
 * along on the relation. The optional permission set is a deterministic test
 * seam.
 */
export function getReadableMonitorTemplateColumn(
  permissions?: Array<Permission>,
): Column<NetworkDeviceAutoImportRule> | null {
  if (
    !PermissionGate.canReadColumn(
      new NetworkDeviceAutoImportRule(),
      "monitorTemplate",
      { permissions },
    )
  ) {
    return null;
  }

  /*
   * `selectedProperty` is what makes this cell render the template's name.
   * The table derives its cell key from the first key of `field` alone, so
   * without it the key is the relation itself and both the cell and the CSV
   * exporter receive the MonitorTemplate object — the table stringifies it to
   * "[object Object]" and the exporter falls through to raw JSON. Naming the
   * property extends the key to "monitorTemplate.templateName", which both
   * resolve to the string. A `getElement` would only fix the cell: the
   * exporter never calls it, and it looks for display keys "name"/"title"/
   * "value", none of which is MonitorTemplate's `templateName`.
   */
  return {
    field: { monitorTemplate: { templateName: true } },
    title: "Monitor Template",
    type: FieldType.Entity,
    selectedProperty: "templateName",
  };
}

/*
 * Hidden form fields remain part of BasicForm's submitted value. Clear the
 * relation under both writable spellings when a behavior toggle makes
 * monitor provisioning invalid, including on edits where null (rather than
 * undefined) is what tells the API to remove a persisted relation.
 */
export function updateMonitorIncompatibleBehavior(
  currentValues: FormValues<NetworkDeviceAutoImportRule>,
  field: MonitorIncompatibleBehaviorField,
  value: boolean,
): FormValues<NetworkDeviceAutoImportRule> {
  const nextValues: FormValues<NetworkDeviceAutoImportRule> = {
    ...currentValues,
    [field]: value,
  };

  if (value) {
    nextValues.monitorTemplate = null;
    (nextValues as unknown as Record<string, unknown>)["monitorTemplateId"] =
      null;
  }

  return nextValues;
}
