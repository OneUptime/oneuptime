/** @timezone UTC */

import { describe, expect, test } from "@jest/globals";
import ChartDataPoint, {
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import DataPoint from "../../../../UI/Components/Charts/Types/DataPoint";
import DataPointUtil from "../../../../UI/Components/Charts/Utils/DataPoint";
import FormattedTimeReferenceLine from "../../../../UI/Components/Charts/ChartLibrary/Types/FormattedTimeReferenceLine";
import TimeAnnotationUtil from "../../../../UI/Components/Charts/Utils/TimeAnnotation";
import XAxisUtil from "../../../../UI/Components/Charts/Utils/XAxis";
import {
  XAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";

/*
 * The x-axis label is the identity of a bucket on both sides of the chart:
 * DataPointUtil puts a series row on the first row whose label matches, and
 * TimeAnnotationUtil resolves an event marker to a bucket the same way.
 *
 * While sub-hour labels were bare wall-clock readings, a window of a day or
 * more repeated them — so day two's data landed in day one's buckets
 * (inflating Sum and Count, and drawing the series across only the first
 * half of the chart) and day two's markers landed on day one's ticks.
 *
 * These are the end-to-end regressions for that. XAxis.test.ts holds the
 * label-uniqueness property they depend on.
 */

const HOUR_IN_MS: number = 60 * 60 * 1000;
const SERIES_NAME: string = "requests";
const WINDOW_START: Date = new Date("2026-03-02T00:00:00.000Z");

const Y_AXIS: YAxis = {
  legend: "count",
  options: {
    type: YAxisType.Number,
    min: "auto",
    max: "auto",
    precision: YAxisPrecision.NoDecimals,
    formatter: (value: number): string => {
      return String(value);
    },
  },
};

function buildXAxis(
  hours: number,
  aggregateType: XAxisAggregateType = XAxisAggregateType.Sum,
): XAxis {
  return {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: WINDOW_START,
      max: new Date(WINDOW_START.getTime() + hours * HOUR_IN_MS),
      aggregateType,
    },
  };
}

/** One datapoint on the hour, every hour, each worth 1. */
function hourlyPoints(hours: number): Array<DataPoint> {
  const points: Array<DataPoint> = [];
  for (let hour: number = 0; hour < hours; hour++) {
    points.push({
      x: new Date(WINDOW_START.getTime() + hour * HOUR_IN_MS),
      y: 1,
    });
  }
  return points;
}

function chartRows(
  xAxis: XAxis,
  points: Array<DataPoint>,
): Array<ChartDataPoint> {
  return DataPointUtil.getChartDataPoints({
    seriesPoints: [{ seriesName: SERIES_NAME, data: points }],
    xAxis,
    yAxis: Y_AXIS,
  });
}

function rowsCarryingData(rows: Array<ChartDataPoint>): Array<ChartDataPoint> {
  return rows.filter((row: ChartDataPoint): boolean => {
    return row[SERIES_NAME] !== undefined;
  });
}

describe("series data does not merge across days", () => {
  test("48 hourly points land in 48 separate buckets, one each", () => {
    /*
     * Measured before the fix: 24 of the 48 points were folded onto the
     * other 24, so the largest bucket summed to 2 and the last row
     * carrying any data was index 46 of 96 — the series stopped halfway
     * across the chart.
     */
    const xAxis: XAxis = buildXAxis(48);
    const rows: Array<ChartDataPoint> = chartRows(xAxis, hourlyPoints(48));
    const withData: Array<ChartDataPoint> = rowsCarryingData(rows);

    expect(rows).toHaveLength(97);
    expect(withData).toHaveLength(48);

    for (const row of withData) {
      expect(row[SERIES_NAME]).toBe(1);
    }
  });

  test("the series is drawn across the whole window, not just day one", () => {
    const xAxis: XAxis = buildXAxis(48);
    const rows: Array<ChartDataPoint> = chartRows(xAxis, hourlyPoints(48));

    const lastRowWithData: number = rows.reduce(
      (last: number, row: ChartDataPoint, index: number): number => {
        return row[SERIES_NAME] === undefined ? last : index;
      },
      -1,
    );

    // Hourly points on a half-hourly axis reach the second-to-last tick.
    expect(lastRowWithData).toBe(rows.length - 3);
  });

  test("a Sum aggregate is not inflated by a merged day", () => {
    const xAxis: XAxis = buildXAxis(48, XAxisAggregateType.Sum);
    const rows: Array<ChartDataPoint> = chartRows(xAxis, hourlyPoints(48));

    const largestBucket: number = rowsCarryingData(rows).reduce(
      (largest: number, row: ChartDataPoint): number => {
        return Math.max(largest, Number(row[SERIES_NAME]));
      },
      0,
    );

    // One point per bucket, so no bucket may sum to more than one point.
    expect(largestBucket).toBe(1);
  });

  test("day two's points keep their own buckets, on their own labels", () => {
    const xAxis: XAxis = buildXAxis(48);
    const rows: Array<ChartDataPoint> = chartRows(xAxis, hourlyPoints(48));

    const labelsWithData: Array<string> = rowsCarryingData(rows).map(
      (row: ChartDataPoint): string => {
        return String(row[CHART_DATA_POINT_X_AXIS_KEY]);
      },
    );

    expect(labelsWithData).toContain("02 Mar, 06:00");
    expect(labelsWithData).toContain("03 Mar, 06:00");
    expect(new Set(labelsWithData).size).toBe(labelsWithData.length);
  });

  test("a 24 hour window keeps its last point out of its first bucket", () => {
    /*
     * The narrower version of the same bug: only the first and last tick
     * collided, so a datapoint at the very end of the window was added to
     * the very first bucket.
     */
    const xAxis: XAxis = buildXAxis(24);
    const rows: Array<ChartDataPoint> = chartRows(xAxis, [
      { x: WINDOW_START, y: 1 },
      { x: new Date(WINDOW_START.getTime() + 24 * HOUR_IN_MS), y: 1 },
    ]);

    const withData: Array<ChartDataPoint> = rowsCarryingData(rows);

    expect(withData).toHaveLength(2);
    expect(withData[0]![SERIES_NAME]).toBe(1);
    expect(withData[1]![SERIES_NAME]).toBe(1);
  });

  test("a window short enough to be unambiguous still buckets correctly", () => {
    // The unchanged path, so the fix cannot have moved it.
    const xAxis: XAxis = buildXAxis(6);
    const rows: Array<ChartDataPoint> = chartRows(xAxis, hourlyPoints(6));

    expect(rowsCarryingData(rows)).toHaveLength(6);
    expect(String(rows[0]![CHART_DATA_POINT_X_AXIS_KEY])).toBe("00:00");
  });
});

describe("event markers do not merge across days", () => {
  function bucketOfMarker(xAxis: XAxis, date: Date): number {
    const formatted: Array<FormattedTimeReferenceLine> =
      TimeAnnotationUtil.formatTimeReferenceLines({
        timeReferenceLines: [{ date, label: "event" }],
        xAxis,
      });
    expect(formatted).toHaveLength(1);
    return formatted[0]!.bucketIndex;
  }

  test("a day-two marker resolves to a day-two bucket", () => {
    const xAxis: XAxis = buildXAxis(48);

    const dayOne: number = bucketOfMarker(
      xAxis,
      new Date(WINDOW_START.getTime() + 6 * HOUR_IN_MS),
    );
    const dayTwo: number = bucketOfMarker(
      xAxis,
      new Date(WINDOW_START.getTime() + 30 * HOUR_IN_MS),
    );

    expect(dayTwo).toBeGreaterThan(dayOne);
    // 30h in, on a half-hourly axis, is the 60th interval.
    expect(dayTwo).toBe(60);
  });

  test("a marker still lands on the bucket its own data lands in", () => {
    /*
     * The invariant both sides have to keep. It held before the fix too —
     * they were consistently wrong together — and it has to keep holding
     * now that they are consistently right.
     */
    const xAxis: XAxis = buildXAxis(48);
    const labels: Array<string> = XAxisUtil.getPrecisionIntervals({
      xAxisMin: xAxis.options.min,
      xAxisMax: xAxis.options.max,
    }).map(
      XAxisUtil.getFormatter({
        xAxisMin: xAxis.options.min,
        xAxisMax: xAxis.options.max,
      }),
    );

    for (const hoursIn of [0, 6, 23, 24, 30, 47]) {
      const at: Date = new Date(WINDOW_START.getTime() + hoursIn * HOUR_IN_MS);

      const rows: Array<ChartDataPoint> = chartRows(xAxis, [{ x: at, y: 1 }]);
      const dataBucket: number = rows.findIndex(
        (row: ChartDataPoint): boolean => {
          return row[SERIES_NAME] !== undefined;
        },
      );

      expect(dataBucket).toBeGreaterThanOrEqual(0);
      expect(bucketOfMarker(xAxis, at)).toBe(dataBucket);
      // And the label the renderer shows agrees with both.
      expect(labels[dataBucket]).toBe(
        String(rows[dataBucket]![CHART_DATA_POINT_X_AXIS_KEY]),
      );
    }
  });
});
