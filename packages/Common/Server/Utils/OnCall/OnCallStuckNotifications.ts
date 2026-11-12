import UserOnCallLogTimelineService from "../../Services/UserOnCallLogTimelineService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import {
  STUCK_NOTIFICATION_AFTER_MINUTES,
  STUCK_NOTIFICATION_STATUS_MESSAGE,
  writeNotificationStatusWhileStill,
} from "./OnCallNotificationStatus";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";

/*
 * NOTIFICATIONS THAT NEVER GOT A RESULT (issue #6873).
 *
 * A page writes each notification as Sending just before it is sent, and
 * the send writes how it went. A notification whose request to the
 * Notification service got no answer is left at Sending for the service's
 * own result (OnCallSendFailure) - and a service that went down with the
 * request never writes one. Nor does a send that stopped before its
 * request was made. So a notification still Sending
 * STUCK_NOTIFICATION_AFTER_MINUTES after it was written is settled: Error,
 * with STUCK_NOTIFICATION_STATUS_MESSAGE, over Sending only and at the
 * version read (OnCallNotificationStatus) - an acknowledgement or a result
 * landing meanwhile stays. A send that finishes later still writes its
 * result over that verdict (recordSendResult).
 *
 * Only notifications written in the last STUCK_NOTIFICATION_LOOK_BACK_HOURS
 * are read: what is older was left long before this check existed, or
 * while the workers were down, and its page is long over. The oldest first,
 * MAX_STUCK_NOTIFICATIONS_PER_RUN a run - a backlog is worked off over the
 * next runs. The read is served by a partial index of the notifications
 * that say Sending (UserOnCallLogTimeline), so a run with none due reads
 * next to nothing.
 *
 * Run every five minutes by the worker job of the same name
 * (Workers/Jobs/UserOnCallLog/SettleStuckNotifications.ts).
 */

export const STUCK_NOTIFICATION_CHECK_JOB_NAME: string =
  "UserOnCallLogTimeline:SettleStuckNotifications";

// How far back the check reads: a notification written before is left as it is.
export const STUCK_NOTIFICATION_LOOK_BACK_HOURS: number = 24;

// The most notifications one run settles.
export const MAX_STUCK_NOTIFICATIONS_PER_RUN: number = 500;

export interface StuckNotificationCheckSummary {
  // Read as still Sending past the limit.
  found: number;
  // Written as not sent.
  settled: number;
  // Not written, as something else landed first: a result, an acknowledgement.
  movedOn: number;
  // Could not be read or written.
  failed: number;
}

/*
 * Settles the notifications still Sending past the limit. Never throws for
 * one notification: each is written on its own, and one that fails is
 * logged and tried again by the next run. A failure to read them throws.
 */
export async function settleStuckNotifications(data?: {
  now?: Date | undefined;
}): Promise<StuckNotificationCheckSummary> {
  const now: Date = data?.now || OneUptimeDate.getCurrentDate();

  const stuckBefore: Date = OneUptimeDate.addRemoveMinutes(
    now,
    -STUCK_NOTIFICATION_AFTER_MINUTES,
  );

  const lookBackFrom: Date = OneUptimeDate.addRemoveHours(
    now,
    -STUCK_NOTIFICATION_LOOK_BACK_HOURS,
  );

  const stuckNotifications: Array<UserOnCallLogTimeline> =
    await UserOnCallLogTimelineService.findBy({
      query: {
        status: UserNotificationStatus.Sending,
        createdAt: QueryHelper.inBetween(lookBackFrom, stuckBefore),
      },
      select: {
        _id: true,
      },
      sort: {
        createdAt: SortOrder.Ascending,
      },
      skip: 0,
      limit: MAX_STUCK_NOTIFICATIONS_PER_RUN,
      props: {
        isRoot: true,
      },
    });

  const summary: StuckNotificationCheckSummary = {
    found: stuckNotifications.length,
    settled: 0,
    movedOn: 0,
    failed: 0,
  };

  for (const notification of stuckNotifications) {
    if (!notification.id) {
      continue;
    }

    try {
      const isWritten: boolean = await writeNotificationStatusWhileStill({
        userOnCallLogTimelineId: notification.id,
        from: [UserNotificationStatus.Sending],
        status: UserNotificationStatus.Error,
        statusMessage: STUCK_NOTIFICATION_STATUS_MESSAGE,
      });

      if (isWritten) {
        summary.settled++;
      } else {
        summary.movedOn++;
      }
    } catch (err) {
      summary.failed++;

      logger.error(
        `On-call notification ${notification.id.toString()}: could not settle it as not sent after ${STUCK_NOTIFICATION_AFTER_MINUTES} minutes at Sending: ${err}`,
      );
    }
  }

  if (summary.found > 0) {
    logger.info(
      `Stuck on-call notifications: ${summary.found} still Sending after ${STUCK_NOTIFICATION_AFTER_MINUTES} minutes, ${summary.settled} settled as not sent, ${summary.movedOn} moved on meanwhile, ${summary.failed} failed.`,
    );
  }

  return summary;
}
