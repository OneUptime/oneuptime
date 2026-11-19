import DatabaseConfig from "../DatabaseConfig";
import MailService from "../Services/MailService";
import UserService from "../Services/UserService";
import logger from "./Logger";
import ProductBrandingText from "./ProductBrandingText";
import { DEFAULT_EMAIL_TIMEZONE } from "./RequestOrigin/RequestOriginUtil";
import { writeInLanguage } from "./ServerTranslation";
import SsoManagedSignIn from "./SsoManagedSignIn";
import User from "../../Models/DatabaseModels/User";
import { AccountsRoute } from "../../ServiceRoute";
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
import {
  hasLocalSignInSettings,
  LocalSignInSettings,
} from "../../Types/SSO/LocalSignInClearing";
import {
  getSignInSettingsClearedEmailVariables,
  getSignInSettingsClearedSubject,
  SignInAfterClearing,
  SignInSettingsClearedBy,
  SignInSettingsClearer,
} from "../../Types/SSO/SignInSettingsClearedEmail";
import { SignInManagement } from "../../Types/SSO/SsoManagedSignIn";
import { Translator } from "../../Types/Translator";
import { getUserWritingLanguage } from "../../Types/UserLanguage";

/*
 * EMAILING THE PEOPLE WHOSE SIGN-IN SETTINGS WERE CLEARED (issues #9818 and
 * #9820).
 *
 * What the email says, and why it says nothing about anybody else, is in
 * Common/Types/SSO/SignInSettingsClearedEmail.ts. This sends it:
 *
 *   - to the address on the person's account, read here, never one a
 *     caller names, in the language on their account, with the time in
 *     their own time zone;
 *   - only for a clear that removed something (hasLocalSignInSettings), so
 *     somebody who had nothing saved hears nothing;
 *   - with how they sign in now read from the rule at the moment the email
 *     is written (SsoManagedSignIn): single sign-on and its providers while
 *     SSO manages their sign-in, Forgot password? when nothing does, and
 *     both when the rule cannot be read.
 *
 * NEVER IN THE CLEAR'S WAY. The settings are gone, the audit log has the
 * record, and the clear answers whoever asked for it before any email goes
 * out: a clear never waits for one (notify is called without await), and
 * nothing here throws. The emails go one after another, in the background,
 * each bounded by EMAIL_HAND_OFF_TIMEOUT_IN_MS, so a clear of a thousand
 * people hands the mail service one email at a time rather than a thousand
 * at once, and a mail service that is down or slow costs each email its own
 * failure, logged, and nothing else. Clears that come while emails are still
 * going join the queue behind them.
 */

/*
 * One person's settings, cleared, for their email: whose, what they had
 * (all of which is gone), and who cleared them - a server admin, or an
 * owner of the project named (SignInSettingsClearer).
 */
export type SignInSettingsClearedEmailEvent = SignInSettingsClearer & {
  userId: ObjectID;
  cleared: LocalSignInSettings;
};

// How long one email may take to reach the mail service before it is given up.
export const EMAIL_HAND_OFF_TIMEOUT_IN_MS: number = 30 * 1000;

// How the person signs in now, and through which providers.
interface SignInNow {
  way: SignInAfterClearing;
  ssoProviderNames: Array<string>;
}

export default class SignInSettingsClearedEmail {
  // The emails still going out, one after another, across every clear.
  private static queue: Promise<void> = Promise.resolve();

  /*
   * Sends each person whose clear removed something their email, after
   * any still going out. Never rejects; the promise is for tests - a clear
   * does not wait for it.
   */
  public static notify(
    events: Array<SignInSettingsClearedEmailEvent>,
  ): Promise<void> {
    const toSend: Array<SignInSettingsClearedEmailEvent> = (
      events || []
    ).filter((event: SignInSettingsClearedEmailEvent): boolean => {
      return Boolean(
        event &&
          event.userId &&
          event.cleared &&
          hasLocalSignInSettings(event.cleared),
      );
    });

    if (toSend.length === 0) {
      return Promise.resolve();
    }

    const sent: Promise<void> = SignInSettingsClearedEmail.queue.then(
      async (): Promise<void> => {
        for (const event of toSend) {
          await SignInSettingsClearedEmail.sendToPerson(event);
        }
      },
    );

    // Nothing above rejects, but a queue that did would stop every email after it.
    SignInSettingsClearedEmail.queue = sent.catch((): void => {
      // Each email logs its own failure.
    });

    return SignInSettingsClearedEmail.queue;
  }

