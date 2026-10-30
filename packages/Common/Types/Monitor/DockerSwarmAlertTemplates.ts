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
import MonitorStepDockerSwarmMonitor from "./MonitorStepDockerSwarmMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type DockerSwarmAlertTemplateCategory =
  | "Availability"
  | "Resource"
  | "Container";

export type DockerSwarmAlertTemplateSeverity = "Critical" | "Warning";

export interface DockerSwarmAlertTemplateArgs {
  clusterIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface DockerSwarmAlertTemplate {
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
  category: DockerSwarmAlertTemplateCategory;
  severity: DockerSwarmAlertTemplateSeverity;
  getMonitorStep: (args: DockerSwarmAlertTemplateArgs) => MonitorStep;
}

/*
 * Filter contract: the docker_stats receiver emits one ResourceMetrics per
 * container and carries container identity as OTLP RESOURCE attributes, so
 * ClickHouse stores them `resource.`-prefixed:
 * `resource.container.name` (a Swarm task's container is
 * `<service>.<slot>.<taskid>`) and `resource.container.image.name`. That is
 * the spelling the ingest side reads back for these very series
 * (OtelMetricsIngestService.bufferDockerSwarmTaskMetric), the spelling the
 * cluster Insights page groups by, and the spelling Docker/Podman use for
 * the same metric family. The whole batch is additionally scoped by the
 * `docker.swarm.cluster.name` RESOURCE attribute the agent stamps (the
 * worker adds `resource.docker.swarm.cluster.name` from the step's
 * clusterIdentifier). Templates group by `resource.container.name` so one
 * incident fires per task. There is NO `container.runtime` filter — the
 * Docker Swarm agent does not stamp it.
 */

export function buildDockerSwarmMonitorStep(args: {
  dockerSwarmMonitor: MonitorStepDockerSwarmMonitor;
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
    dockerMonitor: undefined,
    proxmoxMonitor: undefined,
    dockerSwarmMonitor: args.dockerSwarmMonitor,
  };

  return monitorStep;
}

export function buildDockerSwarmOfflineCriteriaInstance(args: {
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
    resourceNoun: "Swarm task",
  });
}

