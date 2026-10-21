import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MockFunction } from "../../MockType";
import EdgeDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EdgeDetailPanel";
import {
  TopologyEntity,
  TopologyRelationship,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";
import { getStandInChart, resetStandInCharts } from "./ChartZoomStandIn";
import ChartDataPoint, {
  CHART_DATA_POINT_DATE_KEY,
} from "../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import SeriesPoints from "../../../UI/Components/Charts/Types/SeriesPoints";
import { XAxis } from "../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import YAxis from "../../../UI/Components/Charts/Types/YAxis/YAxis";
import DataPointUtil from "../../../UI/Components/Charts/Utils/DataPoint";
import XAxisUtil from "../../../UI/Components/Charts/Utils/XAxis";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * Issue #4105 review, sdn-3: the Topology service-call drawer (EdgeDetailPanel)
 * must fetch its history in buckets exactly one slot of its charts wide, and
 * draw every bucket it fetched.
 *
 * It used to keep its own copy of the chart's step ladder, which drifted: the
 * axis gained 5-, 15- and 30-minute steps for windows of 3 hours to 3 days
 * while the copy kept asking for hourly buckets there. So the page's 1-day
 * default was fetched hourly and drawn on a 15-minute axis, and a zoom into 6
 * hours of it re-fetched the very same hourly buckets and only stretched them.
 * An axis walked from the window start could also leave the first bucket (an
 * epoch-aligned UTC bucket, which starts before the window) without a slot,
 * in zones that are not a whole number of steps off UTC: the chart dropped it.
 *
 * These open the real drawer (its line charts are ChartZoomStandIn, which
 * records their props) over every kind of window the drawer is shown - the
 * page's presets, zooms laid out the way a drag lays them out, and custom
 * ranges on either side of each step's threshold - answer its fetch the way
 * the API does, and run the REAL DataPointUtil over what the charts are handed.
 * The grid is walked on the viewer's wall clock, so each timezone this runs in
 * (one test file per zone, see the importers) is its own case.
 */

const CALLS_CHART: string = "Calls + Errors [Calls]";
const LATENCY_CHART: string = "Avg latency [Latency]";
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

/*
 * Not on any grid step, and a quarter of an hour into a UTC half hour: in a
 * zone three quarters of an hour off UTC the drawer's windows then start in
 * a later 30-minute (and hour) step than their first bucket.
 */
export const EDGE_HISTORY_NOW: Date = new Date("2026-09-29T14:52:17.000Z");

export interface HistoryWindowCase {
  name: string;
  // The range the drawer opens on. Lazy: it reads the pinned clock.
  range: () => RangeStartAndEndDateTime;
  // The bucket the drawer must ask for: one slot of its chart, at most an hour.
  bucketSeconds: number;
  // The chart's grid is a day or coarser: hourly buckets add up per slot.
  dayGrid?: boolean | undefined;
}

function presetCase(
  range: TimeRange,
  bucketSeconds: number,
  dayGrid?: boolean,
): HistoryWindowCase {
  return {
    name: range,
    range: (): RangeStartAndEndDateTime => {
      return { range: range };
    },
    bucketSeconds: bucketSeconds,
    dayGrid: dayGrid,
  };
}

function customRange(start: Date, end: Date): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(start, end),
  };
}

// A custom range picked on the page: some length, ending now.
function endingNowCase(
  name: string,
  lengthMs: number,
  bucketSeconds: number,
  dayGrid?: boolean,
): HistoryWindowCase {
  return {
    name: name,
    range: (): RangeStartAndEndDateTime => {
      const now: Date = OneUptimeDate.getCurrentDate();
      return customRange(new Date(now.getTime() - lengthMs), now);
    },
    bucketSeconds: bucketSeconds,
    dayGrid: dayGrid,
  };
}

/*
 * A zoom, the way a drag on the drawer's chart lays one out: from the start
 * of the bucket a row of that chart draws (on the chart's grid, in the
 * viewer's zone) to `lengthMs` later.
 */
function zoomCase(
  name: string,
  chartPrecision: XAxisPrecision,
  agoMs: number,
  lengthMs: number,
  bucketSeconds: number,
): HistoryWindowCase {
  return {
    name: name,
    range: (): RangeStartAndEndDateTime => {
      const start: Date = XAxisUtil.getBucketStart(
        new Date(OneUptimeDate.getCurrentDate().getTime() - agoMs),
        chartPrecision,
      );
      return customRange(start, new Date(start.getTime() + lengthMs));
    },
    bucketSeconds: bucketSeconds,
  };
}

