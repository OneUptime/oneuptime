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
 * These tests lock in two subtle, easy-to-regress decisions in the node
 * request-utilization templates:
 *
 *   1. Group-by uses the ClickHouse-stored `resource.`-prefixed attribute
 *      name (`resource.k8s.node.name`), not the bare `k8s.node.name`.
 *      OneUptime stamps OTel resource attributes with a `resource.` prefix
 *      at ingest, so the bare key would match nothing and collapse every
 *      node into one mislabeled series.
 *
 *   2. BOTH the numerator and denominator queries aggregate with `Sum`.
 *      The per-series worker buckets raw rows by (node, minute) and sums
 *      every row in the bucket, counting each series once per scrape.
 *      Using Sum on both sides makes the scrape multiple cancel in the
 *      ratio. Any other aggregation on the denominator would leave the
 *      scrape factor in and inflate the percentage.
 */

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

describe("KubernetesAlertTemplates - node request utilization", () => {
  test("both node request-utilization templates are registered", () => {
    const ids: Array<string> = getAllKubernetesAlertTemplates().map(
      (t: KubernetesAlertTemplate) => {
        return t.id;
      },
    );
    expect(ids).toContain("k8s-node-cpu-request-utilization");
    expect(ids).toContain("k8s-node-memory-request-utilization");
  });

  test.each([
    {
      id: "k8s-node-cpu-request-utilization",
      numerator: "k8s.container.cpu_request",
      denominator: "k8s.node.allocatable_cpu",
      numAlias: "req_cpu",
      denAlias: "alloc_cpu",
      resultAlias: "node_cpu_request_utilization",
    },
    {
      id: "k8s-node-memory-request-utilization",
      numerator: "k8s.container.memory_request",
      denominator: "k8s.node.allocatable_memory",
      numAlias: "req_mem",
      denAlias: "alloc_mem",
      resultAlias: "node_memory_request_utilization",
    },
  ])(
    "$id derives a per-node ratio with Sum/Sum and the resource-prefixed node key",
    (tc: {
      id: string;
      numerator: string;
      denominator: string;
      numAlias: string;
      denAlias: string;
      resultAlias: string;
    }) => {
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

      // Decision (2): both sides aggregate with Sum so the scrape factor cancels.
      expect(numerator.metricQueryData.filterData.aggegationType).toBe(
        MetricsAggregationType.Sum,
      );
      expect(denominator.metricQueryData.filterData.aggegationType).toBe(
        MetricsAggregationType.Sum,
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
       * The criteria must reference the FORMULA alias (not a raw query), so
       * the threshold is evaluated against the computed percentage.
       */
      const offlineFilters: Array<any> = step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray?.[0]?.data?.filters as Array<any>;
      expect(offlineFilters[0].metricMonitorOptions.metricAlias).toBe(
        tc.resultAlias,
      );
      expect(offlineFilters[0].value).toBe(90);
    },
  );
});
