import ChartTimeReferenceLineProps from "../../Types/TimeReferenceLineProps";

/**
 * A time-anchored event marker resolved onto the chart's categorical
 * x-axis. Used internally by chart library components.
 */
export default interface FormattedTimeReferenceLine {
  /** The formatted x-axis label (e.g. "12:30", "22 Feb") */
  formattedX: string;
  /**
   * Index of that label in the chart's category list.
   *
   * The renderer positions markers from this, not from the label.
   * recharts' categorical scale refuses to resolve *any* label once its
   * domain holds a duplicate, so a label-keyed marker does not land in
   * the wrong place — it disappears from the chart entirely. Sub-hour
   * axes used to produce exactly that domain over a multi-day window;
   * XAxisUtil keeps the labels distinct now, and this index means a
   * regression there could never take the overlay down with it.
   */
  bucketIndex: number;
  /** The original annotation for label/color/click handling */
  original: ChartTimeReferenceLineProps;
}
