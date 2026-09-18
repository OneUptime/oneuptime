import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";

/*
 * Pure, react-free graph primitives shared by every topology layout:
 * hashing, clamping, canonical ordering, adjacency and connected
 * components.
 *
 * Kept out of the .tsx components so it can be imported (and unit-tested)
 * in a plain Node/TypeScript environment — the App project does not have
 * `react` on its resolution path, so importing this logic from a component
 * would drag `react` into the App compile/test context and fail to
 * resolve.
 *
 * The governing rule in this file: **every ordering decision is a total
 * sort on node id, never on array index.** The topology endpoint returns
 * nodes in whatever order the database query produced, and that order is
 * not stable across the 60-second poll. A layout keyed off array position
 * therefore reshuffles the whole map every minute for no reason. Sorting
 * by id makes the layout a function of the GRAPH rather than a function of
 * the response.
 */

/** A single 2D coordinate. */
export interface TopologyPoint {
  x: number;
  y: number;
}

/**
 * Deterministic 32-bit FNV-1a hash of a string. Used wherever a stable
 * pseudo-random value is needed (separating coincident nodes, for
 * instance) — Math.random is non-deterministic and would make the layout
 * flap between renders of identical data.
 */
export const hashString: (value: string) => number = (
  value: string,
): number => {
  let hash: number = 2166136261 >>> 0; // FNV offset basis.
  for (let i: number = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0; // FNV prime.
  }
  return hash >>> 0;
};

/**
 * Deterministic pseudo-random unit value in [0, 1) derived from an
 * integer seed via an xorshift step.
 */
export const seededUnit: (seed: number) => number = (seed: number): number => {
  let x: number = seed >>> 0;
  if (x === 0) {
    x = 0x9e3779b9; // Avoid the fixed point at zero.
  }
  x ^= x << 13;
  x >>>= 0;
  x ^= x >> 17;
  x ^= x << 5;
  x >>>= 0;
  return (x >>> 0) / 4294967296;
};

/*
 * Non-finite input returns the midpoint rather than propagating NaN: a
 * NaN reaching an SVG coordinate attribute makes that element vanish, and
 * a NaN reaching the bounds calculation blanks the entire graph. This
 * function is also used for zoom clamping, so the behaviour is
 * load-bearing outside layout.
 */
