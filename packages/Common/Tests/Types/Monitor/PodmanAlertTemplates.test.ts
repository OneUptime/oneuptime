import {
  PodmanAlertTemplate,
  PodmanAlertTemplateArgs,
  PodmanAlertTemplateCategory,
  getAllPodmanAlertTemplates,
  getPodmanAlertTemplateById,
  getPodmanAlertTemplatesByCategory,
} from "../../../Types/Monitor/PodmanAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { getPodmanMetricByMetricName } from "../../../Types/Monitor/PodmanMetricCatalog";
import { hasRecoveryDeadBand } from "./Utils/RecommendationCriteriaAssertions";
import MonitorStepPodmanMonitor from "../../../Types/Monitor/MonitorStepPodmanMonitor";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import {
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../../Types/ObjectID";
import { evaluateTemplateCriteria } from "./Utils/TemplateCriteriaEvaluation";

/*
 * Podman containers emit the same OTel container.* metrics as Docker, so the
 * Podman templates mirror the Docker set. These tests lock in the same three
 * regression-prone decisions (metric name, per-minute aggregation, and the
 * unhealthy/healthy range partition) independently, so a divergence between
 * the two catalogs — a renamed metric or a flipped comparison copied from one
 * into the other — is caught here rather than in production.
 */

interface PodmanTemplateCase {
  id: string;
  category: PodmanAlertTemplateCategory;
  severity: "Critical" | "Warning";
  metricName: string;
  metricAlias: string;
  aggregation: MetricsAggregationType;
  rollingTime: RollingTime;
  offlineFilterType: FilterType;
  onlineFilterType: FilterType;
  threshold: number;
  /*
   * Query/formula shape. A single-metric threshold template has exactly one
   * query and no formula, which is the default; the restart loop
   * differences a lifetime counter and pins its own counts.
   */
  queryCount?: number;
  formulaCount?: number;
}

const PODMAN_TEMPLATES: Array<PodmanTemplateCase> = [
  {
    id: "podman-host-stopped-reporting",
    category: "Availability",
    severity: "Critical",
    // The agent's own container reports it every 30s; see the template.
    metricName: "container.memory.percent",
    metricAlias: "samples_received",
    aggregation: MetricsAggregationType.Count,
    rollingTime: RollingTime.Past10Minutes,
    offlineFilterType: FilterType.LessThan,
    onlineFilterType: FilterType.GreaterThanOrEqualTo,
    threshold: 0,
  },
  {
    id: "podman-high-cpu",
    category: "Resource",
    severity: "Warning",
    metricName: "container.cpu.utilization",
    metricAlias: "container_cpu",
    aggregation: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past5Minutes,
    offlineFilterType: FilterType.GreaterThan,
    onlineFilterType: FilterType.LessThanOrEqualTo,
    threshold: 80,
  },
  {
    id: "podman-high-memory",
    category: "Resource",
    severity: "Warning",
    metricName: "container.memory.percent",
    metricAlias: "container_memory",
    aggregation: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past5Minutes,
    offlineFilterType: FilterType.GreaterThan,
    onlineFilterType: FilterType.LessThanOrEqualTo,
    threshold: 85,
  },
  {
    id: "podman-restart-loop",
    category: "Container",
    severity: "Critical",
    // queryConfigs[0] is the Max half of the per-minute delta pair.
    metricName: "container.restarts",
    // The criteria compare the FORMULA: the restart count's growth.
    metricAlias: "container_restarts",
    aggregation: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past15Minutes,
    queryCount: 2,
    formulaCount: 1,
    offlineFilterType: FilterType.GreaterThan,
    onlineFilterType: FilterType.LessThanOrEqualTo,
    threshold: 3,
  },
  {
    id: "podman-high-pids",
    category: "Container",
    severity: "Warning",
    metricName: "container.pids.count",
    metricAlias: "pids_count",
    aggregation: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    offlineFilterType: FilterType.GreaterThan,
    onlineFilterType: FilterType.LessThanOrEqualTo,
    /*
     * 2000, as Docker's: the cgroup pids controller counts threads too, so
     * 500 was ordinary for a JVM or a Go binary.
     */
    threshold: 2000,
  },
  {
    id: "podman-container-down",
    category: "Container",
    severity: "Critical",
    metricName: "container.uptime",
    metricAlias: "container_uptime",
    aggregation: MetricsAggregationType.Min,
    rollingTime: RollingTime.Past1Minute,
    /*
     * uptime is never 0: the docker_stats receiver scrapes only RUNNING
     * containers, so a stopped one emits nothing rather than a zero, and a
     * running one is never sampled at the instant it started. The fire test
     * is a low-uptime (restart) test, not an equality against zero.
     */
    offlineFilterType: FilterType.LessThan,
    onlineFilterType: FilterType.GreaterThanOrEqualTo,
    threshold: 120,
  },
];

function buildArgs(): PodmanAlertTemplateArgs {
  return {
    hostIdentifier: "podman-host-01",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Podman Monitor",
  };
}

function getPodmanMonitor(step: MonitorStep): MonitorStepPodmanMonitor {
  const podmanMonitor: MonitorStepPodmanMonitor | undefined =
    step.data?.podmanMonitor;
  if (!podmanMonitor) {
    throw new Error("podmanMonitor missing from monitor step");
  }
  return podmanMonitor;
}

describe("PodmanAlertTemplates", () => {
  test("every documented template id is registered and the suite is exhaustive", () => {
    const ids: Array<string> = getAllPodmanAlertTemplates().map(
      (t: PodmanAlertTemplate) => {
        return t.id;
      },
    );
    for (const tc of PODMAN_TEMPLATES) {
      expect(ids).toContain(tc.id);
    }
    expect(ids.sort()).toEqual(
      PODMAN_TEMPLATES.map((t: PodmanTemplateCase) => {
        return t.id;
      }).sort(),
    );
  });

  test("every template id is unique", () => {
    const ids: Array<string> = getAllPodmanAlertTemplates().map(
      (t: PodmanAlertTemplate) => {
        return t.id;
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("getPodmanAlertTemplateById returns undefined for an unknown id", () => {
    expect(getPodmanAlertTemplateById("does-not-exist")).toBeUndefined();
  });

  test("getPodmanAlertTemplatesByCategory partitions the catalog by category", () => {
    const all: Array<PodmanAlertTemplate> = getAllPodmanAlertTemplates();
    const categories: Array<PodmanAlertTemplateCategory> = [
      "Availability",
      "Container",
      "Resource",
      "Host",
    ];

    let total: number = 0;
    for (const category of categories) {
      const inCategory: Array<PodmanAlertTemplate> =
        getPodmanAlertTemplatesByCategory(category);
      for (const template of inCategory) {
        expect(template.category).toBe(category);
      }
      total += inCategory.length;
    }
    expect(total).toBe(all.length);
  });

  test.each(PODMAN_TEMPLATES)(
    "$id is a $severity $category template with populated copy",
    (tc: PodmanTemplateCase) => {
      const template: PodmanAlertTemplate | undefined =
        getPodmanAlertTemplateById(tc.id);
      expect(template).toBeDefined();
      expect(template!.category).toBe(tc.category);
      expect(template!.severity).toBe(tc.severity);
      expect(template!.name.length).toBeGreaterThan(0);
      expect(template!.description.length).toBeGreaterThan(0);
    },
  );

  test.each(PODMAN_TEMPLATES)(
    "$id queries $metricName with the intended aggregation and window",
    (tc: PodmanTemplateCase) => {
      const template: PodmanAlertTemplate = getPodmanAlertTemplateById(tc.id)!;
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const monitor: MonitorStepPodmanMonitor = getPodmanMonitor(step);

      expect(monitor.hostIdentifier).toBe("podman-host-01");

      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      expect(queryConfigs).toHaveLength(tc.queryCount ?? 1);
      expect(monitor.metricViewConfig.formulaConfigs).toHaveLength(
        tc.formulaCount ?? 0,
      );

      const filterData: any = queryConfigs[0].metricQueryData.filterData;
      expect(filterData.metricName).toBe(tc.metricName);
      expect(filterData.aggegationType).toBe(tc.aggregation);
      expect(monitor.rollingTime).toBe(tc.rollingTime);
    },
  );

  test.each(PODMAN_TEMPLATES)(
    "$id unhealthy/healthy criteria leave a recovery dead band around $threshold",
    (tc: PodmanTemplateCase) => {
      const template: PodmanAlertTemplate = getPodmanAlertTemplateById(tc.id)!;
      const step: MonitorStep = template.getMonitorStep(buildArgs());

      const instances: Array<any> = step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray as Array<any>;
      expect(instances).toHaveLength(2);
      const [offline, online] = instances;

      const offlineFilter: any = offline.data.filters[0];
      const onlineFilter: any = online.data.filters[0];

      expect(offlineFilter.metricMonitorOptions.metricAlias).toBe(
        tc.metricAlias,
      );
      expect(onlineFilter.metricMonitorOptions.metricAlias).toBe(
        tc.metricAlias,
      );
      expect(offlineFilter.value).toBe(tc.threshold);
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

      expect(offlineFilter.filterType).toBe(tc.offlineFilterType);
      expect(onlineFilter.filterType).toBe(tc.onlineFilterType);

      expect(offline.data.createIncidents).toBe(true);
      expect(offline.data.createAlerts).toBe(true);
      expect(offline.data.incidents).toHaveLength(1);
      expect(offline.data.alerts).toHaveLength(1);
      expect(offline.data.monitorStatusId).toBeDefined();

      expect(online.data.createIncidents).toBe(false);
      expect(online.data.createAlerts).toBe(false);
      expect(online.data.incidents).toHaveLength(0);
      expect(online.data.alerts).toHaveLength(0);
    },
  );

  test("incidents auto-resolve so a recovered container clears itself", () => {
    for (const tc of PODMAN_TEMPLATES) {
      const step: MonitorStep = getPodmanAlertTemplateById(
        tc.id,
      )!.getMonitorStep(buildArgs());
      const offline: any = (
        step.data?.monitorCriteria.data
          ?.monitorCriteriaInstanceArray as Array<any>
      )[0];
      expect(offline.data.incidents[0].autoResolveIncident).toBe(true);
      expect(offline.data.alerts[0].autoResolveAlert).toBe(true);
    }
  });

  /*
   * Lifetime, monotonic counters. Nothing between OTLP ingest and the
   * criteria evaluator converts one to a delta or a rate — ingest keeps
   * aggregationTemporality/isMonotonic only as catalog metadata for the
   * dashboard's rate-view hint, AggregationType has no rate/increase member,
   * and CompareCriteria.reduceWindow offers only Average/Sum/Max/Min. So a
   * "> N" criteria on one of these fires the first time the container ever
   * breaches and NEVER clears: the recovery comparison is unreachable until
   * the container is recreated. `podman-cpu-throttling` did exactly that on
   * throttled_time and was removed for it; this guard stops it, or an
   * equivalent, being pasted back in from DockerAlertTemplates.
   */
  const CUMULATIVE_METRICS: Array<string> = [
    "container.cpu.throttling_data.throttled_time",
    "container.cpu.throttling_data.throttled_periods",
    "container.cpu.usage.total",
  ];

  test("no template thresholds a cumulative counter it cannot recover from", () => {
    for (const template of getAllPodmanAlertTemplates()) {
      const monitor: MonitorStepPodmanMonitor = getPodmanMonitor(
        template.getMonitorStep(buildArgs()),
      );
      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        expect(CUMULATIVE_METRICS).not.toContain(
          queryConfig.metricQueryData.filterData.metricName,
        );
      }
    }
  });

  test("podman-cpu-throttling is not registered", () => {
    // Removed deliberately — see the note in PodmanAlertTemplates.ts.
    expect(getPodmanAlertTemplateById("podman-cpu-throttling")).toBeUndefined();
  });

  test("podman-container-down fires on a low uptime, not on an unreachable zero", () => {
    const step: MonitorStep = getPodmanAlertTemplateById(
      "podman-container-down",
    )!.getMonitorStep(buildArgs());
    const [offline, online]: Array<any> = step.data?.monitorCriteria.data
      ?.monitorCriteriaInstanceArray as Array<any>;

    /*
     * A stopped container emits no rows at all and a running one is never
     * scraped at the instant it started, so an equality-to-zero comparison
     * on container.uptime can never be satisfied in either direction.
     */
    expect(offline.data.filters[0].filterType).not.toBe(FilterType.EqualTo);
    expect(offline.data.filters[0].value).toBeGreaterThan(0);

    // Wider than the 30s scrape and the 60s evaluation interval combined.
    expect(offline.data.filters[0].value).toBeGreaterThanOrEqual(120);

    // And recovery sits strictly outside the firing threshold.
    expect(online.data.filters[0].filterType).toBe(
      FilterType.GreaterThanOrEqualTo,
    );
    expect(online.data.filters[0].value).toBeGreaterThan(
      offline.data.filters[0].value as number,
    );
  });

  test("the restart loop counts restarts in the window, not the lifetime total", async () => {
    /*
     * Regression: container.restarts is the engine's lifetime RestartCount,
     * and this template thresholded it ("> 5"): any container with six
     * restarts in its history fired at once, and could never recover - a
     * counter that only grows never comes back under its threshold. It now
     * sums the counter's per-minute growth, the house delta Docker uses.
     */
    const step: MonitorStep = getPodmanAlertTemplateById(
      "podman-restart-loop",
    )!.getMonitorStep(buildArgs());
    const monitor: MonitorStepPodmanMonitor = getPodmanMonitor(step);
    const offline: any = (
      step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray as Array<any>
    )[0];

    expect(
      (monitor.metricViewConfig.queryConfigs as Array<any>).map((q: any) => {
        return q.metricQueryData.filterData.aggegationType;
      }),
    ).toEqual([MetricsAggregationType.Max, MetricsAggregationType.Min]);
    expect(
      (monitor.metricViewConfig.formulaConfigs as Array<any>)[0]
        .metricFormulaData.metricFormula,
    ).toBe("container_restarts_max - container_restarts_min");
    expect(offline.data.filters[0].metricMonitorOptions.metricAggregationType).toBe(
      EvaluateOverTimeType.Sum,
    );

    // A long-lived container with 40 restarts in its history, all old.
    expect(
      await evaluateTemplateCriteria({
        step,
        viewConfig: monitor.metricViewConfig,
        samplesByAlias: {
          container_restarts_max: Array(15).fill(40),
          container_restarts_min: Array(15).fill(40),
        },
        windowMinutes: 15,
      }),
    ).toEqual({ breached: false, healthy: true });

    // A container crash-looping now: four restarts seen in the window.
    expect(
      await evaluateTemplateCriteria({
        step,
        viewConfig: monitor.metricViewConfig,
        samplesByAlias: {
          container_restarts_max: [2, 3, 3, 4, 5, 5, 6],
          container_restarts_min: [2, 2, 3, 3, 4, 5, 5],
        },
        windowMinutes: 15,
      }),
    ).toEqual({ breached: true, healthy: false });
  });

  test("the process-count template counts threads too, and says so", () => {
    const template: PodmanAlertTemplate =
      getPodmanAlertTemplateById("podman-high-pids")!;
    const copy: string = `${template.summary} ${template.description}`;

    expect(copy).toContain("threads");
    expect(copy).toContain("2000");
  });

  test("percentage gauges use the aggregation their catalog entry declares", () => {
    /*
     * container.cpu.utilization and container.memory.percent are already
     * per-container percentages; PodmanMetricCatalog declares Avg for both
     * and the Docker Swarm templates use Avg on the identical metrics at the
     * identical thresholds. Max on a per-minute bucket turns a sub-minute
     * burst into a whole minute above the threshold, which contradicts the
     * word "sustained" in the copy — and with the fire side now evaluated
     * over ALL values in the window, Max means "every minute's PEAK crossed",
     * which is strictly weaker than sustained load.
     */
    for (const id of ["podman-high-cpu", "podman-high-memory"]) {
      const monitor: MonitorStepPodmanMonitor = getPodmanMonitor(
        getPodmanAlertTemplateById(id)!.getMonitorStep(buildArgs()),
      );
      const filterData: any = (
        monitor.metricViewConfig.queryConfigs as Array<any>
      )[0].metricQueryData.filterData;

      expect(filterData.aggegationType).toBe(MetricsAggregationType.Avg);
      expect(filterData.aggegationType).toBe(
        getPodmanMetricByMetricName(filterData.metricName)!.defaultAggregation,
      );
    }
  });

  test("podman-high-cpu states the percent-of-one-core scale", () => {
    /*
     * PodmanMetricCatalog: "100% = 1 full CPU core". A container spread over
     * several cores sits permanently above 80 while healthy, so copy that
     * reads as "80% of the container's CPU allowance" is wrong.
     */
    const step: MonitorStep =
      getPodmanAlertTemplateById("podman-high-cpu")!.getMonitorStep(
        buildArgs(),
      );
    const offline: any = (
      step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray as Array<any>
    )[0];

    expect(offline.data.incidents[0].description).toMatch(/core/i);
    expect(offline.data.description).toMatch(/core/i);
  });

  test("podman-high-memory does not promise a limit the metric may not have", () => {
    /*
     * container.memory.percent falls back to a percentage of HOST total for a
     * container started without --memory, which is Podman's default. Copy
     * that says only "of its limit", and builds an OOM narrative on it, is
     * wrong for exactly the container most able to take the host down.
     */
    const step: MonitorStep =
      getPodmanAlertTemplateById("podman-high-memory")!.getMonitorStep(
        buildArgs(),
      );
    const offline: any = (
      step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray as Array<any>
    )[0];

    expect(offline.data.incidents[0].description).toMatch(/host/i);
    expect(offline.data.description).toMatch(/host/i);
  });
});
