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
 * NOTE: this is `resource.`-prefixed, unlike Docker Swarm, whose
 * docker_stats receiver keeps container identity in DATAPOINT labels
 * (plain `container.name`).
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

// --- Template Definitions ---

const highCpuTemplate: DockerAlertTemplate = {
  id: "docker-high-cpu",
  name: "High Container CPU Usage",
  description:
    "Alert when container CPU usage exceeds 80% sustained. One alert per container.",
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
        incidentTitle: `[Docker] High CPU Usage (>80%) - ${args.monitorName}`,
        incidentDescription: `A Docker container's CPU usage has exceeded 80%. Sustained high CPU usage can cause performance degradation and throttling. Check the root cause for the specific container and host details.`,
        criteriaName: "High CPU - Usage > 80%",
        criteriaDescription:
          "Triggers when any container's CPU usage exceeds 80% over the monitoring window.",
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
    "Alert when container memory usage exceeds 85% of its limit. One alert per container.",
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
        incidentTitle: `[Docker] High Memory Usage (>85%) - ${args.monitorName}`,
        incidentDescription: `A Docker container's memory usage has exceeded 85% of its limit. High memory usage can lead to OOM kills and container restarts. Check the root cause for the specific container and host details.`,
        criteriaName: "High Memory - Usage > 85%",
        criteriaDescription:
          "Triggers when any container's memory usage exceeds 85% over the monitoring window.",
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
    "Alert when a container has restarted more than 5 times, indicating a crash loop. One alert per container.",
  category: "Container",
  severity: "Critical",
  getMonitorStep: (args: DockerAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "container_restarts";

    return buildDockerMonitorStep({
      dockerMonitor: buildDockerMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "container.restarts",
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
        value: 5,
        incidentTitle: `[Docker] Container Restart Loop Detected - ${args.monitorName}`,
        incidentDescription: `A Docker container is repeatedly crashing and restarting. The container restart count has exceeded 5. This indicates a crash loop that needs immediate attention. Check the root cause for the specific container, exit code, and logs.`,
        criteriaName: "Restart Loop - Restarts > 5",
        criteriaDescription:
          "Triggers when any container restart count exceeds 5 in the monitoring window.",
      }),
      onlineCriteriaInstance: buildDockerOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 5,
      }),
    });
  },
};

const highCpuThrottlingTemplate: DockerAlertTemplate = {
  id: "docker-cpu-throttling",
  name: "Container CPU Throttling",
  description:
    "Alert when a container is being CPU-throttled, indicating it needs more CPU resources. One alert per container.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: DockerAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "cpu_throttled";

    return buildDockerMonitorStep({
      dockerMonitor: buildDockerMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "container.cpu.throttling_data.throttled_time",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Max WITHIN each container's series, so throttled time is never
         * summed across containers — grouping by container name attributes
         * the throttling to the container that actually suffered it.
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
        value: 0,
        incidentTitle: `[Docker] CPU Throttling Detected - ${args.monitorName}`,
        incidentDescription: `A Docker container is being CPU-throttled. This means the container is hitting its CPU limit and performance is degraded. Consider increasing the CPU limit or optimizing the application.`,
        criteriaName: "CPU Throttling - Throttled Time > 0",
        criteriaDescription:
          "Triggers when any container reports CPU throttling.",
      }),
      onlineCriteriaInstance: buildDockerOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    });
  },
};

const highProcessCountTemplate: DockerAlertTemplate = {
  id: "docker-high-pids",
  name: "High Container Process Count",
  description:
    "Alert when a container has an unusually high number of processes, which may indicate a fork bomb or resource leak. One alert per container.",
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
        value: 500,
        incidentTitle: `[Docker] High Process Count (>500) - ${args.monitorName}`,
        incidentDescription: `A Docker container has an unusually high number of processes (>500). This may indicate a fork bomb, resource leak, or misconfigured application. Check the container for runaway processes.`,
        criteriaName: "High PIDs - Count > 500",
        criteriaDescription:
          "Triggers when container process count exceeds 500.",
      }),
      onlineCriteriaInstance: buildDockerOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 500,
      }),
    });
  },
};

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
        incidentTitle: `[Docker] Container Down - ${args.monitorName}`,
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
