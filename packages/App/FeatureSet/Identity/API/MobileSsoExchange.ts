import { MobileSsoSignIn } from "Common/Types/SSO/MobileSsoHandOff";
import IdentityRateLimit, {
  IdentityRateLimitBucket,
} from "Common/Server/Middleware/IdentityRateLimit";
import MobileSsoHandOffService from "Common/Server/Services/MobileSsoHandOffService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

/*
 * POST /identity/mobile-sso-exchange (#9989): the mobile app redeems the
 * one-time code an SSO sign-in handed back on its deep link, with the PKCE
 * code verifier whose SHA-256 it sent when the sign-in started, and the state
 * it started it with (Common/Server/Services/MobileSsoHandOffService). The
 * answer is the sign-in the code stands for - the session's tokens, the
 * person, and the SSO token of the project or the server - the very values
 * the deep link carried before.
 *
 * Nobody is signed in to ask, and nothing here proves anything but the code:
 * the session was made, and every check of the person and the provider run,
 * when the provider answered. A code works once, within two minutes, and
 * only with its verifier; every other answer is the same 400 with the same
 * words - whether the code was never one, has expired, was redeemed already
 * or came with another verifier or state.
 *
 * Its own rate-limit bucket bounds the work (IdentityRateLimit's
 * MOBILE_SSO_EXCHANGE_BUCKET). Never cached: the answer is a session.
 */

const router: ExpressRouter = Express.getRouter();

const mobileSsoExchangeRateLimit: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> = IdentityRateLimit.getMiddleware(
  IdentityRateLimitBucket.MobileSsoExchange,
);

router.post(
  "/mobile-sso-exchange",
  mobileSsoExchangeRateLimit,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    Response.setNoCacheHeaders(res);

    try {
      const signIn: MobileSsoSignIn =
        await MobileSsoHandOffService.exchangeAuthorizationCode(req.body);

      return Response.sendJsonObjectResponse(req, res, {
        accessToken: signIn.accessToken,
        refreshToken: signIn.refreshToken,
        refreshTokenExpiresAt: signIn.refreshTokenExpiresAt,
        userId: signIn.userId,
        email: signIn.email,
        name: signIn.name,
        isMasterAdmin: signIn.isMasterAdmin,
        ...(signIn.globalSsoToken
          ? { globalSsoToken: signIn.globalSsoToken }
          : {}),
        ...(signIn.ssoToken && signIn.projectId
          ? { ssoToken: signIn.ssoToken, projectId: signIn.projectId }
          : {}),
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
