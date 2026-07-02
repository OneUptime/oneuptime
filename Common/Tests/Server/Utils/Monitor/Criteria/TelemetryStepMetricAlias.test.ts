import MetricMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import MonitorCriteriaDataExtractor from "../../../../../Server/Utils/Monitor/MonitorCriteriaDataExtractor";
import AggregateModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../../Types/BaseDatabase/AggregatedResult";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import MetricFormulaConfigData from "../../../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../../../Types/Metrics/MetricQueryData";
import MetricsViewConfig from "../../../../../Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "../../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStep, {
  MonitorStepType,
} from "../../../../../Types/Monitor/MonitorStep";
import { MonitorStepCephMonitorUtil } from "../../../../../Types/Monitor/MonitorStepCephMonitor";
import { MonitorStepDockerMonitorUtil } from "../../../../../Types/Monitor/MonitorStepDockerMonitor";
import { MonitorStepDockerSwarmMonitorUtil } from "../../../../../Types/Monitor/MonitorStepDockerSwarmMonitor";
import { MonitorStepHostMonitorUtil } from "../../../../../Types/Monitor/MonitorStepHostMonitor";
import { MonitorStepKubernetesMonitorUtil } from "../../../../../Types/Monitor/MonitorStepKubernetesMonitor";
import { MonitorStepPodmanMonitorUtil } from "../../../../../Types/Monitor/MonitorStepPodmanMonitor";
import { MonitorStepProxmoxMonitorUtil } from "../../../../../Types/Monitor/MonitorStepProxmoxMonitor";
import RollingTime from "../../../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * Criteria evaluation resolves `metricAlias` → result slot via the query
 * configs on the monitor step. Telemetry monitors other than the plain
 * Metric monitor (IoT, Kubernetes, Docker, ...) store their query configs
 * under their own step shape (e.g. `data.iotMonitor.metricViewConfig`), so
 * alias resolution must read from whichever shape the step carries — not
 * just `data.metricMonitor`. These tests pin that behavior: a criteria
 * referencing the second query's alias must evaluate the second result
 * slot, never silently fall back to slot 0.
 */

function buildQueryConfig(input: {
  alias: string;
  metricName: string;
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: input.alias,
      title: input.metricName,
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: input.metricName,
      },
    } as unknown as MetricQueryData,
  };
}

/*
 * Two queries — "a" (iot_battery_percent) and "b"
 * (iot_signal_strength_dbm) — plus an optional formula "f" = a + b.
 * Result slots: 0 → a, 1 → b, 2 → f.
 */
function buildViewConfig(input?: { withFormula?: boolean }): MetricsViewConfig {
  const formulaConfigs: Array<MetricFormulaConfigData> = input?.withFormula
    ? [
        {
          metricAliasData: {
            metricVariable: "f",
            title: "Battery + Signal",
            description: undefined,
            legend: undefined,
            legendUnit: undefined,
          },
          metricFormulaData: {
            metricFormula: "a + b",
          },
        },
      ]
    : [];

  return {
    queryConfigs: [
      buildQueryConfig({ alias: "a", metricName: "iot_battery_percent" }),
      buildQueryConfig({ alias: "b", metricName: "iot_signal_strength_dbm" }),
    ],
    formulaConfigs,
  };
}

/*
 * Bare step whose telemetry shape is attached by `assignShape` — the
 * point of these tests is that `data.metricMonitor` stays undefined.
 */
function buildStep(
  assignShape: (data: MonitorStepType, viewConfig: MetricsViewConfig) => void,
  viewConfig: MetricsViewConfig,
): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: { data: undefined } as never,
  } as unknown as MonitorStep["data"];
  assignShape(monitorStep.data!, viewConfig);
  return monitorStep;
}

function buildIoTStep(viewConfig: MetricsViewConfig): MonitorStep {
  return buildStep((data: MonitorStepType, v: MetricsViewConfig) => {
    data.iotMonitor = {
      fleetIdentifier: "plant-a-fleet",
      resourceFilters: {},
      metricViewConfig: v,
      rollingTime: RollingTime.Past1Minute,
    };
  }, viewConfig);
}

