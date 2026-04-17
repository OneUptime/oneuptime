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
}
