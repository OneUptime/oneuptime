import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import {
  STOPPED_REPORTING_METRIC_ALIAS,
  buildHealthyCriteriaInstance,
  buildStoppedReportingCriteriaInstances,
  buildUnhealthyCriteriaInstance,
} from "./Recommendation/RecommendationCriteriaBuilder";
import { FilterType, EvaluateOverTimeType } from "./CriteriaFilter";
import MonitorStepHostMonitor from "./MonitorStepHostMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import { ANDROID_SECURITY_PATCH_MAX_AGE_DAYS } from "../Host/AndroidSecurityPatch";

export { ANDROID_SECURITY_PATCH_MAX_AGE_DAYS };

export type HostAlertTemplateCategory = "Availability" | "Resource" | "Host";

export type HostAlertTemplateSeverity = "Critical" | "Warning";

export interface HostAlertTemplateArgs {
  hostIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface HostAlertTemplate {
  id: string;
  name: string;
  /*
   * One plain sentence: when the template fires, with its threshold and
   * window, without metric names. The picker and a resource's
   * Recommendations list show it on the card; `description` (how it is
   * computed, and its caveats) is shown once a template is picked.
   */
  summary: string;
  description: string;
  category: HostAlertTemplateCategory;
  severity: HostAlertTemplateSeverity;
  getMonitorStep: (args: HostAlertTemplateArgs) => MonitorStep;
}

/*
 * Filter contract: a host monitor is already scoped to ONE host — the
 * worker adds `resource.host.name` from the step's hostIdentifier — so
 * host-scalar metrics (CPU utilization, memory utilization, load average,
 * process count) stay UNGROUPED: there is exactly one series per host and
 * grouping would buy nothing.
 *
 * Metrics that are per-entity WITHIN the host are grouped, because the
 * hostmetrics receiver partitions them by unprefixed DATAPOINT labels
 * (never `resource.`-prefixed):
 *
 *   - `system.filesystem.*` -> `mountpoint` (also `device`, `state`)
 *   - `system.disk.*` / `system.network.*` -> `device` (also `direction`)
 *
 * Without a group-by, one full mount raises a single incident for the
 * whole host and every other mount that fills up afterwards is silenced
 * for as long as that incident stays open.
 */

export function buildHostMonitorStep(args: {
  hostMonitor: MonitorStepHostMonitor;
  offlineCriteriaInstance: MonitorCriteriaInstance;
  onlineCriteriaInstance: MonitorCriteriaInstance;
}): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();

  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [
      args.offlineCriteriaInstance,
      args.onlineCriteriaInstance,
    ],
  };

  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorDestination: undefined,
    doNotFollowRedirects: undefined,
    monitorDestinationPort: undefined,
    monitorCriteria: monitorCriteria,
    requestType: "GET" as any,
    requestHeaders: undefined,
    requestBody: undefined,
    customCode: undefined,
    screenSizeTypes: undefined,
    browserTypes: undefined,
    retryCountOnError: undefined,
    logMonitor: undefined,
    traceMonitor: undefined,
    metricMonitor: undefined,
    exceptionMonitor: undefined,
    snmpMonitor: undefined,
    dnsMonitor: undefined,
    domainMonitor: undefined,
    externalStatusPageMonitor: undefined,
    kubernetesMonitor: undefined,
    profileMonitor: undefined,
    hostMonitor: args.hostMonitor,
  };

  return monitorStep;
}

export function buildHostOfflineCriteriaInstance(args: {
  offlineMonitorStatusId: ObjectID;
  incidentSeverityId: ObjectID;
  alertSeverityId: ObjectID;
  monitorName: string;
  metricAlias: string;
  filterType: FilterType;
  value: number;
  incidentTitle?: string;
  incidentDescription?: string;
  criteriaName?: string;
  criteriaDescription?: string;
  metricAggregationType?: EvaluateOverTimeType | undefined;
}): MonitorCriteriaInstance {
  return buildUnhealthyCriteriaInstance({
    ...args,
    resourceNoun: "host",
  });
}

export function buildHostOnlineCriteriaInstance(args: {
  onlineMonitorStatusId: ObjectID;
  metricAlias: string;
  filterType: FilterType;
  value: number;
  recoveryValue?: number | undefined;
  marginFraction?: number | undefined;
  isBinaryMetric?: boolean | undefined;
  metricAggregationType?: EvaluateOverTimeType | undefined;
}): MonitorCriteriaInstance {
  return buildHealthyCriteriaInstance(args);
}

export function buildHostMonitorConfig(args: {
  hostIdentifier: string;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string>;
  /**
   * Attributes to split the metric by, one alert per group.
   *
   * More than one key is not just finer grouping — the group-by set is
   * exactly what the resulting alert can name. `mountpoint` alone says
   * WHICH mount filled up; adding `device` also says which physical
   * disk, which is the difference between "/var is full" and "/var is
   * full and it is on the same device as /". See SeriesLabelDisplay,
   * which renders these onto the alert's title and description.
   */
  groupByAttributeKeys?: Array<string> | undefined;
}): MonitorStepHostMonitor {
  return {
    hostIdentifier: args.hostIdentifier,
    metricViewConfig: {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: args.metricAlias,
            title: args.metricAlias,
            description: args.metricAlias,
            legend: args.metricAlias,
            legendUnit: undefined,
          },
          metricQueryData: {
            filterData: {
              metricName: args.metricName,
              attributes: args.attributes || {},
              aggegationType: args.aggregationType,
              aggregateBy: {},
            },
            ...(args.groupByAttributeKeys &&
            args.groupByAttributeKeys.length > 0
              ? { groupByAttributeKeys: args.groupByAttributeKeys }
              : {}),
          },
        },
      ],
      formulaConfigs: [],
    },
    rollingTime: args.rollingTime,
  };
}

