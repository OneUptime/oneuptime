import { describe, expect, test } from "@jest/globals";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import { AggregationIntervalUtil } from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData, {
  MetricChartType,
} from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import { FilterType } from "Common/Types/Monitor/CriteriaFilter";
import TimeRange from "Common/Types/Time/TimeRange";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { MetricInvestigationQueries } from "../../FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationQueries";
import {
  DrawnThresholds,
  MetricInvestigationThreshold,
  getChartInterval,
  getDrawnThresholds,
  getRangeShowingHiddenThresholds,
  getRangeShowingInterval,
} from "../../FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationThresholds";

/*
 * Which of a monitor's threshold lines an investigation draws (issues #5759
 * and #6250): only while the metric it was drawn for is still on screen as
 * the monitor reads it, and at a range whose points are on its scale.
 */

const NOW_MS: number = Date.parse("2026-11-07T12:00:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;

const windowOf: (hours: number) => InBetween<Date> = (
  hours: number,
): InBetween<Date> => {
  return new InBetween<Date>(
    new Date(NOW_MS - hours * HOUR_MS),
    new Date(NOW_MS),
  );
};

const queryOf: (
  variable: string,
  changes?: Partial<{
    metricName: string;
    attributes: Record<string, unknown>;
    aggregation: MetricsAggregationType;
    groupBy: Array<string>;
  }>,
) => MetricQueryConfigData = (
  variable: string,
  changes?: Partial<{
    metricName: string;
    attributes: Record<string, unknown>;
    aggregation: MetricsAggregationType;
    groupBy: Array<string>;
  }>,
): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: changes?.metricName || `metric.${variable}`,
        attributes: (changes?.attributes || {
          "resource.host.name": "web-01",
        }) as never,
        aggegationType: changes?.aggregation || MetricsAggregationType.Avg,
      },
      groupByAttributeKeys: changes?.groupBy || ["host.name"],
    },
  };
};

const formulaOf: (variable: string, text: string) => MetricFormulaConfigData =
  (variable: string, text: string): MetricFormulaConfigData => {
    return {
      metricAliasData: {
        metricVariable: variable,
        title: "",
        description: "",
        legend: "",
        legendUnit: "",
      },
      metricFormulaData: { metricFormula: text },
    };
  };

const thresholdOf: (
  variable: string,
  onlyAtInterval?: AggregationInterval | null,
) => MetricInvestigationThreshold = (
  variable: string,
  onlyAtInterval?: AggregationInterval | null,
): MetricInvestigationThreshold => {
  return {
    metricVariable: variable,
    value: 90,
    name: `On ${variable}`,
    filterType: FilterType.GreaterThan,
    color: "#ef4444",
    shade: "above",
    onlyAtInterval: onlyAtInterval === undefined ? null : onlyAtInterval,
  };
};

const DEFAULTS: MetricInvestigationQueries = {
  queryConfigs: [queryOf("a"), queryOf("b")],
  formulaConfigs: [formulaOf("c", "a / b * 100")],
};

const drawnOf: (data: {
  thresholds: Array<MetricInvestigationThreshold>;
  queries?: MetricInvestigationQueries;
  hours?: number;
}) => DrawnThresholds = (data: {
  thresholds: Array<MetricInvestigationThreshold>;
  queries?: MetricInvestigationQueries;
  hours?: number;
}): DrawnThresholds => {
  return getDrawnThresholds({
    thresholds: data.thresholds,
    defaultQueries: DEFAULTS,
    queries: data.queries || DEFAULTS,
    window: windowOf(data.hours === undefined ? 3 : data.hours),
  });
};

const variablesOf: (thresholds: Array<{ metricVariable: string }>) => Array<string> =
  (thresholds: Array<{ metricVariable: string }>): Array<string> => {
    return thresholds.map((threshold: { metricVariable: string }) => {
      return threshold.metricVariable;
    });
  };

