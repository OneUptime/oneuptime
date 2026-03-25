import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import FilterCondition from "../Filter/FilterCondition";
import { CheckOn, FilterType, EvaluateOverTimeType } from "./CriteriaFilter";
import MonitorStepKubernetesMonitor, {
  KubernetesResourceScope,
} from "./MonitorStepKubernetesMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type KubernetesAlertTemplateCategory =
  | "Workload"
  | "Node"
  | "ControlPlane"
  | "Storage"
  | "Scheduling";

export type KubernetesAlertTemplateSeverity = "Critical" | "Warning";

export interface KubernetesAlertTemplateArgs {
  clusterIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface KubernetesAlertTemplate {
  id: string;
  name: string;
  description: string;
  category: KubernetesAlertTemplateCategory;
  severity: KubernetesAlertTemplateSeverity;
  getMonitorStep: (args: KubernetesAlertTemplateArgs) => MonitorStep;
}

export function buildKubernetesMonitorStep(args: {
  kubernetesMonitor: MonitorStepKubernetesMonitor;
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
    kubernetesMonitor: args.kubernetesMonitor,
  };

  return monitorStep;
}

export function buildOfflineCriteriaInstance(args: {
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
    `${args.monitorName} has triggered an alert condition. See root cause for detailed Kubernetes resource information.`;

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

export function buildOnlineCriteriaInstance(args: {
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

export function buildKubernetesMonitorConfig(args: {
  clusterIdentifier: string;
  metricName: string;
  metricAlias: string;
  resourceScope: KubernetesResourceScope;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string>;
}): MonitorStepKubernetesMonitor {
  return {
    clusterIdentifier: args.clusterIdentifier,
    resourceScope: args.resourceScope,
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

const crashLoopBackOffTemplate: KubernetesAlertTemplate = {
  id: "k8s-crashloopbackoff",
  name: "CrashLoopBackOff Detection",
  description:
    "Alert when container restart count exceeds threshold, indicating a CrashLoopBackOff condition.",
  category: "Workload",
  severity: "Critical",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "container_restarts";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "k8s.container.restarts",
        metricAlias,
        resourceScope: KubernetesResourceScope.Cluster,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 5,
        incidentTitle: `[K8s] CrashLoopBackOff Detected - ${args.monitorName}`,
        incidentDescription: `A container in the Kubernetes cluster is repeatedly crashing and restarting (CrashLoopBackOff). The container restart count has exceeded the threshold of 5 restarts. Check the root cause for the specific pod, container, and node details.`,
        criteriaName: "CrashLoopBackOff - Container Restarts > 5",
        criteriaDescription:
          "Triggers when any container restart count exceeds 5 in the monitoring window, indicating a CrashLoopBackOff condition.",
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 5,
      }),
    });
  },
};

const podPendingTemplate: KubernetesAlertTemplate = {
  id: "k8s-pod-pending",
  name: "Pod Stuck in Pending",
  description:
    "Alert when pods remain in Pending phase, indicating scheduling or resource issues.",
  category: "Scheduling",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "pending_pods";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "k8s.pod.phase",
        metricAlias,
        resourceScope: KubernetesResourceScope.Cluster,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Sum,
        attributes: { "k8s.pod.phase": "Pending" },
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[K8s] Pods Stuck in Pending - ${args.monitorName}`,
        incidentDescription: `One or more pods in the Kubernetes cluster are stuck in Pending phase and cannot be scheduled. This typically indicates insufficient cluster resources, node affinity constraints, or unbound PersistentVolumeClaims. Check the root cause for specific pod and scheduling details.`,
        criteriaName: "Pods Pending - Count > 0",
        criteriaDescription:
          "Triggers when any pods are in Pending phase, unable to be scheduled.",
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    });
  },
};

const nodeNotReadyTemplate: KubernetesAlertTemplate = {
  id: "k8s-node-not-ready",
  name: "Node Not Ready",
  description:
    "Alert when a node condition transitions to NotReady, indicating node health issues.",
  category: "Node",
  severity: "Critical",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "node_ready";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "k8s.node.condition_ready",
        metricAlias,
        resourceScope: KubernetesResourceScope.Node,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Min,
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
        incidentTitle: `[K8s] Node Not Ready - ${args.monitorName}`,
        incidentDescription: `A Kubernetes node has transitioned to NotReady state. This is a critical condition that affects all pods scheduled on this node. Check the root cause for the specific node name, conditions, and recommended actions.`,
        criteriaName: "Node NotReady - Condition = 0",
        criteriaDescription:
          "Triggers when any node reports a NotReady condition (value 0).",
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    });
  },
};

const highCpuTemplate: KubernetesAlertTemplate = {
  id: "k8s-high-cpu",
  name: "High Node CPU Utilization",
  description: "Alert when node CPU utilization exceeds 90% sustained.",
  category: "Node",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "node_cpu";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "k8s.node.cpu.utilization",
        metricAlias,
        resourceScope: KubernetesResourceScope.Node,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Avg,
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 90,
        incidentTitle: `[K8s] High CPU Utilization (>90%) - ${args.monitorName}`,
        incidentDescription: `Node CPU utilization has exceeded 90% in the Kubernetes cluster. Sustained high CPU usage can cause pod throttling, increased latency, and potential node instability. Check the root cause for the specific node and top CPU-consuming workloads.`,
        criteriaName: "High CPU - Utilization > 90%",
        criteriaDescription:
          "Triggers when average node CPU utilization exceeds 90% over the monitoring window.",
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 90,
      }),
    });
  },
};

const highMemoryTemplate: KubernetesAlertTemplate = {
  id: "k8s-high-memory",
  name: "High Node Memory Utilization",
  description: "Alert when node memory utilization exceeds 85% sustained.",
  category: "Node",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "node_memory";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "k8s.node.memory.usage",
        metricAlias,
        resourceScope: KubernetesResourceScope.Node,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Avg,
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 85,
        incidentTitle: `[K8s] High Memory Utilization (>85%) - ${args.monitorName}`,
        incidentDescription: `Node memory utilization has exceeded 85% in the Kubernetes cluster. High memory usage can lead to OOMKilled pods, node instability, and potential evictions. Check the root cause for the specific node and top memory-consuming workloads.`,
        criteriaName: "High Memory - Utilization > 85%",
        criteriaDescription:
          "Triggers when average node memory utilization exceeds 85% over the monitoring window.",
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 85,
      }),
    });
  },
};

const deploymentReplicaMismatchTemplate: KubernetesAlertTemplate = {
  id: "k8s-deployment-replica-mismatch",
  name: "Deployment Replica Mismatch",
  description:
    "Alert when available replicas are less than desired replicas for a deployment.",
  category: "Workload",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "unavailable_replicas";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "k8s.deployment.unavailable_replicas",
        metricAlias,
        resourceScope: KubernetesResourceScope.Workload,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[K8s] Deployment Replica Mismatch - ${args.monitorName}`,
        incidentDescription: `A Kubernetes deployment has unavailable replicas — the desired replica count does not match the available count. This may indicate a failed rollout, image pull errors, insufficient resources, or pod crash loops. Check the root cause for the specific deployment and replica details.`,
        criteriaName: "Replica Mismatch - Unavailable > 0",
        criteriaDescription:
          "Triggers when any deployment has unavailable replicas.",
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    });
  },
};

