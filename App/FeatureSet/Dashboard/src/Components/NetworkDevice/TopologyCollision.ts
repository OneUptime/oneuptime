import { TopologyNodeFootprint, footprintOrDefault } from "./TopologyFootprint";
import { TopologyPoint, hashString, seededUnit } from "./TopologyGraphUtil";
import {
  TopologySpatialGrid,
  buildSpatialGrid,
  forEachNearbyPair,
} from "./TopologySpatialGrid";

/*
 * Overlap relaxation — the pass that guarantees the thing a topology map
 * has to guarantee: two devices never render on top of each other.
 *
 * A force simulation alone cannot promise this. Its equilibrium is a
 * balance of attraction and repulsion, and along an edge the two forces
 * cancel at a distance decided by the spring constant rather than by how
 * large the two glyphs happen to be. So the simulation is followed by an
 * explicit, purely geometric relaxation that knows each node's actual
 * painted size and pushes overlapping pairs apart until none are left.
 *
 * Two passes, because nodes and their labels have very different shapes.
 * Node glyphs are round and roughly square, so a radial push is right for
 * them. Labels are wide and short — resolving a label overlap radially
 * would move nodes vertically by far more than the overlap requires and
 * would tear apart the structure the simulation just found — so labels
 * are separated horizontally only.
 */

// Sweeps to run. Each sweep resolves the pairs that are overlapping now.
export const COLLISION_PASSES: number = 24;
/*
 * Fraction of the needed correction applied per sweep. Applying the whole
 * correction at once makes pairs overshoot into new neighbours and
 * oscillate; under-relaxing converges smoothly.
 */
export const COLLISION_RELAX_FACTOR: number = 0.6;
/*
 * Exported so tests assert against the real contract rather than a magic
 * number. Two device glyphs are 16px radii, so anything under 32 is
 * literal overlap; 40 is overlap-free with a visible gap.
 */
export const MIN_NODE_SEPARATION: number = 40;

/*
 * Overlaps are resolved to a hair BEYOND contact rather than to exactly
 * contact.
 *
 * Under-relaxation approaches its target geometrically and never arrives,
 * so a sweep aimed at exactly `want` leaves the pair a shrinking sliver
 * inside each other for ever — and "overlapping" is a strict `<`, so it
 * never clears. Two devices seeded at the same coordinate used to settle
 * 47.99999998 apart when they wanted 48, which made relaxNodeCollisions
 * report a failure it had in fact all but fixed, and made "zero on
 * success" a value it could not return for ANY overlapping input, at any
 * number of passes. Aiming a twentieth of a pixel past contact gives the
 * iteration a fixed point that is genuinely overlap free, at a distance
 * no screen can show.
 */
export const COLLISION_SEPARATION_EPSILON: number = 0.05;

// Below this distance two nodes count as coincident and need an angle.
const COINCIDENT_EPSILON: number = 1e-3;

/*
 * Deterministic escape direction for two nodes at the same coordinate.
 * Derived from the pair's ids so it is identical on every render — the
 * one place a layout genuinely needs an arbitrary direction, and the one
 * place Math.random would silently make the map flap.
 */
const separationAngleFor: (idI: string, idJ: string) => number = (
  idI: string,
  idJ: string,
): number => {
  return seededUnit(hashString(`${idI}|${idJ}`)) * Math.PI * 2;
};

/**
 * Push overlapping node glyphs apart.
 *
 * Mutates `positions` in place and returns how many pairs are still
 * overlapping — zero on success. The count is the return value rather
 * than a boolean so a caller (and a test) can see how badly a pathological
 * graph failed rather than just that it did.
 *
 * Pinned nodes never move: the user put them there. Their partner absorbs
 * the whole correction instead of half of it, so a pinned node still
 * clears its neighbours.
 */
