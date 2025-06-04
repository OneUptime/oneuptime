import RunCron from "../../Utils/Cron";
import { FileRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
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
import StatusPageService from "Common/Server/Services/StatusPageService";
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
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import { Blue500 } from "Common/Types/BrandColors";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";

RunCron(
  "Incident:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.
    const incidents: Array<Incident> = await IncidentService.findBy({
      query: {
        isStatusPageSubscribersNotifiedOnIncidentCreated: false,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
        createdAt: QueryHelper.lessThan(OneUptimeDate.getCurrentDate()),
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      select: {
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
      },
    });

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    for (const incident of incidents) {
      const incidentId: ObjectID = incident.id!;
      const projectId: ObjectID = incident.projectId!;
      const incidentNumber: string =
        incident.incidentNumber?.toString() || " - ";
      const incidentFeedText: string = `📧 **Subscriber Incident Created Notification Sent for [Incident ${incidentNumber}](${(await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)).toString()})**:
      Notification sent to status page subscribers because this incident was created.`;

      if (!incident.monitors || incident.monitors.length === 0) {
        continue;
      }

      await IncidentService.updateOneById({
        id: incident.id!,
        data: {
          isStatusPageSubscribersNotifiedOnIncidentCreated: true,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      if (!incident.isVisibleOnStatusPage) {
        continue; // Do not send notification to subscribers if incident is not visible on status page.
      }

      // get status page resources from monitors.

      const statusPageResources: Array<StatusPageResource> =
        await StatusPageResourceService.findBy({
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
          limit: LIMIT_PER_PROJECT,
          select: {
            _id: true,
            displayName: true,
            statusPageId: true,
          },
        });

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

      const statusPages: Array<StatusPage> =
        await StatusPageSubscriberService.getStatusPagesToSendNotification(
          Object.keys(statusPageToResources).map((i: string) => {
            return new ObjectID(i);
          }),
        );

      for (const statuspage of statusPages) {
        try {
          if (!statuspage.id) {
            continue;
          }

          if (!statuspage.showIncidentsOnStatusPage) {
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

          // Send email to Email subscribers.

          const resourcesAffectedString: string =
            statusPageToResources[statuspage._id!]
              ?.map((r: StatusPageResource) => {
                return r.displayName;
              })
              .join(", ") || "None";

          for (const subscriber of subscribers) {
            try {
              if (!subscriber._id) {
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
                continue;
              }

              const unsubscribeUrl: string =
                StatusPageSubscriberService.getUnsubscribeLink(
                  URL.fromString(statusPageURL),
                  subscriber.id!,
                ).toString();

              if (subscriber.subscriberEmail) {
                // send email here.

                MailService.sendMail(
                  {
                    toEmail: subscriber.subscriberEmail,
                    templateType: EmailTemplateType.SubscriberIncidentCreated,
                    vars: {
                      statusPageName: statusPageName,
                      statusPageUrl: statusPageURL,
                      logoUrl: statuspage.logoFileId
                        ? new URL(httpProtocol, host)
                            .addRoute(FileRoute)
                            .addRoute("/image/" + statuspage.logoFileId)
                            .toString()
                        : "",
                      isPublicStatusPage: statuspage.isPublicStatusPage
                        ? "true"
                        : "false",
                      resourcesAffected: resourcesAffectedString,
                      incidentSeverity:
                        incident.incidentSeverity?.name || " - ",
                      incidentTitle: incident.title || "",
                      incidentDescription: await Markdown.convertToHTML(
                        incident.description || "",
                        MarkdownContentType.Email,
                      ),
                      unsubscribeUrl: unsubscribeUrl,

                      subscriberEmailNotificationFooterText:
                        statuspage.subscriberEmailNotificationFooterText || "",
                    },
                    subject: "[Incident] " + incident.title || "",
                  },
                  {
                    mailServer: ProjectSMTPConfigService.toEmailServer(
                      statuspage.smtpConfig,
                    ),
                    projectId: statuspage.projectId,
                  },
                ).catch((err: Error) => {
                  logger.error(err);
                });
              }

              if (subscriber.subscriberPhone) {
                const sms: SMS = {
                  message: `
                            Incident - ${statusPageName}

                            Title: ${incident.title || ""}

                            Severity: ${
                              incident.incidentSeverity?.name || " - "
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
                }).catch((err: Error) => {
                  logger.error(err);
                });
              }

              if (subscriber.slackIncomingWebhookUrl) {
                // Create markdown message for Slack
                const markdownMessage: string = `## 🚨 Incident - ${statusPageName}

**Title:** ${incident.title || ""}

**Severity:** ${incident.incidentSeverity?.name || " - "}

**Resources Affected:** ${resourcesAffectedString}

**Description:** ${incident.description || ""}

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
        incidentFeedEventType: IncidentFeedEventType.SubscriberNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: incidentFeedText,
        workspaceNotification: {
          sendWorkspaceNotification: false,
        },
      });

      logger.debug("Incident Feed created");
    }
  },
);
