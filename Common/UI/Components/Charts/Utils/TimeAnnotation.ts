import ChartReferenceRegionProps from "../Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "../Types/TimeReferenceLineProps";
import FormattedReferenceRegion from "../ChartLibrary/Types/FormattedReferenceRegion";
import FormattedTimeReferenceLine from "../ChartLibrary/Types/FormattedTimeReferenceLine";
import { XAxis } from "../Types/XAxis/XAxis";
import XAxisUtil from "./XAxis";

interface AxisBuckets {
  intervals: Array<Date>;
  labels: Array<string>;
  /*
   * First index each label appears at. DataPointUtil places a series row
   * by finding the first row with a matching label, so an annotation that
   * resolves through the formatter has to land on that same first index to
   * sit with its data.
   */
  labelToIndex: Map<string, number>;
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
    const labelToIndex: Map<string, number> = new Map<string, number>();
    for (let index: number = 0; index < labels.length; index++) {
      const label: string = labels[index]!;
      if (!labelToIndex.has(label)) {
        labelToIndex.set(label, index);
      }
    }
    return { intervals, labels, labelToIndex, formatter };
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
   * Resolve a date to a bucket that is guaranteed to exist on the
   * categorical x-axis, as an INDEX into that axis rather than a label.
   *
   * The index is what the renderer needs: a sub-hour axis over a
   * multi-day window repeats its labels, and recharts' categorical scale
   * cannot resolve any label once its domain holds a duplicate, so a
   * label is not a usable position there.
   *
   * Prefer formatter output — series datapoints are bucketed by the exact
   * same formatter, so annotations land where data with the same timestamp
   * lands. The formatter floors to wall-clock boundaries while buckets
   * start at the raw window start, so its output can match no bucket; fall
   * back to the bucket containing the date. Returns null when the date is
   * outside the charted window.
   *
   * The first-occurrence lookup is deliberate, and it has to stay tied to
   * DataPointUtil, which places series rows by the very same
   * first-match-on-label rule. Whatever bucket a timestamp's DATA lands
   * in, its marker has to land in too — resolving a marker to some
   * "truer" bucket than its data would park it over empty space. Sub-hour
   * axes used to repeat their labels, which sent day-two markers and
   * day-two data onto day one together; XAxisUtil now keeps them
   * distinct, so both sides land where they belong. They still move
   * together, which is the point.
   */
  private static resolveBucketIndex(data: {
    date: Date;
    buckets: AxisBuckets;
  }): number | null {
    const { intervals, labelToIndex, formatter } = data.buckets;

    const firstInterval: Date | undefined = intervals[0];
    if (!firstInterval || data.date.getTime() < firstInterval.getTime()) {
      return null;
    }
    if (data.date.getTime() > this.getWindowEndInMs(intervals)) {
      return null;
    }

    const formattedIndex: number | undefined = labelToIndex.get(
      formatter(data.date),
    );
    if (formattedIndex !== undefined) {
      return formattedIndex;
    }

    return this.getBucketIndexForDate(intervals, data.date);
  }

  public static formatTimeReferenceLines(data: {
    timeReferenceLines: Array<ChartTimeReferenceLineProps>;
    xAxis: XAxis;
  }): Array<FormattedTimeReferenceLine> {
    const buckets: AxisBuckets = this.getAxisBuckets(data.xAxis);

    const formatted: Array<FormattedTimeReferenceLine> = [];
    for (const timeReferenceLine of data.timeReferenceLines) {
      const bucketIndex: number | null = this.resolveBucketIndex({
        date: timeReferenceLine.date,
        buckets,
      });
      if (bucketIndex === null) {
        continue; // outside the charted window
      }
      const formattedX: string | undefined = buckets.labels[bucketIndex];
      if (formattedX === undefined) {
        continue;
      }
      formatted.push({ formattedX, bucketIndex, original: timeReferenceLine });
    }
    return formatted;
  }

  public static formatReferenceRegions(data: {
    referenceRegions: Array<ChartReferenceRegionProps>;
    xAxis: XAxis;
  }): Array<FormattedReferenceRegion> {
    const buckets: AxisBuckets = this.getAxisBuckets(data.xAxis);
    const firstInterval: Date | undefined = buckets.intervals[0];
    const lastIndex: number = buckets.labels.length - 1;
    const lastLabel: string | undefined = buckets.labels[lastIndex];
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
      const startBucketIndex: number =
        this.resolveBucketIndex({ date: new Date(startInMs), buckets }) ?? 0;
      const endBucketIndex: number =
        this.resolveBucketIndex({ date: new Date(endInMs), buckets }) ??
        lastIndex;

      formatted.push({
        formattedX1: buckets.labels[startBucketIndex]!,
        formattedX2: buckets.labels[endBucketIndex]!,
        startBucketIndex,
        endBucketIndex,
        original: referenceRegion,
      });
    }
    return formatted;
  }
}
