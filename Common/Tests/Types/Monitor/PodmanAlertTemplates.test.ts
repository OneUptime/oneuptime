import {
  PodmanAlertTemplate,
  PodmanAlertTemplateArgs,
  getAllPodmanAlertTemplates,
  getPodmanAlertTemplateById,
  getPodmanAlertTemplatesByCategory,
} from "../../../Types/Monitor/PodmanAlertTemplates";
import { getPodmanMetricByMetricName } from "../../../Types/Monitor/PodmanMetricCatalog";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepPodmanMonitor from "../../../Types/Monitor/MonitorStepPodmanMonitor";
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
 * Lock in the Podman alert-template contracts (structural twin of the
 * Docker suite — the templates mirror each other by design, so drift
 * between the two registries fails loudly here). Three layers:
 *
 *   1. ENUMERATED invariants run over getAllPodmanAlertTemplates(), so a
 *      newly added template is automatically covered: it must build a
 *      valid MonitorStep, reference only catalog metrics, resolve every
 *      criteria alias, stay host-scoped (no group-by keys — the worker
 *      scopes series by hostIdentifier), use disjoint fire/recover
 *      thresholds on the same alias, and keep the default Ignore
 *      no-data policy on every filter (no TreatAsZero — see layer 3).
 *
 *   2. A per-template expectation table pins the spec'd metric /
 *      aggregation / threshold / rolling-time decisions. The table is
 *      exhaustive both ways — adding a template without a row here
 *      fails loudly, which is the point.
 *
 *   3. Blackout contract: the worker's monitorPodman fetcher stamps
 *      MetricMonitorResponse.isTelemetrySourceReporting via the shared
 *      checkTelemetrySourceReporting liveness probe. Podman templates
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
     * Max so a single hot container trips the threshold instead of being
     * diluted by idle containers on the host.
     */
    id: "podman-high-cpu",
    name: "High Container CPU Usage",
    category: "Resource",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "container.cpu.utilization",
      aggregation: MetricsAggregationType.Max,
    },
    fire: {
      alias: "container_cpu",
      filterType: FilterType.GreaterThan,
      value: 80,
    },
    recover: {
      alias: "container_cpu",
      filterType: FilterType.LessThanOrEqualTo,
      value: 80,
    },
  },
  {
    // Max so a single container breaching its limit trips the threshold.
    id: "podman-high-memory",
    name: "High Container Memory Usage",
    category: "Resource",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "container.memory.percent",
      aggregation: MetricsAggregationType.Max,
    },
    fire: {
      alias: "container_memory",
      filterType: FilterType.GreaterThan,
      value: 85,
    },
    recover: {
      alias: "container_memory",
      filterType: FilterType.LessThanOrEqualTo,
      value: 85,
    },
  },
  {
    id: "podman-restart-loop",
    name: "Container Restart Loop",
    category: "Container",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "container.restarts",
      aggregation: MetricsAggregationType.Max,
    },
    fire: {
      alias: "container_restarts",
      filterType: FilterType.GreaterThan,
      value: 5,
    },
    recover: {
      alias: "container_restarts",
      filterType: FilterType.LessThanOrEqualTo,
      value: 5,
    },
  },
  {
    // Max so a single throttled container trips it (never Sum across all).
    id: "podman-cpu-throttling",
    name: "Container CPU Throttling",
    category: "Resource",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "container.cpu.throttling_data.throttled_time",
      aggregation: MetricsAggregationType.Max,
    },
    fire: {
      alias: "cpu_throttled",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
    recover: {
      alias: "cpu_throttled",
      filterType: FilterType.EqualTo,
      value: 0,
    },
  },
  {
    id: "podman-high-pids",
    name: "High Container Process Count",
    category: "Container",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "container.pids.count",
      aggregation: MetricsAggregationType.Max,
    },
    fire: {
      alias: "pids_count",
      filterType: FilterType.GreaterThan,
      value: 500,
    },
    recover: {
      alias: "pids_count",
      filterType: FilterType.LessThanOrEqualTo,
      value: 500,
    },
  },
  {
    /*
     * Min over Past1Minute so a single zero-uptime scrape (a stopped or
     * crashed container) trips it instead of being masked by scrapes
     * where the container was still up.
     */
    id: "podman-container-down",
    name: "Container Down (Low Uptime)",
    category: "Container",
    severity: "Critical",
    rollingTime: RollingTime.Past1Minute,
    query: {
      metricName: "container.uptime",
      aggregation: MetricsAggregationType.Min,
    },
    fire: {
      alias: "container_uptime",
      filterType: FilterType.EqualTo,
      value: 0,
    },
    recover: {
      alias: "container_uptime",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
  },
];

