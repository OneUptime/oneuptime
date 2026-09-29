/** @timezone UTC */
import { describe, expect, test } from "@jest/globals";
import DataPointUtil from "../../../../UI/Components/Charts/Utils/DataPoint";
import XAxisUtil from "../../../../UI/Components/Charts/Utils/XAxis";
import ChartDataPoint, {
  CHART_DATA_POINT_DATE_KEY,
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import { getChartBucketWindow } from "../../../../UI/Components/Charts/ChartLibrary/Utils/UseChartRangeSelection";
import SeriesPoint from "../../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";

/*
 * Issue #4105 review finding: a drag zoomed a window offset from the bars
 * the reader selected, by up to one bucket.
 *
 * A rolling range starts at "now minus N" - 10:23:11, say - so the chart's
 * slots are walked from 10:23:11 in whole steps. Points join rows by their
 * formatted label, which is on the grid, so the row labelled "10:00" draws
 * the 10:00 bucket; but the row used to carry its SLOT start, 10:23:11, and
 * a drag across the 10:00 and 11:00 bars zoomed [10:23:11, 12:23:11): it
 * dropped the first 23 minutes of the spike hour and added the unselected
 * noon hour. On a week of hourly bars that can cut out the very spike the
 * reader aimed at.
 *
 * Rows now carry the start of the bucket they draw. These tests build rows
 * with the real DataPointUtil and resolve a drag with the real
 * getChartBucketWindow the line, area and bar charts use.
 */

const HOUR_MS: number = 60 * 60 * 1000;
const MINUTE_MS: number = 60 * 1000;

const Y_AXIS: YAxis = {
  legend: "",
  options: {
    type: YAxisType.Number,
    min: 0,
    max: "auto",
    precision: YAxisPrecision.NoDecimals,
    formatter: (value: number): string => {
      return String(value);
    },
  },
};

function xAxis(
  min: Date,
  max: Date,
  precision?: XAxisPrecision | undefined,
): ChartXAxis {
  return {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: min,
      max: max,
      aggregateType: XAxisAggregateType.Sum,
      ...(precision ? { precision: precision } : {}),
    },
  };
}

// One point at the start of every bucket, the way the analytics server returns them.
function bucketedSeries(
  firstBucket: Date,
  count: number,
  stepMs: number,
  valueAt: (index: number) => number,
): Array<SeriesPoint> {
  return [
    {
      seriesName: "spend",
      data: Array.from({ length: count }, (_: unknown, index: number) => {
        return {
          x: new Date(firstBucket.getTime() + index * stepMs),
          y: valueAt(index),
        };
      }),
    },
  ];
}

function rowIndexHolding(
  rows: Array<ChartDataPoint>,
  seriesName: string,
  value: number,
): number {
  const index: number = rows.findIndex((row: ChartDataPoint) => {
    return row[seriesName] === value;
  });
  if (index < 0) {
    throw new Error(`no row holds ${value}`);
  }
  return index;
}

