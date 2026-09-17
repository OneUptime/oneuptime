import { describe, expect, test } from "@jest/globals";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import {
  aggregateValues,
  collectDataPoints,
  getNumericValues,
  getResultsErrorMessage,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/ValueWidgetData";

/*
 * Covers the reduction behind a Value tile's single big number. The case that
 * matters most is the empty one: a metric with no points must report "nothing
 * to reduce" rather than a 0 the tile would render as a real measurement — an
 * LCP or TTFB of 0ms is physically impossible and a CLS of 0 is the best
 * possible score, so a template dashboard with no telemetry read as perfect.
 */

const TIMESTAMP: Date = new Date("2026-06-01T00:00:00.000Z");

type MakePoint = (value: unknown) => AggregatedModel;

const point: MakePoint = (value: unknown): AggregatedModel => {
  return { timestamp: TIMESTAMP, value: value as number };
};

type MakeResult = (values: Array<unknown>) => AggregatedResult;

const result: MakeResult = (values: Array<unknown>): AggregatedResult => {
  return { data: values.map(point) };
};

describe("ValueWidgetData.aggregateValues", () => {
  test("returns null when there is nothing to reduce", () => {
    for (const type of Object.values(AggregationType)) {
      expect(aggregateValues([], type)).toBeNull();
    }
  });

  test("null is distinct from a genuine measurement of zero", () => {
    expect(aggregateValues([], AggregationType.Avg)).toBeNull();
    expect(aggregateValues([0], AggregationType.Avg)).toBe(0);
    expect(aggregateValues([0, 0], AggregationType.Avg)).toBe(0);
  });

  test("Avg is the mean of the per-bucket values", () => {
    expect(aggregateValues([2, 4, 9], AggregationType.Avg)).toBe(5);
  });

  test("percentiles are averaged across buckets, not left at zero", () => {
    // Each bucket's P95 is computed server-side; the tile shows their mean.
    expect(aggregateValues([100, 200, 300], AggregationType.P50)).toBe(200);
    expect(aggregateValues([100, 200, 300], AggregationType.P90)).toBe(200);
    expect(aggregateValues([100, 200, 300], AggregationType.P95)).toBe(200);
    expect(aggregateValues([100, 200, 300], AggregationType.P99)).toBe(200);
  });

  test("Sum and Count add the per-bucket values", () => {
    expect(aggregateValues([1, 2, 3], AggregationType.Sum)).toBe(6);
    // Count sums the counts the server returned, it does not count buckets.
    expect(aggregateValues([5, 5, 5], AggregationType.Count)).toBe(15);
  });

  test("Min and Max fold over the real values, not a zero seed", () => {
    expect(aggregateValues([7, 3, 11], AggregationType.Min)).toBe(3);
    expect(aggregateValues([7, 3, 11], AggregationType.Max)).toBe(11);
  });

  test("Min of an all-positive metric is not forced to zero", () => {
    expect(aggregateValues([120, 340], AggregationType.Min)).toBe(120);
  });

  test("negative values are reduced without a zero floor or ceiling", () => {
    expect(aggregateValues([-5, -1], AggregationType.Max)).toBe(-1);
    expect(aggregateValues([-5, -1], AggregationType.Min)).toBe(-5);
    expect(aggregateValues([-4, -2], AggregationType.Avg)).toBe(-3);
  });
});

describe("ValueWidgetData.getNumericValues", () => {
  test("drops nulls arriving from a ClickHouse NULL / missing column", () => {
    expect(getNumericValues([point(1), point(null), point(3)])).toEqual([1, 3]);
  });

  test("drops NaN and infinities so they cannot poison the reduction", () => {
    expect(
      getNumericValues([
        point(Number.NaN),
        point(Number.POSITIVE_INFINITY),
        point(Number.NEGATIVE_INFINITY),
        point(2),
      ]),
    ).toEqual([2]);
  });

  test("drops non-numeric values", () => {
    expect(getNumericValues([point("12"), point(undefined), point(4)])).toEqual(
      [4],
    );
  });

  test("keeps zero — it is a real measurement", () => {
    expect(getNumericValues([point(0)])).toEqual([0]);
  });

  test("a bucket set that is entirely non-finite reduces to no data", () => {
    const values: Array<number> = getNumericValues([
      point(null),
      point(Number.NaN),
    ]);
    expect(values).toEqual([]);
    expect(aggregateValues(values, AggregationType.Avg)).toBeNull();
  });
});

describe("ValueWidgetData.collectDataPoints", () => {
  test("flattens every result's buckets in order", () => {
    expect(
      collectDataPoints([result([1, 2]), result([3])]).map(
        (item: AggregatedModel) => {
          return item.value;
        },
      ),
    ).toEqual([1, 2, 3]);
  });

  test("results present but empty yield no points", () => {
    expect(collectDataPoints([result([])])).toEqual([]);
    expect(collectDataPoints([])).toEqual([]);
  });
});

describe("ValueWidgetData.getResultsErrorMessage", () => {
  test("surfaces the first reason a result carries", () => {
    const results: Array<AggregatedResult> = [
      result([]),
      { data: [], errorMessage: "Unknown variable in formula" },
      { data: [], errorMessage: "Second reason" },
    ];
    expect(getResultsErrorMessage(results)).toBe("Unknown variable in formula");
  });

  test("undefined when no result explains itself", () => {
    expect(getResultsErrorMessage([result([1])])).toBeUndefined();
    expect(getResultsErrorMessage([])).toBeUndefined();
  });
});
