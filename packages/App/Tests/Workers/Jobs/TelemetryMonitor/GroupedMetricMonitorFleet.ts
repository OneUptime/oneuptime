import Alert from "Common/Models/DatabaseModels/Alert";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { JSONObject } from "Common/Types/JSON";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepMetricMonitorUtil } from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import MetricSeriesFingerprint from "Common/Utils/Metrics/MetricSeriesFingerprint";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";

/*
 * THE FLEET OF ISSUE #10108, AS CLICKHOUSE ANSWERS FOR IT.
 *
 * One Metrics monitor over about 460 Docker hosts, every 5 minutes over the
 * past 5 minutes: four queries - container.restarts at its Maximum and its
 * Minimum, container.uptime at its Minimum, container.pids.count at its
 * Maximum - each grouped by resource.host.name and resource.container.name,
 * one formula (the restarts in each minute), and three criteria that open
 * low-severity alerts and resolve them on their own. About 16,250 host x
 * container series, which docker_stats reports every 120 seconds.
 *
 * Everything here is drawn from one seed, so the same options always build
 * the same fleet: the series, what each query's read returns (the JSON text
 * ClickHouse sends, a row per series and minute), what each series' arrival
 * read returns, the alerts already open when the check starts, and the
 * monitor itself. GroupedMetricMonitorHarness answers the worker's reads
 * with it; the equivalence test and the benchmark judge the same fleet.
 *
 * Most series are steady and match nothing. A few in a thousand are each of
 * the cases a criteria has to tell apart: a container that restarted in the
 * window, one that started minutes ago, one holding too many tasks, one whose
 * data stopped, one that only appeared, one with a missing reading. Some
 * have an alert open already - still breaching, recovered, or gone from the
 * data - so the check resolves some alerts, keeps others and opens new ones.
 */

export const FLEET_PROJECT_ID: ObjectID = new ObjectID(
  "10108000-0000-4000-8000-000000000001",
);
export const FLEET_MONITOR_ID: ObjectID = new ObjectID(
  "10108000-0000-4000-8000-000000000002",
);
export const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "10108000-0000-4000-8000-000000000003",
);
export const DEGRADED_STATUS_ID: ObjectID = new ObjectID(
  "10108000-0000-4000-8000-000000000004",
);
export const LOW_ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "10108000-0000-4000-8000-000000000005",
);
export const ALERT_IDENTIFIED_STATE_ID: ObjectID = new ObjectID(
  "10108000-0000-4000-8000-000000000006",
);
export const ALERT_ACKNOWLEDGED_STATE_ID: ObjectID = new ObjectID(
  "10108000-0000-4000-8000-000000000007",
);
export const ALERT_RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "10108000-0000-4000-8000-000000000008",
);
export const INCIDENT_RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "10108000-0000-4000-8000-000000000009",
);

export const HOST_KEY: string = "resource.host.name";
export const CONTAINER_KEY: string = "resource.container.name";
export const GROUP_BY_KEYS: Array<string> = [HOST_KEY, CONTAINER_KEY];

export const RESTARTS_METRIC: string = "container.restarts";
export const UPTIME_METRIC: string = "container.uptime";
export const PIDS_METRIC: string = "container.pids.count";

export const RESTARTED_CRITERIA_ID: string = "criteria-container-restarted";
export const JUST_STARTED_CRITERIA_ID: string =
  "criteria-container-just-started";
export const TOO_MANY_TASKS_CRITERIA_ID: string =
  "criteria-container-too-many-tasks";

// How often docker_stats reports a container, and how often a crash loop does.
const REPORT_EVERY_MS: number = 120_000;
const RESTARTING_REPORT_EVERY_MS: number = 30_000;

const SECOND_MS: number = 1_000;
const MINUTE_MS: number = 60 * SECOND_MS;
const WINDOW_MS: number = 5 * MINUTE_MS;

// Containers a host runs: about 16,250 series over about 460 hosts.
export const CONTAINERS_PER_HOST: number = 35;

