import { readLegacySerializedArray } from "../LegacySerializedArray";

/*
 * Saved views (metrics, traces) store their facet filters as [facetKey, value]
 * tuples inside a JSON column. Those tuples used to be corrupted on the way
 * through JSONFunctions.serializeValue, which lacked an Array.isArray branch
 * and so walked nested arrays by key — turning ["service", "api"] into
 * { "0": "service", "1": "api" }. The serializer is fixed, but rows written
 * before the fix still hold the object shape, and destructuring one of those
 * throws "(destructured parameter) is not iterable" and white-screens the
 * explorer.
 *
 * So filters are never destructured straight out of saved state. They go
 * through readSavedViewFilters, which accepts either shape and drops anything
 * it cannot make sense of: a malformed saved view should lose a filter chip,
 * not take the page down with it.
 */

export type SavedViewFilterTuple = [string, string];

export function readSavedViewFilters(
  saved: unknown,
): Array<SavedViewFilterTuple> {
  if (!Array.isArray(saved)) {
    return [];
  }

  const filters: Array<SavedViewFilterTuple> = [];

  for (const entry of saved) {
    const tuple: SavedViewFilterTuple | null = readFilterTuple(entry);

    if (tuple) {
      filters.push(tuple);
    }
  }

  return filters;
}

/*
 * One saved filter, read from either the array tuple it should be or the
 * numeric-keyed object a pre-fix serializer left behind.
 */
function readFilterTuple(entry: unknown): SavedViewFilterTuple | null {
  const tuple: Array<unknown> | null = readLegacySerializedArray(entry);

  if (!tuple) {
    return null;
  }

  return buildTuple(tuple[0], tuple[1]);
}

function buildTuple(
  facetKey: unknown,
  value: unknown,
): SavedViewFilterTuple | null {
  const readableKey: string | null = readFilterString(facetKey);

  if (readableKey === null || readableKey === "") {
    // A filter with no facet to filter on cannot be rebuilt into a chip.
    return null;
  }

  return [readableKey, readFilterString(value) ?? ""];
}

/*
 * Values come back from a JSON column, so a filter saved as a number or a
 * boolean arrives as one. Those still describe a real filter and are kept as
 * their string form; objects, arrays and null do not and are discarded.
 */
function readFilterString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && isFinite(value)) {
    return String(value);
  }

  if (typeof value === "boolean") {
    return String(value);
  }

  return null;
}
