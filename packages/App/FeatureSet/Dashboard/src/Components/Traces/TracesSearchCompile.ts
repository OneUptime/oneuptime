/**
 * Compiles the traces explorer's search bar and facet chips into the two
 * transports the view runs on: the `Query<Span>` behind the span list, and
 * the JSON body behind the histogram / facets / analytics endpoints.
 *
 * The grammar itself lives in `Common/Types/Telemetry/TelemetrySearchQuery` —
 * shared with logs, metrics and exceptions, so `@k:a*` means the same thing on
 * every explorer. Everything here is trace-specific: which names are columns,
 * how a span status / kind / duration is spelled, and the rule that both
 * transports are built from ONE token list. They used to be built from two
 * (the list from a hand-rolled tokenizer, the chart from the chips), which is
 * how a filter could narrow the table under a chart that kept counting rows
 * the table no longer showed.
 *
 * Renderer-free so the App jest suite can exercise it in plain Node.
 */

import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import {
  SearchQueryValue,
  SearchToken,
  SearchTokenType,
  SearchValueOperator,
  SearchValuePredicate,
  buildSearchTokenValue,
  compileAttributeChipValues,
  parseSearchQuery,
  parseSearchValue,
  predicateToQueryValue,
  predicateToSerializedValue,
  stripQuotes,
} from "Common/Types/Telemetry/TelemetrySearchQuery";

/** Chip facet-key prefix that routes a value into the attributes map. */
export const ATTRIBUTE_CHIP_PREFIX: string = "attributes.";

/**
 * Chip facet-key prefix for the pre-grammar contains-match filter. Only a
 * saved view (or a URL written before the grammar landed) still produces one;
 * a fresh parse expresses "contains" as a predicate on the ordinary
 * attributes map instead.
 */
export const ATTRIBUTE_SEARCH_CHIP_PREFIX: string = "attributeSearches.";

/** User-facing field name -> the Span column it filters. */
export const TRACE_FIELD_ALIAS_MAP: Record<string, string> = {
  service: "primaryEntityId",
  status: "statusCode",
  name: "name",
  trace: "traceId",
  span: "spanId",
  kind: "kind",
  hasexception: "hasException",
  statusmessage: "statusMessage",
  duration: "durationUnixNano",
};

/**
 * Field names that may be followed by a space before their value
 * (`status: error`), and the set that decides whether a bare `key:value` is a
 * column filter at all — anything else is an attribute.
 */
export const TRACE_KNOWN_FIELD_KEYS: Set<string> = new Set(
  Object.keys(TRACE_FIELD_ALIAS_MAP),
);

/** Friendly span kind -> the OTel enum string stored on the column. */
export const SPAN_KIND_VALUE_MAP: Record<string, string> = {
  server: "SPAN_KIND_SERVER",
  client: "SPAN_KIND_CLIENT",
  producer: "SPAN_KIND_PRODUCER",
  consumer: "SPAN_KIND_CONSUMER",
  internal: "SPAN_KIND_INTERNAL",
};

/*
 * Fields whose typed value is NOT the value that reaches the database: a span
 * status is a number, a kind is an OTel enum string, a duration is nanoseconds.
 * A chip carries its value through untouched, so these have to be submitted as
 * search text and compiled — see resolveTraceSearchChip.
 */
const MAPPED_FIELD_KEYS: Set<string> = new Set(["status", "kind", "duration"]);

const MS_TO_NANO: number = 1_000_000;

export interface TraceAttributeFilter {
  key: string;
  predicate: SearchValuePredicate;
}

export interface ParsedTraceSearch {
  /** Bare words, joined; matched as a substring of the span name. */
  freeText: string;
  /** Span column -> the value spellings the mappers below understand. */
  fieldFilters: Record<string, Array<string>>;
  /** Attribute tokens, in the order they were typed. */
  attributeFilters: Array<TraceAttributeFilter>;
}

