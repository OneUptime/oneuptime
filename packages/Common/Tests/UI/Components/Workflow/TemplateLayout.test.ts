/*
 * Every template on the canvas: one column, read from the trigger down,
 * each connection straight down from the output it leaves by.
 *
 * TemplateLayout lays a template's steps out by the canvas's rules - a card
 * 16rem wide, wider when its outputs' names need it, and its outputs in
 * equal columns along its bottom (PortLayout) - but it is Types, and cannot
 * import the canvas's code. This holds it to that code: for every step a
 * template uses, the width it gives a card and the place it gives each
 * output's dot are the ones the canvas draws (Component.tsx reads both from
 * getOutputLayout). Then, for every template: no card lies on another, and
 * in a template that is one column, every connection runs straight down.
 */

import { JSONObject } from "../../../../Types/JSON";
import ComponentMetadata, {
  ComponentType,
  Port,
} from "../../../../Types/Workflow/Component";
import { getComponentOutPorts } from "../../../../Types/Workflow/ComponentOutPorts";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import {
  TEMPLATE_ROW_HEIGHT,
  TEMPLATE_START,
  TemplateCardShape,
  TemplateColumn,
  getTemplateCardOutputs,
  getTemplateCardShape,
  layOutTemplateColumn,
} from "../../../../Types/Workflow/TemplateLayout";
import {
  WorkflowTemplate,
  buildGraphForTemplate,
  getWorkflowTemplates,
} from "../../../../Types/Workflow/Templates";
import {
  DEFAULT_NODE_HEIGHT,
  WORKFLOW_NODE_WIDTH,
} from "../../../../UI/Components/Workflow/NodePlacement";
import {
  OutputLayout,
  getOutputLayout,
} from "../../../../UI/Components/Workflow/PortLayout";
import { loadComponentsAndCategories } from "../../../../UI/Components/Workflow/Utils";
import { describe, expect, test } from "@jest/globals";

const CATALOG: Array<ComponentMetadata> =
  loadComponentsAndCategories().components;

const TEMPLATES: Array<WorkflowTemplate> = getWorkflowTemplates();

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

let generated: number = 0;

function graphOf(templateId: string): JSONObject {
  return buildGraphForTemplate(templateId, (): string => {
    generated++;
    return `layout-${generated}`;
  }) as JSONObject;
}

// A card as the canvas draws it: its width and its outputs' dots, from its outputs' names.
function canvasShapeOf(ports: Array<Port>): TemplateCardShape {
  const layout: OutputLayout = getOutputLayout(
    ports.map((port: Port): string => {
      return port.title || "";
    }),
  );
  const width: number = layout.widerCardWidth || WORKFLOW_NODE_WIDTH;
  const dotX: Record<string, number> = {};

  ports.forEach((port: Port, index: number): void => {
    dotX[port.id] = ((layout.dotLeftPercents[index] as number) / 100) * width;
  });

  return { width: width, dotX: dotX };
}

// A shape to the pixel: a third of a card is a third, however it is worked out.
function inWholePixels(shape: TemplateCardShape): TemplateCardShape {
  const dotX: Record<string, number> = {};

  for (const [port, x] of Object.entries(shape.dotX)) {
    dotX[port] = Math.round(x);
  }

  return { width: shape.width, dotX: dotX };
}

interface Card {
  id: string;
  metadataId: string;
  left: number;
  top: number;
  width: number;
  ports: Array<Port>;
}

function cardsOf(graph: JSONObject): Map<string, Card> {
  const cards: Map<string, Card> = new Map();

  for (const node of graph["nodes"] as Array<JSONObject>) {
    const data: JSONObject = node["data"] as JSONObject;
    const position: { x: number; y: number } = node["position"] as {
      x: number;
      y: number;
    };
    const ports: Array<Port> = getComponentOutPorts({
      metadata: metadataOf(data["metadataId"] as string),
      arguments: data["arguments"] as JSONObject,
    });

    cards.set(node["id"] as string, {
      id: data["id"] as string,
      metadataId: data["metadataId"] as string,
      left: position.x,
      top: position.y,
      width: canvasShapeOf(ports).width,
      ports: ports,
    });
  }

  return cards;
}

