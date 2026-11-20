import EmptyResponseData from "../../Types/API/EmptyResponse";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import OneUptimeDate from "../../Types/Date";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import ObjectID from "../../Types/ObjectID";
import { DEFAULT_READER_LANGUAGE } from "../../Types/ReaderLanguage";
import RequestOrigin from "../../Types/RequestOrigin";
import { translationKey, Translator } from "../../Types/Translator";
import { getUserWritingLanguage } from "../../Types/UserLanguage";
import { DashboardRoute } from "../../ServiceRoute";
import User from "../../Models/DatabaseModels/User";
import DatabaseConfig from "../DatabaseConfig";
import MailService from "../Services/MailService";
import UserTwoFactorBackupCodeService from "../Services/UserTwoFactorBackupCodeService";
import ProductBrandingText from "./ProductBrandingText";
import RequestOriginUtil, {
  RequestOriginEmailVars,
  UNKNOWN_DEVICE,
} from "./RequestOrigin/RequestOriginUtil";
import { writeInLanguage } from "./ServerTranslation";
import UserService from "../Services/UserService";
import logger from "./Logger";

/*
 * WHAT A SPENT BACKUP CODE WAS USED FOR (#10219), for the email that tells
 * the account's owner: to sign in (the sign-in's second step), or to
 * confirm it was them before a change to how they sign in (Confirm It's
 * You, Utils/Reauthentication). Either spends the code just the same.
 */
export enum BackupCodeUse {
  SignIn = "SignIn",
  ConfirmItsYou = "ConfirmItsYou",
}

// How few codes left the email calls running low.
export const BACKUP_CODES_RUNNING_LOW_AT: number = 3;

// How long the email may take to reach the mail service before it is given up.
export const BACKUP_CODE_USED_EMAIL_TIMEOUT_IN_MS: number = 30 * 1000;

// The email's subject, for each use, with the product's name.
export const BACKUP_CODE_USED_SUBJECTS: Record<BackupCodeUse, string> = {
  [BackupCodeUse.SignIn]: translationKey(
    "A backup code was used to sign in to your {{product}} account",
  ),
  [BackupCodeUse.ConfirmItsYou]: translationKey(
    "A backup code was used to confirm it's you in your {{product}} account",
  ),
};

// What the email is sent with: the account, the code's use, and where it came from.
export interface BackupCodeUsedEmailEvent {
  userId: ObjectID;
  // Unused codes left once this one was spent.
  remainingCodeCount: number;
  usedFor: BackupCodeUse;
  // The request that spent it: where it came from.
  origin?: RequestOrigin | undefined;
  // When it was spent; now, when left out.
  at?: Date | undefined;
}

/**
 * Tell the account holder, at their own address, that a set of recovery codes
 * was just created for them.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Backup codes are sign-in credentials. The self-service regenerate route has
 * always mailed the owner when a set changed -- not to prevent anything, but
 * so that a change the owner did not make is VISIBLE to them, at an address
 * rather than in the browser that made it. Enrolment now mints codes too, and
 * it mints them on a route authenticated by a session alone: somebody holding
 * a stolen session can register a security key of their own and walk away with
 * ten recovery codes for an account they do not own. Without this mail the
 * real owner finds out at the sign-in they cannot complete.
 *
 * NOTHING SENSITIVE TRAVELS. The codes themselves are never mailed -- a count
 * and a timestamp, and a link to the page where the owner can replace the set.
 * Mailing a recovery credential would hand the account to whoever later reads
 * the mailbox, which is exactly the second factor's job to prevent.
 *
 * NEVER FATAL. Every caller invokes this without awaiting it. The codes are
 * already written and already on their way to the user's screen by the time it
 * runs, so an unreachable mail server must not fail the request that carries
 * the only copy of them.
 */
