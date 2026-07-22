import { describe, expect, test } from "@jest/globals";
import {
  SiteGridOptions,
  SiteGridPosition,
  computeSiteGridLayout,
  gridColumnCount,
  gridRowCount,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteContainerLayout";

/*
 * Pins the SiteContainerGraph's grid layout: ceil(sqrt(n)) columns,
 * row-major placement in input order, determinism (the graph re-renders
 * from the same data and cards must never move), and the guarantee that
 * every id gets a position — which is what keeps every link edge
 * renderable (both endpoints always placed).
 */

const OPTIONS: SiteGridOptions = {
  cardWidth: 200,
  cardHeight: 100,
  gapX: 40,
  gapY: 30,
};

// Column step 240, row step 130 with OPTIONS.
const STEP_X: number = OPTIONS.cardWidth + OPTIONS.gapX;
const STEP_Y: number = OPTIONS.cardHeight + OPTIONS.gapY;

function ids(count: number): Array<string> {
  const result: Array<string> = [];
  for (let i: number = 0; i < count; i++) {
    result.push(`site-${i}`);
  }
  return result;
}

describe("gridColumnCount", () => {
  test("is ceil(sqrt(n))", () => {
    expect(gridColumnCount(1)).toBe(1);
    expect(gridColumnCount(2)).toBe(2);
    expect(gridColumnCount(4)).toBe(2);
    expect(gridColumnCount(5)).toBe(3);
    expect(gridColumnCount(9)).toBe(3);
    expect(gridColumnCount(10)).toBe(4);
    expect(gridColumnCount(16)).toBe(4);
    expect(gridColumnCount(17)).toBe(5);
  });

  test("degenerate counts yield zero columns", () => {
    expect(gridColumnCount(0)).toBe(0);
    expect(gridColumnCount(-3)).toBe(0);
    expect(gridColumnCount(Number.NaN)).toBe(0);
  });
});

describe("gridRowCount", () => {
  test("is the number of rows the grid actually uses", () => {
    expect(gridRowCount(1)).toBe(1);
    expect(gridRowCount(2)).toBe(1);
    expect(gridRowCount(4)).toBe(2);
    expect(gridRowCount(5)).toBe(2);
    expect(gridRowCount(7)).toBe(3);
    expect(gridRowCount(9)).toBe(3);
    expect(gridRowCount(10)).toBe(3);
    expect(gridRowCount(20)).toBe(4);
  });

  test("degenerate counts yield zero rows", () => {
    expect(gridRowCount(0)).toBe(0);
    expect(gridRowCount(-3)).toBe(0);
    expect(gridRowCount(Number.NaN)).toBe(0);
  });

  /*
   * The graph sizes its canvas from rows × card height, so a row count
   * that disagreed with where cards actually land would clip the last row
   * or leave a dead band under it.
   */
  test("agrees with the row every card is placed on", () => {
    for (const count of [1, 2, 3, 5, 9, 12, 17, 20, 23]) {
      const layout: Map<string, SiteGridPosition> = computeSiteGridLayout(
        ids(count),
        OPTIONS,
      );
      let lowestRowIndex: number = 0;
      for (const position of layout.values()) {
        lowestRowIndex = Math.max(lowestRowIndex, position.y / STEP_Y);
      }
      expect(gridRowCount(count)).toBe(lowestRowIndex + 1);
    }
  });
});

describe("computeSiteGridLayout", () => {
  test("empty set yields an empty layout", () => {
    expect(computeSiteGridLayout([], OPTIONS).size).toBe(0);
  });

  test("a single card sits at the origin", () => {
    const layout: Map<string, SiteGridPosition> = computeSiteGridLayout(
      ["only"],
      OPTIONS,
    );
    expect(layout.get("only")).toEqual({ x: 0, y: 0 });
  });

  test("four cards form a 2x2 grid, row-major in input order", () => {
    const layout: Map<string, SiteGridPosition> = computeSiteGridLayout(
      ["a", "b", "c", "d"],
      OPTIONS,
    );
    expect(layout.get("a")).toEqual({ x: 0, y: 0 });
    expect(layout.get("b")).toEqual({ x: STEP_X, y: 0 });
    expect(layout.get("c")).toEqual({ x: 0, y: STEP_Y });
    expect(layout.get("d")).toEqual({ x: STEP_X, y: STEP_Y });
  });

  test("five cards use 3 columns and wrap after the third", () => {
    const layout: Map<string, SiteGridPosition> = computeSiteGridLayout(
      ["a", "b", "c", "d", "e"],
      OPTIONS,
    );
    expect(layout.get("c")).toEqual({ x: 2 * STEP_X, y: 0 });
    expect(layout.get("d")).toEqual({ x: 0, y: STEP_Y });
    expect(layout.get("e")).toEqual({ x: STEP_X, y: STEP_Y });
  });

  test("every id gets exactly one position (edge endpoints always exist)", () => {
    const nodeIds: Array<string> = ids(23);
    const layout: Map<string, SiteGridPosition> = computeSiteGridLayout(
      nodeIds,
      OPTIONS,
    );
    expect(layout.size).toBe(23);
    // Every possible edge between placed ids has both endpoints placed.
    const edges: Array<[string, string]> = [
      ["site-0", "site-22"],
      ["site-7", "site-13"],
      ["site-4", "site-4"],
    ];
    for (const [from, to] of edges) {
      expect(layout.has(from)).toBe(true);
      expect(layout.has(to)).toBe(true);
    }
  });

  test("no two cards share a position", () => {
    const layout: Map<string, SiteGridPosition> = computeSiteGridLayout(
      ids(17),
      OPTIONS,
    );
    const seen: Set<string> = new Set<string>();
    for (const position of layout.values()) {
      const key: string = `${position.x}:${position.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test("is deterministic: identical calls produce identical layouts", () => {
    const nodeIds: Array<string> = ids(12);
    const first: Map<string, SiteGridPosition> = computeSiteGridLayout(
      nodeIds,
      OPTIONS,
    );
    const second: Map<string, SiteGridPosition> = computeSiteGridLayout(
      nodeIds,
      OPTIONS,
    );
    expect(Array.from(second.entries())).toEqual(Array.from(first.entries()));
  });

  test("duplicate ids collapse to their first occurrence", () => {
    const layout: Map<string, SiteGridPosition> = computeSiteGridLayout(
      ["a", "b", "a", "c", "b"],
      OPTIONS,
    );
    expect(layout.size).toBe(3);
    // 3 unique → 2 columns; 'a' keeps the first slot.
    expect(layout.get("a")).toEqual({ x: 0, y: 0 });
    expect(layout.get("b")).toEqual({ x: STEP_X, y: 0 });
    expect(layout.get("c")).toEqual({ x: 0, y: STEP_Y });
  });

  test("input order defines placement — reordering moves cards", () => {
    const forward: Map<string, SiteGridPosition> = computeSiteGridLayout(
      ["a", "b"],
      OPTIONS,
    );
    const reversed: Map<string, SiteGridPosition> = computeSiteGridLayout(
      ["b", "a"],
      OPTIONS,
    );
    expect(forward.get("a")).toEqual({ x: 0, y: 0 });
    expect(reversed.get("b")).toEqual({ x: 0, y: 0 });
    expect(reversed.get("a")).toEqual({ x: STEP_X, y: 0 });
  });

  test("malformed options never produce NaN coordinates", () => {
    const layout: Map<string, SiteGridPosition> = computeSiteGridLayout(
      ["a", "b", "c"],
      {
        cardWidth: Number.NaN,
        cardHeight: -10,
        gapX: Number.NaN,
        gapY: -5,
      },
    );
    expect(layout.size).toBe(3);
    for (const position of layout.values()) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
    // Width/height fall back to 1, gaps to 0 → columns step by 1.
    expect(layout.get("a")).toEqual({ x: 0, y: 0 });
    expect(layout.get("b")).toEqual({ x: 1, y: 0 });
    expect(layout.get("c")).toEqual({ x: 0, y: 1 });
  });
});
