import {
  PromQLBinaryOperator,
  PromQLExpression,
  PromQLNodeKind,
  PromQLValueType,
} from "./PromQLAst";
import PromQLError from "./PromQLError";
import { getPromQLValueType, parsePromQL } from "./PromQLParser";
import { FilterType } from "../../Types/Monitor/CriteriaFilter";

/*
 * A Metrics monitor's PromQL expression (issue #7712): whether it can be
 * evaluated at each step of a monitor's window, and the comparison at its
 * end, if it has one.
 *
 * Pure and shared: the monitor form checks an expression as it is typed,
 * MonitorStep refuses one that cannot run, and the worker reads the same
 * expression the same way.
 */

// An expression to start from, in the editor's placeholder and the docs.
export const PROMQL_MONITOR_EXAMPLE: string =
  'sum by (job) (rate(http_requests_total{code=~"5.."}[5m])) / sum by (job) (rate(http_requests_total[5m]))';

// Why an expression cannot be a monitor's.
export enum PromQLMonitorExpressionProblemKind {
  Empty = "Empty",
  // It does not parse: `detail` is the parser's own words, and where.
  DoesNotParse = "DoesNotParse",
  RangeVector = "RangeVector",
  Text = "Text",
}

export interface PromQLMonitorExpressionProblem {
  kind: PromQLMonitorExpressionProblemKind;
  detail?: string | undefined;
}

/*
 * The problem in English, as MonitorStep's validation and the worker say
 * it. The monitor form words each kind in the reader's language.
 */
export const PROMQL_MONITOR_PROBLEM_WORDS: Readonly<
  Record<PromQLMonitorExpressionProblemKind, string>
> = {
  [PromQLMonitorExpressionProblemKind.Empty]:
    "Write the PromQL expression this monitor evaluates, such as sum(rate(http_requests_total[5m])).",
  [PromQLMonitorExpressionProblemKind.DoesNotParse]:
    "The PromQL expression does not parse: {{error}}",
  [PromQLMonitorExpressionProblemKind.RangeVector]:
    "The PromQL expression is a range vector, which a monitor cannot compare. Wrap it in a function such as rate(...[5m]) or avg_over_time(...[5m]).",
  [PromQLMonitorExpressionProblemKind.Text]:
    "The PromQL expression is a string, which a monitor cannot compare. Write an expression that returns numbers.",
};

/*
 * Why an expression cannot be a monitor's, or null when it can: one is
 * written, it parses, and it is a number or an instant vector, which a
 * window's steps can each judge.
 */
export const findPromQLMonitorExpressionProblem: (
  query: string | undefined,
) => PromQLMonitorExpressionProblem | null = (
  query: string | undefined,
): PromQLMonitorExpressionProblem | null => {
  const text: string = (query || "").trim();

  if (!text) {
    return { kind: PromQLMonitorExpressionProblemKind.Empty };
  }

  let expression: PromQLExpression;

  try {
    expression = parsePromQL(text);
  } catch (error: unknown) {
    return {
      kind: PromQLMonitorExpressionProblemKind.DoesNotParse,
      detail:
        error instanceof PromQLError || error instanceof Error
          ? error.message
          : String(error),
    };
  }

  const type: PromQLValueType = getPromQLValueType(expression);

  if (type === PromQLValueType.RangeVector) {
    return { kind: PromQLMonitorExpressionProblemKind.RangeVector };
  }

  if (type === PromQLValueType.String) {
    return { kind: PromQLMonitorExpressionProblemKind.Text };
  }

  return null;
};

// The same, in English: what MonitorStep refuses a step with.
export const getPromQLMonitorExpressionProblem: (
  query: string | undefined,
) => string | null = (query: string | undefined): string | null => {
  const problem: PromQLMonitorExpressionProblem | null =
    findPromQLMonitorExpressionProblem(query);

  if (!problem) {
    return null;
  }

  return PROMQL_MONITOR_PROBLEM_WORDS[problem.kind].replace(
    "{{error}}",
    problem.detail || "",
  );
};

