import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import CronTab from "Common/Utils/CronTab";
import WorkflowPlan from "Common/Types/Workflow/WorkflowPlan";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import ProjectService from "Common/Server/Services/ProjectService";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import WorkflowVariableService from "Common/Server/Services/WorkflowVariableService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import { ExecuteWorkflowType } from "Common/Server/Types/Workflow/TriggerCode";
import VMAPI from "Common/Server/Utils/VM/VMAPI";
import logger from "Common/Server/Utils/Logger";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";

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

    /*
     * Resolve the cron pattern for scheduled workflows. The "Schedule at" value
     * can reference workflow variables (e.g. {{local.variables.schedule}} or
     * {{global.variables.cron}}). Those are only substituted at run time by the
     * runner, but the cron pattern is needed *here* at registration time to
     * create the BullMQ repeatable job. So we resolve variables now, using the
     * workflow's own local + global variables, and validate the result. An
     * unresolved or invalid pattern is surfaced as a workflow log error instead
     * of being handed to BullMQ (which would reject it and stop the workflow
     * from ever firing, silently).
     */
    let resolvedScheduleAt: string | undefined = scheduleAt;

    if (scheduleAt) {
      const resolution: { cron: string; error: string | null } =
        await QueueWorkflow.resolveScheduleCron(
          workflow.projectId,
          workflowId,
          scheduleAt,
        );

      if (resolution.error) {
        const runLog: WorkflowLog = new WorkflowLog();
        runLog.workflowId = workflowId;
        runLog.projectId = workflow.projectId;
        runLog.workflowStatus = WorkflowStatus.Error;
        runLog.logs =
          OneUptimeDate.getCurrentDateAsFormattedString({
            showSeconds: true,
          }) + `: Workflow could not be scheduled. ${resolution.error}`;

        await WorkflowLogService.create({
          data: runLog,
          props: {
            isRoot: true,
          },
        });

        logger.error(
          `Workflow ${workflowId.toString()} could not be scheduled: ${
            resolution.error
          }`,
        );

        return;
      }

      resolvedScheduleAt = resolution.cron;
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
        OneUptimeDate.getCurrentDateAsFormattedString({
          showSeconds: true,
        }) + ": Workflow cannot run because subscription is unpaid.";

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
          OneUptimeDate.getCurrentDateAsFormattedString({
            showSeconds: true,
          }) +
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
    if (!scheduleAt) {
      // if the workflow is to be run immediately.
      const runLog: WorkflowLog = new WorkflowLog();
      runLog.workflowId = workflowId;
      runLog.projectId = workflow.projectId;
      runLog.workflowStatus = WorkflowStatus.Scheduled;
      runLog.logs =
        OneUptimeDate.getCurrentDateAsFormattedString({
          showSeconds: true,
        }) + `: Workflow ${workflowId.toString()} Scheduled.`;

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
        callChain: executeWorkflow.callChain || [],
      },
      {
        scheduleAt: resolvedScheduleAt,
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

  /**
   * Resolves the "Schedule at" cron pattern for a scheduled workflow.
   *
   * The pattern may reference workflow variables, e.g.
   * `{{local.variables.schedule}}` or `* /{{global.variables.hours}} * * *`.
   * Variables are substituted here (at registration time) from the workflow's
   * own local variables and its project's global variables, because BullMQ
   * needs a concrete cron pattern to register the repeatable job — the runner's
   * run-time variable substitution happens too late for scheduling.
   *
   * Returns the concrete cron on success, or a human-readable `error` when the
   * pattern is still unresolved (a referenced variable is missing) or is not a
   * valid cron expression. Callers should surface the error rather than pass an
   * invalid pattern to BullMQ.
   */
  private static async resolveScheduleCron(
    projectId: ObjectID,
    workflowId: ObjectID,
    rawSchedule: string,
  ): Promise<{ cron: string; error: string | null }> {
    let localVariables: Array<WorkflowVariable> = [];
    let globalVariables: Array<WorkflowVariable> = [];

    try {
      localVariables = await WorkflowVariableService.findBy({
        query: {
          workflowId: workflowId,
        },
        select: {
          name: true,
          content: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

      globalVariables = await WorkflowVariableService.findBy({
        query: {
          workflowId: QueryHelper.isNull(),
          projectId: projectId,
        },
        select: {
          name: true,
          content: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error(err);
      return {
        cron: rawSchedule,
        error: `Failed to resolve schedule variables for "${rawSchedule}".`,
      };
    }

    const localVariableMap: Record<string, string> = {};
    for (const variable of localVariables) {
      localVariableMap[variable.name as string] = variable.content as string;
    }

    const globalVariableMap: Record<string, string> = {};
    for (const variable of globalVariables) {
      globalVariableMap[variable.name as string] = variable.content as string;
    }

    return QueueWorkflow.buildScheduleCronFromVariables(
      rawSchedule,
      localVariableMap,
      globalVariableMap,
    );
  }

  /**
   * Substitutes {{local.variables.*}} / {{global.variables.*}} references in a
   * schedule cron using the supplied variable maps, then validates the concrete
   * cron. Side-effect free (no database access) so the resolution + validation
   * behavior can be unit-tested directly.
   *
   * Returns the concrete cron on success, or a human-readable `error` when the
   * pattern is still unresolved (a referenced variable is missing) or is not a
   * valid cron expression.
   */
  public static buildScheduleCronFromVariables(
    rawSchedule: string,
    localVariables: Record<string, string>,
    globalVariables: Record<string, string>,
  ): { cron: string; error: string | null } {
    const storageMap: {
      local: { variables: Record<string, string> };
      global: { variables: Record<string, string> };
    } = {
      local: { variables: localVariables },
      global: { variables: globalVariables },
    };

    let resolved: string = rawSchedule;

    try {
      resolved = VMAPI.replaceValueInPlace(
        storageMap as any,
        rawSchedule,
        false,
      );
    } catch (err) {
      logger.error(err);
      return {
        cron: rawSchedule,
        error: `Failed to resolve schedule variables for "${rawSchedule}".`,
      };
    }

    resolved = (resolved || "").toString().trim();

    if (CronTab.isVariableExpression(resolved)) {
      return {
        cron: resolved,
        error: `The schedule "${rawSchedule}" references a variable that could not be resolved. Make sure the referenced workflow or global variable exists and contains a valid cron expression.`,
      };
    }

    const validationError: string | null = CronTab.getValidationError(resolved);

    if (validationError) {
      const resolvedNote: string =
        resolved === rawSchedule ? "" : ` (resolved to "${resolved}")`;

      return {
        cron: resolved,
        error: `The schedule "${rawSchedule}"${resolvedNote} is not a valid cron expression. ${validationError}`,
      };
    }

    return {
      cron: resolved,
      error: null,
    };
  }

  /**
   * Re-enqueue an in-flight workflow run after a Sleep step, to be resumed once
   * the delay elapses.
   *
   * Unlike `addWorkflowToQueue`, this does NOT create a new WorkflowLog (the
   * run continues on the same log) and does NOT re-check plan limits — the run
   * was already counted when it first started. The execution state to resume
   * from is persisted on the WorkflowLog row (`resumeData`).
   *
   * The job id is suffixed with `jobIdDiscriminator` so it never collides with
   * the currently-executing job (whose id is the bare workflowLogId) nor with
   * resume jobs from earlier Sleep steps in the same run.
   */
  public static async addResumeJobToQueue(props: {
    workflowId: ObjectID;
    workflowLogId: ObjectID;
    delayInMs: number;
    jobIdDiscriminator: string;
  }): Promise<void> {
    const workflowLogIdStr: string = props.workflowLogId.toString();

    await Queue.addJob(
      QueueName.Workflow,
      `${workflowLogIdStr}-resume-${props.jobIdDiscriminator}`,
      `${workflowLogIdStr}-resume`,
      {
        data: {},
        workflowId: props.workflowId.toString(),
        workflowLogId: workflowLogIdStr,
        isResume: true,
      },
      {
        delayInMs: props.delayInMs,
      },
    );
  }
}
