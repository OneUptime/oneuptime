import { P50_LABEL, P95_LABEL, SECONDS_AXIS } from "./AutomaticResponseCopy";
import {
  TimeToBlockPoint,
  formatTimeToBlock,
  getTimeToBlockPoints,
} from "./AutomaticResponseModel";
import { toReaderDay } from "../../Cloud/CloudDailySpendChart";
import OneUptimeDate from "Common/Types/Date";
import { SecurityAutomaticResponseTimeToBlockDay } from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponseSummary";
import { ChartColorValue } from "Common/UI/Components/Charts/ChartLibrary/Utils/ChartColors";
import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
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
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A policy's time to block, day by day over 30 days (#10350): the 50th and
 * 95th percentiles of how long its blocks took from an address's first
 * request to holding at the edge, on the shared line chart, as a cloud's
 * daily spend is drawn. A day with no block has no point. Its figures are
 * the reader's: "41s", "1m 32s".
 */

const HEIGHT_IN_PX: number = 200;
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const COLORS: Array<ChartColorValue> = ["blue", "amber"];

export interface ComponentProps {
  days: ReadonlyArray<SecurityAutomaticResponseTimeToBlockDay>;
  testId: string;
}

const TimeToBlockChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const first: SecurityAutomaticResponseTimeToBlockDay | undefined =
    props.days[0];
  const last: SecurityAutomaticResponseTimeToBlockDay | undefined =
    props.days[props.days.length - 1];

  if (!first || !last) {
    return <></>;
  }

  const startOf: (day: string) => Date = (day: string): Date => {
    return new Date(`${day}T00:00:00.000Z`);
  };
  const toSeries: (
    name: string,
    points: Array<TimeToBlockPoint>,
  ) => SeriesPoints = (
    name: string,
    points: Array<TimeToBlockPoint>,
  ): SeriesPoints => {
    return {
      seriesName: translator.translateText(name) || name,
      data: points.map((point: TimeToBlockPoint) => {
        return { x: toReaderDay(point.day), y: point.seconds };
      }),
    };
  };
  const series: Array<SeriesPoints> = [
    toSeries(P50_LABEL, getTimeToBlockPoints(props.days, "p50InSeconds")),
    toSeries(P95_LABEL, getTimeToBlockPoints(props.days, "p95InSeconds")),
  ];
  const xAxis: XAxis = {
    legend: "Day",
    options: {
      type: XAxisType.Date,
      min: OneUptimeDate.getLocalDateFromWallClockInTimezone(
        startOf(first.day),
        "UTC",
      ),
      max: OneUptimeDate.getLocalDateFromWallClockInTimezone(
        new Date(startOf(last.day).getTime() + DAY_IN_MS - 1000),
        "UTC",
      ),
      aggregateType: XAxisAggregateType.Max,
      precision: XAxisPrecision.EVERY_DAY,
    },
  };
  const yAxis: YAxis = {
    legend: SECONDS_AXIS,
    options: {
      type: YAxisType.Number,
      min: 0,
      max: "auto",
      formatter: (value: number): string => {
        return formatTimeToBlock(value, translator);
      },
      precision: YAxisPrecision.NoDecimals,
    },
  };

  return (
    <div className="w-full" data-testid={props.testId}>
      <LineChartElement
        data={series}
        xAxis={xAxis}
        yAxis={yAxis}
        curve={ChartCurve.MONOTONE}
        sync={false}
        syncid={props.testId}
        heightInPx={HEIGHT_IN_PX}
        showLegend={true}
        colors={COLORS}
        disableTimeRangeZoom={true}
      />
    </div>
  );
};

export default TimeToBlockChart;
