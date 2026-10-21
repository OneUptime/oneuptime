/*
 * ------------------------------------------------------------------
 * PostgresStorableValue
 *
 * A JavaScript string can hold two kinds of character Postgres will not
 * store, and one of them fails the whole statement, not just its value:
 *
 *   - U+0000 (NUL). jsonb refuses it in any string, key or value alike:
 *         ERROR:  unsupported Unicode escape sequence
 *         DETAIL: \u0000 cannot be converted to text.
 *     A text column refuses it as well, at bind time (22021, invalid byte
 *     sequence for encoding "UTF8": 0x00).
 *   - Half of a UTF-16 surrogate pair on its own - what is left when a
 *     string is cut between the two halves of an emoji. JSON.stringify
 *     writes it as a lone \udXXX escape, and jsonb refuses that too:
 *         ERROR:  invalid input syntax for type json
 *         DETAIL: Unicode low surrogate must follow a high surrogate.
 *
 * Neither is rare in what monitoring is asked to keep. A probe stores the
 * body and headers of whatever the monitored endpoint sent back, and an
 * incoming request or email stores what an outside sender wrote: binary
 * bytes decode to NUL. One such character used to fail the write of the
 * whole payload - for MonitorProbe.lastMonitoringLog that aborted the
 * ingest job before the result was evaluated at all, and every retry
 * failed the same way.
 *
 * Each becomes U+FFFD, the Unicode replacement character, so whoever reads
 * the stored copy can see that something was there - the same substitution
 * RunnerJobService.toStorableText makes for Runner output. It is one UTF-16
 * code unit for one, so lengths and offsets are unchanged.
 * ------------------------------------------------------------------
 */

export const UNSTORABLE_CHARACTER_REPLACEMENT: string = "\uFFFD";

/*
 * Anything that might need replacing: NUL, or any surrogate half. A whole
 * pair matches too and is kept by the replace below - this only decides
 * whether the string needs a second look, so most strings cost one scan.
 * no-control-regex is disabled on purpose: matching NUL is what it is for.
 */
// eslint-disable-next-line no-control-regex
const MAY_BE_UNSTORABLE: RegExp = /[\u0000\uD800-\uDFFF]/;

// eslint-disable-next-line no-control-regex
const NUL_CHARACTERS: RegExp = /\u0000/g;

// A whole pair is matched first, so only a half on its own is replaced.
const SURROGATES: RegExp = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;

type KeepSurrogatePairFunction = (match: string) => string;

const keepSurrogatePairOnly: KeepSurrogatePairFunction = (
  match: string,
): string => {
  return match.length === 2 ? match : UNSTORABLE_CHARACTER_REPLACEMENT;
};

type ToStorableTextFunction = (text: string) => string;

/*
 * The text as Postgres can store it. Returns the very same string when
 * there is nothing to replace.
 */
export const toStorableText: ToStorableTextFunction = (
  text: string,
): string => {
  if (!MAY_BE_UNSTORABLE.test(text)) {
    return text;
  }

  return text
    .replace(NUL_CHARACTERS, UNSTORABLE_CHARACTER_REPLACEMENT)
    .replace(SURROGATES, keepSurrogatePairOnly);
};

type HasOwnFunction = (target: Record<string, unknown>, key: string) => boolean;

const hasOwn: HasOwnFunction = (
  target: Record<string, unknown>,
  key: string,
): boolean => {
  return Object.prototype.hasOwnProperty.call(target, key);
};

type WithStorableKeysFunction = (
  source: Record<string, unknown>,
) => Record<string, unknown>;

/*
 * The object again if none of its keys needs replacing - the common case,
 * which allocates nothing - otherwise a copy with the keys replaced.
 *
 * A replaced key never displaces another one: a key the sender actually
 * sent wins over the stand-in for a different key, and of two keys that
 * map to the same stand-in the first is kept. jsonb would keep only one of
 * them either way.
 *
 * Properties are defined rather than assigned so that a "__proto__" key
 * (JSON.parse creates it as an ordinary own property) stays a property
 * instead of replacing the copy's prototype.
 */
