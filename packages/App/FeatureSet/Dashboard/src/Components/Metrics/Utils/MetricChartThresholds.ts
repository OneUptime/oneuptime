import { FilterType } from "Common/Types/Monitor/CriteriaFilter";
import ChartReferenceLineProps from "Common/UI/Components/Charts/Types/ReferenceLineProps";
import {
  Translator,
  composedValue,
  translateTemplate,
} from "Common/UI/Utils/TranslateTemplate";
import MetricUnitUtil from "Common/Utils/MetricUnitUtil";
import ValueFormatter from "Common/Utils/ValueFormatter";

/*
 * Lines a page draws on its metric charts for values that are not the
 * charts' own (issues #5759 and #6250): a monitor's criteria thresholds, on
 * the chart of the query or formula each compares. Unlike a query's warning
 * and critical lines (buildThresholdReferenceLines), these are never part
 * of the queries: they are drawn for the page, are not saved, and do not
 * travel in a link.
 *
 * A line is named as its owner names it ("High CPU"), with the comparison
 * it makes when the name does not say it already, and drawn in the unit its
 * chart is drawn in. It stretches the value axis to be seen, and shades the
 * side of it that matches.
 */

export interface MetricChartThreshold {
  // The query's or formula's variable whose chart draws the line.
  metricVariable: string;
  value: number;
  // The unit `value` is written in, when it is not the chart's own.
  unit?: string | undefined;
  // What the line is, as its owner names it; "" for nothing.
  name: string;
  // The comparison the line stands for.
  filterType: FilterType;
  // Compares where the metric is headed, not the metric itself.
  isForecast?: boolean | undefined;
  color: string;
  // The side of the line that matches, shaded faintly.
  shade?: "above" | "below" | undefined;
}

// How long a name a line's label takes before it is cut.
export const METRIC_CHART_THRESHOLD_NAME_MAX_LENGTH: number = 48;

const COMPARISON_SYMBOLS: Partial<Record<FilterType, string>> = {
  [FilterType.GreaterThan]: ">",
  [FilterType.GreaterThanOrEqualTo]: "≥",
  [FilterType.LessThan]: "<",
  [FilterType.LessThanOrEqualTo]: "≤",
  [FilterType.EqualTo]: "=",
  [FilterType.NotEqualTo]: "≠",
  [FilterType.ForecastAbove]: ">",
  [FilterType.ForecastBelow]: "<",
};

export function getThresholdComparisonSymbol(filterType: FilterType): string {
  return COMPARISON_SYMBOLS[filterType] || "";
}

/*
 * A value as a person typed it: "85%", not the "85.00%" every percentage is
 * written with on an axis. A threshold is a number someone chose, and its
 * criteria's name says it that way ("Utilization > 85%").
 */
export function trimTrailingZeros(formatted: string): string {
  return formatted.replace(
    /(\d)\.(\d*?)0+(?!\d)/g,
    (_match: string, lead: string, kept: string): string => {
      return kept ? `${lead}.${kept}` : lead;
    },
  );
}

// A name cut to fit beside its line.
export function shortenThresholdName(name: string): string {
  const trimmed: string = (name || "").trim();

  if (trimmed.length <= METRIC_CHART_THRESHOLD_NAME_MAX_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, METRIC_CHART_THRESHOLD_NAME_MAX_LENGTH - 1).trimEnd()}…`;
}

/*
 * What a line says beside it: "High CPU (> 90%)", or the name alone when it
 * already says the value ("High Node Memory - Utilization > 85%"), or the
 * comparison alone for a line with no name. A forecast says so.
 */
export function getMetricChartThresholdLabel(input: {
  name: string;
  filterType: FilterType;
  isForecast?: boolean | undefined;
  // The value as the chart writes it ("85%", "512 MB").
  formattedValue: string;
}): string {
  const symbol: string = getThresholdComparisonSymbol(input.filterType);
  const comparison: string = symbol
    ? `${symbol} ${input.formattedValue}`
    : input.formattedValue;
  const name: string = shortenThresholdName(input.name);

  if (!name) {
    return input.isForecast
      ? translateTemplate("Forecast {{comparison}}", { comparison })
      : comparison;
  }

  if (!input.isForecast && name.includes(input.formattedValue)) {
    return name;
  }

  return translateTemplate("{{name}} ({{threshold}})", {
    name: name,
    // Worded by the same translator as the sentence it goes in.
    threshold: input.isForecast
      ? composedValue((translator: Translator): string => {
          return translator.translateTemplate("forecast {{comparison}}", {
            comparison,
          });
        })
      : comparison,
  });
}

/*
 * The lines one chart draws: the thresholds on its query or formula, in its
 * unit, leaving out a value it already draws a line at (its own warning or
 * critical line, which says the same).
 */
export function buildMetricChartThresholdLines(input: {
  thresholds: Array<MetricChartThreshold> | undefined;
  // The chart's query or formula.
  metricVariable: string | undefined;
  // The unit the chart draws its values in.
  unit: string;
  formatterOptions?: { metricName: string } | undefined;
  // Values the chart already draws a line at.
  drawnValues?: Array<number | undefined> | undefined;
}): Array<ChartReferenceLineProps> {
  if (!input.thresholds || input.thresholds.length === 0) {
    return [];
  }

  if (!input.metricVariable) {
    return [];
  }

  const drawnValues: Array<number> = (input.drawnValues || []).filter(
    (value: number | undefined): value is number => {
      return typeof value === "number" && Number.isFinite(value);
    },
  );

  const lines: Array<ChartReferenceLineProps> = [];

  for (const threshold of input.thresholds) {
    if (threshold.metricVariable !== input.metricVariable) {
      continue;
    }

    if (
      typeof threshold.value !== "number" ||
      !Number.isFinite(threshold.value)
    ) {
      continue;
    }

    // Typed in another unit of the chart's family: drawn in the chart's.
    const value: number = threshold.unit
      ? MetricUnitUtil.convertToMetricUnit({
          value: threshold.value,
          fromUnit: threshold.unit,
          metricUnit: input.unit,
        })
      : threshold.value;

    if (!Number.isFinite(value) || drawnValues.includes(value)) {
      continue;
    }

    drawnValues.push(value);

    lines.push({
      value: value,
      label: getMetricChartThresholdLabel({
        name: threshold.name,
        filterType: threshold.filterType,
        isForecast: threshold.isForecast,
        formattedValue: trimTrailingZeros(
          ValueFormatter.formatValue(value, input.unit, input.formatterOptions),
        ),
      }),
      color: threshold.color,
      // A forecast's line is where the trend must not go: dashed wider.
      strokeDasharray: threshold.isForecast ? "8 4" : undefined,
      // The value is what the reader came to see, whatever the data does.
      extendsDomain: true,
      ...(threshold.shade && !threshold.isForecast
        ? { shade: threshold.shade }
        : {}),
    });
  }

  return lines;
}
