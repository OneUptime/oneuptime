import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";

/*
 * ------------------------------------------------------------------
 * WHAT A HOST REPORTED, READ FROM ONE METRICS BATCH
 * ------------------------------------------------------------------
 *
 * A host's collector sends its hostmetrics scrape - every scraper's
 * readings of one cycle - in one export, and its systemd units in
 * another. The metrics ingest's host enrichment walks each batch once
 * (OtelMetricsIngestService.runBatchHostEnrichment) and keeps, per host,
 * the readings a fleet manager looks at first: how busy the CPU is, how
 * much memory and swap are in use, how full the fullest filesystem is (and
 * which one), how many inodes the most-used filesystem has left, the
 * 15-minute load, when the host started, and which systemd units failed.
 * They are stored on the host's record with its heartbeat (HostService
 * .updateLastSeen), so the Hosts list, its Needs attention card and the
 * host's own page read them from Postgres rather than ClickHouse.
 *
 * Each reading is worked out exactly as the host's Overview works out the
 * number it shows, so the list, the card and the page agree:
 *
 *   - CPU: the mean `user` share plus the mean `system` share of
 *     system.cpu.utilization across the host's CPUs (iowait and steal are
 *     left out), as a percent;
 *   - memory: system.memory.utilization's `used` share (buffers and page
 *     cache not counted), or, when the collector does not send that
 *     optional metric, the `used` share of system.memory.usage;
 *   - swap: system.paging.usage's used bytes over used plus free, across
 *     every swap device - no reading on a host without swap;
 *   - disk: each mount's used bytes over used, free and reserved
 *     (system.filesystem.usage; reserved space counts toward the total, as
 *     the Filesystems table counts it), the fullest mount kept with its
 *     mount point; system.filesystem.utilization when usage is not sent;
 *   - inodes: each mount's used inodes over used plus free
 *     (system.filesystem.inodes.usage), the most-used mount kept;
 *   - load: system.cpu.load_average.15m;
 *   - booted: the reading's time minus system.uptime (the hostmetrics
 *     `system` scraper);
 *   - failed units: the systemd receiver's units whose
 *     systemd.unit.state is 1 for the `failed` active state.
 *
 * A reading the batch does not carry is left out - never zeroed - so a
 * batch that held only the systemd units leaves the CPU reading as it was
 * (the COALESCE-per-column contract every snapshot scan keeps).
 *
 * Pure: no database, no network, no clock but what it is handed. The
 * values come from the host, so every number is checked to be finite and
 * every name is cut to what its column holds.
 */

export interface HostReadings {
  cpuPercent?: number | undefined;
  memoryPercent?: number | undefined;
  swapPercent?: number | undefined;
  diskPercent?: number | undefined;
  diskMountpoint?: string | undefined;
  inodesPercent?: number | undefined;
  inodesMountpoint?: string | undefined;
  loadAverage15m?: number | undefined;
  bootedAt?: Date | undefined;
  /*
   * The failed units' names, sorted - present only when the batch carried
   * the host's systemd units, so an empty list means "none failed" and a
   * missing one "not reported in this batch".
   */
  failedSystemdUnits?: Array<string> | undefined;
}

// The Host columns the readings are stored in (HostService.updateLastSeen).
export interface HostReadingColumns {
  latestCpuPercent?: number | undefined;
  latestMemoryPercent?: number | undefined;
  latestSwapPercent?: number | undefined;
  latestDiskPercent?: number | undefined;
  latestDiskMountpoint?: string | undefined;
  latestInodesPercent?: number | undefined;
  latestInodesMountpoint?: string | undefined;
  latestLoadAverage15m?: number | undefined;
  bootedAt?: Date | undefined;
  failedSystemdUnitCount?: number | undefined;
  failedSystemdUnits?: Array<string> | undefined;
}

// The metric names the scan reads, and nothing else.
export const HOST_READING_METRIC_NAMES: ReadonlySet<string> = new Set<string>([
  "system.cpu.utilization",
  "system.memory.utilization",
  "system.memory.usage",
  "system.paging.usage",
  "system.filesystem.usage",
  "system.filesystem.utilization",
  "system.filesystem.inodes.usage",
  "system.cpu.load_average.15m",
  "system.uptime",
  "systemd.unit.state",
]);

