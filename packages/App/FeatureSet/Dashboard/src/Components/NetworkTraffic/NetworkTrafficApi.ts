import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  NETWORK_TRAFFIC_FIND_LIMIT,
  NetworkTrafficAddressRow,
  NetworkTrafficApplicationRow,
  NetworkTrafficConversationRow,
  NetworkTrafficDeviceRow,
  NetworkTrafficFindMatch,
  NetworkTrafficFindRequest,
  NetworkTrafficFindResult,
  NetworkTrafficInterfaceRow,
  NetworkTrafficRequest,
  NetworkTrafficSeriesPoint,
  NetworkTrafficSource,
  NetworkTrafficSummary,
} from "Common/Types/NetFlow/NetworkTraffic";
import {
  MAX_NAMED_ADDRESSES_PER_PAGE,
  NETWORK_ADDRESS_NAME_SOURCES,
  NetworkAddressNameSource,
  NetworkAddressNameUtil,
  NetworkTrafficAddressName,
  NetworkTrafficAddressNames,
} from "Common/Types/NetFlow/NetworkAddressName";
import ObjectID from "Common/Types/ObjectID";
import NetworkAddressBlockUtil, {
  MAX_NETWORK_ADDRESS_BLOCK_TEXT_LENGTH,
} from "Common/Utils/NetworkTraffic/NetworkAddressBlock";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";

/*
 * The Traffic pages' one request (POST /network-traffic/summary), and a
 * reader for its answer that never trusts a shape: a missing list is
 * empty, a number that is not one is 0.
 *
 * And "find an address" by its name (POST /network-traffic/find-address,
 * issue #5340), read the same way.
 */

export const NETWORK_TRAFFIC_SUMMARY_PATH: string = "/network-traffic/summary";

export const NETWORK_TRAFFIC_FIND_ADDRESS_PATH: string =
  "/network-traffic/find-address";

/*
 * Names a summary may carry: one per address its rows show, written each
 * way a row writes it - a page's few dozen, and never more than this.
 */
export const MAX_ADDRESS_NAMES_READ: number = MAX_NAMED_ADDRESSES_PER_PAGE * 2;

