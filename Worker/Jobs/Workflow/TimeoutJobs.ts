import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";

RunCron(
  "Workflow:TimeoutJobs",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // Timeout all workflows that have been scheduled for more than 5 minutes
    const stalledWorkflowLogs: Array<WorkflowLog> =
      await WorkflowLogService.findAllBy({
        query: {
          createdAt: QueryHelper.lessThan(OneUptimeDate.getSomeMinutesAgo(5)),
          workflowStatus: WorkflowStatus.Scheduled,
        },
        select: {
          logs: true,
          _id: true,
        },
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const stalledWorkflowLog of stalledWorkflowLogs) {
      await WorkflowLogService.updateOneById({
        id: stalledWorkflowLog.id!,
        data: {
          workflowStatus: WorkflowStatus.Error,
          logs: `${
            stalledWorkflowLog.logs
          } \n ${OneUptimeDate.getCurrentDateAsFormattedString({
            showSeconds: true,
          })}: Workflow was not picked up by the runner and has timed out.`,
        },
        props: {
          isRoot: true,
        },
      });
    }
  },
);
