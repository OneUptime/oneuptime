/*
 * DELL POWERMAX: THE SERIES A PROBE SENDS, AND THE LABELS THEY CARRY.
 *
 * PowerMax has no metrics endpoint of its own: a OneUptime probe reads every
 * array behind a Unisphere for PowerMax from its REST API and writes these
 * series (packages/Probe/Utils/StorageArray/Dell/PowerMax). This file is the
 * one place their names and labels are spelled: the probe builds them from
 * it, the extractor (Common/Server/Utils/Telemetry/StorageArray/Dell/
 * PowerMaxExtractor) reads them with it, and the catalog and templates name
 * them through it, so the three can never drift apart.
 *
 * Every value is a gauge Unisphere computed for its last 5-minute diagnostic
 * interval (or a 5-second real-time sample, for the storage groups a person
 * registered for real time), converted to the units every storage platform
 * uses here: response times in microseconds, throughput in bytes per second,
 * capacity in bytes.
 *
 * This file imports nothing that leads back to the registry (see
 * StorageArrayPlatformImportsGuard.test.ts).
 */

import StorageArrayResourceKind from "../../../StorageArrayResourceKind";

export const POWERMAX_METRIC_PREFIX: string = "powermax_";

// The kinds only PowerMax has. Volumes and ports are the shared kinds.
export const PowerMaxKind: {
  readonly StorageGroup: "StorageGroup";
  readonly StorageResourcePool: "StorageResourcePool";
  readonly Director: "Director";
  readonly SrdfGroup: "SrdfGroup";
} = {
  StorageGroup: "StorageGroup",
  StorageResourcePool: "StorageResourcePool",
  Director: "Director",
  SrdfGroup: "SrdfGroup",
};

// A PowerMax port is a shared network interface: FC, iSCSI, NVMe or SRDF.
export const POWERMAX_PORT_KIND: string =
  StorageArrayResourceKind.NetworkInterface;

/*
 * The `scrape_endpoint` a collection stamps on its powermax_inventory_listed
 * series, one per kind it listed in full: the kind's count is written, and
 * written 0 once its last object is gone. `array` says the open alerts were
 * read in full.
 */
export const POWERMAX_ENDPOINTS: {
  readonly array: "array";
  readonly storageGroups: "storage_groups";
  readonly volumes: "volumes";
  readonly srps: "srps";
  readonly directors: "directors";
  readonly ports: "ports";
  readonly srdfGroups: "srdf_groups";
} = {
  array: "array",
  storageGroups: "storage_groups",
  volumes: "volumes",
  srps: "srps",
  directors: "directors",
  ports: "ports",
  srdfGroups: "srdf_groups",
};

export const POWERMAX_LABELS: {
  readonly symmetrixId: "symmetrix_id";
  readonly model: "model";
  readonly microcode: "microcode";
  readonly unisphereVersion: "unisphere_version";
  readonly scrapeEndpoint: "scrape_endpoint";
  readonly storageGroup: "storage_group";
  readonly storageGroupType: "storage_group_type";
  readonly srp: "srp";
  readonly serviceLevel: "service_level";
  readonly realtime: "realtime";
  readonly volume: "volume";
  readonly volumeName: "volume_name";
  readonly emulation: "emulation";
  readonly status: "status";
  readonly director: "director";
  readonly directorType: "director_type";
  readonly role: "role";
  readonly engine: "engine";
  readonly slot: "slot";
  readonly port: "port";
  readonly portId: "port_id";
  readonly component: "component";
  readonly protocol: "protocol";
  readonly portType: "port_type";
  readonly inUse: "in_use";
  readonly srdfGroup: "srdf_group";
  readonly srdfLabel: "srdf_label";
  readonly remoteSymmetrixId: "remote_symmetrix_id";
  readonly remoteSrdfGroup: "remote_srdf_group";
  readonly mode: "mode";
  readonly state: "state";
  readonly alertId: "alert_id";
  readonly severity: "severity";
  readonly alertType: "alert_type";
  readonly object: "object";
  readonly objectType: "object_type";
  readonly description: "description";
  readonly created: "created";
  readonly healthMetric: "health_metric";
  readonly operation: "operation";
  readonly collection: "collection";
} = {
  symmetrixId: "symmetrix_id",
  model: "model",
  microcode: "microcode",
  unisphereVersion: "unisphere_version",
  scrapeEndpoint: "scrape_endpoint",
  storageGroup: "storage_group",
  storageGroupType: "storage_group_type",
  srp: "srp",
  serviceLevel: "service_level",
  realtime: "realtime",
  volume: "volume",
  volumeName: "volume_name",
  emulation: "emulation",
  status: "status",
  director: "director",
  directorType: "director_type",
  role: "role",
  engine: "engine",
  slot: "slot",
  port: "port",
  portId: "port_id",
  component: "component",
  protocol: "protocol",
  portType: "port_type",
  inUse: "in_use",
  srdfGroup: "srdf_group",
  srdfLabel: "srdf_label",
  remoteSymmetrixId: "remote_symmetrix_id",
  remoteSrdfGroup: "remote_srdf_group",
  mode: "mode",
  state: "state",
  alertId: "alert_id",
  severity: "severity",
  alertType: "alert_type",
  object: "object",
  objectType: "object_type",
  description: "description",
  created: "created",
  healthMetric: "health_metric",
  operation: "operation",
  collection: "collection",
};

