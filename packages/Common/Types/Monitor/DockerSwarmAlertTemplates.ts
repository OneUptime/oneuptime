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

/*
 * Two queries and a formula over them, for a template that judges a
 * difference rather than one series - a service's replicas wanted less the
 * ones it runs. Both queries group by the same keys, which the poller puts
 * on both series of a service's resource, so the formula's fingerprint join
 * pairs each service's two readings.
 */
export interface DockerSwarmFormulaQuery {
  alias: string;
  metricName: string;
  aggregationType: MetricsAggregationType;
}

export function buildDockerSwarmFormulaMonitorConfig(args: {
  clusterIdentifier: string;
  queries: Array<DockerSwarmFormulaQuery>;
  formula: string;
  resultAlias: string;
  resultLegend: string;
  // Display only: "" for a count.
  resultLegendUnit: string;
  groupByAttributeKey: string;
  rollingTime: RollingTime;
}): MonitorStepDockerSwarmMonitor {
  return {
    clusterIdentifier: args.clusterIdentifier,
    resourceFilters: {},
    metricViewConfig: {
      queryConfigs: args.queries.map((query: DockerSwarmFormulaQuery) => {
        return {
          metricAliasData: {
            metricVariable: query.alias,
            title: query.alias,
            description: query.alias,
            legend: query.alias,
            legendUnit: undefined,
          },
          metricQueryData: {
            filterData: {
              metricName: query.metricName,
              attributes: {},
              aggegationType: query.aggregationType,
              aggregateBy: {},
            },
            groupByAttributeKeys: [args.groupByAttributeKey],
          },
        };
      }),
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
            metricFormula: args.formula,
          },
        },
      ],
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
         * (the worker's grouped read, MonitorTelemetryMonitor's
         * readQueryDataPoints), so a Past1Minute window is
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

/*
 * The swarm's own state, from the agent's poller (files 0.161.3 on): every
 * minute it reads `docker node ls` and `docker service ls` from a manager
 * and sends, per node, docker.swarm.node.ready (1 while the node is ready)
 * and, per replicated or global service, docker.swarm.service.replicas
 * .desired and .running - on a resource named as the node's and the
 * service's task containers are (`resource.docker.swarm.node.name`,
 * `resource.docker.swarm.service.name`). Not task containers, so neither
 * template asks for tasksOnly. An agent older than 0.161.3 sends neither
 * series: both templates then have nothing to read and never fire, and the
 * cluster's agent version shows the sign that says to upgrade it.
 */
const nodeNotReadyTemplate: DockerSwarmAlertTemplate = {
  id: "docker-swarm-node-not-ready",
  name: "Node Not Ready",
  summary: "A node is down or disconnected for 5 minutes.",
  description:
    "Alert when a Swarm node has not been ready for five minutes: the managers have lost its heartbeat, so it is down or disconnected, and Swarm moves its replicated tasks to other nodes while its global ones stop. Read every minute from the managers' own view (docker.swarm.node.ready, from the agent's poller, files 0.161.3 on). One incident per node.",
  category: "Availability",
  severity: "Critical",
  getMonitorStep: (args: DockerSwarmAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "node_ready";

    return buildDockerSwarmMonitorStep({
      dockerSwarmMonitor: buildDockerSwarmMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "docker.swarm.node.ready",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Min per node: one reading a minute, 1 or 0, so the minute's
         * lowest is whether the node was ready all of it.
         */
        aggregationType: MetricsAggregationType.Min,
        groupByAttributeKey: "resource.docker.swarm.node.name",
      }),
      offlineCriteriaInstance: buildDockerSwarmOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 1,
        incidentTitle: `[Docker Swarm] Node Not Ready - ${args.monitorName}`,
        incidentDescription: `A Docker Swarm node has not been ready for five minutes: the swarm's managers have lost its heartbeat, so it is down, disconnected or cut off from them. Swarm moves the node's replicated tasks to the other nodes, if they have room, and a global service's task on it stops. Run \`docker node ls\` on a manager to see the node's status and \`docker node inspect <node> --pretty\` for Swarm's message about it; then check that the machine is up, that its Docker daemon runs, and that it can reach the managers on ports 2377, 7946 and 4789. If the node is a manager, the swarm can lose fewer managers until it is back. The incident resolves on its own once the node is ready again.`,
        criteriaName: "Node Not Ready - Not ready for 5 minutes",
        criteriaDescription:
          "Triggers when a node reads not ready in every minute of a five-minute window.",
      }),
      onlineCriteriaInstance: buildDockerSwarmOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
        isBinaryMetric: true,
      }),
    });
  },
};

