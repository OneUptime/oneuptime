import GridLayoutUtil, {
  GridPosition,
  GridRect,
} from "../../../Utils/Dashboard/GridLayout";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

type RectSpec = Partial<GridRect> & { id: string };

function rect(spec: RectSpec): GridRect {
  return {
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    minWidth: 1,
    minHeight: 1,
    ...spec,
  };
}

/** Recursively freeze a layout so any engine mutation throws. */
function frozen(rects: Array<GridRect>): Array<GridRect> {
  for (const r of rects) {
    Object.freeze(r);
  }
  return Object.freeze(rects) as Array<GridRect>;
}

function byId(rects: Array<GridRect>, id: string): GridRect {
  const found: GridRect | undefined = rects.find((r: GridRect) => {
    return r.id === id;
  });
  if (!found) {
    throw new Error(`rect ${id} missing from layout`);
  }
  return found;
}

function expectValidLayout(rects: Array<GridRect>): void {
  expect(GridLayoutUtil.hasNoOverlaps(rects)).toBe(true);
  for (const r of rects) {
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.left + r.width).toBeLessThanOrEqual(GridLayoutUtil.DefaultColumns);
    expect(r.width).toBeGreaterThanOrEqual(1);
    expect(r.height).toBeGreaterThanOrEqual(1);
  }
}