// What a series is doing in the window.
export enum SeriesProfile {
  Steady = "steady",
  // Restarted inside the window: its restart count grows within a minute.
  Restarting = "restarting",
  // Started 10 to 14 minutes ago: its uptime stays below 15 minutes.
  JustStarted = "just-started",
  // Holds more than 2,000 tasks for the whole window.
  TooManyTasks = "too-many-tasks",
  // Holds too many tasks, but its data stopped part way through the window.
  StaleTooManyTasks = "stale-too-many-tasks",
  // Appeared two minutes ago, holding too many tasks.
  NewTooManyTasks = "new-too-many-tasks",
  // Holds too many tasks, with one reading missing in the middle.
  HoleTooManyTasks = "hole-too-many-tasks",
}

export interface FleetSeries {
  index: number;
  host: string;
  container: string;
  labels: JSONObject;
  fingerprint: string;
  profile: SeriesProfile;
}

// An alert the monitor has open when the check starts.
export interface OpenFleetAlert {
  alert: Alert;
  // Why it is open, for the reader of a failing test.
  reason: string;
}

export interface GroupedMetricFleetOptions {
  seriesCount: number;
  // The end of the window the check judges.
  windowEndMs: number;
  seed?: number | undefined;
  /*
   * How many in a thousand series are each special profile. The equivalence
   * fleet asks for more of them than the benchmark's, so a small fleet still
   * holds every case several times.
   */
  specialPerThousand?: number | undefined;
  /*
   * Every series steady: no criteria matches, so the check resolves what is
   * open and puts the monitor back on its default status.
   */
  allSteady?: boolean | undefined;
  // The monitor's status when the check starts: Degraded, or Operational.
  startsDegraded?: boolean | undefined;
}

export interface GroupedMetricFleet {
  options: GroupedMetricFleetOptions;
  windowStartMs: number;
  windowEndMs: number;
  series: Array<FleetSeries>;
  step: MonitorStep;
  monitor: Monitor;
  metricTypes: Array<MetricType>;
  // A read's answer, as ClickHouse sends it (format JSON), by readKey.
  valueAnswers: Map<string, Buffer>;
  // An arrival read's answer, by metric name.
  arrivalAnswers: Map<string, Buffer>;
  openAlerts: Array<OpenFleetAlert>;
  // Rows each read returns, for the report.
  valueRowCounts: Map<string, number>;
  arrivalRowCounts: Map<string, number>;
}

// What the reads are keyed by: a metric and how it is aggregated.
export function readKey(
  metricName: string,
  aggregation: MetricsAggregationType | string,
): string {
  return `${metricName}|${String(aggregation).toLowerCase()}`;
}

// One reading a container sends.
interface Sample {
  timeMs: number;
  createdAtMs: number;
  restarts: number;
  uptimeSeconds: number;
  pids: number;
}

const SERVICES: Array<string> = [
  "checkout-api",
  "payments-worker",
  "catalog-search",
  "inventory-sync",
  "web-frontend",
  "auth-gateway",
  "notification-dispatcher",
  "metrics-collector",
  "redis-cache",
  "postgres-replica",
  "nginx-edge",
  "image-resizer",
];

function hostName(hostIndex: number): string {
  return `docker-host-${String(hostIndex).padStart(4, "0")}.prod.fleet.internal`;
}

function containerName(hostIndex: number, containerIndex: number): string {
  const service: string = SERVICES[containerIndex % SERVICES.length]!;
  return `${service}-${hostIndex % 7}-${containerIndex}`;
}

function toClickhouseDateTime64(ms: number): string {
  // "2026-11-17 10:04:00.000000000", as ClickHouse writes a DateTime64(9).
  const iso: string = new Date(ms).toISOString();
  return `${iso.substring(0, 10)} ${iso.substring(11, 19)}.${iso.substring(20, 23)}000000`;
}

function pickProfiles(input: {
  seriesCount: number;
  random: SeededRandom;
  specialPerThousand: number;
}): Array<SeriesProfile> {
  const profiles: Array<SeriesProfile> = new Array(input.seriesCount).fill(
    SeriesProfile.Steady,
  );

  const specials: Array<SeriesProfile> = [
    SeriesProfile.Restarting,
    SeriesProfile.JustStarted,
    SeriesProfile.TooManyTasks,
    SeriesProfile.StaleTooManyTasks,
    SeriesProfile.NewTooManyTasks,
    SeriesProfile.HoleTooManyTasks,
  ];

  // At least four of each, whatever the fleet's size.
  const perProfile: number = Math.max(
    4,
    Math.round((input.seriesCount * input.specialPerThousand) / 1000),
  );

  for (const profile of specials) {
    let placed: number = 0;
    let attempts: number = 0;

    while (placed < perProfile && attempts < input.seriesCount * 4) {
      attempts++;
      const index: number = input.random(input.seriesCount);

      if (profiles[index] !== SeriesProfile.Steady) {
        continue;
      }

      profiles[index] = profile;
      placed++;
    }
  }

  return profiles;
}

