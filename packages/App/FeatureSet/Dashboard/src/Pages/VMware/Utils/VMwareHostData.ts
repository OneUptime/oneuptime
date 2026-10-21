import VMwareResourceModel from "Common/Models/DatabaseModels/VMwareResource";
import Metric from "Common/Models/AnalyticsModels/Metric";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What an ESXi host's page reads and works out, free of React so the page,
 * its tests and the App suite share one answer.
 *
 * Everything here comes from what vCenter already reports for the host -
 * through the VMware agent's vcenter receiver or a probe, which send the
 * same metrics:
 *
 *   - the host's inventory row (VMwareResource, kind Host): its name, where
 *     it sits, its latest CPU and memory reading and capacity, and when
 *     vCenter last reported it;
 *   - the inventory rows of the virtual machines it runs (kind
 *     VirtualMachine, hostName = this host);
 *   - the vcenter.host.* metrics in ClickHouse, per network adapter and per
 *     storage device for the performance counters.
 *
 * ESXi itself runs no agent, so nothing here reads the host's own operating
 * system: there are no processes, filesystems or load average to show. The
 * virtual machines are what keeps a hypervisor busy, its physical network
 * adapters and storage devices are its hardware, and its logs come as
 * syslog (VMwareHostSyslog).
 */

/*
 * A host whose newest metrics are older than this is "Not reporting". The
 * list pages hide CPU and memory older than the same 15 minutes
 * (VMwareResourceUtils.METRIC_STALE_MS re-exports this), and the cleanup
 * worker prunes inventory rows on the same cut-off.
 */
export const VMWARE_METRIC_STALE_MS: number = 15 * 60 * 1000;

/*
 * The tiles read the newest few minutes of the selected range, the way the
 * host overview outside VMware does: what the host is doing now, even when
 * the charts show a week.
 */
export const VMWARE_HOST_TILE_WINDOW_MINUTES: number = 5;

// How many running virtual machines the Busiest list names.
export const VMWARE_HOST_BUSIEST_VM_LIMIT: number = 5;

// The receiver reports host network and disk throughput in KiB/s.
const KIB: number = 1024;

/*
 * Above this a host's storage is slow enough to notice from inside the
 * VMs, and the latency tile and the device table turn amber; at the alert
 * template's 50 ms (vmware-host-disk-latency-high) they turn red.
 */
export const VMWARE_DISK_LATENCY_WARN_MS: number = 20;
export const VMWARE_DISK_LATENCY_DANGER_MS: number = 50;

// ---- Which host --------------------------------------------------------------

/*
 * An ESXi host as its metrics name it: the vCenter's name (the agent's or
 * probe's vmware.vcenter.name), the datacenter and the host name vCenter
 * knows it by. The datacenter is part of it - two datacenters of one vCenter
 * may hold hosts of the same name - and is left out only when nothing names
 * it.
 */
export interface VMwareHostIdentity {
  vcenterName: string;
  datacenterName: string;
  hostName: string;
}

/*
 * A host's inventory id is "host/<datacenter>/<host>". A host name never
 * holds a "/" (it is a DNS name or an address), a datacenter name may, so
 * the host is what follows the last "/" and the datacenter what sits
 * between the first and the last. Anything else gives the whole id as the
 * host name.
 */
export function parseVMwareHostExternalId(externalId: string): {
  datacenterName: string;
  hostName: string;
} {
  const id: string = externalId || "";
  const prefix: string = "host/";

  if (!id.startsWith(prefix)) {
    return { datacenterName: "", hostName: id };
  }

  const rest: string = id.substring(prefix.length);
  const lastSlash: number = rest.lastIndexOf("/");

  if (lastSlash < 0) {
    return { datacenterName: "", hostName: rest };
  }

  return {
    datacenterName: rest.substring(0, lastSlash),
    hostName: rest.substring(lastSlash + 1),
  };
}

/*
 * The host's identity from its inventory row, or - before the row loads,
 * or once vCenter no longer reports the host - from its inventory id.
 */
export function getVMwareHostIdentity(data: {
  vcenterName: string;
  externalId: string;
  row: VMwareResourceModel | null | undefined;
}): VMwareHostIdentity {
  const parsed: { datacenterName: string; hostName: string } =
    parseVMwareHostExternalId(data.externalId);

  return {
    vcenterName: data.vcenterName,
    datacenterName: data.row?.datacenterName || parsed.datacenterName,
    hostName: data.row?.hostName || data.row?.name || parsed.hostName,
  };
}

