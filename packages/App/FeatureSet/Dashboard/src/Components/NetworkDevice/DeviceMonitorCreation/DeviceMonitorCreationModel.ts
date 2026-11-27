import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import { MAX_DEVICES_PER_MONITOR_CREATION } from "Common/Types/NetworkDevice/DiscoveryImport";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  DropdownOption,
  DropdownOptionGroup,
} from "Common/UI/Components/Dropdown/Dropdown";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  DiscoveryImportTemplateChoice,
  checksDeviceAddress,
  checksDeviceUrl,
  checksFromProbe,
  getTemplateChoiceValue,
} from "../DiscoveryImport/DiscoveryImportOutcome";
import {
  ADDRESS_TEMPLATES_GROUP_TITLE,
  POLL_TEMPLATES_GROUP_TITLE,
  UNNAMED_TEMPLATE_NAME,
  WEB_TEMPLATES_GROUP_TITLE,
  describeDeviceTemplate,
} from "../DiscoveryImport/DiscoveryImportTemplateCopy";

/*
 * CREATE MONITORS, ON THE DEVICES LIST (OneUptime issue #10990).
 *
 * Devices already in Network Devices - however they were added: a scan, by
 * hand, a CSV, a controller - had no way to get a monitor but through a
 * scan's results. Bulk Actions > Create Monitors gives each selected device
 * one monitor from a template, on the server (DiscoveryImportRunner's
 * Devices source), so a selection of thousands is one press and the window
 * can be closed. A device that has a monitor the template's would duplicate
 * keeps it, and nothing is made twice.
 *
 * What the dialog decides before anything is sent, React-free so App's
 * tests hold each rule on its own.
 */

export const CREATE_MONITORS_ACTION_TITLE: string =
  translationKey("Create Monitors");

// The dialog's one line under its title: what happens, and what never does.
export const CREATE_MONITORS_EXPLANATION: string = translationKey(
  "Each device gets one monitor from the template. A device that already has one from it keeps it, and none is created twice. Each monitor counts towards your plan.",
);

export const NO_DEVICES_SELECTED: string = translationKey(
  "Select the devices to create monitors for.",
);

export const PICK_A_TEMPLATE: string = translationKey(
  "Pick the monitor template to create the monitors from.",
);

/*
 * A Network Device template's monitor reads each device's polls, so a
 * device that takes its status from a bound monitor - nothing polls it -
 * gets none, and the run says so beside it.
 */
export const MONITOR_BACKED_DEVICES_NOTE: string = translationKey(
  "Devices that take their status from a monitor bound to them get no Network Device monitor: nothing polls them.",
);

// The ids of the selected devices, each once, in the order selected.
export function getSelectedDeviceIds(
  items: ReadonlyArray<NetworkDevice>,
): Array<string> {
  const seen: Set<string> = new Set<string>();
  const ids: Array<string> = [];

  for (const item of items) {
    const id: string = (item._id?.toString() || item.id?.toString() || "")
      .trim()
      .toLowerCase();

    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(item._id?.toString() || item.id!.toString());
    }
  }

  return ids;
}

// How many of the selected devices take their status from a bound monitor.
export function countMonitorBackedDevices(
  items: ReadonlyArray<NetworkDevice>,
): number {
  return items.filter((item: NetworkDevice): boolean => {
    return NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
      item.monitoringMethod,
    );
  }).length;
}

/*
 * Why the dialog cannot start, in English (a key of the locale files), or
 * null when it can: no devices, more than one run gives monitors to, no
 * template picked, or one no device's monitor can be made from.
 */
export function getDeviceMonitorCreationBlocker(data: {
  deviceCount: number;
  template: DiscoveryImportTemplateChoice | null;
}): string | null {
  if (data.deviceCount <= 0) {
    return NO_DEVICES_SELECTED;
  }

  if (data.deviceCount > MAX_DEVICES_PER_MONITOR_CREATION) {
    return translationKey(
      "Monitors are created for up to 5,000 devices at a time. Narrow the list by site, role or label, and create them in parts: devices that already have the template's monitor are left as they are.",
    );
  }

  if (!data.template) {
    return PICK_A_TEMPLATE;
  }

  if (data.template.unusableReason) {
    return data.template.unusableReason;
  }

  return null;
}

