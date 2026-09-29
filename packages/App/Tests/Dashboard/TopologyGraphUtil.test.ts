import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  TopologyAdjacency,
  TopologyComponent,
  TopologyEdgePair,
  bfsChildrenOf,
  buildTopologyAdjacency,
  canonicalNodeOrder,
  clamp,
  compareNodeIds,
  findTopologyComponents,
  hashString,
  seededUnit,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";

/* ------------------------------------------------------------------ */
/* Fixtures and helpers                                                */
/* ------------------------------------------------------------------ */

type MakeNodeFunction = (id: string) => NetworkTopologyNode;

const makeNode: MakeNodeFunction = (id: string): NetworkTopologyNode => {
  return { id: id, name: id, isManaged: true, status: "up" };
};

type MakeEdgeFunction = (from: string, to: string) => NetworkTopologyEdge;

const makeEdge: MakeEdgeFunction = (
  from: string,
  to: string,
): NetworkTopologyEdge => {
  return { fromNodeId: from, toNodeId: to };
};

/*
 * A payload the API contract says cannot happen but a stale cache, a
 * half-written migration or a hand-rolled fixture can still produce. Cast
 * through unknown so the tests can prove the module survives it.
 */
type MakeRawEdgeFunction = (
  raw: Partial<NetworkTopologyEdge>,
) => NetworkTopologyEdge;

const makeRawEdge: MakeRawEdgeFunction = (
  raw: Partial<NetworkTopologyEdge>,
): NetworkTopologyEdge => {
  return raw as unknown as NetworkTopologyEdge;
};

type MakeRawNodeFunction = (
  raw: Partial<NetworkTopologyNode>,
) => NetworkTopologyNode;

const makeRawNode: MakeRawNodeFunction = (
  raw: Partial<NetworkTopologyNode>,
): NetworkTopologyNode => {
  return raw as unknown as NetworkTopologyNode;
};

interface TopologyGraph {
  nodes: Array<NetworkTopologyNode>;
  edges: Array<NetworkTopologyEdge>;
}

type BuildGraphFunction = (
  ids: Array<string>,
  pairs: Array<[string, string]>,
) => TopologyGraph;

const buildGraph: BuildGraphFunction = (
  ids: Array<string>,
  pairs: Array<[string, string]>,
): TopologyGraph => {
  return {
    nodes: ids.map((id: string): NetworkTopologyNode => {
      return makeNode(id);
    }),
    edges: pairs.map((pair: [string, string]): NetworkTopologyEdge => {
      return makeEdge(pair[0], pair[1]);
    }),
  };
};

/*
 * Seeded xorshift, written here rather than imported: the fixtures must be
 * reproducible byte for byte on every machine and every run, and
 * Math.random would make a failing permutation impossible to reproduce.
 */
type NextSeedFunction = (seed: number) => number;

const nextSeed: NextSeedFunction = (seed: number): number => {
  let x: number = seed >>> 0;
  if (x === 0) {
    x = 0x2545f491;
  }
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return x >>> 0;
};

type ShuffleFunction = <T>(items: ReadonlyArray<T>, seed: number) => Array<T>;

const shuffle: ShuffleFunction = <T>(
  items: ReadonlyArray<T>,
  seed: number,
): Array<T> => {
  const out: Array<T> = [...items];
  let state: number = nextSeed(seed + 7);
  for (let i: number = out.length - 1; i > 0; i--) {
    state = nextSeed(state);
    const j: number = state % (i + 1);
    const held: T = out[i]!;
    out[i] = out[j]!;
    out[j] = held;
  }
  return out;
};

type MakeRandomGraphFunction = (
  nodeCount: number,
  edgeCount: number,
  seed: number,
) => TopologyGraph;

const makeRandomGraph: MakeRandomGraphFunction = (
  nodeCount: number,
  edgeCount: number,
  seed: number,
): TopologyGraph => {
  const ids: Array<string> = [];
  for (let i: number = 0; i < nodeCount; i++) {
    ids.push(`dev-${String(i).padStart(3, "0")}`);
  }
  const pairs: Array<[string, string]> = [];
  let state: number = nextSeed(seed);
  for (let i: number = 0; i < edgeCount; i++) {
    state = nextSeed(state);
    const from: string = ids[state % nodeCount]!;
    state = nextSeed(state);
    const to: string = ids[state % nodeCount]!;
    pairs.push([from, to]);
  }
  /* Two edges naming a device that has aged out of the view. */
  pairs.push(["dev-000", "ghost-device"]);
  pairs.push(["ghost-device", "dev-001"]);
  return buildGraph(ids, pairs);
};

/*
 * Structural snapshots. Array.from over a Map preserves INSERTION order,
 * so comparing these with toEqual is strictly stronger than comparing the
 * Maps directly (jest compares Maps order-insensitively). The insertion
 * order of every map this module builds is itself a contract: it is
 * canonical id order for adjacency, BFS order for depths.
 */
interface AdjacencySnapshot {
  neighbors: Array<[string, Array<string>]>;
  degrees: Array<[string, number]>;
  uniqueEdges: Array<TopologyEdgePair>;
}

type SnapshotAdjacencyFunction = (
  adjacency: TopologyAdjacency,
) => AdjacencySnapshot;

const snapshotAdjacency: SnapshotAdjacencyFunction = (
  adjacency: TopologyAdjacency,
): AdjacencySnapshot => {
  return {
    neighbors: Array.from(adjacency.neighborsById.entries()),
    degrees: Array.from(adjacency.degreeById.entries()),
    uniqueEdges: adjacency.uniqueEdges,
  };
};

