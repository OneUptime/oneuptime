import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

/*
 * Shared helpers for the Host Processes list and the page for one process.
 *
 * The OTel hostmetrics `process` scraper reports one OTLP *resource* per
 * process and puts the process's identity on it - pid, executable name,
 * command and owner. OneUptime's metric ingest prefixes resource attributes
 * with `resource.`, so they are stored as `resource.process.*`, while the
 * CPU mode rides each datapoint and is stored unprefixed.
 *
 * Everything here is pure so the pages stay thin, and the rules that
 * silently produce a wrong number - which readings make up a process's CPU,
 * what a search matches, which way a column sorts, whether the fetch saw
 * every process - are unit tested directly.
 */

export const PROCESS_CPU_UTILIZATION_METRIC_NAME: string =
  "process.cpu.utilization";
export const PROCESS_MEMORY_USAGE_METRIC_NAME: string = "process.memory.usage";

// Resource attributes - ingest prefixes them.
export const PROCESS_PID_ATTR: string = "resource.process.pid";
export const PROCESS_NAME_ATTR: string = "resource.process.executable.name";
export const PROCESS_COMMAND_ATTR: string = "resource.process.command";
export const PROCESS_OWNER_ATTR: string = "resource.process.owner";

/*
 * Datapoint attributes - ingest stores them verbatim.
 *
 * The scraper reports a process's CPU as one reading per mode, named by the
 * `state` attribute: user, system and (Linux only) wait. From otelcol-contrib
 * v0.158.0 the `scraper.process.EmitV1SystemConventions` gate adds a second
 * copy of every reading under the semantic-convention `cpu.mode` attribute
 * (user, system, iowait), and `scraper.process.DontEmitV0SystemConventions`
 * drops the first copy. So one mode can arrive once or twice, under either
 * name, and the list has to read all of those shapes the same way.
 */
export const PROCESS_CPU_STATE_ATTR: string = "state";
export const PROCESS_CPU_MODE_ATTR: string = "cpu.mode";
export const PROCESS_CPU_STATE_WAIT: string = "wait";
export const PROCESS_CPU_MODE_IOWAIT: string = "iowait";

const CPU_MODE_USER: string = "user";
const CPU_MODE_SYSTEM: string = "system";

/*
 * The CPU query leaves out the wait readings, under both spellings. A
 * process's wait time is time it spent blocked on disk I/O - not CPU it
 * used - so the list never adds it up, and fetching it only spends the
 * fetch cap: on Linux, the one scraper that reports it, a third of every
 * scrape. A missing attribute reads as "" in ClickHouse, so each `!=` still
 * passes a reading that carries only the other spelling.
 */
export const processCpuWaitExclusion: () => Record<
  string,
  NotEqual<string>
> = (): Record<string, NotEqual<string>> => {
  return {
    [PROCESS_CPU_STATE_ATTR]: new NotEqual<string>(PROCESS_CPU_STATE_WAIT),
    [PROCESS_CPU_MODE_ATTR]: new NotEqual<string>(PROCESS_CPU_MODE_IOWAIT),
  };
};

/*
 * The process page groups its CPU aggregate by both mode attributes, so each
 * bucket comes back as one average per mode and spelling. Ungrouped, an Avg
 * pools the modes into their mean rather than their sum - about a third of
 * the real use on Linux, half on Windows - and no client can take that apart
 * again.
 */
export const PROCESS_CPU_MODE_ATTRIBUTE_KEYS: Array<string> = [
  PROCESS_CPU_STATE_ATTR,
  PROCESS_CPU_MODE_ATTR,
];

/*
 * The subset of an analytics `Metric` row these helpers read. Kept
 * structural (rather than importing the model) so the rules can be
 * exercised from a plain Node test without dragging in the analytics stack.
 */
export interface ProcessMetricDatapoint {
  time?: Date | string | null | undefined;
  value?: number | string | null | undefined;
  attributes?: Record<string, unknown> | null | undefined;
}

