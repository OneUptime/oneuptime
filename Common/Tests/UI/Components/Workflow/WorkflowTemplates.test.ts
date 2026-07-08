import {
  WorkflowTemplate,
  WorkflowTemplates,
  buildTemplateGraph,
  TemplateGraph,
} from "../../../../UI/Components/Workflow/WorkflowTemplates";
import StaticComponents from "../../../../Types/Workflow/Components";
import IconProp from "../../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentType,
  NodeType,
} from "../../../../Types/Workflow/Component";
import { describe, expect, test } from "@jest/globals";

const catalog: Array<ComponentMetadata> = [
  {
    id: "schedule",
    title: "Schedule",
    category: "Schedule",
    description: "",
    iconProp: IconProp.Clock,
    componentType: ComponentType.Trigger,
    arguments: [],
    returnValues: [],
    inPorts: [],
    outPorts: [{ id: "execute", title: "Execute", description: "" }],
  },
  {
    id: "slack-send-message-to-channel",
    title: "Send to Slack",
    category: "Slack",
    description: "",
    iconProp: IconProp.Slack,
    componentType: ComponentType.Component,
    arguments: [],
    returnValues: [],
    inPorts: [{ id: "in", title: "In", description: "" }],
    outPorts: [
      { id: "success", title: "Success", description: "" },
      { id: "error", title: "Error", description: "" },
    ],
  },
];

const template: WorkflowTemplate = {
  id: "t",
  name: "Test",
  description: "",
  icon: IconProp.Slack,
  steps: [
    { key: "trigger", metadataId: "schedule", position: { x: 0, y: 0 } },
    {
      key: "slack",
      metadataId: "slack-send-message-to-channel",
      position: { x: 0, y: 100 },
    },
  ],
  connections: [{ from: "trigger", to: "slack" }],
};

describe("WorkflowTemplates.buildTemplateGraph", () => {
  test("builds nodes in the same shape as addToGraph", () => {
    const graph: TemplateGraph | null = buildTemplateGraph(template, catalog);
    expect(graph).not.toBeNull();

    expect(graph!.nodes).toHaveLength(2);
    const trigger: { data: Record<string, unknown> } = graph!
      .nodes[0] as unknown as { data: Record<string, unknown> };
    expect(trigger.data["nodeType"]).toBe(NodeType.Node);
    expect(trigger.data["metadataId"]).toBe("schedule");
    expect(trigger.data["componentType"]).toBe(ComponentType.Trigger);
    expect(trigger.data["id"]).toBe("schedule-1");
    expect(typeof trigger.data["internalId"]).toBe("string");
  });

  test("connects the first out-port to the first in-port", () => {
    const graph: TemplateGraph | null = buildTemplateGraph(template, catalog);
    expect(graph!.edges).toHaveLength(1);
    expect(graph!.edges[0]!.source).toBe(graph!.nodes[0]!.id);
    expect(graph!.edges[0]!.target).toBe(graph!.nodes[1]!.id);
    expect(graph!.edges[0]!.sourceHandle).toBe("execute");
    expect(graph!.edges[0]!.targetHandle).toBe("in");
  });

  test("gives duplicate components distinct data ids", () => {
    const dupTemplate: WorkflowTemplate = {
      ...template,
      steps: [
        { key: "a", metadataId: "schedule", position: { x: 0, y: 0 } },
        { key: "b", metadataId: "schedule", position: { x: 0, y: 100 } },
      ],
      connections: [],
    };
    const graph: TemplateGraph | null = buildTemplateGraph(
      dupTemplate,
      catalog,
    );
    const ids: Array<string> = graph!.nodes.map((n: unknown) => {
      return (n as { data: { id: string } }).data.id;
    });
    expect(ids).toEqual(["schedule-1", "schedule-2"]);
  });

  test("returns null when a referenced component is missing", () => {
    const broken: WorkflowTemplate = {
      ...template,
      steps: [
        {
          key: "trigger",
          metadataId: "does-not-exist",
          position: { x: 0, y: 0 },
        },
      ],
      connections: [],
    };
    expect(buildTemplateGraph(broken, catalog)).toBeNull();
  });
});

describe("WorkflowTemplates definitions", () => {
  test("every shipped template resolves against the real static catalog", () => {
    const realCatalog: Array<ComponentMetadata> =
      StaticComponents as Array<ComponentMetadata>;

    for (const shippedTemplate of WorkflowTemplates) {
      const graph: TemplateGraph | null = buildTemplateGraph(
        shippedTemplate,
        realCatalog,
      );
      // A null result means a metadataId doesn't exist — a broken template.
      expect(graph).not.toBeNull();
      expect(graph!.nodes).toHaveLength(shippedTemplate.steps.length);
      expect(graph!.edges).toHaveLength(shippedTemplate.connections.length);
      // Every connection resolved to real port handles.
      for (const edge of graph!.edges) {
        expect(edge.sourceHandle).toBeTruthy();
        expect(edge.targetHandle).toBeTruthy();
      }
    }
  });
});
