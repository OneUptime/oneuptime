import { createHash, randomUUID } from "crypto";
import { AccountsRoute } from "../../../ServiceRoute";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import BadDataException from "../../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import RequestOrigin from "../../../Types/RequestOrigin";
import Timezone from "../../../Types/Timezone";
import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import DatabaseConfig from "../../DatabaseConfig";
import { IsBillingEnabled } from "../../EnvironmentConfig";
import GlobalCache from "../../Infrastructure/GlobalCache";
import EmailVerificationTokenService from "../../Services/EmailVerificationTokenService";
import MailService from "../../Services/MailService";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import RequestOriginUtil, {
  RequestOriginEmailVars,
  UNKNOWN_DEVICE,
} from "../RequestOrigin/RequestOriginUtil";
import ServerSendingStatus from "../ServerSending/ServerSendingStatus";
import { writeInLanguage } from "../ServerTranslation";
import {
  EmailAddressChangedBy,
  getEmailAddressChangerVariables,
} from "../../../Types/Accounts/EmailAddressChangedEmail";
import { DEFAULT_READER_LANGUAGE } from "../../../Types/ReaderLanguage";
import { translationKey, Translator } from "../../../Types/Translator";
import { getUserWritingLanguage } from "../../../Types/UserLanguage";

/*
 * CHANGING YOUR OWN EMAIL ADDRESS SAYS NOTHING ABOUT THE NEW ONE (#9821).
 *
 * A signed-in person's own change of address (PUT /api/user/:id with
 * `email`) used to be written at once, and an address another account uses
 * was refused on the unique index: "A User with this Email already exists".
 * So any signed-in account - on OneUptime Cloud, anybody - could test
 * addresses one by one.
 *
 * Now the change is pending until the new address confirms it
 * (UserService.onBeforeUpdate keeps it in `newUnverifiedTemporaryEmail`),
 * and the request is answered the same whatever the address: the update
 * succeeds, the account's email is unchanged, the page shows the change
 * waiting. Only after the answer, and only in an email to the new address,
 * is what happened said (sendForPendingChange):
 *
 *   - a free address gets a link to confirm it, which swaps the account to it
 *     (Identity's /verify-email);
 *   - an address that already has an account is told so, with nothing
 *     changed, and no link.
 *
 * A master admin changing an address in the Admin Dashboard still changes it
 * at once: they see every account already. So does a change made by the
 * server itself (SCIM, single sign-on).
 *
 * The asking is held to a few changes an hour, for the account and for the
 * new address alike (assertMayAsk), so neither mail nor a list of addresses
 * can be pushed through it; and a server that cannot send email refuses the
 * change with what to do instead, since nothing could confirm it.
 */

// How long the link to confirm a new address works.
export const EMAIL_CHANGE_LINK_EXPIRY_IN_HOURS: number = 24;

// Changes one account may ask for, and one address may be asked for, an hour.
export const EMAIL_CHANGES_PER_HOUR: number = 5;

const WINDOW_IN_SECONDS: number = 60 * 60;

const ACCOUNT_NAMESPACE: string = "email-change-account";
const ADDRESS_NAMESPACE: string = "email-change-address";

export const EMAIL_CHANGE_TOO_MANY_MESSAGE: string =
  "You have asked to change your email address too many times in the last hour. Please try again later.";

export const EMAIL_CHANGE_UNAVAILABLE_MESSAGE: string =
  "Unable to change your email address right now. Please try again shortly.";

export const EMAIL_CHANGE_CANNOT_BE_EMAILED_MESSAGE: string =
  "This server cannot send email yet, so it cannot confirm a new email address. Ask your server's admin to change your email address.";

// An email's subject and the request's rows, written in its reader's language.
interface WrittenInLanguage {
  subject: string;
  origin: Record<string, string>;
}

export default class EmailChangeConfirmation {
  /*
   * Whether this person may ask for a new address now: the server can send
   * the email that confirms it, and neither the account nor the new address
   * has been asked about too often this hour. Counted before anything is
   * looked up, so a refusal is the same whoever has the address. The cache
   * unreachable refuses too: without it nothing bounds the asking.
   */
  public static async assertMayAsk(data: {
    userId: ObjectID;
    newEmail: Email;
  }): Promise<void> {
    await EmailChangeConfirmation.assertCanConfirm();

    /*
     * The account first, and the address only while the account may still
     * ask: a refused account uses up nothing of an address's hour, so it
     * cannot keep somebody else from moving to it.
     */
    let mayAsk: boolean = false;

    try {
      const forAccount: number | null = await GlobalCache.incrementIfBelow(
        ACCOUNT_NAMESPACE,
        data.userId.toString(),
        { expiresInSeconds: WINDOW_IN_SECONDS, limit: EMAIL_CHANGES_PER_HOUR },
      );

      mayAsk =
        forAccount !== null &&
        (await GlobalCache.incrementIfBelow(
          ADDRESS_NAMESPACE,
          EmailChangeConfirmation.addressKey(data.newEmail),
          {
            expiresInSeconds: WINDOW_IN_SECONDS,
            limit: EMAIL_CHANGES_PER_HOUR,
          },
        )) !== null;
    } catch (err) {
      if (err instanceof DatabaseNotConnectedException) {
        throw new ServiceUnavailableException(EMAIL_CHANGE_UNAVAILABLE_MESSAGE);
      }

      throw err;
    }

    if (!mayAsk) {
      throw new TooManyRequestsException(EMAIL_CHANGE_TOO_MANY_MESSAGE);
    }
  }

