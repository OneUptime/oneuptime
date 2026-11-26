import { StorageArrayResourceScope } from "../../../../Monitor/MonitorStepStorageArrayMonitor";
import MetricsAggregationType from "../../../../Metrics/MetricsAggregationType";
import { translationKey } from "../../../../Translator";
import StorageSystem from "../../../StorageSystem";
import {
  StorageArrayMetricCategory,
  StorageArrayMetricDefinition,
} from "../../../StorageArrayPlatform";
import {
  POWERMAX_LABELS,
  POWERMAX_METRICS,
  POWERMAX_OPERATIONS,
} from "./PowerMaxSeries";

/*
 * The Dell PowerMax metric catalog: what a PowerMax monitor's metric picker
 * offers, the unit each is read in, and the charts' labels.
 *
 * Every series is one a OneUptime probe writes from Unisphere for PowerMax
 * (PowerMaxSeries), at Unisphere's 5-minute diagnostic resolution unless
 * its name says real time. Response times are microseconds (Unisphere
 * reports milliseconds; the probe converts), throughput bytes per second.
 *
 * Objects are named by datapoint labels: `storage_group`, `volume` (the
 * five-digit device ID), `srp`, `component` (a director, FA-1D, or a port,
 * FA-1D:4) and `srdf_group` (its number). Group by them to fire one
 * incident per object.
 *
 * Ids are stored on dashboards and monitors: never change one.
 */
const PM: Array<StorageSystem> = [StorageSystem.DellPowerMax];

function entry(data: {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  category: StorageArrayMetricCategory;
  unit: string;
  scope?: StorageArrayResourceScope | undefined;
  objectLabel?: string | undefined;
  attributes?: Record<string, string> | undefined;
  aggregation?: MetricsAggregationType | undefined;
}): StorageArrayMetricDefinition {
  return {
    id: data.id,
    friendlyName: data.friendlyName,
    description: data.description,
    metricName: data.metricName,
    attributes: data.attributes,
    category: data.category,
    storageSystems: PM,
    defaultAggregation: data.aggregation || MetricsAggregationType.Max,
    defaultResourceScope: data.scope || StorageArrayResourceScope.Array,
    objectLabel: data.objectLabel,
    unit: data.unit,
  };
}

