import React, { FunctionComponent, ReactElement } from "react";
import OneUptimeDate from "Common/Types/Date";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import ChartGroup, {
  Chart,
  ChartType,
} from "Common/UI/Components/Charts/ChartGroup/ChartGroup";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import { XAxisAggregateType } from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import {
  ChartSeries,
  MetricChartType,
} from "Common/Types/Metrics/MetricQueryConfigData";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import { YAxisPrecision } from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import ChartReferenceLineProps from "Common/UI/Components/Charts/Types/ReferenceLineProps";
import ValueFormatter from "Common/Utils/ValueFormatter";

export interface ComponentProps {
  metricViewData: MetricViewData;
  metricResults: Array<AggregatedResult>;
  metricTypes: Array<MetricType>;
  hideCard?: boolean | undefined;
  heightInPx?: number | undefined;
  chartCssClass?: string | undefined;
}

const MetricCharts: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type GetChartXAxisTypeFunction = () => XAxisType;

  const getChartXAxisType: GetChartXAxisTypeFunction = (): XAxisType => {
    if (
      props.metricViewData.startAndEndDate?.startValue &&
      props.metricViewData.startAndEndDate?.endValue
    ) {
      const hourDifference: number = OneUptimeDate.getHoursBetweenTwoDates(
        props.metricViewData.startAndEndDate.startValue as Date,
        props.metricViewData.startAndEndDate.endValue as Date,
      );

      if (hourDifference <= 24) {
        return XAxisType.Time;
      }
    }

    return XAxisType.Date;
  };

  type GetChartsFunction = () => Array<Chart>;

  const getCharts: GetChartsFunction = (): Array<Chart> => {
    const charts: Array<Chart> = [];

    let index: number = 0;

    if (!props.metricResults) {
      return [];
    }

    for (const queryConfig of props.metricViewData.queryConfigs) {
      if (!props.metricResults[index]) {
        continue;
      }

      let xAxisAggregationType: XAxisAggregateType = XAxisAggregateType.Average;

      if (
        queryConfig.metricQueryData.filterData.aggegationType ===
        MetricsAggregationType.Sum
      ) {
        xAxisAggregationType = XAxisAggregateType.Sum;
      }

      if (
        queryConfig.metricQueryData.filterData.aggegationType ===
        MetricsAggregationType.Count
      ) {
        xAxisAggregationType = XAxisAggregateType.Sum;
      }

      if (
        queryConfig.metricQueryData.filterData.aggegationType ===
        MetricsAggregationType.Max
      ) {
        xAxisAggregationType = XAxisAggregateType.Max;
      }

      if (
        queryConfig.metricQueryData.filterData.aggegationType ===
        MetricsAggregationType.Min
      ) {
        xAxisAggregationType = XAxisAggregateType.Min;
      }

      if (
        queryConfig.metricQueryData.filterData.aggegationType ===
        MetricsAggregationType.Avg
      ) {
        xAxisAggregationType = XAxisAggregateType.Average;
      }

      const chartSeries: Array<SeriesPoint> = [];

      if (queryConfig.getSeries) {
        for (const item of props.metricResults[index]!.data) {
          const series: ChartSeries = queryConfig.getSeries(item);
          const seriesName: string = series.title;

          const existingSeries: SeriesPoint | undefined = chartSeries.find(
            (s: SeriesPoint) => {
              return s.seriesName === seriesName;
            },
          );

          if (existingSeries) {
            existingSeries.data.push({
              x: OneUptimeDate.fromString(item.timestamp),
              y: item.value,
            });
          } else {
            const newSeries: SeriesPoint = {
              seriesName: seriesName,
              data: [
                {
                  x: OneUptimeDate.fromString(item.timestamp),
                  y: item.value,
                },
              ],
            };

            chartSeries.push(newSeries);
          }
        }
      } else {
        chartSeries.push({
          seriesName:
            queryConfig.metricAliasData?.legend ||
            queryConfig.metricQueryData.filterData.metricName?.toString() ||
            "",
          data: props.metricResults[index]!.data.map(
            (result: AggregatedModel) => {
              return {
                x: OneUptimeDate.fromString(result.timestamp),
                y: result.value,
              };
            },
          ),
        });
      }

      let chartType: ChartType;
      if (queryConfig.chartType === MetricChartType.BAR) {
        chartType = ChartType.BAR;
      } else if (queryConfig.chartType === MetricChartType.AREA) {
        chartType = ChartType.AREA;
      } else if (queryConfig.chartType === MetricChartType.LINE) {
        chartType = ChartType.LINE;
      } else {
        chartType = ChartType.AREA;
      }

      // Resolve the unit for formatting
      const metricType: MetricType | undefined = props.metricTypes.find(
        (m: MetricType) => {
          return m.name === queryConfig.metricQueryData.filterData.metricName;
        },
      );
      const unit: string =
        queryConfig.metricAliasData?.legendUnit || metricType?.unit || "";

      // Build reference lines from thresholds
      const referenceLines: Array<ChartReferenceLineProps> = [];

      if (
        queryConfig.warningThreshold !== undefined &&
        queryConfig.warningThreshold !== null
      ) {
        referenceLines.push({
          value: queryConfig.warningThreshold,
          label: `Warning: ${ValueFormatter.formatValue(queryConfig.warningThreshold, unit)}`,
          color: "#f59e0b", // amber
        });
      }

      if (
        queryConfig.criticalThreshold !== undefined &&
        queryConfig.criticalThreshold !== null
      ) {
        referenceLines.push({
          value: queryConfig.criticalThreshold,
          label: `Critical: ${ValueFormatter.formatValue(queryConfig.criticalThreshold, unit)}`,
          color: "#ef4444", // red
        });
      }

      const chart: Chart = {
        id: index.toString(),
        type: chartType,
        title:
          queryConfig.metricAliasData?.title ||
          queryConfig.metricQueryData.filterData.metricName?.toString() ||
          "",
        description: queryConfig.metricAliasData?.description || "",
        props: {
          data: chartSeries,
          xAxis: {
            legend: "Time",
            options: {
              type: getChartXAxisType(),
              max:
                props.metricViewData.startAndEndDate?.endValue ||
                OneUptimeDate.getCurrentDate(),
              min:
                props.metricViewData.startAndEndDate?.startValue ||
                OneUptimeDate.addRemoveHours(
                  OneUptimeDate.getCurrentDate(),
                  -1,
                ),
              aggregateType: xAxisAggregationType,
            },
          },
          yAxis: {
            legend: unit,
            options: {
              type: YAxisType.Number,
              formatter: (value: number) => {
                if (queryConfig.yAxisValueFormatter) {
                  return queryConfig.yAxisValueFormatter(value);
                }

                return ValueFormatter.formatValue(value, unit);
              },
              precision: YAxisPrecision.NoDecimals,
              max: "auto",
              min: "auto",
            },
          },
          curve: ChartCurve.MONOTONE,
          sync: true,
          referenceLines:
            referenceLines.length > 0 ? referenceLines : undefined,
        },
      };

      charts.push(chart);

      index++;
    }

    return charts;
  };

  return (
    <ChartGroup
      charts={getCharts()}
      hideCard={props.hideCard}
      heightInPx={props.heightInPx}
      chartCssClass={props.chartCssClass}
    />
  );
};

export default MetricCharts;
