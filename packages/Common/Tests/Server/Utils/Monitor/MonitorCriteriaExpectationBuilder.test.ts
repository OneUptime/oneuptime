import MonitorCriteriaExpectationBuilder from "../../../../Server/Utils/Monitor/MonitorCriteriaExpectationBuilder";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import { describe, expect, test } from "@jest/globals";

/*
 * A minimal CriteriaFilter builder so each test states only the fields it
 * cares about; everything else stays undefined the way the persisted shape
 * allows.
 */
const makeFilter: (overrides: Partial<CriteriaFilter>) => CriteriaFilter = (
  overrides: Partial<CriteriaFilter>,
): CriteriaFilter => {
  return {
    checkOn: CheckOn.ResponseTime,
    filterType: undefined,
    value: undefined,
    ...overrides,
  };
};

describe("MonitorCriteriaExpectationBuilder", () => {
  describe("getCriteriaFilterDescription", () => {
    test("joins checkOn, filterType and value with single spaces", () => {
      const description: string =
        MonitorCriteriaExpectationBuilder.getCriteriaFilterDescription(
          makeFilter({
            checkOn: CheckOn.ResponseTime,
            filterType: FilterType.GreaterThan,
            value: 500,
          }),
        );

      expect(description).toBe("Response Time (in ms) Greater Than 500");
    });

    test("omits filterType and value when they are absent", () => {
      const description: string =
        MonitorCriteriaExpectationBuilder.getCriteriaFilterDescription(
          makeFilter({ checkOn: CheckOn.IsOnline }),
        );

      expect(description).toBe("Is Online");
    });

    test("keeps a zero value (does not treat 0 as missing)", () => {
      const description: string =
        MonitorCriteriaExpectationBuilder.getCriteriaFilterDescription(
          makeFilter({
            checkOn: CheckOn.ResponseTime,
            filterType: FilterType.EqualTo,
            value: 0,
          }),
        );

      expect(description).toBe("Response Time (in ms) Equal To 0");
    });

    test("drops a null value but keeps the filter type", () => {
      const description: string =
        MonitorCriteriaExpectationBuilder.getCriteriaFilterDescription(
          makeFilter({
            checkOn: CheckOn.ResponseTime,
            filterType: FilterType.IsEmpty,
            value: null as unknown as undefined,
          }),
        );

      expect(description).toBe("Response Time (in ms) Is Empty");
    });

    test("stringifies a string value as-is", () => {
      const description: string =
        MonitorCriteriaExpectationBuilder.getCriteriaFilterDescription(
          makeFilter({
            checkOn: CheckOn.ResponseBody,
            filterType: FilterType.Contains,
            value: "healthy",
          }),
        );

      expect(description).toBe("Response Body Contains healthy");
    });
  });

  describe("describeCriteriaExpectation", () => {
    test("returns null when no filter type is set", () => {
      expect(
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
          makeFilter({ filterType: undefined, value: 5 }),
        ),
      ).toBeNull();
    });

    test("renders each numeric comparison in plain English", () => {
      const cases: Array<[FilterType, string]> = [
        [FilterType.GreaterThan, "to be greater than 5"],
        [FilterType.GreaterThanOrEqualTo, "to be greater than or equal to 5"],
        [FilterType.LessThan, "to be less than 5"],
        [FilterType.LessThanOrEqualTo, "to be less than or equal to 5"],
        [FilterType.EqualTo, "to equal 5"],
        [FilterType.NotEqualTo, "to not equal 5"],
      ];

      for (const [filterType, expected] of cases) {
        expect(
          MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
            makeFilter({ filterType, value: 5 }),
          ),
        ).toBe(expected);
      }
    });

    test("appends the unit suffix to numeric-threshold comparisons only", () => {
      expect(
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
          makeFilter({ filterType: FilterType.GreaterThan, value: 5 }),
          { unit: "sec" },
        ),
      ).toBe("to be greater than 5 sec");

      // String comparisons carry their own wording and get no unit suffix.
      expect(
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
          makeFilter({ filterType: FilterType.Contains, value: "ok" }),
          { unit: "sec" },
        ),
      ).toBe("to contain ok");
    });

    test("renders string comparisons", () => {
      const cases: Array<[FilterType, string]> = [
        [FilterType.Contains, "to contain ok"],
        [FilterType.NotContains, "to not contain ok"],
        [FilterType.StartsWith, "to start with ok"],
        [FilterType.EndsWith, "to end with ok"],
      ];

      for (const [filterType, expected] of cases) {
        expect(
          MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
            makeFilter({ filterType, value: "ok" }),
          ),
        ).toBe(expected);
      }
    });

    test("renders valueless filter types with fixed wording", () => {
      const cases: Array<[FilterType, string]> = [
        [FilterType.IsEmpty, "to be empty"],
        [FilterType.IsNotEmpty, "to not be empty"],
        [FilterType.True, "to be true"],
        [FilterType.False, "to be false"],
        [FilterType.IsExecuting, "to be executing"],
        [FilterType.IsNotExecuting, "to not be executing"],
        [FilterType.EvaluatesToTrue, "to evaluate to true"],
      ];

      for (const [filterType, expected] of cases) {
        expect(
          MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
            makeFilter({ filterType }),
          ),
        ).toBe(expected);
      }
    });

    test("describes heartbeat windows with and without a value", () => {
      expect(
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
          makeFilter({ filterType: FilterType.RecievedInMinutes, value: 10 }),
        ),
      ).toBe("to receive a heartbeat within 10 minutes");

      expect(
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
          makeFilter({ filterType: FilterType.RecievedInMinutes }),
        ),
      ).toBe("to receive a heartbeat within the configured window");

      expect(
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
          makeFilter({
            filterType: FilterType.NotRecievedInMinutes,
            value: 3,
          }),
        ),
      ).toBe("to miss a heartbeat for at least 3 minutes");

      expect(
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
          makeFilter({ filterType: FilterType.NotRecievedInMinutes }),
        ),
      ).toBe("to miss a heartbeat within the configured window");
    });

    test("falls back to the raw filter type for unhandled types", () => {
      expect(
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
          makeFilter({ filterType: FilterType.Anomalous, value: 42 }),
        ),
      ).toBe("Anomalous 42");

      expect(
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
          makeFilter({ filterType: FilterType.Anomalous }),
        ),
      ).toBe("Anomalous");
    });

    test("appends an evaluation window when configured", () => {
      expect(
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
          makeFilter({
            filterType: FilterType.GreaterThan,
            value: 5,
            evaluateOverTime: true,
            evaluateOverTimeOptions: {
              timeValueInMinutes: 15,
              evaluateOverTimeType: EvaluateOverTimeType.Average,
            },
          }),
          { unit: "ms" },
        ),
      ).toBe("to be greater than 5 ms over the last 15 minutes using average");
    });
  });

  describe("getEvaluationWindowDescription", () => {
    test("returns null when nothing about a window is configured", () => {
      expect(
        MonitorCriteriaExpectationBuilder.getEvaluationWindowDescription(
          makeFilter({ filterType: FilterType.GreaterThan, value: 5 }),
        ),
      ).toBeNull();
    });

    test("describes only the time span when no aggregation is set", () => {
      expect(
        MonitorCriteriaExpectationBuilder.getEvaluationWindowDescription(
          makeFilter({
            evaluateOverTime: true,
            evaluateOverTimeOptions: {
              timeValueInMinutes: 30,
              evaluateOverTimeType: undefined,
            },
          }),
        ),
      ).toBe("over the last 30 minutes");
    });

    /*
     * The criteria form keeps a window when its box is unticked, so ticking
     * it again brings the window back. Unticked, the filter is judged on the
     * latest check, and nothing of the kept window describes it.
     */
    test("says nothing of a kept window when evaluateOverTime is off", () => {
      expect(
        MonitorCriteriaExpectationBuilder.getEvaluationWindowDescription(
          makeFilter({
            evaluateOverTime: false,
            evaluateOverTimeOptions: {
              timeValueInMinutes: 30,
              evaluateOverTimeType: EvaluateOverTimeType.Sum,
            },
          }),
        ),
      ).toBeNull();
    });

    test("keeps the metric aggregation of a filter evaluated on the latest check", () => {
      expect(
        MonitorCriteriaExpectationBuilder.getEvaluationWindowDescription(
          makeFilter({
            evaluateOverTime: false,
            evaluateOverTimeOptions: {
              timeValueInMinutes: 30,
              evaluateOverTimeType: EvaluateOverTimeType.Sum,
            },
            metricMonitorOptions: {
              metricAggregationType: EvaluateOverTimeType.MaximumValue,
            },
          }),
        ),
      ).toBe("using maximum value");
    });

    test("describes a body filter's window, judged check by check, as all values", () => {
      expect(
        MonitorCriteriaExpectationBuilder.getEvaluationWindowDescription(
          makeFilter({
            checkOn: CheckOn.ResponseBody,
            filterType: FilterType.NotContains,
            value: "App Title",
            evaluateOverTime: true,
            evaluateOverTimeOptions: {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.Average,
            },
          }),
          MonitorType.Website,
        ),
      ).toBe("over the last 5 minutes using all values");
    });

    /*
     * A body filter with the box ticked and no minutes is judged on the
     * latest check (CriteriaFilterMatchHistory.isJudgedFromHistory), so it
     * names no window.
     */
    test("says nothing of a window without minutes on a filter that keeps a match history", () => {
      expect(
        MonitorCriteriaExpectationBuilder.getEvaluationWindowDescription(
          makeFilter({
            checkOn: CheckOn.ResponseBody,
            filterType: FilterType.NotContains,
            value: "App Title",
            evaluateOverTime: true,
            evaluateOverTimeOptions: {
              timeValueInMinutes: undefined,
              evaluateOverTimeType: EvaluateOverTimeType.AllValues,
              onNoDataPolicy: NoDataPolicy.Trigger,
            },
          }),
          MonitorType.Website,
        ),
      ).toBeNull();
    });

    /*
     * The dashboard reads the same filter with the monitor's type, so the
     * incident must too: a JavaScript Expression keeps a match history on an
     * API monitor, not on a SQL Query monitor.
     */
    test("follows the monitor type for a JavaScript expression saved with an aggregate", () => {
      const expression: CriteriaFilter = makeFilter({
        checkOn: CheckOn.JavaScriptExpression,
        filterType: FilterType.EvaluatesToTrue,
        value: "{{rowCount}} > 0",
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 5,
          evaluateOverTimeType: EvaluateOverTimeType.Average,
        },
      });

      expect(
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
          expression,
          { monitorType: MonitorType.SQLQuery },
        ),
      ).toBe("to evaluate to true over the last 5 minutes using average");
      expect(
        MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
          expression,
          { monitorType: MonitorType.API },
        ),
      ).toBe("to evaluate to true over the last 5 minutes using all values");
    });

    test("falls back to the metric aggregation type when no over-time type is set", () => {
      expect(
        MonitorCriteriaExpectationBuilder.getEvaluationWindowDescription(
          makeFilter({
            metricMonitorOptions: {
              metricAggregationType: EvaluateOverTimeType.MaximumValue,
            },
          }),
        ),
      ).toBe("using maximum value");
    });

    test("prefers the over-time type over the metric aggregation type", () => {
      expect(
        MonitorCriteriaExpectationBuilder.getEvaluationWindowDescription(
          makeFilter({
            evaluateOverTime: true,
            evaluateOverTimeOptions: {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.Average,
            },
            metricMonitorOptions: {
              metricAggregationType: EvaluateOverTimeType.Sum,
            },
          }),
        ),
      ).toBe("over the last 5 minutes using average");
    });

    // The server judges a true/false series saved with an aggregate as All Values.
    test("describes a true/false filter saved with an aggregate as all values", () => {
      expect(
        MonitorCriteriaExpectationBuilder.getEvaluationWindowDescription(
          makeFilter({
            checkOn: CheckOn.DnsIsOnline,
            filterType: FilterType.False,
            evaluateOverTime: true,
            evaluateOverTimeOptions: {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.Average,
            },
          }),
        ),
      ).toBe("over the last 5 minutes using all values");
    });
  });
});
