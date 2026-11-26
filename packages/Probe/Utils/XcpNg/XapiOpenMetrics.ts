import { OpenMetricsSample, OpenMetricsType } from "./OpenMetricsText";

/*
 * ------------------------------------------------------------------
 * The series Xen Orchestra's OpenMetrics plugin would serve for a pool,
 * built from XAPI's own answers - so a pool read without Xen Orchestra
 * (#10999) has the same series, names, labels and values as one read
 * through it (#10995, #10996), and every page, monitor and template reads
 * it unchanged.
 * ------------------------------------------------------------------
 *
 * A port of xo-server-openmetrics 1.9.4 (vatesfr/xen-orchestra,
 * packages/xo-server-openmetrics: rrd-parser.mts, openmetric-formatter.mts
 * and the label lookups of index.mts, read on 26 November 2026), and of how
 * xo-server turns XAPI's records into the objects that plugin reads
 * (xapi-object-to-xo.mjs). It is a port, not a re-imagining: the metric
 * table is the plugin's, in its order (the first match wins); the unit
 * conversions are the plugin's (KiB and MiB to bytes, microseconds to
 * seconds); the labels are the plugin's, in the order it adds them, an
 * empty one left out; the plugin's quirks are kept too:
 *
 *   - of an rrd_updates answer, the LAST row is read (data[length - 1]);
 *   - a VM with no cpu_usage series gets one averaged from its cores, with
 *     the plugin's own help text;
 *   - a pool XAPI names nothing is named after its master host, as
 *     xo-server names it;
 *   - a host's uptime is read from other_config.boot_time, a VM's from its
 *     metrics' start_time, and is emitted for every host that has one;
 *   - HELP is a family's first sample's, in the plugin's sort order.
 *
 * What is not ported: the IPMI host power and the estimated VM power drawn
 * from it (the plugin reads IPMI through a host plugin call, which a
 * read-only account may not make; the XCP-ng Agent drops the host's reading
 * anyway, since it carries no pool), the XOSTOR series (they need
 * linstor-manager plugin calls) and Xen Orchestra's own xo_* series (there
 * is no Xen Orchestra). The DCMI power reading the RRDs carry, and the VM
 * power estimated from it, are ported.
 *
 * Pure: it is handed XAPI's records and rrd_updates answers, and a clock.
 */

// --- XAPI records, the fields read ------------------------------------------

export interface XapiPoolRecord {
  uuid: string;
  name_label: string;
  master: string;
  ha_enabled?: boolean | undefined;
  ha_host_failures_to_tolerate?: string | number | undefined;
  ha_plan_exists_for?: string | number | undefined;
  ha_overcommitted?: boolean | undefined;
}

export interface XapiHostRecord {
  uuid: string;
  name_label: string;
  address: string;
  enabled: boolean;
  metrics: string;
  other_config: Record<string, string>;
  tags: Array<string>;
  PIFs?: Array<string> | undefined;
  software_version?: Record<string, string> | undefined;
}

export interface XapiHostMetricsRecord {
  live: boolean;
}

export interface XapiVmRecord {
  uuid: string;
  name_label: string;
  power_state: string;
  is_control_domain: boolean;
  is_a_template: boolean;
  is_a_snapshot: boolean;
  snapshot_of: string;
  resident_on: string;
  metrics: string;
  VCPUs_max: string | number;
  VCPUs_at_startup: string | number;
  tags: Array<string>;
}

export interface XapiVmMetricsRecord {
  start_time: string;
}

export interface XapiSrRecord {
  uuid: string;
  name_label: string;
  type: string;
  content_type: string;
  physical_size: string | number;
  physical_utilisation: string | number;
  virtual_allocation: string | number;
  shared: boolean;
  PBDs: Array<string>;
  tags: Array<string>;
}

export interface XapiPbdRecord {
  host: string;
  SR: string;
}

export interface XapiVdiRecord {
  uuid: string;
  name_label: string;
  SR: string;
  VBDs: Array<string>;
  virtual_size: string | number;
  physical_utilisation: string | number;
  is_a_snapshot: boolean;
  snapshot_of: string;
  managed: boolean;
}

export interface XapiVbdRecord {
  VM: string;
  VDI: string;
  device: string;
}

export interface XapiVifRecord {
  VM: string;
  network: string;
  device: string;
}

export interface XapiPifRecord {
  host: string;
  network: string;
  device: string;
}

export interface XapiNetworkRecord {
  name_label: string;
}

// Everything one read of a pool through XAPI holds, by OpaqueRef.
export interface XapiPoolSnapshot {
  pools: Record<string, XapiPoolRecord>;
  hosts: Record<string, XapiHostRecord>;
  hostMetrics: Record<string, XapiHostMetricsRecord>;
  vms: Record<string, XapiVmRecord>;
  vmMetrics: Record<string, XapiVmMetricsRecord>;
  srs: Record<string, XapiSrRecord>;
  pbds: Record<string, XapiPbdRecord>;
  vdis: Record<string, XapiVdiRecord>;
  vbds: Record<string, XapiVbdRecord>;
  vifs: Record<string, XapiVifRecord>;
  pifs: Record<string, XapiPifRecord>;
  networks: Record<string, XapiNetworkRecord>;
  // rrd_updates answers, by the UUID of the host each was read from.
  rrds: Array<{ hostUuid: string; text: string }>;
  // The read's clock, in seconds (the plugin's Date.now() / 1000).
  nowSeconds: number;
}

// --- The plugin's metric table (openmetric-formatter.mts) --------------------

interface MetricDefinition {
  test: RegExp | string;
  openMetricName: string;
  type: "gauge" | "counter";
  help: string;
  transformValue?: ((value: number) => number) | undefined;
  extractLabels?:
    | ((matches: RegExpMatchArray) => Record<string, string>)
    | undefined;
}

const MIB: number = Math.pow(2, 20);

const sr: (matches: RegExpMatchArray) => Record<string, string> = (
  matches: RegExpMatchArray,
): Record<string, string> => {
  return { sr: matches[1]! };
};

const device: (matches: RegExpMatchArray) => Record<string, string> = (
  matches: RegExpMatchArray,
): Record<string, string> => {
  return { device: `xvd${matches[1]!}` };
};

