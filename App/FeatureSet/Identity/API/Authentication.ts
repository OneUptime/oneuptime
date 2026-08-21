import AuthenticationEmail from "../Utils/AuthenticationEmail";
import CredentialGuard from "../Utils/CredentialGuard";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { AccountsRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import BadDataException from "Common/Types/Exception/BadDataException";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import { JSONObject } from "Common/Types/JSON";
import HashedString from "Common/Types/HashedString";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import {
  AppVersion,
  EncryptionSecret,
  IsBillingEnabled,
} from "Common/Server/EnvironmentConfig";
import API from "Common/Utils/API";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import EmailVerificationTokenService from "Common/Server/Services/EmailVerificationTokenService";
import MailService from "Common/Server/Services/MailService";
import UserService from "Common/Server/Services/UserService";
import UserTotpAuthService from "Common/Server/Services/UserTotpAuthService";
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
import CaptchaUtil from "Common/Server/Utils/Captcha";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import TotpAuth from "Common/Server/Utils/TotpAuth";
import UserRegistrationToken from "Common/Server/Utils/UserRegistrationToken";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import User from "Common/Models/DatabaseModels/User";
import UserSession from "Common/Models/DatabaseModels/UserSession";
import UserTotpAuth from "Common/Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "Common/Models/DatabaseModels/UserWebAuthn";
import UserWebAuthnService from "Common/Server/Services/UserWebAuthnService";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";

const router: ExpressRouter = Express.getRouter();

const ACCESS_TOKEN_EXPIRY_SECONDS: number = 15 * 60;

interface FinalizeUserLoginResult {
  sessionMetadata: SessionMetadata;
  accessToken: string;
}

type FinalizeUserLoginInput = {
  req: ExpressRequest;
  res: ExpressResponse;
  user: User;
  isGlobalLogin: boolean;
};

const finalizeUserLogin: (
  data: FinalizeUserLoginInput,
) => Promise<FinalizeUserLoginResult> = async (
  data: FinalizeUserLoginInput,
): Promise<FinalizeUserLoginResult> => {
  const { req, res, user, isGlobalLogin } = data;

  const sessionMetadata: SessionMetadata =
    await UserSessionService.createSession({
      userId: user.id!,
      isGlobalLogin,
      ipAddress: getClientIp(req),
      userAgent: headerValueToString(req.headers["user-agent"]),
      ...extractDeviceInfo(req),
    });

  CookieUtil.setUserCookie({
    expressResponse: res,
    user,
    isGlobalLogin,
    sessionId: sessionMetadata.session.id!,
    refreshToken: sessionMetadata.refreshToken,
    refreshTokenExpiresAt: sessionMetadata.refreshTokenExpiresAt,
    accessTokenExpiresInSeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
  });

  // Generate access token for response body (used by mobile clients)
  const accessToken: string = JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: user.id!,
      email: user.email!,
      name: user.name!,
      timezone: user.timezone || null,
      isMasterAdmin: user.isMasterAdmin!,
      isGlobalLogin: isGlobalLogin,
      sessionId: sessionMetadata.session.id!,
    },
    expiresInSeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
  });

  return { sessionMetadata, accessToken };
};

