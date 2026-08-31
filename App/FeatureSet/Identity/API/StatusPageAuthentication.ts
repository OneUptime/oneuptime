import CredentialGuard from "../Utils/CredentialGuard";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { StatusPageApiRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import HashedString from "Common/Types/HashedString";
import ObjectID from "Common/Types/ObjectID";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import { EncryptionSecret } from "Common/Server/EnvironmentConfig";
import MailService from "Common/Server/Services/MailService";
import ProjectSMTPConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import StatusPagePrivateUserService from "Common/Server/Services/StatusPagePrivateUserService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPagePrivateUserSessionService, {
  SessionMetadata as StatusPageSessionMetadata,
} from "Common/Server/Services/StatusPagePrivateUserSessionService";
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
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import StatusPagePrivateUserSession from "Common/Models/DatabaseModels/StatusPagePrivateUserSession";
import { MASTER_PASSWORD_COOKIE_IDENTIFIER } from "Common/Types/StatusPage/MasterPassword";

const router: ExpressRouter = Express.getRouter();

const ACCESS_TOKEN_EXPIRY_SECONDS: number = 15 * 60;

type MasterPasswordAuthInput = {
  req: ExpressRequest;
  res?: ExpressResponse;
  statusPageId: ObjectID;
};

const hasValidMasterPasswordSession: (
  data: MasterPasswordAuthInput,
) => boolean = (data: MasterPasswordAuthInput): boolean => {
  const token: string | undefined = CookieUtil.getCookieFromExpressRequest(
    data.req,
    CookieUtil.getStatusPageMasterPasswordKey(data.statusPageId),
  );

  if (!token) {
    return false;
  }

  try {
    const payload: JSONObject = JSONWebToken.decodeJsonPayload(token);

    return (
      payload["statusPageId"] === data.statusPageId.toString() &&
      payload["type"] === MASTER_PASSWORD_COOKIE_IDENTIFIER
    );
  } catch (err) {
    logger.error(err, getLogAttributesFromRequest(data.req as RequestLike));
  }

  return false;
};

const respondWithMasterPasswordAccess: (
  data: MasterPasswordAuthInput & { res: ExpressResponse },
) => boolean = (
  data: MasterPasswordAuthInput & { res: ExpressResponse },
): boolean => {
  if (!hasValidMasterPasswordSession(data)) {
    return false;
  }

  Response.sendEmptySuccessResponse(data.req, data.res);
  return true;
};

type FinalizeStatusPageLoginInput = {
  req: ExpressRequest;
  res: ExpressResponse;
  user: StatusPagePrivateUser;
};

