/*
 * ONE DEVICE, ONE INVENTORY ROW: THE IDENTITY CONTRACT (issue #9586).
 *
 * An Android device you own can reach OneUptime three ways: the device
 * management service that enrolls it (an Esper connection, which lists it
 * whether or not anything runs on it), an app on it that sends OpenTelemetry
 * (since #9533 a kiosk app names its device in `host.name`), and the
 * OneUptime Android agent that reports the device itself (#9587,
 * agents/AndroidAgent), which also makes it a host in Hosts. All three must
 * land on ONE Inventory host, not three.
 *
 * Telemetry already decides what a host is: its `host.name`, trimmed and
 * lowercased (EntityKey.keyForHost), and the Hosts product keys its Host by
 * the same name (HostService, case-insensitively). So the contract is a
 * `host.name` every sender can know, and one attribute that lets a sender
 * that names the device another way still be matched:
 *
 *   host.name           the device's name in Esper, `${esper.deviceName}`
 *                       (ESP-ID-AAAAW). REQUIRED. Esper generates it, and it
 *                       does not change; the alias people edit is not it.
 *                       The agent sends its `device_name` setting here.
 *   host.serial_number  the device's serial number, `${esper.serialNumber}`.
 *                       Optional. The agent sends its `device_serial`
 *                       setting here.
 *
 * Esper fills those placeholders into an app's or the agent's managed
 * configuration (Esper Agent 8.00.0764 or later), which is how they read
 * them on the device. `host.id` is not part of it: the agent sends its
 * ANDROID_ID there, which no device management service knows (Android
 * gives each signing key its own), so nothing can match on it.
 *
 * The import finds a device's host in this order, on every read:
 *
 *   1. the host whose host.name is the device's Esper name - the same row
 *      telemetry writes, by the same key, and so the Host the agent's
 *      metrics make;
 *   2. the one host whose host.serial_number is the device's serial number,
 *      or whose host.name is (an agent told `device_name:
 *      ${esper.serialNumber}`), when exactly one host has it;
 *   3. otherwise a new host, named by the device's Esper name, so a sender
 *      that starts later lands on it by rule 1.
 *
 * A host the import made by rule 3 gives way to a host telemetry reports
 * that matches by rule 2, as long as nothing but the import has written to
 * it: the device is then that one host, and the import's own is removed. A
 * host another device already holds is never taken.
 *
 * Every service keeps the same contract (#9837): a Microsoft Intune
 * device's host.name is its device name in Intune, and its serial number is
 * Intune's. A name two devices of a connection share is no one host's: see
 * getManagedDeviceUniqueHostName.
 */

// InventoryItem.resourceType of a host a managed device holds.
export const MANAGED_DEVICE_RESOURCE_TYPE: string = "ManagedDevice";

// The resource attributes the contract names.
export const MANAGED_DEVICE_HOST_NAME_ATTRIBUTE: string = "host.name";
export const MANAGED_DEVICE_SERIAL_NUMBER_ATTRIBUTE: string =
  "host.serial_number";

/*
 * Esper's managed configuration placeholders for the two, as an app's or
 * the agent's managed configuration writes them.
 */
export const ESPER_DEVICE_NAME_PLACEHOLDER: string = "${esper.deviceName}";
export const ESPER_SERIAL_NUMBER_PLACEHOLDER: string = "${esper.serialNumber}";

// The Esper agent version that fills the placeholders in.
export const ESPER_PLACEHOLDERS_MIN_AGENT_VERSION: string = "8.00.0764";

/*
 * The facts the import keeps on a device's host beside the asset details:
 * namespaced by the device's service, so no telemetry attribute is ever
 * overwritten by one, and a device two services enroll keeps each one's.
 */
export const ESPER_DEVICE_ID_ATTRIBUTE: string = "esper.device.id";
export const ESPER_DEVICE_NAME_ATTRIBUTE: string = "esper.device.name";
export const ESPER_GROUP_ATTRIBUTE: string = "esper.group";

export interface ManagedDeviceServiceAttributeKeys {
  // The service's ID of the device.
  deviceId: string;
  // The device's name in the service.
  deviceName: string;
  // Its group in the service, as a path where it has one.
  group: string;
}

/*
 * The namespace of a service's facts on a host: "esper" for Esper. Every
 * service's keys are listed in MANAGED_DEVICE_SERVICE_ATTRIBUTE_NAMESPACES,
 * so a host let go of loses whichever service's facts it carried.
 */
const SERVICE_ATTRIBUTE_NAMESPACES: Readonly<Record<string, string>> = {
  esper: "esper",
  intune: "intune",
};

export const MANAGED_DEVICE_SERVICE_ATTRIBUTE_NAMESPACES: ReadonlyArray<string> =
  Object.values(SERVICE_ATTRIBUTE_NAMESPACES);

export function getManagedDeviceServiceAttributeKeys(
  provider: string | undefined | null,
): ManagedDeviceServiceAttributeKeys {
  const namespace: string =
    SERVICE_ATTRIBUTE_NAMESPACES[provider || ""] || "esper";

  return {
    deviceId: `${namespace}.device.id`,
    deviceName: `${namespace}.device.name`,
    group: `${namespace}.group`,
  };
}

