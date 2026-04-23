import MetricMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import AggregateModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../../Types/BaseDatabase/AggregatedResult";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../../Types/Monitor/CriteriaFilter";
import MetricAliasData from "../../../../../Types/Metrics/MetricAliasData";
import MetricFormulaConfigData from "../../../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../../../Types/Metrics/MetricQueryData";
import MetricsViewConfig from "../../../../../Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "../../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricFormulaEvaluator from "../../../../../Utils/Metrics/MetricFormulaEvaluator";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import RollingTime from "../../../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * Light helper that assembles a MonitorStep + MetricMonitorResponse pair
 * for a single metric alias "a" with the supplied native unit, so each
 * test can just tweak the criteria filter + sample values.
 */
function buildInputs(input: {
  metricNativeUnit: string;
  sampleValues: Array<number>;
  criteriaFilter: CriteriaFilter;
}): {
  criteriaFilter: CriteriaFilter;
  monitorStep: MonitorStep;
  dataToProcess: MetricMonitorResponse;
} {
  const aliasData: MetricAliasData = {
    metricVariable: "a",
    title: "Response Time",
    description: undefined,
    legend: undefined,
    legendUnit: input.metricNativeUnit,
  };

  const queryConfig: MetricQueryConfigData = {
    metricAliasData: aliasData,
    metricQueryData: {
      filterData: {
        metricName: "response_time",
      },
    } as unknown as MetricQueryData,
  };

  const metricViewConfig: MetricsViewConfig = {
    queryConfigs: [queryConfig],
    formulaConfigs: [],
  };

  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: { data: undefined } as never,
  } as unknown as MonitorStep["data"];
  monitorStep.data!.metricMonitor = {
    metricViewConfig,
    rollingTime: RollingTime.Past1Minute,
  };

  const aggregated: AggregatedResult = {
    data: input.sampleValues.map((v: number) => {
      return {
        timestamp: new Date(),
        value: v,
      } as AggregateModel;
    }),
  };

  const dataToProcess: MetricMonitorResponse = {
    projectId: ObjectID.generate(),
    metricResult: [aggregated],
    metricViewConfig,
    monitorId: ObjectID.generate(),
  };

  return {
    criteriaFilter: input.criteriaFilter,
    monitorStep,
    dataToProcess,
  };
}

