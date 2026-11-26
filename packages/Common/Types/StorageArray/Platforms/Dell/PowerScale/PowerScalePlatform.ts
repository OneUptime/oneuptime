import IconProp from "../../../../Icon/IconProp";
import { StorageArrayResourceScope } from "../../../../Monitor/MonitorStepStorageArrayMonitor";
import { translationKey } from "../../../../Translator";
import StorageArrayResourceKind from "../../../StorageArrayResourceKind";
import StorageSystem from "../../../StorageSystem";
import {
  StorageArrayInsightsSection,
  StorageArrayKindDefinition,
  StorageArrayPlatform,
} from "../../../StorageArrayPlatform";
import POWERSCALE_METRICS from "./PowerScaleMetrics";
import POWERSCALE_ALERT_TEMPLATES from "./PowerScaleAlertTemplates";

/*
 * DELL POWERSCALE (formerly Isilon, running OneFS): Dell's scale-out NAS.
 * A cluster of nodes serves one file system, /ifs, so a cluster is one
 * storage array, and its nodes, drives, quotas, sensors and ports are its
 * inventory (#11003).
 *
 * The Storage Array Agent reads it over SNMP from Dell's ISILON-MIB, with
 * nothing running next to the collector
 * (agents/StorageArrayAgent/otel-collector-config.powerscale.yaml): the
 * cluster's own objects (health, capacity, the online and offline nodes,
 * quotas) through one node, and each node's objects (its health, drives,
 * sensors, ports and protocol performance) from every node, because the
 * MIB's node objects describe only the node that answers. Its extractor is
 * Common/Server/Utils/Telemetry/StorageArray/Dell/PowerScaleExtractor.
 *
 * OneFS events and storage pools are not in ISILON-MIB: they come from the
 * OneFS API, on the probe poller the epic builds for PowerMax (#11004).
 */

// The kinds only PowerScale has.
export const POWERSCALE_NODE_KIND: string = "Node";
export const POWERSCALE_QUOTA_KIND: string = "Quota";

export const POWERSCALE_KIND_DEFINITIONS: Array<StorageArrayKindDefinition> = [
  {
    kind: POWERSCALE_NODE_KIND,
    singularLabel: translationKey("Node"),
    pluralLabel: translationKey("Nodes"),
    countLabel: {
      one: translationKey("{{count}} node"),
      other: translationKey("{{count}} nodes"),
    },
    icon: IconProp.ServerStack,
    description: translationKey(
      "The nodes of this PowerScale cluster, with the health OneFS reports for each and the throughput into and out of /ifs through it.",
    ),
    noItemsMessage: translationKey(
      "No nodes in the inventory yet. They appear here a minute after the Storage Array Agent starts polling the cluster.",
    ),
  },
  {
    kind: POWERSCALE_QUOTA_KIND,
    singularLabel: translationKey("Quota"),
    pluralLabel: translationKey("Quotas"),
    countLabel: {
      one: translationKey("{{count}} quota"),
      other: translationKey("{{count}} quotas"),
    },
    icon: IconProp.ChartPie,
    description: translationKey(
      "The directory, user and group quotas on this cluster (SmartQuotas), with what each holds and its limit.",
    ),
    noItemsMessage: translationKey(
      "No quotas yet. They appear here within five minutes of the Storage Array Agent starting, once the cluster has a quota.",
    ),
  },
];

/*
 * The statuses the extractor writes, lowercased: a node's health (healthy,
 * attention, down, invalid, and offline for a node the cluster lists as
 * offline), a drive's status as OneFS reports it (healthy, l3, smartfail,
 * dead, replace, stalled, empty, new, ...), a port's state (up, down,
 * disabled) and where a quota stands against its limits (ok,
 * over_advisory_limit, over_soft_limit, full).
 */
export const POWERSCALE_COMPONENT_STATUSES: StorageArrayPlatform["componentStatuses"] =
  {
    critical: ["down", "offline", "dead", "stalled", "full"],
    warning: [
      "attention",
      "over_soft_limit",
      "over_advisory_limit",
      "invalid",
      "smartfail",
      "replace",
      "sed_error",
      "wrong_type",
      "insecure",
      "unencrypted",
      "unknown",
    ],
  };

