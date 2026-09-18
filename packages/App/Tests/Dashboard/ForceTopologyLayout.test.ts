import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  IDEAL_EDGE_LENGTH,
  LAYOUT_MARGIN,
  LEAF_FAN_MAX_RADIUS,
  LEAF_FAN_MIN_RADIUS,
  LEAF_FAN_RING_GAP,
  UNLINKED_BOX_KEY,
  computeForceTopologyModel,
  iterationsForNodeCount,
  placeLeafFans,
  seedComponentPositions,
  simulateComponent,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/ForceTopologyLayout";
import {
  TopologyComponentBox,
  TopologyLayoutModel,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyModel";
import {
  TopologyNodeFootprint,
  buildFootprints,
  footprintOrDefault,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyFootprint";
import { countNodeOverlaps } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyCollision";
import {
  TopologyAdjacency,
  TopologyComponent,
  TopologyPoint,
  buildTopologyAdjacency,
  canonicalNodeOrder,
  findTopologyComponents,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";

/*
 * The headline suite for the rebuilt network topology layout.
 *
 * The user complaint this file exists to prevent is a single sentence:
 * "the map is messed up — devices are drawn on top of each other and it
 * redraws itself every minute". Everything below is one of those two
 * properties made checkable — zero glyph overlaps on every graph shape we
 * can think of, and an output that is a function of the GRAPH rather than
 * of the order the topology endpoint happened to return its rows in.
 *
 * No Math.random and no Date.now anywhere, fixtures included: a test that
 * is not a pure function of its source cannot pin a layout that claims to
 * be a pure function of its input.
 */

const WIDTH: number = 1000;
const HEIGHT: number = 700;
const TWO_PI: number = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* Fixture builders                                                     */
/* ------------------------------------------------------------------ */

interface TopologyGraph {
  nodes: Array<NetworkTopologyNode>;
  edges: Array<NetworkTopologyEdge>;
}

interface NamedGraph {
  name: string;
  graph: TopologyGraph;
}

type MakeNodeFunction = (id: string, name?: string) => NetworkTopologyNode;

const makeDevice: MakeNodeFunction = (
  id: string,
  name?: string,
): NetworkTopologyNode => {
  return {
    id: id,
    name: name === undefined ? id : name,
    isManaged: true,
    status: "up",
    kind: "device",
  };
};

const makeEndpoint: MakeNodeFunction = (
  id: string,
  name?: string,
): NetworkTopologyNode => {
  return {
    id: id,
    name: name === undefined ? id : name,
    isManaged: false,
    status: "unknown",
    kind: "endpoint",
  };
};

const makeUnmanaged: MakeNodeFunction = (
  id: string,
  name?: string,
): NetworkTopologyNode => {
  return {
    id: id,
    name: name === undefined ? id : name,
    isManaged: false,
    status: "unknown",
    kind: "unmanaged",
  };
};

type MakeEdgeFunction = (from: string, to: string) => NetworkTopologyEdge;

const makeLink: MakeEdgeFunction = (
  from: string,
  to: string,
): NetworkTopologyEdge => {
  return { fromNodeId: from, toNodeId: to, protocols: ["lldp"] };
};

const makeFdbLink: MakeEdgeFunction = (
  from: string,
  to: string,
): NetworkTopologyEdge => {
  return { fromNodeId: from, toNodeId: to, protocols: ["fdb"] };
};

/* A legacy edge: no protocols key at all, as older payloads arrive. */
const makeBareLink: MakeEdgeFunction = (
  from: string,
  to: string,
): NetworkTopologyEdge => {
  return { fromNodeId: from, toNodeId: to };
};

type PadFunction = (value: number) => string;
const pad: PadFunction = (value: number): string => {
  return String(value).padStart(3, "0");
};

type SizedGraphFunction = (size: number) => TopologyGraph;
type PairSizedGraphFunction = (left: number, right: number) => TopologyGraph;

/* device-000 — device-001 — ... — device-(n-1). */
const chain: SizedGraphFunction = (size: number): TopologyGraph => {
  const nodes: Array<NetworkTopologyNode> = [];
  const edges: Array<NetworkTopologyEdge> = [];
  for (let i: number = 0; i < size; i++) {
    nodes.push(makeDevice(`device-${pad(i)}`));
    if (i > 0) {
      edges.push(makeLink(`device-${pad(i - 1)}`, `device-${pad(i)}`));
    }
  }
  return { nodes: nodes, edges: edges };
};

/* One hub with `size` leaves — the forty-port switch the fan pass exists for. */
const star: SizedGraphFunction = (size: number): TopologyGraph => {
  const nodes: Array<NetworkTopologyNode> = [makeDevice("hub-000")];
  const edges: Array<NetworkTopologyEdge> = [];
  for (let i: number = 0; i < size; i++) {
    nodes.push(makeDevice(`leaf-${pad(i)}`));
    edges.push(makeLink("hub-000", `leaf-${pad(i)}`));
  }
  return { nodes: nodes, edges: edges };
};

const ring: SizedGraphFunction = (size: number): TopologyGraph => {
  const graph: TopologyGraph = chain(size);
  graph.edges.push(makeLink(`device-${pad(size - 1)}`, `device-${pad(0)}`));
  return graph;
};

const completeGraph: SizedGraphFunction = (size: number): TopologyGraph => {
  const nodes: Array<NetworkTopologyNode> = [];
  const edges: Array<NetworkTopologyEdge> = [];
  for (let i: number = 0; i < size; i++) {
    nodes.push(makeDevice(`device-${pad(i)}`));
  }
  for (let i: number = 0; i < size; i++) {
    for (let j: number = i + 1; j < size; j++) {
      edges.push(makeLink(`device-${pad(i)}`, `device-${pad(j)}`));
    }
  }
  return { nodes: nodes, edges: edges };
};

const bipartite: PairSizedGraphFunction = (
  left: number,
  right: number,
): TopologyGraph => {
  const nodes: Array<NetworkTopologyNode> = [];
  const edges: Array<NetworkTopologyEdge> = [];
  for (let i: number = 0; i < left; i++) {
    nodes.push(makeDevice(`left-${pad(i)}`));
  }
  for (let j: number = 0; j < right; j++) {
    nodes.push(makeDevice(`right-${pad(j)}`));
  }
  for (let i: number = 0; i < left; i++) {
    for (let j: number = 0; j < right; j++) {
      edges.push(makeLink(`left-${pad(i)}`, `right-${pad(j)}`));
    }
  }
  return { nodes: nodes, edges: edges };
};

type BranchSiteFunction = (extraEndpoints: number) => TopologyGraph;

/*
 * The shape the complaint was actually about: one branch router, four
 * access switches, six FDB endpoints hanging off each switch, and three
 * access points that report no neighbours at all yet.
 */
const branchSite: BranchSiteFunction = (
  extraEndpoints: number,
): TopologyGraph => {
  const nodes: Array<NetworkTopologyNode> = [makeDevice("router-01")];
  const edges: Array<NetworkTopologyEdge> = [];
  for (let s: number = 1; s <= 4; s++) {
    const switchId: string = `switch-0${String(s)}`;
    nodes.push(makeDevice(switchId));
    edges.push(makeLink("router-01", switchId));
    for (let e: number = 0; e < 6; e++) {
      const endpointId: string = `endpoint:sw-0${String(s)}-e-${pad(e)}`;
      nodes.push(makeEndpoint(endpointId, `pos-${String(s)}-${pad(e)}`));
      edges.push(makeFdbLink(switchId, endpointId));
    }
  }
  for (let a: number = 1; a <= 3; a++) {
    nodes.push(makeUnmanaged(`unmanaged:ap-${String(a)}`, `ap-${String(a)}`));
  }
  for (let x: number = 0; x < extraEndpoints; x++) {
    const endpointId: string = `endpoint:sw-01-e-${pad(6 + x)}`;
    nodes.push(makeEndpoint(endpointId, `pos-1-${pad(6 + x)}`));
    edges.push(makeFdbLink("switch-01", endpointId));
  }
  return { nodes: nodes, edges: edges };
};

type PlainGraphFunction = () => TopologyGraph;

/* Three two-device islands plus six devices with no links at all. */
const threePairsPlusSixSingletons: PlainGraphFunction = (): TopologyGraph => {
  const nodes: Array<NetworkTopologyNode> = [];
  const edges: Array<NetworkTopologyEdge> = [];
  for (let p: number = 0; p < 3; p++) {
    nodes.push(makeDevice(`pair-${pad(p)}-a`));
    nodes.push(makeDevice(`pair-${pad(p)}-b`));
    edges.push(makeLink(`pair-${pad(p)}-a`, `pair-${pad(p)}-b`));
  }
  for (let s: number = 0; s < 6; s++) {
    nodes.push(makeDevice(`solo-${pad(s)}`));
  }
  return { nodes: nodes, edges: edges };
};

/* Chained devices whose names are all exactly 29 characters long. */
const longNames: SizedGraphFunction = (size: number): TopologyGraph => {
  const nodes: Array<NetworkTopologyNode> = [];
  const edges: Array<NetworkTopologyEdge> = [];
  for (let i: number = 0; i < size; i++) {
    const name: string = `core-sw-${pad(i)}.site.example.net.lan`;
    nodes.push(makeDevice(`long-${pad(i)}`, name));
    if (i > 0) {
      edges.push(makeLink(`long-${pad(i - 1)}`, `long-${pad(i)}`));
    }
  }
  return { nodes: nodes, edges: edges };
};

/* Two disconnected islands of different sizes and shapes. */
const twoIslands: PlainGraphFunction = (): TopologyGraph => {
  const first: TopologyGraph = completeGraph(4);
  const second: TopologyGraph = star(5);
  return {
    nodes: [...first.nodes, ...second.nodes],
    edges: [...first.edges, ...second.edges],
  };
};

const singletons: SizedGraphFunction = (size: number): TopologyGraph => {
  const nodes: Array<NetworkTopologyNode> = [];
  for (let i: number = 0; i < size; i++) {
    nodes.push(makeDevice(`solo-${pad(i)}`));
  }
  return { nodes: nodes, edges: [] };
};

/*
 * Every fixture the sweeps below run over. Deliberately a mix of trees,
 * cycles, dense graphs, fans, islands and unlinked strips — the layout has
 * a different code path for each and the contract is the same for all.
 */
const ALL_FIXTURES: ReadonlyArray<NamedGraph> = [
  { name: "chain(2)", graph: chain(2) },
  { name: "chain(3)", graph: chain(3) },
  { name: "chain(12)", graph: chain(12) },
  { name: "chain(60)", graph: chain(60) },
  { name: "star(1,4)", graph: star(4) },
  { name: "star(1,12)", graph: star(12) },
  { name: "star(1,40)", graph: star(40) },
  { name: "ring(3)", graph: ring(3) },
  { name: "ring(9)", graph: ring(9) },
  { name: "ring(30)", graph: ring(30) },
  { name: "completeGraph(4)", graph: completeGraph(4) },
  { name: "completeGraph(8)", graph: completeGraph(8) },
  { name: "bipartite(3,4)", graph: bipartite(3, 4) },
  { name: "bipartite(5,5)", graph: bipartite(5, 5) },
  { name: "branchSite()", graph: branchSite(0) },
  {
    name: "threePairsPlusSixSingletons()",
    graph: threePairsPlusSixSingletons(),
  },
  { name: "longNames(8)", graph: longNames(8) },
  { name: "twoIslands()", graph: twoIslands() },
  { name: "singletons(6)", graph: singletons(6) },
  { name: "singleNode", graph: singletons(1) },
];

/* ------------------------------------------------------------------ */
/* Deterministic helpers                                                */
/* ------------------------------------------------------------------ */

/*
 * Seeded xorshift Fisher-Yates. Permuting the input is how this file
 * proves the layout is a function of the graph, so the permutation itself
 * has to be reproducible — Math.random would make a failure unrepeatable.
 */
type ShuffleFunction = <T>(items: ReadonlyArray<T>, seed: number) => Array<T>;

const shuffle: ShuffleFunction = <T>(
  items: ReadonlyArray<T>,
  seed: number,
): Array<T> => {
  const result: Array<T> = [...items];
  let state: number = seed >>> 0 === 0 ? 0x9e3779b9 : seed >>> 0;
  for (let i: number = result.length - 1; i > 0; i--) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    const j: number = state % (i + 1);
    const held: T = result[i]!;
    result[i] = result[j]!;
    result[j] = held;
  }
  return result;
};

/* Flip every edge's direction — links are undirected by contract. */
type FlipEdgesFunction = (
  edges: ReadonlyArray<NetworkTopologyEdge>,
) => Array<NetworkTopologyEdge>;

const flipEdges: FlipEdgesFunction = (
  edges: ReadonlyArray<NetworkTopologyEdge>,
): Array<NetworkTopologyEdge> => {
  return edges.map((edge: NetworkTopologyEdge): NetworkTopologyEdge => {
    return edge.protocols
      ? {
          fromNodeId: edge.toNodeId,
          toNodeId: edge.fromNodeId,
          protocols: edge.protocols,
        }
      : { fromNodeId: edge.toNodeId, toNodeId: edge.fromNodeId };
  });
};

type NormalizeAngleFunction = (angle: number) => number;
const normalizeAngle: NormalizeAngleFunction = (angle: number): number => {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
};

type AngleDifferenceFunction = (from: number, to: number) => number;
const angleDifference: AngleDifferenceFunction = (
  from: number,
  to: number,
): number => {
  const raw: number = normalizeAngle(from - to);
  return raw > Math.PI ? raw - TWO_PI : raw;
};

type DistanceFunction = (a: TopologyPoint, b: TopologyPoint) => number;
const distanceBetween: DistanceFunction = (
  a: TopologyPoint,
  b: TopologyPoint,
): number => {
  return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
};

interface GraphAnalysis {
  adjacency: TopologyAdjacency;
  components: Array<TopologyComponent>;
  footprints: Map<string, TopologyNodeFootprint>;
  nameById: Map<string, string>;
  orderedIds: Array<string>;
}

type AnalyseFunction = (graph: TopologyGraph) => GraphAnalysis;

const analyse: AnalyseFunction = (graph: TopologyGraph): GraphAnalysis => {
  const orderedIds: Array<string> = canonicalNodeOrder(graph.nodes);
  const adjacency: TopologyAdjacency = buildTopologyAdjacency(
    graph.nodes,
    graph.edges,
  );
  const nameById: Map<string, string> = new Map<string, string>();
  for (const node of graph.nodes) {
    if (!nameById.has(node.id)) {
      nameById.set(node.id, node.name);
    }
  }
  return {
    adjacency: adjacency,
    components: findTopologyComponents(adjacency, orderedIds),
    footprints: buildFootprints(graph.nodes),
    nameById: nameById,
    orderedIds: orderedIds,
  };
};

/* Every node of a component parked on exactly the same coordinate. */
type CoincidentPositionsFunction = (
  ids: ReadonlyArray<string>,
) => Map<string, TopologyPoint>;

const allCoincident: CoincidentPositionsFunction = (
  ids: ReadonlyArray<string>,
): Map<string, TopologyPoint> => {
  const positions: Map<string, TopologyPoint> = new Map<
    string,
    TopologyPoint
  >();
  for (const id of ids) {
    positions.set(id, { x: 0, y: 0 });
  }
  return positions;
};

type SnapshotFunction = (
  positions: Map<string, TopologyPoint>,
) => Map<string, TopologyPoint>;

const snapshot: SnapshotFunction = (
  positions: Map<string, TopologyPoint>,
): Map<string, TopologyPoint> => {
  const copy: Map<string, TopologyPoint> = new Map<string, TopologyPoint>();
  for (const [id, point] of positions) {
    copy.set(id, { x: point.x, y: point.y });
  }
  return copy;
};

/* ------------------------------------------------------------------ */
/* iterationsForNodeCount                                               */
/* ------------------------------------------------------------------ */

describe("iterationsForNodeCount — a bounded, size-aware sweep budget", () => {
  test("never returns fewer than 50 or more than 240 sweeps", () => {
    for (let n: number = 0; n <= 4000; n += 7) {
      const iterations: number = iterationsForNodeCount(n);
      expect(iterations).toBeGreaterThanOrEqual(50);
      expect(iterations).toBeLessThanOrEqual(240);
    }
  });

  test("bigger components never get more sweeps than smaller ones", () => {
    /*
     * Monotone from two nodes upward. A ONE-node component is the
     * deliberate exception: it returns the floor of 50 because
     * simulateComponent refuses to run on it at all, so the number is
     * never spent.
     */
    let previous: number = iterationsForNodeCount(2);
    for (let n: number = 3; n <= 3000; n++) {
      const current: number = iterationsForNodeCount(n);
      expect(current).toBeLessThanOrEqual(previous);
      previous = current;
    }
  });

  test("a component too small to simulate gets the floor", () => {
    expect(iterationsForNodeCount(0)).toBe(50);
    expect(iterationsForNodeCount(1)).toBe(50);
  });

  test("a small component is given the ceiling", () => {
    expect(iterationsForNodeCount(2)).toBe(240);
    expect(iterationsForNodeCount(50)).toBe(240);
    expect(iterationsForNodeCount(51)).toBe(238);
  });

  test("a huge component still returns the floor rather than stalling", () => {
    expect(iterationsForNodeCount(1157)).toBe(50);
    expect(iterationsForNodeCount(10000)).toBe(50);
  });

  test("hostile counts degrade to the floor instead of NaN", () => {
    expect(iterationsForNodeCount(Number.NaN)).toBe(50);
    expect(iterationsForNodeCount(Number.POSITIVE_INFINITY)).toBe(50);
    expect(iterationsForNodeCount(Number.NEGATIVE_INFINITY)).toBe(50);
    expect(iterationsForNodeCount(-42)).toBe(50);
  });
});

/* ------------------------------------------------------------------ */
/* seedComponentPositions                                               */
/* ------------------------------------------------------------------ */

describe("seedComponentPositions — a radial tree, not a hash scatter", () => {
  test("the root sits exactly on the origin", () => {
    const analysis: GraphAnalysis = analyse(branchSite(0));
    const component: TopologyComponent = analysis.components[0]!;
    const seeded: Map<string, TopologyPoint> = seedComponentPositions(
      component,
      analysis.adjacency,
      IDEAL_EDGE_LENGTH,
    );
    expect(seeded.get(component.rootId)!.x).toBe(0);
    expect(seeded.get(component.rootId)!.y).toBe(0);
  });

  test("every member of the component is seeded exactly once", () => {
    const shapes: Array<TopologyGraph> = [
      chain(9),
      ring(9),
      star(12),
      completeGraph(6),
      bipartite(3, 4),
      branchSite(0),
    ];
    for (const shape of shapes) {
      const analysis: GraphAnalysis = analyse(shape);
      for (const component of analysis.components) {
        const seeded: Map<string, TopologyPoint> = seedComponentPositions(
          component,
          analysis.adjacency,
          IDEAL_EDGE_LENGTH,
        );
        expect(seeded.size).toBe(component.nodeIds.length);
        for (const nodeId of component.nodeIds) {
          expect(seeded.has(nodeId)).toBe(true);
        }
      }
    }
  });

  test("a node's distance from the origin is its BFS depth times the edge length", () => {
    const shapes: Array<TopologyGraph> = [
      chain(9),
      ring(9),
      star(12),
      bipartite(3, 4),
      branchSite(0),
    ];
    for (const shape of shapes) {
      const analysis: GraphAnalysis = analyse(shape);
      for (const component of analysis.components) {
        const seeded: Map<string, TopologyPoint> = seedComponentPositions(
          component,
          analysis.adjacency,
          IDEAL_EDGE_LENGTH,
        );
        for (const nodeId of component.nodeIds) {
          const depth: number = component.depthById.get(nodeId)!;
          const point: TopologyPoint = seeded.get(nodeId)!;
          expect(Math.sqrt(point.x * point.x + point.y * point.y)).toBeCloseTo(
            depth * IDEAL_EDGE_LENGTH,
            6,
          );
        }
      }
    }
  });

  test("no two members of a component are seeded onto the same point", () => {
    const shapes: Array<TopologyGraph> = [
      chain(9),
      ring(10),
      star(12),
      completeGraph(6),
      bipartite(3, 4),
      branchSite(0),
    ];
    for (const shape of shapes) {
      const analysis: GraphAnalysis = analyse(shape);
      for (const component of analysis.components) {
        if (component.nodeIds.length < 2) {
          continue;
        }
        const seeded: Map<string, TopologyPoint> = seedComponentPositions(
          component,
          analysis.adjacency,
          IDEAL_EDGE_LENGTH,
        );
        const ids: Array<string> = component.nodeIds;
        for (let i: number = 0; i < ids.length; i++) {
          for (let j: number = i + 1; j < ids.length; j++) {
            expect(
              distanceBetween(seeded.get(ids[i]!)!, seeded.get(ids[j]!)!),
            ).toBeGreaterThan(1e-9);
          }
        }
      }
    }
  });

  test("a pure star seeds its leaves equidistant and equiangular", () => {
    const leafCount: number = 8;
    const analysis: GraphAnalysis = analyse(star(leafCount));
    const component: TopologyComponent = analysis.components[0]!;
    const seeded: Map<string, TopologyPoint> = seedComponentPositions(
      component,
      analysis.adjacency,
      IDEAL_EDGE_LENGTH,
    );

    const angles: Array<number> = [];
    for (let i: number = 0; i < leafCount; i++) {
      const point: TopologyPoint = seeded.get(`leaf-${pad(i)}`)!;
      expect(Math.sqrt(point.x * point.x + point.y * point.y)).toBeCloseTo(
        IDEAL_EDGE_LENGTH,
        6,
      );
      angles.push(normalizeAngle(Math.atan2(point.y, point.x)));
    }
    angles.sort((a: number, b: number): number => {
      return a - b;
    });
    for (let i: number = 1; i < angles.length; i++) {
      expect(angles[i]! - angles[i - 1]!).toBeCloseTo(TWO_PI / leafCount, 6);
    }
    // ...and the wrap-around gap is the same slice as every other.
    expect(angles[0]! + TWO_PI - angles[angles.length - 1]!).toBeCloseTo(
      TWO_PI / leafCount,
      6,
    );
  });

  test("an empty component seeds nothing rather than throwing", () => {
    const seeded: Map<string, TopologyPoint> = seedComponentPositions(
      {
        nodeIds: [],
        rootId: "",
        edges: [],
        depthById: new Map<string, number>(),
      },
      buildTopologyAdjacency([], []),
      IDEAL_EDGE_LENGTH,
    );
    expect(seeded.size).toBe(0);
  });

  test("a zero edge length still places every member, all on the root", () => {
    /*
     * Degenerate but total: radius is depth * length, so a zero length
     * collapses the whole component onto the origin. The contract that
     * survives is "every member gets exactly one position" — the later
     * collision relaxation is what pulls them apart again.
     */
    const analysis: GraphAnalysis = analyse(star(6));
    const component: TopologyComponent = analysis.components[0]!;
    const seeded: Map<string, TopologyPoint> = seedComponentPositions(
      component,
      analysis.adjacency,
      0,
    );
    expect(seeded.size).toBe(component.nodeIds.length);
    for (const nodeId of component.nodeIds) {
      const point: TopologyPoint = seeded.get(nodeId)!;
      /*
       * Distance rather than the raw components: radius * cos(angle) with
       * a zero radius yields a signed zero, and -0 is still the origin.
       */
      expect(Math.sqrt(point.x * point.x + point.y * point.y)).toBe(0);
    }
  });

  test("seeding depends on the graph, not on the order the edges arrived", () => {
    const graph: TopologyGraph = branchSite(0);
    const shuffled: TopologyGraph = {
      nodes: shuffle(graph.nodes, 0x51ed),
      edges: flipEdges(shuffle(graph.edges, 0x7a1f)),
    };
    const first: GraphAnalysis = analyse(graph);
    const second: GraphAnalysis = analyse(shuffled);
    expect(second.components[0]!.rootId).toBe(first.components[0]!.rootId);
    expect(
      seedComponentPositions(
        second.components[0]!,
        second.adjacency,
        IDEAL_EDGE_LENGTH,
      ),
    ).toEqual(
      seedComponentPositions(
        first.components[0]!,
        first.adjacency,
        IDEAL_EDGE_LENGTH,
      ),
    );
  });
});

/* ------------------------------------------------------------------ */
/* placeLeafFans                                                        */
/* ------------------------------------------------------------------ */

interface FanSetup {
  analysis: GraphAnalysis;
  component: TopologyComponent;
  positions: Map<string, TopologyPoint>;
}

type FanSetupFunction = (graph: TopologyGraph) => FanSetup;

/* Seed a graph's first component, then hand it to the fan pass. */
const seededFanSetup: FanSetupFunction = (graph: TopologyGraph): FanSetup => {
  const analysis: GraphAnalysis = analyse(graph);
  const component: TopologyComponent = analysis.components[0]!;
  return {
    analysis: analysis,
    component: component,
    positions: seedComponentPositions(
      component,
      analysis.adjacency,
      IDEAL_EDGE_LENGTH,
    ),
  };
};

type RunFanFunction = (setup: FanSetup) => void;
const runFan: RunFanFunction = (setup: FanSetup): void => {
  placeLeafFans(
    setup.positions,
    setup.component,
    setup.analysis.adjacency,
    setup.analysis.footprints,
    setup.analysis.nameById,
  );
};

describe("placeLeafFans — a switch's leaves sit on rings, not a ragged annulus", () => {
  test("a hub with only three leaves is left exactly where the seed put it", () => {
    const setup: FanSetup = seededFanSetup(star(3));
    const before: Map<string, TopologyPoint> = snapshot(setup.positions);
    runFan(setup);
    expect(setup.positions).toEqual(before);
  });

  test("a hub whose fourth neighbour is not a leaf gets no fan", () => {
    /*
     * Four neighbours but only three of degree one. The fan is for
     * leaves; re-placing a neighbour that has its own subtree would tear
     * that subtree off its parent.
     */
    const graph: TopologyGraph = {
      nodes: [
        makeDevice("hub-000"),
        makeDevice("leaf-000"),
        makeDevice("leaf-001"),
        makeDevice("leaf-002"),
        makeDevice("mid-000"),
        makeDevice("tail-000"),
      ],
      edges: [
        makeLink("hub-000", "leaf-000"),
        makeLink("hub-000", "leaf-001"),
        makeLink("hub-000", "leaf-002"),
        makeLink("hub-000", "mid-000"),
        makeLink("mid-000", "tail-000"),
      ],
    };
    const setup: FanSetup = seededFanSetup(graph);
    const before: Map<string, TopologyPoint> = snapshot(setup.positions);
    runFan(setup);
    expect(setup.positions).toEqual(before);
  });

  test("eight leaves land on one ring, equidistant from their hub", () => {
    const setup: FanSetup = seededFanSetup(star(8));
    runFan(setup);
    const hub: TopologyPoint = setup.positions.get("hub-000")!;
    const first: number = distanceBetween(
      hub,
      setup.positions.get("leaf-000")!,
    );
    expect(first).toBeGreaterThanOrEqual(LEAF_FAN_MIN_RADIUS);
    expect(first).toBeLessThanOrEqual(LEAF_FAN_MAX_RADIUS);
    for (let i: number = 1; i < 8; i++) {
      expect(
        distanceBetween(hub, setup.positions.get(`leaf-${pad(i)}`)!),
      ).toBeCloseTo(first, 6);
    }
  });

  test("the hub itself is never moved by its own fan", () => {
    const setup: FanSetup = seededFanSetup(star(8));
    const before: TopologyPoint = { ...setup.positions.get("hub-000")! };
    runFan(setup);
    expect(setup.positions.get("hub-000")).toEqual(before);
  });

  test("a fan starting from a single coincident pile still separates every leaf", () => {
    /*
     * The degenerate input the analytic pass exists to survive: hub and
     * leaves all on one coordinate, which a force simulation has no
     * gradient to escape from.
     */
    const analysis: GraphAnalysis = analyse(star(10));
    const component: TopologyComponent = analysis.components[0]!;
    const positions: Map<string, TopologyPoint> = allCoincident(
      component.nodeIds,
    );
    placeLeafFans(
      positions,
      component,
      analysis.adjacency,
      analysis.footprints,
      analysis.nameById,
    );
    const hub: TopologyPoint = positions.get("hub-000")!;
    expect(hub).toEqual({ x: 0, y: 0 });
    for (let i: number = 0; i < 10; i++) {
      for (let j: number = i + 1; j < 10; j++) {
        expect(
          distanceBetween(
            positions.get(`leaf-${pad(i)}`)!,
            positions.get(`leaf-${pad(j)}`)!,
          ),
        ).toBeGreaterThan(1);
      }
    }
  });

  test("a fan points away from the hub's uplink", () => {
    /*
     * The uplink needs a device behind it. "Leaf" means degree one, so a
     * dangling uplink is itself a leaf and the hub would take the whole
     * circle instead of opening a three-quarter arc.
     */
    const graph: TopologyGraph = star(10);
    graph.nodes.push(makeDevice("uplink-000"), makeDevice("core-000"));
    graph.edges.push(
      makeLink("uplink-000", "hub-000"),
      makeLink("uplink-000", "core-000"),
    );
    const analysis: GraphAnalysis = analyse(graph);
    const component: TopologyComponent = analysis.components[0]!;
    const positions: Map<string, TopologyPoint> = allCoincident(
      component.nodeIds,
    );
    // Uplink due east of the hub; the fan must open to the west.
    positions.set("uplink-000", { x: 300, y: 0 });
    placeLeafFans(
      positions,
      component,
      analysis.adjacency,
      analysis.footprints,
      analysis.nameById,
    );

    let sumX: number = 0;
    for (let i: number = 0; i < 10; i++) {
      const leaf: TopologyPoint = positions.get(`leaf-${pad(i)}`)!;
      const angle: number = Math.atan2(leaf.y, leaf.x);
      sumX += leaf.x;
      // Every leaf inside the three-quarter arc centred on due west.
      expect(Math.abs(angleDifference(angle, Math.PI))).toBeLessThanOrEqual(
        TWO_PI * 0.75 * 0.5 + 1e-9,
      );
    }
    expect(sumX).toBeLessThan(0);
  });

  test("leaves are ordered around the arc by name, then by id", () => {
    /*
     * Ids run a-h but names run in reverse, so an id-ordered fan and a
     * name-ordered fan are opposites and the test can tell them apart.
     */
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("hub-000"),
      makeDevice("uplink-000"),
      makeDevice("core-000"),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeLink("uplink-000", "hub-000"),
      makeLink("uplink-000", "core-000"),
    ];
    const names: Array<string> = ["h", "g", "f", "e", "d", "c", "b", "a"];
    names.forEach((name: string, index: number): void => {
      const id: string = `leaf-${pad(index)}`;
      nodes.push(makeDevice(id, name));
      edges.push(makeLink("hub-000", id));
    });

    const analysis: GraphAnalysis = analyse({ nodes: nodes, edges: edges });
    const component: TopologyComponent = analysis.components[0]!;
    const positions: Map<string, TopologyPoint> = allCoincident(
      component.nodeIds,
    );
    positions.set("uplink-000", { x: 300, y: 0 });
    placeLeafFans(
      positions,
      component,
      analysis.adjacency,
      analysis.footprints,
      analysis.nameById,
    );

    /*
     * Offset from the arc's leading edge, walked in NAME order a..h —
     * which is leaf-007 down to leaf-000. An id-ordered fan would make
     * this sequence strictly decreasing instead.
     */
    const leadingEdge: number = normalizeAngle(Math.PI - TWO_PI * 0.375);
    const sweep: Array<number> = [];
    for (let n: number = 0; n < names.length; n++) {
      const leaf: TopologyPoint = positions.get(
        `leaf-${pad(names.length - 1 - n)}`,
      )!;
      sweep.push(normalizeAngle(Math.atan2(leaf.y, leaf.x) - leadingEdge));
    }
    for (let i: number = 1; i < sweep.length; i++) {
      expect(sweep[i]!).toBeGreaterThan(sweep[i - 1]!);
    }
  });

  test("more leaves than one ring holds spill onto a second ring", () => {
    const setup: FanSetup = seededFanSetup(star(40));
    runFan(setup);
    const hub: TopologyPoint = setup.positions.get("hub-000")!;
    const radii: Set<number> = new Set<number>();
    for (let i: number = 0; i < 40; i++) {
      const radius: number = distanceBetween(
        hub,
        setup.positions.get(`leaf-${pad(i)}`)!,
      );
      expect(radius).toBeLessThanOrEqual(
        LEAF_FAN_MAX_RADIUS + LEAF_FAN_RING_GAP + 1e-6,
      );
      radii.add(Math.round(radius));
    }
    expect(radii.size).toBe(2);
  });

  test("every hub in a component gets its own fan", () => {
    const setup: FanSetup = seededFanSetup(branchSite(0));
    runFan(setup);
    for (let s: number = 1; s <= 4; s++) {
      const hub: TopologyPoint = setup.positions.get(`switch-0${String(s)}`)!;
      const first: number = distanceBetween(
        hub,
        setup.positions.get(`endpoint:sw-0${String(s)}-e-${pad(0)}`)!,
      );
      for (let e: number = 1; e < 6; e++) {
        expect(
          distanceBetween(
            hub,
            setup.positions.get(`endpoint:sw-0${String(s)}-e-${pad(e)}`)!,
          ),
        ).toBeCloseTo(first, 6);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* simulateComponent                                                    */
/* ------------------------------------------------------------------ */

describe("simulateComponent — relaxation that never introduces randomness", () => {
  test("a one-node component is returned untouched", () => {
    const analysis: GraphAnalysis = analyse(singletons(1));
    const component: TopologyComponent = analysis.components[0]!;
    const positions: Map<string, TopologyPoint> = allCoincident(
      component.nodeIds,
    );
    simulateComponent(
      component,
      analysis.adjacency,
      positions,
      new Set<string>(),
      IDEAL_EDGE_LENGTH,
      240,
    );
    expect(positions.get("solo-000")).toEqual({ x: 0, y: 0 });
  });

  test("zero iterations leave the seed exactly as it was", () => {
    const setup: FanSetup = seededFanSetup(chain(8));
    const before: Map<string, TopologyPoint> = snapshot(setup.positions);
    simulateComponent(
      setup.component,
      setup.analysis.adjacency,
      setup.positions,
      new Set<string>(),
      IDEAL_EDGE_LENGTH,
      0,
    );
    expect(setup.positions).toEqual(before);
  });

  test("two coincident linked nodes are pushed apart, the same way every run", () => {
    const graph: TopologyGraph = chain(2);
    const analysis: GraphAnalysis = analyse(graph);
    const component: TopologyComponent = analysis.components[0]!;

    const runOnce: () => Map<string, TopologyPoint> = (): Map<
      string,
      TopologyPoint
    > => {
      const positions: Map<string, TopologyPoint> = allCoincident(
        component.nodeIds,
      );
      simulateComponent(
        component,
        analysis.adjacency,
        positions,
        new Set<string>(),
        IDEAL_EDGE_LENGTH,
        120,
      );
      return positions;
    };

    const first: Map<string, TopologyPoint> = runOnce();
    expect(
      distanceBetween(first.get("device-000")!, first.get("device-001")!),
    ).toBeGreaterThan(1);
    expect(runOnce()).toEqual(first);
  });

  test("the simulation is a pure function of its inputs", () => {
    const runOnce: () => Map<string, TopologyPoint> = (): Map<
      string,
      TopologyPoint
    > => {
      const setup: FanSetup = seededFanSetup(ring(12));
      simulateComponent(
        setup.component,
        setup.analysis.adjacency,
        setup.positions,
        new Set<string>(),
        IDEAL_EDGE_LENGTH,
        90,
      );
      return setup.positions;
    };
    expect(runOnce()).toEqual(runOnce());
  });
});

/* ------------------------------------------------------------------ */
/* computeForceTopologyModel — the core contracts, over every fixture   */
/* ------------------------------------------------------------------ */

describe("computeForceTopologyModel — no two glyphs are ever drawn on top of each other", () => {
  for (const fixture of ALL_FIXTURES) {
    test(`${fixture.name} lays out with zero glyph overlaps`, () => {
      const model: TopologyLayoutModel = computeForceTopologyModel(
        fixture.graph.nodes,
        fixture.graph.edges,
        WIDTH,
        HEIGHT,
      );
      expect(
        countNodeOverlaps(
          model.positions,
          canonicalNodeOrder(fixture.graph.nodes),
          buildFootprints(fixture.graph.nodes),
        ),
      ).toBe(0);
    });
  }
});

describe("computeForceTopologyModel — every node is placed exactly once, finitely", () => {
  for (const fixture of ALL_FIXTURES) {
    test(`${fixture.name} places each id once with finite coordinates`, () => {
      const model: TopologyLayoutModel = computeForceTopologyModel(
        fixture.graph.nodes,
        fixture.graph.edges,
        WIDTH,
        HEIGHT,
      );
      const ids: Array<string> = canonicalNodeOrder(fixture.graph.nodes);
      expect(model.positions.size).toBe(ids.length);
      for (const id of ids) {
        const point: TopologyPoint | undefined = model.positions.get(id);
        expect(point).toBeDefined();
        expect(Number.isFinite(point!.x)).toBe(true);
        expect(Number.isFinite(point!.y)).toBe(true);
      }
      expect(model.groups).toEqual([]);
      expect(Number.isFinite(model.contentWidth)).toBe(true);
      expect(Number.isFinite(model.contentHeight)).toBe(true);
    });
  }
});

describe("computeForceTopologyModel — no painted extent escapes the content box", () => {
  for (const fixture of ALL_FIXTURES) {
    test(`${fixture.name} keeps every glyph and label inside the reported box`, () => {
      const model: TopologyLayoutModel = computeForceTopologyModel(
        fixture.graph.nodes,
        fixture.graph.edges,
        WIDTH,
        HEIGHT,
      );
      const footprints: Map<string, TopologyNodeFootprint> = buildFootprints(
        fixture.graph.nodes,
      );
      for (const id of canonicalNodeOrder(fixture.graph.nodes)) {
        const point: TopologyPoint = model.positions.get(id)!;
        const footprint: TopologyNodeFootprint = footprintOrDefault(
          footprints,
          id,
        );
        expect(point.x - footprint.inkHalfWidth).toBeGreaterThanOrEqual(0);
        expect(point.x + footprint.inkHalfWidth).toBeLessThanOrEqual(
          model.contentWidth,
        );
        expect(point.y - footprint.halfHeight).toBeGreaterThanOrEqual(0);
        expect(point.y + footprint.labelBottom).toBeLessThanOrEqual(
          model.contentHeight,
        );
      }
      // The box is never smaller than the frame it was asked to fill.
      expect(model.contentWidth).toBeGreaterThanOrEqual(WIDTH);
      expect(model.contentHeight).toBeGreaterThanOrEqual(HEIGHT);
    });
  }
});

describe("computeForceTopologyModel — the layout is a function of the graph", () => {
  /*
   * The single most valuable test in this file. The topology endpoint does
   * not promise a stable row order, so a layout that depends on array
   * position redraws the whole map on every sixty-second poll. Permuting
   * the nodes, permuting the edges and flipping every edge's direction
   * must all be invisible — bit for bit, not approximately.
   */
  for (const fixture of ALL_FIXTURES) {
    test(`${fixture.name} is bit-identical when nodes and edges are permuted`, () => {
      const original: TopologyLayoutModel = computeForceTopologyModel(
        fixture.graph.nodes,
        fixture.graph.edges,
        WIDTH,
        HEIGHT,
      );
      const permuted: TopologyLayoutModel = computeForceTopologyModel(
        shuffle(fixture.graph.nodes, 0x1234abcd),
        flipEdges(shuffle(fixture.graph.edges, 0xfeed5eed)),
        WIDTH,
        HEIGHT,
      );
      expect(permuted.positions).toEqual(original.positions);
      expect(permuted.componentBoxes).toEqual(original.componentBoxes);
      expect(permuted.contentWidth).toBe(original.contentWidth);
      expect(permuted.contentHeight).toBe(original.contentHeight);
    });
  }

  test("a second, differently-seeded permutation lands on the same map", () => {
    const graph: TopologyGraph = branchSite(0);
    const original: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    for (const seed of [1, 7919, 0x0badf00d, 0xffffffff]) {
      const permuted: TopologyLayoutModel = computeForceTopologyModel(
        shuffle(graph.nodes, seed),
        shuffle(graph.edges, seed ^ 0x5a5a5a5a),
        WIDTH,
        HEIGHT,
      );
      expect(permuted.positions).toEqual(original.positions);
    }
  });

  test("three runs on one input agree deeply — there is no hidden module state", () => {
    const graph: TopologyGraph = branchSite(0);
    const first: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const second: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const third: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  test("laying out other graphs in between changes nothing", () => {
    const graph: TopologyGraph = ring(9);
    const first: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    computeForceTopologyModel(
      branchSite(2).nodes,
      branchSite(2).edges,
      WIDTH,
      HEIGHT,
    );
    computeForceTopologyModel(star(40).nodes, star(40).edges, 640, 480);
    expect(
      computeForceTopologyModel(graph.nodes, graph.edges, WIDTH, HEIGHT),
    ).toEqual(first);
  });

  test("the caller's node and edge arrays are never mutated", () => {
    const graph: TopologyGraph = branchSite(0);
    const nodesBefore: string = JSON.stringify(graph.nodes);
    const edgesBefore: string = JSON.stringify(graph.edges);
    computeForceTopologyModel(graph.nodes, graph.edges, WIDTH, HEIGHT);
    expect(JSON.stringify(graph.nodes)).toBe(nodesBefore);
    expect(JSON.stringify(graph.edges)).toBe(edgesBefore);
  });
});

describe("computeForceTopologyModel — the sixty-second poll must not redraw the map", () => {
  test("adding one endpoint to a branch site moves everything else only slightly", () => {
    const before: TopologyLayoutModel = computeForceTopologyModel(
      branchSite(0).nodes,
      branchSite(0).edges,
      WIDTH,
      HEIGHT,
    );
    const after: TopologyLayoutModel = computeForceTopologyModel(
      branchSite(1).nodes,
      branchSite(1).edges,
      WIDTH,
      HEIGHT,
    );

    let total: number = 0;
    let moved: number = 0;
    for (const [id, point] of before.positions) {
      const next: TopologyPoint | undefined = after.positions.get(id);
      expect(next).toBeDefined();
      total += distanceBetween(point, next!);
      moved++;
    }
    expect(moved).toBe(before.positions.size);
    expect(total / moved).toBeLessThan(60);
  });

  test("the three unlinked access points do not move at all when a leaf appears", () => {
    /*
     * The unlinked strip is a wrapped grid keyed on sorted id, so a new
     * endpoint elsewhere in the graph cannot reshuffle it. It may still
     * shift as a block when the packed content above it changes height,
     * so the contract asserted is that the three stay rigid RELATIVE to
     * each other.
     */
    const before: TopologyLayoutModel = computeForceTopologyModel(
      branchSite(0).nodes,
      branchSite(0).edges,
      WIDTH,
      HEIGHT,
    );
    const after: TopologyLayoutModel = computeForceTopologyModel(
      branchSite(1).nodes,
      branchSite(1).edges,
      WIDTH,
      HEIGHT,
    );
    const firstBefore: TopologyPoint = before.positions.get("unmanaged:ap-1")!;
    const firstAfter: TopologyPoint = after.positions.get("unmanaged:ap-1")!;
    for (const apId of ["unmanaged:ap-2", "unmanaged:ap-3"]) {
      const deltaBefore: TopologyPoint = before.positions.get(apId)!;
      const deltaAfter: TopologyPoint = after.positions.get(apId)!;
      expect(deltaAfter.x - firstAfter.x).toBeCloseTo(
        deltaBefore.x - firstBefore.x,
        6,
      );
      expect(deltaAfter.y - firstAfter.y).toBeCloseTo(
        deltaBefore.y - firstBefore.y,
        6,
      );
    }
  });
});

describe("computeForceTopologyModel — a forty-port switch reads as rings", () => {
  test("star(1,40) puts its leaves on at most three distinct radii", () => {
    /*
     * The "messed up" look was a ragged annulus: a leaf's distance from
     * its hub is a near-flat direction of the simulation's energy, so it
     * was decided by noise. The analytic fan replaces that with rings.
     */
    const graph: TopologyGraph = star(40);
    const model: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const hub: TopologyPoint = model.positions.get("hub-000")!;
    const radii: Set<number> = new Set<number>();
    for (let i: number = 0; i < 40; i++) {
      radii.add(
        Math.round(
          distanceBetween(hub, model.positions.get(`leaf-${pad(i)}`)!),
        ),
      );
    }
    expect(radii.size).toBeLessThanOrEqual(3);
    expect(radii.size).toBeGreaterThan(0);
  });

  test("no leaf of a forty-port switch is closer to another hub's leaf than to its own hub", () => {
    /* Two forty-port switches side by side must not interleave. */
    const first: TopologyGraph = star(40);
    const second: TopologyGraph = {
      nodes: [makeDevice("zhub-000")],
      edges: [],
    };
    for (let i: number = 0; i < 40; i++) {
      second.nodes.push(makeDevice(`zleaf-${pad(i)}`));
      second.edges.push(makeLink("zhub-000", `zleaf-${pad(i)}`));
    }
    const model: TopologyLayoutModel = computeForceTopologyModel(
      [...first.nodes, ...second.nodes],
      [...first.edges, ...second.edges],
      WIDTH,
      HEIGHT,
    );
    for (let i: number = 0; i < 40; i++) {
      const leaf: TopologyPoint = model.positions.get(`leaf-${pad(i)}`)!;
      expect(
        distanceBetween(leaf, model.positions.get("hub-000")!),
      ).toBeLessThan(distanceBetween(leaf, model.positions.get("zhub-000")!));
    }
  });
});

describe("computeForceTopologyModel — islands read as islands", () => {
  type BoxesOverlapFunction = (
    a: TopologyComponentBox,
    b: TopologyComponentBox,
  ) => boolean;
  const boxesOverlap: BoxesOverlapFunction = (
    a: TopologyComponentBox,
    b: TopologyComponentBox,
  ): boolean => {
    const disjointX: boolean = a.x + a.width <= b.x || b.x + b.width <= a.x;
    const disjointY: boolean = a.y + a.height <= b.y || b.y + b.height <= a.y;
    return !disjointX && !disjointY;
  };

  const islandFixtures: ReadonlyArray<NamedGraph> = [
    { name: "twoIslands()", graph: twoIslands() },
    {
      name: "threePairsPlusSixSingletons()",
      graph: threePairsPlusSixSingletons(),
    },
    { name: "branchSite()", graph: branchSite(0) },
  ];

  for (const fixture of islandFixtures) {
    test(`${fixture.name} produces pairwise disjoint component boxes`, () => {
      const model: TopologyLayoutModel = computeForceTopologyModel(
        fixture.graph.nodes,
        fixture.graph.edges,
        WIDTH,
        HEIGHT,
      );
      expect(model.componentBoxes.length).toBeGreaterThan(1);
      for (let i: number = 0; i < model.componentBoxes.length; i++) {
        for (let j: number = i + 1; j < model.componentBoxes.length; j++) {
          expect(
            boxesOverlap(model.componentBoxes[i]!, model.componentBoxes[j]!),
          ).toBe(false);
        }
      }
    });

    test(`${fixture.name} keeps every node inside its own box and out of every other`, () => {
      const model: TopologyLayoutModel = computeForceTopologyModel(
        fixture.graph.nodes,
        fixture.graph.edges,
        WIDTH,
        HEIGHT,
      );
      const analysis: GraphAnalysis = analyse(fixture.graph);
      const membersByKey: Map<string, Set<string>> = new Map<
        string,
        Set<string>
      >();
      const unlinked: Set<string> = new Set<string>();
      for (const component of analysis.components) {
        if (component.nodeIds.length === 1) {
          unlinked.add(component.rootId);
        } else {
          membersByKey.set(
            component.rootId,
            new Set<string>(component.nodeIds),
          );
        }
      }
      membersByKey.set(UNLINKED_BOX_KEY, unlinked);

      for (const box of model.componentBoxes) {
        const members: Set<string> = membersByKey.get(box.key)!;
        expect(box.nodeCount).toBe(members.size);
        for (const id of analysis.orderedIds) {
          const point: TopologyPoint = model.positions.get(id)!;
          const inside: boolean =
            point.x >= box.x &&
            point.x <= box.x + box.width &&
            point.y >= box.y &&
            point.y <= box.y + box.height;
          expect(inside).toBe(members.has(id));
        }
      }
    });
  }

  test("six devices with no links share exactly one unlinked strip", () => {
    const graph: TopologyGraph = threePairsPlusSixSingletons();
    const model: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const unlinkedBoxes: Array<TopologyComponentBox> =
      model.componentBoxes.filter((box: TopologyComponentBox): boolean => {
        return box.isUnlinked;
      });
    expect(unlinkedBoxes.length).toBe(1);
    expect(unlinkedBoxes[0]!.key).toBe(UNLINKED_BOX_KEY);
    expect(unlinkedBoxes[0]!.nodeCount).toBe(6);
    // ...and the three two-device islands each get their own box.
    expect(model.componentBoxes.length).toBe(4);
    for (const box of model.componentBoxes) {
      if (!box.isUnlinked) {
        expect(box.nodeCount).toBe(2);
      }
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }
  });

  test("a fully connected graph produces exactly one box, never an unlinked strip", () => {
    const graph: TopologyGraph = completeGraph(6);
    const model: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    expect(model.componentBoxes.length).toBe(1);
    expect(model.componentBoxes[0]!.isUnlinked).toBe(false);
    expect(model.componentBoxes[0]!.nodeCount).toBe(6);
  });
});

describe("computeForceTopologyModel — a dragged device stays where it was dropped", () => {
  const graph: TopologyGraph = chain(12);

  test("a pinned coordinate comes back bit-identical", () => {
    const pinned: Map<string, TopologyPoint> = new Map<string, TopologyPoint>([
      ["device-004", { x: 123.456789, y: -98.7654321 }],
    ]);
    const model: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    expect(model.positions.get("device-004")!.x).toBe(123.456789);
    expect(model.positions.get("device-004")!.y).toBe(-98.7654321);
  });

  test("pinning one device leaves every other device exactly where it was", () => {
    const unpinned: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const model: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
      new Map<string, TopologyPoint>([["device-004", { x: 10, y: 20 }]]),
    );
    for (const id of canonicalNodeOrder(graph.nodes)) {
      if (id === "device-004") {
        continue;
      }
      expect(model.positions.get(id)).toEqual(unpinned.positions.get(id));
    }
  });

  test("pinning an id that is not in the graph is a complete no-op", () => {
    const unpinned: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const model: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
      new Map<string, TopologyPoint>([["device-999", { x: 9999, y: 9999 }]]),
    );
    expect(model).toEqual(unpinned);
    expect(model.positions.has("device-999")).toBe(false);
  });

  test("an empty pin map is a complete no-op", () => {
    expect(
      computeForceTopologyModel(
        graph.nodes,
        graph.edges,
        WIDTH,
        HEIGHT,
        new Map<string, TopologyPoint>(),
      ),
    ).toEqual(
      computeForceTopologyModel(graph.nodes, graph.edges, WIDTH, HEIGHT),
    );
  });

  test("a non-finite pin is ignored rather than blanking the node", () => {
    const unpinned: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const model: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
      new Map<string, TopologyPoint>([
        ["device-004", { x: Number.NaN, y: 20 }],
        ["device-005", { x: 10, y: Number.POSITIVE_INFINITY }],
      ]),
    );
    expect(model.positions.get("device-004")).toEqual(
      unpinned.positions.get("device-004"),
    );
    expect(model.positions.get("device-005")).toEqual(
      unpinned.positions.get("device-005"),
    );
  });

  test("a pin dragged beyond the frame grows the reported content box", () => {
    const model: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
      new Map<string, TopologyPoint>([["device-004", { x: 5000, y: 4000 }]]),
    );
    const footprint: TopologyNodeFootprint = footprintOrDefault(
      buildFootprints(graph.nodes),
      "device-004",
    );
    expect(model.contentWidth).toBeCloseTo(
      5000 + footprint.inkHalfWidth + LAYOUT_MARGIN,
      6,
    );
    expect(model.contentHeight).toBeCloseTo(
      4000 + footprint.labelBottom + LAYOUT_MARGIN,
      6,
    );
  });

  test("pins survive a permutation of the input unchanged", () => {
    const pinned: Map<string, TopologyPoint> = new Map<string, TopologyPoint>([
      ["device-002", { x: 401.5, y: 88.25 }],
      ["device-007", { x: -12, y: 640.75 }],
    ]);
    const original: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
      pinned,
    );
    const permuted: TopologyLayoutModel = computeForceTopologyModel(
      shuffle(graph.nodes, 0x2f2f),
      flipEdges(shuffle(graph.edges, 0x3131)),
      WIDTH,
      HEIGHT,
      pinned,
    );
    expect(permuted.positions).toEqual(original.positions);
  });
});

describe("computeForceTopologyModel — degenerate and hostile input", () => {
  test("an empty topology returns an empty model at the frame size", () => {
    const model: TopologyLayoutModel = computeForceTopologyModel(
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

  test("an empty topology in a zero frame reports a zero box, not a negative one", () => {
    const model: TopologyLayoutModel = computeForceTopologyModel([], [], -5, 0);
    expect(model.contentWidth).toBe(0);
    expect(model.contentHeight).toBe(0);
  });

  test("a single device is painted dead centre of the frame", () => {
    const node: NetworkTopologyNode = makeDevice("only-1", "only-1");
    const model: TopologyLayoutModel = computeForceTopologyModel(
      [node],
      [],
      WIDTH,
      HEIGHT,
    );
    const point: TopologyPoint = model.positions.get("only-1")!;
    const footprint: TopologyNodeFootprint = footprintOrDefault(
      buildFootprints([node]),
      "only-1",
    );
    expect(point.x).toBeCloseTo(model.contentWidth / 2, 6);
    // The PAINTED extent is centred, not the glyph — the label hangs below.
    expect(
      (point.y - footprint.halfHeight + point.y + footprint.labelBottom) / 2,
    ).toBeCloseTo(model.contentHeight / 2, 6);
  });

  test("duplicate node ids collapse to one placement", () => {
    const model: TopologyLayoutModel = computeForceTopologyModel(
      [
        makeDevice("device-000"),
        makeDevice("device-000"),
        makeDevice("device-001"),
        makeDevice("device-000"),
      ],
      [makeLink("device-000", "device-001")],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(2);
    expect(Number.isFinite(model.positions.get("device-000")!.x)).toBe(true);
    expect(Number.isFinite(model.positions.get("device-001")!.y)).toBe(true);
  });

  test("a node with an empty id is dropped rather than placed at nowhere", () => {
    const model: TopologyLayoutModel = computeForceTopologyModel(
      [makeDevice(""), makeDevice("device-000")],
      [],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(1);
    expect(model.positions.has("")).toBe(false);
  });

  test("edges naming absent nodes add no phantom entries", () => {
    const model: TopologyLayoutModel = computeForceTopologyModel(
      [makeDevice("device-000"), makeDevice("device-001")],
      [
        makeLink("device-000", "device-404"),
        makeLink("device-404", "device-405"),
        makeLink("device-000", "device-001"),
      ],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(2);
    expect(model.positions.has("device-404")).toBe(false);
    // The one real edge still linked them into a single component.
    expect(model.componentBoxes.length).toBe(1);
    expect(model.componentBoxes[0]!.isUnlinked).toBe(false);
  });

  test("a self-loop links a device to nothing", () => {
    const model: TopologyLayoutModel = computeForceTopologyModel(
      [makeDevice("device-000"), makeDevice("device-001")],
      [makeLink("device-000", "device-000")],
      WIDTH,
      HEIGHT,
    );
    expect(model.componentBoxes.length).toBe(1);
    expect(model.componentBoxes[0]!.isUnlinked).toBe(true);
    expect(model.componentBoxes[0]!.nodeCount).toBe(2);
  });

  test("an undefined edge array is treated as no edges", () => {
    const nodes: Array<NetworkTopologyNode> = singletons(4).nodes;
    const missingEdges: Array<NetworkTopologyEdge> =
      undefined as unknown as Array<NetworkTopologyEdge>;
    const model: TopologyLayoutModel = computeForceTopologyModel(
      nodes,
      missingEdges,
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(4);
    expect(model).toEqual(computeForceTopologyModel(nodes, [], WIDTH, HEIGHT));
  });

  test("legacy edges with no protocols still build the graph", () => {
    const model: TopologyLayoutModel = computeForceTopologyModel(
      [makeDevice("device-000"), makeDevice("device-001")],
      [makeBareLink("device-000", "device-001")],
      WIDTH,
      HEIGHT,
    );
    expect(model.componentBoxes.length).toBe(1);
    expect(model.componentBoxes[0]!.nodeCount).toBe(2);
  });

  test("zero, negative and NaN frame sizes still return finite coordinates", () => {
    const graph: TopologyGraph = branchSite(0);
    const frames: Array<[number, number]> = [
      [0, 0],
      [-1000, -700],
      [Number.NaN, Number.NaN],
      [Number.POSITIVE_INFINITY, 700],
      [1, 1],
    ];
    for (const frame of frames) {
      const model: TopologyLayoutModel = computeForceTopologyModel(
        graph.nodes,
        graph.edges,
        frame[0],
        frame[1],
      );
      expect(model.positions.size).toBe(canonicalNodeOrder(graph.nodes).length);
      for (const point of model.positions.values()) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
      }
      expect(Number.isFinite(model.contentWidth)).toBe(true);
      expect(Number.isFinite(model.contentHeight)).toBe(true);
    }
  });

  test("a hostile 400-character device name cannot distort the layout", () => {
    const graph: TopologyGraph = chain(6);
    graph.nodes[2] = makeDevice("device-002", "x".repeat(400));
    const model: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const footprints: Map<string, TopologyNodeFootprint> = buildFootprints(
      graph.nodes,
    );
    expect(
      countNodeOverlaps(
        model.positions,
        canonicalNodeOrder(graph.nodes),
        footprints,
      ),
    ).toBe(0);
    for (const id of canonicalNodeOrder(graph.nodes)) {
      const point: TopologyPoint = model.positions.get(id)!;
      const footprint: TopologyNodeFootprint = footprintOrDefault(
        footprints,
        id,
      );
      expect(point.x - footprint.inkHalfWidth).toBeGreaterThanOrEqual(0);
      expect(point.x + footprint.inkHalfWidth).toBeLessThanOrEqual(
        model.contentWidth,
      );
    }
  });

  test("nodes with no name at all are placed and framed like any other", () => {
    const model: TopologyLayoutModel = computeForceTopologyModel(
      [makeDevice("device-000", ""), makeDevice("device-001", "")],
      [makeLink("device-000", "device-001")],
      WIDTH,
      HEIGHT,
    );
    expect(model.positions.size).toBe(2);
    expect(
      countNodeOverlaps(
        model.positions,
        ["device-000", "device-001"],
        buildFootprints([
          makeDevice("device-000", ""),
          makeDevice("device-001", ""),
        ]),
      ),
    ).toBe(0);
  });

  test("an explicit zero-iteration budget still returns a usable, overlap-free map", () => {
    /*
     * REGRESSION. Skipping the simulation is what happens above
     * MAX_SIMULATED_NODES, so the radial seed plus the fan and collision
     * passes has to be a readable layout on its own — and it was not.
     * relaxNodeCollisions cleared every glyph overlap, then
     * relaxLabelCollisions slid a switch sideways to clear a label and
     * pushed it 4px inside an endpoint belonging to a different switch.
     * The glyph pass now runs once more, last, so its guarantee is the
     * one that survives.
     */
    const graph: TopologyGraph = branchSite(0);
    const model: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
      undefined,
      0,
    );
    expect(model.positions.size).toBe(canonicalNodeOrder(graph.nodes).length);
    expect(
      countNodeOverlaps(
        model.positions,
        canonicalNodeOrder(graph.nodes),
        buildFootprints(graph.nodes),
      ),
    ).toBe(0);
  });
});

describe("computeForceTopologyModel — a large topology returns promptly", () => {
  test("chain(2000) lays out in under three seconds with no overlaps", () => {
    /*
     * The old all-pairs implementation took minutes on a graph this
     * size, which is the difference between a map and a frozen tab.
     * process.hrtime is used rather than Date.now so the measurement is
     * monotonic and this file stays free of wall-clock reads.
     */
    const graph: TopologyGraph = chain(2000);
    const start: bigint = process.hrtime.bigint();
    const model: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const elapsedMs: number = Number(process.hrtime.bigint() - start) / 1000000;

    expect(model.positions.size).toBe(2000);
    expect(elapsedMs).toBeLessThan(3000);
    expect(
      countNodeOverlaps(
        model.positions,
        canonicalNodeOrder(graph.nodes),
        buildFootprints(graph.nodes),
      ),
    ).toBe(0);
  }, 60000);

  test("two thousand devices with no neighbours strip out in under three seconds", () => {
    /*
     * A brand new project reports every device with an empty neighbour
     * table until the first discovery poll lands, so "n islands of one"
     * is the state the map opens in, not an edge case.
     */
    const graph: TopologyGraph = singletons(2000);
    const start: bigint = process.hrtime.bigint();
    const model: TopologyLayoutModel = computeForceTopologyModel(
      graph.nodes,
      graph.edges,
      WIDTH,
      HEIGHT,
    );
    const elapsedMs: number = Number(process.hrtime.bigint() - start) / 1000000;

    expect(model.positions.size).toBe(2000);
    expect(elapsedMs).toBeLessThan(3000);
    expect(model.componentBoxes.length).toBe(1);
    expect(model.componentBoxes[0]!.isUnlinked).toBe(true);
    expect(
      countNodeOverlaps(
        model.positions,
        canonicalNodeOrder(graph.nodes),
        buildFootprints(graph.nodes),
      ),
    ).toBe(0);
  }, 60000);
});
