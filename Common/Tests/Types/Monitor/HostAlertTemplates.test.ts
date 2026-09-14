import {
  HostAlertTemplate,
  HostAlertTemplateArgs,
  HostAlertTemplateCategory,
  getAllHostAlertTemplates,
  getHostAlertTemplateById,
  getHostAlertTemplatesByCategory,
  hostTitleSuffix,
} from "../../../Types/Monitor/HostAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { hasRecoveryDeadBand } from "./Utils/RecommendationCriteriaAssertions";
import MonitorStepHostMonitor from "../../../Types/Monitor/MonitorStepHostMonitor";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../../Types/ObjectID";

/*
 * Host resource templates. The regression-prone details these tests pin:
 *
 *   1. The OTel metric name each template reads (system.cpu.utilization,
 *      system.memory.utilization, ...). A rename in the host receiver would
 *      make the template match nothing while staying "registered".
 *
 *   2. The per-state ATTRIBUTE FILTER on the utilization metrics. Both
 *      `system.cpu.utilization` and `system.memory.utilization` are reported
 *      once per state, and a state set sums to 1, so an UNFILTERED average
 *      lands at ~1/(state count) — about 0.125 for CPU on Linux — no matter
 *      how loaded the host is. Dropping the filter would silently make these
 *      templates unable to fire at all, which is exactly what they did
 *      before. The derivation matches the host Overview page: CPU busy =
 *      state user + state system, memory = state used.
 *
 *   3. The utilization templates carry an explicit `* 100` formula with
 *      `legendUnit: "%"`, so the compared value AND the root-cause line are
 *      in percent and the threshold is the literal 80 / 85 / 90 the title
 *      quotes. Doing this with a query-level `legendUnit` instead would push
 *      the conversion into MetricResultUnitConverter, which is a no-op when
 *      the metric's native unit was never recorded at ingest — the template
 *      would then compare a [0, 1] sample against 80 and never fire.
 *
 *   4. Aggregation: filesystem usage and process count use `Max` so a single
 *      full mount is not diluted by averaging the host's other mounts; the
 *      rest use `Avg` for a representative sustained reading. NOTE that
 *      `system.processes.count` is partitioned by status, so ungrouped `Max`
 *      compares the LARGEST STATUS BUCKET, not the host's total process
 *      count — the template description says so deliberately.
 *
 *   5. The unhealthy criteria fires above the threshold and the healthy one
 *      recovers at a threshold strictly INSIDE it — a dead band, not a
 *      partition.
 *
 *   6. Incident titles name the HOST, not the monitor. The recommendation
 *      flow rewrites monitorName to "<host> - <template name>" before the
 *      template ever sees it, so interpolating it repeated the template name.
 */

interface HostQueryCase {
  metricName: string;
  metricAlias: string;
  aggregation: MetricsAggregationType;
  // {} for a metric that is a single series per host.
  attributes: Record<string, string>;
}

interface HostTemplateCase {
  id: string;
  category: HostAlertTemplateCategory;
  severity: "Critical" | "Warning";
  queries: Array<HostQueryCase>;
  // The alias the criteria compare on: a formula alias where one exists.
  metricAlias: string;
  // The formula that produces `metricAlias`, or null for a bare query.
  formula: string | null;
  // The display unit the alert renders. "%" wherever a formula scales.
  legendUnit: string | undefined;
  threshold: number;
}

