import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useRef,
  useState,
} from "react";
import { DashboardValueTrendDirection } from "Common/Types/Dashboard/DashboardComponents/DashboardValueComponent";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import ValueFormatter, { FormattedValue } from "Common/Utils/ValueFormatter";
import OneUptimeDate from "Common/Types/Date";
import {
  getValueContentBox,
  getValueWidgetLayout,
  ValueContentBox,
  ValueWidgetLayout,
  ValueWidgetStackMode,
  VALUE_LINE_HEIGHT_RATIO,
} from "Common/Utils/Dashboard/ValueWidgetLayout";

/*
 * The big-number widget's PRESENTATION, with no opinion about where its
 * number came from. Two widgets render through it: DashboardValueComponent
 * (a OneUptime metric query) and DashboardDataSourceValueComponent (an
 * external Data Source query). Each owns its own fetching, reduction, and
 * unit resolution, and hands the finished number down here — which is what
 * lets the two look identical on a board without either one carrying the
 * other's configuration surface.
 */

export interface SparklinePoint {
  value: number;
  timestamp: Date;
}

interface SparklineProps {
  data: Array<SparklinePoint>;
  width: number;
  height: number;
  color: string;
  fillColor: string;
  /*
   * Fires while the cursor moves over the chart with the data point
   * under the cursor; fires with `null` when the cursor leaves. The
   * parent uses this to swap the big number for the hovered value and
   * surface its timestamp inline (no on-chart tooltip).
   */
  onHoverPoint?: ((point: SparklinePoint | null) => void) | undefined;
}

export const Sparkline: FunctionComponent<SparklineProps> = (
  props: SparklineProps,
): ReactElement => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef: React.RefObject<SVGSVGElement> = useRef<SVGSVGElement>(null);

  if (props.data.length < 2) {
    return <></>;
  }

  const dataPoints: Array<SparklinePoint> = props.data;
  const values: Array<number> = dataPoints.map((p: SparklinePoint) => {
    return p.value;
  });
  const minVal: number = Math.min(...values);
  const maxVal: number = Math.max(...values);
  const range: number = maxVal - minVal || 1;
  /*
   * The hover marker is an r=3.5 circle with a 2px stroke drawn at
   * `x = width - padding`, so a 2px inset painted it past the svg's own edge
   * and relied on `overflow-visible` to show it. The row height is budgeted
   * now, so nothing is allowed to bleed — inset far enough to contain it.
   */
  const padding: number = 4;

  const pointAt: (i: number) => [number, number] = (i: number) => {
    const x: number =
      padding + (i / (dataPoints.length - 1)) * (props.width - padding * 2);
    const y: number =
      props.height -
      padding -
      ((dataPoints[i]!.value - minVal) / range) * (props.height - padding * 2);
    return [x, y];
  };

  const points: string = dataPoints
    .map((_p: SparklinePoint, index: number) => {
      const [x, y] = pointAt(index);
      return `${x},${y}`;
    })
    .join(" ");

  const firstX: number = padding;
  const lastX: number = padding + (props.width - padding * 2);
  const fillPoints: string = `${firstX},${props.height} ${points} ${lastX},${props.height}`;

  const { onHoverPoint } = props;

  const onMove: (e: React.MouseEvent<SVGSVGElement>) => void = (
    e: React.MouseEvent<SVGSVGElement>,
  ) => {
    const rect: DOMRect | undefined = svgRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const xPx: number = e.clientX - rect.left;
    const usable: number = Math.max(rect.width - padding * 2, 1);
    const ratio: number = Math.max(0, Math.min(1, (xPx - padding) / usable));
    const idx: number = Math.round(ratio * (dataPoints.length - 1));
    const clampedIdx: number = Math.max(
      0,
      Math.min(dataPoints.length - 1, idx),
    );
    setHoverIndex(clampedIdx);
    if (onHoverPoint) {
      onHoverPoint(dataPoints[clampedIdx] ?? null);
    }
  };

  const onLeave: () => void = () => {
    setHoverIndex(null);
    if (onHoverPoint) {
      onHoverPoint(null);
    }
  };

  const hoverPos: [number, number] | null =
    hoverIndex !== null ? pointAt(hoverIndex) : null;

  /*
   * Rendered as a bare <svg>, not wrapped in a div. The old
   * `relative inline-block` wrapper was an inline-level box, so its line box
   * added the strut's below-baseline space — around 6px of phantom height the
   * row budget could not see.
   */
  return (
    <svg
      ref={svgRef}
      width={props.width}
      height={props.height}
      viewBox={`0 0 ${props.width} ${props.height}`}
      className="block cursor-crosshair"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <polygon points={fillPoints} fill={props.fillColor} />
      <polyline
        points={points}
        fill="none"
        stroke={props.color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {hoverPos && (
        <>
          <line
            x1={hoverPos[0]}
            x2={hoverPos[0]}
            y1={0}
            y2={props.height}
            stroke={props.color}
            strokeOpacity={0.35}
            strokeWidth={1}
            strokeDasharray="2 2"
          />
          <circle
            cx={hoverPos[0]}
            cy={hoverPos[1]}
            r={3.5}
            fill="var(--ou-chart-marker-ring, #ffffff)"
            stroke={props.color}
            strokeWidth={2}
          />
        </>
      )}
    </svg>
  );
};

