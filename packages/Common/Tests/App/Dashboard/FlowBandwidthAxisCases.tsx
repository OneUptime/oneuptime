import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { BandwidthOverTimeChart } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/FlowTopTalkers";
import fillFlowSeriesGaps, {
  FlowSeriesPointLike,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/FlowSeriesUtil";
import { getStandInChart, resetStandInCharts } from "./ChartZoomStandIn";
import ChartDataPoint, {
  CHART_DATA_POINT_DATE_KEY,
} from "../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import DataPoint from "../../../UI/Components/Charts/Types/DataPoint";
import SeriesPoints from "../../../UI/Components/Charts/Types/SeriesPoints";
import { XAxis } from "../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import YAxis from "../../../UI/Components/Charts/Types/YAxis/YAxis";
import DataPointUtil from "../../../UI/Components/Charts/Utils/DataPoint";
import XAxisUtil from "../../../UI/Components/Charts/Utils/XAxis";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import { RangeStartAndEndDateTimeUtil } from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * Issue #4105 review, sdn-1: the Traffic page's bandwidth chart must draw
 * every flow bucket the API returns as a point of its own.
 *
 * It used to pin its grid only for one-minute buckets and leave every wider
 * bucket to the axis, which picks a step from the window's length: daily
 * over two weeks, for 168-minute buckets. DataPointUtil files points under
 * slots by label and AVERAGES the ones that share a slot, so 121 buckets drew
 * as 15 points and a 900 Mbps burst peaked at about 101 Mbps, under a "Max
 * 900 Mbps" printed right above the chart. The axis also started at the
 * window start, after the first (epoch-aligned) bucket, which the chart then
 * dropped for want of a slot.
 *
 * These run the REAL DataPointUtil over exactly what the chart is handed (the
 * area chart is ChartZoomStandIn, which records its props), for every preset
 * window, custom windows that land on each grid step, and zooms laid out the
 * way a drag lays them out. The grid is walked on the viewer's wall clock,
 * so each timezone this runs in (one test file per zone, see the importers)
 * is its own case: whole hours off UTC, half an hour, three quarters, and a
 * zone behind UTC.
 */

const BANDWIDTH_CHART: string = "Bandwidth [Mbps]";
const BANDWIDTH_SERIES: string = "Bandwidth";
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

// Not on any grid step, as a reader's "now" never is.
export const FLOW_AXIS_NOW: Date = new Date("2026-09-29T14:42:17.000Z");

interface FlowWindow {
  start: Date;
  end: Date;
}

export interface FlowWindowCase {
  name: string;
  // Lazy: the presets resolve against the pinned clock inside the test.
  window: () => FlowWindow;
}

function presetCase(range: TimeRange): FlowWindowCase {
  return {
    name: range,
    window: (): FlowWindow => {
      const window: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate({ range: range });
      return { start: window.startValue, end: window.endValue };
    },
  };
}

// A custom range picked on the card: some length, ending now.
function endingNowCase(name: string, lengthMs: number): FlowWindowCase {
  return {
    name: name,
    window: (): FlowWindow => {
      return {
        start: new Date(FLOW_AXIS_NOW.getTime() - lengthMs),
        end: FLOW_AXIS_NOW,
      };
    },
  };
}

function fixedCase(name: string, start: string, end: string): FlowWindowCase {
  return {
    name: name,
    window: (): FlowWindow => {
      return { start: new Date(start), end: new Date(end) };
    },
  };
}

export const FLOW_WINDOW_CASES: Array<FlowWindowCase> = [
  // Every preset of the card's picker the API serves (31 days at most).
  presetCase(TimeRange.PAST_ONE_HOUR),
  presetCase(TimeRange.PAST_THREE_HOURS),
  presetCase(TimeRange.PAST_ONE_DAY),
  presetCase(TimeRange.PAST_TWO_DAYS),
  presetCase(TimeRange.PAST_ONE_WEEK),
  presetCase(TimeRange.PAST_TWO_WEEKS),
  presetCase(TimeRange.PAST_ONE_MONTH),
  // Custom ranges whose buckets land on, between and just under each step.
  endingNowCase("20 minutes (1-minute buckets)", 20 * MINUTE),
  endingNowCase("6 hours (3-minute buckets)", 6 * HOUR),
  endingNowCase("8 hours (4-minute buckets)", 8 * HOUR),
  endingNowCase("12 hours (6-minute buckets)", 12 * HOUR),
  endingNowCase("18 hours (9-minute buckets)", 18 * HOUR),
  endingNowCase("28 hours (14-minute buckets)", 28 * HOUR),
  endingNowCase("30 hours (15-minute buckets)", 30 * HOUR),
  endingNowCase("58 hours (29-minute buckets)", 58 * HOUR),
  endingNowCase("60 hours (30-minute buckets)", 60 * HOUR),
  endingNowCase("4 days (48-minute buckets)", 4 * DAY),
  endingNowCase("10 days (2-hour buckets)", 10 * DAY),
  endingNowCase("15 days (3-hour buckets)", 15 * DAY),
  endingNowCase("25 days (5-hour buckets)", 25 * DAY),
  endingNowCase("30 days (6-hour buckets)", 30 * DAY),
  // Odd edges: the window ends just past a bucket that starts on a step.
  fixedCase(
    "a custom range with odd edges (20 h 10 min 22 s)",
    "2026-09-28T13:07:41.000Z",
    "2026-09-29T09:18:03.000Z",
  ),
  // Zooms, as a drag lays them out: from one row's start to another's end.
  fixedCase(
    "a 30-minute zoom within the past hour",
    "2026-09-29T14:00:00.000Z",
    "2026-09-29T14:30:00.000Z",
  ),
  fixedCase(
    "a 6-hour zoom on the 1-day chart",
    "2026-09-29T02:40:00.000Z",
    "2026-09-29T08:40:00.000Z",
  ),
  fixedCase(
    "a 2-day zoom on the 2-week chart",
    "2026-09-20T06:00:00.000Z",
    "2026-09-22T06:00:00.000Z",
  ),
];

/*
 * The bucket width the API picks for a window: whole minutes, about 120
 * buckets a window. Mirrors pickBucketSeconds in
 * App/FeatureSet/BaseAPI/API/NetworkDeviceFlow.ts, whose formula
 * NetworkDeviceTimeRangeZoomWiring.test.ts pins.
 */
export function serverBucketSeconds(window: FlowWindow): number {
  const windowSeconds: number = Math.floor(
    (window.end.getTime() - window.start.getTime()) / 1000,
  );
  const rawSeconds: number = Math.ceil(windowSeconds / 120);
  return Math.max(60, Math.ceil(rawSeconds / 60) * 60);
}

/*
 * What the API's series holds for a window: a bucket every `bucketSeconds`,
 * aligned to the epoch as ClickHouse's toStartOfInterval aligns them, from
 * the one holding the window start to the one holding its end, as naive UTC
 * strings. `mbpsAt` is each bucket's rate.
 */
function serverSeries(
  window: FlowWindow,
  bucketSeconds: number,
  mbpsAt: (index: number, count: number) => number,
): Array<FlowSeriesPointLike> {
  const bucketMs: number = bucketSeconds * SECOND;
  const firstMs: number =
    Math.floor(window.start.getTime() / bucketMs) * bucketMs;
  const count: number = Math.ceil((window.end.getTime() - firstMs) / bucketMs);
  const series: Array<FlowSeriesPointLike> = [];
  for (let index: number = 0; index < count; index++) {
    series.push({
      time: new Date(firstMs + index * bucketMs)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, ""),
      // Mbps back to the bucket's byte count.
      octets: (mbpsAt(index, count) * 1_000_000 * bucketSeconds) / 8,
      packets: 1,
    });
  }
  return series;
}

