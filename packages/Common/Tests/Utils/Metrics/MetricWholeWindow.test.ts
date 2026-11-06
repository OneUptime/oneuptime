import { describe, expect, test } from "@jest/globals";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricWholeWindow from "../../../Utils/Metrics/MetricWholeWindow";
import MetricFormulaEvaluator from "../../../Utils/Metrics/MetricFormulaEvaluator";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "../../../Types/Monitor/MonitorStepMetricMonitor";
import RollingTime from "../../../Types/RollingTime/RollingTime";

/*
 * A METRIC MONITOR THAT READS ITS WHOLE WINDOW AS ONE VALUE
 * (MonitorStepMetricMonitor.aggregatesWholeWindow, MetricWholeWindow).
 *
 * Each query is one row for the window, which the analytics store stamps
 * with the earliest point it folded - a different time for each query - so
 * every row is stamped with the window's end, where a formula joins them;
 * and an ungrouped count that read no point is a total of zero, so a
 * formula adding two counts up joins even when one of them had no point.
 */

const WINDOW_END: Date = new Date("2026-11-02T12:30:30.000Z");

function result(rows: Array<[string, number]>): AggregatedResult {
  return {
    data: rows.map(([time, value]: [string, number]) => {
      return { timestamp: new Date(time), value: value };
    }),
  };
}

describe("MetricWholeWindow.toWholeWindowResult", () => {
  test("stamps every row with the window's end", () => {
    expect(
      MetricWholeWindow.toWholeWindowResult({
        result: result([["2026-11-02T12:05:00.000Z", 12]]),
        windowEnd: WINDOW_END,
        aggregationType: AggregationType.Sum,
        isGrouped: false,
      }).data,
    ).toEqual([{ timestamp: WINDOW_END, value: 12 }]);
  });

  test("keeps a grouped row's attributes, stamped at the window's end", () => {
    expect(
      MetricWholeWindow.toWholeWindowResult({
        result: {
          data: [
            {
              timestamp: new Date("2026-11-02T12:05:00.000Z"),
              value: 4,
              attributes: { queue: "orders" },
            },
            {
              timestamp: new Date("2026-11-02T12:12:00.000Z"),
              value: 9,
              attributes: { queue: "billing" },
            },
          ],
        },
        windowEnd: WINDOW_END,
        aggregationType: AggregationType.Sum,
        isGrouped: true,
      }).data,
    ).toEqual([
      { timestamp: WINDOW_END, value: 4, attributes: { queue: "orders" } },
      { timestamp: WINDOW_END, value: 9, attributes: { queue: "billing" } },
    ]);
  });

  test.each([AggregationType.Sum, AggregationType.Count])(
    "an ungrouped %s that read nothing is a total of zero",
    (aggregationType: AggregationType) => {
      expect(
        MetricWholeWindow.toWholeWindowResult({
          result: { data: [] },
          windowEnd: WINDOW_END,
          aggregationType: aggregationType,
          isGrouped: false,
        }).data,
      ).toEqual([{ timestamp: WINDOW_END, value: 0 }]);
    },
  );

  test.each([
    AggregationType.Avg,
    AggregationType.Max,
    AggregationType.Min,
    AggregationType.P95,
  ])(
    "a %s that read nothing is no reading",
    (aggregationType: AggregationType) => {
      expect(
        MetricWholeWindow.toWholeWindowResult({
          result: { data: [] },
          windowEnd: WINDOW_END,
          aggregationType: aggregationType,
          isGrouped: false,
        }).data,
      ).toEqual([]);
    },
  );

  test("a grouped count that read nothing names no series: none is made up", () => {
    expect(
      MetricWholeWindow.toWholeWindowResult({
        result: { data: [] },
        windowEnd: WINDOW_END,
        aggregationType: AggregationType.Sum,
        isGrouped: true,
      }).data,
    ).toEqual([]);
  });

  test("leaves the rest of the result as it was", () => {
    const original: AggregatedResult = result([
      ["2026-11-02T12:05:00.000Z", 3],
    ]);

    const whole: AggregatedResult = MetricWholeWindow.toWholeWindowResult({
      result: original,
      windowEnd: WINDOW_END,
      aggregationType: AggregationType.Sum,
      isGrouped: false,
    });

    expect(whole).not.toBe(original);
    // The read's own rows are not changed under it.
    expect(original.data[0]!.timestamp).toEqual(
      new Date("2026-11-02T12:05:00.000Z"),
    );
  });

  test("Sum and Count are the folds whose empty window is zero", () => {
    expect(MetricWholeWindow.isCountAggregation(AggregationType.Sum)).toBe(
      true,
    );
    expect(MetricWholeWindow.isCountAggregation(AggregationType.Count)).toBe(
      true,
    );
    expect(MetricWholeWindow.isCountAggregation(AggregationType.Avg)).toBe(
      false,
    );
    expect(MetricWholeWindow.isCountAggregation(AggregationType.Max)).toBe(
      false,
    );
  });
});