  /*
   * What a pending change sends, once the request that asked for it has
   * been answered: a link to confirm a free address, or, to an address
   * another account already has, word that it could not be used. `isTaken`
   * is read by the caller after the answer, as this is. Never throws: the
   * person has their answer, and a failure is logged.
   *
   * `linkExpires` is when the link stops working: the moment the held
   * write kept beside the waiting address (User.newUnverifiedTemporaryEmailExpires,
   * #9908), so User Profile says it has expired exactly when it has.
   * EMAIL_CHANGE_LINK_EXPIRY_IN_HOURS from now when left out.
   *
   * Each email in its reader's language and time zone (#10157): the link,
   * in the asking account's (`language`, `timezone`) - a new address is
   * most often its own person's; word that the address is taken, in the
   * language and time zone of the account that has it (`holder`), whose
   * person reads it, whoever asked. Its subject too.
   */
  public static async sendForPendingChange(data: {
    userId: ObjectID;
    newEmail: Email;
    isTaken: boolean;
    origin?: RequestOrigin | undefined;
    timezone?: Timezone | null | undefined;
    language?: string | null | undefined;
    holder?:
      | {
          language?: string | null | undefined;
          timezone?: Timezone | null | undefined;
        }
      | undefined;
    linkExpires?: Date | undefined;
  }): Promise<void> {
    try {
      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
      const homeURL: string = new URL(httpProtocol, host).toString();
      const productName: string = ProductBrandingText.getProductName();

      if (data.isTaken) {
        const language: string = getUserWritingLanguage({
          language: data.holder?.language,
        });
        const written: WrittenInLanguage = EmailChangeConfirmation.writeIn({
          language: language,
          origin: data.origin,
          timezone: data.holder?.timezone,
          subject: (translator: Translator): string => {
            return translator.translateTemplate(
              translationKey("This address already has a {{product}} account"),
              { product: productName },
            );
          },
        });

        await MailService.sendMail({
          toEmail: data.newEmail,
          subject: written.subject,
          isSubjectLiteral: true,
          templateType: EmailTemplateType.EmailChangeAddressTaken,
          vars: {
            signInLink: new URL(
              httpProtocol,
              host,
              new Route(AccountsRoute.toString()).addRoute("/login"),
            ).toString(),
            homeURL: homeURL,
            ...written.origin,
          },
          ...EmailChangeConfirmation.languageOf(language),
        });

        return;
      }

      const language: string = getUserWritingLanguage({
        language: data.language,
      });
      const written: WrittenInLanguage = EmailChangeConfirmation.writeIn({
        language: language,
        origin: data.origin,
        timezone: data.timezone,
        subject: (translator: Translator): string => {
          return translator.translateTemplate(
            translationKey("Confirm your new {{product}} email address"),
            { product: productName },
          );
        },
      });

      // A bearer secret: from the CSPRNG, never a fallback generator.
      const token: ObjectID = new ObjectID(randomUUID());

      const row: EmailVerificationToken = new EmailVerificationToken();
      row.userId = data.userId;
      row.email = data.newEmail;
      row.token = token;
      row.expires =
        data.linkExpires ||
        OneUptimeDate.getSomeHoursAfter(EMAIL_CHANGE_LINK_EXPIRY_IN_HOURS);

      await EmailVerificationTokenService.create({
        data: row,
        props: {
          isRoot: true,
        },
      });

      await MailService.sendMail({
        toEmail: data.newEmail,
        subject: written.subject,
        isSubjectLiteral: true,
        templateType: EmailTemplateType.ConfirmEmailChange,
        vars: {
          tokenVerifyUrl: new URL(
            httpProtocol,
            host,
            new Route(AccountsRoute.toString()).addRoute(
              "/verify-email/" + token.toString(),
            ),
          ).toString(),
          expiresInHours: EMAIL_CHANGE_LINK_EXPIRY_IN_HOURS.toString(),
          homeURL: homeURL,
          ...written.origin,
        },
        ...EmailChangeConfirmation.languageOf(language),
      });
    } catch (err) {
      logger.error(err, { userId: data.userId.toString() });
    }
  }

