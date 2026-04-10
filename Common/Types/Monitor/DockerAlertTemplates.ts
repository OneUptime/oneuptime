import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import FilterCondition from "../Filter/FilterCondition";
import { CheckOn, FilterType, EvaluateOverTimeType } from "./CriteriaFilter";
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
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  const incidentTitle: string =
    args.incidentTitle || `${args.monitorName} - Alert Triggered`;
  const incidentDescription: string =
    args.incidentDescription ||
    `${args.monitorName} has triggered an alert condition. See root cause for detailed Docker container information.`;

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

export function buildDockerOnlineCriteriaInstance(args: {
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

export function buildDockerMonitorConfig(args: {
  hostIdentifier: string;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string>;
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
  description: "Alert when container CPU usage exceeds 80% sustained.",
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
         * Use Max so a single hot container trips the threshold instead of
         * being diluted by idle containers on the host.
         */
        aggregationType: MetricsAggregationType.Max,
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
  description: "Alert when container memory usage exceeds 85% of its limit.",
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
         * Use Max so a single container breaching its limit trips the
         * threshold instead of being diluted by idle containers.
         */
        aggregationType: MetricsAggregationType.Max,
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
    "Alert when a container has restarted more than 5 times, indicating a crash loop.",
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
    "Alert when a container is being CPU-throttled, indicating it needs more CPU resources.",
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
         * Use Max so a single throttled container trips the threshold,
         * rather than summing throttled time across all containers.
         */
        aggregationType: MetricsAggregationType.Max,
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
    "Alert when a container has an unusually high number of processes, which may indicate a fork bomb or resource leak.",
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
    "Alert when a container's uptime drops to zero, indicating it has stopped or crashed.",
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