export interface ValueWidgetViewProps {
  // Tile geometry — drives the whole one-pass layout solve.
  widthInPx: number;
  heightInPx: number;
  isEditMode: boolean;

  // Fetch state.
  isLoading: boolean;
  /** True only on the very first load, so the skeleton shows once. */
  hasEverLoaded: boolean;
  error: string | null;

  /*
   * The reduced number, or null when the query returned nothing usable.
   * null renders the explicit no-data state — never a substituted 0, which
   * would be indistinguishable from a genuine measurement of zero.
   */
  value: number | null;
  /** Every point, in time order, for the sparkline and the trend. */
  points: Array<SparklinePoint>;
  /** Shown instead of a number when `value` is null. */
  noDataMessage: string;

  /*
   * False while the widget has no query yet — renders the "click to
   * configure" prompt rather than a no-data state, because nothing has been
   * asked of the data source at all.
   */
  isConfigured: boolean;
  setupTitle: string;
  setupMessage: string;

  title: string | undefined;
  /*
   * Unit the value is expressed in, in ValueFormatter's vocabulary
   * ("Bytes", "ms", "%", "1", ...). The metric widget reads it off the
   * MetricType; the Data Source widget takes it from widget config.
   */
  rawUnit: string;
  /*
   * Metric name, used only for ValueFormatter's name-based heuristics
   * (fraction rescaling, higher-is-worse trend colouring). Empty for
   * external data, which has no OneUptime metric behind it.
   */
  metricName: string;
  hideUnit: boolean;
  warningThreshold: number | undefined;
  criticalThreshold: number | undefined;
  trendDirection: DashboardValueTrendDirection | undefined;
}

