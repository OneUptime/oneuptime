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
  RECOMMENDED_WORKFLOW_TEMPLATE_IDS,
  WORKFLOW_TEMPLATE_VARIABLE_NAME_REGEX,
  WorkflowTemplate,
  WorkflowTemplateCategories,
  WorkflowTemplateCategory,
  WorkflowTemplateCategoryInfo,
  WorkflowTemplateOAuth2Variable,
  WorkflowTemplateOutline,
  WorkflowTemplateVariable,
  buildGraphForTemplate,
  fillWorkflowTemplateSetting,
  getRecommendedWorkflowTemplates,
  getTemplateGraphSpec,
  getWorkflowTemplate,
  getWorkflowTemplateCategoryInfo,
  getWorkflowTemplateOutline,
  getWorkflowTemplateSettingFieldNames,
  getWorkflowTemplates,
  getWorkflowTemplatesByCategory,
} from "../../../Types/Workflow/Templates";
import {
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
} from "../../../Types/Workflow/WorkflowVariableOAuth";
import ComponentMetadata, {
  Argument,
  ComponentType,
  NodeDataProp,
  Port,
  ReturnValue,
} from "../../../Types/Workflow/Component";
import { JSONObject, JSONValue, ObjectType } from "../../../Types/JSON";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
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
import ComponentID from "../../../Types/Workflow/ComponentID";
import CronTab from "../../../Utils/CronTab";

const templates: Array<WorkflowTemplate> = getWorkflowTemplates();

/*
 * The categories whose templates come in an incident and an alert version,
 * each filed under its kind.
 */
const SPLIT_CATEGORIES: Array<WorkflowTemplateCategory> = [
  WorkflowTemplateCategory.Jira,
  WorkflowTemplateCategory.Dynamics365,
];

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

  /*
   * ObjectID, Email, Phone and Date values are serialized for workflow storage
   * as { _type, value }. Selecting the database column selects that wrapper;
   * `.value` is a serialization detail rather than another database column.
   */
  if (path.length === 1 && path[0] === "value" && Boolean(select)) {
    return true;
  }

  /*
   * The runtime always adds _id to the select it issues. It is a plain string,
   * not a wrapper, so nothing can be read beneath it — `_id.value` is not
   * covered however the select is written.
   */
  if (path[0] === "_id" || path[0] === "id") {
    return path.length === 1;
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
          // Only the Jira and Dynamics 365 templates are split into parts.
          ...(SPLIT_CATEGORIES.includes(template.category)
            ? ["subcategory"]
            : []),
          // Only the Dynamics 365 templates sign in with an OAuth 2.0 variable.
          ...(template.category === WorkflowTemplateCategory.Dynamics365
            ? ["oauth2Variables"]
            : []),
        ].sort(),
      );
    }
  });
});

/*
 * What the template picker is built from. The picker used to show every
 * template at once, as equally large cards; it now opens on a handful of
 * recommended ones and keeps the rest under categories, and previews a
 * template's blocks before anything is created. All of that is read from the
 * catalog, so the catalog holds the rules.
 */
