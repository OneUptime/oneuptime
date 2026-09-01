import { describe, expect, test } from "@jest/globals";
import ChartReferenceRegionProps from "../../../../UI/Components/Charts/Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "../../../../UI/Components/Charts/Types/TimeReferenceLineProps";
import FormattedReferenceRegion from "../../../../UI/Components/Charts/ChartLibrary/Types/FormattedReferenceRegion";
import FormattedTimeReferenceLine from "../../../../UI/Components/Charts/ChartLibrary/Types/FormattedTimeReferenceLine";
import DataPointUtil from "../../../../UI/Components/Charts/Utils/DataPoint";
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
 * TimeAnnotationUtil is what puts an incident, alert or deploy onto a
 * chart's categorical x-axis. It had no tests at all, and it now carries
 * the load-bearing part of the marker rail: the BUCKET INDEX. The renderer
 * positions from that index rather than from the label, because a sub-hour
 * axis over a multi-day window repeats its labels and recharts' scale then
 * resolves none of them.
 */

function buildXAxis(start: Date, end: Date): XAxis {
  return {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: start,
      max: end,
      aggregateType: XAxisAggregateType.Average,
    },
  };
}

function axisLabels(xAxis: XAxis): Array<string> {
  const formatter: (value: Date) => string = XAxisUtil.getFormatter({
    xAxisMin: xAxis.options.min,
    xAxisMax: xAxis.options.max,
  });
  return XAxisUtil.getPrecisionIntervals({
    xAxisMin: xAxis.options.min,
    xAxisMax: xAxis.options.max,
  }).map((interval: Date): string => {
    return formatter(interval);
  });
}

function line(date: Date, label?: string): ChartTimeReferenceLineProps {
  return { date, label: label ?? "event" };
}

function regionBetween(
  startDate: Date,
  endDate: Date,
): ChartReferenceRegionProps {
  return { startDate, endDate, label: "window" };
}

/* A 6h window buckets every five minutes: 73 buckets, all labels distinct. */
const SHORT_START: Date = new Date("2026-03-02T00:00:00.000Z");
const SHORT_END: Date = new Date("2026-03-02T06:00:00.000Z");
const SHORT_AXIS: XAxis = buildXAxis(SHORT_START, SHORT_END);

/* A 48h window buckets every thirty minutes and formats bare HH:mm. */
const LONG_START: Date = new Date("2026-03-02T00:00:00.000Z");
const LONG_END: Date = new Date("2026-03-04T00:00:00.000Z");
const LONG_AXIS: XAxis = buildXAxis(LONG_START, LONG_END);

function minutesAfter(start: Date, minutes: number): Date {
  return new Date(start.getTime() + minutes * 60 * 1000);
}

describe("formatTimeReferenceLines", () => {
  test("a marker resolves to a bucket that exists on the axis", () => {
    const labels: Array<string> = axisLabels(SHORT_AXIS);

    const formatted: Array<FormattedTimeReferenceLine> =
      TimeAnnotationUtil.formatTimeReferenceLines({
        timeReferenceLines: [line(minutesAfter(SHORT_START, 65))],
        xAxis: SHORT_AXIS,
      });

    expect(formatted).toHaveLength(1);
    const resolved: FormattedTimeReferenceLine = formatted[0]!;
    expect(resolved.bucketIndex).toBeGreaterThanOrEqual(0);
    expect(resolved.bucketIndex).toBeLessThan(labels.length);
    // The index and the label always agree — the renderer trusts both.
    expect(labels[resolved.bucketIndex]).toBe(resolved.formattedX);
  });

  test("later markers land on later buckets", () => {
    const formatted: Array<FormattedTimeReferenceLine> =
      TimeAnnotationUtil.formatTimeReferenceLines({
        timeReferenceLines: [
          line(minutesAfter(SHORT_START, 10)),
          line(minutesAfter(SHORT_START, 200)),
          line(minutesAfter(SHORT_START, 340)),
        ],
        xAxis: SHORT_AXIS,
      });

    expect(formatted).toHaveLength(3);
    expect(formatted[0]!.bucketIndex).toBeLessThan(formatted[1]!.bucketIndex);
    expect(formatted[1]!.bucketIndex).toBeLessThan(formatted[2]!.bucketIndex);
  });

  test("a marker before the window is dropped", () => {
    expect(
      TimeAnnotationUtil.formatTimeReferenceLines({
        timeReferenceLines: [line(minutesAfter(SHORT_START, -60))],
        xAxis: SHORT_AXIS,
      }),
    ).toEqual([]);
  });

  test("a marker after the window is dropped", () => {
    expect(
      TimeAnnotationUtil.formatTimeReferenceLines({
        timeReferenceLines: [line(minutesAfter(SHORT_END, 600))],
        xAxis: SHORT_AXIS,
      }),
    ).toEqual([]);
  });

  test("a marker exactly on the window start lands on the first bucket", () => {
    const formatted: Array<FormattedTimeReferenceLine> =
      TimeAnnotationUtil.formatTimeReferenceLines({
        timeReferenceLines: [line(SHORT_START)],
        xAxis: SHORT_AXIS,
      });

    expect(formatted).toHaveLength(1);
    expect(formatted[0]!.bucketIndex).toBe(0);
  });

  test("the original annotation is carried through untouched", () => {
    const onClick: () => void = (): void => {
      // no-op
    };
    const original: ChartTimeReferenceLineProps = {
      date: minutesAfter(SHORT_START, 30),
      label: "Incident: API is down",
      color: "#123456",
      strokeDasharray: "4 4",
      onClick,
    };

    const formatted: Array<FormattedTimeReferenceLine> =
      TimeAnnotationUtil.formatTimeReferenceLines({
        timeReferenceLines: [original],
        xAxis: SHORT_AXIS,
      });

    expect(formatted[0]!.original).toBe(original);
  });

  test("no markers formats to nothing", () => {
    expect(
      TimeAnnotationUtil.formatTimeReferenceLines({
        timeReferenceLines: [],
        xAxis: SHORT_AXIS,
      }),
    ).toEqual([]);
  });

  test("a repeated-label axis still resolves every marker", () => {
    /*
     * The regression this whole change turns on. A 48h window repeats
     * every clock label; markers used to be handed to recharts BY LABEL,
     * and recharts resolves no label at all on a duplicated domain, so the
     * entire overlay silently disappeared on any window of a day or more.
     * Indices have no such failure mode.
     */
    const labels: Array<string> = axisLabels(LONG_AXIS);
    expect(new Set(labels).size).toBeLessThan(labels.length);

    const formatted: Array<FormattedTimeReferenceLine> =
      TimeAnnotationUtil.formatTimeReferenceLines({
        timeReferenceLines: [
          line(minutesAfter(LONG_START, 4 * 60)),
          line(minutesAfter(LONG_START, 20 * 60)),
          line(minutesAfter(LONG_START, 36 * 60)),
        ],
        xAxis: LONG_AXIS,
      });

    expect(formatted).toHaveLength(3);
    for (const resolved of formatted) {
      expect(labels[resolved.bucketIndex]).toBe(resolved.formattedX);
    }
  });
});

