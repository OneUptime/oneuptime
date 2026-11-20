import { AreaChart } from "../ChartLibrary/AreaChart/AreaChart";
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
import YAxis, { OwnScaleYAxis, SecondYAxis } from "../Types/YAxis/YAxis";
import ChartCurve from "../Types/ChartCurve";
import ChartDataPoint, {
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../ChartLibrary/Types/ChartDataPoint";
import FormattedExemplarPoint from "../ChartLibrary/Types/FormattedExemplarPoint";
import FormattedReferenceRegion from "../ChartLibrary/Types/FormattedReferenceRegion";
import FormattedTimeReferenceLine from "../ChartLibrary/Types/FormattedTimeReferenceLine";
import DataPointUtil from "../Utils/DataPoint";
import TimeAnnotationUtil from "../Utils/TimeAnnotation";
import ChartReferenceLineProps from "../Types/ReferenceLineProps";
import ChartReferenceRegionProps from "../Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "../Types/TimeReferenceLineProps";
import ExemplarPoint from "../Types/ExemplarPoint";
import XAxisUtil from "../Utils/XAxis";
import XAxisType from "../Types/XAxis/XAxisType";
import { getTimeAxisTickInterval } from "../Utils/TimeAxisTicks";
import NoDataMessage from "../ChartGroup/NoDataMessage";
import { ChartValueAxes, getChartValueAxes } from "../Utils/ValueAxes";
import Dictionary from "../../../../Types/Dictionary";
import {
  ChartTimeRangeZoomContextValue,
  ChartTimeRangeZoomHandlers,
  resolveChartTimeRangeZoom,
  useChartTimeRangeZoom,
} from "../TimeRangeZoom/TimeRangeZoomContext";

export const AreaChartPalette: Array<AvailableChartColorsKeys> = [
  "blue",
  "emerald",
  "violet",
  "amber",
  "cyan",
  "pink",
  "lime",
  "fuchsia",
  "indigo",
  "rose",
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
        /*
         * A series' value as the tooltip writes it, by the name it is drawn
         * with: to the figures its axis's ticks are written with (#10079).
         */
        formatValue?: (seriesName: string, value: number) => string,
      ) => void)
    | undefined;
  /*
   * Series rendered as compare-to-previous-period ghosts (dashed, faded,
   * dotless). Names must exist in `data`.
   */
  ghostSeriesNames?: Array<string> | undefined;
  showLegend?: boolean | undefined;
  /**
   * Render a shaded "expected range" band underneath the plotted lines.
   * The caller passes two series in `data` carrying the lower and upper
   * bounds; both must share the same x-axis as the data series. Their
   * seriesNames are passed here so the renderer can promote them to a
   * band fill and exclude them from the regular line categories.
   */
  anomalyBandLowerSeriesName?: string | undefined;
  anomalyBandUpperSeriesName?: string | undefined;
  /*
   * Optional per-series color override (named palette keys or hex strings).
   * When provided, replaces the default AreaChartPalette. Indexed by series
   * position (index % length).
   */
  colors?: Array<ChartColorValue> | undefined;
  /*
   * A second value axis, on the right, for the series it names (issue
   * #10042): bytes overlaid on a chart in percent. Each axis is as wide as
   * its own ticks, and the tooltip writes a series' values as its axis does.
   */
  secondYAxis?: SecondYAxis | undefined;
  /*
   * Scales of their own, with no axis drawn, for the series each names
   * (issue #10080): an overlaid query in a unit neither axis can say. Each
   * series' line keeps its shape, the axes keep theirs, and the tooltip
   * writes its values with its scale's formatter.
   */
  ownScaleYAxes?: Array<OwnScaleYAxis> | undefined;
  /*
   * How the tooltip writes a series' values, by its name, for a series whose
   * unit is neither axis's. Left out, a series' values are written as the
   * axis it is drawn against writes its ticks.
   */
  seriesValueFormatters?: Dictionary<(value: number) => string> | undefined;
}

export interface AreaInternalProps extends ComponentProps {
  syncid: string;
}

