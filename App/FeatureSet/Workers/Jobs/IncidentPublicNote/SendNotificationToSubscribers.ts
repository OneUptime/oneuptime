import RunCron from "../../Utils/Cron";
import { StatusPageApiRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import SMS from "Common/Types/SMS/SMS";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import IncidentPublicNoteService from "Common/Server/Services/IncidentPublicNoteService";
import IncidentService from "Common/Server/Services/IncidentService";
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import { Blue500, Yellow500 } from "Common/Types/BrandColors";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import StatusPageResourceUtil from "Common/Server/Utils/StatusPageResource";
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
interface IncidentNoteNotificationCopy {
  templateEventType: StatusPageSubscriberNotificationEventType;
  emailTemplateType: EmailTemplateType;
  emailSubjectPrefix: string;
  customTemplateEmailSubjectPrefix: string;
  smsNoteSentence: string;
  chatNoteSentence: string;
  webhookEventType: string;
  feedSentReason: string;
  feedNotSentSubject: string;
  successMessage: string;
}

const NOTIFICATION_COPY: Record<
  SubscriberNotificationTrigger,
  IncidentNoteNotificationCopy
> = {
  [SubscriberNotificationTrigger.Created]: {
    templateEventType:
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
    emailTemplateType: EmailTemplateType.SubscriberIncidentNoteCreated,
    emailSubjectPrefix: "[Update Incident] ",
    customTemplateEmailSubjectPrefix: "[Incident Update] ",
    smsNoteSentence: "A new note is posted.",
    chatNoteSentence: "New note has been added to an incident",
    webhookEventType: "IncidentNoteCreated",
    feedSentReason: "a public note is added to",
    feedNotSentSubject: "the public note",
    successMessage: "Notifications sent successfully to all subscribers",
  },
  [SubscriberNotificationTrigger.Updated]: {
    templateEventType:
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated,
    emailTemplateType: EmailTemplateType.SubscriberIncidentNoteUpdated,
    emailSubjectPrefix: "[Incident Note Updated] ",
    customTemplateEmailSubjectPrefix: "[Incident Note Updated] ",
    smsNoteSentence: "A note has been updated.",
    chatNoteSentence: "A note on this incident has been updated",
    webhookEventType: "IncidentNoteUpdated",
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

  const updateData: QueryDeepPartialEntity<IncidentPublicNote> =
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

  await IncidentPublicNoteService.updateOneById({
    id: data.noteId,
    data: updateData,
    props: {
      isRoot: true,
      ignoreHooks: true,
    },
  });
};

const notifySubscribersOfIncidentPublicNote: (data: {
  incidentPublicNote: IncidentPublicNote;
  trigger: SubscriberNotificationTrigger;
  host: Hostname;
  httpProtocol: Protocol;
}) => Promise<void> = async (data: {
  incidentPublicNote: IncidentPublicNote;
  trigger: SubscriberNotificationTrigger;
  host: Hostname;
  httpProtocol: Protocol;
}): Promise<void> => {
  const { incidentPublicNote, trigger, host, httpProtocol } = data;
  const copy: IncidentNoteNotificationCopy = NOTIFICATION_COPY[trigger];

  try {
    logger.debug(`Processing incident public note ${incidentPublicNote.id}.`, {
      projectId: incidentPublicNote.projectId?.toString(),
      incidentId: incidentPublicNote.incidentId?.toString(),
    });
    if (!incidentPublicNote.incidentId) {
      logger.debug(
        `Incident public note ${incidentPublicNote.id} has no incidentId; skipping.`,
        {
          projectId: incidentPublicNote.projectId?.toString(),
        },
      );
      return; // skip if incidentId is not set
    }

    // get all scheduled events of all the projects.
    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentPublicNote.incidentId!,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        title: true,
        description: true,
        projectId: true,
        monitors: {
          _id: true,
        },
        incidentSeverity: {
          name: true,
        },
        // Templates offer {{incidentState}}: the incident's state right now.
        currentIncidentState: {
          name: true,
        },
        isVisibleOnStatusPage: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
      },
    });

    if (!incident) {
      logger.debug(
        `Incident ${incidentPublicNote.incidentId} not found; marking public note ${incidentPublicNote.id} as Skipped.`,
        {
          projectId: incidentPublicNote.projectId?.toString(),
          incidentId: incidentPublicNote.incidentId?.toString(),
        },
      );
      await setNotificationStatus({
        noteId: incidentPublicNote.id!,
        trigger: trigger,
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message:
          "Related incident not found. Skipping notifications to subscribers.",
      });
      return;
    }

    if (!incident.monitors || incident.monitors.length === 0) {
      logger.debug(
        `Incident ${incident.id} has no monitors; marking public note ${incidentPublicNote.id} as Skipped.`,
        {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        },
      );
      await setNotificationStatus({
        noteId: incidentPublicNote.id!,
        trigger: trigger,
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message:
          "No monitors are attached to the related incident. Skipping notifications.",
      });
      return;
    }

    // Set status to InProgress
    await setNotificationStatus({
      noteId: incidentPublicNote.id!,
      trigger: trigger,
      status: StatusPageSubscriberNotificationStatus.InProgress,
    });
    logger.debug(
      `Incident public note ${incidentPublicNote.id} status set to InProgress for subscriber notifications.`,
      {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
      },
    );

    if (!incident.isVisibleOnStatusPage) {
      // Set status to Skipped for non-visible incidents
      logger.debug(
        `Incident ${incident.id} is not visible on status page; marking public note ${incidentPublicNote.id} as Skipped.`,
        {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        },
      );
      await setNotificationStatus({
        noteId: incidentPublicNote.id!,
        trigger: trigger,
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message:
          "Notifications skipped as incident is not visible on status page.",
      });
      return;
    }

    // get status page resources from monitors.

    const statusPageResources: Array<StatusPageResource> =
      await StatusPageResourceService.findByMonitors({
        monitors: incident.monitors,
        select: {
          _id: true,
          displayName: true,
          statusPageId: true,
          statusPageGroupId: true,
          statusPageGroup: {
            name: true,
          },
        },
      });

    logger.debug(
      `Found ${statusPageResources.length} status page resource(s) for incident ${incident.id}.`,
      {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
      },
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
      `Incident ${incident.id} maps to ${Object.keys(statusPageToResources).length} status page(s) for public note notifications.`,
      {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
      },
    );

    const statusPages: Array<StatusPage> =
      await StatusPageSubscriberService.getStatusPagesToSendNotification(
        Object.keys(statusPageToResources).map((i: string) => {
          return new ObjectID(i);
        }),
      );

    /*
     * Pre-compute markdown conversions for the note once per public note.
     * These values do not vary per status page or per subscriber, so
     * memoizing here avoids N redundant markdown parses during fan-out.
     */
    const noteHtml: string = await Markdown.convertToHTML(
      incidentPublicNote.note || "",
      MarkdownContentType.Email,
    );
    const notePlainText: string = Markdown.convertToPlainText(
      incidentPublicNote.note || "",
    );

    /*
     * {{postedAt}} is when the note says it was posted, which the author can
     * edit, so an update notification reads it fresh from the row. Only a
     * legacy row with no postedAt falls back to the time of sending.
     */
    const notePostedAt: string =
      OneUptimeDate.getDateAsUserFriendlyFormattedString(
        incidentPublicNote.postedAt || OneUptimeDate.getCurrentDate(),
      );

    let notificationSentToAtLeastOneSubscriber: boolean = false;

    for (const statuspage of statusPages) {
      if (!statuspage.id) {
        logger.debug("Encountered a status page without an id; skipping.", {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        });
        continue;
      }

      if (!statuspage.showIncidentsOnStatusPage) {
        logger.debug(
          `Status page ${statuspage.id} hides incidents; skipping.`,
          {
            projectId: incident.projectId?.toString(),
            incidentId: incident.id?.toString(),
          },
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

      const incidentDetailsUrl: string =
        incident.id && statusPageURL
          ? URL.fromString(statusPageURL)
              .addRoute(`/incidents/${incident.id.toString()}`)
              .toString()
          : statusPageURL;

      logger.debug(
        `Status page ${statuspage.id} (${statusPageName}) has ${subscribers.length} subscriber(s) for public note ${incidentPublicNote.id}.`,
        {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        },
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

      // Prepare template variables for custom templates
      const resourcesAffectedString: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupName(
          statusPageToResources[statuspage._id!] || [],
        );

      /*
       * Every variable SubscriberNotificationTemplateVariables advertises for
       * the incident note events, built once per status page. Each channel
       * below uses this object (SMS only swaps the note for plain text, and
       * every channel adds the subscriber's unsubscribeUrl), so no channel
       * can miss a variable the others have.
       */
      const templateVariables: Record<string, string> = {
        statusPageName: statusPageName,
        statusPageUrl: statusPageURL,
        detailsUrl: incidentDetailsUrl,
        resourcesAffected: resourcesAffectedString,
        incidentSeverity: incident.incidentSeverity?.name || " - ",
        incidentTitle: incident.title || "",
        incidentState: incident.currentIncidentState?.name || "",
        postedAt: notePostedAt,
        note: incidentPublicNote.note || "",
      };

      /*
       * Prepare SMS-specific template variables with plain text (no HTML/Markdown).
       * Uses the memoized plain-text conversion computed once per public note above.
       */
      const smsTemplateVariables: Record<string, string> = {
        ...templateVariables,
        note: notePlainText,
      };

      // Send email to Email subscribers.

      for (const subscriber of subscribers) {
        if (!subscriber._id) {
          logger.debug("Encountered a subscriber without an _id; skipping.", {
            projectId: incident.projectId?.toString(),
            incidentId: incident.id?.toString(),
          });
          continue;
        }

        const shouldNotifySubscriber: boolean =
          StatusPageSubscriberService.shouldSendNotification({
            subscriber: subscriber,
            statusPageResources: statusPageToResources[statuspage._id!] || [],
            statusPage: statuspage,
            eventType: StatusPageEventType.Incident,
          });

        if (!shouldNotifySubscriber) {
          logger.debug(
            `Skipping subscriber ${subscriber._id} based on preferences for public note ${incidentPublicNote.id}.`,
            {
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            },
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
          `Prepared unsubscribe link for subscriber ${subscriber._id} for public note ${incidentPublicNote.id}.`,
          {
            projectId: incident.projectId?.toString(),
            incidentId: incident.id?.toString(),
          },
        );

        // Add unsubscribeUrl to template variables
        const subscriberTemplateVariables: Record<string, string> = {
          ...templateVariables,
          unsubscribeUrl: unsubscribeUrl,
        };

        if (subscriber.subscriberPhone) {
          const phoneStr: string = subscriber.subscriberPhone.toString();
          const phoneMasked: string = `${phoneStr.slice(0, 2)}******${phoneStr.slice(-2)}`;
          logger.debug(
            `Queueing SMS notification to subscriber ${subscriber._id} at ${phoneMasked} for public note ${incidentPublicNote.id}.`,
            {
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            },
          );

          // SMS-specific template variables with unsubscribe URL
          const subscriberSmsTemplateVariables: Record<string, string> = {
            ...smsTemplateVariables,
            unsubscribeUrl: unsubscribeUrl,
          };

          let smsMessage: string;
          if (smsTemplate?.templateBody && statuspage.callSmsConfig) {
            // Use custom template only when custom Twilio is configured
            smsMessage =
              StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                smsTemplate.templateBody,
                subscriberSmsTemplateVariables,
              );
          } else {
            // Use default hard-coded template
            smsMessage = `Incident update: ${incident.title || "-"} on ${statusPageName}. ${copy.smsNoteSentence} Details: ${incidentDetailsUrl}. Unsub: ${unsubscribeUrl}`;
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
            incidentId: incident.id!,
          }).catch((err: Error) => {
            /*
             * Delivery to a channel the SUBSCRIBER chose: their mailbox, their
             * phone, their Slack/Teams webhook, their HTTP endpoint. A bounce, a
             * 404 on a deleted webhook or an unreachable host is their side of the
             * wire, not a OneUptime defect — and one status page can fan out to
             * thousands of subscribers, so leaving these at ERROR buries real
             * failures under a single tenant's dead webhook.
             */
            logger.error(err, {
              ...EXTERNAL_FAULT,
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            });
          });
        }

        if (subscriber.subscriberEmail) {
          // send email here.
          logger.debug(
            `Queueing email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail} for public note ${incidentPublicNote.id}.`,
            {
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            },
          );

          if (emailTemplate?.templateBody && statuspage.smtpConfig) {
            // Use custom template with BlankTemplate only when custom SMTP is configured
            const compiledBody: string =
              StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                emailTemplate.templateBody,
                subscriberTemplateVariables,
              );
            const compiledSubject: string = emailTemplate.emailSubject
              ? StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                  emailTemplate.emailSubject,
                  subscriberTemplateVariables,
                )
              : copy.customTemplateEmailSubjectPrefix + (incident.title || "");

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
                projectId: statuspage.projectId,
                statusPageId: statuspage.id!,
                incidentId: incident.id!,
              },
            ).catch((err: Error) => {
              logger.error(err, {
                ...EXTERNAL_FAULT,
                projectId: incident.projectId?.toString(),
                incidentId: incident.id?.toString(),
              });
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
                  detailsUrl: incidentDetailsUrl,
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
                  resourcesAffected: resourcesAffectedString,
                  incidentSeverity: incident.incidentSeverity?.name || " - ",
                  incidentTitle: incident.title || "",
                  incidentDescription: incident.description || "",
                  unsubscribeUrl: unsubscribeUrl,
                  subscriberEmailNotificationFooterText:
                    StatusPageServiceType.getSubscriberEmailFooterText(
                      statuspage,
                    ),
                },
                subject: copy.emailSubjectPrefix + incident.title,
              },
              {
                mailServer: ProjectSmtpConfigService.toEmailServer(
                  statuspage.smtpConfig,
                ),
                projectId: statuspage.projectId,
                statusPageId: statuspage.id!,
                incidentId: incident.id!,
              },
            ).catch((err: Error) => {
              logger.error(err, {
                ...EXTERNAL_FAULT,
                projectId: incident.projectId?.toString(),
                incidentId: incident.id?.toString(),
              });
            });
          }
          logger.debug(
            `Email notification queued for subscriber ${subscriber._id} for public note ${incidentPublicNote.id}.`,
            {
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            },
          );
        }

        if (subscriber.slackIncomingWebhookUrl) {
          // send slack message here.
          logger.debug(
            `Queueing Slack notification to subscriber ${subscriber._id} via incoming webhook for public note ${incidentPublicNote.id}.`,
            {
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            },
          );

          let markdownMessage: string;
          if (slackTemplate?.templateBody) {
            // Use custom template
            markdownMessage =
              StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                slackTemplate.templateBody,
                subscriberTemplateVariables,
              );
          } else {
            // Use default hard-coded template
            markdownMessage = `## Incident - ${incident.title || ""}

**${copy.chatNoteSentence}**

**Resources Affected:** ${resourcesAffectedString}
**Severity:** ${incident.incidentSeverity?.name || " - "}

**Note:**
${incidentPublicNote.note || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
          }

          SlackUtil.sendMessageToChannelViaIncomingWebhook({
            url: subscriber.slackIncomingWebhookUrl,
            text: SlackUtil.convertMarkdownToSlackRichText(markdownMessage),
          }).catch((err: Error) => {
            logger.error(err, {
              ...EXTERNAL_FAULT,
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            });
          });
          logger.debug(
            `Slack notification queued for subscriber ${subscriber._id} for public note ${incidentPublicNote.id}.`,
            {
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            },
          );
        }

        if (subscriber.microsoftTeamsIncomingWebhookUrl) {
          // send Teams message here.
          logger.debug(
            `Queueing Microsoft Teams notification to subscriber ${subscriber._id} via incoming webhook for public note ${incidentPublicNote.id}.`,
            {
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            },
          );

          let markdownMessage: string;
          if (teamsTemplate?.templateBody) {
            // Use custom template
            markdownMessage =
              StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                teamsTemplate.templateBody,
                subscriberTemplateVariables,
              );
          } else {
            // Use default hard-coded template
            markdownMessage = `## Incident - ${incident.title || ""}

**${copy.chatNoteSentence}**

**Resources Affected:** ${resourcesAffectedString}
**Severity:** ${incident.incidentSeverity?.name || " - "}

**Note:**
${incidentPublicNote.note || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
          }

          MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
            url: subscriber.microsoftTeamsIncomingWebhookUrl,
            text: markdownMessage,
          }).catch((err: Error) => {
            logger.error(err, {
              ...EXTERNAL_FAULT,
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            });
          });
          logger.debug(
            `Microsoft Teams notification queued for subscriber ${subscriber._id} for public note ${incidentPublicNote.id}.`,
            {
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            },
          );
        }

        if (subscriber.subscriberWebhook) {
          logger.debug(
            `Queueing webhook notification to subscriber ${subscriber._id} for public note ${incidentPublicNote.id}.`,
            {
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            },
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
                incidentId: incident.id?.toString() || "",
                incidentNumber: incident.incidentNumber?.toString() || "",
                incidentTitle: incident.title || "",
                incidentSeverity: incident.incidentSeverity?.name || "",
                resourcesAffected: resourcesAffectedString,
                note: incidentPublicNote.note || "",
                detailsUrl: incidentDetailsUrl,
              },
            },
          }).catch((err: Error) => {
            logger.error(err, {
              ...EXTERNAL_FAULT,
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            });
          });
        }
      }
    }

    if (notificationSentToAtLeastOneSubscriber) {
      logger.debug(
        `Notification sent to subscribers for public note added to incident: ${incident.id}`,
        {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        },
      );

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id!,
        projectId: incident.projectId!,
        incidentFeedEventType: IncidentFeedEventType.SubscriberNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: `📧 **Notification sent to subscribers** because ${copy.feedSentReason} this [Incident ${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber}](${(await IncidentService.getIncidentLinkInDashboard(incident.projectId!, incident.id!)).toString()}).`,
        moreInformationInMarkdown: `**Public Note:**

${incidentPublicNote.note}`,
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });

      logger.debug("Incident Feed created", {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
      });
    } else {
      logger.debug(
        `No subscribers were notified for public note added to incident: ${incident.id}. All status pages either hide incidents or had no matching subscribers.`,
        {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        },
      );

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id!,
        projectId: incident.projectId!,
        incidentFeedEventType: IncidentFeedEventType.SubscriberNotificationSent,
        displayColor: Yellow500,
        feedInfoInMarkdown: `📧 **No notification sent to subscribers** for ${copy.feedNotSentSubject} on [Incident ${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber}](${(await IncidentService.getIncidentLinkInDashboard(incident.projectId!, incident.id!)).toString()}).`,
        moreInformationInMarkdown:
          "Subscriber notifications were skipped because all associated status pages either hide incidents or had no matching subscribers.",
        workspaceNotification: {
          sendWorkspaceNotification: false,
        },
      });
    }

    // Set status to Success after successful notification
    await setNotificationStatus({
      noteId: incidentPublicNote.id!,
      trigger: trigger,
      status: StatusPageSubscriberNotificationStatus.Success,
      message: copy.successMessage,
    });
    logger.debug(
      `Incident public note ${incidentPublicNote.id} marked as Success for subscriber notifications.`,
      {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
      },
    );
  } catch (err) {
    logger.error(
      `Error sending notification for incident public note ${incidentPublicNote.id}: ${err}`,
      {
        projectId: incidentPublicNote.projectId?.toString(),
        incidentId: incidentPublicNote.incidentId?.toString(),
      },
    );

    // Set status to Failed with error reason
    await setNotificationStatus({
      noteId: incidentPublicNote.id!,
      trigger: trigger,
      status: StatusPageSubscriberNotificationStatus.Failed,
      message: (err as Error).message,
    });
  }
};

