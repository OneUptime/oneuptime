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
import ScheduledMaintenancePublication, {
  REMINDER_NOT_SENT_HIDDEN_MESSAGE,
  REMINDER_NOT_SENT_NOT_PUBLISHED_YET_MESSAGE,
  ScheduledMaintenancePublicationState,
} from "Common/Types/ScheduledMaintenance/ScheduledMaintenancePublication";
import { mdText } from "Common/Utils/Markdown/FeedMarkdown";

/*
 * The reminders subscribers get before an event starts ("Reminders before
 * the event"). One that is due is sent only while the event is shown on its
 * status pages (Types/ScheduledMaintenance/ScheduledMaintenancePublication):
 * an event hidden from them, or kept to the team until its publish time,
 * reminds nobody of something they were never told, and its feed says so.
 * The next reminder is scheduled either way, so a reminder skipped is never
 * sent late.
 */
RunCron(
  "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    logger.debug(
      "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Running",
    );

    // One moment for the whole run: what is due, and what is published.
    const now: Date = OneUptimeDate.getCurrentDate();

    // get all scheduled events of all the projects.
    const scheduledEvents: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findAllBy({
        query: {
          nextSubscriberNotificationBeforeTheEventAt: QueryHelper.lessThan(now),
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
          isVisibleOnStatusPage: true,
          publishOnStatusPageAt: true,
          scheduledMaintenanceNumber: true,
          scheduledMaintenanceNumberWithPrefix: true,
        },
      });

    logger.debug(
      "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Found " +
        scheduledEvents.length +
        " events",
    );

    /*
     * Events whose reminder is not sent: of a blocked project, or not shown
     * on their status pages (see below).
     */
    const eventIdsNotReminded: Set<string> = new Set();

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

      /*
       * Why nothing is sent, when nothing is: the pages of a blocked
       * project send nothing, and an event not shown on its status pages -
       * hidden from them, or not published yet - reminds nobody.
       */
      const publication: ScheduledMaintenancePublicationState =
        ScheduledMaintenancePublication.getState(event, now);

      const notSentReason: string | undefined = isProjectBlocked
        ? STATUS_PAGE_OF_BLOCKED_PROJECT_SENDS_NOTHING_MESSAGE
        : publication === ScheduledMaintenancePublicationState.Hidden
          ? REMINDER_NOT_SENT_HIDDEN_MESSAGE
          : publication === ScheduledMaintenancePublicationState.Scheduled
            ? REMINDER_NOT_SENT_NOT_PUBLISHED_YET_MESSAGE
            : undefined;

      if (notSentReason) {
        eventIdsNotReminded.add(scheduledMaintenanceId.toString());
      }

      const scheduledMaintenanceLink: string = (
        await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
          projectId,
          scheduledMaintenanceId,
        )
      ).toString();

      const scheduledMaintenanceFeedText: string = notSentReason
        ? mdText`🗓️ **No Reminder Notification Sent to Subscribers for [Scheduled Maintenance ${scheduledMaintenanceNumber}](${scheduledMaintenanceLink})**`.toString()
        : mdText`🗓️ **Reminder Notification Sent to Subscribers for [Scheduled Maintenance ${scheduledMaintenanceNumber}](${scheduledMaintenanceLink})**:
            
Reminder notification sent to status page subscribers for this scheduled maintenance event.`.toString();

      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
        scheduledMaintenanceId: event.id!,
        projectId: event.projectId!,
        scheduledMaintenanceFeedEventType:
          ScheduledMaintenanceFeedEventType.SubscriberNotificationSent,
        displayColor: notSentReason ? Yellow500 : Blue500,
        feedInfoInMarkdown: scheduledMaintenanceFeedText,
        moreInformationInMarkdown: notSentReason,
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
        return (
          ScheduledMaintenancePublication.isShown(event, now) &&
          !eventIdsNotReminded.has(event.id!.toString())
        );
      }),
    );
  },
);
