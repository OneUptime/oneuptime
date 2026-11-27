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
import POWERSTORE_METRICS from "./PowerStoreMetrics";
import POWERSTORE_ALERT_TEMPLATES from "./PowerStoreAlertTemplates";
import POWERSTORE_LOG_ALERT_TEMPLATES from "./PowerStoreSyslog";

/*
 * DELL POWERSTORE: Dell's midrange block and file array (PowerStore T, and
 * the 500T to 9200T, 1200T Q, 3200Q and 5200Q), a cluster of one to four
 * appliances, each a base enclosure of two nodes and its drives. Read
 * through Dell's powerstore-metrics-exporter (v1.0.3), which the agent runs
 * beside the collector (docker-compose.yml's powerstore-exporter) and which
 * logs in to the cluster's REST API itself. Its powerstore_* families
 * describe the cluster, each appliance's performance and space, the
 * hardware, the front-end ports, the volumes and volume groups, the NAS
 * servers and the file systems.
 *
 * The agent scrapes one path per part (otel-collector-config.powerstore
 * .yaml): the cluster every minute, every other part every 5 minutes, which
 * is how often PowerStore computes the samples the exporter reads. Its
 * extractor is
 * Common/Server/Utils/Telemetry/StorageArray/Dell/PowerStoreExtractor.
 *
 * The exporter reads no alerts, hosts or replication sessions: PowerStore's
 * alerts arrive by syslog (PowerStoreSyslog.ts), so this platform declares
 * no alert series and its arrays' health comes from their hardware alone.
 *
 * PowerStore names a part within its appliance (every appliance has a
 * BaseEnclosure-NodeA and a Drive_0_0_0), so a part's inventory row is keyed
 * by its appliance and name, and its table shows the appliance.
 */

// The kinds only PowerStore has, with the words the pages use for them.
export const POWERSTORE_KIND: {
  readonly Appliance: "Appliance";
  readonly VolumeGroup: "VolumeGroup";
  readonly NasServer: "NasServer";
} = {
  Appliance: "Appliance",
  VolumeGroup: "VolumeGroup",
  NasServer: "NasServer",
};

export const POWERSTORE_VENDOR_NAME: string = "Dell";

/*
 * What a part's state reads, lowercased: a node names its lifecycle state
 * (Healthy, Failed, Disconnected, Prepare_Failed, Initializing,
 * Uninitialized, Trigger_Update, Empty); every other part is the exporter's
 * 0 or 1, which the extractor writes as unhealthy or healthy.
 */
export const POWERSTORE_COMPONENT_STATUSES: StorageArrayPlatform["componentStatuses"] =
  {
    critical: [
      ...STORAGE_ARRAY_COMPONENT_STATUSES.critical,
      "prepare_failed",
      "disconnected",
    ],
    warning: [
      ...STORAGE_ARRAY_COMPONENT_STATUSES.warning,
      "uninitialized",
      "initializing",
      "trigger_update",
    ],
  };

// The Resource Usage page's cards, in order.
export const POWERSTORE_INSIGHTS_SECTIONS: Array<StorageArrayInsightsSection> =
  [
    {
      key: "capacity",
      title: translationKey("Capacity"),
      description: translationKey(
        "Each appliance's physical capacity used, in percent and in bytes, and its data reduction.",
      ),
      icon: IconProp.ChartBar,
      metricIds: [
        "powerstore-appliance-used-percent",
        "powerstore-appliance-physical-used",
        "powerstore-appliance-data-reduction",
      ],
      groupByObject: true,
    },
    {
      key: "performance",
      title: translationKey("Performance"),
      description: translationKey(
        "Each appliance's latency, operations and bandwidth, and how busy its I/O cores are.",
      ),
      icon: IconProp.Signal,
      metricIds: [
        "powerstore-appliance-read-latency",
        "powerstore-appliance-write-latency",
        "powerstore-appliance-read-iops",
        "powerstore-appliance-write-iops",
        "powerstore-appliance-read-bandwidth",
        "powerstore-appliance-write-bandwidth",
        "powerstore-appliance-cpu-utilization",
      ],
      groupByObject: true,
    },
    {
      key: "volumes",
      title: translationKey("Volumes"),
      description: translationKey(
        "The ten volumes with the highest latency and IOPS.",
      ),
      icon: IconProp.Disc,
      metricIds: [
        "powerstore-volume-read-latency",
        "powerstore-volume-write-latency",
        "powerstore-volume-read-iops",
        "powerstore-volume-write-iops",
      ],
      groupByObject: true,
    },
    {
      key: "ports",
      title: translationKey("Ports"),
      description: translationKey(
        "Latency, operations and errors of each Fibre Channel port, and the traffic of each Ethernet port.",
      ),
      icon: IconProp.Signal,
      metricIds: [
        "powerstore-fc-port-read-latency",
        "powerstore-fc-port-iops",
        "powerstore-fc-port-crc-errors",
        "powerstore-eth-port-received",
        "powerstore-eth-port-transmitted",
      ],
      groupByObject: true,
    },
    {
      key: "file-systems",
      title: translationKey("File Systems"),
      description: translationKey(
        "How full each file system is, and the ten with the highest latency.",
      ),
      icon: IconProp.Folder,
      metricIds: [
        "powerstore-file-system-used-percent",
        "powerstore-file-system-read-latency",
        "powerstore-file-system-write-latency",
      ],
      groupByObject: true,
    },
    {
      key: "hardware",
      title: translationKey("Hardware"),
      description: translationKey(
        "Write endurance left on each drive: plan the replacement of a drive near 0.",
      ),
      icon: IconProp.CPUChip,
      metricIds: ["powerstore-drive-endurance"],
      groupByObject: true,
    },
  ];

