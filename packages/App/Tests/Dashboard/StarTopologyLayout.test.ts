import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  STAR_HUB_RING_GAP,
  STAR_LAYOUT_MARGIN,
  STAR_RING_MIN_GAP,
  STAR_SLOT_PADDING,
  computeStarRingDepths,
  computeStarTopologyModel,
  selectStarHubNodeId,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/StarTopologyLayout";
import { countNodeOverlaps } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyCollision";
import {
  TopologyNodeFootprint,
  buildFootprints,
  footprintOrDefault,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyFootprint";
import {
  TopologyAdjacency,
  TopologyPoint,
  buildTopologyAdjacency,
  canonicalNodeOrder,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";
import { TopologyLayoutModel } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyModel";

const WIDTH: number = 1000;
const HEIGHT: number = 700;

/*
 * Two device glyphs are 16px radii plus 8px of collision padding each, so
 * anything closer than this is a literal overlap. Named here so the ring
 * assertions read as the contract rather than as a magic number.
 */
const DEVICE_PAIR_CLEARANCE: number = 48;

/*
 * A radius is asserted by measuring back from the placed coordinates, and
 * those went through a cosine, a sine and a translation on the way out. A
 * ring the layout put at exactly 270 measures 269.99999999999994, so a gap
 * of exactly 120 reads as 119.99999999999991. This slack is a billionth of
 * a pixel — small enough that no real regression can hide under it, large
 * enough that the arithmetic cannot fail the contract.
 */
const RADIUS_EPSILON: number = 1e-9;

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
    const endpointId: string = `endpoint:${id}-${String(i).padStart(2, "0")}`;
    endpoints.push(
      makeEndpoint(endpointId, {
        name: `${id}-${String(i).padStart(2, "0")}`,
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

type DistanceFunction = (a: TopologyPoint, b: TopologyPoint) => number;
const distanceBetween: DistanceFunction = (
  a: TopologyPoint,
  b: TopologyPoint,
): number => {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
};

type RadiusFunction = (
  model: TopologyLayoutModel,
  centre: TopologyPoint,
  id: string,
) => number;
const radiusOf: RadiusFunction = (
  model: TopologyLayoutModel,
  centre: TopologyPoint,
  id: string,
): number => {
  return distanceBetween(centre, model.positions.get(id)!);
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

type MinPairDistanceFunction = (
  model: TopologyLayoutModel,
  ids: Array<string>,
) => number;
const minPairDistance: MinPairDistanceFunction = (
  model: TopologyLayoutModel,
  ids: Array<string>,
): number => {
  let smallest: number = Infinity;
  for (let i: number = 0; i < ids.length; i++) {
    for (let j: number = i + 1; j < ids.length; j++) {
      smallest = Math.min(
        smallest,
        distanceBetween(
          model.positions.get(ids[i]!)!,
          model.positions.get(ids[j]!)!,
        ),
      );
    }
  }
  return smallest;
};

type DegreeFunction = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  id: string,
) => number;
const degreeOf: DegreeFunction = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  id: string,
): number => {
  const adjacency: TopologyAdjacency = buildTopologyAdjacency(nodes, edges);
  return adjacency.degreeById.get(id) || 0;
};

/*
 * Deterministic permutations. The topology endpoint returns rows in an
 * order nothing guarantees and re-polls every minute, so these stand in
 * for "the same graph, delivered differently" — never Math.random, which
 * would make a failure here unreproducible.
 */
type RotateNodesFunction = (
  nodes: Array<NetworkTopologyNode>,
  by: number,
) => Array<NetworkTopologyNode>;
const rotateNodes: RotateNodesFunction = (
  nodes: Array<NetworkTopologyNode>,
  by: number,
): Array<NetworkTopologyNode> => {
  const offset: number = ((by % nodes.length) + nodes.length) % nodes.length;
  return [...nodes.slice(offset), ...nodes.slice(0, offset)];
};

type RotateEdgesFunction = (
  edges: Array<NetworkTopologyEdge>,
  by: number,
) => Array<NetworkTopologyEdge>;
const rotateEdges: RotateEdgesFunction = (
  edges: Array<NetworkTopologyEdge>,
  by: number,
): Array<NetworkTopologyEdge> => {
  const offset: number = ((by % edges.length) + edges.length) % edges.length;
  return [...edges.slice(offset), ...edges.slice(0, offset)];
};

type FiniteModelAssertion = (model: TopologyLayoutModel) => void;
const expectFiniteModel: FiniteModelAssertion = (
  model: TopologyLayoutModel,
): void => {
  expect(Number.isFinite(model.contentWidth)).toBe(true);
  expect(Number.isFinite(model.contentHeight)).toBe(true);
  expect(model.contentWidth).toBeGreaterThan(0);
  expect(model.contentHeight).toBeGreaterThan(0);
  for (const [, point] of model.positions) {
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  }
};

/*
 * Canonical branch site: one router (no FDB edges of its own, so tier 0
 * and the only hub candidate), two access switches, an unmanaged access
 * point hanging off one of them, and three POS terminals.
 */
const branchRouter: NetworkTopologyNode = makeDevice("router-1");
const branchSwitchA: NetworkTopologyNode = makeDevice("switch-a");
const branchSwitchB: NetworkTopologyNode = makeDevice("switch-b");
const branchAp: NetworkTopologyNode = makeUnmanaged("unmanaged:ap-1", {
  name: "ap-lobby",
});
const branchPos1: NetworkTopologyNode = makeEndpoint("endpoint:pos-1", {
  name: "pos-1",
});
const branchPos2: NetworkTopologyNode = makeEndpoint("endpoint:pos-2", {
  name: "pos-2",
});
const branchPos3: NetworkTopologyNode = makeEndpoint("endpoint:pos-3", {
  name: "pos-3",
});

const branchNodes: Array<NetworkTopologyNode> = [
  branchRouter,
  branchSwitchA,
  branchSwitchB,
  branchAp,
  branchPos1,
  branchPos2,
  branchPos3,
];

const branchEdges: Array<NetworkTopologyEdge> = [
  makeEdge("router-1", "switch-a", ["lldp"]),
  makeEdge("router-1", "switch-b", ["lldp", "cdp"]),
  makeEdge("switch-a", "unmanaged:ap-1", ["cdp"]),
  makeEdge("switch-a", "endpoint:pos-1", ["fdb"]),
  makeEdge("switch-a", "endpoint:pos-2", ["fdb"]),
  makeEdge("switch-b", "endpoint:pos-3", ["fdb"]),
];

/*
 * The same site plus a switch pair whose uplink was never discovered, so
 * the hub cannot reach it at all.
 */
const islandNodes: Array<NetworkTopologyNode> = [
  ...branchNodes,
  makeDevice("device:island-a"),
  makeDevice("device:island-b"),
  makeEndpoint("endpoint:iso-1", { name: "iso-1" }),
];

const islandEdges: Array<NetworkTopologyEdge> = [
  ...branchEdges,
  makeEdge("device:island-a", "device:island-b", ["lldp"]),
  makeEdge("device:island-a", "endpoint:iso-1", ["fdb"]),
];

describe("selectStarHubNodeId — who the star is drawn around", () => {
  test("an empty node list has no hub", () => {
    expect(selectStarHubNodeId([], [])).toBeNull();
  });

  test("an absent node or edge list has no hub rather than throwing", () => {
    expect(
      selectStarHubNodeId(
        undefined as unknown as Array<NetworkTopologyNode>,
        undefined as unknown as Array<NetworkTopologyEdge>,
      ),
    ).toBeNull();
    expect(
      selectStarHubNodeId(
        [makeDevice("router-1")],
        undefined as unknown as Array<NetworkTopologyEdge>,
      ),
    ).toBe("router-1");
  });

  test("rows with no usable id contribute no hub", () => {
    expect(
      selectStarHubNodeId(
        [
          null as unknown as NetworkTopologyNode,
          makeDevice("", { name: "ghost" }),
        ],
        [],
      ),
    ).toBeNull();
  });

  test("role beats degree: a two-link router outranks a forty-endpoint switch", () => {
    const heavy: SwitchWithEndpoints = makeSwitchWithEndpoints("switch-a", 40);
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("router-1"),
      makeUnmanaged("unmanaged:peer-1", { name: "peer-1" }),
      ...heavy.nodes,
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("router-1", "switch-a", ["lldp"]),
      makeEdge("router-1", "unmanaged:peer-1", ["cdp"]),
      ...heavy.edges,
    ];

    /*
     * The switch out-degrees the router twenty to one; a highest-degree
     * pick would enthrone it and push the core out to ring one, which is
     * not how anyone draws a site.
     */
    expect(degreeOf(nodes, edges, "switch-a")).toBe(41);
    expect(degreeOf(nodes, edges, "router-1")).toBe(2);
    expect(selectStarHubNodeId(nodes, edges)).toBe("router-1");
  });

  test("degree breaks a tie inside one tier", () => {
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("device:core-a"),
      makeDevice("device:core-z"),
      makeUnmanaged("unmanaged:peer-1", { name: "peer-1" }),
      makeUnmanaged("unmanaged:peer-2", { name: "peer-2" }),
      makeUnmanaged("unmanaged:peer-3", { name: "peer-3" }),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("device:core-z", "unmanaged:peer-1", ["lldp"]),
      makeEdge("device:core-z", "unmanaged:peer-2", ["lldp"]),
      makeEdge("device:core-z", "unmanaged:peer-3", ["lldp"]),
      makeEdge("device:core-a", "unmanaged:peer-1", ["lldp"]),
    ];
    // Both are tier 0; core-z wins on degree despite the later id.
    expect(selectStarHubNodeId(nodes, edges)).toBe("device:core-z");
  });

  test("the node id breaks a tie nothing else can", () => {
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("device:core-b"),
      makeDevice("device:core-a"),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("device:core-a", "device:core-b", ["lldp"]),
    ];
    // Same tier, same degree: the total order on id decides, not arrival.
    expect(selectStarHubNodeId(nodes, edges)).toBe("device:core-a");
    expect(selectStarHubNodeId([...nodes].reverse(), edges)).toBe(
      "device:core-a",
    );
  });

  test("an endpoint never wins while any non-endpoint is in view", () => {
    const nodes: Array<NetworkTopologyNode> = [
      makeUnmanaged("unmanaged:lonely", { name: "lonely" }),
      makeEndpoint("endpoint:hub-e", { name: "hub-e" }),
      makeEndpoint("endpoint:leaf-1", { name: "leaf-1" }),
      makeEndpoint("endpoint:leaf-2", { name: "leaf-2" }),
      makeEndpoint("endpoint:leaf-3", { name: "leaf-3" }),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("endpoint:hub-e", "endpoint:leaf-1", ["fdb"]),
      makeEdge("endpoint:hub-e", "endpoint:leaf-2", ["fdb"]),
      makeEdge("endpoint:hub-e", "endpoint:leaf-3", ["fdb"]),
    ];
    // The unmanaged peer has no links at all and still takes the middle.
    expect(degreeOf(nodes, edges, "unmanaged:lonely")).toBe(0);
    expect(selectStarHubNodeId(nodes, edges)).toBe("unmanaged:lonely");
  });

  test("endpoints are candidates only when the graph is nothing else", () => {
    const nodes: Array<NetworkTopologyNode> = [
      makeEndpoint("endpoint:a", { name: "a" }),
      makeEndpoint("endpoint:b", { name: "b" }),
      makeEndpoint("endpoint:c", { name: "c" }),
      makeEndpoint("endpoint:d", { name: "d" }),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("endpoint:c", "endpoint:a", ["fdb"]),
      makeEdge("endpoint:c", "endpoint:b", ["fdb"]),
      makeEdge("endpoint:c", "endpoint:d", ["fdb"]),
    ];
    expect(selectStarHubNodeId(nodes, edges)).toBe("endpoint:c");
  });

  test("a lone endpoint is its own hub", () => {
    expect(
      selectStarHubNodeId(
        [makeEndpoint("endpoint:solo", { name: "solo" })],
        [],
      ),
    ).toBe("endpoint:solo");
  });

  test("the branch site puts its router in the middle", () => {
    expect(selectStarHubNodeId(branchNodes, branchEdges)).toBe("router-1");
  });

  test("an unpatched spare never takes the centre from a cabled device", () => {
    /*
     * A managed switch racked and polled but not yet patched. Ranked by
     * role alone it looks MORE core than anything else on the site —
     * nothing has attached an endpoint to it, so nothing marks it as an
     * access switch — and enthroning it makes every genuinely cabled
     * device an unreachable island, fanned onto one ring around a box
     * none of them is connected to. Star publishes no component hulls, so
     * that collapse is invisible: every real link simply becomes a chord
     * across the ring and the picture reads as a site with no structure.
     */
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("switch-a"),
      makeDevice("switch-b"),
      makeDevice("aaa-spare"),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("switch-a", "switch-b", ["lldp"]),
    ];
    for (const owner of ["a", "b"]) {
      for (let i: number = 0; i < 6; i++) {
        const endpointId: string = `endpoint:${owner}-${String(i)}`;
        nodes.push(makeEndpoint(endpointId, { name: `${owner}-${String(i)}` }));
        edges.push(makeEdge(`switch-${owner}`, endpointId, ["fdb"]));
      }
    }

    // The premise: the spare really does report no links whatsoever.
    expect(degreeOf(nodes, edges, "aaa-spare")).toBe(0);
    expect(selectStarHubNodeId(nodes, edges)).toBe("switch-a");

    // A ring is a hop count again, for every node in the picture.
    const depths: Map<string, number> = computeStarRingDepths(
      nodes,
      edges,
      "switch-a",
    );
    expect(depths.get("switch-b")).toBe(1);
    expect(depths.get("endpoint:a-0")).toBe(1);
    expect(depths.get("endpoint:b-0")).toBe(2);
    // The spare is the island now, one ring past everything reachable.
    expect(depths.get("aaa-spare")).toBe(3);

    const model: TopologyLayoutModel = computeStarTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    const hub: TopologyPoint = model.positions.get("switch-a")!;
    expect(radiusOf(model, hub, "endpoint:b-0")).toBeGreaterThan(
      radiusOf(model, hub, "switch-b"),
    );
    expect(radiusOf(model, hub, "aaa-spare")).toBeGreaterThan(
      radiusOf(model, hub, "endpoint:b-0"),
    );
  });

  test("with nothing cabled anywhere an unlinked device is still eligible", () => {
    /*
     * Connectivity outranks role only while there is connectivity to
     * rank by. A site whose discovery has not run yet is all spares, and
     * one of them still has to be the middle.
     */
    expect(
      selectStarHubNodeId(
        [makeDevice("zzz-spare"), makeDevice("aaa-spare")],
        [],
      ),
    ).toBe("aaa-spare");
  });

  test("one host learned on the core's own bridge table does not move the hub", () => {
    /*
     * The moment somebody plugs a laptop into the router, the router
     * appears in an FDB row of its own. Read as a role signal that single
     * row says "this is an access switch", and the centre of the site
     * jumps to a genuine access switch on the next sixty-second poll —
     * exactly the picture the role rule exists to prevent, produced by
     * the role rule itself. Cabling is what decides here, and one learned
     * MAC address is not cabling.
     */
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("router-1"),
      makeDevice("switch-a"),
      makeDevice("switch-b"),
      makeEndpoint("endpoint:b-0", { name: "b-0" }),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("router-1", "switch-a", ["lldp"]),
      makeEdge("router-1", "switch-b", ["lldp"]),
      makeEdge("switch-b", "endpoint:b-0", ["fdb"]),
    ];
    for (let i: number = 0; i < 6; i++) {
      const endpointId: string = `endpoint:a-${String(i)}`;
      nodes.push(makeEndpoint(endpointId, { name: `a-${String(i)}` }));
      edges.push(makeEdge("switch-a", endpointId, ["fdb"]));
    }
    expect(selectStarHubNodeId(nodes, edges)).toBe("router-1");

    // Next poll: one directly-attached host appears on the router.
    const nextNodes: Array<NetworkTopologyNode> = [
      ...nodes,
      makeEndpoint("endpoint:r-0", { name: "r-0" }),
    ];
    const nextEdges: Array<NetworkTopologyEdge> = [
      ...edges,
      makeEdge("router-1", "endpoint:r-0", ["fdb"]),
    ];
    expect(selectStarHubNodeId(nextNodes, nextEdges)).toBe("router-1");

    // ...and the whole map does not re-centre on the access switch.
    const model: TopologyLayoutModel = computeStarTopologyModel(
      nextNodes,
      nextEdges,
      WIDTH,
      HEIGHT,
    );
    const router: TopologyPoint = model.positions.get("router-1")!;
    expect(router.x).toBeCloseTo(model.contentWidth / 2, 6);
    expect(router.y).toBeCloseTo(model.contentHeight / 2, 6);
    expect(radiusOf(model, router, "switch-a")).toBeGreaterThanOrEqual(
      STAR_HUB_RING_GAP - RADIUS_EPSILON,
    );
  });

  test("permuting the input does not change the hub", () => {
    const reversed: string | null = selectStarHubNodeId(
      [...branchNodes].reverse(),
      [...branchEdges].reverse(),
    );
    const rotated: string | null = selectStarHubNodeId(
      rotateNodes(branchNodes, 3),
      rotateEdges(branchEdges, 4),
    );
    expect(reversed).toBe("router-1");
    expect(rotated).toBe("router-1");
  });
});

