import { describe, expect, test } from "@jest/globals";
import {
  isSameColumnMappings,
  MAX_COLUMN_MAPPINGS_PER_EDGE,
  mergeColumnMappings,
  readColumnMappings,
} from "../../../Types/DataObservability/DataColumnLineage";

describe("column mappings", () => {
  test("only well-formed pairs, one of each, in a stable order", () => {
    expect(
      readColumnMappings([
        { upstreamColumn: "b", downstreamColumn: "x" },
        { upstreamColumn: "a", downstreamColumn: "x" },
        { upstreamColumn: "a", downstreamColumn: "x" },
        { upstreamColumn: "", downstreamColumn: "x" },
        { upstreamColumn: "c" },
        "junk",
        null,
      ]),
    ).toEqual([
      { upstreamColumn: "a", downstreamColumn: "x" },
      { upstreamColumn: "b", downstreamColumn: "x" },
    ]);
    expect(readColumnMappings("junk")).toEqual([]);
  });

  test("a merge keeps both sides, and a list is bounded", () => {
    const merged: ReturnType<typeof mergeColumnMappings> = mergeColumnMappings(
      [{ upstreamColumn: "a", downstreamColumn: "x" }],
      [{ upstreamColumn: "b", downstreamColumn: "y" }],
    );

    expect(merged).toHaveLength(2);
    expect(isSameColumnMappings(merged, [...merged].reverse())).toBe(true);
    expect(isSameColumnMappings(merged, merged.slice(1))).toBe(false);
    expect(
      readColumnMappings(
        Array.from(
          { length: MAX_COLUMN_MAPPINGS_PER_EDGE + 50 },
          (_x: unknown, i: number) => {
            return { upstreamColumn: `u${i}`, downstreamColumn: "d" };
          },
        ),
      ),
    ).toHaveLength(MAX_COLUMN_MAPPINGS_PER_EDGE);
  });
});
