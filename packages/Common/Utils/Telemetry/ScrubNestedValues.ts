/*
 * TEXT INSIDE A LIST OR A NESTED VALUE, AS A SCRUB RULE READS IT.
 *
 * An attribute of a log or a span can hold more than one text. OTLP sends
 * lists (an HTTP header's values, a process's command line, an AI call's
 * messages), lists of lists, and key-value lists, and ingest keeps a list as
 * a list (TelemetryUtil.getAttributes): a key-value list becomes keys of
 * their own, or a map inside its list. A scope's attributes are kept as
 * OTLP sent them, a list of {key, value} pairs. The scrub rules
 * (App/FeatureSet/Telemetry/Services/LogScrubRuleService.ts and
 * TraceScrubRuleService.ts) used to read text values only, so a rule that
 * masks emails never saw an address inside a list, and a Sensitive Attribute
 * Keys rule left the values of an `http.request.header.authorization` list
 * in the clear.
 *
 * A rule now reads every text inside such a value, and keeps the value's
 * shape: each list keeps its length and its order, each map its keys, and
 * numbers, true or false and empty values stay as they are. Nothing is
 * changed in place: a list or map holding a text a rule changed is copied,
 * so a value that a resource or a scope shares with every record under it -
 * and the request it came from - stays as it arrived.
 *
 * Bounded, so no payload can make a record slow to scrub: before the rules
 * run, a value nested deeper than SCRUB_MAX_VALUE_DEPTH levels, or one that
 * would take a record past SCRUB_MAX_NESTED_VALUES_PER_RECORD values inside
 * its lists and maps, is held as its JSON text (holdOversizedValuesAsText).
 * A record's attributes are stored as texts anyway - a list or a map as its
 * JSON text - so what the Log and Span tables store for such a value does
 * not change; in a span's events and links it is then a text. Every rule
 * reads a held value as that one text, in time in line with its length.
 */

// How many levels inside one value a scrub rule reads value by value.
export const SCRUB_MAX_VALUE_DEPTH: number = 32;

/*
 * How many values inside its lists and maps one record's rules read value
 * by value - a list's elements, a map's entries, at every level. A record
 * with more is still scrubbed whole: the values past this many are read as
 * their JSON text.
 */
export const SCRUB_MAX_NESTED_VALUES_PER_RECORD: number = 10_000;

/*
 * What a record has left of SCRUB_MAX_NESTED_VALUES_PER_RECORD: one for
 * each record (a log row, a span with its events and links, an exception's
 * content), shared by every attribute map of it.
 */
export interface ScrubNestedValuesAllowance {
  remaining: number;
}

type NestedValue = Array<unknown> | Record<string, unknown>;

/*
 * How a rule scrubs a number held under a key, read as its text (#11383):
 * null where the key changes nothing the rule finds, and the number is
 * kept as it always was.
 */
export type ScrubNumberOf = (
  key: string,
  value: number,
) => ((text: string) => string) | null;

/*
 * How a rule scrubs a list or a map held under a key (#11500): its texts,
 * and the numbers inside it - read as JSON writes them, and written as the
 * rule's text where it hides any of one - or null for numbers that are
 * kept, as numbers inside a value always were.
 */
export interface ScrubOfNestedValue {
  scrubText: (text: string) => string;
  scrubNumber: ((numberText: string) => string) | null;
}

export type ScrubNestedOf = (key: string, value: unknown) => ScrubOfNestedValue;

const JSON_WHITESPACE: string = " \t\n\r";

