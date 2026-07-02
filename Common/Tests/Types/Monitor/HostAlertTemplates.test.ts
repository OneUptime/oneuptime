import {
  HostAlertTemplate,
  HostAlertTemplateArgs,
  getAllHostAlertTemplates,
  getHostAlertTemplateById,
  getHostAlertTemplatesByCategory,
} from "../../../Types/Monitor/HostAlertTemplates";
import { getHostMetricByMetricName } from "../../../Types/Monitor/HostMetricCatalog";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepHostMonitor from "../../../Types/Monitor/MonitorStepHostMonitor";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../Types/ObjectID";
import MonitorCriteriaEvaluator from "../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import ProbeApiIngestResponse from "../../../Types/Probe/ProbeApiIngestResponse";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";

/*
 * Lock in the Host alert-template contracts (mirrors the DockerSwarm /
 * Ceph precedents). Three layers:
 *
 *   1. ENUMERATED invariants run over getAllHostAlertTemplates(), so a
 *      newly added template is automatically covered: it must build a
 *      valid MonitorStep, reference only catalog metrics, resolve every
 *      criteria alias, stay host-scoped (no group-by keys — the worker
 *      scopes series by hostIdentifier), use disjoint fire/recover
 *      thresholds on the same alias, and keep the default Ignore
 *      no-data policy on every filter (no TreatAsZero — see layer 3).
 *
 *   2. A per-template expectation table pins the spec'd metric /
 *      aggregation / threshold / rolling-time decisions — including the
 *      [0, 1]-ratio thresholds (system.*.utilization is an OTel ratio,
 *      so 80% is 0.8, NOT 80). The table is exhaustive both ways.
 *
 *   3. Blackout contract: the worker's monitorHost fetcher stamps
 *      MetricMonitorResponse.isTelemetrySourceReporting via the shared
 *      checkTelemetrySourceReporting liveness probe. Host templates
 *      never TreatAsZero, so absent data must match NO criteria under
 *      ANY liveness flag — recovery is strictly value-driven. The
 *      blackout tests drive the REAL evaluator (processMonitorStep)
 *      with each template's actual MonitorStep, so the contract covers
 *      the template → evaluator hand-off: false → no criteria met (no
 *      recover, no status flip, no auto-resolve), true → normal
 *      value-driven evaluation, undefined → legacy behavior (identical
 *      on absent data, since Ignore already refuses to read absence).
 */

interface QueryExpectation {
  metricName: string;
  aggregation: MetricsAggregationType;
}

interface ThresholdExpectation {
  alias: string;
  filterType: FilterType;
  value: number;
}

interface TemplateExpectation {
  id: string;
  name: string;
  category: string;
  severity: string;
  rollingTime: RollingTime;
  query: QueryExpectation;
  fire: ThresholdExpectation;
  recover: ThresholdExpectation;
}

