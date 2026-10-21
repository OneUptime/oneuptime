import { ComponentType, NodeType } from "../../../Types/Workflow/Component";
import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * The Builder toolbar's add button: what it says, and which panel it opens.
 *
 * "When there are no triggers on the form, the Add Component button should
 * say 'Add Trigger' so it's easier for people to use and understand." - the
 * maintainer.
 *
 * A workflow without a trigger never starts, so its trigger is the first
 * thing it needs. Until it has one, the button says Add Trigger and opens
 * the Add Trigger panel, the same panel as the dashed "Choose what starts
 * this workflow" card on the canvas. Once a trigger is on the canvas, it
 * says Add Component and opens the Add Component panel, as it always did.
 * Each label is the title of the panel it opens (ComponentsModal).
 *
 * The Builder page reads the label from the graph the canvas last reported
 * (Builder's onWorkflowUpdated). The canvas reads the panel from its own
 * nodes when the button is pressed (Workflow's showComponentsPickerModal).
 * Both ask getWorkflowAddButton, so the button opens the panel it names.
 *
 * React-free, so the Dashboard, the offline Workflow Builder fixture and the
 * App's docs tests can all read it.
 */

export const WORKFLOW_ADD_TRIGGER_TITLE: string = translationKey("Add Trigger");

export const WORKFLOW_ADD_COMPONENT_TITLE: string =
  translationKey("Add Component");

/*
 * A node as the canvas holds it, or as a saved graph stores it: only the
 * parts read here.
 */
export interface WorkflowAddButtonNode {
  data?:
    | {
        nodeType?: NodeType | string | undefined;
        componentType?: ComponentType | string | undefined;
      }
    | null
    | undefined;
}

// The nodes on the canvas, or none before the graph is in.
export type WorkflowAddButtonNodes =
  | ReadonlyArray<WorkflowAddButtonNode | null | undefined>
  | null
  | undefined;

type IsWorkflowTriggerNodeFunction = (
  node: WorkflowAddButtonNode | null | undefined,
) => boolean;

/*
 * Whether this node is a trigger the workflow has, not the dashed card that
 * stands in for one it doesn't have yet.
 *
 * Read the way the canvas reads it when it decides whether to draw the
 * dashed card: from the step's own componentType (the Builder's load, and
 * Workflow's deleteNode). So the button says Add Trigger exactly while the
 * card is there, and choosing a trigger from either takes the card's place.
 */
export const isWorkflowTriggerNode: IsWorkflowTriggerNodeFunction = (
  node: WorkflowAddButtonNode | null | undefined,
): boolean => {
  const data: WorkflowAddButtonNode["data"] = node?.data;

  if (!data || data.nodeType === NodeType.PlaceholderNode) {
    return false;
  }

  return data.componentType === ComponentType.Trigger;
};

type WorkflowHasTriggerFunction = (nodes: WorkflowAddButtonNodes) => boolean;

// Whether the workflow has a trigger on its canvas.
export const workflowHasTrigger: WorkflowHasTriggerFunction = (
  nodes: WorkflowAddButtonNodes,
): boolean => {
  return (nodes || []).some(
    (node: WorkflowAddButtonNode | null | undefined): boolean => {
      return isWorkflowTriggerNode(node);
    },
  );
};

export interface WorkflowAddButton {
  // What the button says, in English: Button translates its title.
  title: string;
  // The panel it opens, as ComponentsModal's componentsType.
  componentsType: ComponentType;
}

type GetWorkflowAddButtonFunction = (
  nodes: WorkflowAddButtonNodes,
) => WorkflowAddButton;

// What the add button says and opens, for the canvas as it is now.
export const getWorkflowAddButton: GetWorkflowAddButtonFunction = (
  nodes: WorkflowAddButtonNodes,
): WorkflowAddButton => {
  if (workflowHasTrigger(nodes)) {
    return {
      title: WORKFLOW_ADD_COMPONENT_TITLE,
      componentsType: ComponentType.Component,
    };
  }

  return {
    title: WORKFLOW_ADD_TRIGGER_TITLE,
    componentsType: ComponentType.Trigger,
  };
};
