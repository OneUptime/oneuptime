import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { computeParentChildTopologyModel } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/ParentChildTopologyLayout";
import { TopologyPoint } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";
import {
  TopologyLayoutModel,
  TopologyLeafBlock,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyModel";
import {
  COMB_POSITION_TOLERANCE,
  LeafBlockComb,
  LeafBlockConnectors,
  TopologyConnectorSegment,
  buildLeafBlockConnectors,
  edgeKeyBetween,
} from "../../FeatureSet/Dashboard/src/Components/Topology/LeafBlockConnectors";
import { combPathData } from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyDrawing";
import {
  LINK_STATE_COLORS,
  edgeKeyForEdge,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyMeta";
import {
  ALL_NODE_KINDS,
  TopologyCombView,
  TopologyEdgeView,
  TopologyNodeKind,
  TopologyViewModel,
  buildTopologyViewModel,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyViewModel";

/*
 * ISSUE #6606: A LEAF BLOCK HANGS FROM ITS PARENT BY A COMB.
 *
 * Straight lines from a switch to each device of a grid under it would
 * cut through every row above the one they head for. So the block is wired
 * like an org chart: a trunk, a bus, a spine left of each column and a
 * stub to each device - the trunk, bus and spines shared and drawn once,
 * each link drawn as its own stub in its own colour.
 *
 * The comb follows the devices: a block dragged with its parent takes it
 * along, a device dragged out of the grid leaves it (and is drawn with a
 * plain line again), and a parent dragged away from its block takes every
 * device off it.
 */

const WIDTH: number = 1000;
const HEIGHT: number = 700;

const device: (id: string) => NetworkTopologyNode = (
  id: string,
): NetworkTopologyNode => {
  return { id: id, name: id, isManaged: true, status: "up", kind: "device" };
};

const endpoint: (id: string) => NetworkTopologyNode = (
  id: string,
): NetworkTopologyNode => {
  return {
    id: id,
    name: id,
    isManaged: false,
    status: "unknown",
    kind: "endpoint",
  };
};

interface Site {
  nodes: Array<NetworkTopologyNode>;
  edges: Array<NetworkTopologyEdge>;
  model: TopologyLayoutModel;
  block: TopologyLeafBlock;
}

// A router over one switch with `count` endpoints learned from its table.
const site: (count: number) => Site = (count: number): Site => {
  const nodes: Array<NetworkTopologyNode> = [device("core"), device("sw")];
  const edges: Array<NetworkTopologyEdge> = [
    { fromNodeId: "core", toNodeId: "sw", protocols: ["lldp"] },
  ];
  for (let index: number = 0; index < count; index++) {
    const id: string = `ep:${String(index).padStart(2, "0")}`;
    nodes.push(endpoint(id));
    edges.push({ fromNodeId: "sw", toNodeId: id, protocols: ["fdb"] });
  }
  const model: TopologyLayoutModel = computeParentChildTopologyModel(
    nodes,
    edges,
    WIDTH,
    HEIGHT,
  );
  return {
    nodes: nodes,
    edges: edges,
    model: model,
    block: model.leafBlocks![0]!,
  };
};

const allEdgeKeys: (edges: Array<NetworkTopologyEdge>) => Set<string> = (
  edges: Array<NetworkTopologyEdge>,
): Set<string> => {
  return new Set<string>(
    edges.map((edge: NetworkTopologyEdge): string => {
      return edgeKeyForEdge(edge);
    }),
  );
};

const moved: (
  positions: ReadonlyMap<string, TopologyPoint>,
  ids: Array<string>,
  dx: number,
  dy: number,
) => Map<string, TopologyPoint> = (
  positions: ReadonlyMap<string, TopologyPoint>,
  ids: Array<string>,
  dx: number,
  dy: number,
): Map<string, TopologyPoint> => {
  const next: Map<string, TopologyPoint> = new Map<string, TopologyPoint>(
    positions,
  );
  for (const id of ids) {
    const point: TopologyPoint = positions.get(id)!;
    next.set(id, { x: point.x + dx, y: point.y + dy });
  }
  return next;
};

const isAxisAligned: (segment: TopologyConnectorSegment) => boolean = (
  segment: TopologyConnectorSegment,
): boolean => {
  return segment.x1 === segment.x2 || segment.y1 === segment.y2;
};

describe("the comb, as the layout placed the block", () => {
  const graph: Site = site(12);
  const connectors: LeafBlockConnectors = buildLeafBlockConnectors({
    leafBlocks: graph.model.leafBlocks,
    basePositions: graph.model.positions,
    drawnPositions: graph.model.positions,
    drawnEdgeKeys: allEdgeKeys(graph.edges),
  });
  const comb: LeafBlockComb = connectors.combs[0]!;

  test("one comb per block, keyed by its parent, serving every leaf", () => {
    expect(connectors.combs).toHaveLength(1);
    expect(comb.parentId).toBe("sw");
    expect(comb.key).toBe("comb-sw");
    expect(new Set<string>(comb.edgeKeys)).toEqual(
      new Set<string>(
        graph.block.memberIds.map((memberId: string): string => {
          return edgeKeyBetween("sw", memberId);
        }),
      ),
    );
  });

  test("every segment is horizontal or vertical", () => {
    for (const segment of comb.segments) {
      expect(isAxisAligned(segment)).toBe(true);
    }
    for (const [, stub] of connectors.stubByEdgeKey) {
      expect(stub.y1).toBe(stub.y2);
    }
  });

  test("the trunk drops from the parent's centre to the bus", () => {
    const parent: TopologyPoint = graph.model.positions.get("sw")!;
    expect(comb.segments[0]).toEqual({
      x1: parent.x,
      y1: parent.y,
      x2: parent.x,
      y2: graph.block.busY,
    });
  });

  test("the bus spans every spine and the trunk", () => {
    const bus: TopologyConnectorSegment = comb.segments[1]!;
    expect(bus.y1).toBe(graph.block.busY);
    expect(bus.y2).toBe(graph.block.busY);
    const parentX: number = graph.model.positions.get("sw")!.x;
    expect(bus.x1).toBe(Math.min(parentX, ...graph.block.spineXs));
    expect(bus.x2).toBe(Math.max(parentX, ...graph.block.spineXs));
  });

  test("each spine runs from the bus down to its column's lowest leaf", () => {
    const spines: Array<TopologyConnectorSegment> = comb.segments.slice(2);
    expect(spines).toHaveLength(graph.block.spineXs.length);
    spines.forEach((spine: TopologyConnectorSegment, column: number): void => {
      expect(spine.x1).toBe(graph.block.spineXs[column]);
      expect(spine.y1).toBe(graph.block.busY);
      const lowest: number = Math.max(
        ...graph.block.memberIds
          .filter((memberId: string): boolean => {
            return graph.block.columnByMemberId.get(memberId) === column;
          })
          .map((memberId: string): number => {
            return graph.model.positions.get(memberId)!.y;
          }),
      );
      expect(spine.y2).toBe(lowest);
    });
  });

  test("each leaf's stub runs from its column's spine across to it", () => {
    for (const memberId of graph.block.memberIds) {
      const stub: TopologyConnectorSegment = connectors.stubByEdgeKey.get(
        edgeKeyBetween("sw", memberId),
      )!;
      const point: TopologyPoint = graph.model.positions.get(memberId)!;
      expect(stub).toEqual({
        x1: graph.block.spineXs[graph.block.columnByMemberId.get(memberId)!],
        y1: point.y,
        x2: point.x,
        y2: point.y,
      });
    }
  });

  test("the uplink above the block is not on any comb", () => {
    expect(connectors.stubByEdgeKey.has(edgeKeyBetween("core", "sw"))).toBe(
      false,
    );
  });

  test("a comb is one SVG path, one run per segment", () => {
    expect(combPathData(comb.segments)).toBe(
      comb.segments
        .map((segment: TopologyConnectorSegment): string => {
          return `M ${segment.x1} ${segment.y1} L ${segment.x2} ${segment.y2}`;
        })
        .join(" "),
    );
    expect(
      combPathData([
        { x1: Number.NaN, y1: 0, x2: 1, y2: 1 },
        comb.segments[0]!,
      ]),
    ).toBe(
      `M ${comb.segments[0]!.x1} ${comb.segments[0]!.y1} L ${comb.segments[0]!.x2} ${comb.segments[0]!.y2}`,
    );
  });
});

describe("the comb follows the devices the reader moves", () => {
  const graph: Site = site(12);
  const edgeKeys: Set<string> = allEdgeKeys(graph.edges);

  test("a block dragged with its parent takes the comb along", () => {
    const drawn: Map<string, TopologyPoint> = moved(
      graph.model.positions,
      ["sw", ...graph.block.memberIds],
      120,
      -40,
    );
    const atRest: LeafBlockConnectors = buildLeafBlockConnectors({
      leafBlocks: graph.model.leafBlocks,
      basePositions: graph.model.positions,
      drawnPositions: graph.model.positions,
      drawnEdgeKeys: edgeKeys,
    });
    const dragged: LeafBlockConnectors = buildLeafBlockConnectors({
      leafBlocks: graph.model.leafBlocks,
      basePositions: graph.model.positions,
      drawnPositions: drawn,
      drawnEdgeKeys: edgeKeys,
    });
    expect(dragged.combs[0]!.edgeKeys).toEqual(atRest.combs[0]!.edgeKeys);
    dragged.combs[0]!.segments.forEach(
      (segment: TopologyConnectorSegment, index: number): void => {
        const original: TopologyConnectorSegment =
          atRest.combs[0]!.segments[index]!;
        expect(segment.x1).toBeCloseTo(original.x1 + 120, 6);
        expect(segment.y1).toBeCloseTo(original.y1 - 40, 6);
        expect(segment.x2).toBeCloseTo(original.x2 + 120, 6);
        expect(segment.y2).toBeCloseTo(original.y2 - 40, 6);
      },
    );
  });

  test("an arrangement read back rounded to two decimals keeps its comb", () => {
    const drawn: Map<string, TopologyPoint> = new Map<string, TopologyPoint>();
    for (const [id, point] of graph.model.positions) {
      drawn.set(id, {
        x: Math.round((point.x + 33.333) * 100) / 100,
        y: Math.round((point.y + 11.111) * 100) / 100,
      });
    }
    expect(COMB_POSITION_TOLERANCE).toBeGreaterThan(0.01);
    const connectors: LeafBlockConnectors = buildLeafBlockConnectors({
      leafBlocks: graph.model.leafBlocks,
      basePositions: graph.model.positions,
      drawnPositions: drawn,
      drawnEdgeKeys: edgeKeys,
    });
    expect(connectors.combs[0]!.edgeKeys).toHaveLength(12);
  });

  test("a leaf dragged out of the grid leaves the comb and gets its plain line back", () => {
    const strayId: string = graph.block.memberIds[3]!;
    const drawn: Map<string, TopologyPoint> = moved(
      graph.model.positions,
      [strayId],
      300,
      200,
    );
    const connectors: LeafBlockConnectors = buildLeafBlockConnectors({
      leafBlocks: graph.model.leafBlocks,
      basePositions: graph.model.positions,
      drawnPositions: drawn,
      drawnEdgeKeys: edgeKeys,
    });
    expect(connectors.stubByEdgeKey.has(edgeKeyBetween("sw", strayId))).toBe(
      false,
    );
    expect(connectors.combs[0]!.edgeKeys).toHaveLength(11);
  });

  test("a parent dragged away from its block takes every leaf off the comb", () => {
    const drawn: Map<string, TopologyPoint> = moved(
      graph.model.positions,
      ["sw"],
      -250,
      0,
    );
    const connectors: LeafBlockConnectors = buildLeafBlockConnectors({
      leafBlocks: graph.model.leafBlocks,
      basePositions: graph.model.positions,
      drawnPositions: drawn,
      drawnEdgeKeys: edgeKeys,
    });
    expect(connectors.combs).toEqual([]);
    expect(connectors.stubByEdgeKey.size).toBe(0);
  });

  test("a leaf that is not drawn, or whose link is not, hangs from nothing", () => {
    const hiddenId: string = graph.block.memberIds[0]!;
    const unlinkedId: string = graph.block.memberIds[1]!;
    const drawn: Map<string, TopologyPoint> = new Map<string, TopologyPoint>(
      graph.model.positions,
    );
    drawn.delete(hiddenId);
    const keys: Set<string> = new Set<string>(edgeKeys);
    keys.delete(edgeKeyBetween("sw", unlinkedId));
    const connectors: LeafBlockConnectors = buildLeafBlockConnectors({
      leafBlocks: graph.model.leafBlocks,
      basePositions: graph.model.positions,
      drawnPositions: drawn,
      drawnEdgeKeys: keys,
    });
    const served: Set<string> = new Set<string>(connectors.combs[0]!.edgeKeys);
    expect(served.has(edgeKeyBetween("sw", hiddenId))).toBe(false);
    expect(served.has(edgeKeyBetween("sw", unlinkedId))).toBe(false);
    expect(served.size).toBe(10);
  });

  test("a parent that is not drawn has no comb", () => {
    const drawn: Map<string, TopologyPoint> = new Map<string, TopologyPoint>(
      graph.model.positions,
    );
    drawn.delete("sw");
    expect(
      buildLeafBlockConnectors({
        leafBlocks: graph.model.leafBlocks,
        basePositions: graph.model.positions,
        drawnPositions: drawn,
        drawnEdgeKeys: edgeKeys,
      }).combs,
    ).toEqual([]);
  });

  test("no blocks, no combs: the same empty answer every time", () => {
    const empty: LeafBlockConnectors = buildLeafBlockConnectors({
      leafBlocks: [],
      basePositions: graph.model.positions,
      drawnPositions: graph.model.positions,
      drawnEdgeKeys: edgeKeys,
    });
    expect(empty.combs).toEqual([]);
    expect(
      buildLeafBlockConnectors({
        leafBlocks: undefined,
        basePositions: graph.model.positions,
        drawnPositions: graph.model.positions,
        drawnEdgeKeys: edgeKeys,
      }),
    ).toBe(empty);
  });
});

describe("the view model draws the combs and the links hanging from them", () => {
  const graph: Site = site(12);

  const viewModelFor: (
    overrides?: Partial<{
      positions: Map<string, TopologyPoint>;
      visibleKinds: ReadonlySet<TopologyNodeKind>;
      searchText: string;
      edges: Array<NetworkTopologyEdge>;
    }>,
  ) => TopologyViewModel = (
    overrides?: Partial<{
      positions: Map<string, TopologyPoint>;
      visibleKinds: ReadonlySet<TopologyNodeKind>;
      searchText: string;
      edges: Array<NetworkTopologyEdge>;
    }>,
  ): TopologyViewModel => {
    return buildTopologyViewModel({
      nodes: graph.nodes,
      edges: overrides?.edges || graph.edges,
      positions: overrides?.positions || graph.model.positions,
      searchText: overrides?.searchText || "",
      visibleKinds: overrides?.visibleKinds || ALL_NODE_KINDS,
      healthFilterMode: "all",
      focusNodeIds: new Set<string>(),
      selectedNodeId: null,
      selectedEdgeKey: null,
      pinnedNodeIds: new Set<string>(),
      leafBlocks: graph.model.leafBlocks,
      layoutPositions: graph.model.positions,
    });
  };

  test("a link on a comb is drawn as its stub; every other link centre to centre", () => {
    const viewModel: TopologyViewModel = viewModelFor();
    for (const edgeView of viewModel.edges) {
      const from: TopologyPoint = graph.model.positions.get(
        edgeView.fromNodeId,
      )!;
      const to: TopologyPoint = graph.model.positions.get(edgeView.toNodeId)!;
      if (edgeView.fromNodeId === "core") {
        expect(edgeView.isOnComb).toBe(false);
        expect([edgeView.x1, edgeView.y1, edgeView.x2, edgeView.y2]).toEqual([
          from.x,
          from.y,
          to.x,
          to.y,
        ]);
        continue;
      }
      expect(edgeView.isOnComb).toBe(true);
      // The stub ends on the device, and starts on its column's spine.
      expect([edgeView.x2, edgeView.y2]).toEqual([to.x, to.y]);
      expect(edgeView.y1).toBe(to.y);
      expect(edgeView.x1).toBeLessThan(to.x);
    }
  });

  test("the comb takes its links' shared colour and the learned dash", () => {
    const viewModel: TopologyViewModel = viewModelFor();
    expect(viewModel.combs).toHaveLength(1);
    const comb: TopologyCombView = viewModel.combs[0]!;
    const states: Set<string> = new Set<string>(
      viewModel.edges
        .filter((edgeView: TopologyEdgeView): boolean => {
          return edgeView.isOnComb;
        })
        .map((edgeView: TopologyEdgeView): string => {
          return edgeView.state;
        }),
    );
    expect(states.size).toBe(1);
    expect(comb.color).toBe(
      LINK_STATE_COLORS[[...states][0] as keyof typeof LINK_STATE_COLORS],
    );
    // Every link on it was learned from a forwarding table.
    expect(comb.strokeDashArray).toBe("3 3");
    expect(comb.isDimmed).toBe(false);
  });

  test("links in different states share the healthy neutral; one cabled link makes it solid", () => {
    const edges: Array<NetworkTopologyEdge> = graph.edges.map(
      (edge: NetworkTopologyEdge, index: number): NetworkTopologyEdge => {
        if (edge.fromNodeId !== "sw" || index !== 3) {
          return edge;
        }
        return {
          ...edge,
          protocols: ["lldp"],
          fromInterface: { interfaceIndex: 1, isOperationallyUp: false },
        } as NetworkTopologyEdge;
      },
    );
    const viewModel: TopologyViewModel = viewModelFor({ edges: edges });
    const comb: TopologyCombView = viewModel.combs[0]!;
    expect(comb.color).toBe(LINK_STATE_COLORS.healthy);
    expect(comb.strokeDashArray).toBeUndefined();
  });

  test("a search that dims every leaf dims the comb with them", () => {
    const viewModel: TopologyViewModel = viewModelFor({
      searchText: "core",
    });
    expect(viewModel.combs[0]!.isDimmed).toBe(true);
    const lit: TopologyViewModel = viewModelFor({ searchText: "ep:05" });
    expect(lit.combs[0]!.isDimmed).toBe(true);
  });

  test("endpoints switched off: no comb, and no spine reaching down to nothing", () => {
    const viewModel: TopologyViewModel = viewModelFor({
      visibleKinds: new Set<TopologyNodeKind>(["device", "unmanaged"]),
    });
    expect(viewModel.combs).toEqual([]);
  });

  test("without leaf blocks the view model draws no comb and changes no link", () => {
    const viewModel: TopologyViewModel = buildTopologyViewModel({
      nodes: graph.nodes,
      edges: graph.edges,
      positions: graph.model.positions,
      searchText: "",
      visibleKinds: ALL_NODE_KINDS,
      healthFilterMode: "all",
      focusNodeIds: new Set<string>(),
      selectedNodeId: null,
      selectedEdgeKey: null,
      pinnedNodeIds: new Set<string>(),
    });
    expect(viewModel.combs).toEqual([]);
    for (const edgeView of viewModel.edges) {
      expect(edgeView.isOnComb).toBe(false);
    }
  });
});