/** Deterministic PRNG so the property-style tests are reproducible. */
function makeRandom(seed: number): () => number {
  let state: number = seed >>> 0;
  return (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("GridLayoutUtil.rectsOverlap", () => {
  test("disjoint rects do not overlap", () => {
    expect(
      GridLayoutUtil.rectsOverlap(
        rect({ id: "a", left: 0, top: 0, width: 2, height: 2 }),
        rect({ id: "b", left: 4, top: 4, width: 2, height: 2 }),
      ),
    ).toBe(false);
  });

  test("edge-adjacent rects do not overlap", () => {
    // b starts exactly where a ends, horizontally and vertically.
    expect(
      GridLayoutUtil.rectsOverlap(
        rect({ id: "a", left: 0, top: 0, width: 2, height: 2 }),
        rect({ id: "b", left: 2, top: 0, width: 2, height: 2 }),
      ),
    ).toBe(false);
    expect(
      GridLayoutUtil.rectsOverlap(
        rect({ id: "a", left: 0, top: 0, width: 2, height: 2 }),
        rect({ id: "b", left: 0, top: 2, width: 2, height: 2 }),
      ),
    ).toBe(false);
  });

  test("partially intersecting rects overlap", () => {
    expect(
      GridLayoutUtil.rectsOverlap(
        rect({ id: "a", left: 0, top: 0, width: 3, height: 3 }),
        rect({ id: "b", left: 2, top: 2, width: 3, height: 3 }),
      ),
    ).toBe(true);
  });

  test("containment counts as overlap, both directions", () => {
    const outer: GridRect = rect({
      id: "a",
      left: 0,
      top: 0,
      width: 6,
      height: 6,
    });
    const inner: GridRect = rect({
      id: "b",
      left: 2,
      top: 2,
      width: 1,
      height: 1,
    });
    expect(GridLayoutUtil.rectsOverlap(outer, inner)).toBe(true);
    expect(GridLayoutUtil.rectsOverlap(inner, outer)).toBe(true);
  });

  test("identical rects overlap", () => {
    const a: GridRect = rect({ id: "a", left: 1, top: 1, width: 2, height: 2 });
    const b: GridRect = rect({ id: "b", left: 1, top: 1, width: 2, height: 2 });
    expect(GridLayoutUtil.rectsOverlap(a, b)).toBe(true);
  });
});

describe("GridLayoutUtil.clampRect", () => {
  test("negative coordinates are pulled to zero", () => {
    const clamped: GridRect = GridLayoutUtil.clampRect(
      rect({ id: "a", left: -3, top: -2, width: 2, height: 2 }),
    );
    expect(clamped.left).toBe(0);
    expect(clamped.top).toBe(0);
  });

  test("rect wider than the board is capped at board width", () => {
    const clamped: GridRect = GridLayoutUtil.clampRect(
      rect({ id: "a", width: 40, height: 2 }),
    );
    expect(clamped.width).toBe(GridLayoutUtil.DefaultColumns);
    expect(clamped.left).toBe(0);
  });

  test("rect hanging off the right edge slides back in", () => {
    const clamped: GridRect = GridLayoutUtil.clampRect(
      rect({ id: "a", left: 11, width: 4, height: 2 }),
    );
    expect(clamped.left + clamped.width).toBeLessThanOrEqual(
      GridLayoutUtil.DefaultColumns,
    );
    expect(clamped.width).toBe(4);
  });

  test("minimum sizes are enforced", () => {
    const clamped: GridRect = GridLayoutUtil.clampRect(
      rect({ id: "a", width: 1, height: 1, minWidth: 3, minHeight: 4 }),
    );
    expect(clamped.width).toBe(3);
    expect(clamped.height).toBe(4);
  });

  test("minWidth larger than the board is capped at the board", () => {
    const clamped: GridRect = GridLayoutUtil.clampRect(
      rect({ id: "a", width: 2, minWidth: 99 }),
    );
    expect(clamped.width).toBe(GridLayoutUtil.DefaultColumns);
  });

  test("fractional coordinates from old saved configs are rounded", () => {
    const clamped: GridRect = GridLayoutUtil.clampRect(
      rect({ id: "a", left: 2.4, top: 3.6, width: 2.5, height: 1.2 }),
    );
    expect(clamped.left).toBe(2);
    expect(clamped.top).toBe(4);
    expect(clamped.width).toBe(3);
    expect(clamped.height).toBe(1);
  });

  test("NaN and missing coordinates fall back to finite defaults", () => {
    const clamped: GridRect = GridLayoutUtil.clampRect(
      rect({
        id: "a",
        left: Number.NaN,
        top: undefined as unknown as number,
        width: Number.POSITIVE_INFINITY,
        height: Number.NaN,
        minWidth: 2,
        minHeight: 3,
      }),
    );
    expect(clamped.left).toBe(0);
    expect(clamped.top).toBe(0);
    expect(clamped.width).toBe(2);
    expect(clamped.height).toBe(3);
    expect(Number.isFinite(clamped.left)).toBe(true);
    expect(Number.isFinite(clamped.top)).toBe(true);
  });

  test("custom column count is respected", () => {
    const clamped: GridRect = GridLayoutUtil.clampRect(
      rect({ id: "a", left: 5, width: 4 }),
      6,
    );
    expect(clamped.left + clamped.width).toBeLessThanOrEqual(6);
  });
});

describe("GridLayoutUtil.moveRect", () => {
  test("moving into empty space moves only the target", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 0, top: 0, width: 3, height: 2 }),
      rect({ id: "b", left: 6, top: 0, width: 3, height: 2 }),
    ]);

    const moved: Array<GridRect> = GridLayoutUtil.moveRect({
      rects: layout,
      id: "a",
      left: 0,
      top: 5,
    });

    expect(byId(moved, "a")).toMatchObject({ left: 0, top: 5 });
    expect(byId(moved, "b")).toBe(byId(layout, "b"));
    expectValidLayout(moved);
  });

  test("dropping onto another widget pushes it straight down", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 0, top: 0, width: 3, height: 2 }),
      rect({ id: "b", left: 0, top: 4, width: 3, height: 2 }),
    ]);

    const moved: Array<GridRect> = GridLayoutUtil.moveRect({
      rects: layout,
      id: "a",
      left: 0,
      top: 4,
    });

    expect(byId(moved, "a")).toMatchObject({ left: 0, top: 4 });
    // b must sit just below a.
    expect(byId(moved, "b")).toMatchObject({ left: 0, top: 6 });
    expectValidLayout(moved);
  });

  test("pushes cascade through a stack of widgets", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 0, top: 0, width: 3, height: 2 }),
      rect({ id: "b", left: 0, top: 4, width: 3, height: 2 }),
      rect({ id: "c", left: 0, top: 6, width: 3, height: 2 }),
      rect({ id: "d", left: 0, top: 8, width: 3, height: 2 }),
    ]);

    const moved: Array<GridRect> = GridLayoutUtil.moveRect({
      rects: layout,
      id: "a",
      left: 0,
      top: 4,
    });

    expect(byId(moved, "a").top).toBe(4);
    expect(byId(moved, "b").top).toBe(6);
    expect(byId(moved, "c").top).toBe(8);
    expect(byId(moved, "d").top).toBe(10);
    expectValidLayout(moved);
  });

  test("widgets in other columns are untouched by a push", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 0, top: 0, width: 3, height: 2 }),
      rect({ id: "b", left: 0, top: 4, width: 3, height: 2 }),
      rect({ id: "side", left: 6, top: 4, width: 3, height: 2 }),
    ]);

    const moved: Array<GridRect> = GridLayoutUtil.moveRect({
      rects: layout,
      id: "a",
      left: 0,
      top: 4,
    });

    expect(byId(moved, "side")).toBe(byId(layout, "side"));
    expectValidLayout(moved);
  });

  test("no-op move returns the input array by reference", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 2, top: 3, width: 3, height: 2 }),
    ]);

    const moved: Array<GridRect> = GridLayoutUtil.moveRect({
      rects: layout,
      id: "a",
      left: 2,
      top: 3,
    });

    expect(moved).toBe(layout);
  });

  test("target position is clamped into the board", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 0, top: 0, width: 4, height: 2 }),
    ]);

    const moved: Array<GridRect> = GridLayoutUtil.moveRect({
      rects: layout,
      id: "a",
      left: 100,
      top: -5,
    });

    expect(byId(moved, "a")).toMatchObject({
      left: GridLayoutUtil.DefaultColumns - 4,
      top: 0,
    });
  });

  test("unknown id returns the input unchanged", () => {
    const layout: Array<GridRect> = frozen([rect({ id: "a" })]);
    expect(
      GridLayoutUtil.moveRect({
        rects: layout,
        id: "nope",
        left: 1,
        top: 1,
      }),
    ).toBe(layout);
  });

  test("moving down past a widget leaves the vacated space free (no gravity)", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 0, top: 0, width: 3, height: 2 }),
      rect({ id: "b", left: 0, top: 6, width: 3, height: 2 }),
    ]);

    const moved: Array<GridRect> = GridLayoutUtil.moveRect({
      rects: layout,
      id: "a",
      left: 0,
      top: 10,
    });

    // b keeps its deliberate position — no compaction upward.
    expect(byId(moved, "b")).toMatchObject({ left: 0, top: 6 });
    expect(byId(moved, "a")).toMatchObject({ left: 0, top: 10 });
  });

  test("preview semantics: recomputing from the origin never accumulates pushes", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 0, top: 0, width: 3, height: 2 }),
      rect({ id: "b", left: 0, top: 4, width: 3, height: 2 }),
    ]);

    // Drag a over b...
    const during: Array<GridRect> = GridLayoutUtil.moveRect({
      rects: layout,
      id: "a",
      left: 0,
      top: 4,
    });
    expect(byId(during, "b").top).toBe(6);

    // ...then back where it came from: b must be back at its home too.
    const after: Array<GridRect> = GridLayoutUtil.moveRect({
      rects: layout,
      id: "a",
      left: 0,
      top: 0,
    });
    expect(after).toBe(layout);
  });
});

