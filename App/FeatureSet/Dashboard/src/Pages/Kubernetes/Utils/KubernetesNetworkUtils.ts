import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";

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

type CounterSample = {
  t: number;
  v: number;
};

const getBucketTimestamp: (p: AggregatedModel) => number = (
  p: AggregatedModel,
): number => {
  const raw: unknown =
    p["timestamp"] !== undefined ? p["timestamp"] : p["time"];
  if (raw instanceof Date) {
    return raw.getTime();
  }
  if (typeof raw === "string" || typeof raw === "number") {
    return new Date(raw).getTime();
  }
  return NaN;
};

/*
 * Convert the cumulative `k8s.node.network.io` counter into a
 * per-second rate: delta consecutive buckets per (node, interface)
 * series, clamp counter resets to 0, and sum rates across all
 * (node, interface) series per bucket for the requested direction.
 */
export const computeNetworkRate: (
  result: AggregatedResult,
  direction: NetworkDirection,
) => Array<NetworkThroughputPoint> = (
  result: AggregatedResult,
  direction: NetworkDirection,
): Array<NetworkThroughputPoint> => {
  const perKey: Map<string, Array<CounterSample>> = new Map();
  for (const p of (result.data || []) as Array<AggregatedModel>) {
    const attrs: Record<string, unknown> =
      (p["attributes"] as Record<string, unknown>) || {};
    const pointDirection: string = (attrs["direction"] as string) || "";
    if (pointDirection !== direction) {
      continue;
    }
    const node: string = (attrs["resource.k8s.node.name"] as string) || "";
    const interfaceName: string =
      (attrs["interface"] as string) ||
      (attrs["network.interface"] as string) ||
      "";
    if (!node) {
      continue;
    }
    const key: string = `${node}|${interfaceName}`;
    const t: number = getBucketTimestamp(p);
    const v: number = Number(p["value"]);
    if (!Number.isFinite(t) || !Number.isFinite(v)) {
      continue;
    }
    let arr: Array<CounterSample> | undefined = perKey.get(key);
    if (!arr) {
      arr = [];
      perKey.set(key, arr);
    }
    arr.push({ t, v });
  }

  const perBucket: Map<number, number> = new Map();
  for (const arr of perKey.values()) {
    arr.sort((a: CounterSample, b: CounterSample): number => {
      return a.t - b.t;
    });
    for (let i: number = 1; i < arr.length; i++) {
      const prev: CounterSample = arr[i - 1]!;
      const cur: CounterSample = arr[i]!;
      const dtSec: number = (cur.t - prev.t) / 1000;
      if (dtSec <= 0) {
        continue;
      }
      const dv: number = cur.v - prev.v;
      if (!Number.isFinite(dv)) {
        continue;
      }
      const rate: number = Math.max(0, dv) / dtSec;
      perBucket.set(cur.t, (perBucket.get(cur.t) || 0) + rate);
    }
  }

  return Array.from(perBucket.entries())
    .map(([t, y]: [number, number]): NetworkThroughputPoint => {
      return { x: new Date(t), y: y };
    })
    .sort((a: NetworkThroughputPoint, b: NetworkThroughputPoint): number => {
      return a.x.getTime() - b.x.getTime();
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
