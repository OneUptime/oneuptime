/*
 * The fixture's dashboard and the readings its metric tables show, shared by
 * the dashboard inside OneUptime (AppFixture.js) and the public one
 * (PublicFixture.js).
 *
 * One dashboard ("Host saturation", Past 1 Hour) of metric tables colored by
 * thresholds (issue #5231), the shape the customer described: CPU, memory
 * and disk per host.
 *
 *   saturation  grouped by host.name: CPU and Memory in use (fractions of 1,
 *               shown as percents) at 80 and 90, Free disk (a percent,
 *               lower is worse) at 20 and 10, and Load with no thresholds;
 *               Colored text
 *   filled      the same columns, Colored background
 *   overTime    CPU in use over time, one row a bucket, at 80 and 90
 *
 * Every metric read is answered as OneUptime's metrics API answers it,
 * NEWEST bucket first; a grouped read answers each host's newest bucket
 * with the host's reading, and its older buckets with a lower one, so a
 * table that reduced the wrong way would show the wrong colors.
 */
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import ObjectID from "Common/Types/ObjectID";

export const PROJECT_ID = "10000000-0000-4000-8000-000000005231";

export const DASHBOARD_ID = "db000000-0000-4000-8000-000000005231";

export const WIDGETS = {
  saturation: "c0000000-0000-4000-8000-0000000052a1",
  filled: "c0000000-0000-4000-8000-0000000052a2",
  overTime: "c0000000-0000-4000-8000-0000000052a3",
};

export const METRICS = {
  cpu: "system.cpu.utilization",
  memory: "system.memory.utilization",
  freeDisk: "disk.free.percent",
  load: "system.cpu.load_average.1m",
};

export const METRIC_TYPES = [
  [METRICS.cpu, "1"],
  [METRICS.memory, "1"],
  [METRICS.freeDisk, "%"],
  [METRICS.load, "1"],
];

/*
 * Each host's newest reading. CPU and memory are fractions of 1, as the
 * host metrics receiver sends them; free disk is already a percent. The
 * readings sit on, under and past each threshold, so every level is drawn:
 * web-2's CPU and db-1's memory are warnings, web-3's CPU, db-1's memory
 * and db-2's free disk critical, and worker-1's 79.96% CPU reads 80.0% at
 * one decimal - a warning, as it reads.
 */
export const HOSTS = [
  { host: "web-1", cpu: 0.42, memory: 0.61, freeDisk: 55, load: 1.2 },
  { host: "web-2", cpu: 0.84, memory: 0.72, freeDisk: 48, load: 3.4 },
  { host: "web-3", cpu: 0.93, memory: 0.88, freeDisk: 9, load: 7.9 },
  { host: "db-1", cpu: 0.67, memory: 0.94, freeDisk: 18, load: 2.1 },
  { host: "db-2", cpu: 0.31, memory: 0.45, freeDisk: 3, load: 0.8 },
  { host: "cache-1", cpu: 0.12, memory: 0.81, freeDisk: null, load: 0.3 },
  { host: "worker-1", cpu: 0.7996, memory: 0.52, freeDisk: 20, load: 1.9 },
  { host: "worker-2", cpu: 0.9, memory: 0.66, freeDisk: 34, load: 4.4 },
];

// CPU in use over time, oldest bucket first, for the table over time.
export const CPU_OVER_TIME = [0.5, 0.72, 0.81, 0.88, 0.93, 0.97];

export const USAGE_THRESHOLDS = {
  warning: 80,
  critical: 90,
  direction: "HigherIsWorse",
};

export const FREE_DISK_THRESHOLDS = {
  warning: 20,
  critical: 10,
  direction: "LowerIsWorse",
};

const column = (data) => {
  return {
    id: data.id,
    variable: data.variable,
    header: data.header,
    kind: "Metric",
    showAsColumn: true,
    metricName: data.metricName,
    aggregation: "Avg",
    decimals: 1,
    ...(data.thresholds ? { thresholds: { ...data.thresholds } } : {}),
  };
};

