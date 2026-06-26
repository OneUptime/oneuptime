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

    /*
     * Fail runs that have been Waiting (suspended by a Sleep step) well past
     * their scheduled resume time. This guards against a dropped/lost delayed
     * resume job (e.g. Redis was flushed) leaving a run parked forever. The 10
     * minute grace beyond resumeAt avoids racing the normal resume.
     */
    const stuckWaitingWorkflowLogs: Array<WorkflowLog> =
      await WorkflowLogService.findAllBy({
        query: {
          workflowStatus: WorkflowStatus.Waiting,
          resumeAt: QueryHelper.lessThan(OneUptimeDate.getSomeMinutesAgo(10)),
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

    for (const stuckWaitingWorkflowLog of stuckWaitingWorkflowLogs) {
      await WorkflowLogService.updateOneById({
        id: stuckWaitingWorkflowLog.id!,
        data: {
          workflowStatus: WorkflowStatus.Error,
          completedAt: OneUptimeDate.getCurrentDate(),
          resumeData: null!,
          resumeAt: null!,
          logs: `${
            stuckWaitingWorkflowLog.logs
          } \n ${OneUptimeDate.getCurrentDateAsFormattedString({
            showSeconds: true,
          })}: Workflow was waiting to resume but the resume job was not picked up in time. Marking as failed.`,
        },
        props: {
          isRoot: true,
        },
      });
    }
  },
);