describe("workflow template categories, as the picker shows them", () => {
  test("every category says what it is for, under a label and with an icon that exists", () => {
    const iconValues: Array<string> = Object.values(IconProp);

    for (const category of WorkflowTemplateCategories) {
      const info: WorkflowTemplateCategoryInfo =
        getWorkflowTemplateCategoryInfo(category);

      expect(info.category).toBe(category);
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
      expect(iconValues).toContain(info.icon);
    }
  });

  test("every category the enum declares is shown, and described", () => {
    expect([...WorkflowTemplateCategories].sort()).toEqual(
      Object.values(WorkflowTemplateCategory).sort(),
    );
  });

  test("labels are short enough to sit beside a count, and differ from one another", () => {
    const labels: Array<string> = WorkflowTemplateCategories.map(
      (category: WorkflowTemplateCategory): string => {
        return getWorkflowTemplateCategoryInfo(category).label;
      },
    );

    expect(new Set(labels).size).toBe(labels.length);

    for (const label of labels) {
      expect(label.length).toBeLessThanOrEqual(16);
    }
  });

  test("a label is the category's own name, or a shorter form of it", () => {
    type StemsFunction = (text: string) => Array<string>;

    // Words of two letters or more, singular: "Status Pages" and "Status Page" agree.
    const stems: StemsFunction = (text: string): Array<string> => {
      return text
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((word: string) => {
          return word.length > 1;
        })
        .map((word: string) => {
          return word.replace(/s$/, "");
        });
    };

    for (const category of WorkflowTemplateCategories) {
      const categoryStems: Array<string> = stems(category);

      expect({
        category: category,
        sharesAWord: stems(
          getWorkflowTemplateCategoryInfo(category).label,
        ).some((stem: string) => {
          return categoryStems.includes(stem);
        }),
      }).toEqual({ category: category, sharesAWord: true });
    }
  });

  test("each description is one sentence, said as something to get done", () => {
    for (const category of WorkflowTemplateCategories) {
      const description: string =
        getWorkflowTemplateCategoryInfo(category).description;

      expect(description).toMatch(/^[A-Z][^.]*\.$/);
      expect(description.length).toBeLessThanOrEqual(90);
    }
  });

  /*
   * A search reads a template's category name, not its description: the
   * Jira one names incidents and alerts both, and would otherwise bring back
   * every Jira template for "alert". It is still worth saying here.
   */
  test("the Jira category says it works both ways, for incidents and alerts", () => {
    expect(
      getWorkflowTemplateCategoryInfo(WorkflowTemplateCategory.Jira)
        .description,
    ).toMatch(/incidents and alerts, both ways/);
  });
});

describe("the recommended workflow templates", () => {
  const recommended: Array<WorkflowTemplate> =
    getRecommendedWorkflowTemplates();

  test("are a handful: enough to start from, few enough to choose between", () => {
    expect(recommended.length).toBeGreaterThanOrEqual(4);
    expect(recommended.length).toBeLessThanOrEqual(8);
  });

  test("each is a real template, named once, in the order declared", () => {
    expect(new Set(RECOMMENDED_WORKFLOW_TEMPLATE_IDS).size).toBe(
      RECOMMENDED_WORKFLOW_TEMPLATE_IDS.length,
    );
    expect(
      recommended.map((template: WorkflowTemplate): string => {
        return template.id;
      }),
    ).toEqual([...RECOMMENDED_WORKFLOW_TEMPLATE_IDS]);
  });

  test("span several kinds of job, not one category", () => {
    const categories: Set<WorkflowTemplateCategory> = new Set(
      recommended.map(
        (template: WorkflowTemplate): WorkflowTemplateCategory => {
          return template.category;
        },
      ),
    );

    expect(categories.size).toBeGreaterThanOrEqual(4);
  });

  /*
   * A recommendation should work with what the wizard asks for. A template
   * that needs an AI provider set up first, or a Jira webhook registered
   * before it does anything, is a poor first workflow.
   */
  test("each works with only the settings it asks for", () => {
    for (const template of recommended) {
      const spec: {
        nodes: Array<{ metadataId: string; componentType: string }>;
      } | null = getTemplateGraphSpec(template.id);

      expect(spec).not.toBeNull();

      const metadataIds: Array<string> = (spec?.nodes || []).map(
        (node: { metadataId: string }): string => {
          return node.metadataId;
        },
      );

      expect({
        template: template.id,
        usesAi: metadataIds.includes(ComponentID.AIGenerateText),
      }).toEqual({
        template: template.id,
        usesAi: false,
      });

      const trigger: { metadataId: string; componentType: string } | undefined =
        (spec?.nodes || []).find((node: { componentType: string }): boolean => {
          return node.componentType === ComponentType.Trigger;
        });

      expect({
        template: template.id,
        trigger: trigger?.metadataId,
      }).not.toEqual({
        template: template.id,
        trigger: ComponentID.Webhook,
      });
    }
  });

  test("the one Jira template among them is the one the Jira guide says to start with", () => {
    const jira: Array<WorkflowTemplate> = recommended.filter(
      (template: WorkflowTemplate) => {
        return template.category === WorkflowTemplateCategory.Jira;
      },
    );

    expect(
      jira.map((template: WorkflowTemplate): string => {
        return template.id;
      }),
    ).toEqual(["jira-create-issue-for-incident"]);
  });
});

