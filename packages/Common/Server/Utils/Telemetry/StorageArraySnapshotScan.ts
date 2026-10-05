import OneUptimeDate from "../../../Types/Date";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import StorageArrayResourceKind from "../../../Types/StorageArray/StorageArrayResourceKind";
import StorageSystem, {
  StorageSystemUtil,
} from "../../../Types/StorageArray/StorageSystem";
import logger from "../Logger";

/*
 * ------------------------------------------------------------------
 * Storage array snapshot scan — pure fold & derive helpers
 * ------------------------------------------------------------------
 *
 * The storage array counterpart of ProxmoxCephSnapshotScan. The ingest
 * service owns the I/O: it walks the OTLP payload, calls
 * bufferStorageArraySnapshotMetric per datapoint of a batch whose resource
 * carries `storage.array.name`, and at flush time maps the folded buffers
 * through deriveStorageArraySnapshotExtras / getStorageArrayResourceRows
 * before handing the results to StorageArrayResourceService /
 * StorageArrayService. Everything in this module is pure (Map/object
 * mutation only — no DB, no network), which is what makes the semantics
 * unit-testable:
 *
 *   - identity labels fold first-non-null-wins; status/metric fields fold
 *     newest-observedAt-wins,
 *   - count, capacity, alert and health columns are only derived when the
 *     batch carried the matching series (never zero a column on a partial
 *     batch — a FlashArray's /metrics/volumes scrape carries no alert or
 *     capacity series),
 *   - metric names outside STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES are skipped.
 *
 * Sources: FlashArray series come from Purity//FA's native OpenMetrics
 * endpoint (or the deprecated pure-fa-openmetrics-exporter — same names and
 * labels), FlashBlade series from pure-fb-openmetrics-exporter. Every value
 * is a gauge the array computes itself (usec_per_read_op,
 * reads_per_sec, read_bytes_per_sec), so no rate math happens here.
 * Identity lives in datapoint labels (`name`, `host`, `component_name`),
 * exactly like ceph-mgr's `ceph_daemon`.
 */

export const STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES: ReadonlySet<string> = new Set(
  [
    // FlashArray — array identity, capacity, alerts
    "purefa_info",
    "purefa_alerts_open",
    "purefa_array_space_bytes",
    "purefa_array_space_utilization",
    "purefa_array_space_data_reduction_ratio",
    // FlashArray — hardware
    "purefa_hw_component_status",
    "purefa_hw_component_temperature_celsius",
    "purefa_drive_capacity_bytes",
    "purefa_hw_controller_info",
    "purefa_network_interface_speed_bandwidth_bytes",
    "purefa_network_interface_performance_bandwidth_bytes",
    "purefa_network_interface_performance_errors",
    // FlashArray — volumes
    "purefa_volume_space_bytes",
    "purefa_volume_space_data_reduction_ratio",
    "purefa_volume_performance_latency_usec",
    "purefa_volume_performance_throughput_iops",
    "purefa_volume_performance_bandwidth_bytes",
    "purefa_volume_qos_iops_limit",
    "purefa_volume_qos_bandwidth_bytes_per_sec_limit",
    // FlashArray — hosts
    "purefa_host_connectivity_info",
    "purefa_host_connections_info",
    "purefa_host_space_bytes",
    "purefa_host_space_size_bytes",
    "purefa_host_space_data_reduction_ratio",
    "purefa_host_performance_latency_usec",
    "purefa_host_performance_throughput_iops",
    "purefa_host_performance_bandwidth_bytes",
    // FlashArray — pods (ActiveCluster / ActiveDR)
    "purefa_pod_space_bytes",
    "purefa_pod_space_data_reduction_ratio",
    "purefa_pod_performance_latency_usec",
    "purefa_pod_performance_throughput_iops",
    "purefa_pod_performance_bandwidth_bytes",
    "purefa_pod_replica_links_lag_max_msec",
    "purefa_pod_replica_links_lag_average_msec",
    "purefa_pod_mediator_status",
    // FlashArray — file directories
    "purefa_directory_space_bytes",
    "purefa_directory_space_data_reduction_ratio",
    "purefa_directory_performance_latency_usec",
    "purefa_directory_performance_throughput_iops",
    "purefa_directory_performance_bandwidth_bytes",
    // FlashBlade — array identity, capacity, alerts, hardware
    "purefb_info",
    "purefb_alerts_open",
    "purefb_array_space_bytes",
    "purefb_array_space_utilization",
    "purefb_array_space_data_reduction_ratio",
    "purefb_hardware_health",
    // FlashBlade — file systems
    "purefb_file_systems_space_bytes",
    "purefb_file_systems_space_data_reduction_ratio",
    "purefb_file_systems_performance_latency_usec",
    "purefb_file_systems_performance_throughput_iops",
    "purefb_file_systems_performance_bandwidth_bytes",
    // FlashBlade — buckets
    "purefb_buckets_space_bytes",
    "purefb_buckets_quota_space_bytes",
    "purefb_buckets_space_data_reduction_ratio",
    "purefb_buckets_object_count",
    "purefb_buckets_performance_latency_usec",
    "purefb_buckets_performance_throughput_iops",
    "purefb_buckets_performance_bandwidth_bytes",
  ],
);

/*
 * One object of an array (volume, host, pod, hardware component, ...)
 * folded across a batch. Same merge semantics as CephResourceBufferEntry.
 */
export interface StorageArrayResourceBufferEntry {
  kind: string;
  externalId: string;
  name: string | null;
  status: string | null;
  statusDetail: string | null;
  componentType: string | null;
  model: string | null;
  firmwareVersion: string | null;
  groupName: string | null;
  capacityBytes: number | null;
  usedBytes: number | null;
  dataReductionRatio: number | null;
  readLatencyUsec: number | null;
  writeLatencyUsec: number | null;
  readIops: number | null;
  writeIops: number | null;
  readBytesPerSec: number | null;
  writeBytesPerSec: number | null;
  temperatureCelsius: number | null;
  replicationLagMs: number | null;
  connectionCount: number | null;
  details: JSONObject;
  observedAt: Date;
}

