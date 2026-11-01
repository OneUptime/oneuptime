import IP from "../../../../Types/IP/IP";
import { JSONObject } from "../../../../Types/JSON";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import { normalizeMac } from "../../../../Utils/Monitor/EndpointAttachmentUtil";
import { NetworkControllerClient } from "../NetworkControllerTypes";
import {
  TEXT_LIMITS,
  cleanMac,
  cleanSerial,
  cleanText,
} from "./MerakiUsageRecords";

/*
 * A NETWORK'S CLIENT LIST (GET networks/{id}/clients), AS THE TOPOLOGY READS
 * IT (OneUptime issue #5379).
 *
 * The read already asks for this list, for Top clients. The same rows say
 * where each client is: recentDeviceSerial names the Meraki device it was
 * last connected to, switchport the port, and mac and ip join it to a device
 * in OneUptime. That is what a walked switch's forwarding table and a walked
 * router's ARP table say between them, and Meraki documents neither table
 * for polling a device directly. So a store whose registers answer ping and
 * nothing else needs no setting on any switch: its Meraki connection knows.
 *
 * Nothing here costs a call. Nothing in it is trusted either: every text is
 * cleaned and cut, a MAC goes through the one MAC normaliser, an address must
 * be an address literal, and a row with no MAC or no device is skipped.
 */

// Longer than any VLAN: what Meraki sends is a number or a VLAN's name.
const MAX_VLAN_TEXT_LENGTH: number = 16;
const MAX_VLAN_ID: number = 4094;

// What a run of digits has to look like to be read as a whole number.
const WHOLE_NUMBER_PATTERN: RegExp = /^\d{1,9}$/;

function asObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

/*
 * Meraki sends a VLAN as text, and a named VLAN's name in it. Only a number
 * in the VLAN range is a VLAN id; anything else is left out rather than
 * filed under a number it is not.
 */
export function readClientVlanId(value: unknown): number | undefined {
  const text: string = cleanText(value, MAX_VLAN_TEXT_LENGTH);

  if (!WHOLE_NUMBER_PATTERN.test(text)) {
    return undefined;
  }

  const vlanId: number = Number(text);

  return vlanId >= 1 && vlanId <= MAX_VLAN_ID ? vlanId : undefined;
}

/*
 * A port as people read it: Meraki's bare "3" is "Port 3", which is what its
 * dashboard calls it. A port on a module keeps its own name
 * ("1_MA-MOD-4X10G_1").
 */
export function readClientPort(value: unknown): string {
  const text: string = cleanText(value, ColumnLength.ShortText);

  return WHOLE_NUMBER_PATTERN.test(text) ? `Port ${text}` : text;
}

/*
 * A client's last sighting: Meraki's epoch seconds, or an ISO time, and no
 * later than the read - a sighting from the future would keep a row fresh
 * long after the client has gone. Without one, the read itself saw it.
 */
export function readClientLastSeen(value: unknown, now: Date): Date {
  let time: number = Number.NaN;

  if (typeof value === "number") {
    time = value * 1000;
  } else if (typeof value === "string" && value.trim()) {
    const text: string = value.trim();
    time = WHOLE_NUMBER_PATTERN.test(text) ? NaN : Date.parse(text);

    if (Number.isNaN(time) && Number.isFinite(Number(text))) {
      time = Number(text) * 1000;
    }
  }

  if (!Number.isFinite(time) || time <= 0 || time > now.getTime()) {
    return now;
  }

  return new Date(time);
}

/*
 * What Meraki calls a client, when that says more than its address does:
 * with no name of its own, a client's description is often its MAC or its
 * address, and that is not a hostname.
 */
export function readClientName(value: unknown): string {
  const name: string = cleanText(value, TEXT_LIMITS.clientName);

  return !name || normalizeMac(name) || IP.isIP(name) ? "" : name;
}

// The address literal Meraki gave, or "".
function readClientAddress(value: unknown): string {
  const text: string = cleanText(value, TEXT_LIMITS.clientIp);

  return text && IP.isIP(text) ? text : "";
}

/*
 * Whether a row describes a Wi-Fi client. recentDeviceConnection says so;
 * a row from before Meraki sent it says so by having an SSID and no port.
 */
function readIsWireless(client: JSONObject): boolean {
  const connection: string = cleanText(client["recentDeviceConnection"], 16);

  if (connection) {
    return connection.toLowerCase() === "wireless";
  }

  return Boolean(
    cleanText(client["ssid"], ColumnLength.ShortText) &&
      !cleanText(client["switchport"], ColumnLength.ShortText),
  );
}

/**
 * The clients of one network's listing, each once (by MAC, the first row
 * wins), that say which Meraki device they are on.
 */
export function readMerakiClients(
  values: Array<unknown>,
  now: Date,
): Array<NetworkControllerClient> {
  const clients: Array<NetworkControllerClient> = [];
  const seen: Set<string> = new Set<string>();

  for (const value of values) {
    const client: JSONObject | null = asObject(value);

    if (!client) {
      continue;
    }

    const mac: string | undefined = normalizeMac(cleanMac(client["mac"]));
    const deviceSerial: string = cleanSerial(client["recentDeviceSerial"]);

    if (!mac || !deviceSerial || seen.has(mac)) {
      continue;
    }

    seen.add(mac);

    const isWireless: boolean = readIsWireless(client);

    clients.push({
      mac: mac,
      ip: readClientAddress(client["ip"]),
      name: readClientName(client["description"]),
      manufacturer: cleanText(client["manufacturer"], TEXT_LIMITS.manufacturer),
      vlanId: readClientVlanId(client["vlan"]),
      deviceSerial: deviceSerial,
      port: isWireless
        ? cleanText(client["ssid"], ColumnLength.ShortText)
        : readClientPort(client["switchport"]),
      isWireless: isWireless,
      lastSeenAt: readClientLastSeen(client["lastSeen"], now),
    });
  }

  return clients;
}
