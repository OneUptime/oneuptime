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
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
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
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import Monitor from "Common/Models/DatabaseModels/Monitor";
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
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Incident from "Common/Models/DatabaseModels/Incident";

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
        );
        const episodeId: ObjectID = episode.id!;
        const projectId: ObjectID = episode.projectId!;
        const episodeNumber: string =
          episode.episodeNumber?.toString() || " - ";
        const episodeFeedText: string = `📧 **Subscriber Episode Created Notification Sent for [Episode ${episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(projectId, episodeId)).toString()})**:
      Notification sent to status page subscribers because this episode was created.`;

        // Get monitors from member incidents
        const episodeMembers: Array<IncidentEpisodeMember> =
          await IncidentEpisodeMemberService.findBy({
            query: {
              incidentEpisodeId: episodeId,
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
            `Episode ${episode.id} has no monitors attached via member incidents; marking subscriber notifications as Skipped.`,
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
        );

        if (!episode.isVisibleOnStatusPage) {
          logger.debug(
            `Episode ${episode.id} is not visible on status page; skipping subscriber notifications.`,
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

        // Get status page resources from monitors
        const statusPageResources: Array<StatusPageResource> =
          await StatusPageResourceService.findAllBy({
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
          `Found ${statusPageResources.length} status page resources linked to episode ${episode.id}.`,
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
          `Episode ${episode.id} maps to ${Object.keys(statusPageToResources).length} status page(s) for notifications.`,
        );

        const statusPages: Array<StatusPage> =
          await StatusPageSubscriberService.getStatusPagesToSendNotification(
            Object.keys(statusPageToResources).map((i: string) => {
              return new ObjectID(i);
            }),
          );

        logger.debug(
          `Loaded ${statusPages.length} status page(s) for episode ${episode.id}.`,
        );

        for (const statuspage of statusPages) {
          try {
            if (!statuspage.id) {
              logger.debug(
                "Encountered a status page without an id; skipping.",
              );
              continue;
            }

            if (!statuspage.showEpisodesOnStatusPage) {
              logger.debug(
                `Status page ${statuspage.id} is configured to hide episodes; skipping notifications.`,
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

            const statusPageURL: string =
              await StatusPageService.getStatusPageURL(statuspage.id);
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
              `Status page ${statuspage.id} (${statusPageName}) has ${subscribers.length} subscriber(s).`,
            );

            // Send email to Email subscribers.
            const resourcesAffectedString: string =
              StatusPageResourceUtil.getResourcesGroupedByGroupName(
                statusPageToResources[statuspage._id!] || [],
              );

            logger.debug(
              `Resources affected for episode ${episode.id} on status page ${statuspage.id}: ${resourcesAffectedString}`,
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
                  notificationMethod: StatusPageSubscriberNotificationMethod.SMS,
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

            // Prepare template variables for custom templates
            const templateVariables: Record<string, string> = {
              statusPageName: statusPageName,
              statusPageUrl: statusPageURL,
              detailsUrl: episodeDetailsUrl,
              resourcesAffected: resourcesAffectedString,
              episodeSeverity: episode.incidentSeverity?.name || " - ",
              episodeTitle: episode.title || "",
              episodeDescription: episode.description || "",
            };

            // Prepare SMS-specific template variables with plain text (no HTML/Markdown)
            const smsTemplateVariables: Record<string, string> = {
              ...templateVariables,
              episodeDescription: Markdown.convertToPlainText(
                episode.description || "",
              ),
            };

            for (const subscriber of subscribers) {
              try {
                if (!subscriber._id) {
                  logger.debug(
                    "Encountered a subscriber without an _id; skipping.",
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
                  );
                  continue;
                }

                const unsubscribeUrl: string =
                  StatusPageSubscriberService.getUnsubscribeLink(
                    URL.fromString(statusPageURL),
                    subscriber.id!,
                  ).toString();

                logger.debug(
                  `Prepared unsubscribe link for subscriber ${subscriber._id}.`,
                );

                // Add unsubscribeUrl to template variables
                const subscriberTemplateVariables: Record<string, string> = {
                  ...templateVariables,
                  unsubscribeUrl: unsubscribeUrl,
                };

                if (subscriber.subscriberEmail) {
                  // send email here.
                  logger.debug(
                    `Queueing email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail}.`,
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
                      : "[Incident Episode] " + episode.title || "";

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
                          episodeDescription: await Markdown.convertToHTML(
                            episode.description || "",
                            MarkdownContentType.Email,
                          ),
                          unsubscribeUrl: unsubscribeUrl,

                          subscriberEmailNotificationFooterText:
                            StatusPageServiceType.getSubscriberEmailFooterText(
                              statuspage,
                            ),
                        },
                        subject: "[Incident Episode] " + episode.title || "",
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
                  logger.debug(
                    `Email notification queued for subscriber ${subscriber._id}.`,
                  );
                }

                if (subscriber.subscriberPhone) {
                  const phoneStr: string =
                    subscriber.subscriberPhone.toString();
                  const phoneMasked: string = `${phoneStr.slice(0, 2)}******${phoneStr.slice(-2)}`;
                  logger.debug(
                    `Queueing SMS notification to subscriber ${subscriber._id} at ${phoneMasked}.`,
                  );

                  // SMS-specific template variables with unsubscribe URL
                  const subscriberSmsTemplateVariables: Record<string, string> =
                    {
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
                    smsMessage = `Incident Episode ${episode.title || ""} (${episode.incidentSeverity?.name || "-"}) on ${statusPageName}. Impact: ${resourcesAffectedString}. Details: ${episodeDetailsUrl}. Unsub: ${unsubscribeUrl}`;
                  }

                  const sms: SMS = {
                    message: smsMessage,
                    to: subscriber.subscriberPhone,
                  };

                  // send sms here.
                  SmsService.sendSms(sms, {
                    projectId: statuspage.projectId,
                    customTwilioConfig:
                      ProjectCallSMSConfigService.toTwilioConfig(
                        statuspage.callSmsConfig,
                      ),
                    statusPageId: statuspage.id!,
                  }).catch((err: Error) => {
                    logger.error(err);
                  });
                  logger.debug(
                    `SMS notification queued for subscriber ${subscriber._id}.`,
                  );
                }

                if (subscriber.slackIncomingWebhookUrl) {
                  logger.debug(
                    `Queueing Slack notification to subscriber ${subscriber._id} via incoming webhook.`,
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
                    markdownMessage = `## 🚨 Incident Episode - ${episode.title || ""}

**Severity:** ${episode.incidentSeverity?.name || " - "}

**Resources Affected:** ${resourcesAffectedString}

**Description:** ${episode.description || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                  }

                  // send Slack notification with markdown conversion
                  SlackUtil.sendMessageToChannelViaIncomingWebhook({
                    url: subscriber.slackIncomingWebhookUrl,
                    text: SlackUtil.convertMarkdownToSlackRichText(
                      markdownMessage,
                    ),
                  }).catch((err: Error) => {
                    logger.error(err);
                  });
                  logger.debug(
                    `Slack notification queued for subscriber ${subscriber._id}.`,
                  );
                }

                if (subscriber.microsoftTeamsIncomingWebhookUrl) {
                  logger.debug(
                    `Queueing Microsoft Teams notification to subscriber ${subscriber._id} via incoming webhook.`,
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
                    markdownMessage = `## 🚨 Incident Episode - ${episode.title || ""}
**Severity:** ${episode.incidentSeverity?.name || " - "}
**Resources Affected:** ${resourcesAffectedString}
**Description:** ${episode.description || ""}
[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                  }

                  // send Teams notification
                  MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
                    url: subscriber.microsoftTeamsIncomingWebhookUrl,
                    text: markdownMessage,
                  }).catch((err: Error) => {
                    logger.error(err);
                  });
                  logger.debug(
                    `Microsoft Teams notification queued for subscriber ${subscriber._id}.`,
                  );
                }
              } catch (err) {
                logger.error(err);
              }
            }
          } catch (err) {
            logger.error(err);
          }
        }

        logger.debug("Creating episode feed for subscriber notification");

        await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
          incidentEpisodeId: episode.id!,
          projectId: episode.projectId!,
          incidentEpisodeFeedEventType:
            IncidentEpisodeFeedEventType.SubscriberNotificationSent,
          displayColor: Blue500,
          feedInfoInMarkdown: episodeFeedText,
        });

        logger.debug("Episode Feed created");

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
        );
      } catch (err) {
        // If there was an error, mark as failed
        logger.error(err);
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
          );
        });
      }
    }
  },
);
