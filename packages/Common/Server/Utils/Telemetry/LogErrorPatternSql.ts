import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import {
  LOG_ERROR_PATTERN_MAX_LENGTH,
  LOG_ERROR_PATTERN_RULES,
  LogErrorPatternRule,
} from "../../../Utils/Telemetry/LogErrorPattern";

/*
 * Compiles the shared error-pattern rules (Common/Utils/Telemetry/
 * LogErrorPattern) into the ClickHouse expression that does the grouping.
 *
 * The grouping has to happen in the database. Normalizing client-side would
 * mean shipping a page of raw bodies to the browser and counting those,
 * which answers "what are the top errors in the 5000 rows I happened to
 * fetch" — a different, and much less useful, question than "what are the
 * top errors in this window".
 *
 * Shape of the emitted expression, for rules r0..rN in order:
 *
 *   trimBoth(substringUTF8(trimBoth(
 *     replaceRegexpAll(...replaceRegexpAll(ifNull(body,''), p0, x0)..., pN, xN)
 *   ), 1, 300))
 *
 * The innermost call is the FIRST rule, matching the sequential application
 * order `normalizeLogBodyToErrorPattern` uses, and the trim/truncate/trim
 * tail mirrors its `.trim()` -> `.slice()` -> `.trim()`. The shape is pinned
 * by Common/Tests/Server/Utils/Telemetry/LogErrorPatternSql.test.ts.
 *
 * Truncation uses substringUTF8, NOT substring. ClickHouse's `substring`
 * counts BYTES, so a 300-byte cut through a Japanese message or an emoji
 * lands mid-sequence and the group key ends in a broken UTF-8 fragment. The
 * UTF8 variant counts characters, which is also what the JavaScript
 * normalizer's `.slice()` approximates. The two are not bit-identical for
 * astral-plane characters (JS slices UTF-16 code units, so an emoji costs it
 * two) — that only shifts where a very long pattern is cut, never what it
 * groups, and is deliberately not claimed as exact parity.
 *
 * Patterns and replacements ride as bound query parameters rather than
 * being interpolated. ClickHouse substitutes parameters into the AST as
 * constant literals during parsing, so `replaceRegexpAll` still sees the
 * constant regexp argument it requires (the same shape the Sigma compiler
 * already relies on for `match(expr, {p:String})`), and no rule text ever
 * reaches the SQL text itself.
 */

/**
 * The column expression the pattern is computed from.
 *
 * `body` is Nullable(String) on the Log table, and `replaceRegexpAll(NULL,
 * ...)` is NULL — which would collapse every body-less row into one NULL
 * group. Coalescing first turns those into the empty pattern, which the
 * callers exclude with a `!= ''` predicate.
 */
export const LOG_ERROR_PATTERN_SOURCE_EXPRESSION: string = "ifNull(body, '')";

/**
 * Build the pattern expression over `sourceExpression`.
 *
 * `sourceExpression` is appended to the statement as trusted SQL — it must
 * be a literal owned by this codebase (in practice always
 * LOG_ERROR_PATTERN_SOURCE_EXPRESSION), never anything derived from a
 * request.
 */
export function buildLogErrorPatternExpression(
  sourceExpression: string = LOG_ERROR_PATTERN_SOURCE_EXPRESSION,
): Statement {
  const statement: Statement = new Statement();

  statement.append("trimBoth(substringUTF8(trimBoth(");

  // One open paren per rule; the arguments below close them inside-out.
  statement.append("replaceRegexpAll(".repeat(LOG_ERROR_PATTERN_RULES.length));

  statement.append(sourceExpression);

  /*
   * Ascending order: rule 0's arguments close the innermost call, so it is
   * applied first — exactly as the JavaScript normalizer iterates.
   */
  for (const rule of LOG_ERROR_PATTERN_RULES) {
    statement.append(
      SQL`, ${{
        type: TableColumnType.Text,
        value: rule.pattern,
      }}, ${{
        type: TableColumnType.Text,
        value: rule.replacement,
      }})`,
    );
  }

  statement.append(
    SQL`), 1, ${{
      type: TableColumnType.Number,
      value: LOG_ERROR_PATTERN_MAX_LENGTH,
    }}))`,
  );

  return statement;
}

/**
 * How many bound parameters `buildLogErrorPatternExpression` contributes.
 * Exported so callers reasoning about parameter budgets (and the tests that
 * pin statement shapes) do not have to count rules by hand.
 */
export function getLogErrorPatternParameterCount(): number {
  return LOG_ERROR_PATTERN_RULES.length * 2 + 1;
}

/**
 * Guard for a caller-supplied pattern value (the detail endpoints echo one
 * back to scope their queries), bounding the parameter without changing
 * which rows it matches.
 *
 * Counted in CODE POINTS, because that is what the expression above cuts
 * by. Measuring in JavaScript's UTF-16 code units instead would mangle a
 * legitimate key: a 300-code-point pattern containing one emoji has
 * `.length === 301`, so the clamp would fire on a value the database
 * considers exactly at the limit and slice it — leaving a lone surrogate at
 * the tail when the emoji sits there. The bind would then match zero rows
 * and, since nothing throws, every drill-down panel would come back
 * cheerfully empty for a Top Errors row showing a real count.
 */
export function clampLogErrorPattern(pattern: string): string {
  const codePoints: Array<string> = Array.from(pattern);

  if (codePoints.length <= LOG_ERROR_PATTERN_MAX_LENGTH) {
    return pattern;
  }

  return codePoints.slice(0, LOG_ERROR_PATTERN_MAX_LENGTH).join("");
}

export type { LogErrorPatternRule };
