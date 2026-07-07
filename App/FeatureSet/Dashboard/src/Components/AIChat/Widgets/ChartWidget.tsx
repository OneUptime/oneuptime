import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
import BarChartElement from "Common/UI/Components/Charts/Bar/BarChart";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
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
import {
  AIChatWidget,
  AIChatWidgetPoint,
  AIChatWidgetSeries,
  AIChatWidgetType,
} from "Common/Types/AI/AIChatTypes";
import OneUptimeDate from "Common/Types/Date";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  widget: AIChatWidget;
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
  const rawSeries: Array<AIChatWidgetSeries> = widget.data.series || [];

  const series: Array<SeriesPoint> = rawSeries.map(
    (item: AIChatWidgetSeries) => {
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
    },
  );

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

  const xAxis: XAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: minDate,
      max: maxDate,
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

  return (
    <div className="h-64 w-full">
      {isBar ? (
        <BarChartElement
          data={series}
          xAxis={xAxis}
          yAxis={yAxis}
          sync={false}
          syncid={widget.id}
          heightInPx={240}
          showLegend={series.length > 1}
        />
      ) : (
        <LineChartElement
          data={series}
          xAxis={xAxis}
          yAxis={yAxis}
          curve={ChartCurve.MONOTONE}
          sync={false}
          syncid={widget.id}
          heightInPx={240}
          showLegend={series.length > 1}
        />
      )}
    </div>
  );
};

export default ChartWidget;
