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
   * When true, the post-aggregation series points are transformed into
   * a per-second rate of change: `(value - previousValue) / Δt`. This is
   * the right view for OTel cumulative counters (e.g. `system.disk.io`,
   * `system.network.io`) — without it, the chart plots monotonically
   * growing bytes-since-process-start. Negative deltas (counter resets
   * on agent restart) are clamped to 0.
   */
  transformAsRate?: boolean | undefined;
}
