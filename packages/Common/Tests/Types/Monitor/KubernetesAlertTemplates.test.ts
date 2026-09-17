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
import RollingTime from "../../../Types/RollingTime/RollingTime";
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
 *        - The HPA saturation ratio is `Avg` (one series per HPA on both
 *          sides). The two POD-LIMIT saturation templates are no longer
 *          ratios at all — they read the kubeletstats receiver's own
 *          `k8s.pod.*_limit_utilization` family, which divides by the SUM
 *          of a pod's container limits instead of the mean a hand-built
 *          ratio against `k8s.container.*_limit` produced. They are
 *          covered by SINGLE_QUERY_SATURATION below.
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
  /*
   * Only set when the template overrides the builder's default
   * `(num / den) * 100`. Node disk usage is the one case: kubeletstats
   * gives no node capacity series this repo ingests, so the percentage
   * is `used / (used + available)`.
   */
  formula?: string | undefined;
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
  /*
   * Node disk fill — Avg/Avg, and the ONE template with a non-default
   * formula. `k8s.node.filesystem.usage` is bytes, so comparing it to 90
   * fired on every node forever; the percentage is built from the
   * companion `k8s.node.filesystem.available` on the same kubeletstats
   * node scrape.
   */
  {
    id: "k8s-high-disk-usage",
    numerator: "k8s.node.filesystem.usage",
    denominator: "k8s.node.filesystem.available",
    numAlias: "used_disk",
    denAlias: "avail_disk",
    resultAlias: "disk_usage",
    aggregation: MetricsAggregationType.Avg,
    threshold: 90,
    groupBy: ["resource.k8s.node.name"],
    formula: "(used_disk / (used_disk + avail_disk)) * 100",
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
   * Autoscaling saturation — Avg/Avg, and NOT keyed on the node.
   *
   * The HPA ratio groups per namespace+HPA object. Locking the group-by
   * set here is the point of this case: it was the first ratio template in
   * this file not keyed on `resource.k8s.node.name`, so a copy-paste of
   * the node key would silently collapse every HPA into one mislabeled
   * series that still renders and still alerts.
   *
   * The two POD-LIMIT saturation templates used to live here as ratios.
   * They are single-query now — see SINGLE_QUERY_SATURATION.
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
];

/*
 * The two container-limit saturation templates, which read the
 * kubeletstats receiver's OWN saturation family instead of rebuilding it.
 *
 * They were ratios of `k8s.pod.<x>.usage` (kubeletstats, one series per
 * POD) over `k8s.container.<x>_limit` (k8s_cluster, one series per
 * CONTAINER) joined by series fingerprint across two independent scrape
 * cycles. That had two defects this table exists to keep fixed:
 *
 *   - `Avg` over a per-container denominator takes the MEAN container
 *     limit, not their sum, so every pod with a sidecar over-reported its
 *     saturation by roughly its container count.
 *   - a cross-receiver fingerprint join fails SILENTLY: the formula
 *     evaluates against an empty operand and the monitor simply stops
 *     alerting.
 */
interface SingleQuerySaturationCase {
  id: string;
  metricName: string;
  metricAlias: string;
  aggregation: MetricsAggregationType;
  threshold: number;
  groupBy: Array<string>;
}

