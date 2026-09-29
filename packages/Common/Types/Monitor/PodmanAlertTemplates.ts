import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
} from "./Recommendation/RecommendationCriteriaBuilder";
import { FilterType, EvaluateOverTimeType } from "./CriteriaFilter";
import MonitorStepPodmanMonitor from "./MonitorStepPodmanMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type PodmanAlertTemplateCategory = "Container" | "Resource" | "Host";

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

// --- Template Definitions ---

const highCpuTemplate: PodmanAlertTemplate = {
  id: "podman-high-cpu",
  name: "High Container CPU Usage",
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

const containerRestartLoopTemplate: PodmanAlertTemplate = {
  id: "podman-restart-loop",
  name: "High Container Restart Count",
  description:
    "Alert when a container's restart count passes 5. The count is a running total kept by the container engine, not a count of restarts inside the monitoring window. One alert per container.",
  category: "Container",
  severity: "Critical",
  getMonitorStep: (args: PodmanAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "container_restarts";

    return buildPodmanMonitorStep({
      podmanMonitor: buildPodmanMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "container.restarts",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * container.restarts is the engine's RestartCount for the container
         * (contrib docker_stats receiver, enabled in
         * PodmanAgent/otel-collector-config.yaml) — a monotonic running
         * total, NOT a per-window count. Nothing in the alerting path turns
         * a cumulative counter into a delta: ingest stores the raw value and
         * records temporality/monotonicity only as catalog metadata for the
         * dashboard's rate-view hint, and the worker merely buckets values
         * per minute before aggregating. So Max over this window is simply
         * "the current running total" — which is what the copy below says,
         * and what it must keep saying.
         */
        aggregationType: MetricsAggregationType.Max,
        groupByAttributeKey: "resource.container.name",
      }),
      offlineCriteriaInstance: buildPodmanOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 5,
        incidentTitle: `[Podman] Container Restart Count Above 5 - ${args.monitorName}`,
        incidentDescription: `A Podman container has restarted more than 5 times since the container engine last reset its restart count. That count is a running total, so this is NOT five restarts in the last five minutes — check the container's exit code and logs to see whether it is crash-looping right now. The count, and therefore this alert, clears when the container is recreated. The affected container is named in the resources affected on this alert.`,
        criteriaName: "Restart Count - Restarts > 5",
        criteriaDescription:
          "Triggers when a container's running restart total exceeds 5. The total is cumulative rather than per-window, so this criteria stays met until the container is recreated.",
      }),
      onlineCriteriaInstance: buildPodmanOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 5,
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
  description:
    "Alert when a container has an unusually high number of processes, which may indicate a fork bomb or resource leak. One alert per container.",
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
        filterType: FilterType.GreaterThan,
        value: 500,
        incidentTitle: `[Podman] High Process Count (>500) - ${args.monitorName}`,
        incidentDescription: `A Podman container has more than 500 processes. This may indicate a fork bomb, a thread or connection leak, or a misconfigured application. The affected container is named in the resources affected on this alert; inspect it for runaway processes.`,
        criteriaName: "High PIDs - Count > 500",
        criteriaDescription:
          "Triggers when container process count exceeds 500.",
      }),
      onlineCriteriaInstance: buildPodmanOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 500,
      }),
    });
  },
};

const containerUptimeTemplate: PodmanAlertTemplate = {
  id: "podman-container-down",
  name: "Container Restarted (Low Uptime)",
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