interface ComponentSnapshot {
  nodeIds: Array<string>;
  rootId: string;
  edges: Array<TopologyEdgePair>;
  depths: Array<[string, number]>;
  children: Array<[string, Array<string>]>;
}

interface TopologySnapshot {
  orderedIds: Array<string>;
  adjacency: AdjacencySnapshot;
  components: Array<ComponentSnapshot>;
}

type SnapshotGraphFunction = (graph: TopologyGraph) => TopologySnapshot;

const snapshotGraph: SnapshotGraphFunction = (
  graph: TopologyGraph,
): TopologySnapshot => {
  const orderedIds: Array<string> = canonicalNodeOrder(graph.nodes);
  const adjacency: TopologyAdjacency = buildTopologyAdjacency(
    graph.nodes,
    graph.edges,
  );
  const components: Array<TopologyComponent> = findTopologyComponents(
    adjacency,
    orderedIds,
  );
  return {
    orderedIds: orderedIds,
    adjacency: snapshotAdjacency(adjacency),
    components: components.map(
      (component: TopologyComponent): ComponentSnapshot => {
        return {
          nodeIds: component.nodeIds,
          rootId: component.rootId,
          edges: component.edges,
          depths: Array.from(component.depthById.entries()),
          children: Array.from(bfsChildrenOf(component, adjacency).entries()),
        };
      },
    ),
  };
};

type IsSortedFunction = (values: ReadonlyArray<string>) => boolean;

const isSorted: IsSortedFunction = (values: ReadonlyArray<string>): boolean => {
  for (let i: number = 1; i < values.length; i++) {
    if (compareNodeIds(values[i - 1]!, values[i]!) >= 0) {
      return false;
    }
  }
  return true;
};

/* The canonical multi-component sample used across several suites. */
const SAMPLE_GRAPH: TopologyGraph = buildGraph(
  ["core", "sw-a", "sw-b", "host-1", "host-2", "island-a", "island-b", "lone"],
  [
    ["core", "sw-a"],
    ["core", "sw-b"],
    ["sw-a", "host-1"],
    ["sw-b", "host-2"],
    ["island-a", "island-b"],
  ],
);

/* ------------------------------------------------------------------ */
/* hashString                                                          */
/* ------------------------------------------------------------------ */

describe("hashString", () => {
  test("the same string always hashes to the same value", () => {
    expect(hashString("switch-a")).toBe(hashString("switch-a"));
    expect(hashString("")).toBe(hashString(""));
    expect(hashString("unmanaged:AP Lobby 1")).toBe(
      hashString("unmanaged:AP Lobby 1"),
    );
  });

  test("the empty string hashes to the FNV-1a offset basis", () => {
    expect(hashString("")).toBe(2166136261);
  });

  test("every hash is an unsigned 32-bit integer", () => {
    const samples: Array<string> = [
      "",
      "a",
      "core-router",
      "endpoint:00:1b:44:11:3a:b7",
      "\u0000",
      "😀 emoji id",
      "x".repeat(4096),
    ];
    for (const sample of samples) {
      const hash: number = hashString(sample);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(4294967295);
    }
  });

  test("distinct ids hash to distinct values across a realistic id space", () => {
    const hashes: Set<number> = new Set<number>();
    for (let i: number = 0; i < 1000; i++) {
      hashes.add(hashString(`endpoint:node-${String(i).padStart(4, "0")}`));
    }
    expect(hashes.size).toBe(1000);
  });

  test("hashing is order sensitive and case sensitive", () => {
    expect(hashString("ab")).not.toBe(hashString("ba"));
    expect(hashString("sw-a")).not.toBe(hashString("SW-A"));
    expect(hashString("a")).not.toBe(hashString("aa"));
  });
});

/* ------------------------------------------------------------------ */
/* seededUnit                                                          */
/* ------------------------------------------------------------------ */

