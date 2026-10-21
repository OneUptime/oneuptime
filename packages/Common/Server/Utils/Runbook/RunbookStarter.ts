import ProjectService from "../../Services/ProjectService";
import RunbookExecutionService from "../../Services/RunbookExecutionService";
import RunbookService from "../../Services/RunbookService";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RunbookExecutionStatus from "../../../Types/Runbook/RunbookExecutionStatus";
import { RunbookStep } from "../../../Types/Runbook/RunbookStep";
import { moveApprovalsBeforeTheirSteps } from "../../../Types/Runbook/RunbookStepApproval";
import { RunbookStepExecutionState } from "../../../Types/Runbook/RunbookStepExecution";
import RunbookStepExecutionStatus from "../../../Types/Runbook/RunbookStepExecutionStatus";
import RunbookTriggerType, {
  UNATTENDED_RUNBOOK_TRIGGER_TYPES,
} from "../../../Types/Runbook/RunbookTriggerType";
import { hasRunbookInputs } from "../../../Types/Runbook/RunbookInputs";

/*
 * THE ONE WAY A RUNBOOK RUN STARTS.
 *
 * Every trigger - a person (the run routes), a runbook rule, an
 * auto-remediation rule, OneUptime AI, the runbook's schedule and its
 * webhook - starts a run through start(), which:
 *
 *   - reads the runbook as OneUptime, and refuses one that is not the
 *     project's, is turned off (isEnabled), or has no steps;
 *   - refuses a run nobody is watching (a schedule, a webhook) for a project
 *     a master admin has blocked, as a blocked project's workflows are;
 *   - snapshots the steps into a new execution, recording what started it
 *     (triggerType, triggerDetails), the person if there was one, the
 *     incident, alert or maintenance event it is for, and the values it was
 *     started with (inputs);
 *   - queues it for a Worker. A run that could not be queued is failed at
 *     once with the reason, never left Scheduled with nothing to start it.
 *
 * Who may start which runbook is the caller's to decide before it gets here
 * (RunbookRunAccess for a person, the webhook's secret key, the rule the
 * project set up): this runs as OneUptime.
 *
 * The queue lives in the App (QueueRunbook), so the Runbook feature set
 * hands its enqueuer over when it starts (registerEnqueuer), as it did to
 * the rule engine before this existed.
 */

export type RunbookExecutionEnqueuer = (data: {
  runbookExecutionId: ObjectID;
}) => Promise<void>;

export enum RunbookStartRefusal {
  // No such runbook, or another project's.
  NotFound = "NotFound",
  // Its "Run this runbook" switch is off.
  TurnedOff = "TurnedOff",
  NoSteps = "NoSteps",
  // A schedule or a webhook, in a project a master admin blocked.
  ProjectBlocked = "ProjectBlocked",
  // The run was written but could not be queued; it is failed with the reason.
  NotQueued = "NotQueued",
}

// What a run that could not be queued says, as its failure reason.
export const RUNBOOK_RUN_NOT_QUEUED_REASON: string =
  "OneUptime could not queue this run, so none of its steps ran. Run the runbook again.";

export interface RunbookStartRequest {
  projectId: ObjectID;
  runbookId: ObjectID;
  trigger: RunbookTriggerType;
  // The person who started it, or who approved what started it.
  triggeredByUserId?: ObjectID | undefined;
  // The incident, alert or scheduled maintenance event the run is for.
  linkage?:
    | {
        incidentId?: ObjectID | undefined;
        alertId?: ObjectID | undefined;
        scheduledMaintenanceId?: ObjectID | undefined;
      }
    | undefined;
  // The values a webhook call sent (Types/Runbook/RunbookInputs), already read.
  inputs?: JSONObject | undefined;
  // More about the trigger: a scheduled time, a caller's address.
  triggerDetails?: JSONObject | undefined;
  /*
   * The runbook, when the caller has just read it with RUNBOOK_START_SELECT
   * as OneUptime (the webhook route reads it to check the key), so it is
   * not read twice.
   */
  runbook?: Runbook | undefined;
}

export type RunbookStartResult =
  | { isStarted: true; execution: RunbookExecution }
  | {
      isStarted: false;
      refusal: RunbookStartRefusal;
      // The run that was written but not queued (NotQueued), failed.
      execution?: RunbookExecution | undefined;
    };

// What start() reads of a runbook.
export const RUNBOOK_START_SELECT: {
  _id: true;
  projectId: true;
  name: true;
  steps: true;
  isEnabled: true;
} = {
  _id: true,
  projectId: true,
  name: true,
  steps: true,
  isEnabled: true,
};

export class RunbookStarterClass {
  private enqueue: RunbookExecutionEnqueuer | null = null;

  public registerEnqueuer(enqueue: RunbookExecutionEnqueuer): void {
    this.enqueue = enqueue;
  }

  public hasEnqueuer(): boolean {
    return this.enqueue !== null;
  }

