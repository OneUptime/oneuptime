/*
 * A TABLE READ BY TEXT FROM OUTSIDE ONEUPTIME.
 *
 * Security Events reads what other products write - a severity, a tactic's
 * name, a status, a risk type, a Windows provider - and looks each one up in
 * a table of its own words. Search boxes read what somebody typed - a field
 * name before a colon - the same way. Kept as a plain object, such a table
 * answers for names it never listed: every object inherits "constructor",
 * "toString", "valueOf", "hasOwnProperty" and the rest from
 * Object.prototype, and "__proto__" is that prototype itself. So
 * `TACTIC_ID_BY_NAME["constructor"]` was a function, not undefined, and
 * `table[name] || fallback` handed the function on: a tactic named
 * "constructor" went into an event's tactics as code, a severity named
 * "__proto__" as an object, and a search for `constructor:x` broke the
 * search box that read its suggestions as a list.
 *
 * A Map answers only for the keys it was given, so a table read by a
 * source's text is one: written as the object literal it always was, and
 * read with get(). TypeScript refuses `map[key]` on a Map, so nobody can
 * read it the old way by accident (Common's TextLookupTablesGuard holds the
 * Security Events ingest code and the search boxes to this).
 */
export function lookupTable<T>(
  entries: Readonly<Record<string, T>>,
): ReadonlyMap<string, T> {
  // Own keys only: Object.entries never lists what an object inherits.
  return new Map<string, T>(Object.entries(entries));
}

/*
 * The value a record built at run time - a prop, a response, suggestions
 * per field - holds under a key somebody typed, or undefined when the
 * record does not hold that key itself. The record stays the plain object
 * it is; only the read changes: "constructor" is a key of no record, and
 * neither is anything else an object inherits.
 */
export function readOwnValue<T>(
  record: Readonly<Record<string, T>> | null | undefined,
  key: string,
): T | undefined {
  if (!record || !Object.prototype.hasOwnProperty.call(record, key)) {
    return undefined;
  }

  return record[key];
}

/*
 * Sets a key somebody typed on a record built at run time, as the record's
 * own key. `record[key] = value` does that for every key but "__proto__":
 * every object inherits that one as a setter, so assigning a string to it
 * does nothing, and assigning an object or array replaces the record's
 * prototype. Written here, "__proto__" is a key like any other: Object.keys
 * lists it and JSON.stringify writes it. (Copying the record with
 * `{ ...record }`, which this code's ES2017 target compiles to
 * Object.assign, assigns it again and so drops it.)
 */
export function writeOwnValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): void {
  if (key === "__proto__") {
    Object.defineProperty(record, key, {
      value: value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return;
  }

  record[key] = value;
}

export default lookupTable;