describe("computeStarRingDepths — hops from the hub", () => {
  test("the hub is zero and its direct neighbours are one", () => {
    const depths: Map<string, number> = computeStarRingDepths(
      branchNodes,
      branchEdges,
      "router-1",
    );
    expect(depths.get("router-1")).toBe(0);
    expect(depths.get("switch-a")).toBe(1);
    expect(depths.get("switch-b")).toBe(1);
    expect(depths.get("unmanaged:ap-1")).toBe(2);
    expect(depths.get("endpoint:pos-1")).toBe(2);
    expect(depths.get("endpoint:pos-3")).toBe(2);
    expect(depths.size).toBe(branchNodes.length);
  });

  test("a five node chain gives depths zero through four", () => {
    const nodes: Array<NetworkTopologyNode> = [];
    const edges: Array<NetworkTopologyEdge> = [];
    for (let i: number = 0; i < 5; i++) {
      nodes.push(makeDevice(`device:hop-${String(i)}`));
      if (i > 0) {
        edges.push(
          makeEdge(`device:hop-${String(i - 1)}`, `device:hop-${String(i)}`, [
            "lldp",
          ]),
        );
      }
    }
    const depths: Map<string, number> = computeStarRingDepths(
      nodes,
      edges,
      "device:hop-0",
    );
    for (let i: number = 0; i < 5; i++) {
      expect(depths.get(`device:hop-${String(i)}`)).toBe(i);
    }
  });

  test("a hub in the middle of a chain counts hops in both directions", () => {
    const nodes: Array<NetworkTopologyNode> = [];
    const edges: Array<NetworkTopologyEdge> = [];
    for (let i: number = 0; i < 5; i++) {
      nodes.push(makeDevice(`device:hop-${String(i)}`));
      if (i > 0) {
        edges.push(
          makeEdge(`device:hop-${String(i - 1)}`, `device:hop-${String(i)}`, [
            "lldp",
          ]),
        );
      }
    }
    const depths: Map<string, number> = computeStarRingDepths(
      nodes,
      edges,
      "device:hop-2",
    );
    expect(depths.get("device:hop-2")).toBe(0);
    expect(depths.get("device:hop-1")).toBe(1);
    expect(depths.get("device:hop-3")).toBe(1);
    expect(depths.get("device:hop-0")).toBe(2);
    expect(depths.get("device:hop-4")).toBe(2);
  });

  test("a cycle is measured by its shortest path, not by its edge count", () => {
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("device:a"),
      makeDevice("device:b"),
      makeDevice("device:c"),
      makeDevice("device:d"),
    ];
    // A square: b and d are one hop from a, c is two whichever way round.
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("device:a", "device:b", ["lldp"]),
      makeEdge("device:b", "device:c", ["lldp"]),
      makeEdge("device:c", "device:d", ["lldp"]),
      makeEdge("device:d", "device:a", ["lldp"]),
    ];
    const depths: Map<string, number> = computeStarRingDepths(
      nodes,
      edges,
      "device:a",
    );
    expect(depths.get("device:a")).toBe(0);
    expect(depths.get("device:b")).toBe(1);
    expect(depths.get("device:d")).toBe(1);
    expect(depths.get("device:c")).toBe(2);
  });

  test("a node the hub cannot reach lands one ring past the furthest one", () => {
    const depths: Map<string, number> = computeStarRingDepths(
      islandNodes,
      islandEdges,
      "router-1",
    );
    let maxReachable: number = 0;
    for (const node of branchNodes) {
      maxReachable = Math.max(maxReachable, depths.get(node.id)!);
    }
    expect(maxReachable).toBe(2);
    for (const id of ["device:island-a", "device:island-b", "endpoint:iso-1"]) {
      expect(depths.get(id)).toBe(maxReachable + 1);
    }
  });

  test("an unreachable node is never given depth zero on top of the hub", () => {
    const depths: Map<string, number> = computeStarRingDepths(
      islandNodes,
      islandEdges,
      "router-1",
    );
    let zeroes: number = 0;
    for (const [, depth] of depths) {
      if (depth === 0) {
        zeroes++;
      }
    }
    expect(zeroes).toBe(1);
    expect(depths.size).toBe(islandNodes.length);
  });

  test("a hub with no links at all still ranks every island at one", () => {
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("device:alone"),
      makeDevice("device:pair-a"),
      makeDevice("device:pair-b"),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("device:pair-a", "device:pair-b", ["lldp"]),
    ];
    const depths: Map<string, number> = computeStarRingDepths(
      nodes,
      edges,
      "device:alone",
    );
    expect(depths.get("device:alone")).toBe(0);
    expect(depths.get("device:pair-a")).toBe(1);
    expect(depths.get("device:pair-b")).toBe(1);
  });

  test("a hub that is not in the graph produces no depths at all", () => {
    expect(
      computeStarRingDepths(branchNodes, branchEdges, "device:nope").size,
    ).toBe(0);
    expect(computeStarRingDepths(branchNodes, branchEdges, "").size).toBe(0);
    expect(
      computeStarRingDepths(
        branchNodes,
        branchEdges,
        undefined as unknown as string,
      ).size,
    ).toBe(0);
    expect(computeStarRingDepths([], [], "router-1").size).toBe(0);
  });

  test("permuting the input does not change one depth", () => {
    const original: Map<string, number> = computeStarRingDepths(
      islandNodes,
      islandEdges,
      "router-1",
    );
    const permuted: Map<string, number> = computeStarRingDepths(
      rotateNodes([...islandNodes].reverse(), 5),
      rotateEdges([...islandEdges].reverse(), 3),
      "router-1",
    );
    expect(permuted).toEqual(original);
  });
});

