import crypto from "crypto";
import CredentialGuard from "../Utils/CredentialGuard";
import FormSignIn from "../Utils/FormSignIn";
import IdentityRateLimit, {
  IdentityRateLimitBucket,
} from "Common/Server/Middleware/IdentityRateLimit";
import FormRateLimit, {
  FormRateLimitBucket,
  FormRateLimitFormSource,
} from "Common/Server/Middleware/FormRateLimit";
import PublicMessageRateLimit, {
  PublicMessageKind,
} from "Common/Server/Utils/RateLimit/PublicMessageRateLimit";
import { EncryptionSecret } from "Common/Server/EnvironmentConfig";
import FormOidcService from "Common/Server/Services/FormOidcService";
import FormPrivateUserService, {
  getFormResetPasswordUrl,
} from "Common/Server/Services/FormPrivateUserService";
import FormPrivateUserSessionService from "Common/Server/Services/FormPrivateUserSessionService";
import FormService from "Common/Server/Services/FormService";
import FormSsoService from "Common/Server/Services/FormSsoService";
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
  FormPrivateUserSessionClaims,
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
import Form from "Common/Models/DatabaseModels/Form";
import FormOIDC from "Common/Models/DatabaseModels/FormOidc";
import FormPrivateUser from "Common/Models/DatabaseModels/FormPrivateUser";
import FormPrivateUserSession from "Common/Models/DatabaseModels/FormPrivateUserSession";
import FormSSO from "Common/Models/DatabaseModels/FormSso";
import {
  INCOMPLETE_RESET_LINK_MESSAGE,
  RESET_LINK_MESSAGES,
} from "Common/Types/Accounts/SignInMessages";
import {
  FORM_PRIVATE_USER_CREDENTIALS_MESSAGE,
  FORM_SESSION_EXPIRED_MESSAGE,
  FORM_SIGN_IN_CODE_INVALID_MESSAGE,
  FORM_SIGNED_OUT_MESSAGE,
  FORM_SSO_ONLY_MESSAGE,
  FormPrivateUserApiRoutes,
  FormSignInMethods,
  FormSignInProvider,
} from "Common/Types/Form/FormPrivateUserSignIn";
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
 * A FORM'S PUBLIC LINK SIGNS ITS PRIVATE USERS IN (#10249).
 *
 * A form set to Only people who sign in (Form.requireSignIn) lets in only
 * its private users (FormPrivateUser), and its page signs them in here -
 * on the host it is served from, OneUptime's own or one of the form's
 * custom domains, under the form's API: the identity service mounts this
 * router at /api/form/private-user, where every host sends /api/form. As a
 * dashboard's private users sign in (DashboardPrivateUserAuthentication),
 * and a status page's (StatusPageAuthentication):
 *
 *   POST /login/:formId                a password; one answer for every
 *                                           address that does not sign in
 *   POST /logout/:formId               ends the browser's session there
 *   POST /refresh-token/:formId        a new access token, while the
 *                                           session counts
 *   POST /forgot-password/:formId      a reset link; the same answer for
 *                                           every address
 *   POST /reset-password/:formId       a new password from that link
 *   POST /exchange-login-code/:formId  the session a single sign-on code
 *                                           stands for, on this host
 *   POST /sign-in-methods/:formId      what the sign-in page offers
 *
 * Every route answers only for a form whose public link asks its
 * visitors to sign in, and only for a visitor its IP allowlist lets in
 * (getFormForSignIn): anything else reads as a form that is not
 * there, or the allowlist's refusal, before an address is looked at.
 *
 * A route that changes something first refuses a request another site's
 * page had a browser send (refuseForeignPageRequests: the page is served on
 * the host the request goes to, so its Origin is that host), and the ones
 * that take a body take only JSON, which no page of another site can have
 * a browser send without a preflight. The session's cookies are
 * SameSite=Strict too (CookieUtil.setFormPrivateUserCookie).
 * ---------------------------------------------------------------------------
 */

const router: ExpressRouter = Express.getRouter();

const ACCESS_TOKEN_EXPIRY_SECONDS: number = 15 * 60;

const readRateLimit: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> = FormRateLimit.getMiddleware(
  FormRateLimitBucket.Read,
  FormRateLimitFormSource.FormId,
);

// The one refusal of a request another page had a browser send.
export const FORM_SIGN_IN_FOREIGN_PAGE_MESSAGE: string =
  "This form can only be signed in to from its own page.";

