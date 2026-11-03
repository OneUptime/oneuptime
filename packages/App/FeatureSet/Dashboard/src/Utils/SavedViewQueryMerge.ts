import { JSONObject } from "Common/Types/JSON";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotContains from "Common/Types/BaseDatabase/NotContains";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import { toExcludeFacetKey } from "Common/Types/Telemetry/FacetExcludeKey";
import { BODY_FACET_KEY } from "./LogsCrossSignalPivot";
import { EXCLUDED_RESOURCE_FILTERS_FIELD } from "Common/Types/Telemetry/ResourceEntityFacet";
import { ATTRIBUTE_FACET_PREFIX } from "../Components/Logs/LogsHistogramRequest";

/*
 * Preparing a saved log view's query to have a DIFFERENT chip set compiled
 * onto it.
 *
 * This exists because of an asymmetry that is easy to miss and expensive to
 * get wrong. applyLogsFacetFiltersToQuery only ever WRITES the keys a chip
 * selection holds — it has no way to know that a chip the saved view carried
 * was removed somewhere else — and for attributes it merges into the
 * existing object rather than replacing it. So handing it a saved view's
 * query plus a narrower chip set produces a query that is WIDER than the
 * chips claim, with no chip, no URL param and no histogram request carrying
 * the difference. The list would silently stay filtered by a predicate the
 * user had removed, the chart over the same window would count rows the list
 * excluded, and updating the view would re-persist the removed filter.
 *
 * That happens on the Viewer -> Insights -> Viewer trip, on a refresh, and on
 * back-from-detail: any remount whose URL carries both `savedView` and
 * `filters`.
 *
 * The answer is to strip every chip-able key off the saved query first, so
 * the incoming chip set is the whole truth, and to keep the strip list and
 * the read-back list in one place so a future chip group cannot be added to
 * one without the other.
 *
 * Pure and React-free so App/Tests can pin the round trip directly.
 */

/**
 * The facet keys that live in a column of their own and round-trip as chips.
 *
 * Must stay the mirror of what buildFacetFiltersFromQuery reads back and what
 * applyLogsFacetFiltersToQuery compiles in. Attributes and resource facets
 * are chip groups too, but they live under `attributes` and `resourceFilters`
 * rather than in a column each, so they are handled separately below.
 */
export const LOGS_CHIP_FACET_KEYS: ReadonlyArray<string> = [
  "severityText",
  "primaryEntityId",
  "traceId",
  "spanId",
  BODY_FACET_KEY,
];

/** The query key the host page's own scope and the saved view both use. */
const RESOURCE_FILTERS_KEY: string = "resourceFilters";
const ATTRIBUTES_KEY: string = "attributes";

export interface SavedViewQueryForOverridesInput {
  /** The saved view's stored query, already deserialized. */
  savedQuery: JSONObject;
  /**
   * The scope the embedding page imposes. Anything it pins is the page's,
   * not the view's, and survives — the user cannot remove it from a chip row
   * that never offered it.
   */
  baseQuery: JSONObject;
}

/**
 * A saved view's query with every user-removable chip predicate stripped,
 * ready for a fresh chip set to be compiled onto it.
 *
 * Everything the chips cannot express — a `time` window, an `entityScope`,
 * a session id — is left exactly as the view stored it.
 *
 * Never mutates either input. `savedQuery` is the object held inside the
 * loaded saved-views state, so deleting keys off it (or off its nested
 * `attributes`) would corrupt that view for the rest of the session.
 */
export function buildSavedViewQueryForOverrides(
  input: SavedViewQueryForOverridesInput,
): JSONObject {
  const savedQuery: JSONObject = input.savedQuery || {};
  const baseQuery: JSONObject = input.baseQuery || {};

  const merged: JSONObject = { ...savedQuery, ...baseQuery };

  for (const facetKey of LOGS_CHIP_FACET_KEYS) {
    if (baseQuery[facetKey] === undefined) {
      delete merged[facetKey];
    }
  }

  if (baseQuery[RESOURCE_FILTERS_KEY] === undefined) {
    delete merged[RESOURCE_FILTERS_KEY];
  }

  // The resources a view leaves out are chips too (`!hostId`).
  if (baseQuery[EXCLUDED_RESOURCE_FILTERS_FIELD] === undefined) {
    delete merged[EXCLUDED_RESOURCE_FILTERS_FIELD];
  }

  /*
   * Attributes are a chip group too (`attributes.<key>`), so the same rule
   * applies — but they share one object, so the host's entries have to be
   * kept while the view's are dropped. Rebuilt into a FRESH object rather
   * than edited in place: `merged` is a shallow spread, so its `attributes`
   * is the very object inside the cached saved view.
   */
  const mergedAttributes: Record<string, unknown> =
    (merged[ATTRIBUTES_KEY] as Record<string, unknown> | undefined) || {};
  const baseAttributes: Record<string, unknown> =
    (baseQuery[ATTRIBUTES_KEY] as Record<string, unknown> | undefined) || {};

  const keptAttributes: Record<string, unknown> = {};

  for (const attributeKey of Object.keys(mergedAttributes)) {
    if (baseAttributes[attributeKey] !== undefined) {
      keptAttributes[attributeKey] = baseAttributes[attributeKey];
    }
  }

  if (Object.keys(keptAttributes).length > 0) {
    merged[ATTRIBUTES_KEY] = keptAttributes as unknown as JSONObject[string];
  } else {
    delete merged[ATTRIBUTES_KEY];
  }

  return merged;
}

