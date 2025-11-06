import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { FileRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import { EncryptionSecret } from "Common/Server/EnvironmentConfig";
import MailService from "Common/Server/Services/MailService";
import StatusPagePrivateUserService from "Common/Server/Services/StatusPagePrivateUserService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import CookieUtil from "Common/Server/Utils/Cookie";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import JSONWebToken, {
  RefreshTokenData,
} from "Common/Server/Utils/JsonWebToken";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import HashedString from "Common/Types/HashedString";
import Dictionary from "Common/Types/Dictionary";
import JSONWebTokenData from "Common/Types/JsonWebTokenData";

const router: ExpressRouter = Express.getRouter();

router.post(
  "/logout/:statuspageid",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.params["statuspageid"]) {
        throw new BadDataException("Status Page ID is required.");
      }

      const statusPageId: ObjectID = new ObjectID(
        req.params["statuspageid"].toString(),
      );

      const refreshTokenKey: string = CookieUtil.getRefreshTokenKey(statusPageId);
      const accessTokenKey: string = CookieUtil.getUserTokenKey(statusPageId);

      const refreshToken: string | undefined =
        CookieUtil.getCookieFromExpressRequest(req, refreshTokenKey);

      let userIdToInvalidate: ObjectID | null = null;

      if (refreshToken) {
        try {
          const refreshData: RefreshTokenData =
            JSONWebToken.decodeRefreshToken(refreshToken);

          if (
            refreshData.statusPageId &&
            refreshData.statusPageId.toString() === statusPageId.toString()
          ) {
            userIdToInvalidate = refreshData.userId;
          }
        } catch (err) {
          const error: Error = err as Error;
          logger.warn(
            `Failed to decode status page refresh token during logout: ${
              error.message || "unknown error"
            }`,
          );
          logger.debug(error);
        }
      }

      if (!userIdToInvalidate) {
        const accessToken: string | undefined =
          CookieUtil.getCookieFromExpressRequest(req, accessTokenKey);

        if (accessToken) {
          try {
            const decoded: JSONWebTokenData = JSONWebToken.decode(accessToken);

            if (
              decoded.statusPageId &&
              decoded.statusPageId.toString() === statusPageId.toString()
            ) {
              userIdToInvalidate = decoded.userId;
            }
          } catch (err) {
            const error: Error = err as Error;
            logger.warn(
              `Failed to decode status page access token during logout: ${
                error.message || "unknown error"
              }`,
            );
            logger.debug(error);
          }
        }
      }

      if (userIdToInvalidate) {
        await StatusPagePrivateUserService.updateOneBy({
          query: {
            _id: userIdToInvalidate,
            statusPageId: statusPageId,
          },
          data: {
            jwtRefreshToken: null!,
          },
          props: {
            isRoot: true,
          },
        });
      }

      CookieUtil.removeCookie(res, accessTokenKey);
      CookieUtil.removeCookie(res, refreshTokenKey);

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/forgot-password",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data: JSONObject = req.body["data"];

      if (!data["email"]) {
        throw new BadDataException("Email is required.");
      }

      const user: StatusPagePrivateUser = BaseModel.fromJSON(
        data as JSONObject,
        StatusPagePrivateUser,
      ) as StatusPagePrivateUser;

      if (!user.statusPageId) {
        throw new BadDataException("Status Page ID is required.");
      }

      const statusPage: StatusPage | null = await StatusPageService.findOneById(
        {
          id: user.statusPageId!,
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
          select: {
            _id: true,
            name: true,
            pageTitle: true,
            logoFileId: true,
            requireSsoForLogin: true,
            projectId: true,
          },
        },
      );

      if (!statusPage) {
        throw new BadDataException("Status Page not found");
      }

      if (statusPage.requireSsoForLogin) {
        throw new BadDataException(
          "Status Page supports authentication by SSO. You cannot use email and password for authentication.",
        );
      }

      const statusPageName: string | undefined =
        statusPage.pageTitle || statusPage.name;

      const statusPageURL: string = await StatusPageService.getStatusPageURL(
        statusPage.id!,
      );

      const alreadySavedUser: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: {
            email: user.email!,
            statusPageId: user.statusPageId!,
          },
          select: {
            _id: true,
            password: true,
            email: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (alreadySavedUser) {
        const token: string = ObjectID.generate().toString();
        await StatusPagePrivateUserService.updateOneBy({
          query: {
            _id: alreadySavedUser._id!,
          },
          data: {
            resetPasswordToken: token,
            resetPasswordExpires: OneUptimeDate.getOneDayAfter(),
          },
          props: {
            isRoot: true,
          },
        });

        const host: Hostname = await DatabaseConfig.getHost();
        const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

        MailService.sendMail(
          {
            toEmail: user.email!,
            subject: "Password Reset Request for " + statusPageName,
            templateType: EmailTemplateType.StatusPageForgotPassword,
            vars: {
              statusPageName: statusPageName!,
              logoUrl: statusPage.logoFileId
                ? new URL(httpProtocol, host)
                    .addRoute(FileRoute)
                    .addRoute("/image/" + statusPage.logoFileId)
                    .toString()
                : "",
              homeURL: statusPageURL,
              tokenVerifyUrl: URL.fromString(statusPageURL)
                .addRoute("/reset-password/" + token)
                .toString(),
            },
          },
          {
            projectId: statusPage.projectId!,
            statusPageId: statusPage.id!,
          },
        ).catch((err: Error) => {
          logger.error(err);
        });

        return Response.sendEmptySuccessResponse(req, res);
      }

      throw new BadDataException(
        `No user is registered with ${user.email?.toString()}`,
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/reset-password",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data: JSONObject = JSONFunctions.deserialize(req.body["data"]);

      if (!data["statusPageId"]) {
        throw new BadDataException("Status Page ID is required.");
      }

      const user: StatusPagePrivateUser = BaseModel.fromJSON(
        data as JSONObject,
        StatusPagePrivateUser,
      ) as StatusPagePrivateUser;

      await user.password?.hashValue(EncryptionSecret);

      const alreadySavedUser: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: {
            statusPageId: new ObjectID(data["statusPageId"].toString()),
            resetPasswordToken: (user.resetPasswordToken as string) || "",
          },
          select: {
            _id: true,
            password: true,
            email: true,
            resetPasswordExpires: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!alreadySavedUser) {
        throw new BadDataException(
          "Invalid link. Please go to forgot password page again and request a new link.",
        );
      }

      if (
        alreadySavedUser &&
        OneUptimeDate.hasExpired(alreadySavedUser.resetPasswordExpires!)
      ) {
        throw new BadDataException(
          "Expired link. Please go to forgot password page again and request a new link.",
        );
      }

      const statusPage: StatusPage | null = await StatusPageService.findOneById(
        {
          id: new ObjectID(data["statusPageId"].toString()),
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
          select: {
            _id: true,
            name: true,
            pageTitle: true,
            logoFileId: true,
            requireSsoForLogin: true,
            projectId: true,
          },
        },
      );

      if (!statusPage) {
        throw new BadDataException("Status Page not found");
      }

      if (statusPage.requireSsoForLogin) {
        throw new BadDataException(
          "Status Page supports authentication by SSO. You cannot use email and password for authentication.",
        );
      }

      const statusPageName: string | undefined =
        statusPage.pageTitle || statusPage.name;

      const statusPageURL: string = await StatusPageService.getStatusPageURL(
        statusPage.id!,
      );

      await StatusPagePrivateUserService.updateOneById({
        id: alreadySavedUser.id!,
        data: {
          password: user.password!,
          resetPasswordToken: null!,
          resetPasswordExpires: null!,
        },
        props: {
          isRoot: true,
        },
      });

      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      MailService.sendMail(
        {
          toEmail: alreadySavedUser.email!,
          subject: "Password Changed.",
          templateType: EmailTemplateType.StatusPagePasswordChanged,
          vars: {
            homeURL: statusPageURL,
            statusPageName: statusPageName || "",
            logoUrl: statusPage.logoFileId
              ? new URL(httpProtocol, host)
                  .addRoute(FileRoute)
                  .addRoute("/image/" + statusPage.logoFileId)
                  .toString()
              : "",
          },
        },
        {
          projectId: statusPage.projectId!,
          statusPageId: statusPage.id!,
        },
      ).catch((err: Error) => {
        logger.error(err);
      });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/login",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data: JSONObject = req.body["data"];

      const user: StatusPagePrivateUser = BaseModel.fromJSON(
        data as JSONObject,
        StatusPagePrivateUser,
      ) as StatusPagePrivateUser;

      if (!user.statusPageId) {
        throw new BadDataException("Status Page ID not found");
      }

      const statusPage: StatusPage | null = await StatusPageService.findOneById(
        {
          id: user.statusPageId,
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
          select: {
            requireSsoForLogin: true,
          },
        },
      );

      if (!statusPage) {
        throw new BadDataException("Status Page not found");
      }

      if (statusPage.requireSsoForLogin) {
        throw new BadDataException(
          "Status Page supports authentication by SSO. You cannot use email and password for authentication.",
        );
      }

      await user.password?.hashValue(EncryptionSecret);

      const alreadySavedUser: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: {
            email: user.email!,
            password: user.password!,
            statusPageId: user.statusPageId!,
          },
          select: {
            _id: true,
            password: true,
            email: true,
            statusPageId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (alreadySavedUser) {
        const session = CookieUtil.setStatusPageUserCookie({
          expressResponse: res,
          user: alreadySavedUser,
          statusPageId: alreadySavedUser.statusPageId!,
        });

        if (!req.cookies) {
          req.cookies = {} as Dictionary<string>;
        }

        req.cookies[CookieUtil.getUserTokenKey(alreadySavedUser.statusPageId!)] =
          session.accessToken;
        req.cookies[
          CookieUtil.getRefreshTokenKey(alreadySavedUser.statusPageId!)
        ] = session.refreshToken;

        const hashedSessionId: string = await HashedString.hashValue(
          session.sessionId,
          EncryptionSecret,
        );

        await StatusPagePrivateUserService.updateOneBy({
          query: {
            _id: alreadySavedUser.id!,
            statusPageId: alreadySavedUser.statusPageId!,
          },
          data: {
            jwtRefreshToken: hashedSessionId,
            lastActive: OneUptimeDate.getCurrentDate(),
          },
          props: {
            isRoot: true,
          },
        });

        return Response.sendEntityResponse(
          req,
          res,
          alreadySavedUser,
          StatusPagePrivateUser,
          {
            miscData: {
              accessToken: session.accessToken,
              refreshToken: session.refreshToken,
              accessTokenExpiresInSeconds: session.accessTokenExpiresInSeconds,
              refreshTokenExpiresInSeconds:
                session.refreshTokenExpiresInSeconds,
            },
          },
        );
      }
      throw new BadDataException(
        "Invalid login: Email or password does not match.",
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/refresh-session/:statuspageid",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.params["statuspageid"]) {
        throw new BadDataException("Status Page ID is required.");
      }

      const statusPageId: ObjectID = new ObjectID(
        req.params["statuspageid"].toString(),
      );

      const refreshTokenKey: string = CookieUtil.getRefreshTokenKey(statusPageId);
      const accessTokenKey: string = CookieUtil.getUserTokenKey(statusPageId);

      const refreshToken: string | undefined =
        CookieUtil.getCookieFromExpressRequest(req, refreshTokenKey);

      if (!refreshToken) {
        CookieUtil.removeCookie(res, refreshTokenKey);
        CookieUtil.removeCookie(res, accessTokenKey);
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException("Refresh token missing."),
        );
      }

      let refreshTokenData: RefreshTokenData;

      try {
        refreshTokenData = JSONWebToken.decodeRefreshToken(refreshToken);
      } catch (err) {
        const error: Error = err as Error;
        logger.warn(
          `Failed to decode status page refresh token: ${
            error.message || "unknown error"
          }`,
        );
        logger.debug(error);
        CookieUtil.removeCookie(res, refreshTokenKey);
        CookieUtil.removeCookie(res, accessTokenKey);
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException("Refresh token is invalid."),
        );
      }

      if (
        !refreshTokenData.statusPageId ||
        refreshTokenData.statusPageId.toString() !== statusPageId.toString()
      ) {
        CookieUtil.removeCookie(res, refreshTokenKey);
        CookieUtil.removeCookie(res, accessTokenKey);
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException("Refresh token status page mismatch."),
        );
      }

      const hashedSessionId: string = await HashedString.hashValue(
        refreshTokenData.sessionId,
        EncryptionSecret,
      );

      const user: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: {
            _id: refreshTokenData.userId,
            statusPageId: statusPageId,
            jwtRefreshToken: hashedSessionId,
          },
          select: {
            _id: true,
            email: true,
            statusPageId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!user) {
        CookieUtil.removeCookie(res, refreshTokenKey);
        CookieUtil.removeCookie(res, accessTokenKey);
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException("Refresh token does not match."),
        );
      }

      const session = CookieUtil.setStatusPageUserCookie({
        expressResponse: res,
        user: user,
        statusPageId: statusPageId,
      });

      if (!req.cookies) {
        req.cookies = {} as Dictionary<string>;
      }

      req.cookies[accessTokenKey] = session.accessToken;
      req.cookies[refreshTokenKey] = session.refreshToken;

      const hashedNewSessionId: string = await HashedString.hashValue(
        session.sessionId,
        EncryptionSecret,
      );

      await StatusPagePrivateUserService.updateOneBy({
        query: {
          _id: user.id!,
          statusPageId: statusPageId,
        },
        data: {
          jwtRefreshToken: hashedNewSessionId,
          lastActive: OneUptimeDate.getCurrentDate(),
        },
        props: {
          isRoot: true,
        },
      });

      logger.info(
        `Status page session refreshed: ${
          user.email?.toString() || user.id?.toString() || "unknown"
        } for status page ${statusPageId.toString()}`,
      );

      return Response.sendEntityResponse(
        req,
        res,
        user,
        StatusPagePrivateUser,
        {
          miscData: {
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            accessTokenExpiresInSeconds: session.accessTokenExpiresInSeconds,
            refreshTokenExpiresInSeconds: session.refreshTokenExpiresInSeconds,
          },
        },
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
