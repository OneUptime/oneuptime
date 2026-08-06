import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { UNLINKED_BOX_KEY } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/ForceTopologyLayout";
import {
  PARENT_CHILD_LAYOUT_MARGIN,
  PARENT_CHILD_LEVEL_GAP,
  PARENT_CHILD_SIBLING_GAP,
  PARENT_CHILD_TREE_GAP,
  ParentChildForest,
  buildParentChildForest,
  computeParentChildTopologyModel,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/ParentChildTopologyLayout";
import { countNodeOverlaps } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyCollision";
import {
  TopologyNodeFootprint,
  buildFootprints,
  footprintOrDefault,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyFootprint";
import {
  TopologyAdjacency,
  TopologyEdgePair,
  TopologyPoint,
  buildTopologyAdjacency,
  canonicalNodeOrder,
  compareNodeIds,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";
import {
  TopologyComponentBox,
  TopologyLayoutModel,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyModel";

const WIDTH: number = 1000;
const HEIGHT: number = 700;

/*
 * Floating point slack for assertions that compare a value against a sum
 * the layout arrived at by a different route. Every coordinate here is a
 * dyadic rational built from integer constants, so the real error is zero
 * or a few ulps — this is deliberately far larger than anything the layout
 * can produce and far smaller than any error a reader could see.
 */
const EPSILON: number = 1e-6;

type MakeNodeFunction = (
  id: string,
  overrides?: Partial<NetworkTopologyNode>,
) => NetworkTopologyNode;

const makeDevice: MakeNodeFunction = (
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

const makeUnmanaged: MakeNodeFunction = (
  id: string,
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode => {
  return {
    id: id,
    name: id,
    isManaged: false,
    status: "unknown",
    kind: "unmanaged",
    ...overrides,
  };
};

const makeEndpoint: MakeNodeFunction = (
  id: string,
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode => {
  return {
    id: id,
    name: id,
    isManaged: false,
    status: "unknown",
    kind: "endpoint",
    ...overrides,
  };
};

type MakeEdgeFunction = (
  from: string,
  to: string,
  protocols?: NetworkTopologyEdge["protocols"],
) => NetworkTopologyEdge;

const makeEdge: MakeEdgeFunction = (
  from: string,
  to: string,
  protocols?: NetworkTopologyEdge["protocols"],
): NetworkTopologyEdge => {
  return { fromNodeId: from, toNodeId: to, protocols: protocols };
};

/* A switch with `count` endpoints attached over FDB, names zero padded. */
interface SwitchWithEndpoints {
  device: NetworkTopologyNode;
  endpoints: Array<NetworkTopologyNode>;
  nodes: Array<NetworkTopologyNode>;
  edges: Array<NetworkTopologyEdge>;
  endpointIds: Array<string>;
}

type MakeSwitchFunction = (id: string, count: number) => SwitchWithEndpoints;

const makeSwitchWithEndpoints: MakeSwitchFunction = (
  id: string,
  count: number,
): SwitchWithEndpoints => {
  const device: NetworkTopologyNode = makeDevice(id);
  const endpoints: Array<NetworkTopologyNode> = [];
  const edges: Array<NetworkTopologyEdge> = [];
  for (let i: number = 0; i < count; i++) {
    const endpointId: string = `endpoint:${id}-${String(i).padStart(3, "0")}`;
    endpoints.push(
      makeEndpoint(endpointId, {
        name: `${id}-${String(i).padStart(3, "0")}`,
      }),
    );
    edges.push(makeEdge(id, endpointId, ["fdb"]));
  }
  return {
    device: device,
    endpoints: endpoints,
    nodes: [device, ...endpoints],
    edges: edges,
    endpointIds: endpoints.map((endpoint: NetworkTopologyNode): string => {
      return endpoint.id;
    }),
  };
};

/*
 * A chain rooted at a managed device with unmanaged links behind it. The
 * head is the only tier-0 node, so the tree really is `length` deep rather
 * than branching from whichever interior node happened to win on degree.
 */
interface ChainGraph {
  nodes: Array<NetworkTopologyNode>;
  edges: Array<NetworkTopologyEdge>;
  ids: Array<string>;
}

type MakeChainFunction = (length: number) => ChainGraph;

const makeChain: MakeChainFunction = (length: number): ChainGraph => {
  const nodes: Array<NetworkTopologyNode> = [makeDevice("core-000")];
  const edges: Array<NetworkTopologyEdge> = [];
  const ids: Array<string> = ["core-000"];
  for (let i: number = 1; i < length; i++) {
    const id: string = `unmanaged:link-${String(i).padStart(4, "0")}`;
    nodes.push(makeUnmanaged(id, { name: `link-${String(i)}` }));
    edges.push(makeEdge(ids[i - 1]!, id, ["lldp"]));
    ids.push(id);
  }
  return { nodes: nodes, edges: edges, ids: ids };
};

type OverlapCountFunction = (
  model: TopologyLayoutModel,
  nodes: Array<NetworkTopologyNode>,
) => number;

const overlapCount: OverlapCountFunction = (
  model: TopologyLayoutModel,
  nodes: Array<NetworkTopologyNode>,
): number => {
  return countNodeOverlaps(
    model.positions,
    canonicalNodeOrder(nodes),
    buildFootprints(nodes),
  );
};

/* The painted horizontal extent of one placed node. */
type InkRangeFunction = (
  model: TopologyLayoutModel,
  footprints: Map<string, TopologyNodeFootprint>,
  nodeId: string,
) => [number, number];

const inkRangeOf: InkRangeFunction = (
  model: TopologyLayoutModel,
  footprints: Map<string, TopologyNodeFootprint>,
  nodeId: string,
): [number, number] => {
  const point: TopologyPoint = model.positions.get(nodeId)!;
  const footprint: TopologyNodeFootprint = footprintOrDefault(
    footprints,
    nodeId,
  );
  return [point.x - footprint.inkHalfWidth, point.x + footprint.inkHalfWidth];
};

type ExpectFiniteModelFunction = (model: TopologyLayoutModel) => void;

const expectEveryNumberFinite: ExpectFiniteModelFunction = (
  model: TopologyLayoutModel,
): void => {
  expect(Number.isFinite(model.contentWidth)).toBe(true);
  expect(Number.isFinite(model.contentHeight)).toBe(true);
  for (const [, point] of model.positions) {
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  }
  for (const box of model.componentBoxes) {
    expect(Number.isFinite(box.x)).toBe(true);
    expect(Number.isFinite(box.y)).toBe(true);
    expect(Number.isFinite(box.width)).toBe(true);
    expect(Number.isFinite(box.height)).toBe(true);
  }
};

type ExpectIdenticalFunction = (
  actual: TopologyLayoutModel,
  expected: TopologyLayoutModel,
) => void;

/* Byte-for-byte, not "close enough": a re-poll must not nudge the map. */
const expectIdenticalPlacement: ExpectIdenticalFunction = (
  actual: TopologyLayoutModel,
  expected: TopologyLayoutModel,
): void => {
  expect(actual.positions.size).toBe(expected.positions.size);
  for (const [id, point] of expected.positions) {
    const other: TopologyPoint | undefined = actual.positions.get(id);
    expect(other).toBeDefined();
    expect(other!.x).toBe(point.x);
    expect(other!.y).toBe(point.y);
  }
  expect(actual.contentWidth).toBe(expected.contentWidth);
  expect(actual.contentHeight).toBe(expected.contentHeight);
  expect(actual.componentBoxes).toEqual(expected.componentBoxes);
};

/* Walk from a node to its root, reporting whether the walk found a loop. */
interface ParentChainWalk {
  chain: Array<string>;
  hitCycle: boolean;
}

type ParentChainFunction = (
  forest: ParentChildForest,
  nodeId: string,
) => ParentChainWalk;

const parentChainOf: ParentChainFunction = (
  forest: ParentChildForest,
  nodeId: string,
): ParentChainWalk => {
  const chain: Array<string> = [];
  const seen: Set<string> = new Set<string>();
  let current: string | undefined = nodeId;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = forest.parentById.get(current);
  }
  // A defined cursor here means the walk came back to somewhere it had been.
  return { chain: chain, hitCycle: current !== undefined };
};

/* Every id reachable from `rootId` by following child lists only. */
type ReachableFunction = (
  forest: ParentChildForest,
  rootId: string,
) => Set<string>;

const reachableFromRoot: ReachableFunction = (
  forest: ParentChildForest,
  rootId: string,
): Set<string> => {
  const seen: Set<string> = new Set<string>([rootId]);
  const stack: Array<string> = [rootId];
  while (stack.length > 0) {
    const current: string = stack.pop()!;
    for (const child of forest.childrenById.get(current) || []) {
      if (!seen.has(child)) {
        seen.add(child);
        stack.push(child);
      }
    }
  }
  return seen;
};

type RotateNodesFunction = (
  items: Array<NetworkTopologyNode>,
  by: number,
) => Array<NetworkTopologyNode>;

const rotateNodes: RotateNodesFunction = (
  items: Array<NetworkTopologyNode>,
  by: number,
): Array<NetworkTopologyNode> => {
  const offset: number = ((by % items.length) + items.length) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
};

type RotateEdgesFunction = (
  items: Array<NetworkTopologyEdge>,
  by: number,
) => Array<NetworkTopologyEdge>;

const rotateEdges: RotateEdgesFunction = (
  items: Array<NetworkTopologyEdge>,
  by: number,
): Array<NetworkTopologyEdge> => {
  const offset: number = ((by % items.length) + items.length) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
};

/*
 * Canonical branch site, and a genuine tree: one router uplinking two
 * switches over LLDP, endpoints hanging off the switches over FDB. The
 * router is the only tier-0 node, so the hierarchy the layout finds must
 * be exactly the hierarchy written here.
 */
const branchNodes: Array<NetworkTopologyNode> = [
  makeDevice("core-01"),
  makeDevice("switch-a"),
  makeDevice("switch-b"),
  makeEndpoint("endpoint:pos-1", { name: "pos-1" }),
  makeEndpoint("endpoint:pos-2", { name: "pos-2" }),
  makeEndpoint("endpoint:pos-3", { name: "pos-3" }),
];

/*
 * Written child-last and out of order on purpose: the forest must be a
 * function of the graph, not of the row order the poll happened to return.
 */
const branchEdges: Array<NetworkTopologyEdge> = [
  makeEdge("switch-b", "endpoint:pos-3", ["fdb"]),
  makeEdge("switch-a", "endpoint:pos-2", ["fdb"]),
  makeEdge("core-01", "switch-b", ["lldp"]),
  makeEdge("switch-a", "endpoint:pos-1", ["fdb"]),
  makeEdge("core-01", "switch-a", ["lldp"]),
];

describe("buildParentChildForest — a clean tree comes back exactly as written", () => {
  const forest: ParentChildForest = buildParentChildForest(
    branchNodes,
    branchEdges,
  );

  test("the router roots the only tree", () => {
    expect(forest.rootIds).toEqual(["core-01"]);
  });

  test("every node's parent is the device it is actually cabled to", () => {
    expect(forest.parentById.get("switch-a")).toBe("core-01");
    expect(forest.parentById.get("switch-b")).toBe("core-01");
    expect(forest.parentById.get("endpoint:pos-1")).toBe("switch-a");
    expect(forest.parentById.get("endpoint:pos-2")).toBe("switch-a");
    expect(forest.parentById.get("endpoint:pos-3")).toBe("switch-b");
    // A root has no entry at all rather than a null one.
    expect(forest.parentById.has("core-01")).toBe(false);
    expect(forest.parentById.size).toBe(branchNodes.length - 1);
  });

  test("children come back in canonical id order, not edge order", () => {
    expect(forest.childrenById.get("core-01")).toEqual([
      "switch-a",
      "switch-b",
    ]);
    // pos-2's edge was listed first; canonical order still puts pos-1 first.
    expect(forest.childrenById.get("switch-a")).toEqual([
      "endpoint:pos-1",
      "endpoint:pos-2",
    ]);
    expect(forest.childrenById.get("switch-b")).toEqual(["endpoint:pos-3"]);
  });

  test("every node has a children entry, leaves included", () => {
    expect(forest.childrenById.size).toBe(branchNodes.length);
    expect(forest.childrenById.get("endpoint:pos-1")).toEqual([]);
    expect(forest.childrenById.get("endpoint:pos-3")).toEqual([]);
  });

  test("the root is depth zero and depth counts cable hops", () => {
    expect(forest.depthById.get("core-01")).toBe(0);
    expect(forest.depthById.get("switch-a")).toBe(1);
    expect(forest.depthById.get("switch-b")).toBe(1);
    expect(forest.depthById.get("endpoint:pos-1")).toBe(2);
    expect(forest.depthById.get("endpoint:pos-3")).toBe(2);
    expect(forest.depthById.size).toBe(branchNodes.length);
  });

  test("a parent is always exactly one level shallower than its child", () => {
    for (const [childId, parentId] of forest.parentById) {
      expect(forest.depthById.get(childId)).toBe(
        forest.depthById.get(parentId)! + 1,
      );
    }
  });

  test("childrenById and parentById describe the same relation", () => {
    for (const [parentId, children] of forest.childrenById) {
      for (const childId of children) {
        expect(forest.parentById.get(childId)).toBe(parentId);
      }
    }
    for (const [childId, parentId] of forest.parentById) {
      expect(forest.childrenById.get(parentId)).toContain(childId);
    }
  });
});

describe("buildParentChildForest — choosing the root", () => {
  test("a two-link router outranks a switch carrying forty endpoints", () => {
    /*
     * The whole reason this layout does not reuse the component's own
     * degree-first rootId: the access switch out-degrees the router 41 to
     * 2, and rooting there would draw the router as a child of the switch.
     */
    const busy: SwitchWithEndpoints = makeSwitchWithEndpoints("switch-a", 40);
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("router-1"),
      makeUnmanaged("unmanaged:ap-1", { name: "ap-1" }),
      ...busy.nodes,
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("router-1", "switch-a", ["lldp"]),
      makeEdge("router-1", "unmanaged:ap-1", ["cdp"]),
      ...busy.edges,
    ];

    const forest: ParentChildForest = buildParentChildForest(nodes, edges);
    expect(forest.rootIds).toEqual(["router-1"]);
    expect(forest.parentById.get("switch-a")).toBe("router-1");
    expect(forest.depthById.get("switch-a")).toBe(1);
    for (const id of busy.endpointIds) {
      expect(forest.parentById.get(id)).toBe("switch-a");
      expect(forest.depthById.get(id)).toBe(2);
    }
  });

  test("degree breaks a tie between two nodes of the same role", () => {
    /*
     * All three are managed with no FDB edges, so all three are tier 0.
     * The hub sorts LAST by id, which is what makes this a degree test
     * rather than an accidental id test.
     */
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("aa-core"),
      makeDevice("bb-core"),
      makeDevice("zz-core"),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("zz-core", "aa-core", ["lldp"]),
      makeEdge("zz-core", "bb-core", ["lldp"]),
    ];

    const forest: ParentChildForest = buildParentChildForest(nodes, edges);
    expect(forest.rootIds).toEqual(["zz-core"]);
    expect(forest.childrenById.get("zz-core")).toEqual(["aa-core", "bb-core"]);
  });

  test("compareNodeIds breaks a full tie on role and degree", () => {
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("core-b"),
      makeDevice("core-a"),
    ];
    const forest: ParentChildForest = buildParentChildForest(nodes, [
      makeEdge("core-b", "core-a", ["lldp"]),
    ]);
    // Same tier, same degree of one: the lower id roots the tree.
    expect(forest.rootIds).toEqual(["core-a"]);
    expect(forest.parentById.get("core-b")).toBe("core-a");
  });

  test("role beats degree even when the switch also sorts first", () => {
    const busy: SwitchWithEndpoints = makeSwitchWithEndpoints("aa-switch", 6);
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("zz-router"),
      ...busy.nodes,
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("zz-router", "aa-switch", ["lldp"]),
      ...busy.edges,
    ];
    expect(buildParentChildForest(nodes, edges).rootIds).toEqual(["zz-router"]);
  });

  test("with no router at all the switch roots its own tree", () => {
    const busy: SwitchWithEndpoints = makeSwitchWithEndpoints("switch-1", 4);
    const forest: ParentChildForest = buildParentChildForest(
      busy.nodes,
      busy.edges,
    );
    expect(forest.rootIds).toEqual(["switch-1"]);
    expect(forest.depthById.get("switch-1")).toBe(0);
  });
});

/*
 * A redundantly cabled distribution block: a ring with two chords, plus a
 * separate triangle. Nothing here is a tree, and the forest must still be
 * one.
 */
const meshNodes: Array<NetworkTopologyNode> = [
  makeDevice("core-01"),
  makeUnmanaged("unmanaged:sw-a", { name: "sw-a" }),
  makeUnmanaged("unmanaged:sw-b", { name: "sw-b" }),
  makeUnmanaged("unmanaged:sw-c", { name: "sw-c" }),
  makeUnmanaged("unmanaged:sw-d", { name: "sw-d" }),
  makeDevice("edge-01"),
  makeDevice("edge-02"),
  makeDevice("edge-03"),
];

const meshEdges: Array<NetworkTopologyEdge> = [
  makeEdge("core-01", "unmanaged:sw-a", ["lldp"]),
  makeEdge("core-01", "unmanaged:sw-d", ["lldp"]),
  makeEdge("unmanaged:sw-a", "unmanaged:sw-b", ["lldp"]),
  makeEdge("unmanaged:sw-b", "unmanaged:sw-c", ["lldp"]),
  makeEdge("unmanaged:sw-c", "unmanaged:sw-d", ["lldp"]),
  makeEdge("unmanaged:sw-a", "unmanaged:sw-c", ["lldp"]),
  makeEdge("unmanaged:sw-b", "unmanaged:sw-d", ["lldp"]),
  makeEdge("edge-01", "edge-02", ["lldp"]),
  makeEdge("edge-02", "edge-03", ["lldp"]),
  makeEdge("edge-03", "edge-01", ["lldp"]),
];

describe("buildParentChildForest — a cyclic graph still yields a tree", () => {
  const forest: ParentChildForest = buildParentChildForest(
    meshNodes,
    meshEdges,
  );

  test("one root per connected component, in canonical order", () => {
    expect(forest.rootIds).toEqual(["core-01", "edge-01"]);
  });

  test("every non-root has exactly one parent", () => {
    expect(forest.parentById.size).toBe(
      meshNodes.length - forest.rootIds.length,
    );
    for (const node of meshNodes) {
      const isRoot: boolean = forest.rootIds.includes(node.id);
      expect(forest.parentById.has(node.id)).toBe(!isRoot);
    }
  });

  test("walking the parent chain terminates at the node's own root", () => {
    for (const node of meshNodes) {
      const walk: ParentChainWalk = parentChainOf(forest, node.id);
      expect(walk.hitCycle).toBe(false);
      const top: string = walk.chain[walk.chain.length - 1]!;
      expect(forest.rootIds).toContain(top);
      // The walk took exactly one step per level, so depth and hops agree.
      expect(walk.chain.length).toBe(forest.depthById.get(node.id)! + 1);
    }
  });

  test("no node is its own ancestor", () => {
    for (const node of meshNodes) {
      const walk: ParentChainWalk = parentChainOf(forest, node.id);
      expect(new Set<string>(walk.chain).size).toBe(walk.chain.length);
      expect(walk.chain.slice(1)).not.toContain(node.id);
    }
  });

  test("every member of a component is reachable from its root", () => {
    const reachedFromCore: Set<string> = reachableFromRoot(forest, "core-01");
    expect(Array.from(reachedFromCore).sort(compareNodeIds)).toEqual([
      "core-01",
      "unmanaged:sw-a",
      "unmanaged:sw-b",
      "unmanaged:sw-c",
      "unmanaged:sw-d",
    ]);
    const reachedFromEdge: Set<string> = reachableFromRoot(forest, "edge-01");
    expect(Array.from(reachedFromEdge).sort(compareNodeIds)).toEqual([
      "edge-01",
      "edge-02",
      "edge-03",
    ]);
  });

  test("a parent is always exactly one level shallower than its child", () => {
    for (const [childId, parentId] of forest.parentById) {
      expect(forest.depthById.get(childId)).toBe(
        forest.depthById.get(parentId)! + 1,
      );
    }
  });

  test("when several neighbours qualify as parent the canonical first wins", () => {
    /*
     * sw-b and sw-c both sit two hops out and both touch sw-a AND sw-d.
     * Picking by id rather than by traversal luck is what stops the tree
     * from re-shaping itself on the next poll.
     */
    expect(forest.depthById.get("unmanaged:sw-b")).toBe(2);
    expect(forest.depthById.get("unmanaged:sw-c")).toBe(2);
    expect(forest.parentById.get("unmanaged:sw-b")).toBe("unmanaged:sw-a");
    expect(forest.parentById.get("unmanaged:sw-c")).toBe("unmanaged:sw-a");
    expect(forest.childrenById.get("unmanaged:sw-d")).toEqual([]);
  });

  test("the chords decide nothing, but the graph still reports them", () => {
    /*
     * The core component is cabled with seven links; a tree over its five
     * nodes has four edges. The other three are the redundant paths, and
     * they are still in the adjacency the renderer draws from — they just
     * do not get to decide where a node goes.
     */
    const adjacency: TopologyAdjacency = buildTopologyAdjacency(
      meshNodes,
      meshEdges,
    );
    const coreLinks: Array<TopologyEdgePair> = adjacency.uniqueEdges.filter(
      (edge: TopologyEdgePair): boolean => {
        return !edge.a.startsWith("edge-");
      },
    );
    expect(coreLinks.length).toBe(7);

    let treeEdgesInCore: number = 0;
    for (const [childId] of forest.parentById) {
      if (!childId.startsWith("edge-")) {
        treeEdgesInCore++;
      }
    }
    expect(treeEdgesInCore).toBe(4);
  });
});

describe("buildParentChildForest — components and islands", () => {
  test("three components yield three roots", () => {
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("core-a"),
      makeDevice("leaf-a"),
      makeDevice("core-b"),
      makeDevice("leaf-b"),
      makeDevice("core-c"),
      makeDevice("leaf-c"),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("core-a", "leaf-a", ["lldp"]),
      makeEdge("core-b", "leaf-b", ["lldp"]),
      makeEdge("core-c", "leaf-c", ["lldp"]),
    ];
    const forest: ParentChildForest = buildParentChildForest(nodes, edges);
    expect(forest.rootIds).toEqual(["core-a", "core-b", "core-c"]);
    expect(forest.parentById.get("leaf-a")).toBe("core-a");
    expect(forest.parentById.get("leaf-b")).toBe("core-b");
    expect(forest.parentById.get("leaf-c")).toBe("core-c");
  });

  test("a device with no links at all is a one-node tree", () => {
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("core-01"),
      makeDevice("switch-a"),
      makeDevice("island-1"),
      makeDevice("island-2"),
    ];
    const forest: ParentChildForest = buildParentChildForest(nodes, [
      makeEdge("core-01", "switch-a", ["lldp"]),
    ]);
    expect(forest.rootIds).toEqual(["core-01", "island-1", "island-2"]);
    for (const id of ["island-1", "island-2"]) {
      expect(forest.depthById.get(id)).toBe(0);
      expect(forest.childrenById.get(id)).toEqual([]);
      expect(forest.parentById.has(id)).toBe(false);
    }
  });

  test("an empty topology has no roots and no relations", () => {
    const forest: ParentChildForest = buildParentChildForest([], []);
    expect(forest.rootIds).toEqual([]);
    expect(forest.parentById.size).toBe(0);
    expect(forest.childrenById.size).toBe(0);
    expect(forest.depthById.size).toBe(0);
  });

  test("edges naming unknown nodes cannot invent a parent", () => {
    const forest: ParentChildForest = buildParentChildForest(
      [makeDevice("switch-a")],
      [
        makeEdge("switch-a", "endpoint:not-in-view", ["fdb"]),
        makeEdge("switch-a", "switch-a", ["lldp"]),
      ],
    );
    expect(forest.rootIds).toEqual(["switch-a"]);
    expect(forest.parentById.size).toBe(0);
    expect(forest.childrenById.get("switch-a")).toEqual([]);
  });

  test("the forest is a pure function of the graph, not of row order", () => {
    const reversed: ParentChildForest = buildParentChildForest(
      [...meshNodes].reverse(),
      [...meshEdges]
        .reverse()
        .map((edge: NetworkTopologyEdge): NetworkTopologyEdge => {
          return makeEdge(edge.toNodeId, edge.fromNodeId, edge.protocols);
        }),
    );
    const original: ParentChildForest = buildParentChildForest(
      meshNodes,
      meshEdges,
    );
    expect(reversed.rootIds).toEqual(original.rootIds);
    expect(reversed.parentById).toEqual(original.parentById);
    expect(reversed.childrenById).toEqual(original.childrenById);
    expect(reversed.depthById).toEqual(original.depthById);
  });
});

