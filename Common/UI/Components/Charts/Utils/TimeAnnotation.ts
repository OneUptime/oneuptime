import ChartReferenceRegionProps from "../Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "../Types/TimeReferenceLineProps";
import FormattedReferenceRegion from "../ChartLibrary/Types/FormattedReferenceRegion";
import FormattedTimeReferenceLine from "../ChartLibrary/Types/FormattedTimeReferenceLine";
import { XAxis } from "../Types/XAxis/XAxis";
import XAxisUtil from "./XAxis";

interface AxisBuckets {
  intervals: Array<Date>;
  labels: Array<string>;
  labelSet: Set<string>;
  formatter: (value: Date) => string;
}

export default class TimeAnnotationUtil {
  private static getAxisBuckets(xAxis: XAxis): AxisBuckets {
    const intervals: Array<Date> = XAxisUtil.getPrecisionIntervals({
      xAxisMin: xAxis.options.min,
      xAxisMax: xAxis.options.max,
    });
    const formatter: (value: Date) => string = XAxisUtil.getFormatter({
      xAxisMin: xAxis.options.min,
      xAxisMax: xAxis.options.max,
    });
    const labels: Array<string> = intervals.map((interval: Date) => {
      return formatter(interval);
    });
    return { intervals, labels, labelSet: new Set(labels), formatter };
  }

  /*
   * End of the charted window: last bucket start plus one bucket width
   * (buckets extend past their start date).
   */
  private static getWindowEndInMs(intervals: Array<Date>): number {
    const lastInterval: Date | undefined = intervals[intervals.length - 1];
    if (!lastInterval) {
      return Number.NEGATIVE_INFINITY;
    }
    const secondToLastInterval: Date | undefined =
      intervals[intervals.length - 2];
    const bucketWidthInMs: number = secondToLastInterval
      ? lastInterval.getTime() - secondToLastInterval.getTime()
      : 0;
    return lastInterval.getTime() + bucketWidthInMs;
  }

  /*
   * Largest interval index whose bucket start is <= date, or null when
   * the date falls before the first bucket.
   */
  private static getBucketIndexForDate(
    intervals: Array<Date>,
    date: Date,
  ): number | null {
    let bucketIndex: number | null = null;
    for (let i: number = 0; i < intervals.length; i++) {
      if (intervals[i]!.getTime() <= date.getTime()) {
        bucketIndex = i;
      } else {
        break;
      }
    }
    return bucketIndex;
  }

  /*
   * Resolve a date to a bucket label that is guaranteed to exist on the
   * categorical x-axis. Prefer formatter output — series datapoints are
   * bucketed by the exact same formatter, so annotations land where data
   * with the same timestamp lands. The formatter floors to wall-clock
   * boundaries while buckets start at the raw window start, so its output
   * can match no bucket; fall back to the bucket containing the date.
   * Returns null when the date is outside the charted window.
   */
  private static resolveBucketLabel(data: {
    date: Date;
    buckets: AxisBuckets;
  }): string | null {
    const { intervals, labels, labelSet, formatter } = data.buckets;

    const firstInterval: Date | undefined = intervals[0];
    if (!firstInterval || data.date.getTime() < firstInterval.getTime()) {
      return null;
    }
    if (data.date.getTime() > this.getWindowEndInMs(intervals)) {
      return null;
    }

    const formatted: string = formatter(data.date);
    if (labelSet.has(formatted)) {
      return formatted;
    }

    const bucketIndex: number | null = this.getBucketIndexForDate(
      intervals,
      data.date,
    );
    if (bucketIndex === null) {
      return null;
    }
    return labels[bucketIndex] ?? null;
  }

  public static formatTimeReferenceLines(data: {
    timeReferenceLines: Array<ChartTimeReferenceLineProps>;
    xAxis: XAxis;
  }): Array<FormattedTimeReferenceLine> {
    const buckets: AxisBuckets = this.getAxisBuckets(data.xAxis);

    const formatted: Array<FormattedTimeReferenceLine> = [];
    for (const timeReferenceLine of data.timeReferenceLines) {
      const formattedX: string | null = this.resolveBucketLabel({
        date: timeReferenceLine.date,
        buckets,
      });
      if (formattedX === null) {
        continue; // outside the charted window
      }
      formatted.push({ formattedX, original: timeReferenceLine });
    }
    return formatted;
  }

  public static formatReferenceRegions(data: {
    referenceRegions: Array<ChartReferenceRegionProps>;
    xAxis: XAxis;
  }): Array<FormattedReferenceRegion> {
    const buckets: AxisBuckets = this.getAxisBuckets(data.xAxis);
    const firstInterval: Date | undefined = buckets.intervals[0];
    const lastLabel: string | undefined =
      buckets.labels[buckets.labels.length - 1];
    if (!firstInterval || lastLabel === undefined) {
      return [];
    }
    const windowEndInMs: number = this.getWindowEndInMs(buckets.intervals);

    const formatted: Array<FormattedReferenceRegion> = [];
    for (const referenceRegion of data.referenceRegions) {
      const startInMs: number = Math.min(
        referenceRegion.startDate.getTime(),
        referenceRegion.endDate.getTime(),
      );
      const endInMs: number = Math.max(
        referenceRegion.startDate.getTime(),
        referenceRegion.endDate.getTime(),
      );

      // Entirely outside the charted window — nothing to draw.
      if (endInMs < firstInterval.getTime() || startInMs > windowEndInMs) {
        continue;
      }

      /*
       * A region overlapping the window edge clamps to the nearest
       * in-window bucket rather than vanishing.
       */
      const formattedX1: string =
        this.resolveBucketLabel({ date: new Date(startInMs), buckets }) ||
        buckets.labels[0]!;
      const formattedX2: string =
        this.resolveBucketLabel({ date: new Date(endInMs), buckets }) ||
        lastLabel;

      formatted.push({ formattedX1, formattedX2, original: referenceRegion });
    }
    return formatted;
  }
}
