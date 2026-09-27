import RunCron from "../../Utils/Cron";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
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
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import StatusPageSubscriberUnsubscribe from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
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
import { Blue500, Red500, Yellow500 } from "Common/Types/BrandColors";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import {
  IncidentStatusPageTemplateVariables,
  IncidentTemplateVariables,
} from "Common/Server/Utils/StatusPage/IncidentTemplateVariableBuilder";
import SubscriberIncidentEmailBuilder, {
  SubscriberIncidentEmail,
  SubscriberIncidentEmailEvent,
  SubscriberIncidentStatusPageEmail,
} from "Common/Server/Utils/StatusPage/SubscriberIncidentEmailBuilder";
import IncidentStatusPageScope, {
  ResolvedIncidentStatusPages,
} from "Common/Server/Utils/StatusPage/IncidentStatusPageScope";
import SubscriberNotificationDeliveryRecord, {
  StatusPageDeliverySkipReason,
  SubscriberNotificationRetryScope,
} from "Common/Server/Utils/StatusPage/SubscriberNotificationDeliveryRecord";
import SubscriberNotificationTiming, {
  SubscriberNotificationRunClock,
  SubscriberNotificationSendWindow,
} from "Common/Server/Utils/StatusPage/SubscriberNotificationTiming";
import SubscriberNotificationClaim from "Common/Server/Utils/StatusPage/SubscriberNotificationClaim";
import SubscriberNotificationFanOut from "Common/Server/Utils/StatusPage/SubscriberNotificationFanOut";
import Email from "Common/Types/Email";
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
  // The email's own wording is SubscriberIncidentEmailBuilder's.
  emailEvent: SubscriberIncidentEmailEvent;
  smsNoteSentence: string;
  chatNoteSentence: string;
  webhookEventType: string;
  feedSentReason: string;
  feedNotSentSubject: string;
  successMessage: string;
  // The status column a job claims (SubscriberNotificationClaim).
  statusColumn:
    | "subscriberNotificationStatusOnNoteCreated"
    | "subscriberNotificationStatusOnNoteUpdated";
}

const NOTIFICATION_COPY: Record<
  SubscriberNotificationTrigger,
  IncidentNoteNotificationCopy
