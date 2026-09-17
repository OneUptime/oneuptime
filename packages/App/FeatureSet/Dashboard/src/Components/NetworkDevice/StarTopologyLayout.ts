import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { isEndpointNode, isFdbEdge } from "./EndpointNodeUtil";
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

/*
 * Star layout: one hub dead centre, everything else on a ring per hop.
 *
 * This is deliberately NOT the radial layout, even though both draw
 * circles. Radial ranks a node by its ROLE — routers inside, switches
 * next, endpoints on the rim — so two devices land on the same ring
 * because they are the same kind of box, however far apart they are on
 * the wire. Star ranks a node by its DISTANCE FROM ONE CHOSEN HUB, so a
 * ring means "this many hops from the core" and nothing else.
 *
 * The two therefore answer different questions. Radial answers "what
 * hangs off what". Star answers "what hangs off THIS, and how far away is
 * it" — the hub-and-spoke picture an operator draws on a whiteboard when
 * asked to explain a site: the router in the middle, its switches around
 * it, their devices beyond. When the hub is the thing that just went
 * down, the ring a node sits on is exactly the blast radius.
 *
 * Like radial, no simulation: angles come from wedge subdivision and
 * radii are derived from those angles, so the result is exact, instant,
 * and a pure function of the graph.
 */

/** Hub centre to the first ring. */
export const STAR_HUB_RING_GAP: number = 150;
/** Centre-to-centre distance between two consecutive rings. */
export const STAR_RING_MIN_GAP: number = 120;
/** Clearance between two neighbours sitting on the same ring. */
export const STAR_SLOT_PADDING: number = 18;
export const STAR_LAYOUT_MARGIN: number = 48;

/*
 * Wedge spans below this are treated as zero when sizing a ring: dividing
 * a node's painted width by a span of ~1e-12 produces a radius no screen
 * and no float can honour, and the node it would have spaced is invisible
 * at that angular size anyway.
 */
const STAR_MIN_WEDGE_SPAN: number = 1e-9;

const TWO_PI: number = Math.PI * 2;

interface StarNode {
  id: string;
  /** BFS hops from the hub; the hub is 0. */
  ring: number;
  weight: number;
  children: Array<string>;
}

interface StarWedge {
  nodeId: string;
  start: number;
  end: number;
}

/** First occurrence of each id wins, so a duplicated row cannot shadow. */
const indexNodesById: (
  nodes: Array<NetworkTopologyNode>,
) => Map<string, NetworkTopologyNode> = (
  nodes: Array<NetworkTopologyNode>,
): Map<string, NetworkTopologyNode> => {
  const nodeById: Map<string, NetworkTopologyNode> = new Map<
    string,
    NetworkTopologyNode
  >();
  for (const node of nodes || []) {
    if (node && typeof node.id === "string" && !nodeById.has(node.id)) {
      nodeById.set(node.id, node);
    }
  }
  return nodeById;
};

/** Ids of every node touched by at least one FDB edge. */
const collectFdbNodeIds: (edges: Array<NetworkTopologyEdge>) => Set<string> = (
  edges: Array<NetworkTopologyEdge>,
): Set<string> => {
  const nodeIdsWithFdbEdges: Set<string> = new Set<string>();
  for (const edge of edges || []) {
    if (edge && isFdbEdge(edge)) {
      nodeIdsWithFdbEdges.add(edge.fromNodeId);
      nodeIdsWithFdbEdges.add(edge.toNodeId);
    }
  }
  return nodeIdsWithFdbEdges;
};

/**
 * True for a link a device reported about ITSELF over LLDP or CDP, as
 * opposed to a MAC address its bridge happened to learn. Edges from older
 * payloads carry no protocols at all and were only ever discovery links.
 */
const isDiscoveryEdge: (edge: NetworkTopologyEdge) => boolean = (
  edge: NetworkTopologyEdge,
): boolean => {
  if (!edge.protocols || edge.protocols.length === 0) {
    return true;
  }
  return edge.protocols.includes("lldp") || edge.protocols.includes("cdp");
};

/**
 * Distinct discovery-protocol neighbours per node — the count of other
 * network devices this one is actually cabled to, with learned endpoints
 * left out. Deduped per pair, so a link reported by both LLDP and CDP, or
 * from both ends, counts once.
 */
