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
import IncidentService from "Common/Server/Services/IncidentService";
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSMTPConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import { Blue500 } from "Common/Types/BrandColors";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";

RunCron(
  "Incident:SendPostmortemNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.
    const incidents: Array<Incident> = await IncidentService.findAllBy({
      query: {
        subscriberNotificationStatusOnPostmortemPublished:
          StatusPageSubscriberNotificationStatus.Pending,
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      select: {
        showPostmortemOnStatusPage: true,
        notifySubscribersOnPostmortemPublished: true,
        _id: true,
        title: true,
        description: true,
        projectId: true,
        isVisibleOnStatusPage: true,
        monitors: {
          _id: true,
        },
        incidentSeverity: {
          name: true,
        },
        incidentNumber: true,
        postmortemNote: true,
      },
    });

    logger.debug(
      `Found ${incidents.length} incidents to notify subscribers for postmortem.`,
    );

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
    logger.debug(
      `Database host resolved as ${host.toString()} with protocol ${httpProtocol.toString()}.`,
    );

    for (const incident of incidents) {
      try {
        if (!incident.showPostmortemOnStatusPage) {
          logger.debug(
            `Incident ${incident.id} is not set to show postmortem on status page; marking as Skipped.`,
          );
          await IncidentService.updateOneById({
            id: incident.id!,
            data: {
              subscriberNotificationStatusOnPostmortemPublished:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessageOnPostmortemPublished:
                "Incident is not set to show postmortem on status page. Skipping notifications to subscribers.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
          continue;
        }

        if (!incident.notifySubscribersOnPostmortemPublished) {
          logger.debug(
            `Incident ${incident.id} is not set to notify subscribers on postmortem published; marking as Skipped.`,
          );
          await IncidentService.updateOneById({
            id: incident.id!,
            data: {
              subscriberNotificationStatusOnPostmortemPublished:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessageOnPostmortemPublished:
                "Incident is not set to notify subscribers on postmortem published. Skipping notifications to subscribers.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
          continue;
        }
        
        incident.incidentNumber?.toString() || " - ";
        const incidentFeedText: string = `📧 **Subscriber Incident Postmortem Notification Sent for [Incident ${incidentNumber}](${(await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)).toString()})**:
      Notification sent to status page subscribers because postmortem was published for this incident.`;

        if (!incident.monitors || incident.monitors.length === 0) {
          logger.debug(
            `Incident ${incident.id} has no monitors attached; marking subscriber notifications as Skipped.`,
          );

          await IncidentService.updateOneById({
            id: incident.id!,
            data: {
              subscriberNotificationStatusOnPostmortemPublished:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessageOnPostmortemPublished:
                "No monitors are attached to this incident. Skipping notifications to subscribers.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });

          continue;
        }

        await IncidentService.updateOneById({
          id: incident.id!,
          data: {
            subscriberNotificationStatusOnPostmortemPublished:
              StatusPageSubscriberNotificationStatus.InProgress,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
        logger.debug(
          `Incident ${incident.id} status set to InProgress for subscriber postmortem notifications.`,
        );

        if (!incident.isVisibleOnStatusPage) {
          logger.debug(
            `Incident ${incident.id} is not visible on status page; skipping subscriber notifications.`,
          );

          await IncidentService.updateOneById({
            id: incident.id!,
            data: {
              subscriberNotificationStatusOnPostmortemPublished:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessageOnPostmortemPublished:
                "Incident is not visible on status page. Skipping notifications to subscribers.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });

          continue; // Do not send notification to subscribers if incident is not visible on status page.
        }

        // get status page resources from monitors.

        const statusPageResources: Array<StatusPageResource> =
          await StatusPageResourceService.findAllBy({
            query: {
              monitorId: QueryHelper.any(
                incident.monitors
                  .filter((m: Monitor) => {
                    return m._id;
                  })
                  .map((m: Monitor) => {
                    return new ObjectID(m._id!);
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
            },
          });

        logger.debug(
          `Found ${statusPageResources.length} status page resources linked to incident ${incident.id}.`,
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
          `Incident ${incident.id} maps to ${Object.keys(statusPageToResources).length} status page(s) for notifications.`,
        );

        const statusPages: Array<StatusPage> =
          await StatusPageSubscriberService.getStatusPagesToSendNotification(
            Object.keys(statusPageToResources).map((i: string) => {
              return new ObjectID(i);
            }),
          );

        logger.debug(
          `Loaded ${statusPages.length} status page(s) for incident ${incident.id}.`,
        );

        for (const statuspage of statusPages) {
          try {
            if (!statuspage.id) {
              logger.debug(
                "Encountered a status page without an id; skipping.",
              );
              continue;
            }

            if (!statuspage.showIncidentsOnStatusPage) {
              logger.debug(
                `Status page ${statuspage.id} is configured to hide incidents; skipping notifications.`,
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

            const statusPageURL: string =
              await StatusPageService.getStatusPageURL(statuspage.id);
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
              `Status page ${statuspage.id} (${statusPageName}) has ${subscribers.length} subscriber(s).`,
            );

            // Send email to Email subscribers.

            const resourcesAffectedString: string =
              statusPageToResources[statuspage._id!]
                ?.map((r: StatusPageResource) => {
                  return r.displayName;
                })
                .join(", ") || "None";

            logger.debug(
              `Resources affected for incident ${incident.id} on status page ${statuspage.id}: ${resourcesAffectedString}`,
            );

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
                    eventType: StatusPageEventType.Incident,
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

                if (subscriber.subscriberEmail) {
                  // send email here.
                  logger.debug(
                    `Queueing email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail}.`,
                  );

                  MailService.sendMail(
                    {
                      toEmail: subscriber.subscriberEmail,
                      templateType: EmailTemplateType.SubscriberIncidentPostmortemCreated,
                      vars: {
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
                        incidentSeverity:
                          incident.incidentSeverity?.name || " - ",
                        incidentTitle: incident.title || "",
                        postmortemNote: await Markdown.convertToHTML(
                          incident.postmortemNote || "",
                          MarkdownContentType.Email,
                        ),
                        unsubscribeUrl: unsubscribeUrl,

                        subscriberEmailNotificationFooterText:
                          StatusPageServiceType.getSubscriberEmailFooterText(
                            statuspage,
                          ),
                      },
                      subject: "[Postmortem] " + incident.title || "",
                    },
                    {
                      mailServer: ProjectSMTPConfigService.toEmailServer(
                        statuspage.smtpConfig,
                      ),
                      projectId: statuspage.projectId,
                      statusPageId: statuspage.id!,
                      incidentId: incident.id!,
                    },
                  ).catch((err: Error) => {
                    logger.error(err);
                  });
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
                  const sms: SMS = {
                    message: `
                            Incident Postmortem - ${statusPageName}

                            Title: ${incident.title || ""}

                            Severity: ${incident.incidentSeverity?.name || " - "
                      } 

                            Resources Affected: ${resourcesAffectedString} 

                            To view this incident, visit ${statusPageURL}

                            To update notification preferences or unsubscribe, visit ${unsubscribeUrl}
                            `,
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
                    incidentId: incident.id!,
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
                  // Create markdown message for Slack
                  const markdownMessage: string = `## 🚨 Incident Postmortem - ${incident.title || ""}

**Severity:** ${incident.incidentSeverity?.name || " - "}

**Resources Affected:** ${resourcesAffectedString}

**Postmortem:** ${incident.postmortemNote || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;

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
                  // Create markdown message for Teams
                  const markdownMessage: string = `## 🚨 Incident Postmortem - ${incident.title || ""}
**Severity:** ${incident.incidentSeverity?.name || " - "}
**Resources Affected:** ${resourcesAffectedString}
**Postmortem:** ${incident.postmortemNote || ""}
[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
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

        logger.debug("Creating incident feed for subscriber notification");

        await IncidentFeedService.createIncidentFeedItem({
          incidentId: incident.id!,
          projectId: incident.projectId!,
          incidentFeedEventType:
            IncidentFeedEventType.SubscriberNotificationSent,
          displayColor: Blue500,
          feedInfoInMarkdown: incidentFeedText,
          workspaceNotification: {
            sendWorkspaceNotification: false,
          },
        });

        logger.debug("Incident Feed created");

        // If we get here, the notification was successful
        await IncidentService.updateOneById({
          id: incident.id!,
          data: {
            subscriberNotificationStatusOnPostmortemPublished:
              StatusPageSubscriberNotificationStatus.Success,
            subscriberNotificationStatusMessageOnPostmortemPublished:
              "Notifications sent successfully to all subscribers",
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
        logger.debug(
          `Incident ${incident.id} marked as Success for subscriber postmortem notifications.`,
        );
      } catch (err) {
        // If there was an error, mark as failed
        logger.error(err);
        IncidentService.updateOneById({
          id: incident.id!,
          data: {
            subscriberNotificationStatusOnPostmortemPublished:
              StatusPageSubscriberNotificationStatus.Failed,
            subscriberNotificationStatusMessageOnPostmortemPublished:
              err instanceof Error ? err.message : String(err),
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        }).catch((error: Error) => {
          logger.error(
            `Failed to update incident ${incident.id} status after error: ${error.message}`,
          );
        });
      }
    }
  },
);
