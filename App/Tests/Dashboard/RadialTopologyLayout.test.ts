import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  RADIAL_CORE_RADIUS,
  RADIAL_LAYOUT_MARGIN,
  RADIAL_RING_MIN_GAP,
  computeRadialTopologyModel,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/RadialTopologyLayout";
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
import { TopologyLayoutModel } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyModel";

const WIDTH: number = 1000;
const HEIGHT: number = 700;

/*
 * Two device glyphs are 16px radii plus 8px of collision padding each, so
 * anything closer than this is a literal overlap. Kept here so the ring
 * assertions read as the contract rather than as a magic number.
 */
const DEVICE_PAIR_CLEARANCE: number = 48;

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

/* Angle of a placed node around the layout centre, in [0, 2pi). */
type AngleFunction = (
  model: TopologyLayoutModel,
  centre: TopologyPoint,
  id: string,
) => number;
const angleOf: AngleFunction = (
  model: TopologyLayoutModel,
  centre: TopologyPoint,
  id: string,
): number => {
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

/*
 * How many contiguous angular runs the given grouping forms around the
 * ring. One run per group means no subtree's spoke crosses another's.
 */
interface AngularEntry {
  angle: number;
  group: string;
}

type AngularBlockCountFunction = (
  model: TopologyLayoutModel,
  centre: TopologyPoint,
  groupByNodeId: Map<string, string>,
) => number;
const angularBlockCount: AngularBlockCountFunction = (
  model: TopologyLayoutModel,
  centre: TopologyPoint,
  groupByNodeId: Map<string, string>,
): number => {
  const entries: Array<AngularEntry> = [];
  for (const [id, group] of groupByNodeId) {
    entries.push({ angle: angleOf(model, centre, id), group: group });
  }
  entries.sort((a: AngularEntry, b: AngularEntry): number => {
    return a.angle - b.angle;
  });
  let runs: number = 0;
  for (let i: number = 0; i < entries.length; i++) {
    const previous: AngularEntry =
      entries[(i + entries.length - 1) % entries.length]!;
    if (previous.group !== entries[i]!.group) {
      runs++;
    }
  }
  return Math.max(1, runs);
};

/*
 * Canonical branch site: one router, two switches over LLDP, endpoints
 * over FDB, plus an unmanaged access point whose only link is to a switch
 * (so it has no parent one rank inward and roots its own wedge).
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

describe("computeRadialTopologyModel — a branch site", () => {
  const model: TopologyLayoutModel = computeRadialTopologyModel(
    branchNodes,
    branchEdges,
    WIDTH,
    HEIGHT,
  );
  // One router at the innermost rank, so it is placed at radius zero.
  const centre: TopologyPoint = model.positions.get("router-1")!;

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

  test("every node of one role rank shares one radius from the centre", () => {
    const switchRadius: number = radiusOf(model, centre, "switch-a");
    expect(radiusOf(model, centre, "switch-b")).toBeCloseTo(switchRadius, 6);
    // The unmanaged peer is a rank-1 role too, even with no parent.
    expect(radiusOf(model, centre, "unmanaged:ap-1")).toBeCloseTo(
      switchRadius,
      6,
    );

    const endpointRadius: number = radiusOf(model, centre, "endpoint:pos-1");
    expect(radiusOf(model, centre, "endpoint:pos-2")).toBeCloseTo(
      endpointRadius,
      6,
    );
    // pos-3 hangs off the other switch and still lands on the same rim.
    expect(radiusOf(model, centre, "endpoint:pos-3")).toBeCloseTo(
      endpointRadius,
      6,
    );
  });

  test("an endpoint is never closer to the centre than its own switch", () => {
    expect(radiusOf(model, centre, "endpoint:pos-1")).toBeGreaterThan(
      radiusOf(model, centre, "switch-a"),
    );
    expect(radiusOf(model, centre, "endpoint:pos-3")).toBeGreaterThan(
      radiusOf(model, centre, "switch-b"),
    );
  });

  test("rings step outward by at least the ring gap", () => {
    const switchRadius: number = radiusOf(model, centre, "switch-a");
    const endpointRadius: number = radiusOf(model, centre, "endpoint:pos-1");
    expect(switchRadius).toBeGreaterThanOrEqual(RADIAL_RING_MIN_GAP);
    expect(endpointRadius - switchRadius).toBeGreaterThanOrEqual(
      RADIAL_RING_MIN_GAP,
    );
  });

  test("the painted extent is centred inside the reported content box", () => {
    const footprints: Map<string, TopologyNodeFootprint> =
      buildFootprints(branchNodes);
    let minX: number = Infinity;
    let maxX: number = -Infinity;
    let minY: number = Infinity;
    let maxY: number = -Infinity;
    for (const node of branchNodes) {
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

  test("radial mode reports no component boxes and no group boxes", () => {
    expect(model.componentBoxes).toEqual([]);
    expect(model.groups).toEqual([]);
  });
});

describe("computeRadialTopologyModel — glyphs never overlap", () => {
  test("a pure star of eight peers around one core", () => {
    const core: NetworkTopologyNode = makeDevice("core-01");
    const nodes: Array<NetworkTopologyNode> = [core];
    const edges: Array<NetworkTopologyEdge> = [];
    for (let i: number = 0; i < 8; i++) {
      const peerId: string = `unmanaged:peer-${String(i)}`;
      nodes.push(makeUnmanaged(peerId, { name: `peer-${String(i)}` }));
      edges.push(makeEdge("core-01", peerId, ["cdp"]));
    }

    const model: TopologyLayoutModel = computeRadialTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(9);
    expect(overlapCount(model, nodes)).toBe(0);

    // One ring, one radius: every peer is the same distance from the core.
    const centre: TopologyPoint = model.positions.get("core-01")!;
    const radii: Array<number> = nodes
      .slice(1)
      .map((node: NetworkTopologyNode): number => {
        return radiusOf(model, centre, node.id);
      });
    for (const radius of radii) {
      expect(radius).toBeCloseTo(radii[0]!, 6);
    }
  });

  test("a chain from core to endpoint puts one node per ring on one spoke", () => {
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("core-01"),
      makeDevice("core-02"),
      makeDevice("switch-1"),
      makeEndpoint("endpoint:host-1", { name: "host-1" }),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("core-01", "core-02", ["lldp"]),
      makeEdge("core-02", "switch-1", ["lldp"]),
      makeEdge("switch-1", "endpoint:host-1", ["fdb"]),
    ];

    const model: TopologyLayoutModel = computeRadialTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    expect(overlapCount(model, nodes)).toBe(0);

    /*
     * The two cores share the innermost ring, so the chain's only child
     * chain hangs off core-02 along a single bearing, one ring gap apart.
     */
    const core: TopologyPoint = model.positions.get("core-02")!;
    const sw: TopologyPoint = model.positions.get("switch-1")!;
    const host: TopologyPoint = model.positions.get("endpoint:host-1")!;
    expect(distanceBetween(core, sw)).toBeCloseTo(RADIAL_RING_MIN_GAP, 6);
    expect(distanceBetween(sw, host)).toBeCloseTo(RADIAL_RING_MIN_GAP, 6);
    expect(distanceBetween(core, host)).toBeCloseTo(RADIAL_RING_MIN_GAP * 2, 6);
  });

  test("a graph mixing routers, switches, unmanaged peers and endpoints", () => {
    const sw1: SwitchWithEndpoints = makeSwitchWithEndpoints("switch-1", 3);
    const sw2: SwitchWithEndpoints = makeSwitchWithEndpoints("switch-2", 2);
    const sw3: SwitchWithEndpoints = makeSwitchWithEndpoints("switch-3", 5);
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("core-01"),
      makeDevice("core-02"),
      makeUnmanaged("unmanaged:peer-a", { name: "peer-a" }),
      makeUnmanaged("unmanaged:peer-b", { name: "peer-b" }),
      ...sw1.nodes,
      ...sw2.nodes,
      ...sw3.nodes,
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("core-01", "core-02", ["lldp"]),
      makeEdge("core-01", "switch-1", ["lldp"]),
      makeEdge("core-01", "switch-2", ["lldp"]),
      makeEdge("core-02", "switch-3", ["lldp"]),
      makeEdge("core-01", "unmanaged:peer-a", ["cdp"]),
      // Peer-b's only neighbour is a switch, so it roots its own wedge.
      makeEdge("switch-1", "unmanaged:peer-b", ["cdp"]),
      ...sw1.edges,
      ...sw2.edges,
      ...sw3.edges,
    ];

    const model: TopologyLayoutModel = computeRadialTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(nodes.length);
    expect(overlapCount(model, nodes)).toBe(0);
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

    const nodes: Array<NetworkTopologyNode> = [makeDevice("core-01")];
    const edges: Array<NetworkTopologyEdge> = [];
    for (let i: number = 0; i < 5; i++) {
      const switchId: string = `switch-${String(i)}`;
      const count: number = 1 + Math.floor(nextUnit() * 4);
      const group: SwitchWithEndpoints = makeSwitchWithEndpoints(
        switchId,
        count,
      );
      nodes.push(...group.nodes);
      edges.push(makeEdge("core-01", switchId, ["lldp"]), ...group.edges);
      if (nextUnit() < 0.5) {
        const peerId: string = `unmanaged:peer-${String(i)}`;
        nodes.push(makeUnmanaged(peerId, { name: `peer-${String(i)}` }));
        edges.push(makeEdge(switchId, peerId, ["cdp"]));
      }
    }

    const model: TopologyLayoutModel = computeRadialTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(nodes.length);
    expect(overlapCount(model, nodes)).toBe(0);
  });
});

