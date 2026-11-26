import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  readTelemetryFieldReaders,
  SCRUB_RULE_READERS_API_PATH,
  ScrubRuleReadersRequest,
  TelemetryFieldReaders,
} from "Common/Types/Telemetry/TelemetryFieldReaders";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * What a scrub rule being written, or turned on, would take away (#10433):
 * the server's lookup (Server/API/ScrubRuleReadersAPI), asked with the
 * rule's own fields as the form holds them, through the refresh-aware
 * client with the project's headers. The answer is read defensively
 * (readTelemetryFieldReaders): a kind it does not say was checked is
 * unchecked, never empty.
 */
export default class ScrubRuleReadersApi {
  public static async getReaders(
    request: ScrubRuleReadersRequest,
  ): Promise<TelemetryFieldReaders> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          SCRUB_RULE_READERS_API_PATH,
        ),
        data: { ...request } as unknown as JSONObject,
        headers: { ...ModelAPI.getCommonHeaders() },
      });

    if (response instanceof HTTPErrorResponse) {
      throw new Error(API.getFriendlyMessage(response));
    }

    return readTelemetryFieldReaders(response.data);
  }
}