  /*
   * THE LINK TO AN ADDRESS WRITTEN STRAIGHT AWAY (EmailChanged.hbs).
   *
   * A master admin's change, the organization's identity provider's through
   * SCIM, or another write OneUptime makes moves an account to a new address
   * at once (UserService.onUpdateSuccess); the new address is then proven by
   * a link to it before it signs in. The email says who made the change, by
   * role (Types/Accounts/EmailAddressChangedEmail's changers, as the email
   * to the address the account left names them), and when, in the
   * account's language and time zone (#10157). Its link works for a day.
   *
   * Throws only when the link cannot be made: the caller marks the address
   * unverified once it has one. The email itself is not waited for, and a
   * failure to send it is logged by the account's id.
   */
  public static async sendVerificationOfNewAddress(data: {
    userId: ObjectID;
    newEmail: Email;
    changedBy: EmailAddressChangedBy;
    at?: Date | undefined;
    language?: string | null | undefined;
    timezone?: Timezone | null | undefined;
  }): Promise<void> {
    // A bearer secret: from the CSPRNG, never a fallback generator.
    const token: ObjectID = new ObjectID(randomUUID());

    const row: EmailVerificationToken = new EmailVerificationToken();
    row.userId = data.userId;
    row.email = data.newEmail;
    row.token = token;
    row.expires = OneUptimeDate.getOneDayAfter();

    await EmailVerificationTokenService.create({
      data: row,
      props: {
        isRoot: true,
      },
    });

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
    const productName: string = ProductBrandingText.getProductName();
    const language: string = getUserWritingLanguage({
      language: data.language,
    });
    const written: WrittenInLanguage = EmailChangeConfirmation.writeIn({
      language: language,
      at: data.at,
      timezone: data.timezone,
      subject: (translator: Translator): string => {
        return translator.translateTemplate(
          translationKey(
            "Verify the new email address of your {{product}} account",
          ),
          { product: productName },
        );
      },
    });

    MailService.sendMail({
      toEmail: data.newEmail,
      subject: written.subject,
      isSubjectLiteral: true,
      templateType: EmailTemplateType.EmailChanged,
      vars: {
        tokenVerifyUrl: new URL(
          httpProtocol,
          host,
          new Route(AccountsRoute.toString()).addRoute(
            "/verify-email/" + token.toString(),
          ),
        ).toString(),
        homeUrl: new URL(httpProtocol, host).toString(),
        changedAt: written.origin["requestedAt"] || "",
        ...getEmailAddressChangerVariables(data.changedBy),
      },
      ...EmailChangeConfirmation.languageOf(language),
    }).catch((err: Error) => {
      logger.error(err, { userId: data.userId.toString() });
    });
  }

  /*
   * A subject, the time and the request's rows in `language`, as one piece
   * of work (writeInLanguage writes OneUptime's dates in it while it runs):
   * the request's device, where nobody could name it, in the reader's words.
   */
  private static writeIn(data: {
    language: string;
    origin?: RequestOrigin | undefined;
    at?: Date | undefined;
    timezone?: Timezone | null | undefined;
    subject: (translator: Translator) => string;
  }): WrittenInLanguage {
    return writeInLanguage(
      data.language,
      (translator: Translator): WrittenInLanguage => {
        const origin: RequestOriginEmailVars = RequestOriginUtil.getEmailVars({
          origin: data.origin,
          at: data.at,
          timezone: data.timezone,
        });

        return {
          subject: data.subject(translator),
          origin: {
            ...origin,
            ...(origin.requestDevice === UNKNOWN_DEVICE
              ? {
                  requestDevice:
                    translator.translateText(
                      translationKey("Unknown device"),
                    ) || UNKNOWN_DEVICE,
                }
              : {}),
          } as Record<string, string>,
        };
      },
    );
  }

  // What an email in `language` hands the mail service: nothing for English.
  private static languageOf(language: string): { language?: string } {
    return language === DEFAULT_READER_LANGUAGE ? {} : { language: language };
  }

  /*
   * Refuses a change of address on a server that cannot send the email that
   * confirms it, with what to do instead. Asked before the session is asked
   * to confirm it's its person's (#10155, UserService): nobody confirms for
   * a change that cannot happen.
   */
  public static async assertCanConfirm(): Promise<void> {
    if (!(await EmailChangeConfirmation.canSendEmail())) {
      throw new BadDataException(EMAIL_CHANGE_CANNOT_BE_EMAILED_MESSAGE);
    }
  }

  // Whether the server can send the email that confirms a new address.
  public static async canSendEmail(): Promise<boolean> {
    if (IsBillingEnabled) {
      return true;
    }

    try {
      return await ServerSendingStatus.canSendEmailPublicly();
    } catch (err) {
      logger.warn("Could not read whether this server can send email.");
      logger.warn(err);
      return false;
    }
  }

  // An address as a counter's key: its hash, so no address is kept in the cache.
  private static addressKey(email: Email): string {
    return createHash("sha256")
      .update(email.toString().toLowerCase())
      .digest("hex");
  }
}
