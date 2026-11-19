import { PROJECT_SMTP_CONFIG_SEND_SELECT } from "Common/Server/Utils/Mail/ProjectSmtpConfigSelect";
import crypto from "crypto";
import CredentialGuard from "../Utils/CredentialGuard";
import IdentityRateLimit, {
  IdentityRateLimitBucket,
} from "Common/Server/Middleware/IdentityRateLimit";
import PublicMessageRateLimit, {
  PublicMessageKind,
} from "Common/Server/Utils/RateLimit/PublicMessageRateLimit";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
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
import NewPasswordRule from "Common/Server/Utils/NewPasswordRule";
import {
  INCOMPLETE_RESET_LINK_MESSAGE,
  RESET_LINK_MESSAGES,
} from "Common/Types/Accounts/SignInMessages";
import ObjectID from "Common/Types/ObjectID";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import { EncryptionSecret } from "Common/Server/EnvironmentConfig";
import MailService from "Common/Server/Services/MailService";
import ProjectSMTPConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import StatusPagePrivateUserService from "Common/Server/Services/StatusPagePrivateUserService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPagePrivateUserSessionService, {
  SIGN_IN_NO_LONGER_ACCEPTED_REASON,
  SessionMetadata as StatusPageSessionMetadata,
} from "Common/Server/Services/StatusPagePrivateUserSessionService";
import CookieUtil from "Common/Server/Utils/Cookie";
import JSONWebToken, {
  StatusPageSessionToSignOut,
} from "Common/Server/Utils/JsonWebToken";
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
import RequestOriginUtil from "Common/Server/Utils/RequestOrigin/RequestOriginUtil";
import StatusPageEmailLogo, {
  STATUS_PAGE_EMAIL_LOGO_SELECT,
} from "Common/Server/Utils/StatusPage/StatusPageEmailLogo";
import Select from "Common/Server/Types/Database/Select";
import {
  getStatusPageMagicLinkRefusal,
  STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES,
  STATUS_PAGE_MAGIC_LINK_INVALID_MESSAGE,
  STATUS_PAGE_MAGIC_LINK_LOGIN_ROUTE,
} from "Common/Types/StatusPage/StatusPageMagicLink";
import {
  STATUS_PAGE_SESSION_REFRESH_TOKEN_EXPIRED_REASON,
  STATUS_PAGE_SESSION_SIGNED_OUT_REASON,
} from "Common/Types/AuditLog/AuditLogStatusPageSession";
import { SignInMethod } from "Common/Types/UserSession/SessionSignIn";
import {
  STATUS_PAGE_SESSION_EXPIRED_MESSAGE,
  STATUS_PAGE_SIGNED_OUT_MESSAGE,
} from "Common/Types/StatusPage/StatusPageSignInMessages";
import PasswordHash from "Common/Server/Utils/PasswordHash";

const router: ExpressRouter = Express.getRouter();

const ACCESS_TOKEN_EXPIRY_SECONDS: number = 15 * 60;

/*
 * Why a session a reader signed out of ended, as the session records it -
 * and as the audit log reads it, a Sign Out (issue #6790).
 */
const SIGNED_OUT_REASON: string = STATUS_PAGE_SESSION_SIGNED_OUT_REASON;

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

type EndRefreshInput = {
  req: ExpressRequest;
  res: ExpressResponse;
  statusPageId: ObjectID;
  // The session the refresh named, ended here, and why; none when there is none to end.
  revoke?: { sessionId: ObjectID; reason: string } | undefined;
  // What a visitor who is not signed in with the page's master password is told.
  message: string;
};

/*
 * A refresh that cannot renew the session: the session it named, when
 * there is one, is ended, both of the page's sign-in cookies are removed,
 * and the visitor is answered as one signed in with the page's master
 * password, when they are, or as signed out.
 */
