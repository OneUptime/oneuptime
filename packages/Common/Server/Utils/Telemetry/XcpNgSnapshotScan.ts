import OneUptimeDate from "../../../Types/Date";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import XcpNgResourceKind from "../../../Types/XcpNg/XcpNgResourceKind";
import {
  XcpNgHostPowerState,
  XcpNgLabel,
  XcpNgSeries,
  XcpNgVmPowerState,
} from "../../../Types/XcpNg/XcpNgTelemetry";

/*
 * ------------------------------------------------------------------
 * XCP-ng snapshot scan - pure fold helpers
 * ------------------------------------------------------------------
 *
 * Turns the series Xen Orchestra's OpenMetrics plugin reports for one pool
 * into the pool's inventory (XcpNgResource rows: hosts, VMs, storage
 * repositories and virtual disks), as ProxmoxCephSnapshotScan does for a
 * Proxmox cluster. The ingest service owns the I/O: it walks the OTLP
 * payload, calls bufferXcpNgSnapshotMetric per datapoint of a pool's
 * resource block, and at flush time maps getXcpNgResourceRows through
 * XcpNgResourceService. Everything here is pure (Map mutation only), which
 * is what makes it testable against a recorded scrape.
 *
 * How it reads Xen Orchestra's labels (xo-server-openmetrics 1.9):
 *
 *   - A host is the `uuid` of the xcp_host_* series. xcp_host_status says
 *     its power_state (Running, Halted, Unknown) and enabled flag for every
 *     host, running or not; the RRD series (CPU, memory, ...) arrive only
 *     while it runs.
 *   - A VM is the `uuid` of the xcp_vm_* series. xcp_vm_status reports
 *     every VM but the control domains (dom0) and templates, halted ones
 *     included; the RRD series carry host_id / host_name (the host it runs
 *     on) and is_control_domain. A control domain only ever appears in RRD
 *     series, so it is a VM marked isControlDomain.
 *   - A storage repository is the `sr_uuid` of the xcp_sr_* series; a local
 *     one names its host (host_id / host_name), a shared one names none.
 *     The host disk series name storage repositories by a truncated id
 *     (the `sr` label) and are not folded into them.
 *   - A virtual disk is the `vdi_uuid` of the xcp_vdi_* series, with its
 *     storage repository and, when attached, its VM.
 *
 * Merge rules, as for Proxmox: identity (name and the objects it belongs
 * to) is newest-wins but never blanked by a series that does not carry it;
 * readings are newest-observedAt-wins. A datapoint the prometheus receiver
 * marks as a staleness marker (the series just disappeared: a deleted VM,
 * a pool Xen Orchestra lost) is never folded, or a VM deleted a minute ago
 * would look freshly reported.
 *
 * Counts are not derived here: the agent's batch processor can split one
 * scrape of a big pool across several requests, so a request holds only
 * part of a pool. The pool's counts are recounted from the stored inventory
 * after the upsert (XcpNgResourceService.getInventorySummary).
 */

export interface XcpNgResourceBufferEntry {
  kind: XcpNgResourceKind;
  externalId: string;
  name: string | null;
  powerState: string | null;
  isUp: boolean | null;
  isEnabled: boolean | null;
  isControlDomain: boolean | null;
  parentHostExternalId: string | null;
  parentHostName: string | null;
  storageRepositoryExternalId: string | null;
  storageRepositoryName: string | null;
  vmExternalId: string | null;
  vmName: string | null;
  uptimeSeconds: number | null;
  cpuPercent: number | null;
  // The distinct `core` labels of the per-core CPU series: CPU threads or vCPUs.
  cpuCores: Set<string>;
  runningVcpuCount: number | null;
  loadAverage: number | null;
  // A host's total memory, or the memory a VM was given.
  memoryTotalBytes: number | null;
  // A host's free memory, or what a VM's guest reports free.
  memoryFreeBytes: number | null;
  diskUsedBytes: number | null;
  diskSizeBytes: number | null;
  virtualAllocationBytes: number | null;
  srType: string | null;
  contentType: string | null;
  isShared: boolean | null;
  powerWatts: number | null;
  tags: string | null;
  // When the VM was last reported Running in this batch; null when it was not.
  runningAt: Date | null;
  observedAt: Date;
}

