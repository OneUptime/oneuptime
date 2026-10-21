import { describe, expect, test } from "@jest/globals";
import {
  ResourceTopologyGraph,
  ResourceTopologyNodeInput,
  buildResourceTopologyGraph,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import {
  ResourceTopologyVisible,
  computeResourceTopologyView,
  createResourceTopologyViewState,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyView";
import {
  GROUP_SIDE_GAP,
  LANE_GAP,
  RELATION_LABEL_AT,
  RESOURCE_TOPOLOGY_SIZES,
  ResourceTopologyCaption,
  ResourceTopologyLayout,
  ResourceTopologyPlaced,
  getRelationCurve,
  getRelationSides,
  layoutResourceTopology,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyLayout";

/*
 * Where a resource topology's parts go: nested boxes that hold what is
 * inside them, groups side by side when they are small, a drawing shaped
 * like the canvas, a host's callers and calls in lanes either side of it,
 * and lines that leave and enter by the sides that face each other.
 */

function part(
  id: string,
  parentId: string | null,
  overrides: Partial<ResourceTopologyNodeInput> = {},
): ResourceTopologyNodeInput {
  return {
    id: id,
    parentId: parentId,
    kind: overrides.kind || "vmware.vm",
    name: overrides.name || id,
    health: overrides.health || "healthy",
    ...overrides,
  };
}

const FACTS: Partial<ResourceTopologyNodeInput> = {
  facts: [{ label: "Ready", value: "3/3" }],
};

/* A cluster of namespaces, each with a few workloads of different kinds. */
function clusterEstate(namespaces: number): ResourceTopologyGraph {
  const nodes: Array<ResourceTopologyNodeInput> = [
    part("cluster", null, { kind: "k8s.cluster" }),
  ];

  for (let index: number = 0; index < namespaces; index++) {
    const ns: string = `ns-${index}`;
    nodes.push(part(ns, "cluster", { kind: "k8s.namespace" }));
    nodes.push(part(`${ns}-deploy`, ns, { kind: "k8s.deployment", ...FACTS }));
    nodes.push(part(`${ns}-sts`, ns, { kind: "k8s.statefulset", ...FACTS }));
    nodes.push(part(`${ns}-cron`, ns, { kind: "k8s.cronjob", ...FACTS }));
  }

  return buildResourceTopologyGraph({ rootId: "cluster", nodes: nodes });
}

function laid(
  graph: ResourceTopologyGraph,
  aspect: number = 1.8,
): { visible: ResourceTopologyVisible; layout: ResourceTopologyLayout } {
  const visible: ResourceTopologyVisible = computeResourceTopologyView(
    graph,
    createResourceTopologyViewState(),
  );

  return {
    visible: visible,
    layout: layoutResourceTopology(visible, { aspect: aspect }),
  };
}

function inside(
  inner: ResourceTopologyPlaced,
  outer: ResourceTopologyPlaced,
): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function overlaps(
  a: ResourceTopologyPlaced,
  b: ResourceTopologyPlaced,
): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

describe("every part has one place, inside what holds it", () => {
  const graph: ResourceTopologyGraph = clusterEstate(4);
  const { visible, layout } = laid(graph);

  test("each part drawn is placed exactly once", () => {
    const ids: Array<string> = layout.placed
      .filter((placed: ResourceTopologyPlaced): boolean => {
        return placed.kind !== "more";
      })
      .map((placed: ResourceTopologyPlaced): string => {
        return placed.id;
      });

    expect(new Set<string>(ids).size).toBe(ids.length);
    expect(new Set<string>(ids)).toEqual(visible.visibleNodeIds);
  });

  test("a part sits inside the box of the part that holds it", () => {
    for (const placed of layout.placed) {
      const parentId: string | null =
        graph.nodes.get(placed.id)?.parentId || null;

      if (!parentId) {
        continue;
      }

      expect(inside(placed, layout.byId.get(parentId)!)).toBe(true);
    }
  });

  test("parts of the same box never overlap", () => {
    const siblings: Map<string, Array<ResourceTopologyPlaced>> = new Map();

    for (const placed of layout.placed) {
      const parentId: string = graph.nodes.get(placed.id)?.parentId || "";
      siblings.set(parentId, [...(siblings.get(parentId) || []), placed]);
    }

    for (const group of siblings.values()) {
      group.forEach((a: ResourceTopologyPlaced, index: number) => {
        for (const b of group.slice(index + 1)) {
          expect(overlaps(a, b)).toBe(false);
        }
      });
    }
  });

  test("the drawing's size is the top box's", () => {
    const top: ResourceTopologyPlaced = layout.byId.get("cluster")!;

    expect(top.kind).toBe("container");
    expect(layout.width).toBe(top.width);
    expect(layout.height).toBe(top.height);
  });
});

describe("groups inside a box", () => {
  test("small groups sit side by side rather than one above the other", () => {
    const { layout } = laid(clusterEstate(1));
    const captions: Array<ResourceTopologyCaption> =
      layout.byId.get("ns-0")!.captions!;

    expect(captions).toHaveLength(3);
    // At least two of the namespace's three one-workload groups share a row.
    const rows: Set<number> = new Set<number>(
      captions.map((caption: ResourceTopologyCaption): number => {
        return caption.y;
      }),
    );

    expect(rows.size).toBeLessThan(3);
    const sameRow: Array<ResourceTopologyCaption> = captions.filter(
      (caption: ResourceTopologyCaption): boolean => {
        return caption.y === captions[0]!.y;
      },
    );

    expect(sameRow.length).toBeGreaterThan(1);
    expect(sameRow[1]!.x - (sameRow[0]!.x + sameRow[0]!.width)).toBe(
      GROUP_SIDE_GAP,
    );
  });

  test("a group alone on its row is headed across the whole box", () => {
    const nodes: Array<ResourceTopologyNodeInput> = [
      part("host", null, { kind: "vmware.host" }),
    ];

    for (let index: number = 0; index < 30; index++) {
      nodes.push(part(`vm-${index}`, "host"));
    }

    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "host",
      nodes: nodes,
    });
    const { layout } = laid(graph);
    const box: ResourceTopologyPlaced = layout.byId.get("host")!;
    const caption: ResourceTopologyCaption = box.captions![0]!;

    expect(caption.width).toBe(box.width - 2 * RESOURCE_TOPOLOGY_SIZES.padding);
  });

  test("an open part is a box, a closed one a card, parts holding nothing chips", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [
        part("root", null, { kind: "vmware.vcenter" }),
        part("host", "root", { kind: "vmware.host" }),
        ...Array.from({ length: 5 }, (_value: unknown, index: number) => {
          return part(`vm-${index}`, "host");
        }),
      ],
    });
    const open: ResourceTopologyLayout = laid(graph).layout;
    const closed: ResourceTopologyLayout = layoutResourceTopology(
      computeResourceTopologyView(graph, createResourceTopologyViewState(), {
        maxAutomaticDepth: 1,
      }),
      { aspect: 1.8 },
    );

    expect(open.byId.get("host")!.kind).toBe("container");
    expect(open.byId.get("vm-0")!.kind).toBe("chip");
    expect(open.byId.get("vm-0")!.width).toBe(
      RESOURCE_TOPOLOGY_SIZES.chipWidth,
    );
    expect(closed.byId.get("host")!.kind).toBe("card");
    expect(closed.byId.get("host")!.width).toBe(
      RESOURCE_TOPOLOGY_SIZES.cardWidth,
    );
    expect(closed.byId.has("vm-0")).toBe(false);
  });
});