function overlaps(a: Card, b: Card): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + DEFAULT_NODE_HEIGHT &&
    b.top < a.top + DEFAULT_NODE_HEIGHT
  );
}

// A template that is one column: each step leads to one at most, and is led to by one at most.
function isOneColumn(graph: JSONObject): boolean {
  const edges: Array<JSONObject> = graph["edges"] as Array<JSONObject>;
  const count: (key: string) => Map<string, number> = (
    key: string,
  ): Map<string, number> => {
    const counts: Map<string, number> = new Map();

    for (const edge of edges) {
      counts.set(
        edge[key] as string,
        (counts.get(edge[key] as string) || 0) + 1,
      );
    }

    return counts;
  };

  return (
    Array.from(count("source").values()).every((n: number): boolean => {
      return n === 1;
    }) &&
    Array.from(count("target").values()).every((n: number): boolean => {
      return n === 1;
    })
  );
}

// Every step a template uses, once.
const USED: Array<string> = Array.from(
  new Set(
    TEMPLATES.flatMap((template: WorkflowTemplate): Array<string> => {
      return (graphOf(template.id)["nodes"] as Array<JSONObject>).map(
        (node: JSONObject): string => {
          return (node["data"] as JSONObject)["metadataId"] as string;
        },
      );
    }),
  ),
).sort();

describe("a template's card, by the canvas's rules", () => {
  test("templates use built-in and database steps both, so both are held", () => {
    expect(USED).toContain(ComponentID.IncidentFromAnotherTool);
    expect(USED).toContain("incident-on-create");
    expect(USED).toContain("incident-find-one");
  });

  // A Switch / Case has an output per case, set per step: its cards are held below, as drawn.
  test.each(
    USED.filter((metadataId: string): boolean => {
      return metadataId !== ComponentID.Switch;
    }).map((metadataId: string): [string] => {
      return [metadataId];
    }),
  )(
    "%s has the outputs the canvas draws, in its order",
    (metadataId: string) => {
      expect(
        getTemplateCardOutputs(metadataId).map((port: Port): string => {
          return port.id;
        }),
      ).toEqual(
        metadataOf(metadataId).outPorts.map((port: Port): string => {
          return port.id;
        }),
      );
    },
  );

  test.each(
    USED.filter((metadataId: string): boolean => {
      return metadataId !== ComponentID.Switch;
    }).map((metadataId: string): [string] => {
      return [metadataId];
    }),
  )(
    "%s is as wide as the canvas draws it, its dots where it draws them",
    (metadataId: string) => {
      expect(inWholePixels(getTemplateCardShape(metadataId))).toEqual(
        inWholePixels(canvasShapeOf(metadataOf(metadataId).outPorts)),
      );
    },
  );

  // So the check above holds a card wider than 16rem as well as one that is not.
  test("a step whose outputs' names need room is wider than a card is", () => {
    const shape: TemplateCardShape = getTemplateCardShape(
      ComponentID.IncidentFromAnotherTool,
    );

    expect(shape.width).toBeGreaterThan(WORKFLOW_NODE_WIDTH);
    expect(getTemplateCardShape(ComponentID.Log).width).toBe(
      WORKFLOW_NODE_WIDTH,
    );
  });
});

