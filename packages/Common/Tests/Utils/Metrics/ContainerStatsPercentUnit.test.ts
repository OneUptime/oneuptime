import ContainerStatsPercentUnit, {
  CONTAINER_STATS_PERCENT_METRIC_NAMES,
  DOCKER_STATS_RECEIVER_SCOPE_NAME,
  PODMAN_STATS_RECEIVER_SCOPE_NAME,
} from "../../../Utils/Metrics/ContainerStatsPercentUnit";
import ValueFormatter from "../../../Utils/ValueFormatter";
import MetricUnitUtil from "../../../Utils/MetricUnitUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * The docker_stats and podman_stats receivers send their CPU and memory
 * percents as 0-100 but declare the unit "1", a 0-1 fraction - so every
 * chart, conversion and container row read them 100 times too high (a
 * container at 4.36% of its memory limit read 436.64%). Ingest records the
 * unit their numbers are in, "%", for those receivers only - told apart by
 * the instrumentation scope - and nothing else.
 */

const KUBELETSTATS_SCOPE: string =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/kubeletstatsreceiver";

describe("ContainerStatsPercentUnit.getStoredUnit", () => {
  test.each<[string, string]>([
    [DOCKER_STATS_RECEIVER_SCOPE_NAME, "container.cpu.utilization"],
    [DOCKER_STATS_RECEIVER_SCOPE_NAME, "container.memory.percent"],
    ["otelcol/dockerstatsreceiver", "container.cpu.utilization"],
    ["otelcol/dockerstatsreceiver", "container.memory.percent"],
    [PODMAN_STATS_RECEIVER_SCOPE_NAME, "container.cpu.percent"],
    [PODMAN_STATS_RECEIVER_SCOPE_NAME, "container.memory.percent"],
    ["otelcol/podmanreceiver", "container.cpu.percent"],
    ["otelcol/podmanreceiver", "container.memory.percent"],
  ])("%s's %s, declared '1', is stored as '%'", (scopeName, metricName) => {
    expect(
      ContainerStatsPercentUnit.getStoredUnit({
        scopeName,
        metricName,
        declaredUnit: "1",
      }),
    ).toBe("%");
    expect(
      ContainerStatsPercentUnit.isPercentDeclaredAsFraction({
        scopeName,
        metricName,
        declaredUnit: "1",
      }),
    ).toBe(true);
  });

  test("the metric name is matched the way ingest stores it (lowercased), and stray spaces do not matter", () => {
    expect(
      ContainerStatsPercentUnit.getStoredUnit({
        scopeName: ` ${DOCKER_STATS_RECEIVER_SCOPE_NAME} `,
        metricName: "Container.Memory.Percent",
        declaredUnit: " 1 ",
      }),
    ).toBe("%");
  });

  test.each<[string | undefined, string, string | undefined]>([
    // Kubernetes: container.cpu.utilization is CPU cores, declared "1".
    [KUBELETSTATS_SCOPE, "container.cpu.utilization", "1"],
    // Nothing says whose metric this is.
    [undefined, "container.memory.percent", "1"],
    ["", "container.cpu.utilization", "1"],
    ["my.company/collector", "container.memory.percent", "1"],
    // A docker_stats metric declared "1" that is not a percent.
    [DOCKER_STATS_RECEIVER_SCOPE_NAME, "container.cpu.shares", "1"],
    // podman_stats sends no container.cpu.utilization; docker_stats no container.cpu.percent.
    [PODMAN_STATS_RECEIVER_SCOPE_NAME, "container.cpu.utilization", "1"],
    [DOCKER_STATS_RECEIVER_SCOPE_NAME, "container.cpu.percent", "1"],
    // Units that already say what they are.
    [DOCKER_STATS_RECEIVER_SCOPE_NAME, "container.memory.percent", "%"],
    [DOCKER_STATS_RECEIVER_SCOPE_NAME, "container.cpu.usage.total", "ns"],
    [DOCKER_STATS_RECEIVER_SCOPE_NAME, "container.memory.usage.total", "By"],
    // No unit: nothing to correct.
    [DOCKER_STATS_RECEIVER_SCOPE_NAME, "container.memory.percent", undefined],
    [DOCKER_STATS_RECEIVER_SCOPE_NAME, "container.memory.percent", ""],
  ])(
    "scope %p, %s declared %p keeps its declared unit",
    (scopeName, metricName, declaredUnit) => {
      expect(
        ContainerStatsPercentUnit.getStoredUnit({
          scopeName,
          metricName,
          declaredUnit,
        }),
      ).toBe(declaredUnit);
      expect(
        ContainerStatsPercentUnit.isPercentDeclaredAsFraction({
          scopeName,
          metricName,
          declaredUnit,
        }),
      ).toBe(false);
    },
  );
});

