import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { JSONObject } from "../../../Types/JSON";
import {
  ADDABLE_CONTROLLER_PRODUCT_TYPES,
  NetworkControllerUnaddedDeviceCount,
  isAddableControllerProductType,
} from "../../../Types/NetworkController/NetworkControllerDeviceAdd";
import {
  DISCOVERED_DETAILS_CONTROLLER_KEY,
  NetworkDeviceControllerReading,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import { NetworkTopologyDeviceRole } from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import ObjectID from "../../../Types/ObjectID";
import { normalizeMac } from "../../../Utils/Monitor/EndpointAttachmentUtil";
import { getRoleOfControllerProductType } from "../../../Utils/NetworkDevice/NetworkDeviceAssetFacts";
import {
  ControllerInventoryConnection,
  ControllerInventoryMatch,
  buildReadingOf,
} from "./NetworkControllerInventory";
import { NetworkControllerDevice } from "./NetworkControllerTypes";

/*
 * WHICH OF A CONTROLLER'S DEVICES ADD DEVICES ADDS, AND AS WHAT
 * (Types/NetworkController/NetworkControllerDeviceAdd says why and when).
 *
 * Every device of the organization's list gets one verdict, in this order:
 *
 *   1. not offered - a sensor, a Systems Manager endpoint, Secure Connect,
 *      or a kind Meraki did not name: no box on the network to add;
 *   2. already here - a network device here is it, by the rules Inventory
 *      matches it by (NetworkControllerInventory.matchControllerDevices);
 *   3. archived - a device someone archived is the same box (its serial
 *      number or MAC): archived is a decision, and it is not undone;
 *   4. without an address - Meraki lists no management address for it (an
 *      MX lists none: its addresses are its VLANs'), so there is nothing to
 *      reach it at, and a network device is the address it is polled at;
 *   5. taken - another device here holds its serial number, its MAC or its
 *      address, and is not it by the matching rules (a box whose serial says
 *      otherwise, a private address another branch uses too), or a device
 *      earlier in the list already took its address: OneUptime never makes
 *      two devices of one address, because traps, syslog and flows are
 *      matched to a device by the address they come from;
 *   6. addable.
 *
 * Every read counts the verdicts by kind (countUnaddedControllerDevices), so
 * the connection's row can say what Add devices would do before anyone
 * asks; an ask plans its adds from them (planControllerDeviceAdd).
 *
 * An added device is what Meraki says the box is: its name (made unique in
 * the project by its network, then its serial number), its management
 * address as the address it is polled at, its serial number and MAC, the
 * role its kind stands for, the site named after its Meraki network, and
 * Meraki's reading of it in its discovered details - so its model, firmware
 * and the rest show at once, and the next read finds it by its serial
 * number. Nothing else is written on it: what its own poll reads later wins
 * over Meraki, as it does for every device.
 *
 * Pure: every rule above is tested without a database.
 */

export enum ControllerDeviceAddVerdict {
  NotOffered = "notOffered",
  AlreadyHere = "alreadyHere",
  Archived = "archived",
  WithoutAddress = "withoutAddress",
  Taken = "taken",
  Addable = "addable",
}

/*
 * A device here that holds one of the controller's identities, as
 * NetworkDeviceService.findControllerIdentityHolders returns it. Every field
 * is read defensively.
 */
export interface ControllerIdentityHolder {
  serialNumber?: string | null | undefined;
  macAddress?: string | null | undefined;
  learnedMacAddress?: string | null | undefined;
  hostname?: string | null | undefined;
  isArchived?: boolean | null | undefined;
}

// What the holders lookup asks the database for.
export interface ControllerIdentityLookup {
  // As the serial numbers are compared: trimmed, in upper case.
  serials: Array<string>;
  macs: Array<string>;
  addresses: Array<string>;
}

// The longest name, and site name, a device and a site are given.
export const MAX_ADDED_DEVICE_NAME_LENGTH: number = ColumnLength.ShortText;
export const MAX_ADDED_SITE_NAME_LENGTH: number = ColumnLength.ShortText;
export const MAX_ADDED_SITE_ADDRESS_LENGTH: number = ColumnLength.ShortText;

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toSerialKey(value: unknown): string {
  return readText(value).toUpperCase();
}

function toNameKey(value: unknown): string {
  return readText(value).toLowerCase();
}

// Text cut to a length, without a space left at its end.
function cut(text: string, maxLength: number): string {
  return text.length > maxLength
    ? text.substring(0, maxLength).trimEnd()
    : text;
}

/*
 * The serial numbers, MACs and addresses of the devices that can be added at
 * all: what the holders lookup is asked about.
 */
export function getControllerIdentityLookup(
  devices: Array<NetworkControllerDevice>,
): ControllerIdentityLookup {
  const serials: Set<string> = new Set<string>();
  const macs: Set<string> = new Set<string>();
  const addresses: Set<string> = new Set<string>();

  for (const device of devices) {
    if (!isAddableControllerProductType(device.productType)) {
      continue;
    }

    const serial: string = toSerialKey(device.serial);

    if (serial) {
      serials.add(serial);
    }

    if (device.mac) {
      macs.add(device.mac);
    }

    if (device.lanIp) {
      addresses.add(device.lanIp);
    }
  }

  return {
    serials: Array.from(serials),
    macs: Array.from(macs),
    addresses: Array.from(addresses),
  };
}

// The identities the holders hold, live and archived apart.
interface HeldIdentities {
  serials: Set<string>;
  macs: Set<string>;
  addresses: Set<string>;
}

function emptyHeld(): HeldIdentities {
  return {
    serials: new Set<string>(),
    macs: new Set<string>(),
    addresses: new Set<string>(),
  };
}

function holdInto(
  held: HeldIdentities,
  holder: ControllerIdentityHolder,
): void {
  const serial: string = toSerialKey(holder.serialNumber);

  if (serial) {
    held.serials.add(serial);
  }

  for (const mac of [holder.macAddress, holder.learnedMacAddress]) {
    const normalized: string | undefined = normalizeMac(
      readText(mac) || undefined,
    );

    if (normalized) {
      held.macs.add(normalized);
    }
  }

  const address: string = readText(holder.hostname);

  if (address) {
    held.addresses.add(address);
  }
}

/**
 * Each controller device's verdict, by its serial number (as Meraki prints
 * it), in the order of the rules in the header. Pure.
 */
export function judgeControllerDevices(data: {
  devices: Array<NetworkControllerDevice>;
  // Inventory's matches: which controller device each device here is.
  matches: Map<string, ControllerInventoryMatch>;
  holders: Array<ControllerIdentityHolder>;
}): Map<string, ControllerDeviceAddVerdict> {
  const matched: Set<string> = new Set<string>();

  for (const match of data.matches.values()) {
    const serial: string = toSerialKey(match?.device?.serial);

    if (serial) {
      matched.add(serial);
    }
  }

  const live: HeldIdentities = emptyHeld();
  const archived: HeldIdentities = emptyHeld();

  for (const holder of data.holders) {
    if (!holder) {
      continue;
    }

    holdInto(holder.isArchived === true ? archived : live, holder);
  }

  // Addresses the devices judged addable so far take, in list order.
  const claimed: Set<string> = new Set<string>();
  const verdicts: Map<string, ControllerDeviceAddVerdict> = new Map();

  for (const device of data.devices) {
    const serial: string = toSerialKey(device.serial);

    if (!serial || verdicts.has(device.serial)) {
      continue;
    }

    const verdict: ControllerDeviceAddVerdict =
      ((): ControllerDeviceAddVerdict => {
        if (!isAddableControllerProductType(device.productType)) {
          return ControllerDeviceAddVerdict.NotOffered;
        }

        if (matched.has(serial)) {
          return ControllerDeviceAddVerdict.AlreadyHere;
        }

        if (
          archived.serials.has(serial) ||
          (device.mac && archived.macs.has(device.mac))
        ) {
          return ControllerDeviceAddVerdict.Archived;
        }

        if (!device.lanIp) {
          return ControllerDeviceAddVerdict.WithoutAddress;
        }

        if (
          live.serials.has(serial) ||
          (device.mac && live.macs.has(device.mac)) ||
          live.addresses.has(device.lanIp) ||
          archived.addresses.has(device.lanIp) ||
          claimed.has(device.lanIp)
        ) {
          return ControllerDeviceAddVerdict.Taken;
        }

        return ControllerDeviceAddVerdict.Addable;
      })();

    if (verdict === ControllerDeviceAddVerdict.Addable) {
      claimed.add(device.lanIp);
    }

    verdicts.set(device.serial, verdict);
  }

  return verdicts;
}

/**
 * The organization's devices that are no network device here, counted by
 * kind and by what Add devices can do about them: the counts a read keeps on
 * the connection. Kinds in the order they are listed, only those with a
 * device to count.
 */
export function countUnaddedControllerDevices(data: {
  devices: Array<NetworkControllerDevice>;
  verdicts: Map<string, ControllerDeviceAddVerdict>;
}): Array<NetworkControllerUnaddedDeviceCount> {
  const byType: Map<string, NetworkControllerUnaddedDeviceCount> = new Map();
  const seen: Set<string> = new Set<string>();

  for (const device of data.devices) {
    if (seen.has(device.serial)) {
      continue;
    }

    seen.add(device.serial);

    const verdict: ControllerDeviceAddVerdict | undefined = data.verdicts.get(
      device.serial,
    );

    if (
      !verdict ||
      verdict === ControllerDeviceAddVerdict.NotOffered ||
      verdict === ControllerDeviceAddVerdict.AlreadyHere
    ) {
      continue;
    }

    const count: NetworkControllerUnaddedDeviceCount = byType.get(
      device.productType,
    ) || {
      productType: device.productType,
      addable: 0,
      withoutAddress: 0,
      taken: 0,
      archived: 0,
    };

    switch (verdict) {
      case ControllerDeviceAddVerdict.Addable:
        count.addable++;
        break;
      case ControllerDeviceAddVerdict.WithoutAddress:
        count.withoutAddress++;
        break;
      case ControllerDeviceAddVerdict.Taken:
        count.taken++;
        break;
      case ControllerDeviceAddVerdict.Archived:
        count.archived++;
        break;
    }

    byType.set(device.productType, count);
  }

  return ADDABLE_CONTROLLER_PRODUCT_TYPES.filter(
    (productType: string): boolean => {
      return byType.has(productType);
    },
  ).map((productType: string): NetworkControllerUnaddedDeviceCount => {
    return byType.get(productType)!;
  });
}

export interface ControllerDeviceAddPlan {
  /*
   * The devices to add, at most the limit, by network, then name, then
   * serial number: the order a person reads the progress in, and the same
   * whatever order Meraki listed them in.
   */
  toAdd: Array<NetworkControllerDevice>;
  // Of the kinds asked for: the devices it does not try to add, by why.
  withoutAddressCount: number;
  takenCount: number;
  archivedCount: number;
  // Addable devices past the limit.
  remainingCount: number;
}

function compareText(a: string, b: string): number {
  const left: string = a.toLowerCase();
  const right: string = b.toLowerCase();

  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * What one ask adds: the addable devices of the kinds asked for, up to the
 * limit, and what it leaves and why. Pure.
 */
export function planControllerDeviceAdd(data: {
  devices: Array<NetworkControllerDevice>;
  verdicts: Map<string, ControllerDeviceAddVerdict>;
  productTypes: ReadonlyArray<string>;
  limit: number;
}): ControllerDeviceAddPlan {
  const addable: Array<NetworkControllerDevice> = [];
  const seen: Set<string> = new Set<string>();
  let withoutAddressCount: number = 0;
  let takenCount: number = 0;
  let archivedCount: number = 0;

  for (const device of data.devices) {
    if (
      seen.has(device.serial) ||
      !data.productTypes.includes(device.productType)
    ) {
      continue;
    }

    seen.add(device.serial);

    switch (data.verdicts.get(device.serial)) {
      case ControllerDeviceAddVerdict.Addable:
        addable.push(device);
        break;
      case ControllerDeviceAddVerdict.WithoutAddress:
        withoutAddressCount++;
        break;
      case ControllerDeviceAddVerdict.Taken:
        takenCount++;
        break;
      case ControllerDeviceAddVerdict.Archived:
        archivedCount++;
        break;
      default:
        break;
    }
  }

  addable.sort(
    (a: NetworkControllerDevice, b: NetworkControllerDevice): number => {
      return (
        compareText(a.networkName, b.networkName) ||
        compareText(
          getControllerDeviceBaseName(a),
          getControllerDeviceBaseName(b),
        ) ||
        compareText(a.serial, b.serial)
      );
    },
  );

  const limit: number = Math.max(0, Math.floor(data.limit));

  return {
    toAdd: addable.slice(0, limit),
    withoutAddressCount,
    takenCount,
    archivedCount,
    remainingCount: Math.max(0, addable.length - limit),
  };
}

/*
 * The name a device is added under before it is made unique: what Meraki
 * calls it, else its model and serial number (a device nobody named shows
 * as its MAC in the Meraki dashboard, and as nothing better here), else its
 * serial number.
 */
export function getControllerDeviceBaseName(
  device: NetworkControllerDevice,
): string {
  const name: string =
    readText(device.name) ||
    [readText(device.model), readText(device.serial)].filter(Boolean).join(" ");

  return cut(name || readText(device.serial), MAX_ADDED_DEVICE_NAME_LENGTH);
}

// A base name with a suffix, the base cut so the whole fits.
function withSuffix(base: string, suffix: string): string {
  const room: number = Math.max(
    1,
    MAX_ADDED_DEVICE_NAME_LENGTH - suffix.length - 1,
  );

  return `${cut(base, room)} ${suffix}`;
}

/*
 * The names a device may be added under, best first: what Meraki calls it,
 * then that with its Meraki network after it - "AP-1 (Store 0660)" - then
 * with its serial number, which no other device carries.
 */
export function getControllerDeviceNameChoices(
  device: NetworkControllerDevice,
): Array<string> {
  const base: string = getControllerDeviceBaseName(device);
  const network: string = readText(device.networkName);
  const serial: string = readText(device.serial);
  const choices: Array<string> = [base];

  for (const suffix of [network, serial]) {
    if (!suffix) {
      continue;
    }

    const choice: string = withSuffix(base, `(${suffix})`);

    if (
      !choices.some((existing: string): boolean => {
        return toNameKey(existing) === toNameKey(choice);
      })
    ) {
      choices.push(choice);
    }
  }

  return choices;
}

/**
 * The name each device is added under, by serial number: a device's name is
 * unique in its project (without case), and Meraki's names repeat from one
 * store to the next ("AP-1" in every one of them). So a device takes the
 * first of its name choices (getControllerDeviceNameChoices) that no other
 * device has, here or earlier in the list - its serial number's when every
 * one is taken. `takenNames` is read in lower case and is not changed. Pure.
 */
export function planControllerDeviceNames(data: {
  devices: Array<NetworkControllerDevice>;
  takenNames: ReadonlySet<string>;
}): Map<string, string> {
  const taken: Set<string> = new Set<string>(
    Array.from(data.takenNames).map((name: string): string => {
      return toNameKey(name);
    }),
  );
  const names: Map<string, string> = new Map();

  for (const device of data.devices) {
    if (names.has(device.serial)) {
      continue;
    }

    const candidates: Array<string> = getControllerDeviceNameChoices(device);

    const name: string =
      candidates.find((candidate: string): boolean => {
        return !taken.has(toNameKey(candidate));
      }) || candidates[candidates.length - 1]!;

    taken.add(toNameKey(name));
    names.set(device.serial, name);
  }

  return names;
}

// The site names an ask may look up or add, in lower case.
export function getControllerSiteNames(
  devices: Array<NetworkControllerDevice>,
): Array<string> {
  const names: Set<string> = new Set<string>();

  for (const device of devices) {
    const name: string = cut(
      readText(device.networkName),
      MAX_ADDED_SITE_NAME_LENGTH,
    );

    if (name) {
      names.add(name);
    }
  }

  return Array.from(names);
}

export interface ControllerSitePlan {
  // The site each device goes into, by the device's serial number, by name.
  siteNameBySerial: Map<string, string>;
  /*
   * The sites to add: a Meraki network the project has no site of the same
   * name for (without case), with the street address Meraki files its
   * devices under, when it files them under one.
   */
  sitesToCreate: Array<{ name: string; address: string }>;
}

/**
 * The site each device goes into: the one named after its Meraki network.
 * Two networks of one name share a site, as they would share it by name
 * anyway; a device of a network with no name gets none. `existingSiteNames`
 * is read in lower case. Pure.
 */
export function planControllerSites(data: {
  devices: Array<NetworkControllerDevice>;
  existingSiteNames: ReadonlySet<string>;
}): ControllerSitePlan {
  const existing: Set<string> = new Set<string>(
    Array.from(data.existingSiteNames).map((name: string): string => {
      return toNameKey(name);
    }),
  );
  const siteNameBySerial: Map<string, string> = new Map();
  // The name each site is added under, by its lower-case key.
  const toCreate: Map<string, { name: string; address: string }> = new Map();

  for (const device of data.devices) {
    const name: string = cut(
      readText(device.networkName),
      MAX_ADDED_SITE_NAME_LENGTH,
    );

    if (!name) {
      continue;
    }

    const key: string = toNameKey(name);
    siteNameBySerial.set(device.serial, toCreate.get(key)?.name || name);

    if (existing.has(key)) {
      continue;
    }

    const planned: { name: string; address: string } | undefined =
      toCreate.get(key);
    const address: string = cut(
      readText(device.address),
      MAX_ADDED_SITE_ADDRESS_LENGTH,
    );

    if (!planned) {
      toCreate.set(key, { name: name, address: address });
    } else if (!planned.address && address) {
      planned.address = address;
    }
  }

  return {
    siteNameBySerial,
    sitesToCreate: Array.from(toCreate.values()),
  };
}

// The role key a device of this kind is added with, when its kind names one.
export function getControllerDeviceRoleKey(
  device: NetworkControllerDevice,
): NetworkTopologyDeviceRole | undefined {
  return getRoleOfControllerProductType(device.productType);
}

/**
 * The network device one controller device is added as - see the header.
 * Built, not saved: the caller creates it as the person who asked.
 */
export function buildNetworkDeviceFromController(data: {
  projectId: ObjectID;
  device: NetworkControllerDevice;
  name: string;
  connection: ControllerInventoryConnection;
  readAt: Date;
  roleId?: ObjectID | undefined;
  siteId?: ObjectID | undefined;
  probeId?: ObjectID | undefined;
}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();

  device.projectId = data.projectId;
  device.name = data.name;
  device.hostname = data.device.lanIp;
  device.serialNumber = data.device.serial;

  if (data.device.mac) {
    device.macAddress = data.device.mac;
  }

  if (data.roleId) {
    device.networkDeviceRoleId = data.roleId;
  }

  if (data.siteId) {
    device.siteId = data.siteId;
  }

  if (data.probeId) {
    device.probeId = data.probeId;
  }

  const reading: NetworkDeviceControllerReading | undefined = buildReadingOf({
    connection: data.connection,
    device: data.device,
    readAt: data.readAt,
  });

  if (reading) {
    device.discoveredDetails = {
      [DISCOVERED_DETAILS_CONTROLLER_KEY]: reading as unknown as JSONObject,
    };
  }

  return device;
}
