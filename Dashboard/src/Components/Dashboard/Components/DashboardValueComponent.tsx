import React, { FunctionComponent, ReactElement, useEffect } from "react";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import { DashboardStartAndEndDateUtil } from "../Types/DashboardStartAndEndDate";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MetricViewData from "../../Metrics/Types/MetricViewData";
import MetricUtil from "../../Metrics/Utils/Metrics";
import API from "Common/UI/Utils/API/API";
import DashboardValueComponent from "Common/Types/Dashboard/DashboardComponents/DashboardValueComponent";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardValueComponent;
}

const DashboardValueComponent: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [metricResults, setMetricResults] = React.useState<
    Array<AggregatedResult>
  >([]);
  const [aggregationType, setAggregationType] = React.useState<AggregationType>(
    AggregationType.Avg,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  const metricViewData: MetricViewData = {
    queryConfigs: props.component.arguments.metricQueryConfig
      ? [props.component.arguments.metricQueryConfig]
      : [],
    startAndEndDate: DashboardStartAndEndDateUtil.getStartAndEndDate(
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
          "Please select an Aggregation Type. Click here to add a Aggregation Type.",
        );
        return;
      }
      setAggregationType(
        (metricViewData.queryConfigs[0].metricQueryData.filterData
          ?.aggegationType as AggregationType) || AggregationType.Avg,
      );

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
  }, [
    props.dashboardStartAndEndDate,
    props.component.arguments.metricQueryConfig,
    props.metricNameAndUnits,
  ]);

  useEffect(() => {
    fetchAggregatedResults();
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage error={error} />;
  }

  let heightOfText: number | undefined =
    (props.dashboardComponentHeightInPx || 0) - 100;

  if (heightOfText < 0) {
    heightOfText = undefined;
  }

  let aggregatedValue: number = 0;
  let avgCount: number = 0;

  for (const result of metricResults) {
    for (const item of result.data) {
      const value: number = item.value;

      if (aggregationType === AggregationType.Avg) {
        aggregatedValue += value;
        avgCount += 1;
      } else if (aggregationType === AggregationType.Sum) {
        aggregatedValue += value;
      } else if (aggregationType === AggregationType.Min) {
        aggregatedValue = Math.min(aggregatedValue, value);
      } else if (aggregationType === AggregationType.Max) {
        aggregatedValue = Math.max(aggregatedValue, value);
      } else if (aggregationType === AggregationType.Count) {
        aggregatedValue += 1;
      }
    }
  }

  if (aggregationType === AggregationType.Avg && avgCount > 0) {
    aggregatedValue = aggregatedValue / avgCount;
  }

  const valueHeightInPx: number = props.dashboardComponentHeightInPx * 0.40;
  const titleHeightInPx: number = props.dashboardComponentHeightInPx * 0.10;

  return (
    <div className="w-full text-center">
      <div 
        style={
          {
            fontSize: titleHeightInPx > 0 ? `${titleHeightInPx}px` : "",
          }
        }
      className="text-center text-sm text-semibold">
        {props.component.arguments.title || ""}
      </div>
      <div
        className="text-center text-lg text-semibold"
        style={{
          fontSize: valueHeightInPx > 0 ? `${valueHeightInPx}px` : "",
        }}
      >{aggregatedValue || "-"}</div>
    </div>
  );
};

export default DashboardValueComponent;