/* Balanced three-level tree: one core, three switches, three endpoints each. */
const balancedSwitches: Array<SwitchWithEndpoints> = [
  makeSwitchWithEndpoints("switch-a", 3),
  makeSwitchWithEndpoints("switch-b", 3),
  makeSwitchWithEndpoints("switch-c", 3),
];

const balancedNodes: Array<NetworkTopologyNode> = [
  makeDevice("core-01"),
  ...balancedSwitches[0]!.nodes,
  ...balancedSwitches[1]!.nodes,
  ...balancedSwitches[2]!.nodes,
];

const balancedEdges: Array<NetworkTopologyEdge> = [
  makeEdge("core-01", "switch-a", ["lldp"]),
  makeEdge("core-01", "switch-b", ["lldp"]),
  makeEdge("core-01", "switch-c", ["lldp"]),
  ...balancedSwitches[0]!.edges,
  ...balancedSwitches[1]!.edges,
  ...balancedSwitches[2]!.edges,
];

describe("computeParentChildTopologyModel — the org chart geometry", () => {
  const model: TopologyLayoutModel = computeParentChildTopologyModel(
    balancedNodes,
    balancedEdges,
    WIDTH,
    HEIGHT,
  );
  const forest: ParentChildForest = buildParentChildForest(
    balancedNodes,
    balancedEdges,
  );

  test("places every node exactly once with finite coordinates", () => {
    expect(model.positions.size).toBe(balancedNodes.length);
    expectEveryNumberFinite(model);
  });

  test("every child sits exactly one level gap below its parent", () => {
    for (const [childId, parentId] of forest.parentById) {
      const child: TopologyPoint = model.positions.get(childId)!;
      const parent: TopologyPoint = model.positions.get(parentId)!;
      expect(child.y - parent.y).toBe(PARENT_CHILD_LEVEL_GAP);
    }
  });

  test("a leaf never sits above its own parent", () => {
    for (const [nodeId, children] of forest.childrenById) {
      if (children.length > 0) {
        continue;
      }
      const parentId: string | undefined = forest.parentById.get(nodeId);
      if (!parentId) {
        continue;
      }
      expect(model.positions.get(nodeId)!.y).toBeGreaterThan(
        model.positions.get(parentId)!.y,
      );
    }
  });

  test("every node at one depth shares one row", () => {
    const yByDepth: Map<number, number> = new Map<number, number>();
    for (const [nodeId, depth] of forest.depthById) {
      const y: number = model.positions.get(nodeId)!.y;
      if (!yByDepth.has(depth)) {
        yByDepth.set(depth, y);
      }
      expect(y).toBe(yByDepth.get(depth));
    }
    expect(yByDepth.size).toBe(3);
  });

  test("a parent is centred over its first and last child", () => {
    for (const [parentId, children] of forest.childrenById) {
      if (children.length === 0) {
        continue;
      }
      const first: number = model.positions.get(children[0]!)!.x;
      const last: number = model.positions.get(
        children[children.length - 1]!,
      )!.x;
      expect(model.positions.get(parentId)!.x).toBeCloseTo(
        (first + last) / 2,
        6,
      );
    }
  });

  test("siblings run left to right in canonical id order", () => {
    for (const [, children] of forest.childrenById) {
      for (let i: number = 1; i < children.length; i++) {
        expect(compareNodeIds(children[i - 1]!, children[i]!)).toBeLessThan(0);
        expect(model.positions.get(children[i]!)!.x).toBeGreaterThan(
          model.positions.get(children[i - 1]!)!.x,
        );
      }
    }
  });

  test("a subtree occupies its own horizontal band, never a sibling's", () => {
    const footprints: Map<string, TopologyNodeFootprint> =
      buildFootprints(balancedNodes);
    const spans: Array<[number, number]> = balancedSwitches.map(
      (group: SwitchWithEndpoints): [number, number] => {
        const ids: Array<string> = [group.device.id, ...group.endpointIds];
        let min: number = Infinity;
        let max: number = -Infinity;
        for (const id of ids) {
          const range: [number, number] = inkRangeOf(model, footprints, id);
          min = Math.min(min, range[0]);
          max = Math.max(max, range[1]);
        }
        return [min, max];
      },
    );
    for (let i: number = 1; i < spans.length; i++) {
      expect(spans[i]![0] - spans[i - 1]![1]).toBeGreaterThanOrEqual(
        PARENT_CHILD_SIBLING_GAP - EPSILON,
      );
    }
  });

  test("the parent-child mode reports no tiered group boxes", () => {
    expect(model.groups).toEqual([]);
  });

  test("the content box never shrinks below the frame it was given", () => {
    expect(model.contentWidth).toBeGreaterThanOrEqual(WIDTH);
    expect(model.contentHeight).toBeGreaterThanOrEqual(HEIGHT);
  });

  test("the painted extent is centred inside the reported content box", () => {
    const footprints: Map<string, TopologyNodeFootprint> =
      buildFootprints(balancedNodes);
    let minX: number = Infinity;
    let maxX: number = -Infinity;
    let minY: number = Infinity;
    let maxY: number = -Infinity;
    for (const node of balancedNodes) {
      const point: TopologyPoint = model.positions.get(node.id)!;
      const footprint: TopologyNodeFootprint = footprintOrDefault(
        footprints,
        node.id,
      );
      minX = Math.min(minX, point.x - footprint.inkHalfWidth);
      maxX = Math.max(maxX, point.x + footprint.inkHalfWidth);
      minY = Math.min(minY, point.y - footprint.halfHeight);
      maxY = Math.max(maxY, point.y + footprint.labelBottom);
    }
    expect((minX + maxX) / 2).toBeCloseTo(model.contentWidth / 2, 6);
    expect((minY + maxY) / 2).toBeCloseTo(model.contentHeight / 2, 6);
  });
});

