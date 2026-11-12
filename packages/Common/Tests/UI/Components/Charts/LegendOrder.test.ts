import { describe, expect, test } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import type { LegendPayload } from "recharts";
import {
  LegendItemRank,
  getLegendItemRank,
  useLegendItemRank,
} from "../../../../UI/Components/Charts/ChartLibrary/Utils/LegendOrder";

/*
 * The rank recharts sorts a legend's items by (issue #6562): a series'
 * place among the chart's categories, so the legend names the series in
 * the order the page gave them. ChartLegendOrder.test.tsx draws it.
 */

const CATEGORIES: Array<string> = [
  "Daily active users",
  "Weekly active users",
  "Monthly active users",
];

function item(
  value: string | undefined,
  dataKey?: LegendPayload["dataKey"],
): LegendPayload {
  return {
    value: value,
    type: "line",
    ...(dataKey === undefined ? {} : { dataKey: dataKey }),
  };
}

// The items in recharts' order: by rank, keeping the order they came in on a tie.
function sorted(
  items: Array<LegendPayload>,
  rank: LegendItemRank,
): Array<string | undefined> {
  return items
    .map((entry: LegendPayload, arrival: number) => {
      return { entry: entry, arrival: arrival, rank: rank(entry) };
    })
    .sort(
      (
        a: { rank: number; arrival: number },
        b: { rank: number; arrival: number },
      ): number => {
        return a.rank - b.rank || a.arrival - b.arrival;
      },
    )
    .map((ranked: { entry: LegendPayload }): string | undefined => {
      return ranked.entry.value;
    });
}

describe("getLegendItemRank", () => {
  test("ranks each series by its place among the categories", () => {
    const rank: LegendItemRank = getLegendItemRank(CATEGORIES);

    expect(rank(item("Daily active users"))).toBe(0);
    expect(rank(item("Weekly active users"))).toBe(1);
    expect(rank(item("Monthly active users"))).toBe(2);
  });

  test("puts items arriving alphabetically back in the page's order", () => {
    const rank: LegendItemRank = getLegendItemRank(CATEGORIES);

    expect(
      sorted(
        [
          item("Daily active users"),
          item("Monthly active users"),
          item("Weekly active users"),
        ],
        rank,
      ),
    ).toEqual(CATEGORIES);
  });

  test("reads the data key when the label names no series", () => {
    const rank: LegendItemRank = getLegendItemRank(CATEGORIES);

    expect(rank(item(undefined, "Monthly active users"))).toBe(2);
    expect(rank(item("Something else", "Weekly active users"))).toBe(1);
  });

  test("the label wins over the data key", () => {
    const rank: LegendItemRank = getLegendItemRank(CATEGORIES);

    expect(rank(item("Daily active users", "Monthly active users"))).toBe(0);
  });

  test("an item that is no series goes after every series", () => {
    const rank: LegendItemRank = getLegendItemRank(CATEGORIES);

    // A band drawn from a function, or a helper line of another name.
    expect(
      rank(
        item("Expected range", (): number => {
          return 0;
        }),
      ),
    ).toBe(3);
    expect(rank(item(undefined))).toBe(3);
    expect(rank(item(undefined, 7))).toBe(3);

    expect(
      sorted(
        [
          item("Expected range"),
          item("Monthly active users"),
          item("Daily active users"),
        ],
        rank,
      ),
    ).toEqual(["Daily active users", "Monthly active users", "Expected range"]);
  });

  test("a name given twice keeps its first place", () => {
    const rank: LegendItemRank = getLegendItemRank(["b", "a", "b"]);

    expect(rank(item("b"))).toBe(0);
    expect(rank(item("a"))).toBe(1);
  });

  test("no categories rank every item the same, leaving their order alone", () => {
    const rank: LegendItemRank = getLegendItemRank([]);

    expect(sorted([item("z"), item("a"), item("m")], rank)).toEqual([
      "z",
      "a",
      "m",
    ]);
  });

  test("names that differ only in case or accents are different series", () => {
    const rank: LegendItemRank = getLegendItemRank([
      "Résumé",
      "resume",
      "RESUME",
    ]);

    expect(rank(item("RESUME"))).toBe(2);
    expect(rank(item("resume"))).toBe(1);
    expect(rank(item("Résumé"))).toBe(0);
  });
});

describe("useLegendItemRank", () => {
  test("keeps one sorter while the categories read the same", () => {
    const { result, rerender } = renderHook(
      (props: { categories: Array<string> }) => {
        return useLegendItemRank(props.categories);
      },
      { initialProps: { categories: [...CATEGORIES] } },
    );

    const first: LegendItemRank = result.current;

    // A page hands its series in a new array on every render.
    rerender({ categories: [...CATEGORIES] });

    expect(result.current).toBe(first);
  });

  test("a new sorter when the categories change, ranking by the new order", () => {
    const { result, rerender } = renderHook(
      (props: { categories: Array<string> }) => {
        return useLegendItemRank(props.categories);
      },
      { initialProps: { categories: [...CATEGORIES] } },
    );

    const first: LegendItemRank = result.current;

    rerender({ categories: [...CATEGORIES].reverse() });

    expect(result.current).not.toBe(first);
    expect(result.current(item("Monthly active users"))).toBe(0);
    expect(result.current(item("Daily active users"))).toBe(2);
  });

  test("a name holding a separator character is not confused with two names", () => {
    const { result, rerender } = renderHook(
      (props: { categories: Array<string> }) => {
        return useLegendItemRank(props.categories);
      },
      { initialProps: { categories: ["a,b", "c"] } },
    );

    const first: LegendItemRank = result.current;

    rerender({ categories: ["a", "b,c"] });

    expect(result.current).not.toBe(first);
    expect(result.current(item("b,c"))).toBe(1);
  });
});
