import IconProp from "../../../../Icon/IconProp";
import { StorageArrayResourceScope } from "../../../../Monitor/MonitorStepStorageArrayMonitor";
import { translationKey } from "../../../../Translator";
import StorageArrayResourceKind from "../../../StorageArrayResourceKind";
import StorageSystem from "../../../StorageSystem";
import {
  STORAGE_ARRAY_COMPONENT_STATUSES,
  StorageArrayInsightsSection,
  StorageArrayOpenProblemSeries,
  StorageArrayPlatform,
} from "../../../StorageArrayPlatform";
import {
  NETAPP_METRIC_PREFIX,
  NETAPP_VENDOR_NAME,
  ONTAP_FSX_HARDWARE_NOTE,
  ONTAP_FSX_OS_NAME,
  OntapKind,
} from "../NetApp";
import ONTAP_METRICS from "./OntapMetrics";
import ONTAP_ALERT_TEMPLATES, {
  ONTAP_LATENCY_WARNING_USEC,
} from "./OntapAlertTemplates";
import ONTAP_KIND_PAGES from "./OntapKindPages";
import { ONTAP_UNIT_RULES } from "./OntapUnits";

/*
 * NETAPP ONTAP (#11001): AFF, FAS and ASA clusters, ONTAP Select, Cloud
 * Volumes ONTAP and Amazon FSx for NetApp ONTAP, read through NetApp
 * Harvest 26.11, which the Storage Array Agent runs beside its collector
 * (agents/StorageArrayAgent/netapp-harvest*.yml). Harvest reads ONTAP's
 * REST API (9.12.1 and later) with a read-only user: its Rest collector
 * the configuration every 3 minutes, KeyPerf and RestPerf the performance
 * every minute, Ems the EMS events every 3 minutes. Everything comes from
 * one scrape of Harvest, and Harvest's own netapp_metadata_* series say
 * which objects it could read, which is how a batch knows the complete
 * list of a kind (OntapExtractor).
 *
 * A cluster's own words: nodes (Controllers), aggregates, SVMs, volumes,
 * LUNs, disks (Drives), shelves and their parts and the nodes' sensors
 * (Hardware), Ethernet and Fibre Channel ports (Network Interfaces) and
 * SnapMirror relationships. Its open problems are what ONTAP reports open
 * (Harvest's Health plugin: netapp_health_*_alerts), the same shape as
 * Pure's open alerts. Its extractor is
 * Common/Server/Utils/Telemetry/StorageArray/NetApp/OntapExtractor.
 */

/*
 * The problems ONTAP reports open, each on a series of its own (Harvest's
 * Health plugin): one series per problem, value 1 while ONTAP reports it.
 * Harvest writes severity error or warning on each.
 */
