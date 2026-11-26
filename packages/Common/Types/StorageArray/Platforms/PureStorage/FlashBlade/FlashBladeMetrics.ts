import { StorageArrayResourceScope } from "../../../../Monitor/MonitorStepStorageArrayMonitor";
import MetricsAggregationType from "../../../../Metrics/MetricsAggregationType";
import { translationKey } from "../../../../Translator";
import StorageSystem from "../../../StorageSystem";
import { StorageArrayMetricDefinition } from "../../../StorageArrayPlatform";

/*
 * The Pure Storage FlashBlade metric catalog: what a FlashBlade monitor's
 * metric picker offers, the unit each is read in, and the charts' labels.
 *
 * Metric names and labels follow pure-fb-openmetrics-exporter. Every value
 * is a gauge the array computes itself. File systems, buckets and hardware
 * carry their name in `name`; the array-wide space families also report
 * file-system and object-store rows, told apart by `type`, so the array's
 * own entries pin `type = array`.
 *
 * Ids are stored on dashboards and monitors: never change one.
 */
const FB: Array<StorageSystem> = [StorageSystem.PureStorageFlashBlade];

const FLASHBLADE_METRICS: Array<StorageArrayMetricDefinition> = [
  // ---------------- FlashBlade: array health & capacity ----------------
  {
    id: "purefb-alerts-open",
    friendlyName: translationKey("Open Alerts"),
    description: translationKey(
      "One series per alert open on the FlashBlade (value 1), with severity, code, component and summary labels. Filter severity = critical to detect any open critical alert.",
    ),
    metricName: "purefb_alerts_open",
    category: "Array Health",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "count",
  },
  {
    id: "purefb-hardware-health",
    friendlyName: translationKey("Hardware Health"),
    description: translationKey(
      "Health of each hardware component (blades, fabric modules, power supplies, fans...): 1 = healthy, 2 = unused, 0 = unhealthy. Take the minimum to detect any unhealthy component, grouped by name.",
    ),
    metricName: "purefb_hardware_health",
    category: "Hardware",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
  },
  {
    id: "purefb-array-space-utilization",
    friendlyName: translationKey("Capacity Used (%)"),
    description: translationKey(
      "Share of the FlashBlade's usable capacity in use, in percent (type = array).",
    ),
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
    friendlyName: translationKey("Free Capacity"),
    description: translationKey(
      "Unused capacity of the FlashBlade in bytes (type = array, space = empty).",
    ),
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
    friendlyName: translationKey("Data Reduction Ratio"),
    description: translationKey(
      "Data reduction across the FlashBlade (type = array), for example 2.1 for 2.1:1.",
    ),
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
    friendlyName: translationKey("Read Latency"),
    description: translationKey(
      "Average read latency across all protocols in microseconds (dimension usec_per_read_op, protocol all).",
    ),
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
    friendlyName: translationKey("Write Latency"),
    description: translationKey(
      "Average write latency across all protocols in microseconds (dimension usec_per_write_op, protocol all).",
    ),
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
    friendlyName: translationKey("Read IOPS"),
    description: translationKey(
      "Read operations per second across all protocols (dimension reads_per_sec, protocol all).",
    ),
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
    friendlyName: translationKey("Write IOPS"),
    description: translationKey(
      "Write operations per second across all protocols (dimension writes_per_sec, protocol all).",
    ),
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
    friendlyName: translationKey("Read Bandwidth"),
    description: translationKey(
      "Bytes read per second across all protocols (dimension read_bytes_per_sec, protocol all).",
    ),
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
    friendlyName: translationKey("Write Bandwidth"),
    description: translationKey(
      "Bytes written per second across all protocols (dimension write_bytes_per_sec, protocol all).",
    ),
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
    friendlyName: translationKey("File System Read Latency"),
    description: translationKey(
      "Average read latency of each file system in microseconds (dimension usec_per_read_op). Group by name.",
    ),
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
    friendlyName: translationKey("File System Write Latency"),
    description: translationKey(
      "Average write latency of each file system in microseconds (dimension usec_per_write_op).",
    ),
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
    friendlyName: translationKey("File System Physical Space"),
    description: translationKey(
      "Physical space each file system uses in bytes (space = total_physical).",
    ),
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
    friendlyName: translationKey("File System Space Available (Ratio)"),
    description: translationKey(
      "Share of each file system's provisioned size still available, 0 to 1 (space = available_ratio). Near 0 means the file system is about to fill its quota.",
    ),
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
    friendlyName: translationKey("Bucket Read Latency"),
    description: translationKey(
      "Average read latency of each bucket in microseconds (dimension usec_per_read_op). Group by name.",
    ),
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
    friendlyName: translationKey("Bucket Physical Space"),
    description: translationKey(
      "Physical space each bucket uses in bytes (space = total_physical).",
    ),
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
    friendlyName: translationKey("Bucket Object Count"),
    description: translationKey("Number of objects in each bucket."),
    metricName: "purefb_buckets_object_count",
    category: "Buckets",
    storageSystems: FB,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Bucket,
    unit: "count",
  },
];

export default FLASHBLADE_METRICS;
