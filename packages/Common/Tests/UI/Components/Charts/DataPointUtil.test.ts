/**
 * @timezone UTC
 */
import { describe, expect, test } from "@jest/globals";

import ChartDataPoint, {
  CHART_DATA_POINT_DATE_KEY,
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import DataPointUtil from "../../../../UI/Components/Charts/Utils/DataPoint";
import DataPoint from "../../../../UI/Components/Charts/Types/DataPoint";
import SeriesPoints from "../../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";

/*
 * DataPointUtil produces the rows recharts is handed directly, so the KEY it
 * writes them under is a contract, not an implementation detail: the chart
 * wrappers look up CHART_DATA_POINT_X_AXIS_KEY on every row and draw nothing
 * at all when it is absent.
 *
 * That key used to be whatever the caller put in `xAxis.legend`, which made
 * the contract invisible — and the one caller that passed something else (the
 * SLO dashboard widget, with "") rendered an empty chart. These tests pin the
 * key, and pin that the legend can no longer influence it.
 *
 * Pinned to UTC via the docblock pragma above: the bucket labels come from
 * local-time formatters, so an unpinned run would assert against the
 * machine's zone.
 */

const START: Date = new Date("2026-08-10T00:00:00.000Z");
const END: Date = new Date("2026-08-10T01:00:00.000Z");

/** A 1-hour window buckets EVERY_MINUTE, inclusive of both ends. */
const EXPECTED_BUCKET_COUNT: number = 61;

const Y_AXIS: YAxis = {
  legend: "%",
  options: {
    type: YAxisType.Number,
    min: "auto",
    max: 100,
    precision: YAxisPrecision.TwoDecimals,
    formatter: (value: number): string => {
      return `${value}%`;
    },
  },
};

type BuildXAxisFunction = (data?: {
  legend?: string | undefined;
  aggregateType?: XAxisAggregateType | undefined;
}) => ChartXAxis;

const buildXAxis: BuildXAxisFunction = (
  data: {
    legend?: string | undefined;
    aggregateType?: XAxisAggregateType | undefined;
  } = {},
): ChartXAxis => {
  return {
    legend: data.legend ?? "Time",
    options: {
      type: XAxisType.Time,
      min: START,
      max: END,
      aggregateType: data.aggregateType ?? XAxisAggregateType.Average,
    },
  };
};

type MinutesAfterStartFunction = (minutes: number) => Date;

const minutesAfterStart: MinutesAfterStartFunction = (
  minutes: number,
): Date => {
  return new Date(START.getTime() + minutes * 60 * 1000);
};

type GetPointsFunction = (data: {
  seriesPoints: Array<SeriesPoints>;
  legend?: string | undefined;
  aggregateType?: XAxisAggregateType | undefined;
}) => Array<ChartDataPoint>;

const getPoints: GetPointsFunction = (data: {
  seriesPoints: Array<SeriesPoints>;
  legend?: string | undefined;
  aggregateType?: XAxisAggregateType | undefined;
}): Array<ChartDataPoint> => {
  return DataPointUtil.getChartDataPoints({
    seriesPoints: data.seriesPoints,
    xAxis: buildXAxis({
      legend: data.legend,
      aggregateType: data.aggregateType,
    }),
    yAxis: Y_AXIS,
  });
};

describe("DataPointUtil.getChartDataPoints", () => {
  describe("the x-axis row key", () => {
    test("writes the canonical key on every bucket", (): void => {
      const rows: Array<ChartDataPoint> = getPoints({ seriesPoints: [] });

      expect(rows.length).toBe(EXPECTED_BUCKET_COUNT);

      for (const row of rows) {
        expect(typeof row[CHART_DATA_POINT_X_AXIS_KEY]).toBe("string");
        expect(row[CHART_DATA_POINT_X_AXIS_KEY]).not.toBe("");
      }
    });

    test.each([
      ["an empty legend", ""],
      ["an arbitrary legend", "Timestamp"],
      ["the canonical legend", "Time"],
    ])(
      "keys rows the same way with %s",
      (_label: string, legend: string): void => {
        const rows: Array<ChartDataPoint> = getPoints({
          seriesPoints: [],
          legend: legend,
        });

        for (const row of rows) {
          expect(row[CHART_DATA_POINT_X_AXIS_KEY]).toBeDefined();
        }
      },
    );

    test("never leaks the legend into the row as a second key", (): void => {
      const rows: Array<ChartDataPoint> = getPoints({
        seriesPoints: [],
        legend: "Timestamp",
      });

      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(
          [CHART_DATA_POINT_X_AXIS_KEY, CHART_DATA_POINT_DATE_KEY].sort(),
        );
      }
    });

    test("produces identical rows whatever the legend says", (): void => {
      const series: Array<SeriesPoints> = [
        {
          seriesName: "SLI",
          data: [
            { x: minutesAfterStart(0), y: 99.1 },
            { x: minutesAfterStart(30), y: 99.4 },
          ],
        },
      ];

      const canonical: Array<ChartDataPoint> = getPoints({
        seriesPoints: series,
        legend: "Time",
      });
      const empty: Array<ChartDataPoint> = getPoints({
        seriesPoints: series,
        legend: "",
      });

      expect(empty).toEqual(canonical);
    });
  });

  describe("the hidden raw-date field", () => {
    test("carries each bucket start as epoch ms", (): void => {
      const rows: Array<ChartDataPoint> = getPoints({ seriesPoints: [] });

      expect(rows[0]![CHART_DATA_POINT_DATE_KEY]).toBe(START.getTime());
      expect(rows[rows.length - 1]![CHART_DATA_POINT_DATE_KEY]).toBe(
        END.getTime(),
      );
    });

    test("is underscore-prefixed so it can never collide with a series", (): void => {
      expect(CHART_DATA_POINT_DATE_KEY.startsWith("__")).toBe(true);
      expect(CHART_DATA_POINT_DATE_KEY).not.toBe(CHART_DATA_POINT_X_AXIS_KEY);
    });
  });

  describe("placing series values into buckets", () => {
    test("lands a point on the bucket its timestamp falls in", (): void => {
      const rows: Array<ChartDataPoint> = getPoints({
        seriesPoints: [
          {
            seriesName: "SLI",
            data: [
              { x: minutesAfterStart(0), y: 10 },
              { x: minutesAfterStart(5), y: 20 },
              { x: minutesAfterStart(60), y: 30 },
            ],
          },
        ],
      });

      expect(rows[0]!["SLI"]).toBe(10);
      expect(rows[5]!["SLI"]).toBe(20);
      expect(rows[60]!["SLI"]).toBe(30);
      // Buckets with no datapoint stay absent rather than becoming 0.
      expect(rows[1]!["SLI"]).toBeUndefined();
    });

    test("drops points outside the charted window", (): void => {
      const rows: Array<ChartDataPoint> = getPoints({
        seriesPoints: [
          {
            seriesName: "SLI",
            data: [
              { x: minutesAfterStart(-30), y: 1 },
              { x: minutesAfterStart(120), y: 2 },
              { x: minutesAfterStart(10), y: 3 },
            ],
          },
        ],
      });

      const withValues: Array<ChartDataPoint> = rows.filter(
        (row: ChartDataPoint) => {
          return row["SLI"] !== undefined;
        },
      );

      expect(withValues.length).toBe(1);
      expect(rows[10]!["SLI"]).toBe(3);
    });

    test("keeps several series side by side on one row", (): void => {
      const rows: Array<ChartDataPoint> = getPoints({
        seriesPoints: [
          {
            seriesName: "SLI",
            data: [{ x: minutesAfterStart(3), y: 99 }],
          },
          {
            seriesName: "Burn Rate",
            data: [{ x: minutesAfterStart(3), y: 1.5 }],
          },
        ],
      });

      expect(rows[3]!["SLI"]).toBe(99);
      expect(rows[3]!["Burn Rate"]).toBe(1.5);
    });
  });

  describe("rolling up several points into one bucket", () => {
    const sameBucket: Array<SeriesPoints> = [
      {
        seriesName: "SLI",
        data: [
          { x: new Date(START.getTime() + 1000), y: 10 },
          { x: new Date(START.getTime() + 2000), y: 20 },
          { x: new Date(START.getTime() + 3000), y: 60 },
        ],
      },
    ];

    test.each([
      [XAxisAggregateType.Average, 30],
      [XAxisAggregateType.Sum, 90],
      [XAxisAggregateType.Max, 60],
      [XAxisAggregateType.Min, 10],
    ])("%s", (aggregateType: XAxisAggregateType, expected: number): void => {
      const rows: Array<ChartDataPoint> = getPoints({
        seriesPoints: sameBucket,
        aggregateType: aggregateType,
      });

      expect(rows[0]!["SLI"]).toBe(expected);
    });

    /*
     * The accumulator is keyed by (series, bucket). A shared accumulator once
     * carried each bucket's running total into the next, turning an
     * "Incidents Over Time" Sum chart into a reverse-cumulative staircase.
     */
    test("resets its accumulator at every bucket boundary", (): void => {
      const rows: Array<ChartDataPoint> = getPoints({
        aggregateType: XAxisAggregateType.Sum,
        seriesPoints: [
          {
            seriesName: "Incidents",
            data: [
              { x: minutesAfterStart(0), y: 41 },
              { x: minutesAfterStart(1), y: 91 },
              { x: minutesAfterStart(2), y: 356 },
            ],
          },
        ],
      });

      expect(rows[0]!["Incidents"]).toBe(41);
      expect(rows[1]!["Incidents"]).toBe(91);
      expect(rows[2]!["Incidents"]).toBe(356);
    });
  });

  describe("empty input", () => {
    test("still returns the full bucket grid so the axis can draw", (): void => {
      const rows: Array<ChartDataPoint> = getPoints({
        seriesPoints: [{ seriesName: "SLI", data: [] as Array<DataPoint> }],
      });

      expect(rows.length).toBe(EXPECTED_BUCKET_COUNT);

      for (const row of rows) {
        expect(row["SLI"]).toBeUndefined();
      }
    });
  });
});
