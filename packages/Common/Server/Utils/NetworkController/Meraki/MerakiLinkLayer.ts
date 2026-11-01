import IP from "../../../../Types/IP/IP";
import { JSONObject } from "../../../../Types/JSON";
import { NetworkDeviceControllerLinkProtocol } from "../../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import { normalizeMac } from "../../../../Utils/Monitor/EndpointAttachmentUtil";
import {
  NetworkControllerLink,
  NetworkControllerLinkEnd,
} from "../NetworkControllerTypes";
import { readClientPort } from "./MerakiClientList";
import {
  TEXT_LIMITS,
  cleanMac,
  cleanSerial,
  cleanText,
} from "./MerakiUsageRecords";

/*
 * A NETWORK'S LINK LAYER TOPOLOGY (GET networks/{id}/topology/linkLayer), AS
 * THE READ KEEPS IT (OneUptime issue #5379).
 *
 * The answer is what the Meraki dashboard draws its own topology page from:
 * `nodes`, every device of the network and every LLDP or CDP speaker they
 * discovered, and `links`, each with two `ends`. An end names the node it is
 * and, when that is a Meraki device, the device's serial number; under
 * `discovered` it holds the port at that end.
 *
 * Which is exactly the cable a walk cannot always report: an MX answers only
 * what Meraki documents for polling it, and a device a probe only pings
 * reports nothing. Here the MX is one end of a link with a serial number.
 *
 * The answer is outside text like every other: read defensively, cleaned and
 * cut, and a link that does not have two ends - Meraki's own example shows
 * one with a single end - or that joins a device to itself says nothing.
 */

function asObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

function asArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

function readMac(value: unknown): string {
  return normalizeMac(cleanMac(value)) || "";
}

function readAddress(value: unknown): string {
  const text: string = cleanText(value, TEXT_LIMITS.clientIp);

  return text && IP.isIP(text) ? text : "";
}

/*
 * What an end is. A Meraki device's model alone does not say so - "MR70" is
 * only an access point to a classifier that knows whose it is - so its brand
 * goes in front. Anything else is whatever it advertised.
 */
function readPlatform(data: {
  model: unknown;
  cdpPlatform: unknown;
  lldpDescription: unknown;
}): string {
  const model: string = cleanText(data.model, TEXT_LIMITS.model);

  return model
    ? `Meraki ${model}`
    : firstText(data.cdpPlatform, data.lldpDescription);
}

function firstText(...values: Array<unknown>): string {
  for (const value of values) {
    const text: string = cleanText(value, TEXT_LIMITS.deviceName);

    if (text) {
      return text;
    }
  }

  return "";
}

/*
 * What the nodes of an answer say about one end, by the id the links refer
 * to them by.
 */
function indexNodes(values: Array<unknown>): Map<string, JSONObject> {
  const nodes: Map<string, JSONObject> = new Map<string, JSONObject>();

  for (const value of values) {
    const node: JSONObject | null = asObject(value);
    const id: string = node ? cleanText(node["derivedId"], 128) : "";

    if (node && id && !nodes.has(id)) {
      nodes.set(id, node);
    }
  }

  return nodes;
}

function readEnd(
  value: unknown,
  nodes: Map<string, JSONObject>,
): NetworkControllerLinkEnd | null {
  const end: JSONObject | null = asObject(value);

  if (!end) {
    return null;
  }

  const reference: JSONObject | null = asObject(end["node"]);
  const node: JSONObject | undefined = nodes.get(
    reference ? cleanText(reference["derivedId"], 128) : "",
  );
  const endDevice: JSONObject | null = asObject(end["device"]);
  const nodeDevice: JSONObject | null = asObject(node?.["device"]);
  const discovered: JSONObject | null = asObject(node?.["discovered"]);
  const lldp: JSONObject | null = asObject(discovered?.["lldp"]);
  const cdp: JSONObject | null = asObject(discovered?.["cdp"]);
  const endPorts: JSONObject | null = asObject(end["discovered"]);
  const endLldp: JSONObject | null = asObject(endPorts?.["lldp"]);
  const endCdp: JSONObject | null = asObject(endPorts?.["cdp"]);

  const parsed: NetworkControllerLinkEnd = {
    serial: cleanSerial(endDevice?.["serial"] || nodeDevice?.["serial"]),
    name: firstText(
      endDevice?.["name"],
      nodeDevice?.["name"],
      lldp?.["systemName"],
      cdp?.["deviceId"],
    ),
    port: readClientPort(endLldp?.["portId"] || endCdp?.["portId"]),
    mac: readMac(node?.["mac"]) || readMac(lldp?.["chassisId"]),
    ip:
      readAddress(lldp?.["managementAddress"]) ||
      readAddress(cdp?.["managementAddress"]) ||
      readAddress(cdp?.["address"]),
    platform: readPlatform({
      model: nodeDevice?.["model"],
      cdpPlatform: cdp?.["platform"],
      lldpDescription: lldp?.["systemDescription"],
    }),
  };

  return parsed.serial || parsed.name || parsed.mac || parsed.ip
    ? parsed
    : null;
}

function readProtocols(
  ends: Array<unknown>,
): Array<NetworkDeviceControllerLinkProtocol> {
  const protocols: Array<NetworkDeviceControllerLinkProtocol> = [];

  for (const value of ends) {
    const discovered: JSONObject | null = asObject(
      asObject(value)?.["discovered"],
    );

    for (const protocol of ["lldp", "cdp"] as const) {
      if (asObject(discovered?.[protocol]) && !protocols.includes(protocol)) {
        protocols.push(protocol);
      }
    }
  }

  return protocols;
}

// Whether two ends are one box: a stack's own link, say.
function isSameBox(
  a: NetworkControllerLinkEnd,
  b: NetworkControllerLinkEnd,
): boolean {
  return Boolean(a.serial && a.serial === b.serial);
}

/**
 * The links of one network's answer that have at least one Meraki device on
 * them: a link between two strangers belongs to no device here. Each pair of
 * ports once, however many times Meraki lists it.
 */
export function readMerakiLinks(
  body: unknown,
  controllerNetworkId: string,
): Array<NetworkControllerLink> {
  const answer: JSONObject | null = asObject(body);

  if (!answer) {
    return [];
  }

  const nodes: Map<string, JSONObject> = indexNodes(asArray(answer["nodes"]));
  const links: Array<NetworkControllerLink> = [];
  const seen: Set<string> = new Set<string>();

  for (const value of asArray(answer["links"])) {
    const link: JSONObject | null = asObject(value);
    const ends: Array<unknown> = asArray(link?.["ends"]);

    if (ends.length !== 2) {
      continue;
    }

    const first: NetworkControllerLinkEnd | null = readEnd(ends[0], nodes);
    const second: NetworkControllerLinkEnd | null = readEnd(ends[1], nodes);

    if (
      !first ||
      !second ||
      (!first.serial && !second.serial) ||
      isSameBox(first, second)
    ) {
      continue;
    }

    const key: string = [first, second]
      .map((end: NetworkControllerLinkEnd): string => {
        return `${end.serial || end.mac || end.name || end.ip}\u0000${end.port}`;
      })
      .sort()
      .join("\u0001");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    links.push({
      controllerNetworkId: controllerNetworkId,
      ends: [first, second],
      protocols: readProtocols(ends),
    });
  }

  return links;
}
