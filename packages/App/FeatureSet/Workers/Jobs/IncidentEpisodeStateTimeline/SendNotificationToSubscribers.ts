import RunCron from "../../Utils/Cron";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import SMS from "Common/Types/SMS/SMS";
import Text from "Common/Types/Text";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "Common/Server/Services/IncidentEpisodeStateTimelineService";
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSMTPConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import StatusPageSubscriberUnsubscribe from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
  SubscriberNotificationEmailBodyTemplateVariables,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import SafeHtml from "Common/Types/SafeHtml";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import StatusPageVisibility from "Common/Types/StatusPage/StatusPageVisibility";
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
import SubscriberNotificationRunLimit, {
  SubscriberNotificationProjectSlot,
} from "Common/Server/Utils/StatusPage/SubscriberNotificationRunLimit";
import SubscriberNotificationFanOut from "Common/Server/Utils/StatusPage/SubscriberNotificationFanOut";
import Email from "Common/Types/Email";
import StatusPageEmailLogo from "Common/Server/Utils/StatusPage/StatusPageEmailLogo";
import { escapeMarkdownValue } from "Common/Utils/Markdown/MarkdownEscape";

RunCron(
  "IncidentEpisodeStateTimeline:SendNotificationToSubscribers",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    // Sized to one notification's send window (SubscriberNotificationTiming).
    timeoutInMS: SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS,
  },
  SubscriberNotificationRunLimit.limit(
    "IncidentEpisodeStateTimeline:SendNotificationToSubscribers",
    async () => {
      const runClock: SubscriberNotificationRunClock =
        SubscriberNotificationTiming.startRun();

      // First, mark state timelines as Skipped if they should not be notified
      const timelinesToSkip: Array<IncidentEpisodeStateTimeline> =
        await IncidentEpisodeStateTimelineService.findBy({
          query: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Pending,
            shouldStatusPageSubscribersBeNotified: false,
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
        `Found ${timelinesToSkip.length} episode state timeline(s) to mark as Skipped (subscribers should not be notified).`,
      );

      for (const timeline of timelinesToSkip) {
        logger.debug(
          `Marking episode state timeline ${timeline.id} as Skipped for subscriber notifications.`,
        );
        await IncidentEpisodeStateTimelineService.updateOneById({
          id: timeline.id!,
          data: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Skipped,
            subscriberNotificationStatusMessage:
              "Notifications skipped as subscribers are not to be notified for this state change.",
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
        logger.debug(
          `Episode state timeline ${timeline.id} marked as Skipped for subscriber notifications.`,
        );
      }

      // Get all episode state timelines that need notification
      const episodeStateTimelines: Array<IncidentEpisodeStateTimeline> =
        await IncidentEpisodeStateTimelineService.findBy({
          query: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Pending,
            shouldStatusPageSubscribersBeNotified: true,
          },
          props: {
            isRoot: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
          /*
           * Oldest first, and each sent in full before the next: a state
           * change or note queued before another reaches subscribers before it
           * (the default order is newest first).
           */
          sort: {
            createdAt: SortOrder.Ascending,
          },
          select: {
            _id: true,
            // What the claim checks the row against (SubscriberNotificationClaim).
            version: true,
            projectId: true,
            incidentEpisodeId: true,
            incidentStateId: true,
            incidentState: {
              name: true,
              color: true,
              isCreatedState: true,
            },
          },
        });

      logger.debug(
        `Found ${episodeStateTimelines.length} episode state timeline(s) to notify subscribers for.`,
      );

      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      for (const episodeStateTimeline of episodeStateTimelines) {
        if (!runClock.canClaimAnotherNotification()) {
          /*
           * Whatever this run claims now might not finish before its timeout.
           * The rest stay Pending for the runs that follow.
           */
          logger.debug(
            "Leaving the remaining episode state timelines for the next run.",
          );
          break;
        }

        /*
         * One of the project's slots for this job: a project already sending
         * its share of these notifications leaves this one Pending, so one
         * tenant's slow sends cannot hold every run (SubscriberNotificationRunLimit).
         */
        const projectSlot: SubscriberNotificationProjectSlot | null =
          await SubscriberNotificationRunLimit.takeProjectSlot({
            jobName:
              "IncidentEpisodeStateTimeline:SendNotificationToSubscribers",
            projectId: episodeStateTimeline.projectId,
          });

        if (!projectSlot) {
          continue;
        }

        // Whether this run owns the notification, and so may settle it.
        let claimed: boolean = false;

        try {
          logger.debug(
            `Processing episode state timeline ${episodeStateTimeline.id}.`,
            {
              projectId: episodeStateTimeline.projectId?.toString(),
              incidentEpisodeId:
                episodeStateTimeline.incidentEpisodeId?.toString(),
            },
          );
          /*
           * Set to InProgress at the start of processing: Pending to
           * InProgress, only if no other run has claimed it and it has not
           * changed since this run read it (SubscriberNotificationClaim).
           */
          claimed = await SubscriberNotificationClaim.claim({
            service: IncidentEpisodeStateTimelineService,
            id: episodeStateTimeline.id!,
            statusColumn: "subscriberNotificationStatus",
            version: episodeStateTimeline.version,
          });

          if (!claimed) {
            logger.debug(
              `Episode state timeline ${episodeStateTimeline.id} was claimed by another run, or changed since this run read it; leaving it.`,
            );
            continue;
          }

          const sendWindow: SubscriberNotificationSendWindow =
            SubscriberNotificationTiming.startSendWindow();

          if (
            !episodeStateTimeline.incidentEpisodeId ||
            !episodeStateTimeline.incidentStateId
          ) {
            await IncidentEpisodeStateTimelineService.updateOneById({
              id: episodeStateTimeline.id!,
              data: {
                subscriberNotificationStatus:
                  StatusPageSubscriberNotificationStatus.Skipped,
                subscriberNotificationStatusMessage:
                  "Missing episode or incident state reference. Skipping notifications.",
              },
              props: { isRoot: true, ignoreHooks: true },
            });
            continue;
          }

          if (!episodeStateTimeline.incidentState?.name) {
            await IncidentEpisodeStateTimelineService.updateOneById({
              id: episodeStateTimeline.id!,
              data: {
                subscriberNotificationStatus:
                  StatusPageSubscriberNotificationStatus.Skipped,
                subscriberNotificationStatusMessage:
                  "Incident state has no name. Skipping notifications.",
              },
              props: { isRoot: true, ignoreHooks: true },
            });
            continue;
          }

          if (episodeStateTimeline.incidentState.isCreatedState) {
            await IncidentEpisodeStateTimelineService.updateOneById({
              id: episodeStateTimeline.id!,
              data: {
                subscriberNotificationStatus:
                  StatusPageSubscriberNotificationStatus.Skipped,
                subscriberNotificationStatusMessage:
                  "Notification already sent when the episode was created. So, episode state change notification is skipped.",
              },
              props: { isRoot: true, ignoreHooks: true },
            });
            continue;
          }

          // Get the episode
          const episode: IncidentEpisode | null =
            await IncidentEpisodeService.findOneById({
              id: episodeStateTimeline.incidentEpisodeId!,
              props: {
                isRoot: true,
              },
              select: {
                _id: true,
                title: true,
                projectId: true,
                incidentSeverity: {
                  name: true,
                  color: true,
                },
                // Whether a status page shows it (StatusPageVisibility): visible, and not private.
                isVisibleOnStatusPage: true,
                isPrivate: true,
                episodeNumber: true,
              },
            });

          if (!episode) {
            logger.debug(
              `Episode ${episodeStateTimeline.incidentEpisodeId} not found; marking as Skipped.`,
              {
                projectId: episodeStateTimeline.projectId?.toString(),
                incidentEpisodeId:
                  episodeStateTimeline.incidentEpisodeId?.toString(),
              },
            );
            await IncidentEpisodeStateTimelineService.updateOneById({
              id: episodeStateTimeline.id!,
              data: {
                subscriberNotificationStatus:
                  StatusPageSubscriberNotificationStatus.Skipped,
                subscriberNotificationStatusMessage:
                  "Related episode not found. Skipping notifications.",
              },
              props: { isRoot: true, ignoreHooks: true },
            });
            continue;
          }

          /*
           * The episode's incidents, with their monitors. The episode reaches
           * the union of the status pages its incidents reach, each through its
           * own status page scope.
           */
          const memberIncidents: Array<Incident> =
            await IncidentStatusPageScope.getEpisodeMemberIncidents(
              episode.id!,
            );

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
              `Episode ${episode.id} has no monitors; marking timeline ${episodeStateTimeline.id} as Skipped.`,
              {
                projectId: episode.projectId?.toString(),
                incidentEpisodeId: episode.id?.toString(),
              },
            );
            await IncidentEpisodeStateTimelineService.updateOneById({
              id: episodeStateTimeline.id!,
              data: {
                subscriberNotificationStatus:
                  StatusPageSubscriberNotificationStatus.Skipped,
                subscriberNotificationStatusMessage:
                  "No monitors are attached to the incidents in this episode. Skipping notifications.",
              },
              props: { isRoot: true, ignoreHooks: true },
            });
            continue;
          }

          if (!StatusPageVisibility.isShown(episode)) {
            logger.debug(
              `Episode ${episode.id} not visible on status page; marking as Skipped.`,
              {
                projectId: episode.projectId?.toString(),
                incidentEpisodeId: episode.id?.toString(),
              },
            );
            await IncidentEpisodeStateTimelineService.updateOneById({
              id: episodeStateTimeline.id!,
              data: {
                subscriberNotificationStatus:
                  StatusPageSubscriberNotificationStatus.Skipped,
                subscriberNotificationStatusMessage:
                  "Episode is not visible on status page. Skipping notifications.",
              },
              props: { isRoot: true, ignoreHooks: true },
            });
            continue;
          }

          /*
           * The status pages the episode's incidents reach - through their
           * monitors, each narrowed to the pages it is limited to - in name
           * order.
           */
          const resolvedStatusPages: ResolvedIncidentStatusPages =
            await IncidentStatusPageScope.resolvePagesForIncidents({
              incidents: memberIncidents,
            });

          const statusPageToResources: Dictionary<Array<StatusPageResource>> =
            resolvedStatusPages.statusPageToResources;
          const statusPages: Array<StatusPage> =
            resolvedStatusPages.statusPages;

          logger.debug(
            `Episode ${episode.id} reaches ${statusPages.length} status page(s) for state timeline notification; ${resolvedStatusPages.excludedStatusPages.length} left out by its incidents' status page scope.`,
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

          const logAttributes: LogAttributes = {
            projectId: episode.projectId?.toString(),
            incidentEpisodeId: episode.id?.toString(),
          };
          const episodeStateName: string =
            episodeStateTimeline.incidentState.name;

          for (const statuspage of statusPages) {
            try {
              if (!statuspage.id) {
                logger.debug(
                  "Encountered a status page without an id; skipping.",
                  {
                    projectId: episode.projectId?.toString(),
                    incidentEpisodeId: episode.id?.toString(),
                  },
                );
                continue;
              }

              if (!statuspage.showEpisodesOnStatusPage) {
                logger.debug(
                  `Status page ${statuspage.id} hides episodes; skipping.`,
                  {
                    projectId: episode.projectId?.toString(),
                    incidentEpisodeId: episode.id?.toString(),
                  },
                );
                deliveryRecord.skipStatusPage(
                  statuspage,
                  StatusPageDeliverySkipReason.HidesEpisodes,
                );
                continue;
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

              const statusPageURL: string =
                await StatusPageService.getStatusPageURL(statuspage.id);
              const statusPageName: string =
                statuspage.pageTitle || statuspage.name || "Status Page";

              /*
               * The status page has no /episodes page: it shows an episode on its
               * incident detail route (/incidents/:id), which looks the id up as an
               * incident first and then as an episode.
               */
              const episodeDetailsUrl: string =
                episode.id && statusPageURL
                  ? URL.fromString(statusPageURL)
                      .addRoute(`/incidents/${episode.id.toString()}`)
                      .toString()
                  : statusPageURL;

              // Fetch custom templates for this status page (if any)
              const [
                emailTemplate,
                smsTemplate,
                slackTemplate,
                teamsTemplate,
              ]: [
                StatusPageSubscriberNotificationTemplate | null,
                StatusPageSubscriberNotificationTemplate | null,
                StatusPageSubscriberNotificationTemplate | null,
                StatusPageSubscriberNotificationTemplate | null,
              ] = await Promise.all([
                StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                  {
                    statusPageId: statuspage.id!,
                    eventType:
                      StatusPageSubscriberNotificationEventType.SubscriberEpisodeStateChanged,
                    notificationMethod:
                      StatusPageSubscriberNotificationMethod.Email,
                  },
                ),
                StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                  {
                    statusPageId: statuspage.id!,
                    eventType:
                      StatusPageSubscriberNotificationEventType.SubscriberEpisodeStateChanged,
                    notificationMethod:
                      StatusPageSubscriberNotificationMethod.SMS,
                  },
                ),
                StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                  {
                    statusPageId: statuspage.id!,
                    eventType:
                      StatusPageSubscriberNotificationEventType.SubscriberEpisodeStateChanged,
                    notificationMethod:
                      StatusPageSubscriberNotificationMethod.Slack,
                  },
                ),
                StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                  {
                    statusPageId: statuspage.id!,
                    eventType:
                      StatusPageSubscriberNotificationEventType.SubscriberEpisodeStateChanged,
                    notificationMethod:
                      StatusPageSubscriberNotificationMethod.MicrosoftTeams,
                  },
                ),
              ]);

              /*
               * The HTML list (escaped names, "<br/>" between groups) is only for
               * email bodies; every other channel, and the email heading, which
               * the template escapes, gets the plain-text list.
               */
              const resourcesAffectedHtml: string =
                StatusPageResourceUtil.getResourcesGroupedByGroupName(
                  statusPageToResources[statuspage._id!] || [],
                  "", // Use empty string as default for backward compatibility
                );
              const resourcesAffectedPlainText: string =
                StatusPageResourceUtil.getResourcesGroupedByGroupNameAsPlainText(
                  statusPageToResources[statuspage._id!] || [],
                  "",
                );

              /*
               * Every variable SubscriberNotificationTemplateVariables advertises
               * for SubscriberEpisodeStateChanged, in the format each channel
               * renders. These are the ones that read the same on every channel;
               * the resource list is added per format below and unsubscribeUrl per
               * subscriber.
               */
              const templateVariables: Record<string, string> = {
                statusPageName: statusPageName,
                statusPageUrl: statusPageURL,
                detailsUrl: episodeDetailsUrl,
                episodeSeverity: episode.incidentSeverity?.name || " - ",
                episodeTitle: episode.title || "",
                episodeState: episodeStateName,
              };

              /*
               * The custom email body is HTML: it is wrapped only by
               * BlankTemplate. compileEmailBodyTemplate escapes the plain values
               * above; only the SafeHtml resource list goes in as HTML.
               */
              const emailBodyTemplateVariables: SubscriberNotificationEmailBodyTemplateVariables =
                {
                  ...templateVariables,
                  resourcesAffected: SafeHtml.fromTrustedHtml(
                    resourcesAffectedHtml || "None",
                  ),
                };

              /*
               * SMS, the email subject, Slack and Teams do not render HTML, so they
               * get the resource list on one line. This event has no Markdown text,
               * so Slack and Teams need nothing else of their own.
               */
              const plainTextTemplateVariables: Record<string, string> = {
                ...templateVariables,
                resourcesAffected: resourcesAffectedPlainText || "None",
              };

              /*
               * Slack and Teams render Markdown, though: there the plain values
               * - the title, the names, the resource list - are escaped, so
               * they read as typed and cannot become a link, an image, raw
               * HTML or a chat mention wherever a custom template places them.
               * The addresses are OneUptime's own.
               */
              const markdownTemplateVariables: Record<string, string> = {
                ...templateVariables,
                statusPageName: escapeMarkdownValue(statusPageName),
                episodeSeverity: escapeMarkdownValue(
                  episode.incidentSeverity?.name || " - ",
                ),
                episodeTitle: escapeMarkdownValue(episode.title || ""),
                episodeState: escapeMarkdownValue(episodeStateName),
                resourcesAffected: escapeMarkdownValue(
                  resourcesAffectedPlainText || "None",
                  { keepLineBreaks: true },
                ),
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
                handler: async (
                  subscriber: StatusPageSubscriber,
                ): Promise<void> => {
                  if (!subscriber._id) {
                    logger.debug(
                      "Encountered a subscriber without an _id; skipping.",
                      {
                        projectId: episode.projectId?.toString(),
                        incidentEpisodeId: episode.id?.toString(),
                      },
                    );
                    return;
                  }

                  const shouldNotifySubscriber: boolean =
                    StatusPageSubscriberService.shouldSendNotification({
                      subscriber: subscriber,
                      statusPageResources:
                        statusPageToResources[statuspage._id!] || [],
                      statusPage: statuspage,
                      eventType: StatusPageEventType.Incident, // Episodes use incident event type
                    });

                  if (!shouldNotifySubscriber) {
                    logger.debug(
                      `Skipping subscriber ${subscriber._id} based on preferences for state timeline ${episodeStateTimeline.id}.`,
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

                  const subscriberEmailBodyTemplateVariables: SubscriberNotificationEmailBodyTemplateVariables =
                    {
                      ...emailBodyTemplateVariables,
                      unsubscribeUrl: unsubscribeUrl,
                    };
                  const subscriberPlainTextTemplateVariables: Record<
                    string,
                    string
                  > = {
                    ...plainTextTemplateVariables,
                    unsubscribeUrl: unsubscribeUrl,
                  };
                  const subscriberMarkdownTemplateVariables: Record<
                    string,
                    string
                  > = {
                    ...markdownTemplateVariables,
                    unsubscribeUrl: unsubscribeUrl,
                  };

                  /*
                   * An email address or phone number already sent this in this
                   * send, through an earlier page, is not sent it again (only when
                   * an incident of the episode is scoped; see
                   * SubscriberNotificationDeliveryRecord).
                   */
                  if (
                    subscriber.subscriberPhone &&
                    deliveryRecord.shouldSendSms({
                      statusPage: statuspage,
                      phone: subscriber.subscriberPhone,
                    })
                  ) {
                    const phoneStr: string =
                      subscriber.subscriberPhone.toString();
                    const phoneMasked: string = `${phoneStr.slice(0, 2)}******${phoneStr.slice(-2)}`;
                    logger.debug(
                      `Sending SMS notification to subscriber ${subscriber._id} at ${phoneMasked} for episode state timeline ${episodeStateTimeline.id}.`,
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
                      smsMessage = `Incident ${episode.title || ""} on ${statusPageName} is ${Text.uppercaseFirstLetter(episodeStateName)}. Details: ${episodeDetailsUrl}. Unsub: ${smsUnsubscribeUrl}`;
                    }

                    const sms: SMS = {
                      message: smsMessage,
                      to: subscriber.subscriberPhone,
                    };

                    // send sms here.
                    await deliveryRecord.deliver({
                      statusPage: statuspage,
                      method: StatusPageSubscriberNotificationMethod.SMS,
                      // Which number it was, so a failed send frees it for a later page.
                      to: sms.to,
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
                        });
                      },
                    });
                  }

                  let emailTitle: string = `Incident `;

                  if (resourcesAffectedPlainText) {
                    emailTitle += `on ${resourcesAffectedPlainText} `;
                  }

                  emailTitle += `is ${episodeStateName}`;

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
                      `Sending email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail} for episode state timeline ${episodeStateTimeline.id}.`,
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
                        : `[Incident ${Text.uppercaseFirstLetter(episodeStateName)}] ${episode.title || ""}`;

                      await deliveryRecord.deliver({
                        statusPage: statuspage,
                        method: StatusPageSubscriberNotificationMethod.Email,
                        // Which address it was, so a failed send frees it for a later page.
                        to: subscriberEmail,
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
                              mailServer:
                                ProjectSMTPConfigService.toEmailServer(
                                  statuspage.smtpConfig,
                                ),
                              projectId: statuspage.projectId,
                              statusPageId: statuspage.id!,
                            },
                          );
                        },
                      });
                    } else {
                      const subject: string = `[${Text.uppercaseFirstLetter(
                        episodeStateName,
                      )} Incident] ${episode.title || ""}`;

                      // Use default hard-coded template
                      await deliveryRecord.deliver({
                        statusPage: statuspage,
                        method: StatusPageSubscriberNotificationMethod.Email,
                        // Which address it was, so a failed send frees it for a later page.
                        to: subscriberEmail,
                        subject: subject,
                        logAttributes: logAttributes,
                        send: () => {
                          return MailService.sendMail(
                            {
                              toEmail: subscriberEmail,
                              templateType:
                                EmailTemplateType.SubscriberEpisodeStateChanged,
                              vars: {
                                emailTitle: emailTitle,
                                statusPageName: statusPageName,
                                statusPageUrl: statusPageURL,
                                detailsUrl: episodeDetailsUrl,
                                logoUrl: StatusPageEmailLogo.getLogoUrl({
                                  statusPage: statuspage,
                                  host: host,
                                  httpProtocol: httpProtocol,
                                }),
                                isPublicStatusPage:
                                  statuspage.isPublicStatusPage
                                    ? "true"
                                    : "false",
                                resourcesAffected:
                                  resourcesAffectedHtml || "None",
                                episodeSeverity:
                                  episode.incidentSeverity?.name || " - ",
                                ...EmailColorUtil.getTemplateVariables(
                                  "episodeSeverity",
                                  episode.incidentSeverity?.color,
                                ),
                                episodeTitle: episode.title || "",
                                episodeState: episodeStateName,
                                ...EmailColorUtil.getTemplateVariables(
                                  "episodeState",
                                  episodeStateTimeline.incidentState?.color,
                                ),
                                unsubscribeUrl: unsubscribeUrl,
                                subscriberEmailNotificationFooterText:
                                  StatusPageServiceType.getSubscriberEmailFooterText(
                                    statuspage,
                                  ),
                              },
                              subject: subject,
                              isSubjectLiteral: true,
                            },
                            {
                              mailServer:
                                ProjectSMTPConfigService.toEmailServer(
                                  statuspage.smtpConfig,
                                ),
                              projectId: statuspage.projectId,
                              statusPageId: statuspage.id!,
                            },
                          );
                        },
                      });
                    }
                  }

                  if (subscriber.slackIncomingWebhookUrl) {
                    const slackIncomingWebhookUrl: URL =
                      subscriber.slackIncomingWebhookUrl;
                    let slackTitle: string;
                    if (slackTemplate?.templateBody) {
                      // Use custom template
                      slackTitle =
                        StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                          slackTemplate.templateBody,
                          subscriberMarkdownTemplateVariables,
                        );
                    } else {
                      // Use default hard-coded template
                      slackTitle = `🚨 ## Incident - ${escapeMarkdownValue(episode.title || " - ")}

`;

                      if (resourcesAffectedPlainText) {
                        slackTitle += `
**Resources Affected:** ${escapeMarkdownValue(resourcesAffectedPlainText, { keepLineBreaks: true })}`;
                      }

                      slackTitle += `
**Severity:** ${escapeMarkdownValue(episode.incidentSeverity?.name || " - ")}
**Status:** ${escapeMarkdownValue(episodeStateName)}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                    }

                    await deliveryRecord.deliver({
                      statusPage: statuspage,
                      method: StatusPageSubscriberNotificationMethod.Slack,
                      logAttributes: logAttributes,
                      send: () => {
                        return SlackUtil.sendMessageToChannelViaIncomingWebhook(
                          {
                            url: slackIncomingWebhookUrl,
                            text: SlackUtil.convertMarkdownToSlackRichText(
                              slackTitle,
                            ),
                          },
                        );
                      },
                    });
                    logger.debug(
                      `Slack notification sent to subscriber ${subscriber._id} for episode state timeline ${episodeStateTimeline.id}.`,
                      {
                        projectId: episode.projectId?.toString(),
                        incidentEpisodeId: episode.id?.toString(),
                      },
                    );
                  }

                  if (subscriber.microsoftTeamsIncomingWebhookUrl) {
                    const microsoftTeamsIncomingWebhookUrl: URL =
                      subscriber.microsoftTeamsIncomingWebhookUrl;
                    let teamsTitle: string;
                    if (teamsTemplate?.templateBody) {
                      // Use custom template
                      teamsTitle =
                        StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                          teamsTemplate.templateBody,
                          subscriberMarkdownTemplateVariables,
                        );
                    } else {
                      // Use default hard-coded template
                      teamsTitle = `🚨 ## Incident - ${escapeMarkdownValue(episode.title || " - ")}

`;

                      if (resourcesAffectedPlainText) {
                        teamsTitle += `
**Resources Affected:** ${escapeMarkdownValue(resourcesAffectedPlainText, { keepLineBreaks: true })}`;
                      }

                      teamsTitle += `
**Severity:** ${escapeMarkdownValue(episode.incidentSeverity?.name || " - ")}
**Status:** ${escapeMarkdownValue(episodeStateName)}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                    }

                    await deliveryRecord.deliver({
                      statusPage: statuspage,
                      method:
                        StatusPageSubscriberNotificationMethod.MicrosoftTeams,
                      logAttributes: logAttributes,
                      send: () => {
                        return MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook(
                          {
                            url: microsoftTeamsIncomingWebhookUrl,
                            text: teamsTitle,
                          },
                        );
                      },
                    });
                    logger.debug(
                      `Microsoft Teams notification sent to subscriber ${subscriber._id} for episode state timeline ${episodeStateTimeline.id}.`,
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
                        return StatusPageSubscriberWebhookUtil.sendWebhookNotification(
                          {
                            webhookUrl: subscriberWebhook,
                            payload: {
                              eventType: "EpisodeStateChanged",
                              statusPageId: statuspage.id!.toString(),
                              statusPageName: statusPageName,
                              statusPageUrl: statusPageURL,
                              unsubscribeUrl: unsubscribeUrl,
                              data: {
                                episodeId: episode.id?.toString() || "",
                                episodeTitle: episode.title || "",
                                incidentSeverity:
                                  episode.incidentSeverity?.name || "",
                                incidentState: episodeStateName || "",
                                resourcesAffected:
                                  resourcesAffectedPlainText || "",
                                detailsUrl: episodeDetailsUrl,
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

          const episodeNumber: string =
            episode.episodeNumber?.toString() || " - ";
          const projectId: ObjectID = episode.projectId!;
          const episodeId: ObjectID = episode.id!;

          /*
           * Fell short when a message failed, or the send stopped before it
           * reached every subscriber: the notification settles as Failed.
           */
          const sendFellShort: boolean = deliveryRecord.hasFailures();

          if (sendFellShort) {
            logger.debug(
              "Not every subscriber was sent the episode state change notification",
              logAttributes,
            );

            await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
              incidentEpisodeId: episode.id!,
              projectId: episode.projectId!,
              incidentEpisodeFeedEventType:
                IncidentEpisodeFeedEventType.SubscriberNotificationSent,
              displayColor: Red500,
              feedInfoInMarkdown: `📧 **Not every Status Page Subscriber was notified** about the state change of the [Episode ${episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(projectId, episodeId)).toString()}) to **${escapeMarkdownValue(episodeStateName)}**`,
              // Each status page with what was sent and what failed, and its subject.
              moreInformationInMarkdown: deliveryMarkdown || undefined,
            });
          } else if (deliveryRecord.hasMatchedAnySubscriber()) {
            logger.debug(
              "Notification sent to subscribers for episode state change",
              logAttributes,
            );

            await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
              incidentEpisodeId: episode.id!,
              projectId: episode.projectId!,
              incidentEpisodeFeedEventType:
                IncidentEpisodeFeedEventType.SubscriberNotificationSent,
              displayColor: Blue500,
              feedInfoInMarkdown: `📧 **Status Page Subscribers have been notified** about the state change of the [Episode ${episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(projectId, episodeId)).toString()}) to **${escapeMarkdownValue(episodeStateName)}**`,
              // Each status page, the subject its email went out with, and what was sent.
              moreInformationInMarkdown: deliveryMarkdown || undefined,
            });

            logger.debug("Episode Feed created", logAttributes);
          } else {
            logger.debug(
              `No subscribers were notified for episode state change. All status pages either hide episodes or had no matching subscribers.`,
              logAttributes,
            );

            await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
              incidentEpisodeId: episode.id!,
              projectId: episode.projectId!,
              incidentEpisodeFeedEventType:
                IncidentEpisodeFeedEventType.SubscriberNotificationSent,
              displayColor: Yellow500,
              feedInfoInMarkdown: `📧 **No notification sent to subscribers** for the state change of [Episode ${episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(projectId, episodeId)).toString()}) to **${escapeMarkdownValue(episodeStateName)}**`,
              moreInformationInMarkdown: [
                "Subscriber notifications were skipped because every associated status page either hides episodes, is left out by the status page scope of the episode's incidents, or had no matching subscribers.",
                deliveryMarkdown,
              ]
                .filter(Boolean)
                .join("\n\n"),
            });
          }

          // Settle: Success, or Failed with what was sent and failed per page.
          await IncidentEpisodeStateTimelineService.updateOneById({
            id: episodeStateTimeline.id!,
            data: {
              subscriberNotificationStatus: sendFellShort
                ? StatusPageSubscriberNotificationStatus.Failed
                : StatusPageSubscriberNotificationStatus.Success,
              subscriberNotificationStatusMessage:
                deliveryRecord.toStatusMessage({
                  sentMessage:
                    "Notifications sent successfully to all subscribers.",
                  retryScope: SubscriberNotificationRetryScope.EveryPage,
                }),
            },
            props: { isRoot: true, ignoreHooks: true },
          });
        } catch (err) {
          /*
           * Settle the row. It is InProgress by now and the cron only picks up
           * Pending rows, so an error here used to leave it "being sent"
           * forever - and, uncaught, it also ended this run before the
           * remaining episode state timelines were looked at.
           */
          logger.error(
            `Error sending subscriber notifications for episode state timeline ${episodeStateTimeline.id}: ${err}`,
          );

          // Only a notification this run claimed is its to fail.
          if (!claimed) {
            continue;
          }

          await IncidentEpisodeStateTimelineService.updateOneById({
            id: episodeStateTimeline.id!,
            data: {
              subscriberNotificationStatus:
                StatusPageSubscriberNotificationStatus.Failed,
              subscriberNotificationStatusMessage:
                err instanceof Error ? err.message : String(err),
            },
            props: { isRoot: true, ignoreHooks: true },
          }).catch((updateError: unknown) => {
            logger.error(
              `Failed to mark episode state timeline ${episodeStateTimeline.id} as Failed: ${updateError}`,
            );
          });
        } finally {
          await projectSlot.release();
        }
      }
    },
  ),
);
