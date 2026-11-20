import crypto from "crypto";
import CredentialGuard from "../Utils/CredentialGuard";
import DashboardSignIn from "../Utils/DashboardSignIn";
import IdentityRateLimit, {
  IdentityRateLimitBucket,
} from "Common/Server/Middleware/IdentityRateLimit";
import PublicDashboardRateLimit, {
  PublicDashboardRateLimitBucket,
} from "Common/Server/Middleware/PublicDashboardRateLimit";
import PublicMessageRateLimit, {
  PublicMessageKind,
} from "Common/Server/Utils/RateLimit/PublicMessageRateLimit";
import { EncryptionSecret } from "Common/Server/EnvironmentConfig";
import DashboardOidcService from "Common/Server/Services/DashboardOidcService";
import DashboardPrivateUserService, {
  getDashboardResetPasswordUrl,
} from "Common/Server/Services/DashboardPrivateUserService";
import DashboardPrivateUserSessionService from "Common/Server/Services/DashboardPrivateUserSessionService";
import DashboardService from "Common/Server/Services/DashboardService";
import DashboardSsoService from "Common/Server/Services/DashboardSsoService";
import MailService from "Common/Server/Services/MailService";
import {
  PrivateUserSessionMetadata,
  PRIVATE_USER_SESSION_SIGNED_OUT_REASON,
  PRIVATE_USER_SIGN_IN_NO_LONGER_ACCEPTED_REASON,
} from "Common/Server/Services/PrivateUserSessionServiceBase";
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
import JSONWebToken, {
  DashboardPrivateUserSessionClaims,
} from "Common/Server/Utils/JsonWebToken";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import NewPasswordRule from "Common/Server/Utils/NewPasswordRule";
import PasswordHash from "Common/Server/Utils/PasswordHash";
import { getRequestHost } from "Common/Server/Utils/RequestHost";
import RequestOriginUtil from "Common/Server/Utils/RequestOrigin/RequestOriginUtil";
import Response from "Common/Server/Utils/Response";
import SameOriginRequest from "Common/Server/Utils/SameOriginRequest";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DashboardOIDC from "Common/Models/DatabaseModels/DashboardOidc";
import DashboardPrivateUser from "Common/Models/DatabaseModels/DashboardPrivateUser";
import DashboardPrivateUserSession from "Common/Models/DatabaseModels/DashboardPrivateUserSession";
import DashboardSSO from "Common/Models/DatabaseModels/DashboardSso";
import {
  INCOMPLETE_RESET_LINK_MESSAGE,
  RESET_LINK_MESSAGES,
} from "Common/Types/Accounts/SignInMessages";
import {
  DASHBOARD_PRIVATE_USER_CREDENTIALS_MESSAGE,
  DASHBOARD_SESSION_EXPIRED_MESSAGE,
  DASHBOARD_SIGN_IN_CODE_INVALID_MESSAGE,
  DASHBOARD_SIGNED_OUT_MESSAGE,
  DASHBOARD_SSO_ONLY_MESSAGE,
  DashboardPrivateUserApiRoutes,
  DashboardSignInMethods,
  DashboardSignInProvider,
} from "Common/Types/Dashboard/DashboardPrivateUserSignIn";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import BadDataException from "Common/Types/Exception/BadDataException";
import ForbiddenException from "Common/Types/Exception/ForbiddenException";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import HashedString from "Common/Types/HashedString";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SignInMethod } from "Common/Types/UserSession/SessionSignIn";