/*
 * The identity an incident title should carry, as a suffix.
 *
 * NOT `monitorName`: the recommendation flow builds that as
 * `${resourceDisplayName} - ${template.name}`
 * (MonitorRecommendationUtil.getMonitorName) and feeds the whole string
 * back in here, so interpolating it produced titles that said the
 * template name twice — "[Host] High CPU Utilization (>80%) - web-01 -
 * High CPU Utilization". `hostIdentifier` is the agent-reported
 * `host.name` the metrics are actually tagged with, which is the one
 * identifier the reader needs, and it says it once.
 */
export function hostTitleSuffix(args: HostAlertTemplateArgs): string {
  const host: string = (args.hostIdentifier || "").trim();

  return host ? ` - ${host}` : "";
}

/**
 * A host metric that has to be DERIVED — from more than one series, or
 * from a raw ratio that has to be rescaled before anyone can read it.
 *
 * `system.cpu.utilization` is the case this exists for: the hostmetrics
 * cpu scraper partitions it by (cpu, state), and every cpu's states sum
 * to 1. Averaging the raw metric therefore lands at 1/(state count) —
 * ~0.125 on Linux — no matter how busy the host is, so a "> 0.8"
 * criteria is structurally unreachable. Pulling `state=user` and
 * `state=system` as separate queries and summing them yields the
 * "fraction of CPU time spent doing work" that `top` reports, and is the
 * same derivation the host Overview page charts (see
 * App/FeatureSet/Dashboard/src/Pages/Host/View/Overview.tsx).
 * `system.memory.utilization` is partitioned the same way, by `state`.
 *
 * UNITS: `legendUnit` is applied to the FORMULA alias only, never to the
 * operand queries. MetricResultUnitConverter converts query results from
 * their native OTel unit into the query alias's `legendUnit`, and
 * MetricUnitUtil treats the dimensionless "1" and "%" as one family — so
 * a `legendUnit: "%"` on an operand would scale it by 100 BEFORE the
 * formula's own `* 100` ran. Formula configs are never converted, so the
 * unit there is display metadata and the formula owns the scaling. That
 * is also why the `* 100` is written into the formula rather than
 * delegated to a query-level `legendUnit`: the converter is a silent
 * no-op whenever the metric's native unit was not recorded at ingest,
 * and the failure mode would be a [0, 1] sample compared against 80 —
 * a monitor that never fires and never says why.
 *
 * Name the operand aliases after the state they carry (`host_cpu_user`,
 * `host_memory_used`). A criteria bound to a formula alias reports the
 * FORMULA STRING as its metric name and an empty attribute map, so the
 * alias names are the only place the alert body can tell the reader
 * which slice of the metric was measured.
 *
 * This mirrors buildKubernetesRatioMonitorConfig.
 */
export function buildHostFormulaMonitorConfig(args: {
  hostIdentifier: string;
  queries: Array<{
    metricAlias: string;
    metricName: string;
    aggregationType: MetricsAggregationType;
    attributes?: Record<string, string> | undefined;
  }>;
  resultAlias: string;
  resultLegend: string;
  formula: string;
  legendUnit?: string | undefined;
  rollingTime: RollingTime;
  groupByAttributeKeys?: Array<string> | undefined;
}): MonitorStepHostMonitor {
  return {
    hostIdentifier: args.hostIdentifier,
    metricViewConfig: {
      queryConfigs: args.queries.map(
        (query: {
          metricAlias: string;
          metricName: string;
          aggregationType: MetricsAggregationType;
          attributes?: Record<string, string> | undefined;
        }) => {
          return {
            metricAliasData: {
              metricVariable: query.metricAlias,
              title: query.metricAlias,
              description: query.metricAlias,
              legend: query.metricAlias,
              // Never set here — see the UNITS note above.
              legendUnit: undefined,
            },
            metricQueryData: {
              filterData: {
                metricName: query.metricName,
                attributes: query.attributes || {},
                aggegationType: query.aggregationType,
                aggregateBy: {},
              },
              ...(args.groupByAttributeKeys &&
              args.groupByAttributeKeys.length > 0
                ? { groupByAttributeKeys: args.groupByAttributeKeys }
                : {}),
            },
          };
        },
      ),
      formulaConfigs: [
        {
          metricAliasData: {
            metricVariable: args.resultAlias,
            title: args.resultLegend,
            description: args.resultLegend,
            legend: args.resultLegend,
            legendUnit: args.legendUnit,
          },
          metricFormulaData: {
            metricFormula: args.formula,
          },
        },
      ],
    },
    rollingTime: args.rollingTime,
  };
}

// --- Template Definitions ---

const hostStoppedReportingTemplate: HostAlertTemplate = {
  id: "host-stopped-reporting",
  name: "Host Stopped Reporting",
  summary: "The host sends no metrics for 10 minutes.",
  description:
    "Alert when the host sends no metrics for ten minutes: the machine is down or unreachable, or its OpenTelemetry Collector stopped, lost its route to OneUptime or had its token revoked. Reads system.memory.usage, which the collector's memory scraper reports on every collection on Linux, macOS and Windows.",
  category: "Availability",
  severity: "Critical",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = STOPPED_REPORTING_METRIC_ALIAS;

    return buildHostMonitorStep({
      hostMonitor: buildHostMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        /*
         * The heartbeat. The hostmetrics memory scraper reports
         * system.memory.usage (once per memory `state`) on every
         * collection, with no optional metric to enable and on every
         * platform the receiver supports, so it is never missing while
         * the collector runs. Ungrouped and counted: only a window with no
         * row at all is the breach.
         */
        metricName: "system.memory.usage",
        metricAlias,
        rollingTime: RollingTime.Past10Minutes,
        aggregationType: MetricsAggregationType.Count,
      }),
      ...buildStoppedReportingCriteriaInstances({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        resourceNoun: "host",
        incidentTitle: `[Host] Host Stopped Reporting${hostTitleSuffix(args)}`,
        incidentDescription: `OneUptime has received no metrics from this host for ten minutes, so its other monitors have nothing to evaluate either. Check, in order: whether the machine is up and reachable, whether its OpenTelemetry Collector is running and what its log says, and whether the collector can still reach OneUptime with its token. The incident resolves on its own once metrics arrive again.`,
        criteriaName: "Host Stopped Reporting - No data for 10 minutes",
        criteriaDescription:
          "Triggers when the host sends no memory metrics for the whole ten-minute window.",
      }),
    });
  },
};

