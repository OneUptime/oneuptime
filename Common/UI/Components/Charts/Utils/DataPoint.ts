/*
 * ChartDataPoint is in the format of:
 * {
 *     date: "Feb 22",
 *     SolarPanels: 2756,
 *     Inverters: 2103,
 * }
 */

import BadDataException from "../../../../Types/Exception/BadDataException";
import ChartDataPoint, {
  CHART_DATA_POINT_DATE_KEY,
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../ChartLibrary/Types/ChartDataPoint";
import SeriesPoints from "../Types/SeriesPoints";
import { XAxis, XAxisAggregateType } from "../Types/XAxis/XAxis";
import XAxisMaxMin from "../Types/XAxis/XAxisMaxMin";
import YAxis from "../Types/YAxis/YAxis";
import XAxisUtil from "./XAxis";

interface SeriesData {
  sum: number;
  count: number;
  max: number;
  min: number;
}

export default class DataPointUtil {
  public static getChartDataPoints(data: {
    seriesPoints: Array<SeriesPoints>;
    xAxis: XAxis;
    yAxis: YAxis;
  }): Array<ChartDataPoint> {
    const { intervals, formatter } = this.initializeXAxisData(data.xAxis);
    const arrayOfData: ChartDataPoint[] = this.initializeArrayOfData(
      intervals,
      formatter,
    );
    this.processSeriesData(
      data.seriesPoints,
      arrayOfData,
      formatter,
      data.xAxis.options.aggregateType,
    );
    return arrayOfData;
  }

  private static initializeXAxisData(xAxis: XAxis): {
    xAxisMax: XAxisMaxMin;
    xAxisMin: XAxisMaxMin;
    intervals: Array<Date>;
    formatter: (value: Date) => string;
  } {
    const xAxisMax: XAxisMaxMin = xAxis.options.max;
    const xAxisMin: XAxisMaxMin = xAxis.options.min;
    const intervals: Array<Date> = XAxisUtil.getPrecisionIntervals({
      xAxisMax,
      xAxisMin,
    });
    const formatter: (value: Date) => string = XAxisUtil.getFormatter({
      xAxisMax,
      xAxisMin,
    });
    return { xAxisMax, xAxisMin, intervals, formatter };
  }

  private static initializeArrayOfData(
    intervals: Array<Date>,
    formatter: (value: Date) => string,
  ): Array<ChartDataPoint> {
    const arrayOfData: Array<ChartDataPoint> = [];
    for (const interval of intervals) {
      const dataPoint: ChartDataPoint = {};
      /*
       * Always the canonical key, NEVER `xAxis.legend`. The wrappers hand
       * recharts this exact key as the XAxis dataKey, so keying rows off a
       * caller-supplied string meant one caller passing anything else
       * (the SLO dashboard widget passed "") produced rows recharts could
       * not read — every point landed on an undefined category and the
       * line silently vanished while the axes still drew.
       */
      dataPoint[CHART_DATA_POINT_X_AXIS_KEY] = formatter(interval);
      /*
       * The formatted label is not round-trippable back to a Date, so
       * keep the raw bucket start on the row — charts use it to recover
       * real dates (e.g. drag-to-select a time range).
       */
      dataPoint[CHART_DATA_POINT_DATE_KEY] = interval.getTime();
      arrayOfData.push(dataPoint);
    }
    return arrayOfData;
  }

  private static processSeriesData(
    seriesPoints: Array<SeriesPoints>,
    arrayOfData: Array<ChartDataPoint>,
    formatter: (value: Date) => string,
    aggregateType: XAxisAggregateType,
  ): { [key: string]: SeriesData } {
    /*
     * Accumulate per (series, bucket). The previous implementation kept
     * one SeriesData accumulator per series and reused it across every
     * bucket — every datapoint mutated the same `sum` / `count` / `max`
     * / `min`, so each subsequent bucket received the running total of
     * all prior buckets. On a Sum bar chart that produced a "reverse-
     * cumulative" staircase: the first bucket showed the dashboard's
     * grand total and later buckets decayed toward zero (e.g. 1039 →
     * 998 → 907 → … for an "Incidents Over Time" chart whose actual
     * per-day counts were 41 → 91 → 356 → …). Keying the accumulator
     * by (series, bucket) resets stats at every bucket boundary so each
     * bar reflects just its own datapoints.
     */
    const bucketStats: Map<string, SeriesData> = new Map();
    const bucketStatsByPoint: Map<
      ChartDataPoint,
      Map<string, SeriesData>
    > = new Map();

    for (const series of seriesPoints) {
      for (const dataPoint of series.data) {
        const date: Date = dataPoint.x;
        const value: number = dataPoint.y;
        const formattedDate: string = formatter(date);

        const target: ChartDataPoint | undefined = arrayOfData.find(
          (chartDataPoint: ChartDataPoint) => {
            return (
              chartDataPoint[CHART_DATA_POINT_X_AXIS_KEY] === formattedDate
            );
          },
        );
        if (!target) {
          continue;
        }

        // NUL-separated so a series name can never collide with a date label.
        const bucketKey: string = `${series.seriesName}\u0000${formattedDate}`;
        let stats: SeriesData | undefined = bucketStats.get(bucketKey);
        if (!stats) {
          stats = {
            sum: 0,
            count: 0,
            max: Number.NEGATIVE_INFINITY,
            min: Number.POSITIVE_INFINITY,
          };
          bucketStats.set(bucketKey, stats);
        }
        stats.sum += value;
        stats.count += 1;
        if (value > stats.max) {
          stats.max = value;
        }
        if (value < stats.min) {
          stats.min = value;
        }
        target[series.seriesName] = this.calculateAggregate(
          stats,
          aggregateType,
        );

        let perBucket: Map<string, SeriesData> | undefined =
          bucketStatsByPoint.get(target);
        if (!perBucket) {
          perBucket = new Map();
          bucketStatsByPoint.set(target, perBucket);
        }
        perBucket.set(series.seriesName, stats);
      }
    }

    /*
     * Preserve the legacy return shape (a flat map keyed by series
     * name). Callers in the tree currently discard it, but the public
     * signature is still exported, so keep the contract: surface the
     * stats of the last bucket each series wrote to.
     */
    const seriesDataMap: { [key: string]: SeriesData } = {};
    for (const series of seriesPoints) {
      for (const point of arrayOfData) {
        const perBucket: Map<string, SeriesData> | undefined =
          bucketStatsByPoint.get(point);
        const stats: SeriesData | undefined = perBucket?.get(series.seriesName);
        if (stats) {
          seriesDataMap[series.seriesName] = stats;
        }
      }
    }
    return seriesDataMap;
  }

  private static calculateAggregate(
    seriesData: SeriesData,
    aggregateType: XAxisAggregateType,
  ): number {
    switch (aggregateType) {
      case XAxisAggregateType.Average:
        return seriesData.sum / seriesData.count;
      case XAxisAggregateType.Sum:
        return seriesData.sum;
      case XAxisAggregateType.Max:
        return seriesData.max;
      case XAxisAggregateType.Min:
        return seriesData.min;
      default:
        throw new BadDataException("Aggregate type not supported.");
    }
  }
}
