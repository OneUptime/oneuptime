import IdentityProviderSignOut from "../Utils/IdentityProviderSignOut";
import SignInAgain, { SIGN_IN_AGAIN_STATE_FIELD } from "../Utils/SignInAgain";
import OIDCUtil, { OidcCallbackResult } from "../Utils/OIDC";
import {
  respondToMobileSsoFailure,
  respondToMobileSsoSuccess,
  startMobileSsoHandOff,
} from "../Utils/MobileSso";
import SsoTeamMembership, {
  SSO_NO_ROOM_ERROR,
  SSO_NO_ROOM_MESSAGE,
  SSO_NO_ROOM_TITLE,
  SsoTeamMembershipOutcome,
} from "../Utils/SsoTeamMembership";
import RequestOriginUtil from "Common/Server/Utils/RequestOrigin/RequestOriginUtil";
import { ProjectSsoKind } from "../Utils/ProjectSsoSignInConfirmation";
import ProjectSsoSignInGate, {
  ProjectSsoGateDecision,
  ProjectSsoGateOutcome,
} from "../Utils/ProjectSsoSignInGate";
import { DashboardRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Exception from "Common/Types/Exception/Exception";
import ServerException from "Common/Types/Exception/ServerException";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import ProjectOidcService from "Common/Server/Services/ProjectOidcService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserSessionService, {
  SessionMetadata,
} from "Common/Server/Services/UserSessionService";
import CookieUtil from "Common/Server/Utils/Cookie";
import { getSessionCookieFields } from "Common/Server/Utils/SessionCookieFields";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  extractDeviceInfo,
  getClientIp,
  headerValueToString,
} from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import ProjectSsoDiscovery from "Common/Server/Utils/ProjectSsoDiscovery";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import User from "Common/Models/DatabaseModels/User";
import { Client } from "openid-client";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import {
  SessionSignInAgain,
  SignInMethod,
} from "Common/Types/UserSession/SessionSignIn";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import { SignInFailureReason } from "Common/Types/AuditLog/AuditLogSignInFailure";
import FailedSignInAuditLog from "Common/Server/Utils/AuditLog/FailedSignInAuditLog";

const router: ExpressRouter = Express.getRouter();

const OIDC_STATE_COOKIE_TTL_SECONDS: number = 10 * 60;

const getOidcStateCookieName: (projectOidcId: ObjectID) => string = (
  projectOidcId: ObjectID,
): string => {
  return `oidc-state-${projectOidcId.toString()}`;
};

/*
 * Project OIDC sign-in, served by core in every edition. The redirect URI
 * (/identity/oidc-callback/:projectId/:projectOidcId) is pasted into
 * customers' identity providers, so no path below may ever change:
 * Tests/FeatureSet/Identity/SsoRoutePathsUnchanged.test.ts pins them.
 */

/*
 * The project OIDC providers "Sign in with SSO" offers an address: those
 * that list a verified domain of their project with the address's domain
 * (Common/Server/Utils/ProjectSsoDiscovery). No account is read, so the
 * answer, the empty list included, says nothing about whether the address
 * has one (#9745, #9824). The page and the mobile app read an empty list as
 * "no single sign-on for this address".
 */
