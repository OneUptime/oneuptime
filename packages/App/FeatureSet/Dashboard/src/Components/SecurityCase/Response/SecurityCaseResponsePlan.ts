import { getResponseLinkRoute } from "./SecurityCaseResponseLinks";
import {
  ResponseAction,
  ResponsePlan,
  ResponseStep,
} from "./SecurityCaseResponseTypes";
import Route from "Common/Types/API/Route";
import { SecurityCaseMatchedDetectionJson } from "Common/Types/SecurityCase/SecurityCaseMatches";
import {
  HOST_CONTAINMENT_ACTIONS,
  RESPONSE_AI_STEP_MAX_LENGTH,
  RESPONSE_MAX_AI_STEPS,
  RESPONSE_MAX_CONTAIN_ENTITIES,
  RESPONSE_MAX_FIX_STEPS,
  RESPONSE_MAX_RULE_STEPS,
  ResponsePlanInput,
  USER_CONTAINMENT_ACTIONS,
  buildResponsePlan as buildSharedResponsePlan,
  findPlaybookDoing,
  getContainEntities,
  getContainmentSteps,
  getRequestedRoute,
  getRuleResponseSteps,
  isAiStep,
  readAiSuggestedSteps,
  readPlaybookRuns,
  toPlainStepText,
} from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanBuilder";
import {
  RESPONSE_STEP_KEY_MAX_LENGTH,
  getResponseStepKey,
  hashText,
} from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import {
  RESPONSE_MAX_TRACES,
  getRequestTracesLink,
} from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanLinks";
import { ResponseStep as SharedResponseStep } from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";

/*
 * A CASE'S RESPONSE PLAN, AS THE DASHBOARD DRAWS IT (#9557).
 *
 * What the plan says - its steps, their order, their words' keys, what is
 * done - is built by the shared builder (Common/Utils/SecurityCase/
 * ResponsePlan/ResponsePlanBuilder), the same code the server checks the
 * plan's steps with (#10340). The one thing the Dashboard adds is where a
 * step's link opens: each link is a descriptor there, and becomes one of
 * the Dashboard's routes here (SecurityCaseResponseLinks.ts).
 */

export {
  HOST_CONTAINMENT_ACTIONS,
  RESPONSE_AI_STEP_MAX_LENGTH,
  RESPONSE_MAX_AI_STEPS,
  RESPONSE_MAX_CONTAIN_ENTITIES,
  RESPONSE_MAX_FIX_STEPS,
  RESPONSE_MAX_RULE_STEPS,
  RESPONSE_MAX_TRACES,
  RESPONSE_STEP_KEY_MAX_LENGTH,
  USER_CONTAINMENT_ACTIONS,
  findPlaybookDoing,
  getContainEntities,
  getContainmentSteps,
  getRequestedRoute,
  getResponseStepKey,
  getRuleResponseSteps,
  hashText,
  isAiStep,
  readAiSuggestedSteps,
  readPlaybookRuns,
  toPlainStepText,
};

export type { ResponsePlanInput };

// The traces of the matched requests that got past the app's checks - or of them all.
export function getRequestTracesRoute(data: {
  detection: SecurityCaseMatchedDetectionJson;
  onlyThrough: boolean;
}): Route | null {
  return getResponseLinkRoute(getRequestTracesLink(data));
}

/*
 * A step as the card draws it: its link a route. A link the Dashboard has
 * no page for leaves the step with nothing to press, as a step whose link
 * could not be built always has.
 */
function withRoute(step: SharedResponseStep): ResponseStep {
  if (!step.action?.link) {
    return step;
  }

  const route: Route | null = getResponseLinkRoute(step.action.link);
  const action: ResponseAction | undefined = route
    ? { ...step.action, route }
    : undefined;

  return { ...step, action };
}

export function buildResponsePlan(input: ResponsePlanInput): ResponsePlan {
  const plan: ReturnType<typeof buildSharedResponsePlan> =
    buildSharedResponsePlan(input);

  return { ...plan, steps: plan.steps.map(withRoute) };
}
