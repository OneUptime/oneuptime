import IconProp from "../../../../Icon/IconProp";
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
import FLASHARRAY_METRICS from "./FlashArrayMetrics";
import FLASHARRAY_ALERT_TEMPLATES from "./FlashArrayAlertTemplates";

// The High Read and High Write Latency alerts' line (5 ms).
export const FLASHARRAY_LATENCY_WARNING_USEC: number = 5000;

/*
 * PURE STORAGE FLASHARRAY: block storage (and file services), read from
 * Purity//FA's native OpenMetrics endpoint (6.7 and later) or, on an older
 * Purity, through Pure's pure-fa-openmetrics-exporter. Both serve the same
 * purefa_* families with the same labels.
 *
 * The agent scrapes five endpoints, each as often as it is worth: the array
 * (identity, capacity, alerts, hardware) every 60 seconds, volumes, hosts
 * and pods every 2 minutes, directories every 30 (Pure: directory space is
 * expensive for the array to compute). Its extractor is
 * Common/Server/Utils/Telemetry/StorageArray/PureStorage/FlashArrayExtractor.
 */

// The Resource Usage page's cards, in order.
export const FLASHARRAY_INSIGHTS_SECTIONS: Array<StorageArrayInsightsSection> =
  [
    {
      key: "capacity",
      title: translationKey("Capacity"),
      description: translationKey(
        "Share of usable capacity in use, the free space left, the space only snapshots hold and the data reduction ratio.",
      ),
      icon: IconProp.ChartBar,
      metricIds: [
        "purefa-array-space-utilization",
        "purefa-array-space-empty",
        "purefa-array-space-snapshots",
        "purefa-array-data-reduction",
      ],
    },
    {
      key: "performance",
      title: translationKey("Performance"),
      description: translationKey(
        "Where time goes for the whole array: latency hosts see, the part of it spent in the SAN, mirrored writes, queue depth and I/O size.",
      ),
      icon: IconProp.Signal,
      metricIds: [
        "purefa-array-read-latency",
        "purefa-array-write-latency",
        "purefa-array-san-read-latency",
        "purefa-array-mirrored-write-latency",
        "purefa-array-queue-depth",
        "purefa-array-io-size",
      ],
    },
    {
      key: "volumes",
      title: translationKey("Volumes"),
      description: translationKey(
        "The ten volumes with the highest latency and IOPS.",
      ),
      icon: IconProp.Disc,
      metricIds: [
        "purefa-volume-read-latency",
        "purefa-volume-write-latency",
        "purefa-volume-read-iops",
        "purefa-volume-write-iops",
      ],
      groupByObject: true,
    },
    {
      key: "hosts",
      title: translationKey("Hosts"),
      description: translationKey(
        "The ten hosts that see the highest latency.",
      ),
      icon: IconProp.Server,
      metricIds: ["purefa-host-read-latency", "purefa-host-write-latency"],
      groupByObject: true,
    },
    {
      key: "replication",
      title: translationKey("Replication"),
      description: translationKey(
        "How far each pod's remote copy is behind, per replica link, and the replication traffic.",
      ),
      icon: IconProp.Refresh,
      metricIds: [
        "purefa-pod-replica-lag-max",
        "purefa-pod-replication-bandwidth",
      ],
      groupByObject: true,
    },
    {
      key: "hardware",
      title: translationKey("Hardware"),
      description: translationKey(
        "Temperature of each sensor and the error rate of each network interface.",
      ),
      icon: IconProp.CPUChip,
      metricIds: ["purefa-hw-temperature", "purefa-network-interface-errors"],
      groupByObject: true,
    },
  ];

