import OneUptimeDate from "../../../Types/Date";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import StorageArrayResourceKind from "../../../Types/StorageArray/StorageArrayResourceKind";
import StorageSystemUtil from "../../../Types/StorageArray/StorageSystemUtil";
import StorageArrayPlatformRegistry from "../../../Types/StorageArray/StorageArrayPlatformRegistry";
import {
  STORAGE_ARRAY_COMPONENT_STATUSES,
  STORAGE_ARRAY_HARDWARE_KINDS,
  StorageArrayComponentStatuses,
  StorageArrayPlatform,
} from "../../../Types/StorageArray/StorageArrayPlatform";
import logger from "../Logger";
import { writeOwnValue } from "../../../Utils/LookupTable";
import {
  SCRAPE_ENDPOINT_LABEL,
  StorageArrayResourceBufferEntry,
  StorageArraySeries,
  StorageArraySnapshotBufferEntry,
  emptyStorageArrayResourceEntry,
  getOrCreateStorageArraySnapshot,
} from "./StorageArray/StorageArrayExtractor";
import StorageArrayExtractors, {
  ResolvedStorageArrayExtractor,
} from "./StorageArray/StorageArrayExtractors";

export {
  SCRAPE_ENDPOINT_LABEL,
  emptyStorageArrayResourceEntry,
  getOrCreateStorageArraySnapshot,
};
export type {
  StorageArrayResourceBufferEntry,
  StorageArraySnapshotBufferEntry,
};

/*
 * ------------------------------------------------------------------
 * Storage array snapshot scan — pure fold & derive helpers
 * ------------------------------------------------------------------
 *
 * The storage array counterpart of ProxmoxCephSnapshotScan. The ingest
 * service owns the I/O: it walks the OTLP payload, calls
 * bufferStorageArraySnapshotMetric per datapoint of a batch whose resource
 * carries `storage.array.name`, and at flush time maps the folded buffers
 * through deriveStorageArraySnapshotExtras / deriveStorageArrayCountsByKind
 * / getStorageArrayResourceRows before handing the results to
 * StorageArrayResourceService / StorageArrayService. Everything in this
 * module is pure (Map/object mutation only — no DB, no network), which is
 * what makes the semantics unit-testable:
 *
 *   - identity labels fold first-non-null-wins; status/metric fields fold
 *     newest-observedAt-wins,
 *   - count, capacity, alert and health columns are only derived when the
 *     batch carried the matching series (never zero a column on a partial
 *     batch — a FlashArray's /metrics/volumes scrape carries no alert or
 *     capacity series),
 *   - metric names no platform reads are skipped by the ingest
 *     (isStorageArraySnapshotMetric).
 *
 * What a datapoint MEANS is its platform's: each platform's extractor
 * (StorageArray/<Vendor>/, listed in StorageArray/StorageArrayExtractors)
 * reads its own metric names and labels into rows and snapshot state, and
 * StorageArrayExtractors.resolve picks the extractor - by the batch's
 * declared `storage.system`, or by the metric's prefix for an agent that
 * stamps none. This module is what every platform shares: reading a
 * datapoint, folding rows, the host-volume connection counts, and deriving
 * the StorageArray columns.
 */

/*
 * The metric names the platforms OneUptime ships read, as the registry held
 * them when this module loaded. The ingest's gate is
 * isStorageArraySnapshotMetric, which also knows a platform registered
 * later (a test's).
 */
export const STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES: ReadonlySet<string> = new Set(
  StorageArrayPlatformRegistry.getPlatforms().flatMap(
    (platform: StorageArrayPlatform): ReadonlyArray<string> => {
      return platform.snapshotMetricNames;
    },
  ),
);