export const HISTORY_WINDOW_CASES: Array<HistoryWindowCase> = [
  // The page's presets.
  presetCase(TimeRange.PAST_ONE_HOUR, 60),
  presetCase(TimeRange.PAST_THREE_HOURS, 60),
  presetCase(TimeRange.PAST_ONE_DAY, 15 * 60),
  presetCase(TimeRange.PAST_TWO_DAYS, 30 * 60),
  presetCase(TimeRange.PAST_ONE_WEEK, 60 * 60),
  presetCase(TimeRange.PAST_TWO_WEEKS, 60 * 60, true),
  // Zooms into each of them.
  zoomCase(
    "a 1-minute zoom on the 1-hour chart",
    XAxisPrecision.EVERY_MINUTE,
    30 * MINUTE,
    MINUTE,
    5,
  ),
  zoomCase(
    "a 5-minute zoom on the 3-hour chart",
    XAxisPrecision.EVERY_MINUTE,
    2 * HOUR,
    5 * MINUTE,
    30,
  ),
  zoomCase(
    "a 20-minute zoom on the 1-hour chart",
    XAxisPrecision.EVERY_MINUTE,
    40 * MINUTE,
    20 * MINUTE,
    60,
  ),
  zoomCase(
    "a 6-hour zoom on the 1-day chart",
    XAxisPrecision.EVERY_FIFTEEN_MINUTES,
    12 * HOUR,
    6 * HOUR,
    5 * 60,
  ),
  zoomCase(
    "a 12-hour zoom on the 2-day chart",
    XAxisPrecision.EVERY_THIRTY_MINUTES,
    30 * HOUR,
    12 * HOUR,
    5 * 60,
  ),
  zoomCase(
    "a 13-hour zoom on the 1-week chart",
    XAxisPrecision.EVERY_HOUR,
    3 * DAY,
    13 * HOUR,
    15 * 60,
  ),
  zoomCase(
    "a 2-day zoom on the 1-week chart",
    XAxisPrecision.EVERY_HOUR,
    5 * DAY,
    2 * DAY,
    30 * 60,
  ),
  // Custom ranges on either side of a step's threshold.
  endingNowCase("exactly 3 hours", 3 * HOUR, 60),
  endingNowCase("3 hours and a minute", 3 * HOUR + MINUTE, 5 * 60),
  endingNowCase("exactly 12 hours", 12 * HOUR, 5 * 60),
  endingNowCase("12 hours and a minute", 12 * HOUR + MINUTE, 15 * 60),
  endingNowCase("exactly 3 days", 3 * DAY, 30 * 60),
  endingNowCase("3 days and an hour", 3 * DAY + HOUR, 60 * 60),
  endingNowCase("10 days", 10 * DAY, 60 * 60, true),
];

const SUB_DAY_CASES: Array<HistoryWindowCase> = HISTORY_WINDOW_CASES.filter(
  (windowCase: HistoryWindowCase): boolean => {
    return !windowCase.dayGrid;
  },
);

const DAY_GRID_CASES: Array<HistoryWindowCase> = HISTORY_WINDOW_CASES.filter(
  (windowCase: HistoryWindowCase): boolean => {
    return Boolean(windowCase.dayGrid);
  },
);

interface HistoryRequest {
  startTime: string;
  endTime: string;
  bucketSeconds: number;
}

interface ServedBucket {
  startMs: number;
  callCount: number;
  avgDurationMs: number;
}

/*
 * The bucket size the API serves for a request: the one asked for while the
 * window stays under 500 buckets, else its own ~60-point default. Mirrors
 * App/FeatureSet/BaseAPI/API/ServiceDependencyTimeseries.ts.
 */
function servedBucketSeconds(request: HistoryRequest): number {
  const rangeSeconds: number = Math.ceil(
    (Date.parse(request.endTime) - Date.parse(request.startTime)) / SECOND,
  );
  const requested: number = request.bucketSeconds;
  if (
    Number.isInteger(requested) &&
    requested >= 1 &&
    requested <= 30 * 24 * 60 * 60 &&
    Math.ceil(rangeSeconds / requested) + 1 <= 500
  ) {
    return requested;
  }
  return Math.min(24 * 60 * 60, Math.max(60, Math.ceil(rangeSeconds / 60)));
}

/*
 * What the API answers: a bucket every `bucketSeconds`, aligned to the epoch
 * as ClickHouse's toStartOfInterval aligns them, from the one holding the
 * window start to the one holding its end, as naive UTC strings. Every
 * bucket a different number of calls (and latency), so one drawn on top of
 * another, or not at all, cannot hide.
 */
function servedBuckets(request: HistoryRequest): Array<ServedBucket> {
  const bucketMs: number = servedBucketSeconds(request) * SECOND;
  const startMs: number = Date.parse(request.startTime);
  const endMs: number = Date.parse(request.endTime);
  const buckets: Array<ServedBucket> = [];
  for (
    let bucketStartMs: number = Math.floor(startMs / bucketMs) * bucketMs;
    bucketStartMs < endMs;
    bucketStartMs += bucketMs
  ) {
    buckets.push({
      startMs: bucketStartMs,
      callCount: buckets.length + 1,
      avgDurationMs: 1000 + buckets.length,
    });
  }
  return buckets;
}

