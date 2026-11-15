/**
 * Compiles the log search bar's query string into a `Query<Log>` for the
 * AnalyticsDatabaseService.
 *
 * The grammar itself lives in `Common/Types/Telemetry/TelemetrySearchQuery` —
 * shared with traces, metrics and exceptions, so `@platform.team:a*` means the
 * same thing on every explorer. Everything here is log-specific: which names
 * are columns, which alias to what, and how severity is spelled in the data.
 */

import Search from "../BaseDatabase/Search";
import { normalizeLogSeverity } from "./LogSeverity";
import {
  SearchToken,
  SearchTokenType,
  SearchValueOperator,
  SearchQueryValue,
  parseSearchQuery,
  predicateToQueryValue,
} from "../Telemetry/TelemetrySearchQuery";

export interface LogFilter {
  body?: string | Search<string> | Array<unknown>;
  severityText?: unknown;
  primaryEntityId?: unknown;
  traceId?: unknown;
  spanId?: unknown;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Columns a bare `field:value` token can address. Anything else is treated as
 * an attribute, which is what makes `k8s.pod:foo` work without an `@`.
 */
const TOP_LEVEL_FIELDS: Set<string> = new Set([
  "severityText",
  "primaryEntityId",
  "traceId",
  "spanId",
  "body",
]);

export const LOG_FIELD_ALIASES: Record<string, string> = {
  severity: "severityText",
  severitytext: "severityText",
  level: "severityText",
  service: "primaryEntityId",
  primaryentityid: "primaryEntityId",
  trace: "traceId",
  traceid: "traceId",
  span: "spanId",
  spanid: "spanId",
  message: "body",
  msg: "body",
  log: "body",
  body: "body",
};

/**
 * Field names that may be followed by a space before their value
 * (`severity: error`). Kept to known names so ordinary prose containing a
 * colon stays free text rather than becoming a filter on an invented field.
 */
export const LOG_KNOWN_FIELD_KEYS: Set<string> = new Set(
  Object.keys(LOG_FIELD_ALIASES),
);

type NormalizeSeverityValueFunction = (value: string) => string;

/*
 * Severity values stored in the database are LogSeverity's members, in
 * title case ("Error", "Debug"). A word a person types names one as ingest
 * reads a sender's level - the one table of level words every log path
 * reads (normalizeLogSeverity, LOG_SEVERITY_NUMBER_BY_TEXT; issue #8538):
 * `error` matches Error, `critical` Fatal, `crit` Error and `notice`
 * Information, so a search for a level finds the logs sent with it.
 * Anything else is searched for as typed. The table is a Map, so a word
 * named like an Object member (`constructor`, `toString`) is only a word.
 */
const normalizeSeverityValue: NormalizeSeverityValueFunction = (
  value: string,
): string => {
  return normalizeLogSeverity(value) || value;
};

type CanonicalizeTokenFunction = (token: SearchToken) => SearchToken;

/*
 * Severity is an enum spelled in title case in ClickHouse, and users type it
 * however they like. Canonicalising here — on the predicate, before it is
 * compiled — means the normalisation applies to every operator, not just
 * equality: `severity:(error OR warn)` and `-severity:debug` get it too.
 */
const canonicalizeToken: CanonicalizeTokenFunction = (
  token: SearchToken,
): SearchToken => {
  if (token.key !== "severityText") {
    return token;
  }

  return {
    ...token,
    predicate: {
      ...token.predicate,
      value: normalizeSeverityValue(token.predicate.value),
      values: token.predicate.values.map(normalizeSeverityValue),
    },
  };
};

type AssignFunction = (
  target: Record<string, unknown>,
  key: string,
  value: unknown,
) => void;

/*
 * Two filters on one key AND together rather than the second overwriting the
 * first — `@k:a* @k:*b` is "starts with a and ends with b". The compilers
 * accept an array of operators on a column and on a map sub-key and compile
 * each one; a bare string cannot join such an array, so the first wins in
 * that case (a plain equality already pins the value).
 */
const assign: AssignFunction = (
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void => {
  const existing: unknown = target[key];

  if (existing === undefined) {
    target[key] = value;
    return;
  }

  if (typeof existing === "string" || typeof value === "string") {
    return;
  }

  target[key] = Array.isArray(existing)
    ? [...existing, value]
    : [existing, value];
};

type ApplyFreeTextFunction = (filter: LogFilter, phrase: string) => void;

/*
 * Each free-text phrase is its own contains-predicate on the body. They are
 * NOT concatenated: `foo severity:error bar` means "the line mentions foo and
 * mentions bar", never the phrase "foo bar", which never occurred in any log
 * line and matched nothing.
 */
const applyFreeText: ApplyFreeTextFunction = (
  filter: LogFilter,
  phrase: string,
): void => {
  if (phrase.trim().length === 0) {
    return;
  }

  assign(filter as Record<string, unknown>, "body", new Search(phrase));
};

export function queryStringToFilter(queryString: string): LogFilter {
  const tokens: Array<SearchToken> = parseSearchQuery(queryString, {
    knownFieldKeys: LOG_KNOWN_FIELD_KEYS,
    fieldAliases: LOG_FIELD_ALIASES,
  });

  const filter: LogFilter = {};

  for (const token of tokens) {
    if (token.type === SearchTokenType.FreeText) {
      applyFreeText(filter, token.predicate.value);
      continue;
    }

    const canonical: SearchToken = canonicalizeToken(token);
    const compiled: SearchQueryValue = predicateToQueryValue(
      canonical.predicate,
    );

    /*
     * An `@`-prefixed token is ALWAYS an attribute, even when the key happens
     * to spell a column name. `@body:x` used to filter the body column and
     * `@traceId:x` the traceId column, silently ignoring the `@` that says
     * "look in the attributes map".
     */
    if (
      canonical.type === SearchTokenType.Field &&
      TOP_LEVEL_FIELDS.has(canonical.key)
    ) {
      assign(filter as Record<string, unknown>, canonical.key, compiled);
      continue;
    }

    if (!filter.attributes) {
      filter.attributes = {};
    }

    assign(filter.attributes, canonical.key, compiled);
  }

  return filter;
}

/**
 * Does this query string carry any filter at all?
 *
 * Used by callers that need to tell "the user typed nothing" from "the user
 * typed something that parsed to nothing".
 */
export function isEmptyLogQuery(queryString: string): boolean {
  return parseSearchQuery(queryString).length === 0;
}

export { SearchValueOperator };

export default queryStringToFilter;
