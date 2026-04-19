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
import MetricQueryConfigData from "../../../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../../../Types/Metrics/MetricQueryData";
import MetricsViewConfig from "../../../../../Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "../../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
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
    // User incorrectly picked 'MB' but metric is in ms. Conversion should
    // no-op and comparison proceeds in the user's raw unit.
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

    // No conversion possible, so the displayed unit/values use user's MB
    // label but values are passed through.
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
});
