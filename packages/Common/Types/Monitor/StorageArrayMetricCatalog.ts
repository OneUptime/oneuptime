import { StorageArrayResourceScope } from "./MonitorStepStorageArrayMonitor";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import StorageSystem from "../StorageArray/StorageSystem";

export type StorageArrayMetricCategory =
  | "Array Health"
  | "Capacity"
  | "Performance"
  | "Volumes"
  | "Hosts"
  | "Replication"
  | "Hardware"
  | "File Systems"
  | "Buckets";

export interface StorageArrayMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  /*
   * Datapoint label filters that make the series mean what friendlyName
   * says. Pure's performance families put read, write, mirrored-write,
   * queue, SAN and QoS figures on ONE metric name, told apart only by the
   * `dimension` label — aggregating across them mixes a 200µs read latency
   * with a 4ms queue figure — so most entries pin one dimension.
   */
  attributes?: Record<string, string> | undefined;
  category: StorageArrayMetricCategory;
  // The platforms that export this metric.
  storageSystems: Array<StorageSystem>;
  defaultAggregation: MetricsAggregationType;
  defaultResourceScope: StorageArrayResourceScope;
  /*
   * The datapoint label naming the object, when this metric does not use
   * the one its scope normally does (getStorageArrayObjectLabel): replica
   * link series name their pod `local_pod`, network interface series name
   * the interface `name`.
   */
  objectLabel?: string | undefined;
  unit?: string;
}

/*
 * Metric names and labels follow Pure's semantic conventions, shared by the
 * native OpenMetrics endpoint of Purity//FA 6.6.11+ and by the
 * pure-fa-openmetrics-exporter / pure-fb-openmetrics-exporter. Every value
 * is a gauge the array computes itself — latencies are microseconds per
 * operation, throughput is per second — so no rate math is ever needed.
 *
 * Object identity lives in datapoint labels: FlashArray volumes, pods and
 * directories carry `name`, hosts carry `host`, hardware carries
 * `component_name`; FlashBlade file systems, buckets and hardware carry
 * `name`. Group by those to fire one incident per object.
 */
const FA: Array<StorageSystem> = [StorageSystem.PureStorageFlashArray];
const FB: Array<StorageSystem> = [StorageSystem.PureStorageFlashBlade];

