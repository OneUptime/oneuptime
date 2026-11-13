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
 * are read here, through the full update pipeline: their pages may still
 * be going on, so the hooks tell the record's feed and the run's chat
 * message. What is older - left while the workers were down for more than
 * a day, or before this check existed - has a page that is long over, and
 * is settled straight to the table by settleNotificationsStuckBeforeTheCheck
 * below, in the same run (runStuckNotificationCheck, issue #7290). The
 * oldest first, MAX_STUCK_NOTIFICATIONS_PER_RUN a run - a backlog is worked
 * off over the next runs, and what ages out of the look-back meanwhile is
 * settled with the older ones. The read is served by a partial index of the
 * notifications that say Sending (UserOnCallLogTimeline), so a run with
 * none due reads next to nothing.
 *
 * Run every five minutes by the worker job of the same name
 * (Workers/Jobs/UserOnCallLog/SettleStuckNotifications.ts), through
 * runStuckNotificationCheck.
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
 * NOTIFICATIONS STILL SENDING FROM BEFORE THE CHECK'S LOOK-BACK (issues
 * #7085, #7290).
 *
 * The check reads the last STUCK_NOTIFICATION_LOOK_BACK_HOURS only. A
 * notification left at Sending longer ago than that is never read by it,
 * and would say Sending for ever on the person's on-call timeline and in
 * the policy's execution log, though nothing will write it again: one left
 * on a server that ran before the check existed, through a Notification
 * service restart (#7085), and one whose check did not run for more than a
 * day after it was written - the workers down, the job queue stalled, a
 * long maintenance window (#7290). They are settled here: Error, with the
 * check's own verdict (STUCK_NOTIFICATION_STATUS_MESSAGE) - it is as true
 * a day later, and a send that finishes after all still writes its result
 * over it (isSettledAsStuck) - the oldest first,
 * MAX_SETTLED_BEFORE_THE_CHECK_PER_STATEMENT a statement, to the last. What
 * is newer is left to the check.
 *
 * Run by every run of the stuck check, right after it and as of the same
 * time (runStuckNotificationCheck), so the two meet where the look-back
 * starts and nothing falls between them; and once as the server is
 * upgraded, by the data migration SettleOnCallNotificationsStuckBeforeUpgrade.
 * Every run, not once a day: the partial index holds only the notifications
 * that say Sending - those of the last few minutes - so a statement with
 * none to settle reads a page or two of that index, finds nothing and
 * reads no notification (pinned on Postgres), and a notification the
 * workers left behind is settled within five minutes of their return.
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
 * the next run of the check, or the data migration that runs it, tries
 * again. Says how many it settled only when it found any: a run of the
 * check finds none nearly always.
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

  /*
   * The write says the page's cut-off again. It changes nothing it writes -
   * every notification of the page was written before it - but the planner
   * may drive the write from the partial index instead of from the page,
   * and without the cut-off that read every notification still Sending,
   * those still going out included, on every run (issue #7290). With it,
   * either way, a run with none to settle reads a page of the index and
   * finds nothing.
   */
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
         WHERE "notification"."_id" = "page"."_id" AND "notification"."status" = '${sending}' AND "notification"."deletedAt" IS NULL AND "notification"."createdAt" < $1
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

  if (summary.found > 0) {
    logger.info(
      `On-call notifications still Sending more than ${STUCK_NOTIFICATION_LOOK_BACK_HOURS} hours after they were written: ${summary.found} found, ${summary.settled} settled as not sent.`,
    );
  }

  return summary;
}

/*
 * ONE RUN OF THE STUCK CHECK (issue #7290): the notifications still Sending
 * past STUCK_NOTIFICATION_AFTER_MINUTES that were written within the
 * look-back, through the full update pipeline (settleStuckNotifications),
 * then those written before it, straight to the table
 * (settleNotificationsStuckBeforeTheCheck) - both as of the same time, so
 * every notification still Sending 15 minutes after it was written is
 * settled by one or the other, whenever the check last ran.
 *
 * One failing never keeps the other from running: each is tried, a failure
 * is logged, and the run then throws the first failure, so the job is a
 * failed job and its next run tries again.
 */
export interface StuckNotificationCheckRunSummary {
  // Written within the look-back: settled through the full update pipeline.
  withinTheLookBack: StuckNotificationCheckSummary;
  // Written before it: settled straight to the table.
  beforeTheLookBack: NotificationsSettledBeforeTheCheckSummary;
}

// What one part of a run came to: what it returned, or what it threw.
type PartOfARun<T> =
  | { isDone: true; value: T }
  | { isDone: false; error: unknown };

async function runPartOfARun<T>(data: {
  run: () => Promise<T>;
  // Which notifications the part settles, as the log names them.
  which: string;
}): Promise<PartOfARun<T>> {
  try {
    return { isDone: true, value: await data.run() };
  } catch (err) {
    logger.error(
      `Stuck on-call notifications: could not settle those written ${data.which}: ${err}`,
    );

    return { isDone: false, error: err };
  }
}

export async function runStuckNotificationCheck(data?: {
  now?: Date | undefined;
}): Promise<StuckNotificationCheckRunSummary> {
  const now: Date = data?.now || OneUptimeDate.getCurrentDate();

  const withinTheLookBack: PartOfARun<StuckNotificationCheckSummary> =
    await runPartOfARun({
      run: (): Promise<StuckNotificationCheckSummary> => {
        return settleStuckNotifications({ now: now });
      },
      which: `in the last ${STUCK_NOTIFICATION_LOOK_BACK_HOURS} hours`,
    });

  const beforeTheLookBack: PartOfARun<NotificationsSettledBeforeTheCheckSummary> =
    await runPartOfARun({
      run: (): Promise<NotificationsSettledBeforeTheCheckSummary> => {
        return settleNotificationsStuckBeforeTheCheck({ now: now });
      },
      which: `more than ${STUCK_NOTIFICATION_LOOK_BACK_HOURS} hours ago`,
    });

  if (!withinTheLookBack.isDone) {
    throw withinTheLookBack.error;
  }

  if (!beforeTheLookBack.isDone) {
    throw beforeTheLookBack.error;
  }

  return {
    withinTheLookBack: withinTheLookBack.value,
    beforeTheLookBack: beforeTheLookBack.value,
  };
}