export const hostColumns = () => {
  return [
    column({
      id: "cpu",
      variable: "a",
      header: "CPU",
      metricName: METRICS.cpu,
      thresholds: USAGE_THRESHOLDS,
    }),
    column({
      id: "memory",
      variable: "b",
      header: "Memory",
      metricName: METRICS.memory,
      thresholds: USAGE_THRESHOLDS,
    }),
    column({
      id: "free",
      variable: "c",
      header: "Free disk",
      metricName: METRICS.freeDisk,
      thresholds: FREE_DISK_THRESHOLDS,
    }),
    column({
      id: "load",
      variable: "d",
      header: "Load",
      metricName: METRICS.load,
    }),
  ];
};

const table = (data) => {
  return {
    _type: "DashboardComponent",
    componentType: "Table",
    componentId: new ObjectID(data.id),
    topInDashboardUnits: data.top,
    leftInDashboardUnits: data.left,
    widthInDashboardUnits: data.width,
    heightInDashboardUnits: data.height,
    minWidthInDashboardUnits: 4,
    minHeightInDashboardUnits: 3,
    arguments: data.arguments,
  };
};

// The dashboard's config as the server stores it.
export const buildConfig = () => {
  return {
    _type: "DashboardViewConfig",
    components: [
      table({
        id: WIDGETS.saturation,
        top: 0,
        left: 0,
        width: 8,
        height: 5,
        arguments: {
          tableTitle: "Host saturation",
          tableDescription: "CPU, memory and disk, per host",
          groupByAttributes: [{ key: "host.name", header: "Host" }],
          columns: hostColumns(),
          maxRows: 25,
          decimals: 1,
        },
      }),
      table({
        id: WIDGETS.overTime,
        top: 0,
        left: 8,
        width: 4,
        height: 5,
        arguments: {
          tableTitle: "CPU over time",
          groupByAttributes: [],
          columns: [hostColumns()[0]],
          maxRows: 25,
          decimals: 1,
        },
      }),
      table({
        id: WIDGETS.filled,
        top: 5,
        left: 0,
        width: 8,
        height: 5,
        arguments: {
          tableTitle: "Fleet at a glance",
          groupByAttributes: [{ key: "host.name", header: "Host" }],
          columns: hostColumns(),
          maxRows: 25,
          decimals: 1,
          thresholdStyle: "Background",
        },
      }),
    ],
    heightInDashboardUnits: 10,
    timeRange: "Past 1 Hour",
  };
};

/*
 * The buckets of a window, oldest first, at the interval the server picks
 * for it.
 */
export const bucketsOf = (start, end) => {
  const interval = AggregationIntervalUtil.getAggregationIntervalForWindow({
    startDate: new Date(start),
    endDate: new Date(end),
  });
  const widthMs = AggregationIntervalUtil.getAggregationIntervalMs(interval);
  const first = Math.floor(start / widthMs) * widthMs;
  const buckets = [];

  for (let time = first; time <= end; time += widthMs) {
    buckets.push(time);
  }

  return buckets;
};

const readingOf = (host, metricName) => {
  switch (metricName) {
    case METRICS.cpu:
      return host.cpu;
    case METRICS.memory:
      return host.memory;
    case METRICS.freeDisk:
      return host.freeDisk;
    case METRICS.load:
      return host.load;
    default:
      return null;
  }
};

/*
 * One metric's points across [start, end], oldest first. Grouped by
 * host.name: each host's last three buckets, its reading in the newest and
 * half of it in the two before (the table reduces by its last value). Not
 * grouped: CPU over time, one point a bucket, the newest buckets last.
 */
export const pointsFor = (data) => {
  const buckets = bucketsOf(data.start, data.end);
  const grouped =
    Array.isArray(data.groupByAttributeKeys) &&
    data.groupByAttributeKeys.includes("host.name");
  const points = [];

  if (grouped) {
    const recent = buckets.slice(-3);

    recent.forEach((time, index) => {
      const isNewest = index === recent.length - 1;

      for (const host of HOSTS) {
        const reading = readingOf(host, data.metricName);

        if (reading === null) {
          continue;
        }

        points.push({
          time,
          value: isNewest ? reading : reading / 2,
          attributes: { "host.name": host.host },
        });
      }
    });

    return points;
  }

  if (data.metricName !== METRICS.cpu) {
    return points;
  }

  const recent = buckets.slice(-CPU_OVER_TIME.length);

  recent.forEach((time, index) => {
    points.push({ time, value: CPU_OVER_TIME[index] });
  });

  return points;
};
