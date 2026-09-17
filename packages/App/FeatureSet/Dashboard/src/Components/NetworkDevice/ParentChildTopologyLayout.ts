import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { isFdbEdge } from "./EndpointNodeUtil";
import {
  UNLINKED_BOX_KEY,
  UNLINKED_STRIP_PITCH_X,
  UNLINKED_STRIP_PITCH_Y,
  UNLINKED_STRIP_TOP_GAP,
} from "./ForceTopologyLayout";
import {
  DEFAULT_FOOTPRINT,
  TopologyNodeFootprint,
  buildFootprints,
  footprintOrDefault,
} from "./TopologyFootprint";
import {
  TopologyAdjacency,
  TopologyComponent,
  TopologyPoint,
  bfsChildrenOf,
  buildTopologyAdjacency,
  canonicalNodeOrder,
  compareNodeIds,
  findTopologyComponents,
} from "./TopologyGraphUtil";
import { tierForNode } from "./TopologyLayout";
import { TopologyComponentBox, TopologyLayoutModel } from "./TopologyModel";
import {
  PackInput,
  PackResult,
  PackedBox,
  packComponentBoxes,
} from "./TopologyPacking";

/*
 * Parent-child layout: the org chart of the network.
 *
 * WHY THIS IS NOT THE TIERED LAYOUT. Tiered is ROLE-banded — every router
 * in one row, every switch in the next, endpoints in blocks underneath. It
 * answers "what kinds of thing are on this site", and it answers it well,
 * but a switch in it is drawn in the switch row rather than under the
 * router it actually hangs off: two switches sitting side by side there
 * may have nothing to do with each other. This layout instead places every
 * node directly beneath ITS OWN parent, recursively, so the picture is the
 * hierarchy of the network rather than a census of it. Follow a line down
 * from the core and you are following a real cable.
 *
 * The tree is the BFS spanning tree of each connected component, so a
 * cyclic graph (a pair of redundantly cabled distribution switches, say)
 * still renders every link — the extra edges simply do not decide where a
 * node goes, they are drawn back across the tree the layout produced.
 *
 * Placement is the classic tidy-tree pass: children first, each subtree
 * laid out in its own band, the parent centred over its children. No
 * simulation, so it is exact, instant and trivially deterministic — the
 * same graph always yields the same coordinates whatever order the poll
 * returned its rows in.
 */

/** Vertical distance from a parent's centre to its children's centres. */
export const PARENT_CHILD_LEVEL_GAP: number = 132;
/** Horizontal clearance kept between two adjacent painted ink boxes. */
export const PARENT_CHILD_SIBLING_GAP: number = 26;
/** Clearance between two separate trees, which must read as separate. */
export const PARENT_CHILD_TREE_GAP: number = 90;
export const PARENT_CHILD_TOP_MARGIN: number = 64;
export const PARENT_CHILD_LAYOUT_MARGIN: number = 48;

/**
 * The spanning forest the layout draws: one tree per connected component,
 * plus a one-node tree for every device that reports no neighbours at all.
 *
 * Exported separately from the geometry because the parent/child relation
 * is useful on its own — "what hangs off this switch" is a question the
 * detail panel and the tests both ask, and neither wants coordinates.
 */
export interface ParentChildForest {
  /** Tree roots, in canonical id order. */
  rootIds: Array<string>;
  /** Every non-root node's parent. Roots have no entry. */
  parentById: Map<string, string>;
  /** Children per node — every node has an entry, in canonical id order. */
  childrenById: Map<string, Array<string>>;
  /** Depth below the node's own root; a root is 0. */
  depthById: Map<string, number>;
}

/** The painted extent of a set of nodes: glyph plus label, not centres. */
interface ParentChildInkBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const inkBoxFor: (
  ids: Array<string>,
  positions: Map<string, TopologyPoint>,
  footprints: Map<string, TopologyNodeFootprint>,
) => ParentChildInkBox | null = (
  ids: Array<string>,
  positions: Map<string, TopologyPoint>,
  footprints: Map<string, TopologyNodeFootprint>,
): ParentChildInkBox | null => {
  let minX: number = Infinity;
  let minY: number = Infinity;
  let maxX: number = -Infinity;
  let maxY: number = -Infinity;
  let seen: boolean = false;

  for (const id of ids) {
    const point: TopologyPoint | undefined = positions.get(id);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    const footprint: TopologyNodeFootprint = footprintOrDefault(footprints, id);
    minX = Math.min(minX, point.x - footprint.inkHalfWidth);
    maxX = Math.max(maxX, point.x + footprint.inkHalfWidth);
    minY = Math.min(minY, point.y - footprint.halfHeight);
    maxY = Math.max(maxY, point.y + footprint.labelBottom);
    seen = true;
  }

  return seen ? { minX: minX, minY: minY, maxX: maxX, maxY: maxY } : null;
};

/*
 * Half the painted width of a node, guaranteed positive and finite. Every
 * band width in this file is built out of this number, so one non-finite
 * value would propagate into every ancestor's band and blank the graph:
 * a NaN in an SVG coordinate makes the element vanish and takes the bounds
 * calculation with it.
 */
const inkHalfWidthOf: (
  footprints: Map<string, TopologyNodeFootprint>,
  nodeId: string,
) => number = (
  footprints: Map<string, TopologyNodeFootprint>,
  nodeId: string,
): number => {
  const value: number = footprintOrDefault(footprints, nodeId).inkHalfWidth;
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_FOOTPRINT.inkHalfWidth;
};