const SINGLE_QUERY_SATURATION: Array<SingleQuerySaturationCase> = [
  {
    id: "k8s-pod-memory-limit-saturation",
    metricName: "k8s.pod.memory_limit_utilization",
    metricAlias: "pod_memory_limit_saturation",
    aggregation: MetricsAggregationType.Max,
    threshold: 90,
    groupBy: ["resource.k8s.namespace.name", "resource.k8s.pod.name"],
  },
  {
    id: "k8s-pod-cpu-limit-saturation",
    metricName: "k8s.pod.cpu_limit_utilization",
    metricAlias: "pod_cpu_limit_saturation",
    aggregation: MetricsAggregationType.Max,
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
        tc.formula || `(${tc.numAlias} / ${tc.denAlias}) * 100`,
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

  test.each(SINGLE_QUERY_SATURATION)(
    "$id reads the receiver's own saturation metric, not a hand-built ratio",
    (tc: SingleQuerySaturationCase) => {
      const monitor: MonitorStepKubernetesMonitor = getKubernetesMonitor(
        getStep(tc.id),
      );

      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      const formulaConfigs: Array<any> = monitor.metricViewConfig
        .formulaConfigs as Array<any>;

      /*
       * ONE query and NO formula. A second query here means someone
       * reintroduced the cross-receiver ratio, whose fingerprint join
       * fails silently and whose Avg denominator is the MEAN of a pod's
       * container limits rather than their sum.
       */
      expect(queryConfigs).toHaveLength(1);
      expect(formulaConfigs).toHaveLength(0);

      const [query] = queryConfigs;

      expect(query.metricQueryData.filterData.metricName).toBe(tc.metricName);
      expect(query.metricQueryData.filterData.aggegationType).toBe(
        tc.aggregation,
      );
      expect(query.metricQueryData.groupByAttributeKeys).toEqual(tc.groupBy);

      /*
       * THE assertion that keeps this template alerting at all.
       *
       * kubeletstats reports the `*_limit_utilization` family with UCUM
       * unit "1" — a 0-1 fraction. MetricUnitUtil puts "1" in the percent
       * family with `toCanonical: 100`, and MetricResultUnitConverter
       * (invoked on the monitor path before the criteria are compared)
       * only rescales when the alias declares a display unit. Drop this
       * "%" and the values stay in [0, 1], the "> 90" threshold below is
       * never reachable, and the monitor goes SILENT rather than loud.
       */
      expect(query.metricAliasData.legendUnit).toBe("%");

      const [offline, online] = getCriteriaInstances(tc.id);
      const offlineFilter: any = offline.data.filters[0];
      const onlineFilter: any = online.data.filters[0];

      // The criteria compare the query alias — there is no formula alias now.
      expect(offlineFilter.metricMonitorOptions.metricAlias).toBe(
        tc.metricAlias,
      );
      expect(onlineFilter.metricMonitorOptions.metricAlias).toBe(
        tc.metricAlias,
      );
      expect(offlineFilter.value).toBe(tc.threshold);

      /*
       * Dead-band coverage these two ids used to get from RATIO_TEMPLATES.
       * Removing them from that table must not quietly drop it.
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
    },
  );

  test("the memory saturation alert does not promise an OOMKill the metric cannot support", () => {
    /*
     * `k8s.pod.memory_limit_utilization` divides the kubelet's pod memory
     * figure, which INCLUDES reclaimable page cache, by the pod's limit.
     * The kubelet's kill decision is on working set, so a file-heavy
     * workload can sit at 95% here indefinitely without ever being
     * OOMKilled. The old copy asserted the opposite as a certainty.
     */
    const description: string = getIncidentDescription(
      "k8s-pod-memory-limit-saturation",
    );

    expect(description).not.toContain(
      "OOMKills a container the moment it crosses its limit",
    );
    expect(description).not.toContain("immediately preceding a restart");
  });
});

/*
 * ---------------------------------------------------------------------
 * Regression guards for template/metric mismatches.
 *
 * Every test below is named for a specific shipped defect. Each one fails
 * if that defect is reintroduced, not merely if a value changes.
 * ---------------------------------------------------------------------
 */

function getStep(id: string): MonitorStep {
  const template: KubernetesAlertTemplate | undefined =
    getKubernetesAlertTemplateById(id);

  if (!template) {
    throw new Error(`Kubernetes alert template ${id} is not registered`);
  }

  return template.getMonitorStep(buildArgs());
}