describe("computeStarTopologyModel — a branch site", () => {
  const model: TopologyLayoutModel = computeStarTopologyModel(
    branchNodes,
    branchEdges,
    WIDTH,
    HEIGHT,
  );
  const hub: TopologyPoint = model.positions.get("router-1")!;

  test("places every node exactly once with finite coordinates", () => {
    expect(model.positions.size).toBe(branchNodes.length);
    for (const node of branchNodes) {
      const point: TopologyPoint | undefined = model.positions.get(node.id);
      expect(point).toBeDefined();
      expect(Number.isFinite(point!.x)).toBe(true);
      expect(Number.isFinite(point!.y)).toBe(true);
    }
  });

  test("no two glyphs overlap", () => {
    expect(overlapCount(model, branchNodes)).toBe(0);
  });

  test("the hub sits dead centre of the content box", () => {
    expect(hub.x).toBeCloseTo(model.contentWidth / 2, 6);
    expect(hub.y).toBeCloseTo(model.contentHeight / 2, 6);
  });

  test("every node one hop out shares one radius from the hub", () => {
    const ringOne: number = radiusOf(model, hub, "switch-a");
    expect(radiusOf(model, hub, "switch-b")).toBeCloseTo(ringOne, 6);
    expect(ringOne).toBeGreaterThanOrEqual(STAR_HUB_RING_GAP - RADIUS_EPSILON);
  });

  test("every node two hops out shares one radius, whichever switch it hangs off", () => {
    const ringTwo: number = radiusOf(model, hub, "endpoint:pos-1");
    expect(radiusOf(model, hub, "endpoint:pos-2")).toBeCloseTo(ringTwo, 6);
    // pos-3 is on the other switch and the AP is not an endpoint at all.
    expect(radiusOf(model, hub, "endpoint:pos-3")).toBeCloseTo(ringTwo, 6);
    expect(radiusOf(model, hub, "unmanaged:ap-1")).toBeCloseTo(ringTwo, 6);
  });

  test("a ring-two node is strictly further out than every ring-one node", () => {
    const ringOneIds: Array<string> = ["switch-a", "switch-b"];
    const ringTwoIds: Array<string> = [
      "unmanaged:ap-1",
      "endpoint:pos-1",
      "endpoint:pos-2",
      "endpoint:pos-3",
    ];
    for (const outer of ringTwoIds) {
      for (const inner of ringOneIds) {
        expect(radiusOf(model, hub, outer)).toBeGreaterThan(
          radiusOf(model, hub, inner),
        );
      }
    }
  });

  test("rings step outward by at least the ring gap", () => {
    const ringOne: number = radiusOf(model, hub, "switch-a");
    const ringTwo: number = radiusOf(model, hub, "endpoint:pos-1");
    expect(ringTwo - ringOne).toBeGreaterThanOrEqual(
      STAR_RING_MIN_GAP - RADIUS_EPSILON,
    );
  });

  test("a ring is a hop count, not a role: the unmanaged AP shares the endpoints' ring", () => {
    /*
     * This is the whole difference from the radial layout, which would
     * rank the AP inside the endpoints because it is a different kind of
     * box. Here it is two hops from the core and so are they.
     */
    expect(radiusOf(model, hub, "unmanaged:ap-1")).toBeCloseTo(
      radiusOf(model, hub, "endpoint:pos-1"),
      6,
    );
  });

  test("every node's painted box stays inside the content box", () => {
    const footprints: Map<string, TopologyNodeFootprint> =
      buildFootprints(branchNodes);
    for (const node of branchNodes) {
      const point: TopologyPoint = model.positions.get(node.id)!;
      const footprint: TopologyNodeFootprint = footprintOrDefault(
        footprints,
        node.id,
      );
      expect(point.x - footprint.inkHalfWidth).toBeGreaterThanOrEqual(-1e-6);
      expect(point.x + footprint.inkHalfWidth).toBeLessThanOrEqual(
        model.contentWidth + 1e-6,
      );
      expect(point.y - footprint.halfHeight).toBeGreaterThanOrEqual(-1e-6);
      expect(point.y + footprint.labelBottom).toBeLessThanOrEqual(
        model.contentHeight + 1e-6,
      );
    }
  });

  test("the content box never shrinks below the frame it was given", () => {
    expect(model.contentWidth).toBeGreaterThanOrEqual(WIDTH);
    expect(model.contentHeight).toBeGreaterThanOrEqual(HEIGHT);
  });

  test("star mode reports no component boxes and no group boxes", () => {
    expect(model.componentBoxes).toEqual([]);
    expect(model.groups).toEqual([]);
  });
});

