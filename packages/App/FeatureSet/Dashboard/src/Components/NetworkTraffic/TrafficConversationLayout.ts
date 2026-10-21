import { NetworkTrafficConversationRow } from "Common/Types/NetFlow/NetworkTraffic";

/*
 * Where the conversation diagram draws everything: senders down the left,
 * receivers down the right, and a band between each pair as thick as the
 * bytes they exchanged - the busiest at the top on both sides.
 *
 * Bands of one node stack inside its bar in the order of the node at their
 * other end, so they never cross on their way out of a bar. Every node gets
 * a slot tall enough for its label even when its bar is a sliver: the bars
 * keep their true thickness, the slots keep the labels readable.
 *
 * An address that both sends and receives is on both sides - once as a
 * sender, once as a receiver - as the table under the diagram reads.
 *
 * Plain geometry, free of React, so App/Tests can read it.
 */

export const DIAGRAM_WIDTH: number = 720;
// Room for the labels beside each column of bars.
export const LABEL_GUTTER: number = 168;
export const BAR_WIDTH: number = 10;
// The tallest the two columns of bars get together.
export const BARS_HEIGHT: number = 260;
// A node's slot is never shorter than this: room for its label.
export const MIN_SLOT_HEIGHT: number = 22;
export const SLOT_GAP: number = 6;
// A sliver of traffic still draws something you can point at.
export const MIN_BAR_HEIGHT: number = 2;
export const MIN_BAND_THICKNESS: number = 1;
export const PADDING_Y: number = 8;

export type DiagramSide = "source" | "destination";

export interface DiagramNode {
  side: DiagramSide;
  address: string;
  octets: number;
  x: number;
  // Top of the bar.
  y: number;
  height: number;
  // Middle of the node's slot: where its label sits.
  labelY: number;
}

export interface DiagramBand {
  sourceIp: string;
  destinationIp: string;
  octets: number;
  thickness: number;
  // A closed SVG path: out of the sender's bar, into the receiver's.
  path: string;
}

export interface ConversationDiagramLayout {
  width: number;
  height: number;
  nodes: Array<DiagramNode>;
  bands: Array<DiagramBand>;
}

interface NodeTotal {
  address: string;
  octets: number;
}

