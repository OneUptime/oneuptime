import Redis, { ClientType } from "../../Infrastructure/Redis";
import DatabaseConfig from "../../DatabaseConfig";
import MailService from "../../Services/MailService";
import UserService from "../../Services/UserService";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import RequestOriginUtil, {
  RequestOriginEmailVars,
  UNKNOWN_DEVICE,
} from "../RequestOrigin/RequestOriginUtil";
import { writeInLanguage } from "../ServerTranslation";
import User from "../../../Models/DatabaseModels/User";
import { AccountsRoute } from "../../../ServiceRoute";
import EmptyResponseData from "../../../Types/API/EmptyResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../Types/ObjectID";
import { DEFAULT_READER_LANGUAGE } from "../../../Types/ReaderLanguage";
import RequestOrigin from "../../../Types/RequestOrigin";
import { translationKey, Translator } from "../../../Types/Translator";
import { getUserWritingLanguage } from "../../../Types/UserLanguage";

/*
 * TELLING THE OWNER THAT A SESSION OF THEIRS WAS SIGNED OUT FOR GETTING
 * CONFIRM IT'S YOU WRONG TOO OFTEN (#10218).
 *
 * A session that gets Confirm It's You wrong REAUTHENTICATION_FAILURES_
 * BEFORE_SIGN_OUT times - a wrong password, code, backup code, security key
 * or passkey - is signed out (Utils/Reauthentication, SessionEndCause.
 * ReauthenticationFailed). The account's sign-in is never locked, so its
 * owner is never shut out; but five wrong passwords from a session that is
 * already signed in is about the clearest sign there is that somebody else
 * holds it. So the owner is told, at the address on the account, read here:
 *
 *   - that a session of their account was signed out after too many wrong
 *     attempts to confirm it was them, and when;
 *   - from which address, place and device the attempt that ended it came;
 *   - that the account is not locked;
 *   - what to do if it was not them: a new password, which signs every
 *     device out (the reset link, for an account with a password), or their
 *     organization's admin, for one that signs in through single sign-on.
 *
 * In the language on the account, with the time in its own time zone.
 *
 * NEVER A FLOOD. One email per session signed out - the sign-out sends it
 * only when it ended a live session - never one per attempt; and at most
 * SIGNED_OUT_EMAILS_PER_DAY a day for the account, however many sessions
 * somebody signs in and gets ended, counted in Valkey. Past that, the
 * owner has been told, and their inbox is not filled: the sign-outs go on,
 * and are logged. A count that cannot be read lets the email through - a
 * security notice is worth more than one more email.
 *
 * NEVER IN THE SIGN-OUT'S WAY. The session has ended, and its answer goes
 * back before this is done: the caller does not wait for it, and nothing
 * here throws. A failure is logged by the account's id, never its address.
 */

// At most this many of these emails, for one account, in a day.
export const SIGNED_OUT_EMAILS_PER_DAY: number = 3;

const SIGNED_OUT_EMAILS_KEPT_FOR_SECONDS: number = 24 * 60 * 60;

const SIGNED_OUT_EMAILS_KEY_PREFIX: string =
  "reauthentication:signed-out-emails:";

// How long the email may take to reach the mail service before it is given up.
export const SIGNED_OUT_EMAIL_TIMEOUT_IN_MS: number = 30 * 1000;

// One more email for the account, and the count: the expiry is set by the first only.
const COUNT_EMAIL_SCRIPT: string =
  "local count = redis.call('INCR', KEYS[1]); " +
  "if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; " +
  "return count";

export const SIGNED_OUT_SUBJECT: string = translationKey(
  "A session of your {{product}} account was signed out",
);

// The session that was signed out, and the request that ended it.
export interface SignedOutEmailEvent {
  userId: ObjectID;
  // The request with the attempt that ended it: where it came from.
  origin?: RequestOrigin | undefined;
  // When it was signed out; now, when left out.
  at?: Date | undefined;
}

