import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import DatabaseConfig from "Common/Server/DatabaseConfig";
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
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import MarketplaceConfig from "../MarketplaceConfig";
import VercelMarketplaceAPI from "../Vercel/VercelMarketplaceAPI";
import VercelMarketplaceAuth, {
  VercelAuthError,
  VercelMarketplaceCaller,
} from "../Vercel/VercelMarketplaceAuth";
import VercelMarketplaceSignIn, {
  VercelSignInError,
} from "../Vercel/VercelMarketplaceSignIn";
import Response from "Common/Server/Utils/Response";
import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import User from "Common/Models/DatabaseModels/User";
import AuthenticationEmail from "App/FeatureSet/Identity/Utils/AuthenticationEmail";

/*
 * Sign-in from Vercel - the integration's Redirect Login URL:
 *
 *   GET /identity/vercel/sso?mode=sso&code=...&state=...[&resource_id=...]
 *
 * Vercel sends a person here from "Open in OneUptime", a resource's links
 * and its support link, with a one-time code. The code is exchanged for an
 * ID token Vercel signed (VercelMarketplaceAuth), which names the person,
 * their verified email address, their role in the team and the team's
 * installation. They join the resource's project - or every one of the
 * team's - in the team their role gives them (VercelMarketplaceSignIn), and
 * are signed in to OneUptime.
 *
 * The OneUptime account is the one with that email address, or a new one,
 * under the rules of Sign in with Microsoft: an email address Vercel has
 * not verified is never matched; an account with two-factor authentication,
 * or a master admin's, signs in with its password (they are in the project
 * all the same); an account whose own address was never verified is sent a
 * verification link first.
 *
 * Only on OneUptime Cloud, where the integration's credentials are set.
 */

const router: ExpressRouter = Express.getRouter();

const MESSAGE_VIEW: string =
  "/usr/src/app/FeatureSet/Identity/Views/Message.ejs";
const ACCESS_TOKEN_EXPIRY_SECONDS: number = 15 * 60;

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

const readQuery: (req: ExpressRequest, name: string) => string | undefined = (
  req: ExpressRequest,
  name: string,
): string | undefined => {
  const value: unknown = req.query[name];
  return typeof value === "string" && value ? value : undefined;
};