const highCpuTemplate: HostAlertTemplate = {
  id: "host-high-cpu",
  name: "High CPU Utilization",
  summary: "CPU stays more than 80% busy for the whole window.",
  description:
    "Alert when host CPU busy time (user + system) exceeds 80% for the whole evaluation window.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "host_cpu";

    return buildHostMonitorStep({
      /*
       * Busy CPU = user + system, each pulled as its own `state` series.
       * See buildHostFormulaMonitorConfig: averaging the raw metric
       * across all states lands at ~1/(state count) and never reaches any
       * threshold worth alerting on, so this template could not fire.
       *
       * `1 - idle` is the other way to derive this and is deliberately
       * NOT used: it breaks the moment a platform stops emitting the
       * `idle` state. user + system is what the host Overview page
       * charts, so the alert and the chart now agree.
       */
      hostMonitor: buildHostFormulaMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        queries: [
          {
            metricAlias: "host_cpu_user",
            metricName: "system.cpu.utilization",
            aggregationType: MetricsAggregationType.Avg,
            attributes: { state: "user" },
          },
          {
            metricAlias: "host_cpu_system",
            metricName: "system.cpu.utilization",
            aggregationType: MetricsAggregationType.Avg,
            attributes: { state: "system" },
          },
        ],
        resultAlias: metricAlias,
        resultLegend: "CPU Busy (%)",
        formula: "(host_cpu_user + host_cpu_system) * 100",
        legendUnit: "%",
        rollingTime: RollingTime.Past5Minutes,
      }),
      offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        // The formula already scales the [0, 1] ratio to percent, so 80 == 80%.
        value: 80,
        incidentTitle: `[Host] High CPU Utilization (>80%)${hostTitleSuffix(args)}`,
        incidentDescription: `CPU busy time (user + system) stayed above 80% for the whole evaluation window on this host. Sustained saturation here shows up as latency in everything the host runs. Iowait and steal are excluded, so this is work the host itself is doing. See the root cause below for the measured values.`,
        criteriaName: "High CPU - Utilization > 80%",
        criteriaDescription:
          "Triggers when host CPU busy time (user + system) exceeds 80% for every sample in the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 80,
      }),
    });
  },
};

const highMemoryTemplate: HostAlertTemplate = {
  id: "host-high-memory",
  name: "High Memory Utilization",
  summary: "Memory in use passes 85%, page cache not counted.",
  description:
    "Alert when memory in use — excluding buffers and page cache — exceeds 85% of physical memory.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "host_memory";

    return buildHostMonitorStep({
      /*
       * `state=used` only. The hostmetrics receiver emits this metric once
       * per memory state (used / free / buffered / cached / slab_* on
       * Linux, used / free / inactive on macOS) and a state set sums to 1,
       * so an unfiltered Avg sits at ~1/(state count) forever and could
       * never reach 0.85 — this template never fired. `used` is the same
       * state the host Overview memory tile reads, so the alert and the
       * page now agree.
       */
      hostMonitor: buildHostFormulaMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        queries: [
          {
            metricAlias: "host_memory_used",
            metricName: "system.memory.utilization",
            aggregationType: MetricsAggregationType.Avg,
            attributes: { state: "used" },
          },
        ],
        resultAlias: metricAlias,
        resultLegend: "Memory Used (%)",
        formula: "host_memory_used * 100",
        legendUnit: "%",
        rollingTime: RollingTime.Past5Minutes,
      }),
      offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        // The formula already scales the [0, 1] ratio to percent, so 85 == 85%.
        value: 85,
        incidentTitle: `[Host] High Memory Utilization (>85%)${hostTitleSuffix(args)}`,
        incidentDescription: `Memory in use — excluding buffers and page cache — stayed above 85% of physical memory for the whole evaluation window on this host. Sustained pressure here leads to swapping and OOM kills. A host that is mostly page cache will NOT trip this. See the root cause below for the measured values.`,
        criteriaName: "High Memory - Utilization > 85%",
        criteriaDescription:
          "Triggers when memory in use exceeds 85% of physical memory for every sample in the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 85,
      }),
    });
  },
};

const highFilesystemUsageTemplate: HostAlertTemplate = {
  id: "host-high-filesystem",
  name: "High Filesystem Usage",
  summary: "A filesystem is more than 90% full.",
  description:
    "Alert when host filesystem utilization exceeds 90%. One alert per mountpoint.",
  category: "Resource",
  severity: "Critical",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "host_filesystem";

    return buildHostMonitorStep({
      hostMonitor: buildHostFormulaMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        queries: [
          {
            metricAlias: "host_filesystem_ratio",
            metricName: "system.filesystem.utilization",
            /*
             * Max WITHIN each mountpoint's series: the peak utilization
             * that mount reached during the window. Grouping by
             * `mountpoint` already keeps mounts from being averaged
             * together, and gives one incident per mount so a second
             * mount filling up is not silenced by the first one's open
             * incident.
             */
            aggregationType: MetricsAggregationType.Max,
          },
        ],
        resultAlias: metricAlias,
        resultLegend: "Filesystem Used (%)",
        /*
         * The raw metric is a [0, 1] ratio with no unit recorded, so
         * without this the body of a Critical alert read a bare "0.93"
         * under a title that says 90%. See buildHostFormulaMonitorConfig
         * for why the scaling lives in the formula.
         */
        formula: "host_filesystem_ratio * 100",
        legendUnit: "%",
        rollingTime: RollingTime.Past5Minutes,
        /*
         * `mountpoint` is the identity — one incident per mount.
         * `device` rides along because the hostmetrics receiver puts it
         * on the same datapoint, it is constant for a given mount (so it
         * adds no series), and it is the first thing anyone asks after
         * "which mount?": /var at 95% on the same device as / is a
         * different problem from /var on its own disk.
         *
         * NOTE this template still pages on read-only pseudo-filesystems
         * that are 100% full by design (snap `squashfs` loop mounts,
         * macOS `devfs`). The Kubernetes agent's collector already
         * excludes those with an `include_fs_types` allowlist; the
         * standalone host collector config does not, and excluding them
         * here would need a NOT-IN comparison that `filterData.attributes`
         * (exact match only) cannot express. The mount and device are on
         * the alert, so the description below names the pattern instead.
         */
        groupByAttributeKeys: ["mountpoint", "device"],
      }),
      offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        // The formula already scales the [0, 1] ratio to percent, so 90 == 90%.
        value: 90,
        incidentTitle: `[Host] High Filesystem Usage (>90%)${hostTitleSuffix(args)}`,
        incidentDescription: `This mount stayed above 90% utilization for the whole evaluation window. A full disk causes application failures and data loss. The mount and device are named above. NOTE that read-only pseudo-filesystems — snap squashfs loop mounts under /snap, macOS devfs — sit at 100% by design and can never recover; if this names one of those, it is not actionable and the mount should be excluded from the collector's filesystem scraper.`,
        criteriaName: "High Filesystem - Usage > 90%",
        criteriaDescription:
          "Triggers when a host filesystem exceeds 90% utilization for every sample in the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 90,
      }),
    });
  },
};

