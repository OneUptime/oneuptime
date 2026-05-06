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
  warningThreshold?: number | undefined;
  criticalThreshold?: number | undefined;
  /*
   * When true, the post-aggregation series points are transformed into
   * a per-second rate of change: `(value - previousValue) / Δt`. This is
   * the right view for OTel cumulative counters (e.g. `system.disk.io`,
   * `system.network.io`) — without it, the chart plots monotonically
   * growing bytes-since-process-start. Negative deltas (counter resets
   * on agent restart) are clamped to 0.
   */
  transformAsRate?: boolean | undefined;
}