/*
 * The series the inventory reads, by name. Every other xcp_* series still
 * refreshes the object it names (its lastSeenAt), so a host that only
 * reports disk series is still seen.
 */
export const XCP_NG_SNAPSHOT_METRIC_PREFIXES: ReadonlyArray<string> = [
  "xcp_host_",
  "xcp_vm_",
  "xcp_sr_",
  "xcp_vdi_",
  "xcp_pool_",
];

export function isXcpNgSnapshotMetric(metricName: string): boolean {
  return XCP_NG_SNAPSHOT_METRIC_PREFIXES.some((prefix: string) => {
    return metricName.startsWith(prefix);
  });
}

// Finite-or-null, as every snapshot scan coerces a datapoint's value.
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
 * The datapoint's time, or now when it has none or one that cannot be read
 * (an Invalid Date reaching the upsert would fail the timestamptz cast and
 * drop the whole chunk).
 */
export function getXcpNgDatapointTime(datapoint: JSONObject): Date {
  const raw: JSONValue | undefined = datapoint["timeUnixNano"];
  try {
    if (typeof raw === "string" && raw.trim() !== "" && !isNaN(Number(raw))) {
      const parsed: Date = OneUptimeDate.fromUnixNano(raw.trim());
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const parsed: Date = OneUptimeDate.fromUnixNano(raw);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  } catch {
    // Fall through to now.
  }
  return OneUptimeDate.getCurrentDate();
}

// A datapoint's label, trimmed; null when absent or empty.
export function getXcpNgLabel(
  datapoint: JSONObject,
  key: string,
): string | null {
  const attributes: JSONArray = (datapoint["attributes"] as JSONArray) || [];
  for (const attribute of attributes) {
    if (!attribute || (attribute as JSONObject)["key"] !== key) {
      continue;
    }
    const value: JSONObject | undefined = (attribute as JSONObject)["value"] as
      | JSONObject
      | undefined;
    const stringValue: JSONValue | undefined = value?.["stringValue"];
    if (typeof stringValue === "string" && stringValue.trim()) {
      return stringValue.trim();
    }
  }
  return null;
}

/*
 * FLAG_NO_RECORDED_VALUE: how the prometheus receiver forwards a Prometheus
 * staleness marker. The series just disappeared; it reports nothing.
 */
export function isXcpNgStaleDatapoint(datapoint: JSONObject): boolean {
  return (Number(datapoint["flags"]) & 1) === 1;
}

export function getXcpNgDatapointValue(datapoint: JSONObject): number | null {
  return (
    toNumberOrNull(datapoint["asDouble"]) ?? toNumberOrNull(datapoint["asInt"])
  );
}

export function emptyXcpNgResourceEntry(
  kind: XcpNgResourceKind,
  externalId: string,
  observedAt: Date,
): XcpNgResourceBufferEntry {
  return {
    kind,
    externalId,
    name: null,
    powerState: null,
    isUp: null,
    isEnabled: null,
    isControlDomain: null,
    parentHostExternalId: null,
    parentHostName: null,
    storageRepositoryExternalId: null,
    storageRepositoryName: null,
    vmExternalId: null,
    vmName: null,
    uptimeSeconds: null,
    cpuPercent: null,
    cpuCores: new Set<string>(),
    runningVcpuCount: null,
    loadAverage: null,
    memoryTotalBytes: null,
    memoryFreeBytes: null,
    diskUsedBytes: null,
    diskSizeBytes: null,
    virtualAllocationBytes: null,
    srType: null,
    contentType: null,
    isShared: null,
    powerWatts: null,
    tags: null,
    runningAt: null,
    observedAt,
  };
}

// The resource buffer of one pool: "<kind>|<uuid>" -> entry.
export type XcpNgPoolResourceBuffer = Map<string, XcpNgResourceBufferEntry>;

function entryKey(kind: XcpNgResourceKind, externalId: string): string {
  return `${kind}|${externalId}`;
}

function getOrCreateEntry(data: {
  buffer: XcpNgPoolResourceBuffer;
  kind: XcpNgResourceKind;
  externalId: string;
  observedAt: Date;
}): XcpNgResourceBufferEntry {
  const key: string = entryKey(data.kind, data.externalId);
  let entry: XcpNgResourceBufferEntry | undefined = data.buffer.get(key);
  if (!entry) {
    entry = emptyXcpNgResourceEntry(
      data.kind,
      data.externalId,
      data.observedAt,
    );
    data.buffer.set(key, entry);
  }
  return entry;
}

/*
 * Newest-wins, but a value only moves an entry's reading forward in time:
 * an older datapoint arriving after a newer one never overwrites it. Each
 * reading keeps its own clock, since Xen Orchestra stamps its RRD series
 * with the RRD's time and its status series with the scrape's.
 */
type ReadingClock = Map<string, Date>;
const readingClocks: WeakMap<XcpNgResourceBufferEntry, ReadingClock> =
  new WeakMap<XcpNgResourceBufferEntry, ReadingClock>();

function isNewer(
  entry: XcpNgResourceBufferEntry,
  field: string,
  observedAt: Date,
): boolean {
  let clock: ReadingClock | undefined = readingClocks.get(entry);
  if (!clock) {
    clock = new Map<string, Date>();
    readingClocks.set(entry, clock);
  }
  const previous: Date | undefined = clock.get(field);
  if (previous && previous.getTime() > observedAt.getTime()) {
    return false;
  }
  clock.set(field, observedAt);
  return true;
}

function setReading<K extends keyof XcpNgResourceBufferEntry>(
  entry: XcpNgResourceBufferEntry,
  field: K,
  value: XcpNgResourceBufferEntry[K],
  observedAt: Date,
): void {
  if (isNewer(entry, field as string, observedAt)) {
    entry[field] = value;
  }
}

// Identity: newest-wins, never blanked by a series that does not carry it.
function setIdentity<K extends keyof XcpNgResourceBufferEntry>(
  entry: XcpNgResourceBufferEntry,
  field: K,
  value: XcpNgResourceBufferEntry[K] | null,
  observedAt: Date,
): void {
  if (value === null || value === undefined) {
    return;
  }
  setReading(entry, field, value as XcpNgResourceBufferEntry[K], observedAt);
}

function touch(entry: XcpNgResourceBufferEntry, observedAt: Date): void {
  if (observedAt.getTime() > entry.observedAt.getTime()) {
    entry.observedAt = observedAt;
  }
}

function foldHost(data: {
  buffer: XcpNgPoolResourceBuffer;
  metricName: string;
  datapoint: JSONObject;
  value: number;
  observedAt: Date;
}): void {
  const uuid: string | null = getXcpNgLabel(data.datapoint, XcpNgLabel.Uuid);
  if (!uuid) {
    return;
  }
  const entry: XcpNgResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: XcpNgResourceKind.Host,
    externalId: uuid.toLowerCase(),
    observedAt: data.observedAt,
  });
  touch(entry, data.observedAt);
  setIdentity(
    entry,
    "name",
    getXcpNgLabel(data.datapoint, XcpNgLabel.HostName),
    data.observedAt,
  );

  switch (data.metricName) {
    case XcpNgSeries.HostStatus: {
      const powerState: string | null = getXcpNgLabel(
        data.datapoint,
        XcpNgLabel.PowerState,
      );
      if (powerState) {
        setReading(entry, "powerState", powerState, data.observedAt);
        setReading(
          entry,
          "isUp",
          powerState === XcpNgHostPowerState.Running,
          data.observedAt,
        );
      }
      const enabled: string | null = getXcpNgLabel(
        data.datapoint,
        XcpNgLabel.Enabled,
      );
      if (enabled) {
        setReading(
          entry,
          "isEnabled",
          enabled.toLowerCase() === "true",
          data.observedAt,
        );
      }
      // Tags ride the status series; "no tags" is a reading too.
      setReading(
        entry,
        "tags",
        getXcpNgLabel(data.datapoint, XcpNgLabel.Tags) || "",
        data.observedAt,
      );
      return;
    }
    case XcpNgSeries.HostUptimeSeconds:
      setReading(entry, "uptimeSeconds", data.value, data.observedAt);
      return;
    case XcpNgSeries.HostCpuAverage:
      setReading(entry, "cpuPercent", data.value * 100, data.observedAt);
      return;
    case XcpNgSeries.HostMemoryTotalBytes:
      setReading(entry, "memoryTotalBytes", data.value, data.observedAt);
      return;
    case XcpNgSeries.HostMemoryFreeBytes:
      setReading(entry, "memoryFreeBytes", data.value, data.observedAt);
      return;
    case XcpNgSeries.HostRunningVcpus:
      setReading(entry, "runningVcpuCount", data.value, data.observedAt);
      return;
    case XcpNgSeries.HostLoadAverage:
      setReading(entry, "loadAverage", data.value, data.observedAt);
      return;
    case XcpNgSeries.HostPowerConsumptionWatts:
      setReading(entry, "powerWatts", data.value, data.observedAt);
      return;
    default:
      break;
  }

  if (data.metricName === "xcp_host_cpu_core_usage") {
    const core: string | null = getXcpNgLabel(data.datapoint, XcpNgLabel.Core);
    if (core !== null) {
      entry.cpuCores.add(core);
    }
  }
}