const withStorableKeys: WithStorableKeysFunction = (
  source: Record<string, unknown>,
): Record<string, unknown> => {
  const keys: Array<string> = Object.keys(source);

  const needsNewKeys: boolean = keys.some((key: string) => {
    return toStorableText(key) !== key;
  });

  if (!needsNewKeys) {
    return source;
  }

  const copy: Record<string, unknown> = {};

  for (const key of keys) {
    const storableKey: string = toStorableText(key);

    if (storableKey !== key && hasOwn(source, storableKey)) {
      continue;
    }

    if (hasOwn(copy, storableKey)) {
      continue;
    }

    Object.defineProperty(copy, storableKey, {
      value: source[key],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  return copy;
};

type StorableReplacerFunction = (key: string, value: unknown) => unknown;

/*
 * JSON.stringify hands this every value after toJSON() has run, so it sees
 * exactly the strings that will be written - an ObjectID's or a Date's
 * serialized form included - and every object whose keys will be written.
 */
const storableReplacer: StorableReplacerFunction = (
  _key: string,
  value: unknown,
): unknown => {
  if (typeof value === "string") {
    return toStorableText(value);
  }

  /*
   * Arrays and typed arrays are keyed by index alone, and an index never
   * needs replacing - their elements still come through here one by one.
   */
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !ArrayBuffer.isView(value)
  ) {
    return withStorableKeys(value as Record<string, unknown>);
  }

  return value;
};

/*
 * How JSON.stringify writes the characters above: NUL as \u0000, and a
 * surrogate half on its own as its \udXXX escape (a whole pair goes out as
 * the raw character). JSON text with neither holds only storable strings,
 * keys included. Data that merely contains a backslash followed by "u0000"
 * matches too - that costs the careful path, never a wrong result.
 */
const UNSTORABLE_ESCAPE: RegExp = /\\u(?:0000|d[89a-f])/i;

export type ToStorableJsonFunction = <T>(value: T) => T;

/*
 * A JSON copy of the value that a jsonb column will accept: what
 * JSON.parse(JSON.stringify(value)) returns, with every string in it - keys
 * as well as values, at any depth - passed through toStorableText.
 *
 * Use it where a payload is about to be written to a jsonb column. Every
 * such write was already a JSON copy (the copy itself, or the driver
 * stringifying the value at bind time), so this changes nothing else about
 * what is stored: Dates come back as ISO strings and ObjectIDs as their
 * { _type, value } form, exactly as JSON.parse(JSON.stringify()) gives them.
 *
 * The value passed in is never modified. That matters because the copy is
 * for storage only - the monitor ingest path keeps evaluating criteria
 * against the original payload, NUL and all, so a criteria that inspects
 * the body sees what the endpoint actually sent.
 *
 * Generic over the payload type for the same reason as the redaction
 * helpers in MonitorPayloadRedaction: callers go on treating the copy as
 * the declared interface they stored.
 */
export const toStorableJson: ToStorableJsonFunction = <T>(value: T): T => {
  if (value === null || value === undefined) {
    return value;
  }

  /*
   * Almost every payload has nothing to replace, and this runs on every
   * probe check. A replacer function takes JSON.stringify off its fast
   * path, so the plain copy - exactly what callers used to make - comes
   * first, and the replacer only runs when that text shows it is needed.
   */
  const json: string | undefined = JSON.stringify(value);

  // A function or a symbol has no JSON form; the driver would store nothing.
  if (json === undefined) {
    return undefined as T;
  }

  if (!UNSTORABLE_ESCAPE.test(json)) {
    return JSON.parse(json) as T;
  }

  return JSON.parse(JSON.stringify(value, storableReplacer)) as T;
};

export default {
  toStorableText,
  toStorableJson,
};
