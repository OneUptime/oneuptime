import {
  ATTRIBUTE_SPLIT_METRICS,
  AttributeSplitMetric,
  getAttributeSplitMetric,
  isSplitDecidedByCaller,
} from "../../../Types/Metrics/AttributeSplitMetrics";
import { getAllHostMetrics } from "../../../Types/Monitor/HostMetricCatalog";
import { describe, expect, test } from "@jest/globals";

/*
 * THE METRICS ONE AVERAGE CANNOT READ (issue #4784).
 *
 * The host agent reports system.cpu.utilization once per CPU and state, and
 * the states of a CPU add up to 1, so an average across every row is about
 * 1/8 whatever the load - the "flat 0.125" an investigation read on a host
 * that was out of CPU. The catalog names each metric whose rows are split
 * like that, by which attribute, and what one series of the split is.
 */

function split(metricName: string): AttributeSplitMetric {
  const found: AttributeSplitMetric | undefined =
    getAttributeSplitMetric(metricName);

  if (!found) {
    throw new Error(`${metricName} is not in the catalog`);
  }

  return found;
}

describe("the catalog", () => {
  test("names each metric once, each with a split and what a series is", () => {
    const names: Array<string> = ATTRIBUTE_SPLIT_METRICS.map(
      (metric: AttributeSplitMetric): string => {
        return metric.metricName;
      },
    );

    expect(new Set(names).size).toBe(names.length);

    for (const metric of ATTRIBUTE_SPLIT_METRICS) {
      expect(metric.splitBy.length).toBeGreaterThan(0);
      expect(new Set(metric.splitBy).size).toBe(metric.splitBy.length);
      expect(metric.meaning.trim().length).toBeGreaterThan(20);
      expect(metric.meaning.trim().endsWith(".")).toBe(true);
    }
  });

  test("CPU is split by state, under either name a collector sends", () => {
    expect(split("system.cpu.utilization").splitBy).toEqual([
      "state",
      "cpu.mode",
    ]);
    expect(split("system.cpu.time").splitBy).toEqual(["state", "cpu.mode"]);
    // What a reader needs to know to read it: the states sum to 1, busy = user + system.
    expect(split("system.cpu.utilization").meaning).toContain("add up to 1");
    expect(split("system.cpu.utilization").meaning).toContain(
      "Busy CPU is user + system",
    );
  });

  test("memory is split by state, and used is the memory in use", () => {
    for (const name of ["system.memory.utilization", "system.memory.usage"]) {
      expect(split(name).splitBy).toEqual(["state", "system.memory.state"]);
      expect(split(name).meaning).toContain("used is the memory in use");
    }
  });

  test("filesystems are split by mount point, so one full disk is never averaged away", () => {
    expect(split("system.filesystem.utilization").splitBy).toEqual([
      "mountpoint",
      "system.filesystem.mountpoint",
    ]);
    expect(split("system.filesystem.utilization").meaning).toContain(
      "the fullest one is the one that runs out",
    );
    // Usage is per mount and per state.
    expect(split("system.filesystem.usage").splitBy).toEqual([
      "mountpoint",
      "system.filesystem.mountpoint",
      "state",
      "system.filesystem.state",
    ]);
  });

  test("every split host metric the host catalog offers is in it", () => {
    const hostMetricNames: Array<string> = getAllHostMetrics().map(
      (metric: { metricName: string }): string => {
        return metric.metricName;
      },
    );

    for (const name of [
      "system.cpu.utilization",
      "system.memory.utilization",
      "system.memory.usage",
      "system.filesystem.utilization",
      "system.filesystem.usage",
      "system.processes.count",
      "system.network.io",
    ]) {
      expect(hostMetricNames).toContain(name);
      expect(getAttributeSplitMetric(name)).toBeDefined();
    }
  });

  test("a metric read as one number is not in it", () => {
    for (const name of [
      "system.cpu.load_average.1m",
      "container.cpu.utilization",
      "http.server.request.duration",
      "oneuptime.monitor.response.time",
    ]) {
      expect(getAttributeSplitMetric(name)).toBeUndefined();
    }
    expect(getAttributeSplitMetric(undefined)).toBeUndefined();
    expect(getAttributeSplitMetric("")).toBeUndefined();
  });
});

describe("isSplitDecidedByCaller", () => {
  const cpu: AttributeSplitMetric = split("system.cpu.utilization");

  test("a filter on the split attribute decides it (state=idle)", () => {
    expect(
      isSplitDecidedByCaller({
        split: cpu,
        attributeFilterKeys: ["state"],
        groupBy: [],
      }),
    ).toBe(true);
    // The newer name counts too.
    expect(
      isSplitDecidedByCaller({
        split: cpu,
        attributeFilterKeys: ["cpu.mode"],
        groupBy: [],
      }),
    ).toBe(true);
  });

  test("grouping by the split attribute decides it", () => {
    expect(
      isSplitDecidedByCaller({
        split: cpu,
        attributeFilterKeys: [],
        groupBy: ["resource.host.name", "state"],
      }),
    ).toBe(true);
  });

  test("filtering or grouping by anything else leaves it to the tool", () => {
    expect(
      isSplitDecidedByCaller({
        split: cpu,
        attributeFilterKeys: ["resource.host.name"],
        groupBy: ["cpu"],
      }),
    ).toBe(false);
    expect(
      isSplitDecidedByCaller({
        split: cpu,
        attributeFilterKeys: [],
        groupBy: [],
      }),
    ).toBe(false);
  });
});
