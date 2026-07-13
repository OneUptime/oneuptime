import { describe, expect, test } from "@jest/globals";
import computeNestedLayout, {
  NestedLayoutBox,
  NestedLayoutOptions,
} from "../../FeatureSet/Dashboard/src/Utils/NestedGraphLayout";

const OPTIONS: NestedLayoutOptions = {
  leafWidth: 100,
  leafHeight: 50,
  padding: 10,
  headerHeight: 20,
  gapX: 10,
  gapY: 10,
  rootGapX: 40,
  rootGapY: 40,
  maxRowWidth: 1000,
};

function overlaps(a: NestedLayoutBox, b: NestedLayoutBox): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

describe("computeNestedLayout", () => {
  test("empty input yields an empty layout", () => {
    expect(computeNestedLayout([], new Map(), OPTIONS).size).toBe(0);
  });

  test("a lone node is a root leaf of leaf size", () => {
    const layout: Map<string, NestedLayoutBox> = computeNestedLayout(
      ["a"],
      new Map(),
      OPTIONS,
    );
    expect(layout.get("a")).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      parentId: null,
    });
  });

  test("a parent is sized to contain its children plus padding and header", () => {
    const layout: Map<string, NestedLayoutBox> = computeNestedLayout(
      ["cluster", "pod1", "pod2"],
      new Map([
        ["pod1", "cluster"],
        ["pod2", "cluster"],
      ]),
      OPTIONS,
    );

    const cluster: NestedLayoutBox = layout.get("cluster")!;
    const pod1: NestedLayoutBox = layout.get("pod1")!;
    const pod2: NestedLayoutBox = layout.get("pod2")!;

    expect(pod1.parentId).toBe("cluster");
    expect(pod2.parentId).toBe("cluster");

    // Children fit inside the parent (child coords are parent-relative).
    for (const child of [pod1, pod2]) {
      expect(child.x).toBeGreaterThanOrEqual(OPTIONS.padding);
      expect(child.y).toBeGreaterThanOrEqual(
        OPTIONS.padding + OPTIONS.headerHeight,
      );
      expect(child.x + child.width).toBeLessThanOrEqual(
        cluster.width - OPTIONS.padding + 0.001,
      );
      expect(child.y + child.height).toBeLessThanOrEqual(
        cluster.height - OPTIONS.padding + 0.001,
      );
    }
  });

  test("siblings never overlap", () => {
    const parentOf: Map<string, string> = new Map<string, string>();
    const ids: Array<string> = ["parent"];
    for (let i: number = 0; i < 9; i++) {
      ids.push(`child${i}`);
      parentOf.set(`child${i}`, "parent");
    }
    const layout: Map<string, NestedLayoutBox> = computeNestedLayout(
      ids,
      parentOf,
      OPTIONS,
    );
    for (let i: number = 0; i < 9; i++) {
      for (let j: number = i + 1; j < 9; j++) {
        expect(
          overlaps(layout.get(`child${i}`)!, layout.get(`child${j}`)!),
        ).toBe(false);
      }
    }
  });

  test("multi-level nesting sizes grandparents to fit sized parents", () => {
    const layout: Map<string, NestedLayoutBox> = computeNestedLayout(
      ["cluster", "node", "pod"],
      new Map([
        ["node", "cluster"],
        ["pod", "node"],
      ]),
      OPTIONS,
    );
    const cluster: NestedLayoutBox = layout.get("cluster")!;
    const node: NestedLayoutBox = layout.get("node")!;
    const pod: NestedLayoutBox = layout.get("pod")!;

    expect(pod.parentId).toBe("node");
    expect(node.parentId).toBe("cluster");
    expect(cluster.parentId).toBeNull();

    // Each level adds padding + header around the level below.
    expect(node.width).toBe(100 + 2 * OPTIONS.padding);
    expect(node.height).toBe(50 + 2 * OPTIONS.padding + OPTIONS.headerHeight);
    expect(cluster.width).toBe(node.width + 2 * OPTIONS.padding);
    expect(cluster.height).toBe(
      node.height + 2 * OPTIONS.padding + OPTIONS.headerHeight,
    );
  });

  test("cycles are cut and every node still placed exactly once", () => {
    const layout: Map<string, NestedLayoutBox> = computeNestedLayout(
      ["a", "b", "c"],
      new Map([
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ]),
      OPTIONS,
    );
    expect(layout.size).toBe(3);
    // At least one link was cut, so at least one node is a root.
    const roots: number = Array.from(layout.values()).filter(
      (box: NestedLayoutBox) => {
        return box.parentId === null;
      },
    ).length;
    expect(roots).toBeGreaterThanOrEqual(1);
  });

  test("unknown and self parents are treated as roots", () => {
    const layout: Map<string, NestedLayoutBox> = computeNestedLayout(
      ["a", "b"],
      new Map([
        ["a", "ghost"],
        ["b", "b"],
      ]),
      OPTIONS,
    );
    expect(layout.get("a")!.parentId).toBeNull();
    expect(layout.get("b")!.parentId).toBeNull();
  });

  test("roots never overlap on the canvas", () => {
    const parentOf: Map<string, string> = new Map<string, string>([
      ["podA", "clusterA"],
      ["podB", "clusterB"],
    ]);
    const layout: Map<string, NestedLayoutBox> = computeNestedLayout(
      ["clusterA", "clusterB", "podA", "podB", "lonely"],
      parentOf,
      OPTIONS,
    );
    const roots: Array<NestedLayoutBox> = [
      "clusterA",
      "clusterB",
      "lonely",
    ].map((id: string) => {
      return layout.get(id)!;
    });
    for (let i: number = 0; i < roots.length; i++) {
      for (let j: number = i + 1; j < roots.length; j++) {
        expect(overlaps(roots[i]!, roots[j]!)).toBe(false);
      }
    }
  });

  test("deterministic regardless of input order", () => {
    const parentOf: Map<string, string> = new Map<string, string>([
      ["p1", "c"],
      ["p2", "c"],
    ]);
    const forward: Map<string, NestedLayoutBox> = computeNestedLayout(
      ["c", "p1", "p2", "x"],
      parentOf,
      OPTIONS,
    );
    const shuffled: Map<string, NestedLayoutBox> = computeNestedLayout(
      ["x", "p2", "c", "p1"],
      parentOf,
      OPTIONS,
    );
    for (const id of ["c", "p1", "p2", "x"]) {
      expect(shuffled.get(id)).toEqual(forward.get(id));
    }
  });
});
