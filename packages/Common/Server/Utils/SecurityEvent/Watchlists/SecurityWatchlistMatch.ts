import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import { SigmaWatchlist } from "../../../../Types/SecurityEvent/SecurityWatchlist";
import ThreatIntelIndicatorService from "../../../Services/ThreatIntelIndicatorService";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import {
  buildIpInAnyRangeExpression,
  orAllStatements,
  textParam,
  wildcardValueToLikePattern,
} from "../SecurityValueMatch";

/*
 * WHETHER AN EVENT'S FIELD IS ON A WATCHLIST, as SQL over the SecurityEvent
 * table: what a rule's `field|expand: '%vip_users%'` compiles to
 * (SigmaClickhouseCompiler), the list's values matched as rule exceptions
 * match theirs (SecurityValueMatch) - whatever the case, * for any run of
 * characters, an IP address list's ranges as ranges.
 *
 *   - Values as written: `lowerUTF8(field) IN [...]`, one Array(String)
 *     parameter per 100 KiB, a hash set ClickHouse builds once per read.
 *   - Patterns: one LIKE each, the pattern a constant (ClickHouse reads a
 *     constant LIKE far faster than patterns taken from an array per row).
 *   - Ranges: one address check, then each range.
 *   - A threat intel feed: `lowerUTF8(field) GLOBAL IN (<the feed's active
 *     indicators>)` - read where it runs, with nothing copied or bound.
 *
 * A list with nothing on it matches nothing: `0`, so `not` of it - "not on
 * the allow list" - holds for every event.
 *
 * HOW MUCH A READ CAN SEND. @clickhouse/client sends query parameters in
 * the request URL, and ClickHouse takes at most 128 KiB per parameter
 * (http_max_field_value_size) and 1 MiB for the whole URL
 * (http_max_uri_size), both counted URL-encoded. A list's values are split
 * over parameters of at most MAX_WATCHLIST_BYTES_PER_PARAMETER, and a read
 * is checked against MAX_DETECTION_READ_PARAMETER_BYTES before it is sent
 * (assertDetectionReadFits), so a rule that reads more than one request
 * carries fails with what to do, never with ClickHouse's "URI too long".
 */

// The lambda parameter for an array column's elements: named so no column can shadow it.
export const WATCHLIST_ELEMENT: string = "__watchlist_element";

// Under ClickHouse's 128 KiB per parameter, with room to spare.
export const MAX_WATCHLIST_BYTES_PER_PARAMETER: number = 100 * 1024;

/*
 * The most a detection read's parameters may take in the URL: ClickHouse's
 * 1 MiB, less room for the query id, the settings and the database name.
 */
export const MAX_DETECTION_READ_PARAMETER_BYTES: number = 900 * 1024;

/*
 * A string as @clickhouse/client writes it into a parameter: tab, line
 * breaks, quote and backslash escaped (formatQueryParams). Kept in step
 * with the client by SecurityWatchlistMatch.test.ts, which compares it with
 * the client's own.
 */
export function formatClickhouseParameterString(value: string): string {
  let result: string = "";

  for (let index: number = 0; index < value.length; index++) {
    switch (value.charCodeAt(index)) {
      case 9:
        result += "\\t";
        break;
      case 10:
        result += "\\n";
        break;
      case 13:
        result += "\\r";
        break;
      case 39:
        result += "\\'";
        break;
      case 92:
        result += "\\\\";
        break;
      default:
        result += value[index];
    }
  }

  return result;
}

/*
 * What a parameter's text takes in the request URL once the client has
 * escaped it (formatClickhouseParameterString) and URLSearchParams has
 * encoded it: letters, digits and * - . _ as they are, a space as +, a
 * character the client escapes as two (\t, \', \\), and every other
 * byte of its UTF-8 as %XX. Counted in one pass, with nothing built: a run
 * counts thousands of values every minute. SecurityWatchlistMatch.test.ts
 * holds it to what the client and URLSearchParams really send.
 */
export function getParameterTextUrlBytes(text: string): number {
  let total: number = 0;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 42 ||
      code === 45 ||
      code === 46 ||
      code === 95 ||
      code === 32
    ) {
      total += 1;
    } else if (code === 9 || code === 10 || code === 13) {
      // A backslash (%5C) and a letter.
      total += 4;
    } else if (code === 39 || code === 92) {
      // A backslash and the character, each %XX.
      total += 6;
    } else if (code < 128) {
      total += 3;
    } else if (code < 2048) {
      total += 6;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < text.length &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      // A character outside the Basic Multilingual Plane: four bytes.
      total += 12;
      index++;
    } else {
      total += 9;
    }
  }

  return total;
}

/*
 * What one value takes inside an Array(String) parameter, in the URL: the
 * value between quotes (%27 each), and the comma after it (%2C).
 */
export function getWatchlistValueUrlBytes(value: string): number {
  return getParameterTextUrlBytes(value) + 9;
}

