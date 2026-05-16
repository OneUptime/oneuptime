import AuthenticationEmail from "../Utils/AuthenticationEmail";
import OIDCUtil, { OidcCallbackResult } from "../Utils/OIDC";
import { DashboardRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
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
import UserService from "Common/Server/Services/UserService";
import UserSessionService, {
  SessionMetadata,
} from "Common/Server/Services/UserSessionService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
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
import Project from "Common/Models/DatabaseModels/Project";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import { Client } from "openid-client";

const router: ExpressRouter = Express.getRouter();

const ACCESS_TOKEN_EXPIRY_SECONDS: number = 15 * 60;
const OIDC_STATE_COOKIE_TTL_SECONDS: number = 10 * 60;

const getOidcStateCookieName: (projectOidcId: ObjectID) => string = (
  projectOidcId: ObjectID,
): string => {
  return `oidc-state-${projectOidcId.toString()}`;
};

/*
 * This route is used to get the OIDC config for the user.
 * when the user logs in from OneUptime and not from the IDP.
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

      const user: User | null = await UserService.findOneBy({
        query: { email: email },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!user) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("No OIDC config found for this user"),
        );
      }

      const userId: ObjectID = user.id!;

      const projectUserBelongsTo: Array<ObjectID> = (
        await TeamMemberService.findBy({
          query: { userId: userId },
          select: { projectId: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        })
      ).map((teamMember: TeamMember) => {
        return teamMember.projectId!;
      });

      if (projectUserBelongsTo.length === 0) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("No OIDC config found for this user"),
        );
      }

      const projectOidcList: Array<ProjectOIDC> =
        await ProjectOidcService.findBy({
          query: {
            projectId: QueryHelper.any(projectUserBelongsTo),
            isEnabled: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            name: true,
            description: true,
            _id: true,
            projectId: true,
            project: { name: true } as Select<Project>,
          },
          props: { isRoot: true },
        });

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

    // Always clear the state cookie once we've read it.
    CookieUtil.removeCookie(res, stateCookieName);

    const projectOidc: ProjectOIDC | null = await ProjectOidcService.findOneBy({
      query: {
        projectId: new ObjectID(req.params["projectId"]),
        _id: req.params["projectOidcId"],
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
        teams: { _id: true },
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

    // Find or create user.
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

      return Response.render(
        req,
        res,
        "/usr/src/app/FeatureSet/Identity/Views/Message.ejs",
        {
          title: "Email not verified.",
          message:
            "Email is not verified. We have sent you an email with the verification link. Please do not forget to check spam.",
        },
      );
    }

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

      for (const team of projectOidc.teams) {
        let teamMember: TeamMember = new TeamMember();
        teamMember.projectId = new ObjectID(req.params["projectId"] as string);
        teamMember.userId = alreadySavedUser.id!;
        teamMember.hasAcceptedInvitation = true;
        teamMember.invitationAcceptedAt = OneUptimeDate.getCurrentDate();
        teamMember.teamId = team.id!;

        teamMember = await TeamMemberService.create({
          data: teamMember,
          props: { isRoot: true, ignoreHooks: true },
        });
      }
    }

    const projectId: ObjectID = new ObjectID(req.params["projectId"] as string);

    alreadySavedUser.email = result.email;

    await AccessTokenService.refreshUserAllPermissions(alreadySavedUser.id!);

    const sessionMetadata: SessionMetadata =
      await UserSessionService.createSession({
        userId: alreadySavedUser.id!,
        isGlobalLogin: false,
        ipAddress: getClientIp(req),
        userAgent: headerValueToString(req.headers["user-agent"]),
        ...extractDeviceInfo(req),
        additionalInfo: { projectId: projectId.toString() },
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

      const ssoToken: string = JSONWebToken.sign({
        data: {
          userId: alreadySavedUser.id!,
          projectId: projectId,
          name: alreadySavedUser.name!,
          email: alreadySavedUser.email,
          isMasterAdmin: false,
          isGeneralLogin: false,
        },
        expiresInSeconds: OneUptimeDate.getSecondsInDays(
          new PositiveNumber(30),
        ),
      });

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
      params.set("ssoToken", ssoToken);
      params.set("projectId", projectId.toString());

      const deepLinkUrl: string = `oneuptime://sso-callback?${params.toString()}`;

      logger.info(
        "User logged in with OIDC (mobile): " + result.email.toString(),
        getLogAttributesFromRequest(req as RequestLike),
      );

      return res.redirect(deepLinkUrl);
    }

    CookieUtil.setSSOCookie({
      user: alreadySavedUser,
      projectId: projectId,
      expressResponse: res,
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
