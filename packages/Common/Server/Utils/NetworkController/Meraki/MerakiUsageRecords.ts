import { JSONObject } from "../../../../Types/JSON";
import { NetworkTrafficUsageKind } from "../../../../Types/NetFlow/NetworkTrafficUsage";
import {
  NetworkControllerAppliance,
  NetworkTrafficUsageRecord,
} from "../NetworkControllerTypes";

/*
 * Meraki's answers, turned into NetworkTrafficUsage records - and nothing
 * of them trusted on the way: every text is cleaned and cut to the length
 * its column keeps, every number is a finite, non-negative whole number of
 * bytes, and a row that is not an object is skipped.
 *
 * Units, as Meraki sends them:
 *
 *   - uplink usage (organizations/{id}/appliance/uplinks/usage/byNetwork):
 *     bytes;
 *   - traffic analytics (networks/{id}/traffic) and client usage
 *     (networks/{id}/clients): "kb" - kibibytes, 1,024 bytes each, which is
 *     what the dashboard's own totals are summed from.
 *
 * A busy window is held to the rows a page needs: the busiest
 * MAX_APPLICATION_ROWS application rows and MAX_CLIENT_ROWS client rows,
 * the rest summed into one row whose application (or client) is empty -
 * so every total stays whole, and the table stays small however many
 * clients a campus has.
 */

export const KIBIBYTE: number = 1024;
export const MAX_APPLICATION_ROWS: number = 500;
export const MAX_CLIENT_ROWS: number = 200;

// Lengths each text is kept to.
export const TEXT_LIMITS: {
  networkName: number;
  deviceName: number;
  serial: number;
  interfaceName: number;
  application: number;
  destination: number;
  protocol: number;
  clientKey: number;
  clientName: number;
  clientIp: number;
  clientMac: number;
  manufacturer: number;
  networkId: number;
  model: number;
} = {
  networkName: 128,
  deviceName: 128,
  serial: 32,
  interfaceName: 32,
  application: 128,
  destination: 253,
  protocol: 16,
  clientKey: 64,
  clientName: 128,
  clientIp: 45,
  clientMac: 17,
  manufacturer: 64,
  networkId: 64,
  model: 32,
};

/*
 * Outside text as a value worth keeping: every control character a space,
 * runs of spaces closed up, trimmed and cut to `limit`. A loop: the text is
 * Meraki's, of any length, and the input is cut before it is looked at.
 */
export function cleanText(value: unknown, limit: number): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }

  const text: string = String(value).substring(0, limit * 4);
  let cleaned: string = "";
  let lastWasSpace: boolean = false;

  for (const character of text) {
    const code: number = character.charCodeAt(0);
    const isSpace: boolean =
      code <= 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f);

    if (isSpace) {
      if (!lastWasSpace && cleaned.length > 0) {
        cleaned += " ";
      }

      lastWasSpace = true;
      continue;
    }

    cleaned += character;
    lastWasSpace = false;
  }

  return cleaned.trim().substring(0, limit).trim();
}

// A count of bytes: finite, non-negative, whole, within a safe integer.
export function readOctets(value: unknown, multiplier: number = 1): number {
  const parsed: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(parsed * multiplier));
}

// A whole count (flows, clients, a port): finite and non-negative.
export function readCount(value: unknown, max: number): number {
  const parsed: number = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(max, Math.floor(parsed));
}

function asObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

// A MAC as the rest of OneUptime keeps one: lowercase, colon-separated.
export function cleanMac(value: unknown): string {
  return cleanText(value, TEXT_LIMITS.clientMac).toLowerCase();
}

// A serial as Meraki prints it: upper case.
export function cleanSerial(value: unknown): string {
  return cleanText(value, TEXT_LIMITS.serial).toUpperCase();
}

function emptyRecord(data: {
  kind: NetworkTrafficUsageKind;
  controllerNetworkId: string;
  controllerNetworkName: string;
  windowStartAt: Date;
  windowEndAt: Date;
}): NetworkTrafficUsageRecord {
  return {
    kind: data.kind,
    controllerNetworkId: data.controllerNetworkId,
    controllerNetworkName: data.controllerNetworkName,
    deviceSerial: "",
    deviceName: "",
    interfaceName: "",
    application: "",
    destination: "",
    protocol: "",
    port: 0,
    clientKey: "",
    clientName: "",
    clientIp: "",
    clientMac: "",
    clientManufacturer: "",
    sentOctets: 0,
    receivedOctets: 0,
    flows: 0,
    clients: 0,
    windowStartAt: data.windowStartAt,
    windowEndAt: data.windowEndAt,
  };
}

