import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import FilterCondition from "../Filter/FilterCondition";
import { CheckOn, FilterType, EvaluateOverTimeType } from "./CriteriaFilter";
import MonitorStepProxmoxMonitor from "./MonitorStepProxmoxMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type ProxmoxAlertTemplateCategory = "Node" | "Guest" | "Storage" | "HA";

export type ProxmoxAlertTemplateSeverity = "Critical" | "Warning";

export interface ProxmoxAlertTemplateArgs {
  clusterIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface ProxmoxAlertTemplate {
  id: string;
  name: string;
  description: string;
  category: ProxmoxAlertTemplateCategory;
  severity: ProxmoxAlertTemplateSeverity;
  getMonitorStep: (args: ProxmoxAlertTemplateArgs) => MonitorStep;
}

export function buildProxmoxMonitorStep(args: {
  proxmoxMonitor: MonitorStepProxmoxMonitor;
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
    proxmoxMonitor: args.proxmoxMonitor,
  };

  return monitorStep;
}

export function buildProxmoxOfflineCriteriaInstance(args: {
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
    `${args.monitorName} has triggered an alert condition. See root cause for detailed Proxmox cluster information.`;

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

export function buildProxmoxOnlineCriteriaInstance(args: {
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

export function buildProxmoxMonitorConfig(args: {
  clusterIdentifier: string;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string>;
}): MonitorStepProxmoxMonitor {
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
          },
        },
      ],
      formulaConfigs: [],
    },
    rollingTime: args.rollingTime,
  };
}

// --- Template Definitions ---

const nodeOfflineTemplate: ProxmoxAlertTemplate = {
  id: "proxmox-node-offline",
  name: "Node Offline",
  description:
    "Alert when a Proxmox resource reports as down. Add an `id` attribute filter (e.g. node/pve1) to scope to a specific node.",
  category: "Node",
  severity: "Critical",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "pve_up";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "pve_up",
        metricAlias,
        rollingTime: RollingTime.Past1Minute,
        /*
         * Use Min so a single offline resource trips the threshold instead
         * of being masked by resources that are still up.
         */
        aggregationType: MetricsAggregationType.Min,
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 1,
        incidentTitle: `[Proxmox] Node Offline - ${args.monitorName}`,
        incidentDescription: `A Proxmox resource is reporting as down (pve_up = 0). If this monitor is scoped to a node, the node is unreachable or has crashed and its guests may be offline. Check the root cause for the affected resource id. Note: intentionally stopped guests also report pve_up = 0 — add an id attribute filter (e.g. node/pve1) to scope this monitor to nodes only.`,
        criteriaName: "Node Offline - pve_up < 1",
        criteriaDescription:
          "Triggers when any monitored Proxmox resource reports pve_up below 1.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
      }),
    });
  },
};

const guestDownTemplate: ProxmoxAlertTemplate = {
  id: "proxmox-guest-down",
  name: "Guest Down (Zero Uptime)",
  description:
    "Alert when a VM or container's uptime drops to zero, indicating it has stopped or crashed. Add an `id` attribute filter (e.g. qemu/100) to scope to a specific guest.",
  category: "Guest",
  severity: "Critical",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "guest_uptime";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "pve_uptime_seconds",
        metricAlias,
        rollingTime: RollingTime.Past1Minute,
        aggregationType: MetricsAggregationType.Min,
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
        incidentTitle: `[Proxmox] Guest Down - ${args.monitorName}`,
        incidentDescription: `A Proxmox guest (VM or container) has zero uptime, indicating it has stopped or crashed. Check the root cause for the affected guest id. To avoid alerts for intentionally stopped guests, add an id attribute filter (e.g. qemu/100) to scope this monitor to guests that should always be running.`,
        criteriaName: "Guest Down - Uptime = 0",
        criteriaDescription:
          "Triggers when any monitored guest's uptime drops to zero.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    });
  },
};

const nodeHighCpuTemplate: ProxmoxAlertTemplate = {
  id: "proxmox-node-high-cpu",
  name: "High Node CPU Usage",
  description:
    "Alert when CPU usage on a Proxmox node exceeds 90% of available cores sustained.",
  category: "Node",
  severity: "Warning",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "node_cpu";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "pve_cpu_usage_ratio",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Use Max so a single hot node trips the threshold instead of
         * being diluted by idle nodes in the cluster.
         */
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0.9,
        incidentTitle: `[Proxmox] High Node CPU Usage (>90%) - ${args.monitorName}`,
        incidentDescription: `CPU usage in the Proxmox cluster has exceeded 90% of available cores. Sustained high CPU usage on a node degrades performance of every guest running on it. Check the root cause for the affected resource id, then consider migrating guests to another node or adding capacity.`,
        criteriaName: "High CPU - Usage Ratio > 0.9",
        criteriaDescription:
          "Triggers when CPU usage ratio exceeds 0.9 over the monitoring window.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 0.9,
      }),
    });
  },
};