describe("GridLayoutUtil.resizeRect", () => {
  test("growing south pushes the widget below", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 0, top: 0, width: 3, height: 2 }),
      rect({ id: "b", left: 0, top: 2, width: 3, height: 2 }),
    ]);

    const resized: Array<GridRect> = GridLayoutUtil.resizeRect({
      rects: layout,
      id: "a",
      left: 0,
      top: 0,
      width: 3,
      height: 4,
    });

    expect(byId(resized, "a").height).toBe(4);
    expect(byId(resized, "b").top).toBe(4);
    expectValidLayout(resized);
  });

  test("growing east pushes an overlapped right-hand neighbour down, not right", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 0, top: 0, width: 3, height: 2 }),
      rect({ id: "b", left: 3, top: 0, width: 3, height: 2 }),
    ]);

    const resized: Array<GridRect> = GridLayoutUtil.resizeRect({
      rects: layout,
      id: "a",
      left: 0,
      top: 0,
      width: 5,
      height: 2,
    });

    expect(byId(resized, "a").width).toBe(5);
    expect(byId(resized, "b")).toMatchObject({ left: 3, top: 2 });
    expectValidLayout(resized);
  });

  test("west resize keeps the right edge and moves left", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 4, top: 0, width: 3, height: 2 }),
    ]);

    const resized: Array<GridRect> = GridLayoutUtil.resizeRect({
      rects: layout,
      id: "a",
      left: 2,
      top: 0,
      width: 5,
      height: 2,
    });

    expect(byId(resized, "a")).toMatchObject({ left: 2, width: 5 });
  });

  test("minimum sizes cannot be resized away", () => {
    const layout: Array<GridRect> = frozen([
      rect({
        id: "a",
        left: 0,
        top: 0,
        width: 6,
        height: 6,
        minWidth: 3,
        minHeight: 2,
      }),
    ]);

    const resized: Array<GridRect> = GridLayoutUtil.resizeRect({
      rects: layout,
      id: "a",
      left: 0,
      top: 0,
      width: 1,
      height: 1,
    });

    expect(byId(resized, "a").width).toBe(3);
    expect(byId(resized, "a").height).toBe(2);
  });

  test("no-op resize returns the input array by reference", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 1, top: 1, width: 4, height: 3 }),
    ]);

    expect(
      GridLayoutUtil.resizeRect({
        rects: layout,
        id: "a",
        left: 1,
        top: 1,
        width: 4,
        height: 3,
      }),
    ).toBe(layout);
  });
});

