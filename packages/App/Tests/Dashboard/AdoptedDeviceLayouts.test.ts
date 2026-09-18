import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  ParentChildForest,
  buildDeclaredParentMap,
  buildParentChildForest,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/ParentChildTopologyLayout";
import {
  RADIAL_CORE_RADIUS,
  RADIAL_RING_MIN_GAP,
  computeRadialTopologyModel,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/RadialTopologyLayout";
import { countNodeOverlaps } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyCollision";
import { buildFootprints } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyFootprint";
import {
  TopologyPoint,
  canonicalNodeOrder,
  compareNodeIds,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";
import {
  TIERED_NODE_SPACING,
  TieredTopologyModel,
  TopologyGroupBox,
  computeTieredTopologyLayoutModel,
  computeTieredTopologyModel,
  tierForNode,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyLayout";
import { TopologyLayoutModel } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyModel";
import { NODE_STATUS_COLORS } from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyMeta";
import {
  ALL_NODE_KINDS,
  TopologyEdgeView,
  TopologyNodeKind,
  TopologyNodeView,
  TopologyViewModel,
  TopologyViewModelInput,
  buildTopologyViewModel,
  kindOfNode,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyViewModel";
import {
  TopologyHealthState,
  TopologyHealthVisibility,
  healthStateByNodeId,
  healthStateForNode,
  nodeIdsWithDownLinks,
  resolveHealthVisibility,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyHealthFilter";

/*
 * A managed device on an FDB edge — issue #3489.
 *
 * A ping-only register, phone or kiosk speaks no LLDP, so until now its
 * cable had to be drawn by hand. But the switch it hangs off already
 * reports its MAC in the forwarding table, and the builder now matches
 * that row to the device (by declared MAC, or by ARP address within the
 * site) and draws the attachment as an "fdb" edge to the device's OWN
 * node — with the switch declared as the parent, because a forwarding
 * table learning a MAC on an access port is a statement that the device
 * hangs off it.
 *
 * Every layout and every reader below was written when an fdb edge
 * meant "switch to endpoint node" and nothing else. These tests pin what
 * each of them does when the far end is a managed device instead: the
 * radial layout, whose parent rule needed the declaration (a device on
 * the same rank as its switch had no parent one ring in and was drawn as
 * an orphan root ON the switch ring); the parent-child forest, which
 * already honoured a declared parent and must keep doing so on this
 * edge; the tiered layout, which must NOT sweep a managed device into a
 * switch's endpoint box; the view model, which must keep drawing the
 * device as a device on a learned-looking cable; and the health filter,
 * which must degrade the device when its switch port is dark — the rule
 * that exempts endpoints exists because they have no ports, and a
 * managed device does.
 */

const WIDTH: number = 1000;
const HEIGHT: number = 700;

/* The dash the view model paints on a learned attachment. */
const FDB_EDGE_DASH: string = "3 3";
const DOWN_EDGE_DASH: string = "6 4";

const SWITCH_ID: string = "sw";
const REGISTER_ID: string = "pos";
const ROUTER_ID: string = "router";
const REGISTER_MAC: string = "aa:bb:cc:dd:ee:ff";
const REGISTER_IP: string = "10.0.0.12";
const REGISTER_VLAN: number = 12;
const SWITCH_PORT: string = "Gi1/0/7";

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
  overrides?: Partial<NetworkTopologyEdge>,
) => NetworkTopologyEdge;

const makeEdge: MakeEdgeFunction = (
  from: string,
  to: string,
  overrides?: Partial<NetworkTopologyEdge>,
): NetworkTopologyEdge => {
  return {
    fromNodeId: from,
    toNodeId: to,
    ...overrides,
  };
};

/*
 * The edge the builder draws for an adopted endpoint row, field for field:
 * switch at the from end, the learned port on it, "fdb" as the only
 * protocol, and the switch declared as the parent.
 */
type MakeAdoptionEdgeFunction = (
  switchId: string,
  deviceId: string,
  overrides?: Partial<NetworkTopologyEdge>,
) => NetworkTopologyEdge;

const makeAdoptionEdge: MakeAdoptionEdgeFunction = (
  switchId: string,
  deviceId: string,
  overrides?: Partial<NetworkTopologyEdge>,
): NetworkTopologyEdge => {
  return {
    fromNodeId: switchId,
    toNodeId: deviceId,
    fromPort: SWITCH_PORT,
    protocols: ["fdb"],
    parentNodeId: switchId,
    // The builder says which end learned; a flipped copy keeps the stamp.
    learnedByNodeId: switchId,
    ...overrides,
  };
};

/* The register as the builder stamps it after adoption. */
const makeRegister: (
  overrides?: Partial<NetworkTopologyNode>,
) => NetworkTopologyNode = (
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode => {
  return makeDevice(REGISTER_ID, {
    role: "host",
    macAddress: REGISTER_MAC,
    ipAddress: REGISTER_IP,
    vlanId: REGISTER_VLAN,
    ...overrides,
  });
};

/* The same cables with every declaration removed — the control half. */
type WithoutDeclarationsFunction = (
  edges: Array<NetworkTopologyEdge>,
) => Array<NetworkTopologyEdge>;

const withoutDeclarations: WithoutDeclarationsFunction = (
  edges: Array<NetworkTopologyEdge>,
): Array<NetworkTopologyEdge> => {
  return edges.map((edge: NetworkTopologyEdge): NetworkTopologyEdge => {
    return { ...edge, parentNodeId: undefined };
  });
};

/* Every link read end for end. The declared parent is still an end. */
type FlipEdgesFunction = (
  edges: Array<NetworkTopologyEdge>,
) => Array<NetworkTopologyEdge>;

const flipEdges: FlipEdgesFunction = (
  edges: Array<NetworkTopologyEdge>,
): Array<NetworkTopologyEdge> => {
  return edges.map((edge: NetworkTopologyEdge): NetworkTopologyEdge => {
    return {
      ...edge,
      fromNodeId: edge.toNodeId,
      toNodeId: edge.fromNodeId,
      fromPort: edge.toPort,
      toPort: edge.fromPort,
      fromInterface: edge.toInterface,
      toInterface: edge.fromInterface,
    };
  });
};

/*
 * A SEEDED Fisher-Yates shuffle, never Math.random. A test that shuffled
 * randomly would fail on somebody else's machine and pass on the retry,
 * which is the exact class of defect this file exists to rule out of the
 * implementation.
 */
type PermuteFunction = <ItemType>(
  items: Array<ItemType>,
  seed: number,
) => Array<ItemType>;

const permuted: PermuteFunction = <ItemType>(
  items: Array<ItemType>,
  seed: number,
): Array<ItemType> => {
  const shuffled: Array<ItemType> = [...items];
  let state: number = Math.imul(seed, 2654435761) >>> 0 || 0x9e3779b9;
  for (let index: number = shuffled.length - 1; index > 0; index--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const target: number = state % (index + 1);
    const held: ItemType = shuffled[index]!;
    shuffled[index] = shuffled[target]!;
    shuffled[target] = held;
  }
  return shuffled;
};

const SHUFFLE_SEEDS: Array<number> = [1, 2, 3, 7, 11, 29];

type SortedEntriesFunction = <ValueType>(
  map: Map<string, ValueType>,
) => Array<[string, ValueType]>;

const sortedEntries: SortedEntriesFunction = <ValueType>(
  map: Map<string, ValueType>,
): Array<[string, ValueType]> => {
  return [...map.entries()].sort(
    (left: [string, ValueType], right: [string, ValueType]): number => {
      return compareNodeIds(left[0], right[0]);
    },
  );
};

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
  return { chain: chain, hitCycle: current !== undefined };
};

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

/*
 * The structural promises the forest makes whatever an operator declared:
 * every node placed once, every parent exactly one level shallower than
 * its child, nobody its own ancestor, and every node in exactly one tree.
 */
type ExpectWellFormedFunction = (
  forest: ParentChildForest,
  nodes: Array<NetworkTopologyNode>,
) => void;

const expectWellFormedForest: ExpectWellFormedFunction = (
  forest: ParentChildForest,
  nodes: Array<NetworkTopologyNode>,
): void => {
  const allIds: Array<string> = canonicalNodeOrder(nodes);

  expect(forest.depthById.size).toBe(allIds.length);
  expect(forest.childrenById.size).toBe(allIds.length);
  expect(forest.parentById.size).toBe(allIds.length - forest.rootIds.length);

  for (const id of allIds) {
    expect(forest.depthById.has(id)).toBe(true);
    expect(forest.childrenById.has(id)).toBe(true);
    const walk: ParentChainWalk = parentChainOf(forest, id);
    expect(walk.hitCycle).toBe(false);
    expect(new Set<string>(walk.chain).size).toBe(walk.chain.length);
    expect(forest.rootIds).toContain(walk.chain[walk.chain.length - 1]);
    expect(walk.chain.length).toBe(forest.depthById.get(id)! + 1);
  }

  for (const [childId, parentId] of forest.parentById) {
    expect(forest.depthById.get(childId)).toBe(
      forest.depthById.get(parentId)! + 1,
    );
    expect(forest.childrenById.get(parentId)).toContain(childId);
  }
  for (const [parentId, children] of forest.childrenById) {
    for (const childId of children) {
      expect(forest.parentById.get(childId)).toBe(parentId);
    }
  }

  const claimed: Set<string> = new Set<string>();
  for (const rootId of forest.rootIds) {
    expect(forest.depthById.get(rootId)).toBe(0);
    expect(forest.parentById.has(rootId)).toBe(false);
    for (const id of reachableFromRoot(forest, rootId)) {
      expect(claimed.has(id)).toBe(false);
      claimed.add(id);
    }
  }
  expect(Array.from(claimed).sort(compareNodeIds)).toEqual(allIds);
};

type ExpectIdenticalForestFunction = (
  actual: ParentChildForest,
  expected: ParentChildForest,
) => void;

const expectIdenticalForest: ExpectIdenticalForestFunction = (
  actual: ParentChildForest,
  expected: ParentChildForest,
): void => {
  expect(actual.rootIds).toEqual(expected.rootIds);
  expect(sortedEntries(actual.parentById)).toEqual(
    sortedEntries(expected.parentById),
  );
  expect(sortedEntries(actual.childrenById)).toEqual(
    sortedEntries(expected.childrenById),
  );
  expect(sortedEntries(actual.depthById)).toEqual(
    sortedEntries(expected.depthById),
  );
};

type DistanceFunction = (a: TopologyPoint, b: TopologyPoint) => number;

const distanceBetween: DistanceFunction = (
  a: TopologyPoint,
  b: TopologyPoint,
): number => {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
};

type NodeDistanceFunction = (
  model: TopologyLayoutModel,
  a: string,
  b: string,
) => number;

const nodeDistance: NodeDistanceFunction = (
  model: TopologyLayoutModel,
  a: string,
  b: string,
): number => {
  return distanceBetween(model.positions.get(a)!, model.positions.get(b)!);
};

/* Bearing of `id` as seen from `centreId`, in [0, 2pi). */
type BearingFunction = (
  model: TopologyLayoutModel,
  centreId: string,
  id: string,
) => number;

const bearingOf: BearingFunction = (
  model: TopologyLayoutModel,
  centreId: string,
  id: string,
): number => {
  const centre: TopologyPoint = model.positions.get(centreId)!;
  const point: TopologyPoint = model.positions.get(id)!;
  const raw: number = Math.atan2(point.y - centre.y, point.x - centre.x);
  return raw < 0 ? raw + Math.PI * 2 : raw;
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

type PositionsOfFunction = (
  model: TopologyLayoutModel,
) => Array<[string, TopologyPoint]>;

const positionsOf: PositionsOfFunction = (
  model: TopologyLayoutModel,
): Array<[string, TopologyPoint]> => {
  return sortedEntries(model.positions);
};

/*
 * THE SHAPE. One switch, walked, and the register it learned on Gi1/0/7 —
 * a managed device that answers ping and reports nothing, matched to the
 * forwarding-table row by its declared MAC. No router, because the
 * failure this file exists for is the two of them sharing a rank.
 */
const registerSwitch: NetworkTopologyNode = makeDevice(SWITCH_ID, {
  role: "switch",
});
const register: NetworkTopologyNode = makeRegister();
const adoptionEdge: NetworkTopologyEdge = makeAdoptionEdge(
  SWITCH_ID,
  REGISTER_ID,
);

const pairNodes: Array<NetworkTopologyNode> = [registerSwitch, register];
const pairEdges: Array<NetworkTopologyEdge> = [adoptionEdge];

/* The same site with the router the switch uplinks to. */
const siteRouter: NetworkTopologyNode = makeDevice(ROUTER_ID, {
  role: "router",
});
const siteNodes: Array<NetworkTopologyNode> = [
  siteRouter,
  registerSwitch,
  register,
];
const siteEdges: Array<NetworkTopologyEdge> = [
  makeEdge(ROUTER_ID, SWITCH_ID, { protocols: ["lldp"] }),
  adoptionEdge,
];

describe("computeRadialTopologyModel — a register on its switch's FDB edge", () => {
  test("the register sits one ring out from its switch, not beside it", () => {
    const model: TopologyLayoutModel = computeRadialTopologyModel(
      pairNodes,
      pairEdges,
      WIDTH,
      HEIGHT,
    );
    /*
     * The switch is the only rank-0 node, so it sits at radius zero and
     * the register — its one child — lands exactly one ring gap away.
     * Were the register still a root of its own, the two would share the
     * core ring instead (see the control below).
     */
    expect(nodeDistance(model, SWITCH_ID, REGISTER_ID)).toBeCloseTo(
      RADIAL_RING_MIN_GAP,
      6,
    );
    expect(overlapCount(model, pairNodes)).toBe(0);
  });

  test("without the declaration the two share the core ring as peers — today's picture", () => {
    /*
     * The control, and what the map drew before this feature: both are
     * tier 1 (a switch by role, a device touched by an FDB edge), so both
     * are rank 0, both root a wedge, and both are placed on the core ring
     * at RADIAL_CORE_RADIUS — opposite each other, a cable's length of
     * 2 x 90 apart, as if they were two switches somebody forgot to
     * uplink. Pinned so a change here is a decision rather than drift.
     */
    const model: TopologyLayoutModel = computeRadialTopologyModel(
      pairNodes,
      withoutDeclarations(pairEdges),
      WIDTH,
      HEIGHT,
    );
    expect(nodeDistance(model, SWITCH_ID, REGISTER_ID)).toBeCloseTo(
      2 * RADIAL_CORE_RADIUS,
      6,
    );
  });

  test("the declaration reads the same from either end of the link", () => {
    /*
     * A cable the operator drew from the register to the switch merges
     * with the FDB row and keeps its own from/to; the statement "the
     * switch is the parent" means the same thing whichever end wrote it.
     */
    const original: TopologyLayoutModel = computeRadialTopologyModel(
      pairNodes,
      pairEdges,
      WIDTH,
      HEIGHT,
    );
    const flipped: TopologyLayoutModel = computeRadialTopologyModel(
      pairNodes,
      flipEdges(pairEdges),
      WIDTH,
      HEIGHT,
    );
    expect(positionsOf(flipped)).toEqual(positionsOf(original));
  });

  test("a register with no role at all is placed exactly the same way", () => {
    /*
     * The ping-only case proper: nothing classifies it, so its role is the
     * honest "unknown" and the FDB heuristic is what ranks it — at 1, the
     * same rank as the switch. The declaration has to do the work here
     * too.
     */
    const unclassified: Array<NetworkTopologyNode> = [
      registerSwitch,
      makeRegister({ role: "unknown" }),
    ];
    const model: TopologyLayoutModel = computeRadialTopologyModel(
      unclassified,
      pairEdges,
      WIDTH,
      HEIGHT,
    );
    expect(nodeDistance(model, SWITCH_ID, REGISTER_ID)).toBeCloseTo(
      RADIAL_RING_MIN_GAP,
      6,
    );
  });
});

describe("computeRadialTopologyModel — the register under a switch under a router", () => {
  const model: TopologyLayoutModel = computeRadialTopologyModel(
    siteNodes,
    siteEdges,
    WIDTH,
    HEIGHT,
  );

  test("router, switch and register step outward one ring at a time", () => {
    const routerToSwitch: number = nodeDistance(model, ROUTER_ID, SWITCH_ID);
    const routerToRegister: number = nodeDistance(
      model,
      ROUTER_ID,
      REGISTER_ID,
    );
    expect(routerToSwitch).toBeCloseTo(RADIAL_RING_MIN_GAP, 6);
    expect(routerToRegister).toBeCloseTo(2 * RADIAL_RING_MIN_GAP, 6);
    expect(routerToSwitch).toBeLessThan(routerToRegister);
  });

  test("the register hangs on its switch's own spoke", () => {
    /*
     * A child's wedge is contained in its parent's, so the register's
     * bearing from the centre is the switch's bearing. That is what
     * "hangs off" looks like in this mode — and what a root of its own
     * wedge could never satisfy, since a second root would take its own
     * half of the circle.
     */
    expect(bearingOf(model, ROUTER_ID, REGISTER_ID)).toBeCloseTo(
      bearingOf(model, ROUTER_ID, SWITCH_ID),
      6,
    );
    expect(nodeDistance(model, SWITCH_ID, REGISTER_ID)).toBeCloseTo(
      RADIAL_RING_MIN_GAP,
      6,
    );
    expect(overlapCount(model, siteNodes)).toBe(0);
  });

  test("without the declaration the register is an orphan root on the switch ring", () => {
    /*
     * The control: rank 1 like the switch, no neighbour one rank in, so
     * it roots its own wedge on the same ring as the switch and takes the
     * opposite half of the circle — a cable's length of two ring gaps
     * from the switch it is actually plugged into.
     */
    const inferred: TopologyLayoutModel = computeRadialTopologyModel(
      siteNodes,
      withoutDeclarations(siteEdges),
      WIDTH,
      HEIGHT,
    );
    expect(nodeDistance(inferred, ROUTER_ID, REGISTER_ID)).toBeCloseTo(
      nodeDistance(inferred, ROUTER_ID, SWITCH_ID),
      6,
    );
    expect(nodeDistance(inferred, SWITCH_ID, REGISTER_ID)).toBeCloseTo(
      2 * RADIAL_RING_MIN_GAP,
      6,
    );
  });

  test("a router the switch learned on its uplink is not pulled outward", () => {
    /*
     * The builder declares no parent when the adopted device is core: a
     * switch learns its router's MAC on the port that leads UPSTREAM,
     * which says nothing about who hangs off whom. The edge arrives
     * without parentNodeId, and the layout keeps inferring — the router
     * stays the centre, the switch one ring out, exactly as over LLDP.
     */
    const learnedUplink: TopologyLayoutModel = computeRadialTopologyModel(
      [siteRouter, registerSwitch],
      [
        makeEdge(SWITCH_ID, ROUTER_ID, {
          fromPort: "Gi1/0/48",
          protocols: ["fdb"],
        }),
      ],
      WIDTH,
      HEIGHT,
    );
    const lldpUplink: TopologyLayoutModel = computeRadialTopologyModel(
      [siteRouter, registerSwitch],
      [makeEdge(ROUTER_ID, SWITCH_ID, { protocols: ["lldp"] })],
      WIDTH,
      HEIGHT,
    );
    expect(positionsOf(learnedUplink)).toEqual(positionsOf(lldpUplink));
    expect(nodeDistance(learnedUplink, ROUTER_ID, SWITCH_ID)).toBeCloseTo(
      RADIAL_RING_MIN_GAP,
      6,
    );
  });
});

describe("computeRadialTopologyModel — the register beside the switch's endpoints", () => {
  /*
   * The switch also learned two anonymous hosts. Endpoint nodes were
   * always drawn one ring out from their switch; the adopted device now
   * joins them there, as a device glyph among endpoint glyphs, and the
   * endpoints themselves move not at all.
   */
  const endpointA: NetworkTopologyNode = makeEndpoint("endpoint:e-1", {
    name: "e-1",
  });
  const endpointB: NetworkTopologyNode = makeEndpoint("endpoint:e-2", {
    name: "e-2",
  });
  const mixedNodes: Array<NetworkTopologyNode> = [
    registerSwitch,
    register,
    endpointA,
    endpointB,
  ];
  const endpointEdges: Array<NetworkTopologyEdge> = [
    makeEdge(SWITCH_ID, "endpoint:e-1", { protocols: ["fdb"] }),
    makeEdge(SWITCH_ID, "endpoint:e-2", { protocols: ["fdb"] }),
  ];
  const mixedEdges: Array<NetworkTopologyEdge> = [
    adoptionEdge,
    ...endpointEdges,
  ];
  const model: TopologyLayoutModel = computeRadialTopologyModel(
    mixedNodes,
    mixedEdges,
    WIDTH,
    HEIGHT,
  );

  test("the register shares the endpoint ring, one gap out from the switch", () => {
    const endpointRadius: number = nodeDistance(
      model,
      SWITCH_ID,
      "endpoint:e-1",
    );
    expect(endpointRadius).toBeCloseTo(RADIAL_RING_MIN_GAP, 6);
    expect(nodeDistance(model, SWITCH_ID, "endpoint:e-2")).toBeCloseTo(
      endpointRadius,
      6,
    );
    expect(nodeDistance(model, SWITCH_ID, REGISTER_ID)).toBeCloseTo(
      endpointRadius,
      6,
    );
    expect(overlapCount(model, mixedNodes)).toBe(0);
  });

  test("the endpoints keep the exact ring they had before the register was adopted", () => {
    /*
     * The endpoint path is untouched by design: an endpoint node was
     * never ranked by a declaration and still is not. Their radius and
     * their sharing of the ring must be byte-identical to the old
     * behaviour; only the register's own placement is new.
     */
    const endpointsOnly: TopologyLayoutModel = computeRadialTopologyModel(
      [registerSwitch, endpointA, endpointB],
      endpointEdges,
      WIDTH,
      HEIGHT,
    );
    expect(nodeDistance(endpointsOnly, SWITCH_ID, "endpoint:e-1")).toBeCloseTo(
      nodeDistance(model, SWITCH_ID, "endpoint:e-1"),
      6,
    );
    expect(nodeDistance(endpointsOnly, SWITCH_ID, "endpoint:e-2")).toBeCloseTo(
      nodeDistance(model, SWITCH_ID, "endpoint:e-2"),
      6,
    );
  });
});

describe("computeRadialTopologyModel — the declaration is a function of the graph", () => {
  const baseline: TopologyLayoutModel = computeRadialTopologyModel(
    siteNodes,
    siteEdges,
    WIDTH,
    HEIGHT,
  );

  test("shuffling nodes and edges changes nothing", () => {
    for (const seed of SHUFFLE_SEEDS) {
      const shuffled: TopologyLayoutModel = computeRadialTopologyModel(
        permuted(siteNodes, seed),
        permuted(siteEdges, seed * 13),
        WIDTH,
        HEIGHT,
      );
      expect(positionsOf(shuffled)).toEqual(positionsOf(baseline));
      expect(shuffled.contentWidth).toBe(baseline.contentWidth);
      expect(shuffled.contentHeight).toBe(baseline.contentHeight);
    }
  });

  test("reversing the payload and reading every link end for end changes nothing", () => {
    const reversed: TopologyLayoutModel = computeRadialTopologyModel(
      [...siteNodes].reverse(),
      flipEdges([...siteEdges].reverse()),
      WIDTH,
      HEIGHT,
    );
    expect(positionsOf(reversed)).toEqual(positionsOf(baseline));
  });

  test("the same FDB row reported twice does not push the register a second ring out", () => {
    /*
     * Both entries say "one ring outside the switch". The pass reads the
     * switch's RAW rank each time, so the second statement is the first
     * one restated, not a further step.
     */
    const duplicated: TopologyLayoutModel = computeRadialTopologyModel(
      siteNodes,
      [...siteEdges, makeAdoptionEdge(SWITCH_ID, REGISTER_ID)],
      WIDTH,
      HEIGHT,
    );
    expect(positionsOf(duplicated)).toEqual(positionsOf(baseline));
  });

  test("a parent that is neither end of its own edge is ignored", () => {
    /*
     * Only reachable through a stale payload — one end was repointed
     * after the parent was set — and the statement is then about a cable
     * that no longer exists. Placed as though nobody had said anything.
     */
    const strayParent: TopologyLayoutModel = computeRadialTopologyModel(
      siteNodes,
      [
        makeEdge(ROUTER_ID, SWITCH_ID, { protocols: ["lldp"] }),
        makeAdoptionEdge(SWITCH_ID, REGISTER_ID, { parentNodeId: ROUTER_ID }),
      ],
      WIDTH,
      HEIGHT,
    );
    const inferred: TopologyLayoutModel = computeRadialTopologyModel(
      siteNodes,
      withoutDeclarations(siteEdges),
      WIDTH,
      HEIGHT,
    );
    expect(positionsOf(strayParent)).toEqual(positionsOf(inferred));
  });

  test("a declared edge to a node outside the view adds no placement and throws nothing", () => {
    const model: TopologyLayoutModel = computeRadialTopologyModel(
      [registerSwitch],
      [
        null as unknown as NetworkTopologyEdge,
        makeAdoptionEdge(SWITCH_ID, "pos-filtered-out"),
      ],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(1);
    expect(model.positions.has("pos-filtered-out")).toBe(false);
  });

  test("a manual link's declared parent is still left to the parent-child layout", () => {
    /*
     * Radial honours the declaration on FDB edges only. A manual link
     * carrying one has shaped the parent-child mode since issue #3192
     * and never shaped this one; reading it here would move every radial
     * map with such a link, so it must lay out exactly as before.
     */
    const manualNodes: Array<NetworkTopologyNode> = [
      registerSwitch,
      makeDevice("ap-lobby", { role: "wirelessAccessPoint" }),
    ];
    const declared: TopologyLayoutModel = computeRadialTopologyModel(
      manualNodes,
      [
        makeEdge(SWITCH_ID, "ap-lobby", {
          protocols: ["manual"],
          parentNodeId: SWITCH_ID,
        }),
      ],
      WIDTH,
      HEIGHT,
    );
    const undeclared: TopologyLayoutModel = computeRadialTopologyModel(
      manualNodes,
      [makeEdge(SWITCH_ID, "ap-lobby", { protocols: ["manual"] })],
      WIDTH,
      HEIGHT,
    );
    expect(positionsOf(declared)).toEqual(positionsOf(undeclared));
  });
});

describe("buildParentChildForest — the register hangs under its switch", () => {
  const forest: ParentChildForest = buildParentChildForest(
    pairNodes,
    pairEdges,
  );

  test("the switch is the root and the register its child, one level down", () => {
    expect(forest.rootIds).toEqual([SWITCH_ID]);
    expect(forest.parentById.get(REGISTER_ID)).toBe(SWITCH_ID);
    expect(forest.depthById.get(REGISTER_ID)).toBe(
      forest.depthById.get(SWITCH_ID)! + 1,
    );
    expect(forest.childrenById.get(SWITCH_ID)).toEqual([REGISTER_ID]);
    expect(forest.childrenById.get(REGISTER_ID)).toEqual([]);
    expectWellFormedForest(forest, pairNodes);
  });

  test("the register is never rooted, even when it wins every tiebreak", () => {
    /*
     * A register and a switch are both tier 1 with one link each, so
     * without the declaration the root falls to the alphabet — and an id
     * that sorts first would hang the switch UNDER the register it feeds.
     * The declaration is what stops that, for a classified host and for
     * the ping-only device nothing classifies alike.
     */
    for (const role of ["host", "unknown"] as const) {
      const nodes: Array<NetworkTopologyNode> = [
        makeDevice("zz-switch", { role: "switch" }),
        makeDevice("aa-register", { role: role }),
      ];
      const edges: Array<NetworkTopologyEdge> = [
        makeAdoptionEdge("zz-switch", "aa-register"),
      ];

      const inferred: ParentChildForest = buildParentChildForest(
        nodes,
        withoutDeclarations(edges),
      );
      expect(inferred.rootIds).toEqual(["aa-register"]);
      expect(inferred.parentById.get("zz-switch")).toBe("aa-register");

      const declared: ParentChildForest = buildParentChildForest(nodes, edges);
      expect(declared.rootIds).toEqual(["zz-switch"]);
      expect(declared.parentById.get("aa-register")).toBe("zz-switch");
      expect(declared.depthById.get("aa-register")).toBe(1);
      expectWellFormedForest(declared, nodes);
    }
  });

  test("under a router the register is two levels down, on the switch's branch", () => {
    const site: ParentChildForest = buildParentChildForest(
      siteNodes,
      siteEdges,
    );
    expect(site.rootIds).toEqual([ROUTER_ID]);
    expect(site.parentById.get(SWITCH_ID)).toBe(ROUTER_ID);
    expect(site.parentById.get(REGISTER_ID)).toBe(SWITCH_ID);
    expect(site.depthById.get(REGISTER_ID)).toBe(2);
    expect(site.childrenById.get(SWITCH_ID)).toEqual([REGISTER_ID]);
    expectWellFormedForest(site, siteNodes);
  });

  test("the register and the switch's endpoints are siblings under it", () => {
    const nodes: Array<NetworkTopologyNode> = [
      ...siteNodes,
      makeEndpoint("endpoint:e-1", { name: "e-1" }),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      ...siteEdges,
      makeEdge(SWITCH_ID, "endpoint:e-1", { protocols: ["fdb"] }),
    ];
    const forest: ParentChildForest = buildParentChildForest(nodes, edges);
    expect(forest.childrenById.get(SWITCH_ID)).toEqual([
      "endpoint:e-1",
      REGISTER_ID,
    ]);
    expect(forest.depthById.get("endpoint:e-1")).toBe(2);
    expect(forest.depthById.get(REGISTER_ID)).toBe(2);
    expectWellFormedForest(forest, nodes);
  });

  test("the declared site is stable however the payload is ordered", () => {
    const site: ParentChildForest = buildParentChildForest(
      siteNodes,
      siteEdges,
    );
    for (const seed of SHUFFLE_SEEDS) {
      expectIdenticalForest(
        buildParentChildForest(
          permuted(siteNodes, seed),
          permuted(siteEdges, seed),
        ),
        site,
      );
    }
    expectIdenticalForest(
      buildParentChildForest([...siteNodes].reverse(), flipEdges(siteEdges)),
      site,
    );
  });
});

describe("buildParentChildForest — a manual link contradicting the forwarding table", () => {
  /*
   * The switch's table says the register hangs off `sw`; an operator's
   * hand-drawn link says it hangs off `other`. Two parents for one
   * device is a statement no tree can honour, so both are dropped and
   * the register falls back to inference — the same rule the map already
   * applies to two links each claiming one device.
   */
  const otherSwitch: NetworkTopologyNode = makeDevice("other", {
    role: "switch",
  });
  const contradictionNodes: Array<NetworkTopologyNode> = [
    registerSwitch,
    otherSwitch,
    register,
  ];
  const contradictionEdges: Array<NetworkTopologyEdge> = [
    adoptionEdge,
    makeEdge(REGISTER_ID, "other", {
      protocols: ["manual"],
      parentNodeId: "other",
    }),
  ];

  test("neither claim survives the reading of the declarations", () => {
    const declared: Map<string, string> = buildDeclaredParentMap(
      contradictionNodes,
      contradictionEdges,
    );
    expect(declared.has(REGISTER_ID)).toBe(false);
    expect(declared.size).toBe(0);
  });

  test("the forest falls back to the inference exactly, and is well formed", () => {
    const forest: ParentChildForest = buildParentChildForest(
      contradictionNodes,
      contradictionEdges,
    );
    expectIdenticalForest(
      forest,
      buildParentChildForest(
        contradictionNodes,
        withoutDeclarations(contradictionEdges),
      ),
    );
    expectWellFormedForest(forest, contradictionNodes);
    // Both cables are still in the graph: the register is somebody's child.
    expect(forest.rootIds.length).toBe(1);
    expect(forest.depthById.size).toBe(3);
  });

  test("the contradiction resolves the same way whatever order the rows arrive in", () => {
    const baseline: ParentChildForest = buildParentChildForest(
      contradictionNodes,
      contradictionEdges,
    );
    for (const seed of SHUFFLE_SEEDS) {
      expectIdenticalForest(
        buildParentChildForest(
          permuted(contradictionNodes, seed),
          permuted(contradictionEdges, seed * 7),
        ),
        baseline,
      );
    }
  });
});

describe("tierForNode — a managed device on an FDB edge is never tier 2", () => {
  const fdbIds: Set<string> = new Set<string>([SWITCH_ID, REGISTER_ID]);

  test("a classified host on an FDB edge is tier 1", () => {
    expect(tierForNode(register, fdbIds)).toBe(1);
  });

  test("an unclassified device on an FDB edge is tier 1 by the FDB heuristic", () => {
    expect(tierForNode(makeRegister({ role: "unknown" }), fdbIds)).toBe(1);
    expect(tierForNode(makeRegister({ role: undefined }), fdbIds)).toBe(1);
  });

  test("the switch that learned it is tier 1 too — tier 2 is endpoints only", () => {
    expect(tierForNode(registerSwitch, fdbIds)).toBe(1);
    expect(tierForNode(makeEndpoint("endpoint:e-1"), fdbIds)).toBe(2);
  });
});

describe("computeTieredTopologyModel — the register is a column, not a boxed endpoint", () => {
  const endpointA: NetworkTopologyNode = makeEndpoint("endpoint:e-1", {
    name: "e-1",
  });
  const endpointB: NetworkTopologyNode = makeEndpoint("endpoint:e-2", {
    name: "e-2",
  });
  const nodes: Array<NetworkTopologyNode> = [
    ...siteNodes,
    endpointA,
    endpointB,
  ];
  const edges: Array<NetworkTopologyEdge> = [
    ...siteEdges,
    makeEdge(SWITCH_ID, "endpoint:e-1", { protocols: ["fdb"] }),
    makeEdge(SWITCH_ID, "endpoint:e-2", { protocols: ["fdb"] }),
  ];
  const model: TieredTopologyModel = computeTieredTopologyModel(
    nodes,
    edges,
    WIDTH,
  );

  test("the switch's real endpoints still group under it", () => {
    expect(model.groups.length).toBe(1);
    const box: TopologyGroupBox = model.groups[0]!;
    expect(box.anchorNodeId).toBe(SWITCH_ID);
    expect(box.nodeIds).toEqual(["endpoint:e-1", "endpoint:e-2"]);
    expect(box.endpointCount).toBe(2);
  });

  test("no managed device appears inside any group box", () => {
    for (const box of model.groups) {
      expect(box.nodeIds).not.toContain(REGISTER_ID);
      expect(box.nodeIds).not.toContain(SWITCH_ID);
      expect(box.nodeIds).not.toContain(ROUTER_ID);
    }
  });

  test("the register shares the switch's row, in a column of its own", () => {
    /*
     * A device is drawn at device pitch in the tier-1 row; the endpoint
     * box below the switch is drawn at the tighter endpoint pitch. A
     * managed device dropped into that box would be a device glyph at
     * endpoint spacing, colliding with its neighbours.
     */
    const switchPoint: TopologyPoint = model.positions.get(SWITCH_ID)!;
    const registerPoint: TopologyPoint = model.positions.get(REGISTER_ID)!;
    const endpointPoint: TopologyPoint = model.positions.get("endpoint:e-1")!;
    expect(registerPoint.y).toBe(switchPoint.y);
    expect(registerPoint.x).not.toBe(switchPoint.x);
    expect(endpointPoint.y).toBeGreaterThan(switchPoint.y);
    expect(model.positions.get(ROUTER_ID)!.y).toBeLessThan(switchPoint.y);
  });

  test("the layout-model entry point reports the same boxes", () => {
    const layoutModel: TopologyLayoutModel = computeTieredTopologyLayoutModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    expect(layoutModel.groups).toEqual(model.groups);
    for (const box of layoutModel.groups) {
      expect(box.nodeIds).not.toContain(REGISTER_ID);
    }
  });

  test("a switch whose only learned host is the register gets no box at all", () => {
    const bare: TieredTopologyModel = computeTieredTopologyModel(
      pairNodes,
      pairEdges,
      WIDTH,
    );
    expect(bare.groups).toEqual([]);
    // Two childless tier-1 columns, at the plain device spacing.
    expect(bare.positions.get(REGISTER_ID)!.y).toBe(
      bare.positions.get(SWITCH_ID)!.y,
    );
    expect(
      Math.abs(
        bare.positions.get(REGISTER_ID)!.x - bare.positions.get(SWITCH_ID)!.x,
      ),
    ).toBe(TIERED_NODE_SPACING);
  });
});

type MakeInputFunction = (
  overrides?: Partial<TopologyViewModelInput>,
) => TopologyViewModelInput;

const registerPositions: Map<string, TopologyPoint> = new Map<
  string,
  TopologyPoint
>([
  [SWITCH_ID, { x: 300, y: 300 }],
  [REGISTER_ID, { x: 300, y: 500 }],
]);

/* Defaults describe the unfiltered, unsearched, nothing-selected frame. */
const makeInput: MakeInputFunction = (
  overrides?: Partial<TopologyViewModelInput>,
): TopologyViewModelInput => {
  return {
    nodes: pairNodes,
    edges: pairEdges,
    positions: registerPositions,
    searchText: "",
    visibleKinds: ALL_NODE_KINDS,
    healthFilterMode: "all",
    focusNodeIds: new Set<string>(),
    selectedNodeId: null,
    selectedEdgeKey: null,
    pinnedNodeIds: new Set<string>(),
    ...overrides,
  };
};

type FindNodeFunction = (
  model: TopologyViewModel,
  id: string,
) => TopologyNodeView | undefined;

const nodeById: FindNodeFunction = (
  model: TopologyViewModel,
  id: string,
): TopologyNodeView | undefined => {
  return model.nodes.find((view: TopologyNodeView): boolean => {
    return view.id === id;
  });
};

type FindEdgeFunction = (
  model: TopologyViewModel,
  key: string,
) => TopologyEdgeView | undefined;

const edgeByKey: FindEdgeFunction = (
  model: TopologyViewModel,
  key: string,
): TopologyEdgeView | undefined => {
  return model.edges.find((view: TopologyEdgeView): boolean => {
    return view.key === key;
  });
};

const ADOPTION_EDGE_KEY: string = `${REGISTER_ID}::${SWITCH_ID}`;

describe("buildTopologyViewModel — the register is a device on a learned cable", () => {
  const model: TopologyViewModel = buildTopologyViewModel(makeInput());

  test("the FDB edge to a managed device gets the short learned dash", () => {
    const view: TopologyEdgeView = edgeByKey(model, ADOPTION_EDGE_KEY)!;
    expect(view.strokeDashArray).toBe(FDB_EDGE_DASH);
    expect(view.state).toBe("unknown");
    expect(view.fromNodeId).toBe(SWITCH_ID);
    expect(view.toNodeId).toBe(REGISTER_ID);
  });

  test("the register keeps its device kind and its status fill, MAC and VLAN notwithstanding", () => {
    /*
     * The stamped identity is what the detail drawer shows; it must not
     * turn the node violet. An endpoint is violet because we do not poll
     * it — this device we do, and its colour is its health.
     */
    expect(kindOfNode(register)).toBe("device");
    const view: TopologyNodeView = nodeById(model, REGISTER_ID)!;
    expect(view.kind).toBe("device");
    expect(view.status).toBe("up");
    expect(view.fill).toBe(NODE_STATUS_COLORS.up);
    expect(view.stroke).toBe(NODE_STATUS_COLORS.up);
    expect(view.strokeDashArray).toBeUndefined();
    expect(view.health).toBe("healthy");
    expect(view.ariaLabel).toContain("managed device");
    expect(view.ariaLabel).not.toContain("endpoint");
  });

  test("a register that stopped answering is filled with the down colour", () => {
    const down: TopologyViewModel = buildTopologyViewModel(
      makeInput({ nodes: [registerSwitch, makeRegister({ status: "down" })] }),
    );
    const view: TopologyNodeView = nodeById(down, REGISTER_ID)!;
    expect(view.kind).toBe("device");
    expect(view.fill).toBe(NODE_STATUS_COLORS.down);
    expect(view.health).toBe("down");
  });

  test("a dark switch port keeps the warning dash and degrades the register", () => {
    const darkPort: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        edges: [
          makeAdoptionEdge(SWITCH_ID, REGISTER_ID, {
            fromInterface: {
              interfaceName: SWITCH_PORT,
              isOperationallyUp: false,
            },
          }),
        ],
        healthFilterMode: "attention",
      }),
    );
    const edge: TopologyEdgeView = edgeByKey(darkPort, ADOPTION_EDGE_KEY)!;
    expect(edge.state).toBe("down");
    expect(edge.strokeDashArray).toBe(DOWN_EDGE_DASH);
    const view: TopologyNodeView = nodeById(darkPort, REGISTER_ID)!;
    expect(view.health).toBe("degraded");
    expect(view.isHealthMatch).toBe(true);
    expect(view.isDimmed).toBe(false);
  });

  test("hiding endpoints does not hide the register or its cable", () => {
    /*
     * The endpoint toggle removes the anonymous hosts. The register is a
     * device, so both it and the FDB edge that places it survive — the
     * whole point of adopting the row was that it stopped being one of
     * the things that toggle hides.
     */
    const noEndpoints: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        visibleKinds: new Set<TopologyNodeKind>(["device", "unmanaged"]),
      }),
    );
    expect(nodeById(noEndpoints, REGISTER_ID)).toBeDefined();
    expect(edgeByKey(noEndpoints, ADOPTION_EDGE_KEY)).toBeDefined();
    expect(noEndpoints.visibleNodeCount).toBe(2);
  });
});