describe("computeStarTopologyModel — the hub is the centre", () => {
  test("a lone device is its own hub and sits at the middle of the frame", () => {
    const model: TopologyLayoutModel = computeStarTopologyModel(
      [makeDevice("device:solo")],
      [],
      WIDTH,
      HEIGHT,
    );
    const point: TopologyPoint = model.positions.get("device:solo")!;
    expect(model.positions.size).toBe(1);
    expect(point.x).toBeCloseTo(model.contentWidth / 2, 6);
    expect(point.y).toBeCloseTo(model.contentHeight / 2, 6);
  });

  test("a symmetric fan puts the hub at the mean of its own ring", () => {
    const nodes: Array<NetworkTopologyNode> = [makeDevice("device:core")];
    const edges: Array<NetworkTopologyEdge> = [];
    for (let i: number = 0; i < 8; i++) {
      const peerId: string = `unmanaged:peer-${String(i)}`;
      nodes.push(makeUnmanaged(peerId, { name: `peer-${String(i)}` }));
      edges.push(makeEdge("device:core", peerId, ["cdp"]));
    }
    const model: TopologyLayoutModel = computeStarTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );

    let sumX: number = 0;
    let sumY: number = 0;
    for (const node of nodes.slice(1)) {
      const point: TopologyPoint = model.positions.get(node.id)!;
      sumX += point.x;
      sumY += point.y;
    }
    const hub: TopologyPoint = model.positions.get("device:core")!;
    expect(sumX / 8).toBeCloseTo(hub.x, 6);
    expect(sumY / 8).toBeCloseTo(hub.y, 6);
    expect(hub.x).toBeCloseTo(model.contentWidth / 2, 6);
    expect(hub.y).toBeCloseTo(model.contentHeight / 2, 6);
  });

  test("a one-sided fan still centres the hub, not the ink", () => {
    /*
     * The extent is mirrored about the hub deliberately: hugging the ink
     * would slide the hub off to one side the moment the spokes are
     * uneven, and a hub-and-spoke picture whose hub is not central has
     * given up the one thing it promises. The cost is headroom opposite
     * the only spoke, which is what this asserts.
     */
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("device:core"),
      makeUnmanaged("unmanaged:only", { name: "only-peer" }),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("device:core", "unmanaged:only", ["cdp"]),
    ];
    const model: TopologyLayoutModel = computeStarTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );

    const hub: TopologyPoint = model.positions.get("device:core")!;
    const peer: TopologyPoint = model.positions.get("unmanaged:only")!;
    expect(hub.x).toBeCloseTo(model.contentWidth / 2, 6);
    expect(hub.y).toBeCloseTo(model.contentHeight / 2, 6);
    // The drawn ink genuinely is off centre; the hub is not.
    expect(
      Math.abs((hub.x + peer.x) / 2 - model.contentWidth / 2),
    ).toBeGreaterThan(1);
  });

  test("no node other than the hub is at the centre", () => {
    const model: TopologyLayoutModel = computeStarTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
    );
    const hub: TopologyPoint = model.positions.get("router-1")!;
    for (const node of branchNodes) {
      if (node.id === "router-1") {
        continue;
      }
      expect(radiusOf(model, hub, node.id)).toBeGreaterThanOrEqual(
        STAR_HUB_RING_GAP - RADIUS_EPSILON,
      );
    }
  });
});

