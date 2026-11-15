import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { TopologyPoint } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";
import {
  ALL_NODE_KINDS,
  TopologyNodeView,
  TopologyViewModel,
  buildTopologyViewModel,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyViewModel";
import {
  IDENTITY_VIEW,
  MAX_ZOOM,
  MIN_ZOOM,
  ViewBoxSize,
  ViewTransform,
  WorldBounds,
  fitViewToBounds,
  fitViewToBoundsWithin,
  viewCenteredOn,
  viewKeepingPointFixed,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyViewport";

/*
 * ISSUE #6606: SEARCH FINDS A DEVICE, AND SHOWS WHERE IT HANGS.
 *
 * Search used to dim everything that did not match and leave the camera
 * where it was: on a large map the one bright device could be off screen,
 * or a dot too small to see. Now the map moves to what the search found,
 * steps through the matches in reading order and rings the one it is on;
 * and in the parent-child layout the path from the top of the tree down to
 * each match stays bright, so the reader sees where it sits.
 */

const VIEW_BOX: ViewBoxSize = { width: 1000, height: 700 };

const node: (id: string, name?: string) => NetworkTopologyNode = (
  id: string,
  name?: string,
): NetworkTopologyNode => {
  return {
    id: id,
    name: name || id,
    isManaged: true,
    status: "up",
    kind: "device",
  };
};

const nodes: Array<NetworkTopologyNode> = [
  node("core"),
  node("sw-a"),
  node("sw-b"),
  node("cam-2", "lobby-camera"),
  node("cam-1", "dock-camera"),
  node("cam-3", "yard-camera"),
  node("printer"),
];

const edges: Array<NetworkTopologyEdge> = [
  { fromNodeId: "core", toNodeId: "sw-a" },
  { fromNodeId: "core", toNodeId: "sw-b" },
  { fromNodeId: "sw-a", toNodeId: "cam-1" },
  { fromNodeId: "sw-a", toNodeId: "cam-2" },
  { fromNodeId: "sw-b", toNodeId: "cam-3" },
  { fromNodeId: "sw-b", toNodeId: "printer" },
];

const positions: Map<string, TopologyPoint> = new Map<string, TopologyPoint>([
  ["core", { x: 500, y: 100 }],
  ["sw-a", { x: 300, y: 250 }],
  ["sw-b", { x: 700, y: 250 }],
  ["cam-1", { x: 250, y: 400 }],
  ["cam-2", { x: 350, y: 400 }],
  ["cam-3", { x: 650, y: 400 }],
  ["printer", { x: 750, y: 400 }],
]);

const viewModelFor: (input: {
  searchText: string;
  searchContextNodeIds?: ReadonlySet<string> | undefined;
  locatedNodeId?: string | null | undefined;
}) => TopologyViewModel = (input: {
  searchText: string;
  searchContextNodeIds?: ReadonlySet<string> | undefined;
  locatedNodeId?: string | null | undefined;
}): TopologyViewModel => {
  return buildTopologyViewModel({
    nodes: nodes,
    edges: edges,
    positions: positions,
    searchText: input.searchText,
    visibleKinds: ALL_NODE_KINDS,
    healthFilterMode: "all",
    focusNodeIds: new Set<string>(),
    selectedNodeId: null,
    selectedEdgeKey: null,
    pinnedNodeIds: new Set<string>(),
    searchContextNodeIds: input.searchContextNodeIds,
    locatedNodeId: input.locatedNodeId,
  });
};

const viewOf: (viewModel: TopologyViewModel, id: string) => TopologyNodeView = (
  viewModel: TopologyViewModel,
  id: string,
): TopologyNodeView => {
  return viewModel.nodes.find((candidate: TopologyNodeView): boolean => {
    return candidate.id === id;
  })!;
};

describe("the matches, in the order next match visits them", () => {
  test("top to bottom, then left to right, whatever order they arrived in", () => {
    const viewModel: TopologyViewModel = viewModelFor({
      searchText: "camera",
    });
    expect(viewModel.searchMatchNodeIds).toEqual(["cam-1", "cam-2", "cam-3"]);
    expect(viewModel.searchMatchCount).toBe(3);
  });

  test("no search, no matches", () => {
    expect(viewModelFor({ searchText: "" }).searchMatchNodeIds).toEqual([]);
    expect(viewModelFor({ searchText: "   " }).searchMatchNodeIds).toEqual([]);
  });

  test("a search that matches nothing lists nothing", () => {
    expect(
      viewModelFor({ searchText: "no-such-device" }).searchMatchNodeIds,
    ).toEqual([]);
  });
});

describe("the path down to a match stays bright", () => {
  test("without a path, only the matches stay bright", () => {
    const viewModel: TopologyViewModel = viewModelFor({
      searchText: "yard-camera",
    });
    expect(viewOf(viewModel, "cam-3").isDimmed).toBe(false);
    expect(viewOf(viewModel, "sw-b").isDimmed).toBe(true);
    expect(viewOf(viewModel, "core").isDimmed).toBe(true);
  });

  test("with the path, its devices and the links along it stay bright too", () => {
    const viewModel: TopologyViewModel = viewModelFor({
      searchText: "yard-camera",
      searchContextNodeIds: new Set<string>(["sw-b", "core"]),
    });
    expect(viewOf(viewModel, "cam-3").isDimmed).toBe(false);
    expect(viewOf(viewModel, "sw-b").isDimmed).toBe(false);
    expect(viewOf(viewModel, "core").isDimmed).toBe(false);
    // Off the path: still dimmed.
    expect(viewOf(viewModel, "sw-a").isDimmed).toBe(true);
    expect(viewOf(viewModel, "printer").isDimmed).toBe(true);
    const lit: Array<string> = viewModel.edges
      .filter((edge: { isDimmed: boolean }): boolean => {
        return !edge.isDimmed;
      })
      .map((edge: { key: string }): string => {
        return edge.key;
      })
      .sort();
    expect(lit).toEqual(["cam-3::sw-b", "core::sw-b"]);
  });

  test("a device on the path is not counted as a match", () => {
    const viewModel: TopologyViewModel = viewModelFor({
      searchText: "yard-camera",
      searchContextNodeIds: new Set<string>(["sw-b", "core"]),
    });
    expect(viewModel.searchMatchCount).toBe(1);
    expect(viewModel.searchMatchNodeIds).toEqual(["cam-3"]);
  });
});

describe("the match the reader stepped to is ringed", () => {
  test("only that one", () => {
    const viewModel: TopologyViewModel = viewModelFor({
      searchText: "camera",
      locatedNodeId: "cam-2",
    });
    expect(
      viewModel.nodes
        .filter((view: TopologyNodeView): boolean => {
          return view.isLocated;
        })
        .map((view: TopologyNodeView): string => {
          return view.id;
        }),
    ).toEqual(["cam-2"]);
    expect(
      viewModelFor({ searchText: "camera" }).nodes.some(
        (view: TopologyNodeView): boolean => {
          return view.isLocated;
        },
      ),
    ).toBe(false);
  });
});

describe("the camera goes to what the search found", () => {
  const bounds: WorldBounds = { minX: 100, minY: 100, maxX: 300, maxY: 200 };

  test("framing matches never zooms in closer than its cap", () => {
    const capped: ViewTransform = fitViewToBoundsWithin(bounds, VIEW_BOX, 1.2);
    expect(fitViewToBounds(bounds, VIEW_BOX).scale).toBeGreaterThan(1.2);
    expect(capped.scale).toBe(1.2);
    // Still centred on what it frames.
    expect(200 * capped.scale + capped.tx).toBeCloseTo(VIEW_BOX.width / 2, 6);
    expect(150 * capped.scale + capped.ty).toBeCloseTo(VIEW_BOX.height / 2, 6);
  });

  test("a frame wider than the cap allows is fitted as usual", () => {
    const wide: WorldBounds = { minX: 0, minY: 0, maxX: 5000, maxY: 3000 };
    expect(fitViewToBoundsWithin(wide, VIEW_BOX, 1.2)).toEqual(
      fitViewToBounds(wide, VIEW_BOX),
    );
  });

  test("a lone match is centred at the cap, not blown up to the zoom limit", () => {
    const single: WorldBounds = { minX: 400, minY: 300, maxX: 400, maxY: 300 };
    const view: ViewTransform = fitViewToBoundsWithin(single, VIEW_BOX, 1.2);
    expect(view.scale).toBe(1.2);
    expect(400 * view.scale + view.tx).toBeCloseTo(500, 6);
    expect(300 * view.scale + view.ty).toBeCloseTo(350, 6);
  });

  test("no bounds, or a cap that makes no sense, fall back to a plain fit", () => {
    expect(fitViewToBoundsWithin(null, VIEW_BOX, 1.2)).toEqual(IDENTITY_VIEW);
    expect(fitViewToBoundsWithin(bounds, VIEW_BOX, Number.NaN)).toEqual(
      fitViewToBounds(bounds, VIEW_BOX),
    );
    expect(fitViewToBoundsWithin(bounds, VIEW_BOX, 0)).toEqual(
      fitViewToBounds(bounds, VIEW_BOX),
    );
  });

  test("next match centres the device in the frame at the scale asked for", () => {
    const view: ViewTransform = viewCenteredOn({ x: 250, y: 400 }, 1, VIEW_BOX);
    expect(view).toEqual({ scale: 1, tx: 250, ty: -50 });
  });

  test("the scale is held to the zoom limits, and nonsense reads as one", () => {
    expect(viewCenteredOn({ x: 0, y: 0 }, 50, VIEW_BOX).scale).toBe(MAX_ZOOM);
    expect(viewCenteredOn({ x: 0, y: 0 }, 0.0001, VIEW_BOX).scale).toBe(
      MIN_ZOOM,
    );
    expect(viewCenteredOn({ x: 0, y: 0 }, Number.NaN, VIEW_BOX).scale).toBe(1);
    expect(viewCenteredOn({ x: Number.NaN, y: 0 }, 1, VIEW_BOX)).toEqual(
      IDENTITY_VIEW,
    );
  });
});

describe("folding a branch keeps the device the reader pressed where it was", () => {
  const view: ViewTransform = { scale: 0.8, tx: 40, ty: -20 };

  test("the camera moves by however far the device moved", () => {
    const before: TopologyPoint = { x: 600, y: 300 };
    const after: TopologyPoint = { x: 420, y: 300 };
    const kept: ViewTransform = viewKeepingPointFixed(view, before, after);
    expect(after.x * kept.scale + kept.tx).toBeCloseTo(
      before.x * view.scale + view.tx,
      6,
    );
    expect(after.y * kept.scale + kept.ty).toBeCloseTo(
      before.y * view.scale + view.ty,
      6,
    );
    expect(kept.scale).toBe(view.scale);
  });

  test("a device that did not move leaves the very same view", () => {
    expect(viewKeepingPointFixed(view, { x: 1, y: 2 }, { x: 1, y: 2 })).toBe(
      view,
    );
  });

  test("a position that is not a number moves nothing", () => {
    expect(
      viewKeepingPointFixed(view, { x: Number.NaN, y: 0 }, { x: 0, y: 0 }),
    ).toBe(view);
  });
});
