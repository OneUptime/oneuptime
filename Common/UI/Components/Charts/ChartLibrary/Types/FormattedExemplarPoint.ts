import ExemplarPoint from "../../Types/ExemplarPoint";

/**
 * An exemplar point with a formatted x-axis label that matches the chart's
 * x-axis formatting. Used internally by chart library components.
 */
export default interface FormattedExemplarPoint {
  /** The formatted x-axis label (e.g. "12:30", "Feb 22") */
  formattedX: string;
  /** The y value */
  y: number;
  /** The original exemplar data for click handling */
  original: ExemplarPoint;
}
