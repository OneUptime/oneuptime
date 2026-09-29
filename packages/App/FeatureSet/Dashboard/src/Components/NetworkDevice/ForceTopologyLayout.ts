import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { isEndpointNode } from "./EndpointNodeUtil";
import {
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
  clamp,
  compareNodeIds,
  findTopologyComponents,
} from "./TopologyGraphUtil";
import { relaxLabelCollisions, relaxNodeCollisions } from "./TopologyCollision";
import {
  COMPONENT_GAP,
  PackInput,
  PackResult,
  PackedBox,
  packComponentBoxes,
} from "./TopologyPacking";
import { TopologyComponentBox, TopologyLayoutModel } from "./TopologyModel";
import {
  TopologySpatialGrid,
  buildSpatialGrid,
  forEachNearbyPair,
} from "./TopologySpatialGrid";

/*
 * The default network topology layout.
 *
 * WHAT WAS WRONG WITH THE OLD ONE. It was a textbook Fruchterman-Reingold
 * over the whole node set inside a fixed 1000x700 box, and four
 * independent properties of that made a real network map unreadable:
 *
 *   - No component awareness. A single "pull toward the centre of the
 *     frame" term dragged every disconnected island onto the same point,
 *     where they overlapped into one meaningless tangle. Devices with no
 *     neighbours at all — a very common case, since a device only gets
 *     edges once LLDP/CDP data arrives — drifted to the frame corners on
 *     repulsion alone and then hijacked the fit, compressing the actual
 *     graph into the middle.
 *   - No node size. It placed dimensionless points; the component then
 *     drew 32px circles with labels under them. Nothing in the algorithm
 *     could know two nodes were on top of each other.
 *   - Seeded from a hash of node id XORed with the ARRAY INDEX, so the
 *     layout was a function of the response ordering rather than of the
 *     graph. The topology endpoint does not promise a stable order, so
 *     the sixty-second refresh reshuffled the map for no reason.
 *   - Quadratic in node count with a fixed 300 iterations, which is fine
 *     for a demo and unusable at the ten thousand devices the endpoint
 *     will return.
 *
 * WHAT THIS DOES INSTEAD. Split the graph into connected components; seed
 * each one as a radial tree (real LLDP topologies are near-trees, so the
 * seed starts close to the answer and the simulation becomes a short
 * relaxation instead of an untangling search); simulate with a spatial
 * grid so only near pairs interact; re-place large leaf fans analytically
 * because a simulation cannot fix radial degeneracy; relax glyph and
 * label overlaps against real footprints; then pack the components into
 * shelves so islands sit side by side instead of on top of each other.
 *
 * Every ordering decision is a total sort on node id and there is no
 * Math.random anywhere, so the same graph always produces the same
 * coordinates regardless of the order it arrived in.
 */

/*
 * Centre-to-centre distance a link pulls toward. Wide enough that two
 * adjacent devices' labels (up to 60px half-width each) clear each other.
 */
export const IDEAL_EDGE_LENGTH: number = 150;
/*
 * Endpoint attachments are drawn shorter so a switch and the devices
 * plugged into it read as one cluster. Derived from node kind, never from
 * edge.protocols — the layout must not change when operational
 * enrichment appears on an edge.
 */
export const ENDPOINT_EDGE_LENGTH_SCALE: number = 0.6;

// Repulsion is ignored past this many ideal edge lengths.
export const REPULSION_CUTOFF_MULTIPLIER: number = 3;
// Pull toward the component's own centroid, for far-flung members only.
export const COMPONENT_GRAVITY: number = 0.02;
export const TEMPERATURE_DECAY: number = 0.97;
/*
 * Past this many nodes in one component the simulation is skipped and the
 * radial seed is used as-is. The seed is a perfectly readable tree
 * layout; a frozen tab is not a readable anything.
 */
export const MAX_SIMULATED_NODES: number = 1500;