describe("health — a register on a dead switch port is degraded", () => {
  const darkPortEdge: NetworkTopologyEdge = makeAdoptionEdge(
    SWITCH_ID,
    REGISTER_ID,
    { fromInterface: { isOperationallyUp: false } },
  );

  test("a reachable device at the end of a dead FDB link is degraded", () => {
    expect(
      healthStateForNode(makeRegister({ status: "up" }), {
        hasDownLink: true,
      }),
    ).toBe("degraded");
  });

  test("the dead switch end marks both the switch and the register", () => {
    const ids: Set<string> = nodeIdsWithDownLinks([darkPortEdge]);
    expect(Array.from(ids).sort()).toEqual([REGISTER_ID, SWITCH_ID]);
  });

  test("healthStateByNodeId classifies the register degraded, not healthy", () => {
    const byId: Map<string, TopologyHealthState> = healthStateByNodeId(
      pairNodes,
      [darkPortEdge],
    );
    expect(byId.get(REGISTER_ID)).toBe("degraded");
    expect(byId.get(SWITCH_ID)).toBe("degraded");
  });

  test("the same dead link leaves an ENDPOINT healthy — the exemption is about ports, not protocols", () => {
    /*
     * An endpoint is exempt because it has no ports of its own and the
     * link's health belongs to the switch. A managed device on the very
     * same kind of edge has ports, is polled, and is exactly what an
     * operator wants pointed at when its uplink goes dark.
     */
    const endpointOnDarkPort: NetworkTopologyEdge = makeEdge(
      SWITCH_ID,
      "endpoint:e-1",
      { protocols: ["fdb"], fromInterface: { isOperationallyUp: false } },
    );
    const byId: Map<string, TopologyHealthState> = healthStateByNodeId(
      [
        registerSwitch,
        makeRegister({ status: "up" }),
        makeEndpoint("endpoint:e-1", { status: "up" }),
      ],
      [darkPortEdge, endpointOnDarkPort],
    );
    expect(byId.get("endpoint:e-1")).toBe("healthy");
    expect(byId.get(REGISTER_ID)).toBe("degraded");
  });

  test("a healthy switch port leaves the register healthy", () => {
    const byId: Map<string, TopologyHealthState> = healthStateByNodeId(
      pairNodes,
      [
        makeAdoptionEdge(SWITCH_ID, REGISTER_ID, {
          fromInterface: { isOperationallyUp: true },
        }),
      ],
    );
    expect(byId.get(REGISTER_ID)).toBe("healthy");
  });

  test("Needs attention matches the register and keeps the switch as its context", () => {
    const visibility: TopologyHealthVisibility = resolveHealthVisibility({
      nodes: [
        makeDevice(SWITCH_ID, { role: "switch", status: "up" }),
        register,
      ],
      edges: [darkPortEdge],
      mode: "attention",
    });
    // Both ends of the dead link are degraded, so both match outright.
    expect(Array.from(visibility.matchedNodeIds).sort()).toEqual([
      REGISTER_ID,
      SWITCH_ID,
    ]);
    expect(visibility.visibleNodeIds.has(REGISTER_ID)).toBe(true);
  });

  test("a register that did not answer is down, whatever its switch port says", () => {
    const byId: Map<string, TopologyHealthState> = healthStateByNodeId(
      [registerSwitch, makeRegister({ status: "down" })],
      [
        makeAdoptionEdge(SWITCH_ID, REGISTER_ID, {
          fromInterface: { isOperationallyUp: true },
        }),
      ],
    );
    expect(byId.get(REGISTER_ID)).toBe("down");
  });
});

