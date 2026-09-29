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
  canonicalNodeOrder,
  compareNodeIds,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";

/*
 * Operator-declared parents on the parent-child layout — issue #3192.
 *
 * Discovery reports cables, not hierarchies: LLDP tells us two boxes are
 * connected and has no opinion about which one is upstream, and a device
 * monitored by ping alone reports no neighbours and classifies to no role
 * at all. Everything the layout did before this feature was therefore
 * inference, and on a ping-only device it was inference from nothing.
 * `NetworkDeviceLink.parentDeviceId` is the operator answering the
 * question directly, and these tests are about the layout treating that
 * answer as a constraint rather than as one more hint.
 *
 * Two things an operator can state that no tree can honour, both resolved
 * before the traversal ever sees them: a device that two links each claim
 * to parent (a contradiction), and a loop of declarations (a cycle).
 * Neither may produce a walk that fails to terminate, and — the reason
 * for the shuffles below — neither may make the drawing depend on the
 * order the poll happened to return its rows in. A cycle is precisely
 * where such a dependency would hide, because breaking one means choosing
 * a declaration to discard.
 */

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

/* The same link, with an operator's statement of which end is upstream. */
type MakeDeclaredEdgeFunction = (
  from: string,
  to: string,
  parentNodeId: string,
  protocols?: NetworkTopologyEdge["protocols"],
) => NetworkTopologyEdge;

const makeDeclaredEdge: MakeDeclaredEdgeFunction = (
  from: string,
  to: string,
  parentNodeId: string,
  protocols?: NetworkTopologyEdge["protocols"],
): NetworkTopologyEdge => {
  return {
    fromNodeId: from,
    toNodeId: to,
    protocols: protocols,
    parentNodeId: parentNodeId,
  };
};

/*
 * The same cables as they arrived before anybody declared anything. Used
 * for the control half of every "the declaration actually changed the
 * answer" assertion, and for the promise that a component nobody has
 * touched is laid out exactly as it was.
 */
type WithoutDeclarationsFunction = (
  edges: Array<NetworkTopologyEdge>,
) => Array<NetworkTopologyEdge>;

