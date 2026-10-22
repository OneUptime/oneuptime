import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveryImportAlerting,
  DiscoveryImportDeviceOutcome,
  DiscoveryImportHostResult,
  DiscoveryImportSettings,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import { DiscoveryScanStatus } from "Common/Utils/NetworkDiscovery/DiscoveryScanStatus";
import {
  DiscoveredHostFilter,
  DiscoveredHostNameFilter,
  DiscoveredHostQuery,
  markDiscoveredHostsAsRegistered,
  normalizeDiscoveredHosts,
} from "../DiscoveredHostFilter";
import { getDiscoveredHosts } from "../DiscoveryScanOutcome";
import { isWaitingForDiscoveryProgress } from "../DiscoveryScanProgressState";
import {
  DiscoveryImportTemplateChoice,
  getTemplateChoiceValue,
} from "./DiscoveryImportOutcome";

/*
 * What the import dialog reads and reasons about before anything is sent:
 * the scan's columns it reads, the hosts it lists, the addresses an import
 * put in the inventory, and the template the settings pick. React-free, so
 * each rule is tested on its own (App/Tests/Dashboard).
 */

/*
 * The columns the dialog reads the scan with: its identity and state, the
 * hosts it found, and what the row names and explanations read. Fresh on
 * every open - the table row may be minutes old, and the scan can have been
 * edited in another tab.
 */
export const DISCOVERY_REVIEW_SCAN_SELECT: {
  [key: string]: boolean;
} = {
  _id: true,
  projectId: true,
  name: true,
  cidr: true,
  status: true,
  statusMessage: true,
  discoveredDevices: true,
  probeId: true,
  isSnmpEnabled: true,
  useShortDeviceNames: true,
  isNetbiosLookupEnabled: true,
};

export const DEFAULT_DISCOVERY_REVIEW_QUERY: DiscoveredHostQuery = {
  answered: DiscoveredHostFilter.All,
  name: DiscoveredHostNameFilter.Any,
  search: "",
  hideAlreadyAdded: false,
};

/*
 * The hosts the dialog reasons about: what the probe found, normalised, with
 * the hosts a finished import of this sitting created marked as added - so
 * they read "Already added" at once, before the scan is read again.
 */
export function getReviewHosts(data: {
  scan: NetworkDeviceDiscoveryScan | null;
  importedAddresses: Set<string>;
}): Array<DiscoveredNetworkDevice> {
  if (
    !data.scan ||
    data.scan.status === DiscoveryScanStatus.Pending ||
    isWaitingForDiscoveryProgress(data.scan)
  ) {
    return [];
  }

  return markDiscoveredHostsAsRegistered({
    hosts: normalizeDiscoveredHosts(getDiscoveredHosts(data.scan)),
    importedIpAddresses: data.importedAddresses,
  });
}

// The addresses an import put in the inventory, or found there.
export function getImportedAddresses(
  results: ReadonlyArray<DiscoveryImportHostResult> | undefined,
): Array<string> {
  return (results || [])
    .filter((result: DiscoveryImportHostResult): boolean => {
      return (
        result.device === DiscoveryImportDeviceOutcome.Created ||
        result.device === DiscoveryImportDeviceOutcome.AlreadyAdded
      );
    })
    .map((result: DiscoveryImportHostResult): string => {
      return result.ipAddress;
    });
}

/*
 * The template the settings pick, among the choices: the one whose id they
 * name, or - for the recommended template Import would create - the choice
 * with no id.
 */
export function getPickedTemplate(data: {
  settings: DiscoveryImportSettings;
  templates: ReadonlyArray<DiscoveryImportTemplateChoice>;
}): DiscoveryImportTemplateChoice | null {
  if (data.settings.alerting !== DiscoveryImportAlerting.MonitorTemplate) {
    return null;
  }

  const picked: string = data.settings.monitorTemplateId || "";

  return (
    data.templates.find((choice: DiscoveryImportTemplateChoice): boolean => {
      return getTemplateChoiceValue(choice) === picked;
    }) || null
  );
}

/*
 * The settings once the project's templates are read - when the step opens,
 * and again each time the reader comes back to the dialog's window, since
 * "Manage templates" opens the templates in a new tab (OneUptime issue
 * #5145). The template they pick stays picked while it is still listed; one
 * that is gone gives way to the first choice (the recommended one), as when
 * the step first opened. With no template left to pick, nothing is picked
 * and the import makes no monitors: the step shows "Status only", and the
 * import must not wait for a template that cannot be picked.
 */
export function keepPickedTemplate(data: {
  settings: DiscoveryImportSettings;
  templates: ReadonlyArray<DiscoveryImportTemplateChoice>;
}): DiscoveryImportSettings {
  const first: DiscoveryImportTemplateChoice | undefined = data.templates[0];

  if (!first) {
    if (
      data.settings.alerting === DiscoveryImportAlerting.None &&
      !data.settings.monitorTemplateId
    ) {
      return data.settings;
    }

    return {
      ...data.settings,
      alerting: DiscoveryImportAlerting.None,
      monitorTemplateId: undefined,
    };
  }

  const picked: string = data.settings.monitorTemplateId || "";

  const isStillListed: boolean = data.templates.some(
    (choice: DiscoveryImportTemplateChoice): boolean => {
      return getTemplateChoiceValue(choice) === picked;
    },
  );

  if (picked && isStillListed) {
    return data.settings;
  }

  return {
    ...data.settings,
    monitorTemplateId: getTemplateChoiceValue(first),
  };
}
