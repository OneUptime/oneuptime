import React, { FunctionComponent, ReactElement } from "react";
import ValueFormatter, { FormattedValue } from "Common/Utils/ValueFormatter";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  GaugeArcGeometry,
  computeGaugeArcGeometry,
  computeGaugePercentage,
  computeGaugeSize,
  computeGaugeStrokeWidth,
  computeGaugeValueFontPx,
  gaugeAngleForPercentage,
} from "./GaugeArcData";
import DashboardWidgetLine, {
  getWidgetPageLanguage,
} from "./DashboardWidgetLine";
import { getNumberSpacingClassName } from "./DashboardWidgetDigits";
import { getLineDirection } from "Common/UI/Utils/LineDirection";
import { ReadingDirection } from "Common/Types/ReadingDirection";
import {
  DASHBOARD_WIDGET_SETUP_LINE_CLASS_NAME,
  DASHBOARD_WIDGET_SETUP_LINE_TEST_ID,
  DASHBOARD_WIDGET_SETUP_NAME_CLASS_NAME,
} from "./DashboardWidgetSetupCopy";
import DashboardWidgetError, {
  DashboardWidgetErrorLine,
  DashboardWidgetState,
} from "./DashboardWidgetError";

// The row of the arc's bounds under it: the minimum, then the maximum.
export const GAUGE_BOUNDS_TEST_ID: string = "gauge-bounds";
// The line in its place when there is no value: none read, or why not.
export const GAUGE_NO_DATA_TEST_ID: string = "gauge-no-data";
// The centre's number, with its unit in a span of its own.
export const GAUGE_VALUE_TEST_ID: string = "gauge-value";

/*
 * The radial gauge's PRESENTATION, with no opinion about where its number
 * came from. DashboardGaugeComponent feeds it a OneUptime metric
 * aggregate; DashboardDataSourceGaugeComponent feeds it the reduction of an
 * external Data Source query. Keeping the arc, thresholds, and centre-value
 * typography in one place is what makes the two indistinguishable on a
 * board while their configuration surfaces stay completely separate.
 */

