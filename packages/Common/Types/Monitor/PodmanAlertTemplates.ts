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
import MonitorStepPodmanMonitor from "./MonitorStepPodmanMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type PodmanAlertTemplateCategory =
  | "Availability"
  | "Container"
  | "Resource"
  | "Host";

export type PodmanAlertTemplateSeverity = "Critical" | "Warning";

export interface PodmanAlertTemplateArgs {
  hostIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface PodmanAlertTemplate {
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
  category: PodmanAlertTemplateCategory;
  severity: PodmanAlertTemplateSeverity;
  getMonitorStep: (args: PodmanAlertTemplateArgs) => MonitorStep;
}

/*
 * Filter contract: the Podman agent stamps container identity as OTLP
 * RESOURCE attributes, so ClickHouse stores them `resource.`-prefixed:
 * `resource.container.name`, `resource.container.image.name`,
 * `resource.container.runtime` ("podman") and `resource.host.name`. The
 * worker adds the host scope (`resource.host.name` from hostIdentifier)
 * and the runtime filter itself. Every template groups by
 * `resource.container.name` so each container on the host is evaluated
 * independently — one incident per container instead of one incident for
 * the whole host, where the busiest container silences every other one.
 */

export function buildPodmanMonitorStep(args: {
  podmanMonitor: MonitorStepPodmanMonitor;
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
    podmanMonitor: args.podmanMonitor,
  };

  return monitorStep;
}

export function buildPodmanOfflineCriteriaInstance(args: {
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

export function buildPodmanOnlineCriteriaInstance(args: {
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

export function buildPodmanMonitorConfig(args: {
  hostIdentifier: string;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string>;
  groupByAttributeKey?: string | undefined;
}): MonitorStepPodmanMonitor {
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
 * Two queries over the SAME lifetime counter, differenced per one-minute
 * bucket and summed over the window by the criteria: the counter's growth.
 * The same house pattern, and the same limits, as
 * DockerAlertTemplates.buildDockerDeltaMonitorConfig - read that comment
 * before changing this one. In short: only growth between two samples of
 * the same minute is seen (about half of it at the agent's 30 s interval),
 * so it is a lower bound that cannot manufacture a breach, and it reads 0
 * at a 60 s interval or slower.
 */
export function buildPodmanDeltaMonitorConfig(args: {
  hostIdentifier: string;
  metricName: string;
  maxAlias: string;
  minAlias: string;
  resultAlias: string;
  resultLegend: string;
  rollingTime: RollingTime;
  groupByAttributeKey: string;
}): MonitorStepPodmanMonitor {
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
        legendUnit: undefined,
      },
      metricQueryData: {
        filterData: {
          metricName: args.metricName,
          attributes: {},
          aggegationType: aggregationType,
          aggregateBy: {},
        },
        // Both halves group identically, or the formula's join finds nothing.
        groupByAttributeKeys: [args.groupByAttributeKey],
      },
    };
  };

  return {
    hostIdentifier: args.hostIdentifier,
    containerFilters: {},
    metricViewConfig: {
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
            // A dimensionless count.
            legendUnit: undefined,
          },
          metricFormulaData: {
            metricFormula: `${args.maxAlias} - ${args.minAlias}`,
          },
        },
      ],
    },
    rollingTime: args.rollingTime,
  };
}

// --- Template Definitions ---

const hostStoppedReportingTemplate: PodmanAlertTemplate = {
  id: "podman-host-stopped-reporting",
  name: "Host Stopped Reporting",
  summary: "The Podman host sends no container metrics for 10 minutes.",
  description:
    "Alert when the Podman host sends no container metrics for ten minutes: the host is down, or the Podman agent stopped, lost its route to OneUptime or had its token revoked. A host with no other containers still reports, because the agent runs as a container itself and reports its own.",
  category: "Availability",
  severity: "Critical",
  getMonitorStep: (args: PodmanAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = STOPPED_REPORTING_METRIC_ALIAS;

    return buildPodmanMonitorStep({
      podmanMonitor: buildPodmanMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        /*
         * The heartbeat. docker_stats reports RUNNING containers only, but
         * the agent itself runs as one (`oneuptime-podman-agent`,
         * PodmanAgent/docker-compose.yml, also under its systemd unit,
         * which runs `podman compose up`) on the socket it reads, and the
         * receiver excludes no image - so its own container.memory.percent
         * arrives every 30s for as long as the agent runs. Ungrouped and
         * counted: only a window with no row from any container is the
         * breach.
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
        resourceNoun: "Podman host",
        incidentTitle: `[Podman] Host Stopped Reporting - ${args.monitorName}`,
        incidentDescription: `OneUptime has received no container metrics from this Podman host for ten minutes, so its other monitors have nothing to evaluate either. Check, in order: whether the host is up, whether the \`oneuptime-podman-agent\` container is running and what its logs say (\`podman logs oneuptime-podman-agent\`), whether the Podman socket it reads is still there, and whether the host can reach OneUptime with the agent's token. The incident resolves on its own once metrics arrive again.`,
        criteriaName: "Host Stopped Reporting - No data for 10 minutes",
        criteriaDescription:
          "Triggers when the Podman host sends no container metrics for the whole ten-minute window.",
      }),
    });
  },
};

const highCpuTemplate: PodmanAlertTemplate = {
  id: "podman-high-cpu",
  name: "High Container CPU Usage",
  summary: "A container averages more than 80% of one CPU core for 5 minutes.",
  description:
    "Alert when a container averages more than 80% of one CPU core for five minutes. 100% is one full core, so a container spread across several cores reads well above 100. One alert per container.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: PodmanAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "container_cpu";

    return buildPodmanMonitorStep({
      podmanMonitor: buildPodmanMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "container.cpu.utilization",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Avg WITHIN each container's series, matching this metric's
         * documented default in PodmanMetricCatalog and the sibling Docker
         * Swarm template on the identical metric and threshold.
         * container.cpu.utilization is already a per-container percentage,
         * so the per-minute average IS the sustained utilization. GROUPING
         * by container name — not Max — is what keeps a hot container from
         * being diluted by idle ones, so Max buys nothing here and only
         * makes a 40-second burst read as a full minute above the
         * threshold, which contradicts the word "sustained" in the copy.
         */
        aggregationType: MetricsAggregationType.Avg,
        groupByAttributeKey: "resource.container.name",
      }),
      offlineCriteriaInstance: buildPodmanOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 80,
        incidentTitle: `[Podman] High Container CPU (over 80% of one core) - ${args.monitorName}`,
        incidentDescription: `A Podman container has averaged more than 80% of one CPU core for five minutes. container.cpu.utilization is the same figure podman stats prints: 100% is one full core, so this threshold means "most of a core", not "near the container's CPU limit" — a container given several cores reads well above 100 while perfectly healthy. See the resources affected on this alert for which container it is.`,
        criteriaName: "High CPU - Over 80% of one core (5 min)",
        criteriaDescription:
          "Triggers when a container's CPU utilization averages over 80 for every minute of the window. The scale is percent of ONE core (100 = one full core), not percent of the container's CPU limit.",
      }),
      onlineCriteriaInstance: buildPodmanOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 80,
      }),
    });
  },
};

