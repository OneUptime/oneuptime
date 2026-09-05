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

// --- Template Definitions ---

const highCpuTemplate: HostAlertTemplate = {
  id: "host-high-cpu",
  name: "High CPU Utilization",
  description: "Alert when host CPU utilization exceeds 80% sustained.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "host_cpu";

    return buildHostMonitorStep({
      hostMonitor: buildHostMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "system.cpu.utilization",
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
        filterType: FilterType.GreaterThan,
        // system.cpu.utilization is a [0, 1] ratio, so 0.8 == 80%.
        value: 0.8,
        incidentTitle: `[Host] High CPU Utilization (>80%) - ${args.monitorName}`,
        incidentDescription: `A monitored host's CPU utilization has exceeded 80%. Sustained high CPU usage can cause performance degradation. Check the root cause for the specific host details.`,
        criteriaName: "High CPU - Utilization > 80%",
        criteriaDescription:
          "Triggers when host CPU utilization exceeds 80% over the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 0.8,
      }),
    });
  },
};

const highMemoryTemplate: HostAlertTemplate = {
  id: "host-high-memory",
  name: "High Memory Utilization",
  description: "Alert when host memory utilization exceeds 85%.",
  category: "Resource",
  severity: "Warning",
  getMonitorStep: (args: HostAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "host_memory";

    return buildHostMonitorStep({
      hostMonitor: buildHostMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "system.memory.utilization",
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
        filterType: FilterType.GreaterThan,
        // system.memory.utilization is a [0, 1] ratio, so 0.85 == 85%.
        value: 0.85,
        incidentTitle: `[Host] High Memory Utilization (>85%) - ${args.monitorName}`,
        incidentDescription: `A monitored host's memory utilization has exceeded 85%. High memory usage can lead to swapping and OOM kills. Check the root cause for the specific host details.`,
        criteriaName: "High Memory - Utilization > 85%",
        criteriaDescription:
          "Triggers when host memory utilization exceeds 85% over the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 0.85,
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
      hostMonitor: buildHostMonitorConfig({
        hostIdentifier: args.hostIdentifier,
        metricName: "system.filesystem.utilization",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Max WITHIN each mountpoint's series: the peak utilization that
         * mount reached during the window. Grouping by `mountpoint` already
         * keeps mounts from being averaged together, and gives one incident
         * per mount so a second mount filling up is not silenced by the
         * first one's open incident.
         */
        aggregationType: MetricsAggregationType.Max,
        /*
         * `mountpoint` is the identity — one incident per mount.
         * `device` rides along because the hostmetrics receiver puts it
         * on the same datapoint, it is constant for a given mount (so it
         * adds no series), and it is the first thing anyone asks after
         * "which mount?": /var at 95% on the same device as / is a
         * different problem from /var on its own disk.
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
        // system.filesystem.utilization is a [0, 1] ratio, so 0.9 == 90%.
        value: 0.9,
        incidentTitle: `[Host] High Filesystem Usage (>90%) - ${args.monitorName}`,
        incidentDescription: `A monitored host's filesystem utilization has exceeded 90%. A full disk can cause application failures and data loss. Check the root cause for the specific host and free up disk space.`,
        criteriaName: "High Filesystem - Usage > 90%",
        criteriaDescription:
          "Triggers when any host filesystem exceeds 90% utilization over the monitoring window.",
      }),
      onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 0.9,
      }),
    });
  },
};

const highLoadAverageTemplate: HostAlertTemplate = {
  id: "host-high-load-average",
  name: "High Load Average (1m)",
  description:
    "Alert when the host's 1-minute load average exceeds 4, indicating sustained CPU contention.",
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
        filterType: FilterType.GreaterThan,
        value: 4,
        incidentTitle: `[Host] High Load Average (1m > 4) - ${args.monitorName}`,
        incidentDescription: `A monitored host's 1-minute load average has exceeded 4. A sustained high load average indicates CPU contention or runaway processes. Compare against the host's core count and check the root cause.`,
        criteriaName: "High Load - 1m Average > 4",
        criteriaDescription:
          "Triggers when the host's 1-minute load average exceeds 4 over the monitoring window.",
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
    "Alert when the host has an unusually high number of processes, which may indicate a fork bomb or resource leak.",
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
        incidentTitle: `[Host] High Process Count (>2000) - ${args.monitorName}`,
        incidentDescription: `A monitored host has an unusually high number of processes (>2000). This may indicate a fork bomb, resource leak, or misconfigured application. Check the host for runaway processes.`,
        criteriaName: "High Processes - Count > 2000",
        criteriaDescription: "Triggers when host process count exceeds 2000.",
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