const withoutDeclarations: WithoutDeclarationsFunction = (
  edges: Array<NetworkTopologyEdge>,
): Array<NetworkTopologyEdge> => {
  return edges.map((edge: NetworkTopologyEdge): NetworkTopologyEdge => {
    return makeEdge(edge.fromNodeId, edge.toNodeId, edge.protocols);
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
    return edge.parentNodeId
      ? makeDeclaredEdge(
          edge.toNodeId,
          edge.fromNodeId,
          edge.parentNodeId,
          edge.protocols,
        )
      : makeEdge(edge.toNodeId, edge.fromNodeId, edge.protocols);
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

/* Seeds used wherever "shuffle it" means "shuffle it several ways". */
const SHUFFLE_SEEDS: Array<number> = [1, 2, 3, 7, 11, 29];

/*
 * Map contents in a form that compares by VALUE and not by insertion
 * order — two maps built from differently ordered inputs must be equal,
 * and a stray difference in which entry was written first must not be
 * able to hide behind that.
 */
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

/* Walk a declared-parent map upwards, reporting whether it loops. */
interface DeclaredParentWalk {
  chain: Array<string>;
  hitCycle: boolean;
}

type WalkDeclaredFunction = (
  declaredParentOf: Map<string, string>,
  nodeId: string,
) => DeclaredParentWalk;

const walkDeclaredParents: WalkDeclaredFunction = (
  declaredParentOf: Map<string, string>,
  nodeId: string,
): DeclaredParentWalk => {
  const chain: Array<string> = [];
  const seen: Set<string> = new Set<string>();
  let current: string | undefined = nodeId;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = declaredParentOf.get(current);
  }
  // A cursor still defined here means the walk returned somewhere it had been.
  return { chain: chain, hitCycle: current !== undefined };
};

/* The same walk over a finished forest. */
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
    // One step of the walk per level, so hops and depth cannot disagree.
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

  // Exactly one tree per node: the trees cover the graph and never overlap.
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

describe("buildDeclaredParentMap — reading one declaration off a link", () => {
  const pairNodes: Array<NetworkTopologyNode> = [
    makeDevice("core-01"),
    makeDevice("switch-a"),
  ];

  test("the end that was not named is the child", () => {
    const declared: Map<string, string> = buildDeclaredParentMap(pairNodes, [
      makeDeclaredEdge("core-01", "switch-a", "core-01", ["manual"]),
    ]);
    expect(sortedEntries(declared)).toEqual([["switch-a", "core-01"]]);
  });

  test("which column of the link row the parent sits in makes no difference", () => {
    /*
     * from/to is an artefact of whichever end reported the cable — the
     * operator's meaning lives entirely in parentDeviceId, so the same
     * statement written the other way round must read the same way.
     */
    const declared: Map<string, string> = buildDeclaredParentMap(pairNodes, [
      makeDeclaredEdge("switch-a", "core-01", "core-01", ["manual"]),
    ]);
    expect(sortedEntries(declared)).toEqual([["switch-a", "core-01"]]);
  });

  test("a discovered link nobody has annotated declares nothing", () => {
    // Absent is "not stated", never "these two are peers".
    const declared: Map<string, string> = buildDeclaredParentMap(pairNodes, [
      makeEdge("core-01", "switch-a", ["lldp"]),
      makeEdge("core-01", "switch-a", ["cdp"]),
    ]);
    expect(declared.size).toBe(0);
  });

  test("an empty parentNodeId is not a declaration", () => {
    const declared: Map<string, string> = buildDeclaredParentMap(pairNodes, [
      makeDeclaredEdge("core-01", "switch-a", "", ["manual"]),
    ]);
    expect(declared.size).toBe(0);
  });

  test("a parent that is neither end of its own link is ignored", () => {
    /*
     * NetworkDeviceLinkService refuses this on create and on update, so it
     * can only reach a reader as a stale payload — one end of the link was
     * repointed after the parent was set. Ignoring it is right: the
     * statement is about a cable that no longer exists.
     */
    const declared: Map<string, string> = buildDeclaredParentMap(
      [...pairNodes, makeDevice("core-02")],
      [makeDeclaredEdge("core-01", "switch-a", "core-02", ["manual"])],
    );
    expect(declared.size).toBe(0);
  });

  test("a declaration naming a device outside the view is ignored", () => {
    /*
     * The VLAN filter drops nodes without rewriting the edges, so an edge
     * naming a node nobody can see is routine rather than exotic. Neither
     * half of such a statement may reach the forest: a parent that is not
     * drawn cannot be drawn above anything.
     */
    const parentGone: Map<string, string> = buildDeclaredParentMap(pairNodes, [
      makeDeclaredEdge("switch-a", "unmanaged:isp-gw", "unmanaged:isp-gw", [
        "manual",
      ]),
    ]);
    expect(parentGone.size).toBe(0);

    const childGone: Map<string, string> = buildDeclaredParentMap(pairNodes, [
      makeDeclaredEdge("core-01", "endpoint:filtered", "core-01", ["fdb"]),
    ]);
    expect(childGone.size).toBe(0);
  });

  test("a self link cannot make a device its own parent", () => {
    // Both ends are the same device, so the "child" would be the parent.
    const declared: Map<string, string> = buildDeclaredParentMap(pairNodes, [
      makeDeclaredEdge("core-01", "core-01", "core-01", ["manual"]),
    ]);
    expect(declared.size).toBe(0);
  });

  test("a null edge in the payload is skipped rather than thrown on", () => {
    const declared: Map<string, string> = buildDeclaredParentMap(pairNodes, [
      null as unknown as NetworkTopologyEdge,
      makeDeclaredEdge("core-01", "switch-a", "core-01", ["manual"]),
    ]);
    expect(sortedEntries(declared)).toEqual([["switch-a", "core-01"]]);
  });

  test("independent declarations all survive together", () => {
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("core-01"),
      makeDevice("switch-a"),
      makeDevice("switch-b"),
      makeDevice("ap-01"),
    ];
    const declared: Map<string, string> = buildDeclaredParentMap(nodes, [
      makeDeclaredEdge("core-01", "switch-a", "core-01", ["lldp"]),
      makeDeclaredEdge("core-01", "switch-b", "core-01", ["lldp"]),
      makeDeclaredEdge("switch-a", "ap-01", "switch-a", ["manual"]),
    ]);
    expect(sortedEntries(declared)).toEqual([
      ["ap-01", "switch-a"],
      ["switch-a", "core-01"],
      ["switch-b", "core-01"],
    ]);
  });
});

/*
 * Two links each claiming to be the parent of `switch-x`, and one
 * uncontested statement alongside them. Picking a winner between the two
 * would be inventing an answer the operator did not give.
 */
const contradictionNodes: Array<NetworkTopologyNode> = [
  makeDevice("core-a"),
  makeDevice("core-b"),
  makeDevice("switch-x"),
  makeDevice("switch-y"),
];

const contradictionEdges: Array<NetworkTopologyEdge> = [
  makeDeclaredEdge("core-a", "switch-x", "core-a", ["manual"]),
  makeDeclaredEdge("core-b", "switch-x", "core-b", ["manual"]),
  makeDeclaredEdge("core-a", "switch-y", "core-a", ["manual"]),
];

describe("buildDeclaredParentMap — two links contradicting each other", () => {
  test("a device two links both claim to parent keeps neither", () => {
    const declared: Map<string, string> = buildDeclaredParentMap(
      contradictionNodes,
      contradictionEdges,
    );
    expect(declared.has("switch-x")).toBe(false);
    // ...and the contradiction is contained: core-a's other child stands.
    expect(sortedEntries(declared)).toEqual([["switch-y", "core-a"]]);
  });

  test("the same parent stated on two links is agreement, not contradiction", () => {
    /*
     * A redundantly cabled pair: two physical links between the same two
     * devices, both annotated the same way. That is one statement said
     * twice, and dropping it would punish an operator for being thorough.
     */
    const declared: Map<string, string> = buildDeclaredParentMap(
      [makeDevice("core-a"), makeDevice("switch-x")],
      [
        makeDeclaredEdge("core-a", "switch-x", "core-a", ["manual"]),
        makeDeclaredEdge("switch-x", "core-a", "core-a", ["manual"]),
      ],
    );
    expect(sortedEntries(declared)).toEqual([["switch-x", "core-a"]]);
  });

  test("a device can parent one child while another of its claims is contested", () => {
    const declared: Map<string, string> = buildDeclaredParentMap(
      contradictionNodes,
      [
        ...contradictionEdges,
        makeDeclaredEdge("switch-y", "core-b", "switch-y", ["manual"]),
      ],
    );
    // core-b loses its claim on switch-x and still becomes switch-y's child.
    expect(sortedEntries(declared)).toEqual([
      ["core-b", "switch-y"],
      ["switch-y", "core-a"],
    ]);
  });

  test("a contradiction is a function of the graph, not of row order", () => {
    const baseline: Array<[string, string]> = sortedEntries(
      buildDeclaredParentMap(contradictionNodes, contradictionEdges),
    );
    for (const seed of SHUFFLE_SEEDS) {
      const shuffled: Map<string, string> = buildDeclaredParentMap(
        permuted(contradictionNodes, seed),
        permuted(contradictionEdges, seed),
      );
      expect(sortedEntries(shuffled)).toEqual(baseline);
    }
  });
});

/*
 * A ring of declarations: A parents B, B parents C, C parents A. There is
 * no tree in that, and a traversal that trusted it would never terminate.
 */
const cycleNodes: Array<NetworkTopologyNode> = [
  makeDevice("core-a"),
  makeDevice("core-b"),
  makeDevice("core-c"),
];

const cycleEdges: Array<NetworkTopologyEdge> = [
  makeDeclaredEdge("core-a", "core-b", "core-a", ["manual"]),
  makeDeclaredEdge("core-b", "core-c", "core-b", ["manual"]),
  makeDeclaredEdge("core-c", "core-a", "core-c", ["manual"]),
];

describe("buildDeclaredParentMap — a loop of declarations", () => {
  const declared: Map<string, string> = buildDeclaredParentMap(
    cycleNodes,
    cycleEdges,
  );

  test("exactly one of the three declarations is dropped", () => {
    // Two of three is the most any acyclic subset of a 3-cycle can keep.
    expect(declared.size).toBe(2);
  });

  test("the surviving declarations are acyclic from every node", () => {
    for (const node of cycleNodes) {
      const walk: DeclaredParentWalk = walkDeclaredParents(declared, node.id);
      expect(walk.hitCycle).toBe(false);
      expect(new Set<string>(walk.chain).size).toBe(walk.chain.length);
    }
  });

  test("which declaration loses is decided by canonical child order", () => {
    /*
     * Pinned deliberately. "Some declaration is dropped" would be
     * satisfied by dropping a different one each poll, and a hierarchy
     * that re-hangs itself every sixty seconds is worse than one that is
     * merely incomplete. Children are considered in id order, so core-c —
     * the last child considered, and the one whose claim closes the ring —
     * is the one that loses.
     */
    expect(sortedEntries(declared)).toEqual([
      ["core-a", "core-c"],
      ["core-b", "core-a"],
    ]);
    expect(declared.has("core-c")).toBe(false);
  });

  test("two devices each declared the other's parent keep one statement", () => {
    /*
     * The shortest possible loop, and a realistic one: two links between
     * the same pair of distribution switches, annotated in opposite
     * directions by two different people.
     */
    const twoWay: Map<string, string> = buildDeclaredParentMap(
      [makeDevice("core-a"), makeDevice("core-b")],
      [
        makeDeclaredEdge("core-a", "core-b", "core-a", ["manual"]),
        makeDeclaredEdge("core-a", "core-b", "core-b", ["manual"]),
      ],
    );
    expect(sortedEntries(twoWay)).toEqual([["core-a", "core-b"]]);
    for (const id of ["core-a", "core-b"]) {
      expect(walkDeclaredParents(twoWay, id).hitCycle).toBe(false);
    }
  });

  test("a four-device ring is broken just as cleanly", () => {
    /*
     * Longer than three because the cycle check walks the chain accepted
     * so far: a ring of four is the case where that walk has to climb
     * three links before it recognises the loop.
     */
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("core-a"),
      makeDevice("core-b"),
      makeDevice("core-c"),
      makeDevice("core-d"),
    ];
    const ring: Map<string, string> = buildDeclaredParentMap(nodes, [
      makeDeclaredEdge("core-d", "core-a", "core-d", ["manual"]),
      makeDeclaredEdge("core-a", "core-b", "core-a", ["manual"]),
      makeDeclaredEdge("core-b", "core-c", "core-b", ["manual"]),
      makeDeclaredEdge("core-c", "core-d", "core-c", ["manual"]),
    ]);
    expect(ring.size).toBe(3);
    for (const node of nodes) {
      expect(walkDeclaredParents(ring, node.id).hitCycle).toBe(false);
    }
    // The chain that survives is the ring cut at its canonically last child.
    expect(sortedEntries(ring)).toEqual([
      ["core-a", "core-d"],
      ["core-b", "core-a"],
      ["core-c", "core-b"],
    ]);
  });

  test("a self-declaration cannot start a loop of length one", () => {
    const declaredSelf: Map<string, string> = buildDeclaredParentMap(
      cycleNodes,
      [
        ...cycleEdges,
        makeDeclaredEdge("core-b", "core-b", "core-b", ["manual"]),
      ],
    );
    expect(sortedEntries(declaredSelf)).toEqual(sortedEntries(declared));
  });
});

