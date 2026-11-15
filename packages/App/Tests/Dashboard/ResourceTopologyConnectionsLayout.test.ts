import { describe, expect, test } from "@jest/globals";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { LayoutPoint } from "../../FeatureSet/Dashboard/src/Utils/LayeredGraphLayout";
import {
  TOPOLOGY_CONNECTIONS_CENTER_ID,
  TOPOLOGY_CONNECTIONS_LIMITS,
  TopologyConnectionsEdge,
  TopologyConnectionsView,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyConnections";
import {
  CONNECTIONS_MAX_STRETCH,
  CONNECTIONS_NODE_SIZES,
  ConnectionsLayoutShape,
  clipToCard,
  getConnectionsLayoutShape,
  getConnectionsNodeVariant,
  layoutTopologyConnections,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyConnectionsLayout";

/*
 * Where the Connections view's cards stand. The rings are measured for the
 * cards and for the canvas they are drawn on - wide on a wide canvas,
 * round on a phone's - and whatever is on them, no card is ever drawn over
 * another: every ring size up to the view's limits, every canvas shape.
 */

// Canvases a person draws it on: a wide screen, a laptop beside the side menu, a square, a phone.
const CANVASES: Array<{ name: string; width: number; height: number }> = [
  { name: "wide", width: 1600, height: 740 },
  { name: "laptop", width: 888, height: 740 },
  { name: "square", width: 700, height: 700 },
  { name: "phone", width: 358, height: 520 },
];

/*
 * A view of `ringCount` parts around the middle and `outerCount` further
 * out, each outer part connected to one or two ring parts drawn at random -
 * or, crowded, every one to the first: a load balancer's thirty targets.
 */
function view(
  ringCount: number,
  outerCount: number,
  random: SeededRandom,
  crowded: boolean = false,
): TopologyConnectionsView {
  const ring: Array<string> = [];
  const outerRing: Array<string> = [];
  const edges: Array<TopologyConnectionsEdge> = [];

  for (let index: number = 0; index < ringCount; index++) {
    ring.push(`ring-${index}`);
    edges.push({
      id: `${TOPOLOGY_CONNECTIONS_CENTER_ID}|ring-${index}`,
      from: TOPOLOGY_CONNECTIONS_CENTER_ID,
      to: `ring-${index}`,
      relations: [],
      touchesCenter: true,
    });
  }

  for (let index: number = 0; index < outerCount; index++) {
    outerRing.push(`outer-${index}`);

    // Each outer part is connected to one or two parts of the ring.
    const links: number = crowded ? 1 : 1 + random(2);

    for (let link: number = 0; link < links && ringCount > 0; link++) {
      const from: string = crowded ? ring[0]! : ring[random(ringCount)]!;
      edges.push({
        id: `${from}|outer-${index}`,
        from,
        to: `outer-${index}`,
        relations: [
          {
            from,
            to: `outer-${index}`,
            label: "Sends traffic to",
            inverseLabel: "Gets traffic from",
          },
        ],
        touchesCenter: false,
      });
    }
  }

  return {
    centerKind: "search",
    centerId: TOPOLOGY_CONNECTIONS_CENTER_ID,
    ring,
    outerRing,
    edges,
    ringHidden: 0,
    outerRingHidden: 0,
  };
}

interface Box {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function boxesOf(
  layoutView: TopologyConnectionsView,
  positions: Map<string, LayoutPoint>,
): Array<Box> {
  return [layoutView.centerId, ...layoutView.ring, ...layoutView.outerRing].map(
    (id: string): Box => {
      const point: LayoutPoint = positions.get(id)!;
      const size: { width: number; height: number } =
        CONNECTIONS_NODE_SIZES[getConnectionsNodeVariant(layoutView, id)];

      return {
        id,
        left: point.x - size.width / 2,
        right: point.x + size.width / 2,
        top: point.y - size.height / 2,
        bottom: point.y + size.height / 2,
      };
    },
  );
}

// Pairs of cards drawn over each other.
function overlaps(boxes: Array<Box>): Array<string> {
  const found: Array<string> = [];

  for (let a: number = 0; a < boxes.length; a++) {
    for (let b: number = a + 1; b < boxes.length; b++) {
      const first: Box = boxes[a]!;
      const second: Box = boxes[b]!;

      if (
        first.left < second.right &&
        second.left < first.right &&
        first.top < second.bottom &&
        second.top < first.bottom
      ) {
        found.push(`${first.id} over ${second.id}`);
      }
    }
  }

  return found;
}

describe("the rings' measures", () => {
  test("as wide as the canvas against its height, from round to 1.6 times", () => {
    expect(
      getConnectionsLayoutShape({ width: 1600, height: 740 }).horizontalStretch,
    ).toBe(CONNECTIONS_MAX_STRETCH);
    expect(
      getConnectionsLayoutShape({ width: 888, height: 740 }).horizontalStretch,
    ).toBe(1.2);
    expect(
      getConnectionsLayoutShape({ width: 358, height: 520 }).horizontalStretch,
    ).toBe(1);
    // Before the canvas is measured: the widest.
    expect(
      getConnectionsLayoutShape({ width: 0, height: 740 }).horizontalStretch,
    ).toBe(CONNECTIONS_MAX_STRETCH);
  });

  test("a narrower stretch spaces the rings out more, so cards keep their room", () => {
    const wide: ConnectionsLayoutShape = getConnectionsLayoutShape({
      width: 1600,
      height: 740,
    });
    const round: ConnectionsLayoutShape = getConnectionsLayoutShape({
      width: 700,
      height: 700,
    });

    expect(round.classSpacing).toBeGreaterThan(wide.classSpacing);
    expect(round.ringGap).toBeGreaterThan(wide.ringGap);
    expect(round.observableSpacing).toBeGreaterThan(wide.observableSpacing);
  });

  test("a scrollbar coming and going lays nothing out again", () => {
    expect(getConnectionsLayoutShape({ width: 888, height: 740 })).toEqual(
      getConnectionsLayoutShape({ width: 873, height: 740 }),
    );
  });
});

describe("no card is drawn over another", () => {
  for (const canvas of CANVASES) {
    test(`on a ${canvas.name} canvas, for every ring up to the view's limits`, () => {
      const shape: ConnectionsLayoutShape = getConnectionsLayoutShape(canvas);
      const random: SeededRandom = seededRandom(5772);
      const found: Array<string> = [];

      for (
        let ringCount: number = 0;
        ringCount <= TOPOLOGY_CONNECTIONS_LIMITS.ring;
        ringCount++
      ) {
        for (
          let outerCount: number = 0;
          outerCount <= TOPOLOGY_CONNECTIONS_LIMITS.outerRing;
          outerCount += ringCount === 0 ? 100 : 1
        ) {
          for (const crowded of [false, true]) {
            const drawn: TopologyConnectionsView = view(
              ringCount,
              outerCount,
              random,
              crowded,
            );
            const positions: Map<string, LayoutPoint> =
              layoutTopologyConnections(drawn, shape);

            for (const overlap of overlaps(boxesOf(drawn, positions))) {
              found.push(
                `${ringCount} + ${outerCount}${crowded ? " crowded" : ""}: ${overlap}`,
              );
            }
          }
        }
      }

      expect(found).toEqual([]);
    });
  }
});

describe("where it stands", () => {
  test("the middle at the origin, the ring around it, the outer ring further out", () => {
    const drawn: TopologyConnectionsView = view(6, 8, seededRandom(1));
    const positions: Map<string, LayoutPoint> = layoutTopologyConnections(
      drawn,
      getConnectionsLayoutShape({ width: 1600, height: 740 }),
    );
    const reach: (id: string) => number = (id: string): number => {
      const point: LayoutPoint = positions.get(id)!;
      return Math.hypot(point.x / CONNECTIONS_MAX_STRETCH, point.y);
    };

    expect(positions.get(TOPOLOGY_CONNECTIONS_CENTER_ID)).toEqual({
      x: 0,
      y: 0,
    });

    const farthestRing: number = Math.max(...drawn.ring.map(reach));
    const nearestOuter: number = Math.min(...drawn.outerRing.map(reach));

    expect(nearestOuter).toBeGreaterThan(farthestRing);
  });

  test("an outer part stands by the ring part it is connected to", () => {
    const drawn: TopologyConnectionsView = view(8, 0, seededRandom(2));
    drawn.outerRing.push("balancer");
    drawn.edges.push({
      id: "ring-2|balancer",
      from: "ring-2",
      to: "balancer",
      relations: [],
      touchesCenter: false,
    });

    const positions: Map<string, LayoutPoint> = layoutTopologyConnections(
      drawn,
      getConnectionsLayoutShape({ width: 1600, height: 740 }),
    );
    const angle: (id: string) => number = (id: string): number => {
      const point: LayoutPoint = positions.get(id)!;
      return Math.atan2(point.y, point.x / CONNECTIONS_MAX_STRETCH);
    };

    expect(Math.abs(angle("balancer") - angle("ring-2"))).toBeLessThan(0.01);
  });

  test("the same view always lands in the same place", () => {
    const shape: ConnectionsLayoutShape = getConnectionsLayoutShape({
      width: 888,
      height: 740,
    });

    expect(
      Array.from(
        layoutTopologyConnections(view(9, 14, seededRandom(3)), shape),
      ),
    ).toEqual(
      Array.from(
        layoutTopologyConnections(view(9, 14, seededRandom(3)), shape),
      ),
    );
  });
});

describe("a line between two cards", () => {
  const size: { width: number; height: number } = { width: 200, height: 60 };

  test("leaves a card at its side, its top or its corner, toward the other", () => {
    expect(clipToCard({ x: 0, y: 0 }, { x: 500, y: 0 }, size)).toEqual({
      x: 100,
      y: 0,
    });
    expect(clipToCard({ x: 0, y: 0 }, { x: 0, y: -300 }, size)).toEqual({
      x: 0,
      y: -30,
    });
    expect(clipToCard({ x: 0, y: 0 }, { x: 400, y: 120 }, size)).toEqual({
      x: 100,
      y: 30,
    });
  });

  test("toward a point inside the card, or the card itself, stays at the centre", () => {
    expect(clipToCard({ x: 10, y: 10 }, { x: 20, y: 15 }, size)).toEqual({
      x: 10,
      y: 10,
    });
    expect(clipToCard({ x: 10, y: 10 }, { x: 10, y: 10 }, size)).toEqual({
      x: 10,
      y: 10,
    });
  });
});
