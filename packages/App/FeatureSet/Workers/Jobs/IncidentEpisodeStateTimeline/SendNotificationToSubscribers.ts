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
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import { Blue500, Yellow500 } from "Common/Types/BrandColors";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import StatusPageResourceUtil from "Common/Server/Utils/StatusPageResource";
import IncidentStatusPageScope, {
  ResolvedIncidentStatusPages,
} from "Common/Server/Utils/StatusPage/IncidentStatusPageScope";
import SubscriberNotificationDeliveryRecord, {
  StatusPageDeliverySkipReason,
} from "Common/Server/Utils/StatusPage/SubscriberNotificationDeliveryRecord";

RunCron(
  "IncidentEpisodeStateTimeline:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
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
        select: {
          _id: true,
          projectId: true,
          incidentEpisodeId: true,
          incidentStateId: true,
          incidentState: {
            name: true,
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
      try {
        logger.debug(
          `Processing episode state timeline ${episodeStateTimeline.id}.`,
          {
            projectId: episodeStateTimeline.projectId?.toString(),
            incidentEpisodeId:
              episodeStateTimeline.incidentEpisodeId?.toString(),
          },
        );
        // Set to InProgress at the start of processing
        await IncidentEpisodeStateTimelineService.updateOneById({
          id: episodeStateTimeline.id!,
          data: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.InProgress,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });

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
              },
              isVisibleOnStatusPage: true,
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

        if (!episode.isVisibleOnStatusPage) {
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
        const statusPages: Array<StatusPage> = resolvedStatusPages.statusPages;

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

          deliveryRecord.startStatusPage(statuspage);

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

          logger.debug(
            `Status page ${statuspage.id} (${statusPageName}) has ${subscribers.length} subscriber(s) for episode state timeline ${episodeStateTimeline.id}.`,
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
                notificationMethod: StatusPageSubscriberNotificationMethod.SMS,
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
            episodeState: episodeStateTimeline.incidentState.name,
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

          // Send email to Email subscribers.

          for (const subscriber of subscribers) {
            if (!subscriber._id) {
              logger.debug(
                "Encountered a subscriber without an _id; skipping.",
                {
                  projectId: episode.projectId?.toString(),
                  incidentEpisodeId: episode.id?.toString(),
                },
              );
              continue;
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
              continue;
            }

            notificationSentToAtLeastOneSubscriber = true;

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
            const subscriberPlainTextTemplateVariables: Record<string, string> =
              {
                ...plainTextTemplateVariables,
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
              const phoneStr: string = subscriber.subscriberPhone.toString();
              const phoneMasked: string = `${phoneStr.slice(0, 2)}******${phoneStr.slice(-2)}`;
              logger.debug(
                `Queueing SMS notification to subscriber ${subscriber._id} at ${phoneMasked} for episode state timeline ${episodeStateTimeline.id}.`,
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
                smsMessage = `Incident ${episode.title || ""} on ${statusPageName} is ${Text.uppercaseFirstLetter(episodeStateTimeline.incidentState.name)}. Details: ${episodeDetailsUrl}. Unsub: ${smsUnsubscribeUrl}`;
              }

              const sms: SMS = {
                message: smsMessage,
                to: subscriber.subscriberPhone,
              };

              deliveryRecord.recordQueued({
                statusPage: statuspage,
                method: StatusPageSubscriberNotificationMethod.SMS,
              });

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

            let emailTitle: string = `Incident `;

            if (resourcesAffectedPlainText) {
              emailTitle += `on ${resourcesAffectedPlainText} `;
            }

            emailTitle += `is ${episodeStateTimeline.incidentState.name}`;

            if (
              subscriber.subscriberEmail &&
              deliveryRecord.shouldSendEmail({
                statusPage: statuspage,
                email: subscriber.subscriberEmail,
              })
            ) {
              // send email here.
              logger.debug(
                `Queueing email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail} for episode state timeline ${episodeStateTimeline.id}.`,
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
                  : `[Incident ${Text.uppercaseFirstLetter(episodeStateTimeline.incidentState.name)}] ${episode.title || ""}`;

                deliveryRecord.recordQueued({
                  statusPage: statuspage,
                  method: StatusPageSubscriberNotificationMethod.Email,
                  subject: compiledSubject,
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
                    mailServer: ProjectSMTPConfigService.toEmailServer(
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
                const subject: string = `[${Text.uppercaseFirstLetter(
                  episodeStateTimeline.incidentState.name,
                )} Incident] ${episode.title || ""}`;

                deliveryRecord.recordQueued({
                  statusPage: statuspage,
                  method: StatusPageSubscriberNotificationMethod.Email,
                  subject: subject,
                });

                // Use default hard-coded template
                MailService.sendMail(
                  {
                    toEmail: subscriber.subscriberEmail,
                    templateType:
                      EmailTemplateType.SubscriberEpisodeStateChanged,
                    vars: {
                      emailTitle: emailTitle,
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
                      resourcesAffected: resourcesAffectedHtml || "None",
                      episodeSeverity: episode.incidentSeverity?.name || " - ",
                      episodeTitle: episode.title || "",
                      episodeState: episodeStateTimeline.incidentState.name,
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
                    mailServer: ProjectSMTPConfigService.toEmailServer(
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
            }

            if (subscriber.slackIncomingWebhookUrl) {
              let slackTitle: string;
              if (slackTemplate?.templateBody) {
                // Use custom template
                slackTitle =
                  StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    slackTemplate.templateBody,
                    subscriberPlainTextTemplateVariables,
                  );
              } else {
                // Use default hard-coded template
                slackTitle = `🚨 ## Incident - ${episode.title || " - "}

`;

                if (resourcesAffectedPlainText) {
                  slackTitle += `
**Resources Affected:** ${resourcesAffectedPlainText}`;
                }

                slackTitle += `
**Severity:** ${episode.incidentSeverity?.name || " - "}
**Status:** ${episodeStateTimeline.incidentState.name}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
              }

              deliveryRecord.recordQueued({
                statusPage: statuspage,
                method: StatusPageSubscriberNotificationMethod.Slack,
              });

              SlackUtil.sendMessageToChannelViaIncomingWebhook({
                url: subscriber.slackIncomingWebhookUrl,
                text: SlackUtil.convertMarkdownToSlackRichText(slackTitle),
              }).catch((err: Error) => {
                logger.error(err, {
                  ...EXTERNAL_FAULT,
                  projectId: episode.projectId?.toString(),
                  incidentEpisodeId: episode.id?.toString(),
                });
              });
              logger.debug(
                `Slack notification queued for subscriber ${subscriber._id} for episode state timeline ${episodeStateTimeline.id}.`,
                {
                  projectId: episode.projectId?.toString(),
                  incidentEpisodeId: episode.id?.toString(),
                },
              );
            }

            if (subscriber.microsoftTeamsIncomingWebhookUrl) {
              let teamsTitle: string;
              if (teamsTemplate?.templateBody) {
                // Use custom template
                teamsTitle =
                  StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    teamsTemplate.templateBody,
                    subscriberPlainTextTemplateVariables,
                  );
              } else {
                // Use default hard-coded template
                teamsTitle = `🚨 ## Incident - ${episode.title || " - "}

`;

                if (resourcesAffectedPlainText) {
                  teamsTitle += `
**Resources Affected:** ${resourcesAffectedPlainText}`;
                }

                teamsTitle += `
**Severity:** ${episode.incidentSeverity?.name || " - "}
**Status:** ${episodeStateTimeline.incidentState.name}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
              }

              deliveryRecord.recordQueued({
                statusPage: statuspage,
                method: StatusPageSubscriberNotificationMethod.MicrosoftTeams,
              });

              MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
                url: subscriber.microsoftTeamsIncomingWebhookUrl,
                text: teamsTitle,
              }).catch((err: Error) => {
                logger.error(err, {
                  ...EXTERNAL_FAULT,
                  projectId: episode.projectId?.toString(),
                  incidentEpisodeId: episode.id?.toString(),
                });
              });
              logger.debug(
                `Microsoft Teams notification queued for subscriber ${subscriber._id} for episode state timeline ${episodeStateTimeline.id}.`,
                {
                  projectId: episode.projectId?.toString(),
                  incidentEpisodeId: episode.id?.toString(),
                },
              );
            }

            if (subscriber.subscriberWebhook) {
              deliveryRecord.recordQueued({
                statusPage: statuspage,
                method: StatusPageSubscriberNotificationMethod.Webhook,
              });

              StatusPageSubscriberWebhookUtil.sendWebhookNotification({
                webhookUrl: subscriber.subscriberWebhook,
                payload: {
                  eventType: "EpisodeStateChanged",
                  statusPageId: statuspage.id!.toString(),
                  statusPageName: statusPageName,
                  statusPageUrl: statusPageURL,
                  unsubscribeUrl: unsubscribeUrl,
                  data: {
                    episodeId: episode.id?.toString() || "",
                    episodeTitle: episode.title || "",
                    incidentSeverity: episode.incidentSeverity?.name || "",
                    incidentState:
                      episodeStateTimeline.incidentState?.name || "",
                    resourcesAffected: resourcesAffectedPlainText || "",
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

        const deliveryMarkdown: string = deliveryRecord.toMarkdown();

        if (notificationSentToAtLeastOneSubscriber) {
          logger.debug(
            "Notification sent to subscribers for episode state change",
            {
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
            },
          );

          const episodeNumber: string =
            episode.episodeNumber?.toString() || " - ";
          const projectId: ObjectID = episode.projectId!;
          const episodeId: ObjectID = episode.id!;

          await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
            incidentEpisodeId: episode.id!,
            projectId: episode.projectId!,
            incidentEpisodeFeedEventType:
              IncidentEpisodeFeedEventType.SubscriberNotificationSent,
            displayColor: Blue500,
            feedInfoInMarkdown: `📧 **Status Page Subscribers have been notified** about the state change of the [Episode ${episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(projectId, episodeId)).toString()}) to **${episodeStateTimeline.incidentState.name}**`,
            // Each status page, the subject its email went out with, and what was queued.
            moreInformationInMarkdown: deliveryMarkdown || undefined,
          });

          logger.debug("Episode Feed created", {
            projectId: episode.projectId?.toString(),
            incidentEpisodeId: episode.id?.toString(),
          });
        } else {
          logger.debug(
            `No subscribers were notified for episode state change. All status pages either hide episodes or had no matching subscribers.`,
            {
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
            },
          );

          const episodeNumber: string =
            episode.episodeNumber?.toString() || " - ";
          const projectId: ObjectID = episode.projectId!;
          const episodeId: ObjectID = episode.id!;

          await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
            incidentEpisodeId: episode.id!,
            projectId: episode.projectId!,
            incidentEpisodeFeedEventType:
              IncidentEpisodeFeedEventType.SubscriberNotificationSent,
            displayColor: Yellow500,
            feedInfoInMarkdown: `📧 **No notification sent to subscribers** for the state change of [Episode ${episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(projectId, episodeId)).toString()}) to **${episodeStateTimeline.incidentState.name}**`,
            moreInformationInMarkdown: [
              "Subscriber notifications were skipped because every associated status page either hides episodes, is left out by the status page scope of the episode's incidents, or had no matching subscribers.",
              deliveryMarkdown,
            ]
              .filter(Boolean)
              .join("\n\n"),
          });
        }

        // Mark Success at the end
        await IncidentEpisodeStateTimelineService.updateOneById({
          id: episodeStateTimeline.id!,
          data: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Success,
            subscriberNotificationStatusMessage:
              "Notifications sent successfully to all subscribers",
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
      }
    }
  },
);