export default class ReauthenticationSignedOutEmail {
  /*
   * After a session was signed out for too many wrong attempts: the email,
   * unless the account has had SIGNED_OUT_EMAILS_PER_DAY of them today. True
   * once the mail service has taken it. Never rejects; the caller does not
   * wait for it.
   */
  public static async notify(event: SignedOutEmailEvent): Promise<boolean> {
    try {
      if (!(await ReauthenticationSignedOutEmail.isWithinDailyLimit(event))) {
        logger.info(
          `A session of user ${event.userId.toString()} was signed out after too many wrong attempts to confirm it was theirs; they were emailed about it ${SIGNED_OUT_EMAILS_PER_DAY} times today already, so they are not emailed again.`,
        );
        return false;
      }

      return await ReauthenticationSignedOutEmail.send(event);
    } catch (err) {
      logger.error(err);
      return false;
    }
  }

  /*
   * Whether the account may be sent one more of these today: counted in
   * Valkey, for SIGNED_OUT_EMAILS_KEPT_FOR_SECONDS from the first. True when
   * the count cannot be read.
   */
  public static async isWithinDailyLimit(
    event: SignedOutEmailEvent,
  ): Promise<boolean> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return true;
    }

    try {
      const count: unknown = await client.eval(
        COUNT_EMAIL_SCRIPT,
        1,
        ReauthenticationSignedOutEmail.getCountKey(event.userId),
        String(SIGNED_OUT_EMAILS_KEPT_FOR_SECONDS),
      );

      return typeof count !== "number" || count <= SIGNED_OUT_EMAILS_PER_DAY;
    } catch (err) {
      logger.warn(
        "Reauthentication: could not count the emails about signed-out sessions.",
      );
      logger.warn(err);
      return true;
    }
  }

  // The email itself. True once the mail service has taken it. Never throws.
  public static async send(event: SignedOutEmailEvent): Promise<boolean> {
    const userId: string = event?.userId?.toString() || "unknown";

    try {
      const user: User | null = await UserService.findOneById({
        id: event.userId,
        select: {
          _id: true,
          email: true,
          timezone: true,
          language: true,
          password: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!user || !user.email) {
        return false;
      }

      const language: string = getUserWritingLanguage(user);
      const productName: string = ProductBrandingText.getProductName();

      // The subject, the time and the device in the reader's language.
      const written: { subject: string; origin: RequestOriginEmailVars } =
        writeInLanguage(
          language,
          (
            translator: Translator,
          ): { subject: string; origin: RequestOriginEmailVars } => {
            const origin: RequestOriginEmailVars =
              RequestOriginUtil.getEmailVars({
                origin: event.origin,
                at: event.at,
                timezone: user.timezone,
              });

            return {
              subject: translator.translateTemplate(SIGNED_OUT_SUBJECT, {
                product: productName,
              }),
              origin: {
                ...origin,
                // The one device name that is OneUptime's own words.
                requestDevice:
                  origin.requestDevice === UNKNOWN_DEVICE
                    ? translator.translateText(
                        translationKey("Unknown device"),
                      ) || UNKNOWN_DEVICE
                    : origin.requestDevice,
              },
            };
          },
        );

      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      const response: HTTPResponse<EmptyResponseData> | HTTPErrorResponse =
        await MailService.sendMail(
          {
            toEmail: user.email,
            subject: written.subject,
            isSubjectLiteral: true,
            templateType: EmailTemplateType.ReauthenticationSignedOut,
            vars: {
              signedOutAt: written.origin.requestedAt,
              hasPassword: user.password ? "true" : "",
              forgotPasswordUrl: new URL(
                httpProtocol,
                host,
                new Route(AccountsRoute.toString()).addRoute(
                  "/forgot-password",
                ),
              ).toString(),
              homeURL: new URL(httpProtocol, host).toString(),
              // Which address, place and device the attempt that ended it came from.
              ...written.origin,
            },
            ...(language === DEFAULT_READER_LANGUAGE
              ? {}
              : { language: language }),
          },
          {
            userId: event.userId,
            timeoutInMs: SIGNED_OUT_EMAIL_TIMEOUT_IN_MS,
          },
        );

      if (response instanceof HTTPErrorResponse) {
        logger.error(
          `The email saying a session was signed out was not sent to user ${userId}: the mail service refused it (${response.statusCode}).`,
        );
        return false;
      }

      return true;
    } catch (err) {
      logger.error(
        `The email saying a session was signed out was not sent to user ${userId}.`,
      );
      logger.error(err);
      return false;
    }
  }

  public static getCountKey(userId: ObjectID): string {
    return `${SIGNED_OUT_EMAILS_KEY_PREFIX}${userId.toString().toLowerCase()}`;
  }
}