// The readings of one series that fall in the window.
function samplesOf(input: {
  series: FleetSeries;
  windowStartMs: number;
  windowEndMs: number;
  random: SeededRandom;
}): Array<Sample> {
  const profile: SeriesProfile = input.series.profile;
  const everyMs: number =
    profile === SeriesProfile.Restarting
      ? RESTARTING_REPORT_EVERY_MS
      : REPORT_EVERY_MS;

  // When in its cycle it reports, and how long its newest reading takes to land.
  const phaseMs: number = input.random(everyMs / SECOND_MS) * SECOND_MS;
  const arrivesAfterMs: number = (1 + input.random(8)) * SECOND_MS;

  let firstMs: number = input.windowStartMs + phaseMs;
  let lastMs: number = input.windowEndMs - arrivesAfterMs;

  if (profile === SeriesProfile.StaleTooManyTasks) {
    // Its last reading is from about four minutes ago.
    lastMs = input.windowStartMs + 70 * SECOND_MS;
    firstMs = input.windowStartMs + 5 * SECOND_MS;
  }

  if (profile === SeriesProfile.NewTooManyTasks) {
    firstMs = input.windowEndMs - 2 * MINUTE_MS + phaseMs / 4;
  }

  const startedAgoMs: number =
    profile === SeriesProfile.JustStarted
      ? (10 + input.random(4)) * MINUTE_MS
      : (2 + input.random(40)) * 24 * 60 * MINUTE_MS;
  const startedAtMs: number = input.windowEndMs - startedAgoMs;

  const baseRestarts: number = input.random(6);
  // A crash loop restarts once, between two readings of the same minute.
  const restartAtMs: number =
    input.windowStartMs + (1 + input.random(3)) * MINUTE_MS + 20 * SECOND_MS;

  const isBusy: boolean =
    profile === SeriesProfile.TooManyTasks ||
    profile === SeriesProfile.StaleTooManyTasks ||
    profile === SeriesProfile.NewTooManyTasks ||
    profile === SeriesProfile.HoleTooManyTasks;
  const basePids: number = isBusy
    ? 2_150 + input.random(400)
    : 5 + input.random(300);

  const samples: Array<Sample> = [];
  let readingIndex: number = 0;

  for (let timeMs: number = firstMs; timeMs <= lastMs; timeMs += everyMs) {
    readingIndex++;

    // One reading of the middle of the window never arrived.
    if (profile === SeriesProfile.HoleTooManyTasks && readingIndex === 2) {
      continue;
    }

    const restarts: number =
      profile === SeriesProfile.Restarting && timeMs >= restartAtMs
        ? baseRestarts + 1
        : baseRestarts;

    samples.push({
      timeMs: timeMs,
      createdAtMs: timeMs + arrivesAfterMs,
      restarts: restarts,
      uptimeSeconds: Math.max(0, Math.floor((timeMs - startedAtMs) / 1000)),
      pids: basePids + input.random(25),
    });
  }

  return samples;
}

interface MinuteBucket {
  minuteMs: number;
  samples: Array<Sample>;
}

function bucketByMinute(samples: Array<Sample>): Array<MinuteBucket> {
  const buckets: Map<number, MinuteBucket> = new Map();

  for (const sample of samples) {
    const minuteMs: number = Math.floor(sample.timeMs / MINUTE_MS) * MINUTE_MS;
    let bucket: MinuteBucket | undefined = buckets.get(minuteMs);

    if (!bucket) {
      bucket = { minuteMs: minuteMs, samples: [] };
      buckets.set(minuteMs, bucket);
    }

    bucket.samples.push(sample);
  }

  return Array.from(buckets.values());
}

interface QueryDefinition {
  variable: string;
  metricName: string;
  aggregation: MetricsAggregationType;
  title: string;
  read: (samples: Array<Sample>) => number;
}

