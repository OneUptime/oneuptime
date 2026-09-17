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
  isBinaryMetric?: boolean | undefined;
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
  /*
   * Native-to-display unit for this query. MetricResultUnitConverter
   * (invoked on the monitor path in MonitorTelemetryMonitor, before the
   * criteria are compared) rescales the query's values from the unit
   * OpenTelemetry reported into this one, and MetricUnitUtil puts UCUM
   * "1" — OTel's dimensionless marker for a 0-1 fraction — in the percent
   * family with `toCanonical: 100`.
   *
   * So declaring "%" on a receiver-emitted 0-1 ratio lets the criteria
   * below stay written in percent, and is a no-op if that metric ever
   * arrives already scaled as "%" (the converter short-circuits when the
   * native and display units match).
   */
  legendUnit?: string | undefined;
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
            legendUnit: args.legendUnit,
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
  /*
   * Override the default `(numerator / denominator) * 100` when the
   * percentage the template needs is not a plain ratio of the two
   * operands. Node filesystem usage is the case this exists for: the
   * only companion series this repo ingests is
   * `k8s.node.filesystem.available`, so the denominator has to be built
   * as `usage + available` — the same way `df` computes Use%, and the
   * same way the cluster dashboard already computes node fill. Reference
   * the operand ALIASES, not the metric names.
   */
  formula?: string | undefined;
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
            metricFormula:
              args.formula ||
              `(${args.numeratorAlias} / ${args.denominatorAlias}) * 100`,
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
  /*
   * No backticks in here. `template.description` is rendered as raw JSX
   * text on the recommendation card
   * (KubernetesTemplatePicker.tsx renders `{template.description}` inside a
   * <p>, not markdown), so a code span would show up as literal backticks.
   */
  description:
    "Alert when a container has restarted more than 5 times since its pod was created. k8s.container.restarts is the container status' cumulative restartCount, so this is a lifetime count for the CURRENT pod rather than a rate: it resets only when the pod object is replaced, which is also when this alert auto-resolves.",
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
        /*
         * `k8s.container.restarts` is containerStatus.restartCount: it only
         * ever goes up for the life of the pod object. Everything this copy
         * says follows from that, so keep the two facts in it — the count is
         * cumulative, and the alert therefore clears on pod replacement
         * rather than when the crashing stops.
         *
         * No angle-bracket placeholders in here. Incident.description is a
         * Markdown column, and the subscriber path runs it through
         * Markdown.convertToPlainText, which strips /<[^>]*>/g BEFORE it
         * strips code-span backticks — so `<pod>` would silently vanish from
         * every SMS.
         *
         * This template is GROUPED (namespace + pod + container), so it does
         * NOT send the reader to the root cause for identity: a grouped
         * alert's rootCause is only the compare line
         * (MonitorCriteriaEvaluator.collectPerSeriesMatches). The identity
         * lives in the block SeriesContextEnricher appends to the
         * description.
         */
        incidentDescription: `A container has restarted more than 5 times since its pod was created — the signature of a CrashLoopBackOff. This count is cumulative for THIS pod and never decreases, so the alert clears when the pod is replaced (a redeploy, an eviction, a node drain) rather than at the moment the crashing stops. Common causes: a crash on startup, a missing config map or secret, an OOMKill against the container's memory limit, or a failing liveness probe. The affected namespace, pod and container are named under "Affected resource" below, with the kubectl commands to inspect them — including the previous instance's logs — under "Start here".`,
        criteriaName: "CrashLoopBackOff - Container Restarts > 5",
        criteriaDescription:
          "Triggers when a container's cumulative restart count for its current pod exceeds 5. This is not a per-window rate: a container that crash-looped and then stabilised keeps the alert open until its pod is replaced, and a container that is actively crash-looping but has only reached 3 restarts does not fire yet.",
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
    const metricAlias: string = "min_pod_phase";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "k8s.pod.phase",
        metricAlias,
        resourceScope: KubernetesResourceScope.Cluster,
        /*
         * 15 minutes, with the sustained (AllValues) default: a pod that
         * is Pending for a few seconds while it is scheduled is normal on
         * any cluster doing deployments. "Stuck" means every per-minute
         * bucket in the window still found a pod waiting.
         */
        rollingTime: RollingTime.Past15Minutes,
        /*
         * `k8s.pod.phase` encodes the phase in the VALUE, not in a label.
         * The `k8s_cluster` receiver emits one gauge per pod per scrape,
         * numbered in the order KubernetesMetricCatalog names them:
         * 1 = Pending, 2 = Running, 3 = Succeeded, 4 = Failed,
         * 5 = Unknown. The numeric mapping comes from the receiver itself;
         * the catalog names the phases but carries no codes.
         *
         * This template used to carry
         * `attributes: { "resource.k8s.pod.phase": "Pending" }` — an
         * attribute nothing produces. The `k8s_cluster` receiver does not
         * stamp it, the agent's `k8sattributes` processor extracts only
         * name/uid/namespace/node/workload/container keys
         * (configmap-deployment.yaml), and nothing in the ingest path
         * synthesises it. The worker copies this map straight into the
         * ClickHouse predicate (MonitorTelemetryMonitor.monitorKubernetes),
         * so the query matched zero rows: the monitor never fired, never
         * resolved, and never reported that it was watching nothing.
         *
         * Pending is the LOWEST phase code, so the cluster-wide Min is
         * exactly 1 when at least one pod is Pending, and >= 2 otherwise.
         * Min also avoids the trap the previous `Sum` walked into, which
         * Common/Types/Dashboard/DashboardTemplates.ts documents: a
         * per-resource gauge re-emitted on every scrape sums to
         * (pods x scrapes). This is the same idiom k8s-node-not-ready
         * already uses on `k8s.node.condition_ready` (Min + an equality
         * against the bad value).
         */
        aggregationType: MetricsAggregationType.Min,
        /*
         * Deliberately NOT grouped, unlike the other pod-level templates.
         *
         * This is a cluster-wide statement about scheduling capacity
         * ("somebody is stuck waiting") rather than about any one pod's
         * health — the same signal as k8s-scheduler-backlog, seen from
         * the pod side.
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
        filterType: FilterType.EqualTo,
        value: 1,
        incidentTitle: `[K8s] Pods Stuck in Pending - ${args.monitorName}`,
        /*
         * Deliberately self-sufficient: it does NOT say "see the affected
         * resources below". The shared Kubernetes breakdown renderer sorts
         * affected resources by descending metric value ("worst first"),
         * which for a phase code puts Unknown(5)/Failed(4)/Succeeded(3)
         * pods above the Pending(1) one this alert is about, so the table
         * cannot be relied on to name the stuck pod until that renderer
         * learns a per-metric sort direction.
         */
        incidentDescription: `At least one pod has been in Pending phase in every sample of the last 15 minutes and cannot be scheduled. This typically indicates insufficient CPU/memory on the nodes, node affinity or taint restrictions, an unbound PersistentVolumeClaim, or an exceeded ResourceQuota. Run \`kubectl get pods --all-namespaces --field-selector=status.phase=Pending\` and \`kubectl describe\` one of them to see the scheduler's reason.`,
        criteriaName: "Pods Pending - Phase = Pending (1)",
        criteriaDescription:
          "Triggers when the lowest pod phase code in the cluster is 1 (Pending) for every sample in the monitoring window.",
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        /*
         * NotEqualTo rather than GreaterThan: getRecoveryThreshold gives
         * no dead band to an equality comparison, so the recovery value
         * stays exactly 1. `GreaterThan` would complement back to
         * LessThanOrEqualTo and derive a 1.1 recovery threshold — a
         * fractional edge on a metric whose values are an enum.
         */
        filterType: FilterType.NotEqualTo,
        value: 1,
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
        incidentDescription: `A Kubernetes node has transitioned to NotReady state. This is a critical condition that affects all pods scheduled on this node. The affected node is named under "Affected resource" below; use the kubectl commands under "Start here" to read its conditions and list what it is still hosting.`,
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
        incidentDescription: `A node's average CPU usage has exceeded 90% of its allocatable CPU. Sustained high CPU usage can cause pod throttling, increased latency, and potential node instability. The affected node is named under "Affected resource" below; use the kubectl commands under "Start here" to list the pods on it and find the top CPU consumers.`,
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
        incidentDescription: `A node's average memory usage has exceeded 85% of its allocatable memory. High memory usage can lead to OOMKilled pods, node instability, and potential evictions. The affected node is named under "Affected resource" below; use the kubectl commands under "Start here" to list the pods on it and find the top memory consumers.`,
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
        /*
         * 15 minutes, not 5. With the sustained (AllValues) default, the
         * window IS the "how long has this been stuck" knob: every
         * per-minute bucket in it must report unavailable replicas. A
         * normal rolling update makes unavailable_replicas non-zero for
         * the duration of the rollout, and a ten-replica deployment with
         * maxUnavailable 25% and real readiness probes routinely takes
         * longer than five minutes — so a five-minute window still paged
         * once per deploy for a condition that is the deploy working.
         */
        rollingTime: RollingTime.Past15Minutes,
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
        incidentDescription: `A Kubernetes deployment has unavailable replicas — the desired replica count does not match the available count. This may indicate a failed rollout, image pull errors, insufficient resources, or pod crash loops. The affected namespace and deployment are named under "Affected resource" below, with the rollout-status command under "Start here".`,
        criteriaName: "Replica Mismatch - Unavailable > 0 for 15 minutes",
        criteriaDescription:
          "Triggers when a deployment reports unavailable replicas in every sample of a fifteen-minute window — long enough that a normal rolling update has completed and the rollout is genuinely stuck.",
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
        incidentDescription: `A Kubernetes Job has one or more failed pods. This indicates the job's workload is failing to complete successfully. The affected namespace and job are named under "Affected resource" below, with the describe command under "Start here".`,
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
  /*
   * The requirement leads, deliberately: the card truncates long
   * descriptions, and a user who one-clicks this on a managed cluster gets
   * a monitor that is never Met and gives no indication it is inert.
   *
   * No backticks — KubernetesTemplatePicker renders this as raw JSX text,
   * so a code span would show up as literal backticks on the card.
   */
  description:
    "Requires the agent's control-plane scrape (controlPlane.enabled); managed clusters (EKS / GKE / AKS) do not expose etcd's metrics endpoint at all, so on those this monitor will never receive a data point. Alert immediately when etcd has no leader elected — a critical cluster health issue.",
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
  name: "API Server Request Saturation",
  description:
    "Alert when the Kubernetes API server holds 200 or more concurrent in-flight requests for the whole window — the state in which it starts rejecting requests with 429. Requires the agent's control-plane scrape: set controlPlane.enabled and point controlPlane.apiServer.endpoints at an API server address the collector pod can actually reach (the chart's default, localhost:6443, is the collector's own loopback and scrapes nothing).",
  category: "ControlPlane",
  severity: "Critical",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "inflight_requests";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        /*
         * A GAUGE, deliberately.
         *
         * This template used to Sum `apiserver_dropped_requests_total`, a
         * cumulative Prometheus counter. The agent scrapes the API
         * server's /metrics raw (configmap-deployment.yaml, job_name:
         * kube-apiserver, no metric_relabel_configs) and nothing in the
         * shipped pipeline converts counters to deltas: there is no
         * cumulativetodelta processor in the chart,
         * OtelMetricsIngestService records `aggregationTemporality` /
         * `isMonotonic` but never differences the value, and neither
         * AggregationType nor CompareCriteria.reduceWindow has a Rate or
         * Delta member. So every sample was the process's lifetime total.
         * One throttled request at any point since the API server last
         * started pinned the monitor Offline, and the "= 0" recovery could
         * never be met again.
         *
         * `apiserver_current_inflight_requests` is the gauge the cluster's
         * own control-plane dashboard already charts for this signal
         * (App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/
         * ControlPlane.tsx: "Current number of in-flight requests being
         * processed. High counts indicate API server saturation."). It is
         * emitted per request_kind (mutating / readOnly).
         */
        metricName: "apiserver_current_inflight_requests",
        metricAlias,
        resourceScope: KubernetesResourceScope.Cluster,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Max across the two request_kind series: saturation of either
         * queue is the condition, and the two have different ceilings.
         *
         * Ungrouped: this is the control plane's aggregate concurrency.
         * Splitting it would need a per-apiserver-instance identity that
         * this metric does not carry in the shipped agent config.
         */
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        /*
         * GreaterThanOrEqualTo, not GreaterThan.
         *
         * This gauge counts ADMITTED concurrency, so it is bounded above by
         * the API server's own admission limit — it saturates AT the limit
         * rather than climbing past it. 200 is the default
         * --max-mutating-requests-inflight exactly, so a strict "> 200"
         * would ask the mutating queue to exceed its own ceiling and the
         * one series this number describes would never fire at all. ">="
         * catches a mutating queue pinned at its limit (actively rejecting
         * with 429) and a readOnly queue at half of its default 400
         * ceiling.
         *
         * The number is a heuristic tied to the upstream defaults, not a
         * derived fact; the incident description tells the operator to
         * retune it against their own flags.
         */
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 200,
        incidentTitle: `[K8s] CRITICAL: API Server Request Saturation - ${args.monitorName}`,
        incidentDescription: `The Kubernetes API server has held 200 or more concurrent in-flight requests for every sample in the monitoring window. The API server admits a bounded number of concurrent requests (--max-requests-inflight, default 400; --max-mutating-requests-inflight, default 200) and rejects the rest with 429, so sustained pressure here is the state immediately preceding cluster-wide API throttling. Common causes: a controller or client hot-looping on LIST, an operator with no resync backoff, or an undersized control plane. If your cluster runs different in-flight limits, retune this threshold to match them.`,
        criteriaName: "API Server Saturation - In-Flight Requests >= 200",
        criteriaDescription:
          "Triggers when the API server's in-flight request count stays at or above 200 for every sample in the monitoring window.",
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        /*
         * Complement of the firing comparison. The builder derives the
         * actual recovery threshold as a 10% dead band inside 200, i.e.
         * "< 180", so a control plane parked at the limit cannot toggle the
         * monitor on consecutive evaluations.
         */
        filterType: FilterType.LessThan,
        value: 200,
      }),
    });
  },
};

