import OneUptimeDate from "../../../Types/Date";
import {
  TELEMETRY_USAGE_SIGNALS,
  TelemetryUsageDaySummary,
  TelemetryUsageSignal,
} from "../../../Types/Telemetry/TelemetryUsage";
import { Translator } from "../../../Types/Translator";
import useTranslator from "../../Utils/UseTranslator";
import BarChartElement from "../Charts/Bar/BarChart";
import { ChartColorValue } from "../Charts/ChartLibrary/Utils/ChartColors";
import SeriesPoints from "../Charts/Types/SeriesPoints";
import { XAxis, XAxisAggregateType } from "../Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "../Charts/Types/XAxis/XAxisType";
import YAxis, { YAxisPrecision } from "../Charts/Types/YAxis/YAxis";
import YAxisType from "../Charts/Types/YAxis/YAxisType";
import {
  formatTelemetryUsageSize,
  getTelemetryUsageSignalTitle,
  TELEMETRY_USAGE_SIGNAL_COLORS,
} from "./TelemetryUsageWords";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Each day's usage as a bar, its signals stacked: what a project sent each
 * UTC day of the range, in GB. A signal with nothing in the range is left
 * out of the bars and the legend.
 *
 * Usage is counted by the UTC day. The chart groups its bars by the day on
 * the reader's clock, so each day is handed to it as noon of that day on the
 * reader's clock: a bar lands on the day it is labelled with, in any time
 * zone - midnight UTC would be the evening before in New York (the Cloud
 * pages' daily spend is drawn the same way).
 */

const HEIGHT_IN_PX: number = 240;
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

export const TELEMETRY_USAGE_DAILY_CHART_TEST_ID: string =
  "telemetry-usage-daily-chart";

// A UTC day (YYYY-MM-DD) as noon of the same calendar day on the reader's clock.
export const toReaderNoon: (day: string) => Date = (day: string): Date => {
  return OneUptimeDate.getLocalDateFromWallClockInTimezone(
    new Date(new Date(`${day}T00:00:00.000Z`).getTime() + DAY_IN_MS / 2),
    "UTC",
  );
};

/*
 * The signals that sent anything on any day, in their canonical order: the
 * exceptions after the traces they are billed with.
 */
export const getChartedSignals: (
  days: ReadonlyArray<TelemetryUsageDaySummary>,
) => Array<TelemetryUsageSignal> = (
  days: ReadonlyArray<TelemetryUsageDaySummary>,
): Array<TelemetryUsageSignal> => {
  return TELEMETRY_USAGE_SIGNALS.filter(
    (signal: TelemetryUsageSignal): boolean => {
      return days.some((day: TelemetryUsageDaySummary): boolean => {
        return (day.byProduct[signal]?.dataIngestedInGB || 0) > 0;
      });
    },
  );
};

export interface ComponentProps {
  days: ReadonlyArray<TelemetryUsageDaySummary>;
}

const TelemetryUsageDailyChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const first: TelemetryUsageDaySummary | undefined = props.days[0];
  const last: TelemetryUsageDaySummary | undefined =
    props.days[props.days.length - 1];

  if (!first || !last) {
    return <></>;
  }

  const signals: Array<TelemetryUsageSignal> = getChartedSignals(props.days);

  const series: Array<SeriesPoints> = signals.map(
    (signal: TelemetryUsageSignal): SeriesPoints => {
      return {
        seriesName: getTelemetryUsageSignalTitle(signal, translator),
        data: props.days.map((day: TelemetryUsageDaySummary) => {
          return {
            x: toReaderNoon(day.day),
            y: day.byProduct[signal]?.dataIngestedInGB || 0,
          };
        }),
      };
    },
  );

  const colors: Array<ChartColorValue> = signals.map(
    (signal: TelemetryUsageSignal): ChartColorValue => {
      return TELEMETRY_USAGE_SIGNAL_COLORS[signal] || "gray";
    },
  );

  const xAxis: XAxis = {
    legend: "Day",
    options: {
      type: XAxisType.Date,
      // The first day's start to the last one's end, on the reader's clock.
      min: OneUptimeDate.getLocalDateFromWallClockInTimezone(
        new Date(`${first.day}T00:00:00.000Z`),
        "UTC",
      ),
      max: OneUptimeDate.getLocalDateFromWallClockInTimezone(
        new Date(
          new Date(`${last.day}T00:00:00.000Z`).getTime() + DAY_IN_MS - 1000,
        ),
        "UTC",
      ),
      aggregateType: XAxisAggregateType.Sum,
      precision: XAxisPrecision.EVERY_DAY,
    },
  };

  const yAxis: YAxis = {
    legend: "Data Ingested (in GB)",
    options: {
      type: YAxisType.Number,
      min: 0,
      max: "auto",
      formatter: (value: number): string => {
        return formatTelemetryUsageSize(value, translator);
      },
      precision: YAxisPrecision.TwoDecimals,
    },
  };

  return (
    <div
      className="w-full"
      style={{ height: `${HEIGHT_IN_PX}px` }}
      data-testid={TELEMETRY_USAGE_DAILY_CHART_TEST_ID}
      data-signals={signals.join(",")}
    >
      <BarChartElement
        data={series}
        xAxis={xAxis}
        yAxis={yAxis}
        sync={false}
        syncid={TELEMETRY_USAGE_DAILY_CHART_TEST_ID}
        heightInPx={HEIGHT_IN_PX}
        showLegend={signals.length > 1}
        colors={colors}
        stacked={true}
        disableTimeRangeZoom={true}
      />
    </div>
  );
};

export default TelemetryUsageDailyChart;