describe("GridLayoutUtil.normalize", () => {
  test("valid layouts pass through with every reference preserved", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 0, top: 0, width: 3, height: 2 }),
      rect({ id: "b", left: 3, top: 0, width: 3, height: 2 }),
      rect({ id: "c", left: 0, top: 2, width: 6, height: 2 }),
    ]);

    const normalized: Array<GridRect> = GridLayoutUtil.normalize(layout);

    expect(GridLayoutUtil.areLayoutsEqual(layout, normalized)).toBe(true);
    for (let i: number = 0; i < layout.length; i++) {
      expect(normalized[i]).toBe(layout[i]);
    }
  });

  test("heals a fully-overlapping corrupted layout deterministically", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 0, top: 0, width: 6, height: 3 }),
      rect({ id: "b", left: 0, top: 0, width: 6, height: 3 }),
      rect({ id: "c", left: 0, top: 0, width: 6, height: 3 }),
    ]);

    const healed: Array<GridRect> = GridLayoutUtil.normalize(layout);

    expectValidLayout(healed);
    // Earlier array entries win the higher spots.
    expect(byId(healed, "a").top).toBe(0);
    expect(byId(healed, "b").top).toBe(3);
    expect(byId(healed, "c").top).toBe(6);

    // Running it again changes nothing (idempotent).
    const again: Array<GridRect> = GridLayoutUtil.normalize(healed);
    expect(GridLayoutUtil.areLayoutsEqual(healed, again)).toBe(true);
  });

  test("clamps out-of-bounds widgets while healing", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: -2, top: -4, width: 3, height: 2 }),
      rect({ id: "b", left: 10, top: 0, width: 6, height: 2 }),
    ]);

    const healed: Array<GridRect> = GridLayoutUtil.normalize(layout);
    expectValidLayout(healed);
  });

  test("heals NaN / missing geometry into finite positions", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 0, top: Number.NaN, width: 3, height: 2 }),
      rect({
        id: "b",
        left: undefined as unknown as number,
        top: 0,
        width: Number.NaN,
        height: 2,
      }),
      rect({ id: "c", left: 0, top: 0, width: 3, height: 2 }),
    ]);

    const healed: Array<GridRect> = GridLayoutUtil.normalize(layout);

    expectValidLayout(healed);
    for (const r of healed) {
      expect(Number.isFinite(r.left)).toBe(true);
      expect(Number.isFinite(r.top)).toBe(true);
      expect(Number.isFinite(r.width)).toBe(true);
      expect(Number.isFinite(r.height)).toBe(true);
    }

    // Healing converges: a second pass changes nothing.
    const again: Array<GridRect> = GridLayoutUtil.normalize(healed);
    expect(GridLayoutUtil.areLayoutsEqual(healed, again)).toBe(true);
  });

  test("duplicate ids (corrupt config) are healed as distinct widgets", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "dup", left: 0, top: 0, width: 2, height: 2 }),
      rect({ id: "dup", left: 0, top: 0, width: 2, height: 2 }),
    ]);

    const healed: Array<GridRect> = GridLayoutUtil.normalize(layout);

    // The duplicates must land on DIFFERENT spots, not collapse onto one.
    expect(GridLayoutUtil.hasNoOverlaps(healed)).toBe(true);
    expect(healed[0]).toMatchObject({ left: 0, top: 0 });
    expect(healed[1]).toMatchObject({ left: 0, top: 2 });

    // And healing converges instead of walking down the board forever.
    const again: Array<GridRect> = GridLayoutUtil.normalize(healed);
    expect(again[0]).toMatchObject({ left: 0, top: 0 });
    expect(again[1]).toMatchObject({ left: 0, top: 2 });
  });

  test("top-left widgets keep their spot; lower ones get pushed", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "low", left: 0, top: 2, width: 3, height: 3 }),
      rect({ id: "high", left: 0, top: 0, width: 3, height: 3 }),
    ]);

    const healed: Array<GridRect> = GridLayoutUtil.normalize(layout);

    expect(byId(healed, "high")).toMatchObject({ top: 0 });
    expect(byId(healed, "low").top).toBe(3);
    expectValidLayout(healed);
  });
});