/** Role rank per node id, using the tiered layout's already-tested rule. */
const buildTierById: (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  orderedNodeIds: Array<string>,
) => Map<string, number> = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  orderedNodeIds: Array<string>,
): Map<string, number> => {
  const nodeIdsWithFdbEdges: Set<string> = new Set<string>();
  for (const edge of edges || []) {
    if (edge && isFdbEdge(edge)) {
      nodeIdsWithFdbEdges.add(edge.fromNodeId);
      nodeIdsWithFdbEdges.add(edge.toNodeId);
    }
  }

  const nodeById: Map<string, NetworkTopologyNode> = new Map<
    string,
    NetworkTopologyNode
  >();
  for (const node of nodes || []) {
    if (node && typeof node.id === "string" && !nodeById.has(node.id)) {
      nodeById.set(node.id, node);
    }
  }

  const tierById: Map<string, number> = new Map<string, number>();
  for (const id of orderedNodeIds) {
    const node: NetworkTopologyNode | undefined = nodeById.get(id);
    // A position without a node behind it is ranked as an access device.
    tierById.set(id, node ? tierForNode(node, nodeIdsWithFdbEdges) : 1);
  }
  return tierById;
};

/**
 * The hierarchy an operator declared outright, as child → parent.
 *
 * Discovery reports cables, not hierarchies: LLDP tells us two boxes are
 * connected and has no opinion about which one is upstream. Everything
 * below this point is therefore inference — good inference on an SNMP
 * estate, no inference at all on the ping-only devices of issue #3192,
 * whose role nothing can classify and whose neighbours nothing reports.
 * `NetworkDeviceLink.parentDeviceId` and the parent/child labels of a link
 * rule are the operator answering directly, and an answer outranks a
 * guess.
 *
 * Two ways an operator can state something unusable, both resolved here so
 * the traversal downstream can assume a well-formed forest:
 *
 *   - CONTRADICTION. Two links both claiming to be the parent of one
 *     device. Picking between them would be inventing an answer, so both
 *     are dropped and that device falls back to inference — the same
 *     "a wrong cable is worse than a missing one" rule the topology
 *     builder already applies to a match key two devices claim.
 *   - CYCLE. A is B's parent, B is C's, C is A's. There is no tree in
 *     that, and a traversal trusting it would never terminate. The
 *     declarations are applied in canonical child order and any one that
 *     would close a loop is skipped, so the surviving set is always
 *     acyclic and always the same set for the same graph.
 */
export const buildDeclaredParentMap: (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
) => Map<string, string> = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
): Map<string, string> => {
  /*
   * The SAME test canonicalNodeOrder applies, empty-string check included.
   * This map is the only thing in the file that can introduce an id the
   * rest of the pipeline never saw, and a looser filter here would put a
   * node in the forest that is absent from the ordered node list — which
   * then carries a position nothing re-centres and quietly mis-sizes the
   * component hull.
   */
  const knownNodeIds: Set<string> = new Set<string>();
  for (const node of nodes || []) {
    if (node && typeof node.id === "string" && node.id.length > 0) {
      knownNodeIds.add(node.id);
    }
  }

  // child -> every distinct parent claimed for it.
  const claimedParentsByChild: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >();

  for (const edge of edges || []) {
    if (!edge || !edge.parentNodeId) {
      continue;
    }
    const parentId: string = edge.parentNodeId;
    if (parentId !== edge.fromNodeId && parentId !== edge.toNodeId) {
      continue;
    }
    const childId: string =
      parentId === edge.fromNodeId ? edge.toNodeId : edge.fromNodeId;
    if (
      childId === parentId ||
      !knownNodeIds.has(childId) ||
      !knownNodeIds.has(parentId)
    ) {
      continue;
    }
    const claimed: Set<string> =
      claimedParentsByChild.get(childId) || new Set<string>();
    claimed.add(parentId);
    claimedParentsByChild.set(childId, claimed);
  }

  /*
   * Canonical child order, so which declaration loses a cycle is a
   * function of the graph and never of the order the response arrived in.
   */
  const childIds: Array<string> = [...claimedParentsByChild.keys()].sort(
    compareNodeIds,
  );

  const declaredParentOf: Map<string, string> = new Map<string, string>();

  for (const childId of childIds) {
    const claimed: Set<string> = claimedParentsByChild.get(childId)!;
    if (claimed.size !== 1) {
      // Contradiction: two links both claim to parent this device.
      continue;
    }
    const parentId: string = [...claimed][0]!;

    /*
     * Walk up from the proposed parent through what has already been
     * accepted. Reaching the child means this declaration closes a loop.
     * The walk is bounded by the number of accepted declarations, so it
     * terminates even if one ever slipped through.
     */
    let cursor: string | undefined = parentId;
    let createsCycle: boolean = false;
    for (let step: number = 0; step <= declaredParentOf.size; step++) {
      if (cursor === undefined) {
        break;
      }
      if (cursor === childId) {
        createsCycle = true;
        break;
      }
      cursor = declaredParentOf.get(cursor);
    }

    if (!createsCycle) {
      declaredParentOf.set(childId, parentId);
    }
  }

  return declaredParentOf;
};

