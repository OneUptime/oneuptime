import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import URL from "Common/Types/API/URL";
import API from "Common/UI/Utils/API/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";

/*
 * The dashboard's door to the Network area's aggregate endpoints.
 *
 * Every one of these numbers used to be worked out in the browser from the
 * rows behind it — the device strip fetched up to ten thousand devices to add
 * up their down interfaces, the site strip fetched every site to see how many
 * were unhealthy, and the overview fetched both. On an eighty-thousand-device
 * fleet that is megabytes on the wire and hundreds of milliseconds of blocked
 * main thread turning JSON into model objects, to render four integers. It is
 * also silently wrong past the ten-thousand-row cap those fetches carried.
 *
 * These calls return the integers. See App/FeatureSet/BaseAPI/API/NetworkSummary.
 */

async function postSummary(route: string): Promise<JSONObject> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(route);

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: url,
      data: {},
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response.data || {};
}

/*
 * A field of the response as a number.
 *
 * Tolerant of a string on purpose: these are COUNT and SUM columns, and
 * Postgres reports those as bigint/numeric — which node-postgres hands back
 * as strings. The server parses them, but a value that ever slipped through
 * unparsed would render fine and then sort and add wrongly, which is the
 * worst way for a number to be broken.
 */
function readNumber(json: JSONObject, key: string): number {
  const value: JSONValue | undefined = json[key];

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed: number = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function readString(json: JSONObject, key: string): string {
  const value: JSONValue | undefined = json[key];
  return typeof value === "string" ? value : "";
}

function readObjectArray(json: JSONObject, key: string): Array<JSONObject> {
  const value: JSONValue | undefined = json[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return (value as JSONArray).filter((entry: JSONValue): entry is JSONObject => {
    return Boolean(entry) && typeof entry === "object" && !Array.isArray(entry);
  });
}

export interface DeviceSummaryCounts {
  devicesUp: number;
  devicesDown: number;
  devicesPending: number;
  // Interfaces, not devices — one switch with three dark ports counts three.
  interfacesDown: number;
  totalDevices: number;
  devicesWithoutSite: number;
}

export async function fetchDeviceSummary(): Promise<DeviceSummaryCounts> {
  const json: JSONObject = await postSummary("/network-device/summary");

  return {
    devicesUp: readNumber(json, "devicesUp"),
    devicesDown: readNumber(json, "devicesDown"),
    devicesPending: readNumber(json, "devicesPending"),
    interfacesDown: readNumber(json, "interfacesDown"),
    totalDevices: readNumber(json, "totalDevices"),
    devicesWithoutSite: readNumber(json, "devicesWithoutSite"),
  };
}

export interface SiteSummaryCounts {
  totalSites: number;
  unhealthySites: number;
  sitesWithNoData: number;
  devicesWithoutSite: number;
  /*
   * The non-operational statuses the counted sites are ACTUALLY rolling up,
   * so the chip the "Unhealthy" tile sets selects exactly the sites behind
   * the number on it rather than every non-operational status the project
   * happens to define.
   */
  unhealthyStatusIds: Array<string>;
}

export async function fetchSiteSummary(): Promise<SiteSummaryCounts> {
  const json: JSONObject = await postSummary("/network-site/summary");

  const statusIds: JSONValue | undefined = json["unhealthyStatusIds"];

  return {
    totalSites: readNumber(json, "totalSites"),
    unhealthySites: readNumber(json, "unhealthySites"),
    sitesWithNoData: readNumber(json, "sitesWithNoData"),
    devicesWithoutSite: readNumber(json, "devicesWithoutSite"),
    unhealthyStatusIds: Array.isArray(statusIds)
      ? (statusIds as JSONArray).reduce(
          (ids: Array<string>, id: JSONValue): Array<string> => {
            if (typeof id === "string" && id.length > 0) {
              ids.push(id);
            }
            return ids;
          },
          [],
        )
      : [],
  };
}

export interface OverviewFleet {
  total: number;
  up: number;
  down: number;
  pending: number;
  interfacesDown: number;
}

export interface OverviewAttentionDevice {
  id: string;
  name: string;
  lastSeenAt: string | null;
  interfacesDown: number;
  // Down devices lead the list; the rest are up devices with dark ports.
  isDown: boolean;
}

export interface OverviewAttentionSite {
  id: string;
  name: string;
  siteType: string | null;
  statusName: string | null;
  statusColor: string | null;
}

export interface OverviewVendor {
  vendor: string;
  count: number;
}

export interface NetworkOverviewSummary {
  fleet: OverviewFleet;
  siteCount: number;
  unhealthySiteCount: number;
  endpointCount: number;
  vendors: Array<OverviewVendor>;
  attentionDevices: Array<OverviewAttentionDevice>;
  attentionSites: Array<OverviewAttentionSite>;
}

export async function fetchNetworkOverview(): Promise<NetworkOverviewSummary> {
  const json: JSONObject = await postSummary("/network-device/overview");

  const fleetJson: JSONObject =
    json["fleet"] && typeof json["fleet"] === "object"
      ? (json["fleet"] as JSONObject)
      : {};

  return {
    fleet: {
      total: readNumber(fleetJson, "total"),
      up: readNumber(fleetJson, "up"),
      down: readNumber(fleetJson, "down"),
      pending: readNumber(fleetJson, "pending"),
      interfacesDown: readNumber(fleetJson, "interfacesDown"),
    },
    siteCount: readNumber(json, "siteCount"),
    unhealthySiteCount: readNumber(json, "unhealthySiteCount"),
    endpointCount: readNumber(json, "endpointCount"),
    vendors: readObjectArray(json, "vendors").map(
      (entry: JSONObject): OverviewVendor => {
        return {
          vendor: readString(entry, "vendor"),
          count: readNumber(entry, "count"),
        };
      },
    ),
    attentionDevices: readObjectArray(json, "attentionDevices").map(
      (entry: JSONObject): OverviewAttentionDevice => {
        return {
          id: readString(entry, "_id"),
          name: readString(entry, "name"),
          lastSeenAt: readString(entry, "lastSeenAt") || null,
          interfacesDown: readNumber(entry, "interfacesDown"),
          isDown: entry["isDown"] === true,
        };
      },
    ),
    attentionSites: readObjectArray(json, "attentionSites").map(
      (entry: JSONObject): OverviewAttentionSite => {
        return {
          id: readString(entry, "_id"),
          name: readString(entry, "name"),
          siteType: readString(entry, "siteType") || null,
          statusName: readString(entry, "statusName") || null,
          statusColor: readString(entry, "statusColor") || null,
        };
      },
    ),
  };
}
