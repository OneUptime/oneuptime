import {
  IoTMetricCategory,
  IoTMetricDefinition,
  getAllIoTMetricCategories,
  getAllIoTMetrics,
  getIoTMetricById,
  getIoTMetricByMetricName,
  getIoTMetricsByCategory,
} from "../../../Types/Monitor/IotMetricCatalog";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { describe, expect, test } from "@jest/globals";

describe("IotMetricCatalog", () => {
  const allMetrics: Array<IoTMetricDefinition> = getAllIoTMetrics();
  const allCategories: Array<IoTMetricCategory> = getAllIoTMetricCategories();
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
    const ids: Array<string> = allMetrics.map((m: IoTMetricDefinition) => {
      return m.id;
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("metric names are unique", () => {
    const names: Array<string> = allMetrics.map((m: IoTMetricDefinition) => {
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
      expect(getIoTMetricsByCategory(category).length).toBeGreaterThan(0);
    }
  });

  test("getIoTMetricsByCategory returns only metrics of that category", () => {
    for (const category of allCategories) {
      for (const metric of getIoTMetricsByCategory(category)) {
        expect(metric.category).toBe(category);
      }
    }
  });

  test("getIoTMetricById round-trips every metric", () => {
    for (const metric of allMetrics) {
      expect(getIoTMetricById(metric.id)).toEqual(metric);
    }
  });

  test("getIoTMetricById returns undefined for an unknown id", () => {
    expect(getIoTMetricById("does-not-exist")).toBeUndefined();
    expect(getIoTMetricById("")).toBeUndefined();
  });

  test("getIoTMetricByMetricName round-trips every metric", () => {
    for (const metric of allMetrics) {
      expect(getIoTMetricByMetricName(metric.metricName)).toEqual(metric);
    }
  });

  test("getIoTMetricByMetricName returns undefined for an unknown name", () => {
    expect(getIoTMetricByMetricName("nope.nope.nope")).toBeUndefined();
  });

  test("known metrics are present", () => {
    expect(getIoTMetricByMetricName("iot_device_up")).toBeDefined();
    expect(getIoTMetricByMetricName("iot_battery_percent")).toBeDefined();
  });
});
