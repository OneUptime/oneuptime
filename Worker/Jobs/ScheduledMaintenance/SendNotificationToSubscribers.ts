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
        },
      });

    for (const event of scheduledEvents) {
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

      const scheduledMaintenanceFeedText: string = `**Subscriber Scheduled Maintenance Created Notification Sent**:
      
Notification sent to status page subscribers because this scheduledMaintenance was created.`;

      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeed({
              scheduledMaintenanceId: event.id!,
              projectId: event.projectId!,
              scheduledMaintenanceFeedEventType: ScheduledMaintenanceFeedEventType.SubscriberNotificationSent,
              displayColor: Blue500,
              feedInfoInMarkdown: scheduledMaintenanceFeedText,
            });
    }

    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled(
      scheduledEvents,
    );
  },
);