describe("computeParentChildTopologyModel — glyphs never overlap", () => {
  test("a balanced three-level tree", () => {
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      balancedNodes,
      balancedEdges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(balancedNodes.length);
    expect(overlapCount(model, balancedNodes)).toBe(0);
    expectEveryNumberFinite(model);
  });

  test("one switch fanning out three hundred endpoints", () => {
    const wide: SwitchWithEndpoints = makeSwitchWithEndpoints("switch-01", 300);
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      wide.nodes,
      wide.edges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(301);
    expect(overlapCount(model, wide.nodes)).toBe(0);
    // The frame is a preference: a 300-wide fan is allowed to exceed it.
    expect(model.contentWidth).toBeGreaterThan(WIDTH);
    expectEveryNumberFinite(model);
  });

  test("a fifty-device chain", () => {
    const chain: ChainGraph = makeChain(50);
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      chain.nodes,
      chain.edges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(50);
    expect(overlapCount(model, chain.nodes)).toBe(0);
    // One node per level, so the chain is fifty levels tall.
    const forest: ParentChildForest = buildParentChildForest(
      chain.nodes,
      chain.edges,
    );
    expect(forest.depthById.get(chain.ids[49]!)).toBe(49);
    expect(
      model.positions.get(chain.ids[49]!)!.y -
        model.positions.get(chain.ids[0]!)!.y,
    ).toBe(PARENT_CHILD_LEVEL_GAP * 49);
  });

  test("three separate components on one map", () => {
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      meshNodes,
      meshEdges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(meshNodes.length);
    expect(overlapCount(model, meshNodes)).toBe(0);

    const islandNodes: Array<NetworkTopologyNode> = [
      ...meshNodes,
      makeDevice("solo-a"),
      makeDevice("solo-b"),
    ];
    const islandModel: TopologyLayoutModel = computeParentChildTopologyModel(
      islandNodes,
      [...meshEdges, makeEdge("solo-a", "solo-b", ["lldp"])],
      WIDTH,
      HEIGHT,
    );
    expect(overlapCount(islandModel, islandNodes)).toBe(0);
  });

  test("trees mixed with devices that report no neighbours at all", () => {
    const nodes: Array<NetworkTopologyNode> = [...balancedNodes];
    for (let i: number = 0; i < 17; i++) {
      nodes.push(
        makeDevice(`island-${String(i).padStart(2, "0")}`, {
          name: `island-${String(i)}`,
        }),
      );
    }
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      nodes,
      balancedEdges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(nodes.length);
    expect(overlapCount(model, nodes)).toBe(0);
    expectEveryNumberFinite(model);
  });

  test("a very wide parent beside a narrow subtree keeps its ink at home", () => {
    /*
     * THE CASE THE BAND CLAMPING EXISTS FOR. `aa-switch` carries a name
     * almost twice as wide as its own subtree, so centring it over its one
     * tiny child would hang half its label out past the band and paint it
     * straight over `bb-peer`'s branch. Widening the band and shifting it
     * back is what keeps that overhang inside its own territory.
     */
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("core-01", { name: "core" }),
      makeDevice("aa-switch", { name: "Distribution Switch Building C" }),
      makeEndpoint("endpoint:aa-leaf", { name: "" }),
      makeUnmanaged("bb-peer", { name: "bb" }),
      makeEndpoint("endpoint:bb-1", { name: "b1" }),
      makeEndpoint("endpoint:bb-2", { name: "b2" }),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("core-01", "aa-switch", ["lldp"]),
      makeEdge("core-01", "bb-peer", ["cdp"]),
      makeEdge("aa-switch", "endpoint:aa-leaf", ["fdb"]),
      makeEdge("bb-peer", "endpoint:bb-1", ["fdb"]),
      makeEdge("bb-peer", "endpoint:bb-2", ["fdb"]),
    ];

    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    const footprints: Map<string, TopologyNodeFootprint> =
      buildFootprints(nodes);

    // The premise: the parent really is wider than its whole subtree below.
    const wideRange: [number, number] = inkRangeOf(
      model,
      footprints,
      "aa-switch",
    );
    const childRange: [number, number] = inkRangeOf(
      model,
      footprints,
      "endpoint:aa-leaf",
    );
    expect(wideRange[1] - wideRange[0]).toBeGreaterThan(
      (childRange[1] - childRange[0]) * 4,
    );

    // The assertion: no part of that label reaches the neighbouring branch.
    const neighbourIds: Array<string> = [
      "bb-peer",
      "endpoint:bb-1",
      "endpoint:bb-2",
    ];
    let neighbourLeft: number = Infinity;
    for (const id of neighbourIds) {
      neighbourLeft = Math.min(
        neighbourLeft,
        inkRangeOf(model, footprints, id)[0],
      );
    }
    expect(neighbourLeft - wideRange[1]).toBeGreaterThanOrEqual(
      PARENT_CHILD_SIBLING_GAP - EPSILON,
    );

    // ...and the narrow child is still centred under its oversized parent.
    expect(model.positions.get("endpoint:aa-leaf")!.x).toBeCloseTo(
      model.positions.get("aa-switch")!.x,
      6,
    );
    expect(overlapCount(model, nodes)).toBe(0);
  });

  test("separate trees never overlap each other, in x or in y", () => {
    const nodes: Array<NetworkTopologyNode> = [
      ...meshNodes,
      makeDevice("solo-1"),
      makeDevice("solo-2"),
    ];
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      nodes,
      meshEdges,
      WIDTH,
      HEIGHT,
    );
    const boxes: Array<TopologyComponentBox> = model.componentBoxes;
    expect(boxes.length).toBeGreaterThan(1);
    for (let i: number = 0; i < boxes.length; i++) {
      for (let j: number = i + 1; j < boxes.length; j++) {
        const a: TopologyComponentBox = boxes[i]!;
        const b: TopologyComponentBox = boxes[j]!;
        const disjointX: boolean =
          a.x + a.width <= b.x + EPSILON || b.x + b.width <= a.x + EPSILON;
        const disjointY: boolean =
          a.y + a.height <= b.y + EPSILON || b.y + b.height <= a.y + EPSILON;
        expect(disjointX || disjointY).toBe(true);
      }
    }
  });

  test("trees sharing a shelf are a full tree gap apart horizontally", () => {
    /*
     * A frame wide enough that the shelf packer never wraps, so every tree
     * is on one row and the gap between them is the horizontal one.
     */
    const wideFrame: number = 6000;
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      meshNodes,
      meshEdges,
      wideFrame,
      HEIGHT,
    );
    const ordered: Array<TopologyComponentBox> = [...model.componentBoxes].sort(
      (a: TopologyComponentBox, b: TopologyComponentBox): number => {
        return a.x - b.x;
      },
    );
    expect(ordered.length).toBe(2);
    for (let i: number = 1; i < ordered.length; i++) {
      expect(
        ordered[i]!.x - (ordered[i - 1]!.x + ordered[i - 1]!.width),
      ).toBeCloseTo(PARENT_CHILD_TREE_GAP, 6);
    }
  });
});