export function buildDockerSwarmOnlineCriteriaInstance(args: {
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

export function buildDockerSwarmMonitorConfig(args: {
  clusterIdentifier: string;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string>;
  groupByAttributeKey?: string | undefined;
  // Only Swarm's own task containers (DockerSwarmResourceFilters.tasksOnly).
  tasksOnly?: boolean | undefined;
}): MonitorStepDockerSwarmMonitor {
  return {
    clusterIdentifier: args.clusterIdentifier,
    resourceFilters: args.tasksOnly ? { tasksOnly: true } : {},
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

/*
 * Every template groups by `resource.container.name` so each Swarm task is
 * evaluated independently — one incident per task container. The worker
 * always adds the cluster scope (`resource.docker.swarm.cluster.name`)
 * from the step's clusterIdentifier; no container.runtime filter.
 *
 * Every template but Cluster Stopped Reporting watches Swarm's tasks only
 * (`tasksOnly`): the agent runs as a plain container on every node, and so
 * can anything started with `docker run`, and those are not the swarm's
 * workloads. Cluster Stopped Reporting reads the agent's own container as
 * its heartbeat, so it counts every container.
 */

const clusterStoppedReportingTemplate: DockerSwarmAlertTemplate = {
  id: "docker-swarm-cluster-stopped-reporting",
  name: "Cluster Stopped Reporting",
  summary: "The cluster sends no container metrics for 10 minutes.",
  description:
    "Alert when no node of the Swarm cluster sends container metrics for ten minutes: the nodes running the agent are down, or the agent stopped, lost its route to OneUptime or had its token revoked. A node with no tasks still reports, because the agent runs as a container itself and reports its own. One incident for the whole cluster.",
  category: "Availability",
  severity: "Critical",
  getMonitorStep: (args: DockerSwarmAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = STOPPED_REPORTING_METRIC_ALIAS;

    return buildDockerSwarmMonitorStep({
      dockerSwarmMonitor: buildDockerSwarmMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        /*
         * The heartbeat. docker_stats reports RUNNING containers only, but
         * on every node the agent itself runs as one
         * (`oneuptime-docker-swarm-agent`, DockerSwarmAgent/
         * docker-compose.yml) and the receiver excludes no image, so its
         * own container.memory.percent - stamped with the cluster name
         * like every other row of the pipeline - arrives every 30s for as
         * long as any node's agent runs. NOT grouped: a node that leaves
         * the cluster takes its series with it, and the whole-cluster
         * silence is the one this template is for.
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
        resourceNoun: "Docker Swarm cluster",
        incidentTitle: `[Docker Swarm] Cluster Stopped Reporting - ${args.monitorName}`,
        incidentDescription: `OneUptime has received no container metrics from this Docker Swarm cluster for ten minutes, so its other monitors have nothing to evaluate either. Check, in order: whether the nodes running the agent are up, whether the \`oneuptime-docker-swarm-agent\` container is running on them and what its logs say (\`docker logs oneuptime-docker-swarm-agent\`), and whether they can reach OneUptime with the agent's token. The incident resolves on its own once metrics arrive again.`,
        criteriaName: "Cluster Stopped Reporting - No data for 10 minutes",
        criteriaDescription:
          "Triggers when no node of the Swarm cluster sends container metrics for the whole ten-minute window.",
      }),
    });
  },
};

const highCpuTemplate: DockerSwarmAlertTemplate = {
  id: "docker-swarm-high-cpu",
  name: "High Task CPU Usage",
  summary: "A task uses more than 80% of one CPU core.",
  description:
    "Alert when any Swarm task's container uses more than 80% of one CPU core (container.cpu.utilization, where 100% = one full core). One incident per task.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: DockerSwarmAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "container_cpu";

    return buildDockerSwarmMonitorStep({
      dockerSwarmMonitor: buildDockerSwarmMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "container.cpu.utilization",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Avg per task — container.cpu.utilization is already a
         * percentage per container, so the per-minute average is the
         * sustained utilization regardless of scrape count.
         *
         * The scale is CORES, not the task's allocation: docker_stats
         * computes (cpuDelta / systemDelta) * onlineCPUs * 100, so 100%
         * is one full core and an 8-core node's ceiling is 800%. There
         * is no per-container CPU limit series in DockerSwarmMetricCatalog
         * to divide by, and buildDockerSwarmMonitorConfig ships no
         * formulaConfigs, so a percent-of-limit ratio is not expressible
         * here — the wording below must say cores, not limits.
         */
        aggregationType: MetricsAggregationType.Avg,
        groupByAttributeKey: "resource.container.name",
        tasksOnly: true,
      }),
      offlineCriteriaInstance: buildDockerSwarmOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 80,
        incidentTitle: `[Docker Swarm] High Task CPU Usage (>80%) - ${args.monitorName}`,
        incidentDescription: `A Docker Swarm task's container is using more than 80% of one CPU core. container.cpu.utilization is measured against a CPU core, not against the service's CPU reservation — 100% is one full core, so a task granted two cores can reach 200% without exceeding its allocation. Sustained high CPU degrades the service and can trigger Swarm to reschedule the task. Check the root cause for the affected task container, then scale the service out. This monitor applies a single threshold to every task in the cluster, so a service deliberately sized above one core will sit above 100% normally — give those services their own monitor at a threshold matching the cores granted, rather than raising this one.`,
        criteriaName: "High Task CPU - Utilization > 80% of a core",
        criteriaDescription:
          "Triggers when any task's average CPU utilization exceeds 80% of one CPU core over the monitoring window (100% = one full core).",
      }),
      onlineCriteriaInstance: buildDockerSwarmOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 80,
      }),
    });
  },
};