const jobFailuresTemplate: KubernetesAlertTemplate = {
  id: "k8s-job-failures",
  name: "Job Failures",
  description: "Alert when Kubernetes jobs fail.",
  category: "Workload",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "failed_pods";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "k8s.job.failed_pods",
        metricAlias,
        resourceScope: KubernetesResourceScope.Workload,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[K8s] Job Failure Detected - ${args.monitorName}`,
        incidentDescription: `A Kubernetes Job has one or more failed pods. This indicates the job's workload is failing to complete successfully. Check the root cause for the specific job name, failed pod details, and error information.`,
        criteriaName: "Job Failures - Failed Pods > 0",
        criteriaDescription:
          "Triggers when any Kubernetes Job has failed pods.",
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    });
  },
};

const etcdNoLeaderTemplate: KubernetesAlertTemplate = {
  id: "k8s-etcd-no-leader",
  name: "etcd No Leader",
  description:
    "Alert immediately when etcd has no leader elected. This is a critical cluster health issue.",
  category: "ControlPlane",
  severity: "Critical",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "etcd_has_leader";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "etcd_server_has_leader",
        metricAlias,
        resourceScope: KubernetesResourceScope.Cluster,
        rollingTime: RollingTime.Past1Minute,
        aggregationType: MetricsAggregationType.Min,
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
        incidentTitle: `[K8s] CRITICAL: etcd No Leader - ${args.monitorName}`,
        incidentDescription: `The etcd cluster has no elected leader. This is a critical cluster health issue that can cause the Kubernetes API server to become unavailable. All cluster operations (scheduling, deployments, service discovery) will be affected.`,
        criteriaName: "etcd No Leader - Has Leader = 0",
        criteriaDescription:
          "Triggers immediately when etcd reports no elected leader.",
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    });
  },
};