export const clamp: (value: number, min: number, max: number) => number = (
  value: number,
  min: number,
  max: number,
): number => {
  if (!Number.isFinite(value)) {
    return (min + max) / 2;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

/**
 * Total order used wherever a tie must be broken. Ordering by id rather
 * than by array index is what makes the layout a function of the graph
 * instead of a function of whatever order the topology query returned.
 */
export const compareNodeIds: (a: string, b: string) => number = (
  a: string,
  b: string,
): number => {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
};

/**
 * The node ids of a topology in canonical order, with duplicates
 * collapsed. Every layout stage iterates this rather than the input
 * array.
 */
export const canonicalNodeOrder: (
  nodes: Array<NetworkTopologyNode>,
) => Array<string> = (nodes: Array<NetworkTopologyNode>): Array<string> => {
  const seen: Set<string> = new Set<string>();
  for (const node of nodes || []) {
    if (node && typeof node.id === "string" && node.id.length > 0) {
      seen.add(node.id);
    }
  }
  return Array.from(seen).sort(compareNodeIds);
};

/** Undirected edge between two node ids, with `a` before `b`. */
export interface TopologyEdgePair {
  a: string;
  b: string;
}

export interface TopologyAdjacency {
  /** Neighbor ids per node, each list sorted by compareNodeIds. */
  neighborsById: Map<string, Array<string>>;
  degreeById: Map<string, number>;
  /** Deduped, self-loop-free undirected edges, sorted and with a < b. */
  uniqueEdges: Array<TopologyEdgePair>;
}

/**
 * Build the undirected adjacency of a topology.
 *
 * Edges naming a node that is not in `nodes` are dropped (the VLAN filter
 * removes endpoints without rewriting edges, and a stale payload can name
 * a device that aged out). Self-loops are dropped. A link reported by
 * both LLDP and CDP, or from both ends, collapses to one entry.
 */
export const buildTopologyAdjacency: (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
) => TopologyAdjacency = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
): TopologyAdjacency => {
  const orderedIds: Array<string> = canonicalNodeOrder(nodes);
  const known: Set<string> = new Set<string>(orderedIds);

  const neighborSets: Map<string, Set<string>> = new Map<string, Set<string>>();
  for (const id of orderedIds) {
    neighborSets.set(id, new Set<string>());
  }

  const pairKeys: Set<string> = new Set<string>();
  const uniqueEdges: Array<TopologyEdgePair> = [];

  for (const edge of edges || []) {
    if (!edge) {
      continue;
    }
    const from: string = edge.fromNodeId;
    const to: string = edge.toNodeId;
    if (!known.has(from) || !known.has(to) || from === to) {
      continue;
    }
    const a: string = compareNodeIds(from, to) <= 0 ? from : to;
    const b: string = a === from ? to : from;
    const key: string = `${a}\u0000${b}`;
    if (pairKeys.has(key)) {
      continue;
    }
    pairKeys.add(key);
    uniqueEdges.push({ a: a, b: b });
    neighborSets.get(a)!.add(b);
    neighborSets.get(b)!.add(a);
  }

  /*
   * Sorting the edge list (rather than keeping discovery order) is what
   * makes every downstream force accumulation order-independent: floating
   * point addition is not associative, so summing the same forces in a
   * different order yields different low bits and, over 200 iterations,
   * visibly different coordinates.
   */
  uniqueEdges.sort(
    (left: TopologyEdgePair, right: TopologyEdgePair): number => {
      const byA: number = compareNodeIds(left.a, right.a);
      return byA === 0 ? compareNodeIds(left.b, right.b) : byA;
    },
  );

  const neighborsById: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();
  const degreeById: Map<string, number> = new Map<string, number>();
  for (const id of orderedIds) {
    const neighbors: Array<string> = Array.from(neighborSets.get(id)!).sort(
      compareNodeIds,
    );
    neighborsById.set(id, neighbors);
    degreeById.set(id, neighbors.length);
  }

  return {
    neighborsById: neighborsById,
    degreeById: degreeById,
    uniqueEdges: uniqueEdges,
  };
};

export interface TopologyComponent {
  /** Member ids in BFS order from rootId. */
  nodeIds: Array<string>;
  /** Highest-degree member, ties broken by compareNodeIds. */
  rootId: string;
  /** The component's own edges. */
  edges: Array<TopologyEdgePair>;
  /** BFS distance from rootId. */
  depthById: Map<string, number>;
}

/**
 * Split a graph into connected components.
 *
 * Components come back largest first (ties by rootId) so the packing step
 * puts the graph that matters on the first shelf, where the eye lands.
 * Within a component, ids are in BFS order from the highest-degree node,
 * and the BFS queue drains in canonical id order so the traversal — and
 * therefore the seeding that consumes it — is a function of the graph
 * alone.
 */
export const findTopologyComponents: (
  adjacency: TopologyAdjacency,
  orderedNodeIds: Array<string>,
) => Array<TopologyComponent> = (
  adjacency: TopologyAdjacency,
  orderedNodeIds: Array<string>,
): Array<TopologyComponent> => {
  const visited: Set<string> = new Set<string>();
  const componentIdByNode: Map<string, number> = new Map<string, number>();
  const memberLists: Array<Array<string>> = [];

  for (const startId of orderedNodeIds) {
    if (visited.has(startId)) {
      continue;
    }
    const members: Array<string> = [];
    const componentIndex: number = memberLists.length;
    const queue: Array<string> = [startId];
    visited.add(startId);
    while (queue.length > 0) {
      const current: string = queue.shift()!;
      members.push(current);
      componentIdByNode.set(current, componentIndex);
      for (const neighbor of adjacency.neighborsById.get(current) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    memberLists.push(members);
  }

  const edgesByComponent: Array<Array<TopologyEdgePair>> = memberLists.map(
    (): Array<TopologyEdgePair> => {
      return [];
    },
  );
  for (const edge of adjacency.uniqueEdges) {
    const index: number | undefined = componentIdByNode.get(edge.a);
    if (index !== undefined) {
      edgesByComponent[index]!.push(edge);
    }
  }

  const components: Array<TopologyComponent> = memberLists.map(
    (members: Array<string>, index: number): TopologyComponent => {
      // Root: highest degree wins, ties by id — a stable, graph-only choice.
      let rootId: string = members[0]!;
      let bestDegree: number = adjacency.degreeById.get(rootId) || 0;
      for (const id of members) {
        const degree: number = adjacency.degreeById.get(id) || 0;
        if (
          degree > bestDegree ||
          (degree === bestDegree && compareNodeIds(id, rootId) < 0)
        ) {
          rootId = id;
          bestDegree = degree;
        }
      }

      /*
       * Re-run the BFS from the chosen root so nodeIds and depthById agree
       * with each other. The first pass only established membership; it
       * started from whichever member came first in canonical order, which
       * is rarely the root.
       */
      const depthById: Map<string, number> = new Map<string, number>();
      const ordered: Array<string> = [];
      const queue: Array<string> = [rootId];
      depthById.set(rootId, 0);
      while (queue.length > 0) {
        const current: string = queue.shift()!;
        ordered.push(current);
        const depth: number = depthById.get(current)!;
        for (const neighbor of adjacency.neighborsById.get(current) || []) {
          if (!depthById.has(neighbor)) {
            depthById.set(neighbor, depth + 1);
            queue.push(neighbor);
          }
        }
      }

      return {
        nodeIds: ordered,
        rootId: rootId,
        edges: edgesByComponent[index]!,
        depthById: depthById,
      };
    },
  );

  components.sort((a: TopologyComponent, b: TopologyComponent): number => {
    if (a.nodeIds.length !== b.nodeIds.length) {
      return b.nodeIds.length - a.nodeIds.length;
    }
    return compareNodeIds(a.rootId, b.rootId);
  });

  return components;
};

/**
 * The BFS children of each node within a component's BFS tree, in
 * canonical id order. Used by the seeding and radial layouts to hand each
 * subtree its own angular wedge.
 */
export const bfsChildrenOf: (
  component: TopologyComponent,
  adjacency: TopologyAdjacency,
) => Map<string, Array<string>> = (
  component: TopologyComponent,
  adjacency: TopologyAdjacency,
): Map<string, Array<string>> => {
  const childrenById: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();
  const parentById: Map<string, string> = new Map<string, string>();

  for (const id of component.nodeIds) {
    childrenById.set(id, []);
  }

  /*
   * A node's BFS parent is the neighbour exactly one level up. Several
   * may qualify in a graph with cycles; the canonically first one wins so
   * the tree is a function of the graph.
   */
  for (const id of component.nodeIds) {
    const depth: number | undefined = component.depthById.get(id);
    if (depth === undefined || depth === 0) {
      continue;
    }
    let parent: string | null = null;
    for (const neighbor of adjacency.neighborsById.get(id) || []) {
      if (component.depthById.get(neighbor) !== depth - 1) {
        continue;
      }
      if (parent === null || compareNodeIds(neighbor, parent) < 0) {
        parent = neighbor;
      }
    }
    if (parent !== null) {
      parentById.set(id, parent);
      childrenById.get(parent)!.push(id);
    }
  }

  for (const [, children] of childrenById) {
    children.sort(compareNodeIds);
  }

  return childrenById;
};