/*
 * The resource attribute every array's batch carries besides
 * `storage.array.name` and `storage.system`: the Symmetrix ID, by which the
 * server finds the array's row (StorageArray.systemId) and names the batch
 * after it, so an array renamed in OneUptime stays the same array.
 */
export const POWERMAX_SYMMETRIX_ID_ATTRIBUTE: string =
  "dell.powermax.symmetrix_id";

/*
 * A director's role, from the letters of its name (Dell's emulation codes):
 * front end serves hosts, back end serves drives, SRDF replicates to another
 * array, infrastructure runs the array itself.
 */
export type PowerMaxDirectorRole =
  | "frontend"
  | "backend"
  | "srdf"
  | "infrastructure";

// A director's status Unisphere reports when it serves I/O.
export const POWERMAX_DIRECTOR_ONLINE_STATUSES: ReadonlyArray<string> = [
  "online",
];

// A port's statuses that mean it is up.
export const POWERMAX_PORT_ONLINE_STATUSES: ReadonlyArray<string> = [
  "on",
  "online",
];

/*
 * SRDF pair states by what they mean for the copy on the other array: a
 * healthy pair keeps it current, a broken one does not. Unisphere spells
 * them "Failed Over", "FailedOver" or "failed_over" depending on the call,
 * so they are compared as normalizeSrdfState writes them: lowercase, with
 * no spaces, dashes or underscores.
 */
export const POWERMAX_SRDF_HEALTHY_STATES: ReadonlyArray<string> = [
  "synchronized",
  "consistent",
  "activeactive",
  "activebias",
  "syncinprog",
];

export const POWERMAX_SRDF_BROKEN_STATES: ReadonlyArray<string> = [
  "suspended",
  "partitioned",
  "failedover",
  "split",
  "transidle",
  "invalid",
  "r1updated",
  "r1updinprog",
];

// The `operation` label's values on powermax_array_response_time_usec.
export const POWERMAX_OPERATIONS: {
  readonly read: "read";
  readonly write: "write";
} = { read: "read", write: "write" };

export function normalizeSrdfState(state: string | null | undefined): string {
  return (state || "").toLowerCase().replace(/[\s_-]+/g, "");
}

export function isBrokenSrdfState(state: string | null | undefined): boolean {
  return POWERMAX_SRDF_BROKEN_STATES.includes(normalizeSrdfState(state));
}