/*
 * ---------------------------------------------------------------------------
 * A DASHBOARD'S PUBLIC LINK SIGNS ITS PRIVATE USERS IN (#10250).
 *
 * A dashboard whose Sharing choice is Only people who sign in
 * (Types/Dashboard/DashboardAccess) lets in only its private users
 * (DashboardPrivateUser), and the public dashboard app signs them in here -
 * on the host it is served from, OneUptime's own or one of the dashboard's
 * custom domains, under the link's API: the identity service mounts this
 * router at /api/dashboard/private-user, which is where every host's
 * /public-dashboard-api/private-user leads (Nginx/default.conf.template).
 * As a status page's private users sign in (StatusPageAuthentication):
 *
 *   POST /login/:dashboardId                a password; one answer for every
 *                                           address that does not sign in
 *   POST /logout/:dashboardId               ends the browser's session there
 *   POST /refresh-token/:dashboardId        a new access token, while the
 *                                           session counts
 *   POST /forgot-password/:dashboardId      a reset link; the same answer for
 *                                           every address
 *   POST /reset-password/:dashboardId       a new password from that link
 *   POST /exchange-login-code/:dashboardId  the session a single sign-on code
 *                                           stands for, on this host
 *   POST /sign-in-methods/:dashboardId      what the sign-in page offers
 *
 * Every route answers only for a dashboard whose public link asks its
 * visitors to sign in, and only for a visitor its IP allowlist lets in
 * (getDashboardForSignIn): anything else reads as a dashboard that is not
 * there, or the allowlist's refusal, before an address is looked at.
 *
 * A route that changes something first refuses a request another site's
 * page had a browser send (refuseForeignPageRequests: the page is served on
 * the host the request goes to, so its Origin is that host), and the ones
 * that take a body take only JSON, which no page of another site can have
 * a browser send without a preflight. The session's cookies are
 * SameSite=Strict too (CookieUtil.setDashboardPrivateUserCookie).
 * ---------------------------------------------------------------------------
 */

const router: ExpressRouter = Express.getRouter();

const ACCESS_TOKEN_EXPIRY_SECONDS: number = 15 * 60;

const readRateLimit: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> = PublicDashboardRateLimit.getMiddleware(
  PublicDashboardRateLimitBucket.Read,
);

// The one refusal of a request another page had a browser send.
export const DASHBOARD_SIGN_IN_FOREIGN_PAGE_MESSAGE: string =
  "This dashboard can only be signed in to from its own page.";

export const DASHBOARD_SIGN_IN_BODY_MESSAGE: string =
  "The request must be a JSON object.";

/*
 * First on every route that changes something: a request a browser sent
 * from a page that is not this host's own is refused, 403, before it costs
 * or spends anything (SameOriginRequest.isForeignPageRequestToHost). A
 * request with neither of the headers it reads - curl, a server - passes,
 * and meets every check after it.
 */
export const refuseForeignPageRequests: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void => {
  if (
    SameOriginRequest.isForeignPageRequestToHost({
      headers: req.headers,
      hostname: getRequestHost(req),
    })
  ) {
    Response.setNoCacheHeaders(res);

    return Response.sendErrorResponse(
      req,
      res,
      new ForbiddenException(DASHBOARD_SIGN_IN_FOREIGN_PAGE_MESSAGE),
    );
  }

  return next();
};

/*
 * Second on every route that takes a body: it must be JSON, the one kind a
 * page of another site cannot have a browser send without a preflight.
 */
export const requireJsonBody: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void => {
  if (!SameOriginRequest.isJsonContentType(req.headers["content-type"])) {
    Response.setNoCacheHeaders(res);

    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException(DASHBOARD_SIGN_IN_BODY_MESSAGE),
    );
  }

  return next();
};

// The dashboard a route names, or a refusal: a value that is no id is no dashboard.
const readDashboardId: (req: ExpressRequest) => ObjectID = (
  req: ExpressRequest,
): ObjectID => {
  return DashboardSignIn.readDashboardId(req.params["dashboardId"]);
};

// The request's `data` object, or an empty one.
const readData: (req: ExpressRequest) => JSONObject = (
  req: ExpressRequest,
): JSONObject => {
  const data: unknown = req.body ? req.body["data"] : undefined;

  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as JSONObject;
  }

  return {};
};

// A string a field holds, or undefined: anything else is no credential.
const readText: (value: unknown) => string | undefined = (
  value: unknown,
): string | undefined => {
  return typeof value === "string" ? value : undefined;
};

/*
 * The dashboard a sign-in is for, as its public link answers this visitor
 * (Utils/DashboardSignIn): asked before any private user is looked at.
 */
const getDashboardForSignIn: (data: {
  req: ExpressRequest;
  dashboardId: ObjectID;
}) => Promise<Dashboard> = async (data: {
  req: ExpressRequest;
  dashboardId: ObjectID;
}): Promise<Dashboard> => {
  return await DashboardSignIn.getDashboardForSignIn(data);
};

const getDashboardName: (dashboard: Dashboard) => string = (
  dashboard: Dashboard,
): string => {
  return DashboardSignIn.getDashboardName(dashboard);
};

