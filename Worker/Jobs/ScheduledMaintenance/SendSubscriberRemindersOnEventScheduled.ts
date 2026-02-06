import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import logger from "Common/Server/Utils/Logger";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500 } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
RunCron(
  "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    logger.debug(
      "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Running",
    );
    // get all scheduled events of all the projects.
    const scheduledEvents: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findAllBy({
        query: {
          nextSubscriberNotificationBeforeTheEventAt: QueryHelper.lessThan(
            OneUptimeDate.getCurrentDate(),
          ),
        },
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
          sendSubscriberNotificationsOnBeforeTheEvent: true,
          nextSubscriberNotificationBeforeTheEventAt: true,
          scheduledMaintenanceNumber: true,
          scheduledMaintenanceNumberWithPrefix: true,
        },
      });

    logger.debug(
      "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Found " +
        scheduledEvents.length +
        " events",
    );

    for (const event of scheduledEvents) {
      try {
        logger.debug(
          "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Sending notification for event: " +
            event.id,
        );

        const nextSubscriberNotificationAt: Date | null =
          ScheduledMaintenanceService.getNextTimeToNotify({
            eventScheduledDate: event.startsAt!,
            sendSubscriberNotifiationsOn:
              event.sendSubscriberNotificationsOnBeforeTheEvent,
          });

        logger.debug(
          "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Next subscriber notification at: " +
            nextSubscriberNotificationAt,
        );

        await ScheduledMaintenanceService.updateOneById({
          id: event.id!,
          data: {
            nextSubscriberNotificationBeforeTheEventAt:
              nextSubscriberNotificationAt,
          },
          props: {
            isRoot: true,
          },
        });

        logger.debug(
          "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Notification sent for event: " +
            event.id,
        );
      } catch (err) {
        logger.error(
          "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Error sending notification for event: " +
            event.id,
        );
        logger.error(err);
      }

      const scheduledMaintenanceNumber: string =
        event.scheduledMaintenanceNumberWithPrefix || event.scheduledMaintenanceNumber?.toString() || " - ";
      const projectId: ObjectID = event.projectId!;
      const scheduledMaintenanceId: ObjectID = event.id!;

      const scheduledMaintenanceFeedText: string = `🗓️ **Reminder Notification Sent to Subscribers for [Scheduled Maintenance ${scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(projectId, scheduledMaintenanceId)).toString()})**:
            
Reminder notification sent to status page subscribers for this scheduled maintenance event.`;

      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
        scheduledMaintenanceId: event.id!,
        projectId: event.projectId!,
        scheduledMaintenanceFeedEventType:
          ScheduledMaintenanceFeedEventType.SubscriberNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: scheduledMaintenanceFeedText,
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });
    }

    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled(
      scheduledEvents,
    );
  },
);