/*
 * The layout is only ever scaled UP to fill a frame, never down — see
 * TopologyLayoutModel.contentWidth. Two is enough to make a two-device
 * network look deliberate without making it look like a poster.
 */
export const MAX_FIT_SCALE: number = 2;
export const LAYOUT_MARGIN: number = 48;

// A hub with at least this many leaves gets an analytic fan.
export const LEAF_FAN_MIN_LEAVES: number = 4;
export const LEAF_FAN_MIN_RADIUS: number = 100;
export const LEAF_FAN_MAX_RADIUS: number = 340;
export const LEAF_FAN_RING_GAP: number = 64;
export const LEAF_FAN_SLOT_PADDING: number = 12;
// Fraction of the full circle a fan uses when the hub has an uplink.
export const LEAF_FAN_ARC_FRACTION: number = 0.75;

// Layout of the strip that collects devices with no links at all.
export const UNLINKED_STRIP_PITCH_X: number = 150;
export const UNLINKED_STRIP_PITCH_Y: number = 84;
export const UNLINKED_STRIP_TOP_GAP: number = 84;
export const UNLINKED_BOX_KEY: string = "unlinked";

/**
 * Iterations to simulate for a component of `nodeCount` nodes.
 *
 * Falls with size: a big graph needs fewer sweeps because its seed is
 * already good and its cost per sweep is far higher. Clamped at both ends
 * so a tiny graph still settles and a huge one still returns.
 */
export const iterationsForNodeCount: (nodeCount: number) => number = (
  nodeCount: number,
): number => {
  if (!Number.isFinite(nodeCount) || nodeCount <= 1) {
    return 50;
  }
  return Math.round(clamp(1700 / Math.sqrt(nodeCount), 50, 240));
};

/**
 * Seed one component as a radial tree.
 *
 * The root sits at the origin owning the whole circle; a node owning an
 * arc hands each of its BFS children an equal slice of it and sits at the
 * midpoint of its own slice, at a radius of its BFS depth times the ideal
 * edge length.
 *
 * This replaces hash-random seeding for two reasons. It is already close
 * to equilibrium for the near-tree graphs real discovery protocols
 * produce, so the simulation has only to relax it rather than untangle a
 * knot whose crossings can only be removed by passing nodes through each
 * other — which the cooling schedule forbids by the time it would matter.
 * And it is a continuous function of the graph: a new leaf takes a slice
 * of its parent's arc and every other node keeps its angle, so adding one
 * device does not redraw the map.
 */
export const seedComponentPositions: (
  component: TopologyComponent,
  adjacency: TopologyAdjacency,
  idealEdgeLength: number,
) => Map<string, TopologyPoint> = (
  component: TopologyComponent,
  adjacency: TopologyAdjacency,
  idealEdgeLength: number,
): Map<string, TopologyPoint> => {
  const positions: Map<string, TopologyPoint> = new Map<
    string,
    TopologyPoint
  >();
  if (component.nodeIds.length === 0) {
    return positions;
  }

  const childrenById: Map<string, Array<string>> = bfsChildrenOf(
    component,
    adjacency,
  );

  interface ArcAssignment {
    nodeId: string;
    start: number;
    end: number;
  }

  positions.set(component.rootId, { x: 0, y: 0 });
  const queue: Array<ArcAssignment> = [
    { nodeId: component.rootId, start: 0, end: Math.PI * 2 },
  ];

  while (queue.length > 0) {
    const current: ArcAssignment = queue.shift()!;
    const children: Array<string> = childrenById.get(current.nodeId) || [];
    if (children.length === 0) {
      continue;
    }
    const span: number = (current.end - current.start) / children.length;
    children.forEach((childId: string, index: number): void => {
      const start: number = current.start + index * span;
      const end: number = start + span;
      const angle: number = (start + end) / 2;
      const depth: number = component.depthById.get(childId) || 0;
      const radius: number = depth * idealEdgeLength;
      positions.set(childId, {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      });
      queue.push({ nodeId: childId, start: start, end: end });
    });
  }

  /*
   * A component with cycles can contain a node the BFS tree never gave an
   * arc to only if the graph is disconnected, which it is not by
   * construction — but a defensive placement keeps the contract "every
   * member gets a position" total.
   */
  for (const nodeId of component.nodeIds) {
    if (!positions.has(nodeId)) {
      const depth: number = component.depthById.get(nodeId) || 1;
      positions.set(nodeId, { x: depth * idealEdgeLength, y: 0 });
    }
  }

  return positions;
};