// An `attributes` object, as a query holds one.
const isAttributeMap: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

/**
 * A saved view's query under the page it is applied on, when no chip set
 * comes with it: everything the view stored, with the page's own scope over
 * it, so the view can never show more than the page is about.
 *
 * The page wins key by key, except inside `attributes`, the one object both
 * of them write into. A page that pins attributes - a Kubernetes cluster's
 * Logs tab pins `resource.k8s.cluster.name`, a host's `resource.host.name` -
 * used to replace the view's whole object with its own, so a view saved on
 * that page with an attribute chip (`resource.k8s.namespace.name: payments`)
 * came back without it: the chip gone from the row and its filter gone from
 * the list. Now that a view is listed only on the page it was saved on
 * (issue #5549), those are exactly the pages views are saved on, so the two
 * objects are merged instead, the page's own entries winning.
 *
 * Never mutates either input: `savedQuery` is the object held in the loaded
 * saved views, and `baseQuery`'s attributes are the page's own.
 */
export function buildSavedViewQueryOverBase(
  input: SavedViewQueryForOverridesInput,
): JSONObject {
  const savedQuery: JSONObject = input.savedQuery || {};
  const baseQuery: JSONObject = input.baseQuery || {};

  const merged: JSONObject = { ...savedQuery, ...baseQuery };

  const savedAttributes: unknown = savedQuery[ATTRIBUTES_KEY];
  const baseAttributes: unknown = baseQuery[ATTRIBUTES_KEY];

  if (isAttributeMap(savedAttributes) && isAttributeMap(baseAttributes)) {
    merged[ATTRIBUTES_KEY] = {
      ...savedAttributes,
      ...baseAttributes,
    } as unknown as JSONObject[string];
  }

  return merged;
}

// Whether a stored column predicate leaves values out (a `!` chip's form).
const isLeftOutQueryValue: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return (
    value instanceof NotEqual ||
    value instanceof IncludesNone ||
    value instanceof NotContains
  );
};

/**
 * The chip keys a query carries that a user could remove — the set
 * buildSavedViewQueryForOverrides is responsible for clearing.
 *
 * Exported for the round-trip test, which asserts that compiling a chip set
 * onto a stripped query and reading it back yields exactly that chip set. If
 * a new chip group is added to the read-back without being added here, that
 * test fails rather than a user silently getting a filter they removed.
 */
export function listRemovableChipKeys(query: JSONObject): Array<string> {
  const keys: Array<string> = [];

  for (const facetKey of LOGS_CHIP_FACET_KEYS) {
    if (query[facetKey] !== undefined) {
      // A column that leaves values out is the `!` chip's.
      keys.push(
        isLeftOutQueryValue(query[facetKey])
          ? toExcludeFacetKey(facetKey)
          : facetKey,
      );
    }
  }

  const resourceFilters: Record<string, unknown> =
    (query[RESOURCE_FILTERS_KEY] as Record<string, unknown> | undefined) || {};

  for (const facetKey of Object.keys(resourceFilters)) {
    keys.push(facetKey);
  }

  const excludedResourceFilters: Record<string, unknown> =
    (query[EXCLUDED_RESOURCE_FILTERS_FIELD] as
      | Record<string, unknown>
      | undefined) || {};

  for (const facetKey of Object.keys(excludedResourceFilters)) {
    keys.push(toExcludeFacetKey(facetKey));
  }

  const attributes: Record<string, unknown> =
    (query[ATTRIBUTES_KEY] as Record<string, unknown> | undefined) || {};

  for (const attributeKey of Object.keys(attributes)) {
    keys.push(`${ATTRIBUTE_FACET_PREFIX}${attributeKey}`);
  }

  return keys;
}