describe("chart rows carry the start of the bucket they draw", () => {
  test("a week of hourly bars from an off-the-hour now: every row starts on the hour", () => {
    // Past 1 Week, resolved at 12:23:11 today.
    const windowEnd: Date = new Date("2026-09-28T12:23:11.000Z");
    const windowStart: Date = new Date(windowEnd.getTime() - 7 * 24 * HOUR_MS);

    const rows: Array<ChartDataPoint> = DataPointUtil.getChartDataPoints({
      seriesPoints: bucketedSeries(
        new Date("2026-09-21T13:00:00.000Z"),
        7 * 24 - 1,
        HOUR_MS,
        () => {
          return 1;
        },
      ),
      xAxis: xAxis(windowStart, windowEnd, XAxisPrecision.EVERY_HOUR),
      yAxis: Y_AXIS,
    });

    expect(rows.length).toBeGreaterThan(100);
    for (const row of rows) {
      expect((row[CHART_DATA_POINT_DATE_KEY] as number) % HOUR_MS).toBe(0);
    }
  });

  test("a drag across the spike hour and the next zooms exactly those two hours", () => {
    const windowEnd: Date = new Date("2026-09-28T12:23:11.000Z");
    const windowStart: Date = new Date(windowEnd.getTime() - 7 * 24 * HOUR_MS);
    const firstBucket: Date = new Date("2026-09-21T13:00:00.000Z");
    // A spike in the 10:00 bucket on the 27th; 11:00 is quiet; noon is loud.
    const spikeAt: number = Date.parse("2026-09-27T10:00:00.000Z");

    const rows: Array<ChartDataPoint> = DataPointUtil.getChartDataPoints({
      seriesPoints: bucketedSeries(
        firstBucket,
        7 * 24 - 1,
        HOUR_MS,
        (index: number): number => {
          const at: number = firstBucket.getTime() + index * HOUR_MS;
          if (at === spikeAt) {
            return 900;
          }
          if (at === spikeAt + 2 * HOUR_MS) {
            return 700;
          }
          return 1;
        },
      ),
      xAxis: xAxis(windowStart, windowEnd, XAxisPrecision.EVERY_HOUR),
      yAxis: Y_AXIS,
    });

    const spikeRow: number = rowIndexHolding(rows, "spend", 900);
    const selected: { start: Date; end: Date } | null = getChartBucketWindow(
      rows,
      spikeRow,
      spikeRow + 1,
    );

    expect(selected?.start.toISOString()).toBe("2026-09-27T10:00:00.000Z");
    expect(selected?.end.toISOString()).toBe("2026-09-27T12:00:00.000Z");
    // The loud noon bucket was not selected, so it is not in the zoom.
    expect(rows[spikeRow + 2]!["spend"]).toBe(700);
    expect(rows[spikeRow + 2]![CHART_DATA_POINT_DATE_KEY]).toBe(
      Date.parse("2026-09-27T12:00:00.000Z"),
    );
  });

  test("a bucket click opens exactly the bucket the bar draws", () => {
    const windowEnd: Date = new Date("2026-09-28T12:23:11.000Z");
    const windowStart: Date = new Date(windowEnd.getTime() - 7 * 24 * HOUR_MS);
    const rows: Array<ChartDataPoint> = DataPointUtil.getChartDataPoints({
      seriesPoints: bucketedSeries(
        new Date("2026-09-21T13:00:00.000Z"),
        7 * 24 - 1,
        HOUR_MS,
        (index: number): number => {
          return index;
        },
      ),
      xAxis: xAxis(windowStart, windowEnd, XAxisPrecision.EVERY_HOUR),
      yAxis: Y_AXIS,
    });

    const row: number = rowIndexHolding(rows, "spend", 50);
    const clicked: { start: Date; end: Date } | null = getChartBucketWindow(
      rows,
      row,
      row,
    );

    // Point 50 is the bucket 50 hours after the first one.
    expect(clicked?.start.toISOString()).toBe("2026-09-23T15:00:00.000Z");
    expect(clicked?.end.toISOString()).toBe("2026-09-23T16:00:00.000Z");
  });

  test("the default Past 30 Minutes (minute buckets, seconds into the minute) no longer adds a partial minute", () => {
    const windowEnd: Date = new Date("2026-09-28T12:23:41.000Z");
    const windowStart: Date = new Date(windowEnd.getTime() - 30 * MINUTE_MS);
    const firstBucket: Date = new Date("2026-09-28T11:54:00.000Z");

    const rows: Array<ChartDataPoint> = DataPointUtil.getChartDataPoints({
      seriesPoints: bucketedSeries(firstBucket, 29, MINUTE_MS, (i: number) => {
        return i + 1;
      }),
      xAxis: xAxis(windowStart, windowEnd),
      yAxis: Y_AXIS,
    });

    const from: number = rowIndexHolding(rows, "spend", 5);
    const to: number = rowIndexHolding(rows, "spend", 8);
    const selected: { start: Date; end: Date } | null = getChartBucketWindow(
      rows,
      from,
      to,
    );

    expect(selected?.start.toISOString()).toBe("2026-09-28T11:58:00.000Z");
    expect(selected?.end.toISOString()).toBe("2026-09-28T12:02:00.000Z");
  });

  test("a window already on the grid is unchanged (MetricView aligns its own)", () => {
    const windowStart: Date = new Date("2026-09-28T10:00:00.000Z");
    const windowEnd: Date = new Date("2026-09-28T11:00:00.000Z");

    const rows: Array<ChartDataPoint> = DataPointUtil.getChartDataPoints({
      seriesPoints: bucketedSeries(windowStart, 60, MINUTE_MS, () => {
        return 1;
      }),
      xAxis: xAxis(windowStart, windowEnd, XAxisPrecision.EVERY_MINUTE),
      yAxis: Y_AXIS,
    });

    rows.forEach((row: ChartDataPoint, index: number) => {
      expect(row[CHART_DATA_POINT_DATE_KEY]).toBe(
        windowStart.getTime() + index * MINUTE_MS,
      );
    });
  });

  test("labels are untouched: the row labelled 10:00 still draws the 10:00 bucket", () => {
    const windowEnd: Date = new Date("2026-09-28T12:23:11.000Z");
    const windowStart: Date = new Date(windowEnd.getTime() - 6 * HOUR_MS);
    const formatter: (value: Date) => string = XAxisUtil.getFormatter({
      xAxisMin: windowStart,
      xAxisMax: windowEnd,
      precision: XAxisPrecision.EVERY_HOUR,
    });

    const rows: Array<ChartDataPoint> = DataPointUtil.getChartDataPoints({
      seriesPoints: bucketedSeries(
        new Date("2026-09-28T07:00:00.000Z"),
        6,
        HOUR_MS,
        (i: number) => {
          return 100 + i;
        },
      ),
      xAxis: xAxis(windowStart, windowEnd, XAxisPrecision.EVERY_HOUR),
      yAxis: Y_AXIS,
    });

    for (const row of rows) {
      const bucketStart: Date = new Date(
        row[CHART_DATA_POINT_DATE_KEY] as number,
      );
      // The label and the date name the same bucket.
      expect(row[CHART_DATA_POINT_X_AXIS_KEY]).toBe(formatter(bucketStart));
    }
    const tenOClock: ChartDataPoint | undefined = rows.find(
      (row: ChartDataPoint) => {
        return (
          row[CHART_DATA_POINT_DATE_KEY] ===
          Date.parse("2026-09-28T10:00:00.000Z")
        );
      },
    );
    expect(tenOClock?.["spend"]).toBe(103);
  });
});