// How many failed units' names a host's record keeps (their count is exact).
export const HOST_FAILED_SYSTEMD_UNITS_KEPT: number = 20;

// A mount point or a unit name longer than its column holds is cut to it.
export const HOST_READING_NAME_MAX_LENGTH: number = 500;

/*
 * Readings stored to two decimals: enough for a percent or a load, and a
 * value that does not churn in its last digits.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampPercent(value: number): number {
  return round2(Math.min(100, Math.max(0, value)));
}

function finiteNumber(value: JSONValue | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed: number = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function datapointValue(datapoint: JSONObject): number | null {
  const asInt: number | null = finiteNumber(datapoint["asInt"]);
  if (asInt !== null) {
    return asInt;
  }
  return finiteNumber(datapoint["asDouble"]);
}

function datapoints(metric: JSONObject): Array<JSONObject> {
  const wrapper: JSONObject | undefined =
    (metric["gauge"] as JSONObject | undefined) ||
    (metric["sum"] as JSONObject | undefined);
  const points: JSONValue | undefined = wrapper?.["dataPoints"];
  if (!Array.isArray(points)) {
    return [];
  }
  return points.filter((point: JSONValue): boolean => {
    return Boolean(point) && typeof point === "object" && !Array.isArray(point);
  }) as Array<JSONObject>;
}

/*
 * An OTLP attribute's value as text: a string as it is, a number or a
 * boolean written out. Attributes are `[{ key, value: { stringValue } }]`.
 */
export function readAttribute(
  attributes: JSONValue | undefined,
  key: string,
): string | null {
  if (!Array.isArray(attributes)) {
    return null;
  }
  for (const attribute of attributes) {
    if (
      !attribute ||
      typeof attribute !== "object" ||
      Array.isArray(attribute) ||
      (attribute as JSONObject)["key"] !== key
    ) {
      continue;
    }
    const value: JSONValue | undefined = (attribute as JSONObject)["value"];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const holder: JSONObject = value as JSONObject;
    if (typeof holder["stringValue"] === "string") {
      return holder["stringValue"] as string;
    }
    for (const field of ["intValue", "doubleValue", "boolValue"]) {
      const inner: JSONValue | undefined = holder[field];
      if (
        typeof inner === "number" ||
        typeof inner === "boolean" ||
        typeof inner === "string"
      ) {
        return String(inner);
      }
    }
    return null;
  }
  return null;
}

function cutName(name: string): string {
  return name.length > HOST_READING_NAME_MAX_LENGTH
    ? name.substring(0, HOST_READING_NAME_MAX_LENGTH)
    : name;
}

// Nanoseconds since the epoch, as OTLP JSON writes them: digits only.
const UNIX_NANO_DIGITS: RegExp = /^\d{1,25}$/;

// A datapoint's time, from its timeUnixNano (nanoseconds, as text or number).
function datapointTime(datapoint: JSONObject): Date | null {
  const raw: JSONValue | undefined = datapoint["timeUnixNano"];
  if (typeof raw !== "string" && typeof raw !== "number") {
    return null;
  }
  const text: string = String(raw).trim();
  if (!UNIX_NANO_DIGITS.test(text)) {
    return null;
  }
  // Milliseconds are the first digits of nanoseconds: no float rounding.
  const milliseconds: number =
    text.length > 6 ? Number(text.substring(0, text.length - 6)) : 0;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return null;
  }
  return new Date(milliseconds);
}

function meanOf(values: Array<number>): number | null {
  if (values.length === 0) {
    return null;
  }
  let sum: number = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}

function readCpuPercent(metric: JSONObject): number | null {
  const user: Array<number> = [];
  const system: Array<number> = [];
  for (const datapoint of datapoints(metric)) {
    const value: number | null = datapointValue(datapoint);
    if (value === null) {
      continue;
    }
    const state: string | null = readAttribute(
      datapoint["attributes"],
      "state",
    );
    if (state === "user") {
      user.push(value);
    } else if (state === "system") {
      system.push(value);
    }
  }
  const userMean: number | null = meanOf(user);
  const systemMean: number | null = meanOf(system);
  if (userMean === null && systemMean === null) {
    return null;
  }
  return clampPercent(((userMean ?? 0) + (systemMean ?? 0)) * 100);
}