describe("seededUnit", () => {
  test("every seed produces a finite value inside [0, 1)", () => {
    for (let seed: number = 0; seed < 2000; seed++) {
      const value: number = seededUnit(seed);
      expect(Number.isNaN(value)).toBe(false);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("non-integer, negative and non-finite seeds still land inside [0, 1)", () => {
    const hostileSeeds: Array<number> = [
      -1,
      -2147483648,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1.5,
      1e21,
      4294967296,
    ];
    for (const seed of hostileSeeds) {
      const value: number = seededUnit(seed);
      expect(Number.isNaN(value)).toBe(false);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("the same seed always produces the same value", () => {
    expect(seededUnit(12345)).toBe(seededUnit(12345));
    expect(seededUnit(0)).toBe(seededUnit(0));
    expect(seededUnit(hashString("sw-a"))).toBe(seededUnit(hashString("sw-a")));
  });

  test("seed 0 escapes the xorshift fixed point instead of returning 0", () => {
    /*
     * Zero is a fixed point of xorshift: without the escape hatch every
     * node whose hash happened to be 0 would be seeded at exactly the same
     * spot and the separation jitter would never separate them.
     */
    expect(seededUnit(0)).not.toBe(0);
    expect(seededUnit(0)).toBe(seededUnit(0x9e3779b9));
  });

  test("seeds are folded to unsigned 32 bits before use", () => {
    expect(seededUnit(-1)).toBe(seededUnit(4294967295));
    expect(seededUnit(4294967296)).toBe(seededUnit(0));
  });

  test("consecutive seeds do not collide", () => {
    const values: Set<number> = new Set<number>();
    for (let seed: number = 0; seed < 512; seed++) {
      values.add(seededUnit(seed));
    }
    expect(values.size).toBe(512);
  });
});

/* ------------------------------------------------------------------ */
/* clamp                                                               */
/* ------------------------------------------------------------------ */

describe("clamp", () => {
  test("a value inside the range is returned untouched", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, -10, 10)).toBe(-3);
    expect(clamp(0.125, 0, 1)).toBe(0.125);
  });

  test("the inclusive bounds are inside the range", () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  test("a value below the range collapses to min, above collapses to max", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(-1e9, 0.25, 4)).toBe(0.25);
    expect(clamp(1e9, 0.25, 4)).toBe(4);
  });

  test("non-finite input returns the midpoint so no NaN ever reaches an SVG attribute", () => {
    /*
     * A NaN in an SVG coordinate makes that element disappear, and a NaN in
     * the bounds pass blanks the whole graph — so the guard here is what
     * keeps one bad datum from erasing the map.
     */
    expect(clamp(Number.NaN, 0, 10)).toBe(5);
    expect(clamp(Number.POSITIVE_INFINITY, 0, 10)).toBe(5);
    expect(clamp(Number.NEGATIVE_INFINITY, 0, 10)).toBe(5);
    expect(clamp(Number.NaN, -8, 8)).toBe(0);
    expect(Number.isNaN(clamp(Number.NaN, 0.25, 4))).toBe(false);
    expect(clamp(Number.NaN, 0.25, 4)).toBeCloseTo(2.125, 6);
  });

  test("a degenerate range pins every finite value to the single point", () => {
    expect(clamp(-100, 3, 3)).toBe(3);
    expect(clamp(3, 3, 3)).toBe(3);
    expect(clamp(100, 3, 3)).toBe(3);
    expect(clamp(Number.NaN, 3, 3)).toBe(3);
  });

  test("an inverted range is not silently corrected — min wins below, max wins above", () => {
    /*
     * min > max is a caller bug (a zoom range wired backwards). The
     * function is deliberately branch-ordered rather than defensive, so
     * this pins what it actually does: the min test runs first.
     */
    expect(clamp(5, 10, 0)).toBe(10);
    expect(clamp(15, 10, 0)).toBe(0);
    expect(clamp(10, 10, 0)).toBe(0);
    /* Non-finite input still takes the midpoint of the two bounds. */
    expect(clamp(Number.NaN, 10, 0)).toBe(5);
  });
});

/* ------------------------------------------------------------------ */
/* compareNodeIds                                                      */
/* ------------------------------------------------------------------ */

describe("compareNodeIds", () => {
  const ids: Array<string> = [
    "",
    "A",
    "Z",
    "a",
    "aa",
    "ab",
    "core",
    "core-1",
    "endpoint:00:1b:44",
    "sw-a",
    "sw-b",
    "unmanaged:AP Lobby",
    "unmanaged:ap-1",
    "😀",
  ];

  test("returns zero exactly when the ids are equal", () => {
    for (const left of ids) {
      expect(compareNodeIds(left, left)).toBe(0);
      for (const right of ids) {
        if (left === right) {
          continue;
        }
        expect(compareNodeIds(left, right)).not.toBe(0);
      }
    }
  });

  test("is antisymmetric — reversing the arguments negates the result", () => {
    for (const left of ids) {
      for (const right of ids) {
        /*
         * Summed rather than negated: -0 and 0 are different values to
         * Object.is, so `toBe(-compare(b, a))` fails on every equal pair.
         */
        expect(compareNodeIds(left, right) + compareNodeIds(right, left)).toBe(
          0,
        );
        expect(compareNodeIds(left, right) < 0).toBe(
          compareNodeIds(right, left) > 0,
        );
      }
    }
  });

  test("is transitive over every triple", () => {
    for (const a of ids) {
      for (const b of ids) {
        if (compareNodeIds(a, b) >= 0) {
          continue;
        }
        for (const c of ids) {
          if (compareNodeIds(b, c) < 0) {
            expect(compareNodeIds(a, c)).toBeLessThan(0);
          }
        }
      }
    }
  });

  test("only ever returns -1, 0 or 1", () => {
    for (const left of ids) {
      for (const right of ids) {
        expect([-1, 0, 1]).toContain(compareNodeIds(left, right));
      }
    }
  });

  test("a prefix sorts before the string that extends it", () => {
    expect(compareNodeIds("sw", "sw-a")).toBe(-1);
    expect(compareNodeIds("", "a")).toBe(-1);
  });
});

/* ------------------------------------------------------------------ */
/* canonicalNodeOrder                                                  */
/* ------------------------------------------------------------------ */

describe("canonicalNodeOrder", () => {
  test("returns every id exactly once, strictly ascending", () => {
    const order: Array<string> = canonicalNodeOrder(SAMPLE_GRAPH.nodes);
    expect(order).toEqual([
      "core",
      "host-1",
      "host-2",
      "island-a",
      "island-b",
      "lone",
      "sw-a",
      "sw-b",
    ]);
    expect(isSorted(order)).toBe(true);
  });

  test("duplicate rows for the same device collapse to one id", () => {
    const order: Array<string> = canonicalNodeOrder([
      makeNode("sw-b"),
      makeNode("sw-a"),
      makeNode("sw-b"),
      makeNode("sw-a"),
      makeNode("sw-b"),
    ]);
    expect(order).toEqual(["sw-a", "sw-b"]);
  });

  test("nodes with an empty, absent or non-string id are ignored", () => {
    const order: Array<string> = canonicalNodeOrder([
      makeNode("sw-a"),
      makeNode(""),
      makeRawNode({ name: "no id", isManaged: true, status: "up" }),
      makeRawNode({
        id: 7 as unknown as string,
        name: "numeric",
        isManaged: true,
      }),
      null as unknown as NetworkTopologyNode,
      undefined as unknown as NetworkTopologyNode,
      makeNode("sw-b"),
    ]);
    expect(order).toEqual(["sw-a", "sw-b"]);
  });

  test("an empty or missing node array yields an empty order", () => {
    expect(canonicalNodeOrder([])).toEqual([]);
    expect(
      canonicalNodeOrder(null as unknown as Array<NetworkTopologyNode>),
    ).toEqual([]);
  });

  test("a single node yields a single id", () => {
    expect(canonicalNodeOrder([makeNode("only")])).toEqual(["only"]);
  });

  test("the order is a function of the id set, not of the array order", () => {
    const forward: Array<string> = canonicalNodeOrder(SAMPLE_GRAPH.nodes);
    for (let seed: number = 1; seed <= 12; seed++) {
      expect(canonicalNodeOrder(shuffle(SAMPLE_GRAPH.nodes, seed))).toEqual(
        forward,
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* buildTopologyAdjacency                                              */
/* ------------------------------------------------------------------ */

describe("buildTopologyAdjacency", () => {
  const adjacency: TopologyAdjacency = buildTopologyAdjacency(
    SAMPLE_GRAPH.nodes,
    SAMPLE_GRAPH.edges,
  );

  test("neighbourhood is symmetric — if a lists b then b lists a", () => {
    for (const [id, neighbors] of adjacency.neighborsById) {
      for (const neighbor of neighbors) {
        expect(adjacency.neighborsById.get(neighbor)).toContain(id);
      }
    }
  });

  test("every known node gets an entry, even with no links at all", () => {
    expect(Array.from(adjacency.neighborsById.keys())).toEqual(
      canonicalNodeOrder(SAMPLE_GRAPH.nodes),
    );
    expect(adjacency.neighborsById.get("lone")).toEqual([]);
    expect(adjacency.degreeById.get("lone")).toBe(0);
  });

  test("every neighbour list is sorted and duplicate free", () => {
    for (const [, neighbors] of adjacency.neighborsById) {
      expect(isSorted(neighbors)).toBe(true);
    }
    expect(adjacency.neighborsById.get("core")).toEqual(["sw-a", "sw-b"]);
  });

  test("degree equals the neighbour count for every node", () => {
    for (const [id, neighbors] of adjacency.neighborsById) {
      expect(adjacency.degreeById.get(id)).toBe(neighbors.length);
    }
    expect(adjacency.degreeById.get("core")).toBe(2);
    expect(adjacency.degreeById.get("host-1")).toBe(1);
  });

  test("uniqueEdges is sorted and every pair is oriented a < b", () => {
    for (const edge of adjacency.uniqueEdges) {
      expect(compareNodeIds(edge.a, edge.b)).toBe(-1);
    }
    const keys: Array<string> = adjacency.uniqueEdges.map(
      (edge: TopologyEdgePair): string => {
        return `${edge.a}|${edge.b}`;
      },
    );
    expect(isSorted(keys)).toBe(true);
    expect(adjacency.uniqueEdges).toEqual([
      { a: "core", b: "sw-a" },
      { a: "core", b: "sw-b" },
      { a: "host-1", b: "sw-a" },
      { a: "host-2", b: "sw-b" },
      { a: "island-a", b: "island-b" },
    ]);
  });

  test("a self-loop is dropped rather than inflating the node's degree", () => {
    const looped: TopologyAdjacency = buildTopologyAdjacency(
      [makeNode("sw-a"), makeNode("sw-b")],
      [makeEdge("sw-a", "sw-a"), makeEdge("sw-a", "sw-b")],
    );
    expect(looped.uniqueEdges).toEqual([{ a: "sw-a", b: "sw-b" }]);
    expect(looped.neighborsById.get("sw-a")).toEqual(["sw-b"]);
    expect(looped.degreeById.get("sw-a")).toBe(1);
  });

  test("the same link reported twice, or from both ends, collapses to one edge", () => {
    /*
     * LLDP and CDP both report the uplink, and both devices report it, so
     * the raw payload legitimately carries the pair up to four times.
     */
    const doubled: TopologyAdjacency = buildTopologyAdjacency(
      [makeNode("sw-a"), makeNode("sw-b")],
      [
        makeEdge("sw-a", "sw-b"),
        makeEdge("sw-b", "sw-a"),
        makeEdge("sw-a", "sw-b"),
        makeEdge("sw-b", "sw-a"),
      ],
    );
    expect(doubled.uniqueEdges).toEqual([{ a: "sw-a", b: "sw-b" }]);
    expect(doubled.degreeById.get("sw-a")).toBe(1);
    expect(doubled.degreeById.get("sw-b")).toBe(1);
  });

  test("an edge naming a node outside the view is dropped without a phantom entry", () => {
    const filtered: TopologyAdjacency = buildTopologyAdjacency(
      [makeNode("sw-a")],
      [
        makeEdge("sw-a", "endpoint:aged-out"),
        makeEdge("endpoint:aged-out", "sw-a"),
        makeEdge("gone-1", "gone-2"),
      ],
    );
    expect(filtered.uniqueEdges).toEqual([]);
    expect(filtered.neighborsById.has("endpoint:aged-out")).toBe(false);
    expect(filtered.neighborsById.get("sw-a")).toEqual([]);
    expect(filtered.degreeById.get("sw-a")).toBe(0);
  });

  test("null edges and edges missing an endpoint id are skipped, not thrown on", () => {
    const hostile: TopologyAdjacency = buildTopologyAdjacency(
      [makeNode("sw-a"), makeNode("sw-b")],
      [
        null as unknown as NetworkTopologyEdge,
        undefined as unknown as NetworkTopologyEdge,
        makeRawEdge({ toNodeId: "sw-b" }),
        makeRawEdge({ fromNodeId: "sw-a" }),
        makeRawEdge({}),
        makeEdge("sw-a", "sw-b"),
      ],
    );
    expect(hostile.uniqueEdges).toEqual([{ a: "sw-a", b: "sw-b" }]);
    expect(hostile.degreeById.get("sw-a")).toBe(1);
  });

  test("an empty graph and a missing edge array both yield an empty adjacency", () => {
    const empty: TopologyAdjacency = buildTopologyAdjacency([], []);
    expect(empty.neighborsById.size).toBe(0);
    expect(empty.degreeById.size).toBe(0);
    expect(empty.uniqueEdges).toEqual([]);

    const noEdges: TopologyAdjacency = buildTopologyAdjacency(
      [makeNode("sw-a")],
      null as unknown as Array<NetworkTopologyEdge>,
    );
    expect(noEdges.uniqueEdges).toEqual([]);
    expect(noEdges.degreeById.get("sw-a")).toBe(0);
  });

  test("ids containing a space do not collide in the dedup key", () => {
    /*
     * Regression: the pair key used to join the two ids with a space, so
     * ("a b", "c") and ("a", "b c") produced the same key and the second
     * — a real link — was silently dropped. Unmanaged ids are built from
     * free-text CDP/LLDP sysNames, so embedded spaces are routine.
     */
    const spacey: TopologyAdjacency = buildTopologyAdjacency(
      [makeNode("a b"), makeNode("c"), makeNode("a"), makeNode("b c")],
      [makeEdge("a b", "c"), makeEdge("a", "b c")],
    );
    expect(spacey.uniqueEdges).toEqual([
      { a: "a", b: "b c" },
      { a: "a b", b: "c" },
    ]);
    expect(spacey.degreeById.get("a b")).toBe(1);
    expect(spacey.degreeById.get("b c")).toBe(1);
  });

  test("adjacency is a function of the graph, not of the row order", () => {
    const forward: AdjacencySnapshot = snapshotAdjacency(adjacency);
    for (let seed: number = 1; seed <= 12; seed++) {
      const reordered: TopologyAdjacency = buildTopologyAdjacency(
        shuffle(SAMPLE_GRAPH.nodes, seed),
        shuffle(SAMPLE_GRAPH.edges, seed * 31),
      );
      expect(snapshotAdjacency(reordered)).toEqual(forward);
    }
  });
});

/* ------------------------------------------------------------------ */
/* findTopologyComponents                                              */
/* ------------------------------------------------------------------ */

describe("findTopologyComponents", () => {
  const orderedIds: Array<string> = canonicalNodeOrder(SAMPLE_GRAPH.nodes);
  const adjacency: TopologyAdjacency = buildTopologyAdjacency(
    SAMPLE_GRAPH.nodes,
    SAMPLE_GRAPH.edges,
  );
  const components: Array<TopologyComponent> = findTopologyComponents(
    adjacency,
    orderedIds,
  );

  test("the components partition the id set exactly — no node lost, none shared", () => {
    const seen: Array<string> = [];
    for (const component of components) {
      seen.push(...component.nodeIds);
    }
    expect(seen.length).toBe(orderedIds.length);
    expect([...seen].sort(compareNodeIds)).toEqual(orderedIds);
    expect(new Set<string>(seen).size).toBe(orderedIds.length);
  });

  test("both ends of every edge land in the same component", () => {
    const componentOf: Map<string, number> = new Map<string, number>();
    components.forEach((component: TopologyComponent, index: number): void => {
      for (const id of component.nodeIds) {
        componentOf.set(id, index);
      }
    });
    for (const edge of adjacency.uniqueEdges) {
      expect(componentOf.get(edge.a)).toBe(componentOf.get(edge.b));
    }
  });

  test("a component owns exactly its own edges", () => {
    const claimed: Array<TopologyEdgePair> = [];
    for (const component of components) {
      const members: Set<string> = new Set<string>(component.nodeIds);
      for (const edge of component.edges) {
        expect(members.has(edge.a)).toBe(true);
        expect(members.has(edge.b)).toBe(true);
      }
      claimed.push(...component.edges);
    }
    expect(claimed.length).toBe(adjacency.uniqueEdges.length);
  });

  test("an edgeless graph becomes n singleton components", () => {
    const ids: Array<string> = ["a", "b", "c", "d"];
    const bare: TopologyAdjacency = buildTopologyAdjacency(
      buildGraph(ids, []).nodes,
      [],
    );
    const singletons: Array<TopologyComponent> = findTopologyComponents(
      bare,
      ids,
    );
    expect(singletons.length).toBe(4);
    for (const component of singletons) {
      expect(component.nodeIds.length).toBe(1);
      expect(component.rootId).toBe(component.nodeIds[0]!);
      expect(component.edges).toEqual([]);
      expect(component.depthById.get(component.rootId)).toBe(0);
    }
    /* All the same size, so the tie-break by rootId decides the order. */
    expect(
      singletons.map((component: TopologyComponent): string => {
        return component.rootId;
      }),
    ).toEqual(["a", "b", "c", "d"]);
  });

  test("an empty graph yields no components", () => {
    expect(findTopologyComponents(buildTopologyAdjacency([], []), [])).toEqual(
      [],
    );
  });

  test("rootId is a maximum-degree member of its component", () => {
    for (const component of components) {
      const rootDegree: number = adjacency.degreeById.get(component.rootId)!;
      for (const id of component.nodeIds) {
        expect(adjacency.degreeById.get(id)!).toBeLessThanOrEqual(rootDegree);
      }
    }
  });

  test("the busiest node roots the component even when it sorts last", () => {
    const star: TopologyGraph = buildGraph(
      ["a-leaf", "b-leaf", "c-leaf", "z-hub"],
      [
        ["z-hub", "a-leaf"],
        ["z-hub", "b-leaf"],
        ["z-hub", "c-leaf"],
      ],
    );
    const starAdjacency: TopologyAdjacency = buildTopologyAdjacency(
      star.nodes,
      star.edges,
    );
    const found: Array<TopologyComponent> = findTopologyComponents(
      starAdjacency,
      canonicalNodeOrder(star.nodes),
    );
    expect(found.length).toBe(1);
    expect(found[0]!.rootId).toBe("z-hub");
    expect(found[0]!.nodeIds).toEqual(["z-hub", "a-leaf", "b-leaf", "c-leaf"]);
    expect(Array.from(found[0]!.depthById.values())).toEqual([0, 1, 1, 1]);
  });

  test("a degree tie inside a component is broken by the smallest id", () => {
    /* Four-cycle: every member has degree 2, so the id decides. */
    const ring: TopologyGraph = buildGraph(
      ["n-a", "n-b", "n-c", "n-d"],
      [
        ["n-a", "n-b"],
        ["n-b", "n-c"],
        ["n-c", "n-d"],
        ["n-d", "n-a"],
      ],
    );
    const found: Array<TopologyComponent> = findTopologyComponents(
      buildTopologyAdjacency(ring.nodes, ring.edges),
      canonicalNodeOrder(ring.nodes),
    );
    expect(found[0]!.rootId).toBe("n-a");
    expect(Array.from(found[0]!.depthById.entries())).toEqual([
      ["n-a", 0],
      ["n-b", 1],
      ["n-d", 1],
      ["n-c", 2],
    ]);
  });

  test("depthById is a true BFS distance on a hand-checked path", () => {
    const ids: Array<string> = ["p-0", "p-1", "p-2", "p-3", "p-4", "p-5"];
    const path: TopologyGraph = buildGraph(ids, [
      ["p-0", "p-1"],
      ["p-1", "p-2"],
      ["p-2", "p-3"],
      ["p-3", "p-4"],
      ["p-4", "p-5"],
    ]);
    const found: Array<TopologyComponent> = findTopologyComponents(
      buildTopologyAdjacency(path.nodes, path.edges),
      canonicalNodeOrder(path.nodes),
    );
    const component: TopologyComponent = found[0]!;
    /* p-1..p-4 all have degree 2; p-1 wins the tie. */
    expect(component.rootId).toBe("p-1");
    expect(component.depthById.get("p-1")).toBe(0);
    expect(component.depthById.get("p-0")).toBe(1);
    expect(component.depthById.get("p-2")).toBe(1);
    expect(component.depthById.get("p-3")).toBe(2);
    expect(component.depthById.get("p-4")).toBe(3);
    expect(component.depthById.get("p-5")).toBe(4);
    /* nodeIds is BFS order, so depth is non-decreasing along it. */
    expect(component.nodeIds).toEqual([
      "p-1",
      "p-0",
      "p-2",
      "p-3",
      "p-4",
      "p-5",
    ]);
  });

  test("depth 0 belongs to the root alone, and every member has a depth", () => {
    for (const component of components) {
      expect(component.depthById.size).toBe(component.nodeIds.length);
      expect(component.depthById.get(component.rootId)).toBe(0);
      for (const id of component.nodeIds) {
        const depth: number | undefined = component.depthById.get(id);
        expect(depth).toBeDefined();
        expect(Number.isInteger(depth!)).toBe(true);
        expect(depth!).toBeGreaterThanOrEqual(0);
        if (id !== component.rootId) {
          expect(depth!).toBeGreaterThan(0);
        }
      }
    }
  });

  test("no edge spans more than one BFS level", () => {
    const random: TopologyGraph = makeRandomGraph(28, 34, 20240117);
    const randomAdjacency: TopologyAdjacency = buildTopologyAdjacency(
      random.nodes,
      random.edges,
    );
    const found: Array<TopologyComponent> = findTopologyComponents(
      randomAdjacency,
      canonicalNodeOrder(random.nodes),
    );
    /* The fixture must actually be interesting, or this proves nothing. */
    expect(found.length).toBeGreaterThan(1);
    expect(found[0]!.nodeIds.length).toBeGreaterThan(3);

    for (const component of found) {
      for (const edge of component.edges) {
        const depthA: number = component.depthById.get(edge.a)!;
        const depthB: number = component.depthById.get(edge.b)!;
        expect(Math.abs(depthA - depthB)).toBeLessThanOrEqual(1);
      }
      /*
       * The defining property of a BFS distance: every non-root member has
       * at least one neighbour exactly one level up.
       */
      for (const id of component.nodeIds) {
        const depth: number = component.depthById.get(id)!;
        if (depth === 0) {
          continue;
        }
        const climbs: Array<string> = (
          randomAdjacency.neighborsById.get(id) || []
        ).filter((neighbor: string): boolean => {
          return component.depthById.get(neighbor) === depth - 1;
        });
        expect(climbs.length).toBeGreaterThan(0);
      }
    }
  });

  test("components come back largest first, ties broken by rootId", () => {
    for (let i: number = 1; i < components.length; i++) {
      const previous: TopologyComponent = components[i - 1]!;
      const current: TopologyComponent = components[i]!;
      expect(previous.nodeIds.length).toBeGreaterThanOrEqual(
        current.nodeIds.length,
      );
      if (previous.nodeIds.length === current.nodeIds.length) {
        expect(compareNodeIds(previous.rootId, current.rootId)).toBe(-1);
      }
    }
    expect(
      components.map((component: TopologyComponent): number => {
        return component.nodeIds.length;
      }),
    ).toEqual([5, 2, 1]);
    expect(
      components.map((component: TopologyComponent): string => {
        return component.rootId;
      }),
    ).toEqual(["core", "island-a", "lone"]);
  });

  test("equal-sized components are ordered by rootId, not by discovery order", () => {
    const twins: TopologyGraph = buildGraph(
      ["z-1", "z-2", "a-1", "a-2"],
      [
        ["z-1", "z-2"],
        ["a-1", "a-2"],
      ],
    );
    const found: Array<TopologyComponent> = findTopologyComponents(
      buildTopologyAdjacency(twins.nodes, twins.edges),
      canonicalNodeOrder(twins.nodes),
    );
    expect(
      found.map((component: TopologyComponent): string => {
        return component.rootId;
      }),
    ).toEqual(["a-1", "z-1"]);
  });

  test("an id with no adjacency entry becomes its own singleton", () => {
    /* Callers can hand in a wider id list than the adjacency was built from. */
    const found: Array<TopologyComponent> = findTopologyComponents(
      buildTopologyAdjacency([makeNode("sw-a")], []),
      ["not-in-adjacency", "sw-a"],
    );
    expect(found.length).toBe(2);
    expect(
      found.map((component: TopologyComponent): string => {
        return component.rootId;
      }),
    ).toEqual(["not-in-adjacency", "sw-a"]);
    expect(found[0]!.depthById.get("not-in-adjacency")).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* bfsChildrenOf                                                       */
/* ------------------------------------------------------------------ */

describe("bfsChildrenOf", () => {
  const random: TopologyGraph = makeRandomGraph(30, 40, 987654321);
  const adjacency: TopologyAdjacency = buildTopologyAdjacency(
    random.nodes,
    random.edges,
  );
  const components: Array<TopologyComponent> = findTopologyComponents(
    adjacency,
    canonicalNodeOrder(random.nodes),
  );

  test("a key exists for every component member and for nobody else", () => {
    for (const component of components) {
      const children: Map<string, Array<string>> = bfsChildrenOf(
        component,
        adjacency,
      );
      expect(Array.from(children.keys())).toEqual(component.nodeIds);
    }
  });

  test("every non-root has exactly one parent and the root has none", () => {
    for (const component of components) {
      const children: Map<string, Array<string>> = bfsChildrenOf(
        component,
        adjacency,
      );
      const parentCount: Map<string, number> = new Map<string, number>();
      for (const [, kids] of children) {
        for (const kid of kids) {
          parentCount.set(kid, (parentCount.get(kid) || 0) + 1);
        }
      }
      for (const id of component.nodeIds) {
        if (id === component.rootId) {
          expect(parentCount.get(id)).toBeUndefined();
          continue;
        }
        expect(parentCount.get(id)).toBe(1);
      }
    }
  });

  test("the root plus every child covers the component exactly once", () => {
    for (const component of components) {
      const children: Map<string, Array<string>> = bfsChildrenOf(
        component,
        adjacency,
      );
      const covered: Array<string> = [component.rootId];
      for (const [, kids] of children) {
        covered.push(...kids);
      }
      expect(new Set<string>(covered).size).toBe(covered.length);
      expect([...covered].sort(compareNodeIds)).toEqual(
        [...component.nodeIds].sort(compareNodeIds),
      );
    }
  });

  test("walking parents always terminates at the root — the tree has no cycles", () => {
    for (const component of components) {
      const children: Map<string, Array<string>> = bfsChildrenOf(
        component,
        adjacency,
      );
      const parentOf: Map<string, string> = new Map<string, string>();
      for (const [parent, kids] of children) {
        for (const kid of kids) {
          parentOf.set(kid, parent);
        }
      }
      for (const id of component.nodeIds) {
        let cursor: string = id;
        let steps: number = 0;
        while (cursor !== component.rootId) {
          const parent: string | undefined = parentOf.get(cursor);
          expect(parent).toBeDefined();
          cursor = parent!;
          steps++;
          expect(steps).toBeLessThanOrEqual(component.nodeIds.length);
        }
        /* The number of hops back to the root is exactly the BFS depth. */
        expect(steps).toBe(component.depthById.get(id)!);
      }
    }
  });

  test("children are sorted and sit exactly one level below their parent", () => {
    for (const component of components) {
      const children: Map<string, Array<string>> = bfsChildrenOf(
        component,
        adjacency,
      );
      for (const [parent, kids] of children) {
        expect(isSorted(kids)).toBe(true);
        const parentDepth: number = component.depthById.get(parent)!;
        for (const kid of kids) {
          expect(component.depthById.get(kid)).toBe(parentDepth + 1);
          expect(adjacency.neighborsById.get(parent)).toContain(kid);
        }
      }
    }
  });

  test("a cyclic component still yields a tree, parents chosen by smallest id", () => {
    /*
     * In a diamond, "d-leaf" is reachable from both middle nodes at the
     * same level; the canonically first one must win, or the wedge the
     * radial layout hands each subtree would flap between polls.
     */
    const diamond: TopologyGraph = buildGraph(
      ["d-hub", "d-mid-a", "d-mid-b", "d-leaf"],
      [
        ["d-hub", "d-mid-a"],
        ["d-hub", "d-mid-b"],
        ["d-mid-a", "d-leaf"],
        ["d-mid-b", "d-leaf"],
      ],
    );
    const diamondAdjacency: TopologyAdjacency = buildTopologyAdjacency(
      diamond.nodes,
      diamond.edges,
    );
    const component: TopologyComponent = findTopologyComponents(
      diamondAdjacency,
      canonicalNodeOrder(diamond.nodes),
    )[0]!;
    expect(component.rootId).toBe("d-hub");
    const children: Map<string, Array<string>> = bfsChildrenOf(
      component,
      diamondAdjacency,
    );
    expect(children.get("d-hub")).toEqual(["d-mid-a", "d-mid-b"]);
    expect(children.get("d-mid-a")).toEqual(["d-leaf"]);
    expect(children.get("d-mid-b")).toEqual([]);
    expect(children.get("d-leaf")).toEqual([]);
  });

  test("a singleton component maps its root to no children", () => {
    const lone: TopologyAdjacency = buildTopologyAdjacency(
      [makeNode("lone")],
      [],
    );
    const component: TopologyComponent = findTopologyComponents(lone, [
      "lone",
    ])[0]!;
    const children: Map<string, Array<string>> = bfsChildrenOf(component, lone);
    expect(children.size).toBe(1);
    expect(children.get("lone")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The headline contract: order independence                           */
/* ------------------------------------------------------------------ */

describe("permutation invariance — the reason this module exists", () => {
  /*
   * The topology endpoint returns rows in whatever order the query
   * produced, and that order is NOT stable across the 60-second poll. The
   * old layout keyed off array index, so identical data reshuffled the
   * whole map every minute. Every structure this module builds must be a
   * function of the graph alone.
   */
  const random: TopologyGraph = makeRandomGraph(26, 33, 424242);

  test("the sample fixture is a genuinely non-trivial graph", () => {
    const baseline: TopologySnapshot = snapshotGraph(random);
    expect(baseline.orderedIds.length).toBe(26);
    expect(baseline.components.length).toBeGreaterThan(1);
    expect(baseline.adjacency.uniqueEdges.length).toBeGreaterThan(15);
    /* At least one component contains a cycle, so parent choice matters. */
    const cyclic: Array<ComponentSnapshot> = baseline.components.filter(
      (component: ComponentSnapshot): boolean => {
        return component.edges.length >= component.nodeIds.length;
      },
    );
    expect(cyclic.length).toBeGreaterThan(0);
  });

  test("permuting the node rows changes nothing about the whole structure", () => {
    const baseline: TopologySnapshot = snapshotGraph(random);
    for (let seed: number = 1; seed <= 25; seed++) {
      expect(
        snapshotGraph({
          nodes: shuffle(random.nodes, seed),
          edges: random.edges,
        }),
      ).toEqual(baseline);
    }
  });

  test("permuting the edge rows changes nothing about the whole structure", () => {
    const baseline: TopologySnapshot = snapshotGraph(random);
    for (let seed: number = 1; seed <= 25; seed++) {
      expect(
        snapshotGraph({
          nodes: random.nodes,
          edges: shuffle(random.edges, seed),
        }),
      ).toEqual(baseline);
    }
  });

  test("permuting both, and flipping every edge's direction, changes nothing", () => {
    const baseline: TopologySnapshot = snapshotGraph(random);
    for (let seed: number = 1; seed <= 25; seed++) {
      const flipped: Array<NetworkTopologyEdge> = shuffle(
        random.edges,
        seed * 17,
      ).map((edge: NetworkTopologyEdge): NetworkTopologyEdge => {
        return makeEdge(edge.toNodeId, edge.fromNodeId);
      });
      expect(
        snapshotGraph({
          nodes: shuffle(random.nodes, seed),
          edges: flipped,
        }),
      ).toEqual(baseline);
    }
  });

  test("duplicating and reversing rows changes nothing", () => {
    /*
     * A payload that reports every link from both ends and lists some
     * devices twice must still produce the identical structure.
     */
    const baseline: TopologySnapshot = snapshotGraph(random);
    const doubled: TopologyGraph = {
      nodes: [...random.nodes, ...[...random.nodes].reverse()],
      edges: [
        ...random.edges,
        ...random.edges.map(
          (edge: NetworkTopologyEdge): NetworkTopologyEdge => {
            return makeEdge(edge.toNodeId, edge.fromNodeId);
          },
        ),
      ].reverse(),
    };
    expect(snapshotGraph(doubled)).toEqual(baseline);
  });

  test("the hand-built sample survives permutation too, down to map key order", () => {
    const baseline: TopologySnapshot = snapshotGraph(SAMPLE_GRAPH);
    for (let seed: number = 1; seed <= 20; seed++) {
      const permuted: TopologySnapshot = snapshotGraph({
        nodes: shuffle(SAMPLE_GRAPH.nodes, seed),
        edges: shuffle(SAMPLE_GRAPH.edges, seed * 13),
      });
      expect(permuted).toEqual(baseline);
      /*
       * toEqual on a Map is order-insensitive in jest, so the snapshots
       * above compare Array.from(...) instead — this pins the key order of
       * every map the module hands back.
       */
      expect(
        permuted.adjacency.neighbors.map(
          (entry: [string, Array<string>]): string => {
            return entry[0];
          },
        ),
      ).toEqual(baseline.orderedIds);
    }
  });
});