/*
 * Why both halves matter: a formula joins its variables by time. Two
 * window totals stamped at their own earliest points - the first failure,
 * the first request - join nothing; stamped at the window's end they do.
 * And a count with no point would leave the sum of two counts with nothing
 * to join; its zero makes the sum the other count.
 */
describe("a formula over whole-window reads", () => {
  const queryConfigs: Array<MetricQueryConfigData> = [
    {
      metricAliasData: { metricVariable: "failed" },
      metricQueryData: { filterData: { metricName: "failed" } },
    },
    {
      metricAliasData: { metricVariable: "failed_second" },
      metricQueryData: { filterData: { metricName: "failed_second" } },
    },
    {
      metricAliasData: { metricVariable: "requests" },
      metricQueryData: { filterData: { metricName: "requests" } },
    },
  ] as unknown as Array<MetricQueryConfigData>;

  function share(results: Array<AggregatedResult>): AggregatedResult {
    return MetricFormulaEvaluator.evaluateFormula({
      formula: "($failed + $failed_second) / $requests * 100",
      queryConfigs: queryConfigs,
      formulaConfigs: [],
      results: results,
    });
  }

  test("read as the store stamps them, the totals join nothing", () => {
    expect(
      share([
        result([["2026-11-02T12:10:00.000Z", 10]]),
        result([["2026-11-02T12:15:00.000Z", 5]]),
        result([["2026-11-02T12:05:00.000Z", 300]]),
      ]).data,
    ).toEqual([]);
  });

  test("stamped at the window's end, with an empty count as zero, they are the window's share", () => {
    const whole: (
      read: AggregatedResult,
      aggregationType?: AggregationType,
    ) => AggregatedResult = (
      read: AggregatedResult,
      aggregationType: AggregationType = AggregationType.Sum,
    ): AggregatedResult => {
      return MetricWholeWindow.toWholeWindowResult({
        result: read,
        windowEnd: WINDOW_END,
        aggregationType: aggregationType,
        isGrouped: false,
      });
    };

    expect(
      share([
        whole(result([["2026-11-02T12:10:00.000Z", 10]])),
        whole({ data: [] }),
        whole(result([["2026-11-02T12:05:00.000Z", 200]])),
      ]).data,
    ).toEqual([{ timestamp: WINDOW_END, value: 5 }]);
  });
});

describe("MonitorStepMetricMonitorUtil.aggregatesWholeWindow", () => {
  const base: MonitorStepMetricMonitor = {
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    rollingTime: RollingTime.Past30Minutes,
  };

  test("only when the step says so", () => {
    expect(MonitorStepMetricMonitorUtil.aggregatesWholeWindow(base)).toBe(
      false,
    );
    expect(
      MonitorStepMetricMonitorUtil.aggregatesWholeWindow({
        ...base,
        aggregatesWholeWindow: true,
      }),
    ).toBe(true);
    expect(
      MonitorStepMetricMonitorUtil.aggregatesWholeWindow({
        ...base,
        aggregatesWholeWindow: false,
      }),
    ).toBe(false);
    expect(
      MonitorStepMetricMonitorUtil.aggregatesWholeWindow({
        ...base,
        aggregatesWholeWindow: "true" as unknown as boolean,
      }),
    ).toBe(false);
    expect(MonitorStepMetricMonitorUtil.aggregatesWholeWindow(undefined)).toBe(
      false,
    );
    expect(MonitorStepMetricMonitorUtil.aggregatesWholeWindow(null)).toBe(
      false,
    );
  });

  test("survives a save and a read back", () => {
    const saved: MonitorStepMetricMonitor =
      MonitorStepMetricMonitorUtil.fromJSON(
        JSON.parse(
          JSON.stringify(
            MonitorStepMetricMonitorUtil.toJSON({
              ...base,
              aggregatesWholeWindow: true,
            }),
          ),
        ),
      );

    expect(MonitorStepMetricMonitorUtil.aggregatesWholeWindow(saved)).toBe(
      true,
    );
  });
});