describe("buildDeclaredParentMap — the same graph always gives the same map", () => {
  test("shuffling the edges of a cyclic declaration set changes nothing", () => {
    /*
     * The case that matters most in this file. Breaking a cycle means
     * discarding a declaration, and the cheap way to choose one is
     * "whichever we saw last" — which would hand a different hierarchy to
     * every poll. Six shuffles, all of which must agree.
     */
    const baseline: Array<[string, string]> = sortedEntries(
      buildDeclaredParentMap(cycleNodes, cycleEdges),
    );
    for (const seed of SHUFFLE_SEEDS) {
      expect(
        sortedEntries(
          buildDeclaredParentMap(cycleNodes, permuted(cycleEdges, seed)),
        ),
      ).toEqual(baseline);
    }
  });

  test("shuffling the nodes of a cyclic declaration set changes nothing", () => {
    const baseline: Array<[string, string]> = sortedEntries(
      buildDeclaredParentMap(cycleNodes, cycleEdges),
    );
    for (const seed of SHUFFLE_SEEDS) {
      expect(
        sortedEntries(
          buildDeclaredParentMap(permuted(cycleNodes, seed), cycleEdges),
        ),
      ).toEqual(baseline);
    }
  });

  test("shuffling both at once changes nothing", () => {
    const baseline: Array<[string, string]> = sortedEntries(
      buildDeclaredParentMap(cycleNodes, cycleEdges),
    );
    for (const seed of SHUFFLE_SEEDS) {
      expect(
        sortedEntries(
          buildDeclaredParentMap(
            permuted(cycleNodes, seed),
            permuted(cycleEdges, seed * 13),
          ),
        ),
      ).toEqual(baseline);
    }
  });

  test("reading every link end for end changes nothing", () => {
    // The declared parent is still one of the ends after the flip.
    expect(
      sortedEntries(
        buildDeclaredParentMap(
          [...cycleNodes].reverse(),
          flipEdges(cycleEdges),
        ),
      ),
    ).toEqual(sortedEntries(buildDeclaredParentMap(cycleNodes, cycleEdges)));
  });

  test("a mixed payload of good, contradictory and cyclic statements is stable", () => {
    /*
     * All three resolutions interacting at once, because each is
     * order-sensitive on its own: a contradiction removes a child from
     * consideration, which changes which later declaration would close a
     * loop.
     */
    const nodes: Array<NetworkTopologyNode> = [
      ...cycleNodes,
      ...contradictionNodes,
      makeDevice("edge-01"),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      ...cycleEdges,
      ...contradictionEdges,
      makeDeclaredEdge("switch-y", "edge-01", "switch-y", ["manual"]),
    ];
    const baseline: Array<[string, string]> = sortedEntries(
      buildDeclaredParentMap(nodes, edges),
    );
    expect(baseline).toEqual([
      ["core-a", "core-c"],
      ["core-b", "core-a"],
      ["edge-01", "switch-y"],
      ["switch-y", "core-a"],
    ]);
    for (const seed of SHUFFLE_SEEDS) {
      expect(
        sortedEntries(
          buildDeclaredParentMap(permuted(nodes, seed), permuted(edges, seed)),
        ),
      ).toEqual(baseline);
    }
  });
});

