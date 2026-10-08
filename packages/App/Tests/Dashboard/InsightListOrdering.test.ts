import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  DEFAULT_INSIGHT_SORT,
  INSIGHT_SEEN_WITHIN_OPTIONS,
  INSIGHT_SORT_OPTIONS,
  InsightSeenWithinValue,
  InsightSortValue,
  getInsightSeenWithinFilter,
  getInsightSort,
  parseInsightSeenWithin,
  parseInsightSort,
} from "../../FeatureSet/Dashboard/src/Components/AIInsights/InsightListOrdering";

/*
 * The insights inbox's order and time range. Two things here fail silently
 * when they drift:
 *
 *  - offset pagination over an order tied across a page skips rows, and a
 *    busy project's live insights all share one lastSeenAt (one stamp per
 *    scan) — so every order must end on the id;
 *  - the values ride in the URL, so a renamed value quietly drops the order
 *    or range of every shared and bookmarked link.
 *
 * The page's wiring is rendered in the Common suite
 * (AIInsightsListOrdering.test.tsx); this pins the rules.
 */

const NOW: Date = new Date("2026-10-08T12:00:00.000Z");

describe("sort", () => {
  test("every order ends on the id, in the order's own direction", () => {
    for (const value of Object.values(InsightSortValue)) {
      const sort: Record<string, SortOrder> = getInsightSort(value) as Record<
        string,
        SortOrder
      >;
      const keys: Array<string> = Object.keys(sort);

      expect(keys[keys.length - 1]).toBe("_id");
      expect(sort["_id"]).toBe(sort[keys[0]!]);
    }
  });

  test("each option sorts by the column it names", () => {
    expect(getInsightSort(InsightSortValue.LastSeenNewest)).toEqual({
      lastSeenAt: SortOrder.Descending,
      _id: SortOrder.Descending,
    });
    expect(getInsightSort(InsightSortValue.LastSeenOldest)).toEqual({
      lastSeenAt: SortOrder.Ascending,
      _id: SortOrder.Ascending,
    });
    expect(getInsightSort(InsightSortValue.FirstSeenNewest)).toEqual({
      firstSeenAt: SortOrder.Descending,
      _id: SortOrder.Descending,
    });
  });

  test("most detections breaks ties on recency before the id", () => {
    const sort: Record<string, SortOrder> = getInsightSort(
      InsightSortValue.MostDetections,
    ) as Record<string, SortOrder>;

    expect(Object.keys(sort)).toEqual(["occurrenceCount", "lastSeenAt", "_id"]);
    expect(sort["occurrenceCount"]).toBe(SortOrder.Descending);
    expect(sort["lastSeenAt"]).toBe(SortOrder.Descending);
  });

  test("the default is the order the list always had", () => {
    expect(DEFAULT_INSIGHT_SORT).toBe(InsightSortValue.LastSeenNewest);
    expect(getInsightSort(DEFAULT_INSIGHT_SORT)).toEqual({
      lastSeenAt: SortOrder.Descending,
      _id: SortOrder.Descending,
    });
  });

  test("a URL value that is not one of ours falls back to the default", () => {
    expect(parseInsightSort(null)).toBe(DEFAULT_INSIGHT_SORT);
    expect(parseInsightSort(undefined)).toBe(DEFAULT_INSIGHT_SORT);
    expect(parseInsightSort("")).toBe(DEFAULT_INSIGHT_SORT);
    expect(parseInsightSort("severity")).toBe(DEFAULT_INSIGHT_SORT);
    expect(parseInsightSort("DETECTIONS")).toBe(DEFAULT_INSIGHT_SORT);

    for (const value of Object.values(InsightSortValue)) {
      expect(parseInsightSort(value)).toBe(value);
    }
  });

  test("every value has exactly one option, with a label", () => {
    expect(
      INSIGHT_SORT_OPTIONS.map((option: { value: string }) => {
        return option.value;
      }).sort(),
    ).toEqual([...Object.values(InsightSortValue)].sort());

    for (const option of INSIGHT_SORT_OPTIONS) {
      expect(option.label.trim().length).toBeGreaterThan(0);
    }
  });

  test("the URL values never change", () => {
    expect(InsightSortValue.LastSeenNewest).toBe("lastSeen");
    expect(InsightSortValue.LastSeenOldest).toBe("lastSeenOldest");
    expect(InsightSortValue.FirstSeenNewest).toBe("firstSeen");
    expect(InsightSortValue.MostDetections).toBe("detections");
  });
});