/**
 * Pick the node a component's tree hangs from.
 *
 * Role first, degree second. This deliberately overrides the component's
 * own `rootId`, which is degree-first: an access switch with forty
 * endpoints out-degrees the router it uplinks to, and rooting there draws
 * the router as a child of the switch — precisely upside down from the
 * hierarchy the reader came here for. Ties fall through to the id so the
 * choice is a function of the graph and never of the response ordering.
 *
 * A device declared to be somebody's child is not a candidate at all: it
 * has a parent by construction, and a root has none. Only if every member
 * is spoken for — which the acyclic guarantee above makes impossible, so
 * this is a belt-and-braces fallback — does the whole component compete.
 *
 * Last of all, BELOW role and below degree, being the top of a declared
 * chain beats losing on the alphabet. Take a switch an operator declared
 * to uplink to a router, on a site cabled to a second router of identical
 * rank and identical degree: rooting at the second router makes the
 * declared parent reachable only THROUGH its own declared child, and the
 * traversal then has to hoist it somewhere it has no cable to. Rooting at
 * the declared parent instead makes the chain fall out naturally, every
 * tree line a real cable.
 *
 * It has to be the LAST word rather than the first. Declaring "this access
 * point hangs off that switch" says nothing whatever about the switch
 * being the top of the site, so a rule that let it outrank role or degree
 * would re-root the map — and re-draw every device on it — off one setting
 * about two of them. Here it only ever displaces the id tiebreak, which is
 * arbitrary by construction and the one thing a declaration is strictly
 * better evidence than.
 */
const chooseTreeRoot: (
  memberIds: Array<string>,
  adjacency: TopologyAdjacency,
  tierById: Map<string, number>,
  declaredParentOf: Map<string, string>,
) => string = (
  memberIds: Array<string>,
  adjacency: TopologyAdjacency,
  tierById: Map<string, number>,
  declaredParentOf: Map<string, string>,
): string => {
  const candidates: Array<string> = memberIds.filter((id: string) => {
    return !declaredParentOf.has(id);
  });
  const pool: Array<string> = candidates.length > 0 ? candidates : memberIds;

  // Ids named as somebody's parent. A pool member in here tops a chain.
  const declaredParentIds: Set<string> = new Set<string>(
    declaredParentOf.values(),
  );

  const rankOf: (id: string) => [number, number, number] = (
    id: string,
  ): [number, number, number] => {
    return [
      tierById.get(id) ?? 1,
      -(adjacency.degreeById.get(id) || 0),
      declaredParentIds.has(id) ? 0 : 1,
    ];
  };

  /*
   * Negative when `a` should win. Every field is "lower is better", and
   * the id has the last word so the choice is a function of the graph and
   * never of the order the response arrived in.
   */
  const compareCandidates: (
    a: string,
    aRank: [number, number, number],
    b: string,
    bRank: [number, number, number],
  ) => number = (
    a: string,
    aRank: [number, number, number],
    b: string,
    bRank: [number, number, number],
  ): number => {
    for (let index: number = 0; index < aRank.length; index++) {
      if (aRank[index]! !== bRank[index]!) {
        return aRank[index]! - bRank[index]!;
      }
    }
    return compareNodeIds(a, b);
  };

  let bestId: string = pool[0]!;
  let bestRank: [number, number, number] = rankOf(bestId);

  for (const id of pool) {
    const rank: [number, number, number] = rankOf(id);
    if (compareCandidates(id, rank, bestId, bestRank) < 0) {
      bestId = id;
      bestRank = rank;
    }
  }
  return bestId;
};

/** BFS depths from `rootId`, plus the order the traversal visited them. */
interface RootedTraversal {
  order: Array<string>;
  depthById: Map<string, number>;
}

const traverseFromRoot: (
  rootId: string,
  adjacency: TopologyAdjacency,
) => RootedTraversal = (
  rootId: string,
  adjacency: TopologyAdjacency,
): RootedTraversal => {
  const depthById: Map<string, number> = new Map<string, number>();
  const order: Array<string> = [rootId];
  depthById.set(rootId, 0);

  /*
   * Neighbour lists are already in canonical id order and the queue drains
   * FIFO, so the traversal — and therefore every depth it assigns — is a
   * function of the graph alone. The read cursor replaces Array.shift so a
   * ten-thousand-device site does not pay a quadratic re-index per pop.
   */
  let head: number = 0;
  while (head < order.length) {
    const current: string = order[head]!;
    head++;
    const depth: number = depthById.get(current)!;
    for (const neighbor of adjacency.neighborsById.get(current) || []) {
      if (!depthById.has(neighbor)) {
        depthById.set(neighbor, depth + 1);
        order.push(neighbor);
      }
    }
  }

  return { order: order, depthById: depthById };
};

/** A component's tree, as parent links rather than coordinates. */
interface RootedTree {
  parentById: Map<string, string>;
  childrenById: Map<string, Array<string>>;
  depthById: Map<string, number>;
}