// Per-array snapshot state — same saw* contract as the Ceph cluster buffer.
export interface StorageArraySnapshotBufferEntry {
  // Detected from the metric names the batch carried.
  storageSystem: StorageSystem | null;
  reportedName: string | null;
  systemId: string | null;
  osName: string | null;
  osVersion: string | null;
  /*
   * The batch carried an open-alert series, or the array endpoint itself
   * (its space series, or a `scrape_endpoint` label naming it). An array
   * with no open alerts exports no purefa_alerts_open series at all, so
   * seeing the array endpoint is what lets the counts fall back to 0.
   */
  sawAlerts: boolean;
  // Alert identity keys, so a batch that holds two scrapes counts each once.
  openAlertKeys: Set<string>;
  criticalAlertKeys: Set<string>;
  warningAlertKeys: Set<string>;
  capacityBytes: number | null;
  emptyBytes: number | null;
  utilizationPercent: number | null;
  dataReductionRatio: number | null;
  sawHardware: boolean;
  sawDrives: boolean;
  sawControllers: boolean;
  sawVolumes: boolean;
  sawHosts: boolean;
  sawPods: boolean;
  sawFileSystems: boolean;
  sawBuckets: boolean;
  // purefa_host_connections_info: host -> volumes, volume -> hosts.
  volumesByHost: Map<string, Set<string>>;
  hostsByVolume: Map<string, Set<string>>;
  connectionsObservedAt: Date | null;
}

// The StorageArray snapshot columns derived from one folded batch.
export interface StorageArraySnapshotDerivedExtras {
  storageSystem?: string | undefined;
  reportedName?: string | undefined;
  systemId?: string | undefined;
  osName?: string | undefined;
  osVersion?: string | undefined;
  capacityBytes?: number | undefined;
  usedBytes?: number | undefined;
  capacityUsedPercent?: number | undefined;
  dataReductionRatio?: number | undefined;
  openAlertCount?: number | undefined;
  criticalAlertCount?: number | undefined;
  warningAlertCount?: number | undefined;
  volumeCount?: number | undefined;
  hostCount?: number | undefined;
  podCount?: number | undefined;
  fileSystemCount?: number | undefined;
  bucketCount?: number | undefined;
  hardwareComponentCount?: number | undefined;
  unhealthyHardwareCount?: number | undefined;
  healthStatus?: number | undefined;
}

// StorageArray.healthStatus values — same scale as CephCluster.healthStatus.
export enum StorageArrayHealthStatus {
  Ok = 0,
  Warning = 1,
  Critical = 2,
}

/*
 * Hardware, drive and controller statuses, lowercased, as the arrays report
 * them (purefa_hw_component_status component_status, purefa_drive_capacity
 * component_status, purefa_hw_controller_info status, purefb_hardware_health
 * mapped to healthy / unused / unhealthy).
 */
const CRITICAL_COMPONENT_STATUSES: ReadonlySet<string> = new Set([
  "critical",
  "failed",
  "missing",
  "unhealthy",
]);

const WARNING_COMPONENT_STATUSES: ReadonlySet<string> = new Set([
  "degraded",
  "unknown",
  "unrecognized",
  "not ready",
]);

export function isUnhealthyComponentStatus(
  status: string | null | undefined,
): boolean {
  if (!status) {
    return false;
  }
  const normalized: string = status.trim().toLowerCase();
  return (
    CRITICAL_COMPONENT_STATUSES.has(normalized) ||
    WARNING_COMPONENT_STATUSES.has(normalized)
  );
}

export function isCriticalComponentStatus(
  status: string | null | undefined,
): boolean {
  if (!status) {
    return false;
  }
  return CRITICAL_COMPONENT_STATUSES.has(status.trim().toLowerCase());
}

const HARDWARE_KINDS: ReadonlySet<string> = new Set([
  StorageArrayResourceKind.Hardware,
  StorageArrayResourceKind.Drive,
  StorageArrayResourceKind.Controller,
]);

/*
 * Same finite-or-null coercion contract as the ingest service's
 * toNumberOrNull (NaN / ±Infinity fold to null so a malformed datapoint is
 * skipped rather than poisoning a snapshot column).
 */
function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed: number = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

// Same fall-back-to-now parse contract as ProxmoxCephSnapshotScan.
function parseUnixNanoToDate(
  value: string | number | undefined,
  context: string,
): Date {
  if (value !== undefined && value !== null) {
    try {
      if (typeof value === "string") {
        const trimmed: string = value.trim();
        if (trimmed === "" || isNaN(Number(trimmed))) {
          throw new Error(`Invalid timestamp string: ${value}`);
        }
        return OneUptimeDate.fromUnixNano(trimmed);
      }
      if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          throw new Error(`Invalid timestamp number: ${value}`);
        }
        return OneUptimeDate.fromUnixNano(value);
      }
    } catch (error) {
      logger.warn(
        `Error processing ${context}: ${error instanceof Error ? error.message : String(error)}, using current time`,
      );
    }
  }

  return OneUptimeDate.getCurrentDate();
}

