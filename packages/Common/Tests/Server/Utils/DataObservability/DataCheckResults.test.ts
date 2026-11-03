import { describe, expect, test } from "@jest/globals";
import { DataCheckType } from "../../../../Types/DataObservability/DataCheckType";
import {
  EMPTY_SEGMENT,
  readCheckRows,
  readNumber,
  readSegment,
} from "../../../../Server/Utils/DataObservability/DataCheckResults";

/*
 * What a check's statement hands back - from a probe too - is read
 * strictly: a number that is not finite is no value, a segment is text and
 * bounded, and at most 100 segments are kept.
 */

describe("readCheckRows", () => {
  test("an unsegmented check's one value", () => {
    expect(
      readCheckRows({
        type: DataCheckType.NullPercent,
        isSegmented: false,
        rows: [{ value: "12.5" }],
      }),
    ).toEqual([{ segment: null, value: 12.5 }]);
  });

  test("a percentage of no rows is no value, not zero", () => {
    expect(
      readCheckRows({
        type: DataCheckType.NullPercent,
        isSegmented: false,
        rows: [{ value: null }],
      }),
    ).toEqual([]);
  });

  test("a segmented check's value per segment, an empty segment named", () => {
    expect(
      readCheckRows({
        type: DataCheckType.RowCount,
        isSegmented: true,
        rows: [
          { segment: "acme", value: 120 },
          { segment: null, value: "3" },
          { segment: "broken", value: "NaN" },
        ],
      }),
    ).toEqual([
      { segment: "acme", value: 120 },
      { segment: EMPTY_SEGMENT, value: 3 },
    ]);
  });

  test("custom SQL: the first number is the value, or segment then value per row", () => {
    expect(
      readCheckRows({
        type: DataCheckType.CustomSql,
        isSegmented: false,
        rows: [{ label: "negative totals", count: "7" }],
      }),
    ).toEqual([{ segment: null, value: 7 }]);

    expect(
      readCheckRows({
        type: DataCheckType.CustomSql,
        isSegmented: true,
        rows: [
          { region: "eu", total: 10 },
          { region: "us", total: "x" },
        ],
      }),
    ).toEqual([{ segment: "eu", value: 10 }]);
  });

  test("at most 100 segments are kept", () => {
    const rows: Array<Record<string, unknown>> = [];

    for (let index: number = 0; index < 150; index++) {
      rows.push({ segment: `tenant-${index}`, value: index });
    }

    expect(
      readCheckRows({ type: DataCheckType.RowCount, isSegmented: true, rows })
        .length,
    ).toBe(100);
  });
});

describe("readNumber and readSegment", () => {
  test("numbers in every form a driver hands back, and nothing else", () => {
    expect(readNumber(3)).toBe(3);
    expect(readNumber("4.5")).toBe(4.5);
    expect(readNumber(BigInt(9))).toBe(9);
    expect(readNumber("")).toBe(null);
    expect(readNumber(Infinity)).toBe(null);
    expect(readNumber({})).toBe(null);
  });

  test("segments are bounded text", () => {
    expect(readSegment("  eu  ")).toBe("eu");
    expect(readSegment(42)).toBe("42");
    expect(readSegment(undefined)).toBe(EMPTY_SEGMENT);
    expect(readSegment("x".repeat(500)).length).toBe(200);
  });
});
