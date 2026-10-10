import { parseBucketTime } from "../NetworkDevice/FlowSeriesUtil";
import { getCoarsestChartGridStepWithin } from "../NetworkDevice/ChartGridStep";
import { formatBitsPerSecond, getBitsPerSecond } from "./NetworkTrafficFormat";
import { NetworkTrafficSeriesPoint } from "Common/Types/NetFlow/NetworkTraffic";
import AreaChartElement from "Common/UI/Components/Charts/Area/AreaChart";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import DataPoint from "Common/UI/Components/Charts/Types/DataPoint";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "Common/UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import XAxisUtil from "Common/UI/Components/Charts/Utils/XAxis";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Traffic over time: each bucket's bytes as the average bit rate across it,
 * on the shared area chart, over the window the page asked for. With an
 * interface filter it draws two series, in through the interface and out
 * through it.
 *
 * It joins the page's zoom (issue #4105): a drag across it narrows the
 * page's range, a double-click puts the range back.
 */

export const TRAFFIC_SERIES_NAME: string = "Traffic";
export const IN_SERIES_NAME: string = "In";
export const OUT_SERIES_NAME: string = "Out";

/*
 * The chart's grid step for the series' bucket width: the coarsest step no
 * wider than one bucket, so every bucket gets a slot of its own.
 *
 * The API sizes its buckets to about 120 per window, in whole minutes: 12
 * minutes over a day, 168 over two weeks, 372 over the 31-day maximum, and
 * any multiple of a minute for a zoom or a custom range. Hardly any of those
 * is a grid step, and the axis must not guess one from the window's length:
 * it guesses the step a metric query of that length is bucketed at, which
 * is coarser - daily for two weeks - and the chart then AVERAGES every bucket
 * that lands in one slot. A burst drew at a ninth of its height, and a drag
 * could only select whole days. On a step no wider than a bucket, buckets
 * never share a slot; the slots between them are left empty, and the area is
 * drawn straight across them.
 */
export function getTrafficAxisPrecision(
  bucketSeconds: number,
): XAxisPrecision | undefined {
  return getCoarsestChartGridStepWithin(bucketSeconds);
}

export interface ComponentProps {
  // Gap-filled (fillTrafficSeriesGaps).
  series: Array<NetworkTrafficSeriesPoint>;
  bucketSeconds: number;
  // The window the series was fetched over, as the API echoes it back.
  windowStartAt: string;
  windowEndAt: string;
}

const TrafficOverTimeChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const bucketSeconds: number =
    props.bucketSeconds > 0 ? props.bucketSeconds : 60;

  const isSplit: boolean = props.series.some(
    (point: NetworkTrafficSeriesPoint): boolean => {
      return point.inOctets !== undefined;
    },
  );

  // Megabits a second: the unit the axis and the tooltip read in.
  const toMbps: (octets: number) => number = (octets: number): number => {
    return getBitsPerSecond(octets, bucketSeconds) / 1_000_000;
  };

  const lines: Array<{
    name: string;
    read: (point: NetworkTrafficSeriesPoint) => number;
  }> = isSplit
    ? [
        {
          name: IN_SERIES_NAME,
          read: (point: NetworkTrafficSeriesPoint): number => {
            return point.inOctets || 0;
          },
        },
        {
          name: OUT_SERIES_NAME,
          read: (point: NetworkTrafficSeriesPoint): number => {
            return point.outOctets || 0;
          },
        },
      ]
    : [
        {
          name: TRAFFIC_SERIES_NAME,
          read: (point: NetworkTrafficSeriesPoint): number => {
            return point.octets;
          },
        },
      ];

  const series: Array<SeriesPoint> = lines.map(
    (line: {
      name: string;
      read: (point: NetworkTrafficSeriesPoint) => number;
    }): SeriesPoint => {
      const points: Array<DataPoint> = [];

      for (const point of props.series) {
        const bucketMs: number = parseBucketTime(point.time);

        if (Number.isFinite(bucketMs)) {
          points.push({ x: new Date(bucketMs), y: toMbps(line.read(point)) });
        }
      }

      return { seriesName: line.name, data: points };
    },
  );

  const firstPoints: Array<DataPoint> = series[0]?.data || [];

  if (firstPoints.length === 0) {
    return <></>;
  }

  const precision: XAxisPrecision | undefined =
    getTrafficAxisPrecision(bucketSeconds);

  /*
   * The axis spans the whole window the page asked for, so a quiet start or
   * end still reads as time passing, and a drag maps to real instants. It
   * starts on the grid, at the step that holds the FIRST bucket: buckets are
   * aligned to the epoch, so the first one usually begins before the window
   * does, and an axis walked from the window start - or from any instant off
   * the grid - can label its first or last slot past a bucket. The chart
   * silently drops a point with no slot: a burst at either end of the window
   * drew nothing.
   */
  const windowStartMs: number = parseBucketTime(props.windowStartAt);
  const windowEndMs: number = parseBucketTime(props.windowEndAt);
  const firstBucketMs: number = firstPoints[0]!.x.getTime();
  const axisFromMs: number = Number.isFinite(windowStartMs)
    ? Math.min(windowStartMs, firstBucketMs)
    : firstBucketMs;
  const axisStartMs: number = precision
    ? XAxisUtil.getBucketStart(new Date(axisFromMs), precision).getTime()
    : axisFromMs;
  const axisEndMs: number = Number.isFinite(windowEndMs)
    ? windowEndMs
    : firstPoints[firstPoints.length - 1]!.x.getTime() + bucketSeconds * 1000;

  if (!Number.isFinite(axisStartMs) || axisEndMs <= axisStartMs) {
    return <></>;
  }

  const xAxis: ChartXAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: new Date(axisStartMs),
      max: new Date(axisEndMs),
      /*
       * One bucket per slot (see getTrafficAxisPrecision); should a
       * daylight-saving change ever fold two into one, it shows their
       * average rate.
       */
      aggregateType: XAxisAggregateType.Average,
      precision: precision,
    },
  };

  const yAxis: YAxis = {
    legend: "Mbps",
    options: {
      type: YAxisType.Number,
      min: 0,
      max: "auto",
      precision: YAxisPrecision.TwoDecimals,
      formatter: (value: number): string => {
        return formatBitsPerSecond(value * 1_000_000);
      },
    },
  };

  return (
    <div>
      <div className="mb-1 flex justify-end">
        <TimeRangeZoomHint revealOnHover={true} />
      </div>
      <div
        role="figure"
        aria-label={translator.translateText(
          isSplit
            ? "Traffic in and out through the interface over time, in bits per second"
            : "Traffic over time, in bits per second",
        )}
        data-testid="traffic-over-time-chart"
      >
        <AreaChartElement
          data={series}
          xAxis={xAxis}
          yAxis={yAxis}
          curve={ChartCurve.MONOTONE}
          sync={false}
          syncid="network-traffic-over-time"
          heightInPx={200}
          showLegend={isSplit}
          colors={isSplit ? ["indigo", "emerald"] : ["indigo"]}
        />
      </div>
    </div>
  );
};

export default TrafficOverTimeChart;