export const FORM_SIGN_IN_BODY_MESSAGE: string =
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
      new ForbiddenException(FORM_SIGN_IN_FOREIGN_PAGE_MESSAGE),
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
      new BadDataException(FORM_SIGN_IN_BODY_MESSAGE),
    );
  }

  return next();
};

// The form a route names, or a refusal: a value that is no id is no form.
const readFormId: (req: ExpressRequest) => ObjectID = (
  req: ExpressRequest,
): ObjectID => {
  return FormSignIn.readFormId(req.params["formId"]);
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
 * The form a sign-in is for, as its public link answers this visitor
 * (Utils/FormSignIn): asked before any private user is looked at.
 */
const getFormForSignIn: (data: {
  req: ExpressRequest;
  formId: ObjectID;
}) => Promise<Form> = async (data: {
  req: ExpressRequest;
  formId: ObjectID;
}): Promise<Form> => {
  return await FormSignIn.getFormForSignIn(data);
};

const getFormName: (form: Form) => string = (form: Form): string => {
  return FormSignIn.getFormName(form);
};

/*
 * Signs the browser in on this host: the session's three cookies
 * (CookieUtil.setFormPrivateUserCookie), and who signed in in the
 * answer - their address, and nothing else of them.
 */
const sendSignedIn: (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  formId: ObjectID;
  privateUserId: ObjectID;
  email: string;
  sessionMetadata: PrivateUserSessionMetadata<FormPrivateUserSession>;
}) => void = (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  formId: ObjectID;
  privateUserId: ObjectID;
  email: string;
  sessionMetadata: PrivateUserSessionMetadata<FormPrivateUserSession>;
}): void => {
  CookieUtil.setFormPrivateUserCookie({
    expressResponse: data.res,
    formId: data.formId,
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
 * there is one, is ended, the browser's cookies for the form are
 * removed, and it is answered as signed out.
 */
const endRefresh: (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  formId: ObjectID;
  revoke?: { sessionId: ObjectID; reason: string } | undefined;
  message: string;
}) => Promise<void> = async (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  formId: ObjectID;
  revoke?: { sessionId: ObjectID; reason: string } | undefined;
  message: string;
}): Promise<void> => {
  if (data.revoke) {
    await FormPrivateUserSessionService.revokeSessionById(
      data.revoke.sessionId,
      { reason: data.revoke.reason },
    );
  }

  CookieUtil.removeFormPrivateUserCookies(data.res, data.formId);

  return Response.sendErrorResponse(
    data.req,
    data.res,
    new NotAuthenticatedException(data.message),
  );
};

/*
 * A private user's password. Counted first, per address and per account
 * (IdentityRateLimit), so a refused attempt costs neither the lookup nor the
 * password check. An address that is no private user of the form, one
 * with no password yet and a wrong password are answered alike, after as
 * long as a password check takes (PasswordHash.spendVerificationTime), so
 * the page says nothing about who is invited.
 */
router.post(
  `${FormPrivateUserApiRoutes.login}/:formId`,
  refuseForeignPageRequests,
  requireJsonBody,
  IdentityRateLimit.getMiddleware(IdentityRateLimitBucket.FormPrivateUserLogin),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      Response.setNoCacheHeaders(res);

      const formId: ObjectID = readFormId(req);
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

      const form: Form = await getFormForSignIn({
        req,
        formId,
      });

      // A form that takes only single sign-on takes no password.
      if (form.requireSsoForLogin) {
        throw new BadDataException(FORM_SSO_ONLY_MESSAGE);
      }

      const email: Email = new Email(emailText!.trim());

      const privateUser: FormPrivateUser | null =
        await FormPrivateUserService.findOneBy({
          query: {
            email: email,
            formId: formId,
          },
          select: {
            _id: true,
            password: true,
            passwordSalt: true,
            email: true,
            formId: true,
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      let isPasswordValid: boolean = false;

      if (privateUser && privateUser.password) {
        isPasswordValid = await FormPrivateUserService.verifyHashedColumnValue({
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
        throw new BadDataException(FORM_PRIVATE_USER_CREDENTIALS_MESSAGE);
      }

      const sessionMetadata: PrivateUserSessionMetadata<FormPrivateUserSession> =
        await FormPrivateUserSessionService.createSession({
          projectId: privateUser.projectId,
          resourceId: formId,
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
        formId,
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
 * Ends the session this browser holds on the form, and removes its
 * cookies there, whatever else happens: by its refresh token, else by its
 * sign-out cookie - a renewal whose answer never reached the browser
 * rotated the refresh token, and the session would stay signed in though
 * its reader signed out. Answered alike whether there was a session.
 */
router.post(
  `${FormPrivateUserApiRoutes.logout}/:formId`,
  refuseForeignPageRequests,
  readRateLimit,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    let formId: ObjectID | null = null;

    try {
      Response.setNoCacheHeaders(res);

      formId = readFormId(req);

      const refreshToken: string | undefined =
        CookieUtil.getFormPrivateUserRefreshTokenFromExpressRequest(
          req,
          formId,
        );

      const hasEndedSession: boolean = refreshToken
        ? await FormPrivateUserSessionService.revokeSessionByRefreshToken(
            refreshToken,
            { reason: PRIVATE_USER_SESSION_SIGNED_OUT_REASON },
          )
        : false;

      if (!hasEndedSession) {
        const signOutToken: string | undefined =
          CookieUtil.getFormPrivateUserSignOutTokenFromExpressRequest(
            req,
            formId,
          );

        let sessionToSignOut: FormPrivateUserSessionClaims | null = null;

        if (signOutToken) {
          try {
            sessionToSignOut =
              JSONWebToken.decodeFormPrivateUserSessionToSignOut(signOutToken);
          } catch {
            // Not a sign-out cookie OneUptime signed, or one that ran out.
            sessionToSignOut = null;
          }
        }

        if (
          sessionToSignOut &&
          sessionToSignOut.formId.toString() === formId.toString()
        ) {
          await FormPrivateUserSessionService.revokeLiveSessionOfPrivateUser(
            {
              resourceId: sessionToSignOut.formId,
              privateUserId: sessionToSignOut.userId,
              sessionId: sessionToSignOut.sessionId,
            },
            { reason: PRIVATE_USER_SESSION_SIGNED_OUT_REASON },
          );
        }
      }

      CookieUtil.removeFormPrivateUserCookies(res, formId);

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      /*
       * Ending the session failed - the database could not be reached, say.
       * The browser is still left with none of the form's session
       * cookies; the failure is still answered, and logged, as one.
       */
      if (formId && !res.headersSent) {
        CookieUtil.removeFormPrivateUserCookies(res, formId);
      }

      return next(err);
    }
  },
);

/*
 * A new access token, from the session's refresh token, while the session
 * still counts: still the form's, its private user still there, its
 * sign-in still accepted (a provider it signed in with still on, or no
 * Require SSO for one a password signed in). The refresh token is rotated
 * in the same conditional write; anything else ends the session.
 */
router.post(
  `${FormPrivateUserApiRoutes.refreshToken}/:formId`,
  refuseForeignPageRequests,
  readRateLimit,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      Response.setNoCacheHeaders(res);

      const formId: ObjectID = readFormId(req);

      const refreshToken: string | undefined =
        CookieUtil.getFormPrivateUserRefreshTokenFromExpressRequest(
          req,
          formId,
        );

      if (!refreshToken) {
        return await endRefresh({
          req,
          res,
          formId,
          message: FORM_SIGNED_OUT_MESSAGE,
        });
      }

      try {
        await getFormForSignIn({ req, formId });
      } catch (err) {
        // The link no longer signs anybody in here: the cookies go too.
        CookieUtil.removeFormPrivateUserCookies(res, formId);
        throw err;
      }

      const session: FormPrivateUserSession | null =
        await FormPrivateUserSessionService.findActiveSessionByRefreshToken(
          refreshToken,
        );

      if (
        !session ||
        !session.id ||
        FormPrivateUserSessionService.isLoginCodeSession(session)
      ) {
        return await endRefresh({
          req,
          res,
          formId,
          message: FORM_SESSION_EXPIRED_MESSAGE,
        });
      }

      if (
        !session.formId ||
        session.formId.toString() !== formId.toString() ||
        !session.formPrivateUserId
      ) {
        return await endRefresh({
          req,
          res,
          formId,
          revoke: {
            sessionId: session.id,
            reason: "Form mismatch",
          },
          message: FORM_SESSION_EXPIRED_MESSAGE,
        });
      }

      const privateUser: FormPrivateUser | null =
        await FormPrivateUserService.findOneById({
          id: session.formPrivateUserId,
          select: {
            _id: true,
            email: true,
            formId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (
        !privateUser?.id ||
        !privateUser.email ||
        privateUser.formId?.toString() !== formId.toString()
      ) {
        return await endRefresh({
          req,
          res,
          formId,
          revoke: {
            sessionId: session.id,
            reason: "Private user removed",
          },
          message: FORM_SESSION_EXPIRED_MESSAGE,
        });
      }

      if (
        !(await FormPrivateUserSessionService.doesSignInStillCount({
          sessionId: session.id,
        }))
      ) {
        return await endRefresh({
          req,
          res,
          formId,
          revoke: {
            sessionId: session.id,
            reason: PRIVATE_USER_SIGN_IN_NO_LONGER_ACCEPTED_REASON,
          },
          message: FORM_SESSION_EXPIRED_MESSAGE,
        });
      }

      const renewedSession: PrivateUserSessionMetadata<FormPrivateUserSession> | null =
        await FormPrivateUserSessionService.renewSessionWithNewRefreshToken({
          session,
          ipAddress: getClientIp(req),
          userAgent: headerValueToString(req.headers["user-agent"]),
          ...extractDeviceInfo(req),
        });

      // Ended while this request was on its way: it stays ended.
      if (!renewedSession) {
        return await endRefresh({
          req,
          res,
          formId,
          message: FORM_SESSION_EXPIRED_MESSAGE,
        });
      }

      return sendSignedIn({
        req,
        res,
        formId,
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
 * Emails a private user of the form a link to choose a password. The
 * answer is the same for every address - success, whether or not it is a
 * private user of the form - so asking says nothing about who is
 * invited. For the same reason the request is counted per caller and per
 * address (PublicMessageRateLimit) before the address is looked up, and the
 * link's token is minted and hashed before the lookup too, so both answers
 * cost the same work. What is refused before the count is a fact about the
 * form, never the address: one that signs nobody in, or signs its
 * visitors in with single sign-on only.
 */
router.post(
  `${FormPrivateUserApiRoutes.forgotPassword}/:formId`,
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

      const formId: ObjectID = readFormId(req);
      const emailText: string | undefined = readText(readData(req)["email"]);

      CredentialGuard.assertPresent(emailText, "Email");

      const form: Form = await getFormForSignIn({
        req,
        formId,
      });

      if (form.requireSsoForLogin) {
        throw new BadDataException(FORM_SSO_ONLY_MESSAGE);
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

      const privateUser: FormPrivateUser | null =
        await FormPrivateUserService.findOneBy({
          query: {
            email: email,
            formId: formId,
          },
          select: {
            _id: true,
            email: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (privateUser?.id && privateUser.email && form.projectId) {
        await FormPrivateUserService.updateOneById({
          id: privateUser.id,
          data: {
            resetPasswordToken: hashedToken,
            resetPasswordExpires: OneUptimeDate.getOneDayAfter(),
          },
          props: {
            isRoot: true,
          },
        });

        const formUrl: string = await FormService.getPublicFormUrl(formId);

        MailService.sendMail(
          {
            toEmail: privateUser.email,
            subject: "Password Reset Request for " + getFormName(form),
            isSubjectLiteral: true,
            templateType: EmailTemplateType.PrivateUserForgotPassword,
            vars: {
              resourceName: getFormName(form),
              homeURL: formUrl,
              tokenVerifyUrl: getFormResetPasswordUrl({
                resourceUrl: formUrl,
                token: token,
              }),
              // When, from where and on which device the reset was asked for.
              ...RequestOriginUtil.getEmailVars({
                origin: RequestOriginUtil.fromRequest(req),
              }),
            },
          },
          {
            projectId: form.projectId,
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
 * user of this form whose latest link carries the token, while it
 * works. The write's own hooks end the link in the same statement, and
 * every session of the user, as every new password does
 * (PrivateUserServiceBase). No attempt limit beyond the read budget: the
 * token is a random UUID the server minted - 122 bits - that works once.
 */
router.post(
  `${FormPrivateUserApiRoutes.resetPassword}/:formId`,
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

      const formId: ObjectID = readFormId(req);
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

      const form: Form = await getFormForSignIn({
        req,
        formId,
      });

      if (form.requireSsoForLogin) {
        throw new BadDataException(FORM_SSO_ONLY_MESSAGE);
      }

      const { user, isExpired } =
        await FormPrivateUserService.findByResetPasswordToken({
          resourceId: formId,
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

      await FormPrivateUserService.updateOneById({
        id: user.id,
        data: {
          password: newPassword,
        },
        props: {
          isRoot: true,
        },
      });

      if (form.projectId) {
        MailService.sendMail(
          {
            toEmail: user.email,
            subject: "Password Changed.",
            isSubjectLiteral: true,
            templateType: EmailTemplateType.PrivateUserPasswordChanged,
            vars: {
              resourceName: getFormName(form),
              homeURL: await FormService.getPublicFormUrl(formId),
              // When, from where and on which device the password was changed.
              ...RequestOriginUtil.getEmailVars({
                origin: RequestOriginUtil.fromRequest(req),
              }),
            },
          },
          {
            projectId: form.projectId,
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
 * The session a single sign-on code stands for, on the host the form's
 * page is served from: single sign-on ends on OneUptime's own address
 * (FormSSO, FormOIDC), and hands the page a code good for five
 * minutes, once. Every code that cannot be exchanged - not a code, one
 * spent or run out, another form's, one whose provider was turned off
 * since - is answered alike.
 */
router.post(
  `${FormPrivateUserApiRoutes.exchangeLoginCode}/:formId`,
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

      const formId: ObjectID = readFormId(req);
      const loginCode: unknown = req.body ? req.body["loginCode"] : undefined;

      if (typeof loginCode !== "string" || !ObjectID.isValidUUID(loginCode)) {
        throw new BadDataException(FORM_SIGN_IN_CODE_INVALID_MESSAGE);
      }

      await getFormForSignIn({ req, formId });

      const sessionMetadata: PrivateUserSessionMetadata<FormPrivateUserSession> | null =
        await FormPrivateUserSessionService.exchangeLoginCode(loginCode, {
          resourceId: formId,
          ipAddress: getClientIp(req),
          userAgent: headerValueToString(req.headers["user-agent"]),
          ...extractDeviceInfo(req),
        });

      const session: FormPrivateUserSession | undefined =
        sessionMetadata?.session;

      if (!sessionMetadata || !session?.id || !session.formPrivateUserId) {
        throw new BadDataException(FORM_SIGN_IN_CODE_INVALID_MESSAGE);
      }

      const privateUser: FormPrivateUser | null =
        await FormPrivateUserService.findOneById({
          id: session.formPrivateUserId,
          select: {
            _id: true,
            email: true,
            formId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (
        !privateUser?.id ||
        !privateUser.email ||
        privateUser.formId?.toString() !== formId.toString() ||
        !(await FormPrivateUserSessionService.doesSignInStillCount({
          sessionId: session.id,
        }))
      ) {
        await FormPrivateUserSessionService.revokeSessionById(session.id, {
          reason: PRIVATE_USER_SIGN_IN_NO_LONGER_ACCEPTED_REASON,
        });

        throw new BadDataException(FORM_SIGN_IN_CODE_INVALID_MESSAGE);
      }

      return sendSignedIn({
        req,
        res,
        formId,
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
 * What the form's sign-in page offers: a password, unless it takes
 * only single sign-on, and each single sign-on provider that is on, by the
 * name and the words its team gave it - nothing else of a provider, and
 * nothing of its private users. Answered only for a form that asks its
 * visitors to sign in, to a visitor its IP allowlist lets in.
 */
router.post(
  `${FormPrivateUserApiRoutes.signInMethods}/:formId`,
  readRateLimit,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      Response.setNoCacheHeaders(res);

      const formId: ObjectID = readFormId(req);

      const form: Form = await getFormForSignIn({
        req,
        formId,
      });

      const samlProviders: Array<FormSSO> = await FormSsoService.findBy({
        query: {
          formId: formId,
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

      const oidcProviders: Array<FormOIDC> = await FormOidcService.findBy({
        query: {
          formId: formId,
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

      const toProvider: (provider: FormSSO | FormOIDC) => FormSignInProvider = (
        provider: FormSSO | FormOIDC,
      ): FormSignInProvider => {
        return {
          _id: provider.id!.toString(),
          name: provider.name || "",
          description: provider.description || "",
        };
      };

      const methods: FormSignInMethods = {
        isPasswordSignInAllowed: !form.requireSsoForLogin,
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
