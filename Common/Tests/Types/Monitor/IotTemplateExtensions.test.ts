import {
  IoTAlertTemplate,
  IoTAlertTemplateArgs,
  getAllIoTAlertTemplates,
  getIoTAlertTemplateById,
  getIoTAlertTemplatesByCategory,
} from "../../../Types/Monitor/IotAlertTemplates";
import {
  IoTMetricDefinition,
  getAllIoTMetricCategories,
  getAllIoTMetrics,
  getIoTMetricByMetricName,
} from "../../../Types/Monitor/IotMetricCatalog";
import MonitorStepIoTMonitor, {
  IoTResourceScope,
} from "../../../Types/Monitor/MonitorStepIoTMonitor";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
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
 * Shape contracts for the IoT alert templates added after the original
 * five (whose contracts live in IotAlertTemplates.test.ts):
 *
 *   - iot-high-memory ("High Memory Pressure"): a ratio template —
 *     (iot_memory_usage_bytes / iot_memory_size_bytes) * 100 grouped by
 *     device.id, Avg, Past5Minutes, fires > 90, recovers <= 90, and
 *     embeds {{device.id}} in titles per the per-device title contract.
 *
 *   - iot-fleet-offline-ratio / iot-fleet-battery-low ("Fleet Health"):
 *     evaluate the server-computed per-minute `iot_fleet_*` rollup
 *     series (one datapoint per fleet per minute, `iot.scope` = "fleet",
 *     `oneuptime.synthetic` = "fleet-rollup", NO device.id label). The
 *     configs must NOT group by device.id — the worker's
 *     collectGroupByAttributeKeys unions groupByAttributeKeys across
 *     queryConfigs and returns [] when none is set, so the monitor
 *     evaluates ONE series per fleet — and titles must reference the
 *     monitor/fleet name, never {{device.id}}.
 *
 * Plus the onCallPolicyIds threading contract for every template, and
 * the catalog additions backing the new templates and the Custom
 * Metric picker.
 */

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

function fireInstanceOf(step: MonitorStep): MonitorCriteriaInstance {
  return getCriteriaInstances(step)[0]!;
}

function recoverInstanceOf(step: MonitorStep): MonitorCriteriaInstance {
  const instances: Array<MonitorCriteriaInstance> = getCriteriaInstances(step);
  return instances[instances.length - 1]!;
}

function mustGetTemplate(id: string): IoTAlertTemplate {
  const template: IoTAlertTemplate | undefined = getIoTAlertTemplateById(id);
  if (!template) {
    throw new Error(`Template ${id} not found in registry`);
  }
  return template;
}

describe("IotTemplateExtensions - registry", () => {
  test("the extended templates are registered and resolvable by id", () => {
    for (const id of [
      "iot-high-memory",
      "iot-fleet-offline-ratio",
      "iot-fleet-battery-low",
    ]) {
      expect(getIoTAlertTemplateById(id)).toBeDefined();
    }
  });

  test("High Memory Pressure lands in System; Fleet Health holds exactly the two fleet templates", () => {
    expect(
      getIoTAlertTemplatesByCategory("System").map((t: IoTAlertTemplate) => {
        return t.id;
      }),
    ).toContain("iot-high-memory");

    expect(
      getIoTAlertTemplatesByCategory("Fleet Health").map(
        (t: IoTAlertTemplate) => {
          return t.id;
        },
      ),
    ).toEqual(["iot-fleet-offline-ratio", "iot-fleet-battery-low"]);
  });
});

