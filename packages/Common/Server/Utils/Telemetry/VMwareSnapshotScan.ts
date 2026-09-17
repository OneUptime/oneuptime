import ColumnLength from "../../../Types/Database/ColumnLength";
import OneUptimeDate from "../../../Types/Date";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import { VMwareResourceKind } from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import logger from "../Logger";
import crypto from "crypto";

/*
 * ------------------------------------------------------------------
 * VMware snapshot scan — pure fold & derive helpers
 * ------------------------------------------------------------------
 *
 * Modelled on ProxmoxCephSnapshotScan.ts (the Proxmox half). The
 * ingest service owns the I/O: it walks the OTLP payload, calls
 * bufferVMwareSnapshotMetric per datapoint, and at flush time maps the
 * folded buffers through computeVMwareIsPoweredOn /
 * deriveVMwareResourceLatestMetric / deriveVMwareVCenterSnapshotExtras
 * before handing the results to VMwareResourceService /
 * VMwareVCenterService. Everything in this module is pure (Map/object
 * mutation only — no DB, no network), which is what makes the
 * snapshot-scan semantics unit-testable:
 *
 *   - identity attributes fold first-non-null-wins; status/metric
 *     fields fold newest-observedAt-wins,
 *   - count metrics that fan out over datapoint attributes (status,
 *     power_state, effective) are SUMMED across the datapoints of the
 *     newest timestamp — never "newest datapoint wins",
 *   - vCenter count columns are only derived when the batch carried at
 *     least one resource of that kind (never zero a count on a partial
 *     batch — the COALESCE-per-column contract),
 *   - non-allow-listed metric names are skipped via the exported
 *     VMWARE_SNAPSHOT_METRIC_NAMES set,
 *   - every externalId is length-bound to VMwareResource.externalId's
 *     ShortText (100) column by boundVMwareExternalId: an id longer
 *     than 100 chars becomes an 83-char prefix + "~" + the first 16 hex
 *     chars of the sha1 of the FULL id, so two distinct long inventory
 *     paths (sibling sub-pools under a deep cluster path, the
 *     vm/<dc>/<host>/<name> fallback) can never clamp to the same
 *     unique-index key downstream. The full path stays in the LongText
 *     resourcePoolPath column for display.
 *
 * KEY DIFFERENCE from Proxmox: the OpenTelemetry Collector `vcenter`
 * receiver emits one OTLP resource per vSphere object and carries the
 * object's identity in that resource's attributes
 * (vcenter.datacenter.name, vcenter.cluster.name, vcenter.host.name,
 * vcenter.vm.name / vcenter.vm.id, vcenter.vm_template.*,
 * vcenter.datastore.name, vcenter.resource_pool.*, vcenter.virtual_app.*)
 * — not in datapoint labels the way pve-exporter does. The buffer
 * function therefore takes the resource attribute map alongside the
 * datapoint; the datapoint attributes only carry the fan-out
 * dimensions (disk_state, power_state, status, effective, type).
 */

/*
 * Every metric the §3 metric → column table references. The ingest
 * service gates on this Set before calling bufferVMwareSnapshotMetric so
 * the ~40 perf series (latency, throughput, packet rates, vSAN, …) that
 * only live in ClickHouse never pay for a fold.
 *
 * vcenter.vm.cpu.* are also the powered-on signal: the receiver emits
 * them ONLY for powered-on virtual machines (see computeVMwareIsPoweredOn).
 */
export const VMWARE_SNAPSHOT_METRIC_NAMES: ReadonlySet<string> = new Set([
  // ESXi host
  "vcenter.host.cpu.utilization",
  "vcenter.host.cpu.usage",
  "vcenter.host.cpu.capacity",
  "vcenter.host.memory.usage",
  "vcenter.host.memory.capacity",
  "vcenter.host.memory.utilization",
  // Virtual machine (and VM template: vcenter.vm.disk.usage only)
  "vcenter.vm.cpu.utilization",
  "vcenter.vm.cpu.usage",
  "vcenter.vm.cpu.readiness",
  "vcenter.vm.memory.usage",
  "vcenter.vm.memory.utilization",
  "vcenter.vm.memory.ballooned",
  "vcenter.vm.memory.swapped",
  "vcenter.vm.disk.usage",
  "vcenter.vm.disk.utilization",
  // Datastore
  "vcenter.datastore.disk.usage",
  "vcenter.datastore.disk.utilization",
  // Cluster
  "vcenter.cluster.cpu.limit",
  "vcenter.cluster.cpu.effective",
  "vcenter.cluster.memory.limit",
  "vcenter.cluster.memory.effective",
  "vcenter.cluster.host.count",
  "vcenter.cluster.vm.count",
  "vcenter.cluster.vm_template.count",
  // Datacenter
  "vcenter.datacenter.cpu.limit",
  "vcenter.datacenter.memory.limit",
  "vcenter.datacenter.disk.space",
  "vcenter.datacenter.host.count",
  "vcenter.datacenter.vm.count",
  "vcenter.datacenter.cluster.count",
  "vcenter.datacenter.datastore.count",
  // Resource pool
  "vcenter.resource_pool.cpu.usage",
  "vcenter.resource_pool.memory.usage",
  "vcenter.resource_pool.memory.ballooned",
  "vcenter.resource_pool.memory.swapped",
]);

// The receiver reports host / VM / resource-pool memory in MiBy.
const MEBIBYTE: number = 1024 * 1024;

/*
 * A count that fans out over datapoint attribute values (one datapoint
 * per status × power_state, per effective flag, …). Folded per
 * (resource, column): a newer timestamp resets the sum, an equal
 * timestamp adds, an older one is ignored — so the column always holds
 * the complete sum of the newest collection in the batch.
 */
export interface VMwareSummedCount {
  value: number;
  observedAt: Date;
}

/*
 * The identity of one vSphere object, resolved from the OTLP resource
 * attributes the vcenter receiver stamps. `kind` / `externalId` are the
 * buffer key and the unique-index members of VMwareResource.
 */