/*
 * The attribute filter that pins a metric read to this host's own series:
 * the vcenter receiver keys identity in RESOURCE attributes, stored
 * `resource.`-prefixed (VMwareResourceUtils.identityAttributesForResource
 * builds the same filter for the Metrics tab).
 */
export function getVMwareHostMetricAttributes(
  identity: VMwareHostIdentity,
): Record<string, string> {
  const attributes: Record<string, string> = {
    "resource.vmware.vcenter.name": identity.vcenterName,
  };

  if (identity.datacenterName) {
    attributes["resource.vcenter.datacenter.name"] = identity.datacenterName;
  }

  attributes["resource.vcenter.host.name"] = identity.hostName;

  return attributes;
}

// ---- Is vCenter still reporting it -------------------------------------------

export enum VMwareHostReportState {
  // vCenter reported the host in the last 15 minutes.
  Reporting = "Reporting",
  // The host is in the inventory, but its newest data is older than that.
  NotReporting = "NotReporting",
  // The host is in the inventory, but no metrics arrived for it yet.
  NoDataYet = "NoDataYet",
  // No inventory row: removed from vCenter, or never collected.
  NotInInventory = "NotInInventory",
}

type DateLike = Date | string | number | null | undefined;

function toTime(value: DateLike): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const time: number = new Date(value as Date).getTime();

  return Number.isFinite(time) ? time : null;
}

/*
 * When vCenter last reported this host's numbers: the newest metrics, or -
 * for a host whose metrics never arrived - when it was last seen in the
 * inventory at all.
 */
export function getVMwareHostLastReportAt(
  row: VMwareResourceModel | null | undefined,
): Date | null {
  if (!row) {
    return null;
  }

  const metricsTime: number | null = toTime(row.metricsUpdatedAt as DateLike);

  if (metricsTime !== null) {
    return new Date(metricsTime);
  }

  const seenTime: number | null = toTime(row.lastSeenAt as DateLike);

  return seenTime === null ? null : new Date(seenTime);
}

export function getVMwareHostReportState(data: {
  row: VMwareResourceModel | null | undefined;
  now: Date;
}): VMwareHostReportState {
  if (!data.row) {
    return VMwareHostReportState.NotInInventory;
  }

  const metricsTime: number | null = toTime(
    data.row.metricsUpdatedAt as DateLike,
  );

  if (metricsTime === null) {
    return VMwareHostReportState.NoDataYet;
  }

  return data.now.getTime() - metricsTime <= VMWARE_METRIC_STALE_MS
    ? VMwareHostReportState.Reporting
    : VMwareHostReportState.NotReporting;
}

export type VMwareHostStatusTone = "positive" | "warning" | "neutral";

export interface VMwareHostReportStateLook {
  label: string;
  tone: VMwareHostStatusTone;
  // What the pill means, read out on hover and by screen readers.
  description: string;
}

const REPORT_STATE_LOOKS: Record<
  VMwareHostReportState,
  VMwareHostReportStateLook
> = {
  [VMwareHostReportState.Reporting]: {
    label: translationKey("Reporting"),
    tone: "positive",
    description: translationKey(
      "vCenter reported this host's metrics in the last 15 minutes.",
    ),
  },
  [VMwareHostReportState.NotReporting]: {
    label: translationKey("Not reporting"),
    tone: "warning",
    description: translationKey(
      "vCenter has sent no metrics for this host for more than 15 minutes.",
    ),
  },
  [VMwareHostReportState.NoDataYet]: {
    label: translationKey("No data yet"),
    tone: "neutral",
    description: translationKey(
      "vCenter lists this host, but has sent no metrics for it yet.",
    ),
  },
  [VMwareHostReportState.NotInInventory]: {
    label: translationKey("Not in inventory"),
    tone: "neutral",
    description: translationKey(
      "This host is not in the vCenter's inventory any more.",
    ),
  },
};

export function getVMwareHostReportStateLook(
  state: VMwareHostReportState,
): VMwareHostReportStateLook {
  return REPORT_STATE_LOOKS[state];
}

/*
 * Whether a row's latest reading is recent enough to show as live (the
 * lists' rule). Takes `now` so tests and the page agree on one clock.
 */
export function hasFreshVMwareMetrics(
  row: VMwareResourceModel,
  now: Date,
): boolean {
  const metricsTime: number | null = toTime(row.metricsUpdatedAt as DateLike);

  if (metricsTime === null) {
    return false;
  }

  return now.getTime() - metricsTime <= VMWARE_METRIC_STALE_MS;
}