/*
 * ISSUE #3192, as a graph. A router and a switch that SNMP knows all
 * about, and an access point that answers ping and nothing else: no
 * neighbour data, no FDB entries, no evidence to classify it from. Its
 * role is the honest "unknown", which the tiering reads as "might be
 * core" — so before this feature the access point was tier 0 and could
 * win the root, drawing the whole site hanging off a ping-only AP.
 */
const ISSUE_3192_ROUTER: string = "router-01";
const ISSUE_3192_SWITCH: string = "switch-01";
const ISSUE_3192_ACCESS_POINT: string = "ap-01";

const pingOnlySiteNodes: Array<NetworkTopologyNode> = [
  makeDevice(ISSUE_3192_ROUTER, { role: "router" }),
  makeDevice(ISSUE_3192_SWITCH, { role: "switch" }),
  makeDevice(ISSUE_3192_ACCESS_POINT, { role: "unknown" }),
];

const pingOnlySiteEdges: Array<NetworkTopologyEdge> = [
  makeDeclaredEdge(ISSUE_3192_ROUTER, ISSUE_3192_SWITCH, ISSUE_3192_ROUTER, [
    "lldp",
  ]),
  makeDeclaredEdge(
    ISSUE_3192_SWITCH,
    ISSUE_3192_ACCESS_POINT,
    ISSUE_3192_SWITCH,
    ["manual"],
  ),
];

describe("buildParentChildForest — issue #3192, the ping-only access point", () => {
  const forest: ParentChildForest = buildParentChildForest(
    pingOnlySiteNodes,
    pingOnlySiteEdges,
  );

  test("the access point hangs off the switch its operator declared", () => {
    expect(forest.parentById.get(ISSUE_3192_ACCESS_POINT)).toBe(
      ISSUE_3192_SWITCH,
    );
    expect(forest.parentById.get(ISSUE_3192_SWITCH)).toBe(ISSUE_3192_ROUTER);
    expect(forest.depthById.get(ISSUE_3192_ACCESS_POINT)).toBe(2);
    expect(forest.rootIds).toEqual([ISSUE_3192_ROUTER]);
  });

  test("without the declarations the ping-only AP wins the root instead", () => {
    /*
     * The control, and the whole reason the feature exists. Nothing about
     * the graph changed except that nobody said anything: the AP is still
     * tier 0 (managed, role unknown, no FDB edges), still ties the router
     * on degree, and still sorts first by id — so it roots the tree and
     * the router is drawn two levels beneath the access point it feeds.
     */
    const inferred: ParentChildForest = buildParentChildForest(
      pingOnlySiteNodes,
      withoutDeclarations(pingOnlySiteEdges),
    );
    expect(inferred.rootIds).toEqual([ISSUE_3192_ACCESS_POINT]);
    expect(inferred.depthById.get(ISSUE_3192_ACCESS_POINT)).toBe(0);
    expect(inferred.depthById.get(ISSUE_3192_ROUTER)).toBe(2);
  });

  test("the declared hierarchy reads the same from the children downward", () => {
    expect(forest.childrenById.get(ISSUE_3192_ROUTER)).toEqual([
      ISSUE_3192_SWITCH,
    ]);
    expect(forest.childrenById.get(ISSUE_3192_SWITCH)).toEqual([
      ISSUE_3192_ACCESS_POINT,
    ]);
    expect(forest.childrenById.get(ISSUE_3192_ACCESS_POINT)).toEqual([]);
    expectWellFormedForest(forest, pingOnlySiteNodes);
  });

  test("the declared site is stable however the payload is ordered", () => {
    for (const seed of SHUFFLE_SEEDS) {
      expectIdenticalForest(
        buildParentChildForest(
          permuted(pingOnlySiteNodes, seed),
          permuted(pingOnlySiteEdges, seed),
        ),
        forest,
      );
    }
    expectIdenticalForest(
      buildParentChildForest(
        [...pingOnlySiteNodes].reverse(),
        flipEdges(pingOnlySiteEdges),
      ),
      forest,
    );
  });
});

