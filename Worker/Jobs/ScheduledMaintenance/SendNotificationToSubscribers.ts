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
RunCron(
  "ScheduledMaintenance:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.
    const scheduledEvents: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findBy({
        query: {
          isStatusPageSubscribersNotifiedOnEventScheduled: false,
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
      const scheduledMaintenanceId: ObjectID = event.id!;
      const projectId: ObjectID = event.projectId!;
      const scheduledMaintenanceNumber: string =
        event.scheduledMaintenanceNumber?.toString() || " - ";
      const scheduledMaintenanceFeedText: string = `📧 **Subscriber Scheduled Maintenance Scheduled Notification Sent for [Scheduled Maintenance ${scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(projectId, scheduledMaintenanceId)).toString()})**:
            Notification sent to status page subscribers because this scheduled maintenance was created.`;

      await ScheduledMaintenanceService.updateOneById({
        id: event.id!,
        data: {
          isStatusPageSubscribersNotifiedOnEventScheduled: true,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      if (!event.isVisibleOnStatusPage) {
        continue; // skip if not visible on status page.
      }

      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
        scheduledMaintenanceId: event.id!,
        projectId: event.projectId!,
        scheduledMaintenanceFeedEventType:
          ScheduledMaintenanceFeedEventType.SubscriberNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: scheduledMaintenanceFeedText,
        workspaceNotification: {
          sendWorkspaceNotification: false,
        },
      });
    }

    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled(
      scheduledEvents
    );
  }
);
