import React, { FunctionComponent, ReactElement } from "react";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
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
import {
  ChartTimeRangeZoomContextValue,
  useChartTimeRangeZoom,
} from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import {
  CostTrendPoint,
  CostZoomWindow,
  formatCost,
  getCostZoomWindow,
} from "../Utils/KubernetesCostUtils";
import { noCostDataMessage } from "../Utils/KubernetesCostTableCells";

const CHART_HEIGHT_IN_PX: number = 300;

export interface ComponentProps {
  trend: Array<CostTrendPoint>;
  isLoading: boolean;
  /*
   * Why the page's cost load failed, if it did. It is shown where the chart
   * was, so the card around the chart - its picker, Reset zoom and Refresh -
   * stays: a load that a zoom set off can fail too, and must not take the
   * way back with it.
   */
  error?: string | undefined;
  // Loads the page's window again; offered beside the error.
  onRetry?: (() => void) | undefined;
  // The window the page is showing; the chart's x-axis is pinned to it.
  startAndEndDate: InBetween<Date>;
  syncid: string;
}

/*
 * The spend-over-time chart of the cluster and project Costs pages.
 *
 * A drag across it zooms the page (issue #4105): the tiles and tables
 * under it follow, since they are all read for the page's window. The
 * page's zoom is taken from its TimeRangeZoomScope, with two changes (see
 * getCostZoomWindow): a selection narrower than an hour is widened to one
 * first, because cost rows are hourly and a narrower window would usually
 * hold none of them; and the zoom ends a millisecond before the last
 * bucket does, because the cost queries also count a row that starts
 * exactly at a window's end.
 */
const KubernetesCostTrendChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const pageZoom: ChartTimeRangeZoomContextValue | null =
    useChartTimeRangeZoom();

  const onTimeRangeSelect:
    | ((startTime: Date, endTime: Date) => void)
    | undefined = pageZoom
    ? (startTime: Date, endTime: Date): void => {
        const zoomWindow: CostZoomWindow = getCostZoomWindow({
          startTime: startTime,
          endTime: endTime,
          windowStart: props.startAndEndDate.startValue,
          windowEnd: props.startAndEndDate.endValue,
        });
        pageZoom.onTimeRangeSelect(zoomWindow.startTime, zoomWindow.endTime);
      }
    : undefined;

  const getContent: () => ReactElement = (): ReactElement => {
    /*
     * Every zoom, reset and refresh reloads the page, and the skeleton
     * stands in for the chart meanwhile: at the chart's own height, or
     * the tables below would jump up and back down on every one of them.
     */
    if (props.isLoading) {
      return (
        <div
          data-testid="chart-loading-skeleton"
          className="animate-pulse rounded-md bg-gray-50"
          style={{ height: `${CHART_HEIGHT_IN_PX}px` }}
        />
      );
    }

    /*
     * A zoom into a stretch with no cost rows, or one whose load failed,
     * lands on a message with no chart left to double-click. The message
     * takes the double-click instead, so the way back is where the
     * reader's pointer already is - select-none, or that double-click
     * would also select a word of it.
     */
    if (props.error) {
      return (
        <div className="select-none" onDoubleClick={pageZoom?.onTimeRangeReset}>
          <ErrorMessage message={props.error} onRefreshClick={props.onRetry} />
        </div>
      );
    }

    if (props.trend.length === 0) {
      return (
        <div className="select-none" onDoubleClick={pageZoom?.onTimeRangeReset}>
          <ErrorMessage message={noCostDataMessage} />
        </div>
      );
    }

    const series: Array<SeriesPoint> = [
      {
        seriesName: "Total Cost",
        data: props.trend,
      },
    ];

    const xAxis: ChartXAxis = {
      legend: "Time",
      options: {
        type: XAxisType.Time,
        min: props.startAndEndDate.startValue,
        max: props.startAndEndDate.endValue,
        aggregateType: XAxisAggregateType.Sum,
      },
    };

    const yAxis: YAxis = {
      legend: "Cost",
      options: {
        type: YAxisType.Number,
        min: 0,
        max: "auto",
        precision: YAxisPrecision.TwoDecimals,
        formatter: (value: number): string => {
          return formatCost(value);
        },
      },
    };

    return (
      <LineChartElement
        data={series}
        xAxis={xAxis}
        yAxis={yAxis}
        curve={ChartCurve.MONOTONE}
        heightInPx={CHART_HEIGHT_IN_PX}
        showLegend={false}
        sync={false}
        syncid={props.syncid}
        onTimeRangeSelect={onTimeRangeSelect}
        onTimeRangeReset={pageZoom?.onTimeRangeReset}
      />
    );
  };

  return (
    <div className="group/zoomhint">
      {/*
       * The chart has no header of its own to name the drag in, so the
       * hint gets a slim row above it, revealed on hover.
       */}
      <div className="mb-1 flex justify-end">
        <TimeRangeZoomHint revealOnHover={true} className="leading-3" />
      </div>
      {getContent()}
    </div>
  );
};

export default KubernetesCostTrendChart;