describe("markers sit with the data they describe", () => {
  /*
   * A marker's whole job is to say "this happened HERE on the series", so
   * it has to resolve to the row its own timestamp's data resolved to.
   *
   * On a repeated-label axis both are wrong in the same direction:
   * DataPointUtil places a row by first-match-on-label and the marker
   * follows the identical rule, so a day-two event and day-two data land
   * together on day one. That consistency is the property worth pinning —
   * moving one side without the other would park markers over empty space.
   * The real fix is XAxisUtil emitting a date on its sub-hour tiers, and it
   * moves both sides at once; this test is what will catch a half-fix.
   */

  type BucketOfFunction = (xAxis: XAxis, date: Date) => number;

  const Y_AXIS: YAxis = {
    legend: "value",
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

  const bucketOfSeriesPoint: BucketOfFunction = (
    xAxis: XAxis,
    date: Date,
  ): number => {
    const rows: Array<Record<string, unknown>> =
      DataPointUtil.getChartDataPoints({
        seriesPoints: [{ seriesName: "s", data: [{ x: date, y: 42 }] }],
        xAxis,
        yAxis: Y_AXIS,
      }) as unknown as Array<Record<string, unknown>>;

    return rows.findIndex((row: Record<string, unknown>): boolean => {
      return row["s"] !== undefined;
    });
  };

  test.each([
    [
      "a 6 hour window, distinct labels",
      (): XAxis => {
        return SHORT_AXIS;
      },
      (): Date => {
        return minutesAfter(SHORT_START, 95);
      },
    ],
    [
      "a 48 hour window, day one",
      (): XAxis => {
        return LONG_AXIS;
      },
      (): Date => {
        return minutesAfter(LONG_START, 6 * 60);
      },
    ],
    [
      "a 48 hour window, day two",
      (): XAxis => {
        return LONG_AXIS;
      },
      (): Date => {
        return minutesAfter(LONG_START, 34 * 60);
      },
    ],
  ])(
    "%s: the marker resolves to the same bucket as its data",
    (_name: string, buildAxis: () => XAxis, buildDate: () => Date): void => {
      const xAxis: XAxis = buildAxis();
      const date: Date = buildDate();

      const dataBucket: number = bucketOfSeriesPoint(xAxis, date);
      expect(dataBucket).toBeGreaterThanOrEqual(0);

      const formatted: Array<FormattedTimeReferenceLine> =
        TimeAnnotationUtil.formatTimeReferenceLines({
          timeReferenceLines: [line(date)],
          xAxis,
        });

      expect(formatted).toHaveLength(1);
      expect(formatted[0]!.bucketIndex).toBe(dataBucket);
    },
  );
});

describe("formatReferenceRegions", () => {
  test("a region resolves to a start and end bucket in order", () => {
    const labels: Array<string> = axisLabels(SHORT_AXIS);

    const formatted: Array<FormattedReferenceRegion> =
      TimeAnnotationUtil.formatReferenceRegions({
        referenceRegions: [
          regionBetween(
            minutesAfter(SHORT_START, 60),
            minutesAfter(SHORT_START, 180),
          ),
        ],
        xAxis: SHORT_AXIS,
      });

    expect(formatted).toHaveLength(1);
    const resolved: FormattedReferenceRegion = formatted[0]!;
    expect(resolved.startBucketIndex).toBeLessThan(resolved.endBucketIndex);
    expect(labels[resolved.startBucketIndex]).toBe(resolved.formattedX1);
    expect(labels[resolved.endBucketIndex]).toBe(resolved.formattedX2);
  });

  test("reversed dates are normalised rather than inverted", () => {
    const formatted: Array<FormattedReferenceRegion> =
      TimeAnnotationUtil.formatReferenceRegions({
        referenceRegions: [
          regionBetween(
            minutesAfter(SHORT_START, 180),
            minutesAfter(SHORT_START, 60),
          ),
        ],
        xAxis: SHORT_AXIS,
      });

    expect(formatted[0]!.startBucketIndex).toBeLessThan(
      formatted[0]!.endBucketIndex,
    );
  });

  test("a region overlapping the window start clamps to the first bucket", () => {
    const formatted: Array<FormattedReferenceRegion> =
      TimeAnnotationUtil.formatReferenceRegions({
        referenceRegions: [
          regionBetween(
            minutesAfter(SHORT_START, -120),
            minutesAfter(SHORT_START, 60),
          ),
        ],
        xAxis: SHORT_AXIS,
      });

    expect(formatted).toHaveLength(1);
    expect(formatted[0]!.startBucketIndex).toBe(0);
  });

  test("a region overlapping the window end clamps to the last bucket", () => {
    const labels: Array<string> = axisLabels(SHORT_AXIS);

    const formatted: Array<FormattedReferenceRegion> =
      TimeAnnotationUtil.formatReferenceRegions({
        referenceRegions: [
          regionBetween(
            minutesAfter(SHORT_END, -60),
            minutesAfter(SHORT_END, 600),
          ),
        ],
        xAxis: SHORT_AXIS,
      });

    expect(formatted).toHaveLength(1);
    expect(formatted[0]!.endBucketIndex).toBe(labels.length - 1);
  });

  test("a region entirely before the window is dropped", () => {
    expect(
      TimeAnnotationUtil.formatReferenceRegions({
        referenceRegions: [
          regionBetween(
            minutesAfter(SHORT_START, -600),
            minutesAfter(SHORT_START, -300),
          ),
        ],
        xAxis: SHORT_AXIS,
      }),
    ).toEqual([]);
  });

  test("a region entirely after the window is dropped", () => {
    expect(
      TimeAnnotationUtil.formatReferenceRegions({
        referenceRegions: [
          regionBetween(
            minutesAfter(SHORT_END, 300),
            minutesAfter(SHORT_END, 600),
          ),
        ],
        xAxis: SHORT_AXIS,
      }),
    ).toEqual([]);
  });

  test("a region wider than the window covers all of it", () => {
    const labels: Array<string> = axisLabels(SHORT_AXIS);

    const formatted: Array<FormattedReferenceRegion> =
      TimeAnnotationUtil.formatReferenceRegions({
        referenceRegions: [
          regionBetween(
            minutesAfter(SHORT_START, -600),
            minutesAfter(SHORT_END, 600),
          ),
        ],
        xAxis: SHORT_AXIS,
      });

    expect(formatted[0]!.startBucketIndex).toBe(0);
    expect(formatted[0]!.endBucketIndex).toBe(labels.length - 1);
  });

  test("an instant region resolves to a single bucket", () => {
    const instant: Date = minutesAfter(SHORT_START, 90);

    const formatted: Array<FormattedReferenceRegion> =
      TimeAnnotationUtil.formatReferenceRegions({
        referenceRegions: [regionBetween(instant, instant)],
        xAxis: SHORT_AXIS,
      });

    expect(formatted[0]!.startBucketIndex).toBe(formatted[0]!.endBucketIndex);
  });

  test("no regions formats to nothing", () => {
    expect(
      TimeAnnotationUtil.formatReferenceRegions({
        referenceRegions: [],
        xAxis: SHORT_AXIS,
      }),
    ).toEqual([]);
  });

  test("a repeated-label axis still resolves regions", () => {
    const labels: Array<string> = axisLabels(LONG_AXIS);

    const formatted: Array<FormattedReferenceRegion> =
      TimeAnnotationUtil.formatReferenceRegions({
        referenceRegions: [
          regionBetween(
            minutesAfter(LONG_START, 6 * 60),
            minutesAfter(LONG_START, 30 * 60),
          ),
        ],
        xAxis: LONG_AXIS,
      });

    expect(formatted).toHaveLength(1);
    expect(labels[formatted[0]!.startBucketIndex]).toBe(
      formatted[0]!.formattedX1,
    );
    expect(labels[formatted[0]!.endBucketIndex]).toBe(
      formatted[0]!.formattedX2,
    );
  });
});
