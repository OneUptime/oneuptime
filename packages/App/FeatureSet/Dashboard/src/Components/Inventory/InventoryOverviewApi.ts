import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import URL from "Common/Types/API/URL";
import API from "Common/UI/Utils/API/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import { InventorySummaryCounts } from "./InventorySummaryTiles";

/*
 * The Inventory Overview's door to its aggregate endpoint.
 *
 * The page used to fetch up to ten thousand inventory rows and count them
 * here, which was silently wrong for any project with more: every tile and
 * the whole breakdown described only the ten thousand most recently seen.
 * The server counts the whole estate now and sends the numbers, plus the few
 * rows the "Recently added" card shows.
 * See App/FeatureSet/BaseAPI/API/InventoryOverview.
 */

export interface InventoryRecentItem {
  id: string;
  displayName: string;
  entityType: string;
  source: string;
  lastSeenAt: string | null;
}

export interface InventoryOverview {
  counts: InventorySummaryCounts;
  // Items per entity type. Types with nothing in them are absent.
  countsByType: Record<string, number>;
  // Newest first.
  recentlyAdded: Array<InventoryRecentItem>;
}

/*
 * A field of the response as a number. Tolerant of a string on purpose:
 * these are COUNT columns, which Postgres reports as bigint and node-postgres
 * hands back as strings. The server parses them, but one that slipped through
 * would render fine and then add by concatenating.
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

function readObject(json: JSONObject, key: string): JSONObject {
  const value: JSONValue | undefined = json[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readObjectArray(json: JSONObject, key: string): Array<JSONObject> {
  const value: JSONValue | undefined = json[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return (value as JSONArray).filter(
    (entry: JSONValue): entry is JSONObject => {
      return (
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
      );
    },
  );
}

export function parseInventoryOverview(json: JSONObject): InventoryOverview {
  const countsJson: JSONObject = readObject(json, "counts");

  const countsByType: Record<string, number> = {};

  for (const entry of readObjectArray(json, "countsByType")) {
    const entityType: string = readString(entry, "entityType");
    const count: number = readNumber(entry, "count");

    if (entityType && count > 0) {
      countsByType[entityType] = (countsByType[entityType] || 0) + count;
    }
  }

  return {
    counts: {
      total: readNumber(countsJson, "total"),
      discovered: readNumber(countsJson, "discovered"),
      mirrored: readNumber(countsJson, "mirrored"),
      manual: readNumber(countsJson, "manual"),
      stale: readNumber(countsJson, "stale"),
    },
    countsByType: countsByType,
    /*
     * Rows with no id are dropped rather than rendered: the card keys each
     * row on it and links to the item's page with it, so a blank id would be
     * a duplicate React key and a link to nowhere.
     */
    recentlyAdded: readObjectArray(json, "recentlyAdded")
      .map((entry: JSONObject): InventoryRecentItem => {
        return {
          id: readString(entry, "_id"),
          displayName: readString(entry, "displayName"),
          entityType: readString(entry, "entityType"),
          source: readString(entry, "source"),
          lastSeenAt: readString(entry, "lastSeenAt") || null,
        };
      })
      .filter((item: InventoryRecentItem): boolean => {
        return item.id.length > 0;
      }),
  };
}

export async function fetchInventoryOverview(): Promise<InventoryOverview> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    "/inventory-item/overview",
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: url,
      data: {},
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return parseInventoryOverview(response.data || {});
}
