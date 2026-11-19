import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import ManagedDevice from "../../../Models/DatabaseModels/ManagedDevice";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ColumnLength from "../../../Types/Database/ColumnLength";
import QueryDeepPartialEntity from "../../../Types/Database/PartialEntity";
import Dictionary from "../../../Types/Dictionary";
import {
  ANDROID_SECURITY_PATCH_LEVEL_ATTRIBUTE,
  MANAGED_DEVICE_HOST_NAME_ATTRIBUTE,
  MANAGED_DEVICE_RESOURCE_TYPE,
  ManagedDeviceHostMatch,
  ManagedDeviceServiceAttributeKeys,
  canonicalizeManagedDeviceIdentity,
  getAllManagedDeviceServiceAttributeKeys,
  getManagedDeviceHostName,
  getManagedDeviceServiceAttributeKeys,
  getUsableSerialNumber,
  isManagedDeviceHostMatch,
} from "../../../Types/DeviceManagement/ManagedDeviceIdentity";
import {
  ManagedDevicePlatform,
  getManagedDeviceOperatingSystemName,
  readManagedDevicePlatform,
} from "../../../Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import {
  INVENTORY_ASSET_ATTRIBUTE_KEYS,
  InventoryAssetField,
} from "../../../Utils/Inventory/InventoryAssetDetails";
import { toOtelMacAddress } from "../../../Utils/NetworkDevice/NetworkDeviceAssetFacts";
import { keyForHost } from "../../../Utils/Telemetry/EntityKey";
import {
  MAX_INVENTORY_HOST_IP_ADDRESSES_LENGTH,
  MAX_INVENTORY_HOST_IP_ADDRESS_COUNT,
  normalizeHostIpAddresses,
} from "../../../Utils/Telemetry/HostIpAddresses";
import InventoryItemService, {
  SerialNumberHost,
} from "../../Services/InventoryItemService";
import ManagedDeviceService from "../../Services/ManagedDeviceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import { hasCustomFieldValues } from "../Telemetry/InventoryEntityRegistry";
import { truncateDescriptiveAttributeValue } from "../Telemetry/TelemetryEntity";

/*
 * EACH MANAGED DEVICE IS ONE HOST IN INVENTORY.
 *
 * After every read of a connection, each of its devices is given its host:
 * found by the identity contract (ManagedDeviceIdentity) among the hosts
 * telemetry reports - by its Esper name, else its serial number - or made
 * for it. A device the Android agent reports under its Esper name (the
 * agent's documented `device_name: ${esper.deviceName}`) is that very host,
 * the one its Host in Hosts is keyed by too. The host then carries what the
 * service knows:
 *
 *   - its asset details, under the keys every machine in Inventory uses
 *     (InventoryAssetDetails): serial number, make, model, build, its
 *     operating system (its platform's: Android, iOS, iPadOS, Windows...)
 *     and its version, IP and MAC addresses, and "kiosk" as its type when
 *     the device runs in kiosk mode; and the service's own facts beside
 *     them, namespaced by the service (esper.device.id, esper.group), and
 *     an Android device's patch level;
 *   - its last check-in as its last-seen time, so a device that stops
 *     checking in goes quiet in Inventory as any host does;
 *   - a pointer back to the device (resourceType "ManagedDevice"), which
 *     is what its Inventory page reads the device's card and apps from;
 *   - source "inventory": the device row owns the host while the service
 *     lists the device, so no telemetry silence ever prunes it.
 *
 * NEVER FIGHTING TELEMETRY OR A PERSON
 *
 * A value is written only where the host has none, or still has the one
 * the import wrote last time (ManagedDevice.inventoryAttributes): an app
 * that names its device type, or a person who renamed the host, is left
 * alone. The display name is the device's alias, else its Esper name, under
 * the same rule.
 *
 * GONE, AND BACK
 *
 * A device that leaves the service's list has its host archived - out of
 * the live list, still found under Archived, with what it was - and
 * restored if the device comes back. When the device row goes for good (30
 * days after it left, or with its connection), its host is let go: a host
 * the import made and nothing else wrote to is deleted; any other goes back
 * to being a host telemetry reports, which ages out as those do.
 */

// A device's check-in moves its host's last-seen time once it is this much newer.
export const LAST_SEEN_BUMP_MS: number = 5 * 60 * 1000;

// The device type a device in kiosk mode is given, as kiosk apps name it.
export const KIOSK_DEVICE_TYPE: string = "kiosk";

/*
 * The keys only the import writes - every service's - let go with the
 * host, since nothing else keeps them current. Not the patch level, which
 * the Android agent sends under the same key.
 */
export const IMPORT_ONLY_ATTRIBUTE_KEYS: ReadonlyArray<string> =
  getAllManagedDeviceServiceAttributeKeys();

// What the import wrote to a device's host last time (ManagedDevice.inventoryAttributes).
export interface WrittenHostState {
  attributes: Dictionary<string>;
  displayName: string;
}

