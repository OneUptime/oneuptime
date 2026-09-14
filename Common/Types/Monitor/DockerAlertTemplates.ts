import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
} from "./Recommendation/RecommendationCriteriaBuilder";
import { FilterType, EvaluateOverTimeType } from "./CriteriaFilter";
import MonitorStepDockerMonitor from "./MonitorStepDockerMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type DockerAlertTemplateCategory = "Container" | "Resource" | "Host";

export type DockerAlertTemplateSeverity = "Critical" | "Warning";

export interface DockerAlertTemplateArgs {
  hostIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface DockerAlertTemplate {
  id: string;
  name: string;
  description: string;
  category: DockerAlertTemplateCategory;
  severity: DockerAlertTemplateSeverity;
  getMonitorStep: (args: DockerAlertTemplateArgs) => MonitorStep;
}

/*
 * What an incident/alert title says after the condition.
 *
 * Titles used to end in `- ${args.monitorName}`, and for a monitor created
 * from the Recommendations page that name is ALREADY
 * "<resource> - <template name>"
 * (MonitorRecommendationUtil.getMonitorName), so the rendered title stated
 * the same fact twice:
 *
 *   "[Docker] High CPU Usage (>80%) - docker-host-01 - High Container CPU Usage"
 *
 * SeriesContextEnricher then appends the container identity on top of that,
 * which pushes the one thing that differs between two alerts — WHICH
 * container — off the end of a phone notification.
 *
 * The host is the half worth keeping, and it is the half the alert email
 * never renders otherwise (the email shows the alert title, the affected
 * SERIES, severity, root cause and description — never the monitor's own
 * name), so name it directly. Guarded because the in-form template picker
 * can build a step before a host is chosen (DockerMonitorStepForm passes
 * `hostIdentifier || ""`), and a title ending in a bare dash reads like a
 * bug.
 */
function dockerTitleSuffix(args: DockerAlertTemplateArgs): string {
  return args.hostIdentifier ? ` - ${args.hostIdentifier}` : "";
}

/*
 * Filter contract: the Docker agent stamps container identity as OTLP
 * RESOURCE attributes, so ClickHouse stores them `resource.`-prefixed:
 * `resource.container.name`, `resource.container.image.name`,
 * `resource.container.runtime` ("docker") and `resource.host.name`. The
 * worker adds the host scope (`resource.host.name` from hostIdentifier)
 * and the runtime filter itself. Every template groups by
 * `resource.container.name` so each container on the host is evaluated
 * independently — one incident per container instead of one incident for
 * the whole host, where the busiest container silences every other one.
 *
 * The Docker SWARM agent runs the SAME docker_stats receiver with no
 * attribute-moving transform (DockerSwarmAgent/otel-collector-config.yaml:
 * receivers `[docker_stats]`, processors `[memory_limiter, resource,
 * batch]`, where `resource` only upserts `docker.swarm.cluster.name` and
 * `oneuptime.agent.version`), so Swarm container identity is stored
 * `resource.`-prefixed too. DockerSwarmAlertTemplates.ts groups by the bare
 * `container.name`; that key matches no stored attribute, and
 * aggregatePerSeriesFromRawMetrics labels a missing key "" — collapsing
 * every Swarm container into ONE series with an empty label. Do not copy
 * that spelling.
 */

export function buildDockerMonitorStep(args: {
  dockerMonitor: MonitorStepDockerMonitor;
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
    dockerMonitor: args.dockerMonitor,
  };

  return monitorStep;
}

export function buildDockerOfflineCriteriaInstance(args: {
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
    resourceNoun: "container",
  });
}