> = {
  [SubscriberNotificationTrigger.Created]: {
    templateEventType:
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
    emailEvent: SubscriberIncidentEmailEvent.IncidentPublicNoteCreated,
    smsNoteSentence: "A new note is posted.",
    chatNoteSentence: "New note has been added to an incident",
    webhookEventType: "IncidentNoteCreated",
    feedSentReason: "a public note is added to",
    feedNotSentSubject: "the public note",
    successMessage: "Notifications sent successfully to all subscribers.",
    statusColumn: "subscriberNotificationStatusOnNoteCreated",
  },
  [SubscriberNotificationTrigger.Updated]: {
    templateEventType:
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated,
    emailEvent: SubscriberIncidentEmailEvent.IncidentPublicNoteUpdated,
    smsNoteSentence: "A note has been updated.",
    chatNoteSentence: "A note on this incident has been updated",
    webhookEventType: "IncidentNoteUpdated",
    feedSentReason: "a public note was updated on",
    feedNotSentSubject: "the updated public note",
    successMessage: SubscriberUpdateNotification.sentMessage,
    statusColumn: "subscriberNotificationStatusOnNoteUpdated",
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
  /*
   * Why the notification is not to be sent at all, decided from the row as
   * the run read it. It is settled as Skipped only once this run has claimed
   * it, so a decision made from an old read never overwrites a notification
   * queued again, or claimed by another run, since.
   */
  skipReason?: string | null | undefined;
}) => Promise<void> = async (data: {
  incidentPublicNote: IncidentPublicNote;
  trigger: SubscriberNotificationTrigger;
  host: Hostname;
  httpProtocol: Protocol;
  skipReason?: string | null | undefined;
}): Promise<void> => {
  const { incidentPublicNote, trigger, host, httpProtocol } = data;
  const copy: IncidentNoteNotificationCopy = NOTIFICATION_COPY[trigger];
  // Whether this run owns the notification, and so may settle it.
  let claimed: boolean = false;

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

    /*
     * Pending to InProgress, only if no other run has claimed it and it has
     * not changed since this run read it (SubscriberNotificationClaim).
     *
     * Claimed before anything is decided about it: the run read the note when
     * it started, which can be minutes ago once earlier sends have taken
     * their time, so a decision to skip it could otherwise overwrite a
     * notification queued again, or claimed by another run, since. Only the
     * run that owns it settles it, Skipped included.
     */
    claimed = await SubscriberNotificationClaim.claim({
      service: IncidentPublicNoteService,
      id: incidentPublicNote.id!,
      statusColumn: copy.statusColumn,
      version: incidentPublicNote.version,
    });

    if (!claimed) {
      logger.debug(
        `Incident public note ${incidentPublicNote.id} was claimed by another run, or changed since this run read it; leaving it.`,
        {
          projectId: incidentPublicNote.projectId?.toString(),
          incidentId: incidentPublicNote.incidentId?.toString(),
        },
      );
      return;
    }

    logger.debug(
      `Incident public note ${incidentPublicNote.id} status set to InProgress for subscriber notifications.`,
      {
        projectId: incidentPublicNote.projectId?.toString(),
        incidentId: incidentPublicNote.incidentId?.toString(),
      },
    );

    if (data.skipReason) {
      logger.debug(
        `Skipping ${trigger === SubscriberNotificationTrigger.Updated ? "update " : ""}notification for incident public note ${incidentPublicNote.id}: ${data.skipReason}`,
        {
          projectId: incidentPublicNote.projectId?.toString(),
          incidentId: incidentPublicNote.incidentId?.toString(),
        },
      );
      await setNotificationStatus({
        noteId: incidentPublicNote.id!,
        trigger: trigger,
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message: data.skipReason,
      });
      return;
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
        // {{incidentLabels}} and the custom fields (IncidentTemplateVariableBuilder).
        labels: {
          name: true,
        },
        customFields: true,
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

    const sendWindow: SubscriberNotificationSendWindow =
      SubscriberNotificationTiming.startSendWindow();
    const logAttributes: LogAttributes = {
      projectId: incident.projectId?.toString(),
      incidentId: incident.id?.toString(),
    };

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

    /*
     * The status pages this incident reaches - through its monitors, narrowed
     * to the pages it is limited to, and without the pages that only show
     * incidents limited to them when it is not - in name order.
     */
    const resolvedStatusPages: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incident],
      });

    const statusPageToResources: Dictionary<Array<StatusPageResource>> =
      resolvedStatusPages.statusPageToResources;
    const statusPages: Array<StatusPage> = resolvedStatusPages.statusPages;

    logger.debug(
      `Incident ${incident.id} reaches ${statusPages.length} status page(s) for public note notifications; ${resolvedStatusPages.excludedStatusPages.length} left out by its status page scope.`,
      {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
      },
    );

    const deliveryRecord: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({
        dedupeEmailAndSms: resolvedStatusPages.isScoped,
      });

    deliveryRecord.addExcludedStatusPages(
      resolvedStatusPages.excludedStatusPages,
    );

    /*
     * The values every message is filled with, read once per public note:
     * the note is converted once rather than once per subscriber, and the
     * incident's labels and custom fields are read once. What varies per
     * status page is added per page below. Read the way the notification
     * preview reads them (SubscriberIncidentEmailBuilder).
     *
     * {{postedAt}} is when the note says it was posted, which the author can
     * edit, so an update notification reads it fresh from the row. Only a
     * legacy row with no postedAt falls back to the time of sending.
     */
    const incidentTemplateVariables: IncidentTemplateVariables =
      await SubscriberIncidentEmailBuilder.buildTemplateVariables({
        event: copy.emailEvent,
        incident: incident,
        statusPages: statusPages,
        note: {
          text: incidentPublicNote.note,
          postedAt: incidentPublicNote.postedAt,
        },
      });

    for (const statuspage of statusPages) {
      try {
        if (!statuspage.id) {
          logger.debug(
            "Encountered a status page without an id; skipping.",
            logAttributes,
          );
          continue;
        }

        if (!statuspage.showIncidentsOnStatusPage) {
          logger.debug(
            `Status page ${statuspage.id} hides incidents; skipping.`,
            logAttributes,
          );
          deliveryRecord.skipStatusPage(
            statuspage,
            StatusPageDeliverySkipReason.HidesIncidents,
          );
          continue; // Do not send notification to subscribers if incidents are not visible on status page.
        }

        if (!sendWindow.isOpen()) {
          // Out of time before this page (SubscriberNotificationTiming).
          deliveryRecord.skipStatusPage(
            statuspage,
            StatusPageDeliverySkipReason.OutOfTime,
          );
          continue;
        }

        deliveryRecord.startStatusPage(statuspage);

        const statusPageURL: string = await StatusPageService.getStatusPageURL(
          statuspage.id,
        );
        const statusPageName: string =
          statuspage.pageTitle || statuspage.name || "Status Page";

        const incidentDetailsUrl: string =
          SubscriberIncidentEmailBuilder.getDetailsUrl({
            statusPageUrl: statusPageURL,
            incidentId: incident.id,
          });

        /*
         * Every variable SubscriberNotificationTemplateVariables advertises for
         * the incident note events, built once per status page
         * (IncidentTemplateVariableBuilder) in the format each channel
         * renders: HTML for the email body (it is wrapped only by
         * BlankTemplate), plain text for SMS and the email subject, and
         * Markdown for Slack and Teams. Every channel then adds the
         * subscriber's unsubscribeUrl, so no channel can miss a variable the
         * others have.
         *
         * The plain values are plain text on every channel: the email body
         * escapes them (compileEmailBodyTemplate), and only the values wrapped
         * in SafeHtml go into it as HTML. The HTML resource list (escaped
         * names, "<br/>" between groups) is for email bodies alone; every text
         * channel gets the plain-text one.
         */
        const pageTemplateVariables: IncidentStatusPageTemplateVariables =
          incidentTemplateVariables.forStatusPage({
            statusPage: statuspage,
            statusPageUrl: statusPageURL,
            detailsUrl: incidentDetailsUrl,
            resources: statusPageToResources[statuspage._id!] || [],
          });
        const resourcesAffectedPlainText: string =
          pageTemplateVariables.resourcesAffectedPlainText;

        /*
         * The page's email - its custom template or the default one, and why -
         * built by the code the notification preview shows it with, so what
         * was previewed is what is sent.
         */
        const pageEmail: SubscriberIncidentStatusPageEmail =
          await SubscriberIncidentEmailBuilder.forStatusPage({
            event: copy.emailEvent,
            incident: incident,
            incidentTemplateVariables: incidentTemplateVariables,
            statusPage: statuspage,
            statusPageUrl: statusPageURL,
            detailsUrl: incidentDetailsUrl,
            pageTemplateVariables: pageTemplateVariables,
            host: host,
            httpProtocol: httpProtocol,
          });

        // Fetch the other channels' custom templates for this page (if any)
        const [smsTemplate, slackTemplate, teamsTemplate]: [
          StatusPageSubscriberNotificationTemplate | null,
          StatusPageSubscriberNotificationTemplate | null,
          StatusPageSubscriberNotificationTemplate | null,
        ] = await Promise.all([
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

        const plainTextTemplateVariables: Record<string, string> =
          pageTemplateVariables.plainText;
        const markdownTemplateVariables: Record<string, string> =
          pageTemplateVariables.markdown;

        /*
         * The fields marked "Include in Subscriber Notifications", for the
         * default Slack and Teams messages, one per line. The default SMS
         * carries none: it is billed by the segment.
         */
        const chatCustomFields: string =
          pageTemplateVariables.customFieldsMarkdownLines.length > 0
            ? `${pageTemplateVariables.customFieldsMarkdownLines.join("\n")}\n`
            : "";

        /*
         * Every subscriber of the page, read in batches past LIMIT_MAX, a
         * bounded number at a time, each message awaited and counted sent or
         * failed (SubscriberNotificationFanOut).
         */
        await SubscriberNotificationFanOut.forEachSubscriber({
          statusPage: statuspage,
          record: deliveryRecord,
          sendWindow: sendWindow,
          logAttributes: logAttributes,
          handler: async (subscriber: StatusPageSubscriber): Promise<void> => {
            if (!subscriber._id) {
              logger.debug(
                "Encountered a subscriber without an _id; skipping.",
                logAttributes,
              );
              return;
            }

            const shouldNotifySubscriber: boolean =
              StatusPageSubscriberService.shouldSendNotification({
                subscriber: subscriber,
                statusPageResources:
                  statusPageToResources[statuspage._id!] || [],
                statusPage: statuspage,
                eventType: StatusPageEventType.Incident,
              });

            if (!shouldNotifySubscriber) {
              logger.debug(
                `Skipping subscriber ${subscriber._id} based on preferences for public note ${incidentPublicNote.id}.`,
                logAttributes,
              );
              return;
            }

            deliveryRecord.recordSubscriberMatched();

            const unsubscribeUrl: string =
              StatusPageSubscriberService.getUnsubscribeLink(
                URL.fromString(statusPageURL),
                subscriber,
              ).toString();

            logger.debug(
              `Prepared unsubscribe link for subscriber ${subscriber._id} for public note ${incidentPublicNote.id}.`,
              logAttributes,
            );

            // Add unsubscribeUrl to template variables
            const subscriberPlainTextTemplateVariables: Dictionary<string> = {
              ...plainTextTemplateVariables,
              unsubscribeUrl: unsubscribeUrl,
            };
            const subscriberMarkdownTemplateVariables: Dictionary<string> = {
              ...markdownTemplateVariables,
              unsubscribeUrl: unsubscribeUrl,
            };

            /*
             * An email address or phone number already sent this in this send,
             * through an earlier page, is not sent it again (only for a scoped
             * incident; see SubscriberNotificationDeliveryRecord).
             */
            if (
              subscriber.subscriberPhone &&
              deliveryRecord.shouldSendSms({
                statusPage: statuspage,
                phone: subscriber.subscriberPhone,
              })
            ) {
              const phoneStr: string = subscriber.subscriberPhone.toString();
              const phoneMasked: string = `${phoneStr.slice(0, 2)}******${phoneStr.slice(-2)}`;
              logger.debug(
                `Sending SMS notification to subscriber ${subscriber._id} at ${phoneMasked} for public note ${incidentPublicNote.id}.`,
                logAttributes,
              );

              /*
               * On a public status page the SMS keeps the shorter manage link,
               * which works there without signing in: an SMS is billed by the
               * segment (see StatusPageSubscriberUnsubscribe.buildSmsLink).
               */
              const smsUnsubscribeUrl: string =
                StatusPageSubscriberUnsubscribe.buildSmsLink({
                  isPublicStatusPage: statuspage.isPublicStatusPage,
                  statusPageUrl: statusPageURL,
                  subscriberId: subscriber.id!,
                  unsubscribeUrl: unsubscribeUrl,
                });

              let smsMessage: string;
              if (smsTemplate?.templateBody && statuspage.callSmsConfig) {
                // Use custom template only when custom Twilio is configured
                smsMessage =
                  StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    smsTemplate.templateBody,
                    {
                      ...subscriberPlainTextTemplateVariables,
                      unsubscribeUrl: smsUnsubscribeUrl,
                    },
                  );
                await incidentTemplateVariables.recordFieldsUsedBy([
                  smsTemplate.templateBody,
                ]);
              } else {
                // Use default hard-coded template
                smsMessage = `Incident update: ${incident.title || "-"} on ${statusPageName}. ${copy.smsNoteSentence} Details: ${incidentDetailsUrl}. Unsub: ${smsUnsubscribeUrl}`;
              }

              const sms: SMS = {
                message: smsMessage,
                to: subscriber.subscriberPhone,
              };

              // send sms here.
              await deliveryRecord.deliver({
                statusPage: statuspage,
                method: StatusPageSubscriberNotificationMethod.SMS,
                logAttributes: logAttributes,
                send: () => {
                  return SmsService.sendSms(sms, {
                    projectId: statuspage.projectId,
                    customTwilioConfig:
                      ProjectCallSMSConfigService.toTwilioConfig(
                        statuspage.callSmsConfig,
                      ),
                    statusPageId: statuspage.id!,
                    // An SMS the project cannot send (SMS off, no balance) is failed.
                    failIfNotSent: true,
                    incidentId: incident.id!,
                  });
                },
              });
            }

            if (
              subscriber.subscriberEmail &&
              deliveryRecord.shouldSendEmail({
                statusPage: statuspage,
                email: subscriber.subscriberEmail,
              })
            ) {
              // send email here.
              logger.debug(
                `Sending email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail} for public note ${incidentPublicNote.id}.`,
                logAttributes,
              );

              const subscriberEmail: Email = subscriber.subscriberEmail;

              // The page's email, with this subscriber's unsubscribe link.
              const email: SubscriberIncidentEmail = pageEmail.forSubscriber({
                unsubscribeUrl: unsubscribeUrl,
              });

              await pageEmail.recordSending();

              await deliveryRecord.deliver({
                statusPage: statuspage,
                method: StatusPageSubscriberNotificationMethod.Email,
                subject: email.subject,
                logAttributes: logAttributes,
                send: () => {
                  return MailService.sendMail(
                    {
                      toEmail: subscriberEmail,
                      ...email.envelope,
                    },
                    {
                      mailServer: ProjectSmtpConfigService.toEmailServer(
                        statuspage.smtpConfig,
                      ),
                      projectId: statuspage.projectId,
                      statusPageId: statuspage.id!,
                      incidentId: incident.id!,
                    },
                  );
                },
              });
            }

            if (subscriber.slackIncomingWebhookUrl) {
              // send slack message here.
              logger.debug(
                `Sending Slack notification to subscriber ${subscriber._id} via incoming webhook for public note ${incidentPublicNote.id}.`,
                logAttributes,
              );

              const slackIncomingWebhookUrl: URL =
                subscriber.slackIncomingWebhookUrl;

              let markdownMessage: string;
              if (slackTemplate?.templateBody) {
                // Use custom template
                markdownMessage =
                  StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    slackTemplate.templateBody,
                    subscriberMarkdownTemplateVariables,
                  );
                await incidentTemplateVariables.recordFieldsUsedBy([
                  slackTemplate.templateBody,
                ]);
              } else {
                // Use default hard-coded template
                markdownMessage = `## Incident - ${incident.title || ""}

**${copy.chatNoteSentence}**

**Resources Affected:** ${resourcesAffectedPlainText}
**Severity:** ${incident.incidentSeverity?.name || " - "}
${chatCustomFields}
**Note:**
${incidentPublicNote.note || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                await incidentTemplateVariables.recordIncludedFieldsSent();
              }

              await deliveryRecord.deliver({
                statusPage: statuspage,
                method: StatusPageSubscriberNotificationMethod.Slack,
                logAttributes: logAttributes,
                send: () => {
                  return SlackUtil.sendMessageToChannelViaIncomingWebhook({
                    url: slackIncomingWebhookUrl,
                    text: SlackUtil.convertMarkdownToSlackRichText(
                      markdownMessage,
                    ),
                  });
                },
              });
            }

            if (subscriber.microsoftTeamsIncomingWebhookUrl) {
              // send Teams message here.
              logger.debug(
                `Sending Microsoft Teams notification to subscriber ${subscriber._id} via incoming webhook for public note ${incidentPublicNote.id}.`,
                logAttributes,
              );

              const microsoftTeamsIncomingWebhookUrl: URL =
                subscriber.microsoftTeamsIncomingWebhookUrl;

              let markdownMessage: string;
              if (teamsTemplate?.templateBody) {
                // Use custom template
                markdownMessage =
                  StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    teamsTemplate.templateBody,
                    subscriberMarkdownTemplateVariables,
                  );
                await incidentTemplateVariables.recordFieldsUsedBy([
                  teamsTemplate.templateBody,
                ]);
              } else {
                // Use default hard-coded template
                markdownMessage = `## Incident - ${incident.title || ""}

**${copy.chatNoteSentence}**

**Resources Affected:** ${resourcesAffectedPlainText}
**Severity:** ${incident.incidentSeverity?.name || " - "}
${chatCustomFields}
**Note:**
${incidentPublicNote.note || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                await incidentTemplateVariables.recordIncludedFieldsSent();
              }

              await deliveryRecord.deliver({
                statusPage: statuspage,
                method: StatusPageSubscriberNotificationMethod.MicrosoftTeams,
                logAttributes: logAttributes,
                send: () => {
                  return MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook(
                    {
                      url: microsoftTeamsIncomingWebhookUrl,
                      text: markdownMessage,
                    },
                  );
                },
              });
            }

            if (subscriber.subscriberWebhook) {
              logger.debug(
                `Sending webhook notification to subscriber ${subscriber._id} for public note ${incidentPublicNote.id}.`,
                logAttributes,
              );

              const subscriberWebhook: URL = subscriber.subscriberWebhook;

              await incidentTemplateVariables.recordIncludedFieldsSent();

              await deliveryRecord.deliver({
                statusPage: statuspage,
                method: StatusPageSubscriberNotificationMethod.Webhook,
                logAttributes: logAttributes,
                send: () => {
                  return StatusPageSubscriberWebhookUtil.sendWebhookNotification(
                    {
                      webhookUrl: subscriberWebhook,
                      payload: {
                        eventType: copy.webhookEventType,
                        statusPageId: statuspage.id!.toString(),
                        statusPageName: statusPageName,
                        statusPageUrl: statusPageURL,
                        unsubscribeUrl: unsubscribeUrl,
                        data: {
                          incidentId: incident.id?.toString() || "",
                          incidentNumber:
                            incident.incidentNumber?.toString() || "",
                          incidentTitle: incident.title || "",
                          incidentSeverity:
                            incident.incidentSeverity?.name || "",
                          resourcesAffected: resourcesAffectedPlainText,
                          note: incidentPublicNote.note || "",
                          detailsUrl: incidentDetailsUrl,
                          // The fields marked "Include in Subscriber Notifications", by key.
                          customFields:
                            incidentTemplateVariables.getWebhookCustomFields(),
                        },
                      },
                    },
                  );
                },
              });
            }
          },
        });
      } catch (err) {
        /*
         * One page failing - a subscriber read, its URL, a template lookup -
         * does not stop the send: the page is recorded as failed part-way,
         * and the send goes on to the next one and settles as usual, with
         * the per-page record and the feed item.
         */
        logger.error(err, logAttributes);
        deliveryRecord.skipStatusPage(
          statuspage,
          StatusPageDeliverySkipReason.Failed,
        );
      }
    }

    const deliveryMarkdown: string = deliveryRecord.toMarkdown();
    // The custom field values that went out, as they were sent.
    const customFieldsSentMarkdown: string =
      incidentTemplateVariables.getSentCustomFieldsMarkdown();

    /*
     * Fell short when a message failed, or the send stopped before it
     * reached every subscriber: the notification settles as Failed.
     */
    const sendFellShort: boolean = deliveryRecord.hasFailures();

    if (sendFellShort) {
      logger.debug(
        `Not every subscriber was sent the public note notification for incident: ${incident.id}`,
        logAttributes,
      );

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id!,
        projectId: incident.projectId!,
        incidentFeedEventType: IncidentFeedEventType.SubscriberNotificationSent,
        displayColor: Red500,
        feedInfoInMarkdown: `📧 **Not every subscriber was sent the notification** that ${copy.feedSentReason} this [Incident ${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber}](${(await IncidentService.getIncidentLinkInDashboard(incident.projectId!, incident.id!)).toString()}).`,
        /*
         * The note, then each status page with what was sent and what
         * failed and its subject, then the custom field values sent.
         */
        moreInformationInMarkdown: [
          `**Public Note:**

${incidentPublicNote.note}`,
          deliveryMarkdown,
          customFieldsSentMarkdown,
        ]
          .filter(Boolean)
          .join("\n\n"),
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });
    } else if (deliveryRecord.hasMatchedAnySubscriber()) {
      logger.debug(
        `Notification sent to subscribers for public note added to incident: ${incident.id}`,
        logAttributes,
      );

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id!,
        projectId: incident.projectId!,
        incidentFeedEventType: IncidentFeedEventType.SubscriberNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: `📧 **Notification sent to subscribers** because ${copy.feedSentReason} this [Incident ${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber}](${(await IncidentService.getIncidentLinkInDashboard(incident.projectId!, incident.id!)).toString()}).`,
        /*
         * The note, then each status page, its subject and what was sent,
         * then the custom field values sent.
         */
        moreInformationInMarkdown: [
          `**Public Note:**

${incidentPublicNote.note}`,
          deliveryMarkdown,
          customFieldsSentMarkdown,
        ]
          .filter(Boolean)
          .join("\n\n"),
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });

      logger.debug("Incident Feed created", logAttributes);
    } else {
      logger.debug(
        `No subscribers were notified for public note added to incident: ${incident.id}. All status pages either hide incidents or had no matching subscribers.`,
        logAttributes,
      );

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id!,
        projectId: incident.projectId!,
        incidentFeedEventType: IncidentFeedEventType.SubscriberNotificationSent,
        displayColor: Yellow500,
        feedInfoInMarkdown: `📧 **No notification sent to subscribers** for ${copy.feedNotSentSubject} on [Incident ${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber}](${(await IncidentService.getIncidentLinkInDashboard(incident.projectId!, incident.id!)).toString()}).`,
        moreInformationInMarkdown: [
          "Subscriber notifications were skipped because every associated status page either hides incidents, is left out by this incident's status page scope, or had no matching subscribers.",
          deliveryMarkdown,
        ]
          .filter(Boolean)
          .join("\n\n"),
        workspaceNotification: {
          sendWorkspaceNotification: false,
        },
      });
    }

    // Settle: Success, or Failed with what was sent and failed per page.
    await setNotificationStatus({
      noteId: incidentPublicNote.id!,
      trigger: trigger,
      status: sendFellShort
        ? StatusPageSubscriberNotificationStatus.Failed
        : StatusPageSubscriberNotificationStatus.Success,
      message: deliveryRecord.toStatusMessage({
        sentMessage: copy.successMessage,
        retryScope: SubscriberNotificationRetryScope.EveryPage,
      }),
    });
    logger.debug(
      `Incident public note ${incidentPublicNote.id} marked as ${sendFellShort ? "Failed" : "Success"} for subscriber notifications.`,
      logAttributes,
    );
  } catch (err) {
    logger.error(
      `Error sending notification for incident public note ${incidentPublicNote.id}: ${err}`,
      {
        projectId: incidentPublicNote.projectId?.toString(),
        incidentId: incidentPublicNote.incidentId?.toString(),
      },
    );

    /*
     * Only a notification this run claimed is its to fail. Anything before
     * the claim leaves it Pending for the next run.
     */
    if (!claimed) {
      return;
    }

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
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    // Sized to one notification's send window (SubscriberNotificationTiming).
    timeoutInMS: SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS,
  },
  async () => {
    const runClock: SubscriberNotificationRunClock =
      SubscriberNotificationTiming.startRun();

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
          // What the claim checks the row against (SubscriberNotificationClaim).
          version: true,
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
      if (!runClock.canClaimAnotherNotification()) {
        /*
         * Whatever this run claims now might not finish before its timeout.
         * The rest stay Pending for the runs that follow.
         */
        logger.debug(
          "Leaving the remaining incident public notes for the next run.",
        );
        break;
      }

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
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    // Sized to one notification's send window (SubscriberNotificationTiming).
    timeoutInMS: SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS,
  },
  async () => {
    const runClock: SubscriberNotificationRunClock =
      SubscriberNotificationTiming.startRun();

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
          // What the claim checks the row against (SubscriberNotificationClaim).
          version: true,
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
      if (!runClock.canClaimAnotherNotification()) {
        // As above: the rest stay Pending for the runs that follow.
        logger.debug(
          "Leaving the remaining updated incident public notes for the next run.",
        );
        break;
      }

      try {
        /*
         * The note's 'posted' notification is being sent right now, with the
         * note as it was read before this edit. Left Pending, untouched: a
         * later run sends the update once that has settled
         * (SubscriberUpdateNotification).
         */
        if (
          SubscriberUpdateNotification.isOriginalNotificationBeingSent(
            incidentPublicNote.subscriberNotificationStatusOnNoteCreated,
          )
        ) {
          logger.debug(
            `Incident public note ${incidentPublicNote.id}'s posted notification is being sent; its update notification waits for it.`,
            {
              projectId: incidentPublicNote.projectId?.toString(),
              incidentId: incidentPublicNote.incidentId?.toString(),
            },
          );
          continue;
        }

        await notifySubscribersOfIncidentPublicNote({
          incidentPublicNote: incidentPublicNote,
          trigger: SubscriberNotificationTrigger.Updated,
          host: host,
          httpProtocol: httpProtocol,
          // Settled as Skipped once claimed (see the function).
          skipReason:
            SubscriberUpdateNotification.getSkipReasonForOriginalNotificationStatus(
              incidentPublicNote.subscriberNotificationStatusOnNoteCreated,
            ),
        });
      } catch (err) {
        logger.error(err);
      }
    }
  },
);