export function toFiniteNumber(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number: number = Number(value);

  return Number.isFinite(number) ? number : null;
}

// ---- Virtual machines on the host -----------------------------------------

export interface VMwareHostVirtualMachineSummary {
  // Virtual machines, templates left out.
  total: number;
  running: number;
  poweredOff: number;
  // Not collected with a power state yet.
  unknown: number;
  templates: number;
}

export function summarizeVMwareHostVirtualMachines(
  rows: Array<VMwareResourceModel>,
): VMwareHostVirtualMachineSummary {
  const summary: VMwareHostVirtualMachineSummary = {
    total: 0,
    running: 0,
    poweredOff: 0,
    unknown: 0,
    templates: 0,
  };

  for (const row of rows) {
    if (row.isTemplate) {
      summary.templates++;
      continue;
    }

    summary.total++;

    if (row.isPoweredOn === true) {
      summary.running++;
    } else if (row.isPoweredOn === false) {
      summary.poweredOff++;
    } else {
      summary.unknown++;
    }
  }

  return summary;
}

export interface VMwareBusyVirtualMachine {
  externalId: string;
  name: string;
  cpuPercent: number;
  cpuMhz: number | null;
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
  cpuReadyPercent: number | null;
}

function displayName(row: VMwareResourceModel): string {
  if (row.name) {
    return row.name;
  }

  const externalId: string = row.externalId || "";

  return externalId.substring(externalId.lastIndexOf("/") + 1);
}

/*
 * The running virtual machines using the most CPU right now: powered on,
 * with a CPU reading from the last 15 minutes, busiest first. A tie goes to
 * the name, so the list does not reshuffle between refreshes.
 */
export function getBusiestVMwareVirtualMachines(data: {
  rows: Array<VMwareResourceModel>;
  now: Date;
  limit: number;
}): Array<VMwareBusyVirtualMachine> {
  const busy: Array<VMwareBusyVirtualMachine> = [];

  for (const row of data.rows) {
    if (row.isTemplate || row.isPoweredOn !== true) {
      continue;
    }

    if (!hasFreshVMwareMetrics(row, data.now)) {
      continue;
    }

    const cpuPercent: number | null = toFiniteNumber(row.latestCpuPercent);

    if (cpuPercent === null) {
      continue;
    }

    busy.push({
      externalId: row.externalId || "",
      name: displayName(row),
      cpuPercent: cpuPercent,
      cpuMhz: toFiniteNumber(row.latestCpuMhz),
      memoryBytes: toFiniteNumber(row.latestMemoryBytes),
      memoryLimitBytes: toFiniteNumber(row.maxMemoryBytes),
      cpuReadyPercent: toFiniteNumber(row.cpuReadinessPercent),
    });
  }

  busy.sort(
    (a: VMwareBusyVirtualMachine, b: VMwareBusyVirtualMachine): number => {
      if (b.cpuPercent !== a.cpuPercent) {
        return b.cpuPercent - a.cpuPercent;
      }

      return a.name.localeCompare(b.name);
    },
  );

  return busy.slice(0, Math.max(0, data.limit));
}

// ---- The metrics the Overview reads ------------------------------------------

export enum VMwareHostMetric {
  CpuUtilization = "cpuUtilization",
  MemoryUtilization = "memoryUtilization",
  NetworkThroughput = "networkThroughput",
  NetworkPacketRate = "networkPacketRate",
  NetworkPacketErrorRate = "networkPacketErrorRate",
  NetworkPacketDropRate = "networkPacketDropRate",
  DiskThroughput = "diskThroughput",
  DiskLatencyAverage = "diskLatencyAverage",
  DiskLatencyHighest = "diskLatencyHighest",
}

export interface VMwareHostMetricRead {
  metricName: string;
  aggregationType: AggregationType;
  /*
   * Read per network adapter or storage device (the `object` datapoint
   * attribute) and per `direction`, rather than as one host-wide line.
   */
  perDevice: boolean;
}

/*
 * Every metric the Overview reads, and how: utilization is already a
 * percentage, throughput a rate (KiB/s), the packet counts rates per
 * second, latency milliseconds - plain gauges, so no counter or ratio
 * transform anywhere. "Highest" latency is the worst of any disk in a
 * bucket (Max), as the Host Disk Latency High alert reads it.
 */
export const VMWARE_HOST_OVERVIEW_METRICS: Record<
  VMwareHostMetric,
  VMwareHostMetricRead
