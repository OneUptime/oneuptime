import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import WorkflowPlan from "Common/Types/Workflow/WorkflowPlan";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import ProjectService from "Common/Server/Services/ProjectService";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import { ExecuteWorkflowType } from "Common/Server/Types/Workflow/TriggerCode";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";

export default class QueueWorkflow {
  public static async removeWorkflow(workflowId: ObjectID): Promise<void> {
    // get workflow to see if its enabled.
    const workflow: Workflow | null = await WorkflowService.findOneById({
      id: workflowId,
      select: {
        projectId: true,
        repeatableJobKey: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!workflow) {
      throw new BadDataException("Workflow not found");
    }

    if (!workflow.projectId) {
      throw new BadDataException(
        "This workflow does not belong to a project and cannot be run",
      );
    }

    await Queue.removeJob(QueueName.Workflow, workflow.repeatableJobKey!);

    // update workflow.
    await WorkflowService.updateOneById({
      id: workflow.id!,
      data: {
        repeatableJobKey: null!,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
  }

  public static async addWorkflowToQueue(
    executeWorkflow: ExecuteWorkflowType,
    scheduleAt?: string,
    delay?: number,
  ): Promise<void> {
    const workflowId: ObjectID = executeWorkflow.workflowId;

    // get workflow to see if its enabled.
    const workflow: Workflow | null = await WorkflowService.findOneById({
      id: workflowId,
      select: {
        isEnabled: true,
        projectId: true,
        repeatableJobKey: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!workflow) {
      throw new BadDataException("Workflow not found");
    }

    if (!workflow.isEnabled) {
      throw new BadDataException("This workflow is not enabled");
    }

    if (!workflow.projectId) {
      throw new BadDataException(
        "This workflow does not belong to a project and cannot be run",
      );
    }

    //check project and plan
    const projectPlan: {
      plan: PlanType | null;
      isSubscriptionUnpaid: boolean;
    } = await ProjectService.getCurrentPlan(workflow.projectId);

    if (projectPlan.isSubscriptionUnpaid) {
      // Add Workflow Run Log.

      const runLog: WorkflowLog = new WorkflowLog();
      runLog.workflowId = workflowId;
      runLog.projectId = workflow.projectId;
      runLog.workflowStatus = WorkflowStatus.WorkflowCountExceeded;
      runLog.logs =
        OneUptimeDate.getCurrentDateAsFormattedString() +
        ": Workflow cannot run because subscription is unpaid.";

      await WorkflowLogService.create({
        data: runLog,
        props: {
          isRoot: true,
        },
      });

      return;
    }

    if (projectPlan.plan) {
      const startDate: Date = OneUptimeDate.getSomeDaysAgo(30);
      const endDate: Date = OneUptimeDate.getCurrentDate();

      const workflowCount: PositiveNumber = await WorkflowLogService.countBy({
        query: {
          projectId: workflow.projectId,
          createdAt: QueryHelper.inBetween(startDate, endDate),
        },
        props: {
          isRoot: true,
        },
      });

      if (workflowCount.toNumber() > WorkflowPlan[projectPlan.plan]) {
        // Add Workflow Run Log.

        const runLog: WorkflowLog = new WorkflowLog();
        runLog.workflowId = workflowId;
        runLog.projectId = workflow.projectId;
        runLog.workflowStatus = WorkflowStatus.WorkflowCountExceeded;
        runLog.logs =
          OneUptimeDate.getCurrentDateAsFormattedString() +
          `: Workflow cannot run because it already ran ${workflowCount.toNumber()} in the last 30 days. Your current plan limit is ${
            WorkflowPlan[projectPlan.plan]
          }`;

        await WorkflowLogService.create({
          data: runLog,
          props: {
            isRoot: true,
          },
        });

        return;
      }
    }

    // Add Workflow Run Log.
    let workflowLog: WorkflowLog | null = null;
    if (!scheduleAt && !delay) {
      // if the workflow is to be run immediately.
      const runLog: WorkflowLog = new WorkflowLog();
      runLog.workflowId = workflowId;
      runLog.projectId = workflow.projectId;
      runLog.workflowStatus = WorkflowStatus.Scheduled;
      runLog.logs =
        OneUptimeDate.getCurrentDateAsFormattedString() +
        `: Workflow ${workflowId.toString()} Scheduled.`;

      workflowLog = await WorkflowLogService.create({
        data: runLog,
        props: {
          isRoot: true,
        },
      });
    }

    const job: any = await Queue.addJob(
      QueueName.Workflow,
      workflowLog
        ? (workflowLog._id?.toString() as string)
        : (workflow._id?.toString() as string),
      workflowLog
        ? (workflowLog._id?.toString() as string)
        : (workflow._id?.toString() as string),
      {
        data: executeWorkflow.returnValues,
        workflowLogId: workflowLog?._id || null,
        workflowId: workflow._id,
      },
      {
        scheduleAt: scheduleAt,
        delay: delay,
        repeatableKey: workflow.repeatableJobKey || undefined,
      },
    );

    // update workflow with repeatable key.

    if (job.repeatJobKey) {
      // update workflow.
      await WorkflowService.updateOneById({
        id: workflow.id!,
        data: {
          repeatableJobKey: job.repeatJobKey,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    }
  }
}
