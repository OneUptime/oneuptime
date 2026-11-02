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
 *   - what only reads a setting stays usable: a code box's own Copy, More
 *     fields and Compare as, to read what they fold away;
 *   - nothing is ever saved.
 *
 * Run Workflow is not part of this: Workflow Members run workflows, and the
 * run gate decides who may (WorkflowRunGate).
 */

/*
 * Whether the canvas around a step is a view. The canvas provides it, so a
 * step on it (Component.tsx, drawn by react-flow) knows without carrying it
 * in its data - node data is what the Builder saves. A step's dialog
 * provides it around the settings and the identifier it shows to be read
 * (ComponentSettingsModal), and each setting holds itself still there, one
 * by one (ArgumentsForm): a field the form draws is locked (a code box is
 * read only, its Copy working), the rest sit in WorkflowViewOnlyFieldset.
 *
 * A disabled fieldset does not reach what is no form control, so that
 * reads this itself: the value boxes, editable elements
 * (ValuePicker/TemplateTextEditor), the value picker, which offers nothing
 * to insert (ValuePicker/ValuePickerContext), and a Switch case's grip
 * (Switch/SwitchEditor).
 *
 * Every Builder control that can change a workflow honours this, and every
 * value field goes through ValueTextField or the value picker provider:
 * WorkflowViewOnlyGuard reads them all, and WorkflowViewOnlyEveryStepGuard
 * draws every step's settings on a view.
 */
export const WorkflowViewOnlyContext: React.Context<boolean> =
  React.createContext<boolean>(false);

// The dashed card of a workflow without a trigger, for someone who may not add one.
export const WORKFLOW_NO_TRIGGER_TEXT: string =
  translationKey("No trigger yet");

// A step whose required settings are empty, for someone who may not set it up.
export const WORKFLOW_NODE_NOT_SET_UP_TEXT: string =
  translationKey("Not set up yet");