const storageArrayMetricCatalog: Array<StorageArrayMetricDefinition> = [
  // ---------------- FlashArray: array health ----------------
  {
    id: "purefa-alerts-open",
    friendlyName: "Open Alerts",
    description:
      "One series per alert open on the FlashArray (value 1), with severity (critical, warning, info, hidden), category, code, component and summary labels. Filter severity = critical and take the maximum to detect any open critical alert, or group by summary to fire one incident per alert.",
    metricName: "purefa_alerts_open",
    category: "Array Health",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "count",
  },

  // ---------------- FlashArray: capacity ----------------
  {
    id: "purefa-array-space-utilization",
    friendlyName: "Capacity Used (%)",
    description:
      "Share of the array's usable capacity in use, in percent (system, replication, shared, snapshot and unique space over capacity). Pure raises its own capacity alert at 80%, 90% and 100%.",
    metricName: "purefa_array_space_utilization",
    category: "Capacity",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "%",
  },
  {
    id: "purefa-array-space-capacity",
    friendlyName: "Usable Capacity",
    description: "Usable capacity of the array in bytes (space = capacity).",
    metricName: "purefa_array_space_bytes",
    attributes: { space: "capacity" },
    category: "Capacity",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "bytes",
  },
  {
    id: "purefa-array-space-empty",
    friendlyName: "Free Capacity",
    description:
      "Unused capacity of the array in bytes (space = empty). Falls as data is written; trend it to forecast when the array fills up.",
    metricName: "purefa_array_space_bytes",
    attributes: { space: "empty" },
    category: "Capacity",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "bytes",
  },
  {
    id: "purefa-array-space-snapshots",
    friendlyName: "Snapshot Space",
    description:
      "Physical space held only by snapshots, in bytes (space = snapshots). A fast climb usually means a protection group retains more snapshots than planned.",
    metricName: "purefa_array_space_bytes",
    attributes: { space: "snapshots" },
    category: "Capacity",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "bytes",
  },
  {
    id: "purefa-array-data-reduction",
    friendlyName: "Data Reduction Ratio",
    description:
      "Data reduction (deduplication and compression) across the array, for example 4.2 for 4.2:1. A sustained drop means newly written data reduces poorly — encrypted or already-compressed data.",
    metricName: "purefa_array_space_data_reduction_ratio",
    category: "Capacity",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "ratio",
  },

  // ---------------- FlashArray: performance ----------------
  {
    id: "purefa-array-read-latency",
    friendlyName: "Read Latency",
    description:
      "Average latency of a read as hosts see it, in microseconds (dimension usec_per_read_op). FlashArray reads typically complete well under 1 ms.",
    metricName: "purefa_array_performance_latency_usec",
    attributes: { dimension: "usec_per_read_op" },
    category: "Performance",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "µs",
  },
  {
    id: "purefa-array-write-latency",
    friendlyName: "Write Latency",
    description:
      "Average latency of a write as hosts see it, in microseconds (dimension usec_per_write_op).",
    metricName: "purefa_array_performance_latency_usec",
    attributes: { dimension: "usec_per_write_op" },
    category: "Performance",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "µs",
  },
  {
    id: "purefa-array-mirrored-write-latency",
    friendlyName: "Mirrored Write Latency",
    description:
      "Average latency of a write to an ActiveCluster stretched pod, in microseconds (dimension usec_per_mirrored_write_op). Includes the round trip to the peer array.",
    metricName: "purefa_array_performance_latency_usec",
    attributes: { dimension: "usec_per_mirrored_write_op" },
    category: "Performance",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "µs",
  },
  {
    id: "purefa-array-san-read-latency",
    friendlyName: "SAN Read Latency",
    description:
      "Time a read spends in the SAN between host and array, in microseconds (dimension san_usec_per_read_op). High SAN latency with low service latency points at the fabric or the host, not the array.",
    metricName: "purefa_array_performance_latency_usec",
    attributes: { dimension: "san_usec_per_read_op" },
    category: "Performance",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "µs",
  },
  {
    id: "purefa-array-read-iops",
    friendlyName: "Read IOPS",
    description:
      "Read operations per second across the array (dimension reads_per_sec).",
    metricName: "purefa_array_performance_throughput_iops",
    attributes: { dimension: "reads_per_sec" },
    category: "Performance",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "ops/s",
  },
  {
    id: "purefa-array-write-iops",
    friendlyName: "Write IOPS",
    description:
      "Write operations per second across the array (dimension writes_per_sec).",
    metricName: "purefa_array_performance_throughput_iops",
    attributes: { dimension: "writes_per_sec" },
    category: "Performance",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "ops/s",
  },
  {
    id: "purefa-array-read-bandwidth",
    friendlyName: "Read Bandwidth",
    description:
      "Bytes read per second across the array (dimension read_bytes_per_sec).",
    metricName: "purefa_array_performance_bandwidth_bytes",
    attributes: { dimension: "read_bytes_per_sec" },
    category: "Performance",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "bytes/s",
  },
  {
    id: "purefa-array-write-bandwidth",
    friendlyName: "Write Bandwidth",
    description:
      "Bytes written per second across the array (dimension write_bytes_per_sec).",
    metricName: "purefa_array_performance_bandwidth_bytes",
    attributes: { dimension: "write_bytes_per_sec" },
    category: "Performance",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "bytes/s",
  },
  {
    id: "purefa-array-queue-depth",
    friendlyName: "Queue Depth",
    description:
      "Operations queued on the array. A queue that keeps growing while latency rises means hosts are sending more than the array can serve.",
    metricName: "purefa_array_performance_queue_depth_ops",
    category: "Performance",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "ops",
  },
  {
    id: "purefa-array-io-size",
    friendlyName: "Average I/O Size",
    description:
      "Average size of an operation in bytes (dimension bytes_per_op). Large I/O raises latency without anything being wrong.",
    metricName: "purefa_array_performance_average_bytes",
    attributes: { dimension: "bytes_per_op" },
    category: "Performance",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "bytes",
  },

  // ---------------- FlashArray: volumes ----------------
  {
    id: "purefa-volume-read-latency",
    friendlyName: "Volume Read Latency",
    description:
      "Average read latency of each volume in microseconds (dimension usec_per_read_op). Group by name to find the slow volume.",
    metricName: "purefa_volume_performance_latency_usec",
    attributes: { dimension: "usec_per_read_op" },
    category: "Volumes",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    unit: "µs",
  },
  {
    id: "purefa-volume-write-latency",
    friendlyName: "Volume Write Latency",
    description:
      "Average write latency of each volume in microseconds (dimension usec_per_write_op).",
    metricName: "purefa_volume_performance_latency_usec",
    attributes: { dimension: "usec_per_write_op" },
    category: "Volumes",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    unit: "µs",
  },
  {
    id: "purefa-volume-read-iops",
    friendlyName: "Volume Read IOPS",
    description:
      "Read operations per second of each volume (dimension reads_per_sec).",
    metricName: "purefa_volume_performance_throughput_iops",
    attributes: { dimension: "reads_per_sec" },
    category: "Volumes",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    unit: "ops/s",
  },
  {
    id: "purefa-volume-write-iops",
    friendlyName: "Volume Write IOPS",
    description:
      "Write operations per second of each volume (dimension writes_per_sec).",
    metricName: "purefa_volume_performance_throughput_iops",
    attributes: { dimension: "writes_per_sec" },
    category: "Volumes",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    unit: "ops/s",
  },
  {
    id: "purefa-volume-read-bandwidth",
    friendlyName: "Volume Read Bandwidth",
    description:
      "Bytes read per second from each volume (dimension read_bytes_per_sec).",
    metricName: "purefa_volume_performance_bandwidth_bytes",
    attributes: { dimension: "read_bytes_per_sec" },
    category: "Volumes",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    unit: "bytes/s",
  },
  {
    id: "purefa-volume-write-bandwidth",
    friendlyName: "Volume Write Bandwidth",
    description:
      "Bytes written per second to each volume (dimension write_bytes_per_sec).",
    metricName: "purefa_volume_performance_bandwidth_bytes",
    attributes: { dimension: "write_bytes_per_sec" },
    category: "Volumes",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    unit: "bytes/s",
  },
  {
    id: "purefa-volume-provisioned",
    friendlyName: "Volume Provisioned Size",
    description:
      "Size of each volume as hosts see it, in bytes (space = total_provisioned).",
    metricName: "purefa_volume_space_bytes",
    attributes: { space: "total_provisioned" },
    category: "Volumes",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    unit: "bytes",
  },
  {
    id: "purefa-volume-physical",
    friendlyName: "Volume Physical Space",
    description:
      "Physical space each volume uses on the array after data reduction, in bytes (space = total_physical).",
    metricName: "purefa_volume_space_bytes",
    attributes: { space: "total_physical" },
    category: "Volumes",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    unit: "bytes",
  },
  {
    id: "purefa-volume-data-reduction",
    friendlyName: "Volume Data Reduction Ratio",
    description: "Data reduction ratio of each volume.",
    metricName: "purefa_volume_space_data_reduction_ratio",
    category: "Volumes",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    unit: "ratio",
  },

  // ---------------- FlashArray: hosts ----------------
  {
    id: "purefa-host-connectivity",
    friendlyName: "Host Connectivity",
    description:
      "One series per host (value 1) with its connectivity status (healthy, critical, unused) and details (Redundant, Single Controller, None...). Filter status = critical to find hosts that have lost their redundant paths to the array.",
    metricName: "purefa_host_connectivity_info",
    category: "Hosts",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Host,
    unit: "count",
  },
  {
    id: "purefa-host-read-latency",
    friendlyName: "Host Read Latency",
    description:
      "Average read latency each host sees, in microseconds (dimension usec_per_read_op). Group by host.",
    metricName: "purefa_host_performance_latency_usec",
    attributes: { dimension: "usec_per_read_op" },
    category: "Hosts",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Host,
    unit: "µs",
  },
  {
    id: "purefa-host-write-latency",
    friendlyName: "Host Write Latency",
    description:
      "Average write latency each host sees, in microseconds (dimension usec_per_write_op).",
    metricName: "purefa_host_performance_latency_usec",
    attributes: { dimension: "usec_per_write_op" },
    category: "Hosts",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Host,
    unit: "µs",
  },
  {
    id: "purefa-host-iops",
    friendlyName: "Host Read IOPS",
    description:
      "Read operations per second of each host (dimension reads_per_sec).",
    metricName: "purefa_host_performance_throughput_iops",
    attributes: { dimension: "reads_per_sec" },
    category: "Hosts",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Host,
    unit: "ops/s",
  },
  {
    id: "purefa-host-write-iops",
    friendlyName: "Host Write IOPS",
    description:
      "Write operations per second of each host (dimension writes_per_sec).",
    metricName: "purefa_host_performance_throughput_iops",
    attributes: { dimension: "writes_per_sec" },
    category: "Hosts",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Host,
    unit: "ops/s",
  },

  // ---------------- FlashArray: replication ----------------
  {
    id: "purefa-pod-replica-lag-max",
    friendlyName: "Replica Link Lag (Max)",
    description:
      "Largest replication lag of each pod replica link (ActiveDR / async), in milliseconds, with local_pod, remote_pod, remote, direction and status labels. Group by local_pod. Lag that keeps growing means the link cannot keep up and the recovery point is slipping.",
    metricName: "purefa_pod_replica_links_lag_max_msec",
    category: "Replication",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Pod,
    objectLabel: "local_pod",
    unit: "ms",
  },
  {
    id: "purefa-pod-replica-lag-avg",
    friendlyName: "Replica Link Lag (Average)",
    description:
      "Average replication lag of each pod replica link in milliseconds.",
    metricName: "purefa_pod_replica_links_lag_average_msec",
    category: "Replication",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: StorageArrayResourceScope.Pod,
    objectLabel: "local_pod",
    unit: "ms",
  },
  {
    id: "purefa-pod-replication-bandwidth",
    friendlyName: "Pod Replication Bandwidth",
    description:
      "Replication traffic of each pod in bytes per second, with direction and dimension labels.",
    metricName: "purefa_pod_performance_replication_bandwidth_bytes",
    category: "Replication",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Pod,
    unit: "bytes/s",
  },
  {
    id: "purefa-pod-write-latency",
    friendlyName: "Pod Mirrored Write Latency",
    description:
      "Average mirrored write latency of each ActiveCluster pod in microseconds (dimension usec_per_mirrored_write_op).",
    metricName: "purefa_pod_performance_latency_usec",
    attributes: { dimension: "usec_per_mirrored_write_op" },
    category: "Replication",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Pod,
    unit: "µs",
  },

  // ---------------- FlashArray: hardware ----------------
  {
    id: "purefa-hw-component-status",
    friendlyName: "Hardware Component Status",
    description:
      "One series per hardware component (value 1) — chassis, controllers, drive and NVRAM bays, power supplies, fans, temperature sensors, Ethernet and Fibre Channel ports — with its status (ok, critical, degraded, device_off, identifying, not_installed, unknown). Filter component_status = critical and group by component_name to fire one incident per failed part.",
    metricName: "purefa_hw_component_status",
    category: "Hardware",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "count",
  },
  {
    id: "purefa-hw-temperature",
    friendlyName: "Component Temperature",
    description:
      "Temperature of each sensor in degrees Celsius. Group by component_name.",
    metricName: "purefa_hw_component_temperature_celsius",
    category: "Hardware",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "°C",
  },
  {
    id: "purefa-drive-capacity",
    friendlyName: "Drive Capacity",
    description:
      "Raw capacity of each drive in bytes, with its status (healthy, failed, missing, recovering, unhealthy, empty...) and type labels. Filter component_status = failed to find failed drives.",
    metricName: "purefa_drive_capacity_bytes",
    category: "Hardware",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "bytes",
  },
  {
    id: "purefa-network-interface-errors",
    friendlyName: "Network Interface Errors",
    description:
      "Errors per second on each Ethernet and Fibre Channel interface (dimension total_errors_per_sec). Sustained errors usually mean a bad cable, optic or switch port.",
    metricName: "purefa_network_interface_performance_errors",
    attributes: { dimension: "total_errors_per_sec" },
    category: "Hardware",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    objectLabel: "name",
    unit: "errors/s",
  },

  // ---------------- FlashBlade: array health & capacity ----------------
  {
    id: "purefb-alerts-open",
    friendlyName: "Open Alerts",
    description:
      "One series per alert open on the FlashBlade (value 1), with severity, code, component and summary labels. Filter severity = critical to detect any open critical alert.",
    metricName: "purefb_alerts_open",
    category: "Array Health",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "count",
  },
  {
    id: "purefb-hardware-health",
    friendlyName: "Hardware Health",
    description:
      "Health of each hardware component (blades, fabric modules, power supplies, fans...): 1 = healthy, 2 = unused, 0 = unhealthy. Take the minimum to detect any unhealthy component, grouped by name.",
    metricName: "purefb_hardware_health",
    category: "Hardware",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
  },
  {
    id: "purefb-array-space-utilization",
    friendlyName: "Capacity Used (%)",
    description:
      "Share of the FlashBlade's usable capacity in use, in percent (type = array).",
    metricName: "purefb_array_space_utilization",
    attributes: { type: "array" },
    category: "Capacity",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "%",
  },
  {
    id: "purefb-array-space-empty",
    friendlyName: "Free Capacity",
    description:
      "Unused capacity of the FlashBlade in bytes (type = array, space = empty).",
    metricName: "purefb_array_space_bytes",
    attributes: { type: "array", space: "empty" },
    category: "Capacity",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "bytes",
  },
  {
    id: "purefb-array-data-reduction",
    friendlyName: "Data Reduction Ratio",
    description:
      "Data reduction across the FlashBlade (type = array), for example 2.1 for 2.1:1.",
    metricName: "purefb_array_space_data_reduction_ratio",
    attributes: { type: "array" },
    category: "Capacity",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "ratio",
  },

  // ---------------- FlashBlade: performance ----------------
  {
    id: "purefb-array-read-latency",
    friendlyName: "Read Latency",
    description:
      "Average read latency across all protocols in microseconds (dimension usec_per_read_op, protocol all).",
    metricName: "purefb_array_performance_latency_usec",
    attributes: { dimension: "usec_per_read_op", protocol: "all" },
    category: "Performance",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "µs",
  },
  {
    id: "purefb-array-write-latency",
    friendlyName: "Write Latency",
    description:
      "Average write latency across all protocols in microseconds (dimension usec_per_write_op, protocol all).",
    metricName: "purefb_array_performance_latency_usec",
    attributes: { dimension: "usec_per_write_op", protocol: "all" },
    category: "Performance",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "µs",
  },
  {
    id: "purefb-array-read-iops",
    friendlyName: "Read IOPS",
    description:
      "Read operations per second across all protocols (dimension reads_per_sec, protocol all).",
    metricName: "purefb_array_performance_throughput_iops",
    attributes: { dimension: "reads_per_sec", protocol: "all" },
    category: "Performance",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "ops/s",
  },
  {
    id: "purefb-array-write-iops",
    friendlyName: "Write IOPS",
    description:
      "Write operations per second across all protocols (dimension writes_per_sec, protocol all).",
    metricName: "purefb_array_performance_throughput_iops",
    attributes: { dimension: "writes_per_sec", protocol: "all" },
    category: "Performance",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "ops/s",
  },
  {
    id: "purefb-array-read-bandwidth",
    friendlyName: "Read Bandwidth",
    description:
      "Bytes read per second across all protocols (dimension read_bytes_per_sec, protocol all).",
    metricName: "purefb_array_performance_bandwidth_bytes",
    attributes: { dimension: "read_bytes_per_sec", protocol: "all" },
    category: "Performance",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "bytes/s",
  },
  {
    id: "purefb-array-write-bandwidth",
    friendlyName: "Write Bandwidth",
    description:
      "Bytes written per second across all protocols (dimension write_bytes_per_sec, protocol all).",
    metricName: "purefb_array_performance_bandwidth_bytes",
    attributes: { dimension: "write_bytes_per_sec", protocol: "all" },
    category: "Performance",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "bytes/s",
  },

  // ---------------- FlashBlade: file systems ----------------
  {
    id: "purefb-fs-read-latency",
    friendlyName: "File System Read Latency",
    description:
      "Average read latency of each file system in microseconds (dimension usec_per_read_op). Group by name.",
    metricName: "purefb_file_systems_performance_latency_usec",
    attributes: { dimension: "usec_per_read_op" },
    category: "File Systems",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.FileSystem,
    unit: "µs",
  },
  {
    id: "purefb-fs-write-latency",
    friendlyName: "File System Write Latency",
    description:
      "Average write latency of each file system in microseconds (dimension usec_per_write_op).",
    metricName: "purefb_file_systems_performance_latency_usec",
    attributes: { dimension: "usec_per_write_op" },
    category: "File Systems",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.FileSystem,
    unit: "µs",
  },
  {
    id: "purefb-fs-physical",
    friendlyName: "File System Physical Space",
    description:
      "Physical space each file system uses in bytes (space = total_physical).",
    metricName: "purefb_file_systems_space_bytes",
    attributes: { space: "total_physical" },
    category: "File Systems",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.FileSystem,
    unit: "bytes",
  },
  {
    id: "purefb-fs-available-ratio",
    friendlyName: "File System Space Available (Ratio)",
    description:
      "Share of each file system's provisioned size still available, 0 to 1 (space = available_ratio). Near 0 means the file system is about to fill its quota.",
    metricName: "purefb_file_systems_space_bytes",
    attributes: { space: "available_ratio" },
    category: "File Systems",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.FileSystem,
    unit: "ratio",
  },

  // ---------------- FlashBlade: buckets ----------------
  {
    id: "purefb-bucket-read-latency",
    friendlyName: "Bucket Read Latency",
    description:
      "Average read latency of each bucket in microseconds (dimension usec_per_read_op). Group by name.",
    metricName: "purefb_buckets_performance_latency_usec",
    attributes: { dimension: "usec_per_read_op" },
    category: "Buckets",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Bucket,
    unit: "µs",
  },
  {
    id: "purefb-bucket-physical",
    friendlyName: "Bucket Physical Space",
    description:
      "Physical space each bucket uses in bytes (space = total_physical).",
    metricName: "purefb_buckets_space_bytes",
    attributes: { space: "total_physical" },
    category: "Buckets",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Bucket,
    unit: "bytes",
  },
  {
    id: "purefb-bucket-object-count",
    friendlyName: "Bucket Object Count",
    description: "Number of objects in each bucket.",
    metricName: "purefb_buckets_object_count",
    category: "Buckets",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Bucket,
    unit: "count",
  },
];