describe("computeRadialTopologyModel — the centre", () => {
  test("a lone core device sits dead centre of the content box", () => {
    const core: NetworkTopologyNode = makeDevice("core");
    const model: TopologyLayoutModel = computeRadialTopologyModel(
      [core],
      [],
      WIDTH,
      HEIGHT,
    );
    const point: TopologyPoint = model.positions.get("core")!;
    const footprint: TopologyNodeFootprint = footprintOrDefault(
      buildFootprints([core]),
      "core",
    );
    expect(point.x).toBeCloseTo(model.contentWidth / 2, 6);
    /*
     * Vertically it is the painted box — glyph plus the label underneath —
     * that is centred, so the glyph rides half a label above the middle.
     */
    expect(
      point.y + (footprint.labelBottom - footprint.halfHeight) / 2,
    ).toBeCloseTo(model.contentHeight / 2, 6);
  });

  test("a single core device is the concentric centre of its own ring", () => {
    const core: NetworkTopologyNode = makeDevice("core-01");
    const nodes: Array<NetworkTopologyNode> = [core];
    const edges: Array<NetworkTopologyEdge> = [];
    for (let i: number = 0; i < 8; i++) {
      const peerId: string = `unmanaged:peer-${String(i)}`;
      nodes.push(makeUnmanaged(peerId, { name: `peer-${String(i)}` }));
      edges.push(makeEdge("core-01", peerId, ["cdp"]));
    }

    const model: TopologyLayoutModel = computeRadialTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );

    /*
     * Eight equally weighted leaves take eight equal wedges, so the mean
     * of the ring is its centre — and the core is sitting on it. This is
     * the check that the core is genuinely central rather than merely the
     * first node placed.
     */
    let sumX: number = 0;
    let sumY: number = 0;
    for (const node of nodes.slice(1)) {
      const point: TopologyPoint = model.positions.get(node.id)!;
      sumX += point.x;
      sumY += point.y;
    }
    const core01: TopologyPoint = model.positions.get("core-01")!;
    expect(sumX / 8).toBeCloseTo(core01.x, 6);
    expect(sumY / 8).toBeCloseTo(core01.y, 6);
  });

  test("with no router, the lone switch takes the centre — no empty hole", () => {
    const group: SwitchWithEndpoints = makeSwitchWithEndpoints("switch-1", 2);
    const model: TopologyLayoutModel = computeRadialTopologyModel(
      group.nodes,
      group.edges,
      WIDTH,
      HEIGHT,
    );
    const centre: TopologyPoint = model.positions.get("switch-1")!;

    /*
     * Ranks are shifted so the innermost rank PRESENT is rank zero. The
     * endpoints therefore sit one ring gap out, not two — an absent router
     * must not leave a 130px doughnut hole in the middle of the picture.
     */
    for (const id of group.endpointIds) {
      expect(radiusOf(model, centre, id)).toBeCloseTo(RADIAL_RING_MIN_GAP, 6);
    }
    expect(overlapCount(model, group.nodes)).toBe(0);
  });

  test("with no router, several switches take the core ring, not the first outer ring", () => {
    const groups: Array<SwitchWithEndpoints> = [
      makeSwitchWithEndpoints("switch-1", 2),
      makeSwitchWithEndpoints("switch-2", 2),
      makeSwitchWithEndpoints("switch-3", 2),
    ];
    const nodes: Array<NetworkTopologyNode> = [
      ...groups[0]!.nodes,
      ...groups[1]!.nodes,
      ...groups[2]!.nodes,
    ];
    const edges: Array<NetworkTopologyEdge> = [
      ...groups[0]!.edges,
      ...groups[1]!.edges,
      ...groups[2]!.edges,
    ];

    const model: TopologyLayoutModel = computeRadialTopologyModel(
      nodes,
      edges,
      WIDTH,
      HEIGHT,
    );

    /*
     * Three equally weighted roots take three equal wedges, so the mean of
     * the switch ring is the layout centre.
     */
    let sumX: number = 0;
    let sumY: number = 0;
    for (const group of groups) {
      const point: TopologyPoint = model.positions.get(group.device.id)!;
      sumX += point.x;
      sumY += point.y;
    }
    const centre: TopologyPoint = { x: sumX / 3, y: sumY / 3 };

    for (const group of groups) {
      expect(radiusOf(model, centre, group.device.id)).toBeCloseTo(
        RADIAL_CORE_RADIUS,
        6,
      );
      for (const id of group.endpointIds) {
        expect(radiusOf(model, centre, id)).toBeCloseTo(
          RADIAL_CORE_RADIUS + RADIAL_RING_MIN_GAP,
          6,
        );
      }
    }
    expect(overlapCount(model, nodes)).toBe(0);
  });
});