export const relaxNodeCollisions: (
  positions: Map<string, TopologyPoint>,
  orderedNodeIds: Array<string>,
  footprints: Map<string, TopologyNodeFootprint>,
  pinnedIds: Set<string>,
  passes?: number | undefined,
) => number = (
  positions: Map<string, TopologyPoint>,
  orderedNodeIds: Array<string>,
  footprints: Map<string, TopologyNodeFootprint>,
  pinnedIds: Set<string>,
  passes: number = COLLISION_PASSES,
): number => {
  const ids: Array<string> = orderedNodeIds.filter((id: string): boolean => {
    return positions.has(id);
  });
  const count: number = ids.length;
  if (count < 2) {
    return 0;
  }

  const x: Float64Array = new Float64Array(count);
  const y: Float64Array = new Float64Array(count);
  const radius: Float64Array = new Float64Array(count);
  const isPinned: Array<boolean> = new Array<boolean>(count);
  let maxRadius: number = 1;

  for (let i: number = 0; i < count; i++) {
    const id: string = ids[i]!;
    const point: TopologyPoint = positions.get(id)!;
    x[i] = point.x;
    y[i] = point.y;
    const footprint: TopologyNodeFootprint = footprintOrDefault(footprints, id);
    radius[i] = footprint.collisionRadius;
    isPinned[i] = pinnedIds.has(id);
    maxRadius = Math.max(maxRadius, footprint.collisionRadius);
  }

  const cutoff: number = maxRadius * 2;
  let remaining: number = 0;

  for (let pass: number = 0; pass < Math.max(1, passes); pass++) {
    const grid: TopologySpatialGrid = buildSpatialGrid(x, y, count, cutoff);
    let overlaps: number = 0;

    forEachNearbyPair(grid, x, y, cutoff, (i: number, j: number): void => {
      const want: number = radius[i]! + radius[j]!;
      let dx: number = x[i]! - x[j]!;
      let dy: number = y[i]! - y[j]!;
      let distance: number = Math.sqrt(dx * dx + dy * dy);

      if (distance >= want) {
        return;
      }
      overlaps++;

      if (distance < COINCIDENT_EPSILON) {
        const angle: number = separationAngleFor(ids[i]!, ids[j]!);
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        distance = 1;
      } else {
        dx /= distance;
        dy /= distance;
      }

      const correction: number =
        (want + COLLISION_SEPARATION_EPSILON - distance) *
        COLLISION_RELAX_FACTOR;
      const pinnedI: boolean = isPinned[i]!;
      const pinnedJ: boolean = isPinned[j]!;
      if (pinnedI && pinnedJ) {
        // Nothing to do — the user placed both of these deliberately.
        return;
      }
      const shareI: number = pinnedJ ? correction : correction / 2;
      const shareJ: number = pinnedI ? correction : correction / 2;
      if (!pinnedI) {
        x[i] = x[i]! + dx * shareI;
        y[i] = y[i]! + dy * shareI;
      }
      if (!pinnedJ) {
        x[j] = x[j]! - dx * shareJ;
        y[j] = y[j]! - dy * shareJ;
      }
    });

    remaining = overlaps;
    if (overlaps === 0) {
      break;
    }
  }

  for (let i: number = 0; i < count; i++) {
    positions.set(ids[i]!, { x: x[i]!, y: y[i]! });
  }

  return remaining;
};

/**
 * Separate overlapping label boxes horizontally.
 *
 * Runs after {@link relaxNodeCollisions}, and only ever moves nodes along
 * x, so it cannot undo the vertical structure the glyph pass established.
 * A label box is `[x +/- labelHalfWidth] x [y + halfHeight, y +
 * labelBottom]`; two boxes that do not overlap vertically are ignored
 * however close their x ranges are.
 */