describe("MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  test("no thresholdUnit → threshold evaluated in metric's native unit (backward compatible)", async () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "2000",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "ms",
      sampleValues: [2500],
      criteriaFilter,
    });

    const message: string | null =
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs);

    expect(message).toBeTruthy();
    expect(message).toContain("greater than 2000 ms");
    expect(message).toContain("2500 ms");
    expect(criteriaFilter.metricCriteriaContext?.unit).toBe("ms");
    expect(criteriaFilter.metricCriteriaContext?.breachingSample?.value).toBe(
      2500,
    );
  });

  test("thresholdUnit 'sec' with metric in 'ms' converts samples to sec for the comparison + message", async () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "2",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.AnyValue,
        thresholdUnit: "sec",
      },
    };

    // 2500 ms == 2.5 sec — should breach "greater than 2 sec"
    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "ms",
      sampleValues: [2500],
      criteriaFilter,
    });

    const message: string | null =
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs);

    expect(message).toBeTruthy();
    expect(message).toContain("greater than 2 sec");
    expect(message).toContain("2.5 sec");
    expect(criteriaFilter.metricCriteriaContext?.unit).toBe("sec");
    expect(criteriaFilter.metricCriteriaContext?.breachingSample?.value).toBe(
      2.5,
    );
  });

  test("thresholdUnit 'GB' with metric in 'bytes' breaches on 2.5 GB > 2 GB", async () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "2",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.AnyValue,
        thresholdUnit: "GB",
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "bytes",
      sampleValues: [2.5e9],
      criteriaFilter,
    });

    const message: string | null =
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs);

    expect(message).toBeTruthy();
    expect(message).toContain("greater than 2 GB");
    expect(message).toContain("2.5 GB");
    expect(criteriaFilter.metricCriteriaContext?.unit).toBe("GB");
  });

  test("thresholdUnit 'GB' — under-threshold samples do not trigger", async () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "2",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.AnyValue,
        thresholdUnit: "GB",
      },
    };

    // 1.5 GB = 1.5e9 bytes — under 2 GB, should NOT breach.
    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "bytes",
      sampleValues: [1.5e9],
      criteriaFilter,
    });

    const message: string | null =
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs);

    expect(message).toBeNull();
  });

  test("thresholdUnit in an incompatible family falls back gracefully (no conversion)", async () => {
    /*
     * User incorrectly picked 'MB' but metric is in ms. Conversion should
     * no-op and comparison proceeds in the user's raw unit.
     */
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "1000",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.AnyValue,
        thresholdUnit: "MB",
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "ms",
      sampleValues: [5000],
      criteriaFilter,
    });

    const message: string | null =
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs);

    /*
     * No conversion possible, so the displayed unit/values use user's MB
     * label but values are passed through.
     */
    expect(message).toBeTruthy();
    expect(message).toContain("MB");
  });

  test("no data + NoDataPolicy.Trigger triggers regardless of threshold", async () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "2",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.AnyValue,
        thresholdUnit: "GB",
        onNoDataPolicy: NoDataPolicy.Trigger,
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "bytes",
      sampleValues: [],
      criteriaFilter,
    });

    const message: string | null =
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs);

    expect(message).toBeTruthy();
    expect(message).toContain("No data received");
  });

  test("breaching sample value is recorded in the user's chosen display unit", async () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "1",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.AnyValue,
        thresholdUnit: "sec",
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "ms",
      sampleValues: [500, 3000, 800],
      criteriaFilter,
    });

    await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs);

    expect(criteriaFilter.metricCriteriaContext?.breachingSample?.value).toBe(
      3,
    );
    expect(criteriaFilter.metricCriteriaContext?.unit).toBe("sec");
  });

  test("collects every breaching sample and totalSamplesInWindow", async () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "100",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "ms",
      // 4 breach (>100), 1 does not
      sampleValues: [120, 150, 80, 200, 300],
      criteriaFilter,
    });

    await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs);

    const ctx: NonNullable<CriteriaFilter["metricCriteriaContext"]> =
      criteriaFilter.metricCriteriaContext!;

    expect(ctx.totalSamplesInWindow).toBe(5);
    expect(ctx.breachingSamples).toBeDefined();
    expect(ctx.breachingSamples?.length).toBe(4);
    expect(
      ctx.breachingSamples?.map((s: { value: number }) => {
        return s.value;
      }),
    ).toEqual([120, 150, 200, 300]);
  });

  test("formula criteria populates components and per-sample component values", async () => {
    // Build two query configs (a: ms, b: ms) and a formula c = a + b (ms).
    const sharedTimestamps: Array<Date> = [
      new Date("2026-04-20T11:00:00.000Z"),
      new Date("2026-04-20T11:01:00.000Z"),
    ];

    const queryA: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "a",
        title: "",
        description: "",
        legend: "",
        legendUnit: "ms",
      },
      metricQueryData: {
        filterData: {
          metricName: "request_latency",
        },
      } as unknown as MetricQueryData,
    };

    const queryB: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "b",
        title: "",
        description: "",
        legend: "",
        legendUnit: "ms",
      },
      metricQueryData: {
        filterData: {
          metricName: "db_latency",
        },
      } as unknown as MetricQueryData,
    };

    const formulaC: MetricFormulaConfigData = {
      metricAliasData: {
        metricVariable: "c",
        title: "",
        description: "",
        legend: "",
        legendUnit: "ms",
      },
      metricFormulaData: {
        metricFormula: "a + b",
      },
    };

    const queryAResult: AggregatedResult = {
      data: [
        { timestamp: sharedTimestamps[0], value: 40 } as AggregateModel,
        { timestamp: sharedTimestamps[1], value: 60 } as AggregateModel,
      ],
    };
    const queryBResult: AggregatedResult = {
      data: [
        { timestamp: sharedTimestamps[0], value: 70 } as AggregateModel,
        { timestamp: sharedTimestamps[1], value: 80 } as AggregateModel,
      ],
    };

    /*
     * c = a + b, evaluated via the shared evaluator so the synthetic series
     * matches the production code path exactly.
     */
    const formulaCResult: AggregatedResult =
      MetricFormulaEvaluator.evaluateFormula({
        formula: "a + b",
        queryConfigs: [queryA, queryB],
        formulaConfigs: [],
        results: [queryAResult, queryBResult],
      });

    const metricViewConfig: MetricsViewConfig = {
      queryConfigs: [queryA, queryB],
      formulaConfigs: [formulaC],
    };

    const monitorStep: MonitorStep = new MonitorStep();
    monitorStep.data = {
      id: ObjectID.generate().toString(),
      monitorCriteria: { data: undefined } as never,
    } as unknown as MonitorStep["data"];
    monitorStep.data!.metricMonitor = {
      metricViewConfig,
      rollingTime: RollingTime.Past1Minute,
    };

    const dataToProcess: MetricMonitorResponse = {
      projectId: ObjectID.generate(),
      metricResult: [queryAResult, queryBResult, formulaCResult],
      metricViewConfig,
      monitorId: ObjectID.generate(),
    };

    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "100",
      metricMonitorOptions: {
        metricAlias: "c",
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      },
    };

    await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
      criteriaFilter,
      monitorStep,
      dataToProcess,
    });

    const ctx: NonNullable<CriteriaFilter["metricCriteriaContext"]> =
      criteriaFilter.metricCriteriaContext!;

    expect(ctx.isFormula).toBe(true);
    expect(ctx.formulaExpression).toBe("a + b");

    // Components describe each formula variable with its source metric + unit.
    expect(ctx.components).toBeDefined();
    expect(ctx.components?.length).toBe(2);
    expect(ctx.components?.[0]).toMatchObject({
      alias: "a",
      name: "request_latency",
      unit: "ms",
      isFormula: false,
    });
    expect(ctx.components?.[1]).toMatchObject({
      alias: "b",
      name: "db_latency",
      unit: "ms",
    });

    // Both formula points breach > 100 (40+70=110, 60+80=140).
    expect(ctx.breachingSamples?.length).toBe(2);
    const first: NonNullable<typeof ctx.breachingSamples>[number] =
      ctx.breachingSamples![0]!;
    expect(first.value).toBe(110);
    expect(first.componentValues).toBeDefined();
    expect(first.componentValues).toEqual([
      { alias: "a", value: 40 },
      { alias: "b", value: 70 },
    ]);

    const second: NonNullable<typeof ctx.breachingSamples>[number] =
      ctx.breachingSamples![1]!;
    expect(second.value).toBe(140);
    expect(second.componentValues).toEqual([
      { alias: "a", value: 60 },
      { alias: "b", value: 80 },
    ]);
  });

  test("summarises Filter Conditions Met when more than 5 values breach", async () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "100",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "ms",
      sampleValues: [110, 120, 130, 140, 150, 160, 170, 180, 190, 200],
      criteriaFilter,
    });

    const message: string | null =
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet(inputs);

    expect(message).toBeTruthy();
    expect(message).toContain("10 samples between 110 and 200");
    expect(message).toContain("greater than 100 ms");
    // The raw comma-joined dump is no longer in the message
    expect(message).not.toContain("110, 120, 130, 140, 150, 160");
  });
});

