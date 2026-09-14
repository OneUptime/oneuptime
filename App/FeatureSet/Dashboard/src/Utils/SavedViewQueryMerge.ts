import { JSONObject } from "Common/Types/JSON";
import { BODY_FACET_KEY } from "./LogsCrossSignalPivot";
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
      keys.push(facetKey);
    }
  }

  const resourceFilters: Record<string, unknown> =
    (query[RESOURCE_FILTERS_KEY] as Record<string, unknown> | undefined) || {};

  for (const facetKey of Object.keys(resourceFilters)) {
    keys.push(facetKey);
  }

  const attributes: Record<string, unknown> =
    (query[ATTRIBUTES_KEY] as Record<string, unknown> | undefined) || {};

  for (const attributeKey of Object.keys(attributes)) {
    keys.push(`${ATTRIBUTE_FACET_PREFIX}${attributeKey}`);
  }

  return keys;
}
