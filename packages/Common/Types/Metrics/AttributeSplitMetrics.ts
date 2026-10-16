/*
 * Metrics that OpenTelemetry reports once per value of an attribute, where
 * one number across every value means nothing (issue #4784).
 *
 * The host agent's hostmetrics receiver reports `system.cpu.utilization`
 * once per CPU and STATE (user, system, idle, wait, ...), and the states of
 * one CPU add up to 1. An average across all of the rows is therefore about
 * 1 / (the number of states) whatever the load - 0.125 on Linux - so a
 * reader who asks for "the CPU" gets a flat line. Memory is split by state
 * the same way, and a filesystem metric by mount point, where one full disk
 * disappears into the average of the others.
 *
 * The AI's metric tools read a metric listed here one series per value of
 * its split when the caller neither filters nor groups by that attribute,
 * and say so in the result. The host Overview page and the Host alert
 * templates read the same metrics the same way (state=user + state=system
 * for busy CPU, state=used for memory).
 *
 * `splitBy` lists the attribute names a collector may use: newer OpenTelemetry
 * semantic conventions renamed some of them (`state` became `cpu.mode` on
 * the CPU metrics), and a collector sends one name or the other. Grouping by
 * a key a row does not carry adds nothing to its group, so listing both
 * keeps the split right whichever the collector sends.
 */

export interface AttributeSplitMetric {
  metricName: string;
  // The data-point attributes the metric is reported once per value of.
  splitBy: ReadonlyArray<string>;
  // What one series of the split is, in one sentence, for the reader.
  meaning: string;
}

const CPU_STATE_KEYS: ReadonlyArray<string> = ["state", "cpu.mode"];
const MEMORY_STATE_KEYS: ReadonlyArray<string> = [
  "state",
  "system.memory.state",
];
const FILESYSTEM_MOUNT_KEYS: ReadonlyArray<string> = [
  "mountpoint",
  "system.filesystem.mountpoint",
];
const FILESYSTEM_STATE_KEYS: ReadonlyArray<string> = [
  "state",
  "system.filesystem.state",
];
const PAGING_STATE_KEYS: ReadonlyArray<string> = [
  "state",
  "system.paging.state",
];
const NETWORK_DIRECTION_KEYS: ReadonlyArray<string> = [
  "direction",
  "network.io.direction",
];
const DISK_DIRECTION_KEYS: ReadonlyArray<string> = [
  "direction",
  "disk.io.direction",
];

const CPU_UTILIZATION_MEANING: string =
  "One series per CPU state (user, system, idle, wait, ...). The states of a CPU add up to 1, so one average across them is always about 1 divided by the number of states, whatever the load. Busy CPU is user + system; idle near 0 means the CPUs are saturated.";

export const ATTRIBUTE_SPLIT_METRICS: ReadonlyArray<AttributeSplitMetric> = [
  {
    metricName: "system.cpu.utilization",
    splitBy: CPU_STATE_KEYS,
    meaning: CPU_UTILIZATION_MEANING,
  },
  {
    metricName: "system.cpu.time",
    splitBy: CPU_STATE_KEYS,
    meaning:
      "CPU seconds spent in each state (user, system, idle, wait, ...), counted up since boot: compare how fast each state grows. Busy CPU is user + system.",
  },
  {
    metricName: "system.memory.utilization",
    splitBy: MEMORY_STATE_KEYS,
    meaning:
      "One series per memory state (used, free, cached, buffered, ...). The states add up to 1, so one average across them is always about 1 divided by the number of states. used is the memory in use.",
  },
  {
    metricName: "system.memory.usage",
    splitBy: MEMORY_STATE_KEYS,
    meaning:
      "Bytes in each memory state (used, free, cached, buffered, ...); the states add up to the host's memory. used is the memory in use.",
  },
  {
    metricName: "system.filesystem.utilization",
    splitBy: FILESYSTEM_MOUNT_KEYS,
    meaning:
      "One series per mounted filesystem: the fullest one is the one that runs out. An average across them hides a full disk. Some system mounts (devfs, read-only snap images) always read full.",
  },
  {
    metricName: "system.filesystem.usage",
    splitBy: [...FILESYSTEM_MOUNT_KEYS, ...FILESYSTEM_STATE_KEYS],
    meaning:
      "Bytes per mounted filesystem and state (used, free, reserved): used and free of one mount add up to its size.",
  },
  {
    metricName: "system.filesystem.inodes.usage",
    splitBy: [...FILESYSTEM_MOUNT_KEYS, ...FILESYSTEM_STATE_KEYS],
    meaning:
      "Inodes per mounted filesystem and state (used, free): a mount out of inodes cannot create files even with bytes free.",
  },
  {
    metricName: "system.paging.utilization",
    splitBy: PAGING_STATE_KEYS,
    meaning:
      "One series per swap state (used, free, cached); the states add up to 1. used is the swap in use.",
  },
  {
    metricName: "system.paging.usage",
    splitBy: PAGING_STATE_KEYS,
    meaning: "Bytes of swap in each state (used, free, cached).",
  },
  {
    metricName: "system.processes.count",
    splitBy: ["status", "system.process.status"],
    meaning:
      "Processes per status (running, sleeping, blocked, ...); the statuses add up to every process. Many running or blocked processes mean contention.",
  },
  {
    metricName: "system.network.io",
    splitBy: NETWORK_DIRECTION_KEYS,
    meaning:
      "Bytes received and transmitted, one series per direction, counted up since boot: compare how fast each grows.",
  },
  {
    metricName: "system.network.packets",
    splitBy: NETWORK_DIRECTION_KEYS,
    meaning:
      "Packets received and transmitted, one series per direction, counted up since boot.",
  },
  {
    metricName: "system.network.errors",
    splitBy: NETWORK_DIRECTION_KEYS,
    meaning:
      "Network errors on receive and on transmit, one series per direction, counted up since boot.",
  },
  {
    metricName: "system.network.dropped",
    splitBy: NETWORK_DIRECTION_KEYS,
    meaning:
      "Packets dropped on receive and on transmit, one series per direction, counted up since boot.",
  },
  {
    metricName: "system.disk.io",
    splitBy: DISK_DIRECTION_KEYS,
    meaning:
      "Bytes read and written, one series per direction, counted up since boot.",
  },
  {
    metricName: "system.disk.operations",
    splitBy: DISK_DIRECTION_KEYS,
    meaning:
      "Read and write operations, one series per direction, counted up since boot.",
  },
];

// The split of `metricName`, or undefined when it is read as one number.
export function getAttributeSplitMetric(
  metricName: string | undefined,
): AttributeSplitMetric | undefined {
  if (!metricName) {
    return undefined;
  }

  return ATTRIBUTE_SPLIT_METRICS.find(
    (metric: AttributeSplitMetric): boolean => {
      return metric.metricName === metricName;
    },
  );
}

/*
 * Whether a read already decides the split itself: it filters on one of the
 * split's attributes (state=idle) or groups by one. Then it is read as asked.
 */
export function isSplitDecidedByCaller(data: {
  split: AttributeSplitMetric;
  attributeFilterKeys: ReadonlyArray<string>;
  groupBy: ReadonlyArray<string>;
}): boolean {
  return data.split.splitBy.some((key: string): boolean => {
    return data.attributeFilterKeys.includes(key) || data.groupBy.includes(key);
  });
}