function foldVm(data: {
  buffer: XcpNgPoolResourceBuffer;
  metricName: string;
  datapoint: JSONObject;
  value: number;
  observedAt: Date;
}): void {
  const uuid: string | null = getXcpNgLabel(data.datapoint, XcpNgLabel.Uuid);
  if (!uuid) {
    return;
  }
  const entry: XcpNgResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: XcpNgResourceKind.VM,
    externalId: uuid.toLowerCase(),
    observedAt: data.observedAt,
  });
  touch(entry, data.observedAt);
  setIdentity(
    entry,
    "name",
    getXcpNgLabel(data.datapoint, XcpNgLabel.VmName),
    data.observedAt,
  );

  if (data.metricName === XcpNgSeries.VmStatus) {
    const powerState: string | null = getXcpNgLabel(
      data.datapoint,
      XcpNgLabel.PowerState,
    );
    if (powerState) {
      const isRunning: boolean = powerState === XcpNgVmPowerState.Running;
      setReading(entry, "powerState", powerState, data.observedAt);
      setReading(entry, "isUp", isRunning, data.observedAt);
      if (
        isRunning &&
        (!entry.runningAt ||
          entry.runningAt.getTime() < data.observedAt.getTime())
      ) {
        entry.runningAt = data.observedAt;
      }
    }
    // xcp_vm_status leaves control domains out: a VM it reports is not one.
    if (entry.isControlDomain === null) {
      entry.isControlDomain = false;
    }
    setReading(
      entry,
      "tags",
      getXcpNgLabel(data.datapoint, XcpNgLabel.Tags) || "",
      data.observedAt,
    );
    return;
  }

  if (data.metricName === XcpNgSeries.VmUptimeSeconds) {
    setReading(entry, "uptimeSeconds", data.value, data.observedAt);
    return;
  }

  /*
   * Every other xcp_vm_* series is an RRD reading (or Xen Orchestra's power
   * estimate), which a VM only has while it runs on a host: they name that
   * host, and whether the VM is a control domain.
   */
  const hostId: string | null = getXcpNgLabel(
    data.datapoint,
    XcpNgLabel.HostId,
  );
  setIdentity(
    entry,
    "parentHostExternalId",
    hostId ? hostId.toLowerCase() : null,
    data.observedAt,
  );
  setIdentity(
    entry,
    "parentHostName",
    getXcpNgLabel(data.datapoint, XcpNgLabel.HostName),
    data.observedAt,
  );
  const isControlDomain: string | null = getXcpNgLabel(
    data.datapoint,
    XcpNgLabel.IsControlDomain,
  );
  if (isControlDomain) {
    entry.isControlDomain = isControlDomain.toLowerCase() === "true";
  }
  if (entry.isControlDomain) {
    /*
     * A control domain has no status series: reporting metrics is how it
     * says it runs.
     */
    setReading(entry, "powerState", XcpNgVmPowerState.Running, data.observedAt);
    setReading(entry, "isUp", true, data.observedAt);
    setReading(
      entry,
      "tags",
      getXcpNgLabel(data.datapoint, XcpNgLabel.Tags) || "",
      data.observedAt,
    );
  }

  switch (data.metricName) {
    case XcpNgSeries.VmCpuUsage:
      setReading(entry, "cpuPercent", data.value * 100, data.observedAt);
      return;
    case XcpNgSeries.VmMemoryBytes:
      setReading(entry, "memoryTotalBytes", data.value, data.observedAt);
      return;
    case XcpNgSeries.VmMemoryInternalFreeBytes:
      setReading(entry, "memoryFreeBytes", data.value, data.observedAt);
      return;
    case "xcp_vm_power_consumption_watts":
      setReading(entry, "powerWatts", data.value, data.observedAt);
      return;
    case XcpNgSeries.VmCpuCoreUsage: {
      const core: string | null = getXcpNgLabel(
        data.datapoint,
        XcpNgLabel.Core,
      );
      if (core !== null) {
        entry.cpuCores.add(core);
      }
      return;
    }
    default:
      return;
  }
}