export function getAllStorageArrayMetrics(): Array<StorageArrayMetricDefinition> {
  return storageArrayMetricCatalog;
}

/*
 * The metrics a platform exports. An unknown or empty system (an array not
 * yet reporting, or a platform OneUptime has no catalog for) gets every
 * metric, so the picker is never empty.
 */
export function getStorageArrayMetricsForSystem(
  system: string | null | undefined,
): Array<StorageArrayMetricDefinition> {
  const forSystem: Array<StorageArrayMetricDefinition> =
    storageArrayMetricCatalog.filter((m: StorageArrayMetricDefinition) => {
      return m.storageSystems.includes(system as StorageSystem);
    });
  return forSystem.length > 0 ? forSystem : storageArrayMetricCatalog;
}

export function getStorageArrayMetricsByCategory(
  category: StorageArrayMetricCategory,
): Array<StorageArrayMetricDefinition> {
  return storageArrayMetricCatalog.filter((m: StorageArrayMetricDefinition) => {
    return m.category === category;
  });
}

export function getStorageArrayMetricById(
  id: string,
): StorageArrayMetricDefinition | undefined {
  return storageArrayMetricCatalog.find((m: StorageArrayMetricDefinition) => {
    return m.id === id;
  });
}

/*
 * The FIRST catalog entry for a metric name. Several entries share a name
 * (read and write latency differ only by their dimension filter), so a
 * caller that knows the filters should prefer getStorageArrayMetric.
 */
