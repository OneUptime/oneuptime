import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  NetworkTrafficAddressRow,
  NetworkTrafficApplicationRow,
  NetworkTrafficConversationRow,
  NetworkTrafficDeviceRow,
  NetworkTrafficInterfaceRow,
  NetworkTrafficRequest,
  NetworkTrafficSeriesPoint,
  NetworkTrafficSource,
  NetworkTrafficSummary,
} from "Common/Types/NetFlow/NetworkTraffic";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";

/*
 * The Traffic pages' one request (POST /network-traffic/summary), and a
 * reader for its answer that never trusts a shape: a missing list is
 * empty, a number that is not one is 0.
 */

export const NETWORK_TRAFFIC_SUMMARY_PATH: string = "/network-traffic/summary";

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
  };
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
