import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";
import {
  MAX_NETWORK_TRAFFIC_USAGE_SEARCH_LENGTH,
  NetworkTrafficUsageListRequestUtil,
} from "../NetFlow/NetworkTrafficUsage";
import { NameLikenessReason } from "../../Utils/NetworkDevice/DeviceNameLikeness";

/*
 * LINKING A DEVICE TO THE MERAKI APPLIANCE IT IS (issue #5762).
 *
 * A Meraki connection reads each MX and Z appliance's uplink traffic, and
 * gives it to the network device the appliance is - one with the
 * appliance's serial number or MAC address, or one Meraki's record of it was
 * matched to (NetworkControllerDeviceMatcher). An appliance that is none of
 * them keeps its traffic on the network's Traffic page alone. A router added
 * by hand at its WAN address - Meraki lists no address for an MX, so Add
 * devices cannot add one - is the commonest such device, and its Traffic
 * page had nothing to show and no word of why.
 *
 * Its Traffic page now offers "Link to a Meraki appliance":
 *
 *   - POST /network-traffic/usage-appliances lists the appliances the
 *     project's connections reported in the last LINKABLE_APPLIANCE_DAYS
 *     days, as the person may read them, the likely ones first - those
 *     whose names are like the device's (DeviceNameLikeness) - each saying
 *     whether a device here is it already;
 *   - POST /network-traffic/link-appliance writes the appliance's serial
 *     number on the device, as the person (whoever may change a device's
 *     serial number), and files the traffic already stored for it under the
 *     device, so the device, its site and the network's page show the same
 *     numbers for it at once - not only from the next read on;
 *   - POST /network-traffic/unlink-appliance takes the serial number off
 *     again, and returns the traffic to the network's page.
 *
 * Nothing is matched by a name: a person picks the appliance.
 */

// How far back the appliances a device can be linked to are looked for.
export const LINKABLE_APPLIANCE_DAYS: number = 7;

// The most appliances one answer lists: the search narrows the rest.
export const MAX_LISTED_APPLIANCES: number = 50;

// The most likely ones offered first.
export const MAX_LIKELY_APPLIANCES: number = 3;

// The most appliances read to be searched and likened: an organization's ceiling.
export const MAX_LINKABLE_APPLIANCES: number = 20000;

export interface NetworkControllerLinkableAppliance {
  serial: string;
  // As Meraki names it: the appliance, its network, the connection that read it.
  name: string;
  controllerNetworkId: string;
  controllerNetworkName: string;
  connectionName: string;
  // When its newest uplink window ended (ISO).
  lastSeenAt: string;
  // What its uplinks carried, both ways, over the days looked at.
  octets: number;
  // The device here it is already, when it is one: never offered for another.
  linkedDeviceId?: string | undefined;
  // That device's name, when the person may read it.
  linkedDeviceName?: string | undefined;
  // Offered first, and why: its name is like the device's.
  isLikely: boolean;
  likenessReason?: NameLikenessReason | undefined;
  // The number or word both names have, for a likeness of those kinds.
  likenessShared?: string | undefined;
}

export interface NetworkControllerLinkableApplianceList {
  // The likely ones first, then the rest by name, at most MAX_LISTED_APPLIANCES.
  appliances: Array<NetworkControllerLinkableAppliance>;
  // Every appliance there is to link to, and how many of them the search matches.
  total: number;
  matching: number;
}

export interface NetworkControllerApplianceListRequest {
  networkDeviceId: ObjectID;
  search: string;
}

export interface NetworkControllerApplianceLinkRequest {
  networkDeviceId: ObjectID;
  // As Meraki prints it, in upper case.
  deviceSerial: string;
}

export interface NetworkControllerApplianceUnlinkRequest {
  networkDeviceId: ObjectID;
}

// The longest serial number taken: as long as a filter's.
const MAX_SERIAL_LENGTH: number = 64;

function readDeviceId(value: unknown): ObjectID {
  if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
    throw new BadDataException("networkDeviceId is not a valid ID");
  }

  return new ObjectID(value);
}

function readBody(body: unknown): JSONObject {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as JSONObject)
    : {};
}

/*
 * A serial number as Meraki prints one: letters, digits and "-", which is
 * every serial it gives. A loop: the value is untrusted text.
 */
export function readApplianceSerial(value: unknown): string {
  if (typeof value !== "string") {
    throw new BadDataException("deviceSerial is not a serial number");
  }

  const serial: string = value.trim();

  if (!serial || serial.length > MAX_SERIAL_LENGTH) {
    throw new BadDataException("deviceSerial is not a serial number");
  }

  for (let index: number = 0; index < serial.length; index++) {
    const code: number = serial.charCodeAt(index);
    const isDigit: boolean = code >= 0x30 && code <= 0x39;
    const isUpper: boolean = code >= 0x41 && code <= 0x5a;
    const isLower: boolean = code >= 0x61 && code <= 0x7a;

    if (!isDigit && !isUpper && !isLower && code !== 0x2d) {
      throw new BadDataException("deviceSerial is not a serial number");
    }
  }

  return serial.toUpperCase();
}

export class NetworkControllerApplianceLinkRequestUtil {
  public static parseList(
    body: unknown,
  ): NetworkControllerApplianceListRequest {
    const value: JSONObject = readBody(body);

    return {
      networkDeviceId: readDeviceId(value["networkDeviceId"]),
      search: NetworkTrafficUsageListRequestUtil.readSearch(value["search"]),
    };
  }

  public static parseLink(
    body: unknown,
  ): NetworkControllerApplianceLinkRequest {
    const value: JSONObject = readBody(body);

    return {
      networkDeviceId: readDeviceId(value["networkDeviceId"]),
      deviceSerial: readApplianceSerial(value["deviceSerial"]),
    };
  }

  public static parseUnlink(
    body: unknown,
  ): NetworkControllerApplianceUnlinkRequest {
    return {
      networkDeviceId: readDeviceId(readBody(body)["networkDeviceId"]),
    };
  }
}

// What the search may hold, for a box that says so.
export const MAX_APPLIANCE_SEARCH_LENGTH: number =
  MAX_NETWORK_TRAFFIC_USAGE_SEARCH_LENGTH;
