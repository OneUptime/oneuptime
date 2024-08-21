

/// ChartDataPoint is in the format of: 
// {
//     date: "Feb 22",
//     SolarPanels: 2756,
//     Inverters: 2103,
// }

import ChartDataPoint from "../ChartLibrary/Types/ChartDataPoint";
import SeriesPoints from "../Types/SeriesPoints";
import { XAxis } from "../Types/XAxis/XAxis";
import XAxisMaxMin from "../Types/XAxis/XAxisMaxMin";
import XAxisUtil from "./XAxis";



export default class DataPointUtil { 
    public static getChartDataPoints(data: {
        seriesPoints: Array<SeriesPoints>;
        xAxis: XAxis
    }): Array<ChartDataPoint> {

        const xAxisMax:XAxisMaxMin = data.xAxis.options.max;
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

        // now we need to add the data points.
        for(const series of data.seriesPoints) {
            for(const dataPoint of series.data) {
                const date: Date = dataPoint.x;
                const value: number = dataPoint.y;
                const formattedDate: string = formatter(date);

                for(const chartDataPoint of arrayOfData) {
                    if(chartDataPoint[xAxisLegend] === formattedDate) {
                        // if the series exists, sum the value.

                        if(chartDataPoint[series.seriesName]) {
                            (chartDataPoint[series.seriesName] as number) += value;
                        }

                        chartDataPoint[series.seriesName] = value;
                    }
                }
            }
        }

        return arrayOfData;

    }
}