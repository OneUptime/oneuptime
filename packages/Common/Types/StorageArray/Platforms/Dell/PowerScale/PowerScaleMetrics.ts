import { StorageArrayResourceScope } from "../../../../Monitor/MonitorStepStorageArrayMonitor";
import MetricsAggregationType from "../../../../Metrics/MetricsAggregationType";
import { translationKey } from "../../../../Translator";
import StorageSystem from "../../../StorageSystem";
import { StorageArrayMetricDefinition } from "../../../StorageArrayPlatform";

/*
 * The Dell PowerScale metric catalog: what a PowerScale monitor's metric
 * picker offers, the unit each is read in, and the charts' labels.
 *
 * The Storage Array Agent reads these from Dell's ISILON-MIB over SNMP
 * (agents/StorageArrayAgent/otel-collector-config.powerscale.yaml), and
 * the collector turns what the MIB reports in other shapes into plain
 * gauges: bits per second into bytes, CPU per mil into a percentage, a
 * sensor's string reading into a number, and a quota's usage against its
 * limit into a share. Every series names its cluster (`cluster`) or node
 * (`node`); a protocol's series also name it (`protocol`: nfs3, smb2, ...),
 * a drive's its bay (`drive`: "ps-prod-2 bay 3") and a quota's its path
 * (`path`) and whose quota it is (`quota`).
 *
 * Ids are stored on dashboards and monitors: never change one.
 */
const PS: Array<StorageSystem> = [StorageSystem.DellPowerScale];

