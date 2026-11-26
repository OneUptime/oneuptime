import IconProp from "../../../../Icon/IconProp";
import { StorageArrayResourceScope } from "../../../../Monitor/MonitorStepStorageArrayMonitor";
import { translationKey } from "../../../../Translator";
import StorageArrayResourceKind from "../../../StorageArrayResourceKind";
import StorageSystem from "../../../StorageSystem";
import {
  STORAGE_ARRAY_COMPONENT_STATUSES,
  StorageArrayInsightsSection,
  StorageArrayPlatform,
} from "../../../StorageArrayPlatform";
import {
  PURE_STORAGE_ALERT_DETAILS_UNAVAILABLE,
  PURE_STORAGE_CAPACITY_USED_DESCRIPTION,
  PURE_STORAGE_OBJECT_LABELS,
  PURE_STORAGE_VENDOR_NAME,
} from "../PureStorage";
import FLASHBLADE_METRICS from "./FlashBladeMetrics";
import FLASHBLADE_ALERT_TEMPLATES from "./FlashBladeAlertTemplates";

// The High Read Latency alert's line (10 ms).
export const FLASHBLADE_READ_LATENCY_WARNING_USEC: number = 10000;

/*
 * PURE STORAGE FLASHBLADE: unified file and object storage, read through
 * Pure's pure-fb-openmetrics-exporter, which the agent runs beside the
 * collector. Its purefb_* families describe the array, its file systems,
 * its S3 buckets and its hardware.
 *
 * The agent scrapes three endpoints: the array (identity, capacity,
 * alerts, hardware) every 60 seconds, and file systems and the object
 * store every 5 minutes. Its extractor is
 * Common/Server/Utils/Telemetry/StorageArray/PureStorage/FlashBladeExtractor.
 */

// The Resource Usage page's cards, in order.
export const FLASHBLADE_INSIGHTS_SECTIONS: Array<StorageArrayInsightsSection> =
  [
    {
      key: "capacity",
      title: translationKey("Capacity"),
      description: translationKey(
        "Share of usable capacity in use, the free space left and the data reduction ratio.",
      ),
      icon: IconProp.ChartBar,
      metricIds: [
        "purefb-array-space-utilization",
        "purefb-array-space-empty",
        "purefb-array-data-reduction",
      ],
    },
    {
      key: "performance",
      title: translationKey("Performance"),
      description: translationKey(
        "Latency, operations and bandwidth across every protocol the FlashBlade serves.",
      ),
      icon: IconProp.Signal,
      metricIds: [
        "purefb-array-read-latency",
        "purefb-array-write-latency",
        "purefb-array-read-iops",
        "purefb-array-write-iops",
        "purefb-array-read-bandwidth",
        "purefb-array-write-bandwidth",
      ],
    },
    {
      key: "file-systems",
      title: translationKey("File Systems"),
      description: translationKey(
        "The ten file systems with the highest latency, and the space they use.",
      ),
      icon: IconProp.Folder,
      metricIds: [
        "purefb-fs-read-latency",
        "purefb-fs-write-latency",
        "purefb-fs-physical",
      ],
      groupByObject: true,
    },
    {
      key: "buckets",
      title: translationKey("Buckets"),
      description: translationKey(
        "The ten buckets with the highest latency, the space they use and the objects they hold.",
      ),
      icon: IconProp.Archive,
      metricIds: [
        "purefb-bucket-read-latency",
        "purefb-bucket-physical",
        "purefb-bucket-object-count",
      ],
      groupByObject: true,
    },
    {
      key: "hardware",
      title: translationKey("Hardware"),
      description: translationKey(
        "Health of each blade, fabric module, power supply and fan: 1 is healthy, 0 needs a person.",
      ),
      icon: IconProp.CPUChip,
      metricIds: ["purefb-hardware-health"],
      groupByObject: true,
    },
  ];

