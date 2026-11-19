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
import { SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS } from "Common/Utils/Slo/SloBulkRecommendedBurnRateRules";
import {
  SloBulkRecommendedPolicyResult,
  parseSloBulkRecommendedPolicyResults,
} from "Common/Utils/Slo/SloBulkRecommendedPolicy";

/*
 * "Use the recommended policy" on an SLO's Error Budget Policy page, as the
 * API offers it (Common/Server/API/ServiceLevelObjectiveErrorBudgetPolicyTierAPI):
 *
 *   - getMissing: the recommended tiers the SLO does not have yet - what the
 *     confirmation lists. Nothing is written.
 *   - addMissing: adds them, only the ones still missing, and answers with
 *     what it added.
 *
 * And on the SLO list, for many SLOs at once (its Bulk Actions, #6358):
 *
 *   - getMissingForMany: what each SLO would get, for the confirmation.
 *   - addMissingToMany: adds it, and says what happened to each.
 *
 * Both ask about at most SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS SLOs
 * a request, and ask in turn for more: one result per SLO, in the order
 * given.
 *
 * A refusal throws the error response, whose message is the server's
 * sentence (API.getFriendlyMessage reads it).
 */
export const SLO_RECOMMENDED_POLICY_PATH: string =
  "/service-level-objective-error-budget-policy-tier/recommended-policy";

export const SLO_ADD_RECOMMENDED_POLICY_PATH: string =
  "/service-level-objective-error-budget-policy-tier/recommended-policy/add";

export const SLO_BULK_RECOMMENDED_POLICY_PATH: string =
  "/service-level-objective-error-budget-policy-tier/recommended-policy/bulk";

export const SLO_BULK_ADD_RECOMMENDED_POLICY_PATH: string =
  "/service-level-objective-error-budget-policy-tier/recommended-policy/bulk/add";

type PostJsonFunction = (path: string, data: JSONObject) => Promise<JSONValue>;

const postJson: PostJsonFunction = async (
  path: string,
  data: JSONObject,
): Promise<JSONValue> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(path),
      data: data,
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response.data as JSONValue;
};

type ReadKeyFunction = (body: JSONValue, key: string) => JSONValue | undefined;

const readKey: ReadKeyFunction = (
  body: JSONValue,
  key: string,
): JSONValue | undefined => {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as JSONObject)[key]
    : undefined;
};

type PostFunction = (
  path: string,
  serviceLevelObjectiveId: ObjectID,
) => Promise<Array<SloRecommendedPolicyTierToAdd>>;

const post: PostFunction = async (
  path: string,
  serviceLevelObjectiveId: ObjectID,
): Promise<Array<SloRecommendedPolicyTierToAdd>> => {
  const body: JSONValue = await postJson(path, {
    serviceLevelObjectiveId: serviceLevelObjectiveId.toString(),
  });

  return parseSloRecommendedPolicyTiers(readKey(body, "tiers"));
};

type PostManyFunction = (
  path: string,
  serviceLevelObjectiveIds: Array<ObjectID>,
) => Promise<Array<SloBulkRecommendedPolicyResult>>;

// In requests of at most the server's cap, one after another.
const postMany: PostManyFunction = async (
  path: string,
  serviceLevelObjectiveIds: Array<ObjectID>,
): Promise<Array<SloBulkRecommendedPolicyResult>> => {
  const results: Array<SloBulkRecommendedPolicyResult> = [];

  for (
    let start: number = 0;
    start < serviceLevelObjectiveIds.length;
    start += SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS
  ) {
    const ids: Array<ObjectID> = serviceLevelObjectiveIds.slice(
      start,
      start + SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS,
    );

    const body: JSONValue = await postJson(path, {
      serviceLevelObjectiveIds: ids.map((id: ObjectID): string => {
        return id.toString();
      }),
    });

    results.push(
      ...parseSloBulkRecommendedPolicyResults(readKey(body, "results")),
    );
  }

  return results;
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

  public static async getMissingForMany(
    serviceLevelObjectiveIds: Array<ObjectID>,
  ): Promise<Array<SloBulkRecommendedPolicyResult>> {
    return await postMany(
      SLO_BULK_RECOMMENDED_POLICY_PATH,
      serviceLevelObjectiveIds,
    );
  }

  public static async addMissingToMany(
    serviceLevelObjectiveIds: Array<ObjectID>,
  ): Promise<Array<SloBulkRecommendedPolicyResult>> {
    return await postMany(
      SLO_BULK_ADD_RECOMMENDED_POLICY_PATH,
      serviceLevelObjectiveIds,
    );
  }
}
