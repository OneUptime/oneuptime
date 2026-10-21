import { RunbookStep } from "./RunbookStep";
import RunbookStepExecutionStatus from "./RunbookStepExecutionStatus";

export interface RunbookStepExecutionState {
  step: RunbookStep;
  status: RunbookStepExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  output?: string;
  errorMessage?: string;
  // Who ticked off a Manual step, approved a step after it ran, or skipped it.
  completedByUserId?: string;
  notes?: string;
  /*
   * When someone approved a step that asks for approval before it runs
   * (RunbookStep.requireApprovalBeforeRunning), and who: the run goes on to
   * run the step. Unset while the step waits, and on every other step.
   */
  approvedAt?: string;
  approvedByUserId?: string;
}
