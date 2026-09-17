import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import { JSONObject } from "Common/Types/JSON";

/*
 * The attribute keys a project's security events actually carry.
 *
 * Every source field OCSF has no typed column for is flattened into the
 * event's `attributes` map (activity_name, device.hostname,
 * finding_info.title, metadata.product.name, ...), and which keys exist
 * differs per event class and per source. So the security events table cannot
 * ship them as columns; it asks for the list and lets the viewer pick.
 *
 * Same endpoint shape as the log / trace / metric attribute pickers, served by
 * TelemetryAttributeService over the `attributeKeys` sidecar column.
 */
export default class SecurityEventAttributeUtil {
  public static async getAttributeKeys(): Promise<Array<string>> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/telemetry/security-events/get-attributes",
        ),
        data: {},
        headers: {
          ...AnalyticsModelAPI.getCommonHeaders(),
        },
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    const attributes: unknown = response.data["attributes"];

    if (!Array.isArray(attributes)) {
      return [];
    }

    return attributes.filter((attribute: unknown): attribute is string => {
      return typeof attribute === "string";
    });
  }
}