describe("the drawing takes the canvas's shape", () => {
  test("a wide canvas gets a wider drawing than a tall one", () => {
    const graph: ResourceTopologyGraph = clusterEstate(8);
    const wide: ResourceTopologyLayout = laid(graph, 3).layout;
    const tall: ResourceTopologyLayout = laid(graph, 0.75).layout;

    expect(wide.width / wide.height).toBeGreaterThan(tall.width / tall.height);
  });

  test("the top box comes closer to the canvas's shape than one column or one row", () => {
    const graph: ResourceTopologyGraph = clusterEstate(8);
    const { layout } = laid(graph, 1.5);
    const ratio: number = layout.width / layout.height;

    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(3);
  });
});

describe("a host's callers and calls go in lanes beside it", () => {
  function hostEstate(): ResourceTopologyGraph {
    return buildResourceTopologyGraph({
      rootId: "host",
      nodes: [
        part("host", null, { kind: "entity:Host" }),
        part("container", "host", { kind: "container.container" }),
        part("svc", "container", { kind: "entity:Service", ...FACTS }),
        part("callers", "host", {
          kind: "section",
          isSection: true,
          name: "Called by",
        }),
        part("mobile", "callers", { kind: "entity:Service" }),
        part("calls", "host", {
          kind: "section",
          isSection: true,
          name: "Talks to",
        }),
        part("db", "calls", { kind: "entity:Service", ...FACTS }),
      ],
      relations: [
        {
          from: "mobile",
          to: "svc",
          label: "Calls",
          inverseLabel: "Called by",
        },
        { from: "svc", to: "db", label: "Calls", inverseLabel: "Called by" },
      ],
    });
  }

  test("callers on the left, the host in the middle, its calls on the right", () => {
    const visible: ResourceTopologyVisible = computeResourceTopologyView(
      hostEstate(),
      createResourceTopologyViewState(),
    );
    const layout: ResourceTopologyLayout = layoutResourceTopology(visible, {
      aspect: 1.8,
      lanes: { left: ["callers"], right: ["calls"] },
    });
    const host: ResourceTopologyPlaced = layout.byId.get("host")!;
    const callers: ResourceTopologyPlaced = layout.byId.get("callers")!;
    const calls: ResourceTopologyPlaced = layout.byId.get("calls")!;

    expect(callers.x + callers.width + LANE_GAP).toBe(host.x);
    expect(host.x + host.width + LANE_GAP).toBe(calls.x);
    // Beside the host, not inside it.
    expect(overlaps(callers, host)).toBe(false);
    expect(overlaps(calls, host)).toBe(false);
    expect(inside(layout.byId.get("mobile")!, callers)).toBe(true);
    expect(inside(layout.byId.get("db")!, calls)).toBe(true);
    expect(layout.width).toBe(calls.x + calls.width);
    // The host's own groups no longer include the sections.
    expect(
      (host.captions || []).map((caption: ResourceTopologyCaption): string => {
        return caption.group.kind;
      }),
    ).toEqual(["container.container"]);
  });

  test("without lanes the sections stay inside the host", () => {
    const visible: ResourceTopologyVisible = computeResourceTopologyView(
      hostEstate(),
      createResourceTopologyViewState(),
    );
    const layout: ResourceTopologyLayout = layoutResourceTopology(visible, {
      aspect: 1.8,
    });

    expect(inside(layout.byId.get("calls")!, layout.byId.get("host")!)).toBe(
      true,
    );
  });

  test("a host that only calls out is still a box, with its lane beside it", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "host",
      nodes: [
        part("host", null, { kind: "entity:Host" }),
        part("calls", "host", {
          kind: "section",
          isSection: true,
          name: "Talks to",
        }),
        part("db", "calls", { kind: "entity:Service", ...FACTS }),
      ],
    });
    const layout: ResourceTopologyLayout = layoutResourceTopology(
      computeResourceTopologyView(graph, createResourceTopologyViewState()),
      { aspect: 1.8, lanes: { left: [], right: ["calls"] } },
    );

    expect(layout.byId.get("host")!.kind).toBe("container");
    expect(layout.byId.get("calls")!.x).toBeGreaterThan(
      layout.byId.get("host")!.x,
    );
  });
});

