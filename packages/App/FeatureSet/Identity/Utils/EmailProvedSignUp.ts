import AuthenticationEmail from "./AuthenticationEmail";
import { isWaitingForFirstAccount } from "./FirstAccount";
import SignUpAttempt, { SignUpAttemptKind } from "./SignUpAttempt";
import { AccountsRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { getMaxLengthFromTableColumnType } from "Common/Types/Database/ColumnLength";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import BadDataException from "Common/Types/Exception/BadDataException";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import RequestOrigin from "Common/Types/RequestOrigin";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import EmailVerificationTokenService from "Common/Server/Services/EmailVerificationTokenService";
import MailService from "Common/Server/Services/MailService";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import { PublicMessageSendPermit } from "Common/Server/Utils/RateLimit/PublicMessageRateLimit";
import ServerSendingStatus from "Common/Server/Utils/ServerSending/ServerSendingStatus";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import User from "Common/Models/DatabaseModels/User";

/*
 * A SIGN-UP THAT SAYS NOTHING ABOUT ITS ADDRESS (#9816).
 *
 * POST /identity/signup used to tell whoever typed an address whether it had
 * an account: "An account with ... already exists" for one that had signed
 * up, a "check your email" of its own for an unclaimed invitation, and a new
 * account's answer for the rest - and creating an account took longer than
 * refusing one. Wherever the server can prove an address by email, a sign-up
 * now answers every address alike: "check your email to finish signing up",
 * with a resend credential that names no account
 * (VerificationEmailResendToken.generateForSignUp). It answers before it
 * does anything that depends on the address, so how long it takes says
 * nothing either, and only then acts on the address (actOnAddress):
 *
 *   - no account: one is created, unverified, and its welcome asks to
 *     verify the address - the link is what signs it in;
 *   - an account that has signed up: nothing is created or changed, and its
 *     owner is told someone tried to sign up with their address, with a way
 *     to sign in and to reset the password, and when and from where;
 *   - an account nobody has signed up to yet (an invitation, or a master
 *     admin's Create User): its link to finish setting up.
 *
 * What it did is kept for the credential's day (SignUpAttempt), so the
 * "check your email" page's resend button sends the same email again,
 * alike for every address.
 *
 * WHICH SERVERS PROVE AN ADDRESS BY EMAIL (isProvedByEmail)
 *
 *   - OneUptime Cloud (billing on), always: its accounts have always been
 *     held until their address was verified.
 *   - A self-hosted server, while it can send email - set up, and not known
 *     to fail (ServerSendingStatus.canSendEmailPublicly, what its sign-in
 *     pages are told). A new account there now verifies its address before
 *     it signs in, as it does on Cloud.
 *   - Never the first account of a self-hosted server, which becomes its
 *     admin: there is nobody else to sign in as, and nothing to hide, and
 *     its email is usually set up after it.
 *
 * A self-hosted server that cannot send email signs a new account in at
 * once, as it always has: it has no way to reach the address, so it cannot
 * avoid refusing a taken one as taken. That is documented (the hardening
 * guide), and IdentityRateLimit's sign-up bucket bounds how many addresses
 * a caller can ask about. Setting up email, or turning sign-up off, closes
 * it.
 */
export default class EmailProvedSignUp {
  /*
   * Whether this server proves a sign-up's address by email, and so answers
   * every address alike (see above). A fact about the server, never about an
   * address. A sending status that cannot be read is taken as "cannot send":
   * the sign-up then works as it always has, rather than holding a new
   * account for an email that may never come.
   */
  public static async isProvedByEmail(): Promise<boolean> {
    if (IsBillingEnabled) {
      return true;
    }

    if (await isWaitingForFirstAccount()) {
      return false;
    }

    try {
      return await ServerSendingStatus.canSendEmailPublicly();
    } catch (err) {
      logger.warn(
        "Could not read whether this server can send email; a new account signs in at once.",
      );
      logger.warn(err);
      return false;
    }
  }

  /*
   * What creating the account would refuse the form for - a value longer
   * than its column holds, which the create checks - refused before the
   * answer instead (#9816). The account is made only after the answer, and
   * a refusal then could no longer reach the person who typed it. Asked of
   * every address alike: it reads the form, never the address's account.
   */
  public static assertFitsAnAccount(user: User): void {
    for (const column of user.getTableColumns().columns) {
      const value: unknown = (user as unknown as Record<string, unknown>)[
        column
      ];

      if (value === undefined || value === null) {
        continue;
      }

      const metadata: TableColumnMetadata = user.getTableColumnMetadata(column);

      // A password is held to its own rule, and is hashed before it is stored.
      if (!metadata?.type || metadata.hashed || metadata.encrypted) {
        continue;
      }

      const maxLength: number | undefined = getMaxLengthFromTableColumnType(
        metadata.type,
      );

      if (maxLength !== undefined && value.toString().length > maxLength) {
        throw new BadDataException(
          `${metadata.title || column} can be at most ${maxLength} characters long. Shorten it and try again.`,
        );
      }
    }
  }

  /*
   * What a sign-up does with the address, once it has answered (see above).
   * Never throws: whoever signed up has their answer already, and a
   * failure is logged. What it did is kept for the attempt's resend
   * credential.
   */
  public static async actOnAddress(data: {
    attemptId: string;
    // The account a new sign-up asks for: its address, name and password.
    newUser: User;
    // The account the address already has, if any, as the sign-up read it.
    existingAccount: User | null;
    // The welcome email's verification token, for a new account.
    welcomeToken: ObjectID;
    origin: RequestOrigin;
    // The sign-up's count of emails to the address, given back when none goes.
    permit: PublicMessageSendPermit;
    // A new account is made: what the route does then (its release emails).
    onAccountCreated?: ((account: User) => Promise<void>) | undefined;
  }): Promise<void> {
    try {
      if (!data.existingAccount) {
        await EmailProvedSignUp.createAccount(data);
        return;
      }

      if (data.existingAccount.password) {
        await AuthenticationEmail.sendAccountAlreadyExistsEmail({
          user: data.existingAccount,
          origin: data.origin,
        });

        await SignUpAttempt.record({
          attemptId: data.attemptId,
          userId: data.existingAccount.id!,
          kind: SignUpAttemptKind.ExistingAccount,
        });

        return;
      }

      await AuthenticationEmail.sendCompleteRegistrationEmail({
        userId: data.existingAccount.id!,
        email: data.newUser.email as Email,
      });

      await SignUpAttempt.record({
        attemptId: data.attemptId,
        userId: data.existingAccount.id!,
        kind: SignUpAttemptKind.UnclaimedAccount,
      });
    } catch (err) {
      logger.error(err);
    }
  }

  /*
   * A new account, unverified, and its welcome: the link in it verifies the
   * address, and signing in waits for it (login()). Nothing is created for
   * an account that fails to save, and the address gets its count of
   * emails back.
   */
  private static async createAccount(data: {
    attemptId: string;
    newUser: User;
    welcomeToken: ObjectID;
    permit: PublicMessageSendPermit;
    onAccountCreated?: ((account: User) => Promise<void>) | undefined;
  }): Promise<void> {
    data.newUser.isEmailVerified = false;

    let savedUser: User;

    try {
      savedUser = await UserService.createUserOnSignup({
        user: data.newUser,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      await data.permit.giveBack();
      throw err;
    }

    await EmailProvedSignUp.sendWelcomeEmail({
      account: savedUser,
      name: data.newUser.name,
      token: data.welcomeToken,
    });

    await SignUpAttempt.record({
      attemptId: data.attemptId,
      userId: savedUser.id!,
      kind: SignUpAttemptKind.NewAccount,
    });

    if (data.onAccountCreated) {
      await data.onAccountCreated(savedUser);
    }
  }

  /*
   * The welcome a new account's address is asked to verify with: the token
   * minted before the sign-up answered (so a test-only seam could hand it
   * out), stored for a day, and mailed in its link.
   */
  public static async sendWelcomeEmail(data: {
    account: User;
    name: Name | undefined;
    token: ObjectID;
  }): Promise<void> {
    const emailVerificationToken: EmailVerificationToken =
      new EmailVerificationToken();
    emailVerificationToken.userId = data.account.id as ObjectID;
    emailVerificationToken.email = data.account.email as Email;
    emailVerificationToken.token = data.token;
    emailVerificationToken.expires = OneUptimeDate.getOneDayAfter();

    await EmailVerificationTokenService.create({
      data: emailVerificationToken,
      props: {
        isRoot: true,
      },
    });

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    MailService.sendMail({
      toEmail: data.account.email as Email,
      subject: `Welcome to ${ProductBrandingText.getProductName()}. Please verify your email.`,
      isSubjectLiteral: true,
      templateType: EmailTemplateType.SignupWelcomeEmail,
      vars: {
        name: data.name ? data.name.toString() : "",
        tokenVerifyUrl: new URL(
          httpProtocol,
          host,
          new Route(AccountsRoute.toString()).addRoute(
            "/verify-email/" + data.token.toString(),
          ),
        ).toString(),
        homeUrl: new URL(httpProtocol, host).toString(),
      },
    }).catch((err: Error) => {
      logger.error(err, { userId: data.account.id?.toString() });
    });
  }
}