// A template's name as the picker draws it: as someone typed it.
export function getTemplateName(
  translator: Translator,
  choice: DiscoveryImportTemplateChoice,
): string {
  return (
    choice.name || (translator.translateText(UNNAMED_TEMPLATE_NAME) as string)
  );
}

function toTemplateOption(
  translator: Translator,
  choice: DiscoveryImportTemplateChoice,
): DropdownOption {
  const description: string | undefined = describeDeviceTemplate(
    translator,
    choice,
  );

  return {
    value: getTemplateChoiceValue(choice),
    label: choice.isCreatedOnImport
      ? translator.translateTemplate("{{name}} - created when you start", {
          name: getTemplateName(translator, choice),
        })
      : getTemplateName(translator, choice),
    // Drawn as named: a template called "Labels" is not translated.
    isUserContent: true,
    ...(description
      ? { description: description, isDescriptionUserContent: true }
      : {}),
  };
}

/*
 * The templates as the picker lists them, in the import's order and under
 * its headings when there are two kinds or more: the ones that read each
 * device's polls, the ones that check its address, the ones that check a
 * URL on it. One kind alone needs no heading.
 */
export function getTemplateOptions(
  translator: Translator,
  templates: ReadonlyArray<DiscoveryImportTemplateChoice>,
): Array<DropdownOption | DropdownOptionGroup> {
  const pollOptions: Array<DropdownOption> = templates
    .filter((choice: DiscoveryImportTemplateChoice): boolean => {
      return !checksFromProbe(choice);
    })
    .map((choice: DiscoveryImportTemplateChoice): DropdownOption => {
      return toTemplateOption(translator, choice);
    });
  const addressOptions: Array<DropdownOption> = templates
    .filter(checksDeviceAddress)
    .map((choice: DiscoveryImportTemplateChoice): DropdownOption => {
      return toTemplateOption(translator, choice);
    });
  const webOptions: Array<DropdownOption> = templates
    .filter(checksDeviceUrl)
    .map((choice: DiscoveryImportTemplateChoice): DropdownOption => {
      return toTemplateOption(translator, choice);
    });

  const groups: Array<DropdownOptionGroup> = [
    {
      label: translator.translateText(POLL_TEMPLATES_GROUP_TITLE) as string,
      options: pollOptions,
    },
    {
      label: translator.translateText(ADDRESS_TEMPLATES_GROUP_TITLE) as string,
      options: addressOptions,
    },
    {
      label: translator.translateText(WEB_TEMPLATES_GROUP_TITLE) as string,
      options: webOptions,
    },
  ].filter((group: DropdownOptionGroup): boolean => {
    return group.options.length > 0;
  });

  return groups.length > 1
    ? groups
    : [...pollOptions, ...addressOptions, ...webOptions];
}

/*
 * The template the dialog starts on: the recommended one when the project
 * has it or can create it, else the first listed - the import's own
 * default (keepPickedTemplate).
 */
export function getDefaultTemplateValue(
  templates: ReadonlyArray<DiscoveryImportTemplateChoice>,
): string {
  const first: DiscoveryImportTemplateChoice | undefined = templates[0];

  return first ? getTemplateChoiceValue(first) : "";
}

export function findTemplateChoice(
  templates: ReadonlyArray<DiscoveryImportTemplateChoice>,
  value: string,
): DiscoveryImportTemplateChoice | null {
  return (
    templates.find((choice: DiscoveryImportTemplateChoice): boolean => {
      return getTemplateChoiceValue(choice) === value;
    }) || null
  );
}

// Whether a Network Device template's monitors leave monitor-backed devices out.
export function readsDevicePolls(
  template: DiscoveryImportTemplateChoice | null,
): boolean {
  return template?.monitorType === MonitorType.NetworkDevice;
}