// The Resource Usage page's cards, in order.
export const POWERSCALE_INSIGHTS_SECTIONS: Array<StorageArrayInsightsSection> =
  [
    {
      key: "capacity",
      title: translationKey("Capacity"),
      description: translationKey(
        "Share of the cluster's capacity in use, and the space still available for writes.",
      ),
      icon: IconProp.ChartBar,
      metricIds: [
        "powerscale-capacity-used-percent",
        "powerscale-capacity-available",
      ],
    },
    {
      key: "performance",
      title: translationKey("Throughput"),
      description: translationKey(
        "Reads and writes of /ifs, the front-end network and CPU, across the cluster.",
      ),
      icon: IconProp.Signal,
      metricIds: [
        "powerscale-read-throughput",
        "powerscale-write-throughput",
        "powerscale-network-in",
        "powerscale-network-out",
        "powerscale-cpu-busy",
      ],
    },
    {
      key: "protocols",
      title: translationKey("Protocols"),
      description: translationKey(
        "Latency, operations and throughput of each protocol the cluster serves, busiest first.",
      ),
      icon: IconProp.Squares,
      metricIds: [
        "powerscale-protocol-latency",
        "powerscale-protocol-operations",
        "powerscale-protocol-out",
        "powerscale-protocol-in",
      ],
      // A protocol is no object of the array's: its series say it in `protocol`.
      groupByLabel: "protocol",
    },
    {
      key: "nodes",
      title: translationKey("Nodes"),
      description: translationKey(
        "CPU and /ifs throughput of each node, busiest first.",
      ),
      icon: IconProp.ServerStack,
      metricIds: [
        "powerscale-node-cpu-busy",
        "powerscale-node-read-throughput",
        "powerscale-node-write-throughput",
      ],
      groupByObject: true,
    },
    {
      key: "quotas",
      title: translationKey("Quotas"),
      description: translationKey(
        "The ten quotas nearest their limit, and what they hold.",
      ),
      icon: IconProp.ChartPie,
      metricIds: ["powerscale-quota-used-percent", "powerscale-quota-usage"],
      groupByObject: true,
    },
    {
      key: "drives",
      title: translationKey("Drives"),
      description: translationKey("The ten busiest drives."),
      icon: IconProp.Disc,
      metricIds: ["powerscale-drive-operations"],
      groupByObject: true,
    },
    {
      key: "hardware",
      title: translationKey("Hardware"),
      description: translationKey(
        "The hottest sensor and the slowest fan of each node.",
      ),
      icon: IconProp.CPUChip,
      metricIds: ["powerscale-temperature", "powerscale-fan-speed"],
      groupByObject: true,
    },
  ];

