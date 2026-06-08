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

/**
 * Build a per-series ratio monitor: `(numerator / denominator) * 100`,
 * grouped by a single OpenTelemetry attribute so one incident fires per
 * group (e.g. per node).
 *
 * Used for saturation metrics that aren't emitted as a single ready-made
 * series — e.g. node request utilization (summed pod requests ÷ node
 * allocatable) and node usage utilization (node usage ÷ node allocatable),
 * neither of which the kubeletstats receiver exposes as a percentage.
 *
 * Aggregation (`aggregationType`, default `Sum`) — the per-series worker
 * buckets raw rows by (group, minute) and applies this aggregation to
 * EVERY row in the bucket, i.e. across both the grouped entities AND the
 * scrapes in that minute. Pick it based on the numerator:
 *
 *   - `Sum` when the numerator must be totalled across multiple series per
 *     group (e.g. summing every container's request on a node). The scrape
 *     multiple then has to cancel, so numerator and denominator must ride
 *     the SAME receiver/scrape — true for the request-utilization
 *     templates, where both metrics come from `k8s_cluster`:
 *     `(Σrequests × scrapes) / (allocatable × scrapes)`.
 *
 *   - `Avg` when the numerator is already ONE series per group (e.g.
 *     `k8s.node.cpu.usage`). Avg yields the representative per-minute value
 *     independent of scrape count, so it stays correct even when numerator
 *     and denominator come from DIFFERENT receivers on independent scrape
 *     cycles (node usage is from the kubeletstats DaemonSet; allocatable is
 *     from the `k8s_cluster` Deployment). `Sum` there would only cancel if
 *     both reported the same row count every minute — fragile across
 *     restarts / missed scrapes / minute-boundary jitter.
 *
 * The group-by key is the ClickHouse-stored attribute name, which carries
 * the `resource.` prefix for OTel resource attributes (see
 * OtelMetricsIngestService — resource attributes are stamped with
 * `prefixKeysWithString: "resource"`). So node grouping is
 * `resource.k8s.node.name`, not the bare `k8s.node.name`.
 */
