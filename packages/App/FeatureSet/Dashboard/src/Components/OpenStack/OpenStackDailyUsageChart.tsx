import OneUptimeDate from "Common/Types/Date";
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
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { toReaderDay } from "../Cloud/CloudDailySpendChart";
import { formatOpenStackUsageNumber } from "../../Pages/OpenStack/Utils/OpenStackSpendView";

/*
 * Each day's vCPU-hours as a bar, on the shared bar chart, as a cloud's daily spend is drawn. Usage and
 * not money, because a price changed today applies to every day shown, and these days' amounts were
 * worked out at the prices of their own.
 */

const HEIGHT_IN_PX: number = 240;
const COLORS: Array<ChartColorValue> = ["indigo"];
const SERIES_NAME: string = translationKey("vCPU-hours");

export interface ComponentProps {
  testId: string;
  days: ReadonlyArray<{ day: string; vcpuHours: number }>;
}

const OpenStackDailyUsageChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const first: { day: string } | undefined = props.days[0];
  const last: { day: string } | undefined = props.days[props.days.length - 1];

  if (!first || !last) {
    return <></>;
  }

  const startOf: (day: string) => Date = (day: string): Date => {
    return new Date(`${day}T00:00:00.000Z`);
  };
  const series: Array<SeriesPoints> = [
    {
      seriesName: translator.translateText(SERIES_NAME) || SERIES_NAME,
      data: props.days.map((entry: { day: string; vcpuHours: number }) => {
        return { x: toReaderDay(startOf(entry.day)), y: entry.vcpuHours };
      }),
    },
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
        new Date(startOf(last.day).getTime() + 24 * 60 * 60 * 1000 - 1000),
        "UTC",
      ),
      aggregateType: XAxisAggregateType.Sum,
      precision: XAxisPrecision.EVERY_DAY,
    },
  };
  const yAxis: YAxis = {
    legend: "vCPU-hours",
    options: {
      type: YAxisType.Number,
      min: 0,
      max: "auto",
      formatter: (value: number): string => {
        return formatOpenStackUsageNumber(value, translator);
      },
      precision: YAxisPrecision.NoDecimals,
    },
  };

  return (
    <div
      className="w-full"
      style={{ height: `${HEIGHT_IN_PX}px` }}
      data-testid={props.testId}
    >
      <BarChartElement
        data={series}
        xAxis={xAxis}
        yAxis={yAxis}
        sync={false}
        syncid={props.testId}
        heightInPx={HEIGHT_IN_PX}
        showLegend={false}
        colors={COLORS}
        stacked={true}
        disableTimeRangeZoom={true}
      />
    </div>
  );
};

export default OpenStackDailyUsageChart;
