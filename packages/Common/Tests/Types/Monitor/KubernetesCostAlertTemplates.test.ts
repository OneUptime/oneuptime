import {
  KUBERNETES_CLUSTER_DAILY_COST_BUDGET,
  KUBERNETES_IDLE_COST_SHARE_THRESHOLD,
  KUBERNETES_NAMESPACE_DAILY_COST_BUDGET,
  KubernetesAlertTemplate,
  KubernetesAlertTemplateArgs,
  getAllKubernetesAlertTemplates,
  getKubernetesAlertTemplateById,
  getKubernetesAlertTemplatesByCategory,
} from "../../../Types/Monitor/KubernetesAlertTemplates";
import {
  KubernetesMetricDefinition,
  getKubernetesMetricByMetricName,
  getKubernetesMetricCategoryLabel,
  getKubernetesMetricsByCategory,
} from "../../../Types/Monitor/KubernetesMetricCatalog";
import {
  KUBERNETES_COST_METRICS,
  KubernetesCostMetric,
} from "../../../Types/Kubernetes/KubernetesCostMetrics";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepKubernetesMonitor, {
  KubernetesResourceScope,
} from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import {
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../Types/ObjectID";
import {
  SamplesByAlias,
  evaluateTemplateCriteria,
} from "./Utils/TemplateCriteriaEvaluation";
import { AGENT_EMITTED_METRIC_NAMES } from "./Utils/KubernetesAgentEmittedMetrics";
import { hasRecoveryDeadBand } from "./Utils/RecommendationCriteriaAssertions";
import { describe, expect, test } from "@jest/globals";

/*
 * The Kubernetes cost templates (#9548): a cluster or a namespace over its
 * daily budget, and a cluster paying for capacity nothing uses. They read
 * the metrics OneUptime writes from the cost agent's hourly allocations -
 * one point per hour - so each watches the past day and adds up its hours.
 */

const COST_TEMPLATE_IDS: Array<string> = [
  "k8s-cluster-daily-cost",
  "k8s-namespace-daily-cost",
  "k8s-high-idle-cost",
];

// The minutes in the template's window, the past day.
const ONE_DAY_IN_MINUTES: number = 24 * 60;

function buildArgs(): KubernetesAlertTemplateArgs {
  return {
    clusterIdentifier: "prod-cluster",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Prod Cost",
  };
}

function getTemplate(id: string): KubernetesAlertTemplate {
  const template: KubernetesAlertTemplate | undefined =
    getKubernetesAlertTemplateById(id);

  if (!template) {
    throw new Error(`${id} is not registered`);
  }

  return template;
}

function getStep(id: string): MonitorStep {
  return getTemplate(id).getMonitorStep(buildArgs());
}

function getMonitor(id: string): MonitorStepKubernetesMonitor {
  return getStep(id).data!.kubernetesMonitor!;
}

function getCriteria(id: string): Array<any> {
  return getStep(id).data!.monitorCriteria.data!
    .monitorCriteriaInstanceArray as Array<any>;
}

function hours(count: number, value: number): Array<number> {
  return Array.from({ length: count }, (): number => {
    return value;
  });
}

function evaluate(
  id: string,
  samplesByAlias: SamplesByAlias,
): Promise<{ breached: boolean; healthy: boolean }> {
  return evaluateTemplateCriteria({
    step: getStep(id),
    viewConfig: getMonitor(id).metricViewConfig,
    samplesByAlias: samplesByAlias,
    windowMinutes: ONE_DAY_IN_MINUTES,
  });
}

describe("the Kubernetes cost templates", () => {
  test("are three Warning templates under Cost, listed after every other", () => {
    const all: Array<string> = getAllKubernetesAlertTemplates().map(
      (template: KubernetesAlertTemplate): string => {
        return template.id;
      },
    );

    expect(all.slice(-3)).toEqual(COST_TEMPLATE_IDS);
    expect(
      getKubernetesAlertTemplatesByCategory("Cost").map(
        (template: KubernetesAlertTemplate): string => {
          return template.id;
        },
      ),
    ).toEqual(COST_TEMPLATE_IDS);

    for (const id of COST_TEMPLATE_IDS) {
      expect(getTemplate(id).severity).toBe("Warning");
    }
  });

  test.each(COST_TEMPLATE_IDS)(
    "%s reads only the cost metrics, which the catalog names with a unit",
    (id: string) => {
      for (const query of getMonitor(id).metricViewConfig.queryConfigs) {
        const metricName: string = query.metricQueryData.filterData
          .metricName as string;
        const entry: KubernetesMetricDefinition | undefined =
          getKubernetesMetricByMetricName(metricName);

        expect(KUBERNETES_COST_METRICS).toContain(metricName);
        expect(AGENT_EMITTED_METRIC_NAMES.has(metricName)).toBe(true);
        expect(entry?.category).toBe("Cost");
        expect(entry?.unit).toBeTruthy();
      }
    },
  );

  test.each(COST_TEMPLATE_IDS)(
    "%s watches the past day and adds each hour up",
    (id: string) => {
      const monitor: MonitorStepKubernetesMonitor = getMonitor(id);

      expect(monitor.rollingTime).toBe(RollingTime.Past1Hours);
      expect(RollingTime.Past1Hours as string).toBe("Past 1 Day");

      for (const query of monitor.metricViewConfig.queryConfigs) {
        expect(query.metricQueryData.filterData.aggegationType).toBe(
          MetricsAggregationType.Sum,
        );
      }
    },
  );

  test.each(COST_TEMPLATE_IDS)(
    "%s says it needs cost monitoring, and where it is off by default",
    (id: string) => {
      const description: string = getTemplate(id).description;

      expect(description).toContain("cost monitoring");
      expect(description).toContain("gke-autopilot");
      expect(description).toContain("eks-fargate");
      // Drawn as text: a code span would show its backticks.
      expect(description).not.toContain("`");
    },
  );

  /*
   * Recovery sits a real distance back from the threshold (the shared dead
   * band), so a day hovering at the budget does not page and clear on
   * alternate evaluations.
   */
  test.each(COST_TEMPLATE_IDS)(
    "%s recovers only a dead band below where it fires, read the same way",
    (id: string) => {
      const [offline, online] = getCriteria(id);
      const firing: any = offline.data.filters[0];
      const recovering: any = online.data.filters[0];

      expect(firing.filterType).toBe(FilterType.GreaterThan);
      expect(recovering.filterType).toBe(FilterType.LessThanOrEqualTo);
      expect(
        hasRecoveryDeadBand(
          { filterType: firing.filterType, value: firing.value },
          { filterType: recovering.filterType, value: recovering.value },
        ),
      ).toBe(true);
      expect(recovering.value).toBeLessThan(firing.value);
      expect(recovering.metricMonitorOptions.metricAggregationType).toBe(
        firing.metricMonitorOptions.metricAggregationType,
      );
    },
  );

  test("each names its threshold in its summary, and in the incident it opens", () => {
    const thresholds: Record<string, number> = {
      "k8s-cluster-daily-cost": KUBERNETES_CLUSTER_DAILY_COST_BUDGET,
      "k8s-namespace-daily-cost": KUBERNETES_NAMESPACE_DAILY_COST_BUDGET,
      "k8s-high-idle-cost": KUBERNETES_IDLE_COST_SHARE_THRESHOLD,
    };

    for (const id of COST_TEMPLATE_IDS) {
      const threshold: string = String(thresholds[id]);
      const [offline] = getCriteria(id);

      expect(getTemplate(id).summary).toContain(threshold);
      expect(offline.data.filters[0].value).toBe(thresholds[id]);
      expect(offline.data.incidents[0].title).toContain(threshold);
      expect(offline.data.incidents[0].title).toContain("Prod Cost");
    }
  });
});

describe("Cluster Daily Cost Over Budget", () => {
  test("sums the cluster's cost, per cluster, against a budget to set", () => {
    const monitor: MonitorStepKubernetesMonitor = getMonitor(
      "k8s-cluster-daily-cost",
    );
    const [query] = monitor.metricViewConfig.queryConfigs;

    expect(monitor.resourceScope).toBe(KubernetesResourceScope.Cluster);
    expect(query!.metricQueryData.filterData.metricName).toBe(
      KubernetesCostMetric.Total,
    );
    expect(query!.metricQueryData.groupByAttributeKeys).toEqual([
      "resource.k8s.cluster.name",
    ]);
    expect(
      getCriteria("k8s-cluster-daily-cost")[0].data.filters[0]
        .metricMonitorOptions.metricAggregationType,
    ).toBe(EvaluateOverTimeType.Sum);
    expect(getTemplate("k8s-cluster-daily-cost").summary).toContain(
      "set to your own",
    );
  });

  test("fires when a day of hours adds up past the budget", async () => {
    // 24 hours at 5 is 120, past the budget of 100.
    expect(
      await evaluate("k8s-cluster-daily-cost", { cluster_cost: hours(24, 5) }),
    ).toEqual({ breached: true, healthy: false });
  });

  test("is healthy when the day adds up to well under the budget", async () => {
    // 22 hours arrived (the newest are on their way) at 4: 88.
    expect(
      await evaluate("k8s-cluster-daily-cost", { cluster_cost: hours(22, 4) }),
    ).toEqual({ breached: false, healthy: true });
  });

  test("keeps its status in the dead band just under the budget", async () => {
    // 99: under the budget, not yet far enough under it to recover.
    expect(
      await evaluate("k8s-cluster-daily-cost", {
        cluster_cost: hours(22, 4.5),
      }),
    ).toEqual({ breached: false, healthy: false });
  });

  test("does not fire at exactly the budget", async () => {
    expect(
      await evaluate("k8s-cluster-daily-cost", { cluster_cost: hours(20, 5) }),
    ).toEqual({ breached: false, healthy: false });
  });
});

describe("Namespace Daily Cost Over Budget", () => {
  test("sums the workloads' cost per namespace, one incident each", () => {
    const monitor: MonitorStepKubernetesMonitor = getMonitor(
      "k8s-namespace-daily-cost",
    );
    const [query] = monitor.metricViewConfig.queryConfigs;

    expect(monitor.resourceScope).toBe(KubernetesResourceScope.Namespace);
    expect(query!.metricQueryData.filterData.metricName).toBe(
      KubernetesCostMetric.Workload,
    );
    expect(query!.metricQueryData.groupByAttributeKeys).toEqual([
      "resource.k8s.namespace.name",
    ]);
  });

  test("fires for a namespace whose day passes its budget, and not for one under it", async () => {
    expect(
      await evaluate("k8s-namespace-daily-cost", {
        namespace_cost: hours(24, 1),
      }),
    ).toEqual({ breached: true, healthy: false });
    expect(
      await evaluate("k8s-namespace-daily-cost", {
        namespace_cost: hours(24, 0.5),
      }),
    ).toEqual({ breached: false, healthy: true });
    // 19.2: under the budget, inside its dead band.
    expect(
      await evaluate("k8s-namespace-daily-cost", {
        namespace_cost: hours(24, 0.8),
      }),
    ).toEqual({ breached: false, healthy: false });
  });

  test("names the namespace where the alert puts it, not in its root cause", () => {
    const [offline] = getCriteria("k8s-namespace-daily-cost");

    expect(offline.data.incidents[0].description).toContain(
      "Affected resource",
    );
    expect(offline.data.incidents[0].description).not.toMatch(/root cause/i);
  });
});

describe("High Idle Spend", () => {
  test("divides idle cost by the cluster's cost, hour by hour, in percent", () => {
    const monitor: MonitorStepKubernetesMonitor =
      getMonitor("k8s-high-idle-cost");
    const queries: Array<any> = monitor.metricViewConfig.queryConfigs;
    const formulas: Array<any> = monitor.metricViewConfig.formulaConfigs;

    expect(
      queries.map((query: any): [string, string] => {
        return [
          query.metricAliasData.metricVariable,
          query.metricQueryData.filterData.metricName,
        ];
      }),
    ).toEqual([
      ["idle_cost", KubernetesCostMetric.Idle],
      ["cluster_cost", KubernetesCostMetric.Total],
    ]);

    // Both halves meet on the same series key, or the share finds nothing.
    for (const query of queries) {
      expect(query.metricQueryData.groupByAttributeKeys).toEqual([
        "resource.k8s.cluster.name",
      ]);
    }

    expect(formulas).toHaveLength(1);
    expect(formulas[0].metricFormulaData.metricFormula).toBe(
      "(idle_cost / cluster_cost) * 100",
    );
    expect(formulas[0].metricAliasData.legendUnit).toBe("%");
    expect(
      getCriteria("k8s-high-idle-cost")[0].data.filters[0].metricMonitorOptions
        .metricAggregationType,
    ).toBe(EvaluateOverTimeType.Average);
  });

  test("fires when most of the cluster's cost pays for nothing", async () => {
    expect(
      await evaluate("k8s-high-idle-cost", {
        idle_cost: hours(24, 5),
        cluster_cost: hours(24, 10),
      }),
    ).toEqual({ breached: true, healthy: false });
  });

  test("stays quiet at a modest idle share", async () => {
    expect(
      await evaluate("k8s-high-idle-cost", {
        idle_cost: hours(24, 3),
        cluster_cost: hours(24, 10),
      }),
    ).toEqual({ breached: false, healthy: true });
  });

  test("reads an hour with no idle capacity as 0%, which the cost ingest writes", async () => {
    expect(
      await evaluate("k8s-high-idle-cost", {
        idle_cost: hours(24, 0),
        cluster_cost: hours(24, 10),
      }),
    ).toEqual({ breached: false, healthy: true });
  });
});

describe("the cost metrics in the Custom Metric picker", () => {
  test("are a group of their own, headed Cost, in the order the metrics are written", () => {
    expect(getKubernetesMetricCategoryLabel("Cost")).toBe("Cost");
    expect(
      getKubernetesMetricsByCategory("Cost").map(
        (metric: KubernetesMetricDefinition): string => {
          return metric.metricName;
        },
      ),
    ).toEqual([...KUBERNETES_COST_METRICS]);
  });

  test("sum the costs and average efficiency, each in its own unit", () => {
    const byName: Record<string, KubernetesMetricDefinition> = {};

    for (const metric of getKubernetesMetricsByCategory("Cost")) {
      byName[metric.metricName] = metric;
    }

    for (const name of [
      KubernetesCostMetric.Total,
      KubernetesCostMetric.Idle,
      KubernetesCostMetric.Workload,
    ]) {
      expect(byName[name]!.defaultAggregation).toBe(MetricsAggregationType.Sum);
      expect(byName[name]!.unit).toBe("USD");
    }

    expect(byName[KubernetesCostMetric.Efficiency]!.defaultAggregation).toBe(
      MetricsAggregationType.Avg,
    );
    expect(byName[KubernetesCostMetric.Efficiency]!.unit).toBe("%");
  });

  test("scope the cluster's figures to the cluster, and a workload's to a namespace", () => {
    expect(
      getKubernetesMetricByMetricName(KubernetesCostMetric.Total)!
        .defaultResourceScope,
    ).toBe(KubernetesResourceScope.Cluster);
    expect(
      getKubernetesMetricByMetricName(KubernetesCostMetric.Idle)!
        .defaultResourceScope,
    ).toBe(KubernetesResourceScope.Cluster);
    expect(
      getKubernetesMetricByMetricName(KubernetesCostMetric.Workload)!
        .defaultResourceScope,
    ).toBe(KubernetesResourceScope.Namespace);
    expect(
      getKubernetesMetricByMetricName(KubernetesCostMetric.Efficiency)!
        .defaultResourceScope,
    ).toBe(KubernetesResourceScope.Namespace);
  });
});
