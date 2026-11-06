import AggregatedResult from "../../BaseDatabase/AggregatedResult";
import { JSONObject } from "../../JSON";
import MetricSeriesArrival from "./MetricSeriesArrival";

/**
 * One series within a metric monitor evaluation. When a metric monitor
 * is configured with group-by attributes (e.g. host.name), the worker
 * splits the aggregated results into one entry per unique label
 * combination. Each series is then evaluated independently so the
 * criteria can fire one incident per affected series.
 *
 * `aggregatedResults` is aligned with the monitor's queryConfigs +
 * formulaConfigs arrays (same length, same order) so per-series
 * formula evaluation reuses the same indexing the criteria evaluator
 * expects.
 */
export default interface MetricSeriesResult {
  fingerprint: string;
  labels: JSONObject;
  aggregatedResults: Array<AggregatedResult>;
  /*
   * When this series' data arrived (MetricSeriesArrival), aligned with
   * `aggregatedResults`: null for a query or formula whose arrivals were not
   * read. Absent when none were (see MetricMonitorResponse
   * .metricResultArrivals).
   */
  arrivals?: Array<MetricSeriesArrival | null> | undefined;
}
