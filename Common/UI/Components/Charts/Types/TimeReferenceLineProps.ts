/**
 * A time-anchored vertical event marker (e.g. a deploy or an incident
 * start). The date is snapped to the chart's categorical x-axis buckets
 * before rendering.
 */
export default interface ChartTimeReferenceLineProps {
  date: Date;
  label?: string | undefined;
  color?: string | undefined; // CSS color, e.g. "#f59e0b" or "red"
  strokeDasharray?: string | undefined; // e.g. "4 4" for dashed
  onClick?: (() => void) | undefined;
}
