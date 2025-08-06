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
import Text from "Common/Types/Text";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
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
import logger from "Common/Server/Utils/Logger";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
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

RunCron(
  "IncidentStateTimeline:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const incidentStateTimelines: Array<IncidentStateTimeline> =
      await IncidentStateTimelineService.findBy({
        query: {
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.Pending,
          shouldStatusPageSubscribersBeNotified: true,
          createdAt: QueryHelper.lessThan(OneUptimeDate.getCurrentDate()),
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          _id: true,
          projectId: true,
          incidentId: true,
          incidentStateId: true,
          incidentState: {
            name: true,
          },
        },
      });

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    for (const incidentStateTimeline of incidentStateTimelines) {
      await IncidentStateTimelineService.updateOneById({
        id: incidentStateTimeline.id!,
        data: {
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.Success,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      if (
        !incidentStateTimeline.incidentId ||
        !incidentStateTimeline.incidentStateId
      ) {
        continue;
      }

      if (!incidentStateTimeline.incidentState?.name) {
        continue;
      }

      // get all scheduled events of all the projects.
      const incident: Incident | null = await IncidentService.findOneById({
        id: incidentStateTimeline.incidentId!,
        props: {
          isRoot: true,
        },

        select: {
          _id: true,
          title: true,
          projectId: true,
          monitors: {
            _id: true,
          },
          incidentSeverity: {
            name: true,
          },
          isVisibleOnStatusPage: true,
          incidentNumber: true,
        },
      });

      if (!incident) {
        continue;
      }

      if (!incident.monitors || incident.monitors.length === 0) {
        continue;
      }

      if (!incident.isVisibleOnStatusPage) {
        continue; // skip if not visible on status page.
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

        const statusPageURL: string = await StatusPageService.getStatusPageURL(
          statuspage.id,
        );
        const statusPageName: string =
          statuspage.pageTitle || statuspage.name || "Status Page";

        // Send email to Email subscribers.

        for (const subscriber of subscribers) {
          if (!subscriber._id) {
            continue;
          }

          const shouldNotifySubscriber: boolean =
            StatusPageSubscriberService.shouldSendNotification({
              subscriber: subscriber,
              statusPageResources: statusPageToResources[statuspage._id!] || [],
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

          if (subscriber.subscriberPhone) {
            const sms: SMS = {
              message: `
                            Incident ${Text.uppercaseFirstLetter(
                              incidentStateTimeline.incidentState.name,
                            )} - ${statusPageName}

                            To view this incident, visit ${statusPageURL}

                            To update notification preferences or unsubscribe, visit ${unsubscribeUrl}
                            `,
              to: subscriber.subscriberPhone,
            };

            // send sms here.
            SmsService.sendSms(sms, {
              projectId: statuspage.projectId,
              customTwilioConfig: ProjectCallSMSConfigService.toTwilioConfig(
                statuspage.callSmsConfig,
              ),
            }).catch((err: Error) => {
              logger.error(err);
            });
          }

          let emailTitle: string = `Incident `;

          const resourcesAffected: string =
            statusPageToResources[statuspage._id!]
              ?.map((r: StatusPageResource) => {
                return r.displayName;
              })
              .join(", ") || "";

          if (resourcesAffected) {
            emailTitle += `on ${resourcesAffected} `;
          }

          emailTitle += `is ${incidentStateTimeline.incidentState.name}`;

          if (subscriber.subscriberEmail) {
            // send email here.

            MailService.sendMail(
              {
                toEmail: subscriber.subscriberEmail,
                templateType: EmailTemplateType.SubscriberIncidentStateChanged,
                vars: {
                  emailTitle: emailTitle,
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
                  resourcesAffected: resourcesAffected || "None",
                  incidentSeverity: incident.incidentSeverity?.name || " - ",
                  incidentTitle: incident.title || "",

                  incidentState: incidentStateTimeline.incidentState.name,
                  unsubscribeUrl: unsubscribeUrl,
                  subscriberEmailNotificationFooterText:
                    StatusPageServiceType.getSubscriberEmailFooterText(
                      statuspage,
                    ),
                },
                subject: `[Incident ${Text.uppercaseFirstLetter(
                  incidentStateTimeline.incidentState.name,
                )}] ${incident.title}`,
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

          if (subscriber.slackIncomingWebhookUrl) {
            // send slack message here.
            let slackTitle: string = `🚨 ## Incident - ${incident.title || " - "}

`;

            if (resourcesAffected) {
              slackTitle += `
**Resources Affected:** ${resourcesAffected}`;
            }

            slackTitle += `
**Severity:** ${incident.incidentSeverity?.name || " - "}
**Status:** ${incidentStateTimeline.incidentState.name}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;

            SlackUtil.sendMessageToChannelViaIncomingWebhook({
              url: subscriber.slackIncomingWebhookUrl,
              text: SlackUtil.convertMarkdownToSlackRichText(slackTitle),
            }).catch((err: Error) => {
              logger.error(err);
            });
          }
        }
      }

      logger.debug(
        "Notification sent to subscribers for incident state change",
      );

      const incidentNumber: string =
        incident.incidentNumber?.toString() || " - ";
      const projectId: ObjectID = incident.projectId!;
      const incidentId: ObjectID = incident.id!;

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id!,
        projectId: incident.projectId!,
        incidentFeedEventType: IncidentFeedEventType.SubscriberNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: `📧 **Status Page Subscribers have been notified** about the state change of the [Incident ${incidentNumber}](${(await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)).toString()}) to **${incidentStateTimeline.incidentState.name}**`,
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });

      logger.debug("Incident Feed created");
    }
  },
);
