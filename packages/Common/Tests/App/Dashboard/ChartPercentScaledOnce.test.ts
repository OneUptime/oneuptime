import KubernetesCpuUtils, {
  NodeAllocatableCpu,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCpuUtils";
import MetricResultUnitConverter from "../../../Utils/Metrics/MetricResultUnitConverter";
import ValueFormatter from "../../../Utils/ValueFormatter";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { describe, expect, test } from "@jest/globals";

/*
 * A percent on a chart is scaled to a percent ONCE.
 *
 * A chart's values go through two steps: the fetch converts each query's
 * stored values from the metric's unit (the catalog's, per project) to the
 * query's legend unit (MetricResultUnitConverter, in MetricUtil.fetchResults),
 * then MetricCharts runs the query's own transformValue on each point.
 *
 * Both used to scale the same percent:
 *
 *   - The Kubernetes pages chart CPU in cores - container.cpu.utilization,
 *     k8s.pod.cpu.utilization, k8s.node.cpu.utilization, which the agent
 *     declares "1" - with legend unit "%" and a transform that divides by
 *     the node's allocatable cores and multiplies by 100. "1" to "%" had
 *     already multiplied by 100: a pod using 0.05 of a core on a 4-core node
 *     (1.25% of the node) was drawn at 125%.
 *   - The Docker, Podman and Swarm pages chart docker_stats' percents
 *     (0-100, declared "1") with legend unit "%": times 100 again, the
 *     customer's 4.36% memory as 436%. Ingest now records their unit as "%"
 *     (ContainerStatsPercentUnit), so "%" to "%" converts nothing.
 *
 * Here the two steps run as the chart runs them, on the queries those pages
 * build.
 */

const NODE: string = "node-a";

function point(value: number, nodeName: string = NODE): AggregatedModel {
  return {
    timestamp: new Date("2026-10-19T11:30:00.000Z"),
    value: value,
    attributes: { "resource.k8s.node.name": nodeName },
  } as unknown as AggregatedModel;
}

function query(input: {
  metricName: string;
  legendUnit: string;
  transformValue?: MetricQueryConfigData["transformValue"];
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: "",
      description: "",
      legend: "",
      legendUnit: input.legendUnit,
    },
    metricQueryData: {
      filterData: {
        metricName: input.metricName,
        aggegationType: MetricsAggregationType.Avg,
      },
    },
    transformValue: input.transformValue,
  };
}

/*
 * What the chart draws for one stored value: the fetch's conversion to the
 * legend unit, then the query's transform.
 */
function drawn(input: {
  queryConfig: MetricQueryConfigData;
  stored: number;
  catalogUnit: string;
  nodeName?: string;
}): number {
  const metricName: string = input.queryConfig.metricQueryData.filterData
    .metricName as string;
  const [converted] = MetricResultUnitConverter.convertQueryResultsToDisplayUnit(
    {
      queryConfigs: [input.queryConfig],
      results: [{ data: [point(input.stored, input.nodeName)] }],
      nativeUnitByMetricName: new Map<string, string>([
        [metricName.toLowerCase(), input.catalogUnit],
      ]),
    },
  ) as [AggregatedResult];
  const row: AggregatedModel = converted.data[0]!;
  return input.queryConfig.transformValue
    ? input.queryConfig.transformValue(row.value, row)
    : row.value;
}

const FOUR_CORE_CLUSTER: NodeAllocatableCpu =
  KubernetesCpuUtils.buildAllocatable(new Map<string, number>([[NODE, 4]]));

