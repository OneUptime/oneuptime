import ChartReferenceRegionProps from "../../Types/ReferenceRegionProps";

/**
 * A time-anchored shaded region whose endpoints have been formatted to
 * (and clamped onto) the chart's categorical x-axis labels. Used
 * internally by chart library components.
 */
export default interface FormattedReferenceRegion {
  /** The formatted x-axis label of the region start bucket */
  formattedX1: string;
  /** The formatted x-axis label of the region end bucket */
  formattedX2: string;
  /** The original annotation for label/color/click handling */
  original: ChartReferenceRegionProps;
}