const POWERSCALE_METRICS: Array<StorageArrayMetricDefinition> = [
  // ---------------- PowerScale: cluster health ----------------
  {
    id: "powerscale-cluster-health",
    friendlyName: translationKey("Cluster Health"),
    description: translationKey(
      "The health OneFS reports for the cluster: 0 is OK, 1 needs attention, 2 is down and 3 is invalid. Take the maximum to see any change.",
    ),
    metricName: "powerscale_cluster_health",
    category: "Array Health",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
  },
  {
    id: "powerscale-cluster-offline-nodes",
    friendlyName: translationKey("Offline Nodes"),
    description: translationKey(
      "How many of the cluster's nodes are offline. The offline_nodes label lists their logical node numbers.",
    ),
    metricName: "powerscale_cluster_offline_nodes",
    category: "Array Health",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "count",
  },

  // ---------------- PowerScale: capacity ----------------
  {
    id: "powerscale-capacity-used-percent",
    friendlyName: translationKey("Capacity Used (%)"),
    description: translationKey(
      "Share of the cluster's capacity no longer available for writes: what is in use, plus the space OneFS keeps back for virtual hot spares.",
    ),
    metricName: "powerscale_ifs_used_percent",
    category: "Capacity",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "%",
  },
  {
    id: "powerscale-capacity-available",
    friendlyName: translationKey("Available Capacity"),
    description: translationKey(
      "Space still available for writes on /ifs, in bytes.",
    ),
    metricName: "powerscale_ifs_available_bytes",
    category: "Capacity",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "bytes",
  },
  {
    id: "powerscale-capacity-used",
    friendlyName: translationKey("Used Capacity"),
    description: translationKey(
      "Space in use on /ifs, in bytes, as OneFS counts it.",
    ),
    metricName: "powerscale_ifs_used_bytes",
    category: "Capacity",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "bytes",
  },
  {
    id: "powerscale-capacity-total",
    friendlyName: translationKey("Total Capacity"),
    description: translationKey(
      "The size of /ifs across the cluster, in bytes.",
    ),
    metricName: "powerscale_ifs_total_bytes",
    category: "Capacity",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "bytes",
  },
  {
    id: "powerscale-quota-used-percent",
    friendlyName: translationKey("Quota Used (% of Limit)"),
    description: translationKey(
      "Each quota's usage as a share of its hard limit, or of its soft limit when it has no hard one (the limit label says which). Group by quota.",
    ),
    metricName: "powerscale_quota_used_percent",
    category: "Capacity",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.FileSystem,
    objectLabel: "quota",
    unit: "%",
  },
  {
    id: "powerscale-quota-usage",
    friendlyName: translationKey("Quota Usage"),
    description: translationKey(
      "What each quota holds, in bytes, as OneFS counts it against the quota.",
    ),
    metricName: "powerscale_quota_usage_bytes",
    category: "Capacity",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.FileSystem,
    objectLabel: "quota",
    unit: "bytes",
  },

  // ---------------- PowerScale: performance ----------------
  {
    id: "powerscale-read-throughput",
    friendlyName: translationKey("Read Throughput"),
    description: translationKey(
      "Bytes read out of /ifs per second, across the cluster.",
    ),
    metricName: "powerscale_cluster_ifs_read_bytes_per_second",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "bytes/s",
  },
  {
    id: "powerscale-write-throughput",
    friendlyName: translationKey("Write Throughput"),
    description: translationKey(
      "Bytes written into /ifs per second, across the cluster.",
    ),
    metricName: "powerscale_cluster_ifs_write_bytes_per_second",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "bytes/s",
  },
  {
    id: "powerscale-network-in",
    friendlyName: translationKey("Network In"),
    description: translationKey(
      "Bytes per second the cluster's front-end ports receive.",
    ),
    metricName: "powerscale_cluster_network_in_bytes_per_second",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "bytes/s",
  },
  {
    id: "powerscale-network-out",
    friendlyName: translationKey("Network Out"),
    description: translationKey(
      "Bytes per second the cluster's front-end ports send.",
    ),
    metricName: "powerscale_cluster_network_out_bytes_per_second",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "bytes/s",
  },
  {
    id: "powerscale-cpu-busy",
    friendlyName: translationKey("CPU Busy (%)"),
    description: translationKey(
      "Share of CPU time in use, averaged over the cluster's nodes.",
    ),
    metricName: "powerscale_cluster_cpu_busy_percent",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "%",
  },
  {
    id: "powerscale-protocol-latency",
    friendlyName: translationKey("Protocol Latency"),
    description: translationKey(
      "Average time an operation takes, per protocol (NFS, SMB, HDFS, ...) on each node, in microseconds. The maximum is the slowest node. Group by protocol or node.",
    ),
    metricName: "powerscale_protocol_latency_microseconds",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "protocol",
    unit: "µs",
  },
  {
    id: "powerscale-protocol-latency-max",
    friendlyName: translationKey("Protocol Latency (Slowest Operation)"),
    description: translationKey(
      "The slowest single operation per protocol on each node, in microseconds.",
    ),
    metricName: "powerscale_protocol_latency_max_microseconds",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "protocol",
    unit: "µs",
  },
  {
    id: "powerscale-protocol-operations",
    friendlyName: translationKey("Protocol Operations"),
    description: translationKey(
      "Operations per second per protocol on each node. Summed, the cluster's load per protocol.",
    ),
    metricName: "powerscale_protocol_operations_per_second",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "protocol",
    unit: "ops/s",
  },
  {
    id: "powerscale-protocol-in",
    friendlyName: translationKey("Protocol Throughput In"),
    description: translationKey(
      "Bytes per second clients send over each protocol on each node: writes and requests.",
    ),
    metricName: "powerscale_protocol_in_bytes_per_second",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "protocol",
    unit: "bytes/s",
  },
  {
    id: "powerscale-protocol-out",
    friendlyName: translationKey("Protocol Throughput Out"),
    description: translationKey(
      "Bytes per second sent to clients over each protocol on each node: reads and replies.",
    ),
    metricName: "powerscale_protocol_out_bytes_per_second",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "protocol",
    unit: "bytes/s",
  },

  // ---------------- PowerScale: nodes and hardware ----------------
  {
    id: "powerscale-node-health",
    friendlyName: translationKey("Node Health"),
    description: translationKey(
      "The health each node reports: 0 is OK, 1 needs attention, 2 is down and 3 is invalid. Group by node.",
    ),
    metricName: "powerscale_node_health",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
  },
  {
    id: "powerscale-node-read-only",
    friendlyName: translationKey("Node Read-Only"),
    description: translationKey(
      "1 while a node is in read-only mode, 0 otherwise. Group by node.",
    ),
    metricName: "powerscale_node_read_only",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
  },
  {
    id: "powerscale-node-cpu-busy",
    friendlyName: translationKey("Node CPU Busy (%)"),
    description: translationKey(
      "Share of each node's CPU time in use. Group by node.",
    ),
    metricName: "powerscale_node_cpu_busy_percent",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "%",
  },
  {
    id: "powerscale-node-read-throughput",
    friendlyName: translationKey("Node Read Throughput"),
    description: translationKey(
      "Bytes read out of /ifs per second through each node. Group by node.",
    ),
    metricName: "powerscale_node_ifs_read_bytes_per_second",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "bytes/s",
  },
  {
    id: "powerscale-node-write-throughput",
    friendlyName: translationKey("Node Write Throughput"),
    description: translationKey(
      "Bytes written into /ifs per second through each node. Group by node.",
    ),
    metricName: "powerscale_node_ifs_write_bytes_per_second",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "bytes/s",
  },
  {
    id: "powerscale-drive-capacity",
    friendlyName: translationKey("Drive Capacity"),
    description: translationKey(
      "One series per drive bay, with the drive's status (HEALTHY, SMARTFAIL, DEAD, ...), model and serial number as labels; the value is its size in bytes.",
    ),
    metricName: "powerscale_drive_size_bytes",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "bytes",
  },
  {
    id: "powerscale-drive-operations",
    friendlyName: translationKey("Drive Operations"),
    description: translationKey(
      "Operations per second each drive serves. Group by drive.",
    ),
    metricName: "powerscale_drive_operations_per_second",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    objectLabel: "drive",
    unit: "ops/s",
  },
  {
    id: "powerscale-temperature",
    friendlyName: translationKey("Temperature"),
    description: translationKey(
      "Each temperature sensor's reading on each node, in degrees Celsius. The maximum per node is its hottest sensor.",
    ),
    metricName: "powerscale_temperature_celsius",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "°C",
  },
  {
    id: "powerscale-fan-speed",
    friendlyName: translationKey("Fan Speed"),
    description: translationKey(
      "Each fan's speed on each node, in revolutions per minute. The minimum finds a fan slowing down.",
    ),
    metricName: "powerscale_fan_speed_rpm",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "rpm",
  },
  {
    id: "powerscale-interface-status",
    friendlyName: translationKey("Network Port Status"),
    description: translationKey(
      "Each node port's state: 1 is up, 2 is down, 7 is down below the port (no link). The admin_status label is 1 for a port that is meant to be up.",
    ),
    metricName: "powerscale_interface_status",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
  },
];

export default POWERSCALE_METRICS;
