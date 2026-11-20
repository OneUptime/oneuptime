import ProjectSsoSignInConfirmation from "./ProjectSsoSignInConfirmation";
import SignUpInvitationUtil, {
  SignUpInvitationSsoOutcome,
} from "./SignUpInvitation";
import EmailVerificationTokenService from "Common/Server/Services/EmailVerificationTokenService";
import UserService from "Common/Server/Services/UserService";
import InvitationSsoSignInLink from "Common/Server/Utils/TeamMember/InvitationSsoSignInLink";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import User from "Common/Models/DatabaseModels/User";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";

/*
 * AN INVITATION'S SINGLE-USE LINK, AS THE MAILBOX'S CONFIRMATION OF ITS
 * PROJECT'S SINGLE SIGN-ON, FOR SOMEONE WHO HAS SIGNED UP (#10178,
 * Common/Types/Accounts/InvitationSsoSignIn).
 *
 * Someone invited on OneUptime Cloud into a project whose single sign-on
 * manages their sign-in, who has signed up already, follows their
 * invitation's Sign In with SSO to the project's SSO page with a link of
 * their own (InvitationSsoSignInLink), which only their mailbox was sent.
 * Picking one of the project's providers there sends the link here first,
 * and it counts as the confirmation the second email asked for: the link
 * is spent, the invitation into the project accepted, the address verified
 * and the consent recorded - as the sign-up page's link does for someone
 * who had no account yet (#9898, SignUpInvitationUtil.confirmSsoSignIn), and
 * with the same checks (SignUpInvitationUtil.confirmProjectSsoForAccount).
 * The provider's answer then signs them in the first time.
 *
 * Before anything of the account is read:
 *
 *   - this is OneUptime Cloud: a self-hosted server asks no mailbox;
 *   - the request names a token, a signature and a project, each as the
 *     server writes them;
 *   - the signature is the server's, for this purpose, this token and this
 *     project - checked before anything is read, so an ask without the
 *     invited mailbox's link reads nothing at all.
 *
 * Then the link's token is live (there, unspent and unexpired), and the
 * account it was minted for still signs in with the address it was sent to:
 * a link that went to an address the account has since left proves nothing
 * about the account any more. Never throws: the route answers every request
 * alike, and only the server's log says why, by project.
 */

// What a link's signature is written as: an HMAC-SHA256, in lower-case hex.
const SIGNATURE_SHAPE: RegExp = /^[0-9a-f]{64}$/;

export default class InvitationSsoSignIn {
  @CaptureSpan()
  public static async confirm(data: {
    token: unknown;
    signature: unknown;
    projectId: unknown;
  }): Promise<SignUpInvitationSsoOutcome> {
    return await SignUpInvitationUtil.confirmAndLog({
      projectId: data.projectId,
      confirm: () => {
        return InvitationSsoSignIn.confirmOrSayWhyNot(data);
      },
    });
  }

  private static async confirmOrSayWhyNot(data: {
    token: unknown;
    signature: unknown;
    projectId: unknown;
  }): Promise<{
    outcome: SignUpInvitationSsoOutcome;
    userId?: ObjectID | undefined;
    projectId?: ObjectID | undefined;
  }> {
    if (!ProjectSsoSignInConfirmation.isRequired()) {
      return { outcome: SignUpInvitationSsoOutcome.NotNeeded };
    }

    const tokenText: string =
      typeof data.token === "string" ? data.token.trim() : "";
    const signature: string =
      typeof data.signature === "string" ? data.signature.trim() : "";
    const projectIdText: string =
      typeof data.projectId === "string" ? data.projectId.trim() : "";

    if (
      !ObjectID.isValidUUID(tokenText) ||
      !SIGNATURE_SHAPE.test(signature) ||
      !ObjectID.isValidUUID(projectIdText)
    ) {
      return { outcome: SignUpInvitationSsoOutcome.LinkNotAsked };
    }

    // The proof that the link is the server's, for this project: nothing read before it.
    if (
      !InvitationSsoSignInLink.isSignatureValid({
        token: tokenText,
        signature: signature,
        projectId: projectIdText,
      })
    ) {
      return { outcome: SignUpInvitationSsoOutcome.LinkNotSigned };
    }

    const projectId: ObjectID = new ObjectID(projectIdText);

    const link: EmailVerificationToken | null =
      await EmailVerificationTokenService.findOneBy({
        query: {
          token: new ObjectID(tokenText),
        },
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

    if (
      !link?._id ||
      !link.userId ||
      !link.email ||
      !link.expires ||
      OneUptimeDate.hasExpired(link.expires)
    ) {
      return { outcome: SignUpInvitationSsoOutcome.LinkNotLive };
    }

    const user: User | null = await UserService.findOneById({
      id: link.userId,
      select: {
        _id: true,
        email: true,
        isBlocked: true,
        isMasterAdmin: true,
        isEmailVerified: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user?.id) {
      return { outcome: SignUpInvitationSsoOutcome.LinkNotLive };
    }

    // The link proves the mailbox it went to: the account's still, or nothing.
    if (
      !user.email ||
      user.email.toString().toLowerCase() !==
        link.email.toString().toLowerCase()
    ) {
      return { outcome: SignUpInvitationSsoOutcome.AccountMoved };
    }

    const linkRowId: string = link._id;

    return await SignUpInvitationUtil.confirmProjectSsoForAccount({
      user: user,
      projectId: projectId,
      spendLink: async (): Promise<boolean> => {
        return (
          (await EmailVerificationTokenService.deleteOneBy({
            query: {
              _id: linkRowId,
            },
            props: {
              isRoot: true,
            },
          })) === 1
        );
      },
    });
  }
}
