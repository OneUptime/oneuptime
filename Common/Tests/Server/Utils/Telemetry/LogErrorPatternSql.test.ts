import {
  LOG_ERROR_PATTERN_SOURCE_EXPRESSION,
  buildLogErrorPatternExpression,
  clampLogErrorPattern,
  getLogErrorPatternParameterCount,
} from "../../../../Server/Utils/Telemetry/LogErrorPatternSql";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  LOG_ERROR_PATTERN_MAX_LENGTH,
  LOG_ERROR_PATTERN_RULES,
  LogErrorPatternRule,
} from "../../../../Utils/Telemetry/LogErrorPattern";
import { describe, expect, test } from "@jest/globals";

/*
 * The SQL compiler and the JavaScript normalizer must stay two views of one
 * rule table. If they drift, the Insights page groups errors one way in the
 * database and describes them another way in the browser — a discrepancy
 * that is invisible until someone notices the counts do not add up.
 */

describe("buildLogErrorPatternExpression", () => {
  test("nests one replaceRegexpAll per rule around the body expression", () => {
    const statement: Statement = buildLogErrorPatternExpression();

    const openCount: number = (
      statement.query.match(/replaceRegexpAll\(/g) || []
    ).length;

    expect(openCount).toBe(LOG_ERROR_PATTERN_RULES.length);
    expect(statement.query).toContain(LOG_ERROR_PATTERN_SOURCE_EXPRESSION);
  });

  test("coalesces the Nullable body column before rewriting it", () => {
    /*
     * `replaceRegexpAll(NULL, ...)` is NULL, which would collapse every
     * body-less row into one meaningless NULL group at the top of the list.
     */
    expect(LOG_ERROR_PATTERN_SOURCE_EXPRESSION).toBe("ifNull(body, '')");
    expect(buildLogErrorPatternExpression().query).toContain(
      "replaceRegexpAll(ifNull(body, '')",
    );
  });

  test("binds every rule pattern and replacement as a parameter, never as SQL text", () => {
    const statement: Statement = buildLogErrorPatternExpression();
    const values: Array<unknown> = Object.values(statement.query_params);

    for (const rule of LOG_ERROR_PATTERN_RULES) {
      expect(values).toContain(rule.pattern);
      expect(values).toContain(rule.replacement);
      /*
       * A regex spliced into the query text would be both an injection
       * surface and a quoting nightmare (every rule contains backslashes).
       */
      expect(statement.query).not.toContain(rule.pattern);
    }
  });

  test("applies rules innermost-first, matching the normalizer's iteration order", () => {
    const statement: Statement = buildLogErrorPatternExpression();
    const params: Record<string, unknown> = statement.query_params;

    LOG_ERROR_PATTERN_RULES.forEach(
      (rule: LogErrorPatternRule, index: number): void => {
        expect(params[`p${index * 2}`]).toBe(rule.pattern);
        expect(params[`p${index * 2 + 1}`]).toBe(rule.replacement);
      },
    );
  });

  test("truncates to the same maximum length the normalizer slices at", () => {
    const statement: Statement = buildLogErrorPatternExpression();

    expect(statement.query).toContain("substring(");
    expect(Object.values(statement.query_params)).toContain(
      LOG_ERROR_PATTERN_MAX_LENGTH,
    );
  });

  test("trims on both sides of the truncation, as the normalizer does", () => {
    /*
     * trim -> slice -> trim. Without the outer trim a cut landing mid-space
     * would yield a pattern with a trailing space, which is a different
     * GROUP BY key from the same pattern trimmed.
     */
    const query: string = buildLogErrorPatternExpression().query;

    expect(query.startsWith("trimBoth(substring(trimBoth(")).toBe(true);
    expect(query.endsWith("))")).toBe(true);
  });

  test("reports its own parameter count", () => {
    const statement: Statement = buildLogErrorPatternExpression();

    expect(getLogErrorPatternParameterCount()).toBe(
      Object.keys(statement.query_params).length,
    );
  });

  test("accepts an alternate trusted source expression", () => {
    const statement: Statement = buildLogErrorPatternExpression(
      "ifNull(attributes['message'], '')",
    );

    expect(statement.query).toContain(
      "replaceRegexpAll(ifNull(attributes['message'], '')",
    );
  });
});

describe("clampLogErrorPattern", () => {
  test("leaves a pattern within the limit untouched", () => {
    expect(clampLogErrorPattern("connection refused to <ip>")).toBe(
      "connection refused to <ip>",
    );
  });

  test("clamps an oversized pattern to the expression's own maximum", () => {
    const oversized: string = "x".repeat(LOG_ERROR_PATTERN_MAX_LENGTH * 3);

    expect(clampLogErrorPattern(oversized).length).toBe(
      LOG_ERROR_PATTERN_MAX_LENGTH,
    );
  });

  test("an empty pattern clamps to itself", () => {
    expect(clampLogErrorPattern("")).toBe("");
  });
});