// How each comparison PromQL filters by reads as a criteria's condition.
const CONDITION_OF_OPERATOR: ReadonlyMap<PromQLBinaryOperator, FilterType> =
  new Map<PromQLBinaryOperator, FilterType>([
    [PromQLBinaryOperator.Gtr, FilterType.GreaterThan],
    [PromQLBinaryOperator.Gte, FilterType.GreaterThanOrEqualTo],
    [PromQLBinaryOperator.Lss, FilterType.LessThan],
    [PromQLBinaryOperator.Lte, FilterType.LessThanOrEqualTo],
    [PromQLBinaryOperator.Eql, FilterType.EqualTo],
  ]);

// The same comparison read from the other side: `0.05 < x` is `x > 0.05`.
const MIRRORED_OPERATOR: ReadonlyMap<
  PromQLBinaryOperator,
  PromQLBinaryOperator
> = new Map<PromQLBinaryOperator, PromQLBinaryOperator>([
  [PromQLBinaryOperator.Gtr, PromQLBinaryOperator.Lss],
  [PromQLBinaryOperator.Gte, PromQLBinaryOperator.Lte],
  [PromQLBinaryOperator.Lss, PromQLBinaryOperator.Gtr],
  [PromQLBinaryOperator.Lte, PromQLBinaryOperator.Gte],
  [PromQLBinaryOperator.Eql, PromQLBinaryOperator.Eql],
]);

export interface PromQLMonitorComparison {
  // The expression without its comparison, as it was written.
  expression: string;
  // The comparison, as a criteria's condition, and the number it compares with.
  filterType: FilterType;
  threshold: number;
}

const unwrap: (expression: PromQLExpression) => PromQLExpression = (
  expression: PromQLExpression,
): PromQLExpression => {
  let current: PromQLExpression = expression;

  while (current.kind === PromQLNodeKind.Paren) {
    current = current.expression;
  }

  return current;
};

const literalValue: (expression: PromQLExpression) => number | undefined = (
  expression: PromQLExpression,
): number | undefined => {
  const node: PromQLExpression = unwrap(expression);

  if (node.kind === PromQLNodeKind.NumberLiteral) {
    return node.value;
  }

  // -5 is a unary minus before 5.
  if (
    node.kind === PromQLNodeKind.Unary &&
    unwrap(node.expression).kind === PromQLNodeKind.NumberLiteral
  ) {
    const value: number = (unwrap(node.expression) as { value: number }).value;

    return node.operator === PromQLBinaryOperator.Sub ? -value : value;
  }

  return undefined;
};

/*
 * The comparison an expression ends in, the way an alert rule for
 * Prometheus is written (`sum(rate(errors[5m])) > 0.05`), apart from what
 * it compares: such an expression keeps only the series in breach, and the
 * monitor's condition compares each value again. Moved into the condition,
 * the monitor charts the whole expression and judges it the same way.
 * Null when the expression ends in no comparison with a finite number, or
 * one written with `bool`, which keeps every series.
 */
export const splitPromQLMonitorComparison: (
  query: string | undefined,
) => PromQLMonitorComparison | null = (
  query: string | undefined,
): PromQLMonitorComparison | null => {
  const text: string = (query || "").trim();

  if (!text) {
    return null;
  }

  let root: PromQLExpression;

  try {
    root = unwrap(parsePromQL(text));
  } catch {
    return null;
  }

  if (root.kind !== PromQLNodeKind.Binary || root.returnBool) {
    return null;
  }

  const rightValue: number | undefined = literalValue(root.rhs);
  const leftValue: number | undefined = literalValue(root.lhs);
  const operator: PromQLBinaryOperator | undefined =
    rightValue !== undefined
      ? root.operator
      : MIRRORED_OPERATOR.get(root.operator);
  const threshold: number | undefined =
    rightValue !== undefined ? rightValue : leftValue;
  const compared: PromQLExpression =
    rightValue !== undefined ? root.lhs : root.rhs;

  if (
    operator === undefined ||
    threshold === undefined ||
    !Number.isFinite(threshold) ||
    // Two numbers compare nothing a monitor reads.
    (rightValue !== undefined && leftValue !== undefined)
  ) {
    return null;
  }

  const filterType: FilterType | undefined =
    CONDITION_OF_OPERATOR.get(operator);

  if (!filterType) {
    return null;
  }

  const expression: string = text
    .slice(compared.position.start, compared.position.end)
    .trim();

  if (!expression) {
    return null;
  }

  return { expression, filterType, threshold };
};