export interface VMwareResourceIdentity {
  kind: string; // VMwareResourceKind
  externalId: string;
  name: string | null;
  datacenterName: string | null;
  clusterName: string | null;
  hostName: string | null;
  resourcePoolName: string | null;
  resourcePoolPath: string | null;
  virtualAppName: string | null;
  vmInstanceUuid: string | null;
  isTemplate: boolean | null; // VirtualMachine rows only
}

/*
 * One VMware resource (Datacenter / Cluster / Host / VirtualMachine /
 * Datastore / ResourcePool) folded across a batch. Identity attributes
 * are first-non-null-wins (stable for the lifetime of the object);
 * status / metric fields are newest-observedAt-wins; count fields are
 * summed per VMwareSummedCount.
 */
export interface VMwareResourceBufferEntry extends VMwareResourceIdentity {
  /*
   * Powered-on inference inputs (VirtualMachine rows only). The receiver
   * emits vcenter.vm.cpu.* solely for powered-on VMs, and the agent
   * config forbids splitting one collection across exports, so within
   * one batch "carried a CPU point" ⇔ "powered on". See
   * computeVMwareIsPoweredOn.
   */
  sawCpuMetric: boolean;
  sawNonCpuMetric: boolean;
  // Latest-metric mirror (VMwareResource columns).
  latestCpuPercent: number | null;
  latestCpuMhz: number | null;
  cpuCapacityMhz: number | null;
  cpuEffectiveMhz: number | null;
  latestMemoryBytes: number | null;
  /*
   * host.memory.capacity / cluster|datacenter.memory.limit as reported.
   * Host and VM rows may derive a fallback from usage ÷ utilization at
   * flush time — see deriveVMwareResourceLatestMetric.
   */
  maxMemoryBytes: number | null;
  memoryEffectiveBytes: number | null;
  latestMemoryPercent: number | null;
  /*
   * vm|datastore.disk.usage / datacenter.disk.space fan out over
   * disk_state (used | available); kept separately so the pair can
   * arrive in either order. latestDiskBytes = used, maxDiskBytes =
   * used + available (derived at flush).
   */
  diskUsedBytes: number | null;
  diskAvailableBytes: number | null;
  latestDiskPercent: number | null;
  cpuReadinessPercent: number | null;
  memoryBalloonedBytes: number | null;
  memorySwappedBytes: number | null;
  // Summed counts (Cluster / Datacenter rows).
  hostCount: VMwareSummedCount | null;
  effectiveHostCount: VMwareSummedCount | null;
  poweredOnHostCount: VMwareSummedCount | null;
  vmCount: VMwareSummedCount | null;
  poweredOnVmCount: VMwareSummedCount | null;
  vmTemplateCount: VMwareSummedCount | null;
  datastoreCount: VMwareSummedCount | null;
  clusterCount: VMwareSummedCount | null;
  observedAt: Date;
}

/*
 * Per-vCenter snapshot state. The saw* flags implement the
 * never-zero-a-count-on-a-partial-batch contract: a vCenter count
 * column is only written when the batch carried at least one resource
 * of that kind.
 */
export interface VMwareVCenterSnapshotBufferEntry {
  sawDatacenter: boolean;
  sawCluster: boolean;
  sawHost: boolean;
  sawVirtualMachine: boolean; // VM or template rows
  sawDatastore: boolean;
  sawResourcePool: boolean;
}

// The VMwareVCenter snapshot columns derived from one folded batch.
export interface VMwareVCenterSnapshotExtras {
  datacenterCount?: number | undefined;
  clusterCount?: number | undefined;
  hostCount?: number | undefined;
  vmCount?: number | undefined;
  poweredOnVmCount?: number | undefined;
  datastoreCount?: number | undefined;
  resourcePoolCount?: number | undefined;
  datastoreCapacityBytes?: number | undefined;
  datastoreUsedBytes?: number | undefined;
}

/*
 * The latest-metric mirror derived from one folded entry — structurally
 * identical to VMwareResourceService's VMwareResourceLatestMetric, kept
 * local so this module stays free of service imports.
 */