describe("GridLayoutUtil.requiredRows", () => {
  test("empty layout needs zero rows", () => {
    expect(GridLayoutUtil.requiredRows([])).toBe(0);
  });

  test("returns the bottom edge of the lowest widget", () => {
    expect(
      GridLayoutUtil.requiredRows([
        rect({ id: "a", left: 0, top: 0, width: 3, height: 2 }),
        rect({ id: "b", left: 4, top: 7, width: 3, height: 4 }),
      ]),
    ).toBe(11);
  });

  test("a rect with NaN geometry cannot poison the total", () => {
    expect(
      GridLayoutUtil.requiredRows([
        rect({ id: "a", left: 0, top: Number.NaN, width: 3, height: 2 }),
        rect({ id: "b", left: 4, top: 3, width: 3, height: 4 }),
      ]),
    ).toBe(7);
  });
});

describe("GridLayoutUtil.findFirstFit", () => {
  test("empty board places at the origin", () => {
    expect(
      GridLayoutUtil.findFirstFit({ rects: [], width: 6, height: 3 }),
    ).toEqual({ left: 0, top: 0 });
  });

  test("fills the gap beside an existing widget", () => {
    const layout: Array<GridRect> = [
      rect({ id: "a", left: 0, top: 0, width: 6, height: 3 }),
    ];
    expect(
      GridLayoutUtil.findFirstFit({ rects: layout, width: 6, height: 3 }),
    ).toEqual({ left: 6, top: 0 });
  });

  test("skips a gap that is too small and takes the next fitting spot", () => {
    const layout: Array<GridRect> = [
      rect({ id: "a", left: 0, top: 0, width: 9, height: 3 }),
    ];
    // A 6-wide widget cannot fit in the 3-wide gap on row 0.
    expect(
      GridLayoutUtil.findFirstFit({ rects: layout, width: 6, height: 3 }),
    ).toEqual({ left: 0, top: 3 });
  });

  test("falls back to a fresh bottom row on a packed board", () => {
    const layout: Array<GridRect> = [
      rect({ id: "a", left: 0, top: 0, width: 12, height: 4 }),
    ];
    expect(
      GridLayoutUtil.findFirstFit({ rects: layout, width: 12, height: 2 }),
    ).toEqual({ left: 0, top: 4 });
  });

  test("finds an inner gap between widgets", () => {
    const layout: Array<GridRect> = [
      rect({ id: "a", left: 0, top: 0, width: 12, height: 2 }),
      rect({ id: "b", left: 0, top: 4, width: 12, height: 2 }),
    ];
    expect(
      GridLayoutUtil.findFirstFit({ rects: layout, width: 4, height: 2 }),
    ).toEqual({ left: 0, top: 2 });
  });

  test("width wider than the board is clamped and still placed", () => {
    const position: GridPosition = GridLayoutUtil.findFirstFit({
      rects: [],
      width: 99,
      height: 2,
    });
    expect(position).toEqual({ left: 0, top: 0 });
  });

  test("an existing rect with NaN geometry cannot break placement", () => {
    const layout: Array<GridRect> = [
      rect({ id: "broken", left: 0, top: Number.NaN, width: 3, height: 2 }),
      rect({ id: "ok", left: 0, top: 0, width: 12, height: 2 }),
    ];

    const position: GridPosition = GridLayoutUtil.findFirstFit({
      rects: layout,
      width: 6,
      height: 2,
    });

    expect(Number.isFinite(position.left)).toBe(true);
    expect(Number.isFinite(position.top)).toBe(true);
    expect(position.top).toBeGreaterThanOrEqual(0);
  });

  test("honours a non-default column count", () => {
    const layout: Array<GridRect> = [
      rect({ id: "a", left: 0, top: 0, width: 4, height: 2 }),
    ];
    // On a 6-column board a 4-wide widget cannot fit beside another 4-wide.
    expect(
      GridLayoutUtil.findFirstFit({
        rects: layout,
        width: 4,
        height: 2,
        columns: 6,
      }),
    ).toEqual({ left: 0, top: 2 });
  });
});