describe("what the stored unit changes for the reader", () => {
  /*
   * The customer's traefik container: 175 MB of a 4.01 GB limit, sent as
   * 4.3664 under "1". Read as a fraction it drew as 436.64%.
   */
  test("regression: the customer's 4.3664 drew as 436.64% under the declared '1', and as 4.37% under the stored '%'", () => {
    const declared: string = "1";
    const stored: string = ContainerStatsPercentUnit.getStoredUnit({
      scopeName: DOCKER_STATS_RECEIVER_SCOPE_NAME,
      metricName: "container.memory.percent",
      declaredUnit: declared,
    })!;

    expect(
      ValueFormatter.formatValue(4.3664, declared, {
        metricName: "container.memory.percent",
      }),
    ).toBe("436.64%");
    expect(
      ValueFormatter.formatValue(4.3664, stored, {
        metricName: "container.memory.percent",
      }),
    ).toBe("4.37%");
  });

  test("a chart or threshold in '%' converts the stored '%' by nothing, where '1' multiplied by 100", () => {
    const stored: string = ContainerStatsPercentUnit.getStoredUnit({
      scopeName: DOCKER_STATS_RECEIVER_SCOPE_NAME,
      metricName: "container.cpu.utilization",
      declaredUnit: "1",
    })!;

    expect(
      MetricUnitUtil.convertToMetricUnit({
        value: 7.17,
        fromUnit: "1",
        metricUnit: "%",
      }),
    ).toBeCloseTo(717, 10);
    expect(
      MetricUnitUtil.convertToMetricUnit({
        value: 7.17,
        fromUnit: stored,
        metricUnit: "%",
      }),
    ).toBe(7.17);
  });

  test("Kubernetes' container.cpu.utilization (cores, '1') still reads times 100: a percent of one core", () => {
    const stored: string | undefined = ContainerStatsPercentUnit.getStoredUnit({
      scopeName: KUBELETSTATS_SCOPE,
      metricName: "container.cpu.utilization",
      declaredUnit: "1",
    });

    expect(stored).toBe("1");
    expect(
      ValueFormatter.formatValue(0.05, stored!, {
        metricName: "container.cpu.utilization",
      }),
    ).toBe("5.00%");
  });
});

describe("ContainerStatsPercentUnit.keepsStoredPercentUnit", () => {
  test.each([...CONTAINER_STATS_PERCENT_METRIC_NAMES])(
    "a stored '%' for %s stays when another producer declares '1'",
    (metricName: string) => {
      expect(
        ContainerStatsPercentUnit.keepsStoredPercentUnit({
          metricName,
          storedUnit: "%",
          incomingUnit: "1",
        }),
      ).toBe(true);
    },
  );

  test.each<[string, string | undefined, string | undefined]>([
    // The upgrade: an old agent's "1" becomes "%".
    ["container.cpu.utilization", "1", "%"],
    ["container.memory.percent", "1", "%"],
    // A first unit, or the same one.
    ["container.cpu.utilization", "", "%"],
    ["container.cpu.utilization", undefined, "1"],
    ["container.cpu.utilization", "%", "%"],
    ["container.cpu.utilization", "1", "1"],
    // Any other unit change, or any other metric, goes through as before.
    ["container.cpu.utilization", "%", "ns"],
    ["system.cpu.utilization", "%", "1"],
    ["http.server.duration", "%", "1"],
  ])(
    "%s stored %p, incoming %p: the incoming unit is not held back",
    (metricName, storedUnit, incomingUnit) => {
      expect(
        ContainerStatsPercentUnit.keepsStoredPercentUnit({
          metricName,
          storedUnit,
          incomingUnit,
        }),
      ).toBe(false);
    },
  );

  test("the names are matched lowercased and trimmed", () => {
    expect(
      ContainerStatsPercentUnit.keepsStoredPercentUnit({
        metricName: " Container.CPU.Utilization ",
        storedUnit: " % ",
        incomingUnit: " 1 ",
      }),
    ).toBe(true);
  });

  test("covers exactly the receivers' percents", () => {
    expect([...CONTAINER_STATS_PERCENT_METRIC_NAMES].sort()).toEqual([
      "container.cpu.percent",
      "container.cpu.utilization",
      "container.memory.percent",
    ]);
  });
});
