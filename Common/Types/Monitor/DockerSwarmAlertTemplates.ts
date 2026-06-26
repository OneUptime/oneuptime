import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import FilterCondition from "../Filter/FilterCondition";
import { CheckOn, FilterType, EvaluateOverTimeType } from "./CriteriaFilter";
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
  description: string;
  category: DockerSwarmAlertTemplateCategory;
  severity: DockerSwarmAlertTemplateSeverity;
  getMonitorStep: (args: DockerSwarmAlertTemplateArgs) => MonitorStep;
}

/*
 * Filter contract: the docker_stats receiver keeps container identity in
 * datapoint labels (stored unprefixed in ClickHouse): `container.name`
 * (a Swarm task's container is `<service>.<slot>.<taskid>`) and
 * `container.image.name`. The whole batch is scoped by the
 * `docker.swarm.cluster.name` RESOURCE attribute the agent stamps (the
 * worker adds `resource.docker.swarm.cluster.name` from the step's
 * clusterIdentifier). Templates group by `container.name` so one incident
 * fires per task. There is NO `container.runtime` filter — the Docker
 * Swarm agent does not stamp it.
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
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  const incidentTitle: string =
    args.incidentTitle || `${args.monitorName} - Alert Triggered`;
  const incidentDescription: string =
    args.incidentDescription ||
    `${args.monitorName} has triggered an alert condition. See root cause for detailed Docker Swarm cluster information.`;

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: args.offlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.MetricValue,
        filterType: args.filterType,
        metricMonitorOptions: {
          metricAggregationType: EvaluateOverTimeType.AnyValue,
          metricAlias: args.metricAlias,
        },
        value: args.value,
      },
    ],
    incidents: [
      {
        title: incidentTitle,
        description: incidentDescription,
        incidentSeverityId: args.incidentSeverityId,
        autoResolveIncident: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    alerts: [
      {
        title: incidentTitle,
        description: incidentDescription,
        alertSeverityId: args.alertSeverityId,
        autoResolveAlert: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    changeMonitorStatus: true,
    createIncidents: true,
    createAlerts: true,
    name: args.criteriaName || `${args.monitorName} - Unhealthy`,
    description:
      args.criteriaDescription || `Criteria for detecting unhealthy state.`,
  };

  return instance;
}

export function buildDockerSwarmOnlineCriteriaInstance(args: {
  onlineMonitorStatusId: ObjectID;
  metricAlias: string;
  filterType: FilterType;
  value: number;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: args.onlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.MetricValue,
        filterType: args.filterType,
        metricMonitorOptions: {
          metricAggregationType: EvaluateOverTimeType.AnyValue,
          metricAlias: args.metricAlias,
        },
        value: args.value,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    name: "Healthy",
    description: "Criteria for healthy state.",
  };

  return instance;
}

export function buildDockerSwarmMonitorConfig(args: {
  clusterIdentifier: string;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string>;
  groupByAttributeKey?: string | undefined;
}): MonitorStepDockerSwarmMonitor {
  return {
    clusterIdentifier: args.clusterIdentifier,
    resourceFilters: {},
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
 * Every template groups by `container.name` so each Swarm task is
 * evaluated independently — one incident per task container. The worker
 * always adds the cluster scope (`resource.docker.swarm.cluster.name`)
 * from the step's clusterIdentifier; no container.runtime filter.
 */

const highCpuTemplate: DockerSwarmAlertTemplate = {
  id: "docker-swarm-high-cpu",
  name: "High Task CPU Usage",
  description:
    "Alert when any Swarm task's container CPU utilization exceeds 80% (container.cpu.utilization). One incident per task.",
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
         */
        aggregationType: MetricsAggregationType.Avg,
        groupByAttributeKey: "container.name",
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
        incidentDescription: `A Docker Swarm task's container CPU utilization has exceeded 80%. Sustained high CPU degrades the service and can trigger Swarm to reschedule the task. Check the root cause for the affected task container, then consider scaling the service or raising its CPU reservation/limit.`,
        criteriaName: "High Task CPU - Utilization > 80%",
        criteriaDescription:
          "Triggers when any task's average CPU utilization exceeds 80% over the monitoring window.",
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
  description:
    "Alert when any Swarm task's container memory usage exceeds 85% of its limit (container.memory.percent). One incident per task.",
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
         * percentage per container.
         */
        aggregationType: MetricsAggregationType.Avg,
        groupByAttributeKey: "container.name",
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
        incidentDescription: `A Docker Swarm task's container is using more than 85% of its memory limit. Memory pressure on a task can trigger an OOM kill, which Swarm sees as a task failure and reschedules. Check the root cause for the affected task container, then raise the service's memory limit or investigate the workload.`,
        criteriaName: "High Task Memory - Usage > 85%",
        criteriaDescription:
          "Triggers when any task's memory usage exceeds 85% of its limit over the monitoring window.",
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
  description:
    "Alert when any Swarm task's container has an unusually high number of processes (container.pids.count > 500), which may indicate a fork bomb or resource leak. One incident per task.",
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
        groupByAttributeKey: "container.name",
      }),
      offlineCriteriaInstance: buildDockerSwarmOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 500,
        incidentTitle: `[Docker Swarm] High Task Process Count (>500) - ${args.monitorName}`,
        incidentDescription: `A Docker Swarm task's container has an unusually high number of processes (>500). This may indicate a fork bomb, a thread/connection leak, or a misconfigured application. Check the root cause for the affected task container and inspect it for runaway processes.`,
        criteriaName: "High Task PIDs - Count > 500",
        criteriaDescription:
          "Triggers when any task's process count exceeds 500 over the monitoring window.",
      }),
      onlineCriteriaInstance: buildDockerSwarmOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 500,
      }),
    });
  },
};

const taskDownTemplate: DockerSwarmAlertTemplate = {
  id: "docker-swarm-task-down",
  name: "Task Down (Low Uptime)",
  description:
    "Alert when any Swarm task's container uptime drops to zero, indicating the task has been rescheduled, restarted, or crashed (container.uptime = 0). One incident per task.",
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
         * Min per task — a single zero-uptime scrape (a fresh restart)
         * trips the threshold instead of being masked by scrapes where
         * the task had been running for a while.
         */
        aggregationType: MetricsAggregationType.Min,
        groupByAttributeKey: "container.name",
      }),
      offlineCriteriaInstance: buildDockerSwarmOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
        incidentTitle: `[Docker Swarm] Task Down - ${args.monitorName}`,
        incidentDescription: `A Docker Swarm task's container uptime has dropped to zero — the task was rescheduled, restarted, or crashed. Repeated restarts mean the service is flapping. Check the root cause for the affected task container, then inspect the task's logs and the service's update/restart policy.`,
        criteriaName: "Task Down - Uptime = 0",
        criteriaDescription:
          "Triggers when any task's container uptime drops to zero.",
      }),
      onlineCriteriaInstance: buildDockerSwarmOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    });
  },
};

export function getAllDockerSwarmAlertTemplates(): Array<DockerSwarmAlertTemplate> {
  return [
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