const apiServerThrottlingTemplate: KubernetesAlertTemplate = {
  id: "k8s-apiserver-throttling",
  name: "API Server Throttling",
  description:
    "Alert when the Kubernetes API server is dropping requests due to throttling.",
  category: "ControlPlane",
  severity: "Critical",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "dropped_requests";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "apiserver_dropped_requests_total",
        metricAlias,
        resourceScope: KubernetesResourceScope.Cluster,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Sum,
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[K8s] CRITICAL: API Server Throttling - ${args.monitorName}`,
        incidentDescription: `The Kubernetes API server is dropping requests due to throttling. This indicates the API server is overloaded and cannot process all incoming requests, affecting cluster operations.`,
        criteriaName: "API Server Throttling - Dropped Requests > 0",
        criteriaDescription:
          "Triggers when the API server reports any dropped requests.",
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    });
  },
};

const schedulerBacklogTemplate: KubernetesAlertTemplate = {
  id: "k8s-scheduler-backlog",
  name: "Scheduler Backlog",
  description:
    "Alert when there are pods waiting to be scheduled for more than 5 minutes.",
  category: "Scheduling",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "pending_pods";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "scheduler_pending_pods",
        metricAlias,
        resourceScope: KubernetesResourceScope.Cluster,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Avg,
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[K8s] Scheduler Backlog - ${args.monitorName}`,
        incidentDescription: `The Kubernetes scheduler has a backlog of pods waiting to be scheduled. This indicates the scheduler is unable to find suitable nodes for pending pods, possibly due to resource constraints or scheduling conflicts.`,
        criteriaName: "Scheduler Backlog - Pending Pods > 0",
        criteriaDescription:
          "Triggers when there are pods waiting to be scheduled for more than 5 minutes.",
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    });
  },
};

const highDiskUsageTemplate: KubernetesAlertTemplate = {
  id: "k8s-high-disk-usage",
  name: "High Node Disk Usage",
  description: "Alert when node filesystem usage exceeds 90% capacity.",
  category: "Storage",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "disk_usage";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "k8s.node.filesystem.usage",
        metricAlias,
        resourceScope: KubernetesResourceScope.Node,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Avg,
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 90,
        incidentTitle: `[K8s] High Disk Usage (>90%) - ${args.monitorName}`,
        incidentDescription: `Node disk/filesystem usage has exceeded 90% capacity. High disk usage can lead to pod evictions, inability to pull new container images, and node instability. Check the root cause for the specific node and disk usage details.`,
        criteriaName: "High Disk - Usage > 90%",
        criteriaDescription:
          "Triggers when average node filesystem usage exceeds 90% capacity.",
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 90,
      }),
    });
  },
};

const daemonSetUnavailableTemplate: KubernetesAlertTemplate = {
  id: "k8s-daemonset-unavailable",
  name: "DaemonSet Unavailable Nodes",
  description:
    "Alert when a DaemonSet has unavailable nodes where the daemon pod should be running.",
  category: "Workload",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "unavailable_nodes";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "k8s.daemonset.misscheduled_nodes",
        metricAlias,
        resourceScope: KubernetesResourceScope.Workload,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[K8s] DaemonSet Unavailable Nodes - ${args.monitorName}`,
        incidentDescription: `A DaemonSet has nodes where the daemon pod is not running as expected. This indicates misscheduled or unavailable daemon pods, which may affect cluster-wide services like logging, monitoring, or networking.`,
        criteriaName: "DaemonSet Unavailable - Misscheduled > 0",
        criteriaDescription:
          "Triggers when a DaemonSet has nodes where daemon pods are not properly scheduled.",
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    });
  },
};

export function getAllKubernetesAlertTemplates(): Array<KubernetesAlertTemplate> {
  return [
    crashLoopBackOffTemplate,
    podPendingTemplate,
    nodeNotReadyTemplate,
    highCpuTemplate,
    highMemoryTemplate,
    deploymentReplicaMismatchTemplate,
    jobFailuresTemplate,
    etcdNoLeaderTemplate,
    apiServerThrottlingTemplate,
    schedulerBacklogTemplate,
    highDiskUsageTemplate,
    daemonSetUnavailableTemplate,
  ];
}

export function getKubernetesAlertTemplatesByCategory(
  category: KubernetesAlertTemplateCategory,
): Array<KubernetesAlertTemplate> {
  return getAllKubernetesAlertTemplates().filter(
    (template: KubernetesAlertTemplate) => {
      return template.category === category;
    },
  );
}

export function getKubernetesAlertTemplateById(
  id: string,
): KubernetesAlertTemplate | undefined {
  return getAllKubernetesAlertTemplates().find(
    (template: KubernetesAlertTemplate) => {
      return template.id === id;
    },
  );
}
