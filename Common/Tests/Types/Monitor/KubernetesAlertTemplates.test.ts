import {
  KubernetesAlertTemplate,
  KubernetesAlertTemplateArgs,
  getAllKubernetesAlertTemplates,
  getKubernetesAlertTemplateById,
} from "../../../Types/Monitor/KubernetesAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { hasRecoveryDeadBand } from "./Utils/RecommendationCriteriaAssertions";
import MonitorStepKubernetesMonitor from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../../Types/ObjectID";

/*
 * These tests lock in the subtle, easy-to-regress decisions in the
 * per-series ratio alert templates (node request/usage utilization, plus
 * the autoscaling and container-limit saturation templates):
 *
 *   1. Group-by uses the ClickHouse-stored `resource.`-prefixed attribute
 *      name (`resource.k8s.node.name`), not the bare `k8s.node.name`.
 *      OneUptime stamps OTel resource attributes with a `resource.` prefix
 *      at ingest, so the bare key would match nothing and collapse every
 *      node into one mislabeled series. The key SET differs per template —
 *      the HPA template groups per namespace+HPA and the pod-limit
 *      templates per namespace+pod — so each case carries its own
 *      expected set, and both queries must carry exactly that set or the
 *      formula's fingerprint join silently finds nothing.
 *
 *      Namespace is in those sets because a Kubernetes object name is
 *      unique only within a namespace, and because the set is also what
 *      the resulting alert can NAME (see SeriesLabelDisplay). Node is
 *      deliberately NOT: kubeletstats always carries it but the
 *      k8s_cluster side only gets it from the best-effort k8sattributes
 *      processor, and a key only one side carries breaks the join.
 *
 *   2. The aggregation differs by numerator shape:
 *        - Request utilization sums MANY container series per node, and both
 *          metrics come from the same `k8s_cluster` scrape, so `Sum` on both
 *          sides totals the containers and the scrape multiple cancels.
 *        - Usage utilization has ONE series per node, and numerator
 *          (kubeletstats) and denominator (k8s_cluster) come from different
 *          receivers, so `Avg` on both sides gives the correct per-minute
 *          ratio regardless of each receiver's scrape count.
 *        - The saturation templates are all `Avg` — see the pod-memory
 *          template's note in KubernetesAlertTemplates.ts for the
 *          multi-container trade-off that choice accepts.
 *
 *   3. The criteria reference the FORMULA alias (the computed percentage),
 *      not a raw query alias.
 *
 *   4. The unhealthy and healthy criteria PARTITION the value range — no
 *      gap (a value that matches neither leaves the monitor stuck in its
 *      previous status) and no overlap (a value that matches both makes the
 *      resulting status depend on evaluation order).
 */

interface RatioTemplateCase {
  id: string;
  numerator: string;
  denominator: string;
  numAlias: string;
  denAlias: string;
  resultAlias: string;
  aggregation: MetricsAggregationType;
  threshold: number;
  /*
   * The full group-by key SET, in order. Both queries must carry exactly
   * this, or the two halves of the ratio hash to fingerprints that never
   * meet and the formula silently evaluates against an empty operand.
   */
  groupBy: Array<string>;
}