  /*
   * One person's email: true once the mail service has taken it, false when
   * it was not sent - no account, no address, or a failure, which is logged
   * by the person's id and never by their address.
   */
  public static async sendToPerson(
    event: SignInSettingsClearedEmailEvent,
  ): Promise<boolean> {
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

      const signIn: SignInNow = await SignInSettingsClearedEmail.readSignInNow(
        event.userId,
      );

      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      const accountsUrl: (path: string) => string = (path: string): string => {
        return new URL(
          httpProtocol,
          host,
          new Route(AccountsRoute.toString()).addRoute(path),
        ).toString();
      };

      const language: string = getUserWritingLanguage(user);
      const productName: string = ProductBrandingText.getProductName();

      // The subject and the date in the reader's language, as one piece of work.
      const written: { subject: string; clearedAt: string } = writeInLanguage(
        language,
        (translator: Translator): { subject: string; clearedAt: string } => {
          return {
            subject: getSignInSettingsClearedSubject(translator, productName),
            clearedAt: OneUptimeDate.getDateAsFormattedStringInTimezone({
              date: OneUptimeDate.getCurrentDate(),
              timezone: user.timezone || DEFAULT_EMAIL_TIMEZONE,
            }),
          };
        },
      );

      const response: HTTPResponse<EmptyResponseData> | HTTPErrorResponse =
        await MailService.sendMail(
          {
            toEmail: user.email,
            subject: written.subject,
            isSubjectLiteral: true,
            templateType: EmailTemplateType.SignInSettingsCleared,
            vars: getSignInSettingsClearedEmailVariables({
              ...SignInSettingsClearedEmail.getClearer(event),
              cleared: event.cleared,
              signIn: signIn.way,
              ssoProviderNames: signIn.ssoProviderNames,
              clearedAt: written.clearedAt,
              productName: productName,
              signInUrl: accountsUrl("/login"),
              ssoSignInUrl: accountsUrl("/sso"),
              forgotPasswordUrl: accountsUrl("/forgot-password"),
            }),
            ...(language === DEFAULT_READER_LANGUAGE
              ? {}
              : { language: language }),
          },
          {
            userId: event.userId,
            timeoutInMs: EMAIL_HAND_OFF_TIMEOUT_IN_MS,
          },
        );

      if (response instanceof HTTPErrorResponse) {
        logger.error(
          `The email saying their sign-in settings were cleared was not sent to user ${event.userId.toString()}: the mail service refused it (${response.statusCode}).`,
        );
        return false;
      }

      return true;
    } catch (err) {
      logger.error(
        `The email saying their sign-in settings were cleared was not sent to user ${event.userId.toString()}.`,
      );
      logger.error(err);
      return false;
    }
  }

  // Who cleared them, and nothing else of the event.
  private static getClearer(
    event: SignInSettingsClearedEmailEvent,
  ): SignInSettingsClearer {
    return event.clearedBy === SignInSettingsClearedBy.ProjectOwner
      ? {
          clearedBy: SignInSettingsClearedBy.ProjectOwner,
          projectName: event.projectName,
        }
      : { clearedBy: SignInSettingsClearedBy.ServerAdmin };
  }

  /*
   * How the person signs in now, by the rule (SsoManagedSignIn): with
   * single sign-on and its providers while it manages their sign-in, with a
   * new password otherwise. A rule that cannot be read is no reason to
   * hold the email: it then names both ways.
   */
  private static async readSignInNow(userId: ObjectID): Promise<SignInNow> {
    try {
      const management: SignInManagement =
        await SsoManagedSignIn.getSignInManagement(userId);

      return management.isManagedBySso
        ? {
            way: SignInAfterClearing.SingleSignOn,
            ssoProviderNames: management.ssoProviderNames,
          }
        : { way: SignInAfterClearing.ForgotPassword, ssoProviderNames: [] };
    } catch (err) {
      logger.error(
        `Could not read how user ${userId.toString()} signs in for the email saying their sign-in settings were cleared; it names both ways.`,
      );
      logger.error(err);

      return { way: SignInAfterClearing.Unknown, ssoProviderNames: [] };
    }
  }
}
