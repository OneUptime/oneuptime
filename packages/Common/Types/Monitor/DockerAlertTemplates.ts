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
import MonitorStepDockerMonitor from "./MonitorStepDockerMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type DockerAlertTemplateCategory =
  | "Availability"
  | "Container"
  | "Resource"
  | "Host";

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
  /*
   * One plain sentence: when the template fires, with its threshold and
   * window, without metric names. The picker and a resource's
   * Recommendations list show it on the card; `description` (how it is
   * computed, and its caveats) is shown once a template is picked.
   */
  summary: string;
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
 * its `resource` processor only upserts `docker.swarm.cluster.name` and
 * `oneuptime.agent.version`), so Swarm container identity is stored
 * `resource.`-prefixed too, and DockerSwarmAlertTemplates.ts groups by
 * `resource.container.name` like these do. The bare `container.name`
 * matches no stored attribute: the worker's grouped read (GROUP BY
 * attributes['key'], MonitorTelemetryMonitor.readQueryDataPoints) reads a
 * missing key as "", which would collapse every container into ONE series
 * with an empty label.
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
  /*
   * What the query is called in an alert's root cause and on its chart
   * ("The sum of Container Restarts ..."). The alias when unset.
   */
  title?: string | undefined;
}): MonitorStepDockerMonitor {
  const title: string = args.title || args.metricAlias;

  return {
    hostIdentifier: args.hostIdentifier,
    containerFilters: {},
    metricViewConfig: {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: args.metricAlias,
            title: title,
            description: title,
            legend: title,
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
 * Only Container CPU Throttling is built on this helper now. Container
 * Restart Loop used it too, and missed half of every crash loop (point 1
 * below): the agent now sends the restarts since its previous sample of a
 * container as `container.restarts.increase`, and that template sums them -
 * see containerRestartLoopTemplate.
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
 * subtracting them. The worker's grouped read buckets rows per (series,
 * minute) in ClickHouse using EACH query's own aggregation (a window up to
 * three hours is bucketed by the minute), so `max - min` is
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

const hostStoppedReportingTemplate: DockerAlertTemplate = {
  id: "docker-host-stopped-reporting",
  name: "Host Stopped Reporting",
  summary: "The Docker host sends no container metrics for 10 minutes.",
  description:
    "Alert when the Docker host sends no container metrics for ten minutes: the host is down, or the Docker agent stopped, lost its route to OneUptime or had its token revoked. A host with no other containers still reports, because the agent runs as a container itself and reports its own.",
  category: "Availability",
  severity: "Critical",
  getMonitorStep: (args: DockerAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = STOPPED_REPORTING_METRIC_ALIAS;

    return buildDockerMonitorStep({
      dockerMonitor: buildDockerMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        /*
         * The heartbeat. docker_stats reports RUNNING containers only, so a
         * host with nothing else running would look silent - except that
         * the agent itself runs as a container (`oneuptime-docker-agent`,
         * DockerAgent/docker-compose.yml, also under its systemd unit,
         * which runs `docker compose up`) and the receiver excludes no
         * image, so its own container.memory.percent arrives every 30s for
         * as long as the agent runs. Ungrouped and counted: only a window
         * with no row from any container is the breach.
         */
        metricName: "container.memory.percent",
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
        resourceNoun: "Docker host",
        incidentTitle: `[Docker] Host Stopped Reporting${dockerTitleSuffix(args)}`,
        incidentDescription: `OneUptime has received no container metrics from this Docker host for ten minutes, so its other monitors have nothing to evaluate either. Check, in order: whether the host is up, whether the \`oneuptime-docker-agent\` container is running and what its logs say (\`docker logs oneuptime-docker-agent\`), and whether the host can reach OneUptime with the agent's token. The incident resolves on its own once metrics arrive again.`,
        criteriaName: "Host Stopped Reporting - No data for 10 minutes",
        criteriaDescription:
          "Triggers when the Docker host sends no container metrics for the whole ten-minute window.",
      }),
    });
  },
};

