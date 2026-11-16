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
 * lists it and JSON.stringify writes it. (Object.assign assigns it again and
 * so drops it: merge such a record with assignOwnValues, and copy it with
 * copyOwnValues, which keeps it whatever a spread is compiled to.)
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

/*
 * Copies every own key of each source onto `target`, in order, as
 * Object.assign does - "__proto__" included, as the target's own key.
 * Object.assign assigns each key, so it drops a "__proto__" key, and makes
 * an object or array written under it the target's prototype. A spread,
 * `{ ...record }`, did the same below ES2018, where TypeScript compiles it
 * to Object.assign; the servers compile for ES2018 now, where a spread
 * defines each key (Tests/Dependencies/TypeScriptTargets.test.ts), and the
 * browser bundles' spread helper defines it too. A record keyed by what a
 * sender wrote - an attribute map, a series' labels - is still merged here,
 * and copied with copyOwnValues, so it never depends on either.
 *
 * A source without an own "__proto__" key, nearly every one, is still
 * copied by Object.assign itself: this adds one own-key test per source, so
 * the ingest path's merges cost what they did.
 */
export function assignOwnValues<T>(
  target: Record<string, T>,
  ...sources: Array<Readonly<Record<string, T>> | null | undefined>
): Record<string, T> {
  for (const source of sources) {
    if (!source) {
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(source, "__proto__")) {
      Object.assign(target, source);
      continue;
    }

    for (const key of Object.keys(source)) {
      writeOwnValue(target, key, source[key] as T);
    }
  }

  return target;
}

/*
 * Up to three records merged into a new plain object: exactly what
 * assignOwnValues({}, first, second, third) gives - every own key of each,
 * "__proto__" included, a later record's value winning, keys in the same
 * order - for the attribute map of every log, span and metric point ingest
 * stores (its resource's, its own, its scope's).
 *
 * By object spread, which the servers' ES2018 target leaves to the
 * language: CopyDataProperties defines each key, so "__proto__" stays a key
 * (Tests/Dependencies/TypeScriptTargets pins the targets, and
 * Tests/Utils/LookupTableOwnKeys this function). It is also how V8 copies
 * a map fastest: Object.assign stores key by key, and on ingest's many map
 * shapes each store missed V8's inline caches - 3.7 µs to merge one
 * record's 13 keys, against 0.17 µs by spread (#6086).
 */
export function mergeOwnValues<T>(
  first?: Readonly<Record<string, T>> | null,
  second?: Readonly<Record<string, T>> | null,
  third?: Readonly<Record<string, T>> | null,
): Record<string, T> {
  return { ...first, ...second, ...third };
}

/*
 * A new plain object with every own key of `record`, "__proto__" included:
 * what `{ ...record }` gives on an ES2018 or later target, at any target.
 */
export function copyOwnValues<T>(
  record: Readonly<Record<string, T>> | null | undefined,
): Record<string, T> {
  return assignOwnValues<T>({}, record);
}

export default lookupTable;
