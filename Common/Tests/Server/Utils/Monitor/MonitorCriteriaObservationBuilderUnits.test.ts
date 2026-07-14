import MonitorCriteriaObservationBuilder from "../../../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import MetricAliasData from "../../../../Types/Metrics/MetricAliasData";
import MetricFormulaConfigData from "../../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../../Types/Metrics/MetricQueryData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Assembles the monitor + metric response + step trio that
 * MonitorCriteriaObservationBuilder needs, for a single metric alias "a"
 * with a given native/legend unit and sample values. Mirrors the fixtures
 * used by MetricMonitorCriteria.test.ts and MonitorCriteriaMessageBuilderUnits
 * .test.ts, but additionally allows an optional nativeUnitsByMetricName map so
 * we can exercise the native-unit fallback path in resolveMetricUnits.
 */
function buildInputs(input: {
  metricNativeUnit: string;
  sampleValues: Array<number>;
  criteriaFilter: CriteriaFilter;
  metricName?: string;
  nativeUnitsByMetricName?: { [key: string]: string };
}): {
  monitor: Monitor;
  criteriaFilter: CriteriaFilter;
  monitorStep: MonitorStep;
  dataToProcess: MetricMonitorResponse;
} {
  const metricName: string = input.metricName ?? "response_time";

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
        metricName: metricName,
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
    nativeUnitsByMetricName: input.nativeUnitsByMetricName,
  };

  return {
    monitor: new Monitor(),
    criteriaFilter: input.criteriaFilter,
    monitorStep,
    dataToProcess,
  };
}

/*
 * Two-query variant (alias "a" and alias "b") so we can prove the observation
 * builder resolves the criteria's alias to the correct series + unit. Each
 * alias has its own legendUnit and its own aggregated result, positioned by
 * index the way MonitorCriteriaDataExtractor.extractMetricValues expects.
 */
function buildTwoAliasInputs(input: {
  aliasAUnit: string;
  aliasBUnit: string;
  aliasASamples: Array<number>;
  aliasBSamples: Array<number>;
  criteriaFilter: CriteriaFilter;
}): {
  monitor: Monitor;
  criteriaFilter: CriteriaFilter;
  monitorStep: MonitorStep;
  dataToProcess: MetricMonitorResponse;
} {
  const queryA: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "a",
      title: "",
      description: "",
      legend: "",
      legendUnit: input.aliasAUnit,
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
      legendUnit: input.aliasBUnit,
    },
    metricQueryData: {
      filterData: {
        metricName: "db_latency",
      },
    } as unknown as MetricQueryData,
  };

  const metricViewConfig: MetricsViewConfig = {
    queryConfigs: [queryA, queryB],
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

  const resultA: AggregatedResult = {
    data: input.aliasASamples.map((v: number) => {
      return { timestamp: new Date(), value: v } as AggregateModel;
    }),
  };
  const resultB: AggregatedResult = {
    data: input.aliasBSamples.map((v: number) => {
      return { timestamp: new Date(), value: v } as AggregateModel;
    }),
  };

  const dataToProcess: MetricMonitorResponse = {
    projectId: ObjectID.generate(),
    metricResult: [resultA, resultB],
    metricViewConfig,
    monitorId: ObjectID.generate(),
  };

  return {
    monitor: new Monitor(),
    criteriaFilter: input.criteriaFilter,
    monitorStep,
    dataToProcess,
  };
}

/*
 * Formula-alias variant: a base query (alias "a") plus a FORMULA (alias "c")
 * that references it. extractMetricValues positions the formula's series at
 * queryConfigs.length + formulaIndex, so metricResult[0] is the base query
 * series and metricResult[1] is the formula series. Lets us prove a criteria
 * targeting the formula alias "c" resolves the FORMULA's legendUnit — not the
 * base query's legendUnit.
 */