describe("lines on the metrics the page started from", () => {
  test("are drawn while those metrics are on screen", () => {
    expect(
      variablesOf(
        drawnOf({ thresholds: [thresholdOf("a"), thresholdOf("c")] }).drawn,
      ),
    ).toEqual(["a", "c"]);
  });

  test.each([
    ["its metric", { metricName: "other.metric" }],
    ["its filters", { attributes: { "resource.host.name": "web-02" } }],
    ["its aggregation", { aggregation: MetricsAggregationType.Max }],
    ["its grouping", { groupBy: ["service.name"] }],
  ])(
    "go once the reader changes %s",
    (_name: string, changes: Record<string, unknown>) => {
      const queries: MetricInvestigationQueries = {
        ...DEFAULTS,
        queryConfigs: [queryOf("a", changes), queryOf("b")],
      };

      expect(
        variablesOf(drawnOf({ thresholds: [thresholdOf("a")], queries }).drawn),
      ).toEqual([]);
    },
  );

  test("stay when only how it is drawn changes: a chart type, a colour, a unit to read it in, a title", () => {
    const restyled: MetricQueryConfigData = {
      ...queryOf("a"),
      chartType: MetricChartType.BAR,
      color: "#123456",
      warningThreshold: 50,
      metricAliasData: {
        metricVariable: "a",
        title: "CPU of the web hosts",
        description: "changed",
        legend: "cpu",
        legendUnit: "%",
      },
    };

    expect(
      variablesOf(
        drawnOf({
          thresholds: [thresholdOf("a")],
          queries: { ...DEFAULTS, queryConfigs: [restyled, queryOf("b")] },
        }).drawn,
      ),
    ).toEqual(["a"]);
  });

  test("a formula's line goes with a change to it, or to a query it reads", () => {
    expect(
      variablesOf(
        drawnOf({
          thresholds: [thresholdOf("c")],
          queries: {
            ...DEFAULTS,
            formulaConfigs: [formulaOf("c", "a / b")],
          },
        }).drawn,
      ),
    ).toEqual([]);
    expect(
      variablesOf(
        drawnOf({
          thresholds: [thresholdOf("c")],
          queries: {
            ...DEFAULTS,
            queryConfigs: [queryOf("a"), queryOf("b", { metricName: "x" })],
          },
        }).drawn,
      ),
    ).toEqual([]);
  });

  test("a formula's line stays through a change to a query it does not read", () => {
    const defaults: MetricInvestigationQueries = {
      queryConfigs: [queryOf("a"), queryOf("b"), queryOf("d")],
      formulaConfigs: [formulaOf("c", "a / b")],
    };

    expect(
      variablesOf(
        getDrawnThresholds({
          thresholds: [thresholdOf("c")],
          defaultQueries: defaults,
          queries: {
            ...defaults,
            queryConfigs: [
              queryOf("a"),
              queryOf("b"),
              queryOf("d", { metricName: "other" }),
            ],
          },
          window: windowOf(3),
        }).drawn,
      ),
    ).toEqual(["c"]);
  });

  test("a line on a metric that was never there, or was removed, is not drawn", () => {
    expect(
      variablesOf(drawnOf({ thresholds: [thresholdOf("zz")] }).drawn),
    ).toEqual([]);
    expect(
      variablesOf(
        drawnOf({
          thresholds: [thresholdOf("b")],
          queries: { ...DEFAULTS, queryConfigs: [queryOf("a")] },
        }).drawn,
      ),
    ).toEqual([]);
  });

  test("no lines, no work", () => {
    expect(drawnOf({ thresholds: [] })).toEqual({
      drawn: [],
      hiddenAtThisRange: [],
    });
    expect(
      getDrawnThresholds({
        thresholds: undefined,
        defaultQueries: DEFAULTS,
        queries: DEFAULTS,
        window: windowOf(3),
      }),
    ).toEqual({ drawn: [], hiddenAtThisRange: [] });
  });
});