function foldStorageRepository(data: {
  buffer: XcpNgPoolResourceBuffer;
  metricName: string;
  datapoint: JSONObject;
  value: number;
  observedAt: Date;
}): void {
  const srUuid: string | null = getXcpNgLabel(
    data.datapoint,
    XcpNgLabel.SrUuid,
  );
  if (!srUuid) {
    return;
  }
  const entry: XcpNgResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: XcpNgResourceKind.StorageRepository,
    externalId: srUuid.toLowerCase(),
    observedAt: data.observedAt,
  });
  touch(entry, data.observedAt);
  setIdentity(
    entry,
    "name",
    getXcpNgLabel(data.datapoint, XcpNgLabel.SrName),
    data.observedAt,
  );
  setIdentity(
    entry,
    "srType",
    getXcpNgLabel(data.datapoint, XcpNgLabel.SrType),
    data.observedAt,
  );
  setIdentity(
    entry,
    "contentType",
    getXcpNgLabel(data.datapoint, XcpNgLabel.ContentType),
    data.observedAt,
  );

  /*
   * Xen Orchestra names a host on a storage repository's series only when
   * it is local to that host; a shared one names none.
   */
  const hostId: string | null = getXcpNgLabel(
    data.datapoint,
    XcpNgLabel.HostId,
  );
  setReading(entry, "isShared", hostId === null, data.observedAt);
  setReading(
    entry,
    "parentHostExternalId",
    hostId ? hostId.toLowerCase() : null,
    data.observedAt,
  );
  setReading(
    entry,
    "parentHostName",
    hostId ? getXcpNgLabel(data.datapoint, XcpNgLabel.HostName) : null,
    data.observedAt,
  );
  setReading(
    entry,
    "tags",
    getXcpNgLabel(data.datapoint, XcpNgLabel.Tags) || "",
    data.observedAt,
  );

  switch (data.metricName) {
    case XcpNgSeries.SrPhysicalSizeBytes:
      setReading(entry, "diskSizeBytes", data.value, data.observedAt);
      return;
    case XcpNgSeries.SrPhysicalUsageBytes:
      setReading(entry, "diskUsedBytes", data.value, data.observedAt);
      return;
    case XcpNgSeries.SrVirtualSizeBytes:
      setReading(entry, "virtualAllocationBytes", data.value, data.observedAt);
      return;
    default:
      return;
  }
}

