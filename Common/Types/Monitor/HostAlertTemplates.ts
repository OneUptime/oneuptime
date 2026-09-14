import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
} from "./Recommendation/RecommendationCriteriaBuilder";
import { FilterType, EvaluateOverTimeType } from "./CriteriaFilter";
import MonitorStepHostMonitor from "./MonitorStepHostMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type HostAlertTemplateCategory = "Resource" | "Host";

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

const highCpuTemplate: HostAlertTemplate = {
  id: "host-high-cpu",
  name: "High CPU Utilization",
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

export function getAllHostAlertTemplates(): Array<HostAlertTemplate> {
  return [
    highCpuTemplate,
    highMemoryTemplate,
    highFilesystemUsageTemplate,
    highLoadAverageTemplate,
    highProcessCountTemplate,
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
  return getAllHostAlertTemplates().find((template: HostAlertTemplate) => {
    return template.id === id;
  });
}