RunCron(
  "IncidentPublicNote:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all incident notes of all the projects

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const incidentPublicNoteNotes: Array<IncidentPublicNote> =
      await IncidentPublicNoteService.findBy({
        query: {
          subscriberNotificationStatusOnNoteCreated:
            StatusPageSubscriberNotificationStatus.Pending,
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          _id: true,
          note: true,
          postedAt: true,
          incidentId: true,
          projectId: true,
        },
      });

    logger.debug(
      `Found ${incidentPublicNoteNotes.length} incident public note(s) to notify subscribers for.`,
    );

    for (const incidentPublicNote of incidentPublicNoteNotes) {
      await notifySubscribersOfIncidentPublicNote({
        incidentPublicNote: incidentPublicNote,
        trigger: SubscriberNotificationTrigger.Created,
        host: host,
        httpProtocol: httpProtocol,
      });
    }
  },
);

/*
 * Sends the notification an editor asked for when they updated a public note
 * (see SubscriberUpdateNotification). IncidentPublicNoteService sets the
 * status column to Pending when an edit carries that request, and the
 * dashboard's retry button does the same after a failure.
 */
RunCron(
  "IncidentPublicNote:SendUpdateNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const updatedNotes: Array<IncidentPublicNote> =
      await IncidentPublicNoteService.findBy({
        query: {
          subscriberNotificationStatusOnNoteUpdated:
            StatusPageSubscriberNotificationStatus.Pending,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          _id: true,
          note: true,
          postedAt: true,
          incidentId: true,
          projectId: true,
          subscriberNotificationStatusOnNoteCreated: true,
        },
      });

    logger.debug(
      `Found ${updatedNotes.length} updated incident public note(s) to notify subscribers about.`,
    );

    if (updatedNotes.length === 0) {
      return;
    }

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    for (const incidentPublicNote of updatedNotes) {
      try {
        const skipReason: string | null =
          SubscriberUpdateNotification.getSkipReasonForOriginalNotificationStatus(
            incidentPublicNote.subscriberNotificationStatusOnNoteCreated,
          );

        if (skipReason) {
          logger.debug(
            `Skipping update notification for incident public note ${incidentPublicNote.id}: ${skipReason}`,
            {
              projectId: incidentPublicNote.projectId?.toString(),
              incidentId: incidentPublicNote.incidentId?.toString(),
            },
          );
          await setNotificationStatus({
            noteId: incidentPublicNote.id!,
            trigger: SubscriberNotificationTrigger.Updated,
            status: StatusPageSubscriberNotificationStatus.Skipped,
            message: skipReason,
          });
          continue;
        }

        await notifySubscribersOfIncidentPublicNote({
          incidentPublicNote: incidentPublicNote,
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