describe("laying out a column", () => {
  const column: TemplateColumn = layOutTemplateColumn([
    {
      componentId: "webhook-1",
      metadataId: ComponentID.Webhook,
      componentType: ComponentType.Trigger,
    },
    {
      componentId: "incident-from-another-tool-1",
      metadataId: ComponentID.IncidentFromAnotherTool,
      componentType: ComponentType.Component,
      from: "out",
    },
    {
      componentId: "log-1",
      metadataId: ComponentID.Log,
      componentType: ComponentType.Component,
      from: "opened",
    },
  ]);

  test("starts with the trigger, and puts each step a row under the one before", () => {
    expect(
      column.nodes.map((node: { position: { y: number } }): number => {
        return node.position.y;
      }),
    ).toEqual([
      TEMPLATE_START.y,
      TEMPLATE_START.y + TEMPLATE_ROW_HEIGHT,
      TEMPLATE_START.y + 2 * TEMPLATE_ROW_HEIGHT,
    ]);
    expect(column.nodes[0]?.position.x).toBe(TEMPLATE_START.x);
  });

  test("connects each step from the output it names", () => {
    expect(column.edges).toEqual([
      {
        fromComponentId: "webhook-1",
        toComponentId: "incident-from-another-tool-1",
        fromPort: "out",
      },
      {
        fromComponentId: "incident-from-another-tool-1",
        toComponentId: "log-1",
        fromPort: "opened",
      },
    ]);
  });

  test("puts each step's middle under the dot of the output it comes from", () => {
    const [trigger, step, log] = column.nodes;
    const stepShape: TemplateCardShape = getTemplateCardShape(
      ComponentID.IncidentFromAnotherTool,
    );

    expect(
      Math.abs(
        (step?.position.x as number) +
          stepShape.width / 2 -
          ((trigger?.position.x as number) +
            (getTemplateCardShape(ComponentID.Webhook).dotX["out"] as number)),
      ),
    ).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs(
        (log?.position.x as number) +
          WORKFLOW_NODE_WIDTH / 2 -
          ((step?.position.x as number) + (stepShape.dotX["opened"] as number)),
      ),
    ).toBeLessThanOrEqual(0.5);
  });

  test("refuses a step that does not say which output leads to it, or names one the step above has not", () => {
    expect(() => {
      layOutTemplateColumn([
        {
          componentId: "webhook-1",
          metadataId: ComponentID.Webhook,
          componentType: ComponentType.Trigger,
        },
        {
          componentId: "log-1",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
        },
      ]);
    }).toThrow("says nothing about which of its outputs leads there");

    expect(() => {
      layOutTemplateColumn([
        {
          componentId: "webhook-1",
          metadataId: ComponentID.Webhook,
          componentType: ComponentType.Trigger,
        },
        {
          componentId: "log-1",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          from: "yes",
        },
      ]);
    }).toThrow("webhook-1 has no output yes to lead to log-1.");
  });
});

describe.each(
  TEMPLATES.map((template: WorkflowTemplate): [string] => {
    return [template.id];
  }),
)("template %s on the canvas", (templateId: string) => {
  const graph: JSONObject = graphOf(templateId);
  const cards: Map<string, Card> = cardsOf(graph);

  test("no card lies on another", () => {
    const all: Array<Card> = Array.from(cards.values());
    const found: Array<string> = [];

    all.forEach((card: Card, index: number): void => {
      for (const other of all.slice(index + 1)) {
        if (overlaps(card, other)) {
          found.push(`${card.id} and ${other.id}`);
        }
      }
    });

    expect(found).toEqual([]);
  });

  /*
   * To the pixel: a card sits at whole pixels, so a dot a third of the way
   * across a card is up to a pixel from the middle of the card below it.
   */
  test("in one column, each connection runs straight down from its output's dot", () => {
    if (!isOneColumn(graph)) {
      return;
    }

    for (const edge of graph["edges"] as Array<JSONObject>) {
      const from: Card = cards.get(edge["source"] as string) as Card;
      const to: Card = cards.get(edge["target"] as string) as Card;
      const dot: number = canvasShapeOf(from.ports).dotX[
        edge["sourceHandle"] as string
      ] as number;

      expect({
        edge: `${from.id} to ${to.id}`,
        straight: Math.abs(to.left + to.width / 2 - (from.left + dot)) <= 1,
      }).toEqual({ edge: `${from.id} to ${to.id}`, straight: true });
    }
  });
});

describe("the templates in one column", () => {
  // So the check above checks something: most templates are one column now.
  test("are most of them, the integrations' every one", () => {
    const oneColumn: Array<string> = TEMPLATES.filter(
      (template: WorkflowTemplate): boolean => {
        return isOneColumn(graphOf(template.id));
      },
    ).map((template: WorkflowTemplate): string => {
      return template.id;
    });

    expect(oneColumn.length).toBeGreaterThan(TEMPLATES.length / 2);

    const integration: RegExp = /^(jira|dynamics|zabbix|huntress)-/;

    for (const template of TEMPLATES) {
      if (integration.test(template.id)) {
        expect(oneColumn).toContain(template.id);
      }
    }
  });
});
