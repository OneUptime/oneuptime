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
   * The renderer positions markers from this, not from the label: a
   * sub-hour axis over a multi-day window repeats labels ("14:00" on both
   * days), and recharts' categorical scale refuses to resolve *any* label
   * once its domain holds a duplicate — so a label-keyed marker does not
   * land in the wrong place, it disappears from the chart entirely.
   */
  bucketIndex: number;
  /** The original annotation for label/color/click handling */
  original: ChartTimeReferenceLineProps;
}