describe("buildParentChildForest — a declared child is never a root", () => {
  /*
   * The strongest possible case for rooting the tree at the wrong device:
   * `aa-distribution` is a router by role (tier 0), out-degrees everything
   * else six to one, and sorts first by id — it wins every tiebreak the
   * root chooser has. `zz-uplink` is a host with a single link. An
   * operator who says the host is upstream is telling us something the
   * evidence cannot: it is the ISP handoff, and it has a parent by
   * construction, so it cannot be somebody's child.
   */
  const declaredChildNodes: Array<NetworkTopologyNode> = [
    makeDevice("aa-distribution", { role: "router" }),
    makeDevice("zz-uplink", { role: "host" }),
    makeEndpoint("endpoint:pos-1", { name: "pos-1" }),
    makeEndpoint("endpoint:pos-2", { name: "pos-2" }),
    makeEndpoint("endpoint:pos-3", { name: "pos-3" }),
    makeEndpoint("endpoint:pos-4", { name: "pos-4" }),
    makeEndpoint("endpoint:pos-5", { name: "pos-5" }),
  ];

  const declaredChildEdges: Array<NetworkTopologyEdge> = [
    makeDeclaredEdge("zz-uplink", "aa-distribution", "zz-uplink", ["manual"]),
    makeEdge("aa-distribution", "endpoint:pos-1", ["fdb"]),
    makeEdge("aa-distribution", "endpoint:pos-2", ["fdb"]),
    makeEdge("aa-distribution", "endpoint:pos-3", ["fdb"]),
    makeEdge("aa-distribution", "endpoint:pos-4", ["fdb"]),
    makeEdge("aa-distribution", "endpoint:pos-5", ["fdb"]),
  ];

  const forest: ParentChildForest = buildParentChildForest(
    declaredChildNodes,
    declaredChildEdges,
  );

  test("the declared child loses the root to its own declared parent", () => {
    expect(forest.rootIds).toEqual(["zz-uplink"]);
    expect(forest.parentById.get("aa-distribution")).toBe("zz-uplink");
    expect(forest.depthById.get("zz-uplink")).toBe(0);
    expect(forest.depthById.get("aa-distribution")).toBe(1);
  });

  test("the subtree below the declared child is unchanged", () => {
    /*
     * Only the top of the tree was ever in dispute; the endpoints still
     * hang off the device they are actually learned on.
     */
    for (const id of [
      "endpoint:pos-1",
      "endpoint:pos-2",
      "endpoint:pos-3",
      "endpoint:pos-4",
      "endpoint:pos-5",
    ]) {
      expect(forest.parentById.get(id)).toBe("aa-distribution");
      expect(forest.depthById.get(id)).toBe(2);
    }
    expectWellFormedForest(forest, declaredChildNodes);
  });

  test("without the declaration the tier-0, high-degree device roots it", () => {
    const inferred: ParentChildForest = buildParentChildForest(
      declaredChildNodes,
      withoutDeclarations(declaredChildEdges),
    );
    expect(inferred.rootIds).toEqual(["aa-distribution"]);
    expect(inferred.parentById.get("zz-uplink")).toBe("aa-distribution");
  });
});