export const POWERMAX_METRICS: {
  // ---- Array ----
  readonly arrayInfo: string;
  readonly inventoryListed: string;
  readonly arrayUsableBytes: string;
  readonly arrayUsedBytes: string;
  readonly arrayUsedPercent: string;
  readonly arraySubscribedBytes: string;
  readonly arrayDataReductionRatio: string;
  readonly arrayHealthScore: string;
  readonly arrayPerformanceCollection: string;
  readonly arrayIops: string;
  readonly arrayReadIops: string;
  readonly arrayWriteIops: string;
  readonly arrayThroughput: string;
  readonly arrayReadThroughput: string;
  readonly arrayWriteThroughput: string;
  readonly arrayResponseTime: string;
  readonly arrayCacheHitPercent: string;
  readonly arrayWritePendingPercent: string;
  readonly arrayFrontEndBusyPercent: string;
  readonly arrayBackEndBusyPercent: string;
  readonly arraySrdfBusyPercent: string;
  readonly alertOpen: string;
  // ---- Storage groups ----
  readonly storageGroupInfo: string;
  readonly storageGroupCapacityBytes: string;
  readonly storageGroupUsedBytes: string;
  readonly storageGroupVolumes: string;
  readonly storageGroupDataReductionRatio: string;
  readonly storageGroupResponseTime: string;
  readonly storageGroupReadResponseTime: string;
  readonly storageGroupWriteResponseTime: string;
  readonly storageGroupIops: string;
  readonly storageGroupReadIops: string;
  readonly storageGroupWriteIops: string;
  readonly storageGroupThroughput: string;
  readonly storageGroupReadThroughput: string;
  readonly storageGroupWriteThroughput: string;
  readonly storageGroupCacheHitPercent: string;
  readonly storageGroupHostIoLimitExceededPercent: string;
  readonly storageGroupRealtimeResponseTime: string;
  readonly storageGroupRealtimeReadResponseTime: string;
  readonly storageGroupRealtimeWriteResponseTime: string;
  readonly storageGroupRealtimeIops: string;
  readonly storageGroupRealtimeThroughput: string;
  // ---- Volumes ----
  readonly volumeInfo: string;
  readonly volumeCapacityBytes: string;
  readonly volumeUsedBytes: string;
  readonly volumeResponseTime: string;
  readonly volumeReadResponseTime: string;
  readonly volumeWriteResponseTime: string;
  readonly volumeIops: string;
  readonly volumeThroughput: string;
  // ---- SRPs ----
  readonly srpInfo: string;
  readonly srpUsableBytes: string;
  readonly srpUsedBytes: string;
  readonly srpUsedPercent: string;
  readonly srpSubscribedBytes: string;
  readonly srpDataReductionRatio: string;
  readonly srpResponseTime: string;
  readonly srpIops: string;
  readonly srpThroughput: string;
  // ---- Directors ----
  readonly directorInfo: string;
  readonly directorOffline: string;
  readonly directorBusyPercent: string;
  readonly directorIops: string;
  readonly directorThroughput: string;
  readonly directorReadResponseTime: string;
  readonly directorWriteResponseTime: string;
  // ---- Ports ----
  readonly portInfo: string;
  readonly portOffline: string;
  readonly portSpeedBytes: string;
  readonly portBusyPercent: string;
  readonly portIops: string;
  readonly portReadThroughput: string;
  readonly portWriteThroughput: string;
  readonly portResponseTime: string;
  readonly portRxPowerMilliwatts: string;
  readonly portTxPowerMilliwatts: string;
  // ---- SRDF groups ----
  readonly srdfGroupInfo: string;
  readonly srdfGroupNotHealthy: string;
  readonly srdfGroupLagSeconds: string;
  readonly srdfGroupVolumes: string;
  readonly srdfGroupCapacityBytes: string;
  readonly srdfGroupThroughput: string;
  readonly srdfGroupResponseTime: string;
  readonly srdfGroupCycleTimeSeconds: string;
} = {
  /*
   * The array's identity (value 1), every collection: model, PowerMaxOS
   * (microcode), the Unisphere it is read through. Counted by "Array
   * Stopped Reporting".
   */
  arrayInfo: "powermax_array_info",
  /*
   * One series per kind the collection listed in full (value: how many),
   * with the kind's endpoint in `scrape_endpoint`.
   */
  inventoryListed: "powermax_inventory_listed",
  arrayUsableBytes: "powermax_array_capacity_usable_bytes",
  arrayUsedBytes: "powermax_array_capacity_used_bytes",
  arrayUsedPercent: "powermax_array_capacity_used_percent",
  arraySubscribedBytes: "powermax_array_capacity_subscribed_bytes",
  arrayDataReductionRatio: "powermax_array_data_reduction_ratio",
  // Unisphere's health score per `health_metric` (overall, capacity, ...).
  arrayHealthScore: "powermax_array_health_score",
  /*
   * 1 while Unisphere collects 5-minute diagnostic performance for the
   * array, 0 while it does not; `realtime` says whether real-time collection
   * is on too.
   */
  arrayPerformanceCollection: "powermax_array_performance_collection",
  arrayIops: "powermax_array_iops",
  arrayReadIops: "powermax_array_read_iops",
  arrayWriteIops: "powermax_array_write_iops",
  arrayThroughput: "powermax_array_throughput_bytes",
  arrayReadThroughput: "powermax_array_read_throughput_bytes",
  arrayWriteThroughput: "powermax_array_write_throughput_bytes",
  /*
   * The response time hosts see, per `operation` (read, write): one series
   * name, as the overview's latency reading and its alerts read it.
   */
  arrayResponseTime: "powermax_array_response_time_usec",
  arrayCacheHitPercent: "powermax_array_cache_hit_percent",
  arrayWritePendingPercent: "powermax_array_write_pending_percent",
  arrayFrontEndBusyPercent: "powermax_array_frontend_busy_percent",
  arrayBackEndBusyPercent: "powermax_array_backend_busy_percent",
  arraySrdfBusyPercent: "powermax_array_srdf_busy_percent",
  /*
   * One series per open Unisphere alert (value 1): not acknowledged, not
   * cleared, Minor or worse, with its id, severity, type, object and words.
   */
  alertOpen: "powermax_alert_open",

  storageGroupInfo: "powermax_storage_group_info",
  storageGroupCapacityBytes: "powermax_storage_group_capacity_bytes",
  storageGroupUsedBytes: "powermax_storage_group_used_bytes",
  storageGroupVolumes: "powermax_storage_group_volumes",
  storageGroupDataReductionRatio: "powermax_storage_group_data_reduction_ratio",
  storageGroupResponseTime: "powermax_storage_group_response_time_usec",
  storageGroupReadResponseTime:
    "powermax_storage_group_read_response_time_usec",
  storageGroupWriteResponseTime:
    "powermax_storage_group_write_response_time_usec",
  storageGroupIops: "powermax_storage_group_iops",
  storageGroupReadIops: "powermax_storage_group_read_iops",
  storageGroupWriteIops: "powermax_storage_group_write_iops",
  storageGroupThroughput: "powermax_storage_group_throughput_bytes",
  storageGroupReadThroughput: "powermax_storage_group_read_throughput_bytes",
  storageGroupWriteThroughput: "powermax_storage_group_write_throughput_bytes",
  storageGroupCacheHitPercent: "powermax_storage_group_cache_hit_percent",
  storageGroupHostIoLimitExceededPercent:
    "powermax_storage_group_host_io_limit_exceeded_percent",
  // 5-second samples, for the storage groups registered for real time.
  storageGroupRealtimeResponseTime:
    "powermax_storage_group_realtime_response_time_usec",
  storageGroupRealtimeReadResponseTime:
    "powermax_storage_group_realtime_read_response_time_usec",
  storageGroupRealtimeWriteResponseTime:
    "powermax_storage_group_realtime_write_response_time_usec",
  storageGroupRealtimeIops: "powermax_storage_group_realtime_iops",
  storageGroupRealtimeThroughput:
    "powermax_storage_group_realtime_throughput_bytes",

  volumeInfo: "powermax_volume_info",
  volumeCapacityBytes: "powermax_volume_capacity_bytes",
  volumeUsedBytes: "powermax_volume_used_bytes",
  // Only for volumes of storage groups registered for real time.
  volumeResponseTime: "powermax_volume_response_time_usec",
  volumeReadResponseTime: "powermax_volume_read_response_time_usec",
  volumeWriteResponseTime: "powermax_volume_write_response_time_usec",
  volumeIops: "powermax_volume_iops",
  volumeThroughput: "powermax_volume_throughput_bytes",

  srpInfo: "powermax_srp_info",
  srpUsableBytes: "powermax_srp_capacity_usable_bytes",
  srpUsedBytes: "powermax_srp_capacity_used_bytes",
  srpUsedPercent: "powermax_srp_capacity_used_percent",
  srpSubscribedBytes: "powermax_srp_capacity_subscribed_bytes",
  srpDataReductionRatio: "powermax_srp_data_reduction_ratio",
  srpResponseTime: "powermax_srp_response_time_usec",
  srpIops: "powermax_srp_iops",
  srpThroughput: "powermax_srp_throughput_bytes",

  directorInfo: "powermax_director_info",
  // 1 while a director is not online; absent otherwise.
  directorOffline: "powermax_director_offline",
  directorBusyPercent: "powermax_director_busy_percent",
  directorIops: "powermax_director_iops",
  directorThroughput: "powermax_director_throughput_bytes",
  directorReadResponseTime: "powermax_director_read_response_time_usec",
  directorWriteResponseTime: "powermax_director_write_response_time_usec",

  portInfo: "powermax_port_info",
  /*
   * 1 while a port that serves hosts or SRDF (in a port group, a masking
   * view or an SRDF group) is not up; absent otherwise. A port nobody uses
   * may be off on purpose.
   */
  portOffline: "powermax_port_offline",
  portSpeedBytes: "powermax_port_speed_bytes",
  portBusyPercent: "powermax_port_busy_percent",
  portIops: "powermax_port_iops",
  portReadThroughput: "powermax_port_read_throughput_bytes",
  portWriteThroughput: "powermax_port_write_throughput_bytes",
  portResponseTime: "powermax_port_response_time_usec",
  portRxPowerMilliwatts: "powermax_port_rx_power_milliwatts",
  portTxPowerMilliwatts: "powermax_port_tx_power_milliwatts",

  srdfGroupInfo: "powermax_srdf_group_info",
  /*
   * 1 while an SRDF group's link is offline or one of its pairs is
   * suspended, partitioned, split, failed over or invalid; absent otherwise.
   */
  srdfGroupNotHealthy: "powermax_srdf_group_not_healthy",
  // How far the remote copy is behind (SRDF/A only), in seconds.
  srdfGroupLagSeconds: "powermax_srdf_group_lag_seconds",
  srdfGroupVolumes: "powermax_srdf_group_volumes",
  srdfGroupCapacityBytes: "powermax_srdf_group_capacity_bytes",
  srdfGroupThroughput: "powermax_srdf_group_throughput_bytes",
  srdfGroupResponseTime: "powermax_srdf_group_response_time_usec",
  srdfGroupCycleTimeSeconds: "powermax_srdf_group_cycle_time_seconds",
};

