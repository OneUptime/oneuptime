import React from "react";
import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * THE BUILDER AS A VIEW, for someone who may open a workflow but not change
 * it: a Workflow Member, who runs workflows without building them, or a
 * viewer.
 *
 * The Builder used to work for them as it does for an editor - add a trigger
 * or a step, drag, connect, change settings - and every change then failed
 * to save, with an error dialog. The server decides every save by the
 * Workflow model's update list (Types/Workflow/WorkflowRunPermissions), so
 * the Builder asks the same list (WorkflowRunGate's getWorkflowEditGate)
 * and, when it refuses, shows the workflow as it is:
 *
 *   - the toolbar's add button is locked, saying why, and the save pill says
 *     "View only";
 *   - on the canvas nothing moves, connects or is deleted; the dashed card a
 *     workflow without a trigger shows says it has none, instead of asking
 *     to choose one, and a step whose settings are empty says it is not set
 *     up, instead of "Click to set up";
 *   - a step still opens, to read its settings, which are shown as they are
 *     and cannot be changed; the dialog has no Save and no Delete;
 *   - nothing is ever saved.
 *
 * Run Workflow is not part of this: Workflow Members run workflows, and the
 * run gate decides who may (WorkflowRunGate).
 */

/*
 * Whether the canvas around a step is a view. The canvas provides it, so a
 * step on it (Component.tsx, drawn by react-flow) knows without carrying it
 * in its data - node data is what the Builder saves.
 */
export const WorkflowViewOnlyContext: React.Context<boolean> =
  React.createContext<boolean>(false);

// The dashed card of a workflow without a trigger, for someone who may not add one.
export const WORKFLOW_NO_TRIGGER_TEXT: string =
  translationKey("No trigger yet");

// A step whose required settings are empty, for someone who may not set it up.
export const WORKFLOW_NODE_NOT_SET_UP_TEXT: string =
  translationKey("Not set up yet");