export function readWrittenHostState(value: unknown): WrittenHostState {
  const state: JSONObject =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : {};
  const attributes: Dictionary<string> = {};
  const raw: unknown = state["attributes"];

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, attributeValue] of Object.entries(
      raw as Record<string, unknown>,
    )) {
      if (typeof attributeValue === "string") {
        attributes[key] = attributeValue;
      }
    }
  }

  return {
    attributes,
    displayName:
      typeof state["displayName"] === "string"
        ? (state["displayName"] as string)
        : "",
  };
}

// The facts of a device its host is described by.
export interface ManagedDeviceHostFacts {
  providerDeviceId: string;
  // The device's service: what its own facts are namespaced by. Esper when absent.
  provider?: string | undefined;
  // What it runs: its operating system. Android when absent.
  platform?: string | undefined;
  // The service's own word for its operating system, for a platform OneUptime does not name.
  serviceOperatingSystem?: string | undefined;
  deviceName?: string | undefined;
  alias?: string | undefined;
  serialNumber?: string | undefined;
  manufacturer?: string | undefined;
  model?: string | undefined;
  osVersion?: string | undefined;
  buildNumber?: string | undefined;
  securityPatchLevel?: string | undefined;
  groupName?: string | undefined;
  groupPath?: string | undefined;
  ipAddresses?: string | undefined;
  macAddress?: string | undefined;
  isKioskMode?: boolean | undefined;
}

/*
 * The attributes a device's host is described by, under the keys every
 * machine in Inventory uses. Empty values are left out. Pure.
 */
export function getManagedDeviceHostAttributes(
  device: ManagedDeviceHostFacts,
): Dictionary<string> {
  const attributes: Dictionary<string> = {};
  const put: (key: string, value: string | undefined | null) => void = (
    key: string,
    value: string | undefined | null,
  ): void => {
    const text: string = (value || "").trim();

    if (text) {
      attributes[key] = truncateDescriptiveAttributeValue(text);
    }
  };
  const asset: (field: InventoryAssetField) => string = (
    field: InventoryAssetField,
  ): string => {
    return INVENTORY_ASSET_ATTRIBUTE_KEYS[field];
  };

  if (getUsableSerialNumber(device.serialNumber)) {
    put(asset(InventoryAssetField.SerialNumber), device.serialNumber);
  }

  put(asset(InventoryAssetField.Manufacturer), device.manufacturer);
  put(asset(InventoryAssetField.Model), device.model);
  // A phone's or a tablet's firmware is the build it runs.
  put(asset(InventoryAssetField.FirmwareVersion), device.buildNumber);
  put(
    asset(InventoryAssetField.OperatingSystem),
    getManagedDeviceOperatingSystemName({
      platform: device.platform,
      serviceOperatingSystem: device.serviceOperatingSystem,
    }),
  );
  put(asset(InventoryAssetField.OsVersion), device.osVersion);
  put(
    asset(InventoryAssetField.IpAddress),
    normalizeHostIpAddresses(
      (device.ipAddresses || "").split(",").map((address: string): string => {
        return address.trim();
      }),
      {
        maxCount: MAX_INVENTORY_HOST_IP_ADDRESS_COUNT,
        maxLength: MAX_INVENTORY_HOST_IP_ADDRESSES_LENGTH,
      },
    ),
  );
  put(
    asset(InventoryAssetField.MacAddress),
    toOtelMacAddress(device.macAddress),
  );

  if (device.isKioskMode === true) {
    put(asset(InventoryAssetField.DeviceType), KIOSK_DEVICE_TYPE);
  }

  const keys: ManagedDeviceServiceAttributeKeys =
    getManagedDeviceServiceAttributeKeys(device.provider);

  put(keys.deviceId, device.providerDeviceId);
  put(keys.deviceName, device.deviceName);
  put(keys.group, device.groupPath || device.groupName);

  // Android's security patch level: no other platform has one.
  if (
    readManagedDevicePlatform(device.platform) === ManagedDevicePlatform.Android
  ) {
    put(ANDROID_SECURITY_PATCH_LEVEL_ATTRIBUTE, device.securityPatchLevel);
  }

  return attributes;
}

// The display name a device's host is given: its alias, else its Esper name.
export function getManagedDeviceHostDisplayName(device: {
  alias?: string | undefined;
  deviceName?: string | undefined;
  serialNumber?: string | undefined;
  providerDeviceId?: string | undefined;
}): string {
  const alias: string = (device.alias || "").trim();

  return (alias || getManagedDeviceHostName(device)).substring(
    0,
    ColumnLength.ShortText,
  );
}

/*
 * The attributes a host should hold, merged over what it holds without
 * fighting anyone: a key is written where the host has no value, or still
 * has the value the import wrote last time; a key the import wrote last
 * time and no longer has a value for is removed, unless someone changed it
 * since. Returns the new bag, or null when nothing changes. Pure.
 */
