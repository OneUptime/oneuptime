import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  readScrubRuleHidingAddresses,
  readScrubRulesHidingAddressesAnswer,
  SCRUB_RULE_HASH_INSTEAD_API_PATH,
  SCRUB_RULES_HIDING_ADDRESSES_API_PATH,
  ScrubRuleHashInsteadRequest,
  ScrubRuleHidingAddresses,
  ScrubRulesHidingAddressesAnswer,
} from "Common/Types/Telemetry/ScrubRuleAddresses";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The IP Address scrub rules that keep Security Events from naming an
 * attacker's address, and Hash Instead (#10396): the server's routes
 * (Server/API/ScrubRuleAddressesAPI), through the refresh-aware client with
 * the project's headers. Answers are read defensively: an answer that does
 * not say it was checked names no rule.
 */
export default class ScrubRuleAddressesApi {
  public static async getRulesHidingAddresses(): Promise<ScrubRulesHidingAddressesAnswer> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          SCRUB_RULES_HIDING_ADDRESSES_API_PATH,
        ),
        data: {},
        headers: { ...ModelAPI.getCommonHeaders() },
      });

    if (response instanceof HTTPErrorResponse) {
      throw new Error(API.getFriendlyMessage(response));
    }

    return readScrubRulesHidingAddressesAnswer(response.data);
  }

  // Hash Instead: the rule now hashes; throws, in the server's words, when it cannot.
  public static async hashInstead(
    request: ScrubRuleHashInsteadRequest,
  ): Promise<ScrubRuleHidingAddresses> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          SCRUB_RULE_HASH_INSTEAD_API_PATH,
        ),
        data: { ...request } as unknown as JSONObject,
        headers: { ...ModelAPI.getCommonHeaders() },
      });

    if (response instanceof HTTPErrorResponse) {
      throw new Error(API.getFriendlyMessage(response));
    }

    const rule: ScrubRuleHidingAddresses | null = readScrubRuleHidingAddresses(
      response.data,
    );

    if (!rule) {
      throw new Error(API.getFriendlyMessage(response));
    }

    return rule;
  }
}