/*
 * One row of the process page's CPU aggregate: the average of one mode's
 * readings, under one spelling, over one interval. Structural for the same
 * reason - an `AggregatedModel` fits it - and loose where the wire is: the
 * bucket's start arrives as an ISO string, whatever the model's types say.
 */
export interface ProcessCpuBucket {
  timestamp?: Date | string | number | null | undefined;
  value?: number | string | null | undefined;
  attributes?: unknown;
}

export interface ProcessCpuPoint {
  // When the bucket starts.
  time: Date;
  // User plus system time, as a share of every core together (0-100).
  cpuPercent: number;
}

export interface ProcessRow {
  // pid and executable together: the OS hands a freed pid to a new process.
  key: string;
  pid: string;
  // Empty when the scraper sent no name; the page shows its own placeholder.
  executable: string;
  command: string | null;
  user: string | null;
  // User plus system time, as a share of every core together (0-100).
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryPercent: number | null;
}

export interface ProcessRollup {
  rows: Array<ProcessRow>;
  latestSampleAt: Date | null;
}

export type ProcessSortKey =
  | "executable"
  | "pid"
  | "user"
  | "cpuPercent"
  | "memoryBytes";

export const PROCESS_SORT_KEYS: Array<ProcessSortKey> = [
  "executable",
  "pid",
  "user",
  "cpuPercent",
  "memoryBytes",
];

export interface ProcessSort {
  sortBy: ProcessSortKey;
  sortOrder: SortOrder;
}

// The list opens on the busiest processes, as it always has.
export const DEFAULT_PROCESS_SORT: ProcessSort = {
  sortBy: "cpuPercent",
  sortOrder: SortOrder.Descending,
};

const readAttribute: (
  attributes: Record<string, unknown> | null | undefined,
  key: string,
) => string | null = (
  attributes: Record<string, unknown> | null | undefined,
  key: string,
): string | null => {
  if (!attributes) {
    return null;
  }
  const raw: unknown = attributes[key];
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed: string = raw.trim();
  return trimmed === "" ? null : trimmed;
};

