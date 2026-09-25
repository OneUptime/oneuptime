import fs from "fs";
import yaml from "js-yaml";
import path from "path";

/*
 * The metric names the kubernetes-agent chart's collectors actually send,
 * for tests that pin OneUptime's Kubernetes metric names to them.
 *
 * Nothing in the chart renames a metric (tests/metric-names_test.yaml
 * asserts that on the rendered collector configs), so what reaches ingest
 * is exactly what the upstream receivers emit. These lists are those
 * receivers' default-enabled metrics — plus the ones the chart's own
 * receiver config adds — copied from each receiver's metadata.yaml at
 * the collector version the chart pins:
 *
 *   https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.96.0/receiver/k8sclusterreceiver/metadata.yaml
 *   https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.96.0/receiver/kubeletstatsreceiver/metadata.yaml
 *
 * They go stale the moment the chart moves to another collector, which is
 * why AGENT_COLLECTOR_IMAGE_TAG is checked against values.yaml: bumping the
 * image fails the tests until someone re-reads those two files and updates
 * this one. Receivers do rename metrics between versions (the
 * semantic-conventions work moved several k8s.* names), so that re-read is
 * the point.
 */
export const AGENT_COLLECTOR_IMAGE_TAG: string = "0.96.0";

/*
 * k8s_cluster — the agent Deployment's receiver
 * (templates/configmap-deployment.yaml). Workload replica counts live here,
 * under the receiver's own names: `k8s.deployment.available`, not
 * `available_replicas`, and no "unavailable" series at all.
 */
export const K8S_CLUSTER_RECEIVER_METRICS: ReadonlyArray<string> = [
  "k8s.container.cpu_request",
  "k8s.container.cpu_limit",
  "k8s.container.memory_request",
  "k8s.container.memory_limit",
  "k8s.container.storage_request",
  "k8s.container.storage_limit",
  "k8s.container.ephemeralstorage_request",
  "k8s.container.ephemeralstorage_limit",
  "k8s.container.restarts",
  "k8s.container.ready",
  "k8s.pod.phase",
  "k8s.deployment.desired",
  "k8s.deployment.available",
  "k8s.cronjob.active_jobs",
  "k8s.daemonset.current_scheduled_nodes",
  "k8s.daemonset.desired_scheduled_nodes",
  "k8s.daemonset.misscheduled_nodes",
  "k8s.daemonset.ready_nodes",
  "k8s.hpa.max_replicas",
  "k8s.hpa.min_replicas",
  "k8s.hpa.current_replicas",
  "k8s.hpa.desired_replicas",
  "k8s.job.active_pods",
  "k8s.job.desired_successful_pods",
  "k8s.job.failed_pods",
  "k8s.job.max_parallel_pods",
  "k8s.job.successful_pods",
  "k8s.namespace.phase",
  "k8s.replicaset.desired",
  "k8s.replicaset.available",
  "k8s.replication_controller.desired",
  "k8s.replication_controller.available",
  "k8s.resource_quota.hard_limit",
  "k8s.resource_quota.used",
  "k8s.statefulset.desired_pods",
  "k8s.statefulset.ready_pods",
  "k8s.statefulset.current_pods",
  "k8s.statefulset.updated_pods",
  /*
   * Not in metadata.yaml: built as `k8s.node.condition_<snake_case>` and
   * `k8s.node.allocatable_<snake_case>` from the chart's
   * node_conditions_to_report and allocatable_types_to_report lists.
   */
  "k8s.node.condition_ready",
  "k8s.node.condition_memory_pressure",
  "k8s.node.condition_disk_pressure",
  "k8s.node.condition_pid_pressure",
  "k8s.node.condition_network_unavailable",
  "k8s.node.allocatable_cpu",
  "k8s.node.allocatable_memory",
  "k8s.node.allocatable_storage",
];