describe("the Jira templates' parts", () => {
  const jira: Array<WorkflowTemplate> = getWorkflowTemplatesByCategory(
    WorkflowTemplateCategory.Jira,
  );

  test("every Jira and Dynamics 365 template is filed under Incidents or Alerts, and no other template has a part", () => {
    for (const template of templates) {
      if (SPLIT_CATEGORIES.includes(template.category)) {
        expect(["Incidents", "Alerts"]).toContain(template.subcategory);
      } else {
        expect(template.subcategory).toBeUndefined();
      }
    }
  });

  test("nine for incidents, then eight for alerts, as the Jira guide lists them", () => {
    expect(
      jira.map((template: WorkflowTemplate): string => {
        return template.subcategory || "";
      }),
    ).toEqual([...Array(9).fill("Incidents"), ...Array(8).fill("Alerts")]);
  });

  test("a template's part is the record it works on", () => {
    for (const template of jira) {
      const noun: string =
        template.subcategory === "Incidents" ? "incident" : "alert";

      expect({
        template: template.id,
        namesItsRecord: template.id.includes(`-${noun}`),
      }).toEqual({
        template: template.id,
        namesItsRecord: true,
      });
    }
  });
});

describe("a workflow template's outline", () => {
  type OutlineFunction = (templateId: string) => WorkflowTemplateOutline;

  const outlineOf: OutlineFunction = (
    templateId: string,
  ): WorkflowTemplateOutline => {
    const outline: WorkflowTemplateOutline | null =
      getWorkflowTemplateOutline(templateId);

    if (!outline) {
      throw new Error(`No outline for "${templateId}".`);
    }

    return outline;
  };

  test("an unknown template has none", () => {
    expect(getWorkflowTemplateOutline("does-not-exist")).toBeNull();
  });

  test("a notification template: its trigger, its message, then Log", () => {
    expect(outlineOf("incident-created-slack")).toEqual({
      triggerComponentId: "incident-on-create",
      stepComponentIds: [
        ComponentID.SlackSendMessageToChannel,
        ComponentID.Log,
      ],
      blockCount: 3,
    });
  });

  /*
   * Slack is reached from the API call's Error port here, and the template
   * is named for it. Following only the way that works would leave it out.
   */
  test("a block reached only when something fails is listed, after the ones on the way that works", () => {
    expect(outlineOf("scheduled-check-alert-slack").stepComponentIds).toEqual([
      ComponentID.ApiGet,
      ComponentID.SlackSendMessageToChannel,
      ComponentID.Log,
    ]);
  });

  test("a check's Yes side is listed before its No side", () => {
    expect(outlineOf("monitor-offline-only-slack").stepComponentIds).toEqual([
      ComponentID.IfElse,
      ComponentID.SlackSendMessageToChannel,
      ComponentID.Log,
    ]);
  });

  test("a template that only logs has Log as its one step", () => {
    expect(outlineOf("manual-log")).toEqual({
      triggerComponentId: ComponentID.Manual,
      stepComponentIds: [ComponentID.Log],
      blockCount: 2,
    });
  });

  describe.each(
    templates.map((template: WorkflowTemplate): [string] => {
      return [template.id];
    }),
  )("for %s", (templateId: string) => {
    const spec: {
      nodes: Array<{ metadataId: string; componentType: string }>;
    } = getTemplateGraphSpec(templateId) as {
      nodes: Array<{ metadataId: string; componentType: string }>;
    };

    test("names the template's one trigger", () => {
      const triggers: Array<string> = spec.nodes
        .filter((node: { componentType: string }) => {
          return node.componentType === ComponentType.Trigger;
        })
        .map((node: { metadataId: string }) => {
          return node.metadataId;
        });

      expect(triggers).toEqual([outlineOf(templateId).triggerComponentId]);
    });

    test("lists every other kind of block it uses, each once", () => {
      const steps: Array<string> = outlineOf(templateId).stepComponentIds;
      const used: Set<string> = new Set(
        spec.nodes
          .filter((node: { componentType: string }) => {
            return node.componentType !== ComponentType.Trigger;
          })
          .map((node: { metadataId: string }) => {
            return node.metadataId;
          }),
      );

      expect(new Set(steps)).toEqual(used);
      expect(new Set(steps).size).toBe(steps.length);
    });

    test("puts Log last, when there is one", () => {
      const steps: Array<string> = outlineOf(templateId).stepComponentIds;

      if (steps.includes(ComponentID.Log)) {
        expect(steps[steps.length - 1]).toBe(ComponentID.Log);
      }
    });

    test("counts every block, the trigger too", () => {
      expect(outlineOf(templateId).blockCount).toBe(spec.nodes.length);
    });
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
      const names: Array<string> = [
        ...template.variables.map((variable: WorkflowTemplateVariable) => {
          return variable.name;
        }),
        ...(template.oauth2Variables || []).map(
          (variable: WorkflowTemplateOAuth2Variable) => {
            return variable.name;
          },
        ),
      ];

      expect(new Set(names).size).toBe(names.length);
    }
  });

  /*
   * A format is checked with test(), once per value typed. A global or sticky
   * pattern keeps lastIndex between calls, so the same good value would pass
   * on one keystroke and fail on the next.
   */
  test("a format matches the whole value and keeps no state between checks", () => {
    for (const template of templates) {
      for (const variable of template.variables) {
        if (!variable.format) {
          continue;
        }

        expect({
          variable: variable.name,
          anchored:
            variable.format.pattern.source.startsWith("^") &&
            variable.format.pattern.source.endsWith("$"),
          flags: variable.format.pattern.flags.replace(/[imsu]/g, ""),
        }).toEqual({ variable: variable.name, anchored: true, flags: "" });
      }
    }
  });

  test("a format's message says what to type instead, in a sentence", () => {
    for (const template of templates) {
      for (const variable of template.variables) {
        if (!variable.format) {
          continue;
        }

        expect(variable.format.message).toMatch(/^[A-Z].*\.$/);
        expect(variable.format.message.length).toBeLessThanOrEqual(200);
      }
    }
  });

  /*
   * The placeholder is the example the field shows, so it has to be one the
   * wizard would accept. A secret's placeholder is a shape, not a value, and
   * is held to it all the same.
   */
  test("a field's placeholder is a value its format accepts", () => {
    for (const template of templates) {
      for (const variable of template.variables) {
        if (!variable.format) {
          continue;
        }

        expect({
          variable: variable.name,
          accepted: variable.format.pattern.test(variable.placeholder),
        }).toEqual({ variable: variable.name, accepted: true });
      }
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

/*
 * A template can ask the wizard to create an OAuth 2.0 variable, built from
 * values typed into its fields. Every way that goes wrong is silent until a
 * run: a setting naming a field the wizard never asks for is filled in with
 * nothing and the identity provider refuses it, and a field kept only for a
 * setting that the graph also refers to ships literal braces, because no row
 * is written for it.
 */
describe("workflow template OAuth 2.0 variables", () => {
  const withOAuth2: Array<WorkflowTemplate> = templates.filter(
    (template: WorkflowTemplate) => {
      return (template.oauth2Variables || []).length > 0;
    },
  );

  type SettingsOfFunction = (
    variable: WorkflowTemplateOAuth2Variable,
  ) => Array<string>;

  const settingsOf: SettingsOfFunction = (
    variable: WorkflowTemplateOAuth2Variable,
  ): Array<string> => {
    return [
      variable.tokenUrl,
      variable.clientId,
      variable.clientSecret,
      variable.scope,
    ];
  };

  type FieldOfFunction = (
    template: WorkflowTemplate,
    name: string,
  ) => WorkflowTemplateVariable | undefined;

  const fieldOf: FieldOfFunction = (
    template: WorkflowTemplate,
    name: string,
  ): WorkflowTemplateVariable | undefined => {
    return template.variables.find((variable: WorkflowTemplateVariable) => {
      return variable.name === name;
    });
  };

  test("some templates have them, so the checks below check something", () => {
    expect(withOAuth2.length).toBeGreaterThan(0);
  });

  test("a template either has OAuth 2.0 variables or does not say so at all", () => {
    for (const template of templates) {
      if (template.oauth2Variables !== undefined) {
        expect(template.oauth2Variables.length).toBeGreaterThan(0);
      }
    }
  });

  test("every {name} in a setting is a required field of the same template", () => {
    for (const template of withOAuth2) {
      for (const variable of template.oauth2Variables || []) {
        for (const setting of settingsOf(variable)) {
          for (const name of getWorkflowTemplateSettingFieldNames(setting)) {
            expect({
              template: template.id,
              setting: setting,
              field: name,
              required: fieldOf(template, name)?.required,
            }).toEqual({
              template: template.id,
              setting: setting,
              field: name,
              required: true,
            });
          }
        }
      }
    }
  });

  test("the client ID and secret come from what is typed, never from the template", () => {
    for (const template of withOAuth2) {
      for (const variable of template.oauth2Variables || []) {
        expect(
          getWorkflowTemplateSettingFieldNames(variable.clientId),
        ).toHaveLength(1);
        expect(
          getWorkflowTemplateSettingFieldNames(variable.clientSecret),
        ).toHaveLength(1);
        expect(variable.clientId).toMatch(/^\{[A-Za-z0-9_-]+\}$/);
        expect(variable.clientSecret).toMatch(/^\{[A-Za-z0-9_-]+\}$/);
      }
    }
  });

  test("the client secret is filled in from a secret field, kept only for the setting", () => {
    for (const template of withOAuth2) {
      for (const variable of template.oauth2Variables || []) {
        const [name] = getWorkflowTemplateSettingFieldNames(
          variable.clientSecret,
        );
        const field: WorkflowTemplateVariable | undefined = fieldOf(
          template,
          name as string,
        );

        expect({
          template: template.id,
          isSecret: field?.isSecret,
          isOAuth2SettingOnly: field?.isOAuth2SettingOnly,
        }).toEqual({
          template: template.id,
          isSecret: true,
          isOAuth2SettingOnly: true,
        });
      }
    }
  });

  test("every field kept only for a setting fills one in", () => {
    for (const template of templates) {
      const named: Set<string> = new Set(
        (template.oauth2Variables || []).flatMap(
          (variable: WorkflowTemplateOAuth2Variable): Array<string> => {
            return settingsOf(variable).flatMap(
              getWorkflowTemplateSettingFieldNames,
            );
          },
        ),
      );

      for (const variable of template.variables) {
        if (!variable.isOAuth2SettingOnly) {
          continue;
        }

        expect({
          template: template.id,
          field: variable.name,
          fillsASetting: named.has(variable.name),
        }).toEqual({
          template: template.id,
          field: variable.name,
          fillsASetting: true,
        });
      }
    }
  });

  test("the graph never refers to a field kept only for a setting, which has no row", () => {
    for (const template of templates) {
      const settingOnly: Array<string> = template.variables
        .filter((variable: WorkflowTemplateVariable) => {
          return variable.isOAuth2SettingOnly;
        })
        .map((variable: WorkflowTemplateVariable) => {
          return variable.name;
        });

      for (const reference of referencesOf(template.id)) {
        if (reference.parsed.rootType !== ReferenceRootType.LocalVariable) {
          continue;
        }

        expect({
          template: template.id,
          reference: reference.raw,
          settingOnly: settingOnly.includes(
            reference.parsed.variableName as string,
          ),
        }).toEqual({
          template: template.id,
          reference: reference.raw,
          settingOnly: false,
        });
      }
    }
  });

  test("an OAuth 2.0 variable's name is never also a field's", () => {
    for (const template of withOAuth2) {
      for (const variable of template.oauth2Variables || []) {
        expect(variable.name).toMatch(WORKFLOW_TEMPLATE_VARIABLE_NAME_REGEX);
        expect(fieldOf(template, variable.name)).toBeUndefined();
      }
    }
  });

  test("settings are filled in by the wizard, so none holds a {{...}} reference", () => {
    for (const template of withOAuth2) {
      for (const variable of template.oauth2Variables || []) {
        for (const setting of settingsOf(variable)) {
          expect(setting).not.toContain("{{");
          expect(setting).not.toContain("}}");
        }
      }
    }
  });

  test("each says how it signs in with values the service accepts", () => {
    for (const template of withOAuth2) {
      for (const variable of template.oauth2Variables || []) {
        expect(Object.values(OAuth2GrantType)).toContain(variable.grantType);
        expect(Object.values(OAuth2ClientAuthenticationMethod)).toContain(
          variable.clientAuthenticationMethod,
        );
        expect(variable.description.length).toBeGreaterThan(0);
      }
    }
  });

  /*
   * Filled in with each field's own example, a token URL has to be a real
   * https URL: the service refuses anything else, and refuses it only after
   * the workflow already exists.
   */
  test("the token URL is an https URL once its fields are filled in", () => {
    for (const template of withOAuth2) {
      const examples: Record<string, string> = {};

      for (const variable of template.variables) {
        examples[variable.name] = variable.placeholder;
      }

      for (const variable of template.oauth2Variables || []) {
        const url: URL = new URL(
          fillWorkflowTemplateSetting(variable.tokenUrl, examples),
        );

        expect(url.protocol).toBe("https:");
      }
    }
  });

  test("filling a setting in trims each value and leaves the rest of the text as it is", () => {
    expect(
      fillWorkflowTemplateSetting("https://login.example.com/{tenant}/token", {
        tenant: "  contoso.onmicrosoft.com \n",
      }),
    ).toBe("https://login.example.com/contoso.onmicrosoft.com/token");

    expect(
      fillWorkflowTemplateSetting("{url}/.default", {
        url: "https://acme.crm.dynamics.com",
      }),
    ).toBe("https://acme.crm.dynamics.com/.default");

    // A field with no value fills in nothing, rather than leaving the braces.
    expect(fillWorkflowTemplateSetting("{missing}/x", {})).toBe("/x");

    // Text that only looks like a placeholder is left alone.
    expect(fillWorkflowTemplateSetting("{not a name}", { a: "b" })).toBe(
      "{not a name}",
    );
  });

  test("the names a setting is filled in from, in the order it names them", () => {
    expect(
      getWorkflowTemplateSettingFieldNames(
        "https://login.example.com/{tenant}/{tenant}/{path-part}",
      ),
    ).toEqual(["tenant", "tenant", "path-part"]);
    expect(getWorkflowTemplateSettingFieldNames("no placeholders")).toEqual([]);
  });
});

describe("workflow template runtime contracts", () => {
  test("JavaScript transform receives the webhook body as an object-shaped whole argument", () => {
    const javascriptNode: TemplateNodeSpec = specOf(
      "javascript-transform",
    ).nodes.find((node: TemplateNodeSpec) => {
      return node.componentId === "javascript-1";
    }) as TemplateNodeSpec;

    expect(javascriptNode.args?.["arguments"]).toBe(
      "{{local.components.webhook-1.returnValues.request-body}}",
    );
    expect(javascriptNode.args?.["code"] as string).toContain(
      "const body = args || {};",
    );
  });

  test("AI incident data stays in the protected context instead of the prompt", () => {
    const aiNode: TemplateNodeSpec = specOf(
      "incident-created-ai-summary",
    ).nodes.find((node: TemplateNodeSpec) => {
      return node.componentId === "ai-1";
    }) as TemplateNodeSpec;

    expect(aiNode.args?.["prompt"] as string).not.toContain("{{");
    expect(aiNode.args?.["context"]).toBe(
      "{{local.components.incident-on-create-1.returnValues.model}}",
    );
  });

  test.each(["subscriber-added-slack", "subscriber-added-forward"])(
    "%s waits for confirmation updates and normalizes the contact method",
    (templateId: string) => {
      const spec: TemplateSpec = specOf(templateId);
      const trigger: TemplateNodeSpec = spec.nodes.find(
        (node: TemplateNodeSpec) => {
          return node.componentType === ComponentType.Trigger;
        },
      ) as TemplateNodeSpec;

      expect(trigger.metadataId).toBe("status-page-subscriber-on-update");
      expect(trigger.args?.["listen-on"]).toEqual({
        isSubscriptionConfirmed: true,
      });
      expect(
        spec.nodes.some((node: TemplateNodeSpec) => {
          return node.componentId === "subscriber-normalize-1";
        }),
      ).toBe(true);
    },
  );

  test("on-call notification follows real execution updates, not the scheduled create event", () => {
    const trigger: TemplateNodeSpec = specOf(
      "oncall-executed-slack",
    ).nodes.find((node: TemplateNodeSpec) => {
      return node.componentType === ComponentType.Trigger;
    }) as TemplateNodeSpec;

    expect(trigger.metadataId).toBe(
      "on-call-duty-policy-execution-log-on-update",
    );
    expect(trigger.args?.["listen-on"]).toEqual({ status: true });
  });

  /*
   * Pins the serialization the per-template id check relies on. A database
   * trigger hands its record to the workflow through BaseModel.toJSON, which
   * wraps ObjectID foreign keys as { _type, value } but leaves the record's
   * own primary key — declared `@PrimaryGeneratedColumn("uuid") _id?: string`
   * — as the bare string it is.
   */
  test("a record's own _id serializes as a plain string, its foreign keys as a wrapper", () => {
    const id: string = ObjectID.generate().toString();
    const projectId: ObjectID = ObjectID.generate();

    const incident: Incident = new Incident();
    incident._id = id;
    incident.projectId = projectId;

    const json: JSONObject = BaseModel.toJSON(incident, Incident);

    expect(typeof json["_id"]).toBe("string");
    expect(json["_id"]).toBe(id);
    expect(json["projectId"]).toEqual({
      _type: ObjectType.ObjectID,
      value: projectId.toString(),
    });
  });

  test("credential-bearing destination URLs are treated as secrets", () => {
    for (const template of templates) {
      for (const variable of template.variables) {
        const normalizedVariableName: string = variable.name.toLowerCase();

        if (
          !["webhookurl", "forwardurl", "targeturl", "heartbeaturl"].some(
            (secretUrlName: string): boolean => {
              return normalizedVariableName.includes(secretUrlName);
            },
          )
        ) {
          continue;
        }

        expect({
          template: template.id,
          variable: variable.name,
          isSecret: variable.isSecret,
        }).toEqual({
          template: template.id,
          variable: variable.name,
          isSecret: true,
        });
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

  test("every fallible component handles its Error port", () => {
    const spec: TemplateSpec = specOf(templateId);

    for (const node of spec.nodes) {
      const metadata: ComponentMetadata = findMetadata(
        node.metadataId,
      ) as ComponentMetadata;
      const hasErrorPort: boolean = metadata.outPorts.some((port: Port) => {
        return port.id === "error";
      });

      if (!hasErrorPort) {
        continue;
      }

      expect({
        componentId: node.componentId,
        handlesError: spec.edges.some((edge: TemplateEdgeSpec) => {
          return (
            edge.fromComponentId === node.componentId &&
            edge.fromPort === "error"
          );
        }),
      }).toEqual({ componentId: node.componentId, handlesError: true });
    }
  });

  test("Slack messages start with an emoji and a scannable heading", () => {
    for (const node of specOf(templateId).nodes) {
      if (node.metadataId !== ComponentID.SlackSendMessageToChannel) {
        continue;
      }

      expect(node.args?.["text"]).toEqual(expect.any(String));
      expect(node.args?.["text"] as string).toMatch(
        /^:[a-z0-9_+-]+: \*[^\n]+\*/,
      );
    }
  });

  test("schedule expressions are valid cron", () => {
    for (const node of specOf(templateId).nodes) {
      if (node.metadataId !== ComponentID.Schedule) {
        continue;
      }

      expect(CronTab.isValid(node.args?.["schedule"] as string)).toBe(true);
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

  /*
   * `.value` is right for a foreign key and wrong for the record's own id, and
   * the two look alike. projectId, incidentId and the like are ObjectIDs, which
   * toJSON wraps as { _type, value }, so they are read as `.projectId.value`.
   * The record's own primary key is a plain uuid string, so `.model._id.value`
   * finds nothing, the reference is left unresolved, and the POSTed body
   * carries the literal {{…}} text instead of the id. Related records nested
   * under the model serialize the same way, so this holds at any depth.
   */
  test("no record id is read through a .value wrapper it does not have", () => {
    for (const reference of referencesOf(templateId)) {
      if (
        reference.parsed.rootType !== ReferenceRootType.ComponentReturnValue
      ) {
        continue;
      }

      if (
        reference.parsed.returnValueId !== "model" &&
        reference.parsed.returnValueId !== "models"
      ) {
        continue;
      }

      // local . components . <id> . returnValues . model . <field...>
      const fieldPath: Array<string> = reference.inner.split(".").slice(5);

      const readsIdValue: boolean = fieldPath.some(
        (segment: string, index: number): boolean => {
          return (
            (segment === "_id" || segment === "id") &&
            fieldPath[index + 1] === "value"
          );
        },
      );

      expect({
        reference: reference.raw,
        readsIdValue: readsIdValue,
      }).toEqual({ reference: reference.raw, readsIdValue: false });
    }
  });

  /*
   * A value kept only as an OAuth 2.0 setting is used by filling that
   * setting in, not by the graph — which is checked under "workflow template
   * OAuth 2.0 variables".
   */
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

    const written: Array<string> = [
      ...template.variables
        .filter((variable: WorkflowTemplateVariable) => {
          return !variable.isOAuth2SettingOnly;
        })
        .map((variable: WorkflowTemplateVariable) => {
          return variable.name;
        }),
      ...(template.oauth2Variables || []).map(
        (variable: WorkflowTemplateOAuth2Variable) => {
          return variable.name;
        },
      ),
    ];

    for (const name of written) {
      expect({
        variable: name,
        used: used.has(name),
      }).toEqual({ variable: name, used: true });
    }
  });

  /*
   * The inverse, and the more dangerous direction: a reference to a variable
   * the wizard never asks for means no row is ever written for it, and the
   * literal braces ship. A value kept only as an OAuth 2.0 setting gets no row
   * either, so it does not count as declared here.
   */
  test("every variable the graph references is declared by the template", () => {
    const declared: Array<string> = [
      ...template.variables
        .filter((variable: WorkflowTemplateVariable) => {
          return !variable.isOAuth2SettingOnly;
        })
        .map((variable: WorkflowTemplateVariable) => {
          return variable.name;
        }),
      ...(template.oauth2Variables || []).map(
        (variable: WorkflowTemplateOAuth2Variable) => {
          return variable.name;
        },
      ),
    ];

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