export function buildDockerOnlineCriteriaInstance(args: {
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

export function buildDockerMonitorConfig(args: {
  hostIdentifier: string;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string>;
  groupByAttributeKey?: string | undefined;
}): MonitorStepDockerMonitor {
  return {
    hostIdentifier: args.hostIdentifier,
    containerFilters: {},
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
            ...(args.groupByAttributeKey
              ? { groupByAttributeKeys: [args.groupByAttributeKey] }
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
 * Two queries over the SAME cumulative counter, differenced per bucket.
 *
 * Some Docker signals are monotonic LIFETIME counters, not levels.
 * `container.cpu.throttling_data.throttled_time` is the total nanoseconds
 * the cgroup has ever been throttled; `container.restarts` is Docker's
 * lifetime RestartCount. Thresholding either one directly has two failure
 * modes, and BOTH shipped:
 *
 *   - it fires on history. A container throttled once an hour ago, or that
 *     crash-looped last week, still reports a non-zero lifetime total
 *     forever — so "> 0" / "> 5" is true for essentially every container
 *     that has ever had a bad day. Sustained evaluation makes this worse,
 *     not better: every per-minute bucket of a lifetime counter breaches.
 *   - it can never recover. A monotonic counter cannot come back down, so
 *     the complementary healthy comparison ("= 0", "<= 4.5") is unreachable
 *     by construction. The alert stays open until a human closes it, and
 *     the next evaluation reopens it.
 *
 * The alerting path has no rate operator. `transformAsRate` on
 * MetricQueryConfigData is CHART-only (MetricCharts.tsx is its only reader;
 * monitorDocker never looks at it), and `transformValue` is a function, so
 * it cannot survive the JSON round-trip a monitor step takes through
 * Postgres. Nothing between ingest and alerting differences a cumulative
 * OTLP sum either — OtelMetricsIngestService only RECORDS
 * `aggregationTemporality`/`isMonotonic` so the browser can suggest a rate
 * view. So the delta has to be built from what the worker does honour: two
 * queries over the same metric, one Max and one Min, plus a formula
 * subtracting them. `aggregatePerSeriesFromRawMetrics` buckets rows per
 * (series, minute) using EACH query's own aggregation, so `max - min` is
 * the counter's increase WITHIN each minute, and the criteria's
 * `EvaluateOverTimeType.Sum` totals those increases across the window.
 *
 * READ THE THRESHOLD AGAINST THE AGENT'S SCRAPE INTERVAL. Two consequences:
 *
 *   1. The delta only sees growth BETWEEN samples inside one bucket. The
 *      shipped agent scrapes every 30s
 *      (DockerAgent/otel-collector-config.yaml), giving exactly two samples
 *      per one-minute bucket, so roughly HALF the window's growth is
 *      counted. That is not a rounding error — every threshold below is
 *      effectively "about twice this much real activity". It only ever
 *      UNDERCOUNTS, so ordinary data cannot manufacture a breach. Do not
 *      raise a threshold to "compensate"; it is already compensated for.
 *   2. At a scrape interval of 60s or slower each bucket holds a single
 *      sample, `max - min` is identically 0, and every template built on
 *      this helper stops alerting entirely, silently. Anyone raising
 *      `collection_interval` past 30s has to revisit these.
 *
 * It CAN spike on a counter RESET. A container restart recreates the
 * cgroup, so a bucket straddling the restart sees [large, small] and
 * reports the whole pre-restart lifetime total as one minute of growth — a
 * spurious alert that clears itself once that minute leaves the rolling
 * window. Prometheus-style reset detection would need consecutive raw
 * samples the worker never exposes, so this is accepted rather than fixed.
 * It is bounded, unlike the permanent alert it replaces.
 *
 * If the formula fails to evaluate, appendFormulaResults pushes an empty
 * result and NEITHER criteria fires (NoDataPolicy.Ignore): the monitor
 * holds its previous status rather than flipping.
 */
export function buildDockerDeltaMonitorConfig(args: {
  hostIdentifier: string;
  metricName: string;
  maxAlias: string;
  minAlias: string;
  resultAlias: string;
  resultLegend: string;
  /*
   * A LABEL only, and only safe because MetricResultUnitConverter converts
   * QUERY results and never formula results, and MetricMonitorCriteria
   * defaults `thresholdUnit` to the formula's own `legendUnit` — so sample
   * and threshold units match and no conversion runs. Leave it undefined
   * for a dimensionless count.
   */
  resultLegendUnit?: string | undefined;
  /*
   * Applied to the raw delta INSIDE the formula, e.g. 1000000 to express a
   * nanosecond counter's growth in milliseconds. Scaled in the formula
   * rather than via `legendUnit` for exactly the reason above: a formula's
   * legendUnit converts nothing.
   */
  scaleDivisor?: number | undefined;
  rollingTime: RollingTime;
  groupByAttributeKey?: string | undefined;
}): MonitorStepDockerMonitor {
  const buildQueryConfig: (
    alias: string,
    aggregationType: MetricsAggregationType,
  ) => any = (alias: string, aggregationType: MetricsAggregationType): any => {
    return {
      metricAliasData: {
        metricVariable: alias,
        title: alias,
        description: alias,
        legend: alias,
        // Unset so MetricResultUnitConverter passes the raw value through.
        legendUnit: undefined,
      },
      metricQueryData: {
        filterData: {
          metricName: args.metricName,
          attributes: {},
          aggegationType: aggregationType,
          aggregateBy: {},
        },
        /*
         * Both halves MUST group identically. buildSeriesBreakdown joins
         * the two queries by series fingerprint, so a key only one side
         * carries splits them into fingerprints that never meet, the
         * formula evaluates against an empty operand, and the monitor
         * silently stops alerting.
         */
        ...(args.groupByAttributeKey
          ? { groupByAttributeKeys: [args.groupByAttributeKey] }
          : {}),
      },
    };
  };

  const expression: string = args.scaleDivisor
    ? `(${args.maxAlias} - ${args.minAlias}) / ${args.scaleDivisor}`
    : `${args.maxAlias} - ${args.minAlias}`;

  return {
    hostIdentifier: args.hostIdentifier,
    containerFilters: {},
    metricViewConfig: {
      /*
       * The Max query is FIRST so `queryConfigs[0]` still describes the
       * underlying metric, the way it does for a single-query template.
       */
      queryConfigs: [
        buildQueryConfig(args.maxAlias, MetricsAggregationType.Max),
        buildQueryConfig(args.minAlias, MetricsAggregationType.Min),
      ],
      formulaConfigs: [
        {
          metricAliasData: {
            metricVariable: args.resultAlias,
            title: args.resultLegend,
            description: args.resultLegend,
            legend: args.resultLegend,
            legendUnit: args.resultLegendUnit,
          },
          metricFormulaData: {
            metricFormula: expression,
          },
        },
      ],
    },
    rollingTime: args.rollingTime,
  };
}

// --- Template Definitions ---

const highCpuTemplate: DockerAlertTemplate = {
  id: "docker-high-cpu",
  name: "High Container CPU Usage",
  description:
    "Alert when a container's CPU usage stays above 80% of ONE CPU core for the whole window. This is the same number `docker stats` prints, so 100% is one full core and a container spread across several cores reads above 100. One alert per container.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: DockerAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "container_cpu";

    return buildDockerMonitorStep({
      dockerMonitor: buildDockerMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "container.cpu.utilization",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Max WITHIN each container's series: any scrape in the window over
         * the threshold trips that container. Grouping by container name
         * already keeps a hot container from being diluted by idle ones.
         */
        aggregationType: MetricsAggregationType.Max,
        groupByAttributeKey: "resource.container.name",
      }),
      offlineCriteriaInstance: buildDockerOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 80,
        incidentTitle: `[Docker] High CPU Usage (>80% of one core)${dockerTitleSuffix(args)}`,
        incidentDescription: `A Docker container's CPU usage stayed above 80% of a single CPU core for the whole evaluation window. \`container.cpu.utilization\` is the figure \`docker stats\` reports: 100% is one full core, NOT 100% of the host, so a container using two cores reads 200. On a multi-core host this threshold is therefore an absolute CPU budget rather than a share of the machine — raise it if this container is meant to use more than one core. Check the root cause for the container and the observed values.`,
        criteriaName: "High CPU - Usage > 80% of one core",
        criteriaDescription:
          "Triggers when a container's CPU usage stays above 80% of one CPU core across the monitoring window.",
      }),
      onlineCriteriaInstance: buildDockerOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 80,
      }),
    });
  },
};