> = {
  [VMwareHostMetric.CpuUtilization]: {
    metricName: "vcenter.host.cpu.utilization",
    aggregationType: AggregationType.Avg,
    perDevice: false,
  },
  [VMwareHostMetric.MemoryUtilization]: {
    metricName: "vcenter.host.memory.utilization",
    aggregationType: AggregationType.Avg,
    perDevice: false,
  },
  [VMwareHostMetric.NetworkThroughput]: {
    metricName: "vcenter.host.network.throughput",
    aggregationType: AggregationType.Avg,
    perDevice: true,
  },
  [VMwareHostMetric.NetworkPacketRate]: {
    metricName: "vcenter.host.network.packet.rate",
    aggregationType: AggregationType.Avg,
    perDevice: true,
  },
  [VMwareHostMetric.NetworkPacketErrorRate]: {
    metricName: "vcenter.host.network.packet.error.rate",
    aggregationType: AggregationType.Avg,
    perDevice: true,
  },
  [VMwareHostMetric.NetworkPacketDropRate]: {
    metricName: "vcenter.host.network.packet.drop.rate",
    aggregationType: AggregationType.Avg,
    perDevice: true,
  },
  [VMwareHostMetric.DiskThroughput]: {
    metricName: "vcenter.host.disk.throughput",
    aggregationType: AggregationType.Avg,
    perDevice: true,
  },
  [VMwareHostMetric.DiskLatencyAverage]: {
    metricName: "vcenter.host.disk.latency.avg",
    aggregationType: AggregationType.Avg,
    perDevice: true,
  },
  [VMwareHostMetric.DiskLatencyHighest]: {
    metricName: "vcenter.host.disk.latency.max",
    aggregationType: AggregationType.Max,
    perDevice: true,
  },
};

// The datapoint attributes a per-device read is grouped by.
export const VMWARE_HOST_DEVICE_GROUP_KEYS: ReadonlyArray<string> = [
  "object",
  "direction",
];

/*
 * One aggregate read of one of the host's metrics over the selected
 * window, bucketed by time. A per-device read is grouped on the device and
 * the direction only (groupByAttributeKeys), so each row says which NIC or
 * disk it is about without the rest of the attribute map.
 */
export function buildVMwareHostAggregateBy(data: {
  projectId: string;
  identity: VMwareHostIdentity;
  read: VMwareHostMetricRead;
  start: Date;
  end: Date;
}): AggregateBy<Metric> {
  const aggregateBy: AggregateBy<Metric> = {
    query: {
      projectId: data.projectId,
      time: new InBetween<Date>(data.start, data.end),
      name: data.read.metricName,
      attributes: getVMwareHostMetricAttributes(data.identity),
    } as AggregateBy<Metric>["query"],
    aggregationType: data.read.aggregationType,
    aggregateColumnName: "value",
    aggregationTimestampColumnName: "time",
    startTimestamp: data.start,
    endTimestamp: data.end,
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    sort: {
      time: SortOrder.Descending,
    },
  };

  if (data.read.perDevice) {
    aggregateBy.groupByAttributeKeys = [...VMWARE_HOST_DEVICE_GROUP_KEYS];
  }

  return aggregateBy;
}

// ---- Metric samples -------------------------------------------------------

export interface TimeValuePoint {
  x: Date;
  y: number;
}

/*
 * One metric value of one bucket, with the datapoint attributes the
 * aggregate was grouped by: `object` (the NIC or disk) and `direction`.
 */
export interface VMwareMetricSample {
  time: number;
  object: string;
  direction: string;
  value: number;
}

function getBucketTime(point: AggregatedModel): number {
  /*
   * The aggregate's bucket time is on `timestamp`; a path that aliases the
   * time column reads it as `time`. Read whichever is there.
   */
  const raw: unknown =
    point["timestamp"] !== undefined ? point["timestamp"] : point["time"];

  if (raw instanceof Date) {
    return raw.getTime();
  }

  if (typeof raw === "string" || typeof raw === "number") {
    return new Date(raw).getTime();
  }

  return NaN;
}

function readAttribute(
  attributes: Record<string, unknown>,
  key: string,
): string {
  const value: unknown = attributes[key];

  if (value === null || value === undefined || typeof value === "object") {
    return "";
  }

  return String(value);
}

