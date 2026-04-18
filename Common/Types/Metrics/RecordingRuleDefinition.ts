import AggregationType from "../BaseDatabase/AggregationType";

/*
 * A single source metric inside a Recording Rule. Each source is given an
 * alphabetic alias (A, B, C, ...) that can be referenced from the rule's
 * expression string. Aliases are case-sensitive and match /^[A-Z]$/ in v1.
 */
export interface RecordingRuleSource {
  alias: string;
  metricName: string;
  aggregationType: AggregationType;
  // Optional pre-filter so you can say e.g. "A = sum(http.requests WHERE http.status_code_class = '5xx')".
  filterAttributeKey?: string;
  filterAttributeValue?: string;
}

/*
 * Full stored definition of a Recording Rule. Persisted as a JSONB column on
 * MetricRecordingRule so we don't have to migrate the Postgres schema every
 * time we add a new field.
 */
export default interface RecordingRuleDefinition {
  sources: Array<RecordingRuleSource>;
  /*
   * Arithmetic expression in our simple DSL: operators + - * /, parentheses,
   * numeric literals, and alias references. Example: "A / B * 100".
   */
  expression: string;
  /*
   * Optional attribute key to group source queries by and preserve on output
   * rows. One derived data point per group per evaluation bucket.
   */
  groupByAttribute?: string;
}

/*
 * Maximum number of source metrics per rule for v1. Kept small to bound the
 * per-cron workload.
 */
export const RECORDING_RULE_MAX_SOURCES: number = 4;

// Maximum expression length for v1. Prevents pathological parser input.
export const RECORDING_RULE_MAX_EXPRESSION_LENGTH: number = 500;
