import ChartEventKind from "./ChartEventKind";

/**
 * A time-anchored shaded region (e.g. an incident or maintenance window).
 * Endpoints are clamped to the nearest in-window x-axis buckets, so a
 * region overlapping the window edge is trimmed rather than dropped.
 */
export default interface ChartReferenceRegionProps {
  startDate: Date;
  endDate: Date;
  label?: string | undefined;
  color?: string | undefined; // CSS color, e.g. "#6366f1" or "red"
  onClick?: (() => void) | undefined;
  /** What the region represents. Defaults to Generic. */
  kind?: ChartEventKind | undefined;
  /** Second line in the region's hover card. */
  subtitle?: string | undefined;
}