/**
 * The spanning tree of one component when at least one parent in it was
 * declared.
 *
 * Two passes, and the split is the whole design.
 *
 * PASS ONE fixes every node's DEPTH. It is a BFS in which a device with a
 * declared parent is only ever reached through that parent: met across
 * some other cable it is passed by, and placed later, when its declared
 * parent comes up.
 *
 * That deferral does not always resolve on its own, and assuming it did
 * was this function's original bug. A declared parent can be reachable
 * only THROUGH its own declared child — an operator names a router as a
 * switch's uplink, and that router hangs off nothing else. Then the BFS
 * refuses to cross into the switch, never reaches the router, and both
 * strand. {@link chooseTreeRoot} now prefers the top of a declared chain,
 * which resolves the common shape properly with every tree line still a
 * real cable; `attachStrandedChain` below is what handles the rest.
 *
 * PASS TWO fixes every node's PARENT, and deliberately does NOT reuse
 * pass one's discovery order. A declared child takes its declared parent;
 * every other node takes its canonically-first neighbour exactly one
 * level up — the identical rule `bfsChildrenOf` applies on the inference
 * path, and the rule this file's own contract promises so that the
 * radial and seeding layouts agree about what hangs off what. Parenting
 * by first-discoverer instead (which is what pass one hands you) diverges
 * from that rule below depth two, so declaring a parent on one branch
 * would silently re-parent devices on an unrelated branch of the same
 * site. A setting should change what it describes and nothing else.
 */
const buildRootedTreeWithDeclaredParents: (
  rootId: string,
  memberIds: Array<string>,
  adjacency: TopologyAdjacency,
  declaredParentOf: Map<string, string>,
) => RootedTree = (
  rootId: string,
  memberIds: Array<string>,
  adjacency: TopologyAdjacency,
  declaredParentOf: Map<string, string>,
): RootedTree => {
  const parentById: Map<string, string> = new Map<string, string>();
  const depthById: Map<string, number> = new Map<string, number>();

  // parent -> its declared children, canonical order, for the cascade.
  const declaredChildrenOf: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();
  for (const [childId, parentId] of declaredParentOf) {
    const children: Array<string> = declaredChildrenOf.get(parentId) || [];
    children.push(childId);
    declaredChildrenOf.set(parentId, children);
  }
  for (const [, children] of declaredChildrenOf) {
    children.sort(compareNodeIds);
  }

  const place: (id: string, parentId: string | null) => void = (
    id: string,
    parentId: string | null,
  ): void => {
    if (parentId === null) {
      depthById.set(id, 0);
      return;
    }
    parentById.set(id, parentId);
    depthById.set(id, (depthById.get(parentId) ?? 0) + 1);
  };

  const queue: Array<string> = [];
  let head: number = 0;

  /** Drain the queue, placing declared children first, then neighbours. */
  const drain: () => void = (): void => {
    while (head < queue.length) {
      const current: string = queue[head]!;
      head++;

      /*
       * Declared children first, and placed whether or not the cable
       * between them is in `neighborsById` — a declared link always
       * produces an edge, so it always is, but depending on that would
       * make the hierarchy silently conditional on the edge surviving
       * filtering.
       */
      for (const childId of declaredChildrenOf.get(current) || []) {
        if (!depthById.has(childId)) {
          place(childId, current);
          queue.push(childId);
        }
      }

      for (const neighbor of adjacency.neighborsById.get(current) || []) {
        if (depthById.has(neighbor)) {
          continue;
        }
        const declaredParent: string | undefined =
          declaredParentOf.get(neighbor);
        if (declaredParent !== undefined && declaredParent !== current) {
          // Reached the long way round; it belongs under its declared parent.
          continue;
        }
        place(neighbor, current);
        queue.push(neighbor);
      }
    }
  };

  place(rootId, null);
  queue.push(rootId);
  drain();

  /*
   * Whatever is left is a declared chain the traversal could not enter
   * from above, because the chain's top is cabled only to its own
   * declared descendants. The operator has asked for a hierarchy that
   * runs against the only path into it.
   *
   * The declaration still wins. The chain is hoisted as a whole: its TOP
   * is attached to the canonically-first already-placed neighbour of
   * anything in the chain, and the cascade then runs down from there.
   * That one tree line may not correspond to a cable — the alternative is
   * drawing a declared parent underneath its own child, which is the
   * error the operator set the field to correct.
   *
   * Each round places at least the chain it processes, so this terminates;
   * and because it seeds the same drain(), the work is bounded by the
   * nodes still unplaced rather than by a re-scan per node. The previous
   * sweep re-walked every member on every pass, which on a long stranded
   * path was quadratic — seconds of blocked main thread on a large site,
   * triggered by a single link setting.
   */
  const topOfChain: (id: string) => string = (id: string): string => {
    let cursor: string = id;
    for (let step: number = 0; step <= declaredParentOf.size; step++) {
      const parentId: string | undefined = declaredParentOf.get(cursor);
      if (parentId === undefined || depthById.has(parentId)) {
        return cursor;
      }
      cursor = parentId;
    }
    return cursor;
  };

  /** Every unplaced node at or below `topId` in the declared hierarchy. */
  const declaredChainMembers: (topId: string) => Array<string> = (
    topId: string,
  ): Array<string> => {
    const members: Array<string> = [];
    const stack: Array<string> = [topId];
    const seen: Set<string> = new Set<string>([topId]);
    while (stack.length > 0) {
      const current: string = stack.pop()!;
      members.push(current);
      for (const childId of declaredChildrenOf.get(current) || []) {
        if (!seen.has(childId) && !depthById.has(childId)) {
          seen.add(childId);
          stack.push(childId);
        }
      }
    }
    return members;
  };

  for (const id of memberIds) {
    if (depthById.has(id)) {
      continue;
    }
    const topId: string = topOfChain(id);
    if (depthById.has(topId)) {
      continue;
    }

    /*
     * topOfChain stops either at a node with no declared parent or at one
     * whose declared parent is already placed. In the second case the
     * declaration answers the question outright — no anchor needed, and
     * using one would put the node somewhere other than under the parent
     * an operator named.
     */
    const placedDeclaredParent: string | undefined =
      declaredParentOf.get(topId);
    if (
      placedDeclaredParent !== undefined &&
      depthById.has(placedDeclaredParent)
    ) {
      place(topId, placedDeclaredParent);
      queue.push(topId);
      drain();
      continue;
    }

    let anchorId: string | null = null;
    for (const memberId of declaredChainMembers(topId)) {
      for (const neighbor of adjacency.neighborsById.get(memberId) || []) {
        if (!depthById.has(neighbor)) {
          continue;
        }
        if (anchorId === null || compareNodeIds(neighbor, anchorId) < 0) {
          anchorId = neighbor;
        }
      }
    }

    // No placed neighbour anywhere in the chain: hang it off the root.
    place(topId, anchorId === null ? rootId : anchorId);
    queue.push(topId);
    drain();
  }

  // Belt and braces: nothing may leave this function without a depth.
  for (const id of memberIds) {
    if (!depthById.has(id) && id !== rootId) {
      place(id, rootId);
    }
  }

  /*
   * PASS TWO. Depths are final; re-derive every parent from them so the
   * answer matches bfsChildrenOf exactly wherever nothing was declared.
   * A node with no neighbour one level up keeps the parent pass one gave
   * it — that is the hoisted chain top, whose tree line is not a cable
   * and so cannot be found this way.
   */
  for (const id of memberIds) {
    if (id === rootId || declaredParentOf.has(id)) {
      continue;
    }
    const depth: number | undefined = depthById.get(id);
    if (depth === undefined || depth === 0) {
      continue;
    }
    let bestParent: string | null = null;
    for (const neighbor of adjacency.neighborsById.get(id) || []) {
      if (depthById.get(neighbor) !== depth - 1) {
        continue;
      }
      if (bestParent === null || compareNodeIds(neighbor, bestParent) < 0) {
        bestParent = neighbor;
      }
    }
    if (bestParent !== null) {
      parentById.set(id, bestParent);
    }
  }

  const childrenById: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();
  for (const id of memberIds) {
    childrenById.set(id, []);
  }
  for (const [childId, parentId] of parentById) {
    const children: Array<string> | undefined = childrenById.get(parentId);
    if (children) {
      children.push(childId);
    }
  }
  for (const [, children] of childrenById) {
    children.sort(compareNodeIds);
  }

  return {
    parentById: parentById,
    childrenById: childrenById,
    depthById: depthById,
  };
};

