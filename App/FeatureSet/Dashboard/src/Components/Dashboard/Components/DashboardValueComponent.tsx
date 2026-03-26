import React, { FunctionComponent, ReactElement, useEffect } from "react";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricUtil from "../../Metrics/Utils/Metrics";
import API from "Common/UI/Utils/API/API";
import DashboardValueComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardValueComponent";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardValueComponentType;
}

// Mini sparkline SVG component
interface SparklineProps {
  data: Array<number>;
  width: number;
  height: number;
  color: string;
  fillColor: string;
}

const Sparkline: FunctionComponent<SparklineProps> = (
  sparklineProps: SparklineProps,
): ReactElement => {
  if (sparklineProps.data.length < 2) {
    return <></>;
  }

  const dataPoints: Array<number> = sparklineProps.data;
  const minVal: number = Math.min(...dataPoints);
  const maxVal: number = Math.max(...dataPoints);
  const range: number = maxVal - minVal || 1;
  const padding: number = 2;

  const points: string = dataPoints
    .map((value: number, index: number) => {
      const x: number =
        padding +
        (index / (dataPoints.length - 1)) *
          (sparklineProps.width - padding * 2);
      const y: number =
        sparklineProps.height -
        padding -
        ((value - minVal) / range) * (sparklineProps.height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  // Create fill area path
  const firstX: number = padding;
  const lastX: number =
    padding +
    ((dataPoints.length - 1) / (dataPoints.length - 1)) *
      (sparklineProps.width - padding * 2);
  const fillPoints: string = `${firstX},${sparklineProps.height} ${points} ${lastX},${sparklineProps.height}`;

  return (
    <svg
      width={sparklineProps.width}
      height={sparklineProps.height}
      viewBox={`0 0 ${sparklineProps.width} ${sparklineProps.height}`}
      className="overflow-visible"
    >
      <polygon points={fillPoints} fill={sparklineProps.fillColor} />
      <polyline
        points={points}
        fill="none"
        stroke={sparklineProps.color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

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
    // Skeleton loading state
    return (
      <div className="w-full h-full flex flex-col items-center justify-center rounded-md animate-pulse">
        <div className="h-3 w-16 bg-gray-100 rounded mb-3"></div>
        <div className="h-8 w-24 bg-gray-100 rounded mb-2"></div>
        <div className="h-6 w-32 bg-gray-50 rounded mt-1"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-1.5">
        <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center">
          <div className="h-5 w-5 text-gray-300">
            <Icon icon={IconProp.ChartBar} />
          </div>
        </div>
        <p className="text-xs text-gray-400 text-center max-w-40">{error}</p>
      </div>
    );
  }

  // Show setup state if no metric configured
  if (
    !props.component.arguments.metricQueryConfig ||
    !props.component.arguments.metricQueryConfig.metricQueryData?.filterData ||
    Object.keys(
      props.component.arguments.metricQueryConfig.metricQueryData.filterData,
    ).length === 0
  ) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-1.5">
        <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center">
          <svg
            className="w-5 h-5 text-indigo-300"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
            />
          </svg>
        </div>
        <p className="text-xs font-medium text-gray-500">
          {props.component.arguments.title || "Value Widget"}
        </p>
        <p className="text-xs text-gray-400 text-center">
          Click to configure metric
        </p>
      </div>
    );
  }

  // Collect all data points for sparkline and aggregation
  const allDataPoints: Array<AggregatedModel> = [];
  for (const result of metricResults) {
    for (const item of result.data) {
      allDataPoints.push(item);
    }
  }

  let aggregatedValue: number = 0;
  let avgCount: number = 0;

  for (const item of allDataPoints) {
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

  if (aggregationType === AggregationType.Avg && avgCount > 0) {
    aggregatedValue = aggregatedValue / avgCount;
  }

  // round to 2 decimal places
  aggregatedValue = Math.round(aggregatedValue * 100) / 100;

  // Sparkline data - take raw values in order
  const sparklineData: Array<number> = allDataPoints.map(
    (item: AggregatedModel) => {
      return item.value;
    },
  );

  const valueHeightInPx: number = props.dashboardComponentHeightInPx * 0.35;
  const titleHeightInPx: number = props.dashboardComponentHeightInPx * 0.11;
  const showSparkline: boolean =
    sparklineData.length >= 2 && props.dashboardComponentHeightInPx > 100;

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
  let sparklineColor: string = "#6366f1"; // indigo
  let sparklineFill: string = "rgba(99, 102, 241, 0.08)";
  const warningThreshold: number | undefined =
    props.component.arguments.warningThreshold;
  const criticalThreshold: number | undefined =
    props.component.arguments.criticalThreshold;

  if (criticalThreshold !== undefined && aggregatedValue >= criticalThreshold) {
    valueColorClass = "text-red-600";
    bgStyle = {
      background:
        "linear-gradient(135deg, rgba(254, 226, 226, 0.4) 0%, rgba(254, 202, 202, 0.2) 100%)",
    };
    sparklineColor = "#ef4444";
    sparklineFill = "rgba(239, 68, 68, 0.08)";
  } else if (
    warningThreshold !== undefined &&
    aggregatedValue >= warningThreshold
  ) {
    valueColorClass = "text-amber-600";
    bgStyle = {
      background:
        "linear-gradient(135deg, rgba(254, 243, 199, 0.4) 0%, rgba(253, 230, 138, 0.2) 100%)",
    };
    sparklineColor = "#f59e0b";
    sparklineFill = "rgba(245, 158, 11, 0.08)";
  }

  // Calculate trend (compare first half avg to second half avg)
  let trendPercent: number | null = null;
  let trendDirection: "up" | "down" | "flat" = "flat";

  if (sparklineData.length >= 4) {
    const midpoint: number = Math.floor(sparklineData.length / 2);
    const firstHalf: Array<number> = sparklineData.slice(0, midpoint);
    const secondHalf: Array<number> = sparklineData.slice(midpoint);
    const firstAvg: number =
      firstHalf.reduce((a: number, b: number) => {
        return a + b;
      }, 0) / firstHalf.length;
    const secondAvg: number =
      secondHalf.reduce((a: number, b: number) => {
        return a + b;
      }, 0) / secondHalf.length;

    if (firstAvg !== 0) {
      trendPercent =
        Math.round(((secondAvg - firstAvg) / Math.abs(firstAvg)) * 1000) / 10;
      trendDirection =
        trendPercent > 0.5 ? "up" : trendPercent < -0.5 ? "down" : "flat";
    }
  }

  const sparklineWidth: number = Math.min(
    props.dashboardComponentWidthInPx * 0.6,
    120,
  );
  const sparklineHeight: number = Math.min(
    props.dashboardComponentHeightInPx * 0.18,
    30,
  );

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center rounded-md relative overflow-hidden"
      style={bgStyle}
    >
      {/* Title */}
      <div className="flex items-center gap-1.5 mb-0.5">
        <span
          style={{
            fontSize:
              titleHeightInPx > 0
                ? `${Math.max(Math.min(titleHeightInPx, 14), 11)}px`
                : "12px",
          }}
          className="text-center font-medium text-gray-400 truncate uppercase tracking-wider"
        >
          {props.component.arguments.title || " "}
        </span>
      </div>

      {/* Value */}
      <div
        className={`text-center font-bold truncate ${valueColorClass}`}
        style={{
          fontSize: valueHeightInPx > 0 ? `${valueHeightInPx}px` : "",
          lineHeight: 1.15,
          letterSpacing: "-0.03em",
        }}
      >
        {aggregatedValue || "0"}
        <span
          className="text-gray-400 font-normal"
          style={{
            fontSize: valueHeightInPx > 0 ? `${valueHeightInPx * 0.3}px` : "",
          }}
        >
          {unit ? ` ${unit}` : ""}
        </span>
      </div>

      {/* Trend indicator */}
      {trendPercent !== null && trendDirection !== "flat" && (
        <div
          className={`flex items-center gap-0.5 mt-0.5 ${
            trendDirection === "up" ? "text-emerald-500" : "text-red-500"
          }`}
          style={{
            fontSize: `${Math.max(Math.min(titleHeightInPx, 12), 10)}px`,
          }}
        >
          <span>{trendDirection === "up" ? "\u2191" : "\u2193"}</span>
          <span className="font-medium tabular-nums">
            {Math.abs(trendPercent)}%
          </span>
        </div>
      )}

      {/* Sparkline */}
      {showSparkline && (
        <div className="mt-1">
          <Sparkline
            data={sparklineData}
            width={sparklineWidth}
            height={sparklineHeight}
            color={sparklineColor}
            fillColor={sparklineFill}
          />
        </div>
      )}
    </div>
  );
};

export default DashboardValueComponentElement;