export function mergeManagedDeviceHostAttributes(data: {
  current: Record<string, unknown>;
  desired: Dictionary<string>;
  written: Dictionary<string>;
}): { attributes: JSONObject; written: Dictionary<string> } | null {
  const next: JSONObject = { ...(data.current as JSONObject) };
  const written: Dictionary<string> = {};
  let changed: boolean = false;

  for (const [key, value] of Object.entries(data.desired)) {
    const current: unknown = data.current[key];
    const isOurs: boolean =
      current === undefined ||
      current === null ||
      current === "" ||
      current === data.written[key];

    if (!isOurs) {
      // Someone else's value: kept, and no longer ours.
      continue;
    }

    written[key] = value;

    if (current !== value) {
      next[key] = value;
      changed = true;
    }
  }

  for (const [key, value] of Object.entries(data.written)) {
    if (data.desired[key] !== undefined) {
      continue;
    }

    // A value the import wrote and no longer knows: taken back, if still its.
    if (data.current[key] === value) {
      delete next[key];
      changed = true;
    }
  }

  return changed ? { attributes: next, written } : null;
}

// A host a device could be: what the matching reads of an InventoryItem.
export interface ManagedDeviceHostCandidate {
  id: string;
  entityKey: string;
  source: string;
  resourceType: string;
  resourceId: string;
  displayName: string;
  descriptiveAttributes: Record<string, unknown>;
  hasCustomFields: boolean;
  isArchived: boolean;
  lastSeenAt: Date | null;
}

// A device, as the matching reads it.
export interface ManagedDeviceHostSubject {
  id: string;
  inventoryItemId: string;
  inventoryMatch: ManagedDeviceHostMatch | undefined;
  written: WrittenHostState;
}

export interface ManagedDeviceHostChoice {
  match: ManagedDeviceHostMatch;
  // The host the device is, or "" to make one.
  itemId: string;
  // The host the device held before and lets go of now, if any.
  release?: { item: ManagedDeviceHostCandidate; deleteIt: boolean } | undefined;
}

/*
 * Whether a host holds nothing but what the import wrote for this device:
 * made by the import, pointing at the device, with no attribute anyone
 * else wrote and no custom field. Only such a host gives way to a host
 * telemetry reports, or is deleted when it is let go. Pure.
 */
export function isImportOnlyHost(
  item: ManagedDeviceHostCandidate,
  device: ManagedDeviceHostSubject,
): boolean {
  if (
    device.inventoryMatch !== ManagedDeviceHostMatch.Created ||
    item.id !== device.inventoryItemId ||
    item.resourceType !== MANAGED_DEVICE_RESOURCE_TYPE ||
    item.resourceId !== device.id ||
    item.hasCustomFields
  ) {
    return false;
  }

  return Object.entries(item.descriptiveAttributes).every(
    ([key, value]: [string, unknown]): boolean => {
      return device.written.attributes[key] === value;
    },
  );
}

/*
 * Which host a device is, by the identity contract (ManagedDeviceIdentity),
 * and which host it lets go of. Pure: every candidate is read before.
 *
 *   byName      the host whose key is the device's host.name
 *   bySerial    hosts whose host.serial_number, or host.name, is the
 *               device's serial number
 *   current     the host the device held after the last read, if it is there
 *   heldByOthers  hosts other devices hold: never taken
 */
export function chooseManagedDeviceHost(data: {
  device: ManagedDeviceHostSubject;
  current: ManagedDeviceHostCandidate | undefined;
  byName: ManagedDeviceHostCandidate | undefined;
  bySerial: Array<ManagedDeviceHostCandidate>;
  heldByOthers: ReadonlySet<string>;
}): ManagedDeviceHostChoice {
  const nameHost: ManagedDeviceHostCandidate | undefined =
    data.byName && !data.heldByOthers.has(data.byName.id)
      ? data.byName
      : undefined;
  const isOwnMadeHost: boolean = Boolean(
    nameHost && isImportOnlyHost(nameHost, data.device),
  );

  const pickOne: (
    candidates: Array<ManagedDeviceHostCandidate>,
  ) => ManagedDeviceHostCandidate | undefined = (
    candidates: Array<ManagedDeviceHostCandidate>,
  ): ManagedDeviceHostCandidate | undefined => {
    const free: Array<ManagedDeviceHostCandidate> = [];
    const seen: Set<string> = new Set<string>();

    for (const candidate of candidates) {
      if (
        seen.has(candidate.id) ||
        data.heldByOthers.has(candidate.id) ||
        candidate.id === nameHost?.id
      ) {
        continue;
      }

      seen.add(candidate.id);
      free.push(candidate);
    }

    // Two hosts claiming one device's serial number say nothing certain.
    return free.length === 1 ? free[0] : undefined;
  };

  let choice: ManagedDeviceHostChoice;

  if (nameHost && !isOwnMadeHost) {
    choice = { match: ManagedDeviceHostMatch.Name, itemId: nameHost.id };
  } else {
    const bySerial: ManagedDeviceHostCandidate | undefined = pickOne(
      data.bySerial,
    );

    if (bySerial) {
      choice = {
        match: ManagedDeviceHostMatch.SerialNumber,
        itemId: bySerial.id,
      };
    } else {
      choice = {
        match: ManagedDeviceHostMatch.Created,
        itemId: nameHost ? nameHost.id : "",
      };
    }
  }

  if (data.current && data.current.id !== choice.itemId) {
    choice.release = {
      item: data.current,
      deleteIt: isImportOnlyHost(data.current, data.device),
    };
  }

  return choice;
}

