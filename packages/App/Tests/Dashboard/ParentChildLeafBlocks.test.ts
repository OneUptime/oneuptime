import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  PARENT_CHILD_LEAF_BLOCK_ASPECTS,
  PARENT_CHILD_LEAF_BLOCK_MIN_LEAVES,
  PARENT_CHILD_LEAF_BUS_CLEARANCE,
  PARENT_CHILD_LEAF_COLUMN_GAP,
  PARENT_CHILD_LEVEL_GAP,
  ParentChildForest,
  buildParentChildForest,
  compareNamesNaturally,
  computeParentChildTopologyModel,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/ParentChildTopologyLayout";
import { countNodeOverlaps } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyCollision";
import {
  TopologyNodeFootprint,
  buildFootprints,
  footprintOrDefault,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyFootprint";
import {
  TopologyPoint,
  canonicalNodeOrder,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";
import {
  TopologyLayoutModel,
  TopologyLeafBlock,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyModel";
import { computeTopologyLayoutModel } from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyDrawing";

/*
 * ISSUE #6606: A PARENT'S MANY LEAVES PACK INTO A GRID, AND BRANCHES FOLD.
 *
 * The parent-and-child layout drew every child of a device side by side.
 * A switch with sixty devices plugged into it made the map sixty devices
 * wide: fit-to-view shrank it past reading, and zooming in to read a name
 * showed a handful of devices and none of the hierarchy around them. The
 * customer's screenshots were exactly that - one row of sixty glyphs under
 * three switches.
 *
 * A node with six or more children that have none of their own now packs
 * them into a compact grid under it, column by column, wired to it by a
 * comb whose spines run in the gaps between the columns. Children with
 * children of their own keep their place in the row. And the reader can
 * fold a branch away: the folded node stays, nothing below it is placed,
 * and the hierarchy itself never changes.
 */

const WIDTH: number = 1000;
const HEIGHT: number = 700;

const device: (
  id: string,
  overrides?: Partial<NetworkTopologyNode>,
) => NetworkTopologyNode = (
  id: string,
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode => {
  return {
    id: id,
    name: id,
    isManaged: true,
    status: "up",
    kind: "device",
    ...overrides,
  };
};

const unmanaged: (id: string, name?: string) => NetworkTopologyNode = (
  id: string,
  name?: string,
): NetworkTopologyNode => {
  return {
    id: id,
    name: name || id,
    isManaged: false,
    status: "unknown",
    kind: "unmanaged",
  };
};

const endpoint: (id: string, name?: string) => NetworkTopologyNode = (
  id: string,
  name?: string,
): NetworkTopologyNode => {
  return {
    id: id,
    name: name || id,
    isManaged: false,
    status: "unknown",
    kind: "endpoint",
  };
};

const link: (
  from: string,
  to: string,
  protocol?: "lldp" | "fdb",
) => NetworkTopologyEdge = (
  from: string,
  to: string,
  protocol: "lldp" | "fdb" = "lldp",
): NetworkTopologyEdge => {
  return { fromNodeId: from, toNodeId: to, protocols: [protocol] };
};

interface Graph {
  nodes: Array<NetworkTopologyNode>;
  edges: Array<NetworkTopologyEdge>;
}

// A switch with `count` endpoints hanging off it over FDB.
const switchWithEndpoints: (switchId: string, count: number) => Graph = (
  switchId: string,
  count: number,
): Graph => {
  const nodes: Array<NetworkTopologyNode> = [device(switchId)];
  const edges: Array<NetworkTopologyEdge> = [];
  for (let index: number = 0; index < count; index++) {
    const id: string = `ep:${switchId}-${String(index).padStart(3, "0")}`;
    nodes.push(endpoint(id, `${switchId}-host-${index}`));
    edges.push(link(switchId, id, "fdb"));
  }
  return { nodes: nodes, edges: edges };
};

/*
 * The customer's network: a firewall over three switches, each with access
 * points, printers and endpoints plugged in - and one access point with a
 * tablet behind it, so one switch has a child with children of its own.
 */
const customerSite: () => Graph = (): Graph => {
  const nodes: Array<NetworkTopologyNode> = [
    device("fw", { role: "firewall" }),
  ];
  const edges: Array<NetworkTopologyEdge> = [];
  for (const switchId of ["sw-1", "sw-2", "sw-3"]) {
    nodes.push(device(switchId, { role: "switch" }));
    edges.push(link("fw", switchId));
    for (let index: number = 0; index < 10; index++) {
      const id: string = `${switchId}-ap-${index}`;
      nodes.push(device(id, { role: "wirelessAccessPoint" }));
      edges.push(link(switchId, id));
    }
    for (let index: number = 0; index < 14; index++) {
      const id: string = `ep:${switchId}-${index}`;
      nodes.push(endpoint(id, `tablet-${index}`));
      edges.push(link(switchId, id, "fdb"));
    }
  }
  nodes.push(device("ap-indoor", { role: "wirelessAccessPoint" }));
  edges.push(link("sw-1", "ap-indoor"));
  nodes.push(device("tablet-15", { role: "host" }));
  edges.push(link("ap-indoor", "tablet-15"));
  return { nodes: nodes, edges: edges };
};

const blockOf: (
  model: TopologyLayoutModel,
  parentId: string,
) => TopologyLeafBlock | undefined = (
  model: TopologyLayoutModel,
  parentId: string,
): TopologyLeafBlock | undefined => {
  return (model.leafBlocks || []).find((block: TopologyLeafBlock): boolean => {
    return block.parentId === parentId;
  });
};

// The zoom fit-to-view draws the map at, by its painted extent.
const fitScaleOf: (
  model: TopologyLayoutModel,
  nodes: Array<NetworkTopologyNode>,
) => number = (
  model: TopologyLayoutModel,
  nodes: Array<NetworkTopologyNode>,
): number => {
  const footprints: Map<string, TopologyNodeFootprint> = buildFootprints(nodes);
  let minX: number = Infinity;
  let minY: number = Infinity;
  let maxX: number = -Infinity;
  let maxY: number = -Infinity;
  for (const [id, point] of model.positions) {
    const footprint: TopologyNodeFootprint = footprintOrDefault(footprints, id);
    minX = Math.min(minX, point.x - footprint.inkHalfWidth);
    maxX = Math.max(maxX, point.x + footprint.inkHalfWidth);
    minY = Math.min(minY, point.y - footprint.halfHeight);
    maxY = Math.max(maxY, point.y + footprint.labelBottom);
  }
  return Math.min(WIDTH / (maxX - minX), HEIGHT / (maxY - minY));
};

const overlapsIn: (
  model: TopologyLayoutModel,
  nodes: Array<NetworkTopologyNode>,
) => number = (
  model: TopologyLayoutModel,
  nodes: Array<NetworkTopologyNode>,
): number => {
  return countNodeOverlaps(
    model.positions,
    canonicalNodeOrder(nodes).filter((id: string): boolean => {
      return model.positions.has(id);
    }),
    buildFootprints(nodes),
  );
};

describe("a node with many leaves packs them into a grid", () => {
  test("six leaves make a block; five stay a plain row", () => {
    expect(PARENT_CHILD_LEAF_BLOCK_MIN_LEAVES).toBe(6);

    const five: Graph = switchWithEndpoints("sw", 5);
    const row: TopologyLayoutModel = computeParentChildTopologyModel(
      five.nodes,
      five.edges,
      WIDTH,
      HEIGHT,
    );
    expect(row.leafBlocks).toEqual([]);
    const rowYs: Set<number> = new Set<number>();
    for (const node of five.nodes.slice(1)) {
      rowYs.add(row.positions.get(node.id)!.y);
    }
    expect(rowYs.size).toBe(1);

    const six: Graph = switchWithEndpoints("sw", 6);
    const grid: TopologyLayoutModel = computeParentChildTopologyModel(
      six.nodes,
      six.edges,
      WIDTH,
      HEIGHT,
    );
    expect(grid.leafBlocks).toHaveLength(1);
    expect(grid.leafBlocks![0]!.parentId).toBe("sw");
    expect(grid.leafBlocks![0]!.memberIds).toHaveLength(6);
  });

  test("a block always has at least two rows and two columns", () => {
    for (const count of [6, 7, 12, 40, 301]) {
      const graph: Graph = switchWithEndpoints("sw", count);
      const model: TopologyLayoutModel = computeParentChildTopologyModel(
        graph.nodes,
        graph.edges,
        WIDTH,
        HEIGHT,
      );
      const block: TopologyLeafBlock = blockOf(model, "sw")!;
      const columns: Set<number> = new Set<number>(
        block.columnByMemberId.values(),
      );
      const rowYs: Set<number> = new Set<number>();
      for (const memberId of block.memberIds) {
        rowYs.add(model.positions.get(memberId)!.y);
      }
      expect([count, columns.size >= 2]).toEqual([count, true]);
      expect([count, rowYs.size >= 2]).toEqual([count, true]);
      expect(block.spineXs).toHaveLength(columns.size);
    }
  });

  test("the grid fills down each column, then the next one to its right", () => {
    const graph: Graph = switchWithEndpoints("sw", 13);
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const block: TopologyLeafBlock = blockOf(model, "sw")!;
    for (let index: number = 1; index < block.memberIds.length; index++) {
      const previous: string = block.memberIds[index - 1]!;
      const current: string = block.memberIds[index]!;
      const previousColumn: number = block.columnByMemberId.get(previous)!;
      const currentColumn: number = block.columnByMemberId.get(current)!;
      const previousPoint: TopologyPoint = model.positions.get(previous)!;
      const currentPoint: TopologyPoint = model.positions.get(current)!;
      if (currentColumn === previousColumn) {
        // Down the column: same x, one row lower.
        expect(currentPoint.x).toBe(previousPoint.x);
        expect(currentPoint.y).toBeGreaterThan(previousPoint.y);
      } else {
        // The next column starts at the top again, to the right.
        expect(currentColumn).toBe(previousColumn + 1);
        expect(currentPoint.x).toBeGreaterThan(previousPoint.x);
        expect(currentPoint.y).toBe(
          model.positions.get(block.memberIds[0]!)!.y,
        );
      }
    }
  });

  test("the first row sits exactly one level below the parent", () => {
    const graph: Graph = switchWithEndpoints("sw", 20);
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const block: TopologyLeafBlock = blockOf(model, "sw")!;
    expect(
      model.positions.get(block.memberIds[0]!)!.y -
        model.positions.get("sw")!.y,
    ).toBe(PARENT_CHILD_LEVEL_GAP);
  });

  test("managed devices come first, then neighbours, then endpoints, each by name", () => {
    const nodes: Array<NetworkTopologyNode> = [
      device("sw"),
      endpoint("ep:z", "zebra-cam"),
      endpoint("ep:a", "alpha-cam"),
      unmanaged("peer-1", "printer-b"),
      device("ap-10", { name: "ap-10" }),
      device("ap-9", { name: "ap-9" }),
      unmanaged("peer-2", "printer-a"),
      device("ap-2", { name: "ap-2" }),
    ];
    const edges: Array<NetworkTopologyEdge> = nodes
      .slice(1)
      .map((node: NetworkTopologyNode): NetworkTopologyEdge => {
        return link("sw", node.id);
      });
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    // Natural order: ap-2 before ap-9 before ap-10, as a reader scans.
    expect(blockOf(model, "sw")!.memberIds).toEqual([
      "ap-2",
      "ap-9",
      "ap-10",
      "peer-2",
      "peer-1",
      "ep:a",
      "ep:z",
    ]);
  });

  test("a child with children of its own keeps its place in the row, left of the grid", () => {
    const graph: Graph = customerSite();
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const block: TopologyLeafBlock = blockOf(model, "sw-1")!;
    expect(block.memberIds).not.toContain("ap-indoor");
    const indoor: TopologyPoint = model.positions.get("ap-indoor")!;
    // On the row one level below its switch, like any tree child.
    expect(indoor.y - model.positions.get("sw-1")!.y).toBeCloseTo(
      PARENT_CHILD_LEVEL_GAP,
      6,
    );
    for (const memberId of block.memberIds) {
      expect(model.positions.get(memberId)!.x).toBeGreaterThan(indoor.x);
    }
    // And its own child stays under it.
    expect(model.positions.get("tablet-15")!.x).toBe(indoor.x);
  });

  test("the comb's bus runs between the parent's name and the first row", () => {
    const graph: Graph = customerSite();
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const footprints: Map<string, TopologyNodeFootprint> = buildFootprints(
      graph.nodes,
    );
    for (const block of model.leafBlocks || []) {
      const parent: TopologyPoint = model.positions.get(block.parentId)!;
      const parentLabelBottom: number =
        parent.y + footprintOrDefault(footprints, block.parentId).labelBottom;
      const firstRowY: number = model.positions.get(block.memberIds[0]!)!.y;
      let tallestHalfHeight: number = 0;
      for (const memberId of block.memberIds) {
        tallestHalfHeight = Math.max(
          tallestHalfHeight,
          footprintOrDefault(footprints, memberId).halfHeight,
        );
      }
      expect(block.busY).toBeGreaterThan(parentLabelBottom);
      expect(block.busY).toBe(
        firstRowY - tallestHalfHeight - PARENT_CHILD_LEAF_BUS_CLEARANCE,
      );
    }
  });

  test("each spine runs in the gap left of its column, clear of every name", () => {
    const graph: Graph = customerSite();
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const footprints: Map<string, TopologyNodeFootprint> = buildFootprints(
      graph.nodes,
    );
    for (const block of model.leafBlocks || []) {
      for (const memberId of block.memberIds) {
        const point: TopologyPoint = model.positions.get(memberId)!;
        const inkHalfWidth: number = footprintOrDefault(
          footprints,
          memberId,
        ).inkHalfWidth;
        // No spine, of this column or any other, runs through a name.
        for (const spineX of block.spineXs) {
          const clearance: number = Math.abs(spineX - point.x) - inkHalfWidth;
          expect(clearance).toBeGreaterThanOrEqual(
            PARENT_CHILD_LEAF_COLUMN_GAP / 2 - 1e-6,
          );
        }
        // Its own spine is the one immediately to its left.
        const spineX: number =
          block.spineXs[block.columnByMemberId.get(memberId)!]!;
        expect(spineX).toBeLessThan(point.x);
      }
    }
  });

  test("no two glyphs overlap, grids and all", () => {
    for (const graph of [
      customerSite(),
      switchWithEndpoints("sw", 300),
      switchWithEndpoints("sw", 7),
    ]) {
      const model: TopologyLayoutModel = computeParentChildTopologyModel(
        graph.nodes,
        graph.edges,
        WIDTH,
        HEIGHT,
      );
      expect(model.positions.size).toBe(graph.nodes.length);
      expect(overlapsIn(model, graph.nodes)).toBe(0);
    }
  });

  test("a block reports no hull of its own: the comb frames it", () => {
    const graph: Graph = customerSite();
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    expect(model.groups).toEqual([]);
    expect(model.leafBlocks!.length).toBe(3);
  });
});

describe("the grid takes whichever shape fits the whole map largest", () => {
  test("the customer's site now fits the screen at a size its names can be read at", () => {
    const graph: Graph = customerSite();
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    // The map hides names below a zoom of 0.55 (LABEL_VISIBILITY_MIN_SCALE).
    expect(fitScaleOf(model, graph.nodes)).toBeGreaterThan(0.55);
  });

  test("three hundred endpoints fit many times larger than they did in one row", () => {
    const graph: Graph = switchWithEndpoints("sw", 300);
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    // One row of three hundred fitted at about 0.04.
    expect(fitScaleOf(model, graph.nodes)).toBeGreaterThan(0.3);
  });

  test("blocks side by side grow tall and narrow; a block on its own grows wide", () => {
    const columnsOf: (
      model: TopologyLayoutModel,
      parentId: string,
    ) => number = (model: TopologyLayoutModel, parentId: string): number => {
      return new Set<number>(
        blockOf(model, parentId)!.columnByMemberId.values(),
      ).size;
    };

    // The same switch, with the same twenty-four devices.
    const alone: Graph = switchWithEndpoints("sw-1", 24);
    const aloneModel: TopologyLayoutModel = computeParentChildTopologyModel(
      alone.nodes,
      alone.edges,
      WIDTH,
      HEIGHT,
    );

    // Beside two more like it, under a router.
    const site: Graph = { nodes: [device("core")], edges: [] };
    for (const switchId of ["sw-1", "sw-2", "sw-3"]) {
      const branch: Graph = switchWithEndpoints(switchId, 24);
      site.nodes.push(...branch.nodes);
      site.edges.push(...branch.edges, link("core", switchId));
    }
    const siteModel: TopologyLayoutModel = computeParentChildTopologyModel(
      site.nodes,
      site.edges,
      WIDTH,
      HEIGHT,
    );

    expect(columnsOf(siteModel, "sw-1")).toBeLessThan(
      columnsOf(aloneModel, "sw-1"),
    );
    // Every block on one map takes the same shape.
    expect(columnsOf(siteModel, "sw-2")).toBe(columnsOf(siteModel, "sw-1"));
    expect(PARENT_CHILD_LEAF_BLOCK_ASPECTS.length).toBeGreaterThan(1);
  });

  test("a map with no grid is laid out exactly as before grids existed", () => {
    const graph: Graph = switchWithEndpoints("sw", 4);
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const sw: TopologyPoint = model.positions.get("sw")!;
    const children: Array<TopologyPoint> = graph.nodes
      .slice(1)
      .map((node: NetworkTopologyNode): TopologyPoint => {
        return model.positions.get(node.id)!;
      });
    for (const child of children) {
      expect(child.y - sw.y).toBe(PARENT_CHILD_LEVEL_GAP);
    }
    expect(sw.x).toBeCloseTo(
      (children[0]!.x + children[children.length - 1]!.x) / 2,
      6,
    );
  });
});

describe("the grid is a function of the graph, not of the order it arrived in", () => {
  test("reversed nodes and edges place every node identically", () => {
    const graph: Graph = customerSite();
    const forward: TopologyLayoutModel = computeParentChildTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const backward: TopologyLayoutModel = computeParentChildTopologyModel(
      [...graph.nodes].reverse(),
      [...graph.edges].reverse(),
      WIDTH,
      HEIGHT,
    );
    for (const [id, point] of forward.positions) {
      expect(backward.positions.get(id)).toEqual(point);
    }
    expect(backward.leafBlocks).toEqual(forward.leafBlocks);
  });
});

describe("compareNamesNaturally", () => {
  test("numbers compare by value, text by code unit", () => {
    const names: Array<string> = [
      "pos-10",
      "pos-2",
      "pos-1",
      "Pos-3",
      "pos-02",
      "a",
      "",
    ];
    expect([...names].sort(compareNamesNaturally)).toEqual([
      "",
      "Pos-3",
      "a",
      "pos-1",
      // Equal by value: the text decides, so the order is total.
      "pos-02",
      "pos-2",
      "pos-10",
    ]);
  });

  test("it is a total order: never two names equal unless they are", () => {
    expect(compareNamesNaturally("x", "x")).toBe(0);
    expect(compareNamesNaturally("x1", "x01")).not.toBe(0);
    expect(Math.sign(compareNamesNaturally("x1", "x01"))).toBe(
      -Math.sign(compareNamesNaturally("x01", "x1")),
    );
    expect(Math.sign(compareNamesNaturally("a2", "a10"))).toBe(-1);
    expect(Math.sign(compareNamesNaturally("a10", "a2"))).toBe(1);
  });
});

describe("folding a branch away", () => {
  const graph: Graph = customerSite();
  const full: TopologyLayoutModel = computeParentChildTopologyModel(
    graph.nodes,
    graph.edges,
    WIDTH,
    HEIGHT,
  );
  const folded: TopologyLayoutModel = computeParentChildTopologyModel(
    graph.nodes,
    graph.edges,
    WIDTH,
    HEIGHT,
    undefined,
    { collapsedNodeIds: new Set<string>(["sw-2"]) },
  );
  const forest: ParentChildForest = buildParentChildForest(
    graph.nodes,
    graph.edges,
  );

  test("the folded node is placed and nothing below it is", () => {
    expect(folded.positions.has("sw-2")).toBe(true);
    for (const childId of forest.childrenById.get("sw-2")!) {
      expect(folded.positions.has(childId)).toBe(false);
    }
    expect(folded.positions.size).toBe(
      graph.nodes.length - forest.childrenById.get("sw-2")!.length,
    );
    expect(blockOf(folded, "sw-2")).toBeUndefined();
  });

  test("its room goes back to its neighbours: the map gets narrower", () => {
    expect(fitScaleOf(folded, graph.nodes)).toBeGreaterThan(
      fitScaleOf(full, graph.nodes),
    );
  });

  test("the hierarchy is the whole graph's either way: nothing re-roots or re-parents", () => {
    expect(folded.hierarchy!.rootIds).toEqual(full.hierarchy!.rootIds);
    expect(folded.hierarchy!.parentById).toEqual(full.hierarchy!.parentById);
    expect(folded.hierarchy!.childrenById).toEqual(
      full.hierarchy!.childrenById,
    );
    expect([...folded.hierarchy!.collapsedNodeIds]).toEqual(["sw-2"]);
    expect(full.hierarchy!.collapsedNodeIds.size).toBe(0);
  });

  test("a folded switch is not a leaf: it keeps its own place rather than joining a grid", () => {
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
      undefined,
      { collapsedNodeIds: new Set<string>(["sw-1", "sw-2", "sw-3"]) },
    );
    expect(model.leafBlocks).toEqual([]);
    expect(model.positions.size).toBe(4);
    for (const switchId of ["sw-1", "sw-2", "sw-3"]) {
      expect(
        model.positions.get(switchId)!.y - model.positions.get("fw")!.y,
      ).toBeCloseTo(PARENT_CHILD_LEVEL_GAP, 6);
    }
  });

  test("folding a leaf, or a device that is not on the map, changes nothing", () => {
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
      undefined,
      {
        collapsedNodeIds: new Set<string>(["ep:sw-1-0", "gone-switch"]),
      },
    );
    expect(model.positions).toEqual(full.positions);
    expect(model.hierarchy!.collapsedNodeIds.size).toBe(0);
  });

  test("a pin on a device inside a folded branch does not put it back on the map", () => {
    const pinned: Map<string, TopologyPoint> = new Map<string, TopologyPoint>([
      ["sw-2-ap-0", { x: 10, y: 10 }],
    ]);
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
      pinned,
      { collapsedNodeIds: new Set<string>(["sw-2"]) },
    );
    expect(model.positions.has("sw-2-ap-0")).toBe(false);
  });

  test("the layout dispatcher hands the folds to the parent-child layout only", () => {
    const collapsed: Set<string> = new Set<string>(["sw-2"]);
    const parentChild: TopologyLayoutModel = computeTopologyLayoutModel(
      "parentChild",
      graph.nodes,
      graph.edges,
      { collapsedNodeIds: collapsed },
    );
    expect(parentChild.positions.has("sw-2-ap-0")).toBe(false);
    for (const mode of ["force", "tiered", "radial", "star"] as const) {
      const model: TopologyLayoutModel = computeTopologyLayoutModel(
        mode,
        graph.nodes,
        graph.edges,
        { collapsedNodeIds: collapsed },
      );
      expect([mode, model.positions.size]).toEqual([mode, graph.nodes.length]);
      expect(model.hierarchy).toBeUndefined();
    }
  });
});
