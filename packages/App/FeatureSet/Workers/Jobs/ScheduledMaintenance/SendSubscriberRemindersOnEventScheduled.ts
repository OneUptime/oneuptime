import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import logger from "Common/Server/Utils/Logger";
import BlockedProjectStatusPages from "Common/Server/Utils/StatusPage/BlockedProjectStatusPages";
import { STATUS_PAGE_OF_BLOCKED_PROJECT_SENDS_NOTHING_MESSAGE } from "Common/Types/StatusPage/StatusPageProjectBlock";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500, Yellow500 } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import { mdText } from "Common/Utils/Markdown/FeedMarkdown";
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
          endsAt: true,
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

    // Events of a blocked project, which are not sent (see below).
    const eventIdsOfBlockedProjects: Set<string> = new Set();

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
        event.scheduledMaintenanceNumberWithPrefix ||
        event.scheduledMaintenanceNumber?.toString() ||
        " - ";
      const projectId: ObjectID = event.projectId!;
      const scheduledMaintenanceId: ObjectID = event.id!;

      /*
       * The pages of a blocked project send nothing: they are left out of
       * the pages to send from (getStatusPagesToSendNotification). The feed
       * says so, rather than that the reminder was sent.
       */
      const isProjectBlocked: boolean =
        await BlockedProjectStatusPages.isProjectBlocked(event.projectId);

      if (isProjectBlocked) {
        eventIdsOfBlockedProjects.add(scheduledMaintenanceId.toString());
      }

      const scheduledMaintenanceLink: string = (
        await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
          projectId,
          scheduledMaintenanceId,
        )
      ).toString();

      const scheduledMaintenanceFeedText: string = isProjectBlocked
        ? mdText`🗓️ **No Reminder Notification Sent to Subscribers for [Scheduled Maintenance ${scheduledMaintenanceNumber}](${scheduledMaintenanceLink})**`.toString()
        : mdText`🗓️ **Reminder Notification Sent to Subscribers for [Scheduled Maintenance ${scheduledMaintenanceNumber}](${scheduledMaintenanceLink})**:
            
Reminder notification sent to status page subscribers for this scheduled maintenance event.`.toString();

      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
        scheduledMaintenanceId: event.id!,
        projectId: event.projectId!,
        scheduledMaintenanceFeedEventType:
          ScheduledMaintenanceFeedEventType.SubscriberNotificationSent,
        displayColor: isProjectBlocked ? Yellow500 : Blue500,
        feedInfoInMarkdown: scheduledMaintenanceFeedText,
        moreInformationInMarkdown: isProjectBlocked
          ? STATUS_PAGE_OF_BLOCKED_PROJECT_SENDS_NOTHING_MESSAGE
          : undefined,
        /*
         * The feed only: that subscribers were reminded is a side effect of
         * the event, as their other notifications are, not news for the
         * event's channel.
         */
        workspaceNotification: {
          sendWorkspaceNotification: false,
        },
      });
    }

    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled(
      scheduledEvents.filter((event: ScheduledMaintenance): boolean => {
        return !eventIdsOfBlockedProjects.has(event.id!.toString());
      }),
    );
  },
);
