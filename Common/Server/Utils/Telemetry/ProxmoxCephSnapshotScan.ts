import OneUptimeDate from "../../../Types/Date";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import logger from "../Logger";

/*
 * ------------------------------------------------------------------
 * Proxmox / Ceph snapshot scan — pure fold & derive helpers
 * ------------------------------------------------------------------
 *
 * Extracted from App/FeatureSet/Telemetry/Services/
 * OtelMetricsIngestService.ts (WI-21 refactor-for-testability, no
 * behavior change). The ingest service owns the I/O: it walks the
 * OTLP payload, calls bufferProxmoxSnapshotMetric /
 * bufferCephSnapshotMetric per datapoint, and at flush time maps the
 * folded buffers through computeProxmoxGuestBackedUp /
 * deriveProxmoxClusterSnapshotExtras / deriveCephClusterSnapshotExtras
 * before handing the results to ProxmoxResourceService /
 * CephResourceService / *ClusterService. Everything in this module is
 * pure (Map/object mutation only — no DB, no network), which is what
 * makes the snapshot-scan semantics unit-testable:
 *
 *   - identity labels fold first-non-null-wins; status/metric fields
 *     fold newest-observedAt-wins,
 *   - count columns are only derived when the batch carried the
 *     matching identity series (never zero a count on a partial
 *     batch — the COALESCE-per-column contract),
 *   - non-allow-listed metric names are skipped via the exported
 *     PVE_/CEPH_SNAPSHOT_METRIC_NAMES sets.
 */

/*
 * Proxmox snapshot metrics — emitted by pve-exporter (prometheus
 * receiver), identity in the `id` datapoint label (node/pve1,
 * qemu/100, lxc/101, storage/local) plus the pve.scope / pve.type /
 * pve.id attributes the agent's transform processor derives from it.
 * Unlike K8s there is no separate object stream: identity, status AND
 * the latest-metric mirror all arrive on every scrape, so the same
 * scan feeds the ProxmoxResource inventory upsert and the
 * ProxmoxCluster count/version snapshot columns (single source — the
 * list-page counts and the sidebar badges can never drift).
 *
 * pve_cpu_usage_ratio is already a true 0..1 ratio — no allocatable-
 * denominator cache is needed, unlike K8s cpuCoresToPercent.
 */
export const PVE_SNAPSHOT_METRIC_NAMES: ReadonlySet<string> = new Set([
  // Identity / status (WI-3 cluster counts derive from these)
  "pve_up",
  "pve_node_info",
  "pve_guest_info",
  "pve_storage_info",
  "pve_version_info",
  "pve_ha_state",
  "pve_onboot_status",
  // Latest-metric mirror (WI-6 inventory columns)
  "pve_uptime_seconds",
  "pve_cpu_usage_ratio",
  "pve_memory_usage_bytes",
  "pve_memory_size_bytes",
  "pve_disk_usage_bytes",
  "pve_disk_size_bytes",
  /*
   * Backup coverage (WI-24) — cluster-level backup-info collector.
   * pve_not_backed_up_total = count of guests not covered by ANY
   * backup job; pve_not_backed_up_info = one series per uncovered
   * guest, labeled only `id`. "Covered by a job" ≠ "backed up
   * recently/successfully" — freshness needs the PVE task log or PBS
   * API (v4 API-agent track).
   */
  "pve_not_backed_up_total",
  "pve_not_backed_up_info",
]);

/*
 * Ceph snapshot metrics — emitted by the ceph-mgr prometheus module
 * (honor_labels), identity in the `ceph_daemon` (osd.3, mon.a, …) or
 * `pool_id` datapoint labels. Same single-source rule as Proxmox: one
 * scan feeds the CephResource inventory and the CephCluster
 * count/health/capacity snapshot columns.
 */
export const CEPH_SNAPSHOT_METRIC_NAMES: ReadonlySet<string> = new Set([
  // Cluster-level health / capacity (WI-3 columns)
  "ceph_health_status",
  "ceph_cluster_total_bytes",
  "ceph_cluster_total_used_bytes",
  // Daemon identity / status
  "ceph_mon_quorum_status",
  "ceph_mon_metadata",
  "ceph_osd_up",
  "ceph_osd_in",
  "ceph_osd_metadata",
  "ceph_mgr_metadata",
  "ceph_mds_metadata",
  "ceph_rgw_metadata",
  // OSD latest-metric mirror (WI-6 inventory columns)
  "ceph_osd_stat_bytes",
  "ceph_osd_stat_bytes_used",
  "ceph_osd_apply_latency_ms",
  "ceph_osd_commit_latency_ms",
  "ceph_osd_numpg",
  // Pool identity + latest-metric mirror
  "ceph_pool_metadata",
  "ceph_pool_stored",
  "ceph_pool_max_avail",
  "ceph_pool_objects",
  "ceph_pool_rd",
  "ceph_pool_wr",
]);