function buildArgs(): PodmanAlertTemplateArgs {
  return {
    hostIdentifier: "podman-host-prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
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
function getReferencableAliases(
  monitor: MonitorStepPodmanMonitor,
): Set<string> {
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
      // Container-down: fire when uptime == 0, recover when uptime > 0.
      return fire.value === 0 && recover.filterType === FilterType.GreaterThan;
    default:
      return false;
  }
}

const ALL_TEMPLATES: Array<PodmanAlertTemplate> = getAllPodmanAlertTemplates();

describe("PodmanAlertTemplates - registry", () => {
  test("template ids are unique and match the expectation table exactly", () => {
    const ids: Array<string> = ALL_TEMPLATES.map((t: PodmanAlertTemplate) => {
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

  test("getPodmanAlertTemplateById resolves every id (and misses cleanly)", () => {
    for (const expected of EXPECTED_TEMPLATES) {
      expect(getPodmanAlertTemplateById(expected.id)).toBeDefined();
    }
    expect(getPodmanAlertTemplateById("does-not-exist")).toBeUndefined();
  });

  test("getPodmanAlertTemplatesByCategory partitions the registry", () => {
    const resource: Array<PodmanAlertTemplate> =
      getPodmanAlertTemplatesByCategory("Resource");
    const container: Array<PodmanAlertTemplate> =
      getPodmanAlertTemplatesByCategory("Container");
    const host: Array<PodmanAlertTemplate> =
      getPodmanAlertTemplatesByCategory("Host");

    expect(
      resource
        .map((t: PodmanAlertTemplate) => {
          return t.id;
        })
        .sort(),
    ).toEqual(
      ["podman-high-cpu", "podman-high-memory", "podman-cpu-throttling"].sort(),
    );
    expect(
      container
        .map((t: PodmanAlertTemplate) => {
          return t.id;
        })
        .sort(),
    ).toEqual(
      [
        "podman-restart-loop",
        "podman-high-pids",
        "podman-container-down",
      ].sort(),
    );
    // The Host category exists in the type but carries no templates yet.
    expect(host).toHaveLength(0);

    // Every template lands in exactly one category.
    expect(resource.length + container.length + host.length).toBe(
      ALL_TEMPLATES.length,
    );
  });
});

describe("PodmanAlertTemplates - enumerated invariants (every template)", () => {
  test.each(
    ALL_TEMPLATES.map((t: PodmanAlertTemplate) => {
      return [t.id, t];
    }),
  )("%s builds a valid MonitorStep", (_id: unknown, template: unknown) => {
    const args: PodmanAlertTemplateArgs = buildArgs();
    const step: MonitorStep = (template as PodmanAlertTemplate).getMonitorStep(
      args,
    );
    const monitor: MonitorStepPodmanMonitor = getPodmanMonitor(step);

    // The host identifier is injected from the template args.
    expect(monitor.hostIdentifier).toBe(args.hostIdentifier);
    expect(monitor.containerFilters).toBeDefined();
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
    ALL_TEMPLATES.map((t: PodmanAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s references only catalog metrics and resolvable aliases",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as PodmanAlertTemplate
      ).getMonitorStep(buildArgs());
      const monitor: MonitorStepPodmanMonitor = getPodmanMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        const metricName: string =
          queryConfig.metricQueryData.filterData.metricName;
        expect(getPodmanMetricByMetricName(metricName)).toBeDefined();
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
    ALL_TEMPLATES.map((t: PodmanAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s is host-scoped: single query, no formulas, no group-by keys",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as PodmanAlertTemplate
      ).getMonitorStep(buildArgs());
      const monitor: MonitorStepPodmanMonitor = getPodmanMonitor(step);

      // Each Podman template reads exactly one container.* series.
      expect(monitor.metricViewConfig.queryConfigs).toHaveLength(1);
      expect(monitor.metricViewConfig.formulaConfigs || []).toHaveLength(0);

      /*
       * Podman templates aggregate across the host (the worker scopes
       * series by hostIdentifier); per-container fan-out is not part of
       * this contract, so no query may carry group-by attribute keys.
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
    ALL_TEMPLATES.map((t: PodmanAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s has disjoint fire/recover thresholds on the same alias",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as PodmanAlertTemplate
      ).getMonitorStep(buildArgs());
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
    ALL_TEMPLATES.map((t: PodmanAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s keeps the default Ignore no-data policy on every filter",
    (_id: unknown, template: unknown) => {
      /*
       * Structural half of the blackout contract: container.* series are
       * always present while the agent reports, so no filter may opt into
       * TreatAsZero (or Trigger) — absence must carry no signal in either
       * direction. A template that needs an absence-driven recover must
       * revisit the blackout tests below before opting in.
       */
      const step: MonitorStep = (
        template as PodmanAlertTemplate
      ).getMonitorStep(buildArgs());

      for (const instance of getCriteriaInstances(step)) {
        for (const filter of (instance.data?.filters || []) as Array<any>) {
          expect(filter.metricMonitorOptions.onNoDataPolicy).toBeUndefined();
        }
      }
    },
  );
});

describe("PodmanAlertTemplates - spec table expectations", () => {
  test.each(
    EXPECTED_TEMPLATES.map((t: TemplateExpectation) => {
      return [t.id, t];
    }),
  )(
    "%s matches the spec'd metric/aggregation/threshold contract",
    (_id: unknown, expected: unknown) => {
      const tc: TemplateExpectation = expected as TemplateExpectation;
      const template: PodmanAlertTemplate | undefined =
        getPodmanAlertTemplateById(tc.id);
      expect(template).toBeDefined();

      expect(template!.name).toBe(tc.name);
      expect(template!.category).toBe(tc.category);
      expect(template!.severity).toBe(tc.severity);

      const step: MonitorStep = template!.getMonitorStep(buildArgs());
      const monitor: MonitorStepPodmanMonitor = getPodmanMonitor(step);

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
 * Blackout contract: a total telemetry blackout — the Podman agent died,
 * so the host reports NOTHING — must never read as recovery. The
 * worker's monitorPodman fetcher stamps isTelemetrySourceReporting=false
 * on the response in that case (via checkTelemetrySourceReporting).
 * Podman templates keep the default Ignore no-data policy on every
 * filter, so absent data matches NO criteria under ANY flag value —
 * recovery is strictly value-driven. These tests drive the REAL
 * evaluator (processMonitorStep) with each template's actual
 * MonitorStep, so the contract covers the template → evaluator hand-off
 * rather than re-implementing filter semantics.
 */
describe("PodmanAlertTemplates - blackout contract (no auto-resolve on absent data)", () => {
  async function evaluateSnapshot(input: {
    step: MonitorStep;
    metricResult: Array<AggregatedResult>;
    isTelemetrySourceReporting: boolean | undefined;
  }): Promise<{
    criteriaMetId: string | undefined;
    criteriaResults: Array<MonitorEvaluationCriteriaResult>;
  }> {
    const monitor: Monitor = new Monitor();
    monitor.monitorType = MonitorType.Podman;

    const monitorId: ObjectID = ObjectID.generate();

    const dataToProcess: MetricMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: monitorId,
      metricResult: input.metricResult,
      metricViewConfig: getPodmanMonitor(input.step).metricViewConfig,
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
    ALL_TEMPLATES.map((t: PodmanAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s: total blackout matches NO criteria — no recover, no status flip, no auto-resolve",
    async (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as PodmanAlertTemplate
      ).getMonitorStep(buildArgs());

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
    ALL_TEMPLATES.map((t: PodmanAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s: absent data never reads as recovery even while the source reports (value-driven recovery only)",
    async (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as PodmanAlertTemplate
      ).getMonitorStep(buildArgs());

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
    ALL_TEMPLATES.map((t: PodmanAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s: unknown liveness (legacy fetcher, flag unset) keeps the same no-data behavior",
    async (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as PodmanAlertTemplate
      ).getMonitorStep(buildArgs());

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
    ALL_TEMPLATES.map((t: PodmanAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s: breaching data on a live source fires the unhealthy criteria",
    async (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as PodmanAlertTemplate
      ).getMonitorStep(buildArgs());
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
    ALL_TEMPLATES.map((t: PodmanAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s: value-driven recovery is unaffected — recovers on real healthy data",
    async (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as PodmanAlertTemplate
      ).getMonitorStep(buildArgs());
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

  test("podman-container-down: fires on a stopped container, then HOLDS (not resolves) when the agent goes dark", async () => {
    const template: PodmanAlertTemplate | undefined =
      getPodmanAlertTemplateById("podman-container-down");
    expect(template).toBeDefined();

    const step: MonitorStep = template!.getMonitorStep(buildArgs());
    const fireInstance: MonitorCriteriaInstance = offlineInstanceOf(step);

    // Container stopped: the agent still reports, uptime is 0.
    const firing: {
      criteriaMetId: string | undefined;
      criteriaResults: Array<MonitorEvaluationCriteriaResult>;
    } = await evaluateSnapshot({
      step: step,
      metricResult: [{ data: [{ timestamp: new Date(), value: 0 }] }],
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
