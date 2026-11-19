import ServiceLevelObjectiveErrorBudgetPolicyTier from "../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import {
  SloRecommendedPolicyTier,
  SloRecommendedPolicyTierToAdd,
  sloRecommendedPolicyTierToJSON,
} from "../../Utils/Slo/SloErrorBudgetPolicy";
import { sloBulkRecommendedPolicyResultToJSON } from "../../Utils/Slo/SloBulkRecommendedPolicy";
import UserMiddleware from "../Middleware/UserAuthorization";
import ServiceLevelObjectiveErrorBudgetPolicyTierService, {
  Service as ServiceLevelObjectiveErrorBudgetPolicyTierServiceType,
  SloAddedRecommendedPolicyTier,
  SloAddedRecommendedPolicyTiers,
  SloBulkAddedRecommendedPolicy,
  SloBulkMissingRecommendedPolicy,
  SloMissingRecommendedPolicyTiers,
} from "../Services/ServiceLevelObjectiveErrorBudgetPolicyTierService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import {
  readServiceLevelObjectiveId,
  readServiceLevelObjectiveIds,
} from "./ServiceLevelObjectiveBurnRateRuleAPI";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import ProductKey from "../../Types/Product/ProductKey";

// Beside the tier table's CRUD path, /service-level-objective-error-budget-policy-tier.
export const SLO_RECOMMENDED_POLICY_ROUTE: string = "/recommended-policy";
export const SLO_ADD_RECOMMENDED_POLICY_ROUTE: string =
  "/recommended-policy/add";
export const SLO_BULK_RECOMMENDED_POLICY_ROUTE: string =
  "/recommended-policy/bulk";
export const SLO_BULK_ADD_RECOMMENDED_POLICY_ROUTE: string =
  "/recommended-policy/bulk/add";

// The refusals of the routes, by what they take.
export const SLO_RECOMMENDED_POLICY_READ_REFUSAL_MESSAGE: string =
  "Seeing which recommended error budget policy tiers an SLO is missing takes a role that can read SLO error budget policy tiers.";
export const SLO_RECOMMENDED_POLICY_CREATE_REFUSAL_MESSAGE: string =
  "Using the recommended error budget policy takes a role that can create SLO error budget policy tiers.";

/*
 * The tiers of an SLO's error budget policy: their CRUD, and "Use the
 * recommended policy" - the same starter-and-confirmation pair as a burn
 * rate rule's "Add recommended rules".
 *
 *   POST /service-level-objective-error-budget-policy-tier/recommended-policy
 *        { serviceLevelObjectiveId }  -> { tiers }
 *        The recommended tiers the SLO is missing: what the Error Budget
 *        Policy page's confirmation lists. Nothing is written.
 *
 *   POST /service-level-objective-error-budget-policy-tier/recommended-policy/add
 *        { serviceLevelObjectiveId }  -> { tiers }
 *        Adds them - only the ones still missing - and answers with what it
 *        added. Asking again adds nothing.
 *
 * And the same for many SLOs at once, as the SLO list's Bulk Actions ask
 * (Common/Utils/Slo/SloBulkRecommendedPolicy, #6358):
 *
 *   POST /service-level-objective-error-budget-policy-tier/recommended-policy/bulk
 *        { serviceLevelObjectiveIds }  -> { results }
 *        What each SLO would get: Missing, with the tiers, NothingMissing,
 *        OwnPolicy for one with a policy of its own, or Refused for one the
 *        caller may not read. Nothing is written.
 *
 *   POST /service-level-objective-error-budget-policy-tier/recommended-policy/bulk/add
 *        { serviceLevelObjectiveIds }  -> { results }
 *        Adds what each SLO is missing, one SLO after another, through the
 *        per-SLO add: Added, with the tiers, NothingMissing, OwnPolicy,
 *        Refused, or Failed. One SLO's refusal or failure never stops the
 *        next.
 *
 * Each bulk request names between one and
 * SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS SLOs, as Add recommended
 * rules' does, and is answered in the order it named them, each once.
 *
 * All four take what the CRUD endpoint for the same work takes: reading tiers to
 * see what is missing, creating tiers to add them, from a person or an API
 * key of the project. The SLO is read as the caller, and each tier is created
 * as the caller (addMissingRecommendedTiers).
 */
export default class ServiceLevelObjectiveErrorBudgetPolicyTierAPI extends BaseAPI<
  ServiceLevelObjectiveErrorBudgetPolicyTier,
  ServiceLevelObjectiveErrorBudgetPolicyTierServiceType
