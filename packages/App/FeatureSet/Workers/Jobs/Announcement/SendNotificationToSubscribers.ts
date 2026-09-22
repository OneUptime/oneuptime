import RunCron from "../../Utils/Cron";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
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
import Select from "Common/Server/Types/Database/Select";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
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
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import StatusPageResourceUtil from "Common/Server/Utils/StatusPageResource";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import SubscriberNotificationTrigger from "Common/Types/StatusPage/SubscriberNotificationTrigger";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";
import QueryDeepPartialEntity from "Common/Types/Database/PartialEntity";

/*
 * Two jobs share this send path: one tells subscribers about a new
 * announcement, the other about an edit to one whose editor asked for it.
 * They differ only in the wording below and in which status columns they
 * track, so an announcement's "posted" and "updated" notifications can never
 * disagree about who is notified or how.
 */
interface AnnouncementNotificationCopy {
  templateEventType: StatusPageSubscriberNotificationEventType;
  emailTemplateType: EmailTemplateType;
  emailSubjectPrefix: string;
  smsPrefix: string;
  chatHeading: string;
  webhookEventType: string;
  successMessage: string;
}

const NOTIFICATION_COPY: Record<
  SubscriberNotificationTrigger,
  AnnouncementNotificationCopy
> = {
  [SubscriberNotificationTrigger.Created]: {
    templateEventType:
      StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated,
    emailTemplateType: EmailTemplateType.SubscriberAnnouncementCreated,
    emailSubjectPrefix: "[Announcement] ",
    smsPrefix: "Announcement",
    chatHeading: "📢 Announcement",
    webhookEventType: "AnnouncementCreated",
    successMessage: "Notifications sent successfully to all subscribers",
  },
  [SubscriberNotificationTrigger.Updated]: {
    templateEventType:
      StatusPageSubscriberNotificationEventType.SubscriberAnnouncementUpdated,
    emailTemplateType: EmailTemplateType.SubscriberAnnouncementUpdated,
    emailSubjectPrefix: "[Announcement Updated] ",
    smsPrefix: "Announcement updated:",
    chatHeading: "📢 Announcement Updated",
    webhookEventType: "AnnouncementUpdated",
    successMessage: SubscriberUpdateNotification.sentMessage,
  },
};

const NO_MATCHING_SUBSCRIBERS_MESSAGE: string =
  "No matching subscribers found. All associated status pages either hide announcements or had no matching subscribers.";

const setNotificationStatus: (data: {
  announcementId: ObjectID;
  trigger: SubscriberNotificationTrigger;
  status: StatusPageSubscriberNotificationStatus;
  message?: string | undefined;
}) => Promise<void> = async (data: {
  announcementId: ObjectID;
  trigger: SubscriberNotificationTrigger;
  status: StatusPageSubscriberNotificationStatus;
  message?: string | undefined;
}): Promise<void> => {
  const message: string | undefined = data.message;

  const updateData: QueryDeepPartialEntity<StatusPageAnnouncement> =
    data.trigger === SubscriberNotificationTrigger.Updated
      ? {
          subscriberNotificationStatusOnAnnouncementUpdated: data.status,
          ...(message !== undefined
            ? {
                subscriberNotificationStatusMessageOnAnnouncementUpdated:
                  message,
              }
            : {}),
        }
      : {
          subscriberNotificationStatus: data.status,
          ...(message !== undefined
            ? { subscriberNotificationStatusMessage: message }
            : {}),
        };

  await StatusPageAnnouncementService.updateOneById({
    id: data.announcementId,
    data: updateData,
    props: {
      isRoot: true,
      ignoreHooks: true,
    },
  });
};

const ANNOUNCEMENT_SELECT: Select<StatusPageAnnouncement> = {
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
};

