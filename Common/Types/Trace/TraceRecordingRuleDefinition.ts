import TraceAggregationType from "./TraceAggregationType";

/*
 * A single source for a Trace Recording Rule — queries the Span table with
 * the given aggregation, filtered by optional span-name regex and attribute
 * match. Each source is aliased (A, B, C, ...) and referenced from the rule's
 * expression string.
 */
export interface TraceRecordingRuleSource {
  alias: string;
  aggregationType: TraceAggregationType;
  // Optional filters — ANDed together.
  spanNameRegex?: string;
  spanKind?: string;
  onlyErrors?: boolean;
  filterAttributeKey?: string;
  filterAttributeValue?: string;
}

/*
 * Full stored definition of a Trace Recording Rule. Persisted as JSONB so new
 * fields can be added without migrating Postgres.
 */
export default interface TraceRecordingRuleDefinition {
  sources: Array<TraceRecordingRuleSource>;
  /*
   * Arithmetic expression using aliases. Operators: + - * /, parentheses,
   * numeric literals. Example: "A / B * 100" for error rate.
   */
  expression: string;
  /*
   * Optional attribute key (e.g. "service.name") to group by — one derived
   * data point per group per evaluation bucket.
   */
  groupByAttribute?: string;
}

// Maximum number of sources per rule — bounds per-cron workload.
export const TRACE_RECORDING_RULE_MAX_SOURCES: number = 4;

// Maximum expression length — prevents pathological parser input.
export const TRACE_RECORDING_RULE_MAX_EXPRESSION_LENGTH: number = 500;