function buildFormulaAliasInputs(input: {
  queryUnit: string;
  formulaUnit: string;
  querySamples: Array<number>;
  formulaSamples: Array<number>;
  criteriaFilter: CriteriaFilter;
}): {
  monitor: Monitor;
  criteriaFilter: CriteriaFilter;
  monitorStep: MonitorStep;
  dataToProcess: MetricMonitorResponse;
} {
  const queryConfig: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "a",
      title: "",
      description: "",
      legend: "",
      legendUnit: input.queryUnit,
    },
    metricQueryData: {
      filterData: {
        metricName: "x",
      },
    } as unknown as MetricQueryData,
  };

  const formulaConfig: MetricFormulaConfigData = {
    metricAliasData: {
      metricVariable: "c",
      title: "",
      description: "",
      legend: "",
      legendUnit: input.formulaUnit,
    },
    metricFormulaData: {
      metricFormula: "a",
    },
  };

  const metricViewConfig: MetricsViewConfig = {
    queryConfigs: [queryConfig],
    formulaConfigs: [formulaConfig],
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

  const queryResult: AggregatedResult = {
    data: input.querySamples.map((v: number) => {
      return { timestamp: new Date(), value: v } as AggregateModel;
    }),
  };
  const formulaResult: AggregatedResult = {
    data: input.formulaSamples.map((v: number) => {
      return { timestamp: new Date(), value: v } as AggregateModel;
    }),
  };

  const dataToProcess: MetricMonitorResponse = {
    projectId: ObjectID.generate(),
    // index 0 => base query "a", index 1 => formula "c" (positional).
    metricResult: [queryResult, formulaResult],
    metricViewConfig,
    monitorId: ObjectID.generate(),
  };

  return {
    monitor: new Monitor(),
    criteriaFilter: input.criteriaFilter,
    monitorStep,
    dataToProcess,
  };
}

/*
 * Convenience for a metric-value criteria filter with the common options.
 */
function metricFilter(options: {
  filterType?: FilterType;
  value?: string;
  metricAlias?: string;
  thresholdUnit?: string;
}): CriteriaFilter {
  return {
    checkOn: CheckOn.MetricValue,
    filterType: options.filterType ?? FilterType.GreaterThan,
    value: options.value ?? "1",
    metricMonitorOptions: {
      metricAlias: options.metricAlias ?? "a",
      metricAggregationType: EvaluateOverTimeType.AnyValue,
      thresholdUnit: options.thresholdUnit,
    },
  };
}

