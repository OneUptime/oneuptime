import { PromQLExpression, PromQLLabelMatcher } from "../PromQL/PromQLAst";

/*
 * The syntax tree of a LogQL query (issue #7700): Grafana Loki's query
 * language, so a Grafana Loki data source pointed at OneUptime reads the
 * project's logs with the queries its dashboards already hold.
 *
 * A log query is a stream selector and its pipeline. A metric query is
 * PromQL-shaped - aggregations, binary operators, vector matching - around
 * range aggregations of log queries (count_over_time({app="api"}[5m])):
 * its PromQL half is kept as PromQL's own tree, each range aggregation in
 * it a selector of a series of its own (LOGQL_RANGE_SERIES_PREFIX), so the
 * PromQL engine evaluates it the way Loki's engine, written after
 * Prometheus', does.
 */

// The name a range aggregation's series goes by in the PromQL half.
export const LOGQL_RANGE_SERIES_PREFIX: string = "__logql_range_";

export enum LogQLLineFilterOperator {
  Contains = "|=",
  NotContains = "!=",
  Matches = "|~",
  NotMatches = "!~",
}

export interface LogQLLineFilter {
  kind: "LineFilter";
  operator: LogQLLineFilterOperator;
  // One or more strings joined by `or`: `|= "error" or "fatal"`.
  values: Array<string>;
}

export enum LogQLParserKind {
  Json = "json",
  Logfmt = "logfmt",
}

export interface LogQLParserStage {
  kind: "Parser";
  parser: LogQLParserKind;
}

export enum LogQLComparison {
  Equal = "==",
  NotEqual = "!=",
  Greater = ">",
  GreaterOrEqual = ">=",
  Less = "<",
  LessOrEqual = "<=",
}

// How a label's value is read for a comparison with a number.
export enum LogQLValueKind {
  Number = "number",
  // `duration > 1s`: the label holds a duration, compared in seconds.
  Duration = "duration",
  // `size > 20MB`: the label holds a size, compared in bytes.
  Bytes = "bytes",
}

export type LogQLLabelFilterExpression =
  | {
      kind: "And" | "Or";
      left: LogQLLabelFilterExpression;
      right: LogQLLabelFilterExpression;
    }
  // A string comparison: =, !=, =~, !~ against a quoted value.
  | { kind: "Match"; matcher: PromQLLabelMatcher }
  // A comparison with a number, a duration or a size.
  | {
      kind: "Compare";
      label: string;
      comparison: LogQLComparison;
      value: number;
      valueKind: LogQLValueKind;
    };

export interface LogQLLabelFilterStage {
  kind: "LabelFilter";
  expression: LogQLLabelFilterExpression;
}

// line_format's template, read as text and the labels it is filled with.
export type LogQLTemplatePart = { text: string } | { label: string };

export interface LogQLLineFormatStage {
  kind: "LineFormat";
  parts: Array<LogQLTemplatePart>;
}

export interface LogQLLabelListStage {
  kind: "Drop" | "Keep";
  labels: Array<string>;
}

export interface LogQLDecolorizeStage {
  kind: "Decolorize";
}

export type LogQLStage =
  | LogQLLineFilter
  | LogQLParserStage
  | LogQLLabelFilterStage
  | LogQLLineFormatStage
  | LogQLLabelListStage
  | LogQLDecolorizeStage;

export interface LogQLLogSelector {
  kind: "LogSelector";
  matchers: Array<PromQLLabelMatcher>;
  stages: Array<LogQLStage>;
}

export enum LogQLUnwrapConversion {
  // The value as a number.
  None = "none",
  // A duration (`1.5s`, `250ms`), in seconds.
  Duration = "duration",
  // A size (`20MB`, `1.5KiB`), in bytes.
  Bytes = "bytes",
}

export interface LogQLUnwrap {
  label: string;
  conversion: LogQLUnwrapConversion;
  // Label filters after the unwrap: `| unwrap latency | __error__=""`.
  stages: Array<LogQLLabelFilterStage>;
}

export enum LogQLRangeOperation {
  CountOverTime = "count_over_time",
  Rate = "rate",
  BytesOverTime = "bytes_over_time",
  BytesRate = "bytes_rate",
  AbsentOverTime = "absent_over_time",
  // These read an unwrapped label's values.
  SumOverTime = "sum_over_time",
  AvgOverTime = "avg_over_time",
  MinOverTime = "min_over_time",
  MaxOverTime = "max_over_time",
  FirstOverTime = "first_over_time",
  LastOverTime = "last_over_time",
  StdvarOverTime = "stdvar_over_time",
  StddevOverTime = "stddev_over_time",
  QuantileOverTime = "quantile_over_time",
}

// The range aggregations that count lines, and need no unwrap.
export const LOGQL_LINE_RANGE_OPERATIONS: ReadonlySet<LogQLRangeOperation> =
  new Set<LogQLRangeOperation>([
    LogQLRangeOperation.CountOverTime,
    LogQLRangeOperation.Rate,
    LogQLRangeOperation.BytesOverTime,
    LogQLRangeOperation.BytesRate,
    LogQLRangeOperation.AbsentOverTime,
  ]);

export interface LogQLRangeAggregation {
  kind: "RangeAggregation";
  // Its series' name in the PromQL half: __logql_range_<index>.
  seriesName: string;
  operation: LogQLRangeOperation;
  selector: LogQLLogSelector;
  // An unwrapped label, for the aggregations that read values (and rate).
  unwrap: LogQLUnwrap | undefined;
  rangeMs: number;
  offsetMs: number;
  // quantile_over_time's φ.
  parameter: number | undefined;
  // `sum_over_time(...) by (job)`: the unwrapped aggregations' grouping.
  grouping: { labels: Array<string>; without: boolean } | undefined;
}

export interface LogQLLogQuery {
  kind: "LogQuery";
  selector: LogQLLogSelector;
}

export interface LogQLMetricQuery {
  kind: "MetricQuery";
  // The PromQL half, every range aggregation in it a selector of its own.
  expression: PromQLExpression;
  ranges: Array<LogQLRangeAggregation>;
}

export type LogQLQuery = LogQLLogQuery | LogQLMetricQuery;
