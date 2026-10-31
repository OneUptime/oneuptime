import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DashboardValueTrendDirection } from "Common/Types/Dashboard/DashboardComponents/DashboardValueComponent";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import IconProp from "Common/Types/Icon/IconProp";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ValueFormatter, { FormattedValue } from "Common/Utils/ValueFormatter";
import {
  getValueContentBox,
  getValueWidgetLayout,
  ValueContentBox,
  ValueWidgetLayout,
  ValueWidgetStackMode,
  VALUE_LINE_HEIGHT_RATIO,
} from "Common/Utils/Dashboard/ValueWidgetLayout";
import {
  getValueWidgetBucketWidthMs,
  getValueWidgetSeries,
  ValueWidgetPoint,
  ValueWidgetTrend,
  ValueWidgetTrendDirection,
} from "Common/Utils/Dashboard/ValueWidgetSeries";
import {
  DashboardSpanLabels,
  getDashboardBucketLabel,
  getDashboardSpanLabeller,
  getDashboardSpanLabels,
} from "../Utils/DashboardDateTime";

/*
 * The big-number widget's PRESENTATION, with no opinion about where its
 * number came from. Two widgets render through it: DashboardValueComponent
 * (a OneUptime metric query) and DashboardDataSourceValueComponent (an
 * external Data Source query). Each owns its own fetching, reduction, and
 * unit resolution, and hands the finished number - and the trend worked out
 * the same way (Common/Utils/Dashboard/ValueWidgetSeries) - down here, which
 * is what lets the two look identical on a board without either one carrying
 * the other's configuration surface.
 */

/*
 * One point of the sparkline. The view draws its points oldest first and
 * evenly spaced whatever order they are handed over in: it sorts them itself
 * (getValueWidgetSeries), so no host depends on the order its API answered
 * in. The metrics API answers newest first.
 */
export type SparklinePoint = ValueWidgetPoint;

export interface SparklineSelectionWindow {
  startTime: Date;
  endTime: Date;
}

/**
 * The time a drag across sparkline points firstIndex..lastIndex covers:
 * from the earliest of their timestamps to the END of the latest one's
 * bucket, so the zoomed window holds every point the drag went over.
 *
 * The points are drawn evenly spaced in the order the host hands them
 * over, so the window is read from the timestamps themselves rather than
 * from the two ends of the drag: a point out of time order can widen it,
 * but can never turn it inside out. A bucket is as wide as the smallest gap
 * between two distinct timestamps in the series - the interval the host
 * aggregated at.
 *
 * Null when the drag never left one point, or the points it covered carry
 * no usable time: neither is a window worth retiming a board for.
 */
export const getSparklineSelectionWindow: (
  data: Array<SparklinePoint>,
  firstIndex: number,
  lastIndex: number,
) => SparklineSelectionWindow | null = (
  data: Array<SparklinePoint>,
  firstIndex: number,
  lastIndex: number,
): SparklineSelectionWindow | null => {
  const lowerIndex: number = Math.max(0, Math.min(firstIndex, lastIndex));
  const upperIndex: number = Math.min(
    data.length - 1,
    Math.max(firstIndex, lastIndex),
  );

  if (lowerIndex >= upperIndex) {
    return null;
  }

  const toMs: (point: SparklinePoint | undefined) => number = (
    point: SparklinePoint | undefined,
  ): number => {
    const timestamp: Date | undefined = point?.timestamp;
    return timestamp instanceof Date ? timestamp.getTime() : Number.NaN;
  };

  const selectedMs: Array<number> = data
    .slice(lowerIndex, upperIndex + 1)
    .map(toMs)
    .filter((ms: number): boolean => {
      return Number.isFinite(ms);
    });

  if (selectedMs.length === 0) {
    return null;
  }

  const startMs: number = Math.min(...selectedMs);
  const latestMs: number = Math.max(...selectedMs);

  const distinctMs: Array<number> = Array.from(
    new Set(
      data.map(toMs).filter((ms: number): boolean => {
        return Number.isFinite(ms);
      }),
    ),
  ).sort((a: number, b: number): number => {
    return a - b;
  });

  let bucketWidthMs: number = 0;

  for (let i: number = 1; i < distinctMs.length; i++) {
    const gapMs: number = distinctMs[i]! - distinctMs[i - 1]!;

    if (bucketWidthMs === 0 || gapMs < bucketWidthMs) {
      bucketWidthMs = gapMs;
    }
  }

  const endMs: number = latestMs + bucketWidthMs;

  if (endMs <= startMs) {
    return null;
  }

  return { startTime: new Date(startMs), endTime: new Date(endMs) };
};