function getCriteriaInstances(id: string): Array<any> {
  return getStep(id).data?.monitorCriteria.data
    ?.monitorCriteriaInstanceArray as Array<any>;
}

function getIncidentDescription(id: string): string {
  const [offline] = getCriteriaInstances(id);

  return offline.data.incidents[0].description as string;
}

function getQueryConfigs(id: string): Array<any> {
  return getKubernetesMonitor(getStep(id)).metricViewConfig
    .queryConfigs as Array<any>;
}

describe("KubernetesAlertTemplates - metric/criteria agreement", () => {
  /*
   * BUG: k8s-high-disk-usage handed `k8s.node.filesystem.usage` — declared
   * `unit: "bytes"` in KubernetesMetricCatalog, and never converted, since
   * the query carried no legendUnit — straight to a `> 90` comparison. So
   * "more than 90 BYTES used" was true for every node on its very first
   * evaluation, and the healthy criterion ("90 bytes or less") was
   * unreachable: a permanently red monitor with an incident that could
   * never resolve.
   */
  test("k8s-high-disk-usage never compares raw bytes to a percentage threshold", () => {
    const monitor: MonitorStepKubernetesMonitor = getKubernetesMonitor(
      getStep("k8s-high-disk-usage"),
    );

    const queryConfigs: Array<any> = monitor.metricViewConfig
      .queryConfigs as Array<any>;
    const formulaConfigs: Array<any> = monitor.metricViewConfig
      .formulaConfigs as Array<any>;

    // A percentage has to be COMPUTED — there is no ready-made series.
    expect(queryConfigs).toHaveLength(2);
    expect(formulaConfigs).toHaveLength(1);

    /*
     * There is no `k8s.node.filesystem.capacity` anywhere in this repo, so
     * the denominator is `usage + available` — the same figure `df`
     * reports as Use%, and the same one the cluster dashboard charts.
     */
    expect(formulaConfigs[0].metricFormulaData.metricFormula).toBe(
      "(used_disk / (used_disk + avail_disk)) * 100",
    );
    expect(formulaConfigs[0].metricAliasData.legendUnit).toBe("%");

    const [offline, online] = getCriteriaInstances("k8s-high-disk-usage");

    /*
     * The threshold must be compared against the FORMULA's alias. Pointing
     * it at a raw query alias is exactly how the bytes-vs-90 comparison
     * happened.
     */
    for (const filter of [offline.data.filters[0], online.data.filters[0]]) {
      expect(filter.metricMonitorOptions.metricAlias).toBe("disk_usage");
      expect(
        queryConfigs.map((q: any) => {
          return q.metricAliasData.metricVariable;
        }),
      ).not.toContain(filter.metricMonitorOptions.metricAlias);
    }
  });

  /*
   * BUG: k8s-pod-pending filtered on `attributes: { "resource.k8s.pod.phase":
   * "Pending" }`. Nothing emits that attribute — not the k8s_cluster
   * receiver, not the agent's k8sattributes processor, not the ingest path
   * — and the worker copies the map verbatim into the ClickHouse
   * predicate. The query matched ZERO rows forever: the monitor never
   * fired, never resolved, and never reported that it was watching
   * nothing.
   */
  describe("k8s-pod-pending", () => {
    test("carries no attribute filter", () => {
      const [query] = getQueryConfigs("k8s-pod-pending");

      expect(query.metricQueryData.filterData.attributes).toEqual({});
    });

    test("selects the Pending phase by VALUE, not by a label that does not exist", () => {
      /*
       * `k8s.pod.phase` encodes the phase in the value: 1 = Pending,
       * 2 = Running, 3 = Succeeded, 4 = Failed, 5 = Unknown.
       */
      const [offline, online] = getCriteriaInstances("k8s-pod-pending");
      const offlineFilter: any = offline.data.filters[0];
      const onlineFilter: any = online.data.filters[0];

      expect(offlineFilter.metricMonitorOptions.metricAlias).toBe(
        "min_pod_phase",
      );
      expect(offlineFilter.filterType).toBe(FilterType.EqualTo);
      expect(offlineFilter.value).toBe(1);

      /*
       * NotEqualTo, not GreaterThan. An equality comparison gets NO
       * recovery dead band (getRecoveryThreshold returns undefined), so
       * the recovery value stays exactly 1. GreaterThan would complement
       * to LessThanOrEqualTo and derive 1.1 — a fractional edge on a
       * metric whose values are an enum.
       */
      expect(onlineFilter.metricMonitorOptions.metricAlias).toBe(
        "min_pod_phase",
      );
      expect(onlineFilter.filterType).toBe(FilterType.NotEqualTo);
      expect(onlineFilter.value).toBe(1);
    });

    test("aggregates with Min, not Sum", () => {
      /*
       * Pending is the LOWEST phase code, so a cluster-wide Min is exactly
       * 1 when at least one pod is Pending. `Sum` also walked into the
       * trap DashboardTemplates.ts documents: a per-resource gauge
       * re-emitted every scrape sums to (pods x scrapes).
       */
      const [query] = getQueryConfigs("k8s-pod-pending");

      expect(query.metricQueryData.filterData.aggegationType).toBe(
        MetricsAggregationType.Min,
      );
      expect(query.metricQueryData.filterData.metricName).toBe("k8s.pod.phase");
    });
  });

  /*
   * BUG: k8s-apiserver-throttling summed `apiserver_dropped_requests_total`,
   * a cumulative Prometheus counter, against `> 0`. Nothing in the shipped
   * pipeline converts counters to deltas (no cumulativetodelta processor,
   * no Rate/Delta member on AggregationType or on
   * CompareCriteria.reduceWindow), so every sample was the API server's
   * LIFETIME total. One throttled request since the process started pinned
   * the monitor Offline forever.
   */
  test("k8s-apiserver-throttling does not alert on a cumulative counter", () => {
    const [query] = getQueryConfigs("k8s-apiserver-throttling");
    const metricName: string = query.metricQueryData.filterData
      .metricName as string;

    expect(metricName).toBe("apiserver_current_inflight_requests");
    expect(metricName.endsWith("_total")).toBe(false);
    expect(query.metricQueryData.filterData.aggegationType).toBe(
      MetricsAggregationType.Max,
    );

    const [offline, online] = getCriteriaInstances("k8s-apiserver-throttling");
    const offlineFilter: any = offline.data.filters[0];
    const onlineFilter: any = online.data.filters[0];

    /*
     * GreaterThanOrEqualTo, not GreaterThan. This gauge counts ADMITTED
     * concurrency, so it is bounded above by the API server's own
     * admission limit and saturates AT it. 200 is the default
     * --max-mutating-requests-inflight exactly, so "> 200" would ask the
     * mutating queue to exceed its own ceiling and never fire.
     */
    expect(offlineFilter.filterType).toBe(FilterType.GreaterThanOrEqualTo);
    expect(offlineFilter.value).toBe(200);
    expect(onlineFilter.filterType).toBe(FilterType.LessThan);
    // 10% dead band inside the firing threshold.
    expect(onlineFilter.value).toBe(180);
  });

  /*
   * Generalisation of the counter bug above: nothing in the query path can
   * differentiate a monotonic counter, so a `_total` series compared
   * against a fixed threshold can never satisfy its own recovery
   * criterion. If a future template needs one, it needs a Rate/Delta
   * aggregation first.
   */
  test("no template thresholds a cumulative `_total` counter", () => {
    for (const template of getAllKubernetesAlertTemplates()) {
      for (const query of getQueryConfigs(template.id)) {
        const metricName: string = query.metricQueryData.filterData
          .metricName as string;

        expect(`${template.id}:${metricName}`).not.toMatch(/_total$/);
      }
    }
  });

  /*
   * BUG: every template's query attributes are copied verbatim into the
   * ClickHouse predicate, so an attribute key nothing stamps silently
   * reduces the query to zero rows. No template needs one today; a future
   * one must add its key here deliberately, having checked the agent
   * actually emits it.
   */
  test("no template filters on an attribute the agent does not stamp", () => {
    const ALLOWED_ATTRIBUTE_KEYS: Set<string> = new Set<string>();

    for (const template of getAllKubernetesAlertTemplates()) {
      for (const query of getQueryConfigs(template.id)) {
        const attributes: Record<string, string> =
          query.metricQueryData.filterData.attributes || {};

        for (const key of Object.keys(attributes)) {
          expect(`${template.id} filters on ${key}`).toBe(
            ALLOWED_ATTRIBUTE_KEYS.has(key)
              ? `${template.id} filters on ${key}`
              : "an attribute key on the allowlist",
          );
        }
      }
    }
  });

  /*
   * BUG: k8s-crashloopbackoff's criteria copy said restarts "exceeds 5 in
   * the monitoring window". `k8s.container.restarts` is
   * containerStatus.restartCount — monotonic for the pod object's life —
   * and `Max` over a monotonic series is just the counter, so no per-window
   * count is computed anywhere.
   */
  test("k8s-crashloopbackoff does not claim a per-window restart count", () => {
    const [offline] = getCriteriaInstances("k8s-crashloopbackoff");
    const [query] = getQueryConfigs("k8s-crashloopbackoff");

    // The configuration that makes the old wording false is still in place.
    expect(query.metricQueryData.filterData.metricName).toBe(
      "k8s.container.restarts",
    );
    expect(query.metricQueryData.filterData.aggegationType).toBe(
      MetricsAggregationType.Max,
    );

    expect(offline.data.description).not.toContain("in the monitoring window");
    expect(offline.data.description).toContain("cumulative");
  });

  /*
   * BUG: k8s-daemonset-unavailable queries
   * `k8s.daemonset.misscheduled_nodes` — which KubernetesMetricCatalog
   * defines as "nodes running a daemon pod that should NOT be running one"
   * — while its name, alias, description, incident title and criteria name
   * all said "unavailable", i.e. the opposite condition. An engineer paged
   * for a stale node selector went looking for a missing DaemonSet.
   *
   * The `id` deliberately keeps the old word: it is the stable key the
   * recommendation diff matches on.
   */
  test("the DaemonSet template's copy matches the metric it queries", () => {
    const template: KubernetesAlertTemplate | undefined =
      getKubernetesAlertTemplateById("k8s-daemonset-unavailable");
    const [query] = getQueryConfigs("k8s-daemonset-unavailable");
    const [offline] = getCriteriaInstances("k8s-daemonset-unavailable");

    expect(query.metricQueryData.filterData.metricName).toBe(
      "k8s.daemonset.misscheduled_nodes",
    );

    for (const text of [
      template!.name,
      template!.description,
      offline.data.incidents[0].title as string,
      offline.data.name as string,
    ]) {
      expect(text.toLowerCase()).not.toContain("unavailable");
    }

    // And the alias no longer misnames the value either.
    expect(query.metricAliasData.metricVariable).toBe("misscheduled_nodes");
    expect(offline.data.filters[0].metricMonitorOptions.metricAlias).toBe(
      "misscheduled_nodes",
    );
  });

  /*
   * BUG: the three control-plane templates are offered in the picker but
   * collect nothing on a default agent install — the chart's prometheus
   * receiver and all three scrape jobs are wrapped in
   * `{{- if .Values.controlPlane.enabled }}`, and values.yaml ships
   * `controlPlane: { enabled: false }`. A one-click monitor that is never
   * Met, with no indication it is inert.
   */
  test("every ControlPlane template says it needs the control-plane scrape", () => {
    const controlPlaneTemplates: Array<KubernetesAlertTemplate> =
      getAllKubernetesAlertTemplates().filter((t: KubernetesAlertTemplate) => {
        return t.category === "ControlPlane";
      });

    expect(controlPlaneTemplates.length).toBeGreaterThan(0);

    for (const template of controlPlaneTemplates) {
      expect(template.description).toContain("controlPlane.enabled");
    }
  });

  /*
   * The recommendation card renders `template.description` as raw JSX
   * text, not markdown (KubernetesTemplatePicker), so a code span would
   * show up as literal backticks.
   */
  test("no template description uses markdown code spans", () => {
    for (const template of getAllKubernetesAlertTemplates()) {
      expect(`${template.id}: ${template.description}`).not.toContain("`");
    }
  });
});