describe("IotTemplateExtensions - iot-high-memory (High Memory Pressure)", () => {
  const template: IoTAlertTemplate = mustGetTemplate("iot-high-memory");

  test("metadata: System / Warning", () => {
    expect(template.name).toBe("High Memory Pressure");
    expect(template.category).toBe("System");
    expect(template.severity).toBe("Warning");
  });

  test("ratio config: usage / size * 100, Avg, Past5Minutes, both queries grouped by device.id", () => {
    const args: IoTAlertTemplateArgs = buildArgs();
    const monitor: MonitorStepIoTMonitor = getIoTMonitor(
      template.getMonitorStep(args),
    );

    expect(monitor.fleetIdentifier).toBe(args.fleetIdentifier);
    expect(monitor.rollingTime).toBe(RollingTime.Past5Minutes);

    const queryConfigs: Array<any> = monitor.metricViewConfig
      .queryConfigs as Array<any>;
    expect(queryConfigs).toHaveLength(2);
    expect(queryConfigs[0].metricQueryData.filterData.metricName).toBe(
      "iot_memory_usage_bytes",
    );
    expect(queryConfigs[1].metricQueryData.filterData.metricName).toBe(
      "iot_memory_size_bytes",
    );

    for (const queryConfig of queryConfigs) {
      expect(queryConfig.metricQueryData.filterData.aggegationType).toBe(
        MetricsAggregationType.Avg,
      );
      /*
       * Both queries must group by the same key so the per-series
       * formula evaluation lines usage and size up per device.
       */
      expect(queryConfig.metricQueryData.groupByAttributeKeys).toEqual([
        "device.id",
      ]);
    }

    const formulaConfigs: Array<any> = (monitor.metricViewConfig
      .formulaConfigs || []) as Array<any>;
    expect(formulaConfigs).toHaveLength(1);
    expect(formulaConfigs[0].metricFormulaData.metricFormula).toBe(
      "(memory_usage_bytes / memory_size_bytes) * 100",
    );
    expect(formulaConfigs[0].metricAliasData.metricVariable).toBe(
      "memory_usage_percent",
    );
  });

  test("criteria: fires on formula alias > 90, recovers <= 90, auto-resolves", () => {
    const step: MonitorStep = template.getMonitorStep(buildArgs());

    const fire: MonitorCriteriaInstance = fireInstanceOf(step);
    const fireFilter: any = (fire.data?.filters as Array<any>)[0];
    expect(fireFilter.metricMonitorOptions.metricAlias).toBe(
      "memory_usage_percent",
    );
    expect(fireFilter.filterType).toBe(FilterType.GreaterThan);
    expect(fireFilter.value).toBe(90);
    expect(fire.data?.incidents?.[0]?.autoResolveIncident).toBe(true);
    expect(fire.data?.alerts?.[0]?.autoResolveAlert).toBe(true);

    const recover: MonitorCriteriaInstance = recoverInstanceOf(step);
    const recoverFilter: any = (recover.data?.filters as Array<any>)[0];
    expect(recoverFilter.metricMonitorOptions.metricAlias).toBe(
      "memory_usage_percent",
    );
    expect(recoverFilter.filterType).toBe(FilterType.LessThanOrEqualTo);
    expect(recoverFilter.value).toBe(90);
  });

  test("titles follow the per-device contract: {{device.id}} and the monitor name", () => {
    const args: IoTAlertTemplateArgs = buildArgs();
    const fire: MonitorCriteriaInstance = fireInstanceOf(
      template.getMonitorStep(args),
    );

    const incidentTitle: string = fire.data?.incidents?.[0]?.title || "";
    expect(incidentTitle).toContain("{{device.id}}");
    expect(incidentTitle).toContain(args.monitorName);

    const alertTitle: string = fire.data?.alerts?.[0]?.title || "";
    expect(alertTitle).toContain("{{device.id}}");
    expect(alertTitle).toContain(args.monitorName);
  });

  test("both ratio metrics are in the catalog with Device scope", () => {
    for (const metricName of [
      "iot_memory_usage_bytes",
      "iot_memory_size_bytes",
    ]) {
      const definition: IoTMetricDefinition | undefined =
        getIoTMetricByMetricName(metricName);
      expect(definition).toBeDefined();
      expect(definition!.defaultResourceScope).toBe(IoTResourceScope.Device);
      expect(definition!.category).toBe("System");
    }
  });
});

interface FleetTemplateExpectation {
  id: string;
  name: string;
  severity: string;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  fireFilterType: FilterType;
  recoverFilterType: FilterType;
  threshold: number;
}

const FLEET_TEMPLATE_EXPECTATIONS: Array<FleetTemplateExpectation> = [
  {
    // > 10% of the fleet offline.
    id: "iot-fleet-offline-ratio",
    name: "Fleet Offline Ratio High",
    severity: "Critical",
    metricName: "iot_fleet_online_ratio",
    metricAlias: "fleet_online_ratio",
    rollingTime: RollingTime.Past5Minutes,
    fireFilterType: FilterType.LessThan,
    recoverFilterType: FilterType.GreaterThanOrEqualTo,
    threshold: 0.9,
  },
  {
    // Bottom-decile battery under 20%.
    id: "iot-fleet-battery-low",
    name: "Fleet Battery Low",
    severity: "Warning",
    metricName: "iot_fleet_battery_percent_p10",
    metricAlias: "fleet_battery_p10",
    rollingTime: RollingTime.Past15Minutes,
    fireFilterType: FilterType.LessThan,
    recoverFilterType: FilterType.GreaterThanOrEqualTo,
    threshold: 20,
  },
];

