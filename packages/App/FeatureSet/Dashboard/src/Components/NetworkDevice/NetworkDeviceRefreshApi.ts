import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  NetworkDeviceRefreshAnswer,
  readNetworkDeviceRefreshAnswer,
} from "Common/Utils/NetworkDevice/NetworkDeviceRefresh";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";

/*
 * Refresh, asked of the server (NetworkDeviceRefreshAPI): the device is read
 * again now by its probe and its Meraki connection. React-free.
 */

export const NETWORK_DEVICE_REFRESH_ROUTE: string =
  "/network-device/:networkDeviceId/refresh";

export function getNetworkDeviceRefreshPath(
  deviceId: ObjectID | string,
): string {
  return NETWORK_DEVICE_REFRESH_ROUTE.replace(
    ":networkDeviceId",
    encodeURIComponent(deviceId.toString()),
  );
}

export async function requestNetworkDeviceRefresh(
  deviceId: ObjectID,
): Promise<NetworkDeviceRefreshAnswer> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    getNetworkDeviceRefreshPath(deviceId),
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

  const answer: NetworkDeviceRefreshAnswer | undefined =
    readNetworkDeviceRefreshAnswer(response.data);

  if (!answer) {
    throw new Error("The server did not say how the device is read again.");
  }

  return answer;
}
