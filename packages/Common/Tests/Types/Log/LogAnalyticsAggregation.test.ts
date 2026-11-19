import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import {
  getLogAnalyticsNumericAggregationType,
  isAdditiveLogAnalyticsAggregation,
  isLogAnalyticsAggregation,
  isNumericLogAnalyticsAggregation,
  LOG_ANALYTICS_AGGREGATIONS,
  LOG_ANALYTICS_NUMERIC_AGGREGATIONS,
  needsLogAnalyticsAggregationField,
} from "../../../Types/Log/LogAnalyticsAggregation";
import { describe, expect, test } from "@jest/globals";

/*
 * What Logs → Analytics measures (#7716): a count, a unique count, and the
 * sum, average, percentiles, minimum and maximum of a numeric attribute -
 * the names the route takes and the view offers, and what each needs.
 */

describe("LogAnalyticsAggregation", () => {
  test("lists count and unique first, then every aggregation of a number", () => {
    expect(LOG_ANALYTICS_AGGREGATIONS).toEqual([
      "count",
      "unique",
      "sum",
      "avg",
      "p50",
      "p90",
      "p95",
      "p99",
      "min",
      "max",
    ]);
  });

  test("each aggregation of a number is the aggregate a log recording rule computes", () => {
    expect(LOG_ANALYTICS_NUMERIC_AGGREGATIONS).toEqual({
      sum: AggregationType.Sum,
      avg: AggregationType.Avg,
      p50: AggregationType.P50,
      p90: AggregationType.P90,
      p95: AggregationType.P95,
      p99: AggregationType.P99,
      min: AggregationType.Min,
      max: AggregationType.Max,
    });
  });

  test("tells an aggregation from anything else", () => {
    for (const aggregation of LOG_ANALYTICS_AGGREGATIONS) {
      expect(isLogAnalyticsAggregation(aggregation)).toBe(true);
    }

    for (const other of [
      "Avg",
      "P95",
      "p75",
      "median",
      "average",
      "",
      undefined,
      null,
      42,
      "toString",
      "__proto__",
      "constructor",
    ]) {
      expect(isLogAnalyticsAggregation(other)).toBe(false);
      expect(isNumericLogAnalyticsAggregation(other)).toBe(false);
      expect(getLogAnalyticsNumericAggregationType(other)).toBeNull();
    }
  });

  test("a count and a unique count read no number", () => {
    expect(isNumericLogAnalyticsAggregation("count")).toBe(false);
    expect(isNumericLogAnalyticsAggregation("unique")).toBe(false);
    expect(getLogAnalyticsNumericAggregationType("count")).toBeNull();
    expect(getLogAnalyticsNumericAggregationType("unique")).toBeNull();
  });

  test("every other aggregation reads a number, as its aggregate", () => {
    expect(getLogAnalyticsNumericAggregationType("p95")).toBe(
      AggregationType.P95,
    );
    expect(getLogAnalyticsNumericAggregationType("avg")).toBe(
      AggregationType.Avg,
    );

    for (const aggregation of Object.keys(LOG_ANALYTICS_NUMERIC_AGGREGATIONS)) {
      expect(isNumericLogAnalyticsAggregation(aggregation)).toBe(true);
    }
  });

  test("a unique count and every aggregation of a number need a field; a count does not", () => {
    expect(needsLogAnalyticsAggregationField("count")).toBe(false);
    expect(needsLogAnalyticsAggregationField("unique")).toBe(true);

    for (const aggregation of Object.keys(LOG_ANALYTICS_NUMERIC_AGGREGATIONS)) {
      expect(needsLogAnalyticsAggregationField(aggregation)).toBe(true);
    }
  });

  test("only a count and a sum add up across groups", () => {
    expect(
      LOG_ANALYTICS_AGGREGATIONS.filter(isAdditiveLogAnalyticsAggregation),
    ).toEqual(["count", "sum"]);
  });
});