export const QUERIES: Array<QueryDefinition> = [
  {
    variable: "a",
    metricName: RESTARTS_METRIC,
    aggregation: MetricsAggregationType.Max,
    title: "Restarts (highest)",
    read: (samples: Array<Sample>): number => {
      return Math.max(
        ...samples.map((sample: Sample): number => {
          return sample.restarts;
        }),
      );
    },
  },
  {
    variable: "b",
    metricName: RESTARTS_METRIC,
    aggregation: MetricsAggregationType.Min,
    title: "Restarts (lowest)",
    read: (samples: Array<Sample>): number => {
      return Math.min(
        ...samples.map((sample: Sample): number => {
          return sample.restarts;
        }),
      );
    },
  },
  {
    variable: "c",
    metricName: UPTIME_METRIC,
    aggregation: MetricsAggregationType.Min,
    title: "Uptime",
    read: (samples: Array<Sample>): number => {
      return Math.min(
        ...samples.map((sample: Sample): number => {
          return sample.uptimeSeconds;
        }),
      );
    },
  },
  {
    variable: "d",
    metricName: PIDS_METRIC,
    aggregation: MetricsAggregationType.Max,
    title: "Tasks",
    read: (samples: Array<Sample>): number => {
      return Math.max(
        ...samples.map((sample: Sample): number => {
          return sample.pids;
        }),
      );
    },
  },
];

function queryConfig(query: QueryDefinition): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: query.variable,
      title: query.title,
      description: query.title,
      legend: query.title,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: query.metricName,
        attributes: {},
        aggegationType: query.aggregation,
        aggregateBy: {},
      } as unknown as MetricQueryConfigData["metricQueryData"]["filterData"],
      groupByAttributeKeys: [...GROUP_BY_KEYS],
    },
  };
}

function formulaConfig(): MetricFormulaConfigData {
  return {
    metricAliasData: {
      metricVariable: "e",
      title: "Restarts in the minute",
      description: "Restarts in the minute",
      legend: "Restarts in the minute",
      legendUnit: undefined,
    },
    metricFormulaData: {
      metricFormula: "a - b",
    },
  };
}

function criteriaInstance(input: {
  id: string;
  name: string;
  filter: CriteriaFilter;
  alertTitle: string;
  alertDescription: string;
  changesStatus: boolean;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: input.id,
    name: input.name,
    description: input.name,
    monitorStatusId: input.changesStatus ? DEGRADED_STATUS_ID : undefined,
    filterCondition: FilterCondition.Any,
    filters: [input.filter],
    incidents: [],
    alerts: [
      {
        id: `${input.id}-alert`,
        title: input.alertTitle,
        description: input.alertDescription,
        alertSeverityId: LOW_ALERT_SEVERITY_ID,
        autoResolveAlert: true,
        onCallPolicyIds: [],
      },
    ],
    changeMonitorStatus: input.changesStatus,
    createIncidents: false,
    createAlerts: true,
  };

  return instance;
}

export function buildFleetStep(): MonitorStep {
  const step: MonitorStep = new MonitorStep();

  step.setMetricMonitor({
    ...MonitorStepMetricMonitorUtil.getDefault(),
    metricViewConfig: {
      queryConfigs: QUERIES.map(queryConfig),
      formulaConfigs: [formulaConfig()],
    },
    rollingTime: RollingTime.Past5Minutes,
  });

  const criteria: MonitorCriteria = new MonitorCriteria();

  criteria.data = {
    monitorCriteriaInstanceArray: [
      criteriaInstance({
        id: TOO_MANY_TASKS_CRITERIA_ID,
        name: "Container holds too many tasks",
        filter: {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.GreaterThan,
          value: 2000,
          metricMonitorOptions: {
            metricAlias: "d",
            metricAggregationType: EvaluateOverTimeType.AllValues,
          },
        },
        alertTitle:
          "{{resource.host.name}} {{resource.container.name}} holds too many tasks",
        alertDescription:
          "{{resource.container.name}} on {{resource.host.name}} held more than 2,000 tasks for the whole window.",
        changesStatus: true,
      }),
      criteriaInstance({
        id: RESTARTED_CRITERIA_ID,
        name: "Container restarted",
        filter: {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.GreaterThan,
          value: 0,
          metricMonitorOptions: {
            metricAlias: "e",
            metricAggregationType: EvaluateOverTimeType.AnyValue,
          },
        },
        alertTitle:
          "{{resource.host.name}} {{resource.container.name}} restarted",
        alertDescription:
          "{{resource.container.name}} on {{resource.host.name}} restarted in the last 5 minutes.",
        changesStatus: false,
      }),
      criteriaInstance({
        id: JUST_STARTED_CRITERIA_ID,
        name: "Container just started",
        filter: {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.LessThan,
          value: 900,
          metricMonitorOptions: {
            metricAlias: "c",
            metricAggregationType: EvaluateOverTimeType.AllValues,
          },
        },
        alertTitle:
          "{{resource.host.name}} {{resource.container.name}} started less than 15 minutes ago",
        alertDescription:
          "{{resource.container.name}} on {{resource.host.name}} has been up for less than 15 minutes.",
        changesStatus: false,
      }),
    ],
  };

  step.setMonitorCriteria(criteria);

  return step;
}

