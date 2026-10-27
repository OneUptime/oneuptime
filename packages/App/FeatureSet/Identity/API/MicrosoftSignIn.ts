import { DashboardRoute } from "Common/ServiceRoute";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { SSO_REQUIRED_SIGN_IN_MESSAGE } from "Common/Types/SSO/SignInMethods";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import {
  Host,
  HttpProtocol,
  MicrosoftSignInClientId,
  MicrosoftSignInClientSecret,
} from "Common/Server/EnvironmentConfig";
import UserService from "Common/Server/Services/UserService";
import UserSessionService, {
  SessionMetadata,
} from "Common/Server/Services/UserSessionService";
import CookieUtil from "Common/Server/Utils/Cookie";
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
import MicrosoftSignInClient, {
  MicrosoftIdentity,
  MicrosoftSignInError,
  MicrosoftSignInRequest,
} from "Common/Server/Utils/MicrosoftSignIn/MicrosoftSignInClient";
import Response from "Common/Server/Utils/Response";
import SsoRequiredSignIn from "Common/Server/Utils/SsoRequiredSignIn";
import User from "Common/Models/DatabaseModels/User";
import AuthenticationEmail from "../Utils/AuthenticationEmail";

/*
 * Sign in with Microsoft (see MicrosoftSignInClient for what it is, and who
 * it will and will not sign in):
 *
 *   GET /identity/microsoft/sign-in    sends the browser to Microsoft
 *   GET /identity/microsoft/callback   where Microsoft sends it back
 *
 * Offered when this server has a Microsoft Entra app for it
 * (MICROSOFT_SIGN_IN_CLIENT_ID / _SECRET). The sign-in page shows the button
 * then, and Microsoft Marketplace buyers who are not signed in are sent
 * straight here from the landing page.
 *
 * A Microsoft account signs in the OneUptime user with the same - verified -
 * email address, or makes one where sign-up is open. It is an ordinary
 * sign-in, like a password: a project that requires its own SSO still
 * requires it. Two kinds of account never sign in this way and are asked for
 * their password instead: one with two-factor authentication turned on,
 * whose second factor this would skip, and a master admin's. An account
 * whose address was never verified is sent a verification link first.
 *
 * Like every sign-in, it ends on the dashboard, which sends a buyer with a
 * marketplace purchase waiting back to the purchase page.
 */

const router: ExpressRouter = Express.getRouter();

const MESSAGE_VIEW: string =
  "/usr/src/app/FeatureSet/Identity/Views/Message.ejs";
const STATE_COOKIE_NAME: string = "oneuptime-microsoft-sign-in";
const STATE_COOKIE_PATH: string = "/identity/microsoft";
const STATE_TTL_IN_SECONDS: number = 10 * 60;
const ACCESS_TOKEN_EXPIRY_SECONDS: number = 15 * 60;

const getClient: () => MicrosoftSignInClient | null =
  (): MicrosoftSignInClient | null => {
    if (!MicrosoftSignInClientId || !MicrosoftSignInClientSecret) {
      return null;
    }

    return new MicrosoftSignInClient({
      clientId: MicrosoftSignInClientId,
      clientSecret: MicrosoftSignInClientSecret,
      redirectUri: `${HttpProtocol}${Host}/identity/microsoft/callback`,
    });
  };

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
 * Sign in with Microsoft is not SSO, and no master admin signs in this way
 * (they are asked for their password), so while the whole server requires
 * SSO it signs nobody in (SsoRequiredSignIn). A requirement that cannot be
 * read signs nobody in either.
 */
