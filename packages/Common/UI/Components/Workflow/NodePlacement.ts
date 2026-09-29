import { ComponentType, NodeType } from "../../../Types/Workflow/Component";
import { Node, XYPosition } from "reactflow";

const DEFAULT_NODE_HEIGHT: number = 200;
const NODE_GAP: number = 80;

type GetNewWorkflowNodePositionFunction = (
  nodes: Array<Node>,
  componentType: ComponentType,
) => XYPosition;

/** Keep new steps clear of existing cards, including cards resized by content. */
export const getNewWorkflowNodePosition: GetNewWorkflowNodePositionFunction = (
  nodes: Array<Node>,
  componentType: ComponentType,
): XYPosition => {
  if (componentType === ComponentType.Trigger) {
    const trigger: Node | undefined = nodes.find((node: Node) => {
      return (
        node.data.nodeType === NodeType.PlaceholderNode ||
        node.data.componentType === ComponentType.Trigger
      );
    });

    if (trigger) {
      return { ...trigger.position };
    }

    const firstNode: Node | undefined = [...nodes].sort((a: Node, b: Node) => {
      return a.position.y - b.position.y;
    })[0];

    return firstNode
      ? {
          x: firstNode.position.x,
          y: firstNode.position.y - DEFAULT_NODE_HEIGHT - NODE_GAP,
        }
      : { x: 100, y: 100 };
  }

  let lastNode: Node | undefined;
  let lowestBottom: number = -Infinity;

  for (const node of nodes) {
    const bottom: number =
      node.position.y + (node.height || DEFAULT_NODE_HEIGHT);

    if (bottom > lowestBottom) {
      lowestBottom = bottom;
      lastNode = node;
    }
  }

  return lastNode
    ? { x: lastNode.position.x, y: lowestBottom + NODE_GAP }
    : { x: 100, y: 100 };
};
