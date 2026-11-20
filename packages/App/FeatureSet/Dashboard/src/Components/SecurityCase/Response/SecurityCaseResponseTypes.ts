import Route from "Common/Types/API/Route";
import {
  RESPONSE_PHASES,
  ResponseAction as SharedResponseAction,
  ResponseActionKind,
  ResponsePhase,
  ResponsePlan as SharedResponsePlan,
  ResponsePlaybook,
  ResponsePlaybookRunState,
  ResponseStep as SharedResponseStep,
  ResponseStepCheck,
  ResponseStepCompletion,
  ResponseTask,
  ResponseText,
} from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";

/*
 * The shapes of a case's Response Plan as the Dashboard draws it. The plan
 * itself is shared with the server, OneUptime AI and the mobile app
 * (Common/Utils/SecurityCase/ResponsePlan, #10340): its links are
 * descriptors there, and here each one also carries the route it opens
 * (SecurityCaseResponseLinks.ts) - nothing else the plan says changes.
 */

export {
  RESPONSE_PHASES,
  ResponseActionKind,
  ResponsePhase,
  ResponsePlaybookRunState,
  ResponseStepCompletion,
};

export type { ResponsePlaybook, ResponseStepCheck, ResponseTask, ResponseText };

export interface ResponseAction extends SharedResponseAction {
  // Where an OpenRoute action's link opens in the Dashboard.
  route?: Route | undefined;
}

export interface ResponseStep extends Omit<SharedResponseStep, "action"> {
  action?: ResponseAction | undefined;
}

export interface ResponsePlan extends Omit<SharedResponsePlan, "steps"> {
  steps: Array<ResponseStep>;
}
