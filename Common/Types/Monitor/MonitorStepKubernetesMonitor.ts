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
  workloadType?: string | undefined; // deployment, statefulset, daemonset, job, cronjob
  workloadName?: string | undefined;
  nodeName?: string | undefined;
  podName?: string | undefined;
}

export default interface MonitorStepKubernetesMonitor {
  clusterIdentifier: string;
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

  public static fromJSON(json: JSONObject): MonitorStepKubernetesMonitor {
    return json as any as MonitorStepKubernetesMonitor;
  }

  public static toJSON(monitor: MonitorStepKubernetesMonitor): JSONObject {
    return monitor as any as JSONObject;
  }
}