// Whether any platform reads this metric into the inventory or snapshot.
export function isStorageArraySnapshotMetric(metricName: string): boolean {
  return StorageArrayExtractors.isSnapshotMetric(metricName);
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
 * The statuses a platform writes for its parts, by what they mean
 * (StorageArrayPlatform.componentStatuses); the shared words for an array
 * whose platform is not known.
 */
function getComponentStatuses(
  system: string | null | undefined,
): StorageArrayComponentStatuses {
  return (
    StorageArrayPlatformRegistry.getPlatform(system)?.componentStatuses ||
    STORAGE_ARRAY_COMPONENT_STATUSES
  );
}

/*
 * Whether a part's status says it needs a person (critical or warning), on
 * its platform's words - or the shared ones, which every platform so far
 * uses, when no platform is named.
 */
export function isUnhealthyComponentStatus(
  status: string | null | undefined,
  system?: string | null | undefined,
): boolean {
  if (!status) {
    return false;
  }
  const normalized: string = status.trim().toLowerCase();
  const statuses: StorageArrayComponentStatuses = getComponentStatuses(system);
  return (
    statuses.critical.includes(normalized) ||
    statuses.warning.includes(normalized)
  );
}

export function isCriticalComponentStatus(
  status: string | null | undefined,
  system?: string | null | undefined,
): boolean {
  if (!status) {
    return false;
  }
  return getComponentStatuses(system).critical.includes(
    status.trim().toLowerCase(),
  );
}

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

/*
 * Same fall-back-to-now parse contract as ProxmoxCephSnapshotScan, plus one
 * guard: a nanosecond value past the Date range parses to an Invalid Date
 * rather than throwing, and an Invalid Date reaching the upsert would fail
 * the timestamptz cast and drop the whole chunk.
 */
function parseUnixNanoToDate(
  value: string | number | undefined,
  context: string,
): Date {
  if (value !== undefined && value !== null) {
    try {
      let parsed: Date | null = null;
      if (typeof value === "string") {
        const trimmed: string = value.trim();
        if (trimmed === "" || isNaN(Number(trimmed))) {
          throw new Error(`Invalid timestamp string: ${value}`);
        }
        parsed = OneUptimeDate.fromUnixNano(trimmed);
      } else if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          throw new Error(`Invalid timestamp number: ${value}`);
        }
        parsed = OneUptimeDate.fromUnixNano(value);
      }
      if (parsed) {
        if (isNaN(parsed.getTime())) {
          throw new Error(`Timestamp out of range: ${value}`);
        }
        return parsed;
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

/*
 * Fold one datapoint into the per-array buffers. The ingest pre-filters
 * with isStorageArraySnapshotMetric; `declaredStorageSystem` is the batch's
 * `storage.system`, which picks the platform whose extractor reads it
 * (StorageArrayExtractors.resolve).
 */
export function bufferStorageArraySnapshotMetric(data: {
  arrayIdStr: string;
  metricName: string;
  datapoint: JSONObject;
  resourceBuffer: Map<string, Map<string, StorageArrayResourceBufferEntry>>;
  arrayBuffer: Map<string, StorageArraySnapshotBufferEntry>;
  declaredStorageSystem?: string | null | undefined;
}): void {
  /*
   * FLAG_NO_RECORDED_VALUE is how the prometheus receiver forwards a
   * Prometheus staleness marker: the series just disappeared. Folding it
   * would count a deleted volume as still present for one more batch.
   */
  if ((Number(data.datapoint["flags"]) & 1) === 1) {
    return;
  }

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

  const resolved: ResolvedStorageArrayExtractor | null =
    StorageArrayExtractors.resolve({
      metricName: data.metricName,
      declaredStorageSystem: data.declaredStorageSystem,
    });
  if (!resolved) {
    return;
  }

  // The first platform seen wins for the batch.
  if (!array.storageSystem) {
    array.storageSystem = resolved.platform.storageSystem;
  }

  const series: StorageArraySeries = {
    metricName: data.metricName,
    value: rawValue,
    observedAt: observedAt,
    label: (key: string): string | null => {
      return getStringAttribute(dpAttributes, key);
    },
    attributes: dpAttributes,
    array: array,
    newResource: (
      kind: string,
      externalId: string,
    ): StorageArrayResourceBufferEntry => {
      return emptyStorageArrayResourceEntry(kind, externalId, observedAt);
    },
    fold: (patch: StorageArrayResourceBufferEntry): void => {
      foldStorageArrayResourceSnapshot({
        buffer: data.resourceBuffer,
        arrayIdStr: data.arrayIdStr,
        patch,
      });
    },
  };

  resolved.extractor.extract(series);
}

/*
 * Merge a patch into the per-array buffer — same semantics as
 * foldCephResourceSnapshot (identity first-non-null-wins, status/metrics
 * newest-observedAt-wins). `details` merges key by key, newest wins. Two
 * exceptions, both about one object reported by several series in the same
 * scrape: a pod's lag, status and link details come from its worst replica
 * link, and its mediator status from the worst array it spans.
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
  /*
   * A replica link's status is decided by the worst-link rule below, not by
   * observation order: the links of one pod share a scrape timestamp, so
   * newest-wins would hand the pod whichever link happened to be folded
   * last — a healthy link's status next to another link's lag.
   */
  const isReplicaLinkPatch: boolean = patch.replicationLagMs !== null;
  for (const k of latestKeys) {
    if (k === "status" && isReplicaLinkPatch) {
      continue;
    }
    if (patch[k] !== null && (newer || existing[k] === null)) {
      (existing as unknown as JSONObject)[k] = patch[k];
    }
  }

  /*
   * A pod can have several replica links; the pod's lag is the worst one,
   * and its status — and the link details (peer, remote pod, direction) —
   * those of that worst link.
   */
  let isWorstReplicaLink: boolean = false;
  if (patch.replicationLagMs !== null) {
    if (
      existing.replicationLagMs === null ||
      patch.replicationLagMs >= existing.replicationLagMs
    ) {
      existing.replicationLagMs = patch.replicationLagMs;
      isWorstReplicaLink = true;
      if (patch.status !== null) {
        existing.status = patch.status;
      }
    }
  }

  for (const detailKey of Object.keys(patch.details)) {
    const incoming: JSONValue = patch.details[detailKey]!;
    const current: JSONValue | undefined = existing.details[detailKey];
    if (current === undefined) {
      existing.details[detailKey] = incoming;
      continue;
    }
    if (isReplicaLinkPatch) {
      if (isWorstReplicaLink) {
        existing.details[detailKey] = incoming;
      }
      continue;
    }
    /*
     * A stretched pod reports its mediator once per array it spans, all in
     * the same scrape. One array that cannot reach the mediator is the fact
     * worth showing, so a status other than `online` wins over `online`
     * whatever the order.
     */
    if (detailKey === "mediatorStatus") {
      if (incoming !== "online" && (current === "online" || newer)) {
        existing.details[detailKey] = incoming;
      }
      continue;
    }
    if (newer) {
      existing.details[detailKey] = incoming;
    }
  }

  if (patch.observedAt > existing.observedAt) {
    existing.observedAt = patch.observedAt;
  }
}

/*
 * The inventory rows of one folded batch, with the connection counts from
 * the hosts' connections (recordHostVolumeConnection) applied: a host's
 * count is its connected volumes, a volume's count is the hosts it is
 * connected to. Those come with the hosts, so the volumes they name are
 * written from the hosts batch too (connectionCount only — every other column COALESCEs
 * on upsert, so the volumes batch's values are never blanked). Those rows
 * are marked fromConnectionsOnly so deriveStorageArraySnapshotExtras never
 * counts them as volumes. Nothing is touched when the batch carried no
 * connections series, so a volumes scrape never zeroes a count the hosts
 * scrape set.
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
    volume.fromConnectionsOnly = true;
    rows.push(volume);
  }

  return rows;
}

/*
 * The volumes a batch's hosts scrape names as connected, for
 * StorageArrayResourceService.resetVolumeConnectionCounts — or null when the
 * batch cannot tell which volumes are connected, so no count may be reset.
 *
 * The hosts' connections are the only source of a volume's
 * connectionCount, and they list connected volumes only: a volume detached
 * from its last host just stops appearing in it, and without a reset its
 * old count would stand. The batch knows every connection when it carried
 * the hosts endpoint (sawHosts) and either that connections series or no
 * host at all — an array whose last host was deleted has nothing connected.
 * A hosts batch whose connections series was filtered out (a
 * metric_relabel_configs drop on the agent) knows nothing, and resets
 * nothing.
 */
export function getConnectedVolumeNames(
  entries: Array<StorageArrayResourceBufferEntry>,
  snap: StorageArraySnapshotBufferEntry | undefined,
): Array<string> | null {
  if (!snap || !snap.sawHosts) {
    return null;
  }

  if (
    !snap.connectionsObservedAt &&
    entries.some((entry: StorageArrayResourceBufferEntry) => {
      return entry.kind === StorageArrayResourceKind.Host;
    })
  ) {
    return null;
  }

  return Array.from(snap.hostsByVolume.entries())
    .filter(([, hosts]: [string, Set<string>]) => {
      return hosts.size > 0;
    })
    .map(([volumeName]: [string, Set<string>]) => {
      return volumeName;
    })
    .sort();
}

/*
 * How many hosts each connected volume has, for a batch that knows every
 * connection — null exactly when getConnectedVolumeNames is. The flush
 * writes these with their own UPDATE rather than relying on the
 * connection-only rows getStorageArrayResourceRows adds: those ride
 * bulkUpsert, whose lastSeenAt guard would drop them whenever the volumes
 * scrape (a later lastSeenAt) is flushed first — and scrape timing is
 * fixed per deployment, so an unlucky one would never update its counts.
 */
export function getVolumeConnectionCounts(
  entries: Array<StorageArrayResourceBufferEntry>,
  snap: StorageArraySnapshotBufferEntry | undefined,
): Record<string, number> | null {
  const connected: Array<string> | null = getConnectedVolumeNames(
    entries,
    snap,
  );
  if (!connected || !snap) {
    return null;
  }
  /*
   * By the volume's name on the array, as the map's own key: an assignment
   * dropped a volume named "__proto__", which then was not among the
   * connected names, so its count was zeroed on every batch.
   */
  const counts: Record<string, number> = {};
  for (const volumeName of connected) {
    writeOwnValue(
      counts,
      volumeName,
      snap.hostsByVolume.get(volumeName)?.size || 0,
    );
  }
  return counts;
}

/*
 * The platform to write for an array. The series decide it whenever the
 * batch carried any a platform's extractor read (the platform it was read
 * for); the agent's declared `storage.system` only fills in for a
 * platform OneUptime has no extractor for, so an array of another vendor
 * is still labelled. A known platform is never taken from the attribute
 * alone: a FlashBlade .env without STORAGE_SYSTEM declares the compose
 * default, purestorage.flasharray, and a batch with none of its series (a
 * failed scrape's `up` alone) would otherwise write it back over the
 * derived value, flipping the column between scrapes.
 */
export function resolveStorageArraySystem(data: {
  derived: string | null | undefined;
  declared: string | null | undefined;
}): string | undefined {
  if (data.derived) {
    return data.derived;
  }
  if (data.declared && !StorageSystemUtil.isKnownSystem(data.declared)) {
    return data.declared;
  }
  return undefined;
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
      (Math.max(0, snap.capacityBytes - snap.emptyBytes) / snap.capacityBytes) *
        100,
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

  /*
   * Only objects the batch reported through their own series count. A
   * volume getStorageArrayResourceRows synthesized from the hosts
   * endpoint's connection list is not a sighting: a volumes scrape that
   * listed no volumes while the hosts' connections still named two must
   * report volumeCount 0, not 2.
   */
  const countKind: (kind: StorageArrayResourceKind) => number = (
    kind: StorageArrayResourceKind,
  ) => {
    return entries.filter((e: StorageArrayResourceBufferEntry) => {
      return e.kind === kind && !e.fromConnectionsOnly;
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
  const platform: StorageArrayPlatform | null =
    StorageArrayPlatformRegistry.getPlatform(snap.storageSystem);
  const hardwareKinds: ReadonlyArray<string> =
    platform?.hardwareKinds || STORAGE_ARRAY_HARDWARE_KINDS;
  const sawAnyHardware: boolean =
    snap.sawHardware ||
    snap.sawDrives ||
    snap.sawControllers ||
    hardwareKinds.some((kind: string): boolean => {
      return snap.completeKinds.has(kind);
    });
  let criticalHardware: boolean = false;
  let unhealthyHardware: number = 0;
  if (sawAnyHardware) {
    const hardware: Array<StorageArrayResourceBufferEntry> = entries.filter(
      (e: StorageArrayResourceBufferEntry) => {
        return hardwareKinds.includes(e.kind);
      },
    );
    /*
     * One physical part can be several rows under one name: a failed
     * FlashArray drive is its drive bay (Hardware, critical) AND the drive
     * in it (Drive, failed); a controller is a Hardware and a Controller
     * row. Count distinct component names, so one failed drive is one
     * unhealthy component — the same rule getInventorySummary applies.
     */
    const unhealthyNames: Set<string> = new Set();
    for (const component of hardware) {
      if (isUnhealthyComponentStatus(component.status, snap.storageSystem)) {
        unhealthyNames.add(component.externalId.toLowerCase());
      }
      if (isCriticalComponentStatus(component.status, snap.storageSystem)) {
        criticalHardware = true;
      }
    }
    unhealthyHardware = unhealthyNames.size;
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

/*
 * The count of each kind whose complete list the batch carried
 * (StorageArraySnapshotBufferEntry.completeKinds), for
 * StorageArray.countsByKind: a kind the platform reports counts 0 once its
 * last object is deleted, and a kind the batch did not list keeps the count
 * the row holds (StorageArrayService.mergeCountsByKind merges, never
 * replaces). Null when the batch listed no kind at all. Same counting rule
 * as the columns: a volume known only from a host's connections is no
 * sighting.
 */
export function deriveStorageArrayCountsByKind(
  entries: Array<StorageArrayResourceBufferEntry>,
  snap: StorageArraySnapshotBufferEntry | undefined,
): Record<string, number> | null {
  if (!snap || snap.completeKinds.size === 0) {
    return null;
  }
  const counts: Record<string, number> = {};
  for (const kind of Array.from(snap.completeKinds).sort()) {
    writeOwnValue(
      counts,
      kind,
      entries.filter((e: StorageArrayResourceBufferEntry): boolean => {
        return e.kind === kind && !e.fromConnectionsOnly;
      }).length,
    );
  }
  return counts;
}