const highMemoryTemplate: PodmanAlertTemplate = {
  id: "podman-high-memory",
  name: "High Container Memory Usage",
  summary: "A container averages more than 85% of its memory for 5 minutes.",
  description:
    "Alert when a container averages more than 85% memory usage for five minutes — of its --memory limit where one is set, of host memory where it is not. One alert per container.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: PodmanAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "container_memory";

    return buildPodmanMonitorStep({
      podmanMonitor: buildPodmanMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "container.memory.percent",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Avg WITHIN each container's series, matching this metric's
         * documented default in PodmanMetricCatalog and the sibling Docker
         * Swarm template on the identical metric and threshold.
         * container.memory.percent is already a true percentage per
         * container, so the per-minute average is the sustained reading;
         * grouping by container name — not Max — is what keeps a container
         * at its limit from being diluted by idle ones.
         */
        aggregationType: MetricsAggregationType.Avg,
        groupByAttributeKey: "resource.container.name",
      }),
      offlineCriteriaInstance: buildPodmanOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 85,
        incidentTitle: `[Podman] High Container Memory (>85%) - ${args.monitorName}`,
        incidentDescription: `A Podman container has averaged more than 85% memory usage for five minutes. container.memory.percent is measured against the container's memory limit where one is set with --memory, and against the host's total memory where it is not — so on a container with a limit this is close to an OOM kill, and on one without a limit it means the container is consuming most of the host. See the resources affected on this alert for which container it is.`,
        criteriaName: "High Memory - Usage > 85%",
        criteriaDescription:
          "Triggers when a container's memory usage averages over 85% for every minute of the window — of its memory limit where one is set, of host memory where it is not.",
      }),
      onlineCriteriaInstance: buildPodmanOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 85,
      }),
    });
  },
};

/*
 * The id stays "podman-restart-loop": it is the stable key the
 * recommendation catalog and the already-created-monitor diff match on.
 */
