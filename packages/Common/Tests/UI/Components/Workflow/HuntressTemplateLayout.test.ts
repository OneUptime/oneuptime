/*
 * The Huntress workflow on the canvas: no step card lies on another.
 *
 * The template, and every workflow a Huntress connection became, are one
 * column (TemplateLayout.layOutTemplateColumn): the trigger, Incident From
 * Another Tool, and the If / Else and the Page step a connection that pages
 * has. A card is 16rem wide (WORKFLOW_NODE_WIDTH), wider when its outputs'
 * names need it (PortLayout), and cards come out 160 to 210 pixels tall,
 * so rows are TEMPLATE_ROW_HEIGHT apart. This holds every layout a
 * connection's settings can make to its cards; TemplateLayout.test.ts holds
 * every template's.
 */

import HuntressSeverity, {
  AllHuntressSeverities,
} from "../../../../Types/Huntress/HuntressSeverity";
import { JSONObject } from "../../../../Types/JSON";
import ComponentMetadata, { Port } from "../../../../Types/Workflow/Component";
import { getComponentOutPorts } from "../../../../Types/Workflow/ComponentOutPorts";
import {
  HUNTRESS_TEMPLATE_OPTIONS,
  HUNTRESS_TRIGGER_COMPONENT_ID,
  HuntressIncidentWorkflowOptions,
  buildHuntressIncidentWorkflowGraph,
} from "../../../../Types/Workflow/Templates";
import {
  DEFAULT_NODE_HEIGHT,
  WORKFLOW_NODE_WIDTH,
} from "../../../../UI/Components/Workflow/NodePlacement";
import { getOutputLayout } from "../../../../UI/Components/Workflow/PortLayout";
import { loadComponentsAndCategories } from "../../../../UI/Components/Workflow/Utils";
import { describe, expect, test } from "@jest/globals";

