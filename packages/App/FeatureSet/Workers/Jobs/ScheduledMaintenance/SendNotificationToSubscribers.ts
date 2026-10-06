import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500 } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import logger from "Common/Server/Utils/Logger";

/*
 * Why a 'scheduled' message that is queued while notifying subscribers is off
 * is not sent - the same words the event's create writes when it is off.
 */
const SKIPPED_NOT_TO_BE_NOTIFIED_MESSAGE: string =
  "Notifications skipped as subscribers are not to be notified for this scheduled maintenance.";

RunCron(
  "ScheduledMaintenance:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * A 'scheduled' message queued while notifying subscribers is off - it
     * was turned off after the message was queued, or Retry or the API
     * queued it again - is not sent. Marked Skipped, as the incident and
     * announcement jobs do, rather than left "Sending Soon" for good: the
     * query below only ever picks up events that notify.
     */
    const eventsToSkip: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findAllBy({
        query: {
          subscriberNotificationStatusOnEventScheduled:
            StatusPageSubscriberNotificationStatus.Pending,
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
        },
      });

    for (const event of eventsToSkip) {
      try {
        await ScheduledMaintenanceService.updateOneById({
          id: event.id!,
          data: {
            subscriberNotificationStatusOnEventScheduled:
              StatusPageSubscriberNotificationStatus.Skipped,
            subscriberNotificationStatusMessage:
              SKIPPED_NOT_TO_BE_NOTIFIED_MESSAGE,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
      } catch (err) {
        logger.error(
          `Could not mark scheduled maintenance ${event.id} as Skipped for subscriber notifications: ${err}`,
        );
      }
    }

    // get all scheduled events of all the projects.
    const scheduledEvents: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findAllBy({
        query: {
          subscriberNotificationStatusOnEventScheduled:
            StatusPageSubscriberNotificationStatus.Pending,
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
          description: true,
          startsAt: true,
          endsAt: true,
          projectId: true,
          monitors: {
            _id: true,
          },
          statusPages: {
            _id: true,
          },
          isVisibleOnStatusPage: true,
          scheduledMaintenanceNumber: true,
          scheduledMaintenanceNumberWithPrefix: true,
        },
      });

    logger.debug(
      `Found ${scheduledEvents.length} scheduled maintenance event(s) to notify subscribers for.`,
    );

    for (const event of scheduledEvents) {
      try {
        logger.debug(
          `Processing scheduled maintenance ${event.id} (project: ${event.projectId}).`,
        );
        const scheduledMaintenanceId: ObjectID = event.id!;
        const projectId: ObjectID = event.projectId!;
        const scheduledMaintenanceNumber: string =
          event.scheduledMaintenanceNumberWithPrefix ||
          event.scheduledMaintenanceNumber?.toString() ||
          " - ";
        const scheduledMaintenanceFeedText: string = `📧 **Subscriber Scheduled Maintenance Scheduled Notification Sent for [Scheduled Maintenance ${scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(projectId, scheduledMaintenanceId)).toString()})**:
              Notification sent to status page subscribers because this scheduled maintenance was created.`;

        // Set status to InProgress
        await ScheduledMaintenanceService.updateOneById({
          id: event.id!,
          data: {
            subscriberNotificationStatusOnEventScheduled:
              StatusPageSubscriberNotificationStatus.InProgress,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
        logger.debug(
          `Scheduled maintenance ${event.id} status set to InProgress for subscriber notifications.`,
        );

        if (!event.isVisibleOnStatusPage) {
          // Set status to Skipped for non-visible events
          logger.debug(
            `Scheduled maintenance ${event.id} is not visible on status page; marking as Skipped.`,
          );
          await ScheduledMaintenanceService.updateOneById({
            id: event.id!,
            data: {
              subscriberNotificationStatusOnEventScheduled:
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
        }

        await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
          {
            scheduledMaintenanceId: event.id!,
            projectId: event.projectId!,
            scheduledMaintenanceFeedEventType:
              ScheduledMaintenanceFeedEventType.SubscriberNotificationSent,
            displayColor: Blue500,
            feedInfoInMarkdown: scheduledMaintenanceFeedText,
            workspaceNotification: {
              sendWorkspaceNotification: false,
            },
          },
        );

        logger.debug(`Scheduled maintenance feed created for ${event.id}.`);

        // Set status to Success after successful processing
        await ScheduledMaintenanceService.updateOneById({
          id: event.id!,
          data: {
            subscriberNotificationStatusOnEventScheduled:
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
          `Scheduled maintenance ${event.id} marked as Success for subscriber notifications.`,
        );
      } catch (err) {
        logger.error(
          `Error processing scheduled maintenance notification ${event.id}: ${err}`,
        );

        // Set status to Failed with error reason
        await ScheduledMaintenanceService.updateOneById({
          id: event.id!,
          data: {
            subscriberNotificationStatusOnEventScheduled:
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

    // Only call notification service for successfully processed events
    const successfulEvents: Array<ScheduledMaintenance> =
      scheduledEvents.filter((event: ScheduledMaintenance) => {
        return event.isVisibleOnStatusPage;
      });

    if (successfulEvents.length > 0) {
      logger.debug(
        `Notifying subscribers for ${successfulEvents.length} scheduled maintenance event(s) via service call.`,
      );
      await ScheduledMaintenanceService.notififySubscribersOnEventScheduled(
        successfulEvents,
      );
      logger.debug(
        "Service call to notify subscribers for scheduled maintenance events completed.",
      );
    }
  },
);
