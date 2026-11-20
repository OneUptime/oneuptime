import OIDCUtil, { OidcCallbackResult } from "../Utils/OIDC";
import DashboardSignIn from "../Utils/DashboardSignIn";
import URL from "Common/Types/API/URL";
import { DASHBOARD_LOGIN_CODE_PARAMETER } from "Common/Types/Dashboard/DashboardPrivateUserSignIn";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Exception from "Common/Types/Exception/Exception";
import ServerException from "Common/Types/Exception/ServerException";
import ObjectID from "Common/Types/ObjectID";
import { SignInMethod } from "Common/Types/UserSession/SessionSignIn";
import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";
import DashboardOidcService from "Common/Server/Services/DashboardOidcService";
import DashboardPrivateUserService from "Common/Server/Services/DashboardPrivateUserService";
import DashboardPrivateUserSessionService from "Common/Server/Services/DashboardPrivateUserSessionService";
import DashboardService from "Common/Server/Services/DashboardService";
import { PrivateUserSessionMetadata } from "Common/Server/Services/PrivateUserSessionServiceBase";
import CookieUtil from "Common/Server/Utils/Cookie";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  extractDeviceInfo,
  getClientIp,
  headerValueToString,
} from "Common/Server/Utils/Express";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import RequestOriginUtil from "Common/Server/Utils/RequestOrigin/RequestOriginUtil";
import Response from "Common/Server/Utils/Response";
import DashboardOIDC from "Common/Models/DatabaseModels/DashboardOidc";
import DashboardPrivateUser from "Common/Models/DatabaseModels/DashboardPrivateUser";
import DashboardPrivateUserSession from "Common/Models/DatabaseModels/DashboardPrivateUserSession";
import { Client } from "openid-client";

const router: ExpressRouter = Express.getRouter();

const OIDC_STATE_COOKIE_TTL_SECONDS: number = 10 * 60;

const getOidcStateCookieName: (dashboardOidcId: ObjectID) => string = (
  dashboardOidcId: ObjectID,
): string => {
  return `dashboard-oidc-state-${dashboardOidcId.toString()}`;
};

/*
 * The redirect URI a dashboard's OIDC provider is configured with, on
 * OneUptime's own address - shown on the dashboard's Single Sign-On page
 * (Dashboards/View/SingleSignOn) exactly so.
 */
const getRedirectUri: (data: {
  dashboardId: string;
  dashboardOidcId: string;
}) => URL = (data: { dashboardId: string; dashboardOidcId: string }): URL => {
  return URL.fromString(
    `${HttpProtocol}${Host}/identity/dashboard-oidc-callback/${data.dashboardId}/${data.dashboardOidcId}`,
  );
};

/*
 * ---------------------------------------------------------------------------
 * A DASHBOARD'S OPENID CONNECT SIGN-IN (#10250), for the people who open
 * its public link when it asks its visitors to sign in - as a status page's
 * (StatusPageOIDC), served by core in every edition. The redirect URI
 * (/identity/dashboard-oidc-callback/:dashboardId/:dashboardOidcId) is
 * pasted into customers' identity providers, so no path below may ever
 * change: Tests/FeatureSet/Identity/SsoRoutePathsUnchanged.test.ts pins
 * them.
 *
 * The sign-in starts on OneUptime's own address, so its state cookie - the
 * state, the nonce and the PKCE verifier, signed, for ten minutes - is on
 * the host the callback is: the provider's answer is held to all three and
 * to the provider's issuer (OIDCUtil.exchangeCodeAndValidate). Then, as for
 * SAML (DashboardSSO), the person is looked up and made one of the
 * dashboard's private users the first time, and handed back to the
 * dashboard's public link with a code its page exchanges on its own host.
 * ---------------------------------------------------------------------------
 */

