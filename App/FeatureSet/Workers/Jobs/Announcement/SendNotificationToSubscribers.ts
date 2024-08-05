import RunCron from "../../Utils/Cron";
import { FileRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import SMS from "Common/Types/SMS/SMS";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DatabaseConfig from "CommonServer/DatabaseConfig";
import MailService from "CommonServer/Services/MailService";
import ProjectCallSMSConfigService from "CommonServer/Services/ProjectCallSMSConfigService";
import ProjectSMTPConfigService from "CommonServer/Services/ProjectSmtpConfigService";
import SmsService from "CommonServer/Services/SmsService";
import StatusPageAnnouncementService from "CommonServer/Services/StatusPageAnnouncementService";
import StatusPageService from "CommonServer/Services/StatusPageService";
import StatusPageSubscriberService from "CommonServer/Services/StatusPageSubscriberService";
import QueryHelper from "CommonServer/Types/Database/QueryHelper";
import Markdown, { MarkdownContentType } from "CommonServer/Types/Markdown";
import logger from "CommonServer/Utils/Logger";
import StatusPage from "Common/AppModels/Models/StatusPage";
import StatusPageAnnouncement from "Common/AppModels/Models/StatusPageAnnouncement";
import StatusPageSubscriber from "Common/AppModels/Models/StatusPageSubscriber";

RunCron(
  "Announcement:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.
    const announcements: Array<StatusPageAnnouncement> =
      await StatusPageAnnouncementService.findBy({
        query: {
          isStatusPageSubscribersNotified: false,
          shouldStatusPageSubscribersBeNotified: true,
          showAnnouncementAt: QueryHelper.lessThan(
            OneUptimeDate.getCurrentDate(),
          ),
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          _id: true,
          title: true,
          description: true,
          statusPages: {
            _id: true,
          },
          showAnnouncementAt: true,
        },
      });

    // change their state to Ongoing.

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    for (const announcement of announcements) {
      if (!announcement.statusPages) {
        continue;
      }

      const statusPages: Array<StatusPage> =
        await StatusPageSubscriberService.getStatusPagesToSendNotification(
          announcement.statusPages.map((sp: StatusPage) => {
            return sp.id!;
          }),
        );

      await StatusPageAnnouncementService.updateOneById({
        id: announcement.id!,
        data: {
          isStatusPageSubscribersNotified: true,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      for (const statuspage of statusPages) {
        try {
          if (!statuspage.id) {
            continue;
          }

          const subscribers: Array<StatusPageSubscriber> =
            await StatusPageSubscriberService.getSubscribersByStatusPage(
              statuspage.id!,
              {
                isRoot: true,
                ignoreHooks: true,
              },
            );

          const statusPageURL: string =
            await StatusPageService.getStatusPageURL(statuspage.id);
          const statusPageName: string =
            statuspage.pageTitle || statuspage.name || "Status Page";

          // Send email to Email subscribers.

          for (const subscriber of subscribers) {
            try {
              if (!subscriber._id) {
                continue;
              }

              const unsubscribeUrl: string =
                StatusPageSubscriberService.getUnsubscribeLink(
                  URL.fromString(statusPageURL),
                  subscriber.id!,
                ).toString();

              if (subscriber.subscriberPhone) {
                const sms: SMS = {
                  message: `
                            Announcement - ${statusPageName}

                            ${announcement.title || ""}

                            To view this announcement, visit ${statusPageURL}

                            To update notification preferences or unsubscribe, visit ${unsubscribeUrl}
                            `,
                  to: subscriber.subscriberPhone,
                };

                // send sms here.
                SmsService.sendSms(sms, {
                  projectId: statuspage.projectId,
                  customTwilioConfig:
                    ProjectCallSMSConfigService.toTwilioConfig(
                      statuspage.callSmsConfig,
                    ),
                }).catch((err: Error) => {
                  logger.error(err);
                });
              }

              if (subscriber.subscriberEmail) {
                // send email here.

                MailService.sendMail(
                  {
                    toEmail: subscriber.subscriberEmail,
                    templateType:
                      EmailTemplateType.SubscriberAnnouncementCreated,
                    vars: {
                      statusPageName: statusPageName,
                      statusPageUrl: statusPageURL,
                      logoUrl: statuspage.logoFileId
                        ? new URL(httpProtocol, host)
                            .addRoute(FileRoute)
                            .addRoute("/image/" + statuspage.logoFileId)
                            .toString()
                        : "",
                      isPublicStatusPage: statuspage.isPublicStatusPage
                        ? "true"
                        : "false",
                      announcementTitle: announcement.title || "",
                      announcementDescription: await Markdown.convertToHTML(
                        announcement.description || "",
                        MarkdownContentType.Email,
                      ),
                      unsubscribeUrl: unsubscribeUrl,
                    },
                    subject: "[Announcement] " + statusPageName,
                  },
                  {
                    mailServer: ProjectSMTPConfigService.toEmailServer(
                      statuspage.smtpConfig,
                    ),
                    projectId: statuspage.projectId,
                  },
                ).catch((err: Error) => {
                  logger.error(err);
                });
              }
            } catch (err) {
              logger.error(err);
            }
          }
        } catch (err) {
          logger.error(err);
        }
      }
    }
  },
);
