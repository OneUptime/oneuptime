/** @timezone UTC */

import { describe, expect, test } from "@jest/globals";

import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import ChartDataPoint, {
  CHART_DATA_POINT_DATE_KEY,
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import DataPoint from "../../../../UI/Components/Charts/Types/DataPoint";
import DataPointUtil from "../../../../UI/Components/Charts/Utils/DataPoint";
import FormattedTimeReferenceLine from "../../../../UI/Components/Charts/ChartLibrary/Types/FormattedTimeReferenceLine";
import SeriesPoints from "../../../../UI/Components/Charts/Types/SeriesPoints";
import TimeAnnotationUtil from "../../../../UI/Components/Charts/Utils/TimeAnnotation";
import XAxisUtil from "../../../../UI/Components/Charts/Utils/XAxis";
import {
  XAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";

/*
 * The reported bug: an alert's Metrics tab drew each chart with roughly a
 * fifth of its width blank on the right, the plotted area stopping a whole
 * minute before the axis did.
 *
 * Two independent defects produced it, and the captured request shows both.
 * The window was 2026-09-04T13:37:00.000Z .. 13:42:00.243Z — five minutes
 * plus 243 ms, because a telemetry snapshot window ends at the instant the
 * alert was declared, and that instant happened to fall just past a minute
 * boundary. The server bucketed it by Minute and returned five rows
 * (13:37..13:41).
 *
 *  1. The chart built its grid from a SECOND ladder keyed on the window's
 *     duration, whose finest tiers are sub-minute even though no analytics
 *     bucket is. 300.243 s landed on the 30-second tier: eleven slots over
 *     five one-minute rows, so every other slot was structurally empty.
 *  2. The grid walks inclusively to the window end, so its last slot is the
 *     start of the bucket CONTAINING that end. Here that bucket is
 *     [13:42:00, 13:43:00) and the window reaches 243 ms into it — the
 *     server could only fill it from a sample inside that sliver, and did
 *     not. Because the recharts x-axis is categorical over exactly these
 *     slots, the empty one stretched the axis a full bucket past the last
 *     real point.
 *
 * Pinned to UTC via the docblock pragma: bucket labels come from local-time
 * formatters, so an unpinned run would assert against the machine's zone.
 */

const SERIES_NAME: string = "resource.k8s.pod.name=kubernetes-agent-logs-7t88f";

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

/** The captured alert-snapshot window, verbatim. */
const ALERT_WINDOW_START: Date = new Date("2026-09-04T13:37:00.000Z");
const ALERT_WINDOW_END: Date = new Date("2026-09-04T13:42:00.243Z");

const Y_AXIS: YAxis = {
  legend: "%",
  options: {
    type: YAxisType.Number,
    min: "auto",
    max: "auto",
    precision: YAxisPrecision.TwoDecimals,
    formatter: (value: number): string => {
      return String(value);
    },
  },
};

type BuildXAxisFunction = (data: {
  min: Date;
  max: Date;
  precision?: XAxisPrecision | undefined;
  aggregateType?: XAxisAggregateType | undefined;
}) => XAxis;

const buildXAxis: BuildXAxisFunction = (data: {
  min: Date;
  max: Date;
  precision?: XAxisPrecision | undefined;
  aggregateType?: XAxisAggregateType | undefined;
}): XAxis => {
  return {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: data.min,
      max: data.max,
      aggregateType: data.aggregateType ?? XAxisAggregateType.Average,
      precision: data.precision,
    },
  };
};

type ChartRowsFunction = (
  xAxis: XAxis,
  seriesPoints: Array<SeriesPoints>,
) => Array<ChartDataPoint>;

const chartRows: ChartRowsFunction = (
  xAxis: XAxis,
  seriesPoints: Array<SeriesPoints>,
): Array<ChartDataPoint> => {
  return DataPointUtil.getChartDataPoints({
    seriesPoints,
    xAxis,
    yAxis: Y_AXIS,
  });
};

type HasValueFunction = (row: ChartDataPoint | undefined) => boolean;

/*
 * A row "carries data" when it holds any key beyond the two reserved ones
 * the grid itself writes (the formatted label and the raw bucket start).
 */
const hasValue: HasValueFunction = (
  row: ChartDataPoint | undefined,
): boolean => {
  if (!row) {
    return false;
  }
  return Object.keys(row).some((key: string): boolean => {
    return (
      key !== CHART_DATA_POINT_X_AXIS_KEY && key !== CHART_DATA_POINT_DATE_KEY
    );
  });
};

type SeriesEveryFunction = (data: {
  from: Date;
  count: number;
  stepMs: number;
  value?: number | undefined;
  seriesName?: string | undefined;
}) => Array<SeriesPoints>;

/** `count` points on a fixed step, i.e. what the server returns for buckets. */
const seriesEvery: SeriesEveryFunction = (data: {
  from: Date;
  count: number;
  stepMs: number;
  value?: number | undefined;
  seriesName?: string | undefined;
}): Array<SeriesPoints> => {
  const points: Array<DataPoint> = [];
  for (let index: number = 0; index < data.count; index++) {
    points.push({
      x: new Date(data.from.getTime() + index * data.stepMs),
      y: data.value ?? 1,
    });
  }
  return [{ seriesName: data.seriesName ?? SERIES_NAME, data: points }];
};

describe("the reported alert-snapshot chart", () => {
  /*
   * MetricCharts pins the grid to the interval the query was bucketed at,
   * which for this window is Minute.
   */
  const ALERT_X_AXIS: XAxis = buildXAxis({
    min: ALERT_WINDOW_START,
    max: ALERT_WINDOW_END,
    precision: XAxisPrecision.EVERY_MINUTE,
  });

  /** The five rows the server actually returned, replayed. */
  const ALERT_SERIES: Array<SeriesPoints> = seriesEvery({
    from: ALERT_WINDOW_START,
    count: 5,
    stepMs: MINUTE_IN_MS,
    value: 0.17,
  });

  test("plots every slot on the axis — no trailing gap at all", () => {
    const rows: Array<ChartDataPoint> = chartRows(ALERT_X_AXIS, ALERT_SERIES);

    /*
     * This is the whole bug in one assertion. Before the fix the chart drew
     * eleven slots and filled five, so the series ended at 80% of the plot
     * width. Every slot now carries a value, so the area reaches the right
     * edge.
     */
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(hasValue(row)).toBe(true);
    }
  });

  test("the last plotted bucket is 13:41, the last one the query could fill", () => {
    const rows: Array<ChartDataPoint> = chartRows(ALERT_X_AXIS, ALERT_SERIES);
    const lastRow: ChartDataPoint = rows[rows.length - 1]!;

    expect(lastRow[CHART_DATA_POINT_DATE_KEY]).toBe(
      new Date("2026-09-04T13:41:00.000Z").getTime(),
    );
    expect(lastRow[SERIES_NAME]).toBe(0.17);
  });

  test("never emits a 13:42 slot, which only a sample inside 243ms could fill", () => {
    const rows: Array<ChartDataPoint> = chartRows(ALERT_X_AXIS, ALERT_SERIES);

    const bucketStarts: Array<number> = rows.map(
      (row: ChartDataPoint): number => {
        return Number(row[CHART_DATA_POINT_DATE_KEY]);
      },
    );

    expect(bucketStarts).not.toContain(
      new Date("2026-09-04T13:42:00.000Z").getTime(),
    );
  });

  test("pinning the grid removes the half-empty 30-second comb", () => {
    /*
     * Defect 1 on its own. Unpinned, 300.243 s falls on the sub-minute tier
     * and the grid is twice as fine as anything the server can return, so
     * five of the eleven slots are interior blanks the curve interpolates
     * across.
     */
    const unpinned: Array<ChartDataPoint> = chartRows(
      buildXAxis({ min: ALERT_WINDOW_START, max: ALERT_WINDOW_END }),
      ALERT_SERIES,
    );
    const unpinnedBlanks: number = unpinned.filter(
      (row: ChartDataPoint): boolean => {
        return !hasValue(row);
      },
    ).length;

    expect(
      XAxisUtil.getPrecision({
        xAxisMin: ALERT_WINDOW_START,
        xAxisMax: ALERT_WINDOW_END,
      }),
    ).toBe(XAxisPrecision.EVERY_THIRTY_SECONDS);
    expect(unpinnedBlanks).toBeGreaterThan(0);

    const pinned: Array<ChartDataPoint> = chartRows(ALERT_X_AXIS, ALERT_SERIES);
    const pinnedBlanks: number = pinned.filter(
      (row: ChartDataPoint): boolean => {
        return !hasValue(row);
      },
    ).length;

    expect(pinnedBlanks).toBe(0);
  });

  test("the declared-at marker still renders, on the last bucket on the axis", () => {
    /*
     * The marker sits at the window end, which is inside the bucket the grid
     * no longer draws. Trimming a slot must not push a marker off the chart
     * it exists to annotate — it resolves to the last bucket still on the
     * axis, which is where its data is.
     */
    const rows: Array<ChartDataPoint> = chartRows(ALERT_X_AXIS, ALERT_SERIES);
    const formatted: Array<FormattedTimeReferenceLine> =
      TimeAnnotationUtil.formatTimeReferenceLines({
        timeReferenceLines: [{ date: ALERT_WINDOW_END, label: "Declared" }],
        xAxis: ALERT_X_AXIS,
        seriesPoints: ALERT_SERIES,
      });

    expect(formatted).toHaveLength(1);
    expect(formatted[0]!.bucketIndex).toBe(rows.length - 1);
    expect(formatted[0]!.formattedX).toBe(
      String(rows[rows.length - 1]![CHART_DATA_POINT_X_AXIS_KEY]),
    );
  });

  test("annotations index into the same array the rows were built from", () => {
    /*
     * The invariant that makes trimming safe to do in the shared walker.
     * Markers are resolved to an INDEX, so the two sides must agree on the
     * slot count exactly — a marker one bucket in has to sit on the row one
     * bucket in.
     */
    const rows: Array<ChartDataPoint> = chartRows(ALERT_X_AXIS, ALERT_SERIES);

    for (let index: number = 0; index < rows.length; index++) {
      const at: Date = new Date(
        ALERT_WINDOW_START.getTime() + index * MINUTE_IN_MS,
      );
      const formatted: Array<FormattedTimeReferenceLine> =
        TimeAnnotationUtil.formatTimeReferenceLines({
          timeReferenceLines: [{ date: at, label: "event" }],
          xAxis: ALERT_X_AXIS,
          seriesPoints: ALERT_SERIES,
        });

      expect(formatted).toHaveLength(1);
      expect(formatted[0]!.bucketIndex).toBe(index);
    }
  });
});

