import AuthenticationEmail from "../Utils/AuthenticationEmail";
import OIDCUtil, { OidcCallbackResult } from "../Utils/OIDC";
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
const MAX_SSO_COOKIES: number = 25;

const MESSAGE_VIEW: string =
  "/usr/src/app/FeatureSet/Identity/Views/Message.ejs";

const getGlobalOidcStateCookieName: (globalOidcId: ObjectID) => string = (
  globalOidcId: ObjectID,
): string => {
  return `global-oidc-state-${globalOidcId.toString()}`;
};

type GetMemberProjectIdsFunction = (
  userId: ObjectID,
) => Promise<Array<ObjectID>>;

const getMemberProjectIds: GetMemberProjectIdsFunction = async (
  userId: ObjectID,
): Promise<Array<ObjectID>> => {
  const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
    query: { userId: userId },
    select: { projectId: true },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: { isRoot: true },
  });

  const seen: Set<string> = new Set<string>();
  const projectIds: Array<ObjectID> = [];

  for (const teamMember of teamMembers) {
    const id: string | undefined = teamMember.projectId?.toString();
    if (id && !seen.has(id)) {
      seen.add(id);
      projectIds.push(teamMember.projectId!);
    }
  }

  return projectIds;
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

      const isMobileRequest: boolean = req.query["mobile"] === "true";

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
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Global OIDC ID not found"),
      );
    }

    const globalOidcId: ObjectID = new ObjectID(req.params["globalOidcId"]);

    const stateCookieName: string = getGlobalOidcStateCookieName(globalOidcId);
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

    try {
      const decoded: Record<string, unknown> = JSONWebToken.decodeJsonPayload(
        stateCookieValue,
      ) as unknown as Record<string, unknown>;

      storedState = decoded["state"] as string;
      storedNonce = decoded["nonce"] as string;
      storedCodeVerifier = decoded["codeVerifier"] as string;
      isMobileRequest = Boolean(decoded["isMobile"]);
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

    if (
      !globalOidc.discoveryURL ||
      !globalOidc.issuerURL ||
      !globalOidc.clientId ||
      !globalOidc.clientSecret
    ) {
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

    const memberProjectIds: Array<ObjectID> = await getMemberProjectIds(
      alreadySavedUser.id!,
    );

    if (memberProjectIds.length === 0) {
      return Response.render(req, res, MESSAGE_VIEW, {
        title: "No project access.",
        message:
          "You are not a member of any project on this OneUptime instance. Please contact your administrator to be invited.",
      });
    }

    const cappedProjectIds: Array<ObjectID> = memberProjectIds.slice(
      0,
      MAX_SSO_COOKIES,
    );

    if (memberProjectIds.length > MAX_SSO_COOKIES) {
      logger.warn(
        `Global OIDC login for ${result.email.toString()} resolved into ${memberProjectIds.length} projects; capping per-project SSO cookies at ${MAX_SSO_COOKIES}.`,
      );
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

      const ssoTokens: Record<string, string> = {};
      for (const projectId of cappedProjectIds) {
        ssoTokens[projectId.toString()] = CookieUtil.getSSOToken({
          user: alreadySavedUser,
          projectId: projectId,
          ssoProviderId: globalOidcId,
          ssoProviderType: SsoProviderType.GlobalOIDC,
        });
      }

      const params: URLSearchParams = new URLSearchParams();
      params.set("accessToken", accessToken);
      params.set("refreshToken", sessionMetadata.refreshToken);
      params.set(
        "refreshTokenExpiresAt",
        sessionMetadata.refreshTokenExpiresAt.toISOString(),
      );
      params.set("userId", alreadySavedUser.id!.toString());
      params.set("email", alreadySavedUser.email!.toString());
      params.set("name", alreadySavedUser.name?.toString() || "");
      params.set(
        "isMasterAdmin",
        String(alreadySavedUser.isMasterAdmin || false),
      );
      params.set("ssoTokens", JSON.stringify(ssoTokens));
      const firstProjectId: ObjectID | undefined = cappedProjectIds[0];
      if (firstProjectId) {
        params.set("ssoToken", ssoTokens[firstProjectId.toString()] as string);
        params.set("projectId", firstProjectId.toString());
      }

      const deepLinkUrl: string = `oneuptime://sso-callback?${params.toString()}`;

      logger.info(
        "User logged in with Global OIDC (mobile): " + result.email.toString(),
        getLogAttributesFromRequest(req as RequestLike),
      );

      return res.redirect(deepLinkUrl);
    }

    for (const projectId of cappedProjectIds) {
      CookieUtil.setSSOCookie({
        user: alreadySavedUser,
        projectId: projectId,
        expressResponse: res,
        ssoProviderId: globalOidcId,
        ssoProviderType: SsoProviderType.GlobalOIDC,
      });
    }

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
    Response.sendErrorResponse(req, res, err as Exception);
  }
};

export default router;
