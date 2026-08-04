import AggregationType, {
  PercentileAggregationLevels,
  getPercentileLevel,
  isPercentileAggregation,
} from "../../../Types/BaseDatabase/AggregationType";
import { describe, expect, test } from "@jest/globals";

describe("AggregationType", () => {
  describe("PercentileAggregationLevels", () => {
    test("maps each percentile enum to its quantile fraction", () => {
      expect(PercentileAggregationLevels[AggregationType.P50]).toBe(0.5);
      expect(PercentileAggregationLevels[AggregationType.P90]).toBe(0.9);
      expect(PercentileAggregationLevels[AggregationType.P95]).toBe(0.95);
      expect(PercentileAggregationLevels[AggregationType.P99]).toBe(0.99);
    });

    test("contains exactly the four percentile aggregations", () => {
      expect(Object.keys(PercentileAggregationLevels).sort()).toEqual([
        "P50",
        "P90",
        "P95",
        "P99",
      ]);
    });
  });

  describe("isPercentileAggregation", () => {
    test("returns true for every percentile aggregation", () => {
      expect(isPercentileAggregation(AggregationType.P50)).toBe(true);
      expect(isPercentileAggregation(AggregationType.P90)).toBe(true);
      expect(isPercentileAggregation(AggregationType.P95)).toBe(true);
      expect(isPercentileAggregation(AggregationType.P99)).toBe(true);
    });

    test("returns false for scalar aggregations", () => {
      expect(isPercentileAggregation(AggregationType.Max)).toBe(false);
      expect(isPercentileAggregation(AggregationType.Min)).toBe(false);
      expect(isPercentileAggregation(AggregationType.Sum)).toBe(false);
      expect(isPercentileAggregation(AggregationType.Avg)).toBe(false);
      expect(isPercentileAggregation(AggregationType.Count)).toBe(false);
    });
  });

  describe("getPercentileLevel", () => {
    test("returns the quantile fraction for percentile aggregations", () => {
      expect(getPercentileLevel(AggregationType.P50)).toBe(0.5);
      expect(getPercentileLevel(AggregationType.P99)).toBe(0.99);
    });

    test("returns null for scalar aggregations", () => {
      expect(getPercentileLevel(AggregationType.Max)).toBeNull();
      expect(getPercentileLevel(AggregationType.Avg)).toBeNull();
      expect(getPercentileLevel(AggregationType.Count)).toBeNull();
    });
  });
});