const AreaChartElement: FunctionComponent<AreaInternalProps> = (
  props: AreaInternalProps,
): ReactElement => {
  const [records, setRecords] = React.useState<Array<ChartDataPoint>>([]);

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

  const bandLower: string | undefined = props.anomalyBandLowerSeriesName;
  const bandUpper: string | undefined = props.anomalyBandUpperSeriesName;

  /*
   * The band's lower/upper series share the data array but should not
   * be drawn as standalone lines in the legend — recharts renders them
   * as the shaded fill instead.
   */
  const categories: Array<string> = props.data
    .map((item: SeriesPoint) => {
      return item.seriesName;
    })
    .filter((name: string) => {
      return name !== bandLower && name !== bandUpper;
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

  /*
   * The value axis is as wide as the widest tick it draws, and never under
   * the 64 pixels it always had: a tick too wide for it broke over two
   * lines and was cut at the card's edge (YAxisWidth, #8049). A second axis
   * is measured over its own series, and the first over the rest.
   */
  const valueAxes: ChartValueAxes = useMemo(() => {
    return getChartValueAxes({
      data: props.data,
      yAxis: props.yAxis,
      secondYAxis: props.secondYAxis,
      ownScaleYAxes: props.ownScaleYAxes,
    });
  }, [props.data, props.yAxis, props.secondYAxis, props.ownScaleYAxes]);
  const yAxisWidthInPx: number = valueAxes.firstYAxisWidthInPx;

  const hasNoData: boolean =
    !props.data ||
    props.data.length === 0 ||
    props.data.every((series: SeriesPoint) => {
      return series.data.length === 0;
    });

  /*
   * Translate yAxis.options.min/max into recharts inputs. "auto" maps to
   * autoMinValue=true (or maxValue omitted) so recharts zooms to the
   * data range instead of pinning the floor at 0.
   */
  const yAxisMinOption: number | "auto" = props.yAxis.options.min;
  const yAxisMaxOption: number | "auto" = props.yAxis.options.max;
  const autoMinValue: boolean = yAxisMinOption === "auto";
  const minValueProp: { minValue: number } | Record<string, never> =
    typeof yAxisMinOption === "number" ? { minValue: yAxisMinOption } : {};
  const maxValueProp: { maxValue: number } | Record<string, never> =
    typeof yAxisMaxOption === "number" ? { maxValue: yAxisMaxOption } : {};

  return (
    <div
      /*
       * `isolate` opens a stacking context so the recharts tooltip's
       * z-index competes only inside this chart — without it the tooltip
       * (zIndex 10, pinned to the chart's top edge) ties with the app
       * header's sticky z-10 in the root context and paints over the
       * navbar on half-scrolled charts.
       */
      className="relative isolate flex flex-1"
      style={props.heightInPx ? { height: `${props.heightInPx}px` } : undefined}
    >
      <AreaChart
        data={records}
        tickGap={30}
        // A day axis labels its first and last day (TimeAxisTicks, #7126).
        intervalType={getTimeAxisTickInterval(props.xAxis)}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={categories}
        colors={
          props.colors && props.colors.length > 0
            ? props.colors
            : AreaChartPalette
        }
        valueFormatter={props.yAxis.options.formatter || undefined}
        showTooltip={true}
        showLegend={props.showLegend !== false}
        connectNulls={true}
        curve={props.curve || ChartCurve.MONOTONE}
        syncid={props.sync ? props.syncid : undefined}
        yAxisWidth={yAxisWidthInPx}
        autoMinValue={autoMinValue}
        {...minValueProp}
        {...maxValueProp}
        onValueChange={() => {}}
        referenceLines={props.referenceLines}
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
        anomalyBandLowerKey={bandLower}
        anomalyBandUpperKey={bandUpper}
        secondYAxis={valueAxes.secondYAxis}
        ownScales={valueAxes.ownScales}
        categoryValueFormatters={props.seriesValueFormatters}
      />
      {hasNoData && <NoDataMessage />}
    </div>
  );
};

export default AreaChartElement;
