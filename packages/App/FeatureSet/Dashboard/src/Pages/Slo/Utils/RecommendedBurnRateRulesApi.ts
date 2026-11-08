import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  SloRecommendedBurnRateRuleToAdd,
  parseSloRecommendedBurnRateRules,
} from "Common/Utils/Slo/SloRecommendedBurnRateRules";

/*
 * "Add recommended rules" on an SLO's Burn Rate Rules page, as the API
 * offers it (Common/Server/API/ServiceLevelObjectiveBurnRateRuleAPI):
 *
 *   - getMissing: the recommended rules the SLO does not have yet, scaled to
 *     its window, each with the severity it would raise at - what the
 *     confirmation lists. Nothing is written.
 *   - addMissing: adds them, only the ones still missing, and answers with
 *     what it added.
 *
 * A refusal throws the error response, whose message is the server's
 * sentence (API.getFriendlyMessage reads it).
 */
export const SLO_RECOMMENDED_BURN_RATE_RULES_PATH: string =
  "/service-level-objective-burn-rate-rule/recommended-rules";

export const SLO_ADD_RECOMMENDED_BURN_RATE_RULES_PATH: string =
  "/service-level-objective-burn-rate-rule/recommended-rules/add";

type PostFunction = (
  path: string,
  serviceLevelObjectiveId: ObjectID,
) => Promise<Array<SloRecommendedBurnRateRuleToAdd>>;

const post: PostFunction = async (
  path: string,
  serviceLevelObjectiveId: ObjectID,
): Promise<Array<SloRecommendedBurnRateRuleToAdd>> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(path),
      data: {
        serviceLevelObjectiveId: serviceLevelObjectiveId.toString(),
      },
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const body: JSONValue = response.data as JSONValue;

  return parseSloRecommendedBurnRateRules(
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)["rules"]
      : undefined,
  );
};

export default class RecommendedBurnRateRulesApi {
  public static async getMissing(
    serviceLevelObjectiveId: ObjectID,
  ): Promise<Array<SloRecommendedBurnRateRuleToAdd>> {
    return await post(
      SLO_RECOMMENDED_BURN_RATE_RULES_PATH,
      serviceLevelObjectiveId,
    );
  }

  public static async addMissing(
    serviceLevelObjectiveId: ObjectID,
  ): Promise<Array<SloRecommendedBurnRateRuleToAdd>> {
    return await post(
      SLO_ADD_RECOMMENDED_BURN_RATE_RULES_PATH,
      serviceLevelObjectiveId,
    );
  }
}
