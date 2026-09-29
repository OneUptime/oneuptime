import {
  isMobileSsoRequest,
  respondToMobileSsoFailure,
} from "../Utils/MobileSso";
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
import Response from "Common/Server/Utils/Response";
import { JSONObject } from "Common/Types/JSON";

/*
 * Route-level license gates for the enterprise identity routers.
 *
 * SSO (SAML and OIDC, for projects, status pages and the whole instance,
 * including the mobile flows) and SCIM (projects and status pages) run only
 * while their feature is ACTIVE (EnterpriseEdition.isFeatureActive): with
 * billing off, while the license covers them (valid, in grace, or inside the
 * 14-day trial). When the license lapses they stop, exactly as on the
 * Community Edition, and they resume without a restart when a license is
 * activated.
 *
 * The routers are mounted once at boot and the license changes at runtime,
 * so every route asks per request, through the gate that is the FIRST
 * handler of its route. It cannot be a router.use() layer: an ee router is
 * mounted at "/" next to core's routers and must contain routes only
 * (Tests/Server/ModuleShape.test.ts). Tests/Server/Identity/
 * IdentityLicenseGates.test.ts checks that every route of every identity
 * router starts with the gate for its feature.
 *
 * Each gate answers the way its route already reports errors:
 *   forSsoPage   browser flows (SP-initiated start, IdP callbacks): the
 *                Identity message page, or the app's failure deep link when
 *                the mobile app started the login;
 *   forSsoJson   JSON discovery for sign-in pages: 402 with a message, which
 *                the Accounts app and the mobile app read as "SSO is not
 *                offered";
 *   forScim      SCIM: 403 with a SCIM error body (RFC 7644 section 3.12),
 *                so the identity provider shows the reason.
 *
 * An unknown license state counts as active (isFeatureActive), and so does an
 * error while deciding: a gate never refuses because the license could not
 * be read.
 */

export const MESSAGE_VIEW: string =
  "/usr/src/app/FeatureSet/Identity/Views/Message.ejs";

export const SSO_UNAVAILABLE_TITLE: string = "Single sign-on is unavailable.";

export const SSO_UNAVAILABLE_MESSAGE: string =
  "Single sign-on is unavailable because this OneUptime installation's Enterprise license has lapsed or does not include it. " +
  "Sign in with your password, or ask your administrator to renew the license.";

// The `error` value of the mobile app's failure deep link.
export const MOBILE_SSO_UNAVAILABLE_ERROR: string = "sso_unavailable";

export const SCIM_UNAVAILABLE_MESSAGE: string =
  "SCIM provisioning is unavailable because this OneUptime installation's Enterprise license has lapsed or does not include it. " +
  "Nothing was changed. Provisioning resumes as soon as a OneUptime administrator renews the license.";

// Whether the request belongs to a login the mobile app started.
export type MobileSsoRequestResolver = (req: ExpressRequest) => boolean;

export interface SsoPageGateOptions {
  /*
   * How this router tells a mobile login from a web one. Defaults to
   * isMobileSsoRequest({ req }): the `mobile=true` query parameter and the
   * SAML RelayState.
   */
  isMobileRequest?: MobileSsoRequestResolver | undefined;
}

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
 * (EnterpriseEdition.isFeatureActive), and sign-in pages ask on every load.
 * Not Response.sendJsonObjectResponse either, which answers 200 when the
 * query asks for CSV.
 */
const sendRefusal: (
  res: ExpressResponse,
  status: number,
  body: JSONObject,
) => void = (res: ExpressResponse, status: number, body: JSONObject): void => {
  (res as OneUptimeResponse).logBody = body;
  res.status(status).send(body);
};

const resolveIsMobileRequest: (
  req: ExpressRequest,
  resolver: MobileSsoRequestResolver | undefined,
) => boolean = (
  req: ExpressRequest,
  resolver: MobileSsoRequestResolver | undefined,
): boolean => {
  try {
    return resolver ? resolver(req) : isMobileSsoRequest({ req });
  } catch {
    return false;
  }
};

export default class LicensedFeatureGate {
  // JSON SSO discovery routes (the provider lists sign-in pages ask for).
  public static readonly forSsoJson: RequestHandler = markGate(
    (_req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
      if (isActive(EnterpriseFeature.SSO)) {
        return next();
      }

      sendRefusal(res, 402, { message: SSO_UNAVAILABLE_MESSAGE });
    },
    EnterpriseFeature.SSO,
  );

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

  // Browser SSO routes: SP-initiated starts and IdP callbacks.
  public static forSsoPage(options?: SsoPageGateOptions): RequestHandler {
    return markGate(
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
        if (isActive(EnterpriseFeature.SSO)) {
          return next();
        }

        if (
          respondToMobileSsoFailure({
            res,
            isMobileRequest: resolveIsMobileRequest(
              req,
              options?.isMobileRequest,
            ),
            error: MOBILE_SSO_UNAVAILABLE_ERROR,
            errorDescription: SSO_UNAVAILABLE_MESSAGE,
          })
        ) {
          return;
        }

        res.status(402);

        Response.render(req, res, MESSAGE_VIEW, {
          title: SSO_UNAVAILABLE_TITLE,
          message: SSO_UNAVAILABLE_MESSAGE,
        });
      },
      EnterpriseFeature.SSO,
    );
  }

  // The feature a handler gates, or null when it is not a license gate.
  public static getGatedFeature(handler: unknown): EnterpriseFeature | null {
    if (typeof handler !== "function") {
      return null;
    }

    return GATED_FEATURE_BY_HANDLER.get(handler as RequestHandler) || null;
  }
}
