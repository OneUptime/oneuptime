import BarChartElement from "Common/UI/Components/Charts/Bar/BarChart";
import { ChartColorValue } from "Common/UI/Components/Charts/ChartLibrary/Utils/ChartColors";
import SeriesPoints from "Common/UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "Common/UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import OneUptimeDate from "Common/Types/Date";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { CloudCostPoint } from "./CloudCostReads";
import { formatCloudMoney } from "./CloudCostWords";

/*
 * Each day's spend as a bar: the last 30 days of an estate or an account,
 * on the shared bar chart.
 *
 * A cloud bills by the UTC day. The chart groups its bars by the day on
 * the reader's clock, so each day is handed to it as noon of that day on
 * the reader's clock (toReaderDay): a bar always lands on the day it is
 * labelled with, in any time zone - midnight UTC would be the evening
 * before in New York.
 *
 * A cloud reports a day late and in part, so the newest day it has
 * reported - and any day after it - is not finished: its short bar is not
 * spend that fell. Those days are a series of their own, drawn lighter and
 * named in the legend (Still being reported), in the same place as the
 * rest: the two series are stacked, and a day is in one of them only.
 */

export const DAILY_SPEND_SERIES: string = translationKey("Spend");
export const STILL_BEING_REPORTED_SERIES: string = translationKey(
  "Still being reported",
);
export const DAILY_SPEND_CHART_HEIGHT_IN_PX: number = 240;

// A finished day's bar, and the lighter one of a day still being reported.
export const DAILY_SPEND_COLORS: Array<ChartColorValue> = ["indigo", "#a5b4fc"];

// A UTC day as the same calendar day at noon on the reader's clock.
export function toReaderDay(utcDayStart: Date): Date {
  return OneUptimeDate.getLocalDateFromWallClockInTimezone(
    new Date(utcDayStart.getTime() + 12 * 60 * 60 * 1000),
    "UTC",
  );
}

/*
 * Where the days still being reported start: the newest day with a cost.
 * Every day from it on is still being reported; null while no day has a
 * cost, as there is then no day the cloud has started to report.
 */
export function getCloudPartlyReportedStart(
  points: Array<CloudCostPoint>,
): number | null {
  for (let index: number = points.length - 1; index >= 0; index--) {
    const point: CloudCostPoint | undefined = points[index];

    if (point && point.y > 0) {
      return index;
    }
  }

  return null;
}

export function getCloudDailySpendChart(data: {
  points: Array<CloudCostPoint>;
  seriesName: string;
  // The days still being reported; drawn with the rest when absent.
  partlyReportedSeriesName?: string | undefined;
}): { series: Array<SeriesPoints>; min: Date; max: Date } | null {
  const first: CloudCostPoint | undefined = data.points[0];
  const last: CloudCostPoint | undefined = data.points[data.points.length - 1];

  if (!first || !last) {
    return null;
  }

  const partlyReportedStart: number | null = data.partlyReportedSeriesName
    ? getCloudPartlyReportedStart(data.points)
    : null;
  const toBar: (point: CloudCostPoint) => { x: Date; y: number } = (
    point: CloudCostPoint,
  ): { x: Date; y: number } => {
    return { x: toReaderDay(point.x), y: point.y };
  };

  const series: Array<SeriesPoints> =
    partlyReportedStart === null
      ? [{ seriesName: data.seriesName, data: data.points.map(toBar) }]
      : [
          {
            seriesName: data.seriesName,
            data: data.points.slice(0, partlyReportedStart).map(toBar),
          },
          {
            seriesName: data.partlyReportedSeriesName!,
            data: data.points.slice(partlyReportedStart).map(toBar),
          },
        ];

  return {
    series,
    // The first day's start to the last one's end, on the reader's clock.
    min: OneUptimeDate.getLocalDateFromWallClockInTimezone(first.x, "UTC"),
    max: OneUptimeDate.getLocalDateFromWallClockInTimezone(
      new Date(last.x.getTime() + 24 * 60 * 60 * 1000 - 1000),
      "UTC",
    ),
  };
}

export interface ComponentProps {
  points: Array<CloudCostPoint>;
  currency: string;
}

const CloudDailySpendChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const seriesName: string =
    translator.translateText(DAILY_SPEND_SERIES) || DAILY_SPEND_SERIES;
  const partlyReportedSeriesName: string =
    translator.translateText(STILL_BEING_REPORTED_SERIES) ||
    STILL_BEING_REPORTED_SERIES;
  const chart: { series: Array<SeriesPoints>; min: Date; max: Date } | null =
    getCloudDailySpendChart({
      points: props.points,
      seriesName,
      partlyReportedSeriesName,
    });

  if (!chart) {
    return <></>;
  }

  const xAxis: XAxis = {
    legend: "Day",
    options: {
      type: XAxisType.Date,
      min: chart.min,
      max: chart.max,
      aggregateType: XAxisAggregateType.Sum,
      precision: XAxisPrecision.EVERY_DAY,
    },
  };

  const yAxis: YAxis = {
    legend: props.currency,
    options: {
      type: YAxisType.Number,
      min: 0,
      max: "auto",
      formatter: (value: number): string => {
        return formatCloudMoney({
          amount: value,
          currency: props.currency,
          translator,
          whole: true,
        });
      },
      precision: YAxisPrecision.NoDecimals,
    },
  };

  return (
    <div
      className="w-full"
      style={{ height: `${DAILY_SPEND_CHART_HEIGHT_IN_PX}px` }}
      data-testid="cloud-daily-spend-chart"
      data-partly-reported={chart.series.length > 1 ? "true" : "false"}
    >
      <BarChartElement
        data={chart.series}
        xAxis={xAxis}
        yAxis={yAxis}
        sync={false}
        syncid="cloud-daily-spend"
        heightInPx={DAILY_SPEND_CHART_HEIGHT_IN_PX}
        // The legend names the lighter bars: the days still being reported.
        showLegend={chart.series.length > 1}
        colors={DAILY_SPEND_COLORS}
        stacked={true}
        disableTimeRangeZoom={true}
      />
    </div>
  );
};

export default CloudDailySpendChart;