router.get(
  "/dashboard-oidc/:dashboardId/:dashboardOidcId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const dashboardId: ObjectID = DashboardSignIn.readDashboardId(
        req.params["dashboardId"],
      );

      if (
        !req.params["dashboardOidcId"] ||
        !ObjectID.isValidUUID(req.params["dashboardOidcId"])
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Dashboard OIDC ID not found"),
        );
      }

      // A dashboard whose link signs nobody in starts no sign-in.
      await DashboardSignIn.getDashboardForSignIn({ req, dashboardId });

      const dashboardOidc: DashboardOIDC | null =
        await DashboardOidcService.findOneBy({
          query: {
            dashboardId: dashboardId,
            _id: req.params["dashboardOidcId"],
            isEnabled: true,
          },
          select: {
            _id: true,
            dashboardId: true,
            discoveryURL: true,
            clientId: true,
            clientSecret: true,
            scopes: true,
          },
          props: { isRoot: true },
        });

      if (!dashboardOidc) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("OIDC Config not found"),
        );
      }

      if (!dashboardOidc.discoveryURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Discovery URL not configured"),
        );
      }

      if (!dashboardOidc.clientId || !dashboardOidc.clientSecret) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("OIDC client credentials not configured"),
        );
      }

      const redirectUri: URL = getRedirectUri({
        dashboardId: dashboardOidc.dashboardId!.toString(),
        dashboardOidcId: dashboardOidc.id!.toString(),
      });

      const client: Client = await OIDCUtil.createClient({
        discoveryURL: dashboardOidc.discoveryURL,
        clientId: dashboardOidc.clientId,
        clientSecret: dashboardOidc.clientSecret,
        redirectUri: redirectUri,
        scopes: dashboardOidc.scopes || "openid email profile",
      });

      const state: string = OIDCUtil.generateState();
      const nonce: string = OIDCUtil.generateNonce();
      const codeVerifier: string = OIDCUtil.generateCodeVerifier();
      const codeChallenge: string =
        OIDCUtil.generateCodeChallenge(codeVerifier);

      const stateCookieToken: string = JSONWebToken.signJsonPayload(
        {
          state,
          nonce,
          codeVerifier,
        },
        OIDC_STATE_COOKIE_TTL_SECONDS,
      );

      CookieUtil.setCookie(
        res,
        getOidcStateCookieName(dashboardOidc.id!),
        stateCookieToken,
        {
          maxAge: OIDC_STATE_COOKIE_TTL_SECONDS * 1000,
          httpOnly: true,
        },
      );

      const authorizationUrl: URL = OIDCUtil.generateAuthorizationUrl({
        client,
        scopes: dashboardOidc.scopes || "openid email profile",
        state,
        nonce,
        codeChallenge,
      });

      return Response.redirect(req, res, authorizationUrl);
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));

      if (err instanceof Exception) {
        return next(err);
      }

      return next(new ServerException());
    }
  },
);

