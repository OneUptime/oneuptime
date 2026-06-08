import {
  KubernetesAlertTemplate,
  KubernetesAlertTemplateArgs,
  getAllKubernetesAlertTemplates,
  getKubernetesAlertTemplateById,
} from "../../../Types/Monitor/KubernetesAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepKubernetesMonitor from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";

/*
 * These tests lock in the subtle, easy-to-regress decisions in the per-node
 * ratio alert templates (request utilization + usage utilization):
 *
 *   1. Group-by uses the ClickHouse-stored `resource.`-prefixed attribute
 *      name (`resource.k8s.node.name`), not the bare `k8s.node.name`.
 *      OneUptime stamps OTel resource attributes with a `resource.` prefix
 *      at ingest, so the bare key would match nothing and collapse every
 *      node into one mislabeled series.
 *
 *   2. The aggregation differs by numerator shape:
 *        - Request utilization sums MANY container series per node, and both
 *          metrics come from the same `k8s_cluster` scrape, so `Sum` on both
 *          sides totals the containers and the scrape multiple cancels.
 *        - Usage utilization has ONE series per node, and numerator
 *          (kubeletstats) and denominator (k8s_cluster) come from different
 *          receivers, so `Avg` on both sides gives the correct per-minute
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
    threshold: 85,
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

describe("KubernetesAlertTemplates - per-node ratio templates", () => {
  test("all four ratio templates are registered", () => {
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
    "$id is a per-node ($aggregation/$aggregation) ratio keyed on resource.k8s.node.name",
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
       * Decision (1): group by the resource-prefixed node attribute on BOTH
       * queries so the per-series fingerprints line up for the formula join.
       */
      expect(numerator.metricQueryData.groupByAttributeKeys).toEqual([
        "resource.k8s.node.name",
      ]);
      expect(denominator.metricQueryData.groupByAttributeKeys).toEqual([
        "resource.k8s.node.name",
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
      expect(offlineFilters[0].value).toBe(tc.threshold);
    },
  );
});
