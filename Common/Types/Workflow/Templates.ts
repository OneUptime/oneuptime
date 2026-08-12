/*
 * Starter workflows.
 *
 * An empty canvas is a bad first lesson: the thing a new builder most needs to
 * learn is how one step reads another's output, and nothing on a blank graph
 * teaches it. Each template below is a small, working workflow whose whole
 * point is to show a {{local.components.…}} reference in context.
 *
 * Every template here is deliberately runnable with no external configuration
 * — no Slack token, no API key, no third-party account. Templates that need
 * credentials belong in the docs, not in a one-click "start from this".
 *
 * The graphs are plain data in the same shape the builder saves and the JSON
 * import reads, so a template is created through the ordinary Workflow create
 * path (which denormalizes the trigger onto the row in
 * WorkflowService.onCreateSuccess).
 */

import { JSONObject } from "../JSON";
import ComponentID from "./ComponentID";
import { ComponentType, NodeType } from "./Component";

export interface WorkflowTemplate {
  /** Stable key, used by the picker and by tests. */
  id: string;
  name: string;
  /** One line, shown on the card. */
  description: string;
  /** What the builder should look at once it opens. */
  teaches: string;
  /** Suggested name for the created workflow. */
  workflowName: string;
  workflowDescription: string;
}

interface TemplateNodeSpec {
  componentId: string;
  metadataId: string;
  componentType: ComponentType;
  position: { x: number; y: number };
  args?: JSONObject | undefined;
}

interface TemplateEdgeSpec {
  fromComponentId: string;
  toComponentId: string;
  fromPort: string;
}

interface TemplateGraphSpec {
  nodes: Array<TemplateNodeSpec>;
  edges: Array<TemplateEdgeSpec>;
}

/*
 * Node and edge identifiers are generated per creation rather than baked in,
 * so two workflows made from the same template never share react-flow ids.
 * The component ids (the user-facing "log-1") are stable, because that is what
 * the {{...}} references inside the template point at.
 */
export type BuildTemplateGraphFunction = (
  spec: TemplateGraphSpec,
  generateId: () => string,
) => JSONObject;

export const buildTemplateGraph: BuildTemplateGraphFunction = (
  spec: TemplateGraphSpec,
  generateId: () => string,
): JSONObject => {
  const nodeIdByComponentId: Record<string, string> = {};

  const nodes: Array<JSONObject> = spec.nodes.map(
    (node: TemplateNodeSpec): JSONObject => {
      const nodeId: string = generateId();
      nodeIdByComponentId[node.componentId] = nodeId;

      return {
        id: nodeId,
        type: "node",
        position: node.position,
        data: {
          id: node.componentId,
          nodeType: NodeType.Node,
          componentType: node.componentType,
          metadataId: node.metadataId,
          internalId: generateId(),
          error: "",
          arguments: node.args || {},
          returnValues: {},
        },
      };
    },
  );

  const edges: Array<JSONObject> = spec.edges.map(
    (edge: TemplateEdgeSpec): JSONObject => {
      return {
        id: generateId(),
        source: nodeIdByComponentId[edge.fromComponentId] as string,
        target: nodeIdByComponentId[edge.toComponentId] as string,
        sourceHandle: edge.fromPort,
        targetHandle: "in",
      };
    },
  );

  return { nodes: nodes, edges: edges };
};

type TemplateDefinition = WorkflowTemplate & { graph: TemplateGraphSpec };

