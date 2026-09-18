import {
  DockerAlertTemplate,
  DockerAlertTemplateArgs,
  DockerAlertTemplateCategory,
  getAllDockerAlertTemplates,
  getDockerAlertTemplateById,
  getDockerAlertTemplatesByCategory,
} from "../../../Types/Monitor/DockerAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { hasRecoveryDeadBand } from "./Utils/RecommendationCriteriaAssertions";
import MonitorStepDockerMonitor from "../../../Types/Monitor/MonitorStepDockerMonitor";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import CompareCriteria from "../../../Server/Utils/Monitor/Criteria/CompareCriteria";
import ObjectID from "../../../Types/ObjectID";

/*
 * These tests lock in the container-alert templates' easy-to-regress
 * decisions:
 *
 *   1. The metric name each template queries — a rename in the collector
 *      pipeline (e.g. `container.memory.percent`) would silently make the
 *      template match nothing while every "template exists" check stays green.
 *
 *   2. The per-minute aggregation. Container templates deliberately use `Max`
 *      so a SINGLE hot/throttled/forking container trips the threshold instead
 *      of being diluted by averaging across the other containers on the host;
 *      the down/uptime template uses `Min` so a single zero-uptime scrape wins.
 *
 *   3. The unhealthy and healthy criteria PARTITION the value range — no gap
 *      (a value matching neither leaves the monitor stuck in its previous
 *      status) and no overlap (a value matching both makes the status depend
 *      on evaluation order). The failure mode is a strict/non-strict slip.
 *      The one remaining zero-boundary template (container-down) partitions
 *      the non-negative domain with `= 0` / `> 0`, so it is pinned per case
 *      rather than by a generic complement rule.
 *
 *   4. The CUMULATIVE-COUNTER templates. `container.restarts` and
 *      `container.cpu.throttling_data.throttled_time` are monotonic LIFETIME
 *      counters. Both used to be compared to a static threshold, which fires
 *      on ancient history and can never recover — the counter cannot come
 *      back down, so the complementary healthy comparison is unreachable by
 *      construction. They now threshold the counter's per-minute GROWTH
 *      (`max - min`, summed over the window) via a two-query + formula
 *      config, and the tests below pin every part of that shape whose
 *      breakage would be SILENT.
 */

interface DockerTemplateCase {
  id: string;
  category: DockerAlertTemplateCategory;
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
   * query and no formula, which is the default; a template that differences a
   * cumulative counter pins its own counts.
   */
  queryCount?: number;
  formulaCount?: number;
}

const DOCKER_TEMPLATES: Array<DockerTemplateCase> = [
  {
    id: "docker-high-cpu",
    category: "Resource",
    severity: "Warning",
    metricName: "container.cpu.utilization",
    metricAlias: "container_cpu",
    aggregation: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    offlineFilterType: FilterType.GreaterThan,
    onlineFilterType: FilterType.LessThanOrEqualTo,
    threshold: 80,
  },
  {
    id: "docker-high-memory",
    category: "Resource",
    severity: "Warning",
    metricName: "container.memory.percent",
    metricAlias: "container_memory",
    aggregation: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    offlineFilterType: FilterType.GreaterThan,
    onlineFilterType: FilterType.LessThanOrEqualTo,
    threshold: 85,
  },
  {
    id: "docker-restart-loop",
    category: "Container",
    severity: "Critical",
    // queryConfigs[0] is the Max half of the per-minute delta pair.
    metricName: "container.restarts",
    // The criteria threshold the FORMULA, not either query.
    metricAlias: "container_restarts",
    aggregation: MetricsAggregationType.Max,
    /*
     * A lifetime counter, so the template alerts on its growth over a window
     * wide enough for the 30s-scrape delta to see a real loop.
     */
    rollingTime: RollingTime.Past15Minutes,
    queryCount: 2,
    formulaCount: 1,
    offlineFilterType: FilterType.GreaterThan,
    onlineFilterType: FilterType.LessThanOrEqualTo,
    threshold: 3,
  },
  {
    id: "docker-cpu-throttling",
    category: "Resource",
    severity: "Warning",
    // queryConfigs[0] is the Max half of the per-minute delta pair.
    metricName: "container.cpu.throttling_data.throttled_time",
    // The criteria threshold the FORMULA, not either query.
    metricAlias: "cpu_throttled",
    aggregation: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    /*
     * A lifetime NANOSECOND counter, so the template alerts on its growth
     * (max - min per minute, summed): milliseconds of throttling per five
     * minutes, not the container's lifetime total.
     */
    queryCount: 2,
    formulaCount: 1,
    offlineFilterType: FilterType.GreaterThan,
    onlineFilterType: FilterType.LessThanOrEqualTo,
    threshold: 1000,
  },
  {
    id: "docker-high-pids",
    category: "Container",
    severity: "Warning",
    metricName: "container.pids.count",
    metricAlias: "pids_count",
    aggregation: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    offlineFilterType: FilterType.GreaterThan,
    onlineFilterType: FilterType.LessThanOrEqualTo,
    /*
     * The cgroup pids controller counts TASKS (threads included), so 500 was
     * ordinary for a JVM or a Go binary and the alert asserted a fork bomb
     * against a container working as designed.
     */
    threshold: 2000,
  },
  {
    id: "docker-container-down",
    category: "Container",
    severity: "Critical",
    metricName: "container.uptime",
    metricAlias: "container_uptime",
    // A single zero-uptime scrape means the container is down right now.
    aggregation: MetricsAggregationType.Min,
    rollingTime: RollingTime.Past1Minute,
    // uptime is non-negative: (= 0) unhealthy, (> 0) healthy partitions it.
    offlineFilterType: FilterType.EqualTo,
    onlineFilterType: FilterType.GreaterThan,
    threshold: 0,
  },
];

