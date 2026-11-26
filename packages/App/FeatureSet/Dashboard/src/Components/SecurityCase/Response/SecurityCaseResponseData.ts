import SecurityCaseAiVerdict from "Common/Types/SecurityCase/SecurityCaseAiVerdict";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import {
  RESPONSE_PLAYBOOK_SELECT,
  RESPONSE_STEP_CHECK_SELECT,
  RESPONSE_TASK_SELECT,
  getResponseStepTitle,
  readResponsePlaybooks,
  readResponseStepChecks,
  readResponseTasks,
} from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanInputs";

/*
 * What a case's Response Plan reads, and how it reads it: the case's tasks
 * (a step ticked off is one, keyed by the step), the project's playbooks
 * that are on (by what their steps do) and what its ticks write - shared
 * with the server (Common/Utils/SecurityCase/ResponsePlan/
 * ResponsePlanInputs). What only the card draws is here.
 */

export {
  RESPONSE_PLAYBOOK_SELECT,
  RESPONSE_STEP_CHECK_SELECT,
  RESPONSE_TASK_SELECT,
  getResponseStepTitle,
  readResponsePlaybooks,
  readResponseStepChecks,
  readResponseTasks,
};

// The tone OneUptime AI's read of the case is drawn in: worried, calm, or unsure.
export function getCaseResponseVerdictTone(verdict: string): PillTone {
  switch (verdict) {
    case SecurityCaseAiVerdict.LikelyMalicious:
      return PillTone.Danger;
    case SecurityCaseAiVerdict.LikelyFalsePositive:
    case SecurityCaseAiVerdict.LikelyBenign:
      return PillTone.Success;
    default:
      return PillTone.Warning;
  }
}