const refuseWhileSsoIsRequired: (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<boolean> = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<boolean> => {
  let isSsoRequired: boolean;

  try {
    isSsoRequired = await SsoRequiredSignIn.isSsoRequired();
  } catch (err) {
    logger.error(err, getLogAttributesFromRequest(req as RequestLike));

    renderMessage(
      req,
      res,
      "We could not sign you in with Microsoft.",
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

router.get(
  "/microsoft/sign-in",
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const client: MicrosoftSignInClient | null = getClient();

    if (!client) {
      return renderMessage(
        req,
        res,
        "Sign in with Microsoft is not available.",
        "This OneUptime server does not offer Sign in with Microsoft. Please sign in with your email and password.",
      );
    }

    if (await refuseWhileSsoIsRequired(req, res)) {
      return;
    }

    const request: MicrosoftSignInRequest = client.createSignInRequest();

    // What the callback must match, signed, in a cookie only the callback path sees.
    CookieUtil.setCookie(
      res,
      STATE_COOKIE_NAME,
      JSONWebToken.signJsonPayload(
        {
          state: request.state,
          nonce: request.nonce,
          codeVerifier: request.codeVerifier,
        },
        STATE_TTL_IN_SECONDS,
      ),
      {
        path: STATE_COOKIE_PATH,
        maxAge: STATE_TTL_IN_SECONDS * 1000,
        httpOnly: true,
      },
    );

    return res.redirect(request.authorizationUrl);
  },
);

router.get(
  "/microsoft/callback",
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const client: MicrosoftSignInClient | null = getClient();

    if (!client) {
      return renderMessage(
        req,
        res,
        "Sign in with Microsoft is not available.",
        "This OneUptime server does not offer Sign in with Microsoft. Please sign in with your email and password.",
      );
    }

    const stateCookie: string | undefined =
      CookieUtil.getCookieFromExpressRequest(req, STATE_COOKIE_NAME);

    CookieUtil.removeCookie(res, STATE_COOKIE_NAME, {
      path: STATE_COOKIE_PATH,
    });

    // Turned on while this sign-in was at Microsoft: it finishes nowhere.
    if (await refuseWhileSsoIsRequired(req, res)) {
      return;
    }

    if (typeof req.query["error"] === "string") {
      return renderMessage(
        req,
        res,
        "Sign in was cancelled.",
        "Microsoft did not sign you in. Please try again, or sign in with your email and password.",
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
        "Please start signing in with Microsoft again.",
      );
    }

    try {
      const identity: MicrosoftIdentity = await client.completeSignIn({
        code: code,
        codeVerifier: stored["codeVerifier"],
        nonce: stored["nonce"],
      });

      const user: User | null = await findOrCreateUser(req, res, identity);

      if (!user) {
        // findOrCreateUser has said why.
        return;
      }

      const sessionMetadata: SessionMetadata =
        await UserSessionService.createSession({
          userId: user.id!,
          isGlobalLogin: true,
          ipAddress: getClientIp(req),
          userAgent: headerValueToString(req.headers["user-agent"]),
          ...extractDeviceInfo(req),
          additionalInfo: { signInMethod: "Microsoft" },
        });

      CookieUtil.setUserCookie({
        expressResponse: res,
        user: user,
        isGlobalLogin: true,
        sessionId: sessionMetadata.session.id!,
        refreshToken: sessionMetadata.refreshToken,
        refreshTokenExpiresAt: sessionMetadata.refreshTokenExpiresAt,
        accessTokenExpiresInSeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
      });

      logger.info(
        `User signed in with Microsoft: ${user.email?.toString()}`,
        getLogAttributesFromRequest(req as RequestLike),
      );

      return res.redirect(DashboardRoute.toString());
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));

      return renderMessage(
        req,
        res,
        "We could not sign you in with Microsoft.",
        err instanceof MicrosoftSignInError
          ? err.userMessage
          : "Something went wrong. Please try again, or sign in with your email and password.",
      );
    }
  },
);

/*
 * The OneUptime user this Microsoft account signs in: the one with its email
 * address, or a new one where sign-up is open. Renders the refusal and
 * returns null when there is none to sign in.
 */
const findOrCreateUser: (
  req: ExpressRequest,
  res: ExpressResponse,
  identity: MicrosoftIdentity,
) => Promise<User | null> = async (
  req: ExpressRequest,
  res: ExpressResponse,
  identity: MicrosoftIdentity,
): Promise<User | null> => {
  const existing: User | null = await UserService.findOneBy({
    query: { email: identity.email },
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
        "This OneUptime account signs in with its email and password, and its second factor where it has one, rather than with Microsoft.",
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

    return existing;
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
    email: identity.email,
    name: identity.name ? new Name(identity.name) : undefined,
    isEmailVerified: true,
    generateRandomPassword: true,
    props: { isRoot: true },
  });

  return await UserService.findOneById({
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
};

export default router;