export default class TwoFactorBackupCodeNotification {
  public static async sendCodesCreatedEmail(data: {
    userId: ObjectID;
    codeCount: number;
    // The request that set the second factor up: where it came from.
    origin?: RequestOrigin | undefined;
  }): Promise<void> {
    /*
     * The address is read off the account rather than taken from the caller.
     * The caller proved which user they are; it did not prove where that
     * user's mail should go, and this notice is worth nothing if it can be
     * pointed somewhere else.
     */
    const user: User | null = await UserService.findOneById({
      id: data.userId,
      select: {
        email: true,
        timezone: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user || !user.email) {
      return;
    }

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    await MailService.sendMail({
      toEmail: user.email,
      subject: `Backup codes were created for your ${ProductBrandingText.getProductName()} account`,
      isSubjectLiteral: true,
      templateType: EmailTemplateType.TwoFactorBackupCodesCreated,
      vars: {
        generatedAt: OneUptimeDate.getCurrentDateAsFormattedString(),
        newCodeCount: data.codeCount.toString(),
        twoFactorAuthUrl: new URL(
          httpProtocol,
          host,
          new Route(DashboardRoute.toString()).addRoute(
            "/user-profile/two-factor-auth",
          ),
        ).toString(),
        homeUrl: new URL(httpProtocol, host).toString(),
        /*
         * Which address, place and device set the second factor up: a
         * stolen session can, and this is how the owner tells.
         */
        ...RequestOriginUtil.getEmailVars({
          origin: data.origin,
          timezone: user.timezone,
        }),
      },
    });
  }

  /**
   * Fire-and-forget wrapper, so a caller does not have to repeat the same
   * detached-and-logged shape at every mint site.
   *
   * Deliberately returns void rather than the promise: a caller holding one
   * would be tempted to await it, and awaiting is the thing this must never
   * do. The mint sites run inside requests whose response carries the only
   * copy of the codes.
   */
  public static notifyCodesCreated(data: {
    userId: ObjectID;
    codeCount: number;
    origin?: RequestOrigin | undefined;
  }): void {
    TwoFactorBackupCodeNotification.sendCodesCreatedEmail(data).catch(
      (err: Error) => {
        logger.error(err);
      },
    );
  }

  /*
   * TELLING THE OWNER THAT ONE OF THEIR BACKUP CODES WAS SPENT (#10219).
   *
   * A backup code turns "password plus a device you are holding" into
   * "password plus a string somebody could have photographed", so whoever
   * spends one, the owner hears of it through a channel the spender does not
   * control: the address on the account, read here, never one a caller
   * names. Sent for both uses (BackupCodeUse) - a sign-in's second step, and
   * Confirm It's You before a change to how they sign in, which spends the
   * code just the same - and says which, with how many codes are left, what
   * to do about that, when, and from which address, place and device.
   *
   * In the language on the account, with the time in its own time zone, as
   * the other account emails are. One email per code spent: a code works
   * once, so there are never more of these than the account had codes, and
   * a wrong code sends nothing.
   *
   * True once the mail service has taken it; false when it was not sent - no
   * account, no address, or a failure, logged by the account's id and never
   * by its address. Never throws.
   */
  public static async sendCodeUsedEmail(
    event: BackupCodeUsedEmailEvent,
  ): Promise<boolean> {
    const userId: string = event?.userId?.toString() || "unknown";

    try {
      const user: User | null = await UserService.findOneById({
        id: event.userId,
        select: {
          _id: true,
          email: true,
          timezone: true,
          language: true,
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
              subject: translator.translateTemplate(
                BACKUP_CODE_USED_SUBJECTS[event.usedFor] ||
                  BACKUP_CODE_USED_SUBJECTS[BackupCodeUse.SignIn],
                { product: productName },
              ),
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
      const remaining: number = Math.max(0, event.remainingCodeCount);

      const response: HTTPResponse<EmptyResponseData> | HTTPErrorResponse =
        await MailService.sendMail(
          {
            toEmail: user.email,
            subject: written.subject,
            isSubjectLiteral: true,
            templateType: EmailTemplateType.TwoFactorBackupCodeUsed,
            vars: {
              usedAt: written.origin.requestedAt,
              usedToConfirmItsYou:
                event.usedFor === BackupCodeUse.ConfirmItsYou ? "true" : "",
              remainingCodeCount: remaining.toString(),
              isLastCode: remaining === 0 ? "true" : "",
              isRunningLow:
                remaining > 0 && remaining <= BACKUP_CODES_RUNNING_LOW_AT
                  ? "true"
                  : "",
              twoFactorAuthUrl: new URL(
                httpProtocol,
                host,
                new Route(DashboardRoute.toString()).addRoute(
                  "/user-profile/two-factor-auth",
                ),
              ).toString(),
              homeUrl: new URL(httpProtocol, host).toString(),
              // Which address, place and device the code was spent from.
              ...written.origin,
            },
            ...(language === DEFAULT_READER_LANGUAGE
              ? {}
              : { language: language }),
          },
          {
            userId: event.userId,
            timeoutInMs: BACKUP_CODE_USED_EMAIL_TIMEOUT_IN_MS,
          },
        );

      if (response instanceof HTTPErrorResponse) {
        logger.error(
          `The email saying a backup code was used was not sent to user ${userId}: the mail service refused it (${response.statusCode}).`,
        );
        return false;
      }

      return true;
    } catch (err) {
      logger.error(
        `The email saying a backup code was used was not sent to user ${userId}.`,
      );
      logger.error(err);
      return false;
    }
  }

  /*
   * After a code was spent: counts what is left, then sends the email, in
   * the background (#10219). Returns the promise for tests; the caller -
   * Confirm It's You, whose answer must not wait on a mail server - does
   * not await it, and nothing in it rejects.
   */
  public static notifyCodeUsed(data: {
    userId: ObjectID;
    usedFor: BackupCodeUse;
    origin?: RequestOrigin | undefined;
  }): Promise<boolean> {
    return UserTwoFactorBackupCodeService.countUnusedForUser({
      userId: data.userId,
    })
      .then(async (remainingCodeCount: number): Promise<boolean> => {
        return await TwoFactorBackupCodeNotification.sendCodeUsedEmail({
          userId: data.userId,
          remainingCodeCount: remainingCodeCount,
          usedFor: data.usedFor,
          origin: data.origin,
        });
      })
      .catch((err: unknown): boolean => {
        logger.error(
          `The email saying a backup code was used was not sent to user ${data.userId.toString()}: its codes could not be counted.`,
        );
        logger.error(err);
        return false;
      });
  }
}
