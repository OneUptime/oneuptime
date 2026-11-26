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
    listColumns: [
      {
        shows: "status",
        title: translationKey("Health"),
        description: translationKey(
          "The health OneFS reports for the node: Healthy, Attention, Down or Invalid. Offline while the cluster lists it as offline.",
        ),
      },
      {
        shows: "type",
        title: translationKey("Type"),
        description: translationKey("A storage node or an accelerator."),
      },
      {
        shows: "model",
        title: translationKey("Model"),
        description: translationKey("The node's model, from its chassis."),
      },
      {
        shows: "version",
        title: translationKey("OneFS"),
        description: translationKey("The OneFS version the node runs."),
      },
      {
        shows: "detail",
        detail: "cpuBusyPercent",
        format: "percent",
        title: translationKey("CPU"),
        description: translationKey("Share of the node's CPU time in use."),
      },
      {
        shows: "readBandwidth",
        title: translationKey("Read"),
        description: translationKey(
          "Bytes read out of /ifs per second through the node.",
        ),
      },
      {
        shows: "writeBandwidth",
        title: translationKey("Write"),
        description: translationKey(
          "Bytes written into /ifs per second through the node.",
        ),
      },
      {
        shows: "detail",
        detail: "serialNumber",
        format: "text",
        title: translationKey("Serial Number"),
        hiddenByDefault: true,
      },
      {
        shows: "detail",
        detail: "readOnly",
        format: "yesNo",
        title: translationKey("Read-Only"),
        description: translationKey(
          "Whether the node is in read-only mode, so clients connected to it cannot write.",
        ),
        hiddenByDefault: true,
      },
      { shows: "lastSeen" },
    ],
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
    listColumns: [
      {
        shows: "status",
        title: translationKey("Status"),
        description: translationKey(
          "Where the quota stands against its limits: OK, Over Advisory Limit, Over Soft Limit, or Full at its hard limit.",
        ),
      },
      {
        shows: "type",
        title: translationKey("Kind"),
        description: translationKey(
          "A directory, user or group quota, or a default one for users or groups.",
        ),
      },
      {
        shows: "usage",
        title: translationKey("Used"),
        description: translationKey(
          "How much of its limit the quota uses: of its hard limit, or of its soft limit when it has no hard one.",
        ),
        // The lines the Quota Near Its Limit and Quota Full alerts fire at.
        warningPercent: 90,
        criticalPercent: 100,
      },
      {
        shows: "detail",
        detail: "hardLimitBytes",
        format: "bytes",
        title: translationKey("Hard Limit"),
        description: translationKey(
          "Writes to the quota are refused at this size.",
        ),
      },
      {
        shows: "detail",
        detail: "softLimitBytes",
        format: "bytes",
        title: translationKey("Soft Limit"),
        description: translationKey(
          "Past this size, writes are refused once the grace period ends.",
        ),
      },
      {
        shows: "detail",
        detail: "advisoryLimitBytes",
        format: "bytes",
        title: translationKey("Advisory Limit"),
        description: translationKey("Past this size, OneFS only notifies."),
        hiddenByDefault: true,
      },
      {
        shows: "detail",
        detail: "gracePeriodSeconds",
        format: "seconds",
        title: translationKey("Grace Period"),
        description: translationKey(
          "How long the quota may stay past its soft limit before writes are refused.",
        ),
        hiddenByDefault: true,
      },
      {
        shows: "detail",
        detail: "physicalBytes",
        format: "bytes",
        title: translationKey("With Protection"),
        description: translationKey(
          "What the quota holds, with the space its data protection takes.",
        ),
        hiddenByDefault: true,
      },
      {
        shows: "detail",
        detail: "inodes",
        format: "number",
        title: translationKey("Files and Directories"),
        hiddenByDefault: true,
      },
      {
        shows: "detail",
        detail: "includesSnapshots",
        format: "yesNo",
        title: translationKey("Counts Snapshots"),
        description: translationKey(
          "Whether the quota counts the space its snapshots take.",
        ),
        hiddenByDefault: true,
      },
      { shows: "lastSeen" },
    ],
    // The largest first; the ten nearest their limit are on Resource Usage.
    sortBy: { field: "usedBytes", descending: true },
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
    description:
      "Alert when the PowerScale sends no data for ten minutes: the Storage Array Agent stopped, lost its route to OneUptime or had its token revoked, or the cluster stopped answering it (down, unreachable, SNMP turned off, or its community or SNMPv3 user changed). Reads powerscale_cluster_health, which the agent's poll of the cluster sends every minute.",
    incidentDescription:
      "OneUptime has received no data from this PowerScale for ten minutes, so its other monitors have nothing to evaluate either. Check, in order: whether the cluster's first node answers SNMP from the agent's machine, whether the agent's community or SNMPv3 user still works (isi snmp settings view), whether the Storage Array Agent's container is running and what the collector's log says, and whether the agent can reach OneUptime with its token. The incident resolves on its own once data arrives again.",
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
    /*
     * A protocol's latency and load, throughput, the busiest nodes and how
     * full the cluster is: OneFS reports no read and write latency pairs, so
     * its panels are its own.
     */
    charts: [
      {
        title: translationKey("Protocol Latency"),
        description: translationKey(
          "How long an operation takes per protocol, as clients see it, on the node where it is slowest.",
        ),
        lines: [
          { metricId: "powerscale-protocol-latency", groupByLabel: "protocol" },
        ],
      },
      {
        title: translationKey("Protocol Operations"),
        description: translationKey(
          "Operations per second per protocol, on its busiest node.",
        ),
        lines: [
          {
            metricId: "powerscale-protocol-operations",
            groupByLabel: "protocol",
          },
        ],
      },
      {
        title: translationKey("Throughput"),
        description: translationKey(
          "Bytes read out of and written into /ifs per second, across the cluster.",
        ),
        lines: [
          {
            metricId: "powerscale-read-throughput",
            legend: translationKey("Read"),
          },
          {
            metricId: "powerscale-write-throughput",
            legend: translationKey("Write"),
          },
        ],
      },
      {
        title: translationKey("Busiest Nodes"),
        description: translationKey("CPU in use on each node, busiest first."),
        lines: [{ metricId: "powerscale-node-cpu-busy", groupByLabel: "node" }],
      },
      {
        title: translationKey("Capacity Used"),
        description: translationKey(
          "Share of the cluster's capacity no longer available for writes. OneUptime's templates warn at 80% and alert at 90%.",
        ),
        lines: [
          {
            metricId: "powerscale-capacity-used-percent",
            legend: translationKey("Capacity Used"),
          },
        ],
      },
    ],
    chartsDescription: translationKey(
      "Each protocol's latency and load, throughput, the busiest nodes and capacity used, for this cluster.",
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
      layout: "readings",
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
