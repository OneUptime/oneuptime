import {
  HostMetricCategory,
  HostMetricDefinition,
  getAllHostMetricCategories,
  getAllHostMetrics,
  getHostMetricById,
  getHostMetricByMetricName,
  getHostMetricsByCategory,
} from "../../../Types/Monitor/HostMetricCatalog";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { describe, expect, test } from "@jest/globals";

describe("HostMetricCatalog", () => {
  const allMetrics: Array<HostMetricDefinition> = getAllHostMetrics();
  const allCategories: Array<HostMetricCategory> = getAllHostMetricCategories();
  const validAggregations: Array<string> = Object.values(AggregationType);

  test("returns a non-empty catalog", () => {
    expect(Array.isArray(allMetrics)).toBe(true);
    expect(allMetrics.length).toBeGreaterThan(0);
  });

  test("every metric definition has all required non-empty fields", () => {
    for (const metric of allMetrics) {
      expect(typeof metric.id).toBe("string");
      expect(metric.id.length).toBeGreaterThan(0);
      expect(metric.friendlyName.length).toBeGreaterThan(0);
      expect(metric.description.length).toBeGreaterThan(0);
      expect(metric.metricName.length).toBeGreaterThan(0);
      expect(metric.category.length).toBeGreaterThan(0);
    }
  });

  test("every metric uses a valid aggregation type", () => {
    for (const metric of allMetrics) {
      expect(validAggregations).toContain(metric.defaultAggregation);
    }
  });

  test("metric ids are unique", () => {
    const ids: Array<string> = allMetrics.map((m: HostMetricDefinition) => {
      return m.id;
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("metric names are unique", () => {
    const names: Array<string> = allMetrics.map((m: HostMetricDefinition) => {
      return m.metricName;
    });
    expect(new Set(names).size).toBe(names.length);
  });

  test("every metric category is a declared category", () => {
    for (const metric of allMetrics) {
      expect(allCategories).toContain(metric.category);
    }
  });

  test("declared categories are unique and non-empty", () => {
    expect(allCategories.length).toBeGreaterThan(0);
    expect(new Set(allCategories).size).toBe(allCategories.length);
  });

  test("every declared category has at least one metric", () => {
    for (const category of allCategories) {
      expect(getHostMetricsByCategory(category).length).toBeGreaterThan(0);
    }
  });

  test("getHostMetricsByCategory returns only metrics of that category", () => {
    for (const category of allCategories) {
      for (const metric of getHostMetricsByCategory(category)) {
        expect(metric.category).toBe(category);
      }
    }
  });

  test("getHostMetricById round-trips every metric", () => {
    for (const metric of allMetrics) {
      expect(getHostMetricById(metric.id)).toEqual(metric);
    }
  });

  test("getHostMetricById returns undefined for an unknown id", () => {
    expect(getHostMetricById("does-not-exist")).toBeUndefined();
    expect(getHostMetricById("")).toBeUndefined();
  });

  test("getHostMetricByMetricName round-trips every metric", () => {
    for (const metric of allMetrics) {
      expect(getHostMetricByMetricName(metric.metricName)).toEqual(metric);
    }
  });

  test("getHostMetricByMetricName returns undefined for an unknown name", () => {
    expect(getHostMetricByMetricName("nope.nope")).toBeUndefined();
  });

  test("known host metrics are present", () => {
    expect(getHostMetricByMetricName("system.cpu.utilization")).toBeDefined();
    expect(getHostMetricByMetricName("system.memory.usage")).toBeDefined();
  });
});
