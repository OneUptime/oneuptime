import {
  IoTAlertTemplate,
  IoTAlertTemplateArgs,
  getAllIoTAlertTemplates,
  getIoTAlertTemplateById,
  getIoTAlertTemplatesByCategory,
} from "../../../Types/Monitor/IotAlertTemplates";
import { getIoTMetricByMetricName } from "../../../Types/Monitor/IotMetricCatalog";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepIoTMonitor from "../../../Types/Monitor/MonitorStepIoTMonitor";
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
 * Lock in the IoT alert-template contracts (mirrors the DockerSwarm /
 * Ceph precedents). Three layers:
 *
 *   1. ENUMERATED invariants run over getAllIoTAlertTemplates(), so a
 *      newly added template is automatically covered: it must build a
 *      valid MonitorStep, reference only catalog metrics, resolve every
 *      criteria alias, group by the raw `device.id` datapoint label
 *      (device identity lives in datapoint labels — NEVER `resource.`
 *      -prefixed, per the filter contract in IotAlertTemplates.ts) so
 *      one incident fires per device, use disjoint fire/recover
 *      thresholds on the same alias, and keep the default Ignore
 *      no-data policy on every filter (no TreatAsZero — see layer 3).
 *
 *   2. A per-template expectation table pins the spec'd metric /
 *      aggregation / threshold / rolling-time decisions (Min for
 *      device_up so one down push trips it; Avg for the level readings
 *      battery/signal/cpu; Max for temperature so one hot reading
 *      trips it). The table is exhaustive both ways.
 *
 *   3. Blackout contract: the worker's monitorIoT fetcher stamps
 *      MetricMonitorResponse.isTelemetrySourceReporting via the shared
 *      checkTelemetrySourceReporting liveness probe. IoT templates
 *      never TreatAsZero, so absent data must match NO criteria under
 *      ANY liveness flag — recovery is strictly value-driven. This
 *      matters doubly for IoT: a fleet that stops pushing entirely
 *      (dead gateway) must hold open incidents rather than auto-resolve
 *      them. The blackout tests drive the REAL evaluator
 *      (processMonitorStep) with each template's actual MonitorStep:
 *      false → no criteria met (no recover, no status flip, no
 *      auto-resolve), true → normal value-driven evaluation, undefined
 *      → legacy behavior (identical on absent data, since Ignore
 *      already refuses to read absence).
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
  groupBy: string;
  fire: ThresholdExpectation;
  recover: ThresholdExpectation;
}

const EXPECTED_TEMPLATES: Array<TemplateExpectation> = [
  {
    /*
     * Min per device — a single down push trips the threshold instead of
     * being masked by pushes where the device was still up.
     */
    id: "iot-device-offline",
    name: "Device Offline",
    category: "Availability",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "iot_device_up",
      aggregation: MetricsAggregationType.Min,
    },
    groupBy: "device.id",
    fire: {
      alias: "device_up",
      filterType: FilterType.LessThan,
      value: 1,
    },
    recover: {
      alias: "device_up",
      filterType: FilterType.GreaterThanOrEqualTo,
      value: 1,
    },
  },
  {
    // Battery percentage is a slow-moving level reading -> Avg per device.
    id: "iot-low-battery",
    name: "Low Battery",
    category: "Power",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "iot_battery_percent",
      aggregation: MetricsAggregationType.Avg,
    },
    groupBy: "device.id",
    fire: {
      alias: "battery_percent",
      filterType: FilterType.LessThan,
      value: 20,
    },
    recover: {
      alias: "battery_percent",
      filterType: FilterType.GreaterThanOrEqualTo,
      value: 20,
    },
  },
  {
    // Signal strength (dBm) is a level reading -> Avg per device.
    id: "iot-weak-signal",
    name: "Weak Signal",
    category: "Connectivity",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "iot_signal_strength_dbm",
      aggregation: MetricsAggregationType.Avg,
    },
    groupBy: "device.id",
    fire: {
      alias: "signal_strength",
      filterType: FilterType.LessThan,
      value: -100,
    },
    recover: {
      alias: "signal_strength",
      filterType: FilterType.GreaterThanOrEqualTo,
      value: -100,
    },
  },
  {
    // Max per device — a single hot reading should trip the threshold.
    id: "iot-high-temperature",
    name: "High Temperature",
    category: "Environment",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "iot_temperature_celsius",
      aggregation: MetricsAggregationType.Max,
    },
    groupBy: "device.id",
    fire: {
      alias: "temperature_celsius",
      filterType: FilterType.GreaterThan,
      value: 70,
    },
    recover: {
      alias: "temperature_celsius",
      filterType: FilterType.LessThanOrEqualTo,
      value: 70,
    },
  },
  {
    // iot_cpu_usage_ratio is a true [0, 1] ratio -> Avg per device.
    id: "iot-high-cpu",
    name: "High CPU Usage",
    category: "System",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "iot_cpu_usage_ratio",
      aggregation: MetricsAggregationType.Avg,
    },
    groupBy: "device.id",
    fire: {
      alias: "cpu_usage",
      filterType: FilterType.GreaterThan,
      value: 0.9,
    },
    recover: {
      alias: "cpu_usage",
      filterType: FilterType.LessThanOrEqualTo,
      value: 0.9,
    },
  },
];