export interface VMwareResourceLatestMetricSnapshot {
  kind: string;
  externalId: string;
  cpuPercent: number | null;
  cpuMhz: number | null;
  cpuCapacityMhz: number | null;
  cpuEffectiveMhz: number | null;
  memoryBytes: number | null;
  maxMemoryBytes: number | null;
  memoryEffectiveBytes: number | null;
  memoryPercent: number | null;
  diskBytes: number | null;
  maxDiskBytes: number | null;
  diskPercent: number | null;
  cpuReadinessPercent: number | null;
  memoryBalloonedBytes: number | null;
  memorySwappedBytes: number | null;
  hostCount: number | null;
  effectiveHostCount: number | null;
  poweredOnHostCount: number | null;
  vmCount: number | null;
  poweredOnVmCount: number | null;
  vmTemplateCount: number | null;
  datastoreCount: number | null;
  clusterCount: number | null;
  observedAt: Date;
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
  if (value !== undefined && value !== null) {
    try {
      if (typeof value === "string") {
        const trimmed: string = value.trim();
        if (trimmed === "" || isNaN(Number(trimmed))) {
          throw new Error(`Invalid timestamp string: ${value}`);
        }
        /*
         * Hand the raw nanosecond string to fromUnixNano so it can divide
         * with BigInt — nanosecond epochs exceed Number.MAX_SAFE_INTEGER, so
         * parsing to a float here would drop up to a full millisecond.
         */
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

/*
 * Read one OTLP AnyValue as a trimmed string. Unlike the Proxmox reader
 * this also accepts boolValue / intValue / doubleValue: the vcenter
 * receiver's `effective` dimension is a real boolean on the wire and
 * OneUptime stores it as the string "true" / "false" (which is also how
 * monitor criteria filter it).
 */
function anyValueToString(value: JSONValue | undefined): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const anyValue: JSONObject = value as JSONObject;
  if (typeof anyValue["stringValue"] === "string") {
    const trimmed: string = (anyValue["stringValue"] as string).trim();
    return trimmed ? trimmed : null;
  }
  if (typeof anyValue["boolValue"] === "boolean") {
    return anyValue["boolValue"] ? "true" : "false";
  }
  if (
    typeof anyValue["intValue"] === "number" ||
    typeof anyValue["intValue"] === "string"
  ) {
    const trimmed: string = String(anyValue["intValue"]).trim();
    return trimmed ? trimmed : null;
  }
  if (typeof anyValue["doubleValue"] === "number") {
    return String(anyValue["doubleValue"]);
  }
  return null;
}

// Same trim-or-null read contract as OtelIngestBaseService.getStringAttribute.
function getDatapointAttribute(
  attributes: JSONArray,
  key: string,
): string | null {
  for (const attribute of attributes) {
    if (attribute["key"] === key) {
      const parsed: string | null = anyValueToString(attribute["value"]);
      if (parsed !== null) {
        return parsed;
      }
    }
  }
  return null;
}

/*
 * Build the UNprefixed resource attribute map the buffer function reads
 * from the raw OTLP resource attribute array. Only scalar values are
 * kept (identity attributes are all strings); nested / array values are
 * not vSphere identity and are dropped.
 */
export function toVMwareResourceAttributeMap(
  attributes: JSONArray | undefined | null,
): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  if (!attributes) {
    return map;
  }
  for (const attribute of attributes) {
    const key: JSONValue | undefined = attribute["key"];
    if (typeof key !== "string" || !key) {
      continue;
    }
    const parsed: string | null = anyValueToString(attribute["value"]);
    if (parsed !== null) {
      map[key] = parsed;
    }
  }
  return map;
}

/*
 * Read a resource attribute by its semconv-native key. Accepts both the
 * bare key (the map toVMwareResourceAttributeMap builds) and the
 * `resource.`-prefixed spelling (the merged metricAttributes map the
 * K8s / cloud scans read), so either input shape resolves identically.
 */
function readResourceAttribute(
  attributes: Record<string, unknown>,
  key: string,
): string | null {
  const candidates: Array<unknown> = [
    attributes[key],
    attributes[`resource.${key}`],
  ];
  for (const raw of candidates) {
    if (typeof raw === "string") {
      const trimmed: string = raw.trim();
      if (trimmed) {
        return trimmed;
      }
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      return String(raw);
    } else if (typeof raw === "boolean") {
      return raw ? "true" : "false";
    }
  }
  return null;
}

/*
 * Hex chars of sha1 kept in a bound externalId. 16 hex = 64 bits: the
 * chance of two distinct paths in one vCenter sharing a prefix AND a
 * suffix is negligible, and the id stays readable at a glance.
 */
const BOUND_EXTERNAL_ID_HASH_CHARS: number = 16;
const BOUND_EXTERNAL_ID_SEPARATOR: string = "~";

/*
 * Bound an externalId to VMwareResource.externalId's ShortText (100)
 * column WITHOUT letting two distinct ids collapse onto the same key.
 *
 * VMwareResourceService clamps identity to 100 chars with
 * truncateShortText, and the ingest buffer keys on the raw id, so a
 * plain clamp would let two vSphere objects whose ids only differ past
 * character 100 (sibling sub-pools under a long
 * `/<dc>/host/<cluster>/Resources/<pool>/<subpool>` path — vSphere
 * allows 80-char datacenter / cluster / pool names — or the
 * vm/<dc>/<host>/<name> fallback) share one row: bulkUpsert would merge
 * them (or, when both land in the same INSERT chunk, fail the whole
 * chunk with Postgres 21000 "ON CONFLICT DO UPDATE command cannot
 * affect row a second time"), and the vCenter resourcePoolCount would
 * disagree with the inventory list.
 *
 * Ids of <= 100 chars are returned unchanged (every Proxmox-style short
 * id, every vm/<instance uuid>). Longer ids become a deterministic
 * `<first 83 chars>~<first 16 hex of sha1(full id)>` — exactly 100
 * chars, stable across calls and processes, collision-resistant because
 * the suffix hashes the FULL id. The full inventory path is still
 * stored in the LongText resourcePoolPath column for display.
 */
export function boundVMwareExternalId(id: string): string {
  const maxLength: number = ColumnLength.ShortText;
  if (id.length <= maxLength) {
    return id;
  }

  const digest: string = crypto
    .createHash("sha1")
    .update(id)
    .digest("hex")
    .substring(0, BOUND_EXTERNAL_ID_HASH_CHARS);
  const prefixLength: number =
    maxLength - BOUND_EXTERNAL_ID_SEPARATOR.length - digest.length;

  return `${id.substring(0, prefixLength)}${BOUND_EXTERNAL_ID_SEPARATOR}${digest}`;
}

/*
 * externalId scheme (immutable, collision-free within a vCenter; the
 * detail route URL-encodes it as a path param):
 *   datacenter/<dc>            cluster/<dc>/<cluster>
 *   host/<dc>/<host>           vm/<vcenter.vm.id | vcenter.vm_template.id>
 *   datastore/<dc>/<datastore> resourcepool/<inventory path>
 * A missing component (a receiver build that omits an attribute) is
 * dropped rather than rendered as an empty segment, so the id stays
 * deterministic and readable ("host/esx1" instead of "host//esx1").
 * The joined id is then passed through boundVMwareExternalId, so every
 * kind — not just resource pools — fits the 100-char column without
 * two long ids ever clamping to the same key.
 */
function joinExternalId(
  prefix: string,
  ...parts: Array<string | null>
): string {
  const present: Array<string> = parts.filter((part: string | null) => {
    return part !== null && part !== "";
  }) as Array<string>;
  return boundVMwareExternalId([prefix, ...present].join("/"));
}

/*
 * Resolve which vSphere object an OTLP resource describes, most specific
 * first (a VM resource also carries vcenter.host.name, a host resource
 * also carries vcenter.cluster.name, and everything carries
 * vcenter.datacenter.name):
 *   1. vcenter.vm.id / vcenter.vm.name          → VirtualMachine (isTemplate=false)
 *   2. vcenter.vm_template.id / .name           → VirtualMachine (isTemplate=true)
 *   3. vcenter.resource_pool.inventory_path     → ResourcePool
 *   4. vcenter.host.name                        → Host
 *   5. vcenter.datastore.name                   → Datastore
 *   6. vcenter.cluster.name                     → Cluster
 *   7. only vcenter.datacenter.name             → Datacenter
 * Anything with none of these is not an inventory row (null).
 */
export function resolveVMwareResourceIdentity(
  resourceAttributes: Record<string, unknown>,
): VMwareResourceIdentity | null {
  const read: (key: string) => string | null = (key: string) => {
    return readResourceAttribute(resourceAttributes, key);
  };

  const datacenterName: string | null = read("vcenter.datacenter.name");
  const clusterName: string | null = read("vcenter.cluster.name");
  const hostName: string | null = read("vcenter.host.name");
  const resourcePoolName: string | null = read("vcenter.resource_pool.name");
  const resourcePoolPath: string | null = read(
    "vcenter.resource_pool.inventory_path",
  );
  const virtualAppName: string | null = read("vcenter.virtual_app.name");
  const virtualAppPath: string | null = read(
    "vcenter.virtual_app.inventory_path",
  );

  const base: Omit<VMwareResourceIdentity, "kind" | "externalId" | "name"> = {
    datacenterName,
    clusterName,
    hostName,
    resourcePoolName,
    /*
     * The inventory path column doubles for vApps: a VM inside a vApp
     * carries vcenter.virtual_app.* instead of vcenter.resource_pool.*.
     */
    resourcePoolPath: resourcePoolPath ?? virtualAppPath,
    virtualAppName,
    vmInstanceUuid: null,
    isTemplate: null,
  };

  // 1. Virtual machine.
  const vmId: string | null = read("vcenter.vm.id");
  const vmName: string | null = read("vcenter.vm.name");
  if (vmId || vmName) {
    return {
      ...base,
      kind: VMwareResourceKind.VirtualMachine,
      externalId: vmId
        ? joinExternalId("vm", vmId)
        : joinExternalId("vm", datacenterName, hostName, vmName),
      name: vmName,
      vmInstanceUuid: vmId,
      isTemplate: false,
    };
  }

  // 2. VM template.
  const templateId: string | null = read("vcenter.vm_template.id");
  const templateName: string | null = read("vcenter.vm_template.name");
  if (templateId || templateName) {
    return {
      ...base,
      kind: VMwareResourceKind.VirtualMachine,
      externalId: templateId
        ? joinExternalId("vm", templateId)
        : joinExternalId("vm", datacenterName, hostName, templateName),
      name: templateName,
      vmInstanceUuid: templateId,
      isTemplate: true,
    };
  }

  // 3. Resource pool (under a cluster, or on a standalone ESXi host).
  if (resourcePoolPath) {
    return {
      ...base,
      kind: VMwareResourceKind.ResourcePool,
      externalId: joinExternalId("resourcepool", resourcePoolPath),
      name: resourcePoolName,
    };
  }

  // 4. ESXi host.
  if (hostName) {
    return {
      ...base,
      kind: VMwareResourceKind.Host,
      externalId: joinExternalId("host", datacenterName, hostName),
      name: hostName,
    };
  }

  // 5. Datastore.
  const datastoreName: string | null = read("vcenter.datastore.name");
  if (datastoreName) {
    return {
      ...base,
      kind: VMwareResourceKind.Datastore,
      externalId: joinExternalId("datastore", datacenterName, datastoreName),
      name: datastoreName,
    };
  }

  // 6. Cluster.
  if (clusterName) {
    return {
      ...base,
      kind: VMwareResourceKind.Cluster,
      externalId: joinExternalId("cluster", datacenterName, clusterName),
      name: clusterName,
    };
  }

  // 7. Datacenter.
  if (datacenterName) {
    return {
      ...base,
      kind: VMwareResourceKind.Datacenter,
      externalId: joinExternalId("datacenter", datacenterName),
      name: datacenterName,
    };
  }

  return null;
}

export function getOrCreateVMwareVCenterSnapshot(
  buffer: Map<string, VMwareVCenterSnapshotBufferEntry>,
  vcenterIdStr: string,
): VMwareVCenterSnapshotBufferEntry {
  let entry: VMwareVCenterSnapshotBufferEntry | undefined =
    buffer.get(vcenterIdStr);
  if (!entry) {
    entry = {
      sawDatacenter: false,
      sawCluster: false,
      sawHost: false,
      sawVirtualMachine: false,
      sawDatastore: false,
      sawResourcePool: false,
    };
    buffer.set(vcenterIdStr, entry);
  }
  return entry;
}

function emptyPatch(
  identity: VMwareResourceIdentity,
  observedAt: Date,
): VMwareResourceBufferEntry {
  return {
    ...identity,
    sawCpuMetric: false,
    sawNonCpuMetric: false,
    latestCpuPercent: null,
    latestCpuMhz: null,
    cpuCapacityMhz: null,
    cpuEffectiveMhz: null,
    latestMemoryBytes: null,
    maxMemoryBytes: null,
    memoryEffectiveBytes: null,
    latestMemoryPercent: null,
    diskUsedBytes: null,
    diskAvailableBytes: null,
    latestDiskPercent: null,
    cpuReadinessPercent: null,
    memoryBalloonedBytes: null,
    memorySwappedBytes: null,
    hostCount: null,
    effectiveHostCount: null,
    poweredOnHostCount: null,
    vmCount: null,
    poweredOnVmCount: null,
    vmTemplateCount: null,
    datastoreCount: null,
    clusterCount: null,
    observedAt,
  };
}

function wholeBytes(value: number): number {
  return Math.max(0, Math.trunc(value));
}

function mebibytesToBytes(value: number): number {
  return wholeBytes(value * MEBIBYTE);
}

function wholeCount(value: number): number {
  return Math.max(0, Math.trunc(value));
}

/*
 * The vSphere object kind a metric name belongs to, by its second
 * segment. A metric folded onto a resource of another kind (impossible
 * from the stock receiver, but cheap to guard) is dropped rather than
 * mis-mapped: a VM resource carries vcenter.host.name too, so the guard
 * is what keeps a hand-rolled vcenter.host.* series from polluting a
 * VM row.
 */
function metricKindOf(metricName: string): string | null {
  if (metricName.startsWith("vcenter.host.")) {
    return VMwareResourceKind.Host;
  }
  if (metricName.startsWith("vcenter.vm.")) {
    return VMwareResourceKind.VirtualMachine;
  }
  if (metricName.startsWith("vcenter.datastore.")) {
    return VMwareResourceKind.Datastore;
  }
  if (metricName.startsWith("vcenter.cluster.")) {
    return VMwareResourceKind.Cluster;
  }
  if (metricName.startsWith("vcenter.datacenter.")) {
    return VMwareResourceKind.Datacenter;
  }
  if (metricName.startsWith("vcenter.resource_pool.")) {
    return VMwareResourceKind.ResourcePool;
  }
  return null;
}

function markKindSeen(
  snap: VMwareVCenterSnapshotBufferEntry,
  kind: string,
): void {
  switch (kind) {
    case VMwareResourceKind.Datacenter:
      snap.sawDatacenter = true;
      break;
    case VMwareResourceKind.Cluster:
      snap.sawCluster = true;
      break;
    case VMwareResourceKind.Host:
      snap.sawHost = true;
      break;
    case VMwareResourceKind.VirtualMachine:
      snap.sawVirtualMachine = true;
      break;
    case VMwareResourceKind.Datastore:
      snap.sawDatastore = true;
      break;
    case VMwareResourceKind.ResourcePool:
      snap.sawResourcePool = true;
      break;
    default:
      break;
  }
}

/*
 * Fold one vcenter.* datapoint into the per-vCenter buffers. Identity
 * comes from the RESOURCE attributes (pass the raw, unprefixed map from
 * toVMwareResourceAttributeMap — the `resource.`-prefixed spelling is
 * accepted too); the datapoint attributes only carry fan-out dimensions.
 */
export function bufferVMwareSnapshotMetric(data: {
  vcenterIdStr: string;
  metricName: string;
  resourceAttributes: Record<string, unknown>;
  datapoint: JSONObject;
  resourceBuffer: Map<string, Map<string, VMwareResourceBufferEntry>>;
  vcenterBuffer: Map<string, VMwareVCenterSnapshotBufferEntry>;
}): void {
  const valueFromInt: number | null = toNumberOrNull(data.datapoint["asInt"]);
  const valueFromDouble: number | null = toNumberOrNull(
    data.datapoint["asDouble"],
  );
  const rawValue: number | null = valueFromDouble ?? valueFromInt;
  if (rawValue === null) {
    return;
  }

  const identity: VMwareResourceIdentity | null = resolveVMwareResourceIdentity(
    data.resourceAttributes,
  );
  if (!identity) {
    return;
  }

  const metricKind: string | null = metricKindOf(data.metricName);
  if (metricKind === null || metricKind !== identity.kind) {
    return;
  }

  const observedAt: Date = parseUnixNanoToDate(
    data.datapoint["timeUnixNano"] as string | number | undefined,
    "vcenter snapshot timeUnixNano",
  );

  const dpAttributes: JSONArray =
    (data.datapoint["attributes"] as JSONArray) || [];

  const patch: VMwareResourceBufferEntry = emptyPatch(identity, observedAt);
  const summed: (matches: boolean) => VMwareSummedCount = (
    matches: boolean,
  ) => {
    return { value: matches ? wholeCount(rawValue) : 0, observedAt };
  };

  switch (data.metricName) {
    // ---- ESXi host -------------------------------------------------
    case "vcenter.host.cpu.utilization": {
      patch.latestCpuPercent = rawValue;
      break;
    }
    case "vcenter.host.cpu.usage": {
      patch.latestCpuMhz = wholeCount(rawValue);
      break;
    }
    case "vcenter.host.cpu.capacity": {
      patch.cpuCapacityMhz = wholeCount(rawValue);
      break;
    }
    case "vcenter.host.memory.usage": {
      patch.latestMemoryBytes = mebibytesToBytes(rawValue);
      break;
    }
    case "vcenter.host.memory.capacity": {
      patch.maxMemoryBytes = mebibytesToBytes(rawValue);
      break;
    }
    case "vcenter.host.memory.utilization": {
      patch.latestMemoryPercent = rawValue;
      break;
    }

    // ---- Virtual machine ------------------------------------------
    case "vcenter.vm.cpu.utilization": {
      patch.latestCpuPercent = rawValue;
      patch.sawCpuMetric = true;
      break;
    }
    case "vcenter.vm.cpu.usage": {
      patch.latestCpuMhz = wholeCount(rawValue);
      patch.sawCpuMetric = true;
      break;
    }
    case "vcenter.vm.cpu.readiness": {
      patch.cpuReadinessPercent = rawValue;
      patch.sawCpuMetric = true;
      break;
    }
    case "vcenter.vm.memory.usage": {
      patch.latestMemoryBytes = mebibytesToBytes(rawValue);
      patch.sawNonCpuMetric = true;
      break;
    }
    case "vcenter.vm.memory.utilization": {
      patch.latestMemoryPercent = rawValue;
      patch.sawNonCpuMetric = true;
      break;
    }
    case "vcenter.vm.memory.ballooned": {
      patch.memoryBalloonedBytes = mebibytesToBytes(rawValue);
      patch.sawNonCpuMetric = true;
      break;
    }
    case "vcenter.vm.memory.swapped": {
      patch.memorySwappedBytes = mebibytesToBytes(rawValue);
      patch.sawNonCpuMetric = true;
      break;
    }
    case "vcenter.vm.disk.usage":
    case "vcenter.datastore.disk.usage":
    case "vcenter.datacenter.disk.space": {
      /*
       * Fan-out over disk_state: one datapoint for `used`, one for
       * `available`. Any other (or missing) state carries no signal.
       */
      const diskState: string | null = getDatapointAttribute(
        dpAttributes,
        "disk_state",
      );
      if (diskState === "used") {
        patch.diskUsedBytes = wholeBytes(rawValue);
      } else if (diskState === "available") {
        patch.diskAvailableBytes = wholeBytes(rawValue);
      } else {
        return;
      }
      if (identity.kind === VMwareResourceKind.VirtualMachine) {
        patch.sawNonCpuMetric = true;
      }
      break;
    }
    case "vcenter.vm.disk.utilization":
    case "vcenter.datastore.disk.utilization": {
      patch.latestDiskPercent = rawValue;
      if (identity.kind === VMwareResourceKind.VirtualMachine) {
        patch.sawNonCpuMetric = true;
      }
      break;
    }

    // ---- Cluster ---------------------------------------------------
    case "vcenter.cluster.cpu.limit":
    case "vcenter.datacenter.cpu.limit": {
      patch.cpuCapacityMhz = wholeCount(rawValue);
      break;
    }
    case "vcenter.cluster.cpu.effective": {
      patch.cpuEffectiveMhz = wholeCount(rawValue);
      break;
    }
    case "vcenter.cluster.memory.limit":
    case "vcenter.datacenter.memory.limit": {
      // Already bytes (unlike host / VM memory, which is MiBy).
      patch.maxMemoryBytes = wholeBytes(rawValue);
      break;
    }
    case "vcenter.cluster.memory.effective": {
      patch.memoryEffectiveBytes = wholeBytes(rawValue);
      break;
    }
    case "vcenter.cluster.host.count": {
      const effective: string | null = getDatapointAttribute(
        dpAttributes,
        "effective",
      );
      patch.hostCount = summed(true);
      patch.effectiveHostCount = summed(effective === "true");
      break;
    }
    case "vcenter.cluster.vm.count": {
      const powerState: string | null = getDatapointAttribute(
        dpAttributes,
        "power_state",
      );
      patch.vmCount = summed(true);
      patch.poweredOnVmCount = summed(powerState === "on");
      break;
    }
    case "vcenter.cluster.vm_template.count": {
      patch.vmTemplateCount = summed(true);
      break;
    }

    // ---- Datacenter ------------------------------------------------
    case "vcenter.datacenter.host.count": {
      const powerState: string | null = getDatapointAttribute(
        dpAttributes,
        "power_state",
      );
      patch.hostCount = summed(true);
      patch.poweredOnHostCount = summed(powerState === "on");
      break;
    }
    case "vcenter.datacenter.vm.count": {
      const powerState: string | null = getDatapointAttribute(
        dpAttributes,
        "power_state",
      );
      patch.vmCount = summed(true);
      patch.poweredOnVmCount = summed(powerState === "on");
      break;
    }
    case "vcenter.datacenter.cluster.count": {
      patch.clusterCount = summed(true);
      break;
    }
    case "vcenter.datacenter.datastore.count": {
      patch.datastoreCount = summed(true);
      break;
    }

    // ---- Resource pool ---------------------------------------------
    case "vcenter.resource_pool.cpu.usage": {
      patch.latestCpuMhz = wholeCount(rawValue);
      break;
    }
    case "vcenter.resource_pool.memory.usage": {
      /*
       * Fans out over `type` (guest | host | overhead). The guest
       * consumption is the pool's memory usage; a receiver build without
       * the dimension reports the same number untyped.
       */
      const type: string | null = getDatapointAttribute(dpAttributes, "type");
      if (type !== null && type !== "guest") {
        return;
      }
      patch.latestMemoryBytes = mebibytesToBytes(rawValue);
      break;
    }
    case "vcenter.resource_pool.memory.ballooned": {
      patch.memoryBalloonedBytes = mebibytesToBytes(rawValue);
      break;
    }
    case "vcenter.resource_pool.memory.swapped": {
      patch.memorySwappedBytes = mebibytesToBytes(rawValue);
      break;
    }
    default: {
      return;
    }
  }

  const snap: VMwareVCenterSnapshotBufferEntry =
    getOrCreateVMwareVCenterSnapshot(data.vcenterBuffer, data.vcenterIdStr);
  markKindSeen(snap, identity.kind);

  foldVMwareResourceSnapshot({
    buffer: data.resourceBuffer,
    vcenterIdStr: data.vcenterIdStr,
    patch,
  });
}

/*
 * Summed-count fold: a newer timestamp resets the sum, an equal
 * timestamp adds, an older one is ignored.
 */
function foldSummedCount(
  existing: VMwareSummedCount | null,
  patch: VMwareSummedCount | null,
): VMwareSummedCount | null {
  if (patch === null) {
    return existing;
  }
  if (existing === null) {
    return { value: patch.value, observedAt: patch.observedAt };
  }
  if (patch.observedAt > existing.observedAt) {
    return { value: patch.value, observedAt: patch.observedAt };
  }
  if (patch.observedAt.getTime() === existing.observedAt.getTime()) {
    existing.value += patch.value;
  }
  return existing;
}

/*
 * Merge a patch into the per-vCenter buffer: identity attributes are
 * first-non-null-wins (stable, and a batch missing an attribute must
 * not blank them), status/metric fields are newest-observedAt-wins
 * (K8s buffer semantics), counts fold per foldSummedCount, and the
 * powered-on flags are sticky for the batch.
 */
export function foldVMwareResourceSnapshot(data: {
  buffer: Map<string, Map<string, VMwareResourceBufferEntry>>;
  vcenterIdStr: string;
  patch: VMwareResourceBufferEntry;
}): void {
  let perVCenter: Map<string, VMwareResourceBufferEntry> | undefined =
    data.buffer.get(data.vcenterIdStr);
  if (!perVCenter) {
    perVCenter = new Map();
    data.buffer.set(data.vcenterIdStr, perVCenter);
  }
  const key: string = `${data.patch.kind}|${data.patch.externalId}`;
  const existing: VMwareResourceBufferEntry | undefined = perVCenter.get(key);
  if (!existing) {
    perVCenter.set(key, data.patch);
    return;
  }

  const patch: VMwareResourceBufferEntry = data.patch;
  const newer: boolean = patch.observedAt >= existing.observedAt;

  // Identity: first-non-null wins.
  const identityFields: Array<
    | "name"
    | "datacenterName"
    | "clusterName"
    | "hostName"
    | "resourcePoolName"
    | "resourcePoolPath"
    | "virtualAppName"
    | "vmInstanceUuid"
  > = [
    "name",
    "datacenterName",
    "clusterName",
    "hostName",
    "resourcePoolName",
    "resourcePoolPath",
    "virtualAppName",
    "vmInstanceUuid",
  ];
  for (const field of identityFields) {
    if (existing[field] === null && patch[field] !== null) {
      existing[field] = patch[field];
    }
  }
  if (existing.isTemplate === null && patch.isTemplate !== null) {
    existing.isTemplate = patch.isTemplate;
  }

  // Powered-on evidence accumulates across the batch.
  existing.sawCpuMetric = existing.sawCpuMetric || patch.sawCpuMetric;
  existing.sawNonCpuMetric = existing.sawNonCpuMetric || patch.sawNonCpuMetric;

  // Status / metrics: newest observation wins.
  const metricFields: Array<
    | "latestCpuPercent"
    | "latestCpuMhz"
    | "cpuCapacityMhz"
    | "cpuEffectiveMhz"
    | "latestMemoryBytes"
    | "maxMemoryBytes"
    | "memoryEffectiveBytes"
    | "latestMemoryPercent"
    | "diskUsedBytes"
    | "diskAvailableBytes"
    | "latestDiskPercent"
    | "cpuReadinessPercent"
    | "memoryBalloonedBytes"
    | "memorySwappedBytes"
  > = [
    "latestCpuPercent",
    "latestCpuMhz",
    "cpuCapacityMhz",
    "cpuEffectiveMhz",
    "latestMemoryBytes",
    "maxMemoryBytes",
    "memoryEffectiveBytes",
    "latestMemoryPercent",
    "diskUsedBytes",
    "diskAvailableBytes",
    "latestDiskPercent",
    "cpuReadinessPercent",
    "memoryBalloonedBytes",
    "memorySwappedBytes",
  ];
  for (const field of metricFields) {
    if (patch[field] !== null && newer) {
      existing[field] = patch[field];
    }
  }

  // Counts: summed across the newest timestamp.
  existing.hostCount = foldSummedCount(existing.hostCount, patch.hostCount);
  existing.effectiveHostCount = foldSummedCount(
    existing.effectiveHostCount,
    patch.effectiveHostCount,
  );
  existing.poweredOnHostCount = foldSummedCount(
    existing.poweredOnHostCount,
    patch.poweredOnHostCount,
  );
  existing.vmCount = foldSummedCount(existing.vmCount, patch.vmCount);
  existing.poweredOnVmCount = foldSummedCount(
    existing.poweredOnVmCount,
    patch.poweredOnVmCount,
  );
  existing.vmTemplateCount = foldSummedCount(
    existing.vmTemplateCount,
    patch.vmTemplateCount,
  );
  existing.datastoreCount = foldSummedCount(
    existing.datastoreCount,
    patch.datastoreCount,
  );
  existing.clusterCount = foldSummedCount(
    existing.clusterCount,
    patch.clusterCount,
  );

  if (patch.observedAt > existing.observedAt) {
    existing.observedAt = patch.observedAt;
  }
}

/*
 * Power state is inferred, not reported: the vcenter receiver emits
 * vcenter.vm.cpu.usage / .cpu.utilization / .cpu.readiness ONLY for
 * powered-on virtual machines, and the agent config forbids splitting a
 * collection across exports (no send_batch_max_size), so within one
 * batch:
 *   - a VM whose resource carried any vcenter.vm.cpu.* point → true,
 *   - a VM whose resource carried memory / disk points but no CPU
 *     point → false (off or suspended — the receiver does not
 *     distinguish; the UI says "Powered off"),
 *   - a template, a non-VM row, or a VM with no VM points at all →
 *     null (the upsert COALESCE keeps the last-known value).
 */
export function computeVMwareIsPoweredOn(
  entry: VMwareResourceBufferEntry,
): boolean | null {
  if (entry.kind !== VMwareResourceKind.VirtualMachine) {
    return null;
  }
  if (entry.isTemplate === true) {
    return null;
  }
  if (entry.sawCpuMetric) {
    return true;
  }
  if (entry.sawNonCpuMetric) {
    return false;
  }
  return null;
}

function countValue(count: VMwareSummedCount | null): number | null {
  return count === null ? null : count.value;
}

/*
 * Project one folded entry onto the VMwareResource latest-metric mirror
 * columns, applying the derivations the §3 table specifies:
 *   - maxDiskBytes = used + available (null unless both arrived),
 *   - Datacenter latestDiskPercent = used ÷ (used + available) × 100,
 *   - Host maxMemoryBytes falls back to usage × 100 ÷ utilization when
 *     vcenter.host.memory.capacity is not enabled on the receiver,
 *   - VirtualMachine maxMemoryBytes is always that derivation (the
 *     receiver has no vm.memory.capacity metric).
 */
export function deriveVMwareResourceLatestMetric(
  entry: VMwareResourceBufferEntry,
): VMwareResourceLatestMetricSnapshot {
  const diskBytes: number | null = entry.diskUsedBytes;
  const maxDiskBytes: number | null =
    entry.diskUsedBytes !== null && entry.diskAvailableBytes !== null
      ? entry.diskUsedBytes + entry.diskAvailableBytes
      : null;

  let diskPercent: number | null = entry.latestDiskPercent;
  if (
    diskPercent === null &&
    entry.kind === VMwareResourceKind.Datacenter &&
    diskBytes !== null &&
    maxDiskBytes !== null &&
    maxDiskBytes > 0
  ) {
    diskPercent = (diskBytes / maxDiskBytes) * 100;
  }

  let maxMemoryBytes: number | null = entry.maxMemoryBytes;
  if (
    maxMemoryBytes === null &&
    (entry.kind === VMwareResourceKind.Host ||
      entry.kind === VMwareResourceKind.VirtualMachine) &&
    entry.latestMemoryBytes !== null &&
    entry.latestMemoryPercent !== null &&
    entry.latestMemoryPercent > 0
  ) {
    maxMemoryBytes = Math.trunc(
      (entry.latestMemoryBytes * 100) / entry.latestMemoryPercent,
    );
  }

  return {
    kind: entry.kind,
    externalId: entry.externalId,
    cpuPercent: entry.latestCpuPercent,
    cpuMhz: entry.latestCpuMhz,
    cpuCapacityMhz: entry.cpuCapacityMhz,
    cpuEffectiveMhz: entry.cpuEffectiveMhz,
    memoryBytes: entry.latestMemoryBytes,
    maxMemoryBytes,
    memoryEffectiveBytes: entry.memoryEffectiveBytes,
    memoryPercent: entry.latestMemoryPercent,
    diskBytes,
    maxDiskBytes,
    diskPercent,
    cpuReadinessPercent: entry.cpuReadinessPercent,
    memoryBalloonedBytes: entry.memoryBalloonedBytes,
    memorySwappedBytes: entry.memorySwappedBytes,
    hostCount: countValue(entry.hostCount),
    effectiveHostCount: countValue(entry.effectiveHostCount),
    poweredOnHostCount: countValue(entry.poweredOnHostCount),
    vmCount: countValue(entry.vmCount),
    poweredOnVmCount: countValue(entry.poweredOnVmCount),
    vmTemplateCount: countValue(entry.vmTemplateCount),
    datastoreCount: countValue(entry.datastoreCount),
    clusterCount: countValue(entry.clusterCount),
    observedAt: entry.observedAt,
  };
}

/*
 * Derive the VMwareVCenter snapshot columns from one folded batch.
 * Every count is only set when the batch carried at least one resource
 * of that kind (the saw* flags) — never zero a count on a partial
 * batch. Datastore capacity / used totals additionally require at
 * least one datastore row that actually carried a disk_state series,
 * so a batch of utilization-only datastore points cannot collapse the
 * totals to 0. Returns an object whose keys are exactly the columns to
 * write (empty object = nothing to write).
 */
export function deriveVMwareVCenterSnapshotExtras(
  entries: Array<VMwareResourceBufferEntry>,
  snap: VMwareVCenterSnapshotBufferEntry | undefined,
): VMwareVCenterSnapshotExtras {
  const extras: VMwareVCenterSnapshotExtras = {};

  const ofKind: (kind: string) => Array<VMwareResourceBufferEntry> = (
    kind: string,
  ) => {
    return entries.filter((e: VMwareResourceBufferEntry) => {
      return e.kind === kind;
    });
  };

  if (snap?.sawDatacenter) {
    extras.datacenterCount = ofKind(VMwareResourceKind.Datacenter).length;
  }
  if (snap?.sawCluster) {
    extras.clusterCount = ofKind(VMwareResourceKind.Cluster).length;
  }
  if (snap?.sawHost) {
    extras.hostCount = ofKind(VMwareResourceKind.Host).length;
  }
  if (snap?.sawVirtualMachine) {
    const vms: Array<VMwareResourceBufferEntry> = ofKind(
      VMwareResourceKind.VirtualMachine,
    ).filter((e: VMwareResourceBufferEntry) => {
      return e.isTemplate !== true;
    });
    extras.vmCount = vms.length;
    extras.poweredOnVmCount = vms.filter((e: VMwareResourceBufferEntry) => {
      return computeVMwareIsPoweredOn(e) === true;
    }).length;
  }
  if (snap?.sawDatastore) {
    const datastores: Array<VMwareResourceBufferEntry> = ofKind(
      VMwareResourceKind.Datastore,
    );
    extras.datastoreCount = datastores.length;

    const withCapacity: Array<VMwareResourceLatestMetricSnapshot> = datastores
      .map((e: VMwareResourceBufferEntry) => {
        return deriveVMwareResourceLatestMetric(e);
      })
      .filter((m: VMwareResourceLatestMetricSnapshot) => {
        return m.maxDiskBytes !== null;
      });
    if (withCapacity.length > 0) {
      extras.datastoreCapacityBytes = withCapacity.reduce(
        (sum: number, m: VMwareResourceLatestMetricSnapshot) => {
          return sum + (m.maxDiskBytes as number);
        },
        0,
      );
    }
    const withUsed: Array<VMwareResourceLatestMetricSnapshot> = datastores
      .map((e: VMwareResourceBufferEntry) => {
        return deriveVMwareResourceLatestMetric(e);
      })
      .filter((m: VMwareResourceLatestMetricSnapshot) => {
        return m.diskBytes !== null;
      });
    if (withUsed.length > 0) {
      extras.datastoreUsedBytes = withUsed.reduce(
        (sum: number, m: VMwareResourceLatestMetricSnapshot) => {
          return sum + (m.diskBytes as number);
        },
        0,
      );
    }
  }
  if (snap?.sawResourcePool) {
    extras.resourcePoolCount = ofKind(VMwareResourceKind.ResourcePool).length;
  }

  return extras;
}