const parseSampleTime: (
  time: Date | string | number | null | undefined,
) => Date | null = (
  time: Date | string | number | null | undefined,
): Date | null => {
  if (time === null || time === undefined) {
    return null;
  }
  const parsed: Date = time instanceof Date ? time : new Date(time);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/*
 * ClickHouse hands numbers back as either a number or its string form
 * depending on the driver path, and Number("") is 0 - so a blank never
 * becomes a reading of zero.
 */
const readValue: (
  value: number | string | null | undefined,
) => number | null = (
  value: number | string | null | undefined,
): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const numeric: number = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const processKeyOf: (
  attributes: Record<string, unknown> | null | undefined,
) => string | null = (
  attributes: Record<string, unknown> | null | undefined,
): string | null => {
  const pid: string = readAttribute(attributes, PROCESS_PID_ATTR) ?? "";
  const executable: string = readAttribute(attributes, PROCESS_NAME_ATTR) ?? "";
  if (!pid && !executable) {
    return null;
  }
  return `${pid}-${executable}`;
};

/*
 * The mode a CPU reading is for, in the scraper's original spelling - so
 * `cpu.mode: iowait` and `state: wait` are both "wait". Null when the
 * reading names no mode at all.
 */
const cpuModeOf: (
  attributes: Record<string, unknown> | null | undefined,
) => string | null = (
  attributes: Record<string, unknown> | null | undefined,
): string | null => {
  const mode: string | null =
    readAttribute(attributes, PROCESS_CPU_MODE_ATTR) ??
    readAttribute(attributes, PROCESS_CPU_STATE_ATTR);
  if (mode === null) {
    return null;
  }
  const lowered: string = mode.toLowerCase();
  return lowered === PROCESS_CPU_MODE_IOWAIT ? PROCESS_CPU_STATE_WAIT : lowered;
};

/*
 * A process's CPU readings at one moment, one value per mode: its newest
 * scrape (the list) or one bucket of the aggregate (the process page).
 */
interface CpuReadings {
  at: number;
  byMode: Map<string, number>;
  // A reading that names no mode is already the process's whole CPU.
  total: number | null;
}

interface LatestValue {
  at: number;
  value: number;
}

/*
 * A process's CPU is its user plus its system time - the same two the host's
 * own CPU tile adds up, and what `top` and Task Manager show. The list reads
 * it at the newest scrape, the process page in every bucket.
 *
 * Taking the first reading per process instead (which is what the list did)
 * shows whichever single mode ClickHouse happened to return first, so a
 * process at 30% user and 6% system could read 6%, and sorting by CPU would
 * order processes by a coin toss. Each mode counts once: with the v1 gate on,
 * the scraper sends every reading twice.
 */
const cpuPercentOf: (readings: CpuReadings) => number | null = (
  readings: CpuReadings,
): number | null => {
  const user: number | undefined = readings.byMode.get(CPU_MODE_USER);
  const system: number | undefined = readings.byMode.get(CPU_MODE_SYSTEM);
  if (user === undefined && system === undefined) {
    return readings.total === null ? null : readings.total * 100;
  }
  // The scraper reports a share of every core together (0-1), on every OS.
  return ((user ?? 0) + (system ?? 0)) * 100;
};

/*
 * Roll the newest-first CPU and memory readings up into one row per process.
 *
 * The scraper stamps all of a process's readings in a scrape with one
 * timestamp, so "this process's newest scrape" is every reading at the newest
 * timestamp seen for it. Memory is a single reading per scrape.
 */
export const buildProcessRows: (input: {
  cpuDatapoints: Array<ProcessMetricDatapoint>;
  memoryDatapoints: Array<ProcessMetricDatapoint>;
  totalMemoryBytes: number | null | undefined;
}) => ProcessRollup = (input: {
  cpuDatapoints: Array<ProcessMetricDatapoint>;
  memoryDatapoints: Array<ProcessMetricDatapoint>;
  totalMemoryBytes: number | null | undefined;
}): ProcessRollup => {
  const rows: Map<string, ProcessRow> = new Map();
  const cpu: Map<string, CpuReadings> = new Map();
  const memory: Map<string, LatestValue> = new Map();
  let latestSampleAt: Date | null = null;

  type ReadDatapointFunction = (datapoint: ProcessMetricDatapoint) => {
    row: ProcessRow;
    at: number;
    value: number;
  } | null;

  const readDatapoint: ReadDatapointFunction = (
    datapoint: ProcessMetricDatapoint,
  ): { row: ProcessRow; at: number; value: number } | null => {
    const time: Date | null = parseSampleTime(datapoint.time);
    if (time && (latestSampleAt === null || time > latestSampleAt)) {
      latestSampleAt = time;
    }

    const key: string | null = processKeyOf(datapoint.attributes);
    if (!key) {
      return null;
    }

    let row: ProcessRow | undefined = rows.get(key);
    if (!row) {
      row = {
        key: key,
        pid: readAttribute(datapoint.attributes, PROCESS_PID_ATTR) ?? "",
        executable:
          readAttribute(datapoint.attributes, PROCESS_NAME_ATTR) ?? "",
        command: null,
        user: null,
        cpuPercent: null,
        memoryBytes: null,
        memoryPercent: null,
      };
      rows.set(key, row);
    }

    // A process's command and owner never change; any reading may carry them.
    row.command =
      row.command ?? readAttribute(datapoint.attributes, PROCESS_COMMAND_ATTR);
    row.user =
      row.user ?? readAttribute(datapoint.attributes, PROCESS_OWNER_ATTR);

    const value: number | null = readValue(datapoint.value);
    if (!time || value === null) {
      return null;
    }

    return { row: row, at: time.getTime(), value: value };
  };

  for (const datapoint of input.cpuDatapoints) {
    const read: { row: ProcessRow; at: number; value: number } | null =
      readDatapoint(datapoint);
    if (!read) {
      continue;
    }

    let scrape: CpuReadings | undefined = cpu.get(read.row.key);
    if (!scrape || read.at > scrape.at) {
      scrape = { at: read.at, byMode: new Map(), total: null };
      cpu.set(read.row.key, scrape);
    }
    if (read.at < scrape.at) {
      continue;
    }

    const mode: string | null = cpuModeOf(datapoint.attributes);
    if (mode === null) {
      scrape.total = scrape.total ?? read.value;
    } else if (!scrape.byMode.has(mode)) {
      scrape.byMode.set(mode, read.value);
    }
  }

  for (const datapoint of input.memoryDatapoints) {
    const read: { row: ProcessRow; at: number; value: number } | null =
      readDatapoint(datapoint);
    if (!read) {
      continue;
    }

    const latest: LatestValue | undefined = memory.get(read.row.key);
    if (!latest || read.at > latest.at) {
      memory.set(read.row.key, { at: read.at, value: read.value });
    }
  }

  const totalMemoryBytes: number | null =
    typeof input.totalMemoryBytes === "number" &&
    Number.isFinite(input.totalMemoryBytes) &&
    input.totalMemoryBytes > 0
      ? input.totalMemoryBytes
      : null;

  for (const row of rows.values()) {
    const scrape: CpuReadings | undefined = cpu.get(row.key);
    row.cpuPercent = scrape ? cpuPercentOf(scrape) : null;
    row.memoryBytes = memory.get(row.key)?.value ?? null;
    row.memoryPercent =
      row.memoryBytes !== null && totalMemoryBytes !== null
        ? (row.memoryBytes / totalMemoryBytes) * 100
        : null;
  }

  return { rows: Array.from(rows.values()), latestSampleAt: latestSampleAt };
};

const attributesOf: (raw: unknown) => Record<string, unknown> | null = (
  raw: unknown,
): Record<string, unknown> | null => {
  return typeof raw === "object" && raw !== null
    ? (raw as Record<string, unknown>)
    : null;
};

const averageOf: (values: Array<number>) => number | null = (
  values: Array<number>,
): number | null => {
  if (values.length === 0) {
    return null;
  }
  let sum: number = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
};

// One bucket's averages, before each mode's copies are folded into one.
interface CpuBucketReadings {
  byMode: Map<string, Array<number>>;
  modeless: Array<number>;
}

/*
 * The process's CPU in each bucket of the process page's aggregate (grouped
 * by PROCESS_CPU_MODE_ATTRIBUTE_KEYS), oldest first: user plus system time,
 * by the rule the list uses, so the chart, the tile and the process's row in
 * the list all add up the same readings.
 *
 * With the v1 gate on, a mode arrives as two groups - the old reading under
 * `state`, its copy under `cpu.mode` - that average the same readings. Adding
 * both would double the process's CPU, so a mode's groups are averaged into
 * one value, which also keeps a bucket's value independent of the order its
 * groups come back in. Wait never counts, under either spelling, and a bucket
 * with nothing else in it has no CPU: it is left out, not drawn at 0%.
 */
export const buildProcessCpuSeries: (
  buckets: Array<ProcessCpuBucket>,
) => Array<ProcessCpuPoint> = (
  buckets: Array<ProcessCpuBucket>,
): Array<ProcessCpuPoint> => {
  const byBucket: Map<number, CpuBucketReadings> = new Map();

  for (const bucket of buckets) {
    const time: Date | null = parseSampleTime(bucket.timestamp);
    const value: number | null = readValue(bucket.value);
    const mode: string | null = cpuModeOf(attributesOf(bucket.attributes));
    if (!time || value === null || mode === PROCESS_CPU_STATE_WAIT) {
      continue;
    }

    let readings: CpuBucketReadings | undefined = byBucket.get(time.getTime());
    if (!readings) {
      readings = { byMode: new Map(), modeless: [] };
      byBucket.set(time.getTime(), readings);
    }

    if (mode === null) {
      readings.modeless.push(value);
      continue;
    }
    const copies: Array<number> | undefined = readings.byMode.get(mode);
    if (copies) {
      copies.push(value);
    } else {
      readings.byMode.set(mode, [value]);
    }
  }

  const points: Array<ProcessCpuPoint> = [];
  for (const [at, readings] of byBucket.entries()) {
    const byMode: Map<string, number> = new Map();
    for (const [mode, copies] of readings.byMode.entries()) {
      // Never empty: a mode is only listed once a reading for it arrives.
      byMode.set(mode, averageOf(copies)!);
    }

    const cpuPercent: number | null = cpuPercentOf({
      at: at,
      byMode: byMode,
      total: averageOf(readings.modeless),
    });
    if (cpuPercent !== null) {
      points.push({ time: new Date(at), cpuPercent: cpuPercent });
    }
  }

  return points.sort((a: ProcessCpuPoint, b: ProcessCpuPoint): number => {
    return a.time.getTime() - b.time.getTime();
  });
};

/*
 * Whether a capped, newest-first fetch may have stopped part-way through the
 * newest scrape - leaving processes out of the list, or listed without that
 * metric's reading.
 *
 * Unlike systemd units, one scrape does not share a timestamp: the scraper
 * stamps each process as it reaches it while walking the process table. What
 * does prove the newest scrape is whole is any process seen at two different
 * timestamps - the fetch then reached back into the scrape before, and
 * everything newer than that is in it.
 */
export const isProcessFetchCutOff: (
  datapoints: Array<ProcessMetricDatapoint>,
  limit: number,
) => boolean = (
  datapoints: Array<ProcessMetricDatapoint>,
  limit: number,
): boolean => {
  if (datapoints.length < limit) {
    return false;
  }

  const firstSeenAt: Map<string, number> = new Map();

  for (const datapoint of datapoints) {
    const key: string | null = processKeyOf(datapoint.attributes);
    const time: Date | null = parseSampleTime(datapoint.time);
    if (!key || !time) {
      continue;
    }

    const seenAt: number | undefined = firstSeenAt.get(key);
    if (seenAt === undefined) {
      firstSeenAt.set(key, time.getTime());
    } else if (seenAt !== time.getTime()) {
      return false;
    }
  }

  return true;
};

export const processSearchTerms: (searchText: string) => Array<string> = (
  searchText: string,
): Array<string> => {
  return searchText
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term: string): boolean => {
      return term.length > 0;
    });
};

