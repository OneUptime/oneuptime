import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import {
  ChartTimeRangeZoomContextValue,
  useChartTimeRangeZoom,
} from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";

export type ChartCardColor =
  | "blue"
  | "violet"
  | "amber"
  | "emerald"
  | "sky"
  | "rose";

const colorClasses: Record<
  ChartCardColor,
  { bg: string; ring: string; text: string }
> = {
  blue: { bg: "bg-blue-50", ring: "ring-blue-200", text: "text-blue-600" },
  violet: {
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    text: "text-violet-600",
  },
  amber: { bg: "bg-amber-50", ring: "ring-amber-200", text: "text-amber-600" },
  emerald: {
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    text: "text-emerald-600",
  },
  sky: { bg: "bg-sky-50", ring: "ring-sky-200", text: "text-sky-600" },
  rose: { bg: "bg-rose-50", ring: "ring-rose-200", text: "text-rose-600" },
};

export interface ChartCardProps {
  title: string;
  icon: IconProp;
  iconColor: ChartCardColor;
  series: Array<SeriesPoint>;
  windowStart: Date | null;
  windowEnd: Date | null;
  syncId: string;
  yLegend?: string | undefined;
  yMax?: number | "auto" | undefined;
  yFormatter?: ((value: number) => string) | undefined;
  /*
   * false keeps the y ticks on whole numbers (a count of connections or
   * nodes); unset, the axis may pick decimal ticks as it always has.
   */
  yAllowDecimals?: boolean | undefined;
  showLegend?: boolean | undefined;
  loading?: boolean | undefined;
  // What the chart plots, shown in an (i) tooltip beside the title.
  description?: string | undefined;
}

const ChartCard: FunctionComponent<ChartCardProps> = (
  props: ChartCardProps,
): ReactElement => {
  const colors: { bg: string; ring: string; text: string } =
    colorClasses[props.iconColor];
  // The page's drag-to-zoom (TimeRangeZoomScope), which the chart takes.
  const pageZoom: ChartTimeRangeZoomContextValue | null =
    useChartTimeRangeZoom();

  const hasData: boolean = props.series.some((s: SeriesPoint): boolean => {
    return s.data.length > 0;
  });

  const isSkeletonShown: boolean = Boolean(
    props.loading || !props.windowStart || !props.windowEnd,
  );

  // A reset the empty box below takes, set only while the page is zoomed.
  const emptyStateReset: (() => void) | undefined = pageZoom?.onTimeRangeReset;

  /*
   * Name a gesture only where the body takes one: the chart takes the drag
   * (and the double-click while zoomed), and the empty box takes the
   * double-click while zoomed. The skeleton takes neither, and nor does the
   * empty box with nothing to reset. The icon beside the hint sets the
   * header's height, so the hint can come and go without moving anything.
   */
  const isZoomHintShown: boolean =
    !isSkeletonShown && (hasData || Boolean(emptyStateReset));

  const header: ReactElement = (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex min-w-0 items-center gap-1">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          {props.title}
        </span>
        <InfoTooltip label={props.title} text={props.description} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {isZoomHintShown ? <TimeRangeZoomHint revealOnHover={true} /> : <></>}
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-md ${colors.bg} ring-1 ring-inset ${colors.ring}`}
        >
          <Icon icon={props.icon} className={`h-3.5 w-3.5 ${colors.text}`} />
        </div>
      </div>
    </div>
  );

  if (isSkeletonShown || !props.windowStart || !props.windowEnd) {
    return (
      <div className="group/zoomhint rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        {header}
        <div className="h-44 animate-pulse rounded-md bg-gray-50" />
      </div>
    );
  }

  if (!hasData) {
    /*
     * A zoom into a quiet stretch lands here, with no chart to
     * double-click. The empty plot area takes the double-click instead, so
     * the way back is where the reader's pointer already is. While it does,
     * its text is not selectable: a double-click on text also selects a
     * word, and the hosts keep this very box on screen through the refetch
     * a reset starts (and for good if the page's own range is quiet too),
     * so the word stayed highlighted.
     */
    return (
      <div className="group/zoomhint rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        {header}
        <div
          className={`flex h-44 items-center justify-center rounded-md bg-gray-50 text-sm text-gray-400${
            emptyStateReset ? " select-none" : ""
          }`}
          onDoubleClick={emptyStateReset}
        >
          No data in this time range
        </div>
      </div>
    );
  }

  const xAxis: ChartXAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: props.windowStart,
      max: props.windowEnd,
      aggregateType: XAxisAggregateType.Average,
    },
  };

  const yAxis: YAxis = {
    legend: props.yLegend ?? "",
    options: {
      type: YAxisType.Number,
      min: 0,
      max: props.yMax ?? "auto",
      precision: YAxisPrecision.NoDecimals,
      formatter: props.yFormatter
        ? (value: number): string => {
            return props.yFormatter!(value);
          }
        : (value: number): string => {
            return String(Math.round(value));
          },
    },
  };

  return (
    <div className="group/zoomhint rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {header}
      <LineChartElement
        data={props.series}
        xAxis={xAxis}
        yAxis={yAxis}
        curve={ChartCurve.MONOTONE}
        sync={true}
        syncid={props.syncId}
        heightInPx={176}
        showLegend={props.showLegend ?? false}
        allowDecimals={props.yAllowDecimals}
      />
    </div>
  );
};

export default ChartCard;
