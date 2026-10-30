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

/*
 * A Custom Metric reads one query. The hostmetrics receiver splits most of
 * these metrics by an attribute whose rows add up to the whole (CPU and
 * memory by state, filesystems by mount and state, processes by status), so
 * an average over every row reads 1/N of the total whatever the load. Each
 * entry says what its one query means: a filter on the row it counts, or a
 * group-by that judges each row on its own.
 */
describe("HostMetricCatalog - what a Custom Metric's one query reads", () => {
  function entry(metricName: string): HostMetricDefinition {
    const found: HostMetricDefinition | undefined =
      getHostMetricByMetricName(metricName);

    if (!found) {
      throw new Error(`${metricName} is not in the catalog`);
    }

    return found;
  }

  test("CPU counts the user state, and never one series per state, where idle would pass any busy threshold", () => {
    const cpu: HostMetricDefinition = entry("system.cpu.utilization");

    expect(cpu.attributes).toEqual({ state: "user" });
    expect(cpu.groupByAttributeKeys || []).not.toContain("state");
  });

  test("memory counts the memory in use", () => {
    for (const name of ["system.memory.utilization", "system.memory.usage"]) {
      expect(entry(name).attributes).toEqual({ state: "used" });
    }
  });

  test("each filesystem is judged on its own, so one full disk is not averaged away", () => {
    expect(
      entry("system.filesystem.utilization").groupByAttributeKeys,
    ).toEqual(["mountpoint"]);
    expect(entry("system.filesystem.usage").groupByAttributeKeys).toEqual([
      "mountpoint",
    ]);
    // Usage is split by state too: the bytes in use, not used + free.
    expect(entry("system.filesystem.usage").attributes).toEqual({
      state: "used",
    });
  });

  test("processes, network and per-process CPU give one series per status, direction or executable", () => {
    expect(entry("system.processes.count").groupByAttributeKeys).toEqual([
      "status",
    ]);
    expect(entry("system.network.io").groupByAttributeKeys).toEqual([
      "direction",
    ]);
    expect(entry("process.cpu.utilization").groupByAttributeKeys).toEqual([
      "resource.process.executable.name",
    ]);
  });

  test("no entry groups by a state, and only the load averages read one plain number", () => {
    for (const metric of allMetricsOf()) {
      expect({
        metric: metric.metricName,
        groupsByState: (metric.groupByAttributeKeys || []).includes("state"),
      }).toEqual({ metric: metric.metricName, groupsByState: false });

      const decided: boolean =
        Object.keys(metric.attributes || {}).length > 0 ||
        (metric.groupByAttributeKeys || []).length > 0;

      expect({ metric: metric.metricName, decided: decided }).toEqual({
        metric: metric.metricName,
        decided: !metric.metricName.startsWith("system.cpu.load_average."),
      });
    }
  });

  function allMetricsOf(): Array<HostMetricDefinition> {
    return getAllHostMetrics();
  }
});
