import React, { FunctionComponent, ReactElement, useEffect } from "react";
import DashboardGaugeComponent from "Common/Types/Dashboard/DashboardComponents/DashboardGaugeComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricUtil from "../../Metrics/Utils/Metrics";
import API from "Common/UI/Utils/API/API";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardGaugeComponent;
}

const DashboardGaugeComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [metricResults, setMetricResults] = React.useState<
    Array<AggregatedResult>
  >([]);
  const [aggregationType, setAggregationType] =
    React.useState<AggregationType>(AggregationType.Avg);
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
    fetchAggregatedResults();
  }, []);

  useEffect(() => {
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

  // Calculate aggregated value
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

  aggregatedValue = Math.round(aggregatedValue * 100) / 100;

  const minValue: number = props.component.arguments.minValue ?? 0;
  const maxValue: number = props.component.arguments.maxValue ?? 100;
  const warningThreshold: number | undefined =
    props.component.arguments.warningThreshold;
  const criticalThreshold: number | undefined =
    props.component.arguments.criticalThreshold;

  // Calculate percentage for the gauge arc
  const range: number = maxValue - minValue;
  const percentage: number =
    range > 0
      ? Math.min(Math.max((aggregatedValue - minValue) / range, 0), 1)
      : 0;

  // Determine color based on thresholds
  let gaugeColor: string = "#10b981"; // green
  if (
    criticalThreshold !== undefined &&
    aggregatedValue >= criticalThreshold
  ) {
    gaugeColor = "#ef4444"; // red
  } else if (
    warningThreshold !== undefined &&
    aggregatedValue >= warningThreshold
  ) {
    gaugeColor = "#f59e0b"; // yellow
  }

  // SVG gauge rendering
  const size: number = Math.min(
    props.dashboardComponentWidthInPx - 20,
    props.dashboardComponentHeightInPx - 50,
  );
  const gaugeSize: number = Math.max(size, 60);
  const strokeWidth: number = Math.max(gaugeSize * 0.12, 8);
  const radius: number = (gaugeSize - strokeWidth) / 2;
  const centerX: number = gaugeSize / 2;
  const centerY: number = gaugeSize / 2;

  // Semi-circle arc (180 degrees, from left to right)
  const startAngle: number = Math.PI;
  const endAngle: number = 0;
  const sweepAngle: number = startAngle - endAngle;
  const currentAngle: number = startAngle - sweepAngle * percentage;

  const arcStartX: number = centerX + radius * Math.cos(startAngle);
  const arcStartY: number = centerY - radius * Math.sin(startAngle);
  const arcEndX: number = centerX + radius * Math.cos(endAngle);
  const arcEndY: number = centerY - radius * Math.sin(endAngle);
  const arcCurrentX: number = centerX + radius * Math.cos(currentAngle);
  const arcCurrentY: number = centerY - radius * Math.sin(currentAngle);

  const backgroundPath: string = `M ${arcStartX} ${arcStartY} A ${radius} ${radius} 0 0 1 ${arcEndX} ${arcEndY}`;
  const valuePath: string = `M ${arcStartX} ${arcStartY} A ${radius} ${radius} 0 ${percentage > 0.5 ? 1 : 0} 1 ${arcCurrentX} ${arcCurrentY}`;

  const titleHeightInPx: number = Math.max(
    props.dashboardComponentHeightInPx * 0.1,
    12,
  );
  const valueHeightInPx: number = Math.max(gaugeSize * 0.2, 14);

  return (
    <div className="w-full text-center h-full flex flex-col items-center justify-center">
      {props.component.arguments.gaugeTitle && (
        <div
          style={{
            fontSize: titleHeightInPx > 0 ? `${titleHeightInPx}px` : "",
          }}
          className="text-center font-semibold text-gray-700 mb-1 truncate"
        >
          {props.component.arguments.gaugeTitle}
        </div>
      )}
      <svg
        width={gaugeSize}
        height={gaugeSize / 2 + strokeWidth}
        viewBox={`0 0 ${gaugeSize} ${gaugeSize / 2 + strokeWidth}`}
      >
        <path
          d={backgroundPath}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {percentage > 0 && (
          <path
            d={valuePath}
            fill="none"
            stroke={gaugeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div
        className="font-bold text-gray-800"
        style={{
          fontSize: valueHeightInPx > 0 ? `${valueHeightInPx}px` : "",
          marginTop: `-${gaugeSize * 0.15}px`,
        }}
      >
        {aggregatedValue}
      </div>
    </div>
  );
};

export default DashboardGaugeComponentElement;