const notifySubscribersOfAnnouncement: (data: {
  announcement: StatusPageAnnouncement;
  trigger: SubscriberNotificationTrigger;
  host: Hostname;
  httpProtocol: Protocol;
}) => Promise<void> = async (data: {
  announcement: StatusPageAnnouncement;
  trigger: SubscriberNotificationTrigger;
  host: Hostname;
  httpProtocol: Protocol;
}): Promise<void> => {
  const { announcement, trigger, host, httpProtocol } = data;
  const copy: AnnouncementNotificationCopy = NOTIFICATION_COPY[trigger];

  logger.debug(
    `Processing ${trigger} notification for announcement ${announcement.id} with ${announcement.statusPages?.length || 0} status page(s).`,
  );

  if (!announcement.statusPages) {
    logger.debug(
      `Announcement ${announcement.id} has no status pages; marking as Skipped.`,
    );
    await setNotificationStatus({
      announcementId: announcement.id!,
      trigger: trigger,
      status: StatusPageSubscriberNotificationStatus.Skipped,
      message:
        "No status pages attached to this announcement. Skipping notifications.",
    });
    return;
  }

  const statusPages: Array<StatusPage> =
    await StatusPageSubscriberService.getStatusPagesToSendNotification(
      announcement.statusPages.map((sp: StatusPage) => {
        return sp.id!;
      }),
    );

  await setNotificationStatus({
    announcementId: announcement.id!,
    trigger: trigger,
    status: StatusPageSubscriberNotificationStatus.InProgress,
  });
  logger.debug(
    `Announcement ${announcement.id} ${trigger} notification status set to InProgress.`,
  );

  try {
    /*
     * Pre-compute markdown conversions for announcement.description once
     * per announcement. These values do not vary per status page or per
     * subscriber, so memoizing here avoids N redundant markdown parses
     * during fan-out (the HTML version was previously recomputed inside
     * the per-subscriber loop).
     */
    const announcementDescriptionHtml: string = await Markdown.convertToHTML(
      announcement.description || "",
      MarkdownContentType.Email,
    );
    const announcementDescriptionPlainText: string =
      Markdown.convertToPlainText(announcement.description || "");

    let notificationSentToAtLeastOneSubscriber: boolean = false;

    for (const statuspage of statusPages) {
      try {
        if (!statuspage.id) {
          logger.debug("Encountered a status page without an id; skipping.");
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

        const statusPageURL: string = await StatusPageService.getStatusPageURL(
          statuspage.id,
        );
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
              eventType: copy.templateEventType,
              notificationMethod: StatusPageSubscriberNotificationMethod.Email,
            },
          ),
          StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
            {
              statusPageId: statuspage.id!,
              eventType: copy.templateEventType,
              notificationMethod: StatusPageSubscriberNotificationMethod.SMS,
            },
          ),
          StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
            {
              statusPageId: statuspage.id!,
              eventType: copy.templateEventType,
              notificationMethod: StatusPageSubscriberNotificationMethod.Slack,
            },
          ),
          StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
            {
              statusPageId: statuspage.id!,
              eventType: copy.templateEventType,
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
              statusPageGroupId: true,
              statusPageGroup: {
                name: true,
              },
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

        /*
         * Variables for this status page's custom templates, built once so
         * every channel offers the same set. resourcesAffected lists only the
         * announcement's resources on this page, and is empty when the
         * announcement is not scoped to any resources.
         *
         * Each channel gets the description and the resource list in the
         * format it renders. The email body is sent as HTML, so it gets
         * both as HTML. SMS and the email subject are plain text. Slack and
         * Teams render the description's Markdown as written, and show
         * "<br/>" literally, so they get the plain-text resource list.
         */
        const resourcesAffectedHtml: string =
          StatusPageResourceUtil.getResourcesGroupedByGroupName(
            statusPageResources,
          );
        const resourcesAffectedPlainText: string =
          StatusPageResourceUtil.getResourcesGroupedByGroupNameAsPlainText(
            statusPageResources,
          );

        const templateVariables: Record<string, string> = {
          statusPageName: statusPageName,
          statusPageUrl: statusPageURL,
          detailsUrl: announcementDetailsUrl,
          announcementTitle: announcement.title || "",
        };

        const emailBodyTemplateVariables: Record<string, string> = {
          ...templateVariables,
          resourcesAffected: resourcesAffectedHtml,
          announcementDescription: announcementDescriptionHtml,
        };

        const plainTextTemplateVariables: Record<string, string> = {
          ...templateVariables,
          resourcesAffected: resourcesAffectedPlainText,
          announcementDescription: announcementDescriptionPlainText,
        };

        const markdownTemplateVariables: Record<string, string> = {
          ...templateVariables,
          resourcesAffected: resourcesAffectedPlainText,
          announcementDescription: announcement.description || "",
        };

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

            notificationSentToAtLeastOneSubscriber = true;

            const unsubscribeUrl: string =
              StatusPageSubscriberService.getUnsubscribeLink(
                URL.fromString(statusPageURL),
                subscriber.id!,
              ).toString();

            logger.debug(
              `Prepared unsubscribe link for subscriber ${subscriber._id} for announcement ${announcement.id}.`,
            );

            const subscriberEmailBodyTemplateVariables: Dictionary<string> = {
              ...emailBodyTemplateVariables,
              unsubscribeUrl: unsubscribeUrl,
            };
            const subscriberPlainTextTemplateVariables: Dictionary<string> = {
              ...plainTextTemplateVariables,
              unsubscribeUrl: unsubscribeUrl,
            };
            const subscriberMarkdownTemplateVariables: Dictionary<string> = {
              ...markdownTemplateVariables,
              unsubscribeUrl: unsubscribeUrl,
            };

            if (subscriber.subscriberPhone) {
              const phoneStr: string = subscriber.subscriberPhone.toString();
              const phoneMasked: string = `${phoneStr.slice(0, 2)}******${phoneStr.slice(-2)}`;
              logger.debug(
                `Queueing SMS notification to subscriber ${subscriber._id} at ${phoneMasked} for announcement ${announcement.id}.`,
              );

              // Build SMS message - use custom template if available and custom Twilio is configured
              let smsMessage: string;
              if (smsTemplate?.templateBody && statuspage.callSmsConfig) {
                // SMS is plain text (no HTML/Markdown).
                smsMessage =
                  StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    smsTemplate.templateBody,
                    subscriberPlainTextTemplateVariables,
                  );
              } else {
                smsMessage = `${copy.smsPrefix} ${announcement.title || ""} on ${statusPageName}. Details: ${announcementDetailsUrl}. Unsub: ${unsubscribeUrl}`;
              }

              const sms: SMS = {
                message: smsMessage,
                to: subscriber.subscriberPhone,
              };

              // send sms here.
              SmsService.sendSms(sms, {
                projectId: statuspage.projectId,
                customTwilioConfig: ProjectCallSMSConfigService.toTwilioConfig(
                  statuspage.callSmsConfig,
                ),
                statusPageId: statuspage.id!,
                statusPageAnnouncementId: announcement.id!,
              }).catch((err: Error) => {
                /*
                 * Delivery to a channel the SUBSCRIBER chose: their mailbox, their
                 * phone, their Slack/Teams webhook, their HTTP endpoint. A bounce, a
                 * 404 on a deleted webhook or an unreachable host is their side of the
                 * wire, not a OneUptime defect — and one status page can fan out to
                 * thousands of subscribers, so leaving these at ERROR buries real
                 * failures under a single tenant's dead webhook.
                 */
                logger.error(err, EXTERNAL_FAULT);
              });
            }

            if (subscriber.slackIncomingWebhookUrl) {
              logger.debug(
                `Queueing Slack notification to subscriber ${subscriber._id} for announcement ${announcement.id}.`,
              );

              // Build Slack message - use custom template if available
              let slackMessage: string;
              if (slackTemplate?.templateBody) {
                // Slack gets the raw markdown description.
                slackMessage =
                  StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    slackTemplate.templateBody,
                    subscriberMarkdownTemplateVariables,
                  );
              } else {
                // Default markdown message
                slackMessage = `## ${copy.chatHeading} - ${announcement.title || ""}

**Description:** ${announcement.description || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
              }

              // send Slack notification here.
              SlackUtil.sendMessageToChannelViaIncomingWebhook({
                url: subscriber.slackIncomingWebhookUrl,
                text: SlackUtil.convertMarkdownToSlackRichText(slackMessage),
              }).catch((err: Error) => {
                logger.error(err, EXTERNAL_FAULT);
              });
            }

            if (subscriber.microsoftTeamsIncomingWebhookUrl) {
              logger.debug(
                `Queueing Microsoft Teams notification to subscriber ${subscriber._id} for announcement ${announcement.id}.`,
              );

              // Build Teams message - use custom template if available
              let teamsMessage: string;
              if (teamsTemplate?.templateBody) {
                // Teams gets the raw markdown description.
                teamsMessage =
                  StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    teamsTemplate.templateBody,
                    subscriberMarkdownTemplateVariables,
                  );
              } else {
                // Default markdown message
                teamsMessage = `## ${copy.chatHeading} - ${announcement.title || ""}

**Description:** ${announcement.description || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
              }

              // send Teams notification here.
              MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
                url: subscriber.microsoftTeamsIncomingWebhookUrl,
                text: teamsMessage,
              }).catch((err: Error) => {
                logger.error(err, EXTERNAL_FAULT);
              });
            }

            if (subscriber.subscriberWebhook) {
              logger.debug(
                `Queueing webhook notification to subscriber ${subscriber._id} for announcement ${announcement.id}.`,
              );

              StatusPageSubscriberWebhookUtil.sendWebhookNotification({
                webhookUrl: subscriber.subscriberWebhook,
                payload: {
                  eventType: copy.webhookEventType,
                  statusPageId: statuspage.id!.toString(),
                  statusPageName: statusPageName,
                  statusPageUrl: statusPageURL,
                  unsubscribeUrl: unsubscribeUrl,
                  data: {
                    announcementId: announcement.id?.toString() || "",
                    announcementTitle: announcement.title || "",
                    announcementDescription: announcement.description || "",
                    detailsUrl: announcementDetailsUrl,
                  },
                },
              }).catch((err: Error) => {
                logger.error(err, EXTERNAL_FAULT);
              });
            }

            if (subscriber.subscriberEmail) {
              // send email here.
              logger.debug(
                `Queueing email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail} for announcement ${announcement.id}.`,
              );

              /*
               * Prepare email content - use custom template if available.
               * announcementDescriptionHtml is memoized at the per-announcement
               * scope above; reusing it here.
               */
              let emailSubject: string =
                copy.emailSubjectPrefix + announcement.title;

              if (emailTemplate?.templateBody && statuspage.smtpConfig) {
                // Use custom template with BlankTemplate only when custom SMTP is configured
                const customEmailBody: string =
                  StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    emailTemplate.templateBody,
                    subscriberEmailBodyTemplateVariables,
                  );

                // Use custom subject if provided. A subject is plain text.
                if (emailTemplate.emailSubject) {
                  emailSubject =
                    StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                      emailTemplate.emailSubject,
                      subscriberPlainTextTemplateVariables,
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
                    isSubjectLiteral: true,
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
                  logger.error(err, EXTERNAL_FAULT);
                });
              } else {
                // Use default hard-coded template
                MailService.sendMail(
                  {
                    toEmail: subscriber.subscriberEmail,
                    templateType: copy.emailTemplateType,
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
                    isSubjectLiteral: true,
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
                  logger.error(err, EXTERNAL_FAULT);
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

    if (notificationSentToAtLeastOneSubscriber) {
      logger.debug(
        `Notifications sent to subscribers for announcement ${announcement.id}.`,
      );
    } else {
      logger.debug(
        `No subscribers were notified for announcement ${announcement.id}. All status pages either hide announcements or had no matching subscribers.`,
      );
    }

    // If we get here, the notification was successful
    await setNotificationStatus({
      announcementId: announcement.id!,
      trigger: trigger,
      status: StatusPageSubscriberNotificationStatus.Success,
      message: notificationSentToAtLeastOneSubscriber
        ? copy.successMessage
        : NO_MATCHING_SUBSCRIBERS_MESSAGE,
    });
    logger.debug(
      `Announcement ${announcement.id} ${trigger} notification marked as Success.`,
    );
  } catch (err) {
    // If there was an error, mark as failed
    logger.error(err);
    await setNotificationStatus({
      announcementId: announcement.id!,
      trigger: trigger,
      status: StatusPageSubscriberNotificationStatus.Failed,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

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
      await setNotificationStatus({
        announcementId: announcement.id!,
        trigger: SubscriberNotificationTrigger.Created,
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message:
          "Notifications skipped as subscribers are not to be notified for this announcement.",
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
        select: ANNOUNCEMENT_SELECT,
      });

    logger.debug(
      `Found ${announcements.length} announcements to notify subscribers for.`,
    );

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
    logger.debug(
      `Database host resolved as ${host.toString()} with protocol ${httpProtocol.toString()}.`,
    );

    for (const announcement of announcements) {
      await notifySubscribersOfAnnouncement({
        announcement: announcement,
        trigger: SubscriberNotificationTrigger.Created,
        host: host,
        httpProtocol: httpProtocol,
      });
    }
  },
);

/*
 * Sends the notification an editor asked for when they updated an
 * announcement (see SubscriberUpdateNotification). The status column is set
 * to Pending by StatusPageAnnouncementService when the edit carries that
 * request, and by the dashboard's retry button.
 */
RunCron(
  "Announcement:SendUpdateNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const announcements: Array<StatusPageAnnouncement> =
      await StatusPageAnnouncementService.findAllBy({
        query: {
          subscriberNotificationStatusOnAnnouncementUpdated:
            StatusPageSubscriberNotificationStatus.Pending,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          ...ANNOUNCEMENT_SELECT,
          subscriberNotificationStatus: true,
        },
      });

    logger.debug(
      `Found ${announcements.length} updated announcement(s) to notify subscribers about.`,
    );

    if (announcements.length === 0) {
      return;
    }

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    for (const announcement of announcements) {
      try {
        let skipReason: string | null =
          SubscriberUpdateNotification.getSkipReasonForOriginalNotificationStatus(
            announcement.subscriberNotificationStatus,
          );

        /*
         * An announcement scheduled for later is not on any status page yet,
         * so there is nothing for an "updated" message to point at. Whoever
         * is notified when it goes live sees the edited version.
         */
        if (
          !skipReason &&
          announcement.showAnnouncementAt &&
          OneUptimeDate.isInTheFuture(announcement.showAnnouncementAt)
        ) {
          skipReason =
            "This announcement is not shown on status pages yet, so subscribers were not notified about this update.";
        }

        if (skipReason) {
          logger.debug(
            `Skipping update notification for announcement ${announcement.id}: ${skipReason}`,
          );
          await setNotificationStatus({
            announcementId: announcement.id!,
            trigger: SubscriberNotificationTrigger.Updated,
            status: StatusPageSubscriberNotificationStatus.Skipped,
            message: skipReason,
          });
          continue;
        }

        await notifySubscribersOfAnnouncement({
          announcement: announcement,
          trigger: SubscriberNotificationTrigger.Updated,
          host: host,
          httpProtocol: httpProtocol,
        });
      } catch (err) {
        logger.error(err);
      }
    }
  },
);
