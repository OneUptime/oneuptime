/*
 * A uniform spatial hash over node positions, used to turn the layout's
 * all-pairs passes into near-pairs passes.
 *
 * The old force layout compared every pair of nodes on every one of its
 * 300 iterations. That is 300 * n^2 / 2 distance computations — fine for
 * the eight-node demo, ruinous for the ten thousand devices the topology
 * endpoint is willing to return. Repulsion past a few ideal edge lengths
 * contributes nothing visible, so only pairs inside a cutoff need
 * visiting, and a grid finds those in time proportional to n.
 *
 * DETERMINISM IS THE POINT OF THE ITERATION ORDER. Floating point
 * addition is not associative, so accumulating the same set of forces in
 * a different sequence produces different low bits, and over a couple of
 * hundred iterations that grows into visibly different coordinates.
 * Buckets are therefore visited in ascending key order and indices within
 * a bucket in ascending order — never in Map insertion order, which
 * depends on the allocation history of the run rather than on the graph.
 */

export interface TopologySpatialGrid {
  cellSize: number;
  /** Cell key to the node indices inside it, each list ascending. */
  buckets: Map<number, Array<number>>;
  /** Bucket keys in ascending order — the canonical visit sequence. */
  orderedKeys: Array<number>;
}

/*
 * Cell coordinates are biased into a non-negative range and packed into a
 * single number so the bucket map is keyed by a primitive. The bias caps
 * the usable world at +/- 32768 cells from the origin, which at any
 * sensible cell size is orders of magnitude beyond the largest graph.
 */
const CELL_BIAS: number = 32768;
const CELL_SPAN: number = CELL_BIAS * 2;

const cellKey: (cellX: number, cellY: number) => number = (
  cellX: number,
  cellY: number,
): number => {
  const bx: number = Math.min(CELL_SPAN - 1, Math.max(0, cellX + CELL_BIAS));
  const by: number = Math.min(CELL_SPAN - 1, Math.max(0, cellY + CELL_BIAS));
  return by * CELL_SPAN + bx;
};

const cellIndexFor: (value: number, cellSize: number) => number = (
  value: number,
  cellSize: number,
): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.floor(value / cellSize);
};

/**
 * Bucket `count` points into a uniform grid.
 *
 * A non-finite coordinate is bucketed at the origin rather than skipped:
 * the caller's arrays are index-aligned, and silently dropping an index
 * here would desynchronise them.
 */
export const buildSpatialGrid: (
  x: Float64Array,
  y: Float64Array,
  count: number,
  cellSize: number,
) => TopologySpatialGrid = (
  x: Float64Array,
  y: Float64Array,
  count: number,
  cellSize: number,
): TopologySpatialGrid => {
  const size: number = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 1;
  const buckets: Map<number, Array<number>> = new Map<number, Array<number>>();

  const safeCount: number = Math.max(0, Math.min(count, x.length, y.length));
  for (let i: number = 0; i < safeCount; i++) {
    const key: number = cellKey(
      cellIndexFor(x[i]!, size),
      cellIndexFor(y[i]!, size),
    );
    const bucket: Array<number> | undefined = buckets.get(key);
    if (bucket) {
      // Indices are inserted ascending, so the bucket is already sorted.
      bucket.push(i);
    } else {
      buckets.set(key, [i]);
    }
  }

  const orderedKeys: Array<number> = Array.from(buckets.keys()).sort(
    (a: number, b: number): number => {
      return a - b;
    },
  );

  return { cellSize: size, buckets: buckets, orderedKeys: orderedKeys };
};

/*
 * How many cells out a pair inside the cutoff can possibly be. An
 * infinite cutoff means "every pair", which is expressed as a reach that
 * spans the whole populated grid rather than as a special case, so the
 * pair set and its ordering stay defined by one code path.
 */