const RATIO_TEMPLATES: Array<RatioTemplateCase> = [
  // Request utilization — Sum/Sum (numerator totals many containers per node).
  {
    id: "k8s-node-cpu-request-utilization",
    numerator: "k8s.container.cpu_request",
    denominator: "k8s.node.allocatable_cpu",
    numAlias: "req_cpu",
    denAlias: "alloc_cpu",
    resultAlias: "node_cpu_request_utilization",
    aggregation: MetricsAggregationType.Sum,
    threshold: 90,
    groupBy: ["resource.k8s.node.name"],
  },
  {
    id: "k8s-node-memory-request-utilization",
    numerator: "k8s.container.memory_request",
    denominator: "k8s.node.allocatable_memory",
    numAlias: "req_mem",
    denAlias: "alloc_mem",
    resultAlias: "node_memory_request_utilization",
    aggregation: MetricsAggregationType.Sum,
    threshold: 90,
    groupBy: ["resource.k8s.node.name"],
  },
  // Usage utilization — Avg/Avg (one series per node, cross-receiver).
  {
    id: "k8s-high-cpu",
    numerator: "k8s.node.cpu.usage",
    denominator: "k8s.node.allocatable_cpu",
    numAlias: "used_cpu",
    denAlias: "alloc_cpu",
    resultAlias: "node_cpu_utilization",
    aggregation: MetricsAggregationType.Avg,
    threshold: 90,
    groupBy: ["resource.k8s.node.name"],
  },
  {
    id: "k8s-high-memory",
    numerator: "k8s.node.memory.usage",
    denominator: "k8s.node.allocatable_memory",
    numAlias: "used_mem",
    denAlias: "alloc_mem",
    resultAlias: "node_memory_utilization",
    aggregation: MetricsAggregationType.Avg,
    threshold: 85,
    groupBy: ["resource.k8s.node.name"],
  },
  /*
   * Autoscaling / limit saturation — Avg/Avg, and NOT keyed on the node.
   *
   * The HPA ratio groups per namespace+HPA object; the two pod-limit
   * ratios group per namespace+pod. Locking the group-by set here is the
   * point of these cases: these were the first ratio templates in this
   * file not keyed on `resource.k8s.node.name`, so a copy-paste of the
   * node key would silently collapse every HPA (or every pod) into one
   * mislabeled series that still renders and still alerts.
   */
  {
    id: "k8s-hpa-at-max-replicas",
    numerator: "k8s.hpa.current_replicas",
    denominator: "k8s.hpa.max_replicas",
    numAlias: "current_replicas",
    denAlias: "max_replicas",
    resultAlias: "hpa_replica_saturation",
    aggregation: MetricsAggregationType.Avg,
    threshold: 90,
    groupBy: ["resource.k8s.namespace.name", "resource.k8s.hpa.name"],
  },
  {
    id: "k8s-pod-memory-limit-saturation",
    numerator: "k8s.pod.memory.usage",
    denominator: "k8s.container.memory_limit",
    numAlias: "used_mem",
    denAlias: "limit_mem",
    resultAlias: "pod_memory_limit_saturation",
    aggregation: MetricsAggregationType.Avg,
    threshold: 90,
    groupBy: ["resource.k8s.namespace.name", "resource.k8s.pod.name"],
  },
  {
    id: "k8s-pod-cpu-limit-saturation",
    numerator: "k8s.pod.cpu.utilization",
    denominator: "k8s.container.cpu_limit",
    numAlias: "used_cpu",
    denAlias: "limit_cpu",
    resultAlias: "pod_cpu_limit_saturation",
    aggregation: MetricsAggregationType.Avg,
    threshold: 90,
    groupBy: ["resource.k8s.namespace.name", "resource.k8s.pod.name"],
  },
];

function buildArgs(): KubernetesAlertTemplateArgs {
  return {
    clusterIdentifier: "prod-cluster",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
  };
}

function getKubernetesMonitor(step: MonitorStep): MonitorStepKubernetesMonitor {
  const kubernetesMonitor: MonitorStepKubernetesMonitor | undefined =
    step.data?.kubernetesMonitor;
  if (!kubernetesMonitor) {
    throw new Error("kubernetesMonitor missing from monitor step");
  }
  return kubernetesMonitor;
}