describe("which trailing slot gets dropped", () => {
  test("a window ending exactly on a bucket boundary drops its empty tail slot", () => {
    /*
     * Zero coverage rather than the alert's 243 ms, and the same conclusion:
     * [14:00:00, 14:01:00) is not in a window that ends at 14:00:00.000.
     */
    const start: Date = new Date("2026-09-04T13:00:00.000Z");
    const end: Date = new Date("2026-09-04T14:00:00.000Z");
    const rows: Array<ChartDataPoint> = chartRows(
      buildXAxis({
        min: start,
        max: end,
        precision: XAxisPrecision.EVERY_MINUTE,
      }),
      seriesEvery({ from: start, count: 60, stepMs: MINUTE_IN_MS }),
    );

    expect(rows).toHaveLength(60);
    expect(hasValue(rows[rows.length - 1])).toBe(true);
    expect(rows[rows.length - 1]![CHART_DATA_POINT_DATE_KEY]).toBe(
      new Date("2026-09-04T13:59:00.000Z").getTime(),
    );
  });

  test("a populated in-progress bucket is kept, so live charts stay live", () => {
    /*
     * The opposite failure, and the reason the rule is not simply "drop any
     * slot whose bucket runs past the window end". A now-anchored chart's
     * newest bucket is always partial; dropping it would make every live
     * chart lag by a whole bucket.
     */
    const start: Date = new Date("2026-09-04T13:42:00.000Z");
    const end: Date = new Date("2026-09-04T14:42:37.000Z");
    const series: Array<SeriesPoints> = seriesEvery({
      from: start,
      count: 61,
      stepMs: MINUTE_IN_MS,
    });
    const rows: Array<ChartDataPoint> = chartRows(
      buildXAxis({
        min: start,
        max: end,
        precision: XAxisPrecision.EVERY_MINUTE,
      }),
      series,
    );

    expect(rows).toHaveLength(61);
    expect(hasValue(rows[rows.length - 1])).toBe(true);
    expect(rows[rows.length - 1]![CHART_DATA_POINT_DATE_KEY]).toBe(
      new Date("2026-09-04T14:42:00.000Z").getTime(),
    );
  });

  test("an EMPTY bucket the window mostly spans is kept — an empty bar is information", () => {
    /*
     * "Last 7 days" of incident counts, read mid-afternoon. Today's bucket
     * has nothing in it, which means "nothing today" — a fact the chart has
     * to keep showing. Only a bucket the window barely touches is dropped.
     *
     * This is also the case that catches measuring coverage off the slot's
     * DATE. The grid is anchored at the window start, so the final slot is
     * dated 4 Sep 14:42 and sits a hair below the window end — 0% coverage
     * by that reading, and the bar would be dropped. Its LABEL is "04 Sep",
     * the bucket [4 Sep 00:00, 5 Sep 00:00), of which the window really does
     * cover nearly fifteen hours.
     */
    const end: Date = new Date("2026-09-04T14:42:00.000Z");
    const start: Date = new Date(end.getTime() - 7 * DAY_IN_MS);
    const series: Array<SeriesPoints> = seriesEvery({
      from: start,
      count: 7,
      stepMs: DAY_IN_MS,
      seriesName: "Incidents",
    });

    const rows: Array<ChartDataPoint> = chartRows(
      buildXAxis({
        min: start,
        max: end,
        precision: XAxisPrecision.EVERY_DAY,
        aggregateType: XAxisAggregateType.Sum,
      }),
      series,
    );

    // 8 day labels, and today's — empty — is still one of them.
    expect(rows).toHaveLength(8);
    expect(hasValue(rows[rows.length - 1])).toBe(false);
  });

  test("a BOUNDARY-aligned daily grid still keeps a mostly-covered empty day", () => {
    /*
     * The aligned twin of the case above, so "keep" is not an accident of
     * mid-bucket anchoring. Starting the window at midnight puts every slot
     * on a real day boundary, so the final slot's coverage is measured
     * directly — and 14h42m of a 24-hour day is well over half, so an empty
     * "today" is still a day the chart is entitled to show.
     */
    const start: Date = new Date("2026-08-28T00:00:00.000Z");
    const end: Date = new Date("2026-09-04T14:42:00.000Z");
    const series: Array<SeriesPoints> = seriesEvery({
      from: start,
      count: 7,
      stepMs: DAY_IN_MS,
      seriesName: "Incidents",
    });

    const rows: Array<ChartDataPoint> = chartRows(
      buildXAxis({
        min: start,
        max: end,
        precision: XAxisPrecision.EVERY_DAY,
        aggregateType: XAxisAggregateType.Sum,
      }),
      series,
    );

    expect(rows).toHaveLength(8);
    expect(hasValue(rows[rows.length - 1])).toBe(false);
    expect(rows[rows.length - 1]![CHART_DATA_POINT_DATE_KEY]).toBe(
      new Date("2026-09-04T00:00:00.000Z").getTime(),
    );
  });

  test("a boundary-aligned day the window BARELY enters is dropped", () => {
    /*
     * The same aligned daily grid read just after midnight: today's bucket is
     * minutes old, empty, and nothing but a blank bar stretching the axis a
     * whole day past the last real one.
     */
    const start: Date = new Date("2026-08-28T00:00:00.000Z");
    const end: Date = new Date("2026-09-04T00:04:00.000Z");
    const series: Array<SeriesPoints> = seriesEvery({
      from: start,
      count: 7,
      stepMs: DAY_IN_MS,
      seriesName: "Incidents",
    });

    const rows: Array<ChartDataPoint> = chartRows(
      buildXAxis({
        min: start,
        max: end,
        precision: XAxisPrecision.EVERY_DAY,
        aggregateType: XAxisAggregateType.Sum,
      }),
      series,
    );

    expect(rows).toHaveLength(7);
    expect(hasValue(rows[rows.length - 1])).toBe(true);
  });

  test("a real trailing outage stays visible — at most one slot is ever dropped", () => {
    /*
     * The safety property. A source that stopped reporting well before the
     * window end must not have its silence tidied away: shrinking the axis to
     * the last datapoint would turn an outage into a chart that looks
     * complete.
     */
    const start: Date = new Date("2026-09-04T13:00:00.000Z");
    const end: Date = new Date("2026-09-04T14:00:00.000Z");
    // Reports stop at 13:50 — the last ten minutes of the window are dead.
    const series: Array<SeriesPoints> = seriesEvery({
      from: start,
      count: 51,
      stepMs: MINUTE_IN_MS,
    });

    const rows: Array<ChartDataPoint> = chartRows(
      buildXAxis({
        min: start,
        max: end,
        precision: XAxisPrecision.EVERY_MINUTE,
      }),
      series,
    );

    const blanks: Array<ChartDataPoint> = rows.filter(
      (row: ChartDataPoint): boolean => {
        return !hasValue(row);
      },
    );

    // 61 slots, one uncoverable tail slot dropped; nine blanks are the outage.
    expect(rows).toHaveLength(60);
    expect(blanks).toHaveLength(9);
    expect(hasValue(rows[rows.length - 1])).toBe(false);
  });

  test("a chart with no data anywhere keeps the whole window on the axis", () => {
    /*
     * Nothing to align the axis to, so there is nothing to trim towards —
     * an empty chart should still show the range the user asked for.
     */
    const start: Date = new Date("2026-09-04T13:00:00.000Z");
    const end: Date = new Date("2026-09-04T14:00:00.000Z");

    const rows: Array<ChartDataPoint> = chartRows(
      buildXAxis({
        min: start,
        max: end,
        precision: XAxisPrecision.EVERY_MINUTE,
      }),
      [{ seriesName: SERIES_NAME, data: [] as Array<DataPoint> }],
    );

    expect(rows).toHaveLength(61);
  });

  test("a single-slot grid is never trimmed away to nothing", () => {
    const start: Date = new Date("2026-09-04T13:00:00.000Z");
    const end: Date = new Date("2026-09-04T13:00:30.000Z");

    const rows: Array<ChartDataPoint> = chartRows(
      buildXAxis({
        min: start,
        max: end,
        precision: XAxisPrecision.EVERY_MINUTE,
      }),
      seriesEvery({ from: start, count: 1, stepMs: MINUTE_IN_MS }),
    );

    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  test("callers that pass no series get the raw grid, unchanged", () => {
    /*
     * getPrecisionIntervals is a shared primitive with its own contract
     * (XAxis.test.ts pins its counts). Trimming is opt-in through
     * getRenderableIntervals, so nothing that walks the grid alone moves.
     */
    const raw: Array<Date> = XAxisUtil.getPrecisionIntervals({
      xAxisMin: ALERT_WINDOW_START,
      xAxisMax: ALERT_WINDOW_END,
      precision: XAxisPrecision.EVERY_MINUTE,
    });
    const renderable: Array<Date> = XAxisUtil.getRenderableIntervals({
      xAxisMin: ALERT_WINDOW_START,
      xAxisMax: ALERT_WINDOW_END,
      precision: XAxisPrecision.EVERY_MINUTE,
    });

    expect(raw).toHaveLength(6);
    expect(renderable).toHaveLength(6);
  });
});

describe("the grid step follows the interval the data was bucketed at", () => {
  test.each([
    [AggregationInterval.Minute, XAxisPrecision.EVERY_MINUTE],
    [AggregationInterval.FiveMinutes, XAxisPrecision.EVERY_FIVE_MINUTES],
    [AggregationInterval.FifteenMinutes, XAxisPrecision.EVERY_FIFTEEN_MINUTES],
    [AggregationInterval.ThirtyMinutes, XAxisPrecision.EVERY_THIRTY_MINUTES],
    [AggregationInterval.Hour, XAxisPrecision.EVERY_HOUR],
    [AggregationInterval.Day, XAxisPrecision.EVERY_DAY],
    [AggregationInterval.Week, XAxisPrecision.EVERY_WEEK],
    [AggregationInterval.Month, XAxisPrecision.EVERY_MONTH],
    [AggregationInterval.Year, XAxisPrecision.EVERY_YEAR],
  ])(
    "%s buckets are drawn one slot each",
    (
      interval: AggregationInterval,
      expected: XAxisPrecision | undefined,
    ): void => {
      expect(XAxisUtil.getPrecisionForAggregationInterval(interval)).toBe(
        expected,
      );
    },
  );

  test("Total pins nothing — it has no grid to pin", () => {
    /*
     * Total collapses the window into one aggregate whose timestamp is the
     * earliest sample, not a bucket start, so there is no bucket grid to
     * mirror and the duration ladder applies.
     */
    expect(
      XAxisUtil.getPrecisionForAggregationInterval(AggregationInterval.Total),
    ).toBeUndefined();
  });

  test("a pin overrides the duration ladder in the COARSER direction too", () => {
    /*
     * The second way the two ladders drift. Aligning a window to the bucket
     * grid floors its start, which widens it — enough to tip a 3h preset past
     * the duration ladder's 3h threshold and onto the five-minute tier while
     * the query is still pinned to Minute. Unpinned, the chart would then
     * re-average five one-minute rows into each slot: an average of averages.
     */
    const start: Date = new Date("2026-09-04T10:59:00.000Z");
    const end: Date = new Date("2026-09-04T14:00:00.000Z");

    expect(XAxisUtil.getPrecision({ xAxisMin: start, xAxisMax: end })).toBe(
      XAxisPrecision.EVERY_FIVE_MINUTES,
    );
    expect(
      XAxisUtil.getPrecision({
        xAxisMin: start,
        xAxisMax: end,
        precision: XAxisPrecision.EVERY_MINUTE,
      }),
    ).toBe(XAxisPrecision.EVERY_MINUTE);
  });

  test("a pinned axis labels its slots at the pinned step", () => {
    /*
     * The grid step and the formatter have to move together: DataPointUtil
     * places a datapoint by matching FORMATTED LABELS, so a grid stepped one
     * way and labelled another matches nothing and the series vanishes
     * entirely rather than degrading.
     */
    const rows: Array<ChartDataPoint> = chartRows(
      buildXAxis({
        min: ALERT_WINDOW_START,
        max: ALERT_WINDOW_END,
        precision: XAxisPrecision.EVERY_MINUTE,
      }),
      seriesEvery({
        from: ALERT_WINDOW_START,
        count: 5,
        stepMs: MINUTE_IN_MS,
        value: 0.17,
      }),
    );

    expect(
      rows.map((row: ChartDataPoint): string => {
        return String(row[CHART_DATA_POINT_X_AXIS_KEY]);
      }),
    ).toEqual(["13:37", "13:38", "13:39", "13:40", "13:41"]);
  });
});

/*
 * The trailing bucket is measured by its own length, one more step of the
 * wall-clock walk from its start, not by the step before it: months differ
 * in any zone, and the days the clocks change are 23 or 25 hours long in
 * the zones that have them (ChartTrailingBucketGapLondon.test.ts runs those
 * in Europe/London; a zone set at run time would not take, so it is a file
 * of its own with a docblock).
 */
describe("trimming measures the trailing bucket by its own length", () => {
  type MonthGridFunction = (end: string) => {
    intervals: Array<Date>;
    renderable: Array<Date>;
  };

  // A month grid from 1 January with one reading at its start.
  const monthGrid: MonthGridFunction = (
    end: string,
  ): { intervals: Array<Date>; renderable: Array<Date> } => {
    const start: Date = new Date("2026-01-01T00:00:00.000Z");
    const xAxisMax: Date = new Date(end);

    return {
      intervals: XAxisUtil.getPrecisionIntervals({
        xAxisMin: start,
        xAxisMax: xAxisMax,
        precision: XAxisPrecision.EVERY_MONTH,
      }),
      renderable: XAxisUtil.getRenderableIntervals({
        xAxisMin: start,
        xAxisMax: xAxisMax,
        precision: XAxisPrecision.EVERY_MONTH,
        seriesPoints: [
          {
            seriesName: SERIES_NAME,
            data: [{ x: start, y: 1 }],
          },
        ],
      }),
    };
  };

  test("this file runs in UTC, where every day is 24 hours", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("UTC");
  });

  test("a February after a January of 31 days is 28 days: 14.5 of them is over half, so its slot stays", () => {
    // 14.5 / 28 = 0.52; measured by January's 31 days it would be 0.47.
    const { intervals, renderable } = monthGrid("2026-02-15T12:00:00.000Z");

    expect(intervals[intervals.length - 1]!.toISOString()).toBe(
      "2026-02-01T00:00:00.000Z",
    );
    expect(renderable).toHaveLength(intervals.length);
  });

  test("a March after a February of 28 days is 31 days: 14.5 of them is under half, so its slot goes", () => {
    // 14.5 / 31 = 0.47; measured by February's 28 days it would be 0.52.
    const { intervals, renderable } = monthGrid("2026-03-15T12:00:00.000Z");

    expect(intervals[intervals.length - 1]!.toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
    expect(renderable).toHaveLength(intervals.length - 1);
    expect(renderable[renderable.length - 1]!.toISOString()).toBe(
      "2026-02-01T00:00:00.000Z",
    );
  });

  test("the next slot of every precision is one step of the walk on", () => {
    const from: Date = new Date("2026-01-15T10:00:00.000Z");
    const expectedNext: Record<XAxisPrecision, string> = {
      [XAxisPrecision.EVERY_SECOND]: "2026-01-15T10:00:01.000Z",
      [XAxisPrecision.EVERY_FIVE_SECONDS]: "2026-01-15T10:00:05.000Z",
      [XAxisPrecision.EVERY_TEN_SECONDS]: "2026-01-15T10:00:10.000Z",
      [XAxisPrecision.EVERY_THIRTY_SECONDS]: "2026-01-15T10:00:30.000Z",
      [XAxisPrecision.EVERY_MINUTE]: "2026-01-15T10:01:00.000Z",
      [XAxisPrecision.EVERY_FIVE_MINUTES]: "2026-01-15T10:05:00.000Z",
      [XAxisPrecision.EVERY_TEN_MINUTES]: "2026-01-15T10:10:00.000Z",
      [XAxisPrecision.EVERY_FIFTEEN_MINUTES]: "2026-01-15T10:15:00.000Z",
      [XAxisPrecision.EVERY_THIRTY_MINUTES]: "2026-01-15T10:30:00.000Z",
      [XAxisPrecision.EVERY_HOUR]: "2026-01-15T11:00:00.000Z",
      [XAxisPrecision.EVERY_TWO_HOURS]: "2026-01-15T12:00:00.000Z",
      [XAxisPrecision.EVERY_THREE_HOURS]: "2026-01-15T13:00:00.000Z",
      [XAxisPrecision.EVERY_SIX_HOURS]: "2026-01-15T16:00:00.000Z",
      [XAxisPrecision.EVERY_TWELVE_HOURS]: "2026-01-15T22:00:00.000Z",
      [XAxisPrecision.EVERY_DAY]: "2026-01-16T10:00:00.000Z",
      [XAxisPrecision.EVERY_TWO_DAYS]: "2026-01-17T10:00:00.000Z",
      [XAxisPrecision.EVERY_WEEK]: "2026-01-22T10:00:00.000Z",
      [XAxisPrecision.EVERY_TWO_WEEKS]: "2026-01-29T10:00:00.000Z",
      [XAxisPrecision.EVERY_MONTH]: "2026-02-15T10:00:00.000Z",
      [XAxisPrecision.EVERY_TWO_MONTHS]: "2026-03-15T10:00:00.000Z",
      [XAxisPrecision.EVERY_THREE_MONTHS]: "2026-04-15T10:00:00.000Z",
      [XAxisPrecision.EVERY_SIX_MONTHS]: "2026-07-15T10:00:00.000Z",
      [XAxisPrecision.EVERY_YEAR]: "2027-01-15T10:00:00.000Z",
    };

    for (const precision of Object.values(XAxisPrecision)) {
      const next: Date = XAxisUtil.getNextInterval(from, precision);

      expect({ precision, next: next.toISOString() }).toEqual({
        precision,
        next: expectedNext[precision],
      });
      // The slot asked about is left as it is.
      expect(from.toISOString()).toBe("2026-01-15T10:00:00.000Z");

      // The walk takes the same step: a window ending on that slot has two.
      expect(
        XAxisUtil.getPrecisionIntervals({
          xAxisMin: from,
          xAxisMax: next,
          precision: precision,
        }).map((slot: Date): string => {
          return slot.toISOString();
        }),
      ).toEqual([from.toISOString(), next.toISOString()]);
    }
  });
});
