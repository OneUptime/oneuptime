import DefaultDashboardSize, {
  GetDashboardComponentWidthInDashboardUnits,
  SpaceBetweenUnitsInPx,
} from "../../../Types/Dashboard/DashboardSize";
import { describe, expect, test } from "@jest/globals";

/*
 * GetDashboardComponentWidthInDashboardUnits converts a pixel width into a
 * count of dashboard grid units. The internal math is:
 *
 *   eachUnitSizeInPx = currentTotalDashboardWidthInPx / widthInDashboardUnits
 *   units            = Math.ceil(componentWidthInPx / eachUnitSizeInPx)
 *   return units < 1 ? 1 : units
 *
 * where widthInDashboardUnits comes from DefaultDashboardSize. The tests below
 * pin down the ceiling rounding, the floor-to-1 clamp, the absence of any
 * upper clamp, and the degenerate divide-by-zero behaviour.
 */

describe("GetDashboardComponentWidthInDashboardUnits", () => {
  /*
   * The whole module is calibrated around a 12-unit-wide grid. If that default
   * ever changes, the hand-computed expectations below would silently drift, so
   * assert the assumption explicitly and fail loudly here instead.
   */
  const GRID_UNITS: number = DefaultDashboardSize.widthInDashboardUnits;

  test("assumes the default grid is 12 units wide", () => {
    expect(GRID_UNITS).toBe(12);
  });

  describe("basic conversion", () => {
    test("returns 1 when the component spans exactly one unit", () => {
      /*
       * total 1200px over 12 units => 100px per unit. A 100px component is
       * exactly one unit and must round to 1 (not 2).
       */
      const units: number = GetDashboardComponentWidthInDashboardUnits(
        1200,
        100,
      );
      expect(units).toBe(1);
    });

    test("returns 2 when the component spans exactly two units", () => {
      const units: number = GetDashboardComponentWidthInDashboardUnits(
        1200,
        200,
      );
      expect(units).toBe(2);
    });

    test("returns the full grid width when the component fills the dashboard", () => {
      const units: number = GetDashboardComponentWidthInDashboardUnits(
        1200,
        1200,
      );
      expect(units).toBe(GRID_UNITS);
    });

    test("scales the unit size with the total dashboard width", () => {
      /*
       * total 600px over 12 units => 50px per unit. A 50px component is one
       * unit and a 150px component is three units. The unit size is derived
       * from the total width, so a different total yields a different mapping.
       */
      expect(GetDashboardComponentWidthInDashboardUnits(600, 50)).toBe(1);
      expect(GetDashboardComponentWidthInDashboardUnits(600, 150)).toBe(3);
    });
  });

  describe("ceiling / round-up behaviour", () => {
    test("rounds a partial unit up to the next whole unit", () => {
      /*
       * 100px per unit. 150px is 1.5 units and must round up to 2. 250px is
       * 2.5 units and must round up to 3.
       */
      expect(GetDashboardComponentWidthInDashboardUnits(1200, 150)).toBe(2);
      expect(GetDashboardComponentWidthInDashboardUnits(1200, 250)).toBe(3);
    });

    test("rounds up even a single pixel over a unit boundary", () => {
      /*
       * 101px is 1.01 units; the ceiling makes it consume 2 whole units so the
       * component is never visually clipped.
       */
      expect(GetDashboardComponentWidthInDashboardUnits(1200, 101)).toBe(2);
    });

    test("does not round up when the width lands exactly on a boundary", () => {
      /*
       * ceil(2.0) is 2, not 3. Exact multiples of the unit size stay put.
       */
      expect(GetDashboardComponentWidthInDashboardUnits(1200, 200)).toBe(2);
      expect(GetDashboardComponentWidthInDashboardUnits(1200, 300)).toBe(3);
    });

    test("rounds a sub-unit width up to a single unit", () => {
      /*
       * 50px is half a unit; ceil(0.5) is 1, so a component narrower than one
       * unit still occupies a whole unit.
       */
      expect(GetDashboardComponentWidthInDashboardUnits(1200, 50)).toBe(1);
    });
  });

  describe("floor-to-1 clamp", () => {
    test("returns 1 for a zero-width component", () => {
      /*
       * ceil(0) is 0, which is below the minimum, so the clamp forces 1. A
       * component always occupies at least one grid unit.
       */
      expect(GetDashboardComponentWidthInDashboardUnits(1200, 0)).toBe(1);
    });

    test("returns 1 for a negative component width", () => {
      /*
       * ceil(-0.5) is -0, which is below the minimum and clamps to 1 rather
       * than returning a negative or zero unit count.
       */
      expect(GetDashboardComponentWidthInDashboardUnits(1200, -50)).toBe(1);
    });

    test("returns 1 when the total dashboard width is negative", () => {
      /*
       * A negative total flips the sign of the unit size, so a positive
       * component yields a negative raw unit count that clamps to 1.
       */
      expect(GetDashboardComponentWidthInDashboardUnits(-1200, 100)).toBe(1);
    });
  });

  describe("no upper clamp", () => {
    test("returns more than the grid width when the component overflows the dashboard", () => {
      /*
       * A 2400px component on a 1200px dashboard is 24 units. The function does
       * not cap the result at the 12-unit grid width.
       */
      const units: number = GetDashboardComponentWidthInDashboardUnits(
        1200,
        2400,
      );
      expect(units).toBe(24);
      expect(units).toBeGreaterThan(GRID_UNITS);
    });
  });

  describe("degenerate totals (divide by zero)", () => {
    test("returns Infinity when the total is zero but the component is positive", () => {
      /*
       * A zero total makes the per-unit size zero, so a positive component
       * divides by zero to Infinity. ceil(Infinity) is Infinity, which is above
       * the minimum and is returned as-is rather than clamped.
       */
      const units: number = GetDashboardComponentWidthInDashboardUnits(0, 100);
      expect(units).toBe(Infinity);
      expect(Number.isFinite(units)).toBe(false);
    });

    test("returns NaN when both the total and the component are zero", () => {
      /*
       * 0 / 0 is NaN, ceil(NaN) is NaN, and NaN < 1 is false, so NaN passes the
       * clamp untouched.
       */
      const units: number = GetDashboardComponentWidthInDashboardUnits(0, 0);
      expect(Number.isNaN(units)).toBe(true);
    });
  });

  describe("independence from inter-unit spacing", () => {
    test("ignores SpaceBetweenUnitsInPx when computing the unit count", () => {
      /*
       * Unlike GetWidthOfDashboardComponent, this function divides the raw total
       * width by the unit count and never subtracts SpaceBetweenUnitsInPx. Prove
       * that by showing the result depends only on total and component width: a
       * 100px component on a 1200px dashboard is exactly one unit regardless of
       * the spacing constant's value.
       */
      expect(SpaceBetweenUnitsInPx).toBeGreaterThan(0);
      expect(GetDashboardComponentWidthInDashboardUnits(1200, 100)).toBe(1);
    });
  });

  describe("monotonicity", () => {
    test("never decreases as the component width grows", () => {
      /*
       * For a fixed dashboard width, a wider component can only ever require the
       * same number of units or more. Sweep a range of widths and assert the
       * unit count is non-decreasing.
       */
      const total: number = 1200;
      let previous: number = GetDashboardComponentWidthInDashboardUnits(
        total,
        0,
      );

      for (
        let componentWidth: number = 0;
        componentWidth <= 2400;
        componentWidth += 37
      ) {
        const current: number = GetDashboardComponentWidthInDashboardUnits(
          total,
          componentWidth,
        );
        expect(current).toBeGreaterThanOrEqual(previous);
        previous = current;
      }
    });
  });

  describe("output shape", () => {
    test("always returns a whole number for finite positive inputs", () => {
      const widths: Array<number> = [1, 49, 50, 99, 100, 101, 599, 1200, 5000];

      for (const componentWidth of widths) {
        const units: number = GetDashboardComponentWidthInDashboardUnits(
          1200,
          componentWidth,
        );
        expect(Number.isInteger(units)).toBe(true);
        expect(units).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
