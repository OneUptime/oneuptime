import { StorageArrayResourceScope } from "../../../../Monitor/MonitorStepStorageArrayMonitor";
import MetricsAggregationType from "../../../../Metrics/MetricsAggregationType";
import { translationKey } from "../../../../Translator";
import StorageSystem from "../../../StorageSystem";
import { StorageArrayMetricDefinition } from "../../../StorageArrayPlatform";

/*
 * The Pure Storage FlashArray metric catalog: what a FlashArray monitor's
 * metric picker offers, the unit each is read in, and the charts' labels.
 *
 * Metric names and labels follow Pure's semantic conventions, shared by the
 * native OpenMetrics endpoint of Purity//FA 6.6.11+ and by the
 * pure-fa-openmetrics-exporter. Every value is a gauge the array computes
 * itself - latencies are microseconds per operation, throughput is per
 * second - so no rate math is ever needed. Pure's performance families put
 * read, write, mirrored-write, queue, SAN and QoS figures on ONE metric
 * name, told apart only by the `dimension` label - aggregating across them
 * mixes a 200µs read latency with a 4ms queue figure - so most entries pin
 * one dimension.
 *
 * Object identity lives in datapoint labels: volumes, pods and directories
 * carry `name`, hosts carry `host`, hardware carries `component_name`.
 * Group by those to fire one incident per object.
 *
 * Ids are stored on dashboards and monitors: never change one.
 */
const FA: Array<StorageSystem> = [StorageSystem.PureStorageFlashArray];

