import { LineChart } from "../ChartLibrary/LineChart/LineChart";
import {
  AvailableChartColorsKeys,
  ChartColorValue,
} from "../ChartLibrary/Utils/ChartColors";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
} from "react";
import SeriesPoint from "../Types/SeriesPoints";
import { XAxis } from "../Types/XAxis/XAxis";
import YAxis from "../Types/YAxis/YAxis";
import ChartCurve from "../Types/ChartCurve";
import ChartDataPoint, {
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../ChartLibrary/Types/ChartDataPoint";
import FormattedExemplarPoint from "../ChartLibrary/Types/FormattedExemplarPoint";
import FormattedReferenceRegion from "../ChartLibrary/Types/FormattedReferenceRegion";
import FormattedTimeReferenceLine from "../ChartLibrary/Types/FormattedTimeReferenceLine";
import DataPointUtil from "../Utils/DataPoint";
import TimeAnnotationUtil from "../Utils/TimeAnnotation";
import ChartReferenceLineProps, {
  ReferenceLineLabelPlacement,
} from "../Types/ReferenceLineProps";
import ReferenceLineLegend from "../ReferenceLineLegend/ReferenceLineLegend";
import ChartReferenceRegionProps from "../Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "../Types/TimeReferenceLineProps";
import ExemplarPoint from "../Types/ExemplarPoint";
import XAxisUtil from "../Utils/XAxis";
import XAxisType from "../Types/XAxis/XAxisType";
import NoDataMessage from "../ChartGroup/NoDataMessage";
import {
  ChartTimeRangeZoomContextValue,
  ChartTimeRangeZoomHandlers,
  resolveChartTimeRangeZoom,
  useChartTimeRangeZoom,
} from "../TimeRangeZoom/TimeRangeZoomContext";

export const LineChartPalette: Array<AvailableChartColorsKeys> = [
  "indigo",
  "rose",
  "emerald",
  "amber",
  "cyan",
  "gray",
  "pink",
  "lime",
  "fuchsia",
];

export interface ComponentProps {
  data: Array<SeriesPoint>;
  xAxis: XAxis;
  yAxis: YAxis;
  curve: ChartCurve;
  sync: boolean;
  heightInPx?: number | undefined;
  referenceLines?: Array<ChartReferenceLineProps> | undefined;
  /*
   * Where the reference lines' labels are written: at the right end of each
   * line (OnLine, the default) or in a legend under the chart (Legend), off
   * the series and the time axis. A chart that names its lines in a legend
   * needs a heightInPx: the legend goes under that height, not into it.
   */
  referenceLineLabelPlacement?: ReferenceLineLabelPlacement | undefined;
  /*
   * The legend's entries centred under the plot, for a chart whose title
   * and status are centred above and below it (a dashboard's SLO widget).
   * Unset, they start the line, under a card's own title.
   */
  isReferenceLineLegendCentered?: boolean | undefined;
  /*
   * Time-anchored annotations: vertical event markers and shaded regions.
   * Dates are snapped onto the categorical x-axis buckets; annotations
   * outside the charted window are dropped (regions clamp to the edge).
   */
  timeReferenceLines?: Array<ChartTimeReferenceLineProps> | undefined;
  referenceRegions?: Array<ChartReferenceRegionProps> | undefined;
  exemplarPoints?: Array<ExemplarPoint> | undefined;
  onExemplarClick?: ((exemplar: ExemplarPoint) => void) | undefined;
  /*
   * When provided, the chart supports drag-to-select: dragging across
   * buckets calls back with the [start, end) of the selected time range.
   * Left unset, the chart zooms the enclosing page instead, when the page
   * offers that (TimeRangeZoomScope).
   */
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  /*
   * Double-click on the plot: undoes whatever drag-to-select produced.
   * Supply it only when a reset is actually possible — see ChartLibrary
   * onTimeRangeReset for why an idle handler costs click latency.
   */
  onTimeRangeReset?: (() => void) | undefined;
  /*
   * Keeps this chart out of drag-to-zoom altogether, including the page's:
   * for a chart whose window is not the page's time range.
   */
  disableTimeRangeZoom?: boolean | undefined;
  // Plain click on a bucket — see ChartLibrary onBucketClick.
  onBucketClick?:
    | ((
        bucketStart: Date,
        bucketEnd: Date,
        valuesAtBucket: Record<string, number | string>,
      ) => void)
    | undefined;
  /*
   * Series rendered as compare-to-previous-period ghosts (dashed, faded,
   * dotless). Names must exist in `data`.
   */
  ghostSeriesNames?: Array<string> | undefined;
  showLegend?: boolean | undefined;
  /*
   * Optional per-series color override (named palette keys or hex strings).
   * When provided, replaces the default LineChartPalette. Indexed by series
   * position (index % length).
   */
  colors?: Array<ChartColorValue> | undefined;
  /*
   * false keeps the y-axis ticks on whole numbers, for a series that counts
   * things (connections, nodes): otherwise 0-2 ticks as 0 | 0.5 | 1 | 1.5.
   * Unset, the axis picks decimal ticks as it always has.
   */
  allowDecimals?: boolean | undefined;
  /*
   * false breaks the line where a series has no point, instead of joining
   * across the gap: for a series whose missing points mean "unknown", such
   * as an availability chart's "not monitored" stretch, where a joined line
   * would claim the value it held before carried on. Unset, lines join
   * across missing points as they always have.
   */
  connectNulls?: boolean | undefined;
  /*
   * true keeps the plot as tall as heightInPx gives it when the legend
   * wraps onto more lines than one: the chart grows by those lines, instead
   * of taking them from the plot. Three long series names on a phone took a
   * 176px card chart's plot from 78px down to 30px (Product Analytics'
   * Active users). Unset, the legend's lines come out of heightInPx, for a
   * chart that has to fit a box of its own size (a dashboard widget).
   */
  growsWhenLegendWraps?: boolean | undefined;
}

export interface LineInternalProps extends ComponentProps {
  syncid: string;
}

const LineChartElement: FunctionComponent<LineInternalProps> = (
  props: LineInternalProps,
): ReactElement => {
  const [records, setRecords] = React.useState<Array<ChartDataPoint>>([]);
  /*
   * How much taller than one line the legend is, as the chart last measured
   * it: the height the chart grows by when growsWhenLegendWraps is on.
   */
  const [legendExtraRowsHeight, setLegendExtraRowsHeight] =
    React.useState<number>(0);
  const isGrownByLegend: boolean = Boolean(
    props.growsWhenLegendWraps && props.showLegend !== false,
  );
  const chartHeightInPx: number | undefined = props.heightInPx
    ? props.heightInPx + (isGrownByLegend ? legendExtraRowsHeight : 0)
    : undefined;

  /*
   * Drag-to-zoom: the host's own handlers, or else the enclosing page's
   * (TimeRangeZoomScope), so a drag here retimes every chart on the page.
   */
  const pageZoom: ChartTimeRangeZoomContextValue | null =
    useChartTimeRangeZoom();
  const timeRangeZoom: ChartTimeRangeZoomHandlers = resolveChartTimeRangeZoom({
    onTimeRangeSelect: props.onTimeRangeSelect,
    onTimeRangeReset: props.onTimeRangeReset,
    isTimeAxis:
      props.xAxis.options.type === XAxisType.Time ||
      props.xAxis.options.type === XAxisType.Date,
    disableTimeRangeZoom: props.disableTimeRangeZoom,
    pageZoom: pageZoom,
  });

  const categories: Array<string> = props.data.map((item: SeriesPoint) => {
    return item.seriesName;
  });

  useEffect(() => {
    const records: Array<ChartDataPoint> = DataPointUtil.getChartDataPoints({
      seriesPoints: props.data || [],
      xAxis: props.xAxis,
      yAxis: props.yAxis,
    });

    setRecords(records);
  }, [props.data]);

  // Format exemplar x values to match the chart's x-axis labels
  const formattedExemplars: Array<FormattedExemplarPoint> = useMemo(() => {
    if (!props.exemplarPoints || props.exemplarPoints.length === 0) {
      return [];
    }

    const formatter: (value: Date) => string = XAxisUtil.getFormatter({
      xAxisMax: props.xAxis.options.max,
      xAxisMin: props.xAxis.options.min,
      /*
       * Exemplars are placed by label with no index fallback, so they have
       * to be formatted at the axis's own grid step — a pinned axis
       * labelled at a different precision would put every exemplar on a
       * category that does not exist, and they would silently vanish.
       */
      precision: props.xAxis.options.precision,
    });

    return props.exemplarPoints.map((exemplar: ExemplarPoint) => {
      return {
        formattedX: formatter(exemplar.x),
        y: exemplar.y,
        original: exemplar,
      };
    });
  }, [props.exemplarPoints, props.xAxis]);

  // Snap time annotations onto the categorical x-axis bucket labels
  const formattedTimeReferenceLines: Array<FormattedTimeReferenceLine> =
    useMemo(() => {
      if (!props.timeReferenceLines || props.timeReferenceLines.length === 0) {
        return [];
      }
      return TimeAnnotationUtil.formatTimeReferenceLines({
        timeReferenceLines: props.timeReferenceLines,
        xAxis: props.xAxis,
        // Same series the rows were built from — keeps marker indexes aligned.
        seriesPoints: props.data || [],
      });
    }, [props.timeReferenceLines, props.xAxis, props.data]);

  const formattedReferenceRegions: Array<FormattedReferenceRegion> =
    useMemo(() => {
      if (!props.referenceRegions || props.referenceRegions.length === 0) {
        return [];
      }
      return TimeAnnotationUtil.formatReferenceRegions({
        referenceRegions: props.referenceRegions,
        xAxis: props.xAxis,
        // Same series the rows were built from — keeps region indexes aligned.
        seriesPoints: props.data || [],
      });
    }, [props.referenceRegions, props.xAxis, props.data]);

  const hasNoData: boolean =
    !props.data ||
    props.data.length === 0 ||
    props.data.every((series: SeriesPoint) => {
      return series.data.length === 0;
    });

  /*
   * Translate yAxis.options.min/max into recharts inputs. "auto" maps to
   * autoMinValue=true (or maxValue omitted) so recharts zooms to the
   * data range — important for cumulative counters where the absolute
   * value dwarfs per-bucket variation and a 0-anchored axis flattens
   * the line.
   */
  const yAxisMinOption: number | "auto" = props.yAxis.options.min;
  const yAxisMaxOption: number | "auto" = props.yAxis.options.max;
  const autoMinValue: boolean = yAxisMinOption === "auto";
  const minValueProp: { minValue: number } | Record<string, unknown> =
    typeof yAxisMinOption === "number" ? { minValue: yAxisMinOption } : {};
  const maxValueProp: { maxValue: number } | Record<string, unknown> =
    typeof yAxisMaxOption === "number" ? { maxValue: yAxisMaxOption } : {};

  /*
   * Lines named in the legend under the chart are drawn on the plot without
   * their labels; the legend carries them. A named line always reaches the
   * value axis (extendsDomain), so the legend never names a line that is off
   * the plot: an error budget's "Budget exhausted" at 0% while the budget is
   * still high, or a burn rate rule's 14.4× while the burn is low.
   */
  const hasLabelLegend: boolean =
    props.referenceLineLabelPlacement === ReferenceLineLabelPlacement.Legend &&
    (props.referenceLines || []).some(
      (line: ChartReferenceLineProps): boolean => {
        return Boolean(line.label?.trim());
      },
    );

  const plottedReferenceLines: Array<ChartReferenceLineProps> | undefined =
    hasLabelLegend
      ? (props.referenceLines || []).map(
          (line: ChartReferenceLineProps): ChartReferenceLineProps => {
            return line.label?.trim()
              ? { ...line, label: undefined, extendsDomain: true }
              : { ...line, label: undefined };
          },
        )
      : props.referenceLines;

  const chart: ReactElement = (
    <div
      /*
       * `isolate` opens a stacking context so the recharts tooltip's
       * z-index competes only inside this chart — without it the tooltip
       * (zIndex 10, pinned to the chart's top edge) ties with the app
       * header's sticky z-10 in the root context and paints over the
       * navbar on half-scrolled charts.
       *
       * Over a legend the plot keeps its own height (no flex-1): in the
       * column below, a flex basis would take the place of that height.
       */
      className={
        hasLabelLegend
          ? "relative isolate flex"
          : "relative isolate flex flex-1"
      }
      style={chartHeightInPx ? { height: `${chartHeightInPx}px` } : undefined}
    >
      <LineChart
        data={records}
        tickGap={30}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={categories}
        colors={
          props.colors && props.colors.length > 0
            ? props.colors
            : LineChartPalette
        }
        valueFormatter={props.yAxis.options.formatter || undefined}
        showTooltip={true}
        showLegend={props.showLegend !== false}
        connectNulls={props.connectNulls !== false}
        curve={props.curve}
        syncid={props.sync ? props.syncid : undefined}
        yAxisWidth={64}
        autoMinValue={autoMinValue}
        {...minValueProp}
        {...maxValueProp}
        allowDecimals={props.allowDecimals !== false}
        onValueChange={() => {}}
        referenceLines={plottedReferenceLines}
        formattedTimeReferenceLines={
          formattedTimeReferenceLines.length > 0
            ? formattedTimeReferenceLines
            : undefined
        }
        formattedReferenceRegions={
          formattedReferenceRegions.length > 0
            ? formattedReferenceRegions
            : undefined
        }
        formattedExemplarPoints={
          formattedExemplars.length > 0 ? formattedExemplars : undefined
        }
        onExemplarClick={props.onExemplarClick}
        onTimeRangeSelect={timeRangeZoom.onTimeRangeSelect}
        onTimeRangeReset={timeRangeZoom.onTimeRangeReset}
        onBucketClick={props.onBucketClick}
        ghostCategories={props.ghostSeriesNames}
        // The legend under the plot follows the time axis's labels closely.
        isFollowedByLegend={hasLabelLegend}
        onLegendExtraRowsHeightChange={
          isGrownByLegend ? setLegendExtraRowsHeight : undefined
        }
      />
      {hasNoData && <NoDataMessage />}
    </div>
  );

  if (!hasLabelLegend) {
    return chart;
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {chart}
      <ReferenceLineLegend
        lines={props.referenceLines || []}
        className={
          props.isReferenceLineLegendCentered ? "mt-2 justify-center" : "mt-2"
        }
      />
    </div>
  );
};

export default LineChartElement;
