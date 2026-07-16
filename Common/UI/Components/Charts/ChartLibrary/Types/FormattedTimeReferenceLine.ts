import ChartTimeReferenceLineProps from "../../Types/TimeReferenceLineProps";

/**
 * A time-anchored vertical reference line whose x value has been formatted
 * to match the chart's categorical x-axis labels. Used internally by chart
 * library components.
 */
export default interface FormattedTimeReferenceLine {
  /** The formatted x-axis label (e.g. "12:30", "22 Feb") */
  formattedX: string;
  /** The original annotation for label/color/click handling */
  original: ChartTimeReferenceLineProps;
}