const EXPECTED_TEMPLATES: Array<TemplateExpectation> = [
  {
    /*
     * system.cpu.utilization is a [0, 1] ratio — the threshold is 0.8,
     * not 80. Avg because host CPU is a sustained-utilization signal.
     */
    id: "host-high-cpu",
    name: "High CPU Utilization",
    category: "Resource",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "system.cpu.utilization",
      aggregation: MetricsAggregationType.Avg,
    },
    fire: {
      alias: "host_cpu",
      filterType: FilterType.GreaterThan,
      value: 0.8,
    },
    recover: {
      alias: "host_cpu",
      filterType: FilterType.LessThanOrEqualTo,
      value: 0.8,
    },
  },
  {
    // system.memory.utilization is a [0, 1] ratio, so 0.85 == 85%.
    id: "host-high-memory",
    name: "High Memory Utilization",
    category: "Resource",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "system.memory.utilization",
      aggregation: MetricsAggregationType.Avg,
    },
    fire: {
      alias: "host_memory",
      filterType: FilterType.GreaterThan,
      value: 0.85,
    },
    recover: {
      alias: "host_memory",
      filterType: FilterType.LessThanOrEqualTo,
      value: 0.85,
    },
  },
  {
    /*
     * Max so a single full filesystem trips the threshold instead of
     * being diluted by averaging across mounted filesystems. [0, 1]
     * ratio: 0.9 == 90%.
     */
    id: "host-high-filesystem",
    name: "High Filesystem Usage",
    category: "Resource",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "system.filesystem.utilization",
      aggregation: MetricsAggregationType.Max,
    },
    fire: {
      alias: "host_filesystem",
      filterType: FilterType.GreaterThan,
      value: 0.9,
    },
    recover: {
      alias: "host_filesystem",
      filterType: FilterType.LessThanOrEqualTo,
      value: 0.9,
    },
  },
  {
    id: "host-high-load-average",
    name: "High Load Average (1m)",
    category: "Resource",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "system.cpu.load_average.1m",
      aggregation: MetricsAggregationType.Avg,
    },
    fire: {
      alias: "host_load_1m",
      filterType: FilterType.GreaterThan,
      value: 4,
    },
    recover: {
      alias: "host_load_1m",
      filterType: FilterType.LessThanOrEqualTo,
      value: 4,
    },
  },
  {
    // Max — any scrape over the threshold trips it (fork bomb/leak).
    id: "host-high-processes",
    name: "High Process Count",
    category: "Host",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "system.processes.count",
      aggregation: MetricsAggregationType.Max,
    },
    fire: {
      alias: "host_processes",
      filterType: FilterType.GreaterThan,
      value: 2000,
    },
    recover: {
      alias: "host_processes",
      filterType: FilterType.LessThanOrEqualTo,
      value: 2000,
    },
  },
];