/*
 * A search reads exactly what a row shows - executable name, pid, user and
 * the command under the name - so whatever a reader can see they can find,
 * and nothing matches on text they cannot see. Every word has to appear
 * somewhere in the row, ignoring case: "java system" is the java processes
 * SYSTEM runs, and a pasted path with spaces in it still finds its process.
 */
export const filterProcessRows: (
  rows: Array<ProcessRow>,
  searchText: string,
) => Array<ProcessRow> = (
  rows: Array<ProcessRow>,
  searchText: string,
): Array<ProcessRow> => {
  const terms: Array<string> = processSearchTerms(searchText);
  if (terms.length === 0) {
    return [...rows];
  }

  return rows.filter((row: ProcessRow): boolean => {
    // A newline cannot be typed into a term, so no term spans two fields.
    const haystack: string = [
      row.executable,
      row.pid,
      row.user ?? "",
      row.command ?? "",
    ]
      .join("\n")
      .toLowerCase();

    return terms.every((term: string): boolean => {
      return haystack.includes(term);
    });
  });
};

export const isProcessSortKey: (value: unknown) => value is ProcessSortKey = (
  value: unknown,
): value is ProcessSortKey => {
  return PROCESS_SORT_KEYS.includes(value as ProcessSortKey);
};

/*
 * A column's first click shows what a reader most likely wants from it: the
 * heaviest processes for CPU and Memory, A to Z or lowest first for the rest.
 */
