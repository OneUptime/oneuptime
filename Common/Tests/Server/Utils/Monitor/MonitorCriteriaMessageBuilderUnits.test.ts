import MonitorCriteriaMessageBuilder from "../../../../Server/Utils/Monitor/MonitorCriteriaMessageBuilder";
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
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../../Types/Metrics/MetricQueryData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Assembles the monitor + metric response + step trio the message builder
 * needs, for a single metric alias "a" with a given native/legend unit and
 * sample values. Mirrors the fixture used by MetricMonitorCriteria.test.ts.
 */
function buildInputs(input: {
  metricNativeUnit: string;
  metricName: string;
  sampleValues: Array<number>;
  criteriaFilter: CriteriaFilter;
}): {
  monitor: Monitor;
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
        metricName: input.metricName,
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
    monitor: new Monitor(),
    criteriaFilter: input.criteriaFilter,
    monitorStep,
    dataToProcess,
  };
}

describe("MonitorCriteriaMessageBuilder — metric unit labelling", () => {
  test("labels the observed value and threshold with the metric's native unit", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "5",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.Average,
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "sec",
      metricName: "http.client.request.duration",
      sampleValues: [0.06, 0.06, 0.06],
      criteriaFilter,
    });

    const message: string =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: false,
        matchMessage: null,
      });

    // Observed value carries the unit.
    expect(message).toContain("latest 0.06 sec");
    expect(message).toContain("min 0.06 sec");
    expect(message).toContain("max 0.06 sec");
    // Threshold in the expectation clause carries the same unit.
    expect(message).toContain("greater than 5 sec");
  });

  test("uses the user's threshold unit when one is configured", () => {
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

    // Samples arrive in ms; converted to sec (0.5) for the message.
    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "ms",
      metricName: "http.client.request.duration",
      sampleValues: [500],
      criteriaFilter,
    });

    const message: string =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: false,
        matchMessage: null,
      });

    expect(message).toContain("latest 0.50 sec");
    expect(message).toContain("greater than 2 sec");
  });

  test("omits the unit for dimensionless ratio metrics (native unit '1')", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "0.9",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.Average,
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "1",
      metricName: "system.cpu.utilization",
      sampleValues: [0.06],
      criteriaFilter,
    });

    const message: string =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: false,
        matchMessage: null,
      });

    expect(message).toContain("latest 0.06");
    // No stray "0.06 1" and no unit on the threshold.
    expect(message).not.toContain("0.06 1");
    expect(message).toContain("greater than 0.9");
    expect(message).not.toContain("greater than 0.9 1");
  });
});

/*
 * End-to-end assertions on the whole "Evaluation Logs" line users see:
 * buildCriteriaFilterMessage stitches the observation ("Metric Value (a)
 * recorded latest …") to the expectation ("(expected to be greater than …)").
 * These lock down the exact wording, unit placement, and singular/plural
 * grammar rather than just fragments.
 */
