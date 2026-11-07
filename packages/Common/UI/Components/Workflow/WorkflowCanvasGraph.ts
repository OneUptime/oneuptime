import { getEdgeDefaultProps, getPlaceholderTriggerNode } from "./Workflow";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ComponentMetadata, {
  ComponentType,
  NodeType,
} from "../../../Types/Workflow/Component";
import { Edge, Node } from "reactflow";

/*
 * A SAVED GRAPH AS THE CANVAS DRAWS IT: the workflow as it was opened, a step
 * of Undo or Redo, a version restored or previewed, what Ask AI saved.
 *
 * A saved graph keeps a step's component by its id alone, and a connection by
 * its ends (WorkflowGraphSnapshot). The canvas draws each step from its
 * component's catalog entry, and each connection in its own style, so both
 * are put back here - and the dashed card a workflow without a trigger starts
 * from, where it has none. What a step's checks said when it was saved is
 * stale by definition, so it is cleared: the checks run again as it is drawn.
 *
 * A graph whose step has no component OneUptime knows any more cannot be
 * drawn, and says which (BadDataException).
 */

export interface WorkflowCanvasGraph {
  nodes: Array<Node>;
  edges: Array<Edge>;
}

const isObject: (value: unknown) => value is JSONObject = (
  value: unknown,
): value is JSONObject => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

export const toWorkflowCanvasGraph: (data: {
  graph: unknown;
  components: Array<ComponentMetadata>;
}) => WorkflowCanvasGraph = (data: {
  graph: unknown;
  components: Array<ComponentMetadata>;
}): WorkflowCanvasGraph => {
  // A copy: the canvas changes its nodes, and the graph may be kept.
  const graph: JSONObject | null = isObject(data.graph)
    ? (JSON.parse(JSON.stringify(data.graph)) as JSONObject)
    : null;

  const savedNodes: Array<Node> = (Array.isArray(graph?.["nodes"])
    ? graph?.["nodes"]
    : []) as unknown as Array<Node>;

  const componentsById: Map<string, ComponentMetadata> = new Map<
    string,
    ComponentMetadata
  >(
    data.components.map(
      (component: ComponentMetadata): [string, ComponentMetadata] => {
        return [component.id, component];
      },
    ),
  );

  let nodes: Array<Node> = [];

  for (const node of savedNodes) {
    if (!isObject(node)) {
      continue;
    }

    if (node.data?.nodeType === NodeType.PlaceholderNode) {
      nodes.push({ ...node, ...getPlaceholderTriggerNode() });
      continue;
    }

    const metadata: ComponentMetadata | undefined = componentsById.get(
      node.data?.metadataId,
    );

    if (!metadata) {
      throw new BadDataException(
        "Component Metadata not found for node " + node.data?.metadataId,
      );
    }

    nodes.push({
      ...node,
      data: {
        ...node.data,
        metadata: { ...metadata },
        error: "",
      },
    });
  }

  // A workflow without a trigger starts from the dashed card.
  if (
    !nodes.find((node: Node): boolean => {
      return (
        node.data?.nodeType === NodeType.PlaceholderNode ||
        node.data?.componentType === ComponentType.Trigger
      );
    })
  ) {
    nodes = [...nodes, getPlaceholderTriggerNode()];
  }

  const savedEdges: Array<Edge> = (Array.isArray(graph?.["edges"])
    ? graph?.["edges"]
    : []) as unknown as Array<Edge>;

  const edges: Array<Edge> = savedEdges
    .filter((edge: Edge): boolean => {
      return isObject(edge);
    })
    .map((edge: Edge): Edge => {
      return {
        ...edge,
        ...getEdgeDefaultProps(false),
      } as Edge;
    });

  return { nodes, edges };
};

// Whether any card is being dragged: the canvas reports every step of a drag.
export const isAnyCardBeingDragged: (nodes: Array<Node>) => boolean = (
  nodes: Array<Node>,
): boolean => {
  return nodes.some((node: Node): boolean => {
    return node.dragging === true;
  });
};
