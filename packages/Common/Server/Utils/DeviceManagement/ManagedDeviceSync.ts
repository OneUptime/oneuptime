import ManagedDevice from "../../../Models/DatabaseModels/ManagedDevice";
import ManagedDeviceApp from "../../../Models/DatabaseModels/ManagedDeviceApp";
import { JSONObject } from "../../../Types/JSON";
import {
  ProviderApp,
  ProviderDevice,
  ProviderGroup,
} from "./DeviceManagementTypes";

/*
 * WHAT A READ CHANGES, WORKED OUT BEFORE ANYTHING IS WRITTEN.
 *
 * Pure: the devices (and one device's apps) as they are stored, and as the
 * service lists them now, in; the rows to create, update, mark removed and
 * delete for good, out. The read runner writes the plan; the tests read it.
 *
 *   - A device new to OneUptime is created.
 *   - A device that changed is updated - only the columns that changed, so
 *     a steady fleet costs no writes beyond what moves on its own (a
 *     battery level, a check-in).
 *   - A device missing from a list read to its end is marked removed, once:
 *     never from a list cut short, which says nothing about the devices it
 *     left out.
 *   - A removed device that is listed again is back: no longer removed.
 *   - A device removed REMOVED_DEVICE_RETENTION_DAYS ago goes for good,
 *     with its apps.
 *
 * A check-in only ever moves forward: a window that missed a device, or a
 * device asked about on its own, never makes it look older than it was.
 */

export const REMOVED_DEVICE_RETENTION_DAYS: number = 30;

const DAY_MS: number = 24 * 60 * 60 * 1000;

// The columns of a device a read writes from what the service says.
export interface ManagedDeviceFields {
  deviceName: string;
  alias: string;
  serialNumber: string;
  imei: string;
  manufacturer: string;
  brand: string;
  model: string;
  osVersion: string;
  buildNumber: string;
  securityPatchLevel: string;
  agentVersion: string;
  providerState: number | null;
  groupId: string;
  groupName: string;
  groupPath: string;
  isKioskMode: boolean | null;
  batteryLevel: number | null;
  ipAddresses: string;
  macAddress: string;
  provisionedAt: Date | null;
  details: JSONObject;
}

/*
 * The columns whose change is a change worth counting ("3 devices
 * changed"): what a device is, runs and belongs to. A battery level, an
 * address, the service's online flag and the memory figures move on their
 * own all day, and are written without being counted.
 */
export const COUNTED_DEVICE_FIELDS: ReadonlyArray<keyof ManagedDeviceFields> = [
  "deviceName",
  "alias",
  "serialNumber",
  "imei",
  "manufacturer",
  "brand",
  "model",
  "osVersion",
  "buildNumber",
  "securityPatchLevel",
  "agentVersion",
  "groupId",
  "groupName",
  "groupPath",
  "isKioskMode",
];

const ALL_DEVICE_FIELDS: ReadonlyArray<keyof ManagedDeviceFields> = [
  ...COUNTED_DEVICE_FIELDS,
  "providerState",
  "batteryLevel",
  "ipAddresses",
  "macAddress",
  "provisionedAt",
  "details",
];

export interface StoredManagedDevice {
  id: string;
  providerDeviceId: string;
  fields: ManagedDeviceFields;
  lastCheckInAt: Date | null;
  removedAt: Date | null;
}

export interface ManagedDeviceCreate {
  providerDeviceId: string;
  fields: ManagedDeviceFields;
  lastCheckInAt: Date | null;
}

export interface ManagedDeviceUpdate {
  id: string;
  providerDeviceId: string;
  // Only the columns that change; null clears one.
  changes: Partial<ManagedDeviceFields> & {
    lastCheckInAt?: Date | undefined;
    removedAt?: null | undefined;
  };
  // A counted column changed.
  isCounted: boolean;
  // The device was removed, and is listed again.
  isBack: boolean;
}

export interface ManagedDeviceSyncPlan {
  creates: Array<ManagedDeviceCreate>;
  updates: Array<ManagedDeviceUpdate>;
  // Devices to mark removed now (by row ID).
  removals: Array<string>;
  // Devices removed long enough ago to go for good (by row ID).
  purges: Array<string>;
}

