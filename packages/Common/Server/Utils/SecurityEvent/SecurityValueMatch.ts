import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import {
  SQL,
  Statement,
  escapeIlikePattern,
} from "../AnalyticsDatabase/Statement";

/*
 * MATCHING AN EVENT AGAINST VALUES A TEAM WROTE DOWN, as SQL over the
 * SecurityEvent table: the one way rule exceptions (what a rule skips) and
 * watchlists (lists a rule reads) compare a field with their values, so a
 * value means the same thing in both.
 *
 *   - Text is compared whatever the case.
 *   - * stands for any run of characters, and nothing else is a wildcard:
 *     LIKE's own % _ and \ in a value are matched as written (a Windows
 *     path keeps its backslashes).
 *   - An IP address can be a CIDR range, matched only against fields that
 *     hold an address.
 *
 * Every value is bound as a parameter; only the fixed column names the
 * callers hand over are ever written into the SQL text.
 */

export const SECURITY_VALUE_WILDCARD: string = "*";

export function textParam(value: string): Statement {
  return SQL`${{ type: TableColumnType.Text, value }}`;
}

/*
 * Whether a text expression holds an address inside a CIDR range, false for
 * anything that is not an address. ClickHouse's isIPAddressInRange throws on
 * text that is neither IPv4 nor IPv6 ("Neither IPv4 nor IPv6 address: ''"),
 * and an event that names no address holds '' - so a rule's `cidr` used to
 * fail the whole read on the first such event. The address it is handed is
 * always one ('::' in place of anything else, which the guard in front then
 * turns down), so this holds without short-circuit evaluation.
 */
export function buildIpInRangeExpression(
  expression: Statement,
  cidr: string,
): Statement {
  return buildIpInAnyRangeExpression(expression, [cidr]);
}

/*
 * buildIpInRangeExpression for several ranges: the address is checked
 * once, then against each range - a constant each, which ClickHouse reads
 * far faster than ranges it has to take from an array row by row.
 */
export function buildIpInAnyRangeExpression(
  expression: Statement,
  cidrs: ReadonlyArray<string>,
): Statement {
  const isAddress: Statement = SQL`(isIPv4String(`;
  isAddress.append(expression);
  isAddress.append(") OR isIPv6String(");
  isAddress.append(expression);
  isAddress.append("))");

  const statement: Statement = SQL`(`;
  statement.append(isAddress);
  statement.append(" AND ");

  if (cidrs.length > 1) {
    statement.append("(");
  }

  cidrs.forEach((cidr: string, index: number): void => {
    if (index > 0) {
      statement.append(" OR ");
    }

    statement.append("isIPAddressInRange(if(");
    statement.append(isAddress);
    statement.append(", ");
    statement.append(expression);
    statement.append(", '::'), ");
    statement.append(textParam(cidr));
    statement.append(")");
  });

  if (cidrs.length > 1) {
    statement.append(")");
  }

  statement.append(")");
  return statement;
}

/*
 * A value with * as a LIKE pattern, lowercased: each piece literal (LIKE's
 * own % _ and \ escaped), the stars between them any run.
 */
export function wildcardValueToLikePattern(value: string): string {
  return value
    .toLowerCase()
    .split(SECURITY_VALUE_WILDCARD)
    .map((piece: string): string => {
      return escapeIlikePattern(piece);
    })
    .join("%");
}

/*
 * Whether a text expression is the value: whatever the case, * for any run
 * of characters; an address range when `isAddressRange`.
 */
export function buildTextMatchesValue(
  expression: Statement,
  value: string,
  options: { isAddressRange: boolean },
): Statement {
  if (options.isAddressRange) {
    return buildIpInRangeExpression(expression, value);
  }

  const lowered: string = value.toLowerCase();
  const statement: Statement = SQL`lowerUTF8(`;
  statement.append(expression);

  if (lowered.includes(SECURITY_VALUE_WILDCARD)) {
    statement.append(") LIKE ");
    statement.append(textParam(wildcardValueToLikePattern(lowered)));
    return statement;
  }

  statement.append(") = ");
  statement.append(textParam(lowered));
  return statement;
}

/*
 * Whether any element of an array column meets a condition on it:
 * `arrayExists(<element> -> <condition>, <column>)`. The element's name is
 * the caller's, chosen so no column can shadow it.
 */
export function buildAnyElementMatches(data: {
  column: string;
  elementName: string;
  matchElement: (element: Statement) => Statement;
}): Statement {
  const statement: Statement = new Statement([
    `arrayExists(${data.elementName} -> `,
  ]);
  statement.append(
    data.matchElement(new Statement([data.elementName], [])),
  );
  statement.append(`, ${data.column})`);
  return statement;
}

// Parts ORed, each in its own parentheses: `((a) OR (b))`.
export function orAllStatements(parts: ReadonlyArray<Statement>): Statement {
  const statement: Statement = SQL`(`;

  parts.forEach((part: Statement, index: number): void => {
    if (index > 0) {
      statement.append(" OR ");
    }

    statement.append(SQL`(`);
    statement.append(part);
    statement.append(")");
  });

  statement.append(")");
  return statement;
}
