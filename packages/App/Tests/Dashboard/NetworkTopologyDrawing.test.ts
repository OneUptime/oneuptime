import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  TOPOLOGY_DRAWING_STYLE,
  TOPOLOGY_HULL_PADDING,
  TOPOLOGY_VIEW_HEIGHT,
  TOPOLOGY_VIEW_WIDTH,
  TopologyHullView,
  UNLINKED_HULL_CAPTION,
  attentionHaloRadiusFor,
  buildTopologyHulls,
  computeTopologyLayoutModel,
  glyphFillOpacityFor,
  glyphStrokeWidthFor,
  labelFontSizeFor,
  labelLineHeightFor,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyDrawing";
import {
  DEVICE_LABEL_FONT_SIZE,
  DEVICE_LABEL_LINE_HEIGHT,
  ENDPOINT_LABEL_FONT_SIZE,
  ENDPOINT_LABEL_LINE_HEIGHT,
  footprintForNode,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyFootprint";
import fs from "fs";
import path from "path";
import {
  ALL_NODE_KINDS,
  TopologyNodeKind,
  TopologyNodeView,
  TopologyViewModel,
  buildTopologyViewModel,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyViewModel";
import {
  TopologyLayoutModel,
  computeTieredTopologyLayoutModel,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyLayout";
import { computeForceTopologyModel } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/ForceTopologyLayout";
import { computeRadialTopologyModel } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/RadialTopologyLayout";
import { computeStarTopologyModel } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/StarTopologyLayout";
import { computeParentChildTopologyModel } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/ParentChildTopologyLayout";
import { TopologyPoint } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";
import {
  TopologyLayoutMode,
  mergePositionOverrides,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyPositionOverrides";

/*
 * Issue #4616: the map is drawn in two places now — the live canvas and the
 * PDF export — and both read the layout dispatch and the hull derivation
 * from NetworkTopologyDrawing. These tests hold that module to what the
 * canvas did before the code moved, so moving it changed nothing on screen,
 * and pin the behaviour both media now depend on.
 */

function device(
  id: string,
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode {
  return {
    id: id,
    name: id,
    isManaged: true,
    status: "up",
    kind: "device",
    ...overrides,
  };
}

function endpoint(id: string, vlanId?: number): NetworkTopologyNode {
  return {
    id: id,
    name: id,
    isManaged: false,
    status: "up",
    kind: "endpoint",
    vlanId: vlanId,
  };
}

function link(
  from: string,
  to: string,
  overrides?: Partial<NetworkTopologyEdge>,
): NetworkTopologyEdge {
  return { fromNodeId: from, toNodeId: to, protocols: ["lldp"], ...overrides };
}

// Two islands, two devices with no links, and a switch with endpoints.
const NODES: Array<NetworkTopologyNode> = [
  device("core", { role: "router" }),
  device("access-1", { role: "switch" }),
  device("access-2", { role: "switch" }),
  device("branch-router", { role: "router" }),
  device("branch-switch", { role: "switch" }),
  device("spare-1", { role: "switch" }),
  device("spare-2", { role: "router" }),
  endpoint("till-1", 20),
  endpoint("till-2", 20),
];

const EDGES: Array<NetworkTopologyEdge> = [
  link("core", "access-1"),
  link("core", "access-2"),
  link("branch-router", "branch-switch"),
  link("access-1", "till-1", { protocols: ["fdb"] }),
  link("access-1", "till-2", { protocols: ["fdb"] }),
];

const MODES: Array<TopologyLayoutMode> = [
  "force",
  "tiered",
  "radial",
  "star",
  "parentChild",
];

function viewModelFor(
  model: TopologyLayoutModel,
  options?: {
    visibleKinds?: ReadonlySet<TopologyNodeKind>;
    positions?: Map<string, TopologyPoint>;
  },
): TopologyViewModel {
  return buildTopologyViewModel({
    nodes: NODES,
    edges: EDGES,
    positions: options?.positions || model.positions,
    searchText: "",
    visibleKinds: options?.visibleKinds || ALL_NODE_KINDS,
    healthFilterMode: "all",
    focusNodeIds: new Set<string>(),
    selectedNodeId: null,
    selectedEdgeKey: null,
    pinnedNodeIds: new Set<string>(),
  });
}

function hullByKey(
  hulls: Array<TopologyHullView>,
  key: string,
): TopologyHullView | undefined {
  return hulls.find((hull: TopologyHullView): boolean => {
    return hull.key === key;
  });
}

describe("computeTopologyLayoutModel: the layout each mode draws", () => {
  test("every mode computes for the canvas's own 1000 x 700 frame", () => {
    expect(TOPOLOGY_VIEW_WIDTH).toBe(1000);
    expect(TOPOLOGY_VIEW_HEIGHT).toBe(700);
  });

  const expected: Record<
    TopologyLayoutMode,
    (
      nodes: Array<NetworkTopologyNode>,
      edges: Array<NetworkTopologyEdge>,
    ) => TopologyLayoutModel
  > = {
    force: (
      nodes: Array<NetworkTopologyNode>,
      edges: Array<NetworkTopologyEdge>,
    ): TopologyLayoutModel => {
      return computeForceTopologyModel(nodes, edges, 1000, 700);
    },
    tiered: (
      nodes: Array<NetworkTopologyNode>,
      edges: Array<NetworkTopologyEdge>,
    ): TopologyLayoutModel => {
      return computeTieredTopologyLayoutModel(nodes, edges, 1000, 700);
    },
    radial: (
      nodes: Array<NetworkTopologyNode>,
      edges: Array<NetworkTopologyEdge>,
    ): TopologyLayoutModel => {
      return computeRadialTopologyModel(nodes, edges, 1000, 700);
    },
    star: (
      nodes: Array<NetworkTopologyNode>,
      edges: Array<NetworkTopologyEdge>,
    ): TopologyLayoutModel => {
      return computeStarTopologyModel(nodes, edges, 1000, 700);
    },
    parentChild: (
      nodes: Array<NetworkTopologyNode>,
      edges: Array<NetworkTopologyEdge>,
    ): TopologyLayoutModel => {
      return computeParentChildTopologyModel(nodes, edges, 1000, 700);
    },
  };

  for (const mode of MODES) {
    test(`"${mode}" is the ${mode} layout, exactly as the canvas computed it`, () => {
      const model: TopologyLayoutModel = computeTopologyLayoutModel(
        mode,
        NODES,
        EDGES,
      );
      const reference: TopologyLayoutModel = expected[mode](NODES, EDGES);
      expect(Array.from(model.positions.entries())).toEqual(
        Array.from(reference.positions.entries()),
      );
      expect(model.componentBoxes).toEqual(reference.componentBoxes);
      expect(model.groups).toEqual(reference.groups);
      expect(model.contentWidth).toBe(reference.contentWidth);
      expect(model.contentHeight).toBe(reference.contentHeight);
    });

    test(`"${mode}" places every node, and is a pure function of the graph`, () => {
      const first: TopologyLayoutModel = computeTopologyLayoutModel(
        mode,
        NODES,
        EDGES,
      );
      const again: TopologyLayoutModel = computeTopologyLayoutModel(
        mode,
        [...NODES].reverse(),
        [...EDGES].reverse(),
      );
      expect(first.positions.size).toBe(NODES.length);
      for (const node of NODES) {
        const point: TopologyPoint | undefined = first.positions.get(node.id);
        expect(point).toBeDefined();
        expect(Number.isFinite(point!.x)).toBe(true);
        expect(Number.isFinite(point!.y)).toBe(true);
        expect(again.positions.get(node.id)).toEqual(point);
      }
    });
  }

  test("an unknown mode falls back to the force layout, like the canvas did", () => {
    const model: TopologyLayoutModel = computeTopologyLayoutModel(
      "something-else" as TopologyLayoutMode,
      NODES,
      EDGES,
    );
    expect(Array.from(model.positions.entries())).toEqual(
      Array.from(
        computeForceTopologyModel(NODES, EDGES, 1000, 700).positions.entries(),
      ),
    );
  });

  test("an empty graph is an empty layout, not an error", () => {
    for (const mode of MODES) {
      const model: TopologyLayoutModel = computeTopologyLayoutModel(
        mode,
        [],
        [],
      );
      expect(model.positions.size).toBe(0);
    }
  });
});

describe("buildTopologyHulls: the soft hulls behind the graph", () => {
  const force: TopologyLayoutModel = computeTopologyLayoutModel(
    "force",
    NODES,
    EDGES,
  );

  test("the unlinked strip is captioned with how many devices it holds, and dashed", () => {
    const hulls: Array<TopologyHullView> = buildTopologyHulls(
      force,
      viewModelFor(force).nodes,
    );
    const unlinked: Array<TopologyHullView> = hulls.filter(
      (hull: TopologyHullView): boolean => {
        return hull.isUnlinked;
      },
    );
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]!.caption).toBe(`${UNLINKED_HULL_CAPTION} (2)`);
    expect(unlinked[0]!.caption).toBe("Not linked to anything (2)");
    expect(unlinked[0]!.memberCount).toBe(2);
    expect(unlinked[0]!.isDashed).toBe(true);
  });

  test("only the unlinked strip carries a caption", () => {
    const hulls: Array<TopologyHullView> = buildTopologyHulls(
      force,
      viewModelFor(force).nodes,
    );
    for (const hull of hulls) {
      expect(hull.caption === null).toBe(!hull.isUnlinked);
    }
  });

  test("each hull encloses the ink of the nodes in it, with the padding", () => {
    const nodes: Array<TopologyNodeView> = viewModelFor(force).nodes;
    const hulls: Array<TopologyHullView> = buildTopologyHulls(force, nodes);
    const byId: Map<string, TopologyNodeView> = new Map<
      string,
      TopologyNodeView
    >(
      nodes.map((nodeView: TopologyNodeView): [string, TopologyNodeView] => {
        return [nodeView.id, nodeView];
      }),
    );
    for (const box of force.componentBoxes) {
      const hull: TopologyHullView | undefined = hullByKey(
        hulls,
        `component-${box.key}`,
      );
      expect(hull).toBeDefined();
      let minX: number = Infinity;
      let maxX: number = -Infinity;
      let minY: number = Infinity;
      let maxY: number = -Infinity;
      for (const nodeId of box.nodeIds) {
        const nodeView: TopologyNodeView = byId.get(nodeId)!;
        minX = Math.min(minX, nodeView.x - nodeView.footprint.inkHalfWidth);
        maxX = Math.max(maxX, nodeView.x + nodeView.footprint.inkHalfWidth);
        minY = Math.min(minY, nodeView.y - nodeView.footprint.halfHeight);
        maxY = Math.max(maxY, nodeView.y + nodeView.footprint.labelBottom);
      }
      expect(hull!.x).toBeCloseTo(minX - TOPOLOGY_HULL_PADDING, 6);
      expect(hull!.y).toBeCloseTo(minY - TOPOLOGY_HULL_PADDING, 6);
      expect(hull!.width).toBeCloseTo(
        maxX - minX + 2 * TOPOLOGY_HULL_PADDING,
        6,
      );
      expect(hull!.height).toBeCloseTo(
        maxY - minY + 2 * TOPOLOGY_HULL_PADDING,
        6,
      );
      expect(hull!.memberCount).toBe(box.nodeIds.length);
    }
  });

  test("a dragged device takes its hull with it", () => {
    const moved: Map<string, TopologyPoint> = mergePositionOverrides(
      force.positions,
      new Map<string, TopologyPoint>([["spare-1", { x: 5000, y: 4000 }]]),
    );
    const hulls: Array<TopologyHullView> = buildTopologyHulls(
      force,
      viewModelFor(force, { positions: moved }).nodes,
    );
    const unlinked: TopologyHullView = hulls.find(
      (hull: TopologyHullView): boolean => {
        return hull.isUnlinked;
      },
    )!;
    expect(unlinked.x + unlinked.width).toBeGreaterThan(5000);
    expect(unlinked.y + unlinked.height).toBeGreaterThan(4000);
  });

  test("a hull whose members are all filtered away is not drawn at all", () => {
    const tiered: TopologyLayoutModel = computeTopologyLayoutModel(
      "tiered",
      NODES,
      EDGES,
    );
    const withEndpoints: Array<TopologyHullView> = buildTopologyHulls(
      tiered,
      viewModelFor(tiered).nodes,
    );
    expect(hullByKey(withEndpoints, "group-access-1")).toBeDefined();

    const withoutEndpoints: Array<TopologyHullView> = buildTopologyHulls(
      tiered,
      viewModelFor(tiered, {
        visibleKinds: new Set<TopologyNodeKind>(["device", "unmanaged"]),
      }).nodes,
    );
    expect(hullByKey(withoutEndpoints, "group-access-1")).toBeUndefined();
  });

  test("the group of endpoints whose switch is not on the map is dashed and uncaptioned", () => {
    const model: TopologyLayoutModel = computeTopologyLayoutModel(
      "tiered",
      [device("router-1", { role: "router" }), endpoint("orphan-1")],
      [],
    );
    const nodes: Array<TopologyNodeView> = buildTopologyViewModel({
      nodes: [device("router-1", { role: "router" }), endpoint("orphan-1")],
      edges: [],
      positions: model.positions,
      searchText: "",
      visibleKinds: ALL_NODE_KINDS,
      healthFilterMode: "all",
      focusNodeIds: new Set<string>(),
      selectedNodeId: null,
      selectedEdgeKey: null,
      pinnedNodeIds: new Set<string>(),
    }).nodes;
    const hulls: Array<TopologyHullView> = buildTopologyHulls(model, nodes);
    const unattached: TopologyHullView | undefined = hullByKey(
      hulls,
      "group-unattached",
    );
    expect(unattached).toBeDefined();
    expect(unattached!.isDashed).toBe(true);
    expect(unattached!.caption).toBeNull();
    expect(unattached!.isUnlinked).toBe(false);
  });

  test("no drawn nodes means no hulls", () => {
    expect(buildTopologyHulls(force, [])).toEqual([]);
  });
});

describe("TOPOLOGY_DRAWING_STYLE: how the map is painted, in one place", () => {
  test("the values the canvas has always drawn with", () => {
    /*
     * Pinned so a change is a decision: the canvas AND the PDF both paint
     * with these, and changing one restyles both.
     */
    expect(TOPOLOGY_DRAWING_STYLE).toEqual({
      dimmedNodeOpacity: 0.2,
      dimmedEdgeOpacity: 0.15,
      deviceFillOpacity: 0.9,
      endpointFillOpacity: 0.85,
      deviceStrokeWidth: 2,
      endpointStrokeWidth: 1.5,
      hullCornerRadius: 14,
      hullFill: "var(--ou-surface-secondary, #f9fafb)",
      hullFillOpacity: 0.4,
      dashedHullFillOpacity: 0.65,
      hullStroke: "var(--ou-border-subtle, #e5e7eb)",
      hullStrokeWidth: 1,
      hullDash: "5 4",
      hullCaptionOffset: 6,
      hullCaptionFontSize: 12,
      hullCaptionColor: "var(--ou-text-muted, #6b7280)",
      attentionHaloPadding: 5,
      attentionHaloFillOpacity: 0.16,
      attentionHaloStrokeOpacity: 0.55,
      badgeFontSize: 9,
      deviceBadgeColor: "#ffffff",
      labelColor: "var(--ou-text-secondary, #374151)",
      labelHaloColor: "var(--ou-surface-primary, #ffffff)",
      labelHaloWidth: 3,
    });
  });

  test("glyph fills are a little see-through, endpoints more so; unmanaged peers are hollow", () => {
    expect(glyphFillOpacityFor("device")).toBe(0.9);
    expect(glyphFillOpacityFor("endpoint")).toBe(0.85);
    expect(glyphFillOpacityFor("unmanaged")).toBe(1);
  });

  test("endpoints are drawn with a finer outline", () => {
    expect(glyphStrokeWidthFor("endpoint")).toBe(1.5);
    expect(glyphStrokeWidthFor("device")).toBe(2);
    expect(glyphStrokeWidthFor("unmanaged")).toBe(2);
  });

  test("names are set at the sizes the layout reserved room for", () => {
    expect(labelFontSizeFor("device")).toBe(DEVICE_LABEL_FONT_SIZE);
    expect(labelFontSizeFor("unmanaged")).toBe(DEVICE_LABEL_FONT_SIZE);
    expect(labelFontSizeFor("endpoint")).toBe(ENDPOINT_LABEL_FONT_SIZE);
    expect(labelLineHeightFor("device")).toBe(DEVICE_LABEL_LINE_HEIGHT);
    expect(labelLineHeightFor("endpoint")).toBe(ENDPOINT_LABEL_LINE_HEIGHT);
  });

  test("the attention ring clears the glyph by its padding", () => {
    const footprint: ReturnType<typeof footprintForNode> = footprintForNode(
      device("core", { role: "firewall" }),
    );
    expect(attentionHaloRadiusFor(footprint)).toBe(
      Math.max(footprint.halfWidth, footprint.halfHeight) + 5,
    );
  });
});

describe("the canvas and the PDF both paint with the shared style", () => {
  const TOPOLOGY_DIR: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
    "Components",
    "Topology",
  );

  function code(...parts: Array<string>): string {
    return fs
      .readFileSync(path.join(TOPOLOGY_DIR, ...parts), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " ")
      .replace(/\s+/g, " ");
  }

  const graph: string = code("NetworkDeviceGraph.tsx");
  const pdf: string = code("Export", "ExportDiagram.ts");

  test.each([
    ["graph", graph],
    ["PDF", pdf],
  ])(
    "the %s reads every style value from TOPOLOGY_DRAWING_STYLE",
    (_name: string, source: string) => {
      for (const helper of [
        "glyphFillOpacityFor(",
        "glyphStrokeWidthFor(",
        "labelFontSizeFor(",
        "labelLineHeightFor(",
        "attentionHaloRadiusFor(",
        "TOPOLOGY_DRAWING_STYLE",
      ]) {
        expect(source).toContain(helper);
      }
      for (const key of [
        "dimmedNodeOpacity",
        "dimmedEdgeOpacity",
        "hullCornerRadius",
        "hullFill",
        "hullFillOpacity",
        "dashedHullFillOpacity",
        "hullStroke",
        "hullStrokeWidth",
        "hullDash",
        "hullCaptionOffset",
        "hullCaptionFontSize",
        "hullCaptionColor",
        "attentionHaloFillOpacity",
        "attentionHaloStrokeOpacity",
        "badgeFontSize",
        "deviceBadgeColor",
        "labelColor",
        "labelHaloColor",
        "labelHaloWidth",
      ]) {
        expect(source).toMatch(new RegExp(`\\.${key}\\b`));
      }
    },
  );

  test.each([
    ["graph", graph],
    ["PDF", pdf],
  ])(
    "the %s keeps no copy of a style value",
    (_name: string, source: string) => {
      for (const copy of [
        "0.85",
        "0.9 ",
        "0.65",
        "0.16",
        "0.55",
        "0.15",
        "rx={14}",
        "fontSize={9}",
        "fontSize={12}",
        '"5 4"',
        "#f9fafb",
        "#e5e7eb",
        "#374151",
        "--ou-text-muted",
      ]) {
        expect(source).not.toContain(copy);
      }
    },
  );
});
