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
import ChartDataPoint from "../ChartLibrary/Types/ChartDataPoint";
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
import NoDataMessage from "../ChartGroup/NoDataMessage";

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
   */
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  showLegend?: boolean | undefined;
  /*
   * Optional per-series color override (named palette keys or hex strings).
   * When provided, replaces the default LineChartPalette. Indexed by series
   * position (index % length).
   */
  colors?: Array<ChartColorValue> | undefined;
}

export interface LineInternalProps extends ComponentProps {
  syncid: string;
}

const LineChartElement: FunctionComponent<LineInternalProps> = (
  props: LineInternalProps,
): ReactElement => {
  const [records, setRecords] = React.useState<Array<ChartDataPoint>>([]);

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
      });
    }, [props.timeReferenceLines, props.xAxis]);

  const formattedReferenceRegions: Array<FormattedReferenceRegion> =
    useMemo(() => {
      if (!props.referenceRegions || props.referenceRegions.length === 0) {
        return [];
      }
      return TimeAnnotationUtil.formatReferenceRegions({
        referenceRegions: props.referenceRegions,
        xAxis: props.xAxis,
      });
    }, [props.referenceRegions, props.xAxis]);

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

  return (
    <div
      className="relative flex flex-1"
      style={props.heightInPx ? { height: `${props.heightInPx}px` } : undefined}
    >
      <LineChart
        data={records}
        tickGap={30}
        index={"Time"}
        categories={categories}
        colors={
          props.colors && props.colors.length > 0
            ? props.colors
            : LineChartPalette
        }
        valueFormatter={props.yAxis.options.formatter || undefined}
        showTooltip={true}
        showLegend={props.showLegend !== false}
        connectNulls={true}
        curve={props.curve}
        syncid={props.sync ? props.syncid : undefined}
        yAxisWidth={64}
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
        onTimeRangeSelect={props.onTimeRangeSelect}
      />
      {hasNoData && <NoDataMessage />}
    </div>
  );
};

export default LineChartElement;