describe("a focused part's related parts", () => {
  test("go in a column right of the drawing, under a heading, from the focused part down", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "cluster",
      nodes: [
        part("cluster", null, { kind: "k8s.cluster" }),
        part("ns", "cluster", { kind: "k8s.namespace" }),
        part("deploy", "ns", { kind: "k8s.deployment", ...FACTS }),
        part("pod", "deploy", { kind: "k8s.pod" }),
        part("nodes", "cluster", {
          kind: "section",
          isSection: true,
          name: "Nodes",
        }),
        part("node-a", "nodes", { kind: "k8s.node" }),
        part("node-b", "nodes", { kind: "k8s.node" }),
      ],
      relations: [
        {
          from: "deploy",
          to: "node-a",
          label: "Runs on",
          inverseLabel: "Runs",
        },
        {
          from: "deploy",
          to: "node-b",
          label: "Runs on",
          inverseLabel: "Runs",
        },
      ],
    });
    const visible: ResourceTopologyVisible = computeResourceTopologyView(
      graph,
      createResourceTopologyViewState({ focusId: "deploy" }),
    );
    const layout: ResourceTopologyLayout = layoutResourceTopology(visible, {
      aspect: 1.8,
    });
    const related: Array<ResourceTopologyPlaced> = layout.placed.filter(
      (placed: ResourceTopologyPlaced): boolean => {
        return placed.kind === "related";
      },
    );
    const top: ResourceTopologyPlaced = layout.byId.get("cluster")!;
    const caption: ResourceTopologyPlaced = layout.byId.get(
      "related-caption:Runs on",
    )!;

    // "Runs on · 2" level with the focused part, its parts under it.
    expect(caption.kind).toBe("relatedCaption");
    expect(caption.relatedCaption).toEqual({ label: "Runs on", count: 2 });
    expect(caption.x).toBe(top.width + RESOURCE_TOPOLOGY_SIZES.relatedGap);
    expect(caption.y).toBe(layout.byId.get("deploy")!.y);
    expect(related).toHaveLength(2);
    expect(related[0]!.x).toBe(caption.x);
    expect(related[0]!.y).toBe(
      caption.y + RESOURCE_TOPOLOGY_SIZES.captionHeight,
    );
    expect(related[1]!.y).toBeGreaterThan(related[0]!.y);
    expect(layout.width).toBe(related[0]!.x + related[0]!.width);
  });

  test("ten related parts stay a short column: small cards, one heading per relation", () => {
    // A node that ten pods run on, and a namespace it serves.
    const pods: Array<string> = Array.from(
      { length: 10 },
      (_value: unknown, index: number): string => {
        return `pod-${index}`;
      },
    );
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "cluster",
      nodes: [
        part("cluster", null, { kind: "k8s.cluster" }),
        part("node-a", "cluster", { kind: "k8s.node" }),
        part("ns", "cluster", { kind: "k8s.namespace" }),
        ...pods.map((pod: string) => {
          return part(pod, "ns", { kind: "k8s.pod", ...FACTS });
        }),
      ],
      relations: [
        ...pods.map((pod: string) => {
          return {
            from: pod,
            to: "node-a",
            label: "Runs on",
            inverseLabel: "Runs here",
          };
        }),
        {
          from: "node-a",
          to: "ns",
          label: "Serves",
          inverseLabel: "Served by",
        },
      ],
    });
    const layout: ResourceTopologyLayout = layoutResourceTopology(
      computeResourceTopologyView(
        graph,
        createResourceTopologyViewState({ focusId: "node-a" }),
      ),
      { aspect: 1.8 },
    );
    const related: Array<ResourceTopologyPlaced> = layout.placed.filter(
      (placed: ResourceTopologyPlaced): boolean => {
        return placed.kind === "related";
      },
    );
    const captions: Array<ResourceTopologyPlaced> = layout.placed.filter(
      (placed: ResourceTopologyPlaced): boolean => {
        return placed.kind === "relatedCaption";
      },
    );

    expect(related).toHaveLength(11);
    // Each relation says itself once, over its parts, in the order they come.
    expect(
      captions.map((caption: ResourceTopologyPlaced) => {
        return caption.relatedCaption;
      }),
    ).toEqual([
      { label: "Runs here", count: 10 },
      { label: "Serves", count: 1 },
    ]);
    // Small cards, each as wide and as tall as the column draws them.
    for (const item of related) {
      expect(item.height).toBe(RESOURCE_TOPOLOGY_SIZES.relatedHeight);
      expect(item.width).toBe(RESOURCE_TOPOLOGY_SIZES.relatedWidth);
    }

    expect(RESOURCE_TOPOLOGY_SIZES.relatedHeight).toBeLessThan(
      RESOURCE_TOPOLOGY_SIZES.cardHeight,
    );
    const columnTop: number = captions[0]!.y;
    const columnBottom: number =
      related[related.length - 1]!.y + related[related.length - 1]!.height;

    // Under two thirds of the column eleven full cards made.
    expect(columnBottom - columnTop).toBeLessThan(
      ((11 * RESOURCE_TOPOLOGY_SIZES.cardHeight +
        10 * RESOURCE_TOPOLOGY_SIZES.itemGap) *
        2) /
        3,
    );
    // The second heading sits under the first group, not on it.
    expect(captions[1]!.y).toBeGreaterThanOrEqual(
      related[9]!.y + related[9]!.height,
    );
  });
});

