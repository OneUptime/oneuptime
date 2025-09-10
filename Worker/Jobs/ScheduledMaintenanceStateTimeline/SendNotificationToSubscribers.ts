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
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "Common/Server/Services/ScheduledMaintenanceStateTimelineService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500 } from "Common/Types/BrandColors";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";

RunCron(
  "ScheduledMaintenanceStateTimeline:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const scheduledEventStateTimelines: Array<ScheduledMaintenanceStateTimeline> =
      await ScheduledMaintenanceStateTimelineService.findBy({
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
          scheduledMaintenanceId: true,
          scheduledMaintenanceStateId: true,
          scheduledMaintenanceState: {
            name: true,
          },
        },
      });

    for (const scheduledEventStateTimeline of scheduledEventStateTimelines) {
      try {
        // Set status to InProgress
        await ScheduledMaintenanceStateTimelineService.updateOneById({
          id: scheduledEventStateTimeline.id!,
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
          !scheduledEventStateTimeline.scheduledMaintenanceId ||
          !scheduledEventStateTimeline.scheduledMaintenanceStateId
        ) {
          await ScheduledMaintenanceStateTimelineService.updateOneById({
            id: scheduledEventStateTimeline.id!,
            data: {
              subscriberNotificationStatus:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "Missing scheduled maintenance or state reference. Skipping notifications.",
            },
            props: { isRoot: true, ignoreHooks: true },
          });
          continue;
        }

        if (!scheduledEventStateTimeline.scheduledMaintenanceState?.name) {
          await ScheduledMaintenanceStateTimelineService.updateOneById({
            id: scheduledEventStateTimeline.id!,
            data: {
              subscriberNotificationStatus:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "Scheduled maintenance state has no name. Skipping notifications.",
            },
            props: { isRoot: true, ignoreHooks: true },
          });
          continue;
        }

        // get all scheduled events of all the projects.
        const event: ScheduledMaintenance | null =
          await ScheduledMaintenanceService.findOneById({
            id: scheduledEventStateTimeline.scheduledMaintenanceId!,
            props: {
              isRoot: true,
            },

            select: {
              _id: true,
              title: true,
              description: true,
              startsAt: true,
              projectId: true,
              monitors: {
                _id: true,
              },
              statusPages: {
                _id: true,
              },
              isVisibleOnStatusPage: true,
              scheduledMaintenanceNumber: true,
            },
          });

        if (!event) {
          await ScheduledMaintenanceStateTimelineService.updateOneById({
            id: scheduledEventStateTimeline.id!,
            data: {
              subscriberNotificationStatus:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "Related scheduled maintenance not found. Skipping notifications.",
            },
            props: { isRoot: true, ignoreHooks: true },
          });
          continue;
        }

        if (!event.isVisibleOnStatusPage) {
          await ScheduledMaintenanceStateTimelineService.updateOneById({
            id: scheduledEventStateTimeline.id!,
            data: {
              subscriberNotificationStatus:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "Scheduled maintenance is not visible on status page. Skipping notifications.",
            },
            props: { isRoot: true, ignoreHooks: true },
          });
          continue; // skip if not visible on status page.
        }

        // get status page resources from monitors.

        let statusPageResources: Array<StatusPageResource> = [];

        if (event.monitors && event.monitors.length > 0) {
          statusPageResources = await StatusPageResourceService.findBy({
            query: {
              monitorId: QueryHelper.any(
                event.monitors
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
        }

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
            event.statusPages?.map((i: StatusPage) => {
              return i.id!;
            }) || [],
          );

        for (const statuspage of statusPages) {
          if (!statuspage.id) {
            continue;
          }

          if (!statuspage.showScheduledMaintenanceEventsOnStatusPage) {
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

          const statusPageURL: string =
            await StatusPageService.getStatusPageURL(statuspage.id);

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
                statusPageResources:
                  statusPageToResources[statuspage._id!] || [],
                statusPage: statuspage,
                eventType: StatusPageEventType.ScheduledEvent,
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
                                    ${statusPageName} - Scheduled maintenance event - ${
                                      event.title || ""
                                    } - state changed to ${
                                      scheduledEventStateTimeline
                                        .scheduledMaintenanceState?.name
                                    }
                                    
                                    To view this note, visit ${statusPageURL}
        
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
                statusPageId: statuspage.id!,
                scheduledMaintenanceId: event.id!,
              }).catch((err: Error) => {
                logger.error(err);
              });
            }

            if (subscriber.slackIncomingWebhookUrl) {
              // Create markdown message for Slack
              const markdownMessage: string = `## Scheduled Maintenance State Update - ${statusPageName}

**Event:** ${event.title || ""}

**State Changed To:** ${scheduledEventStateTimeline.scheduledMaintenanceState?.name}

**Resources Affected:** ${
                statusPageToResources[statuspage._id!]
                  ?.map((r: StatusPageResource) => {
                    return r.displayName;
                  })
                  .join(", ") || ""
              }

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;

              // send Slack notification with markdown conversion
              SlackUtil.sendMessageToChannelViaIncomingWebhook({
                url: subscriber.slackIncomingWebhookUrl,
                text: SlackUtil.convertMarkdownToSlackRichText(markdownMessage),
              }).catch((err: Error) => {
                logger.error(err);
              });
            }

            if (subscriber.microsoftTeamsIncomingWebhookUrl) {
              // Create markdown message for Teams
              const markdownMessage: string = `## Scheduled Maintenance State Update - ${statusPageName}
**Event:** ${event.title || ""}
**State Changed To:** ${scheduledEventStateTimeline.scheduledMaintenanceState?.name}
**Resources Affected:** ${
                statusPageToResources[statuspage._id!]
                  ?.map((r: StatusPageResource) => {
                    return r.displayName;
                  })
                  .join(", ") || ""
              }
[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
              // send Teams notification
              MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
                url: subscriber.microsoftTeamsIncomingWebhookUrl,
                text: markdownMessage,
              }).catch((err: Error) => {
                logger.error(err);
              });
            }

            if (subscriber.subscriberEmail) {
              // send email here.

              MailService.sendMail(
                {
                  toEmail: subscriber.subscriberEmail,
                  templateType:
                    EmailTemplateType.SubscriberScheduledMaintenanceEventStateChanged,
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
                    resourcesAffected:
                      statusPageToResources[statuspage._id!]
                        ?.map((r: StatusPageResource) => {
                          return r.displayName;
                        })
                        .join(", ") || "",

                    eventState:
                      scheduledEventStateTimeline.scheduledMaintenanceState
                        ?.name || "",

                    scheduledAt:
                      OneUptimeDate.getDateAsUserFriendlyFormattedString(
                        event.startsAt!,
                      ),
                    eventTitle: event.title || "",
                    unsubscribeUrl: unsubscribeUrl,
                    subscriberEmailNotificationFooterText:
                      StatusPageServiceType.getSubscriberEmailFooterText(
                        statuspage,
                      ),
                  },
                  subject: `[Scheduled Maintenance ${Text.uppercaseFirstLetter(
                    scheduledEventStateTimeline.scheduledMaintenanceState?.name,
                  )}] ${event.title || ""}`,
                },
                {
                  mailServer: ProjectSmtpConfigService.toEmailServer(
                    statuspage.smtpConfig,
                  ),
                  projectId: statuspage.projectId,
                  statusPageId: statuspage.id!,
                  scheduledMaintenanceId: event.id!,
                },
              ).catch((err: Error) => {
                logger.error(err);
              });
            }
          }
        }

        const scheduledMaintenanceNumber: string =
          event.scheduledMaintenanceNumber?.toString() || " - ";
        const projectId: ObjectID = event.projectId!;
        const scheduledMaintenanceId: ObjectID = event.id!;

        await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
          {
            scheduledMaintenanceId: event.id!,
            projectId: event.projectId!,
            scheduledMaintenanceFeedEventType:
              ScheduledMaintenanceFeedEventType.SubscriberNotificationSent,
            displayColor: Blue500,
            feedInfoInMarkdown: `📧 **Status Page Subscribers have been notified** about the state change of the [Scheduled Maintenance ${scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(projectId, scheduledMaintenanceId)).toString()}) to **${scheduledEventStateTimeline.scheduledMaintenanceState.name}**`,
            workspaceNotification: {
              sendWorkspaceNotification: true,
            },
          },
        );

        // Set status to Success after successful notification
        await ScheduledMaintenanceStateTimelineService.updateOneById({
          id: scheduledEventStateTimeline.id!,
          data: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Success,
            subscriberNotificationStatusMessage:
              "Notifications sent successfully to all subscribers",
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
      } catch (err) {
        logger.error(
          `Error sending notification for scheduled maintenance state timeline ${scheduledEventStateTimeline.id}: ${err}`,
        );

        // Set status to Failed with error reason
        await ScheduledMaintenanceStateTimelineService.updateOneById({
          id: scheduledEventStateTimeline.id!,
          data: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Failed,
            subscriberNotificationStatusMessage: (err as Error).message,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
      }
    }
  },
);
