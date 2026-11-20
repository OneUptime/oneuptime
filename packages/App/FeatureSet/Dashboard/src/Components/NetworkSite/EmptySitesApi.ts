import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import URL from "Common/Types/API/URL";
import API from "Common/UI/Utils/API/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";

/*
 * The Sites page's door to Delete Empty Sites (Common/Server/API/
 * NetworkEmptySitesAPI, #10188): the project's empty sites, and the delete
 * of the ones a person confirmed.
 */

export interface EmptySite {
  id: string;
  name: string;
}

export interface EmptySitesDeleted {
  deletedCount: number;
  // Asked for, and kept: something is in them now, or they were gone.
  keptCount: number;
}

async function post(route: string, data: JSONObject): Promise<JSONObject> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(route);

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: url,
      data: data,
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response.data || {};
}

function readCount(json: JSONObject, key: string): number {
  const value: JSONValue | undefined = json[key];
  const parsed: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

// The project's empty sites the reader may see, by name.
export async function fetchEmptySites(): Promise<Array<EmptySite>> {
  const json: JSONObject = await post("/network-site/empty-sites", {});
  const sites: JSONValue | undefined = json["sites"];

  if (!Array.isArray(sites)) {
    return [];
  }

  const result: Array<EmptySite> = [];

  for (const entry of sites as JSONArray) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const id: JSONValue | undefined = (entry as JSONObject)["id"];
    const name: JSONValue | undefined = (entry as JSONObject)["name"];

    if (typeof id === "string" && id) {
      result.push({ id: id, name: typeof name === "string" ? name : "" });
    }
  }

  return result;
}

// Deletes the sites of `siteIds` that are still empty.
export async function deleteEmptySites(
  siteIds: Array<string>,
): Promise<EmptySitesDeleted> {
  const json: JSONObject = await post("/network-site/delete-empty-sites", {
    siteIds: siteIds,
  });

  return {
    deletedCount: readCount(json, "deletedCount"),
    keptCount: readCount(json, "keptCount"),
  };
}