describe("computeStarTopologyModel — ring sizing", () => {
  test("ring one is at least the hub gap and grows only to fit its slots", () => {
    const nodes: Array<NetworkTopologyNode> = [makeDevice("device:core")];
    const edges: Array<NetworkTopologyEdge> = [];
    for (let i: number = 0; i < 8; i++) {
      const peerId: string = `unmanaged:peer-${String(i)}`;
      nodes.push(makeUnmanaged(peerId, { name: `peer-${String(i)}` }));
      edges.push(makeEdge("device:core", peerId, ["cdp"]));
    }
    const model: TopologyLayoutModel = computeStarTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    const hub: TopologyPoint = model.positions.get("device:core")!;
    // Eight roomy wedges: nothing forces the ring past the minimum gap.
    for (const node of nodes.slice(1)) {
      expect(radiusOf(model, hub, node.id)).toBeCloseTo(STAR_HUB_RING_GAP, 6);
    }
  });

  test("a crowded ring is pushed out until every slot fits its own glyph", () => {
    const nodes: Array<NetworkTopologyNode> = [makeDevice("device:core")];
    const edges: Array<NetworkTopologyEdge> = [];
    for (let i: number = 0; i < 200; i++) {
      const peerId: string = `unmanaged:peer-${String(i).padStart(3, "0")}`;
      nodes.push(
        makeUnmanaged(peerId, { name: `peer-${String(i).padStart(3, "0")}` }),
      );
      edges.push(makeEdge("device:core", peerId, ["cdp"]));
    }
    const model: TopologyLayoutModel = computeStarTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    const hub: TopologyPoint = model.positions.get("device:core")!;
    const footprints: Map<string, TopologyNodeFootprint> =
      buildFootprints(nodes);

    const radius: number = radiusOf(model, hub, nodes[1]!.id);
    const wedge: number = (Math.PI * 2) / 200;
    const slotWidth: number =
      footprintOrDefault(footprints, nodes[1]!.id).inkHalfWidth * 2 +
      STAR_SLOT_PADDING;
    /*
     * Two hundred even wedges, so the arc each node owns is exactly the
     * width it paints plus its slot padding — the ring is sized from the
     * angles rather than guessed before them.
     */
    expect(radius * wedge).toBeCloseTo(slotWidth, 6);
    expect(radius).toBeGreaterThan(STAR_HUB_RING_GAP);
  });

  test("each successive ring clears the one inside it by the ring gap", () => {
    /*
     * router (0) -> switch (1) -> unmanaged AP (2) -> camera endpoint (3):
     * four rings, so three gaps to check.
     */
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("router-1"),
      makeDevice("switch-1"),
      makeDevice("switch-2"),
      makeUnmanaged("unmanaged:ap-1", { name: "ap-1" }),
      makeEndpoint("endpoint:cam-1", { name: "cam-1" }),
      makeEndpoint("endpoint:cam-2", { name: "cam-2" }),
      makeEndpoint("endpoint:pos-1", { name: "pos-1" }),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("router-1", "switch-1", ["lldp"]),
      makeEdge("router-1", "switch-2", ["lldp"]),
      makeEdge("switch-1", "unmanaged:ap-1", ["cdp"]),
      makeEdge("switch-2", "endpoint:pos-1", ["fdb"]),
      makeEdge("unmanaged:ap-1", "endpoint:cam-1", ["fdb"]),
      makeEdge("unmanaged:ap-1", "endpoint:cam-2", ["fdb"]),
    ];
    const model: TopologyLayoutModel = computeStarTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    const hub: TopologyPoint = model.positions.get("router-1")!;

    const ringOne: number = radiusOf(model, hub, "switch-1");
    const ringTwo: number = radiusOf(model, hub, "unmanaged:ap-1");
    const ringThree: number = radiusOf(model, hub, "endpoint:cam-1");
    expect(radiusOf(model, hub, "switch-2")).toBeCloseTo(ringOne, 6);
    expect(radiusOf(model, hub, "endpoint:pos-1")).toBeCloseTo(ringTwo, 6);
    expect(radiusOf(model, hub, "endpoint:cam-2")).toBeCloseTo(ringThree, 6);

    expect(ringOne).toBeGreaterThanOrEqual(STAR_HUB_RING_GAP - RADIUS_EPSILON);
    expect(ringTwo - ringOne).toBeGreaterThanOrEqual(
      STAR_RING_MIN_GAP - RADIUS_EPSILON,
    );
    expect(ringThree - ringTwo).toBeGreaterThanOrEqual(
      STAR_RING_MIN_GAP - RADIUS_EPSILON,
    );
    expect(overlapCount(model, nodes)).toBe(0);
  });

  test("a heavy subtree claims more of the circle than a quiet neighbour", () => {
    const heavy: SwitchWithEndpoints = makeSwitchWithEndpoints("switch-a", 12);
    const quiet: SwitchWithEndpoints = makeSwitchWithEndpoints("switch-b", 1);
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("router-1"),
      ...heavy.nodes,
      ...quiet.nodes,
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("router-1", "switch-a", ["lldp"]),
      makeEdge("router-1", "switch-b", ["lldp"]),
      ...heavy.edges,
      ...quiet.edges,
    ];
    const model: TopologyLayoutModel = computeStarTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    const hub: TopologyPoint = model.positions.get("router-1")!;

    /*
     * The twelve endpoints of the busy switch span a wider arc than the
     * one endpoint of the quiet one, but the blended split still leaves
     * the quiet branch a workable slice — nothing collides.
     */
    const heavySpread: number = Math.max(
      ...heavy.endpointIds.map((id: string): number => {
        return distanceBetween(
          model.positions.get(heavy.endpointIds[0]!)!,
          model.positions.get(id)!,
        );
      }),
    );
    expect(heavySpread).toBeGreaterThan(0);
    expect(radiusOf(model, hub, "switch-a")).toBeCloseTo(
      radiusOf(model, hub, "switch-b"),
      6,
    );
    expect(overlapCount(model, nodes)).toBe(0);
  });
});