describe("computeParentChildTopologyModel — determinism", () => {
  const original: TopologyLayoutModel = computeParentChildTopologyModel(
    balancedNodes,
    balancedEdges,
    WIDTH,
    HEIGHT,
  );

  test("identical input yields identical coordinates", () => {
    expectIdenticalPlacement(
      computeParentChildTopologyModel(
        balancedNodes,
        balancedEdges,
        WIDTH,
        HEIGHT,
      ),
      original,
    );
  });

  test("reversing the node and edge arrays changes nothing", () => {
    expectIdenticalPlacement(
      computeParentChildTopologyModel(
        [...balancedNodes].reverse(),
        [...balancedEdges].reverse(),
        WIDTH,
        HEIGHT,
      ),
      original,
    );
  });

  test("rotating the node and edge arrays changes nothing", () => {
    /*
     * A rotation is the shape a re-poll actually takes — the same rows in
     * the same cyclic order, starting somewhere else — so this is the case
     * that would flap the map every sixty seconds if any decision here
     * were keyed off array position.
     */
    for (const by of [1, 5, 13]) {
      expectIdenticalPlacement(
        computeParentChildTopologyModel(
          rotateNodes(balancedNodes, by),
          rotateEdges(balancedEdges, by),
          WIDTH,
          HEIGHT,
        ),
        original,
      );
    }
  });

  test("flipping every edge's direction changes nothing", () => {
    expectIdenticalPlacement(
      computeParentChildTopologyModel(
        balancedNodes,
        balancedEdges.map((edge: NetworkTopologyEdge): NetworkTopologyEdge => {
          return makeEdge(edge.toNodeId, edge.fromNodeId, edge.protocols);
        }),
        WIDTH,
        HEIGHT,
      ),
      original,
    );
  });

  test("a link reported twice does not shift the layout", () => {
    expectIdenticalPlacement(
      computeParentChildTopologyModel(
        balancedNodes,
        [
          ...balancedEdges,
          makeEdge("switch-a", "core-01", ["cdp"]),
          makeEdge("core-01", "switch-a", ["lldp"]),
        ],
        WIDTH,
        HEIGHT,
      ),
      original,
    );
  });

  test("a cyclic, multi-component graph is just as stable", () => {
    const mesh: TopologyLayoutModel = computeParentChildTopologyModel(
      meshNodes,
      meshEdges,
      WIDTH,
      HEIGHT,
    );
    expectIdenticalPlacement(
      computeParentChildTopologyModel(
        rotateNodes([...meshNodes].reverse(), 3),
        rotateEdges(
          meshEdges.map((edge: NetworkTopologyEdge): NetworkTopologyEdge => {
            return makeEdge(edge.toNodeId, edge.fromNodeId, edge.protocols);
          }),
          4,
        ),
        WIDTH,
        HEIGHT,
      ),
      mesh,
    );
  });

  test("islands stay put when a new island is discovered", () => {
    /*
     * The shelf packer is Next-Fit-Decreasing-Height precisely so this
     * holds: a newly discovered island must not relocate the trees that
     * were already on the map.
     */
    const withIslands: TopologyLayoutModel = computeParentChildTopologyModel(
      [...balancedNodes, makeDevice("island-a")],
      balancedEdges,
      WIDTH,
      HEIGHT,
    );
    const withMoreIslands: TopologyLayoutModel =
      computeParentChildTopologyModel(
        [...balancedNodes, makeDevice("island-a"), makeDevice("island-b")],
        balancedEdges,
        WIDTH,
        HEIGHT,
      );
    // The tree's own shape is unchanged; only the strip below it grew.
    for (const node of balancedNodes) {
      const a: TopologyPoint = withIslands.positions.get(node.id)!;
      const b: TopologyPoint = withMoreIslands.positions.get(node.id)!;
      expect(b.x - a.x).toBeCloseTo(
        withMoreIslands.positions.get("core-01")!.x -
          withIslands.positions.get("core-01")!.x,
        6,
      );
      expect(b.y - a.y).toBeCloseTo(
        withMoreIslands.positions.get("core-01")!.y -
          withIslands.positions.get("core-01")!.y,
        6,
      );
    }
  });

  /*
   * Two trees side by side on one shelf. Their SHAPE changes constantly —
   * a till comes online and its tree grows a level, a switch is patched
   * and its tree grows a column — and none of that is a fact about which
   * tree is which. A reader who learned "the warehouse is on the left"
   * must not have to relearn it every sixty seconds.
   */
  const twoTreeNodes: Array<NetworkTopologyNode> = [
    makeDevice("core-a"),
    makeDevice("switch-a1"),
    makeDevice("core-b"),
    makeDevice("switch-b1"),
  ];
  const twoTreeEdges: Array<NetworkTopologyEdge> = [
    makeEdge("core-a", "switch-a1", ["lldp"]),
    makeEdge("core-b", "switch-b1", ["lldp"]),
  ];

  type TreeOrderFunction = (
    nodes: Array<NetworkTopologyNode>,
    edges: Array<NetworkTopologyEdge>,
  ) => Array<string>;

  /* The root ids of the packed trees, left to right across the map. */
  const treesLeftToRight: TreeOrderFunction = (
    nodes: Array<NetworkTopologyNode>,
    edges: Array<NetworkTopologyEdge>,
  ): Array<string> => {
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    return [...model.componentBoxes]
      .filter((box: TopologyComponentBox): boolean => {
        return !box.isUnlinked;
      })
      .sort((a: TopologyComponentBox, b: TopologyComponentBox): number => {
        return a.x - b.x;
      })
      .map((box: TopologyComponentBox): string => {
        return box.key;
      });
  };

  test("a tree that gains a level keeps its side of the map", () => {
    expect(treesLeftToRight(twoTreeNodes, twoTreeEdges)).toEqual([
      "core-a",
      "core-b",
    ]);

    /*
     * One POS terminal discovered under tree B. That deepens B by a whole
     * level gap, which under a height-ordered pack is enough to send B to
     * the head of the shelf and move every node on the map.
     */
    const grown: Array<string> = treesLeftToRight(
      [...twoTreeNodes, makeEndpoint("endpoint:pos-1", { name: "pos-1" })],
      [...twoTreeEdges, makeEdge("switch-b1", "endpoint:pos-1", ["fdb"])],
    );
    expect(grown).toEqual(["core-a", "core-b"]);
  });

  test("a tree that gains a sibling column keeps its side of the map", () => {
    /*
     * The same failure through the packer's width tie-break rather than
     * its height sort: one more switch patched into core-b widens B past
     * A without changing its depth at all.
     */
    expect(
      treesLeftToRight(
        [...twoTreeNodes, makeDevice("switch-b2")],
        [...twoTreeEdges, makeEdge("core-b", "switch-b2", ["lldp"])],
      ),
    ).toEqual(["core-a", "core-b"]);
  });

  test("the left-to-right order survives a tree growing on either side", () => {
    /*
     * Symmetry check, so the fix cannot be "A happens to sort first".
     * Growing tree A instead must leave the order alone just as firmly.
     */
    expect(
      treesLeftToRight(
        [...twoTreeNodes, makeEndpoint("endpoint:pos-2", { name: "pos-2" })],
        [...twoTreeEdges, makeEdge("switch-a1", "endpoint:pos-2", ["fdb"])],
      ),
    ).toEqual(["core-a", "core-b"]);
  });
});