interface DrawnBandwidthChart {
  xAxis: XAxis;
  // What the chart was handed: one point per gap-filled bucket.
  buckets: Array<DataPoint>;
  // What it draws: DataPointUtil's rows, one per slot.
  rows: Array<ChartDataPoint>;
}

/*
 * The card's chart for a window, as FlowTopTalkers renders it (gap-filled,
 * over the window the API echoes back), and the rows the area chart builds
 * from its props.
 */
function drawBandwidthChart(
  window: FlowWindow,
  bucketSeconds: number,
  series: Array<FlowSeriesPointLike>,
): DrawnBandwidthChart {
  const windowStartAt: string = window.start.toISOString();
  const windowEndAt: string = window.end.toISOString();
  render(
    <BandwidthOverTimeChart
      series={fillFlowSeriesGaps(
        series,
        bucketSeconds,
        windowStartAt,
        windowEndAt,
      )}
      bucketSeconds={bucketSeconds}
      windowStartAt={windowStartAt}
      windowEndAt={windowEndAt}
    />,
  );

  const props: { data: Array<SeriesPoints>; xAxis: XAxis; yAxis: YAxis } =
    getStandInChart(BANDWIDTH_CHART).props as unknown as {
      data: Array<SeriesPoints>;
      xAxis: XAxis;
      yAxis: YAxis;
    };

  return {
    xAxis: props.xAxis,
    buckets: props.data[0]!.data,
    rows: DataPointUtil.getChartDataPoints({
      seriesPoints: props.data,
      xAxis: props.xAxis,
      yAxis: props.yAxis,
    }),
  };
}

