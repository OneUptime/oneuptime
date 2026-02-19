import AuthenticationEmail from "../Utils/AuthenticationEmail";
import SSOUtil from "../Utils/SSO";
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
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import ProjectSSOService from "Common/Server/Services/ProjectSsoService";
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
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import xml2js from "xml2js";
import Name from "Common/Types/Name";

const router: ExpressRouter = Express.getRouter();

const ACCESS_TOKEN_EXPIRY_SECONDS: number = 15 * 60;

/*
 * This route is used to get the SSO config for the user.
 * when the user logs in from OneUptime and not from the IDP.
 */

router.get(
  "/service-provider-login",
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

      if (!email) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Email is required"),
        );
      }

      // get sso config for this user.

      const user: User | null = await UserService.findOneBy({
        query: { email: email },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!user) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("No SSO config found for this user"),
        );
      }

      const userId: ObjectID = user.id!;

      if (!userId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("No SSO config found for this user"),
        );
      }

      const projectUserBelongsTo: Array<ObjectID> = (
        await TeamMemberService.findBy({
          query: { userId: userId },
          select: {
            projectId: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        })
      ).map((teamMember: TeamMember) => {
        return teamMember.projectId!;
      });

      if (projectUserBelongsTo.length === 0) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("No SSO config found for this user"),
        );
      }

      const projectSSOList: Array<ProjectSSO> = await ProjectSSOService.findBy({
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
          project: {
            name: true,
          } as Select<Project>,
        },
        props: {
          isRoot: true,
        },
      });

      return Response.sendEntityArrayResponse(
        req,
        res,
        projectSSOList,
        projectSSOList.length,
        ProjectSSO,
      );
    } catch (err) {
      logger.error(err);

      if (err instanceof Exception) {
        return next(err);
      }

      return next(new ServerException());
    }
  },
);

router.get(
  "/sso/:projectId/:projectSsoId",
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

      if (!req.params["projectSsoId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Project SSO ID not found"),
        );
      }

      const projectSSO: ProjectSSO | null = await ProjectSSOService.findOneBy({
        query: {
          projectId: new ObjectID(req.params["projectId"]),
          _id: req.params["projectSsoId"],
          isEnabled: true,
        },
        select: {
          _id: true,
          signOnURL: true,
          issuerURL: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!projectSSO) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SSO Config not found"),
        );
      }

      // redirect to Identity Provider.

      if (!projectSSO.signOnURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Sign On URL not found"),
        );
      }

      if (!projectSSO.issuerURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Issuer not found"),
        );
      }

      const isMobileRequest: boolean = req.query["mobile"] === "true";

      const samlRequestUrl: URL = SSOUtil.createSAMLRequestUrl({
        acsUrl: URL.fromString(
          `${HttpProtocol}${Host}/identity/idp-login/${projectSSO.projectId?.toString()}/${projectSSO.id?.toString()}`,
        ),
        signOnUrl: projectSSO.signOnURL!,
        issuerUrl: URL.fromString(
          `${HttpProtocol}${Host}/${projectSSO.projectId?.toString()}/${projectSSO.id?.toString()}`,
        ),
      });

      if (isMobileRequest) {
        samlRequestUrl.addQueryParam("RelayState", "mobile");
      }

      return Response.redirect(req, res, samlRequestUrl);
    } catch (err) {
      logger.error(err);

      if (err instanceof Exception) {
        return next(err);
      }

      return next(new ServerException());
    }
  },
);

