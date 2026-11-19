import {
  DiscoveredHostSharedAddress,
  DiscoveredNetworkDevice,
} from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DeviceAtAddressLike,
  DeviceSeenFrom,
  toIdKey,
} from "../NetworkDevice/DeviceAddressScope";

/*
 * WHETHER A SCAN'S HOST IS A DEVICE ALREADY: WORKED OUT ON EVERY READ, NEVER
 * STORED (OneUptime issues #9677, #9905, #9906).
 *
 * A scan's results are what its probe found. Whether a host is one of the
 * project's devices is not a fact about that sweep: devices are added,
 * deleted and moved between sites after it, and two sites can each have a
 * 10.0.0.5, so the answer depends on the inventory at the moment someone
 * asks and on the scan's probe (Utils/NetworkDevice/DeviceAddressScope).
 *
 * The probe's report used to store each host's isAlreadyRegistered, worked
 * out across the whole project, beside what every read worked out again per
 * site: the column said a branch B host was a device because branch A has
 * one at 10.0.0.5. Nothing read the stored copy any more, but anything that
 * read the column directly would have read the old rule. So none of these
 * fields is ever stored: the probe's report drops them (withoutRegistration),
 * an auto import rule's run leaves the stored hosts as they were, and a read
 * through NetworkDeviceDiscoveryScanService sets them from the inventory
 * (withRegistration).
 *
 * Pure, so the ingest, the read and their tests share one shape.
 */

/*
 * The fields a host's registration is told by: set by a read, never kept in
 * the column.
 */
export const DISCOVERED_HOST_REGISTRATION_FIELDS: ReadonlyArray<
  keyof DiscoveredNetworkDevice
> = ["isAlreadyRegistered", "registeredDeviceId", "sharedAddress"];

function isHostObject(host: unknown): host is Record<string, unknown> {
  return Boolean(host) && typeof host === "object" && !Array.isArray(host);
}

/*
 * The host as its probe reported it, without the fields only a read works
 * out. A row that is not an object is handed back as it is: the column keeps
 * whatever shape a probe sent, and its readers drop what is not a host.
 */
export function withoutRegistration<T>(host: T): T {
  if (!isHostObject(host)) {
    return host;
  }

  const copy: Record<string, unknown> = { ...host };

  for (const field of DISCOVERED_HOST_REGISTRATION_FIELDS) {
    delete copy[field];
  }

  return copy as T;
}

// Whether any of the fields only a read works out is on the host.
export function hasStoredRegistration(host: unknown): boolean {
  if (!isHostObject(host)) {
    return false;
  }

  return DISCOVERED_HOST_REGISTRATION_FIELDS.some((field: string): boolean => {
    return Object.prototype.hasOwnProperty.call(host, field);
  });
}

// What a read found at a host's address.
export interface DiscoveredHostRegistration {
  /*
   * Whether the host is a device already: the one the scan's probe sees at
   * its address, or one of devices there it cannot tell apart - never
   * offered as new.
   */
  isAlreadyRegistered: boolean;
  // The device the host is, when the scan's probe can tell which.
  deviceId?: string | undefined;
  // Why, when more than one device in the project has the address.
  sharedAddress?: DiscoveredHostSharedAddress | undefined;
}

/*
 * Why a host at an address several devices share is the device it is, or a
 * device that cannot be named (issue #9905), from what the scan's probe sees
 * there and how many devices the project has at the address. Undefined when
 * the address is one device's, or none is the host the probe sees there: a
 * host that reads as new says nothing about another site's device.
 */
export function getSharedAddress<T extends DeviceAtAddressLike>(data: {
  seen: DeviceSeenFrom<T> | undefined;
  devicesAtAddress: ReadonlyArray<DeviceAtAddressLike>;
}): DiscoveredHostSharedAddress | undefined {
  if (!data.seen || data.seen.kind === "none") {
    return undefined;
  }

  const deviceIds: Set<string> = new Set<string>();

  for (const device of data.devicesAtAddress) {
    const id: string = toIdKey(device.id);

    if (id) {
      deviceIds.add(id);
    }
  }

  if (data.seen.kind === "device") {
    return deviceIds.size >= 2
      ? { deviceCount: deviceIds.size, seenReason: data.seen.reason }
      : undefined;
  }

  const ambiguousDeviceIds: Array<string> = [];

  for (const device of data.seen.devices) {
    const id: string = toIdKey(device.id);

    if (id && !ambiguousDeviceIds.includes(id)) {
      ambiguousDeviceIds.push(id);
      deviceIds.add(id);
    }
  }

  return {
    // Devices that cannot be told apart are two at least.
    deviceCount: Math.max(deviceIds.size, 2),
    ambiguousReason: data.seen.reason,
    ambiguousDeviceIds: ambiguousDeviceIds,
  };
}

/*
 * The host with what a read found at its address, and nothing a stored row
 * said about it: every host is read as registered or not, never left to a
 * missing field.
 */
export function withRegistration(
  host: DiscoveredNetworkDevice,
  registration: DiscoveredHostRegistration,
): DiscoveredNetworkDevice {
  const isAlreadyRegistered: boolean =
    registration.isAlreadyRegistered || Boolean(registration.deviceId);

  return {
    ...withoutRegistration(host),
    isAlreadyRegistered: isAlreadyRegistered,
    ...(registration.deviceId
      ? { registeredDeviceId: registration.deviceId }
      : {}),
    ...(isAlreadyRegistered && registration.sharedAddress
      ? { sharedAddress: registration.sharedAddress }
      : {}),
  };
}