describe("computeRadialTopologyModel — wedge weighting", () => {
  /*
   * REGRESSION. Four switches carrying six endpoints each, plus three
   * unrelated unlinked access points sharing the switches' rank. Splitting
   * a wedge purely by subtree size hands the router's 24-endpoint subtree
   * almost the whole circle and leaves the three access points a few
   * degrees each, where their glyphs collide. The wedge split is a blend
   * of even and weighted, so every node on the ring keeps at least half of
   * an even share.
   */
  const switches: Array<SwitchWithEndpoints> = [
    makeSwitchWithEndpoints("switch-a", 6),
    makeSwitchWithEndpoints("switch-b", 6),
    makeSwitchWithEndpoints("switch-c", 6),
    makeSwitchWithEndpoints("switch-d", 6),
  ];
  const accessPointIds: Array<string> = [
    "unmanaged:ap-1",
    "unmanaged:ap-2",
    "unmanaged:ap-3",
  ];
  const crushNodes: Array<NetworkTopologyNode> = [
    makeDevice("router-1"),
    ...accessPointIds.map((id: string, index: number): NetworkTopologyNode => {
      return makeUnmanaged(id, { name: `ap-hall-${String(index + 1)}` });
    }),
    ...switches[0]!.nodes,
    ...switches[1]!.nodes,
    ...switches[2]!.nodes,
    ...switches[3]!.nodes,
  ];
  const crushEdges: Array<NetworkTopologyEdge> = [
    makeEdge("router-1", "switch-a", ["lldp"]),
    makeEdge("router-1", "switch-b", ["lldp"]),
    makeEdge("router-1", "switch-c", ["lldp"]),
    makeEdge("router-1", "switch-d", ["lldp"]),
    ...switches[0]!.edges,
    ...switches[1]!.edges,
    ...switches[2]!.edges,
    ...switches[3]!.edges,
  ];

  const model: TopologyLayoutModel = computeRadialTopologyModel(
    crushNodes,
    crushEdges,
    WIDTH,
    HEIGHT,
  );
  const centre: TopologyPoint = model.positions.get("router-1")!;
  const ringIds: Array<string> = [
    "switch-a",
    "switch-b",
    "switch-c",
    "switch-d",
    ...accessPointIds,
  ];

  test("three unlinked access points beside a 24-endpoint router do not collide", () => {
    expect(model.positions.size).toBe(crushNodes.length);
    expect(overlapCount(model, crushNodes)).toBe(0);
    expect(minPairDistance(model, accessPointIds)).toBeGreaterThanOrEqual(
      DEVICE_PAIR_CLEARANCE,
    );
    expect(minPairDistance(model, ringIds)).toBeGreaterThanOrEqual(
      DEVICE_PAIR_CLEARANCE,
    );
  });

  test("every neighbour on the crowded ring keeps a workable slice of the circle", () => {
    const angles: Array<number> = ringIds
      .map((id: string): number => {
        return angleOf(model, centre, id);
      })
      .sort((a: number, b: number): number => {
        return a - b;
      });
    /*
     * Seven nodes on the ring, so an even split is 51 degrees each. Under
     * the old purely weighted split the three access points were handed
     * 1/27th of the circle apiece — about 13 degrees — which is what put
     * their glyphs on top of each other.
     */
    for (let i: number = 0; i < angles.length; i++) {
      const previous: number =
        i === 0 ? angles[angles.length - 1]! - Math.PI * 2 : angles[i - 1]!;
      expect(angles[i]! - previous).toBeGreaterThan(0.35);
    }
  });

  test("the quiet peers do not blow the switch ring outward", () => {
    /*
     * Sizing the ring for a 13-degree wedge would push it out past 300px;
     * with the blended split the ring sits at the plain minimum gap.
     */
    for (const id of ringIds) {
      expect(radiusOf(model, centre, id)).toBeCloseTo(RADIAL_RING_MIN_GAP, 6);
    }
  });

  test("each switch's endpoints occupy one contiguous angular block", () => {
    const groupByNodeId: Map<string, string> = new Map<string, string>();
    for (const group of switches) {
      for (const id of group.endpointIds) {
        groupByNodeId.set(id, group.device.id);
      }
    }
    // A child's wedge is contained in its parent's, so spokes cannot cross.
    expect(angularBlockCount(model, centre, groupByNodeId)).toBe(4);
  });

  test("the heavy subtree still claims more of the circle than the quiet peers", () => {
    const switchSpan: number =
      angleOf(model, centre, "switch-d") - angleOf(model, centre, "switch-a");
    const peerSpan: number =
      angleOf(model, centre, "unmanaged:ap-3") -
      angleOf(model, centre, "unmanaged:ap-1");
    expect(switchSpan).toBeGreaterThan(peerSpan);
  });
});

