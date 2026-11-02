import { DashboardRoute } from "Common/ServiceRoute";
import Email from "Common/Types/Email";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { JSONObject } from "Common/Types/JSON";
import {
  SignedUpWithQueryParam,
  SignInAttributionCookieName,
  SignInAttributionCookiePath,
} from "Common/Types/Marketing/Attribution";
import Name from "Common/Types/Name";
import { SSO_REQUIRED_SIGN_IN_MESSAGE } from "Common/Types/SSO/SignInMethods";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import UserService from "Common/Server/Services/UserService";
import UserSessionService, {
  SessionMetadata,
} from "Common/Server/Services/UserSessionService";
import Attribution from "Common/Server/Utils/Attribution";
import CookieUtil from "Common/Server/Utils/Cookie";
import { getSessionCookieFields } from "Common/Server/Utils/SessionCookieFields";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  extractDeviceInfo,
  getClientIp,
  headerValueToString,
} from "Common/Server/Utils/Express";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import SsoRequiredSignIn from "Common/Server/Utils/SsoRequiredSignIn";
import User from "Common/Models/DatabaseModels/User";
import AuthenticationEmail from "./AuthenticationEmail";

/*
 * Signing in with an account another provider vouches for: Sign in with
 * Microsoft (../API/MicrosoftSignIn) and Continue with Google
 * (../API/GoogleSignIn). The flow and the rules on whom it signs in are one,
 * here; a provider brings its client, which runs the OpenID Connect code flow
 * with it and returns only an address the provider vouches for. Each is served
 * at
 *
 *   GET /identity/<provider>/sign-in    sends the browser to the provider
 *   GET /identity/<provider>/callback   where the provider sends it back
 *
 * and offered while this server has an app for it (the provider's client ID
 * and secret): its button on the sign-in and sign-up pages appears then.
 *
 * The account signs in the OneUptime user with the same - verified - email
 * address, or makes one where sign-up is open. It is an ordinary sign-in,
 * like a password: a project that requires its own SSO still requires it.
 * Two kinds of account never sign in this way and are asked for their
 * password instead: one with two-factor authentication turned on, whose
 * second factor this would skip, and a master admin's. An account whose
 * address was never verified is sent a verification link first. While the
 * whole server requires single sign-on, nobody signs in this way.
 *
 * Like every sign-in, it ends on the dashboard, which sends a buyer with a
 * marketplace purchase waiting back to the purchase page.
 *
 * Making an account here is a sign-up like any other, from an ad as often as
 * not, so it keeps the attribution the visitor arrived with: the button leaves
 * it in a cookie (SignInAttributionCookieName), the callback puts it on the
 * new user, and the Dashboard reports the sign-up (SignedUpWithQueryParam).
 */

// What a provider's client says the account is.
export interface ProviderAccount {
  // An address the provider vouches for: its client refuses any other.
  email: Email;
  name: string | null;
}

