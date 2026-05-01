/**
 * Time-anchored vertical line drawn across a time-series chart.
 *
 * Used by dashboards to overlay events (incidents, deploys, monitor flips,
 * scheduled maintenance) onto metric charts so spikes can be correlated
 * with what happened operationally at the same moment.
 */
export default interface ChartVerticalReferenceLineProps {
  // Timestamp at which the line should be drawn (X axis position).
  time: Date;
  // Short label rendered along the line — keep tight (~24 chars).
  label?: string | undefined;
  // CSS color, e.g. "#ef4444" for incidents.
  color: string;
  // Optional dash pattern, e.g. "3 3".
  strokeDasharray?: string | undefined;
}