type FieldTokenValuesFunction = (token: SearchToken) => Array<string>;

/*
 * The value spellings a known field contributes.
 *
 * Known fields are compiled by the mappers below, which speak what the user
 * types (`error`, `server`, `>500`), not the grammar's predicate vocabulary:
 * the aggregation endpoint has one fixed payload key per filter and cannot
 * carry an arbitrary operator, so a field predicate the chart could not follow
 * would narrow the list alone. An any-of list is the exception — both
 * transports already carry several values for a field.
 */
const fieldTokenValues: FieldTokenValuesFunction = (
  token: SearchToken,
): Array<string> => {
  if (token.predicate.operator === SearchValueOperator.In) {
    return token.predicate.values;
  }

  if (token.predicate.operator === SearchValueOperator.Equals) {
    return [token.predicate.value];
  }

  const colonIndex: number = token.raw.indexOf(":");

  if (colonIndex < 0) {
    return [];
  }

  return [stripQuotes(token.raw.substring(colonIndex + 1).trim())];
};

type ParseTraceSearchFunction = (raw: string) => ParsedTraceSearch;

/**
 * Parse the traces search string into the pieces the two transports consume.
 */
export const parseTraceSearch: ParseTraceSearchFunction = (
  raw: string,
): ParsedTraceSearch => {
  const tokens: Array<SearchToken> = parseSearchQuery(raw, {
    knownFieldKeys: TRACE_KNOWN_FIELD_KEYS,
    fieldAliases: TRACE_FIELD_ALIAS_MAP,
  });

  const fieldFilters: Record<string, Array<string>> = {};
  const attributeFilters: Array<TraceAttributeFilter> = [];
  const freeTextParts: Array<string> = [];

  for (const token of tokens) {
    if (token.type === SearchTokenType.Attribute) {
      attributeFilters.push({ key: token.key, predicate: token.predicate });
      continue;
    }

    if (token.type === SearchTokenType.FreeText) {
      freeTextParts.push(token.predicate.value);
      continue;
    }

    /*
     * A negated known field has nowhere to go — every field filter reaches the
     * aggregation endpoint as a positive list (`statusCodes`, `spanKinds`, …),
     * so honouring the `-` on the list alone would leave the chart counting
     * rows the table no longer shows. It stays free text, which is what the
     * hand-rolled tokenizer this replaces also did with it.
     */
    if (token.negated) {
      freeTextParts.push(token.raw);
      continue;
    }

    const values: Array<string> = fieldTokenValues(token).filter(
      (value: string): boolean => {
        return value.length > 0;
      },
    );

    if (values.length === 0) {
      continue;
    }

    if (!fieldFilters[token.key]) {
      fieldFilters[token.key] = [];
    }

    fieldFilters[token.key]!.push(...values);
  }

  return {
    freeText: freeTextParts.join(" ").trim(),
    fieldFilters,
    attributeFilters,
  };
};

export interface TraceSearchChip {
  facetKey: string;
  value: string;
}

type ResolveTraceSearchChipFunction = (
  fieldKey: string,
  value: string,
) => TraceSearchChip | null;

/**
 * What the search bar's Enter key should do with a typed `key:value`.
 *
 * `null` means "leave the token in the input and submit the search string",
 * which routes it through {@link parseTraceSearch}. That is the only way the
 * typed path and the chip path can agree: a chip is a bare (key, value) pair
 * with no operator slot, so a value carrying grammar — `a*`, `>500`, `~text`,
 * `(a OR b)` — would be chipped as the literal text it is written in, and a
 * mapped field like `status:error` would put the string "error" on a numeric
 * column. Both used to happen, which is why typing a token and pressing Enter
 * produced a different query from typing the very same token and pressing
 * Enter twice.
 */