describe("KubernetesAlertTemplates - per-series ratio templates", () => {
  test("all ratio templates are registered", () => {
    const ids: Array<string> = getAllKubernetesAlertTemplates().map(
      (t: KubernetesAlertTemplate) => {
        return t.id;
      },
    );
    for (const tc of RATIO_TEMPLATES) {
      expect(ids).toContain(tc.id);
    }
  });

  test.each(RATIO_TEMPLATES)(
    "$id is a ($aggregation/$aggregation) ratio keyed on $groupBy",
    (tc: RatioTemplateCase) => {
      const template: KubernetesAlertTemplate | undefined =
        getKubernetesAlertTemplateById(tc.id);
      expect(template).toBeDefined();

      const step: MonitorStep = template!.getMonitorStep(buildArgs());
      const monitor: MonitorStepKubernetesMonitor = getKubernetesMonitor(step);

      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      const formulaConfigs: Array<any> = monitor.metricViewConfig
        .formulaConfigs as Array<any>;

      // Two queries (numerator + denominator) and one formula.
      expect(queryConfigs).toHaveLength(2);
      expect(formulaConfigs).toHaveLength(1);

      const [numerator, denominator] = queryConfigs;

      // Metric names.
      expect(numerator.metricQueryData.filterData.metricName).toBe(
        tc.numerator,
      );
      expect(denominator.metricQueryData.filterData.metricName).toBe(
        tc.denominator,
      );

      /*
       * Decision (2): both sides use the same aggregation — Sum for request
       * utilization (totals containers, cancels scrape factor) or Avg for
       * usage utilization (one series per node, cross-receiver).
       */
      expect(numerator.metricQueryData.filterData.aggegationType).toBe(
        tc.aggregation,
      );
      expect(denominator.metricQueryData.filterData.aggegationType).toBe(
        tc.aggregation,
      );

      /*
       * Decision (1): group by the resource-prefixed attribute on BOTH
       * queries so the per-series fingerprints line up for the formula join.
       */
      expect(numerator.metricQueryData.groupByAttributeKeys).toEqual(
        tc.groupBy,
      );
      expect(denominator.metricQueryData.groupByAttributeKeys).toEqual(
        tc.groupBy,
      );

      for (const key of tc.groupBy) {
        // The `resource.` prefix is load-bearing — a bare OTel key matches nothing.
        expect(key.startsWith("resource.")).toBe(true);
      }

      // Formula divides numerator by denominator and scales to a percentage.
      expect(formulaConfigs[0].metricFormulaData.metricFormula).toBe(
        `(${tc.numAlias} / ${tc.denAlias}) * 100`,
      );

      /*
       * Decision (3): the criteria must reference the FORMULA alias (not a
       * raw query), so the threshold is evaluated against the computed
       * percentage.
       */
      const offlineFilters: Array<any> = step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray?.[0]?.data?.filters as Array<any>;
      expect(offlineFilters[0].metricMonitorOptions.metricAlias).toBe(
        tc.resultAlias,
      );
      expect(offlineFilters[0].value).toBe(tc.threshold);
    },
  );

  /*
   * Decision (4): unhealthy and healthy must be exact complements at the
   * same threshold. Both halves are hand-written per template, so the
   * failure mode is a strict/non-strict slip — pairing `> 90` with
   * `< 90` leaves exactly 90 matching neither criterion (the monitor
   * silently holds its previous status), and pairing `>= 90` with
   * `<= 90` makes 90 match both (status depends on evaluation order).
   */
  const COMPLEMENT_OF: Record<string, string> = {
    [FilterType.GreaterThan]: FilterType.LessThanOrEqualTo,
    [FilterType.GreaterThanOrEqualTo]: FilterType.LessThan,
  };

  test.each(RATIO_TEMPLATES)(
    "$id unhealthy/healthy criteria leave a recovery dead band around $threshold",
    (tc: RatioTemplateCase) => {
      const template: KubernetesAlertTemplate | undefined =
        getKubernetesAlertTemplateById(tc.id);
      const step: MonitorStep = template!.getMonitorStep(buildArgs());

      const instances: Array<any> = step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray as Array<any>;
      const [offline, online] = instances;

      const offlineFilter: any = offline.data.filters[0];
      const onlineFilter: any = online.data.filters[0];

      // Same metric; the comparison direction AND the threshold differ.
      expect(onlineFilter.metricMonitorOptions.metricAlias).toBe(
        tc.resultAlias,
      );
      /*
       * The healthy criteria recovers at a threshold strictly INSIDE the
       * firing one, so a metric hovering at the boundary cannot satisfy
       * both on consecutive evaluations. This assertion used to be
       * `expect(onlineFilter.value).toBe(tc.threshold)` — the two criteria
       * exactly partitioned the range, which is the flapping configuration
       * this suite existed to lock in.
       */
      expect(
        hasRecoveryDeadBand(
          {
            filterType: offlineFilter.filterType,
            value: offlineFilter.value as number,
          },
          {
            filterType: onlineFilter.filterType,
            value: onlineFilter.value as number,
          },
        ),
      ).toBe(true);

      expect(COMPLEMENT_OF[offlineFilter.filterType]).toBe(
        onlineFilter.filterType,
      );

      // The unhealthy criterion is the one that opens incidents/alerts.
      expect(offline.data.createIncidents).toBe(true);
      expect(offline.data.createAlerts).toBe(true);
      expect(online.data.createIncidents).toBe(false);
      expect(online.data.createAlerts).toBe(false);
    },
  );
});

/*
 * The three saturation templates exist to catch the CAUSE of the
 * "under-resourced workload behind an autoscaler" failure — limits too
 * low, HPA driven to its ceiling, cluster filled — rather than its
 * downstream symptoms (node pressure, pending pods, NotReady), which the
 * older node-side templates already cover. These assertions pin the
 * properties that make them useful for that: they must be discoverable in
 * the picker under a category, and severity must reflect that memory
 * saturation ends in an OOMKill while CPU saturation only throttles.
 */
describe("KubernetesAlertTemplates - autoscaling & limit saturation", () => {
  const SATURATION_TEMPLATES: Array<{
    id: string;
    category: string;
    severity: string;
  }> = [
    {
      id: "k8s-hpa-at-max-replicas",
      category: "Workload",
      severity: "Critical",
    },
    {
      id: "k8s-pod-memory-limit-saturation",
      category: "Workload",
      // Crossing a memory limit is an immediate kill, not a slowdown.
      severity: "Critical",
    },
    {
      id: "k8s-pod-cpu-limit-saturation",
      category: "Workload",
      // CFS throttling degrades latency; it never kills the container.
      severity: "Warning",
    },
  ];

  test.each(SATURATION_TEMPLATES)(
    "$id is registered as a $severity $category template",
    (tc: { id: string; category: string; severity: string }) => {
      const template: KubernetesAlertTemplate | undefined =
        getKubernetesAlertTemplateById(tc.id);

      expect(template).toBeDefined();
      expect(template!.category).toBe(tc.category);
      expect(template!.severity).toBe(tc.severity);
      expect(template!.name.length).toBeGreaterThan(0);
      expect(template!.description.length).toBeGreaterThan(0);
    },
  );

  test("every template id is unique", () => {
    const ids: Array<string> = getAllKubernetesAlertTemplates().map(
      (t: KubernetesAlertTemplate) => {
        return t.id;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);
  });
});
