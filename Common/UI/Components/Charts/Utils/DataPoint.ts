/// ChartDataPoint is in the format of:
// {
//     date: "Feb 22",
//     SolarPanels: 2756,
//     Inverters: 2103,
// }

import BadDataException from "../../../../Types/Exception/BadDataException";
import ChartDataPoint from "../ChartLibrary/Types/ChartDataPoint";
import SeriesPoints from "../Types/SeriesPoints";
import { XAxis, XAxisAggregateType } from "../Types/XAxis/XAxis";
import XAxisMaxMin from "../Types/XAxis/XAxisMaxMin";
import YAxis, { YAxisPrecision } from "../Types/YAxis/YAxis";
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
    const { xAxisLegend, intervals, formatter } = this.initializeXAxisData(
      data.xAxis,
    );
    const arrayOfData: ChartDataPoint[] = this.initializeArrayOfData(
      intervals,
      xAxisLegend,
      formatter,
    );
    const seriesDataMap: {
      [key: string]: SeriesData;
    } = this.processSeriesData(
      data.seriesPoints,
      arrayOfData,
      xAxisLegend,
      formatter,
      data.xAxis.options.aggregateType,
    );
    this.formatSeriesData(
      arrayOfData,
      seriesDataMap,
      data.yAxis.options.precision,
    );
    return arrayOfData;
  }

  private static initializeXAxisData(xAxis: XAxis): {
    xAxisMax: XAxisMaxMin;
    xAxisMin: XAxisMaxMin;
    xAxisLegend: string;
    intervals: Array<Date>;
    formatter: (value: Date) => string;
  } {
    const xAxisMax: XAxisMaxMin = xAxis.options.max;
    const xAxisMin: XAxisMaxMin = xAxis.options.min;
    const xAxisLegend: string = xAxis.legend;
    const intervals: Array<Date> = XAxisUtil.getPrecisionIntervals({
      xAxisMax,
      xAxisMin,
    });
    const formatter: (value: Date) => string = XAxisUtil.getFormatter({
      xAxisMax,
      xAxisMin,
    });
    return { xAxisMax, xAxisMin, xAxisLegend, intervals, formatter };
  }

  private static initializeArrayOfData(
    intervals: Array<Date>,
    xAxisLegend: string,
    formatter: (value: Date) => string,
  ): Array<ChartDataPoint> {
    const arrayOfData: Array<ChartDataPoint> = [];
    for (const interval of intervals) {
      const dataPoint: ChartDataPoint = {};
      dataPoint[xAxisLegend] = formatter(interval);
      arrayOfData.push(dataPoint);
    }
    return arrayOfData;
  }

  private static processSeriesData(
    seriesPoints: Array<SeriesPoints>,
    arrayOfData: Array<ChartDataPoint>,
    xAxisLegend: string,
    formatter: (value: Date) => string,
    aggregateType: XAxisAggregateType,
  ): { [key: string]: SeriesData } {
    const seriesDataMap: { [key: string]: SeriesData } = {};
    for (const series of seriesPoints) {
      for (const dataPoint of series.data) {
        const date: Date = dataPoint.x;
        const value: number = dataPoint.y;
        const formattedDate: string = formatter(date);
        for (const chartDataPoint of arrayOfData) {
          if (chartDataPoint[xAxisLegend] === formattedDate) {
            if (!seriesDataMap[series.seriesName]) {
              seriesDataMap[series.seriesName] = {
                sum: 0,
                count: 0,
                max: Number.NEGATIVE_INFINITY,
                min: Number.POSITIVE_INFINITY,
              };
            }
            seriesDataMap[series.seriesName]!.sum += value;
            seriesDataMap[series.seriesName]!.count += 1;
            seriesDataMap[series.seriesName]!.max = Math.max(
              seriesDataMap[series.seriesName]!.max,
              value,
            );
            seriesDataMap[series.seriesName]!.min = Math.min(
              seriesDataMap[series.seriesName]!.min,
              value,
            );
            chartDataPoint[series.seriesName] = this.calculateAggregate(
              seriesDataMap[series.seriesName]!,
              aggregateType,
            );
          }
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

  private static formatSeriesData(
    arrayOfData: Array<ChartDataPoint>,
    seriesDataMap: { [key: string]: SeriesData },
    yAxisPrecision: YAxisPrecision,
  ): void {
    for (const chartDataPoint of arrayOfData) {
      for (const seriesName in seriesDataMap) {
        if (
          chartDataPoint[seriesName] &&
          typeof chartDataPoint[seriesName] === "number"
        ) {
          chartDataPoint[seriesName] = this.formatValue(
            chartDataPoint[seriesName] as number,
            yAxisPrecision,
          );
        }
      }
    }
  }

  private static formatValue(
    value: number,
    yAxisPrecision: YAxisPrecision,
  ): number {
    switch (yAxisPrecision) {
      case YAxisPrecision.NoDecimals:
        return parseFloat(value.toFixed(0));
      case YAxisPrecision.OneDecimal:
        return parseFloat(value.toFixed(1));
      case YAxisPrecision.TwoDecimals:
        return parseFloat(value.toFixed(2));
      case YAxisPrecision.ThreeDecimals:
        return parseFloat(value.toFixed(3));
      default:
        throw new BadDataException("YAxis precision not supported.");
    }
  }
}