describe("computeRadialTopologyModel — determinism", () => {
  test("identical input yields identical coordinates", () => {
    const first: TopologyLayoutModel = computeRadialTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
    );
    const second: TopologyLayoutModel = computeRadialTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
    );
    expect(second.positions).toEqual(first.positions);
    expect(second.contentWidth).toBe(first.contentWidth);
    expect(second.contentHeight).toBe(first.contentHeight);
  });

  test("permuting nodes, edges and edge direction changes nothing", () => {
    const shuffledNodes: Array<NetworkTopologyNode> = [
      branchPos3,
      branchAp,
      branchSwitchB,
      branchPos1,
      branchRouter,
      branchPos2,
      branchSwitchA,
    ];
    const shuffledEdges: Array<NetworkTopologyEdge> = [...branchEdges]
      .reverse()
      .map((edge: NetworkTopologyEdge): NetworkTopologyEdge => {
        // Attachment is undirected: flipping every edge must change nothing.
        return makeEdge(edge.toNodeId, edge.fromNodeId, edge.protocols);
      });

    const original: TopologyLayoutModel = computeRadialTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
    );
    const shuffled: TopologyLayoutModel = computeRadialTopologyModel(
      shuffledNodes,
      shuffledEdges,
      WIDTH,
      HEIGHT,
    );
    expect(shuffled.positions).toEqual(original.positions);
    expect(shuffled.contentWidth).toBe(original.contentWidth);
    expect(shuffled.contentHeight).toBe(original.contentHeight);
  });

  test("a duplicated edge does not shift the layout", () => {
    const withDuplicate: TopologyLayoutModel = computeRadialTopologyModel(
      branchNodes,
      [...branchEdges, makeEdge("switch-a", "router-1", ["cdp"])],
      WIDTH,
      HEIGHT,
    );
    const original: TopologyLayoutModel = computeRadialTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
    );
    expect(withDuplicate.positions).toEqual(original.positions);
  });
});