/*
 * Signs the browser in on this host: the session's three cookies
 * (CookieUtil.setDashboardPrivateUserCookie), and who signed in in the
 * answer - their address, and nothing else of them.
 */
const sendSignedIn: (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  dashboardId: ObjectID;
  privateUserId: ObjectID;
  email: string;
  sessionMetadata: PrivateUserSessionMetadata<DashboardPrivateUserSession>;
}) => void = (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  dashboardId: ObjectID;
  privateUserId: ObjectID;
  email: string;
  sessionMetadata: PrivateUserSessionMetadata<DashboardPrivateUserSession>;
}): void => {
  CookieUtil.setDashboardPrivateUserCookie({
    expressResponse: data.res,
    dashboardId: data.dashboardId,
    privateUserId: data.privateUserId,
    sessionId: data.sessionMetadata.session.id!,
    refreshToken: data.sessionMetadata.refreshToken,
    refreshTokenExpiresAt: data.sessionMetadata.refreshTokenExpiresAt,
    accessTokenExpiresInSeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
  });

  return Response.sendJsonObjectResponse(data.req, data.res, {
    email: data.email,
  });
};

/*
 * A refresh that cannot renew the session: the session it named, when
 * there is one, is ended, the browser's cookies for the dashboard are
 * removed, and it is answered as signed out.
 */
const endRefresh: (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  dashboardId: ObjectID;
  revoke?: { sessionId: ObjectID; reason: string } | undefined;
  message: string;
}) => Promise<void> = async (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  dashboardId: ObjectID;
  revoke?: { sessionId: ObjectID; reason: string } | undefined;
  message: string;
}): Promise<void> => {
  if (data.revoke) {
    await DashboardPrivateUserSessionService.revokeSessionById(
      data.revoke.sessionId,
      { reason: data.revoke.reason },
    );
  }

  CookieUtil.removeDashboardPrivateUserCookies(data.res, data.dashboardId);

  return Response.sendErrorResponse(
    data.req,
    data.res,
    new NotAuthenticatedException(data.message),
  );
};

/*
 * A private user's password. Counted first, per address and per account
 * (IdentityRateLimit), so a refused attempt costs neither the lookup nor the
 * password check. An address that is no private user of the dashboard, one
 * with no password yet and a wrong password are answered alike, after as
 * long as a password check takes (PasswordHash.spendVerificationTime), so
 * the page says nothing about who is invited.
 */