describe("GridLayoutUtil custom column counts", () => {
  test("moveRect clamps against the supplied column count", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 0, top: 0, width: 3, height: 2 }),
    ]);

    const moved: Array<GridRect> = GridLayoutUtil.moveRect({
      rects: layout,
      id: "a",
      left: 99,
      top: 0,
      columns: 6,
    });

    expect(byId(moved, "a")).toMatchObject({ left: 3, top: 0 });
  });

  test("resizeRect caps width at the supplied column count", () => {
    const layout: Array<GridRect> = frozen([
      rect({ id: "a", left: 0, top: 0, width: 3, height: 2 }),
    ]);

    const resized: Array<GridRect> = GridLayoutUtil.resizeRect({
      rects: layout,
      id: "a",
      left: 0,
      top: 0,
      width: 12,
      height: 2,
      columns: 6,
    });

    expect(byId(resized, "a").width).toBe(6);
  });
});

describe("GridLayoutUtil equality + overlap helpers", () => {
  test("areLayoutsEqual compares by id, not order", () => {
    const a: Array<GridRect> = [
      rect({ id: "a", left: 0, top: 0 }),
      rect({ id: "b", left: 5, top: 5 }),
    ];
    const b: Array<GridRect> = [
      rect({ id: "b", left: 5, top: 5 }),
      rect({ id: "a", left: 0, top: 0 }),
    ];
    expect(GridLayoutUtil.areLayoutsEqual(a, b)).toBe(true);
  });

  test("areLayoutsEqual detects a moved widget", () => {
    const a: Array<GridRect> = [rect({ id: "a", left: 0, top: 0 })];
    const b: Array<GridRect> = [rect({ id: "a", left: 1, top: 0 })];
    expect(GridLayoutUtil.areLayoutsEqual(a, b)).toBe(false);
  });

  test("hasNoOverlaps flags an overlapping pair", () => {
    expect(
      GridLayoutUtil.hasNoOverlaps([
        rect({ id: "a", left: 0, top: 0, width: 3, height: 3 }),
        rect({ id: "b", left: 1, top: 1, width: 3, height: 3 }),
      ]),
    ).toBe(false);
  });
});

