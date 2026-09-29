import AggregatedResult from "../../BaseDatabase/AggregatedResult";
import { JSONObject } from "../../JSON";

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
}
