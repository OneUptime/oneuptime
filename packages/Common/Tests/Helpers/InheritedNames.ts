/*
 * Every name a plain object answers for without being given it: the
 * properties of Object.prototype - "constructor", "toString", "valueOf",
 * "hasOwnProperty", "__proto__" and the rest. A lookup table kept as a plain
 * object and read by text from outside OneUptime answers each of these with
 * a function (or, for "__proto__", Object.prototype itself); a Map, or a read
 * of own properties only, answers none of them (Common/Utils/LookupTable).
 *
 * Read from the prototype itself, so a name a later JavaScript adds is
 * covered without anyone editing this list.
 */
export const INHERITED_PROPERTY_NAMES: ReadonlyArray<string> =
  Object.getOwnPropertyNames(Object.prototype).sort();

/*
 * The same names as a source may write them: as they are, and in the upper
 * and lower case a reader that folds case reads them in ("CONSTRUCTOR",
 * "tostring"), each once.
 */
export const INHERITED_PROPERTY_NAME_SPELLINGS: ReadonlyArray<string> =
  ((): Array<string> => {
    const spellings: Set<string> = new Set<string>();

    for (const name of INHERITED_PROPERTY_NAMES) {
      spellings.add(name);
      spellings.add(name.toLowerCase());
      spellings.add(name.toUpperCase());
    }

    return Array.from(spellings);
  })();