describe("seen within", () => {
  test("any time adds no filter", () => {
    expect(
      getInsightSeenWithinFilter(InsightSeenWithinValue.AnyTime, NOW),
    ).toBeNull();
  });

  test("each range filters lastSeenAt from that far before now", () => {
    const expectations: Array<[InsightSeenWithinValue, number]> = [
      [InsightSeenWithinValue.LastHour, 60 * 60 * 1000],
      [InsightSeenWithinValue.LastDay, 24 * 60 * 60 * 1000],
      [InsightSeenWithinValue.LastWeek, 7 * 24 * 60 * 60 * 1000],
      [InsightSeenWithinValue.LastMonth, 30 * 24 * 60 * 60 * 1000],
    ];

    for (const [value, millisecondsBack] of expectations) {
      const filter: GreaterThanOrEqual<Date> | null =
        getInsightSeenWithinFilter(value, NOW);

      expect(filter).toBeInstanceOf(GreaterThanOrEqual);
      expect((filter!.value as Date).getTime()).toBe(
        NOW.getTime() - millisecondsBack,
      );
    }
  });

  test("the range is relative to the request, not to when it was picked", () => {
    const later: Date = new Date(NOW.getTime() + 5 * 60 * 1000);

    expect(
      (
        getInsightSeenWithinFilter(InsightSeenWithinValue.LastHour, later)!
          .value as Date
      ).getTime(),
    ).toBe(later.getTime() - 60 * 60 * 1000);
  });

  test("any time is the page's own 'All' sentinel", () => {
    /*
     * The filter bar has ONE unfilteredValue for all of its filters; the
     * time range is "not filtering" exactly when it carries that value.
     */
    expect(InsightSeenWithinValue.AnyTime).toBe("All");

    const pageSource: string = fs.readFileSync(
      nodePath.join(
        __dirname,
        "..",
        "..",
        "FeatureSet",
        "Dashboard",
        "src",
        "Pages",
        "AIInsights",
        "Insights.tsx",
      ),
      "utf8",
    );

    expect(pageSource).toContain('const ALL_FILTER_VALUE: string = "All";');
  });

  test("a URL value that is not one of ours means any time", () => {
    expect(parseInsightSeenWithin(null)).toBe(InsightSeenWithinValue.AnyTime);
    expect(parseInsightSeenWithin("2h")).toBe(InsightSeenWithinValue.AnyTime);
    expect(parseInsightSeenWithin("24H")).toBe(InsightSeenWithinValue.AnyTime);

    for (const value of Object.values(InsightSeenWithinValue)) {
      expect(parseInsightSeenWithin(value)).toBe(value);
    }
  });

  test("every value has exactly one option, and only any time has no window", () => {
    expect(
      INSIGHT_SEEN_WITHIN_OPTIONS.map((option: { value: string }) => {
        return option.value;
      }).sort(),
    ).toEqual([...Object.values(InsightSeenWithinValue)].sort());

    for (const option of INSIGHT_SEEN_WITHIN_OPTIONS) {
      expect(option.label.trim().length).toBeGreaterThan(0);

      if (option.value === InsightSeenWithinValue.AnyTime) {
        expect(option.minutes).toBeUndefined();
      } else {
        expect(option.minutes).toBeGreaterThan(0);
      }
    }
  });

  test("the URL values never change", () => {
    expect(InsightSeenWithinValue.LastHour).toBe("1h");
    expect(InsightSeenWithinValue.LastDay).toBe("24h");
    expect(InsightSeenWithinValue.LastWeek).toBe("7d");
    expect(InsightSeenWithinValue.LastMonth).toBe("30d");
  });
});