export interface ManagedDeviceInventoryOutcome {
  // Devices whose host was found among the hosts telemetry reports.
  matchedHostCount: number;
  // Hosts made, and hosts let go of, this time.
  createdHostCount: number;
  releasedHostCount: number;
}

// What the inventory pass reads of a device.
const DEVICE_SELECT: {
  _id: true;
  projectId: true;
  connectionId: true;
  providerDeviceId: true;
  platform: true;
  details: true;
  deviceName: true;
  alias: true;
  serialNumber: true;
  manufacturer: true;
  model: true;
  osVersion: true;
  buildNumber: true;
  securityPatchLevel: true;
  groupName: true;
  groupPath: true;
  ipAddresses: true;
  macAddress: true;
  isKioskMode: true;
  lastCheckInAt: true;
  provisionedAt: true;
  removedAt: true;
  inventoryItemId: true;
  inventoryMatch: true;
  inventoryAttributes: true;
  isInventoryItemArchivedOnRemoval: true;
} = {
  _id: true,
  projectId: true,
  connectionId: true,
  providerDeviceId: true,
  platform: true,
  details: true,
  deviceName: true,
  alias: true,
  serialNumber: true,
  manufacturer: true,
  model: true,
  osVersion: true,
  buildNumber: true,
  securityPatchLevel: true,
  groupName: true,
  groupPath: true,
  ipAddresses: true,
  macAddress: true,
  isKioskMode: true,
  lastCheckInAt: true,
  provisionedAt: true,
  removedAt: true,
  inventoryItemId: true,
  inventoryMatch: true,
  inventoryAttributes: true,
  isInventoryItemArchivedOnRemoval: true,
};

// What the pass reads of a host.
const HOST_SELECT: {
  _id: true;
  entityKey: true;
  source: true;
  resourceType: true;
  resourceId: true;
  displayName: true;
  descriptiveAttributes: true;
  customFields: true;
  isArchived: true;
  lastSeenAt: true;
} = {
  _id: true,
  entityKey: true,
  source: true,
  resourceType: true,
  resourceId: true,
  displayName: true,
  descriptiveAttributes: true,
  customFields: true,
  isArchived: true,
  lastSeenAt: true,
};

// Devices read, and written, per page of the pass.
const PAGE_SIZE: number = 500;

function toCandidate(item: InventoryItem): ManagedDeviceHostCandidate {
  return {
    id: item._id ? item._id.toString() : "",
    entityKey: item.entityKey || "",
    source: item.source || "",
    resourceType: item.resourceType || "",
    resourceId: item.resourceId ? item.resourceId.toString() : "",
    displayName: item.displayName || "",
    descriptiveAttributes:
      item.descriptiveAttributes &&
      typeof item.descriptiveAttributes === "object" &&
      !Array.isArray(item.descriptiveAttributes)
        ? (item.descriptiveAttributes as Record<string, unknown>)
        : {},
    hasCustomFields: hasCustomFieldValues(item),
    isArchived: item.isArchived === true,
    lastSeenAt: item.lastSeenAt ? new Date(item.lastSeenAt) : null,
  };
}

function toSubject(device: ManagedDevice): ManagedDeviceHostSubject {
  return {
    id: device._id ? device._id.toString() : "",
    inventoryItemId: device.inventoryItemId
      ? device.inventoryItemId.toString()
      : "",
    inventoryMatch: isManagedDeviceHostMatch(device.inventoryMatch)
      ? device.inventoryMatch
      : undefined,
    written: readWrittenHostState(device.inventoryAttributes),
  };
}

function toFacts(
  device: ManagedDevice,
  provider: string | undefined,
): ManagedDeviceHostFacts {
  const details: JSONObject =
    device.details &&
    typeof device.details === "object" &&
    !Array.isArray(device.details)
      ? (device.details as JSONObject)
      : {};
  const serviceOperatingSystem: unknown = details["operatingSystem"];

  return {
    providerDeviceId: device.providerDeviceId || "",
    provider: provider,
    platform: device.platform,
    serviceOperatingSystem:
      typeof serviceOperatingSystem === "string"
        ? serviceOperatingSystem
        : undefined,
    deviceName: device.deviceName,
    alias: device.alias,
    serialNumber: device.serialNumber,
    manufacturer: device.manufacturer,
    model: device.model,
    osVersion: device.osVersion,
    buildNumber: device.buildNumber,
    securityPatchLevel: device.securityPatchLevel,
    groupName: device.groupName,
    groupPath: device.groupPath,
    ipAddresses: device.ipAddresses,
    macAddress: device.macAddress,
    isKioskMode: device.isKioskMode,
  };
}