describe("IotTemplateExtensions - Fleet Health templates (rollup series)", () => {
  test.each(
    FLEET_TEMPLATE_EXPECTATIONS.map((t: FleetTemplateExpectation) => {
      return [t.id, t];
    }),
  )(
    "%s matches the spec'd rollup metric/aggregation/threshold contract",
    (_id: unknown, expected: unknown) => {
      const tc: FleetTemplateExpectation = expected as FleetTemplateExpectation;
      const template: IoTAlertTemplate = mustGetTemplate(tc.id);

      expect(template.name).toBe(tc.name);
      expect(template.category).toBe("Fleet Health");
      expect(template.severity).toBe(tc.severity);

      const args: IoTAlertTemplateArgs = buildArgs();
      const step: MonitorStep = template.getMonitorStep(args);
      const monitor: MonitorStepIoTMonitor = getIoTMonitor(step);

      expect(monitor.fleetIdentifier).toBe(args.fleetIdentifier);
      expect(monitor.rollingTime).toBe(tc.rollingTime);

      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      expect(queryConfigs).toHaveLength(1);
      expect(monitor.metricViewConfig.formulaConfigs || []).toHaveLength(0);

      const filterData: any = queryConfigs[0].metricQueryData.filterData;
      expect(filterData.metricName).toBe(tc.metricName);
      expect(filterData.aggegationType).toBe(MetricsAggregationType.Avg);

      const fireFilter: any = (
        fireInstanceOf(step).data?.filters as Array<any>
      )[0];
      expect(fireFilter.metricMonitorOptions.metricAlias).toBe(tc.metricAlias);
      expect(fireFilter.filterType).toBe(tc.fireFilterType);
      expect(fireFilter.value).toBe(tc.threshold);

      const recoverFilter: any = (
        recoverInstanceOf(step).data?.filters as Array<any>
      )[0];
      expect(recoverFilter.metricMonitorOptions.metricAlias).toBe(
        tc.metricAlias,
      );
      expect(recoverFilter.filterType).toBe(tc.recoverFilterType);
      expect(recoverFilter.value).toBe(tc.threshold);
    },
  );

  test.each(
    FLEET_TEMPLATE_EXPECTATIONS.map((t: FleetTemplateExpectation) => {
      return [t.id, t];
    }),
  )(
    "%s does NOT group by device.id — rollups carry no per-device identity",
    (_id: unknown, expected: unknown) => {
      const tc: FleetTemplateExpectation = expected as FleetTemplateExpectation;
      const monitor: MonitorStepIoTMonitor = getIoTMonitor(
        mustGetTemplate(tc.id).getMonitorStep(buildArgs()),
      );

      /*
       * The worker's collectGroupByAttributeKeys unions the
       * groupByAttributeKeys arrays across queryConfigs; a config that
       * sets none yields [] and the monitor evaluates the fleet's single
       * rollup series as one aggregate — exactly what fleet-scope
       * templates need. A device.id group-by here would fingerprint
       * every rollup datapoint into one anonymous bucket (no device.id
       * label exists on these series) and break the per-fleet semantics.
       */
      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        expect(queryConfig.metricQueryData.groupByAttributeKeys).toBe(
          undefined,
        );
      }
    },
  );

  test.each(
    FLEET_TEMPLATE_EXPECTATIONS.map((t: FleetTemplateExpectation) => {
      return [t.id, t];
    }),
  )(
    "%s titles reference the fleet monitor, never {{device.id}}",
    (_id: unknown, expected: unknown) => {
      const tc: FleetTemplateExpectation = expected as FleetTemplateExpectation;
      const args: IoTAlertTemplateArgs = buildArgs();
      const fire: MonitorCriteriaInstance = fireInstanceOf(
        mustGetTemplate(tc.id).getMonitorStep(args),
      );

      const incident: any = fire.data?.incidents?.[0];
      const alert: any = fire.data?.alerts?.[0];

      for (const text of [
        incident?.title || "",
        incident?.description || "",
        alert?.title || "",
        alert?.description || "",
      ]) {
        expect(text).not.toContain("{{device.id}}");
      }
      expect(incident?.title || "").toContain(args.monitorName);
      expect(alert?.title || "").toContain(args.monitorName);
    },
  );

  test.each(
    FLEET_TEMPLATE_EXPECTATIONS.map((t: FleetTemplateExpectation) => {
      return [t.id, t];
    }),
  )(
    "%s rollup metric is in the catalog with Fleet scope",
    (_id: unknown, expected: unknown) => {
      const tc: FleetTemplateExpectation = expected as FleetTemplateExpectation;
      const definition: IoTMetricDefinition | undefined =
        getIoTMetricByMetricName(tc.metricName);
      expect(definition).toBeDefined();
      expect(definition!.defaultResourceScope).toBe(IoTResourceScope.Fleet);
      expect(definition!.category).toBe("Fleet Health");
    },
  );
});