function foldVdi(data: {
  buffer: XcpNgPoolResourceBuffer;
  metricName: string;
  datapoint: JSONObject;
  value: number;
  observedAt: Date;
}): void {
  const vdiUuid: string | null = getXcpNgLabel(
    data.datapoint,
    XcpNgLabel.VdiUuid,
  );
  if (!vdiUuid) {
    return;
  }
  const entry: XcpNgResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: XcpNgResourceKind.VDI,
    externalId: vdiUuid.toLowerCase(),
    observedAt: data.observedAt,
  });
  touch(entry, data.observedAt);
  setIdentity(
    entry,
    "name",
    getXcpNgLabel(data.datapoint, XcpNgLabel.VdiName),
    data.observedAt,
  );
  const srUuid: string | null = getXcpNgLabel(
    data.datapoint,
    XcpNgLabel.SrUuid,
  );
  setIdentity(
    entry,
    "storageRepositoryExternalId",
    srUuid ? srUuid.toLowerCase() : null,
    data.observedAt,
  );
  setIdentity(
    entry,
    "storageRepositoryName",
    getXcpNgLabel(data.datapoint, XcpNgLabel.SrName),
    data.observedAt,
  );
  setIdentity(
    entry,
    "srType",
    getXcpNgLabel(data.datapoint, XcpNgLabel.SrType),
    data.observedAt,
  );

  // A disk detached from its VM stops naming it: that is a reading too.
  const vmUuid: string | null = getXcpNgLabel(
    data.datapoint,
    XcpNgLabel.VmUuid,
  );
  setReading(
    entry,
    "vmExternalId",
    vmUuid ? vmUuid.toLowerCase() : null,
    data.observedAt,
  );
  setReading(
    entry,
    "vmName",
    vmUuid ? getXcpNgLabel(data.datapoint, XcpNgLabel.VmName) : null,
    data.observedAt,
  );

  switch (data.metricName) {
    case XcpNgSeries.VdiVirtualSizeBytes:
      setReading(entry, "diskSizeBytes", data.value, data.observedAt);
      return;
    case XcpNgSeries.VdiPhysicalUsageBytes:
      setReading(entry, "diskUsedBytes", data.value, data.observedAt);
      return;
    default:
      return;
  }
}