const DellPowerScalePlatform: StorageArrayPlatform = {
  storageSystem: StorageSystem.DellPowerScale,
  displayName: "Dell PowerScale",
  shortName: "PowerScale",
  vendorName: "Dell",
  aliases: [
    "dell.powerscale",
    "dell_powerscale",
    "dell-powerscale",
    "dellemc.powerscale",
    "powerscale",
    "dell.isilon",
    "dell_isilon",
    "dell-isilon",
    "emc.isilon",
    "emc_isilon",
    "dellemc.isilon",
    "isilon",
    "onefs",
  ],

  metricPrefix: "powerscale_",
  snapshotMetricNames: [
    // The cluster: health, its node lists, capacity
    "powerscale_cluster_health",
    "powerscale_ifs_total_bytes",
    "powerscale_ifs_available_bytes",
    "powerscale_ifs_used_percent",
    // Quotas
    "powerscale_quota_usage_bytes",
    "powerscale_quota_physical_bytes",
    "powerscale_quota_inodes",
    "powerscale_quota_used_percent",
    // Each node polled: its health, throughput, CPU, chassis, protocols
    "powerscale_node_health",
    "powerscale_node_type",
    "powerscale_node_read_only",
    "powerscale_node_ifs_read_bytes_per_second",
    "powerscale_node_ifs_write_bytes_per_second",
    "powerscale_node_cpu_busy_percent",
    "powerscale_chassis_service_light",
    "powerscale_protocol_operations_per_second",
    "powerscale_protocol_latency_microseconds",
    // Its drives, sensors and ports
    "powerscale_drive_size_bytes",
    "powerscale_drive_operations_per_second",
    "powerscale_fan_speed_rpm",
    "powerscale_temperature_celsius",
    "powerscale_power_sensor_reading",
    "powerscale_interface_status",
  ],
  /*
   * The cluster's poll lists every configured node, the quotas' poll every
   * quota. A node's own poll lists only its drives, sensors and ports, so no
   * batch is the complete list of those: they are counted on their tabs,
   * and the cleanup worker removes one that stops reporting.
   */
  scrapeEndpoints: {
    cluster: [POWERSCALE_NODE_KIND],
    quotas: [POWERSCALE_QUOTA_KIND],
  },

  kinds: [
    POWERSCALE_NODE_KIND,
    POWERSCALE_QUOTA_KIND,
    StorageArrayResourceKind.Drive,
    StorageArrayResourceKind.Hardware,
    StorageArrayResourceKind.NetworkInterface,
  ],
  kindDefinitions: POWERSCALE_KIND_DEFINITIONS,
  /*
   * The array's health is the cluster's, as OneFS reports it, and its
   * nodes' and drives'. A sensor reports a reading, not a health, and a port
   * that is down is often one nobody cabled.
   */
  hardwareKinds: [POWERSCALE_NODE_KIND, StorageArrayResourceKind.Drive],
  metricFamilies: [
    { prefix: "powerscale_quota_", kind: POWERSCALE_QUOTA_KIND },
    { prefix: "powerscale_drive_", kind: StorageArrayResourceKind.Drive },
    { prefix: "powerscale_node_", kind: POWERSCALE_NODE_KIND },
    { prefix: "powerscale_fan_", kind: StorageArrayResourceKind.Hardware },
    {
      prefix: "powerscale_temperature_",
      kind: StorageArrayResourceKind.Hardware,
    },
    {
      prefix: "powerscale_power_sensor_",
      kind: StorageArrayResourceKind.Hardware,
    },
    {
      prefix: "powerscale_interface_",
      kind: StorageArrayResourceKind.NetworkInterface,
    },
    // A protocol, the cluster and its capacity are no inventory object.
    { prefix: "powerscale_protocol_", kind: null },
    { prefix: "powerscale_cluster_", kind: null },
    { prefix: "powerscale_ifs_", kind: null },
  ],
  componentStatuses: POWERSCALE_COMPONENT_STATUSES,
  objectLabels: {
    // A node's own series name it by its host name.
    [StorageArrayResourceScope.Hardware]: "node",
    // A quota: its path, and whose quota it is when it is a user's or a group's.
    [StorageArrayResourceScope.FileSystem]: "quota",
  },

  metrics: POWERSCALE_METRICS,
  heartbeat: {
    templateId: "powerscale-cluster-stopped-reporting",
    metricName: "powerscale_cluster_health",
  },
  alertTemplates: POWERSCALE_ALERT_TEMPLATES,
  resourceFilters: [
    {
      key: "componentName",
      description: translationKey(
        "Filter to one PowerScale node — its `node` label, the node's host name such as ps-prod-2 (optional).",
      ),
    },
    {
      key: "fileSystemName",
      description: translationKey(
        "Filter to one PowerScale quota — its `quota` label: a directory quota's path such as /ifs/data/home, or the path and whose quota it is, such as /ifs/data/home (user 2001) (optional).",
      ),
    },
  ],

  overview: {
    /*
     * OneFS reports one health for the whole cluster. When it is not OK,
     * the Active Alerts card counts it, and this says where OneFS lists why.
     */
    alertDetailsUnavailable: translationKey(
      "OneFS reports the cluster is not healthy. Run isi event groups list on the cluster, or open the OneFS web administration interface, to see why.",
    ),
    countChips: [
      { kind: POWERSCALE_NODE_KIND, showWhenZero: true },
      { kind: POWERSCALE_QUOTA_KIND, showWhenZero: false },
    ],
    inventoryTile: {
      kind: POWERSCALE_NODE_KIND,
      sublabelKind: POWERSCALE_QUOTA_KIND,
    },
    listCounts: [POWERSCALE_NODE_KIND],
  },
  insightsSections: POWERSCALE_INSIGHTS_SECTIONS,
  hardwareTables: [
    {
      kind: StorageArrayResourceKind.Drive,
      layout: "default",
      tableId: "storage-array-powerscale-drives-table",
      description: translationKey(
        "Every drive bay of every node the agent polls, with the status OneFS reports (HEALTHY, SMARTFAIL, DEAD, ...) and the drive's size.",
      ),
      noItemsMessage: translationKey(
        "No drives in the inventory yet. They appear here a minute after the Storage Array Agent starts polling the cluster's nodes.",
      ),
    },
    {
      kind: StorageArrayResourceKind.Hardware,
      layout: "default",
      tableId: "storage-array-powerscale-sensors-table",
      description: translationKey(
        "The fans and the temperature and power sensors of every node the agent polls, with their latest reading.",
      ),
      noItemsMessage: translationKey(
        "No sensors in the inventory yet. They appear here a minute after the Storage Array Agent starts polling the cluster's nodes.",
      ),
    },
    {
      kind: StorageArrayResourceKind.NetworkInterface,
      layout: "default",
      tableId: "storage-array-powerscale-ports-table",
      description: translationKey(
        "The network ports of every node the agent polls, front-end and back-end, with their state and speed.",
      ),
      noItemsMessage: translationKey(
        "No network ports in the inventory yet. They appear here a minute after the Storage Array Agent starts polling the cluster's nodes.",
      ),
    },
  ],

  agentConfigs: [
    {
      key: "powerscale",
      label: translationKey("PowerScale"),
      description: translationKey(
        "The agent polls the cluster's nodes over SNMP. Nothing runs next to it.",
      ),
      collectorConfigFile: "otel-collector-config.powerscale.yaml",
      composeProfile: "",
      endpointVariable: "POWERSCALE_ENDPOINT",
      tokenVariable: "POWERSCALE_SNMP_COMMUNITY",
      exampleEndpoint: "10.20.0.11",
      exporterService: null,
      talksTlsToArray: false,
      arrayNoun: "PowerScale cluster",
    },
  ],
};

export default DellPowerScalePlatform;
