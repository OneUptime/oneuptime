/*
 * EVERY WORKFLOW TEMPLATE IS FIVE STEPS AT MOST, TOP TO BOTTOM.
 *
 * The maintainer, of the templates as they were: "We have lots of workflow
 * templates which have loads of components, and they're very complicated
 * to use ... It should be 4-5 components max." The longest had 48 steps,
 * in a tree too wide to read at once. Each was rebuilt to five steps at
 * most, its trigger among them - a step that fails with nothing on its
 * Error output fails the run by itself now, and the new steps (Check With
 * JavaScript, API Get By ID, Incident / Alert From Another Tool, Update
 * Zabbix Problem) each do what took a chain of steps - and the equivalence
 * suites (*TemplateEquivalence.test.ts) hold each to what its old graph did.
 *
 * This keeps a template from growing back: five steps, counted as the
 * Builder shows them, in a column that reads from the trigger down. What a
 * template opens with in the Builder - no error on any step - is held in
 * Templates.test.ts ("passes the builder's own graph checks"), and where
 * each card sits in TemplateLayout.test.ts.
 */

import HuntressSeverity, {
  AllHuntressSeverities,
} from "../../../Types/Huntress/HuntressSeverity";
import { JSONObject } from "../../../Types/JSON";
import {
  HUNTRESS_TEMPLATE_OPTIONS,
  HuntressIncidentWorkflowOptions,
  WhoToPagePicks,
  WorkflowTemplate,
  WorkflowTemplateWhoToPage,
  buildGraphForTemplate,
  buildHuntressIncidentWorkflowGraph,
  getTemplateGraphSpec,
  getWorkflowTemplates,
} from "../../../Types/Workflow/Templates";
import { describe, expect, test } from "@jest/globals";

// The most steps a template has, its trigger among them.
const MAX_TEMPLATE_STEPS: number = 5;

interface SpecNode {
  componentId: string;
  position: { x: number; y: number };
}

interface SpecEdge {
  fromComponentId: string;
  toComponentId: string;
}

interface Spec {
  nodes: Array<SpecNode>;
  edges: Array<SpecEdge>;
}

const TEMPLATES: Array<WorkflowTemplate> = getWorkflowTemplates();

const specOf: (templateId: string) => Spec = (templateId: string): Spec => {
  return getTemplateGraphSpec(templateId) as unknown as Spec;
};

let generated: number = 0;

const generateId: () => string = (): string => {
  generated++;
  return `size-guard-${generated}`;
};

const stepCount: (graph: JSONObject | null) => number = (
  graph: JSONObject | null,
): number => {
  return ((graph?.["nodes"] as Array<JSONObject>) || []).length;
};

// Each connection whose step sits no lower than the step it comes from.
const upOrAcross: (spec: Spec) => Array<string> = (
  spec: Spec,
): Array<string> => {
  const at: Map<string, SpecNode> = new Map(
    spec.nodes.map((node: SpecNode): [string, SpecNode] => {
      return [node.componentId, node];
    }),
  );

  return spec.edges
    .filter((edge: SpecEdge): boolean => {
      const from: SpecNode | undefined = at.get(edge.fromComponentId);
      const to: SpecNode | undefined = at.get(edge.toComponentId);

      return !from || !to || to.position.y <= from.position.y;
    })
    .map((edge: SpecEdge): string => {
      return `${edge.fromComponentId} to ${edge.toComponentId}`;
    });
};

describe("every workflow template", () => {
  test("there are templates to hold to it", () => {
    expect(TEMPLATES.length).toBeGreaterThan(60);
  });

  test.each(
    TEMPLATES.map((template: WorkflowTemplate): [string] => {
      return [template.id];
    }),
  )(
    "%s has five steps at most, its trigger among them",
    (templateId: string) => {
      expect(specOf(templateId).nodes.length).toBeLessThanOrEqual(
        MAX_TEMPLATE_STEPS,
      );
    },
  );

  test.each(
    TEMPLATES.map((template: WorkflowTemplate): [string] => {
      return [template.id];
    }),
  )(
    "%s runs top to bottom: every connection leads down",
    (templateId: string) => {
      expect(upOrAcross(specOf(templateId))).toEqual([]);
    },
  );

  /*
   * As the create wizard builds it, whoever is picked to page: picking
   * fills a Page step in, and picking nobody where nobody may be leaves
   * steps out, so neither adds one.
   */
  test.each(
    TEMPLATES.filter((template: WorkflowTemplate): boolean => {
      return Boolean(template.whoToPage);
    }).map((template: WorkflowTemplate): [string, WorkflowTemplate] => {
      return [template.id, template];
    }),
  )(
    "%s stays at five steps at most whoever is picked to page",
    (templateId: string, template: WorkflowTemplate) => {
      const everybody: WhoToPagePicks = {};

      for (const ask of template.whoToPage as Array<WorkflowTemplateWhoToPage>) {
        everybody[ask.componentId] = ["8f1c2a4e-5b6d-4e7f-9a0b-1c2d3e4f5a6b"];
      }

      expect(
        stepCount(buildGraphForTemplate(templateId, generateId, everybody)),
      ).toBeLessThanOrEqual(MAX_TEMPLATE_STEPS);
      expect(
        stepCount(buildGraphForTemplate(templateId, generateId, {})),
      ).toBeLessThanOrEqual(MAX_TEMPLATE_STEPS);
    },
  );
});

/*
 * The workflows a Huntress connection made are the Huntress template with
 * the connection's settings (HuntressConnectionsToWorkflows), so they are
 * held to it too, whatever was set.
 */
describe("every workflow a Huntress connection makes", () => {
  const OPTIONS: Array<[string, HuntressIncidentWorkflowOptions]> = [
    ["the template's own", HUNTRESS_TEMPLATE_OPTIONS],
    ...AllHuntressSeverities.flatMap(
      (
        threshold: HuntressSeverity,
      ): Array<[string, HuntressIncidentWorkflowOptions]> => {
        return [true, false].map(
          (
            resolveWhenClosed: boolean,
          ): [string, HuntressIncidentWorkflowOptions] => {
            return [
              `paging for ${threshold} and up, ${resolveWhenClosed ? "resolving" : "noting"} a close`,
              {
                pages: true,
                onCallPolicyIds: ["8f1c2a4e-5b6d-4e7f-9a0b-1c2d3e4f5a6b"],
                pageOnCallFor: threshold,
                labelIds: ["9a0b1c2d-3e4f-4a6b-8c1d-2e3f4a5b6c7d"],
                resolveWhenClosed: resolveWhenClosed,
              },
            ];
          },
        );
      },
    ),
    [
      "paging nobody",
      {
        pages: false,
        pageOnCallFor: HuntressSeverity.High,
        resolveWhenClosed: true,
      },
    ],
  ];

  test.each(OPTIONS)(
    "%s has five steps at most",
    (_name: string, options: HuntressIncidentWorkflowOptions) => {
      expect(
        stepCount(buildHuntressIncidentWorkflowGraph(options, generateId)),
      ).toBeLessThanOrEqual(MAX_TEMPLATE_STEPS);
    },
  );
});