describe("Kubernetes CPU charts: cores over the node's allocatable cores, scaled once", () => {
  test.each([
    "container.cpu.utilization",
    "k8s.pod.cpu.utilization",
  ])(
    "regression: %s at 0.05 cores on a 4-core node draws 1.25%, not 125%",
    (metricName: string) => {
      const value: number = drawn({
        queryConfig: query({
          metricName,
          legendUnit: "%",
          transformValue:
            KubernetesCpuUtils.makeCpuPercentTransform(FOUR_CORE_CLUSTER),
        }),
        stored: 0.05,
        catalogUnit: "1",
      });

      expect(value).toBeCloseTo(1.25, 10);
      expect(ValueFormatter.formatValue(value, "%")).toBe("1.25%");
    },
  );

  test("regression: k8s.node.cpu.utilization at 3 of 4 cores draws 75%, not 7500%", () => {
    const value: number = drawn({
      queryConfig: query({
        metricName: "k8s.node.cpu.utilization",
        legendUnit: "%",
        transformValue: KubernetesCpuUtils.makeScalarCpuPercentTransform(4),
      }),
      stored: 3,
      catalogUnit: "1",
    });

    expect(value).toBeCloseTo(75, 10);
  });

  test("whatever unit the catalog holds for the name: a project that also runs a Docker agent stores '%' for container.cpu.utilization", () => {
    for (const catalogUnit of ["1", "%", ""]) {
      expect(
        drawn({
          queryConfig: query({
            metricName: "container.cpu.utilization",
            legendUnit: "%",
            transformValue:
              KubernetesCpuUtils.makeCpuPercentTransform(FOUR_CORE_CLUSTER),
          }),
          stored: 0.05,
          catalogUnit,
        }),
      ).toBeCloseTo(1.25, 10);
    }
  });

  test("a pod on a node with no allocatable reading falls back to the cluster's average node", () => {
    const twoNodes: NodeAllocatableCpu = KubernetesCpuUtils.buildAllocatable(
      new Map<string, number>([
        ["node-a", 2],
        ["node-b", 6],
      ]),
    );

    expect(
      drawn({
        queryConfig: query({
          metricName: "k8s.pod.cpu.utilization",
          legendUnit: "%",
          transformValue: KubernetesCpuUtils.makeCpuPercentTransform(twoNodes),
        }),
        stored: 0.4,
        catalogUnit: "1",
        nodeName: "node-unknown",
      }),
    ).toBeCloseTo(10, 10);
  });
});

describe("Proxmox CPU charts: the 0-1 ratio times 100, once", () => {
  test.each(["", "1"])(
    "pve_cpu_usage_ratio 0.25 (catalog unit %p) draws 25%",
    (catalogUnit: string) => {
      expect(
        drawn({
          queryConfig: query({
            metricName: "pve_cpu_usage_ratio",
            legendUnit: "%",
            transformValue: (value: number): number => {
              return value * 100;
            },
          }),
          stored: 0.25,
          catalogUnit,
        }),
      ).toBeCloseTo(25, 10);
    },
  );
});

describe("Docker, Podman and Swarm charts: a docker_stats percent in '%'", () => {
  test.each([
    ["container.cpu.utilization", 7.17],
    ["container.memory.percent", 4.3664],
  ])(
    "%s %p, stored under '%' as ingest records it, draws as itself",
    (metricName: string, stored: number) => {
      const value: number = drawn({
        queryConfig: query({ metricName, legendUnit: "%" }),
        stored,
        catalogUnit: "%",
      });

      expect(value).toBe(stored);
    },
  );

  test("regression: under the '1' docker_stats declared, the customer's memory read 436.64%", () => {
    const value: number = drawn({
      queryConfig: query({
        metricName: "container.memory.percent",
        legendUnit: "%",
      }),
      stored: 4.3664,
      catalogUnit: "1",
    });

    expect(ValueFormatter.formatValue(value, "%")).toBe("436.64%");
  });
});

describe("queries without a transform convert as they always did", () => {
  test("a 0-1 ratio declared '1' charted in '%' is times 100", () => {
    expect(
      drawn({
        queryConfig: query({
          metricName: "system.cpu.utilization",
          legendUnit: "%",
        }),
        stored: 0.25,
        catalogUnit: "1",
      }),
    ).toBeCloseTo(25, 10);
  });

  test("bytes charted in GB are divided", () => {
    expect(
      drawn({
        queryConfig: query({
          metricName: "container.memory.usage.total",
          legendUnit: "GB",
        }),
        stored: 2_000_000_000,
        catalogUnit: "bytes",
      }),
    ).toBeCloseTo(2, 10);
  });
});
