import PermissionGate, {
  PermissionGateOptions,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import { translationKey } from "../../Utils/TranslateTemplate";
import {
  WORKFLOW_EDIT_PERMISSIONS,
  WORKFLOW_RUN_PERMISSIONS,
  WORKFLOW_RUN_WILDCARD,
} from "../../../Types/Workflow/WorkflowRunPermissions";

/*
 * Whether the Builder offers Run Workflow and "Run just this step", by the
 * lists the server asks for them (Types/Workflow/WorkflowRunPermissions):
 *
 *   - Run Workflow: the workflow's editors and Workflow Members, who run
 *     workflows without changing them;
 *   - Run just this step: the workflow's editors only - one step on its own
 *     skips every condition before it, which is a builder's test.
 *
 * Someone who may not sees the button locked, saying why and what would let
 * them, in the server's own words. Before the permission snapshot has
 * landed nobody is told anything and the server decides
 * (PermissionGate.checkPermissions).
 */

// The first sentence of each refusal: the server's message, word for word.
export const WorkflowRunCopy: {
  readonly runRefused: string;
  readonly stepRunRefused: string;
} = {
  runRefused: translationKey(
    "You do not have permission to run this workflow.",
  ),
  stepRunRefused: translationKey(
    "Running one step on its own takes permission to edit this workflow.",
  ),
};

export type GetWorkflowRunGateFunction = (
  options?: PermissionGateOptions | undefined,
) => PermissionGateResult;

export const getWorkflowRunGate: GetWorkflowRunGateFunction = (
  options?: PermissionGateOptions | undefined,
): PermissionGateResult => {
  return PermissionGate.checkPermissions(WORKFLOW_RUN_PERMISSIONS, {
    ...options,
    wildcard: WORKFLOW_RUN_WILDCARD,
    sentence: WorkflowRunCopy.runRefused,
  });
};

export const getWorkflowStepRunGate: GetWorkflowRunGateFunction = (
  options?: PermissionGateOptions | undefined,
): PermissionGateResult => {
  return PermissionGate.checkPermissions(WORKFLOW_EDIT_PERMISSIONS, {
    ...options,
    wildcard: WORKFLOW_RUN_WILDCARD,
    sentence: WorkflowRunCopy.stepRunRefused,
  });
};

/*
 * The reason a button is locked, or undefined when it is not: refused with
 * something to say. A gate that refuses with nothing to say - the snapshot
 * has not landed - leaves the button working, and the server decides.
 */
export const getLockedReason: (
  gate: PermissionGateResult,
) => string | undefined = (gate: PermissionGateResult): string | undefined => {
  if (gate.isAllowed) {
    return undefined;
  }

  return gate.disabledReason || undefined;
};
