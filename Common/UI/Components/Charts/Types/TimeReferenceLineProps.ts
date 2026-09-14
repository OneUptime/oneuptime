import ChartEventKind from "./ChartEventKind";

/**
 * A time-anchored event marker (e.g. a deploy or an incident start). The
 * date is snapped to the chart's categorical x-axis buckets before
 * rendering.
 *
 * Markers draw as a hairline through the plot topped by a chip on the
 * annotation rail above it; the label is never painted over the series —
 * it lives in the chip's hover card, so it can be as long as the record's
 * real title.
 */
export default interface ChartTimeReferenceLineProps {
  date: Date;
  label?: string | undefined;
  color?: string | undefined; // CSS color, e.g. "#f59e0b" or "red"
  strokeDasharray?: string | undefined; // e.g. "4 4" for dashed
  onClick?: (() => void) | undefined;
  /**
   * What the marker represents. Sorts markers inside a cluster and picks
   * the cluster's chip colour. Defaults to Generic.
   */
  kind?: ChartEventKind | undefined;
  /**
   * Second line in the hover card — severity, service, monitor name. Kept
   * out of `label` so the primary line stays scannable.
   */
  subtitle?: string | undefined;
}
