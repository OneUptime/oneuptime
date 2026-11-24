import {
  PROMQL_MONITOR_EXAMPLE,
  PromQLMonitorExpressionProblemKind,
  findPromQLMonitorExpressionProblem,
  getPromQLMonitorExpressionProblem,
  splitPromQLMonitorComparison,
} from "../../../Utils/PromQL/PromQLMonitorExpression";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import { describe, expect, test } from "@jest/globals";

/*
 * A Metrics monitor's PromQL expression (issue #7712): what can be one, and
 * the comparison an alert rule written for Prometheus ends in.
 */

describe("which expressions a monitor can evaluate", () => {
  test.each([
    "up",
    "sum by (job) (rate(http_requests_total[5m]))",
    "histogram_quantile(0.95, sum by (le) (rate(x_bucket[5m]))) > 0.5",
    "vector(1)",
    "1 + 1",
    PROMQL_MONITOR_EXAMPLE,
  ])("%s", (query: string) => {
    expect(findPromQLMonitorExpressionProblem(query)).toBeNull();
    expect(getPromQLMonitorExpressionProblem(query)).toBeNull();
  });

  test("none written", () => {
    expect(findPromQLMonitorExpressionProblem("  ")).toEqual({
      kind: PromQLMonitorExpressionProblemKind.Empty,
    });
    expect(getPromQLMonitorExpressionProblem(undefined)).toBe(
      "Write the PromQL expression this monitor evaluates, such as sum(rate(http_requests_total[5m])).",
    );
  });

  test("one that does not parse says the parser's words", () => {
    const problem: ReturnType<typeof findPromQLMonitorExpressionProblem> =
      findPromQLMonitorExpressionProblem("rate(http_requests_total)");

    expect(problem?.kind).toBe(PromQLMonitorExpressionProblemKind.DoesNotParse);
    expect(problem?.detail).toBeTruthy();
    expect(getPromQLMonitorExpressionProblem("sum(")).toMatch(
      /^The PromQL expression does not parse: \S/,
    );
  });

  test("a range vector or a string is no value to compare", () => {
    expect(findPromQLMonitorExpressionProblem("up[5m]")?.kind).toBe(
      PromQLMonitorExpressionProblemKind.RangeVector,
    );
    expect(findPromQLMonitorExpressionProblem('"text"')?.kind).toBe(
      PromQLMonitorExpressionProblemKind.Text,
    );
  });
});

describe("the comparison an expression ends in", () => {
  test("an alert rule's threshold, moved out of the expression", () => {
    expect(
      splitPromQLMonitorComparison(
        'sum(rate(http_requests_total{code=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.05',
      ),
    ).toEqual({
      expression:
        'sum(rate(http_requests_total{code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))',
      filterType: FilterType.GreaterThan,
      threshold: 0.05,
    });
  });

  test.each([
    ["up == 0", "up", FilterType.EqualTo, 0],
    ["x >= 10", "x", FilterType.GreaterThanOrEqualTo, 10],
    ["x < 1e3", "x", FilterType.LessThan, 1000],
    ["x <= -5", "x", FilterType.LessThanOrEqualTo, -5],
    // Written from the other side: 0.9 < x is x > 0.9.
    ["0.9 < x", "x", FilterType.GreaterThan, 0.9],
    ["5 >= x", "x", FilterType.LessThanOrEqualTo, 5],
    // Parentheses around the whole, or around either side.
    ["(rate(x[5m]) > (2))", "rate(x[5m])", FilterType.GreaterThan, 2],
    ["(a / b) > 0.5", "(a / b)", FilterType.GreaterThan, 0.5],
  ])(
    "%s compares %s",
    (
      query: string,
      expression: string,
      filterType: FilterType,
      threshold: number,
    ) => {
      expect(splitPromQLMonitorComparison(query)).toEqual({
        expression,
        filterType,
        threshold,
      });
    },
  );

  test.each([
    // No comparison at its end.
    "up",
    "sum(rate(x[5m])) / 2",
    // bool keeps every series, as a 0 or 1.
    "x > bool 1",
    // Two numbers, or two series.
    "1 > 0",
    "a > b",
    // A comparison inside, not at the end.
    "sum(x > 1)",
    // != has no rule condition to move to.
    "x != 1",
    // Not a number a criteria can hold.
    "x > Inf",
    "x > NaN",
    // Not an expression at all.
    "",
    "sum(",
  ])("%s ends in no comparison to move", (query: string) => {
    expect(splitPromQLMonitorComparison(query)).toBeNull();
  });
});
