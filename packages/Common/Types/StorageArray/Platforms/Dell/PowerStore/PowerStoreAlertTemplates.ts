import MetricsAggregationType from "../../../../Metrics/MetricsAggregationType";
import { FilterType } from "../../../../Monitor/CriteriaFilter";
import RollingTime from "../../../../RollingTime/RollingTime";
import { StorageArrayAlertTemplateSpec } from "../../../StorageArrayPlatform";

/*
 * The Dell PowerStore alert templates, as data (StorageArrayAlertTemplates
 * builds each one's monitor step), in the order the picker lists them after
 * Array Stopped Reporting. They are also what an array's Recommendations
 * offers. PowerStore's own alerts, which arrive by syslog, are Logs monitors
 * (PowerStoreSyslog.ts): this file is what the metrics alone can tell.
 *
 * The exporter's states are 1 for Healthy (or Ready, Started, Configured)
 * and 0 for any other state, on every object the cluster reports, so their
 * templates fire when the minimum over the window drops below 1 and recover
 * once it is 1 again. Those series are scraped every 5 minutes, so every
 * window holds at least one sample. The performance and space series are
 * PowerStore's five-minute samples, read every 5 minutes.
 *
 * Grouped by the label that names the object, so each object raises its
 * own alert. PowerStore names a part within its appliance (every appliance
 * has a BaseEnclosure-NodeA), so on a cluster of several appliances two
 * parts of one name share a group: the alert's labels name the appliance.
 *
 * Ids are stored on every monitor made from a template: never change one.
 */

// 0 or 1 only: the shared 10% recovery dead band would never be reached.
const RECOVER_WHEN_HEALTHY: StorageArrayAlertTemplateSpec["recover"] = {
  filterType: FilterType.GreaterThanOrEqualTo,
  value: 1,
  isBinaryMetric: true,
};

