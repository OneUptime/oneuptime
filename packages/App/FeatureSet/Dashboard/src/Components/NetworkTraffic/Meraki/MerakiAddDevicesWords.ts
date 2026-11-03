import {
  ADDABLE_CONTROLLER_PRODUCT_TYPES,
  NetworkControllerDeviceAddState,
  NetworkControllerDeviceAddStatus,
  NetworkControllerUnaddedDeviceCount,
  getAddableControllerDeviceCount,
  getControllerProductTypesToOffer,
  isNetworkControllerDeviceAddUnderWay,
} from "Common/Types/NetworkController/NetworkControllerDeviceAdd";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What a Meraki connection says about adding its devices as network devices
 * (Common/Types/NetworkController/NetworkControllerDeviceAdd): the note on
 * its row that offers it, the Add Meraki devices dialog, and how an ask
 * went.
 *
 * React-free (App's tests read it). Every sentence is an English
 * translation key, or a plural template translated where it is drawn. What
 * the server said in English about a device it could not add is kept apart,
 * as a failure's details, as a refused test's answer is.
 */

// The kinds, as the dialog lists them: plural nouns, a count beside each.
export const DEVICE_KIND_NAMES: Readonly<Record<string, string>> = {
  switch: translationKey("Switches"),
  wireless: translationKey("Access points"),
  appliance: translationKey("Security appliances"),
  cellularGateway: translationKey("Cellular gateways"),
  wirelessController: translationKey("Wireless controllers"),
  campusGateway: translationKey("Campus gateways"),
  camera: translationKey("Cameras"),
};

/*
 * The Meraki product lines of a kind, beside its name, where one line is
 * what people call it by. Model names: the same in every language.
 */
export const DEVICE_KIND_PRODUCT_LINES: Readonly<Record<string, string>> = {
  switch: "MS",
  wireless: "MR",
  appliance: "MX, Z",
  cellularGateway: "MG",
  camera: "MV",
};

export const ADD_DEVICES_TITLE: string = translationKey("Add Meraki devices");
export const ADD_DEVICES_ACTION: string = translationKey("Add devices");

// The row's note, for the kinds a next ask starts with.
export const NOT_ADDED_DEVICES_NOTE: PluralTemplate = {
  one: "{{count}} Meraki device is not a network device here yet.",
  other: "{{count}} Meraki devices are not network devices here yet.",
};

// A dialog's description: at most 150 characters (ShortDescriptionsGuard).
export const ADD_DEVICES_DESCRIPTION: string = translationKey(
  "Adds the devices of {{organization}} that are not here yet, at their management addresses. Meraki fills in their model, serial number and firmware.",
);

export const DEVICE_KINDS_LABEL: string = translationKey("Devices to add");

export const COUNTED_AT_NEXT_READ: string = translationKey(
  "The connection counts its devices at its next read, within a few minutes. Adding them now adds every device of the kinds picked that is not here yet.",
);

export const NOTHING_LEFT_TO_ADD: string = translationKey(
  "Every Meraki device that can be added is a network device here already.",
);

// Why some devices of the kinds picked are not added.
export const WITHOUT_ADDRESS_NOTE: PluralTemplate = {
  one: "{{count}} has no address in Meraki (a security appliance lists none). Add it by hand at the address your probe reaches it at, and Meraki fills in the rest.",
  other:
    "{{count}} have no address in Meraki (a security appliance lists none). Add one by hand at the address your probe reaches it at, and Meraki fills in the rest.",
};

export const TAKEN_NOTE: PluralTemplate = {
  one: "{{count}} has an address, MAC address or serial number another network device here already has.",
  other:
    "{{count}} have an address, MAC address or serial number another network device here already has.",
};

export const ARCHIVED_NOTE: PluralTemplate = {
  one: "{{count}} is archived here, so it is not added again.",
  other: "{{count}} are archived here, so they are not added again.",
};

// The fold's choices.
export const SITES_LABEL: string = translationKey("Sites");
export const SITES_CHECKBOX: string = translationKey(
  "Put each device in a site named after its Meraki network",
);
export const SITES_HELP: string = translationKey(
  "Uses the project's site of that name, or adds one. Unticked, your site rules place each device.",
);
export const SITES_ON_VALUE: string = translationKey(
  "Named after their networks",
);
export const PROBE_LABEL: string = translationKey("Probe");
export const NO_PROBE: string = translationKey("No probe");
// A field's description: at most 150 characters (ShortDescriptionsGuard).
export const PROBE_HELP: string = translationKey(
  "Pings each device, and walks it over SNMP once it has credentials. With none, a device shows what Meraki says, unless its site has a default probe.",
);

export const ADD_COUNT_BUTTON: PluralTemplate = {
  one: "Add {{count}} device",
  other: "Add {{count}} devices",
};

// While an ask is under way.
export const ADDING_DEVICES: string = translationKey(
  "Adding devices from Meraki…",
);
export const ADDING_DEVICES_PROGRESS: string = translationKey(
  "Adding devices from Meraki: {{added}} of {{total}} so far.",
);

// How the last ask went.
export const ADDED_DEVICES_NOTE: PluralTemplate = {
  one: "Added {{count}} network device from Meraki {{time}}.",
  other: "Added {{count}} network devices from Meraki {{time}}.",
};
export const ADDED_SITES_NOTE: PluralTemplate = {
  one: "Added {{count}} site for their Meraki networks.",
  other: "Added {{count}} sites for their Meraki networks.",
};
export const NOTHING_ADDED_NOTE: string = translationKey(
  "Nothing to add {{time}}: every device of the kinds picked is a network device here already.",
);
export const FAILED_DEVICES_NOTE: PluralTemplate = {
  one: "{{count}} device could not be added:",
  other: "{{count}} devices could not be added:",
};
export const REMAINING_DEVICES_NOTE: PluralTemplate = {
  one: "{{count}} more device is left to add. Add devices again to add it.",
  other: "{{count}} more devices are left to add. Add devices again to add them.",
};
export const ADD_FAILED_NOTE: string = translationKey(
  "Devices could not be added from Meraki: {{reason}}",
);
export const ADD_STOPPED_NOTE: string = translationKey(
  "Adding devices from Meraki stopped before it finished. Add devices again to carry on.",
);

// How long an ask's outcome stays on the connection's row.
export const DEVICE_ADD_OUTCOME_SHOWN_FOR_MS: number = 24 * 60 * 60 * 1000;

// The failures listed under the row's note; the rest are counted.
export const DEVICE_ADD_FAILURES_SHOWN: number = 3;

// Where the last ask stands, as the row draws it.
export enum DeviceAddStanding {
  // Never asked, or long ago: nothing to say.
  None = "none",
  UnderWay = "under-way",
  Done = "done",
  Failed = "failed",
  // Queued or adding, and its worker gone quiet.
  Stopped = "stopped",
}

export function getDeviceAddStanding(
  state: NetworkControllerDeviceAddState | undefined,
  now: Date,
): DeviceAddStanding {
  if (!state) {
    return DeviceAddStanding.None;
  }

  if (isNetworkControllerDeviceAddUnderWay(state, now)) {
    return DeviceAddStanding.UnderWay;
  }

  const endedAt: number = Date.parse(state.finishedAt || state.updatedAt);

  if (
    !Number.isFinite(endedAt) ||
    now.getTime() - endedAt > DEVICE_ADD_OUTCOME_SHOWN_FOR_MS
  ) {
    return DeviceAddStanding.None;
  }

  switch (state.status) {
    case NetworkControllerDeviceAddStatus.Done:
      return DeviceAddStanding.Done;
    case NetworkControllerDeviceAddStatus.Failed:
      return DeviceAddStanding.Failed;
    default:
      return DeviceAddStanding.Stopped;
  }
}

/*
 * What the row offers to add: the devices of the kinds the next ask starts
 * with that a read counted as addable. 0 for a read that counted nothing.
 */
export function getOfferedDeviceCount(data: {
  counts: Array<NetworkControllerUnaddedDeviceCount> | undefined;
  last: NetworkControllerDeviceAddState | undefined;
}): number {
  if (!data.counts) {
    return 0;
  }

  return getAddableControllerDeviceCount(
    data.counts,
    getControllerProductTypesToOffer(data.last),
  );
}

/*
 * The kinds the dialog lists: every kind the read counted an addable device
 * of, in the order they are listed - or every kind, when the read counted
 * nothing (a connection read before it could count them).
 */
export function getDialogDeviceKinds(
  counts: Array<NetworkControllerUnaddedDeviceCount> | undefined,
): Array<string> {
  if (!counts) {
    return [...ADDABLE_CONTROLLER_PRODUCT_TYPES];
  }

  return counts
    .filter((count: NetworkControllerUnaddedDeviceCount): boolean => {
      return count.addable > 0;
    })
    .map((count: NetworkControllerUnaddedDeviceCount): string => {
      return count.productType;
    });
}

// The devices of the kinds picked that are not added, by why.
export interface NotAddedCounts {
  withoutAddress: number;
  taken: number;
  archived: number;
}

export function getNotAddedCounts(data: {
  counts: Array<NetworkControllerUnaddedDeviceCount> | undefined;
  productTypes: ReadonlyArray<string>;
}): NotAddedCounts {
  const result: NotAddedCounts = { withoutAddress: 0, taken: 0, archived: 0 };

  for (const count of data.counts || []) {
    /*
     * A kind with nothing to add is not listed to be picked, so what keeps
     * its devices out is said whatever is picked: the security appliances
     * Meraki lists no address for are why most people look.
     */
    if (count.addable > 0 && !data.productTypes.includes(count.productType)) {
      continue;
    }

    result.withoutAddress += count.withoutAddress;
    result.taken += count.taken;
    result.archived += count.archived;
  }

  return result;
}