function readUsedRatioPercent(metric: JSONObject): number | null {
  const used: Array<number> = [];
  for (const datapoint of datapoints(metric)) {
    const value: number | null = datapointValue(datapoint);
    if (
      value !== null &&
      readAttribute(datapoint["attributes"], "state") === "used"
    ) {
      used.push(value);
    }
  }
  const mean: number | null = meanOf(used);
  return mean === null ? null : clampPercent(mean * 100);
}

// The `used` share of a usage metric, summed over its datapoints.
function readUsedShareOfUsage(
  metric: JSONObject,
  totalStates: ReadonlyArray<string> | null,
): number | null {
  let used: number = 0;
  let total: number = 0;
  let sawUsed: boolean = false;
  for (const datapoint of datapoints(metric)) {
    const value: number | null = datapointValue(datapoint);
    if (value === null || value < 0) {
      continue;
    }
    const state: string | null = readAttribute(
      datapoint["attributes"],
      "state",
    );
    if (state === "used") {
      used += value;
      sawUsed = true;
    }
    if (totalStates === null || (state && totalStates.includes(state))) {
      total += value;
    }
  }
  if (!sawUsed || total <= 0) {
    return null;
  }
  return clampPercent((used / total) * 100);
}

interface MountShare {
  mountpoint: string;
  percent: number;
}

/*
 * Each mount's used share - used over the states in `totalStates` - and the
 * mount with the highest, ties to the mount point that sorts first so two
 * batches of the same readings name the same mount.
 */
function readFullestMount(
  metric: JSONObject,
  totalStates: ReadonlyArray<string>,
): MountShare | null {
  const byMount: Map<string, { used: number; total: number; saw: boolean }> =
    new Map();
  for (const datapoint of datapoints(metric)) {
    const value: number | null = datapointValue(datapoint);
    if (value === null || value < 0) {
      continue;
    }
    const mountpoint: string | null = readAttribute(
      datapoint["attributes"],
      "mountpoint",
    );
    const state: string | null = readAttribute(
      datapoint["attributes"],
      "state",
    );
    if (!mountpoint || !state) {
      continue;
    }
    const entry: { used: number; total: number; saw: boolean } = byMount.get(
      mountpoint,
    ) || { used: 0, total: 0, saw: false };
    if (state === "used") {
      entry.used += value;
      entry.saw = true;
    }
    if (totalStates.includes(state)) {
      entry.total += value;
    }
    byMount.set(mountpoint, entry);
  }

  let fullest: MountShare | null = null;
  for (const [mountpoint, entry] of byMount.entries()) {
    if (!entry.saw || entry.total <= 0) {
      continue;
    }
    const percent: number = clampPercent((entry.used / entry.total) * 100);
    if (
      !fullest ||
      percent > fullest.percent ||
      (percent === fullest.percent && mountpoint < fullest.mountpoint)
    ) {
      fullest = { mountpoint: cutName(mountpoint), percent: percent };
    }
  }
  return fullest;
}

// system.filesystem.utilization: a 0-1 share per mount, the highest kept.
function readFullestMountFromUtilization(
  metric: JSONObject,
): MountShare | null {
  let fullest: MountShare | null = null;
  for (const datapoint of datapoints(metric)) {
    const value: number | null = datapointValue(datapoint);
    const mountpoint: string | null = readAttribute(
      datapoint["attributes"],
      "mountpoint",
    );
    if (value === null || !mountpoint) {
      continue;
    }
    const percent: number = clampPercent(value * 100);
    if (
      !fullest ||
      percent > fullest.percent ||
      (percent === fullest.percent && mountpoint < fullest.mountpoint)
    ) {
      fullest = { mountpoint: cutName(mountpoint), percent: percent };
    }
  }
  return fullest;
}

function readFirstValue(metric: JSONObject): {
  value: number;
  datapoint: JSONObject;
} | null {
  for (const datapoint of datapoints(metric)) {
    const value: number | null = datapointValue(datapoint);
    if (value !== null) {
      return { value: value, datapoint: datapoint };
    }
  }
  return null;
}