router.post(
  "/signup",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (await DatabaseConfig.shouldDisableSignup()) {
        /*
         * Check if this user has been invited to a project.
         * If so, allow them to sign up even if signup is disabled.
         */
        const data: JSONObject = req.body["data"] as JSONObject;
        const emailForInviteCheck: string | undefined = data?.["email"] as
          | string
          | undefined;

        let hasInvitation: boolean = false;

        if (emailForInviteCheck) {
          const invitedUser: User | null = await UserService.findOneBy({
            query: { email: new Email(emailForInviteCheck) },
            select: { _id: true },
            props: { isRoot: true },
          });

          if (invitedUser) {
            const pendingInvitation: TeamMember | null =
              await TeamMemberService.findOneBy({
                query: {
                  userId: invitedUser.id!,
                  hasAcceptedInvitation: false,
                },
                select: { _id: true },
                props: { isRoot: true },
              });

            if (pendingInvitation) {
              hasInvitation = true;
            }
          }
        }

        if (!hasInvitation) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException(
              "Sign up is disabled on this OneUptime Server. Please contact your server admin to enable it.",
            ),
          );
        }
      }

      const miscDataProps: JSONObject =
        (req.body["miscDataProps"] as JSONObject) || {};

      await CaptchaUtil.verifyCaptcha({
        token:
          (miscDataProps["captchaToken"] as string | undefined) ||
          (req.body["captchaToken"] as string | undefined),
        remoteIp: getClientIp(req) || null,
      });

      const data: JSONObject = req.body["data"];

      /* Creating a type that is a partial of the TBaseModel type. */
      const partialUser: User = BaseModel.fromJSON(
        data as JSONObject,
        User,
      ) as User;

      /*
       * A missing email would drop the predicate below and resolve `alreadySavedUser` to the
       * newest user in the instance. If that user has no password yet (invited but not signed
       * up), the update branch would hand the caller a real session for that account.
       */
      CredentialGuard.assertPresent(partialUser.email, "Email");

      /*
       * ALERT: an isMasterAdmin smuggled into the request body must never
       * survive — signup writes with isRoot, which bypasses the column's empty
       * `create: []` access control. Whether this user is the instance's first
       * Master Admin is not decided here: UserService.createUserOnSignup owns
       * that call and makes it under a lock, because the check ("is the User
       * table empty?") and the insert have to be atomic with respect to another
       * signup arriving at the same moment.
       */
      partialUser.isMasterAdmin = false;

      // Outside the hosted service, there is no billing to gate the account on.
      partialUser.isEmailVerified = !IsBillingEnabled;

      const alreadySavedUser: User | null = await UserService.findOneBy({
        query: { email: partialUser.email as Email },
        select: {
          _id: true,
          password: true,
          timezone: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (alreadySavedUser && alreadySavedUser.password) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            `User with email ${partialUser.email} already exists.`,
          ),
        );
      }

      let savedUser: User | null = null;

      /*
       * True once this request has claimed a pending invitation rather than
       * created a fresh account. Spending the registration token is itself
       * proof of mailbox ownership, so the verification mail further down would
       * be asking them to prove something they just proved.
       */
      let didClaimInvitedAccount: boolean = false;

      if (alreadySavedUser) {
        /*
         * A row with no password is an invitation nobody has claimed yet --
         * TeamMemberService creates it so the membership has a user to point
         * at, and it stays passwordless until the invited person registers.
         *
         * Reaching this branch therefore means the caller is claiming someone
         * else's pending invitation, and the only thing separating the invited
         * person from an attacker who guessed a corporate address is the token
         * that went out in the invitation email (GHSA-qg84-6hrg-mr5g). Anything
         * derived from the request body -- the address itself included -- is
         * attacker-supplied and proves nothing.
         */
        const suppliedRegistrationToken: string | undefined = (
          miscDataProps["registrationToken"] as string | undefined
        )
          ?.toString()
          .trim();

        const hasProvenMailboxOwnership: boolean =
          Boolean(suppliedRegistrationToken) &&
          ObjectID.isValidUUID(suppliedRegistrationToken!) &&
          (await UserRegistrationToken.consumeRegistrationToken({
            token: new ObjectID(suppliedRegistrationToken!),
            email: partialUser.email as Email,
          }));

        if (!hasProvenMailboxOwnership) {
          /*
           * Nothing is written and no session is issued. The account is left
           * exactly as the invitation left it, so a failed claim cannot set a
           * password, cannot lock the invited person out, and cannot be told
           * apart from a successful one by the caller.
           *
           * Instead the *mailbox owner* gets a fresh link. That covers the two
           * honest ways to land here -- an invitation sent before invitations
           * carried tokens, and a token that has since expired -- without
           * covering the dishonest one, because the mail goes to the address,
           * never to the requester. The captcha verified at the top of this
           * handler is what stops this branch from being a mail cannon.
           */
          await AuthenticationEmail.sendCompleteRegistrationEmail({
            userId: alreadySavedUser.id!,
            email: partialUser.email as Email,
          });

          logger.info(
            "Registration link re-sent for an unclaimed invited account: " +
              partialUser.email?.toString(),
            getLogAttributesFromRequest(req as RequestLike),
          );

          return Response.sendEntityResponse(req, res, null, User, {
            miscData: {
              registrationEmailSent: true,
            },
          });
        }

        didClaimInvitedAccount = true;

        savedUser = await UserService.updateOneByIdAndFetch({
          id: alreadySavedUser.id!,
          data: {
            password: partialUser.password!,
            name: partialUser.name!,
            companyPhoneNumber: partialUser.companyPhoneNumber!,
            companyName: partialUser.companyName!,
            /*
             * The token arrived by email and was spent to get here, which is
             * the same thing /verify-email checks for. Leaving this false would
             * mail them a second link to prove the same fact.
             */
            isEmailVerified: true,
          },
          select: {
            email: true,
            _id: true,
            name: true,
            isMasterAdmin: true,
            timezone: true,
          },
          props: {
            isRoot: true,
          },
        });
      } else {
        const user: User = partialUser;

        savedUser = await UserService.createUserOnSignup({
          user: user,
          props: {
            isRoot: true,
          },
        });
      }

      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      /*
       * Skipped when this signup claimed an invitation: the registration token
       * it spent was itself an emailed secret, so the address is already
       * verified and a "please verify your email" mail would be asking for a
       * proof that has just been given.
       */
      if (!didClaimInvitedAccount) {
        const generatedToken: ObjectID = ObjectID.generate();

        const emailVerificationToken: EmailVerificationToken =
          new EmailVerificationToken();
        emailVerificationToken.userId = savedUser?.id as ObjectID;
        emailVerificationToken.email = savedUser?.email as Email;
        emailVerificationToken.token = generatedToken;
        emailVerificationToken.expires = OneUptimeDate.getOneDayAfter();

        await EmailVerificationTokenService.create({
          data: emailVerificationToken,
          props: {
            isRoot: true,
          },
        });

        MailService.sendMail({
          toEmail: partialUser.email as Email,
          subject: "Welcome to OneUptime. Please verify your email.",
          templateType: EmailTemplateType.SignupWelcomeEmail,
          vars: {
            name: (partialUser.name! as Name).toString(),
            tokenVerifyUrl: new URL(
              httpProtocol,
              host,
              new Route(AccountsRoute.toString()).addRoute(
                "/verify-email/" + generatedToken.toString(),
              ),
            ).toString(),
            homeUrl: new URL(httpProtocol, host).toString(),
          },
        }).catch((err: Error) => {
          logger.error(err, getLogAttributesFromRequest(req as RequestLike));
        });
      }

      if (savedUser) {
        // Refresh Permissions for this user here.
        await AccessTokenService.refreshUserAllPermissions(savedUser.id!);
        await finalizeUserLogin({
          req,
          res,
          user: savedUser,
          isGlobalLogin: true,
        });

        logger.info(
          "User signed up: " + savedUser.email?.toString(),
          getLogAttributesFromRequest(req as RequestLike),
        );

        if (!IsBillingEnabled && miscDataProps["notifySelfHosted"] === true) {
          const instanceUrl: string = new URL(httpProtocol, host).toString();

          API.post({
            url: URL.fromString(
              "https://oneuptime.com/api/open-source-deployment/register",
            ),
            data: {
              email: savedUser.email?.toString() || "",
              name: savedUser.name?.toString() || "",
              companyName:
                (miscDataProps["selfHostedCompanyName"] as string) || undefined,
              companyPhoneNumber:
                (miscDataProps["selfHostedPhoneNumber"] as string) || undefined,
              oneuptimeVersion: AppVersion,
              instanceUrl: instanceUrl,
            },
          }).catch((err: Error) => {
            logger.error(err, getLogAttributesFromRequest(req as RequestLike));
          });
        }

        return Response.sendEntityResponse(req, res, savedUser, User);
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Failed to create a user"),
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

      const user: User = BaseModel.fromJSON(data as JSONObject, User) as User;

      /*
       * A missing email would drop the predicate and select the newest user in the instance,
       * writing a fresh reset token onto an unrelated account (and invalidating the one that
       * account may legitimately be using).
       */
      CredentialGuard.assertPresent(user.email, "Email");

      const alreadySavedUser: User | null = await UserService.findOneBy({
        query: { email: user.email! },
        select: {
          _id: true,
          password: true,
          name: true,
          email: true,
          isMasterAdmin: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (alreadySavedUser && alreadySavedUser.password) {
        const token: string = ObjectID.generate().toString();
        const hashedToken: string = await HashedString.hashValue(
          token,
          EncryptionSecret,
        );
        await UserService.updateOneBy({
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

        const tokenVerifyUrl: string = new URL(
          httpProtocol,
          host,
          new Route(AccountsRoute.toString()).addRoute(
            "/reset-password/" + token,
          ),
        ).toString();

        /*
         * The reset URL embeds the single-use reset token, which is a
         * password-equivalent credential until it is spent -- so it is not
         * logged, only mailed.
         */
        logger.debug(
          "User forgot password: " + user.email?.toString(),
          getLogAttributesFromRequest(req as RequestLike),
        );

        MailService.sendMail({
          toEmail: user.email!,
          subject: "Password Reset Request for OneUptime",
          templateType: EmailTemplateType.ForgotPassword,
          vars: {
            homeURL: new URL(httpProtocol, host).toString(),
            tokenVerifyUrl: tokenVerifyUrl,
          },
        }).catch((err: Error) => {
          logger.error(err, getLogAttributesFromRequest(req as RequestLike));
        });

        return Response.sendEmptySuccessResponse(req, res);
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(
          `No user is registered with ${user.email?.toString()}. Please sign up for a new account.`,
        ),
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/verify-email",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data: JSONObject = req.body["data"];

      const token: EmailVerificationToken = BaseModel.fromJSON(
        data as JSONObject,
        EmailVerificationToken,
      ) as EmailVerificationToken;

      /*
       * Without this an empty body yields `token.token === undefined`, TypeORM drops the
       * predicate, and the query returns the newest verification token in the instance --
       * verifying an address the caller never proved they control.
       */
      CredentialGuard.assertPresent(token.token, "Verification token");

      const alreadySavedToken: EmailVerificationToken | null =
        await EmailVerificationTokenService.findOneBy({
          query: { token: token.token! },
          select: {
            _id: true,
            userId: true,
            email: true,
            expires: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!alreadySavedToken) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Invalid link. Please try to log in and we will resend you another link which you should be able to verify email with.",
          ),
        );
      }

      if (OneUptimeDate.hasExpired(alreadySavedToken.expires!)) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Link expired. Please try to log in and we will resend you another link which you should be able to verify email with.",
          ),
        );
      }

      const user: User | null = await UserService.findOneBy({
        query: {
          email: alreadySavedToken.email!,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          email: true,
        },
      });

      if (!user) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Invalid link. Please try to log in and we will resend you another link which you should be able to verify email with.",
          ),
        );
      }

      await UserService.updateOneBy({
        query: {
          _id: user._id!,
        },
        data: {
          isEmailVerified: true,
        },
        props: {
          isRoot: true,
        },
      });

      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      MailService.sendMail({
        toEmail: user.email!,
        subject: "Email Verified.",
        templateType: EmailTemplateType.EmailVerified,
        vars: {
          homeURL: new URL(httpProtocol, host).toString(),
        },
      }).catch((err: Error) => {
        logger.error(err, getLogAttributesFromRequest(req as RequestLike));
      });

      logger.info(
        "User email verified: " + user.email?.toString(),
        getLogAttributesFromRequest(req as RequestLike),
      );

      return Response.sendEmptySuccessResponse(req, res);
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
      const data: JSONObject = req.body["data"];

      const user: User = BaseModel.fromJSON(data as JSONObject, User) as User;

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

      const alreadySavedUser: User | null = await UserService.findOneBy({
        query: {
          resetPasswordToken: hashedToken,
        },
        select: {
          _id: true,
          password: true,
          name: true,
          email: true,
          isMasterAdmin: true,
          resetPasswordExpires: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!alreadySavedUser) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Invalid link. Please go to forgot password page again and request a new link.",
          ),
        );
      }

      if (
        alreadySavedUser &&
        OneUptimeDate.hasExpired(alreadySavedUser.resetPasswordExpires!)
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Expired link. Please go to forgot password page again and request a new link.",
          ),
        );
      }

      await UserService.updateOneById({
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

      // Revoke all active sessions for this user on password reset
      await UserSessionService.revokeAllSessionsByUserId(alreadySavedUser.id!, {
        reason: "Password reset",
      });

      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      MailService.sendMail({
        toEmail: alreadySavedUser.email!,
        subject: "Password Changed.",
        templateType: EmailTemplateType.PasswordChanged,
        vars: {
          homeURL: new URL(httpProtocol, host).toString(),
        },
      }).catch((err: Error) => {
        logger.error(err, getLogAttributesFromRequest(req as RequestLike));
      });

      logger.info(
        "User password reset: " + alreadySavedUser.email?.toString(),
        getLogAttributesFromRequest(req as RequestLike),
      );

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/refresh-token",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // Try cookie first, then fallback to request body (for mobile clients)
      const refreshToken: string | undefined =
        CookieUtil.getRefreshTokenFromExpressRequest(req) ||
        (req.body.refreshToken as string | undefined);

      if (!refreshToken) {
        CookieUtil.removeAllCookies(req, res);
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException(
            "Refresh token missing. Please login again.",
          ),
        );
      }

      const session: UserSession | null =
        await UserSessionService.findActiveSessionByRefreshToken(refreshToken);

      if (!session || !session.id) {
        CookieUtil.removeAllCookies(req, res);
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
        await UserSessionService.revokeSessionById(session.id, {
          reason: "Refresh token expired",
        });
        CookieUtil.removeAllCookies(req, res);
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException("Session expired. Please login again."),
        );
      }

      if (!session.userId) {
        await UserSessionService.revokeSessionById(session.id, {
          reason: "Session missing user",
        });
        CookieUtil.removeAllCookies(req, res);
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException("Session expired. Please login again."),
        );
      }

      const user: User | null = await UserService.findOneById({
        id: session.userId,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          email: true,
          name: true,
          isMasterAdmin: true,
          profilePictureId: true,
          timezone: true,
          enableTwoFactorAuth: true,
        },
      });

      if (!user) {
        await UserSessionService.revokeSessionById(session.id, {
          reason: "User not found",
        });
        CookieUtil.removeAllCookies(req, res);
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException("Account no longer exists."),
        );
      }

      const additionalInfo: JSONObject = (session.additionalInfo ||
        {}) as JSONObject;
      const isGlobalLogin: boolean =
        typeof additionalInfo["isGlobalLogin"] === "boolean"
          ? (additionalInfo["isGlobalLogin"] as boolean)
          : true;

      const renewedSession: SessionMetadata =
        await UserSessionService.renewSessionWithNewRefreshToken({
          session,
          ipAddress: getClientIp(req),
          userAgent: headerValueToString(req.headers["user-agent"]),
          ...extractDeviceInfo(req),
        });

      CookieUtil.setUserCookie({
        expressResponse: res,
        user,
        isGlobalLogin,
        sessionId: renewedSession.session.id!,
        refreshToken: renewedSession.refreshToken,
        refreshTokenExpiresAt: renewedSession.refreshTokenExpiresAt,
        accessTokenExpiresInSeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
      });

      // Generate access token for response body (used by mobile clients)
      const newAccessToken: string = JSONWebToken.signUserLoginToken({
        tokenData: {
          userId: user.id!,
          email: user.email!,
          name: user.name!,
          timezone: user.timezone || null,
          isMasterAdmin: user.isMasterAdmin!,
          isGlobalLogin: isGlobalLogin,
          sessionId: renewedSession.session.id!,
        },
        expiresInSeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
      });

      return Response.sendJsonObjectResponse(req, res, {
        accessToken: newAccessToken,
        refreshToken: renewedSession.refreshToken,
        refreshTokenExpiresAt:
          renewedSession.refreshTokenExpiresAt.toISOString(),
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/logout",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // Try cookie first, then fallback to request body (for mobile clients)
      const refreshToken: string | undefined =
        CookieUtil.getRefreshTokenFromExpressRequest(req) ||
        (req.body.refreshToken as string | undefined);

      if (refreshToken) {
        await UserSessionService.revokeSessionByRefreshToken(refreshToken, {
          reason: "User logout",
        });
      }

      CookieUtil.removeAllCookies(req, res);

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/verify-totp-auth",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return login({
      req: req,
      res: res,
      next: next,
      verifyTotpAuth: true,
      verifyWebAuthn: false,
      verifyTotpEnrolment: false,
    });
  },
);