export const HOST_METRICS: ReadonlyArray<MetricDefinition> = [
  { test: "loadavg", openMetricName: "host_load_average", type: "gauge", help: "Host load average" },
  { test: "memory_free_kib", openMetricName: "host_memory_free_bytes", type: "gauge", help: "Host free memory in bytes", transformValue: (v: number) => v * 1024 },
  { test: "memory_total_kib", openMetricName: "host_memory_total_bytes", type: "gauge", help: "Host total memory in bytes", transformValue: (v: number) => v * 1024 },
  { test: "cpu_avg", openMetricName: "host_cpu_average", type: "gauge", help: "Host average CPU usage ratio" },
  { test: /^cpu(\d+)$/, openMetricName: "host_cpu_core_usage", type: "gauge", help: "Host CPU core usage ratio", extractLabels: (m: RegExpMatchArray) => ({ core: m[1]! }) },
  { test: "pif_aggr_rx", openMetricName: "host_network_aggregated_receive_bytes", type: "gauge", help: "Aggregated received bytes per second" },
  { test: "pif_aggr_tx", openMetricName: "host_network_aggregated_transmit_bytes", type: "gauge", help: "Aggregated transmitted bytes per second" },
  { test: /^pif_(.+)_rx$/, openMetricName: "host_network_receive_bytes_total", type: "counter", help: "Host network interface received bytes", extractLabels: (m: RegExpMatchArray) => ({ interface: m[1]! }) },
  { test: /^pif_(.+)_tx$/, openMetricName: "host_network_transmit_bytes_total", type: "counter", help: "Host network interface transmitted bytes", extractLabels: (m: RegExpMatchArray) => ({ interface: m[1]! }) },
  { test: /^iops_read_(.+)$/, openMetricName: "host_disk_iops_read", type: "gauge", help: "Host disk read IOPS", extractLabels: sr },
  { test: /^iops_write_(.+)$/, openMetricName: "host_disk_iops_write", type: "gauge", help: "Host disk write IOPS", extractLabels: sr },
  { test: /^io_throughput_read_(.+)$/, openMetricName: "host_disk_throughput_read_bytes", type: "gauge", help: "Host disk read throughput in bytes per second", transformValue: (v: number) => v * MIB, extractLabels: sr },
  { test: /^io_throughput_write_(.+)$/, openMetricName: "host_disk_throughput_write_bytes", type: "gauge", help: "Host disk write throughput in bytes per second", transformValue: (v: number) => v * MIB, extractLabels: sr },
  { test: /^read_latency_(.+)$/, openMetricName: "host_disk_read_latency_seconds", type: "gauge", help: "Host disk read latency in seconds", transformValue: (v: number) => v / 1e6, extractLabels: sr },
  { test: /^write_latency_(.+)$/, openMetricName: "host_disk_write_latency_seconds", type: "gauge", help: "Host disk write latency in seconds", transformValue: (v: number) => v / 1e6, extractLabels: sr },
  { test: /^iowait_(.+)$/, openMetricName: "host_disk_iowait", type: "gauge", help: "Host disk IO wait ratio", extractLabels: sr },
  { test: "DCMI-power-reading", openMetricName: "host_power_consumption_watts", type: "gauge", help: "Host power consumption in watts (DCMI)" },
  { test: "hostload", openMetricName: "host_load", type: "gauge", help: "Normalized host load" },
  { test: "memory_reclaimed", openMetricName: "host_memory_reclaimed_bytes", type: "gauge", help: "Reclaimed host memory in bytes", transformValue: (v: number) => v * 1024 },
  { test: "memory_reclaimed_max", openMetricName: "host_memory_reclaimed_max_bytes", type: "gauge", help: "Maximum reclaimable host memory in bytes", transformValue: (v: number) => v * 1024 },
  { test: "running_vcpus", openMetricName: "host_running_vcpus", type: "gauge", help: "Total number of running vCPUs" },
  { test: /^iops_total_(.+)$/, openMetricName: "host_disk_iops_total", type: "gauge", help: "Total IOPS (read + write) per SR", extractLabels: sr },
  { test: /^io_throughput_total_(.+)$/, openMetricName: "host_disk_throughput_total_bytes", type: "gauge", help: "Total I/O throughput per SR in bytes per second", transformValue: (v: number) => v * MIB, extractLabels: sr },
  { test: /^latency_(.+)$/, openMetricName: "host_disk_latency_seconds", type: "gauge", help: "Combined I/O latency per SR in seconds", transformValue: (v: number) => v / 1e6, extractLabels: sr },
];

