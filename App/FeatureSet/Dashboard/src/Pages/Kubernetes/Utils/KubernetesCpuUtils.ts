import Metric from "Common/Models/AnalyticsModels/Metric";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";

/**
 * Single source of truth for "Kubernetes CPU as a real percentage".
 *
 * The kubeletstats receiver emits `k8s.node.cpu.utilization`,
 * `k8s.pod.cpu.utilization` and `container.cpu.utilization` as CPU
 * *cores in use* (UsageNanoCores / 1e9) — NOT a [0, 1] ratio, despite
 * the misleading `.utilization` name and unit "1". Multiplying those
 * cores by 100 is what produced nonsense like "711%" over six nodes.
 *
 * A true utilization percentage needs a denominator: the node's
 * allocatable CPU (cores). The `k8s_cluster` receiver already emits
 * that as `k8s.node.allocatable_cpu` (enabled via
 * `allocatable_types_to_report`). So everywhere in the K8s UI:
 *
 *     CPU% = cores_in_use / allocatable_cores * 100
 *
 * For pods/containers the denominator is the allocatable CPU of the
 * node the workload runs on (`resource.k8s.node.name` on the metric).
 */

export const NODE_ALLOCATABLE_CPU_METRIC: string = "k8s.node.allocatable_cpu";

export const NODE_NAME_ATTRIBUTE: string = "resource.k8s.node.name";

export interface NodeAllocatableCpu {
  // nodeName -> allocatable cores
  perNode: Map<string, number>;
  // Sum of allocatable cores across every node in the cluster.
  clusterTotalCores: number;
  // Mean allocatable cores per node — used as the fallback denominator
  // when a datapoint's node is unknown or missing from `perNode`.
  avgNodeCores: number;
  // Resolve the denominator (cores) for a given node, falling back to
  // the cluster's average node size when the node is unknown.
  denominatorForNode: (nodeName?: string | undefined) => number;
}

export default class KubernetesCpuUtils {
  /**
   * Parse a Kubernetes CPU quantity string into cores.
   *   "4"           -> 4
   *   "500m"        -> 0.5     (milli)
   *   "250000u"     -> 0.25    (micro)
   *   "1500000000n" -> 1.5     (nano)
   * A bare number (already cores) passes through. Unknown/garbage
   * yields 0 so callers can treat it as "no denominator".
   */
  public static parseCpuToCores(
    quantity: string | number | null | undefined,
  ): number {
    if (quantity === null || quantity === undefined) {
      return 0;
    }
    if (typeof quantity === "number") {
      return Number.isFinite(quantity) ? quantity : 0;
    }
    const trimmed: string = quantity.trim();
    if (trimmed === "") {
      return 0;
    }
    const match: RegExpMatchArray | null = trimmed.match(
      /^([0-9]*\.?[0-9]+)\s*([a-zA-Z]*)$/,
    );
    if (!match) {
      const direct: number = Number(trimmed);
      return Number.isFinite(direct) ? direct : 0;
    }
    const num: number = Number(match[1]);
    if (!Number.isFinite(num)) {
      return 0;
    }
    switch (match[2] || "") {
      case "n":
        return num / 1e9;
      case "u":
        return num / 1e6;
      case "m":
        return num / 1e3;
      case "k":
        return num * 1e3;
      default:
        // No suffix (or an unrecognized one) — already in cores.
        return num;
    }
  }

  /**
   * Build a NodeAllocatableCpu lookup from a per-node cores map.
   */
  public static buildAllocatable(
    perNode: Map<string, number>,
  ): NodeAllocatableCpu {
    let total: number = 0;
    for (const cores of perNode.values()) {
      total += cores;
    }
    const avg: number = perNode.size > 0 ? total / perNode.size : 0;

    return {
      perNode: perNode,
      clusterTotalCores: total,
      avgNodeCores: avg,
      denominatorForNode: (nodeName?: string | undefined): number => {
        if (nodeName) {
          const cores: number | undefined = perNode.get(nodeName);
          if (cores !== undefined && cores > 0) {
            return cores;
          }
        }
        // Fall back to the average node size so a pod whose node we
        // can't resolve still produces a sensible percentage rather
        // than 0 or Infinity.
        return avg;
      },
    };
  }