const highLoadAverageTemplate: HostAlertTemplate = {
  id: "host-high-load-average",
  name: "High Load Average (1m)",
  summary: "The 1-minute load average stays above 4.",
  description:
    "Alert when the host's 1-minute load average stays above 4. The threshold is an absolute run-queue length and is NOT normalized by core count.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "host_load_1m";

    return buildHostMonitorStep({
      hostMonitor: buildHostMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "system.cpu.load_average.1m",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Avg,
      }),
      offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        /*
         * A raw run-queue length, NOT a ratio and NOT normalized by core
         * count. Normalizing would need `system.cpu.logical.count`, which
         * only the standalone collector config enables today, so the
         * threshold stays absolute and the copy below says so.
         */
        filterType: FilterType.GreaterThan,
        value: 4,
        incidentTitle: `[Host] High Load Average (1m > 4)${hostTitleSuffix(args)}`,
        incidentDescription: `This host's 1-minute load average stayed above 4 for the whole evaluation window, which indicates CPU contention or runaway processes. NOTE the threshold is an absolute run-queue length and is NOT normalized by core count: 4 is deep saturation on a 2-core host and routine on a 32-core one, so raise it on large hosts.`,
        criteriaName: "High Load - 1m Average > 4",
        criteriaDescription:
          "Triggers when the host's 1-minute load average exceeds 4 for every sample in the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 4,
      }),
    });
  },
};

const highProcessCountTemplate: HostAlertTemplate = {
  id: "host-high-processes",
  name: "High Process Count",
  summary:
    "More than 2000 processes are in one state, such as sleeping. Linux only.",
  description:
    "Alert when the host's largest process-state bucket (running, sleeping, idle, ...) exceeds 2000 processes, which may indicate a fork bomb or resource leak. Linux only.",
  category: "Host",
  severity: "Warning",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "host_processes";

    return buildHostMonitorStep({
      hostMonitor: buildHostMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "system.processes.count",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * `system.processes.count` is partitioned by process status
         * (running / sleeping / blocked / idle / ...) — one datapoint per
         * status, which is why ingest SUMS every datapoint to derive
         * `host.processCount` and why the host Overview tile has to filter
         * down to a single status. This query is ungrouped and unfiltered,
         * so `Max` compares the LARGEST SINGLE STATUS BUCKET, not the
         * host's total process count.
         *
         * `Max` is kept deliberately. `Sum` is not the fix: the query
         * aggregates within a time bucket, so it would add every status
         * AND every scrape inside that bucket together. Grouping by status
         * would need a per-status threshold nobody has evidence for, and
         * would break the `groupByAttributeKeys: []` contract pinned in
         * TemplateGroupByKeys.test.ts. On Linux the largest bucket tracks
         * the total closely enough to stay a usable "far too many
         * processes" signal — so the QUERY stays as it is and the COPY
         * below stops claiming a total nobody could reconcile with a
         * process listing.
         */
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 2000,
        incidentTitle: `[Host] High Process Count (>2000)${hostTitleSuffix(args)}`,
        incidentDescription: `The largest single process-state bucket on this host (running, sleeping, idle, ...) held more than 2000 processes for every sample in the evaluation window. This is NOT the host's total process count, so it will not match the total a process listing reports. Check the host for runaway or unreaped processes. The metric comes from the hostmetrics processes scraper, which reports on Linux only.`,
        criteriaName: "High Processes - Count > 2000",
        criteriaDescription:
          "Triggers when the largest single process-state bucket exceeds 2000 processes for every sample in the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 2000,
      }),
    });
  },
};

/*
 * How long a host counts as just restarted: ten minutes, as Zabbix's "has
 * been restarted" trigger and the database templates' Server Restarted
 * read it.
 */
export const HOST_RESTARTED_UPTIME_SECONDS: number = 600;