/*
 * One Proxmox resource (Node / Guest / Storage) folded across a batch.
 * Identity labels are first-non-null-wins (stable for the lifetime of
 * the resource); status / metric fields are newest-observedAt-wins.
 */
export interface ProxmoxResourceBufferEntry {
  kind: string; // Node | Guest | Storage
  externalId: string; // raw `id` label
  name: string | null;
  vmid: number | null;
  guestType: string | null;
  parentNodeName: string | null;
  isUp: boolean | null;
  haState: string | null;
  onboot: boolean | null;
  uptimeSeconds: number | null;
  latestCpuPercent: number | null;
  latestMemoryBytes: number | null;
  maxMemoryBytes: number | null;
  latestDiskBytes: number | null;
  maxDiskBytes: number | null;
  observedAt: Date;
}

/*
 * Per-cluster Proxmox snapshot state. The saw* flags implement the
 * never-zero-a-count-on-a-partial-batch contract: a count column is
 * only written when the batch carried the matching identity series.
 */
export interface ProxmoxClusterSnapshotBufferEntry {
  sawNodeIdentity: boolean; // pve_node_info, or pve_up on a node id
  sawNodeUp: boolean; // pve_up on a node id
  sawGuestIdentity: boolean; // pve_guest_info
  sawStorageIdentity: boolean; // pve_storage_info
  pveVersion: string | null; // pve_version_info `version` label
  /*
   * WI-24 backup coverage. sawBackupInfo flips when the batch carried
   * the backup-info collector output at all (either series) — the
   * per-guest isBackedUp flag and the cluster count are only written
   * then (never-zero-on-partial-batch guard: a batch without the
   * collector must not mark every guest "covered").
   */
  sawBackupInfo: boolean;
  guestsWithoutBackupCount: number | null; // pve_not_backed_up_total value
  notBackedUpIds: Set<string>; // raw `id` labels of pve_not_backed_up_info
}

/*
 * One Ceph resource (Osd / Pool / Mon / Mgr / Mds / Rgw) folded across
 * a batch. Same merge semantics as ProxmoxResourceBufferEntry.
 */
export interface CephResourceBufferEntry {
  kind: string;
  externalId: string; // ceph_daemon or pool_id
  name: string | null; // pool name
  hostname: string | null;
  daemonVersion: string | null;
  deviceClass: string | null;
  isUp: boolean | null;
  isIn: boolean | null;
  inQuorum: boolean | null;
  statBytes: number | null;
  statBytesUsed: number | null;
  applyLatencyMs: number | null;
  commitLatencyMs: number | null;
  pgCount: number | null;
  storedBytes: number | null;
  maxAvailBytes: number | null;
  objects: number | null;
  readOpsCounter: number | null;
  writeOpsCounter: number | null;
  observedAt: Date;
}

// Per-cluster Ceph snapshot state — same saw* contract as Proxmox.
export interface CephClusterSnapshotBufferEntry {
  sawMonMetadata: boolean;
  sawOsdMetadata: boolean;
  sawOsdUp: boolean;
  sawOsdIn: boolean;
  sawPoolMetadata: boolean;
  healthStatus: number | null; // 0 OK / 1 WARN / 2 ERR
  totalBytes: number | null;
  totalUsedBytes: number | null;
  // ceph_version label occurrences across ceph_mon_metadata — modal wins.
  cephVersionCounts: Map<string, number>;
}

// The ProxmoxCluster snapshot columns derived from one folded batch.
export interface ProxmoxClusterSnapshotExtras {
  pveVersion?: string | undefined;
  nodeCount?: number | undefined;
  onlineNodeCount?: number | undefined;
  guestCount?: number | undefined;
  storageCount?: number | undefined;
  guestsWithoutBackupCount?: number | undefined;
}

// The CephCluster snapshot columns derived from one folded batch.
export interface CephClusterSnapshotExtras {
  cephVersion?: string | undefined;
  monCount?: number | undefined;
  osdCount?: number | undefined;
  osdUpCount?: number | undefined;
  osdInCount?: number | undefined;
  poolCount?: number | undefined;
  healthStatus?: number | undefined;
  capacityUsedPercent?: number | undefined;
}

/*
 * Same finite-or-null coercion contract as the ingest service's
 * toNumberOrNull (NaN / ±Infinity fold to null so a malformed
 * datapoint is skipped rather than poisoning a snapshot column).
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
 * Same fall-back-to-now parse contract as the ingest service's
 * safeParseUnixNano — only the Date is needed on the snapshot path.
 */
