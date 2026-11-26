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
import POWERMAX_METRIC_DEFINITIONS, {
  POWERMAX_METRIC_IDS,
} from "./PowerMaxMetrics";
import POWERMAX_ALERT_TEMPLATES, {
  POWERMAX_RESPONSE_TIME_WARNING_USEC,
} from "./PowerMaxAlertTemplates";
import {
  POWERMAX_ENDPOINTS,
  POWERMAX_LABELS,
  POWERMAX_METRICS,
  POWERMAX_METRIC_PREFIX,
  POWERMAX_OPERATIONS,
  POWERMAX_PORT_KIND,
  POWERMAX_SNAPSHOT_METRIC_NAMES,
  PowerMaxKind,
} from "./PowerMaxSeries";

/*
 * DELL POWERMAX (and VMAX3, VMAX All Flash): Dell's high-end block array,
 * read through Unisphere for PowerMax 10.1 or later, which manages many
 * arrays at once.
 *
 * PowerMax has no metrics endpoint and answers SNMP with traps only, so a
 * OneUptime probe reads Unisphere's REST API (Monitor and PerfMonitor roles,
 * read-only) every five minutes and writes PowerMaxSeries for each array it
 * manages locally: one connection adds every array behind it. Its extractor
 * is Common/Server/Utils/Telemetry/StorageArray/Dell/PowerMaxExtractor, its
 * poller packages/Probe/Utils/StorageArray/Dell/PowerMax.
 *
 * No agent reads a PowerMax, so it has no agent configs: the probe's
 * connection, its test and its collection are Storage Arrays' probe
 * collection (Common/Types/StorageArray/Collection).
 */

export const POWERMAX_VENDOR_NAME: string = "Dell";

// The High Read and Write Response Time alerts' line, for the Overview.
export const POWERMAX_LATENCY_WARNING_USEC: number =
  POWERMAX_RESPONSE_TIME_WARNING_USEC;

const IDS: typeof POWERMAX_METRIC_IDS = POWERMAX_METRIC_IDS;

// The Resource Usage page's cards, in order.
export const POWERMAX_INSIGHTS_SECTIONS: Array<StorageArrayInsightsSection> = [
  {
    key: "capacity",
    title: translationKey("Capacity"),
    description: translationKey(
      "Share of the array's usable capacity in use, each storage resource pool's, and the data reduction ratio.",
    ),
    icon: IconProp.ChartBar,
    metricIds: [IDS.capacityUsedPercent, IDS.srpUsedPercent, IDS.dataReduction],
  },
  {
    key: "performance",
    title: translationKey("Performance"),
    description: translationKey(
      "Where time goes for the whole array: response time hosts see, cache hits, write pending, and how busy its front end, back end and SRDF directors are.",
    ),
    icon: IconProp.Signal,
    metricIds: [
      IDS.readResponseTime,
      IDS.writeResponseTime,
      IDS.cacheHit,
      IDS.writePending,
      IDS.frontEndBusy,
      IDS.backEndBusy,
      IDS.srdfBusy,
    ],
  },
  {
    key: "storage-groups",
    title: translationKey("Storage Groups"),
    description: translationKey(
      "The ten storage groups with the highest response time, IOPS and throughput, every 5 minutes.",
    ),
    icon: IconProp.RectangleStack,
    metricIds: [
      IDS.storageGroupResponseTime,
      IDS.storageGroupIops,
      IDS.storageGroupThroughput,
    ],
    groupByObject: true,
  },
  {
    key: "storage-groups-real-time",
    title: translationKey("Storage Groups in Real Time"),
    description: translationKey(
      "Every 5 seconds, for the storage groups registered for real-time collection in Unisphere (Settings > Performance > System Registrations, up to 100 per array). Empty while none is registered.",
    ),
    icon: IconProp.Bolt,
    metricIds: [
      IDS.storageGroupRealtimeReadResponseTime,
      IDS.storageGroupRealtimeWriteResponseTime,
      IDS.storageGroupRealtimeIops,
      IDS.storageGroupRealtimeThroughput,
    ],
    groupByObject: true,
  },
  {
    key: "volumes",
    title: translationKey("Volumes"),
    description: translationKey(
      "The ten volumes with the highest response time and IOPS. Unisphere reports volume figures only for storage groups registered for real-time collection.",
    ),
    icon: IconProp.Disc,
    metricIds: [IDS.volumeResponseTime, IDS.volumeIops],
    groupByObject: true,
  },
  {
    key: "directors-and-ports",
    title: translationKey("Directors and Ports"),
    description: translationKey(
      "How busy each director and port is, the traffic through each port, and the light each optical port receives.",
    ),
    icon: IconProp.CPUChip,
    metricIds: [
      IDS.directorBusy,
      IDS.portBusy,
      IDS.portThroughput,
      IDS.portRxPower,
    ],
    groupByObject: true,
  },
  {
    key: "replication",
    title: translationKey("Replication"),
    description: translationKey(
      "How far each asynchronous SRDF group's remote copy is behind, the traffic each SRDF group sends, and how long a replicated write takes.",
    ),
    icon: IconProp.Refresh,
    metricIds: [IDS.srdfLag, IDS.srdfThroughput, IDS.srdfResponseTime],
    groupByObject: true,
  },
];

