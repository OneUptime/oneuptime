/*
 * ONE DEVICE, ONE INVENTORY ROW: THE IDENTITY CONTRACT (issue #9586).
 *
 * An Android device you own can reach OneUptime three ways: the device
 * management service that enrolls it (an Esper connection, which lists it
 * whether or not anything runs on it), an app on it that sends OpenTelemetry
 * (since #9533 a kiosk app names its device in `host.name`), and the
 * OneUptime Android agent that reports the device itself (#9587). All three
 * must land on ONE Inventory host, not three.
 *
 * Telemetry already decides what a host is: its `host.name`, trimmed and
 * lowercased (EntityKey.keyForHost). So the contract is a `host.name`
 * every sender can know, and two attributes that let a sender that names
 * the device another way still be matched:
 *
 *   host.name           the device's name in Esper, `${esper.deviceName}`
 *                       (ESP-ID-AAAAW). REQUIRED. Esper generates it, and it
 *                       does not change; the alias people edit is not it.
 *   host.id             the device's ID in Esper, `${esper.uuid}`
 *                       (811a2d27-13fd-...). Optional.
 *   host.serial_number  the device's serial number, `${esper.serialNumber}`.
 *                       Optional.
 *
 * Esper fills those placeholders into an app's managed configuration (Esper
 * Agent 8.00.0764 or later), which is how an app or the agent reads them on
 * the device. The import finds a device's host in this order, on every read:
 *
 *   1. the host whose host.name is the device's Esper name - the same row
 *      telemetry writes, by the same key;
 *   2. a host whose host.id is the device's Esper ID;
 *   3. a host whose host.serial_number is the device's serial number, when
 *      exactly one host has it;
 *   4. otherwise a new host, named by the device's Esper name, so a sender
 *      that starts later lands on it by rule 1.
 *
 * A host the import made by rule 4 gives way to a host telemetry reports
 * that matches by rule 2 or 3, as long as nothing but the import has
 * written to it: the device is then that one host, and the import's own is
 * removed. A host another device already holds is never taken.
 */

// InventoryItem.resourceType of a host a managed device holds.
export const MANAGED_DEVICE_RESOURCE_TYPE: string = "ManagedDevice";

// The resource attributes the contract names.
export const MANAGED_DEVICE_HOST_NAME_ATTRIBUTE: string = "host.name";
export const MANAGED_DEVICE_HOST_ID_ATTRIBUTE: string = "host.id";
export const MANAGED_DEVICE_SERIAL_NUMBER_ATTRIBUTE: string =
  "host.serial_number";

/*
 * Esper's managed configuration placeholders for the three, as an app's or
 * the agent's managed configuration writes them.
 */
export const ESPER_DEVICE_NAME_PLACEHOLDER: string = "${esper.deviceName}";
export const ESPER_DEVICE_ID_PLACEHOLDER: string = "${esper.uuid}";
export const ESPER_SERIAL_NUMBER_PLACEHOLDER: string = "${esper.serialNumber}";

// The Esper agent version that fills the placeholders in.
export const ESPER_PLACEHOLDERS_MIN_AGENT_VERSION: string = "8.00.0764";

/*
 * The facts the import keeps on a device's host beside the asset details:
 * namespaced, so no telemetry attribute is ever overwritten by one.
 */
export const ESPER_DEVICE_ID_ATTRIBUTE: string = "esper.device.id";
export const ESPER_DEVICE_NAME_ATTRIBUTE: string = "esper.device.name";
export const ESPER_GROUP_ATTRIBUTE: string = "esper.group";
// Android's security patch level (Build.VERSION.SECURITY_PATCH).
export const ANDROID_SECURITY_PATCH_LEVEL_ATTRIBUTE: string =
  "android.security_patch_level";

// How a device's host was found (the rule of the contract that matched).
export enum ManagedDeviceHostMatch {
  // Rule 1: the host telemetry names by the device's Esper name.
  Name = "name",
  // Rule 2: a host whose host.id is the device's Esper ID.
  DeviceId = "device-id",
  // Rule 3: the one host whose host.serial_number is the device's serial.
  SerialNumber = "serial-number",
  // Rule 4: none was found, so the import made one.
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