describe("GridLayoutUtil DashboardBaseComponent bridge", () => {
  function component(data: {
    id: ObjectID;
    left: number;
    top: number;
    width: number;
    height: number;
  }): DashboardBaseComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentId: data.id,
      componentType: DashboardComponentType.Text,
      leftInDashboardUnits: data.left,
      topInDashboardUnits: data.top,
      widthInDashboardUnits: data.width,
      heightInDashboardUnits: data.height,
      minWidthInDashboardUnits: 1,
      minHeightInDashboardUnits: 1,
    };
  }

  test("round-trips components through rects", () => {
    const id: ObjectID = ObjectID.generate();
    const components: Array<DashboardBaseComponent> = [
      component({ id, left: 2, top: 3, width: 4, height: 5 }),
    ];

    const rects: Array<GridRect> =
      GridLayoutUtil.fromDashboardComponents(components);

    expect(rects[0]).toMatchObject({
      id: id.toString(),
      left: 2,
      top: 3,
      width: 4,
      height: 5,
    });

    const applied: Array<DashboardBaseComponent> =
      GridLayoutUtil.applyRectsToComponents(components, rects);

    // Nothing changed — the exact same object must come back.
    expect(applied[0]).toBe(components[0]);
  });

  test("apply writes new positions and keeps untouched components by reference", () => {
    const idA: ObjectID = ObjectID.generate();
    const idB: ObjectID = ObjectID.generate();
    const components: Array<DashboardBaseComponent> = [
      component({ id: idA, left: 0, top: 0, width: 3, height: 2 }),
      component({ id: idB, left: 6, top: 0, width: 3, height: 2 }),
    ];

    const rects: Array<GridRect> =
      GridLayoutUtil.fromDashboardComponents(components);
    const moved: Array<GridRect> = GridLayoutUtil.moveRect({
      rects,
      id: idA.toString(),
      left: 0,
      top: 5,
    });

    const applied: Array<DashboardBaseComponent> =
      GridLayoutUtil.applyRectsToComponents(components, moved);

    expect(applied[0]).toMatchObject({
      topInDashboardUnits: 5,
      leftInDashboardUnits: 0,
    });
    // Other fields survive.
    expect(applied[0]!.componentId.toString()).toBe(idA.toString());
    // Untouched component is the same reference.
    expect(applied[1]).toBe(components[1]);
  });

  test("missing minimum sizes default to 1", () => {
    const raw: DashboardBaseComponent = {
      ...component({
        id: ObjectID.generate(),
        left: 0,
        top: 0,
        width: 2,
        height: 2,
      }),
      minWidthInDashboardUnits: 0,
      minHeightInDashboardUnits: 0,
    };

    const rects: Array<GridRect> = GridLayoutUtil.fromDashboardComponents([
      raw,
    ]);
    expect(rects[0]).toMatchObject({ minWidth: 1, minHeight: 1 });
  });
});

describe("GridLayoutUtil property-style invariants", () => {
  test("random move/resize sequences always produce valid, in-bounds layouts", () => {
    const random: () => number = makeRandom(20260807);

    const randomInt: (max: number) => number = (max: number): number => {
      return Math.floor(random() * max);
    };

    // Build a random valid starting board.
    let layout: Array<GridRect> = [];
    for (let i: number = 0; i < 12; i++) {
      layout.push(
        rect({
          id: `w${i}`,
          left: randomInt(10),
          top: randomInt(20),
          width: 1 + randomInt(6),
          height: 1 + randomInt(4),
        }),
      );
    }
    layout = GridLayoutUtil.normalize(layout);
    expectValidLayout(layout);

    for (let step: number = 0; step < 300; step++) {
      const target: GridRect = layout[randomInt(layout.length)]!;

      const before: Array<GridRect> = frozen(
        layout.map((r: GridRect) => {
          return { ...r };
        }),
      );

      if (random() < 0.5) {
        layout = GridLayoutUtil.moveRect({
          rects: before,
          id: target.id,
          left: randomInt(14) - 1,
          top: randomInt(24) - 1,
        });
      } else {
        layout = GridLayoutUtil.resizeRect({
          rects: before,
          id: target.id,
          left: target.left,
          top: target.top,
          width: 1 + randomInt(13),
          height: 1 + randomInt(6),
        });
      }

      expectValidLayout(layout);

      // Every widget survives every operation.
      expect(layout.length).toBe(before.length);
      for (const r of before) {
        expect(
          layout.find((candidate: GridRect) => {
            return candidate.id === r.id;
          }),
        ).toBeDefined();
      }
    }
  });

  test("normalize heals any random garbage into a valid layout", () => {
    const random: () => number = makeRandom(777);

    for (let round: number = 0; round < 50; round++) {
      const garbage: Array<GridRect> = [];
      const count: number = 1 + Math.floor(random() * 15);

      for (let i: number = 0; i < count; i++) {
        garbage.push(
          rect({
            id: `g${i}`,
            left: Math.floor(random() * 30) - 8,
            top: Math.floor(random() * 30) - 8,
            width: Math.floor(random() * 20),
            height: Math.floor(random() * 10),
            minWidth: Math.floor(random() * 4),
            minHeight: Math.floor(random() * 4),
          }),
        );
      }

      const healed: Array<GridRect> = GridLayoutUtil.normalize(frozen(garbage));

      expectValidLayout(healed);
      expect(healed.length).toBe(garbage.length);

      // Idempotent: healing a healed board is a no-op.
      expect(
        GridLayoutUtil.areLayoutsEqual(
          healed,
          GridLayoutUtil.normalize(healed),
        ),
      ).toBe(true);
    }
  });
});
