import AggregatedResult from "../../BaseDatabase/AggregatedResult";
import InBetween from "../../BaseDatabase/InBetween";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";
import MetricsViewConfig from "../../Metrics/MetricsViewConfig";
import ObjectID from "../../ObjectID";
import Dictionary from "../../Dictionary";
import MetricSeriesResult from "./MetricSeriesResult";

export interface KubernetesAffectedResource {
  podName?: string | undefined;
  namespace?: string | undefined;
  nodeName?: string | undefined;
  containerName?: string | undefined;
  workloadType?: string | undefined;
  workloadName?: string | undefined;
  metricValue: number;
}

export interface KubernetesResourceBreakdown {
  clusterName: string;
  metricName: string;
  metricFriendlyName: string;
  affectedResources: Array<KubernetesAffectedResource>;
  attributes: Dictionary<string>;
}

export interface ProxmoxAffectedResource {
  /** Raw pve-exporter `id` datapoint label, e.g. "node/pve1", "qemu/100". */
  resourceId?: string | undefined;
  /** `name` label — present only on the pve_*_info metadata series. */
  resourceName?: string | undefined;
  /** Agent-stamped `pve.type` attribute (node | qemu | lxc | storage). */
  resourceType?: string | undefined;
  /** Agent-stamped `pve.scope` attribute (cluster | node | guest | storage). */
  scope?: string | undefined;
  /** `node` label — present only on the pve_*_info metadata series. */
  nodeName?: string | undefined;
  metricValue: number;
}

export interface ProxmoxResourceBreakdown {
  clusterName: string;
  metricName: string;
  metricFriendlyName: string;
  affectedResources: Array<ProxmoxAffectedResource>;
  attributes: Dictionary<string>;
}

export interface CephAffectedResource {
  /** `ceph_daemon` datapoint label, e.g. "osd.3", "mon.a". */
  daemon?: string | undefined;
  /** `pool_id` label — the only pool identity on pool data series. */
  poolId?: string | undefined;
  /** Pool `name` label — present only on ceph_pool_metadata. */
  poolName?: string | undefined;
  /** `hostname` label — present only on the *_metadata series. */
  hostname?: string | undefined;
  metricValue: number;
}

export interface CephResourceBreakdown {
  clusterName: string;
  metricName: string;
  metricFriendlyName: string;
  affectedResources: Array<CephAffectedResource>;
  attributes: Dictionary<string>;
}

export interface DockerSwarmAffectedResource {
  /** `container.name` datapoint label — a Swarm task's container is `<service>.<slot>.<taskid>`. */
  containerName?: string | undefined;
  /** `container.image.name` datapoint label, when present. */
  containerImage?: string | undefined;
  /** `docker.swarm.node.name` datapoint label, when the agent stamps it. */
  nodeName?: string | undefined;
  /** `docker.swarm.service.name` datapoint label, when the agent stamps it. */
  serviceName?: string | undefined;
  metricValue: number;
}

export interface DockerSwarmResourceBreakdown {
  clusterName: string;
  metricName: string;
  metricFriendlyName: string;
  affectedResources: Array<DockerSwarmAffectedResource>;
  attributes: Dictionary<string>;
}

export default interface MetricMonitorResponse {
  projectId: ObjectID;
  startAndEndDate?: InBetween<Date>;
  metricResult: Array<AggregatedResult>;
  metricViewConfig: MetricsViewConfig;
  monitorId: ObjectID;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
  kubernetesResourceBreakdown?: KubernetesResourceBreakdown | undefined;
  proxmoxResourceBreakdown?: ProxmoxResourceBreakdown | undefined;
  cephResourceBreakdown?: CephResourceBreakdown | undefined;
  dockerSwarmResourceBreakdown?: DockerSwarmResourceBreakdown | undefined;
  /**
   * Per-series breakdown when any queryConfig sets groupByAttributeKeys.
   * Each entry carries a fingerprint, the label values identifying that
   * series, and the aggregated-per-query results scoped to that series
   * (including per-series formula results). Absent for traditional
   * whole-monitor evaluation, in which case criteria evaluate against
   * `metricResult` as before.
   */
  seriesBreakdown?: Array<MetricSeriesResult> | undefined;
  /**
   * Native units (UCUM / OTel) per referenced metric name, lowercased.
   * Loaded once when the monitor data is fetched. The criteria
   * evaluator falls back to this when the query alias has no explicit
   * `legendUnit` so threshold unit conversion (e.g. % vs the
   * dimensionless "1" used by ratio metrics) still works.
   */
  nativeUnitsByMetricName?: Dictionary<string> | undefined;
}
