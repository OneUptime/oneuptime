import { AccountsRoute, DashboardRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import EmailVerificationTokenService from "Common/Server/Services/EmailVerificationTokenService";
import MailService from "Common/Server/Services/MailService";
import logger from "Common/Server/Utils/Logger";
import UserRegistrationToken, {
  REGISTRATION_TOKEN_EXPIRY_IN_DAYS,
} from "Common/Server/Utils/UserRegistrationToken";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import User from "Common/Models/DatabaseModels/User";

export default class AuthenticationEmail {
  public static async sendVerificationEmail(user: User): Promise<void> {
    const generatedToken: ObjectID = ObjectID.generate();

    const emailVerificationToken: EmailVerificationToken =
      new EmailVerificationToken();
    emailVerificationToken.userId = user?.id as ObjectID;
    emailVerificationToken.email = user?.email as Email;
    emailVerificationToken.token = generatedToken;
    emailVerificationToken.expires = OneUptimeDate.getOneDayAfter();

    await EmailVerificationTokenService.create({
      data: emailVerificationToken,
      props: {
        isRoot: true,
      },
    });

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    logger.debug("Sending verification email", {
      userId: user.id?.toString(),
      service: "identity",
    });

    MailService.sendMail({
      toEmail: user.email!,
      subject: "Please verify email.",
      templateType: EmailTemplateType.SignupWelcomeEmail,
      vars: {
        name: user.name?.toString() || "",
        tokenVerifyUrl: new URL(
          httpProtocol,
          host,
          new Route(AccountsRoute.toString()).addRoute(
            "/verify-email/" + generatedToken.toString(),
          ),
        ).toString(),
        homeUrl: new URL(httpProtocol, host).toString(),
      },
    })
      .then(() => {
        logger.debug("Verification email sent", {
          userId: user.id?.toString(),
          service: "identity",
        });
      })
      .catch((err: Error) => {
        logger.debug("Error sending verification email", {
          userId: user.id?.toString(),
          service: "identity",
        });
        logger.error(err, { userId: user.id?.toString(), service: "identity" });
      });
  }

  /**
   * Tell a user that one of their two factor backup codes was just spent.
   *
   * THIS IS THE COMPENSATING CONTROL FOR THE WHOLE FEATURE. A backup code
   * turns "password plus a device you are holding" into "password plus a
   * string somebody could have photographed", so the account owner has to
   * learn about it through a channel the person who used the code does not
   * control. That is why this goes to the address on the account rather than
   * being rendered on the page that just signed in: a sign-in the owner did
   * not perform still lands in their inbox.
   *
   * The remaining count is in the mail for the same reason. "You have 2 left"
   * is what turns a vague unease into an action, and a user who reads "9 left"
   * on a sign-in they do not remember knows exactly how far in someone is.
   *
   * Never awaited by the login path, and never allowed to fail it. The user
   * has already proved the password and spent a real code by the time this is
   * called; refusing the session because SMTP is unreachable would lock them
   * out with the notification that says they are not locked out.
   */
  public static async sendTwoFactorBackupCodeUsedEmail(data: {
    user: User;
    remainingCodeCount: number;
  }): Promise<void> {
    if (!data.user.email) {
      return;
    }

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const twoFactorAuthUrl: string = new URL(
      httpProtocol,
      host,
      new Route(DashboardRoute.toString()).addRoute(
        "/user-profile/two-factor-auth",
      ),
    ).toString();

    /*
     * Graded advice rather than one line, because the useful action changes
     * with the number. Somebody with eight codes left needs no prompting;
     * somebody with none is one lost phone away from needing an
     * administrator, and telling them that AFTER it happens is too late.
     */
    let remainingCodeMessage: string =
      "You can see how many codes you have left, and generate a new set, from your user profile.";

    if (data.remainingCodeCount === 0) {
      remainingCodeMessage =
        "<strong>That was your last backup code.</strong> If you lose access to your authenticator app or security key now, you will need an administrator to reset two factor authentication on your account. Generate a new set of backup codes as soon as you sign in.";
    } else if (data.remainingCodeCount <= 3) {
      remainingCodeMessage =
        "You are running low on backup codes. Generate a new set from User Profile &gt; Two Factor Authentication -- doing so replaces every code you are currently holding.";
    }

    await MailService.sendMail({
      toEmail: data.user.email,
      subject: "A backup code was used to sign in to your OneUptime account",
      templateType: EmailTemplateType.TwoFactorBackupCodeUsed,
      vars: {
        signedInAt: OneUptimeDate.getCurrentDateAsFormattedString(),
        remainingCodeCount: data.remainingCodeCount.toString(),
        remainingCodeMessage: remainingCodeMessage,
        twoFactorAuthUrl: twoFactorAuthUrl,
        homeUrl: new URL(httpProtocol, host).toString(),
      },
    });
  }

  /*
   * Sent when someone tries to register an address that already has an
   * unclaimed invitation behind it, without the token that proves they own the
   * mailbox -- an invitation that predates registration tokens, a link that has
   * expired, or somebody who is not the invited person at all.
   *
   * The three cases are deliberately indistinguishable to whoever made the
   * request. This mail is the only thing that goes out, it goes to the invited
   * address rather than to the requester, and the caller is told the same
   * "check your email" either way. That is what makes guessing a colleague's
   * address useless: the link lands in their inbox, not yours.
   */
  public static async sendCompleteRegistrationEmail(data: {
    userId: ObjectID;
    email: Email;
  }): Promise<void> {
    const registrationLink: URL =
      await UserRegistrationToken.generateRegistrationLink({
        userId: data.userId,
        email: data.email,
      });

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    logger.debug("Sending complete-registration email", {
      userId: data.userId.toString(),
      service: "identity",
    });

    /*
     * Awaited, unlike sendVerificationEmail above. The signup handler replies
     * "we have emailed you a link" the moment this returns, and a reply that
     * races the mail it is describing is worse than a slightly slower one.
     */
    try {
      await MailService.sendMail({
        toEmail: data.email,
        subject: "Finish setting up your OneUptime account",
        templateType: EmailTemplateType.CompleteRegistration,
        vars: {
          registrationLink: registrationLink.toString(),
          expiryNote:
            "<strong>Note:</strong> This link expires in " +
            REGISTRATION_TOKEN_EXPIRY_IN_DAYS.toString() +
            " days, and can only be used once.",
          homeUrl: new URL(httpProtocol, host).toString(),
        },
      });
    } catch (err) {
      /*
       * Swallowed on purpose. Surfacing a mail failure here would turn the
       * response into an oracle for whether the address had a pending
       * invitation, which is the thing this whole path exists to hide.
       */
      logger.error(err, {
        userId: data.userId.toString(),
        service: "identity",
      });
    }
  }
}
