import MonitorCriteriaExpectationBuilder from "../../../../Server/Utils/Monitor/MonitorCriteriaExpectationBuilder";
import {
  CriteriaFilter,
  CheckOn,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";

/*
 * Exhaustive unit coverage for the pure function
 * MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, options?).
 *
 * No metric fixtures are needed — every case constructs a plain
 * CriteriaFilter object and asserts the exact rendered expectation string.
 */

// Small factory so each test only tweaks the fields it cares about.
function makeFilter(overrides: Partial<CriteriaFilter>): CriteriaFilter {
  return {
    checkOn: CheckOn.MetricValue,
    filterType: FilterType.GreaterThan,
    value: "5",
    ...overrides,
  };
}

describe("MonitorCriteriaExpectationBuilder.describeCriteriaExpectation", () => {
  /*
   * Group A — every numeric-comparison filter type appends the unit suffix
   * (" <unit>") directly after the raw threshold value.
   */
  describe("numeric-comparison filter types append the unit", () => {
    test("GreaterThan => 'to be greater than 5 sec'", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.GreaterThan,
        value: "5",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to be greater than 5 sec");
    });

    test("GreaterThanOrEqualTo => 'to be greater than or equal to 5 sec'", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.GreaterThanOrEqualTo,
        value: "5",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to be greater than or equal to 5 sec");
    });

    test("LessThan => 'to be less than 5 sec'", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.LessThan,
        value: "5",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to be less than 5 sec");
    });

    test("LessThanOrEqualTo => 'to be less than or equal to 5 sec'", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.LessThanOrEqualTo,
        value: "5",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to be less than or equal to 5 sec");
    });

    test("EqualTo => 'to equal 5 sec'", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.EqualTo,
        value: "5",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to equal 5 sec");
    });

    test("NotEqualTo => 'to not equal 5 sec'", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.NotEqualTo,
        value: "5",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to not equal 5 sec");
    });
  });

  /*
   * Group B — the threshold value is interpolated RAW via a template string,
   * never number-formatted. "5" stays "5" (not "5.00"), "0.9" stays "0.9",
   * and a numeric 5 also renders as "5".
   */
  describe("threshold value is printed raw (no number formatting)", () => {
    test("string value '5' renders as '5', not '5.00'", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.GreaterThan,
        value: "5",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter);

      expect(result).toBe("to be greater than 5");
      expect(result).not.toContain("5.00");
    });

    test("string value '0.9' renders as '0.9'", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.GreaterThanOrEqualTo,
        value: "0.9",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter);

      expect(result).toBe("to be greater than or equal to 0.9");
    });

    test("numeric value 5 renders as '5' (not '5.00')", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.GreaterThan,
        value: 5,
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter);

      expect(result).toBe("to be greater than 5");
      expect(result).not.toContain("5.00");
    });
  });

  /*
   * Group C — non-numeric filter types supply their own wording and must
   * NEVER pick up the unit suffix, even when { unit: "sec" } is passed.
   */
  describe("non-numeric filter types ignore the unit", () => {
    test("Contains => 'to contain foo' (no ' sec')", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.Contains,
        value: "foo",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to contain foo");
      expect(result).not.toContain("sec");
    });

    test("NotContains => 'to not contain foo' (no ' sec')", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.NotContains,
        value: "foo",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to not contain foo");
      expect(result).not.toContain("sec");
    });

    test("StartsWith => 'to start with foo' (no ' sec')", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.StartsWith,
        value: "foo",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to start with foo");
      expect(result).not.toContain("sec");
    });

    test("EndsWith => 'to end with foo' (no ' sec')", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.EndsWith,
        value: "foo",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to end with foo");
      expect(result).not.toContain("sec");
    });

    test("IsEmpty => 'to be empty' (no unit suffix)", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.IsEmpty,
        value: undefined,
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to be empty");
      expect(result).not.toContain("sec");
    });

    test("IsNotEmpty => 'to not be empty' (no unit suffix)", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.IsNotEmpty,
        value: undefined,
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to not be empty");
      expect(result).not.toContain("sec");
    });

    test("True => 'to be true' (no unit suffix)", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.True,
        value: undefined,
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to be true");
      expect(result).not.toContain("sec");
    });

    test("False => 'to be false' (no unit suffix)", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.False,
        value: undefined,
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to be false");
      expect(result).not.toContain("sec");
    });

    test("IsExecuting / IsNotExecuting / EvaluatesToTrue get no unit suffix", () => {
      const isExecuting: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
          makeFilter({ filterType: FilterType.IsExecuting, value: undefined }),
          { unit: "sec" },
        );
      const isNotExecuting: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
          makeFilter({
            filterType: FilterType.IsNotExecuting,
            value: undefined,
          }),
          { unit: "sec" },
        );
      const evaluatesToTrue: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
          makeFilter({
            filterType: FilterType.EvaluatesToTrue,
            value: undefined,
          }),
          { unit: "sec" },
        );

      expect(isExecuting).toBe("to be executing");
      expect(isNotExecuting).toBe("to not be executing");
      expect(evaluatesToTrue).toBe("to evaluate to true");
      expect(isExecuting).not.toContain("sec");
      expect(isNotExecuting).not.toContain("sec");
      expect(evaluatesToTrue).not.toContain("sec");
    });
  });

  /*
   * Group D — backward compatibility. Calling with no options, { unit: undefined },
   * or { unit: "" } must all produce the exact same unitless string as before.
   */
  describe("backward compatibility (no/empty/undefined unit)", () => {
    test("no second argument => unitless string", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.GreaterThan,
        value: "5",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter);

      expect(result).toBe("to be greater than 5");
    });

    test("{ unit: undefined } => unitless string", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.GreaterThan,
        value: "5",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: undefined,
        });

      expect(result).toBe("to be greater than 5");
    });

    test("{ unit: '' } => unitless string", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.GreaterThan,
        value: "5",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "",
        });

      expect(result).toBe("to be greater than 5");
    });

    test("all three call forms produce the identical unitless string", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.GreaterThan,
        value: "5",
      });

      const noArg: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter);
      const undefUnit: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: undefined,
        });
      const emptyUnit: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "",
        });

      expect(noArg).toBe("to be greater than 5");
      expect(undefUnit).toBe(noArg);
      expect(emptyUnit).toBe(noArg);
    });
  });

  /*
   * Group E — evaluation-window clause. The unit is appended to the threshold
   * BEFORE the "over the last N minutes using <agg>" window clause. Aggregation
   * may come from evaluateOverTimeOptions.evaluateOverTimeType OR from
   * metricMonitorOptions.metricAggregationType.
   */
  describe("evaluation window ordering and aggregation", () => {
    test("unit precedes the window clause: 'to be greater than 5 sec over the last 5 minutes using average'", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.GreaterThan,
        value: "5",
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 5,
          evaluateOverTimeType: EvaluateOverTimeType.Average,
        },
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe(
        "to be greater than 5 sec over the last 5 minutes using average",
      );
    });

    test("aggregation from metricMonitorOptions.metricAggregationType yields 'using <lowercased>'", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.GreaterThan,
        value: "5",
        metricMonitorOptions: {
          metricAggregationType: EvaluateOverTimeType.Average,
        },
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter);

      expect(result).toBe("to be greater than 5 using average");
    });

    test("aggregation from metricMonitorOptions combines with the unit suffix", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.GreaterThan,
        value: "5",
        metricMonitorOptions: {
          metricAggregationType: EvaluateOverTimeType.MaximumValue,
        },
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      // "Maximum Value" lowercased.
      expect(result).toBe("to be greater than 5 sec using maximum value");
    });
  });

  /*
   * Group F — edge cases: an undefined filterType always returns null (even
   * with a unit), and heartbeat-style filters keep their own wording without a
   * unit suffix.
   */
  describe("edge cases", () => {
    test("filterType undefined => null (no unit)", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: undefined,
        value: "5",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter);

      expect(result).toBeNull();
    });

    test("filterType undefined => null (even when a unit is passed)", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: undefined,
        value: "5",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBeNull();
    });

    test("RecievedInMinutes with a value keeps its heartbeat wording and gets no unit suffix", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.IncomingRequest,
        filterType: FilterType.RecievedInMinutes,
        value: "5",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to receive a heartbeat within 5 minutes");
      expect(result).not.toContain("sec");
    });

    test("NotRecievedInMinutes with a value keeps its heartbeat wording and gets no unit suffix", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.IncomingRequest,
        filterType: FilterType.NotRecievedInMinutes,
        value: "5",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to miss a heartbeat for at least 5 minutes");
      expect(result).not.toContain("sec");
    });
  });

  /*
   * Group G — negative thresholds. The value is interpolated RAW via the
   * template string, so a negative sign and any decimals survive verbatim
   * (no toFixed / number formatting), and the unit suffix still follows.
   */
  describe("negative thresholds with a unit are interpolated raw", () => {
    test("GreaterThan '-5' with { unit: 'sec' } => 'to be greater than -5 sec'", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.GreaterThan,
        value: "-5",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to be greater than -5 sec");
      // Raw interpolation — never number-formatted.
      expect(result).not.toContain("-5.00");
    });

    test("LessThan '-0.5' with { unit: 'sec' } => 'to be less than -0.5 sec'", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.LessThan,
        value: "-0.5",
      });

      const result: string | null =
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(filter, {
          unit: "sec",
        });

      expect(result).toBe("to be less than -0.5 sec");
      // Raw interpolation — the decimal is kept as-is, not padded to "-0.50".
      expect(result).not.toContain("-0.50");
    });
  });
});
