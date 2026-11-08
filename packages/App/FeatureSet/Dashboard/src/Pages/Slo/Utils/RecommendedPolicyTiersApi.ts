import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  SloRecommendedPolicyTierToAdd,
  parseSloRecommendedPolicyTiers,
} from "Common/Utils/Slo/SloErrorBudgetPolicy";

/*
 * "Use the recommended policy" on an SLO's Error Budget Policy page, as the
 * API offers it (Common/Server/API/ServiceLevelObjectiveErrorBudgetPolicyTierAPI):
 *
 *   - getMissing: the recommended tiers the SLO does not have yet - what the
 *     confirmation lists. Nothing is written.
 *   - addMissing: adds them, only the ones still missing, and answers with
 *     what it added.
 *
 * A refusal throws the error response, whose message is the server's
 * sentence (API.getFriendlyMessage reads it).
 */
export const SLO_RECOMMENDED_POLICY_PATH: string =
  "/service-level-objective-error-budget-policy-tier/recommended-policy";

export const SLO_ADD_RECOMMENDED_POLICY_PATH: string =
  "/service-level-objective-error-budget-policy-tier/recommended-policy/add";

type PostFunction = (
  path: string,
  serviceLevelObjectiveId: ObjectID,
) => Promise<Array<SloRecommendedPolicyTierToAdd>>;

const post: PostFunction = async (
  path: string,
  serviceLevelObjectiveId: ObjectID,
): Promise<Array<SloRecommendedPolicyTierToAdd>> => {
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

  return parseSloRecommendedPolicyTiers(
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)["tiers"]
      : undefined,
  );
};

export default class RecommendedPolicyTiersApi {
  public static async getMissing(
    serviceLevelObjectiveId: ObjectID,
  ): Promise<Array<SloRecommendedPolicyTierToAdd>> {
    return await post(SLO_RECOMMENDED_POLICY_PATH, serviceLevelObjectiveId);
  }

  public static async addMissing(
    serviceLevelObjectiveId: ObjectID,
  ): Promise<Array<SloRecommendedPolicyTierToAdd>> {
    return await post(SLO_ADD_RECOMMENDED_POLICY_PATH, serviceLevelObjectiveId);
  }
}
