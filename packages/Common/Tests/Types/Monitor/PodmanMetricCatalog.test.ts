import {
  PodmanMetricCategory,
  PodmanMetricDefinition,
  getAllPodmanMetricCategories,
  getAllPodmanMetrics,
  getPodmanMetricById,
  getPodmanMetricByMetricName,
  getPodmanMetricsByCategory,
} from "../../../Types/Monitor/PodmanMetricCatalog";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

describe("PodmanMetricCatalog", () => {
  const allMetrics: Array<PodmanMetricDefinition> = getAllPodmanMetrics();
  const allCategories: Array<PodmanMetricCategory> =
    getAllPodmanMetricCategories();
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
    const ids: Array<string> = allMetrics.map((m: PodmanMetricDefinition) => {
      return m.id;
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("a metric name appears once per attribute filter", () => {
    const keys: Array<string> = allMetrics.map((m: PodmanMetricDefinition) => {
      return `${m.metricName} ${JSON.stringify(m.attributes || {})}`;
    });
    expect(new Set(keys).size).toBe(keys.length);
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
      expect(getPodmanMetricsByCategory(category).length).toBeGreaterThan(0);
    }
  });

  test("getPodmanMetricsByCategory returns only metrics of that category", () => {
    for (const category of allCategories) {
      for (const metric of getPodmanMetricsByCategory(category)) {
        expect(metric.category).toBe(category);
      }
    }
  });

  test("getPodmanMetricById round-trips every metric", () => {
    for (const metric of allMetrics) {
      expect(getPodmanMetricById(metric.id)).toEqual(metric);
    }
  });

  test("getPodmanMetricById returns undefined for an unknown id", () => {
    expect(getPodmanMetricById("does-not-exist")).toBeUndefined();
    expect(getPodmanMetricById("")).toBeUndefined();
  });

  test("getPodmanMetricByMetricName finds every metric name", () => {
    for (const metric of allMetrics) {
      const found: PodmanMetricDefinition | undefined =
        getPodmanMetricByMetricName(metric.metricName);

      expect(found?.metricName).toBe(metric.metricName);

      // A name the catalog offers once comes back as that very entry.
      if (
        allMetrics.filter((other: PodmanMetricDefinition): boolean => {
          return other.metricName === metric.metricName;
        }).length === 1
      ) {
        expect(found).toEqual(metric);
      }
    }
  });

  test("getPodmanMetricByMetricName returns undefined for an unknown name", () => {
    expect(getPodmanMetricByMetricName("nope.nope.nope")).toBeUndefined();
  });

  /*
   * Regression: 7 of the catalog's 19 metrics never arrived. The
   * docker_stats receiver has no `container.blockio.io_service_bytes_recursive
   * .read` / `.write` (it emits one metric with an `operation` attribute),
   * and its optional metrics - per-core CPU, memory RSS and cache (cgroup v1
   * only), the network packet counters - stay off in the shipped agent
   * config. A metric that never arrives is a monitor that never fires.
   */
  const OPTIONAL_RECEIVER_METRICS: Array<string> = [
    "container.cpu.usage.percpu",
    "container.memory.rss",
    "container.memory.cache",
    "container.network.io.usage.rx_packets",
    "container.network.io.usage.tx_packets",
    "container.network.io.usage.rx_errors",
    "container.network.io.usage.tx_errors",
  ];

  const agentConfig: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../../agents/PodmanAgent/otel-collector-config.yaml",
    ),
    "utf8",
  );

  test("offers no optional receiver metric the shipped agent leaves off", () => {
    for (const metric of allMetrics) {
      if (!OPTIONAL_RECEIVER_METRICS.includes(metric.metricName)) {
        continue;
      }

      expect({ metric: metric.metricName, enabled: true }).toEqual({
        metric: metric.metricName,
        enabled: agentConfig.includes(
          `${metric.metricName}:\n        enabled: true`,
        ),
      });
    }

    for (const metricName of OPTIONAL_RECEIVER_METRICS) {
      expect(getPodmanMetricByMetricName(metricName)).toBeUndefined();
    }
  });

  test("reads block I/O as the receiver emits it: one metric, filtered by operation", () => {
    const blockIo: Array<PodmanMetricDefinition> = allMetrics.filter(
      (metric: PodmanMetricDefinition): boolean => {
        return metric.category === "BlockIO";
      },
    );

    expect(
      blockIo.map((metric: PodmanMetricDefinition) => {
        return [metric.metricName, metric.attributes];
      }),
    ).toEqual([
      ["container.blockio.io_service_bytes_recursive", { operation: "read" }],
      ["container.blockio.io_service_bytes_recursive", { operation: "write" }],
    ]);

    for (const metric of allMetrics) {
      expect(metric.metricName.endsWith(".read")).toBe(false);
      expect(metric.metricName.endsWith(".write")).toBe(false);
    }
  });

  test("known metrics are present", () => {
    expect(
      getPodmanMetricByMetricName("container.cpu.usage.total"),
    ).toBeDefined();
    expect(
      getPodmanMetricByMetricName("container.cpu.utilization"),
    ).toBeDefined();
  });

  /*
   * A Custom Metric monitor on the lifetime count, with the list's
   * Maximum, fires on a container's history and never recovers. The
   * restarts the agent sends with each sample, summed over the window, are
   * the restarts in it - what Container Restart Loop reads.
   */
  test("offers the restarts since each sample, summed, beside the lifetime count", () => {
    expect(getPodmanMetricByMetricName("container.restarts.increase")).toEqual(
      expect.objectContaining({
        category: "Container",
        defaultAggregation: AggregationType.Sum,
        unit: "count",
      }),
    );
    expect(getPodmanMetricByMetricName("container.restarts")).toEqual(
      expect.objectContaining({
        category: "Container",
        defaultAggregation: AggregationType.Max,
      }),
    );
  });

  test("the restarts since each sample are what the shipped agent makes of container.restarts", () => {
    expect(agentConfig).toContain("container.restarts:\n        enabled: true");
    expect(agentConfig).toContain(
      'copy_metric(name="container.restarts.increase", description="Times the container restarted since the agent\'s previous sample of it.") where metric.name == "container.restarts"',
    );
    expect(agentConfig).toContain("cumulative_to_delta/restarts-increase:");
  });
});
