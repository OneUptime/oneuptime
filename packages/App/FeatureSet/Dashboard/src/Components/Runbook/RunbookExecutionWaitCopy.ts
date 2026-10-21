import { RunbookStepWait } from "Common/Types/Runbook/RunbookStepApproval";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A RUN'S EXECUTION PAGE SAYS ABOUT THE STEP IT WAITS ON.
 *
 * A run stops for a person on a Manual step, and before a step that asks
 * for approval before it runs - or, in a run started before approvals moved
 * to the step they guard, after such a step ran (RunbookStepApproval). The
 * page names the step it waits on, says which of those it is, and offers
 * the one button that moves the run on: tick off the Manual step, approve
 * the step so it runs, or approve the step that ran so the run goes on.
 *
 * React-free, so App's tests and the docs suites read the same words.
 */

// The button on the step the run waits on.
export const MARK_COMPLETE_BUTTON: string = translationKey("Mark complete");
export const APPROVE_AND_RUN_BUTTON: string = translationKey("Approve and run");
export const APPROVE_AND_CONTINUE_BUTTON: string =
  translationKey("Approve & continue");

// The step's status pill while the run waits on it.
export const WAITING_FOR_YOU_LABEL: string = translationKey("Waiting for you");
export const WAITING_FOR_APPROVAL_LABEL: string = translationKey(
  "Waiting for approval",
);

// Under a step that waits for approval before it runs.
export const APPROVE_TO_RUN_NOTE: string = translationKey(
  "This step runs once someone approves it.",
);

// Who approved a step that asked for approval before it ran.
export const APPROVED_BY_LABEL: string = translationKey("Approved by");

// What the run's card says while it waits, naming the step.
export const RUN_WAITS_ON_MANUAL_STEP: string = translationKey(
  'Waiting on "{{title}}". Tick it off below to continue.',
);
export const RUN_WAITS_FOR_APPROVAL_TO_RUN: string = translationKey(
  'Waiting for approval to run "{{title}}".',
);
export const RUN_WAITS_FOR_APPROVAL_TO_CONTINUE: string = translationKey(
  'Waiting for approval to continue after "{{title}}".',
);

export function getWaitingStepButtonTitle(wait: RunbookStepWait): string {
  switch (wait) {
    case RunbookStepWait.ApprovalToRun:
      return APPROVE_AND_RUN_BUTTON;
    case RunbookStepWait.ApprovalToContinue:
      return APPROVE_AND_CONTINUE_BUTTON;
    default:
      return MARK_COMPLETE_BUTTON;
  }
}

export function getWaitingStepStatusLabel(wait: RunbookStepWait): string {
  return wait === RunbookStepWait.Manual
    ? WAITING_FOR_YOU_LABEL
    : WAITING_FOR_APPROVAL_LABEL;
}

// The sentence, with {{title}}, the run's card says while it waits on a step.
export function getRunWaitingTemplate(wait: RunbookStepWait): string {
  switch (wait) {
    case RunbookStepWait.ApprovalToRun:
      return RUN_WAITS_FOR_APPROVAL_TO_RUN;
    case RunbookStepWait.ApprovalToContinue:
      return RUN_WAITS_FOR_APPROVAL_TO_CONTINUE;
    default:
      return RUN_WAITS_ON_MANUAL_STEP;
  }
}
