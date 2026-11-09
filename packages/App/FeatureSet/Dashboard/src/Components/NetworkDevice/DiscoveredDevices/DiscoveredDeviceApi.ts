import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  DiscoveredDeviceIdsResponse,
  DiscoveredDeviceListRequest,
  DiscoveredDeviceListResponse,
  DiscoveredDeviceMapChange,
  readDiscoveredDeviceIdsResponse,
  readDiscoveredDeviceListResponse,
  readDiscoveredDeviceMapChange,
} from "Common/Types/NetworkDevice/DiscoveredDevice";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The Discovered Devices list's calls (Common/Server/API/
 * NetworkDiscoveredDeviceAPI, issue #5775). Every call carries the
 * project's headers, and a non-2xx answer is thrown, so the page shows it
 * with API.getFriendlyMessage. Adding devices to monitoring is an import:
 * startDiscoveredDeviceImport in DiscoveryImportApi. React-free: tested
 * from App.
 */

export const DISCOVERED_DEVICE_ROUTES: {
  list: string;
  ids: string;
  hideFromMap: string;
  showOnMap: string;
  showEverythingOnMap: string;
} = {
  list: "/network-discovered-device/list",
  ids: "/network-discovered-device/ids",
  hideFromMap: "/network-discovered-device/hide-from-map",
  showOnMap: "/network-discovered-device/show-on-map",
  showEverythingOnMap: "/network-discovered-device/show-everything-on-map",
};

async function postJson(route: string, body: JSONObject): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(route),
      headers: ModelAPI.getCommonHeaders(),
      data: body,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data || {}) as JSONObject;
}

// What a list request sends: only what differs from nothing.
export function toListRequestBody(
  request: Omit<DiscoveredDeviceListRequest, "limit" | "skip"> &
    Partial<Pick<DiscoveredDeviceListRequest, "limit" | "skip">>,
): JSONObject {
  const body: JSONObject = {
    search: request.search,
    show: request.show,
    sort: request.sort,
    sortOrder: request.sortOrder,
  };

  if (request.siteId) {
    body["siteId"] = request.siteId;
  }

  if (request.limit !== undefined) {
    body["limit"] = request.limit;
  }

  if (request.skip !== undefined) {
    body["skip"] = request.skip;
  }

  return body;
}

export async function listDiscoveredDevices(
  request: DiscoveredDeviceListRequest,
): Promise<DiscoveredDeviceListResponse> {
  return readDiscoveredDeviceListResponse(
    await postJson(DISCOVERED_DEVICE_ROUTES.list, toListRequestBody(request)),
  );
}

// Every row the request matches, named, up to what one bulk action takes.
export async function selectAllDiscoveredDevices(
  request: Omit<DiscoveredDeviceListRequest, "limit" | "skip">,
): Promise<DiscoveredDeviceIdsResponse> {
  return readDiscoveredDeviceIdsResponse(
    await postJson(DISCOVERED_DEVICE_ROUTES.ids, toListRequestBody(request)),
  );
}

export async function hideDiscoveredDevicesFromMap(
  endpointIds: Array<string>,
): Promise<DiscoveredDeviceMapChange> {
  return readDiscoveredDeviceMapChange(
    await postJson(DISCOVERED_DEVICE_ROUTES.hideFromMap, {
      endpointIds: endpointIds,
    }),
  );
}

export async function showDiscoveredDevicesOnMap(
  endpointIds: Array<string>,
): Promise<DiscoveredDeviceMapChange> {
  return readDiscoveredDeviceMapChange(
    await postJson(DISCOVERED_DEVICE_ROUTES.showOnMap, {
      endpointIds: endpointIds,
    }),
  );
}

// Every hidden node of the map shown again: the map's own "Show them".
export async function showEverythingOnMap(): Promise<number> {
  const body: JSONObject = await postJson(
    DISCOVERED_DEVICE_ROUTES.showEverythingOnMap,
    {},
  );
  const changed: number = Number(body["changed"]);

  return Number.isFinite(changed) && changed > 0 ? Math.floor(changed) : 0;
}
