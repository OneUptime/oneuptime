import React, { FunctionComponent, ReactElement, useEffect } from "react";
import DashboardChartComponent from "Common/Types/Dashboard/DashboardComponents/DashboardChartComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import MetricCharts from "../../Metrics/MetricCharts";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricUtil from "../../Metrics/Utils/Metrics";
import API from "Common/UI/Utils/API/API";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricQueryConfigData, {
  MetricChartType,
} from "Common/Types/Metrics/MetricQueryConfigData";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import DashboardChartType from "Common/Types/Dashboard/Chart/ChartType";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardChartComponent;
}

const DashboardChartComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [metricResults, setMetricResults] = React.useState<
    Array<AggregatedResult>
  >([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  // Resolve query configs - support both single and multi-query
  const resolveQueryConfigs: () => Array<MetricQueryConfigData> = () => {
    if (
      props.component.arguments.metricQueryConfigs &&
      props.component.arguments.metricQueryConfigs.length > 0
    ) {
      return props.component.arguments.metricQueryConfigs;
    }
    if (props.component.arguments.metricQueryConfig) {
      return [props.component.arguments.metricQueryConfig];
    }
    return [];
  };

  const queryConfigs: Array<MetricQueryConfigData> = resolveQueryConfigs();

  const metricViewData: MetricViewData = {
    queryConfigs: queryConfigs,
    startAndEndDate: RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.dashboardStartAndEndDate,
    ),
    formulaConfigs: [],
  };

  const fetchAggregatedResults: PromiseVoidFunction =
    async (): Promise<void> => {
      setIsLoading(true);

      if (
        !metricViewData.startAndEndDate?.startValue ||
        !metricViewData.startAndEndDate?.endValue
      ) {
        setIsLoading(false);
        setError("Please select a valid start and end date.");
        return;
      }

      if (
        !metricViewData.queryConfigs ||
        metricViewData.queryConfigs.length === 0 ||
        !metricViewData.queryConfigs[0] ||
        !metricViewData.queryConfigs[0].metricQueryData ||
        !metricViewData.queryConfigs[0].metricQueryData.filterData ||
        Object.keys(metricViewData.queryConfigs[0].metricQueryData.filterData)
          .length === 0
      ) {
        setIsLoading(false);
        setError("Please select a metric. Click here to add a metric.");
        return;
      }

      if (
        !metricViewData.queryConfigs[0] ||
        !metricViewData.queryConfigs[0].metricQueryData.filterData ||
        !metricViewData.queryConfigs[0].metricQueryData.filterData
          ?.aggegationType
      ) {
        setIsLoading(false);
        setError(
          "Please select a aggregation. Click here to add a aggregation.",
        );
        return;
      }

      try {
        const results: Array<AggregatedResult> = await MetricUtil.fetchResults({
          metricViewData: metricViewData,
        });

        setMetricResults(results);
        setError("");
      } catch (err: unknown) {
        setError(API.getFriendlyErrorMessage(err as Error));
      }

      setIsLoading(false);
    };

  useEffect(() => {
    fetchAggregatedResults();
  }, [props.dashboardStartAndEndDate, props.metricTypes, props.refreshTick]);

  const [prevQueryConfigs, setPrevQueryConfigs] = React.useState<
    Array<MetricQueryConfigData> | MetricQueryConfigData | undefined
  >(
    props.component.arguments.metricQueryConfigs ||
      props.component.arguments.metricQueryConfig,
  );

  useEffect(() => {
    const currentConfigs:
      | Array<MetricQueryConfigData>
      | MetricQueryConfigData
      | undefined =
      props.component.arguments.metricQueryConfigs ||
      props.component.arguments.metricQueryConfig;

    if (
      JSONFunctions.isJSONObjectDifferent(
        prevQueryConfigs || {},
        currentConfigs || {},
      )
    ) {
      setPrevQueryConfigs(currentConfigs);
      fetchAggregatedResults();
    }
  }, [
    props.component.arguments.metricQueryConfig,
    props.component.arguments.metricQueryConfigs,
  ]);

  if (isLoading) {
    // Skeleton loading for chart
    return (
      <div className="w-full h-full flex flex-col p-1 animate-pulse">
        <div className="h-3 w-28 bg-gray-100 rounded mb-3"></div>
        <div className="flex-1 flex items-end gap-1 px-2 pb-2">
          {Array.from({ length: 12 }).map((_: unknown, i: number) => {
            return (
              <div
                key={i}
                className="flex-1 bg-gray-100 rounded-t"
                style={{
                  height: `${20 + Math.random() * 60}%`,
                  opacity: 0.4 + Math.random() * 0.4,
                }}
              ></div>
            );
          })}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2">
        <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center">
          <div className="h-5 w-5 text-gray-300">
            <Icon icon={IconProp.ChartBar} />
          </div>
        </div>
        <p className="text-xs text-gray-400 text-center max-w-48">{error}</p>
      </div>
    );
  }

  let heightOfChart: number | undefined =
    (props.dashboardComponentHeightInPx || 0) - 100;

  if (heightOfChart < 0) {
    heightOfChart = undefined;
  }

  type GetMetricChartType = () => MetricChartType;

  const getMetricChartType: GetMetricChartType = (): MetricChartType => {
    if (props.component.arguments.chartType === DashboardChartType.Bar) {
      return MetricChartType.BAR;
    }
    if (
      props.component.arguments.chartType === DashboardChartType.Area ||
      props.component.arguments.chartType === DashboardChartType.StackedArea
    ) {
      return MetricChartType.AREA;
    }
    return MetricChartType.LINE;
  };

  const chartMetricViewData: MetricViewData = {
    queryConfigs: queryConfigs.map(
      (config: MetricQueryConfigData, index: number) => {
        // For the first query, apply the chart-level title/description/legend
        if (index === 0) {
          return {
            ...config,
            metricAliasData: {
              title:
                config.metricAliasData?.title ||
                props.component.arguments.chartTitle ||
                undefined,
              description:
                config.metricAliasData?.description ||
                props.component.arguments.chartDescription ||
                undefined,
              metricVariable:
                config.metricAliasData?.metricVariable || undefined,
              legend:
                config.metricAliasData?.legend ||
                props.component.arguments.legendText ||
                undefined,
              legendUnit:
                config.metricAliasData?.legendUnit ||
                props.component.arguments.legendUnit ||
                undefined,
            },
            chartType: config.chartType || getMetricChartType(),
          };
        }
        return {
          ...config,
          chartType: config.chartType || getMetricChartType(),
        };
      },
    ),
    startAndEndDate: RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.dashboardStartAndEndDate,
    ),
    formulaConfigs: [],
  };

  return (
    <div className="w-full h-full overflow-hidden">
      <MetricCharts
        metricResults={metricResults}
        metricTypes={props.metricTypes}
        metricViewData={chartMetricViewData}
        hideCard={true}
        heightInPx={heightOfChart}
      />
    </div>
  );
};

export default DashboardChartComponentElement;
