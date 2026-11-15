import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import UserOnCallLogService from "Common/Server/Services/UserOnCallLogService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import {
  getUserOnCallLogHandedOverMessage,
  USER_LOG_TIMED_OUT_STATUS_MESSAGE,
} from "Common/Types/OnCallDutyPolicy/OnCallRunStart";

/*
 * How long a person's log may take to start, and how long after it was
 * written one that did not is still handed over to be sent.
 */
export const USER_LOG_START_TIMEOUT_IN_MINUTES: number = 5;
export const USER_LOG_HAND_OVER_WITHIN_MINUTES: number = 60;

/*
 * What a log handed over says while the person's-log worker sends it,
 * and what one that started too long ago to be handed over ends with:
 * written from OnCallRunStart, where the on-call logs read them back to
 * word them in the reader's language (#8434).
 */
export const USER_LOG_HANDED_OVER_STATUS_MESSAGE: string =
  getUserOnCallLogHandedOverMessage(USER_LOG_START_TIMEOUT_IN_MINUTES);

export { USER_LOG_TIMED_OUT_STATUS_MESSAGE };

/*
 * A person's log moves from Scheduled to Started to Executing in seconds,
 * as it is written: its "notify at once" rules are sent, and the
 * person's-log worker (UserOnCallLog:ExecutePendingExecutions) sends the
 * rest. One still Scheduled or Started after 5 minutes did not finish
 * starting: the process stopped as it started (a restart, a crash), or the
 * database failed its last write.
 *
 * It is handed to the worker (Executing), which sends what is left of it -
 * the person's rules still due, its "notify at once" ones among them - once
 * it has checked the record is still not acknowledged, and tries one that
 * keeps failing a few more times before it ends it (OnCallPolicyRunRetry).
 * A rule the start sent is not sent again: its claim is taken. A Started
 * one used to end in Error here, "Rule execution timed out.", and the
 * person was never paged by it (issue #8407); a Scheduled one was never
 * looked at again.
 *
 * Only one written within the last hour: one older did not start while
 * the workers were down for longer than that, and paging for it now could
 * be about something long over. A Started one ends in Error, as it always
 * did; a Scheduled one is left as it always was.
 *
 * We deliberately DO NOT time out "Executing" logs on wall-clock alone. An
 * Executing log stays Executing until its LAST staggered notification rule
 * fires — ExecutePendingExecutions skips rules whose notifyAfterMinutes has
 * not elapsed yet and only marks the log Completed once every rule has run.
 * notifyAfterMinutes has no upper bound, so a user with a last-resort channel
 * configured beyond 3 hours (e.g. "call at 240 min") legitimately stays
 * Executing that long. The previous 3-hour cutoff force-errored these healthy
 * logs and silently dropped the not-yet-fired rules, so the loudest
 * last-resort page was never made (audit F16).
 */
export const handOverStuckUserOnCallLogs: () => Promise<void> =
  async (): Promise<void> => {
    const startTimedOutBefore: Date = OneUptimeDate.getSomeMinutesAgo(
      USER_LOG_START_TIMEOUT_IN_MINUTES,
    );
    const handOverSince: Date = OneUptimeDate.getSomeMinutesAgo(
      USER_LOG_HAND_OVER_WITHIN_MINUTES,
    );

    const stuckLogs: Array<UserOnCallLog> =
      await UserOnCallLogService.findAllBy({
        query: {
          status: QueryHelper.any([
            UserNotificationExecutionStatus.Scheduled,
            UserNotificationExecutionStatus.Started,
          ]),
          createdAt: QueryHelper.inBetween(handOverSince, startTimedOutBefore),
        },
        select: {
          _id: true,
          status: true,
          createdAt: true,
        },
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const stuckLog of stuckLogs) {
      try {
        /*
         * By its id, so the escalation's line for the person follows it
         * (UserOnCallLogService.onUpdateSuccess). A start that finished in
         * the moment since it was read is handed over all the same: the
         * worker sends nothing its start sent - every rule sent is claimed.
         */
        await UserOnCallLogService.updateOneById({
          id: stuckLog.id!,
          data: {
            status: UserNotificationExecutionStatus.Executing,
            statusMessage: USER_LOG_HANDED_OVER_STATUS_MESSAGE,
          },
          props: {
            isRoot: true,
          },
        });

        logger.warn(
          `On-call log ${stuckLog.id?.toString()} was still ${stuckLog.status} ${USER_LOG_START_TIMEOUT_IN_MINUTES} minutes after it was written; handed to the person's-log worker to send its notifications.`,
        );
      } catch (err) {
        logger.error(
          `Could not hand stuck on-call log ${stuckLog.id?.toString()} to the person's-log worker; it is tried again next minute.`,
        );
        logger.error(err);
      }
    }

    // Started too long ago to page for now: it ends, as it always did.
    const timedOutLogs: Array<UserOnCallLog> =
      await UserOnCallLogService.findAllBy({
        query: {
          status: UserNotificationExecutionStatus.Started,
          createdAt: QueryHelper.lessThan(handOverSince),
        },
        select: {
          _id: true,
          createdAt: true,
        },
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const timedOutLog of timedOutLogs) {
      await UserOnCallLogService.updateOneById({
        id: timedOutLog.id!,
        data: {
          status: UserNotificationExecutionStatus.Error,
          statusMessage: USER_LOG_TIMED_OUT_STATUS_MESSAGE,
        },
        props: {
          isRoot: true,
        },
      });
    }
  };

RunCron(
  "UserOnCallLog:TimeoutStuckExecutions",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_MINUTE,
    runOnStartup: false,
  },
  handOverStuckUserOnCallLogs,
);