const ONTAP_OPEN_PROBLEMS: ReadonlyArray<StorageArrayOpenProblemSeries> = [
  {
    metricName: "netapp_health_disk_alerts",
    summary: translationKey("Disk {{disk}} is {{container_type}}"),
    keyLabels: ["disk"],
    componentLabel: "disk",
    severityLabel: "severity",
    criticalSeverities: ["error"],
  },
  {
    metricName: "netapp_health_shelf_alerts",
    summary: translationKey("Shelf {{shelf}}: {{error_text}}"),
    keyLabels: ["shelf", "error_type"],
    componentLabel: "shelf",
    severityLabel: "severity",
    criticalSeverities: ["error"],
  },
  {
    metricName: "netapp_health_node_alerts",
    summary: translationKey("Node {{node}} is not healthy"),
    keyLabels: ["node"],
    componentLabel: "node",
    severityLabel: "severity",
    criticalSeverities: ["error"],
  },
  {
    metricName: "netapp_health_ha_alerts",
    summary: translationKey(
      "Node {{node}} cannot take over {{partner}}: {{state_description}}",
    ),
    keyLabels: ["node"],
    componentLabel: "node",
    severityLabel: "severity",
    criticalSeverities: ["error"],
  },
  {
    metricName: "netapp_health_network_ethernet_port_alerts",
    summary: translationKey("Port {{port}} on {{node}} is down"),
    keyLabels: ["node", "port"],
    componentLabel: "port",
    severityLabel: "severity",
    criticalSeverities: ["error"],
  },
  {
    metricName: "netapp_health_network_fc_port_alerts",
    summary: translationKey("FC port {{port}} on {{node}} is {{state}}"),
    keyLabels: ["node", "port"],
    componentLabel: "port",
    severityLabel: "severity",
    criticalSeverities: ["error"],
  },
  {
    metricName: "netapp_health_support_alerts",
    summary: translationKey("{{name}}: {{reason}}"),
    keyLabels: ["node", "name", "resource"],
    componentLabel: "resource",
    severityLabel: "severity",
    criticalSeverities: ["error"],
  },
  {
    metricName: "netapp_health_lif_alerts",
    summary: translationKey("LIF {{lif}} of {{svm}} is not on its home port"),
    keyLabels: ["svm", "lif"],
    componentLabel: "lif",
    severityLabel: "severity",
    criticalSeverities: ["error"],
  },
  {
    metricName: "netapp_health_volume_move_alerts",
    summary: translationKey(
      "Moving volume {{volume}} of {{svm}}: {{movement_state}}",
    ),
    keyLabels: ["svm", "volume"],
    componentLabel: "volume",
    severityLabel: "severity",
    criticalSeverities: ["error"],
  },
  {
    metricName: "netapp_health_volume_ransomware_alerts",
    summary: translationKey(
      "Volume {{volume}}: ransomware attack probability {{anti_ransomware_attack_probability}}",
    ),
    keyLabels: ["volume"],
    componentLabel: "volume",
    severityLabel: "severity",
    criticalSeverities: ["error"],
  },
  {
    metricName: "netapp_health_license_alerts",
    summary: translationKey("License {{name}} is {{state}}"),
    keyLabels: ["name"],
    componentLabel: "name",
    severityLabel: "severity",
    criticalSeverities: ["error"],
  },
];

// The Resource Usage page's cards, in order.
export const ONTAP_INSIGHTS_SECTIONS: Array<StorageArrayInsightsSection> = [
  {
    key: "capacity",
    title: translationKey("Capacity"),
    description: translationKey(
      "How full each aggregate is, the space each has left and its inodes in use.",
    ),
    icon: IconProp.ChartBar,
    metricIds: [
      "netapp-aggr-used-percent",
      "netapp-aggr-free",
      "netapp-aggr-inode-used-percent",
    ],
    groupByObject: true,
  },
  {
    key: "performance",
    title: translationKey("Performance"),
    description: translationKey(
      "Latency, operations and bandwidth across the whole cluster, as clients see them.",
    ),
    icon: IconProp.Signal,
    metricIds: [
      "netapp-cluster-read-latency",
      "netapp-cluster-write-latency",
      "netapp-cluster-total-iops",
      "netapp-cluster-read-bandwidth",
      "netapp-cluster-write-bandwidth",
    ],
  },
  {
    key: "nodes",
    title: translationKey("Nodes"),
    description: translationKey(
      "How busy each node's processors are: a node past about 80% has little room left to take over its partner.",
    ),
    icon: IconProp.ServerStack,
    metricIds: ["netapp-node-cpu-busy"],
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
      "netapp-volume-read-latency",
      "netapp-volume-write-latency",
      "netapp-volume-read-iops",
      "netapp-volume-write-iops",
    ],
    groupByObject: true,
  },
  {
    key: "luns",
    title: translationKey("LUNs"),
    description: translationKey(
      "The ten LUNs with the highest latency, as their hosts wait for them.",
    ),
    icon: IconProp.Cube,
    metricIds: ["netapp-lun-read-latency", "netapp-lun-write-latency"],
    groupByObject: true,
  },
  {
    key: "replication",
    title: translationKey("Replication"),
    description: translationKey(
      "How far each SnapMirror relationship's destination is behind its source.",
    ),
    icon: IconProp.ArrowPath,
    metricIds: ["netapp-snapmirror-lag"],
    groupByObject: true,
  },
  {
    key: "network",
    title: translationKey("Ports"),
    description: translationKey(
      "How much of each Ethernet and Fibre Channel port's speed is in use, and the Fibre Channel ports' link failures.",
    ),
    icon: IconProp.Signal,
    metricIds: [
      "netapp-port-utilization",
      "netapp-fc-port-utilization",
      "netapp-fc-port-link-failures",
    ],
    groupByObject: true,
  },
];

