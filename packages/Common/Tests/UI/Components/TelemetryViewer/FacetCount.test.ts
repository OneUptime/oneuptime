import { describe, expect, test } from "@jest/globals";
import {
  formatExactFacetCount,
  formatFacetCount,
  isFacetCountShortened,
} from "../../../../UI/Components/TelemetryViewer/FacetCount";

/*
 * How a facet value's count reads in a telemetry sidebar.
 *
 * The report behind the facet sidebar's rework showed a checked service cut
 * to "one..." in the 224px sidebar, beside its count written out in full:
 * "2,417,585". A row now shows the count the way the explorer's chart labels
 * its axis - never more than four characters - so the name keeps the row's
 * width and every count fits one column. These pin the format, its rounding
 * at each unit's edge, and the full count that stays a hover away.
 */

describe("formatFacetCount", () => {
  test.each([
    [0, "0"],
    [1, "1"],
    [42, "42"],
    [999, "999"],
  ])("%d, under a thousand, is written out: %s", (count: number, text: string) => {
    expect(formatFacetCount(count)).toBe(text);
  });

  test.each([
    [1000, "1K"],
    [1049, "1K"],
    [1050, "1.1K"],
    [1204, "1.2K"],
    [5584, "5.6K"],
    [9949, "9.9K"],
    // One decimal stops at 10: 9.95K rounds to 10K, not 10.0K.
    [9950, "10K"],
    [38811, "39K"],
    [99499, "99K"],
    [120345, "120K"],
    [999499, "999K"],
  ])("%d reads %s", (count: number, text: string) => {
    expect(formatFacetCount(count)).toBe(text);
  });

  test.each([
    // 999,500 would round to 1000K: it is written in the next unit instead.
    [999500, "1M"],
    [1000000, "1M"],
    [2417585, "2.4M"],
    [9950000, "10M"],
    [120000000, "120M"],
    [999499999, "999M"],
    [999500000, "1B"],
    [4200000000, "4.2B"],
    [1500000000000, "1.5T"],
  ])("%d reads %s", (count: number, text: string) => {
    expect(formatFacetCount(count)).toBe(text);
  });

  test("REGRESSION: the report's 2,417,585 reads 2.4M", () => {
    expect(formatFacetCount(2417585)).toBe("2.4M");
  });

  test("never more than four characters, at every edge of every unit", () => {
    const edges: Array<number> = [];

    for (let power: number = 0; power <= 12; power++) {
      for (const leading of [1, 1.049, 1.05, 9.949, 9.95, 99.49, 99.5]) {
        for (const shift of [-1, 0, 1]) {
          edges.push(Math.round(leading * Math.pow(10, power)) + shift);
        }
      }
      edges.push(Math.pow(10, power) * 999.4999, Math.pow(10, power) * 999.5);
    }

    const tooLong: Array<string> = edges
      .filter((count: number): boolean => {
        return count >= 0 && count < 999.5e12;
      })
      .map((count: number): string => {
        return `${count} -> ${formatFacetCount(count)}`;
      })
      .filter((line: string): boolean => {
        return line.split(" -> ")[1]!.length > 4;
      });

    expect(tooLong).toEqual([]);
  });

  test("a shortened count is the count rounded to the last digit it shows", () => {
    const UNIT: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

    for (const count of [1050, 1204, 5584, 9949, 38811, 120345, 2417585]) {
      const text: string = formatFacetCount(count);
      const suffix: string = text.slice(-1);
      const shown: number = Number(text.slice(0, -1)) * UNIT[suffix]!;
      const step: number = text.includes(".")
        ? UNIT[suffix]! / 10
        : UNIT[suffix]!;

      expect(Math.abs(shown - count)).toBeLessThanOrEqual(step / 2);
    }
  });

  test("writes digits and a dot whatever the reader's language, as the chart's axis does", () => {
    for (const count of [1204, 2417585, 38811]) {
      expect(formatFacetCount(count)).toMatch(ASCII_COUNT);
    }
  });

  test("a count that is not a whole number of rows is rounded, and nonsense reads 0", () => {
    expect(formatFacetCount(41.6)).toBe("42");
    expect(formatFacetCount(-3)).toBe("0");
    expect(formatFacetCount(Number.NaN)).toBe("0");
    expect(formatFacetCount(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("formatExactFacetCount", () => {
  test("the full count, grouped as the reader's browser writes numbers", () => {
    expect(formatExactFacetCount(2417585)).toBe(
      (2417585).toLocaleString(),
    );
    expect(formatExactFacetCount(0)).toBe("0");
    expect(formatExactFacetCount(999)).toBe((999).toLocaleString());
  });

  test("rounds and guards the same way the shortened count does", () => {
    expect(formatExactFacetCount(41.6)).toBe("42");
    expect(formatExactFacetCount(-3)).toBe("0");
    expect(formatExactFacetCount(Number.NaN)).toBe("0");
  });
});

describe("isFacetCountShortened", () => {
  test("from a thousand on: below it the row shows the count in full", () => {
    expect(isFacetCountShortened(0)).toBe(false);
    expect(isFacetCountShortened(999)).toBe(false);
    expect(isFacetCountShortened(999.4)).toBe(false);
    expect(isFacetCountShortened(999.5)).toBe(true);
    expect(isFacetCountShortened(1000)).toBe(true);
    expect(isFacetCountShortened(2417585)).toBe(true);
  });

  test("agrees with the format: shortened exactly when the text has a unit", () => {
    for (const count of [0, 7, 999, 1000, 1204, 999500, 2417585]) {
      expect(isFacetCountShortened(count)).toBe(
        UNIT_SUFFIX.test(formatFacetCount(count)),
      );
    }
  });
});

// Digits, at most one dot, and a unit letter: no grouping, no local digits.
const ASCII_COUNT: RegExp = /^[0-9]+(\.[0-9])?[KMBT]$/;

// The unit letter a shortened count ends in.
const UNIT_SUFFIX: RegExp = /[KMBT]$/;