export const resolveTraceSearchChip: ResolveTraceSearchChipFunction = (
  fieldKey: string,
  value: string,
): TraceSearchChip | null => {
  const lowerFieldKey: string = fieldKey.toLowerCase();
  const predicate: SearchValuePredicate = parseSearchValue(value);

  /*
   * Equality whose literal survives quote-stripping unchanged is the only
   * value a chip can carry losslessly; anything else (an operator, a glob, an
   * escape) has to be re-parsed from the search string to keep its meaning.
   */
  const carriesGrammar: boolean =
    predicate.operator !== SearchValueOperator.Equals ||
    predicate.value !== stripQuotes(value.trim());

  if (carriesGrammar) {
    return null;
  }

  if (TRACE_KNOWN_FIELD_KEYS.has(lowerFieldKey)) {
    if (MAPPED_FIELD_KEYS.has(lowerFieldKey)) {
      return null;
    }

    return {
      facetKey: TRACE_FIELD_ALIAS_MAP[lowerFieldKey]!,
      value: predicate.value,
    };
  }

  /*
   * An attribute chip is re-parsed by the grammar when the query is built, so
   * the literal has to be written back AS a token — an attribute value like
   * `/api/*` would otherwise come back as a glob matching far more than the
   * row the user clicked.
   */
  return {
    facetKey: `${ATTRIBUTE_CHIP_PREFIX}${fieldKey}`,
    value: buildSearchTokenValue(predicate.value),
  };
};

export interface TraceAttributeSources {
  /** `attributes.<key>` chip values, grouped by key. Grammar tokens. */
  chipValues: Record<string, Array<string>>;
  /** Attribute tokens parsed out of the submitted search string. */
  parsed: Array<TraceAttributeFilter>;
  /** `attributeSearches.<key>` chips — saved views only. Plain literals. */
  legacyContainsChips: Record<string, string>;
  /** The host page's read-only resource scope. Plain literals. */
  scope: Record<string, string>;
}

export interface TraceAttributeFilters {
  /** `query.attributes` for the span list. */
  queryAttributes: Record<string, unknown>;
  /** `payload.attributes` for the histogram / facets / analytics endpoints. */
  payloadAttributes: JSONObject;
  /** `payload.attributeSearches` — the legacy chips, and nothing else. */
  payloadAttributeSearches: Record<string, string>;
}

type SerializeQueryValueFunction = (
  value: SearchQueryValue | Array<SearchQueryValue>,
) => JSONValue;

const serializeQueryValue: SerializeQueryValueFunction = (
  value: SearchQueryValue | Array<SearchQueryValue>,
): JSONValue => {
  if (Array.isArray(value)) {
    return value.map((entry: SearchQueryValue): JSONValue => {
      return typeof entry === "string" ? entry : entry.toJSON();
    }) as JSONValue;
  }

  return typeof value === "string" ? value : value.toJSON();
};

type CompileTraceAttributeFiltersFunction = (
  sources: TraceAttributeSources,
) => TraceAttributeFilters;

/**
 * Compile every attribute filter the view carries into both transports at
 * once.
 *
 * One function, one precedence order, two renderings of the same predicate —
 * which is what stops the chart and the list disagreeing about a filter the
 * user can see applied. Precedence, weakest first: chips, then the submitted
 * search string, then the legacy contains chips, then the host page's
 * read-only scope.
 */