const highMemoryTemplate: DockerAlertTemplate = {
  id: "docker-high-memory",
  name: "High Container Memory Usage",
  description:
    "Alert when container memory usage stays above 85% of its memory limit — or of HOST memory, when the container was started without a limit. One alert per container.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: DockerAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "container_memory";

    return buildDockerMonitorStep({
      dockerMonitor: buildDockerMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "container.memory.percent",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Max WITHIN each container's series: any scrape in the window over
         * the limit trips that container. Grouping by container name already
         * keeps a container at its limit from being diluted by idle ones.
         */
        aggregationType: MetricsAggregationType.Max,
        groupByAttributeKey: "resource.container.name",
      }),
      offlineCriteriaInstance: buildDockerOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 85,
        incidentTitle: `[Docker] High Memory Usage (>85%)${dockerTitleSuffix(args)}`,
        incidentDescription: `A Docker container's memory usage stayed above 85% for the whole evaluation window. \`container.memory.percent\` divides by the container's memory limit when one is set and by the HOST's total memory when it is not, so check whether this container was started with \`--memory\` before treating this as an impending OOM kill: an unlimited container at 86% is using 86% of the machine and will not be OOM-killed for hitting a limit that does not exist. Check the root cause for the container and the observed values.`,
        criteriaName: "High Memory - Usage > 85%",
        criteriaDescription:
          "Triggers when a container's memory usage stays above 85% of its limit (or of host memory when unlimited) across the monitoring window.",
      }),
      onlineCriteriaInstance: buildDockerOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 85,
      }),
    });
  },
};