const POWERSTORE_ALERT_TEMPLATES: Array<StorageArrayAlertTemplateSpec> = [
  {
    id: "powerstore-capacity-high",
    name: "Capacity Above 80%",
    summary: "More than 80% of an appliance's physical capacity is in use.",
    description:
      "Alert when more than 80% of a PowerStore appliance's physical capacity is in use (powerstore_cap_physical_used_percent, which the agent works out from the appliance's physical used and total). One incident per appliance. PowerStore reports space once a day through its exporter, so this moves with that rollup; PowerStore's own capacity alerts arrive by syslog as they happen.",
    category: "Capacity",
    severity: "Warning",
    metricAlias: "capacity_used_percent",
    metricName: "powerstore_cap_physical_used_percent",
    groupByAttributeKey: "appliance_id",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 80 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 80 },
    incidentTitle: "[Storage Array] Capacity Above 80%",
    incidentDescription:
      "More than 80% of a PowerStore appliance's physical capacity is in use. The appliance_id label names it. Check which volumes and file systems are growing, delete or expire snapshots, migrate volumes to another appliance of the cluster, or add drives.",
    criteriaName: "Capacity Used > 80%",
    criteriaDescription:
      "Triggers when an appliance's physical capacity used stays above 80% over the monitoring window.",
  },
  {
    id: "powerstore-capacity-critical",
    name: "Capacity Above 90%",
    summary: "More than 90% of an appliance's physical capacity is in use.",
    description:
      "Alert when more than 90% of a PowerStore appliance's physical capacity is in use (powerstore_cap_physical_used_percent). One incident per appliance. PowerStore raises its own Major alert at 90% and goes read-only for new data when an appliance fills.",
    category: "Capacity",
    severity: "Critical",
    metricAlias: "capacity_used_percent",
    metricName: "powerstore_cap_physical_used_percent",
    groupByAttributeKey: "appliance_id",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 90 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 90 },
    incidentTitle: "[Storage Array] CRITICAL: Capacity Above 90%",
    incidentDescription:
      "More than 90% of a PowerStore appliance's physical capacity is in use. When it fills, writes to its volumes and file systems fail. Free space now: delete unused snapshots and volumes, migrate volumes to another appliance, or add drives.",
    criteriaName: "Capacity Used > 90%",
    criteriaDescription:
      "Triggers when an appliance's physical capacity used exceeds 90% over the monitoring window.",
  },
  {
    id: "powerstore-read-latency-high",
    name: "High Read Latency",
    summary: "An appliance's average read latency stays above 5 ms.",
    description:
      "Alert when a PowerStore appliance's average read latency stays above 5 ms over fifteen minutes, three of PowerStore's five-minute samples (powerstore_perf_avg_read_latency). One incident per appliance.",
    category: "Performance",
    severity: "Warning",
    metricAlias: "read_latency_usec",
    metricName: "powerstore_perf_avg_read_latency",
    groupByAttributeKey: "appliance_id",
    aggregationType: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 5000 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 5000 },
    incidentTitle: "[Storage Array] High Read Latency (>5 ms)",
    incidentDescription:
      "A PowerStore appliance's average read latency has stayed above 5 ms. Check the appliance's I/O CPU utilization, the busiest volumes and the Fibre Channel and Ethernet ports' errors, and whether a drive rebuild is running.",
    criteriaName: "Read Latency > 5 ms",
    criteriaDescription:
      "Triggers when an appliance's average read latency stays above 5000 µs over the monitoring window.",
  },
  {
    id: "powerstore-write-latency-high",
    name: "High Write Latency",
    summary: "An appliance's average write latency stays above 5 ms.",
    description:
      "Alert when a PowerStore appliance's average write latency stays above 5 ms over fifteen minutes (powerstore_perf_avg_write_latency). One incident per appliance.",
    category: "Performance",
    severity: "Warning",
    metricAlias: "write_latency_usec",
    metricName: "powerstore_perf_avg_write_latency",
    groupByAttributeKey: "appliance_id",
    aggregationType: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 5000 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 5000 },
    incidentTitle: "[Storage Array] High Write Latency (>5 ms)",
    incidentDescription:
      "A PowerStore appliance's average write latency has stayed above 5 ms. Check the appliance's I/O CPU utilization, replication and Metro traffic, the busiest volumes and the ports' errors.",
    criteriaName: "Write Latency > 5 ms",
    criteriaDescription:
      "Triggers when an appliance's average write latency stays above 5000 µs over the monitoring window.",
  },
  {
    id: "powerstore-drive-unhealthy",
    name: "Drive Failed",
    summary: "A drive stops reporting healthy.",
    description:
      "Alert when a PowerStore drive stops reporting Healthy (powerstore_hardware_Drive_state below 1): it has failed, been removed, or is not ready. One incident per drive.",
    category: "Hardware",
    severity: "Critical",
    metricAlias: "drive_healthy",
    metricName: "powerstore_hardware_Drive_state",
    groupByAttributeKey: "name",
    aggregationType: MetricsAggregationType.Min,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.LessThan, value: 1 },
    recover: RECOVER_WHEN_HEALTHY,
    incidentTitle: "[Storage Array] CRITICAL: Drive Failed",
    incidentDescription:
      "A PowerStore drive is not healthy. The name label names it (Drive_<bus>_<enclosure>_<slot>) and appliance_id its appliance. The appliance rebuilds onto its spare space: check its alerts in PowerStore Manager and replace the drive.",
    criteriaName: "Drive Not Healthy",
    criteriaDescription:
      "Triggers when any drive reports a state other than Healthy.",
  },
  {
    id: "powerstore-node-unhealthy",
    name: "Node Unhealthy",
    summary: "A node of an appliance stops reporting healthy.",
    description:
      "Alert when a node of a PowerStore appliance stops reporting Healthy (powerstore_hardware_node_state below 1, as the agent writes it; the state label names the node's state). One incident per node. Its peer node serves the appliance's I/O meanwhile, without redundancy.",
    category: "Hardware",
    severity: "Critical",
    metricAlias: "node_healthy",
    metricName: "powerstore_hardware_node_state",
    groupByAttributeKey: "name",
    aggregationType: MetricsAggregationType.Min,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.LessThan, value: 1 },
    recover: RECOVER_WHEN_HEALTHY,
    incidentTitle: "[Storage Array] CRITICAL: Node Unhealthy",
    incidentDescription:
      "A node of a PowerStore appliance is not healthy: the state label says how. Its appliance runs on its other node, with no redundancy left. Check the appliance's alerts in PowerStore Manager and open a case with Dell support.",
    criteriaName: "Node Not Healthy",
    criteriaDescription:
      "Triggers when any node reports a state other than Healthy.",
  },
  {
    id: "powerstore-power-supply-unhealthy",
    name: "Power Supply Unhealthy",
    summary: "A node's power supply stops reporting healthy.",
    description:
      "Alert when a node's power supply stops reporting Healthy (powerstore_hardware_Power_Supply_state below 1): it has failed, lost input power or been disconnected. One incident per power supply.",
    category: "Hardware",
    severity: "Warning",
    metricAlias: "power_supply_healthy",
    metricName: "powerstore_hardware_Power_Supply_state",
    groupByAttributeKey: "name",
    aggregationType: MetricsAggregationType.Min,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.LessThan, value: 1 },
    recover: RECOVER_WHEN_HEALTHY,
    incidentTitle: "[Storage Array] Power Supply Unhealthy",
    incidentDescription:
      "A PowerStore power supply is not healthy. The appliance runs on its peer power supply, with no redundancy left. Check the power cable and feed, then reseat or replace the unit.",
    criteriaName: "Power Supply Not Healthy",
    criteriaDescription:
      "Triggers when any power supply reports a state other than Healthy.",
  },
  {
    id: "powerstore-fan-unhealthy",
    name: "Fan Unhealthy",
    summary: "A node's fan module stops reporting healthy.",
    description:
      "Alert when a node's fan module stops reporting Healthy (powerstore_hardware_Fan_state below 1). One incident per fan module.",
    category: "Hardware",
    severity: "Warning",
    metricAlias: "fan_healthy",
    metricName: "powerstore_hardware_Fan_state",
    groupByAttributeKey: "name",
    aggregationType: MetricsAggregationType.Min,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.LessThan, value: 1 },
    recover: RECOVER_WHEN_HEALTHY,
    incidentTitle: "[Storage Array] Fan Unhealthy",
    incidentDescription:
      "A PowerStore fan module is not healthy, so the node's cooling may be degraded. Reseat or replace the fan module.",
    criteriaName: "Fan Not Healthy",
    criteriaDescription:
      "Triggers when any fan module reports a state other than Healthy.",
  },
  {
    id: "powerstore-battery-unhealthy",
    name: "Battery Unhealthy",
    summary: "A node's battery backup module stops reporting healthy.",
    description:
      "Alert when a node's battery backup module stops reporting Healthy (powerstore_hardware_Battery_state below 1). One incident per battery.",
    category: "Hardware",
    severity: "Warning",
    metricAlias: "battery_healthy",
    metricName: "powerstore_hardware_Battery_state",
    groupByAttributeKey: "name",
    aggregationType: MetricsAggregationType.Min,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.LessThan, value: 1 },
    recover: RECOVER_WHEN_HEALTHY,
    incidentTitle: "[Storage Array] Battery Unhealthy",
    incidentDescription:
      "A PowerStore battery backup module is not healthy, so the node's data high availability may be degraded. Reseat or replace the module.",
    criteriaName: "Battery Not Healthy",
    criteriaDescription:
      "Triggers when any battery backup module reports a state other than Healthy.",
  },
  {
    id: "powerstore-drive-endurance-low",
    name: "Drive Wearing Out",
    summary: "A drive has less than 10% of its write endurance left.",
    description:
      "Alert when a PowerStore drive has less than 10% of its write endurance left (powerstore_wear_metrics_by_drive). One incident per drive: plan its replacement before PowerStore raises its own end-of-life alert.",
    category: "Hardware",
    severity: "Warning",
    metricAlias: "endurance_remaining_percent",
    metricName: "powerstore_wear_metrics_by_drive",
    groupByAttributeKey: "name",
    aggregationType: MetricsAggregationType.Min,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.LessThan, value: 10 },
    recover: { filterType: FilterType.GreaterThanOrEqualTo, value: 10 },
    incidentTitle: "[Storage Array] Drive Wearing Out",
    incidentDescription:
      "A PowerStore drive has less than 10% of its write endurance left. Order a replacement and swap it before it wears out.",
    criteriaName: "Endurance Remaining < 10%",
    criteriaDescription:
      "Triggers when any drive has less than 10% of its endurance remaining.",
  },
  {
    id: "powerstore-nas-server-not-started",
    name: "NAS Server Not Started",
    summary: "A NAS server is not Started for 10 minutes.",
    description:
      "Alert when a PowerStore NAS server is not Started for ten minutes (powerstore_nas_server_operational_status below 1): it is stopped, failed over, or degraded and running without its backup node. One incident per NAS server.",
    category: "File Systems",
    severity: "Warning",
    metricAlias: "nas_server_started",
    metricName: "powerstore_nas_server_operational_status",
    groupByAttributeKey: "name",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.LessThan, value: 1 },
    recover: RECOVER_WHEN_HEALTHY,
    incidentTitle: "[Storage Array] NAS Server Not Started",
    incidentDescription:
      "A PowerStore NAS server has not been Started for ten minutes, so the file systems it serves may be unreachable or without failover. Check its state and its node in PowerStore Manager.",
    criteriaName: "NAS Server Not Started",
    criteriaDescription:
      "Triggers when a NAS server stays in a state other than Started over the monitoring window.",
  },
  {
    id: "powerstore-volume-not-ready",
    name: "Volume Not Ready",
    summary: "A volume is not Ready for 15 minutes.",
    description:
      "Alert when a PowerStore volume is not Ready for fifteen minutes (powerstore_volume_state below 1): offline, or stuck initializing or being destroyed. One incident per volume.",
    category: "Array Health",
    severity: "Warning",
    metricAlias: "volume_ready",
    metricName: "powerstore_volume_state",
    groupByAttributeKey: "name",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.LessThan, value: 1 },
    recover: RECOVER_WHEN_HEALTHY,
    incidentTitle: "[Storage Array] Volume Not Ready",
    incidentDescription:
      "A PowerStore volume has not been Ready for fifteen minutes, so the hosts it is mapped to may not reach it. Check the volume and its appliance's alerts in PowerStore Manager.",
    criteriaName: "Volume Not Ready",
    criteriaDescription:
      "Triggers when a volume stays in a state other than Ready over the monitoring window.",
  },
  {
    id: "powerstore-file-system-near-full",
    name: "File System Near Full",
    summary: "A file system has less than 10% of its size left.",
    description:
      "Alert when more than 90% of a PowerStore file system's size is in use (powerstore_filesystem_logical_used_percent, which the agent works out from its used and provisioned size). One incident per file system.",
    category: "File Systems",
    severity: "Warning",
    metricAlias: "file_system_used_percent",
    metricName: "powerstore_filesystem_logical_used_percent",
    groupByAttributeKey: "name",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 90 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 90 },
    incidentTitle: "[Storage Array] File System Near Full",
    incidentDescription:
      "A PowerStore file system has less than 10% of its size left. Writes to it fail once it is full. Grow the file system, delete data, or expire its snapshots.",
    criteriaName: "File System Used > 90%",
    criteriaDescription:
      "Triggers when any file system is more than 90% full over the monitoring window.",
  },
  {
    id: "powerstore-cluster-not-configured",
    name: "Cluster Not Configured",
    summary: "The cluster is not in its Configured state for 10 minutes.",
    description:
      "Alert when the PowerStore cluster has not been Configured for ten minutes (powerstore_cluster below 1): it is configuring, expanding, removing an appliance, or failed to cluster. Planned appliance changes raise it too.",
    category: "Array Health",
    severity: "Warning",
    metricAlias: "cluster_configured",
    metricName: "powerstore_cluster",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.LessThan, value: 1 },
    recover: RECOVER_WHEN_HEALTHY,
    incidentTitle: "[Storage Array] Cluster Not Configured",
    incidentDescription:
      "The PowerStore cluster has not been in its Configured state for ten minutes. If no appliance is being added or removed, check the cluster's alerts in PowerStore Manager.",
    criteriaName: "Cluster Not Configured",
    criteriaDescription:
      "Triggers when the cluster stays in a state other than Configured over the monitoring window.",
  },
  {
    id: "powerstore-metro-witness-not-ok",
    name: "Metro Witness Not Connected",
    summary: "A Metro witness is not OK for 10 minutes.",
    description:
      "Alert when a PowerStore Metro witness has not been OK for ten minutes (powerstore_metro_witness_status above 0): partially connected, disconnected, or initializing. Without its witness a Metro session may not fail over on its own. One incident per witness.",
    category: "Replication",
    severity: "Warning",
    metricAlias: "witness_state",
    metricName: "powerstore_metro_witness_status",
    groupByAttributeKey: "name",
    aggregationType: MetricsAggregationType.Min,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: {
      filterType: FilterType.EqualTo,
      value: 0,
      isBinaryMetric: true,
    },
    incidentTitle: "[Storage Array] Metro Witness Not Connected",
    incidentDescription:
      "A PowerStore Metro witness has not been OK for ten minutes. Check the network between the witness and every node of both clusters: Metro sessions need it to choose a side on their own.",
    criteriaName: "Witness Not OK",
    criteriaDescription:
      "Triggers when a Metro witness stays in a state other than OK over the monitoring window.",
  },
];

export default POWERSTORE_ALERT_TEMPLATES;
