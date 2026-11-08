import ServiceLevelObjectiveErrorBudgetPolicyTier from "../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import {
  SloRecommendedPolicyTier,
  sloRecommendedPolicyTierToJSON,
} from "../../Utils/Slo/SloErrorBudgetPolicy";
import UserMiddleware from "../Middleware/UserAuthorization";
import ServiceLevelObjectiveErrorBudgetPolicyTierService, {
  Service as ServiceLevelObjectiveErrorBudgetPolicyTierServiceType,
  SloAddedRecommendedPolicyTier,
  SloAddedRecommendedPolicyTiers,
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
import { readServiceLevelObjectiveId } from "./ServiceLevelObjectiveBurnRateRuleAPI";

// Beside the tier table's CRUD path, /service-level-objective-error-budget-policy-tier.
export const SLO_RECOMMENDED_POLICY_ROUTE: string = "/recommended-policy";
export const SLO_ADD_RECOMMENDED_POLICY_ROUTE: string =
  "/recommended-policy/add";

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
 * Both take what the CRUD endpoint for the same work takes: reading tiers to
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
            errorMessage:
              "Seeing which recommended error budget policy tiers an SLO is missing takes a role that can read SLO error budget policy tiers.",
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
            errorMessage:
              "Using the recommended error budget policy takes a role that can create SLO error budget policy tiers.",
          });

          const added: SloAddedRecommendedPolicyTiers =
            await this.service.addMissingRecommendedTiers({
              serviceLevelObjectiveId: readServiceLevelObjectiveId(req.body),
              props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            tiers: added.tiers.map(
              (tier: SloAddedRecommendedPolicyTier): JSONObject => {
                return sloRecommendedPolicyTierToJSON({
                  name: tier.name,
                  thresholdPercentage: tier.thresholdPercentage,
                  whatWeDo: tier.whatWeDo,
                  id: tier.tierId?.toString() || undefined,
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