const DellPowerStorePlatform: StorageArrayPlatform = {
  storageSystem: StorageSystem.DellPowerStore,
  displayName: "Dell PowerStore",
  shortName: "PowerStore",
  vendorName: POWERSTORE_VENDOR_NAME,
  aliases: [
    "dell_powerstore",
    "dell-powerstore",
    "dellemc.powerstore",
    "dellemc_powerstore",
    "dellemc-powerstore",
    "emc.powerstore",
    "powerstore",
  ],

  metricPrefix: "powerstore_",
  snapshotMetricNames: [
    // The cluster: its name, id and state, on every minute's scrape.
    "powerstore_cluster",
    // Each appliance: its service tag and its latest performance.
    "powerstore_appliance",
    "powerstore_perf_avg_read_latency",
    "powerstore_perf_avg_write_latency",
    "powerstore_perf_avg_latency",
    "powerstore_perf_avg_read_iops",
    "powerstore_perf_avg_write_iops",
    "powerstore_perf_avg_total_iops",
    "powerstore_perf_avg_read_bandwidth",
    "powerstore_perf_avg_write_bandwidth",
    "powerstore_perf_avg_total_bandwidth",
    "powerstore_perf_avg_io_workload_cpu_utilization",
    "powerstore_perf_avg_io_size",
    // Each appliance's space, from PowerStore's daily rollup.
    "powerstore_cap_last_physical_total",
    "powerstore_cap_last_physical_used",
    "powerstore_cap_last_data_physical_used",
    "powerstore_cap_last_logical_provisioned",
    "powerstore_cap_last_logical_used",
    "powerstore_cap_last_efficiency_ratio",
    "powerstore_cap_last_data_reduction",
    "powerstore_cap_last_snapshot_savings",
    "powerstore_cap_last_thin_savings",
    // Hardware
    "powerstore_hardware_node_state",
    "powerstore_hardware_Drive_state",
    "powerstore_hardware_Fan_state",
    "powerstore_hardware_Power_Supply_state",
    "powerstore_hardware_Battery_state",
    "powerstore_hardware_drive_size",
    "powerstore_wear_metrics_by_drive",
    // Front-end ports
    "powerstore_fc_port_is_link_up",
    "powerstore_fc_port_current_speed",
    "powerstore_eth_port_is_link_up",
    "powerstore_eth_port_current_speed",
    "powerstore_metricFcPort_avg_read_latency",
    "powerstore_metricFcPort_avg_write_latency",
    "powerstore_metricFcPort_avg_total_iops",
    "powerstore_metricFcPort_avg_total_bandwidth",
    "powerstore_metricFcPort_avg_dumped_frames_ps",
    "powerstore_metricFcPort_avg_loss_of_signal_count_ps",
    "powerstore_metricFcPort_avg_invalid_crc_count_ps",
    "powerstore_metricFcPort_avg_loss_of_sync_count_ps",
    "powerstore_metricFcPort_avg_invalid_tx_word_count_ps",
    "powerstore_metricFcPort_avg_prim_seq_prot_err_count_ps",
    "powerstore_metricFcPort_avg_link_failure_count_ps",
    "powerstore_metricEthPort_avg_bytes_rx_ps",
    "powerstore_metricEthPort_avg_bytes_tx_ps",
    "powerstore_metricEthPort_avg_pkt_rx_crc_error_ps",
    "powerstore_metricEthPort_avg_pkt_rx_no_buffer_error_ps",
    "powerstore_metricEthPort_avg_pkt_tx_error_ps",
    // Volumes
    "powerstore_volume_state",
    "powerstore_volume_size",
    "powerstore_volume_logical_used",
    "powerstore_metricVolume_avg_read_latency",
    "powerstore_metricVolume_avg_write_latency",
    "powerstore_metricVolume_avg_read_iops",
    "powerstore_metricVolume_avg_write_iops",
    "powerstore_metricVolume_avg_read_bandwidth",
    "powerstore_metricVolume_avg_write_bandwidth",
    "powerstore_metricVolume_avg_io_size",
    // Volume groups
    "powerstore_volumegroup_logical_provisioned",
    "powerstore_volumegroup_logical_used",
    "powerstore_metricVg_avg_read_latency",
    "powerstore_metricVg_avg_write_latency",
    "powerstore_metricVg_avg_read_iops",
    "powerstore_metricVg_avg_write_iops",
    "powerstore_metricVg_avg_read_bandwidth",
    "powerstore_metricVg_avg_write_bandwidth",
    // NAS servers
    "powerstore_nas_server_operational_status",
    "powerstore_metricNas_avg_read_latency",
    "powerstore_metricNas_avg_write_latency",
    "powerstore_metricNas_avg_read_iops",
    "powerstore_metricNas_avg_write_iops",
    "powerstore_metricNas_avg_read_bandwidth",
    "powerstore_metricNas_avg_write_bandwidth",
    // File systems
    "powerstore_filesystem_logical_provisioned",
    "powerstore_filesystem_logical_used",
    "powerstore_filesystem_thin_savings",
    "powerstore_metricFilesystem_avg_read_latency",
    "powerstore_metricFilesystem_avg_write_latency",
    "powerstore_metricFilesystem_avg_read_iops",
    "powerstore_metricFilesystem_avg_write_iops",
    "powerstore_metricFilesystem_avg_read_bandwidth",
    "powerstore_metricFilesystem_avg_write_bandwidth",
  ],
  /*
   * Each part's path lists every object of its kinds. A kind with no object
   * at all sends no series, so its count is written once it has one. The
   * cluster's own path (its name, state and Metro witnesses, read every
   * minute as the heartbeat) lists no object of a kind.
   */
  scrapeEndpoints: {
    cluster: [],
    appliance: [POWERSTORE_KIND.Appliance],
    capacity: [POWERSTORE_KIND.Appliance],
    hardware: [
      StorageArrayResourceKind.Hardware,
      StorageArrayResourceKind.Drive,
    ],
    port: [StorageArrayResourceKind.NetworkInterface],
    volume: [StorageArrayResourceKind.Volume],
    volumegroup: [POWERSTORE_KIND.VolumeGroup],
    nas: [POWERSTORE_KIND.NasServer],
    file: [StorageArrayResourceKind.FileSystem],
  },

  kinds: [
    POWERSTORE_KIND.Appliance,
    StorageArrayResourceKind.Volume,
    POWERSTORE_KIND.VolumeGroup,
    StorageArrayResourceKind.FileSystem,
    POWERSTORE_KIND.NasServer,
    StorageArrayResourceKind.Hardware,
    StorageArrayResourceKind.Drive,
    StorageArrayResourceKind.NetworkInterface,
  ],
  kindDefinitions: [
    {
      kind: POWERSTORE_KIND.Appliance,
      singularLabel: translationKey("Appliance"),
      pluralLabel: translationKey("Appliances"),
      countLabel: {
        one: translationKey("{{count}} appliance"),
        other: translationKey("{{count}} appliances"),
      },
      icon: IconProp.ServerStack,
      description: translationKey(
        "The appliances of this PowerStore cluster: each one's physical capacity and the share in use, its data reduction, and its latest latency, IOPS and bandwidth.",
      ),
      noItemsMessage: translationKey(
        "No appliances in the inventory yet. They appear here a few minutes after the Storage Array Agent starts reading the cluster.",
      ),
    },
    {
      kind: POWERSTORE_KIND.VolumeGroup,
      singularLabel: translationKey("Volume Group"),
      pluralLabel: translationKey("Volume Groups"),
      countLabel: {
        one: translationKey("{{count}} volume group"),
        other: translationKey("{{count}} volume groups"),
      },
      icon: IconProp.RectangleStack,
      description: translationKey(
        "The volume groups of this PowerStore cluster, with the capacity provisioned to their volumes and their latest performance.",
      ),
      noItemsMessage: translationKey(
        "No volume groups in the inventory yet. They appear here a few minutes after the Storage Array Agent starts reading a cluster that has any.",
      ),
    },
    {
      kind: POWERSTORE_KIND.NasServer,
      singularLabel: translationKey("NAS Server"),
      pluralLabel: translationKey("NAS Servers"),
      countLabel: {
        one: translationKey("{{count}} NAS server"),
        other: translationKey("{{count}} NAS servers"),
      },
      icon: IconProp.FolderOpen,
      description: translationKey(
        "The NAS servers of this PowerStore cluster, which serve its file systems over NFS and SMB: whether each is started, and its latest performance.",
      ),
      noItemsMessage: translationKey(
        "No NAS servers in the inventory yet. They appear here a few minutes after the Storage Array Agent starts reading a cluster that serves files.",
      ),
    },
  ],
  // The physical parts: a node, fan, power supply or battery, and a drive.
  hardwareKinds: [
    StorageArrayResourceKind.Hardware,
    StorageArrayResourceKind.Drive,
  ],
  metricFamilies: [
    { prefix: "powerstore_cluster", kind: null },
    { prefix: "powerstore_metro_", kind: null },
    { prefix: "powerstore_appliance", kind: POWERSTORE_KIND.Appliance },
    { prefix: "powerstore_perf_", kind: POWERSTORE_KIND.Appliance },
    { prefix: "powerstore_cap_", kind: POWERSTORE_KIND.Appliance },
    {
      prefix: "powerstore_hardware_Drive_",
      kind: StorageArrayResourceKind.Drive,
    },
    {
      prefix: "powerstore_hardware_drive_",
      kind: StorageArrayResourceKind.Drive,
    },
    { prefix: "powerstore_wear_", kind: StorageArrayResourceKind.Drive },
    { prefix: "powerstore_hardware_", kind: StorageArrayResourceKind.Hardware },
    {
      prefix: "powerstore_fc_port_",
      kind: StorageArrayResourceKind.NetworkInterface,
    },
    {
      prefix: "powerstore_eth_port_",
      kind: StorageArrayResourceKind.NetworkInterface,
    },
    {
      prefix: "powerstore_metricFcPort_",
      kind: StorageArrayResourceKind.NetworkInterface,
    },
    {
      prefix: "powerstore_metricEthPort_",
      kind: StorageArrayResourceKind.NetworkInterface,
    },
    { prefix: "powerstore_volumegroup_", kind: POWERSTORE_KIND.VolumeGroup },
    { prefix: "powerstore_metricVg_", kind: POWERSTORE_KIND.VolumeGroup },
    { prefix: "powerstore_volume_", kind: StorageArrayResourceKind.Volume },
    {
      prefix: "powerstore_metricVolume_",
      kind: StorageArrayResourceKind.Volume,
    },
    { prefix: "powerstore_nas_server_", kind: POWERSTORE_KIND.NasServer },
    { prefix: "powerstore_metricNas_", kind: POWERSTORE_KIND.NasServer },
    {
      prefix: "powerstore_filesystem_",
      kind: StorageArrayResourceKind.FileSystem,
    },
    {
      prefix: "powerstore_metricFilesystem_",
      kind: StorageArrayResourceKind.FileSystem,
    },
  ],
  componentStatuses: POWERSTORE_COMPONENT_STATUSES,
  /*
   * The exporter names a volume, file system and hardware part `name` on
   * their state and space series; their performance series carry a label
   * of their own, which each catalog entry names (objectLabel).
   */
  objectLabels: {
    [StorageArrayResourceScope.Volume]: "name",
    [StorageArrayResourceScope.Hardware]: "name",
    [StorageArrayResourceScope.FileSystem]: "name",
  },

  metrics: POWERSTORE_METRICS,
  /*
   * powerstore_cluster: one series (the cluster's name, id and address as
   * labels) on every minute's scrape of a cluster the exporter can reach,
   * whatever state the cluster is in.
   */
  heartbeat: {
    templateId: "powerstore-array-stopped-reporting",
    metricName: "powerstore_cluster",
  },
  alertTemplates: POWERSTORE_ALERT_TEMPLATES,
  logAlertTemplates: POWERSTORE_LOG_ALERT_TEMPLATES,
  resourceFilters: [
    {
      key: "volumeName",
      description: translationKey(
        "Filter to one PowerStore volume — its name, the `name` label of the powerstore_volume_* series and `volume_id` of the powerstore_metricVolume_* series (optional).",
      ),
    },
    {
      key: "componentName",
      description: translationKey(
        "Filter to one PowerStore part — the `name` label of a node, drive, fan, power supply or battery, `fc_port_id` or `eth_port_id` of a port (optional).",
      ),
    },
    {
      key: "fileSystemName",
      description: translationKey(
        "Filter to one PowerStore file system — the `name` label of the powerstore_filesystem_* series (optional).",
      ),
    },
  ],

  overview: {
    goldenCharts: {
      readLatency: "powerstore-appliance-read-latency",
      writeLatency: "powerstore-appliance-write-latency",
      readIops: "powerstore-appliance-read-iops",
      writeIops: "powerstore-appliance-write-iops",
      readBandwidth: "powerstore-appliance-read-bandwidth",
      writeBandwidth: "powerstore-appliance-write-bandwidth",
      capacityUsed: "powerstore-appliance-used-percent",
      capacityUsedDescription: translationKey(
        "Share of each appliance's physical capacity in use, from PowerStore's daily space rollup. PowerStore raises its own capacity alerts at 70%, 80%, 90% and 95%.",
      ),
    },
    countChips: [
      { kind: POWERSTORE_KIND.Appliance, showWhenZero: true },
      { kind: StorageArrayResourceKind.Volume, showWhenZero: true },
      // A cluster that serves no files has no file systems to count.
      { kind: StorageArrayResourceKind.FileSystem, showWhenZero: false },
    ],
    inventoryTile: {
      kind: StorageArrayResourceKind.Volume,
      sublabelKind: POWERSTORE_KIND.Appliance,
    },
    listCounts: [POWERSTORE_KIND.Appliance, StorageArrayResourceKind.Volume],
    topKind: StorageArrayResourceKind.Volume,
  },
  insightsSections: POWERSTORE_INSIGHTS_SECTIONS,
  hardwareTables: [
    {
      kind: StorageArrayResourceKind.Hardware,
      layout: "default",
      tableId: "storage-array-powerstore-parts-table",
      description: translationKey(
        "The nodes of each appliance, and their fans, power supplies and battery backup modules, with the state PowerStore reports for each.",
      ),
      noItemsMessage: translationKey(
        "No hardware components in the inventory yet. They appear here a few minutes after the Storage Array Agent starts reading the cluster.",
      ),
      groupColumnTitle: translationKey("Appliance"),
    },
    {
      kind: StorageArrayResourceKind.Drive,
      layout: "default",
      tableId: "storage-array-powerstore-drives-table",
      description: translationKey(
        "The NVMe SSDs and NVRAM drives of each appliance, with their raw capacity, the endurance they have left and the state PowerStore reports for each.",
      ),
      noItemsMessage: translationKey(
        "No drives in the inventory yet. They appear here a few minutes after the Storage Array Agent starts reading the cluster.",
      ),
      groupColumnTitle: translationKey("Appliance"),
    },
    {
      kind: StorageArrayResourceKind.NetworkInterface,
      layout: "default",
      tableId: "storage-array-powerstore-ports-table",
      description: translationKey(
        "The Fibre Channel and Ethernet front-end ports of each node: whether its link is up, its speed, the traffic it carries and the errors it sees. A port nothing is cabled to is down.",
      ),
      noItemsMessage: translationKey(
        "No ports in the inventory yet. They appear here a few minutes after the Storage Array Agent starts reading the cluster.",
      ),
      groupColumnTitle: translationKey("Appliance"),
    },
  ],

  agentConfigs: [
    {
      key: "powerstore",
      label: translationKey("PowerStore"),
      description: translationKey(
        "The agent runs Dell's PowerStore exporter next to it, and takes the cluster's syslog for its alerts.",
      ),
      collectorConfigFile: "otel-collector-config.powerstore.yaml",
      composeProfile: "powerstore",
      endpointVariable: "POWERSTORE_ENDPOINT",
      userVariable: "POWERSTORE_USERNAME",
      tokenVariable: "POWERSTORE_PASSWORD",
      exampleEndpoint: "powerstore-01.example.com",
      exporterService: "powerstore-exporter",
      arrayNoun: "PowerStore",
      otherFiles: ["powerstore-exporter.Dockerfile", "powerstore-syslog.yaml"],
    },
  ],
};

export default DellPowerStorePlatform;