// kubeletstats — the agent DaemonSet's receiver (templates/configmap-daemonset.yaml).
export const KUBELETSTATS_RECEIVER_METRICS: ReadonlyArray<string> = [
  "k8s.node.cpu.utilization",
  "k8s.node.cpu.time",
  "k8s.node.memory.available",
  "k8s.node.memory.usage",
  "k8s.node.memory.rss",
  "k8s.node.memory.working_set",
  "k8s.node.memory.page_faults",
  "k8s.node.memory.major_page_faults",
  "k8s.node.filesystem.available",
  "k8s.node.filesystem.capacity",
  "k8s.node.filesystem.usage",
  "k8s.node.network.io",
  "k8s.node.network.errors",
  "k8s.pod.cpu.utilization",
  "k8s.pod.cpu.time",
  "k8s.pod.memory.available",
  "k8s.pod.memory.usage",
  "k8s.pod.memory.rss",
  "k8s.pod.memory.working_set",
  "k8s.pod.memory.page_faults",
  "k8s.pod.memory.major_page_faults",
  "k8s.pod.filesystem.available",
  "k8s.pod.filesystem.capacity",
  "k8s.pod.filesystem.usage",
  "k8s.pod.network.io",
  "k8s.pod.network.errors",
  "container.cpu.utilization",
  "container.cpu.time",
  "container.memory.available",
  "container.memory.usage",
  "container.memory.rss",
  "container.memory.working_set",
  "container.memory.page_faults",
  "container.memory.major_page_faults",
  "container.filesystem.available",
  "container.filesystem.capacity",
  "container.filesystem.usage",
  /*
   * Off upstream; the chart always turns them on, with no flag, because
   * k8s-high-cpu and the Kubernetes dashboard template read them. The
   * chart's tests/kubeletstats-cpu-usage_test.yaml pins that on the
   * rendered DaemonSet config.
   */
  "k8s.node.cpu.usage",
  "k8s.pod.cpu.usage",
  /*
   * Off upstream; the chart turns them on while
   * kubeletstats.utilizationMetrics.enabled, which values.yaml defaults to
   * true.
   */
  "k8s.container.cpu_limit_utilization",
  "k8s.container.cpu_request_utilization",
  "k8s.container.memory_limit_utilization",
  "k8s.container.memory_request_utilization",
  "k8s.pod.cpu_limit_utilization",
  "k8s.pod.cpu_request_utilization",
  "k8s.pod.memory_limit_utilization",
  "k8s.pod.memory_request_utilization",
];

/*
 * The control-plane Prometheus scrape — the agent Deployment's
 * `prometheus` receiver (templates/configmap-deployment.yaml), on when
 * `controlPlane.enabled` is set. The prometheus receiver keeps each
 * component's own metric name, so these are etcd's, kube-apiserver's and
 * kube-scheduler's names; only the ones OneUptime's catalog and control-
 * plane templates use are listed.
 */
export const CONTROL_PLANE_SCRAPE_METRICS: ReadonlyArray<string> = [
  "etcd_server_has_leader",
  "apiserver_current_inflight_requests",
  "scheduler_pending_pods",
];

const AGENT_CHART_VALUES_PATH: string = path.resolve(
  __dirname,
  "../../../../../../HelmChart/Public/kubernetes-agent/values.yaml",
);

// The chart's default values.yaml, parsed.
export function readAgentChartValues(): Record<string, any> {
  return yaml.load(fs.readFileSync(AGENT_CHART_VALUES_PATH, "utf8")) as Record<
    string,
    any
  >;
}

/*
 * The chart's Prometheus scrapes that carry an allowlist — cAdvisor on the
 * DaemonSet (on by default), kube-state-metrics and the cost engine on the
 * Deployment (opt-in). Each job's `metric_relabel_configs` keeps exactly
 * `^(<allowlist joined by |>)$`, and the prometheus receiver trims `_total`
 * and unit suffixes only under `trim_metric_suffixes`, which is off by
 * default and which the chart never sets. So the names that arrive are the
 * allowlist entries verbatim — read from values.yaml rather than copied,
 * so the two cannot drift.
 */
const agentChartValues: Record<string, any> = readAgentChartValues();

export const ALLOWLISTED_SCRAPE_METRICS: ReadonlyArray<string> = [
  ...(agentChartValues["cadvisor"]["metricsAllowlist"] as Array<string>),
  ...(agentChartValues["kubeStateMetrics"][
    "metricsAllowlist"
  ] as Array<string>),
  ...(agentChartValues["cost"]["metrics"]["metricsAllowlist"] as Array<string>),
];

export const AGENT_EMITTED_METRIC_NAMES: ReadonlySet<string> = new Set<string>([
  ...K8S_CLUSTER_RECEIVER_METRICS,
  ...KUBELETSTATS_RECEIVER_METRICS,
  ...CONTROL_PLANE_SCRAPE_METRICS,
  ...ALLOWLISTED_SCRAPE_METRICS,
]);