// Every service's keys: what only the import writes, and takes back.
export function getAllManagedDeviceServiceAttributeKeys(): Array<string> {
  return MANAGED_DEVICE_SERVICE_ATTRIBUTE_NAMESPACES.flatMap(
    (namespace: string): Array<string> => {
      return [
        `${namespace}.device.id`,
        `${namespace}.device.name`,
        `${namespace}.group`,
      ];
    },
  );
}
/*
 * Android's security patch level (Build.VERSION.SECURITY_PATCH), under the
 * key the Android agent sends it with, so a device both report keeps one.
 */
export const ANDROID_SECURITY_PATCH_LEVEL_ATTRIBUTE: string =
  "android.os.security_patch";

// How a device's host was found (the rule of the contract that matched).
export enum ManagedDeviceHostMatch {
  // Rule 1: the host telemetry names by the device's Esper name.
  Name = "name",
  // Rule 2: the one host named, or numbered, by the device's serial.
  SerialNumber = "serial-number",
  // Rule 3: none was found, so the import made one.
  Created = "created",
}

export function isManagedDeviceHostMatch(
  value: unknown,
): value is ManagedDeviceHostMatch {
  return (
    typeof value === "string" &&
    (Object.values(ManagedDeviceHostMatch) as Array<string>).includes(value)
  );
}

/*
 * Serial numbers that name no device: what Android answers an app that may
 * not read the serial ("unknown"), and the empty and all-zero values some
 * devices report. Two devices "matching" on one of these would be merged
 * into one row, so none of them ever matches.
 */
const PLACEHOLDER_SERIAL_NUMBERS: ReadonlySet<string> = new Set<string>([
  "",
  "unknown",
  "null",
  "none",
  "n/a",
  "na",
  "undefined",
  "serial",
  "0123456789abcdef",
]);

// A serial number that names one device, lowercased, or undefined.
export function getUsableSerialNumber(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const serial: string = value.trim().toLowerCase();

  if (PLACEHOLDER_SERIAL_NUMBERS.has(serial)) {
    return undefined;
  }

  let isAllZeros: boolean = true;

  for (const character of serial) {
    if (character !== "0") {
      isAllZeros = false;
      break;
    }
  }

  return isAllZeros ? undefined : serial;
}

// An identity value as telemetry compares it: trimmed and lowercased.
export function canonicalizeManagedDeviceIdentity(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/*
 * The host.name a device's host has: its Esper name, or - for a device the
 * service gave no name, which Esper does not do - its serial number, then
 * its ID, so the host is still the device's alone.
 */
export function getManagedDeviceHostName(device: {
  deviceName?: string | undefined;
  serialNumber?: string | undefined;
  providerDeviceId?: string | undefined;
}): string {
  const name: string = (device.deviceName || "").trim();

  if (name) {
    return name;
  }

  const serial: string | undefined = getUsableSerialNumber(device.serialNumber);

  if (serial && device.serialNumber) {
    return device.serialNumber.trim();
  }

  return (device.providerDeviceId || "").trim();
}

/*
 * A NAME TWO DEVICES SHARE (#9837)
 *
 * Esper names each device itself, once, so no two of a tenant's share a
 * name. Intune does not: a device is named what its owner called it, and
 * every iPhone nobody renamed is "iPhone". A name two of a connection's
 * devices share names neither of them - it would be one host for two
 * devices - so each is named by its serial number instead (rule 2's
 * name, which an agent told `device_name: <serial>` also sends), or by
 * the service's ID of it when it has none. It takes its own name back
 * once no other device of the connection has it.
 */
export interface ManagedDeviceNaming {
  deviceName?: string | undefined;
  serialNumber?: string | undefined;
  providerDeviceId?: string | undefined;
}

// The names (as canonicalized) more than one of these devices has.
export function getSharedManagedDeviceNames(
  devices: ReadonlyArray<ManagedDeviceNaming>,
): Set<string> {
  const seen: Set<string> = new Set<string>();
  const shared: Set<string> = new Set<string>();

  for (const device of devices) {
    const name: string = canonicalizeManagedDeviceIdentity(
      getManagedDeviceHostName(device),
    );

    if (!name) {
      continue;
    }

    if (seen.has(name)) {
      shared.add(name);
    }

    seen.add(name);
  }

  return shared;
}

/*
 * The name a device's host goes by when its own is not one host's to
 * have: its serial number, else the service's ID of it.
 */
export function getManagedDeviceFallbackHostName(
  device: ManagedDeviceNaming,
): string {
  if (getUsableSerialNumber(device.serialNumber) && device.serialNumber) {
    return device.serialNumber.trim();
  }

  return (device.providerDeviceId || "").trim();
}

/*
 * A device's host name, given the names its connection's devices share:
 * its own (getManagedDeviceHostName), or its fallback when another device
 * of the connection has that name too.
 */
export function getManagedDeviceUniqueHostName(
  device: ManagedDeviceNaming,
  sharedNames: ReadonlySet<string>,
): string {
  const name: string = getManagedDeviceHostName(device);

  if (!sharedNames.has(canonicalizeManagedDeviceIdentity(name))) {
    return name;
  }

  return getManagedDeviceFallbackHostName(device) || name;
}

/*
 * What a device is called where it must be told apart from the devices
 * that share its name - a monitor's series, an alert's title: its name,
 * with what tells it apart after it ("iPhone (F2LXK1ABCD)").
 */
export function getManagedDeviceUniqueName(
  device: ManagedDeviceNaming,
  sharedNames: ReadonlySet<string>,
): string {
  const name: string = getManagedDeviceHostName(device);
  const hostName: string = getManagedDeviceUniqueHostName(device, sharedNames);

  return hostName === name ? name : `${name} (${hostName})`;
}
