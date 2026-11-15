import {
  ResourceTopologyGraph,
  ResourceTopologyNode,
  ResourceTopologyRelation,
  compareTopologyNames,
  getOwnTopologySearchMatches,
  searchTopology,
} from "./ResourceTopologyModel";

/*
 * THE CONNECTIONS VIEW: WHAT A PART IS CONNECTED TO, DRAWN AROUND IT.
 *
 * The map is a tree of what holds what, so how parts are connected across
 * it - a load balancer to the interfaces it sends traffic to, a database to
 * the endpoint that reaches it - shows only for the part someone picks. The
 * Connections view draws those connections first, the way Security Events
 * draws what co-occurs with a filter: one thing in the middle, what it is
 * connected to on a ring around it, and what those are connected to on an
 * outer ring, each pulled toward what it is connected to. Clicking a part
 * moves it to the middle, so a person walks the account one connection at
 * a time.
 *
 * What stands in the middle is the last thing the reader asked for:
 *
 *   - a part they picked, with every part it is connected to around it;
 *   - their search, with the parts it found around it;
 *   - "Needs attention", with every part that needs it around it - and on
 *     the outer ring what those are connected to: what a problem may reach;
 *   - otherwise the resource itself, with its most connected parts around
 *     it: where its connections gather (a network, a load balancer, a plan).
 *
 * Each ring keeps what needs attention first, then the most connected, then
 * by name, and draws at most its limit, saying how many it left out. The
 * inner ring is ordered so parts connected to each other sit side by side:
 * an interface beside the machine it is attached to.
 *
 * Free of React and of drawing: the canvas lays this out with the Security
 * Events layout (CorrelationGraphLayout) and draws it.
 */

export const TOPOLOGY_CONNECTIONS_CENTER_ID: string = "connections:center";

export interface TopologyConnectionsLimits {
  // Parts drawn on the ring around the middle at most.
  ring: number;
  // Parts drawn on the outer ring at most.
  outerRing: number;
  // On the resource's own view, its most connected parts drawn around it at most.
  hubs: number;
}

/*
 * Small enough that the whole drawing is framed at a zoom its words read
 * at on a laptop's canvas.
 */
export const TOPOLOGY_CONNECTIONS_LIMITS: TopologyConnectionsLimits = {
  ring: 12,
  outerRing: 24,
  hubs: 10,
};

// A phone's canvas: fewer parts, so the drawing is framed at a zoom that reads.
export const TOPOLOGY_CONNECTIONS_PHONE_LIMITS: TopologyConnectionsLimits = {
  ring: 8,
  outerRing: 12,
  hubs: 6,
};

/*
 * A line between two parts of the ring is drawn only between parts this
 * close on it: the ring's order puts connected parts side by side, and a
 * line across the ring would cross the middle and every line to it.
 */
export const TOPOLOGY_CONNECTIONS_CHORD_REACH: number = 2;

export type TopologyConnectionsCenterKind =
  | "part"
  | "search"
  | "attention"
  | "overview";

export interface TopologyConnectionsEdge {
  // The two ends, in a stable order: one edge per pair of parts.
  id: string;
  from: string;
  to: string;
  /*
   * The connections between the two, each read from its own `from` ("Runs
   * in"). None for a line from a middle that only gathers what is around
   * it: a search, "Needs attention", the resource's own view.
   */
  relations: Array<ResourceTopologyRelation>;
  // Joins the middle to a part on the ring.
  touchesCenter: boolean;
}

export interface TopologyConnectionsView {
  centerKind: TopologyConnectionsCenterKind;
  /*
   * What stands in the middle: the picked part's id, the resource's id on
   * its own view, or TOPOLOGY_CONNECTIONS_CENTER_ID for a search or
   * "Needs attention".
   */
  centerId: string;
  // The ring around the middle, in the order it is drawn from the top.
  ring: Array<string>;
  outerRing: Array<string>;
  edges: Array<TopologyConnectionsEdge>;
  // Parts that belong on the ring, and on the outer ring, that are not drawn.
  ringHidden: number;
  outerRingHidden: number;
}