export function getStorageArrayMetricByMetricName(
  metricName: string,
): StorageArrayMetricDefinition | undefined {
  return storageArrayMetricCatalog.find((m: StorageArrayMetricDefinition) => {
    return m.metricName === metricName;
  });
}

/*
 * The catalog entry that matches a metric name AND the query's attribute
 * filters — the most specific one wins (every attribute the entry pins must
 * match). Falls back to the first entry for the name.
 */
export function getStorageArrayMetric(
  metricName: string,
  attributes?: Record<string, unknown> | undefined,
): StorageArrayMetricDefinition | undefined {
  const candidates: Array<StorageArrayMetricDefinition> =
    storageArrayMetricCatalog.filter((m: StorageArrayMetricDefinition) => {
      return m.metricName === metricName;
    });

  let best: StorageArrayMetricDefinition | undefined = undefined;
  let bestSpecificity: number = -1;
  for (const candidate of candidates) {
    const pinned: Record<string, string> = candidate.attributes || {};
    const keys: Array<string> = Object.keys(pinned);
    const matches: boolean = keys.every((key: string) => {
      return (
        attributes !== undefined && String(attributes[key]) === pinned[key]
      );
    });
    if (matches && keys.length > bestSpecificity) {
      best = candidate;
      bestSpecificity = keys.length;
    }
  }

  return best || candidates[0];
}

