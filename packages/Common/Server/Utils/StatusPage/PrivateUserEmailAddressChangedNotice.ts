import DatabaseConfig from "../../DatabaseConfig";
import MailService from "../../Services/MailService";
import ProjectSMTPConfigService from "../../Services/ProjectSmtpConfigService";
import StatusPageService from "../../Services/StatusPageService";
import logger from "../Logger";
import { PROJECT_SMTP_CONFIG_SEND_SELECT } from "../Mail/ProjectSmtpConfigSelect";
import RequestOriginUtil from "../RequestOrigin/RequestOriginUtil";
import { writeInLanguage } from "../ServerTranslation";
import StatusPageEmailLogo, {
  STATUS_PAGE_EMAIL_LOGO_SELECT,
} from "./StatusPageEmailLogo";
import SubscriberLanguage from "./SubscriberLanguage";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import EmptyResponseData from "../../../Types/API/EmptyResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../Types/ObjectID";
import { DEFAULT_READER_LANGUAGE } from "../../../Types/ReaderLanguage";
import {
  getPrivateUserEmailAddressChangedEmailVariables,
  getPrivateUserEmailAddressChangedSubject,
  PrivateUserEmailAddressChangedBy,
} from "../../../Types/StatusPage/PrivateUserEmailAddressChangedEmail";
import { Translator } from "../../../Types/Translator";

/*
 * TELLING A STATUS PAGE PRIVATE USER'S OLD ADDRESS THAT IT CHANGED (#10156).
 *
 * What the email says, and why it carries no link to undo the change, is in
 * Common/Types/StatusPage/PrivateUserEmailAddressChangedEmail.ts. This sends
 * it, for StatusPagePrivateUserService.onUpdateSuccess, once per private
 * user whose address a write changed:
 *
 *   - to the address the user had before the write, never to one a caller
 *     names;
 *   - in the status page's branding (its name and logo) and its default
 *     language, through the page's own mail server when it has one, as the
 *     page's other emails to its private users go;
 *   - never in the write's way: the request that changed the address is
 *     answered before this runs, nothing here throws, and a failure is
 *     logged by the private user's id, never by an address.
 */

// How long the email may take to reach the mail service before it is given up.
export const PRIVATE_USER_EMAIL_ADDRESS_CHANGED_TIMEOUT_IN_MS: number =
  30 * 1000;

// One private user whose address a write changed.
export interface PrivateUserEmailAddressChangedEvent {
  privateUserId: ObjectID;
  statusPageId: ObjectID;
  // The address the user had before the write: the one emailed.
  previousEmail: Email;
  // The address they have now: masked in the email.
  newEmail: Email;
  changedBy: PrivateUserEmailAddressChangedBy;
  // When the address changed; now, when left out.
  at?: Date | undefined;
}

interface WrittenInLanguage {
  subject: string;
  changedAt: string;
}

export default class PrivateUserEmailAddressChangedNotice {
  /*
   * The email itself: true once the mail service has taken it, false when
   * it was not sent - no address, no status page, or a failure, logged.
   * Never throws.
   */
  public static async send(
    event: PrivateUserEmailAddressChangedEvent,
  ): Promise<boolean> {
    const privateUserId: string = event?.privateUserId?.toString() || "unknown";

    try {
      if (!event?.previousEmail || !event.newEmail || !event.statusPageId) {
        return false;
      }

      const statusPage: StatusPage | null = await StatusPageService.findOneById(
        {
          id: event.statusPageId,
          select: {
            ...STATUS_PAGE_EMAIL_LOGO_SELECT,
            name: true,
            pageTitle: true,
            defaultLanguage: true,
            smtpConfig: PROJECT_SMTP_CONFIG_SEND_SELECT,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        },
      );

      if (!statusPage) {
        return false;
      }

      const statusPageName: string =
        statusPage.pageTitle || statusPage.name || "";
      const language: string =
        SubscriberLanguage.getStatusPageLanguage(statusPage);

      // The subject and the time in the page's language, as one piece of work.
      const written: WrittenInLanguage = writeInLanguage(
        language,
        (translator: Translator): WrittenInLanguage => {
          return {
            subject: getPrivateUserEmailAddressChangedSubject(
              translator,
              statusPageName,
            ),
            changedAt:
              RequestOriginUtil.getEmailVars({ at: event.at }).requestedAt ||
              "",
          };
        },
      );

      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
      const statusPageURL: string = await StatusPageService.getStatusPageURL(
        event.statusPageId,
      );

      const response: HTTPResponse<EmptyResponseData> | HTTPErrorResponse =
        await MailService.sendMail(
          {
            toEmail: event.previousEmail,
            subject: written.subject,
            isSubjectLiteral: true,
            templateType:
              EmailTemplateType.StatusPagePrivateUserEmailAddressChanged,
            vars: {
              homeURL: statusPageURL,
              logoUrl: StatusPageEmailLogo.getLogoUrl({
                statusPage: statusPage,
                host: host,
                httpProtocol: httpProtocol,
              }),
              ...getPrivateUserEmailAddressChangedEmailVariables({
                changedBy: event.changedBy,
                statusPageName: statusPageName,
                newEmail: event.newEmail,
                changedAt: written.changedAt,
              }),
            },
            ...(language === DEFAULT_READER_LANGUAGE
              ? {}
              : { language: language }),
          },
          {
            projectId: statusPage.projectId,
            mailServer: ProjectSMTPConfigService.toEmailServer(
              statusPage.smtpConfig,
            ),
            statusPageId: event.statusPageId,
            timeoutInMs: PRIVATE_USER_EMAIL_ADDRESS_CHANGED_TIMEOUT_IN_MS,
          },
        );

      if (response instanceof HTTPErrorResponse) {
        logger.error(
          `The email saying their email address changed was not sent to the previous address of status page private user ${privateUserId}: the mail service refused it (${response.statusCode}).`,
        );
        return false;
      }

      return true;
    } catch (err) {
      logger.error(
        `The email saying their email address changed was not sent to the previous address of status page private user ${privateUserId}.`,
      );
      logger.error(err);
      return false;
    }
  }
}