const containerRestartLoopTemplate: DockerAlertTemplate = {
  id: "docker-restart-loop",
  name: "Container Restart Loop",
  description:
    "Alert when a container's restart count climbs by more than 3 within fifteen minutes, indicating a crash loop. One alert per container.",
  category: "Container",
  severity: "Critical",
  getMonitorStep: (args: DockerAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "container_restarts";

    return buildDockerMonitorStep({
      /*
       * `container.restarts` is Docker's LIFETIME RestartCount, not a
       * windowed count, and nothing in the pipeline deltas it. Comparing it
       * to a constant asks "has this container ever crash-looped" — true
       * forever once true, and unrecoverable against a counter that only
       * goes up. The loop signal is how much the counter GREW. See
       * buildDockerDeltaMonitorConfig.
       */
      dockerMonitor: buildDockerDeltaMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "container.restarts",
        maxAlias: "container_restarts_max",
        minAlias: "container_restarts_min",
        resultAlias: metricAlias,
        resultLegend: "Container Restarts (in window)",
        /*
         * Deliberately no resultLegendUnit: a restart count is
         * dimensionless, and MetricMonitorCriteria reads a formula's
         * legendUnit as the sample unit to convert from.
         */
        /*
         * Fifteen minutes, not five. The per-minute Max-minus-Min delta is
         * a LOWER BOUND: the agent scrapes every 30s and buckets are one
         * minute, so an isolated restart is only counted when it lands
         * between the two samples of the SAME minute — roughly half are
         * missed. Bursts inside one 30s gap are counted in full, and
         * Docker's restart backoff (doubling, capped at 60s) puts a real
         * crash loop at ~20 restarts per fifteen minutes, so the threshold
         * below still clears with room to spare.
         */
        rollingTime: RollingTime.Past15Minutes,
        groupByAttributeKey: "resource.container.name",
      }),
      offlineCriteriaInstance: buildDockerOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 3,
        /*
         * Sum over the window, not the sustained AllValues default: each
         * sample is ONE MINUTE'S restart increment, and most minutes of a
         * crash loop are zero, so "every bucket breached" is unreachable.
         * The window total is the loop count. This is the semantics the
         * docs have always described for this template ("> 3 / Sum" in
         * App/FeatureSet/Docs/Content/en/monitor/docker-monitor.md) and
         * which the code never implemented.
         */
        metricAggregationType: EvaluateOverTimeType.Sum,
        incidentTitle: `[Docker] Container Restart Loop Detected${dockerTitleSuffix(args)}`,
        incidentDescription: `A Docker container restarted more than 3 times in the last fifteen minutes — it is crash-looping, not recovering from a one-off failure. Check the root cause for the specific container, then read that container's logs and its restart policy.`,
        criteriaName: "Restart Loop - Restarts > 3 in 15 min",
        criteriaDescription:
          "Triggers when a container's restart counter increases by more than 3 across the monitoring window.",
      }),
      onlineCriteriaInstance: buildDockerOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 3,
        /*
         * Must match the unhealthy side. A pair evaluating the same alias
         * under different window aggregations is not complementary, and the
         * dead band derived from 3 (recover at 2.7) would be measuring a
         * different quantity from the one that fired.
         */
        metricAggregationType: EvaluateOverTimeType.Sum,
      }),
    });
  },
};