/*
 * The appliances of an organization's device list (productTypes[] =
 * appliance): serial, name, model, MAC and network. A device with no
 * serial or no network is skipped - it carries no uplink.
 */
export function readAppliances(
  devices: Array<unknown>,
): Array<NetworkControllerAppliance> {
  const appliances: Array<NetworkControllerAppliance> = [];
  const seen: Set<string> = new Set();

  for (const value of devices) {
    const device: JSONObject | null = asObject(value);

    if (!device) {
      continue;
    }

    const serial: string = cleanSerial(device["serial"]);
    const networkId: string = cleanText(
      device["networkId"],
      TEXT_LIMITS.networkId,
    );

    if (!serial || !networkId || seen.has(serial)) {
      continue;
    }

    seen.add(serial);
    appliances.push({
      serial: serial,
      name: cleanText(device["name"], TEXT_LIMITS.deviceName),
      model: cleanText(device["model"], TEXT_LIMITS.model),
      mac: cleanMac(device["mac"]),
      controllerNetworkId: networkId,
    });
  }

  return appliances;
}

/*
 * One uplink window of the whole organization: a record per appliance and
 * uplink that carried anything. Every network the answer names keeps the
 * name it gives; an appliance's name comes from the device list.
 */
export function buildUplinkRecords(data: {
  answer: Array<unknown>;
  appliances: Map<string, NetworkControllerAppliance>;
  networkNames: Map<string, string>;
  windowStartAt: Date;
  windowEndAt: Date;
}): Array<NetworkTrafficUsageRecord> {
  const records: Array<NetworkTrafficUsageRecord> = [];

  for (const value of data.answer) {
    const network: JSONObject | null = asObject(value);

    if (!network) {
      continue;
    }

    const networkId: string = cleanText(
      network["networkId"],
      TEXT_LIMITS.networkId,
    );

    if (!networkId) {
      continue;
    }

    const networkName: string =
      cleanText(network["name"], TEXT_LIMITS.networkName) ||
      data.networkNames.get(networkId) ||
      "";

    const uplinks: unknown = network["byUplink"];

    if (!Array.isArray(uplinks)) {
      continue;
    }

    for (const uplinkValue of uplinks) {
      const uplink: JSONObject | null = asObject(uplinkValue);

      if (!uplink) {
        continue;
      }

      const sent: number = readOctets(uplink["sent"]);
      const received: number = readOctets(uplink["received"]);

      if (sent === 0 && received === 0) {
        continue;
      }

      const serial: string = cleanSerial(uplink["serial"]);

      records.push({
        ...emptyRecord({
          kind: NetworkTrafficUsageKind.Uplink,
          controllerNetworkId: networkId,
          controllerNetworkName: networkName,
          windowStartAt: data.windowStartAt,
          windowEndAt: data.windowEndAt,
        }),
        deviceSerial: serial,
        deviceName: data.appliances.get(serial)?.name || "",
        interfaceName:
          cleanText(uplink["interface"], TEXT_LIMITS.interfaceName) ||
          "uplink",
        sentOctets: sent,
        receivedOctets: received,
      });
    }
  }

  return records;
}

/*
 * One network's traffic analytics over a window: a record per application
 * and destination, the busiest MAX_APPLICATION_ROWS kept and the rest summed.
 */
export function buildApplicationRecords(data: {
  answer: Array<unknown>;
  controllerNetworkId: string;
  controllerNetworkName: string;
  windowStartAt: Date;
  windowEndAt: Date;
}): Array<NetworkTrafficUsageRecord> {
  const records: Array<NetworkTrafficUsageRecord> = [];

  for (const value of data.answer) {
    const row: JSONObject | null = asObject(value);

    if (!row) {
      continue;
    }

    const sent: number = readOctets(row["sent"], KIBIBYTE);
    const received: number = readOctets(row["recv"], KIBIBYTE);
    const flows: number = readCount(row["flows"], Number.MAX_SAFE_INTEGER);

    if (sent === 0 && received === 0 && flows === 0) {
      continue;
    }

    records.push({
      ...emptyRecord({
        kind: NetworkTrafficUsageKind.Application,
        controllerNetworkId: data.controllerNetworkId,
        controllerNetworkName: data.controllerNetworkName,
        windowStartAt: data.windowStartAt,
        windowEndAt: data.windowEndAt,
      }),
      application:
        cleanText(row["application"], TEXT_LIMITS.application) ||
        cleanText(row["destination"], TEXT_LIMITS.application),
      destination: cleanText(row["destination"], TEXT_LIMITS.destination),
      protocol: cleanText(row["protocol"], TEXT_LIMITS.protocol).toUpperCase(),
      port: readCount(row["port"], 65535),
      sentOctets: sent,
      receivedOctets: received,
      flows: flows,
      clients: readCount(row["numClients"], 2147483647),
    });
  }

  return capRecords(records, MAX_APPLICATION_ROWS, (rest: Array<NetworkTrafficUsageRecord>) => {
    const first: NetworkTrafficUsageRecord = rest[0]!;

    return {
      ...emptyRecord({
        kind: NetworkTrafficUsageKind.Application,
        controllerNetworkId: first.controllerNetworkId,
        controllerNetworkName: first.controllerNetworkName,
        windowStartAt: first.windowStartAt,
        windowEndAt: first.windowEndAt,
      }),
      flows: sumOf(rest, "flows"),
    };
  });
}