const hostRestartedTemplate: HostAlertTemplate = {
  id: "host-restarted",
  name: "Host Restarted",
  summary: "The host started less than 10 minutes ago.",
  description:
    "Alert when the host has been up for less than ten minutes (system.uptime below 600 seconds): it rebooted, or crashed and came back. Reads system.uptime from the collector's system scraper, which OneUptime's default configs turn on. A host that is down raises Host Stopped Reporting instead.",
  category: "Availability",
  severity: "Warning",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "host_uptime";

    return buildHostMonitorStep({
      hostMonitor: buildHostMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "system.uptime",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Min per bucket, so a bucket that spans the boot reads the young
         * uptime rather than the old one.
         */
        aggregationType: MetricsAggregationType.Min,
      }),
      /*
       * A restart is an event: requiring every sample of the window to be
       * young would never hold once the window is longer than the restart
       * is old. Any value fires on the first report after the boot; the
       * host is healthy again once the whole window is past the line.
       */
      offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: HOST_RESTARTED_UPTIME_SECONDS,
        metricAggregationType: EvaluateOverTimeType.AnyValue,
        incidentTitle: `[Host] Host Restarted${hostTitleSuffix(args)}`,
        incidentDescription: `This host has been up for less than ten minutes: it rebooted, or it crashed and came back. If nobody restarted it, read the journal of the boot before (journalctl -b -1, or the System event log on Windows) for a kernel panic, an out-of-memory kill, a watchdog or a power event, and check that the services it runs came back. The incident resolves on its own about a quarter of an hour after the boot, once every value of the monitoring window reads eleven minutes or more.`,
        criteriaName: "Host Restarted - Uptime < 10 minutes",
        criteriaDescription:
          "Triggers when the host reports an uptime below ten minutes at any point in the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: HOST_RESTARTED_UPTIME_SECONDS,
        metricAggregationType: EvaluateOverTimeType.AllValues,
      }),
    });
  },
};

const highSwapTemplate: HostAlertTemplate = {
  id: "host-high-swap",
  name: "High Swap Usage",
  summary: "More than 80% of swap space stays in use.",
  description:
    "Alert when more than 80% of the host's swap space is in use for the whole evaluation window: memory has run short and the host is paging. Reads system.paging.usage (used over used plus free, across every swap device). A host without swap reports none and never fires.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "host_swap";

    return buildHostMonitorStep({
      /*
       * The paging scraper reports bytes per swap device and state (used,
       * free, and on Linux cached, which is also counted in used). Used
       * over used plus free, each averaged across the devices and the
       * window, is the share `free` and `swapon` print. The optional
       * system.paging.utilization is not used: hosts set up by hand rarely
       * turn it on.
       */
      hostMonitor: buildHostFormulaMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        queries: [
          {
            metricAlias: "host_swap_used",
            metricName: "system.paging.usage",
            aggregationType: MetricsAggregationType.Avg,
            attributes: { state: "used" },
          },
          {
            metricAlias: "host_swap_free",
            metricName: "system.paging.usage",
            aggregationType: MetricsAggregationType.Avg,
            attributes: { state: "free" },
          },
        ],
        resultAlias: metricAlias,
        resultLegend: "Swap Used (%)",
        formula: "host_swap_used / (host_swap_used + host_swap_free) * 100",
        legendUnit: "%",
        rollingTime: RollingTime.Past5Minutes,
      }),
      offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        // The formula already scales the share to percent, so 80 == 80%.
        value: 80,
        incidentTitle: `[Host] High Swap Usage (>80%)${hostTitleSuffix(args)}`,
        incidentDescription: `More than 80% of this host's swap space stayed in use for the whole evaluation window. The host has run short of memory and pages to disk, which slows everything it runs; once swap fills, the kernel's out-of-memory killer stops processes. Look at the host's Processes page for what holds the most memory. See the root cause below for the measured values.`,
        criteriaName: "High Swap - Usage > 80%",
        criteriaDescription:
          "Triggers when more than 80% of the host's swap space is in use for every sample in the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 80,
      }),
    });
  },
};

const lowInodesTemplate: HostAlertTemplate = {
  id: "host-running-out-of-inodes",
  name: "Running Out of Inodes",
  summary: "A filesystem has used more than 90% of its inodes.",
  description:
    "Alert when a filesystem has used more than 90% of its inodes: past 100% nothing can create a file there, however much space is free. Reads system.filesystem.inodes.usage (used over used plus free). One alert per mountpoint.",
  category: "Resource",
  severity: "Critical",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "host_inodes";

    return buildHostMonitorStep({
      hostMonitor: buildHostFormulaMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        queries: [
          {
            metricAlias: "host_inodes_used",
            metricName: "system.filesystem.inodes.usage",
            aggregationType: MetricsAggregationType.Avg,
            attributes: { state: "used" },
          },
          {
            metricAlias: "host_inodes_free",
            metricName: "system.filesystem.inodes.usage",
            aggregationType: MetricsAggregationType.Avg,
            attributes: { state: "free" },
          },
        ],
        resultAlias: metricAlias,
        resultLegend: "Inodes Used (%)",
        formula:
          "host_inodes_used / (host_inodes_used + host_inodes_free) * 100",
        legendUnit: "%",
        rollingTime: RollingTime.Past5Minutes,
        /*
         * One incident per mount, named with its device, as High
         * Filesystem Usage groups. A filesystem with no inode table of its
         * own (btrfs) reports none and never fires.
         */
        groupByAttributeKeys: ["mountpoint", "device"],
      }),
      offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        // The formula already scales the share to percent, so 90 == 90%.
        value: 90,
        incidentTitle: `[Host] Running Out of Inodes (>90%)${hostTitleSuffix(args)}`,
        incidentDescription: `This mount has used more than 90% of its inodes for the whole evaluation window. Once they run out nothing can create a file there - writes fail with "No space left on device" while df still shows free space. Usually millions of small files are to blame: a mail or job queue, a cache, session files or old logs. The mount and device are named above, and df -i on the host shows how many inodes each filesystem has left.`,
        criteriaName: "Low Inodes - Used > 90%",
        criteriaDescription:
          "Triggers when a filesystem has used more than 90% of its inodes for every sample in the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 90,
      }),
    });
  },
};