/**
 * Build the parent-child spanning forest of a topology.
 *
 * Each connected component becomes one tree, rooted by role (see
 * {@link chooseTreeRoot}); a node's parent is its canonically-first
 * neighbour exactly one level up, the same rule the radial and seeding
 * layouts already use, so all three agree about what hangs off what. A
 * device with no links at all is a one-node tree rather than a dropped
 * node.
 *
 * Where an operator has DECLARED a parent (see
 * {@link buildDeclaredParentMap}) that declaration is honoured instead of
 * inferred, and the declared child is never rooted. Components containing
 * no declaration take the inference path unchanged.
 *
 * Total: every non-root has exactly one parent, every node has a children
 * entry and a depth, and no node is its own ancestor — parents are always
 * strictly shallower than their children.
 */
export const buildParentChildForest: (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
) => ParentChildForest = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
): ParentChildForest => {
  const orderedNodeIds: Array<string> = canonicalNodeOrder(nodes);
  const adjacency: TopologyAdjacency = buildTopologyAdjacency(nodes, edges);
  const components: Array<TopologyComponent> = findTopologyComponents(
    adjacency,
    orderedNodeIds,
  );
  const tierById: Map<string, number> = buildTierById(
    nodes,
    edges,
    orderedNodeIds,
  );
  const declaredParentOf: Map<string, string> = buildDeclaredParentMap(
    nodes,
    edges,
  );

  const rootIds: Array<string> = [];
  const parentById: Map<string, string> = new Map<string, string>();
  const childrenById: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();
  const depthById: Map<string, number> = new Map<string, number>();

  for (const component of components) {
    if (component.nodeIds.length === 0) {
      continue;
    }
    const rootId: string = chooseTreeRoot(
      component.nodeIds,
      adjacency,
      tierById,
      declaredParentOf,
    );

    /*
     * The declared path is taken only for components that actually contain
     * a declaration. Not an optimisation — it is what guarantees that a
     * project with no declared parents (every project, until somebody sets
     * one) gets byte-identical geometry to before, because it runs exactly
     * the code it ran before.
     */
    const hasDeclaredParent: boolean = component.nodeIds.some((id: string) => {
      return declaredParentOf.has(id);
    });

    if (hasDeclaredParent) {
      const tree: RootedTree = buildRootedTreeWithDeclaredParents(
        rootId,
        component.nodeIds,
        adjacency,
        declaredParentOf,
      );

      rootIds.push(rootId);
      for (const [id, depth] of tree.depthById) {
        depthById.set(id, depth);
      }
      for (const [id, children] of tree.childrenById) {
        childrenById.set(id, children);
      }
      for (const [id, parent] of tree.parentById) {
        parentById.set(id, parent);
      }
      continue;
    }

    const traversal: RootedTraversal = traverseFromRoot(rootId, adjacency);

    /*
     * Re-rooting the component means its own nodeIds/depthById no longer
     * describe this tree, so bfsChildrenOf is handed a component re-stated
     * around the root chosen above.
     */
    const rooted: TopologyComponent = {
      nodeIds: traversal.order,
      rootId: rootId,
      edges: component.edges,
      depthById: traversal.depthById,
    };
    const childrenOfRooted: Map<string, Array<string>> = bfsChildrenOf(
      rooted,
      adjacency,
    );

    rootIds.push(rootId);
    for (const [id, depth] of traversal.depthById) {
      depthById.set(id, depth);
    }
    for (const [id, children] of childrenOfRooted) {
      childrenById.set(id, children);
      // Derived from the child lists so the two can never disagree.
      for (const childId of children) {
        parentById.set(childId, id);
      }
    }
  }

  rootIds.sort(compareNodeIds);

  return {
    rootIds: rootIds,
    parentById: parentById,
    childrenById: childrenById,
    depthById: depthById,
  };
};