/*
 * What one batch said about one pool beyond its objects: whether it read the
 * pool at all (any datapoint that is not a staleness marker), and whether
 * Xen Orchestra reported the pool connected.
 */
export interface XcpNgPoolSnapshotBufferEntry {
  wasRead: boolean;
  sawPoolConnected: boolean;
  readAt: Date | null;
}

export function getOrCreateXcpNgPoolSnapshot(
  buffer: Map<string, XcpNgPoolSnapshotBufferEntry>,
  poolIdStr: string,
): XcpNgPoolSnapshotBufferEntry {
  let entry: XcpNgPoolSnapshotBufferEntry | undefined = buffer.get(poolIdStr);
  if (!entry) {
    entry = { wasRead: false, sawPoolConnected: false, readAt: null };
    buffer.set(poolIdStr, entry);
  }
  return entry;
}

/*
 * Fold one datapoint of a pool's resource block. `metricName` is the
 * series' name; the datapoint is the raw OTLP JSON one (its attributes are
 * Xen Orchestra's labels).
 */
export function bufferXcpNgSnapshotMetric(data: {
  poolIdStr: string;
  metricName: string;
  datapoint: JSONObject;
  resourceBuffer: Map<string, XcpNgPoolResourceBuffer>;
  poolBuffer: Map<string, XcpNgPoolSnapshotBufferEntry>;
}): void {
  if (!isXcpNgSnapshotMetric(data.metricName)) {
    return;
  }
  if (isXcpNgStaleDatapoint(data.datapoint)) {
    return;
  }
  const value: number | null = getXcpNgDatapointValue(data.datapoint);
  if (value === null) {
    return;
  }
  const observedAt: Date = getXcpNgDatapointTime(data.datapoint);

  const pool: XcpNgPoolSnapshotBufferEntry = getOrCreateXcpNgPoolSnapshot(
    data.poolBuffer,
    data.poolIdStr,
  );
  pool.wasRead = true;
  if (!pool.readAt || pool.readAt.getTime() < observedAt.getTime()) {
    pool.readAt = observedAt;
  }

  if (data.metricName === XcpNgSeries.PoolConnected) {
    if (value >= 1) {
      pool.sawPoolConnected = true;
    }
    return;
  }

  let buffer: XcpNgPoolResourceBuffer | undefined = data.resourceBuffer.get(
    data.poolIdStr,
  );
  if (!buffer) {
    buffer = new Map<string, XcpNgResourceBufferEntry>();
    data.resourceBuffer.set(data.poolIdStr, buffer);
  }

  const fold: {
    buffer: XcpNgPoolResourceBuffer;
    metricName: string;
    datapoint: JSONObject;
    value: number;
    observedAt: Date;
  } = {
    buffer,
    metricName: data.metricName,
    datapoint: data.datapoint,
    value,
    observedAt,
  };

  if (data.metricName.startsWith("xcp_host_")) {
    foldHost(fold);
  } else if (data.metricName.startsWith("xcp_vm_")) {
    foldVm(fold);
  } else if (data.metricName.startsWith("xcp_sr_")) {
    foldStorageRepository(fold);
  } else if (data.metricName.startsWith("xcp_vdi_")) {
    foldVdi(fold);
  }
}