/*
 * The radial parent pass, refused where it must be.
 *
 * It exists for the register with nothing but a learned edge; it must not
 * move a switch. Two ways a switch could have been moved: a parent declared
 * on a hand-drawn link that a learned attachment merged into (the parent is
 * not the learner - it is the far end, above the learner), and a child
 * that is itself a learner (a switch with endpoints, whatever declared it).
 * Either would put the switch on its own endpoints' ring and orphan them.
 */
describe("computeRadialTopologyModel — a switch is never pushed onto its endpoints' ring", () => {
  const router: NetworkTopologyNode = makeDevice("router", { role: "router" });
  const swA: NetworkTopologyNode = makeDevice("sw-a", { role: "switch" });
  const swB: NetworkTopologyNode = makeDevice("sw-b", { role: "switch" });
  const e1: NetworkTopologyNode = makeEndpoint("endpoint:e1");
  const e2: NetworkTopologyNode = makeEndpoint("endpoint:e2");
  const nodes: Array<NetworkTopologyNode> = [router, swA, swB, e1, e2];

  const baseEdges: Array<NetworkTopologyEdge> = [
    makeEdge("router", "sw-a", { protocols: ["lldp"] }),
    makeEdge("sw-b", "endpoint:e1", {
      protocols: ["fdb"],
      learnedByNodeId: "sw-b",
    }),
    makeEdge("sw-b", "endpoint:e2", {
      protocols: ["fdb"],
      learnedByNodeId: "sw-b",
    }),
  ];

  test("a learned attachment merged into a hand-drawn uplink leaves the switch on its ring", () => {
    const before: TopologyLayoutModel = computeRadialTopologyModel(
      nodes,
      [
        ...baseEdges,
        makeEdge("sw-a", "sw-b", {
          protocols: ["manual"],
          parentNodeId: "sw-a",
        }),
      ],
      WIDTH,
      HEIGHT,
    );
    const after: TopologyLayoutModel = computeRadialTopologyModel(
      nodes,
      [
        ...baseEdges,
        makeEdge("sw-a", "sw-b", {
          protocols: ["manual", "fdb"],
          parentNodeId: "sw-a",
          learnedByNodeId: "sw-a",
        }),
      ],
      WIDTH,
      HEIGHT,
    );

    // sw-b stays where it was: one ring out from the router, beside sw-a.
    expect(nodeDistance(after, "router", "sw-b")).toBeCloseTo(
      nodeDistance(before, "router", "sw-b"),
      6,
    );
    expect(nodeDistance(after, "router", "sw-b")).toBeCloseTo(
      RADIAL_RING_MIN_GAP,
      6,
    );
    // ...and its endpoints still hang one ring further out from it.
    expect(nodeDistance(after, "router", "endpoint:e1")).toBeCloseTo(
      2 * RADIAL_RING_MIN_GAP,
      6,
    );
    expect(nodeDistance(after, "router", "endpoint:e2")).toBeCloseTo(
      2 * RADIAL_RING_MIN_GAP,
      6,
    );
  });

  test("a parent declared on the learned end, not by the learner, moves nothing", () => {
    /*
     * A firewall above the switch that learned its MAC: the rule declared
     * the firewall parent, the table learned on the switch. Neither end
     * is pushed anywhere on that account.
     */
    const firewall: NetworkTopologyNode = makeDevice("fw", {
      role: "firewall",
    });
    const sw: NetworkTopologyNode = makeDevice("sw", { role: "switch" });
    const declaredElsewhere: TopologyLayoutModel = computeRadialTopologyModel(
      [firewall, sw],
      [
        makeEdge("fw", "sw", {
          protocols: ["manual", "fdb"],
          parentNodeId: "fw",
          learnedByNodeId: "sw",
        }),
      ],
      WIDTH,
      HEIGHT,
    );
    const plain: TopologyLayoutModel = computeRadialTopologyModel(
      [firewall, sw],
      [makeEdge("fw", "sw", { protocols: ["manual"], parentNodeId: "fw" })],
      WIDTH,
      HEIGHT,
    );

    expect(nodeDistance(declaredElsewhere, "fw", "sw")).toBeCloseTo(
      nodeDistance(plain, "fw", "sw"),
      6,
    );
  });
});
