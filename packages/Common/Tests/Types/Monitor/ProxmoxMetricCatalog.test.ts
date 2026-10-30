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


/*
 * The agent scrapes every 30 seconds and a metric monitor reads one-minute
 * buckets, so a Sum adds two or three scrapes of every series: the info
 * series summed "to count the nodes" read twice the nodes, and a lifetime
 * counter summed read twice its total. No default adds scrapes together.
 */
describe("ProxmoxMetricCatalog - defaults that do not add scrapes together (regression)", () => {
  test("no metric defaults to Sum", () => {
    for (const metric of getAllProxmoxMetrics()) {
      expect({ id: metric.id, sum: metric.defaultAggregation === "Sum" }).toEqual(
        { id: metric.id, sum: false },
      );
    }
  });

  test("no description says to sum a series to count", () => {
    for (const metric of getAllProxmoxMetrics()) {
      expect({
        id: metric.id,
        says: /sum (it )?to count|sum across/i.test(metric.description),
      }).toEqual({ id: metric.id, says: false });
    }
  });

  test("the info series read 1 while their object exists, and the counters their latest total", () => {
    for (const id of [
      "pve-node-info",
      "pve-guest-info",
      "pve-storage-info",
      "pve-replication-info",
      "pve-network-receive-bytes",
      "pve-network-transmit-bytes",
      "pve-disk-read-bytes",
      "pve-disk-write-bytes",
    ]) {
      const metric: ProxmoxMetricDefinition | undefined =
        getProxmoxMetricById(id);

      expect(metric?.defaultAggregation).toBe("Max");
    }
  });
});