const systemdUnitFailedTemplate: HostAlertTemplate = {
  id: "host-systemd-unit-failed",
  name: "Systemd Unit Failed",
  summary: "A systemd service is in the failed state. Linux only.",
  description:
    "Alert when a systemd service on the host is in the failed state for the whole evaluation window: it crashed, exited with an error, or could not start. Reads systemd.unit.state for active_state failed, from the collector's systemd receiver (OneUptime's default config on Linux reads it where the host has systemd). One alert per unit; it resolves when the unit runs again or is reset with systemctl reset-failed.",
  category: "Host",
  severity: "Warning",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "host_unit_failed";

    return buildHostMonitorStep({
      hostMonitor: buildHostMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        /*
         * One point per unit per active state, 1 for the state the unit is
         * in and 0 for the rest. Filtered to `failed`, a unit's series is 1
         * while it is failed. The unit's name is a resource attribute, so
         * the group-by key carries the `resource.` prefix ingest stores it
         * under (Pages/Host/Utils/SystemdUnits reads the same key).
         */
        metricName: "systemd.unit.state",
        metricAlias,
        attributes: { "systemd.unit.active_state": "failed" },
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
        groupByAttributeKeys: ["resource.systemd.unit.name"],
      }),
      offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[Host] Systemd Unit Failed${hostTitleSuffix(args)}`,
        incidentDescription: `A systemd service on this host has been in the failed state for the whole evaluation window: it crashed, exited with an error, or could not start, and systemd now calls the whole system degraded. The unit is named above. On the host, systemctl status <unit> and journalctl -u <unit> -n 50 say why; once it is fixed, start it again or clear it with systemctl reset-failed <unit>, and the alert resolves.`,
        criteriaName: "Systemd Unit Failed - Failed state",
        criteriaDescription:
          "Triggers when a systemd service is in the failed state for every sample in the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 0,
      }),
    });
  },
};

/*
 * --- Android devices (#9802) ---
 *
 * What only an Android device reports, from the metrics the OneUptime
 * Android agent sends (agents/AndroidAgent, collect/HostMetrics.kt): whether
 * it is on external power, its battery, Android's thermal status and its
 * restarts. A kiosk or a POS terminal has failures a server does not: a
 * pulled cable, a battery run down, a cabinet in the sun, a crash loop.
 *
 * Each groups by the device's host.name and its Android API level, which
 * only the Android agent sends. There is one series per device either way,
 * since the monitor is scoped to one host, but the labels are what the
 * alert is built from: the device's name in its title, its Android version
 * beside it, and the API level is how the alert's first debug commands
 * (SeriesDebugHints) know to be adb's, not a server's shell.
 */
export const ANDROID_API_LEVEL_LABEL: string = "resource.android.os.api_level";

export const ANDROID_TEMPLATE_GROUP_BY: Array<string> = [
  "resource.host.name",
  ANDROID_API_LEVEL_LABEL,
];

const androidDeviceUnpluggedTemplate: HostAlertTemplate = {
  id: "android-device-unplugged",
  name: "Device Unplugged",
  summary: "The device runs on its battery for 10 minutes.",
  description:
    "Alert when a device meant to stay on power, such as a kiosk, a POS terminal or a signage player, runs on its battery for ten minutes: its cable was pulled, or its power supply failed. Reads android.battery.plugged, 1 on external power and 0 on battery. A device without a battery sends no reading and never raises it; a handheld that runs on its battery by design should not use it.",
  category: "Availability",
  severity: "Warning",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "android_plugged";

    return buildHostMonitorStep({
      hostMonitor: buildHostMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "android.battery.plugged",
        metricAlias,
        rollingTime: RollingTime.Past10Minutes,
        // The highest reading of each bucket: one sample on power in the window is power.
        aggregationType: MetricsAggregationType.Max,
        groupByAttributeKeys: ANDROID_TEMPLATE_GROUP_BY,
      }),
      offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 1,
        incidentTitle: `[Android] Device Unplugged${hostTitleSuffix(args)}`,
        incidentDescription: `This device has run on its battery for ten minutes: someone pulled its power cable, or its power supply or socket failed. A kiosk or a POS terminal meant to stay on power shuts down when its battery runs out. Check the cable, the adapter and the socket at the device. The incident resolves once the device is on power again.`,
        criteriaName: "Device Unplugged - On battery for 10 minutes",
        criteriaDescription:
          "Triggers when the device reports running on its battery for every sample in the ten-minute window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
        isBinaryMetric: true,
      }),
    });
  },
};

const androidLowBatteryTemplate: HostAlertTemplate = {
  id: "android-low-battery",
  name: "Low Battery",
  summary: "The battery stays below 20%.",
  description:
    "Alert when the device's battery stays below 20% for the whole evaluation window: a handheld or a POS terminal is about to shut down. Reads hw.battery.charge. A device without a battery sends no reading and never raises it.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "android_battery";

    return buildHostMonitorStep({
      hostMonitor: buildHostFormulaMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        queries: [
          {
            metricAlias: "android_battery_charge",
            metricName: "hw.battery.charge",
            // The lowest charge of each bucket.
            aggregationType: MetricsAggregationType.Min,
          },
        ],
        resultAlias: metricAlias,
        resultLegend: "Battery (%)",
        // A [0, 1] fraction, scaled here: see buildHostFormulaMonitorConfig.
        formula: "android_battery_charge * 100",
        legendUnit: "%",
        rollingTime: RollingTime.Past5Minutes,
        groupByAttributeKeys: ANDROID_TEMPLATE_GROUP_BY,
      }),
      offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 20,
        incidentTitle: `[Android] Low Battery (<20%)${hostTitleSuffix(args)}`,
        incidentDescription: `The device's battery stayed below 20% for the whole evaluation window, so it will shut down soon unless it is charged. Put it on its charger or swap the battery. A device meant to stay on power that runs low has lost its power: Device Unplugged says since when.`,
        criteriaName: "Low Battery - Charge < 20%",
        criteriaDescription:
          "Triggers when the battery charge is below 20% for every sample in the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 20,
      }),
    });
  },
};

