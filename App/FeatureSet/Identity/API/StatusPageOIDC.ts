import OIDCUtil, { OidcCallbackResult } from "../Utils/OIDC";
import URL from "Common/Types/API/URL";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Exception from "Common/Types/Exception/Exception";
import ServerException from "Common/Types/Exception/ServerException";
import HashedString from "Common/Types/HashedString";
import ObjectID from "Common/Types/ObjectID";
import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";
import StatusPageOidcService from "Common/Server/Services/StatusPageOidcService";
import StatusPagePrivateUserService from "Common/Server/Services/StatusPagePrivateUserService";
import StatusPagePrivateUserSessionService, {
  SessionMetadata as StatusPageSessionMetadata,
} from "Common/Server/Services/StatusPagePrivateUserSessionService";
import StatusPageService from "Common/Server/Services/StatusPageService";
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
import Response from "Common/Server/Utils/Response";
import StatusPageOIDC from "Common/Models/DatabaseModels/StatusPageOidc";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import { Client } from "openid-client";

const router: ExpressRouter = Express.getRouter();

const ACCESS_TOKEN_EXPIRY_SECONDS: number = 15 * 60;
const OIDC_STATE_COOKIE_TTL_SECONDS: number = 10 * 60;

const getOidcStateCookieName: (statusPageOidcId: ObjectID) => string = (
  statusPageOidcId: ObjectID,
): string => {
  return `status-page-oidc-state-${statusPageOidcId.toString()}`;
};

