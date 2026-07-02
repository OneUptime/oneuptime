import {
  KubernetesAlertTemplate,
  KubernetesAlertTemplateArgs,
  RECOMMENDED_KUBERNETES_ALERT_TEMPLATE_IDS,
  getAllKubernetesAlertTemplates,
  getKubernetesAlertTemplateById,
} from "../../../Types/Monitor/KubernetesAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepKubernetesMonitor from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../../Types/ObjectID";

/*
 * These tests lock in the subtle, easy-to-regress decisions in the per-group
 * ratio alert templates (node request/usage utilization, node disk usage,
 * PVC free space):
 *
 *   1. Group-by uses the ClickHouse-stored `resource.`-prefixed attribute
 *      name (e.g. `resource.k8s.node.name`), not the bare `k8s.node.name`.
 *      OneUptime stamps OTel resource attributes with a `resource.` prefix
 *      at ingest, so the bare key would match nothing and collapse every
 *      group into one mislabeled series.
 *
 *   2. The aggregation differs by numerator shape:
 *        - Request utilization sums MANY container series per node, and both
 *          metrics come from the same `k8s_cluster` scrape, so `Sum` on both
 *          sides totals the containers and the scrape multiple cancels.
 *        - Usage utilization, disk usage, and PVC free space have ONE series
 *          per group, so `Avg` on both sides gives the correct per-minute
 *          ratio regardless of each receiver's scrape count.
 *
 *   3. The criteria reference the FORMULA alias (the computed percentage),
 *      not a raw query alias.
 */

interface RatioTemplateCase {
  id: string;
  numerator: string;
  denominator: string;
  numAlias: string;
  denAlias: string;
  resultAlias: string;
  aggregation: MetricsAggregationType;
  groupByKey: string;
  offlineFilterType: FilterType;
  threshold: number;
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
    groupByKey: "resource.k8s.node.name",
    offlineFilterType: FilterType.GreaterThan,
    threshold: 90,
  },
  {
    id: "k8s-node-memory-request-utilization",
    numerator: "k8s.container.memory_request",
    denominator: "k8s.node.allocatable_memory",
    numAlias: "req_mem",
    denAlias: "alloc_mem",
    resultAlias: "node_memory_request_utilization",
    aggregation: MetricsAggregationType.Sum,
    groupByKey: "resource.k8s.node.name",
    offlineFilterType: FilterType.GreaterThan,
    threshold: 90,
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
    groupByKey: "resource.k8s.node.name",
    offlineFilterType: FilterType.GreaterThan,
    threshold: 90,
  },
  {
    id: "k8s-high-memory",
    numerator: "k8s.node.memory.usage",
    denominator: "k8s.node.allocatable_memory",
    numAlias: "used_mem",
    denAlias: "alloc_mem",
    resultAlias: "node_memory_utilization",
    aggregation: MetricsAggregationType.Avg,
    groupByKey: "resource.k8s.node.name",
    offlineFilterType: FilterType.GreaterThan,
    threshold: 85,
  },
  /*
   * Disk usage — Avg/Avg (one series per node, same kubeletstats scrape).
   * Ratio-based so the 90 threshold is a real percentage, not raw bytes.
   */
  {
    id: "k8s-high-disk-usage",
    numerator: "k8s.node.filesystem.usage",
    denominator: "k8s.node.filesystem.capacity",
    numAlias: "fs_used",
    denAlias: "fs_capacity",
    resultAlias: "node_disk_utilization",
    aggregation: MetricsAggregationType.Avg,
    groupByKey: "resource.k8s.node.name",
    offlineFilterType: FilterType.GreaterThan,
    threshold: 90,
  },
  /*
   * PVC free space — Avg/Avg, grouped per PVC. The formula yields the
   * AVAILABLE percentage, so the offline direction is LessThan.
   */
  {
    id: "k8s-pvc-near-full",
    numerator: "k8s.volume.available",
    denominator: "k8s.volume.capacity",
    numAlias: "volume_available",
    denAlias: "volume_capacity",
    resultAlias: "volume_available_percent",
    aggregation: MetricsAggregationType.Avg,
    groupByKey: "resource.k8s.persistentvolumeclaim.name",
    offlineFilterType: FilterType.LessThan,
    threshold: 15,
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

describe("KubernetesAlertTemplates - registry", () => {
  test("all 16 templates are registered", () => {
    expect(getAllKubernetesAlertTemplates()).toHaveLength(16);
  });

  test("every recommended template id resolves to a registered template", () => {
    expect(RECOMMENDED_KUBERNETES_ALERT_TEMPLATE_IDS).toHaveLength(10);
    expect(new Set(RECOMMENDED_KUBERNETES_ALERT_TEMPLATE_IDS).size).toBe(
      RECOMMENDED_KUBERNETES_ALERT_TEMPLATE_IDS.length,
    );
    for (const id of RECOMMENDED_KUBERNETES_ALERT_TEMPLATE_IDS) {
      const template: KubernetesAlertTemplate | undefined =
        getKubernetesAlertTemplateById(id);
      expect(template).toBeDefined();
      expect(template!.id).toBe(id);
    }
  });
});

describe("KubernetesAlertTemplates - per-group ratio templates", () => {
  test("all six ratio templates are registered", () => {
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
    "$id is a per-group ($aggregation/$aggregation) ratio keyed on $groupByKey",
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
      expect(numerator.metricQueryData.groupByAttributeKeys).toEqual([
        tc.groupByKey,
      ]);
      expect(denominator.metricQueryData.groupByAttributeKeys).toEqual([
        tc.groupByKey,
      ]);

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
      expect(offlineFilters[0].filterType).toBe(tc.offlineFilterType);
      expect(offlineFilters[0].value).toBe(tc.threshold);
    },
  );
});

describe("KubernetesAlertTemplates - container memory near limit", () => {
  test("k8s-container-memory-near-limit thresholds the 0-1 limit-utilization ratio at 0.95", () => {
    const template: KubernetesAlertTemplate | undefined =
      getKubernetesAlertTemplateById("k8s-container-memory-near-limit");
    expect(template).toBeDefined();

    const step: MonitorStep = template!.getMonitorStep(buildArgs());
    const monitor: MonitorStepKubernetesMonitor = getKubernetesMonitor(step);

    const queryConfigs: Array<any> = monitor.metricViewConfig
      .queryConfigs as Array<any>;
    expect(queryConfigs).toHaveLength(1);
    expect(queryConfigs[0].metricQueryData.filterData.metricName).toBe(
      "k8s.container.memory_limit_utilization",
    );
    expect(queryConfigs[0].metricQueryData.filterData.aggegationType).toBe(
      MetricsAggregationType.Max,
    );

    const criteriaInstances: Array<any> = step.data?.monitorCriteria.data
      ?.monitorCriteriaInstanceArray as Array<any>;
    expect(criteriaInstances).toHaveLength(2);

    const offlineFilters: Array<any> = criteriaInstances[0].data
      ?.filters as Array<any>;
    expect(offlineFilters[0].metricMonitorOptions.metricAlias).toBe(
      "memory_limit_utilization",
    );
    expect(offlineFilters[0].filterType).toBe(FilterType.GreaterThan);
    // The metric is a 0-1 ratio, so the threshold is 0.95, not 95.
    expect(offlineFilters[0].value).toBe(0.95);

    const onlineFilters: Array<any> = criteriaInstances[1].data
      ?.filters as Array<any>;
    expect(onlineFilters[0].filterType).toBe(FilterType.LessThanOrEqualTo);
    expect(onlineFilters[0].value).toBe(0.95);
  });
});
