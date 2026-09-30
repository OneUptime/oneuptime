import { generateSCIMErrorResponse } from "../Utils/SCIMUtils";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeResponse,
  RequestHandler,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";

/*
 * Route-level license gate for the enterprise identity routers: SCIM
 * provisioning, for projects and status pages.
 *
 * SCIM runs only while its feature is ACTIVE (EnterpriseEdition.isFeatureActive):
 * with billing off, while the license covers it (valid, in grace, or inside
 * the 14-day trial). When the license lapses it stops, exactly as on the
 * Community Edition, and it resumes without a restart when a license is
 * activated.
 *
 * The routers are mounted once at boot and the license changes at runtime,
 * so every route asks per request, through the gate that is the FIRST
 * handler of its route - before the SCIM bearer-token check. It cannot be a
 * router.use() layer: an ee router is mounted at "/" next to core's routers
 * and must contain routes only (Tests/Server/ModuleShape.test.ts).
 * Tests/Server/Identity/IdentityLicenseGates.test.ts checks that every route
 * of every identity router starts with it.
 *
 * While SCIM is not active the gate answers 403 with a SCIM error body
 * (RFC 7644 section 3.12), so the identity provider shows the reason.
 *
 * An unknown license state counts as active (isFeatureActive), and so does an
 * error while deciding: the gate never refuses because the license could not
 * be read.
 */

export const SCIM_UNAVAILABLE_MESSAGE: string =
  "SCIM provisioning is unavailable because this OneUptime installation's Enterprise license has lapsed or does not include it. " +
  "Nothing was changed. Provisioning resumes as soon as a OneUptime administrator renews the license.";

// Which feature each gate handler guards, for the route invariant test.
const GATED_FEATURE_BY_HANDLER: WeakMap<RequestHandler, EnterpriseFeature> =
  new WeakMap<RequestHandler, EnterpriseFeature>();

const markGate: (
  handler: RequestHandler,
  feature: EnterpriseFeature,
) => RequestHandler = (
  handler: RequestHandler,
  feature: EnterpriseFeature,
): RequestHandler => {
  GATED_FEATURE_BY_HANDLER.set(handler, feature);
  return handler;
};

const isActive: (feature: EnterpriseFeature) => boolean = (
  feature: EnterpriseFeature,
): boolean => {
  try {
    return EnterpriseEdition.isFeatureActive(feature);
  } catch (err) {
    logger.error(
      `LicensedFeatureGate: could not tell whether the "${feature}" feature is active; letting the request through.`,
    );
    logger.error(err);
    return true;
  }
};

/*
 * Sends a refusal as JSON with its status. Deliberately not
 * Response.sendErrorResponse, which logs every call as an error: a lapsed
 * license is an expected state, already logged once when it began
 * (EnterpriseEdition.isFeatureActive), and identity providers keep calling
 * on their sync schedule. Not Response.sendJsonObjectResponse either, which
 * answers 200 when the query asks for CSV.
 */
const sendRefusal: (
  res: ExpressResponse,
  status: number,
  body: JSONObject,
) => void = (res: ExpressResponse, status: number, body: JSONObject): void => {
  (res as OneUptimeResponse).logBody = body;
  res.status(status).send(body);
};

export default class LicensedFeatureGate {
  // Every SCIM route, project and status page. Runs before the bearer check.
  public static readonly forScim: RequestHandler = markGate(
    (_req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
      if (isActive(EnterpriseFeature.SCIM)) {
        return next();
      }

      sendRefusal(
        res,
        403,
        generateSCIMErrorResponse(403, SCIM_UNAVAILABLE_MESSAGE),
      );
    },
    EnterpriseFeature.SCIM,
  );

  // The feature a handler gates, or null when it is not a license gate.
  public static getGatedFeature(handler: unknown): EnterpriseFeature | null {
    if (typeof handler !== "function") {
      return null;
    }

    return GATED_FEATURE_BY_HANDLER.get(handler as RequestHandler) || null;
  }
}
