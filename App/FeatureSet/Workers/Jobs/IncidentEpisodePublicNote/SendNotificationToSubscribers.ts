import RunCron from "../../Utils/Cron";
import { StatusPageApiRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import SMS from "Common/Types/SMS/SMS";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import IncidentEpisodePublicNoteService from "Common/Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
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
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
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
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
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
    successMessage: "Notifications sent successfully to all subscribers",
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

    // Get monitors from member incidents
    const episodeMembers: Array<IncidentEpisodeMember> =
      await IncidentEpisodeMemberService.findBy({
        query: {
          incidentEpisodeId: episode.id!,
        },
        select: {
          incident: {
            monitors: {
              _id: true,
            },
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    // Collect all unique monitors from member incidents
    const monitorIds: Set<string> = new Set();
    for (const member of episodeMembers) {
      if (member.incident?.monitors) {
        for (const monitor of member.incident.monitors) {
          if (monitor._id) {
            monitorIds.add(monitor._id.toString());
          }
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

    // Set status to InProgress
    await setNotificationStatus({
      noteId: episodePublicNote.id!,
      trigger: trigger,
      status: StatusPageSubscriberNotificationStatus.InProgress,
    });
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

    // get status page resources from monitors.
    const statusPageResources: Array<StatusPageResource> =
      await StatusPageResourceService.findByMonitors({
        monitorIds: Array.from(monitorIds).map((id: string) => {
          return new ObjectID(id);
        }),
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
      `Found ${statusPageResources.length} status page resource(s) for episode ${episode.id}.`,
      {
        projectId: episode.projectId?.toString(),
        incidentEpisodeId: episode.id?.toString(),
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
      `Episode ${episode.id} maps to ${Object.keys(statusPageToResources).length} status page(s) for public note notifications.`,
      {
        projectId: episode.projectId?.toString(),
        incidentEpisodeId: episode.id?.toString(),
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
      episodePublicNote.note || "",
      MarkdownContentType.Email,
    );
    const notePlainText: string = Markdown.convertToPlainText(
      episodePublicNote.note || "",
    );

    let notificationSentToAtLeastOneSubscriber: boolean = false;

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
        continue; // Do not send notification to subscribers if episodes are not visible on status page.
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

      const episodeDetailsUrl: string =
        episode.id && statusPageURL
          ? URL.fromString(statusPageURL)
              .addRoute(`/episodes/${episode.id.toString()}`)
              .toString()
          : statusPageURL;

      logger.debug(
        `Status page ${statuspage.id} (${statusPageName}) has ${subscribers.length} subscriber(s) for public note ${episodePublicNote.id}.`,
        {
          projectId: episode.projectId?.toString(),
          incidentEpisodeId: episode.id?.toString(),
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

      const templateVariables: Record<string, string> = {
        statusPageName: statusPageName,
        statusPageUrl: statusPageURL,
        detailsUrl: episodeDetailsUrl,
        resourcesAffected: resourcesAffectedString,
        episodeSeverity: episode.incidentSeverity?.name || " - ",
        episodeTitle: episode.title || "",
        note: episodePublicNote.note || "",
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
            projectId: episode.projectId?.toString(),
            incidentEpisodeId: episode.id?.toString(),
          });
          continue;
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
          continue;
        }

        notificationSentToAtLeastOneSubscriber = true;

        const unsubscribeUrl: string =
          StatusPageSubscriberService.getUnsubscribeLink(
            URL.fromString(statusPageURL),
            subscriber.id!,
          ).toString();

        logger.debug(
          `Prepared unsubscribe link for subscriber ${subscriber._id} for public note ${episodePublicNote.id}.`,
          {
            projectId: episode.projectId?.toString(),
            incidentEpisodeId: episode.id?.toString(),
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
            `Queueing SMS notification to subscriber ${subscriber._id} at ${phoneMasked} for public note ${episodePublicNote.id}.`,
            {
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
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
            smsMessage = `Incident update: ${episode.title || "-"} on ${statusPageName}. ${copy.smsNoteSentence} Details: ${episodeDetailsUrl}. Unsub: ${unsubscribeUrl}`;
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
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
            });
          });
        }

        if (subscriber.subscriberEmail) {
          // send email here.
          logger.debug(
            `Queueing email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail} for public note ${episodePublicNote.id}.`,
            {
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
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
              : copy.customTemplateEmailSubjectPrefix + episode.title || "";

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
              },
            ).catch((err: Error) => {
              logger.error(err, {
                ...EXTERNAL_FAULT,
                projectId: episode.projectId?.toString(),
                incidentEpisodeId: episode.id?.toString(),
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
                  episodeSeverity: episode.incidentSeverity?.name || " - ",
                  episodeTitle: episode.title || "",
                  episodeDescription: episode.description || "",
                  unsubscribeUrl: unsubscribeUrl,
                  subscriberEmailNotificationFooterText:
                    StatusPageServiceType.getSubscriberEmailFooterText(
                      statuspage,
                    ),
                },
                subject: copy.emailSubjectPrefix + episode.title,
              },
              {
                mailServer: ProjectSmtpConfigService.toEmailServer(
                  statuspage.smtpConfig,
                ),
                projectId: statuspage.projectId,
                statusPageId: statuspage.id!,
              },
            ).catch((err: Error) => {
              logger.error(err, {
                ...EXTERNAL_FAULT,
                projectId: episode.projectId?.toString(),
                incidentEpisodeId: episode.id?.toString(),
              });
            });
          }
          logger.debug(
            `Email notification queued for subscriber ${subscriber._id} for public note ${episodePublicNote.id}.`,
            {
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
            },
          );
        }

        if (subscriber.slackIncomingWebhookUrl) {
          // send slack message here.
          logger.debug(
            `Queueing Slack notification to subscriber ${subscriber._id} via incoming webhook for public note ${episodePublicNote.id}.`,
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
                subscriberTemplateVariables,
              );
          } else {
            // Use default hard-coded template
            markdownMessage = `## Incident - ${episode.title || ""}

**${copy.chatNoteSentence}**

**Resources Affected:** ${resourcesAffectedString}
**Severity:** ${episode.incidentSeverity?.name || " - "}

**Note:**
${episodePublicNote.note || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
          }

          SlackUtil.sendMessageToChannelViaIncomingWebhook({
            url: subscriber.slackIncomingWebhookUrl,
            text: SlackUtil.convertMarkdownToSlackRichText(markdownMessage),
          }).catch((err: Error) => {
            logger.error(err, {
              ...EXTERNAL_FAULT,
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
            });
          });
          logger.debug(
            `Slack notification queued for subscriber ${subscriber._id} for public note ${episodePublicNote.id}.`,
            {
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
            },
          );
        }

        if (subscriber.microsoftTeamsIncomingWebhookUrl) {
          // send Teams message here.
          logger.debug(
            `Queueing Microsoft Teams notification to subscriber ${subscriber._id} via incoming webhook for public note ${episodePublicNote.id}.`,
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
                subscriberTemplateVariables,
              );
          } else {
            // Use default hard-coded template
            markdownMessage = `## Incident - ${episode.title || ""}

**${copy.chatNoteSentence}**

**Resources Affected:** ${resourcesAffectedString}
**Severity:** ${episode.incidentSeverity?.name || " - "}

**Note:**
${episodePublicNote.note || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
          }

          MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
            url: subscriber.microsoftTeamsIncomingWebhookUrl,
            text: markdownMessage,
          }).catch((err: Error) => {
            logger.error(err, {
              ...EXTERNAL_FAULT,
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
            });
          });
          logger.debug(
            `Microsoft Teams notification queued for subscriber ${subscriber._id} for public note ${episodePublicNote.id}.`,
            {
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
            },
          );
        }

        if (subscriber.subscriberWebhook) {
          StatusPageSubscriberWebhookUtil.sendWebhookNotification({
            webhookUrl: subscriber.subscriberWebhook,
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
                resourcesAffected: resourcesAffectedString,
                note: episodePublicNote.note || "",
                detailsUrl: episodeDetailsUrl,
              },
            },
          }).catch((err: Error) => {
            logger.error(err, {
              ...EXTERNAL_FAULT,
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
            });
          });
        }
      }
    }

    if (notificationSentToAtLeastOneSubscriber) {
      logger.debug(
        `Notification sent to subscribers for public note added to episode: ${episode.id}`,
        {
          projectId: episode.projectId?.toString(),
          incidentEpisodeId: episode.id?.toString(),
        },
      );

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: episode.id!,
        projectId: episode.projectId!,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.SubscriberNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: `📧 **Notification sent to subscribers** because ${copy.feedSentReason} this [Episode ${episode.episodeNumberWithPrefix || "#" + episode.episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(episode.projectId!, episode.id!)).toString()}).`,
        moreInformationInMarkdown: `**Public Note:**

${episodePublicNote.note}`,
      });

      logger.debug("Episode Feed created", {
        projectId: episode.projectId?.toString(),
        incidentEpisodeId: episode.id?.toString(),
      });
    } else {
      logger.debug(
        `No subscribers were notified for public note added to episode: ${episode.id}. All status pages either hide episodes or had no matching subscribers.`,
        {
          projectId: episode.projectId?.toString(),
          incidentEpisodeId: episode.id?.toString(),
        },
      );

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: episode.id!,
        projectId: episode.projectId!,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.SubscriberNotificationSent,
        displayColor: Yellow500,
        feedInfoInMarkdown: `📧 **No notification sent to subscribers** for ${copy.feedNotSentSubject} on [Episode ${episode.episodeNumberWithPrefix || "#" + episode.episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(episode.projectId!, episode.id!)).toString()}).`,
        moreInformationInMarkdown:
          "Subscriber notifications were skipped because all associated status pages either hide episodes or had no matching subscribers.",
      });
    }

    // Set status to Success after successful notification
    await setNotificationStatus({
      noteId: episodePublicNote.id!,
      trigger: trigger,
      status: StatusPageSubscriberNotificationStatus.Success,
      message: copy.successMessage,
    });
    logger.debug(
      `Episode public note ${episodePublicNote.id} marked as Success for subscriber notifications.`,
      {
        projectId: episode.projectId?.toString(),
        incidentEpisodeId: episode.id?.toString(),
      },
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
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
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
          note: true,
          incidentEpisodeId: true,
          projectId: true,
        },
      });

    logger.debug(
      `Found ${episodePublicNotes.length} episode public note(s) to notify subscribers for.`,
    );

    for (const episodePublicNote of episodePublicNotes) {
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
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
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