const TEMPLATE_DEFINITIONS: Array<TemplateDefinition> = [
  {
    id: "manual-log",
    name: "Log a message when run by hand",
    description:
      "The smallest working workflow: a manual trigger and a step that writes a line to the run log.",
    teaches: "How to run a workflow and where its output shows up.",
    workflowName: "Log a message",
    workflowDescription:
      "Runs on demand and writes a line to the run log. A good place to start.",
    graph: {
      nodes: [
        {
          componentId: "manual-1",
          metadataId: ComponentID.Manual,
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
        },
        {
          componentId: "log-1",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            value: "Hello from OneUptime. This workflow ran.",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "manual-1",
          toComponentId: "log-1",
          fromPort: "success",
        },
      ],
    },
  },
  {
    id: "webhook-echo",
    name: "Echo what a webhook sent",
    description:
      "Takes the body posted to this workflow's webhook and writes it back out to the log.",
    /*
     * The reason this template exists: the log message is a reference, not
     * text, and seeing that in place is the fastest way to understand the
     * whole substitution model.
     */
    teaches:
      "How one step reads another's output, using {{local.components...}}.",
    workflowName: "Echo webhook body",
    workflowDescription:
      "Writes whatever was posted to this workflow's webhook into the run log.",
    graph: {
      nodes: [
        {
          componentId: "webhook-1",
          metadataId: ComponentID.Webhook,
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
        },
        {
          componentId: "log-1",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            value:
              "Webhook received: {{local.components.webhook-1.returnValues.request-body}}",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "webhook-1",
          toComponentId: "log-1",
          fromPort: "out",
        },
      ],
    },
  },
  {
    id: "scheduled-check",
    name: "Call an API on a schedule",
    description:
      "Runs every hour, calls a URL, and logs whether it came back OK — with separate paths for success and failure.",
    teaches:
      "How a schedule works, and how a step's Success and Error ports branch.",
    workflowName: "Hourly API check",
    workflowDescription:
      "Calls a URL every hour and logs the outcome. Point the URL at something of yours.",
    graph: {
      nodes: [
        {
          componentId: "schedule-1",
          metadataId: ComponentID.Schedule,
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: {
            schedule: "0 * * * *",
          },
        },
        {
          componentId: "api-get-1",
          metadataId: ComponentID.ApiGet,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            url: "https://api.github.com/zen",
          },
        },
        {
          componentId: "log-ok",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: -100, y: 500 },
          args: {
            value:
              "Responded {{local.components.api-get-1.returnValues.response-status}}: {{local.components.api-get-1.returnValues.response-body}}",
          },
        },
        {
          componentId: "log-failed",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: 300, y: 500 },
          args: {
            value:
              "Call failed: {{local.components.api-get-1.returnValues.error}}",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "schedule-1",
          toComponentId: "api-get-1",
          fromPort: "execute",
        },
        {
          fromComponentId: "api-get-1",
          toComponentId: "log-ok",
          fromPort: "success",
        },
        {
          fromComponentId: "api-get-1",
          toComponentId: "log-failed",
          fromPort: "error",
        },
      ],
    },
  },
];

export type GetWorkflowTemplatesFunction = () => Array<WorkflowTemplate>;

export const getWorkflowTemplates: GetWorkflowTemplatesFunction =
  (): Array<WorkflowTemplate> => {
    return TEMPLATE_DEFINITIONS.map(
      (definition: TemplateDefinition): WorkflowTemplate => {
        return {
          id: definition.id,
          name: definition.name,
          description: definition.description,
          teaches: definition.teaches,
          workflowName: definition.workflowName,
          workflowDescription: definition.workflowDescription,
        };
      },
    );
  };

export type GetTemplateGraphSpecFunction = (
  templateId: string,
) => TemplateGraphSpec | null;

export const getTemplateGraphSpec: GetTemplateGraphSpecFunction = (
  templateId: string,
): TemplateGraphSpec | null => {
  const definition: TemplateDefinition | undefined = TEMPLATE_DEFINITIONS.find(
    (candidate: TemplateDefinition) => {
      return candidate.id === templateId;
    },
  );

  return definition ? definition.graph : null;
};

export type BuildGraphForTemplateFunction = (
  templateId: string,
  generateId: () => string,
) => JSONObject | null;

export const buildGraphForTemplate: BuildGraphForTemplateFunction = (
  templateId: string,
  generateId: () => string,
): JSONObject | null => {
  const spec: TemplateGraphSpec | null = getTemplateGraphSpec(templateId);

  if (!spec) {
    return null;
  }

  return buildTemplateGraph(spec, generateId);
};

export default getWorkflowTemplates;
