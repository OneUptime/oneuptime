import {
  ProxmoxMetricCategory,
  ProxmoxMetricDefinition,
  getAllProxmoxMetricCategories,
  getAllProxmoxMetrics,
  getProxmoxMetricById,
  getProxmoxMetricByMetricName,
  getProxmoxMetricsByCategory,
} from "../../../Types/Monitor/ProxmoxMetricCatalog";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { describe, expect, test } from "@jest/globals";

describe("ProxmoxMetricCatalog", () => {
  const allMetrics: Array<ProxmoxMetricDefinition> = getAllProxmoxMetrics();
  const allCategories: Array<ProxmoxMetricCategory> =
    getAllProxmoxMetricCategories();
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
    const ids: Array<string> = allMetrics.map((m: ProxmoxMetricDefinition) => {
      return m.id;
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("metric names are unique", () => {
    const names: Array<string> = allMetrics.map(
      (m: ProxmoxMetricDefinition) => {
        return m.metricName;
      },
    );
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
      expect(getProxmoxMetricsByCategory(category).length).toBeGreaterThan(0);
    }
  });

  test("getProxmoxMetricsByCategory returns only metrics of that category", () => {
    for (const category of allCategories) {
      for (const metric of getProxmoxMetricsByCategory(category)) {
        expect(metric.category).toBe(category);
      }
    }
  });

  test("getProxmoxMetricById round-trips every metric", () => {
    for (const metric of allMetrics) {
      expect(getProxmoxMetricById(metric.id)).toEqual(metric);
    }
  });

  test("getProxmoxMetricById returns undefined for an unknown id", () => {
    expect(getProxmoxMetricById("does-not-exist")).toBeUndefined();
    expect(getProxmoxMetricById("")).toBeUndefined();
  });

  test("getProxmoxMetricByMetricName round-trips every metric", () => {
    for (const metric of allMetrics) {
      expect(getProxmoxMetricByMetricName(metric.metricName)).toEqual(metric);
    }
  });

  test("getProxmoxMetricByMetricName returns undefined for an unknown name", () => {
    expect(getProxmoxMetricByMetricName("nope.nope.nope")).toBeUndefined();
  });

  test("known metrics are present", () => {
    expect(getProxmoxMetricByMetricName("pve_up")).toBeDefined();
    expect(getProxmoxMetricByMetricName("pve_uptime_seconds")).toBeDefined();
  });
});
