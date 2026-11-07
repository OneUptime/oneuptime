import { describe, expect, test } from "@jest/globals";
import { FilterType } from "Common/Types/Monitor/CriteriaFilter";
import ChartReferenceLineProps from "Common/UI/Components/Charts/Types/ReferenceLineProps";
import { generatedTexts } from "Common/Tests/Helpers/GeneratedTexts";
import {
  METRIC_CHART_THRESHOLD_NAME_MAX_LENGTH,
  MetricChartThreshold,
  buildMetricChartThresholdLines,
  getMetricChartThresholdLabel,
  getThresholdComparisonSymbol,
  shortenThresholdName,
  trimTrailingZeros,
} from "../../FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricChartThresholds";

/*
 * A monitor's thresholds drawn on its metric charts (issues #5759 and
 * #6250): on the chart of the query or formula each compares, in that
 * chart's unit, named as the criteria is named.
 */

const THRESHOLD: MetricChartThreshold = {
  metricVariable: "a",
  value: 90,
  name: "High CPU",
  filterType: FilterType.GreaterThan,
  color: "#ef4444",
  shade: "above",
};

const linesOf: (data: {
  thresholds: Array<MetricChartThreshold>;
  metricVariable?: string;
  unit?: string;
  metricName?: string;
  drawnValues?: Array<number | undefined>;
}) => Array<ChartReferenceLineProps> = (data: {
  thresholds: Array<MetricChartThreshold>;
  metricVariable?: string;
  unit?: string;
  metricName?: string;
  drawnValues?: Array<number | undefined>;
}): Array<ChartReferenceLineProps> => {
  return buildMetricChartThresholdLines({
    thresholds: data.thresholds,
    metricVariable: data.metricVariable === undefined ? "a" : data.metricVariable,
    unit: data.unit === undefined ? "%" : data.unit,
    formatterOptions: data.metricName
      ? { metricName: data.metricName }
      : undefined,
    drawnValues: data.drawnValues,
  });
};

describe("the comparison a line stands for", () => {
  test.each([
    [FilterType.GreaterThan, ">"],
    [FilterType.GreaterThanOrEqualTo, "≥"],
    [FilterType.LessThan, "<"],
    [FilterType.LessThanOrEqualTo, "≤"],
    [FilterType.EqualTo, "="],
    [FilterType.NotEqualTo, "≠"],
    [FilterType.ForecastAbove, ">"],
    [FilterType.ForecastBelow, "<"],
    [FilterType.Contains, ""],
  ])("%s reads %p", (filterType: FilterType, symbol: string) => {
    expect(getThresholdComparisonSymbol(filterType)).toBe(symbol);
  });
});

describe("a value as a person typed it", () => {
  test.each([
    ["85.00%", "85%"],
    ["1.50 GB", "1.5 GB"],
    ["0.950", "0.95"],
    ["10.05 ms", "10.05 ms"],
    ["100", "100"],
    ["12.30 / 4.00", "12.3 / 4"],
    ["-2.10%", "-2.1%"],
  ])("%s reads %s", (formatted: string, trimmed: string) => {
    expect(trimTrailingZeros(formatted)).toBe(trimmed);
  });
});