function buildArgs(): IoTAlertTemplateArgs {
  return {
    fleetIdentifier: "iot-fleet-prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
  };
}

function getIoTMonitor(step: MonitorStep): MonitorStepIoTMonitor {
  const iotMonitor: MonitorStepIoTMonitor | undefined = step.data?.iotMonitor;
  if (!iotMonitor) {
    throw new Error("iotMonitor missing from monitor step");
  }
  return iotMonitor;
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
function getReferencableAliases(monitor: MonitorStepIoTMonitor): Set<string> {
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

const ALL_TEMPLATES: Array<IoTAlertTemplate> = getAllIoTAlertTemplates();

describe("IotAlertTemplates - registry", () => {
  test("template ids are unique and match the expectation table exactly", () => {
    const ids: Array<string> = ALL_TEMPLATES.map((t: IoTAlertTemplate) => {
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

  test("getIoTAlertTemplateById resolves every id (and misses cleanly)", () => {
    for (const expected of EXPECTED_TEMPLATES) {
      expect(getIoTAlertTemplateById(expected.id)).toBeDefined();
    }
    expect(getIoTAlertTemplateById("does-not-exist")).toBeUndefined();
  });

  test("getIoTAlertTemplatesByCategory partitions the registry", () => {
    const availability: Array<IoTAlertTemplate> =
      getIoTAlertTemplatesByCategory("Availability");
    const power: Array<IoTAlertTemplate> =
      getIoTAlertTemplatesByCategory("Power");
    const connectivity: Array<IoTAlertTemplate> =
      getIoTAlertTemplatesByCategory("Connectivity");
    const environment: Array<IoTAlertTemplate> =
      getIoTAlertTemplatesByCategory("Environment");
    const system: Array<IoTAlertTemplate> =
      getIoTAlertTemplatesByCategory("System");

    expect(
      availability.map((t: IoTAlertTemplate) => {
        return t.id;
      }),
    ).toEqual(["iot-device-offline"]);
    expect(
      power.map((t: IoTAlertTemplate) => {
        return t.id;
      }),
    ).toEqual(["iot-low-battery"]);
    expect(
      connectivity.map((t: IoTAlertTemplate) => {
        return t.id;
      }),
    ).toEqual(["iot-weak-signal"]);
    expect(
      environment.map((t: IoTAlertTemplate) => {
        return t.id;
      }),
    ).toEqual(["iot-high-temperature"]);
    expect(
      system.map((t: IoTAlertTemplate) => {
        return t.id;
      }),
    ).toEqual(["iot-high-cpu"]);

    // Every template lands in exactly one of the five categories.
    expect(
      availability.length +
        power.length +
        connectivity.length +
        environment.length +
        system.length,
    ).toBe(ALL_TEMPLATES.length);
  });
});

describe("IotAlertTemplates - enumerated invariants (every template)", () => {
  test.each(
    ALL_TEMPLATES.map((t: IoTAlertTemplate) => {
      return [t.id, t];
    }),
  )("%s builds a valid MonitorStep", (_id: unknown, template: unknown) => {
    const args: IoTAlertTemplateArgs = buildArgs();
    const step: MonitorStep = (template as IoTAlertTemplate).getMonitorStep(
      args,
    );
    const monitor: MonitorStepIoTMonitor = getIoTMonitor(step);

    // The fleet identifier is injected from the template args.
    expect(monitor.fleetIdentifier).toBe(args.fleetIdentifier);
    expect(monitor.resourceFilters).toBeDefined();
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
    ALL_TEMPLATES.map((t: IoTAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s references only catalog metrics and resolvable aliases",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as IoTAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const monitor: MonitorStepIoTMonitor = getIoTMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        const metricName: string =
          queryConfig.metricQueryData.filterData.metricName;
        expect(getIoTMetricByMetricName(metricName)).toBeDefined();
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
    ALL_TEMPLATES.map((t: IoTAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s groups by the device.id datapoint label only (never resource.-prefixed)",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as IoTAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const monitor: MonitorStepIoTMonitor = getIoTMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        /*
         * Device identity is the `device.id` DATAPOINT label. A
         * `resource.`-prefixed key would match nothing in ClickHouse and
         * collapse every device into one mislabeled series — and without
         * the group-by, one down device would be masked by the rest of
         * the fleet under Avg/Min aggregation.
         */
        expect(queryConfig.metricQueryData.groupByAttributeKeys).toEqual([
          "device.id",
        ]);
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: IoTAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s is single-query with no formulas (per-device level reading)",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as IoTAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const monitor: MonitorStepIoTMonitor = getIoTMonitor(step);

      expect(monitor.metricViewConfig.queryConfigs).toHaveLength(1);
      expect(monitor.metricViewConfig.formulaConfigs || []).toHaveLength(0);
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: IoTAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s has disjoint fire/recover thresholds on the same alias",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as IoTAlertTemplate).getMonitorStep(
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
    ALL_TEMPLATES.map((t: IoTAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s keeps the default Ignore no-data policy on every filter",
    (_id: unknown, template: unknown) => {
      /*
       * Structural half of the blackout contract: IoT series exist only
       * while devices push, and battery-powered devices routinely go
       * quiet — so no filter may opt into TreatAsZero (or Trigger).
       * Absence must carry no signal in either direction; in particular
       * a silent fleet must never read `device_up >= 1` as recovered.
       */
      const step: MonitorStep = (template as IoTAlertTemplate).getMonitorStep(
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

describe("IotAlertTemplates - spec table expectations", () => {
  test.each(
    EXPECTED_TEMPLATES.map((t: TemplateExpectation) => {
      return [t.id, t];
    }),
  )(
    "%s matches the spec'd metric/aggregation/threshold contract",
    (_id: unknown, expected: unknown) => {
      const tc: TemplateExpectation = expected as TemplateExpectation;
      const template: IoTAlertTemplate | undefined = getIoTAlertTemplateById(
        tc.id,
      );
      expect(template).toBeDefined();

      expect(template!.name).toBe(tc.name);
      expect(template!.category).toBe(tc.category);
      expect(template!.severity).toBe(tc.severity);

      const step: MonitorStep = template!.getMonitorStep(buildArgs());
      const monitor: MonitorStepIoTMonitor = getIoTMonitor(step);

      expect(monitor.rollingTime).toBe(tc.rollingTime);

      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      expect(queryConfigs).toHaveLength(1);

      const filterData: any = queryConfigs[0].metricQueryData.filterData;
      expect(filterData.metricName).toBe(tc.query.metricName);
      expect(filterData.aggegationType).toBe(tc.query.aggregation);

      const groupBys: Array<string> =
        queryConfigs[0].metricQueryData.groupByAttributeKeys || [];
      expect(groupBys).toEqual([tc.groupBy]);

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
 * Blackout contract: a total telemetry blackout — the fleet's gateway
 * died, so NO device is pushing — must never read as recovery. The
 * worker's monitorIoT fetcher stamps isTelemetrySourceReporting=false
 * on the response in that case (via checkTelemetrySourceReporting).
 * IoT templates keep the default Ignore no-data policy on every
 * filter, so absent data matches NO criteria under ANY flag value —
 * recovery is strictly value-driven: only a device actually pushing
 * `iot_device_up = 1` can flip a Device Offline incident to resolved.
 * These tests drive the REAL evaluator (processMonitorStep) with each
 * template's actual MonitorStep, so the contract covers the template →
 * evaluator hand-off rather than re-implementing filter semantics.
 */
describe("IotAlertTemplates - blackout contract (no auto-resolve on absent data)", () => {
  async function evaluateSnapshot(input: {
    step: MonitorStep;
    metricResult: Array<AggregatedResult>;
    isTelemetrySourceReporting: boolean | undefined;
  }): Promise<{
    criteriaMetId: string | undefined;
    criteriaResults: Array<MonitorEvaluationCriteriaResult>;
  }> {
    const monitor: Monitor = new Monitor();
    monitor.monitorType = MonitorType.IoTDevice;

    const monitorId: ObjectID = ObjectID.generate();

    const dataToProcess: MetricMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: monitorId,
      metricResult: input.metricResult,
      metricViewConfig: getIoTMonitor(input.step).metricViewConfig,
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
    ALL_TEMPLATES.map((t: IoTAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s: total blackout matches NO criteria — no recover, no status flip, no auto-resolve",
    async (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as IoTAlertTemplate).getMonitorStep(
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
    ALL_TEMPLATES.map((t: IoTAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s: absent data never reads as recovery even while the source reports (value-driven recovery only)",
    async (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as IoTAlertTemplate).getMonitorStep(
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
    ALL_TEMPLATES.map((t: IoTAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s: unknown liveness (legacy fetcher, flag unset) keeps the same no-data behavior",
    async (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as IoTAlertTemplate).getMonitorStep(
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
    ALL_TEMPLATES.map((t: IoTAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s: breaching data on a live source fires the unhealthy criteria",
    async (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as IoTAlertTemplate).getMonitorStep(
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
    ALL_TEMPLATES.map((t: IoTAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s: value-driven recovery is unaffected — recovers on real healthy data",
    async (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as IoTAlertTemplate).getMonitorStep(
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

  test("iot-device-offline: fires on a down device, then HOLDS (not resolves) when the fleet goes dark", async () => {
    const template: IoTAlertTemplate | undefined =
      getIoTAlertTemplateById("iot-device-offline");
    expect(template).toBeDefined();

    const step: MonitorStep = template!.getMonitorStep(buildArgs());
    const fireInstance: MonitorCriteriaInstance = offlineInstanceOf(step);

    // Device reports itself down: gateway still forwards iot_device_up = 0.
    const firing: {
      criteriaMetId: string | undefined;
      criteriaResults: Array<MonitorEvaluationCriteriaResult>;
    } = await evaluateSnapshot({
      step: step,
      metricResult: [{ data: [{ timestamp: new Date(), value: 0 }] }],
      isTelemetrySourceReporting: true,
    });
    expect(firing.criteriaMetId).toBe(fireInstance.data?.id);

    /*
     * Gateway dies: NOTHING is pushed anymore. Absence of iot_device_up
     * must not read as `>= 1` recovered — state must hold.
     */
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
