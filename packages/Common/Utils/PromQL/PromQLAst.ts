/*
 * The syntax tree of a PromQL query (issue #6796).
 *
 * PromQL is the query language of Prometheus, and the one most people who
 * chart metrics already know. OneUptime reads its own metrics with it: the
 * parser (PromQLParser) turns a query into this tree, and the engine
 * (PromQLEngine) evaluates the tree against series a source hands it, so the
 * same query answers on the Metrics page, in Grafana through the
 * Prometheus-compatible API, and in tests against series held in memory.
 *
 * The tree follows Prometheus 3's own (promql/parser/ast.go), with the
 * modifiers resolved to milliseconds so the engine never reads a duration
 * string.
 */

export enum PromQLValueType {
  Scalar = "scalar",
  InstantVector = "vector",
  RangeVector = "matrix",
  String = "string",
}

/*
 * How a value type is named in a message, the way Prometheus names it:
 * "expected type range vector in call to function rate".
 */
export const PROMQL_VALUE_TYPE_NAMES: Record<PromQLValueType, string> = {
  [PromQLValueType.Scalar]: "scalar",
  [PromQLValueType.InstantVector]: "instant vector",
  [PromQLValueType.RangeVector]: "range vector",
  [PromQLValueType.String]: "string",
};

// A value type with its article, for the middle of a sentence.
export const PROMQL_VALUE_TYPE_WITH_ARTICLE: Record<PromQLValueType, string> = {
  [PromQLValueType.Scalar]: "a scalar",
  [PromQLValueType.InstantVector]: "an instant vector",
  [PromQLValueType.RangeVector]: "a range vector",
  [PromQLValueType.String]: "a string",
};

export enum PromQLMatchType {
  Equal = "=",
  NotEqual = "!=",
  RegexMatch = "=~",
  RegexNoMatch = "!~",
}

export interface PromQLLabelMatcher {
  name: string;
  type: PromQLMatchType;
  value: string;
}

// Where a node was written in the query, as character offsets.
export interface PromQLPosition {
  start: number;
  end: number;
}

export enum PromQLNodeKind {
  NumberLiteral = "NumberLiteral",
  StringLiteral = "StringLiteral",
  VectorSelector = "VectorSelector",
  MatrixSelector = "MatrixSelector",
  Subquery = "Subquery",
  Call = "Call",
  Aggregate = "Aggregate",
  Binary = "Binary",
  Unary = "Unary",
  Paren = "Paren",
}

/*
 * The `@` modifier: a fixed evaluation time, or the start or end of the
 * query, which is only known when it runs.
 */
export type PromQLAtModifier =
  | { kind: "timestamp"; timestampMs: number }
  | { kind: "start" }
  | { kind: "end" };

export interface PromQLNumberLiteral {
  kind: PromQLNodeKind.NumberLiteral;
  value: number;
  position: PromQLPosition;
}

export interface PromQLStringLiteral {
  kind: PromQLNodeKind.StringLiteral;
  value: string;
  position: PromQLPosition;
}

export interface PromQLVectorSelector {
  kind: PromQLNodeKind.VectorSelector;
  // The metric name, when the query names one (`up` or `{__name__="up"}`).
  name: string | undefined;
  /*
   * Every matcher, the metric name's included: `up{job="api"}` holds
   * `__name__="up"` and `job="api"`.
   */
  matchers: Array<PromQLLabelMatcher>;
  // `offset 5m` is 300000; `offset -5m` is -300000.
  offsetMs: number;
  at: PromQLAtModifier | undefined;
  position: PromQLPosition;
}

export interface PromQLMatrixSelector {
  kind: PromQLNodeKind.MatrixSelector;
  /*
   * The selector the range applies to. An offset or `@` written after the
   * range (`up[5m] offset 1h`) lives on it, as in Prometheus.
   */
  vectorSelector: PromQLVectorSelector;
  rangeMs: number;
  position: PromQLPosition;
}