router.get(
  "/vercel/sso",
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    if (!MarketplaceConfig.isVercelConfigured()) {
      return renderMessage(
        req,
        res,
        "Vercel Marketplace is not available.",
        "This OneUptime server does not sell through Vercel Marketplace. Please sign in with your email and password.",
      );
    }

    const code: string | undefined = readQuery(req, "code");

    if (!code) {
      return renderMessage(
        req,
        res,
        "Open OneUptime from Vercel.",
        "This page is where Vercel sends you when you open OneUptime from your Vercel dashboard. Open the OneUptime integration there and choose Open in OneUptime.",
      );
    }

    let caller: VercelMarketplaceCaller;

    try {
      const idToken: string = await new VercelMarketplaceAPI().exchangeSsoCode({
        code: code,
        state: readQuery(req, "state"),
      });

      caller = await new VercelMarketplaceAuth().verifyToken(
        idToken,
        "id_token",
      );
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));

      return renderMessage(
        req,
        res,
        "Your sign-in from Vercel expired.",
        err instanceof VercelAuthError
          ? "Vercel's sign-in could not be checked. Open OneUptime from your Vercel dashboard again."
          : "We could not reach Vercel to sign you in. Open OneUptime from your Vercel dashboard again in a minute.",
      );
    }

    if (caller.kind !== "user" || !caller.userRole) {
      return renderMessage(
        req,
        res,
        "We could not sign you in.",
        "Vercel did not say who you are. Open OneUptime from your Vercel dashboard again.",
      );
    }

    try {
      const purchases: Array<MarketplaceSubscription> =
        await VercelMarketplaceSignIn.getPurchases({
          caller: caller,
          resourceId: readQuery(req, "resource_id"),
        });

      const user: User | null = await findOrCreateUser(req, res, caller);

      if (!user) {
        // findOrCreateUser has said why.
        return;
      }

      await VercelMarketplaceSignIn.ensureMemberships({
        userId: user.id!,
        role: caller.userRole,
        purchases: purchases,
      });

      // In the project now, but this account signs in with its password (and its second factor).
      if (user.enableTwoFactorAuth || user.isMasterAdmin) {
        return renderMessage(
          req,
          res,
          "Please sign in with your password.",
          "You can open this resource in OneUptime now. This OneUptime account signs in with its email and password, and its second factor where it has one, rather than from Vercel.",
        );
      }

      const sessionMetadata: SessionMetadata =
        await UserSessionService.createSession({
          userId: user.id!,
          isGlobalLogin: true,
          ipAddress: getClientIp(req),
          userAgent: headerValueToString(req.headers["user-agent"]),
          ...extractDeviceInfo(req),
          additionalInfo: { signInMethod: "Vercel" },
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
        `User signed in from Vercel: ${user.email?.toString()}`,
        getLogAttributesFromRequest(req as RequestLike),
      );

      return res.redirect(
        VercelMarketplaceSignIn.getRedirectUrl({
          projectId: purchases[0]!.projectId!,
          request: {
            resourceId: readQuery(req, "resource_id"),
            path: readQuery(req, "path"),
            invoiceId: readQuery(req, "invoice_id"),
            isSupport: readQuery(req, "support") === "true",
          },
        }),
      );
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));

      return renderMessage(
        req,
        res,
        "We could not sign you in from Vercel.",
        err instanceof VercelSignInError
          ? err.userMessage
          : "Something went wrong. Please open OneUptime from your Vercel dashboard again.",
      );
    }
  },
);

/*
 * The OneUptime user this Vercel user signs in as: the one with the
 * verified email address Vercel gave, or a new one where sign-up is open.
 * Renders the refusal and returns null when there is none to sign in.
 */
const findOrCreateUser: (
  req: ExpressRequest,
  res: ExpressResponse,
  caller: VercelMarketplaceCaller,
) => Promise<User | null> = async (
  req: ExpressRequest,
  res: ExpressResponse,
  caller: VercelMarketplaceCaller,
): Promise<User | null> => {
  if (!caller.userEmail || !caller.isUserEmailVerified) {
    renderMessage(
      req,
      res,
      "Verify your email address on Vercel.",
      "OneUptime signs you in with the email address of your Vercel account, once Vercel has verified it. Verify it on Vercel, then open OneUptime again.",
    );
    return null;
  }

  let email: Email;

  try {
    email = new Email(caller.userEmail);
  } catch {
    renderMessage(
      req,
      res,
      "We could not sign you in.",
      "The email address of your Vercel account is not one OneUptime can use.",
    );
    return null;
  }

  const select: Record<string, true> = {
    _id: true,
    name: true,
    email: true,
    isMasterAdmin: true,
    isEmailVerified: true,
    isBlocked: true,
    enableTwoFactorAuth: true,
    timezone: true,
  };

  const existing: User | null = await UserService.findOneBy({
    query: { email: email },
    select: select,
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

    /*
     * An account nobody has verified may have been registered by someone
     * other than the address's owner, who would still hold its password.
     * The owner proves the mailbox first, as with every other sign-in.
     */
    if (!existing.isEmailVerified) {
      await AuthenticationEmail.sendVerificationEmail(existing);

      renderMessage(
        req,
        res,
        "Email not verified.",
        "Email is not verified. We have sent you an email with the verification link. Please do not forget to check spam. Then open OneUptime from Vercel again.",
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
    email: email,
    name: caller.userName ? new Name(caller.userName) : undefined,
    isEmailVerified: true,
    generateRandomPassword: true,
    props: { isRoot: true },
  });

  return await UserService.findOneById({
    id: created.id!,
    select: select,
    props: { isRoot: true },
  });
};

export default router;