const serviceReplicasMismatchTemplate: DockerSwarmAlertTemplate = {
  id: "docker-swarm-service-replicas-mismatch",
  name: "Service Replicas Mismatch",
  summary: "A service runs fewer replicas than it wants for 15 minutes.",
  description:
    "Alert when a replicated or global Swarm service has run fewer tasks than it wants for fifteen minutes - the REPLICAS column of docker service ls reading 2/3. Computed per service as docker.swarm.service.replicas.desired - docker.swarm.service.replicas.running, read every minute from a manager by the agent's poller (files 0.161.3 on). Fifteen minutes, so a rolling update that replaces its tasks a few at a time does not page. One incident per service.",
  category: "Availability",
  severity: "Warning",
  getMonitorStep: (args: DockerSwarmAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "replica_shortfall";

    return buildDockerSwarmMonitorStep({
      dockerSwarmMonitor: buildDockerSwarmFormulaMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        /*
         * ONE reading a minute of each, from the same `docker service ls`,
         * so Avg is the minute's count whatever the reading's rate; Sum
         * would multiply the shortfall by the readings in the minute.
         */
        queries: [
          {
            alias: "desired_replicas",
            metricName: "docker.swarm.service.replicas.desired",
            aggregationType: MetricsAggregationType.Avg,
          },
          {
            alias: "running_replicas",
            metricName: "docker.swarm.service.replicas.running",
            aggregationType: MetricsAggregationType.Avg,
          },
        ],
        formula: "desired_replicas - running_replicas",
        resultAlias: metricAlias,
        resultLegend: "Service Replica Shortfall",
        // A task count, not a percentage.
        resultLegendUnit: "",
        groupByAttributeKey: "resource.docker.swarm.service.name",
        /*
         * 15 minutes, as Kubernetes' Deployment Replica Mismatch: with the
         * sustained (AllValues) default every minute must be short, and a
         * rolling update of a service with slow health checks keeps it
         * short for longer than five.
         */
        rollingTime: RollingTime.Past15Minutes,
      }),
      offlineCriteriaInstance: buildDockerSwarmOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[Docker Swarm] Service Replicas Mismatch - ${args.monitorName}`,
        incidentDescription: `A Docker Swarm service has run fewer tasks than it wants for fifteen minutes. Its tasks keep failing, no node can run them (not enough CPU or memory, a placement constraint no node meets, an image no node can pull), or the nodes that ran them are down; when none of them run, the service is down. Run \`docker service ps <service> --no-trunc\` on a manager: its ERROR column says why each task failed or waits. The incident resolves on its own once the service runs every replica again.`,
        criteriaName: "Replicas Mismatch - Desired > Running for 15 minutes",
        criteriaDescription:
          "Triggers when a service's wanted replicas exceed the ones it runs in every minute of a fifteen-minute window - long enough that a normal rolling update has finished.",
      }),
      onlineCriteriaInstance: buildDockerSwarmOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 0,
      }),
    });
  },
};

export function getAllDockerSwarmAlertTemplates(): Array<DockerSwarmAlertTemplate> {
  return [
    clusterStoppedReportingTemplate,
    nodeNotReadyTemplate,
    serviceReplicasMismatchTemplate,
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