describe("MonitorCriteriaObservationBuilder.describeFilterObservation — metric value", () => {
  /*
   * Native/legend unit "sec": every rendered number carries " sec" and the
   * three-point series produces the plural "(min .. max ..) across 3 data
   * points" shape. "latest" is the LAST sample, not the max.
   */
  test("native unit 'sec' — three equal samples render with the sec suffix", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({ value: "5" });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "sec",
      sampleValues: [0.06, 0.06, 0.06],
      criteriaFilter,
    });

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation(inputs);

    expect(observation).toBe(
      "Metric Value (a) recorded latest 0.06 sec (min 0.06 sec, max 0.06 sec) across 3 data points.",
    );
  });

  /*
   * Legend unit "ms": two-point series. Each value is toFixed(2), so 40 -> 40.00
   * and 60 -> 60.00; latest is 60 (the last element).
   */
  test("legend unit 'ms' — two samples render latest/min/max with ms", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({ value: "10" });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "ms",
      sampleValues: [40, 60],
      criteriaFilter,
    });

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation(inputs);

    expect(observation).toBe(
      "Metric Value (a) recorded latest 60.00 ms (min 40.00 ms, max 60.00 ms) across 2 data points.",
    );
  });

  /*
   * thresholdUnit "sec" over a native "ms" metric: 2500 ms converts to 2.5 sec
   * and the label follows the threshold unit. Single sample => singular
   * "across 1 data point" with no (min .. max ..) clause.
   */
  test("thresholdUnit 'sec' over native 'ms' — converts 2500ms to 2.50 sec", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({
      value: "2",
      thresholdUnit: "sec",
    });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "ms",
      sampleValues: [2500],
      criteriaFilter,
    });

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation(inputs);

    expect(observation).toBe(
      "Metric Value (a) recorded latest 2.50 sec across 1 data point.",
    );
    expect(observation).toContain("2.50 sec");
  });

  /*
   * thresholdUnit "GB" over a native "bytes" metric: 2.5e9 bytes converts to a
   * clean 2.5 GB, rendered "2.50 GB".
   */
  test("thresholdUnit 'GB' over native 'bytes' — converts 2.5e9 bytes to 2.50 GB", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({
      value: "2",
      thresholdUnit: "GB",
    });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "bytes",
      sampleValues: [2.5e9],
      criteriaFilter,
    });

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation(inputs);

    expect(observation).toBe(
      "Metric Value (a) recorded latest 2.50 GB across 1 data point.",
    );
    expect(observation).toContain("2.50 GB");
  });

  /*
   * Incompatible families (native "ms", thresholdUnit "MB"): conversion no-ops,
   * so 5000 passes through UNCONVERTED as "5000.00" but is still LABELLED "MB".
   */
  test("incompatible thresholdUnit 'MB' over native 'ms' — value unconverted, still labelled MB", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({
      value: "1000",
      thresholdUnit: "MB",
    });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "ms",
      sampleValues: [5000],
      criteriaFilter,
    });

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation(inputs);

    expect(observation).toBe(
      "Metric Value (a) recorded latest 5000.00 MB across 1 data point.",
    );
    // Unconverted value passed through.
    expect(observation).toContain("5000.00");
    // But labelled with the (incompatible) threshold unit.
    expect(observation).toContain("MB");
  });

  /*
   * Dimensionless OTel unit "1" is suppressed: a fraction like 0.06 renders
   * WITHOUT any suffix — never the misleading "0.06 1".
   */
  test("dimensionless native '1' — no unit suffix", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({ value: "0.9" });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "1",
      sampleValues: [0.06],
      criteriaFilter,
    });

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation(inputs);

    expect(observation).toBe(
      "Metric Value (a) recorded latest 0.06 across 1 data point.",
    );
    expect(observation).toContain("latest 0.06 ");
    expect(observation).not.toContain("0.06 1");
  });

  /*
   * No known unit at all (empty legendUnit, no nativeUnitsByMetricName map):
   * numbers render with no suffix.
   */
  test("missing/empty native unit — no unit suffix", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({ value: "1" });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "",
      sampleValues: [0.06],
      criteriaFilter,
    });

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation(inputs);

    expect(observation).toBe(
      "Metric Value (a) recorded latest 0.06 across 1 data point.",
    );
  });

  /*
   * nativeUnitsByMetricName supplies the unit when the alias has no legendUnit:
   * the map value ("ms", keyed by the lowercased metric name) becomes the
   * sample unit.
   */
  test("native-unit fallback via nativeUnitsByMetricName when legendUnit empty", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({ value: "10" });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "",
      metricName: "http.server.duration",
      sampleValues: [40, 60],
      criteriaFilter,
      nativeUnitsByMetricName: { "http.server.duration": "ms" },
    });

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation(inputs);

    expect(observation).toBe(
      "Metric Value (a) recorded latest 60.00 ms (min 40.00 ms, max 60.00 ms) across 2 data points.",
    );
  });

  /*
   * A metricResult present but with an empty data array yields the
   * "returned no data points." message (no unit, no numbers).
   */
  test("no samples — returns the no-data-points message", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({ value: "1" });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "sec",
      sampleValues: [],
      criteriaFilter,
    });

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation(inputs);

    expect(observation).toBe("Metric Value (a) returned no data points.");
  });

  /*
   * Alias resolution: with two queries (a: ms, b: sec) a criteria targeting "b"
   * summarizes the "b" series with its "sec" unit — proving the right series and
   * unit are chosen, not alias "a"'s ms values.
   */
  test("alias resolution — criteria on 'b' summarizes the b series in sec", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({
      value: "1",
      metricAlias: "b",
    });

    const inputs: ReturnType<typeof buildTwoAliasInputs> = buildTwoAliasInputs({
      aliasAUnit: "ms",
      aliasBUnit: "sec",
      aliasASamples: [40, 60],
      aliasBSamples: [1, 2, 3],
      criteriaFilter,
    });

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation(inputs);

    expect(observation).toBe(
      "Metric Value (b) recorded latest 3.00 sec (min 1.00 sec, max 3.00 sec) across 3 data points.",
    );
    // The a-series (ms, 40/60) must not leak in.
    expect(observation).not.toContain("(a)");
    expect(observation).not.toContain("ms");
    expect(observation).not.toContain("60.00");
  });

  /*
   * Flagship fraction->percent: native/legend unit "1" (dimensionless) with a
   * thresholdUnit of "%". The RAW "1" drives the numeric conversion (0.06 *
   * 100 = 6) while the DISPLAY unit is the real "%" — never "0.06 1". The
   * display unit resolved for this same criteria is "%".
   */
  test("fraction->percent — native '1' + thresholdUnit '%' converts 0.06 to 6.00 %", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({
      value: "2",
      thresholdUnit: "%",
    });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "1",
      sampleValues: [0.06],
      criteriaFilter,
    });

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation(inputs);

    expect(observation).toBe(
      "Metric Value (a) recorded latest 6.00 % across 1 data point.",
    );

    const unit: string | undefined =
      MonitorCriteriaObservationBuilder.getMetricValueDisplayUnit(inputs);

    expect(unit).toBe("%");
  });

  /*
   * Reverse conversion with threshold-side "1" suppression: native/legend unit
   * "%" with a thresholdUnit of "1". The RAW "1" drives the conversion (6 %
   * -> 0.06 fraction) but the dimensionless "1" is SUPPRESSED for display, so
   * the value renders with NO unit suffix. Display unit resolves to undefined.
   */
  test("percent->fraction — native '%' + thresholdUnit '1' converts 6 to 0.06, no suffix", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({
      value: "0.5",
      thresholdUnit: "1",
    });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "%",
      sampleValues: [6],
      criteriaFilter,
    });

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation(inputs);

    expect(observation).toBe(
      "Metric Value (a) recorded latest 0.06 across 1 data point.",
    );
    // The suppressed "1" must never leak in as a suffix.
    expect(observation).not.toContain("0.06 1");

    const unit: string | undefined =
      MonitorCriteriaObservationBuilder.getMetricValueDisplayUnit(inputs);

    expect(unit).toBeUndefined();
  });

  /*
   * Formula alias resolution: the criteria targets the FORMULA alias "c",
   * whose series lives at metricResult[1] (queryConfigs.length + formulaIndex).
   * The observation must render "(c)" and use the FORMULA's legendUnit "sec",
   * not the base query "a"'s "ms". No thresholdUnit, so values pass through
   * unconverted (latest 2.50, min 1.50, max 2.50 over two points).
   */
  test("formula alias 'c' — observation uses the formula's legendUnit 'sec'", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({
      value: "1",
      metricAlias: "c",
    });

    const inputs: ReturnType<typeof buildFormulaAliasInputs> =
      buildFormulaAliasInputs({
        queryUnit: "ms",
        formulaUnit: "sec",
        querySamples: [40, 60],
        formulaSamples: [1.5, 2.5],
        criteriaFilter,
      });

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation(inputs);

    expect(observation).toBe(
      "Metric Value (c) recorded latest 2.50 sec (min 1.50 sec, max 2.50 sec) across 2 data points.",
    );
    // The formula alias, not the base query, is summarized.
    expect(observation).toContain("(c)");
    expect(observation).not.toContain("(a)");
    expect(observation).not.toContain("ms");
  });

  /*
   * Bit-units family: native/legend unit "mbit" converted into thresholdUnit
   * "gbit" (mbit.toCanonical=1e6, gbit.toCanonical=1e9), so 1500 mbit -> 1.5
   * gbit, labelled with the threshold unit.
   */
  test("bit family — native 'mbit' + thresholdUnit 'gbit' converts 1500 to 1.50 gbit", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({
      value: "1",
      thresholdUnit: "gbit",
    });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "mbit",
      sampleValues: [1500],
      criteriaFilter,
    });

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation(inputs);

    expect(observation).toBe(
      "Metric Value (a) recorded latest 1.50 gbit across 1 data point.",
    );
    expect(observation).toContain("1.50 gbit");
  });

  /*
   * Unknown sample unit (empty legendUnit and no nativeUnitsByMetricName) but a
   * thresholdUnit "sec" is set. The conversion no-ops on the !sampleUnit guard
   * so 5 passes through unconverted, yet the value is still LABELLED "sec"
   * because the display unit follows the threshold unit.
   */
  test("unknown sampleUnit + thresholdUnit 'sec' — value unconverted, still labelled sec", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({
      value: "1",
      thresholdUnit: "sec",
    });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "",
      sampleValues: [5],
      criteriaFilter,
    });

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation(inputs);

    expect(observation).toBe(
      "Metric Value (a) recorded latest 5.00 sec across 1 data point.",
    );
    // Unconverted value, but labelled with the threshold unit.
    expect(observation).toContain("5.00 sec");
  });
});