const highMemoryTemplate: DockerSwarmAlertTemplate = {
  id: "docker-swarm-high-memory",
  name: "High Task Memory Usage",
  summary: "A task uses more than 85% of its memory limit.",
  description:
    "Alert when any Swarm task's container memory usage exceeds 85% of its memory limit — or of the node's total memory when the service sets no limit (container.memory.percent). One incident per task.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: DockerSwarmAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "container_memory";

    return buildDockerSwarmMonitorStep({
      dockerSwarmMonitor: buildDockerSwarmMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "container.memory.percent",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Avg per task — container.memory.percent is already a true
         * percentage per container. Its DENOMINATOR is conditional: the
         * container's memory limit when the service sets one, and the
         * node's total memory when it does not (docker_stats mirrors
         * `docker stats` MEM%, and the Docker API's MemoryStats.Limit
         * reports host memory for an unlimited container). See
         * DockerSwarmMetricCatalog: "as a percentage of its limit or the
         * host total". The wording below must not promise a limit.
         */
        aggregationType: MetricsAggregationType.Avg,
        groupByAttributeKey: "resource.container.name",
        tasksOnly: true,
      }),
      offlineCriteriaInstance: buildDockerSwarmOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 85,
        incidentTitle: `[Docker Swarm] High Task Memory Usage (>85%) - ${args.monitorName}`,
        incidentDescription: `A Docker Swarm task's container is using more than 85% of its memory limit — or, when the service sets no --limit-memory, more than 85% of the node's total memory, because container.memory.percent divides by the host total for an unlimited container. Either way the container is close to an OOM kill, which Swarm sees as a task failure and reschedules. Check the root cause for the affected task container. If the service sets a memory limit, raise it or investigate the workload; if it sets none, this is 85% of a whole node and threatens every other task scheduled there — set a limit, then move or scale the service.`,
        criteriaName: "High Task Memory - Usage > 85%",
        criteriaDescription:
          "Triggers when any task's memory usage exceeds 85% of its memory limit — or of the node's total memory for services that set no limit — over the monitoring window.",
      }),
      onlineCriteriaInstance: buildDockerSwarmOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 85,
      }),
    });
  },
};

const highProcessCountTemplate: DockerSwarmAlertTemplate = {
  id: "docker-swarm-high-pids",
  name: "High Task Process Count",
  summary: "A task runs more than 2000 processes and threads.",
  description:
    "Alert when any Swarm task's container holds more than 2000 tasks — processes PLUS threads (container.pids.count > 2000) — which may indicate a fork bomb, a thread leak, or an unbounded worker pool. One incident per task.",
  category: "Container",
  severity: "Warning",
  getMonitorStep: (args: DockerSwarmAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "container_pids";

    return buildDockerSwarmMonitorStep({
      dockerSwarmMonitor: buildDockerSwarmMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "container.pids.count",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        // Max per task — any scrape over the threshold trips it.
        aggregationType: MetricsAggregationType.Max,
        groupByAttributeKey: "resource.container.name",
        tasksOnly: true,
      }),
      offlineCriteriaInstance: buildDockerSwarmOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        /*
         * 2000, as Docker's docker-high-pids. container.pids.count reads
         * the cgroup pids controller, which counts TASKS - threads as well
         * as processes - so 500 was ordinary for a JVM or a Go service and
         * the alert called a task working as designed a fork bomb.
         */
        filterType: FilterType.GreaterThan,
        value: 2000,
        incidentTitle: `[Docker Swarm] High Task Process/Thread Count (>2000) - ${args.monitorName}`,
        incidentDescription: `A Docker Swarm task's container held more than 2000 tasks for the whole evaluation window. container.pids.count reads the cgroup pids controller, which counts TASKS — threads as well as processes — so a JVM or a Go service sits far above its process count. Sustained above 2000 usually means a fork bomb, a thread leak, or a pool sized without a ceiling. Check the root cause for the affected task container and inspect it for runaway processes and threads.`,
        criteriaName: "High Task PIDs - Task Count > 2000",
        criteriaDescription:
          "Triggers when any task's task (process + thread) count stays above 2000 over the monitoring window.",
      }),
      onlineCriteriaInstance: buildDockerSwarmOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 2000,
      }),
    });
  },
};