// Whether a systemd unit's state datapoints say it is failed now.
function isUnitFailed(metric: JSONObject): boolean {
  for (const datapoint of datapoints(metric)) {
    if (
      readAttribute(datapoint["attributes"], "systemd.unit.active_state") ===
        "failed" &&
      (datapointValue(datapoint) ?? 0) > 0
    ) {
      return true;
    }
  }
  return false;
}

function metricsOf(scopeMetrics: JSONValue | undefined): Array<JSONObject> {
  const metrics: Array<JSONObject> = [];
  if (!Array.isArray(scopeMetrics)) {
    return metrics;
  }
  for (const scopeMetric of scopeMetrics) {
    if (!scopeMetric || typeof scopeMetric !== "object") {
      continue;
    }
    const list: JSONValue | undefined = (scopeMetric as JSONObject)["metrics"];
    if (!Array.isArray(list)) {
      continue;
    }
    for (const metric of list) {
      if (metric && typeof metric === "object" && !Array.isArray(metric)) {
        metrics.push(metric as JSONObject);
      }
    }
  }
  return metrics;
}

/*
 * The readings one resource of a batch carries: one hostmetrics scraper's
 * metrics (cpu, memory, filesystem...) or one systemd unit's state.
 * `receivedAt` dates the uptime when its datapoint has no time.
 */
export function scanHostReadings(input: {
  resourceAttributes: JSONArray;
  scopeMetrics: JSONArray | undefined;
  receivedAt: Date;
}): HostReadings {
  const readings: HostReadings = {};

  let memoryFromUsage: number | null = null;
  let diskFromUtilization: MountShare | null = null;
  let sawUnitState: boolean = false;
  let unitFailed: boolean = false;

  for (const metric of metricsOf(input.scopeMetrics)) {
    const name: string = String(metric["name"] || "");
    if (!HOST_READING_METRIC_NAMES.has(name)) {
      continue;
    }

    switch (name) {
      case "system.cpu.utilization": {
        const cpu: number | null = readCpuPercent(metric);
        if (cpu !== null) {
          readings.cpuPercent = cpu;
        }
        break;
      }
      case "system.memory.utilization": {
        const memory: number | null = readUsedRatioPercent(metric);
        if (memory !== null) {
          readings.memoryPercent = memory;
        }
        break;
      }
      case "system.memory.usage": {
        memoryFromUsage = readUsedShareOfUsage(metric, null);
        break;
      }
      case "system.paging.usage": {
        const swap: number | null = readUsedShareOfUsage(metric, [
          "used",
          "free",
        ]);
        if (swap !== null) {
          readings.swapPercent = swap;
        }
        break;
      }
      case "system.filesystem.usage": {
        const fullest: MountShare | null = readFullestMount(metric, [
          "used",
          "free",
          "reserved",
        ]);
        if (fullest) {
          readings.diskPercent = fullest.percent;
          readings.diskMountpoint = fullest.mountpoint;
        }
        break;
      }
      case "system.filesystem.utilization": {
        diskFromUtilization = readFullestMountFromUtilization(metric);
        break;
      }
      case "system.filesystem.inodes.usage": {
        const fullest: MountShare | null = readFullestMount(metric, [
          "used",
          "free",
        ]);
        if (fullest) {
          readings.inodesPercent = fullest.percent;
          readings.inodesMountpoint = fullest.mountpoint;
        }
        break;
      }
      case "system.cpu.load_average.15m": {
        const load: { value: number; datapoint: JSONObject } | null =
          readFirstValue(metric);
        if (load && load.value >= 0) {
          readings.loadAverage15m = round2(load.value);
        }
        break;
      }
      case "system.uptime": {
        const uptime: { value: number; datapoint: JSONObject } | null =
          readFirstValue(metric);
        if (uptime && uptime.value >= 0) {
          const at: Date =
            datapointTime(uptime.datapoint) || new Date(input.receivedAt);
          // To the second: two reports of one boot name the same moment.
          readings.bootedAt = new Date(
            Math.round((at.getTime() - uptime.value * 1000) / 1000) * 1000,
          );
        }
        break;
      }
      case "systemd.unit.state": {
        sawUnitState = true;
        if (isUnitFailed(metric)) {
          unitFailed = true;
        }
        break;
      }
    }
  }

  if (readings.memoryPercent === undefined && memoryFromUsage !== null) {
    readings.memoryPercent = memoryFromUsage;
  }

  if (readings.diskPercent === undefined && diskFromUtilization) {
    readings.diskPercent = diskFromUtilization.percent;
    readings.diskMountpoint = diskFromUtilization.mountpoint;
  }

  if (sawUnitState) {
    const unitName: string | null = readAttribute(
      input.resourceAttributes,
      "systemd.unit.name",
    );
    readings.failedSystemdUnits =
      unitFailed && unitName ? [cutName(unitName)] : [];
  }

  return readings;
}

