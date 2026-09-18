import React, { FunctionComponent, ReactElement } from "react";
import ValueFormatter from "Common/Utils/ValueFormatter";
import {
  GaugeArcGeometry,
  computeGaugeArcGeometry,
  computeGaugePercentage,
  gaugeAngleForPercentage,
} from "./GaugeArcData";

/*
 * The radial gauge's PRESENTATION, with no opinion about where its number
 * came from. DashboardGaugeComponent feeds it a OneUptime metric
 * aggregate; DashboardDataSourceGaugeComponent feeds it the reduction of an
 * external Data Source query. Keeping the arc, thresholds, and centre-value
 * typography in one place is what makes the two indistinguishable on a
 * board while their configuration surfaces stay completely separate.
 */

/*
 * Split a ValueFormatter output like "6.91 hours" / "25.00%" / "1.5 MB"
 * into a numeric portion and a unit portion so the gauge can render the
 * big number prominently with a smaller gray unit suffix — matching how
 * DashboardValueComponent renders its centre value.
 */
export function splitFormattedDisplay(formatted: string): {
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

const GaugeStateIcon: FunctionComponent<{
  tone: "gray" | "emerald";
}> = (props: { tone: "gray" | "emerald" }): ReactElement => {
  return (
    <div
      className={`w-10 h-10 rounded-full flex items-center justify-center ${
        props.tone === "emerald" ? "bg-emerald-50" : "bg-gray-50"
      }`}
    >
      <svg
        className={`w-5 h-5 ${
          props.tone === "emerald" ? "text-emerald-300" : "text-gray-300"
        }`}
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
  );
};

export interface GaugeWidgetViewProps {
  // Tile geometry.
  widthInPx: number;
  heightInPx: number;
  /** Namespaces the SVG gradient so several gauges can coexist. */
  componentId: string;

  // Fetch state.
  isLoading: boolean;
  /** True only on the very first load, so the skeleton shows once. */
  hasEverLoaded: boolean;
  error: string | null;

  /*
   * The reduced number, or null when the query returned nothing usable.
   * null renders the explicit no-data state rather than a confident
   * "0 / Healthy" gauge.
   */
  value: number | null;
  /** Shown instead of a gauge when `value` is null. */
  noDataMessage: string;

  /** False while the widget has no query yet — renders the setup prompt. */
  isConfigured: boolean;
  setupTitle: string;
  setupMessage: string;

  title: string | undefined;
  /*
   * Unit in ValueFormatter's vocabulary, for the centre value, threshold
   * tick tooltips, and the min/max footer.
   */
  rawUnit: string;
  /*
   * Metric name, used only for ValueFormatter's name-based heuristics.
   * Empty for external data, which has no OneUptime metric behind it.
   */
  metricName: string;
  minValue: number;
  maxValue: number;
  warningThreshold: number | undefined;
  criticalThreshold: number | undefined;
}

const GaugeWidgetView: FunctionComponent<GaugeWidgetViewProps> = (
  props: GaugeWidgetViewProps,
): ReactElement => {
  if (props.isLoading && !props.hasEverLoaded) {
    // Skeleton loading for gauge - only on initial load
    return (
      <div className="w-full h-full flex flex-col items-center justify-center animate-pulse">
        <div className="h-3 w-20 bg-gray-100 rounded mb-3"></div>
        <div
          className="bg-gray-100 rounded-full"
          style={{
            width: `${Math.min(props.widthInPx * 0.5, 120)}px`,
            height: `${Math.min(props.widthInPx * 0.25, 60)}px`,
            borderRadius: "999px 999px 0 0",
          }}
        ></div>
        <div className="h-5 w-12 bg-gray-100 rounded mt-2"></div>
      </div>
    );
  }

  /*
   * The setup prompt outranks the error. A widget whose query has been
   * cleared has nothing left to be wrong about, and the last fetch's error
   * would otherwise stick forever — the fetch that would clear it is the
   * one the missing query stops from running.
   */
  if (!props.isConfigured) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-1.5">
        <GaugeStateIcon tone="emerald" />
        <p className="text-xs font-medium text-gray-500">
          {props.title?.trim() || props.setupTitle}
        </p>
        <p className="text-xs text-gray-400 text-center">
          {props.setupMessage}
        </p>
      </div>
    );
  }

  if (props.error) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-1.5">
        <GaugeStateIcon tone="gray" />
        <p className="text-xs text-gray-400 text-center max-w-40">
          {props.error}
        </p>
      </div>
    );
  }

  /*
   * A configured query that came back empty — or one that failed
   * server-side / in formula evaluation and surfaced a reason — previously
   * rendered as a confident "0 / Healthy" gauge, indistinguishable from a
   * value that is genuinely zero. Show an explicit no-data state once
   * loading settles.
   */
  if (props.value === null && !props.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-1.5">
        <GaugeStateIcon tone="gray" />
        {props.title ? (
          <p className="text-xs font-medium text-gray-500">{props.title}</p>
        ) : (
          <></>
        )}
        <p className="text-xs text-gray-400 text-center max-w-40">
          {props.noDataMessage}
        </p>
      </div>
    );
  }

  /*
   * Still loading with nothing yet (a refresh over an empty result) falls
   * through to the arc below with a 0 value, dimmed by the loading opacity
   * — same as the original widget did.
   */
  const aggregatedValue: number = props.value ?? 0;
  const metricName: string = props.metricName;
  const rawUnit: string = props.rawUnit;

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

  const minValue: number = props.minValue;
  const maxValue: number = props.maxValue;
  const warningThreshold: number | undefined = props.warningThreshold;
  const criticalThreshold: number | undefined = props.criticalThreshold;

  // Calculate percentage for the gauge arc
  const range: number = maxValue - minValue;
  const percentage: number = computeGaugePercentage(
    scaledValue,
    minValue,
    maxValue,
  );

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
    props.heightInPx - reservedTitlePx - reservedFooterPx;
  const size: number = Math.min(props.widthInPx - 24, verticalBudget * 1.8);
  const gaugeSize: number = Math.max(size, 96);
  const strokeWidth: number = Math.max(gaugeSize * 0.06, 7);

  // Semi-circle arc (180 degrees, from left to right) — see GaugeArcData.
  const arc: GaugeArcGeometry = computeGaugeArcGeometry({
    gaugeSize,
    strokeWidth,
    percentage,
  });
  const { radius, centerX, centerY, backgroundPath, valuePath } = arc;

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
  const gradientId: string = `gauge-gradient-${props.componentId || "default"}`;

  // Threshold tick positions on arc
  type ThresholdTick = {
    angle: number;
    color: string;
    label: string;
  };

  const thresholdTicks: Array<ThresholdTick> = [];

  if (warningThreshold !== undefined && range > 0) {
    const warningPct: number = computeGaugePercentage(
      warningThreshold,
      minValue,
      maxValue,
    );
    thresholdTicks.push({
      angle: gaugeAngleForPercentage(warningPct),
      color: "#f59e0b",
      label: ValueFormatter.formatValue(
        isFractionScale ? warningThreshold / 100 : warningThreshold,
        rawUnit,
        { metricName },
      ),
    });
  }

  if (criticalThreshold !== undefined && range > 0) {
    const criticalPct: number = computeGaugePercentage(
      criticalThreshold,
      minValue,
      maxValue,
    );
    thresholdTicks.push({
      angle: gaugeAngleForPercentage(criticalPct),
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
        opacity: props.isLoading ? 0.5 : 1,
        transition: "opacity 0.2s ease-in-out",
      }}
    >
      {props.title && (
        <div className="text-[11px] font-medium text-gray-400 truncate uppercase tracking-wider w-full text-center">
          {props.title}
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
            stroke="var(--ou-chart-track, #eef2f7)"
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
              cx={arc.arcCurrent.x}
              cy={arc.arcCurrent.y}
              r={strokeWidth * 0.5}
              fill="var(--ou-chart-marker-ring, #ffffff)"
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

export default GaugeWidgetView;
