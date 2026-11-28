import {
  FORECAST_SERIES_FORECAST,
  FORECAST_SERIES_ON_COURSE,
  FORECAST_SERIES_SPENT,
} from "./CloudBudgetWords";
import { toReaderDay } from "../CloudDailySpendChart";
import { formatCloudMoney } from "../CloudCostWords";
import {
  CloudCostForecastMonth,
  CloudCostForecastMonthKind,
} from "Common/Types/Cloud/CloudCostForecast";
import { fromCloudCostDay } from "Common/Types/Cloud/CloudCost";
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
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A FORECAST MONTH BY MONTH, AS BARS (#11008): the months it was made from
 * as they cost, this month - what it cost so far, and the rest of it on
 * course, lighter - and each month ahead as forecast, lighter still. One
 * bar a month, in one of three stacked series, each named in the legend;
 * a month's likely range is in the table under the chart.
 *
 * Each month is handed to the chart as noon of its first day on the
 * reader's clock (toReaderDay), so a bar lands on the month it is labelled
 * with in any time zone.
 */

export const FORECAST_CHART_HEIGHT_IN_PX: number = 260;

// Spent, the rest of this month on course, and the months forecast.
export const FORECAST_CHART_COLORS: Array<ChartColorValue> = [
  "indigo",
  "#a5b4fc",
  "#c4b5fd",
];

export function getCloudForecastChartSeries(data: {
  months: Array<CloudCostForecastMonth>;
  names: { spent: string; onCourse: string; forecast: string };
}): Array<SeriesPoints> {
  const spent: SeriesPoints = { seriesName: data.names.spent, data: [] };
  const onCourse: SeriesPoints = { seriesName: data.names.onCourse, data: [] };
  const forecast: SeriesPoints = { seriesName: data.names.forecast, data: [] };

  for (const month of data.months) {
    const x: Date = toReaderDay(fromCloudCostDay(`${month.month}-01`));
    const soFar: number =
      month.kind === CloudCostForecastMonthKind.Current
        ? month.spent || 0
        : month.kind === CloudCostForecastMonthKind.Actual
          ? month.amount
          : 0;

    spent.data.push({ x, y: soFar });
    onCourse.data.push({
      x,
      y:
        month.kind === CloudCostForecastMonthKind.Current
          ? Math.max(0, month.amount - (month.spent || 0))
          : 0,
    });
    forecast.data.push({
      x,
      y: month.kind === CloudCostForecastMonthKind.Forecast ? month.amount : 0,
    });
  }

  return [spent, onCourse, forecast];
}

export interface ComponentProps {
  months: Array<CloudCostForecastMonth>;
  currency: string;
}

const CloudForecastChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const first: CloudCostForecastMonth | undefined = props.months[0];
  const last: CloudCostForecastMonth | undefined =
    props.months[props.months.length - 1];

  if (!first || !last) {
    return <></>;
  }

  const series: Array<SeriesPoints> = getCloudForecastChartSeries({
    months: props.months,
    names: {
      spent:
        translator.translateText(FORECAST_SERIES_SPENT) ||
        FORECAST_SERIES_SPENT,
      onCourse:
        translator.translateText(FORECAST_SERIES_ON_COURSE) ||
        FORECAST_SERIES_ON_COURSE,
      forecast:
        translator.translateText(FORECAST_SERIES_FORECAST) ||
        FORECAST_SERIES_FORECAST,
    },
  });
  const lastStart: Date = fromCloudCostDay(`${last.month}-01`);

  const xAxis: XAxis = {
    legend: "Month",
    options: {
      type: XAxisType.Date,
      min: OneUptimeDate.getLocalDateFromWallClockInTimezone(
        fromCloudCostDay(`${first.month}-01`),
        "UTC",
      ),
      max: OneUptimeDate.getLocalDateFromWallClockInTimezone(
        new Date(
          Date.UTC(lastStart.getUTCFullYear(), lastStart.getUTCMonth() + 1, 1) -
            1000,
        ),
        "UTC",
      ),
      aggregateType: XAxisAggregateType.Sum,
      precision: XAxisPrecision.EVERY_MONTH,
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
      style={{ height: `${FORECAST_CHART_HEIGHT_IN_PX}px` }}
      data-testid="cloud-forecast-chart"
      data-months={String(props.months.length)}
    >
      <BarChartElement
        data={series}
        xAxis={xAxis}
        yAxis={yAxis}
        sync={false}
        syncid="cloud-forecast"
        heightInPx={FORECAST_CHART_HEIGHT_IN_PX}
        showLegend={true}
        colors={FORECAST_CHART_COLORS}
        stacked={true}
        disableTimeRangeZoom={true}
      />
    </div>
  );
};

export default CloudForecastChart;