// One inventory row, as XcpNgResourceService writes it.
export interface ParsedXcpNgResource {
  kind: XcpNgResourceKind;
  externalId: string;
  name: string | null;
  powerState: string | null;
  isUp: boolean | null;
  isEnabled: boolean | null;
  isControlDomain: boolean | null;
  parentHostExternalId: string | null;
  parentHostName: string | null;
  storageRepositoryExternalId: string | null;
  storageRepositoryName: string | null;
  vmExternalId: string | null;
  vmName: string | null;
  uptimeSeconds: number | null;
  lastRunningAt: Date | null;
  latestCpuPercent: number | null;
  cpuCount: number | null;
  runningVcpuCount: number | null;
  loadAverage: number | null;
  latestMemoryBytes: number | null;
  maxMemoryBytes: number | null;
  latestMemoryPercent: number | null;
  latestDiskBytes: number | null;
  maxDiskBytes: number | null;
  latestDiskPercent: number | null;
  virtualAllocationBytes: number | null;
  srType: string | null;
  contentType: string | null;
  isShared: boolean | null;
  powerWatts: number | null;
  tags: string | null;
  lastSeenAt: Date;
}

function round(value: number, digits: number): number {
  const factor: number = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function percentOrNull(
  used: number | null,
  size: number | null,
): number | null {
  if (used === null || size === null || size <= 0) {
    return null;
  }
  return round(Math.min(100, Math.max(0, (used / size) * 100)), 2);
}

/*
 * The rows a pool's buffer folds to. Memory in use is total less free for a
 * host; for a VM only when its guest reports free memory (the guest tools),
 * else unknown rather than "all of it".
 */
export function getXcpNgResourceRows(
  buffer: XcpNgPoolResourceBuffer | undefined,
): Array<ParsedXcpNgResource> {
  if (!buffer) {
    return [];
  }

  const rows: Array<ParsedXcpNgResource> = [];
  for (const entry of buffer.values()) {
    let memoryUsed: number | null = null;
    if (entry.memoryTotalBytes !== null && entry.memoryFreeBytes !== null) {
      memoryUsed = Math.max(0, entry.memoryTotalBytes - entry.memoryFreeBytes);
    }

    rows.push({
      kind: entry.kind,
      externalId: entry.externalId,
      name: entry.name,
      powerState: entry.powerState,
      isUp: entry.isUp,
      isEnabled: entry.isEnabled,
      isControlDomain: entry.isControlDomain,
      parentHostExternalId: entry.parentHostExternalId,
      parentHostName: entry.parentHostName,
      storageRepositoryExternalId: entry.storageRepositoryExternalId,
      storageRepositoryName: entry.storageRepositoryName,
      vmExternalId: entry.vmExternalId,
      vmName: entry.vmName,
      uptimeSeconds:
        entry.uptimeSeconds !== null ? Math.trunc(entry.uptimeSeconds) : null,
      lastRunningAt: entry.runningAt,
      latestCpuPercent:
        entry.cpuPercent !== null ? round(entry.cpuPercent, 2) : null,
      cpuCount: entry.cpuCores.size > 0 ? entry.cpuCores.size : null,
      runningVcpuCount:
        entry.runningVcpuCount !== null
          ? Math.trunc(entry.runningVcpuCount)
          : null,
      loadAverage:
        entry.loadAverage !== null ? round(entry.loadAverage, 3) : null,
      latestMemoryBytes: memoryUsed,
      maxMemoryBytes: entry.memoryTotalBytes,
      latestMemoryPercent: percentOrNull(memoryUsed, entry.memoryTotalBytes),
      latestDiskBytes: entry.diskUsedBytes,
      maxDiskBytes: entry.diskSizeBytes,
      latestDiskPercent:
        entry.kind === XcpNgResourceKind.StorageRepository
          ? percentOrNull(entry.diskUsedBytes, entry.diskSizeBytes)
          : null,
      virtualAllocationBytes: entry.virtualAllocationBytes,
      srType: entry.srType,
      contentType: entry.contentType,
      isShared: entry.isShared,
      powerWatts: entry.powerWatts !== null ? round(entry.powerWatts, 2) : null,
      tags: entry.tags,
      lastSeenAt: entry.observedAt,
    });
  }
  return rows;
}