/*
 * One network's clients over a window: a record per client that sent or
 * received anything, the busiest MAX_CLIENT_ROWS kept and the rest summed.
 */
export function buildClientRecords(data: {
  answer: Array<unknown>;
  controllerNetworkId: string;
  controllerNetworkName: string;
  windowStartAt: Date;
  windowEndAt: Date;
}): Array<NetworkTrafficUsageRecord> {
  const records: Array<NetworkTrafficUsageRecord> = [];

  for (const value of data.answer) {
    const client: JSONObject | null = asObject(value);

    if (!client) {
      continue;
    }

    const usage: JSONObject = asObject(client["usage"]) || {};
    const sent: number = readOctets(usage["sent"], KIBIBYTE);
    const received: number = readOctets(usage["recv"], KIBIBYTE);

    if (sent === 0 && received === 0) {
      continue;
    }

    const mac: string = cleanMac(client["mac"]);
    const ip: string = cleanText(client["ip"], TEXT_LIMITS.clientIp);

    records.push({
      ...emptyRecord({
        kind: NetworkTrafficUsageKind.Client,
        controllerNetworkId: data.controllerNetworkId,
        controllerNetworkName: data.controllerNetworkName,
        windowStartAt: data.windowStartAt,
        windowEndAt: data.windowEndAt,
      }),
      clientKey:
        cleanText(client["id"], TEXT_LIMITS.clientKey) || mac || ip || "",
      clientName: cleanText(client["description"], TEXT_LIMITS.clientName),
      clientIp: ip,
      clientMac: mac,
      clientManufacturer: cleanText(
        client["manufacturer"],
        TEXT_LIMITS.manufacturer,
      ),
      sentOctets: sent,
      receivedOctets: received,
    });
  }

  return capRecords(records, MAX_CLIENT_ROWS, (rest: Array<NetworkTrafficUsageRecord>) => {
    const first: NetworkTrafficUsageRecord = rest[0]!;

    return emptyRecord({
      kind: NetworkTrafficUsageKind.Client,
      controllerNetworkId: first.controllerNetworkId,
      controllerNetworkName: first.controllerNetworkName,
      windowStartAt: first.windowStartAt,
      windowEndAt: first.windowEndAt,
    });
  });
}

function sumOf(
  records: Array<NetworkTrafficUsageRecord>,
  key: "sentOctets" | "receivedOctets" | "flows",
): number {
  let total: number = 0;

  for (const record of records) {
    total += record[key];
  }

  return Math.min(Number.MAX_SAFE_INTEGER, total);
}

/*
 * The busiest `limit` records (by bytes, then flows), and one more that
 * sums the rest - built by `makeRest` and given the rest's bytes.
 */
export function capRecords(
  records: Array<NetworkTrafficUsageRecord>,
  limit: number,
  makeRest: (rest: Array<NetworkTrafficUsageRecord>) => NetworkTrafficUsageRecord,
): Array<NetworkTrafficUsageRecord> {
  if (records.length <= limit) {
    return records;
  }

  const sorted: Array<NetworkTrafficUsageRecord> = [...records].sort(
    (a: NetworkTrafficUsageRecord, b: NetworkTrafficUsageRecord): number => {
      const bytes: number =
        b.sentOctets + b.receivedOctets - (a.sentOctets + a.receivedOctets);

      return bytes !== 0 ? bytes : b.flows - a.flows;
    },
  );

  const kept: Array<NetworkTrafficUsageRecord> = sorted.slice(0, limit);
  const rest: Array<NetworkTrafficUsageRecord> = sorted.slice(limit);
  const summed: NetworkTrafficUsageRecord = makeRest(rest);

  summed.sentOctets = sumOf(rest, "sentOctets");
  summed.receivedOctets = sumOf(rest, "receivedOctets");

  return [...kept, summed];
}
