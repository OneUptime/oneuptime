import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MetricMonitorCriteria from "../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorCriteriaMessageBuilder from "../../../../Server/Utils/Monitor/MonitorCriteriaMessageBuilder";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import MetricFormulaConfigData from "../../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../../Types/Metrics/MetricQueryData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import MetricFormulaEvaluator from "../../../../Utils/Metrics/MetricFormulaEvaluator";

// The evaluator imports the template sandbox; these tests never execute it.
jest.mock("isolated-vm", () => {
  return {};
});

interface MonitorInputs {
  monitor: Monitor;
  criteriaFilter: CriteriaFilter;
  monitorStep: MonitorStep;
  dataToProcess: MetricMonitorResponse;
}

function query(input: {
  alias: string;
  metricName: string;
  title?: string | undefined;
  unit: string;
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: input.alias,
      title: input.title,
      description: undefined,
      legend: undefined,
      legendUnit: input.unit,
    },
    metricQueryData: {
      filterData: { metricName: input.metricName },
    } as unknown as MetricQueryData,
  };
}

function result(values: Array<number>): AggregatedResult {
  return {
    data: values.map((value: number, index: number): AggregateModel => {
      return {
        timestamp: new Date(Date.UTC(2026, 8, 17, 12, index)),
        value,
      } as AggregateModel;
    }),
  };
}

function filter(
  input: {
    alias?: string;
    threshold?: number;
    filterType?: FilterType;
    evaluationType?: EvaluateOverTimeType;
  } = {},
): CriteriaFilter {
  return {
    checkOn: CheckOn.MetricValue,
    filterType: input.filterType || FilterType.GreaterThanOrEqualTo,
    value: input.threshold ?? 90,
    metricMonitorOptions: {
      metricAlias: input.alias || "a",
      metricAggregationType:
        input.evaluationType || EvaluateOverTimeType.AllValues,
    },
  };
}

function buildInputs(input: {
  criteriaFilter: CriteriaFilter;
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs?: Array<MetricFormulaConfigData>;
  metricResult: Array<AggregatedResult>;
}): MonitorInputs {
  const metricViewConfig: MetricsViewConfig = {
    queryConfigs: input.queryConfigs,
    formulaConfigs: input.formulaConfigs || [],
  };
  const criteriaInstance: MonitorCriteriaInstance =
    new MonitorCriteriaInstance();
  criteriaInstance.data = {
    id: ObjectID.generate().toString(),
    name: "Replica utilization",
    description: "",
    monitorStatusId: undefined,
    filterCondition: FilterCondition.Any,
    filters: [input.criteriaFilter],
    incidents: [],
    alerts: [],
    createIncidents: true,
    createAlerts: true,
    isEnabled: true,
  } as unknown as MonitorCriteriaInstance["data"];
  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: [criteriaInstance] };
  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: criteria,
  } as unknown as MonitorStep["data"];
  monitorStep.data!.metricMonitor = {
    metricViewConfig,
    rollingTime: RollingTime.Past5Minutes,
  };
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = MonitorType.Metrics;
  monitor.name = "HPA replica utilization";

  return {
    monitor,
    criteriaFilter: input.criteriaFilter,
    monitorStep,
    dataToProcess: {
      monitorId: monitor.id!,
      projectId: monitor.projectId!,
      metricViewConfig,
      metricResult: input.metricResult,
    },
  };
}

function plainInputs(input: {
  values: Array<number>;
  title?: string | undefined;
  metricName?: string;
  unit?: string;
  criteriaFilter?: CriteriaFilter;
}): MonitorInputs {
  return buildInputs({
    criteriaFilter: input.criteriaFilter || filter(),
    queryConfigs: [
      query({
        alias: "a",
        metricName: input.metricName || "system.cpu.utilization",
        title: input.title,
        unit: input.unit || "%",
      }),
    ],
    metricResult: [result(input.values)],
  });
}

function formulaInputs(input: {
  currentReplicas: Array<number>;
  maxReplicas: Array<number>;
  title?: string | undefined;
  expression?: string;
  denominatorAlias?: string;
  unit?: string;
  criteriaFilter?: CriteriaFilter;
}): MonitorInputs {
  const expression: string =
    input.expression || "(current_replicas / max_replicas) * 100";
  const queryConfigs: Array<MetricQueryConfigData> = [
    query({
      alias: "current_replicas",
      metricName: "k8s.hpa.current_replicas",
      unit: "1",
    }),
    query({
      alias: input.denominatorAlias || "max_replicas",
      metricName: "k8s.hpa.max_replicas",
      unit: "1",
    }),
  ];
  const formulaConfig: MetricFormulaConfigData = {
    metricAliasData: {
      metricVariable: "utilization",
      title: input.title,
      description: undefined,
      legend: undefined,
      legendUnit: input.unit || "%",
    },
    metricFormulaData: { metricFormula: expression },
  };
  const queryResults: Array<AggregatedResult> = [
    result(input.currentReplicas),
    result(input.maxReplicas),
  ];
  const formulaResult: AggregatedResult =
    MetricFormulaEvaluator.evaluateFormula({
      formula: expression,
      queryConfigs,
      formulaConfigs: [],
      results: queryResults,
    });

  return buildInputs({
    criteriaFilter: input.criteriaFilter || filter({ alias: "utilization" }),
    queryConfigs,
    formulaConfigs: [formulaConfig],
    metricResult: [...queryResults, formulaResult],
  });
}

