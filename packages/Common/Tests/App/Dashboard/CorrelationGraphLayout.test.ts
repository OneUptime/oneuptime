import { describe, expect, test } from "@jest/globals";
import computeCorrelationLayout from "../../../../App/FeatureSet/Dashboard/src/Utils/CorrelationGraphLayout";
import {
  CorrelationGraphEdge,
  CorrelationGraphNode,
  CorrelationGraphNodeKind,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/CorrelationGraph";
import { LayoutPoint } from "../../../../App/FeatureSet/Dashboard/src/Utils/LayeredGraphLayout";

/*
 * The Correlate hub-and-spoke layout: filter at the origin, classes on an
 * inner ellipse, observables on an outer one pulled toward the classes they
 * co-occurred with. The old layered layout put every observable on one row
 * — a 30-observable correlation was ~7000px wide and fit-to-view shrank it
 * past reading — so the size bound and the no-overlap guarantee are the
 * load-bearing assertions here.
 */

type LayoutNode = Pick<CorrelationGraphNode, "id" | "kind">;
type LayoutEdge = Pick<CorrelationGraphEdge, "from" | "to" | "count">;

// Rendered node footprints (px) — generous versions of the real cards.
const NODE_SIZE: Record<CorrelationGraphNodeKind, { w: number; h: number }> = {
  center: { w: 230, h: 60 },
  class: { w: 200, h: 60 },
  observable: { w: 170, h: 36 },
};

interface Graph {
  nodes: Array<LayoutNode>;
  edges: Array<LayoutEdge>;
}

function buildGraph(
  classCount: number,
  observableCount: number,
  linksFor: (observableIndex: number) => Array<number>,
): Graph {
  const nodes: Array<LayoutNode> = [{ id: "center", kind: "center" }];
  const edges: Array<LayoutEdge> = [];
  for (let c: number = 0; c < classCount; c++) {
    nodes.push({ id: `class:C${c}`, kind: "class" });
    edges.push({ from: "center", to: `class:C${c}`, count: 5 });
  }
  for (let o: number = 0; o < observableCount; o++) {
    nodes.push({ id: `observable:o${o}`, kind: "observable" });
    for (const c of linksFor(o)) {
      edges.push({
        from: `class:C${c}`,
        to: `observable:o${o}`,
        count: 1 + (o % 3),
      });
    }
  }
  return { nodes, edges };
}

function overlappingPairs(
  graph: Graph,
  positions: Map<string, LayoutPoint>,
): Array<string> {
  const pairs: Array<string> = [];
  for (let i: number = 0; i < graph.nodes.length; i++) {
    const a: LayoutNode = graph.nodes[i]!;
    const pa: LayoutPoint = positions.get(a.id)!;
    for (let j: number = i + 1; j < graph.nodes.length; j++) {
      const b: LayoutNode = graph.nodes[j]!;
      const pb: LayoutPoint = positions.get(b.id)!;
      const overlapX: boolean =
        Math.abs(pa.x - pb.x) < (NODE_SIZE[a.kind].w + NODE_SIZE[b.kind].w) / 2;
      const overlapY: boolean =
        Math.abs(pa.y - pb.y) < (NODE_SIZE[a.kind].h + NODE_SIZE[b.kind].h) / 2;
      if (overlapX && overlapY) {
        pairs.push(`${a.id} ↔ ${b.id}`);
      }
    }
  }
  return pairs;
}

function boundingBox(
  graph: Graph,
  positions: Map<string, LayoutPoint>,
): { width: number; height: number } {
  let minX: number = Infinity;
  let maxX: number = -Infinity;
  let minY: number = Infinity;
  let maxY: number = -Infinity;
  for (const node of graph.nodes) {
    const point: LayoutPoint = positions.get(node.id)!;
    const size: { w: number; h: number } = NODE_SIZE[node.kind];
    minX = Math.min(minX, point.x - size.w / 2);
    maxX = Math.max(maxX, point.x + size.w / 2);
    minY = Math.min(minY, point.y - size.h / 2);
    maxY = Math.max(maxY, point.y + size.h / 2);
  }
  return { width: maxX - minX, height: maxY - minY };
}

function distance(point: LayoutPoint): number {
  return Math.hypot(point.x, point.y);
}

// Angle on the unstretched ellipse (the layout stretches x by 1.6).
function ellipseAngle(point: LayoutPoint): number {
  return Math.atan2(point.y, point.x / 1.6);
}

function angularDistance(a: number, b: number): number {
  const diff: number = Math.abs(a - b) % (Math.PI * 2);
  return diff > Math.PI ? Math.PI * 2 - diff : diff;
}

describe("computeCorrelationLayout", () => {
  test("returns nothing for an empty graph", () => {
    expect(computeCorrelationLayout([], []).size).toBe(0);
  });

  test("places the hub at the origin", () => {
    const positions: Map<string, LayoutPoint> = computeCorrelationLayout(
      [{ id: "center", kind: "center" }],
      [],
    );
    expect(positions.get("center")).toEqual({ x: 0, y: 0 });
  });

  test("positions every node exactly once", () => {
    const graph: Graph = buildGraph(4, 12, (o: number) => {
      return [o % 4];
    });
    const positions: Map<string, LayoutPoint> = computeCorrelationLayout(
      graph.nodes,
      graph.edges,
    );
    expect(positions.size).toBe(graph.nodes.length);
    for (const node of graph.nodes) {
      const point: LayoutPoint | undefined = positions.get(node.id);
      expect(point).toBeDefined();
      expect(Number.isFinite(point!.x)).toBe(true);
      expect(Number.isFinite(point!.y)).toBe(true);
      expect(Number.isInteger(point!.x)).toBe(true);
      expect(Number.isInteger(point!.y)).toBe(true);
    }
  });

  test("a single class sits straight above the hub", () => {
    const graph: Graph = buildGraph(1, 0, () => {
      return [];
    });
    const point: LayoutPoint = computeCorrelationLayout(
      graph.nodes,
      graph.edges,
    ).get("class:C0")!;
    expect(point.x).toBe(0);
    expect(point.y).toBeLessThan(0);
  });

  test("classes share one ring, evenly spaced and clockwise from the top", () => {
    const graph: Graph = buildGraph(4, 0, () => {
      return [];
    });
    const positions: Map<string, LayoutPoint> = computeCorrelationLayout(
      graph.nodes,
      graph.edges,
    );
    const top: LayoutPoint = positions.get("class:C0")!;
    const right: LayoutPoint = positions.get("class:C1")!;
    const bottom: LayoutPoint = positions.get("class:C2")!;
    const left: LayoutPoint = positions.get("class:C3")!;

    expect(top.x).toBe(0);
    expect(top.y).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    expect(right.y).toBe(0);
    expect(bottom.x).toBe(0);
    expect(bottom.y).toBeGreaterThan(0);
    expect(left.x).toBeLessThan(0);
    expect(left.y).toBe(0);

    // Same unstretched radius for every class.
    expect(-top.y).toBe(bottom.y);
    expect(right.x).toBe(-left.x);
    expect(right.x / 1.6).toBeCloseTo(-top.y, 0);
  });

  test("the ellipse is wider than it is tall", () => {
    const graph: Graph = buildGraph(4, 0, () => {
      return [];
    });
    const positions: Map<string, LayoutPoint> = computeCorrelationLayout(
      graph.nodes,
      graph.edges,
    );
    expect(positions.get("class:C1")!.x).toBeGreaterThan(
      -positions.get("class:C0")!.y,
    );
  });

  test("the inner ring grows with the number of classes", () => {
    const small: Graph = buildGraph(3, 0, () => {
      return [];
    });
    const large: Graph = buildGraph(16, 0, () => {
      return [];
    });
    const smallTop: LayoutPoint = computeCorrelationLayout(
      small.nodes,
      small.edges,
    ).get("class:C0")!;
    const largeTop: LayoutPoint = computeCorrelationLayout(
      large.nodes,
      large.edges,
    ).get("class:C0")!;
    expect(-largeTop.y).toBeGreaterThan(-smallTop.y);
  });

  test("observables sit outside the class ring", () => {
    const graph: Graph = buildGraph(5, 14, (o: number) => {
      return [o % 5];
    });
    const positions: Map<string, LayoutPoint> = computeCorrelationLayout(
      graph.nodes,
      graph.edges,
    );
    const classRadius: number = Math.max(
      ...graph.nodes
        .filter((node: LayoutNode) => {
          return node.kind === "class";
        })
        .map((node: LayoutNode) => {
          const point: LayoutPoint = positions.get(node.id)!;
          return Math.hypot(point.x / 1.6, point.y);
        }),
    );
    for (const node of graph.nodes) {
      if (node.kind !== "observable") {
        continue;
      }
      const point: LayoutPoint = positions.get(node.id)!;
      expect(Math.hypot(point.x / 1.6, point.y)).toBeGreaterThan(classRadius);
    }
  });

  test("an observable seen in only one class leans toward that class", () => {
    const graph: Graph = buildGraph(4, 1, () => {
      return [1]; // C1 sits at the right of the ring.
    });
    const positions: Map<string, LayoutPoint> = computeCorrelationLayout(
      graph.nodes,
      graph.edges,
    );
    const observable: LayoutPoint = positions.get("observable:o0")!;
    expect(observable.x).toBeGreaterThan(0);
    expect(observable.y).toBe(0);
  });

  test("an observable shared by two classes sits between them", () => {
    const graph: Graph = buildGraph(4, 1, () => {
      return [0, 1]; // top and right
    });
    const positions: Map<string, LayoutPoint> = computeCorrelationLayout(
      graph.nodes,
      graph.edges,
    );
    const observable: LayoutPoint = positions.get("observable:o0")!;
    expect(observable.x).toBeGreaterThan(0);
    expect(observable.y).toBeLessThan(0);
    expect(
      angularDistance(ellipseAngle(observable), -Math.PI / 4),
    ).toBeLessThan(0.01);
  });

  test("edge counts weight the pull toward a class", () => {
    const nodes: Array<LayoutNode> = [
      { id: "center", kind: "center" },
      { id: "class:A", kind: "class" },
      { id: "class:B", kind: "class" },
      { id: "class:C", kind: "class" },
      { id: "class:D", kind: "class" },
      { id: "observable:x", kind: "observable" },
    ];
    const edges: Array<LayoutEdge> = [
      { from: "center", to: "class:A", count: 1 },
      { from: "center", to: "class:B", count: 1 },
      { from: "class:A", to: "observable:x", count: 1 }, // top
      { from: "class:B", to: "observable:x", count: 9 }, // right
    ];
    const point: LayoutPoint = computeCorrelationLayout(nodes, edges).get(
      "observable:x",
    )!;
    // Pulled much closer to B (angle 0) than to A (angle -π/2).
    const angle: number = ellipseAngle(point);
    expect(angularDistance(angle, 0)).toBeLessThan(
      angularDistance(angle, -Math.PI / 2),
    );
  });

  test("an observable with no class edge defaults to the top", () => {
    const nodes: Array<LayoutNode> = [
      { id: "center", kind: "center" },
      { id: "observable:orphan", kind: "observable" },
    ];
    const point: LayoutPoint = computeCorrelationLayout(nodes, []).get(
      "observable:orphan",
    )!;
    expect(point.x).toBe(0);
    expect(point.y).toBeLessThan(0);
  });

  test("pulls that cancel out fall back to the top instead of NaN", () => {
    const graph: Graph = buildGraph(2, 1, () => {
      return [0, 1]; // top and bottom — equal and opposite
    });
    // Equalize the weights so they cancel exactly.
    const edges: Array<LayoutEdge> = graph.edges.map((edge: LayoutEdge) => {
      return { ...edge, count: 2 };
    });
    const point: LayoutPoint = computeCorrelationLayout(graph.nodes, edges).get(
      "observable:o0",
    )!;
    expect(Number.isFinite(point.x)).toBe(true);
    expect(point.y).toBeLessThan(0);
  });

  test("edges from unknown nodes are ignored", () => {
    const graph: Graph = buildGraph(2, 1, () => {
      return [0];
    });
    const withNoise: Array<LayoutEdge> = [
      ...graph.edges,
      { from: "class:ghost", to: "observable:o0", count: 50 },
      { from: "center", to: "observable:o0", count: 50 },
    ];
    expect(
      computeCorrelationLayout(graph.nodes, withNoise).get("observable:o0"),
    ).toEqual(
      computeCorrelationLayout(graph.nodes, graph.edges).get("observable:o0"),
    );
  });

  test("is deterministic and ignores input order", () => {
    const graph: Graph = buildGraph(6, 24, (o: number) => {
      return [o % 6, (o + 2) % 6];
    });
    const first: Map<string, LayoutPoint> = computeCorrelationLayout(
      graph.nodes,
      graph.edges,
    );
    const second: Map<string, LayoutPoint> = computeCorrelationLayout(
      graph.nodes,
      graph.edges,
    );
    expect(Array.from(second.entries())).toEqual(Array.from(first.entries()));

    // Observable order does not matter (class order sets the ring order).
    const shuffledNodes: Array<LayoutNode> = [
      ...graph.nodes.filter((node: LayoutNode) => {
        return node.kind !== "observable";
      }),
      ...graph.nodes
        .filter((node: LayoutNode) => {
          return node.kind === "observable";
        })
        .reverse(),
    ];
    const shuffled: Map<string, LayoutPoint> = computeCorrelationLayout(
      shuffledNodes,
      [...graph.edges].reverse(),
    );
    for (const node of graph.nodes) {
      expect(shuffled.get(node.id)).toEqual(first.get(node.id));
    }
  });

  test("observables crowding one class spread out instead of stacking", () => {
    const graph: Graph = buildGraph(3, 8, () => {
      return [0];
    });
    const positions: Map<string, LayoutPoint> = computeCorrelationLayout(
      graph.nodes,
      graph.edges,
    );
    const unique: Set<string> = new Set<string>(
      graph.nodes
        .filter((node: LayoutNode) => {
          return node.kind === "observable";
        })
        .map((node: LayoutNode) => {
          const point: LayoutPoint = positions.get(node.id)!;
          return `${point.x},${point.y}`;
        }),
    );
    expect(unique.size).toBe(8);
    expect(overlappingPairs(graph, positions)).toEqual([]);
  });

  test("large correlations alternate observables between two radii", () => {
    const graph: Graph = buildGraph(4, 20, (o: number) => {
      return [o % 4];
    });
    const positions: Map<string, LayoutPoint> = computeCorrelationLayout(
      graph.nodes,
      graph.edges,
    );
    const radii: Set<number> = new Set<number>(
      graph.nodes
        .filter((node: LayoutNode) => {
          return node.kind === "observable";
        })
        .map((node: LayoutNode) => {
          const point: LayoutPoint = positions.get(node.id)!;
          return Math.round(Math.hypot(point.x / 1.6, point.y) / 10);
        }),
    );
    expect(radii.size).toBe(2);
  });

  test("small correlations keep observables on a single radius", () => {
    const graph: Graph = buildGraph(4, 6, (o: number) => {
      return [o % 4];
    });
    const positions: Map<string, LayoutPoint> = computeCorrelationLayout(
      graph.nodes,
      graph.edges,
    );
    const radii: Set<number> = new Set<number>(
      graph.nodes
        .filter((node: LayoutNode) => {
          return node.kind === "observable";
        })
        .map((node: LayoutNode) => {
          const point: LayoutPoint = positions.get(node.id)!;
          return Math.round(Math.hypot(point.x / 1.6, point.y) / 10);
        }),
    );
    expect(radii.size).toBe(1);
  });

  test("options override the defaults", () => {
    const graph: Graph = buildGraph(1, 0, () => {
      return [];
    });
    const point: LayoutPoint = computeCorrelationLayout(
      graph.nodes,
      graph.edges,
      { minClassRadius: 400 },
    ).get("class:C0")!;
    expect(point.y).toBe(-400);
  });

  const shapes: Array<[string, number, number, (o: number) => Array<number>]> =
    [];
  for (const classCount of [1, 2, 3, 6, 8, 12]) {
    for (const observableCount of [0, 1, 3, 9, 10, 20, 30]) {
      shapes.push([
        "one class each",
        classCount,
        observableCount,
        (o: number) => {
          return [o % classCount];
        },
      ]);
      shapes.push([
        "shared between classes",
        classCount,
        observableCount,
        (o: number) => {
          return o % 4 === 0 ? [0] : [o % classCount, (o + 1) % classCount];
        },
      ]);
    }
  }

  test.each(shapes)(
    "no two nodes overlap (%s, %i classes, %i observables)",
    (
      _label: string,
      classCount: number,
      observableCount: number,
      linksFor: (o: number) => Array<number>,
    ) => {
      const graph: Graph = buildGraph(classCount, observableCount, linksFor);
      const positions: Map<string, LayoutPoint> = computeCorrelationLayout(
        graph.nodes,
        graph.edges,
      );
      expect(overlappingPairs(graph, positions)).toEqual([]);
    },
  );

  test("the capped worst case stays compact enough to read when fitted", () => {
    // 30 co-observables (the graph cap) around 12 classes.
    const graph: Graph = buildGraph(12, 30, (o: number) => {
      return [o % 12, (o + 5) % 12];
    });
    const positions: Map<string, LayoutPoint> = computeCorrelationLayout(
      graph.nodes,
      graph.edges,
    );
    const box: { width: number; height: number } = boundingBox(
      graph,
      positions,
    );
    // The old single-row layout was ~30 × 240px wide.
    expect(box.width).toBeLessThan(2400);
    expect(box.height).toBeLessThan(1500);
    expect(overlappingPairs(graph, positions)).toEqual([]);
  });

  test("the hub is the centre of the drawing", () => {
    const graph: Graph = buildGraph(6, 18, (o: number) => {
      return [o % 6];
    });
    const positions: Map<string, LayoutPoint> = computeCorrelationLayout(
      graph.nodes,
      graph.edges,
    );
    const hub: LayoutPoint = positions.get("center")!;
    for (const node of graph.nodes) {
      if (node.kind === "center") {
        continue;
      }
      expect(distance(positions.get(node.id)!)).toBeGreaterThan(distance(hub));
    }
  });
});
