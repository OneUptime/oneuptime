import RunCron from "../../Utils/Cron";
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
import AffectedStatusPageResources from "Common/Server/Utils/StatusPage/AffectedStatusPageResources";
import BlockedProjectStatusPages from "Common/Server/Utils/StatusPage/BlockedProjectStatusPages";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
  SubscriberNotificationEmailBodyTemplateVariables,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import SafeHtml from "Common/Types/SafeHtml";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import StatusPageResourceUtil from "Common/Server/Utils/StatusPageResource";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { STATUS_PAGE_OF_BLOCKED_PROJECT_SENDS_NOTHING_MESSAGE } from "Common/Types/StatusPage/StatusPageProjectBlock";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500, Yellow500 } from "Common/Types/BrandColors";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import SubscriberNotificationTrigger from "Common/Types/StatusPage/SubscriberNotificationTrigger";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";
import QueryDeepPartialEntity from "Common/Types/Database/PartialEntity";
import StatusPageEmailLogo from "Common/Server/Utils/StatusPage/StatusPageEmailLogo";
import StateChangeNoteMessage from "Common/Types/StatusPage/StateChangeNoteMessage";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import SubscriberMarkdownTemplateValues from "Common/Server/Utils/StatusPage/SubscriberMarkdownTemplateValues";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "Common/Utils/Markdown/FeedMarkdown";
import { isSendingSubscriberNotifications } from "Common/Types/StatusPage/SubscriberNotificationsSwitch";
import SubscriberLanguage from "Common/Server/Utils/StatusPage/SubscriberLanguage";
import SubscriberTemplateValues from "Common/Server/Utils/StatusPage/SubscriberTemplateValues";
import SubscriberMessageText, {
  SubscriberChatText,
} from "Common/Server/Utils/StatusPage/SubscriberMessageText";
import { writeInLanguage } from "Common/Server/Utils/ServerTranslation";
import { DEFAULT_READER_LANGUAGE } from "Common/Types/ReaderLanguage";
import { translationKey, Translator } from "Common/Types/Translator";

/*
 * The words a note's default Slack and Teams messages share, in each
 * subscriber's language (Common/Server/Locales).
 */
