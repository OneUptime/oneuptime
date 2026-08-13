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
 *
 * Two things here are load-bearing and easy to get wrong when extending this
 * file:
 *
 *   1. The registry is the MERGED one (loadComponentsAndCategories), not the
 *      static Components array. Templates use database-model components like
 *      `incident-on-create`, which only exist in the merged registry. Against
 *      the static array those nodes get `metadata: undefined`, the linter's
 *      isRealNode silently drops them, and the lint test passes on a graph it
 *      never checked.
 *
 *   2. References are classified with parseReferencePath rather than by
 *      assuming every {{...}} is local.components.*. Templates now also carry
 *      {{local.variables.*}}, and a test that assumes otherwise fails on
 *      correct templates.
 */

import {
  WORKFLOW_TEMPLATE_VARIABLE_NAME_REGEX,
  WorkflowTemplate,
  WorkflowTemplateCategories,
  WorkflowTemplateCategory,
  WorkflowTemplateVariable,
  buildGraphForTemplate,
  getTemplateGraphSpec,
  getWorkflowTemplate,
  getWorkflowTemplates,
  getWorkflowTemplatesByCategory,
} from "../../../Types/Workflow/Templates";
import ComponentMetadata, {
  Argument,
  ComponentType,
  NodeDataProp,
  Port,
  ReturnValue,
} from "../../../Types/Workflow/Component";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import IconProp from "../../../Types/Icon/IconProp";
import {
  LintGraphEdge,
  LintGraphNode,
  WorkflowLintIssue,
  WorkflowLintResult,
  WorkflowLintSeverity,
  lintWorkflowGraph,
} from "../../../UI/Components/Workflow/GraphLint";
import { loadComponentsAndCategories } from "../../../UI/Components/Workflow/Utils";
import {
  ParsedReferencePath,
  ReferenceRootType,
  TemplateExpression,
  TemplateExpressionKind,
  parseReferencePath,
  parseTemplateExpressions,
} from "../../../Types/Workflow/TemplateSyntax";
import { describe, expect, test } from "@jest/globals";

const templates: Array<WorkflowTemplate> = getWorkflowTemplates();

/*
 * The same registry the builder loads: static components plus one set per
 * database model. Built once — it walks every entity in the models index.
 */
const registry: Array<ComponentMetadata> =
  loadComponentsAndCategories().components;

type FindMetadataFunction = (
  metadataId: string,
) => ComponentMetadata | undefined;

const findMetadata: FindMetadataFunction = (
  metadataId: string,
): ComponentMetadata | undefined => {
  return registry.find((component: ComponentMetadata) => {
    return component.id === metadataId;
  });
};

let idCounter: number = 0;

type GenerateIdFunction = () => string;

const generateId: GenerateIdFunction = (): string => {
  idCounter++;
  return `generated-${idCounter}`;
};

interface TemplateNodeSpec {
  componentId: string;
  metadataId: string;
  componentType: ComponentType;
  args?: JSONObject | undefined;
}

interface TemplateEdgeSpec {
  fromComponentId: string;
  toComponentId: string;
  fromPort: string;
}

interface TemplateSpec {
  nodes: Array<TemplateNodeSpec>;
  edges: Array<TemplateEdgeSpec>;
}

type SpecOfFunction = (templateId: string) => TemplateSpec;

const specOf: SpecOfFunction = (templateId: string): TemplateSpec => {
  return getTemplateGraphSpec(templateId) as unknown as TemplateSpec;
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

/** Every string an argument holds, including strings nested inside JSON objects. */
type CollectStringsFunction = (value: JSONValue | undefined) => Array<string>;

const collectStrings: CollectStringsFunction = (
  value: JSONValue | undefined,
): Array<string> => {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry: JSONValue) => {
      return collectStrings(entry);
    });
  }

  if (value && typeof value === "object") {
    return Object.values(value as JSONObject).flatMap((entry: JSONValue) => {
      return collectStrings(entry);
    });
  }

  return [];
};

interface TemplateReference {
  /** The full {{...}} text. */
  raw: string;
  inner: string;
  parsed: ParsedReferencePath;
  /** The component id the argument lives on. */
  onComponentId: string;
}

type ReferencesOfFunction = (templateId: string) => Array<TemplateReference>;