/*
 * The rolling window is load-bearing now that the FIRE side defaults to
 * EvaluateOverTimeType.AllValues: every per-minute bucket in the window
 * must breach, so the window IS the "how long has this been true" knob.
 * Nothing else guards these, and shortening one silently reintroduces the
 * page-on-every-deploy behaviour.
 */
describe("KubernetesAlertTemplates - deliberate rolling windows", () => {
  const ROLLING_WINDOWS: Array<{
    id: string;
    window: RollingTime;
    why: string;
  }> = [
    {
      id: "k8s-deployment-replica-mismatch",
      window: RollingTime.Past15Minutes,
      why: "must outlast a normal rolling update, or it pages once per deploy",
    },
    {
      id: "k8s-pod-pending",
      window: RollingTime.Past15Minutes,
      why: "must outlast normal scheduling; a few seconds Pending is not stuck",
    },
    {
      id: "k8s-etcd-no-leader",
      window: RollingTime.Past1Minute,
      why: "a single lost leader is itself the incident",
    },
  ];

  test.each(ROLLING_WINDOWS)(
    "$id watches $window because $why",
    (tc: { id: string; window: RollingTime; why: string }) => {
      expect(getKubernetesMonitor(getStep(tc.id)).rollingTime).toBe(tc.window);
    },
  );
});

