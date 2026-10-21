import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import {
  ON_CALL_DIRECT_PAGE_NEVER_STARTED_MESSAGE,
  ON_CALL_DIRECT_PAGE_TIMED_OUT_MESSAGE,
  isOnCallDirectPage,
} from "Common/Types/OnCallDutyPolicy/OnCallDirectPage";

/**
 * Jobs move from Started to Executing in seconds. If it takes more than 5 minutes, it's stuck. So, mark them as error
 */

RunCron(
  "OnCallDutyPolicyExecutionLog:TimeoutStuckExecutions",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    // get all pending on-call executions and execute them all at once.
    const fiveMinsAgo: Date = OneUptimeDate.getSomeMinutesAgo(5);

    /*
     * A log sits in "Started" only for the brief moment between creation and the
     * first rule beginning to execute. If it is still "Started" after 5 minutes
     * it is genuinely stuck, so we time it out.
     *
     * We deliberately DO NOT time out "Executing" logs on wall-clock alone. An
     * Executing log is a live, in-progress escalation: ExecutePendingExecutions
     * advances it every minute and marks it Completed once the alert/incident is
     * acknowledged/resolved or all escalation rules and repeats are exhausted.
     * A policy with several rules and repeat cycles can legitimately stay
     * Executing for many hours; the previous 3-hour cutoff force-errored these
     * healthy escalations and silently dropped every remaining rule/repeat,
     * meaning later responders were never paged for an unacknowledged incident.
     */
    const startedExecutions: Array<OnCallDutyPolicyExecutionLog> =
      await OnCallDutyPolicyExecutionLogService.findAllBy({
        query: {
          status: OnCallDutyPolicyStatus.Started,
          createdAt: QueryHelper.lessThan(fiveMinsAgo),
        },
        select: {
          _id: true,
          createdAt: true,
          // Whether it is a policy's run or a direct page, for what it is told.
          onCallDutyPolicyId: true,
          pagingStartsAt: true,
        },
        props: {
          isRoot: true,
        },
      });

    /*
     * A run that waited to page (OnCallDutyPolicyRunWait) - held until
     * working hours, for hours or days - was created long before it starts:
     * it is started from Waiting, and its pagingStartsAt is the moment it
     * was. It is stuck only five minutes after that, not at once. A Waiting
     * run itself is not read here at all: it is not stuck, it waits.
     */
    const stuckExecutions: Array<OnCallDutyPolicyExecutionLog> =
      startedExecutions.filter(
        (executionLog: OnCallDutyPolicyExecutionLog): boolean => {
          return isStartedLongerThan(executionLog, fiveMinsAgo);
        },
      );

    /*
     * A log is created in "Scheduled" and advanced to "Started" inside the
     * create-success hook. If the worker crashes (or a create-hook await throws)
     * after the row is committed but before the status flips, the log stays
     * "Scheduled" forever: ExecutePendingExecutions only processes "Executing"
     * and the reaper above only covers "Started", so the escalation would never
     * run and no error would ever surface (audit F14). Time these out too so the
     * stuck state becomes a visible Error instead of silently swallowing the
     * page. Once a healthy log leaves Scheduled within seconds it drops out of
     * this set, so the 5-minute cutoff only ever catches genuinely stuck rows.
     */
    const scheduledStuckExecutions: Array<OnCallDutyPolicyExecutionLog> =
      await OnCallDutyPolicyExecutionLogService.findAllBy({
        query: {
          status: OnCallDutyPolicyStatus.Scheduled,
          createdAt: QueryHelper.lessThan(fiveMinsAgo),
        },
        select: {
          _id: true,
          createdAt: true,
          onCallDutyPolicyId: true,
        },
        props: {
          isRoot: true,
        },
      });

    for (const executionLog of stuckExecutions) {
      await OnCallDutyPolicyExecutionLogService.updateOneById({
        id: executionLog.id!,
        data: {
          status: OnCallDutyPolicyStatus.Error,
          statusMessage: isOnCallDirectPage(executionLog)
            ? ON_CALL_DIRECT_PAGE_TIMED_OUT_MESSAGE
            : "Policy Execution timed out.",
        },
        props: {
          isRoot: true,
        },
      });
    }

    for (const executionLog of scheduledStuckExecutions) {
      await OnCallDutyPolicyExecutionLogService.updateOneById({
        id: executionLog.id!,
        data: {
          status: OnCallDutyPolicyStatus.Error,
          statusMessage: isOnCallDirectPage(executionLog)
            ? ON_CALL_DIRECT_PAGE_NEVER_STARTED_MESSAGE
            : "Policy Execution never started (stuck in Scheduled) and was timed out.",
        },
        props: {
          isRoot: true,
        },
      });
    }
  },
);

/*
 * Whether a run in Started began starting before `before`: when it was
 * created, or - for a run that waited to page - when its paging started.
 */
function isStartedLongerThan(
  executionLog: OnCallDutyPolicyExecutionLog,
  before: Date,
): boolean {
  if (!executionLog.pagingStartsAt) {
    return true;
  }

  const pagingStartedAt: Date = OneUptimeDate.fromString(
    executionLog.pagingStartsAt,
  );

  if (isNaN(pagingStartedAt.getTime())) {
    return true;
  }

  return OneUptimeDate.isBefore(pagingStartedAt, before);
}
