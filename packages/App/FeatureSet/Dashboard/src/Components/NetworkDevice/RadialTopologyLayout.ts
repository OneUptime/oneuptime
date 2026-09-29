import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { isFdbEdge } from "./EndpointNodeUtil";
import {
  TopologyNodeFootprint,
  buildFootprints,
  footprintOrDefault,
} from "./TopologyFootprint";
import {
  TopologyAdjacency,
  TopologyPoint,
  buildTopologyAdjacency,
  canonicalNodeOrder,
  compareNodeIds,
} from "./TopologyGraphUtil";
import { TopologyComponentBox, TopologyLayoutModel } from "./TopologyModel";
import { tierForNode } from "./TopologyLayout";

/*
 * Radial layout: routers at the centre, switches around them, endpoints
 * on the rim.
 *
 * Offered as an alternative to the force layout because the two answer
 * different questions. Force answers "what is the shape of this network"
 * and is the right default. Radial answers "what hangs off what", which
 * is the question an engineer has when something is down — and it answers
 * it with a picture whose structure is guaranteed rather than emergent:
 * every link is a radial spoke, wedges never overlap, and because a
 * child's wedge is always contained in its parent's, spokes cannot cross.
 *
 * No simulation, so it is exact, instant and trivially deterministic.
 */

/** Minimum centre-to-centre distance between two rings. */
export const RADIAL_RING_MIN_GAP: number = 130;
/** Clearance between two neighbours on the same ring. */
export const RADIAL_SLOT_PADDING: number = 16;
export const RADIAL_LAYOUT_MARGIN: number = 48;
/*
 * Where the first ring starts when several nodes share the innermost
 * rank. A single core device sits dead centre instead.
 */
export const RADIAL_CORE_RADIUS: number = 90;

interface RadialNode {
  id: string;
  rank: number;
  weight: number;
  children: Array<string>;
}

/**
 * Compute a role-ranked radial layout.
 *
 * Ranks come from the tiered layout's already-tested {@link tierForNode},
 * shifted so the innermost rank actually present sits at the centre — a
 * site with no router should not render a hole where one would go.
 */
