import RunCron from "../../Utils/Cron";
import { StatusPageApiRoute } from "Common/ServiceRoute";
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
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
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
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          note: true,
          scheduledMaintenanceId: true,
        },
      });

    logger.debug(
      `Found ${publicNotes.length} scheduled maintenance public note(s) to notify subscribers for.`,
    );

    for (const publicNote of publicNotes) {
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
          logger.debug(
            `Scheduled maintenance ${publicNote.scheduledMaintenanceId} not found; marking public note ${publicNote.id} as Skipped.`,
          );
          await ScheduledMaintenancePublicNoteService.updateOneById({
            id: publicNote.id!,
            data: {
              subscriberNotificationStatusOnNoteCreated:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "Related scheduled maintenance not found. Skipping notifications to subscribers.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
          continue;
        }

        // Set status to InProgress
        await ScheduledMaintenancePublicNoteService.updateOneById({
          id: publicNote.id!,
          data: {
            subscriberNotificationStatusOnNoteCreated:
              StatusPageSubscriberNotificationStatus.InProgress,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
        logger.debug(
          `Public note ${publicNote.id} status set to InProgress for subscriber notifications.`,
        );

        if (!event.isVisibleOnStatusPage) {
          // Set status to Skipped for non-visible events
          logger.debug(
            `Scheduled maintenance ${event.id} is not visible on status page; marking public note ${publicNote.id} as Skipped.`,
          );
          await ScheduledMaintenancePublicNoteService.updateOneById({
            id: publicNote.id!,
            data: {
              subscriberNotificationStatusOnNoteCreated:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "Notifications skipped as scheduled maintenance is not visible on status page.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
          continue; // skip if not visible on status page.
        } // get status page resources from monitors.

        let statusPageResources: Array<StatusPageResource> = [];

        if (event.monitors && event.monitors.length > 0) {
          statusPageResources = await StatusPageResourceService.findAllBy({
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
            select: {
              _id: true,
              displayName: true,
              statusPageId: true,
            },
          });
        }

        logger.debug(
          `Found ${statusPageResources.length} status page resource(s) for scheduled maintenance ${event.id}.`,
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
          await ScheduledMaintenancePublicNoteService.updateOneById({
            id: publicNote.id!,
            data: {
              subscriberNotificationStatusOnNoteCreated:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "No status pages are configured for this scheduled maintenance. Skipping notifications.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
          continue;
        }

        for (const statuspage of statusPages) {
          if (!statuspage.id) {
            logger.debug("Encountered a status page without an id; skipping.");
            continue;
          }

          if (!statuspage.showScheduledMaintenanceEventsOnStatusPage) {
            logger.debug(
              `Status page ${statuspage.id} hides scheduled maintenance events; skipping.`,
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

          const statusPageURL: string =
            await StatusPageService.getStatusPageURL(statuspage.id);

          const statusPageName: string =
            statuspage.pageTitle || statuspage.name || "Status Page";
          const statusPageIdString: string | null =
            statuspage.id?.toString() || statuspage._id?.toString() || null;

          const scheduledEventDetailsUrl: string =
            event.id && statusPageURL
              ? URL.fromString(statusPageURL)
                  .addRoute(`/scheduled-events/${event.id.toString()}`)
                  .toString()
              : statusPageURL;

          logger.debug(
            `Status page ${statuspage.id} (${statusPageName}) has ${subscribers.length} subscriber(s) for public note ${publicNote.id}.`,
          );

          // Send email to Email subscribers.

          for (const subscriber of subscribers) {
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
                eventType: StatusPageEventType.ScheduledEvent,
              });

            if (!shouldNotifySubscriber) {
              logger.debug(
                `Skipping subscriber ${subscriber._id} based on preferences for public note ${publicNote.id}.`,
              );
              continue;
            }

            const unsubscribeUrl: string =
              StatusPageSubscriberService.getUnsubscribeLink(
                URL.fromString(statusPageURL),
                subscriber.id!,
              ).toString();

            logger.debug(
              `Prepared unsubscribe link for subscriber ${subscriber._id} for public note ${publicNote.id}.`,
            );

            if (subscriber.subscriberPhone) {
              const phoneStr: string = subscriber.subscriberPhone.toString();
              const phoneMasked: string = `${phoneStr.slice(0, 2)}******${phoneStr.slice(-2)}`;
              logger.debug(
                `Queueing SMS notification to subscriber ${subscriber._id} at ${phoneMasked} for public note ${publicNote.id}.`,
              );
              const sms: SMS = {
                message: `Maintenance update: ${event.title || ""} on ${statusPageName}. Details: ${scheduledEventDetailsUrl}. Unsub: ${unsubscribeUrl}`,
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
              logger.debug(
                `Queueing Slack notification to subscriber ${subscriber._id} for public note ${publicNote.id}.`,
              );
              // Create markdown message for Slack
              const markdownMessage: string = `## Scheduled Maintenance Update - ${statusPageName}

**Event:** ${event.title || ""}

**New Note Added**

**Note:** ${publicNote.note || ""}

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
              logger.debug(
                `Queueing Microsoft Teams notification to subscriber ${subscriber._id} for public note ${publicNote.id}.`,
              );
              // Create markdown message for Teams
              const markdownMessage: string = `## Scheduled Maintenance Update - ${statusPageName}

**Event:** ${event.title || ""}

**New Note Added**

**Note:** ${publicNote.note || ""}

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
              logger.debug(
                `Queueing email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail} for public note ${publicNote.id}.`,
              );

              MailService.sendMail(
                {
                  toEmail: subscriber.subscriberEmail,
                  templateType:
                    EmailTemplateType.SubscriberScheduledMaintenanceEventNoteCreated,
                  vars: {
                    note: await Markdown.convertToHTML(
                      publicNote.note!,
                      MarkdownContentType.Email,
                    ),
                    statusPageName: statusPageName,
                    statusPageUrl: statusPageURL,
                    detailsUrl: scheduledEventDetailsUrl,
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
                    resourcesAffected:
                      statusPageToResources[statuspage._id!]
                        ?.map((r: StatusPageResource) => {
                          return r.displayName;
                        })
                        .join(", ") || "",

                    scheduledAt:
                      OneUptimeDate.getDateAsUserFriendlyFormattedString(
                        event.startsAt!,
                      ),
                    eventTitle: event.title || "",
                    eventDescription: event.description || "",
                    unsubscribeUrl: unsubscribeUrl,
                    subscriberEmailNotificationFooterText:
                      StatusPageServiceType.getSubscriberEmailFooterText(
                        statuspage,
                      ),
                  },
                  subject: "[Scheduled Maintenance Update] " + event.title,
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
                logger.error(err);
              });
              logger.debug(
                `Email notification queued for subscriber ${subscriber._id} for public note ${publicNote.id}.`,
              );
            }
          }
        }

        await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
          {
            scheduledMaintenanceId: event.id!,
            projectId: event.projectId!,
            scheduledMaintenanceFeedEventType:
              ScheduledMaintenanceFeedEventType.SubscriberNotificationSent,
            displayColor: Blue500,
            feedInfoInMarkdown: `📧 **Notification sent to subscribers** because a public note is added to this [Scheduled Maintenance ${event.scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(event.projectId!, event.id!)).toString()}).`,
            moreInformationInMarkdown: `**Public Note:**
        
${publicNote.note}`,
            workspaceNotification: {
              sendWorkspaceNotification: true,
            },
          },
        );

        // Set status to Success after successful notification
        await ScheduledMaintenancePublicNoteService.updateOneById({
          id: publicNote.id!,
          data: {
            subscriberNotificationStatusOnNoteCreated:
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
          `Scheduled maintenance public note ${publicNote.id} marked as Success for subscriber notifications.`,
        );
      } catch (err) {
        logger.error(
          `Error sending notification for scheduled maintenance public note ${publicNote.id}: ${err}`,
        );

        // Set status to Failed with error reason
        await ScheduledMaintenancePublicNoteService.updateOneById({
          id: publicNote.id!,
          data: {
            subscriberNotificationStatusOnNoteCreated:
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
