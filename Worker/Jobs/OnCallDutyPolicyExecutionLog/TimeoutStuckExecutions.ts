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

    // check for executing logs more than 3 hours ago and mark them as timed out.
    const stuckExecutingLogs: Array<OnCallDutyPolicyExecutionLog> =
      await OnCallDutyPolicyExecutionLogService.findAllBy({
        query: {
          status: OnCallDutyPolicyStatus.Executing,
          createdAt: QueryHelper.lessThan(OneUptimeDate.getSomeHoursAgo(3)),
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
      ...stuckExecutingLogs,
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