describe("MetricMonitorCriteria.evaluateAllSeries — per-host alerting", () => {
  /*
   * Build a fixture whose metric response carries a pre-computed
   * seriesBreakdown with two hosts over threshold and one under. This
   * mirrors what MonitorTelemetryMonitor produces when groupByAttributeKeys
   * is set.
   */
  function buildInputsWithSeriesBreakdown(input: {
    criteriaFilter: CriteriaFilter;
    seriesSamples: Array<{ labels: Record<string, string>; values: Array<number> }>;
  }): {
    criteriaFilter: CriteriaFilter;
    monitorStep: MonitorStep;
    dataToProcess: MetricMonitorResponse;
  } {
    const aliasData: MetricAliasData = {
      metricVariable: "a",
      title: "CPU",
      description: undefined,
      legend: undefined,
      legendUnit: "%",
    };

    const queryConfig: MetricQueryConfigData = {
      metricAliasData: aliasData,
      metricQueryData: {
        filterData: {
          metricName: "cpu.usage",
        },
        groupByAttributeKeys: ["host.name"],
      } as unknown as MetricQueryData,
    };

    const metricViewConfig: MetricsViewConfig = {
      queryConfigs: [queryConfig],
      formulaConfigs: [],
    };

    const monitorStep: MonitorStep = new MonitorStep();
    monitorStep.data = {
      id: ObjectID.generate().toString(),
      monitorCriteria: { data: undefined } as never,
    } as unknown as MonitorStep["data"];
    monitorStep.data!.metricMonitor = {
      metricViewConfig,
      rollingTime: RollingTime.Past1Minute,
    };

    const seriesBreakdown = input.seriesSamples.map(
      (s: { labels: Record<string, string>; values: Array<number> }) => {
        return {
          fingerprint: Object.values(s.labels).join("|"),
          labels: s.labels as any,
          aggregatedResults: [
            {
              data: s.values.map((v: number) => {
                return {
                  timestamp: new Date(),
                  value: v,
                  attributes: s.labels,
                } as unknown as AggregateModel;
              }),
            } as AggregatedResult,
          ],
        };
      },
    );

    // Flat metricResult = union of all series samples, mirroring the worker.
    const flatData: Array<AggregateModel> = input.seriesSamples.flatMap(
      (s: { labels: Record<string, string>; values: Array<number> }) => {
        return s.values.map((v: number) => {
          return {
            timestamp: new Date(),
            value: v,
            attributes: s.labels,
          } as unknown as AggregateModel;
        });
      },
    );

    const dataToProcess: MetricMonitorResponse = {
      projectId: ObjectID.generate(),
      metricResult: [{ data: flatData } as AggregatedResult],
      metricViewConfig,
      monitorId: ObjectID.generate(),
      seriesBreakdown: seriesBreakdown,
    };

    return {
      criteriaFilter: input.criteriaFilter,
      monitorStep,
      dataToProcess,
    };
  }

  test("no seriesBreakdown → single synthetic evaluation (backward compatible)", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "80",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "%",
      sampleValues: [95],
      criteriaFilter,
    });

    const results = MetricMonitorCriteria.evaluateAllSeries(inputs);
    expect(results).toHaveLength(1);
    expect(results[0]!.fingerprint).toBeUndefined();
    expect(results[0]!.rootCause).toBeTruthy();
  });

  test("seriesBreakdown with 2 breaching + 1 non-breaching → only breaching series return rootCause", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "80",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      },
    };

    const inputs = buildInputsWithSeriesBreakdown({
      criteriaFilter,
      seriesSamples: [
        { labels: { "host.name": "prod-01" }, values: [95] },
        { labels: { "host.name": "prod-02" }, values: [92] },
        { labels: { "host.name": "prod-03" }, values: [50] },
      ],
    });

    const results = MetricMonitorCriteria.evaluateAllSeries(inputs);
    expect(results).toHaveLength(3);

    const breaching = results.filter((r) => r.rootCause !== null);
    expect(breaching).toHaveLength(2);

    const breachingHosts: Array<string> = breaching
      .map((r) => r.labels["host.name"] as string)
      .sort();
    expect(breachingHosts).toEqual(["prod-01", "prod-02"]);
  });

  test("each series gets its own breaching-samples context", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "80",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      },
    };

    const inputs = buildInputsWithSeriesBreakdown({
      criteriaFilter,
      seriesSamples: [
        { labels: { "host.name": "prod-01" }, values: [95, 97] },
        { labels: { "host.name": "prod-02" }, values: [92] },
      ],
    });

    const results = MetricMonitorCriteria.evaluateAllSeries(inputs);
    const prod01 = results.find((r) => r.labels["host.name"] === "prod-01")!;
    const prod02 = results.find((r) => r.labels["host.name"] === "prod-02")!;

    expect(prod01.context.breachingSamples).toHaveLength(2);
    expect(prod02.context.breachingSamples).toHaveLength(1);
    expect(prod01.context.seriesLabels).toEqual({ "host.name": "prod-01" });
  });
});