interface Card {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const CATALOG: Array<ComponentMetadata> =
  loadComponentsAndCategories().components;

function metadataOf(metadataId: string): ComponentMetadata {
  const metadata: ComponentMetadata | undefined = CATALOG.find(
    (component: ComponentMetadata): boolean => {
      return component.id === metadataId;
    },
  );

  if (!metadata) {
    throw new Error(`No workflow step ${metadataId}`);
  }

  return metadata;
}

// Each step as the canvas draws it: its width from its outputs, as Component.tsx does.
function cardsOf(graph: JSONObject): Array<Card> {
  return (graph["nodes"] as Array<JSONObject>).map((node: JSONObject): Card => {
    const data: JSONObject = node["data"] as JSONObject;
    const position: { x: number; y: number } = node["position"] as {
      x: number;
      y: number;
    };
    const ports: Array<Port> = getComponentOutPorts({
      metadata: metadataOf(data["metadataId"] as string),
      arguments: data["arguments"] as JSONObject,
    });
    const width: number =
      getOutputLayout(
        ports.map((port: Port): string => {
          return port.title || "";
        }),
      ).widerCardWidth || WORKFLOW_NODE_WIDTH;

    return {
      id: data["id"] as string,
      left: position.x,
      top: position.y,
      right: position.x + width,
      bottom: position.y + DEFAULT_NODE_HEIGHT,
    };
  });
}

function overlaps(a: Card, b: Card): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

// Every pair of cards that lie on each other, by step id.
function overlapping(cards: Array<Card>): Array<string> {
  const found: Array<string> = [];

  cards.forEach((card: Card, index: number) => {
    for (const other of cards.slice(index + 1)) {
      if (overlaps(card, other)) {
        found.push(`${card.id} and ${other.id}`);
      }
    }
  });

  return found;
}

function graphFor(options: HuntressIncidentWorkflowOptions): JSONObject {
  let counter: number = 0;

  return buildHuntressIncidentWorkflowGraph(options, (): string => {
    counter++;
    return `layout-${counter}`;
  });
}

// The template, and each workflow a connection could have become.
const LAYOUTS: Array<[string, HuntressIncidentWorkflowOptions]> = [
  ["the template", HUNTRESS_TEMPLATE_OPTIONS],
  [
    "the template, with a policy picked",
    { ...HUNTRESS_TEMPLATE_OPTIONS, onCallPolicyIds: ["policy"] },
  ],
  ...AllHuntressSeverities.map(
    (
      threshold: HuntressSeverity,
    ): [string, HuntressIncidentWorkflowOptions] => {
      return [
        `a connection that paged for ${threshold} reports and up`,
        {
          pages: true,
          onCallPolicyIds: ["policy"],
          pageOnCallFor: threshold,
          labelIds: ["label"],
          resolveWhenClosed: true,
        },
      ];
    },
  ),
  [
    "a connection that paged nobody and only noted a close",
    {
      pages: false,
      pageOnCallFor: HuntressSeverity.High,
      resolveWhenClosed: false,
    },
  ],
];

describe("the Huntress workflow on the canvas", () => {
  test.each(LAYOUTS)(
    "%s: no card lies on another",
    (_name: string, options: HuntressIncidentWorkflowOptions) => {
      expect(overlapping(cardsOf(graphFor(options)))).toEqual([]);
    },
  );

  test.each(LAYOUTS)(
    "%s: the trigger is the top card, and every step is below the one it follows",
    (_name: string, options: HuntressIncidentWorkflowOptions) => {
      const graph: JSONObject = graphFor(options);
      const cards: Array<Card> = cardsOf(graph);
      const trigger: Card = cards.find((card: Card): boolean => {
        return card.id === HUNTRESS_TRIGGER_COMPONENT_ID;
      }) as Card;

      for (const card of cards) {
        if (card !== trigger) {
          expect(card.top).toBeGreaterThan(trigger.top);
        }
      }

      const nodeIdToCard: Map<string, Card> = new Map();

      (graph["nodes"] as Array<JSONObject>).forEach(
        (node: JSONObject, index: number) => {
          nodeIdToCard.set(node["id"] as string, cards[index] as Card);
        },
      );

      for (const edge of graph["edges"] as Array<JSONObject>) {
        const from: Card = nodeIdToCard.get(edge["source"] as string) as Card;
        const to: Card = nodeIdToCard.get(edge["target"] as string) as Card;

        expect({
          edge: `${from.id} to ${to.id}`,
          below: to.top > from.top,
        }).toEqual({
          edge: `${from.id} to ${to.id}`,
          below: true,
        });
      }
    },
  );

  // So the check above sees an overlap when there is one.
  test("two cards in the same place, or side by side closer than a card is wide, overlap", () => {
    const card: Card = {
      id: "a",
      left: 0,
      top: 0,
      right: WORKFLOW_NODE_WIDTH,
      bottom: DEFAULT_NODE_HEIGHT,
    };

    expect(overlapping([card, { ...card, id: "b" }])).toEqual(["a and b"]);
    expect(
      overlapping([
        card,
        {
          id: "c",
          left: WORKFLOW_NODE_WIDTH - 1,
          top: DEFAULT_NODE_HEIGHT - 1,
          right: 2 * WORKFLOW_NODE_WIDTH,
          bottom: 2 * DEFAULT_NODE_HEIGHT,
        },
      ]),
    ).toEqual(["a and c"]);
    // A row below, or a card's width to the side, is clear.
    expect(
      overlapping([
        card,
        {
          ...card,
          id: "d",
          top: DEFAULT_NODE_HEIGHT,
          bottom: 2 * DEFAULT_NODE_HEIGHT,
        },
        {
          ...card,
          id: "e",
          left: WORKFLOW_NODE_WIDTH,
          right: 2 * WORKFLOW_NODE_WIDTH,
        },
      ]),
    ).toEqual([]);
  });
});
