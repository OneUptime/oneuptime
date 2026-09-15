import { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
import {
  TelemetrySignal,
  buildSearchTokenForFilter,
  buildSearchTokenForOperatorValue,
  isSearchTokenSafeKey,
} from "Common/Utils/Telemetry/LockedFilterSearch";
import { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";

/*
 * The search syntax behind the locked chips of an embedded telemetry
 * explorer.
 *
 * A resource page (a Kubernetes cluster, a Docker host, a RUM application,
 * an incident's stored query, ...) pins the Logs / Traces / Metrics viewer it
 * embeds to its own slice of telemetry, and the viewer shows that slice as
 * grey chips with a lock icon. A reader who wants the same slice on the main
 * explorer page needs the search-bar text that reproduces each chip. The
 * describers here decide, per chip, that search token — or, when the
 * explorer's grammar cannot spell the filter, which reason the tooltip shows
 * instead. The shared chip component renders the resulting LockedFilterDetail.
 *
 * This module is deliberately PURE: no route map, no navigation, nothing
 * that touches the browser at load. The chip builders of all three viewers
 * (renderer-free modules with plain-node tests) import the describers.
 */

export const ATTRIBUTE_FACET_PREFIX: string = "attributes.";

/*
 * Why a chip has no search syntax, worded once so every viewer's tooltip
 * says the same thing.
 */
const OPERATOR_FILTER_NO_SYNTAX_REASON: string =
  "This operator filter cannot be spelled in the search bar.";
const UNSAFE_KEY_NO_SYNTAX_REASON: string =
  "This attribute key cannot be typed into the search bar.";
const EMPTY_VALUE_NO_SYNTAX_REASON: string =
  "This filter has no value to copy.";
export const NO_SEARCH_SYNTAX_REASON: string =
  "This filter has no search syntax.";
export const SESSION_NO_SYNTAX_REASON: string =
  "Session filters have no search syntax.";
export const METRICS_SERVICE_NO_SYNTAX_REASON: string =
  "The Metrics search bar matches services by name, not by id.";

type IsScalarFunction = (value: unknown) => value is string | number | boolean;

const isScalar: IsScalarFunction = (
  value: unknown,
): value is string | number | boolean => {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
};

type TokenOrReasonFunction = (
  searchToken: string | null,
  reason: string,
) => LockedFilterDetail;

/*
 * The detail for a token the grammar may or may not have produced. Exactly
 * one of the two fields is set, and an empty token counts as none — a Copy
 * button with nothing to copy is worse than the reason.
 */
const tokenOrReason: TokenOrReasonFunction = (
  searchToken: string | null,
  reason: string,
): LockedFilterDetail => {
  if (searchToken) {
    return { searchToken };
  }

  return { searchTokenUnavailableReason: reason };
};

export interface DescribeLockedAttributeFilterInput {
  signal: TelemetrySignal;
  /** The attribute key without the `attributes.` chip prefix. */
  attributeKey: string;
  /*
   * The value as the host page pinned it: a scalar for the implicit `=`,
   * an operator instance (`Includes`, `Search`, ...) for anything else.
   */
  rawValue: DictionaryEntryValue | undefined;
}

type DescribeLockedAttributeFilterFunction = (
  input: DescribeLockedAttributeFilterInput,
) => LockedFilterDetail;

/**
 * The search syntax of a chip pinned through `logQuery.attributes` /
 * `attributeFilters`: an `@key:value` token for a scalar, the operator's own
 * token for an operator the grammar can spell. A key the search bar cannot
 * type, an operator it cannot spell, or an empty value gets the matching
 * reason instead.
 */
export const describeLockedAttributeFilter: DescribeLockedAttributeFilterFunction =
  (input: DescribeLockedAttributeFilterInput): LockedFilterDetail => {
    if (!isSearchTokenSafeKey(input.attributeKey)) {
      return { searchTokenUnavailableReason: UNSAFE_KEY_NO_SYNTAX_REASON };
    }

    if (!isScalar(input.rawValue)) {
      return tokenOrReason(
        buildSearchTokenForOperatorValue(input.attributeKey, input.rawValue),
        OPERATOR_FILTER_NO_SYNTAX_REASON,
      );
    }

    return tokenOrReason(
      buildSearchTokenForFilter(
        input.signal,
        `${ATTRIBUTE_FACET_PREFIX}${input.attributeKey}`,
        String(input.rawValue),
      ),
      EMPTY_VALUE_NO_SYNTAX_REASON,
    );
  };

export interface DescribeLockedEntityFilterInput {
  signal: TelemetrySignal;
  id: string;
}

type DescribeLockedEntityFilterFunction = (
  input: DescribeLockedEntityFilterInput,
) => LockedFilterDetail;

/**
 * The search syntax of a `primaryEntityId` chip — a Service or RUM
 * application page's scope. Logs and traces accept the id verbatim after
 * `service:`; the Metrics search bar matches services by NAME, so an id has
 * no spelling there and the chip says why.
 */
export const describeLockedEntityFilter: DescribeLockedEntityFilterFunction = (
  input: DescribeLockedEntityFilterInput,
): LockedFilterDetail => {
  return tokenOrReason(
    buildSearchTokenForFilter(input.signal, "primaryEntityId", input.id),
    input.signal === "metrics"
      ? METRICS_SERVICE_NO_SYNTAX_REASON
      : EMPTY_VALUE_NO_SYNTAX_REASON,
  );
};

type DescribeLockedColumnFilterFunction = (input: {
  signal: TelemetrySignal;
  facetKey: string;
  value: string;
}) => LockedFilterDetail;

/*
 * A chip on one plain column: the signal grammar's token for that column and
 * value, or the generic reason when the grammar has none. Trace, span and
 * stored-query chips are all this shape — a trace or span id is spelled
 * `trace:` / `span:` on logs and traces, and metrics have neither column, so
 * a metrics viewer never shows those chips in the first place.
 */
const describeLockedColumnFilter: DescribeLockedColumnFilterFunction = (input: {
  signal: TelemetrySignal;
  facetKey: string;
  value: string;
}): LockedFilterDetail => {
  return tokenOrReason(
    buildSearchTokenForFilter(input.signal, input.facetKey, input.value),
    NO_SEARCH_SYNTAX_REASON,
  );
};

export interface DescribeLockedTraceFilterInput {
  signal: TelemetrySignal;
  traceId: string;
}

type DescribeLockedTraceFilterFunction = (
  input: DescribeLockedTraceFilterInput,
) => LockedFilterDetail;

/** The `trace:<id>` token of a trace chip, where the signal has one. */
export const describeLockedTraceFilter: DescribeLockedTraceFilterFunction = (
  input: DescribeLockedTraceFilterInput,
): LockedFilterDetail => {
  return describeLockedColumnFilter({
    signal: input.signal,
    facetKey: "traceId",
    value: input.traceId,
  });
};

export interface DescribeLockedSpanFilterInput {
  signal: TelemetrySignal;
  spanId: string;
}

type DescribeLockedSpanFilterFunction = (
  input: DescribeLockedSpanFilterInput,
) => LockedFilterDetail;

/** The `span:<id>` token of a span chip, where the signal has one. */
export const describeLockedSpanFilter: DescribeLockedSpanFilterFunction = (
  input: DescribeLockedSpanFilterInput,
): LockedFilterDetail => {
  return describeLockedColumnFilter({
    signal: input.signal,
    facetKey: "spanId",
    value: input.spanId,
  });
};

export interface DescribeLockedSessionFilterInput {
  signal: TelemetrySignal;
}

type DescribeLockedSessionFilterFunction = (
  input: DescribeLockedSessionFilterInput,
) => LockedFilterDetail;

/**
 * A RUM session chip never has a token: no explorer has a `session:` token,
 * and metrics have no session dimension at all. Only the reason depends on
 * the signal.
 */
export const describeLockedSessionFilter: DescribeLockedSessionFilterFunction =
  (input: DescribeLockedSessionFilterInput): LockedFilterDetail => {
    return {
      searchTokenUnavailableReason:
        input.signal === "metrics"
          ? "Sessions are not a metrics dimension."
          : SESSION_NO_SYNTAX_REASON,
    };
  };

export interface DescribeLockedStoredQueryFilterInput {
  signal: TelemetrySignal;
  facetKey: string;
  value: string;
}

type DescribeLockedStoredQueryFilterFunction = (
  input: DescribeLockedStoredQueryFilterInput,
) => LockedFilterDetail;

/**
 * The search syntax of a chip the traces viewer derived from a host's stored
 * `spanQuery` (an incident, alert or monitor snapshot): the token for its
 * column and value when the signal's grammar has one, the generic reason
 * otherwise.
 */
export const describeLockedStoredQueryFilter: DescribeLockedStoredQueryFilterFunction =
  (input: DescribeLockedStoredQueryFilterInput): LockedFilterDetail => {
    return describeLockedColumnFilter({
      signal: input.signal,
      facetKey: input.facetKey,
      value: input.value,
    });
  };

/*
 * The column an entity-key scope filters: the `entityKeys` membership array
 * every telemetry row is stamped with at ingest, one key per entity its
 * resource describes. An Inventory item's pages scope every signal by it.
 */
export const ENTITY_KEYS_FACET_KEY: string = "entityKeys";

/*
 * The key an entity-key chip reads when its page did not name the entity —
 * the same word a stored query's entity-key chip is seeded with
 * (SpanQueryScope), so the two never disagree on screen.
 */
export const DEFAULT_ENTITY_KEY_DISPLAY_KEY: string = "Resource";

/*
 * What an entity-key scope narrows: the rows of one of the three explorers,
 * or of the exceptions and profiles lists, which scope the same way but have
 * no search bar to paste a filter into.
 */
export type EntityKeyScopedRows = TelemetrySignal | "exceptions" | "profiles";

export const ENTITY_KEY_NO_SYNTAX_REASON: string =
  "Entity keys have no search syntax.";
export const ENTITY_KEY_NO_ATTRIBUTES_REASON: string =
  "This resource has no telemetry attributes to search by.";

/*
 * Resource attributes land in every signal's `attributes` map under this
 * prefix at ingest, which is how the explorers' `@key:value` tokens reach
 * them.
 */
export const RESOURCE_ATTRIBUTE_PREFIX: string = "resource.";

type BuildEntitySearchTokenFunction = (
  signal: TelemetrySignal,
  searchAttributes: Readonly<Record<string, string>> | undefined,
) => string | null;

/**
 * The search syntax for one entity, spelled with the OpenTelemetry resource
 * attributes that identify it — `@resource.k8s.cluster.name:prod
 * @resource.k8s.namespace.name:shop @resource.k8s.pod.name:checkout-7d9f` for
 * a pod — rather than with its entity key, which no search bar understands.
 * One token per attribute, in key order, AND-ed by the search bar the way the
 * attributes jointly identify the entity.
 *
 * Null when there is nothing to spell, or when ANY attribute cannot be
 * spelled (an unsafe key, an empty value): dropping it would widen the
 * search past the entity rather than reproduce it.
 */
export const buildEntitySearchToken: BuildEntitySearchTokenFunction = (
  signal: TelemetrySignal,
  searchAttributes: Readonly<Record<string, string>> | undefined,
): string | null => {
  if (
    !searchAttributes ||
    typeof searchAttributes !== "object" ||
    Array.isArray(searchAttributes)
  ) {
    return null;
  }

  const attributeKeys: Array<string> = Object.keys(searchAttributes).sort();

  if (attributeKeys.length === 0) {
    return null;
  }

  const tokens: Array<string> = [];

  for (const attributeKey of attributeKeys) {
    const rawValue: unknown = searchAttributes[attributeKey];
    const value: string = typeof rawValue === "string" ? rawValue.trim() : "";

    const token: string | null = buildSearchTokenForFilter(
      signal,
      `${ATTRIBUTE_FACET_PREFIX}${RESOURCE_ATTRIBUTE_PREFIX}${attributeKey.trim()}`,
      value,
    );

    if (!token) {
      return null;
    }

    tokens.push(token);
  }

  return tokens.join(" ");
};

type IsTelemetrySignalFunction = (
  rows: EntityKeyScopedRows,
) => rows is TelemetrySignal;

const isTelemetrySignal: IsTelemetrySignalFunction = (
  rows: EntityKeyScopedRows,
): rows is TelemetrySignal => {
  return rows === "logs" || rows === "traces" || rows === "metrics";
};

export interface DescribeLockedEntityKeyFilterInput {
  rows: EntityKeyScopedRows;
  /*
   * The resource attributes that identify THIS entity (keys without the
   * `resource.` prefix), when the page knows them — an Inventory item does.
   * They are what the chip's search syntax is spelled with; without them an
   * entity key has no syntax at all.
   */
  searchAttributes?: Readonly<Record<string, string>> | undefined;
}

type DescribeLockedEntityKeyFilterFunction = (
  input: DescribeLockedEntityKeyFilterInput,
) => LockedFilterDetail;

/**
 * The search syntax of an `entityKeys` chip — an Inventory item's scope. No
 * explorer's search grammar has a token for the column, so the syntax is
 * spelled with the entity's identifying resource attributes when the page
 * hands them over (buildEntitySearchToken). The exceptions and profiles
 * lists have no search bar at all, and an entity whose attributes are
 * missing or cannot be spelled has no syntax; each gets its own reason.
 */
export const describeLockedEntityKeyFilter: DescribeLockedEntityKeyFilterFunction =
  (input: DescribeLockedEntityKeyFilterInput): LockedFilterDetail => {
    if (!isTelemetrySignal(input.rows)) {
      // The exceptions and profiles lists have no search bar to paste into.
      return { searchTokenUnavailableReason: ENTITY_KEY_NO_SYNTAX_REASON };
    }

    return tokenOrReason(
      buildEntitySearchToken(input.rows, input.searchAttributes),
      ENTITY_KEY_NO_ATTRIBUTES_REASON,
    );
  };