const reachForCutoff: (cutoff: number, cellSize: number) => number = (
  cutoff: number,
  cellSize: number,
): number => {
  if (!Number.isFinite(cutoff) || cutoff <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(1, Math.ceil(cutoff / cellSize));
};

/**
 * Visit every unordered pair of points within `cutoff` of each other,
 * exactly once, in a deterministic order.
 *
 * Only the forward half of each cell's neighbourhood is scanned — cells
 * below it, and cells to its right on the same row. Combined with the
 * ascending cell order that visits every unordered cell pair exactly
 * once, so no pair is ever reported twice.
 *
 * A non-finite cutoff degenerates to every pair, which is what the tests
 * compare the grid against: with no cutoff the grid must agree with brute
 * force exactly, or the cutoff is hiding a bug rather than an
 * optimisation.
 */
export const forEachNearbyPair: (
  grid: TopologySpatialGrid,
  x: Float64Array,
  y: Float64Array,
  cutoff: number,
  visit: (i: number, j: number) => void,
) => void = (
  grid: TopologySpatialGrid,
  x: Float64Array,
  y: Float64Array,
  cutoff: number,
  visit: (i: number, j: number) => void,
): void => {
  const hasCutoff: boolean = Number.isFinite(cutoff) && cutoff > 0;
  const cutoffSquared: number = hasCutoff ? cutoff * cutoff : Infinity;
  const reach: number = reachForCutoff(cutoff, grid.cellSize);
  const exhaustive: boolean = !Number.isFinite(reach);

  const visitPair: (i: number, j: number) => void = (
    i: number,
    j: number,
  ): void => {
    const dx: number = x[i]! - x[j]!;
    const dy: number = y[i]! - y[j]!;
    if (dx * dx + dy * dy <= cutoffSquared) {
      // Always report the lower index first, whichever cell it came from.
      if (i < j) {
        visit(i, j);
      } else {
        visit(j, i);
      }
    }
  };

  for (let k: number = 0; k < grid.orderedKeys.length; k++) {
    const key: number = grid.orderedKeys[k]!;
    const bucket: Array<number> = grid.buckets.get(key)!;

    // Pairs inside this cell.
    for (let a: number = 0; a < bucket.length; a++) {
      for (let b: number = a + 1; b < bucket.length; b++) {
        visitPair(bucket[a]!, bucket[b]!);
      }
    }

    if (exhaustive) {
      /*
       * No cutoff: pair this cell with every later cell. Ascending key
       * order keeps that a total, deterministic sequence.
       */
      for (let n: number = k + 1; n < grid.orderedKeys.length; n++) {
        const neighbor: Array<number> = grid.buckets.get(grid.orderedKeys[n]!)!;
        for (const i of bucket) {
          for (const j of neighbor) {
            visitPair(i, j);
          }
        }
      }
      continue;
    }

    const cellY: number = Math.floor(key / CELL_SPAN) - CELL_BIAS;
    const cellX: number = (key % CELL_SPAN) - CELL_BIAS;

    /*
     * Offsets are clipped to the addressable cell window. An offset that
     * left it would be clamped by cellKey back onto a cell this scan has
     * already covered — in the worst case onto this very cell, pairing
     * the bucket with itself and reporting a node against itself at zero
     * distance. Clipping loses no pair: every out-of-range cell already
     * shares the edge cell's key, so its contents sit in the edge
     * bucket, and the edge bucket is reached from inside the window.
     */
    const minDx: number = Math.max(-reach, -CELL_BIAS - cellX);
    const maxDx: number = Math.min(reach, CELL_BIAS - 1 - cellX);
    const maxDy: number = Math.min(reach, CELL_BIAS - 1 - cellY);

    for (let dy: number = 0; dy <= maxDy; dy++) {
      // On the cell's own row only look right; below, look both ways.
      const fromDx: number = dy === 0 ? 1 : minDx;
      for (let dx: number = fromDx; dx <= maxDx; dx++) {
        const neighbor: Array<number> | undefined = grid.buckets.get(
          cellKey(cellX + dx, cellY + dy),
        );
        if (!neighbor) {
          continue;
        }
        for (const i of bucket) {
          for (const j of neighbor) {
            visitPair(i, j);
          }
        }
      }
    }
  }
};