function buildMonitor(step: MonitorStep, startsDegraded: boolean): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = FLEET_MONITOR_ID;
  monitor.projectId = FLEET_PROJECT_ID;
  monitor.name = "Fleet containers";
  monitor.monitorType = MonitorType.Metrics;
  monitor.currentMonitorStatusId = startsDegraded
    ? DEGRADED_STATUS_ID
    : OPERATIONAL_STATUS_ID;
  monitor.monitoringInterval = "*/5 * * * *";
  monitor.isArchived = false;
  monitor.disableActiveMonitoring = false;
  monitor.disableActiveMonitoringBecauseOfManualIncident = false;
  monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = false;
  monitor.labels = [];
  monitor.customFields = {};
  monitor.dependsOnMonitors = [];
  monitor.suppressAlertsWhenParentMonitorStatuses = [];
  // Measured long ago: no first result to stamp.
  monitor.createdAt = new Date(Date.UTC(2026, 0, 1));
  monitor.firstMeasuredAt = new Date(Date.UTC(2026, 0, 1, 0, 5));

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: OPERATIONAL_STATUS_ID,
  };
  monitor.monitorSteps = steps;

  return monitor;
}

function buildMetricTypes(): Array<MetricType> {
  return [
    { name: RESTARTS_METRIC, unit: "{restarts}", isMonotonic: false },
    { name: UPTIME_METRIC, unit: "s", isMonotonic: false },
    { name: PIDS_METRIC, unit: "{tasks}", isMonotonic: false },
  ].map(
    (entry: {
      name: string;
      unit: string;
      isMonotonic: boolean;
    }): MetricType => {
      const metricType: MetricType = new MetricType();
      metricType.name = entry.name;
      metricType.unit = entry.unit;
      metricType.isMonotonic = entry.isMonotonic;
      return metricType;
    },
  );
}

function openAlert(input: {
  number: number;
  criteriaId: string;
  series: FleetSeries | { fingerprint: string; labels: JSONObject };
  title: string;
  createdAtMs: number;
}): Alert {
  const alert: Alert = new Alert();
  alert._id = `10108000-0000-4000-9000-${String(input.number).padStart(12, "0")}`;
  alert.projectId = FLEET_PROJECT_ID;
  alert.title = input.title;
  alert.createdAt = new Date(input.createdAtMs);
  alert.createdCriteriaId = input.criteriaId;
  alert.alertNumber = input.number;
  alert.alertNumberWithPrefix = `A-${input.number}`;
  alert.currentAlertStateId = ALERT_IDENTIFIED_STATE_ID;
  alert.seriesFingerprint = input.series.fingerprint;
  alert.seriesLabels = input.series.labels;
  return alert;
}