export const VM_METRICS: ReadonlyArray<MetricDefinition> = [
  { test: /memory$/, openMetricName: "vm_memory_bytes", type: "gauge", help: "VM memory usage in bytes" },
  { test: "memory_internal_free", openMetricName: "vm_memory_internal_free_bytes", type: "gauge", help: "VM internal free memory in bytes", transformValue: (v: number) => v * 1024 },
  { test: "memory_target", openMetricName: "vm_memory_target_bytes", type: "gauge", help: "VM memory target in bytes" },
  { test: "cpu_usage", openMetricName: "vm_cpu_usage", type: "gauge", help: "VM CPU usage ratio" },
  { test: /^cpu(\d+)$/, openMetricName: "vm_cpu_core_usage", type: "gauge", help: "VM CPU core usage ratio", extractLabels: (m: RegExpMatchArray) => ({ core: m[1]! }) },
  { test: "runstate_fullrun", openMetricName: "vm_runstate_fullrun", type: "gauge", help: "VM runstate fullrun ratio" },
  { test: "runstate_full_contention", openMetricName: "vm_runstate_full_contention", type: "gauge", help: "VM runstate full contention ratio" },
  { test: "runstate_partial_run", openMetricName: "vm_runstate_partial_run", type: "gauge", help: "VM runstate partial run ratio" },
  { test: "runstate_partial_contention", openMetricName: "vm_runstate_partial_contention", type: "gauge", help: "VM runstate partial contention ratio" },
  { test: "runstate_concurrency_hazard", openMetricName: "vm_runstate_concurrency_hazard", type: "gauge", help: "VM runstate concurrency hazard ratio" },
  { test: "runstate_blocked", openMetricName: "vm_runstate_blocked", type: "gauge", help: "VM runstate blocked ratio" },
  { test: /^vif_(\d+)_rx$/, openMetricName: "vm_network_receive_bytes_total", type: "counter", help: "VM network interface received bytes", extractLabels: (m: RegExpMatchArray) => ({ vif: m[1]! }) },
  { test: /^vif_(\d+)_tx$/, openMetricName: "vm_network_transmit_bytes_total", type: "counter", help: "VM network interface transmitted bytes", extractLabels: (m: RegExpMatchArray) => ({ vif: m[1]! }) },
  { test: /^vif_(\d+)_rx_errors$/, openMetricName: "vm_network_receive_errors_total", type: "counter", help: "VM network interface receive errors", extractLabels: (m: RegExpMatchArray) => ({ vif: m[1]! }) },
  { test: /^vif_(\d+)_tx_errors$/, openMetricName: "vm_network_transmit_errors_total", type: "counter", help: "VM network interface transmit errors", extractLabels: (m: RegExpMatchArray) => ({ vif: m[1]! }) },
  { test: /^vbd_xvd(.)_read$/, openMetricName: "vm_disk_read_bytes_total", type: "counter", help: "VM disk read bytes", extractLabels: device },
  { test: /^vbd_xvd(.)_write$/, openMetricName: "vm_disk_write_bytes_total", type: "counter", help: "VM disk write bytes", extractLabels: device },
  { test: /^vbd_xvd(.)_iops_read$/, openMetricName: "vm_disk_iops_read", type: "gauge", help: "VM disk read IOPS", extractLabels: device },
  { test: /^vbd_xvd(.)_iops_write$/, openMetricName: "vm_disk_iops_write", type: "gauge", help: "VM disk write IOPS", extractLabels: device },
  { test: /^vbd_xvd(.)_iops_total$/, openMetricName: "vm_disk_iops_total", type: "gauge", help: "VM disk total IOPS", extractLabels: device },
  { test: /^vbd_xvd(.)_read_latency$/, openMetricName: "vm_disk_read_latency_seconds", type: "gauge", help: "VM disk read latency in seconds", transformValue: (v: number) => v / 1e6, extractLabels: device },
  { test: /^vbd_xvd(.)_write_latency$/, openMetricName: "vm_disk_write_latency_seconds", type: "gauge", help: "VM disk write latency in seconds", transformValue: (v: number) => v / 1e6, extractLabels: device },
  { test: /^vbd_xvd(.)_io_throughput_read$/, openMetricName: "vm_disk_throughput_read_bytes", type: "gauge", help: "VM disk read throughput in bytes per second", transformValue: (v: number) => v * 2 ** 20, extractLabels: device },
  { test: /^vbd_xvd(.)_io_throughput_write$/, openMetricName: "vm_disk_throughput_write_bytes", type: "gauge", help: "VM disk write throughput in bytes per second", transformValue: (v: number) => v * 2 ** 20, extractLabels: device },
  { test: /^vbd_xvd(.)_io_throughput_total$/, openMetricName: "vm_disk_throughput_total_bytes", type: "gauge", help: "VM disk total throughput in bytes per second", transformValue: (v: number) => v * 2 ** 20, extractLabels: device },
  { test: /^vbd_xvd(.)_latency$/, openMetricName: "vm_disk_latency_seconds", type: "gauge", help: "VM disk average IO latency in seconds", transformValue: (v: number) => v / 1e6, extractLabels: device },
  { test: /^vbd_xvd(.)_iowait$/, openMetricName: "vm_disk_iowait", type: "gauge", help: "VM disk IO wait ratio", extractLabels: device },
  { test: /^vbd_xvd(.)_inflight$/, openMetricName: "vm_disk_inflight", type: "gauge", help: "VM disk inflight operations", extractLabels: device },
  { test: /^vbd_xvd(.)_avgqu_sz$/, openMetricName: "vm_disk_queue_size", type: "gauge", help: "VM disk average queue size", extractLabels: device },
];

// --- The plugin's formatted metric ------------------------------------------

export interface FormattedMetric {
  name: string;
  help: string;
  type: "gauge" | "counter";
  // In the order the plugin adds them.
  labels: Record<string, string>;
  value: number;
  // Seconds; null for xcp_pool_connected, which is served without one.
  timestamp: number | null;
}

// --- rrd-parser.mts ---------------------------------------------------------

interface ParsedLegend {
  objectType: "host" | "vm" | "sr";
  uuid: string;
  metricName: string;
}

const LEGEND_REGEX: RegExp = /^([A-Z]+):([^:]+):([^:]+):(.+)$/;
const VALID_OBJECT_TYPES: ReadonlySet<string> = new Set<string>([
  "host",
  "vm",
  "sr",
]);

export function parseRrdNumber(value: unknown): number | null {
  let number: unknown = value;

  if (number === undefined || number === null) {
    return null;
  }

  if (typeof number === "string") {
    if (number.trim() === "") {
      return null;
    }

    // XAPI 23.31 and later writes every number as a string.
    number = Number(number);
  }

  if (typeof number !== "number" || !Number.isFinite(number)) {
    return null;
  }

  return number;
}

export function parseRrdLegend(legend: string): ParsedLegend | null {
  const match: RegExpExecArray | null = LEGEND_REGEX.exec(legend);

  if (!match) {
    return null;
  }

  const [, , objectType, uuid, metricName] = match;

  if (!objectType || !uuid || !metricName || !VALID_OBJECT_TYPES.has(objectType)) {
    return null;
  }

  return {
    objectType: objectType as "host" | "vm" | "sr",
    uuid: uuid,
    metricName: metricName,
  };
}

/*
 * An rrd_updates answer as JSON. Before XAPI 23.31 a NaN or an Infinity was
 * written bare, which JSON cannot read (the plugin falls back to JSON5): a
 * bare one outside a string is quoted before the second try.
 */
export function parseRrdText(text: string): {
  meta: { end?: number | undefined; legend: Array<string> };
  data: Array<{ t: number; values: Array<unknown> }>;
} {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = JSON.parse(
      text.replace(
        /("(?:[^"\\]|\\.)*")|(-?Infinity|NaN)/g,
        (whole: string, quoted: string | undefined): string => {
          return quoted ? quoted : `"${whole}"`;
        },
      ),
    );
  }

  const record: Record<string, unknown> =
    parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const meta: Record<string, unknown> =
    record["meta"] && typeof record["meta"] === "object"
      ? (record["meta"] as Record<string, unknown>)
      : {};

  return {
    meta: {
      end: typeof meta["end"] === "number" ? (meta["end"] as number) : undefined,
      legend: Array.isArray(meta["legend"])
        ? (meta["legend"] as Array<unknown>).map((entry: unknown) => {
            return String(entry);
          })
        : [],
    },
    data: Array.isArray(record["data"])
      ? (record["data"] as Array<Record<string, unknown>>).map(
          (row: Record<string, unknown>) => {
            return {
              t: Number(row?.["t"]),
              values: Array.isArray(row?.["values"])
                ? (row["values"] as Array<unknown>)
                : [],
            };
          },
        )
      : [],
  };
}

// --- The label lookups (index.mts #getLabelLookupData) -----------------------

