import RunCron from "../../Utils/Cron";
import { StatusPageApiRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import SMS from "Common/Types/SMS/SMS";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSMTPConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import SmsService from "Common/Server/Services/SmsService";
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
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import Incident from "Common/Models/DatabaseModels/Incident";
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
  "IncidentEpisode:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // First, mark episodes as Skipped if they should not be notified
    const episodesToSkip: Array<IncidentEpisode> =
      await IncidentEpisodeService.findAllBy({
        query: {
          subscriberNotificationStatusOnEpisodeCreated:
            StatusPageSubscriberNotificationStatus.Pending,
          shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: false,
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
      `Found ${episodesToSkip.length} episodes to mark as Skipped (subscribers should not be notified).`,
    );

    for (const episode of episodesToSkip) {
      logger.debug(
        `Marking episode ${episode.id} as Skipped for subscriber notifications.`,
      );
      await IncidentEpisodeService.updateOneById({
        id: episode.id!,
        data: {
          subscriberNotificationStatusOnEpisodeCreated:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessage:
            "Notifications skipped as subscribers are not to be notified for this episode.",
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
      logger.debug(
        `Episode ${episode.id} marked as Skipped for subscriber notifications.`,
      );
    }

    // Get all episodes that need notification
    const episodes: Array<IncidentEpisode> =
      await IncidentEpisodeService.findAllBy({
        query: {
          subscriberNotificationStatusOnEpisodeCreated:
            StatusPageSubscriberNotificationStatus.Pending,
          shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: true,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          title: true,
          description: true,
          projectId: true,
          isVisibleOnStatusPage: true,
          incidentSeverity: {
            name: true,
          },
          episodeNumber: true,
        },
      });

    logger.debug(
      `Found ${episodes.length} episodes to notify subscribers for.`,
    );

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
    logger.debug(
      `Database host resolved as ${host.toString()} with protocol ${httpProtocol.toString()}.`,
    );

    for (const episode of episodes) {
      try {
        logger.debug(
          `Processing episode ${episode.id} (project: ${episode.projectId}) for subscriber notifications.`,
          {
            projectId: episode.projectId?.toString(),
            incidentEpisodeId: episode.id?.toString(),
          },
        );
        const episodeId: ObjectID = episode.id!;
        const projectId: ObjectID = episode.projectId!;
        const episodeNumber: string =
          episode.episodeNumber?.toString() || " - ";
        const episodeFeedText: string = `📧 **Subscriber Episode Created Notification Sent for [Episode ${episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(projectId, episodeId)).toString()})**:
      Notification sent to status page subscribers because this episode was created.`;

        /*
         * The episode's incidents, with their monitors. The episode reaches
         * the union of the status pages its incidents reach, each through its
         * own status page scope.
         */
        const memberIncidents: Array<Incident> =
          await IncidentStatusPageScope.getEpisodeMemberIncidents(episodeId);

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
            `Episode ${episode.id} has no monitors attached via member incidents; marking subscriber notifications as Skipped.`,
            {
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
            },
          );

          await IncidentEpisodeService.updateOneById({
            id: episode.id!,
            data: {
              subscriberNotificationStatusOnEpisodeCreated:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "No monitors are attached to the incidents in this episode. Skipping notifications to subscribers.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });

          continue;
        }

        await IncidentEpisodeService.updateOneById({
          id: episode.id!,
          data: {
            subscriberNotificationStatusOnEpisodeCreated:
              StatusPageSubscriberNotificationStatus.InProgress,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
        logger.debug(
          `Episode ${episode.id} status set to InProgress for subscriber notifications.`,
          {
            projectId: episode.projectId?.toString(),
            incidentEpisodeId: episode.id?.toString(),
          },
        );

        if (!episode.isVisibleOnStatusPage) {
          logger.debug(
            `Episode ${episode.id} is not visible on status page; skipping subscriber notifications.`,
            {
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
            },
          );
          await IncidentEpisodeService.updateOneById({
            id: episode.id!,
            data: {
              subscriberNotificationStatusOnEpisodeCreated:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "Episode is not visible on status page. Skipping notifications.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
          continue;
        }

        /*
         * The status pages the episode's incidents reach - through their
         * monitors and the monitor groups they are in, each narrowed to the
         * pages it is limited to - in name order. (This job used to look
         * monitors up directly and so missed pages that list a monitor
         * group.)
         */
        const resolvedStatusPages: ResolvedIncidentStatusPages =
          await IncidentStatusPageScope.resolvePagesForIncidents({
            incidents: memberIncidents,
          });

        const statusPageToResources: Dictionary<Array<StatusPageResource>> =
          resolvedStatusPages.statusPageToResources;
        const statusPages: Array<StatusPage> = resolvedStatusPages.statusPages;

        logger.debug(
          `Episode ${episode.id} reaches ${statusPages.length} status page(s) for notifications; ${resolvedStatusPages.excludedStatusPages.length} left out by its incidents' status page scope.`,
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
         * Pre-compute markdown conversions for episode.description once per
         * episode. These values do not vary per status page or per subscriber,
         * so memoizing here avoids N redundant markdown parses during fan-out.
         */
        const episodeDescriptionHtml: string = await Markdown.convertToHTML(
          episode.description || "",
          MarkdownContentType.Email,
        );
        const episodeDescriptionPlainText: string = Markdown.convertToPlainText(
          episode.description || "",
        );

        let notificationSentToAtLeastOneSubscriber: boolean = false;

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
                `Status page ${statuspage.id} is configured to hide episodes; skipping notifications.`,
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
             * incident detail route (/incidents/:id), which looks the id up as
             * an incident first and then as an episode.
             */
            const episodeDetailsUrl: string =
              episode.id && statusPageURL
                ? URL.fromString(statusPageURL)
                    .addRoute(`/incidents/${episode.id.toString()}`)
                    .toString()
                : statusPageURL;

            logger.debug(
              `Status page ${statuspage.id} (${statusPageName}) has ${subscribers.length} subscriber(s).`,
              {
                projectId: episode.projectId?.toString(),
                incidentEpisodeId: episode.id?.toString(),
              },
            );

            /*
             * Send email to Email subscribers. The HTML list (escaped names,
             * "<br/>" between groups) is only for email bodies; SMS, Slack,
             * Teams, subjects and webhooks get the plain-text list.
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
              `Resources affected for episode ${episode.id} on status page ${statuspage.id}: ${resourcesAffectedPlainText}`,
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
                    StatusPageSubscriberNotificationEventType.SubscriberEpisodeCreated,
                  notificationMethod:
                    StatusPageSubscriberNotificationMethod.Email,
                },
              ),
              StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                {
                  statusPageId: statuspage.id!,
                  eventType:
                    StatusPageSubscriberNotificationEventType.SubscriberEpisodeCreated,
                  notificationMethod:
                    StatusPageSubscriberNotificationMethod.SMS,
                },
              ),
              StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                {
                  statusPageId: statuspage.id!,
                  eventType:
                    StatusPageSubscriberNotificationEventType.SubscriberEpisodeCreated,
                  notificationMethod:
                    StatusPageSubscriberNotificationMethod.Slack,
                },
              ),
              StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                {
                  statusPageId: statuspage.id!,
                  eventType:
                    StatusPageSubscriberNotificationEventType.SubscriberEpisodeCreated,
                  notificationMethod:
                    StatusPageSubscriberNotificationMethod.MicrosoftTeams,
                },
              ),
            ]);

            /*
             * Every variable SubscriberNotificationTemplateVariables advertises
             * for SubscriberEpisodeCreated, built once per status page. The
             * base object holds the values that read the same on every
             * channel; the three objects below add the format-dependent ones
             * (episodeDescription, resourcesAffected), and every channel adds
             * the subscriber's unsubscribeUrl, so no channel can miss a
             * variable the others have.
             *
             * Custom templates get each value in the format their channel
             * renders: HTML for the email body (it is wrapped only by
             * BlankTemplate), plain text for SMS and the email subject, and
             * Markdown for Slack and Teams. The conversions are the memoized
             * ones computed once per episode above.
             *
             * The base values are plain text on every channel: the email body
             * escapes them (compileEmailBodyTemplate), and only the values
             * wrapped in SafeHtml go into it as HTML.
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
                resourcesAffected: SafeHtml.fromTrustedHtml(
                  resourcesAffectedString,
                ),
                episodeDescription: SafeHtml.fromTrustedHtml(
                  episodeDescriptionHtml,
                ),
              };

            const plainTextTemplateVariables: Record<string, string> = {
              ...templateVariables,
              resourcesAffected: resourcesAffectedPlainText,
              episodeDescription: episodeDescriptionPlainText,
            };

            const markdownTemplateVariables: Record<string, string> = {
              ...templateVariables,
              resourcesAffected: resourcesAffectedPlainText,
              episodeDescription: episode.description || "",
            };

            for (const subscriber of subscribers) {
              try {
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
                    eventType: StatusPageEventType.Incident, // Episodes use incident event type for subscriber filtering
                  });

                if (!shouldNotifySubscriber) {
                  logger.debug(
                    `Skipping subscriber ${subscriber._id} based on preferences or filters.`,
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

                logger.debug(
                  `Prepared unsubscribe link for subscriber ${subscriber._id}.`,
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
                const subscriberPlainTextTemplateVariables: Dictionary<string> =
                  {
                    ...plainTextTemplateVariables,
                    unsubscribeUrl: unsubscribeUrl,
                  };
                const subscriberMarkdownTemplateVariables: Dictionary<string> =
                  {
                    ...markdownTemplateVariables,
                    unsubscribeUrl: unsubscribeUrl,
                  };

                /*
                 * An email address or phone number already sent this in this
                 * send, through an earlier page, is not sent it again (only
                 * when an incident of the episode is scoped; see
                 * SubscriberNotificationDeliveryRecord).
                 */
                if (
                  subscriber.subscriberEmail &&
                  deliveryRecord.shouldSendEmail({
                    statusPage: statuspage,
                    email: subscriber.subscriberEmail,
                  })
                ) {
                  // send email here.
                  logger.debug(
                    `Queueing email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail}.`,
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
                      : "[Incident] " + (episode.title || "");

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
                  } else {
                    deliveryRecord.recordQueued({
                      statusPage: statuspage,
                      method: StatusPageSubscriberNotificationMethod.Email,
                      subject: "[Incident] " + (episode.title || ""),
                    });

                    // Use default hard-coded template
                    MailService.sendMail(
                      {
                        toEmail: subscriber.subscriberEmail,
                        templateType:
                          EmailTemplateType.SubscriberEpisodeCreated,
                        vars: {
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
                          episodeDescription: episodeDescriptionHtml,
                          unsubscribeUrl: unsubscribeUrl,

                          subscriberEmailNotificationFooterText:
                            StatusPageServiceType.getSubscriberEmailFooterText(
                              statuspage,
                            ),
                        },
                        subject: "[Incident] " + (episode.title || ""),
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
                  logger.debug(
                    `Email notification queued for subscriber ${subscriber._id}.`,
                    {
                      projectId: episode.projectId?.toString(),
                      incidentEpisodeId: episode.id?.toString(),
                    },
                  );
                }

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
                    `Queueing SMS notification to subscriber ${subscriber._id} at ${phoneMasked}.`,
                    {
                      projectId: episode.projectId?.toString(),
                      incidentEpisodeId: episode.id?.toString(),
                    },
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
                    smsMessage = `Incident ${episode.title || ""} (${episode.incidentSeverity?.name || "-"}) on ${statusPageName}. Impact: ${resourcesAffectedPlainText}. Details: ${episodeDetailsUrl}. Unsub: ${unsubscribeUrl}`;
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
                    customTwilioConfig:
                      ProjectCallSMSConfigService.toTwilioConfig(
                        statuspage.callSmsConfig,
                      ),
                    statusPageId: statuspage.id!,
                  }).catch((err: Error) => {
                    logger.error(err, {
                      ...EXTERNAL_FAULT,
                      projectId: episode.projectId?.toString(),
                      incidentEpisodeId: episode.id?.toString(),
                    });
                  });
                  logger.debug(
                    `SMS notification queued for subscriber ${subscriber._id}.`,
                    {
                      projectId: episode.projectId?.toString(),
                      incidentEpisodeId: episode.id?.toString(),
                    },
                  );
                }

                if (subscriber.slackIncomingWebhookUrl) {
                  logger.debug(
                    `Queueing Slack notification to subscriber ${subscriber._id} via incoming webhook.`,
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
                    markdownMessage = `## 🚨 Incident - ${episode.title || ""}

**Severity:** ${episode.incidentSeverity?.name || " - "}

**Resources Affected:** ${resourcesAffectedPlainText}

**Description:** ${episode.description || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                  }

                  deliveryRecord.recordQueued({
                    statusPage: statuspage,
                    method: StatusPageSubscriberNotificationMethod.Slack,
                  });

                  // send Slack notification with markdown conversion
                  SlackUtil.sendMessageToChannelViaIncomingWebhook({
                    url: subscriber.slackIncomingWebhookUrl,
                    text: SlackUtil.convertMarkdownToSlackRichText(
                      markdownMessage,
                    ),
                  }).catch((err: Error) => {
                    logger.error(err, {
                      ...EXTERNAL_FAULT,
                      projectId: episode.projectId?.toString(),
                      incidentEpisodeId: episode.id?.toString(),
                    });
                  });
                  logger.debug(
                    `Slack notification queued for subscriber ${subscriber._id}.`,
                    {
                      projectId: episode.projectId?.toString(),
                      incidentEpisodeId: episode.id?.toString(),
                    },
                  );
                }

                if (subscriber.microsoftTeamsIncomingWebhookUrl) {
                  logger.debug(
                    `Queueing Microsoft Teams notification to subscriber ${subscriber._id} via incoming webhook.`,
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
                    markdownMessage = `## 🚨 Incident - ${episode.title || ""}
**Severity:** ${episode.incidentSeverity?.name || " - "}
**Resources Affected:** ${resourcesAffectedPlainText}
**Description:** ${episode.description || ""}
[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                  }

                  deliveryRecord.recordQueued({
                    statusPage: statuspage,
                    method:
                      StatusPageSubscriberNotificationMethod.MicrosoftTeams,
                  });

                  // send Teams notification
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
                    `Microsoft Teams notification queued for subscriber ${subscriber._id}.`,
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
                      eventType: "EpisodeCreated",
                      statusPageId: statuspage.id!.toString(),
                      statusPageName: statusPageName,
                      statusPageUrl: statusPageURL,
                      unsubscribeUrl: unsubscribeUrl,
                      data: {
                        episodeId: episode.id?.toString() || "",
                        episodeTitle: episode.title || "",
                        episodeDescription: episode.description || "",
                        incidentSeverity: episode.incidentSeverity?.name || "",
                        resourcesAffected: resourcesAffectedPlainText,
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
              } catch (err) {
                logger.error(err, {
                  projectId: episode.projectId?.toString(),
                  incidentEpisodeId: episode.id?.toString(),
                });
              }
            }
          } catch (err) {
            logger.error(err, {
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
            });
            deliveryRecord.skipStatusPage(
              statuspage,
              StatusPageDeliverySkipReason.Failed,
            );
          }
        }

        const deliveryMarkdown: string = deliveryRecord.toMarkdown();

        if (notificationSentToAtLeastOneSubscriber) {
          logger.debug("Creating episode feed for subscriber notification", {
            projectId: episode.projectId?.toString(),
            incidentEpisodeId: episode.id?.toString(),
          });

          await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
            incidentEpisodeId: episode.id!,
            projectId: episode.projectId!,
            incidentEpisodeFeedEventType:
              IncidentEpisodeFeedEventType.SubscriberNotificationSent,
            displayColor: Blue500,
            feedInfoInMarkdown: episodeFeedText,
            // Each status page, the subject its email went out with, and what was queued.
            moreInformationInMarkdown: deliveryMarkdown || undefined,
          });

          logger.debug("Episode Feed created", {
            projectId: episode.projectId?.toString(),
            incidentEpisodeId: episode.id?.toString(),
          });
        } else {
          logger.debug(
            `No subscribers were notified for episode created: ${episode.id}. All status pages either hide episodes or had no matching subscribers.`,
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
            feedInfoInMarkdown: `📧 **No notification sent to subscribers** for the creation of [Episode ${episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(projectId, episodeId)).toString()}).`,
            moreInformationInMarkdown: [
              "Subscriber notifications were skipped because every associated status page either hides episodes, is left out by the status page scope of the episode's incidents, or had no matching subscribers.",
              deliveryMarkdown,
            ]
              .filter(Boolean)
              .join("\n\n"),
          });
        }

        // If we get here, the notification was successful
        await IncidentEpisodeService.updateOneById({
          id: episode.id!,
          data: {
            subscriberNotificationStatusOnEpisodeCreated:
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
          `Episode ${episode.id} marked as Success for subscriber notifications.`,
          {
            projectId: episode.projectId?.toString(),
            incidentEpisodeId: episode.id?.toString(),
          },
        );
      } catch (err) {
        // If there was an error, mark as failed
        logger.error(err, {
          projectId: episode.projectId?.toString(),
          incidentEpisodeId: episode.id?.toString(),
        });
        IncidentEpisodeService.updateOneById({
          id: episode.id!,
          data: {
            subscriberNotificationStatusOnEpisodeCreated:
              StatusPageSubscriberNotificationStatus.Failed,
            subscriberNotificationStatusMessage:
              err instanceof Error ? err.message : String(err),
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        }).catch((error: Error) => {
          logger.error(
            `Failed to update episode ${episode.id} status after error: ${error.message}`,
            {
              projectId: episode.projectId?.toString(),
              incidentEpisodeId: episode.id?.toString(),
            },
          );
        });
      }
    }
  },
);
