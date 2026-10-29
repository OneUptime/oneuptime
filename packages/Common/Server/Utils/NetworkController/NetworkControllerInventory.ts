import IP from "../../../Types/IP/IP";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import {
  DISCOVERED_DETAILS_CONTROLLER_KEY,
  NetworkDeviceControllerReading,
  NetworkDeviceDiscoveredDetails,
  NetworkDeviceDiscoveredField,
  NetworkDeviceDiscoveryReaderType,
  buildControllerReading,
  getDiscoveredTime,
  readDiscoveryTime,
  readNetworkDeviceDiscoveredDetails,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import ObjectID from "../../../Types/ObjectID";
import { normalizeMac } from "../../../Utils/Monitor/EndpointAttachmentUtil";
import { normalizeSystemName } from "../../../Utils/NetworkDevice/DeviceNameRule";
import NetworkDeviceService, {
  DiscoveredDetailsMerge,
} from "../../Services/NetworkDeviceService";
import logger from "../Logger";
import { mirrorInventoryRow } from "../Telemetry/InventoryEntityRegistry";
import { NetworkControllerDevice } from "./NetworkControllerTypes";

/*
 * INTEGRATION DATA AS A SOURCE OF A DEVICE'S DETAILS (the follow-ups of
 * #5185 and #5225).
 *
 * A Meraki connection reads the organization's device list on every read,
 * and the controller knows each box better than the box's own SNMP agent
 * does: a Meraki switch or access point implements no ENTITY-MIB, so its
 * own poll reads no serial number, model or firmware, while the dashboard
 * lists all three, with its MAC, its management address, the name it is
 * filed under, its network and its street address. This records what the
 * controller says about every device of the project that IS one of its
 * devices - in the device's discovered details, under a key of its own
 * (`controller`), never in the device's own columns - and the device's asset
 * facts (NetworkDeviceAssetFacts) fill in what nothing else gave.
 *
 * WHICH DEVICE IS WHICH. A controller device is a device here when, in this
 * order:
 *
 *   1. the device's serial number is the controller device's (typed, or read
 *      off the device by its SNMP walk) - exact, as the traffic matcher
 *      matches appliances;
 *   2. else one of the device's MAC addresses is (typed, or learned from a
 *      router's ARP table), and its serial number, if it has one, does not
 *      say it is another box;
 *   3. else its polled address is the controller device's management
 *      address AND it is called what the controller calls it (its name, or
 *      the system name it reports), with the address held by no other
 *      device on either side. An address alone is never enough: a private
 *      address repeats from branch to branch, and from organization to
 *      organization of one project. So is a name, which is why the two are
 *      asked for together.
 *
 * A device whose serial number or MAC contradicts the controller device is
 * never matched by a weaker rule. Archived devices are left alone.
 *
 * WHEN IT IS WRITTEN. One batched merge per 500 devices
 * (NetworkDeviceService.mergeDiscoveredDetails), and only for a device whose
 * reading changed, whose reading is older than an hour (so "read 4 minutes
 * ago" stays true without a write on every read), or that someone asked to
 * refresh since its reading. A device this connection described before and
 * no longer matches loses the reading - only after a read of the WHOLE list,
 * since a list cut short says nothing about the devices past the cut.
 *
 * A device someone asked to read again (Refresh) has its Inventory item
 * copied as soon as its new reading is written, as its probe's first poll
 * after the ask copies it: a device only Meraki reads has no poll to do it,
 * and one its probe polls first would otherwise carry the reading from
 * before the ask until the mirror's next pass.
 *
 * The planning is pure, so every rule above is tested without a database;
 * `record` does the one read and the merges.
 */

// An unchanged reading is written again after this long, to keep its time true.
export const UNCHANGED_READING_REFRESH_MS: number = 60 * 60 * 1000;

// The most devices one read looks at: the device list's own ceiling.
export const MAX_INVENTORY_CANDIDATES: number = 50000;

/*
 * A device of the project the controller's list may describe: the columns
 * the rules above read, as NetworkDeviceService.findControllerMatchCandidates
 * returns them. Every field is read defensively.
 */
export interface ControllerInventoryCandidate {
  id: string;
  name?: string | null | undefined;
  hostname?: string | null | undefined;
  serialNumber?: string | null | undefined;
  macAddress?: string | null | undefined;
  sysName?: string | null | undefined;
  isArchived?: boolean | null | undefined;
  discoveredDetails?: unknown;
  refreshRequestedAt?: Date | string | null | undefined;
}

export interface ControllerInventoryConnection {
  id: string;
  // Its name when it read the list, so a value says where it came from.
  name: string;
  provider: NetworkControllerProvider;
}

export enum ControllerMatchRule {
  SerialNumber = "serialNumber",
  MacAddress = "macAddress",
  AddressAndName = "addressAndName",
}

export interface ControllerInventoryMatch {
  device: NetworkControllerDevice;
  rule: ControllerMatchRule;
}

export interface ControllerInventoryPlan {
  // The merges to send, one per device whose details change.
  patches: Array<DiscoveredDetailsMerge>;
  // Every device matched, by device id, with the rule it matched by.
  matches: Map<string, ControllerInventoryMatch>;
  // Controller devices that are at least one device here.
  describedDeviceCount: number;
  /*
   * The devices whose new reading answers a refresh someone asked for since
   * their last one: their Inventory items are copied once it is written.
   */
  refreshedDeviceIds: Array<string>;
}

// What the read's lookup asks the database for.
export interface ControllerInventoryLookup {
  serials: Array<string>;
  macs: Array<string>;
  addresses: Array<string>;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toSerialKey(value: unknown): string {
  return readText(value).toUpperCase();
}

function toNameKey(value: unknown): string {
  return readText(value).toLowerCase();
}

/*
 * What the database is asked for: the controller devices' serial numbers
 * (as Meraki prints them), MACs and management addresses.
 */
export function getControllerInventoryLookup(
  devices: Array<NetworkControllerDevice>,
): ControllerInventoryLookup {
  const serials: Set<string> = new Set<string>();
  const macs: Set<string> = new Set<string>();
  const addresses: Set<string> = new Set<string>();

  for (const device of devices) {
    if (device.serial) {
      serials.add(toSerialKey(device.serial));
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

// What a device says it is, without anything a controller said about it.
interface CandidateIdentity {
  serial: string;
  macs: Array<string>;
  names: Set<string>;
  address: string;
  details: NetworkDeviceDiscoveredDetails;
}

function identityOf(
  candidate: ControllerInventoryCandidate,
): CandidateIdentity {
  const details: NetworkDeviceDiscoveredDetails =
    readNetworkDeviceDiscoveredDetails(candidate.discoveredDetails);
  const macs: Array<string> = [];

  for (const value of [
    normalizeMac(readText(candidate.macAddress) || undefined),
    details.values[NetworkDeviceDiscoveredField.MacAddress]?.value,
  ]) {
    if (value && !macs.includes(value)) {
      macs.push(value);
    }
  }

  const names: Set<string> = new Set<string>();

  for (const value of [
    readText(candidate.name),
    normalizeSystemName(candidate.sysName) || "",
    details.values[NetworkDeviceDiscoveredField.SystemName]?.value || "",
  ]) {
    const key: string = toNameKey(value);

    if (key) {
      names.add(key);
    }
  }

  const address: string = readText(candidate.hostname);

  return {
    serial: toSerialKey(candidate.serialNumber),
    macs: macs,
    names: names,
    address: IP.isIP(address) ? address : "",
    details: details,
  };
}

// Counts of a key: whether it is held once.
function countBy<T>(
  items: Array<T>,
  keyOf: (item: T) => string,
): Map<string, number> {
  const counts: Map<string, number> = new Map<string, number>();

  for (const item of items) {
    const key: string = keyOf(item);

    if (key) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return counts;
}

/*
 * True when what the device says contradicts the controller device: a serial
 * number, or a MAC, that is another box's.
 */
function isContradicted(
  identity: CandidateIdentity,
  device: NetworkControllerDevice,
): boolean {
  if (
    identity.serial &&
    device.serial &&
    identity.serial !== toSerialKey(device.serial)
  ) {
    return true;
  }

  return Boolean(
    device.mac &&
      identity.macs.length > 0 &&
      !identity.macs.includes(device.mac),
  );
}

/**
 * Which controller device each candidate is, by the rules in the header.
 * Pure. A candidate that matches none, or is archived, is left out.
 */
export function matchControllerDevices(data: {
  devices: Array<NetworkControllerDevice>;
  candidates: Array<ControllerInventoryCandidate>;
}): Map<string, ControllerInventoryMatch> {
  const bySerial: Map<string, NetworkControllerDevice> = new Map();
  const byMac: Map<string, NetworkControllerDevice> = new Map();
  const byAddress: Map<string, NetworkControllerDevice> = new Map();

  for (const device of data.devices) {
    const serial: string = toSerialKey(device.serial);

    if (serial && !bySerial.has(serial)) {
      bySerial.set(serial, device);
    }

    if (device.mac && !byMac.has(device.mac)) {
      byMac.set(device.mac, device);
    }

    if (device.lanIp && !byAddress.has(device.lanIp)) {
      byAddress.set(device.lanIp, device);
    }
  }

  // An address held by two controller devices, or two devices here, matches nothing.
  const controllerAddressCounts: Map<string, number> = countBy(
    data.devices,
    (device: NetworkControllerDevice): string => {
      return device.lanIp;
    },
  );

  const live: Array<{
    candidate: ControllerInventoryCandidate;
    identity: CandidateIdentity;
  }> = [];
  const seen: Set<string> = new Set<string>();

  for (const candidate of data.candidates) {
    const id: string = readText(candidate?.id);

    if (!id || seen.has(id) || candidate.isArchived === true) {
      continue;
    }

    seen.add(id);
    live.push({ candidate, identity: identityOf(candidate) });
  }

  const deviceAddressCounts: Map<string, number> = countBy(
    live,
    (entry: { identity: CandidateIdentity }): string => {
      return entry.identity.address;
    },
  );

  const matches: Map<string, ControllerInventoryMatch> = new Map();

  for (const { candidate, identity } of live) {
    const id: string = readText(candidate.id);

    // 1. Its serial number.
    const bySerialNumber: NetworkControllerDevice | undefined = identity.serial
      ? bySerial.get(identity.serial)
      : undefined;

    if (bySerialNumber) {
      matches.set(id, {
        device: bySerialNumber,
        rule: ControllerMatchRule.SerialNumber,
      });
      continue;
    }

    // 2. One of its MAC addresses, unless its serial number says otherwise.
    const byMacAddress: NetworkControllerDevice | undefined = identity.macs
      .map((mac: string): NetworkControllerDevice | undefined => {
        return byMac.get(mac);
      })
      .find((device: NetworkControllerDevice | undefined): boolean => {
        return Boolean(device);
      });

    if (byMacAddress) {
      if (!isContradicted(identity, byMacAddress)) {
        matches.set(id, {
          device: byMacAddress,
          rule: ControllerMatchRule.MacAddress,
        });
      }

      continue;
    }

    // 3. Its address and its name, the address held once on both sides.
    if (!identity.address) {
      continue;
    }

    const byManagementAddress: NetworkControllerDevice | undefined =
      byAddress.get(identity.address);

    if (
      !byManagementAddress ||
      controllerAddressCounts.get(identity.address) !== 1 ||
      deviceAddressCounts.get(identity.address) !== 1 ||
      !byManagementAddress.name ||
      !identity.names.has(toNameKey(byManagementAddress.name)) ||
      isContradicted(identity, byManagementAddress)
    ) {
      continue;
    }

    matches.set(id, {
      device: byManagementAddress,
      rule: ControllerMatchRule.AddressAndName,
    });
  }

  return matches;
}

/*
 * The reading a connection records for one of its devices, or undefined
 * when nothing in it is usable.
 */
export function buildReadingOf(data: {
  connection: ControllerInventoryConnection;
  device: NetworkControllerDevice;
  readAt: Date;
}): NetworkDeviceControllerReading | undefined {
  return buildControllerReading({
    provider: data.connection.provider,
    readBy: {
      type: NetworkDeviceDiscoveryReaderType.NetworkController,
      id: data.connection.id,
      name: data.connection.name,
    },
    readAt: data.readAt.toISOString(),
    values: {
      name: data.device.name,
      model: data.device.model,
      serialNumber: data.device.serial,
      macAddress: data.device.mac,
      ipAddress: data.device.lanIp,
      firmwareVersion: data.device.firmware,
      productType: data.device.productType,
      networkName: data.device.networkName,
      address: data.device.address,
    },
  });
}

function isSameReading(
  stored: NetworkDeviceControllerReading,
  next: NetworkDeviceControllerReading,
): boolean {
  return (
    stored.provider === next.provider &&
    stored.readBy.id === next.readBy.id &&
    (stored.readBy.name || "") === (next.readBy.name || "") &&
    JSON.stringify(stored.values) === JSON.stringify(next.values)
  );
}

/*
 * Whether someone asked for the device to be read again (Refresh) since its
 * stored reading - or at all, when it has none.
 */
function isRefreshAskedSince(data: {
  stored: NetworkDeviceControllerReading | undefined;
  refreshRequestedAt: unknown;
}): boolean {
  const requested: string | undefined = readDiscoveryTime(
    data.refreshRequestedAt,
  );

  if (!requested) {
    return false;
  }

  const storedAt: number | undefined = data.stored
    ? getDiscoveredTime(data.stored)
    : undefined;

  return storedAt === undefined || new Date(requested).getTime() > storedAt;
}

/*
 * Whether a stored reading still stands without a write: the same reading,
 * read by the same connection less than an hour ago, and nobody has asked
 * for the device to be read again since.
 */
function isStillCurrent(data: {
  stored: NetworkDeviceControllerReading | undefined;
  next: NetworkDeviceControllerReading;
  readAt: Date;
  refreshRequestedAt: unknown;
}): boolean {
  if (!data.stored || !isSameReading(data.stored, data.next)) {
    return false;
  }

  const storedAt: number | undefined = getDiscoveredTime(data.stored);

  if (
    storedAt === undefined ||
    data.readAt.getTime() - storedAt >= UNCHANGED_READING_REFRESH_MS ||
    storedAt > data.readAt.getTime()
  ) {
    return false;
  }

  const requested: string | undefined = readDiscoveryTime(
    data.refreshRequestedAt,
  );

  return !requested || new Date(requested).getTime() <= storedAt;
}

/**
 * What one read records: a reading for every matched device whose reading
 * is not still current, and - after a read of the whole list - no reading
 * from this connection on a device it no longer describes. Pure.
 */
export function planControllerInventory(data: {
  connection: ControllerInventoryConnection;
  readAt: Date;
  devices: Array<NetworkControllerDevice>;
  isDeviceListComplete: boolean;
  candidates: Array<ControllerInventoryCandidate>;
}): ControllerInventoryPlan {
  const matches: Map<string, ControllerInventoryMatch> = matchControllerDevices(
    {
      devices: data.devices,
      candidates: data.candidates,
    },
  );
  const patches: Array<DiscoveredDetailsMerge> = [];
  const refreshed: Array<string> = [];
  const described: Set<string> = new Set<string>();
  const seen: Set<string> = new Set<string>();

  for (const candidate of data.candidates) {
    const id: string = readText(candidate?.id);

    if (
      !id ||
      seen.has(id) ||
      !ObjectID.isValidUUID(id) ||
      candidate.isArchived === true
    ) {
      continue;
    }

    seen.add(id);

    const stored: NetworkDeviceControllerReading | undefined =
      readNetworkDeviceDiscoveredDetails(
        candidate.discoveredDetails,
      ).controller;
    const match: ControllerInventoryMatch | undefined = matches.get(id);

    if (!match) {
      if (
        data.isDeviceListComplete &&
        stored &&
        stored.readBy.id === data.connection.id
      ) {
        patches.push({
          deviceId: id,
          unset: [DISCOVERED_DETAILS_CONTROLLER_KEY],
        });
      }

      continue;
    }

    described.add(toSerialKey(match.device.serial));

    const next: NetworkDeviceControllerReading | undefined = buildReadingOf({
      connection: data.connection,
      device: match.device,
      readAt: data.readAt,
    });

    if (
      !next ||
      isStillCurrent({
        stored,
        next,
        readAt: data.readAt,
        refreshRequestedAt: candidate.refreshRequestedAt,
      })
    ) {
      continue;
    }

    patches.push({
      deviceId: id,
      set: { [DISCOVERED_DETAILS_CONTROLLER_KEY]: next },
    });

    if (
      isRefreshAskedSince({
        stored,
        refreshRequestedAt: candidate.refreshRequestedAt,
      })
    ) {
      refreshed.push(id);
    }
  }

  return {
    patches,
    matches,
    describedDeviceCount: described.size,
    refreshedDeviceIds: refreshed,
  };
}

export type FindControllerCandidatesFunction = (data: {
  projectId: ObjectID;
  connectionId: ObjectID;
  lookup: ControllerInventoryLookup;
  limit: number;
}) => Promise<Array<ControllerInventoryCandidate>>;

export type MergeControllerReadingsFunction = (data: {
  projectId: ObjectID;
  patches: Array<DiscoveredDetailsMerge>;
}) => Promise<number>;

// Copies one network device's Inventory item now (mirrorInventoryRow).
export type MirrorRefreshedDeviceFunction = (
  deviceId: ObjectID,
) => Promise<void>;

export interface ControllerInventoryOutcome {
  // Controller devices listed, and how many of them are devices here.
  deviceCount: number;
  describedDeviceCount: number;
  // Devices whose details this read wrote (set or cleared).
  writtenDeviceCount: number;
}

export default class NetworkControllerInventory {
  /**
   * Records what one read's device list says about the project's devices -
   * see the header. Throws only what the database throws; the read runner
   * keeps a failure here from failing the traffic read.
   */
  public static async record(data: {
    projectId: ObjectID;
    connection: ControllerInventoryConnection;
    readAt: Date;
    devices: Array<NetworkControllerDevice>;
    isDeviceListComplete: boolean;
    findCandidates?: FindControllerCandidatesFunction | undefined;
    merge?: MergeControllerReadingsFunction | undefined;
    mirror?: MirrorRefreshedDeviceFunction | undefined;
  }): Promise<ControllerInventoryOutcome> {
    const lookup: ControllerInventoryLookup = getControllerInventoryLookup(
      data.devices,
    );

    const candidates: Array<ControllerInventoryCandidate> = await (
      data.findCandidates ||
      ((query: {
        projectId: ObjectID;
        connectionId: ObjectID;
        lookup: ControllerInventoryLookup;
        limit: number;
      }): Promise<Array<ControllerInventoryCandidate>> => {
        return NetworkDeviceService.findControllerMatchCandidates(query);
      })
    )({
      projectId: data.projectId,
      connectionId: new ObjectID(data.connection.id),
      lookup,
      limit: MAX_INVENTORY_CANDIDATES,
    });

    const plan: ControllerInventoryPlan = planControllerInventory({
      connection: data.connection,
      readAt: data.readAt,
      devices: data.devices,
      isDeviceListComplete: data.isDeviceListComplete,
      candidates,
    });

    const written: number =
      plan.patches.length > 0
        ? await (
            data.merge ||
            ((merge: {
              projectId: ObjectID;
              patches: Array<DiscoveredDetailsMerge>;
            }): Promise<number> => {
              return NetworkDeviceService.mergeDiscoveredDetails(merge);
            })
          )({ projectId: data.projectId, patches: plan.patches })
        : 0;

    /*
     * The devices someone asked to read again: their items are copied now
     * that the reading is written. Never fatal - the mirror's next pass
     * copies them regardless.
     */
    for (const deviceId of plan.refreshedDeviceIds) {
      try {
        await (
          data.mirror ||
          (async (id: ObjectID): Promise<void> => {
            await mirrorInventoryRow({
              resourceType: "NetworkDevice",
              resourceId: id,
            });
          })
        )(new ObjectID(deviceId));
      } catch (error) {
        logger.error(
          `Network device ${deviceId}: its Inventory item could not be copied after a refresh: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return {
      deviceCount: data.devices.length,
      describedDeviceCount: plan.describedDeviceCount,
      writtenDeviceCount: written,
    };
  }
}
