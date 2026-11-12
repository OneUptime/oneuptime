import crypto from "crypto";
import AuthenticationEmail from "../Utils/AuthenticationEmail";
import CredentialGuard from "../Utils/CredentialGuard";
import SignupUser from "../Utils/SignupUser";
import UserResponse from "../Utils/UserResponse";
import VerificationEmailResendPolicy, {
  VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
  VERIFICATION_EMAIL_RESEND_INVALID_MESSAGE,
  VERIFICATION_EMAIL_RESEND_MAX_LINK_AGE_IN_DAYS,
  VERIFICATION_EMAIL_RESEND_WINDOW_IN_SECONDS,
  VerificationEmailResendDecision,
  VerificationEmailResendDecisionType,
} from "../Utils/VerificationEmailResendPolicy";
import VerificationEmailResendToken, {
  VerificationEmailResendTokenClaims,
} from "../Utils/VerificationEmailResendToken";
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
import DatabaseNotConnectedException from "Common/Types/Exception/DatabaseNotConnectedException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import ServiceUnavailableException from "Common/Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "Common/Types/Exception/TooManyRequestsException";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject, ObjectType } from "Common/Types/JSON";
import HashedString from "Common/Types/HashedString";
import Name from "Common/Types/Name";
import RequestOrigin from "Common/Types/RequestOrigin";
import ObjectID from "Common/Types/ObjectID";
import { getSignupPasswordValidationError } from "Common/Types/Password";
import {
  getAccountAlreadyExistsMessage,
  INCOMPLETE_RESET_LINK_MESSAGE,
  INCOMPLETE_VERIFICATION_LINK_MESSAGE,
  TWO_FACTOR_MESSAGES,
} from "Common/Types/Accounts/SignInMessages";
import MagicLink, {
  MAGIC_LINK_EXPIRY_MINUTES,
  MAGIC_LINK_INVALID_MESSAGE,
  MAGIC_LINK_LOGIN_ROUTE,
  MAGIC_LINK_TURNED_OFF_MESSAGE,
} from "Common/Types/Accounts/MagicLink";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
import {
  AppVersion,
  DisableInstanceCheckIn,
  EncryptionSecret,
  Host,
  HttpProtocol,
  IsBillingEnabled,
} from "Common/Server/EnvironmentConfig";
import API from "Common/Utils/API";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import EmailVerificationTokenService from "Common/Server/Services/EmailVerificationTokenService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import MailService from "Common/Server/Services/MailService";
import ServerSendingStatus from "Common/Server/Utils/ServerSending/ServerSendingStatus";
import {
  PASSWORD_RESET_CANNOT_BE_EMAILED_MESSAGE,
  REGISTRATION_LINK_CANNOT_BE_EMAILED_MESSAGE,
  SIGN_IN_LINK_CANNOT_BE_EMAILED_MESSAGE,
} from "Common/Types/ServerSending/ServerSendingWords";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import RequestOriginUtil from "Common/Server/Utils/RequestOrigin/RequestOriginUtil";
import SsoRequiredSignIn from "Common/Server/Utils/SsoRequiredSignIn";
import UserService from "Common/Server/Services/UserService";
import UserTotpAuthService from "Common/Server/Services/UserTotpAuthService";
import UserTwoFactorBackupCodeService from "Common/Server/Services/UserTwoFactorBackupCodeService";
import TwoFactorBackupCode from "Common/Server/Utils/TwoFactorBackupCode";
import TwoFactorBackupCodeNotification from "Common/Server/Utils/TwoFactorBackupCodeNotification";
import UserSessionService, {
  SessionMetadata,
  SessionRenewalDecision,
} from "Common/Server/Services/UserSessionService";
import SessionEndedException from "Common/Types/Exception/SessionEndedException";
import { SessionEndCause } from "Common/Types/UserSession/SessionEndCause";
import {
  SecondFactor,
  SessionSignIn,
  SignInMethod,
} from "Common/Types/UserSession/SessionSignIn";
import {
  INACTIVE_FOR_IN_SECONDS_FIELD,
  readReportedInactivityInSeconds,
  SessionEndReason,
} from "Common/Types/UserSession/SessionLength";
import CookieUtil from "Common/Server/Utils/Cookie";
import { getSessionCookieFields } from "Common/Server/Utils/SessionCookieFields";
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
import TwoFactorWrongCodes, {
  TwoFactorCodeCheck,
  TwoFactorCodeCheckOutcome,
  TwoFactorCodeKind,
} from "Common/Server/Utils/TwoFactorWrongCodes";
import UserRegistrationToken from "Common/Server/Utils/UserRegistrationToken";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import User from "Common/Models/DatabaseModels/User";
import UserSession from "Common/Models/DatabaseModels/UserSession";
import UserTotpAuth from "Common/Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "Common/Models/DatabaseModels/UserWebAuthn";
import UserWebAuthnService from "Common/Server/Services/UserWebAuthnService";
import MobilePasskeyLoginService, {
  MobilePasskeyContext,
} from "Common/Server/Services/MobilePasskeyLoginService";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import IdentityRateLimit, {
  IDENTITY_COUNTER_UNAVAILABLE_MESSAGE,
  IdentityRateLimitBucket,
  VERIFICATION_EMAIL_RESEND_UNAVAILABLE_MESSAGE,
} from "Common/Server/Middleware/IdentityRateLimit";
import PublicMessageRateLimit, {
  PublicMessageKind,
  PublicMessageSendPermit,
} from "Common/Server/Utils/RateLimit/PublicMessageRateLimit";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import { URL as NodeURL } from "url";

const router: ExpressRouter = Express.getRouter();

/*
 * The credential routes below are anonymous by definition -- they are how a
 * session is obtained -- so nothing upstream of them counts attempts. Both
 * limiters are registered as the FIRST handler on their routes, ahead of the
 * user lookup and the bcrypt verify, so a flood is refused before it costs us
 * anything. See Common/Server/Middleware/IdentityRateLimit.ts for the budgets
 * and for why these fail closed when Redis is unreachable.
 */
const loginRateLimit: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> = IdentityRateLimit.getMiddleware(
  IdentityRateLimitBucket.Login,
);

/*
 * The second step gets its own bucket, shared by all three routes that reach
 * `login()` with verifyTotpAuth, verifyWebAuthn or verifyTotpEnrolment set.
 *
 * For /verify-totp-auth it is the sharper of the two limiters: the password
 * has already been accepted by the time it is reached, so all that stands
 * between the caller and the account is a six digit code, and TotpAuth accepts
 * fourteen of the 10^6 of them at any instant.
 *
 * /verify-webauthn-auth and /verify-totp-enrolment are here for a second
 * reason that applies whatever their own factor is worth. All three re-submit
 * the email and password and run the same `verifyHashedColumnValue` before
 * they reach their factor, so each one is a password oracle in its own right
 * -- and an unlimited one is a hole in the fence, not merely an unguarded
 * route: an attacker refused at /login simply points the same guesses here.
 * Whatever bounds /login has to bound these too.
 *
 * It counts per client. The ACCOUNT is held by the handler, which counts the
 * account's wrong codes itself once the password is right
 * (TwoFactorWrongCodes in `login()` below), wherever the codes come from.
 */
const twoFactorRateLimit: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> = IdentityRateLimit.getMiddleware(
  IdentityRateLimitBucket.TwoFactor,
);

/*
 * /verify-backup-code gets a counter of its own rather than sharing the one
 * above, and the reason is who arrives at it.
 *
 * Every single caller of this route has already failed at the factor the other
 * three routes serve -- that is what the route is FOR. On a shared counter the
 * user whose authenticator app is showing codes from a drifted clock would
 * spend the whole budget proving that, and then be told "too many attempts" by
 * the one route that could still have let them in. The recovery path must not
 * be spendable by failures on the path it recovers from.
 *
 * It is still bounded, because it re-verifies the email and password ahead of
 * the code exactly as its siblings do and is therefore a password oracle in
 * its own right. What it is NOT bounded for is the codes: ten characters over
 * a 32 symbol alphabet is 2^50, so the limiter is a backstop there rather than
 * the control.
 */
const backupCodeRateLimit: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> = IdentityRateLimit.getMiddleware(
  IdentityRateLimitBucket.BackupCode,
);

/*
 * /resend-verification-email is on this list for a different reason from the
 * routes above. It is not a guessing oracle -- the credentials it takes are a
 * signed token the server minted, or a random link token from an email -- but
 * every request that gets past its checks sends an email, and it is anonymous.
 * Its own bucket, sized on the client address alone because the body carries no
 * email address; the per-account bounds on how much mail one inbox receives
 * live in the route itself (VerificationEmailResendPolicy). See
 * VERIFICATION_EMAIL_RESEND_BUCKET in IdentityRateLimit.ts.
 */
const verificationEmailResendRateLimit: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> = IdentityRateLimit.getMiddleware(
  IdentityRateLimitBucket.VerificationEmailResend,
);

interface FinalizeUserLoginResult {
  sessionMetadata: SessionMetadata;
  accessToken: string;
}

type FinalizeUserLoginInput = {
  req: ExpressRequest;
  res: ExpressResponse;
  user: User;
  isGlobalLogin: boolean;
  // How they signed in, for the audit log's sign-in entry (SessionSignIn).
  signIn: SessionSignIn;
  setCookie?: boolean;
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
      signIn: data.signIn,
      requestOrigin: RequestOriginUtil.fromRequest(req),
    });

  if (data.setCookie !== false) {
    CookieUtil.setUserCookie({
      expressResponse: res,
      user,
      isGlobalLogin,
      ...getSessionCookieFields(sessionMetadata),
    });
  }

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
      signedInAt: sessionMetadata.signedInAt,
      lastActiveAt: sessionMetadata.lastActiveAt,
    },
    expiresInSeconds: sessionMetadata.accessTokenExpiresInSeconds,
  });

  return { sessionMetadata, accessToken };
};

const PASSKEY_LOGIN_COOKIE: string = "oneuptime-passkey-login";
const passkeyRateLimit: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> = IdentityRateLimit.getMiddleware(
  IdentityRateLimitBucket.Passkey,
);
const PASSKEY_LOGIN_ERROR: string =
  "Unable to sign in with this passkey. Please try again or use your password.";

/*
 * Bind the anonymous challenge to the browser that started this sign-in.
 * A challenge ID supplied in the request body must never replace this cookie.
 */
const assertPasskeyOrigin: (req: ExpressRequest) => void = (
  req: ExpressRequest,
): void => {
  if (
    req.headers.origin !==
    new NodeURL(`${HttpProtocol}${Host.toString()}`).origin
  ) {
    throw new BadDataException(PASSKEY_LOGIN_ERROR);
  }
};

