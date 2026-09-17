import ChartReferenceRegionProps from "../Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "../Types/TimeReferenceLineProps";
import FormattedReferenceRegion from "../ChartLibrary/Types/FormattedReferenceRegion";
import FormattedTimeReferenceLine from "../ChartLibrary/Types/FormattedTimeReferenceLine";
import SeriesPoints from "../Types/SeriesPoints";
import { XAxis } from "../Types/XAxis/XAxis";
import XAxisMaxMin from "../Types/XAxis/XAxisMaxMin";
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
  /*
   * The axis's own maximum, kept alongside the slots because the slots no
   * longer imply it — see getWindowEndInMs.
   */
  xAxisMax: XAxisMaxMin;
}

export default class TimeAnnotationUtil {
  /*
   * `seriesPoints` is not used to place anything — it is what lets this
   * rebuild the SAME slot array DataPointUtil built. XAxisUtil drops an
   * unfillable trailing slot, and whether it does depends on the series, so
   * an annotation resolved against a grid built without them would index
   * into an array one longer than the chart's rows: every marker in the
   * final bucket would land past the end of the axis. Chart wrappers pass
   * the series they are drawing; callers that pass none get the raw grid,
   * which is what DataPointUtil gives them too.
   */
  private static getAxisBuckets(
    xAxis: XAxis,
    seriesPoints?: Array<SeriesPoints> | undefined,
  ): AxisBuckets {
    const intervals: Array<Date> = XAxisUtil.getRenderableIntervals({
      xAxisMin: xAxis.options.min,
      xAxisMax: xAxis.options.max,
      precision: xAxis.options.precision,
      seriesPoints: seriesPoints,
    });
    const formatter: (value: Date) => string = XAxisUtil.getFormatter({
      xAxisMin: xAxis.options.min,
      xAxisMax: xAxis.options.max,
      precision: xAxis.options.precision,
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
    return {
      intervals,
      labels,
      labelToIndex,
      formatter,
      xAxisMax: xAxis.options.max,
    };
  }

  /*
   * End of the charted window: last bucket start plus one bucket width
   * (buckets extend past their start date).
   *
   * Held up to the axis's own maximum, because the grid can legitimately
   * stop SHORT of it — XAxisUtil drops a trailing slot no data could land
   * in. Reconstructing the window from the slots alone would then pull this
   * bound backwards by a bucket and start rejecting the very markers that
   * sit at the window edge as "outside the charted window": on an alert the
   * declared-at marker is at the window end exactly, and it would vanish
   * from the chart it exists to annotate. Such a marker resolves instead to
   * the last bucket that is still on the axis, which is where its data is.
   */
  private static getWindowEndInMs(
    intervals: Array<Date>,
    xAxisMax: XAxisMaxMin,
  ): number {
    const lastInterval: Date | undefined = intervals[intervals.length - 1];
    if (!lastInterval) {
      return Number.NEGATIVE_INFINITY;
    }
    const secondToLastInterval: Date | undefined =
      intervals[intervals.length - 2];
    const bucketWidthInMs: number = secondToLastInterval
      ? lastInterval.getTime() - secondToLastInterval.getTime()
      : 0;
    const gridEndInMs: number = lastInterval.getTime() + bucketWidthInMs;
    const axisMaxInMs: number =
      typeof xAxisMax === "number" ? xAxisMax : xAxisMax.getTime();

    return Math.max(gridEndInMs, axisMaxInMs);
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
    if (
      data.date.getTime() >
      this.getWindowEndInMs(intervals, data.buckets.xAxisMax)
    ) {
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
    /*
     * The series the chart is drawing. Only used to rebuild the same slot
     * array the rows were built from — see getAxisBuckets.
     */
    seriesPoints?: Array<SeriesPoints> | undefined;
  }): Array<FormattedTimeReferenceLine> {
    const buckets: AxisBuckets = this.getAxisBuckets(
      data.xAxis,
      data.seriesPoints,
    );

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
    /*
     * The series the chart is drawing. Only used to rebuild the same slot
     * array the rows were built from — see getAxisBuckets.
     */
    seriesPoints?: Array<SeriesPoints> | undefined;
  }): Array<FormattedReferenceRegion> {
    const buckets: AxisBuckets = this.getAxisBuckets(
      data.xAxis,
      data.seriesPoints,
    );
    const firstInterval: Date | undefined = buckets.intervals[0];
    const lastIndex: number = buckets.labels.length - 1;
    const lastLabel: string | undefined = buckets.labels[lastIndex];
    if (!firstInterval || lastLabel === undefined) {
      return [];
    }
    const windowEndInMs: number = this.getWindowEndInMs(
      buckets.intervals,
      buckets.xAxisMax,
    );

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
