import { JSONObject } from "../../JSON";
import MetricsAggregationType from "../../Metrics/MetricsAggregationType";

/**
 * A per-timestamp snapshot of a variable referenced by a formula —
 * used to show "what did $a and $b evaluate to when c breached?" on the
 * incident root-cause page.
 */
export interface MetricComponentValue {
  alias: string;
  value: number | null;
}

export interface MetricBreachingSample {
  value: number;
  timestamp: Date;
  attributes: JSONObject;
  /**
   * For formula evaluations: the values of each referenced variable at
   * this timestamp. Keyed by variable alias. Absent for plain metric
   * criteria.
   */
  componentValues?: Array<MetricComponentValue> | undefined;
}

/**
 * Descriptor for one variable referenced by a formula, used to label
 * table columns and render the Metric Details section. Name is the
 * metric display name (usually the metric name, sometimes the formula
 * expression for nested formulas) and unit is the variable's native
 * unit as configured.
 */
export interface MetricComponent {
  alias: string;
  name: string;
  unit: string | null;
  isFormula: boolean;
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
  /**
   * For formulas: metadata for each variable the formula references,
   * in the order they appear in the expression. Consumers use this to
   * label breakdown columns and to surface underlying units/metric
   * names in the Metric Details section.
   */
  components?: Array<MetricComponent> | undefined;
}