const highCpuTemplate: DockerAlertTemplate = {
  id: "docker-high-cpu",
  name: "High Container CPU Usage",
  summary: "A container uses more than 80% of one CPU core.",
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
  summary: "A container uses more than 85% of its memory limit.",
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

/*
 * The id stays "docker-restart-loop": it is the stable key the
 * recommendation catalog and the already-created-monitor diff match on.
 *
 * It used to read the growth of `container.restarts` (Docker's lifetime
 * RestartCount) between two samples of the same minute: a Max and a Min
 * query per minute and a formula subtracting them
 * (buildDockerDeltaMonitorConfig). At the agent's 30-second scrape a
 * restart between the last sample of one minute and the first of the next
 * was never counted - about half of every crash loop, so a loop of four to
 * seven restarts in fifteen minutes could pass under "more than 3" - and a
 * manual restart, which starts Docker's count again at 0, read as the whole
 * count in one minute and fired. The alerting path cannot difference values
 * across minutes (no rate or delta in AggregationType or
 * EvaluateOverTimeType, and formulas are evaluated point by point), so the
 * agent does it: every sample carries `container.restarts.increase`, the
 * restarts since its previous sample of the container, however far back
 * that was (cumulative_to_delta/restarts-increase in
 * DockerAgent/otel-collector-config.yaml). Summed per minute and over the
 * window, that is every restart in the window. And docker_stats keeps
 * sampling a container Docker is restarting - Docker reports it as running
 * between its runs - so a container that exits the moment it starts is
 * sampled every 30 seconds too.
 *
 * A host whose agent predates `container.restarts.increase` sends nothing
 * this reads: neither criteria matches, and the docs tell it to update the
 * agent. That is also why monitors made from the old query are left as
 * they are rather than rewritten to this one.
 */
const containerRestartLoopTemplate: DockerAlertTemplate = {
  id: "docker-restart-loop",
  name: "Container Restart Loop",
  summary: "A container restarts more than 3 times in 15 minutes.",
  description:
    "Alert when a container restarts more than 3 times within fifteen minutes: Docker keeps restarting it under its restart policy, so it is crash-looping rather than recovering from a one-off failure. Reads container.restarts.increase, the restarts since the agent's previous sample of the container, so every restart counts however far apart the samples are; a restart by hand starts a new count and is not one. An older Docker agent does not send it: update the agent first. One alert per container.",
  category: "Container",
  severity: "Critical",
  getMonitorStep: (args: DockerAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "container_restarts";

    return buildDockerMonitorStep({
      dockerMonitor: buildDockerMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "container.restarts.increase",
        metricAlias,
        title: "Container Restarts",
        /*
         * Fifteen minutes: Docker's restart back-off doubles up to a minute
         * between restarts, so a real crash loop restarts about once a
         * minute and is well past 3 in fifteen.
         */
        rollingTime: RollingTime.Past15Minutes,
        /*
         * Sum WITHIN each container's series: the restarts in each minute.
         * A minute with no sample of the container has no row, not a zero,
         * and the increase a later sample sends still counts them.
         */
        aggregationType: MetricsAggregationType.Sum,
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
         * sample is ONE MINUTE'S restarts, and most minutes of a crash
         * loop have none, so "every minute breached" is unreachable. The
         * window total is the loop count.
         */
        metricAggregationType: EvaluateOverTimeType.Sum,
        incidentTitle: `[Docker] Container Restart Loop Detected${dockerTitleSuffix(args)}`,
        incidentDescription: `A Docker container restarted more than 3 times in the last fifteen minutes — it is crash-looping, not recovering from a one-off failure. Check the root cause for the specific container, then read that container's logs (\`docker logs --since 15m\`) and its restart policy. The alert clears once the container stops restarting.`,
        criteriaName: "Restart Loop - Restarts > 3 in 15 min",
        criteriaDescription:
          "Triggers when a container restarts more than 3 times across the monitoring window, counted from the restarts the agent sends with each sample.",
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
  summary:
    "A container is held back by its CPU limit for over a second in 5 minutes.",
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
  summary: "A container runs more than 2000 processes and threads.",
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
 * A container that RESTARTED, not one that stopped: the id still says
 * "down" and deliberately stays that way, because it is the stable key the
 * recommendation catalog and the already-created-monitor diff match on
 * (MonitorRecommendationCatalog.buildRecommendationId).
 *
 * This used to fire on `container.uptime = 0`, which can never match:
 * uptime is seconds-since-start from the docker_stats receiver, which only
 * scrapes RUNNING containers, so the value is a positive double and is
 * never sampled at the instant a container starts. Absence cannot
 * substitute either: a stopped container emits no datapoint, so it
 * produces no series, and MonitorCriteriaEvaluator discards a grouped
 * criteria whose per-series match list is empty - the worker's only
 * absent-series injectors are host- and IoT-device-scoped
 * (injectExpectedAbsentHostSeries / injectExpectedAbsentIoTDeviceSeries).
 * A container that stops and stays stopped therefore cannot be detected
 * per container from this data; Host Stopped Reporting covers the host
 * going silent.
 *
 * A LOW uptime is the signal the metric can carry: the container started
 * again recently - the restart policy brought it back after a crash, or it
 * was redeployed. Same shape as PodmanAlertTemplates' podman-container-down.
 */
const containerUptimeTemplate: DockerAlertTemplate = {
  id: "docker-container-down",
  name: "Container Restarted (Low Uptime)",
  summary:
    "A container restarted, crashed or was redeployed in the last 2 minutes.",
  description:
    "Alert when a container's uptime resets, meaning it restarted, crashed and was brought back by its restart policy, or was redeployed in the last two minutes. A container that stops and stays stopped sends no data, so this catches restarts, not a permanent shutdown. One alert per container.",
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
        /*
         * Min WITHIN each container's series: the low sample taken just
         * after a restart survives instead of being averaged away by the
         * scrapes around it.
         */
        aggregationType: MetricsAggregationType.Min,
        groupByAttributeKey: "resource.container.name",
      }),
      offlineCriteriaInstance: buildDockerOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        /*
         * Two minutes is deliberately wider than the 30 s scrape interval
         * and the 60 s evaluation interval, so the once-a-minute evaluator
         * sees the whole Past1Minute window under the threshold whatever
         * the phase of the scrapes; a 60 s threshold on a 60 s window can
         * miss a restart entirely.
         */
        filterType: FilterType.LessThan,
        value: 120,
        incidentTitle: `[Docker] Container Restarted (uptime < 2m)${dockerTitleSuffix(args)}`,
        incidentDescription: `A Docker container's uptime counter has reset, so it crashed and was restarted by its restart policy, was restarted by hand, or was redeployed within the last two minutes. On the host, \`docker inspect\` shows why the last run ended and \`docker logs --since 5m\` what it printed. A container that stops and stays stopped reports no metrics at all, so this alert detects restarts rather than a permanent shutdown, and a container that is meant to run for less than two minutes stays in this state for its whole life. Check the root cause for the container and the observed uptime.`,
        criteriaName: "Container Restarted - Uptime < 120s",
        criteriaDescription:
          "Triggers when a container's uptime stays under 120 seconds for the whole window, which means it started or restarted within the last two minutes.",
      }),
      onlineCriteriaInstance: buildDockerOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 120,
      }),
    });
  },
};

export function getAllDockerAlertTemplates(): Array<DockerAlertTemplate> {
  return [
    hostStoppedReportingTemplate,
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

/*
 * The template a NEW Docker monitor starts on: the host going silent. It is
 * the one template that still speaks when every other one has stopped being
 * evaluated, and it has no threshold to tune.
 */
export function getDockerDefaultAlertTemplateId(): string {
  return hostStoppedReportingTemplate.id;
}
