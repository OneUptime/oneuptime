import { JSONArray, JSONObject } from "Common/Types/JSON";
import URL from "Common/Types/API/URL";
import API from "Common/UI/Utils/API/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import { InventoryPlacementLevel } from "Common/Utils/Inventory/InventoryItemPlacement";

/*
 * The door to what Inventory's Cluster, Host and Datacenter chips offer
 * (#11470): the places of a level the project's items sit in, each with
 * how many items are there, counted by the server over the whole list.
 * See App/FeatureSet/BaseAPI/API/InventoryPlacementOptions.
 */

export const INVENTORY_PLACEMENT_OPTIONS_PATH: string =
  "/inventory-item/placement-options";

export interface InventoryPlacementChoice {
  value: string;
  count: number;
}

export interface InventoryPlacementOptionsRequest {
  level: InventoryPlacementLevel;
  search: string;
  // The archived items' places, for the Archived list; the live ones' otherwise.
  isArchived: boolean;
}

// The answer's choices: those with a name, each once, as the server ordered them.
export function parseInventoryPlacementOptions(
  data: JSONObject,
): Array<InventoryPlacementChoice> {
  const options: unknown = data["options"];
  if (!Array.isArray(options)) {
    return [];
  }

  const seen: Set<string> = new Set<string>();
  const choices: Array<InventoryPlacementChoice> = [];
  for (const entry of options as JSONArray) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const value: unknown = (entry as JSONObject)["value"];
    if (typeof value !== "string" || !value || seen.has(value)) {
      continue;
    }
    const count: number = Number((entry as JSONObject)["count"]);
    seen.add(value);
    choices.push({
      value: value,
      count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
    });
  }
  return choices;
}

export async function fetchInventoryPlacementOptions(
  request: InventoryPlacementOptionsRequest,
): Promise<Array<InventoryPlacementChoice>> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    INVENTORY_PLACEMENT_OPTIONS_PATH,
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: url,
      data: {
        level: request.level,
        search: request.search,
        isArchived: request.isArchived,
      },
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return parseInventoryPlacementOptions(response.data || {});
}