router.get(
  "/service-provider-login-oidc",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.query["email"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Email is required"),
        );
      }

      const email: Email = new Email(req.query["email"] as string);

      const projectOidcList: Array<ProjectOIDC> =
        await ProjectSsoDiscovery.findOidcProviders(email);

      return Response.sendEntityArrayResponse(
        req,
        res,
        projectOidcList,
        projectOidcList.length,
        ProjectOIDC,
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

router.get(
  "/oidc/:projectId/:projectOidcId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.params["projectId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Project ID not found"),
        );
      }

      if (!req.params["projectOidcId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Project OIDC ID not found"),
        );
      }

      const projectOidc: ProjectOIDC | null =
        await ProjectOidcService.findOneBy({
          query: {
            projectId: new ObjectID(req.params["projectId"]),
            _id: req.params["projectOidcId"],
            isEnabled: true,
          },
          select: {
            _id: true,
            projectId: true,
            discoveryURL: true,
            clientId: true,
            clientSecret: true,
            scopes: true,
          },
          props: { isRoot: true },
        });

      if (!projectOidc) {
        if (SignInAgain.isRequested(req)) {
          return await SignInAgain.sendToSignInPage(req, res);
        }

        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("OIDC Config not found"),
        );
      }

      if (!projectOidc.discoveryURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Discovery URL not configured"),
        );
      }

      if (!projectOidc.clientId || !projectOidc.clientSecret) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("OIDC client credentials not configured"),
        );
      }

      const isMobileRequest: boolean = req.query["mobile"] === "true";

      /*
       * A sign-in the mobile app started keeps its state and PKCE challenge
       * for the round trip (#9989), its flow carried in the signed state
       * cookie below.
       */
      let mobileFlowId: string | null = null;

      if (isMobileRequest) {
        const handOff: { flowId: string | null } | null =
          await startMobileSsoHandOff({
            req,
            res,
            providerId: projectOidc.id!,
            rememberInCookie: false,
          });

        if (!handOff) {
          return;
        }

        mobileFlowId = handOff.flowId;
      }

      const redirectUri: URL = URL.fromString(
        `${HttpProtocol}${Host}/identity/oidc-callback/${projectOidc.projectId?.toString()}/${projectOidc.id?.toString()}`,
      );

      const client: Client = await OIDCUtil.createClient({
        discoveryURL: projectOidc.discoveryURL,
        clientId: projectOidc.clientId,
        clientSecret: projectOidc.clientSecret,
        redirectUri: redirectUri,
        scopes: projectOidc.scopes || "openid email profile",
      });

      const state: string = OIDCUtil.generateState();
      const nonce: string = OIDCUtil.generateNonce();
      const codeVerifier: string = OIDCUtil.generateCodeVerifier();
      const codeChallenge: string =
        OIDCUtil.generateCodeChallenge(codeVerifier);

      /*
       * Sign In Again (#10217): the provider is asked to authenticate the
       * person again, and the signed state keeps when they were sent, for
       * the callback to hold the ID token's auth_time to (Utils/SignInAgain).
       * Never for the mobile app, which has no prompt.
       */
      const isSignInAgain: boolean =
        SignInAgain.isRequested(req) && !isMobileRequest;

      const stateCookieToken: string = JSONWebToken.signJsonPayload(
        {
          state,
          nonce,
          codeVerifier,
          isMobile: isMobileRequest,
          // The mobile app's hand-off (#9989): null for any other sign-in.
          mobileFlowId: mobileFlowId,
          ...(isSignInAgain
            ? {
                [SIGN_IN_AGAIN_STATE_FIELD]:
                  OneUptimeDate.getCurrentDate().getTime(),
              }
            : {}),
        },
        OIDC_STATE_COOKIE_TTL_SECONDS,
      );

      CookieUtil.setCookie(
        res,
        getOidcStateCookieName(projectOidc.id!),
        stateCookieToken,
        {
          maxAge: OIDC_STATE_COOKIE_TTL_SECONDS * 1000,
          httpOnly: true,
        },
      );

      const authorizationUrl: URL = OIDCUtil.generateAuthorizationUrl({
        client,
        scopes: projectOidc.scopes || "openid email profile",
        state,
        nonce,
        codeChallenge,
        isSignInAgain: isSignInAgain,
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
  "/oidc-callback/:projectId/:projectOidcId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await handleOidcCallback(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

type HandleOidcCallbackFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<void>;

const handleOidcCallback: HandleOidcCallbackFunction = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> => {
  try {
    if (!req.params["projectId"]) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Project ID not found"),
      );
    }

    if (!req.params["projectOidcId"]) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Project OIDC ID not found"),
      );
    }

    const projectOidcId: ObjectID = new ObjectID(
      req.params["projectOidcId"] as string,
    );

    const stateCookieName: string = getOidcStateCookieName(projectOidcId);
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
    let isMobileRequest: boolean;
    // The mobile app's hand-off (#9989), from the signed cookie alone.
    let mobileFlowId: string | null = null;
    // When Sign In Again sent the person to the provider (#10217), or null.
    let signInAgainRequestedAt: Date | null = null;

    try {
      const decoded: Record<string, unknown> = JSONWebToken.decodeJsonPayload(
        stateCookieValue,
      ) as unknown as Record<string, unknown>;

      signInAgainRequestedAt = SignInAgain.readStateRequestedAt(
        decoded as JSONObject,
        OneUptimeDate.getCurrentDate(),
      );

      storedState = decoded["state"] as string;
      storedNonce = decoded["nonce"] as string;
      storedCodeVerifier = decoded["codeVerifier"] as string;
      isMobileRequest = Boolean(decoded["isMobile"]);
      mobileFlowId =
        isMobileRequest && typeof decoded["mobileFlowId"] === "string"
          ? decoded["mobileFlowId"] || null
          : null;
    } catch {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException(
          "OIDC login session is invalid. Please try signing in again.",
        ),
      );
    }

    // Always clear the state cookie once we've read it.
    CookieUtil.removeCookie(res, stateCookieName);

    const projectOidc: ProjectOIDC | null = await ProjectOidcService.findOneBy({
      query: {
        projectId: new ObjectID(req.params["projectId"]),
        _id: req.params["projectOidcId"],
        isEnabled: true,
      },
      select: {
        // The audit log's sign-in entry names the provider (SessionSignIn).
        name: true,
        discoveryURL: true,
        issuerURL: true,
        clientId: true,
        clientSecret: true,
        scopes: true,
        emailClaimName: true,
        nameClaimName: true,
        teams: { _id: true },
        // Whether the session keeps what a sign-out at the provider needs.
        signOutOfIdentityProvider: true,
      },
      props: { isRoot: true },
    });

    if (!projectOidc) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("OIDC Config not found"),
      );
    }

    if (
      !projectOidc.discoveryURL ||
      !projectOidc.issuerURL ||
      !projectOidc.clientId ||
      !projectOidc.clientSecret
    ) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("OIDC Config is incomplete"),
      );
    }

    const redirectUri: URL = URL.fromString(
      `${HttpProtocol}${Host}/identity/oidc-callback/${req.params["projectId"]}/${req.params["projectOidcId"]}`,
    );

    const client: Client = await OIDCUtil.createClient({
      discoveryURL: projectOidc.discoveryURL,
      clientId: projectOidc.clientId,
      clientSecret: projectOidc.clientSecret,
      redirectUri: redirectUri,
      scopes: projectOidc.scopes || "openid email profile",
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
        expectedIssuer: projectOidc.issuerURL,
        expectedNonce: storedNonce,
        expectedState: storedState,
        codeVerifier: storedCodeVerifier,
        callbackParams,
        emailClaimName: projectOidc.emailClaimName || "email",
        nameClaimName: projectOidc.nameClaimName || "name",
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
     * Whom this project's provider may sign in, and what everyone else is
     * told: one answer, in the same time, whether the address has no
     * account, one that has not confirmed this project's sign-in, a blocked
     * one or an administrator's (#9824). See ../Utils/ProjectSsoSignInGate.ts.
     */
    const decision: ProjectSsoGateDecision = await ProjectSsoSignInGate.decide({
      email: result.email,
      name: result.name || null,
      projectId: new ObjectID(req.params["projectId"] as string),
      kind: ProjectSsoKind.OIDC,
      providerId: projectOidcId,
      origin: RequestOriginUtil.fromRequest(req),
    });

    if (decision.outcome !== ProjectSsoGateOutcome.SignIn) {
      const failureReason: SignInFailureReason | null =
        ProjectSsoSignInGate.getFailureReason(decision.reason);

      /*
       * A sign-in the provider vouched for that OneUptime refuses, for the
       * audit log of every project the account's person is a member of
       * (issue #6788), after the answer (FailedSignInAuditLog). The
       * provider is this project's: only this project's entry names it.
       */
      if (failureReason && decision.user?.id) {
        FailedSignInAuditLog.record({
          req: req,
          userId: decision.user.id,
          reason: failureReason,
          signIn: {
            method: SignInMethod.OpenIdConnect,
            ssoProviderName: projectOidc.name,
            ssoProjectId: new ObjectID(req.params["projectId"] as string),
          },
        });
      }

      return ProjectSsoSignInGate.respondNotSignedIn({
        req,
        res,
        isMobileRequest,
        outcome: decision.outcome,
      });
    }

    let alreadySavedUser: User = decision.user!;

    // Add to default teams if user is not already in the project.
    const teamMemberCount: PositiveNumber = await TeamMemberService.countBy({
      query: {
        projectId: new ObjectID(req.params["projectId"] as string),
        userId: alreadySavedUser!.id!,
      },
      props: { isRoot: true },
    });

    if (teamMemberCount.toNumber() === 0) {
      if (!projectOidc.teams || projectOidc.teams.length === 0) {
        return Response.render(
          req,
          res,
          "/usr/src/app/FeatureSet/Identity/Views/Message.ejs",
          {
            title: "No teams added.",
            message:
              "No teams have been added to this OIDC config. Please contact your admin and have default teams added.",
          },
        );
      }

      /*
       * They take a seat like anyone invited: a project with no room for
       * one more person adds them nowhere, and they are told so.
       */
      if (
        (await SsoTeamMembership.addToTeams({
          projectId: new ObjectID(req.params["projectId"] as string),
          userId: alreadySavedUser.id!,
          teams: projectOidc.teams,
        })) === SsoTeamMembershipOutcome.NoRoom
      ) {
        if (
          respondToMobileSsoFailure({
            res,
            isMobileRequest,
            error: SSO_NO_ROOM_ERROR,
            errorDescription: SSO_NO_ROOM_MESSAGE,
          })
        ) {
          return;
        }

        return Response.render(
          req,
          res,
          "/usr/src/app/FeatureSet/Identity/Views/Message.ejs",
          {
            title: SSO_NO_ROOM_TITLE,
            message: SSO_NO_ROOM_MESSAGE,
          },
        );
      }
    }

    const projectId: ObjectID = new ObjectID(req.params["projectId"] as string);

    /*
     * Signing in through this project's own single sign-on is the person
     * joining it: an invitation into it still pending is accepted (#9819),
     * and an address the provider vouched for is verified, as for an
     * account it makes - after the memberships, so their defaults are made.
     */
    alreadySavedUser = await ProjectSsoSignInGate.joinOnSignIn({
      user: alreadySavedUser,
      projectId: projectId,
    });

    alreadySavedUser.email = result.email;

    await AccessTokenService.refreshUserAllPermissions(alreadySavedUser.id!);

    /*
     * A sign-in Sign In Again started (#10217): it confirms the session only
     * when the ID token says the person authenticated at or after the moment
     * they were sent to the provider (Utils/SignInAgain).
     */
    const signInAgain: SessionSignInAgain | undefined = SignInAgain.judge({
      requestedAt: signInAgainRequestedAt,
      authenticatedAt: SignInAgain.readAuthTime(result.rawClaims),
      now: OneUptimeDate.getCurrentDate(),
    });

    SignInAgain.logOutcome({
      outcome: signInAgain,
      providerKind: "project OpenID Connect provider",
      providerId: projectOidcId,
    });

    const sessionMetadata: SessionMetadata =
      await UserSessionService.createSession({
        userId: alreadySavedUser.id!,
        isGlobalLogin: false,
        ipAddress: getClientIp(req),
        userAgent: headerValueToString(req.headers["user-agent"]),
        ...extractDeviceInfo(req),
        additionalInfo: { projectId: projectId.toString() },
        requestOrigin: RequestOriginUtil.fromRequest(req),
        signIn: {
          method: SignInMethod.OpenIdConnect,
          ssoProviderName: projectOidc.name,
          ssoProjectId: projectId,
          ssoProviderId: projectOidcId,
          signInAgain: signInAgain,
        },
        /*
         * With "Sign out of the identity provider too" on, a browser's
         * sign-out ends the provider's session as well: what that takes is
         * kept with this session, server-side, its ID token encrypted.
         */
        identityProviderSignOut: IdentityProviderSignOut.forSignIn({
          signOutOfIdentityProvider: projectOidc.signOutOfIdentityProvider,
          isMobileRequest: isMobileRequest,
          providerType: SsoProviderType.ProjectOIDC,
          providerId: projectOidcId,
          getEndSessionEndpoint: (): string | null => {
            return OIDCUtil.getEndSessionEndpoint(client);
          },
          idToken: result.idToken,
        }),
      });

    if (isMobileRequest) {
      const accessToken: string = JSONWebToken.signUserLoginToken({
        tokenData: {
          userId: alreadySavedUser.id!,
          email: alreadySavedUser.email!,
          name: alreadySavedUser.name!,
          timezone: alreadySavedUser.timezone || null,
          isMasterAdmin: alreadySavedUser.isMasterAdmin!,
          isGlobalLogin: false,
          sessionId: sessionMetadata.session.id!,
          signedInAt: sessionMetadata.signedInAt,
          lastActiveAt: sessionMetadata.lastActiveAt,
        },
        expiresInSeconds: sessionMetadata.accessTokenExpiresInSeconds,
      });

      const ssoToken: string = CookieUtil.getSSOToken({
        user: alreadySavedUser,
        projectId: projectId,
        ssoProviderId: projectOidcId,
        ssoProviderType: SsoProviderType.ProjectOIDC,
        expiresInSeconds: sessionMetadata.ssoSignInExpiresInSeconds,
      });

      logger.info(
        "User logged in with OIDC (mobile): " + result.email.toString(),
        getLogAttributesFromRequest(req as RequestLike),
      );

      /*
       * A one-time code the app redeems with its PKCE verifier, or - for an
       * app from before #9989 - the deep link that carries the session
       * (Utils/MobileSso).
       */
      return respondToMobileSsoSuccess({
        res,
        flowId: mobileFlowId,
        signIn: {
          accessToken,
          refreshToken: sessionMetadata.refreshToken,
          refreshTokenExpiresAt: sessionMetadata.refreshTokenExpiresAt,
          userId: alreadySavedUser.id!.toString(),
          email: alreadySavedUser.email!.toString(),
          name: alreadySavedUser.name?.toString() || "",
          isMasterAdmin: Boolean(alreadySavedUser.isMasterAdmin),
          ssoToken,
          projectId: projectId.toString(),
        },
      });
    }

    CookieUtil.setSSOCookie({
      user: alreadySavedUser,
      projectId: projectId,
      expressResponse: res,
      ssoProviderId: projectOidcId,
      ssoProviderType: SsoProviderType.ProjectOIDC,
      expiresInSeconds: sessionMetadata.ssoSignInExpiresInSeconds,
    });

    CookieUtil.setUserCookie({
      expressResponse: res,
      user: alreadySavedUser,
      isGlobalLogin: false,
      ...getSessionCookieFields(sessionMetadata),
    });

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    logger.info(
      "User logged in with OIDC: " + result.email.toString(),
      getLogAttributesFromRequest(req as RequestLike),
    );

    return Response.redirect(
      req,
      res,
      new URL(
        httpProtocol,
        host,
        new Route(DashboardRoute.toString()).addRoute(
          "/" + req.params["projectId"],
        ),
      ),
    );
  } catch (err) {
    logger.error(err, getLogAttributesFromRequest(req as RequestLike));
    Response.sendErrorResponse(req, res, err as Exception);
  }
};

export default router;