export const POWERMAX_METRIC_IDS: {
  readonly alertsOpen: string;
  readonly capacityUsedPercent: string;
  readonly capacityUsable: string;
  readonly capacityUsed: string;
  readonly capacitySubscribed: string;
  readonly dataReduction: string;
  readonly healthScore: string;
  readonly performanceCollection: string;
  readonly readResponseTime: string;
  readonly writeResponseTime: string;
  readonly readIops: string;
  readonly writeIops: string;
  readonly readThroughput: string;
  readonly writeThroughput: string;
  readonly cacheHit: string;
  readonly writePending: string;
  readonly frontEndBusy: string;
  readonly backEndBusy: string;
  readonly srdfBusy: string;
  readonly storageGroupResponseTime: string;
  readonly storageGroupReadResponseTime: string;
  readonly storageGroupWriteResponseTime: string;
  readonly storageGroupIops: string;
  readonly storageGroupThroughput: string;
  readonly storageGroupCapacityUsed: string;
  readonly storageGroupHostIoLimitExceeded: string;
  readonly storageGroupRealtimeResponseTime: string;
  readonly storageGroupRealtimeIops: string;
  readonly storageGroupRealtimeThroughput: string;
  readonly volumeResponseTime: string;
  readonly volumeIops: string;
  readonly volumeUsed: string;
  readonly srpUsedPercent: string;
  readonly srpUsed: string;
  readonly srpResponseTime: string;
  readonly directorOffline: string;
  readonly directorBusy: string;
  readonly portOffline: string;
  readonly portBusy: string;
  readonly portThroughput: string;
  readonly portRxPower: string;
  readonly srdfNotHealthy: string;
  readonly srdfLag: string;
  readonly srdfThroughput: string;
  readonly srdfResponseTime: string;
} = {
  alertsOpen: "powermax-alerts-open",
  capacityUsedPercent: "powermax-array-capacity-used-percent",
  capacityUsable: "powermax-array-capacity-usable",
  capacityUsed: "powermax-array-capacity-used",
  capacitySubscribed: "powermax-array-capacity-subscribed",
  dataReduction: "powermax-array-data-reduction",
  healthScore: "powermax-array-health-score",
  performanceCollection: "powermax-array-performance-collection",
  readResponseTime: "powermax-array-read-response-time",
  writeResponseTime: "powermax-array-write-response-time",
  readIops: "powermax-array-read-iops",
  writeIops: "powermax-array-write-iops",
  readThroughput: "powermax-array-read-throughput",
  writeThroughput: "powermax-array-write-throughput",
  cacheHit: "powermax-array-cache-hit",
  writePending: "powermax-array-write-pending",
  frontEndBusy: "powermax-array-frontend-busy",
  backEndBusy: "powermax-array-backend-busy",
  srdfBusy: "powermax-array-srdf-busy",
  storageGroupResponseTime: "powermax-storage-group-response-time",
  storageGroupReadResponseTime: "powermax-storage-group-read-response-time",
  storageGroupWriteResponseTime: "powermax-storage-group-write-response-time",
  storageGroupIops: "powermax-storage-group-iops",
  storageGroupThroughput: "powermax-storage-group-throughput",
  storageGroupCapacityUsed: "powermax-storage-group-capacity-used",
  storageGroupHostIoLimitExceeded:
    "powermax-storage-group-host-io-limit-exceeded",
  storageGroupRealtimeResponseTime:
    "powermax-storage-group-realtime-response-time",
  storageGroupRealtimeIops: "powermax-storage-group-realtime-iops",
  storageGroupRealtimeThroughput: "powermax-storage-group-realtime-throughput",
  volumeResponseTime: "powermax-volume-response-time",
  volumeIops: "powermax-volume-iops",
  volumeUsed: "powermax-volume-used",
  srpUsedPercent: "powermax-srp-capacity-used-percent",
  srpUsed: "powermax-srp-capacity-used",
  srpResponseTime: "powermax-srp-response-time",
  directorOffline: "powermax-director-offline",
  directorBusy: "powermax-director-busy",
  portOffline: "powermax-port-offline",
  portBusy: "powermax-port-busy",
  portThroughput: "powermax-port-throughput",
  portRxPower: "powermax-port-rx-power",
  srdfNotHealthy: "powermax-srdf-group-not-healthy",
  srdfLag: "powermax-srdf-group-lag",
  srdfThroughput: "powermax-srdf-group-throughput",
  srdfResponseTime: "powermax-srdf-group-response-time",
};

const IDS: typeof POWERMAX_METRIC_IDS = POWERMAX_METRIC_IDS;
const M: typeof POWERMAX_METRICS = POWERMAX_METRICS;
const L: typeof POWERMAX_LABELS = POWERMAX_LABELS;

