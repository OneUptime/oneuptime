import SecurityAutomaticResponsePolicy from "../../Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import UserMiddleware from "../Middleware/UserAuthorization";
import SecurityAutomaticResponsePolicyService, {
  Service as SecurityAutomaticResponsePolicyServiceType,
} from "../Services/SecurityAutomaticResponsePolicyService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SecurityAutomaticResponseOverview from "../Utils/SecurityAutomaticResponse/SecurityAutomaticResponseOverview";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * Automatic response policies (#10350): their CRUD - the ready ones made by
 * OneUptime and switched on as they are, a project's own made from the
 * blank one - and
 *
 *   POST /security-automatic-response-policy/overview
 *       every policy of the project, the ready ones made Off the first time
 *       they are read, with where its trial run stands and what it would
 *       have done, its time to block, what it did in the last week and the
 *       rules it acts on; the blocklist's destinations and whether each can
 *       challenge; and the hour's automatic blocks so far.
 *
 * The overview takes the permission to read the policies.
 */

export const SECURITY_AUTOMATIC_RESPONSE_OVERVIEW_ROUTE: string =
  "/security-automatic-response-policy/overview";

export const OVERVIEW_REFUSED_MESSAGE: string =
  "Reading automatic response policies takes a role that can read playbooks.";

export default class SecurityAutomaticResponsePolicyAPI extends BaseAPI<
  SecurityAutomaticResponsePolicy,
  SecurityAutomaticResponsePolicyServiceType
> {
  public constructor() {
    super(
      SecurityAutomaticResponsePolicy,
      SecurityAutomaticResponsePolicyService,
    );

    this.router.post(
      SECURITY_AUTOMATIC_RESPONSE_OVERVIEW_ROUTE,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectPrincipal(props);

          CommonAPI.assertCanReadTable({
            modelType: SecurityAutomaticResponsePolicy,
            props,
            errorMessage: OVERVIEW_REFUSED_MESSAGE,
          });

          const overview: JSONObject =
            await SecurityAutomaticResponseOverview.read({ projectId, props });

          return Response.sendJsonObjectResponse(req, res, overview);
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