describe("computeParentChildTopologyModel — pinned nodes", () => {
  const unpinned: TopologyLayoutModel = computeParentChildTopologyModel(
    balancedNodes,
    balancedEdges,
    WIDTH,
    HEIGHT,
  );

  test("a pinned node lands exactly on its pin, even on top of a neighbour", () => {
    const onTopOfSwitchA: TopologyPoint = unpinned.positions.get("switch-a")!;
    const pinned: ReadonlyMap<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >([["switch-c", { x: onTopOfSwitchA.x, y: onTopOfSwitchA.y }]]);
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      balancedNodes,
      balancedEdges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    // The user dropped it there; the tidy-tree pass does not tidy it away.
    expect(model.positions.get("switch-c")).toEqual(onTopOfSwitchA);
  });

  test("pinning one node leaves every other node exactly where it was", () => {
    const pinned: ReadonlyMap<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >([["switch-b", { x: 42, y: 43 }]]);
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      balancedNodes,
      balancedEdges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    expect(model.positions.get("switch-b")).toEqual({ x: 42, y: 43 });
    for (const node of balancedNodes) {
      if (node.id === "switch-b") {
        continue;
      }
      expect(model.positions.get(node.id)).toEqual(
        unpinned.positions.get(node.id),
      );
    }
  });

  test("a pin outside the computed extent grows the content box", () => {
    const pinned: ReadonlyMap<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >([["core-01", { x: 5000, y: 4000 }]]);
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      balancedNodes,
      balancedEdges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    const footprint: TopologyNodeFootprint = footprintOrDefault(
      buildFootprints(balancedNodes),
      "core-01",
    );
    expect(model.contentWidth).toBeCloseTo(
      5000 + footprint.inkHalfWidth + PARENT_CHILD_LAYOUT_MARGIN,
      6,
    );
    expect(model.contentHeight).toBeCloseTo(
      4000 + footprint.labelBottom + PARENT_CHILD_LAYOUT_MARGIN,
      6,
    );
  });

  test("a pin inside the computed extent does not shrink the content box", () => {
    const pinned: ReadonlyMap<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >([["core-01", { x: 10, y: 10 }]]);
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      balancedNodes,
      balancedEdges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    expect(model.contentWidth).toBe(unpinned.contentWidth);
    expect(model.contentHeight).toBe(unpinned.contentHeight);
  });

  test("a pin for a node that left the graph adds no placement", () => {
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      balancedNodes,
      balancedEdges,
      WIDTH,
      HEIGHT,
      new Map<string, TopologyPoint>([["endpoint:gone", { x: 5, y: 6 }]]),
    );
    expect(model.positions.has("endpoint:gone")).toBe(false);
    expect(model.positions.size).toBe(balancedNodes.length);
    expect(model.contentWidth).toBe(unpinned.contentWidth);
  });

  test("a non-finite pin is ignored rather than blanking the node", () => {
    const pinned: ReadonlyMap<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >([
      ["switch-a", { x: Number.NaN, y: 10 }],
      ["switch-b", { x: 10, y: Number.POSITIVE_INFINITY }],
      ["switch-c", { x: Number.NEGATIVE_INFINITY, y: Number.NaN }],
    ]);
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      balancedNodes,
      balancedEdges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    for (const id of ["switch-a", "switch-b", "switch-c"]) {
      expect(model.positions.get(id)).toEqual(unpinned.positions.get(id));
    }
    expect(model.contentWidth).toBe(unpinned.contentWidth);
    expect(model.contentHeight).toBe(unpinned.contentHeight);
    expectEveryNumberFinite(model);
  });

  test("an empty pin map behaves exactly like no pin map", () => {
    expectIdenticalPlacement(
      computeParentChildTopologyModel(
        balancedNodes,
        balancedEdges,
        WIDTH,
        HEIGHT,
        new Map<string, TopologyPoint>(),
      ),
      unpinned,
    );
  });
});