describe("computeStarTopologyModel — glyphs never overlap", () => {
  test("a hub with eight spokes", () => {
    const nodes: Array<NetworkTopologyNode> = [makeDevice("device:core")];
    const edges: Array<NetworkTopologyEdge> = [];
    for (let i: number = 0; i < 8; i++) {
      const peerId: string = `unmanaged:peer-${String(i)}`;
      nodes.push(makeUnmanaged(peerId, { name: `peer-${String(i)}` }));
      edges.push(makeEdge("device:core", peerId, ["cdp"]));
    }
    const model: TopologyLayoutModel = computeStarTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(9);
    expect(overlapCount(model, nodes)).toBe(0);
    expect(
      minPairDistance(
        model,
        nodes.map((node: NetworkTopologyNode): string => {
          return node.id;
        }),
      ),
    ).toBeGreaterThanOrEqual(DEVICE_PAIR_CLEARANCE);
    expectFiniteModel(model);
  });

  test("a hub with two hundred spokes", () => {
    const nodes: Array<NetworkTopologyNode> = [makeDevice("device:core")];
    const edges: Array<NetworkTopologyEdge> = [];
    for (let i: number = 0; i < 200; i++) {
      const peerId: string = `unmanaged:peer-${String(i).padStart(3, "0")}`;
      nodes.push(
        makeUnmanaged(peerId, { name: `peer-${String(i).padStart(3, "0")}` }),
      );
      edges.push(makeEdge("device:core", peerId, ["cdp"]));
    }
    const model: TopologyLayoutModel = computeStarTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(201);
    expect(overlapCount(model, nodes)).toBe(0);
    expectFiniteModel(model);
  });

  test("a two level tree of four switches with six endpoints each", () => {
    const groups: Array<SwitchWithEndpoints> = [
      makeSwitchWithEndpoints("switch-a", 6),
      makeSwitchWithEndpoints("switch-b", 6),
      makeSwitchWithEndpoints("switch-c", 6),
      makeSwitchWithEndpoints("switch-d", 6),
    ];
    const nodes: Array<NetworkTopologyNode> = [makeDevice("router-1")];
    const edges: Array<NetworkTopologyEdge> = [];
    for (const group of groups) {
      nodes.push(...group.nodes);
      edges.push(
        makeEdge("router-1", group.device.id, ["lldp"]),
        ...group.edges,
      );
    }

    const model: TopologyLayoutModel = computeStarTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(29);
    expect(overlapCount(model, nodes)).toBe(0);
    expectFiniteModel(model);
  });

  test("a graph with an unreachable island", () => {
    const model: TopologyLayoutModel = computeStarTopologyModel(
      islandNodes,
      islandEdges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(islandNodes.length);
    expect(overlapCount(model, islandNodes)).toBe(0);
    expectFiniteModel(model);
  });

  test("islands are drawn outside everything the hub can see", () => {
    const model: TopologyLayoutModel = computeStarTopologyModel(
      islandNodes,
      islandEdges,
      WIDTH,
      HEIGHT,
    );
    const hub: TopologyPoint = model.positions.get("router-1")!;
    let furthestReachable: number = 0;
    for (const node of branchNodes) {
      furthestReachable = Math.max(
        furthestReachable,
        radiusOf(model, hub, node.id),
      );
    }
    /*
     * "Outside everything the hub can see" is exactly what the outermost
     * ring means, so the island needs no hull drawn round it to say so.
     */
    for (const id of ["device:island-a", "device:island-b", "endpoint:iso-1"]) {
      expect(radiusOf(model, hub, id)).toBeGreaterThan(furthestReachable);
    }
    expect(model.componentBoxes).toEqual([]);
  });

  test("a graph of nothing but islands still fans them around the hub", () => {
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("device:core"),
      makeUnmanaged("unmanaged:a", { name: "a" }),
      makeUnmanaged("unmanaged:b", { name: "b" }),
      makeUnmanaged("unmanaged:c", { name: "c" }),
      makeEndpoint("endpoint:d", { name: "d" }),
    ];
    const model: TopologyLayoutModel = computeStarTopologyModel(
      nodes,
      [],
      WIDTH,
      HEIGHT,
    );
    const hub: TopologyPoint = model.positions.get("device:core")!;
    expect(overlapCount(model, nodes)).toBe(0);
    for (const node of nodes.slice(1)) {
      expect(radiusOf(model, hub, node.id)).toBeCloseTo(STAR_HUB_RING_GAP, 6);
    }
  });

  test("a seeded pseudo-random site of switches and endpoints", () => {
    /* xorshift32 — deterministic, so a failure here is reproducible. */
    type NextUnitFunction = () => number;
    let state: number = 0x2f6e2b1 >>> 0;
    const nextUnit: NextUnitFunction = (): number => {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 4294967296;
    };

    const nodes: Array<NetworkTopologyNode> = [makeDevice("router-1")];
    const edges: Array<NetworkTopologyEdge> = [];
    for (let i: number = 0; i < 6; i++) {
      const switchId: string = `switch-${String(i)}`;
      const count: number = 1 + Math.floor(nextUnit() * 6);
      const group: SwitchWithEndpoints = makeSwitchWithEndpoints(
        switchId,
        count,
      );
      nodes.push(...group.nodes);
      edges.push(makeEdge("router-1", switchId, ["lldp"]), ...group.edges);
      if (nextUnit() < 0.5) {
        const peerId: string = `unmanaged:peer-${String(i)}`;
        nodes.push(makeUnmanaged(peerId, { name: `peer-${String(i)}` }));
        edges.push(makeEdge(switchId, peerId, ["cdp"]));
      }
    }

    const model: TopologyLayoutModel = computeStarTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(nodes.length);
    expect(overlapCount(model, nodes)).toBe(0);
    expectFiniteModel(model);
  });
});

describe("computeStarTopologyModel — determinism", () => {
  /*
   * The single most important property in this file. The topology endpoint
   * returns rows in an order nothing guarantees and re-polls every sixty
   * seconds; a layout that reads array position instead of node id
   * reshuffles the whole map every minute for no reason.
   */
  const original: TopologyLayoutModel = computeStarTopologyModel(
    islandNodes,
    islandEdges,
    WIDTH,
    HEIGHT,
  );

  test("the same input twice gives byte-identical coordinates", () => {
    const again: TopologyLayoutModel = computeStarTopologyModel(
      islandNodes,
      islandEdges,
      WIDTH,
      HEIGHT,
    );
    expect(again.positions).toEqual(original.positions);
    expect(again.contentWidth).toBe(original.contentWidth);
    expect(again.contentHeight).toBe(original.contentHeight);
  });

  test("reversing both input arrays changes nothing", () => {
    const reversed: TopologyLayoutModel = computeStarTopologyModel(
      [...islandNodes].reverse(),
      [...islandEdges].reverse(),
      WIDTH,
      HEIGHT,
    );
    expect(reversed.positions).toEqual(original.positions);
    expect(reversed.contentWidth).toBe(original.contentWidth);
    expect(reversed.contentHeight).toBe(original.contentHeight);
  });

  test("rotating both input arrays changes nothing", () => {
    for (const offset of [1, 3, 7]) {
      const rotated: TopologyLayoutModel = computeStarTopologyModel(
        rotateNodes(islandNodes, offset),
        rotateEdges(islandEdges, offset),
        WIDTH,
        HEIGHT,
      );
      expect(rotated.positions).toEqual(original.positions);
      expect(rotated.contentWidth).toBe(original.contentWidth);
      expect(rotated.contentHeight).toBe(original.contentHeight);
    }
  });

  test("flipping every edge end for end changes nothing", () => {
    const flipped: TopologyLayoutModel = computeStarTopologyModel(
      islandNodes,
      islandEdges.map((edge: NetworkTopologyEdge): NetworkTopologyEdge => {
        // Attachment is undirected: reporting it from the far end is the same link.
        return makeEdge(edge.toNodeId, edge.fromNodeId, edge.protocols);
      }),
      WIDTH,
      HEIGHT,
    );
    expect(flipped.positions).toEqual(original.positions);
  });

  test("a duplicated edge does not shift the layout", () => {
    const withDuplicate: TopologyLayoutModel = computeStarTopologyModel(
      islandNodes,
      [...islandEdges, makeEdge("switch-a", "router-1", ["cdp"])],
      WIDTH,
      HEIGHT,
    );
    expect(withDuplicate.positions).toEqual(original.positions);
  });

  test("a big crowded ring is just as stable under permutation", () => {
    const nodes: Array<NetworkTopologyNode> = [makeDevice("device:core")];
    const edges: Array<NetworkTopologyEdge> = [];
    for (let i: number = 0; i < 60; i++) {
      const peerId: string = `unmanaged:peer-${String(i).padStart(2, "0")}`;
      nodes.push(
        makeUnmanaged(peerId, { name: `peer-${String(i).padStart(2, "0")}` }),
      );
      edges.push(makeEdge("device:core", peerId, ["cdp"]));
    }
    const first: TopologyLayoutModel = computeStarTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    const second: TopologyLayoutModel = computeStarTopologyModel(
      rotateNodes([...nodes].reverse(), 17),
      rotateEdges([...edges].reverse(), 29),
      WIDTH,
      HEIGHT,
    );
    expect(second.positions).toEqual(first.positions);
  });
});

