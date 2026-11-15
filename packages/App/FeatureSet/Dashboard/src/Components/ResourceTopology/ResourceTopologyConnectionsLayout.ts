import computeCorrelationLayout from "../../Utils/CorrelationGraphLayout";
import { LayoutPoint } from "../../Utils/LayeredGraphLayout";
import { TopologyConnectionsView } from "./ResourceTopologyConnections";

/*
 * Where the Connections view's cards stand: the middle at the origin, the
 * ring around it and the outer ring further out, each outer part pulled
 * toward the parts of the ring it is connected to - Security Events'
 * layout (CorrelationGraphLayout), measured for these cards and for the
 * canvas they are drawn on, so no card is ever drawn over another.
 *
 * Free of React: the canvas draws what this places, and a plain Node test
 * checks every card's room at every canvas shape.
 */

export type ConnectionsNodeVariant = "center" | "ring" | "outer";

export const CONNECTIONS_NODE_SIZES: Record<
  ConnectionsNodeVariant,
  { width: number; height: number }
> = {
  center: { width: 220, height: 56 },
  ring: { width: 196, height: 56 },
  outer: { width: 164, height: 32 },
};

/*
 * The rings are drawn as wide as the canvas is, against its height - round
 * on a phone, at most 1.6 times as wide as tall, as Security Events' - so
 * the drawing fills the canvas and is framed at the largest zoom it fits.
 */
export const CONNECTIONS_MAX_STRETCH: number = 1.6;

// The air kept between two cards.
export const CONNECTIONS_CARD_GAP: number = 12;

export interface ConnectionsLayoutShape {
  horizontalStretch: number;
  minClassRadius: number;
  classSpacing: number;
  ringGap: number;
  observableSpacing: number;
  staggerThreshold: number;
}

/*
 * The rings' measures for a canvas, so no card is drawn over another:
 *
 *   - Two neighbours on a ring sit one over the other at its sides, and
 *     side by side at its top and bottom, as far apart as their arc times
 *     the stretch. So the arc is a card and its air across, after the
 *     stretch, with a little more for the ring's curve: wherever on the
 *     ring two neighbours meet, they are apart one way or the other.
 *   - The outer ring keeps one radius. Security Events alternates its
 *     pills between two radii to pack them closer, but on a canvas less
 *     wide than its own a pill and its neighbour on the other radius meet
 *     corner to corner on the ring's diagonals.
 *   - The gap between the rings, and the ring's own radius, are at least
 *     half of each card across at the sides, after the stretch.
 */
export function getConnectionsLayoutShape(canvas: {
  width: number;
  height: number;
}): ConnectionsLayoutShape {
  const aspect: number =
    canvas.width > 0 && canvas.height > 0 ? canvas.width / canvas.height : 1.6;
  // Rounded, so a scrollbar coming and going does not lay it out again.
  const stretch: number =
    Math.round(Math.min(CONNECTIONS_MAX_STRETCH, Math.max(1, aspect)) * 10) /
    10;
  const sizes: typeof CONNECTIONS_NODE_SIZES = CONNECTIONS_NODE_SIZES;
  const across: (width: number) => number = (width: number): number => {
    return Math.ceil((width * 1.1) / stretch);
  };

  return {
    horizontalStretch: stretch,
    minClassRadius: Math.max(
      170,
      Math.ceil(
        (sizes.center.width / 2 + sizes.ring.width / 2 + CONNECTIONS_CARD_GAP) /
          stretch,
      ),
    ),
    classSpacing: Math.max(
      170,
      across(sizes.ring.width + CONNECTIONS_CARD_GAP),
    ),
    ringGap: Math.max(
      120,
      Math.ceil(
        (sizes.ring.width / 2 + sizes.outer.width / 2 + CONNECTIONS_CARD_GAP) /
          stretch,
      ),
    ),
    observableSpacing: Math.max(
      115,
      across(sizes.outer.width + CONNECTIONS_CARD_GAP),
    ),
    staggerThreshold: Number.MAX_SAFE_INTEGER,
  };
}

// The card a drawn part is: the middle's, a ring card or an outer pill.
export function getConnectionsNodeVariant(
  view: TopologyConnectionsView,
  id: string,
): ConnectionsNodeVariant {
  if (id === view.centerId) {
    return "center";
  }

  return view.ring.includes(id) ? "ring" : "outer";
}

/*
 * Each drawn part's centre. An outer part is pulled toward the ring parts
 * it is connected to, so a load balancer stands by the interfaces it sends
 * traffic to.
 */
export function layoutTopologyConnections(
  view: TopologyConnectionsView,
  shape: ConnectionsLayoutShape,
): Map<string, LayoutPoint> {
  const ringSet: Set<string> = new Set<string>(view.ring);
  const outerSet: Set<string> = new Set<string>(view.outerRing);
  const pulls: Array<{ from: string; to: string; count: number }> = [];

  for (const edge of view.edges) {
    if (ringSet.has(edge.from) && outerSet.has(edge.to)) {
      pulls.push({ from: edge.from, to: edge.to, count: 1 });
    } else if (ringSet.has(edge.to) && outerSet.has(edge.from)) {
      pulls.push({ from: edge.to, to: edge.from, count: 1 });
    }
  }

  return computeCorrelationLayout(
    [
      { id: view.centerId, kind: "center" },
      ...view.ring.map((id: string) => {
        return { id, kind: "class" as const };
      }),
      ...view.outerRing.map((id: string) => {
        return { id, kind: "observable" as const };
      }),
    ],
    pulls,
    shape,
  );
}

/*
 * Where a line from a card's centre toward a point leaves the card: the
 * line is drawn between the cards' edges, so its arrow is never under one.
 */
export function clipToCard(
  from: LayoutPoint,
  toward: LayoutPoint,
  size: { width: number; height: number },
): LayoutPoint {
  const dx: number = toward.x - from.x;
  const dy: number = toward.y - from.y;

  if (dx === 0 && dy === 0) {
    return from;
  }

  const scale: number = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : size.width / 2 / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : size.height / 2 / Math.abs(dy),
  );

  if (scale >= 1) {
    return from;
  }

  return { x: from.x + dx * scale, y: from.y + dy * scale };
}