/*
 * The 5-minute diagnostic performance categories a collection reads, by the
 * name Unisphere's performance-categories endpoint uses.
 */
export const POWERMAX_PERFORMANCE_CATEGORIES: {
  readonly array: "Array";
  readonly storageGroup: "StorageGroup";
  readonly srp: "SRP";
  readonly frontEndDirector: "FEDirector";
  readonly frontEndPort: "FEPort";
  readonly backEndDirector: "BEDirector";
  readonly backEndPort: "BEPort";
  readonly srdfDirector: "RDFDirector";
  readonly srdfPort: "RDFPort";
  readonly srdfAsync: "RDFA";
  readonly srdfSync: "RDFS";
} = {
  array: "Array",
  storageGroup: "StorageGroup",
  srp: "SRP",
  frontEndDirector: "FEDirector",
  frontEndPort: "FEPort",
  backEndDirector: "BEDirector",
  backEndPort: "BEPort",
  srdfDirector: "RDFDirector",
  srdfPort: "RDFPort",
  srdfAsync: "RDFA",
  srdfSync: "RDFS",
};

/*
 * The series the extractor reads into the inventory and the snapshot
 * (StorageArrayPlatform.snapshotMetricNames). Every other series stays in
 * ClickHouse, for the charts and monitors.
 */