const highMemoryTemplate: ProxmoxAlertTemplate = {
  id: "proxmox-high-memory",
  name: "High Memory Usage",
  description:
    "Alert when memory usage on a node or guest exceeds a byte threshold. Tune the threshold to roughly 90% of your node's RAM.",
  category: "Node",
  severity: "Warning",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "node_memory";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "pve_memory_usage_bytes",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Use Max so the busiest node trips the threshold instead of
         * being diluted by nodes with free memory.
         */
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        // 100 GB default — adjust to ~90% of the node's physical RAM.
        value: 100000000000,
        incidentTitle: `[Proxmox] High Memory Usage - ${args.monitorName}`,
        incidentDescription: `Memory usage in the Proxmox cluster has exceeded the configured threshold. Memory pressure on a node can cause the kernel OOM killer to terminate guests. Check the root cause for the affected resource id. Adjust this monitor's threshold to roughly 90% of your node's physical RAM (pve-exporter reports absolute bytes, not a percentage).`,
        criteriaName: "High Memory - Usage > Threshold",
        criteriaDescription:
          "Triggers when memory usage exceeds the configured byte threshold over the monitoring window.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 100000000000,
      }),
    });
  },
};

const storageNearFullTemplate: ProxmoxAlertTemplate = {
  id: "proxmox-storage-near-full",
  name: "Storage Near Full",
  description:
    "Alert when disk usage on a storage volume exceeds a byte threshold. Tune the threshold to roughly 90% of your storage capacity.",
  category: "Storage",
  severity: "Warning",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "storage_usage";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "pve_disk_usage_bytes",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Use Max so the fullest storage volume trips the threshold
         * instead of being diluted by emptier volumes.
         */
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        // 500 GB default — adjust to ~90% of your storage capacity.
        value: 500000000000,
        incidentTitle: `[Proxmox] Storage Near Full - ${args.monitorName}`,
        incidentDescription: `Disk usage in the Proxmox cluster has exceeded the configured threshold. A full storage volume prevents guests from writing, can pause VMs, and blocks backups and snapshots. Check the root cause for the affected resource id (e.g. storage/pve1/local). Adjust this monitor's threshold to roughly 90% of the volume's capacity, and add an id attribute filter to scope it to a specific storage volume.`,
        criteriaName: "Storage Near Full - Usage > Threshold",
        criteriaDescription:
          "Triggers when disk usage exceeds the configured byte threshold over the monitoring window.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 500000000000,
      }),
    });
  },
};

const haStateDegradedTemplate: ProxmoxAlertTemplate = {
  id: "proxmox-ha-state-degraded",
  name: "HA State Degraded",
  description:
    "Alert when any HA-managed resource enters the error state, meaning high availability could not recover it.",
  category: "HA",
  severity: "Critical",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "ha_error_state";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "pve_ha_state",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
        /*
         * pve_ha_state is an enum-style metric: one series per possible
         * state with value 1 for the current state. Filtering on
         * state="error" makes the series go to 1 only when an HA-managed
         * resource is in the error state.
         */
        attributes: { state: "error" },
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
        incidentTitle: `[Proxmox] HA Resource in Error State - ${args.monitorName}`,
        incidentDescription: `A high-availability managed resource in the Proxmox cluster has entered the error state. The HA manager could not start or recover the resource automatically — manual intervention is required (typically \`ha-manager set <sid> --state disabled\` followed by re-enabling after fixing the underlying issue). Check the root cause for the affected resource id.`,
        criteriaName: "HA Degraded - Error State Present",
        criteriaDescription:
          "Triggers when any HA-managed resource reports the error state.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 1,
      }),
    });
  },
};

const guestHighCpuTemplate: ProxmoxAlertTemplate = {
  id: "proxmox-guest-high-cpu",
  name: "High Guest CPU Usage",
  description:
    "Alert when a VM or container uses more than 90% of its allocated vCPUs sustained. Add an `id` attribute filter (e.g. qemu/100) to scope to a specific guest.",
  category: "Guest",
  severity: "Warning",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "guest_cpu";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "pve_cpu_usage_ratio",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Use Max so a single hot guest trips the threshold instead of
         * being diluted by idle guests in the cluster.
         */
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0.9,
        incidentTitle: `[Proxmox] High Guest CPU Usage (>90%) - ${args.monitorName}`,
        incidentDescription: `A guest (VM or container) is using more than 90% of its allocated vCPUs. The workload inside the guest may be CPU-starved. Check the root cause for the affected guest id, then consider allocating more vCPUs or investigating the workload. Add an id attribute filter (e.g. qemu/100) to scope this monitor to a specific guest.`,
        criteriaName: "High Guest CPU - Usage Ratio > 0.9",
        criteriaDescription:
          "Triggers when any guest's CPU usage ratio exceeds 0.9 over the monitoring window.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 0.9,
      }),
    });
  },
};

export function getAllProxmoxAlertTemplates(): Array<ProxmoxAlertTemplate> {
  return [
    nodeOfflineTemplate,
    guestDownTemplate,
    nodeHighCpuTemplate,
    highMemoryTemplate,
    storageNearFullTemplate,
    haStateDegradedTemplate,
    guestHighCpuTemplate,
  ];
}

export function getProxmoxAlertTemplatesByCategory(
  category: ProxmoxAlertTemplateCategory,
): Array<ProxmoxAlertTemplate> {
  return getAllProxmoxAlertTemplates().filter(
    (template: ProxmoxAlertTemplate) => {
      return template.category === category;
    },
  );
}

export function getProxmoxAlertTemplateById(
  id: string,
): ProxmoxAlertTemplate | undefined {
  return getAllProxmoxAlertTemplates().find(
    (template: ProxmoxAlertTemplate) => {
      return template.id === id;
    },
  );
}