interface VmLabelInfo {
  name_label: string;
  is_control_domain: boolean;
  vbdDeviceToVdiName: Record<string, string>;
  vbdDeviceToVdiUuid: Record<string, string>;
  vifIndexToNetworkName: Record<string, string>;
  startTime: number | null;
  power_state: string;
  vcpus: number;
  pool_id: string;
  pool_name: string;
  tags: Array<string>;
}

interface HostLabelInfo {
  name_label: string;
  pifDeviceToNetworkName: Record<string, string>;
  startTime: number | null;
  tags: Array<string>;
}

interface LabelLookupData {
  vms: Map<string, VmLabelInfo>;
  hosts: Map<string, HostLabelInfo>;
  srs: Map<string, { name_label: string; SR_type: string }>;
  srTruncatedToUuid: Map<string, string | null>;
  vdiUuidToSrUuid: Map<string, string>;
}

export const SR_UUID_TRUNCATIONS: ReadonlyArray<number> = [8, 12, 16, 20];

export function indexSrUuidTruncations(
  uuid: string,
  index: Map<string, string | null>,
): void {
  for (const length of SR_UUID_TRUNCATIONS) {
    if (uuid.length < length) {
      continue;
    }

    for (const truncation of [uuid.slice(0, length), uuid.slice(-length)]) {
      const indexed: string | null | undefined = index.get(truncation);

      if (indexed === undefined) {
        index.set(truncation, uuid);
      } else if (indexed !== uuid) {
        // Two SRs share it: never resolved, rather than resolved wrongly.
        index.set(truncation, null);
      }
    }
  }
}

const NULL_REF: string = "OpaqueRef:NULL";

/*
 * XAPI's date and time - "20261126T04:20:30Z", or the seconds XAPI keeps
 * in other_config.boot_time - as Unix seconds, or null for none: what
 * @xen-orchestra/xapi's parseDateTime returns.
 */