// The rates the chart plots, slot by slot, skipping empty slots.
function plottedMbps(rows: Array<ChartDataPoint>): Array<number> {
  return rows
    .map((row: ChartDataPoint): unknown => {
      return row[BANDWIDTH_SERIES];
    })
    .filter((value: unknown): value is number => {
      return typeof value === "number";
    });
}

function rowStartMs(row: ChartDataPoint | undefined): number {
  return Number(row?.[CHART_DATA_POINT_DATE_KEY]);
}

// How far apart the walker puts two slots of this precision, measured.
function gridStepMs(precision: XAxisPrecision): number {
  const intervals: Array<Date> = XAxisUtil.getPrecisionIntervals({
    xAxisMin: FLOW_AXIS_NOW,
    xAxisMax: new Date(FLOW_AXIS_NOW.getTime() + 2 * DAY),
    precision: precision,
  });
  return intervals[1]!.getTime() - intervals[0]!.getTime();
}

type SpikePosition = "first" | "middle" | "last";

function spikeIndex(position: SpikePosition, count: number): number {
  if (position === "first") {
    return 0;
  }
  if (position === "last") {
    return count - 1;
  }
  return Math.floor(count / 2);
}

const SPIKE_CASES: Array<{ name: string; position: SpikePosition }> =
  FLOW_WINDOW_CASES.flatMap((windowCase: FlowWindowCase) => {
    return (["first", "middle", "last"] as Array<SpikePosition>).map(
      (position: SpikePosition) => {
        return { name: windowCase.name, position: position };
      },
    );
  });

function findCase(name: string): FlowWindowCase {
  const found: FlowWindowCase | undefined = FLOW_WINDOW_CASES.find(
    (windowCase: FlowWindowCase): boolean => {
      return windowCase.name === name;
    },
  );
  if (!found) {
    throw new Error(`No window case named "${name}"`);
  }
  return found;
}

/*
 * `utcOffsetMinutes`: how far ahead of UTC the zone is at FLOW_AXIS_NOW, to
 * prove the file really runs in it.
 */
