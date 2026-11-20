import SeriesPoint from "../Types/SeriesPoints";
import YAxis, { OwnScaleYAxis, SecondYAxis } from "../Types/YAxis/YAxis";
import {
  ChartOwnScale,
  ChartSecondYAxis,
} from "../ChartLibrary/Utils/SecondYAxis";
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
 *
 * A chart handed scales of their own (OwnScaleYAxis, issue #10080) draws each
 * one's series to it, with no axis: neither axis is measured over them, and
 * neither takes them in. A scale is kept while it names any series, shown or
 * not, so the lines and exemplars of a hidden series are never drawn against
 * an axis they do not belong to.
 */

export interface ChartValueAxes {
  // The first axis's width, measured over the series drawn against it.
  firstYAxisWidthInPx: number;
  // The second axis as the chart library draws it; undefined for none.
  secondYAxis: ChartSecondYAxis | undefined;
  // The scales of their own as the chart library draws them; none, empty.
  ownScales: Array<ChartOwnScale>;
}

export function getChartValueAxes(input: {
  data: Array<SeriesPoint>;
  yAxis: YAxis;
  secondYAxis?: SecondYAxis | undefined;
  ownScaleYAxes?: Array<OwnScaleYAxis> | undefined;
}): ChartValueAxes {
  const ownScaleYAxes: Array<OwnScaleYAxis> = (
    input.ownScaleYAxes || []
  ).filter((scale: OwnScaleYAxis): boolean => {
    return scale.seriesNames.length > 0;
  });
  const ownScaleSeriesNames: Set<string> = new Set<string>(
    ownScaleYAxes.flatMap((scale: OwnScaleYAxis): Array<string> => {
      return scale.seriesNames;
    }),
  );
  const secondAxisSeriesNames: Set<string> = new Set<string>(
    (input.secondYAxis?.seriesNames || []).filter((name: string): boolean => {
      return !ownScaleSeriesNames.has(name);
    }),
  );
  const isOnOwnScale: (series: SeriesPoint) => boolean = (
    series: SeriesPoint,
  ): boolean => {
    return ownScaleSeriesNames.has(series.seriesName);
  };
  const ownScales: Array<ChartOwnScale> = ownScaleYAxes.map(
    (scale: OwnScaleYAxis): ChartOwnScale => {
      const names: Set<string> = new Set<string>(scale.seriesNames);

      return {
        id: scale.id,
        categories: input.data
          .filter((series: SeriesPoint): boolean => {
            return names.has(series.seriesName);
          })
          .map((series: SeriesPoint): string => {
            return series.seriesName;
          }),
        valueFormatter: scale.options.formatter,
        autoMinValue: scale.options.min === "auto",
        minValue:
          typeof scale.options.min === "number" ? scale.options.min : undefined,
        maxValue:
          typeof scale.options.max === "number" ? scale.options.max : undefined,
      };
    },
  );

  if (!input.secondYAxis || secondAxisSeriesNames.size === 0) {
    return {
      firstYAxisWidthInPx: getYAxisWidthInPx({
        data: input.data.filter((series: SeriesPoint): boolean => {
          return !isOnOwnScale(series);
        }),
        formatter: input.yAxis.options.formatter,
        min: input.yAxis.options.min,
        max: input.yAxis.options.max,
      }),
      secondYAxis: undefined,
      ownScales: ownScales,
    };
  }

  const isOnSecondAxis: (series: SeriesPoint) => boolean = (
    series: SeriesPoint,
  ): boolean => {
    return secondAxisSeriesNames.has(series.seriesName);
  };
  const firstAxisData: Array<SeriesPoint> = input.data.filter(
    (series: SeriesPoint): boolean => {
      return !isOnSecondAxis(series) && !isOnOwnScale(series);
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
      durationUnitInSeconds: second.options.durationUnitInSeconds,
    },
    ownScales: ownScales,
  };
}