export function readVMwareMetricSamples(
  result: AggregatedResult | null | undefined,
): Array<VMwareMetricSample> {
  const samples: Array<VMwareMetricSample> = [];

  for (const point of (result?.data || []) as Array<AggregatedModel>) {
    const time: number = getBucketTime(point);
    const value: number = Number(point["value"]);

    if (!Number.isFinite(time) || !Number.isFinite(value)) {
      continue;
    }

    const rawAttributes: unknown = point["attributes"];
    const attributes: Record<string, unknown> =
      rawAttributes &&
      typeof rawAttributes === "object" &&
      !Array.isArray(rawAttributes)
        ? (rawAttributes as Record<string, unknown>)
        : {};

    samples.push({
      time: time,
      object: readAttribute(attributes, "object").trim(),
      direction: readAttribute(attributes, "direction").trim(),
      value: value,
    });
  }

  return samples;
}

/*
 * vCenter's performance counters come per device and, for most of them, as
 * a whole-host total as well: the instance "" (the vSphere simulator says
 * "*"). The total is not a device, so it never gets a row of its own in the
 * adapter and device tables, and it is the host's number when it is there.
 */
export function isVMwareHostTotalObject(object: string): boolean {
  const trimmed: string = (object || "").trim();

  return trimmed === "" || trimmed === "*";
}

/*
 * A host-wide series of one metric: per bucket, the whole-host total when
 * vCenter sent one, otherwise the per-device values added up (or, with
 * `combine: "max"`, the highest of them - for the worst disk's latency).
 * `direction` keeps one direction only; null takes them all.
 */
export function getVMwareHostSeries(data: {
  samples: Array<VMwareMetricSample>;
  direction?: string | null | undefined;
  combine?: "sum" | "max" | undefined;
  scale?: number | undefined;
}): Array<TimeValuePoint> {
  const combine: "sum" | "max" = data.combine || "sum";
  const scale: number = data.scale === undefined ? 1 : data.scale;

  interface Bucket {
    total: number | null;
    devices: number | null;
  }

  const buckets: Map<number, Bucket> = new Map<number, Bucket>();

  const merge: (current: number | null, value: number) => number = (
    current: number | null,
    value: number,
  ): number => {
    if (current === null) {
      return value;
    }

    return combine === "max" ? Math.max(current, value) : current + value;
  };

  for (const sample of data.samples) {
    if (
      data.direction !== undefined &&
      data.direction !== null &&
      sample.direction !== data.direction
    ) {
      continue;
    }

    let bucket: Bucket | undefined = buckets.get(sample.time);

    if (!bucket) {
      bucket = { total: null, devices: null };
      buckets.set(sample.time, bucket);
    }

    if (isVMwareHostTotalObject(sample.object)) {
      bucket.total = merge(bucket.total, sample.value);
    } else {
      bucket.devices = merge(bucket.devices, sample.value);
    }
  }

  const points: Array<TimeValuePoint> = [];

  for (const [time, bucket] of buckets.entries()) {
    const value: number | null =
      bucket.total !== null ? bucket.total : bucket.devices;

    if (value === null) {
      continue;
    }

    points.push({ x: new Date(time), y: value * scale });
  }

  points.sort((a: TimeValuePoint, b: TimeValuePoint): number => {
    return a.x.getTime() - b.x.getTime();
  });

  return points;
}

// Two series added up bucket by bucket (received + sent).
export function sumVMwareSeries(
  first: Array<TimeValuePoint>,
  second: Array<TimeValuePoint>,
): Array<TimeValuePoint> {
  const byTime: Map<number, number> = new Map<number, number>();

  for (const point of [...first, ...second]) {
    const time: number = point.x.getTime();
    byTime.set(time, (byTime.get(time) || 0) + point.y);
  }

  return Array.from(byTime.entries())
    .map(([time, value]: [number, number]): TimeValuePoint => {
      return { x: new Date(time), y: value };
    })
    .sort((a: TimeValuePoint, b: TimeValuePoint): number => {
      return a.x.getTime() - b.x.getTime();
    });
}

/*
 * The tile value: the mean of the buckets that start in the newest few
 * minutes of the range, or of the whole range when none does (ranges over
 * 12 hours have 15-minute buckets; a host that went quiet has none).
 */
export function meanOfRecentWindow(
  points: Array<TimeValuePoint>,
  windowStart: Date,
): number | null {
  return reduceRecentWindow(points, windowStart, "mean");
}

// The tile value of a "worst of" metric: the highest in the same window.
export function maxOfRecentWindow(
  points: Array<TimeValuePoint>,
  windowStart: Date,
): number | null {
  return reduceRecentWindow(points, windowStart, "max");
}

