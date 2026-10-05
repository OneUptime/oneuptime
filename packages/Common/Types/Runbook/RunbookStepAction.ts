/*
 * What a person may do to one step of a runbook execution, and when.
 *
 * An execution stops for a person in two places: on a Manual step, and after
 * a step marked requireApproval has run. Both park the step as
 * WaitingForUser and the execution as WaitingForManualStep, and when the run
 * is resumed the execution loop walks straight past every step already
 * Completed or Skipped. So marking a step Completed or Skipped before the run
 * reaches it would remove the stop altogether: an "L2 approval" checklist
 * step ticked off while the run is still paused on step one is never paused
 * on at all.
 *
 * The rules:
 *  - Complete: only the step the execution is paused on.
 *  - Skip: the step the execution is paused on, or — while it is paused — a
 *    later plain automated step (neither Manual nor requireApproval), so a
 *    responder can drop a step they already know is not needed before the run
 *    gets to it. A Manual or approval step is never skipped ahead of time: its
 *    whole purpose is to stop the run.
 *  - Nothing while the execution is Scheduled or Running. The Worker driving
 *    the run holds the step list in memory and writes all of it back at every
 *    step boundary, so a change made underneath it would be overwritten, and
 *    resuming would start a second loop over the same execution.
 *
 * Shared by the API, which enforces it, and the execution page, which only
 * offers the actions the API will accept.
 */

import RunbookExecutionStatus from "./RunbookExecutionStatus";
import { RunbookStepExecutionState } from "./RunbookStepExecution";
import RunbookStepExecutionStatus from "./RunbookStepExecutionStatus";
import RunbookStepType from "./RunbookStepType";

export enum RunbookStepAction {
  Complete = "Complete",
  Skip = "Skip",
}

export type RunbookStepActionDecision =
  | {
      allowed: true;
      /*
       * True when the action releases the step the execution is paused on,
       * so the execution has to be resumed. False when a later step is
       * skipped ahead of time: the execution stays paused where it is.
       */
      resumesExecution: boolean;
    }
  | {
      allowed: false;
      // Shown to the person who asked, so it says what to do instead.
      reason: string;
    };

/*
 * The steps the execution loop walks past without running: Completed,
 * Skipped, and a Failed step that is allowed to fail.
 */
export function isStepExecutionSettled(
  stepExecution: RunbookStepExecutionState,
): boolean {
  return (
    stepExecution.status === RunbookStepExecutionStatus.Completed ||
    stepExecution.status === RunbookStepExecutionStatus.Skipped ||
    (stepExecution.status === RunbookStepExecutionStatus.Failed &&
      Boolean(stepExecution.step.continueOnFailure))
  );
}

/*
 * The step a paused execution is waiting on: the first step the loop has not
 * settled, provided that step is WaitingForUser and the execution is parked
 * in WaitingForManualStep — the same step the loop would stop on if it ran
 * now. Undefined for anything else, an inconsistent row included, so nothing
 * can be advanced on one.
 */
export function getStepAwaitingUser(data: {
  executionStatus: RunbookExecutionStatus | undefined;
  stepExecutions: Array<RunbookStepExecutionState>;
}): RunbookStepExecutionState | undefined {
  if (data.executionStatus !== RunbookExecutionStatus.WaitingForManualStep) {
    return undefined;
  }

  const firstUnsettled: RunbookStepExecutionState | undefined =
    data.stepExecutions.find((stepExecution: RunbookStepExecutionState) => {
      return !isStepExecutionSettled(stepExecution);
    });

  if (firstUnsettled?.status !== RunbookStepExecutionStatus.WaitingForUser) {
    return undefined;
  }

  return firstUnsettled;
}

export function decideRunbookStepAction(data: {
  action: RunbookStepAction;
  executionStatus: RunbookExecutionStatus | undefined;
  stepExecutions: Array<RunbookStepExecutionState>;
  stepId: string;
}): RunbookStepActionDecision {
  if (
    data.executionStatus === RunbookExecutionStatus.Completed ||
    data.executionStatus === RunbookExecutionStatus.Failed ||
    data.executionStatus === RunbookExecutionStatus.Cancelled
  ) {
    return refuse(`Cannot update step on a ${data.executionStatus} execution`);
  }

  const targetIndex: number = data.stepExecutions.findIndex(
    (stepExecution: RunbookStepExecutionState) => {
      return stepExecution.step.id === data.stepId;
    },
  );

  const target: RunbookStepExecutionState | undefined =
    data.stepExecutions[targetIndex];

  if (!target) {
    return refuse("This step is not part of this execution.");
  }

  const awaiting: RunbookStepExecutionState | undefined = getStepAwaitingUser({
    executionStatus: data.executionStatus,
    stepExecutions: data.stepExecutions,
  });

  if (awaiting && awaiting.step.id === target.step.id) {
    return { allowed: true, resumesExecution: true };
  }

  const title: string = `Step "${target.step.title}"`;

  if (
    target.status === RunbookStepExecutionStatus.Completed ||
    target.status === RunbookStepExecutionStatus.Skipped ||
    target.status === RunbookStepExecutionStatus.Failed ||
    target.status === RunbookStepExecutionStatus.Cancelled
  ) {
    return refuse(`${title} is already ${target.status}.`);
  }

  const waitingOn: string = awaiting
    ? ` This execution is waiting on "${awaiting.step.title}".`
    : " This execution is not waiting on a step right now.";

  if (data.action === RunbookStepAction.Complete) {
    if (target.status === RunbookStepExecutionStatus.Pending) {
      return refuse(
        `${title} has not been reached yet. Only the step the execution is waiting on can be completed.${waitingOn}`,
      );
    }

    return refuse(
      `Only the step the execution is waiting on can be completed.${waitingOn}`,
    );
  }

  if (target.status === RunbookStepExecutionStatus.Pending) {
    if (target.step.type === RunbookStepType.Manual) {
      return refuse(
        `${title} is a manual step, so it can only be completed or skipped once the execution reaches it.${waitingOn}`,
      );
    }

    if (target.step.requireApproval) {
      return refuse(
        `${title} requires approval, so it can only be approved or skipped once it has run and the execution is waiting on it.${waitingOn}`,
      );
    }

    if (!awaiting) {
      return refuse(
        `${title} can only be skipped ahead of time while the execution is paused on a step that is waiting for you.${waitingOn}`,
      );
    }

    const awaitingIndex: number = data.stepExecutions.indexOf(awaiting);

    if (targetIndex > awaitingIndex) {
      return { allowed: true, resumesExecution: false };
    }
  }

  return refuse(
    `Only the step the execution is waiting on, or a later automated step that does not require approval, can be skipped.${waitingOn}`,
  );
}

function refuse(reason: string): RunbookStepActionDecision {
  return { allowed: false, reason };
}