// A list, or a map as JSON writes one: what a rule reads inside.
function isNested(value: unknown): value is NestedValue {
  if (Array.isArray(value)) {
    return true;
  }

  if (value === null || typeof value !== "object") {
    return false;
  }

  /*
   * A map read from JSON, or built by ingest. Anything else - a Buffer, a
   * Date - is not text a person wrote, and is left as it is.
   */
  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/*
 * A key-value pair as OTLP writes one - {key: "db.password", value: {...}} -
 * whose `key` names its `value`, as an attribute's key names its value.
 */
function isKeyValuePair(map: Record<string, unknown>): boolean {
  return (
    typeof map["key"] === "string" &&
    Object.prototype.hasOwnProperty.call(map, "value")
  );
}

/*
 * A list or a map as the tables store it: its JSON text. A value JSON
 * cannot write - none that ingest builds - is stored empty, since no rule
 * could read it.
 */
function toStoredText(value: NestedValue): string {
  try {
    const text: string | undefined = JSON.stringify(value);

    return typeof text === "string" ? text : "";
  } catch {
    return "";
  }
}

/*
 * Whether a list or map can be read value by value within the bounds - its
 * values count against the record's allowance when it can. `depth` is the
 * level of the value itself: an attribute's value is at 0.
 */
function fitsWithin(
  value: NestedValue,
  depth: number,
  allowance: ScrubNestedValuesAllowance,
): boolean {
  const items: Array<unknown> = Array.isArray(value)
    ? value
    : Object.keys(value).map((key: string): unknown => {
        return value[key];
      });

  if (items.length === 0) {
    return true;
  }

  // Its values would sit deeper than a rule reads.
  if (depth >= SCRUB_MAX_VALUE_DEPTH) {
    return false;
  }

  if (items.length > allowance.remaining) {
    return false;
  }

  allowance.remaining -= items.length;

  for (const item of items) {
    if (isNested(item) && !fitsWithin(item, depth + 1, allowance)) {
      return false;
    }
  }

  return true;
}

/*
 * A map with the same keys and values, and the same kind of prototype.
 * Each key is defined as the copy's own: a key JSON reads as `__proto__`
 * stays a key, where setting it - as spread does once compiled for the
 * server's target, or Object.assign - would set the copy's prototype.
 */
function copyOfMap(map: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = (
    Object.getPrototypeOf(map) === null ? Object.create(null) : {}
  ) as Record<string, unknown>;

  for (const key of Object.keys(map)) {
    Object.defineProperty(copy, key, {
      value: map[key],
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  return copy;
}

/*
 * The list or map with `scrubItem`'s answer for each of its values, copied
 * only when one of them changed: the value itself when none did.
 */
function mapNested(
  value: NestedValue,
  scrubItem: (item: unknown, key: string | null) => unknown,
): NestedValue {
  if (Array.isArray(value)) {
    let copy: Array<unknown> | null = null;

    for (let index: number = 0; index < value.length; index++) {
      const item: unknown = value[index];
      const scrubbed: unknown = scrubItem(item, null);

      if (scrubbed !== item) {
        if (copy === null) {
          copy = value.slice();
        }

        copy[index] = scrubbed;
      }
    }

    return copy === null ? value : copy;
  }

  let copy: Record<string, unknown> | null = null;

  for (const key of Object.keys(value)) {
    const item: unknown = value[key];
    const scrubbed: unknown = scrubItem(item, key);

    if (scrubbed !== item) {
      if (copy === null) {
        copy = copyOfMap(value);
      }

      // The copy's own key - never its prototype, even for `__proto__`.
      copy[key] = scrubbed;
    }
  }

  return copy === null ? value : copy;
}

/*
 * A number inside a list or a map as a rule leaves it (#11500): kept as the
 * number it is, unless the rule hides some of it, as JSON writes it - then
 * the rule's text, as a string, as for a number alone under its key.
 */
function scrubNumberAt(
  value: number,
  scrubNumber: ((numberText: string) => string) | null,
): unknown {
  if (!scrubNumber || !Number.isFinite(value)) {
    return value;
  }

  const text: string = JSON.stringify(value);
  const scrubbed: string = scrubNumber(text);

  return scrubbed === text ? value : scrubbed;
}

function scrubTextsAt(
  value: unknown,
  scrubText: (text: string) => string,
  depth: number,
  scrubNumber: ((numberText: string) => string) | null = null,
): unknown {
  if (typeof value === "string") {
    return scrubText(value);
  }

  if (typeof value === "number") {
    return depth > 0 ? scrubNumberAt(value, scrubNumber) : value;
  }

  if (!isNested(value)) {
    return value;
  }

  if (depth >= SCRUB_MAX_VALUE_DEPTH) {
    const text: string = toStoredText(value);
    const scrubbed: string = scrubText(text);

    return scrubbed === text ? value : scrubbed;
  }

  return mapNested(value, (item: unknown): unknown => {
    return scrubTextsAt(item, scrubText, depth + 1, scrubNumber);
  });
}

/*
 * A text under no secret key, as a Sensitive Attribute Keys rule reads it:
 * kept, or - when the caller reads JSON texts - read as one when it is the
 * JSON text of a list or a map (Utils/Telemetry/ScrubJsonKeys.ts, #8993).
 */
type ReadJsonText = ((text: string) => string) | undefined;

function scrubTextsUnderSensitiveKeysAt(
  value: unknown,
  isSensitiveKey: (key: string) => boolean,
  hideText: (text: string) => string,
  depth: number,
  readJsonText: ReadJsonText,
): unknown {
  if (typeof value === "string") {
    return readJsonText === undefined ? value : readJsonText(value);
  }

  if (!isNested(value)) {
    return value;
  }

  if (depth >= SCRUB_MAX_VALUE_DEPTH) {
    const text: string = toStoredText(value);

    return isSensitiveKey(text) ? hideText(text) : value;
  }

  // The value of a key-value pair whose key names a secret.
  const isSensitivePair: boolean =
    !Array.isArray(value) &&
    isKeyValuePair(value) &&
    isSensitiveKey(value["key"] as string);

  return mapNested(value, (item: unknown, key: string | null): unknown => {
    if (
      key !== null &&
      ((isSensitivePair && key === "value") || isSensitiveKey(key))
    ) {
      return scrubTextsAt(item, hideText, depth + 1);
    }

    return scrubTextsUnderSensitiveKeysAt(
      item,
      isSensitiveKey,
      hideText,
      depth + 1,
      readJsonText,
    );
  });
}

export default class ScrubNestedValuesUtil {
  // A record's allowance, before any of its values is read.
  public static newRecordAllowance(): ScrubNestedValuesAllowance {
    return { remaining: SCRUB_MAX_NESTED_VALUES_PER_RECORD };
  }

  /*
   * The list or map a text is the JSON text of - a log body sent as a map
   * or a list, which ingest stores as its JSON text, or one written as JSON
   * - or null for any other text: plain words, a JSON text, number or
   * true, text that is not JSON at all.
   */
  public static readJsonListOrMap(text: string): unknown {
    let start: number = 0;

    // What JSON reads as space: a space, a tab, a line feed, a return.
    while (
      start < text.length &&
      JSON_WHITESPACE.includes(text.charAt(start))
    ) {
      start++;
    }

    const first: string = text.charAt(start);

    if (first !== "{" && first !== "[") {
      return null;
    }

    try {
      const value: unknown = JSON.parse(text);

      return isNested(value) ? value : null;
    } catch {
      return null;
    }
  }

  // Whether a value is a list or a map, which a rule reads inside.
  public static isNested(value: unknown): boolean {
    return isNested(value);
  }

  /*
   * Before the rules read an attribute map: each list or map value of it
   * that a rule could not read value by value within the bounds - one
   * nested deeper than SCRUB_MAX_VALUE_DEPTH, or one holding more values
   * than the record has left of its allowance - becomes its JSON text, in
   * place; a value that fits counts its values against the allowance.
   * Every rule then reads the same value, and reads a held one as one text.
   * Returns the keys whose values it held as text.
   */
  public static holdOversizedValuesAsText(
    values: Record<string, unknown>,
    allowance: ScrubNestedValuesAllowance,
  ): Set<string> {
    const heldKeys: Set<string> = new Set<string>();

    for (const key of Object.keys(values)) {
      const value: unknown = values[key];

      if (!isNested(value)) {
        continue;
      }

      const remainingBefore: number = allowance.remaining;

      if (fitsWithin(value, 0, allowance)) {
        continue;
      }

      // Read as one text, it takes nothing of the allowance.
      allowance.remaining = remainingBefore;
      values[key] = toStoredText(value);
      heldKeys.add(key);
    }

    return heldKeys;
  }

  /*
   * The value with every text inside it, at every level, replaced by what
   * `scrubText` makes of it: a text is scrubbed as it is, a list or a map
   * value by value, and anything else - a number, true or false, an empty
   * value - is kept. A list or map is copied only when a text inside it
   * changed. Past SCRUB_MAX_VALUE_DEPTH - never, once
   * holdOversizedValuesAsText has run - the rest of a value is read as its
   * JSON text, and stored as that text when the rule changed it.
   */
  public static scrubTexts(
    value: unknown,
    scrubText: (text: string) => string,
  ): unknown {
    return scrubTextsAt(value, scrubText, 0);
  }

  /*
   * For a rule that reads keys (Sensitive Attribute Keys): the value with
   * the texts under each key that `isSensitiveKey` says names a secret
   * replaced by what `hideText` makes of them - every text, at every level
   * below that key. The keys read are a map's keys and the key of each OTLP
   * key-value pair; the texts under no such key are kept as they are, and
   * so are numbers, true or false and empty values under one. Past
   * SCRUB_MAX_VALUE_DEPTH - never, once holdOversizedValuesAsText has run -
   * the rest of a value is read as its JSON text, and hidden whole when
   * that text names a secret. `readJsonText`: what becomes of a text under
   * no such key - kept when left out (hideAttributeTextsUnderSensitiveKeys).
   */
  public static scrubTextsUnderSensitiveKeys(
    value: unknown,
    isSensitiveKey: (key: string) => boolean,
    hideText: (text: string) => string,
    readJsonText?: ReadJsonText,
  ): unknown {
    return scrubTextsUnderSensitiveKeysAt(
      value,
      isSensitiveKey,
      hideText,
      0,
      readJsonText,
    );
  }

  /*
   * A rule that reads text - a built-in pattern, a custom one - over an
   * attribute map, in place: each text value scrubbed as it is, each list
   * or map value text by text (scrubTexts). Anything else is kept.
   */
  public static scrubAttributeTexts(
    attributes: Record<string, unknown>,
    scrubText: (text: string) => string,
  ): void {
    ScrubNestedValuesUtil.scrubAttributeTextsUnderKeys(
      attributes,
      (): ((text: string) => string) => {
        return scrubText;
      },
    );
  }

  /*
   * As scrubAttributeTexts, each value's texts scrubbed by what
   * `scrubTextOf` gives for its key and the value it holds: a rule that
   * reads a value as the key it is held under says (#11383) - a national
   * number alone under `user.phone` is a phone number, and a list or a map
   * is read as its JSON text too (ScrubRegExp.underKey). `scrubNumberOf`:
   * for a rule that reads a number under a key - 536221234 sent as a
   * number under `customer.ssn`, which the table stores, and Data Security
   * reads, as its text - how a number under that key is scrubbed, or null
   * where the key changes nothing it finds: the number is kept, as every
   * number always was.
   */
  public static scrubAttributeTextsUnderKeys(
    attributes: Record<string, unknown>,
    scrubTextOf: (key: string, value: unknown) => (text: string) => string,
    scrubNumberOf?: ScrubNumberOf | undefined,
    scrubNestedOf?: ScrubNestedOf | undefined,
  ): void {
    for (const key of Object.keys(attributes)) {
      const value: unknown = attributes[key];
      const scrubbed: unknown = ScrubNestedValuesUtil.scrubValueUnderKey(
        key,
        value,
        scrubTextOf,
        scrubNumberOf,
        scrubNestedOf,
      );

      if (scrubbed !== value) {
        attributes[key] = scrubbed;
      }
    }
  }

  /*
   * One attribute's value as scrubAttributeTextsUnderKeys leaves it: its
   * texts scrubbed as its key says, a number under a key a rule reads
   * numbers by scrubbed as its text - kept as the number it is unless the
   * rule hid some of it - and anything else kept. `scrubNestedOf`: for a
   * rule that reads the numbers inside a list or a map too (#11500), how it
   * scrubs such a value - its texts and its numbers together, read once.
   */
  public static scrubValueUnderKey(
    key: string,
    value: unknown,
    scrubTextOf: (key: string, value: unknown) => (text: string) => string,
    scrubNumberOf?: ScrubNumberOf | undefined,
    scrubNestedOf?: ScrubNestedOf | undefined,
  ): unknown {
    if (isNested(value) && scrubNestedOf) {
      const scrub: ScrubOfNestedValue = scrubNestedOf(key, value);

      return scrubTextsAt(value, scrub.scrubText, 0, scrub.scrubNumber);
    }

    if (typeof value === "string" || isNested(value)) {
      return scrubTextsAt(value, scrubTextOf(key, value), 0);
    }

    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !scrubNumberOf
    ) {
      return value;
    }

    const scrubNumber: ((text: string) => string) | null = scrubNumberOf(
      key,
      value,
    );

    if (!scrubNumber) {
      return value;
    }

    const text: string = String(value);
    const scrubbed: string = scrubNumber(text);

    return scrubbed === text ? value : scrubbed;
  }

  /*
   * A Sensitive Attribute Keys rule over an attribute map, in place: every
   * text of a value whose key names a secret is hidden, a list's or a map's
   * included, and inside any other list or map value the texts under a key
   * that names a secret (scrubTextsUnderSensitiveKeys). A value held as its
   * JSON text (`heldAsText`: the keys holdOversizedValuesAsText returned)
   * cannot be read key by key, so it is hidden whole when its text names a
   * secret anywhere - rather than let a key inside it go unread.
   * `keptKeys`: the map's own keys whose values are kept although their key
   * names a secret - a record's own session or conversation id, which its
   * column keeps (Utils/Telemetry/CorrelationIdAttributes). Only the map's
   * own: the same key inside a list or a map value is read as any other.
   * `readJsonText`: what becomes of a text under no secret key that arrived
   * as text - the value itself, or one inside a list or a map value: the
   * services read the keys of a JSON text in it (Utils/Telemetry/
   * ScrubJsonKeys.ts, #8993). Kept when left out.
   */
  public static hideAttributeTextsUnderSensitiveKeys(
    attributes: Record<string, unknown>,
    isSensitiveKey: (key: string) => boolean,
    hideText: (text: string) => string,
    heldAsText: ReadonlySet<string>,
    keptKeys?: ReadonlySet<string> | undefined,
    readJsonText?: ReadJsonText,
  ): void {
    for (const key of Object.keys(attributes)) {
      const value: unknown = attributes[key];

      if (keptKeys !== undefined && keptKeys.has(key)) {
        continue;
      }

      if (isSensitiveKey(key)) {
        if (typeof value === "string" || isNested(value)) {
          attributes[key] = scrubTextsAt(value, hideText, 0);
        }

        continue;
      }

      if (typeof value === "string") {
        if (heldAsText.has(key)) {
          // Too large to read value by value: hidden whole, or kept.
          if (isSensitiveKey(value)) {
            attributes[key] = hideText(value);
          }
        } else if (readJsonText !== undefined) {
          attributes[key] = readJsonText(value);
        }

        continue;
      }

      if (isNested(value)) {
        attributes[key] = scrubTextsUnderSensitiveKeysAt(
          value,
          isSensitiveKey,
          hideText,
          0,
          readJsonText,
        );
      }
    }
  }
}