/**
 * Relax one component's seeded positions.
 *
 * Mutates `positions` in place. Attraction and repulsion are the standard
 * Fruchterman-Reingold terms; the departures from the textbook are all
 * about making a network map readable rather than making a physics demo
 * correct:
 *
 *   - Repulsion is cut off past a few ideal edge lengths and evaluated
 *     through a spatial grid, so cost is linear rather than quadratic.
 *   - Each node has a mass of 1 + degree. A forty-port switch therefore
 *     barely moves while its leaves arrange themselves around it, instead
 *     of being dragged around by whichever leaves happen to be unbalanced
 *     this iteration.
 *   - Gravity pulls toward the COMPONENT's centroid, not the frame's, and
 *     only acts on members that have drifted far from it. A global
 *     attractor has no notion of component membership, which is precisely
 *     how the old layout piled every island onto one point.
 *   - Temperature starts at one ideal edge length, in graph units. The
 *     old code started it at a tenth of the FRAME width while distances
 *     were in graph units, so the two diverged with node count and the
 *     first several dozen iterations teleported nodes many edge lengths
 *     at a time, destroying the seed before it could be used.
 */
export const simulateComponent: (
  component: TopologyComponent,
  adjacency: TopologyAdjacency,
  positions: Map<string, TopologyPoint>,
  endpointIds: Set<string>,
  idealEdgeLength: number,
  iterations: number,
) => void = (
  component: TopologyComponent,
  adjacency: TopologyAdjacency,
  positions: Map<string, TopologyPoint>,
  endpointIds: Set<string>,
  idealEdgeLength: number,
  iterations: number,
): void => {
  const ids: Array<string> = component.nodeIds;
  const count: number = ids.length;
  if (count < 2 || iterations <= 0) {
    return;
  }

  /*
   * Everything below runs in typed arrays keyed by a dense index built
   * once. The old implementation allocated a fresh Map plus one object
   * per node on every iteration and did three string-keyed lookups per
   * pair; that allocation and hashing traffic, not the maths, is what
   * made it take minutes on a few hundred nodes.
   */
  const indexById: Map<string, number> = new Map<string, number>();
  for (let i: number = 0; i < count; i++) {
    indexById.set(ids[i]!, i);
  }

  const x: Float64Array = new Float64Array(count);
  const y: Float64Array = new Float64Array(count);
  const dx: Float64Array = new Float64Array(count);
  const dy: Float64Array = new Float64Array(count);
  const mass: Float64Array = new Float64Array(count);

  for (let i: number = 0; i < count; i++) {
    const point: TopologyPoint = positions.get(ids[i]!) || { x: 0, y: 0 };
    x[i] = point.x;
    y[i] = point.y;
    mass[i] = 1 + (adjacency.degreeById.get(ids[i]!) || 0);
  }

  // Edge endpoints as dense indices, plus each edge's own rest length.
  const edgeFrom: Int32Array = new Int32Array(component.edges.length);
  const edgeTo: Int32Array = new Int32Array(component.edges.length);
  const edgeLength: Float64Array = new Float64Array(component.edges.length);
  for (let e: number = 0; e < component.edges.length; e++) {
    const edge: { a: string; b: string } = component.edges[e]!;
    edgeFrom[e] = indexById.get(edge.a) ?? 0;
    edgeTo[e] = indexById.get(edge.b) ?? 0;
    const isEndpointLink: boolean =
      endpointIds.has(edge.a) || endpointIds.has(edge.b);
    edgeLength[e] = isEndpointLink
      ? idealEdgeLength * ENDPOINT_EDGE_LENGTH_SCALE
      : idealEdgeLength;
  }

  const cutoff: number = idealEdgeLength * REPULSION_CUTOFF_MULTIPLIER;
  const gravityRadius: number = 2 * idealEdgeLength * Math.sqrt(count);
  const epsilon: number = 0.01;
  let temperature: number = idealEdgeLength;

  for (let iteration: number = 0; iteration < iterations; iteration++) {
    dx.fill(0);
    dy.fill(0);

    // Repulsion, near pairs only.
    const grid: TopologySpatialGrid = buildSpatialGrid(x, y, count, cutoff);
    forEachNearbyPair(grid, x, y, cutoff, (i: number, j: number): void => {
      let deltaX: number = x[i]! - x[j]!;
      let deltaY: number = y[i]! - y[j]!;
      let distance: number = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (distance < epsilon) {
        /*
         * Two nodes at the same coordinate have no direction to
         * separate along. Derive one from the index pair so it is the
         * same on every render.
         */
        const angle: number = ((i * 31 + j * 17) % 360) * (Math.PI / 180);
        deltaX = Math.cos(angle) * epsilon;
        deltaY = Math.sin(angle) * epsilon;
        distance = epsilon;
      }
      const force: number = (idealEdgeLength * idealEdgeLength) / distance;
      const fx: number = (deltaX / distance) * force;
      const fy: number = (deltaY / distance) * force;
      dx[i] = dx[i]! + fx;
      dy[i] = dy[i]! + fy;
      dx[j] = dx[j]! - fx;
      dy[j] = dy[j]! - fy;
    });

    // Attraction along edges.
    for (let e: number = 0; e < edgeFrom.length; e++) {
      const i: number = edgeFrom[e]!;
      const j: number = edgeTo[e]!;
      const rest: number = edgeLength[e]!;
      const deltaX: number = x[i]! - x[j]!;
      const deltaY: number = y[i]! - y[j]!;
      const distance: number = Math.max(
        epsilon,
        Math.sqrt(deltaX * deltaX + deltaY * deltaY),
      );
      const force: number = (distance * distance) / rest;
      const fx: number = (deltaX / distance) * force;
      const fy: number = (deltaY / distance) * force;
      dx[i] = dx[i]! - fx;
      dy[i] = dy[i]! - fy;
      dx[j] = dx[j]! + fx;
      dy[j] = dy[j]! + fy;
    }

    // Gravity toward this component's own centroid, for outliers only.
    let centroidX: number = 0;
    let centroidY: number = 0;
    for (let i: number = 0; i < count; i++) {
      centroidX += x[i]!;
      centroidY += y[i]!;
    }
    centroidX /= count;
    centroidY /= count;
    for (let i: number = 0; i < count; i++) {
      const toCentreX: number = centroidX - x[i]!;
      const toCentreY: number = centroidY - y[i]!;
      if (
        Math.sqrt(toCentreX * toCentreX + toCentreY * toCentreY) > gravityRadius
      ) {
        dx[i] = dx[i]! + toCentreX * COMPONENT_GRAVITY;
        dy[i] = dy[i]! + toCentreY * COMPONENT_GRAVITY;
      }
    }

    // Displace, capped by temperature and damped by node mass.
    for (let i: number = 0; i < count; i++) {
      const length: number = Math.sqrt(dx[i]! * dx[i]! + dy[i]! * dy[i]!);
      if (length < epsilon) {
        continue;
      }
      const step: number = Math.min(length / mass[i]!, temperature);
      x[i] = x[i]! + (dx[i]! / length) * step;
      y[i] = y[i]! + (dy[i]! / length) * step;
    }

    temperature *= TEMPERATURE_DECAY;
  }

  for (let i: number = 0; i < count; i++) {
    positions.set(ids[i]!, { x: x[i]!, y: y[i]! });
  }
};