const POWERMAX_METRIC_DEFINITIONS: Array<StorageArrayMetricDefinition> = [
  // ---------------- Array health ----------------
  entry({
    id: IDS.alertsOpen,
    friendlyName: translationKey("Open Unisphere Alerts"),
    description: translationKey(
      "One series per alert Unisphere has open for the array (value 1): not acknowledged, not cleared, and Minor or worse. Its severity label is critical (Critical and Fatal) or warning (Warning and Minor); its alert_type, object and description labels say what it is about. Acknowledge the alert in Unisphere and the series goes away.",
    ),
    metricName: M.alertOpen,
    category: "Array Health",
    unit: "count",
  }),
  entry({
    id: IDS.healthScore,
    friendlyName: translationKey("Health Score"),
    description: translationKey(
      "Unisphere's health score of the array, from 0 to 100, per health_metric: overall, and each area it scores (capacity, configuration, performance, service level compliance).",
    ),
    metricName: M.arrayHealthScore,
    category: "Array Health",
    unit: "score",
    aggregation: MetricsAggregationType.Min,
  }),
  entry({
    id: IDS.performanceCollection,
    friendlyName: translationKey("Performance Collection On"),
    description: translationKey(
      "1 while Unisphere collects 5-minute performance data for the array, 0 while it does not. With it off, OneUptime still lists the array's inventory and alerts, but charts no performance. Turn it on in Unisphere at Settings > Performance > System Registrations.",
    ),
    metricName: M.arrayPerformanceCollection,
    category: "Array Health",
    unit: "count",
    aggregation: MetricsAggregationType.Min,
  }),

  // ---------------- Capacity ----------------
  entry({
    id: IDS.capacityUsedPercent,
    friendlyName: translationKey("Capacity Used (%)"),
    description: translationKey(
      "Share of the array's usable capacity in use, in percent, across its storage resource pools.",
    ),
    metricName: M.arrayUsedPercent,
    category: "Capacity",
    unit: "%",
  }),
  entry({
    id: IDS.capacityUsable,
    friendlyName: translationKey("Usable Capacity"),
    description: translationKey(
      "The array's usable capacity, in bytes, as Unisphere reports it.",
    ),
    metricName: M.arrayUsableBytes,
    category: "Capacity",
    unit: "bytes",
  }),
  entry({
    id: IDS.capacityUsed,
    friendlyName: translationKey("Capacity Used"),
    description: translationKey(
      "The array's usable capacity in use, in bytes.",
    ),
    metricName: M.arrayUsedBytes,
    category: "Capacity",
    unit: "bytes",
  }),
  entry({
    id: IDS.capacitySubscribed,
    friendlyName: translationKey("Subscribed Capacity"),
    description: translationKey(
      "The capacity of every thin volume on the array, in bytes: what hosts were promised, which can exceed the usable capacity.",
    ),
    metricName: M.arraySubscribedBytes,
    category: "Capacity",
    unit: "bytes",
  }),
  entry({
    id: IDS.dataReduction,
    friendlyName: translationKey("Data Reduction Ratio"),
    description: translationKey(
      "How many times larger the data hosts wrote is than the space it takes after compression and deduplication, as Unisphere reports it.",
    ),
    metricName: M.arrayDataReductionRatio,
    category: "Capacity",
    unit: "ratio",
    aggregation: MetricsAggregationType.Avg,
  }),
  entry({
    id: IDS.srpUsedPercent,
    friendlyName: translationKey("Storage Resource Pool Used (%)"),
    description: translationKey(
      "Share of each storage resource pool's usable capacity in use, in percent, by its srp label. A pool that fills stops taking new writes for every storage group in it.",
    ),
    metricName: M.srpUsedPercent,
    category: "Capacity",
    unit: "%",
    objectLabel: L.srp,
  }),
  entry({
    id: IDS.srpUsed,
    friendlyName: translationKey("Storage Resource Pool Used"),
    description: translationKey(
      "Each storage resource pool's usable capacity in use, in bytes, by its srp label.",
    ),
    metricName: M.srpUsedBytes,
    category: "Capacity",
    unit: "bytes",
    objectLabel: L.srp,
  }),

  // ---------------- Performance ----------------
  entry({
    id: IDS.readResponseTime,
    friendlyName: translationKey("Read Response Time"),
    description: translationKey(
      "Average time a host read takes on the array, in microseconds, over Unisphere's last 5-minute interval (operation read).",
    ),
    metricName: M.arrayResponseTime,
    attributes: { [L.operation]: POWERMAX_OPERATIONS.read },
    category: "Performance",
    unit: "µs",
  }),
  entry({
    id: IDS.writeResponseTime,
    friendlyName: translationKey("Write Response Time"),
    description: translationKey(
      "Average time a host write takes on the array, in microseconds, over Unisphere's last 5-minute interval (operation write).",
    ),
    metricName: M.arrayResponseTime,
    attributes: { [L.operation]: POWERMAX_OPERATIONS.write },
    category: "Performance",
    unit: "µs",
  }),
  entry({
    id: IDS.readIops,
    friendlyName: translationKey("Read IOPS"),
    description: translationKey(
      "Host reads per second on the array: Unisphere's host IOs times its share of reads.",
    ),
    metricName: M.arrayReadIops,
    category: "Performance",
    unit: "ops/s",
  }),
  entry({
    id: IDS.writeIops,
    friendlyName: translationKey("Write IOPS"),
    description: translationKey(
      "Host writes per second on the array: Unisphere's host IOs times its share of writes.",
    ),
    metricName: M.arrayWriteIops,
    category: "Performance",
    unit: "ops/s",
  }),
  entry({
    id: IDS.readThroughput,
    friendlyName: translationKey("Read Throughput"),
    description: translationKey("Bytes per second hosts read from the array."),
    metricName: M.arrayReadThroughput,
    category: "Performance",
    unit: "bytes/s",
  }),
  entry({
    id: IDS.writeThroughput,
    friendlyName: translationKey("Write Throughput"),
    description: translationKey("Bytes per second hosts write to the array."),
    metricName: M.arrayWriteThroughput,
    category: "Performance",
    unit: "bytes/s",
  }),
  entry({
    id: IDS.cacheHit,
    friendlyName: translationKey("Cache Hit (%)"),
    description: translationKey(
      "Share of host I/O the array answered from cache, in percent.",
    ),
    metricName: M.arrayCacheHitPercent,
    category: "Performance",
    unit: "%",
    aggregation: MetricsAggregationType.Avg,
  }),
  entry({
    id: IDS.writePending,
    friendlyName: translationKey("Write Pending (%)"),
    description: translationKey(
      "Share of the array's cache holding writes not yet destaged to its drives, in percent. Near the array's limit, it slows host writes down.",
    ),
    metricName: M.arrayWritePendingPercent,
    category: "Performance",
    unit: "%",
  }),
  entry({
    id: IDS.frontEndBusy,
    friendlyName: translationKey("Front End Busy (%)"),
    description: translationKey(
      "How busy the directors that serve hosts are, in percent.",
    ),
    metricName: M.arrayFrontEndBusyPercent,
    category: "Performance",
    unit: "%",
  }),
  entry({
    id: IDS.backEndBusy,
    friendlyName: translationKey("Back End Busy (%)"),
    description: translationKey(
      "How busy the directors that serve the drives are, in percent.",
    ),
    metricName: M.arrayBackEndBusyPercent,
    category: "Performance",
    unit: "%",
  }),
  entry({
    id: IDS.srdfBusy,
    friendlyName: translationKey("SRDF Busy (%)"),
    description: translationKey(
      "How busy the directors that replicate to other arrays are, in percent.",
    ),
    metricName: M.arraySrdfBusyPercent,
    category: "Performance",
    unit: "%",
  }),

  // ---------------- Storage groups and volumes ----------------
  entry({
    id: IDS.storageGroupResponseTime,
    friendlyName: translationKey("Storage Group Response Time"),
    description: translationKey(
      "Average time an I/O takes for each storage group, in microseconds, by its storage_group label, over Unisphere's last 5-minute interval.",
    ),
    metricName: M.storageGroupResponseTime,
    category: "Volumes",
    unit: "µs",
    objectLabel: L.storageGroup,
  }),
  entry({
    id: IDS.storageGroupReadResponseTime,
    friendlyName: translationKey("Storage Group Read Response Time"),
    description: translationKey(
      "Average time a read takes for each storage group, in microseconds, by its storage_group label.",
    ),
    metricName: M.storageGroupReadResponseTime,
    category: "Volumes",
    unit: "µs",
    objectLabel: L.storageGroup,
  }),
  entry({
    id: IDS.storageGroupWriteResponseTime,
    friendlyName: translationKey("Storage Group Write Response Time"),
    description: translationKey(
      "Average time a write takes for each storage group, in microseconds, by its storage_group label.",
    ),
    metricName: M.storageGroupWriteResponseTime,
    category: "Volumes",
    unit: "µs",
    objectLabel: L.storageGroup,
  }),
  entry({
    id: IDS.storageGroupIops,
    friendlyName: translationKey("Storage Group IOPS"),
    description: translationKey(
      "Host I/Os per second for each storage group, by its storage_group label.",
    ),
    metricName: M.storageGroupIops,
    category: "Volumes",
    unit: "ops/s",
    objectLabel: L.storageGroup,
  }),
  entry({
    id: IDS.storageGroupThroughput,
    friendlyName: translationKey("Storage Group Throughput"),
    description: translationKey(
      "Bytes per second hosts read and write for each storage group, by its storage_group label.",
    ),
    metricName: M.storageGroupThroughput,
    category: "Volumes",
    unit: "bytes/s",
    objectLabel: L.storageGroup,
  }),
  entry({
    id: IDS.storageGroupCapacityUsed,
    friendlyName: translationKey("Storage Group Capacity Used"),
    description: translationKey(
      "The capacity each storage group's volumes use, in bytes, by its storage_group label.",
    ),
    metricName: M.storageGroupUsedBytes,
    category: "Volumes",
    unit: "bytes",
    objectLabel: L.storageGroup,
  }),
  entry({
    id: IDS.storageGroupHostIoLimitExceeded,
    friendlyName: translationKey("Host I/O Limit Exceeded (%)"),
    description: translationKey(
      "Share of the interval each storage group spent held back by its host I/O limit, in percent. Only storage groups with a limit set report it.",
    ),
    metricName: M.storageGroupHostIoLimitExceededPercent,
    category: "Volumes",
    unit: "%",
    objectLabel: L.storageGroup,
  }),
  entry({
    id: IDS.storageGroupRealtimeResponseTime,
    friendlyName: translationKey("Storage Group Response Time (Real Time)"),
    description: translationKey(
      "Response time of the storage groups registered for real-time collection in Unisphere, in microseconds, every 5 seconds. Up to 100 storage groups per array can be registered.",
    ),
    metricName: M.storageGroupRealtimeResponseTime,
    category: "Volumes",
    unit: "µs",
    objectLabel: L.storageGroup,
  }),
  entry({
    id: IDS.storageGroupRealtimeIops,
    friendlyName: translationKey("Storage Group IOPS (Real Time)"),
    description: translationKey(
      "Host I/Os per second of the storage groups registered for real-time collection, every 5 seconds.",
    ),
    metricName: M.storageGroupRealtimeIops,
    category: "Volumes",
    unit: "ops/s",
    objectLabel: L.storageGroup,
  }),
  entry({
    id: IDS.storageGroupRealtimeThroughput,
    friendlyName: translationKey("Storage Group Throughput (Real Time)"),
    description: translationKey(
      "Bytes per second of the storage groups registered for real-time collection, every 5 seconds.",
    ),
    metricName: M.storageGroupRealtimeThroughput,
    category: "Volumes",
    unit: "bytes/s",
    objectLabel: L.storageGroup,
  }),
  entry({
    id: IDS.volumeResponseTime,
    friendlyName: translationKey("Volume Response Time"),
    description: translationKey(
      "Average time an I/O takes for each volume, in microseconds, by its volume label. Unisphere reports it only for volumes of storage groups registered for real-time collection.",
    ),
    metricName: M.volumeResponseTime,
    category: "Volumes",
    unit: "µs",
    scope: StorageArrayResourceScope.Volume,
  }),
  entry({
    id: IDS.volumeIops,
    friendlyName: translationKey("Volume IOPS"),
    description: translationKey(
      "Host I/Os per second for each volume, by its volume label, for volumes of storage groups registered for real-time collection.",
    ),
    metricName: M.volumeIops,
    category: "Volumes",
    unit: "ops/s",
    scope: StorageArrayResourceScope.Volume,
  }),
  entry({
    id: IDS.volumeUsed,
    friendlyName: translationKey("Volume Capacity Used"),
    description: translationKey(
      "The capacity each volume uses, in bytes, by its volume label.",
    ),
    metricName: M.volumeUsedBytes,
    category: "Volumes",
    unit: "bytes",
    scope: StorageArrayResourceScope.Volume,
  }),
  entry({
    id: IDS.srpResponseTime,
    friendlyName: translationKey("Storage Resource Pool Response Time"),
    description: translationKey(
      "Average time an I/O takes in each storage resource pool, in microseconds, by its srp label.",
    ),
    metricName: M.srpResponseTime,
    category: "Performance",
    unit: "µs",
    objectLabel: L.srp,
  }),

  // ---------------- Hardware ----------------
  entry({
    id: IDS.directorOffline,
    friendlyName: translationKey("Director Not Online"),
    description: translationKey(
      "One series per director that is not online (value 1), with its director, role and status labels. The series is absent while every director is online.",
    ),
    metricName: M.directorOffline,
    category: "Hardware",
    unit: "count",
    scope: StorageArrayResourceScope.Hardware,
  }),
  entry({
    id: IDS.directorBusy,
    friendlyName: translationKey("Director Busy (%)"),
    description: translationKey(
      "How busy each director is, in percent, by its component label (such as FA-1D).",
    ),
    metricName: M.directorBusyPercent,
    category: "Hardware",
    unit: "%",
    scope: StorageArrayResourceScope.Hardware,
  }),
  entry({
    id: IDS.portOffline,
    friendlyName: translationKey("Port In Use Not Online"),
    description: translationKey(
      "One series per port that serves hosts or SRDF (in a port group, a masking view or an SRDF group) but is not up (value 1), with its component, protocol and status labels. Ports nobody uses are left out: they may be off on purpose.",
    ),
    metricName: M.portOffline,
    category: "Hardware",
    unit: "count",
    scope: StorageArrayResourceScope.Hardware,
  }),
  entry({
    id: IDS.portBusy,
    friendlyName: translationKey("Port Busy (%)"),
    description: translationKey(
      "How busy each port is, in percent, by its component label (such as FA-1D:4).",
    ),
    metricName: M.portBusyPercent,
    category: "Hardware",
    unit: "%",
    scope: StorageArrayResourceScope.Hardware,
  }),
  entry({
    id: IDS.portThroughput,
    friendlyName: translationKey("Port Read Throughput"),
    description: translationKey(
      "Bytes per second read through each port, by its component label.",
    ),
    metricName: M.portReadThroughput,
    category: "Hardware",
    unit: "bytes/s",
    scope: StorageArrayResourceScope.Hardware,
  }),
  entry({
    id: IDS.portRxPower,
    friendlyName: translationKey("Port Received Light Power"),
    description: translationKey(
      "The light power each optical port receives, in milliwatts, by its component label. A falling value is an optic or cable going bad. Needs Unisphere 10.3 or later.",
    ),
    metricName: M.portRxPowerMilliwatts,
    category: "Hardware",
    unit: "mW",
    scope: StorageArrayResourceScope.Hardware,
    aggregation: MetricsAggregationType.Min,
  }),

  // ---------------- Replication ----------------
  entry({
    id: IDS.srdfNotHealthy,
    friendlyName: translationKey("SRDF Group Not Healthy"),
    description: translationKey(
      "One series per SRDF group whose link is offline or whose pairs are suspended, partitioned, split, failed over or invalid (value 1), with its srdf_group, state and remote_symmetrix_id labels. The series is absent while the group replicates.",
    ),
    metricName: M.srdfGroupNotHealthy,
    category: "Replication",
    unit: "count",
    objectLabel: L.srdfGroup,
  }),
  entry({
    id: IDS.srdfLag,
    friendlyName: translationKey("SRDF/A Lag"),
    description: translationKey(
      "How far each asynchronous SRDF group's remote copy is behind, in seconds, by its srdf_group label. A failover now would lose the writes of that long.",
    ),
    metricName: M.srdfGroupLagSeconds,
    category: "Replication",
    unit: "s",
    objectLabel: L.srdfGroup,
  }),
  entry({
    id: IDS.srdfThroughput,
    friendlyName: translationKey("SRDF Throughput"),
    description: translationKey(
      "Bytes per second each SRDF group sends to its remote array, by its srdf_group label.",
    ),
    metricName: M.srdfGroupThroughput,
    category: "Replication",
    unit: "bytes/s",
    objectLabel: L.srdfGroup,
  }),
  entry({
    id: IDS.srdfResponseTime,
    friendlyName: translationKey("SRDF Response Time"),
    description: translationKey(
      "Average time a replicated write takes to reach the remote array for each SRDF group, in microseconds, by its srdf_group label.",
    ),
    metricName: M.srdfGroupResponseTime,
    category: "Replication",
    unit: "µs",
    objectLabel: L.srdfGroup,
  }),
];

export default POWERMAX_METRIC_DEFINITIONS;