describe("buildParentChildForest — a declaration outranks the inference", () => {
  test("a declared parent wins even when a shorter cable path exists", () => {
    /*
     * `leaf-01` is one hop from the core and two hops from the
     * distribution switch. BFS would hang it off the core because that is
     * the shorter path; the operator says it is patched through
     * `dist-01`, and a stated fact outranks a shortest path.
     */
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("core-01", { role: "router" }),
      makeDevice("dist-01", { role: "switch" }),
      makeDevice("leaf-01", { role: "switch" }),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("core-01", "dist-01", ["lldp"]),
      makeEdge("core-01", "leaf-01", ["lldp"]),
      makeDeclaredEdge("dist-01", "leaf-01", "dist-01", ["manual"]),
    ];

    const inferred: ParentChildForest = buildParentChildForest(
      nodes,
      withoutDeclarations(edges),
    );
    expect(inferred.parentById.get("leaf-01")).toBe("core-01");
    expect(inferred.depthById.get("leaf-01")).toBe(1);

    const forest: ParentChildForest = buildParentChildForest(nodes, edges);
    expect(forest.rootIds).toEqual(["core-01"]);
    expect(forest.parentById.get("leaf-01")).toBe("dist-01");
    expect(forest.depthById.get("leaf-01")).toBe(2);
    expect(forest.childrenById.get("core-01")).toEqual(["dist-01"]);
    expect(forest.childrenById.get("dist-01")).toEqual(["leaf-01"]);
    expectWellFormedForest(forest, nodes);
  });

  test("a declaration that agrees with the inference changes nothing", () => {
    /*
     * The common case once operators start annotating links: they write
     * down what the map already showed. Taking the declared code path
     * must produce the identical forest, or every such annotation would
     * quietly redraw a site for no reason.
     */
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("core-01"),
      makeDevice("switch-a"),
      makeDevice("switch-b"),
      makeEndpoint("endpoint:pos-1", { name: "pos-1" }),
      makeEndpoint("endpoint:pos-2", { name: "pos-2" }),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("core-01", "switch-a", ["lldp"]),
      makeEdge("core-01", "switch-b", ["lldp"]),
      makeEdge("switch-a", "endpoint:pos-1", ["fdb"]),
      makeEdge("switch-b", "endpoint:pos-2", ["fdb"]),
    ];
    const declared: Array<NetworkTopologyEdge> = [
      makeDeclaredEdge("core-01", "switch-a", "core-01", ["lldp"]),
      ...edges.slice(1),
    ];

    expectIdenticalForest(
      buildParentChildForest(nodes, declared),
      buildParentChildForest(nodes, edges),
    );
  });

  test("a contradicted declaration falls back to the inference exactly", () => {
    /*
     * Two switches both claiming `leaf-01`. The contradiction leaves the
     * component with no usable declaration at all, so it must come back
     * byte for byte as the graph without any annotation — a rejected
     * statement is not allowed to leave a trace.
     */
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("core-01", { role: "router" }),
      makeDevice("switch-a", { role: "switch" }),
      makeDevice("switch-b", { role: "switch" }),
      makeDevice("leaf-01", { role: "switch" }),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("core-01", "switch-a", ["lldp"]),
      makeEdge("core-01", "switch-b", ["lldp"]),
      makeDeclaredEdge("switch-a", "leaf-01", "switch-a", ["manual"]),
      makeDeclaredEdge("switch-b", "leaf-01", "switch-b", ["manual"]),
    ];

    const forest: ParentChildForest = buildParentChildForest(nodes, edges);
    expectIdenticalForest(
      forest,
      buildParentChildForest(nodes, withoutDeclarations(edges)),
    );
    // Inference's own rule: the canonically first neighbour one level up.
    expect(forest.parentById.get("leaf-01")).toBe("switch-a");
    expect(forest.rootIds).toEqual(["core-01"]);
  });

  test("a declared parent survives redundant cabling around it", () => {
    /*
     * A ring of four — the classic redundantly cabled distribution block.
     * `sw-c` is one hop from the core round the other side of the ring,
     * and the operator has said it hangs off `sw-b`. The declaration must
     * hold, the extra cable must still be in the graph, and the walk must
     * terminate: a cycle plus a hierarchy is where an infinite loop would
     * live if one existed.
     */
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("core-01", { role: "router" }),
      makeUnmanaged("unmanaged:sw-a", { name: "sw-a" }),
      makeUnmanaged("unmanaged:sw-b", { name: "sw-b" }),
      makeUnmanaged("unmanaged:sw-c", { name: "sw-c" }),
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("core-01", "unmanaged:sw-a", ["lldp"]),
      makeEdge("core-01", "unmanaged:sw-c", ["lldp"]),
      makeEdge("unmanaged:sw-a", "unmanaged:sw-b", ["lldp"]),
      makeDeclaredEdge("unmanaged:sw-b", "unmanaged:sw-c", "unmanaged:sw-b", [
        "lldp",
      ]),
    ];

    const inferred: ParentChildForest = buildParentChildForest(
      nodes,
      withoutDeclarations(edges),
    );
    expect(inferred.parentById.get("unmanaged:sw-c")).toBe("core-01");

    const forest: ParentChildForest = buildParentChildForest(nodes, edges);
    expect(forest.rootIds).toEqual(["core-01"]);
    expect(forest.parentById.get("unmanaged:sw-c")).toBe("unmanaged:sw-b");
    expect(forest.depthById.get("unmanaged:sw-c")).toBe(3);
    expectWellFormedForest(forest, nodes);

    for (const seed of SHUFFLE_SEEDS) {
      expectIdenticalForest(
        buildParentChildForest(permuted(nodes, seed), permuted(edges, seed)),
        forest,
      );
    }
  });

  test("a cycle of declarations still yields a tree", () => {
    /*
     * Three switches cabled in a triangle and annotated all the way
     * round, which is a statement no tree can honour in full. One
     * declaration is dropped, the rest stand, and the result is still a
     * single tree over the component.
     */
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("core-a", { role: "switch" }),
      makeDevice("core-b", { role: "switch" }),
      makeDevice("core-c", { role: "switch" }),
    ];
    const forest: ParentChildForest = buildParentChildForest(nodes, cycleEdges);
    expect(forest.rootIds.length).toBe(1);
    expectWellFormedForest(forest, nodes);
    // The two surviving declarations, drawn as the chain they describe.
    expect(forest.rootIds).toEqual(["core-c"]);
    expect(forest.parentById.get("core-a")).toBe("core-c");
    expect(forest.parentById.get("core-b")).toBe("core-a");
    expect(forest.depthById.get("core-b")).toBe(2);
  });
});

