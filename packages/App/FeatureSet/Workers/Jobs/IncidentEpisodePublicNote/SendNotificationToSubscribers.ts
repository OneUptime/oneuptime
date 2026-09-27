import RunCron from "../../Utils/Cron";
import { StatusPageApiRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import SMS from "Common/Types/SMS/SMS";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import IncidentEpisodePublicNoteService from "Common/Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import StatusPageSubscriberUnsubscribe from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
  SubscriberNotificationEmailBodyTemplateVariables,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import SafeHtml from "Common/Types/SafeHtml";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import { Blue500, Red500, Yellow500 } from "Common/Types/BrandColors";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import StatusPageResourceUtil from "Common/Server/Utils/StatusPageResource";
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
interface EpisodeNoteNotificationCopy {
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
  // The status column a job claims (SubscriberNotificationClaim).
  statusColumn:
    | "subscriberNotificationStatusOnNoteCreated"
    | "subscriberNotificationStatusOnNoteUpdated";
}

const NOTIFICATION_COPY: Record<
  SubscriberNotificationTrigger,
  EpisodeNoteNotificationCopy
> = {
  [SubscriberNotificationTrigger.Created]: {
    templateEventType:
      StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteCreated,
    emailTemplateType: EmailTemplateType.SubscriberEpisodeNoteCreated,
    emailSubjectPrefix: "[Update Incident] ",
    customTemplateEmailSubjectPrefix: "[Incident Update] ",
    smsNoteSentence: "A new note is posted.",
    chatNoteSentence: "New note has been added to an incident",
    webhookEventType: "EpisodeNoteCreated",
    feedSentReason: "a public note is added to",
    feedNotSentSubject: "the public note",
    successMessage: "Notifications sent successfully to all subscribers.",
    statusColumn: "subscriberNotificationStatusOnNoteCreated",
  },
  [SubscriberNotificationTrigger.Updated]: {
    templateEventType:
      StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteUpdated,
    emailTemplateType: EmailTemplateType.SubscriberEpisodeNoteUpdated,
    emailSubjectPrefix: "[Incident Note Updated] ",
    customTemplateEmailSubjectPrefix: "[Incident Note Updated] ",
    smsNoteSentence: "A note has been updated.",
    chatNoteSentence: "A note on this incident has been updated",
    webhookEventType: "EpisodeNoteUpdated",
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

  const updateData: QueryDeepPartialEntity<IncidentEpisodePublicNote> =
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

  await IncidentEpisodePublicNoteService.updateOneById({
    id: data.noteId,
    data: updateData,
    props: {
      isRoot: true,
      ignoreHooks: true,
    },
  });
};

const notifySubscribersOfEpisodePublicNote: (data: {
  episodePublicNote: IncidentEpisodePublicNote;
  trigger: SubscriberNotificationTrigger;
  host: Hostname;
  httpProtocol: Protocol;
}) => Promise<void> = async (data: {
  episodePublicNote: IncidentEpisodePublicNote;
  trigger: SubscriberNotificationTrigger;
  host: Hostname;
  httpProtocol: Protocol;
}): Promise<void> => {
  const { episodePublicNote, trigger, host, httpProtocol } = data;
  const copy: EpisodeNoteNotificationCopy = NOTIFICATION_COPY[trigger];

  try {
    logger.debug(`Processing episode public note ${episodePublicNote.id}.`, {
      projectId: episodePublicNote.projectId?.toString(),
      incidentEpisodeId: episodePublicNote.incidentEpisodeId?.toString(),
    });
    if (!episodePublicNote.incidentEpisodeId) {
      logger.debug(
        `Episode public note ${episodePublicNote.id} has no incidentEpisodeId; skipping.`,
        {
          projectId: episodePublicNote.projectId?.toString(),
        },
      );
      return; // skip if incidentEpisodeId is not set
    }

    // get the episode
    const episode: IncidentEpisode | null =
      await IncidentEpisodeService.findOneById({
        id: episodePublicNote.incidentEpisodeId!,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
          description: true,
          projectId: true,
          incidentSeverity: {
            name: true,
          },
          isVisibleOnStatusPage: true,
          episodeNumber: true,
          episodeNumberWithPrefix: true,
        },
      });

    if (!episode) {
      logger.debug(
        `Episode ${episodePublicNote.incidentEpisodeId} not found; marking public note ${episodePublicNote.id} as Skipped.`,
        {
          projectId: episodePublicNote.projectId?.toString(),
          incidentEpisodeId: episodePublicNote.incidentEpisodeId?.toString(),
        },
      );
      await setNotificationStatus({
        noteId: episodePublicNote.id!,
        trigger: trigger,
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message:
          "Related episode not found. Skipping notifications to subscribers.",
      });
      return;
    }

    /*
     * The episode's incidents, with their monitors. The episode reaches the
     * union of the status pages its incidents reach, each through its own
     * status page scope.
     */
    const memberIncidents: Array<Incident> =
      await IncidentStatusPageScope.getEpisodeMemberIncidents(episode.id!);

    // Collect all unique monitors from member incidents
    const monitorIds: Set<string> = new Set();
    for (const memberIncident of memberIncidents) {
      for (const monitor of memberIncident.monitors || []) {
        if (monitor._id) {
          monitorIds.add(monitor._id.toString());
        }
      }
    }

    if (monitorIds.size === 0) {
      logger.debug(
        `Episode ${episode.id} has no monitors; marking public note ${episodePublicNote.id} as Skipped.`,
        {
          projectId: episode.projectId?.toString(),
          incidentEpisodeId: episode.id?.toString(),
        },
      );
      await setNotificationStatus({
        noteId: episodePublicNote.id!,
        trigger: trigger,
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message:
          "No monitors are attached to the incidents in this episode. Skipping notifications.",
      });
      return;
    }

    /*
     * Set status to InProgress: Pending to InProgress, only if no other run
     * has claimed it and it has not changed since this run read it
     * (SubscriberNotificationClaim).
     */
    const claimed: boolean = await SubscriberNotificationClaim.claim({
      service: IncidentEpisodePublicNoteService,
      id: episodePublicNote.id!,
      statusColumn: copy.statusColumn,
      version: episodePublicNote.version,
    });

    if (!claimed) {
      logger.debug(
        `Episode public note ${episodePublicNote.id} was claimed by another run, or changed since this run read it; leaving it.`,
        {
          projectId: episode.projectId?.toString(),
          incidentEpisodeId: episode.id?.toString(),
        },
      );
      return;
    }

    const sendWindow: SubscriberNotificationSendWindow =
      SubscriberNotificationTiming.startSendWindow();
    const logAttributes: LogAttributes = {
      projectId: episode.projectId?.toString(),
      incidentEpisodeId: episode.id?.toString(),
    };
    logger.debug(
      `Episode public note ${episodePublicNote.id} status set to InProgress for subscriber notifications.`,
      {
        projectId: episode.projectId?.toString(),
        incidentEpisodeId: episode.id?.toString(),
      },
    );

    if (!episode.isVisibleOnStatusPage) {
      // Set status to Skipped for non-visible episodes
      logger.debug(
        `Episode ${episode.id} is not visible on status page; marking public note ${episodePublicNote.id} as Skipped.`,
        {
          projectId: episode.projectId?.toString(),
          incidentEpisodeId: episode.id?.toString(),
        },
      );
      await setNotificationStatus({
        noteId: episodePublicNote.id!,
        trigger: trigger,
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message:
          "Notifications skipped as episode is not visible on status page.",
      });
      return;
    }

    /*
     * The status pages the episode's incidents reach - through their
     * monitors, each narrowed to the pages it is limited to - in name order.
     */
    const resolvedStatusPages: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: memberIncidents,
      });

    const statusPageToResources: Dictionary<Array<StatusPageResource>> =
      resolvedStatusPages.statusPageToResources;
    const statusPages: Array<StatusPage> = resolvedStatusPages.statusPages;

    logger.debug(
      `Episode ${episode.id} reaches ${statusPages.length} status page(s) for public note notifications; ${resolvedStatusPages.excludedStatusPages.length} left out by its incidents' status page scope.`,
      {
        projectId: episode.projectId?.toString(),
        incidentEpisodeId: episode.id?.toString(),
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
     * Pre-compute markdown conversions for the note once per public note.
     * These values do not vary per status page or per subscriber, so
     * memoizing here avoids N redundant markdown parses during fan-out.
     */
    const noteHtml: string = await Markdown.convertToHTML(
      episodePublicNote.note || "",
      MarkdownContentType.Email,
    );
    const notePlainText: string = Markdown.convertToPlainText(
      episodePublicNote.note || "",
    );

    for (const statuspage of statusPages) {
      if (!statuspage.id) {
        logger.debug("Encountered a status page without an id; skipping.", {
          projectId: episode.projectId?.toString(),
          incidentEpisodeId: episode.id?.toString(),
        });
        continue;
      }

      if (!statuspage.showEpisodesOnStatusPage) {
        logger.debug(`Status page ${statuspage.id} hides episodes; skipping.`, {
          projectId: episode.projectId?.toString(),
          incidentEpisodeId: episode.id?.toString(),
        });
        deliveryRecord.skipStatusPage(
          statuspage,
          StatusPageDeliverySkipReason.HidesEpisodes,
        );
        continue; // Do not send notification to subscribers if episodes are not visible on status page.
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
      const statusPageIdString: string | null =
        statuspage.id?.toString() || statuspage._id?.toString() || null;

      /*
       * The status page has no /episodes page: it shows an episode on its
       * incident detail route (/incidents/:id), which looks the id up as an
       * incident first and then as an episode. Linking anywhere else lands
       * subscribers on "page not found".
       */
      const episodeDetailsUrl: string =
        episode.id && statusPageURL
          ? URL.fromString(statusPageURL)
              .addRoute(`/incidents/${episode.id.toString()}`)
              .toString()
          : statusPageURL;

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

      const resourcesAffectedString: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupName(
          statusPageToResources[statuspage._id!] || [],
        );
      const resourcesAffectedPlainText: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupNameAsPlainText(
          statusPageToResources[statuspage._id!] || [],
        );

      /*
       * Every variable SubscriberNotificationTemplateVariables advertises for
       * the episode note events, built once per status page. The base object
       * holds the values that read the same on every channel; each channel
       * object below adds the format-dependent ones (note and
       * resourcesAffected), and every channel adds the subscriber's
       * unsubscribeUrl, so no channel can miss a variable the others have.
       *
       * Custom templates get each value in the format their channel renders:
       * HTML for the email body (it is wrapped only by BlankTemplate), plain
       * text for SMS and the email subject, and Markdown for Slack and Teams.
       * The note conversions are the memoized ones computed once per public
       * note above.
       *
       * The base values are plain text on every channel: the email body
       * escapes them (compileEmailBodyTemplate), and only the values wrapped
       * in SafeHtml go into it as HTML. The HTML resource list (escaped
       * names, "<br/>" between groups) is for email bodies alone; every text
       * channel gets the plain-text one.
       */
      const templateVariables: Record<string, string> = {
        statusPageName: statusPageName,
        statusPageUrl: statusPageURL,
        detailsUrl: episodeDetailsUrl,
        episodeSeverity: episode.incidentSeverity?.name || " - ",
        episodeTitle: episode.title || "",
      };

      const emailBodyTemplateVariables: SubscriberNotificationEmailBodyTemplateVariables =
        {
          ...templateVariables,
          resourcesAffected: SafeHtml.fromTrustedHtml(resourcesAffectedString),
          note: SafeHtml.fromTrustedHtml(noteHtml),
        };

      const plainTextTemplateVariables: Record<string, string> = {
        ...templateVariables,
        resourcesAffected: resourcesAffectedPlainText,
        note: notePlainText,
      };

      const markdownTemplateVariables: Record<string, string> = {
        ...templateVariables,
        resourcesAffected: resourcesAffectedPlainText,
        note: episodePublicNote.note || "",
      };

      // Send email to Email subscribers.

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
            logger.debug("Encountered a subscriber without an _id; skipping.", {
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
            });
            return;
          }

          const shouldNotifySubscriber: boolean =
            StatusPageSubscriberService.shouldSendNotification({
              subscriber: subscriber,
              statusPageResources: statusPageToResources[statuspage._id!] || [],
              statusPage: statuspage,
              eventType: StatusPageEventType.Incident, // Episodes use incident event type
            });

          if (!shouldNotifySubscriber) {
            logger.debug(
              `Skipping subscriber ${subscriber._id} based on preferences for public note ${episodePublicNote.id}.`,
              {
                projectId: episode.projectId?.toString(),
                incidentEpisodeId: episode.id?.toString(),
              },
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
            `Prepared unsubscribe link for subscriber ${subscriber._id} for public note ${episodePublicNote.id}.`,
            {
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
            },
          );

          // Add unsubscribeUrl to template variables
          const subscriberEmailBodyTemplateVariables: SubscriberNotificationEmailBodyTemplateVariables =
            {
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

          /*
           * An email address or phone number already sent this in this send,
           * through an earlier page, is not sent it again (only when an
           * incident of the episode is scoped; see
           * SubscriberNotificationDeliveryRecord).
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
              `Sending SMS notification to subscriber ${subscriber._id} at ${phoneMasked} for public note ${episodePublicNote.id}.`,
              {
                projectId: episode.projectId?.toString(),
                incidentEpisodeId: episode.id?.toString(),
              },
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
            } else {
              // Use default hard-coded template
              smsMessage = `Incident update: ${episode.title || "-"} on ${statusPageName}. ${copy.smsNoteSentence} Details: ${episodeDetailsUrl}. Unsub: ${smsUnsubscribeUrl}`;
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
            const subscriberEmail: Email = subscriber.subscriberEmail;
            // send email here.
            logger.debug(
              `Sending email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail} for public note ${episodePublicNote.id}.`,
              {
                projectId: episode.projectId?.toString(),
                incidentEpisodeId: episode.id?.toString(),
              },
            );

            if (emailTemplate?.templateBody && statuspage.smtpConfig) {
              // Use custom template with BlankTemplate only when custom SMTP is configured
              const compiledBody: string =
                StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate(
                  emailTemplate.templateBody,
                  subscriberEmailBodyTemplateVariables,
                );
              const compiledSubject: string = emailTemplate.emailSubject
                ? StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    emailTemplate.emailSubject,
                    subscriberPlainTextTemplateVariables,
                  )
                : copy.customTemplateEmailSubjectPrefix + (episode.title || "");

              await deliveryRecord.deliver({
                statusPage: statuspage,
                method: StatusPageSubscriberNotificationMethod.Email,
                subject: compiledSubject,
                logAttributes: logAttributes,
                send: () => {
                  return MailService.sendMail(
                    {
                      toEmail: subscriberEmail,
                      templateType: EmailTemplateType.BlankTemplate,
                      vars: {
                        body: compiledBody,
                      },
                      subject: compiledSubject,
                      isSubjectLiteral: true,
                    },
                    {
                      mailServer: ProjectSmtpConfigService.toEmailServer(
                        statuspage.smtpConfig,
                      ),
                      projectId: statuspage.projectId,
                      statusPageId: statuspage.id!,
                    },
                  );
                },
              });
            } else {
              // Use default hard-coded template
              await deliveryRecord.deliver({
                statusPage: statuspage,
                method: StatusPageSubscriberNotificationMethod.Email,
                subject: copy.emailSubjectPrefix + episode.title,
                logAttributes: logAttributes,
                send: () => {
                  return MailService.sendMail(
                    {
                      toEmail: subscriberEmail,
                      templateType: copy.emailTemplateType,
                      vars: {
                        note: noteHtml,
                        statusPageName: statusPageName,
                        statusPageUrl: statusPageURL,
                        detailsUrl: episodeDetailsUrl,
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
                        episodeSeverity:
                          episode.incidentSeverity?.name || " - ",
                        episodeTitle: episode.title || "",
                        unsubscribeUrl: unsubscribeUrl,
                        subscriberEmailNotificationFooterText:
                          StatusPageServiceType.getSubscriberEmailFooterText(
                            statuspage,
                          ),
                      },
                      subject: copy.emailSubjectPrefix + episode.title,
                      isSubjectLiteral: true,
                    },
                    {
                      mailServer: ProjectSmtpConfigService.toEmailServer(
                        statuspage.smtpConfig,
                      ),
                      projectId: statuspage.projectId,
                      statusPageId: statuspage.id!,
                    },
                  );
                },
              });
            }
            logger.debug(
              `Email notification sent to subscriber ${subscriber._id} for public note ${episodePublicNote.id}.`,
              {
                projectId: episode.projectId?.toString(),
                incidentEpisodeId: episode.id?.toString(),
              },
            );
          }

          if (subscriber.slackIncomingWebhookUrl) {
            const slackIncomingWebhookUrl: URL =
              subscriber.slackIncomingWebhookUrl;
            // send slack message here.
            logger.debug(
              `Sending Slack notification to subscriber ${subscriber._id} via incoming webhook for public note ${episodePublicNote.id}.`,
              {
                projectId: episode.projectId?.toString(),
                incidentEpisodeId: episode.id?.toString(),
              },
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
              markdownMessage = `## Incident - ${episode.title || ""}

**${copy.chatNoteSentence}**

**Resources Affected:** ${resourcesAffectedPlainText}
**Severity:** ${episode.incidentSeverity?.name || " - "}

**Note:**
${episodePublicNote.note || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
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
            logger.debug(
              `Slack notification sent to subscriber ${subscriber._id} for public note ${episodePublicNote.id}.`,
              {
                projectId: episode.projectId?.toString(),
                incidentEpisodeId: episode.id?.toString(),
              },
            );
          }

          if (subscriber.microsoftTeamsIncomingWebhookUrl) {
            const microsoftTeamsIncomingWebhookUrl: URL =
              subscriber.microsoftTeamsIncomingWebhookUrl;
            // send Teams message here.
            logger.debug(
              `Sending Microsoft Teams notification to subscriber ${subscriber._id} via incoming webhook for public note ${episodePublicNote.id}.`,
              {
                projectId: episode.projectId?.toString(),
                incidentEpisodeId: episode.id?.toString(),
              },
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
              markdownMessage = `## Incident - ${episode.title || ""}

**${copy.chatNoteSentence}**

**Resources Affected:** ${resourcesAffectedPlainText}
**Severity:** ${episode.incidentSeverity?.name || " - "}

**Note:**
${episodePublicNote.note || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
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
            logger.debug(
              `Microsoft Teams notification sent to subscriber ${subscriber._id} for public note ${episodePublicNote.id}.`,
              {
                projectId: episode.projectId?.toString(),
                incidentEpisodeId: episode.id?.toString(),
              },
            );
          }

          if (subscriber.subscriberWebhook) {
            const subscriberWebhook: URL = subscriber.subscriberWebhook;

            await deliveryRecord.deliver({
              statusPage: statuspage,
              method: StatusPageSubscriberNotificationMethod.Webhook,
              logAttributes: logAttributes,
              send: () => {
                return StatusPageSubscriberWebhookUtil.sendWebhookNotification({
                  webhookUrl: subscriberWebhook,
                  payload: {
                    eventType: copy.webhookEventType,
                    statusPageId: statuspage.id!.toString(),
                    statusPageName: statusPageName,
                    statusPageUrl: statusPageURL,
                    unsubscribeUrl: unsubscribeUrl,
                    data: {
                      episodeId: episode.id?.toString() || "",
                      episodeTitle: episode.title || "",
                      incidentSeverity: episode.incidentSeverity?.name || "",
                      resourcesAffected: resourcesAffectedPlainText,
                      note: episodePublicNote.note || "",
                      detailsUrl: episodeDetailsUrl,
                    },
                  },
                });
              },
            });
          }
        },
      });
    }

    const deliveryMarkdown: string = deliveryRecord.toMarkdown();

    /*
     * Fell short when a message failed, or the send stopped before it
     * reached every subscriber: the notification settles as Failed.
     */
    const sendFellShort: boolean = deliveryRecord.hasFailures();

    if (sendFellShort) {
      logger.debug(
        `Not every subscriber was sent the public note notification for episode: ${episode.id}`,
        logAttributes,
      );

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: episode.id!,
        projectId: episode.projectId!,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.SubscriberNotificationSent,
        displayColor: Red500,
        feedInfoInMarkdown: `📧 **Not every subscriber was sent the notification** that ${copy.feedSentReason} this [Episode ${episode.episodeNumberWithPrefix || "#" + episode.episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(episode.projectId!, episode.id!)).toString()}).`,
        // The note, then each status page with what was sent and what failed.
        moreInformationInMarkdown: [
          `**Public Note:**

${episodePublicNote.note}`,
          deliveryMarkdown,
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
    } else if (deliveryRecord.hasMatchedAnySubscriber()) {
      logger.debug(
        `Notification sent to subscribers for public note added to episode: ${episode.id}`,
        logAttributes,
      );

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: episode.id!,
        projectId: episode.projectId!,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.SubscriberNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: `📧 **Notification sent to subscribers** because ${copy.feedSentReason} this [Episode ${episode.episodeNumberWithPrefix || "#" + episode.episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(episode.projectId!, episode.id!)).toString()}).`,
        // The note, then each status page, its subject and what was sent.
        moreInformationInMarkdown: [
          `**Public Note:**

${episodePublicNote.note}`,
          deliveryMarkdown,
        ]
          .filter(Boolean)
          .join("\n\n"),
      });

      logger.debug("Episode Feed created", logAttributes);
    } else {
      logger.debug(
        `No subscribers were notified for public note added to episode: ${episode.id}. All status pages either hide episodes or had no matching subscribers.`,
        logAttributes,
      );

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: episode.id!,
        projectId: episode.projectId!,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.SubscriberNotificationSent,
        displayColor: Yellow500,
        feedInfoInMarkdown: `📧 **No notification sent to subscribers** for ${copy.feedNotSentSubject} on [Episode ${episode.episodeNumberWithPrefix || "#" + episode.episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(episode.projectId!, episode.id!)).toString()}).`,
        moreInformationInMarkdown: [
          "Subscriber notifications were skipped because every associated status page either hides episodes, is left out by the status page scope of the episode's incidents, or had no matching subscribers.",
          deliveryMarkdown,
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
    }

    // Settle: Success, or Failed with what was sent and failed per page.
    await setNotificationStatus({
      noteId: episodePublicNote.id!,
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
      `Episode public note ${episodePublicNote.id} marked as ${sendFellShort ? "Failed" : "Success"} for subscriber notifications.`,
      logAttributes,
    );
  } catch (err) {
    logger.error(
      `Error sending notification for episode public note ${episodePublicNote.id}: ${err}`,
      {
        projectId: episodePublicNote.projectId?.toString(),
        incidentEpisodeId: episodePublicNote.incidentEpisodeId?.toString(),
      },
    );

    // Set status to Failed with error reason
    await setNotificationStatus({
      noteId: episodePublicNote.id!,
      trigger: trigger,
      status: StatusPageSubscriberNotificationStatus.Failed,
      message: (err as Error).message,
    });
  }
};

RunCron(
  "IncidentEpisodePublicNote:SendNotificationToSubscribers",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    // Sized to one notification's send window (SubscriberNotificationTiming).
    timeoutInMS: SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS,
  },
  async () => {
    const runClock: SubscriberNotificationRunClock =
      SubscriberNotificationTiming.startRun();

    // First, mark public notes as Skipped if they should not be notified
    const notesToSkip: Array<IncidentEpisodePublicNote> =
      await IncidentEpisodePublicNoteService.findBy({
        query: {
          subscriberNotificationStatusOnNoteCreated:
            StatusPageSubscriberNotificationStatus.Pending,
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated: false,
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

    logger.debug(
      `Found ${notesToSkip.length} episode public note(s) to mark as Skipped (subscribers should not be notified).`,
    );

    for (const note of notesToSkip) {
      logger.debug(
        `Marking episode public note ${note.id} as Skipped for subscriber notifications.`,
      );
      await IncidentEpisodePublicNoteService.updateOneById({
        id: note.id!,
        data: {
          subscriberNotificationStatusOnNoteCreated:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessage:
            "Notifications skipped as subscribers are not to be notified for this note.",
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
      logger.debug(
        `Episode public note ${note.id} marked as Skipped for subscriber notifications.`,
      );
    }

    // get all episode public notes that need notification

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const episodePublicNotes: Array<IncidentEpisodePublicNote> =
      await IncidentEpisodePublicNoteService.findBy({
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
          incidentEpisodeId: true,
          projectId: true,
        },
      });

    logger.debug(
      `Found ${episodePublicNotes.length} episode public note(s) to notify subscribers for.`,
    );

    for (const episodePublicNote of episodePublicNotes) {
      if (!runClock.canClaimAnotherNotification()) {
        /*
         * Whatever this run claims now might not finish before its timeout.
         * The rest stay Pending for the runs that follow.
         */
        logger.debug(
          "Leaving the remaining episode public notes for the next run.",
        );
        break;
      }

      await notifySubscribersOfEpisodePublicNote({
        episodePublicNote: episodePublicNote,
        trigger: SubscriberNotificationTrigger.Created,
        host: host,
        httpProtocol: httpProtocol,
      });
    }
  },
);

/*
 * Sends the notification an editor asked for when they updated a public note
 * (see SubscriberUpdateNotification). IncidentEpisodePublicNoteService sets
 * the status column to Pending when an edit carries that request, and the
 * dashboard's retry button does the same after a failure.
 */
RunCron(
  "IncidentEpisodePublicNote:SendUpdateNotificationToSubscribers",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    // Sized to one notification's send window (SubscriberNotificationTiming).
    timeoutInMS: SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS,
  },
  async () => {
    const runClock: SubscriberNotificationRunClock =
      SubscriberNotificationTiming.startRun();

    const updatedNotes: Array<IncidentEpisodePublicNote> =
      await IncidentEpisodePublicNoteService.findBy({
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
          incidentEpisodeId: true,
          projectId: true,
          subscriberNotificationStatusOnNoteCreated: true,
        },
      });

    logger.debug(
      `Found ${updatedNotes.length} updated episode public note(s) to notify subscribers about.`,
    );

    if (updatedNotes.length === 0) {
      return;
    }

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    for (const episodePublicNote of updatedNotes) {
      if (!runClock.canClaimAnotherNotification()) {
        // As above: the rest stay Pending for the runs that follow.
        logger.debug(
          "Leaving the remaining updated episode public notes for the next run.",
        );
        break;
      }

      try {
        const skipReason: string | null =
          SubscriberUpdateNotification.getSkipReasonForOriginalNotificationStatus(
            episodePublicNote.subscriberNotificationStatusOnNoteCreated,
          );

        if (skipReason) {
          logger.debug(
            `Skipping update notification for episode public note ${episodePublicNote.id}: ${skipReason}`,
            {
              projectId: episodePublicNote.projectId?.toString(),
              incidentEpisodeId:
                episodePublicNote.incidentEpisodeId?.toString(),
            },
          );
          await setNotificationStatus({
            noteId: episodePublicNote.id!,
            trigger: SubscriberNotificationTrigger.Updated,
            status: StatusPageSubscriberNotificationStatus.Skipped,
            message: skipReason,
          });
          continue;
        }

        await notifySubscribersOfEpisodePublicNote({
          episodePublicNote: episodePublicNote,
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
