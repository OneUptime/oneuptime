import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ObjectID from "../../../Types/ObjectID";
import MetricService from "../../Services/MetricService";
import logger from "../Logger";

/*
 * THE PODS OF A CLUSTER THAT HAVE FINISHED, so their containers' requests
 * stop counting against a node.
 *
 * The k8s_cluster receiver reports `k8s.container.cpu_request` and
 * `k8s.container.memory_request` for every container of every pod the API
 * still holds, whatever the pod's phase. A Job's or CronJob's pod that ran to
 * completion keeps its requests in that data until the pod object is
 * deleted, but the scheduler counts only pods that are not Succeeded or
 * Failed. So a node that had run a few Jobs read as committed past 90%, and
 * "High Node CPU/Memory Request Commitment" fired on capacity it had.
 *
 * `k8s.pod.phase` carries the phase in its value (Pending 1, Running 2,
 * Succeeded 3, Failed 4, Unknown 5) on the pod's resource, and the
 * container metrics carry the same `k8s.pod.uid`. A pod that reads 3 or 4 at
 * any time in the window has finished: a phase never goes back, and a Job's
 * retry is a new pod with a new uid. Unknown is not finished: the node lost
 * touch with the pod, and the scheduler still counts it.
 */

export const POD_UID_ATTRIBUTE: string = "resource.k8s.pod.uid";

const POD_PHASE_METRIC: string = "k8s.pod.phase";
const POD_PHASE_SUCCEEDED: number = 3;
const POD_PHASE_FAILED: number = 4;

// The request metrics a finished pod no longer holds.
const FINISHED_POD_SCOPED_METRICS: ReadonlySet<string> = new Set<string>([
  "k8s.container.cpu_request",
  "k8s.container.memory_request",
]);

/*
 * At most this many pods are left out of one read: their uids go into the
 * query as one NOT IN list. Finished Job pods are normally cleaned up (a
 * CronJob keeps three by default), so a cluster with more than this many
 * loses only some of them from its count, and the read never fails on it.
 */
export const MAX_FINISHED_PODS: number = 5000;

export default class KubernetesFinishedPods {
  // Whether a query of this metric leaves finished pods out.
  public static isScopedMetric(metricName: string | undefined): boolean {
    return FINISHED_POD_SCOPED_METRICS.has(
      (metricName || "").trim().toLowerCase(),
    );
  }

  /*
   * The uids of the cluster's pods that are Succeeded or Failed in the
   * window. Empty when none are, when the cluster reports no pod phases (an
   * older agent), or when the read fails: the requests are then counted as
   * before, rather than the check failing.
   */
  public static async readFinishedPodUids(data: {
    projectId: ObjectID;
    clusterIdentifier: string;
    namespace?: string | undefined;
    startAndEndDate: InBetween<Date>;
  }): Promise<Array<string>> {
    const clusterIdentifier: string = (data.clusterIdentifier || "").trim();

    if (!clusterIdentifier) {
      return [];
    }

    const attributes: Record<string, string> = {
      "resource.k8s.cluster.name": clusterIdentifier,
    };

    if (data.namespace) {
      attributes["resource.k8s.namespace.name"] = data.namespace;
    }

    try {
      const result: AggregatedResult = await MetricService.aggregateBy({
        query: {
          projectId: data.projectId,
          name: POD_PHASE_METRIC,
          time: data.startAndEndDate,
          value: new InBetween<number>(POD_PHASE_SUCCEEDED, POD_PHASE_FAILED),
          attributes: attributes,
        } as never,
        aggregationType: AggregationType.Max,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        aggregationInterval: AggregationInterval.Total,
        startTimestamp: data.startAndEndDate.startValue as Date,
        endTimestamp: data.startAndEndDate.endValue as Date,
        groupByAttributeKeys: [POD_UID_ATTRIBUTE],
        limit: MAX_FINISHED_PODS,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      return KubernetesFinishedPods.readUids(result);
    } catch (err) {
      logger.warn(
        `KubernetesFinishedPods: could not read the finished pods of cluster ${clusterIdentifier}, so their requests are counted: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  // The distinct pod uids of a read grouped by POD_UID_ATTRIBUTE.
  public static readUids(result: AggregatedResult): Array<string> {
    const uids: Set<string> = new Set<string>();

    for (const row of result.data || []) {
      const attributes: unknown = (row as AggregatedModel)["attributes"];

      if (!attributes || typeof attributes !== "object") {
        continue;
      }

      const uid: unknown = (attributes as Record<string, unknown>)[
        POD_UID_ATTRIBUTE
      ];

      if (typeof uid === "string" && uid.trim()) {
        uids.add(uid.trim());
      }

      if (uids.size >= MAX_FINISHED_PODS) {
        break;
      }
    }

    return Array.from(uids);
  }
}
