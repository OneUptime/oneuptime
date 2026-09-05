import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
} from "./Recommendation/RecommendationCriteriaBuilder";
import { FilterType, EvaluateOverTimeType } from "./CriteriaFilter";
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
  metricAggregationType?: EvaluateOverTimeType | undefined;
}): MonitorCriteriaInstance {
  return buildUnhealthyCriteriaInstance({
    ...args,
    resourceNoun: "Kubernetes resource",
  });
}

export function buildOnlineCriteriaInstance(args: {
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

/**
 * Build a single-query monitor config.
 *
 * `groupByAttributeKeys` makes the monitor PER-SERIES: the worker splits
 * the metric by those attributes and every group is evaluated — and paged —
 * on its own, so a cluster of 200 pods raises one incident per unhealthy
 * pod rather than one incident for the whole cluster that then dedupes
 * every later pod away. Omitting it keeps the monitor whole-cluster.
 *
 * Group by an object's own name whenever the metric is genuinely
 * PER-OBJECT (per node, per pod, per deployment, ...). Leave it off for
 * cluster-scalar signals — etcd leadership, API server throttling,
 * scheduler backlog — where there is exactly one value for the cluster
 * and splitting it would invent series that do not exist.
 *
 * Pass MORE than one key when the object's identity genuinely needs
 * them, and the group-by set is what the alert can name afterwards. A
 * bare pod name is not an identity — pod names are unique only within a
 * namespace — and, more practically, an alert that says
 * "Pod: checkout-7d9f-2xk" without the namespace sends the engineer to
 * `kubectl` with a guess. The series labels are stored on the alert and
 * rendered into its title and description (SeriesLabelDisplay), so every
 * key added here is one more thing the on-call engineer does not have to
 * go and look up.
 *
 * The keys are the ClickHouse-stored attribute names, which carry the
 * `resource.` prefix for OTel resource attributes (see
 * OtelMetricsIngestService — resource attributes are stamped with
 * `prefixKeysWithString: "resource"`). So node grouping is
 * `resource.k8s.node.name`, not the bare `k8s.node.name`; the bare key
 * matches nothing and collapses the whole fleet into one mislabeled
 * series that still renders and still alerts.
 */
export function buildKubernetesMonitorConfig(args: {
  clusterIdentifier: string;
  metricName: string;
  metricAlias: string;
  resourceScope: KubernetesResourceScope;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string>;
  groupByAttributeKeys?: Array<string> | undefined;
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

/**
 * Build a per-series ratio monitor: `(numerator / denominator) * 100`,
 * grouped by one or more OpenTelemetry attributes so one incident fires
 * per group (e.g. per node, or per namespace+pod).
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
 * The group-by keys are the ClickHouse-stored attribute names, which
 * carry the `resource.` prefix for OTel resource attributes (see
 * OtelMetricsIngestService — resource attributes are stamped with
 * `prefixKeysWithString: "resource"`). So node grouping is
 * `resource.k8s.node.name`, not the bare `k8s.node.name`.
 *
 * CHOOSING THE KEYS IS NOT FREE HERE, and the constraint is different
 * from the single-query builder. The two queries are joined by series
 * FINGERPRINT — `buildSeriesBreakdown` buckets each query's rows by the
 * hash of this exact key set — so a key that only ONE side carries
 * splits the two into fingerprints that never meet, the formula
 * evaluates against an empty operand, and the monitor silently stops
 * alerting. Not "alerts less precisely": stops. So only add a key both
 * metrics are GUARANTEED to carry, from their receivers themselves
 * rather than from best-effort enrichment:
 *
 *   - `k8s.namespace.name` is safe for pod/container/workload ratios:
 *     kubeletstats stamps it on pod metrics and the k8s_cluster receiver
 *     stamps it on container and workload metrics, both directly.
 *
 *   - `k8s.node.name` is NOT safe on a pod ratio whose denominator is a
 *     k8s_cluster metric. kubeletstats always has it (the receiver, plus
 *     the DaemonSet's `resource` processor stamping NODE_NAME); on the
 *     k8s_cluster side it can only arrive via the k8sattributes
 *     processor, which is best-effort and depends on pod association
 *     still resolving. A single-query template over a kubeletstats
 *     metric has no join to break and may group by it freely.
 */
export function buildKubernetesRatioMonitorConfig(args: {
  clusterIdentifier: string;
  numeratorMetricName: string;
  denominatorMetricName: string;
  groupByAttributeKeys: Array<string>;
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
        groupByAttributeKeys: args.groupByAttributeKeys,
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
        /*
         * Per pod: restarts are a property of one pod's containers, so a
         * crash-looping pod must page on its own rather than dedupe behind
         * whichever pod in the cluster crashed first. Max over the window
         * therefore becomes "the worst container in THIS pod".
         */
        groupByAttributeKeys: [
          "resource.k8s.namespace.name",
          "resource.k8s.pod.name",
          "resource.k8s.container.name",
        ],
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
        /*
         * Deliberately NOT grouped, unlike the other pod-level templates.
         *
         * This is a cluster-wide COUNT of unschedulable pods (Cluster
         * scope, Sum, "Count > 0"), i.e. a statement about the cluster's
         * scheduling capacity rather than about any one pod's health — the
         * same signal as k8s-scheduler-backlog, seen from the pod side.
         *
         * Grouping it by `resource.k8s.pod.name` would fan out per pod
         * name, and pending pod names are ephemeral: a stuck rollout burns
         * a new replicaset-hash-suffixed name per attempt, so every retry
         * would open a fresh incident and resolve it again the moment the
         * name changed. That is an alert storm keyed on an identity that
         * does not persist, which is the opposite of what per-series
         * grouping is for (durable entities: nodes, deployments, jobs).
         */
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
        /*
         * Per node: one incident per NotReady node. Ungrouped, the Min
         * across the fleet is 0 as soon as ANY node is down, and the
         * second node to fail dedupes behind the first one's incident.
         */
        groupByAttributeKeys: ["resource.k8s.node.name"],
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
        groupByAttributeKeys: ["resource.k8s.node.name"],
        numeratorAlias: "used_cpu",
        denominatorAlias: "alloc_cpu",
        resultAlias: metricAlias,
        resultLegend: "Node CPU Utilization (%)",
        resourceScope: KubernetesResourceScope.Node,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Single series per node from two DIFFERENT receivers (usage =
         * kubeletstats, allocatable = k8s_cluster) — Avg keeps the per-minute
         * ratio correct regardless of each receiver's scrape count. See
         * buildKubernetesRatioMonitorConfig.
         */
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
        groupByAttributeKeys: ["resource.k8s.node.name"],
        numeratorAlias: "used_mem",
        denominatorAlias: "alloc_mem",
        resultAlias: metricAlias,
        resultLegend: "Node Memory Utilization (%)",
        resourceScope: KubernetesResourceScope.Node,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Single series per node from two DIFFERENT receivers (usage =
         * kubeletstats, allocatable = k8s_cluster) — Avg keeps the per-minute
         * ratio correct regardless of each receiver's scrape count. See
         * buildKubernetesRatioMonitorConfig.
         */
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
        /*
         * Per deployment: a stuck rollout is a property of one Deployment
         * object, and the incident copy already names the deployment. The
         * k8s_cluster receiver stamps `k8s.deployment.name` on this metric
         * (the worker reads `resource.k8s.deployment.name` back off these
         * rows to build the affected-resource breakdown).
         */
        groupByAttributeKeys: [
          "resource.k8s.namespace.name",
          "resource.k8s.deployment.name",
        ],
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
        /*
         * Per Job object — one failing Job must not hide the next one.
         * Jobs are short-lived: when a Job is cleaned up its series stops
         * arriving and the per-series pass auto-resolves that Job's alert
         * by absence, which is the behaviour we want here.
         */
        groupByAttributeKeys: [
          "resource.k8s.namespace.name",
          "resource.k8s.job.name",
        ],
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
        /*
         * Ungrouped: leadership is a property of the etcd cluster as a
         * whole, not of any one object. "No leader" is one cluster-scalar
         * fact and belongs in one incident.
         */
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
        /*
         * Ungrouped: this is the control plane's aggregate throttling
         * rate. Splitting it would need a per-apiserver-instance identity
         * that this metric does not carry in the shipped agent config.
         */
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
        /*
         * Ungrouped: a scheduler queue depth is one number for the
         * cluster. There is no per-object series to split it into.
         */
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
        /*
         * Per node: filesystem usage is per node (kubeletstats reports the
         * node's filesystem), and disk fills one node at a time. Ungrouped,
         * the Avg across the fleet dilutes a single full node into the
         * fleet mean and the alert never fires.
         */
        groupByAttributeKeys: ["resource.k8s.node.name"],
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
        /*
         * Per DaemonSet object: the incident names the DaemonSet, so each
         * one has to own its own alert instead of dedupeing behind
         * whichever DaemonSet in the cluster misscheduled first.
         */
        groupByAttributeKeys: [
          "resource.k8s.namespace.name",
          "resource.k8s.daemonset.name",
        ],
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
        groupByAttributeKeys: ["resource.k8s.node.name"],
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
        groupByAttributeKeys: ["resource.k8s.node.name"],
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

/*
 * --- Autoscaling / limit-saturation templates ---
 *
 * These three close the detection gap for the classic "under-resourced
 * workload behind an autoscaler" failure: limits are set too low, so the
 * containers sit pinned against them (OOMKilled on memory, CFS-throttled
 * on CPU), the resulting latency/restarts drive the HPA up, and the HPA
 * fills the cluster until nodes go NotReady.
 *
 * The node-side templates above catch the END of that chain (high node
 * CPU/memory, NotReady, pending pods) — by which point the RCA is several
 * hops from the cause. These catch the START: the HPA running out of
 * headroom, and the containers pinned at their own limits.
 *
 * All three are per-series ratios, grouped by the ClickHouse-stored
 * `resource.`-prefixed attribute (see buildKubernetesRatioMonitorConfig).
 */

const hpaAtMaxReplicasTemplate: KubernetesAlertTemplate = {
  id: "k8s-hpa-at-max-replicas",
  name: "HPA Saturated at Max Replicas",
  description:
    "Alert when a HorizontalPodAutoscaler is running at 90% or more of its maxReplicas. Computed per HPA as k8s.hpa.current_replicas ÷ k8s.hpa.max_replicas × 100. An HPA at its ceiling has no headroom left: load it cannot absorb by scaling turns straight into latency and errors, and a workload that reaches the ceiling and stays there is usually under-resourced per pod rather than genuinely at capacity.",
  category: "Workload",
  severity: "Critical",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "hpa_replica_saturation";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesRatioMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        numeratorMetricName: "k8s.hpa.current_replicas",
        denominatorMetricName: "k8s.hpa.max_replicas",
        groupByAttributeKeys: [
          "resource.k8s.namespace.name",
          "resource.k8s.hpa.name",
        ],
        numeratorAlias: "current_replicas",
        denominatorAlias: "max_replicas",
        resultAlias: metricAlias,
        resultLegend: "HPA Replica Saturation (%)",
        resourceScope: KubernetesResourceScope.Workload,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * ONE series per HPA on both sides (they are the same object's
         * status/spec fields), so Avg gives the representative per-minute
         * ratio independent of scrape count. Both come from the same
         * k8s_cluster scrape, so Sum would also cancel — but Avg stays
         * correct across restarts and missed scrapes. See
         * buildKubernetesRatioMonitorConfig.
         */
        aggregationType: MetricsAggregationType.Avg,
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 90,
        incidentTitle: `[K8s] HPA Saturated at Max Replicas (>=90%) - ${args.monitorName}`,
        incidentDescription: `A HorizontalPodAutoscaler is running at 90% or more of its maxReplicas and has effectively no scaling headroom left. Any further load cannot be absorbed by scaling out, so it will surface as latency and errors instead. Check whether the workload is genuinely at capacity or whether its per-pod CPU/memory limits are set too low — an under-resourced pod gets throttled or OOMKilled, which inflates the metric the HPA scales on and drives it to the ceiling. Check the root cause for the specific HPA, its target workload, and current vs max replicas.`,
        criteriaName: "HPA Saturation - Current/Max Replicas >= 90%",
        criteriaDescription:
          "Triggers when any HPA's current replica count reaches 90% or more of its configured maxReplicas.",
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 90,
      }),
    });
  },
};

const podMemoryLimitSaturationTemplate: KubernetesAlertTemplate = {
  id: "k8s-pod-memory-limit-saturation",
  name: "Pod Memory Saturating Container Limit",
  description:
    "Alert when a pod's memory usage exceeds 90% of its configured container memory limit — the state immediately preceding an OOMKill. Computed per pod as k8s.pod.memory.usage ÷ k8s.container.memory_limit × 100 (both bytes). This is the cause-side signal for CrashLoopBackOff and restart storms: a limit set too low shows up here minutes before the container is killed.",
  category: "Workload",
  severity: "Critical",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "pod_memory_limit_saturation";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesRatioMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        numeratorMetricName: "k8s.pod.memory.usage",
        denominatorMetricName: "k8s.container.memory_limit",
        groupByAttributeKeys: [
          "resource.k8s.namespace.name",
          "resource.k8s.pod.name",
        ],
        numeratorAlias: "used_mem",
        denominatorAlias: "limit_mem",
        resultAlias: metricAlias,
        resultLegend: "Pod Memory vs Limit (%)",
        resourceScope: KubernetesResourceScope.Pod,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Avg, deliberately — and the one case in this file where the two
         * sides have different series shapes, so the trade-off is worth
         * stating.
         *
         * Numerator (k8s.pod.memory.usage, kubeletstats) is ONE series per
         * pod. Denominator (k8s.container.memory_limit, k8s_cluster) is one
         * series per CONTAINER, so a multi-container pod contributes
         * several.
         *
         * Sum is definitively wrong here: the two metrics ride different
         * receivers on independent scrape cycles, so the scrape multiple
         * would not cancel. Avg is exact for single-container pods (the
         * overwhelming majority, and the case this template exists for).
         *
         * For multi-container pods Avg takes the MEAN container limit
         * rather than their sum, so the ratio over-reports and the alert
         * fires early. That is the safe direction for an "OOMKill is
         * imminent" warning — a false early page beats a missed kill — but
         * it is a real caveat, not a rounding detail. A per-container
         * variant needs a container-scoped usage metric to pair against
         * (`container.memory.usage`), which the shipped catalog does not
         * carry today.
         */
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
        incidentTitle: `[K8s] Pod Memory Saturating Container Limit (>90%) - ${args.monitorName}`,
        incidentDescription: `A pod's memory usage has exceeded 90% of its configured container memory limit. The kubelet OOMKills a container the moment it crosses its limit, so this is the state immediately preceding a restart — and, if the workload sits behind an autoscaler, the start of a restart/scale-up loop. Either the limit is set too low for the workload's real footprint or the workload has a memory leak. Check the root cause for the specific pod, its limit, and its usage trend.`,
        criteriaName: "Pod Memory Saturation - Usage/Limit > 90%",
        criteriaDescription:
          "Triggers when any pod's memory usage exceeds 90% of its container memory limit.",
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

const podCpuLimitSaturationTemplate: KubernetesAlertTemplate = {
  id: "k8s-pod-cpu-limit-saturation",
  name: "Pod CPU Saturating Container Limit",
  description:
    "Alert when a pod's CPU usage exceeds 90% of its configured container CPU limit — the point at which the kernel's CFS quota starts throttling it. Computed per pod as k8s.pod.cpu.utilization ÷ k8s.container.cpu_limit × 100; both are CPU cores, so this is a true percentage (k8s.pod.cpu.utilization is a misnamed cores gauge, not a percent). A throttled pod gets slower, not louder — behind an HPA that reads CPU, throttling drives the replica count up while every pod stays equally starved.",
  category: "Workload",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "pod_cpu_limit_saturation";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesRatioMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        numeratorMetricName: "k8s.pod.cpu.utilization",
        denominatorMetricName: "k8s.container.cpu_limit",
        groupByAttributeKeys: [
          "resource.k8s.namespace.name",
          "resource.k8s.pod.name",
        ],
        numeratorAlias: "used_cpu",
        denominatorAlias: "limit_cpu",
        resultAlias: metricAlias,
        resultLegend: "Pod CPU vs Limit (%)",
        resourceScope: KubernetesResourceScope.Pod,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Avg, for the same reason as the memory template above: ONE
         * numerator series per pod (kubeletstats) against a per-container
         * denominator (k8s_cluster) on an independent scrape cycle. Exact
         * for single-container pods; over-reports (fires early) for
         * multi-container pods. See that template's note for the full
         * trade-off.
         */
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
        incidentTitle: `[K8s] Pod CPU Saturating Container Limit (>90%) - ${args.monitorName}`,
        incidentDescription: `A pod's CPU usage has exceeded 90% of its configured container CPU limit and is being throttled by the kernel's CFS quota. Throttling is silent — the pod does not crash, it just gets slower, so this usually surfaces as request latency rather than as an error. If the workload sits behind a CPU-based HorizontalPodAutoscaler, throttling also inflates the metric the HPA scales on, so the autoscaler adds replicas that are each equally starved. Check whether the CPU limit is set too low for the workload rather than adding replicas.`,
        criteriaName: "Pod CPU Saturation - Usage/Limit > 90%",
        criteriaDescription:
          "Triggers when any pod's CPU usage exceeds 90% of its container CPU limit.",
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
    hpaAtMaxReplicasTemplate,
    podMemoryLimitSaturationTemplate,
    podCpuLimitSaturationTemplate,
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