function buildOpenAlerts(input: {
  series: Array<FleetSeries>;
  windowStartMs: number;
}): Array<OpenFleetAlert> {
  const ofProfile: (profile: SeriesProfile) => Array<FleetSeries> = (
    profile: SeriesProfile,
  ): Array<FleetSeries> => {
    return input.series.filter((series: FleetSeries): boolean => {
      return series.profile === profile;
    });
  };

  const steady: Array<FleetSeries> = ofProfile(SeriesProfile.Steady);
  const openAlerts: Array<OpenFleetAlert> = [];
  let number: number = 1;

  const add: (
    criteriaId: string,
    series: FleetSeries | { fingerprint: string; labels: JSONObject },
    reason: string,
  ) => void = (
    criteriaId: string,
    series: FleetSeries | { fingerprint: string; labels: JSONObject },
    reason: string,
  ): void => {
    openAlerts.push({
      alert: openAlert({
        number: number,
        criteriaId: criteriaId,
        series: series,
        title: `Open alert ${number} (${criteriaId})`,
        createdAtMs: input.windowStartMs - (number + 1) * MINUTE_MS,
      }),
      reason: reason,
    });
    number++;
  };

  // Still breaching: kept open, nothing new opened for them.
  for (const series of ofProfile(SeriesProfile.TooManyTasks).slice(0, 2)) {
    add(TOO_MANY_TASKS_CRITERIA_ID, series, "still holds too many tasks");
  }
  for (const series of ofProfile(SeriesProfile.Restarting).slice(0, 1)) {
    add(RESTARTED_CRITERIA_ID, series, "restarted again");
  }
  for (const series of ofProfile(SeriesProfile.JustStarted).slice(0, 1)) {
    add(JUST_STARTED_CRITERIA_ID, series, "still just started");
  }

  /*
   * Its data stopped part way through the window, and it held too many tasks
   * while it reported: the criteria is in effect for it, so it is judged on
   * its data points and stays open.
   */
  for (const series of ofProfile(SeriesProfile.StaleTooManyTasks).slice(0, 1)) {
    add(TOO_MANY_TASKS_CRITERIA_ID, series, "stale, judged on its data");
  }

  // Recovered: resolved by this check.
  for (const series of steady.slice(0, 3)) {
    add(TOO_MANY_TASKS_CRITERIA_ID, series, "back under 2,000 tasks");
  }
  for (const series of steady.slice(3, 5)) {
    add(RESTARTED_CRITERIA_ID, series, "no restart in the window");
  }
  for (const series of steady.slice(5, 6)) {
    add(JUST_STARTED_CRITERIA_ID, series, "up for days now");
  }

  // Gone from the data: resolved too.
  const goneLabels: JSONObject = {
    [HOST_KEY]: "docker-host-9999.prod.fleet.internal",
    [CONTAINER_KEY]: "decommissioned-batch-job",
  };
  add(
    TOO_MANY_TASKS_CRITERIA_ID,
    {
      fingerprint: MetricSeriesFingerprint.computeFingerprint(goneLabels),
      labels: goneLabels,
    },
    "its container is gone",
  );

  return openAlerts;
}

function toAnswer(input: {
  meta: Array<{ name: string; type: string }>;
  rows: Array<JSONObject>;
}): Buffer {
  return Buffer.from(
    JSON.stringify({
      meta: input.meta,
      data: input.rows,
      rows: input.rows.length,
      statistics: {
        elapsed: 0.2,
        rows_read: input.rows.length * 40,
        bytes_read: input.rows.length * 2400,
      },
    }),
    "utf8",
  );
}

