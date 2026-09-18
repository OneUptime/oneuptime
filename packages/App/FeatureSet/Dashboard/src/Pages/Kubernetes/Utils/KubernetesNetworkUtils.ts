import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { computeCounterRate } from "../../../Utils/CounterRateUtils";

/*
 * kubeletstats ships node network IO as a single cumulative
 * `k8s.node.network.io` counter with a `direction` attribute
 * (receive | transmit) per (node, interface). The split-name
 * `.receive` / `.transmit` variants do not exist in the schema.
 */
export const NETWORK_IO_METRIC_NAME: string = "k8s.node.network.io";

export type NetworkDirection = "receive" | "transmit";

export interface NetworkThroughputPoint {
  x: Date;
  y: number;
}

export interface NetworkThroughputSeries {
  receive: Array<NetworkThroughputPoint>;
  transmit: Array<NetworkThroughputPoint>;
}

export interface FetchNetworkThroughputParams {
  clusterIdentifier: string;
  nodeName?: string | undefined;
  startDate: Date;
  endDate: Date;
}

/*
 * Convert the cumulative `k8s.node.network.io` counter into a
 * per-second rate: delta consecutive buckets per (node, interface)
 * series, clamp counter resets to 0, and sum rates across all
 * (node, interface) series per bucket for the requested direction.
 * The counter math lives in the shared CounterRateUtils (also used by
 * the Proxmox / Ceph pages); only the (node, interface, direction)
 * series identity is Kubernetes-specific.
 */
export const computeNetworkRate: (
  result: AggregatedResult,
  direction: NetworkDirection,
) => Array<NetworkThroughputPoint> = (
  result: AggregatedResult,
  direction: NetworkDirection,
): Array<NetworkThroughputPoint> => {
  return computeCounterRate(result, {
    getSeriesKey: (attrs: Record<string, unknown>): string | null => {
      const pointDirection: string = (attrs["direction"] as string) || "";
      if (pointDirection !== direction) {
        return null;
      }
      const node: string = (attrs["resource.k8s.node.name"] as string) || "";
      if (!node) {
        return null;
      }
      const interfaceName: string =
        (attrs["interface"] as string) ||
        (attrs["network.interface"] as string) ||
        "";
      return `${node}|${interfaceName}`;
    },
  });
};

/*
 * Fetch the cumulative network counter for a cluster (optionally a
 * single node) and return per-second receive/transmit rate series.
 * Both directions come back in one query and are split client-side,
 * mirroring the cluster overview tab.
 */
export const fetchNetworkThroughput: (
  params: FetchNetworkThroughputParams,
) => Promise<NetworkThroughputSeries> = async (
  params: FetchNetworkThroughputParams,
): Promise<NetworkThroughputSeries> => {
  const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

  const attributes: Record<string, string> = {
    "resource.k8s.cluster.name": params.clusterIdentifier,
  };
  if (params.nodeName) {
    attributes["resource.k8s.node.name"] = params.nodeName;
  }

  const aggregateBy: AggregateBy<Metric> = {
    query: {
      projectId: projectId,
      time: new InBetween<Date>(params.startDate, params.endDate),
      name: NETWORK_IO_METRIC_NAME,
      attributes: attributes,
    } as AggregateBy<Metric>["query"],
    aggregationType: AggregationType.Max,
    aggregateColumnName: "value",
    aggregationTimestampColumnName: "time",
    startTimestamp: params.startDate,
    endTimestamp: params.endDate,
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    sort: {
      time: SortOrder.Descending,
    },
  };
  aggregateBy.groupBy = { attributes: true };

  const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Metric>({
    modelType: Metric,
    aggregateBy: aggregateBy,
  });

  return {
    receive: computeNetworkRate(result, "receive"),
    transmit: computeNetworkRate(result, "transmit"),
  };
};

export default {
  NETWORK_IO_METRIC_NAME,
  computeNetworkRate,
  fetchNetworkThroughput,
};
