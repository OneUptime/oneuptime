import { JSONObject } from "../../JSON";
import MetricsAggregationType from "../../Metrics/MetricsAggregationType";

export interface MetricBreachingSample {
  value: number;
  timestamp: Date;
  attributes: JSONObject;
}

export default interface MetricCriteriaContext {
  metricName: string;
  alias: string;
  unit: string | null;
  aggregationType: MetricsAggregationType | null;
  isFormula: boolean;
  formulaExpression?: string | undefined;
  filterAttributes: JSONObject;
  groupBy: Array<string>;
  timeWindowMinutes?: number | undefined;
  breachingSample?: MetricBreachingSample | undefined;
  /**
   * All samples in the evaluation window that breached the threshold,
   * in chronological order. Used to render a table of timestamps and
   * values on the incident root-cause page.
   */
  breachingSamples?: Array<MetricBreachingSample> | undefined;
  /**
   * Total number of samples considered during evaluation (including
   * non-breaching ones), so the root cause can show "N of M samples
   * breached" without re-querying.
   */
  totalSamplesInWindow?: number | undefined;
}