describe("XAxisUtil.getBucketStart", () => {
  const AT: Date = new Date("2026-09-28T13:47:38.512Z");

  test.each([
    [XAxisPrecision.EVERY_SECOND, "2026-09-28T13:47:38.000Z"],
    [XAxisPrecision.EVERY_FIVE_SECONDS, "2026-09-28T13:47:35.000Z"],
    [XAxisPrecision.EVERY_TEN_SECONDS, "2026-09-28T13:47:30.000Z"],
    [XAxisPrecision.EVERY_THIRTY_SECONDS, "2026-09-28T13:47:30.000Z"],
    [XAxisPrecision.EVERY_MINUTE, "2026-09-28T13:47:00.000Z"],
    [XAxisPrecision.EVERY_FIVE_MINUTES, "2026-09-28T13:45:00.000Z"],
    [XAxisPrecision.EVERY_TEN_MINUTES, "2026-09-28T13:40:00.000Z"],
    [XAxisPrecision.EVERY_FIFTEEN_MINUTES, "2026-09-28T13:45:00.000Z"],
    [XAxisPrecision.EVERY_THIRTY_MINUTES, "2026-09-28T13:30:00.000Z"],
    [XAxisPrecision.EVERY_HOUR, "2026-09-28T13:00:00.000Z"],
    [XAxisPrecision.EVERY_TWO_HOURS, "2026-09-28T12:00:00.000Z"],
    [XAxisPrecision.EVERY_THREE_HOURS, "2026-09-28T12:00:00.000Z"],
    [XAxisPrecision.EVERY_SIX_HOURS, "2026-09-28T12:00:00.000Z"],
    [XAxisPrecision.EVERY_TWELVE_HOURS, "2026-09-28T12:00:00.000Z"],
    [XAxisPrecision.EVERY_DAY, "2026-09-28T00:00:00.000Z"],
  ])("%s floors to %s", (precision: XAxisPrecision, expected: string) => {
    expect(XAxisUtil.getBucketStart(AT, precision).toISOString()).toBe(
      expected,
    );
  });

  test("the coarser tiers keep the slot start", () => {
    for (const precision of [
      XAxisPrecision.EVERY_TWO_DAYS,
      XAxisPrecision.EVERY_WEEK,
      XAxisPrecision.EVERY_MONTH,
      XAxisPrecision.EVERY_YEAR,
    ]) {
      expect(XAxisUtil.getBucketStart(AT, precision).getTime()).toBe(
        AT.getTime(),
      );
    }
  });

  test("never mutates the date it is given", () => {
    const at: Date = new Date(AT.getTime());
    XAxisUtil.getBucketStart(at, XAxisPrecision.EVERY_HOUR);
    expect(at.getTime()).toBe(AT.getTime());
  });

  test("every tier's bucket start formats to the same label as the value", () => {
    const min: Date = new Date("2026-09-28T00:00:00.000Z");
    for (const [precision, max] of [
      [XAxisPrecision.EVERY_MINUTE, "2026-09-28T01:00:00.000Z"],
      [XAxisPrecision.EVERY_FIFTEEN_MINUTES, "2026-09-29T00:00:00.000Z"],
      [XAxisPrecision.EVERY_HOUR, "2026-10-04T00:00:00.000Z"],
      [XAxisPrecision.EVERY_SIX_HOURS, "2026-10-12T00:00:00.000Z"],
    ] as Array<[XAxisPrecision, string]>) {
      const formatter: (value: Date) => string = XAxisUtil.getFormatter({
        xAxisMin: min,
        xAxisMax: new Date(max),
        precision: precision,
      });
      expect(formatter(XAxisUtil.getBucketStart(AT, precision))).toBe(
        formatter(AT),
      );
    }
  });
});