// A JSON object with its keys in order, for comparing two.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value
      .map((item: unknown): string => {
        return stableJson(item);
      })
      .join(",")}]`;
  }

  if (value && typeof value === "object") {
    const object: Record<string, unknown> = value as Record<string, unknown>;

    return `{${Object.keys(object)
      .sort()
      .map((key: string): string => {
        return `${JSON.stringify(key)}:${stableJson(object[key])}`;
      })
      .join(",")}}`;
  }

  return JSON.stringify(value === undefined ? null : value);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date || right instanceof Date) {
    const leftTime: number | null =
      left instanceof Date ? left.getTime() : null;
    const rightTime: number | null =
      right instanceof Date ? right.getTime() : null;

    return leftTime === rightTime;
  }

  if (
    (left && typeof left === "object") ||
    (right && typeof right === "object")
  ) {
    return stableJson(left || {}) === stableJson(right || {});
  }

  return left === right;
}

/*
 * A device's columns from what the service says, its group named from the
 * groups read - or, when the group list was cut short and the group is not
 * on it, as it was stored, while the device is still in the same group.
 */
export function toManagedDeviceFields(data: {
  device: ProviderDevice;
  groups: ReadonlyMap<string, ProviderGroup>;
  isGroupListComplete: boolean;
  stored?: ManagedDeviceFields | undefined;
}): ManagedDeviceFields {
  const device: ProviderDevice = data.device;
  const group: ProviderGroup | undefined = device.groupId
    ? data.groups.get(device.groupId)
    : undefined;
  const keepStoredGroup: boolean =
    !group &&
    Boolean(device.groupId) &&
    !data.isGroupListComplete &&
    data.stored?.groupId === device.groupId;

  return {
    deviceName: device.deviceName,
    alias: device.alias,
    serialNumber: device.serialNumber,
    imei: device.imei,
    manufacturer: device.manufacturer,
    brand: device.brand,
    model: device.model,
    osVersion: device.osVersion,
    buildNumber: device.buildNumber,
    securityPatchLevel: device.securityPatchLevel,
    agentVersion: device.agentVersion,
    providerState: device.state,
    groupId: device.groupId,
    groupName: keepStoredGroup
      ? data.stored?.groupName || ""
      : group?.name || "",
    groupPath: keepStoredGroup
      ? data.stored?.groupPath || ""
      : group?.path || "",
    isKioskMode: device.isKioskMode,
    batteryLevel: device.batteryLevel,
    ipAddresses: device.ipAddresses.join(", ").substring(0, 500),
    macAddress: device.macAddress,
    provisionedAt: device.provisionedAt,
    details: device.details,
  };
}

// A stored device's columns, as the plan compares them.
export function toStoredManagedDevice(row: ManagedDevice): StoredManagedDevice {
  const text: (value: string | undefined | null) => string = (
    value: string | undefined | null,
  ): string => {
    return value || "";
  };

  return {
    id: row._id ? row._id.toString() : "",
    providerDeviceId: text(row.providerDeviceId),
    fields: {
      deviceName: text(row.deviceName),
      alias: text(row.alias),
      serialNumber: text(row.serialNumber),
      imei: text(row.imei),
      manufacturer: text(row.manufacturer),
      brand: text(row.brand),
      model: text(row.model),
      osVersion: text(row.osVersion),
      buildNumber: text(row.buildNumber),
      securityPatchLevel: text(row.securityPatchLevel),
      agentVersion: text(row.agentVersion),
      providerState:
        typeof row.providerState === "number" ? row.providerState : null,
      groupId: text(row.groupId),
      groupName: text(row.groupName),
      groupPath: text(row.groupPath),
      isKioskMode:
        typeof row.isKioskMode === "boolean" ? row.isKioskMode : null,
      batteryLevel:
        typeof row.batteryLevel === "number" ? row.batteryLevel : null,
      ipAddresses: text(row.ipAddresses),
      macAddress: text(row.macAddress),
      provisionedAt: row.provisionedAt ? new Date(row.provisionedAt) : null,
      details:
        row.details && typeof row.details === "object"
          ? (row.details as JSONObject)
          : {},
    },
    lastCheckInAt: row.lastCheckInAt ? new Date(row.lastCheckInAt) : null,
    removedAt: row.removedAt ? new Date(row.removedAt) : null,
  };
}

export function planManagedDeviceSync(data: {
  stored: Array<StoredManagedDevice>;
  devices: Array<ProviderDevice>;
  groups: ReadonlyMap<string, ProviderGroup>;
  isGroupListComplete: boolean;
  isDeviceListComplete: boolean;
  // The newest check-in this read knows per device (by the service's ID).
  checkIns: ReadonlyMap<string, Date>;
  now: Date;
}): ManagedDeviceSyncPlan {
  const plan: ManagedDeviceSyncPlan = {
    creates: [],
    updates: [],
    removals: [],
    purges: [],
  };

  const storedById: Map<string, StoredManagedDevice> = new Map<
    string,
    StoredManagedDevice
  >();

  for (const device of data.stored) {
    storedById.set(device.providerDeviceId, device);
  }

  const listed: Set<string> = new Set<string>();

  for (const device of data.devices) {
    if (listed.has(device.providerDeviceId)) {
      continue;
    }

    listed.add(device.providerDeviceId);

    const stored: StoredManagedDevice | undefined = storedById.get(
      device.providerDeviceId,
    );
    const fields: ManagedDeviceFields = toManagedDeviceFields({
      device,
      groups: data.groups,
      isGroupListComplete: data.isGroupListComplete,
      stored: stored?.fields,
    });
    const checkIn: Date | undefined = data.checkIns.get(
      device.providerDeviceId,
    );

    if (!stored) {
      plan.creates.push({
        providerDeviceId: device.providerDeviceId,
        fields,
        lastCheckInAt: checkIn || null,
      });
      continue;
    }

    const changes: ManagedDeviceUpdate["changes"] = {};
    let isCounted: boolean = false;

    for (const field of ALL_DEVICE_FIELDS) {
      if (!sameValue(stored.fields[field], fields[field])) {
        (changes as Record<string, unknown>)[field] = fields[field];

        if (COUNTED_DEVICE_FIELDS.includes(field)) {
          isCounted = true;
        }
      }
    }

    if (
      checkIn &&
      (!stored.lastCheckInAt ||
        checkIn.getTime() > stored.lastCheckInAt.getTime())
    ) {
      changes.lastCheckInAt = checkIn;
    }

    const isBack: boolean = stored.removedAt !== null;

    if (isBack) {
      changes.removedAt = null;
    }

    if (Object.keys(changes).length > 0) {
      plan.updates.push({
        id: stored.id,
        providerDeviceId: stored.providerDeviceId,
        changes,
        isCounted,
        isBack,
      });
    }
  }

  for (const stored of data.stored) {
    if (listed.has(stored.providerDeviceId)) {
      continue;
    }

    if (stored.removedAt) {
      if (
        data.now.getTime() - stored.removedAt.getTime() >=
        REMOVED_DEVICE_RETENTION_DAYS * DAY_MS
      ) {
        plan.purges.push(stored.id);
      }

      continue;
    }

    // Only a list read to its end says a device is gone.
    if (data.isDeviceListComplete) {
      plan.removals.push(stored.id);
    }
  }

  return plan;
}

// One app as it is stored.
export interface StoredManagedDeviceApp {
  id: string;
  app: ProviderApp;
}

export interface ManagedDeviceAppSyncPlan {
  creates: Array<ProviderApp>;
  updates: Array<{ id: string; app: ProviderApp }>;
  deletes: Array<string>;
}

export function toStoredManagedDeviceApp(
  row: ManagedDeviceApp,
): StoredManagedDeviceApp {
  return {
    id: row._id ? row._id.toString() : "",
    app: {
      packageName: row.packageName || "",
      appName: row.appName || "",
      versionName: row.versionName || "",
      versionCode: row.versionCode || "",
      state: row.state || "",
      isKioskApp: row.isKioskApp === true,
      isManagedByService: row.isManagedByService === true,
    },
  };
}

/*
 * One device's apps: an app new on it is created, an app whose version (or
 * anything else) changed is updated, an app no longer on it is deleted. By
 * package name - the app's identity on the device.
 */
export function planManagedDeviceAppSync(data: {
  stored: Array<StoredManagedDeviceApp>;
  apps: Array<ProviderApp>;
}): ManagedDeviceAppSyncPlan {
  const plan: ManagedDeviceAppSyncPlan = {
    creates: [],
    updates: [],
    deletes: [],
  };
  const storedByPackage: Map<string, StoredManagedDeviceApp> = new Map<
    string,
    StoredManagedDeviceApp
  >();

  for (const stored of data.stored) {
    if (storedByPackage.has(stored.app.packageName)) {
      // A duplicate row: the first is kept, the rest go.
      plan.deletes.push(stored.id);
      continue;
    }

    storedByPackage.set(stored.app.packageName, stored);
  }

  const listed: Set<string> = new Set<string>();

  for (const app of data.apps) {
    if (listed.has(app.packageName)) {
      continue;
    }

    listed.add(app.packageName);

    const stored: StoredManagedDeviceApp | undefined = storedByPackage.get(
      app.packageName,
    );

    if (!stored) {
      plan.creates.push(app);
      continue;
    }

    if (stableJson(stored.app) !== stableJson(app)) {
      plan.updates.push({ id: stored.id, app });
    }
  }

  for (const [packageName, stored] of storedByPackage) {
    if (!listed.has(packageName)) {
      plan.deletes.push(stored.id);
    }
  }

  return plan;
}