function reduceRecentWindow(
  points: Array<TimeValuePoint>,
  windowStart: Date,
  reduce: "mean" | "max",
): number | null {
  const startTime: number = windowStart.getTime();

  let recent: Array<TimeValuePoint> = points.filter(
    (point: TimeValuePoint): boolean => {
      return point.x.getTime() >= startTime;
    },
  );

  if (recent.length === 0) {
    recent = points;
  }

  if (recent.length === 0) {
    return null;
  }

  if (reduce === "max") {
    let highest: number = -Infinity;

    for (const point of recent) {
      highest = Math.max(highest, point.y);
    }

    return highest;
  }

  let sum: number = 0;

  for (const point of recent) {
    sum += point.y;
  }

  return sum / recent.length;
}

// ---- Network adapters and storage devices -------------------------------

/*
 * Each device's average over the selected range, per direction: how the
 * adapter and device tables read a metric.
 */
function averagePerDevice(
  samples: Array<VMwareMetricSample>,
): Map<string, Map<string, number>> {
  const sums: Map<
    string,
    Map<string, { sum: number; count: number }>
  > = new Map();

  for (const sample of samples) {
    if (isVMwareHostTotalObject(sample.object)) {
      continue;
    }

    let perDirection: Map<string, { sum: number; count: number }> | undefined =
      sums.get(sample.object);

    if (!perDirection) {
      perDirection = new Map();
      sums.set(sample.object, perDirection);
    }

    const entry: { sum: number; count: number } = perDirection.get(
      sample.direction,
    ) || { sum: 0, count: 0 };

    entry.sum += sample.value;
    entry.count++;
    perDirection.set(sample.direction, entry);
  }

  const averages: Map<string, Map<string, number>> = new Map();

  for (const [object, perDirection] of sums.entries()) {
    const values: Map<string, number> = new Map();

    for (const [direction, entry] of perDirection.entries()) {
      values.set(direction, entry.sum / entry.count);
    }

    averages.set(object, values);
  }

  return averages;
}

function sumDirections(
  values: Map<string, number> | undefined,
  directions: Array<string>,
): number | null {
  if (!values) {
    return null;
  }

  let found: boolean = false;
  let sum: number = 0;

  for (const direction of directions) {
    const value: number | undefined = values.get(direction);

    if (value === undefined) {
      continue;
    }

    found = true;
    sum += value;
  }

  return found ? sum : null;
}

/*
 * Every direction a device reported, added up - the packet counters come
 * per direction, and a table cell shows the device's total.
 */
function sumAllDirections(
  values: Map<string, number> | undefined,
): number | null {
  if (!values || values.size === 0) {
    return null;
  }

  let sum: number = 0;

  for (const value of values.values()) {
    sum += value;
  }

  return sum;
}

function compareDeviceNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

export interface VMwareNetworkAdapterRow {
  // The physical NIC as ESXi names it (vmnic0).
  name: string;
  receivedBytesPerSecond: number | null;
  sentBytesPerSecond: number | null;
  packetsPerSecond: number | null;
  errorsPerSecond: number | null;
  dropsPerSecond: number | null;
}

const RECEIVED: string = "received";
const TRANSMITTED: string = "transmitted";

/*
 * One row per physical network adapter the host reported, each value the
 * adapter's average over the selected range. Packets, errors and drops add
 * both directions up.
 */
export function summarizeVMwareNetworkAdapters(data: {
  throughput: Array<VMwareMetricSample>;
  packets: Array<VMwareMetricSample>;
  errors: Array<VMwareMetricSample>;
  drops: Array<VMwareMetricSample>;
}): Array<VMwareNetworkAdapterRow> {
  const throughput: Map<string, Map<string, number>> = averagePerDevice(
    data.throughput,
  );
  const packets: Map<string, Map<string, number>> = averagePerDevice(
    data.packets,
  );
  const errors: Map<string, Map<string, number>> = averagePerDevice(
    data.errors,
  );
  const drops: Map<string, Map<string, number>> = averagePerDevice(data.drops);

  const names: Set<string> = new Set<string>([
    ...throughput.keys(),
    ...packets.keys(),
    ...errors.keys(),
    ...drops.keys(),
  ]);

  return Array.from(names)
    .sort(compareDeviceNames)
    .map((name: string): VMwareNetworkAdapterRow => {
      const received: number | null = sumDirections(throughput.get(name), [
        RECEIVED,
      ]);
      const sent: number | null = sumDirections(throughput.get(name), [
        TRANSMITTED,
      ]);

      return {
        name: name,
        receivedBytesPerSecond: received === null ? null : received * KIB,
        sentBytesPerSecond: sent === null ? null : sent * KIB,
        packetsPerSecond: sumAllDirections(packets.get(name)),
        errorsPerSecond: sumAllDirections(errors.get(name)),
        dropsPerSecond: sumAllDirections(drops.get(name)),
      };
    });
}

