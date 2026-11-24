import SecurityProtectedEntity from "../../Models/DatabaseModels/SecurityProtectedEntity";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import { SecurityAddressProtection } from "../../Types/SecurityBlocklist/SecurityProtectedAddress";
import UserMiddleware from "../Middleware/UserAuthorization";
import SecurityProtectedEntityService, {
  Service as SecurityProtectedEntityServiceType,
} from "../Services/SecurityProtectedEntityService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SecurityProtectedAddresses, {
  SecurityProtectedAddressGroup,
} from "../Utils/SecurityBlocklist/SecurityProtectedAddresses";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * Protected Entities: their CRUD - the users, hosts and addresses the
 * project's people protect - and
 *
 *   POST /security-protected-entity/automatic  the addresses OneUptime
 *                                              protects by itself (#10338):
 *                                              the project's hosts, nodes,
 *                                              cloud resources, devices,
 *                                              endpoints, named addresses
 *                                              and probes, OneUptime
 *                                              Cloud's probes, the ranges
 *                                              that are not on the internet
 *                                              and a connected edge's
 *
 * Read with the reader's own permissions: a kind of record they may not
 * read is listed as not read, never by its records (its addresses are
 * protected all the same). Takes the permission to read the list.
 */

export const AUTOMATIC_PROTECTIONS_ROUTE: string =
  "/security-protected-entity/automatic";

export const AUTOMATIC_PROTECTIONS_REFUSED_MESSAGE: string =
  "Reading what OneUptime protects takes a role that can read Protected Entities.";

export default class SecurityProtectedEntityAPI extends BaseAPI<
  SecurityProtectedEntity,
  SecurityProtectedEntityServiceType
> {
  public constructor() {
    super(SecurityProtectedEntity, SecurityProtectedEntityService);

    this.router.post(
      AUTOMATIC_PROTECTIONS_ROUTE,
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
            modelType: SecurityProtectedEntity,
            props,
            errorMessage: AUTOMATIC_PROTECTIONS_REFUSED_MESSAGE,
          });

          const groups: Array<SecurityProtectedAddressGroup> =
            await SecurityProtectedAddresses.listAutomaticProtections({
              projectId,
              props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            groups: groups.map(
              (group: SecurityProtectedAddressGroup): JSONObject => {
                return {
                  source: group.source,
                  hasMore: group.hasMore,
                  isRead: group.isRead,
                  protections: group.protections.map(
                    (protection: SecurityAddressProtection): JSONObject => {
                      return {
                        protectedValue: protection.protectedValue,
                        ...(protection.name ? { name: protection.name } : {}),
                        ...(protection.kind ? { kind: protection.kind } : {}),
                        ...(protection.where
                          ? { where: protection.where }
                          : {}),
                      };
                    },
                  ),
                };
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