/**
 * Re-place the leaves of every heavily-fanned hub onto concentric rings.
 *
 * A simulation cannot do this. A leaf's distance from its hub is a
 * near-flat direction of the energy — moving it in or out barely changes
 * the total — so where each leaf ends up radially is decided by the noise
 * in its starting position rather than by the graph. On a forty-port
 * switch that produces a ragged annulus with leaves at wildly different
 * radii, which is exactly the "messed up" look. Placing them
 * analytically costs nothing and is exactly right.
 */
export const placeLeafFans: (
  positions: Map<string, TopologyPoint>,
  component: TopologyComponent,
  adjacency: TopologyAdjacency,
  footprints: Map<string, TopologyNodeFootprint>,
  nameById: Map<string, string>,
) => void = (
  positions: Map<string, TopologyPoint>,
  component: TopologyComponent,
  adjacency: TopologyAdjacency,
  footprints: Map<string, TopologyNodeFootprint>,
  nameById: Map<string, string>,
): void => {
  const compareLeaves: (a: string, b: string) => number = (
    a: string,
    b: string,
  ): number => {
    const nameA: string = (nameById.get(a) || "").toLowerCase();
    const nameB: string = (nameById.get(b) || "").toLowerCase();
    if (nameA < nameB) {
      return -1;
    }
    if (nameA > nameB) {
      return 1;
    }
    return compareNodeIds(a, b);
  };

  for (const hubId of component.nodeIds) {
    const neighbors: Array<string> = adjacency.neighborsById.get(hubId) || [];
    if (neighbors.length < LEAF_FAN_MIN_LEAVES) {
      continue;
    }

    const leaves: Array<string> = [];
    const others: Array<string> = [];
    for (const neighborId of neighbors) {
      if ((adjacency.degreeById.get(neighborId) || 0) === 1) {
        leaves.push(neighborId);
      } else {
        others.push(neighborId);
      }
    }
    if (leaves.length < LEAF_FAN_MIN_LEAVES) {
      continue;
    }
    leaves.sort(compareLeaves);

    const hub: TopologyPoint = positions.get(hubId) || { x: 0, y: 0 };

    /*
     * Point the fan away from the hub's uplinks: the mean direction to
     * its non-leaf neighbours, negated. With no uplink at all the fan
     * takes the whole circle.
     */
    let bisector: number = -Math.PI / 2;
    let arc: number = Math.PI * 2;
    if (others.length > 0) {
      let sumX: number = 0;
      let sumY: number = 0;
      for (const otherId of others) {
        const other: TopologyPoint = positions.get(otherId) || { x: 0, y: 0 };
        const deltaX: number = other.x - hub.x;
        const deltaY: number = other.y - hub.y;
        const length: number = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (length > 1e-6) {
          sumX += deltaX / length;
          sumY += deltaY / length;
        }
      }
      if (Math.abs(sumX) > 1e-9 || Math.abs(sumY) > 1e-9) {
        bisector = Math.atan2(-sumY, -sumX);
      }
      arc = Math.PI * 2 * LEAF_FAN_ARC_FRACTION;
    }

    let slotWidth: number = 0;
    for (const leafId of leaves) {
      slotWidth = Math.max(
        slotWidth,
        footprintOrDefault(footprints, leafId).inkHalfWidth * 2,
      );
    }
    const pitch: number = slotWidth + LEAF_FAN_SLOT_PADDING;

    const radius: number = clamp(
      (leaves.length * pitch) / arc,
      LEAF_FAN_MIN_RADIUS,
      LEAF_FAN_MAX_RADIUS,
    );
    const perRing: number = Math.max(
      1,
      Math.floor((arc * radius) / Math.max(1, pitch)),
    );
    const isFullCircle: boolean = arc >= Math.PI * 2 - 1e-9;

    leaves.forEach((leafId: string, index: number): void => {
      const ring: number = Math.floor(index / perRing);
      const slot: number = index % perRing;
      const ringRadius: number = radius + ring * LEAF_FAN_RING_GAP;
      // Odd rings are offset half a slot so rings do not line up radially.
      const stagger: number = ring % 2 === 0 ? 0 : 0.5;
      const inThisRing: number = Math.min(
        perRing,
        leaves.length - ring * perRing,
      );

      let angle: number;
      if (isFullCircle) {
        const step: number = (Math.PI * 2) / Math.max(1, inThisRing);
        angle = bisector + (slot + stagger) * step;
      } else {
        const step: number = arc / Math.max(1, inThisRing);
        angle = bisector - arc / 2 + (slot + 0.5 + stagger) * step;
      }

      positions.set(leafId, {
        x: hub.x + ringRadius * Math.cos(angle),
        y: hub.y + ringRadius * Math.sin(angle),
      });
    });
  }
};

