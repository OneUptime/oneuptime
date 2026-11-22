import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import {
  SCRUB_MASK_MARK,
  SCRUB_REDACTED_PLACEHOLDER,
} from "../../../Types/Telemetry/ScrubRule";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";

/*
 * WHAT A SCRUB RULE LEFT IN A VALUE, ASKED IN CLICKHOUSE (#10435).
 *
 * The same question as Types/Telemetry/ScrubRule's getScrubPlaceholderKind,
 * for the reads that count or group by a value where it is stored: an
 * exception's affected users (ExceptionListStatsReader) and AI usage by
 * person or team (LlmUsageReader). Asked as each value is read, so rows
 * stored before the readers knew - an exception's "[REDACTED]" user, a
 * call's masked email - are read the same way as new ones.
 *
 *   - holds a shared placeholder: Redact's "[REDACTED]", or a mask's three
 *     stars or more - one placeholder for many values, never a value to
 *     count;
 *   - holds a Hash token: "[HASHED:" and 16 hex characters, or 8 in records
 *     stored before tokens were keyed (#10394) - one token per value.
 *
 * `expression` is SQL this code writes - a column, or ifNull() of one -
 * never anything a request sent. The texts it is compared with are bound as
 * parameters.
 */

/*
 * A Hash rule's token inside a text, either form: the ScrubHashTokenFormat
 * patterns, unanchored, for ClickHouse's match().
 */
export const SCRUB_HASH_TOKEN_SQL_PATTERN: string =
  "\\[HASHED:(?:[0-9a-f]{16}|[0-9a-f]{8})\\]";

// The value holds what Redact or Mask left.
export function buildHoldsSharedScrubPlaceholderSql(
  expression: string,
): Statement {
  const statement: Statement = SQL`(position(`;
  statement.append(expression);
  statement.append(
    SQL`, ${{
      type: TableColumnType.Text,
      value: SCRUB_REDACTED_PLACEHOLDER,
    }}) > 0 OR position(`,
  );
  statement.append(expression);
  statement.append(
    SQL`, ${{
      type: TableColumnType.Text,
      value: SCRUB_MASK_MARK,
    }}) > 0)`,
  );

  return statement;
}

// The value holds a Hash rule's token.
export function buildHoldsScrubHashTokenSql(expression: string): Statement {
  const statement: Statement = SQL`match(`;
  statement.append(expression);
  statement.append(
    SQL`, ${{
      type: TableColumnType.Text,
      value: SCRUB_HASH_TOKEN_SQL_PATTERN,
    }})`,
  );

  return statement;
}

// The value holds anything a scrub rule left: never a name, a person or an account.
export function buildHoldsScrubPlaceholderSql(expression: string): Statement {
  const statement: Statement = SQL`(`;
  statement.append(buildHoldsSharedScrubPlaceholderSql(expression));
  statement.append(" OR ");
  statement.append(buildHoldsScrubHashTokenSql(expression));
  statement.append(")");

  return statement;
}

/*
 * The value is a Hash token and nothing shared: one hidden value, counted
 * as its own.
 */
export function buildIsScrubPseudonymSql(expression: string): Statement {
  const statement: Statement = SQL`(`;
  statement.append(buildHoldsScrubHashTokenSql(expression));
  statement.append(" AND NOT ");
  statement.append(buildHoldsSharedScrubPlaceholderSql(expression));
  statement.append(")");

  return statement;
}
