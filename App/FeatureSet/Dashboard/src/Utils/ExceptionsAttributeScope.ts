import Dictionary from "Common/Types/Dictionary";
import EqualTo from "Common/Types/BaseDatabase/EqualTo";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import {
  SearchQueryValue,
  compileAttributeChipValues,
} from "Common/Types/Telemetry/TelemetrySearchQuery";

/*
 * Instance scope for the Exceptions list.
 *
 * TelemetryException (the Postgres group row) deliberately has no
 * attributes column — attributes live on the ClickHouse ExceptionInstance
 * rows. An `attributes.<key>` chip therefore compiles as a two-step,
 * client-side cross-store join (the pattern ExceptionsTable already uses
 * for entity scope): (1) one instance query with EVERY filter ANDed + the
 * time window, grouped by fingerprint; (2) the resulting fingerprints
 * narrow the Postgres list and ride the histogram/facets payloads (both
 * already accept `fingerprints`).
 *
 * Column predicates ride along the same join for a different reason: the
 * histogram and facet endpoints take literal lists (`exceptionTypes`,
 * `environments`) and cannot express `@type:Type*` at all. Resolving such a
 * filter to fingerprints is what keeps the chart, the counts and the list
 * showing the same filter instead of three different ones.
 */

export const EXCEPTION_ATTRIBUTE_FACET_PREFIX: string = "attributes.";

/*
 * Sentinel injected when the scope matched no instances — an impossible
 * fingerprint that forces an empty list instead of silently showing the
 * UNFILTERED list.
 */
export const NO_MATCH_FINGERPRINT: string = "__attribute-scope-no-match__";

/*
 * Cap on the fingerprints carried into the Postgres IN() — same bound
 * ExceptionsTable uses for its entity-scope join.
 */
export const MAX_SCOPED_FINGERPRINTS: number = 10_000;

/** attributeKey -> selected values in the search grammar (chip order kept). */
export type ExceptionAttributeSelections = Dictionary<Array<string>>;

/** One predicate, or several that AND together on the same key. */
type ScopePredicate = SearchQueryValue | EqualTo<string>;
type ScopeValue = ScopePredicate | Array<ScopePredicate>;

/**
 * Everything the ClickHouse instance query has to match.
 *
 * The three sources are kept apart because they arrive compiled
 * differently: chips carry the value as the user wrote it (grammar text,
 * compiled here), while search tokens arrive already compiled by the
 * parser.
 */
export interface ExceptionInstanceScope {
  /** attribute key -> chip values, written in the search grammar. */
  attributeSelections: ExceptionAttributeSelections;
  /** attribute key -> predicates compiled from the search string. */
  attributePredicates: Dictionary<Array<SearchQueryValue>>;
  /** ExceptionInstance column -> predicates no other transport can carry. */
  columnPredicates: Dictionary<Array<SearchQueryValue>>;
}

export function isExceptionAttributeFacetKey(facetKey: string): boolean {
  return (
    facetKey.startsWith(EXCEPTION_ATTRIBUTE_FACET_PREFIX) &&
    facetKey.length > EXCEPTION_ATTRIBUTE_FACET_PREFIX.length
  );
}

/**
 * Pull the attribute selections out of grouped facet values. Facet keys
 * carry the `attributes.` prefix (only the FIRST prefix strips — dots in
 * the key survive).
 */
export function getExceptionAttributeSelections(input: {
  facetGroups: Record<string, Array<string>>;
}): ExceptionAttributeSelections {
  const selections: ExceptionAttributeSelections = {};

  const addValues: (attributeKey: string, values: Array<string>) => void = (
    attributeKey: string,
    values: Array<string>,
  ): void => {
    const cleanValues: Array<string> = values.filter(
      (value: string): boolean => {
        return typeof value === "string" && value.trim() !== "";
      },
    );
    if (attributeKey.trim() === "" || cleanValues.length === 0) {
      return;
    }
    if (!selections[attributeKey]) {
      selections[attributeKey] = [];
    }
    for (const value of cleanValues) {
      if (!selections[attributeKey]!.includes(value)) {
        selections[attributeKey]!.push(value);
      }
    }
  };

  for (const facetKey of Object.keys(input.facetGroups)) {
    if (!isExceptionAttributeFacetKey(facetKey)) {
      continue;
    }
    addValues(
      facetKey.slice(EXCEPTION_ATTRIBUTE_FACET_PREFIX.length),
      input.facetGroups[facetKey] || [],
    );
  }

  return selections;
}

export function hasExceptionInstanceScope(
  scope: ExceptionInstanceScope,
): boolean {
  return (
    Object.keys(scope.attributeSelections).length > 0 ||
    Object.keys(scope.attributePredicates).length > 0 ||
    Object.keys(scope.columnPredicates).length > 0
  );
}

