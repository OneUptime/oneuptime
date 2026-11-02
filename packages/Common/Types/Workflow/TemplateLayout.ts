/*
 * WHERE A TEMPLATE'S STEPS SIT ON THE CANVAS: ONE COLUMN, TOP TO BOTTOM.
 *
 * A template is read in the Builder the moment it is created, so it is laid
 * out to be read at a glance: its steps one under the other, in the order
 * they run, each connection running straight down from the output it leaves
 * by to the next step. The maintainer found a 48-step template "in a tree
 * too wide to read at once"; a template is now four or five steps, and one
 * column of them.
 *
 * React Flow places a card by its top left corner, and draws a card's one
 * input dot in the middle of its top edge and its outputs along its bottom,
 * in equal columns (UI/Components/Workflow/PortLayout). So for a connection
 * to run straight down, the next card's middle sits under the dot of the
 * output it comes from: a step with three outputs leading on by its first
 * puts the next card a little to the left. This module knows the card's
 * width and its outputs' dots by the canvas's rules, and
 * Tests/UI/Components/Workflow/TemplateLayout.test.ts holds it to the
 * canvas's own code - this module is Types, and cannot import the UI's.
 *
 * Pure: no DOM, no React Flow.
 */

import { JSONObject } from "../JSON";
import ComponentMetadata, { ComponentType, Port } from "./Component";
import Components from "./Components";

// A card's width, unless its outputs need it wider (NodePlacement.WORKFLOW_NODE_WIDTH).
export const TEMPLATE_CARD_WIDTH: number = 256;

/*
 * How far apart the rows of a column are: the tallest card a template's
 * steps draw is 192 pixels (a title on two lines), and a connection turns
 * 20 pixels under the card it leaves.
 */
export const TEMPLATE_ROW_HEIGHT: number = 220;

// Where a template's first step, its trigger, sits.
export const TEMPLATE_START: { x: number; y: number } = { x: 100, y: 100 };

// PortLayout's rules for the outputs' columns.
const MIN_OUTPUT_COLUMN_WIDTH: number = 72;
const MAX_OUTPUT_COLUMN_WIDTH: number = 160;
const CHARACTER_WIDTH: number = 6.5;
const COLUMN_PADDING: number = 20;

// A data step's two outputs, and a trigger's one (Types/Workflow/Components/BaseModel).
const DATA_STEP_OUTPUTS: Array<Port> = [
  { id: "success", title: "Success", description: "" },
  { id: "error", title: "Error", description: "" },
];

const TRIGGER_OUTPUTS: Array<Port> = [
  { id: "success", title: "Success", description: "" },
];

// A database trigger: On Create, On Update, On Delete, On Create or Update.
const DATABASE_TRIGGER_ID: RegExp =
  /-on-(?:create|update|delete|create-or-update)$/;

export type GetTemplateCardOutputsFunction = (
  metadataId: string,
) => Array<Port>;

/*
 * A step's outputs, in the order its card draws them. A built-in step's are
 * its metadata's; a database step's - built per table, so not in the
 * built-in list - are a trigger's one, or a data step's two.
 */
export const getTemplateCardOutputs: GetTemplateCardOutputsFunction = (
  metadataId: string,
): Array<Port> => {
  const builtIn: ComponentMetadata | undefined = Components.find(
    (component: ComponentMetadata): boolean => {
      return component.id === metadataId;
    },
  );

  if (builtIn) {
    return builtIn.outPorts;
  }

  return DATABASE_TRIGGER_ID.test(metadataId)
    ? TRIGGER_OUTPUTS
    : DATA_STEP_OUTPUTS;
};

export interface TemplateCardShape {
  width: number;
  // Each output's dot, across the card from its left edge, by output id.
  dotX: Record<string, number>;
}

export type GetTemplateCardShapeFunction = (
  metadataId: string,
) => TemplateCardShape;

// A card as the canvas draws it: how wide, and where its outputs' dots are.
export const getTemplateCardShape: GetTemplateCardShapeFunction = (
  metadataId: string,
): TemplateCardShape => {
  const outputs: Array<Port> = getTemplateCardOutputs(metadataId);
  const longest: number = Math.max(
    0,
    ...outputs.map((port: Port): number => {
      return Array.from(port.title || "").length;
    }),
  );
  const columnWidth: number = Math.min(
    MAX_OUTPUT_COLUMN_WIDTH,
    Math.max(
      MIN_OUTPUT_COLUMN_WIDTH,
      Math.ceil(longest * CHARACTER_WIDTH) + COLUMN_PADDING,
    ),
  );
  const width: number = Math.max(
    TEMPLATE_CARD_WIDTH,
    columnWidth * outputs.length,
  );
  const dotX: Record<string, number> = {};

  outputs.forEach((port: Port, index: number): void => {
    dotX[port.id] = ((index + 0.5) / outputs.length) * width;
  });

  return { width: width, dotX: dotX };
};

export interface TemplateColumnStep {
  componentId: string;
  metadataId: string;
  componentType: ComponentType;
  args?: JSONObject | undefined;
  /*
   * The output of the step above that leads here. Absent on the first
   * step, the trigger.
   */
  from?: string | undefined;
}

export interface TemplateColumnNode {
  componentId: string;
  metadataId: string;
  componentType: ComponentType;
  position: { x: number; y: number };
  args?: JSONObject | undefined;
}

export interface TemplateColumnEdge {
  fromComponentId: string;
  toComponentId: string;
  fromPort: string;
}

export interface TemplateColumn {
  nodes: Array<TemplateColumnNode>;
  edges: Array<TemplateColumnEdge>;
}

export type LayOutTemplateColumnFunction = (
  steps: Array<TemplateColumnStep>,
) => TemplateColumn;

/*
 * Steps that run one after the other, laid out one under the other: each
 * connected from the output of the step above it that `from` names, and
 * placed so that connection runs straight down - its card's middle under
 * that output's dot. Positions are whole pixels: half a pixel off is not
 * something anybody sees.
 */
export const layOutTemplateColumn: LayOutTemplateColumnFunction = (
  steps: Array<TemplateColumnStep>,
): TemplateColumn => {
  const nodes: Array<TemplateColumnNode> = [];
  const edges: Array<TemplateColumnEdge> = [];

  steps.forEach((step: TemplateColumnStep, index: number): void => {
    const above: TemplateColumnNode | undefined = nodes[index - 1];
    let x: number = TEMPLATE_START.x;

    if (above) {
      if (!step.from) {
        throw new Error(
          `${step.componentId} follows ${above.componentId}, but says nothing about which of its outputs leads there.`,
        );
      }

      const aboveShape: TemplateCardShape = getTemplateCardShape(
        above.metadataId,
      );
      const dot: number | undefined = aboveShape.dotX[step.from];

      if (dot === undefined) {
        throw new Error(
          `${above.componentId} has no output ${step.from} to lead to ${step.componentId}.`,
        );
      }

      x = Math.round(
        above.position.x +
          dot -
          getTemplateCardShape(step.metadataId).width / 2,
      );

      edges.push({
        fromComponentId: above.componentId,
        toComponentId: step.componentId,
        fromPort: step.from,
      });
    }

    nodes.push({
      componentId: step.componentId,
      metadataId: step.metadataId,
      componentType: step.componentType,
      position: {
        x: x,
        y: TEMPLATE_START.y + index * TEMPLATE_ROW_HEIGHT,
      },
      ...(step.args ? { args: step.args } : {}),
    });
  });

  return { nodes: nodes, edges: edges };
};
