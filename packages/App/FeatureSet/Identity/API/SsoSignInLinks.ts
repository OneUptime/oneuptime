import CredentialGuard from "../Utils/CredentialGuard";
import SsoSignInLinksEmail from "../Utils/SsoSignInLinksEmail";
import { SSO_SIGN_IN_LINKS_CANNOT_BE_EMAILED_MESSAGE } from "Common/Types/Accounts/SsoSignInLinks";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import CaptchaUtil from "Common/Server/Utils/Captcha";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  getClientIp,
} from "Common/Server/Utils/Express";
import PublicMessageRateLimit, {
  PublicMessageKind,
} from "Common/Server/Utils/RateLimit/PublicMessageRateLimit";
import RequestOriginUtil from "Common/Server/Utils/RequestOrigin/RequestOriginUtil";
import Response from "Common/Server/Utils/Response";
import ServerSendingStatus from "Common/Server/Utils/ServerSending/ServerSendingStatus";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "Common/Models/DatabaseModels/User";

/*
 * POST /identity/send-sso-sign-in-links -- email an address the SSO sign-in
 * links of the organizations its account belongs to (#9987,
 * Common/Types/Accounts/SsoSignInLinks), for somebody "Sign in with SSO"
 * found no provider for: a contractor at gmail.com in Acme's project.
 *
 * Every address is answered alike - the same empty success, with the same
 * status, after the same work - whether or not it has an account, is
 * blocked or an administrator's, or is in an organization that signs in
 * with SSO:
 *
 *   - the captcha, where it is on, is asked first, as on /send-magic-link:
 *     this route mails an address its caller names;
 *   - a server that cannot send email says so to anyone: a fact of the
 *     server, asked before any address is looked at;
 *   - the request is counted per caller and per address
 *     (PublicMessageRateLimit, SsoSignInLinks) and refused when either has
 *     had enough - counted whether or not anything will be sent, and never
 *     given back, so a refusal says nothing either;
 *   - nothing is looked up while the request waits. The account, its
 *     projects and their providers are read after the answer, in the
 *     background (SsoSignInLinksEmail.sendInBackground, never awaited), and
 *     the email goes out from there when there is one to send, so how long
 *     the answer takes says nothing about the address.
 *
 * Of no one product: how a person signs in.
 */

const router: ExpressRouter = Express.getRouter();

// Written out, as the route guards read it: SEND_SSO_SIGN_IN_LINKS_ROUTE.
router.post(
  "/send-sso-sign-in-links",
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

      CredentialGuard.assertPresent(user.email, "Email");

      if (await ServerSendingStatus.isEmailKnownNotSetUp()) {
        throw new BadDataException(SSO_SIGN_IN_LINKS_CANNOT_BE_EMAILED_MESSAGE);
      }

      /*
       * Counted before anything is looked up, whether or not the address
       * has an account, so a refusal says nothing about one.
       */
      await PublicMessageRateLimit.assertMaySend({
        req: req,
        kind: PublicMessageKind.SsoSignInLinks,
        contacts: [PublicMessageRateLimit.forEmail(user.email!)],
      });

      /*
       * The answer does not wait: the lookups and the email happen after
       * it, the same answer for every address. Never rejects.
       */
      void SsoSignInLinksEmail.sendInBackground({
        email: user.email!,
        origin: RequestOriginUtil.fromRequest(req),
      });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      // A request refused for its rate limits says when to come back.
      PublicMessageRateLimit.setRetryAfterFor(res, err);
      return next(err);
    }
  },
);

export default router;
