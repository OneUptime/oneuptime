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
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Search from "Common/Types/BaseDatabase/Search";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import {
  EXCLUDED_RESOURCE_FILTERS_FIELD,
  ResourceEntityFacetSelections,
  collectResourceEntityFacetSelections,
  collectServiceFacetSelections,
  isServiceFacetKey,
} from "Common/Types/Telemetry/ResourceEntityFacet";
import {
  getBaseFacetKey,
  isExcludeFacetKey,
} from "Common/Types/Telemetry/FacetExcludeKey";
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
  /*
   * `!attributes.<key>` chip values - what the reader left out ("Host Name
   * is not web-01") - grouped by key. Grammar tokens, as the kept ones are.
   */
  excludedChipValues?: Record<string, Array<string>> | undefined;
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
 * user can see applied. Precedence, weakest first: chips (the values left
 * out after the kept ones), then the submitted search string, then the
 * legacy contains chips, then the host page's read-only scope.
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

    /*
     * The values left out. An attribute the chips keep values of is
     * already exact - a span holds one value per attribute - so its
     * left-out values change nothing and are dropped, in both transports.
     */
    for (const [key, values] of Object.entries(
      sources.excludedChipValues || {},
    )) {
      if (queryAttributes[key] !== undefined) {
        continue;
      }

      const compiled: SearchQueryValue | Array<SearchQueryValue> | undefined =
        compileExcludedAttributeChipValues(values);

      if (compiled === undefined) {
        continue;
      }

      queryAttributes[key] = compiled;

      /*
       * Several patterns left out AND together, which the list evaluates
       * one by one and the aggregate endpoints cannot hold: the chart then
       * counts more than the list, never fewer.
       */
      if (!Array.isArray(compiled)) {
        payloadAttributes[key] = serializeQueryValue(compiled);
      }
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

/*
 * An attribute chip's values left out, read as the grammar reads them: the
 * literals a facet row or a span panel writes are one NOT IN (a single one
 * a plain `!=`), and a token that is a pattern is negated as the grammar
 * negates it - the negations AND-ed.
 */
const compileExcludedAttributeChipValues: (
  values: Array<string>,
) => SearchQueryValue | Array<SearchQueryValue> | undefined = (
  values: Array<string>,
): SearchQueryValue | Array<SearchQueryValue> | undefined => {
  const meaningful: Array<string> = values.filter((value: string): boolean => {
    return typeof value === "string" && value.length > 0;
  });

  if (meaningful.length === 0) {
    return undefined;
  }

  const predicates: Array<SearchValuePredicate> = meaningful.map(
    (value: string): SearchValuePredicate => {
      return parseSearchValue(value);
    },
  );

  const isEveryLiteral: boolean = predicates.every(
    (predicate: SearchValuePredicate): boolean => {
      return predicate.operator === SearchValueOperator.Equals;
    },
  );

  if (isEveryLiteral) {
    return toExcludedValue(
      predicates.map((predicate: SearchValuePredicate): string => {
        return predicate.value;
      }),
    );
  }

  const negated: Array<SearchQueryValue> = meaningful.map(
    (value: string): SearchQueryValue => {
      return predicateToQueryValue(parseSearchValue(value, true));
    },
  );

  return negated.length === 1 ? negated[0]! : negated;
};

/*
 * One value left out is a plain `!=` (the column's skip index stays usable),
 * several are one NOT IN.
 */
const toExcludedValue: <T extends string | number>(
  values: Array<T>,
) => NotEqual<T> | IncludesNone = <T extends string | number>(
  values: Array<T>,
): NotEqual<T> | IncludesNone => {
  const unique: Array<T> = Array.from(new Set<T>(values));

  return unique.length === 1
    ? new NotEqual<T>(unique[0]!)
    : new IncludesNone(unique as Array<string> | Array<number>);
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

// The key the facets endpoint counts the Service facet under.
const SERVICE_FACET_COUNT_KEY: string = "primaryEntityId";

/*
 * Facets with one value to choose ("Has exception"): counted the same with
 * or without their own selection, so never asked for on their own.
 */
const SINGLE_CHOICE_FACET_KEYS: ReadonlySet<string> = new Set<string>([
  "hasException",
]);

/*
 * The facet a traces explorer chip filters on, by the key the facets
 * endpoint counts it under: a Service chip (primaryEntityId, or its old name
 * serviceId) the Service facet's, an `attributes.<key>` chip the attribute
 * facet's (Host Name, Service Instance) when the sidebar lists one, and any
 * other chip its own column's - which no facet may list (a trace id, a
 * duration). Null for an attribute no facet lists.
 */
export const getTraceChipFacetKey: (
  chipKey: string,
  attributeFacetKeys: ReadonlySet<string>,
) => string | null = (
  rawChipKey: string,
  attributeFacetKeys: ReadonlySet<string>,
): string | null => {
  // A chip that leaves its value out (`!statusCode`) filters its facet too.
  const chipKey: string = getBaseFacetKey(rawChipKey);

  if (chipKey.startsWith(ATTRIBUTE_CHIP_PREFIX)) {
    const attributeKey: string = chipKey.substring(
      ATTRIBUTE_CHIP_PREFIX.length,
    );

    return attributeFacetKeys.has(attributeKey) ? attributeKey : null;
  }

  if (chipKey.startsWith(ATTRIBUTE_SEARCH_CHIP_PREFIX)) {
    return null;
  }

  return isServiceFacetKey(chipKey) ? SERVICE_FACET_COUNT_KEY : chipKey;
};

/*
 * The facets the reader chose a value in: each is counted without its own
 * selection (FacetCountPlan), so the statuses, kinds or services beside a
 * checked one stay listed with their counts and a second can be checked.
 * The page's own (read-only) chips are not a choice.
 */
export const getTraceChosenFacetKeys: (
  filters: ReadonlyArray<{ facetKey: string; readOnly?: boolean | undefined }>,
  attributeFacetKeys: ReadonlySet<string>,
) => Array<string> = (
  filters: ReadonlyArray<{ facetKey: string; readOnly?: boolean | undefined }>,
  attributeFacetKeys: ReadonlySet<string>,
): Array<string> => {
  const keys: Set<string> = new Set<string>();

  for (const filter of filters) {
    if (filter.readOnly) {
      continue;
    }

    const facetKey: string | null = getTraceChipFacetKey(
      filter.facetKey,
      attributeFacetKeys,
    );

    if (facetKey && !SINGLE_CHOICE_FACET_KEYS.has(facetKey)) {
      keys.add(facetKey);
    }
  }

  return Array.from(keys);
};

/*
 * THE VALUES A READER LEFT OUT.
 *
 * A facet row's minus leaves its value out: a chip keyed `!<facet>`
 * (FacetExcludeKey) - `!statusCode: 2`, `!primaryEntityId: <id>`,
 * `!attributes.resource.host.name: web-01`. They are read apart from the
 * chips that keep values, and compiled into both transports from that one
 * reading (applyTraceExclusionsToQuery, applyTraceExclusionsToPayload), so
 * the list, the chart and the facet counts agree on every one.
 */
export interface TraceExclusions {
  // Column values left out, by column, as the facet answers them.
  columns: Record<string, Array<string>>;
  // Attribute values left out, by attribute key. Grammar tokens.
  attributeChipValues: Record<string, Array<string>>;
}

export const readTraceExclusions: (data: {
  chips: ReadonlyArray<{ facetKey: string; value: string }>;
  attributeFacetKeys: ReadonlySet<string>;
  // A facet counted without its own selection leaves its chips out too.
  omitFacetKey?: string | null | undefined;
}) => TraceExclusions = (data: {
  chips: ReadonlyArray<{ facetKey: string; value: string }>;
  attributeFacetKeys: ReadonlySet<string>;
  omitFacetKey?: string | null | undefined;
}): TraceExclusions => {
  const exclusions: TraceExclusions = {
    columns: {},
    attributeChipValues: {},
  };

  const add: (
    groups: Record<string, Array<string>>,
    key: string,
    value: string,
  ) => void = (
    groups: Record<string, Array<string>>,
    key: string,
    value: string,
  ): void => {
    const values: Array<string> = groups[key] || [];

    if (!values.includes(value)) {
      values.push(value);
    }

    groups[key] = values;
  };

  for (const chip of data.chips) {
    if (
      !isExcludeFacetKey(chip.facetKey) ||
      typeof chip.value !== "string" ||
      chip.value.length === 0
    ) {
      continue;
    }

    if (
      data.omitFacetKey &&
      getTraceChipFacetKey(chip.facetKey, data.attributeFacetKeys) ===
        data.omitFacetKey
    ) {
      continue;
    }

    const baseKey: string = getBaseFacetKey(chip.facetKey);

    // The pre-grammar contains chips have nothing to leave out.
    if (!baseKey || baseKey.startsWith(ATTRIBUTE_SEARCH_CHIP_PREFIX)) {
      continue;
    }

    if (baseKey.startsWith(ATTRIBUTE_CHIP_PREFIX)) {
      const attributeKey: string = baseKey.substring(
        ATTRIBUTE_CHIP_PREFIX.length,
      );

      if (attributeKey.length > 0) {
        add(exclusions.attributeChipValues, attributeKey, chip.value);
      }
      continue;
    }

    add(exclusions.columns, baseKey, chip.value);
  }

  return exclusions;
};

// Whether a reading holds anything to leave out.
export const hasTraceExclusions: (exclusions: TraceExclusions) => boolean = (
  exclusions: TraceExclusions,
): boolean => {
  return (
    Object.keys(exclusions.columns).length > 0 ||
    Object.keys(exclusions.attributeChipValues).length > 0
  );
};

// Columns compiled through a value mapping, or as a resource, not as written.
const MAPPED_EXCLUSION_COLUMNS: ReadonlySet<string> = new Set<string>([
  "statusCode",
  "kind",
  "hasException",
  "name",
]);

/*
 * The values left out, onto the span list's query - after everything that
 * keeps rows (the page's scope, the chips, the typed search) is on it:
 *
 *   Service       primaryEntityId != <id> / NOT IN
 *   Host, ...     excludedResourceFilters (the server negates the group)
 *   Status        statusCode != 2 / NOT IN
 *   Span Kind     kind != 'SPAN_KIND_CLIENT' / NOT IN
 *   Has exception hasException = the other answer
 *   Span Name     name != 'GET /health' / NOT IN - exactly the value shown
 *
 * A column that already keeps values exactly holds one value per span, so
 * the values left out of it change nothing and are dropped - the query
 * holds one predicate per column. A span name kept as a SUBSTRING is the
 * one column where both mean something ("GET, but not GET /health"), so it
 * holds both, AND-ed. Attributes are compiled with the other attribute
 * filters (compileTraceAttributeFilters).
 */
export const applyTraceExclusionsToQuery: (
  query: Record<string, unknown>,
  exclusions: TraceExclusions,
) => void = (
  query: Record<string, unknown>,
  exclusions: TraceExclusions,
): void => {
  const columnEntries: Array<[string, Array<string>]> = Object.entries(
    exclusions.columns,
  );

  const serviceIds: Array<string> =
    collectServiceFacetSelections(columnEntries);

  if (serviceIds.length > 0 && query["primaryEntityId"] === undefined) {
    query["primaryEntityId"] = toExcludedValue(serviceIds);
  }

  const resourceFilters: ResourceEntityFacetSelections =
    collectResourceEntityFacetSelections(columnEntries);

  if (Object.keys(resourceFilters).length > 0) {
    query[EXCLUDED_RESOURCE_FILTERS_FIELD] = resourceFilters;
  }

  const statusCodes: Array<number> = getExcludedStatusCodes(exclusions);

  if (statusCodes.length > 0 && query["statusCode"] === undefined) {
    query["statusCode"] = toExcludedValue(statusCodes);
  }

  const spanKinds: Array<string> = getExcludedSpanKinds(exclusions);

  if (spanKinds.length > 0 && query["kind"] === undefined) {
    query["kind"] = toExcludedValue(spanKinds);
  }

  const hasException: boolean | undefined = getHasExceptionLeftOver(exclusions);

  if (hasException !== undefined && query["hasException"] === undefined) {
    query["hasException"] = hasException;
  }

  const spanNames: Array<string> = exclusions.columns["name"] || [];

  if (spanNames.length > 0) {
    const kept: unknown = query["name"];

    if (kept === undefined) {
      query["name"] = toExcludedValue(spanNames);
    } else if (kept instanceof Search) {
      query["name"] = [kept, toExcludedValue(spanNames)];
    }
  }

  // Any other column (a hand-written link's): as written, if nothing keeps it.
  for (const [column, values] of columnEntries) {
    if (
      MAPPED_EXCLUSION_COLUMNS.has(column) ||
      isServiceFacetKey(column) ||
      Object.prototype.hasOwnProperty.call(resourceFilters, column) ||
      values.length === 0 ||
      query[column] !== undefined
    ) {
      continue;
    }

    query[column] = toExcludedValue(values);
  }
};

/*
 * The same values left out, onto a histogram / facets / analytics request
 * built from the same view - by the same rules, read off what the request
 * already keeps, so the chart and the counts drop exactly the rows the list
 * drops. Only the columns the endpoints have a field for: the sidebar's
 * facets all do.
 */
export const applyTraceExclusionsToPayload: (
  payload: JSONObject,
  exclusions: TraceExclusions,
) => void = (payload: JSONObject, exclusions: TraceExclusions): void => {
  const columnEntries: Array<[string, Array<string>]> = Object.entries(
    exclusions.columns,
  );

  const serviceIds: Array<string> =
    collectServiceFacetSelections(columnEntries);

  if (serviceIds.length > 0 && !hasListValue(payload["serviceIds"])) {
    payload["excludedServiceIds"] = serviceIds;
  }

  const resourceFilters: ResourceEntityFacetSelections =
    collectResourceEntityFacetSelections(columnEntries);

  if (Object.keys(resourceFilters).length > 0) {
    payload[EXCLUDED_RESOURCE_FILTERS_FIELD] = resourceFilters;
  }

  const statusCodes: Array<number> = getExcludedStatusCodes(exclusions);

  if (statusCodes.length > 0 && !hasListValue(payload["statusCodes"])) {
    payload["excludedStatusCodes"] = statusCodes;
  }

  const spanKinds: Array<string> = getExcludedSpanKinds(exclusions);

  if (spanKinds.length > 0 && !hasListValue(payload["spanKinds"])) {
    payload["excludedSpanKinds"] = spanKinds;
  }

  const hasException: boolean | undefined = getHasExceptionLeftOver(exclusions);

  if (hasException !== undefined && payload["hasException"] === undefined) {
    payload["hasException"] = hasException;
  }

  const spanNames: Array<string> = Array.from(
    new Set<string>(exclusions.columns["name"] || []),
  );

  // Names kept exactly already leave every other name out.
  if (spanNames.length > 0 && !hasListValue(payload["spanNames"])) {
    payload["excludedSpanNames"] = spanNames;
  }
};

const hasListValue: (value: unknown) => boolean = (value: unknown): boolean => {
  return Array.isArray(value) && value.length > 0;
};

// The statuses left out, as the column stores them.
const getExcludedStatusCodes: (exclusions: TraceExclusions) => Array<number> = (
  exclusions: TraceExclusions,
): Array<number> => {
  return Array.from(
    new Set<number>(
      (exclusions.columns["statusCode"] || []).map((value: string): number => {
        return toSpanStatusCode(value);
      }),
    ),
  );
};

// The kinds left out, as the column stores them.
const getExcludedSpanKinds: (exclusions: TraceExclusions) => Array<string> = (
  exclusions: TraceExclusions,
): Array<string> => {
  return Array.from(
    new Set<string>(
      (exclusions.columns["kind"] || []).map((value: string): string => {
        return toSpanKind(value);
      }),
    ),
  );
};

/*
 * "Has exception" left out is the spans without one, and the other way
 * round. Both answers left out leave nothing to say: no filter, rather than
 * a list of nothing.
 */
const getHasExceptionLeftOver: (
  exclusions: TraceExclusions,
) => boolean | undefined = (
  exclusions: TraceExclusions,
): boolean | undefined => {
  const leftOut: Set<boolean> = new Set<boolean>(
    (exclusions.columns["hasException"] || []).map((value: string): boolean => {
      return value.trim().toLowerCase() === "true" || value.trim() === "1";
    }),
  );

  if (leftOut.size !== 1) {
    return undefined;
  }

  return !Array.from(leftOut)[0]!;
};

/*
 * Whether a typed `field:value` token filters on the facet being counted
 * without its own selection: `service:` is the Service facet's.
 */
export const isTraceFieldOfFacet: (
  fieldKey: string,
  facetKey: string,
) => boolean = (fieldKey: string, facetKey: string): boolean => {
  if (facetKey === SERVICE_FACET_COUNT_KEY) {
    return isServiceFacetKey(fieldKey);
  }

  return fieldKey === facetKey;
};
