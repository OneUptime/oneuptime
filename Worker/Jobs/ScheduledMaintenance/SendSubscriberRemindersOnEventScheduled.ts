import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import logger from "Common/Server/Utils/Logger";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500 } from "Common/Types/BrandColors";
RunCron(
  "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    logger.debug(
      "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Running",
    );
    // get all scheduled events of all the projects.
    const scheduledEvents: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findBy({
        query: {
          nextSubscriberNotificationBeforeTheEventAt: QueryHelper.lessThan(
            OneUptimeDate.getCurrentDate(),
          ),
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
          sendSubscriberNotificationsOnBeforeTheEvent: true,
          nextSubscriberNotificationBeforeTheEventAt: true,
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
              event.sendSubscriberNotificationsOnBeforeTheEvent!,
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

      const scheduledMaintenanceFeedText: string = `**Reminder Notification Sent to Subscribers**:
            
Reminder notification sent to status page subscribers for this scheduled maintenance event.`;

      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
        scheduledMaintenanceId: event.id!,
        projectId: event.projectId!,
        scheduledMaintenanceFeedEventType:
          ScheduledMaintenanceFeedEventType.SubscriberNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: scheduledMaintenanceFeedText,
      });
    }

    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled(
      scheduledEvents,
    );
  },
);
