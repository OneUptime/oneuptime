import {
  DockerSwarmMetricCategory,
  DockerSwarmMetricDefinition,
  getAllDockerSwarmMetricCategories,
  getAllDockerSwarmMetrics,
  getDockerSwarmMetricById,
  getDockerSwarmMetricByMetricName,
  getDockerSwarmMetricsByCategory,
} from "../../../Types/Monitor/DockerSwarmMetricCatalog";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

describe("DockerSwarmMetricCatalog", () => {
  const allMetrics: Array<DockerSwarmMetricDefinition> =
    getAllDockerSwarmMetrics();
  const allCategories: Array<DockerSwarmMetricCategory> =
    getAllDockerSwarmMetricCategories();
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
    const ids: Array<string> = allMetrics.map(
      (m: DockerSwarmMetricDefinition) => {
        return m.id;
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("metric names are unique", () => {
    const names: Array<string> = allMetrics.map(
      (m: DockerSwarmMetricDefinition) => {
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
      expect(getDockerSwarmMetricsByCategory(category).length).toBeGreaterThan(
        0,
      );
    }
  });

  test("getDockerSwarmMetricsByCategory returns only metrics of that category", () => {
    for (const category of allCategories) {
      for (const metric of getDockerSwarmMetricsByCategory(category)) {
        expect(metric.category).toBe(category);
      }
    }
  });

  test("getDockerSwarmMetricById round-trips every metric", () => {
    for (const metric of allMetrics) {
      expect(getDockerSwarmMetricById(metric.id)).toEqual(metric);
    }
  });

  test("getDockerSwarmMetricById returns undefined for an unknown id", () => {
    expect(getDockerSwarmMetricById("does-not-exist")).toBeUndefined();
    expect(getDockerSwarmMetricById("")).toBeUndefined();
  });

  test("getDockerSwarmMetricByMetricName round-trips every metric", () => {
    for (const metric of allMetrics) {
      expect(getDockerSwarmMetricByMetricName(metric.metricName)).toEqual(
        metric,
      );
    }
  });

  test("getDockerSwarmMetricByMetricName returns undefined for an unknown name", () => {
    expect(getDockerSwarmMetricByMetricName("nope.nope.nope")).toBeUndefined();
  });

  test("known metrics are present", () => {
    expect(
      getDockerSwarmMetricByMetricName("container.cpu.utilization"),
    ).toBeDefined();
    expect(
      getDockerSwarmMetricByMetricName("container.memory.usage.total"),
    ).toBeDefined();
  });
});

/*
 * The swarm's own state, which the agent's poller sends every minute (files
 * 0.161.3 on), is in the catalog under "Swarm" with the very names the
 * agent writes, so a metric monitor's picker offers them and the Node Not
 * Ready and Service Replicas Mismatch templates read catalog metrics.
 */
describe("DockerSwarmMetricCatalog - the swarm's own state", () => {
  const AGENT_SCRIPT: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "agents",
      "DockerSwarmAgent",
      "inventory-snapshot.sh",
    ),
    "utf8",
  );

  test("the Swarm category holds the three series the agent's poller sends, by their names", () => {
    expect(getAllDockerSwarmMetricCategories()).toContain("Swarm");
    const swarm: Array<string> = getDockerSwarmMetricsByCategory("Swarm").map(
      (metric: DockerSwarmMetricDefinition): string => {
        return metric.metricName;
      },
    );
    expect(swarm).toEqual([
      "docker.swarm.node.ready",
      "docker.swarm.service.replicas.desired",
      "docker.swarm.service.replicas.running",
    ]);
    for (const name of swarm) {
      expect(AGENT_SCRIPT).toContain(`gauge("${name}";`);
    }
  });

  test("a node's readiness is read at its lowest, the replica counts as averages", () => {
    expect(
      getDockerSwarmMetricByMetricName("docker.swarm.node.ready")
        ?.defaultAggregation,
    ).toBe(AggregationType.Min);
    for (const name of [
      "docker.swarm.service.replicas.desired",
      "docker.swarm.service.replicas.running",
    ]) {
      const metric: DockerSwarmMetricDefinition | undefined =
        getDockerSwarmMetricByMetricName(name);
      expect(metric?.defaultAggregation).toBe(AggregationType.Avg);
      expect(metric?.unit).toBe("count");
    }
  });
});
