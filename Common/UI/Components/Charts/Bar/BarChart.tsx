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
import ChartDataPoint from "../ChartLibrary/Types/ChartDataPoint";
import FormattedReferenceRegion from "../ChartLibrary/Types/FormattedReferenceRegion";
import FormattedTimeReferenceLine from "../ChartLibrary/Types/FormattedTimeReferenceLine";
import DataPointUtil from "../Utils/DataPoint";
import TimeAnnotationUtil from "../Utils/TimeAnnotation";
import ChartReferenceLineProps from "../Types/ReferenceLineProps";
import ChartReferenceRegionProps from "../Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "../Types/TimeReferenceLineProps";
import NoDataMessage from "../ChartGroup/NoDataMessage";

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
}

export interface BarInternalProps extends ComponentProps {
  syncid: string;
}

const BarChartElement: FunctionComponent<BarInternalProps> = (
  props: BarInternalProps,
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

  return (
    <div
      className="relative flex flex-1"
      style={props.heightInPx ? { height: `${props.heightInPx}px` } : undefined}
    >
      <BarChart
        data={records}
        tickGap={30}
        index={"Time"}
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
      />
      {hasNoData && <NoDataMessage />}
    </div>
  );
};

export default BarChartElement;
