import { JSONObject } from "../../../Types/JSON";
import ComponentMetadata, {
  ComponentType,
  NodeType,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import Components from "../../../Types/Workflow/Components";
import { WorkflowComponentLookup } from "../../../Utils/Workflow/WorkflowGraphChanges";

/*
 * Workflow graphs for the version history and undo tests (issue #6188): the
 * canvas's nodes and edges as the builder holds them - measured, selected,
 * styled - built from short specs, with the real component catalog.
 */

export const COMPONENTS_BY_ID: Map<string, ComponentMetadata> = new Map<
  string,
  ComponentMetadata
>(
  (Components as Array<ComponentMetadata>).map(
    (component: ComponentMetadata): [string, ComponentMetadata] => {
      return [component.id, component];
    },
  ),
);

export const lookup: WorkflowComponentLookup = (
  componentId: string,
): ComponentMetadata | undefined => {
  return COMPONENTS_BY_ID.get(componentId);
};

export const getComponent: (componentId: string) => ComponentMetadata = (
  componentId: string,
): ComponentMetadata => {
  const component: ComponentMetadata | undefined =
    COMPONENTS_BY_ID.get(componentId);

  if (!component) {
    throw new Error(`No component ${componentId} in the catalog.`);
  }

  return component;
};

export interface CardSpec {
  key: string;
  stepId: string;
  componentId: string;
  args?: JSONObject | undefined;
  x?: number | undefined;
  y?: number | undefined;
  selected?: boolean | undefined;
  dragging?: boolean | undefined;
  placeholder?: boolean | undefined;
  trigger?: boolean | undefined;
  // What the canvas adds: the catalog entry and what the checks say.
  withCanvasState?: boolean | undefined;
}

export interface ConnectionSpec {
  from: string;
  to: string;
  fromPort?: string | undefined;
  id?: string | undefined;
  styled?: boolean | undefined;
}

export const card: (spec: CardSpec) => JSONObject = (
  spec: CardSpec,
): JSONObject => {
  const data: JSONObject = {
    id: spec.stepId,
    nodeType: spec.placeholder ? NodeType.PlaceholderNode : NodeType.Node,
    componentType: spec.trigger ? ComponentType.Trigger : ComponentType.Component,
    metadataId: spec.componentId,
    internalId: `internal-${spec.key}`,
    arguments: spec.args || {},
  };

  const node: JSONObject = {
    id: spec.key,
    type: "node",
    position: { x: spec.x ?? 96, y: spec.y ?? 96 },
    data,
  };

  if (spec.withCanvasState) {
    node["positionAbsolute"] = { x: spec.x ?? 96, y: spec.y ?? 96 };
    node["width"] = 256;
    node["height"] = 120;
    node["selected"] = Boolean(spec.selected);
    node["dragging"] = Boolean(spec.dragging);
    data["error"] = "Click to set up";
    data["metadata"] = COMPONENTS_BY_ID.get(spec.componentId)
      ? ({
          ...(COMPONENTS_BY_ID.get(spec.componentId) as ComponentMetadata),
        } as unknown as JSONObject)
      : { title: "Trigger" };
  } else if (spec.selected !== undefined || spec.dragging !== undefined) {
    node["selected"] = Boolean(spec.selected);
    node["dragging"] = Boolean(spec.dragging);
  }

  return node;
};

export const connection: (spec: ConnectionSpec) => JSONObject = (
  spec: ConnectionSpec,
): JSONObject => {
  const edge: JSONObject = {
    id: spec.id || `edge-${spec.from}-${spec.to}-${spec.fromPort || "out"}`,
    source: spec.from,
    sourceHandle: spec.fromPort || "out",
    target: spec.to,
    targetHandle: "in",
  };

  if (spec.styled) {
    edge["type"] = "smoothstep";
    edge["animated"] = false;
    edge["style"] = { strokeWidth: "2px" };
    edge["markerEnd"] = { type: "arrowclosed" };
    edge["selected"] = false;
  }

  return edge;
};

export const graphOf: (
  cards: Array<CardSpec>,
  connections?: Array<ConnectionSpec>,
) => { nodes: Array<JSONObject>; edges: Array<JSONObject> } = (
  cards: Array<CardSpec>,
  connections: Array<ConnectionSpec> = [],
): { nodes: Array<JSONObject>; edges: Array<JSONObject> } => {
  return { nodes: cards.map(card), edges: connections.map(connection) };
};

export const MANUAL: CardSpec = {
  key: "card-manual",
  stepId: "manual-1",
  componentId: ComponentID.Manual,
  trigger: true,
  y: 32,
};

export const LOG: CardSpec = {
  key: "card-log",
  stepId: "log-1",
  componentId: ComponentID.Log,
  args: { value: "{{local.components.manual-1.returnValues.value}}" },
  y: 224,
};

export const EMAIL: CardSpec = {
  key: "card-email",
  stepId: "send-email-1",
  componentId: ComponentID.SendEmail,
  args: { to: "oncall@example.com", subject: "Disk full" },
  y: 416,
};

export const IF_ELSE: CardSpec = {
  key: "card-if",
  stepId: "if-else-1",
  componentId: ComponentID.IfElse,
  y: 320,
};

export const PLACEHOLDER: CardSpec = {
  key: "card-placeholder",
  stepId: "",
  componentId: "",
  placeholder: true,
  trigger: true,
};