function parseUnixNanoToDate(
  value: string | number | undefined,
  context: string,
): Date {
  let numericValue: number = OneUptimeDate.getCurrentDateAsUnixNano();

  if (value !== undefined && value !== null) {
    try {
      if (typeof value === "string") {
        const parsed: number = Number.parseFloat(value);
        if (isNaN(parsed)) {
          throw new Error(`Invalid timestamp string: ${value}`);
        }
        numericValue = parsed;
      } else if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          throw new Error(`Invalid timestamp number: ${value}`);
        }
        numericValue = value;
      }
    } catch (error) {
      logger.warn(
        `Error processing ${context}: ${error instanceof Error ? error.message : String(error)}, using current time`,
      );
      numericValue = OneUptimeDate.getCurrentDateAsUnixNano();
    }
  }

  return OneUptimeDate.fromUnixNano(numericValue);
}

// Same trim-or-null read contract as OtelIngestBaseService.getStringAttribute.
function getStringAttribute(attributes: JSONArray, key: string): string | null {
  for (const attribute of attributes) {
    if (
      attribute["key"] === key &&
      attribute["value"] &&
      (attribute["value"] as JSONObject)["stringValue"]
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

export function getOrCreateProxmoxClusterSnapshot(
  buffer: Map<string, ProxmoxClusterSnapshotBufferEntry>,
  clusterIdStr: string,
): ProxmoxClusterSnapshotBufferEntry {
  let entry: ProxmoxClusterSnapshotBufferEntry | undefined =
    buffer.get(clusterIdStr);
  if (!entry) {
    entry = {
      sawNodeIdentity: false,
      sawNodeUp: false,
      sawGuestIdentity: false,
      sawStorageIdentity: false,
      pveVersion: null,
      sawBackupInfo: false,
      guestsWithoutBackupCount: null,
      notBackedUpIds: new Set(),
    };
    buffer.set(clusterIdStr, entry);
  }
  return entry;
}

/*
 * Fold one pve_* datapoint into the per-cluster buffers. Identity
 * lives in the `id` DATAPOINT label (prometheus receiver), so this
 * reads the raw datapoint attribute array — not the merged
 * resource-prefixed map the K8s scan uses.
 */
export function bufferProxmoxSnapshotMetric(data: {
  clusterIdStr: string;
  metricName: string;
  datapoint: JSONObject;
  resourceBuffer: Map<string, Map<string, ProxmoxResourceBufferEntry>>;
  clusterBuffer: Map<string, ProxmoxClusterSnapshotBufferEntry>;
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
    "pve snapshot timeUnixNano",
  );

  const dpAttributes: JSONArray =
    (data.datapoint["attributes"] as JSONArray) || [];

  const cluster: ProxmoxClusterSnapshotBufferEntry =
    getOrCreateProxmoxClusterSnapshot(data.clusterBuffer, data.clusterIdStr);

  /*
   * pve_version_info carries no `id` label — it is the cluster-level
   * PVE version (this is what populates ProxmoxCluster.pveVersion).
   */
  if (data.metricName === "pve_version_info") {
    const version: string | null = getStringAttribute(dpAttributes, "version");
    if (version) {
      cluster.pveVersion = version;
    }
    return;
  }

  /*
   * WI-24 backup coverage — cluster-level backup-info collector
   * series, handled before the generic scope parse:
   * pve_not_backed_up_total carries no `id` label, and the
   * pve_not_backed_up_info `id` label format is unverified upstream
   * (`qemu/100` vs bare vmid — §3.9 spike), so neither goes through
   * the inventory-row path. The ids are folded into the cluster
   * buffer and joined to the buffered Guest rows at flush time.
   */
  if (data.metricName === "pve_not_backed_up_total") {
    cluster.sawBackupInfo = true;
    cluster.guestsWithoutBackupCount = Math.max(0, Math.trunc(rawValue));
    return;
  }
  if (data.metricName === "pve_not_backed_up_info") {
    cluster.sawBackupInfo = true;
    const uncoveredId: string | null = getStringAttribute(dpAttributes, "id");
    if (uncoveredId) {
      cluster.notBackedUpIds.add(uncoveredId);
    }
    return;
  }

  const id: string | null = getStringAttribute(dpAttributes, "id");
  if (!id) {
    return;
  }

  /*
   * Scope/type: prefer the pve.scope / pve.type attributes stamped
   * by the agent's transform/pve-identity processor; fall back to
   * parsing the id prefix so inventory still populates on a
   * hand-rolled collector config without the transform.
   */
  const slashIndex: number = id.indexOf("/");
  const idPrefix: string = slashIndex > 0 ? id.substring(0, slashIndex) : "";
  const pveType: string =
    getStringAttribute(dpAttributes, "pve.type") || idPrefix;
  let scope: string | null = getStringAttribute(dpAttributes, "pve.scope");
  if (!scope) {
    scope = idPrefix === "qemu" || idPrefix === "lxc" ? "guest" : idPrefix;
  }

  let kind: string;
  if (scope === "node") {
    kind = "Node";
  } else if (scope === "guest") {
    kind = "Guest";
  } else if (scope === "storage") {
    kind = "Storage";
  } else {
    // cluster/* series and unknown scopes aren't inventory rows.
    return;
  }

  const patch: ProxmoxResourceBufferEntry = {
    kind,
    externalId: id,
    name: null,
    vmid: null,
    guestType: null,
    parentNodeName: null,
    isUp: null,
    haState: null,
    onboot: null,
    uptimeSeconds: null,
    latestCpuPercent: null,
    latestMemoryBytes: null,
    maxMemoryBytes: null,
    latestDiskBytes: null,
    maxDiskBytes: null,
    observedAt,
  };

  if (kind === "Guest") {
    patch.guestType = pveType === "qemu" || pveType === "lxc" ? pveType : null;
    if (slashIndex > 0) {
      const vmidParsed: number = parseInt(id.substring(slashIndex + 1), 10);
      patch.vmid = isNaN(vmidParsed) ? null : vmidParsed;
    }
  }

  // `node` label: present on the info series and pve_onboot_status.
  const nodeLabel: string | null = getStringAttribute(dpAttributes, "node");
  if (nodeLabel && kind !== "Node") {
    patch.parentNodeName = nodeLabel;
  }

  switch (data.metricName) {
    case "pve_up": {
      patch.isUp = rawValue >= 1;
      if (kind === "Node") {
        // pve_up doubles as the node-identity fallback per the spec.
        cluster.sawNodeIdentity = true;
        cluster.sawNodeUp = true;
      }
      break;
    }
    case "pve_node_info": {
      patch.name = getStringAttribute(dpAttributes, "name");
      cluster.sawNodeIdentity = true;
      break;
    }
    case "pve_guest_info": {
      patch.name = getStringAttribute(dpAttributes, "name");
      cluster.sawGuestIdentity = true;
      break;
    }
    case "pve_storage_info": {
      patch.name = getStringAttribute(dpAttributes, "storage");
      cluster.sawStorageIdentity = true;
      break;
    }
    case "pve_ha_state": {
      /*
       * Enum-series: one row per possible state, value 1 marks the
       * current one. Only the active row carries signal — skip the
       * zero-valued rows entirely so they don't create empty patches.
       */
      if (rawValue < 1) {
        return;
      }
      patch.haState = getStringAttribute(dpAttributes, "state");
      break;
    }
    case "pve_onboot_status": {
      patch.onboot = rawValue >= 1;
      break;
    }
    case "pve_uptime_seconds": {
      patch.uptimeSeconds = Math.max(0, Math.trunc(rawValue));
      break;
    }
    case "pve_cpu_usage_ratio": {
      /*
       * Already a true 0..1 ratio — no allocatable-denominator cache
       * needed, unlike K8s cpuCoresToPercent.
       */
      patch.latestCpuPercent = rawValue * 100;
      break;
    }
    case "pve_memory_usage_bytes": {
      patch.latestMemoryBytes = Math.max(0, Math.trunc(rawValue));
      break;
    }
    case "pve_memory_size_bytes": {
      patch.maxMemoryBytes = Math.max(0, Math.trunc(rawValue));
      break;
    }
    case "pve_disk_usage_bytes": {
      patch.latestDiskBytes = Math.max(0, Math.trunc(rawValue));
      break;
    }
    case "pve_disk_size_bytes": {
      patch.maxDiskBytes = Math.max(0, Math.trunc(rawValue));
      break;
    }
    default: {
      return;
    }
  }

  foldProxmoxResourceSnapshot({
    buffer: data.resourceBuffer,
    clusterIdStr: data.clusterIdStr,
    patch,
  });
}

/*
 * Merge a patch into the per-cluster Proxmox buffer: identity labels
 * are first-non-null-wins (stable, and a batch missing an info
 * series must not blank them), status/metric fields are
 * newest-observedAt-wins (K8s buffer semantics).
 */
export function foldProxmoxResourceSnapshot(data: {
  buffer: Map<string, Map<string, ProxmoxResourceBufferEntry>>;
  clusterIdStr: string;
  patch: ProxmoxResourceBufferEntry;
}): void {
  let perCluster: Map<string, ProxmoxResourceBufferEntry> | undefined =
    data.buffer.get(data.clusterIdStr);
  if (!perCluster) {
    perCluster = new Map();
    data.buffer.set(data.clusterIdStr, perCluster);
  }
  const key: string = `${data.patch.kind}|${data.patch.externalId}`;
  const existing: ProxmoxResourceBufferEntry | undefined = perCluster.get(key);
  if (!existing) {
    perCluster.set(key, data.patch);
    return;
  }

  const patch: ProxmoxResourceBufferEntry = data.patch;
  const newer: boolean = patch.observedAt >= existing.observedAt;

  // Identity: first-non-null wins.
  if (existing.name === null && patch.name !== null) {
    existing.name = patch.name;
  }
  if (existing.vmid === null && patch.vmid !== null) {
    existing.vmid = patch.vmid;
  }
  if (existing.guestType === null && patch.guestType !== null) {
    existing.guestType = patch.guestType;
  }
  if (existing.parentNodeName === null && patch.parentNodeName !== null) {
    existing.parentNodeName = patch.parentNodeName;
  }

  // Status / metrics: newest observation wins.
  if (patch.isUp !== null && newer) {
    existing.isUp = patch.isUp;
  }
  if (patch.haState !== null && newer) {
    existing.haState = patch.haState;
  }
  if (patch.onboot !== null && newer) {
    existing.onboot = patch.onboot;
  }
  if (patch.uptimeSeconds !== null && newer) {
    existing.uptimeSeconds = patch.uptimeSeconds;
  }
  if (patch.latestCpuPercent !== null && newer) {
    existing.latestCpuPercent = patch.latestCpuPercent;
  }
  if (patch.latestMemoryBytes !== null && newer) {
    existing.latestMemoryBytes = patch.latestMemoryBytes;
  }
  if (patch.maxMemoryBytes !== null && newer) {
    existing.maxMemoryBytes = patch.maxMemoryBytes;
  }
  if (patch.latestDiskBytes !== null && newer) {
    existing.latestDiskBytes = patch.latestDiskBytes;
  }
  if (patch.maxDiskBytes !== null && newer) {
    existing.maxDiskBytes = patch.maxDiskBytes;
  }
  if (patch.observedAt > existing.observedAt) {
    existing.observedAt = patch.observedAt;
  }
}

/*
 * WI-24: a guest is "covered by a backup job" exactly when the batch
 * carried the backup-info collector output at all AND no
 * pve_not_backed_up_info series carries its id (series present =
 * NOT covered — the exporter emits one info row per uncovered
 * guest). A batch without the collector output yields null, so the
 * upsert COALESCE keeps the last-known value (the same
 * never-zero-on-partial-batch guard the count columns use).
 *
 * The info `id` label's value format is unverified upstream
 * (`qemu/100` vs bare vmid — §3.9 spike), so match both the full
 * externalId and the bare vmid.
 */
export function computeProxmoxGuestBackedUp(
  entry: ProxmoxResourceBufferEntry,
  snap: ProxmoxClusterSnapshotBufferEntry | undefined,
): boolean | null {
  if (entry.kind !== "Guest" || !snap?.sawBackupInfo) {
    return null;
  }
  if (snap.notBackedUpIds.has(entry.externalId)) {
    return false;
  }
  if (entry.vmid !== null && snap.notBackedUpIds.has(String(entry.vmid))) {
    return false;
  }
  return true;
}

/*
 * Derive the ProxmoxCluster snapshot columns from one folded batch.
 * Counts are only set when the batch carried the matching identity
 * series — never zero a count on a partial batch. Returns an object
 * whose keys are exactly the columns to write (empty object = nothing
 * to write).
 */
export function deriveProxmoxClusterSnapshotExtras(
  entries: Array<ProxmoxResourceBufferEntry>,
  snap: ProxmoxClusterSnapshotBufferEntry | undefined,
): ProxmoxClusterSnapshotExtras {
  const extras: ProxmoxClusterSnapshotExtras = {};

  if (snap?.pveVersion) {
    extras.pveVersion = snap.pveVersion;
  }
  if (snap?.sawNodeIdentity) {
    extras.nodeCount = entries.filter((e: ProxmoxResourceBufferEntry) => {
      return e.kind === "Node";
    }).length;
  }
  if (snap?.sawNodeUp) {
    extras.onlineNodeCount = entries.filter((e: ProxmoxResourceBufferEntry) => {
      return e.kind === "Node" && e.isUp === true;
    }).length;
  }
  if (snap?.sawGuestIdentity) {
    extras.guestCount = entries.filter((e: ProxmoxResourceBufferEntry) => {
      return e.kind === "Guest";
    }).length;
  }
  if (snap?.sawStorageIdentity) {
    extras.storageCount = entries.filter((e: ProxmoxResourceBufferEntry) => {
      return e.kind === "Storage";
    }).length;
  }
  /*
   * WI-24: written only when the batch carried pve_not_backed_up_total
   * itself — NULL in Postgres stays "collector not reporting",
   * distinct from 0 uncovered guests.
   */
  if (
    snap &&
    snap.guestsWithoutBackupCount !== null &&
    snap.guestsWithoutBackupCount !== undefined
  ) {
    extras.guestsWithoutBackupCount = snap.guestsWithoutBackupCount;
  }

  return extras;
}

export function getOrCreateCephClusterSnapshot(
  buffer: Map<string, CephClusterSnapshotBufferEntry>,
  clusterIdStr: string,
): CephClusterSnapshotBufferEntry {
  let entry: CephClusterSnapshotBufferEntry | undefined =
    buffer.get(clusterIdStr);
  if (!entry) {
    entry = {
      sawMonMetadata: false,
      sawOsdMetadata: false,
      sawOsdUp: false,
      sawOsdIn: false,
      sawPoolMetadata: false,
      healthStatus: null,
      totalBytes: null,
      totalUsedBytes: null,
      cephVersionCounts: new Map(),
    };
    buffer.set(clusterIdStr, entry);
  }
  return entry;
}

export function emptyCephResourceEntry(
  kind: string,
  externalId: string,
  observedAt: Date,
): CephResourceBufferEntry {
  return {
    kind,
    externalId,
    name: null,
    hostname: null,
    daemonVersion: null,
    deviceClass: null,
    isUp: null,
    isIn: null,
    inQuorum: null,
    statBytes: null,
    statBytesUsed: null,
    applyLatencyMs: null,
    commitLatencyMs: null,
    pgCount: null,
    storedBytes: null,
    maxAvailBytes: null,
    objects: null,
    readOpsCounter: null,
    writeOpsCounter: null,
    observedAt,
  };
}

/*
 * Fold one ceph_* datapoint into the per-cluster buffers. Pool
 * series are keyed by the `pool_id` datapoint label, daemon series
 * by `ceph_daemon` (osd.3, mon.a, mgr.x, …).
 */
export function bufferCephSnapshotMetric(data: {
  clusterIdStr: string;
  metricName: string;
  datapoint: JSONObject;
  resourceBuffer: Map<string, Map<string, CephResourceBufferEntry>>;
  clusterBuffer: Map<string, CephClusterSnapshotBufferEntry>;
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
    "ceph snapshot timeUnixNano",
  );

  const dpAttributes: JSONArray =
    (data.datapoint["attributes"] as JSONArray) || [];

  const cluster: CephClusterSnapshotBufferEntry =
    getOrCreateCephClusterSnapshot(data.clusterBuffer, data.clusterIdStr);

  // Cluster-level series — no per-resource row.
  if (data.metricName === "ceph_health_status") {
    // 0 = HEALTH_OK, 1 = HEALTH_WARN, 2 = HEALTH_ERR.
    cluster.healthStatus = Math.max(0, Math.trunc(rawValue));
    return;
  }
  if (data.metricName === "ceph_cluster_total_bytes") {
    cluster.totalBytes = Math.max(0, rawValue);
    return;
  }
  if (data.metricName === "ceph_cluster_total_used_bytes") {
    cluster.totalUsedBytes = Math.max(0, rawValue);
    return;
  }

  if (data.metricName.startsWith("ceph_pool_")) {
    const poolId: string | null = getStringAttribute(dpAttributes, "pool_id");
    if (!poolId) {
      return;
    }

    const patch: CephResourceBufferEntry = emptyCephResourceEntry(
      "Pool",
      poolId,
      observedAt,
    );

    switch (data.metricName) {
      case "ceph_pool_metadata": {
        // The only pool series that carries the human-readable name.
        patch.name = getStringAttribute(dpAttributes, "name");
        cluster.sawPoolMetadata = true;
        break;
      }
      case "ceph_pool_stored": {
        patch.storedBytes = Math.max(0, Math.trunc(rawValue));
        break;
      }
      case "ceph_pool_max_avail": {
        patch.maxAvailBytes = Math.max(0, Math.trunc(rawValue));
        break;
      }
      case "ceph_pool_objects": {
        patch.objects = Math.max(0, Math.trunc(rawValue));
        break;
      }
      /*
       * Latest RAW cumulative counters — the Pools list computes
       * IOPS rates on read from ClickHouse, never from these.
       */
      case "ceph_pool_rd": {
        patch.readOpsCounter = Math.max(0, Math.trunc(rawValue));
        break;
      }
      case "ceph_pool_wr": {
        patch.writeOpsCounter = Math.max(0, Math.trunc(rawValue));
        break;
      }
      default: {
        return;
      }
    }

    foldCephResourceSnapshot({
      buffer: data.resourceBuffer,
      clusterIdStr: data.clusterIdStr,
      patch,
    });
    return;
  }

  const cephDaemon: string | null = getStringAttribute(
    dpAttributes,
    "ceph_daemon",
  );
  if (!cephDaemon) {
    return;
  }

  const dotIndex: number = cephDaemon.indexOf(".");
  const daemonPrefix: string =
    dotIndex > 0 ? cephDaemon.substring(0, dotIndex) : "";
  let kind: string;
  if (daemonPrefix === "osd") {
    kind = "Osd";
  } else if (daemonPrefix === "mon") {
    kind = "Mon";
  } else if (daemonPrefix === "mgr") {
    kind = "Mgr";
  } else if (daemonPrefix === "mds") {
    kind = "Mds";
  } else if (daemonPrefix === "rgw") {
    kind = "Rgw";
  } else {
    return;
  }

  const patch: CephResourceBufferEntry = emptyCephResourceEntry(
    kind,
    cephDaemon,
    observedAt,
  );

  switch (data.metricName) {
    case "ceph_mon_quorum_status": {
      patch.inQuorum = rawValue >= 1;
      break;
    }
    case "ceph_mon_metadata": {
      patch.hostname = getStringAttribute(dpAttributes, "hostname");
      patch.daemonVersion = getStringAttribute(dpAttributes, "ceph_version");
      cluster.sawMonMetadata = true;
      // CephCluster.cephVersion = modal mon version across the batch.
      if (patch.daemonVersion) {
        cluster.cephVersionCounts.set(
          patch.daemonVersion,
          (cluster.cephVersionCounts.get(patch.daemonVersion) || 0) + 1,
        );
      }
      break;
    }
    case "ceph_osd_up": {
      patch.isUp = rawValue >= 1;
      cluster.sawOsdUp = true;
      break;
    }
    case "ceph_osd_in": {
      patch.isIn = rawValue >= 1;
      cluster.sawOsdIn = true;
      break;
    }
    case "ceph_osd_metadata": {
      patch.hostname = getStringAttribute(dpAttributes, "hostname");
      patch.deviceClass = getStringAttribute(dpAttributes, "device_class");
      patch.daemonVersion = getStringAttribute(dpAttributes, "ceph_version");
      cluster.sawOsdMetadata = true;
      break;
    }
    case "ceph_mgr_metadata":
    case "ceph_mds_metadata":
    case "ceph_rgw_metadata": {
      patch.hostname = getStringAttribute(dpAttributes, "hostname");
      patch.daemonVersion = getStringAttribute(dpAttributes, "ceph_version");
      break;
    }
    case "ceph_osd_stat_bytes": {
      patch.statBytes = Math.max(0, Math.trunc(rawValue));
      break;
    }
    case "ceph_osd_stat_bytes_used": {
      patch.statBytesUsed = Math.max(0, Math.trunc(rawValue));
      break;
    }
    case "ceph_osd_apply_latency_ms": {
      patch.applyLatencyMs = Math.max(0, rawValue);
      break;
    }
    case "ceph_osd_commit_latency_ms": {
      patch.commitLatencyMs = Math.max(0, rawValue);
      break;
    }
    case "ceph_osd_numpg": {
      patch.pgCount = Math.max(0, Math.trunc(rawValue));
      break;
    }
    default: {
      return;
    }
  }

  foldCephResourceSnapshot({
    buffer: data.resourceBuffer,
    clusterIdStr: data.clusterIdStr,
    patch,
  });
}

/*
 * Merge a patch into the per-cluster Ceph buffer — same semantics
 * as foldProxmoxResourceSnapshot (identity first-non-null-wins,
 * status/metrics newest-observedAt-wins).
 */
export function foldCephResourceSnapshot(data: {
  buffer: Map<string, Map<string, CephResourceBufferEntry>>;
  clusterIdStr: string;
  patch: CephResourceBufferEntry;
}): void {
  let perCluster: Map<string, CephResourceBufferEntry> | undefined =
    data.buffer.get(data.clusterIdStr);
  if (!perCluster) {
    perCluster = new Map();
    data.buffer.set(data.clusterIdStr, perCluster);
  }
  const key: string = `${data.patch.kind}|${data.patch.externalId}`;
  const existing: CephResourceBufferEntry | undefined = perCluster.get(key);
  if (!existing) {
    perCluster.set(key, data.patch);
    return;
  }

  const patch: CephResourceBufferEntry = data.patch;
  const newer: boolean = patch.observedAt >= existing.observedAt;

  // Identity: first-non-null wins.
  if (existing.name === null && patch.name !== null) {
    existing.name = patch.name;
  }
  if (existing.hostname === null && patch.hostname !== null) {
    existing.hostname = patch.hostname;
  }
  if (existing.daemonVersion === null && patch.daemonVersion !== null) {
    existing.daemonVersion = patch.daemonVersion;
  }
  if (existing.deviceClass === null && patch.deviceClass !== null) {
    existing.deviceClass = patch.deviceClass;
  }

  // Status / metrics: newest observation wins.
  if (patch.isUp !== null && newer) {
    existing.isUp = patch.isUp;
  }
  if (patch.isIn !== null && newer) {
    existing.isIn = patch.isIn;
  }
  if (patch.inQuorum !== null && newer) {
    existing.inQuorum = patch.inQuorum;
  }
  if (patch.statBytes !== null && newer) {
    existing.statBytes = patch.statBytes;
  }
  if (patch.statBytesUsed !== null && newer) {
    existing.statBytesUsed = patch.statBytesUsed;
  }
  if (patch.applyLatencyMs !== null && newer) {
    existing.applyLatencyMs = patch.applyLatencyMs;
  }
  if (patch.commitLatencyMs !== null && newer) {
    existing.commitLatencyMs = patch.commitLatencyMs;
  }
  if (patch.pgCount !== null && newer) {
    existing.pgCount = patch.pgCount;
  }
  if (patch.storedBytes !== null && newer) {
    existing.storedBytes = patch.storedBytes;
  }
  if (patch.maxAvailBytes !== null && newer) {
    existing.maxAvailBytes = patch.maxAvailBytes;
  }
  if (patch.objects !== null && newer) {
    existing.objects = patch.objects;
  }
  if (patch.readOpsCounter !== null && newer) {
    existing.readOpsCounter = patch.readOpsCounter;
  }
  if (patch.writeOpsCounter !== null && newer) {
    existing.writeOpsCounter = patch.writeOpsCounter;
  }
  if (patch.observedAt > existing.observedAt) {
    existing.observedAt = patch.observedAt;
  }
}

/*
 * Derive the CephCluster snapshot columns from one folded batch —
 * same never-zero-a-count-on-a-partial-batch contract as the Proxmox
 * derive above.
 */
export function deriveCephClusterSnapshotExtras(
  entries: Array<CephResourceBufferEntry>,
  snap: CephClusterSnapshotBufferEntry | undefined,
): CephClusterSnapshotExtras {
  const extras: CephClusterSnapshotExtras = {};

  if (snap?.sawMonMetadata) {
    extras.monCount = entries.filter((e: CephResourceBufferEntry) => {
      return e.kind === "Mon";
    }).length;
  }
  if (snap?.sawOsdMetadata) {
    extras.osdCount = entries.filter((e: CephResourceBufferEntry) => {
      return e.kind === "Osd";
    }).length;
  }
  if (snap?.sawOsdUp) {
    extras.osdUpCount = entries.filter((e: CephResourceBufferEntry) => {
      return e.kind === "Osd" && e.isUp === true;
    }).length;
  }
  if (snap?.sawOsdIn) {
    extras.osdInCount = entries.filter((e: CephResourceBufferEntry) => {
      return e.kind === "Osd" && e.isIn === true;
    }).length;
  }
  if (snap?.sawPoolMetadata) {
    extras.poolCount = entries.filter((e: CephResourceBufferEntry) => {
      return e.kind === "Pool";
    }).length;
  }
  if (snap && snap.healthStatus !== null) {
    extras.healthStatus = snap.healthStatus;
  }
  if (
    snap &&
    snap.totalBytes !== null &&
    snap.totalBytes > 0 &&
    snap.totalUsedBytes !== null
  ) {
    /*
     * Round to 2 decimals: full float precision would change the
     * extras fingerprint on every scrape and defeat the 60-s
     * write throttle for an invisible difference.
     */
    extras.capacityUsedPercent =
      Math.round((snap.totalUsedBytes / snap.totalBytes) * 10000) / 100;
  }
  if (snap && snap.cephVersionCounts.size > 0) {
    let modalVersion: string | null = null;
    let modalCount: number = 0;
    for (const [version, count] of snap.cephVersionCounts.entries()) {
      if (count > modalCount) {
        modalVersion = version;
        modalCount = count;
      }
    }
    if (modalVersion) {
      extras.cephVersion = modalVersion;
    }
  }

  return extras;
}