const PureStorageFlashArrayPlatform: StorageArrayPlatform = {
  storageSystem: StorageSystem.PureStorageFlashArray,
  displayName: "Pure Storage FlashArray",
  shortName: "FlashArray",
  vendorName: PURE_STORAGE_VENDOR_NAME,
  aliases: [
    "purestorage.flasharray",
    "purestorage_flasharray",
    "purestorage-flasharray",
    "pure.flasharray",
    "pure_flasharray",
    "pure-flasharray",
    "everpure.flasharray",
    "everpure_flasharray",
    "purefa",
    "flasharray",
  ],

  metricPrefix: "purefa_",
  snapshotMetricNames: [
    // Array identity, capacity, alerts
    "purefa_info",
    "purefa_alerts_open",
    "purefa_array_space_bytes",
    "purefa_array_space_utilization",
    "purefa_array_space_data_reduction_ratio",
    // Hardware
    "purefa_hw_component_status",
    "purefa_hw_component_temperature_celsius",
    "purefa_drive_capacity_bytes",
    "purefa_hw_controller_info",
    "purefa_network_interface_speed_bandwidth_bytes",
    "purefa_network_interface_performance_bandwidth_bytes",
    "purefa_network_interface_performance_errors",
    // Volumes
    "purefa_volume_space_bytes",
    "purefa_volume_space_data_reduction_ratio",
    "purefa_volume_performance_latency_usec",
    "purefa_volume_performance_throughput_iops",
    "purefa_volume_performance_bandwidth_bytes",
    "purefa_volume_qos_iops_limit",
    "purefa_volume_qos_bandwidth_bytes_per_sec_limit",
    // Hosts
    "purefa_host_connectivity_info",
    "purefa_host_connections_info",
    "purefa_host_space_bytes",
    "purefa_host_space_data_reduction_ratio",
    "purefa_host_performance_latency_usec",
    "purefa_host_performance_throughput_iops",
    "purefa_host_performance_bandwidth_bytes",
    // Pods (ActiveCluster / ActiveDR)
    "purefa_pod_space_bytes",
    "purefa_pod_space_data_reduction_ratio",
    "purefa_pod_performance_latency_usec",
    "purefa_pod_performance_throughput_iops",
    "purefa_pod_performance_bandwidth_bytes",
    "purefa_pod_replica_links_lag_max_msec",
    "purefa_pod_replica_links_lag_average_msec",
    "purefa_pod_mediator_status",
    // File directories
    "purefa_directory_space_bytes",
    "purefa_directory_space_data_reduction_ratio",
    "purefa_directory_performance_latency_usec",
    "purefa_directory_performance_throughput_iops",
    "purefa_directory_performance_bandwidth_bytes",
  ],
  scrapeEndpoints: {
    volumes: [StorageArrayResourceKind.Volume],
    hosts: [StorageArrayResourceKind.Host],
    pods: [StorageArrayResourceKind.Pod],
    directories: [StorageArrayResourceKind.Directory],
  },

  kinds: [
    StorageArrayResourceKind.Volume,
    StorageArrayResourceKind.Host,
    StorageArrayResourceKind.Pod,
    StorageArrayResourceKind.Hardware,
    StorageArrayResourceKind.Drive,
    StorageArrayResourceKind.Controller,
    StorageArrayResourceKind.NetworkInterface,
    StorageArrayResourceKind.Directory,
  ],
  metricFamilies: [
    // purefa_volume_group_* series describe volume groups, not volumes.
    { prefix: "purefa_volume_group_", kind: null },
    { prefix: "purefa_volume_", kind: StorageArrayResourceKind.Volume },
    { prefix: "purefa_host_", kind: StorageArrayResourceKind.Host },
    { prefix: "purefa_pod_", kind: StorageArrayResourceKind.Pod },
    {
      prefix: "purefa_hw_controller_",
      kind: StorageArrayResourceKind.Controller,
    },
    { prefix: "purefa_hw_", kind: StorageArrayResourceKind.Hardware },
    { prefix: "purefa_drive_", kind: StorageArrayResourceKind.Drive },
    {
      prefix: "purefa_network_interface_",
      kind: StorageArrayResourceKind.NetworkInterface,
    },
    { prefix: "purefa_directory_", kind: StorageArrayResourceKind.Directory },
  ],
  /*
   * purefa_hw_component_status writes ok, critical, degraded, device_off,
   * identifying, not_installed or unknown; purefa_drive_capacity_bytes
   * healthy, failed, missing, recovering, unhealthy, unrecognized or empty;
   * purefa_hw_controller_info ready or not ready.
   */
  componentStatuses: STORAGE_ARRAY_COMPONENT_STATUSES,
  objectLabels: PURE_STORAGE_OBJECT_LABELS,

  metrics: FLASHARRAY_METRICS,
  /*
   * Every endpoint the agent scrapes exports purefa_info (value 1, with the
   * array's name and version as labels), the array endpoint every 60
   * seconds, whatever state the array is in.
   */
  heartbeat: {
    templateId: "purefa-array-stopped-reporting",
    metricName: "purefa_info",
  },
  alertTemplates: FLASHARRAY_ALERT_TEMPLATES,
  resourceFilters: [
    {
      key: "volumeName",
      description: translationKey(
        "Filter to one FlashArray volume — the `name` label of the purefa_volume_* series (optional). Volumes in a pod or volume group are named pod::volume or group/volume.",
      ),
    },
    {
      key: "hostName",
      description: translationKey(
        "Filter to one host defined on the FlashArray — the `host` label of the purefa_host_* series (optional).",
      ),
    },
    {
      key: "podName",
      description: translationKey(
        "Filter to one pod — the `name` label of the purefa_pod_* series, and `local_pod` on the replica link series (optional).",
      ),
    },
    {
      key: "componentName",
      description: translationKey(
        "Filter to one hardware part — the `component_name` label on a FlashArray, `name` on a FlashBlade (optional).",
      ),
    },
  ],

  overview: {
    goldenCharts: {
      readLatency: "purefa-array-read-latency",
      writeLatency: "purefa-array-write-latency",
      readIops: "purefa-array-read-iops",
      writeIops: "purefa-array-write-iops",
      readBandwidth: "purefa-array-read-bandwidth",
      writeBandwidth: "purefa-array-write-bandwidth",
      capacityUsed: "purefa-array-space-utilization",
      capacityUsedDescription: PURE_STORAGE_CAPACITY_USED_DESCRIPTION,
    },
    alertMetricName: "purefa_alerts_open",
    alertDetailsUnavailable: PURE_STORAGE_ALERT_DETAILS_UNAVAILABLE,
    countChips: [
      { kind: StorageArrayResourceKind.Volume, showWhenZero: true },
      { kind: StorageArrayResourceKind.Host, showWhenZero: true },
      // An array without ActiveCluster or ActiveDR has no pods to count.
      { kind: StorageArrayResourceKind.Pod, showWhenZero: false },
    ],
    inventoryTile: {
      kind: StorageArrayResourceKind.Volume,
      sublabelKind: StorageArrayResourceKind.Host,
    },
    topKind: StorageArrayResourceKind.Volume,
    /*
     * The array's average latency, as the High Read and High Write Latency
     * alerts read it: both turn Warning past 5 ms.
     */
    latency: {
      metricName: "purefa_array_performance_latency_usec",
      dimensionLabel: "dimension",
      readDimension: "usec_per_read_op",
      writeDimension: "usec_per_write_op",
      readWarningUsec: FLASHARRAY_LATENCY_WARNING_USEC,
      writeWarningUsec: FLASHARRAY_LATENCY_WARNING_USEC,
    },
  },
  insightsSections: FLASHARRAY_INSIGHTS_SECTIONS,
  hardwareTables: [
    {
      kind: StorageArrayResourceKind.Hardware,
      layout: "default",
      tableId: "storage-array-hardware-components-table",
      description: translationKey(
        "The chassis, controller and drive bays, power supplies, fans, temperature sensors and ports of this FlashArray, with the status Purity reports for each.",
      ),
      noItemsMessage: translationKey(
        "No hardware components in the inventory yet. They appear here a few minutes after the Storage Array Agent starts scraping the array.",
      ),
    },
    {
      kind: StorageArrayResourceKind.Drive,
      layout: "default",
      tableId: "storage-array-drives-table",
      description: translationKey(
        "The flash modules, SSDs and NVRAM modules in this FlashArray, with their raw capacity and the status Purity reports for each.",
      ),
      noItemsMessage: translationKey(
        "No drives in the inventory yet. They appear here a few minutes after the Storage Array Agent starts scraping the array.",
      ),
    },
    {
      kind: StorageArrayResourceKind.Controller,
      layout: "default",
      tableId: "storage-array-controllers-table",
      description: translationKey(
        "The controllers of this FlashArray: which one is primary, their model, the Purity version they run and their status.",
      ),
      noItemsMessage: translationKey(
        "No controllers in the inventory yet. They appear here a few minutes after the Storage Array Agent starts scraping the array.",
      ),
    },
    {
      kind: StorageArrayResourceKind.NetworkInterface,
      layout: "default",
      tableId: "storage-array-network-interfaces-table",
      description: translationKey(
        "The Ethernet and Fibre Channel ports of this FlashArray: whether each is enabled, its speed, the traffic it carries and the errors it sees.",
      ),
      noItemsMessage: translationKey(
        "No network interfaces in the inventory yet. They appear here a few minutes after the Storage Array Agent starts scraping the array.",
      ),
    },
  ],

  agentConfigs: [
    {
      key: "flasharray",
      label: translationKey("FlashArray"),
      description: translationKey(
        "Purity//FA 6.7 or later. The agent reads the metrics the array serves itself.",
      ),
      badge: translationKey("Recommended"),
      collectorConfigFile: "otel-collector-config.yaml",
      composeProfile: "",
      endpointVariable: "PURE_FA_ENDPOINT",
      tokenVariable: "PURE_FA_API_TOKEN",
      exampleEndpoint: "fa-prod-01.example.com",
      exporterService: null,
      arrayNoun: "FlashArray",
    },
    {
      key: "flasharray-exporter",
      label: translationKey("FlashArray, older Purity"),
      description: translationKey(
        "An older Purity//FA. The agent runs Pure's FlashArray exporter next to it.",
      ),
      collectorConfigFile: "otel-collector-config.flasharray-exporter.yaml",
      composeProfile: "flasharray-exporter",
      endpointVariable: "PURE_FA_ENDPOINT",
      tokenVariable: "PURE_FA_API_TOKEN",
      exampleEndpoint: "fa-prod-01.example.com",
      exporterService: "pure-fa-exporter",
      arrayNoun: "FlashArray",
    },
  ],
};

export default PureStorageFlashArrayPlatform;
