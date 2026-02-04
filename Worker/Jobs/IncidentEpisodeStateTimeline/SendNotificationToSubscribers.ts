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
import Text from "Common/Types/Text";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeStateTimelineService from "Common/Server/Services/IncidentEpisodeStateTimelineService";
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSMTPConfigService from "Common/Server/Services/ProjectSmtpConfigService";
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
import logger from "Common/Server/Utils/Logger";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import { Blue500 } from "Common/Types/BrandColors";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageResourceUtil from "Common/Server/Utils/StatusPageResource";

RunCron(
  "IncidentEpisodeStateTimeline:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
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
      logger.debug(
        `Processing episode state timeline ${episodeStateTimeline.id}.`,
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
          `Episode ${episode.id} has no monitors; marking timeline ${episodeStateTimeline.id} as Skipped.`,
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

      // Get status page resources from monitors
      const statusPageResources: Array<StatusPageResource> =
        await StatusPageResourceService.findBy({
          query: {
            monitorId: QueryHelper.any(
              Array.from(monitorIds).map((id: string) => {
                return new ObjectID(id);
              }),
            ),
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
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
      );

      const statusPageToResources: Dictionary<Array<StatusPageResource>> = {};

      for (const resource of statusPageResources) {
        if (!resource.statusPageId) {
          continue;
        }

        if (!statusPageToResources[resource.statusPageId?.toString()]) {
          statusPageToResources[resource.statusPageId?.toString()] = [];
        }

        statusPageToResources[resource.statusPageId?.toString()]?.push(
          resource,
        );
      }

      logger.debug(
        `Episode ${episode.id} maps to ${Object.keys(statusPageToResources).length} status page(s) for state timeline notification.`,
      );

      const statusPages: Array<StatusPage> =
        await StatusPageSubscriberService.getStatusPagesToSendNotification(
          Object.keys(statusPageToResources).map((i: string) => {
            return new ObjectID(i);
          }),
        );

      for (const statuspage of statusPages) {
        if (!statuspage.id) {
          logger.debug("Encountered a status page without an id; skipping.");
          continue;
        }

        if (!statuspage.showEpisodesOnStatusPage) {
          logger.debug(
            `Status page ${statuspage.id} hides episodes; skipping.`,
          );
          continue;
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
          `Status page ${statuspage.id} (${statusPageName}) has ${subscribers.length} subscriber(s) for episode state timeline ${episodeStateTimeline.id}.`,
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
              notificationMethod: StatusPageSubscriberNotificationMethod.Email,
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
              notificationMethod: StatusPageSubscriberNotificationMethod.Slack,
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
              eventType: StatusPageEventType.Incident, // Episodes use incident event type
            });

          if (!shouldNotifySubscriber) {
            logger.debug(
              `Skipping subscriber ${subscriber._id} based on preferences for state timeline ${episodeStateTimeline.id}.`,
            );
            continue;
          }

          const unsubscribeUrl: string =
            StatusPageSubscriberService.getUnsubscribeLink(
              URL.fromString(statusPageURL),
              subscriber.id!,
            ).toString();

          const resourcesAffected: string =
            StatusPageResourceUtil.getResourcesGroupedByGroupName(
              statusPageToResources[statuspage._id!] || [],
              "", // Use empty string as default for backward compatibility
            );

          // Prepare template variables for custom templates
          const templateVariables: Record<string, string> = {
            statusPageName: statusPageName,
            statusPageUrl: statusPageURL,
            detailsUrl: episodeDetailsUrl,
            resourcesAffected: resourcesAffected || "None",
            episodeSeverity: episode.incidentSeverity?.name || " - ",
            episodeTitle: episode.title || "",
            episodeState: episodeStateTimeline.incidentState.name,
            unsubscribeUrl: unsubscribeUrl,
          };

          if (subscriber.subscriberPhone) {
            const phoneStr: string = subscriber.subscriberPhone.toString();
            const phoneMasked: string = `${phoneStr.slice(0, 2)}******${phoneStr.slice(-2)}`;
            logger.debug(
              `Queueing SMS notification to subscriber ${subscriber._id} at ${phoneMasked} for episode state timeline ${episodeStateTimeline.id}.`,
            );

            let smsMessage: string;
            if (smsTemplate?.templateBody && statuspage.callSmsConfig) {
              // Use custom template only when custom Twilio is configured
              smsMessage =
                StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                  smsTemplate.templateBody,
                  templateVariables,
                );
            } else {
              // Use default hard-coded template
              smsMessage = `Episode ${episode.title || ""} on ${statusPageName} is ${Text.uppercaseFirstLetter(episodeStateTimeline.incidentState.name)}. Details: ${episodeDetailsUrl}. Unsub: ${unsubscribeUrl}`;
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
              logger.error(err);
            });
          }

          let emailTitle: string = `Episode `;

          if (resourcesAffected) {
            emailTitle += `on ${resourcesAffected} `;
          }

          emailTitle += `is ${episodeStateTimeline.incidentState.name}`;

          if (subscriber.subscriberEmail) {
            // send email here.
            logger.debug(
              `Queueing email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail} for episode state timeline ${episodeStateTimeline.id}.`,
            );

            if (emailTemplate?.templateBody && statuspage.smtpConfig) {
              // Use custom template with BlankTemplate only when custom SMTP is configured
              const compiledBody: string =
                StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                  emailTemplate.templateBody,
                  templateVariables,
                );
              const compiledSubject: string = emailTemplate.emailSubject
                ? StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    emailTemplate.emailSubject,
                    templateVariables,
                  )
                : `[Episode ${Text.uppercaseFirstLetter(episodeStateTimeline.incidentState.name)}] ${episode.title}`;

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
                  mailServer: ProjectSMTPConfigService.toEmailServer(
                    statuspage.smtpConfig,
                  ),
                  projectId: statuspage.projectId,
                  statusPageId: statuspage.id!,
                },
              ).catch((err: Error) => {
                logger.error(err);
              });
            } else {
              // Use default hard-coded template
              MailService.sendMail(
                {
                  toEmail: subscriber.subscriberEmail,
                  templateType: EmailTemplateType.SubscriberEpisodeStateChanged,
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
                    resourcesAffected: resourcesAffected || "None",
                    episodeSeverity: episode.incidentSeverity?.name || " - ",
                    episodeTitle: episode.title || "",
                    episodeState: episodeStateTimeline.incidentState.name,
                    unsubscribeUrl: unsubscribeUrl,
                    subscriberEmailNotificationFooterText:
                      StatusPageServiceType.getSubscriberEmailFooterText(
                        statuspage,
                      ),
                  },
                  subject: `[Episode ${Text.uppercaseFirstLetter(
                    episodeStateTimeline.incidentState.name,
                  )}] ${episode.title}`,
                },
                {
                  mailServer: ProjectSMTPConfigService.toEmailServer(
                    statuspage.smtpConfig,
                  ),
                  projectId: statuspage.projectId,
                  statusPageId: statuspage.id!,
                },
              ).catch((err: Error) => {
                logger.error(err);
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
                  templateVariables,
                );
            } else {
              // Use default hard-coded template
              slackTitle = `🚨 ## Episode - ${episode.title || " - "}

`;

              if (resourcesAffected) {
                slackTitle += `
**Resources Affected:** ${resourcesAffected}`;
              }

              slackTitle += `
**Severity:** ${episode.incidentSeverity?.name || " - "}
**Status:** ${episodeStateTimeline.incidentState.name}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
            }

            SlackUtil.sendMessageToChannelViaIncomingWebhook({
              url: subscriber.slackIncomingWebhookUrl,
              text: SlackUtil.convertMarkdownToSlackRichText(slackTitle),
            }).catch((err: Error) => {
              logger.error(err);
            });
            logger.debug(
              `Slack notification queued for subscriber ${subscriber._id} for episode state timeline ${episodeStateTimeline.id}.`,
            );
          }

          if (subscriber.microsoftTeamsIncomingWebhookUrl) {
            let teamsTitle: string;
            if (teamsTemplate?.templateBody) {
              // Use custom template
              teamsTitle =
                StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                  teamsTemplate.templateBody,
                  templateVariables,
                );
            } else {
              // Use default hard-coded template
              teamsTitle = `🚨 ## Episode - ${episode.title || " - "}

`;

              if (resourcesAffected) {
                teamsTitle += `
**Resources Affected:** ${resourcesAffected}`;
              }

              teamsTitle += `
**Severity:** ${episode.incidentSeverity?.name || " - "}
**Status:** ${episodeStateTimeline.incidentState.name}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
            }

            MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
              url: subscriber.microsoftTeamsIncomingWebhookUrl,
              text: teamsTitle,
            }).catch((err: Error) => {
              logger.error(err);
            });
            logger.debug(
              `Microsoft Teams notification queued for subscriber ${subscriber._id} for episode state timeline ${episodeStateTimeline.id}.`,
            );
          }
        }
      }

      logger.debug("Notification sent to subscribers for episode state change");

      const episodeNumber: string = episode.episodeNumber?.toString() || " - ";
      const projectId: ObjectID = episode.projectId!;
      const episodeId: ObjectID = episode.id!;

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: episode.id!,
        projectId: episode.projectId!,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.SubscriberNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: `📧 **Status Page Subscribers have been notified** about the state change of the [Episode ${episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(projectId, episodeId)).toString()}) to **${episodeStateTimeline.incidentState.name}**`,
      });

      logger.debug("Episode Feed created");

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
    }
  },
);