/*
 * BUG: eleven incident descriptions said "Check the root cause for the
 * specific <thing>". On a GROUPED monitor that is false. A per-series
 * match's rootCause is nothing but the concatenated compare lines
 * (MonitorCriteriaEvaluator.collectPerSeriesMatches sets
 * `rootCause: rootCauseLines.join("\n")`); the RICH root cause carrying the
 * pod/node/container table is only written to the SCALAR response, which
 * is used when there is NO series match. The identity the sentence
 * promised is in the alert one field lower, under the "Affected resource"
 * and "Start here" headings SeriesContextEnricher appends to the
 * description — so the reader was being sent to the wrong row of the
 * email.
 */
describe("KubernetesAlertTemplates - grouped alerts point at the right field", () => {
  function isGrouped(id: string): boolean {
    return getQueryConfigs(id).some((query: any) => {
      return (query.metricQueryData.groupByAttributeKeys || []).length > 0;
    });
  }

  test("at least one template is grouped (guards the guard)", () => {
    expect(
      getAllKubernetesAlertTemplates().filter((t: KubernetesAlertTemplate) => {
        return isGrouped(t.id);
      }).length,
    ).toBeGreaterThan(5);
  });

  test("no grouped template sends the reader to the root cause for identity", () => {
    for (const template of getAllKubernetesAlertTemplates()) {
      if (!isGrouped(template.id)) {
        continue;
      }

      for (const instance of getCriteriaInstances(template.id)) {
        for (const alert of instance.data?.alerts || []) {
          expect(`${template.id}: ${alert.description}`).not.toMatch(
            /root cause/i,
          );
        }
        for (const incident of instance.data?.incidents || []) {
          expect(`${template.id}: ${incident.description}`).not.toMatch(
            /root cause/i,
          );
        }
      }
    }
  });
});