interface InkBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/*
 * The painted extent of a set of nodes: glyph plus label, not just node
 * centres. The old fit mapped the box of CENTRES onto the frame, which
 * put the extreme nodes exactly on the margin by construction and sliced
 * every label wider than the margin. Clipping was the normal case, not
 * the edge case.
 */
const inkBoxFor: (
  ids: Array<string>,
  positions: Map<string, TopologyPoint>,
  footprints: Map<string, TopologyNodeFootprint>,
) => InkBox | null = (
  ids: Array<string>,
  positions: Map<string, TopologyPoint>,
  footprints: Map<string, TopologyNodeFootprint>,
): InkBox | null => {
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

/**
 * Compute the force-directed layout for a network topology.
 *
 * Pure and deterministic: the same graph always produces the same
 * coordinates, whatever order its nodes and edges arrive in.
 *
 * `pinned` carries positions the user established by dragging. They are
 * applied last and win outright — the point of dragging a device is that
 * it stays where you put it, so nothing downstream is allowed to move it.
 * They are still included in the reported content extent so fit-to-view
 * frames them.
 */
export const computeForceTopologyModel: (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  width: number,
  height: number,
  pinned?: ReadonlyMap<string, TopologyPoint> | undefined,
  iterations?: number | undefined,
) => TopologyLayoutModel = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  width: number,
  height: number,
  pinned?: ReadonlyMap<string, TopologyPoint> | undefined,
  iterations?: number | undefined,
): TopologyLayoutModel => {
  const positions: Map<string, TopologyPoint> = new Map<
    string,
    TopologyPoint
  >();
  const componentBoxes: Array<TopologyComponentBox> = [];

  const orderedNodeIds: Array<string> = canonicalNodeOrder(nodes);
  if (orderedNodeIds.length === 0) {
    return {
      positions: positions,
      componentBoxes: componentBoxes,
      groups: [],
      contentWidth: Math.max(0, width),
      contentHeight: Math.max(0, height),
    };
  }

  const frameWidth: number = Number.isFinite(width) && width > 0 ? width : 1000;
  const frameHeight: number =
    Number.isFinite(height) && height > 0 ? height : 700;

  const adjacency: TopologyAdjacency = buildTopologyAdjacency(nodes, edges);
  const footprints: Map<string, TopologyNodeFootprint> = buildFootprints(nodes);

  const endpointIds: Set<string> = new Set<string>();
  const nameById: Map<string, string> = new Map<string, string>();
  for (const node of nodes || []) {
    if (!node || typeof node.id !== "string") {
      continue;
    }
    if (!nameById.has(node.id)) {
      nameById.set(node.id, node.name || "");
    }
    if (isEndpointNode(node)) {
      endpointIds.add(node.id);
    }
  }

  const allComponents: Array<TopologyComponent> = findTopologyComponents(
    adjacency,
    orderedNodeIds,
  );

  /*
   * Devices with no links at all get their own strip rather than a place
   * in the packing. "These six devices report no LLDP or CDP neighbours"
   * is something an operator wants to know; scattering them through the
   * map as one-node islands buries it.
   */
  const linkedComponents: Array<TopologyComponent> = [];
  const unlinkedIds: Array<string> = [];
  for (const component of allComponents) {
    if (component.nodeIds.length === 1) {
      unlinkedIds.push(component.rootId);
    } else {
      linkedComponents.push(component);
    }
  }
  unlinkedIds.sort(compareNodeIds);

  // Lay each connected component out in its own local coordinate space.
  const localPositions: Array<Map<string, TopologyPoint>> = [];
  const localBoxes: Array<InkBox> = [];
  const noPins: Set<string> = new Set<string>();

  for (const component of linkedComponents) {
    const local: Map<string, TopologyPoint> = seedComponentPositions(
      component,
      adjacency,
      IDEAL_EDGE_LENGTH,
    );

    if (component.nodeIds.length <= MAX_SIMULATED_NODES) {
      simulateComponent(
        component,
        adjacency,
        local,
        endpointIds,
        IDEAL_EDGE_LENGTH,
        iterations ?? iterationsForNodeCount(component.nodeIds.length),
      );
    }

    placeLeafFans(local, component, adjacency, footprints, nameById);
    relaxNodeCollisions(local, component.nodeIds, footprints, noPins);
    relaxLabelCollisions(local, component.nodeIds, footprints, noPins);
    /*
     * Glyph separation runs LAST, not just before the label pass. The
     * label pass only moves nodes along x, so it cannot undo the vertical
     * structure — but sliding one node sideways to clear its neighbour's
     * label can push it into a THIRD node's glyph, and it did: a
     * four-switch branch site whose simulation was skipped came out of
     * the label pass with a switch sitting 4px inside an endpoint of
     * another switch. Two devices drawn on top of each other is the one
     * thing a topology map may not do; a label a few pixels closer to its
     * neighbour than ideal is cosmetic, so the glyph pass gets the last
     * word.
     */
    relaxNodeCollisions(local, component.nodeIds, footprints, noPins);

    const box: InkBox = inkBoxFor(component.nodeIds, local, footprints) || {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
    };
    localPositions.push(local);
    localBoxes.push(box);
  }

  // Pack the component boxes into shelves.
  const packInputs: Array<PackInput> = linkedComponents.map(
    (component: TopologyComponent, index: number): PackInput => {
      const box: InkBox = localBoxes[index]!;
      return {
        width: box.maxX - box.minX,
        height: box.maxY - box.minY,
        key: component.rootId,
      };
    },
  );
  let widestComponent: number = 0;
  for (const input of packInputs) {
    widestComponent = Math.max(widestComponent, input.width);
  }
  const packed: PackResult = packComponentBoxes(
    packInputs,
    Math.max(frameWidth - 2 * LAYOUT_MARGIN, widestComponent),
    COMPONENT_GAP,
  );

  linkedComponents.forEach(
    (component: TopologyComponent, index: number): void => {
      const local: Map<string, TopologyPoint> = localPositions[index]!;
      const box: InkBox = localBoxes[index]!;
      const slot: PackedBox = packed.placements[index]!;
      const offsetX: number = slot.x - box.minX;
      const offsetY: number = slot.y - box.minY;
      for (const nodeId of component.nodeIds) {
        const point: TopologyPoint = local.get(nodeId) || { x: 0, y: 0 };
        positions.set(nodeId, {
          x: point.x + offsetX,
          y: point.y + offsetY,
        });
      }
      componentBoxes.push({
        key: component.rootId,
        nodeIds: component.nodeIds.slice(),
        x: slot.x,
        y: slot.y,
        width: slot.width,
        height: slot.height,
        nodeCount: component.nodeIds.length,
        isUnlinked: false,
      });
    },
  );

  // The unlinked strip: a wrapped grid under everything else.
  let contentBottom: number = packed.height;
  if (unlinkedIds.length > 0) {
    const usableWidth: number = Math.max(
      UNLINKED_STRIP_PITCH_X,
      Math.max(frameWidth - 2 * LAYOUT_MARGIN, packed.width),
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

    const stripBox: InkBox = inkBoxFor(unlinkedIds, positions, footprints) || {
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
    contentBottom = stripBox.maxY;
  }

  /*
   * Magnify a small graph to fill the frame, and never shrink a large
   * one. Shrinking would spread node CENTRES closer together while
   * glyphs and label text stay a fixed size in viewBox units, putting
   * back every collision the relaxation pass just removed. Growing is
   * always safe for the same reason, in reverse.
   */
  const preScaleBox: InkBox = inkBoxFor(
    orderedNodeIds,
    positions,
    footprints,
  ) || { minX: 0, minY: 0, maxX: 0, maxY: contentBottom };
  const usableX: number = Math.max(1, frameWidth - 2 * LAYOUT_MARGIN);
  const usableY: number = Math.max(1, frameHeight - 2 * LAYOUT_MARGIN);
  const preSpanX: number = preScaleBox.maxX - preScaleBox.minX;
  const preSpanY: number = preScaleBox.maxY - preScaleBox.minY;
  const scale: number = clamp(
    Math.min(
      preSpanX > 1 ? usableX / preSpanX : Infinity,
      preSpanY > 1 ? usableY / preSpanY : Infinity,
    ),
    1,
    MAX_FIT_SCALE,
  );

  if (scale !== 1) {
    for (const nodeId of orderedNodeIds) {
      const point: TopologyPoint | undefined = positions.get(nodeId);
      if (point) {
        positions.set(nodeId, { x: point.x * scale, y: point.y * scale });
      }
    }
  }

  /*
   * Re-measure AFTER scaling rather than scaling the earlier measurement.
   * Positions scale but glyphs and labels do not, so the two boxes are
   * genuinely different — and it is the painted one that has to end up
   * centred, or a lone device sits visibly above the middle of its card
   * by half its own label height.
   */
  const finalBox: InkBox = inkBoxFor(orderedNodeIds, positions, footprints) || {
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: contentBottom * scale,
  };
  const spanX: number = finalBox.maxX - finalBox.minX;
  const spanY: number = finalBox.maxY - finalBox.minY;
  const contentWidth: number = Math.max(frameWidth, spanX + 2 * LAYOUT_MARGIN);
  const contentHeight: number = Math.max(
    frameHeight,
    spanY + 2 * LAYOUT_MARGIN,
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
   * Re-derive each hull from where its members actually ended up, rather
   * than transforming the box it had before. Scaling a box computed from
   * unscaled footprints would leave a hull noticeably looser than the
   * cluster it is supposed to describe.
   */
  for (const box of componentBoxes) {
    const memberIds: Array<string> =
      box.key === UNLINKED_BOX_KEY
        ? unlinkedIds
        : linkedComponents.find((component: TopologyComponent): boolean => {
            return component.rootId === box.key;
          })?.nodeIds || [];
    const memberBox: InkBox | null = inkBoxFor(
      memberIds,
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

  /*
   * Pins last. A dragged device stays exactly where the user dropped it,
   * bit for bit, across every refresh and re-layout.
   */
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
      ? Math.max(contentWidth, pinnedMaxX + LAYOUT_MARGIN)
      : contentWidth,
    contentHeight: Number.isFinite(pinnedMaxY)
      ? Math.max(contentHeight, pinnedMaxY + LAYOUT_MARGIN)
      : contentHeight,
  };
};
