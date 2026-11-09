import ServiceLevelObjectiveBurnRateRule from "../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  SLO_RECOMMENDED_RULES_CREATE_REFUSAL_MESSAGE,
  SLO_RECOMMENDED_RULES_READ_REFUSAL_MESSAGE,
  SloRecommendedBurnRateRuleToAdd,
  sloRecommendedBurnRateRuleToJSON,
} from "../../Utils/Slo/SloRecommendedBurnRateRules";
import {
  SLO_BULK_NO_IDS_MESSAGE,
  SLO_BULK_TOO_MANY_MESSAGE,
  SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS,
  sloBulkRecommendedRulesResultToJSON,
} from "../../Utils/Slo/SloBulkRecommendedBurnRateRules";
import UserMiddleware from "../Middleware/UserAuthorization";
import ServiceLevelObjectiveBurnRateRuleService, {
  Service as ServiceLevelObjectiveBurnRateRuleServiceType,
  SloAddedRecommendedRule,
  SloAddedRecommendedRules,
  SloBulkAddedRecommendedRules,
  SloBulkMissingRecommendedRules,
  SloMissingRecommendedRule,
  SloMissingRecommendedRules,
} from "../Services/ServiceLevelObjectiveBurnRateRuleService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

// Beside the rule table's CRUD path, /service-level-objective-burn-rate-rule.
export const SLO_RECOMMENDED_BURN_RATE_RULES_ROUTE: string =
  "/recommended-rules";
export const SLO_ADD_RECOMMENDED_BURN_RATE_RULES_ROUTE: string =
  "/recommended-rules/add";
export const SLO_BULK_RECOMMENDED_BURN_RATE_RULES_ROUTE: string =
  "/recommended-rules/bulk";
export const SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_ROUTE: string =
  "/recommended-rules/bulk/add";

/*
 * SLO burn rate rules: their CRUD, and "Add recommended rules".
 *
 *   POST /service-level-objective-burn-rate-rule/recommended-rules
 *        { serviceLevelObjectiveId }  -> { rules }
 *        The recommended rules the SLO is missing, scaled to its window,
 *        with the severity each would raise at: what the Burn Rate Rules
 *        page's confirmation lists. Nothing is written.
 *
 *   POST /service-level-objective-burn-rate-rule/recommended-rules/add
 *        { serviceLevelObjectiveId }  -> { rules }
 *        Adds them - only the ones still missing - and answers with what it
 *        added. Asking again adds nothing.
 *
 * And the same for many SLOs at once, as the SLO list's Bulk Actions ask
 * (Common/Utils/Slo/SloBulkRecommendedBurnRateRules):
 *
 *   POST /service-level-objective-burn-rate-rule/recommended-rules/bulk
 *        { serviceLevelObjectiveIds }  -> { results }
 *        What each SLO is missing: Missing, with the rules, NothingMissing,
 *        or Refused for one the caller may not read. Nothing is written.
 *
 *   POST /service-level-objective-burn-rate-rule/recommended-rules/bulk/add
 *        { serviceLevelObjectiveIds }  -> { results }
 *        Adds what each SLO is missing, one SLO after another, through the
 *        per-SLO add: Added, with the rules, NothingMissing, Refused, or
 *        Failed, with the rules added before it failed. One SLO's refusal
 *        or failure never stops the next.
 *
 * Each bulk request names between one and
 * SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS SLOs, and is answered in
 * the order it named them, each once.
 *
 * All four take what the CRUD endpoint for the same work takes: reading the
 * rules to see what is missing, creating rules to add them, from a person or
 * an API key of the project. The SLO is read as the caller, so one they may
 * not read is not found, and each rule is created as the caller, through the
 * same create a rule made by hand goes through (addMissingRecommendedRules).
 */
export default class ServiceLevelObjectiveBurnRateRuleAPI extends BaseAPI<
  ServiceLevelObjectiveBurnRateRule,
  ServiceLevelObjectiveBurnRateRuleServiceType