/*
 * One aggregated result per result slot, in query/formula order.
 */
function buildResponse(input: {
  viewConfig: MetricsViewConfig;
  resultSlots: Array<Array<number>>;
}): MetricMonitorResponse {
  const metricResult: Array<AggregatedResult> = input.resultSlots.map(
    (values: Array<number>) => {
      return {
        data: values.map((v: number) => {
          return {
            timestamp: new Date(),
            value: v,
          } as AggregateModel;
        }),
      };
    },
  );

  return {
    projectId: ObjectID.generate(),
    metricResult,
    metricViewConfig: input.viewConfig,
    monitorId: ObjectID.generate(),
  };
}

function greaterThanFilter(input: {
  alias: string;
  threshold: string;
}): CriteriaFilter {
  return {
    checkOn: CheckOn.MetricValue,
    filterType: FilterType.GreaterThan,
    value: input.threshold,
    metricMonitorOptions: {
      metricAlias: input.alias,
      metricAggregationType: EvaluateOverTimeType.AnyValue,
    },
  };
}

describe("MetricMonitorCriteria — IoT monitor step alias resolution", () => {
  test("criteria on the second alias evaluates the second series", async () => {
    const viewConfig: MetricsViewConfig = buildViewConfig();
    const criteriaFilter: CriteriaFilter = greaterThanFilter({
      alias: "b",
      threshold: "30",
    });

    // Slot 0 (alias a) stays under the threshold; slot 1 (alias b) breaches.
    const message: string | null =
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: buildResponse({
          viewConfig,
          resultSlots: [[10, 12], [55]],
        }),
        criteriaFilter,
        monitorStep: buildIoTStep(viewConfig),
      });

    expect(message).toBeTruthy();
    expect(message).toContain("55");
    expect(criteriaFilter.metricCriteriaContext?.metricName).toBe(
      "iot_signal_strength_dbm",
    );
    expect(criteriaFilter.metricCriteriaContext?.breachingSample?.value).toBe(
      55,
    );
  });

  test("criteria on the second alias ignores a breach in the first series", async () => {
    const viewConfig: MetricsViewConfig = buildViewConfig();

    // Slot 0 (alias a) breaches, but the criteria targets alias b.
    const message: string | null =
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: buildResponse({
          viewConfig,
          resultSlots: [[90], [10]],
        }),
        criteriaFilter: greaterThanFilter({ alias: "b", threshold: "30" }),
        monitorStep: buildIoTStep(viewConfig),
      });

    expect(message).toBeNull();
  });

  test("formula alias resolves to the formula result slot", async () => {
    const viewConfig: MetricsViewConfig = buildViewConfig({
      withFormula: true,
    });
    const criteriaFilter: CriteriaFilter = greaterThanFilter({
      alias: "f",
      threshold: "100",
    });

    // Slots: a → 10, b → 20, f (formula) → 150. Only the formula breaches.
    const message: string | null =
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: buildResponse({
          viewConfig,
          resultSlots: [[10], [20], [150]],
        }),
        criteriaFilter,
        monitorStep: buildIoTStep(viewConfig),
      });

    expect(message).toBeTruthy();
    expect(message).toContain("150");
    expect(criteriaFilter.metricCriteriaContext?.isFormula).toBe(true);
  });
});

describe("MonitorCriteriaDataExtractor — IoT monitor step alias resolution", () => {
  test("extractMetricValues returns the aliased series, not slot 0", () => {
    const viewConfig: MetricsViewConfig = buildViewConfig();

    const extracted: { alias: string | null; values: Array<number> } | null =
      MonitorCriteriaDataExtractor.extractMetricValues({
        criteriaFilter: greaterThanFilter({ alias: "b", threshold: "30" }),
        dataToProcess: buildResponse({
          viewConfig,
          resultSlots: [
            [10, 12],
            [55, 60],
          ],
        }),
        monitorStep: buildIoTStep(viewConfig),
      });

    expect(extracted).not.toBeNull();
    expect(extracted?.alias).toBe("b");
    expect(extracted?.values).toEqual([55, 60]);
  });
});