const NetAppOntapPlatform: StorageArrayPlatform = {
  storageSystem: StorageSystem.NetAppOntap,
  displayName: "NetApp ONTAP",
  shortName: "ONTAP",
  vendorName: NETAPP_VENDOR_NAME,
  aliases: [
    "netapp_ontap",
    "netapp-ontap",
    "netapp.cdot",
    "netapp.fas",
    "netapp.aff",
    "netapp.fsx",
    "aws.fsx_ontap",
    "ontap",
  ],

  metricPrefix: NETAPP_METRIC_PREFIX,
  snapshotMetricNames: [
    // Harvest's own: which objects it read, and how many of each.
    "netapp_metadata_component_status",
    "netapp_metadata_collector_instances",
    // The cluster: its health (the heartbeat) and performance.
    "netapp_cluster_new_status",
    "netapp_cluster_read_ops",
    // Nodes
    "netapp_node_labels",
    "netapp_node_new_status",
    "netapp_node_avg_processor_busy",
    "netapp_node_failed_fan",
    "netapp_node_failed_power",
    "netapp_node_uptime",
    // Aggregates: the cluster's capacity and data reduction are theirs.
    "netapp_aggr_labels",
    "netapp_aggr_new_status",
    "netapp_aggr_space_total",
    "netapp_aggr_space_used",
    "netapp_aggr_space_available",
    "netapp_aggr_inode_used_percent",
    "netapp_aggr_logical_used_wo_snapshots_flexclones",
    "netapp_aggr_physical_used_wo_snapshots_flexclones",
    "netapp_aggr_read_latency",
    "netapp_aggr_write_latency",
    "netapp_aggr_read_ops",
    "netapp_aggr_write_ops",
    "netapp_aggr_read_data",
    "netapp_aggr_write_data",
    // SVMs
    "netapp_svm_labels",
    "netapp_svm_new_status",
    "netapp_svm_vol_read_latency",
    "netapp_svm_vol_write_latency",
    "netapp_svm_vol_read_ops",
    "netapp_svm_vol_write_ops",
    "netapp_svm_vol_read_data",
    "netapp_svm_vol_write_data",
    // Volumes
    "netapp_volume_labels",
    "netapp_volume_new_status",
    "netapp_volume_size_total",
    "netapp_volume_size_used",
    "netapp_volume_size_available",
    "netapp_volume_size_used_percent",
    "netapp_volume_snapshots_size_used",
    "netapp_volume_sis_total_saved_percent",
    "netapp_volume_read_latency",
    "netapp_volume_write_latency",
    "netapp_volume_read_ops",
    "netapp_volume_write_ops",
    "netapp_volume_read_data",
    "netapp_volume_write_data",
    // LUNs
    "netapp_lun_labels",
    "netapp_lun_new_status",
    "netapp_lun_size",
    "netapp_lun_size_used",
    "netapp_lun_avg_read_latency",
    "netapp_lun_avg_write_latency",
    "netapp_lun_read_ops",
    "netapp_lun_write_ops",
    "netapp_lun_read_data",
    "netapp_lun_write_data",
    // Disks
    "netapp_disk_labels",
    "netapp_disk_new_status",
    "netapp_disk_usable_size",
    // Shelves and their parts
    "netapp_shelf_labels",
    "netapp_shelf_new_status",
    "netapp_shelf_disk_count",
    "netapp_shelf_psu_status",
    "netapp_shelf_psu_labels",
    "netapp_shelf_fan_status",
    "netapp_shelf_fan_labels",
    "netapp_shelf_fan_rpm",
    "netapp_shelf_temperature_status",
    "netapp_shelf_temperature_labels",
    "netapp_shelf_temperature_reading",
    "netapp_shelf_voltage_status",
    "netapp_shelf_voltage_labels",
    "netapp_shelf_module_status",
    "netapp_shelf_module_labels",
    // A shelf's current sensors.
    "netapp_shelf_sensor_status",
    "netapp_shelf_sensor_labels",
    // The nodes' environment sensors
    "netapp_environment_sensor_status",
    "netapp_environment_sensor_threshold_value",
    // Ethernet ports
    "netapp_net_port_status",
    "netapp_nic_rx_bytes",
    "netapp_nic_tx_bytes",
    "netapp_nic_util_percent",
    "netapp_nic_rx_total_errors",
    "netapp_nic_tx_total_errors",
    // Fibre Channel ports
    "netapp_fcp_labels",
    "netapp_fcp_read_data",
    "netapp_fcp_write_data",
    "netapp_fcp_util_percent",
    "netapp_fcp_link_failure",
    // SnapMirror
    "netapp_snapmirror_labels",
    "netapp_snapmirror_lag_time",
    "netapp_snapmirror_schedule_seconds",
    "netapp_snapmirror_last_transfer_size",
    "netapp_snapmirror_last_transfer_duration",
    // What ONTAP reports open (ONTAP_OPEN_PROBLEMS)
    ...ONTAP_OPEN_PROBLEMS.map((problem: StorageArrayOpenProblemSeries) => {
      return problem.metricName;
    }),
  ],
  unitRules: ONTAP_UNIT_RULES,
  /*
   * Harvest serves everything on one endpoint, read by one job labelled
   * `scrape_endpoint: harvest`. Which kinds a batch lists in full is
   * Harvest's to say, object by object (its netapp_metadata_* series), not
   * the job's: an object Harvest has not read yet, or could not read, is
   * no list of nothing.
   */
  scrapeEndpoints: {},
  // Every kind, each once Harvest listed all its objects (OntapExtractor).
  exporterCompletedKinds: [
    StorageArrayResourceKind.Volume,
    OntapKind.Aggregate,
    OntapKind.Svm,
    OntapKind.Lun,
    OntapKind.SnapMirror,
    StorageArrayResourceKind.Controller,
    StorageArrayResourceKind.Drive,
    StorageArrayResourceKind.Hardware,
    StorageArrayResourceKind.NetworkInterface,
  ],

  /*
   * In the order the side menu lists the cluster's own kinds after its
   * volumes: the aggregates that hold them, the SVMs that serve them, the
   * LUNs carved from them, and where they are replicated.
   */
  kinds: [
    StorageArrayResourceKind.Volume,
    OntapKind.Aggregate,
    OntapKind.Svm,
    OntapKind.Lun,
    OntapKind.SnapMirror,
    StorageArrayResourceKind.Controller,
    StorageArrayResourceKind.Drive,
    StorageArrayResourceKind.Hardware,
    StorageArrayResourceKind.NetworkInterface,
  ],
  kindDefinitions: [
    {
      kind: OntapKind.Aggregate,
      singularLabel: translationKey("Aggregate"),
      pluralLabel: translationKey("Aggregates"),
      countLabel: {
        one: translationKey("{{count}} aggregate"),
        other: translationKey("{{count}} aggregates"),
      },
      icon: IconProp.Layers,
      description: translationKey(
        "The aggregates of this cluster: the RAID groups of disks each node's volumes are carved from, how full each is and how busy.",
      ),
      noItemsMessage: translationKey(
        "No aggregates in the inventory yet. They appear here a few minutes after the Storage Array Agent starts reading the cluster.",
      ),
    },
    {
      kind: OntapKind.Svm,
      singularLabel: translationKey("SVM"),
      pluralLabel: translationKey("SVMs"),
      countLabel: {
        one: translationKey("{{count}} SVM"),
        other: translationKey("{{count}} SVMs"),
      },
      icon: IconProp.ServerStack,
      description: translationKey(
        "The storage VMs (SVMs) of this cluster: each serves its own volumes and LUNs over NFS, SMB, iSCSI, FC or NVMe, with the latency its clients see.",
      ),
      noItemsMessage: translationKey(
        "No SVMs in the inventory yet. They appear here a few minutes after the Storage Array Agent starts reading the cluster.",
      ),
    },
    {
      kind: OntapKind.Lun,
      singularLabel: translationKey("LUN"),
      pluralLabel: translationKey("LUNs"),
      countLabel: {
        one: translationKey("{{count}} LUN"),
        other: translationKey("{{count}} LUNs"),
      },
      icon: IconProp.Cube,
      description: translationKey(
        "The LUNs of this cluster: the block devices its SVMs serve to hosts over iSCSI or Fibre Channel, the volume each is carved from, how full each is and the latency its hosts see.",
      ),
      noItemsMessage: translationKey(
        "No LUNs in the inventory. They appear here a few minutes after the Storage Array Agent starts reading the cluster, if it serves any.",
      ),
    },
    {
      kind: OntapKind.SnapMirror,
      singularLabel: translationKey("SnapMirror Relationship"),
      pluralLabel: translationKey("SnapMirror Relationships"),
      countLabel: {
        one: translationKey("{{count}} SnapMirror relationship"),
        other: translationKey("{{count}} SnapMirror relationships"),
      },
      icon: IconProp.ArrowPath,
      description: translationKey(
        "The SnapMirror relationships this cluster is the destination of: how far each copy is behind its source, its schedule, and whether ONTAP reports it healthy.",
      ),
      noItemsMessage: translationKey(
        "No SnapMirror relationships in the inventory. They appear here a few minutes after the Storage Array Agent starts reading the cluster, if it is the destination of any.",
      ),
    },
  ],
  metricFamilies: [
    // The open problems name their part: a broken disk is a Drive.
    { prefix: "netapp_health_disk_", kind: StorageArrayResourceKind.Drive },
    { prefix: "netapp_health_shelf_", kind: StorageArrayResourceKind.Hardware },
    {
      prefix: "netapp_health_node_",
      kind: StorageArrayResourceKind.Controller,
    },
    { prefix: "netapp_health_ha_", kind: StorageArrayResourceKind.Controller },
    {
      prefix: "netapp_health_network_",
      kind: StorageArrayResourceKind.NetworkInterface,
    },
    { prefix: "netapp_health_volume_", kind: StorageArrayResourceKind.Volume },
    // Every other open problem (a system health alert, a license) names none.
    { prefix: "netapp_health_", kind: null },
    // The cluster itself, its EMS events and Harvest's own series.
    { prefix: "netapp_cluster_", kind: null },
    { prefix: "netapp_ems_", kind: null },
    { prefix: "netapp_metadata_", kind: null },
    { prefix: "netapp_volume_", kind: StorageArrayResourceKind.Volume },
    { prefix: "netapp_lun_", kind: OntapKind.Lun },
    { prefix: "netapp_aggr_", kind: OntapKind.Aggregate },
    { prefix: "netapp_svm_", kind: OntapKind.Svm },
    { prefix: "netapp_snapmirror_", kind: OntapKind.SnapMirror },
    { prefix: "netapp_node_", kind: StorageArrayResourceKind.Controller },
    { prefix: "netapp_disk_", kind: StorageArrayResourceKind.Drive },
    { prefix: "netapp_shelf_", kind: StorageArrayResourceKind.Hardware },
    {
      prefix: "netapp_environment_sensor_",
      kind: StorageArrayResourceKind.Hardware,
    },
    {
      prefix: "netapp_net_port_",
      kind: StorageArrayResourceKind.NetworkInterface,
    },
    { prefix: "netapp_nic_", kind: StorageArrayResourceKind.NetworkInterface },
    { prefix: "netapp_fcp_", kind: StorageArrayResourceKind.NetworkInterface },
  ],
  /*
   * The extractor writes ONTAP's own words for a part's state: an
   * aggregate or volume online or offline, an SVM running or stopped, a
   * disk broken or spare, a shelf part normal or in error, a sensor's
   * threshold state, a port up or down, a node healthy or not.
   */
  componentStatuses: {
    critical: [
      ...STORAGE_ARRAY_COMPONENT_STATUSES.critical,
      "offline",
      "inconsistent",
      "broken",
      "error",
      "down",
      "offlined_by_system",
    ],
    warning: [
      ...STORAGE_ARRAY_COMPONENT_STATUSES.warning,
      "restricted",
      "unmounted",
      "relocating",
      "onlining",
      "offlining",
      "mixed",
      "stopped",
      "starting",
      "stopping",
      "unassigned",
      // A node sensor past its warning threshold (OntapExtractor's word).
      "warning",
      "link_not_connected",
    ],
    healthy: ["online", "running", "up", "normal", "healthy", "spare"],
  },
  objectLabels: {
    [StorageArrayResourceScope.Volume]: "volume",
    [StorageArrayResourceScope.Hardware]: "node",
  },
  managedDeployments: [
    {
      osName: ONTAP_FSX_OS_NAME,
      kinds: [
        StorageArrayResourceKind.Drive,
        StorageArrayResourceKind.Hardware,
      ],
      note: ONTAP_FSX_HARDWARE_NOTE,
    },
  ],

  metrics: ONTAP_METRICS,
  /*
   * Harvest re-exports the cluster's health on every scrape while it can
   * read the cluster (it keeps an object's latest poll for five minutes),
   * and stops once it cannot: the agent stopped, or the cluster stopped
   * answering it.
   */
  heartbeat: {
    templateId: "netapp-cluster-stopped-reporting",
    metricName: "netapp_cluster_new_status",
  },
  alertTemplates: ONTAP_ALERT_TEMPLATES,
  resourceFilters: [
    {
      key: "volumeName",
      description: translationKey(
        "Filter to one ONTAP volume — the `volume` label of the netapp_volume_* series (optional). Two SVMs can each have a volume of one name: the filter matches both.",
      ),
    },
    {
      key: "componentName",
      description: translationKey(
        "Filter to one node, disk, shelf or port — the node, disk, shelf or port label the series names it by (optional).",
      ),
    },
  ],

  overview: {
    goldenCharts: {
      readLatency: "netapp-cluster-read-latency",
      writeLatency: "netapp-cluster-write-latency",
      readIops: "netapp-cluster-read-iops",
      writeIops: "netapp-cluster-write-iops",
      readBandwidth: "netapp-cluster-read-bandwidth",
      writeBandwidth: "netapp-cluster-write-bandwidth",
      capacityUsed: "netapp-aggr-used-percent",
      capacityUsedDescription: translationKey(
        "Share of each aggregate's usable space in use: the fullest one is what fills first. OneUptime's Aggregate Above 80% and 90% alerts fire at its lines.",
      ),
    },
    openProblems: ONTAP_OPEN_PROBLEMS,
    alertDetailsUnavailable: translationKey(
      "Open problem details are unavailable right now. Run system health alert show on the cluster, or open System Manager's dashboard, for the full list.",
    ),
    countChips: [
      { kind: StorageArrayResourceKind.Volume, showWhenZero: true },
      { kind: OntapKind.Aggregate, showWhenZero: true },
      { kind: OntapKind.Svm, showWhenZero: true },
      // A NAS-only cluster has no LUNs, and one not replicated no SnapMirror.
      { kind: OntapKind.Lun, showWhenZero: false },
      { kind: OntapKind.SnapMirror, showWhenZero: false },
    ],
    inventoryTile: {
      kind: StorageArrayResourceKind.Volume,
      sublabelKind: OntapKind.Aggregate,
    },
    listCounts: [StorageArrayResourceKind.Volume, OntapKind.Aggregate],
    topKind: StorageArrayResourceKind.Volume,
    /*
     * The cluster's average latency, as the High Read and High Write
     * Latency alerts read it: both turn Warning past 10 ms.
     */
    latency: {
      readMetricName: "netapp_cluster_read_latency",
      writeMetricName: "netapp_cluster_write_latency",
      readWarningUsec: ONTAP_LATENCY_WARNING_USEC,
      writeWarningUsec: ONTAP_LATENCY_WARNING_USEC,
    },
  },
  insightsSections: ONTAP_INSIGHTS_SECTIONS,
  hardwareTables: [
    {
      kind: StorageArrayResourceKind.Controller,
      layout: "default",
      tableId: "storage-array-ontap-nodes-table",
      words: {
        title: translationKey("Nodes"),
        singularName: translationKey("Node"),
        pluralName: translationKey("Nodes"),
      },
      description: translationKey(
        "The nodes of this cluster: their health, model and ONTAP version, their HA partner, how busy they are, and any failed fan or power supply.",
      ),
      noItemsMessage: translationKey(
        "No nodes in the inventory yet. They appear here a few minutes after the Storage Array Agent starts reading the cluster.",
      ),
      columns: [
        { type: "status", title: translationKey("Status") },
        {
          type: "value",
          id: "model",
          title: translationKey("Model"),
          value: { column: "model", format: "text" },
        },
        {
          type: "value",
          id: "version",
          title: translationKey("Version"),
          value: { column: "firmwareVersion", format: "text" },
        },
        {
          type: "value",
          id: "ha-partner",
          title: translationKey("HA Partner"),
          description: translationKey(
            "The node that takes over this one's storage if it fails, and gives it back once it is up.",
          ),
          value: { detail: "haPartner", format: "text" },
        },
        {
          type: "value",
          id: "cpu-busy",
          title: translationKey("CPU Busy"),
          value: { detail: "cpuBusyPercent", format: "percent" },
        },
        {
          type: "value",
          id: "failed-fans",
          title: translationKey("Failed Fans"),
          value: { detail: "failedFans", format: "count" },
        },
        {
          type: "value",
          id: "failed-power-supplies",
          title: translationKey("Failed Power Supplies"),
          value: { detail: "failedPowerSupplies", format: "count" },
        },
        {
          type: "value",
          id: "uptime",
          title: translationKey("Uptime"),
          value: { detail: "uptimeSeconds", format: "durationSeconds" },
          hiddenByDefault: true,
        },
        { type: "lastSeen" },
      ],
    },
    {
      kind: StorageArrayResourceKind.Drive,
      layout: "default",
      tableId: "storage-array-ontap-disks-table",
      words: {
        title: translationKey("Disks"),
        singularName: translationKey("Disk"),
        pluralName: translationKey("Disks"),
      },
      description: translationKey(
        "The disks of this cluster: what each is used for (aggregate, spare, broken), its size, the shelf bay it sits in and the node that owns it.",
      ),
      noItemsMessage: translationKey(
        "No disks in the inventory yet. They appear here a few minutes after the Storage Array Agent starts reading the cluster.",
      ),
      columns: [
        { type: "status", title: translationKey("Status") },
        {
          type: "value",
          id: "container-type",
          title: translationKey("Used As"),
          description: translationKey(
            "What ONTAP uses the disk for: aggregate, shared, spare, broken, unassigned.",
          ),
          value: { detail: "containerType", format: "status" },
        },
        {
          type: "value",
          id: "capacity",
          title: translationKey("Capacity"),
          value: { column: "capacityBytes", format: "bytes" },
        },
        {
          type: "value",
          id: "type",
          title: translationKey("Type"),
          value: { column: "componentType", format: "text" },
        },
        {
          type: "value",
          id: "shelf-bay",
          title: translationKey("Shelf / Bay"),
          value: { detail: "shelfBay", format: "text" },
        },
        {
          type: "value",
          id: "owner",
          title: translationKey("Owner"),
          value: { detail: "ownerNode", format: "text" },
        },
        {
          type: "value",
          id: "model",
          title: translationKey("Model"),
          value: { column: "model", format: "text" },
          hiddenByDefault: true,
        },
        { type: "lastSeen" },
      ],
    },
    {
      kind: StorageArrayResourceKind.Hardware,
      layout: "default",
      tableId: "storage-array-ontap-shelves-table",
      words: {
        title: translationKey("Shelves"),
        singularName: translationKey("Shelf"),
        pluralName: translationKey("Shelves"),
      },
      componentTypes: ["Shelf"],
      description: translationKey(
        "The disk shelves of this cluster, with their model, modules and the state ONTAP reports for each.",
      ),
      noItemsMessage: translationKey(
        "No shelves in the inventory yet. They appear here a few minutes after the Storage Array Agent starts reading the cluster.",
      ),
      columns: [
        { type: "status", title: translationKey("Status") },
        {
          type: "value",
          id: "model",
          title: translationKey("Model"),
          value: { column: "model", format: "text" },
        },
        {
          type: "value",
          id: "module-type",
          title: translationKey("Module Type"),
          value: { detail: "moduleType", format: "text" },
        },
        {
          type: "value",
          id: "disks",
          title: translationKey("Disks"),
          value: { detail: "diskCount", format: "count" },
        },
        { type: "lastSeen" },
      ],
    },
    {
      kind: StorageArrayResourceKind.Hardware,
      layout: "default",
      tableId: "storage-array-ontap-shelf-parts-table",
      words: {
        title: translationKey("Shelf Parts"),
        singularName: translationKey("Shelf Part"),
        pluralName: translationKey("Shelf Parts"),
      },
      componentTypes: [
        "Power Supply",
        "Fan",
        "Temperature Sensor",
        "Voltage Sensor",
        "Current Sensor",
        "Module",
      ],
      description: translationKey(
        "The power supplies, fans, modules and sensors of each disk shelf, with the state ONTAP reports for each.",
      ),
      noItemsMessage: translationKey(
        "No shelf parts in the inventory yet. They appear here a few minutes after the Storage Array Agent starts reading the cluster.",
      ),
      columns: [
        {
          type: "value",
          id: "type",
          title: translationKey("Type"),
          value: { column: "componentType", format: "text" },
        },
        { type: "status", title: translationKey("Status") },
        {
          type: "value",
          id: "shelf",
          title: translationKey("Shelf"),
          value: { column: "groupName", format: "text" },
        },
        {
          type: "value",
          id: "temperature",
          title: translationKey("Temperature"),
          value: { column: "temperatureCelsius", format: "celsius" },
        },
        { type: "lastSeen" },
      ],
    },
    {
      kind: StorageArrayResourceKind.Hardware,
      layout: "default",
      tableId: "storage-array-ontap-sensors-table",
      words: {
        title: translationKey("Node Sensors"),
        singularName: translationKey("Node Sensor"),
        pluralName: translationKey("Node Sensors"),
      },
      componentTypes: ["Sensor"],
      description: translationKey(
        "The environment sensors of each node: temperatures, voltages, fan speeds and batteries, with their reading against ONTAP's thresholds.",
      ),
      noItemsMessage: translationKey(
        "No node sensors in the inventory yet. They appear here a few minutes after the Storage Array Agent starts reading the cluster.",
      ),
      columns: [
        { type: "status", title: translationKey("Status") },
        {
          type: "value",
          id: "node",
          title: translationKey("Node"),
          value: { column: "groupName", format: "text" },
        },
        {
          type: "value",
          id: "sensor-type",
          title: translationKey("Type"),
          value: { detail: "sensorType", format: "text" },
        },
        {
          type: "value",
          id: "reading",
          title: translationKey("Reading"),
          value: { detail: "reading", format: "text" },
        },
        { type: "lastSeen" },
      ],
    },
    {
      kind: StorageArrayResourceKind.NetworkInterface,
      layout: "default",
      tableId: "storage-array-ontap-ports-table",
      words: {
        title: translationKey("Ports"),
        singularName: translationKey("Port"),
        pluralName: translationKey("Ports"),
      },
      description: translationKey(
        "The Ethernet and Fibre Channel ports of each node: whether each is up, its speed, the traffic it carries, and its errors or link failures.",
      ),
      noItemsMessage: translationKey(
        "No ports in the inventory yet. They appear here a few minutes after the Storage Array Agent starts reading the cluster.",
      ),
    },
  ],
  kindPages: ONTAP_KIND_PAGES,

  agentConfigs: [
    {
      key: "netapp-ontap",
      label: translationKey("NetApp ONTAP"),
      description: translationKey(
        "ONTAP 9.12.1 or later, or Amazon FSx for NetApp ONTAP. The agent runs NetApp Harvest next to it.",
      ),
      collectorConfigFile: "otel-collector-config.netapp-ontap.yaml",
      composeProfile: "netapp-ontap",
      endpointVariable: "NETAPP_ONTAP_ENDPOINT",
      tokenVariable: "NETAPP_ONTAP_PASSWORD",
      userVariable: "NETAPP_ONTAP_USERNAME",
      exampleUser: "oneuptime",
      exampleEndpoint: "ontap-prod-01.example.com",
      exporterService: "netapp-harvest",
      // A word the Dashboard puts in its sentences, so translated.
      arrayNoun: translationKey("ONTAP cluster"),
      extraFiles: [
        "netapp-harvest.yml",
        "netapp-harvest-rest.yaml",
        "netapp-harvest-keyperf.yaml",
        "netapp-harvest-restperf.yaml",
      ],
    },
  ],
};

export default NetAppOntapPlatform;