describe("computeParentChildTopologyModel — component boxes", () => {
  const islandIds: Array<string> = ["zz-island-1", "zz-island-2"];
  const boxNodes: Array<NetworkTopologyNode> = [
    makeDevice("core-01"),
    makeDevice("switch-a"),
    makeEndpoint("endpoint:pos-1", { name: "pos-1" }),
    makeDevice("edge-01"),
    makeDevice("edge-02"),
    ...islandIds.map((id: string): NetworkTopologyNode => {
      return makeDevice(id, { name: id });
    }),
  ];
  const boxEdges: Array<NetworkTopologyEdge> = [
    makeEdge("core-01", "switch-a", ["lldp"]),
    makeEdge("switch-a", "endpoint:pos-1", ["fdb"]),
    makeEdge("edge-01", "edge-02", ["lldp"]),
  ];
  const model: TopologyLayoutModel = computeParentChildTopologyModel(
    boxNodes,
    boxEdges,
    WIDTH,
    HEIGHT,
  );

  test("one box per linked tree, keyed by that tree's root id", () => {
    const keys: Array<string> = model.componentBoxes
      .map((box: TopologyComponentBox): string => {
        return box.key;
      })
      .sort(compareNodeIds);
    expect(keys).toEqual(["core-01", "edge-01", UNLINKED_BOX_KEY]);
  });

  test("a tree's box lists exactly that tree's members", () => {
    const coreBox: TopologyComponentBox = model.componentBoxes.find(
      (box: TopologyComponentBox): boolean => {
        return box.key === "core-01";
      },
    )!;
    expect([...coreBox.nodeIds].sort(compareNodeIds)).toEqual([
      "core-01",
      "endpoint:pos-1",
      "switch-a",
    ]);
    expect(coreBox.nodeCount).toBe(3);
    expect(coreBox.isUnlinked).toBe(false);
  });

  test("the unlinked strip is flagged and keyed as the strip", () => {
    const strip: TopologyComponentBox = model.componentBoxes.find(
      (box: TopologyComponentBox): boolean => {
        return box.isUnlinked;
      },
    )!;
    expect(strip.key).toBe(UNLINKED_BOX_KEY);
    expect([...strip.nodeIds].sort(compareNodeIds)).toEqual(islandIds);
    expect(strip.nodeCount).toBe(islandIds.length);
  });

  test("every node belongs to exactly one box", () => {
    const seen: Array<string> = [];
    for (const box of model.componentBoxes) {
      seen.push(...box.nodeIds);
    }
    expect(seen.length).toBe(boxNodes.length);
    expect(seen.slice().sort(compareNodeIds)).toEqual(
      canonicalNodeOrder(boxNodes),
    );
  });

  test("a box actually contains its own members' positions", () => {
    for (const box of model.componentBoxes) {
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      for (const id of box.nodeIds) {
        const point: TopologyPoint = model.positions.get(id)!;
        expect(point.x).toBeGreaterThanOrEqual(box.x - EPSILON);
        expect(point.x).toBeLessThanOrEqual(box.x + box.width + EPSILON);
        expect(point.y).toBeGreaterThanOrEqual(box.y - EPSILON);
        expect(point.y).toBeLessThanOrEqual(box.y + box.height + EPSILON);
      }
    }
  });

  test("a graph with no islands reports no strip", () => {
    const noIslands: TopologyLayoutModel = computeParentChildTopologyModel(
      balancedNodes,
      balancedEdges,
      WIDTH,
      HEIGHT,
    );
    expect(noIslands.componentBoxes.length).toBe(1);
    expect(noIslands.componentBoxes[0]!.key).toBe("core-01");
    expect(noIslands.componentBoxes[0]!.isUnlinked).toBe(false);
  });

  test("a graph of nothing but islands is one strip", () => {
    const islands: Array<NetworkTopologyNode> = [
      makeDevice("solo-a"),
      makeDevice("solo-b"),
      makeDevice("solo-c"),
    ];
    const stripOnly: TopologyLayoutModel = computeParentChildTopologyModel(
      islands,
      [],
      WIDTH,
      HEIGHT,
    );
    expect(stripOnly.componentBoxes.length).toBe(1);
    expect(stripOnly.componentBoxes[0]!.isUnlinked).toBe(true);
    expect(stripOnly.componentBoxes[0]!.nodeCount).toBe(3);
    expect(overlapCount(stripOnly, islands)).toBe(0);
  });
});

