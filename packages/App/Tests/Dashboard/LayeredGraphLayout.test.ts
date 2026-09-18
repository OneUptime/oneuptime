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
