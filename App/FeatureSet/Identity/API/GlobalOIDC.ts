import AuthenticationEmail from "../Utils/AuthenticationEmail";
import OIDCUtil, { OidcCallbackResult } from "../Utils/OIDC";
import {
  buildMobileSsoSuccessUrl,
  clearMobileSsoIntentCookie,
  isMobileSsoRequest,
  respondToMobileSsoFailure,
  setMobileSsoIntentCookie,
} from "../Utils/MobileSso";
import { DashboardRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Exception from "Common/Types/Exception/Exception";
import ServerException from "Common/Types/Exception/ServerException";
import ObjectID from "Common/Types/ObjectID";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import PositiveNumber from "Common/Types/PositiveNumber";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import GlobalOIDCService from "Common/Server/Services/GlobalOidcService";
import GlobalOIDCProjectService from "Common/Server/Services/GlobalOidcProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserService from "Common/Server/Services/UserService";
import UserSessionService, {
  SessionMetadata,
} from "Common/Server/Services/UserSessionService";
import CookieUtil from "Common/Server/Utils/Cookie";
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
import GlobalOIDC from "Common/Models/DatabaseModels/GlobalOidc";
import GlobalOIDCProject from "Common/Models/DatabaseModels/GlobalOidcProject";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import { Client } from "openid-client";

const router: ExpressRouter = Express.getRouter();

const ACCESS_TOKEN_EXPIRY_SECONDS: number = 15 * 60;
const OIDC_STATE_COOKIE_TTL_SECONDS: number = 10 * 60;

const MESSAGE_VIEW: string =
  "/usr/src/app/FeatureSet/Identity/Views/Message.ejs";

const getGlobalOidcStateCookieName: (globalOidcId: ObjectID) => string = (
  globalOidcId: ObjectID,
): string => {
  return `global-oidc-state-${globalOidcId.toString()}`;
};

/*
 * Service-provider initiated discovery: returns enabled Global OIDC providers
 * for the Accounts login page.
 */
router.get(
  "/global-oidc/service-provider-login",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const globalOidcList: Array<GlobalOIDC> = await GlobalOIDCService.findBy({
        query: { isEnabled: true },
        select: { _id: true, name: true, description: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

      return Response.sendEntityArrayResponse(
        req,
        res,
        globalOidcList,
        new PositiveNumber(globalOidcList.length),
        GlobalOIDC,
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
  "/global-oidc/:globalOidcId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.params["globalOidcId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Global OIDC ID not found"),
        );
      }

      const globalOidc: GlobalOIDC | null = await GlobalOIDCService.findOneBy({
        query: {
          _id: req.params["globalOidcId"],
          isEnabled: true,
        },
        select: {
          _id: true,
          discoveryURL: true,
          clientId: true,
          clientSecret: true,
          scopes: true,
        },
        props: { isRoot: true },
      });

      if (!globalOidc) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Global OIDC Config not found"),
        );
      }

      if (!globalOidc.discoveryURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Discovery URL not configured"),
        );
      }

      if (!globalOidc.clientId || !globalOidc.clientSecret) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("OIDC client credentials not configured"),
        );
      }

      const isMobileRequest: boolean = isMobileSsoRequest({
        req,
        providerId: globalOidc.id!,
      });

      /*
       * The mobile flag normally travels inside the signed state cookie. That
       * cookie is also the thing most likely to be MISSING when the callback
       * fails (expired login, cookie dropped by the browser), and in exactly
       * that case the error would be rendered as a web page the app cannot
       * read. A separate intent cookie survives independently and keeps the
       * failure routable back to the app.
       */
      if (isMobileRequest) {
        setMobileSsoIntentCookie(res, globalOidc.id!);
      }

      const redirectUri: URL = URL.fromString(
        `${HttpProtocol}${Host}/identity/global-oidc-callback/${globalOidc.id?.toString()}`,
      );

      const client: Client = await OIDCUtil.createClient({
        discoveryURL: globalOidc.discoveryURL,
        clientId: globalOidc.clientId,
        clientSecret: globalOidc.clientSecret,
        redirectUri: redirectUri,
        scopes: globalOidc.scopes || "openid email profile",
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
          isMobile: isMobileRequest,
        },
        OIDC_STATE_COOKIE_TTL_SECONDS,
      );

      CookieUtil.setCookie(
        res,
        getGlobalOidcStateCookieName(globalOidc.id!),
        stateCookieToken,
        {
          maxAge: OIDC_STATE_COOKIE_TTL_SECONDS * 1000,
          httpOnly: true,
        },
      );

      const authorizationUrl: URL = OIDCUtil.generateAuthorizationUrl({
        client,
        scopes: globalOidc.scopes || "openid email profile",
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
  "/global-oidc-callback/:globalOidcId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await handleGlobalOidcCallback(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

type HandleGlobalOidcCallbackFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<void>;

const handleGlobalOidcCallback: HandleGlobalOidcCallbackFunction = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> => {
  try {
    if (!req.params["globalOidcId"]) {
      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest: isMobileSsoRequest({ req }),
          error: "sso_failed",
          errorDescription: "This sign-in link is missing its provider.",
        })
      ) {
        return;
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Global OIDC ID not found"),
      );
    }

    const globalOidcId: ObjectID = new ObjectID(req.params["globalOidcId"]);

    /*
     * The authoritative mobile flag lives in the signed state cookie below.
     * This one is the fallback for the case where that cookie is gone - which
     * is precisely when the login is failing and the app most needs to be
     * told why, rather than being shown a web page it cannot parse.
     */
    let isMobileRequest: boolean = isMobileSsoRequest({
      req,
      providerId: globalOidcId,
    });

    const stateCookieName: string = getGlobalOidcStateCookieName(globalOidcId);
    const stateCookieValue: string | undefined =
      CookieUtil.getCookieFromExpressRequest(req, stateCookieName);

    if (!stateCookieValue) {
      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: "login_session_expired",
          errorDescription:
            "Your sign-in session expired. Please try signing in again.",
        })
      ) {
        return;
      }

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
      isMobileRequest = isMobileRequest || Boolean(decoded["isMobile"]);
    } catch {
      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: "login_session_invalid",
          errorDescription:
            "Your sign-in session is no longer valid. Please try signing in again.",
        })
      ) {
        return;
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException(
          "OIDC login session is invalid. Please try signing in again.",
        ),
      );
    }

    CookieUtil.removeCookie(res, stateCookieName);
    clearMobileSsoIntentCookie(res, globalOidcId);

    /*
     * An identity provider reports a refusal (consent denied, account
     * disabled) by redirecting back with `error` rather than `code`. Handling
     * it here means the user sees what their IdP actually said, instead of it
     * being fed into the token exchange and re-emerging as a generic failure.
     */
    const oidcError: unknown = req.query["error"];

    if (typeof oidcError === "string" && oidcError) {
      const oidcErrorDescription: unknown = req.query["error_description"];

      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: oidcError,
          errorDescription:
            typeof oidcErrorDescription === "string" && oidcErrorDescription
              ? oidcErrorDescription
              : "Your identity provider declined the sign-in request.",
        })
      ) {
        return;
      }

      return Response.render(req, res, MESSAGE_VIEW, {
        title: "Sign in was declined.",
        message:
          typeof oidcErrorDescription === "string" && oidcErrorDescription
            ? oidcErrorDescription
            : "Your identity provider declined the sign-in request. Please try again or contact your administrator.",
      });
    }

    const globalOidc: GlobalOIDC | null = await GlobalOIDCService.findOneBy({
      query: {
        _id: globalOidcId.toString(),
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
        disableSignUpWithSso: true,
        restrictToAttachedProjects: true,
      },
      props: { isRoot: true },
    });

    if (!globalOidc) {
      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: "provider_unavailable",
          errorDescription:
            "This SSO provider is no longer available. Please contact your administrator.",
        })
      ) {
        return;
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Global OIDC Config not found"),
      );
    }

    if (
      !globalOidc.discoveryURL ||
      !globalOidc.issuerURL ||
      !globalOidc.clientId ||
      !globalOidc.clientSecret
    ) {
      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: "provider_misconfigured",
          errorDescription:
            "This SSO provider is not fully configured. Please contact your administrator.",
        })
      ) {
        return;
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Global OIDC Config is incomplete"),
      );
    }

    const redirectUri: URL = URL.fromString(
      `${HttpProtocol}${Host}/identity/global-oidc-callback/${globalOidcId.toString()}`,
    );

    const client: Client = await OIDCUtil.createClient({
      discoveryURL: globalOidc.discoveryURL,
      clientId: globalOidc.clientId,
      clientSecret: globalOidc.clientSecret,
      redirectUri: redirectUri,
      scopes: globalOidc.scopes || "openid email profile",
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
        expectedIssuer: globalOidc.issuerURL,
        expectedNonce: storedNonce,
        expectedState: storedState,
        codeVerifier: storedCodeVerifier,
        callbackParams,
        emailClaimName: globalOidc.emailClaimName || "email",
        nameClaimName: globalOidc.nameClaimName || "name",
      });
    } catch (err: unknown) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));

      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: "token_exchange_failed",
          errorDescription:
            "We could not complete the exchange with your identity provider. Please try again.",
        })
      ) {
        return;
      }

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

    // Resolve attached projects. No attachment => "default-all" mode.
    const attachments: Array<GlobalOIDCProject> =
      await GlobalOIDCProjectService.findBy({
        query: { globalOidcId: globalOidcId, isEnabled: true },
        select: { projectId: true, teams: { _id: true } },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    const isDefaultAllMode: boolean = attachments.length === 0;
    const isSignUpDisabled: boolean =
      Boolean(globalOidc.disableSignUpWithSso) || isDefaultAllMode;

    let alreadySavedUser: User | null = await UserService.findOneBy({
      query: { email: result.email },
      select: {
        _id: true,
        name: true,
        email: true,
        isMasterAdmin: true,
        isEmailVerified: true,
        profilePictureId: true,
        timezone: true,
      },
      props: { isRoot: true },
    });

    let isNewUser: boolean = false;

    if (!alreadySavedUser) {
      if (isSignUpDisabled) {
        if (
          respondToMobileSsoFailure({
            res,
            isMobileRequest,
            error: "invitation_required",
            errorDescription:
              "You must be invited to a project on this OneUptime instance before you can sign in with SSO. Please contact your administrator.",
          })
        ) {
          return;
        }

        return Response.render(req, res, MESSAGE_VIEW, {
          title: "You need to be invited.",
          message:
            "You must be invited to a project on this OneUptime instance before you can sign in with SSO. Please contact your administrator.",
        });
      }

      alreadySavedUser = await UserService.createByEmail({
        email: result.email,
        name: result.name || undefined,
        isEmailVerified: true,
        generateRandomPassword: true,
        props: { isRoot: true },
      });
      isNewUser = true;
    }

    if (!alreadySavedUser.isEmailVerified && !isNewUser) {
      await AuthenticationEmail.sendVerificationEmail(alreadySavedUser!);

      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: "email_not_verified",
          errorDescription:
            "Your email is not verified. We have sent you a verification link - please check your inbox, and your spam folder.",
        })
      ) {
        return;
      }

      return Response.render(req, res, MESSAGE_VIEW, {
        title: "Email not verified.",
        message:
          "Email is not verified. We have sent you an email with the verification link. Please do not forget to check spam.",
      });
    }

    if (!isDefaultAllMode) {
      for (const attachment of attachments) {
        if (!attachment.projectId) {
          continue;
        }

        if (!attachment.teams || attachment.teams.length === 0) {
          continue;
        }

        const teamMemberCount: PositiveNumber = await TeamMemberService.countBy(
          {
            query: {
              projectId: attachment.projectId,
              userId: alreadySavedUser!.id!,
            },
            props: { isRoot: true },
          },
        );

        if (teamMemberCount.toNumber() > 0) {
          continue;
        }

        for (const team of attachment.teams) {
          let teamMember: TeamMember = new TeamMember();
          teamMember.projectId = attachment.projectId;
          teamMember.userId = alreadySavedUser!.id!;
          teamMember.hasAcceptedInvitation = true;
          teamMember.invitationAcceptedAt = OneUptimeDate.getCurrentDate();
          teamMember.teamId = team.id!;

          teamMember = await TeamMemberService.create({
            data: teamMember,
            props: { isRoot: true, ignoreHooks: true },
          });
        }
      }
    }

    alreadySavedUser.email = result.email;

    await AccessTokenService.refreshUserAllPermissions(alreadySavedUser.id!);

    /*
     * A Global OIDC session is only useful if the user belongs to at least one
     * project (access is still gated per-project by team membership). In
     * default-all mode there is no JIT provisioning, so a brand-new member of
     * nothing is sent back with a clear message instead of an empty session.
     */
    const memberProjectCount: PositiveNumber = await TeamMemberService.countBy({
      query: { userId: alreadySavedUser.id! },
      props: { isRoot: true },
    });

    /*
     * When the admin has restricted this provider to its attached projects,
     * the session it is about to mint only authorizes those projects. Check
     * the user actually belongs to one of them BEFORE minting, otherwise the
     * login reports success and then every request is refused, with
     * re-authenticating producing an identical token - a dead end with no way
     * out from inside the product.
     */
    if (globalOidc.restrictToAttachedProjects && !isDefaultAllMode) {
      const governedProjectIds: Array<ObjectID> = attachments
        .filter((attachment: GlobalOIDCProject) => {
          return Boolean(attachment.projectId);
        })
        .map((attachment: GlobalOIDCProject) => {
          return attachment.projectId!;
        });

      const governedMembershipCount: PositiveNumber =
        governedProjectIds.length === 0
          ? new PositiveNumber(0)
          : await TeamMemberService.countBy({
              query: {
                userId: alreadySavedUser.id!,
                projectId: QueryHelper.any(governedProjectIds),
              },
              props: { isRoot: true },
            });

      if (governedMembershipCount.toNumber() === 0) {
        if (
          respondToMobileSsoFailure({
            res,
            isMobileRequest,
            error: "no_project_access",
            errorDescription:
              "This SSO provider does not grant access to any project you are a member of. Please contact your administrator.",
          })
        ) {
          return;
        }

        return Response.render(req, res, MESSAGE_VIEW, {
          title: "No project access.",
          message:
            "This SSO provider does not grant access to any project you are a member of. Please contact your administrator.",
        });
      }
    }

    if (memberProjectCount.toNumber() === 0) {
      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: "no_project_access",
          errorDescription:
            "You are not a member of any project on this OneUptime instance. Please contact your administrator to be invited.",
        })
      ) {
        return;
      }

      return Response.render(req, res, MESSAGE_VIEW, {
        title: "No project access.",
        message:
          "You are not a member of any project on this OneUptime instance. Please contact your administrator to be invited.",
      });
    }

    const sessionMetadata: SessionMetadata =
      await UserSessionService.createSession({
        userId: alreadySavedUser.id!,
        isGlobalLogin: false,
        ipAddress: getClientIp(req),
        userAgent: headerValueToString(req.headers["user-agent"]),
        ...extractDeviceInfo(req),
        additionalInfo: { globalOidcId: globalOidcId.toString() },
      });

    /*
     * One Global OIDC token (not bound to a project) satisfies SSO enforcement
     * for every project this user belongs to, now and in the future. This
     * replaces the previous per-project cookie fan-out (and its header-size
     * cap), and means projects created after login no longer require re-login.
     */
    const globalSsoToken: string = CookieUtil.getGlobalSSOToken({
      user: alreadySavedUser,
      ssoProviderId: globalOidcId,
      ssoProviderType: SsoProviderType.GlobalOIDC,
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
        },
        expiresInSeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
      });

      /*
       * Built through the shared helper so the SAML and OIDC routers cannot
       * drift apart on the param names the mobile app parses. The single
       * global SSO token is sent back as `globalSsoToken`; the app replays it
       * on every request as the `x-global-sso-token` header.
       */
      const deepLinkUrl: string = buildMobileSsoSuccessUrl({
        accessToken,
        refreshToken: sessionMetadata.refreshToken,
        refreshTokenExpiresAt: sessionMetadata.refreshTokenExpiresAt,
        userId: alreadySavedUser.id!.toString(),
        email: alreadySavedUser.email!.toString(),
        name: alreadySavedUser.name?.toString() || "",
        isMasterAdmin: Boolean(alreadySavedUser.isMasterAdmin),
        globalSsoToken,
      });

      logger.info(
        "User logged in with Global OIDC (mobile): " + result.email.toString(),
        getLogAttributesFromRequest(req as RequestLike),
      );

      return res.redirect(deepLinkUrl);
    }

    // Web: mint the standard user cookie + the single global SSO cookie.
    CookieUtil.setGlobalSSOCookie({
      user: alreadySavedUser,
      expressResponse: res,
      ssoProviderId: globalOidcId,
      ssoProviderType: SsoProviderType.GlobalOIDC,
    });

    CookieUtil.setUserCookie({
      expressResponse: res,
      user: alreadySavedUser,
      isGlobalLogin: false,
      sessionId: sessionMetadata.session.id!,
      refreshToken: sessionMetadata.refreshToken,
      refreshTokenExpiresAt: sessionMetadata.refreshTokenExpiresAt,
      accessTokenExpiresInSeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
    });

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    logger.info(
      "User logged in with Global OIDC: " + result.email.toString(),
      getLogAttributesFromRequest(req as RequestLike),
    );

    return Response.redirect(
      req,
      res,
      new URL(httpProtocol, host, new Route(DashboardRoute.toString())),
    );
  } catch (err) {
    logger.error(err, getLogAttributesFromRequest(req as RequestLike));

    /*
     * Last resort. An unexpected server error must still leave the mobile
     * browser on the deep link, otherwise the app waits out the auth session
     * and reports a cancellation the user cannot act on.
     */
    if (
      respondToMobileSsoFailure({
        res,
        isMobileRequest: isMobileSsoRequest({ req }),
        error: "sso_failed",
        errorDescription:
          "Something went wrong while signing you in. Please try again.",
      })
    ) {
      return;
    }

    Response.sendErrorResponse(req, res, err as Exception);
  }
};

export default router;