const ValueWidgetView: FunctionComponent<ValueWidgetViewProps> = (
  props: ValueWidgetViewProps,
): ReactElement => {
  /*
   * While the cursor is over the sparkline, swap the big aggregated
   * number for the hovered data point's value and render its timestamp
   * inline (in place of the trend indicator). Reset to null on mouse-out
   * to fall back to the aggregated value.
   */
  const [hoveredPoint, setHoveredPoint] = useState<SparklinePoint | null>(null);

  const handleHoverPoint: (point: SparklinePoint | null) => void = useCallback(
    (point: SparklinePoint | null): void => {
      setHoveredPoint(point);
    },
    [],
  );

  /*
   * The three non-numeric states used fixed pixel heights that ignored the
   * tile: the skeleton alone is 92px of content, against as little as 32px of
   * edit-mode content box on the shipped 3x1 default. `justify-center` then
   * clipped them at the top AND the bottom at once.
   */
  const contentBox: ValueContentBox = getValueContentBox({
    widthInPx: props.widthInPx,
    heightInPx: props.heightInPx,
    isEditMode: props.isEditMode,
  });

  /*
   * The 40px icon disc is the first thing to go on a short tile — it is
   * decoration, and the message under it is the part the user needs.
   */
  const showStateIcon: boolean = contentBox.heightInPx >= 76;

  /*
   * Same trade one step further down: below this the tile cannot hold the
   * title AND a two-line explanation, and the explanation is the part that
   * carries the meaning.
   */
  const showStateTitle: boolean = contentBox.heightInPx >= 60;

  if (props.isLoading && !props.hasEverLoaded) {
    // Skeleton loading state - only on initial load
    return (
      <div className="w-full h-full flex flex-col items-center justify-center rounded-md overflow-hidden gap-1.5 animate-pulse">
        <div
          className="w-16 bg-gray-100 rounded shrink-0"
          style={{ height: `${Math.min(contentBox.heightInPx * 0.12, 12)}px` }}
        ></div>
        <div
          className="w-24 bg-gray-100 rounded shrink-0"
          style={{ height: `${Math.min(contentBox.heightInPx * 0.3, 32)}px` }}
        ></div>
        <div
          className="w-32 bg-gray-50 rounded shrink-0"
          style={{ height: `${Math.min(contentBox.heightInPx * 0.1, 12)}px` }}
        ></div>
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
      <div className="flex flex-col items-center justify-center w-full h-full gap-1.5 overflow-hidden">
        {showStateIcon && (
          <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center shrink-0">
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
        )}
        <p
          className="text-xs font-medium text-gray-500 max-w-full line-clamp-1 px-1"
          title={props.title?.trim() || props.setupTitle}
        >
          {props.title?.trim() || props.setupTitle}
        </p>
        <p
          className="text-xs text-gray-400 text-center max-w-full line-clamp-1 px-1"
          title={props.setupMessage}
        >
          {props.setupMessage}
        </p>
      </div>
    );
  }

  if (props.error) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-1.5 overflow-hidden">
        {showStateIcon && (
          <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center shrink-0">
            <div className="h-5 w-5 text-gray-300">
              <Icon icon={IconProp.ChartBar} />
            </div>
          </div>
        )}
        <p
          className="text-xs text-gray-400 text-center max-w-full line-clamp-2 px-1"
          title={props.error}
        >
          {props.error}
        </p>
      </div>
    );
  }

  /*
   * A configured query that came back empty — or one that failed and
   * surfaced a reason — used to fall through to the reduction's 0 seed and
   * render a confident "0", indistinguishable from a metric that is
   * genuinely zero. On the RUM template that made an untouched dashboard
   * read as a flawless site ("AVG LCP 0", "AVG CLS 0"), while the gauges
   * directly beneath it correctly said they had nothing.
   *
   * The loading case is already owned by the skeleton above, so this
   * deliberately carries no `!isLoading` term: adding one would re-render
   * the very "0" this removes for the duration of every auto-refresh of a
   * query that is still empty.
   */
  if (props.value === null) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-1.5 overflow-hidden">
        {showStateIcon && (
          <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center shrink-0">
            <div className="h-5 w-5 text-gray-300">
              <Icon icon={IconProp.ChartBar} />
            </div>
          </div>
        )}
        {showStateTitle && props.title ? (
          <p
            className="text-xs font-medium text-gray-500 max-w-full line-clamp-1 px-1"
            title={props.title}
          >
            {props.title}
          </p>
        ) : (
          <></>
        )}
        <p
          className="text-xs text-gray-400 text-center max-w-full line-clamp-2 px-1"
          title={props.noDataMessage}
        >
          {props.noDataMessage}
        </p>
      </div>
    );
  }

  const aggregatedValue: number = props.value;
  const sparklineData: Array<SparklinePoint> = props.points;
  const metricName: string = props.metricName;
  const rawUnit: string = props.rawUnit;

  /*
   * Run the raw aggregate through ValueFormatter so bytes scale to
   * KB/MB/GB, OTel ratio metrics (unit "1" + `.utilization` name) render
   * as percentages, and dimensionless counts (unit "1" with no fraction
   * suffix) lose the meaningless "1" suffix. The big-number font is applied
   * to the numeric portion and the unit suffix is rendered in a smaller gray
   * span, so we ask the formatter for the two PARTS rather than splitting
   * its output back apart — a lastIndexOf(" ") over "5 requests per Second"
   * put "requests per" in the big-number span. The compact variant also
   * renders the unit as a symbol ("°C", not "Celsius"), which is what makes
   * long OpenTelemetry units affordable on a narrow tile. When the cursor is
   * over the sparkline, format the hovered point's value instead so the big
   * number tracks the chart.
   */
  const displayValue: number = hoveredPoint
    ? hoveredPoint.value
    : aggregatedValue;

  const displayParts: FormattedValue = ValueFormatter.formatValueCompact(
    displayValue,
    rawUnit,
    { metricName },
  );

  /*
   * Size against the AGGREGATED value, always — never the hovered one. The
   * font is width-limited by the string, so feeding it the hovered value
   * would re-solve the layout on every mousemove and make the number pulse
   * under the cursor. Sizing against the aggregate makes the layout provably
   * hover-invariant; a hovered point that happens to format longer is caught
   * by the value row's truncate.
   */
  const sizingParts: FormattedValue = hoveredPoint
    ? ValueFormatter.formatValueCompact(aggregatedValue, rawUnit, {
        metricName,
      })
    : displayParts;

  const hoveredTimestamp: string | null = hoveredPoint
    ? OneUptimeDate.getDateAsLocalFormattedString(hoveredPoint.timestamp)
    : null;

  /*
   * Threshold comparison uses the same scale as the displayed value.
   * For fraction metrics arriving as [0, 1] we compare the percent (0-100)
   * value so thresholds set in the natural percent scale work as expected.
   */
  const isFractionScale: boolean =
    rawUnit.trim() === "1" && ValueFormatter.isFractionMetric(metricName);
  const thresholdValue: number = isFractionScale
    ? aggregatedValue * 100
    : aggregatedValue;

  // Determine color based on thresholds
  let valueColorClass: string = "text-gray-900";
  let bgStyle: React.CSSProperties = {};
  let sparklineColor: string = "#6366f1"; // indigo
  let sparklineFill: string = "rgba(99, 102, 241, 0.08)";
  const warningThreshold: number | undefined = props.warningThreshold;
  const criticalThreshold: number | undefined = props.criticalThreshold;

  if (criticalThreshold !== undefined && thresholdValue >= criticalThreshold) {
    valueColorClass = "text-red-600";
    bgStyle = {
      background:
        "linear-gradient(135deg, rgba(254, 226, 226, 0.4) 0%, rgba(254, 202, 202, 0.2) 100%)",
    };
    sparklineColor = "#ef4444";
    sparklineFill = "rgba(239, 68, 68, 0.08)";
  } else if (
    warningThreshold !== undefined &&
    thresholdValue >= warningThreshold
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
    const rawValues: Array<number> = sparklineData.map((p: SparklinePoint) => {
      return p.value;
    });
    const midpoint: number = Math.floor(rawValues.length / 2);
    const firstHalf: Array<number> = rawValues.slice(0, midpoint);
    const secondHalf: Array<number> = rawValues.slice(midpoint);
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

  /*
   * One arithmetic pass decides the whole layout: how big the number can be on
   * BOTH axes, and which optional rows the widget can still afford at this
   * size. No DOM measurement — the canvas already knows the tile size, so
   * measuring would only buy a second render on every resize frame, which is
   * exactly the re-measure flicker DashboardBaseComponent's constant edit-mode
   * padding exists to avoid. `arePropsEqual` already busts on both px props,
   * so this re-runs on resize with no observer.
   */
  const layout: ValueWidgetLayout = getValueWidgetLayout({
    widthInPx: props.widthInPx,
    heightInPx: props.heightInPx,
    isEditMode: props.isEditMode,
    hasTitle: Boolean(props.title?.trim()),
    hasTrend: trendPercent !== null && trendDirection !== "flat",
    hasSparklineData: sparklineData.length >= 2,
    valueText: sizingParts.value || "0",
    unitText: props.hideUnit ? "" : sizingParts.unit,
  });

  /*
   * Trend indicator — colour depends on whether a rising value is good or bad
   * for this metric. The widget config takes precedence; when it says "Auto"
   * (or is unset) we fall back to a metric-name heuristic so legacy widgets
   * get sensible defaults without re-saving. External data has no metric name,
   * so the heuristic there always answers "higher is better".
   */
  const trendElement: ReactElement | null =
    trendPercent !== null && trendDirection !== "flat"
      ? (() => {
          const configured: DashboardValueTrendDirection | undefined =
            props.trendDirection;
          let higherIsWorse: boolean;
          if (configured === DashboardValueTrendDirection.HigherIsWorse) {
            higherIsWorse = true;
          } else if (
            configured === DashboardValueTrendDirection.HigherIsBetter
          ) {
            higherIsWorse = false;
          } else {
            higherIsWorse = ValueFormatter.isHigherWorseMetric(metricName);
          }
          const trendIsGood: boolean = higherIsWorse
            ? trendDirection === "down"
            : trendDirection === "up";
          return (
            <span
              className={`inline-flex items-center gap-0.5 ${
                trendIsGood ? "text-emerald-500" : "text-red-500"
              }`}
            >
              <span>{trendDirection === "up" ? "↑" : "↓"}</span>
              <span className="font-medium tabular-nums">
                {Math.abs(trendPercent)}%
              </span>
            </span>
          );
        })()
      : null;

  /*
   * The hovered timestamp takes the trend indicator's slot while the cursor is
   * over the sparkline. The slot's height is reserved from whether the widget
   * COULD show either, never from whether it currently is, so the swap cannot
   * move anything below it.
   */
  const statusElement: ReactElement | null = hoveredTimestamp ? (
    <span className="text-gray-400 font-medium tabular-nums truncate">
      {hoveredTimestamp}
    </span>
  ) : (
    trendElement
  );

  const titleElement: ReactElement = (
    <span
      className="font-medium text-gray-400 truncate uppercase tracking-wider"
      style={{ fontSize: `${layout.titleFontSizeInPx}px` }}
      title={props.title}
    >
      {props.title}
    </span>
  );

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center rounded-md relative overflow-hidden"
      style={{
        ...bgStyle,
        opacity: props.isLoading ? 0.5 : 1,
        transition: "opacity 0.2s ease-in-out",
      }}
    >
      {/* Header — on a short widget the title and the trend share one line so
          the height they would each claim goes to the number instead. */}
      {layout.stackMode === ValueWidgetStackMode.Compact &&
        (layout.showTitle || layout.showStatusRow) && (
          <div
            className="w-full shrink-0 overflow-hidden flex items-center justify-center gap-2"
            style={{
              height: `${layout.headerRowHeightInPx}px`,
              fontSize: `${layout.statusFontSizeInPx}px`,
            }}
          >
            {layout.showTitle && titleElement}
            {layout.showStatusRow && statusElement}
          </div>
        )}

      {/* Title */}
      {layout.stackMode === ValueWidgetStackMode.Column && layout.showTitle && (
        <div
          className="w-full shrink-0 overflow-hidden flex items-center justify-center"
          style={{ height: `${layout.titleRowHeightInPx}px` }}
        >
          {titleElement}
        </div>
      )}

      {/* Value — the row height is dictated by the budget and the font was
          solved to fit inside it, so nothing here can be squeezed. `w-full` is
          what makes `truncate` produce an ellipsis rather than letting the
          parent hard-clip both edges of an over-wide number. */}
      <div
        className="w-full shrink-0 overflow-hidden flex items-center justify-center"
        style={{ height: `${layout.valueRowHeightInPx}px` }}
      >
        <div
          className={`w-full text-center font-bold tabular-nums truncate ${valueColorClass}`}
          style={{
            fontSize: `${layout.valueFontSizeInPx}px`,
            lineHeight: VALUE_LINE_HEIGHT_RATIO,
            letterSpacing: "-0.03em",
          }}
          title={displayParts.formatted}
        >
          {displayParts.value || "0"}
          {layout.showUnit && displayParts.unit && (
            <span
              className="text-gray-400 font-normal"
              style={{ fontSize: `${layout.unitFontSizeInPx}px` }}
            >
              {displayParts.unit === "%"
                ? displayParts.unit
                : ` ${displayParts.unit}`}
            </span>
          )}
        </div>
      </div>

      {/* Trend indicator, or the hovered point's timestamp. One slot with a
          dictated height, so the swap cannot move anything below it. */}
      {layout.stackMode === ValueWidgetStackMode.Column &&
        layout.showStatusRow && (
          <div
            className="w-full shrink-0 overflow-hidden flex items-center justify-center whitespace-nowrap"
            style={{
              height: `${layout.statusRowHeightInPx}px`,
              fontSize: `${layout.statusFontSizeInPx}px`,
            }}
          >
            {statusElement}
          </div>
        )}

      {/* Sparkline */}
      {layout.showSparkline && (
        <div
          className="w-full shrink-0 overflow-hidden flex items-center justify-center"
          style={{ height: `${layout.sparklineRowHeightInPx}px` }}
        >
          <Sparkline
            data={sparklineData}
            width={layout.sparklineWidthInPx}
            height={layout.sparklineHeightInPx}
            color={sparklineColor}
            fillColor={sparklineFill}
            onHoverPoint={handleHoverPoint}
          />
        </div>
      )}
    </div>
  );
};

export default ValueWidgetView;