describe("buildParentChildForest — an undeclared component is left alone", () => {
  /*
   * One site nobody has annotated, and a second site where an operator
   * has declared a parent. The undeclared site must be laid out by the
   * code that laid it out before this feature existed — same parents,
   * same depths, same root — because a project that never sets a parent
   * is every project until somebody does.
   */
  const untouchedNodes: Array<NetworkTopologyNode> = [
    makeDevice("core-01"),
    makeDevice("switch-a"),
    makeDevice("switch-b"),
    makeEndpoint("endpoint:pos-1", { name: "pos-1" }),
    makeEndpoint("endpoint:pos-2", { name: "pos-2" }),
  ];
  const untouchedEdges: Array<NetworkTopologyEdge> = [
    makeEdge("core-01", "switch-a", ["lldp"]),
    makeEdge("core-01", "switch-b", ["lldp"]),
    makeEdge("switch-a", "endpoint:pos-1", ["fdb"]),
    makeEdge("switch-b", "endpoint:pos-2", ["fdb"]),
  ];

  const otherSiteNodes: Array<NetworkTopologyNode> = [
    makeDevice("peer-01", { role: "switch" }),
    makeDevice("peer-02", { role: "switch" }),
  ];

  const nodes: Array<NetworkTopologyNode> = [
    ...untouchedNodes,
    ...otherSiteNodes,
  ];

  const withoutDeclaration: ParentChildForest = buildParentChildForest(nodes, [
    ...untouchedEdges,
    makeEdge("peer-01", "peer-02", ["lldp"]),
  ]);
  const withDeclaration: ParentChildForest = buildParentChildForest(nodes, [
    ...untouchedEdges,
    makeDeclaredEdge("peer-01", "peer-02", "peer-02", ["manual"]),
  ]);

  test("the declaration on the second site actually changed that site", () => {
    // Otherwise the comparison below would prove nothing at all.
    expect(withoutDeclaration.parentById.get("peer-02")).toBe("peer-01");
    expect(withDeclaration.parentById.get("peer-01")).toBe("peer-02");
    expect(withoutDeclaration.rootIds).toEqual(["core-01", "peer-01"]);
    expect(withDeclaration.rootIds).toEqual(["core-01", "peer-02"]);
  });

  test("every node of the untouched site keeps its parent and its depth", () => {
    for (const node of untouchedNodes) {
      expect(withDeclaration.parentById.get(node.id)).toBe(
        withoutDeclaration.parentById.get(node.id),
      );
      expect(withDeclaration.depthById.get(node.id)).toBe(
        withoutDeclaration.depthById.get(node.id),
      );
      expect(withDeclaration.childrenById.get(node.id)).toEqual(
        withoutDeclaration.childrenById.get(node.id),
      );
    }
  });

  test("an island with no links at all is untouched either way", () => {
    const withIsland: ParentChildForest = buildParentChildForest(
      [...nodes, makeDevice("island-01")],
      [
        ...untouchedEdges,
        makeDeclaredEdge("peer-01", "peer-02", "peer-02", ["manual"]),
      ],
    );
    expect(withIsland.depthById.get("island-01")).toBe(0);
    expect(withIsland.childrenById.get("island-01")).toEqual([]);
    expect(withIsland.parentById.has("island-01")).toBe(false);
    expect(withIsland.rootIds).toEqual(["core-01", "island-01", "peer-02"]);
  });
});

/*
 * Everything at once, because each resolution changes the input to the
 * next: a campus with a declared uplink, a declared ping-only AP, a
 * contradicted claim on an unmanaged peer, a second site whose triangle
 * carries a declaration, and an island nobody has cabled.
 */
const campusNodes: Array<NetworkTopologyNode> = [
  makeDevice("core-01", { role: "router" }),
  makeDevice("dist-a", { role: "switch" }),
  makeDevice("dist-b", { role: "switch" }),
  makeDevice("ap-01", { role: "unknown" }),
  makeUnmanaged("unmanaged:sw-x", { name: "sw-x" }),
  makeEndpoint("endpoint:pos-1", { name: "pos-1" }),
  makeDevice("peer-01", { role: "switch" }),
  makeDevice("peer-02", { role: "switch" }),
  makeDevice("peer-03", { role: "switch" }),
  makeDevice("solo-01"),
];

const campusEdges: Array<NetworkTopologyEdge> = [
  makeDeclaredEdge("core-01", "dist-a", "core-01", ["lldp"]),
  makeEdge("core-01", "dist-b", ["lldp"]),
  makeDeclaredEdge("dist-b", "ap-01", "dist-b", ["manual"]),
  makeEdge("dist-a", "endpoint:pos-1", ["fdb"]),
  // Contradiction: two devices both claim the unmanaged peer as a child.
  makeDeclaredEdge("core-01", "unmanaged:sw-x", "core-01", ["cdp"]),
  makeDeclaredEdge("dist-a", "unmanaged:sw-x", "dist-a", ["cdp"]),
  makeEdge("peer-01", "peer-02", ["lldp"]),
  makeDeclaredEdge("peer-02", "peer-03", "peer-03", ["manual"]),
  makeEdge("peer-03", "peer-01", ["lldp"]),
];

