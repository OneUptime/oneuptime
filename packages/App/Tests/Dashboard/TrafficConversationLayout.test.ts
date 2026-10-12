import { describe, expect, test } from "@jest/globals";
import {
  BARS_HEIGHT,
  BAR_WIDTH,
  ConversationDiagramLayout,
  DIAGRAM_WIDTH,
  DiagramBand,
  DiagramNode,
  LABEL_GUTTER,
  MIN_BAND_THICKNESS,
  MIN_BAR_HEIGHT,
  MIN_SLOT_HEIGHT,
  PADDING_Y,
  SLOT_GAP,
  layoutConversationDiagram,
} from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/TrafficConversationLayout";
import { NetworkTrafficConversationRow } from "Common/Types/NetFlow/NetworkTraffic";

/*
 * The conversation diagram stays readable only if its geometry holds: one
 * scale for both columns, the busiest at the top, bands that leave and
 * enter their bars without crossing there, and a slot for every label even
 * when the traffic is a sliver.
 */

function row(
  sourceIp: string,
  destinationIp: string,
  octets: number,
): NetworkTrafficConversationRow {
  return {
    sourceIp: sourceIp,
    destinationIp: destinationIp,
    octets: octets,
    packets: 1,
  };
}

function nodesOn(
  layout: ConversationDiagramLayout,
  side: "source" | "destination",
): Array<DiagramNode> {
  return layout.nodes.filter((node: DiagramNode): boolean => {
    return node.side === side;
  });
}

function band(
  layout: ConversationDiagramLayout,
  sourceIp: string,
  destinationIp: string,
): DiagramBand {
  const found: DiagramBand | undefined = layout.bands.find(
    (candidate: DiagramBand): boolean => {
      return (
        candidate.sourceIp === sourceIp &&
        candidate.destinationIp === destinationIp
      );
    },
  );

  if (!found) {
    throw new Error(`No band ${sourceIp} -> ${destinationIp}`);
  }

  return found;
}

// The y where a band leaves its sender's bar: its path's first point.
function bandStartY(item: DiagramBand): number {
  return Number(item.path.split(" ")[2]);
}

const CONVERSATIONS: Array<NetworkTrafficConversationRow> = [
  row("10.0.0.5", "10.0.0.9", 6000),
  row("10.0.0.5", "8.8.8.8", 2000),
  row("10.0.0.7", "10.0.0.9", 1500),
  row("10.0.0.8", "1.1.1.1", 500),
];