export const defaultSortOrderFor: (sortBy: ProcessSortKey) => SortOrder = (
  sortBy: ProcessSortKey,
): SortOrder => {
  return sortBy === "cpuPercent" || sortBy === "memoryBytes"
    ? SortOrder.Descending
    : SortOrder.Ascending;
};

/*
 * The sort after a header click. The shared table header flips whatever
 * direction the table was last sorted in, whichever column was clicked - so
 * after CPU (heaviest first) a click on Memory would open on the processes
 * using the least. A newly picked column starts in its own direction
 * instead; clicking the sorted column again still flips it.
 */
export const resolveProcessSort: (input: {
  current: ProcessSort;
  requestedSortBy: unknown;
  requestedSortOrder: SortOrder;
}) => ProcessSort = (input: {
  current: ProcessSort;
  requestedSortBy: unknown;
  requestedSortOrder: SortOrder;
}): ProcessSort => {
  if (!isProcessSortKey(input.requestedSortBy)) {
    return DEFAULT_PROCESS_SORT;
  }

  if (input.requestedSortBy !== input.current.sortBy) {
    return {
      sortBy: input.requestedSortBy,
      sortOrder: defaultSortOrderFor(input.requestedSortBy),
    };
  }

  return { sortBy: input.requestedSortBy, sortOrder: input.requestedSortOrder };
};