describe("MetricMonitorCriteria — other telemetry step shapes", () => {
  type ShapeCase = {
    name: string;
    assignShape: (data: MonitorStepType, viewConfig: MetricsViewConfig) => void;
  };

  const shapeCases: Array<ShapeCase> = [
    {
      name: "kubernetesMonitor",
      assignShape: (data: MonitorStepType, v: MetricsViewConfig) => {
        data.kubernetesMonitor = {
          ...MonitorStepKubernetesMonitorUtil.getDefault(),
          metricViewConfig: v,
        };
      },
    },
    {
      name: "dockerMonitor",
      assignShape: (data: MonitorStepType, v: MetricsViewConfig) => {
        data.dockerMonitor = {
          ...MonitorStepDockerMonitorUtil.getDefault(),
          metricViewConfig: v,
        };
      },
    },
    {
      name: "dockerSwarmMonitor",
      assignShape: (data: MonitorStepType, v: MetricsViewConfig) => {
        data.dockerSwarmMonitor = {
          ...MonitorStepDockerSwarmMonitorUtil.getDefault(),
          metricViewConfig: v,
        };
      },
    },
    {
      name: "hostMonitor",
      assignShape: (data: MonitorStepType, v: MetricsViewConfig) => {
        data.hostMonitor = {
          ...MonitorStepHostMonitorUtil.getDefault(),
          metricViewConfig: v,
        };
      },
    },
    {
      name: "podmanMonitor",
      assignShape: (data: MonitorStepType, v: MetricsViewConfig) => {
        data.podmanMonitor = {
          ...MonitorStepPodmanMonitorUtil.getDefault(),
          metricViewConfig: v,
        };
      },
    },
    {
      name: "proxmoxMonitor",
      assignShape: (data: MonitorStepType, v: MetricsViewConfig) => {
        data.proxmoxMonitor = {
          ...MonitorStepProxmoxMonitorUtil.getDefault(),
          metricViewConfig: v,
        };
      },
    },
    {
      name: "cephMonitor",
      assignShape: (data: MonitorStepType, v: MetricsViewConfig) => {
        data.cephMonitor = {
          ...MonitorStepCephMonitorUtil.getDefault(),
          metricViewConfig: v,
        };
      },
    },
  ];

  test.each(shapeCases)(
    "$name: criteria on the second alias evaluates the second series",
    async (shapeCase: ShapeCase) => {
      const viewConfig: MetricsViewConfig = buildViewConfig();
      const criteriaFilter: CriteriaFilter = greaterThanFilter({
        alias: "b",
        threshold: "30",
      });

      const message: string | null =
        await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: buildResponse({
            viewConfig,
            resultSlots: [[10, 12], [55]],
          }),
          criteriaFilter,
          monitorStep: buildStep(shapeCase.assignShape, viewConfig),
        });

      expect(message).toBeTruthy();
      expect(message).toContain("55");
      expect(criteriaFilter.metricCriteriaContext?.metricName).toBe(
        "iot_signal_strength_dbm",
      );
    },
  );
});

describe("MetricMonitorCriteria — metric monitor step (regression)", () => {
  test("alias resolution still reads data.metricMonitor", async () => {
    const viewConfig: MetricsViewConfig = buildViewConfig();
    const criteriaFilter: CriteriaFilter = greaterThanFilter({
      alias: "b",
      threshold: "30",
    });

    const message: string | null =
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: buildResponse({
          viewConfig,
          resultSlots: [[10, 12], [55]],
        }),
        criteriaFilter,
        monitorStep: buildStep(
          (data: MonitorStepType, v: MetricsViewConfig) => {
            data.metricMonitor = {
              metricViewConfig: v,
              rollingTime: RollingTime.Past1Minute,
            };
          },
          viewConfig,
        ),
      });

    expect(message).toBeTruthy();
    expect(message).toContain("55");
    expect(criteriaFilter.metricCriteriaContext?.metricName).toBe(
      "iot_signal_strength_dbm",
    );
  });
});