export interface VMwareStorageDeviceRow {
  // The device as ESXi names it (naa.600508b1001c4d…).
  name: string;
  readBytesPerSecond: number | null;
  writeBytesPerSecond: number | null;
  readLatencyMs: number | null;
  writeLatencyMs: number | null;
}

const READ: string = "read";
const WRITE: string = "write";

/*
 * One row per storage device the host reported, each value the device's
 * average over the selected range. vCenter reports the highest latency for
 * the whole host only (disk.maxTotalLatency has no per-device instance), so
 * that one is the latency tile and chart, not a column here.
 */
export function summarizeVMwareStorageDevices(data: {
  throughput: Array<VMwareMetricSample>;
  latencyAverage: Array<VMwareMetricSample>;
}): Array<VMwareStorageDeviceRow> {
  const throughput: Map<string, Map<string, number>> = averagePerDevice(
    data.throughput,
  );
  const latency: Map<string, Map<string, number>> = averagePerDevice(
    data.latencyAverage,
  );

  const names: Set<string> = new Set<string>([
    ...throughput.keys(),
    ...latency.keys(),
  ]);

  return Array.from(names)
    .sort(compareDeviceNames)
    .map((name: string): VMwareStorageDeviceRow => {
      const read: number | null = sumDirections(throughput.get(name), [READ]);
      const write: number | null = sumDirections(throughput.get(name), [WRITE]);

      return {
        name: name,
        readBytesPerSecond: read === null ? null : read * KIB,
        writeBytesPerSecond: write === null ? null : write * KIB,
        readLatencyMs: sumDirections(latency.get(name), [READ]),
        writeLatencyMs: sumDirections(latency.get(name), [WRITE]),
      };
    });
}

// ---- Everything the Overview shows, from its reads ---------------------------

export type VMwareHostMetricResults = Partial<
  Record<VMwareHostMetric, AggregatedResult | null | undefined>
>;

export interface VMwareHostOverviewSeries {
  cpuPercent: Array<TimeValuePoint>;
  memoryPercent: Array<TimeValuePoint>;
  // The worst latency of any disk, per bucket (ms).
  highestDiskLatencyMs: Array<TimeValuePoint>;
  networkReceivedBytesPerSecond: Array<TimeValuePoint>;
  networkSentBytesPerSecond: Array<TimeValuePoint>;
}

export interface VMwareHostOverviewTiles {
  cpuPercent: number | null;
  memoryPercent: number | null;
  highestDiskLatencyMs: number | null;
  networkReceivedBytesPerSecond: number | null;
  networkSentBytesPerSecond: number | null;
}

export interface VMwareHostOverviewMetrics {
  series: VMwareHostOverviewSeries;
  tiles: VMwareHostOverviewTiles;
  networkAdapters: Array<VMwareNetworkAdapterRow>;
  storageDevices: Array<VMwareStorageDeviceRow>;
}

/*
 * The Overview's charts, tiles and tables from its reads. A read that
 * failed or found nothing leaves its part empty; the rest still shows.
 */