export interface ProviderSignInRequest {
  authorizationUrl: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface ProviderSignInClient {
  // Where to send the browser, and what its callback has to match.
  createSignInRequest(): ProviderSignInRequest;
  // The account the authorization code is for; throws when there is none to trust.
  completeSignIn(data: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<ProviderAccount>;
}

export interface SignInProvider {
  // As people read it: "Microsoft", "Google".
  name: string;
  // Its part of every address and of its state cookie's name: "microsoft".
  path: string;
  // What the Dashboard's mark of a sign-up names it (SignedUpWithProviders).
  signedUpWith: string;
  // Its client, or null where this server has no app for it.
  getClient: () => ProviderSignInClient | null;
  // The words its client's refusal has for the person, or null for any other error.
  getUserMessage: (err: unknown) => string | null;
}

const MESSAGE_VIEW: string =
  "/usr/src/app/FeatureSet/Identity/Views/Message.ejs";
const STATE_TTL_IN_SECONDS: number = 10 * 60;

/*
 * Who a sign-in is for, and whether it just made their account: that is a
 * sign-up, which the Dashboard reports (SignedUpWithQueryParam).
 */
interface ProviderSignInUser {
  user: User;
  isNewAccount: boolean;
}

const renderMessage: (
  req: ExpressRequest,
  res: ExpressResponse,
  title: string,
  message: string,
) => void = (
  req: ExpressRequest,
  res: ExpressResponse,
  title: string,
  message: string,
): void => {
  return Response.render(req, res, MESSAGE_VIEW, {
    title: title,
    message: message,
  });
};

/*
 * Whether this server requires single sign-on, when it says so on the page:
 * a provider's sign-in is not SSO, and no master admin signs in this way
 * (they are asked for their password), so while the whole server requires
 * SSO it signs nobody in (SsoRequiredSignIn). A requirement that cannot be
 * read signs nobody in either.
 */
const refuseWhileSsoIsRequired: (
  req: ExpressRequest,
  res: ExpressResponse,
  provider: SignInProvider,
) => Promise<boolean> = async (
  req: ExpressRequest,
  res: ExpressResponse,
  provider: SignInProvider,
): Promise<boolean> => {
  let isSsoRequired: boolean;

  try {
    isSsoRequired = await SsoRequiredSignIn.isSsoRequired();
  } catch (err) {
    logger.error(err, getLogAttributesFromRequest(req as RequestLike));

    renderMessage(
      req,
      res,
      `We could not sign you in with ${provider.name}.`,
      "Something went wrong. Please try again in a moment.",
    );

    return true;
  }

  if (!isSsoRequired) {
    return false;
  }

  renderMessage(
    req,
    res,
    "Sign in with SSO instead.",
    SSO_REQUIRED_SIGN_IN_MESSAGE,
  );

  return true;
};

const renderNotOffered: (
  req: ExpressRequest,
  res: ExpressResponse,
  provider: SignInProvider,
) => void = (
  req: ExpressRequest,
  res: ExpressResponse,
  provider: SignInProvider,
): void => {
  return renderMessage(
    req,
    res,
    `Sign in with ${provider.name} is not available.`,
    `This OneUptime server does not offer Sign in with ${provider.name}. Please sign in with your email and password.`,
  );
};

/*
 * The OneUptime user this account signs in: the one with its email address,
 * or a new one where sign-up is open. Renders the refusal and returns null
 * when there is none to sign in.
 */
const findOrCreateUser: (
  req: ExpressRequest,
  res: ExpressResponse,
  provider: SignInProvider,
  account: ProviderAccount,
  attributionCookie: string | undefined,
) => Promise<ProviderSignInUser | null> = async (
  req: ExpressRequest,
  res: ExpressResponse,
  provider: SignInProvider,
  account: ProviderAccount,
  attributionCookie: string | undefined,
): Promise<ProviderSignInUser | null> => {
  const existing: User | null = await UserService.findOneBy({
    query: { email: account.email },
    select: {
      _id: true,
      name: true,
      email: true,
      isMasterAdmin: true,
      isEmailVerified: true,
      isBlocked: true,
      enableTwoFactorAuth: true,
      timezone: true,
    },
    props: { isRoot: true },
  });

  if (existing) {
    if (existing.isBlocked) {
      renderMessage(
        req,
        res,
        "Account blocked.",
        ExceptionMessages.UserBlocked,
      );
      return null;
    }

    if (existing.enableTwoFactorAuth || existing.isMasterAdmin) {
      renderMessage(
        req,
        res,
        "Please sign in with your password.",
        `This OneUptime account signs in with its email and password, and its second factor where it has one, rather than with ${provider.name}.`,
      );
      return null;
    }

    /*
     * An account nobody has verified may have been registered by someone
     * other than the address's owner, who would still hold its password.
     * Signing the owner into it would share it with them - so, as with every
     * other sign-in, the owner proves the mailbox first (GlobalOIDC does the
     * same).
     */
    if (!existing.isEmailVerified) {
      await AuthenticationEmail.sendVerificationEmail(existing);

      renderMessage(
        req,
        res,
        "Email not verified.",
        "Email is not verified. We have sent you an email with the verification link. Please do not forget to check spam.",
      );
      return null;
    }

    return { user: existing, isNewAccount: false };
  }

  if (await DatabaseConfig.shouldDisableSignup()) {
    renderMessage(
      req,
      res,
      "Sign up is disabled.",
      "Sign up is disabled on this OneUptime server. Please contact your server admin.",
    );
    return null;
  }

  const created: User = await UserService.createByEmail({
    email: account.email,
    name: account.name ? new Name(account.name) : undefined,
    isEmailVerified: true,
    generateRandomPassword: true,
    attribution: Attribution.fromSignInCookie(attributionCookie),
    props: { isRoot: true },
  });

  const user: User | null = await UserService.findOneById({
    id: created.id!,
    select: {
      _id: true,
      name: true,
      email: true,
      isMasterAdmin: true,
      timezone: true,
    },
    props: { isRoot: true },
  });

  return user ? { user: user, isNewAccount: true } : null;
};

/*
 * The two routes of a provider's sign-in, for Identity's Index to mount at
 * /api/identity and /.
 */
const createProviderSignInRouter: (
  provider: SignInProvider,
) => ExpressRouter = (provider: SignInProvider): ExpressRouter => {
  const router: ExpressRouter = Express.getRouter();

  const stateCookieName: string = `oneuptime-${provider.path}-sign-in`;
  const stateCookiePath: string = `/identity/${provider.path}`;

  router.get(
    `/${provider.path}/sign-in`,
    async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
      const client: ProviderSignInClient | null = provider.getClient();

      if (!client) {
        return renderNotOffered(req, res, provider);
      }

      if (await refuseWhileSsoIsRequired(req, res, provider)) {
        return;
      }

      const request: ProviderSignInRequest = client.createSignInRequest();

      // What the callback must match, signed, in a cookie only the callback path sees.
      CookieUtil.setCookie(
        res,
        stateCookieName,
        JSONWebToken.signJsonPayload(
          {
            state: request.state,
            nonce: request.nonce,
            codeVerifier: request.codeVerifier,
          },
          STATE_TTL_IN_SECONDS,
        ),
        {
          path: stateCookiePath,
          maxAge: STATE_TTL_IN_SECONDS * 1000,
          httpOnly: true,
        },
      );

      return res.redirect(request.authorizationUrl);
    },
  );

  router.get(
    `/${provider.path}/callback`,
    async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
      const client: ProviderSignInClient | null = provider.getClient();

      if (!client) {
        return renderNotOffered(req, res, provider);
      }

      const stateCookie: string | undefined =
        CookieUtil.getCookieFromExpressRequest(req, stateCookieName);

      CookieUtil.removeCookie(res, stateCookieName, {
        path: stateCookiePath,
      });

      const attributionCookie: string | undefined =
        CookieUtil.getCookieFromExpressRequest(
          req,
          SignInAttributionCookieName,
        );

      CookieUtil.removeCookie(res, SignInAttributionCookieName, {
        path: SignInAttributionCookiePath,
      });

      // Turned on while this sign-in was at the provider: it finishes nowhere.
      if (await refuseWhileSsoIsRequired(req, res, provider)) {
        return;
      }

      if (typeof req.query["error"] === "string") {
        return renderMessage(
          req,
          res,
          "Sign in was cancelled.",
          `${provider.name} did not sign you in. Please try again, or sign in with your email and password.`,
        );
      }

      let stored: JSONObject;

      try {
        stored = stateCookie ? JSONWebToken.decodeJsonPayload(stateCookie) : {};
      } catch {
        stored = {};
      }

      const code: unknown = req.query["code"];
      const state: unknown = req.query["state"];

      if (
        typeof code !== "string" ||
        typeof state !== "string" ||
        typeof stored["state"] !== "string" ||
        stored["state"] !== state ||
        typeof stored["nonce"] !== "string" ||
        typeof stored["codeVerifier"] !== "string"
      ) {
        return renderMessage(
          req,
          res,
          "Your sign-in expired.",
          `Please start signing in with ${provider.name} again.`,
        );
      }

      try {
        const account: ProviderAccount = await client.completeSignIn({
          code: code,
          codeVerifier: stored["codeVerifier"],
          nonce: stored["nonce"],
        });

        const signIn: ProviderSignInUser | null = await findOrCreateUser(
          req,
          res,
          provider,
          account,
          attributionCookie,
        );

        if (!signIn) {
          // findOrCreateUser has said why.
          return;
        }

        const user: User = signIn.user;

        const sessionMetadata: SessionMetadata =
          await UserSessionService.createSession({
            userId: user.id!,
            isGlobalLogin: true,
            ipAddress: getClientIp(req),
            userAgent: headerValueToString(req.headers["user-agent"]),
            ...extractDeviceInfo(req),
            additionalInfo: { signInMethod: provider.name },
          });

        CookieUtil.setUserCookie({
          expressResponse: res,
          user: user,
          isGlobalLogin: true,
          ...getSessionCookieFields(sessionMetadata),
        });

        logger.info(
          `User signed in with ${provider.name}: ${user.email?.toString()}`,
          getLogAttributesFromRequest(req as RequestLike),
        );

        return res.redirect(
          signIn.isNewAccount
            ? `${DashboardRoute.toString()}?${SignedUpWithQueryParam}=${provider.signedUpWith}`
            : DashboardRoute.toString(),
        );
      } catch (err) {
        logger.error(err, getLogAttributesFromRequest(req as RequestLike));

        return renderMessage(
          req,
          res,
          `We could not sign you in with ${provider.name}.`,
          provider.getUserMessage(err) ||
            "Something went wrong. Please try again, or sign in with your email and password.",
        );
      }
    },
  );

  return router;
};

export default createProviderSignInRouter;
