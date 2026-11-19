import SeriesPoint from "../Types/SeriesPoints";
import YAxis, { SecondYAxis } from "../Types/YAxis/YAxis";
import { ChartSecondYAxis } from "../ChartLibrary/Utils/SecondYAxis";
import { getYAxisWidthInPx } from "./YAxisWidth";

/*
 * A CHART'S VALUE AXES, AS THE LINE, AREA AND BAR CHARTS DRAW THEM.
 *
 * Every chart has its first value axis, on the left. A chart handed a second
 * axis (SecondYAxis, issue #10042) draws it on the right, for the series it
 * names, and each axis is as wide as the widest tick it draws over its own
 * series: a percent axis beside a bytes axis is not widened to "1.25 GB".
 *
 * The second axis keeps its room while it names any series, even one the
 * reader has hidden from the chart's legend, so hiding a line never moves
 * the plot: with nothing drawn against it, it writes no ticks.
 */

export interface ChartValueAxes {
  // The first axis's width, measured over the series drawn against it.
  firstYAxisWidthInPx: number;
  // The second axis as the chart library draws it; undefined for none.
  secondYAxis: ChartSecondYAxis | undefined;
}

export function getChartValueAxes(input: {
  data: Array<SeriesPoint>;
  yAxis: YAxis;
  secondYAxis?: SecondYAxis | undefined;
}): ChartValueAxes {
  const secondAxisSeriesNames: Set<string> = new Set<string>(
    input.secondYAxis?.seriesNames || [],
  );

  if (!input.secondYAxis || secondAxisSeriesNames.size === 0) {
    return {
      firstYAxisWidthInPx: getYAxisWidthInPx({
        data: input.data,
        formatter: input.yAxis.options.formatter,
        min: input.yAxis.options.min,
        max: input.yAxis.options.max,
      }),
      secondYAxis: undefined,
    };
  }

  const isOnSecondAxis: (series: SeriesPoint) => boolean = (
    series: SeriesPoint,
  ): boolean => {
    return secondAxisSeriesNames.has(series.seriesName);
  };
  const firstAxisData: Array<SeriesPoint> = input.data.filter(
    (series: SeriesPoint): boolean => {
      return !isOnSecondAxis(series);
    },
  );
  const secondAxisData: Array<SeriesPoint> = input.data.filter(isOnSecondAxis);
  const second: SecondYAxis = input.secondYAxis;

  return {
    firstYAxisWidthInPx: getYAxisWidthInPx({
      data: firstAxisData,
      formatter: input.yAxis.options.formatter,
      min: input.yAxis.options.min,
      max: input.yAxis.options.max,
    }),
    secondYAxis: {
      categories: secondAxisData.map((series: SeriesPoint): string => {
        return series.seriesName;
      }),
      valueFormatter: second.options.formatter,
      width: getYAxisWidthInPx({
        data: secondAxisData,
        formatter: second.options.formatter,
        min: second.options.min,
        max: second.options.max,
      }),
      autoMinValue: second.options.min === "auto",
      minValue:
        typeof second.options.min === "number" ? second.options.min : undefined,
      maxValue:
        typeof second.options.max === "number" ? second.options.max : undefined,
    },
  };
}