export function summarizeVMwareHostMetrics(data: {
  results: VMwareHostMetricResults;
  tileWindowStart: Date;
}): VMwareHostOverviewMetrics {
  const samples: (metric: VMwareHostMetric) => Array<VMwareMetricSample> = (
    metric: VMwareHostMetric,
  ): Array<VMwareMetricSample> => {
    return readVMwareMetricSamples(data.results[metric]);
  };

  const networkThroughput: Array<VMwareMetricSample> = samples(
    VMwareHostMetric.NetworkThroughput,
  );
  const diskHighest: Array<VMwareMetricSample> = samples(
    VMwareHostMetric.DiskLatencyHighest,
  );

  const series: VMwareHostOverviewSeries = {
    cpuPercent: getVMwareHostSeries({
      samples: samples(VMwareHostMetric.CpuUtilization),
    }),
    memoryPercent: getVMwareHostSeries({
      samples: samples(VMwareHostMetric.MemoryUtilization),
    }),
    highestDiskLatencyMs: getVMwareHostSeries({
      samples: diskHighest,
      combine: "max",
    }),
    networkReceivedBytesPerSecond: getVMwareHostSeries({
      samples: networkThroughput,
      direction: RECEIVED,
      scale: KIB,
    }),
    networkSentBytesPerSecond: getVMwareHostSeries({
      samples: networkThroughput,
      direction: TRANSMITTED,
      scale: KIB,
    }),
  };

  const tiles: VMwareHostOverviewTiles = {
    cpuPercent: meanOfRecentWindow(series.cpuPercent, data.tileWindowStart),
    memoryPercent: meanOfRecentWindow(
      series.memoryPercent,
      data.tileWindowStart,
    ),
    highestDiskLatencyMs: maxOfRecentWindow(
      series.highestDiskLatencyMs,
      data.tileWindowStart,
    ),
    networkReceivedBytesPerSecond: meanOfRecentWindow(
      series.networkReceivedBytesPerSecond,
      data.tileWindowStart,
    ),
    networkSentBytesPerSecond: meanOfRecentWindow(
      series.networkSentBytesPerSecond,
      data.tileWindowStart,
    ),
  };

  return {
    series: series,
    tiles: tiles,
    networkAdapters: summarizeVMwareNetworkAdapters({
      throughput: networkThroughput,
      packets: samples(VMwareHostMetric.NetworkPacketRate),
      errors: samples(VMwareHostMetric.NetworkPacketErrorRate),
      drops: samples(VMwareHostMetric.NetworkPacketDropRate),
    }),
    storageDevices: summarizeVMwareStorageDevices({
      throughput: samples(VMwareHostMetric.DiskThroughput),
      latencyAverage: samples(VMwareHostMetric.DiskLatencyAverage),
    }),
  };
}

/*
 * How full the latency tile's bar is: the share of the way to the 50 ms the
 * Host Disk Latency High alert fires at, so it turns amber at 20 ms and red
 * at 50 ms like the device table.
 */
export function getVMwareDiskLatencyGaugePercent(
  latencyMs: number | null,
): number | null {
  if (latencyMs === null || !Number.isFinite(latencyMs)) {
    return null;
  }

  return Math.min(
    100,
    Math.max(0, (latencyMs / VMWARE_DISK_LATENCY_DANGER_MS) * 100),
  );
}

export const VMWARE_DISK_LATENCY_GAUGE_THRESHOLDS: {
  warn: number;
  danger: number;
} = {
  warn: (VMWARE_DISK_LATENCY_WARN_MS / VMWARE_DISK_LATENCY_DANGER_MS) * 100,
  danger: 100,
};

// ---- Incidents and alerts about this host --------------------------------

/*
 * The series labels that name an ESXi host: the VMware alert templates
 * group by resource.vcenter.host.name, and a monitor someone built by hand
 * may group by the bare key.
 */
export const VMWARE_HOST_NAME_LABEL_KEYS: ReadonlyArray<string> = [
  "resource.vcenter.host.name",
  "vcenter.host.name",
];

/*
 * Whether an incident's or alert's series labels name this host. A grouped
 * VMware monitor opens one per host that breaches, and its labels are the
 * only place that says which host; names are compared without regard to
 * case or surrounding spaces.
 */
export function seriesLabelsNameVMwareHost(
  seriesLabels: JSONObject | null | undefined,
  hostName: string,
): boolean {
  const wanted: string = (hostName || "").trim().toLowerCase();

  if (!wanted || !seriesLabels || typeof seriesLabels !== "object") {
    return false;
  }

  for (const key of VMWARE_HOST_NAME_LABEL_KEYS) {
    const value: unknown = (seriesLabels as Record<string, unknown>)[key];

    if (typeof value === "string" && value.trim().toLowerCase() === wanted) {
      return true;
    }
  }

  return false;
}

// ---- Formatting -----------------------------------------------------------

/*
 * A rate such as packets or errors per second, for a table cell: "0/s", a
 * small rate with two decimals, a large one in thousands or millions.
 */
export function formatVMwarePerSecond(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  if (value === 0) {
    return "0/s";
  }

  const absolute: number = Math.abs(value);

  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M/s`;
  }

  if (absolute >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K/s`;
  }

  if (absolute >= 10) {
    return `${Math.round(value)}/s`;
  }

  if (absolute >= 0.01) {
    return `${Number(value.toFixed(2))}/s`;
  }

  return "<0.01/s";
}

export function formatVMwareMilliseconds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  if (value >= 100) {
    return `${Math.round(value)} ms`;
  }

  return `${Number(value.toFixed(1))} ms`;
}