function serializePredicates(
  predicates: Dictionary<Array<SearchQueryValue>>,
): Record<string, Array<unknown>> {
  const ordered: Record<string, Array<unknown>> = {};

  for (const key of Object.keys(predicates).sort()) {
    ordered[key] = (predicates[key] || []).map(
      (value: SearchQueryValue): unknown => {
        return typeof value === "string" ? value : value.toJSON();
      },
    );
  }

  return ordered;
}

/**
 * Stable identity of one scope resolution — the effect uses it to pair a
 * resolved fingerprint set with the filters+window that produced it (and to
 * skip stale responses). Operators are compared by their serialized form
 * because two equal filters are different object identities on every render.
 */
export function getExceptionInstanceScopeKey(input: {
  scope: ExceptionInstanceScope;
  windowStartMs: number;
  windowEndMs: number;
}): string {
  const orderedSelections: Record<string, Array<string>> = {};
  for (const key of Object.keys(input.scope.attributeSelections).sort()) {
    orderedSelections[key] = [
      ...(input.scope.attributeSelections[key] || []),
    ].sort();
  }

  return JSON.stringify([
    orderedSelections,
    serializePredicates(input.scope.attributePredicates),
    serializePredicates(input.scope.columnPredicates),
    input.windowStartMs,
    input.windowEndMs,
  ]);
}

/*
 * Several predicates on one key AND together — `@k:a* @k:*b`, or a chip plus
 * a typed filter on the same key. The compiler only reads an array whose
 * every element is a query operator; a bare string among them would bind as
 * `String(array)`, a silent match-nothing. So plain equality joins the array
 * as an explicit EqualTo.
 */
function mergeScopeValues(
  existing: ScopeValue | undefined,
  incoming: Array<ScopePredicate>,
): ScopeValue | undefined {
  const existingValues: Array<ScopePredicate> =
    existing === undefined
      ? []
      : Array.isArray(existing)
        ? existing
        : [existing];

  const combined: Array<ScopePredicate> = [...existingValues, ...incoming];

  if (combined.length === 0) {
    return undefined;
  }

  if (combined.length === 1) {
    return combined[0]!;
  }

  return combined.map((value: ScopePredicate): ScopePredicate => {
    return typeof value === "string" ? new EqualTo<string>(value) : value;
  });
}

/**
 * The single ClickHouse instance query resolving the scope: every filter
 * ANDs on the SAME instance (a chip on `http.method` and one on `host` match
 * instances carrying both), bounded to the viewer's window.
 */
export function buildExceptionInstanceScopeQuery(input: {
  projectId: ObjectID;
  window: InBetween<Date>;
  scope: ExceptionInstanceScope;
}): Query<ExceptionInstance> {
  const attributes: Dictionary<ScopeValue> = {};

  for (const attributeKey of Object.keys(input.scope.attributeSelections)) {
    const compiled: SearchQueryValue | Array<SearchQueryValue> | undefined =
      compileAttributeChipValues(
        input.scope.attributeSelections[attributeKey] || [],
      );

    if (compiled === undefined) {
      continue;
    }

    const merged: ScopeValue | undefined = mergeScopeValues(
      attributes[attributeKey],
      Array.isArray(compiled) ? compiled : [compiled],
    );

    if (merged !== undefined) {
      attributes[attributeKey] = merged;
    }
  }

  for (const attributeKey of Object.keys(input.scope.attributePredicates)) {
    const merged: ScopeValue | undefined = mergeScopeValues(
      attributes[attributeKey],
      input.scope.attributePredicates[attributeKey] || [],
    );

    if (merged !== undefined) {
      attributes[attributeKey] = merged;
    }
  }

  const columns: Dictionary<ScopeValue> = {};

  for (const column of Object.keys(input.scope.columnPredicates)) {
    const merged: ScopeValue | undefined = mergeScopeValues(
      columns[column],
      input.scope.columnPredicates[column] || [],
    );

    if (merged !== undefined) {
      columns[column] = merged;
    }
  }

  return {
    ...columns,
    projectId: input.projectId,
    time: input.window,
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
  } as Query<ExceptionInstance>;
}

/**
 * Narrow the Postgres list query to the resolved fingerprints. An empty
 * resolution injects the no-match sentinel — the scope matched nothing,
 * and the list must say so rather than quietly widening.
 */
export function applyExceptionFingerprintScope(
  query: Query<TelemetryException>,
  fingerprints: Array<string>,
): void {
  const scoped: Array<string> =
    fingerprints.length > 0
      ? fingerprints.slice(0, MAX_SCOPED_FINGERPRINTS)
      : [NO_MATCH_FINGERPRINT];
  (query as Record<string, unknown>)["fingerprint"] = new Includes(scoped);
}
