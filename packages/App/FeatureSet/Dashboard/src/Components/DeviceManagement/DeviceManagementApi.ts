import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { DeviceManagementTestResult } from "Common/Types/DeviceManagement/DeviceManagementConnectionTest";
import { JSONObject } from "Common/Types/JSON";
import { LlmConnectionFailureKind } from "Common/Types/LlmObservability/LlmConnectionTest";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The two calls Inventory > Managed Devices makes besides the connections'
 * CRUD: "Test" (who an Esper key belongs to, and how many Android devices a
 * read imports - nothing is imported or stored) and "Read now" (queues a
 * read of a saved connection).
 *
 * The server answers a test with a DeviceManagementTestResult, a failed one
 * included: a refused key is the test's answer, not a failed request.
 */

export const DEVICE_MANAGEMENT_CONNECTION_API_PATH: string =
  "/device-management-connection";

// The server's answer, read as the result it is - or a failure saying so.
export function readDeviceManagementTestResult(
  data: JSONObject | undefined,
): DeviceManagementTestResult {
  const status: unknown = data?.["status"];

  if (!data || (status !== "pass" && status !== "fail")) {
    return {
      provider: "",
      status: "fail",
      message: "",
      failureKind: LlmConnectionFailureKind.Other,
      tenant: "",
      durationMs: 0,
    };
  }

  const failureKind: unknown = data["failureKind"];
  const deviceCount: unknown = data["deviceCount"];

  return {
    provider: typeof data["provider"] === "string" ? data["provider"] : "",
    status: status,
    message: typeof data["message"] === "string" ? data["message"] : "",
    ...(typeof data["remediation"] === "string"
      ? { remediation: data["remediation"] }
      : {}),
    ...(Object.values(LlmConnectionFailureKind).includes(
      failureKind as LlmConnectionFailureKind,
    )
      ? { failureKind: failureKind as LlmConnectionFailureKind }
      : {}),
    tenant: typeof data["tenant"] === "string" ? data["tenant"] : "",
    ...(typeof data["role"] === "string" && data["role"]
      ? { role: data["role"] }
      : {}),
    ...(typeof deviceCount === "number" && Number.isFinite(deviceCount)
      ? { deviceCount: deviceCount }
      : {}),
    durationMs: typeof data["durationMs"] === "number" ? data["durationMs"] : 0,
  };
}

/*
 * Test settings never saved ({ config, secrets }), or a saved connection
 * with the form's unsaved values over it ({ connectionId, ... }).
 */
export async function runDeviceManagementTest(
  body: JSONObject,
): Promise<DeviceManagementTestResult> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    `${DEVICE_MANAGEMENT_CONNECTION_API_PATH}/test`,
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: url,
      data: body,
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    return {
      provider: "",
      status: "fail",
      message: API.getFriendlyMessage(response),
      failureKind: LlmConnectionFailureKind.Other,
      tenant: "",
      durationMs: 0,
    };
  }

  return readDeviceManagementTestResult(response.data);
}

// Queue a read of a saved connection now.
export async function readDeviceManagementConnectionNow(
  connectionId: ObjectID,
): Promise<void> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    `${DEVICE_MANAGEMENT_CONNECTION_API_PATH}/${connectionId.toString()}/read-now`,
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
}