const finalizeStatusPageLogin: (data: FinalizeStatusPageLoginInput) => Promise<{
  sessionMetadata: StatusPageSessionMetadata;
  accessToken: string;
}> = async (
  data: FinalizeStatusPageLoginInput,
): Promise<{
  sessionMetadata: StatusPageSessionMetadata;
  accessToken: string;
}> => {
  const { req, res, user } = data;

  if (!user.projectId) {
    throw new BadDataException(
      "Status page user is missing associated projectId.",
    );
  }

  if (!user.statusPageId) {
    throw new BadDataException(
      "Status page user is missing associated statusPageId.",
    );
  }

  const sessionMetadata: StatusPageSessionMetadata =
    await StatusPagePrivateUserSessionService.createSession({
      projectId: user.projectId,
      statusPageId: user.statusPageId,
      statusPagePrivateUserId: user.id!,
      ipAddress: getClientIp(req),
      userAgent: headerValueToString(req.headers["user-agent"]),
      ...extractDeviceInfo(req),
    });

  const accessToken: string = CookieUtil.setStatusPagePrivateUserCookie({
    expressResponse: res,
    user,
    statusPageId: user.statusPageId,
    sessionId: sessionMetadata.session.id!,
    refreshToken: sessionMetadata.refreshToken,
    refreshTokenExpiresAt: sessionMetadata.refreshTokenExpiresAt,
    accessTokenExpiresInSeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
  });

  return {
    sessionMetadata,
    accessToken,
  };
};

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

      const refreshToken: string | undefined =
        CookieUtil.getRefreshTokenFromExpressRequest(req, statusPageId);

      if (refreshToken) {
        await StatusPagePrivateUserSessionService.revokeSessionByRefreshToken(
          refreshToken,
          {
            reason: "User logged out",
          },
        );
      }

      CookieUtil.removeCookie(res, CookieUtil.getUserTokenKey(statusPageId));
      CookieUtil.removeCookie(res, CookieUtil.getRefreshTokenKey(statusPageId));
      CookieUtil.removeStatusPageMasterPasswordCookie(res, statusPageId);

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/exchange-login-code/:statuspageid",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      Response.setNoCacheHeaders(res);

      const statusPageIdParam: string | undefined = req.params["statuspageid"];
      const loginCode: unknown = req.body["loginCode"];

      if (!statusPageIdParam || !ObjectID.isValidUUID(statusPageIdParam)) {
        throw new BadDataException("A valid Status Page ID is required.");
      }

      if (typeof loginCode !== "string" || !ObjectID.isValidUUID(loginCode)) {
        throw new BadDataException("A valid login code is required.");
      }

      const statusPageId: ObjectID = new ObjectID(statusPageIdParam);
      const sessionMetadata: StatusPageSessionMetadata | null =
        await StatusPagePrivateUserSessionService.exchangeLoginCode(loginCode, {
          statusPageId,
          ipAddress: getClientIp(req),
          userAgent: headerValueToString(req.headers["user-agent"]),
          ...extractDeviceInfo(req),
        });

      if (
        !sessionMetadata?.session.id ||
        !sessionMetadata.session.statusPagePrivateUserId ||
        !sessionMetadata.session.projectId
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Login code is invalid or expired."),
        );
      }

      const user: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneById({
          id: sessionMetadata.session.statusPagePrivateUserId,
          select: {
            _id: true,
            email: true,
            statusPageId: true,
            projectId: true,
          },
          props: { isRoot: true },
        });

      if (
        !user?.id ||
        !user.statusPageId ||
        !user.projectId ||
        user.statusPageId.toString() !== statusPageId.toString() ||
        user.projectId.toString() !==
          sessionMetadata.session.projectId.toString()
      ) {
        await StatusPagePrivateUserSessionService.revokeSessionById(
          sessionMetadata.session.id,
          { reason: "Login code user no longer matches the session" },
        );

        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Login code is invalid or expired."),
        );
      }

      CookieUtil.setStatusPagePrivateUserCookie({
        expressResponse: res,
        user,
        statusPageId,
        sessionId: sessionMetadata.session.id,
        refreshToken: sessionMetadata.refreshToken,
        refreshTokenExpiresAt: sessionMetadata.refreshTokenExpiresAt,
        accessTokenExpiresInSeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
      });

      return Response.sendEntityResponse(req, res, user, StatusPagePrivateUser);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/refresh-token/:statuspageid",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const statusPageIdParam: string | undefined = req.params["statuspageid"];

      if (!statusPageIdParam) {
        throw new BadDataException("Status Page ID is required.");
      }

      const statusPageId: ObjectID = new ObjectID(statusPageIdParam.toString());

      const refreshToken: string | undefined =
        CookieUtil.getRefreshTokenFromExpressRequest(req, statusPageId);

      if (!refreshToken) {
        CookieUtil.removeCookie(res, CookieUtil.getUserTokenKey(statusPageId));
        CookieUtil.removeCookie(
          res,
          CookieUtil.getRefreshTokenKey(statusPageId),
        );

        if (
          respondWithMasterPasswordAccess({
            req,
            res,
            statusPageId,
          })
        ) {
          return;
        }

        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException(
            "Refresh token missing. Please login again.",
          ),
        );
      }

      const session: StatusPagePrivateUserSession | null =
        await StatusPagePrivateUserSessionService.findActiveSessionByRefreshToken(
          refreshToken,
        );

      if (
        !session ||
        !session.id ||
        !session.statusPageId ||
        StatusPagePrivateUserSessionService.isLoginCodeSession(session)
      ) {
        CookieUtil.removeCookie(res, CookieUtil.getUserTokenKey(statusPageId));
        CookieUtil.removeCookie(
          res,
          CookieUtil.getRefreshTokenKey(statusPageId),
        );

        if (
          respondWithMasterPasswordAccess({
            req,
            res,
            statusPageId,
          })
        ) {
          return;
        }

        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException("Session expired. Please login again."),
        );
      }

      if (session.statusPageId.toString() !== statusPageId.toString()) {
        await StatusPagePrivateUserSessionService.revokeSessionById(
          session.id,
          {
            reason: "Status page mismatch",
          },
        );

        CookieUtil.removeCookie(res, CookieUtil.getUserTokenKey(statusPageId));
        CookieUtil.removeCookie(
          res,
          CookieUtil.getRefreshTokenKey(statusPageId),
        );

        if (
          respondWithMasterPasswordAccess({
            req,
            res,
            statusPageId,
          })
        ) {
          return;
        }

        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException("Session expired. Please login again."),
        );
      }

      if (
        session.refreshTokenExpiresAt &&
        OneUptimeDate.hasExpired(session.refreshTokenExpiresAt)
      ) {
        await StatusPagePrivateUserSessionService.revokeSessionById(
          session.id,
          {
            reason: "Refresh token expired",
          },
        );

        CookieUtil.removeCookie(res, CookieUtil.getUserTokenKey(statusPageId));
        CookieUtil.removeCookie(
          res,
          CookieUtil.getRefreshTokenKey(statusPageId),
        );

        if (
          respondWithMasterPasswordAccess({
            req,
            res,
            statusPageId,
          })
        ) {
          return;
        }

        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException("Session expired. Please login again."),
        );
      }

      if (!session.statusPagePrivateUserId) {
        await StatusPagePrivateUserSessionService.revokeSessionById(
          session.id,
          {
            reason: "Session missing user",
          },
        );

        CookieUtil.removeCookie(res, CookieUtil.getUserTokenKey(statusPageId));
        CookieUtil.removeCookie(
          res,
          CookieUtil.getRefreshTokenKey(statusPageId),
        );

        if (
          respondWithMasterPasswordAccess({
            req,
            res,
            statusPageId,
          })
        ) {
          return;
        }

        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException("Session expired. Please login again."),
        );
      }

      const user: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneById({
          id: session.statusPagePrivateUserId,
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            email: true,
            statusPageId: true,
            projectId: true,
          },
        });

      if (!user) {
        await StatusPagePrivateUserSessionService.revokeSessionById(
          session.id,
          {
            reason: "User not found",
          },
        );

        CookieUtil.removeCookie(res, CookieUtil.getUserTokenKey(statusPageId));
        CookieUtil.removeCookie(
          res,
          CookieUtil.getRefreshTokenKey(statusPageId),
        );

        if (
          respondWithMasterPasswordAccess({
            req,
            res,
            statusPageId,
          })
        ) {
          return;
        }

        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException("Account no longer exists."),
        );
      }

      const renewedSession: StatusPageSessionMetadata =
        await StatusPagePrivateUserSessionService.renewSessionWithNewRefreshToken(
          {
            session,
            ipAddress: getClientIp(req),
            userAgent: headerValueToString(req.headers["user-agent"]),
            ...extractDeviceInfo(req),
          },
        );

      const accessToken: string = CookieUtil.setStatusPagePrivateUserCookie({
        expressResponse: res,
        user,
        statusPageId: user.statusPageId!,
        sessionId: renewedSession.session.id!,
        refreshToken: renewedSession.refreshToken,
        refreshTokenExpiresAt: renewedSession.refreshTokenExpiresAt,
        accessTokenExpiresInSeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
      });

      return Response.sendEntityResponse(
        req,
        res,
        user,
        StatusPagePrivateUser,
        {
          miscData: {
            token: accessToken,
          },
        },
      );
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

      /*
       * The `data["email"]` check above reads the raw body; re-check the deserialized value so
       * the guard covers what actually reaches the query.
       */
      CredentialGuard.assertPresent(user.email, "Email");

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
            smtpConfig: {
              _id: true,
              transportType: true,
              hostname: true,
              port: true,
              username: true,
              password: true,
              fromEmail: true,
              fromName: true,
              secure: true,
              authType: true,
              clientId: true,
              clientSecret: true,
              tokenUrl: true,
              scope: true,
              oauthProviderType: true,
            },
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
        const hashedToken: string = await HashedString.hashValue(
          token,
          EncryptionSecret,
        );
        await StatusPagePrivateUserService.updateOneBy({
          query: {
            _id: alreadySavedUser._id!,
          },
          data: {
            resetPasswordToken: hashedToken,
            resetPasswordExpires: OneUptimeDate.getOneDayAfter(),
          },
          props: {
            isRoot: true,
          },
        });

        const host: Hostname = await DatabaseConfig.getHost();
        const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
        const statusPageIdString: string | null =
          statusPage.id?.toString() || statusPage._id?.toString() || null;

        MailService.sendMail(
          {
            toEmail: user.email!,
            subject: "Password Reset Request for " + statusPageName,
            templateType: EmailTemplateType.StatusPageForgotPassword,
            vars: {
              statusPageName: statusPageName!,
              logoUrl:
                statusPage.logoFileId && statusPageIdString
                  ? new URL(httpProtocol, host)
                      .addRoute(StatusPageApiRoute)
                      .addRoute(`/logo/${statusPageIdString}`)
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
            mailServer: ProjectSMTPConfigService.toEmailServer(
              statusPage.smtpConfig,
            ),
            statusPageId: statusPage.id!,
          },
        ).catch((err: Error) => {
          logger.error(err, getLogAttributesFromRequest(req as RequestLike));
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

      /*
       * The `|| ""` below already stops the token predicate from being dropped, but an absent
       * password would silently reset the matched account's password to `undefined`.
       */
      CredentialGuard.assertAllPresent([
        { value: user.resetPasswordToken, label: "Reset password token" },
        { value: user.password, label: "Password" },
      ]);

      /*
       * The new password is handed to the update below unhashed on purpose:
       * the write path mints this user a fresh salt and hashes with it. Only
       * the reset token — a high-entropy value the server generated, which
       * has to be searchable by hash — is hashed here, unsalted.
       */
      const hashedToken: string = await HashedString.hashValue(
        (user.resetPasswordToken as string) || "",
        EncryptionSecret,
      );

      const alreadySavedUser: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: {
            statusPageId: new ObjectID(data["statusPageId"].toString()),
            resetPasswordToken: hashedToken,
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
            smtpConfig: {
              _id: true,
              transportType: true,
              hostname: true,
              port: true,
              username: true,
              password: true,
              fromEmail: true,
              fromName: true,
              secure: true,
              authType: true,
              clientId: true,
              clientSecret: true,
              tokenUrl: true,
              scope: true,
              oauthProviderType: true,
            },
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
      const statusPageIdString: string | null =
        statusPage.id?.toString() || statusPage._id?.toString() || null;

      MailService.sendMail(
        {
          toEmail: alreadySavedUser.email!,
          subject: "Password Changed.",
          templateType: EmailTemplateType.StatusPagePasswordChanged,
          vars: {
            homeURL: statusPageURL,
            statusPageName: statusPageName || "",
            logoUrl:
              statusPage.logoFileId && statusPageIdString
                ? new URL(httpProtocol, host)
                    .addRoute(StatusPageApiRoute)
                    .addRoute(`/logo/${statusPageIdString}`)
                    .toString()
                : "",
          },
        },
        {
          projectId: statusPage.projectId!,
          mailServer: ProjectSMTPConfigService.toEmailServer(
            statusPage.smtpConfig,
          ),
          statusPageId: statusPage.id!,
        },
      ).catch((err: Error) => {
        logger.error(err, getLogAttributesFromRequest(req as RequestLike));
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

      /*
       * statusPageId alone is not a secret, and the guard above is the only one an empty
       * credential pair used to hit. Without these, `email` and `password` arrive undefined,
       * TypeORM drops both predicates, and the query below degrades to "newest private user of
       * this status page" -- who is then handed a real session and access-token cookie.
       */
      CredentialGuard.assertAllPresent([
        { value: user.email, label: "Email" },
        { value: user.password, label: "Password" },
      ]);

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

      /*
       * The password predicate that used to sit in this query is gone: with a
       * per-user salt the expected hash cannot be computed until this user's
       * own salt has been read, so the account is located by its identity
       * (email + status page) and the password is checked afterwards.
       */
      const submittedPassword: string = user.password!.toString();

      const alreadySavedUser: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: {
            email: user.email!,
            statusPageId: user.statusPageId!,
          },
          select: {
            _id: true,
            password: true,
            passwordSalt: true,
            email: true,
            statusPageId: true,
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      const isPasswordValid: boolean = alreadySavedUser
        ? await StatusPagePrivateUserService.verifyHashedColumnValue({
            item: alreadySavedUser,
            columnName: "password",
            plainValue: submittedPassword,
          })
        : false;

      if (alreadySavedUser && isPasswordValid) {
        const { accessToken } = await finalizeStatusPageLogin({
          req,
          res,
          user: alreadySavedUser,
        });

        const sanitizedUser: StatusPagePrivateUser | null =
          await StatusPagePrivateUserService.findOneById({
            id: alreadySavedUser.id!,
            props: {
              isRoot: true,
            },
            select: {
              _id: true,
              email: true,
              statusPageId: true,
              projectId: true,
            },
          });

        if (!sanitizedUser) {
          // Never echo the credential columns selected for verification back.
          delete (alreadySavedUser as any).password;
          delete (alreadySavedUser as any).passwordSalt;
        }

        return Response.sendEntityResponse(
          req,
          res,
          sanitizedUser || alreadySavedUser,
          StatusPagePrivateUser,
          {
            miscData: {
              token: accessToken,
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

export default router;