router.get(
  "/dashboard-oidc-callback/:dashboardId/:dashboardOidcId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const dashboardId: ObjectID = DashboardSignIn.readDashboardId(
        req.params["dashboardId"],
      );

      if (
        !req.params["dashboardOidcId"] ||
        !ObjectID.isValidUUID(req.params["dashboardOidcId"])
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Dashboard OIDC ID not found"),
        );
      }

      const dashboardOidcId: ObjectID = new ObjectID(
        req.params["dashboardOidcId"],
      );

      const stateCookieName: string = getOidcStateCookieName(dashboardOidcId);
      const stateCookieValue: string | undefined =
        CookieUtil.getCookieFromExpressRequest(req, stateCookieName);

      if (!stateCookieValue) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "OIDC sign-in session expired. Please try signing in again.",
          ),
        );
      }

      let storedState: string;
      let storedNonce: string;
      let storedCodeVerifier: string;

      try {
        const decoded: Record<string, unknown> = JSONWebToken.decodeJsonPayload(
          stateCookieValue,
        ) as unknown as Record<string, unknown>;

        storedState = decoded["state"] as string;
        storedNonce = decoded["nonce"] as string;
        storedCodeVerifier = decoded["codeVerifier"] as string;
      } catch {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "OIDC sign-in session is invalid. Please try signing in again.",
          ),
        );
      }

      // Each state cookie is used once.
      CookieUtil.removeCookie(res, stateCookieName);

      const dashboardOidc: DashboardOIDC | null =
        await DashboardOidcService.findOneBy({
          query: {
            dashboardId: dashboardId,
            _id: dashboardOidcId,
            isEnabled: true,
          },
          select: {
            _id: true,
            name: true,
            discoveryURL: true,
            issuerURL: true,
            clientId: true,
            clientSecret: true,
            scopes: true,
            emailClaimName: true,
            nameClaimName: true,
            projectId: true,
          },
          props: { isRoot: true },
        });

      if (!dashboardOidc) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("OIDC Config not found"),
        );
      }

      if (!dashboardOidc.projectId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("OIDC Config Project ID not found"),
        );
      }

      if (
        !dashboardOidc.discoveryURL ||
        !dashboardOidc.issuerURL ||
        !dashboardOidc.clientId ||
        !dashboardOidc.clientSecret
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("OIDC Config is incomplete"),
        );
      }

      const redirectUri: URL = getRedirectUri({
        dashboardId: dashboardId.toString(),
        dashboardOidcId: dashboardOidc.id!.toString(),
      });

      const client: Client = await OIDCUtil.createClient({
        discoveryURL: dashboardOidc.discoveryURL,
        clientId: dashboardOidc.clientId,
        clientSecret: dashboardOidc.clientSecret,
        redirectUri: redirectUri,
        scopes: dashboardOidc.scopes || "openid email profile",
      });

      const callbackParams: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === "string") {
          callbackParams[key] = value;
        }
      }

      let result: OidcCallbackResult;
      try {
        result = await OIDCUtil.exchangeCodeAndValidate({
          client,
          redirectUri,
          expectedIssuer: dashboardOidc.issuerURL,
          expectedNonce: storedNonce,
          expectedState: storedState,
          codeVerifier: storedCodeVerifier,
          callbackParams,
          emailClaimName: dashboardOidc.emailClaimName || "email",
          nameClaimName: dashboardOidc.nameClaimName || "name",
        });
      } catch (err: unknown) {
        logger.error(err, getLogAttributesFromRequest(req as RequestLike));
        if (err instanceof Exception) {
          return Response.sendErrorResponse(req, res, err);
        }
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "OIDC token exchange or validation failed. Please contact your administrator.",
          ),
        );
      }

      /*
       * The dashboard must still ask its visitors to sign in, and its IP
       * allowlist let this visitor in: a dashboard switched to another
       * choice since makes no private user and no session.
       */
      await DashboardSignIn.getDashboardForSignIn({ req, dashboardId });

      const projectId: ObjectID = dashboardOidc.projectId;

      let privateUser: DashboardPrivateUser | null =
        await DashboardPrivateUserService.findOneBy({
          query: { email: result.email, dashboardId: dashboardId },
          select: {
            _id: true,
            email: true,
            dashboardId: true,
            projectId: true,
          },
          props: { isRoot: true },
        });

      // The identity provider vouches for them: they become a private user.
      if (!privateUser) {
        const newPrivateUser: DashboardPrivateUser = new DashboardPrivateUser();
        newPrivateUser.projectId = projectId;
        newPrivateUser.dashboardId = dashboardId;
        newPrivateUser.email = result.email;
        newPrivateUser.isSsoUser = true;

        privateUser = await DashboardPrivateUserService.create({
          data: newPrivateUser,
          props: { isRoot: true },
        });
      }

      /*
       * The session names the provider that signed the person in: it counts
       * only while that provider vouches for it (DashboardPrivateUserSession
       * Service.addSignInRule).
       */
      const sessionMetadata: PrivateUserSessionMetadata<DashboardPrivateUserSession> =
        await DashboardPrivateUserSessionService.createLoginCodeSession({
          projectId: privateUser.projectId || projectId,
          resourceId: dashboardId,
          privateUserId: privateUser.id!,
          oidcProviderId: dashboardOidc.id!,
          ipAddress: getClientIp(req),
          userAgent: headerValueToString(req.headers["user-agent"]),
          ...extractDeviceInfo(req),
          signIn: {
            method: SignInMethod.OpenIdConnect,
            ssoProviderName: dashboardOidc.name,
          },
          requestOrigin: RequestOriginUtil.fromRequest(req),
        });

      const dashboardUrl: string =
        await DashboardService.getPublicDashboardUrl(dashboardId);

      Response.setNoCacheHeaders(res);

      return Response.redirect(
        req,
        res,
        URL.fromString(dashboardUrl).addQueryParams({
          [DASHBOARD_LOGIN_CODE_PARAMETER]: sessionMetadata.refreshToken,
        }),
      );
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));
      if (err instanceof Exception) {
        return next(err);
      }
      return next(new ServerException());
    }
  },
);

export default router;