describe("MetricSeriesFingerprint", () => {
  test("fingerprint is stable regardless of key order", () => {
    const a: { [k: string]: string } = {
      "host.name": "prod-01",
      region: "us-east",
    };
    const b: { [k: string]: string } = {
      region: "us-east",
      "host.name": "prod-01",
    };

    const MetricSeriesFingerprint =
      require("../../../../../Utils/Metrics/MetricSeriesFingerprint").default;

    expect(MetricSeriesFingerprint.computeFingerprint(a)).toBe(
      MetricSeriesFingerprint.computeFingerprint(b),
    );
  });

  test("different label values → different fingerprints", () => {
    const MetricSeriesFingerprint =
      require("../../../../../Utils/Metrics/MetricSeriesFingerprint").default;

    expect(
      MetricSeriesFingerprint.computeFingerprint({ "host.name": "prod-01" }),
    ).not.toBe(
      MetricSeriesFingerprint.computeFingerprint({ "host.name": "prod-02" }),
    );
  });

  test("empty labels → sentinel WholeMonitorFingerprint", () => {
    const MetricSeriesFingerprint =
      require("../../../../../Utils/Metrics/MetricSeriesFingerprint").default;

    expect(MetricSeriesFingerprint.computeFingerprint({})).toBe(
      MetricSeriesFingerprint.WholeMonitorFingerprint,
    );
  });

  test("missing attribute keys canonicalize to empty string (stable fingerprint)", () => {
    const MetricSeriesFingerprint =
      require("../../../../../Utils/Metrics/MetricSeriesFingerprint").default;

    const sample1 = {
      timestamp: new Date(),
      value: 42,
      attributes: { "host.name": "prod-01" },
    };
    const sample2 = {
      timestamp: new Date(),
      value: 42,
      attributes: { "host.name": "prod-01", region: "us-east" },
    };

    const labels1 = MetricSeriesFingerprint.extractSeriesLabels({
      sample: sample1,
      attributeKeys: ["host.name"],
    });
    const labels2 = MetricSeriesFingerprint.extractSeriesLabels({
      sample: sample2,
      attributeKeys: ["host.name"],
    });

    // When only host.name is selected, region doesn't affect the fingerprint
    expect(MetricSeriesFingerprint.computeFingerprint(labels1)).toBe(
      MetricSeriesFingerprint.computeFingerprint(labels2),
    );
  });
});
