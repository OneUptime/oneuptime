import {
  NETWORK_DEVICE_MANUFACTURER_INPUT_COLUMNS,
  NetworkDeviceAssetSource,
  getNetworkDeviceManufacturer,
} from "./NetworkDeviceAssetFacts";
import {
  DISCOVERED_DETAILS_CONTROLLER_KEY,
  NetworkDeviceDiscoveredField,
} from "../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";

/*
 * THE MAKER A DEVICE IS LISTED UNDER, KEPT ON THE DEVICE (OneUptime issue
 * #9363).
 *
 * The Devices list's Vendor / Model column names a device's maker by its
 * asset facts (NetworkDeviceAssetFacts.getManufacturerFact): the vendor saved
 * on it or read by its poll, else the platform its sysDescr names, else its
 * sysObjectID's enterprise, else what its network controller says, else the
 * maker the Discovered Devices list knows it by (issue #9305) - each of the
 * SNMP ones read by the device's own poll or, for a device nothing walks, by
 * a discovery scan (issue #5185). The device's page and its Inventory item
 * name the same maker.
 *
 * The list's Vendor filter and the column's sort read the `vendor` column
 * alone, so a maker that came from anywhere else was shown and never found:
 * a printer imported from the Discovered Devices list read "Sunnovo
 * International" and no Vendor filter matched it, and an EdgeSwitch, which
 * answers with Broadcom's enterprise arc, read "Ubiquiti" and was found as
 * "Broadcom".
 *
 * Postgres cannot work the maker out. Part of it is read off the sysDescr
 * and the sysObjectID by OneUptime's own rules (SystemDescriptionUtil,
 * SnmpVendorTemplate), which are JavaScript regular expressions. So the
 * server works it out with the very function the column draws it with, and
 * keeps the answer in the device's `manufacturer` column, written again
 * whenever something it is worked out from changes
 * (NetworkDeviceService.refreshManufacturer). The lists filter and sort by
 * that column like any other: paged and counted by the database, and only
 * by a reader who may read it, under the same permissions as the vendor.
 */

/*
 * The device's columns the maker is worked out from, declared beside the
 * function that works it out (NetworkDeviceAssetFacts). A write to any of
 * them can change it, so the service works it out again after one.
 *
 *   vendor, sysDescr, sysObjectId  what the device's poll read, or a
 *                                  person saved.
 *   lastSnmpSeenAt                 when the poll last read them: of two
 *                                  automatic readings, the newer wins.
 *   discoveredDetails              what discovery, the device's controller
 *                                  and the Discovered Devices list say.
 */
export { NETWORK_DEVICE_MANUFACTURER_INPUT_COLUMNS };

/*
 * The keys of its discovered details the maker reads: the SNMP identity a
 * discovery scan read, the maker the Discovered Devices list names, and the
 * controller's reading (whose provider is a maker of its own). A merge of any
 * other key - a MAC an ARP table gave it, the address its name resolves to,
 * the links its controller reports - cannot change the maker, and costs the
 * device nothing.
 */
export const NETWORK_DEVICE_MANUFACTURER_DISCOVERED_KEYS: ReadonlyArray<string> =
  [
    NetworkDeviceDiscoveredField.SystemDescription,
    NetworkDeviceDiscoveredField.SystemObjectId,
    NetworkDeviceDiscoveredField.Vendor,
    DISCOVERED_DETAILS_CONTROLLER_KEY,
  ];

// As wide as the vendor column, and every value the maker is taken from.
export const MAX_STORED_MANUFACTURER_LENGTH: number = 100;

/**
 * The maker to keep on a device: exactly the one its Vendor / Model column,
 * its page and its Inventory item name (getNetworkDeviceManufacturer), or
 * null when nothing names one.
 */
export function getStoredNetworkDeviceManufacturer(
  device: NetworkDeviceAssetSource,
): string | null {
  const manufacturer: string = (
    getNetworkDeviceManufacturer(device) || ""
  ).trim();

  return manufacturer
    ? manufacturer.substring(0, MAX_STORED_MANUFACTURER_LENGTH)
    : null;
}

/**
 * Whether a write of these columns can change the maker: one of them is a
 * column it is worked out from.
 */
export function isNetworkDeviceManufacturerInputWrite(
  columns: Iterable<string>,
): boolean {
  const inputs: ReadonlyArray<string> =
    NETWORK_DEVICE_MANUFACTURER_INPUT_COLUMNS as ReadonlyArray<string>;

  for (const column of columns) {
    if (inputs.includes(column)) {
      return true;
    }
  }

  return false;
}

/*
 * A time out of a row - a Date, or a date string from the API - as epoch
 * milliseconds, or undefined for anything else.
 */
function readTime(value: unknown): number | undefined {
  if (value instanceof Date) {
    const time: number = value.getTime();
    return Number.isNaN(time) ? undefined : time;
  }

  if (typeof value === "string" && value.trim()) {
    const time: number = new Date(value.trim()).getTime();
    return Number.isNaN(time) ? undefined : time;
  }

  return undefined;
}

/**
 * Whether a successful walk at `walkedAt` changes the device's maker though
 * it reads nothing new: the walk moves its lastSnmpSeenAt on (to the later of
 * the two, as the poll's verdict writes it), and of two automatic readings
 * of its SNMP identity the newer wins - so a walk after a discovery scan
 * makes the device's own reading the one its maker is read off again. A walk
 * that read a different identity is written through the service, which works
 * the maker out again by itself.
 */
export function isNetworkDeviceManufacturerChangedByWalk(
  device: NetworkDeviceAssetSource,
  walkedAt: Date,
): boolean {
  const walkedAtTime: number = walkedAt.getTime();

  if (Number.isNaN(walkedAtTime)) {
    return false;
  }

  const lastWalkedAt: number | undefined = readTime(device.lastSnmpSeenAt);
  const nextWalkedAt: number =
    lastWalkedAt === undefined
      ? walkedAtTime
      : Math.max(lastWalkedAt, walkedAtTime);

  if (lastWalkedAt === nextWalkedAt) {
    return false;
  }

  return (
    getStoredNetworkDeviceManufacturer(device) !==
    getStoredNetworkDeviceManufacturer({
      ...device,
      lastSnmpSeenAt: new Date(nextWalkedAt),
    })
  );
}

/**
 * Whether a merge into a device's discovered details can change its maker:
 * it sets or drops one of the keys the maker reads.
 */
export function isNetworkDeviceManufacturerDiscoveredPatch(patch: {
  set?: Record<string, unknown> | undefined;
  unset?: ReadonlyArray<string> | undefined;
}): boolean {
  const keys: Array<string> = [
    ...Object.keys(patch.set || {}),
    ...(patch.unset || []),
  ];

  return keys.some((key: string): boolean => {
    return NETWORK_DEVICE_MANUFACTURER_DISCOVERED_KEYS.includes(key);
  });
}