const compareText: (a: string, b: string) => number = (
  a: string,
  b: string,
): number => {
  // `numeric` puts worker2 before worker10, as a reader expects.
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
};

const compareNumbers: (a: number, b: number) => number = (
  a: number,
  b: number,
): number => {
  return a - b;
};

// Hoisted: eslint's wrap-regex fights prettier over an inline literal.
const DIGITS_ONLY: RegExp = /^\d+$/;

// Pids are numbers: as text, 10040 would sort before 784.
const pidNumberOf: (row: ProcessRow) => number | null = (
  row: ProcessRow,
): number | null => {
  return DIGITS_ONLY.test(row.pid) ? Number(row.pid) : null;
};

/*
 * A missing value - no reading, no owner, no pid, no name - sorts last
 * whichever way the column is sorted: a dash is not the smallest reading,
 * and flipping a column should not lift every unread row to the top.
 */
const compareMissingLast: <T>(
  a: T | null,
  b: T | null,
  compare: (x: T, y: T) => number,
  direction: number,
) => number = <T>(
  a: T | null,
  b: T | null,
  compare: (x: T, y: T) => number,
  direction: number,
): number => {
  if (a === null && b === null) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return compare(a, b) * direction;
};

const compareBy: (
  sortBy: ProcessSortKey,
  a: ProcessRow,
  b: ProcessRow,
  direction: number,
) => number = (
  sortBy: ProcessSortKey,
  a: ProcessRow,
  b: ProcessRow,
  direction: number,
): number => {
  switch (sortBy) {
    case "executable":
      return compareMissingLast(
        a.executable || null,
        b.executable || null,
        compareText,
        direction,
      );
    case "pid":
      return compareMissingLast(
        pidNumberOf(a),
        pidNumberOf(b),
        compareNumbers,
        direction,
      );
    case "user":
      return compareMissingLast(a.user, b.user, compareText, direction);
    case "cpuPercent":
      return compareMissingLast(
        a.cpuPercent,
        b.cpuPercent,
        compareNumbers,
        direction,
      );
    case "memoryBytes":
      return compareMissingLast(
        a.memoryBytes,
        b.memoryBytes,
        compareNumbers,
        direction,
      );
  }
};

/*
 * Sort a copy of the rows. Ties - the dozens of processes idling at 0.0%,
 * every svchost.exe - fall back to name and then pid, always A to Z and
 * lowest first, so the order holds still from one refresh to the next.
 */
export const sortProcessRows: (
  rows: Array<ProcessRow>,
  sortBy: unknown,
  sortOrder: SortOrder,
) => Array<ProcessRow> = (
  rows: Array<ProcessRow>,
  sortBy: unknown,
  sortOrder: SortOrder,
): Array<ProcessRow> => {
  const key: ProcessSortKey = isProcessSortKey(sortBy)
    ? sortBy
    : DEFAULT_PROCESS_SORT.sortBy;
  const direction: number = sortOrder === SortOrder.Descending ? -1 : 1;

  return [...rows].sort((a: ProcessRow, b: ProcessRow): number => {
    return (
      compareBy(key, a, b, direction) ||
      compareBy("executable", a, b, 1) ||
      compareBy("pid", a, b, 1) ||
      compareText(a.key, b.key)
    );
  });
};