describe("lines between parts", () => {
  const box: (x: number, y: number) => ResourceTopologyPlaced = (
    x: number,
    y: number,
  ): ResourceTopologyPlaced => {
    return {
      id: `${x},${y}`,
      kind: "card",
      x,
      y,
      width: 200,
      height: 100,
      depth: 1,
    };
  };

  test("side by side, a line leaves by the right and enters by the left", () => {
    expect(getRelationSides(box(0, 0), box(400, 40))).toEqual({
      source: "right",
      target: "left",
    });
    expect(getRelationSides(box(400, 40), box(0, 0))).toEqual({
      source: "left",
      target: "right",
    });
  });

  test("one above the other, it leaves by the bottom or the top", () => {
    expect(getRelationSides(box(0, 0), box(20, 300))).toEqual({
      source: "bottom",
      target: "top",
    });
    expect(getRelationSides(box(20, 300), box(0, 0))).toEqual({
      source: "top",
      target: "bottom",
    });
  });

  test("the curve runs from one end to the other, React Flow's way", () => {
    const curve: { path: string; labelX: number; labelY: number } =
      getRelationCurve(
        { x: 0, y: 0, side: "right" },
        { x: 200, y: 100, side: "left" },
        0.5,
      );

    // React Flow's bezier: control points half the distance out, sideways.
    expect(curve.path).toBe("M0,0 C100,0 100,100 200,100");
    expect(curve.labelX).toBeCloseTo(100);
    expect(curve.labelY).toBeCloseTo(50);
  });

  test("the label sits nearer the part a line points at", () => {
    const curve: { path: string; labelX: number; labelY: number } =
      getRelationCurve(
        { x: 0, y: 300, side: "top" },
        { x: 0, y: 0, side: "bottom" },
      );

    expect(RELATION_LABEL_AT).toBeGreaterThan(0.5);
    // Upward from 300 to 0: past the middle, closer to 0.
    expect(curve.labelY).toBeLessThan(150);
    expect(curve.labelY).toBeGreaterThan(0);
    expect(curve.labelX).toBeCloseTo(0);
  });

  test("a line back to the left curves out and in rather than through", () => {
    const curve: { path: string; labelX: number; labelY: number } =
      getRelationCurve(
        { x: 300, y: 0, side: "right" },
        { x: 0, y: 0, side: "left" },
        0.5,
      );

    // Backwards: the control points still stand out from each side.
    expect(curve.path.startsWith("M300,0 C")).toBe(true);
    expect(curve.labelY).toBeCloseTo(0);
  });
});