export function buildKubernetesRatioMonitorConfig(args: {
  clusterIdentifier: string;
  numeratorMetricName: string;
  denominatorMetricName: string;
  groupByAttributeKey: string;
  numeratorAlias: string;
  denominatorAlias: string;
  resultAlias: string;
  resultLegend: string;
  resourceScope: KubernetesResourceScope;
  rollingTime: RollingTime;
  aggregationType?: MetricsAggregationType | undefined;
}): MonitorStepKubernetesMonitor {
  const aggregationType: MetricsAggregationType =
    args.aggregationType || MetricsAggregationType.Sum;

  const buildQueryConfig: (alias: string, metricName: string) => any = (
    alias: string,
    metricName: string,
  ): any => {
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
          metricName: metricName,
          attributes: {},
          aggegationType: aggregationType,
          aggregateBy: {},
        },
        groupByAttributeKeys: [args.groupByAttributeKey],
      },
    };
  };

  return {
    clusterIdentifier: args.clusterIdentifier,
    resourceScope: args.resourceScope,
    resourceFilters: {},
    metricViewConfig: {
      queryConfigs: [
        buildQueryConfig(args.numeratorAlias, args.numeratorMetricName),
        buildQueryConfig(args.denominatorAlias, args.denominatorMetricName),
      ],
      formulaConfigs: [
        {
          metricAliasData: {
            metricVariable: args.resultAlias,
            title: args.resultLegend,
            description: args.resultLegend,
            legend: args.resultLegend,
            legendUnit: "%",
          },
          metricFormulaData: {
            metricFormula: `(${args.numeratorAlias} / ${args.denominatorAlias}) * 100`,
          },
        },
      ],
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
        attributes: { "resource.k8s.pod.phase": "Pending" },
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
  description:
    "Alert when a node's average CPU usage exceeds 90% of its allocatable CPU. Computed per node as k8s.node.cpu.usage ÷ k8s.node.allocatable_cpu × 100 — both are cores, so this is a true percentage (the raw k8s.node.cpu.utilization metric is a misnamed cores gauge, not a percent).",
  category: "Node",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "node_cpu_utilization";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesRatioMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        numeratorMetricName: "k8s.node.cpu.usage",
        denominatorMetricName: "k8s.node.allocatable_cpu",
        groupByAttributeKey: "resource.k8s.node.name",
        numeratorAlias: "used_cpu",
        denominatorAlias: "alloc_cpu",
        resultAlias: metricAlias,
        resultLegend: "Node CPU Utilization (%)",
        resourceScope: KubernetesResourceScope.Node,
        rollingTime: RollingTime.Past5Minutes,
        // Single series per node from two DIFFERENT receivers (usage =
        // kubeletstats, allocatable = k8s_cluster) — Avg keeps the per-minute
        // ratio correct regardless of each receiver's scrape count. See
        // buildKubernetesRatioMonitorConfig.
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
        incidentDescription: `A node's average CPU usage has exceeded 90% of its allocatable CPU. Sustained high CPU usage can cause pod throttling, increased latency, and potential node instability. Check the root cause for the specific node and top CPU-consuming workloads.`,
        criteriaName: "High CPU - Utilization > 90%",
        criteriaDescription:
          "Triggers when a node's average CPU usage exceeds 90% of its allocatable CPU over the monitoring window.",
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
  description:
    "Alert when a node's average memory usage exceeds 85% of its allocatable memory. Computed per node as k8s.node.memory.usage ÷ k8s.node.allocatable_memory × 100 — both are bytes, so this is a true percentage (the raw k8s.node.memory.usage metric is bytes, not a percent).",
  category: "Node",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "node_memory_utilization";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesRatioMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        numeratorMetricName: "k8s.node.memory.usage",
        denominatorMetricName: "k8s.node.allocatable_memory",
        groupByAttributeKey: "resource.k8s.node.name",
        numeratorAlias: "used_mem",
        denominatorAlias: "alloc_mem",
        resultAlias: metricAlias,
        resultLegend: "Node Memory Utilization (%)",
        resourceScope: KubernetesResourceScope.Node,
        rollingTime: RollingTime.Past5Minutes,
        // Single series per node from two DIFFERENT receivers (usage =
        // kubeletstats, allocatable = k8s_cluster) — Avg keeps the per-minute
        // ratio correct regardless of each receiver's scrape count. See
        // buildKubernetesRatioMonitorConfig.
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
        incidentDescription: `A node's average memory usage has exceeded 85% of its allocatable memory. High memory usage can lead to OOMKilled pods, node instability, and potential evictions. Check the root cause for the specific node and top memory-consuming workloads.`,
        criteriaName: "High Memory - Utilization > 85%",
        criteriaDescription:
          "Triggers when a node's average memory usage exceeds 85% of its allocatable memory over the monitoring window.",
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

const nodeCpuRequestUtilizationTemplate: KubernetesAlertTemplate = {
  id: "k8s-node-cpu-request-utilization",
  name: "High Node CPU Request Commitment",
  description:
    "Alert when a node's committed CPU requests exceed 90% of its allocatable CPU. Derived per node from summed container CPU requests over node allocatable CPU — both collected by default via the k8s_cluster receiver. A near-full node can't schedule new pods even if actual CPU usage is low.",
  category: "Node",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "node_cpu_request_utilization";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesRatioMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        numeratorMetricName: "k8s.container.cpu_request",
        denominatorMetricName: "k8s.node.allocatable_cpu",
        groupByAttributeKey: "resource.k8s.node.name",
        numeratorAlias: "req_cpu",
        denominatorAlias: "alloc_cpu",
        resultAlias: metricAlias,
        resultLegend: "Node CPU Request Utilization (%)",
        resourceScope: KubernetesResourceScope.Node,
        rollingTime: RollingTime.Past5Minutes,
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 90,
        incidentTitle: `[K8s] High Node CPU Request Commitment (>90%) - ${args.monitorName}`,
        incidentDescription: `A node's committed CPU requests have exceeded 90% of its allocatable CPU. The node is nearly full from a scheduling standpoint and may be unable to place new pods, even if current CPU usage is low. Check the root cause for the specific node and its top CPU-requesting workloads.`,
        criteriaName: "High CPU Request Commitment - Utilization > 90%",
        criteriaDescription:
          "Triggers when any node's summed container CPU requests exceed 90% of its allocatable CPU.",
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

const nodeMemoryRequestUtilizationTemplate: KubernetesAlertTemplate = {
  id: "k8s-node-memory-request-utilization",
  name: "High Node Memory Request Commitment",
  description:
    "Alert when a node's committed memory requests exceed 90% of its allocatable memory. Derived per node from summed container memory requests over node allocatable memory — both collected by default via the k8s_cluster receiver. A near-full node can't schedule new pods even if actual memory usage is low.",
  category: "Node",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "node_memory_request_utilization";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesRatioMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        numeratorMetricName: "k8s.container.memory_request",
        denominatorMetricName: "k8s.node.allocatable_memory",
        groupByAttributeKey: "resource.k8s.node.name",
        numeratorAlias: "req_mem",
        denominatorAlias: "alloc_mem",
        resultAlias: metricAlias,
        resultLegend: "Node Memory Request Utilization (%)",
        resourceScope: KubernetesResourceScope.Node,
        rollingTime: RollingTime.Past5Minutes,
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 90,
        incidentTitle: `[K8s] High Node Memory Request Commitment (>90%) - ${args.monitorName}`,
        incidentDescription: `A node's committed memory requests have exceeded 90% of its allocatable memory. The node is nearly full from a scheduling standpoint and may be unable to place new pods, even if current memory usage is low. Check the root cause for the specific node and its top memory-requesting workloads.`,
        criteriaName: "High Memory Request Commitment - Utilization > 90%",
        criteriaDescription:
          "Triggers when any node's summed container memory requests exceed 90% of its allocatable memory.",
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
    nodeCpuRequestUtilizationTemplate,
    nodeMemoryRequestUtilizationTemplate,
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
