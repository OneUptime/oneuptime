import { describe, expect, test } from "@jest/globals";
import {
  TopologySpatialGrid,
  buildSpatialGrid,
  forEachNearbyPair,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologySpatialGrid";

/*
 * Mirrors the module's private cell packing. A key is
 * (biasedCellY * CELL_ROW_SPAN) + biasedCellX, so a one-cell step in x
 * moves the key by exactly 1 and a one-cell step in y by a whole row.
 * The bias caps the addressable world at +/- CELL_BIAS cells.
 */
const CELL_ROW_SPAN: number = 65536;
const CELL_BIAS: number = 32768;

interface LabeledPoint {
  label: string;
  x: number;
  y: number;
}

interface PointArrays {
  x: Float64Array;
  y: Float64Array;
  count: number;
}

type ToArraysFunction = (points: ReadonlyArray<LabeledPoint>) => PointArrays;

const toArrays: ToArraysFunction = (
  points: ReadonlyArray<LabeledPoint>,
): PointArrays => {
  const x: Float64Array = new Float64Array(points.length);
  const y: Float64Array = new Float64Array(points.length);
  for (let i: number = 0; i < points.length; i++) {
    x[i] = points[i]!.x;
    y[i] = points[i]!.y;
  }
  return { x: x, y: y, count: points.length };
};

type GridForFunction = (
  arrays: PointArrays,
  cellSize: number,
) => TopologySpatialGrid;

const gridFor: GridForFunction = (
  arrays: PointArrays,
  cellSize: number,
): TopologySpatialGrid => {
  return buildSpatialGrid(arrays.x, arrays.y, arrays.count, cellSize);
};

/* The visit sequence as "i-j" strings, in the order the grid reported it. */
type CollectPairKeysFunction = (
  grid: TopologySpatialGrid,
  arrays: PointArrays,
  cutoff: number,
) => Array<string>;

const collectPairKeys: CollectPairKeysFunction = (
  grid: TopologySpatialGrid,
  arrays: PointArrays,
  cutoff: number,
): Array<string> => {
  const visited: Array<string> = [];
  forEachNearbyPair(
    grid,
    arrays.x,
    arrays.y,
    cutoff,
    (i: number, j: number): void => {
      visited.push(`${String(i)}-${String(j)}`);
    },
  );
  return visited;
};

/* The same pairs, computed the slow honest way. */
type BruteForcePairKeysFunction = (
  arrays: PointArrays,
  cutoff: number,
) => Array<string>;

const bruteForcePairKeys: BruteForcePairKeysFunction = (
  arrays: PointArrays,
  cutoff: number,
): Array<string> => {
  const limit: number =
    Number.isFinite(cutoff) && cutoff > 0 ? cutoff * cutoff : Infinity;
  const pairs: Array<string> = [];
  for (let i: number = 0; i < arrays.count; i++) {
    for (let j: number = i + 1; j < arrays.count; j++) {
      const dx: number = arrays.x[i]! - arrays.x[j]!;
      const dy: number = arrays.y[i]! - arrays.y[j]!;
      if (dx * dx + dy * dy <= limit) {
        pairs.push(`${String(i)}-${String(j)}`);
      }
    }
  }
  return pairs;
};

type SortStringsFunction = (values: ReadonlyArray<string>) => Array<string>;

const sortStrings: SortStringsFunction = (
  values: ReadonlyArray<string>,
): Array<string> => {
  return [...values].sort((a: string, b: string): number => {
    return a.localeCompare(b);
  });
};

/*
 * The visit sequence expressed in point LABELS rather than array indices.
 * Permuting the input renumbers every index, so labels are the only way
 * to ask whether two runs walked the same pairs in the same order. Each
 * pair is normalised because "lower index first" is itself a function of
 * the input order.
 */
type CollectLabelPairsFunction = (
  points: ReadonlyArray<LabeledPoint>,
  cellSize: number,
  cutoff: number,
) => Array<string>;

const collectLabelPairs: CollectLabelPairsFunction = (
  points: ReadonlyArray<LabeledPoint>,
  cellSize: number,
  cutoff: number,
): Array<string> => {
  const arrays: PointArrays = toArrays(points);
  const grid: TopologySpatialGrid = gridFor(arrays, cellSize);
  const visited: Array<string> = [];
  forEachNearbyPair(
    grid,
    arrays.x,
    arrays.y,
    cutoff,
    (i: number, j: number): void => {
      const a: string = points[i]!.label;
      const b: string = points[j]!.label;
      visited.push(a < b ? `${a}|${b}` : `${b}|${a}`);
    },
  );
  return visited;
};

/*
 * A stand-in for one repulsion pass: sums a per-pair quantity in visit
 * order. Floating point addition is not associative, so this is bit-exact
 * only when the visit ORDER is identical, not merely the pair set.
 */
type AccumulateFunction = (
  points: ReadonlyArray<LabeledPoint>,
  cellSize: number,
  cutoff: number,
) => number;

const accumulateInVisitOrder: AccumulateFunction = (
  points: ReadonlyArray<LabeledPoint>,
  cellSize: number,
  cutoff: number,
): number => {
  const arrays: PointArrays = toArrays(points);
  const grid: TopologySpatialGrid = gridFor(arrays, cellSize);
  let total: number = 0;
  forEachNearbyPair(
    grid,
    arrays.x,
    arrays.y,
    cutoff,
    (i: number, j: number): void => {
      const dx: number = arrays.x[i]! - arrays.x[j]!;
      const dy: number = arrays.y[i]! - arrays.y[j]!;
      total += 1 / (1 + dx * dx + dy * dy);
    },
  );
  return total;
};

/* Seeded xorshift32 — no Math.random anywhere in this file. */
type RandomFunction = () => number;
type MakeRandomFunction = (seed: number) => RandomFunction;

const makeRandom: MakeRandomFunction = (seed: number): RandomFunction => {
  let state: number = seed | 0 || 1;
  return (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
};

type MakeCloudFunction = (
  seed: number,
  count: number,
  spread: number,
) => Array<LabeledPoint>;

const makeCloud: MakeCloudFunction = (
  seed: number,
  count: number,
  spread: number,
): Array<LabeledPoint> => {
  const next: RandomFunction = makeRandom(seed);
  const points: Array<LabeledPoint> = [];
  for (let i: number = 0; i < count; i++) {
    points.push({
      label: `p-${String(i).padStart(3, "0")}`,
      x: (next() - 0.5) * spread,
      y: (next() - 0.5) * spread,
    });
  }
  return points;
};

type MakeLineFunction = (
  count: number,
  step: number,
  slope: number,
) => Array<LabeledPoint>;

const makeLine: MakeLineFunction = (
  count: number,
  step: number,
  slope: number,
): Array<LabeledPoint> => {
  const points: Array<LabeledPoint> = [];
  for (let i: number = 0; i < count; i++) {
    points.push({
      label: `l-${String(i).padStart(3, "0")}`,
      x: i * step,
      y: i * step * slope,
    });
  }
  return points;
};

type MakeCoincidentFunction = (count: number) => Array<LabeledPoint>;

const makeCoincident: MakeCoincidentFunction = (
  count: number,
): Array<LabeledPoint> => {
  const points: Array<LabeledPoint> = [];
  for (let i: number = 0; i < count; i++) {
    points.push({
      label: `c-${String(i).padStart(3, "0")}`,
      x: 17.5,
      y: -3.25,
    });
  }
  return points;
};

interface NamedPointSet {
  name: string;
  points: Array<LabeledPoint>;
}

/*
 * The shapes that break naive spatial hashes: everything in one cell,
 * everything on one line, clusters so far apart that the intervening
 * cells are empty, and a plain cloud.
 */
const pointSets: Array<NamedPointSet> = [
  { name: "empty", points: [] },
  { name: "one point", points: [{ label: "solo", x: 4, y: 9 }] },
  {
    name: "two points",
    points: [
      { label: "a", x: 0, y: 0 },
      { label: "b", x: 3, y: 4 },
    ],
  },
  { name: "nine coincident points", points: makeCoincident(9) },
  { name: "collinear along x", points: makeLine(14, 7, 0) },
  { name: "collinear along a diagonal", points: makeLine(14, 6.5, 1) },
  {
    name: "two widely separated clusters",
    points: [
      ...makeCloud(1234567, 8, 30),
      ...makeCloud(7654321, 8, 30).map((point: LabeledPoint): LabeledPoint => {
        return {
          label: `far-${point.label}`,
          x: point.x + 90000,
          y: point.y - 45000,
        };
      }),
    ],
  },
  { name: "pseudo-random cloud of 60", points: makeCloud(99991, 60, 400) },
  {
    name: "dense lattice with several points per cell",
    points: ((): Array<LabeledPoint> => {
      const points: Array<LabeledPoint> = [];
      for (let row: number = 0; row < 6; row++) {
        for (let column: number = 0; column < 6; column++) {
          points.push({
            label: `g-${String(row)}-${String(column)}`,
            x: column * 12.5,
            y: row * 12.5,
          });
        }
      }
      return points;
    })(),
  },
];

describe("buildSpatialGrid — every point lands in exactly one bucket", () => {
  test("each index appears once, and each bucket lists its indices ascending", () => {
    const arrays: PointArrays = toArrays(makeCloud(4242, 50, 300));
    const grid: TopologySpatialGrid = gridFor(arrays, 40);

    const seen: Array<number> = [];
    for (const bucket of grid.buckets.values()) {
      for (let i: number = 1; i < bucket.length; i++) {
        expect(bucket[i]!).toBeGreaterThan(bucket[i - 1]!);
      }
      seen.push(...bucket);
    }

    seen.sort((a: number, b: number): number => {
      return a - b;
    });
    const expected: Array<number> = [];
    for (let i: number = 0; i < arrays.count; i++) {
      expected.push(i);
    }
    expect(seen).toEqual(expected);
  });

  test("orderedKeys is strictly ascending and is exactly the bucket key set", () => {
    const arrays: PointArrays = toArrays(makeCloud(31337, 45, 500));
    const grid: TopologySpatialGrid = gridFor(arrays, 30);

    expect(grid.orderedKeys.length).toBe(grid.buckets.size);
    for (let i: number = 1; i < grid.orderedKeys.length; i++) {
      expect(grid.orderedKeys[i]!).toBeGreaterThan(grid.orderedKeys[i - 1]!);
    }
    for (const key of grid.orderedKeys) {
      expect(grid.buckets.has(key)).toBe(true);
    }
    expect(new Set<number>(grid.orderedKeys).size).toBe(
      grid.orderedKeys.length,
    );
  });

  test("points inside one cell share a bucket, points a cell apart do not", () => {
    const arrays: PointArrays = toArrays([
      { label: "a", x: 0.5, y: 0.5 },
      { label: "b", x: 9.5, y: 9.5 },
      { label: "c", x: 10.5, y: 0.5 },
    ]);
    const grid: TopologySpatialGrid = gridFor(arrays, 10);

    expect(grid.buckets.size).toBe(2);
    expect(grid.orderedKeys.length).toBe(2);
    const first: Array<number> = grid.buckets.get(grid.orderedKeys[0]!)!;
    expect(first).toEqual([0, 1]);
    expect(grid.buckets.get(grid.orderedKeys[1]!)!).toEqual([2]);
  });

  test("a one-cell step in x moves the key by one, in y by a whole row", () => {
    const arrays: PointArrays = toArrays([
      { label: "origin", x: 0, y: 0 },
      { label: "right", x: 10, y: 0 },
      { label: "down", x: 0, y: 10 },
    ]);
    const grid: TopologySpatialGrid = gridFor(arrays, 10);
    const keyOf: Map<number, number> = new Map<number, number>();
    for (const [key, bucket] of grid.buckets.entries()) {
      keyOf.set(bucket[0]!, key);
    }

    expect(keyOf.get(1)! - keyOf.get(0)!).toBe(1);
    expect(keyOf.get(2)! - keyOf.get(0)!).toBe(CELL_ROW_SPAN);
  });

  test("a point left of the origin sorts before one at the origin", () => {
    const arrays: PointArrays = toArrays([
      { label: "origin", x: 0, y: 0 },
      { label: "left", x: -0.001, y: 0 },
    ]);
    const grid: TopologySpatialGrid = gridFor(arrays, 10);
    // Index 1 is the left-hand cell, so it owns the smaller key.
    expect(grid.buckets.get(grid.orderedKeys[0]!)!).toEqual([1]);
    expect(grid.buckets.get(grid.orderedKeys[1]!)!).toEqual([0]);
  });

  test("a zero, negative or non-finite cellSize falls back to one", () => {
    const arrays: PointArrays = toArrays(makeLine(4, 1, 0));
    expect(gridFor(arrays, 0).cellSize).toBe(1);
    expect(gridFor(arrays, -25).cellSize).toBe(1);
    expect(gridFor(arrays, Number.NaN).cellSize).toBe(1);
    expect(gridFor(arrays, Number.POSITIVE_INFINITY).cellSize).toBe(1);
    // A usable cell size is kept verbatim.
    expect(gridFor(arrays, 37.5).cellSize).toBe(37.5);
  });

  test("count is clamped to the shorter of the two coordinate arrays", () => {
    const x: Float64Array = Float64Array.from([0, 100, 200, 300]);
    const y: Float64Array = Float64Array.from([0, 0]);
    const grid: TopologySpatialGrid = buildSpatialGrid(x, y, 4, 10);

    const indices: Array<number> = [];
    for (const bucket of grid.buckets.values()) {
      indices.push(...bucket);
    }
    expect(indices.sort()).toEqual([0, 1]);
  });

  test("a count of zero or a negative count buckets nothing", () => {
    const arrays: PointArrays = toArrays(makeCloud(11, 6, 100));
    const empty: TopologySpatialGrid = buildSpatialGrid(
      arrays.x,
      arrays.y,
      0,
      25,
    );
    expect(empty.buckets.size).toBe(0);
    expect(empty.orderedKeys).toEqual([]);
    expect(empty.cellSize).toBe(25);

    const negative: TopologySpatialGrid = buildSpatialGrid(
      arrays.x,
      arrays.y,
      -7,
      25,
    );
    expect(negative.buckets.size).toBe(0);
    expect(negative.orderedKeys).toEqual([]);
  });

  test("a count past the end of the arrays never emits an out-of-range index", () => {
    const arrays: PointArrays = toArrays(makeCloud(5150, 5, 80));
    const huge: TopologySpatialGrid = buildSpatialGrid(
      arrays.x,
      arrays.y,
      1000000,
      20,
    );
    for (const bucket of huge.buckets.values()) {
      for (const index of bucket) {
        expect(index).toBeLessThan(arrays.x.length);
        expect(index).toBeGreaterThanOrEqual(0);
      }
    }

    // A fractional count must not read past the arrays either.
    const fractional: TopologySpatialGrid = buildSpatialGrid(
      arrays.x,
      arrays.y,
      2.5,
      20,
    );
    for (const bucket of fractional.buckets.values()) {
      for (const index of bucket) {
        expect(index).toBeLessThan(arrays.x.length);
      }
    }
  });

  test("non-finite coordinates are bucketed at the origin, never dropped", () => {
    /*
     * The caller's arrays are index aligned with its node list, so a NaN
     * position must still occupy an index in the grid — silently skipping
     * it would desynchronise the two.
     */
    const arrays: PointArrays = toArrays([
      { label: "nan", x: Number.NaN, y: Number.NaN },
      { label: "posinf", x: Number.POSITIVE_INFINITY, y: 0 },
      { label: "neginf", x: 0, y: Number.NEGATIVE_INFINITY },
      { label: "origin", x: 0.5, y: 0.5 },
    ]);
    const grid: TopologySpatialGrid = gridFor(arrays, 10);

    const indices: Array<number> = [];
    for (const bucket of grid.buckets.values()) {
      indices.push(...bucket);
    }
    expect(indices.sort()).toEqual([0, 1, 2, 3]);
    // All four map to cell (0, 0): the finite halves are inside it too.
    expect(grid.buckets.size).toBe(1);
    expect(grid.orderedKeys.length).toBe(1);
  });

  test("rebuilding from the same input yields an identical grid", () => {
    const arrays: PointArrays = toArrays(makeCloud(24680, 40, 350));
    const first: TopologySpatialGrid = gridFor(arrays, 55);
    const second: TopologySpatialGrid = gridFor(arrays, 55);
    expect(second.orderedKeys).toEqual(first.orderedKeys);
    expect(Array.from(second.buckets.entries())).toEqual(
      Array.from(first.buckets.entries()),
    );
  });
});

describe("forEachNearbyPair — with no cutoff it agrees with brute force", () => {
  /*
   * HEADLINE. The grid is an optimisation, not a filter. Removing the
   * cutoff must leave a plain double loop: same pair count, same pairs,
   * lower index first. Anything the grid drops here is a bug the cutoff
   * would otherwise hide.
   */
  test("an infinite cutoff visits exactly the brute-force pair set", () => {
    for (const set of pointSets) {
      const arrays: PointArrays = toArrays(set.points);
      for (const cellSize of [1, 7, 40, 1000]) {
        const grid: TopologySpatialGrid = gridFor(arrays, cellSize);
        const visited: Array<string> = collectPairKeys(
          grid,
          arrays,
          Number.POSITIVE_INFINITY,
        );
        const expected: Array<string> = bruteForcePairKeys(
          arrays,
          Number.POSITIVE_INFINITY,
        );
        expect(visited.length).toBe(expected.length);
        expect(sortStrings(visited)).toEqual(sortStrings(expected));
      }
    }
  });

  test("an infinite cutoff visits n(n-1)/2 pairs, each exactly once", () => {
    for (const set of pointSets) {
      const arrays: PointArrays = toArrays(set.points);
      const grid: TopologySpatialGrid = gridFor(arrays, 25);
      const visited: Array<string> = collectPairKeys(
        grid,
        arrays,
        Number.POSITIVE_INFINITY,
      );
      const n: number = arrays.count;
      const expectedCount: number = n > 1 ? (n * (n - 1)) / 2 : 0;
      expect(visited.length).toBe(expectedCount);
      expect(new Set<string>(visited).size).toBe(visited.length);
    }
  });

  test("the lower index is always reported first, and never against itself", () => {
    for (const set of pointSets) {
      const arrays: PointArrays = toArrays(set.points);
      const grid: TopologySpatialGrid = gridFor(arrays, 12);
      forEachNearbyPair(
        grid,
        arrays.x,
        arrays.y,
        Number.POSITIVE_INFINITY,
        (i: number, j: number): void => {
          expect(i).toBeLessThan(j);
        },
      );
    }
  });

  test("a NaN, zero or negative cutoff also means no cutoff at all", () => {
    /*
     * reachForCutoff treats anything that is not a positive finite number
     * as "every pair". A caller passing 0 gets the whole graph, not an
     * empty traversal — surprising, but it is the documented degenerate.
     */
    const arrays: PointArrays = toArrays(makeCloud(777, 24, 260));
    const grid: TopologySpatialGrid = gridFor(arrays, 30);
    const everyPair: Array<string> = bruteForcePairKeys(
      arrays,
      Number.POSITIVE_INFINITY,
    );
    for (const cutoff of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sortStrings(collectPairKeys(grid, arrays, cutoff))).toEqual(
        sortStrings(everyPair),
      );
    }
  });
});

describe("forEachNearbyPair — the visit order is fixed by the graph", () => {
  /*
   * HEADLINE. Buckets are walked in ascending key order rather than Map
   * insertion order, so the visit sequence depends on where the points
   * are and not on the order they arrived in. Without that, a reordered
   * input accumulates the same forces in a different sequence, and
   * because floating point addition is not associative the coordinates
   * drift apart over a couple of hundred iterations.
   */
  const cellSize: number = 10;

  /* Four cells, three of them holding more than one point. */
  const inOrder: Array<LabeledPoint> = [
    { label: "a1", x: 1, y: 1 },
    { label: "a2", x: 2, y: 2 },
    { label: "a3", x: 3, y: 1 },
    { label: "b1", x: 21, y: 1 },
    { label: "b2", x: 22, y: 3 },
    { label: "c1", x: 4, y: 21 },
    { label: "c2", x: 5, y: 25 },
    { label: "d1", x: 31, y: 31 },
    { label: "d2", x: 35, y: 35 },
    { label: "d3", x: 33, y: 39 },
  ];

  /*
   * The same points interleaved so that a different cell is touched
   * first — and therefore inserted into the bucket Map first — while the
   * relative order inside each cell is untouched.
   */
  const interleaved: Array<LabeledPoint> = [
    { label: "d1", x: 31, y: 31 },
    { label: "c1", x: 4, y: 21 },
    { label: "b1", x: 21, y: 1 },
    { label: "a1", x: 1, y: 1 },
    { label: "d2", x: 35, y: 35 },
    { label: "c2", x: 5, y: 25 },
    { label: "b2", x: 22, y: 3 },
    { label: "a2", x: 2, y: 2 },
    { label: "d3", x: 33, y: 39 },
    { label: "a3", x: 3, y: 1 },
  ];

  test("inserting the points in a different order walks the same pair sequence", () => {
    const first: Array<string> = collectLabelPairs(
      inOrder,
      cellSize,
      Number.POSITIVE_INFINITY,
    );
    const second: Array<string> = collectLabelPairs(
      interleaved,
      cellSize,
      Number.POSITIVE_INFINITY,
    );
    expect(second).toEqual(first);
    expect(first.length).toBe((inOrder.length * (inOrder.length - 1)) / 2);
  });

  test("a finite cutoff keeps the same order independence", () => {
    const first: Array<string> = collectLabelPairs(inOrder, cellSize, 25);
    const second: Array<string> = collectLabelPairs(interleaved, cellSize, 25);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });

  test("summing over the visit order is bit-identical under reordering", () => {
    /*
     * The point of the ordering guarantee, stated the way the force pass
     * feels it: toBe, not toBeCloseTo. A different visit order would
     * change the low bits of this sum.
     */
    expect(
      accumulateInVisitOrder(interleaved, cellSize, Number.POSITIVE_INFINITY),
    ).toBe(accumulateInVisitOrder(inOrder, cellSize, Number.POSITIVE_INFINITY));
    expect(accumulateInVisitOrder(interleaved, cellSize, 25)).toBe(
      accumulateInVisitOrder(inOrder, cellSize, 25),
    );
  });

  test("a reversed cloud walks the same pair sequence as the original", () => {
    const cloud: Array<LabeledPoint> = makeCloud(60606, 36, 120);
    /*
     * Reversal flips the relative order inside every cell as well, so the
     * two runs cannot produce the same sequence element for element — but
     * grouping by the bucket walk means the multiset per cell pair is
     * identical, which is what the sorted comparison checks.
     */
    const first: Array<string> = collectLabelPairs(cloud, 20, 45);
    const second: Array<string> = collectLabelPairs(
      [...cloud].reverse(),
      20,
      45,
    );
    expect(sortStrings(second)).toEqual(sortStrings(first));
  });

  test("traversing one grid twice reports the identical index sequence", () => {
    const arrays: PointArrays = toArrays(makeCloud(4321, 30, 200));
    const grid: TopologySpatialGrid = gridFor(arrays, 35);
    expect(collectPairKeys(grid, arrays, 70)).toEqual(
      collectPairKeys(grid, arrays, 70),
    );
  });
});

describe("forEachNearbyPair — the cutoff", () => {
  test("every pair inside the cutoff is visited once and only once", () => {
    const arrays: PointArrays = toArrays(makeCloud(8080, 70, 300));
    const cutoff: number = 45;
    const grid: TopologySpatialGrid = gridFor(arrays, cutoff);

    const counts: Map<string, number> = new Map<string, number>();
    forEachNearbyPair(
      grid,
      arrays.x,
      arrays.y,
      cutoff,
      (i: number, j: number): void => {
        const key: string = `${String(i)}-${String(j)}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      },
    );

    const expected: Array<string> = bruteForcePairKeys(arrays, cutoff);
    expect(expected.length).toBeGreaterThan(0);
    expect(counts.size).toBe(expected.length);
    for (const key of expected) {
      expect(counts.get(key)).toBe(1);
    }
  });

  test("no pair beyond the cutoff is ever visited", () => {
    const arrays: PointArrays = toArrays(makeCloud(1357, 60, 400));
    const cutoff: number = 50;
    const grid: TopologySpatialGrid = gridFor(arrays, cutoff);
    forEachNearbyPair(
      grid,
      arrays.x,
      arrays.y,
      cutoff,
      (i: number, j: number): void => {
        const dx: number = arrays.x[i]! - arrays.x[j]!;
        const dy: number = arrays.y[i]! - arrays.y[j]!;
        expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThanOrEqual(cutoff);
      },
    );
  });

  test("a pair exactly at the cutoff distance is inside it", () => {
    const arrays: PointArrays = toArrays([
      { label: "a", x: 0, y: 0 },
      { label: "b", x: 0, y: 30 },
      { label: "c", x: 0, y: 30.000001 },
    ]);
    const grid: TopologySpatialGrid = gridFor(arrays, 30);
    const visited: Array<string> = collectPairKeys(grid, arrays, 30);
    // Exactly 30 away is in; a hair further is out.
    expect(visited).toContain("0-1");
    expect(visited).not.toContain("0-2");
    expect(visited).toContain("1-2");
  });

  test("distant clusters produce no cross-cluster pairs", () => {
    const arrays: PointArrays = toArrays([
      { label: "near-a", x: 0, y: 0 },
      { label: "near-b", x: 5, y: 5 },
      { label: "far-a", x: 4000, y: 0 },
      { label: "far-b", x: 4005, y: 5 },
    ]);
    const grid: TopologySpatialGrid = gridFor(arrays, 20);
    expect(collectPairKeys(grid, arrays, 20)).toEqual(["0-1", "2-3"]);
  });

  test("a cutoff many times the cell size still finds every pair inside it", () => {
    /*
     * The neighbourhood is widened by ceil(cutoff / cellSize) cells. A
     * deliberately tiny cell forces that widening to do the work.
     */
    const arrays: PointArrays = toArrays(makeCloud(20250803, 55, 220));
    const cutoff: number = 60;
    const grid: TopologySpatialGrid = gridFor(arrays, 5);
    expect(grid.cellSize).toBe(5);
    const expected: Array<string> = bruteForcePairKeys(arrays, cutoff);
    expect(expected.length).toBeGreaterThan(0);
    expect(sortStrings(collectPairKeys(grid, arrays, cutoff))).toEqual(
      sortStrings(expected),
    );
  });

  test("a cutoff smaller than the cell size still finds every pair inside it", () => {
    const arrays: PointArrays = toArrays(makeCloud(13579, 55, 220));
    const cutoff: number = 7;
    const grid: TopologySpatialGrid = gridFor(arrays, 100);
    const expected: Array<string> = bruteForcePairKeys(arrays, cutoff);
    expect(expected.length).toBeGreaterThan(0);
    expect(sortStrings(collectPairKeys(grid, arrays, cutoff))).toEqual(
      sortStrings(expected),
    );
  });

  test("every point set agrees with brute force at a matched cell and cutoff", () => {
    for (const set of pointSets) {
      const arrays: PointArrays = toArrays(set.points);
      const cutoff: number = 26;
      const grid: TopologySpatialGrid = gridFor(arrays, cutoff);
      expect(sortStrings(collectPairKeys(grid, arrays, cutoff))).toEqual(
        sortStrings(bruteForcePairKeys(arrays, cutoff)),
      );
    }
  });
});

describe("forEachNearbyPair — degenerate and hostile input", () => {
  test("an empty grid visits nothing", () => {
    const arrays: PointArrays = toArrays([]);
    const grid: TopologySpatialGrid = gridFor(arrays, 20);
    expect(collectPairKeys(grid, arrays, 20)).toEqual([]);
    expect(collectPairKeys(grid, arrays, Number.POSITIVE_INFINITY)).toEqual([]);
  });

  test("a single point has no pair to visit", () => {
    const arrays: PointArrays = toArrays([{ label: "solo", x: 3, y: 3 }]);
    const grid: TopologySpatialGrid = gridFor(arrays, 20);
    expect(collectPairKeys(grid, arrays, 20)).toEqual([]);
  });

  test("a grid built with count zero visits nothing over a full array", () => {
    const arrays: PointArrays = toArrays(makeCloud(2468, 10, 60));
    const grid: TopologySpatialGrid = buildSpatialGrid(
      arrays.x,
      arrays.y,
      0,
      20,
    );
    expect(collectPairKeys(grid, arrays, 20)).toEqual([]);
  });

  test("a cellSize of zero or a negative one still agrees with brute force", () => {
    const arrays: PointArrays = toArrays(makeCloud(97531, 30, 40));
    for (const cellSize of [0, -12, Number.NaN]) {
      const grid: TopologySpatialGrid = gridFor(arrays, cellSize);
      expect(grid.cellSize).toBe(1);
      expect(sortStrings(collectPairKeys(grid, arrays, 6))).toEqual(
        sortStrings(bruteForcePairKeys(arrays, 6)),
      );
    }
  });

  test("a NaN coordinate is never paired with anything, and does not throw", () => {
    /*
     * A NaN separation fails the "within cutoff" comparison, so the point
     * is bucketed but never reported. Every finite pair is still visited,
     * which is what keeps one poisoned node from poisoning the pass.
     */
    const arrays: PointArrays = toArrays([
      { label: "a", x: 0, y: 0 },
      { label: "broken", x: Number.NaN, y: 0 },
      { label: "b", x: 5, y: 0 },
    ]);
    const grid: TopologySpatialGrid = gridFor(arrays, 20);
    expect(collectPairKeys(grid, arrays, 20)).toEqual(["0-2"]);
    expect(collectPairKeys(grid, arrays, Number.POSITIVE_INFINITY)).toEqual([
      "0-2",
    ]);
  });

  test("an infinite coordinate is outside every finite cutoff", () => {
    const arrays: PointArrays = toArrays([
      { label: "a", x: 0, y: 0 },
      { label: "runaway", x: Number.POSITIVE_INFINITY, y: 0 },
      { label: "b", x: 5, y: 0 },
    ]);
    const grid: TopologySpatialGrid = gridFor(arrays, 20);
    expect(collectPairKeys(grid, arrays, 20)).toEqual(["0-2"]);
  });

  test("a count larger than the arrays traverses only the real points", () => {
    const arrays: PointArrays = toArrays(makeCloud(864209, 12, 90));
    const grid: TopologySpatialGrid = buildSpatialGrid(
      arrays.x,
      arrays.y,
      9999,
      30,
    );
    expect(sortStrings(collectPairKeys(grid, arrays, 30))).toEqual(
      sortStrings(bruteForcePairKeys(arrays, 30)),
    );
  });

  test("a grid whose buckets are empty of keys visits nothing", () => {
    const arrays: PointArrays = toArrays(makeCloud(5, 4, 20));
    const hollow: TopologySpatialGrid = {
      cellSize: 10,
      buckets: new Map<number, Array<number>>(),
      orderedKeys: [],
    };
    expect(collectPairKeys(hollow, arrays, 10)).toEqual([]);
  });
});

describe("forEachNearbyPair — coordinates past the addressable cell range", () => {
  /*
   * REGRESSION. Cell coordinates are clamped into a 65536-wide window, so
   * a neighbour offset taken from a cell sitting on that window's edge
   * used to clamp straight back onto a cell already scanned. The scan
   * then paired a bucket with ITSELF, reporting (i, i) with a zero
   * separation and reporting every genuine pair once per offset that
   * collapsed onto it. A repulsion pass handed (i, i) divides by a zero
   * distance and poisons the whole layout.
   */
  const beyondRange: number = CELL_BIAS + 7232;

  test("two points past the positive edge are reported once, never against themselves", () => {
    const arrays: PointArrays = toArrays([
      { label: "far-a", x: beyondRange, y: 0 },
      { label: "far-b", x: beyondRange + 1, y: 0 },
      { label: "home", x: 0, y: 0 },
    ]);
    const grid: TopologySpatialGrid = buildSpatialGrid(
      arrays.x,
      arrays.y,
      arrays.count,
      1,
    );
    expect(collectPairKeys(grid, arrays, 3)).toEqual(["0-1"]);
  });

  test("two points past the negative edge on adjacent rows are reported once", () => {
    const arrays: PointArrays = toArrays([
      { label: "far-a", x: -beyondRange, y: 0 },
      { label: "far-b", x: -beyondRange, y: 1 },
    ]);
    const grid: TopologySpatialGrid = buildSpatialGrid(
      arrays.x,
      arrays.y,
      arrays.count,
      1,
    );
    expect(collectPairKeys(grid, arrays, 3)).toEqual(["0-1"]);
  });

  test("out-of-range points still agree with brute force", () => {
    const arrays: PointArrays = toArrays([
      { label: "far-a", x: beyondRange, y: beyondRange },
      { label: "far-b", x: beyondRange + 2, y: beyondRange + 1 },
      { label: "far-c", x: -beyondRange, y: -beyondRange },
      { label: "home-a", x: 0, y: 0 },
      { label: "home-b", x: 2, y: 2 },
    ]);
    const grid: TopologySpatialGrid = buildSpatialGrid(
      arrays.x,
      arrays.y,
      arrays.count,
      1,
    );
    const visited: Array<string> = collectPairKeys(grid, arrays, 4);
    expect(sortStrings(visited)).toEqual(
      sortStrings(bruteForcePairKeys(arrays, 4)),
    );
    expect(new Set<string>(visited).size).toBe(visited.length);
  });
});