/*
 * Values in consecutive groups of at most `maxBytes` URL bytes each, in
 * their order: one Array(String) parameter each.
 */
export function splitWatchlistValueParameters(
  values: ReadonlyArray<string>,
  maxBytes: number = MAX_WATCHLIST_BYTES_PER_PARAMETER,
): Array<Array<string>> {
  const groups: Array<Array<string>> = [];
  let current: Array<string> = [];
  let currentBytes: number = 0;

  for (const value of values) {
    const bytes: number = getWatchlistValueUrlBytes(value);

    if (current.length > 0 && currentBytes + bytes > maxBytes) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(value);
    currentBytes += bytes;
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

/*
 * What one bound value takes in the URL, written as the client writes it:
 * an array between brackets (%5B %5D), each element quoted when it is
 * text, with a comma after it (one more than the client writes - an upper
 * bound by three bytes).
 */
function getParameterUrlBytes(value: unknown): number {
  if (Array.isArray(value)) {
    let total: number = 6;

    for (const item of value) {
      total +=
        typeof item === "string"
          ? getWatchlistValueUrlBytes(item)
          : getParameterTextUrlBytes(String(item)) + 3;
    }

    return total;
  }

  return getParameterTextUrlBytes(String(value));
}

// What a statement's parameters take in the request URL, with their names.
export function getStatementParameterUrlBytes(statement: Statement): number {
  let total: number = 0;

  for (const [key, value] of Object.entries(statement.query_params)) {
    // `param_<key>=` and the `&` before the next one.
    total += `param_${key}=&`.length + getParameterUrlBytes(value);
  }

  return total;
}

function formatKilobytes(bytes: number): string {
  return `${Math.ceil(bytes / 1024).toLocaleString("en-US")} KB`;
}

/*
 * Refuse a detection read too large to send in one request: a rule that
 * reads long watchlists, more than once in a correlation. The message is the
 * rule's error, so it says what to do.
 */
export function assertDetectionReadFits(statement: Statement): void {
  const bytes: number = getStatementParameterUrlBytes(statement);

  if (bytes > MAX_DETECTION_READ_PARAMETER_BYTES) {
    throw new BadDataException(
      `This rule reads more watchlist values than one read can send to the database: about ${formatKilobytes(
        bytes,
      )}, where ${formatKilobytes(
        MAX_DETECTION_READ_PARAMETER_BYTES,
      )} fit. Read fewer or shorter watchlists, or follow a threat intel feed for a long list.`,
    );
  }
}

/*
 * Whether a text expression holds a value on the watchlist. `expression`
 * is text already (a typed column, an attribute, a number read as text).
 */
export function buildWatchlistTextMatch(
  expression: Statement,
  watchlist: SigmaWatchlist,
): Statement {
  const parts: Array<Statement> = [];

  for (const values of splitWatchlistValueParameters(watchlist.exactValues)) {
    const part: Statement = SQL`lowerUTF8(`;
    part.append(expression);
    part.append(
      SQL`) IN ${{
        type: TableColumnType.ArrayText,
        value: values,
      }}`,
    );
    parts.push(part);
  }

  for (const pattern of watchlist.patterns) {
    const part: Statement = SQL`lowerUTF8(`;
    part.append(expression);
    part.append(") LIKE ");
    part.append(textParam(wildcardValueToLikePattern(pattern)));
    parts.push(part);
  }

  if (watchlist.ranges.length > 0) {
    parts.push(buildIpInAnyRangeExpression(expression, watchlist.ranges));
  }

  if (watchlist.threatIntelFeed) {
    const part: Statement = SQL`lowerUTF8(`;
    part.append(expression);
    part.append(") GLOBAL IN (");
    part.append(
      ThreatIntelIndicatorService.buildActiveValuesSubquery({
        projectId: new ObjectID(watchlist.threatIntelFeed.projectId),
        feedId: new ObjectID(watchlist.threatIntelFeed.feedId),
        indicatorTypes: watchlist.threatIntelFeed.indicatorTypes,
        now: OneUptimeDate.getCurrentDate(),
      }),
    );
    part.append(")");
    parts.push(part);
  }

  // An empty list holds nothing: no event's field is on it.
  if (parts.length === 0) {
    return new Statement(["0"], []);
  }

  return parts.length === 1 ? parts[0]! : orAllStatements(parts);
}

// Whether any element of an array column (observables, ATT&CK ids) is on the watchlist.
export function buildWatchlistArrayMatch(
  column: string,
  watchlist: SigmaWatchlist,
): Statement {
  const statement: Statement = new Statement([
    `arrayExists(${WATCHLIST_ELEMENT} -> `,
  ]);
  statement.append(
    buildWatchlistTextMatch(new Statement([WATCHLIST_ELEMENT], []), watchlist),
  );
  statement.append(`, ${column})`);
  return statement;
}
