

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



export default class DataPointUtil {
    public static getChartDataPoints(data: {
        seriesPoints: Array<SeriesPoints>;
        xAxis: XAxis;
        yAxis: YAxis;
    }): Array<ChartDataPoint> {

        const xAxisMax: XAxisMaxMin = data.xAxis.options.max;
        const xAxisMin: XAxisMaxMin = data.xAxis.options.min;

        const xAxisLegend: string = data.xAxis.legend;

        const intervals: Array<Date> = XAxisUtil.getPrecisionIntervals({
            xAxisMax: xAxisMax,
            xAxisMin: xAxisMin
        });

        const formatter: (value: Date) => string = XAxisUtil.getFormatter({
            xAxisMax: xAxisMax,
            xAxisMin: xAxisMin
        });

        const arrayOfData: Array<ChartDataPoint> = [];

        // format all the intervals. 
        for (const interval of intervals) {
            const dataPoint: ChartDataPoint = {};
            dataPoint[xAxisLegend] = formatter(interval);
            arrayOfData.push(dataPoint);
        }

        interface SeriesData {
            sum: number;
            count: number;
            max: number;
            min: number;
        }

        // Initialize a new data structure to store sum, count, max, and min for each series
        const seriesDataMap: { [key: string]: SeriesData } = {};

        // now we need to add the data points.
        for (const series of data.seriesPoints) {
            for (const dataPoint of series.data) {
                const date: Date = dataPoint.x;
                const value: number = dataPoint.y;
                const formattedDate: string = formatter(date);

                for (const chartDataPoint of arrayOfData) {
                    if (chartDataPoint[xAxisLegend] === formattedDate) {
                        // Initialize series data if it doesn't exist
                        if (!seriesDataMap[series.seriesName]) {
                            seriesDataMap[series.seriesName] = { sum: 0, count: 0, max: Number.NEGATIVE_INFINITY, min: Number.POSITIVE_INFINITY };
                        }

                        // Update sum, count, max, and min
                        seriesDataMap[series.seriesName]!.sum += value;
                        seriesDataMap[series.seriesName]!.count += 1;
                        seriesDataMap[series.seriesName]!.max = Math.max(seriesDataMap[series.seriesName]!.max, value);
                        seriesDataMap[series.seriesName]!.min = Math.min(seriesDataMap[series.seriesName]!.min, value);

                        // Calculate the average, sum, max, or min based on the aggregate type
                        if (data.xAxis.options.aggregateType === XAxisAggregateType.Average) {
                            chartDataPoint[series.seriesName] = seriesDataMap[series.seriesName]!.sum / seriesDataMap[series.seriesName]!.count;
                        } else if (data.xAxis.options.aggregateType === XAxisAggregateType.Sum) {
                            chartDataPoint[series.seriesName] = seriesDataMap[series.seriesName]!.sum;
                        } else if (data.xAxis.options.aggregateType === XAxisAggregateType.Max) {
                            chartDataPoint[series.seriesName] = seriesDataMap[series.seriesName]!.max;
                        } else if (data.xAxis.options.aggregateType === XAxisAggregateType.Min) {
                            chartDataPoint[series.seriesName] = seriesDataMap[series.seriesName]!.min;
                        } else {
                            throw new BadDataException("Aggregate type not supported.");
                        }

                        if (chartDataPoint[series.seriesName] && typeof chartDataPoint[series.seriesName] === "number") {

                            // Format the series data based on yAxis precision
                            const yAxisPrecision = data.yAxis.options.precision;
                            switch (yAxisPrecision) {
                                case YAxisPrecision.NoDecimals:
                                    chartDataPoint[series.seriesName] = parseFloat((chartDataPoint[series.seriesName]! as number).toFixed(0));
                                    break;
                                case YAxisPrecision.OneDecimal:
                                    chartDataPoint[series.seriesName] = parseFloat(((chartDataPoint[series.seriesName]! as number).toFixed(1)));
                                    break;
                                case YAxisPrecision.TwoDecimals:
                                    chartDataPoint[series.seriesName] = parseFloat(((chartDataPoint[series.seriesName]! as number).toFixed(2)));
                                    break;
                                case YAxisPrecision.ThreeDecimals:
                                    chartDataPoint[series.seriesName] = parseFloat(((chartDataPoint[series.seriesName]! as number).toFixed(3)))
                                    break;
                                default:
                                    throw new BadDataException("YAxis precision not supported.");
                            }
                        }
                    }
                }
            }
        }

        return arrayOfData;

    }
}