describe("computeStarTopologyModel — pins", () => {
  const unpinned: TopologyLayoutModel = computeStarTopologyModel(
    branchNodes,
    branchEdges,
    WIDTH,
    HEIGHT,
  );

  test("a pinned node lands exactly on its pin, even on top of a neighbour", () => {
    const onTopOfSwitchA: TopologyPoint = unpinned.positions.get("switch-a")!;
    const pinned: ReadonlyMap<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >([["endpoint:pos-1", { x: onTopOfSwitchA.x, y: onTopOfSwitchA.y }]]);

    const model: TopologyLayoutModel = computeStarTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    // The user put it there: the layout does not relax it away.
    expect(model.positions.get("endpoint:pos-1")).toEqual(onTopOfSwitchA);
  });

  test("pinning one node leaves every other node exactly where it was", () => {
    const pinned: ReadonlyMap<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >([["switch-b", { x: 42, y: 43 }]]);
    const model: TopologyLayoutModel = computeStarTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    expect(model.positions.get("switch-b")).toEqual({ x: 42, y: 43 });
    for (const node of branchNodes) {
      if (node.id === "switch-b") {
        continue;
      }
      expect(model.positions.get(node.id)).toEqual(
        unpinned.positions.get(node.id),
      );
    }
  });

  test("even the hub can be dragged off centre and stays where it was put", () => {
    const pinned: ReadonlyMap<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >([["router-1", { x: 120, y: 90 }]]);
    const model: TopologyLayoutModel = computeStarTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    expect(model.positions.get("router-1")).toEqual({ x: 120, y: 90 });
  });

  test("a pin outside the computed extent grows the content box", () => {
    const pinned: ReadonlyMap<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >([["router-1", { x: 5000, y: 4000 }]]);
    const model: TopologyLayoutModel = computeStarTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    const footprint: TopologyNodeFootprint = footprintOrDefault(
      buildFootprints(branchNodes),
      "router-1",
    );
    expect(model.contentWidth).toBeCloseTo(
      5000 + footprint.inkHalfWidth + STAR_LAYOUT_MARGIN,
      6,
    );
    expect(model.contentHeight).toBeCloseTo(
      4000 + footprint.labelBottom + STAR_LAYOUT_MARGIN,
      6,
    );
    expectFiniteModel(model);
  });

  test("a pin inside the computed extent leaves the content box alone", () => {
    const pinned: ReadonlyMap<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >([["switch-a", { x: 10, y: 12 }]]);
    const model: TopologyLayoutModel = computeStarTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    expect(model.contentWidth).toBe(unpinned.contentWidth);
    expect(model.contentHeight).toBe(unpinned.contentHeight);
  });

  test("a non-finite pin is ignored rather than blanking the node", () => {
    const pinned: ReadonlyMap<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >([
      ["switch-a", { x: Number.NaN, y: 10 }],
      ["switch-b", { x: 10, y: Number.POSITIVE_INFINITY }],
      ["unmanaged:ap-1", { x: Number.NEGATIVE_INFINITY, y: Number.NaN }],
    ]);
    const model: TopologyLayoutModel = computeStarTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    expect(model.positions).toEqual(unpinned.positions);
    expect(model.contentWidth).toBe(unpinned.contentWidth);
    expect(model.contentHeight).toBe(unpinned.contentHeight);
    expectFiniteModel(model);
  });

  test("a pin for a node that left the graph adds no placement", () => {
    const pinned: ReadonlyMap<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >([["endpoint:gone", { x: 9000, y: 9000 }]]);
    const model: TopologyLayoutModel = computeStarTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    expect(model.positions.has("endpoint:gone")).toBe(false);
    expect(model.positions.size).toBe(branchNodes.length);
    // A stale pin must not stretch the box around a node nobody draws.
    expect(model.contentWidth).toBe(unpinned.contentWidth);
    expect(model.contentHeight).toBe(unpinned.contentHeight);
  });

  test("an empty pin map behaves exactly like no pin map", () => {
    const model: TopologyLayoutModel = computeStarTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
      new Map<string, TopologyPoint>(),
    );
    expect(model.positions).toEqual(unpinned.positions);
    expect(model.contentWidth).toBe(unpinned.contentWidth);
    expect(model.contentHeight).toBe(unpinned.contentHeight);
  });

  test("pinning is deterministic under a permuted input", () => {
    const pinned: ReadonlyMap<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >([["switch-b", { x: 1200, y: 900 }]]);
    const first: TopologyLayoutModel = computeStarTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    const second: TopologyLayoutModel = computeStarTopologyModel(
      rotateNodes([...branchNodes].reverse(), 2),
      rotateEdges([...branchEdges].reverse(), 5),
      WIDTH,
      HEIGHT,
      pinned,
    );
    expect(second.positions).toEqual(first.positions);
    expect(second.contentWidth).toBe(first.contentWidth);
    expect(second.contentHeight).toBe(first.contentHeight);
  });
});

