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
import DatabaseConfig from "Common/Server/DatabaseConfig";
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSMTPConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageAnnouncementService from "Common/Server/Services/StatusPageAnnouncementService";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";

RunCron(
  "Announcement:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // First, mark announcements as Skipped if they should not be notified
    const announcementsToSkip: Array<StatusPageAnnouncement> =
      await StatusPageAnnouncementService.findBy({
        query: {
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.Pending,
          shouldStatusPageSubscribersBeNotified: false,
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
        },
      });

    for (const announcement of announcementsToSkip) {
      await StatusPageAnnouncementService.updateOneById({
        id: announcement.id!,
        data: {
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessage:
            "Notifications skipped as subscribers are not to be notified for this announcement.",
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    }

    // get all scheduled events of all the projects.
    const announcements: Array<StatusPageAnnouncement> =
      await StatusPageAnnouncementService.findBy({
        query: {
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.Pending,
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
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.InProgress,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      try {
        for (const statuspage of statusPages) {
          try {
            if (!statuspage.id) {
              continue;
            }

            if (!statuspage.showAnnouncementsOnStatusPage) {
              continue; // Do not send notification to subscribers if incidents are not visible on status page.
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

                const shouldNotifySubscriber: boolean =
                  StatusPageSubscriberService.shouldSendNotification({
                    subscriber: subscriber,
                    statusPageResources: [], // this is an announcement so we don't care about resources
                    statusPage: statuspage,
                    eventType: StatusPageEventType.Announcement,
                  });

                if (!shouldNotifySubscriber) {
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

                if (subscriber.slackIncomingWebhookUrl) {
                  // Convert markdown to Slack format and send notification
                  const markdownMessage: string = `## 📢 Announcement - ${announcement.title || ""}

**Description:** ${announcement.description || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;

                  // send Slack notification here.
                  SlackUtil.sendMessageToChannelViaIncomingWebhook({
                    url: subscriber.slackIncomingWebhookUrl,
                    text: SlackUtil.convertMarkdownToSlackRichText(
                      markdownMessage,
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
                        subscriberEmailNotificationFooterText:
                          StatusPageServiceType.getSubscriberEmailFooterText(
                            statuspage,
                          ),
                        unsubscribeUrl: unsubscribeUrl,
                      },
                      subject: "[Announcement] " + announcement.title,
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

        // If we get here, the notification was successful
        await StatusPageAnnouncementService.updateOneById({
          id: announcement.id!,
          data: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Success,
            subscriberNotificationStatusMessage:
              "Notifications sent successfully to all subscribers",
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
      } catch (err) {
        // If there was an error, mark as failed
        logger.error(err);
        await StatusPageAnnouncementService.updateOneById({
          id: announcement.id!,
          data: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Failed,
            subscriberNotificationStatusMessage:
              err instanceof Error ? err.message : String(err),
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
      }
    }
  },
);