const containerRestartLoopTemplate: PodmanAlertTemplate = {
  id: "podman-restart-loop",
  name: "Container Restart Loop",
  summary: "A container restarts more than 3 times in 15 minutes.",
  description:
    "Alert when a container's restart count climbs by more than 3 within fifteen minutes, indicating a crash loop. The count only grows between two samples of the same minute, and the agent samples running containers only, so a container that exits the moment it starts is rarely seen at all: Container Restarted (Low Uptime) catches every restart the agent does see. One alert per container.",
  category: "Container",
  severity: "Critical",
  getMonitorStep: (args: PodmanAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "container_restarts";

    return buildPodmanMonitorStep({
      /*
       * NOT the restart count itself. container.restarts is the engine's
       * RestartCount for the container - a lifetime total. Thresholding it
       * ("> 5") fired on a container's history, and could never recover:
       * a counter that only grows never comes back under its threshold, so
       * the alert stayed open until the container was recreated. Its
       * GROWTH in the window is the loop signal; the same delta, window
       * and threshold as Docker's docker-restart-loop.
       */
      podmanMonitor: buildPodmanDeltaMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "container.restarts",
        maxAlias: "container_restarts_max",
        minAlias: "container_restarts_min",
        resultAlias: metricAlias,
        resultLegend: "Container Restarts (in window)",
        // Fifteen minutes, for the reasons docker-restart-loop gives.
        rollingTime: RollingTime.Past15Minutes,
        groupByAttributeKey: "resource.container.name",
      }),
      offlineCriteriaInstance: buildPodmanOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 3,
        /*
         * Sum, not the sustained AllValues default: each sample is ONE
         * MINUTE'S restart increment, and the window total is the count.
         */
        metricAggregationType: EvaluateOverTimeType.Sum,
        incidentTitle: `[Podman] Container Restart Loop Detected - ${args.monitorName}`,
        incidentDescription: `A Podman container restarted more than 3 times in the last fifteen minutes — it is crash-looping, not recovering from a one-off failure. The affected container is named in the resources affected on this alert; read its logs and its restart policy. The alert clears once the container stops restarting.`,
        criteriaName: "Restart Loop - Restarts > 3 in 15 min",
        criteriaDescription:
          "Triggers when a container's restart counter increases by more than 3 across the monitoring window. The growth is counted between two samples of the same minute, so it is a lower bound.",
      }),
      onlineCriteriaInstance: buildPodmanOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 3,
        // Must match the unhealthy side: a sum of per-minute growth.
        metricAggregationType: EvaluateOverTimeType.Sum,
      }),
    });
  },
};

/*
 * There is deliberately no CPU-throttling template.
 *
 * The only throttling signals the agent enables
 * (container.cpu.throttling_data.throttled_time / .throttled_periods, see
 * PodmanAgent/otel-collector-config.yaml) are CUMULATIVE monotonic
 * counters — lifetime totals for the container, as PodmanMetricCatalog
 * itself documents ("Total time the container CPU has been throttled",
 * unit ns). Nothing between ingest and the criteria evaluator turns a
 * cumulative counter into a delta or a rate: the collector pipeline has no
 * cumulativetodelta processor, OtelMetricsIngestService stores
 * aggregationTemporality/isMonotonic only so the browser can auto-suggest
 * rate views, AggregationType has no rate/increase member, and
 * CompareCriteria.reduceWindow offers only Average/Sum/Max/Min.
 *
 * So "throttled_time > 0" means "this container has been throttled at some
 * point since it was created" — true forever once true, for any container
 * with a CPU quota that has ever burst. It fires and the "= 0" recovery is
 * unreachable, leaving a permanently open alert that only a container
 * recreation can clear. getRecoveryThreshold() returns undefined at a
 * threshold of 0, so the recovery dead band does not apply here either.
 * Reinstate this template on a windowed delta, not on the raw counter.
 */