router.post(
  "/passkey-login-options",
  passkeyRateLimit,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      assertPasskeyOrigin(req);
      const mobileContext: MobilePasskeyContext | null =
        req.body?.mobileAuth === undefined
          ? null
          : MobilePasskeyLoginService.validateRequest(req.body.mobileAuth);
      const result: Awaited<
        ReturnType<
          typeof UserWebAuthnService.generatePasskeyAuthenticationOptions
        >
      > = await UserWebAuthnService.generatePasskeyAuthenticationOptions();

      if (mobileContext) {
        await MobilePasskeyLoginService.storeChallengeContext(
          result.challengeId,
          mobileContext,
        );
      }

      CookieUtil.setCookie(
        res,
        PASSKEY_LOGIN_COOKIE,
        mobileContext ? `mobile.${result.challengeId}` : result.challengeId,
        {
          httpOnly: true,
          sameSite: "strict",
          path: "/",
          maxAge: 5 * 60 * 1000,
        },
      );

      /*
       * Discoverable credentials let the authenticator select the account.
       * Options do not disclose whether any particular email has an account.
       */
      return Response.sendJsonObjectResponse(req, res, {
        options: result.options as unknown as JSONObject,
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/passkey-login",
  passkeyRateLimit,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      assertPasskeyOrigin(req);
      const challengeCookie: unknown = req.cookies?.[PASSKEY_LOGIN_COOKIE];
      const isMobileLogin: boolean =
        typeof challengeCookie === "string" &&
        challengeCookie.startsWith("mobile.");
      const challengeId: unknown = isMobileLogin
        ? (challengeCookie as string).slice("mobile.".length)
        : challengeCookie;
      CookieUtil.removeCookie(res, PASSKEY_LOGIN_COOKIE, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
      });

      if (
        typeof challengeId !== "string" ||
        !challengeId.match(/^[A-Za-z0-9_-]{32,128}$/)
      ) {
        throw new BadDataException(PASSKEY_LOGIN_ERROR);
      }

      let verifiedUser: User;
      try {
        verifiedUser = await UserWebAuthnService.verifyPasskeyAuthentication({
          challengeId,
          credential: req.body?.credential,
        });
      } catch {
        // Do not expose credential ownership or verification internals.
        throw new BadDataException(PASSKEY_LOGIN_ERROR);
      }

      if (!verifiedUser.id) {
        throw new BadDataException(PASSKEY_LOGIN_ERROR);
      }

      const mobileContext: MobilePasskeyContext | null =
        await MobilePasskeyLoginService.consumeChallengeContext(challengeId);
      if (isMobileLogin !== Boolean(mobileContext)) {
        throw new BadDataException(PASSKEY_LOGIN_ERROR);
      }

      const user: User | null = await UserService.findOneById({
        id: verifiedUser.id,
        select: {
          _id: true,
          name: true,
          email: true,
          isMasterAdmin: true,
          isEmailVerified: true,
          isBlocked: true,
          profilePictureId: true,
          timezone: true,
        },
        props: { isRoot: true },
      });

      if (!user?.id || !user.email || !user.isEmailVerified || user.isBlocked) {
        throw new BadDataException(PASSKEY_LOGIN_ERROR);
      }

      /*
       * A passkey is not single sign-on: while the whole server requires
       * SSO, only a master admin signs in with one (SsoRequiredSignIn).
       * After the passkey is verified, so only its holder is told why, and
       * before a mobile sign-in is handed its code.
       */
      await SsoRequiredSignIn.assertNonSsoSignInAllowed(user);

      if (mobileContext) {
        const callbackUrl: string =
          await MobilePasskeyLoginService.createAuthorizationCode({
            userId: user.id,
            context: mobileContext,
          });
        Response.setNoCacheHeaders(res);
        return Response.sendJsonObjectResponse(req, res, {
          mobileAuth: { callbackUrl },
        });
      }

      /*
       * Verified passkeys prove possession and device PIN/biometrics together.
       * Project and global SSO requirements still apply to this ordinary login
       * through UserAuthorization, just as they do after a password login.
       */
      await AccessTokenService.refreshUserAllPermissions(user.id);
      const loginResult: FinalizeUserLoginResult = await finalizeUserLogin({
        req,
        res,
        user,
        isGlobalLogin: true,
        signIn: { method: SignInMethod.Passkey },
      });

      logger.info(
        "User logged in with a passkey: " + user.email.toString(),
        getLogAttributesFromRequest(req as RequestLike),
      );

      return Response.sendEntityResponse(
        req,
        res,
        UserResponse.toResponseUser(user),
        User,
        {
          miscData: {
            accessToken: loginResult.accessToken,
            refreshToken: loginResult.sessionMetadata.refreshToken,
            refreshTokenExpiresAt:
              loginResult.sessionMetadata.refreshTokenExpiresAt.toISOString(),
          },
        },
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/mobile-passkey-exchange",
  passkeyRateLimit,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    Response.setNoCacheHeaders(res);
    try {
      // Native clients have no Origin header. A browser must remain same-origin.
      if (req.headers.origin !== undefined) {
        assertPasskeyOrigin(req);
      }
      const userId: ObjectID =
        await MobilePasskeyLoginService.exchangeAuthorizationCode(req.body);
      const user: User | null = await UserService.findOneById({
        id: userId,
        select: {
          _id: true,
          name: true,
          email: true,
          isMasterAdmin: true,
          isEmailVerified: true,
          isBlocked: true,
          profilePictureId: true,
          timezone: true,
        },
        props: { isRoot: true },
      });

      // The account may have been removed or disabled after the browser step.
      if (!user?.id || !user.email || !user.isEmailVerified || user.isBlocked) {
        throw new BadDataException(PASSKEY_LOGIN_ERROR);
      }

      // Or the server may have come to require SSO since (SsoRequiredSignIn).
      await SsoRequiredSignIn.assertNonSsoSignInAllowed(user);
      await AccessTokenService.refreshUserAllPermissions(user.id);
      const loginResult: FinalizeUserLoginResult = await finalizeUserLogin({
        req,
        res,
        user,
        isGlobalLogin: true,
        signIn: { method: SignInMethod.Passkey },
        setCookie: false,
      });
      logger.info(
        "User logged in to the mobile app with a passkey: " +
          user.email.toString(),
        getLogAttributesFromRequest(req as RequestLike),
      );
      return Response.sendEntityResponse(
        req,
        res,
        UserResponse.toResponseUser(user),
        User,
        {
          miscData: {
            accessToken: loginResult.accessToken,
            refreshToken: loginResult.sessionMetadata.refreshToken,
            refreshTokenExpiresAt:
              loginResult.sessionMetadata.refreshTokenExpiresAt.toISOString(),
          },
        },
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/signup",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      /*
       * While the whole server requires single sign-on, an account is made
       * by signing in with SSO, or by an invitation - never with a password
       * it could not sign in with (SsoRequiredSignIn). Claiming an invited
       * account included: the invited person signs in with SSO instead.
       */
      await SsoRequiredSignIn.assertSignUpAllowed();

      if (await DatabaseConfig.shouldDisableSignup()) {
        /*
         * Check if this user has been invited to a project.
         * If so, allow them to sign up even if signup is disabled.
         */
        const data: JSONObject = req.body?.["data"] as JSONObject;
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
        (req.body?.["miscDataProps"] as JSONObject) || {};

      await CaptchaUtil.verifyCaptcha({
        token:
          (miscDataProps["captchaToken"] as string | undefined) ||
          (req.body?.["captchaToken"] as string | undefined),
        remoteIp: getClientIp(req) || null,
      });

      const data: JSONObject = req.body?.["data"];
      const suppliedPassword: unknown = data?.["password"];

      /*
       * Model forms send a HashedString envelope; direct clients may send text.
       * Validate the raw value before deserialization or spending an invitation.
       */
      const password: unknown =
        suppliedPassword &&
        typeof suppliedPassword === "object" &&
        !Array.isArray(suppliedPassword) &&
        (suppliedPassword as JSONObject)["_type"] === ObjectType.HashedString
          ? (suppliedPassword as JSONObject)["value"]
          : suppliedPassword;
      const passwordValidationError: string | null =
        getSignupPasswordValidationError(password);

      if (passwordValidationError) {
        throw new BadDataException(passwordValidationError);
      }

      /*
       * Only the columns a signup may set. The create below runs as root,
       * which skips column create permissions, so anything else in the body --
       * an `_id` naming somebody else's account above all -- would be written
       * verbatim. See SignupUser.
       */
      const partialUser: User = SignupUser.fromRequestData(data);
      partialUser.password = new HashedString(password as string);

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
          isBlocked: true,
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
            getAccountAlreadyExistsMessage(
              partialUser.email?.toString() || "this email address",
            ),
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
           * handler, where it is on, and the limits on the emails a sign-up
           * sends (PublicMessageRateLimit: per caller and per address) are
           * what stop this branch from being a mail cannon.
           *
           * A server with no email set up cannot send that link: the person
           * is told to ask whoever invited them for theirs, which a master
           * admin can copy (TeamMemberAPI's invitation-link), rather than to
           * wait for an email. This branch already answers differently from
           * a new sign-up, so it says nothing more about the address.
           */
          if (await ServerSendingStatus.isEmailKnownNotSetUp()) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(REGISTRATION_LINK_CANNOT_BE_EMAILED_MESSAGE),
            );
          }

          await PublicMessageRateLimit.assertMaySend({
            req: req,
            kind: PublicMessageKind.SignUpEmail,
            contacts: [PublicMessageRateLimit.forEmail(partialUser.email!)],
          });

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

        /*
         * An invited account can be blocked before anybody claims it, and a
         * claim ends in a session like any other sign-in. Refused only after
         * the token has proved the mailbox, so the block is not disclosed to
         * whoever typed the address.
         */
        if (alreadySavedUser.isBlocked) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(ExceptionMessages.UserBlocked),
          );
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
        /*
         * A new account is sent its welcome email below. Counted first, per
         * caller and per address (PublicMessageRateLimit), so nothing is
         * created for a sign-up that is refused.
         */
        const permit: PublicMessageSendPermit =
          await PublicMessageRateLimit.assertMaySend({
            req: req,
            kind: PublicMessageKind.SignUpEmail,
            contacts: [PublicMessageRateLimit.forEmail(partialUser.email!)],
          });

        const user: User = partialUser;

        try {
          savedUser = await UserService.createUserOnSignup({
            user: user,
            props: {
              isRoot: true,
            },
          });
        } catch (err) {
          /*
           * No account, so no welcome email: the address gets its count
           * back, and only emails sent count against it. The caller's own
           * count stays spent.
           */
          await permit.giveBack();
          throw err;
        }
      }

      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      /*
       * A brand-new account on the hosted service (billing on) starts with an
       * unverified address, and it gets NO session until the link in the
       * welcome email is followed. Signing it in here would make the
       * verification mail a formality: the session this handler mints is a
       * full-privilege JWT that UserAuthorization validates statelessly, so a
       * "please verify" gate drawn anywhere after this point is decoration --
       * the same cookie answers curl. /login already refuses an unverified
       * address, so the only thing standing between a typed-in address and the
       * dashboard was this handler.
       *
       * Two signups are exempt, because each has already proved the mailbox:
       * self-hosted installs (billing off), which mark every address verified
       * because many of them have no working SMTP to prove anything with, and
       * a claimed invitation, which spent a token that only ever travelled
       * inside an email.
       */
      const isEmailVerificationRequired: boolean =
        !didClaimInvitedAccount && !partialUser.isEmailVerified;

      /*
       * The token behind the welcome email's link, kept for the one test-only
       * seam below.
       */
      let welcomeEmailVerificationToken: ObjectID | null = null;

      /*
       * Skipped when this signup claimed an invitation: the registration token
       * it spent was itself an emailed secret, so the address is already
       * verified and a "please verify your email" mail would be asking for a
       * proof that has just been given.
       */
      if (!didClaimInvitedAccount) {
        const generatedToken: ObjectID = ObjectID.generate();
        welcomeEmailVerificationToken = generatedToken;

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
          subject: `Welcome to ${ProductBrandingText.getProductName()}. Please verify your email.`,
          isSubjectLiteral: true,
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

      if (savedUser && isEmailVerificationRequired) {
        logger.info(
          "User signed up, awaiting email verification: " +
            savedUser.email?.toString(),
          getLogAttributesFromRequest(req as RequestLike),
        );

        /*
         * What lets the "check your inbox" page offer a resend button without
         * a session: a signed claim that this request created this account
         * for this address. It is not the verification token and proves
         * nothing about the mailbox -- it can only ask for the verification
         * mail to be sent again, to the address stored on the account, under
         * the caps in /resend-verification-email. Minted after the welcome
         * token row is written, so that row is not counted as one of the
         * resends the credential buys (Postgres stamps the row's createdAt and
         * this process stamps the token, so that holds as far as their clocks
         * agree). Null -- no button; signing in still mails a link -- if it
         * cannot be minted.
         */
        const resendToken: string | null =
          VerificationEmailResendToken.generate({
            userId: savedUser.id!,
            email: partialUser.email as Email,
          });

        /*
         * No entity in the body: nobody is signed in, so there is nobody to
         * describe, and the page already knows the address it just typed.
         */
        return Response.sendEntityResponse(req, res, null, User, {
          miscData: {
            emailVerificationRequired: true,

            ...(resendToken
              ? {
                  verificationEmailResendToken: resendToken,
                  verificationEmailResendAvailableInSeconds:
                    VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
                }
              : {}),

            /*
             * TEST-ONLY seam, OFF unless explicitly switched on -- the same
             * flag, and the same reasoning, as the one in UserEmailService.
             * The CI end-to-end stack has no mailbox to read the welcome email
             * from, so it is handed the token here and follows the link the
             * way a user would. The flag is unset in every shipped config;
             * with it absent the token only ever travels inside the email,
             * which is the entire point of the email.
             */
            ...(process.env[
              "EXPOSE_VERIFICATION_CODE_IN_API_RESPONSE_FOR_E2E"
            ] === "true" && welcomeEmailVerificationToken
              ? {
                  emailVerificationToken:
                    welcomeEmailVerificationToken.toString(),
                }
              : {}),
          },
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
          signIn: { method: SignInMethod.Password },
        });

        logger.info(
          "User signed up: " + savedUser.email?.toString(),
          getLogAttributesFromRequest(req as RequestLike),
        );

        /*
         * Release emails tell oneuptime.com about this install and the person
         * signing up. An operator who turned off the daily check-in has said
         * this install does not report to oneuptime.com, so the form no longer
         * offers the box (Register.tsx) and nothing is sent, whatever a
         * request carries.
         */
        if (
          !IsBillingEnabled &&
          !DisableInstanceCheckIn &&
          miscDataProps["notifySelfHosted"] === true
        ) {
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

        /*
         * Never `savedUser` itself. On a fresh account it is the very model
         * `create` hashed the password into and minted the salt onto, and it
         * carries every other column the request body set. See UserResponse.
         */
        return Response.sendEntityResponse(
          req,
          res,
          UserResponse.toResponseUser(savedUser),
          User,
        );
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException(
          "Your account was not created. Try again in a moment.",
        ),
      );
    } catch (err) {
      // A sign-up refused for its rate limits says when to come back.
      PublicMessageRateLimit.setRetryAfterFor(res, err);
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

      /*
       * A server with no email set up cannot send the link, so nobody is
       * told it was sent: they are told who can let them in instead. Asked
       * before the address is looked up, so every address gets the same
       * answer - a fact about the server, never about an account. The
       * Forgot password page says the same before anyone types
       * (GET /global-config/vars' canSendEmail).
       */
      if (await ServerSendingStatus.isEmailKnownNotSetUp()) {
        throw new BadDataException(PASSWORD_RESET_CANNOT_BE_EMAILED_MESSAGE);
      }

      const alreadySavedUser: User | null = await UserService.findOneBy({
        query: { email: user.email! },
        select: {
          _id: true,
          password: true,
          name: true,
          email: true,
          isMasterAdmin: true,
          timezone: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (alreadySavedUser && alreadySavedUser.password) {
        /*
         * Each request emails the address a reset link, so it is counted
         * first, per caller and per address (PublicMessageRateLimit), and
         * refused when either has had enough - before the token is replaced,
         * so the link in the latest email still works.
         */
        await PublicMessageRateLimit.assertMaySend({
          req: req,
          kind: PublicMessageKind.PasswordReset,
          contacts: [PublicMessageRateLimit.forEmail(user.email!)],
        });

        // A bearer secret: from the CSPRNG, never ObjectID's non-crypto fallback.
        const token: string = crypto.randomUUID();
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
          subject: `Password Reset Request for ${ProductBrandingText.getProductName()}`,
          isSubjectLiteral: true,
          templateType: EmailTemplateType.ForgotPassword,
          vars: {
            homeURL: new URL(httpProtocol, host).toString(),
            tokenVerifyUrl: tokenVerifyUrl,
            /*
             * When, from where and on which device the reset was asked for,
             * in the owner's own time zone. Anybody who knows the address can
             * ask, so this is how its owner tells their own request from a
             * stranger's (RequestOriginUtil).
             */
            ...RequestOriginUtil.getEmailVars({
              origin: RequestOriginUtil.fromRequest(req),
              timezone: alreadySavedUser.timezone,
            }),
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
      // A reset refused for its rate limits says when to come back.
      PublicMessageRateLimit.setRetryAfterFor(res, err);
      return next(err);
    }
  },
);

/*
 * POST /send-magic-link -- email an account a sign-in link (Types/Accounts/
 * MagicLink), so its owner can sign in without typing their password.
 *
 * The answer is the same whether or not the address has an account a link
 * could sign in, so asking says nothing about who has one. For the same
 * reason the request is counted per caller and per address
 * (PublicMessageRateLimit) before the address is looked up, whether or not
 * it matches, and the link's token is minted and hashed before the lookup
 * too.
 *
 * A link goes only to an account a link could sign in now: one that has
 * finished signing up (an invitation nobody has claimed has no password for
 * a link to stand in for - it signs up through its invitation), that is not
 * blocked, and that may sign in without single sign-on (SsoRequiredSignIn:
 * while the server requires SSO, only a master admin may). Each is asked
 * again when the link is used - any can change in the minutes it works -
 * but nobody is mailed a link for a sign-in that cannot happen. An address
 * nobody has verified is sent one: following it proves the mailbox, which
 * verifies the address.
 *
 * The captcha, where it is on, is asked first, as on /login: this route
 * mails an address its caller names. While a master admin has turned
 * sign-in links off, it says so to anyone - that is a setting of the
 * server, which the sign-in page already reads, not of an account.
 */
router.post(
  "/send-magic-link",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const miscDataProps: JSONObject =
        (req.body?.["miscDataProps"] as JSONObject) || {};

      await CaptchaUtil.verifyCaptcha({
        token:
          (miscDataProps["captchaToken"] as string | undefined) ||
          (req.body?.["captchaToken"] as string | undefined),
        remoteIp: getClientIp(req) || null,
      });

      const data: JSONObject = (req.body?.["data"] as JSONObject) || {};

      const user: User = BaseModel.fromJSON(data, User) as User;

      /*
       * A missing email would drop the predicate below and select the newest
       * user in the instance - mailing a link to somebody nobody named.
       */
      CredentialGuard.assertPresent(user.email, "Email");

      if (await GlobalConfigService.getMagicLinkLoginTurnedOff()) {
        throw new BadDataException(MAGIC_LINK_TURNED_OFF_MESSAGE);
      }

      /*
       * No email set up: no link can go, so nobody is told to check their
       * inbox. The same for every address, asked before any is looked up.
       */
      if (await ServerSendingStatus.isEmailKnownNotSetUp()) {
        throw new BadDataException(SIGN_IN_LINK_CANNOT_BE_EMAILED_MESSAGE);
      }

      await PublicMessageRateLimit.assertMaySend({
        req: req,
        kind: PublicMessageKind.MagicLink,
        contacts: [PublicMessageRateLimit.forEmail(user.email!)],
      });

      // A bearer secret: from the CSPRNG, never ObjectID's non-crypto fallback.
      const token: string = crypto.randomUUID();
      const hashedToken: string = await HashedString.hashValue(
        token,
        EncryptionSecret,
      );

      const account: User | null = await UserService.findOneBy({
        query: { email: user.email! },
        select: {
          _id: true,
          email: true,
          password: true,
          isBlocked: true,
          isMasterAdmin: true,
          timezone: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (
        account?.id &&
        account.email &&
        account.password &&
        !account.isBlocked &&
        !(await SsoRequiredSignIn.isNonSsoSignInRefused(account))
      ) {
        // Replaces the last link this account was sent: only the newest works.
        await UserService.updateOneBy({
          query: {
            _id: account._id!,
          },
          data: {
            magicLinkToken: hashedToken,
            magicLinkExpires: OneUptimeDate.getSomeMinutesAfter(
              MAGIC_LINK_EXPIRY_MINUTES,
            ),
          },
          props: {
            isRoot: true,
          },
        });

        const host: Hostname = await DatabaseConfig.getHost();
        const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

        /*
         * The link embeds the token, which signs the account in until it is
         * spent -- so it is not logged, only mailed.
         */
        logger.debug(
          "Sign-in link sent: " + account.email.toString(),
          getLogAttributesFromRequest(req as RequestLike),
        );

        MailService.sendMail({
          toEmail: account.email,
          subject: `Sign in to ${ProductBrandingText.getProductName()}`,
          isSubjectLiteral: true,
          templateType: EmailTemplateType.MagicLink,
          vars: {
            homeURL: new URL(httpProtocol, host).toString(),
            tokenVerifyUrl: new URL(
              httpProtocol,
              host,
              new Route(AccountsRoute.toString()).addRoute(
                `/${MAGIC_LINK_LOGIN_ROUTE}/${token}`,
              ),
            ).toString(),
            expiresInMinutes: MAGIC_LINK_EXPIRY_MINUTES.toString(),
            /*
             * When, from where and on which device the link was asked for, in
             * the owner's own time zone. Anybody who knows the address can
             * ask, so this is how its owner tells their own request from a
             * stranger's (RequestOriginUtil).
             */
            ...RequestOriginUtil.getEmailVars({
              origin: RequestOriginUtil.fromRequest(req),
              timezone: account.timezone,
            }),
          },
        }).catch((err: Error) => {
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
      CredentialGuard.assertPresent(
        token.token,
        "Verification token",
        INCOMPLETE_VERIFICATION_LINK_MESSAGE,
      );

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
        isSubjectLiteral: true,
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

/*
 * POST /resend-verification-email -- mail an unverified account a fresh
 * verification link, without signing in.
 *
 * WHY IT DEMANDS A CREDENTIAL INSTEAD OF AN ADDRESS
 *
 * "Type your email and we will send the link again" is the button login()
 * deliberately stopped being (see the comment above its isEmailVerified check):
 * anyone who knew an address could press it to fill the owner's inbox, and the
 * reply told them the account existed and was unverified. So this route never
 * takes an address. It takes exactly one of two credentials, each of which
 * only somebody already entitled to the mail can hold:
 *
 *  - `resendToken`: the signed VerificationEmailResendToken that /signup hands
 *    to the request that created the account. It proves the holder is the
 *    browser that made the account (and solved the signup captcha to do it),
 *    and names the address they typed. It proves nothing about the mailbox,
 *    and does not need to: it can only cause mail to that mailbox.
 *
 *  - `verificationToken`: the token from a verification link that was emailed
 *    to the account -- typically one that has expired by the time it is
 *    clicked. It proves the holder was sent (or shown) that email. Rows of
 *    EVERY purpose in that table are accepted -- the welcome mail, a sign-in
 *    resend, an email change, an invitation, an SSO confirmation -- and so are
 *    expired ones, up to VERIFICATION_EMAIL_RESEND_MAX_LINK_AGE_IN_DAYS. That
 *    is safe because of where the mail goes: only ever to the address STORED
 *    on the account, and only when that address still equals the one the
 *    token was minted for. A token for somebody else's address, or for an
 *    address the account has since moved away from, sends nothing.
 *
 * Neither credential signs anybody in or verifies anything. The only thing
 * either can do is cause AuthenticationEmail.sendVerificationEmail(user) to run
 * for the account it names, and the link in that mail is what proves the
 * mailbox, exactly as it does for a sign-in attempt.
 *
 * HOW MUCH MAIL A CREDENTIAL BUYS
 *
 * VerificationEmailResendPolicy caps it three ways, over EVERY
 * verification-table row for the account whichever flow wrote it: a cooldown
 * between sends, a cap per hour, and a cap per credential -- at most
 * VERIFICATION_EMAIL_RESENDS_PER_CREDENTIAL_LIMIT sends after the credential
 * was issued, after which it stops working. For the signup credential that
 * bounds one solved captcha to 1 + 3 mails in total: the welcome mail and
 * three resends. A verification link from one of those mails is itself a
 * credential, but only the mailbox owner can hold it, and the cooldown and
 * hourly cap still apply to everything they do with it.
 *
 * A Redis fence (VERIFICATION_EMAIL_RESEND_FENCE_NAMESPACE, keyed by user id)
 * claims the send atomically, so two concurrent requests cannot both pass the
 * policy's read and both mail. It is read FIRST, before the policy's query, so
 * a caller who keeps pressing during a cooldown costs a Redis GET rather than a
 * Postgres scan. Like the limiter in front of it, it fails closed: with Redis
 * unreachable this answers 503 rather than sending without a fence.
 *
 * ONE REFUSAL FOR EVERYTHING
 *
 * A missing or doubled credential, a forged, expired or spent resend token, a
 * malformed or unknown link token, a link older than the age cap, a user who
 * does not exist, has no password yet (an unclaimed invitation) or whose
 * address no longer matches -- all get
 * VERIFICATION_EMAIL_RESEND_INVALID_MESSAGE, which points at signing in. A
 * route that named the reason would be an oracle for which tokens and
 * accounts exist. The two answers that do differ -- blocked, and already
 * verified -- are only reachable with a credential that matches the account.
 *
 * NEVER A TOKEN IN THE REPLY
 *
 * The reply says whether mail was sent and when another may be asked for,
 * nothing else. In particular it never carries the new verification token,
 * even with EXPOSE_VERIFICATION_CODE_IN_API_RESPONSE_FOR_E2E=true: /signup's
 * test-only seam exists because the end-to-end stack has no other way to
 * finish a signup, and nothing here needs one. Handing the link to whoever
 * asked for it would let them verify an address by reading the response.
 *
 * KNOWN LIMITATIONS
 *
 *  - /login (and the SSO paths) still send verification mail without this
 *    policy. They are bounded by their own limiter and by needing the
 *    password (or an identity provider's assertion) first -- and /login's by
 *    the limit on the emails a sign-up sends to one address
 *    (PublicMessageRateLimit) -- but mail they send is not refused by the
 *    cooldown here -- it only counts toward it.
 *
 *  - Rows created by other flows (invitations, SSO confirmations, email
 *    changes) count toward the cooldown and the hourly cap, so a user who has
 *    just been sent one of those may be asked to wait before a resend. That
 *    is the conservative direction.
 *
 *  - EmailVerificationToken.userId is not indexed. The fence read keeps
 *    repeated requests during a cooldown off Postgres, and the per-address
 *    limiter bounds how many requests reach the query at all.
 */
const VERIFICATION_EMAIL_RESEND_FENCE_NAMESPACE: string =
  "identity-verification-email-resend";

// The claimed-at half of a fence value, "<claimedAtEpochMs>:<uuid>".
const VERIFICATION_EMAIL_RESEND_FENCE_CLAIMED_AT_PATTERN: RegExp = /^\d{1,16}$/;

/*
 * How many send times the policy is shown. Far more than any cap it applies
 * (three per credential, five per hour), and newest first, so the rows it is
 * not shown can never change its answer.
 */
const VERIFICATION_EMAIL_RESEND_HISTORY_LIMIT: number = 100;

const MILLISECONDS_IN_DAY: number = 24 * 60 * 60 * 1000;

interface VerificationEmailResendReply {
  emailSent: boolean;
  alreadyVerified: boolean;
  retryAfterSeconds: number;
}

const sendVerificationEmailResendReply: (
  req: ExpressRequest,
  res: ExpressResponse,
  reply: VerificationEmailResendReply,
) => void = (
  req: ExpressRequest,
  res: ExpressResponse,
  reply: VerificationEmailResendReply,
): void => {
  return Response.sendJsonObjectResponse(req, res, {
    emailSent: reply.emailSent,
    alreadyVerified: reply.alreadyVerified,
    retryAfterSeconds: reply.retryAfterSeconds,
  });
};

const invalidVerificationEmailResendRequest: () => BadDataException =
  (): BadDataException => {
    return new BadDataException(VERIFICATION_EMAIL_RESEND_INVALID_MESSAGE);
  };

const toValidDateOrNull: (value: unknown) => Date | null = (
  value: unknown,
): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsedDate: Date = new Date(value);

    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  return null;
};

/*
 * The claimed-at time of a fence value, or null if there is no fence or it
 * cannot be read. An unreadable fence is not treated as absent by the caller:
 * the atomic claim further down still fails on it.
 */
const readVerificationEmailResendFenceClaimedAtMs: (
  fenceValue: string | null,
) => number | null = (fenceValue: string | null): number | null => {
  if (!fenceValue) {
    return null;
  }

  const claimedAtText: string = fenceValue.split(":")[0] || "";

  if (!VERIFICATION_EMAIL_RESEND_FENCE_CLAIMED_AT_PATTERN.test(claimedAtText)) {
    return null;
  }

  const claimedAtMs: number = parseInt(claimedAtText, 10);

  return Number.isSafeInteger(claimedAtMs) ? claimedAtMs : null;
};

/*
 * Runs a fence operation, turning "Redis is down" into the same 503 the
 * limiter answers with. Fails closed: the fence is what makes the policy's
 * read-then-send atomic, so without it this route would be sending on a
 * check that a concurrent request can race.
 */
const runVerificationEmailResendFenceOperation: <T>(
  operation: () => Promise<T>,
) => Promise<T> = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (err) {
    if (err instanceof DatabaseNotConnectedException) {
      throw new ServiceUnavailableException(
        VERIFICATION_EMAIL_RESEND_UNAVAILABLE_MESSAGE,
      );
    }

    throw err;
  }
};

router.post(
  "/resend-verification-email",
  verificationEmailResendRateLimit,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const now: Date = OneUptimeDate.getCurrentDate();

      const body: unknown = req.body;
      const data: unknown =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as JSONObject)["data"]
          : undefined;

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw invalidVerificationEmailResendRequest();
      }

      const suppliedResendToken: unknown = (data as JSONObject)["resendToken"];
      const suppliedVerificationToken: unknown = (data as JSONObject)[
        "verificationToken"
      ];

      const hasResendToken: boolean =
        typeof suppliedResendToken === "string" &&
        suppliedResendToken.length > 0;
      const hasVerificationToken: boolean =
        typeof suppliedVerificationToken === "string" &&
        suppliedVerificationToken.length > 0;

      // Exactly one. Neither, or both, is not a request this route serves.
      if (hasResendToken === hasVerificationToken) {
        throw invalidVerificationEmailResendRequest();
      }

      let credentialUserId: ObjectID;
      let credentialEmail: Email;
      let credentialIssuedAt: Date;

      if (hasResendToken) {
        // Signature, shape and expiry. Never throws; anything wrong is null.
        const claims: VerificationEmailResendTokenClaims | null =
          VerificationEmailResendToken.verify(suppliedResendToken, now);

        if (!claims) {
          throw invalidVerificationEmailResendRequest();
        }

        credentialUserId = claims.userId;
        credentialEmail = claims.email;
        credentialIssuedAt = claims.issuedAt;
      } else {
        const verificationToken: string = suppliedVerificationToken as string;

        // Checked before any query, so a malformed token costs nothing.
        if (!ObjectID.isValidUUID(verificationToken)) {
          throw invalidVerificationEmailResendRequest();
        }

        const tokenRow: EmailVerificationToken | null =
          await EmailVerificationTokenService.findOneBy({
            query: { token: new ObjectID(verificationToken) },
            select: {
              _id: true,
              userId: true,
              email: true,
              createdAt: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (!tokenRow) {
          throw invalidVerificationEmailResendRequest();
        }

        /*
         * The same defence as CredentialGuard: a row with no userId would
         * turn the user lookup below into a query with its predicate dropped,
         * which TypeORM answers with somebody else's account.
         */
        if (
          !CredentialGuard.isPresent(tokenRow.userId) ||
          !CredentialGuard.isPresent(tokenRow.email)
        ) {
          throw invalidVerificationEmailResendRequest();
        }

        const tokenCreatedAt: Date | null = toValidDateOrNull(
          tokenRow.createdAt,
        );

        /*
         * Expired links are the whole point of this path, but not forever: a
         * link older than the age cap is refused, so a mail that sat in an
         * archive for months is not a standing way to generate more mail.
         */
        if (
          !tokenCreatedAt ||
          now.getTime() - tokenCreatedAt.getTime() >
            VERIFICATION_EMAIL_RESEND_MAX_LINK_AGE_IN_DAYS * MILLISECONDS_IN_DAY
        ) {
          throw invalidVerificationEmailResendRequest();
        }

        credentialUserId = tokenRow.userId!;
        credentialEmail = tokenRow.email!;
        credentialIssuedAt = tokenCreatedAt;
      }

      /*
       * `password` is selected only to tell a registered account from an
       * unclaimed invitation. It is never logged or returned.
       */
      const user: User | null = await UserService.findOneBy({
        query: { _id: credentialUserId },
        select: {
          _id: true,
          email: true,
          name: true,
          isEmailVerified: true,
          isBlocked: true,
          password: true,
        },
        props: {
          isRoot: true,
        },
      });

      /*
       * No password means an invitation nobody has claimed: that account's
       * way in is the registration link, not a verification mail. A stored
       * address that differs from the credential's means the credential was
       * minted for an address this account no longer uses, and mailing the
       * current one on its strength would be mailing somebody it never named.
       */
      if (
        !user ||
        !user.id ||
        !CredentialGuard.isPresent(user.password) ||
        !user.email ||
        user.email.toString() !== credentialEmail.toString()
      ) {
        throw invalidVerificationEmailResendRequest();
      }

      if (user.isBlocked) {
        throw new BadDataException(ExceptionMessages.UserBlocked);
      }

      if (user.isEmailVerified) {
        return sendVerificationEmailResendReply(req, res, {
          emailSent: false,
          alreadyVerified: true,
          retryAfterSeconds: 0,
        });
      }

      const userId: ObjectID = user.id;
      const fenceKey: string = userId.toString();

      // Cheap first: during a cooldown this is the only store touched.
      const existingFence: string | null =
        await runVerificationEmailResendFenceOperation<string | null>(
          (): Promise<string | null> => {
            return GlobalCache.getString(
              VERIFICATION_EMAIL_RESEND_FENCE_NAMESPACE,
              fenceKey,
            );
          },
        );

      const fenceClaimedAtMs: number | null =
        readVerificationEmailResendFenceClaimedAtMs(existingFence);

      if (fenceClaimedAtMs !== null) {
        /*
         * A claim stamped in the future is another pod's clock running
         * ahead; it is treated as "just now" so the wait never exceeds the
         * cooldown itself.
         */
        const elapsedSeconds: number = Math.max(
          0,
          (now.getTime() - fenceClaimedAtMs) / 1000,
        );

        return sendVerificationEmailResendReply(req, res, {
          emailSent: false,
          alreadyVerified: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil(
              VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS - elapsedSeconds,
            ),
          ),
        });
      }

      /*
       * The history the policy needs: everything inside the hourly window,
       * and everything since the credential was issued, whichever reaches
       * further back.
       */
      const windowStartMs: number =
        now.getTime() - VERIFICATION_EMAIL_RESEND_WINDOW_IN_SECONDS * 1000;
      const historyStart: Date = new Date(
        Math.min(credentialIssuedAt.getTime(), windowStartMs),
      );

      const sentTokenRows: Array<EmailVerificationToken> =
        await EmailVerificationTokenService.findBy({
          query: {
            userId: user.id!,
            createdAt: QueryHelper.greaterThanEqualTo(historyStart),
          },
          select: {
            createdAt: true,
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
          limit: VERIFICATION_EMAIL_RESEND_HISTORY_LIMIT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      const sendTimes: Array<Date> = (sentTokenRows || [])
        .map((row: EmailVerificationToken) => {
          return toValidDateOrNull(row.createdAt);
        })
        .filter((sendTime: Date | null): sendTime is Date => {
          return sendTime !== null;
        });

      const decision: VerificationEmailResendDecision =
        VerificationEmailResendPolicy.evaluate({
          sendTimes,
          credentialIssuedAt,
          now,
        });

      if (
        decision.type ===
        VerificationEmailResendDecisionType.CredentialExhausted
      ) {
        throw invalidVerificationEmailResendRequest();
      }

      if (decision.type === VerificationEmailResendDecisionType.CoolingDown) {
        return sendVerificationEmailResendReply(req, res, {
          emailSent: false,
          alreadyVerified: false,
          retryAfterSeconds: decision.retryAfterSeconds,
        });
      }

      /*
       * The atomic claim. The random half makes the value ours alone, so the
       * release below can only ever remove the fence this request set, never
       * one a later request set after ours expired.
       */
      const fenceValue: string = `${now.getTime()}:${crypto.randomUUID()}`;

      const didClaimFence: boolean =
        await runVerificationEmailResendFenceOperation<boolean>(
          (): Promise<boolean> => {
            return GlobalCache.setStringIfNotExists(
              VERIFICATION_EMAIL_RESEND_FENCE_NAMESPACE,
              fenceKey,
              fenceValue,
              {
                expiresInSeconds: VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
              },
            );
          },
        );

      if (!didClaimFence) {
        // A concurrent request won the claim and is sending right now.
        return sendVerificationEmailResendReply(req, res, {
          emailSent: false,
          alreadyVerified: false,
          retryAfterSeconds: VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
        });
      }

      /*
       * Mails the address STORED on the account, never one from the request.
       * Awaited all the way to the mail service, unlike the sign-in path:
       * this reply says a mail went out, and a send that fails removes its
       * own token row (see AuthenticationEmail) so it spends no cap.
       */
      try {
        await AuthenticationEmail.sendVerificationEmail(user, {
          awaitDelivery: true,
        });
      } catch (err) {
        /*
         * Nothing was sent, so the user should not be made to wait out a
         * cooldown for it. Releasing is best effort: if it fails too, the
         * fence simply expires on its own.
         */
        try {
          await GlobalCache.deleteKeyIfValue(
            VERIFICATION_EMAIL_RESEND_FENCE_NAMESPACE,
            fenceKey,
            fenceValue,
          );
        } catch (releaseErr) {
          logger.error(
            releaseErr,
            getLogAttributesFromRequest(req as RequestLike),
          );
        }

        return next(err);
      }

      // The user id only: never the address, and never a token.
      logger.info("Verification email resent", {
        ...getLogAttributesFromRequest(req as RequestLike),
        userId: userId.toString(),
      });

      return sendVerificationEmailResendReply(req, res, {
        emailSent: true,
        alreadyVerified: false,
        retryAfterSeconds: VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
      });
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

      /*
       * The write's own hook ends a sign-in link sent before the reset, in
       * this same statement, as it does for every new password: somebody
       * resetting their password may be locking out whoever read their mail
       * (UserService.onUpdatePermitted, Types/Accounts/MagicLink).
       */
      await UserService.updateOneById({
        id: alreadySavedUser.id!,
        data: {
          password: user.password!,
          resetPasswordToken: null!,
          resetPasswordExpires: null!,
          /*
           * The reset token only ever travelled inside an email to this
           * account's current address -- changing the address clears it (see
           * UserService.onBeforeUpdate) -- so spending it proves the mailbox,
           * exactly as /verify-email does. Without this, somebody who never
           * found their welcome email would reset their password only to be
           * told at the next sign-in to go and verify the address they have
           * just proved they own.
           */
          isEmailVerified: true,
        },
        props: {
          isRoot: true,
          /*
           * The write's own hook mails the owner "Your password was changed"
           * (UserService.onUpdateSuccess), as it does for every change of a
           * password, and says from where with this. This route used to mail
           * it as well, so every reset sent the owner the same email twice.
           */
          requestOrigin: RequestOriginUtil.fromRequest(req),
        },
      });

      // Revoke all active sessions for this user on password reset
      await UserSessionService.revokeAllSessionsByUserId(alreadySavedUser.id!, {
        cause: SessionEndCause.PasswordReset,
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

/*
 * A refresh of a session that is no longer live. A session the server's session
 * lengths ended already - a master admin shortened them, and every session past
 * them was ended at once (UserSessionService.endSessionsPastLengths) - says why,
 * as it would have had this refresh been the one to end it.
 */
const refuseEndedSession: (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  refreshToken: string;
}) => Promise<void> = async (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  refreshToken: string;
}): Promise<void> => {
  const endReason: SessionEndReason | null =
    await UserSessionService.getSessionLengthEndReason(data.refreshToken);

  CookieUtil.removeAllCookies(data.req, data.res);

  return Response.sendErrorResponse(
    data.req,
    data.res,
    endReason
      ? new SessionEndedException(endReason)
      : new NotAuthenticatedException("Session expired. Please login again."),
  );
};

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
        return await refuseEndedSession({ req, res, refreshToken });
      }

      if (
        session.refreshTokenExpiresAt &&
        OneUptimeDate.hasExpired(session.refreshTokenExpiresAt)
      ) {
        await UserSessionService.revokeSessionById(session.id, {
          cause: SessionEndCause.Expired,
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
          isBlocked: true,
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

      /*
       * Blocking revokes every session (UserService.onUpdateSuccess), so this
       * is normally reached only by a session that escaped that -- a block
       * written with ignoreHooks, or a race with the revocation. Read from
       * the row, not the per-node cache, so it applies at once.
       */
      if (user.isBlocked) {
        await UserSessionService.revokeSessionById(session.id, {
          cause: SessionEndCause.AccountBlocked,
        });
        CookieUtil.removeAllCookies(req, res);
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException(ExceptionMessages.UserBlocked),
        );
      }

      const additionalInfo: JSONObject = (session.additionalInfo ||
        {}) as JSONObject;
      const isGlobalLogin: boolean =
        typeof additionalInfo["isGlobalLogin"] === "boolean"
          ? (additionalInfo["isGlobalLogin"] as boolean)
          : true;

      /*
       * How long a sign-in lasts (Common/Types/UserSession/SessionLength.ts):
       * the session ends once the server's session length has passed since
       * it signed in, or its person has not used OneUptime for the idle
       * timeout - by what the session knows, and while an idle timeout is
       * set, by what the Dashboard says of how long its person has not
       * clicked, typed or scrolled (inactiveForInSeconds). Decided here,
       * never left to the browser.
       */
      const decision: SessionRenewalDecision =
        await UserSessionService.decideRenewal({
          session,
          reportedInactivityInSeconds: readReportedInactivityInSeconds(
            (req.body as JSONObject | undefined)?.[
              INACTIVE_FOR_IN_SECONDS_FIELD
            ],
          ),
        });

      if (decision.hasEnded) {
        await UserSessionService.endSessionByLength(
          session.id,
          decision.reason,
        );
        CookieUtil.removeAllCookies(req, res);
        return Response.sendErrorResponse(
          req,
          res,
          new SessionEndedException(decision.reason),
        );
      }

      const renewedSession: SessionMetadata | null =
        await UserSessionService.renewSessionWithNewRefreshToken({
          session,
          lastActiveAt: decision.lastActiveAt,
          lengths: decision.lengths,
          ipAddress: getClientIp(req),
          userAgent: headerValueToString(req.headers["user-agent"]),
          ...extractDeviceInfo(req),
        });

      // Ended while this request was on its way: it stays ended.
      if (!renewedSession) {
        return await refuseEndedSession({ req, res, refreshToken });
      }

      CookieUtil.setUserCookie({
        expressResponse: res,
        user,
        isGlobalLogin,
        ...getSessionCookieFields(renewedSession),
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
          signedInAt: renewedSession.signedInAt,
          lastActiveAt: renewedSession.lastActiveAt,
        },
        expiresInSeconds: renewedSession.accessTokenExpiresInSeconds,
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
          cause: SessionEndCause.SignedOut,
          // Where they signed out from, for the audit log's entry.
          requestOrigin: RequestOriginUtil.fromRequest(req),
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
  twoFactorRateLimit,
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
      verifyBackupCode: false,
    });
  },
);

router.post(
  "/verify-webauthn-auth",
  twoFactorRateLimit,
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
      verifyBackupCode: false,
    });
  },
);

/*
 * The way back in when the second factor itself is unreachable: the phone with
 * the authenticator app is gone, or the security key is in a taxi.
 *
 * Without this route the account is simply lost. Every other second step here
 * demands the very device that has stopped existing, and the only remedy left
 * is a master admin running `resetTwoFactorAuth` -- which is fine for a
 * company with an admin on hand at 2am and useless for everybody else,
 * including the master admin themselves.
 *
 * WHY IT IS NOT A WEAKER DOOR
 *
 * It sits on a sign-in limiter bucket of its own (backupCodeRateLimit), and
 * its wrong codes are counted for the account on a count of their own
 * (TwoFactorWrongCodes), but the code space is what actually guards it: ten
 * characters over a 32 symbol alphabet is 2^50, so a caller holding the
 * password guesses one of the user's ten remaining codes with probability
 * ~10/2^50 per attempt. That is roughly ten orders of magnitude further out
 * of reach than the six digit TOTP space the limiter was sized for -- the
 * limits are a backstop here, not the control.
 *
 * Codes are single use and consumed by one conditional UPDATE inside Postgres
 * (UserTwoFactorBackupCodeService.consumeCode), so two requests carrying the
 * same code cannot both succeed.
 */
router.post(
  "/verify-backup-code",
  backupCodeRateLimit,
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
      verifyBackupCode: true,
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
  twoFactorRateLimit,
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
      verifyBackupCode: false,
    });
  },
);

router.post(
  "/login",
  loginRateLimit,
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
      verifyBackupCode: false,
    });
  },
);

/*
 * POST /login-with-magic-link -- the first step of a sign-in begun with a
 * sign-in link (Types/Accounts/MagicLink): the page the link opens posts its
 * token here once its reader presses Sign In. It is `login()`, with the link
 * standing in for the email and password, so everything after the password
 * holds as it does for a password: a blocked account is refused, the
 * server's SSO requirement applies, and an account with two factor
 * authentication is sent to its second step - which carries the token
 * again, as a password sign-in's carries the password - before the link is
 * spent and a session made.
 *
 * The token is a server-minted random UUID - 122 bits - that works once and
 * for minutes, so there is nothing to guess. The limiter in front of it, on
 * a bucket of its own, bounds work instead: every request hashes its token
 * and looks it up (IdentityRateLimit's MAGIC_LINK_BUCKET). No captcha: the
 * request for the link carried one, where it is on. The second steps keep
 * their own limiters.
 */
const magicLinkRateLimit: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> = IdentityRateLimit.getMiddleware(
  IdentityRateLimitBucket.MagicLink,
);

router.post(
  "/login-with-magic-link",
  magicLinkRateLimit,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    Response.setNoCacheHeaders(res);

    return login({
      req: req,
      res: res,
      next: next,
      verifyTotpAuth: false,
      verifyWebAuthn: false,
      verifyTotpEnrolment: false,
      verifyBackupCode: false,
      isMagicLinkFirstStep: true,
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
 * The answer to a code that was not checked, because the account is waiting
 * after too many wrong codes in a row (TwoFactorWrongCodes), or because the
 * count could not be read. Reached only after the password or a sign-in link
 * was accepted, so the waiting message may say what is going on; the
 * unavailable one is the sign-in limiter's, word for word.
 */
type SendCodeNotCheckedFunction = (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  kind: TwoFactorCodeKind;
  check: TwoFactorCodeCheck;
}) => void;

const sendCodeNotChecked: SendCodeNotCheckedFunction = (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  kind: TwoFactorCodeKind;
  check: TwoFactorCodeCheck;
}): void => {
  if (data.check.outcome === TwoFactorCodeCheckOutcome.Waiting) {
    const setHeader: unknown = (data.res as unknown as Record<string, unknown>)[
      "setHeader"
    ];

    if (typeof setHeader === "function") {
      (setHeader as (name: string, value: string) => void).call(
        data.res,
        "Retry-After",
        String(data.check.waitSeconds),
      );
    }

    return Response.sendErrorResponse(
      data.req,
      data.res,
      new TooManyRequestsException(
        TwoFactorWrongCodes.getWaitingMessage(
          data.kind,
          data.check.waitSeconds,
        ),
      ),
    );
  }

  return Response.sendErrorResponse(
    data.req,
    data.res,
    new ServiceUnavailableException(IDENTITY_COUNTER_UNAVAILABLE_MESSAGE),
  );
};

/*
 * After a counted attempt that did not sign in - a wrong code, an app that
 * is not the account's, or a request that failed before its code could be
 * checked: once the waits have begun, the owner is emailed, at most once a
 * day (TwoFactorWrongCodes.shouldTellOwner), at the address on the account
 * rather than in the browser that entered the codes. The mail is told whether
 * this attempt's sign-in began with a link, since what the owner should do
 * next depends on it.
 *
 * Called from a `finally`, so it never throws: the mail is never awaited,
 * and nothing here may change the answer the caller gets, whatever the mail
 * server or Valkey says.
 */
type TellOwnerAboutWrongCodeFunction = (data: {
  req: ExpressRequest;
  user: User;
  check: TwoFactorCodeCheck;
  isMagicLinkSignIn: boolean;
}) => Promise<void>;

const tellOwnerAboutWrongCode: TellOwnerAboutWrongCodeFunction = async (data: {
  req: ExpressRequest;
  user: User;
  check: TwoFactorCodeCheck;
  isMagicLinkSignIn: boolean;
}): Promise<void> => {
  try {
    // Read while the request is open: the count below is awaited first.
    const origin: RequestOrigin = RequestOriginUtil.fromRequest(data.req);

    const shouldTellOwner: boolean = await TwoFactorWrongCodes.shouldTellOwner({
      userId: data.user.id!,
      wrongCodesInARow: data.check.wrongCodesInARow,
    });

    if (!shouldTellOwner) {
      return;
    }

    logger.warn(
      `Wrong two factor codes in a row for user ${data.user.id!.toString()}: ${data.check.wrongCodesInARow}. Each next code now waits.`,
      getLogAttributesFromRequest(data.req as RequestLike),
    );

    AuthenticationEmail.sendTwoFactorWrongCodesEmail({
      user: data.user,
      wrongCodesInARow: data.check.wrongCodesInARow,
      isMagicLinkSignIn: data.isMagicLinkSignIn,
      origin: origin,
    }).catch((err: Error) => {
      logger.error(err, getLogAttributesFromRequest(data.req as RequestLike));
    });
  } catch (err) {
    logger.error(err, getLogAttributesFromRequest(data.req as RequestLike));
  }
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
 *
 * `isMagicLinkFirstStep` is POST /login-with-magic-link: a first step that
 * proves the account with a sign-in link instead of its email and password
 * (Types/Accounts/MagicLink). A second step needs no flag of its own for
 * that: it finishes whichever first step began it, by what its request
 * carries -- the password again, or the link's token again.
 */
/*
 * The second factor a login proved, for the audit log's sign-in entry
 * (SessionSignIn): the step it is finishing, or none for an account
 * without one. An enrolment proves the authenticator app it sets up.
 */
const getSecondFactorOfLogin: (stage: {
  verifyTotpAuth: boolean;
  verifyWebAuthn: boolean;
  verifyTotpEnrolment: boolean;
  verifyBackupCode: boolean;
}) => SecondFactor | undefined = (stage: {
  verifyTotpAuth: boolean;
  verifyWebAuthn: boolean;
  verifyTotpEnrolment: boolean;
  verifyBackupCode: boolean;
}): SecondFactor | undefined => {
  if (stage.verifyTotpAuth || stage.verifyTotpEnrolment) {
    return SecondFactor.AuthenticatorApp;
  }

  if (stage.verifyWebAuthn) {
    return SecondFactor.SecurityKey;
  }

  if (stage.verifyBackupCode) {
    return SecondFactor.BackupCode;
  }

  return undefined;
};

type LoginFunction = (options: {
  req: ExpressRequest;
  res: ExpressResponse;
  next: NextFunction;
  verifyTotpAuth: boolean;
  verifyWebAuthn: boolean;
  verifyTotpEnrolment: boolean;
  verifyBackupCode: boolean;
  isMagicLinkFirstStep?: boolean | undefined;
}) => Promise<void>;

const login: LoginFunction = async (options: {
  req: ExpressRequest;
  res: ExpressResponse;
  next: NextFunction;
  verifyTotpAuth: boolean;
  verifyWebAuthn: boolean;
  verifyTotpEnrolment: boolean;
  verifyBackupCode: boolean;
  isMagicLinkFirstStep?: boolean | undefined;
}): Promise<void> => {
  const req: ExpressRequest = options.req;
  const res: ExpressResponse = options.res;
  const next: NextFunction = options.next;
  const verifyTotpAuth: boolean = options.verifyTotpAuth;
  const verifyWebAuthn: boolean = options.verifyWebAuthn;
  const verifyTotpEnrolment: boolean = options.verifyTotpEnrolment;
  const verifyBackupCode: boolean = options.verifyBackupCode;
  const isMagicLinkFirstStep: boolean = options.isMagicLinkFirstStep === true;

  /*
   * True for every request that is finishing a two factor login rather than
   * starting one. Named once because it appears in three places -- the captcha
   * skip, the "show the challenge" gate, and the factor dispatch below -- and
   * a new mode added to two of the three is exactly the bug that would let a
   * second step fall through to the challenge screen it was answering.
   */
  const isSecondStep: boolean =
    verifyTotpAuth || verifyWebAuthn || verifyTotpEnrolment || verifyBackupCode;

  /*
   * Recovery codes minted during a forced enrolment, carried out to the
   * response so the sign-in page can show them once before it redirects.
   *
   * Declared out here rather than inside the enrolment branch because the
   * successful-login response is built in one place at the bottom for every
   * path through this handler. Empty for every other path, and the response
   * omits the key entirely when it is empty -- a login that minted nothing
   * must not look to the page like a login that did.
   */
  let enrolmentBackupCodes: Array<string> = [];

  /*
   * True when an enrolment found recovery codes already on the account and so
   * minted none. Distinguishes "nothing to show you" from "nothing to show you
   * because you have nothing", which the sign-in page acts on differently.
   */
  let enrolmentAccountAlreadyHadCodes: boolean = false;

  try {
    const miscDataProps: JSONObject =
      (req.body["miscDataProps"] as JSONObject) || {};

    /*
     * Only the first step of a login carries a captcha. hCaptcha tokens are
     * single use, so the second step cannot replay the one the password step
     * already spent, and demanding a fresh one would mean rendering a second
     * challenge in the middle of an authentication the user has already
     * mostly completed.
     *
     * Nor does a first step made with a sign-in link: the captcha guards
     * against guessing, and the link is a server-minted random token, sent
     * by a request that carried a captcha of its own (/send-magic-link).
     */
    if (!isSecondStep && !isMagicLinkFirstStep) {
      await CaptchaUtil.verifyCaptcha({
        token:
          (miscDataProps["captchaToken"] as string | undefined) ||
          (req.body["captchaToken"] as string | undefined),
        remoteIp: getClientIp(req) || null,
      });
    }

    const data: JSONObject = req.body["data"];

    /*
     * The sign-in link this request proves the account with, in place of its
     * password (Types/Accounts/MagicLink), or null when the password proves
     * it. POST /login-with-magic-link always signs in with a link; a second
     * step does when it carries the link's token again; /login never does.
     * A token that is present but not one ("" from readToken) is a link that
     * does not work - never a password sign-in.
     */
    const magicLinkToken: string | null =
      isMagicLinkFirstStep || isSecondStep ? MagicLink.readToken(data) : null;

    const isMagicLinkSignIn: boolean =
      isMagicLinkFirstStep || magicLinkToken !== null;

    /*
     * The request body is NOT logged here. This handler is shared by password
     * login, TOTP verification and WebAuthn verification, so the body carries a
     * plaintext password, a TOTP code, or a WebAuthn assertion on every call --
     * and DEBUG output goes to stdout, the recent-log buffer and telemetry at
     * once. Log the stage instead; the user is identified by the request
     * attributes. (A sign-in link's token is a credential like the others.)
     */
    logger.debug(
      "Login request received. stage: " +
        (verifyTotpAuth
          ? "totp"
          : verifyWebAuthn
            ? "webauthn"
            : verifyTotpEnrolment
              ? "totp-enrolment"
              : verifyBackupCode
                ? "backup-code"
                : isMagicLinkFirstStep
                  ? "magic-link"
                  : "password"),
      getLogAttributesFromRequest(req as RequestLike),
    );

    const user: User = BaseModel.fromJSON(data as JSONObject, User) as User;

    if (!isMagicLinkSignIn && (!user.email || !user.password)) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Email and password are required."),
      );
    }

    /*
     * While a master admin has turned sign-in links off, none signs anybody
     * in - one sent before they were turned off included, at every stage, so
     * a second step begun with a link finishes nowhere either.
     */
    if (
      isMagicLinkSignIn &&
      (await GlobalConfigService.getMagicLinkLoginTurnedOff())
    ) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(MAGIC_LINK_TURNED_OFF_MESSAGE),
      );
    }

    /*
     * The submitted password stays plaintext until the account is on hand:
     * its hash cannot be computed without that account's own salt, so there
     * is nothing to pre-hash and nothing to query by. Empty for a sign-in
     * with a link, which never reaches the password check.
     */
    const submittedPassword: string = isMagicLinkSignIn
      ? ""
      : user.password!.toString();

    const signInSelect: Select<User> = {
      _id: true,
      password: true,
      passwordSalt: true,
      name: true,
      email: true,
      isMasterAdmin: true,
      isEmailVerified: true,
      isBlocked: true,
      profilePictureId: true,
      timezone: true,
      enableTwoFactorAuth: true,
    };

    /*
     * The account: by the address typed, for a password; by the token, for
     * a sign-in link - the account whose latest link it is, while that link
     * still works. The link is only read here; it is spent once the whole
     * sign-in has succeeded (spendMagicLink, below), so it still stands in
     * for the password at the second step.
     */
    const alreadySavedUser: User | null = isMagicLinkSignIn
      ? await UserService.findByMagicLinkToken({
          token: magicLinkToken || "",
          select: signInSelect,
        })
      : await UserService.findOneBy({
          query: { email: user.email! },
          select: signInSelect,
          props: {
            isRoot: true,
          },
        });

    /*
     * A link that is not one, has been used, has expired or was replaced by
     * a newer one: answered alike, so the answer says nothing about which -
     * and not as a wrong password, which it is not.
     */
    if (isMagicLinkSignIn && !alreadySavedUser) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(MAGIC_LINK_INVALID_MESSAGE),
      );
    }

    /*
     * Spends the sign-in link this request proved the account with, once:
     * true when it is spent - by this call, or by an earlier one in this
     * request - and false when there was nothing left to spend, because
     * another request spent it first or it stopped working. Nothing is
     * signed in then.
     *
     * Called where the sign-in is decided, and nowhere sooner: once the
     * second factor has passed, or straight away for an account without
     * one. A step that spends something scarce or shows something once
     * calls it first - before a backup code is spent, and before an
     * enrolment is saved and its recovery codes minted - so that losing a
     * race for the link, a credential a fresh email replaces, never costs a
     * credential that nothing replaces.
     *
     * Spending a link proves the mailbox it was sent to, so the address is
     * verified with it, as a password reset verifies it. Never fatal: the
     * link is spent and the sign-in is going ahead, so a failed write leaves
     * the address unverified, to be proved another time, rather than
     * refusing a sign-in that has already cost the link.
     */
    let isMagicLinkSpent: boolean = false;

    const spendMagicLink: (account: User) => Promise<boolean> = async (
      account: User,
    ): Promise<boolean> => {
      if (isMagicLinkSpent) {
        return true;
      }

      isMagicLinkSpent = await UserService.consumeMagicLinkToken({
        userId: account.id!,
        token: magicLinkToken || "",
      });

      if (isMagicLinkSpent && !account.isEmailVerified) {
        try {
          await UserService.updateOneById({
            id: account.id!,
            data: {
              isEmailVerified: true,
            },
            props: {
              isRoot: true,
            },
          });

          account.isEmailVerified = true;
        } catch (err) {
          logger.error(err, getLogAttributesFromRequest(req as RequestLike));
        }
      }

      return isMagicLinkSpent;
    };

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

      /*
       * Verified once, against this user's own salt, and reused for the
       * final gate below. Re-verifying there would repeat the legacy-hash
       * upgrade write on every login of an un-upgraded account.
       *
       * A sign-in link stands in for the password (Types/Accounts/MagicLink):
       * the account was found by the link's token, still working, so there
       * is no password to check, and every check after this one holds for a
       * link as it does for a password.
       */
      const isPasswordValid: boolean =
        isMagicLinkSignIn ||
        (await UserService.verifyHashedColumnValue({
          item: alreadySavedUser,
          columnName: "password",
          plainValue: submittedPassword,
        }));

      if (!isPasswordValid) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Invalid login: Email or password does not match.",
          ),
        );
      }

      /*
       * Blocked by a master admin. Checked on every stage -- password, TOTP,
       * WebAuthn, backup code, forced enrolment -- because each one of them
       * ends in finalizeUserLogin, and checked ahead of the second factor so
       * that a blocked account neither spends a backup code nor has an
       * enrolment created for it.
       *
       * After the password, not before it: the reason for the refusal is only
       * told to somebody who has already proved they own the account.
       */
      if (alreadySavedUser.isBlocked) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(ExceptionMessages.UserBlocked),
        );
      }

      /*
       * While the whole server requires single sign-on, only a master admin
       * signs in with a password (SsoRequiredSignIn) - at every stage, so a
       * second step started before it was turned on finishes nowhere either.
       * After the password, like the checks around it, so only the account's
       * holder is told why; ahead of the address check, so nobody is mailed a
       * verification link for a sign-in that cannot happen.
       */
      await SsoRequiredSignIn.assertNonSsoSignInAllowed(alreadySavedUser);

      /*
       * An unverified address gets no session, on any stage. This is the gate
       * a hosted signup is held at until its welcome link is followed, and
       * the way back for somebody who lost that email: signing in mails them a
       * fresh link.
       *
       * After the password, not before it. Ahead of the password this was a
       * button anyone who knew an address could press -- every press sent the
       * owner another email, and the reply told the presser the account
       * existed and had not been verified. Only the password holder learns
       * that now, and only their attempts send mail. Somebody who does not
       * have the password recovers through forgot-password instead, whose
       * reset link proves the mailbox and so verifies the address on the way.
       *
       * Not for a sign-in link, which proves the mailbox itself: it only ever
       * travelled inside an email to this address. Mailing it a verification
       * link would ask for a proof it has just been given, so the address is
       * verified when the link is spent instead (spendMagicLink).
       */
      if (!alreadySavedUser.isEmailVerified && !isMagicLinkSignIn) {
        /*
         * The link is the same "please verify" email a sign-up sends, so it
         * is counted with them, per caller and per address
         * (PublicMessageRateLimit): an address is sent so many of them in
         * an hour, from sign-ups and sign-ins together, however many
         * callers ask.
         */
        await PublicMessageRateLimit.assertMaySend({
          req: req,
          kind: PublicMessageKind.SignUpEmail,
          contacts: [PublicMessageRateLimit.forEmail(alreadySavedUser.email!)],
        });

        await AuthenticationEmail.sendVerificationEmail(alreadySavedUser);

        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Email is not verified. We have sent you an email with the verification link. Please do not forget to check spam.",
          ),
        );
      }

      if (alreadySavedUser.enableTwoFactorAuth && !isSecondStep) {
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
          return Response.sendEntityResponse(
            req,
            res,
            UserResponse.toResponseUser(alreadySavedUser),
            User,
            {
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
            },
          );
        }

        /*
         * How many single-use recovery codes are left, so the challenge screen
         * knows whether to offer "use a backup code" at all. Offering it to
         * somebody with none would send them to a route that can only refuse
         * them, at the moment they are already locked out and panicking.
         *
         * A COUNT, never the codes. The caller has proved a password and
         * nothing else at this point, so anything shipped here is shipped to
         * whoever is holding that password -- and the whole point of a backup
         * code is that holding the password is not enough. The number itself
         * tells an attacker only that a recovery route exists, which they can
         * infer from the button either way.
         */
        /*
         * A count that cannot be read must not take the sign-in down with it.
         * Unguarded, a failure on the backup code table -- one bad index, one
         * exhausted connection pool -- turned every two factor login on the
         * instance into a 500, because this await sits between the accepted
         * password and the response that lists the user's factors. The
         * recovery route is the LEAST important thing on that response;
         * degrading it to "no codes reported" costs a locked-out user one
         * sentence of guidance, and throwing costs every user the ability to
         * sign in at all.
         */
        let backupCodeCount: number | null = null;

        try {
          backupCodeCount =
            await UserTwoFactorBackupCodeService.countUnusedForUser({
              userId: alreadySavedUser.id!,
            });
        } catch (backupCodeCountError) {
          logger.error(backupCodeCountError);
        }

        // See the note on the successful-login response below.
        return Response.sendEntityResponse(
          req,
          res,
          UserResponse.toResponseUser(alreadySavedUser),
          User,
          {
            miscData: {
              totpAuthList: UserTotpAuth.toJSONArray(
                totpAuthList,
                UserTotpAuth,
              ),
              webAuthnList: UserWebAuthn.toJSONArray(
                webAuthnList,
                UserWebAuthn,
              ),

              /*
               * OMITTED, not zeroed, when the count could not be read. Zero is a
               * claim -- the sign-in page now says "you have no backup codes,
               * ask an administrator to reset two factor auth" on the strength
               * of it -- and that claim is false for a user who has ten codes in
               * their hand and is hitting a database that briefly cannot count
               * them. Sending nothing means "unknown", which the page renders as
               * the code form: a user with codes can still use them, and a user
               * without gets the same refusal they would have got anyway.
               */
              ...(backupCodeCount === null
                ? {}
                : { backupCodeCount: backupCodeCount }),
            },
          },
        );
      }

      if (isSecondStep) {
        if (verifyTotpAuth) {
          /*
           * Counted for the account before the code is looked at, wherever
           * the request came from (TwoFactorWrongCodes): after five wrong
           * codes in a row, each next code waits, and while it waits no code
           * is checked, right or wrong. The password or sign-in link has been
           * checked above, so only somebody who holds one moves this count.
           */
          const codeCheck: TwoFactorCodeCheck =
            await TwoFactorWrongCodes.startCheck({
              userId: alreadySavedUser.id!,
              kind: TwoFactorCodeKind.AuthenticatorCode,
            });

          if (codeCheck.outcome !== TwoFactorCodeCheckOutcome.Allowed) {
            return sendCodeNotChecked({
              req,
              res,
              kind: TwoFactorCodeKind.AuthenticatorCode,
              check: codeCheck,
            });
          }

          // code from req
          const code: string = data["code"] as string;
          const twoFactorAuthId: string = data["twoFactorAuthId"] as string;

          let totpAuth: UserTotpAuth | null = null;
          let isVerified: boolean = false;

          /*
           * Whatever ends this counted attempt short of the right code - an
           * app that is not the account's, a wrong code, or an id that is not
           * one, which the query refuses by throwing - tells the owner once
           * the waits have begun, as the count already holds it against them.
           */
          try {
            totpAuth = await UserTotpAuthService.findOneBy({
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

            if (totpAuth) {
              isVerified = TotpAuth.verifyToken({
                token: code,
                secret: totpAuth.twoFactorSecret!,
                email: alreadySavedUser.email!,
              });
            }
          } finally {
            if (!isVerified) {
              await tellOwnerAboutWrongCode({
                req,
                user: alreadySavedUser,
                check: codeCheck,
                isMagicLinkSignIn: isMagicLinkSignIn,
              });
            }
          }

          if (!totpAuth) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(TWO_FACTOR_MESSAGES.authenticatorGone),
            );
          }

          if (!isVerified) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(TWO_FACTOR_MESSAGES.wrongCode),
            );
          }
        } else if (verifyWebAuthn) {
          const credential: any = data["credential"];

          await UserWebAuthnService.verifyAuthentication({
            userId: alreadySavedUser.id!.toString(),
            credential: credential,
          });
        } else if (verifyBackupCode) {
          /*
           * A single-use recovery code, standing in for an authenticator the
           * user cannot reach. Getting here proves the password and the
           * verified email, exactly as the other second steps do.
           *
           * TWO REFUSALS SIT IN FRONT OF THE CODE CHECK, and neither is
           * bookkeeping:
           *
           *  - if the account is NOT required to use two factor auth, there is
           *    no second step to recover from. /login would already have signed
           *    this caller straight in, so accepting a code here would spend
           *    one of the user's ten recovery codes to buy them nothing --
           *    quietly eroding the reserve they were saving for the day they
           *    do need it;
           *  - if the account has NO verified factor, it is not at the
           *    challenge screen at all: /login sends it through enrolment,
           *    which needs only the password. Accepting a code here would be a
           *    second, weaker-looking door onto a state that already has an
           *    open one -- and would let a user burn a code per sign-in
           *    forever without ever being prompted to enrol a replacement.
           *
           * Neither refusal is what stops a stolen password: the codes
           * themselves are. Both exist so that a code is only ever spent when
           * spending it is the thing the user actually needs.
           */
          if (!alreadySavedUser.enableTwoFactorAuth) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "Two factor authentication is not enabled for this account.",
              ),
            );
          }

          const existingFactors: {
            totpAuthList: Array<UserTotpAuth>;
            webAuthnList: Array<UserWebAuthn>;
          } = await fetchTotpAuthList(alreadySavedUser.id!);

          if (
            existingFactors.totpAuthList.length === 0 &&
            existingFactors.webAuthnList.length === 0
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "Two factor authentication is not set up for this account.",
              ),
            );
          }

          const backupCode: string = data["backupCode"] as string;

          /*
           * Proven present BEFORE it is used. An absent code would normalize
           * to the empty string, and while `consumeCode` refuses that on its
           * own, saying "Backup code is required" is the difference between a
           * user fixing a typo and a user concluding their printed codes have
           * stopped working.
           */
          CredentialGuard.assertPresent(backupCode, "Backup code");

          /*
           * Counted for the account like an authenticator code, on a count of
           * its own: somebody whose authenticator codes have stopped working
           * comes here next, and must not find this way back in waiting
           * because of them.
           */
          const backupCodeCheck: TwoFactorCodeCheck =
            await TwoFactorWrongCodes.startCheck({
              userId: alreadySavedUser.id!,
              kind: TwoFactorCodeKind.BackupCode,
            });

          if (backupCodeCheck.outcome !== TwoFactorCodeCheckOutcome.Allowed) {
            return sendCodeNotChecked({
              req,
              res,
              kind: TwoFactorCodeKind.BackupCode,
              check: backupCodeCheck,
            });
          }

          /*
           * A sign-in begun with a link spends the link before the code, not
           * after: a backup code is gone for good the moment it is spent (see
           * below), and losing a race for the link after spending one would
           * have it buy no session. A wrong code costs the link instead, which
           * a fresh email replaces.
           */
          if (isMagicLinkSignIn && !(await spendMagicLink(alreadySavedUser))) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(MAGIC_LINK_INVALID_MESSAGE),
            );
          }

          let isBackupCodeConsumed: boolean = false;

          /*
           * A counted attempt that spends no code - a wrong one, or a look-up
           * that failed - tells the owner once the waits have begun, as a
           * wrong authenticator code does.
           */
          try {
            isBackupCodeConsumed =
              await UserTwoFactorBackupCodeService.consumeCode({
                userId: alreadySavedUser.id!,
                code: backupCode,
              });
          } finally {
            if (!isBackupCodeConsumed) {
              await tellOwnerAboutWrongCode({
                req,
                user: alreadySavedUser,
                check: backupCodeCheck,
                isMagicLinkSignIn: isMagicLinkSignIn,
              });
            }
          }

          if (!isBackupCodeConsumed) {
            /*
             * One message for "no such code", "already used" and "belongs to
             * somebody else". Telling the caller which would turn this route
             * into an oracle for enumerating which codes off a photographed
             * list are still live.
             */
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(TWO_FACTOR_MESSAGES.wrongBackupCode),
            );
          }

          /*
           * THE CODE IS NOW SPENT. Everything below this line is notification
           * and bookkeeping, and NOTHING below this line may fail the login.
           *
           * That is not tidiness, it is the difference between an inconvenience
           * and a lockout. A backup code is single use and gone the instant the
           * UPDATE above commits, so an exception raised after it -- a database
           * hiccup on the count, an unreachable mail server -- would answer a
           * successful authentication with a 500 while the credential that
           * bought it no longer exists. The user's only recourse would be to
           * try again with the next code off the list, and burn that one the
           * same way, all the way down to none.
           *
           * So the whole tail runs detached: the count, the mail and the log
           * line are one promise chain that is never awaited and whose failure
           * is logged rather than thrown. The session is issued below either
           * way.
           *
           * The mail matters even though the user is about to see the count on
           * their own profile page, because the point is the sign-in that was
           * NOT theirs: it goes to the address on the account rather than to
           * the browser holding the code, so a stolen list produces an email
           * the real owner receives.
           *
           * Where the code was spent from is read now, while the request is
           * still open: the chain below may run after its connection closes.
           */
          const backupCodeRequestOrigin: RequestOrigin =
            RequestOriginUtil.fromRequest(req);

          UserTwoFactorBackupCodeService.countUnusedForUser({
            userId: alreadySavedUser.id!,
          })
            .then(async (remainingBackupCodeCount: number): Promise<void> => {
              logger.info(
                "Two factor backup code used to sign in: " +
                  alreadySavedUser.id!.toString() +
                  ", remaining: " +
                  remainingBackupCodeCount.toString(),
                getLogAttributesFromRequest(req as RequestLike),
              );

              await AuthenticationEmail.sendTwoFactorBackupCodeUsedEmail({
                user: alreadySavedUser,
                remainingCodeCount: remainingBackupCodeCount,
                origin: backupCodeRequestOrigin,
              });
            })
            .catch((err: Error) => {
              logger.error(
                err,
                getLogAttributesFromRequest(req as RequestLike),
              );
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
              new BadDataException(TWO_FACTOR_MESSAGES.authenticatorGone),
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
              new BadDataException(TWO_FACTOR_MESSAGES.wrongCode),
            );
          }

          /*
           * A sign-in begun with a link spends it now, once the code is right
           * and before anything is saved: the recovery codes minted below are
           * shown once, in this response, and a sign-in that lost a race for
           * its link afterwards would have no response to show them in.
           */
          if (isMagicLinkSignIn && !(await spendMagicLink(alreadySavedUser))) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(MAGIC_LINK_INVALID_MESSAGE),
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
           * a secret nobody uses.
           *
           * Sweeping them matters because `getOrCreatePendingTotpEnrolment`
           * REUSES the first unverified row it finds. Leave one behind and the
           * next time this account is sent through enrolment -- after an admin
           * resets it, say -- it would be offered that stale secret rather than
           * a fresh one.
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

          /*
           * This is the single most important place in the product to mint
           * recovery codes, and the one where it was most obviously missing.
           *
           * An account arrives here in exactly two situations: an admin has
           * just mandated two factor auth on somebody who had none, or an
           * admin has just RESET two factor auth for somebody who was locked
           * out -- and `UserService.resetTwoFactorAuth` deletes the backup
           * codes along with the factors, by design. Both of those used to end
           * with the user signed in, a fresh authenticator app, and no
           * recovery route whatsoever: the same lockout, one device away, with
           * nothing learned. The user who had just been rescued was the user
           * most certain to need rescuing again.
           *
           * The codes go out in the login response and the sign-in page shows
           * them before it redirects, which is what keeps the show-once
           * guarantee: nothing is written on a path that has no screen to
           * display it.
           *
           * Never fatal. The enrolment itself is complete and the password was
           * correct, so refusing the login over a failed mint would lock out
           * the user this whole feature exists to let in.
           */
          try {
            const mintedCodes: Array<string> | null =
              await UserTwoFactorBackupCodeService.generateForUserIfNone({
                userId: alreadySavedUser.id!,
              });

            enrolmentBackupCodes = mintedCodes || [];

            /*
             * A null return means the account ALREADY had codes, and the
             * sign-in page has to be told so.
             *
             * That account is rarer than it sounds but it is reachable: the
             * profile card deliberately lets a user generate codes before
             * turning two factor auth on, so somebody can be holding a printed
             * set and still have no verified factor when an admin mandates
             * one. Without this flag the page would fall through to its "you
             * have no backup codes" offer -- telling that user something false
             * and, if they took it up, replacing the very set they had
             * printed. Nothing else on this response can distinguish the two
             * cases: no codes are minted in either.
             */
            enrolmentAccountAlreadyHadCodes = mintedCodes === null;

            /*
             * Same out-of-band notice the profile routes send. Forced
             * enrolment is reached with a correct password and no session, so
             * a stolen password alone can put a second factor -- and its ten
             * recovery codes -- onto somebody else's mandated account. The
             * mail is how the real owner learns that happened.
             */
            if (mintedCodes && mintedCodes.length > 0) {
              TwoFactorBackupCodeNotification.notifyCodesCreated({
                userId: alreadySavedUser.id!,
                codeCount: mintedCodes.length,
                origin: RequestOriginUtil.fromRequest(req),
              });
            }
          } catch (backupCodeError) {
            logger.error(backupCodeError);
          }
        }

        /*
         * The second step passed - a code, a backup code, a security key or
         * a first enrolment - so the account's wrong codes are forgotten,
         * the one counted with this request included. Never fails the
         * sign-in (TwoFactorWrongCodes.forget does not throw).
         */
        await TwoFactorWrongCodes.forget(alreadySavedUser.id!);
      }

      /*
       * The sign-in is decided - the second factor passed, or the account has
       * none - so a sign-in begun with a link spends it here, if a step above
       * has not already. Of two requests carrying one link only one spends
       * it, and only that one is signed in: the other is answered as a link
       * that has been used.
       */
      if (isMagicLinkSignIn && !(await spendMagicLink(alreadySavedUser))) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(MAGIC_LINK_INVALID_MESSAGE),
        );
      }

      // Refresh Permissions for this user here.
      await AccessTokenService.refreshUserAllPermissions(alreadySavedUser.id!);

      if (isPasswordValid) {
        logger.info(
          (isMagicLinkSignIn
            ? "User logged in with a sign-in link: "
            : "User logged in: ") + alreadySavedUser.email?.toString(),
          getLogAttributesFromRequest(req as RequestLike),
        );

        const loginResult: FinalizeUserLoginResult = await finalizeUserLogin({
          req,
          res,
          user: alreadySavedUser,
          isGlobalLogin: true,
          signIn: {
            method: isMagicLinkSignIn
              ? SignInMethod.SignInLink
              : SignInMethod.Password,
            secondFactor: getSecondFactorOfLogin({
              verifyTotpAuth,
              verifyWebAuthn,
              verifyTotpEnrolment,
              verifyBackupCode,
            }),
          },
        });

        /*
         * sendEntityResponse serializes whatever is set on the model, with no
         * regard for read permissions, so the credential columns selected for
         * verification would otherwise be echoed back in the login response.
         * UserResponse copies out only the columns the sign-in pages read.
         */
        return Response.sendEntityResponse(
          req,
          res,
          UserResponse.toResponseUser(alreadySavedUser),
          User,
          {
            miscData: {
              accessToken: loginResult.accessToken,
              refreshToken: loginResult.sessionMetadata.refreshToken,
              refreshTokenExpiresAt:
                loginResult.sessionMetadata.refreshTokenExpiresAt.toISOString(),

              /*
               * Present only on a login that just enrolled a first factor and
               * minted a set behind it. Hyphenated for the page to render as-is,
               * exactly as the regenerate route does; the verify route
               * normalizes whatever the user types back.
               */
              ...(enrolmentBackupCodes.length > 0
                ? {
                    backupCodes: enrolmentBackupCodes.map((code: string) => {
                      return TwoFactorBackupCode.formatForDisplay(code);
                    }),
                  }
                : {}),

              /*
               * Sent only when it is true, and only by the enrolment path, so
               * that the sign-in page does not offer to generate a set for
               * somebody who is already holding one. See the note at the mint.
               */
              ...(enrolmentAccountAlreadyHadCodes
                ? { hasBackupCodes: true }
                : {}),
            },
          },
        );
      }
    }
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("Invalid login: Email or password does not match."),
    );
  } catch (err) {
    // A verification link refused for its rate limits says when to come back.
    PublicMessageRateLimit.setRetryAfterFor(res, err);
    return next(err);
  }
};

export default router;