router.post(
  "/verify-webauthn-auth",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return login({
      req: req,
      res: res,
      next: next,
      verifyTotpAuth: false,
      verifyWebAuthn: true,
      verifyTotpEnrolment: false,
    });
  },
);

/*
 * Finishes a two factor auth setup that an admin made mandatory, and signs the
 * user in in the same breath.
 *
 * This is a LOGIN route rather than something inside the product, and that is
 * the whole security design. The user reaching it has proved their password
 * but holds no session, no cookie and no token -- /login handed them a QR code
 * and nothing else. The alternative ("sign them in, then refuse to let them do
 * anything until they enrol") does not work here: CookieUtil.setUserCookie
 * writes a full-privilege JWT at path "/", and UserAuthorization validates it
 * statelessly without ever consulting the session table or
 * `enableTwoFactorAuth`. A gate drawn in the dashboard would be decoration --
 * the same cookie answers curl.
 *
 * So the credential is minted in exactly one place, `finalizeUserLogin`, and
 * an account under a mandate with nothing set up reaches it only through this
 * handler, only after a code has verified against the secret it was issued.
 *
 * The cost of being session-less is that the browser re-submits email and
 * password with this request. That is what /verify-totp-auth already does, and
 * it means there is no ambient authority for a cross-site request to ride and
 * no half-authenticated intermediate credential to steal.
 */