function buildArgs(): HostAlertTemplateArgs {
  return {
    hostIdentifier: "host-prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
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

function getCriteriaInstances(
  step: MonitorStep,
): Array<MonitorCriteriaInstance> {
  const instances: Array<MonitorCriteriaInstance> | undefined =
    step.data?.monitorCriteria.data?.monitorCriteriaInstanceArray;
  if (!instances || instances.length === 0) {
    throw new Error("monitorCriteria missing from monitor step");
  }
  return instances;
}

// Aliases a criteria filter may legally reference: query + formula variables.
function getReferencableAliases(monitor: MonitorStepHostMonitor): Set<string> {
  const aliases: Set<string> = new Set<string>();
  for (const queryConfig of monitor.metricViewConfig
    .queryConfigs as Array<any>) {
    aliases.add(queryConfig.metricAliasData.metricVariable);
  }
  for (const formulaConfig of (monitor.metricViewConfig.formulaConfigs ||
    []) as Array<any>) {
    aliases.add(formulaConfig.metricAliasData.metricVariable);
  }
  return aliases;
}

/*
 * Fire and recover must be disjoint complements on the same alias —
 * otherwise the monitor either flaps (overlap) or wedges (gap).
 */
function isDisjointComplement(
  fire: { filterType: FilterType; value: number },
  recover: { filterType: FilterType; value: number },
): boolean {
  if (fire.value !== recover.value) {
    return false;
  }
  switch (fire.filterType) {
    case FilterType.GreaterThan:
      return (
        recover.filterType === FilterType.LessThanOrEqualTo ||
        (fire.value === 0 && recover.filterType === FilterType.EqualTo)
      );
    case FilterType.GreaterThanOrEqualTo:
      return recover.filterType === FilterType.LessThan;
    case FilterType.LessThan:
      return recover.filterType === FilterType.GreaterThanOrEqualTo;
    case FilterType.LessThanOrEqualTo:
      return recover.filterType === FilterType.GreaterThan;
    case FilterType.EqualTo:
      return fire.value === 0 && recover.filterType === FilterType.GreaterThan;
    default:
      return false;
  }
}

const ALL_TEMPLATES: Array<HostAlertTemplate> = getAllHostAlertTemplates();

describe("HostAlertTemplates - registry", () => {
  test("template ids are unique and match the expectation table exactly", () => {
    const ids: Array<string> = ALL_TEMPLATES.map((t: HostAlertTemplate) => {
      return t.id;
    });
    expect(new Set(ids).size).toBe(ids.length);
    // Exhaustive both ways: a new template must get an expectation row.
    expect([...ids].sort()).toEqual(
      EXPECTED_TEMPLATES.map((t: TemplateExpectation) => {
        return t.id;
      }).sort(),
    );
  });

  test("getHostAlertTemplateById resolves every id (and misses cleanly)", () => {
    for (const expected of EXPECTED_TEMPLATES) {
      expect(getHostAlertTemplateById(expected.id)).toBeDefined();
    }
    expect(getHostAlertTemplateById("does-not-exist")).toBeUndefined();
  });

  test("getHostAlertTemplatesByCategory partitions the registry", () => {
    const resource: Array<HostAlertTemplate> =
      getHostAlertTemplatesByCategory("Resource");
    const host: Array<HostAlertTemplate> =
      getHostAlertTemplatesByCategory("Host");

    expect(
      resource
        .map((t: HostAlertTemplate) => {
          return t.id;
        })
        .sort(),
    ).toEqual(
      [
        "host-high-cpu",
        "host-high-memory",
        "host-high-filesystem",
        "host-high-load-average",
      ].sort(),
    );
    expect(
      host.map((t: HostAlertTemplate) => {
        return t.id;
      }),
    ).toEqual(["host-high-processes"]);

    // Every template lands in exactly one of the two categories.
    expect(resource.length + host.length).toBe(ALL_TEMPLATES.length);
  });
});

describe("HostAlertTemplates - enumerated invariants (every template)", () => {
  test.each(
    ALL_TEMPLATES.map((t: HostAlertTemplate) => {
      return [t.id, t];
    }),
  )("%s builds a valid MonitorStep", (_id: unknown, template: unknown) => {
    const args: HostAlertTemplateArgs = buildArgs();
    const step: MonitorStep = (template as HostAlertTemplate).getMonitorStep(
      args,
    );
    const monitor: MonitorStepHostMonitor = getHostMonitor(step);

    // The host identifier is injected from the template args.
    expect(monitor.hostIdentifier).toBe(args.hostIdentifier);
    expect(monitor.metricViewConfig.queryConfigs.length).toBeGreaterThan(0);

    const instances: Array<MonitorCriteriaInstance> =
      getCriteriaInstances(step);
    expect(instances.length).toBeGreaterThanOrEqual(2);

    /*
     * Criteria are evaluated first-match-wins: every instance before the
     * last is an unhealthy tier (creates incidents + alerts, flips to the
     * offline status); the LAST is the recover instance (no incidents,
     * flips to the online status).
     */
    const offlineInstances: Array<MonitorCriteriaInstance> = instances.slice(
      0,
      -1,
    );
    const onlineInstance: MonitorCriteriaInstance =
      instances[instances.length - 1]!;

    for (const offline of offlineInstances) {
      expect(offline.data?.monitorStatusId).toBe(args.offlineMonitorStatusId);
      expect(offline.data?.createIncidents).toBe(true);
      expect(offline.data?.createAlerts).toBe(true);
      expect(offline.data?.incidents).toHaveLength(1);
      expect(offline.data?.alerts).toHaveLength(1);
      expect(offline.data?.incidents?.[0]?.autoResolveIncident).toBe(true);
      expect(offline.data?.alerts?.[0]?.autoResolveAlert).toBe(true);
    }

    expect(onlineInstance.data?.monitorStatusId).toBe(
      args.onlineMonitorStatusId,
    );
    expect(onlineInstance.data?.createIncidents).toBe(false);
    expect(onlineInstance.data?.createAlerts).toBe(false);
    expect(onlineInstance.data?.name).toBe("Healthy");
  });

  test.each(
    ALL_TEMPLATES.map((t: HostAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s references only catalog metrics and resolvable aliases",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as HostAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const monitor: MonitorStepHostMonitor = getHostMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        const metricName: string =
          queryConfig.metricQueryData.filterData.metricName;
        expect(getHostMetricByMetricName(metricName)).toBeDefined();
      }

      const aliases: Set<string> = getReferencableAliases(monitor);
      for (const instance of getCriteriaInstances(step)) {
        for (const filter of instance.data?.filters || []) {
          expect(aliases).toContain(
            (filter as any).metricMonitorOptions.metricAlias,
          );
        }
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: HostAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s is host-scoped: single query, no formulas, no group-by keys",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as HostAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const monitor: MonitorStepHostMonitor = getHostMonitor(step);

      // Each Host template reads exactly one system.* series.
      expect(monitor.metricViewConfig.queryConfigs).toHaveLength(1);
      expect(monitor.metricViewConfig.formulaConfigs || []).toHaveLength(0);

      /*
       * Host templates aggregate across the host (the worker scopes
       * series by hostIdentifier), so no query may carry group-by
       * attribute keys.
       */
      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        expect(queryConfig.metricQueryData.groupByAttributeKeys || []).toEqual(
          [],
        );
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: HostAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s has disjoint fire/recover thresholds on the same alias",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as HostAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const instances: Array<MonitorCriteriaInstance> =
        getCriteriaInstances(step);
      const onlineFilters: Array<any> = (instances[instances.length - 1]!.data
        ?.filters || []) as Array<any>;

      for (const offline of instances.slice(0, -1)) {
        for (const fireFilter of (offline.data?.filters || []) as Array<any>) {
          const recoverFilter: any = onlineFilters.find((f: any) => {
            return (
              f.metricMonitorOptions.metricAlias ===
              fireFilter.metricMonitorOptions.metricAlias
            );
          });
          expect(recoverFilter).toBeDefined();
          expect(
            isDisjointComplement(
              {
                filterType: fireFilter.filterType,
                value: fireFilter.value as number,
              },
              {
                filterType: recoverFilter.filterType,
                value: recoverFilter.value as number,
              },
            ),
          ).toBe(true);
        }
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: HostAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s keeps the default Ignore no-data policy on every filter",
    (_id: unknown, template: unknown) => {
      /*
       * Structural half of the blackout contract: system.* series are
       * always present while the agent reports, so no filter may opt into
       * TreatAsZero (or Trigger) — absence must carry no signal in either
       * direction. A template that needs an absence-driven recover must
       * revisit the blackout tests below before opting in.
       */
      const step: MonitorStep = (template as HostAlertTemplate).getMonitorStep(
        buildArgs(),
      );

      for (const instance of getCriteriaInstances(step)) {
        for (const filter of (instance.data?.filters || []) as Array<any>) {
          expect(filter.metricMonitorOptions.onNoDataPolicy).toBeUndefined();
        }
      }
    },
  );
});

describe("HostAlertTemplates - spec table expectations", () => {
  test.each(
    EXPECTED_TEMPLATES.map((t: TemplateExpectation) => {
      return [t.id, t];
    }),
  )(
    "%s matches the spec'd metric/aggregation/threshold contract",
    (_id: unknown, expected: unknown) => {
      const tc: TemplateExpectation = expected as TemplateExpectation;
      const template: HostAlertTemplate | undefined = getHostAlertTemplateById(
        tc.id,
      );
      expect(template).toBeDefined();

      expect(template!.name).toBe(tc.name);
      expect(template!.category).toBe(tc.category);
      expect(template!.severity).toBe(tc.severity);

      const step: MonitorStep = template!.getMonitorStep(buildArgs());
      const monitor: MonitorStepHostMonitor = getHostMonitor(step);

      expect(monitor.rollingTime).toBe(tc.rollingTime);

      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      expect(queryConfigs).toHaveLength(1);

      const filterData: any = queryConfigs[0].metricQueryData.filterData;
      expect(filterData.metricName).toBe(tc.query.metricName);
      expect(filterData.aggegationType).toBe(tc.query.aggregation);

      const instances: Array<MonitorCriteriaInstance> =
        getCriteriaInstances(step);
      expect(instances).toHaveLength(2);

      const fireFilter: any = (instances[0]!.data?.filters as Array<any>)[0];
      expect(fireFilter.metricMonitorOptions.metricAlias).toBe(tc.fire.alias);
      expect(fireFilter.filterType).toBe(tc.fire.filterType);
      expect(fireFilter.value).toBe(tc.fire.value);

      const recoverFilter: any = (instances[1]!.data?.filters as Array<any>)[0];
      expect(recoverFilter.metricMonitorOptions.metricAlias).toBe(
        tc.recover.alias,
      );
      expect(recoverFilter.filterType).toBe(tc.recover.filterType);
      expect(recoverFilter.value).toBe(tc.recover.value);
    },
  );
});

/*
 * Blackout contract: a total telemetry blackout — the infrastructure
 * agent died, so the host reports NOTHING — must never read as
 * recovery. The worker's monitorHost fetcher stamps
 * isTelemetrySourceReporting=false on the response in that case (via
 * checkTelemetrySourceReporting). Host templates keep the default
 * Ignore no-data policy on every filter, so absent data matches NO
 * criteria under ANY flag value — recovery is strictly value-driven.
 * These tests drive the REAL evaluator (processMonitorStep) with each
 * template's actual MonitorStep, so the contract covers the template →
 * evaluator hand-off rather than re-implementing filter semantics.
 */
describe("HostAlertTemplates - blackout contract (no auto-resolve on absent data)", () => {
  async function evaluateSnapshot(input: {
    step: MonitorStep;
    metricResult: Array<AggregatedResult>;
    isTelemetrySourceReporting: boolean | undefined;
  }): Promise<{
    criteriaMetId: string | undefined;
    criteriaResults: Array<MonitorEvaluationCriteriaResult>;
  }> {
    const monitor: Monitor = new Monitor();
    monitor.monitorType = MonitorType.Host;

    const monitorId: ObjectID = ObjectID.generate();

    const dataToProcess: MetricMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: monitorId,
      metricResult: input.metricResult,
      metricViewConfig: getHostMonitor(input.step).metricViewConfig,
      isTelemetrySourceReporting: input.isTelemetrySourceReporting,
    };

    const evaluationSummary: MonitorEvaluationSummary = {
      evaluatedAt: new Date(),
      criteriaResults: [],
      events: [],
    };

    const probeApiIngestResponse: ProbeApiIngestResponse = {
      monitorId: monitorId,
      rootCause: null,
    };

    const result: ProbeApiIngestResponse =
      await MonitorCriteriaEvaluator.processMonitorStep({
        dataToProcess: dataToProcess,
        monitorStep: input.step,
        monitor: monitor,
        probeApiIngestResponse: probeApiIngestResponse,
        evaluationSummary: evaluationSummary,
      });

    return {
      criteriaMetId: result.criteriaMetId,
      criteriaResults: evaluationSummary.criteriaResults,
    };
  }

  function offlineInstanceOf(step: MonitorStep): MonitorCriteriaInstance {
    return getCriteriaInstances(step)[0]!;
  }

  function onlineInstanceOf(step: MonitorStep): MonitorCriteriaInstance {
    const instances: Array<MonitorCriteriaInstance> =
      getCriteriaInstances(step);
    return instances[instances.length - 1]!;
  }

  function firstFilterOf(instance: MonitorCriteriaInstance): {
    filterType: FilterType;
    value: number;
  } {
    const filter: any = (instance.data?.filters as Array<any>)[0];
    return { filterType: filter.filterType, value: filter.value as number };
  }

  // A sample value that satisfies the given threshold filter.
  function valueSatisfying(filter: {
    filterType: FilterType;
    value: number;
  }): number {
    switch (filter.filterType) {
      case FilterType.GreaterThan:
        return filter.value + 1;
      case FilterType.GreaterThanOrEqualTo:
        return filter.value;
      case FilterType.LessThan:
        return filter.value - 1;
      case FilterType.LessThanOrEqualTo:
        return filter.value;
      case FilterType.EqualTo:
        return filter.value;
      default:
        throw new Error(`No sample value for filter type ${filter.filterType}`);
    }
  }

  test.each(
    ALL_TEMPLATES.map((t: HostAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s: total blackout matches NO criteria — no recover, no status flip, no auto-resolve",
    async (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as HostAlertTemplate).getMonitorStep(
        buildArgs(),
      );

      const outcome: {
        criteriaMetId: string | undefined;
        criteriaResults: Array<MonitorEvaluationCriteriaResult>;
      } = await evaluateSnapshot({
        step: step,
        metricResult: [],
        isTelemetrySourceReporting: false,
      });

      expect(outcome.criteriaMetId).toBeUndefined();
      // Every instance — fire AND recover — must report not-met.
      expect(outcome.criteriaResults.length).toBeGreaterThan(0);
      for (const criteriaResult of outcome.criteriaResults) {
        expect(criteriaResult.met).toBe(false);
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: HostAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s: absent data never reads as recovery even while the source reports (value-driven recovery only)",
    async (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as HostAlertTemplate).getMonitorStep(
        buildArgs(),
      );

      const outcome: {
        criteriaMetId: string | undefined;
        criteriaResults: Array<MonitorEvaluationCriteriaResult>;
      } = await evaluateSnapshot({
        step: step,
        metricResult: [],
        isTelemetrySourceReporting: true,
      });

      expect(outcome.criteriaMetId).toBeUndefined();
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: HostAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s: unknown liveness (legacy fetcher, flag unset) keeps the same no-data behavior",
    async (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as HostAlertTemplate).getMonitorStep(
        buildArgs(),
      );

      const outcome: {
        criteriaMetId: string | undefined;
        criteriaResults: Array<MonitorEvaluationCriteriaResult>;
      } = await evaluateSnapshot({
        step: step,
        metricResult: [],
        isTelemetrySourceReporting: undefined,
      });

      expect(outcome.criteriaMetId).toBeUndefined();
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: HostAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s: breaching data on a live source fires the unhealthy criteria",
    async (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as HostAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const fireInstance: MonitorCriteriaInstance = offlineInstanceOf(step);

      const outcome: {
        criteriaMetId: string | undefined;
        criteriaResults: Array<MonitorEvaluationCriteriaResult>;
      } = await evaluateSnapshot({
        step: step,
        metricResult: [
          {
            data: [
              {
                timestamp: new Date(),
                value: valueSatisfying(firstFilterOf(fireInstance)),
              },
            ],
          },
        ],
        isTelemetrySourceReporting: true,
      });

      expect(outcome.criteriaMetId).toBe(fireInstance.data?.id);
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: HostAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s: value-driven recovery is unaffected — recovers on real healthy data",
    async (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as HostAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const onlineInstance: MonitorCriteriaInstance = onlineInstanceOf(step);

      const outcome: {
        criteriaMetId: string | undefined;
        criteriaResults: Array<MonitorEvaluationCriteriaResult>;
      } = await evaluateSnapshot({
        step: step,
        metricResult: [
          {
            data: [
              {
                timestamp: new Date(),
                value: valueSatisfying(firstFilterOf(onlineInstance)),
              },
            ],
          },
        ],
        isTelemetrySourceReporting: true,
      });

      expect(outcome.criteriaMetId).toBe(onlineInstance.data?.id);
    },
  );

  test("host-high-filesystem: fires on a full disk, then HOLDS (not resolves) when the agent goes dark", async () => {
    const template: HostAlertTemplate | undefined = getHostAlertTemplateById(
      "host-high-filesystem",
    );
    expect(template).toBeDefined();

    const step: MonitorStep = template!.getMonitorStep(buildArgs());
    const fireInstance: MonitorCriteriaInstance = offlineInstanceOf(step);

    // Disk at 95%: the agent still reports, utilization is 0.95.
    const firing: {
      criteriaMetId: string | undefined;
      criteriaResults: Array<MonitorEvaluationCriteriaResult>;
    } = await evaluateSnapshot({
      step: step,
      metricResult: [{ data: [{ timestamp: new Date(), value: 0.95 }] }],
      isTelemetrySourceReporting: true,
    });
    expect(firing.criteriaMetId).toBe(fireInstance.data?.id);

    // Agent dies: series vanish entirely. State must hold.
    const blackout: {
      criteriaMetId: string | undefined;
      criteriaResults: Array<MonitorEvaluationCriteriaResult>;
    } = await evaluateSnapshot({
      step: step,
      metricResult: [],
      isTelemetrySourceReporting: false,
    });
    expect(blackout.criteriaMetId).toBeUndefined();
  });
});
