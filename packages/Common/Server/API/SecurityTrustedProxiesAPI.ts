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
import SecurityLogLineCheckReader from "../Utils/SecurityEvent/SecurityLogLineCheck";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import CommonAPI from "./CommonAPI";
import SecurityEvent from "../../Models/AnalyticsModels/SecurityEvent";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import {
  AUTOMATIC_TRUSTED_PROXIES_PATH,
  AutomaticPassOnLoadBalancer,
  AutomaticTrustedEdge,
  AutomaticTrustedGoogleFrontEnds,
  AutomaticTrustedLoadBalancer,
  AutomaticTrustedProxies,
  automaticTrustedProxiesToJSON,
} from "../../Types/SecurityEvent/AutomaticTrustedProxies";
import { PassOnLoadBalancerReading } from "../../Utils/SecurityEvent/PassOnLoadBalancers";
import {
  MAX_CHECKED_TEXT_LENGTH,
  SECURITY_LOG_LINE_CHECK_PATH,
  SecurityLogLineCheckResult,
  securityLogLineCheckResultToJSON,
} from "../../Types/SecurityEvent/SecurityLogLineCheck";

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
 *     the rest of the project;
 *   - Google's front ends, with the Google Cloud Application Load
 *     Balancers that bring them and anything that keeps them untrusted
 *     (#11047), read as the load balancers are;
 *   - the load balancers that pass on what a client wrote, with the ranges
 *     each connects from, which are never trusted (#11389), read the same
 *     way.
 *
 * A signed-in member of the project in the tenantid header. The load
 * balancers are read as the caller reads: one who may not read cloud
 * resources is told none of them, only that they could not be listed
 * (areLoadBalancersRead), as is a read that failed. A read only, which
 * writes nothing and reads no body.
 *
 * POST /security-log-lines/check (#11046): what the lines in the body
 * become, read as the scans read the project's logs - with its trusted
 * proxies, the edges it connected, its own load balancers and its Access
 * Logs settings - so Check a log line names the client a stored event will
 * (SecurityLogLineCheckReader). A signed-in member of the project who may
 * read security events, since it shows what they would; the text, at most
 * MAX_CHECKED_TEXT_LENGTH of it, is read and dropped, never stored or
 * logged.
 *
 * A bare router, as ProjectCanSendAPI is: it reads no single model's CRUD
 * routes.
 */

const router: ExpressRouter = Express.getRouter();

/*
 * The text a check was sent: the body's `text`, cut to what is read. A body
 * with no text is a 400 that says what to send.
 */
export function readCheckedText(body: unknown): string {
  const text: JSONValue | undefined =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)["text"]
      : undefined;

  if (typeof text !== "string") {
    throw new BadDataException(
      "Send the log lines to check as text, one line a line.",
    );
  }

  return text.slice(0, MAX_CHECKED_TEXT_LENGTH);
}

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
      let googleFrontEnds: AutomaticTrustedGoogleFrontEnds | null = null;
      let passOnLoadBalancers: Array<AutomaticPassOnLoadBalancer> = [];
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
        // Google's front ends, read as the load balancers that bring them are (#11047).
        googleFrontEnds = read.googleFrontEnds
          ? {
              ranges: read.googleFrontEnds.ranges,
              broughtBy: read.googleFrontEnds.broughtBy,
              withheldBy: read.googleFrontEnds.withheldBy,
              isWithheldForIncompleteRead:
                read.googleFrontEnds.isWithheldForIncompleteRead,
              isTrusted: read.googleFrontEnds.isTrusted,
            }
          : null;
        // The ones that pass on what a client wrote, never trusted (#11389).
        passOnLoadBalancers = read.passOnLoadBalancers.map(
          (loadBalancer: PassOnLoadBalancerReading): AutomaticPassOnLoadBalancer => {
            return {
              kind: loadBalancer.kind,
              name: loadBalancer.name,
              where: loadBalancer.where,
              reasons: loadBalancer.reasons,
              targetGroups: loadBalancer.targetGroups,
              ranges: loadBalancer.ranges,
              areRangesIncomplete: loadBalancer.areRangesIncomplete,
            };
          },
        );
      } catch (error) {
        logger.debug(
          `SecurityTrustedProxiesAPI: could not list the load balancers of project ${projectId.toString()} for this reader. ${String(error)}`,
        );
        areLoadBalancersRead = false;
      }

      const proxies: AutomaticTrustedProxies = {
        edges: await readEdges(projectId),
        loadBalancers,
        googleFrontEnds,
        passOnLoadBalancers,
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

router.post(
  SECURITY_LOG_LINE_CHECK_PATH,
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

      CommonAPI.assertPermittedInProject({
        databaseProps: props,
        allowedPermissions: new SecurityEvent().getReadPermissions(),
        errorMessage:
          "Checking a log line takes a role that can read security events.",
      });

      const result: SecurityLogLineCheckResult =
        await SecurityLogLineCheckReader.check({
          projectId,
          text: readCheckedText(req.body),
        });

      Response.setNoCacheHeaders(res);

      return Response.sendJsonObjectResponse(
        req,
        res,
        securityLogLineCheckResultToJSON(result),
      );
    } catch (error) {
      next(error);
    }
  },
);

export default router;