const collectDiscoveryDegrees: (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
) => Map<string, number> = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
): Map<string, number> => {
  const known: Set<string> = new Set<string>(canonicalNodeOrder(nodes));
  const neighborsById: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >();

  const link: (self: string, other: string) => void = (
    self: string,
    other: string,
  ): void => {
    const existing: Set<string> | undefined = neighborsById.get(self);
    if (existing) {
      existing.add(other);
      return;
    }
    neighborsById.set(self, new Set<string>([other]));
  };

  for (const edge of edges || []) {
    if (!edge || !isDiscoveryEdge(edge)) {
      continue;
    }
    const from: string = edge.fromNodeId;
    const to: string = edge.toNodeId;
    if (!known.has(from) || !known.has(to) || from === to) {
      continue;
    }
    link(from, to);
    link(to, from);
  }

  const degreeById: Map<string, number> = new Map<string, number>();
  for (const [id, neighbors] of neighborsById) {
    degreeById.set(id, neighbors.size);
  }
  return degreeById;
};

/**
 * What KIND of thing a hub candidate is, before any measure of how busy
 * it is: managed devices first, then unmanaged discovery peers, then
 * endpoints.
 *
 * Deliberately NOT {@link tierForNode}, which the tiered and radial
 * layouts use: that rule demotes a managed device to the switch tier the
 * moment it appears in one FDB row, which is the right call for a layout
 * that BANDS by role and the wrong one for choosing a centre. A core
 * router learns a directly-attached host the day someone plugs a laptop
 * into it, and if that single row could drop it out of the candidate tier
 * the centre of the map would jump to an access switch on the next poll.
 */
const hubRoleRank: (node: NetworkTopologyNode) => number = (
  node: NetworkTopologyNode,
): number => {
  if (isEndpointNode(node)) {
    return 2;
  }
  return node.isManaged ? 0 : 1;
};

/** One node measured against every signal the hub choice reads. */
interface StarHubCandidate {
  id: string;
  role: number;
  discoveryDegree: number;
  /** 1 when the node appears in an FDB row, so ties prefer 0. */
  fdbRank: number;
  degree: number;
}

/**
 * Total order on hub candidates: better sorts first, and no two distinct
 * candidates ever compare equal.
 */
const compareStarHubCandidates: (
  a: StarHubCandidate,
  b: StarHubCandidate,
) => number = (a: StarHubCandidate, b: StarHubCandidate): number => {
  if (a.role !== b.role) {
    return a.role - b.role;
  }
  if (a.discoveryDegree !== b.discoveryDegree) {
    return b.discoveryDegree - a.discoveryDegree;
  }
  if (a.fdbRank !== b.fdbRank) {
    return a.fdbRank - b.fdbRank;
  }
  if (a.degree !== b.degree) {
    return b.degree - a.degree;
  }
  return compareNodeIds(a.id, b.id);
};

/**
 * Choose the node the star is drawn around.
 *
 * Three rules, in this order, and the order is the whole design:
 *
 * CONNECTED FIRST. A candidate with no links at all cannot be the middle
 * of anything — every other node would be an unreachable island fanned
 * onto one ring around a device none of them is cabled to, and since star
 * publishes no component hulls nothing on screen would say so. A spare
 * switch racked and polled but not yet patched is an ordinary thing to
 * find in a site, so this is not a corner case. Only when the graph has
 * no edges whatsoever does an unlinked node become eligible.
 *
 * ROLE SECOND. An access switch with forty endpoints hanging off it
 * out-degrees the router it uplinks to by an order of magnitude, so a
 * pure highest-degree pick would enthrone the switch and push the router
 * out to ring one. Nobody draws a site that way — the hub of a site is
 * its core device, and every ring reads as "hops from the core" only if
 * the core is what sits in the middle.
 *
 * CABLING THIRD. Within one role the ranking is by DISCOVERY-protocol
 * neighbours — how many other network devices this one is cabled to —
 * rather than by raw degree. Raw degree counts learned MAC addresses,
 * which is a number an access switch always wins and which changes every
 * time a till is switched on. Discovery neighbours change when someone
 * patches a cable, which is exactly when the centre of the map should be
 * allowed to move. "Has any FDB row at all" then separates a router from
 * a switch of otherwise equal cabling, and raw degree and the node id
 * settle whatever is left, so the choice is always a function of the
 * graph and never of the row order the poll returned.
 *
 * Endpoints are excluded from the candidate set outright (a POS terminal
 * is never the middle of anything), unless the graph is nothing but
 * endpoints, in which case they are all we have to choose from.
 *
 * Returns null only for an empty or absent node list.
 */