/**
 * One tree's members with every parent ahead of its own children.
 *
 * Walked with an explicit stack, never recursion: a two-thousand-device
 * chain of switches is a legal topology and a legal tree of depth two
 * thousand, which is enough to blow the JavaScript stack on a recursive
 * walk and take the whole dashboard down with it.
 */
const orderTreeMembers: (
  rootId: string,
  forest: ParentChildForest,
) => Array<string> = (
  rootId: string,
  forest: ParentChildForest,
): Array<string> => {
  const members: Array<string> = [];
  const stack: Array<string> = [rootId];
  while (stack.length > 0) {
    const current: string = stack.pop()!;
    members.push(current);
    const children: Array<string> = forest.childrenById.get(current) || [];
    // Pushed in reverse so they pop — and therefore draw — left to right.
    for (let index: number = children.length - 1; index >= 0; index--) {
      stack.push(children[index]!);
    }
  }
  return members;
};

/**
 * Tidy-tree placement of one tree, in a band-local space starting at x = 0.
 *
 * `memberIds` must list every parent before its children, which is what
 * {@link orderTreeMembers} guarantees. That ordering is the whole trick
 * here: walked backwards it visits every child before its parent, which is
 * exactly the post-order the band widths need, so neither pass needs
 * recursion or an explicit traversal stack at all.
 */
const layoutTreeBand: (
  rootId: string,
  memberIds: Array<string>,
  forest: ParentChildForest,
  footprints: Map<string, TopologyNodeFootprint>,
) => Map<string, TopologyPoint> = (
  rootId: string,
  memberIds: Array<string>,
  forest: ParentChildForest,
  footprints: Map<string, TopologyNodeFootprint>,
): Map<string, TopologyPoint> => {
  const bandWidthById: Map<string, number> = new Map<string, number>();
  const centreInBandById: Map<string, number> = new Map<string, number>();
  const childBandStartsById: Map<string, Array<number>> = new Map<
    string,
    Array<number>
  >();

  /*
   * Pass one, bottom up: how wide is each subtree, and where in its own
   * band does its node sit.
   */
  for (let index: number = memberIds.length - 1; index >= 0; index--) {
    const id: string = memberIds[index]!;
    const inkHalfWidth: number = inkHalfWidthOf(footprints, id);
    const children: Array<string> = forest.childrenById.get(id) || [];

    if (children.length === 0) {
      bandWidthById.set(id, 2 * inkHalfWidth);
      centreInBandById.set(id, inkHalfWidth);
      childBandStartsById.set(id, []);
      continue;
    }

    const childStarts: Array<number> = [];
    let cursor: number = 0;
    let firstChildCentre: number = 0;
    let lastChildCentre: number = 0;
    children.forEach((childId: string, childIndex: number): void => {
      const childWidth: number = bandWidthById.get(childId) || 0;
      const childCentre: number = cursor + (centreInBandById.get(childId) || 0);
      childStarts.push(cursor);
      if (childIndex === 0) {
        firstChildCentre = childCentre;
      }
      lastChildCentre = childCentre;
      cursor += childWidth + PARENT_CHILD_SIBLING_GAP;
    });
    const childrenExtent: number = cursor - PARENT_CHILD_SIBLING_GAP;
    const desiredCentre: number = (firstChildCentre + lastChildCentre) / 2;

    /*
     * The band has to cover the parent's own ink as well as its children's,
     * and the parent is not necessarily inside the children's extent: a
     * core router with a sixty-pixel label and one narrow endpoint below it
     * wants to sit centred over an eighteen-pixel band, which puts half its
     * label to the left of x = 0 and half past the right edge. Widening the
     * band on both sides (and then shifting it back to start at zero) is
     * what keeps that overhang inside this subtree's own territory instead
     * of letting it paint over the neighbouring branch.
     */
    const bandMin: number = Math.min(0, desiredCentre - inkHalfWidth);
    const bandMax: number = Math.max(
      childrenExtent,
      desiredCentre + inkHalfWidth,
    );
    const shift: number = -bandMin;

    bandWidthById.set(id, bandMax - bandMin);
    centreInBandById.set(id, desiredCentre + shift);
    childBandStartsById.set(
      id,
      childStarts.map((start: number): number => {
        return start + shift;
      }),
    );
  }

  /*
   * Pass two, top down: turn the band offsets into coordinates. Depth
   * alone fixes y, so a child is always exactly one level gap below its
   * parent however wide the tree gets.
   */
  const bandStartById: Map<string, number> = new Map<string, number>();
  bandStartById.set(rootId, 0);
  const local: Map<string, TopologyPoint> = new Map<string, TopologyPoint>();

  for (const id of memberIds) {
    const bandStart: number = bandStartById.get(id) || 0;
    const depth: number = forest.depthById.get(id) || 0;
    local.set(id, {
      x: bandStart + (centreInBandById.get(id) || 0),
      y: PARENT_CHILD_TOP_MARGIN + depth * PARENT_CHILD_LEVEL_GAP,
    });

    const children: Array<string> = forest.childrenById.get(id) || [];
    const childStarts: Array<number> = childBandStartsById.get(id) || [];
    children.forEach((childId: string, childIndex: number): void => {
      bandStartById.set(childId, bandStart + (childStarts[childIndex] || 0));
    });
  }

  return local;
};