export function getAllStorageArrayMetricCategories(): Array<StorageArrayMetricCategory> {
  return [
    "Array Health",
    "Capacity",
    "Performance",
    "Volumes",
    "Hosts",
    "Replication",
    "Hardware",
    "File Systems",
    "Buckets",
  ];
}

/*
 * The datapoint label that names one object of a resource scope on a
 * platform — the label a resource filter equality-filters and a per-object
 * template groups by. Pass the query's metric name when there is one: a few
 * series name their object with a different label than the rest of their
 * scope (purefa_pod_replica_links_* carry the pod as `local_pod`), and a
 * filter on the scope's usual label would match none of them.
 */
export function getStorageArrayObjectLabel(
  scope: StorageArrayResourceScope,
  system: string | null | undefined,
  metricName?: string | undefined,
): string | null {
  /*
   * Only for the metric's own scope: a filter for another kind of object on
   * this query (a volume filter on a replica-link series) keeps its usual
   * label rather than being rewritten onto this metric's.
   */
  const metric: StorageArrayMetricDefinition | undefined = metricName
    ? getStorageArrayMetricByMetricName(metricName)
    : undefined;
  if (metric?.objectLabel && metric.defaultResourceScope === scope) {
    return metric.objectLabel;
  }

  switch (scope) {
    case StorageArrayResourceScope.Host:
      return "host";
    case StorageArrayResourceScope.Hardware:
      return system === StorageSystem.PureStorageFlashBlade
        ? "name"
        : "component_name";
    case StorageArrayResourceScope.Volume:
    case StorageArrayResourceScope.Pod:
    case StorageArrayResourceScope.FileSystem:
    case StorageArrayResourceScope.Bucket:
      return "name";
    case StorageArrayResourceScope.Array:
    default:
      return null;
  }
}