const androidOverheatingTemplate: HostAlertTemplate = {
  id: "android-device-overheating",
  name: "Device Overheating",
  summary: "Android reports a severe thermal status or worse.",
  description:
    "Alert when Android's thermal status stays at severe (3) or worse for the whole evaluation window: Android is throttling the device hard, and from emergency (5) it starts shutting it down. Reads android.thermal.status, 0 (none) to 6 (shutdown), which Android 10 and later report. Kiosks in direct sun, in closed cabinets or with blocked vents are the usual cause.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "android_thermal_status";

    return buildHostMonitorStep({
      hostMonitor: buildHostMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "android.thermal.status",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
        groupByAttributeKeys: ANDROID_TEMPLATE_GROUP_BY,
      }),
      offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 3,
        incidentTitle: `[Android] Device Overheating${hostTitleSuffix(args)}`,
        incidentDescription: `Android has reported a severe thermal status (3 of 6) or worse on this device for the whole evaluation window: it is slowing the device down hard to cool it, and at emergency (5) it starts shutting it down. Check what the device stands in: direct sun, a closed cabinet, blocked vents. The incident resolves once the status is below severe again.`,
        criteriaName: "Device Overheating - Thermal status severe or worse",
        criteriaDescription:
          "Triggers when Android's thermal status is 3 (severe) or higher for every sample in the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 3,
      }),
    });
  },
};

const androidRestartLoopTemplate: HostAlertTemplate = {
  id: "android-restart-loop",
  name: "Restart Loop",
  summary: "The device starts three or more times in an hour.",
  description:
    "Alert when the device has started three or more times in the last hour: it is restarting in a loop, from a crash in the system, a failing app, a watchdog or a power fault. Reads android.boot.recent_count, the boots in the last hour, which the agent sends every collection. Its device.boot logs say how each boot ended, and why the device rebooted where the agent reads DropBox.",
  category: "Availability",
  severity: "Critical",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "android_recent_boots";

    return buildHostMonitorStep({
      hostMonitor: buildHostMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "android.boot.recent_count",
        metricAlias,
        rollingTime: RollingTime.Past1Hour,
        aggregationType: MetricsAggregationType.Max,
        groupByAttributeKeys: ANDROID_TEMPLATE_GROUP_BY,
      }),
      /*
       * A restart loop is an event, as Host Restarted is: any reading at
       * three or more fires, and the device is healthy again once a whole
       * hour reads fewer.
       */
      offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 3,
        metricAggregationType: EvaluateOverTimeType.AnyValue,
        incidentTitle: `[Android] Restart Loop${hostTitleSuffix(args)}`,
        incidentDescription: `This device has started three or more times in the last hour: it is restarting in a loop. Its device.boot logs say how each boot ended (android.boot.previous_shutdown: clean or unexpected) and, where the agent reads DropBox, why it rebooted (android.boot.reason) and whether the kernel panicked. A crash loop in an app the device manager restarts, a watchdog in the system, or a failing power supply are the usual causes. The incident resolves once an hour passes with fewer than three boots.`,
        criteriaName: "Restart Loop - 3 or more boots in an hour",
        criteriaDescription:
          "Triggers when the device reports three or more boots in the last hour at any point in the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 3,
        metricAggregationType: EvaluateOverTimeType.AllValues,
      }),
    });
  },
};

const androidStorageNearlyFullTemplate: HostAlertTemplate = {
  id: "android-storage-nearly-full",
  name: "Storage Nearly Full",
  summary: "The device's storage is more than 90% full.",
  description:
    "Alert when the device's own storage (/data) stays more than 90% full: Android starts refusing app installs and updates as it fills, and apps that cache or log start failing. Reads system.filesystem.utilization, as High Filesystem Usage does for a server.",
  category: "Resource",
  severity: "Critical",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "android_storage";

    return buildHostMonitorStep({
      hostMonitor: buildHostFormulaMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        queries: [
          {
            metricAlias: "android_storage_ratio",
            metricName: "system.filesystem.utilization",
            aggregationType: MetricsAggregationType.Max,
          },
        ],
        resultAlias: metricAlias,
        resultLegend: "Storage Used (%)",
        formula: "android_storage_ratio * 100",
        legendUnit: "%",
        rollingTime: RollingTime.Past5Minutes,
        // The mount names what filled up (/data); the API level gives the alert adb's commands.
        groupByAttributeKeys: ["mountpoint", ANDROID_API_LEVEL_LABEL],
      }),
      offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 90,
        incidentTitle: `[Android] Storage Nearly Full (>90%)${hostTitleSuffix(args)}`,
        incidentDescription: `The device's storage stayed more than 90% full for the whole evaluation window. Android refuses app installs and updates as it fills, and apps that keep caches or logs start failing. Clear what the apps keep, or remove apps the device does not need, through your device manager.`,
        criteriaName: "Storage Nearly Full - Usage > 90%",
        criteriaDescription:
          "Triggers when the device's storage is more than 90% used for every sample in the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 90,
      }),
    });
  },
};

/*
 * A device behind on its security patches (#9965). Its patch level is the
 * date of the Android security bulletin its build includes
 * (Build.VERSION.SECURITY_PATCH); the agent sends the days since that date
 * as android.os.security_patch.age with every report. Out of date is more
 * than ANDROID_SECURITY_PATCH_MAX_AGE_DAYS, the rule Inventory's Security
 * Patch Level filter reads too (Types/Host/AndroidSecurityPatch says why).
 */
const androidSecurityPatchOutOfDateTemplate: HostAlertTemplate = {
  id: "android-security-patch-out-of-date",
  name: "Security Patch Out of Date",
  summary: "The device's security patch is more than 90 days old.",
  description:
    "Alert when the device's security patch level is more than 90 days old: Android Enterprise Recommended devices get each monthly Android security bulletin within 90 days, so a device further behind misses fixes for known vulnerabilities. Reads android.os.security_patch.age, the days since the patch level's date, which the agent sends with every report. It resolves once the device is updated.",
  category: "Host",
  severity: "Warning",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "android_security_patch_age";

    return buildHostMonitorStep({
      hostMonitor: buildHostMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "android.os.security_patch.age",
        metricAlias,
        rollingTime: RollingTime.Past1Hour,
        aggregationType: MetricsAggregationType.Min,
        groupByAttributeKeys: ANDROID_TEMPLATE_GROUP_BY,
      }),
      /*
       * The age grows a day a day and drops only when the device is
       * updated: the whole hour behind fires, and one reading at 90 days
       * or newer - the update - resolves it.
       */
      offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: ANDROID_SECURITY_PATCH_MAX_AGE_DAYS,
        metricAggregationType: EvaluateOverTimeType.AllValues,
        incidentTitle: `[Android] Security Patch Out of Date (>90 days)${hostTitleSuffix(args)}`,
        incidentDescription: `This device's security patch level is more than 90 days old, so it misses the fixes of the Android security bulletins since then. Update its operating system: through your device manager's OS update policy, or on the device in Settings, System, Software update. A device whose maker no longer ships updates stays out of date until it is replaced. The incident resolves once the device reports a patch level from the last 90 days.`,
        criteriaName: "Security Patch Out of Date - older than 90 days",
        criteriaDescription:
          "Triggers when the device's security patch level is more than 90 days old for every sample in the monitoring window.",
      }),
      /*
       * No dead band: the age never wavers about the threshold - it grows a
       * day a day - and an update to a patch from the last 90 days is up
       * to date, as Inventory says it is.
       */
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: ANDROID_SECURITY_PATCH_MAX_AGE_DAYS,
        recoveryValue: ANDROID_SECURITY_PATCH_MAX_AGE_DAYS,
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      }),
    });
  },
};

