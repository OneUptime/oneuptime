import { RunbookStep } from "./RunbookStep";
import RunbookStepExecutionStatus from "./RunbookStepExecutionStatus";

export interface RunbookStepExecutionState {
  step: RunbookStep;
  status: RunbookStepExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  output?: string;
  errorMessage?: string;
  completedByUserId?: string;
  notes?: string;
}
