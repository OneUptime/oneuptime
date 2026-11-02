/*
 * A TABLE READ BY TEXT FROM OUTSIDE ONEUPTIME.
 *
 * Security Events reads what other products write - a severity, a tactic's
 * name, a status, a risk type, a Windows provider - and looks each one up in
 * a table of its own words. Kept as a plain object, such a table answers for
 * names it never listed: every object inherits "constructor", "toString",
 * "valueOf", "hasOwnProperty" and the rest from Object.prototype, and
 * "__proto__" is that prototype itself. So `TACTIC_ID_BY_NAME["constructor"]`
 * was a function, not undefined, and `table[name] || fallback` handed the
 * function on: a tactic named "constructor" went into an event's tactics as
 * code, and a severity named "__proto__" as an object.
 *
 * A Map answers only for the keys it was given, so a table read by a
 * source's text is one: written as the object literal it always was, and
 * read with get(). TypeScript refuses `map[key]` on a Map, so nobody can
 * read it the old way by accident (Common's TextLookupTablesGuard holds the
 * Security Events ingest code to this).
 */
export function lookupTable<T>(
  entries: Readonly<Record<string, T>>,
): ReadonlyMap<string, T> {
  // Own keys only: Object.entries never lists what an object inherits.
  return new Map<string, T>(Object.entries(entries));
}

export default lookupTable;