const highProcessCountTemplate: PodmanAlertTemplate = {
  id: "podman-high-pids",
  name: "High Container Process Count",
  summary: "A container runs more than 2000 processes and threads.",
  description:
    "Alert when a container's task count (processes PLUS threads) stays above 2000, which may indicate a fork bomb, a thread leak, or an unbounded worker pool. One alert per container.",
  category: "Container",
  severity: "Warning",
  getMonitorStep: (args: PodmanAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "pids_count";

    return buildPodmanMonitorStep({
      podmanMonitor: buildPodmanMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "container.pids.count",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
        groupByAttributeKey: "resource.container.name",
      }),
      offlineCriteriaInstance: buildPodmanOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        /*
         * 2000, as Docker's docker-high-pids. container.pids.count reads
         * the cgroup pids controller, which counts TASKS - threads as well
         * as processes - so 500 was ordinary for a JVM, an nginx with a
         * large worker pool or a Go binary, and the alert called a
         * container working as designed a fork bomb.
         */
        filterType: FilterType.GreaterThan,
        value: 2000,
        incidentTitle: `[Podman] High Process/Thread Count (>2000) - ${args.monitorName}`,
        incidentDescription: `A Podman container held more than 2000 tasks for the whole evaluation window. container.pids.count reads the cgroup pids controller, which counts TASKS — threads as well as processes — so a JVM, an nginx with a large worker pool, or a Go binary sits far above its process count. Sustained above 2000 usually means a fork bomb, a thread leak, or a pool sized without a ceiling. The affected container is named in the resources affected on this alert; inspect it for runaway processes and threads.`,
        criteriaName: "High PIDs - Task Count > 2000",
        criteriaDescription:
          "Triggers when a container's task (process + thread) count stays above 2000 across the monitoring window.",
      }),
      onlineCriteriaInstance: buildPodmanOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 2000,
      }),
    });
  },
};

const containerUptimeTemplate: PodmanAlertTemplate = {
  id: "podman-container-down",
  name: "Container Restarted (Low Uptime)",
  summary:
    "A container restarted, crashed or was redeployed in the last 2 minutes.",
  description:
    "Alert when a container's uptime resets, meaning it restarted, crashed or was redeployed in the last two minutes. One alert per container.",
  category: "Container",
  severity: "Critical",
  getMonitorStep: (args: PodmanAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "container_uptime";

    return buildPodmanMonitorStep({
      podmanMonitor: buildPodmanMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "container.uptime",
        metricAlias,
        rollingTime: RollingTime.Past1Minute,
        /*
         * Min WITHIN each container's series: the evaluator buckets raw
         * samples per container per minute and reduces each bucket with this
         * aggregation, so the low sample taken just after a restart survives
         * instead of being averaged away by the scrapes around it.
         */
        aggregationType: MetricsAggregationType.Min,
        groupByAttributeKey: "resource.container.name",
      }),
      offlineCriteriaInstance: buildPodmanOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        /*
         * NOT "= 0". container.uptime is seconds since the container
         * started, and the docker_stats receiver only scrapes RUNNING
         * containers: a stopped container emits no row at all rather than a
         * zero, and a running one is never scraped at the exact instant it
         * started. "= 0" therefore never matched, which made this template
         * inert.
         *
         * A low uptime is the signal this metric can actually carry. Two
         * minutes is deliberately wider than the 30s scrape interval and the
         * 60s evaluation interval, so the once-a-minute evaluator sees the
         * whole Past1Minute window under the threshold whatever the phase of
         * the scrapes; a 60s threshold on a 60s window can miss a restart
         * entirely.
         */
        filterType: FilterType.LessThan,
        value: 120,
        incidentTitle: `[Podman] Container Restarted (uptime < 2m) - ${args.monitorName}`,
        incidentDescription: `A Podman container's uptime counter has reset, so it crashed, was stopped, or was redeployed within the last two minutes. The affected container is named in the resources affected on this alert; check its exit code and logs. Note that a container which stops and stays stopped reports no metrics at all, so this alert detects restarts rather than a permanent shutdown, and a container that is meant to run for less than two minutes will stay in this state for its whole life.`,
        criteriaName: "Container Restarted - Uptime < 120s",
        criteriaDescription:
          "Triggers when a container's uptime stays under 120 seconds for the whole window, which means it started or restarted within the last two minutes.",
      }),
      onlineCriteriaInstance: buildPodmanOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 120,
      }),
    });
  },
};

export function getAllPodmanAlertTemplates(): Array<PodmanAlertTemplate> {
  return [
    hostStoppedReportingTemplate,
    highCpuTemplate,
    highMemoryTemplate,
    containerRestartLoopTemplate,
    highProcessCountTemplate,
    containerUptimeTemplate,
  ];
}

export function getPodmanAlertTemplatesByCategory(
  category: PodmanAlertTemplateCategory,
): Array<PodmanAlertTemplate> {
  return getAllPodmanAlertTemplates().filter(
    (template: PodmanAlertTemplate) => {
      return template.category === category;
    },
  );
}

export function getPodmanAlertTemplateById(
  id: string,
): PodmanAlertTemplate | undefined {
  return getAllPodmanAlertTemplates().find((template: PodmanAlertTemplate) => {
    return template.id === id;
  });
}

/*
 * The template a NEW Podman monitor starts on: the host going silent. It is
 * the one template that still speaks when every other one has stopped being
 * evaluated, and it has no threshold to tune.
 */
export function getPodmanDefaultAlertTemplateId(): string {
  return hostStoppedReportingTemplate.id;
}
