import RunCron from "../../Utils/Cron";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
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
import { StatusPageApiRoute } from "Common/ServiceRoute";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ObjectID from "Common/Types/ObjectID";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";

RunCron(
  "Announcement:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // First, mark announcements as Skipped if they should not be notified
    const announcementsToSkip: Array<StatusPageAnnouncement> =
      await StatusPageAnnouncementService.findAllBy({
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
        skip: 0,
        select: {
          _id: true,
        },
      });

    logger.debug(
      `Found ${announcementsToSkip.length} announcements to mark as Skipped (subscribers should not be notified).`,
    );

    for (const announcement of announcementsToSkip) {
      logger.debug(
        `Marking announcement ${announcement.id} as Skipped for subscriber notifications.`,
      );
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
      logger.debug(`Announcement ${announcement.id} marked as Skipped.`);
    }

    // get all scheduled events of all the projects.
    const announcements: Array<StatusPageAnnouncement> =
      await StatusPageAnnouncementService.findAllBy({
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
        skip: 0,
        select: {
          _id: true,
          title: true,
          description: true,
          statusPages: {
            _id: true,
          },
          monitors: {
            _id: true,
          },
          showAnnouncementAt: true,
        },
      });

    logger.debug(
      `Found ${announcements.length} announcements to notify subscribers for.`,
    );

    // change their state to Ongoing.

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
    logger.debug(
      `Database host resolved as ${host.toString()} with protocol ${httpProtocol.toString()}.`,
    );

    for (const announcement of announcements) {
      logger.debug(
        `Processing announcement ${announcement.id} with ${announcement.statusPages?.length || 0} status page(s).`,
      );
      if (!announcement.statusPages) {
        logger.debug(
          `Announcement ${announcement.id} has no status pages; marking as Skipped.`,
        );
        await StatusPageAnnouncementService.updateOneById({
          id: announcement.id!,
          data: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Skipped,
            subscriberNotificationStatusMessage:
              "No status pages attached to this announcement. Skipping notifications.",
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
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
      logger.debug(
        `Announcement ${announcement.id} status set to InProgress for subscriber notifications.`,
      );

      try {
        for (const statuspage of statusPages) {
          try {
            if (!statuspage.id) {
              logger.debug(
                "Encountered a status page without an id; skipping.",
              );
              continue;
            }

            if (!statuspage.showAnnouncementsOnStatusPage) {
              logger.debug(
                `Status page ${statuspage.id} is configured to hide announcements; skipping notifications.`,
              );
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
            const statusPageIdString: string | null =
              statuspage.id?.toString() || statuspage._id?.toString() || null;

            const announcementDetailsUrl: string =
              announcement.id && statusPageURL
                ? URL.fromString(statusPageURL)
                    .addRoute(`/announcements/${announcement.id.toString()}`)
                    .toString()
                : statusPageURL;

            // Fetch custom templates for this status page
            const [emailTemplate, smsTemplate, slackTemplate, teamsTemplate]: [
              StatusPageSubscriberNotificationTemplate | null,
              StatusPageSubscriberNotificationTemplate | null,
              StatusPageSubscriberNotificationTemplate | null,
              StatusPageSubscriberNotificationTemplate | null,
            ] = await Promise.all([
              StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                {
                  statusPageId: statuspage.id!,
                  eventType:
                    StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated,
                  notificationMethod:
                    StatusPageSubscriberNotificationMethod.Email,
                },
              ),
              StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                {
                  statusPageId: statuspage.id!,
                  eventType:
                    StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated,
                  notificationMethod:
                    StatusPageSubscriberNotificationMethod.SMS,
                },
              ),
              StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                {
                  statusPageId: statuspage.id!,
                  eventType:
                    StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated,
                  notificationMethod:
                    StatusPageSubscriberNotificationMethod.Slack,
                },
              ),
              StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                {
                  statusPageId: statuspage.id!,
                  eventType:
                    StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated,
                  notificationMethod:
                    StatusPageSubscriberNotificationMethod.MicrosoftTeams,
                },
              ),
            ]);

            logger.debug(
              `Status page ${statuspage.id} (${statusPageName}) has ${subscribers.length} subscriber(s) for announcement ${announcement.id}.`,
            );

            // Get status page resources if monitors are specified
            let statusPageResources: Array<StatusPageResource> = [];

            if (announcement.monitors && announcement.monitors.length > 0) {
              logger.debug(
                `Announcement ${announcement.id} has ${announcement.monitors.length} monitor(s) specified. Filtering subscribers by affected resources.`,
              );

              statusPageResources = await StatusPageResourceService.findAllBy({
                query: {
                  statusPageId: statuspage.id!,
                  monitorId: QueryHelper.any(
                    announcement.monitors
                      .filter((m: Monitor) => {
                        return m._id;
                      })
                      .map((m: Monitor) => {
                        return new ObjectID(m._id!);
                      }),
                  ),
                },
                props: {
                  isRoot: true,
                  ignoreHooks: true,
                },
                select: {
                  _id: true,
                  displayName: true,
                  statusPageId: true,
                },
                skip: 0,
              });

              logger.debug(
                `Found ${statusPageResources.length} status page resource(s) for announcement ${announcement.id} on status page ${statuspage.id}.`,
              );
            } else {
              logger.debug(
                `Announcement ${announcement.id} has no monitors specified. All subscribers will be notified.`,
              );
            }

            // Send email to Email subscribers.

            for (const subscriber of subscribers) {
              try {
                if (!subscriber._id) {
                  logger.debug(
                    "Encountered a subscriber without an _id; skipping.",
                  );
                  continue;
                }

                const shouldNotifySubscriber: boolean =
                  StatusPageSubscriberService.shouldSendNotification({
                    subscriber: subscriber,
                    statusPageResources: statusPageResources, // Use status page resources from monitors (if any)
                    statusPage: statuspage,
                    eventType: StatusPageEventType.Announcement,
                  });

                if (!shouldNotifySubscriber) {
                  logger.debug(
                    `Skipping subscriber ${subscriber._id} for announcement ${announcement.id} based on preferences or filters.`,
                  );
                  continue;
                }

                const unsubscribeUrl: string =
                  StatusPageSubscriberService.getUnsubscribeLink(
                    URL.fromString(statusPageURL),
                    subscriber.id!,
                  ).toString();

                logger.debug(
                  `Prepared unsubscribe link for subscriber ${subscriber._id} for announcement ${announcement.id}.`,
                );

                if (subscriber.subscriberPhone) {
                  const phoneStr: string =
                    subscriber.subscriberPhone.toString();
                  const phoneMasked: string = `${phoneStr.slice(0, 2)}******${phoneStr.slice(-2)}`;
                  logger.debug(
                    `Queueing SMS notification to subscriber ${subscriber._id} at ${phoneMasked} for announcement ${announcement.id}.`,
                  );

                  // Build SMS message - use custom template if available and custom Twilio is configured
                  let smsMessage: string;
                  if (smsTemplate?.templateBody && statuspage.callSmsConfig) {
                    const smsTemplateVariables: Record<string, string> = {
                      statusPageName: statusPageName,
                      statusPageUrl: statusPageURL,
                      detailsUrl: announcementDetailsUrl,
                      announcementTitle: announcement.title || "",
                      announcementDescription: announcement.description || "",
                      unsubscribeUrl: unsubscribeUrl,
                    };
                    smsMessage =
                      StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                        smsTemplate.templateBody,
                        smsTemplateVariables,
                      );
                  } else {
                    smsMessage = `Announcement ${announcement.title || ""} on ${statusPageName}. Details: ${announcementDetailsUrl}. Unsub: ${unsubscribeUrl}`;
                  }

                  const sms: SMS = {
                    message: smsMessage,
                    to: subscriber.subscriberPhone,
                  };

                  // send sms here.
                  SmsService.sendSms(sms, {
                    projectId: statuspage.projectId,
                    customTwilioConfig:
                      ProjectCallSMSConfigService.toTwilioConfig(
                        statuspage.callSmsConfig,
                      ),
                    statusPageId: statuspage.id!,
                    statusPageAnnouncementId: announcement.id!,
                  }).catch((err: Error) => {
                    logger.error(err);
                  });
                }

                if (subscriber.slackIncomingWebhookUrl) {
                  logger.debug(
                    `Queueing Slack notification to subscriber ${subscriber._id} for announcement ${announcement.id}.`,
                  );

                  // Build Slack message - use custom template if available
                  let slackMessage: string;
                  if (slackTemplate?.templateBody) {
                    const slackTemplateVariables: Record<string, string> = {
                      statusPageName: statusPageName,
                      statusPageUrl: statusPageURL,
                      detailsUrl: announcementDetailsUrl,
                      announcementTitle: announcement.title || "",
                      announcementDescription: announcement.description || "",
                      unsubscribeUrl: unsubscribeUrl,
                    };
                    slackMessage =
                      StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                        slackTemplate.templateBody,
                        slackTemplateVariables,
                      );
                  } else {
                    // Default markdown message
                    slackMessage = `## 📢 Announcement - ${announcement.title || ""}

**Description:** ${announcement.description || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                  }

                  // send Slack notification here.
                  SlackUtil.sendMessageToChannelViaIncomingWebhook({
                    url: subscriber.slackIncomingWebhookUrl,
                    text: SlackUtil.convertMarkdownToSlackRichText(
                      slackMessage,
                    ),
                  }).catch((err: Error) => {
                    logger.error(err);
                  });
                }

                if (subscriber.microsoftTeamsIncomingWebhookUrl) {
                  logger.debug(
                    `Queueing Microsoft Teams notification to subscriber ${subscriber._id} for announcement ${announcement.id}.`,
                  );

                  // Build Teams message - use custom template if available
                  let teamsMessage: string;
                  if (teamsTemplate?.templateBody) {
                    const teamsTemplateVariables: Record<string, string> = {
                      statusPageName: statusPageName,
                      statusPageUrl: statusPageURL,
                      detailsUrl: announcementDetailsUrl,
                      announcementTitle: announcement.title || "",
                      announcementDescription: announcement.description || "",
                      unsubscribeUrl: unsubscribeUrl,
                    };
                    teamsMessage =
                      StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                        teamsTemplate.templateBody,
                        teamsTemplateVariables,
                      );
                  } else {
                    // Default markdown message
                    teamsMessage = `## 📢 Announcement - ${announcement.title || ""}

**Description:** ${announcement.description || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                  }

                  // send Teams notification here.
                  MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
                    url: subscriber.microsoftTeamsIncomingWebhookUrl,
                    text: teamsMessage,
                  }).catch((err: Error) => {
                    logger.error(err);
                  });
                }

                if (subscriber.subscriberEmail) {
                  // send email here.
                  logger.debug(
                    `Queueing email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail} for announcement ${announcement.id}.`,
                  );

                  // Prepare email content - use custom template if available
                  const announcementDescriptionHtml: string =
                    await Markdown.convertToHTML(
                      announcement.description || "",
                      MarkdownContentType.Email,
                    );

                  let emailSubject: string =
                    "[Announcement] " + announcement.title;

                  if (emailTemplate?.templateBody && statuspage.smtpConfig) {
                    // Use custom template with BlankTemplate only when custom SMTP is configured
                    const emailTemplateVariables: Record<string, string> = {
                      statusPageName: statusPageName,
                      statusPageUrl: statusPageURL,
                      detailsUrl: announcementDetailsUrl,
                      announcementTitle: announcement.title || "",
                      announcementDescription: announcementDescriptionHtml,
                      unsubscribeUrl: unsubscribeUrl,
                    };
                    const customEmailBody: string =
                      StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                        emailTemplate.templateBody,
                        emailTemplateVariables,
                      );

                    // Use custom subject if provided
                    if (emailTemplate.emailSubject) {
                      emailSubject =
                        StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                          emailTemplate.emailSubject,
                          emailTemplateVariables,
                        );
                    }

                    MailService.sendMail(
                      {
                        toEmail: subscriber.subscriberEmail,
                        templateType: EmailTemplateType.BlankTemplate,
                        vars: {
                          body: customEmailBody,
                        },
                        subject: emailSubject,
                      },
                      {
                        mailServer: ProjectSMTPConfigService.toEmailServer(
                          statuspage.smtpConfig,
                        ),
                        projectId: statuspage.projectId,
                        statusPageId: statuspage.id!,
                        statusPageAnnouncementId: announcement.id!,
                      },
                    ).catch((err: Error) => {
                      logger.error(err);
                    });
                  } else {
                    // Use default hard-coded template
                    MailService.sendMail(
                      {
                        toEmail: subscriber.subscriberEmail,
                        templateType:
                          EmailTemplateType.SubscriberAnnouncementCreated,
                        vars: {
                          statusPageName: statusPageName,
                          statusPageUrl: statusPageURL,
                          detailsUrl: announcementDetailsUrl,
                          logoUrl:
                            statuspage.logoFileId && statusPageIdString
                              ? new URL(httpProtocol, host)
                                  .addRoute(StatusPageApiRoute)
                                  .addRoute(`/logo/${statusPageIdString}`)
                                  .toString()
                              : "",
                          isPublicStatusPage: statuspage.isPublicStatusPage
                            ? "true"
                            : "false",
                          announcementTitle: announcement.title || "",
                          announcementDescription: announcementDescriptionHtml,
                          subscriberEmailNotificationFooterText:
                            StatusPageServiceType.getSubscriberEmailFooterText(
                              statuspage,
                            ),
                          unsubscribeUrl: unsubscribeUrl,
                        },
                        subject: emailSubject,
                      },
                      {
                        mailServer: ProjectSMTPConfigService.toEmailServer(
                          statuspage.smtpConfig,
                        ),
                        projectId: statuspage.projectId,
                        statusPageId: statuspage.id!,
                        statusPageAnnouncementId: announcement.id!,
                      },
                    ).catch((err: Error) => {
                      logger.error(err);
                    });
                  }
                  logger.debug(
                    `Email notification queued for subscriber ${subscriber._id} for announcement ${announcement.id}.`,
                  );
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
        logger.debug(
          `Announcement ${announcement.id} marked as Success for subscriber notifications.`,
        );
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