const HOST_TEMPLATES: Array<HostTemplateCase> = [
  {
    id: "host-high-cpu",
    category: "Resource",
    severity: "Warning",
    /*
     * user + system, each its own state series. NOT the unfiltered metric:
     * averaging every (cpu, state) datapoint sits near 1/(state count).
     */
    queries: [
      {
        metricName: "system.cpu.utilization",
        metricAlias: "host_cpu_user",
        aggregation: MetricsAggregationType.Avg,
        attributes: { state: "user" },
      },
      {
        metricName: "system.cpu.utilization",
        metricAlias: "host_cpu_system",
        aggregation: MetricsAggregationType.Avg,
        attributes: { state: "system" },
      },
    ],
    metricAlias: "host_cpu",
    formula: "(host_cpu_user + host_cpu_system) * 100",
    legendUnit: "%",
    threshold: 80,
  },
  {
    id: "host-high-memory",
    category: "Resource",
    severity: "Warning",
    queries: [
      {
        metricName: "system.memory.utilization",
        metricAlias: "host_memory_used",
        aggregation: MetricsAggregationType.Avg,
        attributes: { state: "used" },
      },
    ],
    metricAlias: "host_memory",
    formula: "host_memory_used * 100",
    legendUnit: "%",
    threshold: 85,
  },
  {
    id: "host-high-filesystem",
    category: "Resource",
    severity: "Critical",
    queries: [
      {
        metricName: "system.filesystem.utilization",
        metricAlias: "host_filesystem_ratio",
        // Max so a single full filesystem is not diluted by averaging mounts.
        aggregation: MetricsAggregationType.Max,
        attributes: {},
      },
    ],
    metricAlias: "host_filesystem",
    formula: "host_filesystem_ratio * 100",
    legendUnit: "%",
    threshold: 90,
  },
  {
    id: "host-high-load-average",
    category: "Resource",
    severity: "Warning",
    queries: [
      {
        metricName: "system.cpu.load_average.1m",
        metricAlias: "host_load_1m",
        aggregation: MetricsAggregationType.Avg,
        attributes: {},
      },
    ],
    metricAlias: "host_load_1m",
    formula: null,
    legendUnit: undefined,
    // Load average is a raw run-queue length, not a ratio - threshold is 4.
    threshold: 4,
  },
  {
    id: "host-high-processes",
    category: "Host",
    severity: "Warning",
    queries: [
      {
        metricName: "system.processes.count",
        metricAlias: "host_processes",
        aggregation: MetricsAggregationType.Max,
        attributes: {},
      },
    ],
    metricAlias: "host_processes",
    formula: null,
    legendUnit: undefined,
    threshold: 2000,
  },
];

function buildArgs(
  overrides?: Partial<HostAlertTemplateArgs>,
): HostAlertTemplateArgs {
  return {
    hostIdentifier: "host-01",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Host Monitor",
    ...(overrides || {}),
  };
}

function getHostMonitor(step: MonitorStep): MonitorStepHostMonitor {
  const hostMonitor: MonitorStepHostMonitor | undefined =
    step.data?.hostMonitor;
  if (!hostMonitor) {
    throw new Error("hostMonitor missing from monitor step");
  }
  return hostMonitor;
}

function getOfflineInstance(step: MonitorStep): any {
  return (
    step.data?.monitorCriteria.data?.monitorCriteriaInstanceArray as Array<any>
  )[0];
}

