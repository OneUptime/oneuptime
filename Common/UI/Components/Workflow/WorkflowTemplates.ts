import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ComponentID from "../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
  Port,
} from "../../../Types/Workflow/Component";
import { Edge, Node } from "reactflow";

/*
 * Starter templates for the blank-canvas cold start. A template is an
 * engine-agnostic recipe (which components, where, and how they connect);
 * buildTemplateGraph turns it into the exact node/edge shape the builder
 * already produces in addToGraph (Workflow.tsx), by looking each component up
 * in the live catalog. Only static components are used, so there's no
 * per-model id-fidelity risk.
 */

export interface TemplateStep {
  key: string;
  metadataId: string;
  position: { x: number; y: number };
  arguments?: JSONObject | undefined;
}

export interface TemplateConnection {
  from: string;
  to: string;
  // Defaults to the source's first out-port / target's first in-port.
  fromPort?: string | undefined;
  toPort?: string | undefined;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  icon: IconProp;
  steps: Array<TemplateStep>;
  connections: Array<TemplateConnection>;
}

export const WorkflowTemplates: Array<WorkflowTemplate> = [
  {
    id: "scheduled-slack",
    name: "Scheduled Slack message",
    description: "On a schedule, post a message to a Slack channel.",
    icon: IconProp.Slack,
    steps: [
      {
        key: "trigger",
        metadataId: ComponentID.Schedule,
        position: { x: 150, y: 60 },
        arguments: { schedule: "0 9 * * *" },
      },
      {
        key: "slack",
        metadataId: ComponentID.SlackSendMessageToChannel,
        position: { x: 150, y: 300 },
      },
    ],
    connections: [{ from: "trigger", to: "slack" }],
  },
  {
    id: "scheduled-email",
    name: "Scheduled email",
    description: "On a schedule, send an email.",
    icon: IconProp.Email,
    steps: [
      {
        key: "trigger",
        metadataId: ComponentID.Schedule,
        position: { x: 150, y: 60 },
        arguments: { schedule: "0 9 * * *" },
      },
      {
        key: "email",
        metadataId: ComponentID.SendEmail,
        position: { x: 150, y: 300 },
      },
    ],
    connections: [{ from: "trigger", to: "email" }],
  },
  {
    id: "webhook-to-slack",
    name: "Webhook to Slack",
    description: "When your webhook is called, post a message to Slack.",
    icon: IconProp.SendMessage,
    steps: [
      {
        key: "trigger",
        metadataId: ComponentID.Webhook,
        position: { x: 150, y: 60 },
      },
      {
        key: "slack",
        metadataId: ComponentID.SlackSendMessageToChannel,
        position: { x: 150, y: 300 },
      },
    ],
    connections: [{ from: "trigger", to: "slack" }],
  },
];

type FirstPortIdFunction = (
  ports: Array<Port> | undefined,
) => string | undefined;

const firstPortId: FirstPortIdFunction = (
  ports: Array<Port> | undefined,
): string | undefined => {
  return ports && ports.length > 0 ? ports[0]!.id : undefined;
};

export interface TemplateGraph {
  nodes: Array<Node>;
  edges: Array<Edge>;
}

export type BuildTemplateGraphFunction = (
  template: WorkflowTemplate,
  catalog: Array<ComponentMetadata>,
) => TemplateGraph | null;

/*
 * Build the concrete graph for a template. Returns null if any referenced
 * component isn't in the catalog (so we never drop a broken template onto the
 * canvas). Node shape mirrors addToGraph exactly.
 */
export const buildTemplateGraph: BuildTemplateGraphFunction = (
  template: WorkflowTemplate,
  catalog: Array<ComponentMetadata>,
): TemplateGraph | null => {
  const keyToNodeId: Record<string, string> = {};
  const keyToMetadata: Record<string, ComponentMetadata> = {};
  const idCounters: Record<string, number> = {};
  const nodes: Array<Node> = [];

  for (const step of template.steps) {
    const metadata: ComponentMetadata | undefined = catalog.find(
      (c: ComponentMetadata) => {
        return c.id === step.metadataId;
      },
    );

    if (!metadata) {
      return null;
    }

    idCounters[step.metadataId] = (idCounters[step.metadataId] || 0) + 1;
    const reactFlowId: string = ObjectID.generate().toString();
    keyToNodeId[step.key] = reactFlowId;
    keyToMetadata[step.key] = metadata;

    const data: NodeDataProp = {
      nodeType: NodeType.Node,
      id: `${step.metadataId}-${idCounters[step.metadataId]}`,
      error: "",
      metadata: { ...metadata },
      metadataId: metadata.id,
      internalId: ObjectID.generate().toString(),
      componentType: metadata.componentType,
      arguments: step.arguments || {},
      returnValues: {},
    };

    nodes.push({
      id: reactFlowId,
      type: "node",
      position: step.position,
      selected: false,
      data: data,
    });
  }

  const edges: Array<Edge> = [];
  for (const connection of template.connections) {
    const source: string | undefined = keyToNodeId[connection.from];
    const target: string | undefined = keyToNodeId[connection.to];
    if (!source || !target) {
      continue;
    }

    edges.push({
      id: ObjectID.generate().toString(),
      source: source,
      target: target,
      sourceHandle:
        connection.fromPort ||
        firstPortId(keyToMetadata[connection.from]?.outPorts) ||
        null,
      targetHandle:
        connection.toPort ||
        firstPortId(keyToMetadata[connection.to]?.inPorts) ||
        null,
    });
  }

  return { nodes: nodes, edges: edges };
};