const FLASHARRAY_METRICS: Array<StorageArrayMetricDefinition> = [
  // ---------------- FlashArray: array health ----------------
  {
    id: "purefa-alerts-open",
    friendlyName: translationKey("Open Alerts"),
    description: translationKey(
      "One series per alert open on the FlashArray (value 1), with severity (critical, warning, info, hidden), category, code, component and summary labels. Filter severity = critical and take the maximum to detect any open critical alert, or group by summary to fire one incident per alert.",
    ),
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
    friendlyName: translationKey("Capacity Used (%)"),
    description: translationKey(
      "Share of the array's usable capacity in use, in percent (system, replication, shared, snapshot and unique space over capacity). Pure raises its own capacity alert at 80%, 90% and 100%.",
    ),
    metricName: "purefa_array_space_utilization",
    category: "Capacity",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "%",
  },
  {
    id: "purefa-array-space-capacity",
    friendlyName: translationKey("Usable Capacity"),
    description: translationKey(
      "Usable capacity of the array in bytes (space = capacity).",
    ),
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
    friendlyName: translationKey("Free Capacity"),
    description: translationKey(
      "Unused capacity of the array in bytes (space = empty). Falls as data is written; trend it to forecast when the array fills up.",
    ),
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
    friendlyName: translationKey("Snapshot Space"),
    description: translationKey(
      "Physical space held only by snapshots, in bytes (space = snapshots). A fast climb usually means a protection group retains more snapshots than planned.",
    ),
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
    friendlyName: translationKey("Data Reduction Ratio"),
    description: translationKey(
      "Data reduction (deduplication and compression) across the array, for example 4.2 for 4.2:1. A sustained drop means newly written data reduces poorly — encrypted or already-compressed data.",
    ),
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
    friendlyName: translationKey("Read Latency"),
    description: translationKey(
      "Average latency of a read as hosts see it, in microseconds (dimension usec_per_read_op). FlashArray reads typically complete well under 1 ms.",
    ),
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
    friendlyName: translationKey("Write Latency"),
    description: translationKey(
      "Average latency of a write as hosts see it, in microseconds (dimension usec_per_write_op).",
    ),
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
    friendlyName: translationKey("Mirrored Write Latency"),
    description: translationKey(
      "Average latency of a write to an ActiveCluster stretched pod, in microseconds (dimension usec_per_mirrored_write_op). Includes the round trip to the peer array.",
    ),
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
    friendlyName: translationKey("SAN Read Latency"),
    description: translationKey(
      "Time a read spends in the SAN between host and array, in microseconds (dimension san_usec_per_read_op). High SAN latency with low service latency points at the fabric or the host, not the array.",
    ),
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
    friendlyName: translationKey("Read IOPS"),
    description: translationKey(
      "Read operations per second across the array (dimension reads_per_sec).",
    ),
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
    friendlyName: translationKey("Write IOPS"),
    description: translationKey(
      "Write operations per second across the array (dimension writes_per_sec).",
    ),
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
    friendlyName: translationKey("Read Bandwidth"),
    description: translationKey(
      "Bytes read per second across the array (dimension read_bytes_per_sec).",
    ),
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
    friendlyName: translationKey("Write Bandwidth"),
    description: translationKey(
      "Bytes written per second across the array (dimension write_bytes_per_sec).",
    ),
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
    friendlyName: translationKey("Queue Depth"),
    description: translationKey(
      "Operations queued on the array. A queue that keeps growing while latency rises means hosts are sending more than the array can serve.",
    ),
    metricName: "purefa_array_performance_queue_depth_ops",
    category: "Performance",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "ops",
  },
  {
    id: "purefa-array-io-size",
    friendlyName: translationKey("Average I/O Size"),
    description: translationKey(
      "Average size of an operation in bytes (dimension bytes_per_op). Large I/O raises latency without anything being wrong.",
    ),
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
    friendlyName: translationKey("Volume Read Latency"),
    description: translationKey(
      "Average read latency of each volume in microseconds (dimension usec_per_read_op). Group by name to find the slow volume.",
    ),
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
    friendlyName: translationKey("Volume Write Latency"),
    description: translationKey(
      "Average write latency of each volume in microseconds (dimension usec_per_write_op).",
    ),
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
    friendlyName: translationKey("Volume Read IOPS"),
    description: translationKey(
      "Read operations per second of each volume (dimension reads_per_sec).",
    ),
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
    friendlyName: translationKey("Volume Write IOPS"),
    description: translationKey(
      "Write operations per second of each volume (dimension writes_per_sec).",
    ),
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
    friendlyName: translationKey("Volume Read Bandwidth"),
    description: translationKey(
      "Bytes read per second from each volume (dimension read_bytes_per_sec).",
    ),
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
    friendlyName: translationKey("Volume Write Bandwidth"),
    description: translationKey(
      "Bytes written per second to each volume (dimension write_bytes_per_sec).",
    ),
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
    friendlyName: translationKey("Volume Provisioned Size"),
    description: translationKey(
      "Size of each volume as hosts see it, in bytes (space = total_provisioned).",
    ),
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
    friendlyName: translationKey("Volume Physical Space"),
    description: translationKey(
      "Physical space each volume uses on the array after data reduction, in bytes (space = total_physical).",
    ),
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
    friendlyName: translationKey("Volume Data Reduction Ratio"),
    description: translationKey("Data reduction ratio of each volume."),
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
    friendlyName: translationKey("Host Connectivity"),
    description: translationKey(
      "One series per host (value 1) with its connectivity status (healthy, critical, unused) and details (Redundant, Single Controller, None...). Filter status = critical to find hosts that have lost their redundant paths to the array.",
    ),
    metricName: "purefa_host_connectivity_info",
    category: "Hosts",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Host,
    unit: "count",
  },
  {
    id: "purefa-host-read-latency",
    friendlyName: translationKey("Host Read Latency"),
    description: translationKey(
      "Average read latency each host sees, in microseconds (dimension usec_per_read_op). Group by host.",
    ),
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
    friendlyName: translationKey("Host Write Latency"),
    description: translationKey(
      "Average write latency each host sees, in microseconds (dimension usec_per_write_op).",
    ),
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
    friendlyName: translationKey("Host Read IOPS"),
    description: translationKey(
      "Read operations per second of each host (dimension reads_per_sec).",
    ),
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
    friendlyName: translationKey("Host Write IOPS"),
    description: translationKey(
      "Write operations per second of each host (dimension writes_per_sec).",
    ),
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
    friendlyName: translationKey("Replica Link Lag (Max)"),
    description: translationKey(
      "Largest replication lag of each pod replica link (ActiveDR / async), in milliseconds, with local_pod, remote_pod, remote, direction and status labels. Group by local_pod. Lag that keeps growing means the link cannot keep up and the recovery point is slipping.",
    ),
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
    friendlyName: translationKey("Replica Link Lag (Average)"),
    description: translationKey(
      "Average replication lag of each pod replica link in milliseconds.",
    ),
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
    friendlyName: translationKey("Pod Replication Bandwidth"),
    /*
     * The exporter sends one series per replication type (dimension:
     * continuous, resync, sync, periodic) and direction (from_remote,
     * to_remote, and their total). Unpinned, the Max of all twelve was
     * sometimes one direction and sometimes the total. Pinned to the total,
     * Max is the replication type carrying the most: a pod replicates one
     * way at a time.
     */
    description: translationKey(
      "Replication traffic of each pod in bytes per second, both directions together (direction total), for the replication type (dimension) that carries the most.",
    ),
    metricName: "purefa_pod_performance_replication_bandwidth_bytes",
    category: "Replication",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Pod,
    unit: "bytes/s",
    attributes: { direction: "total" },
  },
  {
    id: "purefa-pod-write-latency",
    friendlyName: translationKey("Pod Mirrored Write Latency"),
    description: translationKey(
      "Average mirrored write latency of each ActiveCluster pod in microseconds (dimension usec_per_mirrored_write_op).",
    ),
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
    friendlyName: translationKey("Hardware Component Status"),
    description: translationKey(
      "One series per hardware component (value 1) — chassis, controllers, drive and NVRAM bays, power supplies, fans, temperature sensors, Ethernet and Fibre Channel ports — with its status (ok, critical, degraded, device_off, identifying, not_installed, unknown). Filter component_status = critical and group by component_name to fire one incident per failed part.",
    ),
    metricName: "purefa_hw_component_status",
    category: "Hardware",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "count",
  },
  {
    id: "purefa-hw-temperature",
    friendlyName: translationKey("Component Temperature"),
    description: translationKey(
      "Temperature of each sensor in degrees Celsius. Group by component_name.",
    ),
    metricName: "purefa_hw_component_temperature_celsius",
    category: "Hardware",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "°C",
  },
  {
    id: "purefa-drive-capacity",
    friendlyName: translationKey("Drive Capacity"),
    description: translationKey(
      "Raw capacity of each drive in bytes, with its status (healthy, failed, missing, recovering, unhealthy, empty...) and type labels. Filter component_status = failed to find failed drives.",
    ),
    metricName: "purefa_drive_capacity_bytes",
    category: "Hardware",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "bytes",
  },
  {
    id: "purefa-network-interface-errors",
    friendlyName: translationKey("Network Interface Errors"),
    description: translationKey(
      "Errors per second on each Ethernet and Fibre Channel interface (dimension total_errors_per_sec). Sustained errors usually mean a bad cable, optic or switch port.",
    ),
    metricName: "purefa_network_interface_performance_errors",
    attributes: { dimension: "total_errors_per_sec" },
    category: "Hardware",
    storageSystems: FA,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    objectLabel: "name",
    unit: "errors/s",
  },
];

export default FLASHARRAY_METRICS;