const schedulerBacklogTemplate: KubernetesAlertTemplate = {
  id: "k8s-scheduler-backlog",
  name: "Scheduler Backlog",
  // See etcdNoLeaderTemplate for why the requirement leads and why no backticks.
  description:
    "Requires the agent's control-plane scrape (controlPlane.enabled); managed clusters (EKS / GKE / AKS) do not expose the scheduler's metrics endpoint at all, so on those this monitor will never receive a data point. Alert when the scheduler's pending-pod queue is non-empty in every sample of a five-minute window.",
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
  description:
    "Alert when a node's filesystem is more than 90% full. Computed per node as k8s.node.filesystem.usage / (k8s.node.filesystem.usage + k8s.node.filesystem.available) x 100 — both are bytes from the same kubeletstats node scrape, so this is a true percentage and matches what df reports as Use%.",
  category: "Storage",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "disk_usage";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesRatioMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        /*
         * `k8s.node.filesystem.usage` is BYTES (KubernetesMetricCatalog
         * declares `unit: "bytes"`, and nothing converts it — the query
         * configs carry no `legendUnit`, so MetricResultUnitConverter
         * passes the raw value through). This template used to hand that
         * gauge straight to a `> 90` comparison, so every node in every
         * cluster breached on its first evaluation and the healthy
         * criterion — "90 bytes or less used" — was unreachable: a
         * permanently red monitor with an unresolvable incident.
         *
         * The denominator is built from the one companion series this
         * repo has actually ingested, `k8s.node.filesystem.available`
         * (KubernetesMetricCatalog, and the cluster dashboard's node
         * fill tile in App/FeatureSet/Dashboard/src/Pages/Kubernetes/
         * View/Index.tsx). usage / (usage + available) is what `df`
         * reports as Use%.
         */
        numeratorMetricName: "k8s.node.filesystem.usage",
        denominatorMetricName: "k8s.node.filesystem.available",
        groupByAttributeKeys: ["resource.k8s.node.name"],
        numeratorAlias: "used_disk",
        denominatorAlias: "avail_disk",
        resultAlias: metricAlias,
        resultLegend: "Node Disk Usage (%)",
        formula: `(used_disk / (used_disk + avail_disk)) * 100`,
        resourceScope: KubernetesResourceScope.Node,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * ONE series per node on BOTH sides, from the SAME kubeletstats
         * node scrape, so Avg gives the representative per-minute value
         * independent of scrape count. See
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
        incidentTitle: `[K8s] High Disk Usage (>90%) - ${args.monitorName}`,
        incidentDescription: `A node's filesystem is more than 90% full, sustained across the whole monitoring window. High disk usage leads to DiskPressure evictions, failure to pull new container images, and eventually a NotReady node. The affected node is named under "Affected resource" below, with the kubectl commands to inspect it under "Start here".`,
        criteriaName: "High Disk - Usage > 90%",
        criteriaDescription:
          "Triggers when a node's used bytes exceed 90% of used + available for every sample in the monitoring window.",
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
  /*
   * The `id` still says "unavailable" and deliberately stays that way: it
   * is the stable key the recommendation catalog and the
   * already-created-monitor diff match on
   * (MonitorRecommendationCatalog.buildRecommendationId), so renaming it
   * would orphan every monitor a user already created from this card.
   * Everything the user actually READS now says what the metric measures:
   * KubernetesMetricCatalog defines `k8s.daemonset.misscheduled_nodes` as
   * "nodes running a daemon pod that should not be running one", which is
   * the opposite of "nodes missing the daemon pod".
   */
  id: "k8s-daemonset-unavailable",
  name: "DaemonSet Misscheduled Nodes",
  description:
    "Alert when a DaemonSet is running daemon pods on nodes that no longer match its node selector, affinity or taint tolerations. k8s.daemonset.misscheduled_nodes counts nodes that ARE running the pod but should NOT be — it is not the count of nodes that are missing the pod.",
  category: "Workload",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "misscheduled_nodes";

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
        incidentTitle: `[K8s] DaemonSet Misscheduled Nodes - ${args.monitorName}`,
        incidentDescription: `A DaemonSet has daemon pods running on nodes that should not be running them, sustained across the monitoring window. This is usually a stale node selector, affinity rule or taint toleration left behind after a node pool change — the pods were scheduled under the old rules and have not been evicted. It is NOT the same as a DaemonSet missing from nodes that need it. The affected namespace and DaemonSet are named under "Affected resource" below, with the describe command under "Start here"; compare its spec against the current node labels and taints.`,
        criteriaName: "DaemonSet Misscheduled Nodes > 0",
        criteriaDescription:
          "Triggers when a DaemonSet reports at least one misscheduled node for every sample in the monitoring window.",
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
        incidentDescription: `A node's committed CPU requests have exceeded 90% of its allocatable CPU. The node is nearly full from a scheduling standpoint and may be unable to place new pods, even if current CPU usage is low. The affected node is named under "Affected resource" below; use the kubectl commands under "Start here" to list the pods it hosts and their CPU requests.`,
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
        incidentDescription: `A node's committed memory requests have exceeded 90% of its allocatable memory. The node is nearly full from a scheduling standpoint and may be unable to place new pods, even if current memory usage is low. The affected node is named under "Affected resource" below; use the kubectl commands under "Start here" to list the pods it hosts and their memory requests.`,
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
 * All three are grouped by the ClickHouse-stored `resource.`-prefixed
 * attribute. The HPA one is a ratio (there is no ready-made
 * current/max series); the two pod-limit ones read the kubeletstats
 * receiver's own `k8s.pod.*_limit_utilization` family directly, which is
 * enabled by default in the shipped chart and — unlike a hand-built ratio
 * against `k8s.container.*_limit` — divides by the SUM of a pod's
 * container limits rather than their mean.
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
        incidentDescription: `A HorizontalPodAutoscaler is running at 90% or more of its maxReplicas and has effectively no scaling headroom left. Any further load cannot be absorbed by scaling out, so it will surface as latency and errors instead. Check whether the workload is genuinely at capacity or whether its per-pod CPU/memory limits are set too low — an under-resourced pod gets throttled or OOMKilled, which inflates the metric the HPA scales on and drives it to the ceiling. The affected namespace and HorizontalPodAutoscaler are named under "Affected resource" below, with the describe command under "Start here" for its target and current-vs-max replicas.`,
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
    "Alert when a pod is using more than 90% of its container memory limit, read straight from the kubeletstats receiver's own k8s.pod.memory_limit_utilization — which divides the pod's usage by the SUM of its containers' limits, so a pod with a sidecar is measured correctly. Note the kubelet's pod memory figure includes reclaimable page cache, so a file-heavy workload can sit high here without ever being OOMKilled: treat this as approaching the limit, not about to be killed.",
  category: "Workload",
  severity: "Critical",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "pod_memory_limit_saturation";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        /*
         * The agent enables this family by DEFAULT:
         * HelmChart/Public/kubernetes-agent/templates/configmap-daemonset.yaml
         * ("Saturation metrics — CPU/memory as a percentage of pod
         * limit/request") turns on k8s.pod.memory_limit_utilization inside
         * the existing kubeletstats receiver, gated on
         * `kubeletstats.utilizationMetrics.enabled`, which values.yaml sets
         * to `true`. No extra scrape.
         *
         * It replaces a cross-receiver ratio of `k8s.pod.memory.usage`
         * (kubeletstats, one series per POD) over
         * `k8s.container.memory_limit` (k8s_cluster, one series per
         * CONTAINER), which this template's own comment conceded took the
         * MEAN container limit for a multi-container pod — so any pod with
         * a sidecar over-reported its saturation by roughly its container
         * count — and which joined its two halves by series fingerprint
         * across two independent scrape cycles, a join that fails silently
         * rather than loudly.
         */
        metricName: "k8s.pod.memory_limit_utilization",
        metricAlias,
        /*
         * kubeletstats reports this family with UCUM unit "1" (a 0-1
         * fraction). Declaring "%" here makes MetricResultUnitConverter
         * scale it to 0-100 before the threshold below is compared, and
         * costs nothing if a collector ever reports it as "%" already.
         */
        legendUnit: "%",
        resourceScope: KubernetesResourceScope.Pod,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * ONE series per pod, so Max is "the worst sample in this minute"
         * rather than a mean that hides a spike against the limit.
         */
        aggregationType: MetricsAggregationType.Max,
        groupByAttributeKeys: [
          "resource.k8s.namespace.name",
          "resource.k8s.pod.name",
        ],
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
        incidentDescription: `A pod is using more than 90% of its container memory limit, sustained across the monitoring window. The kubelet's pod memory figure includes page cache the kernel reclaims under pressure, so this is "approaching the limit" rather than a guarantee that an OOMKill is imminent — but a pod that stays here is either under-limited for its real working set or leaking, and it is the cause-side signal for the CrashLoopBackOff and restart storms that follow. The affected namespace and pod are named under "Affected resource" below, with the kubectl commands to read its limits and current usage under "Start here".`,
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
    "Alert when a pod is using more than 90% of its container CPU limit — the point at which the kernel's CFS quota starts throttling it. Read from the kubeletstats receiver's own k8s.pod.cpu_limit_utilization, which divides the pod's CPU by the SUM of its containers' limits, so a pod with a sidecar is not measured against the mean of its containers' limits. A throttled pod gets slower, not louder — behind an HPA that reads CPU, throttling drives the replica count up while every pod stays equally starved.",
  category: "Workload",
  severity: "Warning",
  getMonitorStep: (args: KubernetesAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "pod_cpu_limit_saturation";

    return buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        // See the memory template above for why this replaces the ratio.
        metricName: "k8s.pod.cpu_limit_utilization",
        metricAlias,
        legendUnit: "%",
        resourceScope: KubernetesResourceScope.Pod,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
        groupByAttributeKeys: [
          "resource.k8s.namespace.name",
          "resource.k8s.pod.name",
        ],
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
