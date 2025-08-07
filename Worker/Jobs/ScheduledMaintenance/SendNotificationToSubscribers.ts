import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500 } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import logger from "Common/Server/Utils/Logger";
RunCron(
  "ScheduledMaintenance:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.
    const scheduledEvents: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findBy({
        query: {
          subscriberNotificationStatusOnEventScheduled:
            StatusPageSubscriberNotificationStatus.Pending,
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
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

    for (const event of scheduledEvents) {
      try {
        const scheduledMaintenanceId: ObjectID = event.id!;
        const projectId: ObjectID = event.projectId!;
        const scheduledMaintenanceNumber: string =
          event.scheduledMaintenanceNumber?.toString() || " - ";
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

        if (!event.isVisibleOnStatusPage) {
          // Set status to Skipped for non-visible events
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
      await ScheduledMaintenanceService.notififySubscribersOnEventScheduled(
        successfulEvents,
      );
    }
  },
);