router.post(
  "/verify-totp-enrolment",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return login({
      req: req,
      res: res,
      next: next,
      verifyTotpAuth: false,
      verifyWebAuthn: false,
      verifyTotpEnrolment: true,
    });
  },
);

router.post(
  "/login",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return login({
      req: req,
      res: res,
      next: next,
      verifyTotpAuth: false,
      verifyWebAuthn: false,
      verifyTotpEnrolment: false,
    });
  },
);

type FetchTotpAuthListFunction = (userId: ObjectID) => Promise<{
  totpAuthList: Array<UserTotpAuth>;
  webAuthnList: Array<UserWebAuthn>;
}>;

const fetchTotpAuthList: FetchTotpAuthListFunction = async (
  userId: ObjectID,
): Promise<{
  totpAuthList: Array<UserTotpAuth>;
  webAuthnList: Array<UserWebAuthn>;
}> => {
  const totpAuthList: Array<UserTotpAuth> = await UserTotpAuthService.findBy({
    query: {
      userId: userId,
      isVerified: true,
    },
    select: {
      _id: true,
      userId: true,
      name: true,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  const webAuthnList: Array<UserWebAuthn> = await UserWebAuthnService.findBy({
    query: {
      userId: userId,
      isVerified: true,
    },
    select: {
      _id: true,
      userId: true,
      name: true,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  return {
    totpAuthList: totpAuthList || [],
    webAuthnList: webAuthnList || [],
  };
};

/*
 * The name a forced enrolment is filed under.
 *
 * `UserTotpAuth.name` is NOT NULL and the user never gets to type one here --
 * they are being marched through setup, not browsing a settings page -- so the
 * server has to supply something. It shows up in their profile afterwards, and
 * they can rename it there.
 */
const FORCED_TOTP_ENROLMENT_NAME: string = "Authenticator App";

/**
 * The pending TOTP enrolment to draw a QR code from, reusing one if it exists.
 *
 * Reuse rather than always-create, for two reasons that pull the same way:
 * refreshing the login page must not invalidate a QR code the user has already
 * scanned into their phone, and a user who opens the login page five times
 * should not leave five orphaned secrets behind them.
 *
 * The row is created unverified, which is what keeps it invisible to the rest
 * of the system: `fetchTotpAuthList` selects `isVerified: true`, so a pending
 * enrolment lying around never satisfies the two factor gate and never appears
 * as a method the user could choose at the challenge screen.
 *
 * The secret and the otpauth URL are minted server-side by
 * UserTotpAuthService.onBeforeCreate -- which is also why the props carry
 * `userId` alongside `isRoot`: the hook reads the owner from the props, not
 * from the data, and refuses the create without it.
 */
type GetOrCreatePendingTotpEnrolmentFunction = (
  userId: ObjectID,
) => Promise<UserTotpAuth>;

const getOrCreatePendingTotpEnrolment: GetOrCreatePendingTotpEnrolmentFunction =
  async (userId: ObjectID): Promise<UserTotpAuth> => {
    const existingPendingEnrolment: UserTotpAuth | null =
      await UserTotpAuthService.findOneBy({
        query: {
          userId: userId,
          isVerified: false,
        },
        select: {
          _id: true,
          twoFactorOtpUrl: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (
      existingPendingEnrolment &&
      existingPendingEnrolment.twoFactorOtpUrl &&
      existingPendingEnrolment.id
    ) {
      return existingPendingEnrolment;
    }

    const newEnrolment: UserTotpAuth = new UserTotpAuth();
    newEnrolment.name = FORCED_TOTP_ENROLMENT_NAME;

    return UserTotpAuthService.create({
      data: newEnrolment,
      props: {
        isRoot: true,
        userId: userId,
      },
    });
  };

/*
 * The three second-step modes this handler serves, on top of a plain password
 * login when all of them are false.
 *
 * `verifyTotpEnrolment` is the one an ADMIN creates. The other two prove a
 * factor the account already has; this one sets a factor up, for an account
 * that is required to use two factor auth and has nothing behind that
 * requirement yet. It is a login stage rather than a page inside the product
 * because the session must not exist until the factor does -- see the
 * enrolment branch below.
 */
type LoginFunction = (options: {
  req: ExpressRequest;
  res: ExpressResponse;
  next: NextFunction;
  verifyTotpAuth: boolean;
  verifyWebAuthn: boolean;
  verifyTotpEnrolment: boolean;
}) => Promise<void>;

const login: LoginFunction = async (options: {
  req: ExpressRequest;
  res: ExpressResponse;
  next: NextFunction;
  verifyTotpAuth: boolean;
  verifyWebAuthn: boolean;
  verifyTotpEnrolment: boolean;
}): Promise<void> => {
  const req: ExpressRequest = options.req;
  const res: ExpressResponse = options.res;
  const next: NextFunction = options.next;
  const verifyTotpAuth: boolean = options.verifyTotpAuth;
  const verifyWebAuthn: boolean = options.verifyWebAuthn;
  const verifyTotpEnrolment: boolean = options.verifyTotpEnrolment;

  try {
    const miscDataProps: JSONObject =
      (req.body["miscDataProps"] as JSONObject) || {};

    /*
     * Only the first step of a login carries a captcha. hCaptcha tokens are
     * single use, so the second step cannot replay the one the password step
     * already spent, and demanding a fresh one would mean rendering a second
     * challenge in the middle of an authentication the user has already
     * mostly completed.
     */
    if (!verifyTotpAuth && !verifyWebAuthn && !verifyTotpEnrolment) {
      await CaptchaUtil.verifyCaptcha({
        token:
          (miscDataProps["captchaToken"] as string | undefined) ||
          (req.body["captchaToken"] as string | undefined),
        remoteIp: getClientIp(req) || null,
      });
    }

    const data: JSONObject = req.body["data"];

    /*
     * The request body is NOT logged here. This handler is shared by password
     * login, TOTP verification and WebAuthn verification, so the body carries a
     * plaintext password, a TOTP code, or a WebAuthn assertion on every call --
     * and DEBUG output goes to stdout, the recent-log buffer and telemetry at
     * once. Log the stage instead; the user is identified by the request
     * attributes.
     */
    logger.debug(
      "Login request received. stage: " +
        (verifyTotpAuth
          ? "totp"
          : verifyWebAuthn
            ? "webauthn"
            : verifyTotpEnrolment
              ? "totp-enrolment"
              : "password"),
      getLogAttributesFromRequest(req as RequestLike),
    );

    const user: User = BaseModel.fromJSON(data as JSONObject, User) as User;

    if (!user.email || !user.password) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Email and password are required."),
      );
    }

    /*
     * The submitted password stays plaintext until the account is on hand:
     * its hash cannot be computed without that account's own salt, so there
     * is nothing to pre-hash and nothing to query by.
     */
    const submittedPassword: string = user.password.toString();

    const alreadySavedUser: User | null = await UserService.findOneBy({
      query: { email: user.email! },
      select: {
        _id: true,
        password: true,
        passwordSalt: true,
        name: true,
        email: true,
        isMasterAdmin: true,
        isEmailVerified: true,
        profilePictureId: true,
        timezone: true,
        enableTwoFactorAuth: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (alreadySavedUser) {
      if (!alreadySavedUser.password) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "You have not signed up so far. Please go to the registration page to sign up.",
          ),
        );
      }

      if (!alreadySavedUser.isEmailVerified) {
        await AuthenticationEmail.sendVerificationEmail(alreadySavedUser);

        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Email is not verified. We have sent you an email with the verification link. Please do not forget to check spam.",
          ),
        );
      }

      /*
       * Verified once, against this user's own salt, and reused for the
       * final gate below. Re-verifying there would repeat the legacy-hash
       * upgrade write on every login of an un-upgraded account.
       */
      const isPasswordValid: boolean =
        await UserService.verifyHashedColumnValue({
          item: alreadySavedUser,
          columnName: "password",
          plainValue: submittedPassword,
        });

      if (!isPasswordValid) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Invalid login: Email or password does not match.",
          ),
        );
      }

      if (
        alreadySavedUser.enableTwoFactorAuth &&
        !verifyTotpAuth &&
        !verifyWebAuthn &&
        !verifyTotpEnrolment
      ) {
        // If two factor auth is enabled then we will send the user to the two factor auth page.

        const { totpAuthList, webAuthnList } = await fetchTotpAuthList(
          alreadySavedUser.id!,
        );

        if (
          (!totpAuthList || totpAuthList.length === 0) &&
          (!webAuthnList || webAuthnList.length === 0)
        ) {
          /*
           * The account is required to use two factor auth and has nothing set
           * up behind that requirement -- an admin turned it on for somebody
           * who has never enrolled, or reset a lost device. This used to be a
           * dead end ("please contact your server admin"), which made the
           * requirement unusable for exactly the people it was meant for: an
           * admin could only mandate two factor auth from users who had
           * already volunteered for it.
           *
           * Now it is an enrolment. The response carries the otpauth:// URL
           * the login page draws a QR code from, and the id of the pending
           * enrolment to quote back with the first working code.
           *
           * NOTHING IS AUTHORIZED HERE. No session is created, no cookie is
           * set, and no token is returned -- the only path to finalizeUserLogin
           * for such an account runs through /verify-totp-enrolment below,
           * which will not reach it without a code that verifies. Reaching
           * this branch already required the correct password and a verified
           * email, so the QR code is shown to somebody who could enrol anyway;
           * it is not a credential.
           */
          const pendingEnrolment: UserTotpAuth =
            await getOrCreatePendingTotpEnrolment(alreadySavedUser.id!);

          // See the note on the successful-login response below.
          delete (alreadySavedUser as any).password;
          delete (alreadySavedUser as any).passwordSalt;

          return Response.sendEntityResponse(req, res, alreadySavedUser, User, {
            miscData: {
              twoFactorEnrolmentRequired: true,
              twoFactorAuthId: pendingEnrolment.id!.toString(),
              /*
               * The URL, never `twoFactorSecret`. They encode the same bytes,
               * but the URL is what a QR code has to contain, and selecting
               * the raw column would put a bare secret in a page's network tab
               * for no additional capability.
               */
              twoFactorOtpUrl: pendingEnrolment.twoFactorOtpUrl!,
            },
          });
        }

        // See the note on the successful-login response below.
        delete (alreadySavedUser as any).password;
        delete (alreadySavedUser as any).passwordSalt;

        return Response.sendEntityResponse(req, res, alreadySavedUser, User, {
          miscData: {
            totpAuthList: UserTotpAuth.toJSONArray(totpAuthList, UserTotpAuth),
            webAuthnList: UserWebAuthn.toJSONArray(webAuthnList, UserWebAuthn),
          },
        });
      }

      if (verifyTotpAuth || verifyWebAuthn || verifyTotpEnrolment) {
        if (verifyTotpAuth) {
          // code from req
          const code: string = data["code"] as string;
          const twoFactorAuthId: string = data["twoFactorAuthId"] as string;

          const totpAuth: UserTotpAuth | null =
            await UserTotpAuthService.findOneBy({
              query: {
                _id: twoFactorAuthId,
                userId: alreadySavedUser.id!,
                isVerified: true,
              },
              select: {
                _id: true,
                twoFactorSecret: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!totpAuth) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid two factor auth id."),
            );
          }

          const isVerified: boolean = TotpAuth.verifyToken({
            token: code,
            secret: totpAuth.twoFactorSecret!,
            email: alreadySavedUser.email!,
          });

          if (!isVerified) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid code."),
            );
          }
        } else if (verifyWebAuthn) {
          const credential: any = data["credential"];

          await UserWebAuthnService.verifyAuthentication({
            userId: alreadySavedUser.id!.toString(),
            credential: credential,
          });
        } else if (verifyTotpEnrolment) {
          /*
           * The second half of the enrolment branch above: the user has
           * scanned the QR code and is quoting back the first code their
           * authenticator produced. Getting here proves the password and the
           * verified email, exactly as the other two second steps do.
           *
           * Two refusals sit in front of the code check, and neither is
           * bookkeeping:
           *
           *  - if the account is NOT required to use two factor auth, this
           *    endpoint would let anybody holding the password bolt a factor
           *    of their own choosing onto somebody else's account -- turning a
           *    stolen password into a lockout of the real owner. Enrolment is
           *    only ever the completion of a requirement the server itself
           *    imposed;
           *  - if the account ALREADY has a verified factor, the correct route
           *    is /verify-totp-auth. Allowing enrolment here would mean a
           *    password alone could add a second factor and then satisfy the
           *    challenge with it, stepping around the first.
           */
          if (!alreadySavedUser.enableTwoFactorAuth) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "Two factor authentication is not required for this account.",
              ),
            );
          }

          const existingFactors: {
            totpAuthList: Array<UserTotpAuth>;
            webAuthnList: Array<UserWebAuthn>;
          } = await fetchTotpAuthList(alreadySavedUser.id!);

          if (
            existingFactors.totpAuthList.length > 0 ||
            existingFactors.webAuthnList.length > 0
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "Two factor authentication is already set up for this account.",
              ),
            );
          }

          const code: string = data["code"] as string;
          const twoFactorAuthId: string = data["twoFactorAuthId"] as string;

          /*
           * Both are proven present BEFORE they are used as query predicates.
           * TypeORM drops an `undefined` predicate rather than matching
           * nothing, and `_findBy` falls back to "newest row first", so an
           * omitted id would stop meaning "this enrolment" and start meaning
           * "whichever pending enrolment this account happens to have" -- see
           * Identity/Utils/CredentialGuard.ts.
           */
          CredentialGuard.assertAllPresent([
            { value: twoFactorAuthId, label: "Two factor auth id" },
            { value: code, label: "Code" },
          ]);

          const pendingTotpAuth: UserTotpAuth | null =
            await UserTotpAuthService.findOneBy({
              query: {
                _id: twoFactorAuthId,
                userId: alreadySavedUser.id!,
                isVerified: false,
              },
              select: {
                _id: true,
                twoFactorSecret: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!pendingTotpAuth) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid two factor auth id."),
            );
          }

          const isEnrolmentCodeVerified: boolean = TotpAuth.verifyToken({
            token: code,
            secret: pendingTotpAuth.twoFactorSecret!,
            email: alreadySavedUser.email!,
          });

          if (!isEnrolmentCodeVerified) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid code."),
            );
          }

          await UserTotpAuthService.updateOneById({
            id: pendingTotpAuth.id!,
            data: {
              isVerified: true,
            },
            props: {
              isRoot: true,
            },
          });

          /*
           * Any OTHER half-finished enrolment for this account is now dead
           * weight -- an abandoned scan from a previous attempt, still holding
           * a secret nobody uses. Sweeping them keeps a later "reset" from
           * handing the user back a stale QR code.
           */
          await UserTotpAuthService.deleteBy({
            query: {
              userId: alreadySavedUser.id!,
              isVerified: false,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });
        }
      } // Refresh Permissions for this user here.
      await AccessTokenService.refreshUserAllPermissions(alreadySavedUser.id!);

      if (isPasswordValid) {
        logger.info(
          "User logged in: " + alreadySavedUser.email?.toString(),
          getLogAttributesFromRequest(req as RequestLike),
        );

        const loginResult: FinalizeUserLoginResult = await finalizeUserLogin({
          req,
          res,
          user: alreadySavedUser,
          isGlobalLogin: true,
        });

        /*
         * sendEntityResponse serializes whatever is set on the model, with no
         * regard for read permissions, so the credential columns selected for
         * verification would otherwise be echoed back in the login response.
         */
        delete (alreadySavedUser as any).password;
        delete (alreadySavedUser as any).passwordSalt;

        return Response.sendEntityResponse(req, res, alreadySavedUser, User, {
          miscData: {
            accessToken: loginResult.accessToken,
            refreshToken: loginResult.sessionMetadata.refreshToken,
            refreshTokenExpiresAt:
              loginResult.sessionMetadata.refreshTokenExpiresAt.toISOString(),
          },
        });
      }
    }
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("Invalid login: Email or password does not match."),
    );
  } catch (err) {
    return next(err);
  }
};

export default router;