  /**
   * Fetch the latest allocatable CPU (cores) per node for a cluster
   * from the `k8s.node.allocatable_cpu` metric. Returns an empty
   * lookup (denominators resolve to 0) on failure or when the metric
   * isn't flowing — callers must guard divide-by-zero.
   */
  public static async fetchNodeAllocatableCpu(options: {
    clusterIdentifier: string;
    startDate: Date;
    endDate: Date;
  }): Promise<NodeAllocatableCpu> {
    const perNode: Map<string, number> = new Map();

    try {
      const result: AggregatedResult = await AnalyticsModelAPI.aggregate({
        modelType: Metric,
        aggregateBy: {
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            time: new InBetween(options.startDate, options.endDate),
            name: NODE_ALLOCATABLE_CPU_METRIC,
            attributes: {
              "resource.k8s.cluster.name": options.clusterIdentifier,
            } as Dictionary<string | number | boolean>,
          },
          // Allocatable is effectively constant over the window; Max
          // collapses each node's samples to its allocatable cores.
          aggregationType: MetricsAggregationType.Max,
          aggregateColumnName: "value",
          aggregationTimestampColumnName: "time",
          startTimestamp: options.startDate,
          endTimestamp: options.endDate,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          groupBy: {
            attributes: true,
          },
        },
      });

      for (const dataPoint of result.data as Array<AggregatedModel>) {
        const attributes: Record<string, unknown> =
          (dataPoint["attributes"] as Record<string, unknown>) || {};
        const nodeName: string =
          (attributes[NODE_NAME_ATTRIBUTE] as string) || "";
        if (!nodeName) {
          continue;
        }
        const cores: number = Number(dataPoint["value"]);
        if (!Number.isFinite(cores) || cores <= 0) {
          continue;
        }
        const existing: number | undefined = perNode.get(nodeName);
        if (existing === undefined || cores > existing) {
          perNode.set(nodeName, cores);
        }
      }
    } catch {
      // Allocatable is the denominator; on failure return an empty
      // lookup and let callers render "no data" rather than a wrong
      // number.
    }

    return KubernetesCpuUtils.buildAllocatable(perNode);
  }

  /**
   * Build a per-datapoint transform that converts a raw CPU *cores*
   * value into "% of its node's allocatable CPU". The datapoint's node
   * is read from `resource.k8s.node.name`; unknown nodes fall back to
   * the cluster's average node size. Designed to be passed as
   * `transformValue` on a MetricQueryConfigData CPU query.
   */
  public static makeCpuPercentTransform(
    allocatable: NodeAllocatableCpu,
  ): (value: number, dataPoint: AggregatedModel) => number {
    return (value: number, dataPoint: AggregatedModel): number => {
      const attributes: Record<string, unknown> =
        ((dataPoint as unknown as Record<string, unknown>)[
          "attributes"
        ] as Record<string, unknown>) || {};
      const nodeName: string =
        (attributes[NODE_NAME_ATTRIBUTE] as string) || "";
      const denominator: number = allocatable.denominatorForNode(nodeName);
      if (!denominator || denominator <= 0) {
        // No allocatable data at all for this cluster — fall back to
        // the raw cores value rather than collapsing the chart to zero.
        return value;
      }
      return (value / denominator) * 100;
    };
  }

  /**
   * Build a transform that divides by a fixed scalar allocatable
   * (cores) — for single-node contexts (e.g. the Node detail page)
   * where every datapoint belongs to the same node and we already
   * know its allocatable from the node object.
   */
  public static makeScalarCpuPercentTransform(
    allocatableCores: number,
  ): (value: number) => number {
    return (value: number): number => {
      if (!allocatableCores || allocatableCores <= 0) {
        // Allocatable unknown — fall back to raw cores rather than 0.
        return value;
      }
      return (value / allocatableCores) * 100;
    };
  }
}
