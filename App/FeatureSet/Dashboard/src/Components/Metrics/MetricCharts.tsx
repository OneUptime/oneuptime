import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import OneUptimeDate from "Common/Types/Date";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import ChartGroup, {
  Chart,
  ChartMetricInfo,
  ChartType,
} from "Common/UI/Components/Charts/ChartGroup/ChartGroup";
import Dictionary from "Common/Types/Dictionary";
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
import ExemplarPoint from "Common/UI/Components/Charts/Types/ExemplarPoint";
import ValueFormatter from "Common/Utils/ValueFormatter";
import MetricUtil from "./Utils/Metrics";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";

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
  // Exemplar data keyed by metric name
  const [exemplarsByMetric, setExemplarsByMetric] = useState<
    Record<string, Array<ExemplarPoint>>
  >({});

  // Fetch exemplars for all queried metrics
  useEffect(() => {
    if (
      !props.metricViewData.startAndEndDate?.startValue ||
      !props.metricViewData.startAndEndDate?.endValue
    ) {
      return;
    }

    const startAndEndDate: InBetween<Date> = new InBetween<Date>(
      props.metricViewData.startAndEndDate.startValue as Date,
      props.metricViewData.startAndEndDate.endValue as Date,
    );

    for (const queryConfig of props.metricViewData.queryConfigs) {
      const metricName: string =
        queryConfig.metricQueryData.filterData.metricName?.toString() || "";
      if (!metricName) {
        continue;
      }

      MetricUtil.fetchExemplars({
        metricName,
        startAndEndDate,
      })
        .then((exemplars: Array<ExemplarPoint>) => {
          setExemplarsByMetric(
            (prev: Record<string, Array<ExemplarPoint>>) => {
              return {
                ...prev,
                [metricName]: exemplars,
              };
            },
          );
        })
        .catch(() => {
          // Best-effort: don't break charts if exemplar fetch fails
        });
    }
  }, [props.metricViewData.startAndEndDate, props.metricViewData.queryConfigs]);

  const handleExemplarClick: (exemplar: ExemplarPoint) => void = useCallback(
    (exemplar: ExemplarPoint): void => {
      const route: Route = RouteUtil.populateRouteParams(
        RouteMap[PageMap.TRACE_VIEW]!,
        {
          modelId: exemplar.traceId,
        },
      );

      if (exemplar.spanId) {
        const routeWithQuery: Route = new Route(route.toString());
        routeWithQuery.addQueryParams({ spanId: exemplar.spanId });
        Navigation.navigate(routeWithQuery);
      } else {
        Navigation.navigate(route);
      }
    },
    [],
  );

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

      // Build metric info for the info icon modal
      const metricAttributes: Dictionary<string> = {};
      const filterAttributes:
        | Dictionary<string | boolean | number>
        | undefined = queryConfig.metricQueryData.filterData.attributes as
        | Dictionary<string | boolean | number>
        | undefined;

      if (filterAttributes) {
        for (const key of Object.keys(filterAttributes)) {
          metricAttributes[key] = String(filterAttributes[key]);
        }
      }

      const metricInfo: ChartMetricInfo = {
        metricName:
          queryConfig.metricQueryData.filterData.metricName?.toString() || "",
        aggregationType:
          queryConfig.metricQueryData.filterData.aggegationType?.toString() ||
          "",
        attributes:
          Object.keys(metricAttributes).length > 0
            ? metricAttributes
            : undefined,
        groupByAttribute:
          queryConfig.metricQueryData.filterData.groupByAttribute?.toString(),
        unit,
      };

      // Get exemplar data for this metric
      const metricNameStr: string =
        queryConfig.metricQueryData.filterData.metricName?.toString() || "";
      const chartExemplars: Array<ExemplarPoint> =
        exemplarsByMetric[metricNameStr] || [];

      const chart: Chart = {
        id: index.toString(),
        type: chartType,
        title:
          queryConfig.metricAliasData?.title ||
          metricNameStr ||
          "",
        description: queryConfig.metricAliasData?.description || "",
        metricInfo,
        exemplarPoints:
          chartExemplars.length > 0 ? chartExemplars : undefined,
        onExemplarClick: handleExemplarClick,
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
