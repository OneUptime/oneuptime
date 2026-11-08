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
import {
  SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS,
  SloBulkRecommendedRulesResult,
  parseSloBulkRecommendedRulesResults,
} from "Common/Utils/Slo/SloBulkRecommendedBurnRateRules";

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
 * And on the SLO list, for many SLOs at once (its Bulk Actions):
 *
 *   - getMissingForMany: what each SLO is missing, for the confirmation.
 *   - addMissingToMany: adds what each is missing, and says what happened
 *     to each.
 *
 * Both ask about at most SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS SLOs
 * a request, and ask in turn for more: one result per SLO, in the order
 * given.
 *
 * A refusal throws the error response, whose message is the server's
 * sentence (API.getFriendlyMessage reads it).
 */
export const SLO_RECOMMENDED_BURN_RATE_RULES_PATH: string =
  "/service-level-objective-burn-rate-rule/recommended-rules";

export const SLO_ADD_RECOMMENDED_BURN_RATE_RULES_PATH: string =
  "/service-level-objective-burn-rate-rule/recommended-rules/add";

export const SLO_BULK_RECOMMENDED_BURN_RATE_RULES_PATH: string =
  "/service-level-objective-burn-rate-rule/recommended-rules/bulk";

export const SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_PATH: string =
  "/service-level-objective-burn-rate-rule/recommended-rules/bulk/add";

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
) => Promise<Array<SloRecommendedBurnRateRuleToAdd>>;

const post: PostFunction = async (
  path: string,
  serviceLevelObjectiveId: ObjectID,
): Promise<Array<SloRecommendedBurnRateRuleToAdd>> => {
  const body: JSONValue = await postJson(path, {
    serviceLevelObjectiveId: serviceLevelObjectiveId.toString(),
  });

  return parseSloRecommendedBurnRateRules(readKey(body, "rules"));
};

type PostManyFunction = (
  path: string,
  serviceLevelObjectiveIds: Array<ObjectID>,
) => Promise<Array<SloBulkRecommendedRulesResult>>;

// In requests of at most the server's cap, one after another.
const postMany: PostManyFunction = async (
  path: string,
  serviceLevelObjectiveIds: Array<ObjectID>,
): Promise<Array<SloBulkRecommendedRulesResult>> => {
  const results: Array<SloBulkRecommendedRulesResult> = [];

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
      ...parseSloBulkRecommendedRulesResults(readKey(body, "results")),
    );
  }

  return results;
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

  public static async getMissingForMany(
    serviceLevelObjectiveIds: Array<ObjectID>,
  ): Promise<Array<SloBulkRecommendedRulesResult>> {
    return await postMany(
      SLO_BULK_RECOMMENDED_BURN_RATE_RULES_PATH,
      serviceLevelObjectiveIds,
    );
  }

  public static async addMissingToMany(
    serviceLevelObjectiveIds: Array<ObjectID>,
  ): Promise<Array<SloBulkRecommendedRulesResult>> {
    return await postMany(
      SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_PATH,
      serviceLevelObjectiveIds,
    );
  }
}
