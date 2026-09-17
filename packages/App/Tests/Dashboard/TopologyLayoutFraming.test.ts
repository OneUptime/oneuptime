import { computeTopologyLayout } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyLayout";
import { computeForceTopologyModel } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/ForceTopologyLayout";
import { TopologyLayoutModel } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyModel";
import {
  TopologyNodeFootprint,
  footprintForNode,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyFootprint";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";

/*
 * Framing regression tests for the force-directed topology layout.
 *
 * The layout used the textbook Fruchterman-Reingold ideal edge length
 * (sqrt(area / n)) unscaled. For the node counts a real network map has,
 * that length is a large fraction of the frame itself, so all-pairs
 * repulsion drove every node past the frame edge and the clamp parked it on
 * the margin — 12 devices rendered as 12 nodes in a ring around an empty
 * middle. These tests pin the two properties that stops: nodes settle off
 * the frame edge, and the graph is spread rather than huddled.
 */

const WIDTH: number = 1000;
const HEIGHT: number = 700;
const MARGIN: number = 48;
const EDGE_TOLERANCE: number = 0.5;

function makeNodes(count: number): Array<NetworkTopologyNode> {
  const nodes: Array<NetworkTopologyNode> = [];
  for (let i: number = 0; i < count; i++) {
    nodes.push({
      id: `device-${i}`,
      label: `device-${i}`,
      isManaged: true,
    } as unknown as NetworkTopologyNode);
  }
  return nodes;
}

// A chain: device-0 — device-1 — ... — device-(n-1).
function makeChainEdges(count: number): Array<NetworkTopologyEdge> {
  const edges: Array<NetworkTopologyEdge> = [];
  for (let i: number = 0; i + 1 < count; i++) {
    edges.push({
      fromNodeId: `device-${i}`,
      toNodeId: `device-${i + 1}`,
    } as unknown as NetworkTopologyEdge);
  }
  return edges;
}

function onFrameEdge(point: { x: number; y: number }): boolean {
  return (
    Math.abs(point.x - MARGIN) < EDGE_TOLERANCE ||
    Math.abs(point.x - (WIDTH - MARGIN)) < EDGE_TOLERANCE ||
    Math.abs(point.y - MARGIN) < EDGE_TOLERANCE ||
    Math.abs(point.y - (HEIGHT - MARGIN)) < EDGE_TOLERANCE
  );
}

describe("force topology layout framing", () => {
  /*
   * The fit pass scales the settled shape's bounding box onto the frame, so
   * the nodes defining that box land on the edge by construction. Anything
   * beyond that is the clamp catching a node that the simulation pushed out
   * of the frame — the artifact this guards against.
   */
  test.each([2, 4, 6, 8, 12, 16, 24])(
    "%i nodes do not pile onto the frame edge",
    (count: number) => {
      const layout: Map<string, { x: number; y: number }> =
        computeTopologyLayout(
          makeNodes(count),
          makeChainEdges(count),
          WIDTH,
          HEIGHT,
        );

      const onEdge: number = Array.from(layout.values()).filter(
        (point: { x: number; y: number }) => {
          return onFrameEdge(point);
        },
      ).length;

      expect(onEdge).toBeLessThanOrEqual(4);
    },
  );

  test.each([4, 8, 12, 16, 24])(
    "%i nodes stay far enough apart to render as distinct nodes",
    (count: number) => {
      const layout: Map<string, { x: number; y: number }> =
        computeTopologyLayout(
          makeNodes(count),
          makeChainEdges(count),
          WIDTH,
          HEIGHT,
        );

      const points: Array<{ x: number; y: number }> = Array.from(
        layout.values(),
      );

      let minimumSeparation: number = Infinity;
      for (let i: number = 0; i < points.length; i++) {
        for (let j: number = i + 1; j < points.length; j++) {
          minimumSeparation = Math.min(
            minimumSeparation,
            Math.hypot(
              points[i]!.x - points[j]!.x,
              points[i]!.y - points[j]!.y,
            ),
          );
        }
      }

      // Node circles are drawn at r=16, so 32 is bare contact.
      expect(minimumSeparation).toBeGreaterThan(32);
    },
  );

  test("the graph spans a useful share of the frame rather than huddling", () => {
    const layout: Map<string, { x: number; y: number }> = computeTopologyLayout(
      makeNodes(8),
      makeChainEdges(8),
      WIDTH,
      HEIGHT,
    );

    const xs: Array<number> = Array.from(layout.values()).map(
      (p: { x: number; y: number }) => {
        return p.x;
      },
    );
    const ys: Array<number> = Array.from(layout.values()).map(
      (p: { x: number; y: number }) => {
        return p.y;
      },
    );

    const spanX: number = Math.max(...xs) - Math.min(...xs);
    const spanY: number = Math.max(...ys) - Math.min(...ys);

    // At least one axis is filled by the fit pass; the other follows it.
    expect(
      Math.max(spanX / (WIDTH - 2 * MARGIN), spanY / (HEIGHT - 2 * MARGIN)),
    ).toBeGreaterThan(0.95);
  });

  /*
   * The layout centres the PAINTED extent — glyph plus the label
   * underneath it — rather than the node's centre point. A label hangs
   * below a node and nothing hangs above it, so centring the centre point
   * leaves the thing a reader actually sees sitting high in the frame by
   * half a label height. The node centre therefore lands slightly above
   * the middle, and that is the correct answer, not a rounding error.
   */
  test("a single node's painted extent is centred, not parked in a corner", () => {
    const nodes: Array<NetworkTopologyNode> = makeNodes(1);
    const layout: Map<string, { x: number; y: number }> = computeTopologyLayout(
      nodes,
      [],
      WIDTH,
      HEIGHT,
    );

    const point: { x: number; y: number } = layout.get("device-0")!;
    const footprint: TopologyNodeFootprint = footprintForNode(nodes[0]!);

    expect(point.x).toBeCloseTo(WIDTH / 2, 0);
    const inkTop: number = point.y - footprint.halfHeight;
    const inkBottom: number = point.y + footprint.labelBottom;
    expect((inkTop + inkBottom) / 2).toBeCloseTo(HEIGHT / 2, 0);
    // ...and the node itself is above centre by exactly that asymmetry.
    expect(point.y).toBeLessThan(HEIGHT / 2);
  });

  test("no node's painted extent escapes the reported content box", () => {
    const nodes: Array<NetworkTopologyNode> = makeNodes(16);
    const model: TopologyLayoutModel = computeForceTopologyModel(
      nodes,
      makeChainEdges(16),
      WIDTH,
      HEIGHT,
    );

    for (const node of nodes) {
      const point: { x: number; y: number } = model.positions.get(node.id)!;
      const footprint: TopologyNodeFootprint = footprintForNode(node);
      expect(point.x - footprint.inkHalfWidth).toBeGreaterThanOrEqual(-0.001);
      expect(point.x + footprint.inkHalfWidth).toBeLessThanOrEqual(
        model.contentWidth + 0.001,
      );
      expect(point.y - footprint.halfHeight).toBeGreaterThanOrEqual(-0.001);
      expect(point.y + footprint.labelBottom).toBeLessThanOrEqual(
        model.contentHeight + 0.001,
      );
    }
  });
});