const NOTE_CHAT_TEXT: {
  readonly heading: string;
  readonly event: string;
} = {
  heading: translationKey("Scheduled Maintenance Update - {{statusPageName}}"),
  event: translationKey("Event:"),
};
import ScheduledMaintenancePublication, {
  NOT_PUBLISHED_YET_SKIPPED_MESSAGE,
  ScheduledMaintenancePublicationState,
} from "Common/Types/ScheduledMaintenance/ScheduledMaintenancePublication";

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
  // The email's subject, {{title}} the event's title.
  emailSubject: string;
  // A custom template's subject when it has none of its own.
  customTemplateEmailSubject: string;
  // How the text message starts.
  smsHeadline: string;
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
    emailSubject: translationKey("[Update Scheduled Maintenance] {{title}}"),
    customTemplateEmailSubject: translationKey(
      "[Scheduled Maintenance Update] {{title}}",
    ),
    smsHeadline: translationKey(
      "Maintenance update: {{title}} on {{statusPageName}}.",
    ),
    chatNoteSentence: translationKey("New Note Added"),
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
    emailSubject: translationKey(
      "[Scheduled Maintenance Note Updated] {{title}}",
    ),
    customTemplateEmailSubject: translationKey(
      "[Scheduled Maintenance Note Updated] {{title}}",
    ),
    smsHeadline: translationKey(
      "Maintenance note updated: {{title}} on {{statusPageName}}.",
    ),
    chatNoteSentence: translationKey("Note Updated"),
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
          /*
           * Templates offer {{scheduledMaintenanceState}}: the event's state
           * right now, unless the note names the state it was posted with.
           * Read with its colour, as every state an email names is.
           */
          currentScheduledMaintenanceState: {
            name: true,
            color: true,
          },
          monitors: {
            _id: true,
          },
          statusPages: {
            _id: true,
          },
          isVisibleOnStatusPage: true,
          publishOnStatusPageAt: true,
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

    /*
     * Only a note on an event shown on its status pages tells their
     * subscribers: not one on an event hidden from them, nor on one kept to
     * the team until its publish time - its subscribers hear of the event
     * when it is published, and read its notes on the page from then on.
     */
    const publication: ScheduledMaintenancePublicationState =
      ScheduledMaintenancePublication.getState(event);

    if (publication !== ScheduledMaintenancePublicationState.Published) {
      // Set status to Skipped for events not shown on status pages
      logger.debug(
        `Scheduled maintenance ${event.id} is not shown on status page (${publication}); marking public note ${publicNote.id} as Skipped.`,
      );
      await setNotificationStatus({
        noteId: publicNote.id!,
        trigger: trigger,
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message:
          publication === ScheduledMaintenancePublicationState.Hidden
            ? "Notifications skipped as scheduled maintenance is not visible on status page."
            : NOT_PUBLISHED_YET_SKIPPED_MESSAGE,
      });
      return; // skip if not shown on status page.
    }

    /*
     * The resources the event affects on each status page: its monitors, and
     * the monitor groups that hold them - the same ones its created, state
     * change and reminder notifications go by. A subscriber who picked a
     * monitor group hears about a note on an event on any monitor in it.
     */
    const statusPageToResources: Dictionary<Array<StatusPageResource>> =
      await AffectedStatusPageResources.findForMonitors({
        monitors: event.monitors || [],
        statusPages: event.statusPages || [],
        select: {
          _id: true,
          displayName: true,
          statusPageId: true,
          // {{resourcesAffected}} lists the resources by their group.
          statusPageGroupId: true,
          statusPageGroup: {
            name: true,
          },
        },
      });

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
        /*
         * The pages of a blocked project send nothing, and are left out of
         * the pages to send from: say so, rather than that none are set.
         */
        message: (await BlockedProjectStatusPages.isProjectBlocked(
          event.projectId,
        ))
          ? STATUS_PAGE_OF_BLOCKED_PROJECT_SENDS_NOTHING_MESSAGE
          : "No status pages are configured for this scheduled maintenance. Skipping notifications.",
      });
      return;
    }

    /*
     * Pre-compute markdown conversions for the note and the event description
     * once per public note. These values do not vary per status page or per
     * subscriber, so memoizing here avoids N redundant markdown parses during
     * fan-out.
     */
    const noteHtml: string = await Markdown.convertToHTML(
      publicNote.note || "",
      MarkdownContentType.Email,
    );
    const notePlainText: string = Markdown.convertToPlainText(
      publicNote.note || "",
    );
    const descriptionHtml: string = await Markdown.convertToHTML(
      event.description || "",
      MarkdownContentType.Email,
    );
    const descriptionPlainText: string = Markdown.convertToPlainText(
      event.description || "",
    );

    /*
     * {{postedAt}} is when the note says it was posted, which the author can
     * edit, so an update notification reads it fresh from the row. Only a
     * legacy row with no postedAt falls back to the time of sending.
     */
    const notePostedAtDate: Date =
      publicNote.postedAt || OneUptimeDate.getCurrentDate();

    const scheduledAtString: string =
      OneUptimeDate.getDateAsUserFriendlyFormattedString(event.startsAt!);

    /*
     * The state the event moved to, when this note was posted with that
     * state change (ScheduledMaintenancePublicNote
     * .postedWithScheduledMaintenanceState). The note is then the one
     * message subscribers get about the change, so every default message of
     * it names the state (StateChangeNoteMessage), and so does
     * {{scheduledMaintenanceState}}. Not for an edit's update notification,
     * which keeps its own words: the event may have moved on since.
     */
    const stateChange: ScheduledMaintenanceState | undefined =
      trigger === SubscriberNotificationTrigger.Created &&
      publicNote.postedWithScheduledMaintenanceState?.name?.trim()
        ? publicNote.postedWithScheduledMaintenanceState
        : undefined;
    const stateChangeName: string = stateChange?.name || "";

    let notificationSentToAtLeastOneSubscriber: boolean = false;

    /*
     * "**Status:** Ongoing" under the event, for a note posted with a state
     * change; for any other note, the blank line that was always there - in
     * a subscriber's language.
     */
    const getChatStatusLine: (translator: Translator) => MarkdownText = (
      translator: Translator,
    ): MarkdownText => {
      return stateChange
        ? mdText`\n${StateChangeNoteMessage.getChatStatusLine(stateChangeName, translator)}\n`
        : FeedMarkdown.empty();
    };

    for (const statuspage of statusPages) {
      if (!statuspage.id) {
        logger.debug("Encountered a status page without an id; skipping.");
        continue;
      }

      // The page sends its subscribers nothing (Send Notifications to Subscribers off).
      if (!isSendingSubscriberNotifications(statuspage)) {
        logger.debug(
          `Status page ${statuspage.id} does not send notifications to its subscribers; skipping.`,
        );
        continue;
      }

      if (!statuspage.showScheduledMaintenanceEventsOnStatusPage) {
        logger.debug(
          `Status page ${statuspage.id} hides maintenance events; skipping.`,
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

      const scheduledEventDetailsUrl: string =
        event.id && statusPageURL
          ? URL.fromString(statusPageURL)
              .addRoute(`/scheduled-events/${event.id.toString()}`)
              .toString()
          : statusPageURL;

      /*
       * The affected resources on this status page: one group per line for
       * HTML email bodies, and on one line for every channel that shows
       * "<br/>" as literal text.
       */
      const resourcesAffectedString: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupName(
          statusPageToResources[statuspage._id!] || [],
        );
      const resourcesAffectedPlainText: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupNameAsPlainText(
          statusPageToResources[statuspage._id!] || [],
        );

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
       * Every variable SubscriberNotificationTemplateVariables advertises for
       * the scheduled maintenance note events, built once per status page.
       * The values below are the same on every channel; the three objects
       * after them add the ones whose format depends on the channel, and
       * every channel adds the subscriber's unsubscribeUrl, so no channel can
       * miss a variable the others have.
       */
      const templateVariables: Record<string, string> =
        SubscriberTemplateValues.inPageLanguage(statuspage, {
          statusPageName: statusPageName,
          statusPageUrl: statusPageURL,
          detailsUrl: scheduledEventDetailsUrl,
          scheduledMaintenanceTitle: event.title || "",
          // A default state name, and the date, in the page's language.
          scheduledMaintenanceState: SubscriberTemplateValues.stateName(
            stateChangeName || event.currentScheduledMaintenanceState?.name,
          ),
          postedAt: SubscriberTemplateValues.date(notePostedAtDate),
        });

      /*
       * Custom templates get each value in the format their channel renders:
       * HTML for the email body (it is wrapped only by BlankTemplate), plain
       * text for SMS and the email subject, and Markdown for Slack and Teams.
       * The conversions are the memoized ones computed once per public note
       * above.
       *
       * The shared values above are plain text: the email body escapes them
       * (compileEmailBodyTemplate), and only the values wrapped in SafeHtml
       * go into it as HTML.
       */
      const emailBodyTemplateVariables: SubscriberNotificationEmailBodyTemplateVariables =
        {
          ...templateVariables,
          resourcesAffected: SafeHtml.fromTrustedHtml(resourcesAffectedString),
          scheduledMaintenanceDescription:
            SafeHtml.fromTrustedHtml(descriptionHtml),
          note: SafeHtml.fromTrustedHtml(noteHtml),
        };

      const plainTextTemplateVariables: Record<string, string> = {
        ...templateVariables,
        resourcesAffected: resourcesAffectedPlainText,
        scheduledMaintenanceDescription: descriptionPlainText,
        note: notePlainText,
      };

      /*
       * A custom Slack or Teams message is Markdown: every plain value - the
       * title, the status page's name, the state, the resource list - is
       * escaped, so it reads as typed and cannot become a link, an image, raw
       * HTML or a chat mention wherever the template places it
       * (SubscriberMarkdownTemplateValues). The addresses are OneUptime's
       * own; the description and the note stay the Markdown they were
       * written as.
       */
      const markdownTemplateVariables: Record<string, string> = {
        ...SubscriberMarkdownTemplateValues.fromPlainValues({
          ...templateVariables,
          resourcesAffected: resourcesAffectedPlainText,
        }),
        scheduledMaintenanceDescription: event.description || "",
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
            subscriber,
          ).toString();

        /*
         * The language this subscriber's messages are written in: their own,
         * else the page's (SubscriberLanguage).
         */
        const language: string = SubscriberLanguage.getLanguage({
          subscriber: subscriber,
          statusPage: statuspage,
        });

        // The default Slack and Teams message, in the subscriber's language.
        const getChatMessage: () => string = (): string => {
          return writeInLanguage(language, (translator: Translator): string => {
            return mdText`## ${translator.translateTemplate(NOTE_CHAT_TEXT.heading, { statusPageName: statusPageName })}

${SubscriberMessageText.chatLine(translator, NOTE_CHAT_TEXT.event, event.title || "")}
${getChatStatusLine(translator)}
**${SubscriberMessageText.text(translator, copy.chatNoteSentence)}**

${SubscriberMessageText.chatLine(translator, SubscriberChatText.note, FeedMarkdown.asMarkdown(publicNote.note || ""))}

${SubscriberMessageText.chatLinks(translator, { statusPageUrl: statusPageURL, unsubscribeUrl: unsubscribeUrl })}`.toString();
          });
        };

        logger.debug(
          `Prepared unsubscribe link for subscriber ${subscriber._id} for public note ${publicNote.id}.`,
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
            // OneUptime's own words, in the subscriber's language.
            smsMessage = writeInLanguage(
              language,
              (translator: Translator): string => {
                const smsHeadline: string = stateChange
                  ? StateChangeNoteMessage.getScheduledMaintenanceSmsHeadline({
                      stateName: stateChangeName,
                      eventTitle: event.title || "",
                      statusPageName: statusPageName,
                      translator: translator,
                    })
                  : translator.translateTemplate(copy.smsHeadline, {
                      title: event.title || "",
                      statusPageName: statusPageName,
                    });

                return SubscriberMessageText.smsWithLinks(translator, {
                  sentences: [smsHeadline],
                  detailsUrl: scheduledEventDetailsUrl,
                  unsubscribeUrl: unsubscribeUrl,
                });
              },
            );
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
            // OneUptime's own words, in the subscriber's language.
            markdownMessage = getChatMessage();
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
            // OneUptime's own words, in the subscriber's language.
            markdownMessage = getChatMessage();
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
          StatusPageSubscriberWebhookUtil.sendWebhookNotification({
            webhookUrl: subscriber.subscriberWebhook,
            isAddedByTeam: subscriber.isAddedByTeam,
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
                resourcesAffected: resourcesAffectedPlainText,
                note: publicNote.note || "",
                // The state a note posted with a state change moved the event to.
                ...(stateChange
                  ? { scheduledMaintenanceState: stateChangeName }
                  : {}),
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
              StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate(
                emailTemplate.templateBody,
                subscriberEmailBodyTemplateVariables,
              );
            const compiledSubject: string = emailTemplate.emailSubject
              ? StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                  emailTemplate.emailSubject,
                  subscriberPlainTextTemplateVariables,
                )
              : writeInLanguage(language, (translator: Translator): string => {
                  return stateChange
                    ? StateChangeNoteMessage.getScheduledMaintenanceCustomTemplateEmailSubject(
                        {
                          stateName: stateChangeName,
                          eventTitle: event.title || "",
                          translator: translator,
                        },
                      )
                    : translator.translateTemplate(
                        copy.customTemplateEmailSubject,
                        { title: event.title || "" },
                      );
                });

            MailService.sendMail(
              {
                toEmail: subscriber.subscriberEmail,
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
                  logoUrl: StatusPageEmailLogo.getLogoUrl({
                    statusPage: statuspage,
                    host: host,
                    httpProtocol: httpProtocol,
                  }),
                  isPublicStatusPage: statuspage.isPublicStatusPage
                    ? "true"
                    : "false",
                  resourcesAffected: resourcesAffectedString,
                  scheduledAt: scheduledAtString,
                  eventTitle: event.title || "",
                  /*
                   * The state a note posted with a state change moved the
                   * event to, in its own colour: the template's Status row
                   * shows only when it is set.
                   */
                  ...(stateChange
                    ? {
                        // OneUptime's default name, in the subscriber's language.
                        eventState: writeInLanguage(
                          language,
                          (translator: Translator): string => {
                            return SubscriberMessageText.nameInLanguage(
                              translator,
                              stateChangeName,
                            );
                          },
                        ),
                        ...EmailColorUtil.getTemplateVariables(
                          "eventState",
                          stateChange.color,
                        ),
                      }
                    : {}),
                  /*
                   * The template shows this in DetailBoxField's raw-HTML
                   * slot, so it is the rendered Markdown. It used to be the
                   * Markdown as written, which put any HTML the author typed
                   * into the email live.
                   */
                  eventDescription: descriptionHtml,
                  unsubscribeUrl: unsubscribeUrl,
                  subscriberEmailNotificationFooterText:
                    StatusPageServiceType.getSubscriberEmailFooterText(
                      statuspage,
                    ),
                },
                subject: writeInLanguage(
                  language,
                  (translator: Translator): string => {
                    return stateChange
                      ? StateChangeNoteMessage.getScheduledMaintenanceEmailSubject(
                          {
                            stateName: stateChangeName,
                            eventTitle: event.title || "",
                            translator: translator,
                          },
                        )
                      : translator.translateTemplate(copy.emailSubject, {
                          title: event.title || "",
                        });
                  },
                ),
                isSubjectLiteral: true,
                // The template's own words, in the subscriber's language.
                ...(language !== DEFAULT_READER_LANGUAGE
                  ? { language: language }
                  : {}),
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
        feedInfoInMarkdown:
          mdText`📧 **Notification sent to subscribers** because ${copy.feedSentReason} this [Scheduled Maintenance ${event.scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(event.projectId!, event.id!)).toString()}).`.toString(),
        moreInformationInMarkdown: mdText`**Public Note:**

${FeedMarkdown.asMarkdown(publicNote.note)}`.toString(),
        /*
         * The feed only: a side effect of the public note the channel was
         * told of already.
         */
        workspaceNotification: {
          sendWorkspaceNotification: false,
        },
      });
    } else {
      logger.debug(
        `No subscribers were notified for public note on scheduled maintenance: ${event.id}. All status pages either hide maintenance events or had no matching subscribers.`,
      );

      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
        scheduledMaintenanceId: event.id!,
        projectId: event.projectId!,
        scheduledMaintenanceFeedEventType:
          ScheduledMaintenanceFeedEventType.SubscriberNotificationSent,
        displayColor: Yellow500,
        feedInfoInMarkdown:
          mdText`📧 **No notification sent to subscribers** for ${copy.feedNotSentSubject} on [Scheduled Maintenance ${event.scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(event.projectId!, event.id!)).toString()}).`.toString(),
        moreInformationInMarkdown:
          "Subscriber notifications were skipped because all associated status pages either do not send notifications to their subscribers, hide maintenance events, or had no matching subscribers.",
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
          // Published notes only: one waiting for approval is told to nobody yet.
          isPublished: true,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          note: true,
          postedAt: true,
          scheduledMaintenanceId: true,
          // The state change it was posted with, which its messages name.
          postedWithScheduledMaintenanceState: {
            name: true,
            color: true,
          },
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
          // Published notes only: one waiting for approval is told to nobody yet.
          isPublished: true,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          note: true,
          postedAt: true,
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
        /*
         * The note's 'posted' notification is being sent right now, with the
         * note as it was read before this edit. Left Pending, untouched: a
         * later run sends the update once that has settled
         * (SubscriberUpdateNotification).
         */
        if (
          SubscriberUpdateNotification.isOriginalNotificationBeingSent(
            publicNote.subscriberNotificationStatusOnNoteCreated,
          )
        ) {
          logger.debug(
            `Scheduled maintenance public note ${publicNote.id}'s posted notification is being sent; its update notification waits for it.`,
          );
          continue;
        }

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