describe("MonitorCriteriaObservationBuilder.getMetricValueDisplayUnit", () => {
  /*
   * Metric criteria, native "sec", no thresholdUnit => the native unit wins.
   */
  test("native 'sec' with no thresholdUnit => 'sec'", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({ value: "5" });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "sec",
      sampleValues: [0.5],
      criteriaFilter,
    });

    const unit: string | undefined =
      MonitorCriteriaObservationBuilder.getMetricValueDisplayUnit(inputs);

    expect(unit).toBe("sec");
  });

  /*
   * thresholdUnit always wins over the native unit, even in a compatible family.
   */
  test("thresholdUnit 'MB' over native 'ms' => 'MB' (threshold wins)", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({
      value: "1000",
      thresholdUnit: "MB",
    });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "ms",
      sampleValues: [5000],
      criteriaFilter,
    });

    const unit: string | undefined =
      MonitorCriteriaObservationBuilder.getMetricValueDisplayUnit(inputs);

    expect(unit).toBe("MB");
  });

  /*
   * thresholdUnit "sec" wins even when it is convertible from native "ms".
   */
  test("thresholdUnit 'sec' over convertible native 'ms' => 'sec'", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({
      value: "2",
      thresholdUnit: "sec",
    });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "ms",
      sampleValues: [2500],
      criteriaFilter,
    });

    const unit: string | undefined =
      MonitorCriteriaObservationBuilder.getMetricValueDisplayUnit(inputs);

    expect(unit).toBe("sec");
  });

  /*
   * Dimensionless native "1" resolves to undefined (suppressed), so callers can
   * safely append it as a suffix without producing "0.06 1".
   */
  test("dimensionless native '1' => undefined", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({ value: "0.9" });

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "1",
      sampleValues: [0.06],
      criteriaFilter,
    });

    const unit: string | undefined =
      MonitorCriteriaObservationBuilder.getMetricValueDisplayUnit(inputs);

    expect(unit).toBeUndefined();
  });

  /*
   * Non-metric criteria (checkOn !== MetricValue) short-circuit to undefined.
   */
  test("non-metric criteria (ResponseTime) => undefined", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.ResponseTime,
      filterType: FilterType.GreaterThan,
      value: "500",
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "sec",
      sampleValues: [0.5],
      criteriaFilter,
    });

    const unit: string | undefined =
      MonitorCriteriaObservationBuilder.getMetricValueDisplayUnit(inputs);

    expect(unit).toBeUndefined();
  });

  /*
   * A dataToProcess with no metricResult (empty object cast) must resolve to
   * undefined without throwing.
   */
  test("dataToProcess with no metricResult => undefined (no throw)", () => {
    const criteriaFilter: CriteriaFilter = metricFilter({ value: "5" });

    const base: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "sec",
      sampleValues: [0.5],
      criteriaFilter,
    });

    let unit: string | undefined;
    const call: () => void = () => {
      unit = MonitorCriteriaObservationBuilder.getMetricValueDisplayUnit({
        criteriaFilter,
        monitorStep: base.monitorStep,
        dataToProcess: {} as unknown as MetricMonitorResponse,
      });
    };

    expect(call).not.toThrow();
    expect(unit).toBeUndefined();
  });
});