describe("computeRadialTopologyModel — pins", () => {
  const unpinned: TopologyLayoutModel = computeRadialTopologyModel(
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

    const model: TopologyLayoutModel = computeRadialTopologyModel(
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
    const model: TopologyLayoutModel = computeRadialTopologyModel(
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

  test("a pin outside the computed extent grows the content box", () => {
    const pinned: ReadonlyMap<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >([["router-1", { x: 5000, y: 4000 }]]);
    const model: TopologyLayoutModel = computeRadialTopologyModel(
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
      5000 + footprint.inkHalfWidth + RADIAL_LAYOUT_MARGIN,
      6,
    );
    expect(model.contentHeight).toBeCloseTo(
      4000 + footprint.labelBottom + RADIAL_LAYOUT_MARGIN,
      6,
    );
  });

  test("a non-finite pin is ignored rather than blanking the node", () => {
    const pinned: ReadonlyMap<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >([
      ["switch-a", { x: Number.NaN, y: 10 }],
      ["switch-b", { x: 10, y: Number.POSITIVE_INFINITY }],
    ]);
    const model: TopologyLayoutModel = computeRadialTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    expect(model.positions.get("switch-a")).toEqual(
      unpinned.positions.get("switch-a"),
    );
    expect(model.positions.get("switch-b")).toEqual(
      unpinned.positions.get("switch-b"),
    );
  });

  test("a pin for a node that left the graph adds no placement", () => {
    const pinned: ReadonlyMap<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >([["endpoint:gone", { x: 5, y: 6 }]]);
    const model: TopologyLayoutModel = computeRadialTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    expect(model.positions.has("endpoint:gone")).toBe(false);
    expect(model.positions.size).toBe(branchNodes.length);
  });

  test("an empty pin map behaves exactly like no pin map", () => {
    const model: TopologyLayoutModel = computeRadialTopologyModel(
      branchNodes,
      branchEdges,
      WIDTH,
      HEIGHT,
      new Map<string, TopologyPoint>(),
    );
    expect(model.positions).toEqual(unpinned.positions);
    expect(model.contentWidth).toBe(unpinned.contentWidth);
  });
});

describe("computeRadialTopologyModel — degenerate and hostile input", () => {
  test("empty input returns an empty map and the frame it was given", () => {
    const model: TopologyLayoutModel = computeRadialTopologyModel(
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
    const empty: TopologyLayoutModel = computeRadialTopologyModel(
      [],
      [],
      Number.NaN,
      -10,
    );
    expect(empty.contentWidth).toBe(1000);
    expect(empty.contentHeight).toBe(700);

    const populated: TopologyLayoutModel = computeRadialTopologyModel(
      branchNodes,
      branchEdges,
      Number.POSITIVE_INFINITY,
      0,
    );
    expect(populated.contentWidth).toBeGreaterThanOrEqual(1000);
    expect(populated.contentHeight).toBeGreaterThanOrEqual(700);
    for (const node of branchNodes) {
      const point: TopologyPoint = populated.positions.get(node.id)!;
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  test("duplicate node ids collapse to one placement", () => {
    const model: TopologyLayoutModel = computeRadialTopologyModel(
      [...branchNodes, branchSwitchA, makeDevice("switch-a")],
      branchEdges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(branchNodes.length);
  });

  test("edges naming nodes outside the view add no phantom placements", () => {
    const model: TopologyLayoutModel = computeRadialTopologyModel(
      [branchSwitchA],
      [
        makeEdge("switch-a", "endpoint:not-in-view", ["fdb"]),
        makeEdge("switch-a", "switch-a", ["lldp"]),
      ],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(1);
    expect(model.positions.has("endpoint:not-in-view")).toBe(false);
    /*
     * The dangling FDB edge still ranks the device as a switch, and since
     * that is the innermost rank present it sits dead centre.
     */
    expect(model.positions.get("switch-a")!.x).toBeCloseTo(
      model.contentWidth / 2,
      6,
    );
  });

  test("a node with no parent one rank inward is placed, not dropped", () => {
    const looseEndpoint: NetworkTopologyNode = makeEndpoint(
      "endpoint:loose-1",
      { name: "loose-1" },
    );
    const freeEndpoint: NetworkTopologyNode = makeEndpoint("endpoint:free-1", {
      name: "free-1",
    });
    const nodes: Array<NetworkTopologyNode> = [
      branchRouter,
      looseEndpoint,
      freeEndpoint,
    ];
    const model: TopologyLayoutModel = computeRadialTopologyModel(
      nodes,
      // Linked straight to the router, which is two ranks in — not a parent.
      [makeEdge("router-1", "endpoint:loose-1", ["lldp"])],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(3);
    for (const node of nodes) {
      const point: TopologyPoint = model.positions.get(node.id)!;
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
    // Both orphans keep their endpoint rank rather than being pulled inward.
    const centre: TopologyPoint = model.positions.get("router-1")!;
    expect(radiusOf(model, centre, "endpoint:loose-1")).toBeCloseTo(
      radiusOf(model, centre, "endpoint:free-1"),
      6,
    );
    expect(radiusOf(model, centre, "endpoint:free-1")).toBeGreaterThanOrEqual(
      RADIAL_RING_MIN_GAP * 2,
    );
    expect(overlapCount(model, nodes)).toBe(0);
  });

  test("a node with an empty id is dropped and an empty name still places", () => {
    const nameless: NetworkTopologyNode = makeDevice("switch-1", { name: "" });
    const ghost: NetworkTopologyNode = makeDevice("", { name: "ghost" });
    const model: TopologyLayoutModel = computeRadialTopologyModel(
      [nameless, ghost, makeEndpoint("endpoint:x", { name: "" })],
      [makeEdge("switch-1", "endpoint:x", ["fdb"])],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(2);
    expect(model.positions.has("")).toBe(false);
    const point: TopologyPoint = model.positions.get("switch-1")!;
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });

  test("a single endpoint alone in the view is placed at the centre", () => {
    const only: NetworkTopologyNode = makeEndpoint("endpoint:solo", {
      name: "solo",
    });
    const model: TopologyLayoutModel = computeRadialTopologyModel(
      [only],
      [],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(1);
    expect(model.positions.get("endpoint:solo")!.x).toBeCloseTo(
      model.contentWidth / 2,
      6,
    );
  });
});

describe("computeRadialTopologyModel — ring sizing headroom", () => {
  /*
   * A ring is sized so each node's ARC is at least its painted width, but
   * two neighbours are separated by the CHORD, which is always shorter.
   * For devices whose name is short enough that the 32px glyph rather than
   * the label sets the width, the arc budget (32 + 16 slot padding) is
   * exactly the clearance the collision check demands (2 x (16 + 8)), so
   * the chord lands a hair inside it on a crowded ring. Asserted as "no
   * visible overlap" rather than "zero overlaps": the deficit is a quarter
   * of a pixel, and this assertion still holds if the sizing is switched
   * from arc to chord.
   */
  const core: NetworkTopologyNode = makeDevice("core-01");
  const peers: Array<NetworkTopologyNode> = [];
  const edges: Array<NetworkTopologyEdge> = [];
  for (let i: number = 0; i < 17; i++) {
    const peerId: string = `unmanaged:ap-${String(i).padStart(2, "0")}`;
    peers.push(makeUnmanaged(peerId, { name: "ap" }));
    edges.push(makeEdge("core-01", peerId, ["cdp"]));
  }
  const nodes: Array<NetworkTopologyNode> = [core, ...peers];
  const model: TopologyLayoutModel = computeRadialTopologyModel(
    nodes,
    edges,
    WIDTH,
    HEIGHT,
  );

  test("seventeen short-named peers on one ring stay within a pixel of the clearance", () => {
    const peerIds: Array<string> = peers.map(
      (node: NetworkTopologyNode): string => {
        return node.id;
      },
    );
    expect(model.positions.size).toBe(18);
    /*
     * Measured deficit today: 47.775 against a required 48, i.e. a quarter
     * of a pixel, on a ring the sizing pass put at exactly the minimum gap.
     */
    expect(minPairDistance(model, peerIds)).toBeGreaterThan(
      DEVICE_PAIR_CLEARANCE - 0.5,
    );
    expect(
      radiusOf(model, model.positions.get("core-01")!, peerIds[0]!),
    ).toBeCloseTo(RADIAL_RING_MIN_GAP, 6);
  });

  test("a ring of long-named devices keeps a real margin over the clearance", () => {
    const longNamed: Array<NetworkTopologyNode> = [core];
    const longEdges: Array<NetworkTopologyEdge> = [];
    for (let i: number = 0; i < 17; i++) {
      const peerId: string = `unmanaged:ap-${String(i).padStart(2, "0")}`;
      longNamed.push(makeUnmanaged(peerId, { name: `ap-hall-${String(i)}` }));
      longEdges.push(makeEdge("core-01", peerId, ["cdp"]));
    }
    const longModel: TopologyLayoutModel = computeRadialTopologyModel(
      longNamed,
      longEdges,
      WIDTH,
      HEIGHT,
    );
    expect(overlapCount(longModel, longNamed)).toBe(0);
  });
});