export const compileTraceAttributeFilters: CompileTraceAttributeFiltersFunction =
  (sources: TraceAttributeSources): TraceAttributeFilters => {
    const queryAttributes: Record<string, unknown> = {};
    const payloadAttributes: JSONObject = {};
    const payloadAttributeSearches: Record<string, string> = {};

    for (const [key, values] of Object.entries(sources.chipValues)) {
      const compiled: SearchQueryValue | Array<SearchQueryValue> | undefined =
        compileAttributeChipValues(values);

      if (compiled === undefined) {
        continue;
      }

      queryAttributes[key] = compiled;
      payloadAttributes[key] = serializeQueryValue(compiled);
    }

    for (const filter of sources.parsed) {
      queryAttributes[filter.key] = predicateToQueryValue(filter.predicate);
      payloadAttributes[filter.key] = predicateToSerializedValue(
        filter.predicate,
      );
    }

    for (const [key, value] of Object.entries(sources.legacyContainsChips)) {
      /*
       * The read-only scope owns its keys outright: ANDing a user's contains
       * filter onto a pinned resource scope would narrow the page below what
       * the page is for.
       */
      if (value.length === 0 || sources.scope[key] !== undefined) {
        continue;
      }

      queryAttributes[key] = new Search(value);
      delete payloadAttributes[key];
      payloadAttributeSearches[key] = value;
    }

    for (const [key, value] of Object.entries(sources.scope)) {
      queryAttributes[key] = value;
      payloadAttributes[key] = value;
    }

    return { queryAttributes, payloadAttributes, payloadAttributeSearches };
  };

type ToSpanStatusCodeFunction = (value: string) => number;

/**
 * A status value — typed (`error`) or clicked in the facet sidebar, where the
 * values arrive as the numeric strings ClickHouse returns — as its enum
 * member. Both spellings resolve here so a typed filter and a clicked one
 * cannot compile to different codes.
 */
export const toSpanStatusCode: ToSpanStatusCodeFunction = (
  value: string,
): number => {
  const lower: string = value.trim().toLowerCase();

  if (lower === "error" || lower === String(SpanStatus.Error)) {
    return SpanStatus.Error;
  }

  if (lower === "ok" || lower === String(SpanStatus.Ok)) {
    return SpanStatus.Ok;
  }

  return SpanStatus.Unset;
};

type ToSpanKindFunction = (value: string) => string;

/** A kind value — typed (`server`) or already an enum string — as the enum. */
export const toSpanKind: ToSpanKindFunction = (value: string): string => {
  return SPAN_KIND_VALUE_MAP[value.trim().toLowerCase()] || value;
};

type ToNumericQueryValueFunction = (
  values: Array<number>,
) => number | Includes | undefined;

/** One value filters directly; several become an `IN (...)`. */
export const toNumericQueryValue: ToNumericQueryValueFunction = (
  values: Array<number>,
): number | Includes | undefined => {
  const distinct: Array<number> = Array.from(new Set(values));

  if (distinct.length === 0) {
    return undefined;
  }

  return distinct.length === 1 ? distinct[0]! : new Includes(distinct);
};

export interface TraceDurationFilter {
  minDurationNano?: number | undefined;
  maxDurationNano?: number | undefined;
  exactDurationNano?: number | undefined;
}

type ToTraceDurationFilterFunction = (rawValue: string) => TraceDurationFilter;

/**
 * `duration:>500` / `duration:<200` / `duration:500`, in milliseconds, as the
 * nanosecond bounds both transports carry. A value that names no number at all
 * yields no bound rather than a `NaN` comparison that matches nothing.
 */
export const toTraceDurationFilter: ToTraceDurationFilterFunction = (
  rawValue: string,
): TraceDurationFilter => {
  const trimmed: string = (rawValue || "").trim();

  type ToNanoFunction = (text: string) => number | null;

  const toNano: ToNanoFunction = (text: string): number | null => {
    const candidate: string = text.trim();

    if (candidate.length === 0) {
      return null;
    }

    const milliseconds: number = Number(candidate);

    return isNaN(milliseconds) ? null : milliseconds * MS_TO_NANO;
  };

  if (trimmed.startsWith(">")) {
    const nano: number | null = toNano(trimmed.substring(1));

    return nano === null ? {} : { minDurationNano: nano };
  }

  if (trimmed.startsWith("<")) {
    const nano: number | null = toNano(trimmed.substring(1));

    return nano === null ? {} : { maxDurationNano: nano };
  }

  const nano: number | null = toNano(trimmed);

  return nano === null ? {} : { exactDurationNano: nano };
};
