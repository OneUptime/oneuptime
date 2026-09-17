import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import UserOnCallLogService from "Common/Server/Services/UserOnCallLogService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";

/**
 * Jobs move from Started to Executing in seconds. If it takes more than 5 minutes, it's stuck. So, mark them as error
 */

RunCron(
  "UserOnCallLog:TimeoutStuckExecutions",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    // get all pending on-call executions and execute them all at once.
    const fiveMinsAgo: Date = OneUptimeDate.getSomeMinutesAgo(5);

    /*
     * A log sits in "Started" only for the brief moment between creation and the
     * first notification rule beginning to execute. If it is still "Started"
     * after 5 minutes it is genuinely stuck, so we time it out.
     *
     * We deliberately DO NOT time out "Executing" logs on wall-clock alone. An
     * Executing log stays Executing until its LAST staggered notification rule
     * fires — ExecutePendingExecutions skips rules whose notifyAfterMinutes has
     * not elapsed yet and only marks the log Completed once every rule has run.
     * notifyAfterMinutes has no upper bound, so a user with a last-resort channel
     * configured beyond 3 hours (e.g. "call at 240 min") legitimately stays
     * Executing that long. The previous 3-hour cutoff force-errored these healthy
     * logs and silently dropped the not-yet-fired rules, so the loudest
     * last-resort page was never made (audit F16). This mirrors the sibling
     * OnCallDutyPolicyExecutionLog:TimeoutStuckExecutions, which only reaps
     * "Started".
     */
    const stuckExecutions: Array<UserOnCallLog> =
      await UserOnCallLogService.findAllBy({
        query: {
          status: UserNotificationExecutionStatus.Started,
          createdAt: QueryHelper.lessThan(fiveMinsAgo),
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

    for (const executionLog of stuckExecutions) {
      await UserOnCallLogService.updateOneById({
        id: executionLog.id!,
        data: {
          status: UserNotificationExecutionStatus.Error,
          statusMessage: "Rule execution timed out.",
        },
        props: {
          isRoot: true,
        },
      });
    }
  },
);