export default function describeFlowBandwidthAxis(
  timezone: string,
  utcOffsetMinutes: number,
): void {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(FLOW_AXIS_NOW);
    resetStandInCharts();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  describe(`Traffic bandwidth chart (${timezone}): every flow bucket is a point of its own`, () => {
    test("the grid's wall clock and its labels' are both this zone's", () => {
      // The walker's Date setters (0 - x: UTC's offset is 0, never -0).
      expect(0 - FLOW_AXIS_NOW.getTimezoneOffset()).toBe(utcOffsetMinutes);
      // The labels (OneUptimeDate reads the zone it guesses from the browser).
      expect(OneUptimeDate.getTimezoneOffsetInMinutes(FLOW_AXIS_NOW)).toBe(
        utcOffsetMinutes,
      );
    });

    test.each(FLOW_WINDOW_CASES)(
      "$name: each bucket's rate is plotted once, in order - none averaged with a neighbour, none dropped",
      (windowCase: FlowWindowCase) => {
        const window: FlowWindow = windowCase.window();
        const bucketSeconds: number = serverBucketSeconds(window);
        // Every bucket a different rate, so a shared slot cannot hide.
        const series: Array<FlowSeriesPointLike> = serverSeries(
          window,
          bucketSeconds,
          (index: number): number => {
            return index + 1;
          },
        );

        const drawn: DrawnBandwidthChart = drawBandwidthChart(
          window,
          bucketSeconds,
          series,
        );

        expect(drawn.buckets).toHaveLength(series.length);
        expect(plottedMbps(drawn.rows)).toEqual(
          drawn.buckets.map((bucket: DataPoint): number => {
            return bucket.y as number;
          }),
        );
      },
    );

    test.each(FLOW_WINDOW_CASES)(
      "$name: the grid is no coarser than a bucket, so a drag can select a single bucket",
      (windowCase: FlowWindowCase) => {
        const window: FlowWindow = windowCase.window();
        const bucketSeconds: number = serverBucketSeconds(window);
        const drawn: DrawnBandwidthChart = drawBandwidthChart(
          window,
          bucketSeconds,
          serverSeries(window, bucketSeconds, (): number => {
            return 1;
          }),
        );

        // A grid step is pinned: the window's length does not pick one.
        const precision: XAxisPrecision | undefined =
          drawn.xAxis.options.precision;
        expect(precision).toBeDefined();
        expect(gridStepMs(precision!)).toBeLessThanOrEqual(
          bucketSeconds * SECOND,
        );
        // And the rows a drag selects from are that far apart.
        expect(rowStartMs(drawn.rows[1]) - rowStartMs(drawn.rows[0])).toBe(
          gridStepMs(precision!),
        );
      },
    );

    test.each(FLOW_WINDOW_CASES)(
      "$name: the axis opens on the first bucket (which starts before the window) and still ends at the window end",
      (windowCase: FlowWindowCase) => {
        const window: FlowWindow = windowCase.window();
        const bucketSeconds: number = serverBucketSeconds(window);
        const drawn: DrawnBandwidthChart = drawBandwidthChart(
          window,
          bucketSeconds,
          serverSeries(window, bucketSeconds, (index: number): number => {
            return index + 1;
          }),
        );

        // No empty slot ahead of the first bucket, and the first bucket drawn.
        expect(drawn.rows[0]![BANDWIDTH_SERIES]).toBe(1);
        expect(rowStartMs(drawn.rows[0])).toBeLessThanOrEqual(
          (drawn.buckets[0]!.x as Date).getTime(),
        );
        expect((drawn.xAxis.options.max as Date).getTime()).toBe(
          window.end.getTime(),
        );
      },
    );

    test.each(SPIKE_CASES)(
      "$name: a burst in the $position bucket peaks at the Max printed above the chart",
      (spikeCase: { name: string; position: SpikePosition }) => {
        const window: FlowWindow = findCase(spikeCase.name).window();
        const bucketSeconds: number = serverBucketSeconds(window);
        let burstIndex: number = -1;
        const series: Array<FlowSeriesPointLike> = serverSeries(
          window,
          bucketSeconds,
          (index: number, count: number): number => {
            burstIndex = spikeIndex(spikeCase.position, count);
            return index === burstIndex ? 900 : 1;
          },
        );

        const drawn: DrawnBandwidthChart = drawBandwidthChart(
          window,
          bucketSeconds,
          series,
        );

        expect(screen.getByText("Max").parentElement).toHaveTextContent(
          "Max 900 Mbps",
        );
        const plotted: Array<number> = plottedMbps(drawn.rows);
        expect(Math.max(...plotted)).toBe(900);
        // Drawn at the burst's own time: its row is the burst's bucket.
        const burstRow: ChartDataPoint | undefined = drawn.rows.find(
          (row: ChartDataPoint): boolean => {
            return row[BANDWIDTH_SERIES] === 900;
          },
        );
        const burstMs: number = (
          drawn.buckets[burstIndex]!.x as Date
        ).getTime();
        expect(rowStartMs(burstRow)).toBeLessThanOrEqual(burstMs);
        expect(burstMs - rowStartMs(burstRow)).toBeLessThan(
          bucketSeconds * SECOND,
        );
      },
    );
  });
}