describe("MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage — Evaluation Logs line", () => {
  test("native-unit GreaterThan failure renders the exact full message", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "5",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.Average,
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "sec",
      metricName: "http.client.request.duration",
      sampleValues: [0.06, 0.06, 0.06],
      criteriaFilter,
    });

    const message: string =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: false,
        matchMessage: null,
      });

    expect(message).toBe(
      "Metric Value (a) recorded latest 0.06 sec (min 0.06 sec, max 0.06 sec) across 3 data points. (expected to be greater than 5 sec using average).",
    );
  });

  test("LessThan failure carries the unit on both the observed value and the threshold", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.LessThan,
      value: "5",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.Average,
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "sec",
      metricName: "http.client.request.duration",
      sampleValues: [12, 8, 10],
      criteriaFilter,
    });

    const message: string =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: false,
        matchMessage: null,
      });

    expect(message).toBe(
      "Metric Value (a) recorded latest 10.00 sec (min 8.00 sec, max 12.00 sec) across 3 data points. (expected to be less than 5 sec using average).",
    );
    // The unit rides both the observed value and the "less than N unit" clause.
    expect(message).toContain("latest 10.00 sec");
    expect(message).toContain("less than 5 sec");
  });

  test("thresholdUnit conversion: native ms samples display as sec and the threshold reads 'sec'", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "2",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.MaximumValue,
        thresholdUnit: "sec",
      },
    };

    // 1500/2500/3500 ms convert to 1.5/2.5/3.5 sec for display.
    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "ms",
      metricName: "http.client.request.duration",
      sampleValues: [1500, 2500, 3500],
      criteriaFilter,
    });

    const message: string =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: false,
        matchMessage: null,
      });

    expect(message).toBe(
      "Metric Value (a) recorded latest 3.50 sec (min 1.50 sec, max 3.50 sec) across 3 data points. (expected to be greater than 2 sec using maximum value).",
    );
    // The raw ms magnitudes never leak into the rendered line.
    expect(message).not.toContain("1500");
    expect(message).not.toContain(" ms");
  });

  test("dimensionless ratio metric (unit '1') labels neither the value nor the threshold", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "0.9",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.Average,
      },
    };

    /*
     * A ratio pegged at 1.0 (100%) renders "1.00" — the exact case a naive
     * `not.toContain(" 1")` guard would false-fail on, since " 1.00" contains
     * " 1". We assert the whole message with toBe instead, which stays honest
     * whether or not a rendered number happens to start with a 1.
     */
    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "1",
      metricName: "system.cpu.utilization",
      sampleValues: [0.95, 0.99, 1.0],
      criteriaFilter,
    });

    const message: string =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: false,
        matchMessage: null,
      });

    // Whole-message assertion: the dimensionless "1" is suppressed on both the
    // observed value and the threshold, even though "1.00" appears in the text.
    expect(message).toBe(
      "Metric Value (a) recorded latest 1.00 (min 0.95, max 1.00) across 3 data points. (expected to be greater than 0.9 using average).",
    );
    // Neither the value nor the threshold carries a unit: each number is
    // immediately followed by punctuation/wording, never a " 1" unit suffix.
    expect(message).toContain("latest 1.00 (min 0.95, max 1.00)");
    expect(message).toContain("greater than 0.9 using average");
  });

  /*
   * Flagship fraction→percent end-to-end: a ratio metric whose native unit is
   * the dimensionless "1" is compared against a "%" threshold. The lone 0.06
   * sample is a 6% fraction; it is converted INTO "%" for display (0.06 * 100
   * = 6 → "6.00 %"), and BOTH the observed value and the threshold are
   * labelled "%". The single sample takes the singular "across 1 data point"
   * with no "(min .., max ..)" clause.
   */
  test("fraction native unit converts into a '%' threshold on both the value and the threshold", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "90",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.Average,
        thresholdUnit: "%",
      },
    };

    // Native "1" sample 0.06 (a 6% fraction) converts to 6 in "%".
    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "1",
      metricName: "system.cpu.utilization",
      sampleValues: [0.06],
      criteriaFilter,
    });

    const message: string =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: false,
        matchMessage: null,
      });

    expect(message).toBe(
      "Metric Value (a) recorded latest 6.00 % across 1 data point. (expected to be greater than 90 % using average).",
    );
    // Both the converted observed value and the threshold carry the "%" unit.
    expect(message).toContain("latest 6.00 %");
    expect(message).toContain("greater than 90 %");
    // The raw fraction magnitude never leaks into the rendered line.
    expect(message).not.toContain("0.06");
    // Singular grammar for the lone sample — no "(min .., max ..)" clause.
    expect(message).toContain("across 1 data point.");
    expect(message).not.toContain("data points");
  });

  test("matchMessage is returned verbatim, ignoring observation and expectation", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "5",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.Average,
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "sec",
      metricName: "http.client.request.duration",
      sampleValues: [0.06, 0.06, 0.06],
      criteriaFilter,
    });

    const matchMessage: string =
      "CPU on prod-01 climbed to 0.95 across the last 3 samples.";

    // Passthrough wins over a failing evaluation …
    expect(
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: false,
        matchMessage,
      }),
    ).toBe(matchMessage);

    // … and even over a met criteria (matchMessage is checked first).
    const passthroughWhenMet: string =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: true,
        matchMessage,
      });
    expect(passthroughWhenMet).toBe(matchMessage);
    // None of the synthesized wording bleeds through.
    expect(passthroughWhenMet).not.toContain("recorded");
    expect(passthroughWhenMet).not.toContain("expected");
  });

  test("didMeetCriteria true yields a 'condition met.' line with no observed numbers", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "5",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.Average,
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "sec",
      metricName: "http.client.request.duration",
      sampleValues: [0.06, 0.06, 0.06],
      criteriaFilter,
    });

    const message: string =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: true,
        matchMessage: null,
      });

    expect(message).toBe("Metric Value Greater Than 5 condition met.");
    // The met-condition line summarizes intent, not the raw samples.
    expect(message).not.toContain("recorded");
    expect(message).not.toContain("0.06");
    expect(message).not.toContain("data point");
  });

  test("single-sample failure uses the singular 'across 1 data point' with a unit", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "5",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.Average,
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "sec",
      metricName: "http.client.request.duration",
      sampleValues: [7],
      criteriaFilter,
    });

    const message: string =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: false,
        matchMessage: null,
      });

    expect(message).toBe(
      "Metric Value (a) recorded latest 7.00 sec across 1 data point. (expected to be greater than 5 sec using average).",
    );
    // Singular grammar, and no "(min .., max ..)" clause for a lone sample.
    expect(message).toContain("across 1 data point.");
    expect(message).not.toContain("data points");
    expect(message).not.toContain("min 7.00");
  });

  test("EqualTo scenario renders the full line with the metric unit", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.EqualTo,
      value: "100",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.Average,
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "ms",
      metricName: "http.client.request.duration",
      sampleValues: [100, 100, 100],
      criteriaFilter,
    });

    const message: string =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: false,
        matchMessage: null,
      });

    expect(message).toBe(
      "Metric Value (a) recorded latest 100.00 ms (min 100.00 ms, max 100.00 ms) across 3 data points. (expected to equal 100 ms using average).",
    );
  });

  test("GreaterThanOrEqualTo scenario renders the full line with the metric unit", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThanOrEqualTo,
      value: "50",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.MaximumValue,
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "ms",
      metricName: "http.client.request.duration",
      sampleValues: [60, 55, 70],
      criteriaFilter,
    });

    const message: string =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: false,
        matchMessage: null,
      });

    expect(message).toBe(
      "Metric Value (a) recorded latest 70.00 ms (min 55.00 ms, max 70.00 ms) across 3 data points. (expected to be greater than or equal to 50 ms using maximum value).",
    );
  });

  test("the parenthesized expectation follows a period + space after the observation", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "5",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "sec",
      metricName: "http.client.request.duration",
      sampleValues: [0.06, 0.06, 0.06],
      criteriaFilter,
    });

    const message: string =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: false,
        matchMessage: null,
      });

    // "... data points. (expected ...)." — period, space, then the clause.
    expect(message).toContain("data points. (expected ");
    expect(message).toMatch(/ data points\. \(expected .+\)\.$/);
    // AnyValue lowercases to "any value".
    expect(message).toContain("using any value");
  });
});
