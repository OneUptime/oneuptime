import { describe, expect, test } from "@jest/globals";
import computeLayeredLayout, {
  LayoutEdge,
  LayoutPoint,
} from "../../FeatureSet/Dashboard/src/Utils/LayeredGraphLayout";

const OPTIONS: { xGap: number; yGap: number } = { xGap: 100, yGap: 100 };

describe("computeLayeredLayout", () => {
  test("empty input yields an empty layout", () => {
    expect(computeLayeredLayout([], [], OPTIONS).size).toBe(0);
  });

  test("a chain lays out on consecutive layers, source at the top", () => {
    const layout: Map<string, LayoutPoint> = computeLayeredLayout(
      ["a", "b", "c"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
      OPTIONS,
    );

    expect(layout.get("a")!.y).toBe(0);
    expect(layout.get("b")!.y).toBe(100);
    expect(layout.get("c")!.y).toBe(200);
  });

  test("longest path wins: a shortcut edge does not pull a node up", () => {
    // a -> b -> c and a -> c: c must sit below b, not beside it.
    const layout: Map<string, LayoutPoint> = computeLayeredLayout(
      ["a", "b", "c"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "a", to: "c" },
      ],
      OPTIONS,
    );

    expect(layout.get("c")!.y).toBeGreaterThan(layout.get("b")!.y);
  });

  test("cycles terminate and still place every node", () => {
    const layout: Map<string, LayoutPoint> = computeLayeredLayout(
      ["a", "b", "c"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
      OPTIONS,
    );

    expect(layout.size).toBe(3);
    for (const id of ["a", "b", "c"]) {
      expect(Number.isFinite(layout.get(id)!.x)).toBe(true);
      expect(Number.isFinite(layout.get(id)!.y)).toBe(true);
    }
  });

  test("a cycle is cut where traffic enters it", () => {
    /*
     * frontend -> api <-> auth, api -> db. The api/auth call-back must not
     * drag the whole cycle (and everything below it) onto one layer: api
     * sits under its caller, auth and db under api.
     */
    const layout: Map<string, LayoutPoint> = computeLayeredLayout(
      ["frontend", "api", "auth", "db"],
      [
        { from: "frontend", to: "api" },
        { from: "api", to: "auth" },
        { from: "auth", to: "api" },
        { from: "api", to: "db" },
      ],
      OPTIONS,
    );

    expect(layout.get("frontend")!.y).toBe(0);
    expect(layout.get("api")!.y).toBe(100);
    expect(layout.get("auth")!.y).toBe(200);
    expect(layout.get("db")!.y).toBe(200);
  });

  test("a cycle nothing points into is cut at its first id", () => {
    const layout: Map<string, LayoutPoint> = computeLayeredLayout(
      ["c", "a", "b"],
      [
        { from: "c", to: "a" },
        { from: "b", to: "c" },
        { from: "a", to: "b" },
      ],
      OPTIONS,
    );

    expect(layout.get("a")!.y).toBe(0);
    expect(layout.get("b")!.y).toBe(100);
    expect(layout.get("c")!.y).toBe(200);
  });

  test("cyclic graphs are deterministic regardless of input order", () => {
    const nodes: Array<string> = ["web", "api", "auth", "cache", "db", "queue"];
    const edges: Array<LayoutEdge> = [
      { from: "web", to: "api" },
      { from: "api", to: "auth" },
      { from: "auth", to: "api" },
      { from: "api", to: "cache" },
      { from: "cache", to: "db" },
      { from: "db", to: "cache" },
      { from: "api", to: "queue" },
      { from: "queue", to: "web" },
    ];
    const forward: Map<string, LayoutPoint> = computeLayeredLayout(
      nodes,
      edges,
      OPTIONS,
    );
    const shuffled: Map<string, LayoutPoint> = computeLayeredLayout(
      [...nodes].reverse(),
      [...edges].reverse(),
      OPTIONS,
    );

    expect(forward.size).toBe(nodes.length);
    for (const id of nodes) {
      expect(shuffled.get(id)).toEqual(forward.get(id));
    }
  });

  test("nodes on one layer never overlap", () => {
    const edges: Array<LayoutEdge> = [
      { from: "root", to: "s1" },
      { from: "root", to: "s2" },
      { from: "root", to: "s3" },
    ];
    const layout: Map<string, LayoutPoint> = computeLayeredLayout(
      ["root", "s1", "s2", "s3"],
      edges,
      OPTIONS,
    );

    const seen: Set<string> = new Set<string>();
    for (const [, point] of layout) {
      const key: string = `${point.x}|${point.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test("deterministic regardless of input order", () => {
    const edges: Array<LayoutEdge> = [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "c", to: "d" },
    ];
    const forward: Map<string, LayoutPoint> = computeLayeredLayout(
      ["a", "b", "c", "d"],
      edges,
      OPTIONS,
    );
    const shuffled: Map<string, LayoutPoint> = computeLayeredLayout(
      ["d", "b", "c", "a"],
      [...edges].reverse(),
      OPTIONS,
    );

    for (const id of ["a", "b", "c", "d"]) {
      expect(shuffled.get(id)).toEqual(forward.get(id));
    }
  });

  test("barycenter ordering keeps a child under its parent", () => {
    /*
     * Two independent parent/child pairs: p1->c1, p2->c2. Whatever order
     * the parents land in, each child's x must match its own parent's x
     * (no crossing).
     */
    const layout: Map<string, LayoutPoint> = computeLayeredLayout(
      ["p1", "p2", "c1", "c2"],
      [
        { from: "p1", to: "c1" },
        { from: "p2", to: "c2" },
      ],
      OPTIONS,
    );

    expect(layout.get("c1")!.x).toBe(layout.get("p1")!.x);
    expect(layout.get("c2")!.x).toBe(layout.get("p2")!.x);
  });

  test("self-loops and edges to unknown nodes are ignored", () => {
    const layout: Map<string, LayoutPoint> = computeLayeredLayout(
      ["a", "b"],
      [
        { from: "a", to: "a" },
        { from: "a", to: "ghost" },
        { from: "a", to: "b" },
      ],
      OPTIONS,
    );

    expect(layout.size).toBe(2);
    expect(layout.get("b")!.y).toBe(100);
  });
});

describe("computeLayeredLayout — a large graph returns promptly", () => {
  /*
   * Layering used to relax every edge up to once per node, and any cycle
   * (an A <-> B call pair is enough) kept it relaxing until that cap, so a
   * big cyclic map took seconds. Adjacency was also rebuilt by copying per
   * edge, quadratic in a hub's degree. Both graphs below took 1.5-4s that
   * way and take well under 200ms now, so a one-second bound leaves a slow
   * CI box plenty of room while still catching the old behaviour.
   * process.hrtime keeps the measurement monotonic.
   */
  const elapsedMsOf: (run: () => void) => number = (
    run: () => void,
  ): number => {
    const start: bigint = process.hrtime.bigint();
    run();
    return Number(process.hrtime.bigint() - start) / 1000000;
  };

  const serviceId: (index: number) => string = (index: number): string => {
    return `service-${String(index).padStart(5, "0")}`;
  };

  test("5,000 services with 15,000 cyclic calls lay out in under a second", () => {
    /*
     * Every service calls two others and is called back by the first, so
     * the graph is riddled with A <-> B pairs and longer cycles.
     */
    const count: number = 5000;
    const nodes: Array<string> = [];
    const edges: Array<LayoutEdge> = [];
    for (let index: number = 0; index < count; index++) {
      nodes.push(serviceId(index));
    }
    for (let index: number = 0; index < count; index++) {
      const partner: string = serviceId((index * 7 + 1) % count);
      edges.push({ from: serviceId(index), to: partner });
      edges.push({ from: partner, to: serviceId(index) });
      edges.push({
        from: serviceId(index),
        to: serviceId((index * 13 + 5) % count),
      });
    }

    let layout: Map<string, LayoutPoint> = new Map<string, LayoutPoint>();
    const elapsedMs: number = elapsedMsOf(() => {
      layout = computeLayeredLayout(nodes, edges, OPTIONS);
    });

    expect(elapsedMs).toBeLessThan(1000);
    expect(layout.size).toBe(count);
    // Every node placed, finitely, and no two on the same spot.
    const seen: Set<string> = new Set<string>();
    for (const [, point] of layout) {
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
        seen.add(`${point.x}|${point.y}`);
      }
    }
    expect(seen.size).toBe(count);
  }, 60000);

  test("20,000 callers of one database lay out in under a second", () => {
    const count: number = 20000;
    const nodes: Array<string> = ["database"];
    const edges: Array<LayoutEdge> = [];
    for (let index: number = 0; index < count; index++) {
      nodes.push(serviceId(index));
      edges.push({ from: serviceId(index), to: "database" });
    }

    let layout: Map<string, LayoutPoint> = new Map<string, LayoutPoint>();
    const elapsedMs: number = elapsedMsOf(() => {
      layout = computeLayeredLayout(nodes, edges, OPTIONS);
    });

    expect(elapsedMs).toBeLessThan(1000);
    expect(layout.size).toBe(count + 1);
    expect(layout.get("database")!.y).toBe(100);
    // Every caller on the top layer, side by side.
    const topLayerXs: Set<number> = new Set<number>();
    for (let index: number = 0; index < count; index++) {
      const point: LayoutPoint = layout.get(serviceId(index))!;
      if (point.y === 0) {
        topLayerXs.add(point.x);
      }
    }
    expect(topLayerXs.size).toBe(count);
  }, 60000);
});
