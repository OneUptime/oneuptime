import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
import BarChartElement from "Common/UI/Components/Charts/Bar/BarChart";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import DataPoint from "Common/UI/Components/Charts/Types/DataPoint";
import {
  XAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import { TimeRangeZoomProvider } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "Common/UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import ResetTimeRangeZoomButton from "Common/UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import {
  AIChatWidget,
  AIChatWidgetPoint,
  AIChatWidgetSeries,
  AIChatWidgetType,
} from "Common/Types/AI/AIChatTypes";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useMemo,
  useState,
} from "react";

export interface ComponentProps {
  widget: AIChatWidget;
}

// The stretch of the chart's own x-axis a drag narrowed it to.
interface ChartZoomWindow {
  startTime: Date;
  endTime: Date;
}

// Compact number formatter: trims trailing zeros, appends an optional unit.
function formatValue(value: number, unit?: string | undefined): string {
  const rounded: number =
    Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  const text: string = rounded.toLocaleString();
  return unit ? `${text} ${unit}` : text;
}

const ChartWidget: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { widget } = props;
  const rawSeries: Array<AIChatWidgetSeries> | undefined = widget.data.series;

  /*
   * Drag-to-zoom narrows THIS chart's own x-axis to the window dragged out,
   * and a double-click (or "Reset zoom") puts the full extent back. It never
   * retimes anything else: the chart is a snapshot of what a tool returned,
   * in a chat panel that floats over whatever page is open (or an evidence
   * row of an incident), and that page's time range has nothing to do with
   * it. Nothing is refetched either - the points the tool returned are all
   * there is - and the widget's data is never touched, so exports and
   * citations keep the full series.
   */
  const [zoomWindow, setZoomWindow] = useState<ChartZoomWindow | null>(null);

  const series: Array<SeriesPoint> = useMemo((): Array<SeriesPoint> => {
    return (rawSeries || []).map((item: AIChatWidgetSeries) => {
      return {
        seriesName: item.name,
        data: item.points
          .filter((point: AIChatWidgetPoint) => {
            return point.y !== null && point.y !== undefined;
          })
          .map((point: AIChatWidgetPoint) => {
            return {
              x: OneUptimeDate.fromString(point.x),
              y: point.y as number,
            };
          }),
      };
    });
  }, [rawSeries]);

  // X range spans every point across every series.
  const allDates: Array<Date> = series.flatMap((s: SeriesPoint) => {
    return s.data.map((point: { x: Date }) => {
      return point.x;
    });
  });

  const hasData: boolean = allDates.length > 0;

  const minDate: Date = hasData
    ? allDates.reduce((a: Date, b: Date) => {
        return a.getTime() < b.getTime() ? a : b;
      })
    : OneUptimeDate.getCurrentDate();
  const maxDate: Date = hasData
    ? allDates.reduce((a: Date, b: Date) => {
        return a.getTime() > b.getTime() ? a : b;
      })
    : OneUptimeDate.getCurrentDate();

  const isBar: boolean = widget.type === AIChatWidgetType.BarChart;

  /*
   * Only a time axis can be zoomed: a window dragged across categories
   * ("top services") is not a time range. A widget that does not say is a
   * time series, the same reading the chat export gives it.
   */
  const isTimeAxis: boolean = widget.data.xIsTime !== false;

  const zoomToTimeRange: (startTime: Date, endTime: Date) => void = useCallback(
    (startTime: Date, endTime: Date): void => {
      const startMs: number = Math.min(startTime.getTime(), endTime.getTime());
      const endMs: number = Math.max(startTime.getTime(), endTime.getTime());

      // A drag that never left its starting bucket is not a window.
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        return;
      }

      if (startMs === endMs) {
        return;
      }

      setZoomWindow({ startTime: new Date(startMs), endTime: new Date(endMs) });
    },
    [],
  );

  const resetZoom: () => void = useCallback((): void => {
    setZoomWindow(null);
  }, []);

  const zoomStartMs: number | null = zoomWindow
    ? zoomWindow.startTime.getTime()
    : null;
  const zoomEndMs: number | null = zoomWindow
    ? zoomWindow.endTime.getTime()
    : null;

  /*
   * The points inside the zoomed window: the buckets the drag covered run
   * from the start of the first to the END of the last, so the window is
   * half-open. A new array whenever the window changes, because the chart
   * only re-buckets its rows when its data changes.
   */
  const visibleSeries: Array<SeriesPoint> = useMemo((): Array<SeriesPoint> => {
    if (zoomStartMs === null || zoomEndMs === null) {
      return series;
    }

    return series.map((item: SeriesPoint): SeriesPoint => {
      return {
        seriesName: item.seriesName,
        data: item.data.filter((point: DataPoint): boolean => {
          const pointMs: number = point.x.getTime();
          return pointMs >= zoomStartMs && pointMs < zoomEndMs;
        }),
      };
    });
  }, [series, zoomStartMs, zoomEndMs]);

  /*
   * The axis spans what the chart draws: the zoomed window, trimmed to the
   * points the tool returned so a drag that ran into the last bucket does
   * not leave an empty stretch past the final point. A window that trims to
   * nothing keeps its own edges.
   */
  let axisStart: Date = minDate;
  let axisEnd: Date = maxDate;

  if (zoomStartMs !== null && zoomEndMs !== null) {
    const trimmedStartMs: number = Math.max(zoomStartMs, minDate.getTime());
    const trimmedEndMs: number = Math.min(zoomEndMs, maxDate.getTime());

    axisStart = new Date(
      trimmedStartMs < trimmedEndMs ? trimmedStartMs : zoomStartMs,
    );
    axisEnd = new Date(
      trimmedStartMs < trimmedEndMs ? trimmedEndMs : zoomEndMs,
    );
  }

  /*
   * The full extent, which is what a reset returns to - named for the
   * "Reset zoom" button. Keyed on the instants so it keeps its identity
   * across renders and the zoom offered below stays stable.
   */
  const minDateMs: number = minDate.getTime();
  const maxDateMs: number = maxDate.getTime();
  const fullRange: RangeStartAndEndDateTime =
    useMemo((): RangeStartAndEndDateTime => {
      return {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date(minDateMs),
          new Date(maxDateMs),
        ),
      };
    }, [minDateMs, maxDateMs]);

  const isZoomed: boolean = zoomWindow !== null;

  /*
   * This chart's own zoom, offered to what is inside it (the hint and the
   * "Reset zoom" button read it). It also shadows any zoom the page behind
   * the chat offers, so nothing in here can retime that page. A categorical
   * chart offers none and withdraws the page's too.
   */
  const ownZoom: TimeRangeZoom | null = useMemo((): TimeRangeZoom | null => {
    if (!isTimeAxis) {
      return null;
    }

    return {
      isZoomed: isZoomed,
      rangeBeforeZoom: isZoomed ? fullRange : null,
      zoomToTimeRange: zoomToTimeRange,
      resetZoom: resetZoom,
    };
  }, [isTimeAxis, isZoomed, fullRange, zoomToTimeRange, resetZoom]);

  const xAxis: XAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: axisStart,
      max: axisEnd,
      // Bars count events (Sum within a bucket); lines average a metric.
      aggregateType: isBar
        ? XAxisAggregateType.Sum
        : XAxisAggregateType.Average,
    },
  };

  const yAxis: YAxis = {
    legend: widget.data.valueLabel || widget.data.unit || "",
    options: {
      type: YAxisType.Number,
      min: isBar ? 0 : "auto",
      max: "auto",
      formatter: (value: number) => {
        return formatValue(value, widget.data.unit);
      },
      precision: YAxisPrecision.TwoDecimals,
    },
  };

  if (!hasData) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-gray-400">
        No data points in this range.
      </div>
    );
  }

  /*
   * The handlers go to the chart explicitly as well, so the chart zooms
   * itself even if it is ever rendered outside the provider below. The
   * reset only while zoomed: the chart holds every plain click open for a
   * moment while it has one, to tell it apart from a double-click.
   */
  const onTimeRangeSelect:
    | ((startTime: Date, endTime: Date) => void)
    | undefined = isTimeAxis ? zoomToTimeRange : undefined;
  const onTimeRangeReset: (() => void) | undefined =
    isTimeAxis && isZoomed ? resetZoom : undefined;

  return (
    <TimeRangeZoomProvider zoom={ownZoom}>
      <div className="group/zoomhint w-full">
        {isTimeAxis ? (
          <div className="flex h-6 items-center justify-end gap-2">
            <TimeRangeZoomHint revealOnHover={true} />
            <ResetTimeRangeZoomButton />
          </div>
        ) : null}
        <div className="h-64 w-full">
          {isBar ? (
            <BarChartElement
              data={visibleSeries}
              xAxis={xAxis}
              yAxis={yAxis}
              sync={false}
              syncid={widget.id}
              heightInPx={240}
              showLegend={series.length > 1}
              onTimeRangeSelect={onTimeRangeSelect}
              onTimeRangeReset={onTimeRangeReset}
              disableTimeRangeZoom={!isTimeAxis}
            />
          ) : (
            <LineChartElement
              data={visibleSeries}
              xAxis={xAxis}
              yAxis={yAxis}
              curve={ChartCurve.MONOTONE}
              sync={false}
              syncid={widget.id}
              heightInPx={240}
              showLegend={series.length > 1}
              onTimeRangeSelect={onTimeRangeSelect}
              onTimeRangeReset={onTimeRangeReset}
              disableTimeRangeZoom={!isTimeAxis}
            />
          )}
        </div>
      </div>
    </TimeRangeZoomProvider>
  );
};

export default ChartWidget;