export const selectStarHubNodeId: (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
) => string | null = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
): string | null => {
  const orderedNodeIds: Array<string> = canonicalNodeOrder(nodes);
  if (orderedNodeIds.length === 0) {
    return null;
  }

  const nodeById: Map<string, NetworkTopologyNode> = indexNodesById(nodes);
  const nodeIdsWithFdbEdges: Set<string> = collectFdbNodeIds(edges);
  const adjacency: TopologyAdjacency = buildTopologyAdjacency(nodes, edges);
  const discoveryDegreeById: Map<string, number> = collectDiscoveryDegrees(
    nodes,
    edges,
  );

  const nonEndpointIds: Array<string> = orderedNodeIds.filter(
    (id: string): boolean => {
      const node: NetworkTopologyNode | undefined = nodeById.get(id);
      return !node || !isEndpointNode(node);
    },
  );
  const candidates: Array<string> =
    nonEndpointIds.length > 0 ? nonEndpointIds : orderedNodeIds;
  const linkedCandidates: Array<string> = candidates.filter(
    (id: string): boolean => {
      return (adjacency.degreeById.get(id) || 0) > 0;
    },
  );
  const rankable: Array<string> =
    linkedCandidates.length > 0 ? linkedCandidates : candidates;

  let best: StarHubCandidate | null = null;
  for (const id of rankable) {
    const node: NetworkTopologyNode | undefined = nodeById.get(id);
    const candidate: StarHubCandidate = {
      id: id,
      // A position with no node behind it is ranked as an unmanaged peer.
      role: node ? hubRoleRank(node) : 1,
      discoveryDegree: discoveryDegreeById.get(id) || 0,
      fdbRank: nodeIdsWithFdbEdges.has(id) ? 1 : 0,
      degree: adjacency.degreeById.get(id) || 0,
    };
    if (best === null || compareStarHubCandidates(candidate, best) < 0) {
      best = candidate;
    }
  }

  return best ? best.id : null;
};

/**
 * Hops from the hub for every node, hub included at 0.
 *
 * Nodes the hub cannot reach — a satellite office whose uplink was never
 * discovered, a switch pair cabled only to each other — are not dropped
 * and are never given depth 0, which would stack them on top of the hub
 * and make the picture a lie. They land one ring past the furthest
 * reachable node, where "outside everything the hub can see" is exactly
 * what the geometry says about them.
 *
 * Returns an empty map when the hub is not part of the graph.
 */
export const computeStarRingDepths: (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  hubNodeId: string,
) => Map<string, number> = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  hubNodeId: string,
): Map<string, number> => {
  const depthById: Map<string, number> = new Map<string, number>();
  const orderedNodeIds: Array<string> = canonicalNodeOrder(nodes);
  if (
    orderedNodeIds.length === 0 ||
    typeof hubNodeId !== "string" ||
    !orderedNodeIds.includes(hubNodeId)
  ) {
    return depthById;
  }

  const adjacency: TopologyAdjacency = buildTopologyAdjacency(nodes, edges);

  /*
   * Level-by-level BFS with each frontier sorted by id before it is
   * drained. The depths themselves do not depend on visit order, but
   * spelling the order out keeps the traversal a function of the graph
   * rather than of the row order the topology query happened to return
   * on this poll.
   */
  depthById.set(hubNodeId, 0);
  let frontier: Array<string> = [hubNodeId];
  let depth: number = 0;
  let maxReachableDepth: number = 0;
  while (frontier.length > 0) {
    const nextFrontier: Array<string> = [];
    for (const current of frontier) {
      for (const neighborId of adjacency.neighborsById.get(current) || []) {
        if (depthById.has(neighborId)) {
          continue;
        }
        depthById.set(neighborId, depth + 1);
        nextFrontier.push(neighborId);
      }
    }
    if (nextFrontier.length > 0) {
      maxReachableDepth = depth + 1;
    }
    nextFrontier.sort(compareNodeIds);
    frontier = nextFrontier;
    depth++;
  }

  const islandDepth: number = maxReachableDepth + 1;
  for (const id of orderedNodeIds) {
    if (!depthById.has(id)) {
      depthById.set(id, islandDepth);
    }
  }

  return depthById;
};

/**
 * Compute a hub-and-spoke layout around the node
 * {@link selectStarHubNodeId} picks.
 */