export default class ManagedDeviceInventory {
  /*
   * Gives each device of a connection its host, and the host what the
   * service knows. One device's trouble is logged and left to the next
   * read; it never stops the others.
   */
  public static async record(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    // The connection's service: what its devices' own facts are namespaced by.
    provider?: string | undefined;
    now: Date;
  }): Promise<ManagedDeviceInventoryOutcome> {
    const outcome: ManagedDeviceInventoryOutcome = {
      matchedHostCount: 0,
      createdHostCount: 0,
      releasedHostCount: 0,
    };

    let skip: number = 0;

    for (;;) {
      const devices: Array<ManagedDevice> = await ManagedDeviceService.findBy({
        query: { projectId: data.projectId, connectionId: data.connectionId },
        select: DEVICE_SELECT,
        sort: { _id: SortOrder.Ascending },
        skip: skip,
        limit: PAGE_SIZE,
        props: { isRoot: true },
      });

      if (devices.length === 0) {
        break;
      }

      await ManagedDeviceInventory.recordPage({
        projectId: data.projectId,
        provider: data.provider,
        devices,
        now: data.now,
        outcome,
      });

      if (devices.length < PAGE_SIZE) {
        break;
      }

      skip += PAGE_SIZE;
    }

    return outcome;
  }

  private static async recordPage(data: {
    projectId: ObjectID;
    provider: string | undefined;
    devices: Array<ManagedDevice>;
    now: Date;
    outcome: ManagedDeviceInventoryOutcome;
  }): Promise<void> {
    const projectId: string = data.projectId.toString();
    const present: Array<ManagedDevice> = data.devices.filter(
      (device: ManagedDevice): boolean => {
        return !device.removedAt;
      },
    );

    // Every host a device here could be, read at once.
    const keyByDevice: Map<string, string> = new Map<string, string>();

    for (const device of present) {
      keyByDevice.set(
        device._id!.toString(),
        keyForHost(
          projectId,
          canonicalizeManagedDeviceIdentity(
            getManagedDeviceHostName({
              deviceName: device.deviceName,
              serialNumber: device.serialNumber,
              providerDeviceId: device.providerDeviceId,
            }),
          ),
        ),
      );
    }

    const byKey: Map<string, InventoryItem> = new Map<string, InventoryItem>();
    const byId: Map<string, InventoryItem> = new Map<string, InventoryItem>();
    const keys: Array<string> = Array.from(new Set(keyByDevice.values()));

    if (keys.length > 0) {
      const named: Array<InventoryItem> = await InventoryItemService.findBy({
        query: {
          projectId: data.projectId,
          entityType: EntityType.Host,
          entityKey: QueryHelper.any(keys),
        },
        select: HOST_SELECT,
        skip: 0,
        limit: keys.length,
        props: { isRoot: true },
      });

      for (const item of named) {
        byKey.set(item.entityKey!, item);
        byId.set(item._id!.toString(), item);
      }
    }

    const serials: Array<string> = present
      .map((device: ManagedDevice): string => {
        return getUsableSerialNumber(device.serialNumber) || "";
      })
      .filter(Boolean);

    const serialHosts: Array<SerialNumberHost> =
      await InventoryItemService.findHostsBySerialNumber({
        projectId: data.projectId,
        serialNumbers: serials,
        limit: serials.length * 2 + 10,
      });

    const linkedIds: Array<string> = data.devices
      .map((device: ManagedDevice): string => {
        return device.inventoryItemId ? device.inventoryItemId.toString() : "";
      })
      .filter(Boolean);
    const toRead: Array<string> = Array.from(
      new Set<string>([
        ...linkedIds,
        ...serialHosts.map((host: SerialNumberHost): string => {
          return host.id;
        }),
      ]),
    ).filter((id: string): boolean => {
      return !byId.has(id);
    });

    if (toRead.length > 0) {
      const items: Array<InventoryItem> = await InventoryItemService.findBy({
        query: { _id: QueryHelper.any(toRead) },
        select: HOST_SELECT,
        skip: 0,
        limit: toRead.length,
        props: { isRoot: true },
      });

      for (const item of items) {
        byId.set(item._id!.toString(), item);
      }
    }

    // Which of these hosts other devices of the project hold.
    const candidateIds: Array<string> = Array.from(byId.keys());
    const holders: Map<string, string> = new Map<string, string>();

    if (candidateIds.length > 0) {
      const holding: Array<ManagedDevice> = await ManagedDeviceService.findBy({
        query: {
          projectId: data.projectId,
          inventoryItemId: QueryHelper.any(candidateIds),
        },
        select: { _id: true, inventoryItemId: true },
        skip: 0,
        limit: candidateIds.length * 2,
        props: { isRoot: true },
      });

      for (const holder of holding) {
        holders.set(holder.inventoryItemId!.toString(), holder._id!.toString());
      }
    }

    for (const device of data.devices) {
      try {
        if (device.removedAt) {
          await ManagedDeviceInventory.recordRemoved(device, byId, data.now);
          continue;
        }

        const deviceId: string = device._id!.toString();
        const heldByOthers: Set<string> = new Set<string>();

        for (const [itemId, holderId] of holders) {
          if (holderId !== deviceId) {
            heldByOthers.add(itemId);
          }
        }

        const candidate: (
          item: InventoryItem | undefined,
        ) => ManagedDeviceHostCandidate | undefined = (
          item: InventoryItem | undefined,
        ): ManagedDeviceHostCandidate | undefined => {
          return item ? toCandidate(item) : undefined;
        };

        const serial: string = getUsableSerialNumber(device.serialNumber) || "";

        const choice: ManagedDeviceHostChoice = chooseManagedDeviceHost({
          device: toSubject(device),
          current: candidate(
            device.inventoryItemId
              ? byId.get(device.inventoryItemId.toString())
              : undefined,
          ),
          byName: candidate(byKey.get(keyByDevice.get(deviceId) || "")),
          bySerial: serialHosts
            .filter((host: SerialNumberHost): boolean => {
              return (
                Boolean(serial) &&
                (host.serialNumber === serial || host.hostName === serial)
              );
            })
            .map(
              (host: {
                id: string;
              }): ManagedDeviceHostCandidate | undefined => {
                return candidate(byId.get(host.id));
              },
            )
            .filter(
              (
                host: ManagedDeviceHostCandidate | undefined,
              ): host is ManagedDeviceHostCandidate => {
                return host !== undefined;
              },
            ),
          heldByOthers,
        });

        if (choice.release) {
          await ManagedDeviceInventory.releaseHost({
            item: choice.release.item,
            deleteIt: choice.release.deleteIt,
          });
          data.outcome.releasedHostCount++;
        }

        const itemId: string = await ManagedDeviceInventory.writeHost({
          projectId: data.projectId,
          provider: data.provider,
          device,
          choice,
          item: choice.itemId ? byId.get(choice.itemId) : undefined,
          key: keyByDevice.get(deviceId) || "",
          now: data.now,
        });

        if (itemId) {
          holders.set(itemId, deviceId);
        }

        if (
          choice.match === ManagedDeviceHostMatch.Created &&
          !choice.itemId &&
          itemId
        ) {
          data.outcome.createdHostCount++;
        }

        if (choice.match !== ManagedDeviceHostMatch.Created) {
          data.outcome.matchedHostCount++;
        }
      } catch (error) {
        logger.error(
          `Managed device ${device._id?.toString() || ""}: its host in Inventory could not be recorded; the next read tries again: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /*
   * A device that left the service's list: its host is archived, once, and
   * says nothing new. Restored by writeHost if the device comes back.
   */
  private static async recordRemoved(
    device: ManagedDevice,
    byId: Map<string, InventoryItem>,
    now: Date,
  ): Promise<void> {
    if (!device.inventoryItemId || device.isInventoryItemArchivedOnRemoval) {
      return;
    }

    const item: InventoryItem | undefined = byId.get(
      device.inventoryItemId.toString(),
    );

    if (!item) {
      return;
    }

    if (!item.isArchived) {
      await InventoryItemService.updateOneById({
        id: item.id!,
        data: { isArchived: true, archivedAt: now } as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    }

    await ManagedDeviceService.updateOneById({
      id: device.id!,
      data: { isInventoryItemArchivedOnRemoval: !item.isArchived },
      props: { isRoot: true, ignoreHooks: true },
    });
  }

  /*
   * Writes a device's host: makes it, or brings the one found up to date.
   * Answers its ID, or "" when it could not be made.
   */
  private static async writeHost(data: {
    projectId: ObjectID;
    provider: string | undefined;
    device: ManagedDevice;
    choice: ManagedDeviceHostChoice;
    item: InventoryItem | undefined;
    key: string;
    now: Date;
  }): Promise<string> {
    const device: ManagedDevice = data.device;
    const facts: ManagedDeviceHostFacts = toFacts(device, data.provider);
    const desired: Dictionary<string> = getManagedDeviceHostAttributes(facts);
    const written: WrittenHostState = readWrittenHostState(
      device.inventoryAttributes,
    );
    const displayName: string = getManagedDeviceHostDisplayName(facts);
    const checkIn: Date | null = device.lastCheckInAt
      ? new Date(device.lastCheckInAt)
      : null;

    let itemId: string = data.item?._id ? data.item._id.toString() : "";
    let writtenNow: WrittenHostState = written;

    if (!data.item) {
      const hostName: string = getManagedDeviceHostName({
        deviceName: device.deviceName,
        serialNumber: device.serialNumber,
        providerDeviceId: device.providerDeviceId,
      });

      if (!hostName || !data.key) {
        return "";
      }

      const model: InventoryItem = new InventoryItem();
      model.projectId = data.projectId;
      model.entityType = EntityType.Host;
      model.entityKey = data.key;
      model.source = EntitySource.Inventory;
      // As telemetry stores a host's identity: trimmed and lowercased.
      model.identifyingAttributes = {
        [MANAGED_DEVICE_HOST_NAME_ATTRIBUTE]:
          canonicalizeManagedDeviceIdentity(hostName),
      } as JSONObject;
      model.displayName = displayName;
      model.descriptiveAttributes = desired as JSONObject;
      model.resourceType = MANAGED_DEVICE_RESOURCE_TYPE;
      model.resourceId = device.id!;
      model.firstSeenAt = device.provisionedAt
        ? new Date(device.provisionedAt)
        : data.now;
      if (checkIn) {
        model.lastSeenAt = checkIn;
      }

      const created: InventoryItem = await InventoryItemService.create({
        data: model,
        props: { isRoot: true },
      });

      itemId = created._id ? created._id.toString() : "";
      writtenNow = { attributes: desired, displayName };
    } else {
      const item: InventoryItem = data.item;
      const update: {
        source?: EntitySource;
        resourceType?: string;
        resourceId?: ObjectID;
        displayName?: string;
        descriptiveAttributes?: JSONObject;
        lastSeenAt?: Date;
        isArchived?: boolean;
        archivedAt?: Date | null;
      } = {};

      /*
       * Taken over while the service lists the device: never pruned for a
       * telemetry silence, and pointing back at the device.
       */
      if (item.source !== EntitySource.Inventory) {
        update.source = EntitySource.Inventory;
      }

      if (
        item.resourceType !== MANAGED_DEVICE_RESOURCE_TYPE ||
        item.resourceId?.toString() !== device._id!.toString()
      ) {
        update.resourceType = MANAGED_DEVICE_RESOURCE_TYPE;
        update.resourceId = device.id!;
      }

      const merged: {
        attributes: JSONObject;
        written: Dictionary<string>;
      } | null = mergeManagedDeviceHostAttributes({
        current: toCandidate(item).descriptiveAttributes,
        desired,
        written: written.attributes,
      });

      if (merged) {
        update.descriptiveAttributes = merged.attributes;
      }

      /*
       * The host's name is the device's while it is the one telemetry gave
       * it (its host.name) or the one the import gave it last time.
       */
      const currentName: string = (item.displayName || "").trim();
      const hostName: string = getManagedDeviceHostName({
        deviceName: device.deviceName,
        serialNumber: device.serialNumber,
        providerDeviceId: device.providerDeviceId,
      });
      const isDefaultName: boolean =
        !currentName ||
        currentName === written.displayName ||
        canonicalizeManagedDeviceIdentity(currentName) ===
          canonicalizeManagedDeviceIdentity(hostName);

      if (isDefaultName && currentName !== displayName) {
        update.displayName = displayName;
      }

      if (
        checkIn &&
        (!item.lastSeenAt ||
          checkIn.getTime() - new Date(item.lastSeenAt).getTime() >=
            LAST_SEEN_BUMP_MS)
      ) {
        update.lastSeenAt = checkIn;
      }

      // Back in the service's list: the host the import archived comes back.
      if (device.isInventoryItemArchivedOnRemoval && item.isArchived) {
        update.isArchived = false;
        update.archivedAt = null;
      }

      if (Object.keys(update).length > 0) {
        await InventoryItemService.updateOneById({
          id: item.id!,
          data: update as unknown as QueryDeepPartialEntity<InventoryItem>,
          props: { isRoot: true, ignoreHooks: true },
        });
      }

      writtenNow = {
        attributes: merged
          ? merged.written
          : ManagedDeviceInventory.stillOurs(
              toCandidate(item).descriptiveAttributes,
              desired,
              written.attributes,
            ),
        displayName:
          isDefaultName || currentName === displayName
            ? displayName
            : written.displayName,
      };
    }

    const deviceUpdate: {
      inventoryItemId?: ObjectID | null;
      inventoryMatch?: ManagedDeviceHostMatch;
      inventoryAttributes?: JSONObject;
      isInventoryItemArchivedOnRemoval?: boolean;
    } = {};

    if (itemId && device.inventoryItemId?.toString() !== itemId) {
      deviceUpdate.inventoryItemId = new ObjectID(itemId);
    }

    if (device.inventoryMatch !== data.choice.match) {
      deviceUpdate.inventoryMatch = data.choice.match;
    }

    const writtenJson: JSONObject = {
      attributes: writtenNow.attributes as JSONObject,
      displayName: writtenNow.displayName,
    };

    if (
      JSON.stringify(readWrittenHostState(device.inventoryAttributes)) !==
      JSON.stringify(readWrittenHostState(writtenJson))
    ) {
      deviceUpdate.inventoryAttributes = writtenJson;
    }

    if (device.isInventoryItemArchivedOnRemoval) {
      deviceUpdate.isInventoryItemArchivedOnRemoval = false;
    }

    if (Object.keys(deviceUpdate).length > 0) {
      await ManagedDeviceService.updateOneById({
        id: device.id!,
        data: deviceUpdate as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    }

    return itemId;
  }

  // The keys whose value on the host is still the import's.
  private static stillOurs(
    current: Record<string, unknown>,
    desired: Dictionary<string>,
    written: Dictionary<string>,
  ): Dictionary<string> {
    const ours: Dictionary<string> = {};

    for (const [key, value] of Object.entries(desired)) {
      if (current[key] === value || written[key] === current[key]) {
        ours[key] = value;
      }
    }

    return ours;
  }

  /*
   * Lets a host go: deleted when the import made it and nothing else wrote
   * to it; otherwise handed back to telemetry - its source "discovered", no
   * pointer to a device, and the facts only the import keeps current taken
   * off - so it ages out as any host telemetry stops reporting does.
   */
  public static async releaseHost(data: {
    item: ManagedDeviceHostCandidate;
    deleteIt: boolean;
  }): Promise<void> {
    if (!data.item.id) {
      return;
    }

    if (data.deleteIt) {
      await InventoryItemService.hardDeleteBy({
        query: {
          _id: data.item.id,
          // Never wider than a host a device held.
          resourceType: MANAGED_DEVICE_RESOURCE_TYPE,
        },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      });
      return;
    }

    const attributes: JSONObject = {
      ...(data.item.descriptiveAttributes as JSONObject),
    };

    for (const key of IMPORT_ONLY_ATTRIBUTE_KEYS) {
      delete attributes[key];
    }

    await InventoryItemService.updateOneById({
      id: new ObjectID(data.item.id),
      data: {
        source: EntitySource.Discovered,
        resourceType: null,
        resourceId: null,
        descriptiveAttributes: attributes,
      } as never,
      props: { isRoot: true, ignoreHooks: true },
    });
  }

  /*
   * Lets go of the hosts of the given devices, before the devices go for
   * good: a connection being deleted, or devices 30 days gone.
   */
  public static async releaseDevices(
    devices: Array<ManagedDevice>,
  ): Promise<number> {
    const linked: Array<ManagedDevice> = devices.filter(
      (device: ManagedDevice): boolean => {
        return Boolean(device.inventoryItemId);
      },
    );

    if (linked.length === 0) {
      return 0;
    }

    const items: Array<InventoryItem> = await InventoryItemService.findBy({
      query: {
        _id: QueryHelper.any(
          linked.map((device: ManagedDevice): string => {
            return device.inventoryItemId!.toString();
          }),
        ),
      },
      select: HOST_SELECT,
      skip: 0,
      limit: linked.length,
      props: { isRoot: true },
    });
    const byId: Map<string, InventoryItem> = new Map<string, InventoryItem>();

    for (const item of items) {
      byId.set(item._id!.toString(), item);
    }

    let released: number = 0;

    for (const device of linked) {
      const item: InventoryItem | undefined = byId.get(
        device.inventoryItemId!.toString(),
      );

      // A host another device took since is not this device's to let go.
      if (
        !item ||
        item.resourceType !== MANAGED_DEVICE_RESOURCE_TYPE ||
        item.resourceId?.toString() !== device._id?.toString()
      ) {
        continue;
      }

      try {
        const candidate: ManagedDeviceHostCandidate = toCandidate(item);

        await ManagedDeviceInventory.releaseHost({
          item: candidate,
          deleteIt: isImportOnlyHost(candidate, toSubject(device)),
        });
        released++;
      } catch (error) {
        logger.error(
          `Managed device ${device._id?.toString() || ""}: its host in Inventory could not be let go: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return released;
  }

  // Lets go of the hosts of every device of a connection.
  public static async releaseConnection(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
  }): Promise<number> {
    let released: number = 0;
    let skip: number = 0;

    for (;;) {
      const devices: Array<ManagedDevice> = await ManagedDeviceService.findBy({
        query: { projectId: data.projectId, connectionId: data.connectionId },
        select: DEVICE_SELECT,
        sort: { _id: SortOrder.Ascending },
        skip: skip,
        limit: PAGE_SIZE,
        props: { isRoot: true },
      });

      if (devices.length === 0) {
        break;
      }

      released += await ManagedDeviceInventory.releaseDevices(devices);

      if (devices.length < PAGE_SIZE) {
        break;
      }

      skip += PAGE_SIZE;
    }

    return released;
  }
}