const highCpuThrottlingTemplate: DockerAlertTemplate = {
  id: "docker-cpu-throttling",
  name: "Container CPU Throttling",
  description:
    "Alert when a container accumulates more than a second of CPU throttling in five minutes, meaning it is hitting its CPU limit. One alert per container.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: DockerAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "cpu_throttled";

    return buildDockerMonitorStep({
      /*
       * throttled_time is a lifetime NANOSECOND counter, so this template
       * alerts on how much it GREW in the window, not on its value. See
       * buildDockerDeltaMonitorConfig for why the value itself is unusable,
       * and for what the delta does and does not see.
       */
      dockerMonitor: buildDockerDeltaMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "container.cpu.throttling_data.throttled_time",
        maxAlias: "cpu_throttled_max",
        minAlias: "cpu_throttled_min",
        resultAlias: metricAlias,
        resultLegend: "CPU Throttled Time",
        resultLegendUnit: "ms",
        // The counter is nanoseconds; report the growth in milliseconds.
        scaleDivisor: 1000000,
        rollingTime: RollingTime.Past5Minutes,
        groupByAttributeKey: "resource.container.name",
      }),
      offlineCriteriaInstance: buildDockerOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 1000,
        /*
         * Sum, not the AllValues default. Each sample here is ONE MINUTE'S
         * growth, so "how much throttling in the window" is their total.
         * AllValues would instead demand a full second of throttling in
         * every single minute — a much rarer event than the one this
         * template is named for, so the default would quietly disable it.
         * Note the threshold is MEASURED, not real, throttling: at the
         * agent's 30s scrape roughly half is captured, so 1000 ms here is
         * about two seconds of actual throttling per five minutes.
         */
        metricAggregationType: EvaluateOverTimeType.Sum,
        incidentTitle: `[Docker] CPU Throttling Detected${dockerTitleSuffix(args)}`,
        incidentDescription: `A Docker container accumulated more than 1000 ms of CPU throttling in the last 5 minutes. The container is hitting its CPU limit and the kernel's CFS quota is stalling it — throttling is silent, so it surfaces as latency rather than as an error. Consider raising the container's CPU limit or reducing its work. Check the root cause for the container and the throttled time observed.`,
        criteriaName: "CPU Throttling - Throttled Time > 1000 ms per 5 min",
        criteriaDescription:
          "Triggers when a container's CPU throttled time grows by more than 1000 ms over the monitoring window.",
      }),
      onlineCriteriaInstance: buildDockerOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 1000,
        /*
         * Must match the unhealthy side. A pair evaluating the same alias
         * under different window aggregations is not complementary, and the
         * dead band derived from 1000 (recover at 900) would be measuring a
         * different quantity from the one that fired.
         */
        metricAggregationType: EvaluateOverTimeType.Sum,
      }),
    });
  },
};