function toNumber(value: unknown): number {
  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toSource(value: unknown): NetworkAddressNameSource | null {
  return typeof value === "string" &&
    (NETWORK_ADDRESS_NAME_SOURCES as ReadonlyArray<string>).includes(value)
    ? (value as NetworkAddressNameSource)
    : null;
}

/*
 * What a page's addresses are called (issue #5340): { address: name }. An
 * entry whose key is no address, or that names nothing, is left out - the
 * address is then shown as itself - and so is a source this page does not
 * know (a newer server's), a record id that is not one, a subnet that is
 * not one.
 */
export function parseNetworkTrafficAddressNames(
  value: unknown,
): NetworkTrafficAddressNames {
  const names: NetworkTrafficAddressNames = {};

  if (!isObject(value)) {
    return names;
  }

  let count: number = 0;

  for (const [address, raw] of Object.entries(value)) {
    if (count >= MAX_ADDRESS_NAMES_READ) {
      break;
    }

    if (!NetworkAddressBlockUtil.canonicalAddress(address) || !isObject(raw)) {
      continue;
    }

    const named: NetworkTrafficAddressName = {};
    const name: string | null = NetworkAddressNameUtil.cleanName(raw["name"]);
    const subnetName: string | null = NetworkAddressNameUtil.cleanName(
      raw["subnetName"],
    );

    if (name) {
      named.name = name;

      const source: NetworkAddressNameSource | null = toSource(raw["source"]);

      if (source) {
        named.source = source;
      }

      const resourceId: unknown = raw["resourceId"];

      if (typeof resourceId === "string" && ObjectID.isValidUUID(resourceId)) {
        named.resourceId = resourceId;
      }
    }

    if (subnetName) {
      named.subnetName = subnetName;

      const subnet: unknown = raw["subnet"];

      if (
        typeof subnet === "string" &&
        subnet.length <= MAX_NETWORK_ADDRESS_BLOCK_TEXT_LENGTH &&
        NetworkAddressBlockUtil.parse(subnet)
      ) {
        named.subnet = subnet;
      }
    }

    if (!named.name && !named.subnetName) {
      continue;
    }

    names[address] = named;
    count++;
  }

  return names;
}

function listOf<T>(value: unknown, read: (row: JSONObject) => T): Array<T> {
  if (!Array.isArray(value)) {
    return [];
  }

  return (value as JSONArray)
    .filter((row: unknown): boolean => {
      return Boolean(row) && typeof row === "object";
    })
    .map((row: unknown): T => {
      return read(row as JSONObject);
    });
}

export function parseNetworkTrafficSummary(
  data: JSONObject | undefined,
): NetworkTrafficSummary {
  const value: JSONObject = data || {};
  const totals: JSONObject = (value["totals"] as JSONObject) || {};

  return {
    windowStartAt: toText(value["windowStartAt"]),
    windowEndAt: toText(value["windowEndAt"]),
    bucketSeconds: toNumber(value["bucketSeconds"]) || 60,
    totals: {
      octets: toNumber(totals["octets"]),
      packets: toNumber(totals["packets"]),
      flows: toNumber(totals["flows"]),
    },
    maxSamplingRate: Math.max(1, toNumber(value["maxSamplingRate"])),
    series: listOf(value["series"], (row: JSONObject) => {
      const point: NetworkTrafficSeriesPoint = {
        time: toText(row["time"]),
        octets: toNumber(row["octets"]),
      };

      if (row["inOctets"] !== undefined || row["outOctets"] !== undefined) {
        point.inOctets = toNumber(row["inOctets"]);
        point.outOctets = toNumber(row["outOctets"]);
      }

      return point;
    }),
    topSources: listOf(value["topSources"], toAddressRow),
    topDestinations: listOf(value["topDestinations"], toAddressRow),
    topConversations: listOf(
      value["topConversations"],
      (row: JSONObject): NetworkTrafficConversationRow => {
        return {
          sourceIp: toText(row["sourceIp"]),
          destinationIp: toText(row["destinationIp"]),
          octets: toNumber(row["octets"]),
          packets: toNumber(row["packets"]),
        };
      },
    ),
    topApplications: listOf(
      value["topApplications"],
      (row: JSONObject): NetworkTrafficApplicationRow => {
        return {
          protocolNumber: toNumber(row["protocolNumber"]),
          port: toNumber(row["port"]),
          octets: toNumber(row["octets"]),
          packets: toNumber(row["packets"]),
        };
      },
    ),
    topInterfaces: listOf(
      value["topInterfaces"],
      (row: JSONObject): NetworkTrafficInterfaceRow => {
        return {
          interfaceIndex: toNumber(row["interfaceIndex"]),
          name: optionalText(row["name"]),
          alias: optionalText(row["alias"]),
          speedInMbps: toNumber(row["speedInMbps"]) || undefined,
          inOctets: toNumber(row["inOctets"]),
          outOctets: toNumber(row["outOctets"]),
        };
      },
    ),
    topDevices: listOf(
      value["topDevices"],
      (row: JSONObject): NetworkTrafficDeviceRow => {
        return {
          networkDeviceId: optionalText(row["networkDeviceId"]),
          name: optionalText(row["name"]),
          exporterIp: toText(row["exporterIp"]),
          octets: toNumber(row["octets"]),
          packets: toNumber(row["packets"]),
        };
      },
    ),
    sources: listOf(
      value["sources"],
      (row: JSONObject): NetworkTrafficSource => {
        return {
          networkDeviceId: optionalText(row["networkDeviceId"]),
          name: optionalText(row["name"]),
          exporterIp: toText(row["exporterIp"]),
          probeId: optionalText(row["probeId"]),
          flowFormat: toText(row["flowFormat"]),
          samplingRate: Math.max(1, toNumber(row["samplingRate"])),
          lastFlowAt: toText(row["lastFlowAt"]),
          flows: toNumber(row["flows"]),
          octets: toNumber(row["octets"]),
        };
      },
    ),
    lastFlowAt: optionalText(value["lastFlowAt"]) || null,
    addressNames: parseNetworkTrafficAddressNames(value["addressNames"]),
  };
}

/*
 * "Find an address"'s answer: the addresses found, busiest first, each
 * with the name it matched by. A match that is no address is left out.
 */
export function parseNetworkTrafficFindResult(
  data: JSONObject | undefined,
): NetworkTrafficFindResult {
  const matches: Array<NetworkTrafficFindMatch> = [];

  for (const row of listOf(
    (data || {})["matches"],
    (row: JSONObject): JSONObject => {
      return row;
    },
  )) {
    const address: string = toText(row["address"]);

    if (
      !NetworkAddressBlockUtil.canonicalAddress(address) ||
      matches.some((match: NetworkTrafficFindMatch): boolean => {
        return match.address === address;
      })
    ) {
      continue;
    }

    matches.push({
      address: address,
      name: NetworkAddressNameUtil.cleanName(row["name"]) || "",
      source: toSource(row["source"]) || NetworkAddressNameSource.Dns,
      octets: toNumber(row["octets"]),
    });

    if (matches.length >= NETWORK_TRAFFIC_FIND_LIMIT) {
      break;
    }
  }

  return { matches: matches };
}

function toAddressRow(row: JSONObject): NetworkTrafficAddressRow {
  return {
    ip: toText(row["ip"]),
    octets: toNumber(row["octets"]),
    packets: toNumber(row["packets"]),
  };
}

export async function fetchNetworkTraffic(
  request: NetworkTrafficRequest,
): Promise<NetworkTrafficSummary> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    NETWORK_TRAFFIC_SUMMARY_PATH,
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: url,
      data: request as unknown as JSONObject,
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return parseNetworkTrafficSummary(response.data);
}

export async function findNetworkTrafficAddress(
  request: NetworkTrafficFindRequest,
): Promise<NetworkTrafficFindResult> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    NETWORK_TRAFFIC_FIND_ADDRESS_PATH,
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: url,
      data: request as unknown as JSONObject,
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return parseNetworkTrafficFindResult(response.data);
}
