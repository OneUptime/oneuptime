import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  readScrubRuleValueCountsAnswer,
  SCRUB_RULE_VALUE_COUNTS_API_PATH,
  ScrubRuleValueCountsAnswer,
  ScrubRuleValueCountSignal,
} from "Common/Types/Telemetry/ScrubRuleValueCounts";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * How many values each scrub rule on a list's page changed in the last
 * week, by service and version (#10366): the server's route
 * (Server/API/ScrubRuleValueCountsAPI), through the refresh-aware client
 * with the project's headers, read defensively.
 */
export default class ScrubRuleValueCountsApi {
  public static async getCounts(data: {
    signal: ScrubRuleValueCountSignal;
    scrubRuleIds: Array<string>;
  }): Promise<ScrubRuleValueCountsAnswer> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          SCRUB_RULE_VALUE_COUNTS_API_PATH,
        ),
        data: {
          signal: data.signal,
          scrubRuleIds: data.scrubRuleIds,
        } as unknown as JSONObject,
        headers: { ...ModelAPI.getCommonHeaders() },
      });

    if (response instanceof HTTPErrorResponse) {
      throw new Error(API.getFriendlyMessage(response));
    }

    return readScrubRuleValueCountsAnswer(response.data);
  }
}