const endRefresh: (data: EndRefreshInput) => Promise<void> = async (
  data: EndRefreshInput,
): Promise<void> => {
  if (data.revoke) {
    await StatusPagePrivateUserSessionService.revokeSessionById(
      data.revoke.sessionId,
      {
        reason: data.revoke.reason,
      },
    );
  }

  CookieUtil.removeCookie(
    data.res,
    CookieUtil.getUserTokenKey(data.statusPageId),
  );
  CookieUtil.removeCookie(
    data.res,
    CookieUtil.getRefreshTokenKey(data.statusPageId),
  );

  if (
    respondWithMasterPasswordAccess({
      req: data.req,
      res: data.res,
      statusPageId: data.statusPageId,
    })
  ) {
    return;
  }

  return Response.sendErrorResponse(
    data.req,
    data.res,
    new NotAuthenticatedException(data.message),
  );
};

type FinalizeStatusPageLoginInput = {
  req: ExpressRequest;
  res: ExpressResponse;
  user: StatusPagePrivateUser;
  // How the reader signed in: the audit log says it (issue #6790).
  signInMethod: SignInMethod;
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
  const { req, res, user, signInMethod } = data;

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
      signIn: { method: signInMethod },
      requestOrigin: RequestOriginUtil.fromRequest(req),
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
    let statusPageId: ObjectID | null = null;

    try {
      if (!req.params["statuspageid"]) {
        throw new BadDataException("Status Page ID is required.");
      }

      statusPageId = new ObjectID(req.params["statuspageid"].toString());

      const refreshToken: string | undefined =
        CookieUtil.getRefreshTokenFromExpressRequest(req, statusPageId);

      const hasEndedSession: boolean = refreshToken
        ? await StatusPagePrivateUserSessionService.revokeSessionByRefreshToken(
            refreshToken,
            {
              reason: SIGNED_OUT_REASON,
              requestOrigin: RequestOriginUtil.fromRequest(req),
            },
          )
        : false;

      /*
       * The refresh token matched no live session: a renewal whose answer
       * never reached the browser may have rotated it - the refresh token
       * is rotated at every renewal and only the new one kept - and the
       * session would stay signed in though its reader signed out
       * (issue #8671). The page's sign-out cookie still names it
       * (CookieUtil.setStatusPagePrivateUserCookie): signed for that and
       * nothing else, sent only to this page's sign-out, read from the
       * cookie only, and ending only that live session of that reader on
       * this page.
       */
      if (!hasEndedSession) {
        const sessionSignOutToken: string | undefined =
          CookieUtil.getStatusPageSessionSignOutTokenFromExpressRequest(
            req,
            statusPageId,
          );
        let sessionToSignOut: StatusPageSessionToSignOut | null = null;

        if (sessionSignOutToken) {
          try {
            sessionToSignOut =
              JSONWebToken.decodeStatusPageSessionToSignOut(
                sessionSignOutToken,
              );
          } catch {
            // Not a sign-out cookie OneUptime signed, or one that ran out.
            sessionToSignOut = null;
          }
        }

        if (
          sessionToSignOut &&
          sessionToSignOut.statusPageId.toString() === statusPageId.toString()
        ) {
          await StatusPagePrivateUserSessionService.revokeLiveSessionOfPrivateUser(
            {
              statusPageId: sessionToSignOut.statusPageId,
              statusPagePrivateUserId: sessionToSignOut.userId,
              sessionId: sessionToSignOut.sessionId,
            },
            {
              reason: SIGNED_OUT_REASON,
              requestOrigin: RequestOriginUtil.fromRequest(req),
            },
          );
        }
      }

      CookieUtil.removeStatusPageSessionCookies(res, statusPageId);

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      /*
       * Ending the session failed - the database could not be reached, say.
       * The browser is still left with none of the page's session cookies,
       * so it holds no token of the session any more (issue #9508); the
       * failure is still answered, and logged, as one.
       */
      if (statusPageId && !res.headersSent) {
        CookieUtil.removeStatusPageSessionCookies(res, statusPageId);
      }

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
        throw new BadDataException("A valid sign-in code is required.");
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
          new BadDataException("Sign-in code is invalid or expired."),
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
          new BadDataException("Sign-in code is invalid or expired."),
        );
      }

      /*
       * The SSO provider that gave the login code was turned off or deleted
       * since, or the page now requires SSO of a code no provider gave
       * (StatusPagePrivateUserSessionService.addSignInRule).
       */
      if (
        !(await StatusPagePrivateUserSessionService.doesSignInStillCount({
          sessionId: sessionMetadata.session.id,
        }))
      ) {
        await StatusPagePrivateUserSessionService.revokeSessionById(
          sessionMetadata.session.id,
          { reason: SIGN_IN_NO_LONGER_ACCEPTED_REASON },
        );

        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Sign-in code is invalid or expired."),
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
        return await endRefresh({
          req,
          res,
          statusPageId,
          message: STATUS_PAGE_SIGNED_OUT_MESSAGE,
        });
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
        return await endRefresh({
          req,
          res,
          statusPageId,
          message: STATUS_PAGE_SESSION_EXPIRED_MESSAGE,
        });
      }

      if (session.statusPageId.toString() !== statusPageId.toString()) {
        return await endRefresh({
          req,
          res,
          statusPageId,
          revoke: {
            sessionId: session.id,
            reason: "Status page mismatch",
          },
          message: STATUS_PAGE_SESSION_EXPIRED_MESSAGE,
        });
      }

      if (
        session.refreshTokenExpiresAt &&
        OneUptimeDate.hasExpired(session.refreshTokenExpiresAt)
      ) {
        return await endRefresh({
          req,
          res,
          statusPageId,
          revoke: {
            sessionId: session.id,
            reason: STATUS_PAGE_SESSION_REFRESH_TOKEN_EXPIRED_REASON,
          },
          message: STATUS_PAGE_SESSION_EXPIRED_MESSAGE,
        });
      }

      if (!session.statusPagePrivateUserId) {
        return await endRefresh({
          req,
          res,
          statusPageId,
          revoke: {
            sessionId: session.id,
            reason: "Session missing user",
          },
          message: STATUS_PAGE_SESSION_EXPIRED_MESSAGE,
        });
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
        return await endRefresh({
          req,
          res,
          statusPageId,
          revoke: {
            sessionId: session.id,
            reason: "User not found",
          },
          message: "Account no longer exists.",
        });
      }

      /*
       * The SSO provider that signed the session in was turned off or
       * deleted since, or the page now requires SSO of a session no
       * provider signed in: it ends here rather than renew
       * (StatusPagePrivateUserSessionService.addSignInRule).
       */
      if (
        !(await StatusPagePrivateUserSessionService.doesSignInStillCount({
          sessionId: session.id,
        }))
      ) {
        return await endRefresh({
          req,
          res,
          statusPageId,
          revoke: {
            sessionId: session.id,
            reason: SIGN_IN_NO_LONGER_ACCEPTED_REASON,
          },
          message: STATUS_PAGE_SESSION_EXPIRED_MESSAGE,
        });
      }

      const renewedSession: StatusPageSessionMetadata | null =
        await StatusPagePrivateUserSessionService.renewSessionWithNewRefreshToken(
          {
            session,
            ipAddress: getClientIp(req),
            userAgent: headerValueToString(req.headers["user-agent"]),
            ...extractDeviceInfo(req),
          },
        );

      // Ended while this request was on its way: it stays ended.
      if (!renewedSession) {
        return await endRefresh({
          req,
          res,
          statusPageId,
          message: STATUS_PAGE_SESSION_EXPIRED_MESSAGE,
        });
      }

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

