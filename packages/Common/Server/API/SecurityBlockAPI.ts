import SecurityBlock from "../../Models/DatabaseModels/SecurityBlock";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import {
  SECURITY_BLOCK_VALUE_MAX_LENGTH,
  SecurityBlockReach,
  isSecurityBlockReach,
  isWiderThanLargestRange,
} from "../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockHolder } from "../../Types/SecurityBlocklist/SecurityBlockHolders";
import { SecurityAddressProtection } from "../../Types/SecurityBlocklist/SecurityProtectedAddress";
import NetworkAddressBlockUtil from "../../Utils/NetworkTraffic/NetworkAddressBlock";
import UserMiddleware from "../Middleware/UserAuthorization";
import SecurityBlockService, {
  Service as SecurityBlockServiceType,
} from "../Services/SecurityBlockService";
import { resolveClientIp } from "../Utils/ClientIp";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SecurityBlockDestination from "../Utils/SecurityBlocklist/SecurityBlockDestination";
import SecurityBlockDestinations, {
  SecurityBlockDestinationsFound,
} from "../Utils/SecurityBlocklist/SecurityBlockDestinations";
import SecurityProtectedAddresses, {
  SecurityProtectionCheck,
} from "../Utils/SecurityBlocklist/SecurityProtectedAddresses";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * The blocklist (#10338): its CRUD - a block made with POST, lifted or
 * extended with PUT, never deleted - and
 *
 *   POST /security-block/check         what a block of a value would meet,
 *                                      asked before it is made: the value
 *                                      as it would be kept, what is wrong
 *                                      with it, the active block that covers
 *                                      it, what protects it, and whether it
 *                                      holds the address the caller is
 *                                      using right now
 *   POST /security-block/destinations  where the project's blocklist is
 *                                      enforced: none until a provider is
 *                                      connected, and the page says so
 *
 * Check takes the permission to block, as what it answers is what a block
 * would be told; Destinations the permission to read the blocklist.
 */

export const SECURITY_BLOCK_CHECK_ROUTE: string = "/security-block/check";
export const SECURITY_BLOCK_DESTINATIONS_ROUTE: string =
  "/security-block/destinations";

export const CHECK_REFUSED_MESSAGE: string =
  "Checking an address takes a role that can block addresses.";
export const DESTINATIONS_REFUSED_MESSAGE: string =
  "Reading where the blocklist is enforced takes a role that can read the blocklist.";

function protectionJson(protection: SecurityAddressProtection): JSONObject {
  return {
    source: protection.source,
    protectedValue: protection.protectedValue,
    ...(protection.name ? { name: protection.name } : {}),
    ...(protection.kind ? { kind: protection.kind } : {}),
    ...(protection.where ? { where: protection.where } : {}),
  };
}

export default class SecurityBlockAPI extends BaseAPI<
  SecurityBlock,
  SecurityBlockServiceType
> {
  public constructor() {
    super(SecurityBlock, SecurityBlockService);

    this.router.post(
      SECURITY_BLOCK_CHECK_ROUTE,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectPrincipal(props);

          CommonAPI.assertCanCreateTable({
            modelType: SecurityBlock,
            props,
            errorMessage: CHECK_REFUSED_MESSAGE,
          });

          const body: JSONObject =
            req.body && typeof req.body === "object" && !Array.isArray(req.body)
              ? (req.body as JSONObject)
              : {};

          const value: string =
            typeof body["value"] === "string"
              ? body["value"].slice(0, SECURITY_BLOCK_VALUE_MAX_LENGTH * 2)
              : "";

          // Where it would be enforced: an address everywhere is covered only by a block everywhere.
          const reach: SecurityBlockReach | undefined = isSecurityBlockReach(
            body["reach"],
          )
            ? body["reach"]
            : undefined;

          const check: Awaited<ReturnType<SecurityBlockServiceType["check"]>> =
            await SecurityBlockService.check({
              projectId,
              value,
              reach,
              props,
            });

          const protection: SecurityProtectionCheck | null = check.protection;

          /*
           * The address the caller is using right now, as the server sees it:
           * a block of it can lock them out of their own app.
           */
          const yourAddress: string | null =
            NetworkAddressBlockUtil.canonicalAddress(
              resolveClientIp(req) || "",
            );

          return Response.sendJsonObjectResponse(req, res, {
            value: check.value?.value || null,
            indicatorType: check.value?.indicatorType || null,
            problem: check.problem,
            isWiderThanLargestRange: check.value?.block
              ? isWiderThanLargestRange(check.value.block)
              : false,
            coveredBy: check.coveredBy
              ? {
                  _id: check.coveredBy.id?.toString() || null,
                  value: check.coveredBy.value || null,
                  action: check.coveredBy.action || null,
                  expiresAt: check.coveredBy.expiresAt
                    ? new Date(check.coveredBy.expiresAt).toISOString()
                    : null,
                }
              : null,
            protection: protection?.protection
              ? protectionJson(
                  SecurityProtectedAddresses.asSeenBy({
                    protection: protection.protection,
                    props,
                    projectId,
                  }),
                )
              : null,
            cannotTell: Boolean(
              protection &&
                !protection.protection &&
                protection.unreadSources.length > 0,
            ),
            isYourAddress: Boolean(
              yourAddress &&
                check.value?.block &&
                NetworkAddressBlockUtil.contains(
                  check.value.block,
                  yourAddress,
                ),
            ),
            yourAddress,
          });
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      SECURITY_BLOCK_DESTINATIONS_ROUTE,
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
            modelType: SecurityBlock,
            props,
            errorMessage: DESTINATIONS_REFUSED_MESSAGE,
          });

          const found: SecurityBlockDestinationsFound =
            await SecurityBlockDestinations.findForProject(projectId);
          const holders: Array<SecurityBlockHolder> =
            SecurityBlockDestinations.getHolders(found.destinations);

          return Response.sendJsonObjectResponse(req, res, {
            destinations: found.destinations.map(
              (destination: SecurityBlockDestination, index: number) => {
                const holder: SecurityBlockHolder | undefined = holders[index];

                return {
                  key: destination.key,
                  name: destination.name,
                  provider: destination.provider,
                  // What it can hold (#10346): what a case's plan offers as one click.
                  enforcesOnEveryMachine: Boolean(
                    holder?.enforcesOnEveryMachine,
                  ),
                  blocks: holder ? [...holder.blocks] : [],
                  quarantinesFiles: Boolean(holder?.quarantinesFiles),
                } as JSONObject;
              },
            ),
            // A kind of destination that could not be listed: the page cannot tell it has none.
            cannotTell: found.failedProviders.length > 0,
          });
        } catch (error) {
          next(error);
        }
      },
    );
  }
}
