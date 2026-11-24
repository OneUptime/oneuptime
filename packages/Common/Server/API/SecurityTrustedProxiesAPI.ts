import UserMiddleware from "../Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import Response from "../Utils/Response";
import SecurityEdgeRanges, {
  SecurityEdge,
} from "../Utils/SecurityBlocklist/SecurityEdgeRanges";
import SecurityOwnLoadBalancers, {
  SecurityOwnLoadBalancer,
  SecurityOwnLoadBalancersRead,
} from "../Utils/SecurityEvent/SecurityOwnLoadBalancers";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import {
  AUTOMATIC_TRUSTED_PROXIES_PATH,
  AutomaticTrustedEdge,
  AutomaticTrustedLoadBalancer,
  AutomaticTrustedProxies,
  automaticTrustedProxiesToJSON,
} from "../../Types/SecurityEvent/AutomaticTrustedProxies";

/*
 * POST /security-trusted-proxies/automatic (#10546): what Security Events
 * trusts as a proxy without being told, for Trusted Proxies to show beside
 * the list a person writes, each with why:
 *
 *   - the edges the project connected, by name, with how many ranges each
 *     publishes (SecurityEdgeRanges);
 *   - the project's own application load balancers, each named with its
 *     kind, the cloud account it is in and its public addresses
 *     (SecurityOwnLoadBalancers), whether or not the project trusts them
 *     now: the switch beside them says that (Project
 *     .securityTrustOwnLoadBalancers), and the page reads it as it reads
 *     the rest of the project.
 *
 * A signed-in member of the project in the tenantid header. The load
 * balancers are read as the caller reads: one who may not read cloud
 * resources is told none of them, only that they could not be listed
 * (areLoadBalancersRead), as is a read that failed. A read only, which
 * writes nothing and reads no body.
 *
 * A bare router, as ProjectCanSendAPI is: it reads no single model's CRUD
 * routes.
 */

const router: ExpressRouter = Express.getRouter();

// The connected edges, each with how many ranges it publishes; none when they cannot be read.
async function readEdges(
  projectId: ObjectID,
): Promise<Array<AutomaticTrustedEdge>> {
  try {
    const edges: Array<SecurityEdge> =
      await SecurityEdgeRanges.findConnectedEdges(projectId);
    const listed: Array<AutomaticTrustedEdge> = [];

    for (const edge of edges) {
      listed.push({
        name: edge.name,
        rangeCount: (await SecurityEdgeRanges.getRanges(edge)).length,
      });
    }

    return listed;
  } catch (error) {
    logger.warn(
      `SecurityTrustedProxiesAPI: could not list the edges project ${projectId.toString()} sits behind. ${String(error)}`,
    );

    return [];
  }
}

router.post(
  AUTOMATIC_TRUSTED_PROXIES_PATH,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      let loadBalancers: Array<AutomaticTrustedLoadBalancer> = [];
      let areLoadBalancersRead: boolean = true;
      let areLoadBalancersComplete: boolean = true;

      try {
        const read: SecurityOwnLoadBalancersRead =
          await SecurityOwnLoadBalancers.read({ projectId, props });

        loadBalancers = read.loadBalancers.map(
          (
            loadBalancer: SecurityOwnLoadBalancer,
          ): AutomaticTrustedLoadBalancer => {
            return {
              kind: loadBalancer.kind,
              name: loadBalancer.name,
              where: loadBalancer.where,
              addresses: loadBalancer.addresses,
            };
          },
        );
        areLoadBalancersComplete = read.isComplete;
      } catch (error) {
        logger.debug(
          `SecurityTrustedProxiesAPI: could not list the load balancers of project ${projectId.toString()} for this reader. ${String(error)}`,
        );
        areLoadBalancersRead = false;
      }

      const proxies: AutomaticTrustedProxies = {
        edges: await readEdges(projectId),
        loadBalancers,
        areLoadBalancersRead,
        areLoadBalancersComplete,
      };

      Response.setNoCacheHeaders(res);

      return Response.sendJsonObjectResponse(
        req,
        res,
        automaticTrustedProxiesToJSON(proxies),
      );
    } catch (error) {
      next(error);
    }
  },
);

export default router;
