import RunCron from "../../Utils/Cron";
import { StatusPageApiRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import SMS from "Common/Types/SMS/SMS";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import ScheduledMaintenancePublicNoteService from "Common/Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500, Yellow500 } from "Common/Types/BrandColors";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import SubscriberNotificationTrigger from "Common/Types/StatusPage/SubscriberNotificationTrigger";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";
import QueryDeepPartialEntity from "Common/Types/Database/PartialEntity";

/*
 * Two jobs share this send path: one tells subscribers about a new public
 * note, the other about an edit to one whose editor asked for it. They differ
 * only in the wording below and in which status columns they track, so the
 * "posted" and "updated" notifications for a note can never disagree about
 * who is notified or how.
 */
interface ScheduledMaintenanceNoteNotificationCopy {
  templateEventType: StatusPageSubscriberNotificationEventType;
  emailTemplateType: EmailTemplateType;
  emailSubjectPrefix: string;
  customTemplateEmailSubjectPrefix: string;
  smsPrefix: string;
  chatNoteSentence: string;
  webhookEventType: string;
  feedSentReason: string;
  feedNotSentSubject: string;
  successMessage: string;
}

const NOTIFICATION_COPY: Record<
  SubscriberNotificationTrigger,
  ScheduledMaintenanceNoteNotificationCopy
> = {
  [SubscriberNotificationTrigger.Created]: {
    templateEventType:
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated,
    emailTemplateType:
      EmailTemplateType.SubscriberScheduledMaintenanceEventNoteCreated,
    emailSubjectPrefix: "[Update Scheduled Maintenance] ",
    customTemplateEmailSubjectPrefix: "[Scheduled Maintenance Update] ",
    smsPrefix: "Maintenance update:",
    chatNoteSentence: "New Note Added",
    webhookEventType: "ScheduledMaintenanceNoteCreated",
    feedSentReason: "a public note is added to",
    feedNotSentSubject: "the public note",
    successMessage: "Notifications sent successfully to all subscribers",
  },
  [SubscriberNotificationTrigger.Updated]: {
    templateEventType:
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated,
    emailTemplateType:
      EmailTemplateType.SubscriberScheduledMaintenanceEventNoteUpdated,
    emailSubjectPrefix: "[Scheduled Maintenance Note Updated] ",
    customTemplateEmailSubjectPrefix: "[Scheduled Maintenance Note Updated] ",
    smsPrefix: "Maintenance note updated:",
    chatNoteSentence: "Note Updated",
    webhookEventType: "ScheduledMaintenanceNoteUpdated",
    feedSentReason: "a public note was updated on",
    feedNotSentSubject: "the updated public note",
    successMessage: SubscriberUpdateNotification.sentMessage,
  },
};

const setNotificationStatus: (data: {
  noteId: ObjectID;
  trigger: SubscriberNotificationTrigger;
  status: StatusPageSubscriberNotificationStatus;
  message?: string | undefined;
}) => Promise<void> = async (data: {
  noteId: ObjectID;
  trigger: SubscriberNotificationTrigger;
  status: StatusPageSubscriberNotificationStatus;
  message?: string | undefined;
}): Promise<void> => {
  const message: string | undefined = data.message;

  const updateData: QueryDeepPartialEntity<ScheduledMaintenancePublicNote> =
    data.trigger === SubscriberNotificationTrigger.Updated
      ? {
          subscriberNotificationStatusOnNoteUpdated: data.status,
          ...(message !== undefined
            ? { subscriberNotificationStatusMessageOnNoteUpdated: message }
            : {}),
        }
      : {
          subscriberNotificationStatusOnNoteCreated: data.status,
          ...(message !== undefined
            ? { subscriberNotificationStatusMessage: message }
            : {}),
        };

  await ScheduledMaintenancePublicNoteService.updateOneById({
    id: data.noteId,
    data: updateData,
    props: {
      isRoot: true,
      ignoreHooks: true,
    },
  });
};

const notifySubscribersOfScheduledMaintenancePublicNote: (data: {
  publicNote: ScheduledMaintenancePublicNote;
  trigger: SubscriberNotificationTrigger;
  host: Hostname;
  httpProtocol: Protocol;
}) => Promise<void> = async (data: {
  publicNote: ScheduledMaintenancePublicNote;
  trigger: SubscriberNotificationTrigger;
  host: Hostname;
  httpProtocol: Protocol;
}): Promise<void> => {
  const { publicNote, trigger, host, httpProtocol } = data;
  const copy: ScheduledMaintenanceNoteNotificationCopy =
    NOTIFICATION_COPY[trigger];

  try {
    logger.debug(
      `Processing scheduled maintenance public note ${publicNote.id}.`,
    );
    // get all scheduled events of all the projects.
    const event: ScheduledMaintenance | null =
      await ScheduledMaintenanceService.findOneById({
        id: publicNote.scheduledMaintenanceId!,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
          description: true,
          projectId: true,
          startsAt: true,
          monitors: {
            _id: true,
          },
          statusPages: {
            _id: true,
          },
          isVisibleOnStatusPage: true,
          scheduledMaintenanceNumber: true,
        },
      });

    if (!event) {
      logger.debug(
        `Scheduled maintenance ${publicNote.scheduledMaintenanceId} not found; marking public note ${publicNote.id} as Skipped.`,
      );
      await setNotificationStatus({
        noteId: publicNote.id!,
        trigger: trigger,
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message:
          "Related scheduled maintenance not found. Skipping notifications to subscribers.",
      });
      return;
    }

    // Set status to InProgress
    await setNotificationStatus({
      noteId: publicNote.id!,
      trigger: trigger,
      status: StatusPageSubscriberNotificationStatus.InProgress,
    });
    logger.debug(
      `Public note ${publicNote.id} status set to InProgress for subscriber notifications.`,
    );

    if (!event.isVisibleOnStatusPage) {
      // Set status to Skipped for non-visible events
      logger.debug(
        `Scheduled maintenance ${event.id} is not visible on status page; marking public note ${publicNote.id} as Skipped.`,
      );
      await setNotificationStatus({
        noteId: publicNote.id!,
        trigger: trigger,
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message:
          "Notifications skipped as scheduled maintenance is not visible on status page.",
      });
      return; // skip if not visible on status page.
    } // get status page resources from monitors.

    let statusPageResources: Array<StatusPageResource> = [];

    if (event.monitors && event.monitors.length > 0) {
      statusPageResources = await StatusPageResourceService.findAllBy({
        query: {
          monitorId: QueryHelper.any(
            event.monitors
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
        skip: 0,
        select: {
          _id: true,
          displayName: true,
          statusPageId: true,
        },
      });
    }

    logger.debug(
      `Found ${statusPageResources.length} status page resource(s) for scheduled maintenance ${event.id}.`,
    );

    const statusPageToResources: Dictionary<Array<StatusPageResource>> = {};

    for (const resource of statusPageResources) {
      if (!resource.statusPageId) {
        continue;
      }

      if (!statusPageToResources[resource.statusPageId?.toString()]) {
        statusPageToResources[resource.statusPageId?.toString()] = [];
      }

      statusPageToResources[resource.statusPageId?.toString()]?.push(resource);
    }

    logger.debug(
      `Scheduled maintenance ${event.id} maps to ${Object.keys(statusPageToResources).length} status page(s) for public note notifications.`,
    );

    const statusPages: Array<StatusPage> =
      await StatusPageSubscriberService.getStatusPagesToSendNotification(
        event.statusPages?.map((i: StatusPage) => {
          return i.id!;
        }) || [],
      );

    if (!statusPages || statusPages.length === 0) {
      logger.debug(
        `No status pages found to notify for public note ${publicNote.id}; marking as Skipped.`,
      );
      await setNotificationStatus({
        noteId: publicNote.id!,
        trigger: trigger,
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message:
          "No status pages are configured for this scheduled maintenance. Skipping notifications.",
      });
      return;
    }

    /*
     * Pre-compute markdown conversions for the note once per public note.
     * These values do not vary per status page or per subscriber, so
     * memoizing here avoids N redundant markdown parses during fan-out.
     */
    const noteHtml: string = await Markdown.convertToHTML(
      publicNote.note || "",
      MarkdownContentType.Email,
    );
    const notePlainText: string = Markdown.convertToPlainText(
      publicNote.note || "",
    );

    let notificationSentToAtLeastOneSubscriber: boolean = false;

    for (const statuspage of statusPages) {
      if (!statuspage.id) {
        logger.debug("Encountered a status page without an id; skipping.");
        continue;
      }

      if (!statuspage.showScheduledMaintenanceEventsOnStatusPage) {
        logger.debug(
          `Status page ${statuspage.id} hides scheduled maintenance events; skipping.`,
        );
        continue; // Do not send notification to subscribers if scheduledMaintenances are not visible on status page.
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

      const scheduledEventDetailsUrl: string =
        event.id && statusPageURL
          ? URL.fromString(statusPageURL)
              .addRoute(`/scheduled-events/${event.id.toString()}`)
              .toString()
          : statusPageURL;

      logger.debug(
        `Status page ${statuspage.id} (${statusPageName}) has ${subscribers.length} subscriber(s) for public note ${publicNote.id}.`,
      );

      // Fetch custom templates for this status page (if any)
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

      /*
       * Custom templates get each value in the format their channel renders:
       * HTML for the email body (it is wrapped only by BlankTemplate), plain
       * text for SMS and the email subject, and Markdown for Slack and Teams.
       * The conversions are the memoized ones computed once per public note
       * above.
       */
      const templateVariables: Record<string, string> = {
        statusPageName: statusPageName,
        statusPageUrl: statusPageURL,
        detailsUrl: scheduledEventDetailsUrl,
        scheduledMaintenanceTitle: event.title || "",
        scheduledMaintenanceState:
          OneUptimeDate.getDateAsUserFriendlyFormattedString(event.startsAt!),
        postedAt: OneUptimeDate.getDateAsUserFriendlyFormattedString(
          OneUptimeDate.getCurrentDate(),
        ),
      };

      const emailBodyTemplateVariables: Record<string, string> = {
        ...templateVariables,
        note: noteHtml,
      };

      const plainTextTemplateVariables: Record<string, string> = {
        ...templateVariables,
        note: notePlainText,
      };

      const markdownTemplateVariables: Record<string, string> = {
        ...templateVariables,
        note: publicNote.note || "",
      };

      // Send email to Email subscribers.

      for (const subscriber of subscribers) {
        if (!subscriber._id) {
          logger.debug("Encountered a subscriber without an _id; skipping.");
          continue;
        }

        const shouldNotifySubscriber: boolean =
          StatusPageSubscriberService.shouldSendNotification({
            subscriber: subscriber,
            statusPageResources: statusPageToResources[statuspage._id!] || [],
            statusPage: statuspage,
            eventType: StatusPageEventType.ScheduledEvent,
          });

        if (!shouldNotifySubscriber) {
          logger.debug(
            `Skipping subscriber ${subscriber._id} based on preferences for public note ${publicNote.id}.`,
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
          `Prepared unsubscribe link for subscriber ${subscriber._id} for public note ${publicNote.id}.`,
        );

        // Add unsubscribeUrl to template variables
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
            `Queueing SMS notification to subscriber ${subscriber._id} at ${phoneMasked} for public note ${publicNote.id}.`,
          );

          let smsMessage: string;
          if (smsTemplate?.templateBody && statuspage.callSmsConfig) {
            // Use custom template only when custom Twilio is configured
            smsMessage =
              StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                smsTemplate.templateBody,
                subscriberPlainTextTemplateVariables,
              );
          } else {
            // Use default hard-coded template
            smsMessage = `${copy.smsPrefix} ${event.title || ""} on ${statusPageName}. Details: ${scheduledEventDetailsUrl}. Unsub: ${unsubscribeUrl}`;
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
            scheduledMaintenanceId: event.id!,
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
            `Queueing Slack notification to subscriber ${subscriber._id} for public note ${publicNote.id}.`,
          );

          let markdownMessage: string;
          if (slackTemplate?.templateBody) {
            // Use custom template
            markdownMessage =
              StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                slackTemplate.templateBody,
                subscriberMarkdownTemplateVariables,
              );
          } else {
            // Use default hard-coded template
            markdownMessage = `## Scheduled Maintenance Update - ${statusPageName}

**Event:** ${event.title || ""}

**${copy.chatNoteSentence}**

**Note:** ${publicNote.note || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
          }

          // send Slack notification with markdown conversion
          SlackUtil.sendMessageToChannelViaIncomingWebhook({
            url: subscriber.slackIncomingWebhookUrl,
            text: SlackUtil.convertMarkdownToSlackRichText(markdownMessage),
          }).catch((err: Error) => {
            logger.error(err, EXTERNAL_FAULT);
          });
        }

        if (subscriber.microsoftTeamsIncomingWebhookUrl) {
          logger.debug(
            `Queueing Microsoft Teams notification to subscriber ${subscriber._id} for public note ${publicNote.id}.`,
          );

          let markdownMessage: string;
          if (teamsTemplate?.templateBody) {
            // Use custom template
            markdownMessage =
              StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                teamsTemplate.templateBody,
                subscriberMarkdownTemplateVariables,
              );
          } else {
            // Use default hard-coded template
            markdownMessage = `## Scheduled Maintenance Update - ${statusPageName}

**Event:** ${event.title || ""}

**${copy.chatNoteSentence}**

**Note:** ${publicNote.note || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
          }

          // send Teams notification
          MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
            url: subscriber.microsoftTeamsIncomingWebhookUrl,
            text: markdownMessage,
          }).catch((err: Error) => {
            logger.error(err, EXTERNAL_FAULT);
          });
        }

        if (subscriber.subscriberWebhook) {
          const resourcesAffectedStr: string =
            statusPageToResources[statuspage._id!]
              ?.map((r: StatusPageResource) => {
                return r.displayName;
              })
              .join(", ") || "";

          StatusPageSubscriberWebhookUtil.sendWebhookNotification({
            webhookUrl: subscriber.subscriberWebhook,
            payload: {
              eventType: copy.webhookEventType,
              statusPageId: statuspage.id!.toString(),
              statusPageName: statusPageName,
              statusPageUrl: statusPageURL,
              unsubscribeUrl: unsubscribeUrl,
              data: {
                scheduledMaintenanceId: event.id?.toString() || "",
                scheduledMaintenanceTitle: event.title || "",
                scheduledMaintenanceDescription: event.description || "",
                resourcesAffected: resourcesAffectedStr,
                note: publicNote.note || "",
                detailsUrl: scheduledEventDetailsUrl,
              },
            },
          }).catch((err: Error) => {
            logger.error(err, EXTERNAL_FAULT);
          });
        }

        if (subscriber.subscriberEmail) {
          // send email here.
          logger.debug(
            `Queueing email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail} for public note ${publicNote.id}.`,
          );

          if (emailTemplate?.templateBody && statuspage.smtpConfig) {
            // Use custom template with BlankTemplate only when custom SMTP is configured
            const compiledBody: string =
              StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                emailTemplate.templateBody,
                subscriberEmailBodyTemplateVariables,
              );
            const compiledSubject: string = emailTemplate.emailSubject
              ? StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                  emailTemplate.emailSubject,
                  subscriberPlainTextTemplateVariables,
                )
              : copy.customTemplateEmailSubjectPrefix + event.title || "";

            MailService.sendMail(
              {
                toEmail: subscriber.subscriberEmail,
                templateType: EmailTemplateType.BlankTemplate,
                vars: {
                  body: compiledBody,
                },
                subject: compiledSubject,
              },
              {
                mailServer: ProjectSmtpConfigService.toEmailServer(
                  statuspage.smtpConfig,
                ),
                projectId: statuspage.projectId!,
                statusPageId: statuspage.id!,
                scheduledMaintenanceId: event.id!,
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
                  note: noteHtml,
                  statusPageName: statusPageName,
                  statusPageUrl: statusPageURL,
                  detailsUrl: scheduledEventDetailsUrl,
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
                  resourcesAffected:
                    statusPageToResources[statuspage._id!]
                      ?.map((r: StatusPageResource) => {
                        return r.displayName;
                      })
                      .join(", ") || "",
                  scheduledAt:
                    OneUptimeDate.getDateAsUserFriendlyFormattedString(
                      event.startsAt!,
                    ),
                  eventTitle: event.title || "",
                  eventDescription: event.description || "",
                  unsubscribeUrl: unsubscribeUrl,
                  subscriberEmailNotificationFooterText:
                    StatusPageServiceType.getSubscriberEmailFooterText(
                      statuspage,
                    ),
                },
                subject: copy.emailSubjectPrefix + event.title,
              },
              {
                mailServer: ProjectSmtpConfigService.toEmailServer(
                  statuspage.smtpConfig,
                ),
                projectId: statuspage.projectId!,
                statusPageId: statuspage.id!,
                scheduledMaintenanceId: event.id!,
              },
            ).catch((err: Error) => {
              logger.error(err, EXTERNAL_FAULT);
            });
          }
          logger.debug(
            `Email notification queued for subscriber ${subscriber._id} for public note ${publicNote.id}.`,
          );
        }
      }
    }

    if (notificationSentToAtLeastOneSubscriber) {
      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
        scheduledMaintenanceId: event.id!,
        projectId: event.projectId!,
        scheduledMaintenanceFeedEventType:
          ScheduledMaintenanceFeedEventType.SubscriberNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: `📧 **Notification sent to subscribers** because ${copy.feedSentReason} this [Scheduled Maintenance ${event.scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(event.projectId!, event.id!)).toString()}).`,
        moreInformationInMarkdown: `**Public Note:**

${publicNote.note}`,
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });
    } else {
      logger.debug(
        `No subscribers were notified for public note on scheduled maintenance: ${event.id}. All status pages either hide scheduled maintenance events or had no matching subscribers.`,
      );

      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
        scheduledMaintenanceId: event.id!,
        projectId: event.projectId!,
        scheduledMaintenanceFeedEventType:
          ScheduledMaintenanceFeedEventType.SubscriberNotificationSent,
        displayColor: Yellow500,
        feedInfoInMarkdown: `📧 **No notification sent to subscribers** for ${copy.feedNotSentSubject} on [Scheduled Maintenance ${event.scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(event.projectId!, event.id!)).toString()}).`,
        moreInformationInMarkdown:
          "Subscriber notifications were skipped because all associated status pages either hide scheduled maintenance events or had no matching subscribers.",
        workspaceNotification: {
          sendWorkspaceNotification: false,
        },
      });
    }

    // Set status to Success after successful notification
    await setNotificationStatus({
      noteId: publicNote.id!,
      trigger: trigger,
      status: StatusPageSubscriberNotificationStatus.Success,
      message: copy.successMessage,
    });
    logger.debug(
      `Scheduled maintenance public note ${publicNote.id} marked as Success for subscriber notifications.`,
    );
  } catch (err) {
    logger.error(
      `Error sending notification for scheduled maintenance public note ${publicNote.id}: ${err}`,
    );

    // Set status to Failed with error reason
    await setNotificationStatus({
      noteId: publicNote.id!,
      trigger: trigger,
      status: StatusPageSubscriberNotificationStatus.Failed,
      message: (err as Error).message,
    });
  }
};