describe("HostAlertTemplates", () => {
  test("every documented template id is registered and the suite is exhaustive", () => {
    const ids: Array<string> = getAllHostAlertTemplates().map(
      (t: HostAlertTemplate) => {
        return t.id;
      },
    );
    for (const tc of HOST_TEMPLATES) {
      expect(ids).toContain(tc.id);
    }
    expect(ids.sort()).toEqual(
      HOST_TEMPLATES.map((t: HostTemplateCase) => {
        return t.id;
      }).sort(),
    );
  });

  test("every template id is unique", () => {
    const ids: Array<string> = getAllHostAlertTemplates().map(
      (t: HostAlertTemplate) => {
        return t.id;
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("getHostAlertTemplateById returns undefined for an unknown id", () => {
    expect(getHostAlertTemplateById("host-nothing")).toBeUndefined();
  });

  test("getHostAlertTemplatesByCategory returns only that category and covers the catalog", () => {
    const all: Array<HostAlertTemplate> = getAllHostAlertTemplates();
    const categories: Array<HostAlertTemplateCategory> = ["Resource", "Host"];

    let total: number = 0;
    for (const category of categories) {
      const inCategory: Array<HostAlertTemplate> =
        getHostAlertTemplatesByCategory(category);
      for (const template of inCategory) {
        expect(template.category).toBe(category);
      }
      total += inCategory.length;
    }
    expect(total).toBe(all.length);
  });

  test.each(HOST_TEMPLATES)(
    "$id is a $severity $category template with populated copy",
    (tc: HostTemplateCase) => {
      const template: HostAlertTemplate | undefined = getHostAlertTemplateById(
        tc.id,
      );
      expect(template).toBeDefined();
      expect(template!.category).toBe(tc.category);
      expect(template!.severity).toBe(tc.severity);
      expect(template!.name.length).toBeGreaterThan(0);
      expect(template!.description.length).toBeGreaterThan(0);
    },
  );

  test.each(HOST_TEMPLATES)(
    "$id queries the intended metrics, states and aggregations",
    (tc: HostTemplateCase) => {
      const template: HostAlertTemplate = getHostAlertTemplateById(tc.id)!;
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const monitor: MonitorStepHostMonitor = getHostMonitor(step);

      expect(monitor.hostIdentifier).toBe("host-01");

      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      expect(queryConfigs).toHaveLength(tc.queries.length);

      tc.queries.forEach((expected: HostQueryCase, index: number) => {
        const queryConfig: any = queryConfigs[index];
        const filterData: any = queryConfig.metricQueryData.filterData;

        expect(queryConfig.metricAliasData.metricVariable).toBe(
          expected.metricAlias,
        );
        expect(filterData.metricName).toBe(expected.metricName);
        expect(filterData.aggegationType).toBe(expected.aggregation);
        /*
         * The state filter is the whole reason the utilization templates
         * can fire at all. Asserted exactly, not just "non-empty": a wrong
         * state value is as fatal as a missing one.
         */
        expect(filterData.attributes).toEqual(expected.attributes);
      });

      const formulaConfigs: Array<any> = (monitor.metricViewConfig
        .formulaConfigs || []) as Array<any>;

      if (tc.formula === null) {
        expect(formulaConfigs).toHaveLength(0);
        return;
      }

      expect(formulaConfigs).toHaveLength(1);
      expect(formulaConfigs[0].metricAliasData.metricVariable).toBe(
        tc.metricAlias,
      );
      expect(formulaConfigs[0].metricFormulaData.metricFormula).toBe(
        tc.formula,
      );
      /*
       * The unit the root-cause line renders, and the formula alias is the
       * ONLY place it can come from. MetricMonitorCriteria resolves a
       * criteria's unit as: the matched QUERY's legendUnit, then the matched
       * FORMULA's, then the metric's native unit. These criteria compare on
       * the formula alias, so no query matches; and the native-unit fallback
       * keys off the matched query's metric name, so it is never reached
       * either. Drop this legendUnit and the body reads a bare "87.30" under
       * a title that says 85%.
       */
      expect(formulaConfigs[0].metricAliasData.legendUnit).toBe(tc.legendUnit);
    },
  );

  test.each(HOST_TEMPLATES)(
    "$id never puts a legendUnit on an operand query",
    (tc: HostTemplateCase) => {
      /*
       * MetricResultUnitConverter converts query results into the query
       * alias's legendUnit, and MetricUnitUtil treats OTel's dimensionless
       * "1" and "%" as one family — so a "%" on an operand would scale it by
       * 100 BEFORE the formula's own `* 100`, reporting 8730 % instead of
       * 87.30 %. Formula configs are never converted, which is why the unit
       * belongs there and only there.
       */
      const template: HostAlertTemplate = getHostAlertTemplateById(tc.id)!;
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const monitor: MonitorStepHostMonitor = getHostMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        expect(queryConfig.metricAliasData.legendUnit).toBeUndefined();
      }
    },
  );

  test.each(HOST_TEMPLATES)(
    "$id names the host, not the monitor, in its incident title",
    (tc: HostTemplateCase) => {
      const template: HostAlertTemplate = getHostAlertTemplateById(tc.id)!;
      const step: MonitorStep = template.getMonitorStep(buildArgs());

      const title: string = getOfflineInstance(step).data.incidents[0]
        .title as string;

      /*
       * The recommendation flow passes monitorName as
       * "<host> - <template name>", so interpolating it produced
       * "[Host] High CPU Utilization (>80%) - web-01 - High CPU
       * Utilization". The host identifier is the identity the reader needs
       * and this says it exactly once.
       */
      expect(title).toContain("host-01");
      expect(title).not.toContain("Test Host Monitor");
      expect(title.endsWith(" - host-01")).toBe(true);
    },
  );

  test("hostTitleSuffix degrades to no suffix rather than an empty one", () => {
    /*
     * HostMonitorStepForm passes `hostIdentifier || ""`. A blank identifier
     * must not produce a title ending in a dangling " - ".
     */
    expect(hostTitleSuffix(buildArgs({ hostIdentifier: "web-01" }))).toBe(
      " - web-01",
    );
    expect(hostTitleSuffix(buildArgs({ hostIdentifier: "  web-01  " }))).toBe(
      " - web-01",
    );
    expect(hostTitleSuffix(buildArgs({ hostIdentifier: "" }))).toBe("");
    expect(hostTitleSuffix(buildArgs({ hostIdentifier: "   " }))).toBe("");
  });

  test.each(HOST_TEMPLATES)(
    "$id unhealthy/healthy criteria leave a recovery dead band below $threshold",
    (tc: HostTemplateCase) => {
      const template: HostAlertTemplate = getHostAlertTemplateById(tc.id)!;
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

      // Host ceilings are all "> threshold" unhealthy / "<= threshold" healthy.
      expect(offlineFilter.filterType).toBe(FilterType.GreaterThan);
      expect(onlineFilter.filterType).toBe(FilterType.LessThanOrEqualTo);

      expect(offline.data.createIncidents).toBe(true);
      expect(offline.data.createAlerts).toBe(true);
      expect(online.data.createIncidents).toBe(false);
      expect(online.data.createAlerts).toBe(false);
    },
  );

  test("percent-scaled templates threshold on the 0-100 scale their formula produces", () => {
    /*
     * The utilization metrics arrive as a [0, 1] ratio and each of these
     * templates multiplies by 100 in its formula, so the threshold must be
     * the percent number the title quotes. A slip back to 0.8 / 0.85 / 0.9
     * against the percent-scaled formula would fire on any host above 1%
     * busy; dropping the `* 100` while keeping 80 / 85 / 90 would make them
     * unreachable. The two halves have to move together, so both are pinned
     * here on the same case.
     */
    const percentIds: Array<string> = [
      "host-high-cpu",
      "host-high-memory",
      "host-high-filesystem",
    ];
    for (const id of percentIds) {
      const tc: HostTemplateCase = HOST_TEMPLATES.find(
        (t: HostTemplateCase) => {
          return t.id === id;
        },
      )!;
      expect(tc.formula).toContain("* 100");
      expect(tc.legendUnit).toBe("%");
      expect(tc.threshold).toBeGreaterThan(1);
      expect(tc.threshold).toBeLessThanOrEqual(100);

      // And the template really does ship what the table claims.
      const template: HostAlertTemplate = getHostAlertTemplateById(id)!;
      const monitor: MonitorStepHostMonitor = getHostMonitor(
        template.getMonitorStep(buildArgs()),
      );
      expect(
        (monitor.metricViewConfig.formulaConfigs as Array<any>)[0]
          .metricFormulaData.metricFormula,
      ).toContain("* 100");
    }
  });

  test("host-high-cpu derives busy time from the user and system states only", () => {
    /*
     * The regression this pins: an unfiltered Avg over system.cpu.utilization
     * averages `idle` in with `user` and `system`. A cpu's states sum to 1,
     * so the answer is ~1/(state count) — about 0.125 on Linux — however busy
     * the host is, and a "> 80" criteria can never be met. `1 - idle` is the
     * other derivation and is deliberately not used: it breaks if a platform
     * stops emitting `idle`.
     */
    const template: HostAlertTemplate =
      getHostAlertTemplateById("host-high-cpu")!;
    const monitor: MonitorStepHostMonitor = getHostMonitor(
      template.getMonitorStep(buildArgs()),
    );

    const states: Array<string> = (
      monitor.metricViewConfig.queryConfigs as Array<any>
    ).map((q: any) => {
      return q.metricQueryData.filterData.attributes["state"];
    });
    expect(states.slice().sort()).toEqual(["system", "user"]);

    // Both operands must appear in the formula or one series is dead weight.
    const formula: string = (
      monitor.metricViewConfig.formulaConfigs as Array<any>
    )[0].metricFormulaData.metricFormula;
    for (const alias of (
      monitor.metricViewConfig.queryConfigs as Array<any>
    ).map((q: any) => {
      return q.metricAliasData.metricVariable;
    })) {
      expect(formula).toContain(alias);
    }
  });

  test("host-high-memory measures used memory, not the mean of every memory state", () => {
    const template: HostAlertTemplate =
      getHostAlertTemplateById("host-high-memory")!;
    const monitor: MonitorStepHostMonitor = getHostMonitor(
      template.getMonitorStep(buildArgs()),
    );

    const queryConfigs: Array<any> = monitor.metricViewConfig
      .queryConfigs as Array<any>;
    expect(queryConfigs).toHaveLength(1);
    expect(queryConfigs[0].metricQueryData.filterData.attributes).toEqual({
      state: "used",
    });
  });

  test("host-high-filesystem still raises one alert per mount", () => {
    /*
     * The group-by is the identity of the alert. Moving the query behind a
     * formula must not drop it, or one full mount silences every other mount
     * on the host for as long as its incident stays open.
     */
    const template: HostAlertTemplate = getHostAlertTemplateById(
      "host-high-filesystem",
    )!;
    const monitor: MonitorStepHostMonitor = getHostMonitor(
      template.getMonitorStep(buildArgs()),
    );

    expect(
      (monitor.metricViewConfig.queryConfigs as Array<any>)[0].metricQueryData
        .groupByAttributeKeys,
    ).toEqual(["mountpoint", "device"]);
  });

  test("host-high-processes copy does not claim a total process count", () => {
    /*
     * `system.processes.count` is one datapoint per process status, and this
     * query is ungrouped and unfiltered, so Max compares the largest single
     * status bucket. The old copy said "a monitored host has an unusually
     * high number of processes", which no one could reconcile with a process
     * listing.
     */
    const template: HostAlertTemplate = getHostAlertTemplateById(
      "host-high-processes",
    )!;
    const step: MonitorStep = template.getMonitorStep(buildArgs());
    const description: string = getOfflineInstance(step).data.incidents[0]
      .description as string;

    expect(description).toContain("largest single process-state bucket");
    expect(description).toContain("NOT the host's total process count");
    // The scraper is Linux-only; a silent monitor elsewhere needs saying.
    expect(description.toLowerCase()).toContain("linux only");
  });

  test("host-high-load-average admits its threshold is not core-normalized", () => {
    const template: HostAlertTemplate = getHostAlertTemplateById(
      "host-high-load-average",
    )!;
    const step: MonitorStep = template.getMonitorStep(buildArgs());
    const description: string = getOfflineInstance(step).data.incidents[0]
      .description as string;

    expect(description).toContain("NOT normalized by core count");
  });
});