const taskDownTemplate: DockerSwarmAlertTemplate = {
  id: "docker-swarm-task-down",
  name: "Task Down (Low Uptime)",
  summary: "A task restarted: its container is up for less than 60 seconds.",
  description:
    "Alert when any Swarm task's container has been running for less than 60 seconds, indicating the task was just rescheduled, restarted, or crashed and replaced (container.uptime < 60s). One incident per task.",
  category: "Availability",
  severity: "Critical",
  getMonitorStep: (args: DockerSwarmAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "container_uptime";

    return buildDockerSwarmMonitorStep({
      dockerSwarmMonitor: buildDockerSwarmMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "container.uptime",
        metricAlias,
        rollingTime: RollingTime.Past1Minute,
        /*
         * Min per task — the LOWEST uptime in the bucket, so a task that
         * (re)started inside it is caught by its youngest scrape rather
         * than masked by a later one.
         *
         * The comparison below is a DURATION, not an equality with zero.
         * `container.uptime` is a float-seconds gauge scraped every 30s
         * (DockerSwarmAgent/otel-collector-config.yaml), so it is never
         * exactly 0 at a scrape; and docker_stats lists only running
         * containers, so a dead task's series simply stops instead of
         * reporting zero. Swarm also replaces a failed task with a new
         * task id — hence a new container name and a new series — so
         * "uptime went back to 0" never happens within one series either.
         */
        aggregationType: MetricsAggregationType.Min,
        groupByAttributeKey: "resource.container.name",
        tasksOnly: true,
      }),
      offlineCriteriaInstance: buildDockerSwarmOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 60,
        /*
         * A restart is an EVENT, not a level, so this is one of the few
         * templates that overrides the builder's sustained (AllValues)
         * default — see UnhealthyCriteriaArgs.metricAggregationType.
         *
         * Samples are bucketed per MINUTE before the criteria sees them
         * (aggregatePerSeriesFromRawMetrics), so a Past1Minute window is
         * one or two buckets. Under AllValues EVERY bucket would have to
         * read under 60s, which stops being true the moment the window
         * straddles uptime crossing 60 — leaving a firing window as
         * narrow as the ~1 minute evaluation cadence, and narrower still
         * once ingestion lag is counted, so a real restart can be missed
         * outright. AnyValue asks the question actually intended: did any
         * scrape in the last minute see this container under a minute old.
         *
         * It cannot flap. Uptime only increases within a series, and a
         * replacement task gets a new container name and therefore a new
         * series, so the condition is crossed once and never re-entered.
         * Recovery stays sustained (every bucket >= 66s).
         */
        metricAggregationType: EvaluateOverTimeType.AnyValue,
        incidentTitle: `[Docker Swarm] Task Down - ${args.monitorName}`,
        incidentDescription: `A Docker Swarm task's container has been running for under a minute — the task was rescheduled, restarted, or crashed and replaced. Swarm gives every replacement task a new container name, so a service that keeps firing this is flapping. Check the root cause for the affected task container, then inspect the task's logs and the service's update/restart policy. A planned deploy or scale-up trips this too, and clears itself once the new tasks pass a minute of uptime.`,
        criteriaName: "Task Down - Uptime < 60s",
        criteriaDescription:
          "Triggers when any scrape in the window sees a task's container uptime below 60 seconds — the task (re)started within the last minute. A duration rather than an equality with zero: the gauge is scraped every 30s and is never exactly zero.",
      }),
      onlineCriteriaInstance: buildDockerSwarmOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 60,
      }),
    });
  },
};

export function getAllDockerSwarmAlertTemplates(): Array<DockerSwarmAlertTemplate> {
  return [
    clusterStoppedReportingTemplate,
    taskDownTemplate,
    highCpuTemplate,
    highMemoryTemplate,
    highProcessCountTemplate,
  ];
}

export function getDockerSwarmAlertTemplatesByCategory(
  category: DockerSwarmAlertTemplateCategory,
): Array<DockerSwarmAlertTemplate> {
  return getAllDockerSwarmAlertTemplates().filter(
    (template: DockerSwarmAlertTemplate) => {
      return template.category === category;
    },
  );
}

export function getDockerSwarmAlertTemplateById(
  id: string,
): DockerSwarmAlertTemplate | undefined {
  return getAllDockerSwarmAlertTemplates().find(
    (template: DockerSwarmAlertTemplate) => {
      return template.id === id;
    },
  );
}

/*
 * The template a NEW Docker Swarm monitor starts on: the cluster going
 * silent. It is the one template that still speaks when every other one has
 * stopped being evaluated, and it has no threshold to tune.
 */
export function getDockerSwarmDefaultAlertTemplateId(): string {
  return clusterStoppedReportingTemplate.id;
}