RunCron(
  "ScheduledMaintenancePublicNote:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduledMaintenance notes of all the projects

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const publicNotes: Array<ScheduledMaintenancePublicNote> =
      await ScheduledMaintenancePublicNoteService.findAllBy({
        query: {
          subscriberNotificationStatusOnNoteCreated:
            StatusPageSubscriberNotificationStatus.Pending,
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          note: true,
          scheduledMaintenanceId: true,
        },
      });

    logger.debug(
      `Found ${publicNotes.length} scheduled maintenance public note(s) to notify subscribers for.`,
    );

    for (const publicNote of publicNotes) {
      await notifySubscribersOfScheduledMaintenancePublicNote({
        publicNote: publicNote,
        trigger: SubscriberNotificationTrigger.Created,
        host: host,
        httpProtocol: httpProtocol,
      });
    }
  },
);

/*
 * Sends the notification an editor asked for when they updated a public note
 * (see SubscriberUpdateNotification). ScheduledMaintenancePublicNoteService
 * sets the status column to Pending when an edit carries that request, and
 * the dashboard's retry button does the same after a failure.
 */
RunCron(
  "ScheduledMaintenancePublicNote:SendUpdateNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const updatedNotes: Array<ScheduledMaintenancePublicNote> =
      await ScheduledMaintenancePublicNoteService.findAllBy({
        query: {
          subscriberNotificationStatusOnNoteUpdated:
            StatusPageSubscriberNotificationStatus.Pending,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          note: true,
          scheduledMaintenanceId: true,
          subscriberNotificationStatusOnNoteCreated: true,
        },
      });

    logger.debug(
      `Found ${updatedNotes.length} updated scheduled maintenance public note(s) to notify subscribers about.`,
    );

    if (updatedNotes.length === 0) {
      return;
    }

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    for (const publicNote of updatedNotes) {
      try {
        const skipReason: string | null =
          SubscriberUpdateNotification.getSkipReasonForOriginalNotificationStatus(
            publicNote.subscriberNotificationStatusOnNoteCreated,
          );

        if (skipReason) {
          logger.debug(
            `Skipping update notification for scheduled maintenance public note ${publicNote.id}: ${skipReason}`,
          );
          await setNotificationStatus({
            noteId: publicNote.id!,
            trigger: SubscriberNotificationTrigger.Updated,
            status: StatusPageSubscriberNotificationStatus.Skipped,
            message: skipReason,
          });
          continue;
        }

        await notifySubscribersOfScheduledMaintenancePublicNote({
          publicNote: publicNote,
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