function totalsBy(
  conversations: Array<NetworkTrafficConversationRow>,
  key: "sourceIp" | "destinationIp",
): Array<NodeTotal> {
  const totals: Map<string, number> = new Map();

  for (const conversation of conversations) {
    totals.set(
      conversation[key],
      (totals.get(conversation[key]) || 0) + conversation.octets,
    );
  }

  return Array.from(totals.entries())
    .map(([address, octets]: [string, number]): NodeTotal => {
      return { address: address, octets: octets };
    })
    .sort((a: NodeTotal, b: NodeTotal): number => {
      return b.octets - a.octets || a.address.localeCompare(b.address);
    });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function layoutConversationDiagram(
  conversations: Array<NetworkTrafficConversationRow>,
): ConversationDiagramLayout {
  const flowing: Array<NetworkTrafficConversationRow> = conversations.filter(
    (conversation: NetworkTrafficConversationRow): boolean => {
      return conversation.octets > 0;
    },
  );

  const sources: Array<NodeTotal> = totalsBy(flowing, "sourceIp");
  const destinations: Array<NodeTotal> = totalsBy(flowing, "destinationIp");
  const total: number = flowing.reduce(
    (sum: number, conversation: NetworkTrafficConversationRow): number => {
      return sum + conversation.octets;
    },
    0,
  );

  if (total === 0) {
    return { width: DIAGRAM_WIDTH, height: 0, nodes: [], bands: [] };
  }

  // One scale for both columns: a byte is as thick on the left as on the right.
  const scale: number = BARS_HEIGHT / total;

  const place: (
    totals: Array<NodeTotal>,
    side: DiagramSide,
  ) => { nodes: Map<string, DiagramNode>; height: number } = (
    totals: Array<NodeTotal>,
    side: DiagramSide,
  ): { nodes: Map<string, DiagramNode>; height: number } => {
    const nodes: Map<string, DiagramNode> = new Map();
    let y: number = PADDING_Y;

    for (const node of totals) {
      const barHeight: number = Math.max(MIN_BAR_HEIGHT, node.octets * scale);
      const slotHeight: number = Math.max(MIN_SLOT_HEIGHT, barHeight);
      // The bar sits in the middle of its slot.
      const barTop: number = y + (slotHeight - barHeight) / 2;

      nodes.set(node.address, {
        side: side,
        address: node.address,
        octets: node.octets,
        x:
          side === "source"
            ? LABEL_GUTTER
            : DIAGRAM_WIDTH - LABEL_GUTTER - BAR_WIDTH,
        y: round(barTop),
        height: round(barHeight),
        labelY: round(y + slotHeight / 2),
      });

      y += slotHeight + SLOT_GAP;
    }

    return { nodes: nodes, height: y - SLOT_GAP + PADDING_Y };
  };

  const left: { nodes: Map<string, DiagramNode>; height: number } = place(
    sources,
    "source",
  );
  const right: { nodes: Map<string, DiagramNode>; height: number } = place(
    destinations,
    "destination",
  );

  const sourceOrder: Map<string, number> = new Map(
    sources.map((node: NodeTotal, index: number): [string, number] => {
      return [node.address, index];
    }),
  );
  const destinationOrder: Map<string, number> = new Map(
    destinations.map((node: NodeTotal, index: number): [string, number] => {
      return [node.address, index];
    }),
  );

  // How far down each bar the next band leaves (or arrives).
  const sourceOffsets: Map<string, number> = new Map();
  const destinationOffsets: Map<string, number> = new Map();

  /*
   * Out of each sender in the order of the receivers, into each receiver in
   * the order of the senders: the stacking that keeps a node's bands from
   * crossing at the node.
   */
  const outgoing: Array<NetworkTrafficConversationRow> = [...flowing].sort(
    (
      a: NetworkTrafficConversationRow,
      b: NetworkTrafficConversationRow,
    ): number => {
      return (
        sourceOrder.get(a.sourceIp)! - sourceOrder.get(b.sourceIp)! ||
        destinationOrder.get(a.destinationIp)! -
          destinationOrder.get(b.destinationIp)!
      );
    },
  );

  const sourceStart: Map<string, number> = new Map();

  for (const conversation of outgoing) {
    const node: DiagramNode = left.nodes.get(conversation.sourceIp)!;
    const offset: number = sourceOffsets.get(conversation.sourceIp) || 0;
    sourceStart.set(
      `${conversation.sourceIp}>${conversation.destinationIp}`,
      node.y + offset,
    );
    sourceOffsets.set(
      conversation.sourceIp,
      offset + Math.max(MIN_BAND_THICKNESS, conversation.octets * scale),
    );
  }

  const incoming: Array<NetworkTrafficConversationRow> = [...flowing].sort(
    (
      a: NetworkTrafficConversationRow,
      b: NetworkTrafficConversationRow,
    ): number => {
      return (
        destinationOrder.get(a.destinationIp)! -
          destinationOrder.get(b.destinationIp)! ||
        sourceOrder.get(a.sourceIp)! - sourceOrder.get(b.sourceIp)!
      );
    },
  );

  const bands: Array<DiagramBand> = [];
  const fromX: number = LABEL_GUTTER + BAR_WIDTH;
  const toX: number = DIAGRAM_WIDTH - LABEL_GUTTER - BAR_WIDTH;
  const middleX: number = round((fromX + toX) / 2);

  for (const conversation of incoming) {
    const node: DiagramNode = right.nodes.get(conversation.destinationIp)!;
    const offset: number =
      destinationOffsets.get(conversation.destinationIp) || 0;
    const thickness: number = round(
      Math.max(MIN_BAND_THICKNESS, conversation.octets * scale),
    );
    const sourceTop: number = round(
      sourceStart.get(
        `${conversation.sourceIp}>${conversation.destinationIp}`,
      )!,
    );
    const destinationTop: number = round(node.y + offset);

    destinationOffsets.set(conversation.destinationIp, offset + thickness);

    bands.push({
      sourceIp: conversation.sourceIp,
      destinationIp: conversation.destinationIp,
      octets: conversation.octets,
      thickness: thickness,
      path: [
        `M ${fromX} ${sourceTop}`,
        `C ${middleX} ${sourceTop} ${middleX} ${destinationTop} ${toX} ${destinationTop}`,
        `L ${toX} ${round(destinationTop + thickness)}`,
        `C ${middleX} ${round(destinationTop + thickness)} ${middleX} ${round(sourceTop + thickness)} ${fromX} ${round(sourceTop + thickness)}`,
        "Z",
      ].join(" "),
    });
  }

  // The busiest band last, so it draws on top.
  bands.sort((a: DiagramBand, b: DiagramBand): number => {
    return a.octets - b.octets;
  });

  return {
    width: DIAGRAM_WIDTH,
    height: round(Math.max(left.height, right.height)),
    nodes: [...left.nodes.values(), ...right.nodes.values()],
    bands: bands,
  };
}
