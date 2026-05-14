import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { RunbookStep } from "Common/Types/Runbook/RunbookStep";
import { RunbookStepExecutionState } from "Common/Types/Runbook/RunbookStepExecution";
import {
  runBashStep,
  runHttpStep,
  runJavaScriptStep,
  StepExecutionContext,
  StepRunResult,
} from "./StepExecutors";
import QueueRunbook from "./QueueRunbook";

export default class RunRunbook {
  public async runExecution(data: {
    runbookExecutionId: ObjectID;
  }): Promise<void> {
    const execution: RunbookExecution | null =
      await RunbookExecutionService.findOneById({
        id: data.runbookExecutionId,
        select: {
          _id: true,
          projectId: true,
          runbookId: true,
          status: true,
          stepExecutions: true,
          startedAt: true,
        },
        props: { isRoot: true },
      });

    if (!execution) {
      logger.warn(
        `RunbookExecution ${data.runbookExecutionId.toString()} not found`,
      );
      return;
    }

    if (
      execution.status === RunbookExecutionStatus.Completed ||
      execution.status === RunbookExecutionStatus.Failed ||
      execution.status === RunbookExecutionStatus.Cancelled
    ) {
      return;
    }

    const stepExecutions: RunbookStepExecutionState[] =
      (execution.stepExecutions as unknown as RunbookStepExecutionState[]) ||
      [];

    if (stepExecutions.length === 0) {
      await this.markExecutionCompleted(execution._id!);
      return;
    }

    if (!execution.startedAt) {
      await RunbookExecutionService.updateOneById({
        id: new ObjectID(execution._id!),
        data: {
          status: RunbookExecutionStatus.Running,
          startedAt: new Date(),
        } as unknown as JSONObject,
        props: { isRoot: true },
      });
    } else if (execution.status !== RunbookExecutionStatus.Running) {
      await RunbookExecutionService.updateOneById({
        id: new ObjectID(execution._id!),
        data: {
          status: RunbookExecutionStatus.Running,
        } as unknown as JSONObject,
        props: { isRoot: true },
      });
    }

    let didFail: boolean = false;

    for (let i: number = 0; i < stepExecutions.length; i++) {
      const stepExec: RunbookStepExecutionState = stepExecutions[i]!;

      if (
        stepExec.status === RunbookStepExecutionStatus.Completed ||
        stepExec.status === RunbookStepExecutionStatus.Skipped
      ) {
        continue;
      }

      if (stepExec.status === RunbookStepExecutionStatus.Failed) {
        if (stepExec.step.continueOnFailure) {
          continue;
        }
        didFail = true;
        break;
      }

      if (stepExec.status === RunbookStepExecutionStatus.WaitingForUser) {
        // Halt execution; wait for user to complete.
        await this.persistStepExecutions(
          execution._id!,
          stepExecutions,
          RunbookExecutionStatus.WaitingForManualStep,
        );
        return;
      }

      // Pending or Running — execute the step.
      stepExec.status = RunbookStepExecutionStatus.Running;
      stepExec.startedAt = new Date().toISOString();
      await this.persistStepExecutions(
        execution._id!,
        stepExecutions,
        RunbookExecutionStatus.Running,
      );

      if (stepExec.step.type === RunbookStepType.Manual) {
        stepExec.status = RunbookStepExecutionStatus.WaitingForUser;
        await this.persistStepExecutions(
          execution._id!,
          stepExecutions,
          RunbookExecutionStatus.WaitingForManualStep,
        );
        return;
      }

      let result: StepRunResult;
      try {
        result = await this.runAutomatedStep(stepExec.step, {
          projectId: execution.projectId!,
          runbookExecutionId: new ObjectID(execution._id!),
        });
      } catch (err) {
        result = {
          success: false,
          output: "",
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }

      stepExec.completedAt = new Date().toISOString();
      stepExec.output = result.output;
      if (result.success) {
        if (stepExec.step.requireApproval) {
          /*
           * Step ran successfully but is gated on user approval before the
           * next step runs. Reuse the WaitingForUser flow so the existing
           * completeManualStep API resumes execution on approval.
           */
          stepExec.status = RunbookStepExecutionStatus.WaitingForUser;
          await this.persistStepExecutions(
            execution._id!,
            stepExecutions,
            RunbookExecutionStatus.WaitingForManualStep,
          );
          return;
        }
        stepExec.status = RunbookStepExecutionStatus.Completed;
      } else {
        stepExec.status = RunbookStepExecutionStatus.Failed;
        if (result.errorMessage) {
          stepExec.errorMessage = result.errorMessage;
        }
        if (!stepExec.step.continueOnFailure) {
          didFail = true;
          await this.persistStepExecutions(
            execution._id!,
            stepExecutions,
            RunbookExecutionStatus.Running,
          );
          break;
        }
      }

      await this.persistStepExecutions(
        execution._id!,
        stepExecutions,
        RunbookExecutionStatus.Running,
      );
    }

    const allDone: boolean = stepExecutions.every(
      (s: RunbookStepExecutionState) => {
        return (
          s.status === RunbookStepExecutionStatus.Completed ||
          s.status === RunbookStepExecutionStatus.Skipped ||
          (s.status === RunbookStepExecutionStatus.Failed &&
            s.step.continueOnFailure)
        );
      },
    );

    if (didFail) {
      await this.markExecutionFailed(execution._id!, stepExecutions);
      return;
    }

    if (allDone) {
      await this.persistStepExecutions(
        execution._id!,
        stepExecutions,
        RunbookExecutionStatus.Completed,
      );
      await RunbookExecutionService.updateOneById({
        id: new ObjectID(execution._id!),
        data: {
          completedAt: new Date(),
        } as unknown as JSONObject,
        props: { isRoot: true },
      });
    }
  }

  private async runAutomatedStep(
    step: RunbookStep,
    ctx: StepExecutionContext,
  ): Promise<StepRunResult> {
    switch (step.type) {
      case RunbookStepType.JavaScript:
        return runJavaScriptStep(step, ctx);
      case RunbookStepType.HttpRequest:
        return runHttpStep(step);
      case RunbookStepType.Bash:
        return runBashStep(step, ctx);
      default:
        return {
          success: false,
          output: "",
          errorMessage: `Unknown step type: ${String(step.type)}`,
        };
    }
  }

  private async persistStepExecutions(
    executionId: string,
    stepExecutions: RunbookStepExecutionState[],
    status: RunbookExecutionStatus,
  ): Promise<void> {
    await RunbookExecutionService.updateOneById({
      id: new ObjectID(executionId),
      data: {
        stepExecutions: stepExecutions as unknown as JSONArray,
        status,
      } as unknown as JSONObject,
      props: { isRoot: true },
    });
  }

  private async markExecutionCompleted(executionId: string): Promise<void> {
    await RunbookExecutionService.updateOneById({
      id: new ObjectID(executionId),
      data: {
        status: RunbookExecutionStatus.Completed,
        completedAt: new Date(),
      } as unknown as JSONObject,
      props: { isRoot: true },
    });
  }

  private async markExecutionFailed(
    executionId: string,
    stepExecutions: RunbookStepExecutionState[],
  ): Promise<void> {
    const failedStep: RunbookStepExecutionState | undefined =
      stepExecutions.find((s: RunbookStepExecutionState) => {
        return (
          s.status === RunbookStepExecutionStatus.Failed &&
          !s.step.continueOnFailure
        );
      });

    const failureReason: string = failedStep
      ? `Step "${failedStep.step.title}" failed: ${
          failedStep.errorMessage || "unknown error"
        }`
      : "Runbook execution failed.";

    await RunbookExecutionService.updateOneById({
      id: new ObjectID(executionId),
      data: {
        status: RunbookExecutionStatus.Failed,
        completedAt: new Date(),
        failureReason,
      } as unknown as JSONObject,
      props: { isRoot: true },
    });
  }

  public static async startExecution(data: {
    runbookExecutionId: ObjectID;
  }): Promise<void> {
    await QueueRunbook.addExecutionToQueue(data);
  }
}
