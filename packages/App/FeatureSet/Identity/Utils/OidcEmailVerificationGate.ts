import { respondToMobileSsoFailure } from "./MobileSso";
import OidcEmailVerification, {
  EMAIL_VERIFIED_CLAIM,
  PROVIDER_EMAIL_NOT_VERIFIED_ERROR,
  PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
  PROVIDER_EMAIL_NOT_VERIFIED_TITLE,
  ProviderEmailVerification,
} from "./OidcEmailVerification";
import UserService from "Common/Server/Services/UserService";
import FailedSignInAuditLog from "Common/Server/Utils/AuditLog/FailedSignInAuditLog";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import User from "Common/Models/DatabaseModels/User";
import { SignInFailureReason } from "Common/Types/AuditLog/AuditLogSignInFailure";
import Email from "Common/Types/Email";
import { SessionSignIn } from "Common/Types/UserSession/SessionSignIn";

const MESSAGE_VIEW: string =
  "/usr/src/app/FeatureSet/Identity/Views/Message.ejs";

/*
 * Where an OpenID Connect sign-in that finds or makes an account by its
 * address stops when the provider does not vouch for that address
 * (./OidcEmailVerification says why): the server's own providers'
 * callback (API/GlobalOIDC.ts) and a project's (API/OIDC.ts), each asking
 * right after the provider's answer has verified, before anything else.
 */
export default class OidcEmailVerificationGate {
  /*
   * Answers a sign-in whose provider does not vouch for its address: the
   * page that says what to do, or the mobile app's deep link. Nothing is
   * made, provisioned, emailed or signed in, and the account at the
   * address, when there is one, has the attempt in its audit logs
   * (FailedSignInAuditLog, after the answer). Returns whether it answered:
   * false when the provider vouches for the address, or says nothing of
   * it, and the sign-in goes on.
   */
  public static async refuseUnverifiedAddress(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    isMobileRequest: boolean;
    identity: {
      email: Email;
      emailVerification: ProviderEmailVerification;
    };
    // Which provider, for the server's log: "Global OIDC provider <id>".
    provider: string;
    // How the account's audit logs name the attempt.
    signIn: SessionSignIn;
  }): Promise<boolean> {
    const verification: ProviderEmailVerification =
      data.identity.emailVerification;

    if (!OidcEmailVerification.refusesSignIn(verification)) {
      return false;
    }

    logger.info(
      verification === ProviderEmailVerification.Unverified
        ? `${data.provider} signed nobody in: it says it has not verified the email address it sent (${EMAIL_VERIFIED_CLAIM} is false). Have the identity provider verify its people's addresses, or send ${EMAIL_VERIFIED_CLAIM}: true for the addresses it knows are theirs.`
        : `${data.provider} signed nobody in: its ${EMAIL_VERIFIED_CLAIM} claim is neither true nor false, so OneUptime cannot tell whether it verified the email address it sent. Have the identity provider send ${EMAIL_VERIFIED_CLAIM} as true or false.`,
      getLogAttributesFromRequest(data.req as RequestLike),
    );

    /*
     * Read for every address, whether an account has it or not, and only
     * its id: the answer, and how long it takes, say nothing of the account.
     */
    const account: User | null = await UserService.findOneBy({
      query: { email: data.identity.email },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (account?.id) {
      FailedSignInAuditLog.record({
        req: data.req,
        userId: account.id,
        reason: SignInFailureReason.EmailNotVerified,
        signIn: data.signIn,
      });
    }

    if (
      respondToMobileSsoFailure({
        res: data.res,
        isMobileRequest: data.isMobileRequest,
        error: PROVIDER_EMAIL_NOT_VERIFIED_ERROR,
        errorDescription: PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
      })
    ) {
      return true;
    }

    Response.render(data.req, data.res, MESSAGE_VIEW, {
      title: PROVIDER_EMAIL_NOT_VERIFIED_TITLE,
      message: PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
    });

    return true;
  }
}