export function buildGroupedMetricFleet(
  options: GroupedMetricFleetOptions,
): GroupedMetricFleet {
  const random: SeededRandom = seededRandom(options.seed ?? 10108);
  const windowEndMs: number = options.windowEndMs;
  const windowStartMs: number = windowEndMs - WINDOW_MS;

  const profiles: Array<SeriesProfile> = options.allSteady
    ? new Array(options.seriesCount).fill(SeriesProfile.Steady)
    : pickProfiles({
        seriesCount: options.seriesCount,
        random: random,
        specialPerThousand: options.specialPerThousand ?? 1,
      });

  const series: Array<FleetSeries> = [];

  for (let index: number = 0; index < options.seriesCount; index++) {
    const hostIndex: number = Math.floor(index / CONTAINERS_PER_HOST);
    const host: string = hostName(hostIndex);
    const container: string = containerName(
      hostIndex,
      index % CONTAINERS_PER_HOST,
    );
    const labels: JSONObject = { [HOST_KEY]: host, [CONTAINER_KEY]: container };

    series.push({
      index: index,
      host: host,
      container: container,
      labels: labels,
      fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
      profile: profiles[index]!,
    });
  }

  // Every series' readings, then each read's rows.
  const valueRows: Map<string, Array<JSONObject>> = new Map();
  const arrivalRows: Map<string, Array<JSONObject>> = new Map();

  for (const query of QUERIES) {
    valueRows.set(readKey(query.metricName, query.aggregation), []);
    arrivalRows.set(query.metricName, []);
  }

  for (const entry of series) {
    const samples: Array<Sample> = samplesOf({
      series: entry,
      windowStartMs: windowStartMs,
      windowEndMs: windowEndMs,
      random: random,
    });

    if (samples.length === 0) {
      continue;
    }

    const buckets: Array<MinuteBucket> = bucketByMinute(samples);
    const attributes: JSONObject = {
      [HOST_KEY]: entry.host,
      [CONTAINER_KEY]: entry.container,
    };

    for (const query of QUERIES) {
      const rows: Array<JSONObject> = valueRows.get(
        readKey(query.metricName, query.aggregation),
      )!;

      for (const bucket of buckets) {
        rows.push({
          value: query.read(bucket.samples),
          time: toClickhouseDateTime64(bucket.minuteMs),
          attributes: attributes,
        });
      }
    }

    // When its rows arrived, as readSeriesArrivals folds them.
    let newest: Sample = samples[0]!;
    let oldestCreatedAtMs: number = samples[0]!.createdAtMs;
    let newestCreatedAtMs: number = samples[0]!.createdAtMs;
    const arrivalMinutes: Set<number> = new Set();

    for (const sample of samples) {
      if (sample.timeMs > newest.timeMs) {
        newest = sample;
      }
      oldestCreatedAtMs = Math.min(oldestCreatedAtMs, sample.createdAtMs);
      newestCreatedAtMs = Math.max(newestCreatedAtMs, sample.createdAtMs);
      arrivalMinutes.add(Math.floor(sample.createdAtMs / MINUTE_MS));
    }

    for (const metricName of new Set<string>(
      QUERIES.map((query: QueryDefinition): string => {
        return query.metricName;
      }),
    )) {
      arrivalRows.get(metricName)!.push({
        __arrival_newest: Math.floor(newestCreatedAtMs / 1000),
        __arrival_oldest: Math.floor(oldestCreatedAtMs / 1000),
        __arrival_minutes: String(arrivalMinutes.size),
        __arrival_newest_point: Math.floor(newest.createdAtMs / 1000),
        __arrival_newest_point_time: String(newest.timeMs),
        attributes: attributes,
      });
    }
  }

  const valueAnswers: Map<string, Buffer> = new Map();
  const valueRowCounts: Map<string, number> = new Map();

  for (const [key, rows] of valueRows) {
    // ORDER BY time DESC, as the read asks.
    rows.sort((left: JSONObject, right: JSONObject): number => {
      return String(right["time"]).localeCompare(String(left["time"]));
    });

    valueAnswers.set(
      key,
      toAnswer({
        meta: [
          { name: "value", type: "Nullable(Float64)" },
          { name: "time", type: "DateTime64(9)" },
          { name: "attributes", type: "Map(String, String)" },
        ],
        rows: rows,
      }),
    );
    valueRowCounts.set(key, rows.length);
  }

  const arrivalAnswers: Map<string, Buffer> = new Map();
  const arrivalRowCounts: Map<string, number> = new Map();

  for (const [metricName, rows] of arrivalRows) {
    arrivalAnswers.set(
      metricName,
      toAnswer({
        meta: [
          { name: "__arrival_newest", type: "UInt32" },
          { name: "__arrival_oldest", type: "UInt32" },
          { name: "__arrival_minutes", type: "UInt64" },
          { name: "__arrival_newest_point", type: "UInt32" },
          { name: "__arrival_newest_point_time", type: "Int64" },
          { name: "attributes", type: "Map(String, String)" },
        ],
        rows: rows,
      }),
    );
    arrivalRowCounts.set(metricName, rows.length);
  }

  const step: MonitorStep = buildFleetStep();

  return {
    options: options,
    windowStartMs: windowStartMs,
    windowEndMs: windowEndMs,
    series: series,
    step: step,
    monitor: buildMonitor(step, Boolean(options.startsDegraded)),
    metricTypes: buildMetricTypes(),
    valueAnswers: valueAnswers,
    arrivalAnswers: arrivalAnswers,
    openAlerts: buildOpenAlerts({
      series: series,
      windowStartMs: windowStartMs,
    }),
    valueRowCounts: valueRowCounts,
    arrivalRowCounts: arrivalRowCounts,
  };
}