> {
  public constructor() {
    super(
      ServiceLevelObjectiveErrorBudgetPolicyTier,
      ServiceLevelObjectiveErrorBudgetPolicyTierService,
    );

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    this.router.post(
      `${basePath}${SLO_RECOMMENDED_POLICY_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertAuthenticatedProjectPrincipal(props);

          CommonAPI.assertCanReadTable({
            modelType: ServiceLevelObjectiveErrorBudgetPolicyTier,
            props,
            errorMessage: SLO_RECOMMENDED_POLICY_READ_REFUSAL_MESSAGE,
          });

          const missing: SloMissingRecommendedPolicyTiers =
            await this.service.getMissingRecommendedTiers({
              serviceLevelObjectiveId: readServiceLevelObjectiveId(req.body),
              props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            tiers: missing.tiers.map(
              (tier: SloRecommendedPolicyTier): JSONObject => {
                return sloRecommendedPolicyTierToJSON(tier);
              },
            ),
          });
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}${SLO_ADD_RECOMMENDED_POLICY_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      ServerProductRoutes.refuseWhileOff(ProductKey.Slos),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertAuthenticatedProjectPrincipal(props);

          /*
           * Up front, so a caller who may not create tiers is refused before
           * anything is read; each create checks the same permission again.
           */
          CommonAPI.assertCanCreateTable({
            modelType: ServiceLevelObjectiveErrorBudgetPolicyTier,
            props,
            errorMessage: SLO_RECOMMENDED_POLICY_CREATE_REFUSAL_MESSAGE,
          });

          const added: SloAddedRecommendedPolicyTiers =
            await this.service.addMissingRecommendedTiers({
              serviceLevelObjectiveId: readServiceLevelObjectiveId(req.body),
              props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            tiers: added.tiers.map(
              (tier: SloAddedRecommendedPolicyTier): JSONObject => {
                return sloRecommendedPolicyTierToJSON(toTierAdded(tier));
              },
            ),
          });
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}${SLO_BULK_RECOMMENDED_POLICY_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertAuthenticatedProjectPrincipal(props);

          CommonAPI.assertCanReadTable({
            modelType: ServiceLevelObjectiveErrorBudgetPolicyTier,
            props,
            errorMessage: SLO_RECOMMENDED_POLICY_READ_REFUSAL_MESSAGE,
          });

          const results: Array<SloBulkMissingRecommendedPolicy> =
            await this.service.getMissingRecommendedTiersForMany({
              serviceLevelObjectiveIds: readServiceLevelObjectiveIds(req.body),
              props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            results: results.map(
              (result: SloBulkMissingRecommendedPolicy): JSONObject => {
                return sloBulkRecommendedPolicyResultToJSON({
                  serviceLevelObjectiveId:
                    result.serviceLevelObjectiveId.toString(),
                  status: result.status,
                  tiers: result.tiers,
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
      `${basePath}${SLO_BULK_ADD_RECOMMENDED_POLICY_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      ServerProductRoutes.refuseWhileOff(ProductKey.Slos),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertAuthenticatedProjectPrincipal(props);

          // Up front, as the one-SLO add: each create checks it again.
          CommonAPI.assertCanCreateTable({
            modelType: ServiceLevelObjectiveErrorBudgetPolicyTier,
            props,
            errorMessage: SLO_RECOMMENDED_POLICY_CREATE_REFUSAL_MESSAGE,
          });

          const results: Array<SloBulkAddedRecommendedPolicy> =
            await this.service.addMissingRecommendedTiersToMany({
              serviceLevelObjectiveIds: readServiceLevelObjectiveIds(req.body),
              props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            results: results.map(
              (result: SloBulkAddedRecommendedPolicy): JSONObject => {
                return sloBulkRecommendedPolicyResultToJSON({
                  serviceLevelObjectiveId:
                    result.serviceLevelObjectiveId.toString(),
                  status: result.status,
                  tiers: result.tiers.map(toTierAdded),
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

// A tier a request added, as the API answers with it: with its new id.
function toTierAdded(
  tier: SloAddedRecommendedPolicyTier,
): SloRecommendedPolicyTierToAdd {
  return {
    name: tier.name,
    thresholdPercentage: tier.thresholdPercentage,
    whatWeDo: tier.whatWeDo,
    freezesDeployments: tier.freezesDeployments,
    id: tier.tierId?.toString() || undefined,
  };
}