describe("IotTemplateExtensions - onCallPolicyIds threading (every template)", () => {
  test.each(
    getAllIoTAlertTemplates().map((t: IoTAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s threads onCallPolicyIds into every incident and alert",
    (_id: unknown, template: unknown) => {
      const onCallPolicyIds: Array<ObjectID> = [
        ObjectID.generate(),
        ObjectID.generate(),
      ];
      const step: MonitorStep = (template as IoTAlertTemplate).getMonitorStep({
        ...buildArgs(),
        onCallPolicyIds,
      });

      const instances: Array<MonitorCriteriaInstance> =
        getCriteriaInstances(step);
      for (const instance of instances.slice(0, -1)) {
        expect(instance.data?.incidents?.[0]?.onCallPolicyIds).toEqual(
          onCallPolicyIds,
        );
        expect(instance.data?.alerts?.[0]?.onCallPolicyIds).toEqual(
          onCallPolicyIds,
        );
      }
    },
  );

  test.each(
    getAllIoTAlertTemplates().map((t: IoTAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s defaults onCallPolicyIds to [] when the fleet has no policy",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as IoTAlertTemplate).getMonitorStep(
        buildArgs(),
      );

      const instances: Array<MonitorCriteriaInstance> =
        getCriteriaInstances(step);
      for (const instance of instances.slice(0, -1)) {
        expect(instance.data?.incidents?.[0]?.onCallPolicyIds).toEqual([]);
        expect(instance.data?.alerts?.[0]?.onCallPolicyIds).toEqual([]);
      }
    },
  );
});

describe("IotTemplateExtensions - catalog additions", () => {
  const FLEET_ROLLUP_METRIC_NAMES: Array<string> = [
    "iot_fleet_device_count",
    "iot_fleet_online_count",
    "iot_fleet_offline_count",
    "iot_fleet_stale_count",
    "iot_fleet_online_ratio",
    "iot_fleet_battery_percent_p50",
    "iot_fleet_battery_percent_p10",
    "iot_fleet_weak_signal_count",
  ];

  test("every fleet rollup series is offered with Fleet scope under Fleet Health", () => {
    for (const metricName of FLEET_ROLLUP_METRIC_NAMES) {
      const definition: IoTMetricDefinition | undefined =
        getIoTMetricByMetricName(metricName);
      expect(definition).toBeDefined();
      expect(definition!.category).toBe("Fleet Health");
      expect(definition!.defaultResourceScope).toBe(IoTResourceScope.Fleet);
    }
  });

  test("iot_memory_size_bytes is offered with Device scope under System", () => {
    const definition: IoTMetricDefinition | undefined =
      getIoTMetricByMetricName("iot_memory_size_bytes");
    expect(definition).toBeDefined();
    expect(definition!.category).toBe("System");
    expect(definition!.defaultResourceScope).toBe(IoTResourceScope.Device);
    expect(definition!.unit).toBe("bytes");
  });

  test("Fleet Health is a listed category so the Custom Metric picker renders it", () => {
    expect(getAllIoTMetricCategories()).toContain("Fleet Health");
  });

  test("catalog ids and metric names stay unique", () => {
    const all: Array<IoTMetricDefinition> = getAllIoTMetrics();
    const ids: Array<string> = all.map((m: IoTMetricDefinition) => {
      return m.id;
    });
    const names: Array<string> = all.map((m: IoTMetricDefinition) => {
      return m.metricName;
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });
});

/*
 * Drive the REAL evaluator (processMonitorStep) with the new templates'
 * actual MonitorSteps so the contract covers the template → evaluator
 * hand-off: fleet rollup values on the wrong side of the threshold fire,
 * healthy values recover, and a rollup emission gap (empty fleet / no
 * fresh battery readings) matches nothing so the monitor holds state.
 */
describe("IotTemplateExtensions - evaluator hand-off", () => {
  async function evaluateSnapshot(input: {
    step: MonitorStep;
    metricResult: Array<AggregatedResult>;
    isTelemetrySourceReporting: boolean | undefined;
  }): Promise<{
    criteriaMetId: string | undefined;
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
      criteriaResults: [] as Array<MonitorEvaluationCriteriaResult>,
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
    };
  }

  function singleResult(value: number): Array<AggregatedResult> {
    return [{ data: [{ timestamp: new Date(), value: value }] }];
  }

  test("iot-fleet-offline-ratio: fires at 0.85, recovers at 0.95, holds through a rollup gap", async () => {
    const step: MonitorStep = mustGetTemplate(
      "iot-fleet-offline-ratio",
    ).getMonitorStep(buildArgs());

    const firing: { criteriaMetId: string | undefined } =
      await evaluateSnapshot({
        step: step,
        metricResult: singleResult(0.85),
        isTelemetrySourceReporting: true,
      });
    expect(firing.criteriaMetId).toBe(fireInstanceOf(step).data?.id);

    const recovered: { criteriaMetId: string | undefined } =
      await evaluateSnapshot({
        step: step,
        metricResult: singleResult(0.95),
        isTelemetrySourceReporting: true,
      });
    expect(recovered.criteriaMetId).toBe(recoverInstanceOf(step).data?.id);

    /*
     * iot_fleet_online_ratio is only emitted while device_count > 0 —
     * an emission gap must match nothing (hold state), not read as
     * `>= 0.9` recovered.
     */
    const gap: { criteriaMetId: string | undefined } = await evaluateSnapshot({
      step: step,
      metricResult: [],
      isTelemetrySourceReporting: true,
    });
    expect(gap.criteriaMetId).toBeUndefined();
  });

  test("iot-fleet-battery-low: fires at p10=15, recovers at p10=25, holds through a rollup gap", async () => {
    const step: MonitorStep = mustGetTemplate(
      "iot-fleet-battery-low",
    ).getMonitorStep(buildArgs());

    const firing: { criteriaMetId: string | undefined } =
      await evaluateSnapshot({
        step: step,
        metricResult: singleResult(15),
        isTelemetrySourceReporting: true,
      });
    expect(firing.criteriaMetId).toBe(fireInstanceOf(step).data?.id);

    const recovered: { criteriaMetId: string | undefined } =
      await evaluateSnapshot({
        step: step,
        metricResult: singleResult(25),
        isTelemetrySourceReporting: true,
      });
    expect(recovered.criteriaMetId).toBe(recoverInstanceOf(step).data?.id);

    /*
     * The p10 series is only emitted while fresh battery readings
     * exist — a gap must hold state rather than resolve.
     */
    const gap: { criteriaMetId: string | undefined } = await evaluateSnapshot({
      step: step,
      metricResult: [],
      isTelemetrySourceReporting: true,
    });
    expect(gap.criteriaMetId).toBeUndefined();
  });

  test("iot-high-memory: fires when the formula result exceeds 90, recovers below", async () => {
    const step: MonitorStep =
      mustGetTemplate("iot-high-memory").getMonitorStep(buildArgs());

    /*
     * metricResult is positional: queryConfigs first (usage, size), then
     * formula results — the criteria alias `memory_usage_percent`
     * resolves to index 2 (queryConfigs.length + formulaIndex).
     */
    function memoryResults(percent: number): Array<AggregatedResult> {
      return [
        { data: [{ timestamp: new Date(), value: 950_000_000 }] },
        { data: [{ timestamp: new Date(), value: 1_000_000_000 }] },
        { data: [{ timestamp: new Date(), value: percent }] },
      ];
    }

    const firing: { criteriaMetId: string | undefined } =
      await evaluateSnapshot({
        step: step,
        metricResult: memoryResults(95),
        isTelemetrySourceReporting: true,
      });
    expect(firing.criteriaMetId).toBe(fireInstanceOf(step).data?.id);

    const recovered: { criteriaMetId: string | undefined } =
      await evaluateSnapshot({
        step: step,
        metricResult: memoryResults(85),
        isTelemetrySourceReporting: true,
      });
    expect(recovered.criteriaMetId).toBe(recoverInstanceOf(step).data?.id);

    const blackout: { criteriaMetId: string | undefined } =
      await evaluateSnapshot({
        step: step,
        metricResult: [],
        isTelemetrySourceReporting: false,
      });
    expect(blackout.criteriaMetId).toBeUndefined();
  });
});