export const relaxLabelCollisions: (
  positions: Map<string, TopologyPoint>,
  orderedNodeIds: Array<string>,
  footprints: Map<string, TopologyNodeFootprint>,
  pinnedIds: Set<string>,
  passes?: number | undefined,
) => number = (
  positions: Map<string, TopologyPoint>,
  orderedNodeIds: Array<string>,
  footprints: Map<string, TopologyNodeFootprint>,
  pinnedIds: Set<string>,
  passes: number = COLLISION_PASSES,
): number => {
  const ids: Array<string> = orderedNodeIds.filter((id: string): boolean => {
    return positions.has(id);
  });
  const count: number = ids.length;
  if (count < 2) {
    return 0;
  }

  const x: Float64Array = new Float64Array(count);
  const y: Float64Array = new Float64Array(count);
  const halfWidth: Float64Array = new Float64Array(count);
  const top: Float64Array = new Float64Array(count);
  const bottom: Float64Array = new Float64Array(count);
  const isPinned: Array<boolean> = new Array<boolean>(count);
  let maxSpan: number = 1;

  for (let i: number = 0; i < count; i++) {
    const id: string = ids[i]!;
    const point: TopologyPoint = positions.get(id)!;
    const footprint: TopologyNodeFootprint = footprintOrDefault(footprints, id);
    x[i] = point.x;
    y[i] = point.y;
    /*
     * A label narrower than its own glyph cannot be the thing that
     * collides — the glyph pass already cleared that — so the box is at
     * least glyph-wide, which also keeps zero-width (unnamed) nodes from
     * being treated as collision-free points.
     */
    halfWidth[i] = Math.max(footprint.labelHalfWidth, footprint.halfWidth);
    top[i] = footprint.halfHeight;
    bottom[i] = footprint.labelBottom;
    isPinned[i] = pinnedIds.has(id);
    maxSpan = Math.max(maxSpan, halfWidth[i]! * 2);
  }

  let remaining: number = 0;

  for (let pass: number = 0; pass < Math.max(1, passes); pass++) {
    const grid: TopologySpatialGrid = buildSpatialGrid(x, y, count, maxSpan);
    let overlaps: number = 0;

    forEachNearbyPair(grid, x, y, maxSpan, (i: number, j: number): void => {
      // Vertical bands first: most near pairs are on different rows.
      const topI: number = y[i]! + top[i]!;
      const bottomI: number = y[i]! + bottom[i]!;
      const topJ: number = y[j]! + top[j]!;
      const bottomJ: number = y[j]! + bottom[j]!;
      if (bottomI <= topJ || bottomJ <= topI) {
        return;
      }

      const want: number = halfWidth[i]! + halfWidth[j]!;
      let dx: number = x[i]! - x[j]!;
      const distance: number = Math.abs(dx);
      if (distance >= want) {
        return;
      }
      overlaps++;

      if (distance < COINCIDENT_EPSILON) {
        // Same x: split them left and right, deterministically.
        dx = seededUnit(hashString(`${ids[i]!}|${ids[j]!}`)) < 0.5 ? -1 : 1;
      } else {
        dx /= distance;
      }

      const correction: number =
        (want + COLLISION_SEPARATION_EPSILON - distance) *
        COLLISION_RELAX_FACTOR;
      const pinnedI: boolean = isPinned[i]!;
      const pinnedJ: boolean = isPinned[j]!;
      if (pinnedI && pinnedJ) {
        return;
      }
      if (!pinnedI) {
        x[i] = x[i]! + dx * (pinnedJ ? correction : correction / 2);
      }
      if (!pinnedJ) {
        x[j] = x[j]! - dx * (pinnedI ? correction : correction / 2);
      }
    });

    remaining = overlaps;
    if (overlaps === 0) {
      break;
    }
  }

  for (let i: number = 0; i < count; i++) {
    positions.set(ids[i]!, { x: x[i]!, y: y[i]! });
  }

  return remaining;
};

/**
 * Count node-glyph overlaps without moving anything. Used by tests and by
 * the layout's own self-check.
 */
export const countNodeOverlaps: (
  positions: Map<string, TopologyPoint>,
  orderedNodeIds: Array<string>,
  footprints: Map<string, TopologyNodeFootprint>,
) => number = (
  positions: Map<string, TopologyPoint>,
  orderedNodeIds: Array<string>,
  footprints: Map<string, TopologyNodeFootprint>,
): number => {
  const ids: Array<string> = orderedNodeIds.filter((id: string): boolean => {
    return positions.has(id);
  });
  let overlaps: number = 0;
  for (let i: number = 0; i < ids.length; i++) {
    const pointI: TopologyPoint = positions.get(ids[i]!)!;
    const radiusI: number = footprintOrDefault(
      footprints,
      ids[i]!,
    ).collisionRadius;
    for (let j: number = i + 1; j < ids.length; j++) {
      const pointJ: TopologyPoint = positions.get(ids[j]!)!;
      const radiusJ: number = footprintOrDefault(
        footprints,
        ids[j]!,
      ).collisionRadius;
      const dx: number = pointI.x - pointJ.x;
      const dy: number = pointI.y - pointJ.y;
      if (Math.sqrt(dx * dx + dy * dy) < radiusI + radiusJ) {
        overlaps++;
      }
    }
  }
  return overlaps;
};
