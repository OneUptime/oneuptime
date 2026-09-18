/*
 * When a runbook execution stops being anybody's responsibility.
 *
 * An execution runs inside a single queue job on one Worker. If that Worker
 * dies mid-step and the job is never redelivered — Redis lost it, the stall
 * budget ran out, the handler threw somewhere unrecoverable — the row stays
 * Running with nobody advancing it. Nothing else in the system would ever
 * change it, so the reconciler needs a defensible answer to "has this been
 * abandoned?".
 *
 * The answer is derived from the step that is currently Running: it cannot
 * legitimately outlive the claim + execution window its author configured, so
 * anything past that window plus a grace margin is abandoned. Deriving it per
 * execution (rather than picking one global timeout) matters now that a step
 * may be configured for anything from one second to one hour — a single
 * threshold would either kill live hour-long restores or leave a one-second
 * step hanging for an hour.
 */

import {
  BashStepConfig,
  HttpRequestStepConfig,
  JavaScriptStepConfig,
  RunbookStep,
} from "./RunbookStep";
import { RunbookStepExecutionState } from "./RunbookStepExecution";
import RunbookStepExecutionStatus from "./RunbookStepExecutionStatus";
import RunbookStepType from "./RunbookStepType";
import {
  MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
  resolveAgentClaimTimeoutInMs,
  resolveStepExecutionTimeoutInMs,
} from "./RunbookStepTimeout";

/*
 * Margin on top of a step's own window before the execution is declared
 * abandoned. The Worker running the step gives up at claim + execution + 5s
 * and then writes the failure itself, so this only has to outlast that write —
 * five minutes leaves room for a slow database or a Worker that is briefly
 * paused, and keeps the reconciler from racing a run that is still healthy.
 */
export const STUCK_EXECUTION_GRACE_IN_MS: number = 5 * 60 * 1000;

/*
 * Allowance for a step type whose runtime the author cannot bound — today
 * that is the AI step, which runs as long as the model provider takes. The
 * longest configurable step window is the least surprising ceiling to borrow.
 */
export const UNBOUNDED_STEP_ALLOWANCE_IN_MS: number =
  MAX_STEP_EXECUTION_TIMEOUT_IN_MS;

/*
 * The longest a single step can legitimately occupy its Worker. Agent steps
 * spend the claim window waiting for an agent to pick the job up and the
 * execution window actually running, so they get both.
 */
export function getStepMaxRuntimeInMs(step: RunbookStep): number {
  switch (step.type) {
    case RunbookStepType.Bash:
    case RunbookStepType.JavaScript: {
      const config: BashStepConfig | JavaScriptStepConfig = step.config as
        | BashStepConfig
        | JavaScriptStepConfig;
      return (
        resolveAgentClaimTimeoutInMs(config.claimTimeoutInMs) +
        resolveStepExecutionTimeoutInMs(config.timeoutInMs)
      );
    }

    case RunbookStepType.HttpRequest: {
      const config: HttpRequestStepConfig =
        step.config as HttpRequestStepConfig;
      return resolveStepExecutionTimeoutInMs(config.timeoutInMs);
    }

    /*
     * Manual steps park the execution as WaitingForManualStep rather than
     * Running, so one found Running is a torn write, not a wait. It gets no
     * allowance — the grace margin alone decides.
     */
    case RunbookStepType.Manual:
      return 0;

    default:
      return UNBOUNDED_STEP_ALLOWANCE_IN_MS;
  }
}

/*
 * Deadline for an execution currently in the Running state.
 *
 * Anchored on the running step's own startedAt where possible. Two fallbacks
 * use the execution's updatedAt instead:
 *
 *  - A step is Running but carries no usable startedAt. The state machine
 *    stamps startedAt and persists in the same write, so updatedAt is the same
 *    instant; the step still gets its full allowance.
 *  - No step is Running at all. The Worker died between steps, so nothing is
 *    executing and no allowance is owed — only the grace margin.
 */
export function getRunningExecutionDeadline(data: {
  stepExecutions: Array<RunbookStepExecutionState>;
  executionUpdatedAt: Date;
}): Date {
  const runningStep: RunbookStepExecutionState | undefined =
    data.stepExecutions.find((stepExecution: RunbookStepExecutionState) => {
      return stepExecution.status === RunbookStepExecutionStatus.Running;
    });

  if (!runningStep) {
    return new Date(
      data.executionUpdatedAt.getTime() + STUCK_EXECUTION_GRACE_IN_MS,
    );
  }

  const startedAtMs: number = runningStep.startedAt
    ? new Date(runningStep.startedAt).getTime()
    : NaN;

  const anchorMs: number = isFinite(startedAtMs)
    ? startedAtMs
    : data.executionUpdatedAt.getTime();

  return new Date(
    anchorMs +
      getStepMaxRuntimeInMs(runningStep.step) +
      STUCK_EXECUTION_GRACE_IN_MS,
  );
}