function buildArgs(): DockerAlertTemplateArgs {
  return {
    hostIdentifier: "docker-host-01",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Docker Monitor",
  };
}

function getDockerMonitor(step: MonitorStep): MonitorStepDockerMonitor {
  const dockerMonitor: MonitorStepDockerMonitor | undefined =
    step.data?.dockerMonitor;
  if (!dockerMonitor) {
    throw new Error("dockerMonitor missing from monitor step");
  }
  return dockerMonitor;
}

describe("DockerAlertTemplates", () => {
  test("every documented template id is registered", () => {
    const ids: Array<string> = getAllDockerAlertTemplates().map(
      (t: DockerAlertTemplate) => {
        return t.id;
      },
    );
    for (const tc of DOCKER_TEMPLATES) {
      expect(ids).toContain(tc.id);
    }
    // The suite must be exhaustive: no template ships without a case here.
    expect(ids.sort()).toEqual(
      DOCKER_TEMPLATES.map((t: DockerTemplateCase) => {
        return t.id;
      }).sort(),
    );
  });

  test("every template id is unique", () => {
    const ids: Array<string> = getAllDockerAlertTemplates().map(
      (t: DockerAlertTemplate) => {
        return t.id;
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("getDockerAlertTemplateById returns undefined for an unknown id", () => {
    expect(getDockerAlertTemplateById("does-not-exist")).toBeUndefined();
  });

  test("getDockerAlertTemplatesByCategory partitions the catalog by category", () => {
    const all: Array<DockerAlertTemplate> = getAllDockerAlertTemplates();
    const categories: Array<DockerAlertTemplateCategory> = [
      "Container",
      "Resource",
      "Host",
    ];

    let total: number = 0;
    for (const category of categories) {
      const inCategory: Array<DockerAlertTemplate> =
        getDockerAlertTemplatesByCategory(category);
      for (const template of inCategory) {
        expect(template.category).toBe(category);
      }
      total += inCategory.length;
    }
    // Every template falls into exactly one of the known categories.
    expect(total).toBe(all.length);
  });

  test.each(DOCKER_TEMPLATES)(
    "$id is a $severity $category template with populated copy",
    (tc: DockerTemplateCase) => {
      const template: DockerAlertTemplate | undefined =
        getDockerAlertTemplateById(tc.id);
      expect(template).toBeDefined();
      expect(template!.category).toBe(tc.category);
      expect(template!.severity).toBe(tc.severity);
      expect(template!.name.length).toBeGreaterThan(0);
      expect(template!.description.length).toBeGreaterThan(0);
    },
  );

  test.each(DOCKER_TEMPLATES)(
    "$id queries $metricName with the intended aggregation and window",
    (tc: DockerTemplateCase) => {
      const template: DockerAlertTemplate = getDockerAlertTemplateById(tc.id)!;
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const monitor: MonitorStepDockerMonitor = getDockerMonitor(step);

      expect(monitor.hostIdentifier).toBe("docker-host-01");

      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      /*
       * A single-metric threshold template has exactly one query and no
       * formula; a cumulative-counter template carries two queries (Max and
       * Min over the same metric) and a difference formula, and pins its own
       * counts in the case table above.
       */
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

  test.each(DOCKER_TEMPLATES)(
    "$id unhealthy/healthy criteria leave a recovery dead band around $threshold",
    (tc: DockerTemplateCase) => {
      const template: DockerAlertTemplate = getDockerAlertTemplateById(tc.id)!;
      const step: MonitorStep = template.getMonitorStep(buildArgs());

      const instances: Array<any> = step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray as Array<any>;
      // Exactly two criteria: [unhealthy, healthy].
      expect(instances).toHaveLength(2);
      const [offline, online] = instances;

      const offlineFilter: any = offline.data.filters[0];
      const onlineFilter: any = online.data.filters[0];

      // Both criteria evaluate the same metric alias, at different thresholds.
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

      // Only the comparison DIRECTION differs — pinned per template.
      expect(offlineFilter.filterType).toBe(tc.offlineFilterType);
      expect(onlineFilter.filterType).toBe(tc.onlineFilterType);

      // Only the unhealthy criterion opens incidents/alerts.
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
    // A container alert must not linger once the container is healthy again.
    for (const tc of DOCKER_TEMPLATES) {
      const step: MonitorStep = getDockerAlertTemplateById(
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
   * ---------------------------------------------------------------------
   * Cumulative-counter guards.
   *
   * `container.restarts` is Docker's lifetime RestartCount and
   * `container.cpu.throttling_data.throttled_time` is the cgroup's lifetime
   * throttled nanoseconds. Both are monotonic: the value only ever goes up.
   * Nothing between ingest and alerting differences them —
   * OtelMetricsIngestService records aggregationTemporality/isMonotonic as
   * catalog metadata for the browser's rate-view hint and stores the raw
   * value, `transformAsRate` is read only by the chart code, and
   * CompareCriteria.reduceWindow offers only Average/Sum/Max/Min.
   *
   * So a "> N" criteria on the RAW counter fires the first time the
   * container ever breaches and never clears: the complementary healthy
   * comparison is unreachable until the container is recreated. Both
   * templates shipped exactly that. Every assertion below fails if someone
   * points a criteria back at the raw counter.
   * ---------------------------------------------------------------------
   */

  const CUMULATIVE_METRICS: Array<string> = [
    "container.restarts",
    "container.cpu.throttling_data.throttled_time",
    "container.cpu.throttling_data.throttled_periods",
    "container.cpu.usage.total",
  ];

  interface DeltaTemplateCase {
    id: string;
    metricName: string;
    maxAlias: string;
    minAlias: string;
    resultAlias: string;
    formula: string;
    // A formula's legendUnit is a LABEL; it must be unset for a bare count.
    legendUnit: string | undefined;
    /*
     * Per-minute GROWTH samples, the shape the formula produces. The busy
     * window deliberately contains zeros and no single breaching minute:
     * that is what makes it prove the window aggregation is Sum rather than
     * the shared builder's AllValues default.
     */
    busyWindow: Array<number>;
  }

  const DELTA_TEMPLATES: Array<DeltaTemplateCase> = [
    {
      id: "docker-cpu-throttling",
      metricName: "container.cpu.throttling_data.throttled_time",
      maxAlias: "cpu_throttled_max",
      minAlias: "cpu_throttled_min",
      resultAlias: "cpu_throttled",
      formula: "(cpu_throttled_max - cpu_throttled_min) / 1000000",
      legendUnit: "ms",
      // ms of throttling per minute: 1200 ms across five minutes, > 1000.
      busyWindow: [0, 400, 0, 500, 300],
    },
    {
      id: "docker-restart-loop",
      metricName: "container.restarts",
      maxAlias: "container_restarts_max",
      minAlias: "container_restarts_min",
      resultAlias: "container_restarts",
      formula: "container_restarts_max - container_restarts_min",
      legendUnit: undefined,
      // Restarts per minute: 4 across the window, > 3, none in one minute.
      busyWindow: [0, 1, 2, 0, 1],
    },
  ];

  test("no criteria compares a cumulative lifetime counter directly", () => {
    /*
     * The broad guard: if a template queries one of these counters at all,
     * the alias its criteria threshold must name a FORMULA, never one of the
     * raw queries. This is the single assertion that stops either template
     * regressing, and stops a third being pasted in from the same mistake.
     */
    for (const template of getAllDockerAlertTemplates()) {
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const monitor: MonitorStepDockerMonitor = getDockerMonitor(step);

      const cumulativeQueryAliases: Array<string> = (
        monitor.metricViewConfig.queryConfigs as Array<any>
      )
        .filter((q: any) => {
          return CUMULATIVE_METRICS.includes(
            q.metricQueryData.filterData.metricName,
          );
        })
        .map((q: any) => {
          return q.metricAliasData.metricVariable;
        });

      if (cumulativeQueryAliases.length === 0) {
        continue;
      }

      const formulaAliases: Array<string> = (
        (monitor.metricViewConfig.formulaConfigs as Array<any>) || []
      ).map((f: any) => {
        return f.metricAliasData.metricVariable;
      });

      for (const instance of step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray as Array<any>) {
        for (const filter of instance.data.filters as Array<any>) {
          const alias: string = filter.metricMonitorOptions.metricAlias;
          expect(cumulativeQueryAliases).not.toContain(alias);
          expect(formulaAliases).toContain(alias);
        }
      }
    }
  });

  test.each(DELTA_TEMPLATES)(
    "$id subtracts a Min query from a Max query over the same counter",
    (dc: DeltaTemplateCase) => {
      /*
       * Both halves must read the SAME metric, differ ONLY in aggregation,
       * and group identically. Max/Max makes the delta identically zero, and
       * mismatched group-by keys split the two into series fingerprints that
       * never meet (buildSeriesBreakdown joins by fingerprint) so the formula
       * evaluates against an empty operand. Either slip makes the monitor
       * stop alerting with no error at all.
       */
      const monitor: MonitorStepDockerMonitor = getDockerMonitor(
        getDockerAlertTemplateById(dc.id)!.getMonitorStep(buildArgs()),
      );

      const [maxQuery, minQuery] = monitor.metricViewConfig
        .queryConfigs as Array<any>;

      expect(maxQuery.metricQueryData.filterData.metricName).toBe(
        dc.metricName,
      );
      expect(minQuery.metricQueryData.filterData.metricName).toBe(
        dc.metricName,
      );
      expect(maxQuery.metricQueryData.filterData.aggegationType).toBe(
        MetricsAggregationType.Max,
      );
      expect(minQuery.metricQueryData.filterData.aggegationType).toBe(
        MetricsAggregationType.Min,
      );
      expect(minQuery.metricQueryData.groupByAttributeKeys).toEqual(
        maxQuery.metricQueryData.groupByAttributeKeys,
      );
      expect(maxQuery.metricAliasData.metricVariable).toBe(dc.maxAlias);
      expect(minQuery.metricAliasData.metricVariable).toBe(dc.minAlias);

      /*
       * Neither query carries a legendUnit, so MetricResultUnitConverter —
       * which converts QUERY results only, from the MetricType native unit
       * into legendUnit — passes the raw counter through untouched. Setting
       * one here would convert BEFORE the formula subtracts.
       */
      expect(maxQuery.metricAliasData.legendUnit).toBeUndefined();
      expect(minQuery.metricAliasData.legendUnit).toBeUndefined();

      const formula: any = (
        monitor.metricViewConfig.formulaConfigs as Array<any>
      )[0];
      expect(formula.metricAliasData.metricVariable).toBe(dc.resultAlias);
      expect(formula.metricFormulaData.metricFormula).toBe(dc.formula);
      /*
       * ns -> ms happens INSIDE the formula, never via legendUnit, because
       * MetricResultUnitConverter does not touch formula results. The unit
       * here is only a label — it is what makes the alert sentence read
       * "... ms" — and it must stay unset for a dimensionless count, because
       * MetricMonitorCriteria reads a formula's legendUnit as the sample
       * unit to convert FROM.
       */
      expect(formula.metricAliasData.legendUnit).toBe(dc.legendUnit);
    },
  );

  test.each(DELTA_TEMPLATES)(
    "$id sums the per-minute deltas on BOTH criteria",
    (dc: DeltaTemplateCase) => {
      /*
       * Each sample is one minute's GROWTH of a cumulative counter, so the
       * threshold only means "N per window" under Sum. The shared builder's
       * AllValues default would instead demand a breach in every single
       * minute — unreachable, because the first and last minute of a rolling
       * window are partial and most minutes of a crash loop are zero. And
       * the two criteria must agree, or the fire/recover pair is not
       * comparing the same quantity.
       */
      const step: MonitorStep = getDockerAlertTemplateById(
        dc.id,
      )!.getMonitorStep(buildArgs());

      const instances: Array<any> = step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray as Array<any>;

      expect(instances).toHaveLength(2);
      for (const instance of instances) {
        for (const filter of instance.data.filters as Array<any>) {
          expect(filter.metricMonitorOptions.metricAggregationType).toBe(
            EvaluateOverTimeType.Sum,
          );
        }
      }
    },
  );

  test.each(DELTA_TEMPLATES)(
    "$id can actually recover — a quiet container clears, a busy one fires",
    (dc: DeltaTemplateCase) => {
      /*
       * The defect this pins: with the raw lifetime counter, a container
       * that misbehaved once reported a permanently non-zero value, so the
       * fire comparison stayed true forever and the healthy comparison
       * ("= 0", or a dead band below it) was unreachable by construction —
       * a Critical/Warning alert no recovery could ever close.
       *
       * Driven through the real comparator, with the templates' own filters,
       * over the per-minute DELTA samples the formula produces.
       */
      const step: MonitorStep = getDockerAlertTemplateById(
        dc.id,
      )!.getMonitorStep(buildArgs());
      const [offline, online]: Array<any> = step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray as Array<any>;

      const fireFilter: CriteriaFilter = offline.data.filters[0];
      const recoverFilter: CriteriaFilter = online.data.filters[0];

      const evaluate: (
        filter: CriteriaFilter,
        samples: Array<number>,
      ) => string | null = (
        filter: CriteriaFilter,
        samples: Array<number>,
      ): string | null => {
        return CompareCriteria.compareCriteriaNumbers({
          value: samples,
          threshold: filter.value as number,
          criteriaFilter: filter,
        });
      };

      /*
       * A container that crash-looped / was throttled long ago and is idle
       * now: the LIFETIME counter is still huge, but it stopped growing, so
       * every per-minute delta is zero. Before the fix this window still
       * fired and could never recover.
       */
      const quietWindow: Array<number> = [0, 0, 0, 0, 0];
      expect(evaluate(fireFilter, quietWindow)).toBeNull();
      expect(evaluate(recoverFilter, quietWindow)).not.toBeNull();

      /*
       * A container misbehaving right now. Most minutes are zero and no
       * single minute reaches the threshold on its own — which is exactly
       * why the window aggregation has to be Sum and not AllValues. Under
       * AllValues this window would NOT fire, and this assertion is what
       * catches a revert to the shared default.
       */
      expect(
        dc.busyWindow.every((sample: number) => {
          return sample <= (fireFilter.value as number);
        }),
      ).toBe(true);
      expect(evaluate(fireFilter, dc.busyWindow)).not.toBeNull();
      expect(evaluate(recoverFilter, dc.busyWindow)).toBeNull();

      /*
       * And structurally: recovery must be an INEQUALITY strictly inside the
       * firing threshold. "Recovery requires a monotonic counter to return
       * to exactly zero" is the shape that cannot come back.
       */
      expect(recoverFilter.filterType).toBe(FilterType.LessThanOrEqualTo);
      expect(fireFilter.filterType).toBe(FilterType.GreaterThan);
      expect(recoverFilter.value as number).toBeLessThan(
        fireFilter.value as number,
      );
    },
  );

  /*
   * ---------------------------------------------------------------------
   * Copy guards. An alert sentence that names a wrong cause costs an
   * engineer an investigation, so the claims each template makes are
   * pinned the same way its thresholds are.
   * ---------------------------------------------------------------------
   */

  function getOfflineCopy(id: string, args?: DockerAlertTemplateArgs): string {
    const step: MonitorStep = getDockerAlertTemplateById(id)!.getMonitorStep(
      args || buildArgs(),
    );
    const offline: any = (
      step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray as Array<any>
    )[0];
    return offline.data.incidents[0].description as string;
  }

  test("no incident description promises an exit code the pipeline never carries", () => {
    /*
     * docker_stats emits no exit-code attribute and the criteria root cause
     * is built purely from metric samples, so "check the exit code" sent the
     * reader looking for data that is not there.
     */
    for (const tc of DOCKER_TEMPLATES) {
      expect(getOfflineCopy(tc.id).toLowerCase()).not.toContain("exit code");
    }
  });

  test("docker-high-pids describes a TASK count, not a bare process count", () => {
    /*
     * The cgroup pids controller counts tasks — kernel threads included — so
     * a JVM or a Go binary sits far above its process count. Keeping the
     * threshold honest is what stops the alert asserting "fork bomb" at a
     * container working as designed.
     */
    const template: DockerAlertTemplate =
      getDockerAlertTemplateById("docker-high-pids")!;
    const copy: string = `${template.description} ${getOfflineCopy(
      "docker-high-pids",
    )}`.toLowerCase();
    expect(copy).toContain("thread");
    expect(copy).toContain("task");
  });

  test("docker-high-memory does not promise an OOM kill it cannot know is coming", () => {
    /*
     * `container.memory.percent` divides by the container's limit when one
     * is set and by HOST total memory when it is not, so an unlimited
     * container at 86% will not be OOM-killed for exceeding a limit that
     * does not exist. The copy has to name that denominator.
     */
    const copy: string = getOfflineCopy("docker-high-memory").toLowerCase();
    expect(copy).toContain("host");
    expect(copy).toContain("--memory");
  });

  test("docker-high-cpu states the per-CORE denominator", () => {
    /*
     * `container.cpu.utilization` is what `docker stats` prints: 100% is one
     * full core, not 100% of the host. Without that sentence, "> 80%" reads
     * as a share of the machine and is wrong by the host's core count.
     */
    const template: DockerAlertTemplate =
      getDockerAlertTemplateById("docker-high-cpu")!;
    expect(template.description.toLowerCase()).toContain("core");
    expect(getOfflineCopy("docker-high-cpu").toLowerCase()).toContain("core");
  });

  /*
   * ---------------------------------------------------------------------
   * Title guards.
   *
   * MonitorRecommendationUtil.getMonitorName returns
   * "<resource> - <template name>", and the templates used to append THAT
   * to every title, so the rendered alert stated the same fact twice:
   *   "[Docker] High CPU Usage (>80%) - docker-host-01 - High Container CPU Usage"
   * SeriesContextEnricher then appends the container identity on top, which
   * pushes the one thing that differs between two alerts off the end of a
   * phone notification.
   * ---------------------------------------------------------------------
   */

  test("no incident or alert title repeats the monitor name", () => {
    for (const tc of DOCKER_TEMPLATES) {
      const template: DockerAlertTemplate = getDockerAlertTemplateById(tc.id)!;
      // The exact shape MonitorRecommendationUtil.getMonitorName produces.
      const args: DockerAlertTemplateArgs = {
        ...buildArgs(),
        monitorName: `docker-host-01 - ${template.name}`,
      };

      const offline: any = (
        template.getMonitorStep(args).data?.monitorCriteria.data
          ?.monitorCriteriaInstanceArray as Array<any>
      )[0];

      expect(offline.data.incidents[0].title).not.toContain(args.monitorName);
      expect(offline.data.alerts[0].title).not.toContain(args.monitorName);
      // The host is the half worth keeping — the alert email renders nothing else that names it.
      expect(offline.data.incidents[0].title).toContain(args.hostIdentifier);
      expect(offline.data.alerts[0].title).toContain(args.hostIdentifier);
    }
  });

  test("a title built before a host is chosen does not end in a bare dash", () => {
    /*
     * DockerMonitorStepForm builds a step with `hostIdentifier || ""` while
     * the picker is still empty, so the suffix has to disappear rather than
     * render "... - ".
     */
    for (const tc of DOCKER_TEMPLATES) {
      const args: DockerAlertTemplateArgs = {
        ...buildArgs(),
        hostIdentifier: "",
      };
      const offline: any = (
        getDockerAlertTemplateById(tc.id)!.getMonitorStep(args).data
          ?.monitorCriteria.data?.monitorCriteriaInstanceArray as Array<any>
      )[0];

      const title: string = offline.data.incidents[0].title as string;
      expect(title.trim()).toBe(title);
      expect(title.endsWith("-")).toBe(false);
      expect(title.length).toBeGreaterThan(0);
    }
  });
});