// Same trim-or-null read contract as OtelIngestBaseService.getStringAttribute.
function getStringAttribute(attributes: JSONArray, key: string): string | null {
  for (const attribute of attributes) {
    if (
      attribute["key"] === key &&
      attribute["value"] &&
      (attribute["value"] as JSONObject)["stringValue"] !== undefined
    ) {
      const value: JSONValue = (attribute["value"] as JSONObject)[
        "stringValue"
      ];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return null;
}

function lowerOrNull(value: string | null): string | null {
  return value ? value.toLowerCase() : null;
}

/*
 * The OneUptime Storage Array Agent labels every series with the endpoint
 * its scrape job read (static_configs labels: `scrape_endpoint: volumes`).
 * Every endpoint exports purefa_info / purefb_info, so that one series says
 * which families the batch is the COMPLETE list of — which is how an array
 * whose last volume was just deleted reports volumeCount 0 instead of
 * keeping the old count forever. Custom collector configs without the
 * label fall back to inferring it from the series a batch carried.
 */
export const SCRAPE_ENDPOINT_LABEL: string = "scrape_endpoint";

function markScrapedEndpoint(
  array: StorageArraySnapshotBufferEntry,
  endpoint: string | null,
): void {
  if (!endpoint) {
    return;
  }
  const value: string = endpoint.trim().toLowerCase();
  const all: boolean = value === "all" || value === "metrics";
  if (all || value === "array") {
    array.sawAlerts = true;
  }
  if (all || value === "volumes") {
    array.sawVolumes = true;
  }
  if (all || value === "hosts") {
    array.sawHosts = true;
  }
  if (all || value === "pods") {
    array.sawPods = true;
  }
  if (all || value === "filesystems") {
    array.sawFileSystems = true;
  }
  if (all || value === "objectstore") {
    array.sawBuckets = true;
  }
}

export function getOrCreateStorageArraySnapshot(
  buffer: Map<string, StorageArraySnapshotBufferEntry>,
  arrayIdStr: string,
): StorageArraySnapshotBufferEntry {
  let entry: StorageArraySnapshotBufferEntry | undefined =
    buffer.get(arrayIdStr);
  if (!entry) {
    entry = {
      storageSystem: null,
      reportedName: null,
      systemId: null,
      osName: null,
      osVersion: null,
      sawAlerts: false,
      openAlertKeys: new Set(),
      criticalAlertKeys: new Set(),
      warningAlertKeys: new Set(),
      capacityBytes: null,
      emptyBytes: null,
      utilizationPercent: null,
      dataReductionRatio: null,
      sawHardware: false,
      sawDrives: false,
      sawControllers: false,
      sawVolumes: false,
      sawHosts: false,
      sawPods: false,
      sawFileSystems: false,
      sawBuckets: false,
      volumesByHost: new Map(),
      hostsByVolume: new Map(),
      connectionsObservedAt: null,
    };
    buffer.set(arrayIdStr, entry);
  }
  return entry;
}

export function emptyStorageArrayResourceEntry(
  kind: string,
  externalId: string,
  observedAt: Date,
): StorageArrayResourceBufferEntry {
  return {
    kind,
    externalId,
    name: null,
    status: null,
    statusDetail: null,
    componentType: null,
    model: null,
    firmwareVersion: null,
    groupName: null,
    capacityBytes: null,
    usedBytes: null,
    dataReductionRatio: null,
    readLatencyUsec: null,
    writeLatencyUsec: null,
    readIops: null,
    writeIops: null,
    readBytesPerSec: null,
    writeBytesPerSec: null,
    temperatureCelsius: null,
    replicationLagMs: null,
    connectionCount: null,
    details: {},
    observedAt,
  };
}

/*
 * The four performance families every object kind shares — latency, IOPS
 * and bandwidth — keyed by the `dimension` label. Only the read / write
 * dimensions land in columns; the breakdowns (queue_usec_per_*, san_usec_*,
 * mirrored writes) stay in ClickHouse for the charts.
 */
function applyPerformanceDimension(
  patch: StorageArrayResourceBufferEntry,
  family: "latency" | "iops" | "bandwidth",
  dimension: string | null,
  value: number,
): boolean {
  if (!dimension) {
    return false;
  }
  const positive: number = Math.max(0, value);
  if (family === "latency") {
    if (dimension === "usec_per_read_op") {
      patch.readLatencyUsec = positive;
      return true;
    }
    if (dimension === "usec_per_write_op") {
      patch.writeLatencyUsec = positive;
      return true;
    }
    return false;
  }
  if (family === "iops") {
    if (dimension === "reads_per_sec") {
      patch.readIops = positive;
      return true;
    }
    if (dimension === "writes_per_sec") {
      patch.writeIops = positive;
      return true;
    }
    return false;
  }
  if (dimension === "read_bytes_per_sec") {
    patch.readBytesPerSec = positive;
    return true;
  }
  if (dimension === "write_bytes_per_sec") {
    patch.writeBytesPerSec = positive;
    return true;
  }
  return false;
}

function performanceFamily(
  metricName: string,
): "latency" | "iops" | "bandwidth" | null {
  if (metricName.endsWith("_performance_latency_usec")) {
    return "latency";
  }
  if (metricName.endsWith("_performance_throughput_iops")) {
    return "iops";
  }
  if (metricName.endsWith("_performance_bandwidth_bytes")) {
    return "bandwidth";
  }
  return null;
}

/*
 * The space families: FlashArray objects report `space` dimensions
 * total_provisioned (the size a host sees) and total_physical (what the
 * object occupies after data reduction); FlashBlade file systems and
 * buckets report the same two names.
 */
function applySpaceDimension(
  patch: StorageArrayResourceBufferEntry,
  space: string | null,
  value: number,
): boolean {
  if (space === "total_provisioned") {
    patch.capacityBytes = Math.max(0, Math.trunc(value));
    return true;
  }
  if (space === "total_physical") {
    patch.usedBytes = Math.max(0, Math.trunc(value));
    return true;
  }
  return false;
}

function alertKey(dpAttributes: JSONArray): string {
  return [
    "code",
    "name",
    "component_name",
    "component_type",
    "created",
    "summary",
  ]
    .map((label: string) => {
      return getStringAttribute(dpAttributes, label) || "";
    })
    .join("|");
}

function recordConnection(
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  let set: Set<string> | undefined = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

/*
 * Fold one purefa_* / purefb_* datapoint into the per-array buffers. Callers
 * pre-filter with STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES.
 */
export function bufferStorageArraySnapshotMetric(data: {
  arrayIdStr: string;
  metricName: string;
  datapoint: JSONObject;
  resourceBuffer: Map<string, Map<string, StorageArrayResourceBufferEntry>>;
  arrayBuffer: Map<string, StorageArraySnapshotBufferEntry>;
}): void {
  const valueFromInt: number | null = toNumberOrNull(data.datapoint["asInt"]);
  const valueFromDouble: number | null = toNumberOrNull(
    data.datapoint["asDouble"],
  );
  const rawValue: number | null = valueFromDouble ?? valueFromInt;
  if (rawValue === null) {
    return;
  }

  const observedAt: Date = parseUnixNanoToDate(
    data.datapoint["timeUnixNano"] as string | number | undefined,
    "storage array snapshot timeUnixNano",
  );

  const dpAttributes: JSONArray =
    (data.datapoint["attributes"] as JSONArray) || [];

  const array: StorageArraySnapshotBufferEntry =
    getOrCreateStorageArraySnapshot(data.arrayBuffer, data.arrayIdStr);

  const system: StorageSystem | null = StorageSystemUtil.fromMetricName(
    data.metricName,
  );
  if (system && !array.storageSystem) {
    array.storageSystem = system;
  }

  const label: (key: string) => string | null = (key: string) => {
    return getStringAttribute(dpAttributes, key);
  };

  const fold: (patch: StorageArrayResourceBufferEntry) => void = (
    patch: StorageArrayResourceBufferEntry,
  ) => {
    foldStorageArrayResourceSnapshot({
      buffer: data.resourceBuffer,
      arrayIdStr: data.arrayIdStr,
      patch,
    });
  };

  const metricName: string = data.metricName;

  // ---------------- Array-level series (no inventory row) ----------------

  if (metricName === "purefa_info" || metricName === "purefb_info") {
    array.reportedName = array.reportedName || label("array_name");
    array.systemId = array.systemId || label("system_id");
    array.osName = array.osName || label("os");
    array.osVersion = array.osVersion || label("version");
    markScrapedEndpoint(array, label(SCRAPE_ENDPOINT_LABEL));
    return;
  }

  if (
    metricName === "purefa_alerts_open" ||
    metricName === "purefb_alerts_open"
  ) {
    array.sawAlerts = true;
    const severity: string | null = lowerOrNull(label("severity"));
    // Hidden alerts are the array's own internal bookkeeping.
    if (severity === "hidden") {
      return;
    }
    const key: string = alertKey(dpAttributes);
    array.openAlertKeys.add(key);
    if (severity === "critical") {
      array.criticalAlertKeys.add(key);
    } else if (severity === "warning") {
      array.warningAlertKeys.add(key);
    }
    return;
  }

  if (
    metricName === "purefa_array_space_bytes" ||
    metricName === "purefb_array_space_bytes"
  ) {
    /*
     * FlashBlade reports array, file-system and object-store rows; only
     * the whole-array row describes the array.
     */
    if (
      metricName === "purefb_array_space_bytes" &&
      label("type") !== "array"
    ) {
      return;
    }
    // The array endpoint was scraped: its alert list is complete.
    array.sawAlerts = true;
    const space: string | null = label("space");
    if (space === "capacity") {
      array.capacityBytes = Math.max(0, rawValue);
    } else if (space === "empty") {
      array.emptyBytes = Math.max(0, rawValue);
    }
    return;
  }

  if (
    metricName === "purefa_array_space_utilization" ||
    metricName === "purefb_array_space_utilization"
  ) {
    if (
      metricName === "purefb_array_space_utilization" &&
      label("type") !== "array"
    ) {
      return;
    }
    array.sawAlerts = true;
    array.utilizationPercent = Math.max(0, rawValue);
    return;
  }

  if (
    metricName === "purefa_array_space_data_reduction_ratio" ||
    metricName === "purefb_array_space_data_reduction_ratio"
  ) {
    if (
      metricName === "purefb_array_space_data_reduction_ratio" &&
      label("type") !== "array"
    ) {
      return;
    }
    array.dataReductionRatio = Math.max(0, rawValue);
    return;
  }

  // ---------------- Hardware ----------------

  if (metricName === "purefa_hw_component_status") {
    const componentName: string | null = label("component_name");
    if (!componentName) {
      return;
    }
    array.sawHardware = true;
    const patch: StorageArrayResourceBufferEntry =
      emptyStorageArrayResourceEntry(
        StorageArrayResourceKind.Hardware,
        componentName,
        observedAt,
      );
    patch.name = componentName;
    patch.status = lowerOrNull(label("component_status"));
    patch.componentType = label("component_type");
    fold(patch);
    return;
  }

  if (metricName === "purefa_hw_component_temperature_celsius") {
    const componentName: string | null = label("component_name");
    if (!componentName) {
      return;
    }
    const patch: StorageArrayResourceBufferEntry =
      emptyStorageArrayResourceEntry(
        StorageArrayResourceKind.Hardware,
        componentName,
        observedAt,
      );
    patch.name = componentName;
    patch.componentType = label("component_type");
    patch.temperatureCelsius = rawValue;
    fold(patch);
    return;
  }

  if (metricName === "purefa_drive_capacity_bytes") {
    const componentName: string | null = label("component_name");
    if (!componentName) {
      return;
    }
    array.sawDrives = true;
    const patch: StorageArrayResourceBufferEntry =
      emptyStorageArrayResourceEntry(
        StorageArrayResourceKind.Drive,
        componentName,
        observedAt,
      );
    patch.name = componentName;
    patch.status = lowerOrNull(label("component_status"));
    patch.componentType = label("component_type");
    patch.capacityBytes = Math.max(0, Math.trunc(rawValue));
    const protocol: string | null = label("component_protocol");
    if (protocol) {
      patch.details["protocol"] = protocol;
    }
    fold(patch);
    return;
  }

  if (metricName === "purefa_hw_controller_info") {
    const controllerName: string | null = label("name");
    if (!controllerName) {
      return;
    }
    array.sawControllers = true;
    const patch: StorageArrayResourceBufferEntry =
      emptyStorageArrayResourceEntry(
        StorageArrayResourceKind.Controller,
        controllerName,
        observedAt,
      );
    patch.name = controllerName;
    patch.status = lowerOrNull(label("status"));
    patch.statusDetail = label("mode");
    patch.model = label("model");
    patch.firmwareVersion = label("version");
    patch.componentType = label("type");
    fold(patch);
    return;
  }

  if (metricName === "purefb_hardware_health") {
    const componentName: string | null = label("name");
    if (!componentName) {
      return;
    }
    array.sawHardware = true;
    const patch: StorageArrayResourceBufferEntry =
      emptyStorageArrayResourceEntry(
        StorageArrayResourceKind.Hardware,
        componentName,
        observedAt,
      );
    patch.name = componentName;
    patch.componentType = label("type");
    // The exporter maps healthy -> 1, unused -> 2 and anything else -> 0.
    patch.status =
      rawValue === 1 ? "healthy" : rawValue === 2 ? "unused" : "unhealthy";
    const slot: string | null = label("slot");
    if (slot) {
      patch.details["slot"] = slot;
    }
    fold(patch);
    return;
  }

  if (metricName.startsWith("purefa_network_interface_")) {
    const interfaceName: string | null = label("name");
    if (!interfaceName) {
      return;
    }
    const patch: StorageArrayResourceBufferEntry =
      emptyStorageArrayResourceEntry(
        StorageArrayResourceKind.NetworkInterface,
        interfaceName,
        observedAt,
      );
    patch.name = interfaceName;
    patch.componentType = label("type");
    if (metricName === "purefa_network_interface_speed_bandwidth_bytes") {
      const enabled: string | null = lowerOrNull(label("enabled"));
      patch.status =
        enabled === "true"
          ? "enabled"
          : enabled === "false"
            ? "disabled"
            : null;
      patch.details["speedBytesPerSec"] = Math.max(0, rawValue);
      const services: string | null = label("services");
      if (services) {
        patch.details["services"] = services;
      }
      const ethSubtype: string | null = label("ethsubtype");
      if (ethSubtype) {
        patch.details["ethSubtype"] = ethSubtype;
      }
    } else if (
      metricName === "purefa_network_interface_performance_bandwidth_bytes"
    ) {
      const dimension: string | null = label("dimension");
      if (dimension === "received_bytes_per_sec") {
        patch.details["receivedBytesPerSec"] = Math.max(0, rawValue);
      } else if (dimension === "transmitted_bytes_per_sec") {
        patch.details["transmittedBytesPerSec"] = Math.max(0, rawValue);
      } else {
        return;
      }
    } else if (metricName === "purefa_network_interface_performance_errors") {
      if (label("dimension") !== "total_errors_per_sec") {
        return;
      }
      patch.details["errorsPerSec"] = Math.max(0, rawValue);
    } else {
      return;
    }
    fold(patch);
    return;
  }

  // ---------------- FlashArray volumes ----------------

  if (metricName.startsWith("purefa_volume_")) {
    // purefa_volume_group_* series describe volume groups, not volumes.
    if (metricName.startsWith("purefa_volume_group_")) {
      return;
    }
    const volumeName: string | null = label("name");
    if (!volumeName) {
      return;
    }
    array.sawVolumes = true;
    const patch: StorageArrayResourceBufferEntry =
      emptyStorageArrayResourceEntry(
        StorageArrayResourceKind.Volume,
        volumeName,
        observedAt,
      );
    patch.name = volumeName;
    patch.groupName = label("pod") || label("volume_group");
    const naaId: string | null = label("naa_id");
    if (naaId) {
      patch.details["naaId"] = naaId;
    }
    const family: "latency" | "iops" | "bandwidth" | null =
      performanceFamily(metricName);
    if (family) {
      if (
        !applyPerformanceDimension(patch, family, label("dimension"), rawValue)
      ) {
        // Still a sighting of the volume — keep it in the inventory.
        fold(patch);
        return;
      }
    } else if (metricName === "purefa_volume_space_bytes") {
      applySpaceDimension(patch, label("space"), rawValue);
    } else if (metricName === "purefa_volume_space_data_reduction_ratio") {
      patch.dataReductionRatio = Math.max(0, rawValue);
    } else if (metricName === "purefa_volume_qos_iops_limit") {
      patch.details["qosIopsLimit"] = Math.max(0, rawValue);
    } else if (
      metricName === "purefa_volume_qos_bandwidth_bytes_per_sec_limit"
    ) {
      patch.details["qosBandwidthBytesPerSecLimit"] = Math.max(0, rawValue);
    }
    fold(patch);
    return;
  }

  // ---------------- FlashArray hosts ----------------

  if (metricName.startsWith("purefa_host_")) {
    const hostName: string | null = label("host");
    if (!hostName) {
      return;
    }
    array.sawHosts = true;
    const patch: StorageArrayResourceBufferEntry =
      emptyStorageArrayResourceEntry(
        StorageArrayResourceKind.Host,
        hostName,
        observedAt,
      );
    patch.name = hostName;

    if (metricName === "purefa_host_connectivity_info") {
      patch.status = lowerOrNull(label("status"));
      patch.statusDetail = label("details");
    } else if (metricName === "purefa_host_connections_info") {
      patch.groupName = label("hostgroup");
      const volumeName: string | null = label("volume");
      if (volumeName) {
        recordConnection(array.volumesByHost, hostName, volumeName);
        recordConnection(array.hostsByVolume, volumeName, hostName);
      } else if (!array.volumesByHost.has(hostName)) {
        // A host with no volumes connected still counts as zero.
        array.volumesByHost.set(hostName, new Set());
      }
      if (
        !array.connectionsObservedAt ||
        observedAt > array.connectionsObservedAt
      ) {
        array.connectionsObservedAt = observedAt;
      }
    } else if (metricName === "purefa_host_space_bytes") {
      applySpaceDimension(patch, label("space"), rawValue);
    } else if (metricName === "purefa_host_space_size_bytes") {
      // The provisioned size of everything the host is connected to.
      patch.capacityBytes = Math.max(0, Math.trunc(rawValue));
    } else if (metricName === "purefa_host_space_data_reduction_ratio") {
      patch.dataReductionRatio = Math.max(0, rawValue);
    } else {
      const family: "latency" | "iops" | "bandwidth" | null =
        performanceFamily(metricName);
      if (family) {
        applyPerformanceDimension(patch, family, label("dimension"), rawValue);
      }
    }
    fold(patch);
    return;
  }

  // ---------------- FlashArray pods ----------------

  if (metricName.startsWith("purefa_pod_")) {
    let podName: string | null = null;
    if (metricName.startsWith("purefa_pod_replica_links_")) {
      podName = label("local_pod");
    } else if (metricName === "purefa_pod_mediator_status") {
      podName = label("pod");
    } else {
      podName = label("name");
    }
    if (!podName) {
      return;
    }
    array.sawPods = true;
    const patch: StorageArrayResourceBufferEntry =
      emptyStorageArrayResourceEntry(
        StorageArrayResourceKind.Pod,
        podName,
        observedAt,
      );
    patch.name = podName;

    if (metricName === "purefa_pod_replica_links_lag_max_msec") {
      patch.replicationLagMs = Math.max(0, rawValue);
      patch.status = lowerOrNull(label("status"));
      const remote: string | null = label("remote");
      if (remote) {
        patch.details["remote"] = remote;
      }
      const remotePod: string | null = label("remote_pod");
      if (remotePod) {
        patch.details["remotePod"] = remotePod;
      }
      const direction: string | null = label("direction");
      if (direction) {
        patch.details["direction"] = direction;
      }
    } else if (metricName === "purefa_pod_replica_links_lag_average_msec") {
      patch.details["averageLagMs"] = Math.max(0, rawValue);
    } else if (metricName === "purefa_pod_mediator_status") {
      const mediatorStatus: string | null = lowerOrNull(label("status"));
      if (mediatorStatus) {
        patch.details["mediatorStatus"] = mediatorStatus;
      }
    } else if (metricName === "purefa_pod_space_bytes") {
      applySpaceDimension(patch, label("space"), rawValue);
    } else if (metricName === "purefa_pod_space_data_reduction_ratio") {
      patch.dataReductionRatio = Math.max(0, rawValue);
    } else {
      const family: "latency" | "iops" | "bandwidth" | null =
        performanceFamily(metricName);
      if (family) {
        applyPerformanceDimension(patch, family, label("dimension"), rawValue);
      }
    }
    fold(patch);
    return;
  }

  // ---------------- FlashArray directories ----------------

  if (metricName.startsWith("purefa_directory_")) {
    const directoryName: string | null = label("name");
    if (!directoryName) {
      return;
    }
    const patch: StorageArrayResourceBufferEntry =
      emptyStorageArrayResourceEntry(
        StorageArrayResourceKind.Directory,
        directoryName,
        observedAt,
      );
    patch.name = directoryName;
    if (metricName === "purefa_directory_space_bytes") {
      applySpaceDimension(patch, label("space"), rawValue);
    } else if (metricName === "purefa_directory_space_data_reduction_ratio") {
      patch.dataReductionRatio = Math.max(0, rawValue);
    } else {
      const family: "latency" | "iops" | "bandwidth" | null =
        performanceFamily(metricName);
      if (family) {
        applyPerformanceDimension(patch, family, label("dimension"), rawValue);
      }
    }
    fold(patch);
    return;
  }

  // ---------------- FlashBlade file systems ----------------

  if (metricName.startsWith("purefb_file_systems_")) {
    const fileSystemName: string | null = label("name");
    if (!fileSystemName) {
      return;
    }
    array.sawFileSystems = true;
    const patch: StorageArrayResourceBufferEntry =
      emptyStorageArrayResourceEntry(
        StorageArrayResourceKind.FileSystem,
        fileSystemName,
        observedAt,
      );
    patch.name = fileSystemName;
    const nfs: string | null = label("nfs");
    if (nfs) {
      patch.details["nfs"] = nfs;
    }
    const smb: string | null = label("smb");
    if (smb) {
      patch.details["smb"] = smb;
    }
    const nfsPolicy: string | null = label("nfspolicy");
    if (nfsPolicy) {
      patch.details["nfsPolicy"] = nfsPolicy;
    }
    if (metricName === "purefb_file_systems_space_bytes") {
      const space: string | null = label("space");
      if (
        !applySpaceDimension(patch, space, rawValue) &&
        space === "provisioned"
      ) {
        // `provisioned` is the configured size; total_provisioned wins when both arrive.
        patch.details["provisionedBytes"] = Math.max(0, Math.trunc(rawValue));
      }
    } else if (
      metricName === "purefb_file_systems_space_data_reduction_ratio"
    ) {
      patch.dataReductionRatio = Math.max(0, rawValue);
    } else {
      const family: "latency" | "iops" | "bandwidth" | null =
        performanceFamily(metricName);
      if (family) {
        applyPerformanceDimension(patch, family, label("dimension"), rawValue);
      }
    }
    fold(patch);
    return;
  }

  // ---------------- FlashBlade buckets ----------------

  if (metricName.startsWith("purefb_buckets_")) {
    const bucketName: string | null = label("name");
    if (!bucketName) {
      return;
    }
    array.sawBuckets = true;
    const patch: StorageArrayResourceBufferEntry =
      emptyStorageArrayResourceEntry(
        StorageArrayResourceKind.Bucket,
        bucketName,
        observedAt,
      );
    patch.name = bucketName;
    patch.groupName = label("account");
    if (metricName === "purefb_buckets_space_bytes") {
      const space: string | null = label("space");
      // A bucket's size is its quota (below); what it holds is total_physical.
      if (space === "total_physical") {
        patch.usedBytes = Math.max(0, Math.trunc(rawValue));
      } else if (space === "virtual") {
        patch.details["virtualBytes"] = Math.max(0, Math.trunc(rawValue));
      }
    } else if (metricName === "purefb_buckets_quota_space_bytes") {
      patch.capacityBytes = Math.max(0, Math.trunc(rawValue));
      const hardLimit: string | null = label("hard_limit_enabled");
      if (hardLimit) {
        patch.details["hardLimitEnabled"] = hardLimit === "true";
      }
    } else if (metricName === "purefb_buckets_space_data_reduction_ratio") {
      patch.dataReductionRatio = Math.max(0, rawValue);
    } else if (metricName === "purefb_buckets_object_count") {
      patch.details["objectCount"] = Math.max(0, Math.trunc(rawValue));
    } else {
      const family: "latency" | "iops" | "bandwidth" | null =
        performanceFamily(metricName);
      if (family) {
        applyPerformanceDimension(patch, family, label("dimension"), rawValue);
      }
    }
    fold(patch);
    return;
  }
}

/*
 * Merge a patch into the per-array buffer — same semantics as
 * foldCephResourceSnapshot (identity first-non-null-wins, status/metrics
 * newest-observedAt-wins). `details` merges key by key, newest wins.
 */
export function foldStorageArrayResourceSnapshot(data: {
  buffer: Map<string, Map<string, StorageArrayResourceBufferEntry>>;
  arrayIdStr: string;
  patch: StorageArrayResourceBufferEntry;
}): void {
  let perArray: Map<string, StorageArrayResourceBufferEntry> | undefined =
    data.buffer.get(data.arrayIdStr);
  if (!perArray) {
    perArray = new Map();
    data.buffer.set(data.arrayIdStr, perArray);
  }
  const key: string = `${data.patch.kind}|${data.patch.externalId}`;
  const existing: StorageArrayResourceBufferEntry | undefined =
    perArray.get(key);
  if (!existing) {
    perArray.set(key, data.patch);
    return;
  }

  const patch: StorageArrayResourceBufferEntry = data.patch;
  const newer: boolean = patch.observedAt >= existing.observedAt;

  // Identity: first-non-null wins.
  const identityKeys: Array<
    "name" | "componentType" | "model" | "firmwareVersion" | "groupName"
  > = ["name", "componentType", "model", "firmwareVersion", "groupName"];
  for (const k of identityKeys) {
    if (existing[k] === null && patch[k] !== null) {
      existing[k] = patch[k];
    }
  }

  // Status / metrics: newest observation wins.
  const latestKeys: Array<
    | "status"
    | "statusDetail"
    | "capacityBytes"
    | "usedBytes"
    | "dataReductionRatio"
    | "readLatencyUsec"
    | "writeLatencyUsec"
    | "readIops"
    | "writeIops"
    | "readBytesPerSec"
    | "writeBytesPerSec"
    | "temperatureCelsius"
  > = [
    "status",
    "statusDetail",
    "capacityBytes",
    "usedBytes",
    "dataReductionRatio",
    "readLatencyUsec",
    "writeLatencyUsec",
    "readIops",
    "writeIops",
    "readBytesPerSec",
    "writeBytesPerSec",
    "temperatureCelsius",
  ];
  for (const k of latestKeys) {
    if (patch[k] !== null && (newer || existing[k] === null)) {
      (existing as unknown as JSONObject)[k] = patch[k];
    }
  }

  /*
   * A pod can have several replica links; the pod's lag is the worst one,
   * and its status the status of that worst link.
   */
  if (patch.replicationLagMs !== null) {
    if (
      existing.replicationLagMs === null ||
      patch.replicationLagMs >= existing.replicationLagMs
    ) {
      existing.replicationLagMs = patch.replicationLagMs;
      if (patch.status !== null) {
        existing.status = patch.status;
      }
    }
  }

  for (const detailKey of Object.keys(patch.details)) {
    if (newer || existing.details[detailKey] === undefined) {
      existing.details[detailKey] = patch.details[detailKey]!;
    }
  }

  if (patch.observedAt > existing.observedAt) {
    existing.observedAt = patch.observedAt;
  }
}

/*
 * The inventory rows of one folded batch, with the connection counts from
 * purefa_host_connections_info applied: a host's count is its connected
 * volumes, a volume's count is the hosts it is connected to. That series
 * comes from the hosts endpoint, so the volumes it names are written from
 * the hosts batch too (connectionCount only — every other column COALESCEs
 * on upsert, so the volumes batch's values are never blanked). Nothing is
 * touched when the batch carried no connections series, so a volumes scrape
 * never zeroes a count the hosts scrape set.
 */
export function getStorageArrayResourceRows(
  entries: Array<StorageArrayResourceBufferEntry>,
  snap: StorageArraySnapshotBufferEntry | undefined,
): Array<StorageArrayResourceBufferEntry> {
  if (!snap || !snap.connectionsObservedAt) {
    return entries;
  }

  const rows: Array<StorageArrayResourceBufferEntry> = [...entries];
  const volumesSeen: Set<string> = new Set();

  for (const entry of rows) {
    if (entry.kind === StorageArrayResourceKind.Host) {
      entry.connectionCount =
        snap.volumesByHost.get(entry.externalId)?.size || 0;
    }
    if (entry.kind === StorageArrayResourceKind.Volume) {
      entry.connectionCount =
        snap.hostsByVolume.get(entry.externalId)?.size || 0;
      volumesSeen.add(entry.externalId);
    }
  }

  for (const [volumeName, hosts] of snap.hostsByVolume.entries()) {
    if (volumesSeen.has(volumeName)) {
      continue;
    }
    const volume: StorageArrayResourceBufferEntry =
      emptyStorageArrayResourceEntry(
        StorageArrayResourceKind.Volume,
        volumeName,
        snap.connectionsObservedAt,
      );
    volume.name = volumeName;
    volume.connectionCount = hosts.size;
    rows.push(volume);
  }

  return rows;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/*
 * Derive the StorageArray snapshot columns from one folded batch — same
 * never-zero-a-column-on-a-partial-batch contract as the Ceph derive.
 *
 * Values are rounded (percent and ratio to 2 decimals, bytes to whole MiB
 * for the capacity columns) because the extras fingerprint throttles the
 * row write: full precision would change it on every scrape for an
 * invisible difference.
 */
export function deriveStorageArraySnapshotExtras(
  entries: Array<StorageArrayResourceBufferEntry>,
  snap: StorageArraySnapshotBufferEntry | undefined,
): StorageArraySnapshotDerivedExtras {
  const extras: StorageArraySnapshotDerivedExtras = {};

  if (!snap) {
    return extras;
  }

  if (snap.storageSystem) {
    extras.storageSystem = snap.storageSystem;
  }
  if (snap.reportedName) {
    extras.reportedName = snap.reportedName;
  }
  if (snap.systemId) {
    extras.systemId = snap.systemId;
  }
  if (snap.osName) {
    extras.osName = snap.osName;
  }
  if (snap.osVersion) {
    extras.osVersion = snap.osVersion;
  }

  const MiB: number = 1024 * 1024;
  if (snap.capacityBytes !== null) {
    extras.capacityBytes = Math.round(snap.capacityBytes / MiB) * MiB;
    if (snap.emptyBytes !== null) {
      extras.usedBytes =
        Math.round(Math.max(0, snap.capacityBytes - snap.emptyBytes) / MiB) *
        MiB;
    } else if (snap.utilizationPercent !== null) {
      extras.usedBytes =
        Math.round(
          (snap.capacityBytes * Math.min(100, snap.utilizationPercent)) /
            100 /
            MiB,
        ) * MiB;
    }
  }
  if (snap.utilizationPercent !== null) {
    extras.capacityUsedPercent = round2(snap.utilizationPercent);
  } else if (
    snap.capacityBytes !== null &&
    snap.capacityBytes > 0 &&
    snap.emptyBytes !== null
  ) {
    extras.capacityUsedPercent = round2(
      ((snap.capacityBytes - snap.emptyBytes) / snap.capacityBytes) * 100,
    );
  }
  if (snap.dataReductionRatio !== null) {
    extras.dataReductionRatio = round2(snap.dataReductionRatio);
  }

  if (snap.sawAlerts) {
    extras.openAlertCount = snap.openAlertKeys.size;
    extras.criticalAlertCount = snap.criticalAlertKeys.size;
    extras.warningAlertCount = snap.warningAlertKeys.size;
  }

  const countKind: (kind: StorageArrayResourceKind) => number = (
    kind: StorageArrayResourceKind,
  ) => {
    return entries.filter((e: StorageArrayResourceBufferEntry) => {
      return e.kind === kind;
    }).length;
  };

  if (snap.sawVolumes) {
    extras.volumeCount = countKind(StorageArrayResourceKind.Volume);
  }
  if (snap.sawHosts) {
    extras.hostCount = countKind(StorageArrayResourceKind.Host);
  }
  if (snap.sawPods) {
    extras.podCount = countKind(StorageArrayResourceKind.Pod);
  }
  if (snap.sawFileSystems) {
    extras.fileSystemCount = countKind(StorageArrayResourceKind.FileSystem);
  }
  if (snap.sawBuckets) {
    extras.bucketCount = countKind(StorageArrayResourceKind.Bucket);
  }

  /*
   * Hardware counts and health need the whole hardware picture, which only
   * the array endpoint carries — and only when it carried both the alerts
   * and the component status series is health derivable at all.
   */
  const sawAnyHardware: boolean =
    snap.sawHardware || snap.sawDrives || snap.sawControllers;
  let criticalHardware: boolean = false;
  let unhealthyHardware: number = 0;
  if (sawAnyHardware) {
    const hardware: Array<StorageArrayResourceBufferEntry> = entries.filter(
      (e: StorageArrayResourceBufferEntry) => {
        return HARDWARE_KINDS.has(e.kind);
      },
    );
    for (const component of hardware) {
      if (isUnhealthyComponentStatus(component.status)) {
        unhealthyHardware++;
      }
      if (isCriticalComponentStatus(component.status)) {
        criticalHardware = true;
      }
    }
    if (snap.sawHardware) {
      extras.hardwareComponentCount = entries.filter(
        (e: StorageArrayResourceBufferEntry) => {
          return e.kind === StorageArrayResourceKind.Hardware;
        },
      ).length;
    }
    extras.unhealthyHardwareCount = unhealthyHardware;
  }

  if (snap.sawAlerts && sawAnyHardware) {
    if (snap.criticalAlertKeys.size > 0 || criticalHardware) {
      extras.healthStatus = StorageArrayHealthStatus.Critical;
    } else if (snap.warningAlertKeys.size > 0 || unhealthyHardware > 0) {
      extras.healthStatus = StorageArrayHealthStatus.Warning;
    } else {
      extras.healthStatus = StorageArrayHealthStatus.Ok;
    }
  }

  return extras;
}
