import BarChartElement from "Common/UI/Components/Charts/Bar/BarChart";
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
 */

export const DAILY_SPEND_SERIES: string = translationKey("Spend");
export const DAILY_SPEND_CHART_HEIGHT_IN_PX: number = 240;

// A UTC day as the same calendar day at noon on the reader's clock.
export function toReaderDay(utcDayStart: Date): Date {
  return OneUptimeDate.getLocalDateFromWallClockInTimezone(
    new Date(utcDayStart.getTime() + 12 * 60 * 60 * 1000),
    "UTC",
  );
}

export function getCloudDailySpendChart(data: {
  points: Array<CloudCostPoint>;
  seriesName: string;
}): { series: Array<SeriesPoints>; min: Date; max: Date } | null {
  const first: CloudCostPoint | undefined = data.points[0];
  const last: CloudCostPoint | undefined = data.points[data.points.length - 1];

  if (!first || !last) {
    return null;
  }

  return {
    series: [
      {
        seriesName: data.seriesName,
        data: data.points.map(
          (point: CloudCostPoint): { x: Date; y: number } => {
            return { x: toReaderDay(point.x), y: point.y };
          },
        ),
      },
    ],
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
  const chart: { series: Array<SeriesPoints>; min: Date; max: Date } | null =
    getCloudDailySpendChart({ points: props.points, seriesName });

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
    >
      <BarChartElement
        data={chart.series}
        xAxis={xAxis}
        yAxis={yAxis}
        sync={false}
        syncid="cloud-daily-spend"
        heightInPx={DAILY_SPEND_CHART_HEIGHT_IN_PX}
        showLegend={false}
        disableTimeRangeZoom={true}
      />
    </div>
  );
};

export default CloudDailySpendChart;