/*
 * POST /status-page/forgot-password -- email a private user of a status page
 * a link to choose a password.
 *
 * The answer is the same for every address: success, whether or not the
 * address is a private user of the page, so asking says nothing about who
 * may sign in to a private status page (#9274). It used to answer "No user
 * is registered with ...". For the same reason the request is counted per
 * caller and per address (PublicMessageRateLimit) before the address is
 * looked up, so the sixth request in an hour is refused for every address
 * alike, not only for the page's private users.
 *
 * Only a private user of the page is mailed: the reset link, for a day, which
 * also sets a first password for one who has none yet (an invitation that was
 * never used). An address that is not a private user gets nothing. The email
 * is not awaited, so the answer does not wait on the mail server either way.
 *
 * What is refused before the count is a fact about the page, not the
 * address: an unknown page, or one that signs its readers in by SSO only.
 */
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
            ...STATUS_PAGE_EMAIL_LOGO_SELECT,
            requireSsoForLogin: true,
            projectId: true,
            smtpConfig: PROJECT_SMTP_CONFIG_SEND_SELECT,
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

      /*
       * Each request may email the address a reset link, so it is counted
       * first, per caller and per address (PublicMessageRateLimit), and
       * refused when either has had enough - before the token is replaced,
       * so the link in the latest email still works. Counted before the
       * address is looked up, whether or not it is a private user of the
       * page, so a refusal says nothing about that either.
       */
      await PublicMessageRateLimit.assertMaySend({
        req: req,
        kind: PublicMessageKind.StatusPagePasswordReset,
        contacts: [PublicMessageRateLimit.forEmail(user.email!)],
      });

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
        // A bearer secret: from the CSPRNG, never ObjectID's non-crypto fallback.
        const token: string = crypto.randomUUID();
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

        MailService.sendMail(
          {
            toEmail: user.email!,
            subject: "Password Reset Request for " + statusPageName,
            isSubjectLiteral: true,
            templateType: EmailTemplateType.StatusPageForgotPassword,
            vars: {
              statusPageName: statusPageName!,
              logoUrl: StatusPageEmailLogo.getLogoUrl({
                statusPage: statusPage,
                host: host,
                httpProtocol: httpProtocol,
              }),
              homeURL: statusPageURL,
              tokenVerifyUrl: URL.fromString(statusPageURL)
                .addRoute("/reset-password/" + token)
                .toString(),
              /*
               * When, from where and on which device the reset was asked
               * for: anybody who knows the address can ask (RequestOriginUtil).
               */
              ...RequestOriginUtil.getEmailVars({
                origin: RequestOriginUtil.fromRequest(req),
              }),
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
      }

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      // A reset refused for its rate limits says when to come back.
      PublicMessageRateLimit.setRetryAfterFor(res, err);
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
        {
          value: user.resetPasswordToken,
          label: "Reset password token",
          message: INCOMPLETE_RESET_LINK_MESSAGE,
        },
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
        throw new BadDataException(RESET_LINK_MESSAGES.invalid);
      }

      if (
        alreadySavedUser &&
        OneUptimeDate.hasExpired(alreadySavedUser.resetPasswordExpires!)
      ) {
        throw new BadDataException(RESET_LINK_MESSAGES.expired);
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
            ...STATUS_PAGE_EMAIL_LOGO_SELECT,
            requireSsoForLogin: true,
            projectId: true,
            smtpConfig: PROJECT_SMTP_CONFIG_SEND_SELECT,
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
       * The one password rule (Types/Password), after the link and the page's
       * single sign-on: a dead link is fixed by a new one, and a page that
       * takes no password needs none. The write's hook asks again
       * (StatusPagePrivateUserService); a reset used to store any password at
       * all (#9123).
       */
      NewPasswordRule.assertMet(user.password);

      const statusPageName: string | undefined =
        statusPage.pageTitle || statusPage.name;

      const statusPageURL: string = await StatusPageService.getStatusPageURL(
        statusPage.id!,
      );

      /*
       * The write's own hooks end a sign-in link sent before the reset, in this
       * same statement, and every session of this user, as they do for every
       * new password: somebody resetting their password may be locking out
       * whoever read their mail (StatusPagePrivateUserService.onUpdatePermitted,
       * onUpdateSuccess).
       */
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
          isSubjectLiteral: true,
          templateType: EmailTemplateType.StatusPagePasswordChanged,
          vars: {
            homeURL: statusPageURL,
            statusPageName: statusPageName || "",
            logoUrl: StatusPageEmailLogo.getLogoUrl({
              statusPage: statusPage,
              host: host,
              httpProtocol: httpProtocol,
            }),
            // When, from where and on which device the password was changed.
            ...RequestOriginUtil.getEmailVars({
              origin: RequestOriginUtil.fromRequest(req),
            }),
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

/*
 * What a status page holds that decides whether it takes sign-in links
 * (Types/StatusPage/StatusPageMagicLink.getStatusPageMagicLinkRefusal).
 */
const MAGIC_LINK_STATUS_PAGE_SELECT: Select<StatusPage> = {
  isPublicStatusPage: true,
  enableMasterPassword: true,
  // Only to tell whether one is set.
  masterPassword: true,
  requireSsoForLogin: true,
  enableMagicLinkLogin: true,
  isArchived: true,
};

/*
 * Why this status page does not take sign-in links now, or null when it
 * does. An archived page is offline: it is answered as one that is gone.
 */
const getMagicLinkRefusalFor: (
  statusPage: StatusPage | null,
) => string | null = (statusPage: StatusPage | null): string | null => {
  if (!statusPage || statusPage.isArchived) {
    return "Status Page not found";
  }

  return getStatusPageMagicLinkRefusal({
    isPublicStatusPage: statusPage.isPublicStatusPage,
    enableMasterPassword: statusPage.enableMasterPassword,
    hasMasterPassword: Boolean(statusPage.masterPassword),
    requireSsoForLogin: statusPage.requireSsoForLogin,
    enableMagicLinkLogin: statusPage.enableMagicLinkLogin,
  });
};

/*
 * A private user asks for a sign-in link (Types/StatusPage/
 * StatusPageMagicLink). It is emailed to the address the request names
 * when that address is a private user of the page, and the answer is the
 * same either way, so asking says nothing about who may sign in. For the
 * same reason the request is counted per caller and per address
 * (PublicMessageRateLimit) before the address is looked up, whether or not
 * it matches, and the link's token is minted and hashed before the lookup
 * too, so both answers cost the same work.
 */
router.post(
  "/send-magic-link",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data: JSONObject | undefined = req.body["data"] as
        | JSONObject
        | undefined;

      if (!data || !data["email"]) {
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
       * The check above reads the raw body; re-check the deserialized value,
       * which is what reaches the query and the email.
       */
      CredentialGuard.assertPresent(user.email, "Email");

      const statusPage: StatusPage | null = await StatusPageService.findOneById(
        {
          id: user.statusPageId,
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
          select: {
            _id: true,
            name: true,
            pageTitle: true,
            ...STATUS_PAGE_EMAIL_LOGO_SELECT,
            ...MAGIC_LINK_STATUS_PAGE_SELECT,
            projectId: true,
            smtpConfig: PROJECT_SMTP_CONFIG_SEND_SELECT,
          },
        },
      );

      const refusal: string | null = getMagicLinkRefusalFor(statusPage);

      if (refusal || !statusPage) {
        throw new BadDataException(refusal || "Status Page not found");
      }

      await PublicMessageRateLimit.assertMaySend({
        req: req,
        kind: PublicMessageKind.StatusPageMagicLink,
        contacts: [PublicMessageRateLimit.forEmail(user.email!)],
      });

      // A bearer secret: from the CSPRNG, never ObjectID's non-crypto fallback.
      const token: string = crypto.randomUUID();
      const hashedToken: string = await HashedString.hashValue(
        token,
        EncryptionSecret,
      );

      const privateUser: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: {
            email: user.email!,
            statusPageId: user.statusPageId,
          },
          select: {
            _id: true,
            email: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (privateUser?.email) {
        // Replaces the last link this user was sent: only the newest works.
        await StatusPagePrivateUserService.updateOneBy({
          query: {
            _id: privateUser._id!,
          },
          data: {
            magicLinkToken: hashedToken,
            magicLinkExpires: OneUptimeDate.getSomeMinutesAfter(
              STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES,
            ),
          },
          props: {
            isRoot: true,
          },
        });

        const statusPageName: string =
          statusPage.pageTitle || statusPage.name || "Status Page";

        const statusPageURL: string = await StatusPageService.getStatusPageURL(
          statusPage.id!,
        );

        const host: Hostname = await DatabaseConfig.getHost();
        const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

        MailService.sendMail(
          {
            toEmail: privateUser.email,
            subject: "Sign in to " + statusPageName,
            isSubjectLiteral: true,
            templateType: EmailTemplateType.StatusPageMagicLink,
            vars: {
              statusPageName: statusPageName,
              logoUrl: StatusPageEmailLogo.getLogoUrl({
                statusPage: statusPage,
                host: host,
                httpProtocol: httpProtocol,
              }),
              homeURL: statusPageURL,
              tokenVerifyUrl: URL.fromString(statusPageURL)
                .addRoute(`/${STATUS_PAGE_MAGIC_LINK_LOGIN_ROUTE}/${token}`)
                .toString(),
              expiresInMinutes:
                STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES.toString(),
              /*
               * When, from where and on which device the link was asked for:
               * anybody who knows the address can ask (RequestOriginUtil).
               */
              ...RequestOriginUtil.getEmailVars({
                origin: RequestOriginUtil.fromRequest(req),
              }),
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
      }

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      // A link refused for its rate limits says when to come back.
      PublicMessageRateLimit.setRetryAfterFor(res, err);
      return next(err);
    }
  },
);

/*
 * A private user opens their sign-in link and confirms: the link is spent
 * and they are signed in, with the same session and cookies a password
 * sign-in gets (finalizeStatusPageLogin) - a session no SSO provider signed
 * in, which counts only while the page does not require SSO.
 *
 * The page is asked again here, so a link sent before its team turned sign-in
 * links off, required SSO or changed who can see the page no longer signs
 * anybody in. A link that is not a link, one already used, one that expired
 * and one a newer link replaced are answered alike.
 *
 * No attempt limit in front of it, as with /reset-password: the token is a
 * server-minted random UUID - 122 bits - that works once and for minutes,
 * so there is nothing to guess.
 */
router.post(
  "/login-with-magic-link/:statuspageid",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      Response.setNoCacheHeaders(res);

      const statusPageIdParam: string | undefined = req.params["statuspageid"];
      const token: unknown = req.body["token"];

      if (!statusPageIdParam || !ObjectID.isValidUUID(statusPageIdParam)) {
        throw new BadDataException("A valid Status Page ID is required.");
      }

      // Every link's token is a UUID: anything else is no link at all.
      if (typeof token !== "string" || !ObjectID.isValidUUID(token)) {
        throw new BadDataException(STATUS_PAGE_MAGIC_LINK_INVALID_MESSAGE);
      }

      const statusPageId: ObjectID = new ObjectID(statusPageIdParam);

      const statusPage: StatusPage | null = await StatusPageService.findOneById(
        {
          id: statusPageId,
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
          select: MAGIC_LINK_STATUS_PAGE_SELECT,
        },
      );

      const refusal: string | null = getMagicLinkRefusalFor(statusPage);

      if (refusal) {
        throw new BadDataException(refusal);
      }

      const user: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.consumeMagicLinkToken({
          statusPageId: statusPageId,
          token: token,
        });

      if (!user) {
        throw new BadDataException(STATUS_PAGE_MAGIC_LINK_INVALID_MESSAGE);
      }

      await finalizeStatusPageLogin({
        req,
        res,
        user,
        signInMethod: SignInMethod.SignInLink,
      });

      // Who signed in - their id, address and page - and nothing else.
      return Response.sendEntityResponse(req, res, user, StatusPagePrivateUser);
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Registered ahead of the handler so a refused attempt costs neither the user
 * lookup nor the scrypt verify. See
 * Common/Server/Middleware/IdentityRateLimit.ts for the budget and for why it
 * fails closed when Redis is unreachable.
 */
router.post(
  "/login",
  IdentityRateLimit.getMiddleware(IdentityRateLimitBucket.StatusPageLogin),
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

      let isPasswordValid: boolean = false;

      if (alreadySavedUser && alreadySavedUser.password) {
        isPasswordValid =
          await StatusPagePrivateUserService.verifyHashedColumnValue({
            item: alreadySavedUser,
            columnName: "password",
            plainValue: submittedPassword,
          });
      } else {
        /*
         * No private user of this page has the address, or theirs has no
         * password yet: refused after as long as a password check takes,
         * so how long the refusal takes does not say which addresses the
         * page knows (#9745).
         */
        await PasswordHash.spendVerificationTime(submittedPassword);
      }

      if (alreadySavedUser && isPasswordValid) {
        const { accessToken } = await finalizeStatusPageLogin({
          req,
          res,
          user: alreadySavedUser,
          signInMethod: SignInMethod.Password,
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
      throw new BadDataException("Email or password does not match.");
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