export interface TopologyConnectionsOptions {
  // The part someone picked, when it is still there.
  selectedId: string | null;
  search: string;
  attentionOnly: boolean;
  // The words a kind is found by, for a search.
  kindLabel?: ((kind: string) => Array<string>) | undefined;
  limits?: TopologyConnectionsLimits | undefined;
}

// The parts each part is connected to, with the connections between them.
export type TopologyNeighbourhood = Map<
  string,
  Array<ResourceTopologyRelation>
>;

export function getTopologyConnectedParts(
  graph: ResourceTopologyGraph,
  nodeId: string,
): TopologyNeighbourhood {
  const neighbours: TopologyNeighbourhood = new Map<
    string,
    Array<ResourceTopologyRelation>
  >();

  for (const connection of graph.connectionsByNode.get(nodeId) || []) {
    const other: string =
      connection.from === nodeId ? connection.to : connection.from;

    if (other === nodeId) {
      continue;
    }

    neighbours.set(other, [...(neighbours.get(other) || []), connection]);
  }

  return neighbours;
}

// How many parts a part is connected to.
export function countTopologyConnectedParts(
  graph: ResourceTopologyGraph,
  nodeId: string,
): number {
  return getTopologyConnectedParts(graph, nodeId).size;
}

function attentionRank(node: ResourceTopologyNode): number {
  if (node.effectiveHealth === "critical") {
    return 0;
  }

  return node.effectiveHealth === "warning" ? 1 : 2;
}

