import { BarChart } from "../ChartLibrary/BarChart/BarChart";
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
import ChartDataPoint, {
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../ChartLibrary/Types/ChartDataPoint";
import FormattedReferenceRegion from "../ChartLibrary/Types/FormattedReferenceRegion";
import FormattedTimeReferenceLine from "../ChartLibrary/Types/FormattedTimeReferenceLine";
import DataPointUtil from "../Utils/DataPoint";
import TimeAnnotationUtil from "../Utils/TimeAnnotation";
import ChartReferenceLineProps from "../Types/ReferenceLineProps";
import ChartReferenceRegionProps from "../Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "../Types/TimeReferenceLineProps";
import XAxisType from "../Types/XAxis/XAxisType";
import NoDataMessage from "../ChartGroup/NoDataMessage";
import {
  ChartTimeRangeZoomContextValue,
  ChartTimeRangeZoomHandlers,
  resolveChartTimeRangeZoom,
  useChartTimeRangeZoom,
} from "../TimeRangeZoom/TimeRangeZoomContext";

export const BarChartPalette: Array<AvailableChartColorsKeys> = [
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
  showLegend?: boolean | undefined;
  /*
   * Optional per-series color override. Each entry may be a named palette key
   * or a raw hex string. When provided (and non-empty), it replaces the
   * default BarChartPalette so callers can assign custom colors; the array is
   * indexed by series position (index % length), matching the default palette.
   */
  colors?: Array<ChartColorValue> | undefined;
  /*
   * When provided, the chart supports drag-to-select: dragging across bars
   * calls back with the [start, end) of the time they cover. Left unset,
   * the chart zooms the enclosing page instead, when the page offers that
   * (TimeRangeZoomScope).
   */
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  /*
   * Double-click on the plot: undoes whatever drag-to-select produced, on
   * this chart or a neighbouring one. Supply it only when a reset is
   * actually possible.
   */
  onTimeRangeReset?: (() => void) | undefined;
  /*
   * Keeps this chart out of drag-to-zoom altogether, including the page's:
   * for a chart whose window is not the page's time range.
   */
  disableTimeRangeZoom?: boolean | undefined;
}

export interface BarInternalProps extends ComponentProps {
  syncid: string;
}

const BarChartElement: FunctionComponent<BarInternalProps> = (
  props: BarInternalProps,
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
      <BarChart
        data={records}
        tickGap={30}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={categories}
        colors={
          props.colors && props.colors.length > 0
            ? props.colors
            : BarChartPalette
        }
        valueFormatter={props.yAxis.options.formatter || undefined}
        showTooltip={true}
        showLegend={props.showLegend !== false}
        yAxisWidth={64}
        syncid={props.sync ? props.syncid : undefined}
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
        onTimeRangeSelect={timeRangeZoom.onTimeRangeSelect}
        onTimeRangeReset={timeRangeZoom.onTimeRangeReset}
      />
      {hasNoData && <NoDataMessage />}
    </div>
  );
};

export default BarChartElement;