/*
 * CPU use, for an Android device that reports it: Android 7, or a device on
 * which the agent is the device owner (Android 8 and later keep CPU use
 * from other apps). Busy is 1 - idle, not user + system as High CPU
 * Utilization reads it: as device owner Android gives a core's active time
 * as one figure, which the agent sends as user, and leaves out system.
 */
const androidHighCpuTemplate: HostAlertTemplate = {
  id: "android-high-cpu",
  name: "High CPU Utilization",
  summary: "The device's CPU stays more than 80% busy.",
  description:
    "Alert when the device's CPU stays more than 80% busy (1 - idle) for the whole evaluation window. Offered only for a device that reports CPU use: Android 7, or one on which the Android agent is the device owner.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "android_cpu";

    return buildHostMonitorStep({
      hostMonitor: buildHostFormulaMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        queries: [
          {
            metricAlias: "android_cpu_idle",
            metricName: "system.cpu.utilization",
            aggregationType: MetricsAggregationType.Avg,
            attributes: { state: "idle" },
          },
        ],
        resultAlias: metricAlias,
        resultLegend: "CPU Busy (%)",
        formula: "(1 - android_cpu_idle) * 100",
        legendUnit: "%",
        rollingTime: RollingTime.Past5Minutes,
        groupByAttributeKeys: ANDROID_TEMPLATE_GROUP_BY,
      }),
      offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 80,
        incidentTitle: `[Android] High CPU Utilization (>80%)${hostTitleSuffix(args)}`,
        incidentDescription: `The device's CPU stayed more than 80% busy for the whole evaluation window. On a kiosk or a POS terminal that shows as a slow screen and slow payments. The device's logs and crashes around the same time usually name the app doing the work.`,
        criteriaName: "High CPU - Busy > 80%",
        criteriaDescription:
          "Triggers when the device's CPU is more than 80% busy for every sample in the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 80,
      }),
    });
  },
};

/** The templates only an Android device has: offered for hosts whose OS is Android. */
export function getAndroidHostAlertTemplates(): Array<HostAlertTemplate> {
  return [
    androidDeviceUnpluggedTemplate,
    androidLowBatteryTemplate,
    androidOverheatingTemplate,
    androidRestartLoopTemplate,
    androidStorageNearlyFullTemplate,
    androidSecurityPatchOutOfDateTemplate,
    androidHighCpuTemplate,
  ];
}

/*
 * The server templates an Android device also answers: it sends the metrics
 * they read. The rest read what a device never sends (swap, inodes, load,
 * processes, systemd units), or are replaced by an Android one that reads
 * it the way the device sends it (storage, CPU), and would never fire.
 */
const SERVER_TEMPLATES_FOR_ANDROID: ReadonlyArray<string> = [
  "host-stopped-reporting",
  "host-restarted",
  "host-high-memory",
];

/**
 * The templates to offer for one host: every server template, or, for an
 * Android device, the ones it answers and its own. Its CPU template only
 * when it reports CPU use, which most Android devices do not.
 */
export function getHostAlertTemplatesFor(host: {
  isAndroid?: boolean | null | undefined;
  reportsCpu?: boolean | null | undefined;
}): Array<HostAlertTemplate> {
  if (!host.isAndroid) {
    return getAllHostAlertTemplates();
  }

  return [
    ...getAllHostAlertTemplates().filter((template: HostAlertTemplate) => {
      return SERVER_TEMPLATES_FOR_ANDROID.includes(template.id);
    }),
    ...getAndroidHostAlertTemplates().filter((template: HostAlertTemplate) => {
      return template !== androidHighCpuTemplate || Boolean(host.reportsCpu);
    }),
  ];
}

export function getAllHostAlertTemplates(): Array<HostAlertTemplate> {
  return [
    hostStoppedReportingTemplate,
    hostRestartedTemplate,
    highCpuTemplate,
    highMemoryTemplate,
    highSwapTemplate,
    highFilesystemUsageTemplate,
    lowInodesTemplate,
    highLoadAverageTemplate,
    highProcessCountTemplate,
    systemdUnitFailedTemplate,
  ];
}

export function getHostAlertTemplatesByCategory(
  category: HostAlertTemplateCategory,
): Array<HostAlertTemplate> {
  return getAllHostAlertTemplates().filter((template: HostAlertTemplate) => {
    return template.category === category;
  });
}

export function getHostAlertTemplateById(
  id: string,
): HostAlertTemplate | undefined {
  return [
    ...getAllHostAlertTemplates(),
    ...getAndroidHostAlertTemplates(),
  ].find((template: HostAlertTemplate) => {
    return template.id === id;
  });
}

/*
 * The template a NEW Host monitor starts on: the host going silent. It is
 * the one template that still speaks when every other one has stopped being
 * evaluated, and it has no threshold to tune.
 */
export function getHostDefaultAlertTemplateId(): string {
  return hostStoppedReportingTemplate.id;
}
