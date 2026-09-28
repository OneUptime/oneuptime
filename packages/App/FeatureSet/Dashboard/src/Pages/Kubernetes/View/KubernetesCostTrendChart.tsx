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
  widenCostZoomWindow,
} from "../Utils/KubernetesCostUtils";
import { noCostDataMessage } from "../Utils/KubernetesCostTableCells";

export interface ComponentProps {
  trend: Array<CostTrendPoint>;
  isLoading: boolean;
  // The window the page is showing; the chart's x-axis is pinned to it.
  startAndEndDate: InBetween<Date>;
  syncid: string;
}

/*
 * The spend-over-time chart of the cluster and project Costs pages.
 *
 * A drag across it zooms the page (issue #4105): the tiles and tables
 * under it follow, since they are all read for the page's window. The
 * page's zoom is taken from its TimeRangeZoomScope, with one change: a
 * selection narrower than an hour is widened to one first (see
 * widenCostZoomWindow), because cost rows are hourly and a narrower
 * window would usually hold none of them.
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
        const zoomWindow: CostZoomWindow = widenCostZoomWindow({
          startTime: startTime,
          endTime: endTime,
          windowStart: props.startAndEndDate.startValue,
          windowEnd: props.startAndEndDate.endValue,
        });
        pageZoom.onTimeRangeSelect(zoomWindow.startTime, zoomWindow.endTime);
      }
    : undefined;

  const getContent: () => ReactElement = (): ReactElement => {
    if (props.isLoading) {
      return <div className="h-48 animate-pulse rounded-md bg-gray-50" />;
    }

    if (props.trend.length === 0) {
      /*
       * A zoom into a stretch with no cost rows lands here, with no chart
       * left to double-click. The message takes the double-click instead,
       * so the way back is where the reader's pointer already is.
       */
      return (
        <div onDoubleClick={pageZoom?.onTimeRangeReset}>
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
        heightInPx={300}
        showLegend={false}
        sync={false}
        syncid={props.syncid}
        onTimeRangeSelect={onTimeRangeSelect}
        onTimeRangeReset={pageZoom?.onTimeRangeReset}
      />
    );
  };

  return (
    <div className="group">
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