const GaugeStateIcon: FunctionComponent<{
  tone: "gray" | "emerald";
}> = (props: { tone: "gray" | "emerald" }): ReactElement => {
  return (
    <div
      className={`w-10 h-10 rounded-full flex items-center justify-center ${
        props.tone === "emerald" ? "bg-emerald-50" : "bg-gray-50"
      }`}
    >
      {/*
       * Gray as every widget's error icon is (DashboardWidgetErrorIcon):
       * the arc stands for the gauge where another widget's chart or table
       * icon would.
       */}
      <svg
        className={`w-5 h-5 ${
          props.tone === "emerald" ? "text-emerald-300" : "text-gray-400"
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

  /*
   * False while the widget has no query yet — renders the setup prompt,
   * the host's line for where the widget is drawn (DashboardWidgetSetupCopy).
   */
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
  const translator: Translator = useTranslator();

  /*
   * The states' words come from the hosts in English (each wraps them in
   * translationKey so the extractor finds them) and are read out in the
   * reader's language here, as the Value widget reads its own. A
   * connector's own error message has no entry, so it reads as the
   * connector wrote it, in its own reading direction (ErrorMessageText,
   * for the no-data and error lines).
   */
  const setupTitle: string =
    props.title?.trim() ||
    translator.translateText(props.setupTitle) ||
    props.setupTitle;
  const setupMessage: string =
    translator.translateText(props.setupMessage) || props.setupMessage;

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
        <p className={DASHBOARD_WIDGET_SETUP_NAME_CLASS_NAME}>{setupTitle}</p>
        <p
          className={DASHBOARD_WIDGET_SETUP_LINE_CLASS_NAME}
          data-testid={DASHBOARD_WIDGET_SETUP_LINE_TEST_ID}
        >
          {setupMessage}
        </p>
      </div>
    );
  }

  /*
   * Every widget's error state (DashboardWidgetError), under the gauge's
   * own arc icon: the line in the reader's language and readable, and a
   * long message in a two-row gauge that drops the icon, then scrolls from
   * its first line. It was drawn as set, in gray-400, in a 160px column,
   * centred so a long one was cut off above and below.
   */
  if (props.error) {
    return (
      <DashboardWidgetError
        icon={<GaugeStateIcon tone="gray" />}
        error={props.error}
      />
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
      <DashboardWidgetState icon={<GaugeStateIcon tone="gray" />}>
        {props.title ? (
          <p className={DASHBOARD_WIDGET_SETUP_NAME_CLASS_NAME}>
            {props.title}
          </p>
        ) : (
          <></>
        )}
        {/*
         * The line every widget says why it draws nothing in (issue #7330):
         * readable, and a read's failure reason in the reader's language,
         * or English from a connector in its own reading direction. It was
         * gray-400 in a 160px column.
         */}
        <DashboardWidgetErrorLine
          error={props.noDataMessage}
          dataTestId={GAUGE_NO_DATA_TEST_ID}
        />
      </DashboardWidgetState>
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

  /*
   * Its numbers - the centre value, the thresholds' and the bounds - in the
   * reader's language (#7094): "73,40 %" in German, "۷۳٫۴۰٪" in Persian,
   * as the SLO tiles beside it write theirs. They were Latin digits and a
   * point on every board.
   */
  const language: string = translator.language;

  /*
   * The number and its unit as two parts, so the gauge can render the big
   * number prominently with a smaller gray unit suffix — matching how the
   * Value widget renders its centre value.
   */
  const displayParts: FormattedValue = ValueFormatter.formatValueInParts(
    aggregatedValue,
    rawUnit,
    { metricName, language },
  );

  /*
   * Gauge sizing — the largest square that fits the tile across and, with
   * the title above it and the value, status and min/max labels under its
   * centre, down (computeGaugeSize). The arc is a thin half-circle so the
   * value reads cleanly inside; the previous design used a 10%-wide arc
   * that swallowed the centre digits at small widget sizes.
   */
  const gaugeSize: number = computeGaugeSize({
    widthInPx: props.widthInPx,
    heightInPx: props.heightInPx,
    hasTitle: Boolean(props.title),
  });
  const strokeWidth: number = computeGaugeStrokeWidth(gaugeSize);

  // Semi-circle arc (180 degrees, from left to right) — see GaugeArcData.
  const arc: GaugeArcGeometry = computeGaugeArcGeometry({
    gaugeSize,
    strokeWidth,
    percentage,
  });
  const { radius, centerX, centerY, backgroundPath, valuePath } = arc;

  const displayValue: string = displayParts.value;
  const displayUnit: string = displayParts.unit;
  // "1.5 MB" and German's "73,40 %" leave a gap; "73.40%" and "۷۳٫۴۰٪" none.
  const isUnitSetApart: boolean = ValueFormatter.isUnitSetApart(displayParts);

  /*
   * The centre reads the way its unit's letters do: on an Arabic or a
   * Persian board a unit in Latin letters is drawn after its number,
   * "۱٫۹۶ MB/s", with its gap between the two. Read from the right, the
   * unit's gap (its inline start) fell on its far side: "1.96MB/s".
   */
  const centreDirection: ReadingDirection | undefined = getLineDirection(
    displayUnit,
    getWidgetPageLanguage(translator.language),
  );

  /*
   * The centre value is rendered as a big number plus a smaller gray unit
   * suffix. Bare "6.91 hours" at one font size overflowed the gauge arc on
   * wider widgets, so we estimate the laid-out text width and scale both
   * sides down together when it would spill past ~82% of the gauge width.
   * Per-character estimate uses 0.55em — accurate enough for tabular nums
   * and the small set of single-word units we render here.
   */
  const baseValueFontPx: number = computeGaugeValueFontPx(gaugeSize);
  const baseUnitFontPx: number = baseValueFontPx * 0.4;
  const unitGapPx: number = isUnitSetApart ? baseValueFontPx * 0.12 : 0;
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

  /*
   * Status label derived from threshold state, read out in the reader's
   * words: it was "HEALTHY" under an Arabic or a German gauge.
   */
  let statusLabel: string = translationKey("Healthy");
  let statusTextColor: string = "text-emerald-600";
  let statusDotColor: string = "#10b981";
  if (criticalThreshold !== undefined && scaledValue >= criticalThreshold) {
    statusLabel = translationKey("Critical");
    statusTextColor = "text-red-600";
    statusDotColor = "#ef4444";
  } else if (
    warningThreshold !== undefined &&
    scaledValue >= warningThreshold
  ) {
    statusLabel = translationKey("Warning");
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
        { metricName, language },
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
        { metricName, language },
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
    { metricName, language },
  );
  const formattedMax: string = ValueFormatter.formatValue(
    isFractionScale ? maxValue / 100 : maxValue,
    rawUnit,
    { metricName, language },
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
        <DashboardWidgetLine
          text={props.title}
          className="text-[11px] font-medium text-gray-400 truncate uppercase tracking-wider w-full text-center"
        />
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
            dir={centreDirection}
            data-testid={GAUGE_VALUE_TEST_ID}
            className={`font-bold text-gray-900 ${getNumberSpacingClassName(displayValue)} leading-none whitespace-nowrap`}
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
                  marginInlineStart: isUnitSetApart ? "0.15em" : "0",
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
              {translator.translateText(statusLabel) || statusLabel}
            </span>
          </div>
        </div>
      </div>

      {/*
       * Min/Max footer, under the arc's two ends. The arc fills from the
       * left in every language, as a chart's time runs, so its bounds are
       * laid out left to right too: mirrored on an Arabic board, "100" sat
       * under the end the fill starts from.
       */}
      <div
        dir="ltr"
        data-testid={GAUGE_BOUNDS_TEST_ID}
        className={`flex justify-between w-full text-[10px] text-gray-400 ${getNumberSpacingClassName(formattedMin + formattedMax)}`}
        style={{ maxWidth: `${gaugeSize}px` }}
      >
        <span>{formattedMin}</span>
        <span>{formattedMax}</span>
      </div>
    </div>
  );
};

export default GaugeWidgetView;