router.get(
  "/status-page-oidc/:statusPageId/:statusPageOidcId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.params["statusPageId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Status Page ID not found"),
        );
      }

      if (!req.params["statusPageOidcId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Status Page OIDC ID not found"),
        );
      }

      const statusPageId: ObjectID = new ObjectID(req.params["statusPageId"]);

      const statusPageOidc: StatusPageOIDC | null =
        await StatusPageOidcService.findOneBy({
          query: {
            statusPageId: statusPageId,
            _id: req.params["statusPageOidcId"],
            isEnabled: true,
          },
          select: {
            _id: true,
            statusPageId: true,
            discoveryURL: true,
            clientId: true,
            clientSecret: true,
            scopes: true,
          },
          props: { isRoot: true },
        });

      if (!statusPageOidc) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("OIDC Config not found"),
        );
      }

      if (!statusPageOidc.discoveryURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Discovery URL not configured"),
        );
      }

      if (!statusPageOidc.clientId || !statusPageOidc.clientSecret) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("OIDC client credentials not configured"),
        );
      }

      const redirectUri: URL = URL.fromString(
        `${HttpProtocol}${Host}/identity/status-page-oidc-callback/${statusPageOidc.statusPageId?.toString()}/${statusPageOidc.id?.toString()}`,
      );

      const client: Client = await OIDCUtil.createClient({
        discoveryURL: statusPageOidc.discoveryURL,
        clientId: statusPageOidc.clientId,
        clientSecret: statusPageOidc.clientSecret,
        redirectUri: redirectUri,
        scopes: statusPageOidc.scopes || "openid email profile",
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
        getOidcStateCookieName(statusPageOidc.id!),
        stateCookieToken,
        {
          maxAge: OIDC_STATE_COOKIE_TTL_SECONDS * 1000,
          httpOnly: true,
        },
      );

      const authorizationUrl: URL = OIDCUtil.generateAuthorizationUrl({
        client,
        scopes: statusPageOidc.scopes || "openid email profile",
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
  "/status-page-oidc-callback/:statusPageId/:statusPageOidcId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.params["statusPageId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Status Page ID not found"),
        );
      }

      if (!req.params["statusPageOidcId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Status Page OIDC ID not found"),
        );
      }

      const statusPageId: ObjectID = new ObjectID(req.params["statusPageId"]);
      const statusPageOidcId: ObjectID = new ObjectID(
        req.params["statusPageOidcId"],
      );

      const stateCookieName: string = getOidcStateCookieName(statusPageOidcId);
      const stateCookieValue: string | undefined =
        CookieUtil.getCookieFromExpressRequest(req, stateCookieName);

      if (!stateCookieValue) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "OIDC login session expired. Please try signing in again.",
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
            "OIDC login session is invalid. Please try signing in again.",
          ),
        );
      }

      CookieUtil.removeCookie(res, stateCookieName);

      const statusPageOidc: StatusPageOIDC | null =
        await StatusPageOidcService.findOneBy({
          query: {
            statusPageId: statusPageId,
            _id: req.params["statusPageOidcId"],
            isEnabled: true,
          },
          select: {
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

      if (!statusPageOidc) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("OIDC Config not found"),
        );
      }

      if (!statusPageOidc.projectId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("OIDC Config Project ID not found"),
        );
      }

      if (
        !statusPageOidc.discoveryURL ||
        !statusPageOidc.issuerURL ||
        !statusPageOidc.clientId ||
        !statusPageOidc.clientSecret
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("OIDC Config is incomplete"),
        );
      }

      const redirectUri: URL = URL.fromString(
        `${HttpProtocol}${Host}/identity/status-page-oidc-callback/${req.params["statusPageId"]}/${req.params["statusPageOidcId"]}`,
      );

      const client: Client = await OIDCUtil.createClient({
        discoveryURL: statusPageOidc.discoveryURL,
        clientId: statusPageOidc.clientId,
        clientSecret: statusPageOidc.clientSecret,
        redirectUri: redirectUri,
        scopes: statusPageOidc.scopes || "openid email profile",
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
          expectedIssuer: statusPageOidc.issuerURL,
          expectedNonce: storedNonce,
          expectedState: storedState,
          codeVerifier: storedCodeVerifier,
          callbackParams,
          emailClaimName: statusPageOidc.emailClaimName || "email",
          nameClaimName: statusPageOidc.nameClaimName || "name",
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

      const projectId: ObjectID = statusPageOidc.projectId;

      let alreadySavedUser: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: { email: result.email, statusPageId: statusPageId },
          select: {
            _id: true,
            email: true,
            statusPageId: true,
            projectId: true,
          },
          props: { isRoot: true },
        });

      if (!alreadySavedUser) {
        alreadySavedUser = new StatusPagePrivateUser();
        alreadySavedUser.projectId = projectId;
        alreadySavedUser.statusPageId = statusPageId;
        alreadySavedUser.email = result.email;
        alreadySavedUser.password = new HashedString(
          ObjectID.generate().toString(),
        );
        alreadySavedUser.isSsoUser = true;

        alreadySavedUser = await StatusPagePrivateUserService.create({
          data: alreadySavedUser,
          props: { isRoot: true },
        });
      }

      if (!alreadySavedUser.projectId) {
        alreadySavedUser.projectId = projectId;
      }

      const sessionMetadata: StatusPageSessionMetadata =
        await StatusPagePrivateUserSessionService.createSession({
          projectId: alreadySavedUser.projectId!,
          statusPageId: statusPageId,
          statusPagePrivateUserId: alreadySavedUser.id!,
          ipAddress: getClientIp(req),
          userAgent: headerValueToString(req.headers["user-agent"]),
          ...extractDeviceInfo(req),
        });

      const token: string = CookieUtil.setStatusPagePrivateUserCookie({
        expressResponse: res,
        user: alreadySavedUser,
        statusPageId: statusPageId,
        sessionId: sessionMetadata.session.id!,
        refreshToken: sessionMetadata.refreshToken,
        refreshTokenExpiresAt: sessionMetadata.refreshTokenExpiresAt,
        accessTokenExpiresInSeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
      });

      const statusPageURL: string =
        await StatusPageService.getStatusPageFirstURL(statusPageId);

      logger.info(
        "Status page user logged in with OIDC: " + result.email.toString(),
        getLogAttributesFromRequest(req as RequestLike),
      );

      return Response.redirect(
        req,
        res,
        URL.fromString(statusPageURL).addQueryParams({
          token: token,
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
