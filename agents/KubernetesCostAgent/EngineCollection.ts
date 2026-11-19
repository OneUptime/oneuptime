import { CostEngineClient } from "./CostEngineClient";
import { kubecostClusterStatus } from "./EnginePricing";

/*
 * WHETHER A KUBECOST HAS COLLECTED A CLOSED HOUR YET.
 *
 * Kubecost 2 and 3 answer the Allocation API from their aggregator, which
 * takes in what the cost model or the finops agent collected in batches. On
 * kind, two minutes after 17:00 (ENGINE_SETTLE_SECONDS), Kubecost 2.8.7 had
 * 16:00-16:20 of the hour that had just closed and Kubecost 3.3.2 16:00-16:15,
 * and the agent ships each hour once. So the poller ships a window only once
 * its rows reach its end (CostEngineResolver.isWindowComplete, by each row's
 * own end), and reads it again at a later tick until then.
 *
 * A window with no rows says nothing that way. Each Kubecost also says how
 * far it has collected each cluster, as lastCollectedTime in
 * /model/clusters/status (its UI's cluster diagnostics), and an empty hour
 * it has not collected yet waits too.
 *
 * OpenCost and Kubecost's cost model work an allocation out from their
 * Prometheus when asked, so an hour is whole once it has closed.
 */

// How Kubecost is asked about its clusters: yesterday and today.
const STATUS_WINDOW: string = "2d";

/*
 * How far a Kubecost has collected this cluster: lastCollectedTime of its
 * entry in /model/clusters/status, or null when it does not say (an older
 * Kubecost, a cluster it has not collected yet, several clusters and none
 * named this one).
 */
export const kubecostCollectedThrough: (
  clusters: unknown,
  clusterId: string,
) => Date | null = (clusters: unknown, clusterId: string): Date | null => {
  const cluster: Record<string, unknown> | null = kubecostClusterStatus(
    clusters,
    clusterId,
  );
  const value: unknown = cluster ? cluster["lastCollectedTime"] : undefined;

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const time: number = Date.parse(value);

  // Go's zero time ("0001-01-01T00:00:00Z") is no answer either.
  return Number.isFinite(time) && time > 0 ? new Date(time) : null;
};

// Ask the Kubecost; never throws.
export const readKubecostCollectedThrough: (data: {
  client: CostEngineClient;
  clusterId: string;
}) => Promise<Date | null> = async (data: {
  client: CostEngineClient;
  clusterId: string;
}): Promise<Date | null> => {
  const clusters: unknown = await data.client.fetchApiData("clusters/status", {
    window: STATUS_WINDOW,
  });

  return kubecostCollectedThrough(clusters, data.clusterId);
};
