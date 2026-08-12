/*
 * JSONFunctions.serializeValue had no Array.isArray branch. Arrays are
 * typeof "object", so any array that reached it directly was walked by key and
 * written out as { "0": ..., "1": ... }. Two shapes hit that path:
 *
 *   - an array nested directly inside another array, e.g. the
 *     [facetKey, value] filter tuples of a telemetry saved view;
 *   - a top-level array handed to LocalStorage/SessionStorage/Cookie, which
 *     call serializeValue on the value itself rather than on a wrapper object.
 *
 * (An array under an object key was always safe, at any depth, because
 * serialize() special-cases array-valued keys.)
 *
 * The serializer is fixed, but values written before the fix are still in
 * databases and in browser storage. readLegacySerializedArray reads either
 * shape, so those values load instead of being thrown away — or, worse,
 * destructured and taking the page down with them.
 */

export function readLegacySerializedArray(
  value: unknown,
): Array<unknown> | null {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const keys: Array<string> = Object.keys(record);

  /*
   * An empty object is what an empty array serialized to, and in every place
   * this is used an empty collection is the sensible reading.
   */
  if (keys.length === 0) {
    return [];
  }

  /*
   * Only a complete run of indices 0..n-1 could have come from an array. A
   * genuine object that merely happens to have a "0" key keeps its own shape
   * and is rejected here.
   */
  for (let index: number = 0; index < keys.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(record, String(index))) {
      return null;
    }
  }

  const restored: Array<unknown> = [];

  for (let index: number = 0; index < keys.length; index++) {
    restored.push(record[String(index)]);
  }

  return restored;
}