  /*
   * The runbook's steps, in order, each waiting to run - with every approval
   * before the step it holds back: an approval a client still writes after
   * a step (requireApproval) is read as one before the next step, or as a
   * Manual step at the end after the last one (RunbookStepApproval). So no
   * run started now carries the old flag; only runs started before
   * approvals moved do, and the execution loop still stops after such a
   * step for them.
   */
  public static getStepExecutions(
    steps: unknown,
  ): Array<RunbookStepExecutionState> {
    const list: Array<RunbookStep> = moveApprovalsBeforeTheirSteps(steps);

    return list
      .slice()
      .sort((a: RunbookStep, b: RunbookStep) => {
        return (Number(a.order) || 0) - (Number(b.order) || 0);
      })
      .map((step: RunbookStep): RunbookStepExecutionState => {
        return {
          step,
          status: RunbookStepExecutionStatus.Pending,
        };
      });
  }

  /*
   * The execution a start writes, before it is written: the steps
   * snapshotted, Scheduled, and everything the request says about how it
   * started.
   */
  public static buildExecution(data: {
    runbook: Runbook;
    request: RunbookStartRequest;
  }): RunbookExecution {
    const execution: RunbookExecution = new RunbookExecution();

    execution.projectId = data.request.projectId;
    execution.runbookId = new ObjectID(data.runbook._id!.toString());
    execution.runbookNameSnapshot = data.runbook.name || "Runbook";
    execution.status = RunbookExecutionStatus.Scheduled;
    execution.stepExecutions = RunbookStarterClass.getStepExecutions(
      data.runbook.steps,
    ) as unknown as JSONArray;
    execution.triggerType = data.request.trigger;

    if (data.request.triggeredByUserId) {
      execution.triggeredByUserId = data.request.triggeredByUserId;
    }

    const linkage: RunbookStartRequest["linkage"] = data.request.linkage || {};

    if (linkage.incidentId) {
      execution.incidentId = linkage.incidentId;
    }

    if (linkage.alertId) {
      execution.alertId = linkage.alertId;
    }

    if (linkage.scheduledMaintenanceId) {
      execution.scheduledMaintenanceId = linkage.scheduledMaintenanceId;
    }

    if (
      data.request.triggerDetails &&
      Object.keys(data.request.triggerDetails).length > 0
    ) {
      execution.triggerDetails = data.request.triggerDetails;
    }

    if (hasRunbookInputs(data.request.inputs)) {
      execution.inputs = data.request.inputs!;
    }

    return execution;
  }

  @CaptureSpan()
  public async start(
    request: RunbookStartRequest,
  ): Promise<RunbookStartResult> {
    const runbook: Runbook | null =
      request.runbook ||
      (await RunbookService.findOneById({
        id: request.runbookId,
        select: RUNBOOK_START_SELECT,
        props: { isRoot: true },
      }));

    if (
      !runbook ||
      !runbook._id ||
      runbook._id.toString() !== request.runbookId.toString() ||
      runbook.projectId?.toString() !== request.projectId.toString()
    ) {
      return { isStarted: false, refusal: RunbookStartRefusal.NotFound };
    }

    if (runbook.isEnabled === false) {
      return { isStarted: false, refusal: RunbookStartRefusal.TurnedOff };
    }

    if (RunbookStarterClass.getStepExecutions(runbook.steps).length === 0) {
      return { isStarted: false, refusal: RunbookStartRefusal.NoSteps };
    }

    if (
      UNATTENDED_RUNBOOK_TRIGGER_TYPES.includes(request.trigger) &&
      (await ProjectService.isProjectBlocked(request.projectId))
    ) {
      return { isStarted: false, refusal: RunbookStartRefusal.ProjectBlocked };
    }

    const created: RunbookExecution = await RunbookExecutionService.create({
      data: RunbookStarterClass.buildExecution({ runbook, request }),
      props: { isRoot: true },
    });

    const executionId: ObjectID = new ObjectID(created._id!.toString());

    try {
      if (!this.enqueue) {
        throw new Error(
          "No runbook queue is registered in this process (the Runbook feature set has not started).",
        );
      }

      await this.enqueue({ runbookExecutionId: executionId });
    } catch (error) {
      logger.error(
        `RunbookStarter: runbook execution ${executionId.toString()} could not be queued; failing it.`,
        {
          projectId: request.projectId.toString(),
          runbookId: request.runbookId.toString(),
        } as LogAttributes,
      );
      logger.error(error);

      await this.failNotQueued(executionId);

      created.status = RunbookExecutionStatus.Failed;
      created.failureReason = RUNBOOK_RUN_NOT_QUEUED_REASON;

      return {
        isStarted: false,
        refusal: RunbookStartRefusal.NotQueued,
        execution: created,
      };
    }

    return { isStarted: true, execution: created };
  }

  // A run nothing will pick up, ended with the reason rather than left Scheduled.
  private async failNotQueued(executionId: ObjectID): Promise<void> {
    try {
      await RunbookExecutionService.updateOneById({
        id: executionId,
        data: {
          status: RunbookExecutionStatus.Failed,
          completedAt: new Date(),
          failureReason: RUNBOOK_RUN_NOT_QUEUED_REASON,
        } as unknown as JSONObject,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `RunbookStarter: could not fail runbook execution ${executionId.toString()} that was never queued.`,
      );
      logger.error(error);
    }
  }
}

const RunbookStarter: RunbookStarterClass = new RunbookStarterClass();

export default RunbookStarter;
