import RunCron from "../../Utils/Cron";
import { EVERY_DAY, EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import {
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import EnterpriseLicenseService from "Common/Server/Services/EnterpriseLicenseService";
import EnterpriseLicenseInstanceService from "Common/Server/Services/EnterpriseLicenseInstanceService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import MailService from "Common/Server/Services/MailService";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseInstance from "Common/Models/DatabaseModels/EnterpriseLicenseInstance";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Email from "Common/Types/Email";
import EmptyResponseData from "Common/Types/API/EmptyResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import Dictionary from "Common/Types/Dictionary";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import EnterpriseLicenseUsageUtil from "Common/Utils/EnterpriseLicense/EnterpriseLicenseUsage";
import logger from "Common/Server/Utils/Logger";

type SendToAllRecipientsFunction = (data: {
  recipients: Array<string>;
  subject: string;
  templateType: EmailTemplateType;
  vars: Dictionary<string | JSONObject>;
}) => Promise<void>;

const sendToAllRecipients: SendToAllRecipientsFunction = async (data: {
  recipients: Array<string>;
  subject: string;
  templateType: EmailTemplateType;
  vars: Dictionary<string | JSONObject>;
}): Promise<void> => {
  for (const recipient of data.recipients) {
    try {
      /*
       * API.post resolves with an HTTPErrorResponse instead of throwing on
       * HTTP errors — check the response or failures go unnoticed.
       */
      const response: HTTPResponse<EmptyResponseData> | HTTPErrorResponse =
        await MailService.sendMail({
          toEmail: new Email(recipient),
          subject: data.subject,
          templateType: data.templateType,
          vars: data.vars,
        });

      if (!response.isSuccess()) {
        const message: string =
          response instanceof HTTPErrorResponse
            ? response.message || "Unknown error"
            : "Unknown error";

        logger.error(
          `EnterpriseLicense:SendLicenseNotificationEmails: Failed to send "${data.subject}" to ${recipient}: ${message}`,
        );
      }
    } catch (err) {
      logger.error(
        `EnterpriseLicense:SendLicenseNotificationEmails: Failed to send "${data.subject}" to ${recipient}: ${err}`,
      );
    }
  }
};

type GetRecipientsFunction = (data: {
  instances: Array<EnterpriseLicenseInstance>;
  ccEmail: string | undefined;
}) => Array<string>;

/*
 * Master admins across every instance of the license (synced daily by the
 * customer's installations), plus the OneUptime enterprise license email
 * configured in GlobalConfig — the "cc" that keeps the sales team in the
 * loop. Emails only support a single recipient per send, so the cc gets its
 * own copy.
 */
const getRecipients: GetRecipientsFunction = (data: {
  instances: Array<EnterpriseLicenseInstance>;
  ccEmail: string | undefined;
}): Array<string> => {
  const recipients: Set<string> = new Set<string>();

  for (const instance of data.instances) {
    for (const email of instance.masterAdminEmails || []) {
      if (email) {
        recipients.add(email.toLowerCase());
      }
    }
  }

  if (data.ccEmail) {
    recipients.add(data.ccEmail.toLowerCase());
  }

  return Array.from(recipients);
};

RunCron(
  "EnterpriseLicense:SendLicenseNotificationEmails",
  {
    schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_DAY,
    runOnStartup: false,
  },
  async () => {
    /*
     * Licenses are issued and tracked on the hosted oneuptime.com (billing
     * enabled). Self-hosted installs have an empty license table and skip.
     */
    if (!IsBillingEnabled) {
      return;
    }

    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneById({
        id: ObjectID.getZeroObjectID(),
        select: {
          enterpriseLicenseNotificationEmail: true,
          enterpriseLicenseExpiryReminderDays: true,
        },
        props: {
          isRoot: true,
        },
      });

    const ccEmail: string | undefined =
      globalConfig?.enterpriseLicenseNotificationEmail?.toString();

    const reminderDays: number =
      globalConfig?.enterpriseLicenseExpiryReminderDays ||
      EnterpriseLicenseUsageUtil.defaultExpiryReminderDays;

    const licenses: Array<EnterpriseLicense> =
      await EnterpriseLicenseService.findBy({
        query: {},
        select: {
          _id: true,
          companyName: true,
          licenseKey: true,
          expiresAt: true,
          userLimit: true,
          currentUserCount: true,
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    const now: Date = OneUptimeDate.getCurrentDate();

    for (const license of licenses) {
      try {
        const instances: Array<EnterpriseLicenseInstance> =
          await EnterpriseLicenseInstanceService.findBy({
            query: {
              enterpriseLicenseId: license.id!,
            },
            select: {
              _id: true,
              userCount: true,
              userEmailHashes: true,
              masterAdminEmails: true,
              lastReportedAt: true,
            },
            sort: {
              createdAt: SortOrder.Ascending,
            },
            skip: 0,
            limit: LIMIT_MAX,
            props: {
              isRoot: true,
            },
          });

        const recipients: Array<string> = getRecipients({
          instances,
          ccEmail,
        });

        if (recipients.length === 0) {
          logger.debug(
            `EnterpriseLicense:SendLicenseNotificationEmails: No master admin emails synced for license of ${license.companyName} and no enterprise license notification email configured. Skipping.`,
          );
          continue;
        }

        const companyName: string = license.companyName || "your company";
        const maskedLicenseKey: string =
          EnterpriseLicenseUsageUtil.maskLicenseKey(license.licenseKey || "");

        // --- Seat limit breach ---

        const currentUserCount: number =
          instances.length > 0
            ? EnterpriseLicenseUsageUtil.getUniqueUserCount(instances, now)
            : license.currentUserCount || 0;

        const userLimit: number | undefined = license.userLimit;

        if (
          typeof userLimit === "number" &&
          userLimit > 0 &&
          currentUserCount > userLimit
        ) {
          await sendToAllRecipients({
            recipients,
            subject: `[Action Required] OneUptime Enterprise license for ${companyName} is over its user limit`,
            templateType: EmailTemplateType.EnterpriseLicenseUserLimitBreach,
            vars: {
              companyName: companyName,
              licenseKey: maskedLicenseKey,
              userLimit: userLimit.toString(),
              currentUserCount: currentUserCount.toString(),
              usersOverLimit: (currentUserCount - userLimit).toString(),
              instanceCount: instances.length.toString(),
            },
          });
        }

        // --- Expiry reminder ---

        if (!license.expiresAt) {
          continue;
        }

        const daysUntilExpiry: number = OneUptimeDate.getDaysBetweenTwoDates(
          now,
          license.expiresAt,
        );

        const isExpired: boolean = license.expiresAt.getTime() <= now.getTime();

        const isInReminderWindow: boolean =
          !isExpired && daysUntilExpiry <= reminderDays;

        const isInExpiredWindow: boolean =
          isExpired &&
          Math.abs(daysUntilExpiry) <=
            EnterpriseLicenseUsageUtil.expiredNotificationCutoffDays;

        if (!isInReminderWindow && !isInExpiredWindow) {
          continue;
        }

        const expiresAtFormatted: string =
          OneUptimeDate.getDateAsFormattedString(license.expiresAt, {
            onlyShowDate: true,
          });

        let subject: string;
        let emailTitle: string;
        let expiryStatus: string;
        let expiryStatusMessage: string;

        if (isExpired) {
          const daysAgo: number = Math.abs(daysUntilExpiry);
          const daysAgoText: string =
            daysAgo === 0
              ? "today"
              : `${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`;

          subject = `[Action Required] OneUptime Enterprise license for ${companyName} has expired`;
          emailTitle = "Your OneUptime Enterprise license has expired";
          expiryStatus = `Expired ${daysAgoText}`;
          expiryStatusMessage = `Your OneUptime Enterprise license expired ${daysAgoText}. Please renew it to keep your self-hosted OneUptime instances running. Here are the details:`;
        } else {
          const daysLeftText: string =
            daysUntilExpiry === 0
              ? "today"
              : `in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}`;

          subject = `[Reminder] OneUptime Enterprise license for ${companyName} expires ${daysLeftText}`;
          emailTitle = `Your OneUptime Enterprise license expires ${daysLeftText}`;
          expiryStatus = `Expires ${daysLeftText}`;
          expiryStatusMessage = `Your OneUptime Enterprise license expires ${daysLeftText}. Please renew it before then to keep your self-hosted OneUptime instances running. Here are the details:`;
        }

        await sendToAllRecipients({
          recipients,
          subject,
          templateType: EmailTemplateType.EnterpriseLicenseExpiryReminder,
          vars: {
            companyName: companyName,
            licenseKey: maskedLicenseKey,
            expiresAt: expiresAtFormatted,
            emailTitle: emailTitle,
            expiryStatus: expiryStatus,
            expiryStatusMessage: expiryStatusMessage,
          },
        });
      } catch (error) {
        logger.error(
          `EnterpriseLicense:SendLicenseNotificationEmails: Error while processing license of ${license.companyName}: ${error}`,
        );
      }
    }
  },
);