interface SparklineProps {
  data: Array<SparklinePoint>;
  width: number;
  height: number;
  color: string;
  fillColor: string;
  /*
   * Fires while the cursor moves over the chart with the index, in
   * `data`, of the point under the cursor; fires with `null` once the
   * hover names no point: the cursor left, a drag zoomed the board away
   * from the points it was over, or the line was redrawn with a different
   * number of points (or taken away). The parent uses this to swap the big
   * number for the hovered value and surface its timestamp inline (no
   * on-chart tooltip).
   */
  onHoverIndex?: ((index: number | null) => void) | undefined;
  /*
   * Drag across the line: called with the window the dragged-over points
   * cover (see getSparklineSelectionWindow). Unset, the line only
   * inspects on hover.
   */
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  // Double-click on the line. Set only while there is a zoom to undo.
  onTimeRangeReset?: (() => void) | undefined;
}

export const SPARKLINE_TEST_ID: string = "value-widget-sparkline";
export const SPARKLINE_SELECTION_TEST_ID: string =
  "value-widget-sparkline-selection";

interface SparklineDrag {
  startIndex: number;
  endIndex: number;
}

export const Sparkline: FunctionComponent<SparklineProps> = (
  props: SparklineProps,
): ReactElement => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef: React.RefObject<SVGSVGElement> = useRef<SVGSVGElement>(null);

  /*
   * The drag in progress. The ref is the authority - a release can be seen
   * twice (the line's own mouseup and the page-wide one below) and must
   * only zoom once - and the state mirrors it for the selection band.
   */
  const [drag, setDrag] = useState<SparklineDrag | null>(null);
  const dragRef: React.MutableRefObject<SparklineDrag | null> =
    useRef<SparklineDrag | null>(null);

  /*
   * Read when the drag lands, by a release the window listener below may
   * deliver a render or two after the drag began.
   */
  const latestRef: React.MutableRefObject<{
    data: Array<SparklinePoint>;
    onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
    onHoverIndex: ((index: number | null) => void) | undefined;
  }> = useRef({
    data: props.data,
    onTimeRangeSelect: props.onTimeRangeSelect,
    onHoverIndex: props.onHoverIndex,
  });
  latestRef.current = {
    data: props.data,
    onTimeRangeSelect: props.onTimeRangeSelect,
    onHoverIndex: props.onHoverIndex,
  };

  const finishDrag: () => void = useCallback((): void => {
    const finished: SparklineDrag | null = dragRef.current;

    if (!finished) {
      return;
    }

    dragRef.current = null;
    setDrag(null);

    // A press and release on one point is a click, not a window.
    const selected: SparklineSelectionWindow | null =
      getSparklineSelectionWindow(
        latestRef.current.data,
        finished.startIndex,
        finished.endIndex,
      );
    const onTimeRangeSelect:
      | ((startTime: Date, endTime: Date) => void)
      | undefined = latestRef.current.onTimeRangeSelect;

    if (!selected || !onTimeRangeSelect) {
      return;
    }

    /*
     * The board reloads this line for the window just picked, under a
     * pointer that has not moved. The point the hover names belongs to the
     * window being left, so let go of it now; the next move names one on
     * the new line.
     */
    setHoverIndex(null);
    latestRef.current.onHoverIndex?.(null);

    onTimeRangeSelect(selected.startTime, selected.endTime);
  }, []);

  /*
   * A hover names a point by its place along the line, and every place
   * moves when the line is redrawn with a different number of points (a
   * zoom or a refresh landed), or goes when the line is taken away. The
   * pointer is then over some other point, or none, so the hover is let go
   * of - here in the cleanup, which runs on exactly those two occasions -
   * and the next move picks a point on the line as it is now. Redrawn with
   * as many points as before, each place still holds the point under the
   * pointer, and the hover stays: the parent reads that point afresh.
   * Before paint, so the read-out never shows a point the line has lost.
   */
  const pointCount: number = props.data.length;

  useLayoutEffect(() => {
    return () => {
      setHoverIndex(null);
      latestRef.current.onHoverIndex?.(null);
    };
  }, [pointCount]);

  /*
   * Readers overshoot a line this small all the time and let go outside
   * it, where its own mouseup never fires. Without this the drag would
   * never end and its band would stay painted.
   */
  const isDragging: boolean = drag !== null;

  useEffect(() => {
    if (!isDragging) {
      return undefined;
    }

    window.addEventListener("mouseup", finishDrag);

    return () => {
      window.removeEventListener("mouseup", finishDrag);
    };
  }, [isDragging, finishDrag]);

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
   * A series that never moves is drawn across the middle of the line's box.
   * Scaled like any other it sat on the bottom edge, where a steady 120 req/s
   * read as a line of zeros.
   */
  const isFlat: boolean = maxVal === minVal;
  /*
   * The hover marker is an r=3.5 circle with a 2px stroke drawn at
   * `x = width - padding`, so a 2px inset painted it past the svg's own edge
   * and relied on `overflow-visible` to show it. The row height is budgeted
   * now, so nothing is allowed to bleed — inset far enough to contain it.
   */
  const padding: number = 4;
  const lastIndex: number = dataPoints.length - 1;

  /*
   * Where the point at `index` is drawn, the index held to the line. The
   * hover and the ends of a drag are read off the line as it was when the
   * pointer last moved, and a zoom or a refresh can land fewer points
   * before it moves again. Read past the end, one of them threw during
   * render, and the error took the whole dashboard down with it.
   */
  const pointAt: (index: number) => [number, number] = (index: number) => {
    const i: number = Math.max(0, Math.min(lastIndex, index));
    const x: number = padding + (i / lastIndex) * (props.width - padding * 2);
    const y: number = isFlat
      ? props.height / 2
      : props.height -
        padding -
        ((dataPoints[i]!.value - minVal) / range) *
          (props.height - padding * 2);
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

  const { onHoverIndex } = props;
  const canSelect: boolean = Boolean(props.onTimeRangeSelect);

  // The point under the pointer: the nearest of the evenly spaced points.
  const indexAt: (clientX: number) => number | null = (
    clientX: number,
  ): number | null => {
    const rect: DOMRect | undefined = svgRef.current?.getBoundingClientRect();
    if (!rect) {
      return null;
    }
    const xPx: number = clientX - rect.left;
    const usable: number = Math.max(rect.width - padding * 2, 1);
    const ratio: number = Math.max(0, Math.min(1, (xPx - padding) / usable));
    const idx: number = Math.round(ratio * (dataPoints.length - 1));
    return Math.max(0, Math.min(dataPoints.length - 1, idx));
  };

  const onMove: (e: React.MouseEvent<SVGSVGElement>) => void = (
    e: React.MouseEvent<SVGSVGElement>,
  ) => {
    const clampedIdx: number | null = indexAt(e.clientX);
    if (clampedIdx === null) {
      return;
    }

    /*
     * The hover read-out keeps following the pointer through a drag: it
     * names the point the window currently ends on.
     */
    setHoverIndex(clampedIdx);
    if (onHoverIndex) {
      onHoverIndex(clampedIdx);
    }

    const current: SparklineDrag | null = dragRef.current;
    if (!current) {
      return;
    }

    /*
     * No button held: it came up somewhere no mouseup could be heard
     * (outside the browser window, say). Abandon the drag.
     */
    if (e.buttons === 0) {
      dragRef.current = null;
      setDrag(null);
      return;
    }

    if (current.endIndex !== clampedIdx) {
      const next: SparklineDrag = { ...current, endIndex: clampedIdx };
      dragRef.current = next;
      setDrag(next);
    }
  };

  const onLeave: () => void = () => {
    setHoverIndex(null);
    if (onHoverIndex) {
      onHoverIndex(null);
    }
  };

  const onMouseDown: (e: React.MouseEvent<SVGSVGElement>) => void = (
    e: React.MouseEvent<SVGSVGElement>,
  ) => {
    if (!canSelect || e.button !== 0) {
      return;
    }

    const startIdx: number | null = indexAt(e.clientX);
    if (startIdx === null) {
      return;
    }

    // Keep the browser from starting a text selection across the tile.
    e.preventDefault();

    const started: SparklineDrag = { startIndex: startIdx, endIndex: startIdx };
    dragRef.current = started;
    setDrag(started);
  };

  const onMouseUp: (e: React.MouseEvent<SVGSVGElement>) => void = (
    e: React.MouseEvent<SVGSVGElement>,
  ) => {
    const current: SparklineDrag | null = dragRef.current;
    if (!current) {
      return;
    }

    /*
     * The point under the pointer at release is the most current answer:
     * a quick drag can be let go before its last move has been handled.
     */
    const releaseIdx: number | null = indexAt(e.clientX);
    if (releaseIdx !== null) {
      dragRef.current = { ...current, endIndex: releaseIdx };
    }

    finishDrag();
  };

  /*
   * A hover past the end of a line that has since shrunk names no point
   * on it, so there is nothing to mark until the pointer moves. (The ends
   * of a drag are held to the line by pointAt instead: the band shows what
   * a release would zoom to, the points the drag still covers.)
   */
  const activeHoverIndex: number | null =
    hoverIndex !== null && hoverIndex <= lastIndex ? hoverIndex : null;
  const hoverPos: [number, number] | null =
    activeHoverIndex !== null ? pointAt(activeHoverIndex) : null;

  const selectionFromX: number | null = drag
    ? pointAt(Math.min(drag.startIndex, drag.endIndex))[0]
    : null;
  const selectionToX: number | null = drag
    ? pointAt(Math.max(drag.startIndex, drag.endIndex))[0]
    : null;

  /*
   * Rendered as a bare <svg>, not wrapped in a div. The old
   * `relative inline-block` wrapper was an inline-level box, so its line box
   * added the strut's below-baseline space — around 6px of phantom height the
   * row budget could not see.
   */
  return (
    <svg
      ref={svgRef}
      data-testid={SPARKLINE_TEST_ID}
      width={props.width}
      height={props.height}
      viewBox={`0 0 ${props.width} ${props.height}`}
      className={`block cursor-crosshair ${canSelect ? "select-none" : ""}`}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onDoubleClick={props.onTimeRangeReset}
    >
      <polygon points={fillPoints} fill={props.fillColor} />
      {selectionFromX !== null &&
      selectionToX !== null &&
      selectionToX > selectionFromX ? (
        <rect
          data-testid={SPARKLINE_SELECTION_TEST_ID}
          x={selectionFromX}
          y={0}
          width={selectionToX - selectionFromX}
          height={props.height}
          fill="rgba(99,102,241,0.12)"
          stroke="rgba(99,102,241,0.5)"
          strokeWidth={1}
        />
      ) : null}
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
  /*
   * Every point, for the sparkline: in any order (the view sorts them by
   * time), one per bucket (a host combines the groups of a grouped query with
   * its own reduction first - getValueWidgetSeries).
   */
  points: Array<SparklinePoint>;
  /*
   * How the number moved: the second half of the time range against the
   * first, each reduced the way the number is (getValueWidgetTrend). Null or
   * absent when there is nothing to compare, and then no arrow is drawn.
   */
  trend?: ValueWidgetTrend | null | undefined;
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

  /*
   * Drag across the sparkline: zooms the board to the window the dragged
   * points cover, the gesture every time-series panel on a dashboard
   * answers to. Unset (edit mode, a host that owns no range), the
   * sparkline only inspects on hover.
   */
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  // Double-click on the sparkline. Set only while there is a zoom to undo.
  onTimeRangeReset?: (() => void) | undefined;
}

/*
 * The widget's root in each of its states, with the state it is in, so a
 * reader of the page can find a Value widget and tell what it is showing.
 */
export const VALUE_WIDGET_TEST_ID: string = "value-widget";

export enum ValueWidgetState {
  Loading = "loading",
  Setup = "setup",
  Error = "error",
  NoData = "no-data",
  Value = "value",
}

export const TREND_TEST_ID: string = "value-widget-trend";
export const TREND_DETAILS_TEST_ID: string = "value-widget-trend-details";
export const SPARKLINE_START_LABEL_TEST_ID: string =
  "value-widget-sparkline-start";
export const SPARKLINE_END_LABEL_TEST_ID: string = "value-widget-sparkline-end";
export const HOVERED_TIME_TEST_ID: string = "value-widget-hovered-time";

/*
 * Whether a move is good news, bad news or neither. The chip carries it as
 * data-tone too, so a reader of the page (or a test) need not know the palette.
 */
export type ValueWidgetTrendTone = "good" | "bad" | "neutral";

/*
 * Small text needs 4.5:1 against the tile. The 500 shades the chip used to
 * be drawn in reached 2.5:1 (green) and 3.8:1 (red) on white; these reach
 * 5.5:1 and 4.8:1, and Theme.css lightens all three for the dark theme.
 */
const TREND_TONE_CLASS_NAMES: Record<ValueWidgetTrendTone, string> = {
  good: "text-emerald-700",
  bad: "text-red-600",
  neutral: "text-gray-500",
};

const TREND_ARROWS: Record<ValueWidgetTrendDirection, string> = {
  [ValueWidgetTrendDirection.Up]: "↑",
  [ValueWidgetTrendDirection.Down]: "↓",
  [ValueWidgetTrendDirection.Flat]: "→",
};

/*
 * The colour of a move. The widget's own Trend Direction setting decides
 * whether a rise is good; "Auto" (or no setting) reads the metric's name, and
 * external data, which has no metric name, therefore reads a rise as good.
 * A move that is about nothing is neither.
 */
export const getValueWidgetTrendTone: (data: {
  direction: ValueWidgetTrendDirection;
  trendDirection: DashboardValueTrendDirection | undefined;
  metricName: string;
}) => ValueWidgetTrendTone = (data: {
  direction: ValueWidgetTrendDirection;
  trendDirection: DashboardValueTrendDirection | undefined;
  metricName: string;
}): ValueWidgetTrendTone => {
  if (data.direction === ValueWidgetTrendDirection.Flat) {
    return "neutral";
  }

  let higherIsWorse: boolean;

  if (data.trendDirection === DashboardValueTrendDirection.HigherIsWorse) {
    higherIsWorse = true;
  } else if (
    data.trendDirection === DashboardValueTrendDirection.HigherIsBetter
  ) {
    higherIsWorse = false;
  } else {
    higherIsWorse = ValueFormatter.isHigherWorseMetric(data.metricName);
  }

  const isRise: boolean = data.direction === ValueWidgetTrendDirection.Up;

  return isRise !== higherIsWorse ? "good" : "bad";
};

/*
 * The one sentence that says what the arrow means: which way, by how much,
 * and against what. It is the chip's accessible name and the first line of
 * its tooltip.
 */
export const getValueWidgetTrendSentence: (
  trend: ValueWidgetTrend,
  translator: Translator,
) => string = (trend: ValueWidgetTrend, translator: Translator): string => {
  const percent: string = `${Math.abs(trend.percent ?? 0)}%`;

  if (trend.direction === ValueWidgetTrendDirection.Flat) {
    return translator.translateTemplate(
      "About the same as in the first half of the time range",
    );
  }

  if (trend.percent === null) {
    return trend.direction === ValueWidgetTrendDirection.Up
      ? translator.translateTemplate(
          "Up from 0 in the first half of the time range",
        )
      : translator.translateTemplate(
          "Down from 0 in the first half of the time range",
        );
  }

  return trend.direction === ValueWidgetTrendDirection.Up
    ? translator.translateTemplate(
        "Up {{percent}} from the first half of the time range",
        { percent: percent },
      )
    : translator.translateTemplate(
        "Down {{percent}} from the first half of the time range",
        { percent: percent },
      );
};

interface ValueWidgetTrendChipProps {
  trend: ValueWidgetTrend;
  tone: ValueWidgetTrendTone;
  // The number as the widget writes it, unit and all.
  formatValue: (value: number) => string;
}

/*
 * The arrow and its percentage, and - on hover, focus or a tap - what they
 * compare: the sentence, then each half of the time range with its number,
 * so the percentage can be checked against the data it came from.
 */
export const ValueWidgetTrendChip: FunctionComponent<
  ValueWidgetTrendChipProps
> = (props: ValueWidgetTrendChipProps): ReactElement => {
  const translator: Translator = useTranslator();
  const trend: ValueWidgetTrend = props.trend;
  const sentence: string = getValueWidgetTrendSentence(trend, translator);

  const labelInstant: ((date: Date) => string) | null =
    getDashboardSpanLabeller(trend.firstHalfStart, trend.secondHalfEnd);

  const rangeOf: (start: Date, end: Date) => string | null = (
    start: Date,
    end: Date,
  ): string | null => {
    if (!labelInstant) {
      return null;
    }

    return translator.translateTemplate("{{start}} – {{end}}", {
      start: labelInstant(start),
      end: labelInstant(end),
    });
  };

  const halves: Array<{
    key: string;
    label: string;
    range: string | null;
    value: string;
  }> = [
    {
      key: "first",
      label: translator.translateTemplate("First half"),
      range: rangeOf(trend.firstHalfStart, trend.midpoint),
      value: props.formatValue(trend.firstHalfValue),
    },
    {
      key: "second",
      label: translator.translateTemplate("Second half"),
      range: rangeOf(trend.midpoint, trend.secondHalfEnd),
      value: props.formatValue(trend.secondHalfValue),
    },
  ];

  const details: ReactElement = (
    <div
      data-testid={TREND_DETAILS_TEST_ID}
      className="py-0.5 text-left text-xs"
    >
      <p className="font-medium leading-5 text-gray-900">{sentence}</p>
      <div className="mt-2 space-y-1.5">
        {halves.map(
          (half: {
            key: string;
            label: string;
            range: string | null;
            value: string;
          }): ReactElement => {
            return (
              <div
                key={half.key}
                data-half={half.key}
                className="flex items-start justify-between gap-6"
              >
                <div className="min-w-0">
                  <p className="leading-4 text-gray-600">{half.label}</p>
                  {half.range ? (
                    <p className="mt-0.5 leading-4 tabular-nums text-gray-500">
                      {/*
                       * Its own left-to-right run: on a right-to-left page a
                       * range that starts with a digit ("15 Oct – 18 Oct")
                       * was reordered into "Oct – 18 Oct 15".
                       */}
                      <bdi dir="ltr">{half.range}</bdi>
                    </p>
                  ) : (
                    <></>
                  )}
                </div>
                <p className="shrink-0 font-semibold leading-4 tabular-nums text-gray-900">
                  {half.value}
                </p>
              </div>
            );
          },
        )}
      </div>
    </div>
  );

  /*
   * In the tab order, so the halves are a key press away too: the tooltip
   * opens on focus. The ring hugs the chip without moving it (the padding is
   * taken back by the margin), and only a keyboard's focus draws it.
   */
  return (
    <Tooltip richContent={details} interactive={false} isShownOnPress={true}>
      <span
        data-testid={TREND_TEST_ID}
        data-tone={props.tone}
        data-direction={trend.direction}
        role="img"
        aria-label={sentence}
        tabIndex={0}
        className={`-mx-1 inline-flex cursor-default items-center gap-0.5 rounded px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${TREND_TONE_CLASS_NAMES[props.tone]}`}
      >
        <span>{TREND_ARROWS[trend.direction]}</span>
        <span className="font-medium tabular-nums">
          {trend.percent === null
            ? translator.translateTemplate("from 0")
            : `${Math.abs(trend.percent)}%`}
        </span>
      </span>
    </Tooltip>
  );
};

/*
 * A label at either end of the sparkline is drawn at this size, and only when
 * both fit beside the line inside the tile: this much room per character is
 * more than any of Inter's digits or letters takes at it.
 */
const SPAN_LABEL_FONT_SIZE_IN_PX: number = 10;
const SPAN_LABEL_CHARACTER_WIDTH_RATIO: number = 0.62;
const SPAN_LABEL_GAP_IN_PX: number = 6;

export const getSparklineSpanLabelsFit: (data: {
  labels: DashboardSpanLabels;
  contentWidthInPx: number;
  sparklineWidthInPx: number;
}) => boolean = (data: {
  labels: DashboardSpanLabels;
  contentWidthInPx: number;
  sparklineWidthInPx: number;
}): boolean => {
  const roomInPx: number =
    (data.contentWidthInPx - data.sparklineWidthInPx) / 2 -
    SPAN_LABEL_GAP_IN_PX;
  const widest: number = Math.max(
    data.labels.start.length,
    data.labels.end.length,
  );

  return (
    widest * SPAN_LABEL_CHARACTER_WIDTH_RATIO * SPAN_LABEL_FONT_SIZE_IN_PX <=
    roomInPx
  );
};

const ValueWidgetView: FunctionComponent<ValueWidgetViewProps> = (
  props: ValueWidgetViewProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * The line's points, oldest first, whatever order they were handed over in.
   * Everything below reads these: the line, the hover read-out, and the
   * window a drag zooms to.
   */
  const sparklineData: Array<SparklinePoint> = useMemo(() => {
    return getValueWidgetSeries(props.points);
  }, [props.points]);

  // How long each point stands for: how precisely the hover names its time.
  const bucketWidthMs: number = useMemo(() => {
    return getValueWidgetBucketWidthMs(sparklineData);
  }, [sparklineData]);

  /*
   * While the cursor is over the sparkline, swap the big aggregated
   * number for the hovered data point's value and render its timestamp
   * inline (in place of the trend indicator). Reset to null on mouse-out
   * to fall back to the aggregated value.
   *
   * Held as the point's index and read out of `points` on every render,
   * never as the point itself: a zoom or a refresh replaces the points
   * under a pointer that has not moved, and a point kept from before would
   * go on showing a value the line no longer has. (Nor could a kept point
   * be looked up again by identity: the hosts rebuild every point on each
   * of their renders.)
   */
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const handleHoverIndex: (index: number | null) => void = useCallback(
    (index: number | null): void => {
      setHoveredIndex(index);
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
   * carries the meaning. The setup prompt follows the same rule: on the
   * shipped 3x1 tile in edit mode it drew "Value Widget" over "Click to
   * configure metric" in 30px and cut the bottom off both.
   */
  const showStateTitle: boolean = contentBox.heightInPx >= 60;

  /*
   * A state's message wraps to a second line only where two lines fit; in a
   * shorter box the second line was cut through the middle.
   */
  const stateMessageClampClass: string =
    contentBox.heightInPx >= 32 ? "line-clamp-2" : "line-clamp-1";

  /*
   * The states' words come from the hosts in English (each wraps them in
   * translationKey so the extractor finds them) and are read out in the
   * reader's language here. A connector's own error message has no entry, so
   * it reads as the connector wrote it.
   */
  const setupTitle: string =
    props.title?.trim() ||
    translator.translateText(props.setupTitle) ||
    props.setupTitle;
  const setupMessage: string =
    translator.translateText(props.setupMessage) || props.setupMessage;
  const noDataMessage: string =
    translator.translateText(props.noDataMessage) || props.noDataMessage;

  if (props.isLoading && !props.hasEverLoaded) {
    // Skeleton loading state - only on initial load
    return (
      <div
        data-testid={VALUE_WIDGET_TEST_ID}
        data-state={ValueWidgetState.Loading}
        className="w-full h-full flex flex-col items-center justify-center rounded-md overflow-hidden gap-1.5 animate-pulse"
      >
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
      <div
        data-testid={VALUE_WIDGET_TEST_ID}
        data-state={ValueWidgetState.Setup}
        className="flex flex-col items-center justify-center w-full h-full gap-1.5 overflow-hidden"
      >
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
        {showStateTitle ? (
          <p
            className="text-xs font-medium text-gray-500 max-w-full line-clamp-1 px-1"
            title={setupTitle}
          >
            {setupTitle}
          </p>
        ) : (
          <></>
        )}
        <p
          className={`text-xs text-gray-500 text-center max-w-full ${stateMessageClampClass} px-1`}
          title={setupMessage}
        >
          {setupMessage}
        </p>
      </div>
    );
  }

  if (props.error) {
    return (
      <div
        data-testid={VALUE_WIDGET_TEST_ID}
        data-state={ValueWidgetState.Error}
        className="flex flex-col items-center justify-center w-full h-full gap-1.5 overflow-hidden"
      >
        {showStateIcon && (
          <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center shrink-0">
            <div className="h-5 w-5 text-gray-300">
              <Icon icon={IconProp.ChartBar} />
            </div>
          </div>
        )}
        <p
          className={`text-xs text-gray-500 text-center max-w-full ${stateMessageClampClass} px-1`}
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
    /*
     * A zoom into a quiet stretch lands here with no sparkline left to
     * double-click, so the empty state takes the double-click instead (it is
     * only armed while there is a zoom to undo). While it is, its words are
     * not selectable: a double-click on text would also select a word.
     */
    return (
      <div
        data-testid={VALUE_WIDGET_TEST_ID}
        data-state={ValueWidgetState.NoData}
        className={`flex flex-col items-center justify-center w-full h-full gap-1.5 overflow-hidden ${
          props.onTimeRangeReset ? "select-none" : ""
        }`}
        onDoubleClick={props.onTimeRangeReset}
      >
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
          className={`text-xs text-gray-500 text-center max-w-full ${stateMessageClampClass} px-1`}
          title={noDataMessage}
        >
          {noDataMessage}
        </p>
      </div>
    );
  }

  const aggregatedValue: number = props.value;
  const metricName: string = props.metricName;
  const rawUnit: string = props.rawUnit;

  // Past the end of points that have since shrunk, no point is hovered.
  const hoveredPoint: SparklinePoint | null =
    hoveredIndex !== null ? sparklineData[hoveredIndex] ?? null : null;

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

  /*
   * As a line chart's tooltip names the bucket under the pointer: day first,
   * as precise as the bucket ("18 Oct, 22:00" for an hour's), so it reads
   * like the labels at the line's two ends below it.
   */
  const hoveredTimestamp: string | null = hoveredPoint
    ? getDashboardBucketLabel(hoveredPoint.timestamp, bucketWidthMs)
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

  /*
   * Determine color based on thresholds. The tile's wash is a class, not an
   * inline colour: Theme.css turns these tints into a dark red and a dark
   * amber in the dark theme, where the light pink gradient they replace sat
   * on the dark card as a grey-pink box that washed out the title.
   */
  let valueColorClass: string = "text-gray-900";
  let thresholdTintClass: string = "";
  let sparklineColor: string = "#6366f1"; // indigo
  let sparklineFill: string = "rgba(99, 102, 241, 0.08)";
  const warningThreshold: number | undefined = props.warningThreshold;
  const criticalThreshold: number | undefined = props.criticalThreshold;

  if (criticalThreshold !== undefined && thresholdValue >= criticalThreshold) {
    valueColorClass = "text-red-600";
    thresholdTintClass = "bg-red-50/50";
    sparklineColor = "#ef4444";
    sparklineFill = "rgba(239, 68, 68, 0.08)";
  } else if (
    warningThreshold !== undefined &&
    thresholdValue >= warningThreshold
  ) {
    valueColorClass = "text-amber-600";
    thresholdTintClass = "bg-amber-50/50";
    sparklineColor = "#f59e0b";
    sparklineFill = "rgba(245, 158, 11, 0.08)";
  }

  /*
   * The trend the host worked out (getValueWidgetTrend): the second half of
   * the time range against the first. A flat one is drawn too - "about the
   * same" is an answer, where no arrow at all looked like a widget that had
   * not computed one.
   */
  const trend: ValueWidgetTrend | null = props.trend || null;

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
    hasTrend: trend !== null,
    hasSparklineData: sparklineData.length >= 2,
    valueText: sizingParts.value || "0",
    unitText: props.hideUnit ? "" : sizingParts.unit,
  });

  /*
   * The number as the widget writes it, for the halves the trend's tooltip
   * lists: the same formatter, unit and scale as the big number above it.
   */
  const formatValue: (value: number) => string = (value: number): string => {
    const parts: FormattedValue = ValueFormatter.formatValueCompact(
      value,
      rawUnit,
      { metricName },
    );

    return props.hideUnit ? parts.value : parts.formatted;
  };

  /*
   * Trend indicator — colour depends on whether a rising value is good or bad
   * for this metric (getValueWidgetTrendTone).
   */
  const trendElement: ReactElement | null = trend ? (
    <ValueWidgetTrendChip
      trend={trend}
      tone={getValueWidgetTrendTone({
        direction: trend.direction,
        trendDirection: props.trendDirection,
        metricName: metricName,
      })}
      formatValue={formatValue}
    />
  ) : null;

  /*
   * The hovered timestamp takes the trend indicator's slot while the cursor is
   * over the sparkline. The slot's height is reserved from whether the widget
   * COULD show either, never from whether it currently is, so the swap cannot
   * move anything below it.
   *
   * The time reads left to right on a right-to-left page too: "18 Oct, 22:00"
   * starts with a digit, and a Persian page would reorder it into
   * "22:00 ,Oct 18".
   */
  const statusElement: ReactElement | null = hoveredTimestamp ? (
    <span
      data-testid={HOVERED_TIME_TEST_ID}
      dir="ltr"
      className="text-gray-500 font-medium tabular-nums truncate"
    >
      {hoveredTimestamp}
    </span>
  ) : (
    trendElement
  );

  /*
   * While the pointer is on the line, its two ends say when it starts and
   * ends - oldest on the left, newest on the right, as on every chart - in
   * the room beside it, when there is room for both.
   */
  const spanLabels: DashboardSpanLabels | null =
    sparklineData.length >= 2
      ? getDashboardSpanLabels(
          sparklineData[0]!.timestamp,
          sparklineData[sparklineData.length - 1]!.timestamp,
        )
      : null;

  const showSpanLabels: boolean = Boolean(
    hoveredPoint &&
      spanLabels &&
      getSparklineSpanLabelsFit({
        labels: spanLabels,
        contentWidthInPx: layout.contentWidthInPx,
        sparklineWidthInPx: layout.sparklineWidthInPx,
      }),
  );

  /*
   * The title is words someone wrote, in their language whatever the
   * page's: it reads its own way (IsolatedText), so an English title cut
   * short on a Persian page keeps its start ("ACTIVE REQUE...", not
   * "...IVE REQUESTS").
   */
  const titleElement: ReactElement = (
    <IsolatedText
      text={props.title || ""}
      className="font-medium text-gray-500 truncate uppercase tracking-wider"
      style={{ fontSize: `${layout.titleFontSizeInPx}px` }}
      title={props.title}
    />
  );

  return (
    <div
      data-testid={VALUE_WIDGET_TEST_ID}
      data-state={ValueWidgetState.Value}
      className={`w-full h-full flex flex-col items-center justify-center rounded-md relative overflow-hidden ${thresholdTintClass}`}
      style={{
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
              className="text-gray-500 font-normal"
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

      {/* Sparkline. Time runs left to right in every language, as on the
          charts, so the line and its end labels are laid out left to right
          even on a right-to-left page. */}
      {layout.showSparkline && (
        <div
          className="w-full shrink-0 overflow-hidden flex items-center justify-center"
          style={{ height: `${layout.sparklineRowHeightInPx}px` }}
        >
          <div className="relative" dir="ltr">
            {showSpanLabels && spanLabels ? (
              <span
                data-testid={SPARKLINE_START_LABEL_TEST_ID}
                className="pointer-events-none absolute right-full top-1/2 mr-1.5 -translate-y-1/2 whitespace-nowrap leading-none tabular-nums text-gray-500"
                style={{ fontSize: `${SPAN_LABEL_FONT_SIZE_IN_PX}px` }}
              >
                {spanLabels.start}
              </span>
            ) : (
              <></>
            )}
            <Sparkline
              data={sparklineData}
              width={layout.sparklineWidthInPx}
              height={layout.sparklineHeightInPx}
              color={sparklineColor}
              fillColor={sparklineFill}
              onHoverIndex={handleHoverIndex}
              onTimeRangeSelect={props.onTimeRangeSelect}
              onTimeRangeReset={props.onTimeRangeReset}
            />
            {showSpanLabels && spanLabels ? (
              <span
                data-testid={SPARKLINE_END_LABEL_TEST_ID}
                className="pointer-events-none absolute left-full top-1/2 ml-1.5 -translate-y-1/2 whitespace-nowrap leading-none tabular-nums text-gray-500"
                style={{ fontSize: `${SPAN_LABEL_FONT_SIZE_IN_PX}px` }}
              >
                {spanLabels.end}
              </span>
            ) : (
              <></>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ValueWidgetView;