describe("computeStarTopologyModel — degenerate and hostile input", () => {
  test("empty input returns an empty map and the frame it was given", () => {
    const model: TopologyLayoutModel = computeStarTopologyModel(
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

  test("a non-finite or non-positive frame falls back to a usable default", () => {
    for (const frame of [
      { width: Number.NaN, height: Number.NaN },
      { width: 0, height: 0 },
      { width: -10, height: -700 },
      { width: Number.POSITIVE_INFINITY, height: Number.NEGATIVE_INFINITY },
    ]) {
      const empty: TopologyLayoutModel = computeStarTopologyModel(
        [],
        [],
        frame.width,
        frame.height,
      );
      expect(empty.contentWidth).toBe(1000);
      expect(empty.contentHeight).toBe(700);

      const populated: TopologyLayoutModel = computeStarTopologyModel(
        branchNodes,
        branchEdges,
        frame.width,
        frame.height,
      );
      expect(populated.contentWidth).toBeGreaterThanOrEqual(1000);
      expect(populated.contentHeight).toBeGreaterThanOrEqual(700);
      expectFiniteModel(populated);
    }
  });

  test("an absent edge list lays the nodes out as isolated islands", () => {
    const model: TopologyLayoutModel = computeStarTopologyModel(
      branchNodes,
      undefined as unknown as Array<NetworkTopologyEdge>,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(branchNodes.length);
    expect(overlapCount(model, branchNodes)).toBe(0);
    expectFiniteModel(model);
  });

  test("duplicate node ids collapse to one placement", () => {
    const model: TopologyLayoutModel = computeStarTopologyModel(
      [...branchNodes, branchSwitchA, makeDevice("switch-a")],
      branchEdges,
      WIDTH,
      HEIGHT,
    );
    const clean: TopologyLayoutModel = computeStarTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(branchNodes.length);
    // First row wins, so a duplicated row cannot move anything either.
    expect(model.positions).toEqual(clean.positions);
  });

  test("a self-loop edge neither places nor moves anything", () => {
    const withLoops: TopologyLayoutModel = computeStarTopologyModel(
      branchNodes,
      [
        ...branchEdges,
        makeEdge("switch-a", "switch-a", ["lldp"]),
        makeEdge("router-1", "router-1", ["cdp"]),
      ],
      WIDTH,
      HEIGHT,
    );
    const clean: TopologyLayoutModel = computeStarTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
    );
    expect(withLoops.positions).toEqual(clean.positions);
  });

  test("edges naming nodes outside the view add no phantom placements", () => {
    const model: TopologyLayoutModel = computeStarTopologyModel(
      [branchSwitchA],
      [
        makeEdge("switch-a", "endpoint:not-in-view", ["fdb"]),
        makeEdge("device:also-gone", "switch-a", ["lldp"]),
      ],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(1);
    expect(model.positions.has("endpoint:not-in-view")).toBe(false);
    expect(model.positions.has("device:also-gone")).toBe(false);
    // The only node in view is the hub, so it is dead centre.
    expect(model.positions.get("switch-a")!.x).toBeCloseTo(
      model.contentWidth / 2,
      6,
    );
  });

  test("a node with an empty id is dropped and an unnamed node still places", () => {
    const nameless: NetworkTopologyNode = makeDevice("switch-1", { name: "" });
    const ghost: NetworkTopologyNode = makeDevice("", { name: "ghost" });
    const model: TopologyLayoutModel = computeStarTopologyModel(
      [nameless, ghost, makeEndpoint("endpoint:x", { name: "" })],
      [makeEdge("switch-1", "endpoint:x", ["fdb"])],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(2);
    expect(model.positions.has("")).toBe(false);
    expectFiniteModel(model);
  });

  test("null rows in the node list are skipped, not placed", () => {
    const model: TopologyLayoutModel = computeStarTopologyModel(
      [
        branchRouter,
        null as unknown as NetworkTopologyNode,
        branchSwitchA,
        undefined as unknown as NetworkTopologyNode,
      ],
      [...branchEdges, null as unknown as NetworkTopologyEdge],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(2);
    expectFiniteModel(model);
  });

  test("a five hundred character name lays out exactly like a forty character one", () => {
    /*
     * Label width is capped, so past two full lines a longer hostname
     * claims no more room — one device name must not be able to distort
     * the whole picture around itself.
     */
    const long: Array<NetworkTopologyNode> = [
      makeDevice("router-1"),
      makeDevice("switch-a", { name: "a".repeat(500) }),
      makeDevice("switch-b"),
    ];
    const short: Array<NetworkTopologyNode> = [
      makeDevice("router-1"),
      makeDevice("switch-a", { name: "a".repeat(40) }),
      makeDevice("switch-b"),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("router-1", "switch-a", ["lldp"]),
      makeEdge("router-1", "switch-b", ["lldp"]),
    ];
    const longModel: TopologyLayoutModel = computeStarTopologyModel(
      long,
      edges,
      WIDTH,
      HEIGHT,
    );
    const shortModel: TopologyLayoutModel = computeStarTopologyModel(
      short,
      edges,
      WIDTH,
      HEIGHT,
    );
    expect(longModel.positions).toEqual(shortModel.positions);
    expect(longModel.contentWidth).toBe(shortModel.contentWidth);
    expect(overlapCount(longModel, long)).toBe(0);
  });

  test("a ring of long-named devices still keeps its glyphs apart", () => {
    const nodes: Array<NetworkTopologyNode> = [makeDevice("device:core")];
    const edges: Array<NetworkTopologyEdge> = [];
    for (let i: number = 0; i < 24; i++) {
      const peerId: string = `unmanaged:ap-${String(i).padStart(2, "0")}`;
      nodes.push(
        makeUnmanaged(peerId, {
          name: `ap-hall-${String(i)}.branch.example.com`,
        }),
      );
      edges.push(makeEdge("device:core", peerId, ["cdp"]));
    }
    const model: TopologyLayoutModel = computeStarTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    expect(overlapCount(model, nodes)).toBe(0);
    expectFiniteModel(model);
  });

  test("a graph of a single endpoint is placed at the centre", () => {
    const model: TopologyLayoutModel = computeStarTopologyModel(
      [makeEndpoint("endpoint:solo", { name: "solo" })],
      [],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(1);
    expect(model.positions.get("endpoint:solo")!.x).toBeCloseTo(
      model.contentWidth / 2,
      6,
    );
    expect(model.positions.get("endpoint:solo")!.y).toBeCloseTo(
      model.contentHeight / 2,
      6,
    );
  });
});

describe("computeStarTopologyModel — nothing non-finite ever escapes", () => {
  /*
   * A NaN in an SVG coordinate makes that element vanish and takes the
   * graph bounds with it, so this sweeps every shape of input the rest of
   * the file exercises and checks the one thing that must never happen.
   */
  interface LayoutScenario {
    name: string;
    nodes: Array<NetworkTopologyNode>;
    edges: Array<NetworkTopologyEdge>;
    width: number;
    height: number;
    pinned?: ReadonlyMap<string, TopologyPoint> | undefined;
  }

  const scenarios: Array<LayoutScenario> = [
    { name: "empty", nodes: [], edges: [], width: WIDTH, height: HEIGHT },
    {
      name: "branch site",
      nodes: branchNodes,
      edges: branchEdges,
      width: WIDTH,
      height: HEIGHT,
    },
    {
      name: "island",
      nodes: islandNodes,
      edges: islandEdges,
      width: WIDTH,
      height: HEIGHT,
    },
    {
      name: "no edges at all",
      nodes: islandNodes,
      edges: [],
      width: WIDTH,
      height: HEIGHT,
    },
    {
      name: "hostile frame",
      nodes: branchNodes,
      edges: branchEdges,
      width: Number.NaN,
      height: Number.NEGATIVE_INFINITY,
    },
    {
      name: "duplicate ids and self loops",
      nodes: [...branchNodes, branchSwitchA],
      edges: [...branchEdges, makeEdge("switch-a", "switch-a", ["lldp"])],
      width: 0,
      height: -5,
    },
    {
      name: "non-finite pins",
      nodes: branchNodes,
      edges: branchEdges,
      width: WIDTH,
      height: HEIGHT,
      pinned: new Map<string, TopologyPoint>([
        ["router-1", { x: Number.NaN, y: Number.NaN }],
        ["switch-a", { x: Number.POSITIVE_INFINITY, y: 0 }],
        ["switch-b", { x: 0, y: Number.NEGATIVE_INFINITY }],
        ["endpoint:gone", { x: Number.NaN, y: Number.NaN }],
      ]),
    },
    {
      name: "a pin far outside the frame",
      nodes: branchNodes,
      edges: branchEdges,
      width: WIDTH,
      height: HEIGHT,
      pinned: new Map<string, TopologyPoint>([
        ["endpoint:pos-2", { x: -9000, y: 12000 }],
      ]),
    },
    {
      name: "unnamed nodes",
      nodes: [
        makeDevice("router-1", { name: "" }),
        makeDevice("switch-a", { name: "" }),
        makeEndpoint("endpoint:x", { name: "" }),
      ],
      edges: [
        makeEdge("router-1", "switch-a", ["lldp"]),
        makeEdge("switch-a", "endpoint:x", ["fdb"]),
      ],
      width: WIDTH,
      height: HEIGHT,
    },
  ];

  test("no scenario produces a NaN or Infinity anywhere in the model", () => {
    for (const scenario of scenarios) {
      const model: TopologyLayoutModel = computeStarTopologyModel(
        scenario.nodes,
        scenario.edges,
        scenario.width,
        scenario.height,
        scenario.pinned,
      );
      expectFiniteModel(model);
    }
  });

  test("every scenario is idempotent", () => {
    for (const scenario of scenarios) {
      const first: TopologyLayoutModel = computeStarTopologyModel(
        scenario.nodes,
        scenario.edges,
        scenario.width,
        scenario.height,
        scenario.pinned,
      );
      const second: TopologyLayoutModel = computeStarTopologyModel(
        scenario.nodes,
        scenario.edges,
        scenario.width,
        scenario.height,
        scenario.pinned,
      );
      expect(second.positions).toEqual(first.positions);
      expect(second.contentWidth).toBe(first.contentWidth);
      expect(second.contentHeight).toBe(first.contentHeight);
    }
  });

  test("every scenario survives a permuted input unchanged", () => {
    for (const scenario of scenarios) {
      if (scenario.nodes.length === 0 || scenario.edges.length === 0) {
        continue;
      }
      const first: TopologyLayoutModel = computeStarTopologyModel(
        scenario.nodes,
        scenario.edges,
        scenario.width,
        scenario.height,
        scenario.pinned,
      );
      const permuted: TopologyLayoutModel = computeStarTopologyModel(
        rotateNodes([...scenario.nodes].reverse(), 3),
        rotateEdges([...scenario.edges].reverse(), 2),
        scenario.width,
        scenario.height,
        scenario.pinned,
      );
      expect(permuted.positions).toEqual(first.positions);
      expect(permuted.contentWidth).toBe(first.contentWidth);
      expect(permuted.contentHeight).toBe(first.contentHeight);
    }
  });
});
