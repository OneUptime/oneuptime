import AggregatedModel from "../BaseDatabase/AggregatedModel";
import MetricAliasData from "./MetricAliasData";
import MetricQueryData from "./MetricQueryData";

export enum MetricChartType {
  LINE = "line",
  BAR = "bar",
  AREA = "area",
}

export interface ChartSeries {
  title: string;
}

export default interface MetricQueryConfigData {
  metricAliasData?: MetricAliasData | undefined;
  metricQueryData: MetricQueryData;
  getSeries?: ((data: AggregatedModel) => ChartSeries) | undefined;
  chartType?: MetricChartType | undefined;
  yAxisValueFormatter?: ((value: number) => string) | undefined;
  /*
   * Optional post-aggregation transform of each datapoint's plotted
   * value. Runs before `transformAsRate`. Receives the raw aggregated
   * value plus the full datapoint (so the transform can read grouped
   * attributes like `resource.k8s.node.name`). Used, e.g., to turn a
   * Kubernetes CPU *cores* value into "% of its node's allocatable CPU"
   * by dividing each point by the node's capacity. Unset = no change.
   */
  transformValue?:
    | ((value: number, dataPoint: AggregatedModel) => number)
    | undefined;
  warningThreshold?: number | undefined;
  criticalThreshold?: number | undefined;
  /*
   * Optional user-chosen color for this query's series. Stored as a hex
   * string (e.g. "#6366f1") — the preset swatches write their palette hex
   * and the custom picker writes an arbitrary hex. When set, it becomes the
   * lead color for this query's chart (single-series → the series color;
   * grouped multi-series → the first series, with the default palette filling
   * the rest). Unset = auto-assigned from the chart-type palette.
   */
  color?: string | undefined;
  /*
   * Per-group color pins for GROUP-BY queries. Keyed by the individual
   * "key=value" segment that MetricCharts' series renderer emits for a
   * grouped series — e.g. { "service.name=api": "#f59e0b" }. Use "(unset)"
   * as the value for null/empty groups to match the series name. A series
   * whose composed name contains a pinned segment renders in that color
   * (first matching segment wins for multi-key group-bys); unpinned series
   * fall back to `color` (lead) then the chart-type palette. Stored as hex.
   */
  colorsByGroup?: Record<string, string> | undefined;
  /*
   * When true, the post-aggregation series points are transformed into
   * a per-second rate of change: `(value - previousValue) / Δt`. This is
   * the right view for OTel cumulative counters (e.g. `system.disk.io`,
   * `system.network.io`) — without it, the chart plots monotonically
   * growing bytes-since-process-start. Negative deltas (counter resets
   * on agent restart) are clamped to 0.
   */
  transformAsRate?: boolean | undefined;
  /*
   * When true, the chart also plots this query evaluated over the
   * immediately preceding window of equal length (shifted onto the
   * current axis) for period-over-period comparison. Plain persisted
   * data like the fields above — the explorer UI that toggles it and the
   * chart rendering ship in a later stage.
   */
  overlayWithPreviousQuery?: boolean | undefined;
}