const PowerMaxPlatform: StorageArrayPlatform = {
  storageSystem: StorageSystem.DellPowerMax,
  displayName: "Dell PowerMax",
  shortName: "PowerMax",
  vendorName: POWERMAX_VENDOR_NAME,
  aliases: [
    "dell.powermax",
    "dell_powermax",
    "dell-powermax",
    "dellemc.powermax",
    "emc.powermax",
    "powermax",
    "dell.vmax",
    "vmax",
  ],

  metricPrefix: POWERMAX_METRIC_PREFIX,
  snapshotMetricNames: POWERMAX_SNAPSHOT_METRIC_NAMES,
  scrapeEndpoints: {
    [POWERMAX_ENDPOINTS.storageGroups]: [PowerMaxKind.StorageGroup],
    [POWERMAX_ENDPOINTS.volumes]: [StorageArrayResourceKind.Volume],
    [POWERMAX_ENDPOINTS.srps]: [PowerMaxKind.StorageResourcePool],
    [POWERMAX_ENDPOINTS.directors]: [PowerMaxKind.Director],
    [POWERMAX_ENDPOINTS.ports]: [POWERMAX_PORT_KIND],
    [POWERMAX_ENDPOINTS.srdfGroups]: [PowerMaxKind.SrdfGroup],
  },

  kinds: [
    PowerMaxKind.StorageGroup,
    StorageArrayResourceKind.Volume,
    PowerMaxKind.StorageResourcePool,
    PowerMaxKind.SrdfGroup,
    PowerMaxKind.Director,
    POWERMAX_PORT_KIND,
  ],
  kindDefinitions: [
    {
      kind: PowerMaxKind.StorageGroup,
      singularLabel: translationKey("Storage Group"),
      pluralLabel: translationKey("Storage Groups"),
      countLabel: {
        one: translationKey("{{count}} storage group"),
        other: translationKey("{{count}} storage groups"),
      },
      icon: IconProp.RectangleStack,
      description: translationKey(
        "The storage groups of this PowerMax: the volumes hosts see together, each with its service level, its storage resource pool, the capacity its volumes use, and its response time, IOPS and throughput over Unisphere's last 5-minute interval.",
      ),
      noItemsMessage: translationKey(
        "No storage groups in the inventory yet. They appear a few minutes after the probe first reads this array from Unisphere.",
      ),
    },
    {
      kind: PowerMaxKind.StorageResourcePool,
      singularLabel: translationKey("Storage Resource Pool"),
      pluralLabel: translationKey("Storage Resource Pools"),
      countLabel: {
        one: translationKey("{{count}} storage resource pool"),
        other: translationKey("{{count}} storage resource pools"),
      },
      icon: IconProp.Database,
      description: translationKey(
        "The storage resource pools (SRPs) of this PowerMax: the capacity its storage groups are provisioned from, how much of it is in use, and its data reduction.",
      ),
      noItemsMessage: translationKey(
        "No storage resource pools in the inventory yet. They appear a few minutes after the probe first reads this array from Unisphere.",
      ),
    },
    {
      kind: PowerMaxKind.SrdfGroup,
      singularLabel: translationKey("SRDF Group"),
      pluralLabel: translationKey("SRDF Groups"),
      countLabel: {
        one: translationKey("{{count}} SRDF group"),
        other: translationKey("{{count}} SRDF groups"),
      },
      icon: IconProp.Refresh,
      description: translationKey(
        "The SRDF groups of this PowerMax: what it replicates to which remote array, in which mode, the state of its pairs, and how far an asynchronous group's remote copy is behind.",
      ),
      noItemsMessage: translationKey(
        "No SRDF groups. This array replicates nothing to another PowerMax, or the Unisphere account cannot read its SRDF groups (Unisphere 10.3 or later lists them for a Monitor account).",
      ),
    },
    {
      kind: PowerMaxKind.Director,
      singularLabel: translationKey("Director"),
      pluralLabel: translationKey("Directors"),
      countLabel: {
        one: translationKey("{{count}} director"),
        other: translationKey("{{count}} directors"),
      },
      icon: IconProp.CPUChip,
      description: translationKey(
        "The directors of this PowerMax's engines: front end (hosts), back end (drives), SRDF (replication) and infrastructure, with the status Unisphere reports for each.",
      ),
      noItemsMessage: translationKey(
        "No directors in the inventory yet. They appear a few minutes after the probe first reads this array from Unisphere.",
      ),
    },
  ],
  hardwareKinds: [PowerMaxKind.Director],
  metricFamilies: [
    {
      prefix: "powermax_storage_group_",
      kind: PowerMaxKind.StorageGroup,
    },
    { prefix: "powermax_volume_", kind: StorageArrayResourceKind.Volume },
    { prefix: "powermax_srp_", kind: PowerMaxKind.StorageResourcePool },
    { prefix: "powermax_srdf_group_", kind: PowerMaxKind.SrdfGroup },
    { prefix: "powermax_director_", kind: PowerMaxKind.Director },
    { prefix: "powermax_port_", kind: POWERMAX_PORT_KIND },
  ],
  /*
   * Directors report Online, Offline, Dead or Failed; ports ON, OFF or
   * PendOn; an SRDF group's row carries the worst state of its pairs.
   */
  componentStatuses: {
    critical: [
      ...STORAGE_ARRAY_COMPONENT_STATUSES.critical,
      "offline",
      "dead",
      "suspended",
      "partitioned",
      "failed over",
      "failedover",
      "split",
      "invalid",
    ],
    warning: [
      ...STORAGE_ARRAY_COMPONENT_STATUSES.warning,
      "pending",
      "pendon",
      "pendoff",
      "transidle",
      "trans idle",
    ],
  },
  objectLabels: {
    [StorageArrayResourceScope.Volume]: POWERMAX_LABELS.volume,
    [StorageArrayResourceScope.Hardware]: POWERMAX_LABELS.component,
  },

  metrics: POWERMAX_METRIC_DEFINITIONS,
  /*
   * Every collection of the array writes powermax_array_info (value 1),
   * whatever state the array is in, as long as Unisphere answers.
   */
  heartbeat: {
    templateId: "powermax-array-stopped-reporting",
    metricName: POWERMAX_METRICS.arrayInfo,
  },
  alertTemplates: POWERMAX_ALERT_TEMPLATES,
  resourceFilters: [
    {
      key: "volumeName",
      description: translationKey(
        "Filter to one PowerMax volume — the `volume` label of the powermax_volume_* series, its five-digit device ID such as 00847 (optional).",
      ),
    },
    {
      key: "componentName",
      description: translationKey(
        "Filter to one director or port — the `component` label of the powermax_director_* and powermax_port_* series, such as FA-1D or FA-1D:4 (optional).",
      ),
    },
  ],

  overview: {
    goldenCharts: {
      readLatency: IDS.readResponseTime,
      writeLatency: IDS.writeResponseTime,
      readIops: IDS.readIops,
      writeIops: IDS.writeIops,
      readBandwidth: IDS.readThroughput,
      writeBandwidth: IDS.writeThroughput,
      capacityUsed: IDS.capacityUsedPercent,
      capacityUsedDescription: translationKey(
        "Share of the array's usable capacity in use, across its storage resource pools. Each pool fills on its own: the Storage Resource Pool alerts watch them one by one.",
      ),
    },
    alertMetricName: POWERMAX_METRICS.alertOpen,
    alertDetailsUnavailable: translationKey(
      "Alert details are unavailable right now. Open Unisphere for PowerMax at System > Alerts for the full list.",
    ),
    countChips: [
      { kind: PowerMaxKind.StorageGroup, showWhenZero: true },
      { kind: StorageArrayResourceKind.Volume, showWhenZero: true },
      // An array that replicates nothing has no SRDF groups to count.
      { kind: PowerMaxKind.SrdfGroup, showWhenZero: false },
    ],
    inventoryTile: {
      kind: PowerMaxKind.StorageGroup,
      sublabelKind: StorageArrayResourceKind.Volume,
    },
    listCounts: [PowerMaxKind.StorageGroup, StorageArrayResourceKind.Volume],
    topKind: PowerMaxKind.StorageGroup,
    latency: {
      metricName: POWERMAX_METRICS.arrayResponseTime,
      dimensionLabel: POWERMAX_LABELS.operation,
      readDimension: POWERMAX_OPERATIONS.read,
      writeDimension: POWERMAX_OPERATIONS.write,
      readWarningUsec: POWERMAX_LATENCY_WARNING_USEC,
      writeWarningUsec: POWERMAX_LATENCY_WARNING_USEC,
    },
  },
  insightsSections: POWERMAX_INSIGHTS_SECTIONS,
  hardwareTables: [
    {
      kind: PowerMaxKind.Director,
      layout: "default",
      tableId: "storage-array-powermax-directors-table",
      description: translationKey(
        "The directors of this PowerMax's engines — front end, back end, SRDF and infrastructure — with the status Unisphere reports for each.",
      ),
      noItemsMessage: translationKey(
        "No directors in the inventory yet. They appear a few minutes after the probe first reads this array from Unisphere.",
      ),
    },
    {
      kind: POWERMAX_PORT_KIND,
      layout: "default",
      tableId: "storage-array-powermax-ports-table",
      description: translationKey(
        "The front end, back end and SRDF ports of this PowerMax: their protocol, whether each is up, its negotiated speed and the traffic it carries.",
      ),
      noItemsMessage: translationKey(
        "No ports in the inventory yet. Unisphere 10.3 or later lists them; on an older Unisphere they appear only in the charts.",
      ),
    },
  ],

  agentConfigs: [],
};

export default PowerMaxPlatform;