> {
  public constructor() {
    super(
      ServiceLevelObjectiveBurnRateRule,
      ServiceLevelObjectiveBurnRateRuleService,
    );

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    this.router.post(
      `${basePath}${SLO_RECOMMENDED_BURN_RATE_RULES_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertAuthenticatedProjectPrincipal(props);

          CommonAPI.assertCanReadTable({
            modelType: ServiceLevelObjectiveBurnRateRule,
            props,
            errorMessage: SLO_RECOMMENDED_RULES_READ_REFUSAL_MESSAGE,
          });

          const missing: SloMissingRecommendedRules =
            await this.service.getMissingRecommendedRules({
              serviceLevelObjectiveId: readServiceLevelObjectiveId(req.body),
              props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            rules: missing.rules.map(
              (rule: SloMissingRecommendedRule): JSONObject => {
                return sloRecommendedBurnRateRuleToJSON(toRuleToAdd(rule));
              },
            ),
          });
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}${SLO_ADD_RECOMMENDED_BURN_RATE_RULES_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertAuthenticatedProjectPrincipal(props);

          /*
           * Up front, so a caller who may not create rules is refused before
           * anything is read; each create checks the same permission again.
           */
          CommonAPI.assertCanCreateTable({
            modelType: ServiceLevelObjectiveBurnRateRule,
            props,
            errorMessage: SLO_RECOMMENDED_RULES_CREATE_REFUSAL_MESSAGE,
          });

          const added: SloAddedRecommendedRules =
            await this.service.addMissingRecommendedRules({
              serviceLevelObjectiveId: readServiceLevelObjectiveId(req.body),
              props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            rules: added.rules.map(
              (rule: SloAddedRecommendedRule): JSONObject => {
                return sloRecommendedBurnRateRuleToJSON({
                  ...toRuleToAdd(rule),
                  id: rule.ruleId?.toString() || undefined,
                });
              },
            ),
          });
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}${SLO_BULK_RECOMMENDED_BURN_RATE_RULES_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertAuthenticatedProjectPrincipal(props);

          CommonAPI.assertCanReadTable({
            modelType: ServiceLevelObjectiveBurnRateRule,
            props,
            errorMessage: SLO_RECOMMENDED_RULES_READ_REFUSAL_MESSAGE,
          });

          const results: Array<SloBulkMissingRecommendedRules> =
            await this.service.getMissingRecommendedRulesForMany({
              serviceLevelObjectiveIds: readServiceLevelObjectiveIds(req.body),
              props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            results: results.map(
              (result: SloBulkMissingRecommendedRules): JSONObject => {
                return sloBulkRecommendedRulesResultToJSON({
                  serviceLevelObjectiveId:
                    result.serviceLevelObjectiveId.toString(),
                  status: result.status,
                  rules: result.rules.map(toRuleToAdd),
                  message: result.message,
                });
              },
            ),
          });
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}${SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertAuthenticatedProjectPrincipal(props);

          // Up front, as the one-SLO add: each create checks it again.
          CommonAPI.assertCanCreateTable({
            modelType: ServiceLevelObjectiveBurnRateRule,
            props,
            errorMessage: SLO_RECOMMENDED_RULES_CREATE_REFUSAL_MESSAGE,
          });

          const results: Array<SloBulkAddedRecommendedRules> =
            await this.service.addMissingRecommendedRulesToMany({
              serviceLevelObjectiveIds: readServiceLevelObjectiveIds(req.body),
              props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            results: results.map(
              (result: SloBulkAddedRecommendedRules): JSONObject => {
                return sloBulkRecommendedRulesResultToJSON({
                  serviceLevelObjectiveId:
                    result.serviceLevelObjectiveId.toString(),
                  status: result.status,
                  rules: result.rules.map(
                    (
                      rule: SloAddedRecommendedRule,
                    ): SloRecommendedBurnRateRuleToAdd => {
                      return {
                        ...toRuleToAdd(rule),
                        id: rule.ruleId?.toString() || undefined,
                      };
                    },
                  ),
                  message: result.message,
                });
              },
            ),
          });
        } catch (error) {
          next(error);
        }
      },
    );
  }
}

/*
 * The SLOs a bulk request names, each once, in the order first named; a 400
 * for anything that is not a list of between one and
 * SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS SLO ids. The list is counted
 * as sent, before repeats are dropped.
 */
export function readServiceLevelObjectiveIds(body: unknown): Array<ObjectID> {
  const value: JSONValue | undefined =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)["serviceLevelObjectiveIds"]
      : undefined;

  if (!Array.isArray(value) || value.length === 0) {
    throw new BadDataException(SLO_BULK_NO_IDS_MESSAGE);
  }

  if (value.length > SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS) {
    throw new BadDataException(SLO_BULK_TOO_MANY_MESSAGE);
  }

  const ids: Array<ObjectID> = [];
  const seen: Set<string> = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string" || !ObjectID.isValidUUID(entry.trim())) {
      throw new BadDataException(SLO_BULK_NO_IDS_MESSAGE);
    }

    const id: string = entry.trim();
    const key: string = id.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    ids.push(new ObjectID(id));
  }

  return ids;
}

// The SLO a request names, as an id; a 400 for anything else.
export function readServiceLevelObjectiveId(body: unknown): ObjectID {
  const value: JSONValue | undefined =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)["serviceLevelObjectiveId"]
      : undefined;

  if (typeof value !== "string" || !ObjectID.isValidUUID(value.trim())) {
    throw new BadDataException(
      "serviceLevelObjectiveId must be the ID of a Service Level Objective.",
    );
  }

  return new ObjectID(value.trim());
}

function toRuleToAdd(
  rule: SloMissingRecommendedRule,
): SloRecommendedBurnRateRuleToAdd {
  return {
    ...rule.recommended,
    alertSeverityName: rule.alertSeverity?.name?.trim() || null,
  };
}
