/*
 * Every shipped template is checked against the real component registry and
 * against the same linter the builder runs.
 *
 * A template is the first workflow a lot of people will ever see, so one with
 * a mistyped argument id, a reference to a return value that does not exist,
 * or an edge leaving a port the component does not have would be worse than
 * shipping no templates at all — it teaches the wrong thing and looks broken
 * on arrival. Writing these tests caught exactly that: the Log component's
 * argument is "value" (not "log-message"), the Schedule trigger's is
 * "schedule" (not "schedule-at"), the Manual trigger leaves by "success" and
 * the Schedule trigger by "execute" (neither is "out").
 */

import {
  WorkflowTemplate,
  buildGraphForTemplate,
  getTemplateGraphSpec,
  getWorkflowTemplates,
} from "../../../Types/Workflow/Templates";
import Components from "../../../Types/Workflow/Components";
import ComponentMetadata, {
  Argument,
  ComponentType,
  NodeDataProp,
  Port,
  ReturnValue,
} from "../../../Types/Workflow/Component";
import { JSONObject } from "../../../Types/JSON";
import {
  LintGraphEdge,
  LintGraphNode,
  WorkflowLintIssue,
  WorkflowLintResult,
  WorkflowLintSeverity,
  lintWorkflowGraph,
} from "../../../UI/Components/Workflow/GraphLint";
import { describe, expect, test } from "@jest/globals";

const templates: Array<WorkflowTemplate> = getWorkflowTemplates();

type FindMetadataFunction = (
  metadataId: string,
) => ComponentMetadata | undefined;

const findMetadata: FindMetadataFunction = (
  metadataId: string,
): ComponentMetadata | undefined => {
  return Components.find((component: ComponentMetadata) => {
    return component.id === metadataId;
  });
};

let idCounter: number = 0;

type GenerateIdFunction = () => string;

const generateId: GenerateIdFunction = (): string => {
  idCounter++;
  return `generated-${idCounter}`;
};

/**
 * Build a template's graph and hydrate each node with its real metadata, the
 * way the builder does on load. Without the metadata the linter cannot check
 * arguments or return values.
 */
type HydrateFunction = (templateId: string) => {
  nodes: Array<LintGraphNode>;
  edges: Array<LintGraphEdge>;
};

const hydrate: HydrateFunction = (
  templateId: string,
): { nodes: Array<LintGraphNode>; edges: Array<LintGraphEdge> } => {
  const graph: JSONObject = buildGraphForTemplate(
    templateId,
    generateId,
  ) as JSONObject;

  const rawNodes: Array<JSONObject> = graph["nodes"] as Array<JSONObject>;
  const rawEdges: Array<JSONObject> = graph["edges"] as Array<JSONObject>;

  const nodes: Array<LintGraphNode> = rawNodes.map(
    (node: JSONObject): LintGraphNode => {
      const data: JSONObject = node["data"] as JSONObject;
      const metadata: ComponentMetadata | undefined = findMetadata(
        data["metadataId"] as string,
      );

      return {
        id: node["id"] as string,
        data: {
          ...(data as unknown as NodeDataProp),
          metadata: metadata as ComponentMetadata,
        },
      };
    },
  );

  const edges: Array<LintGraphEdge> = rawEdges.map(
    (edge: JSONObject): LintGraphEdge => {
      return {
        source: edge["source"] as string,
        target: edge["target"] as string,
      };
    },
  );

  return { nodes: nodes, edges: edges };
};