export const computeStarTopologyModel: (
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

  const footprints: Map<string, TopologyNodeFootprint> = buildFootprints(nodes);
  const adjacency: TopologyAdjacency = buildTopologyAdjacency(nodes, edges);

  /*
   * A non-null hub is guaranteed for a non-empty node list; the fallback
   * exists so a future change to the selection rules cannot silently turn
   * the whole map into one node stacked at the origin.
   */
  const hubNodeId: string =
    selectStarHubNodeId(nodes, edges) || orderedNodeIds[0]!;
  const depthById: Map<string, number> = computeStarRingDepths(
    nodes,
    edges,
    hubNodeId,
  );

  const starById: Map<string, StarNode> = new Map<string, StarNode>();
  let maxRing: number = 0;
  for (const id of orderedNodeIds) {
    const depth: number | undefined = depthById.get(id);
    const ring: number =
      typeof depth === "number" && Number.isFinite(depth) && depth >= 0
        ? Math.floor(depth)
        : id === hubNodeId
          ? 0
          : 1;
    maxRing = Math.max(maxRing, ring);
    starById.set(id, { id: id, ring: ring, weight: 1, children: [] });
  }

  /*
   * The hub tree: a node's parent is its canonically-first neighbour
   * exactly one ring inward. Cycles make several neighbours eligible and
   * the id order picks between them, so the tree — and every wedge
   * derived from it — is a function of the graph.
   *
   * Nodes with no such neighbour are the unreachable ones. They share the
   * outermost ring and get their own even split of the circle below,
   * because there is no parent wedge to carve theirs out of.
   */
  const orphanIds: Array<string> = [];
  for (const id of orderedNodeIds) {
    const self: StarNode = starById.get(id)!;
    if (id === hubNodeId || self.ring === 0) {
      continue;
    }
    let parentId: string | null = null;
    for (const neighborId of adjacency.neighborsById.get(id) || []) {
      const neighbor: StarNode | undefined = starById.get(neighborId);
      if (!neighbor || neighbor.ring !== self.ring - 1) {
        continue;
      }
      if (parentId === null || compareNodeIds(neighborId, parentId) < 0) {
        parentId = neighborId;
      }
    }
    if (parentId === null) {
      orphanIds.push(id);
    } else {
      starById.get(parentId)!.children.push(id);
    }
  }
  orphanIds.sort(compareNodeIds);
  for (const [, star] of starById) {
    star.children.sort(compareNodeIds);
  }

  /*
   * Subtree weight, accumulated from the outermost ring inward. A switch
   * carrying forty endpoints needs forty times the wedge of one carrying
   * a single endpoint; sized evenly instead, the busy switch's endpoints
   * pile up while the quiet one keeps a quarter of the circle empty.
   */
  const byRingDescending: Array<string> = orderedNodeIds
    .slice()
    .sort((a: string, b: string): number => {
      const ringDelta: number = starById.get(b)!.ring - starById.get(a)!.ring;
      return ringDelta === 0 ? compareNodeIds(a, b) : ringDelta;
    });
  for (const id of byRingDescending) {
    const star: StarNode = starById.get(id)!;
    let childWeight: number = 0;
    for (const childId of star.children) {
      childWeight += starById.get(childId)!.weight;
    }
    star.weight = Math.max(1, childWeight);
  }

  /*
   * Pass one: angles.
   *
   * The hub owns the full circle and hands wedges to its children; each
   * child then subdivides the wedge it was given, and so on outward.
   * Because a child's wedge is always CONTAINED in its parent's, no spoke
   * can cross another one — which is the entire reason to offer this mode
   * instead of letting a force simulation approximate it.
   *
   * The split is half even and half by subtree weight. Pure weighting
   * collapses at the top: a router carrying four switches and
   * twenty-four endpoints would give one switch 24/27ths of the circle
   * and squeeze the other three into four degrees each, where they
   * overlap. Pure evenness is wrong the other way — it hands a bare
   * access point as much room as a twenty-four-endpoint subtree. The
   * blend floors every child at half an even share while still letting a
   * heavy subtree claim most of the space.
   */
  const wedgeById: Map<string, StarWedge> = new Map<string, StarWedge>();

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
      starById.get(memberIds[index]!)!.weight / Math.max(1, totalWeight);
    return 0.5 * even + 0.5 * weighted;
  };

  const hubWedge: StarWedge = { nodeId: hubNodeId, start: 0, end: TWO_PI };
  wedgeById.set(hubNodeId, hubWedge);
  const queue: Array<StarWedge> = [hubWedge];

  // Islands get the circle to themselves on the ring they alone occupy.
  if (orphanIds.length > 0) {
    const orphanSpan: number = TWO_PI / orphanIds.length;
    orphanIds.forEach((orphanId: string, index: number): void => {
      const wedge: StarWedge = {
        nodeId: orphanId,
        start: index * orphanSpan,
        end: (index + 1) * orphanSpan,
      };
      wedgeById.set(orphanId, wedge);
      queue.push(wedge);
    });
  }

  while (queue.length > 0) {
    const current: StarWedge = queue.shift()!;
    const star: StarNode = starById.get(current.nodeId)!;
    if (star.children.length === 0) {
      continue;
    }
    let childTotal: number = 0;
    for (const childId of star.children) {
      childTotal += starById.get(childId)!.weight;
    }
    const parentSpan: number = current.end - current.start;
    let childCursor: number = current.start;
    star.children.forEach((childId: string, index: number): void => {
      const span: number =
        shareOf(star.children, index, childTotal) * parentSpan;
      const wedge: StarWedge = {
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
   * Pass two: radii, derived from the angles rather than guessed before
   * them. A ring is pushed outward until the NARROWEST wedge on it is
   * wide enough for that node's own painted width, so two neighbours on
   * one ring cannot overlap by construction rather than because a
   * relaxation pass happened to converge.
   */
  const radiusByRing: Array<number> = new Array<number>(maxRing + 1).fill(0);
  for (let ring: number = 1; ring <= maxRing; ring++) {
    let needed: number = 0;
    for (const id of orderedNodeIds) {
      if (starById.get(id)!.ring !== ring) {
        continue;
      }
      const wedge: StarWedge | undefined = wedgeById.get(id);
      const span: number = wedge ? wedge.end - wedge.start : TWO_PI;
      const slotWidth: number =
        footprintOrDefault(footprints, id).inkHalfWidth * 2 + STAR_SLOT_PADDING;
      if (span > STAR_MIN_WEDGE_SPAN) {
        needed = Math.max(needed, slotWidth / span);
      }
    }
    radiusByRing[ring] =
      ring === 1
        ? Math.max(STAR_HUB_RING_GAP, needed)
        : Math.max(radiusByRing[ring - 1]! + STAR_RING_MIN_GAP, needed);
  }

  for (const id of orderedNodeIds) {
    const star: StarNode = starById.get(id)!;
    const wedge: StarWedge | undefined = wedgeById.get(id);
    const angle: number = wedge ? (wedge.start + wedge.end) / 2 : 0;
    const radius: number = radiusByRing[star.ring] || 0;
    const x: number = radius * Math.cos(angle);
    const y: number = radius * Math.sin(angle);
    // A NaN here would blank the element and the graph bounds with it.
    positions.set(id, {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
    });
  }

  /*
   * Translate the painted extent to the origin, then centre it — with one
   * difference from the radial tail: the extent is taken SYMMETRICALLY
   * about the hub (the widest side is mirrored) instead of hugging the
   * ink. Hugging it puts the hub at the centre of the drawn ink, which is
   * not the centre of the box whenever the spokes are uneven — a
   * three-way fan, or one deep branch — and a hub-and-spoke picture whose
   * hub sits off to one side has given up the one thing it promises. The
   * cost is some empty space opposite the longest spoke, which reads as
   * headroom rather than as an error.
   */
  let halfSpanX: number = 0;
  let halfSpanY: number = 0;
  for (const id of orderedNodeIds) {
    const point: TopologyPoint | undefined = positions.get(id);
    if (!point) {
      continue;
    }
    const footprint: TopologyNodeFootprint = footprintOrDefault(footprints, id);
    halfSpanX = Math.max(halfSpanX, Math.abs(point.x) + footprint.inkHalfWidth);
    halfSpanY = Math.max(
      halfSpanY,
      Math.abs(point.y - footprint.halfHeight),
      Math.abs(point.y + footprint.labelBottom),
    );
  }

  const minX: number = -halfSpanX;
  const minY: number = -halfSpanY;
  const spanX: number = 2 * halfSpanX;
  const spanY: number = 2 * halfSpanY;
  const contentWidth: number = Math.max(
    frameWidth,
    spanX + 2 * STAR_LAYOUT_MARGIN,
  );
  const contentHeight: number = Math.max(
    frameHeight,
    spanY + 2 * STAR_LAYOUT_MARGIN,
  );
  const offsetX: number = (contentWidth - spanX) / 2 - minX;
  const offsetY: number = (contentHeight - spanY) / 2 - minY;

  for (const id of orderedNodeIds) {
    const point: TopologyPoint | undefined = positions.get(id);
    if (point) {
      positions.set(id, { x: point.x + offsetX, y: point.y + offsetY });
    }
  }

  /*
   * Star draws one hub-centred picture, so it publishes no component
   * hulls: the outermost ring already says "these are not connected to
   * the hub", and a box drawn round them would only repeat it.
   */
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
      ? Math.max(contentWidth, pinnedMaxX + STAR_LAYOUT_MARGIN)
      : contentWidth,
    contentHeight: Number.isFinite(pinnedMaxY)
      ? Math.max(contentHeight, pinnedMaxY + STAR_LAYOUT_MARGIN)
      : contentHeight,
  };
};
