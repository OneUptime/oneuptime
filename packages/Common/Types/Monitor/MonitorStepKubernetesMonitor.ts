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
  workloadType?: string | undefined; // deployment, statefulset, daemonset, replicaset, job, cronjob, hpa
  workloadName?: string | undefined;
  nodeName?: string | undefined;
  podName?: string | undefined;
}

/*
 * The kinds a Workload Name filter can name, by the word the metrics carry
 * them under: a pod of a StatefulSet carries `k8s.statefulset.name`, of a
 * Deployment `k8s.deployment.name`, and an HPA's own metrics carry
 * `k8s.hpa.name`.
 */
export type KubernetesWorkloadKind =
  | "deployment"
  | "statefulset"
  | "daemonset"
  | "replicaset"
  | "job"
  | "cronjob"
  | "hpa";

/*
 * The kinds of workload a pod belongs to. The agent gives a container's and
 * a pod's metrics their names, so a Workload scope of one of these kinds
 * also watches the workload's containers and pods.
 */
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

/*
 * A HorizontalPodAutoscaler, named by its own name. No pod belongs to an
 * HPA, so only the HPA's own metrics (`k8s.hpa.*`) carry its name: the
 * k8s_cluster receiver gives them `k8s.hpa.name`, `k8s.hpa.uid` and
 * `k8s.namespace.name`. They do not name what the HPA scales: the
 * receiver's `k8s.hpa.scaletargetref.*` attributes are off by default (the
 * agent leaves them off) and collectors before 0.127.0 have none.
 */
export const KUBERNETES_HPA_KIND: {
  label: string;
  value: KubernetesWorkloadKind;
} = { label: "HorizontalPodAutoscaler", value: "hpa" };

// Every kind the Workload scope's Workload Kind offers: the workloads, then HPA.
export const KUBERNETES_WORKLOAD_SCOPE_KINDS: ReadonlyArray<{
  label: string;
  value: KubernetesWorkloadKind;
}> = [...KUBERNETES_WORKLOAD_KINDS, KUBERNETES_HPA_KIND];

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