router.post(
  `${DashboardPrivateUserApiRoutes.login}/:dashboardId`,
  refuseForeignPageRequests,
  requireJsonBody,
  IdentityRateLimit.getMiddleware(
    IdentityRateLimitBucket.DashboardPrivateUserLogin,
  ),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      Response.setNoCacheHeaders(res);

      const dashboardId: ObjectID = readDashboardId(req);
      const data: JSONObject = readData(req);
      const emailText: string | undefined = readText(data["email"]);
      const password: string | undefined = readText(data["password"]);

      /*
       * Both, before anything is looked up: an empty address or password
       * must never reach a query, where TypeORM would drop the predicate.
       */
      CredentialGuard.assertAllPresent([
        { value: emailText, label: "Email" },
        { value: password, label: "Password" },
      ]);

      const dashboard: Dashboard = await getDashboardForSignIn({
        req,
        dashboardId,
      });

      // A dashboard that takes only single sign-on takes no password.
      if (dashboard.requireSsoForLogin) {
        throw new BadDataException(DASHBOARD_SSO_ONLY_MESSAGE);
      }

      const email: Email = new Email(emailText!.trim());

      const privateUser: DashboardPrivateUser | null =
        await DashboardPrivateUserService.findOneBy({
          query: {
            email: email,
            dashboardId: dashboardId,
          },
          select: {
            _id: true,
            password: true,
            passwordSalt: true,
            email: true,
            dashboardId: true,
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      let isPasswordValid: boolean = false;

      if (privateUser && privateUser.password) {
        isPasswordValid =
          await DashboardPrivateUserService.verifyHashedColumnValue({
            item: privateUser,
            columnName: "password",
            plainValue: password!,
          });
      } else {
        await PasswordHash.spendVerificationTime(password!);
      }

      if (
        !privateUser ||
        !isPasswordValid ||
        !privateUser.id ||
        !privateUser.projectId
      ) {
        throw new BadDataException(DASHBOARD_PRIVATE_USER_CREDENTIALS_MESSAGE);
      }

      const sessionMetadata: PrivateUserSessionMetadata<DashboardPrivateUserSession> =
        await DashboardPrivateUserSessionService.createSession({
          projectId: privateUser.projectId,
          resourceId: dashboardId,
          privateUserId: privateUser.id,
          ipAddress: getClientIp(req),
          userAgent: headerValueToString(req.headers["user-agent"]),
          ...extractDeviceInfo(req),
          signIn: { method: SignInMethod.Password },
          requestOrigin: RequestOriginUtil.fromRequest(req),
        });

      return sendSignedIn({
        req,
        res,
        dashboardId,
        privateUserId: privateUser.id,
        email: privateUser.email!.toString(),
        sessionMetadata,
      });
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Ends the session this browser holds on the dashboard, and removes its
 * cookies there, whatever else happens: by its refresh token, else by its
 * sign-out cookie - a renewal whose answer never reached the browser
 * rotated the refresh token, and the session would stay signed in though
 * its reader signed out. Answered alike whether there was a session.
 */
router.post(
  `${DashboardPrivateUserApiRoutes.logout}/:dashboardId`,
  refuseForeignPageRequests,
  readRateLimit,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    let dashboardId: ObjectID | null = null;

    try {
      Response.setNoCacheHeaders(res);

      dashboardId = readDashboardId(req);

      const refreshToken: string | undefined =
        CookieUtil.getDashboardPrivateUserRefreshTokenFromExpressRequest(
          req,
          dashboardId,
        );

      const hasEndedSession: boolean = refreshToken
        ? await DashboardPrivateUserSessionService.revokeSessionByRefreshToken(
            refreshToken,
            { reason: PRIVATE_USER_SESSION_SIGNED_OUT_REASON },
          )
        : false;

      if (!hasEndedSession) {
        const signOutToken: string | undefined =
          CookieUtil.getDashboardPrivateUserSignOutTokenFromExpressRequest(
            req,
            dashboardId,
          );

        let sessionToSignOut: DashboardPrivateUserSessionClaims | null = null;

        if (signOutToken) {
          try {
            sessionToSignOut =
              JSONWebToken.decodeDashboardPrivateUserSessionToSignOut(
                signOutToken,
              );
          } catch {
            // Not a sign-out cookie OneUptime signed, or one that ran out.
            sessionToSignOut = null;
          }
        }

        if (
          sessionToSignOut &&
          sessionToSignOut.dashboardId.toString() === dashboardId.toString()
        ) {
          await DashboardPrivateUserSessionService.revokeLiveSessionOfPrivateUser(
            {
              resourceId: sessionToSignOut.dashboardId,
              privateUserId: sessionToSignOut.userId,
              sessionId: sessionToSignOut.sessionId,
            },
            { reason: PRIVATE_USER_SESSION_SIGNED_OUT_REASON },
          );
        }
      }

      CookieUtil.removeDashboardPrivateUserCookies(res, dashboardId);

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      /*
       * Ending the session failed - the database could not be reached, say.
       * The browser is still left with none of the dashboard's session
       * cookies; the failure is still answered, and logged, as one.
       */
      if (dashboardId && !res.headersSent) {
        CookieUtil.removeDashboardPrivateUserCookies(res, dashboardId);
      }

      return next(err);
    }
  },
);

/*
 * A new access token, from the session's refresh token, while the session
 * still counts: still the dashboard's, its private user still there, its
 * sign-in still accepted (a provider it signed in with still on, or no
 * Require SSO for one a password signed in). The refresh token is rotated
 * in the same conditional write; anything else ends the session.
 */
router.post(
  `${DashboardPrivateUserApiRoutes.refreshToken}/:dashboardId`,
  refuseForeignPageRequests,
  readRateLimit,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      Response.setNoCacheHeaders(res);

      const dashboardId: ObjectID = readDashboardId(req);

      const refreshToken: string | undefined =
        CookieUtil.getDashboardPrivateUserRefreshTokenFromExpressRequest(
          req,
          dashboardId,
        );

      if (!refreshToken) {
        return await endRefresh({
          req,
          res,
          dashboardId,
          message: DASHBOARD_SIGNED_OUT_MESSAGE,
        });
      }

      try {
        await getDashboardForSignIn({ req, dashboardId });
      } catch (err) {
        // The link no longer signs anybody in here: the cookies go too.
        CookieUtil.removeDashboardPrivateUserCookies(res, dashboardId);
        throw err;
      }

      const session: DashboardPrivateUserSession | null =
        await DashboardPrivateUserSessionService.findActiveSessionByRefreshToken(
          refreshToken,
        );

      if (
        !session ||
        !session.id ||
        DashboardPrivateUserSessionService.isLoginCodeSession(session)
      ) {
        return await endRefresh({
          req,
          res,
          dashboardId,
          message: DASHBOARD_SESSION_EXPIRED_MESSAGE,
        });
      }

      if (
        !session.dashboardId ||
        session.dashboardId.toString() !== dashboardId.toString() ||
        !session.dashboardPrivateUserId
      ) {
        return await endRefresh({
          req,
          res,
          dashboardId,
          revoke: {
            sessionId: session.id,
            reason: "Dashboard mismatch",
          },
          message: DASHBOARD_SESSION_EXPIRED_MESSAGE,
        });
      }

      const privateUser: DashboardPrivateUser | null =
        await DashboardPrivateUserService.findOneById({
          id: session.dashboardPrivateUserId,
          select: {
            _id: true,
            email: true,
            dashboardId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (
        !privateUser?.id ||
        !privateUser.email ||
        privateUser.dashboardId?.toString() !== dashboardId.toString()
      ) {
        return await endRefresh({
          req,
          res,
          dashboardId,
          revoke: {
            sessionId: session.id,
            reason: "Private user removed",
          },
          message: DASHBOARD_SESSION_EXPIRED_MESSAGE,
        });
      }

      if (
        !(await DashboardPrivateUserSessionService.doesSignInStillCount({
          sessionId: session.id,
        }))
      ) {
        return await endRefresh({
          req,
          res,
          dashboardId,
          revoke: {
            sessionId: session.id,
            reason: PRIVATE_USER_SIGN_IN_NO_LONGER_ACCEPTED_REASON,
          },
          message: DASHBOARD_SESSION_EXPIRED_MESSAGE,
        });
      }

      const renewedSession: PrivateUserSessionMetadata<DashboardPrivateUserSession> | null =
        await DashboardPrivateUserSessionService.renewSessionWithNewRefreshToken(
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
          dashboardId,
          message: DASHBOARD_SESSION_EXPIRED_MESSAGE,
        });
      }

      return sendSignedIn({
        req,
        res,
        dashboardId,
        privateUserId: privateUser.id,
        email: privateUser.email.toString(),
        sessionMetadata: renewedSession,
      });
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Emails a private user of the dashboard a link to choose a password. The
 * answer is the same for every address - success, whether or not it is a
 * private user of the dashboard - so asking says nothing about who is
 * invited. For the same reason the request is counted per caller and per
 * address (PublicMessageRateLimit) before the address is looked up, and the
 * link's token is minted and hashed before the lookup too, so both answers
 * cost the same work. What is refused before the count is a fact about the
 * dashboard, never the address: one that signs nobody in, or signs its
 * visitors in with single sign-on only.
 */
router.post(
  `${DashboardPrivateUserApiRoutes.forgotPassword}/:dashboardId`,
  refuseForeignPageRequests,
  requireJsonBody,
  readRateLimit,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      Response.setNoCacheHeaders(res);

      const dashboardId: ObjectID = readDashboardId(req);
      const emailText: string | undefined = readText(readData(req)["email"]);

      CredentialGuard.assertPresent(emailText, "Email");

      const dashboard: Dashboard = await getDashboardForSignIn({
        req,
        dashboardId,
      });

      if (dashboard.requireSsoForLogin) {
        throw new BadDataException(DASHBOARD_SSO_ONLY_MESSAGE);
      }

      const email: Email = new Email(emailText!.trim());

      await PublicMessageRateLimit.assertMaySend({
        req: req,
        kind: PublicMessageKind.PrivateUserPasswordReset,
        contacts: [PublicMessageRateLimit.forEmail(email)],
      });

      // A bearer secret: from the CSPRNG.
      const token: string = crypto.randomUUID();
      const hashedToken: string = await HashedString.hashValue(
        token,
        EncryptionSecret,
      );

      const privateUser: DashboardPrivateUser | null =
        await DashboardPrivateUserService.findOneBy({
          query: {
            email: email,
            dashboardId: dashboardId,
          },
          select: {
            _id: true,
            email: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (privateUser?.id && privateUser.email && dashboard.projectId) {
        await DashboardPrivateUserService.updateOneById({
          id: privateUser.id,
          data: {
            resetPasswordToken: hashedToken,
            resetPasswordExpires: OneUptimeDate.getOneDayAfter(),
          },
          props: {
            isRoot: true,
          },
        });

        const dashboardUrl: string =
          await DashboardService.getPublicDashboardUrl(dashboardId);

        MailService.sendMail(
          {
            toEmail: privateUser.email,
            subject: "Password Reset Request for " + getDashboardName(dashboard),
            isSubjectLiteral: true,
            templateType: EmailTemplateType.PrivateUserForgotPassword,
            vars: {
              resourceName: getDashboardName(dashboard),
              homeURL: dashboardUrl,
              tokenVerifyUrl: getDashboardResetPasswordUrl({
                resourceUrl: dashboardUrl,
                token: token,
              }),
              // When, from where and on which device the reset was asked for.
              ...RequestOriginUtil.getEmailVars({
                origin: RequestOriginUtil.fromRequest(req),
              }),
            },
          },
          {
            projectId: dashboard.projectId,
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

/*
 * A new password, from a reset link - the invitation's too: the private
 * user of this dashboard whose latest link carries the token, while it
 * works. The write's own hooks end the link in the same statement, and
 * every session of the user, as every new password does
 * (PrivateUserServiceBase). No attempt limit beyond the read budget: the
 * token is a random UUID the server minted - 122 bits - that works once.
 */
router.post(
  `${DashboardPrivateUserApiRoutes.resetPassword}/:dashboardId`,
  refuseForeignPageRequests,
  requireJsonBody,
  readRateLimit,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      Response.setNoCacheHeaders(res);

      const dashboardId: ObjectID = readDashboardId(req);
      const data: JSONObject = readData(req);
      const token: string | undefined = readText(data["resetPasswordToken"]);
      const password: string | undefined = readText(data["password"]);

      CredentialGuard.assertAllPresent([
        {
          value: token,
          label: "Reset password token",
          message: INCOMPLETE_RESET_LINK_MESSAGE,
        },
        { value: password, label: "Password" },
      ]);

      const dashboard: Dashboard = await getDashboardForSignIn({
        req,
        dashboardId,
      });

      if (dashboard.requireSsoForLogin) {
        throw new BadDataException(DASHBOARD_SSO_ONLY_MESSAGE);
      }

      const { user, isExpired } =
        await DashboardPrivateUserService.findByResetPasswordToken({
          resourceId: dashboardId,
          token: token!,
        });

      if (!user?.id || !user.email) {
        throw new BadDataException(RESET_LINK_MESSAGES.invalid);
      }

      if (isExpired) {
        throw new BadDataException(RESET_LINK_MESSAGES.expired);
      }

      const newPassword: HashedString = new HashedString(password!);

      // The one password rule, after the link: a dead link is fixed by a new one.
      NewPasswordRule.assertMet(newPassword);

      await DashboardPrivateUserService.updateOneById({
        id: user.id,
        data: {
          password: newPassword,
        },
        props: {
          isRoot: true,
        },
      });

      if (dashboard.projectId) {
        MailService.sendMail(
          {
            toEmail: user.email,
            subject: "Password Changed.",
            isSubjectLiteral: true,
            templateType: EmailTemplateType.PrivateUserPasswordChanged,
            vars: {
              resourceName: getDashboardName(dashboard),
              homeURL: await DashboardService.getPublicDashboardUrl(
                dashboardId,
              ),
              // When, from where and on which device the password was changed.
              ...RequestOriginUtil.getEmailVars({
                origin: RequestOriginUtil.fromRequest(req),
              }),
            },
          },
          {
            projectId: dashboard.projectId,
          },
        ).catch((err: Error) => {
          logger.error(err, getLogAttributesFromRequest(req as RequestLike));
        });
      }

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * The session a single sign-on code stands for, on the host the dashboard's
 * page is served from: single sign-on ends on OneUptime's own address
 * (DashboardSSO, DashboardOIDC), and hands the page a code good for five
 * minutes, once. Every code that cannot be exchanged - not a code, one
 * spent or run out, another dashboard's, one whose provider was turned off
 * since - is answered alike.
 */
router.post(
  `${DashboardPrivateUserApiRoutes.exchangeLoginCode}/:dashboardId`,
  refuseForeignPageRequests,
  requireJsonBody,
  readRateLimit,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      Response.setNoCacheHeaders(res);

      const dashboardId: ObjectID = readDashboardId(req);
      const loginCode: unknown = req.body ? req.body["loginCode"] : undefined;

      if (typeof loginCode !== "string" || !ObjectID.isValidUUID(loginCode)) {
        throw new BadDataException(DASHBOARD_SIGN_IN_CODE_INVALID_MESSAGE);
      }

      await getDashboardForSignIn({ req, dashboardId });

      const sessionMetadata: PrivateUserSessionMetadata<DashboardPrivateUserSession> | null =
        await DashboardPrivateUserSessionService.exchangeLoginCode(loginCode, {
          resourceId: dashboardId,
          ipAddress: getClientIp(req),
          userAgent: headerValueToString(req.headers["user-agent"]),
          ...extractDeviceInfo(req),
        });

      const session: DashboardPrivateUserSession | undefined =
        sessionMetadata?.session;

      if (!sessionMetadata || !session?.id || !session.dashboardPrivateUserId) {
        throw new BadDataException(DASHBOARD_SIGN_IN_CODE_INVALID_MESSAGE);
      }

      const privateUser: DashboardPrivateUser | null =
        await DashboardPrivateUserService.findOneById({
          id: session.dashboardPrivateUserId,
          select: {
            _id: true,
            email: true,
            dashboardId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (
        !privateUser?.id ||
        !privateUser.email ||
        privateUser.dashboardId?.toString() !== dashboardId.toString() ||
        !(await DashboardPrivateUserSessionService.doesSignInStillCount({
          sessionId: session.id,
        }))
      ) {
        await DashboardPrivateUserSessionService.revokeSessionById(
          session.id,
          { reason: PRIVATE_USER_SIGN_IN_NO_LONGER_ACCEPTED_REASON },
        );

        throw new BadDataException(DASHBOARD_SIGN_IN_CODE_INVALID_MESSAGE);
      }

      return sendSignedIn({
        req,
        res,
        dashboardId,
        privateUserId: privateUser.id,
        email: privateUser.email.toString(),
        sessionMetadata,
      });
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * What the dashboard's sign-in page offers: a password, unless it takes
 * only single sign-on, and each single sign-on provider that is on, by the
 * name and the words its team gave it - nothing else of a provider, and
 * nothing of its private users. Answered only for a dashboard that asks its
 * visitors to sign in, to a visitor its IP allowlist lets in.
 */
router.post(
  `${DashboardPrivateUserApiRoutes.signInMethods}/:dashboardId`,
  readRateLimit,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      Response.setNoCacheHeaders(res);

      const dashboardId: ObjectID = readDashboardId(req);

      const dashboard: Dashboard = await getDashboardForSignIn({
        req,
        dashboardId,
      });

      const samlProviders: Array<DashboardSSO> =
        await DashboardSsoService.findBy({
          query: {
            dashboardId: dashboardId,
            isEnabled: true,
          },
          select: {
            _id: true,
            name: true,
            description: true,
          },
          skip: 0,
          limit: 50,
          props: {
            isRoot: true,
          },
        });

      const oidcProviders: Array<DashboardOIDC> =
        await DashboardOidcService.findBy({
          query: {
            dashboardId: dashboardId,
            isEnabled: true,
          },
          select: {
            _id: true,
            name: true,
            description: true,
          },
          skip: 0,
          limit: 50,
          props: {
            isRoot: true,
          },
        });

      const toProvider: (provider: DashboardSSO | DashboardOIDC) => DashboardSignInProvider = (
        provider: DashboardSSO | DashboardOIDC,
      ): DashboardSignInProvider => {
        return {
          _id: provider.id!.toString(),
          name: provider.name || "",
          description: provider.description || "",
        };
      };

      const methods: DashboardSignInMethods = {
        isPasswordSignInAllowed: !dashboard.requireSsoForLogin,
        samlProviders: samlProviders.map(toProvider),
        oidcProviders: oidcProviders.map(toProvider),
      };

      return Response.sendJsonObjectResponse(
        req,
        res,
        methods as unknown as JSONObject,
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