function naiveUtc(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
}

const CHECKOUT: TopologyEntity = {
  entityKey: "service:checkout",
  entityType: "service",
  displayName: "checkout",
};
const PAYMENTS: TopologyEntity = {
  entityKey: "service:payments",
  entityType: "service",
  displayName: "payments",
};
const RELATIONSHIP: TopologyRelationship = {
  fromEntityKey: CHECKOUT.entityKey,
  toEntityKey: PAYMENTS.entityKey,
  callCount: 900,
  errorCount: 9,
  avgDurationMs: 31,
};

interface DrawnHistory {
  request: HistoryRequest;
  // What the API answered with, in order.
  served: Array<ServedBucket>;
  // The rows each chart draws: DataPointUtil's rows, one per slot.
  callRows: Array<ChartDataPoint>;
  latencyRows: Array<ChartDataPoint>;
  callsXAxis: XAxis;
  latencyXAxis: XAxis;
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function drawnRows(chartName: string): {
  rows: Array<ChartDataPoint>;
  xAxis: XAxis;
} {
  const props: { data: Array<SeriesPoints>; xAxis: XAxis; yAxis: YAxis } =
    getStandInChart(chartName).props as unknown as {
      data: Array<SeriesPoints>;
      xAxis: XAxis;
      yAxis: YAxis;
    };
  return {
    rows: DataPointUtil.getChartDataPoints({
      seriesPoints: props.data,
      xAxis: props.xAxis,
      yAxis: props.yAxis,
    }),
    xAxis: props.xAxis,
  };
}

// The values a chart plots for one series, slot by slot, skipping empty slots.
function plotted(rows: Array<ChartDataPoint>, series: string): Array<number> {
  return rows
    .map((row: ChartDataPoint): unknown => {
      return row[series];
    })
    .filter((value: unknown): value is number => {
      return typeof value === "number";
    });
}

function rowStartMs(row: ChartDataPoint | undefined): number {
  return Number(row?.[CHART_DATA_POINT_DATE_KEY]);
}

/*
 * `utcOffsetMinutes`: how far ahead of UTC the zone is at EDGE_HISTORY_NOW,
 * to prove the file really runs in it. `apiPost`: the history POST, which the
 * importing test file routes the API's post to.
 */
export default function describeEdgeHistoryBuckets(
  timezone: string,
  utcOffsetMinutes: number,
  apiPost: MockFunction,
): void {
  let served: Array<ServedBucket> = [];

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(EDGE_HISTORY_NOW);
    resetStandInCharts();
    apiPost.mockReset();
    served = [];
    apiPost.mockImplementation(async (args: unknown) => {
      const request: HistoryRequest = (args as { data: HistoryRequest }).data;
      served = servedBuckets(request);
      return {
        data: {
          buckets: served.map((bucket: ServedBucket) => {
            return {
              bucketStart: naiveUtc(bucket.startMs),
              callCount: bucket.callCount,
              errorCount: 0,
              avgDurationMs: bucket.avgDurationMs,
            };
          }),
          bucketSeconds: servedBucketSeconds(request),
          callerServiceId: null,
          calleeServiceId: null,
          truncated: false,
        },
      };
    });
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  async function openDrawer(
    windowCase: HistoryWindowCase,
  ): Promise<DrawnHistory> {
    render(
      <EdgeDetailPanel
        fromEntity={CHECKOUT}
        toEntity={PAYMENTS}
        relationship={RELATIONSHIP}
        timeRange={windowCase.range()}
        metricsWindowSeconds={900}
        onClose={(): void => {}}
      />,
    );
    await flush();
    await waitFor(() => {
      expect(screen.getByTestId(`chart ${CALLS_CHART}`)).toBeInTheDocument();
    });

    const calls: Array<Array<unknown>> = apiPost.mock.calls;
    const request: HistoryRequest = (
      calls[calls.length - 1]![0] as { data: HistoryRequest }
    ).data;
    const callsChart: { rows: Array<ChartDataPoint>; xAxis: XAxis } =
      drawnRows(CALLS_CHART);
    const latencyChart: { rows: Array<ChartDataPoint>; xAxis: XAxis } =
      drawnRows(LATENCY_CHART);
    return {
      request: request,
      served: served,
      callRows: callsChart.rows,
      latencyRows: latencyChart.rows,
      callsXAxis: callsChart.xAxis,
      latencyXAxis: latencyChart.xAxis,
    };
  }

  describe(`Topology service-call drawer (${timezone}): the history is fetched a chart slot at a time, and every bucket is drawn`, () => {
    test("the grid's wall clock and its labels' are both this zone's", () => {
      // The walker's Date setters (0 - x: UTC's offset is 0, never -0).
      expect(0 - EDGE_HISTORY_NOW.getTimezoneOffset()).toBe(utcOffsetMinutes);
      // The labels (OneUptimeDate reads the zone it guesses from the browser).
      expect(OneUptimeDate.getTimezoneOffsetInMinutes(EDGE_HISTORY_NOW)).toBe(
        utcOffsetMinutes,
      );
    });

    test.each(HISTORY_WINDOW_CASES)(
      "$name: asks for $bucketSeconds-second buckets",
      async (windowCase: HistoryWindowCase) => {
        const drawn: DrawnHistory = await openDrawer(windowCase);

        expect(drawn.request.bucketSeconds).toBe(windowCase.bucketSeconds);
        // The window itself is the range's, untouched.
        const window: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(windowCase.range());
        expect([drawn.request.startTime, drawn.request.endTime]).toEqual([
          window.startValue.toISOString(),
          window.endValue.toISOString(),
        ]);
      },
    );

    test.each(SUB_DAY_CASES)(
      "$name: the bucket asked for is exactly one slot of both charts, which are pinned to that step",
      async (windowCase: HistoryWindowCase) => {
        const drawn: DrawnHistory = await openDrawer(windowCase);

        for (const [xAxis, rows] of [
          [drawn.callsXAxis, drawn.callRows],
          [drawn.latencyXAxis, drawn.latencyRows],
        ] as Array<[XAxis, Array<ChartDataPoint>]>) {
          expect(xAxis.options.precision).toBeDefined();
          expect((rowStartMs(rows[1]) - rowStartMs(rows[0])) / SECOND).toBe(
            drawn.request.bucketSeconds,
          );
        }
      },
    );

    test.each(SUB_DAY_CASES)(
      "$name: each bucket's calls and latency are drawn once, in order - none added to a neighbour's, none dropped",
      async (windowCase: HistoryWindowCase) => {
        const drawn: DrawnHistory = await openDrawer(windowCase);

        expect(drawn.served.length).toBeGreaterThan(1);
        expect(plotted(drawn.callRows, "Calls")).toEqual(
          drawn.served.map((bucket: ServedBucket): number => {
            return bucket.callCount;
          }),
        );
        expect(plotted(drawn.latencyRows, "Avg latency")).toEqual(
          drawn.served.map((bucket: ServedBucket): number => {
            return bucket.avgDurationMs;
          }),
        );
      },
    );

    test.each(SUB_DAY_CASES)(
      "$name: the first bucket, which starts before the window, is drawn in the first slot",
      async (windowCase: HistoryWindowCase) => {
        const drawn: DrawnHistory = await openDrawer(windowCase);
        const first: ServedBucket = drawn.served[0]!;

        expect(first.startMs).toBeLessThanOrEqual(
          Date.parse(drawn.request.startTime),
        );
        // No empty slot ahead of it: it is the first slot's, alone.
        expect(rowStartMs(drawn.callRows[0])).toBeLessThanOrEqual(
          first.startMs,
        );
        expect(drawn.callRows[0]!["Calls"]).toBe(first.callCount);
        expect(drawn.latencyRows[0]!["Avg latency"]).toBe(first.avgDurationMs);
      },
    );

    test.each(HISTORY_WINDOW_CASES)(
      "$name: both charts start no later than the first bucket and end at the window's end",
      async (windowCase: HistoryWindowCase) => {
        const drawn: DrawnHistory = await openDrawer(windowCase);

        for (const xAxis of [drawn.callsXAxis, drawn.latencyXAxis]) {
          expect((xAxis.options.min as Date).getTime()).toBeLessThanOrEqual(
            drawn.served[0]!.startMs,
          );
          expect((xAxis.options.max as Date).toISOString()).toBe(
            drawn.request.endTime,
          );
        }
      },
    );

    test.each(DAY_GRID_CASES)(
      "$name: every hourly bucket lands on its day - the calls drawn add up to the calls fetched",
      async (windowCase: HistoryWindowCase) => {
        const drawn: DrawnHistory = await openDrawer(windowCase);
        const sum: (values: Array<number>) => number = (
          values: Array<number>,
        ): number => {
          return values.reduce((total: number, value: number): number => {
            return total + value;
          }, 0);
        };

        expect(drawn.request.bucketSeconds).toBe(60 * 60);
        expect(sum(plotted(drawn.callRows, "Calls"))).toBe(
          sum(
            drawn.served.map((bucket: ServedBucket): number => {
              return bucket.callCount;
            }),
          ),
        );
      },
    );
  });
}