describe("what a line says beside it", () => {
  test("its name, with the comparison when the name does not say it", () => {
    expect(
      getMetricChartThresholdLabel({
        name: "High CPU",
        filterType: FilterType.GreaterThan,
        formattedValue: "90%",
      }),
    ).toBe("High CPU (> 90%)");
  });

  test("its name alone when the name already says the value", () => {
    expect(
      getMetricChartThresholdLabel({
        name: "High Node Memory - Utilization > 85%",
        filterType: FilterType.GreaterThan,
        formattedValue: "85%",
      }),
    ).toBe("High Node Memory - Utilization > 85%");
  });

  test("the comparison alone for a line with no name", () => {
    expect(
      getMetricChartThresholdLabel({
        name: "  ",
        filterType: FilterType.LessThanOrEqualTo,
        formattedValue: "10 GB",
      }),
    ).toBe("≤ 10 GB");
  });

  test("a forecast says so, whatever its name", () => {
    expect(
      getMetricChartThresholdLabel({
        name: "Disk full soon > 90%",
        filterType: FilterType.ForecastAbove,
        isForecast: true,
        formattedValue: "90%",
      }),
    ).toBe("Disk full soon > 90% (forecast > 90%)");
    expect(
      getMetricChartThresholdLabel({
        name: "",
        filterType: FilterType.ForecastBelow,
        isForecast: true,
        formattedValue: "5%",
      }),
    ).toBe("Forecast < 5%");
  });

  test("a long name is cut to fit beside its line", () => {
    const longName: string = "x".repeat(200);
    const label: string = getMetricChartThresholdLabel({
      name: longName,
      filterType: FilterType.GreaterThan,
      formattedValue: "1",
    });

    expect(shortenThresholdName(longName)).toHaveLength(
      METRIC_CHART_THRESHOLD_NAME_MAX_LENGTH,
    );
    expect(shortenThresholdName(longName).endsWith("…")).toBe(true);
    expect(label.startsWith(shortenThresholdName(longName))).toBe(true);
    expect(shortenThresholdName("Short")).toBe("Short");
  });

  test("any name keeps its label within bounds and never empty (seeded)", () => {
    for (const name of generatedTexts(2000, 6250, ["a", " ", "%", "9", "é", ">", "…"])) {
      const label: string = getMetricChartThresholdLabel({
        name,
        filterType: FilterType.GreaterThan,
        formattedValue: "9%",
      });

      expect(label.length).toBeGreaterThan(0);
      expect(label.length).toBeLessThanOrEqual(
        METRIC_CHART_THRESHOLD_NAME_MAX_LENGTH + " (> 9%)".length,
      );
    }
  });
});

describe("the lines one chart draws", () => {
  test("a threshold on the chart's own query: at its value, in its colour, shading where it alerts", () => {
    expect(linesOf({ thresholds: [THRESHOLD] })).toEqual([
      {
        value: 90,
        label: "High CPU (> 90%)",
        color: "#ef4444",
        strokeDasharray: undefined,
        extendsDomain: true,
        shade: "above",
      },
    ]);
  });

  test("thresholds on other queries or formulas are not this chart's", () => {
    expect(
      linesOf({
        thresholds: [{ ...THRESHOLD, metricVariable: "b" }],
      }),
    ).toEqual([]);
    expect(linesOf({ thresholds: [THRESHOLD], metricVariable: "" })).toEqual([]);
  });

  test("a value typed in another unit of the chart's family is drawn in the chart's", () => {
    const lines: Array<ChartReferenceLineProps> = linesOf({
      thresholds: [
        { ...THRESHOLD, value: 1, unit: "GB", name: "Memory", shade: "above" },
      ],
      unit: "MB",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]!.value).toBe(1000);
  });

  test("a unit of another family is left as typed, as the evaluator leaves it", () => {
    expect(
      linesOf({
        thresholds: [{ ...THRESHOLD, value: 85, unit: "%" }],
        unit: "ms",
      })[0]!.value,
    ).toBe(85);
  });

  test("a value the chart already draws a line at is not drawn twice", () => {
    expect(
      linesOf({ thresholds: [THRESHOLD], drawnValues: [80, 90] }),
    ).toEqual([]);
    expect(
      linesOf({
        thresholds: [THRESHOLD, { ...THRESHOLD, name: "Again" }],
      }),
    ).toHaveLength(1);
  });

  test("a forecast is dashed wider and shades nothing: the metric need not be past it", () => {
    const lines: Array<ChartReferenceLineProps> = linesOf({
      thresholds: [
        {
          ...THRESHOLD,
          filterType: FilterType.ForecastAbove,
          isForecast: true,
        },
      ],
    });

    expect(lines[0]!.strokeDasharray).toBe("8 4");
    expect(lines[0]!.shade).toBeUndefined();
  });

  test("a value that is no number draws nothing", () => {
    expect(
      linesOf({ thresholds: [{ ...THRESHOLD, value: Number.NaN }] }),
    ).toEqual([]);
    expect(
      buildMetricChartThresholdLines({
        thresholds: undefined,
        metricVariable: "a",
        unit: "",
      }),
    ).toEqual([]);
  });

  test("the value is written as the chart writes its values", () => {
    // A fraction metric is drawn 0-1 and written as a percentage.
    expect(
      linesOf({
        thresholds: [{ ...THRESHOLD, value: 0.95, name: "" }],
        unit: "1",
        metricName: "system.cpu.utilization",
      })[0]!.label,
    ).toBe("> 95%");
  });
});