/**
 * Compute the parent-child topology layout.
 *
 * Pure and deterministic: the same graph always produces the same
 * coordinates, whatever order its nodes and edges arrive in.
 *
 * `pinned` carries positions the user established by dragging. They are
 * applied last and win outright — the point of dragging a device is that
 * it stays where you put it — and are still counted in the reported
 * content extent so fit-to-view cannot leave one off screen.
 */
export const computeParentChildTopologyModel: (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  width: number,
  height: number,
  pinned?: ReadonlyMap<string, TopologyPoint> | undefined,
) => TopologyLayoutModel = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  width: number,
  height: number,
  pinned?: ReadonlyMap<string, TopologyPoint> | undefined,
): TopologyLayoutModel => {
  const positions: Map<string, TopologyPoint> = new Map<
    string,
    TopologyPoint
  >();
  const componentBoxes: Array<TopologyComponentBox> = [];
  const orderedNodeIds: Array<string> = canonicalNodeOrder(nodes);

  const frameWidth: number = Number.isFinite(width) && width > 0 ? width : 1000;
  const frameHeight: number =
    Number.isFinite(height) && height > 0 ? height : 700;

  if (orderedNodeIds.length === 0) {
    return {
      positions: positions,
      componentBoxes: componentBoxes,
      groups: [],
      contentWidth: frameWidth,
      contentHeight: frameHeight,
    };
  }

  const adjacency: TopologyAdjacency = buildTopologyAdjacency(nodes, edges);
  const footprints: Map<string, TopologyNodeFootprint> = buildFootprints(nodes);
  const forest: ParentChildForest = buildParentChildForest(nodes, edges);

  /*
   * Devices with no links at all get their own strip rather than a place
   * in the packing — a lone one-node "tree" is not a hierarchy, and
   * scattering forty of them through the map buries the actual structure.
   * Presented exactly as the force layout presents its strip so the two
   * modes read the same.
   */
  const linkedRootIds: Array<string> = [];
  const unlinkedIds: Array<string> = [];
  const membersByRoot: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();
  for (const rootId of forest.rootIds) {
    const members: Array<string> = orderTreeMembers(rootId, forest);
    membersByRoot.set(rootId, members);
    const isIsolated: boolean =
      members.length === 1 && (adjacency.degreeById.get(rootId) || 0) === 0;
    if (isIsolated) {
      unlinkedIds.push(rootId);
    } else {
      linkedRootIds.push(rootId);
    }
  }

  // Lay each tree out in its own band-local coordinate space.
  const localPositions: Array<Map<string, TopologyPoint>> = [];
  const localBoxes: Array<ParentChildInkBox> = [];
  for (const rootId of linkedRootIds) {
    const members: Array<string> = membersByRoot.get(rootId) || [];
    const local: Map<string, TopologyPoint> = layoutTreeBand(
      rootId,
      members,
      forest,
      footprints,
    );
    const box: ParentChildInkBox = inkBoxFor(members, local, footprints) || {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
    };
    localPositions.push(local);
    localBoxes.push(box);
  }

  /*
   * Each tree's band is one box for the shared shelf packer, ordered by
   * ROOT ID rather than by the packer's usual decreasing height.
   *
   * A tidy tree's height is a quantized function of its depth: one newly
   * discovered POS terminal deepens its tree by a whole level gap, and
   * under a height-ordered pack that is enough to make two side-by-side
   * trees trade ends of the map — every node in both of them moving,
   * sixty seconds after the last poll, because one till came online. The
   * same goes for width, which steps whenever a switch gains a sibling.
   * Neither is a fact about the tree's identity, and the reader's mental
   * map of "the warehouse is on the left" is worth more than the shelf
   * space decreasing height would save.
   */
  const packInputs: Array<PackInput> = linkedRootIds.map(
    (rootId: string, index: number): PackInput => {
      const box: ParentChildInkBox = localBoxes[index]!;
      return {
        width: box.maxX - box.minX,
        height: box.maxY - box.minY,
        key: rootId,
      };
    },
  );
  const packed: PackResult = packComponentBoxes(
    packInputs,
    Math.max(1, frameWidth - 2 * PARENT_CHILD_LAYOUT_MARGIN),
    PARENT_CHILD_TREE_GAP,
    "key",
  );

  linkedRootIds.forEach((rootId: string, index: number): void => {
    const local: Map<string, TopologyPoint> = localPositions[index]!;
    const box: ParentChildInkBox = localBoxes[index]!;
    const slot: PackedBox = packed.placements[index]!;
    const offsetX: number = slot.x - box.minX;
    const offsetY: number = slot.y - box.minY;
    const members: Array<string> = membersByRoot.get(rootId) || [];
    for (const nodeId of members) {
      const point: TopologyPoint = local.get(nodeId) || { x: 0, y: 0 };
      positions.set(nodeId, { x: point.x + offsetX, y: point.y + offsetY });
    }
    componentBoxes.push({
      key: rootId,
      nodeIds: members.slice(),
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
      nodeCount: members.length,
      isUnlinked: false,
    });
  });

  // The unlinked strip: a wrapped grid under everything else.
  if (unlinkedIds.length > 0) {
    const usableWidth: number = Math.max(
      UNLINKED_STRIP_PITCH_X,
      Math.max(frameWidth - 2 * PARENT_CHILD_LAYOUT_MARGIN, packed.width),
    );
    const perRow: number = Math.max(
      1,
      Math.floor(usableWidth / UNLINKED_STRIP_PITCH_X),
    );
    const rows: number = Math.ceil(unlinkedIds.length / perRow);
    const stripTop: number =
      packed.height > 0 ? packed.height + UNLINKED_STRIP_TOP_GAP : 0;

    let stripMaxX: number = 0;
    unlinkedIds.forEach((nodeId: string, index: number): void => {
      const row: number = Math.floor(index / perRow);
      const column: number = index % perRow;
      const x: number =
        column * UNLINKED_STRIP_PITCH_X + UNLINKED_STRIP_PITCH_X / 2;
      const y: number =
        stripTop + row * UNLINKED_STRIP_PITCH_Y + UNLINKED_STRIP_PITCH_Y / 2;
      positions.set(nodeId, { x: x, y: y });
      stripMaxX = Math.max(stripMaxX, x);
    });

    const stripBox: ParentChildInkBox = inkBoxFor(
      unlinkedIds,
      positions,
      footprints,
    ) || {
      minX: 0,
      minY: stripTop,
      maxX: stripMaxX,
      maxY: stripTop + rows * UNLINKED_STRIP_PITCH_Y,
    };
    componentBoxes.push({
      key: UNLINKED_BOX_KEY,
      nodeIds: unlinkedIds.slice(),
      x: stripBox.minX,
      y: stripBox.minY,
      width: stripBox.maxX - stripBox.minX,
      height: stripBox.maxY - stripBox.minY,
      nodeCount: unlinkedIds.length,
      isUnlinked: true,
    });
  }

  /*
   * Centre the PAINTED extent, not the box of node centres: glyphs and
   * labels are a fixed size in viewBox units, so a tree measured by its
   * centres sits visibly high in its card by half a label height. The
   * layout is never scaled to fit — the viewport zooms instead, which is
   * the only way to keep the level gap meaning what it says.
   */
  const finalBox: ParentChildInkBox = inkBoxFor(
    orderedNodeIds,
    positions,
    footprints,
  ) || { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const spanX: number = finalBox.maxX - finalBox.minX;
  const spanY: number = finalBox.maxY - finalBox.minY;
  const contentWidth: number = Math.max(
    frameWidth,
    spanX + 2 * PARENT_CHILD_LAYOUT_MARGIN,
  );
  const contentHeight: number = Math.max(
    frameHeight,
    spanY + 2 * PARENT_CHILD_LAYOUT_MARGIN,
  );
  const originX: number = (contentWidth - spanX) / 2 - finalBox.minX;
  const originY: number = (contentHeight - spanY) / 2 - finalBox.minY;

  for (const nodeId of orderedNodeIds) {
    const point: TopologyPoint | undefined = positions.get(nodeId);
    if (!point) {
      continue;
    }
    positions.set(nodeId, { x: point.x + originX, y: point.y + originY });
  }

  /*
   * Re-derive each hull from where its members actually ended up rather
   * than translating the box it had before, so the outline stays snug
   * against the tree it describes.
   */
  for (const box of componentBoxes) {
    const memberBox: ParentChildInkBox | null = inkBoxFor(
      box.nodeIds,
      positions,
      footprints,
    );
    if (!memberBox) {
      continue;
    }
    box.x = memberBox.minX;
    box.y = memberBox.minY;
    box.width = memberBox.maxX - memberBox.minX;
    box.height = memberBox.maxY - memberBox.minY;
  }

  // Pins last, and bit for bit: a dragged device stays where it was dropped.
  let pinnedMaxX: number = -Infinity;
  let pinnedMaxY: number = -Infinity;
  if (pinned && pinned.size > 0) {
    for (const nodeId of orderedNodeIds) {
      const point: TopologyPoint | undefined = pinned.get(nodeId);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        continue;
      }
      positions.set(nodeId, { x: point.x, y: point.y });
      const footprint: TopologyNodeFootprint = footprintOrDefault(
        footprints,
        nodeId,
      );
      pinnedMaxX = Math.max(pinnedMaxX, point.x + footprint.inkHalfWidth);
      pinnedMaxY = Math.max(pinnedMaxY, point.y + footprint.labelBottom);
    }
  }

  return {
    positions: positions,
    componentBoxes: componentBoxes,
    groups: [],
    contentWidth: Number.isFinite(pinnedMaxX)
      ? Math.max(contentWidth, pinnedMaxX + PARENT_CHILD_LAYOUT_MARGIN)
      : contentWidth,
    contentHeight: Number.isFinite(pinnedMaxY)
      ? Math.max(contentHeight, pinnedMaxY + PARENT_CHILD_LAYOUT_MARGIN)
      : contentHeight,
  };
};
