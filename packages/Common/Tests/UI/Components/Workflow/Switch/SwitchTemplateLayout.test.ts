/*
 * Where the templates put their Switch / Case steps on the canvas.
 *
 * A Switch / Case card is wider than other steps when its cases' names need
 * the room (Workflow/PortLayout), and React Flow places a card by its top
 * left corner. A template that puts a wide Switch / Case at the same x as
 * the step above it sends the connection between them sideways and back, so
 * each template places its Switch / Case centred under the step that leads
 * into it: the connection runs straight down, as it does between any two
 * steps of the usual width.
 */

import {
  OutputLayout,
  getOutputLayout,
} from "../../../../../UI/Components/Workflow/PortLayout";
import { WORKFLOW_NODE_WIDTH } from "../../../../../UI/Components/Workflow/NodePlacement";
import { loadComponentsAndCategories } from "../../../../../UI/Components/Workflow/Utils";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import { getComponentOutPorts } from "../../../../../Types/Workflow/ComponentOutPorts";
import { JSONObject } from "../../../../../Types/JSON";
import {
  WorkflowTemplate,
  getTemplateGraphSpec,
  getWorkflowTemplates,
} from "../../../../../Types/Workflow/Templates";
import { describe, expect, test } from "@jest/globals";

type TemplateGraphSpec = NonNullable<ReturnType<typeof getTemplateGraphSpec>>;
type TemplateNodeSpec = TemplateGraphSpec["nodes"][number];
type TemplateEdgeSpec = TemplateGraphSpec["edges"][number];

/*
 * The catalog the builder draws from, the database steps and triggers
 * included: a template's trigger is one of those.
 */
const CATALOG: Array<ComponentMetadata> =
  loadComponentsAndCategories().components;

type MetadataFunction = (id: string) => ComponentMetadata | undefined;

const metadataOf: MetadataFunction = (
  id: string,
): ComponentMetadata | undefined => {
  return CATALOG.find((component: ComponentMetadata) => {
    return component.id === id;
  });
};

interface CardGeometry {
  width: number;
  // Each output's dot, across the card, by output id, in pixels.
  dotX: Record<string, number>;
}

type GeometryFunction = (node: TemplateNodeSpec) => CardGeometry;

// A card as the canvas draws it: its width, and where its output dots are.
const geometryOf: GeometryFunction = (node: TemplateNodeSpec): CardGeometry => {
  const ports: Array<Port> = getComponentOutPorts({
    metadata: metadataOf(node.metadataId),
    arguments: (node.args || {}) as JSONObject,
  });
  const layout: OutputLayout = getOutputLayout(
    ports.map((port: Port): string => {
      return port.title || "";
    }),
  );
  const width: number = layout.widerCardWidth || WORKFLOW_NODE_WIDTH;
  const dotX: Record<string, number> = {};

  ports.forEach((port: Port, index: number) => {
    dotX[port.id] =
      node.position.x +
      ((layout.dotLeftPercents[index] as number) / 100) * width;
  });

  return { width: width, dotX: dotX };
};

type InDotFunction = (node: TemplateNodeSpec) => number;

// A card's one input dot is in the middle of its top edge.
const inDotX: InDotFunction = (node: TemplateNodeSpec): number => {
  return node.position.x + geometryOf(node).width / 2;
};

const SWITCH_TEMPLATES: Array<WorkflowTemplate> = getWorkflowTemplates().filter(
  (template: WorkflowTemplate): boolean => {
    return Boolean(
      getTemplateGraphSpec(template.id)?.nodes.some(
        (node: TemplateNodeSpec): boolean => {
          return node.metadataId === ComponentID.Switch;
        },
      ),
    );
  },
);

describe("the templates' Switch / Case steps on the canvas", () => {
  test("there are templates with one to look at", () => {
    expect(
      SWITCH_TEMPLATES.map((template: WorkflowTemplate): string => {
        return template.id;
      }),
    ).toEqual(
      expect.arrayContaining(["webhook-switch", "incident-severity-slack"]),
    );
  });

  test.each(
    SWITCH_TEMPLATES.map((template: WorkflowTemplate): [string] => {
      return [template.id];
    }),
  )(
    "%s: the connection into its Switch / Case runs straight down",
    (templateId: string) => {
      const spec: TemplateGraphSpec = getTemplateGraphSpec(
        templateId,
      ) as TemplateGraphSpec;

      for (const node of spec.nodes) {
        if (node.metadataId !== ComponentID.Switch) {
          continue;
        }

        const incoming: Array<TemplateEdgeSpec> = spec.edges.filter(
          (edge: TemplateEdgeSpec): boolean => {
            return edge.toComponentId === node.componentId;
          },
        );

        expect(incoming.length).toBeGreaterThan(0);

        for (const edge of incoming) {
          const from: TemplateNodeSpec = spec.nodes.find(
            (candidate: TemplateNodeSpec): boolean => {
              return candidate.componentId === edge.fromComponentId;
            },
          ) as TemplateNodeSpec;

          const fromX: number = geometryOf(from).dotX[edge.fromPort] as number;

          // A step the catalog has, with the output the connection leaves.
          expect(metadataOf(from.metadataId)).toBeDefined();
          expect(typeof fromX).toBe("number");

          expect({
            edge: `${edge.fromComponentId} -> ${node.componentId}`,
            offset: Math.abs(fromX - inDotX(node)) <= 1,
          }).toEqual({
            edge: `${edge.fromComponentId} -> ${node.componentId}`,
            offset: true,
          });
        }
      }
    },
  );

  test("the severity template is wider than a step, and its middle case runs straight down to the Slack step under it", () => {
    const spec: TemplateGraphSpec = getTemplateGraphSpec(
      "incident-severity-slack",
    ) as TemplateGraphSpec;
    const switchNode: TemplateNodeSpec = spec.nodes.find(
      (node: TemplateNodeSpec): boolean => {
        return node.componentId === "switch-1";
      },
    ) as TemplateNodeSpec;
    const slackMajor: TemplateNodeSpec = spec.nodes.find(
      (node: TemplateNodeSpec): boolean => {
        return node.componentId === "slack-major";
      },
    ) as TemplateNodeSpec;

    // "Critical Incident" needs a wider column than a step's third.
    expect(geometryOf(switchNode).width).toBeGreaterThan(WORKFLOW_NODE_WIDTH);
    expect(
      Math.abs(
        (geometryOf(switchNode).dotX["case-2"] as number) - inDotX(slackMajor),
      ),
    ).toBeLessThanOrEqual(1);
  });
});
