import DatabaseConfig from "../../DatabaseConfig";
import MailService from "../../Services/MailService";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import RequestOriginUtil, {
  RequestOriginEmailVars,
  UNKNOWN_DEVICE,
} from "../RequestOrigin/RequestOriginUtil";
import { writeInLanguage } from "../ServerTranslation";
import {
  EmailAddressChangedBy,
  getEmailAddressChangedEmailVariables,
  getEmailAddressChangedSubject,
} from "../../../Types/Accounts/EmailAddressChangedEmail";
import EmptyResponseData from "../../../Types/API/EmptyResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../Types/ObjectID";
import { DEFAULT_READER_LANGUAGE } from "../../../Types/ReaderLanguage";
import RequestOrigin from "../../../Types/RequestOrigin";
import Timezone from "../../../Types/Timezone";
import { translationKey, Translator } from "../../../Types/Translator";
import { getUserWritingLanguage } from "../../../Types/UserLanguage";

/*
 * TELLING AN ACCOUNT'S OLD ADDRESS THAT THE ACCOUNT MOVED (#9907).
 *
 * What the email says, and why it carries no link to undo the change, is
 * in Common/Types/Accounts/EmailAddressChangedEmail.ts. This sends it, for
 * UserService.onUpdateSuccess, once per account whose address a write
 * changed:
 *
 *   - to the address the account had before the write - the one place the
 *     owner still reads once the account has moved - and never to one a
 *     caller names;
 *   - in the language on the account, with the time in its own time zone,
 *     both as the account was read before the write;
 *   - with where the change came from only when it was the account's own
 *     (getEmailAddressChangedEmailVariables drops the rest).
 *
 * NEVER IN THE WRITE'S WAY. The address has changed and the request that
 * changed it is answered before this runs: UserService does not wait for it,
 * and nothing here throws. A mail service that is down or slow costs this
 * email alone, bounded by EMAIL_ADDRESS_CHANGED_TIMEOUT_IN_MS, and is logged
 * by the account's id, never by an address.
 */

// How long the email may take to reach the mail service before it is given up.
export const EMAIL_ADDRESS_CHANGED_TIMEOUT_IN_MS: number = 30 * 1000;

// One account whose address a write changed.
export interface EmailAddressChangedEvent {
  userId: ObjectID;
  // The address the account had before the write: the one emailed.
  previousEmail: Email;
  // The address it has now: masked in the email.
  newEmail: Email;
  changedBy: EmailAddressChangedBy;
  // The request that made the change, when one did.
  origin?: RequestOrigin | undefined;
  // When the address changed; now, when left out.
  at?: Date | undefined;
  // The account's language and time zone, as read before the write.
  language?: string | null | undefined;
  timezone?: Timezone | null | undefined;
}

interface WrittenInLanguage {
  subject: string;
  origin: RequestOriginEmailVars;
}

export default class EmailAddressChangedNotice {
  /*
   * The email itself: true once the mail service has taken it, false when
   * it was not sent - no address to send it to, or a failure, logged.
   * Never throws.
   */
  public static async send(event: EmailAddressChangedEvent): Promise<boolean> {
    const userId: string = event?.userId?.toString() || "unknown";

    try {
      if (!event?.previousEmail || !event.newEmail) {
        return false;
      }

      const language: string = getUserWritingLanguage({
        language: event.language,
      });
      const productName: string = ProductBrandingText.getProductName();

      // The subject, the time and the device in the reader's language, as one piece of work.
      const written: WrittenInLanguage = writeInLanguage(
        language,
        (translator: Translator): WrittenInLanguage => {
          const origin: RequestOriginEmailVars = RequestOriginUtil.getEmailVars(
            {
              origin: event.origin,
              at: event.at,
              timezone: event.timezone,
            },
          );

          return {
            subject: getEmailAddressChangedSubject(translator, productName),
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
            toEmail: event.previousEmail,
            subject: written.subject,
            isSubjectLiteral: true,
            templateType: EmailTemplateType.EmailAddressChanged,
            vars: {
              homeURL: new URL(httpProtocol, host).toString(),
              ...getEmailAddressChangedEmailVariables({
                changedBy: event.changedBy,
                productName: productName,
                newEmail: event.newEmail,
                changedAt: written.origin.requestedAt,
                requestIpAddress: written.origin.requestIpAddress,
                requestLocation: written.origin.requestLocation,
                requestDevice: written.origin.requestDevice,
              }),
            },
            ...(language === DEFAULT_READER_LANGUAGE
              ? {}
              : { language: language }),
          },
          {
            userId: event.userId,
            timeoutInMs: EMAIL_ADDRESS_CHANGED_TIMEOUT_IN_MS,
          },
        );

      if (response instanceof HTTPErrorResponse) {
        logger.error(
          `The email saying their email address changed was not sent to the previous address of user ${userId}: the mail service refused it (${response.statusCode}).`,
        );
        return false;
      }

      return true;
    } catch (err) {
      logger.error(
        `The email saying their email address changed was not sent to the previous address of user ${userId}.`,
      );
      logger.error(err);
      return false;
    }
  }
}