const highProcessCountTemplate: DockerAlertTemplate = {
  id: "docker-high-pids",
  name: "High Container Process Count",
  description:
    "Alert when a container's task count (processes PLUS threads) stays above 2000, which may indicate a fork bomb, a thread leak, or an unbounded worker pool. One alert per container.",
  category: "Container",
  severity: "Warning",
  getMonitorStep: (args: DockerAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "pids_count";

    return buildDockerMonitorStep({
      dockerMonitor: buildDockerMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "container.pids.count",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
        groupByAttributeKey: "resource.container.name",
      }),
      offlineCriteriaInstance: buildDockerOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 2000,
        incidentTitle: `[Docker] High Process/Thread Count (>2000)${dockerTitleSuffix(args)}`,
        incidentDescription: `A Docker container held more than 2000 tasks for the whole evaluation window. \`container.pids.count\` reads the cgroup pids controller, which counts TASKS — kernel threads as well as processes — so a JVM, an nginx with a large worker pool, or a Go binary sits far above its process count. Sustained above 2000 usually means a fork bomb, a thread leak, or a pool sized without a ceiling. Check the root cause for the container and the observed counts.`,
        criteriaName: "High PIDs - Task Count > 2000",
        criteriaDescription:
          "Triggers when a container's task (process + thread) count stays above 2000 across the monitoring window.",
      }),
      onlineCriteriaInstance: buildDockerOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 2000,
      }),
    });
  },
};

/*
 * KNOWN INERT — do not copy this shape, and do not assume it gives adopters
 * container-down coverage.
 *
 * `container.uptime` is seconds-since-start from the docker_stats receiver,
 * which only scrapes RUNNING containers, so the value is a positive double
 * and `= 0` is unreachable. Absence cannot substitute either: a stopped
 * container emits no datapoint, so it produces no series, and
 * MonitorCriteriaEvaluator discards a grouped criteria whose per-series
 * match list is empty — `onNoDataPolicy: Trigger` would be inert too. The
 * worker's only absent-series injectors are host- and IoT-device-scoped
 * (injectExpectedAbsentHostSeries / injectExpectedAbsentIoTDeviceSeries,
 * gated by HostAbsenceSeries.getHostAbsenceGroupByKey).
 *
 * Real per-container down detection needs an absent-CONTAINER injector in
 * App/FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts.
 * Until that exists this template cannot fire. Removing it is the honest
 * alternative, but that also touches TemplateGroupByKeys.test.ts and six
 * localised docs tables, so it is deliberately left for a follow-up rather
 * than half-done here. PodmanAlertTemplates and DockerSwarmAlertTemplates
 * carry the identical inert design.
 */
const containerUptimeTemplate: DockerAlertTemplate = {
  id: "docker-container-down",
  name: "Container Down (Low Uptime)",
  description:
    "Alert when a container's uptime drops to zero, indicating it has stopped or crashed. One alert per container.",
  category: "Container",
  severity: "Critical",
  getMonitorStep: (args: DockerAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "container_uptime";

    return buildDockerMonitorStep({
      dockerMonitor: buildDockerMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "container.uptime",
        metricAlias,
        rollingTime: RollingTime.Past1Minute,
        aggregationType: MetricsAggregationType.Min,
        groupByAttributeKey: "resource.container.name",
      }),
      offlineCriteriaInstance: buildDockerOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
        incidentTitle: `[Docker] Container Down${dockerTitleSuffix(args)}`,
        incidentDescription: `A Docker container has stopped running. The container uptime is zero, indicating it has crashed, been stopped, or been removed. Check the container status and logs for details.`,
        criteriaName: "Container Down - Uptime = 0",
        criteriaDescription: "Triggers when container uptime drops to zero.",
      }),
      onlineCriteriaInstance: buildDockerOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    });
  },
};

export function getAllDockerAlertTemplates(): Array<DockerAlertTemplate> {
  return [
    highCpuTemplate,
    highMemoryTemplate,
    containerRestartLoopTemplate,
    highCpuThrottlingTemplate,
    highProcessCountTemplate,
    containerUptimeTemplate,
  ];
}

export function getDockerAlertTemplatesByCategory(
  category: DockerAlertTemplateCategory,
): Array<DockerAlertTemplate> {
  return getAllDockerAlertTemplates().filter(
    (template: DockerAlertTemplate) => {
      return template.category === category;
    },
  );
}

export function getDockerAlertTemplateById(
  id: string,
): DockerAlertTemplate | undefined {
  return getAllDockerAlertTemplates().find((template: DockerAlertTemplate) => {
    return template.id === id;
  });
}
