import React, { FunctionComponent, ReactElement, useEffect } from "react";
import DashboardChartComponent from "Common/Types/Dashboard/DashboardComponents/DashboardChartComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import MetricCharts from "../../Metrics/MetricCharts";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricUtil from "../../Metrics/Utils/Metrics";
import API from "Common/UI/Utils/API/API";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
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

  useEffect(() => {
    fetchAggregatedResults();
  }, []);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return (
      <div className="m-auto flex flex-col justify-center w-full h-full">
        <div className="h-7 w-7 text-gray-400 w-full text-center mx-auto">
          <Icon icon={IconProp.ChartBar} />
        </div>
        <ErrorMessage message={error} />
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
    <div>
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