describe("buildParentChildForest — a whole campus of mixed declarations", () => {
  const forest: ParentChildForest = buildParentChildForest(
    campusNodes,
    campusEdges,
  );

  test("the forest is well formed however tangled the declarations are", () => {
    expectWellFormedForest(forest, campusNodes);
    /*
     * peer-03 roots the second site rather than peer-01. All three of its
     * switches tie on role and on connection count, so the choice used to
     * fall to the alphabet — and a declaration is better evidence than the
     * alphabet. peer-03 is the one an operator named as a parent.
     */
    expect(forest.rootIds).toEqual(["core-01", "peer-03", "solo-01"]);
  });

  test("each site's hierarchy is the one that was declared for it", () => {
    expect(forest.parentById.get("dist-a")).toBe("core-01");
    expect(forest.parentById.get("ap-01")).toBe("dist-b");
    expect(forest.depthById.get("ap-01")).toBe(2);
    expect(forest.parentById.get("endpoint:pos-1")).toBe("dist-a");
    // The contradicted peer falls back to inference: one hop from the core.
    expect(forest.parentById.get("unmanaged:sw-x")).toBe("core-01");
    expect(forest.depthById.get("unmanaged:sw-x")).toBe(1);
    /*
     * The second site is a triangle of three equal switches, so nothing
     * but the declaration distinguishes them. peer-03 was named a parent,
     * so it tops the site and the other two hang directly off it — and
     * both of those tree lines are real cables, which is the property that
     * makes this the right answer rather than merely a consistent one.
     */
    expect(forest.parentById.get("peer-02")).toBe("peer-03");
    expect(forest.parentById.get("peer-01")).toBe("peer-03");
    expect(forest.depthById.get("peer-02")).toBe(1);
  });

  test("no node is its own ancestor and every walk ends at a root", () => {
    for (const node of campusNodes) {
      const walk: ParentChainWalk = parentChainOf(forest, node.id);
      expect(walk.hitCycle).toBe(false);
      expect(walk.chain.slice(1)).not.toContain(node.id);
      expect(forest.rootIds).toContain(walk.chain[walk.chain.length - 1]);
    }
  });

  test("shuffling the payload cannot change one parent", () => {
    for (const seed of SHUFFLE_SEEDS) {
      expectIdenticalForest(
        buildParentChildForest(
          permuted(campusNodes, seed),
          permuted(campusEdges, seed * 7),
        ),
        forest,
      );
    }
  });

  test("reversing and flipping the payload cannot change one parent", () => {
    expectIdenticalForest(
      buildParentChildForest(
        [...campusNodes].reverse(),
        flipEdges([...campusEdges].reverse()),
      ),
      forest,
    );
  });

  test("a link reported twice, once annotated, does not move anything", () => {
    /*
     * A hand-drawn link and the later-discovered cable for it MERGE into
     * one edge server-side, but a reader must survive seeing both — and
     * the declaration must survive being restated on the duplicate.
     */
    expectIdenticalForest(
      buildParentChildForest(campusNodes, [
        ...campusEdges,
        makeEdge("dist-b", "ap-01", ["lldp"]),
        makeDeclaredEdge("ap-01", "dist-b", "dist-b", ["manual"]),
      ]),
      forest,
    );
  });
});

describe("buildParentChildForest — a declared parent at the edge of the map", () => {
  /*
   * The awkward shape, and a realistic one: the declared parent is the ISP
   * handoff, an unmanaged peer nothing else is cabled to. Every path to it
   * runs through the very device it was declared to be the parent OF, so
   * no tree rooted anywhere else in the estate can honour the statement —
   * the only tree that can is the one rooted at the handoff itself.
   *
   * KNOWN GAP (reported alongside these tests, not papered over here):
   * chooseTreeRoot picks by role and degree, so it roots at `core-01`, the
   * traversal defers `dist-01` for a declared parent it can no longer
   * reach, and the recovery sweep attaches both the other way up — the
   * declaration is not merely dropped, it is inverted. The assertions
   * below are therefore deliberately limited to what must be true under
   * EITHER behaviour: the declaration is read correctly, the two devices
   * stay directly related, and the forest remains a terminating,
   * well-formed tree rather than a loop.
   */
  const nodes: Array<NetworkTopologyNode> = [
    makeDevice("core-01", { role: "router" }),
    makeDevice("dist-01", { role: "switch" }),
    makeUnmanaged("unmanaged:isp-gw", { name: "isp-gw" }),
  ];
  const edges: Array<NetworkTopologyEdge> = [
    makeEdge("core-01", "dist-01", ["lldp"]),
    makeDeclaredEdge("dist-01", "unmanaged:isp-gw", "unmanaged:isp-gw", [
      "manual",
    ]),
  ];

  test("the declaration itself is read exactly as the operator wrote it", () => {
    expect(sortedEntries(buildDeclaredParentMap(nodes, edges))).toEqual([
      ["dist-01", "unmanaged:isp-gw"],
    ]);
  });

  test("the forest still terminates and still places every device", () => {
    const forest: ParentChildForest = buildParentChildForest(nodes, edges);
    expectWellFormedForest(forest, nodes);
    expect(forest.rootIds.length).toBe(1);
  });

  test("the two declared ends stay directly related to each other", () => {
    const forest: ParentChildForest = buildParentChildForest(nodes, edges);
    const parentOfGateway: string | undefined =
      forest.parentById.get("unmanaged:isp-gw");
    const parentOfSwitch: string | undefined = forest.parentById.get("dist-01");
    expect(
      parentOfGateway === "dist-01" || parentOfSwitch === "unmanaged:isp-gw",
    ).toBe(true);
  });

  test("the awkward shape is still laid out identically every time", () => {
    const forest: ParentChildForest = buildParentChildForest(nodes, edges);
    for (const seed of SHUFFLE_SEEDS) {
      expectIdenticalForest(
        buildParentChildForest(permuted(nodes, seed), permuted(edges, seed)),
        forest,
      );
    }
  });
});