const referencesOf: ReferencesOfFunction = (
  templateId: string,
): Array<TemplateReference> => {
  const spec: TemplateSpec = specOf(templateId);
  const references: Array<TemplateReference> = [];

  for (const node of spec.nodes) {
    for (const value of Object.values(node.args || {})) {
      for (const text of collectStrings(value as JSONValue)) {
        const expressions: Array<TemplateExpression> =
          parseTemplateExpressions(text);

        for (const expression of expressions) {
          if (expression.kind !== TemplateExpressionKind.Reference) {
            continue;
          }

          references.push({
            raw: expression.raw,
            inner: expression.inner,
            parsed: parseReferencePath(expression.inner),
            onComponentId: node.componentId,
          });
        }
      }
    }
  }

  return references;
};

/**
 * Whether a trigger's `select` argument actually asks for the field a
 * reference reads. The runtime only hydrates what `select` names, so
 * {{…returnValues.model.title}} against a select without `title` resolves to
 * nothing — and an unresolved reference is not an error, it just ships the
 * literal braces.
 */
type SelectCoversFunction = (
  select: JSONValue | undefined,
  path: Array<string>,
) => boolean;

const selectCovers: SelectCoversFunction = (
  select: JSONValue | undefined,
  path: Array<string>,
): boolean => {
  if (path.length === 0) {
    return true;
  }

  // The runtime always adds _id to the select it issues.
  if (path.length === 1 && (path[0] === "_id" || path[0] === "id")) {
    return true;
  }

  if (!select || typeof select !== "object" || Array.isArray(select)) {
    return false;
  }

  const head: string = path[0] as string;
  const branch: JSONValue | undefined = (select as JSONObject)[head];

  if (branch === undefined) {
    return false;
  }

  if (path.length === 1) {
    return Boolean(branch);
  }

  return selectCovers(branch, path.slice(1));
};

