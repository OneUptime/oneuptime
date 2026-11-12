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

/*
 * NOTIFICATIONS LEFT SENDING BEFORE THE CHECK EXISTED (issue #7085).
 *
 * The check reads the last STUCK_NOTIFICATION_LOOK_BACK_HOURS only. A
 * notification left at Sending longer ago than that - on a server that ran
 * before the check existed, through a Notification service restart - is
 * never read by it, and says Sending for ever on the person's on-call
 * timeline and in the policy's execution log, though nothing will write it
 * again. They are settled once, as the server is upgraded (the data
 * migration SettleOnCallNotificationsStuckBeforeUpgrade): Error, with the
 * check's own verdict (STUCK_NOTIFICATION_STATUS_MESSAGE), the oldest
 * first, MAX_SETTLED_BEFORE_THE_CHECK_PER_STATEMENT a statement, to the
 * last. What is newer is left to the check.
 *
 * Written straight to the table, with no hooks: their pages are long over,
 * and the hooks would tell the record's feed, and edit the run's chat
 * message, about each of them now. Over Sending only, in the same
 * statement - a notification that moved on meanwhile stays as it is - with
 * its version moved on, as any write moves it, so a write that read it
 * before finds it changed (OnCallNotificationStatus). The read is served
 * by the partial index of the notifications that say Sending. Idempotent:
 * a second run finds none.
 */
export const MAX_SETTLED_BEFORE_THE_CHECK_PER_STATEMENT: number = 1000;

export interface NotificationsSettledBeforeTheCheckSummary {
  // Read as still Sending, written before the check's look-back.
  found: number;
  // Written as not sent.
  settled: number;
  // How many statements it took.
  statements: number;
}

interface SettledPageRow {
  found: string | number;
  settled: string | number;
}

// Taken from the service, so whoever calls this resolves no typeorm of its own.
type TimelineRepository = ReturnType<
  (typeof UserOnCallLogTimelineService)["getRepository"]
>;

/*
 * Settles every notification still Sending that was written before the
 * check's look-back (see above). A failure to read or write them throws:
 * the data migration that runs it is tried again.
 */
export async function settleNotificationsStuckBeforeTheCheck(data?: {
  now?: Date | undefined;
  // How many a statement settles: MAX_SETTLED_BEFORE_THE_CHECK_PER_STATEMENT.
  perStatement?: number | undefined;
}): Promise<NotificationsSettledBeforeTheCheckSummary> {
  const now: Date = data?.now || OneUptimeDate.getCurrentDate();
  const perStatement: number =
    data?.perStatement || MAX_SETTLED_BEFORE_THE_CHECK_PER_STATEMENT;

  const writtenBefore: Date = OneUptimeDate.addRemoveHours(
    now,
    -STUCK_NOTIFICATION_LOOK_BACK_HOURS,
  );

  const repository: TimelineRepository =
    UserOnCallLogTimelineService.getRepository();
  const tableName: string = repository.metadata.tableName;

  const summary: NotificationsSettledBeforeTheCheckSummary = {
    found: 0,
    settled: 0,
    statements: 0,
  };

  /*
   * The statuses as literals, as the partial index names Sending: a
   * parameter would leave the planner unable to tell the index serves it.
   */
  const sending: string = UserNotificationStatus.Sending;
  const error: string = UserNotificationStatus.Error;

  for (;;) {
    const rows: Array<SettledPageRow> = (await repository.manager.query(
      `WITH "page" AS (
         SELECT "_id" FROM "${tableName}"
         WHERE "status" = '${sending}' AND "deletedAt" IS NULL AND "createdAt" < $1
         ORDER BY "createdAt" ASC
         LIMIT $2
       ), "settled" AS (
         UPDATE "${tableName}" AS "notification"
         SET "status" = '${error}', "statusMessage" = $3, "version" = "notification"."version" + 1, "updatedAt" = now()
         FROM "page"
         WHERE "notification"."_id" = "page"."_id" AND "notification"."status" = '${sending}' AND "notification"."deletedAt" IS NULL
         RETURNING "notification"."_id"
       )
       SELECT (SELECT COUNT(*) FROM "page") AS "found", (SELECT COUNT(*) FROM "settled") AS "settled"`,
      [writtenBefore, perStatement, STUCK_NOTIFICATION_STATUS_MESSAGE],
    )) as Array<SettledPageRow>;

    const found: number = Number(rows[0]?.found || 0);
    const settled: number = Number(rows[0]?.settled || 0);

    summary.statements++;
    summary.found += found;
    summary.settled += settled;

    /*
     * A page that was not full was the last. Each statement after a full
     * one has to settle some, so the walk always ends: a page that settled
     * none - every notification of it moved on as it was written - ends it.
     */
    if (found < perStatement || settled === 0) {
      break;
    }
  }

  logger.info(
    `On-call notifications left Sending before the stuck check existed: ${summary.found} written more than ${STUCK_NOTIFICATION_LOOK_BACK_HOURS} hours ago, ${summary.settled} settled as not sent.`,
  );

  return summary;
}
