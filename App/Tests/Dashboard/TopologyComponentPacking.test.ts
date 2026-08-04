import { describe, expect, test } from "@jest/globals";
import {
  COMPONENT_GAP,
  PackInput,
  PackResult,
  PackedBox,
  packComponentBoxes,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyPacking";

/*
 * Slack for comparisons that went through the vertical-centring halving.
 * Everything else in this file is exact integer arithmetic.
 */
const EPS: number = 1e-9;

const ROW: number = 1200;
const GAP: number = COMPONENT_GAP;

type MakeBoxFunction = (
  key: string,
  width: number,
  height: number,
) => PackInput;

const box: MakeBoxFunction = (
  key: string,
  width: number,
  height: number,
): PackInput => {
  return { key: key, width: width, height: height };
};

/* The module's own sanitisation, restated so expectations are independent. */
type SanitizeFunction = (value: number) => number;

const sanitize: SanitizeFunction = (value: number): number => {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
};

type PlacementForFunction = (
  boxes: Array<PackInput>,
  result: PackResult,
  key: string,
) => PackedBox;

const placementFor: PlacementForFunction = (
  boxes: Array<PackInput>,
  result: PackResult,
  key: string,
): PackedBox => {
  const index: number = boxes.findIndex((candidate: PackInput): boolean => {
    return candidate.key === key;
  });
  return result.placements[index]!;
};

/*
 * Recover the shelves from the placements alone, without re-implementing
 * the packer. Every member of a shelf overlaps that shelf's tallest box in
 * y (the tallest box spans the whole band and everything else is centred
 * inside it), and consecutive shelves are separated by the gap, so a
 * single sweep in y separates them. Members come back left to right.
 */
type ShelvesOfFunction = (
  placements: Array<PackedBox>,
) => Array<Array<PackedBox>>;

const shelvesOf: ShelvesOfFunction = (
  placements: Array<PackedBox>,
): Array<Array<PackedBox>> => {
  const byY: Array<PackedBox> = [...placements].sort(
    (a: PackedBox, b: PackedBox): number => {
      return a.y === b.y ? a.x - b.x : a.y - b.y;
    },
  );

  const shelves: Array<Array<PackedBox>> = [];
  let bandTop: number = 0;
  let bandBottom: number = Number.NEGATIVE_INFINITY;

  for (const placement of byY) {
    const startsShelf: boolean =
      shelves.length === 0 ||
      (placement.y >= bandBottom - EPS && placement.y !== bandTop);
    if (startsShelf) {
      shelves.push([]);
      bandTop = placement.y;
      bandBottom = placement.y + placement.height;
    } else {
      bandBottom = Math.max(bandBottom, placement.y + placement.height);
    }
    shelves[shelves.length - 1]!.push(placement);
  }

  for (const shelf of shelves) {
    shelf.sort((a: PackedBox, b: PackedBox): number => {
      return a.x - b.x;
    });
  }
  return shelves;
};

/* Every unordered pair that fails a touching-allowed AABB test. */
type OverlappingPairsFunction = (placements: Array<PackedBox>) => Array<string>;

const overlappingPairs: OverlappingPairsFunction = (
  placements: Array<PackedBox>,
): Array<string> => {
  const found: Array<string> = [];
  for (let i: number = 0; i < placements.length; i++) {
    for (let j: number = i + 1; j < placements.length; j++) {
      const a: PackedBox = placements[i]!;
      const b: PackedBox = placements[j]!;
      const disjointX: boolean =
        a.x + a.width <= b.x + EPS || b.x + b.width <= a.x + EPS;
      const disjointY: boolean =
        a.y + a.height <= b.y + EPS || b.y + b.height <= a.y + EPS;
      if (!disjointX && !disjointY) {
        found.push(`${String(i)} overlaps ${String(j)}`);
      }
    }
  }
  return found;
};

/*
 * Every unordered pair that is closer than `gap` on BOTH axes. Two boxes
 * on one shelf clear each other in x; boxes on different shelves clear
 * each other in y. Nothing may be tight on both.
 */
type SeparationViolationsFunction = (
  placements: Array<PackedBox>,
  gap: number,
) => Array<string>;

const separationViolations: SeparationViolationsFunction = (
  placements: Array<PackedBox>,
  gap: number,
): Array<string> => {
  const found: Array<string> = [];
  for (let i: number = 0; i < placements.length; i++) {
    for (let j: number = i + 1; j < placements.length; j++) {
      const a: PackedBox = placements[i]!;
      const b: PackedBox = placements[j]!;
      const clearX: number = Math.max(
        b.x - (a.x + a.width),
        a.x - (b.x + b.width),
      );
      const clearY: number = Math.max(
        b.y - (a.y + a.height),
        a.y - (b.y + b.height),
      );
      if (clearX < gap - EPS && clearY < gap - EPS) {
        found.push(`${String(i)} and ${String(j)} are tight on both axes`);
      }
    }
  }
  return found;
};

interface Extent {
  width: number;
  height: number;
}

type ExtentOfFunction = (placements: Array<PackedBox>) => Extent;

const extentOf: ExtentOfFunction = (placements: Array<PackedBox>): Extent => {
  let width: number = 0;
  let height: number = 0;
  for (const placement of placements) {
    width = Math.max(width, placement.x + placement.width);
    height = Math.max(height, placement.y + placement.height);
  }
  return { width: width, height: height };
};

/*
 * A realistic island field: one big site, two branches, some pairs and a
 * lone unmanaged peer. Sizes are chosen so the packing has three shelves
 * at ROW and every tie-break is exercised (two boxes share height 260,
 * two share 180, two share 100).
 */
const ISLANDS: Array<PackInput> = [
  box("core-site", 620, 420),
  box("branch-a", 380, 260),
  box("branch-b", 300, 260),
  box("lab", 240, 180),
  box("dmz", 200, 180),
  box("wifi-cell", 160, 120),
  box("pair-1", 140, 100),
  box("pair-2", 120, 100),
  box("lonely", 90, 90),
];

const PACKED: PackResult = packComponentBoxes(ISLANDS, ROW, GAP);

/* Deterministic xorshift — Math.random would make this fixture flap. */
type NextUnitFunction = () => number;
type MakeSeededUnitFunction = (seed: number) => NextUnitFunction;

const makeSeededUnit: MakeSeededUnitFunction = (
  seed: number,
): NextUnitFunction => {
  let state: number = seed >>> 0 || 0x9e3779b9;
  return (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
};

const nextUnit: NextUnitFunction = makeSeededUnit(0x5eed1234);
const RANDOM_ISLANDS: Array<PackInput> = [];
for (let i: number = 0; i < 24; i++) {
  RANDOM_ISLANDS.push(
    box(
      `island-${String(i).padStart(2, "0")}`,
      40 + Math.floor(nextUnit() * 400),
      40 + Math.floor(nextUnit() * 300),
    ),
  );
}

describe("COMPONENT_GAP", () => {
  test("islands clear each other by 56px", () => {
    expect(COMPONENT_GAP).toBe(56);
  });
});

describe("packComponentBoxes — degenerate inputs", () => {
  test("zero boxes returns an empty result sized 0 by 0", () => {
    const result: PackResult = packComponentBoxes([], ROW, GAP);
    expect(result.placements).toEqual([]);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  test("a single box is placed at the origin and reports its own size", () => {
    const only: Array<PackInput> = [box("solo", 340, 220)];
    const result: PackResult = packComponentBoxes(only, ROW, GAP);
    expect(result.placements).toEqual([
      { x: 0, y: 0, width: 340, height: 220 },
    ]);
    expect(result.width).toBe(340);
    /* The trailing gap the final closeShelf adds is not content. */
    expect(result.height).toBe(220);
  });

  test("a box of zero size still receives an index-aligned placement", () => {
    const result: PackResult = packComponentBoxes(
      [box("empty", 0, 0)],
      ROW,
      GAP,
    );
    expect(result.placements.length).toBe(1);
    expect(result.placements[0]).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  test("non-finite and negative dimensions collapse to zero, never to NaN", () => {
    const hostile: Array<PackInput> = [
      box("nan-width", Number.NaN, 100),
      box("negative-height", 120, -80),
      box("infinite-width", Number.POSITIVE_INFINITY, 60),
      box("negative-both", -10, -10),
      box("sane", 200, 140),
    ];
    const result: PackResult = packComponentBoxes(hostile, ROW, GAP);

    for (let i: number = 0; i < hostile.length; i++) {
      const placement: PackedBox = result.placements[i]!;
      expect(Number.isFinite(placement.x)).toBe(true);
      expect(Number.isFinite(placement.y)).toBe(true);
      expect(placement.width).toBe(sanitize(hostile[i]!.width));
      expect(placement.height).toBe(sanitize(hostile[i]!.height));
    }
    expect(Number.isFinite(result.width)).toBe(true);
    expect(Number.isFinite(result.height)).toBe(true);
    /* Only the one sane box has height, so the whole field is 140 tall. */
    expect(result.height).toBe(140);
    expect(overlappingPairs(result.placements)).toEqual([]);
  });

  test("a non-finite or non-positive gap packs with no clearance at all", () => {
    const flush: PackResult = packComponentBoxes(ISLANDS, ROW, 0);
    expect(packComponentBoxes(ISLANDS, ROW, Number.NaN)).toEqual(flush);
    expect(packComponentBoxes(ISLANDS, ROW, -40)).toEqual(flush);
    expect(packComponentBoxes(ISLANDS, ROW, Number.POSITIVE_INFINITY)).toEqual(
      flush,
    );
    /* Flush packing still never overlaps — boxes touch, they do not cross. */
    expect(overlappingPairs(flush.placements)).toEqual([]);
  });

  test("a non-positive or non-finite row limit puts every island on one shelf", () => {
    const unlimited: PackResult = packComponentBoxes(
      ISLANDS,
      Number.POSITIVE_INFINITY,
      GAP,
    );
    expect(packComponentBoxes(ISLANDS, 0, GAP)).toEqual(unlimited);
    expect(packComponentBoxes(ISLANDS, -1200, GAP)).toEqual(unlimited);
    expect(packComponentBoxes(ISLANDS, Number.NaN, GAP)).toEqual(unlimited);

    expect(shelvesOf(unlimited.placements).length).toBe(1);
    /* One shelf: total width is every box plus eight gaps. */
    expect(unlimited.width).toBe(2250 + 8 * GAP);
    expect(unlimited.height).toBe(420);
  });
});

describe("packComponentBoxes — an oversized island", () => {
  const wide: Array<PackInput> = [
    box("giant", 900, 300),
    box("a", 80, 80),
    box("b", 80, 70),
  ];
  const narrow: PackResult = packComponentBoxes(wide, 200, GAP);

  test("a box wider than the row limit is placed at full width, not clipped", () => {
    const giant: PackedBox = placementFor(wide, narrow, "giant");
    expect(giant.width).toBe(900);
    expect(giant.x).toBe(0);
    expect(giant.y).toBe(0);
  });

  test("the reported width grows to hold an over-wide box", () => {
    expect(narrow.width).toBe(900);
    expect(narrow.width).toBeGreaterThan(200);
  });

  test("an over-wide box gets a shelf to itself", () => {
    const shelves: Array<Array<PackedBox>> = shelvesOf(narrow.placements);
    expect(shelves[0]!.length).toBe(1);
    expect(shelves[0]![0]!.width).toBe(900);
    for (const other of ["a", "b"]) {
      expect(placementFor(wide, narrow, other).y).toBeGreaterThanOrEqual(
        300 + GAP,
      );
    }
  });
});

describe("packComponentBoxes — placement invariants", () => {
  test("placements are index-aligned with the input", () => {
    expect(PACKED.placements.length).toBe(ISLANDS.length);
    for (let i: number = 0; i < ISLANDS.length; i++) {
      expect(PACKED.placements[i]!.width).toBe(ISLANDS[i]!.width);
      expect(PACKED.placements[i]!.height).toBe(ISLANDS[i]!.height);
    }
  });

  test("no two placed islands overlap", () => {
    expect(overlappingPairs(PACKED.placements)).toEqual([]);
  });

  test("every pair of islands clears the gap on at least one axis", () => {
    expect(separationViolations(PACKED.placements, GAP)).toEqual([]);
  });

  test("shelves run strictly top to bottom, exactly one gap apart", () => {
    const shelves: Array<Array<PackedBox>> = shelvesOf(PACKED.placements);
    expect(shelves.length).toBe(3);
    for (let i: number = 1; i < shelves.length; i++) {
      const above: Array<PackedBox> = shelves[i - 1]!;
      const below: Array<PackedBox> = shelves[i]!;
      const bottom: number = Math.max(
        ...above.map((placement: PackedBox): number => {
          return placement.y + placement.height;
        }),
      );
      const top: number = Math.min(
        ...below.map((placement: PackedBox): number => {
          return placement.y;
        }),
      );
      expect(top).toBeGreaterThan(bottom);
      expect(top - bottom).toBeCloseTo(GAP, 6);
    }
  });

  test("boxes inside a shelf run strictly left to right from x = 0", () => {
    for (const shelf of shelvesOf(PACKED.placements)) {
      expect(shelf[0]!.x).toBe(0);
      for (let i: number = 1; i < shelf.length; i++) {
        const left: PackedBox = shelf[i - 1]!;
        const right: PackedBox = shelf[i]!;
        expect(right.x).toBeGreaterThan(left.x);
        expect(right.x - (left.x + left.width)).toBeCloseTo(GAP, 6);
      }
    }
  });

  test("the largest island leads: the tallest box owns the origin", () => {
    const core: PackedBox = placementFor(ISLANDS, PACKED, "core-site");
    expect(core.x).toBe(0);
    expect(core.y).toBe(0);
    expect(shelvesOf(PACKED.placements)[0]).toContain(core);
    /* Nothing may be placed above the tallest box. */
    for (const placement of PACKED.placements) {
      expect(placement.y).toBeGreaterThanOrEqual(0);
    }
  });

  /*
   * The golden layout, computed by hand from the algorithm. Every other
   * test in this file checks a property; this one pins the actual numbers,
   * so a change in shelf breaking, centring or the trailing-gap trim shows
   * up as a diff rather than silently satisfying the properties.
   */
  test("the island fixture packs to a known three-shelf layout", () => {
    expect(PACKED.placements).toEqual([
      { x: 0, y: 0, width: 620, height: 420 },
      { x: 676, y: 80, width: 380, height: 260 },
      { x: 0, y: 476, width: 300, height: 260 },
      { x: 356, y: 516, width: 240, height: 180 },
      { x: 652, y: 516, width: 200, height: 180 },
      { x: 908, y: 546, width: 160, height: 120 },
      { x: 0, y: 792, width: 140, height: 100 },
      { x: 196, y: 792, width: 120, height: 100 },
      { x: 372, y: 797, width: 90, height: 90 },
    ]);
    expect(PACKED.width).toBe(1068);
    expect(PACKED.height).toBe(892);
  });

  test("shelf heights never increase down the page", () => {
    const shelves: Array<Array<PackedBox>> = shelvesOf(PACKED.placements);
    const heights: Array<number> = shelves.map(
      (shelf: Array<PackedBox>): number => {
        return Math.max(
          ...shelf.map((placement: PackedBox): number => {
            return placement.height;
          }),
        );
      },
    );
    for (let i: number = 1; i < heights.length; i++) {
      expect(heights[i]!).toBeLessThanOrEqual(heights[i - 1]!);
    }
    expect(heights[0]).toBe(420);
  });

  test("heights never increase left to right within a shelf either", () => {
    for (const shelf of shelvesOf(PACKED.placements)) {
      for (let i: number = 1; i < shelf.length; i++) {
        expect(shelf[i]!.height).toBeLessThanOrEqual(shelf[i - 1]!.height);
      }
    }
  });

  test("each box is vertically centred in its own shelf band", () => {
    for (const shelf of shelvesOf(PACKED.placements)) {
      const top: number = Math.min(
        ...shelf.map((placement: PackedBox): number => {
          return placement.y;
        }),
      );
      const bottom: number = Math.max(
        ...shelf.map((placement: PackedBox): number => {
          return placement.y + placement.height;
        }),
      );
      for (const placement of shelf) {
        expect(placement.y - top).toBeCloseTo(
          bottom - (placement.y + placement.height),
          6,
        );
      }
    }
  });

  test("the reported width and height enclose every placement exactly", () => {
    const extent: Extent = extentOf(PACKED.placements);
    expect(PACKED.width).toBeCloseTo(extent.width, 6);
    expect(PACKED.height).toBeCloseTo(extent.height, 6);
    for (const placement of PACKED.placements) {
      expect(placement.x + placement.width).toBeLessThanOrEqual(
        PACKED.width + EPS,
      );
      expect(placement.y + placement.height).toBeLessThanOrEqual(
        PACKED.height + EPS,
      );
    }
  });

  test("no shelf's content exceeds the row limit unless a single box does", () => {
    for (const shelf of shelvesOf(PACKED.placements)) {
      const last: PackedBox = shelf[shelf.length - 1]!;
      const contentWidth: number = last.x + last.width;
      const widestMember: number = Math.max(
        ...shelf.map((placement: PackedBox): number => {
          return placement.width;
        }),
      );
      expect(contentWidth <= ROW || widestMember > ROW).toBe(true);
    }
  });
});

describe("packComponentBoxes — the append guarantee (why NFDH, not MaxRects)", () => {
  /*
   * The headline contract. The map re-polls every sixty seconds; a newly
   * discovered island must not shuffle the ones the operator is already
   * looking at. A free-rectangle packer (MaxRects, guillotine) rebuilds
   * its free list from the placement history, so one new box relocates
   * everything placed after it. NFDH's shelves depend only on the sorted
   * box list, so a box that sorts last lands last and nothing moves.
   */
  const APPENDED: Array<PackInput> = [
    ...ISLANDS,
    box("zz-new-endpoint", 60, 40),
  ];
  const REPACKED: PackResult = packComponentBoxes(APPENDED, ROW, GAP);

  test("appending a new small island leaves every earlier shelf untouched", () => {
    const before: Array<Array<PackedBox>> = shelvesOf(PACKED.placements);
    const after: Array<Array<PackedBox>> = shelvesOf(REPACKED.placements);
    expect(after.length).toBeGreaterThanOrEqual(before.length);
    for (let i: number = 0; i < before.length - 1; i++) {
      expect(after[i]).toEqual(before[i]);
    }
  });

  test("appending a new small island moves no existing box at all", () => {
    for (let i: number = 0; i < ISLANDS.length; i++) {
      expect(REPACKED.placements[i]).toEqual(PACKED.placements[i]);
    }
  });

  test("the appended island is itself placed, on the last shelf", () => {
    const added: PackedBox = placementFor(
      APPENDED,
      REPACKED,
      "zz-new-endpoint",
    );
    expect(added.width).toBe(60);
    expect(added.height).toBe(40);
    const shelves: Array<Array<PackedBox>> = shelvesOf(REPACKED.placements);
    expect(shelves[shelves.length - 1]).toContain(added);
    expect(overlappingPairs(REPACKED.placements)).toEqual([]);
  });

  test("an appended island that does not fit opens a fresh shelf, still moving nothing", () => {
    const tight: number = 700;
    const original: PackResult = packComponentBoxes(ISLANDS, tight, GAP);
    /* Wide enough to be pushed off the last shelf, short enough to sort last. */
    const grown: Array<PackInput> = [...ISLANDS, box("zz-wide-strip", 400, 40)];
    const repacked: PackResult = packComponentBoxes(grown, tight, GAP);

    for (let i: number = 0; i < ISLANDS.length; i++) {
      expect(repacked.placements[i]).toEqual(original.placements[i]);
    }
    expect(shelvesOf(repacked.placements).length).toBe(
      shelvesOf(original.placements).length + 1,
    );
    expect(repacked.height).toBeGreaterThan(original.height);
  });

  test("appending only ever grows the reported extent", () => {
    expect(REPACKED.width).toBeGreaterThanOrEqual(PACKED.width);
    expect(REPACKED.height).toBeGreaterThanOrEqual(PACKED.height);
  });

  test("the guarantee is for appended SMALL islands — a new tallest one does re-shelve", () => {
    /*
     * Documented limitation, not a defect. A component that becomes the
     * tallest sorts to the front and every shelf below it shifts. That is
     * inherent to height-sorted shelf packing, and it is the case the
     * operator can see coming (a whole new site appearing).
     */
    const withGiant: Array<PackInput> = [
      ...ISLANDS,
      box("mega-site", 700, 900),
    ];
    const repacked: PackResult = packComponentBoxes(withGiant, ROW, GAP);
    expect(placementFor(withGiant, repacked, "mega-site")).toEqual({
      x: 0,
      y: 0,
      width: 700,
      height: 900,
    });
    let moved: number = 0;
    for (let i: number = 0; i < ISLANDS.length; i++) {
      if (repacked.placements[i]!.y !== PACKED.placements[i]!.y) {
        moved++;
      }
    }
    expect(moved).toBe(ISLANDS.length);
  });
});

describe("packComponentBoxes — order independence", () => {
  test("permuting the input yields the identical placement for every key", () => {
    const rotated: Array<PackInput> = [
      ...ISLANDS.slice(4),
      ...ISLANDS.slice(0, 4),
    ];
    const reversed: Array<PackInput> = [...ISLANDS].reverse();
    const fromRotated: PackResult = packComponentBoxes(rotated, ROW, GAP);
    const fromReversed: PackResult = packComponentBoxes(reversed, ROW, GAP);

    for (const island of ISLANDS) {
      expect(placementFor(rotated, fromRotated, island.key)).toEqual(
        placementFor(ISLANDS, PACKED, island.key),
      );
      expect(placementFor(reversed, fromReversed, island.key)).toEqual(
        placementFor(ISLANDS, PACKED, island.key),
      );
    }
    expect(fromRotated.width).toBe(PACKED.width);
    expect(fromReversed.height).toBe(PACKED.height);
  });

  test("same-sized islands are ordered by key, never by arrival", () => {
    const forwards: Array<PackInput> = [
      box("zeta", 100, 100),
      box("alpha", 100, 100),
    ];
    const backwards: Array<PackInput> = [
      box("alpha", 100, 100),
      box("zeta", 100, 100),
    ];
    const first: PackResult = packComponentBoxes(forwards, ROW, GAP);
    const second: PackResult = packComponentBoxes(backwards, ROW, GAP);
    expect(placementFor(forwards, first, "alpha").x).toBe(0);
    expect(placementFor(forwards, first, "zeta").x).toBe(100 + GAP);
    expect(placementFor(backwards, second, "alpha").x).toBe(0);
    expect(placementFor(backwards, second, "zeta").x).toBe(100 + GAP);
  });

  test("width breaks a height tie before the key does", () => {
    const tied: Array<PackInput> = [
      box("aaa-narrow", 100, 200),
      box("zzz-wide", 300, 200),
    ];
    const result: PackResult = packComponentBoxes(tied, ROW, GAP);
    /* Wider first, even though its key sorts last. */
    expect(placementFor(tied, result, "zzz-wide").x).toBe(0);
    expect(placementFor(tied, result, "aaa-narrow").x).toBe(300 + GAP);
  });

  test("duplicate keys still produce a valid, non-overlapping packing", () => {
    /*
     * Keys are component root ids and so are unique in practice. If two
     * boxes ever collide on (height, width, key) the comparator returns 0
     * and their relative order falls back to input order — the two are
     * interchangeable, so the SET of positions is still stable.
     */
    const dupes: Array<PackInput> = [
      box("dup", 100, 100),
      box("dup", 100, 100),
      box("dup", 100, 100),
    ];
    const result: PackResult = packComponentBoxes(dupes, ROW, GAP);
    expect(overlappingPairs(result.placements)).toEqual([]);
    const xs: Array<number> = result.placements
      .map((placement: PackedBox): number => {
        return placement.x;
      })
      .sort((a: number, b: number): number => {
        return a - b;
      });
    expect(xs).toEqual([0, 100 + GAP, 2 * (100 + GAP)]);
  });

  test("packing is pure: the input array and its boxes are untouched", () => {
    const inputs: Array<PackInput> = [box("a", 120, 90), box("b", 80, 140)];
    const snapshot: Array<PackInput> = inputs.map(
      (input: PackInput): PackInput => {
        return { ...input };
      },
    );
    packComponentBoxes(inputs, ROW, GAP);
    expect(inputs).toEqual(snapshot);
  });

  test("repeated calls with the same input agree exactly", () => {
    expect(packComponentBoxes(ISLANDS, ROW, GAP)).toEqual(
      packComponentBoxes(ISLANDS, ROW, GAP),
    );
  });
});

describe("packComponentBoxes — a pseudo-random island field", () => {
  const result: PackResult = packComponentBoxes(RANDOM_ISLANDS, ROW, GAP);

  test("every island is placed with its own finite dimensions", () => {
    expect(result.placements.length).toBe(RANDOM_ISLANDS.length);
    for (let i: number = 0; i < RANDOM_ISLANDS.length; i++) {
      const placement: PackedBox = result.placements[i]!;
      expect(placement.width).toBe(RANDOM_ISLANDS[i]!.width);
      expect(placement.height).toBe(RANDOM_ISLANDS[i]!.height);
      expect(Number.isFinite(placement.x + placement.y)).toBe(true);
    }
  });

  test("no pair of twenty-four islands overlaps", () => {
    expect(overlappingPairs(result.placements)).toEqual([]);
  });

  test("no pair of twenty-four islands is tight on both axes", () => {
    expect(separationViolations(result.placements, GAP)).toEqual([]);
  });

  test("the reported extent encloses the whole field", () => {
    const extent: Extent = extentOf(result.placements);
    expect(result.width).toBeCloseTo(extent.width, 6);
    expect(result.height).toBeCloseTo(extent.height, 6);
  });

  test("the tallest of twenty-four islands is at the origin", () => {
    const tallest: number = Math.max(
      ...RANDOM_ISLANDS.map((island: PackInput): number => {
        return island.height;
      }),
    );
    const leader: PackedBox = result.placements.find(
      (placement: PackedBox): boolean => {
        return placement.x === 0 && placement.y === 0;
      },
    )!;
    expect(leader).toBeDefined();
    expect(leader.height).toBe(tallest);
  });

  test("appending a small island to a crowded field moves nothing", () => {
    const grown: Array<PackInput> = [
      ...RANDOM_ISLANDS,
      box("zz-late-arrival", 50, 30),
    ];
    const repacked: PackResult = packComponentBoxes(grown, ROW, GAP);
    for (let i: number = 0; i < RANDOM_ISLANDS.length; i++) {
      expect(repacked.placements[i]).toEqual(result.placements[i]);
    }
    expect(overlappingPairs(repacked.placements)).toEqual([]);
  });
});