function byName(a: ResourceTopologyNode, b: ResourceTopologyNode): number {
  const named: number = compareTopologyNames(a.name, b.name);

  if (named !== 0) {
    return named;
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/*
 * The parts that belong around the middle, in the order they are kept: what
 * needs attention first, then the most connected, then by name. The
 * resource's own view keeps the most connected first: it is about where
 * the connections gather.
 */
function rankParts(
  graph: ResourceTopologyGraph,
  ids: Iterable<string>,
  degree: Map<string, number>,
  connectedFirst: boolean,
): Array<string> {
  const nodes: Array<ResourceTopologyNode> = [];

  for (const id of ids) {
    const node: ResourceTopologyNode | undefined = graph.nodes.get(id);

    if (node && id !== graph.rootId && !node.isSection) {
      nodes.push(node);
    }
  }

  const degreeOf: (node: ResourceTopologyNode) => number = (
    node: ResourceTopologyNode,
  ): number => {
    return degree.get(node.id) || 0;
  };

  nodes.sort((a: ResourceTopologyNode, b: ResourceTopologyNode): number => {
    const byAttention: number = attentionRank(a) - attentionRank(b);
    const byDegree: number = degreeOf(b) - degreeOf(a);

    if (connectedFirst) {
      if (byDegree !== 0) {
        return byDegree;
      }

      if (byAttention !== 0) {
        return byAttention;
      }
    } else {
      if (byAttention !== 0) {
        return byAttention;
      }

      if (byDegree !== 0) {
        return byDegree;
      }
    }

    return byName(a, b);
  });

  return nodes.map((node: ResourceTopologyNode): string => {
    return node.id;
  });
}

/*
 * The ring's order: the kept order, except that a part connected to the
 * part just placed comes next, so connected parts sit side by side and the
 * line between them stays short.
 */
export function orderTopologyRing(
  ids: ReadonlyArray<string>,
  isConnected: (a: string, b: string) => boolean,
): Array<string> {
  const remaining: Array<string> = [...ids];
  const ordered: Array<string> = [];

  while (remaining.length > 0) {
    const last: string | undefined = ordered[ordered.length - 1];
    let index: number = last
      ? remaining.findIndex((id: string): boolean => {
          return isConnected(last, id);
        })
      : -1;

    if (index < 0) {
      index = 0;
    }

    ordered.push(remaining.splice(index, 1)[0]!);
  }

  return ordered;
}

function edgeId(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function computeTopologyConnectionsView(
  graph: ResourceTopologyGraph,
  options: TopologyConnectionsOptions,
): TopologyConnectionsView {
  const limits: TopologyConnectionsLimits =
    options.limits || TOPOLOGY_CONNECTIONS_LIMITS;
  const degree: Map<string, number> = new Map<string, number>();
  const neighbourhoods: Map<string, TopologyNeighbourhood> = new Map<
    string,
    TopologyNeighbourhood
  >();
  const neighbourhoodOf: (id: string) => TopologyNeighbourhood = (
    id: string,
  ): TopologyNeighbourhood => {
    let found: TopologyNeighbourhood | undefined = neighbourhoods.get(id);

    if (!found) {
      found = getTopologyConnectedParts(graph, id);
      neighbourhoods.set(id, found);
    }

    return found;
  };

  for (const id of graph.connectionsByNode.keys()) {
    degree.set(id, neighbourhoodOf(id).size);
  }

  const selected: ResourceTopologyNode | undefined =
    options.selectedId && options.selectedId !== graph.rootId
      ? graph.nodes.get(options.selectedId)
      : undefined;
  const searching: boolean = options.search.trim().length > 0;

  let centerKind: TopologyConnectionsCenterKind;
  let centerId: string;
  let candidates: Array<string>;
  let ringLimit: number = limits.ring;

  if (selected && !selected.isSection) {
    centerKind = "part";
    centerId = selected.id;
    candidates = rankParts(
      graph,
      neighbourhoodOf(selected.id).keys(),
      degree,
      false,
    );
  } else if (searching) {
    centerKind = "search";
    centerId = TOPOLOGY_CONNECTIONS_CENTER_ID;
    const found: Set<string> = searchTopology(
      graph,
      options.search,
      options.kindLabel,
    );
    candidates = rankParts(
      graph,
      getOwnTopologySearchMatches(
        graph,
        found,
        options.search,
        options.kindLabel,
      ),
      degree,
      false,
    );
  } else if (options.attentionOnly) {
    centerKind = "attention";
    centerId = TOPOLOGY_CONNECTIONS_CENTER_ID;
    const troubled: Array<string> = [];

    for (const node of graph.nodes.values()) {
      if (node.needsAttention) {
        troubled.push(node.id);
      }
    }

    candidates = rankParts(graph, troubled, degree, false);
  } else {
    centerKind = "overview";
    centerId = graph.rootId;
    ringLimit = limits.hubs;
    candidates = rankParts(
      graph,
      Array.from(degree.keys()).filter((id: string): boolean => {
        return (degree.get(id) || 0) > 0;
      }),
      degree,
      true,
    );
  }

  const isConnected: (a: string, b: string) => boolean = (
    a: string,
    b: string,
  ): boolean => {
    return neighbourhoodOf(a).has(b);
  };

  const ring: Array<string> = orderTopologyRing(
    candidates.slice(0, ringLimit),
    isConnected,
  );
  const ringSet: Set<string> = new Set<string>(ring);
  /*
   * A part connected to the picked one belongs on the ring: one the ring's
   * limit left out is not drawn further out, where it would read as
   * connected only through another.
   */
  const leftOffRing: Set<string> = new Set<string>(
    centerKind === "part" ? candidates.slice(ringLimit) : [],
  );

  // The outer ring: what the ring is connected to, pulled by how many of it.
  const pull: Map<string, number> = new Map<string, number>();

  for (const id of ring) {
    for (const other of neighbourhoodOf(id).keys()) {
      if (other === centerId || ringSet.has(other) || leftOffRing.has(other)) {
        continue;
      }

      pull.set(other, (pull.get(other) || 0) + 1);
    }
  }

  const outerCandidates: Array<string> = Array.from(pull.keys())
    .filter((id: string): boolean => {
      const node: ResourceTopologyNode | undefined = graph.nodes.get(id);
      return Boolean(node) && id !== graph.rootId && !node!.isSection;
    })
    .sort((a: string, b: string): number => {
      const nodeA: ResourceTopologyNode = graph.nodes.get(a)!;
      const nodeB: ResourceTopologyNode = graph.nodes.get(b)!;
      const byAttention: number = attentionRank(nodeA) - attentionRank(nodeB);

      if (byAttention !== 0) {
        return byAttention;
      }

      const byPull: number = (pull.get(b) || 0) - (pull.get(a) || 0);

      if (byPull !== 0) {
        return byPull;
      }

      const byDegree: number = (degree.get(b) || 0) - (degree.get(a) || 0);

      return byDegree !== 0 ? byDegree : byName(nodeA, nodeB);
    });
  const outerRing: Array<string> = outerCandidates.slice(0, limits.outerRing);
  const outerSet: Set<string> = new Set<string>(outerRing);

  // One edge per pair of drawn parts, with every connection between them.
  const edges: Array<TopologyConnectionsEdge> = [];
  const edgeIndex: Map<string, TopologyConnectionsEdge> = new Map<
    string,
    TopologyConnectionsEdge
  >();
  const addEdge: (
    from: string,
    to: string,
    relation: ResourceTopologyRelation | null,
  ) => void = (
    from: string,
    to: string,
    relation: ResourceTopologyRelation | null,
  ): void => {
    const id: string = edgeId(from, to);
    let edge: TopologyConnectionsEdge | undefined = edgeIndex.get(id);

    if (!edge) {
      edge = {
        id,
        from,
        to,
        relations: [],
        touchesCenter: from === centerId || to === centerId,
      };
      edgeIndex.set(id, edge);
      edges.push(edge);
    }

    if (relation) {
      edge.relations.push(relation);
    }
  };

  for (const id of ring) {
    if (centerKind === "part") {
      for (const relation of neighbourhoodOf(centerId).get(id) || []) {
        addEdge(relation.from, relation.to, relation);
      }
    } else {
      // A middle that only gathers: one plain line to each part around it.
      addEdge(centerId, id, null);
    }
  }

  /*
   * Between two parts of the ring - only around a picked part, whose ring
   * is what it is connected to, and only between near neighbours on it -
   * and from the ring out. A ring a filter gathers draws no line across
   * itself: what one of its parts is connected to is a click away.
   */
  const ringIndex: Map<string, number> = new Map<string, number>(
    ring.map((id: string, index: number): [string, number] => {
      return [id, index];
    }),
  );
  const isNear: (a: string, b: string) => boolean = (
    a: string,
    b: string,
  ): boolean => {
    const apart: number = Math.abs(ringIndex.get(a)! - ringIndex.get(b)!);

    return (
      Math.min(apart, ring.length - apart) <= TOPOLOGY_CONNECTIONS_CHORD_REACH
    );
  };

  for (const id of ring) {
    for (const [other, relations] of neighbourhoodOf(id)) {
      const isRing: boolean = ringSet.has(other);

      if (!isRing && !outerSet.has(other)) {
        continue;
      }

      if (
        isRing &&
        (other < id || centerKind !== "part" || !isNear(id, other))
      ) {
        continue;
      }

      for (const relation of relations) {
        addEdge(relation.from, relation.to, relation);
      }
    }
  }

  /*
   * What is not drawn, each part once: one the ring's limit left out counts
   * only when it is not drawn further out either, as a filter's may be, and
   * one the outer ring's limit left out only when it is not counted already.
   */
  const ringCandidates: Set<string> = new Set<string>(candidates);

  return {
    centerKind,
    centerId,
    ring,
    outerRing,
    edges,
    ringHidden: candidates.slice(ringLimit).filter((id: string): boolean => {
      return !outerSet.has(id);
    }).length,
    outerRingHidden: outerCandidates
      .slice(limits.outerRing)
      .filter((id: string): boolean => {
        return !ringCandidates.has(id);
      }).length,
  };
}