describe("workflow templates", () => {
  test("there are plenty to choose from", () => {
    expect(templates.length).toBeGreaterThan(10);
  });

  test("each has a unique id", () => {
    const ids: Array<string> = templates.map((template: WorkflowTemplate) => {
      return template.id;
    });

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("each id is dash-cased, so it is safe in a URL and in a test name", () => {
    for (const template of templates) {
      expect(template.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  test("each suggests a distinct workflow name", () => {
    const names: Array<string> = templates.map((template: WorkflowTemplate) => {
      return template.workflowName;
    });

    expect(new Set(names).size).toBe(names.length);
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

  test("each belongs to a category the picker knows how to show", () => {
    for (const template of templates) {
      expect(WorkflowTemplateCategories).toContain(template.category);
    }
  });

  test("each category in the picker has at least one template", () => {
    for (const category of WorkflowTemplateCategories) {
      expect(getWorkflowTemplatesByCategory(category).length).toBeGreaterThan(
        0,
      );
    }
  });

  test("grouping by category accounts for every template exactly once", () => {
    const grouped: Array<WorkflowTemplate> = WorkflowTemplateCategories.flatMap(
      (category: WorkflowTemplateCategory) => {
        return getWorkflowTemplatesByCategory(category);
      },
    );

    expect(grouped).toHaveLength(templates.length);
  });

  test("each has an icon that exists", () => {
    const iconValues: Array<string> = Object.values(IconProp);

    for (const template of templates) {
      expect(iconValues).toContain(template.icon);
    }
  });

  test("getWorkflowTemplate finds each one, and nothing else", () => {
    for (const template of templates) {
      expect(getWorkflowTemplate(template.id)?.name).toBe(template.name);
    }

    expect(getWorkflowTemplate("does-not-exist")).toBeNull();
  });

  test("an unknown template id yields nothing rather than throwing", () => {
    expect(getTemplateGraphSpec("does-not-exist")).toBeNull();
    expect(buildGraphForTemplate("does-not-exist", generateId)).toBeNull();
  });

  test("the public template carries no graph, so the picker cannot depend on one", () => {
    for (const template of templates) {
      expect((template as unknown as JSONObject)["graph"]).toBeUndefined();
    }
  });

  /*
   * Every field on WorkflowTemplate has to survive the trip out of the module.
   * The accessor used to hand-enumerate its output fields, which silently
   * dropped anything newly added — the picker would render a card with no icon
   * and the wizard would show no variables step.
   */
  test("no declared field is dropped on the way out", () => {
    for (const template of templates) {
      expect(Object.keys(template).sort()).toEqual(
        [
          "category",
          "description",
          "icon",
          "id",
          "name",
          "teaches",
          "variables",
          "workflowDescription",
          "workflowName",
        ].sort(),
      );
    }
  });
});

describe("workflow template variables", () => {
  test("names are usable in a reference path", () => {
    for (const template of templates) {
      for (const variable of template.variables) {
        expect(variable.name).toMatch(WORKFLOW_TEMPLATE_VARIABLE_NAME_REGEX);
      }
    }
  });

  /*
   * A dot is fatal specifically: VMUtil.deepFind splits the whole path on
   * dots, so local.variables.slack.url looks for a variable called "slack".
   */
  test("no name contains a dot or whitespace", () => {
    for (const template of templates) {
      for (const variable of template.variables) {
        expect(variable.name).not.toContain(".");
        expect(variable.name).not.toMatch(/\s/);
      }
    }
  });

  test("names are unique within a template, because they become one row each", () => {
    for (const template of templates) {
      const names: Array<string> = template.variables.map(
        (variable: WorkflowTemplateVariable) => {
          return variable.name;
        },
      );

      expect(new Set(names).size).toBe(names.length);
    }
  });

  test("each is described well enough to fill in", () => {
    for (const template of templates) {
      for (const variable of template.variables) {
        expect(variable.title.length).toBeGreaterThan(0);
        expect(variable.description.length).toBeGreaterThan(0);
        expect(variable.placeholder.length).toBeGreaterThan(0);
        expect(typeof variable.required).toBe("boolean");
        expect(typeof variable.isSecret).toBe("boolean");
      }
    }
  });

  /*
   * A variable name is reused across templates on purpose (slackWebhookUrl
   * appears in many), and each template is free to label and explain it in its
   * own words — "URL to call" reads better on an hourly poll than "URL to
   * check" does. Variables are workflow-scoped, so two templates never share a
   * row, and nothing forces the wording to agree.
   *
   * What must NOT drift is the behaviour attached to the name. `required`
   * decides whether a row is written at all, and `isSecret` decides whether
   * the value is redacted from run logs. The same field being secret in one
   * template and not in another is a bug, not a wording choice.
   */
  test("a name reused across templates behaves the same way", () => {
    const byName: Map<string, { required: boolean; isSecret: boolean }> =
      new Map();

    for (const template of templates) {
      for (const variable of template.variables) {
        const behaviour: { required: boolean; isSecret: boolean } = {
          required: variable.required,
          isSecret: variable.isSecret,
        };

        const seen: { required: boolean; isSecret: boolean } | undefined =
          byName.get(variable.name);

        if (!seen) {
          byName.set(variable.name, behaviour);
          continue;
        }

        expect({ name: variable.name, ...behaviour }).toEqual({
          name: variable.name,
          ...seen,
        });
      }
    }
  });

  test("secrets are the ones that should be secret", () => {
    for (const template of templates) {
      for (const variable of template.variables) {
        if (!variable.isSecret) {
          continue;
        }

        expect(variable.title.toLowerCase()).toMatch(
          /url|token|password|key|secret/,
        );
      }
    }
  });
});

describe.each(
  templates.map((template: WorkflowTemplate) => {
    return [template.id, template] as [string, WorkflowTemplate];
  }),
)("template %s", (templateId: string, template: WorkflowTemplate) => {
  test("every component it uses exists in the registry", () => {
    for (const node of specOf(templateId).nodes) {
      expect({
        metadataId: node.metadataId,
        found: Boolean(findMetadata(node.metadataId)),
      }).toEqual({ metadataId: node.metadataId, found: true });
    }
  });

  /*
   * The builder throws BadDataException on load for a node whose metadataId is
   * not in the registry, which breaks the whole page rather than one node. So
   * a typo here does not degrade a template, it bricks it.
   */
  test("the node's declared componentType matches the registry's", () => {
    for (const node of specOf(templateId).nodes) {
      const metadata: ComponentMetadata = findMetadata(
        node.metadataId,
      ) as ComponentMetadata;

      expect(node.componentType).toBe(metadata.componentType);
    }
  });

  test("every argument it sets is a real argument on that component", () => {
    for (const node of specOf(templateId).nodes) {
      const metadata: ComponentMetadata = findMetadata(
        node.metadataId,
      ) as ComponentMetadata;

      for (const argumentId of Object.keys(node.args || {})) {
        const argument: Argument | undefined = metadata.arguments.find(
          (candidate: Argument) => {
            return candidate.id === argumentId;
          },
        );

        expect({
          node: node.componentId,
          argumentId: argumentId,
          found: Boolean(argument),
        }).toEqual({
          node: node.componentId,
          argumentId: argumentId,
          found: true,
        });
      }
    }
  });

  test("every required argument is filled in", () => {
    for (const node of specOf(templateId).nodes) {
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

  /*
   * The runner looks up outPorts[sourceHandle] to decide what runs next. A
   * port id that does not exist means the workflow silently stops after the
   * first step.
   */
  test("every edge leaves a port the component actually has", () => {
    const spec: TemplateSpec = specOf(templateId);

    for (const edge of spec.edges) {
      const node: TemplateNodeSpec = spec.nodes.find(
        (candidate: TemplateNodeSpec) => {
          return candidate.componentId === edge.fromComponentId;
        },
      ) as TemplateNodeSpec;

      const metadata: ComponentMetadata = findMetadata(
        node.metadataId,
      ) as ComponentMetadata;

      const port: Port | undefined = metadata.outPorts.find(
        (candidate: Port) => {
          return candidate.id === edge.fromPort;
        },
      );

      expect({
        from: edge.fromComponentId,
        port: edge.fromPort,
        found: Boolean(port),
      }).toEqual({
        from: edge.fromComponentId,
        port: edge.fromPort,
        found: true,
      });
    }
  });

  test("every edge connects component ids the template declares", () => {
    const spec: TemplateSpec = specOf(templateId);

    const componentIds: Array<string> = spec.nodes.map(
      (node: TemplateNodeSpec) => {
        return node.componentId;
      },
    );

    for (const edge of spec.edges) {
      expect(componentIds).toContain(edge.fromComponentId);
      expect(componentIds).toContain(edge.toComponentId);
    }
  });

  test("component ids are unique and dot-free", () => {
    const componentIds: Array<string> = specOf(templateId).nodes.map(
      (node: TemplateNodeSpec) => {
        return node.componentId;
      },
    );

    expect(new Set(componentIds).size).toBe(componentIds.length);

    for (const componentId of componentIds) {
      expect(componentId).not.toContain(".");
    }
  });

  test("has exactly one trigger, and it is a real trigger component", () => {
    const triggers: Array<TemplateNodeSpec> = specOf(templateId).nodes.filter(
      (node: TemplateNodeSpec) => {
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
   * saveTriggerFromGraph takes the LAST trigger node in the graph while the
   * runner takes the FIRST, so a second trigger would denormalize one id and
   * run another.
   */
  test("no node other than the trigger is a trigger", () => {
    const spec: TemplateSpec = specOf(templateId);

    for (const node of spec.nodes) {
      const metadata: ComponentMetadata = findMetadata(
        node.metadataId,
      ) as ComponentMetadata;

      if (node.componentType === ComponentType.Trigger) {
        continue;
      }

      expect(metadata.componentType).not.toBe(ComponentType.Trigger);
    }
  });

  test("every reference is a root the runtime actually has", () => {
    for (const reference of referencesOf(templateId)) {
      expect({
        reference: reference.raw,
        rootType: reference.parsed.rootType,
      }).not.toEqual({
        reference: reference.raw,
        rootType: ReferenceRootType.Unknown,
      });
    }
  });

  /*
   * The runtime hands the raw capture to deepFind without trimming, so a space
   * inside the braces resolves to nothing. The linter calls it an error too.
   */
  test("no reference has whitespace inside its braces", () => {
    for (const reference of referencesOf(templateId)) {
      expect(reference.raw).toBe(`{{${reference.inner}}}`);
      expect(reference.inner).not.toMatch(/\s/);
    }
  });

  test("every component reference points at a component in this template", () => {
    const componentIds: Array<string> = specOf(templateId).nodes.map(
      (node: TemplateNodeSpec) => {
        return node.componentId;
      },
    );

    for (const reference of referencesOf(templateId)) {
      if (
        reference.parsed.rootType !== ReferenceRootType.ComponentReturnValue
      ) {
        continue;
      }

      expect(componentIds).toContain(reference.parsed.componentId);
    }
  });

  test("every component reference points at a return value that exists", () => {
    const spec: TemplateSpec = specOf(templateId);

    for (const reference of referencesOf(templateId)) {
      if (
        reference.parsed.rootType !== ReferenceRootType.ComponentReturnValue
      ) {
        continue;
      }

      const referenced: TemplateNodeSpec = spec.nodes.find(
        (node: TemplateNodeSpec) => {
          return node.componentId === reference.parsed.componentId;
        },
      ) as TemplateNodeSpec;

      const metadata: ComponentMetadata = findMetadata(
        referenced.metadataId,
      ) as ComponentMetadata;

      const returnValue: ReturnValue | undefined = metadata.returnValues.find(
        (candidate: ReturnValue) => {
          return candidate.id === reference.parsed.returnValueId;
        },
      );

      expect({
        reference: reference.raw,
        found: Boolean(returnValue),
      }).toEqual({ reference: reference.raw, found: true });
    }
  });

  /*
   * The one that catches the subtlest template bug there is. A database
   * trigger only hydrates the columns its `select` names, so reading
   * .model.title without asking for `title` yields nothing — and yielding
   * nothing is not an error anywhere in the stack. The run succeeds and posts
   * "Incident: {{local.components.…}}" to Slack.
   */
  test("every field read off a database record was asked for in select", () => {
    const spec: TemplateSpec = specOf(templateId);

    for (const reference of referencesOf(templateId)) {
      if (
        reference.parsed.rootType !== ReferenceRootType.ComponentReturnValue
      ) {
        continue;
      }

      if (reference.parsed.returnValueId !== "model") {
        continue;
      }

      const referenced: TemplateNodeSpec = spec.nodes.find(
        (node: TemplateNodeSpec) => {
          return node.componentId === reference.parsed.componentId;
        },
      ) as TemplateNodeSpec;

      const select: JSONValue | undefined = (referenced.args || {})[
        "select"
      ] as JSONValue | undefined;

      const segments: Array<string> = reference.inner.split(".");
      // local . components . <id> . returnValues . model . <field...>
      const fieldPath: Array<string> = segments.slice(5);

      if (fieldPath.length === 0) {
        continue;
      }

      expect({
        reference: reference.raw,
        covered: selectCovers(select, fieldPath),
      }).toEqual({ reference: reference.raw, covered: true });
    }
  });

  test("every variable it declares is actually used by the graph", () => {
    const used: Set<string> = new Set(
      referencesOf(templateId)
        .filter((reference: TemplateReference) => {
          return reference.parsed.rootType === ReferenceRootType.LocalVariable;
        })
        .map((reference: TemplateReference) => {
          return reference.parsed.variableName as string;
        }),
    );

    for (const variable of template.variables) {
      expect({
        variable: variable.name,
        used: used.has(variable.name),
      }).toEqual({ variable: variable.name, used: true });
    }
  });

  /*
   * The inverse, and the more dangerous direction: a reference to a variable
   * the wizard never asks for means no row is ever written for it, and the
   * literal braces ship.
   */
  test("every variable the graph references is declared by the template", () => {
    const declared: Array<string> = template.variables.map(
      (variable: WorkflowTemplateVariable) => {
        return variable.name;
      },
    );

    for (const reference of referencesOf(templateId)) {
      if (reference.parsed.rootType !== ReferenceRootType.LocalVariable) {
        continue;
      }

      expect({
        reference: reference.raw,
        declared: declared.includes(reference.parsed.variableName as string),
      }).toEqual({ reference: reference.raw, declared: true });
    }
  });

  /*
   * The wizard only ever writes workflow-scoped variables, so a template
   * reaching for a project-global one would silently find nothing.
   */
  test("it does not reach for project-global variables", () => {
    for (const reference of referencesOf(templateId)) {
      expect(reference.parsed.rootType).not.toBe(
        ReferenceRootType.GlobalVariable,
      );
    }
  });

  /*
   * An optional variable's reference must be the ENTIRE argument value. That
   * is what lets the wizard drop the argument when the field is left blank; a
   * reference embedded in a longer string would survive the strip and leave
   * the braces behind in the saved workflow.
   */
  test("an optional variable's reference is the whole argument, so it can be dropped", () => {
    for (const variable of template.variables) {
      if (variable.required) {
        continue;
      }

      const spec: TemplateSpec = specOf(templateId);
      const token: string = `{{local.variables.${variable.name}}}`;

      for (const node of spec.nodes) {
        for (const value of Object.values(node.args || {})) {
          if (typeof value !== "string" || !value.includes(token)) {
            continue;
          }

          expect(value.trim()).toBe(token);
        }
      }
    }
  });

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

  /*
   * Warnings too. UnreachableComponent is only a warning, so without this a
   * template could ship with a stray node that never runs and no test would
   * notice.
   */
  test("passes the builder's own graph checks with no warnings either", () => {
    const result: WorkflowLintResult = lintWorkflowGraph(hydrate(templateId));

    expect(
      result.issues.map((issue: WorkflowLintIssue) => {
        return issue.message;
      }),
    ).toEqual([]);
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

  test("builds fresh edge ids each time too", () => {
    type EdgeIdsFunction = (graph: JSONObject) => Array<string>;

    const edgeIds: EdgeIdsFunction = (graph: JSONObject): Array<string> => {
      return (graph["edges"] as Array<JSONObject>).map((edge: JSONObject) => {
        return edge["id"] as string;
      });
    };

    const first: Array<string> = edgeIds(
      buildGraphForTemplate(templateId, generateId) as JSONObject,
    );
    const second: Array<string> = edgeIds(
      buildGraphForTemplate(templateId, generateId) as JSONObject,
    );

    for (const id of first) {
      expect(second).not.toContain(id);
    }
  });

  test("keeps stable component ids, because references point at them", () => {
    type ComponentIdsFunction = (graph: JSONObject) => Array<string>;

    const componentIds: ComponentIdsFunction = (
      graph: JSONObject,
    ): Array<string> => {
      return (graph["nodes"] as Array<JSONObject>).map((node: JSONObject) => {
        return (node["data"] as JSONObject)["id"] as string;
      });
    };

    expect(
      componentIds(buildGraphForTemplate(templateId, generateId) as JSONObject),
    ).toEqual(
      componentIds(buildGraphForTemplate(templateId, generateId) as JSONObject),
    );
  });

  /*
   * A built graph gets edited afterwards — by the wizard stripping arguments
   * for blank optional variables, and by the builder. Sharing the argument
   * object with the shipped definition would let that editing leak into every
   * later workflow built in the same process.
   */
  test("built graphs do not share argument objects with the definition", () => {
    const first: JSONObject = buildGraphForTemplate(
      templateId,
      generateId,
    ) as JSONObject;
    const second: JSONObject = buildGraphForTemplate(
      templateId,
      generateId,
    ) as JSONObject;

    const argumentsOf: (graph: JSONObject, index: number) => JSONObject = (
      graph: JSONObject,
      index: number,
    ): JSONObject => {
      const node: JSONObject = (graph["nodes"] as Array<JSONObject>)[
        index
      ] as JSONObject;

      return (node["data"] as JSONObject)["arguments"] as JSONObject;
    };

    const firstArguments: JSONObject = argumentsOf(first, 0);

    (firstArguments as JSONObject)["__scribbled"] = "yes";

    expect(argumentsOf(second, 0)["__scribbled"]).toBeUndefined();
    expect(
      (specOf(templateId).nodes[0]?.args || {})["__scribbled"],
    ).toBeUndefined();
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

  test("every edge targets the in port, which is what react-flow attaches to", () => {
    const graph: JSONObject = buildGraphForTemplate(
      templateId,
      generateId,
    ) as JSONObject;

    for (const edge of graph["edges"] as Array<JSONObject>) {
      expect(edge["targetHandle"]).toBe("in");
    }
  });

  test("every non-trigger node has an in port for that edge to land on", () => {
    const spec: TemplateSpec = specOf(templateId);

    const targeted: Set<string> = new Set(
      spec.edges.map((edge: TemplateEdgeSpec) => {
        return edge.toComponentId;
      }),
    );

    for (const node of spec.nodes) {
      if (!targeted.has(node.componentId)) {
        continue;
      }

      const metadata: ComponentMetadata = findMetadata(
        node.metadataId,
      ) as ComponentMetadata;

      expect(
        metadata.inPorts.map((port: Port) => {
          return port.id;
        }),
      ).toContain("in");
    }
  });
});