export interface PromQLSubquery {
  kind: PromQLNodeKind.Subquery;
  expression: PromQLExpression;
  rangeMs: number;
  // Unset when the query leaves it out (`[1h:]`): the default step is used.
  stepMs: number | undefined;
  offsetMs: number;
  at: PromQLAtModifier | undefined;
  position: PromQLPosition;
}

export interface PromQLCall {
  kind: PromQLNodeKind.Call;
  functionName: string;
  args: Array<PromQLExpression>;
  position: PromQLPosition;
}

export enum PromQLAggregateOperator {
  Sum = "sum",
  Avg = "avg",
  Min = "min",
  Max = "max",
  Count = "count",
  Group = "group",
  Stddev = "stddev",
  Stdvar = "stdvar",
  Topk = "topk",
  Bottomk = "bottomk",
  Quantile = "quantile",
  CountValues = "count_values",
}

export interface PromQLAggregate {
  kind: PromQLNodeKind.Aggregate;
  operator: PromQLAggregateOperator;
  expression: PromQLExpression;
  // The first argument of topk, bottomk, quantile and count_values.
  parameter: PromQLExpression | undefined;
  grouping: Array<string>;
  // `without (...)` rather than `by (...)`.
  without: boolean;
  position: PromQLPosition;
}

export enum PromQLBinaryOperator {
  Add = "+",
  Sub = "-",
  Mul = "*",
  Div = "/",
  Mod = "%",
  Pow = "^",
  Atan2 = "atan2",
  Eql = "==",
  Neq = "!=",
  Gtr = ">",
  Lss = "<",
  Gte = ">=",
  Lte = "<=",
  And = "and",
  Or = "or",
  Unless = "unless",
}

export enum PromQLVectorMatchCardinality {
  OneToOne = "one-to-one",
  ManyToOne = "many-to-one",
  OneToMany = "one-to-many",
  ManyToMany = "many-to-many",
}

export interface PromQLVectorMatching {
  cardinality: PromQLVectorMatchCardinality;
  // `on (...)` lists the labels that match; otherwise they are ignored.
  on: boolean;
  matchingLabels: Array<string>;
  // The labels `group_left (...)` or `group_right (...)` copy across.
  include: Array<string>;
}

export interface PromQLBinary {
  kind: PromQLNodeKind.Binary;
  operator: PromQLBinaryOperator;
  lhs: PromQLExpression;
  rhs: PromQLExpression;
  // `> bool`: answer 1 or 0 rather than filtering.
  returnBool: boolean;
  // Unset unless both sides are instant vectors.
  matching: PromQLVectorMatching | undefined;
  position: PromQLPosition;
}

export interface PromQLUnary {
  kind: PromQLNodeKind.Unary;
  operator: PromQLBinaryOperator.Add | PromQLBinaryOperator.Sub;
  expression: PromQLExpression;
  position: PromQLPosition;
}

export interface PromQLParen {
  kind: PromQLNodeKind.Paren;
  expression: PromQLExpression;
  position: PromQLPosition;
}

export type PromQLExpression =
  | PromQLNumberLiteral
  | PromQLStringLiteral
  | PromQLVectorSelector
  | PromQLMatrixSelector
  | PromQLSubquery
  | PromQLCall
  | PromQLAggregate
  | PromQLBinary
  | PromQLUnary
  | PromQLParen;

export const PROMQL_METRIC_NAME_LABEL: string = "__name__";

export const isComparisonOperator: (
  operator: PromQLBinaryOperator,
) => boolean = (operator: PromQLBinaryOperator): boolean => {
  return (
    operator === PromQLBinaryOperator.Eql ||
    operator === PromQLBinaryOperator.Neq ||
    operator === PromQLBinaryOperator.Gtr ||
    operator === PromQLBinaryOperator.Lss ||
    operator === PromQLBinaryOperator.Gte ||
    operator === PromQLBinaryOperator.Lte
  );
};

export const isSetOperator: (operator: PromQLBinaryOperator) => boolean = (
  operator: PromQLBinaryOperator,
): boolean => {
  return (
    operator === PromQLBinaryOperator.And ||
    operator === PromQLBinaryOperator.Or ||
    operator === PromQLBinaryOperator.Unless
  );
};