describe("layoutConversationDiagram", () => {
  test("nothing to draw: no nodes, no bands, no height", () => {
    expect(layoutConversationDiagram([])).toEqual({
      width: DIAGRAM_WIDTH,
      height: 0,
      nodes: [],
      bands: [],
    });
    // A pair that carried nothing draws nothing either.
    expect(
      layoutConversationDiagram([row("10.0.0.1", "10.0.0.2", 0)]).nodes,
    ).toEqual([]);
  });

  test("senders on the left, receivers on the right, each address once per side, busiest first", () => {
    const layout: ConversationDiagramLayout =
      layoutConversationDiagram(CONVERSATIONS);

    expect(
      nodesOn(layout, "source").map((node: DiagramNode): string => {
        return node.address;
      }),
    ).toEqual(["10.0.0.5", "10.0.0.7", "10.0.0.8"]);
    expect(
      nodesOn(layout, "destination").map((node: DiagramNode): string => {
        return node.address;
      }),
    ).toEqual(["10.0.0.9", "8.8.8.8", "1.1.1.1"]);

    for (const node of nodesOn(layout, "source")) {
      expect(node.x).toBe(LABEL_GUTTER);
    }
    for (const node of nodesOn(layout, "destination")) {
      expect(node.x).toBe(DIAGRAM_WIDTH - LABEL_GUTTER - BAR_WIDTH);
    }
  });

  test("a node's bytes are the sum of its conversations", () => {
    const layout: ConversationDiagramLayout =
      layoutConversationDiagram(CONVERSATIONS);

    expect(
      nodesOn(layout, "source").map((node: DiagramNode): number => {
        return node.octets;
      }),
    ).toEqual([8000, 1500, 500]);
    expect(
      nodesOn(layout, "destination").map((node: DiagramNode): number => {
        return node.octets;
      }),
    ).toEqual([7500, 2000, 500]);
  });

  test("one scale for both columns: the bars of each side add up to the same height", () => {
    const layout: ConversationDiagramLayout =
      layoutConversationDiagram(CONVERSATIONS);
    const sum: (nodes: Array<DiagramNode>) => number = (
      nodes: Array<DiagramNode>,
    ): number => {
      return nodes.reduce((total: number, node: DiagramNode): number => {
        return total + node.height;
      }, 0);
    };

    expect(sum(nodesOn(layout, "source"))).toBeCloseTo(BARS_HEIGHT, 1);
    expect(sum(nodesOn(layout, "destination"))).toBeCloseTo(BARS_HEIGHT, 1);
    // A band is as thick as its bytes on that scale.
    expect(band(layout, "10.0.0.5", "10.0.0.9").thickness).toBeCloseTo(
      (6000 / 10000) * BARS_HEIGHT,
      1,
    );
  });

  test("a node's bands fill its bar exactly, stacked in the order of the other side", () => {
    const layout: ConversationDiagramLayout =
      layoutConversationDiagram(CONVERSATIONS);
    const sender: DiagramNode = nodesOn(layout, "source")[0]!;
    const toBusiest: DiagramBand = band(layout, "10.0.0.5", "10.0.0.9");
    const toSecond: DiagramBand = band(layout, "10.0.0.5", "8.8.8.8");

    // Out of the top of the bar to the busiest receiver, then the next.
    expect(bandStartY(toBusiest)).toBeCloseTo(sender.y, 1);
    expect(bandStartY(toSecond)).toBeCloseTo(sender.y + toBusiest.thickness, 1);
    expect(toBusiest.thickness + toSecond.thickness).toBeCloseTo(
      sender.height,
      1,
    );
  });

  test("every label has a slot, however thin its traffic", () => {
    const layout: ConversationDiagramLayout = layoutConversationDiagram([
      row("10.0.0.1", "10.0.0.2", 1_000_000_000),
      row("10.0.0.3", "10.0.0.4", 1),
    ]);
    const sources: Array<DiagramNode> = nodesOn(layout, "source");

    // The sliver still draws a bar you can point at.
    expect(sources[1]!.height).toBe(MIN_BAR_HEIGHT);
    expect(band(layout, "10.0.0.3", "10.0.0.4").thickness).toBe(
      MIN_BAND_THICKNESS,
    );
    // The labels are at least a slot apart.
    expect(sources[1]!.labelY - sources[0]!.labelY).toBeGreaterThanOrEqual(
      MIN_SLOT_HEIGHT / 2 + SLOT_GAP,
    );
    // The bar sits in the middle of its slot.
    expect(sources[1]!.y + sources[1]!.height / 2).toBeCloseTo(
      sources[1]!.labelY,
      1,
    );
  });

  test("the diagram is as tall as its taller column, padded", () => {
    const layout: ConversationDiagramLayout =
      layoutConversationDiagram(CONVERSATIONS);
    const bottom: number = Math.max(
      ...layout.nodes.map((node: DiagramNode): number => {
        return node.y + node.height;
      }),
    );

    expect(layout.height).toBeGreaterThanOrEqual(bottom + PADDING_Y - 0.01);
    expect(layout.width).toBe(DIAGRAM_WIDTH);
  });

  test("ten conversations (the API's top ten) stay within a readable height", () => {
    const layout: ConversationDiagramLayout = layoutConversationDiagram(
      Array.from(
        { length: 10 },
        (_value: unknown, index: number): NetworkTrafficConversationRow => {
          return row(`10.0.0.${index + 1}`, `10.0.1.${index + 1}`, 1000);
        },
      ),
    );

    expect(nodesOn(layout, "source")).toHaveLength(10);
    expect(layout.bands).toHaveLength(10);
    expect(layout.height).toBeLessThanOrEqual(
      BARS_HEIGHT + 10 * MIN_SLOT_HEIGHT + 9 * SLOT_GAP + 2 * PADDING_Y,
    );
  });

  test("an address that sends and receives is drawn on both sides", () => {
    const layout: ConversationDiagramLayout = layoutConversationDiagram([
      row("10.0.0.5", "10.0.0.9", 100),
      row("10.0.0.9", "10.0.0.5", 50),
    ]);

    expect(
      layout.nodes.map((node: DiagramNode): string => {
        return `${node.side}:${node.address}`;
      }),
    ).toEqual([
      "source:10.0.0.5",
      "source:10.0.0.9",
      "destination:10.0.0.9",
      "destination:10.0.0.5",
    ]);
  });

  test("the busiest band is drawn last, on top, and every band is a closed path between the bars", () => {
    const layout: ConversationDiagramLayout =
      layoutConversationDiagram(CONVERSATIONS);

    expect(
      layout.bands.map((item: DiagramBand): number => {
        return item.octets;
      }),
    ).toEqual([500, 1500, 2000, 6000]);

    for (const item of layout.bands) {
      expect(item.path.startsWith(`M ${LABEL_GUTTER + BAR_WIDTH} `)).toBe(true);
      expect(item.path).toContain(
        ` ${DIAGRAM_WIDTH - LABEL_GUTTER - BAR_WIDTH} `,
      );
      expect(item.path.endsWith(" Z")).toBe(true);
    }
  });

  test("ties are broken by address, so the same data always draws the same picture", () => {
    const first: ConversationDiagramLayout = layoutConversationDiagram([
      row("10.0.0.2", "10.0.0.9", 100),
      row("10.0.0.1", "10.0.0.9", 100),
    ]);
    const second: ConversationDiagramLayout = layoutConversationDiagram([
      row("10.0.0.1", "10.0.0.9", 100),
      row("10.0.0.2", "10.0.0.9", 100),
    ]);

    expect(first).toEqual(second);
    expect(nodesOn(first, "source")[0]!.address).toBe("10.0.0.1");
  });
});