const PureStorageFlashBladePlatform: StorageArrayPlatform = {
  storageSystem: StorageSystem.PureStorageFlashBlade,
  displayName: "Pure Storage FlashBlade",
  shortName: "FlashBlade",
  vendorName: PURE_STORAGE_VENDOR_NAME,
  aliases: [
    "purestorage.flashblade",
    "purestorage_flashblade",
    "purestorage-flashblade",
    "pure.flashblade",
    "pure_flashblade",
    "pure-flashblade",
    "everpure.flashblade",
    "everpure_flashblade",
    "purefb",
    "flashblade",
  ],

  metricPrefix: "purefb_",
  snapshotMetricNames: [
    // Array identity, capacity, alerts, hardware
    "purefb_info",
    "purefb_alerts_open",
    "purefb_array_space_bytes",
    "purefb_array_space_utilization",
    "purefb_array_space_data_reduction_ratio",
    "purefb_hardware_health",
    // File systems
    "purefb_file_systems_space_bytes",
    "purefb_file_systems_space_data_reduction_ratio",
    "purefb_file_systems_performance_latency_usec",
    "purefb_file_systems_performance_throughput_iops",
    "purefb_file_systems_performance_bandwidth_bytes",
    // Buckets
    "purefb_buckets_space_bytes",
    "purefb_buckets_quota_space_bytes",
    "purefb_buckets_space_data_reduction_ratio",
    "purefb_buckets_object_count",
    "purefb_buckets_performance_latency_usec",
    "purefb_buckets_performance_throughput_iops",
    "purefb_buckets_performance_bandwidth_bytes",
  ],
  scrapeEndpoints: {
    filesystems: [StorageArrayResourceKind.FileSystem],
    objectstore: [StorageArrayResourceKind.Bucket],
  },

  kinds: [
    StorageArrayResourceKind.Hardware,
    StorageArrayResourceKind.FileSystem,
    StorageArrayResourceKind.Bucket,
  ],
  metricFamilies: [
    {
      prefix: "purefb_file_systems_",
      kind: StorageArrayResourceKind.FileSystem,
    },
    { prefix: "purefb_buckets_", kind: StorageArrayResourceKind.Bucket },
    { prefix: "purefb_hardware_", kind: StorageArrayResourceKind.Hardware },
  ],
  /*
   * purefb_hardware_health is 1 for healthy, 2 for unused and 0 for
   * anything else; the extractor writes those as healthy, unused and
   * unhealthy.
   */
  componentStatuses: STORAGE_ARRAY_COMPONENT_STATUSES,
  objectLabels: {
    ...PURE_STORAGE_OBJECT_LABELS,
    // A FlashBlade names its blades, modules and power supplies `name`.
    [StorageArrayResourceScope.Hardware]: "name",
  },

  metrics: FLASHBLADE_METRICS,
  heartbeat: {
    templateId: "purefb-array-stopped-reporting",
    metricName: "purefb_info",
  },
  alertTemplates: FLASHBLADE_ALERT_TEMPLATES,
  resourceFilters: [
    {
      key: "componentName",
      description: translationKey(
        "Filter to one hardware part — the `component_name` label on a FlashArray, `name` on a FlashBlade (optional).",
      ),
    },
    {
      key: "fileSystemName",
      description: translationKey(
        "Filter to one FlashBlade file system — the `name` label of the purefb_file_systems_* series (optional).",
      ),
    },
    {
      key: "bucketName",
      description: translationKey(
        "Filter to one FlashBlade S3 bucket — the `name` label of the purefb_buckets_* series (optional).",
      ),
    },
  ],

  overview: {
    goldenCharts: {
      readLatency: "purefb-array-read-latency",
      writeLatency: "purefb-array-write-latency",
      readIops: "purefb-array-read-iops",
      writeIops: "purefb-array-write-iops",
      readBandwidth: "purefb-array-read-bandwidth",
      writeBandwidth: "purefb-array-write-bandwidth",
      capacityUsed: "purefb-array-space-utilization",
      capacityUsedDescription: PURE_STORAGE_CAPACITY_USED_DESCRIPTION,
    },
    alertMetricName: "purefb_alerts_open",
    alertDetailsUnavailable: PURE_STORAGE_ALERT_DETAILS_UNAVAILABLE,
    countChips: [
      { kind: StorageArrayResourceKind.FileSystem, showWhenZero: true },
      { kind: StorageArrayResourceKind.Bucket, showWhenZero: true },
    ],
    inventoryTile: {
      kind: StorageArrayResourceKind.FileSystem,
      sublabelKind: StorageArrayResourceKind.Bucket,
    },
    listCounts: [StorageArrayResourceKind.FileSystem],
    topKind: StorageArrayResourceKind.FileSystem,
    /*
     * The latency across every protocol, as the High Read Latency alert
     * reads it: Warning past 10 ms. No alert watches its writes.
     */
    latency: {
      metricName: "purefb_array_performance_latency_usec",
      attributes: { protocol: "all" },
      dimensionLabel: "dimension",
      readDimension: "usec_per_read_op",
      writeDimension: "usec_per_write_op",
      readWarningUsec: FLASHBLADE_READ_LATENCY_WARNING_USEC,
      writeWarningUsec: null,
    },
    // As the File System Near Full alert reads it.
    fileSystemFreeSpace: {
      metricName: "purefb_file_systems_space_bytes",
      attributes: { space: "available_ratio" },
      labelAttribute: "name",
    },
  },
  insightsSections: FLASHBLADE_INSIGHTS_SECTIONS,
  hardwareTables: [
    {
      kind: StorageArrayResourceKind.Hardware,
      layout: "slot-and-health",
      tableId: "storage-array-flashblade-hardware-table",
      description: translationKey(
        "Blades, fabric modules, power supplies, fans and the other parts of this FlashBlade, with the health the FlashBlade reports for each.",
      ),
      noItemsMessage: translationKey(
        "No hardware components in the inventory yet. They appear here a few minutes after the Storage Array Agent starts scraping the FlashBlade.",
      ),
    },
  ],

  agentConfigs: [
    {
      key: "flashblade",
      label: translationKey("FlashBlade"),
      description: translationKey(
        "The agent runs Pure's FlashBlade exporter next to it.",
      ),
      collectorConfigFile: "otel-collector-config.flashblade.yaml",
      composeProfile: "flashblade",
      endpointVariable: "PURE_FB_ENDPOINT",
      tokenVariable: "PURE_FB_API_TOKEN",
      exampleEndpoint: "fb-prod-01.example.com",
      exporterService: "pure-fb-exporter",
      arrayNoun: "FlashBlade",
    },
  ],
};

export default PureStorageFlashBladePlatform;
