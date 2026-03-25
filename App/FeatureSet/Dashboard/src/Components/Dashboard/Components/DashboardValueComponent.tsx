import React, { FunctionComponent, ReactElement, useEffect } from "react";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricUtil from "../../Metrics/Utils/Metrics";
import API from "Common/UI/Utils/API/API";
import DashboardValueComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardValueComponent";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import JSONFunctions from "Common/Types/JSONFunctions";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardValueComponentType;
}

const DashboardValueComponentElement: FunctionComponent<ComponentProps> = (
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
        return;
      }

      if (
        !metricViewData.queryConfigs[0] ||
        !metricViewData.queryConfigs[0].metricQueryData.filterData ||
        !metricViewData.queryConfigs[0].metricQueryData.filterData
          ?.aggegationType
      ) {
        setIsLoading(false);
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

  const [metricQueryConfig, setMetricQueryConfig] = React.useState<
    MetricQueryConfigData | undefined
  >(props.component.arguments.metricQueryConfig);

  useEffect(() => {
    fetchAggregatedResults();
  }, [props.dashboardStartAndEndDate, props.metricTypes, props.refreshTick]);

  useEffect(() => {
    // set metricQueryConfig to the new value only if it is different from the previous value
    if (
      JSONFunctions.isJSONObjectDifferent(
        metricQueryConfig || {},
        props.component.arguments.metricQueryConfig || {},
      )
    ) {
      setMetricQueryConfig(props.component.arguments.metricQueryConfig);
      fetchAggregatedResults();
    }
  }, [props.component.arguments.metricQueryConfig]);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
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

  // round to 2 decimal places
  aggregatedValue = Math.round(aggregatedValue * 100) / 100;

  const valueHeightInPx: number = props.dashboardComponentHeightInPx * 0.4;
  const titleHeightInPx: number = props.dashboardComponentHeightInPx * 0.13;

  const unit: string | undefined =
    props.metricTypes?.find((item: MetricType) => {
      return (
        item.name?.toString() ===
        props.component.arguments.metricQueryConfig?.metricQueryData.filterData.metricName?.toString()
      );
    })?.unit || "";

  // Determine color based on thresholds
  let valueColorClass: string = "text-gray-900";
  let bgStyle: React.CSSProperties = {};
  let statusDotColor: string = "";
  const warningThreshold: number | undefined =
    props.component.arguments.warningThreshold;
  const criticalThreshold: number | undefined =
    props.component.arguments.criticalThreshold;

  if (
    criticalThreshold !== undefined &&
    aggregatedValue >= criticalThreshold
  ) {
    valueColorClass = "text-red-600";
    bgStyle = { background: "linear-gradient(135deg, rgba(254, 226, 226, 0.5) 0%, rgba(254, 202, 202, 0.3) 100%)" };
    statusDotColor = "bg-red-500";
  } else if (
    warningThreshold !== undefined &&
    aggregatedValue >= warningThreshold
  ) {
    valueColorClass = "text-amber-600";
    bgStyle = { background: "linear-gradient(135deg, rgba(254, 243, 199, 0.5) 0%, rgba(253, 230, 138, 0.3) 100%)" };
    statusDotColor = "bg-amber-500";
  }

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center rounded-md"
      style={bgStyle}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {statusDotColor && (
          <span className={`w-2 h-2 rounded-full ${statusDotColor} inline-block`}></span>
        )}
        <span
          style={{
            fontSize: titleHeightInPx > 0 ? `${Math.min(titleHeightInPx, 16)}px` : "13px",
          }}
          className="text-center font-medium text-gray-500 truncate uppercase tracking-wide"
        >
          {props.component.arguments.title || " "}
        </span>
      </div>
      <div
        className={`text-center font-bold truncate ${valueColorClass}`}
        style={{
          fontSize: valueHeightInPx > 0 ? `${valueHeightInPx}px` : "",
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
        }}
      >
        {aggregatedValue || "0"}
        <span
          className="text-gray-400 font-normal"
          style={{
            fontSize: valueHeightInPx > 0 ? `${valueHeightInPx * 0.35}px` : "",
          }}
        >
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
    </div>
  );
};

export default DashboardValueComponentElement;