describe("computeParentChildTopologyModel — degenerate and hostile input", () => {
  test("empty input returns an empty map and the frame it was given", () => {
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      [],
      [],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(0);
    expect(model.componentBoxes).toEqual([]);
    expect(model.groups).toEqual([]);
    expect(model.contentWidth).toBe(WIDTH);
    expect(model.contentHeight).toBe(HEIGHT);
  });

  test("a zero, negative or non-finite frame falls back to 1000 by 700", () => {
    const frames: Array<[number, number]> = [
      [0, 0],
      [-10, -10],
      [Number.NaN, Number.NaN],
      [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    ];
    for (const [frameWidth, frameHeight] of frames) {
      const empty: TopologyLayoutModel = computeParentChildTopologyModel(
        [],
        [],
        frameWidth,
        frameHeight,
      );
      expect(empty.contentWidth).toBe(1000);
      expect(empty.contentHeight).toBe(700);

      const populated: TopologyLayoutModel = computeParentChildTopologyModel(
        balancedNodes,
        balancedEdges,
        frameWidth,
        frameHeight,
      );
      expect(populated.contentWidth).toBeGreaterThanOrEqual(1000);
      expect(populated.contentHeight).toBeGreaterThanOrEqual(700);
      expect(populated.positions.size).toBe(balancedNodes.length);
      expectEveryNumberFinite(populated);
    }
  });

  test("duplicate node ids collapse to one placement", () => {
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      [...balancedNodes, makeDevice("switch-a"), makeDevice("core-01")],
      balancedEdges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(balancedNodes.length);
    expect(overlapCount(model, balancedNodes)).toBe(0);
  });

  test("a self-loop is not a link, so the device is still an island", () => {
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      [makeDevice("switch-a"), makeDevice("switch-b")],
      [
        makeEdge("switch-a", "switch-a", ["lldp"]),
        makeEdge("switch-b", "switch-b", ["fdb"]),
      ],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(2);
    expect(model.componentBoxes.length).toBe(1);
    expect(model.componentBoxes[0]!.isUnlinked).toBe(true);
    expectEveryNumberFinite(model);
  });

  test("edges naming nodes outside the view add no phantom placements", () => {
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      [makeDevice("switch-a")],
      [
        makeEdge("switch-a", "endpoint:not-in-view", ["fdb"]),
        makeEdge("endpoint:also-gone", "endpoint:not-in-view", ["fdb"]),
      ],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(1);
    expect(model.positions.has("endpoint:not-in-view")).toBe(false);
    expectEveryNumberFinite(model);
  });

  test("a node with an empty id is dropped, an unnamed node still places", () => {
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("switch-1", { name: "" }),
      makeDevice("", { name: "ghost" }),
      makeEndpoint("endpoint:x", { name: "" }),
    ];
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      nodes,
      [makeEdge("switch-1", "endpoint:x", ["fdb"])],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(2);
    expect(model.positions.has("")).toBe(false);
    expect(
      model.positions.get("endpoint:x")!.y - model.positions.get("switch-1")!.y,
    ).toBe(PARENT_CHILD_LEVEL_GAP);
    expect(overlapCount(model, nodes)).toBe(0);
  });

  test("a null edge in the payload is skipped rather than thrown on", () => {
    const edges: Array<NetworkTopologyEdge> = [
      ...balancedEdges,
      null as unknown as NetworkTopologyEdge,
    ];
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      balancedNodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(balancedNodes.length);
    expectEveryNumberFinite(model);
  });

  test("a single node alone in the view sits centred and finite", () => {
    const only: NetworkTopologyNode = makeDevice("core-01");
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      [only],
      [],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(1);
    expect(model.positions.get("core-01")!.x).toBeCloseTo(
      model.contentWidth / 2,
      6,
    );
    expectEveryNumberFinite(model);
  });

  test("a two-thousand-device chain returns instead of blowing the stack", () => {
    const chain: ChainGraph = makeChain(2000);
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      chain.nodes,
      chain.edges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(2000);
    expectEveryNumberFinite(model);
    // Two thousand levels of hierarchy, drawn as two thousand rows.
    expect(
      model.positions.get(chain.ids[1999]!)!.y -
        model.positions.get(chain.ids[0]!)!.y,
    ).toBe(PARENT_CHILD_LEVEL_GAP * 1999);
    expect(model.contentHeight).toBeGreaterThan(PARENT_CHILD_LEVEL_GAP * 1999);
  });

  test("no coordinate is ever NaN or Infinity, whatever the input", () => {
    const scenarios: Array<TopologyLayoutModel> = [
      computeParentChildTopologyModel([], [], Number.NaN, Number.NaN),
      computeParentChildTopologyModel(balancedNodes, balancedEdges, 0, 0),
      computeParentChildTopologyModel(meshNodes, meshEdges, WIDTH, HEIGHT),
      computeParentChildTopologyModel(
        [makeDevice("switch-a")],
        [makeEdge("switch-a", "switch-a", ["lldp"])],
        WIDTH,
        HEIGHT,
      ),
      computeParentChildTopologyModel(
        balancedNodes,
        balancedEdges,
        WIDTH,
        HEIGHT,
        new Map<string, TopologyPoint>([
          ["core-01", { x: Number.NaN, y: Number.NaN }],
          ["switch-a", { x: Number.POSITIVE_INFINITY, y: 1 }],
        ]),
      ),
    ];
    for (const model of scenarios) {
      expectEveryNumberFinite(model);
    }
  });
});