/*
 * Two resources' readings of one host in one batch, as one: the first
 * reading of each kind is kept (a batch holds one scrape per scraper, and
 * the next batch brings the next), the fuller of two disks or inode counts,
 * and every failed unit of the units the batch carried.
 */
export function mergeHostReadings(
  into: HostReadings,
  from: HostReadings,
): HostReadings {
  const merged: HostReadings = { ...into };

  const keepFirst: Array<
    "cpuPercent" | "memoryPercent" | "swapPercent" | "loadAverage15m"
  > = ["cpuPercent", "memoryPercent", "swapPercent", "loadAverage15m"];
  for (const key of keepFirst) {
    if (merged[key] === undefined && from[key] !== undefined) {
      merged[key] = from[key];
    }
  }

  if (merged.bootedAt === undefined && from.bootedAt !== undefined) {
    merged.bootedAt = from.bootedAt;
  }

  if (
    from.diskPercent !== undefined &&
    (merged.diskPercent === undefined || from.diskPercent > merged.diskPercent)
  ) {
    merged.diskPercent = from.diskPercent;
    merged.diskMountpoint = from.diskMountpoint;
  }

  if (
    from.inodesPercent !== undefined &&
    (merged.inodesPercent === undefined ||
      from.inodesPercent > merged.inodesPercent)
  ) {
    merged.inodesPercent = from.inodesPercent;
    merged.inodesMountpoint = from.inodesMountpoint;
  }

  if (from.failedSystemdUnits !== undefined) {
    const names: Set<string> = new Set<string>(merged.failedSystemdUnits || []);
    for (const name of from.failedSystemdUnits) {
      names.add(name);
    }
    merged.failedSystemdUnits = Array.from(names).sort();
  }

  return merged;
}

export function hasHostReadings(readings: HostReadings): boolean {
  return Object.values(readings).some((value: unknown): boolean => {
    return value !== undefined;
  });
}

/*
 * The readings as the Host columns that hold them: the failed units'
 * count is exact, their names the first HOST_FAILED_SYSTEMD_UNITS_KEPT.
 * Only what was read is set.
 */
export function toHostReadingColumns(
  readings: HostReadings,
): HostReadingColumns {
  const columns: HostReadingColumns = {};

  if (readings.cpuPercent !== undefined) {
    columns.latestCpuPercent = readings.cpuPercent;
  }
  if (readings.memoryPercent !== undefined) {
    columns.latestMemoryPercent = readings.memoryPercent;
  }
  if (readings.swapPercent !== undefined) {
    columns.latestSwapPercent = readings.swapPercent;
  }
  if (readings.diskPercent !== undefined) {
    columns.latestDiskPercent = readings.diskPercent;
    if (readings.diskMountpoint !== undefined) {
      columns.latestDiskMountpoint = readings.diskMountpoint;
    }
  }
  if (readings.inodesPercent !== undefined) {
    columns.latestInodesPercent = readings.inodesPercent;
    if (readings.inodesMountpoint !== undefined) {
      columns.latestInodesMountpoint = readings.inodesMountpoint;
    }
  }
  if (readings.loadAverage15m !== undefined) {
    columns.latestLoadAverage15m = readings.loadAverage15m;
  }
  if (readings.bootedAt !== undefined) {
    columns.bootedAt = readings.bootedAt;
  }
  if (readings.failedSystemdUnits !== undefined) {
    const sorted: Array<string> = [...readings.failedSystemdUnits].sort();
    columns.failedSystemdUnitCount = sorted.length;
    columns.failedSystemdUnits = sorted.slice(
      0,
      HOST_FAILED_SYSTEMD_UNITS_KEPT,
    );
  }

  return columns;
}
