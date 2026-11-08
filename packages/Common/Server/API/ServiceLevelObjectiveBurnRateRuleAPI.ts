import ServiceLevelObjectiveBurnRateRule from "../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  SloRecommendedBurnRateRuleToAdd,
  sloRecommendedBurnRateRuleToJSON,
} from "../../Utils/Slo/SloRecommendedBurnRateRules";
import UserMiddleware from "../Middleware/UserAuthorization";
import ServiceLevelObjectiveBurnRateRuleService, {
  Service as ServiceLevelObjectiveBurnRateRuleServiceType,
  SloAddedRecommendedRule,
  SloAddedRecommendedRules,
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
 * Both take what the CRUD endpoint for the same work takes: reading the
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
            errorMessage:
              "Seeing which recommended burn rate rules an SLO is missing takes a role that can read SLO burn rate rules.",
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
            errorMessage:
              "Adding the recommended burn rate rules takes a role that can create SLO burn rate rules.",
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
  }
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