describe("human-readable metric messages across monitor evaluation", () => {
  test.each([
    {
      name: "saturation",
      currentReplicas: 6,
      threshold: 90,
      filterType: FilterType.GreaterThanOrEqualTo,
      expected:
        "HPA replica utilization was 100.00% in all 5 readings, at or above the 90.00% threshold.",
    },
    {
      name: "recovery",
      currentReplicas: 2,
      threshold: 81,
      filterType: FilterType.LessThan,
      expected:
        "HPA replica utilization was 33.33% in all 5 readings, below the 81.00% threshold.",
    },
  ])(
    "summarizes the repeated HPA $name readings on both surfaces",
    async (testCase) => {
      const inputs: MonitorInputs = formulaInputs({
        currentReplicas: Array(5).fill(testCase.currentReplicas),
        maxReplicas: Array(5).fill(6),
        title: "  HPA replica utilization  ",
        criteriaFilter: filter({
          alias: "utilization",
          threshold: testCase.threshold,
          filterType: testCase.filterType,
        }),
      });
      const originalResults: string = JSON.stringify(
        inputs.dataToProcess.metricResult,
      );
      const message: string | null =
        await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs);

      expect(message).toBe(testCase.expected);
      expect(
        MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
          ...inputs,
          didMeetCriteria: true,
          matchMessage: message,
        }),
      ).toBe(testCase.expected);

      const summary: MonitorEvaluationSummary = {
        criteriaResults: [],
        events: [],
      } as unknown as MonitorEvaluationSummary;
      const response: ProbeApiIngestResponse =
        await MonitorCriteriaEvaluator.processMonitorStep({
          ...inputs,
          probeApiIngestResponse: {
            monitorId: inputs.monitor.id!,
            rootCause: null,
          },
          evaluationSummary: summary,
        });

      expect(summary.criteriaResults[0]?.filters[0]?.message).toBe(
        testCase.expected,
      );
      expect(summary.criteriaResults[0]?.filters[0]?.met).toBe(true);
      expect(summary.criteriaResults[0]?.message).toBe(testCase.expected);
      expect(response.rootCause).toContain(testCase.expected);
      expect(JSON.stringify(inputs.dataToProcess.metricResult)).toBe(
        originalResults,
      );
      expect(inputs.criteriaFilter.value).toBe(testCase.threshold);
      expect(inputs.criteriaFilter.metricCriteriaContext).toMatchObject({
        metricName: "(current_replicas / max_replicas) * 100",
        formulaExpression: "(current_replicas / max_replicas) * 100",
        isFormula: true,
        unit: "%",
        totalSamplesInWindow: 5,
        components: [
          { alias: "current_replicas", name: "k8s.hpa.current_replicas" },
          { alias: "max_replicas", name: "k8s.hpa.max_replicas" },
        ],
      });
      expect(
        inputs.criteriaFilter.metricCriteriaContext?.breachingSamples,
      ).toHaveLength(5);
      expect(
        inputs.criteriaFilter.metricCriteriaContext?.breachingSamples?.[0]
          ?.componentValues,
      ).toEqual([
        { alias: "current_replicas", value: testCase.currentReplicas },
        { alias: "max_replicas", value: 6 },
      ]);
    },
  );

  test("a query title changes the label while its real metric name still determines percentage scaling", async () => {
    const inputs: MonitorInputs = plainInputs({
      values: [0.95, 0.95],
      title: "  CPU usage  ",
      unit: "1",
      criteriaFilter: filter({ threshold: 0.9 }),
    });

    expect(
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs),
    ).toBe(
      "CPU usage was 95.00% in all 2 readings, at or above the 90.00% threshold.",
    );
    expect(inputs.criteriaFilter.metricCriteriaContext).toMatchObject({
      metricName: "system.cpu.utilization",
      unit: "1",
      breachingSample: { value: 0.95 },
    });
  });

  test.each([undefined, "", "   "])(
    "a missing or blank query title (%s) falls back to the actual metric name",
    async (title: string | undefined) => {
      const inputs: MonitorInputs = plainInputs({ values: [100], title });
      const message: string | null =
        await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs);

      expect(message).toMatch(/^system\.cpu\.utilization was 100\.00%/);
      expect(inputs.criteriaFilter.metricCriteriaContext?.metricName).toBe(
        "system.cpu.utilization",
      );
    },
  );

  test.each([undefined, "", "   "])(
    "a missing or blank formula title (%s) falls back to its expression",
    async (title: string | undefined) => {
      const inputs: MonitorInputs = formulaInputs({
        currentReplicas: [6],
        maxReplicas: [6],
        title,
      });
      const message: string | null =
        await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs);

      expect(message).toMatch(
        /^\(current_replicas \/ max_replicas\) \* 100 was 100\.00%/,
      );
    },
  );

  test("a formula title ending in _ratio is never treated as a metric name for scaling", async () => {
    const inputs: MonitorInputs = formulaInputs({
      currentReplicas: [3, 3],
      maxReplicas: [6, 6],
      title: "capacity_ratio",
      expression: "current_replicas / max_replicas",
      unit: "1",
      criteriaFilter: filter({ alias: "utilization", threshold: 0.4 }),
    });

    expect(
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs),
    ).toBe(
      "capacity_ratio was 0.5 in all 2 readings, at or above the 0.4 threshold.",
    );
    expect(inputs.criteriaFilter.metricCriteriaContext).toMatchObject({
      metricName: "current_replicas / max_replicas",
      isFormula: true,
      breachingSample: { value: 0.5 },
    });
  });

  test("a formula expression ending in _ratio keeps its unscaled value when used as the fallback label", async () => {
    const inputs: MonitorInputs = formulaInputs({
      currentReplicas: [3, 3],
      maxReplicas: [6, 6],
      denominatorAlias: "max_replicas_ratio",
      expression: "current_replicas / max_replicas_ratio",
      unit: "1",
      criteriaFilter: filter({ alias: "utilization", threshold: 0.4 }),
    });

    expect(
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs),
    ).toBe(
      "current_replicas / max_replicas_ratio was 0.5 in all 2 readings, at or above the 0.4 threshold.",
    );
  });

  test("a query title ending in _ratio does not turn an ordinary count into a percentage", async () => {
    const inputs: MonitorInputs = plainInputs({
      values: [100, 100],
      title: "request_ratio",
      metricName: "http.server.active_requests",
      unit: "1",
    });

    expect(
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs),
    ).toBe(
      "request_ratio was 100 in all 2 readings, at or above the 90 threshold.",
    );
  });

  test("Any Value reports the one matching reading without changing the raw series", async () => {
    const values: Array<number> = [72.35, 81.54, 79.95, 91.53, 87.73];
    const inputs: MonitorInputs = plainInputs({
      values,
      title: "CPU",
      criteriaFilter: filter({
        filterType: FilterType.GreaterThan,
        evaluationType: EvaluateOverTimeType.AnyValue,
      }),
    });

    expect(
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs),
    ).toBe("CPU was 91.53% in 1 of 5 readings, above the 90.00% threshold.");
    expect(
      inputs.criteriaFilter.metricCriteriaContext?.breachingSamples?.map(
        (sample) => {
          return sample.value;
        },
      ),
    ).toEqual([91.53]);
    expect(
      inputs.dataToProcess.metricResult[0]?.data.map((sample) => {
        return sample.value;
      }),
    ).toEqual(values);
  });

  test("a recovery range describes only the matching readings", async () => {
    const inputs: MonitorInputs = plainInputs({
      values: [95, 80, 70],
      title: "CPU",
      criteriaFilter: filter({
        filterType: FilterType.LessThanOrEqualTo,
        evaluationType: EvaluateOverTimeType.AnyValue,
      }),
    });

    expect(
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs),
    ).toBe(
      "CPU ranged from 70.00% to 80.00% across 2 of 3 readings, at or below the 90.00% threshold.",
    );
  });

  test("an average is identified without claiming only one raw reading matched", async () => {
    const inputs: MonitorInputs = plainInputs({
      values: [10, 20, 30],
      title: "CPU",
      criteriaFilter: filter({
        threshold: 15,
        filterType: FilterType.GreaterThan,
        evaluationType: EvaluateOverTimeType.Average,
      }),
    });

    expect(
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs),
    ).toBe("The average of CPU was 20.00%, above the 15.00% threshold.");
  });

  test("a friendly title preserves threshold-unit conversion and context values", async () => {
    const criteriaFilter: CriteriaFilter = filter({
      threshold: 2,
      filterType: FilterType.GreaterThan,
    });
    criteriaFilter.metricMonitorOptions!.thresholdUnit = "sec";
    const inputs: MonitorInputs = plainInputs({
      values: [2500, 2500],
      title: "Request duration",
      metricName: "http.server.request.duration",
      unit: "ms",
      criteriaFilter,
    });

    expect(
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs),
    ).toBe(
      "Request duration was 2.5 sec in all 2 readings, above the 2 sec threshold.",
    );
    expect(inputs.criteriaFilter.metricCriteriaContext).toMatchObject({
      metricName: "http.server.request.duration",
      unit: "sec",
      breachingSample: { value: 2.5 },
    });
  });

  test("a nonmatching All Values window still returns no root cause", async () => {
    const inputs: MonitorInputs = plainInputs({
      values: [100, 80],
      title: "CPU",
    });

    expect(
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs),
    ).toBeNull();
    expect(inputs.criteriaFilter.metricCriteriaContext?.metricName).toBe(
      "system.cpu.utilization",
    );
  });
});