export function toUnixSeconds(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "number") {
    return value || null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const asNumber: number = Number(value);

  if (!Number.isNaN(asNumber) && value.trim() !== "") {
    return asNumber || null;
  }

  const match: RegExpMatchArray | null = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:?\d{2})?$/,
  );

  if (!match) {
    return null;
  }

  const zone: string = match[7] || "Z";
  const time: number = Date.parse(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${
      zone === "Z"
        ? "Z"
        : zone.includes(":")
          ? zone
          : `${zone.slice(0, 3)}:${zone.slice(3)}`
    }`,
  );

  if (Number.isNaN(time) || time === 0) {
    return null;
  }

  return Math.floor(time / 1000);
}

function toNumber(value: string | number | undefined): number {
  return Number(value);
}

// What xo-server calls a VM: a VM, its control domain, a template, a snapshot.
type XoVmType = "VM" | "VM-controller" | "VM-template" | "VM-snapshot";

function getVmType(vm: XapiVmRecord, vms: Record<string, XapiVmRecord>): XoVmType {
  if (vm.is_control_domain) {
    return "VM-controller";
  }

  if (vm.is_a_snapshot || (vm.snapshot_of && vm.snapshot_of !== NULL_REF && vms[vm.snapshot_of])) {
    return "VM-snapshot";
  }

  if (vm.is_a_template) {
    return "VM-template";
  }

  return "VM";
}

// Whether xo-server lists a VDI as a 'VDI' (not a snapshot, not unmanaged).
function isPlainVdi(vdi: XapiVdiRecord, vdis: Record<string, XapiVdiRecord>): boolean {
  if (vdi.is_a_snapshot || (vdi.snapshot_of && vdi.snapshot_of !== NULL_REF && vdis[vdi.snapshot_of])) {
    return false;
  }

  return vdi.managed !== false;
}

/*
 * The pool's name as xo-server gives it: its own, or - for a pool XAPI names
 * nothing, as one made by joining hosts often is - its master's.
 */
export function getXoPoolName(snapshot: XapiPoolSnapshot): {
  poolId: string;
  poolName: string;
} {
  const pool: XapiPoolRecord | undefined = Object.values(snapshot.pools)[0];

  if (!pool) {
    return { poolId: "", poolName: "" };
  }

  const master: XapiHostRecord | undefined = snapshot.hosts[pool.master];

  return {
    poolId: pool.uuid,
    poolName: pool.name_label || master?.name_label || "",
  };
}

function getHostPowerState(
  host: XapiHostRecord,
  hostMetrics: Record<string, XapiHostMetricsRecord>,
): string {
  const metrics: XapiHostMetricsRecord | undefined = hostMetrics[host.metrics];

  if (!metrics) {
    return "Unknown";
  }

  return metrics.live ? "Running" : "Halted";
}

function buildLabelLookups(
  snapshot: XapiPoolSnapshot,
  pool: { poolId: string; poolName: string },
): LabelLookupData {
  const lookups: LabelLookupData = {
    vms: new Map(),
    hosts: new Map(),
    srs: new Map(),
    srTruncatedToUuid: new Map(),
    vdiUuidToSrUuid: new Map(),
  };

  const networkNameByRef: Map<string, string> = new Map();
  for (const [ref, network] of Object.entries(snapshot.networks)) {
    networkNameByRef.set(ref, network.name_label);
  }

  // VDI names and their SR, for the plain VDIs only.
  const vdiNameByRef: Map<string, { name: string; uuid: string }> = new Map();
  for (const [ref, vdi] of Object.entries(snapshot.vdis)) {
    if (!isPlainVdi(vdi, snapshot.vdis)) {
      continue;
    }

    vdiNameByRef.set(ref, { name: vdi.name_label, uuid: vdi.uuid });

    const srRecord: XapiSrRecord | undefined = snapshot.srs[vdi.SR];
    if (srRecord) {
      lookups.vdiUuidToSrUuid.set(vdi.uuid, srRecord.uuid);
    }
  }

  // VM -> device -> VDI.
  const vbdMap: Map<string, Map<string, { name: string; uuid: string }>> =
    new Map();
  for (const vbd of Object.values(snapshot.vbds)) {
    if (!vbd.device || !vbd.VDI || vbd.VDI === NULL_REF) {
      continue;
    }

    let vmVbds: Map<string, { name: string; uuid: string }> | undefined =
      vbdMap.get(vbd.VM);

    if (!vmVbds) {
      vmVbds = new Map();
      vbdMap.set(vbd.VM, vmVbds);
    }

    const vdi: { name: string; uuid: string } | undefined = vdiNameByRef.get(
      vbd.VDI,
    );

    if (vdi) {
      vmVbds.set(vbd.device, vdi);
    }
  }

  // VM -> VIF index -> network name.
  const vifMap: Map<string, Map<string, string>> = new Map();
  for (const vif of Object.values(snapshot.vifs)) {
    if (!vif.VM || vif.VM === NULL_REF) {
      continue;
    }

    let vmVifs: Map<string, string> | undefined = vifMap.get(vif.VM);

    if (!vmVifs) {
      vmVifs = new Map();
      vifMap.set(vif.VM, vmVifs);
    }

    const networkName: string | undefined = networkNameByRef.get(vif.network);

    if (networkName !== undefined) {
      vmVifs.set(vif.device, networkName);
    }
  }

  // Host -> PIF device -> network name.
  const pifMap: Map<string, Map<string, string>> = new Map();
  for (const pif of Object.values(snapshot.pifs)) {
    let hostPifs: Map<string, string> | undefined = pifMap.get(pif.host);

    if (!hostPifs) {
      hostPifs = new Map();
      pifMap.set(pif.host, hostPifs);
    }

    const networkName: string | undefined = networkNameByRef.get(pif.network);

    if (networkName !== undefined) {
      hostPifs.set(pif.device, networkName);
    }
  }

  for (const [ref, vm] of Object.entries(snapshot.vms)) {
    const type: XoVmType = getVmType(vm, snapshot.vms);

    if (type !== "VM" && type !== "VM-controller") {
      continue;
    }

    const vbdDeviceToVdiName: Record<string, string> = {};
    const vbdDeviceToVdiUuid: Record<string, string> = {};
    for (const [deviceName, vdi] of vbdMap.get(ref) || new Map()) {
      vbdDeviceToVdiName[deviceName] = vdi.name;
      vbdDeviceToVdiUuid[deviceName] = vdi.uuid;
    }

    const vifIndexToNetworkName: Record<string, string> = {};
    for (const [index, networkName] of vifMap.get(ref) || new Map()) {
      vifIndexToNetworkName[index] = networkName;
    }

    const metrics: XapiVmMetricsRecord | undefined = snapshot.vmMetrics[vm.metrics];

    lookups.vms.set(vm.uuid, {
      name_label: vm.name_label,
      is_control_domain: type === "VM-controller",
      vbdDeviceToVdiName: vbdDeviceToVdiName,
      vbdDeviceToVdiUuid: vbdDeviceToVdiUuid,
      vifIndexToNetworkName: vifIndexToNetworkName,
      startTime: metrics ? toUnixSeconds(metrics.start_time) : null,
      power_state: vm.power_state,
      vcpus: toNumber(vm.VCPUs_max) || toNumber(vm.VCPUs_at_startup) || 1,
      pool_id: pool.poolId,
      pool_name: pool.poolName,
      tags: vm.tags || [],
    });
  }

  for (const [ref, host] of Object.entries(snapshot.hosts)) {
    const pifDeviceToNetworkName: Record<string, string> = {};
    for (const [deviceName, networkName] of pifMap.get(ref) || new Map()) {
      pifDeviceToNetworkName[deviceName] = networkName;
    }

    lookups.hosts.set(host.uuid, {
      name_label: host.name_label,
      pifDeviceToNetworkName: pifDeviceToNetworkName,
      startTime: toUnixSeconds(host.other_config?.["boot_time"]),
      tags: host.tags || [],
    });
  }

  for (const srRecord of Object.values(snapshot.srs)) {
    lookups.srs.set(srRecord.uuid, {
      name_label: srRecord.name_label,
      SR_type: srRecord.type || "",
    });
    indexSrUuidTruncations(srRecord.uuid, lookups.srTruncatedToUuid);
  }

  return lookups;
}

// --- openmetric-formatter.mts -----------------------------------------------

export function serializeTags(tags: ReadonlyArray<string> | undefined): string {
  if (!tags || tags.length === 0) {
    return "";
  }

  return [...new Set(tags)]
    .filter((tag: string) => {
      return tag.trim() !== "";
    })
    .sort()
    .join(",");
}

function addTagsLabel(
  labels: Record<string, string>,
  tags: ReadonlyArray<string> | undefined,
): void {
  const serialized: string = serializeTags(tags);

  if (serialized !== "") {
    labels["tags"] = serialized;
  }
}

function findMetricDefinition(
  metricName: string,
  objectType: "host" | "vm" | "sr",
): { definition: MetricDefinition; matches: RegExpMatchArray | null } | null {
  const definitions: ReadonlyArray<MetricDefinition> =
    objectType === "host" ? HOST_METRICS : objectType === "vm" ? VM_METRICS : [];

  for (const definition of definitions) {
    if (typeof definition.test === "string") {
      if (metricName === definition.test) {
        return { definition, matches: null };
      }
      continue;
    }

    const matches: RegExpExecArray | null = definition.test.exec(metricName);

    if (matches) {
      return { definition, matches };
    }
  }

  return null;
}

function transformRrdMetric(data: {
  legend: ParsedLegend;
  value: number;
  timestamp: number;
  poolId: string;
  poolLabel: string;
  hostId: string;
  lookups: LabelLookupData;
}): FormattedMetric | null {
  const match: {
    definition: MetricDefinition;
    matches: RegExpMatchArray | null;
  } | null = findMetricDefinition(data.legend.metricName, data.legend.objectType);

  if (!match) {
    return null;
  }

  const { definition, matches } = match;
  const value: number = definition.transformValue
    ? definition.transformValue(data.value)
    : data.value;

  const extracted: Record<string, string> =
    matches && definition.extractLabels ? definition.extractLabels(matches) : {};

  const labels: Record<string, string> = {
    pool_id: data.poolId,
    uuid: data.legend.uuid,
    type: data.legend.objectType,
  };

  if (data.legend.objectType === "vm" && data.hostId) {
    labels["host_id"] = data.hostId;
  }

  let objectTags: ReadonlyArray<string> | undefined;

  if (data.poolLabel !== "") {
    labels["pool_name"] = data.poolLabel;
  }

  if (data.legend.objectType === "host") {
    const hostInfo: HostLabelInfo | undefined = data.lookups.hosts.get(
      data.legend.uuid,
    );

    if (hostInfo) {
      if (hostInfo.name_label !== "") {
        labels["host_name"] = hostInfo.name_label;
      }

      objectTags = hostInfo.tags;

      if (extracted["interface"] !== undefined) {
        const networkName: string | undefined =
          hostInfo.pifDeviceToNetworkName[extracted["interface"]];

        if (networkName) {
          labels["network_name"] = networkName;
        }
      }

      if (extracted["sr"] !== undefined) {
        const srUuid: string | null | undefined =
          data.lookups.srTruncatedToUuid.get(extracted["sr"]);

        if (srUuid) {
          labels["sr_uuid"] = srUuid;
          const srInfo: { name_label: string; SR_type: string } | undefined =
            data.lookups.srs.get(srUuid);

          if (srInfo) {
            if (srInfo.name_label !== "") {
              labels["sr_name"] = srInfo.name_label;
            }

            if (srInfo.SR_type !== "") {
              labels["sr_type"] = srInfo.SR_type;
            }
          }
        }
      }
    }
  }

  if (data.legend.objectType === "vm") {
    if (data.hostId) {
      const residentHost: HostLabelInfo | undefined = data.lookups.hosts.get(
        data.hostId,
      );

      if (residentHost && residentHost.name_label !== "") {
        labels["host_name"] = residentHost.name_label;
      }
    }

    const vmInfo: VmLabelInfo | undefined = data.lookups.vms.get(
      data.legend.uuid,
    );

    if (vmInfo) {
      if (vmInfo.name_label !== "") {
        labels["vm_name"] = vmInfo.name_label;
      }

      labels["is_control_domain"] = vmInfo.is_control_domain ? "true" : "false";
      objectTags = vmInfo.tags;

      if (extracted["device"] !== undefined) {
        const vdiName: string | undefined =
          vmInfo.vbdDeviceToVdiName[extracted["device"]];

        if (vdiName) {
          labels["vdi_name"] = vdiName;
        }

        const vdiUuid: string | undefined =
          vmInfo.vbdDeviceToVdiUuid[extracted["device"]];

        if (vdiUuid !== undefined) {
          const srUuid: string | undefined =
            data.lookups.vdiUuidToSrUuid.get(vdiUuid);

          if (srUuid !== undefined) {
            const srInfo:
              | { name_label: string; SR_type: string }
              | undefined = data.lookups.srs.get(srUuid);

            if (srInfo) {
              if (srInfo.name_label !== "") {
                labels["sr_name"] = srInfo.name_label;
              }

              if (srInfo.SR_type !== "") {
                labels["sr_type"] = srInfo.SR_type;
              }
            }
          }
        }
      }

      if (extracted["vif"] !== undefined) {
        const networkName: string | undefined =
          vmInfo.vifIndexToNetworkName[extracted["vif"]];

        if (networkName) {
          labels["network_name"] = networkName;
        }
      }
    }
  }

  Object.assign(labels, extracted);
  addTagsLabel(labels, objectTags);

  return {
    name: `xcp_${definition.openMetricName}`,
    help: definition.help,
    type: definition.type,
    labels: labels,
    value: value,
    timestamp: data.timestamp,
  };
}

function computeVmCpuUsageFallback(
  metrics: Array<FormattedMetric>,
): Array<FormattedMetric> {
  const withCpuUsage: Set<string> = new Set();
  const cores: Map<
    string,
    Map<number, Map<string, { value: number; metric: FormattedMetric }>>
  > = new Map();

  for (const metric of metrics) {
    const vmUuid: string | undefined = metric.labels["uuid"];

    if (metric.labels["type"] !== "vm" || vmUuid === undefined) {
      continue;
    }

    if (metric.name === "xcp_vm_cpu_usage") {
      withCpuUsage.add(vmUuid);
    } else if (
      metric.name === "xcp_vm_cpu_core_usage" &&
      metric.labels["core"] !== undefined
    ) {
      let byTime:
        | Map<number, Map<string, { value: number; metric: FormattedMetric }>>
        | undefined = cores.get(vmUuid);

      if (!byTime) {
        byTime = new Map();
        cores.set(vmUuid, byTime);
      }

      const time: number = metric.timestamp ?? 0;
      let values:
        | Map<string, { value: number; metric: FormattedMetric }>
        | undefined = byTime.get(time);

      if (!values) {
        values = new Map();
        byTime.set(time, values);
      }

      values.set(metric.labels["core"], { value: metric.value, metric });
    }
  }

  const synthetic: Array<FormattedMetric> = [];

  for (const [vmUuid, byTime] of cores) {
    if (withCpuUsage.has(vmUuid)) {
      continue;
    }

    for (const [time, values] of byTime) {
      if (values.size === 0) {
        continue;
      }

      let sum: number = 0;
      for (const { value } of values.values()) {
        sum += value;
      }

      const [sample] = values.values();

      if (!sample) {
        continue;
      }

      const labels: Record<string, string> = {};
      for (const [key, value] of Object.entries(sample.metric.labels)) {
        if (key !== "core") {
          labels[key] = value;
        }
      }

      synthetic.push({
        name: "xcp_vm_cpu_usage",
        help: "VM CPU usage ratio (computed from per-core average)",
        type: "gauge",
        labels: labels,
        value: sum / values.size,
        timestamp: time,
      });
    }
  }

  return synthetic;
}

const PER_RESOURCE_LABELS: ReadonlySet<string> = new Set<string>([
  "core",
  "device",
  "vdi_name",
  "sr_name",
  "sr_type",
  "vif",
  "network_name",
  "interface",
]);

function computeVmPowerConsumption(
  metrics: Array<FormattedMetric>,
  lookups: LabelLookupData,
): Array<FormattedMetric> {
  const hostPower: Map<string, { watts: number; timestamp: number | null }> =
    new Map();
  const guestsByHost: Map<string, Map<string, FormattedMetric>> = new Map();
  const cpuByVm: Map<string, { value: number; timestamp: number | null }> =
    new Map();

  for (const metric of metrics) {
    const { labels } = metric;
    const uuid: string | undefined = labels["uuid"];

    if (uuid === undefined) {
      continue;
    }

    if (
      labels["type"] === "host" &&
      metric.name === "xcp_host_power_consumption_watts"
    ) {
      hostPower.set(uuid, { watts: metric.value, timestamp: metric.timestamp });
      continue;
    }

    if (labels["type"] !== "vm") {
      continue;
    }

    const hostId: string | undefined = labels["host_id"];

    if (!hostId || labels["is_control_domain"] === "true") {
      continue;
    }

    let guests: Map<string, FormattedMetric> | undefined =
      guestsByHost.get(hostId);

    if (!guests) {
      guests = new Map();
      guestsByHost.set(hostId, guests);
    }

    if (!guests.has(uuid)) {
      guests.set(uuid, metric);
    }

    if (metric.name === "xcp_vm_cpu_usage") {
      cpuByVm.set(uuid, { value: metric.value, timestamp: metric.timestamp });
    }
  }

  const out: Array<FormattedMetric> = [];

  for (const [hostId, power] of hostPower) {
    const guests: Map<string, FormattedMetric> | undefined =
      guestsByHost.get(hostId);

    if (!guests || guests.size === 0) {
      continue;
    }

    const loads: Map<string, { load: number; complete: boolean }> = new Map();
    let totalLoad: number = 0;

    for (const vmUuid of guests.keys()) {
      const cpu: number | undefined = cpuByVm.get(vmUuid)?.value;
      const vcpus: number = lookups.vms.get(vmUuid)?.vcpus ?? 1;
      const load: number = (cpu ?? 0) * vcpus;
      loads.set(vmUuid, { load, complete: cpu !== undefined });
      totalLoad += load;
    }

    const equalSplit: boolean = totalLoad < 0.01;

    for (const [vmUuid, representative] of guests) {
      const entry: { load: number; complete: boolean } | undefined =
        loads.get(vmUuid);
      const load: number = entry?.load ?? 0;
      const watts: number = equalSplit
        ? power.watts / guests.size
        : (power.watts * load) / totalLoad;

      const labels: Record<string, string> = {};
      for (const [key, value] of Object.entries(representative.labels)) {
        if (!PER_RESOURCE_LABELS.has(key)) {
          labels[key] = value;
        }
      }

      labels["estimate"] = "true";

      if (entry?.complete === false) {
        labels["data_complete"] = "false";
      }

      out.push({
        name: "xcp_vm_power_consumption_watts",
        help: "Estimated VM power consumption in watts (estimate, host power split by CPU load)",
        type: "gauge",
        labels: labels,
        value: watts,
        timestamp: cpuByVm.get(vmUuid)?.timestamp ?? power.timestamp,
      });
    }
  }

  return out;
}

function sortLikeThePlugin(metrics: Array<FormattedMetric>): void {
  metrics.sort((left: FormattedMetric, right: FormattedMetric): number => {
    if (left.name !== right.name) {
      return left.name.localeCompare(right.name);
    }

    return JSON.stringify(left.labels).localeCompare(
      JSON.stringify(right.labels),
    );
  });
}

/*
 * Every series the plugin would serve for the pool, in the order and with
 * the HELP it would serve them in.
 */
export function buildXapiFormattedMetrics(
  snapshot: XapiPoolSnapshot,
): Array<FormattedMetric> {
  const pool: { poolId: string; poolName: string } = getXoPoolName(snapshot);

  if (!pool.poolId) {
    return [];
  }

  const lookups: LabelLookupData = buildLabelLookups(snapshot, pool);
  const now: number = Math.floor(snapshot.nowSeconds);
  const all: Array<FormattedMetric> = [];

  // xcp_pool_connected: the pool is connected - its master answered.
  all.push({
    name: "xcp_pool_connected",
    help: "Indicates if a pool is connected (1) or not (0)",
    type: "gauge",
    labels: { pool_id: pool.poolId, pool_name: pool.poolName },
    value: 1,
    timestamp: null,
  });

  // The RRD series of every host that answered, and of its VMs.
  const rrdMetrics: Array<FormattedMetric> = [];

  for (const rrd of snapshot.rrds) {
    let parsed: ReturnType<typeof parseRrdText>;

    try {
      parsed = parseRrdText(rrd.text);
    } catch {
      continue;
    }

    const latest: { t: number; values: Array<unknown> } | undefined =
      parsed.data[parsed.data.length - 1];

    if (!latest) {
      continue;
    }

    for (let index: number = 0; index < parsed.meta.legend.length; index++) {
      const legend: ParsedLegend | null = parseRrdLegend(
        parsed.meta.legend[index]!,
      );

      if (!legend) {
        continue;
      }

      const value: number | null = parseRrdNumber(latest.values[index]);

      if (value === null) {
        continue;
      }

      const metric: FormattedMetric | null = transformRrdMetric({
        legend: legend,
        value: value,
        timestamp: latest.t,
        poolId: pool.poolId,
        poolLabel: pool.poolName,
        hostId: rrd.hostUuid,
        lookups: lookups,
      });

      if (metric) {
        rrdMetrics.push(metric);
      }
    }
  }

  rrdMetrics.push(...computeVmCpuUsageFallback(rrdMetrics));
  rrdMetrics.push(...computeVmPowerConsumption(rrdMetrics, lookups));
  sortLikeThePlugin(rrdMetrics);
  all.push(...rrdMetrics);

  // The storage repositories (#getSrData, formatSrMetrics).
  const hostUuidByRef: Map<string, string> = new Map();
  const hostNameByUuid: Map<string, string> = new Map();
  for (const [ref, host] of Object.entries(snapshot.hosts)) {
    hostUuidByRef.set(ref, host.uuid);
    hostNameByUuid.set(host.uuid, host.name_label);
  }

  for (const srRecord of Object.values(snapshot.srs)) {
    const labels: Record<string, string> = {
      pool_id: pool.poolId,
      sr_uuid: srRecord.uuid,
      sr_name: srRecord.name_label,
    };

    if (pool.poolName !== "") {
      labels["pool_name"] = pool.poolName;
    }

    labels["content_type"] = srRecord.content_type;

    if (srRecord.type) {
      labels["sr_type"] = srRecord.type;
    }

    // A local SR: its container is its first PBD's host.
    const firstPbd: XapiPbdRecord | undefined = srRecord.PBDs?.[0]
      ? snapshot.pbds[srRecord.PBDs[0]]
      : undefined;
    const containerHostUuid: string | undefined =
      !srRecord.shared && firstPbd ? hostUuidByRef.get(firstPbd.host) : undefined;

    if (containerHostUuid !== undefined) {
      labels["host_id"] = containerHostUuid;
      const hostName: string | undefined = hostNameByUuid.get(containerHostUuid);

      if (hostName !== undefined) {
        labels["host_name"] = hostName;
      }
    }

    addTagsLabel(labels, srRecord.tags);

    all.push(
      {
        name: "xcp_sr_virtual_size_bytes",
        help: "SR virtual allocated size in bytes",
        type: "gauge",
        labels: { ...labels },
        value: toNumber(srRecord.virtual_allocation),
        timestamp: now,
      },
      {
        name: "xcp_sr_physical_size_bytes",
        help: "SR physical size in bytes",
        type: "gauge",
        labels: { ...labels },
        value: toNumber(srRecord.physical_size),
        timestamp: now,
      },
      {
        name: "xcp_sr_physical_usage_bytes",
        help: "SR physical space used in bytes",
        type: "gauge",
        labels: { ...labels },
        value: toNumber(srRecord.physical_utilisation),
        timestamp: now,
      },
    );
  }

  // The virtual disks (#getVdiData, formatVdiMetrics).
  const plainVmByRef: Map<string, XapiVmRecord> = new Map();
  for (const [ref, vm] of Object.entries(snapshot.vms)) {
    if (getVmType(vm, snapshot.vms) === "VM") {
      plainVmByRef.set(ref, vm);
    }
  }

  for (const vdi of Object.values(snapshot.vdis)) {
    if (!isPlainVdi(vdi, snapshot.vdis)) {
      continue;
    }

    const srRecord: XapiSrRecord | undefined = snapshot.srs[vdi.SR];

    if (!srRecord) {
      continue;
    }

    const labels: Record<string, string> = {
      pool_id: pool.poolId,
      sr_uuid: srRecord.uuid,
      sr_name: srRecord.name_label,
      vdi_uuid: vdi.uuid,
      vdi_name: vdi.name_label,
    };

    if (pool.poolName !== "") {
      labels["pool_name"] = pool.poolName;
    }

    if (srRecord.type) {
      labels["sr_type"] = srRecord.type;
    }

    for (const vbdRef of vdi.VBDs || []) {
      const vbd: XapiVbdRecord | undefined = snapshot.vbds[vbdRef];
      const vm: XapiVmRecord | undefined = vbd ? plainVmByRef.get(vbd.VM) : undefined;

      if (vm) {
        labels["vm_uuid"] = vm.uuid;
        labels["vm_name"] = vm.name_label;
        break;
      }
    }

    all.push(
      {
        name: "xcp_vdi_virtual_size_bytes",
        help: "VDI virtual size in bytes",
        type: "gauge",
        labels: { ...labels },
        value: toNumber(vdi.virtual_size),
        timestamp: now,
      },
      {
        name: "xcp_vdi_physical_usage_bytes",
        help: "VDI physical space used in bytes (allocated on SR)",
        type: "gauge",
        labels: { ...labels },
        value: toNumber(vdi.physical_utilisation),
        timestamp: now,
      },
    );
  }

  // Every host's status (#getHostStatusData, formatHostStatusMetrics).
  for (const host of Object.values(snapshot.hosts)) {
    const labels: Record<string, string> = {
      pool_id: pool.poolId,
      uuid: host.uuid,
      host_name: host.name_label,
      power_state: getHostPowerState(host, snapshot.hostMetrics),
      enabled: String(Boolean(host.enabled)),
    };

    if (pool.poolName !== "") {
      labels["pool_name"] = pool.poolName;
    }

    addTagsLabel(labels, host.tags);

    all.push({
      name: "xcp_host_status",
      help: "Host status (1 = current state)",
      type: "gauge",
      labels: labels,
      value: 1,
      timestamp: now,
    });
  }

  // Every host's uptime (formatHostUptimeMetrics).
  for (const host of Object.values(snapshot.hosts)) {
    const hostInfo: HostLabelInfo | undefined = lookups.hosts.get(host.uuid);

    if (!hostInfo || hostInfo.startTime === null) {
      continue;
    }

    const labels: Record<string, string> = {
      pool_id: pool.poolId,
      uuid: host.uuid,
    };

    if (pool.poolName !== "") {
      labels["pool_name"] = pool.poolName;
    }

    if (hostInfo.name_label !== "") {
      labels["host_name"] = hostInfo.name_label;
    }

    addTagsLabel(labels, hostInfo.tags);

    all.push({
      name: "xcp_host_uptime_seconds",
      help: "Host uptime in seconds since boot",
      type: "gauge",
      labels: labels,
      value: now - hostInfo.startTime,
      timestamp: now,
    });
  }

  // Every VM's status (#getVmStatusData): VMs, not control domains.
  for (const vm of plainVmByRef.values()) {
    const labels: Record<string, string> = {
      pool_id: pool.poolId,
      uuid: vm.uuid,
      power_state: vm.power_state,
    };

    if (pool.poolName !== "") {
      labels["pool_name"] = pool.poolName;
    }

    if (vm.name_label !== "") {
      labels["vm_name"] = vm.name_label;
    }

    addTagsLabel(labels, vm.tags);

    all.push({
      name: "xcp_vm_status",
      help: "VM power state indicator (always 1; current state is carried by the power_state label)",
      type: "gauge",
      labels: labels,
      value: 1,
      timestamp: now,
    });
  }

  // A running VM's uptime (formatVmUptimeMetrics).
  for (const [vmUuid, vmInfo] of lookups.vms) {
    if (
      vmInfo.is_control_domain ||
      vmInfo.power_state !== "Running" ||
      vmInfo.startTime === null
    ) {
      continue;
    }

    const labels: Record<string, string> = {
      pool_id: vmInfo.pool_id,
      uuid: vmUuid,
    };

    if (vmInfo.pool_name !== "") {
      labels["pool_name"] = vmInfo.pool_name;
    }

    if (vmInfo.name_label !== "") {
      labels["vm_name"] = vmInfo.name_label;
    }

    addTagsLabel(labels, vmInfo.tags);

    all.push({
      name: "xcp_vm_uptime_seconds",
      help: "VM uptime in seconds since boot",
      type: "gauge",
      labels: labels,
      value: Math.max(0, now - vmInfo.startTime),
      timestamp: now,
    });
  }

  return all;
}

/*
 * The formatted metrics as the samples an OpenMetrics reader would read
 * from the plugin's answer: each family's HELP and TYPE its first sample's,
 * an empty label left out (formatLabels).
 */
export function toOpenMetricsSamples(
  metrics: Array<FormattedMetric>,
): Array<OpenMetricsSample> {
  const families: Map<string, { help: string; type: OpenMetricsType }> =
    new Map();

  for (const metric of metrics) {
    if (!families.has(metric.name)) {
      families.set(metric.name, { help: metric.help, type: metric.type });
    }
  }

  return metrics.map((metric: FormattedMetric): OpenMetricsSample => {
    const family: { help: string; type: OpenMetricsType } = families.get(
      metric.name,
    )!;

    return {
      name: metric.name,
      family: metric.name,
      type: family.type,
      help: family.help,
      labels: Object.entries(metric.labels).filter(
        ([, value]: [string, string]): boolean => {
          return value !== undefined && value !== "";
        },
      ),
      value: metric.value,
      timestampSeconds: metric.timestamp,
    };
  });
}