router.get(
  "/idp-login/:projectId/:projectSsoId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await loginUserWithSso(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/idp-login/:projectId/:projectSsoId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await loginUserWithSso(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

type LoginUserWithSsoFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<void>;

const loginUserWithSso: LoginUserWithSsoFunction = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> => {
  try {
    const samlResponseBase64: string = req.body.SAMLResponse;

    if (!samlResponseBase64) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("SAMLResponse not found"),
      );
    }

    const samlResponse: string = Buffer.from(
      samlResponseBase64,
      "base64",
    ).toString();

    const response: JSONObject = await xml2js.parseStringPromise(samlResponse);

    let issuerUrl: string = "";
    let email: Email | null = null;
    let fullName: Name | null = null;

    if (!req.params["projectId"]) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Project ID not found"),
      );
    }

    if (!req.params["projectSsoId"]) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Project SSO ID not found"),
      );
    }

    const projectSSO: ProjectSSO | null = await ProjectSSOService.findOneBy({
      query: {
        projectId: new ObjectID(req.params["projectId"]),
        _id: req.params["projectSsoId"],
        isEnabled: true,
      },
      select: {
        signOnURL: true,
        issuerURL: true,
        publicCertificate: true,
        teams: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!projectSSO) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("SSO Config not found"),
      );
    }

    // redirect to Identity Provider.

    if (!projectSSO.issuerURL) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Issuer URL not found"),
      );
    }

    // redirect to Identity Provider.

    if (!projectSSO.signOnURL) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Sign on URL not found"),
      );
    }

    if (!projectSSO.publicCertificate) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Public Certificate not found"),
      );
    }

    try {
      SSOUtil.isPayloadValid(response);

      if (
        !SSOUtil.isSignatureValid(samlResponse, projectSSO.publicCertificate)
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "Signature is not valid or Public Certificate configured with this SSO provider is not valid",
          ),
        );
      }

      issuerUrl = SSOUtil.getIssuer(response);
      email = SSOUtil.getEmail(response);
      fullName = SSOUtil.getUserFullName(response);
    } catch (err: unknown) {
      if (err instanceof Exception) {
        return Response.sendErrorResponse(req, res, err);
      }
      return Response.sendErrorResponse(req, res, new ServerException());
    }

    if (projectSSO.issuerURL.toString() !== issuerUrl) {
      logger.error(
        "Issuer URL does not match. It should be " +
          projectSSO.issuerURL.toString() +
          " but it is " +
          issuerUrl.toString(),
      );
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Issuer URL does not match"),
      );
    }

    // Check if he already belongs to the project, If he does - then log in.

    let alreadySavedUser: User | null = await UserService.findOneBy({
      query: { email: email },
      select: {
        _id: true,
        name: true,
        email: true,
        isMasterAdmin: true,
        isEmailVerified: true,
        profilePictureId: true,
        timezone: true,
      },
      props: {
        isRoot: true,
      },
    });

    let isNewUser: boolean = false;

    if (!alreadySavedUser) {
      // this should never happen because user is logged in before he signs in with SSO UNLESS he initiates the login though the IDP.

      /// Create a user.

      alreadySavedUser = await UserService.createByEmail({
        email,
        name: fullName || undefined,
        isEmailVerified: true,
        generateRandomPassword: true,
        props: {
          isRoot: true,
        },
      });

      isNewUser = true;
    }

    /*
     * If he does not then add him to teams that he should belong and log in.
     * This should never happen because email is verified before he logs in with SSO.
     */
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

    // check if the user already belongs to the project
    const teamMemberCount: PositiveNumber = await TeamMemberService.countBy({
      query: {
        projectId: new ObjectID(req.params["projectId"] as string),
        userId: alreadySavedUser!.id!,
      },
      props: {
        isRoot: true,
      },
    });

    if (teamMemberCount.toNumber() === 0) {
      // user not in project, add him to default teams.

      if (!projectSSO.teams || projectSSO.teams.length === 0) {
        return Response.render(
          req,
          res,
          "/usr/src/app/FeatureSet/Identity/Views/Message.ejs",
          {
            title: "No teams added.",
            message:
              "No teams have been added to this SSO config. Please contact your admin and have default teams added.",
          },
        );
      }

      for (const team of projectSSO.teams) {
        // add user to team
        let teamMember: TeamMember = new TeamMember();
        teamMember.projectId = new ObjectID(req.params["projectId"] as string);
        teamMember.userId = alreadySavedUser.id!;
        teamMember.hasAcceptedInvitation = true;
        teamMember.invitationAcceptedAt = OneUptimeDate.getCurrentDate();
        teamMember.teamId = team.id!;

        teamMember = await TeamMemberService.create({
          data: teamMember,
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
      }
    }

    const projectId: ObjectID = new ObjectID(req.params["projectId"] as string);
    const isMobileRequest: boolean =
      req.body.RelayState === "mobile" || req.query["RelayState"] === "mobile";

    alreadySavedUser.email = email;

    // Refresh Permissions for this user here.
    await AccessTokenService.refreshUserAllPermissions(alreadySavedUser.id!);

    const sessionMetadata: SessionMetadata =
      await UserSessionService.createSession({
        userId: alreadySavedUser.id!,
        isGlobalLogin: false,
        ipAddress: getClientIp(req),
        userAgent: headerValueToString(req.headers["user-agent"]),
        ...extractDeviceInfo(req),
        additionalInfo: {
          projectId: projectId.toString(),
        },
      });

    if (isMobileRequest) {
      // For mobile SSO, generate an access token and redirect to the app deep link
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

      const deepLinkUrl: string = `oneuptime://sso-callback?${params.toString()}`;

      logger.info("User logged in with SSO (mobile): " + email.toString());

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

    logger.info("User logged in with SSO: " + email.toString());

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
    logger.error(err);

    Response.sendErrorResponse(req, res, err as Exception);
  }
};

export default router;