export const POWERMAX_SNAPSHOT_METRIC_NAMES: ReadonlyArray<string> = [
  POWERMAX_METRICS.arrayInfo,
  POWERMAX_METRICS.inventoryListed,
  POWERMAX_METRICS.arrayUsableBytes,
  POWERMAX_METRICS.arrayUsedBytes,
  POWERMAX_METRICS.arrayUsedPercent,
  POWERMAX_METRICS.arrayDataReductionRatio,
  POWERMAX_METRICS.alertOpen,
  POWERMAX_METRICS.storageGroupInfo,
  POWERMAX_METRICS.storageGroupCapacityBytes,
  POWERMAX_METRICS.storageGroupUsedBytes,
  POWERMAX_METRICS.storageGroupDataReductionRatio,
  POWERMAX_METRICS.storageGroupReadResponseTime,
  POWERMAX_METRICS.storageGroupWriteResponseTime,
  POWERMAX_METRICS.storageGroupReadIops,
  POWERMAX_METRICS.storageGroupWriteIops,
  POWERMAX_METRICS.storageGroupReadThroughput,
  POWERMAX_METRICS.storageGroupWriteThroughput,
  POWERMAX_METRICS.volumeInfo,
  POWERMAX_METRICS.volumeCapacityBytes,
  POWERMAX_METRICS.volumeUsedBytes,
  POWERMAX_METRICS.volumeReadResponseTime,
  POWERMAX_METRICS.volumeWriteResponseTime,
  POWERMAX_METRICS.srpInfo,
  POWERMAX_METRICS.srpUsableBytes,
  POWERMAX_METRICS.srpUsedBytes,
  POWERMAX_METRICS.srpDataReductionRatio,
  POWERMAX_METRICS.directorInfo,
  POWERMAX_METRICS.portInfo,
  POWERMAX_METRICS.portSpeedBytes,
  POWERMAX_METRICS.portReadThroughput,
  POWERMAX_METRICS.portWriteThroughput,
  POWERMAX_METRICS.srdfGroupInfo,
  POWERMAX_METRICS.srdfGroupLagSeconds,
  POWERMAX_METRICS.srdfGroupCapacityBytes,
];