describe("lines on a sum or a count", () => {
  test("show where each point covers what the monitor reads, and are offered elsewhere", () => {
    const minuteLine: MetricInvestigationThreshold = thresholdOf(
      "a",
      AggregationInterval.Minute,
    );

    expect(variablesOf(drawnOf({ thresholds: [minuteLine], hours: 3 }).drawn)).toEqual(
      ["a"],
    );

    const atADay: DrawnThresholds = drawnOf({
      thresholds: [minuteLine, thresholdOf("b")],
      hours: 24,
    });
    expect(variablesOf(atADay.drawn)).toEqual(["b"]);
    expect(variablesOf(atADay.hiddenAtThisRange)).toEqual(["a"]);
    expect(getRangeShowingHiddenThresholds(atADay.hiddenAtThisRange)).toBe(
      TimeRange.PAST_THREE_HOURS,
    );
  });

  test("a line on a changed metric is neither drawn nor offered", () => {
    const changed: DrawnThresholds = drawnOf({
      thresholds: [thresholdOf("a", AggregationInterval.Minute)],
      queries: {
        ...DEFAULTS,
        queryConfigs: [queryOf("a", { metricName: "x" }), queryOf("b")],
      },
      hours: 24,
    });

    expect(changed).toEqual({ drawn: [], hiddenAtThisRange: [] });
  });

  test("without a window to read, they wait", () => {
    expect(
      getDrawnThresholds({
        thresholds: [thresholdOf("a", AggregationInterval.Minute)],
        defaultQueries: DEFAULTS,
        queries: DEFAULTS,
        window: null,
      }).hiddenAtThisRange,
    ).toHaveLength(1);
  });
});

describe("the range that shows a line", () => {
  test.each([
    [AggregationInterval.Minute, TimeRange.PAST_THREE_HOURS],
    [AggregationInterval.FiveMinutes, null],
    [AggregationInterval.FifteenMinutes, TimeRange.PAST_ONE_DAY],
    [AggregationInterval.ThirtyMinutes, TimeRange.PAST_TWO_DAYS],
    [AggregationInterval.Hour, TimeRange.PAST_ONE_WEEK],
    [AggregationInterval.Day, TimeRange.PAST_ONE_MONTH],
    [AggregationInterval.Week, TimeRange.PAST_THREE_MONTHS],
    [AggregationInterval.Total, null],
    [null, null],
  ])(
    "points of %s: %s",
    (interval: AggregationInterval | null, range: TimeRange | null) => {
      expect(getRangeShowingInterval(interval)).toBe(range);
    },
  );

  test("each range offered draws its points at the interval it is offered for", () => {
    for (const interval of Object.values(AggregationInterval)) {
      const range: TimeRange | null = getRangeShowingInterval(interval);

      if (!range) {
        continue;
      }

      const lengths: Record<string, number> = {
        [TimeRange.PAST_THREE_HOURS]: 3,
        [TimeRange.PAST_ONE_DAY]: 24,
        [TimeRange.PAST_TWO_DAYS]: 48,
        [TimeRange.PAST_ONE_WEEK]: 24 * 7,
        [TimeRange.PAST_ONE_MONTH]: 24 * 30,
        [TimeRange.PAST_THREE_MONTHS]: 24 * 90,
      };

      expect(getChartInterval(windowOf(lengths[range]!))).toBe(interval);
    }
  });

  test("the first hidden line with a range to offer decides it", () => {
    expect(
      getRangeShowingHiddenThresholds([
        thresholdOf("a", AggregationInterval.FiveMinutes),
        thresholdOf("b", AggregationInterval.FifteenMinutes),
      ]),
    ).toBe(TimeRange.PAST_ONE_DAY);
    expect(
      getRangeShowingHiddenThresholds([
        thresholdOf("a", AggregationInterval.FiveMinutes),
      ]),
    ).toBeNull();
    expect(getRangeShowingHiddenThresholds([])).toBeNull();
  });
});

describe("a chart's points", () => {
  test("are read at the interval the metric view reads its aligned window at (seeded)", () => {
    const random: SeededRandom = seededRandom(5759);

    for (let round: number = 0; round < 500; round++) {
      const lengthMs: number = 1 + random(90 * 24) * HOUR_MS + random(HOUR_MS);
      const window: InBetween<Date> = new InBetween<Date>(
        new Date(NOW_MS - lengthMs),
        new Date(NOW_MS),
      );

      expect(getChartInterval(window)).toBe(
        AggregationIntervalUtil.getIntervalAlignedWindow({
          startDate: window.startValue,
          endDate: window.endValue,
        }).interval,
      );
    }
  });

  test("a window that is not one has none", () => {
    expect(getChartInterval(null)).toBeNull();
    expect(
      getChartInterval(
        new InBetween<Date>(new Date(NOW_MS), new Date(NOW_MS - HOUR_MS)),
      ),
    ).toBeNull();
  });
});