export const computeRadialTopologyModel: (
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
  const orderedNodeIds: Array<string> = canonicalNodeOrder(nodes);

  const frameWidth: number = Number.isFinite(width) && width > 0 ? width : 1000;
  const frameHeight: number =
    Number.isFinite(height) && height > 0 ? height : 700;

  if (orderedNodeIds.length === 0) {
    return {
      positions: positions,
      componentBoxes: [],
      groups: [],
      contentWidth: frameWidth,
      contentHeight: frameHeight,
    };
  }

  const adjacency: TopologyAdjacency = buildTopologyAdjacency(nodes, edges);
  const footprints: Map<string, TopologyNodeFootprint> = buildFootprints(nodes);

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

  const rawRankById: Map<string, number> = new Map<string, number>();
  for (const id of orderedNodeIds) {
    const node: NetworkTopologyNode | undefined = nodeById.get(id);
    rawRankById.set(id, node ? tierForNode(node, nodeIdsWithFdbEdges) : 1);
  }

  /*
   * A parent DECLARED on an FDB edge outranks the role rank.
   *
   * tierForNode ranks every managed device that is not core at 1, and a
   * switch is rank 1 too. That is right for a census — an access point
   * and the switch it uplinks to are both access-layer — but this layout
   * draws parentage, and its parent rule below is "the neighbour exactly
   * one rank inward". A ping-only register (issue #3489) whose only link
   * is the FDB edge to the switch that learned its MAC has no neighbour
   * one rank inward, so it became a root of its own wedge and was drawn
   * ON the switch ring, as though it were a second switch nobody had
   * cabled — the one picture this mode exists to never draw.
   *
   * The builder stamps parentNodeId on that edge exactly when the far end
   * hangs off the switch (a register, a phone, a camera; never a router
   * or another switch, whose MAC a switch learns on the uplink). Where it
   * has, the child is pushed to the ring outside its declared parent, and
   * the ordinary rule then finds the switch one rank in and hangs the
   * device off it. Either end may be the declared one: a link the
   * operator drew from the register to the switch merges with the FDB
   * row and keeps its own from/to, and the statement means the same thing
   * read from either end.
   *
   * Parent ranks are read from the RAW map and the result written to a
   * separate one: a single pass, a function of the graph rather than of
   * the order the edges arrived in, and — with no adjusted rank ever
   * feeding a later edge — nothing that can chase its own tail on a
   * malformed declaration. The price is that a declared CHAIN (a switch
   * adopted by a switch, itself adopting a register) moves each child
   * one ring past where its parent was, not where it ends up. The
   * parent-child layout builds a real tree and is the mode that draws
   * such a chain in full.
   *
   * Only FDB edges are read. A manual link's declared parent already
   * shapes the parent-child layout, and honouring it here would move
   * every radial map that has one; this pass exists for the edge that
   * had no layout behaviour before it, and changes nothing else.
   */
  /*
   * Two more refusals, both about a child that is itself a learner.
   *
   * The parent honoured here is the one the TABLE implied - the learner
   * end, which the builder declares exactly when the far end hangs off it.
   * A parent somebody declared on a hand-drawn link or a rule is kept by
   * the builder over the table's, and may point the other way (the
   * firewall above the switch that learned its MAC); pushing the switch
   * out on that account would put it on its own endpoints' ring. And a
   * child that has learned things of its own - a switch with endpoints,
   * whatever declared it - keeps its ring for the same reason: its
   * endpoints sit one ring out at a fixed rank, and moving the switch out
   * to join them orphans every one of them.
   */
  const learnerIds: Set<string> = new Set<string>();
  for (const edge of edges || []) {
    if (edge && isFdbEdge(edge)) {
      learnerIds.add(edge.learnedByNodeId || edge.fromNodeId);
    }
  }

  const rankById: Map<string, number> = new Map<string, number>(rawRankById);
  for (const edge of edges || []) {
    if (!edge || !isFdbEdge(edge) || !edge.parentNodeId) {
      continue;
    }
    const parentId: string = edge.parentNodeId;
    if (parentId !== edge.fromNodeId && parentId !== edge.toNodeId) {
      continue;
    }
    if (parentId !== (edge.learnedByNodeId || edge.fromNodeId)) {
      continue;
    }
    const childId: string =
      parentId === edge.fromNodeId ? edge.toNodeId : edge.fromNodeId;
    if (learnerIds.has(childId)) {
      continue;
    }
    const parentRank: number | undefined = rawRankById.get(parentId);
    const childRank: number | undefined = rankById.get(childId);
    if (
      childId === parentId ||
      parentRank === undefined ||
      childRank === undefined
    ) {
      continue;
    }
    if (childRank <= parentRank) {
      rankById.set(childId, parentRank + 1);
    }
  }

  let minRank: number = Number.POSITIVE_INFINITY;
  for (const rank of rankById.values()) {
    minRank = Math.min(minRank, rank);
  }

  const radialById: Map<string, RadialNode> = new Map<string, RadialNode>();
  let maxRank: number = 0;
  for (const id of orderedNodeIds) {
    const rank: number = (rankById.get(id) || 0) - minRank;
    maxRank = Math.max(maxRank, rank);
    radialById.set(id, { id: id, rank: rank, weight: 1, children: [] });
  }

  /*
   * A node's parent is its canonically-first neighbour exactly one rank
   * inward. Nodes with none — an unattached endpoint, a switch whose
   * router is out of view — become roots of their own wedge, so they stay
   * visible instead of being dropped.
   */
  const roots: Array<string> = [];
  for (const id of orderedNodeIds) {
    const self: RadialNode = radialById.get(id)!;
    if (self.rank === 0) {
      roots.push(id);
      continue;
    }
    let parentId: string | null = null;
    for (const neighborId of adjacency.neighborsById.get(id) || []) {
      const neighbor: RadialNode | undefined = radialById.get(neighborId);
      if (!neighbor || neighbor.rank !== self.rank - 1) {
        continue;
      }
      if (parentId === null || compareNodeIds(neighborId, parentId) < 0) {
        parentId = neighborId;
      }
    }
    if (parentId === null) {
      roots.push(id);
    } else {
      radialById.get(parentId)!.children.push(id);
    }
  }
  roots.sort(compareNodeIds);
  for (const [, radial] of radialById) {
    radial.children.sort(compareNodeIds);
  }

  /*
   * Subtree weight, computed from the outermost rank inward. A switch
   * with forty endpoints needs forty times the wedge of one with a single
   * endpoint, or the endpoints pile up on top of each other while the
   * quiet switch keeps a quarter of the circle to itself.
   */
  const byRankDescending: Array<string> = orderedNodeIds
    .slice()
    .sort((a: string, b: string): number => {
      const rankDelta: number =
        radialById.get(b)!.rank - radialById.get(a)!.rank;
      return rankDelta === 0 ? compareNodeIds(a, b) : rankDelta;
    });
  for (const id of byRankDescending) {
    const radial: RadialNode = radialById.get(id)!;
    let childWeight: number = 0;
    for (const childId of radial.children) {
      childWeight += radialById.get(childId)!.weight;
    }
    radial.weight = Math.max(1, childWeight);
  }

  interface WedgeAssignment {
    nodeId: string;
    start: number;
    end: number;
  }

  /*
   * Pass one: angles.
   *
   * A parent's wedge is split among its children half evenly and half by
   * subtree weight. Pure weighting is what a radial tree layout usually
   * does, but here it is wrong at the top: a router carrying four
   * switches and twenty-four endpoints would take 24/27ths of the circle
   * and squeeze three unrelated access points into four degrees each,
   * where they overlap. Pure evenness is also wrong — it gives the
   * twenty-four-endpoint subtree no more room than a bare access point.
   * The blend guarantees every child at least half of an even share while
   * still letting a heavy subtree claim most of the space.
   */
  const wedgeById: Map<string, WedgeAssignment> = new Map<
    string,
    WedgeAssignment
  >();

  const shareOf: (
    memberIds: Array<string>,
    index: number,
    totalWeight: number,
  ) => number = (
    memberIds: Array<string>,
    index: number,
    totalWeight: number,
  ): number => {
    const even: number = 1 / memberIds.length;
    const weighted: number =
      radialById.get(memberIds[index]!)!.weight / Math.max(1, totalWeight);
    return 0.5 * even + 0.5 * weighted;
  };

  let rootWeight: number = 0;
  for (const rootId of roots) {
    rootWeight += radialById.get(rootId)!.weight;
  }

  const queue: Array<WedgeAssignment> = [];
  let cursor: number = 0;
  roots.forEach((rootId: string, index: number): void => {
    const span: number = shareOf(roots, index, rootWeight) * Math.PI * 2;
    const wedge: WedgeAssignment = {
      nodeId: rootId,
      start: cursor,
      end: cursor + span,
    };
    wedgeById.set(rootId, wedge);
    queue.push(wedge);
    cursor += span;
  });

  while (queue.length > 0) {
    const current: WedgeAssignment = queue.shift()!;
    const radial: RadialNode = radialById.get(current.nodeId)!;
    if (radial.children.length === 0) {
      continue;
    }
    let childTotal: number = 0;
    for (const childId of radial.children) {
      childTotal += radialById.get(childId)!.weight;
    }
    const parentSpan: number = current.end - current.start;
    let childCursor: number = current.start;
    radial.children.forEach((childId: string, index: number): void => {
      const span: number =
        shareOf(radial.children, index, childTotal) * parentSpan;
      const wedge: WedgeAssignment = {
        nodeId: childId,
        start: childCursor,
        end: childCursor + span,
      };
      wedgeById.set(childId, wedge);
      queue.push(wedge);
      childCursor += span;
    });
  }

  /*
   * Pass two: radii, derived from the angles rather than guessed ahead of
   * them. A ring is pushed out until the NARROWEST wedge on it is wide
   * enough for that node's own painted width. Two neighbours on a ring
   * therefore cannot overlap by construction — which is the whole reason
   * to offer a radial mode next to a force-directed one.
   */
  const radiusByRank: Array<number> = new Array<number>(maxRank + 1).fill(0);
  for (let rank: number = 0; rank <= maxRank; rank++) {
    let needed: number = 0;
    let membersOnRing: number = 0;
    for (const id of orderedNodeIds) {
      if (radialById.get(id)!.rank !== rank) {
        continue;
      }
      membersOnRing++;
      const wedge: WedgeAssignment | undefined = wedgeById.get(id);
      const span: number = wedge ? wedge.end - wedge.start : Math.PI * 2;
      const width: number =
        footprintOrDefault(footprints, id).inkHalfWidth * 2 +
        RADIAL_SLOT_PADDING;
      if (span > 1e-9) {
        needed = Math.max(needed, width / span);
      }
    }
    if (rank === 0) {
      radiusByRank[0] =
        membersOnRing <= 1 ? 0 : Math.max(RADIAL_CORE_RADIUS, needed);
      continue;
    }
    radiusByRank[rank] = Math.max(
      needed,
      radiusByRank[rank - 1]! + RADIAL_RING_MIN_GAP,
    );
  }

  for (const id of orderedNodeIds) {
    const wedge: WedgeAssignment | undefined = wedgeById.get(id);
    const radial: RadialNode = radialById.get(id)!;
    const angle: number = wedge ? (wedge.start + wedge.end) / 2 : 0;
    const radius: number = radiusByRank[radial.rank]!;
    positions.set(id, {
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  }

  // Translate the painted extent to the origin, then centre it.
  let minX: number = Infinity;
  let minY: number = Infinity;
  let maxX: number = -Infinity;
  let maxY: number = -Infinity;
  for (const id of orderedNodeIds) {
    const point: TopologyPoint | undefined = positions.get(id);
    if (!point) {
      continue;
    }
    const footprint: TopologyNodeFootprint = footprintOrDefault(footprints, id);
    minX = Math.min(minX, point.x - footprint.inkHalfWidth);
    maxX = Math.max(maxX, point.x + footprint.inkHalfWidth);
    minY = Math.min(minY, point.y - footprint.halfHeight);
    maxY = Math.max(maxY, point.y + footprint.labelBottom);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }

  const spanX: number = maxX - minX;
  const spanY: number = maxY - minY;
  const contentWidth: number = Math.max(
    frameWidth,
    spanX + 2 * RADIAL_LAYOUT_MARGIN,
  );
  const contentHeight: number = Math.max(
    frameHeight,
    spanY + 2 * RADIAL_LAYOUT_MARGIN,
  );
  const offsetX: number = (contentWidth - spanX) / 2 - minX;
  const offsetY: number = (contentHeight - spanY) / 2 - minY;

  for (const id of orderedNodeIds) {
    const point: TopologyPoint | undefined = positions.get(id);
    if (point) {
      positions.set(id, { x: point.x + offsetX, y: point.y + offsetY });
    }
  }

  const componentBoxes: Array<TopologyComponentBox> = [];
  let pinnedMaxX: number = -Infinity;
  let pinnedMaxY: number = -Infinity;
  if (pinned && pinned.size > 0) {
    for (const id of orderedNodeIds) {
      const point: TopologyPoint | undefined = pinned.get(id);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        continue;
      }
      positions.set(id, { x: point.x, y: point.y });
      const footprint: TopologyNodeFootprint = footprintOrDefault(
        footprints,
        id,
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
      ? Math.max(contentWidth, pinnedMaxX + RADIAL_LAYOUT_MARGIN)
      : contentWidth,
    contentHeight: Number.isFinite(pinnedMaxY)
      ? Math.max(contentHeight, pinnedMaxY + RADIAL_LAYOUT_MARGIN)
      : contentHeight,
  };
};
