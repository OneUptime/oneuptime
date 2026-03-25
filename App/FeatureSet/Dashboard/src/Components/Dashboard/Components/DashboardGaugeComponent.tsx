import React, { FunctionComponent, ReactElement, useEffect } from "react";
import DashboardGaugeComponent from "Common/Types/Dashboard/DashboardComponents/DashboardGaugeComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricUtil from "../../Metrics/Utils/Metrics";
import API from "Common/UI/Utils/API/API";
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
    // Skeleton loading for gauge
    return (
      <div className="w-full h-full flex flex-col items-center justify-center animate-pulse">
        <div className="h-3 w-20 bg-gray-100 rounded mb-3"></div>
        <div
          className="bg-gray-100 rounded-full"
          style={{
            width: `${Math.min(props.dashboardComponentWidthInPx * 0.5, 120)}px`,
            height: `${Math.min(props.dashboardComponentWidthInPx * 0.25, 60)}px`,
            borderRadius: "999px 999px 0 0",
          }}
        ></div>
        <div className="h-5 w-12 bg-gray-100 rounded mt-2"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-1.5">
        <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center">
          <svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z" />
          </svg>
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
        <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
          <svg className="w-5 h-5 text-emerald-300" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z" />
          </svg>
        </div>
        <p className="text-xs font-medium text-gray-500">
          {props.component.arguments.gaugeTitle || "Gauge Widget"}
        </p>
        <p className="text-xs text-gray-400 text-center">
          Click to configure metric
        </p>
      </div>
    );
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
    props.dashboardComponentWidthInPx - 40,
    props.dashboardComponentHeightInPx - 60,
  );
  const gaugeSize: number = Math.max(size, 80);
  const strokeWidth: number = Math.max(gaugeSize * 0.1, 8);
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

  const titleHeightInPx: number = Math.min(
    Math.max(props.dashboardComponentHeightInPx * 0.1, 12),
    16,
  );
  const valueHeightInPx: number = Math.max(gaugeSize * 0.22, 16);

  // Generate a unique gradient ID for this component instance
  const gradientId: string = `gauge-gradient-${props.componentId?.toString() || "default"}`;

  // Threshold marker positions on arc
  type ThresholdMarker = {
    angle: number;
    x: number;
    y: number;
    color: string;
  };

  const thresholdMarkers: Array<ThresholdMarker> = [];

  if (warningThreshold !== undefined && range > 0) {
    const warningPct: number = Math.min(
      Math.max((warningThreshold - minValue) / range, 0),
      1,
    );
    const warningAngle: number = startAngle - sweepAngle * warningPct;
    thresholdMarkers.push({
      angle: warningAngle,
      x: centerX + (radius + strokeWidth * 0.7) * Math.cos(warningAngle),
      y: centerY - (radius + strokeWidth * 0.7) * Math.sin(warningAngle),
      color: "#f59e0b",
    });
  }

  if (criticalThreshold !== undefined && range > 0) {
    const criticalPct: number = Math.min(
      Math.max((criticalThreshold - minValue) / range, 0),
      1,
    );
    const criticalAngle: number = startAngle - sweepAngle * criticalPct;
    thresholdMarkers.push({
      angle: criticalAngle,
      x: centerX + (radius + strokeWidth * 0.7) * Math.cos(criticalAngle),
      y: centerY - (radius + strokeWidth * 0.7) * Math.sin(criticalAngle),
      color: "#ef4444",
    });
  }

  const percentDisplay: number = Math.round(percentage * 100);

  return (
    <div className="w-full text-center h-full flex flex-col items-center justify-center">
      {props.component.arguments.gaugeTitle && (
        <div
          style={{
            fontSize: titleHeightInPx > 0 ? `${titleHeightInPx}px` : "",
          }}
          className="text-center font-medium text-gray-400 mb-2 truncate uppercase tracking-wider"
        >
          {props.component.arguments.gaugeTitle}
        </div>
      )}
      <svg
        width={gaugeSize}
        height={gaugeSize / 2 + strokeWidth + 8}
        viewBox={`0 0 ${gaugeSize} ${gaugeSize / 2 + strokeWidth + 8}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={gaugeColor} stopOpacity="0.6" />
            <stop offset="50%" stopColor={gaugeColor} stopOpacity="0.85" />
            <stop offset="100%" stopColor={gaugeColor} stopOpacity="1" />
          </linearGradient>
          <filter id={`gauge-glow-${props.componentId?.toString() || "default"}`}>
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Background track */}
        <path
          d={backgroundPath}
          fill="none"
          stroke="#f0f0f0"
          strokeWidth={strokeWidth + 4}
          strokeLinecap="round"
        />
        {/* Value arc */}
        {percentage > 0 && (
          <path
            d={valuePath}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            filter={`url(#gauge-glow-${props.componentId?.toString() || "default"})`}
          />
        )}
        {/* Threshold markers */}
        {thresholdMarkers.map(
          (marker: ThresholdMarker, index: number) => {
            return (
              <circle
                key={index}
                cx={marker.x}
                cy={marker.y}
                r={3}
                fill={marker.color}
                stroke="white"
                strokeWidth={1.5}
              />
            );
          },
        )}
        {/* Needle tip dot at current position */}
        {percentage > 0 && (
          <circle
            cx={arcCurrentX}
            cy={arcCurrentY}
            r={strokeWidth * 0.4}
            fill="white"
            stroke={gaugeColor}
            strokeWidth={2}
          />
        )}
      </svg>
      {/* Value + percentage display */}
      <div
        style={{
          marginTop: `-${gaugeSize * 0.2}px`,
        }}
      >
        <div
          className="font-bold text-gray-900"
          style={{
            fontSize: valueHeightInPx > 0 ? `${valueHeightInPx}px` : "",
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
          }}
        >
          {aggregatedValue}
        </div>
        <div
          className="text-gray-400 font-medium"
          style={{
            fontSize: `${Math.max(valueHeightInPx * 0.45, 10)}px`,
          }}
        >
          {percentDisplay}%
        </div>
      </div>
      {/* Min/Max labels */}
      <div
        className="flex justify-between w-full px-2 mt-0.5"
        style={{ maxWidth: `${gaugeSize + 10}px` }}
      >
        <span className="text-gray-300 tabular-nums" style={{ fontSize: "10px" }}>
          {minValue}
        </span>
        <span className="text-gray-300 tabular-nums" style={{ fontSize: "10px" }}>
          {maxValue}
        </span>
      </div>
    </div>
  );
};

export default DashboardGaugeComponentElement;
