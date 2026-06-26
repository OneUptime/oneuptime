import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DashboardGaugeComponent from "Common/Types/Dashboard/DashboardComponents/DashboardGaugeComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricUtil from "../../Metrics/Utils/Metrics";
import API from "Common/UI/Utils/API/API";
import JSONFunctions from "Common/Types/JSONFunctions";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import DashboardVariableInterpolation from "Common/Utils/Dashboard/VariableInterpolation";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import ValueFormatter from "Common/Utils/ValueFormatter";

/*
 * Split a ValueFormatter output like "6.91 hours" / "25.00%" / "1.5 MB"
 * into a numeric portion and a unit portion so the gauge can render the
 * big number prominently with a smaller gray unit suffix — matching how
 * DashboardValueComponent renders its centre value.
 */
function splitFormattedDisplay(formatted: string): {
  value: string;
  unit: string;
} {
  if (formatted.endsWith("%")) {
    return { value: formatted.slice(0, -1), unit: "%" };
  }
  const lastSpace: number = formatted.lastIndexOf(" ");
  if (lastSpace > 0) {
    return {
      value: formatted.substring(0, lastSpace),
      unit: formatted.substring(lastSpace + 1),
    };
  }
  return { value: formatted, unit: "" };
}

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardGaugeComponent;
}

const DashboardGaugeComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [metricResults, setMetricResults] = useState<Array<AggregatedResult>>(
    [],
  );
  const [aggregationType, setAggregationType] = useState<AggregationType>(
    AggregationType.Avg,
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const rawMetricQueryConfig: MetricQueryConfigData | undefined =
    props.component.arguments.metricQueryConfig;

  const metricQueryConfig: MetricQueryConfigData | undefined = useMemo(() => {
    if (!rawMetricQueryConfig) {
      return undefined;
    }
    return DashboardVariableInterpolation.applyToQueryConfig(
      rawMetricQueryConfig,
      props.variables,
    );
  }, [rawMetricQueryConfig, props.variables]);

  const startAndEndDate: ReturnType<
    typeof RangeStartAndEndDateTimeUtil.getStartAndEndDate
  > = useMemo(() => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.dashboardStartAndEndDate,
    );
  }, [props.dashboardStartAndEndDate]);

  const metricViewData: MetricViewData = useMemo(() => {
    return {
      queryConfigs: metricQueryConfig ? [metricQueryConfig] : [],
      startAndEndDate: startAndEndDate,
      formulaConfigs: [],
    };
  }, [metricQueryConfig, startAndEndDate]);

  const metricViewDataRef: React.MutableRefObject<MetricViewData> =
    useRef<MetricViewData>(metricViewData);
  metricViewDataRef.current = metricViewData;

  const fetchAggregatedResults: () => Promise<void> = useCallback(async () => {
    const data: MetricViewData = metricViewDataRef.current;
    setIsLoading(true);

    if (!data.startAndEndDate?.startValue || !data.startAndEndDate?.endValue) {
      setIsLoading(false);
      return;
    }

    if (
      !data.queryConfigs ||
      data.queryConfigs.length === 0 ||
      !data.queryConfigs[0] ||
      !data.queryConfigs[0].metricQueryData ||
      !data.queryConfigs[0].metricQueryData.filterData ||
      Object.keys(data.queryConfigs[0].metricQueryData.filterData).length === 0
    ) {
      setIsLoading(false);
      return;
    }

    if (!data.queryConfigs[0].metricQueryData.filterData?.aggegationType) {
      setIsLoading(false);
      return;
    }

    setAggregationType(
      (data.queryConfigs[0].metricQueryData.filterData
        ?.aggegationType as AggregationType) || AggregationType.Avg,
    );

    try {
      const results: Array<AggregatedResult> = await MetricUtil.fetchResults({
        metricViewData: data,
      });

      setMetricResults(results);
      setError("");
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchAggregatedResults();
  }, [
    startAndEndDate,
    metricQueryConfig,
    props.refreshTick,
    fetchAggregatedResults,
  ]);

  if (isLoading && metricResults.length === 0) {
    // Skeleton loading for gauge - only on initial load
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
          <svg
            className="w-5 h-5 text-gray-300"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z"
            />
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
          <svg
            className="w-5 h-5 text-emerald-300"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z"
            />
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

  const metricName: string =
    props.component.arguments.metricQueryConfig?.metricQueryData.filterData.metricName?.toString() ||
    "";
  const rawUnit: string =
    props.metricTypes?.find((item: MetricType) => {
      return item.name?.toString() === metricName;
    })?.unit || "";

  /*
   * OTel ratio metrics (unit "1" + `.utilization`/`.ratio`/`.fraction`/
   * `.percent` name) arrive in the [0, 1] range. Gauge thresholds and the
   * 0-100 sweep are authored in the natural percent scale, so we scale the
   * stored value to a percent for arc rendering, threshold colouring, and
   * the centre value display. ValueFormatter handles the same conversion
   * for the formatted label so the user sees "25.00%" instead of "0.25 1".
   */
  const isFractionScale: boolean =
    rawUnit.trim() === "1" && ValueFormatter.isFractionMetric(metricName);
  const scaledValue: number = isFractionScale
    ? aggregatedValue * 100
    : aggregatedValue;

  const minValue: number = props.component.arguments.minValue ?? 0;
  const maxValue: number = props.component.arguments.maxValue ?? 100;
  const warningThreshold: number | undefined =
    props.component.arguments.warningThreshold;
  const criticalThreshold: number | undefined =
    props.component.arguments.criticalThreshold;

  // Calculate percentage for the gauge arc
  const range: number = maxValue - minValue;
  const percentage: number =
    range > 0 ? Math.min(Math.max((scaledValue - minValue) / range, 0), 1) : 0;

  // Determine color based on thresholds
  let gaugeColor: string = "#10b981"; // green
  if (criticalThreshold !== undefined && scaledValue >= criticalThreshold) {
    gaugeColor = "#ef4444"; // red
  } else if (
    warningThreshold !== undefined &&
    scaledValue >= warningThreshold
  ) {
    gaugeColor = "#f59e0b"; // yellow
  }

  const formattedDisplay: string = ValueFormatter.formatValue(
    aggregatedValue,
    rawUnit,
    { metricName },
  );

  /*
   * Gauge sizing — pick a square that fits the available space, then carve
   * out room above for the title and below for min/max labels. The arc is
   * a thin half-circle so the value reads cleanly inside; the previous
   * design used a 10%-wide arc that swallowed the centre digits at small
   * widget sizes.
   */
  const reservedTitlePx: number = 28;
  const reservedFooterPx: number = 22;
  const verticalBudget: number =
    props.dashboardComponentHeightInPx - reservedTitlePx - reservedFooterPx;
  const size: number = Math.min(
    props.dashboardComponentWidthInPx - 24,
    verticalBudget * 1.8,
  );
  const gaugeSize: number = Math.max(size, 96);
  const strokeWidth: number = Math.max(gaugeSize * 0.06, 7);
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

  const { value: displayValue, unit: displayUnit } =
    splitFormattedDisplay(formattedDisplay);

  /*
   * The centre value is rendered as a big number plus a smaller gray unit
   * suffix. Bare "6.91 hours" at one font size overflowed the gauge arc on
   * wider widgets, so we estimate the laid-out text width and scale both
   * sides down together when it would spill past ~82% of the gauge width.
   * Per-character estimate uses 0.55em — accurate enough for tabular nums
   * and the small set of single-word units we render here.
   */
  const baseValueFontPx: number = Math.max(gaugeSize * 0.22, 22);
  const baseUnitFontPx: number = baseValueFontPx * 0.4;
  const unitGapPx: number =
    displayUnit && displayUnit !== "%" ? baseValueFontPx * 0.12 : 0;
  const estimatedTextWidthPx: number =
    displayValue.length * baseValueFontPx * 0.55 +
    (displayUnit ? displayUnit.length * baseUnitFontPx * 0.55 : 0) +
    unitGapPx;
  const maxTextWidthPx: number = gaugeSize * 0.82;
  const widthScale: number = Math.min(
    1,
    maxTextWidthPx / Math.max(estimatedTextWidthPx, 1),
  );
  const valueFontPx: number = baseValueFontPx * widthScale;
  const unitFontPx: number = baseUnitFontPx * widthScale;

  // Status label derived from threshold state
  let statusLabel: string = "Healthy";
  let statusTextColor: string = "text-emerald-600";
  let statusDotColor: string = "#10b981";
  if (criticalThreshold !== undefined && scaledValue >= criticalThreshold) {
    statusLabel = "Critical";
    statusTextColor = "text-red-600";
    statusDotColor = "#ef4444";
  } else if (
    warningThreshold !== undefined &&
    scaledValue >= warningThreshold
  ) {
    statusLabel = "Warning";
    statusTextColor = "text-amber-600";
    statusDotColor = "#f59e0b";
  }

  // Generate a unique gradient ID for this component instance
  const gradientId: string = `gauge-gradient-${props.componentId?.toString() || "default"}`;

  // Threshold tick positions on arc
  type ThresholdTick = {
    angle: number;
    color: string;
    label: string;
  };

  const thresholdTicks: Array<ThresholdTick> = [];

  if (warningThreshold !== undefined && range > 0) {
    const warningPct: number = Math.min(
      Math.max((warningThreshold - minValue) / range, 0),
      1,
    );
    thresholdTicks.push({
      angle: startAngle - sweepAngle * warningPct,
      color: "#f59e0b",
      label: ValueFormatter.formatValue(
        isFractionScale ? warningThreshold / 100 : warningThreshold,
        rawUnit,
        { metricName },
      ),
    });
  }

  if (criticalThreshold !== undefined && range > 0) {
    const criticalPct: number = Math.min(
      Math.max((criticalThreshold - minValue) / range, 0),
      1,
    );
    thresholdTicks.push({
      angle: startAngle - sweepAngle * criticalPct,
      color: "#ef4444",
      label: ValueFormatter.formatValue(
        isFractionScale ? criticalThreshold / 100 : criticalThreshold,
        rawUnit,
        { metricName },
      ),
    });
  }

  /*
   * Min/max labels go through ValueFormatter so a gauge authored in
   * seconds doesn't dump "0" / "7200" — it reads "0 sec" / "2 hr"
   * matching the centre value's scale. For fraction metrics we divide
   * the percent-scale range back to a ratio before formatting.
   */
  const formattedMin: string = ValueFormatter.formatValue(
    isFractionScale ? minValue / 100 : minValue,
    rawUnit,
    { metricName },
  );
  const formattedMax: string = ValueFormatter.formatValue(
    isFractionScale ? maxValue / 100 : maxValue,
    rawUnit,
    { metricName },
  );

  const gaugeViewboxHeight: number = gaugeSize / 2 + strokeWidth + 12;

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-between py-2 px-3"
      style={{
        opacity: isLoading ? 0.5 : 1,
        transition: "opacity 0.2s ease-in-out",
      }}
    >
      {props.component.arguments.gaugeTitle && (
        <div className="text-[11px] font-medium text-gray-400 truncate uppercase tracking-wider w-full text-center">
          {props.component.arguments.gaugeTitle}
        </div>
      )}

      <div
        className="relative flex flex-col items-center"
        style={{ width: `${gaugeSize}px` }}
      >
        <svg
          width={gaugeSize}
          height={gaugeViewboxHeight}
          viewBox={`0 0 ${gaugeSize} ${gaugeViewboxHeight}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={gaugeColor} stopOpacity="0.7" />
              <stop offset="100%" stopColor={gaugeColor} stopOpacity="1" />
            </linearGradient>
          </defs>
          {/* Background track */}
          <path
            d={backgroundPath}
            fill="none"
            stroke="#eef2f7"
            strokeWidth={strokeWidth}
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
              style={{ transition: "stroke 200ms ease" }}
            />
          )}
          {/* Threshold tick marks — short radial slashes outside the arc */}
          {thresholdTicks.map((tick: ThresholdTick, index: number) => {
            const innerR: number = radius - strokeWidth * 0.55;
            const outerR: number = radius + strokeWidth * 0.55;
            const cosA: number = Math.cos(tick.angle);
            const sinA: number = Math.sin(tick.angle);
            return (
              <line
                key={index}
                x1={centerX + innerR * cosA}
                y1={centerY - innerR * sinA}
                x2={centerX + outerR * cosA}
                y2={centerY - outerR * sinA}
                stroke={tick.color}
                strokeWidth={2}
                strokeLinecap="round"
                opacity={0.85}
              >
                <title>{tick.label}</title>
              </line>
            );
          })}
          {/* Indicator dot at current position */}
          {percentage > 0 && (
            <circle
              cx={arcCurrentX}
              cy={arcCurrentY}
              r={strokeWidth * 0.5}
              fill="#ffffff"
              stroke={gaugeColor}
              strokeWidth={2}
            />
          )}
        </svg>

        {/* Centre value — placed in the empty half-disc area below the arc */}
        <div
          className="absolute left-0 right-0 flex flex-col items-center px-2"
          style={{
            top: `${gaugeSize / 2 - valueFontPx * 0.55}px`,
          }}
        >
          <div
            className="font-bold text-gray-900 tabular-nums leading-none whitespace-nowrap"
            style={{
              fontSize: `${valueFontPx}px`,
              letterSpacing: "-0.025em",
            }}
          >
            {displayValue}
            {displayUnit && (
              <span
                className="text-gray-400 font-normal tracking-normal"
                style={{
                  fontSize: `${unitFontPx}px`,
                  marginLeft: displayUnit === "%" ? "0" : "0.15em",
                }}
              >
                {displayUnit}
              </span>
            )}
          </div>
          <div
            className={`mt-2 inline-flex items-center gap-1 ${statusTextColor}`}
            style={{ fontSize: "10px" }}
          >
            <span
              className="inline-block rounded-full"
              style={{
                width: "6px",
                height: "6px",
                backgroundColor: statusDotColor,
              }}
            />
            <span className="font-medium tracking-wide uppercase">
              {statusLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Min/Max footer */}
      <div
        className="flex justify-between w-full text-[10px] text-gray-400 tabular-nums"
        style={{ maxWidth: `${gaugeSize}px` }}
      >
        <span>{formattedMin}</span>
        <span>{formattedMax}</span>
      </div>
    </div>
  );
};

function arePropsEqual(prev: ComponentProps, next: ComponentProps): boolean {
  if (
    prev.componentId.toString() !== next.componentId.toString() ||
    prev.refreshTick !== next.refreshTick ||
    prev.isEditMode !== next.isEditMode ||
    prev.isSelected !== next.isSelected ||
    prev.dashboardComponentWidthInPx !== next.dashboardComponentWidthInPx ||
    prev.dashboardComponentHeightInPx !== next.dashboardComponentHeightInPx
  ) {
    return false;
  }

  if (
    !JSONFunctions.deepEqual(
      prev.dashboardStartAndEndDate,
      next.dashboardStartAndEndDate,
    )
  ) {
    return false;
  }

  if (!JSONFunctions.deepEqual(prev.variables, next.variables)) {
    return false;
  }

  /*
   * metricTypes drives unit lookup for ValueFormatter — compare by length
   * and names so re-renders happen only when the underlying registry
   * changes, not on every parent identity flip.
   */
  const prevTypes: Array<{ name?: string }> = prev.metricTypes as Array<{
    name?: string;
  }>;
  const nextTypes: Array<{ name?: string }> = next.metricTypes as Array<{
    name?: string;
  }>;
  if (prevTypes.length !== nextTypes.length) {
    return false;
  }
  for (let i: number = 0; i < prevTypes.length; i++) {
    if (prevTypes[i]?.name !== nextTypes[i]?.name) {
      return false;
    }
  }

  return JSONFunctions.deepEqual(
    prev.component.arguments,
    next.component.arguments,
  );
}

export default React.memo(DashboardGaugeComponentElement, arePropsEqual);
