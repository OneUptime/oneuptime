import ChartReferenceRegionProps from "../../Types/ReferenceRegionProps";

/**
 * A time-anchored shaded region whose endpoints have been resolved onto
 * (and clamped into) the chart's categorical x-axis. Used internally by
 * chart library components.
 */
export default interface FormattedReferenceRegion {
  /** The formatted x-axis label of the region start bucket */
  formattedX1: string;
  /** The formatted x-axis label of the region end bucket */
  formattedX2: string;
  /** Index of the start label in the chart's category list. */
  startBucketIndex: number;
  /** Index of the end label in the chart's category list. */
  endBucketIndex: number;
  /** The original annotation for label/color/click handling */
  original: ChartReferenceRegionProps;
}
