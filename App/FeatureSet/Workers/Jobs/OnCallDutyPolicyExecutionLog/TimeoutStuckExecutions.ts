import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";

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
    const stuckExecutions: Array<OnCallDutyPolicyExecutionLog> =
      await OnCallDutyPolicyExecutionLogService.findAllBy({
        query: {
          status: OnCallDutyPolicyStatus.Started,
          createdAt: QueryHelper.lessThan(fiveMinsAgo),
        },
        select: {
          _id: true,
          createdAt: true,
        },
        props: {
          isRoot: true,
        },
      });

    const totalStuckExecutions: Array<OnCallDutyPolicyExecutionLog> = [
      ...stuckExecutions,
    ];

    for (const executionLog of totalStuckExecutions) {
      await OnCallDutyPolicyExecutionLogService.updateOneById({
        id: executionLog.id!,
        data: {
          status: OnCallDutyPolicyStatus.Error,
          statusMessage: "Policy Execution timed out.",
        },
        props: {
          isRoot: true,
        },
      });
    }
  },
);
