import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  DeviceNamingApplyResult,
  DeviceNamingPlan,
  DeviceNamingPreview,
  DeviceNamingRename,
  readDeviceNamingApplyResult,
  readDeviceNamingPlan,
  readDeviceNamingPreview,
} from "Common/Types/NetworkDevice/DeviceNaming";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The Dashboard's calls to the naming rules API
 * (Common/Server/API/NetworkDeviceNamingAPI, issue #6619). Every call carries
 * the project's headers, and a non-2xx answer is thrown, so the caller shows
 * it with API.getFriendlyMessage. React-free: tested from App.
 */

export const DEVICE_NAMING_ROUTES: {
  previewScan: string;
  previewDiscoveredDevices: string;
  plan: string;
  apply: string;
} = {
  previewScan: "/network-device-naming/preview-scan",
  previewDiscoveredDevices: "/network-device-naming/preview-discovered-devices",
  plan: "/network-device-naming/plan",
  apply: "/network-device-naming/apply",
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

// What the import of these hosts of a scan names each one.
export async function previewScanNames(data: {
  scanId: string;
  ipAddresses: Array<string>;
}): Promise<DeviceNamingPreview> {
  return readDeviceNamingPreview(
    await postJson(DEVICE_NAMING_ROUTES.previewScan, {
      scanId: data.scanId,
      ipAddresses: data.ipAddresses,
    }),
  );
}

// The same, for devices the Discovered Devices list adds.
export async function previewDiscoveredDeviceNames(data: {
  endpointIds: Array<string>;
}): Promise<DeviceNamingPreview> {
  return readDeviceNamingPreview(
    await postJson(DEVICE_NAMING_ROUTES.previewDiscoveredDevices, {
      endpointIds: data.endpointIds,
    }),
  );
}

/*
 * The devices that do not follow the naming rules: every device of the
 * project, or the ones asked about.
 */
export async function planDeviceNaming(data: {
  deviceIds?: Array<string> | undefined;
}): Promise<DeviceNamingPlan> {
  return readDeviceNamingPlan(
    await postJson(
      DEVICE_NAMING_ROUTES.plan,
      data.deviceIds ? { deviceIds: data.deviceIds } : {},
    ),
  );
}

export async function applyDeviceNaming(
  renames: Array<DeviceNamingRename>,
): Promise<DeviceNamingApplyResult> {
  return readDeviceNamingApplyResult(
    await postJson(DEVICE_NAMING_ROUTES.apply, {
      renames: renames.map((rename: DeviceNamingRename): JSONObject => {
        return {
          deviceId: rename.deviceId,
          fromName: rename.fromName,
          toName: rename.toName,
        };
      }),
    }),
  );
}
