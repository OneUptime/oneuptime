import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";

export enum KubernetesResourceScope {
  Cluster = "Cluster",
  Namespace = "Namespace",
  Workload = "Workload",
  Node = "Node",
  Pod = "Pod",
}

export interface KubernetesResourceFilters {
  namespace?: string | undefined;
  workloadType?: string | undefined; // deployment, statefulset, daemonset, replicaset, job, cronjob
  workloadName?: string | undefined;
  nodeName?: string | undefined;
  podName?: string | undefined;
}

/*
 * The kinds of workload a Workload Name filter can name, by the word the
 * metrics carry them under: a pod of a StatefulSet carries
 * `k8s.statefulset.name`, of a Deployment `k8s.deployment.name`.
 */
export type KubernetesWorkloadKind =
  | "deployment"
  | "statefulset"
  | "daemonset"
  | "replicaset"
  | "job"
  | "cronjob";

export const KUBERNETES_WORKLOAD_KINDS: ReadonlyArray<{
  label: string;
  value: KubernetesWorkloadKind;
}> = [
  { label: "Deployment", value: "deployment" },
  { label: "StatefulSet", value: "statefulset" },
  { label: "DaemonSet", value: "daemonset" },
  { label: "ReplicaSet", value: "replicaset" },
  { label: "Job", value: "job" },
  { label: "CronJob", value: "cronjob" },
];

// The kind a Workload Name is read as when the step names none.
export const DEFAULT_KUBERNETES_WORKLOAD_KIND: string = "deployment";

export default interface MonitorStepKubernetesMonitor {
  clusterIdentifier: string;
  /*
   * The resource's id. Bound on every write and read by the worker, so a
   * rename keeps the monitor on its resource (InfrastructureResourceBinding).
   */
  resourceId?: string | undefined;
  resourceScope: KubernetesResourceScope;
  resourceFilters: KubernetesResourceFilters;
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
}

export class MonitorStepKubernetesMonitorUtil {
  public static getDefault(): MonitorStepKubernetesMonitor {
    return {
      clusterIdentifier: "",
      resourceScope: KubernetesResourceScope.Cluster,
      resourceFilters: {},
      metricViewConfig: {
        queryConfigs: [],
        formulaConfigs: [],
      },
      rollingTime: RollingTime.Past1Minute,
    };
  }

  /*
   * The resource attribute a Workload Name filter matches, or null when
   * the step names no workload.
   *
   * The form asked only for the name and never set the kind, and the
   * worker applied the filter only when both were set - so a monitor
   * scoped to one workload watched every workload in the cluster. A name
   * without a kind is read as a Deployment's, the kind the form now starts
   * on.
   */
  public static getWorkloadNameAttributeKey(
    resourceFilters: KubernetesResourceFilters | undefined,
  ): string | null {
    const workloadName: string = (resourceFilters?.workloadName || "").trim();

    if (!workloadName) {
      return null;
    }

    // Letters only: the kind becomes part of an attribute key.
    const kind: string = (resourceFilters?.workloadType || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, "");

    return `resource.k8s.${kind || DEFAULT_KUBERNETES_WORKLOAD_KIND}.name`;
  }

  public static fromJSON(json: JSONObject): MonitorStepKubernetesMonitor {
    return json as any as MonitorStepKubernetesMonitor;
  }

  public static toJSON(monitor: MonitorStepKubernetesMonitor): JSONObject {
    return monitor as any as JSONObject;
  }
}