describe("workflow templates", () => {
  test("there is at least one", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  test("each has a unique id", () => {
    const ids: Array<string> = templates.map((template: WorkflowTemplate) => {
      return template.id;
    });

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("each is described well enough to choose between them", () => {
    for (const template of templates) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.teaches.length).toBeGreaterThan(0);
      expect(template.workflowName.length).toBeGreaterThan(0);
      expect(template.workflowDescription.length).toBeGreaterThan(0);
    }
  });

  test("an unknown template id yields nothing rather than throwing", () => {
    expect(getTemplateGraphSpec("does-not-exist")).toBeNull();
    expect(buildGraphForTemplate("does-not-exist", generateId)).toBeNull();
  });
});

describe.each(
  templates.map((template: WorkflowTemplate) => {
    return [template.id, template] as [string, WorkflowTemplate];
  }),
)("template %s", (templateId: string) => {
  test("every component it uses exists in the registry", () => {
    const spec: { nodes: Array<{ metadataId: string }> } = getTemplateGraphSpec(
      templateId,
    ) as { nodes: Array<{ metadataId: string }> };

    for (const node of spec.nodes) {
      expect(findMetadata(node.metadataId)).toBeDefined();
    }
  });

  test("every argument it sets is a real argument on that component", () => {
    const spec: {
      nodes: Array<{ metadataId: string; args?: JSONObject | undefined }>;
    } = getTemplateGraphSpec(templateId) as {
      nodes: Array<{ metadataId: string; args?: JSONObject | undefined }>;
    };

    for (const node of spec.nodes) {
      const metadata: ComponentMetadata = findMetadata(
        node.metadataId,
      ) as ComponentMetadata;

      for (const argumentId of Object.keys(node.args || {})) {
        const argument: Argument | undefined = metadata.arguments.find(
          (candidate: Argument) => {
            return candidate.id === argumentId;
          },
        );

        expect(argument).toBeDefined();
      }
    }
  });

  /*
   * The runner looks up outPorts[sourceHandle] to decide what runs next. A
   * port id that does not exist means the workflow silently stops after the
   * first step.
   */
  test("every edge leaves a port the component actually has", () => {
    const spec: {
      nodes: Array<{ componentId: string; metadataId: string }>;
      edges: Array<{ fromComponentId: string; fromPort: string }>;
    } = getTemplateGraphSpec(templateId) as {
      nodes: Array<{ componentId: string; metadataId: string }>;
      edges: Array<{ fromComponentId: string; fromPort: string }>;
    };

    for (const edge of spec.edges) {
      const node: { metadataId: string } = spec.nodes.find(
        (candidate: { componentId: string }) => {
          return candidate.componentId === edge.fromComponentId;
        },
      ) as { metadataId: string };

      const metadata: ComponentMetadata = findMetadata(
        node.metadataId,
      ) as ComponentMetadata;

      const port: Port | undefined = metadata.outPorts.find(
        (candidate: Port) => {
          return candidate.id === edge.fromPort;
        },
      );

      expect(port).toBeDefined();
    }
  });

  test("every required argument is filled in", () => {
    const spec: {
      nodes: Array<{ metadataId: string; args?: JSONObject | undefined }>;
    } = getTemplateGraphSpec(templateId) as {
      nodes: Array<{ metadataId: string; args?: JSONObject | undefined }>;
    };

    for (const node of spec.nodes) {
      const metadata: ComponentMetadata = findMetadata(
        node.metadataId,
      ) as ComponentMetadata;

      for (const argument of metadata.arguments) {
        if (!argument.required) {
          continue;
        }

        expect(Object.keys(node.args || {})).toContain(argument.id);
      }
    }
  });

  test("every {{...}} reference points at a return value that exists", () => {
    const spec: {
      nodes: Array<{ componentId: string; metadataId: string }>;
    } = getTemplateGraphSpec(templateId) as {
      nodes: Array<{ componentId: string; metadataId: string }>;
    };

    const graph: { nodes: Array<LintGraphNode>; edges: Array<LintGraphEdge> } =
      hydrate(templateId);

    const references: Array<string> = [];

    for (const node of graph.nodes) {
      for (const value of Object.values(node.data.arguments || {})) {
        if (typeof value !== "string") {
          continue;
        }

        const matches: Array<string> = value.match(/{{(.*?)}}/g) || [];
        references.push(...matches);
      }
    }

    for (const reference of references) {
      const path: string = reference.slice(2, -2);
      const parts: Array<string> = path.split(".");

      expect(parts[0]).toBe("local");
      expect(parts[1]).toBe("components");

      const referencedNode: { metadataId: string } = spec.nodes.find(
        (candidate: { componentId: string }) => {
          return candidate.componentId === parts[2];
        },
      ) as { metadataId: string };

      expect(referencedNode).toBeDefined();
      expect(parts[3]).toBe("returnValues");

      const metadata: ComponentMetadata = findMetadata(
        referencedNode.metadataId,
      ) as ComponentMetadata;

      const returnValue: ReturnValue | undefined = metadata.returnValues.find(
        (candidate: ReturnValue) => {
          return candidate.id === parts[4];
        },
      );

      expect(returnValue).toBeDefined();
    }
  });

  /*
   * The end-to-end check: run the shipped template through the same linter the
   * builder applies to a graph someone is editing. Zero errors is the bar.
   */
  test("passes the builder's own graph checks with no errors", () => {
    const result: WorkflowLintResult = lintWorkflowGraph(hydrate(templateId));

    const errors: Array<WorkflowLintIssue> = result.issues.filter(
      (issue: WorkflowLintIssue) => {
        return issue.severity === WorkflowLintSeverity.Error;
      },
    );

    expect(
      errors.map((issue: WorkflowLintIssue) => {
        return issue.message;
      }),
    ).toEqual([]);
  });

  test("has exactly one trigger, and it is a real trigger component", () => {
    const spec: {
      nodes: Array<{ metadataId: string; componentType: ComponentType }>;
    } = getTemplateGraphSpec(templateId) as {
      nodes: Array<{ metadataId: string; componentType: ComponentType }>;
    };

    const triggers: Array<{ metadataId: string }> = spec.nodes.filter(
      (node: { componentType: ComponentType }) => {
        return node.componentType === ComponentType.Trigger;
      },
    );

    expect(triggers).toHaveLength(1);

    const metadata: ComponentMetadata = findMetadata(
      triggers[0]?.metadataId as string,
    ) as ComponentMetadata;

    expect(metadata.componentType).toBe(ComponentType.Trigger);
  });

  /*
   * Two workflows created from one template must not share react-flow ids, or
   * editing one would be liable to disturb the other on import/export.
   */
  test("builds fresh node ids each time", () => {
    const first: JSONObject = buildGraphForTemplate(
      templateId,
      generateId,
    ) as JSONObject;
    const second: JSONObject = buildGraphForTemplate(
      templateId,
      generateId,
    ) as JSONObject;

    const firstIds: Array<string> = (first["nodes"] as Array<JSONObject>).map(
      (node: JSONObject) => {
        return node["id"] as string;
      },
    );
    const secondIds: Array<string> = (second["nodes"] as Array<JSONObject>).map(
      (node: JSONObject) => {
        return node["id"] as string;
      },
    );

    for (const id of firstIds) {
      expect(secondIds).not.toContain(id);
    }
  });

  test("keeps stable component ids, because references point at them", () => {
    const first: JSONObject = buildGraphForTemplate(
      templateId,
      generateId,
    ) as JSONObject;
    const second: JSONObject = buildGraphForTemplate(
      templateId,
      generateId,
    ) as JSONObject;

    type ComponentIdsFunction = (graph: JSONObject) => Array<string>;

    const componentIds: ComponentIdsFunction = (
      graph: JSONObject,
    ): Array<string> => {
      return (graph["nodes"] as Array<JSONObject>).map((node: JSONObject) => {
        return (node["data"] as JSONObject)["id"] as string;
      });
    };

    expect(componentIds(first)).toEqual(componentIds(second));
  });

  test("edges connect nodes that are in the graph", () => {
    const graph: JSONObject = buildGraphForTemplate(
      templateId,
      generateId,
    ) as JSONObject;

    const nodeIds: Array<string> = (graph["nodes"] as Array<JSONObject>).map(
      (node: JSONObject) => {
        return node["id"] as string;
      },
    );

    for (const edge of graph["edges"] as Array<JSONObject>) {
      expect(nodeIds).toContain(edge["source"] as string);
      expect(nodeIds).toContain(edge["target"] as string);
    }
  });
});
