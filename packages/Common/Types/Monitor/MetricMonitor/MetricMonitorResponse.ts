import AggregatedResult from "../../BaseDatabase/AggregatedResult";
import InBetween from "../../BaseDatabase/InBetween";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";
import MetricsViewConfig from "../../Metrics/MetricsViewConfig";
import ObjectID from "../../ObjectID";
import Dictionary from "../../Dictionary";
import MetricSeriesResult from "./MetricSeriesResult";

/**
 * Where a platform resource breakdown came from.
 *
 * The worker scans raw datapoints once PER QUERY to name the resources
 * behind a breach. A monitor step can have several queries — every ratio
 * template has two (used ÷ allocatable, used ÷ total) and a formula over
 * them — and the breakdown used to be a single field that each query's
 * scan overwrote, so the LAST query won. For "High Node Memory
 * Utilization" that is the denominator, k8s.node.allocatable_memory: the
 * email listed every node's allocatable bytes under a "> 85%" criteria.
 *
 * Tagging each scan with its query lets the evaluator use the one scan
 * that measured what the matched criteria actually compared, and refuse
 * to borrow a sibling query's numbers when the criteria targets a formula.
 */
export interface PlatformResourceBreakdownSource {
  /**
   * `metricAliasData.metricVariable` of the query this scan was taken for
   * (e.g. "used_mem"). Absent on breakdowns built before it existed.
   */
  metricAlias?: string | undefined;
  /**
   * The unit the scanned values are in: the platform catalog's unit when
   * the catalog knows the metric, otherwise the unit the OpenTelemetry
   * exporter declared for it (MetricType.unit, e.g. "By"). The raw scan
   * never goes through MetricResultUnitConverter, so this is the metric's
   * NATIVE unit, never a legendUnit. Absent when neither is known.
   */
  metricUnit?: string | undefined;
}

export interface KubernetesAffectedResource {
  podName?: string | undefined;
  namespace?: string | undefined;
  nodeName?: string | undefined;
  containerName?: string | undefined;
  workloadType?: string | undefined;
  workloadName?: string | undefined;
  /** Highest sample seen for this resource in the monitoring window. */
  metricValue: number;
  /**
   * Lowest sample seen for this resource in the monitoring window. A
   * criteria that fires when the metric FALLS (node Ready = 0, etcd has
   * leader = 0) breached on this value, not on `metricValue`: a node that
   * was NotReady for one scrape and Ready for the rest has a highest of 1.
   * Absent on breakdowns built before this field existed.
   */
  lowestMetricValue?: number | undefined;
}

export interface KubernetesResourceBreakdown
  extends PlatformResourceBreakdownSource {
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
  /**
   * Lowest sample seen for this resource in the monitoring window — what a
   * criteria that fires when the metric FALLS breached on. See
   * KubernetesAffectedResource.lowestMetricValue.
   */
  lowestMetricValue?: number | undefined;
}

export interface ProxmoxResourceBreakdown
  extends PlatformResourceBreakdownSource {
  clusterName: string;
  metricName: string;
  metricFriendlyName: string;
  affectedResources: Array<ProxmoxAffectedResource>;
  attributes: Dictionary<string>;
}

/**
 * One vSphere object in a VMware monitor's per-series breakdown. Every
 * field except `metricValue` is an OTel RESOURCE attribute the vcenter
 * receiver stamps (stored `resource.`-prefixed in ClickHouse); which ones
 * are present depends on the object kind the series describes.
 */
export interface VMwareAffectedResource {
  /** `resource.vcenter.datacenter.name` — present on every series. */
  datacenterName?: string | undefined;
  /** `resource.vcenter.cluster.name` — only when the object is inside a cluster. */
  clusterName?: string | undefined;
  /** `resource.vcenter.host.name` — the ESXi host, or a VM's parent host. */
  hostName?: string | undefined;
  /** `resource.vcenter.vm.name` — virtual machine series only. */
  vmName?: string | undefined;
  /** `resource.vcenter.vm.id` — the VM's instance UUID (VM series only). */
  vmId?: string | undefined;
  /** `resource.vcenter.datastore.name` — datastore series only. */
  datastoreName?: string | undefined;
  /** `resource.vcenter.resource_pool.name` — resource pool (and pooled VM) series. */
  resourcePoolName?: string | undefined;
  /** `resource.vcenter.resource_pool.inventory_path` — the pool's unique path. */
  resourcePoolPath?: string | undefined;
  metricValue: number;
  /**
   * Lowest sample seen for this resource in the monitoring window — what a
   * criteria that fires when the metric FALLS breached on. See
   * KubernetesAffectedResource.lowestMetricValue.
   */
  lowestMetricValue?: number | undefined;
}

export interface VMwareResourceBreakdown
  extends PlatformResourceBreakdownSource {
  /** The `vmware.vcenter.name` the agent stamps — one per vCenter. */
  vcenterName: string;
  metricName: string;
  metricFriendlyName: string;
  affectedResources: Array<VMwareAffectedResource>;
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
  /**
   * Lowest sample seen for this resource in the monitoring window — what a
   * criteria that fires when the metric FALLS breached on. See
   * KubernetesAffectedResource.lowestMetricValue.
   */
  lowestMetricValue?: number | undefined;
}

export interface CephResourceBreakdown
  extends PlatformResourceBreakdownSource {
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
  /**
   * Lowest sample seen for this resource in the monitoring window — what a
   * criteria that fires when the metric FALLS breached on. See
   * KubernetesAffectedResource.lowestMetricValue.
   */
  lowestMetricValue?: number | undefined;
}

export interface DockerSwarmResourceBreakdown
  extends PlatformResourceBreakdownSource {
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
  vmwareResourceBreakdown?: VMwareResourceBreakdown | undefined;
  cephResourceBreakdown?: CephResourceBreakdown | undefined;
  dockerSwarmResourceBreakdown?: DockerSwarmResourceBreakdown | undefined;
  /*
   * One breakdown per query whose raw scan returned rows, in query order,
   * each tagged with the query it was scanned for. These supersede the
   * singular fields above, which the worker no longer writes: a single
   * field could only ever hold one query's scan, and holding the last one
   * put the denominator of every ratio template into the email. The
   * evaluator still reads the singular field when the plural one is
   * absent, so a payload built before this change renders as it did.
   */
  kubernetesResourceBreakdowns?: Array<KubernetesResourceBreakdown> | undefined;
  proxmoxResourceBreakdowns?: Array<ProxmoxResourceBreakdown> | undefined;
  vmwareResourceBreakdowns?: Array<VMwareResourceBreakdown> | undefined;
  cephResourceBreakdowns?: Array<CephResourceBreakdown> | undefined;
  dockerSwarmResourceBreakdowns?:
    | Array<DockerSwarmResourceBreakdown>
    | undefined;
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
   * The unit each referenced metric's stored values are in, keyed by
   * lowercased metric name. Loaded once when the monitor data is fetched.
   * The criteria evaluator falls back to this when the query alias has no
   * explicit `legendUnit`, so threshold unit conversion (e.g. % vs the
   * dimensionless "1" used by ratio metrics) still works and the numbers
   * in the notification carry a unit.
   *
   * For a generic Metrics monitor this is the OpenTelemetry-declared unit
   * (MetricType.unit). For a platform monitor (Kubernetes, Docker, Host,
   * Proxmox, ...) the platform's metric catalog wins over it — see
   * PlatformMetricUnitUtil — because some receivers declare a unit that
   * does not describe the values they send (docker_stats reports
   * container.cpu.utilization as 0–100 under the unit "1").
   */
  nativeUnitsByMetricName?: Dictionary<string> | undefined;
}
