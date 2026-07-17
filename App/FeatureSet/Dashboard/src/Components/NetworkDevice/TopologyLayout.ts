import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";

/*
 * Pure, react-free force-directed layout for the network topology graph.
 *
 * Kept out of the graph component so it can be imported (and unit-tested) in
 * a plain Node/TypeScript environment — the App project does not have
 * `react` on its resolution path, so importing this logic from the .tsx
 * component would drag `react` into the App compile/test context and fail
 * to resolve.
 */

// A single 2D coordinate.
export interface TopologyPoint {
  x: number;
  y: number;
}

const LAYOUT_MARGIN: number = 48;
const DEFAULT_ITERATIONS: number = 300;

interface MutablePoint {
  x: number;
  y: number;
}

/**
 * Deterministic 32-bit FNV-1a hash of a string. Used to seed node
 * positions so the same topology always lays out identically (no
 * Math.random, which is banned and non-deterministic).
 */
const hashString: (value: string) => number = (value: string): number => {
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
const seededUnit: (seed: number) => number = (seed: number): number => {
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
 * Compute a deterministic force-directed layout for a network topology.
 *
 * Pure and side-effect free: given the same inputs it always returns the
 * same coordinates. Initial positions are seeded from a hash of each node
 * id, then refined with a fixed number of Fruchterman-Reingold style
 * iterations (all-pairs repulsion + per-edge spring attraction + a gentle
 * pull toward centre). Every returned coordinate is finite and clamped
 * within [margin, width - margin] x [margin, height - margin].
 */
export const computeTopologyLayout: (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  width: number,
  height: number,
  iterations?: number,
) => Map<string, TopologyPoint> = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  width: number,
  height: number,
  iterations: number = DEFAULT_ITERATIONS,
): Map<string, TopologyPoint> => {
  const result: Map<string, TopologyPoint> = new Map();

  if (!nodes || nodes.length === 0) {
    return result;
  }

  const margin: number = LAYOUT_MARGIN;
  const minX: number = margin;
  const maxX: number = Math.max(margin + 1, width - margin);
  const minY: number = margin;
  const maxY: number = Math.max(margin + 1, height - margin);
  const centerX: number = (minX + maxX) / 2;
  const centerY: number = (minY + maxY) / 2;

  const positions: Map<string, MutablePoint> = new Map();

  /*
   * Seed deterministic initial positions from a hash of each node id.
   * The node index nudges the hash so two ids that collide (or a single
   * node) still get distinct, spread-out starting points.
   */
  nodes.forEach((node: NetworkTopologyNode, index: number): void => {
    const baseHash: number =
      hashString(node.id) ^ Math.imul(index + 1, 0x85ebca6b);
    const ux: number = seededUnit(baseHash >>> 0);
    const uy: number = seededUnit((baseHash ^ 0x9e3779b9) >>> 0);
    positions.set(node.id, {
      x: minX + ux * (maxX - minX),
      y: minY + uy * (maxY - minY),
    });
  });

  const nodeCount: number = nodes.length;
  const area: number = Math.max(1, (maxX - minX) * (maxY - minY));
  // Ideal edge length (Fruchterman-Reingold constant k).
  const k: number = Math.sqrt(area / nodeCount);
  const epsilon: number = 0.01;

  // Only consider edges whose endpoints both exist as nodes.
  const validEdges: Array<NetworkTopologyEdge> = edges
    ? edges.filter((edge: NetworkTopologyEdge): boolean => {
        return positions.has(edge.fromNodeId) && positions.has(edge.toNodeId);
      })
    : [];

  let temperature: number = (maxX - minX) * 0.1;
  const cooling: number = temperature / (iterations + 1);

  const nodeIds: Array<string> = nodes.map((n: NetworkTopologyNode) => {
    return n.id;
  });

  for (let iter: number = 0; iter < iterations; iter++) {
    const disp: Map<string, MutablePoint> = new Map();
    for (const id of nodeIds) {
      disp.set(id, { x: 0, y: 0 });
    }

    // Repulsion between every pair of nodes.
    for (let i: number = 0; i < nodeIds.length; i++) {
      const idI: string = nodeIds[i]!;
      const pI: MutablePoint = positions.get(idI)!;
      const dI: MutablePoint = disp.get(idI)!;
      for (let j: number = i + 1; j < nodeIds.length; j++) {
        const idJ: string = nodeIds[j]!;
        const pJ: MutablePoint = positions.get(idJ)!;
        let dx: number = pI.x - pJ.x;
        let dy: number = pI.y - pJ.y;
        let dist: number = Math.sqrt(dx * dx + dy * dy);
        if (dist < epsilon) {
          // Deterministically separate coincident nodes.
          dx = (seededUnit(hashString(idI + idJ)) - 0.5) * epsilon;
          dy = (seededUnit(hashString(idJ + idI)) - 0.5) * epsilon;
          dist = epsilon;
        }
        const force: number = (k * k) / dist;
        const fx: number = (dx / dist) * force;
        const fy: number = (dy / dist) * force;
        dI.x += fx;
        dI.y += fy;
        const dJ: MutablePoint = disp.get(idJ)!;
        dJ.x -= fx;
        dJ.y -= fy;
      }
    }

    // Attraction along edges (springs).
    for (const edge of validEdges) {
      const pA: MutablePoint = positions.get(edge.fromNodeId)!;
      const pB: MutablePoint = positions.get(edge.toNodeId)!;
      const dx: number = pA.x - pB.x;
      const dy: number = pA.y - pB.y;
      const dist: number = Math.max(epsilon, Math.sqrt(dx * dx + dy * dy));
      const force: number = (dist * dist) / k;
      const fx: number = (dx / dist) * force;
      const fy: number = (dy / dist) * force;
      const dA: MutablePoint = disp.get(edge.fromNodeId)!;
      const dB: MutablePoint = disp.get(edge.toNodeId)!;
      dA.x -= fx;
      dA.y -= fy;
      dB.x += fx;
      dB.y += fy;
    }

    // Gentle centering so disconnected components do not drift away.
    for (const id of nodeIds) {
      const p: MutablePoint = positions.get(id)!;
      const d: MutablePoint = disp.get(id)!;
      d.x += (centerX - p.x) * 0.01;
      d.y += (centerY - p.y) * 0.01;
    }

    // Apply displacement, capped by the current temperature, then clamp.
    for (const id of nodeIds) {
      const p: MutablePoint = positions.get(id)!;
      const d: MutablePoint = disp.get(id)!;
      const len: number = Math.max(epsilon, Math.sqrt(d.x * d.x + d.y * d.y));
      const limited: number = Math.min(len, temperature);
      p.x = clamp(p.x + (d.x / len) * limited, minX, maxX);
      p.y = clamp(p.y + (d.y / len) * limited, minY, maxY);
    }

    temperature = Math.max(0, temperature - cooling);
  }

  for (const id of nodeIds) {
    const p: MutablePoint = positions.get(id)!;
    result.set(id, {
      x: clamp(p.x, minX, maxX),
      y: clamp(p.y, minY, maxY),
    });
  }

  return result;
};
