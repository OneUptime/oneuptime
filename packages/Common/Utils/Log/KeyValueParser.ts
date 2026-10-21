import BadDataException from "../../Types/Exception/BadDataException";

/*
 * Key=value parser.
 *
 * Firewalls and other network appliances log one event per line as a run
 * of key=value pairs:
 *
 *   device_name="SFW" log_component="IPSec" con_name="HQ-Branch1" status="Terminated"
 *
 * Sophos XGS, Fortinet FortiGate and every logfmt emitter look like this.
 * Which fields appear, and in which order, depends on the event type, so
 * one grok pattern cannot describe the line. This parser walks the line
 * once instead and returns every pair it finds, whatever their order.
 *
 * The rules, each pinned by KeyValueParser.test.ts:
 *
 *   - Pairs are separated by any run of whitespace, or by a configured
 *     pair delimiter (`,`, `;`, `|`, ...). With a configured delimiter the
 *     whitespace around keys and unquoted values is trimmed.
 *   - A key is separated from its value by `=`, or by a configured
 *     key-value delimiter.
 *   - A value may be double- or single-quoted. Inside quotes, delimiters
 *     and whitespace are part of the value, and a backslash escapes the
 *     quote character and the backslash itself (`\"` -> `"`, `\\` -> `\`).
 *     Any other backslash is kept as written, so a Windows path survives.
 *     A quote that is never closed - a line cut off by a syslog size
 *     limit - runs to the end of the line.
 *   - An unquoted value runs up to the next pair delimiter, so
 *     `url=https://x/?a=b` keeps its `=`.
 *   - `key=` and `key=""` give an empty value. Values are always strings:
 *     `latency=11` is "11", never the number 11, the same as an un-typed
 *     grok capture.
 *   - Keys start with a letter or underscore and use letters, digits and
 *     `. _ - @` - the rule grok field names follow, since both become
 *     attribute keys. Text before the first pair (an RFC 3164 header, a
 *     `tag:`) and any token without a key-value delimiter is skipped, not
 *     fatal. Anything glued to the front of a key, such as a syslog
 *     `<30>` priority in `<30>device_name="SFW"`, is dropped and the key
 *     behind it kept.
 *   - A key that repeats keeps its FIRST value. Later duplicates are
 *     ignored, the same rule grok applies to a field captured twice.
 *
 * This runs once per ingested log record on the telemetry hot path, over
 * text whoever can reach the syslog port controls. Every dimension is
 * bounded: inputs over MAX_KEY_VALUE_INPUT_LENGTH are not parsed at all
 * (the same ceiling as grok), at most MAX_KEY_VALUE_PAIRS keys are
 * returned, a key over MAX_KEY_VALUE_KEY_LENGTH is skipped and a value
 * over MAX_KEY_VALUE_VALUE_LENGTH is truncated. The walk is a single
 * linear pass - there is no regex to backtrack.
 */

export const DEFAULT_KEY_VALUE_DELIMITER: string = "=";

/** Longest input that is parsed. Mirrors MAX_GROK_INPUT_LENGTH. */
export const MAX_KEY_VALUE_INPUT_LENGTH: number = 32768;

/** Most pairs one line may add. Mirrors MAX_GROK_CAPTURES. */
export const MAX_KEY_VALUE_PAIRS: number = 100;

/** Longest key that is kept. Longer ones are skipped, not cut. */
export const MAX_KEY_VALUE_KEY_LENGTH: number = 256;

/** Longest value that is kept whole. Longer ones are truncated. */
export const MAX_KEY_VALUE_VALUE_LENGTH: number = 4096;

/** Longest delimiter a processor may be configured with. */
export const MAX_KEY_VALUE_DELIMITER_LENGTH: number = 8;

/*
 * The grok field-name rule (Utils/Grok/Grok.ts FIELD_NAME_REGEX). Dots are
 * allowed because OTel semantic-convention keys use them.
 */
const KEY_REGEX: RegExp = /^[A-Za-z_][A-Za-z0-9_.@-]*$/;

/*
 * One character that may appear in a key. Used to recover the key at the
 * end of a token that has something glued to its front.
 */
const KEY_CHARACTER_REGEX: RegExp = /[A-Za-z0-9_.@-]/;

/*
 * Hoisted rather than written inline: two lint rules disagree about
 * parenthesising a regex literal in an expression (see
 * SeriesContextEnricher).
 */
const WHITESPACE_REGEX: RegExp = /\s/;

const VISIBLE_CHARACTER_REGEX: RegExp = /\S/;

/*
 * Characters a delimiter may not contain: they open a quoted value or
 * escape inside one, so a delimiter made of them could never be found.
 */
const RESERVED_DELIMITER_CHARACTERS: Array<string> = ['"', "'", "\\"];

const QUOTE_CHARACTERS: Array<string> = ['"', "'"];

export interface KeyValueParserOptions {
  /*
   * What separates one pair from the next. Leave it out to split on any
   * run of whitespace - what Sophos, Fortinet and logfmt all use.
   */
  pairDelimiter?: string | undefined | null;
  // What separates a key from its value. Defaults to "=".
  keyValueDelimiter?: string | undefined | null;
}

export interface ResolvedKeyValueParserOptions {
  // null means "any run of whitespace".
  pairDelimiter: string | null;
  keyValueDelimiter: string;
}

function isWhitespace(character: string): boolean {
  return character.length > 0 && WHITESPACE_REGEX.test(character);
}

function readDelimiter(input: { value: unknown; name: string }): string | null {
  if (input.value === undefined || input.value === null) {
    return null;
  }

  if (typeof input.value !== "string") {
    throw new BadDataException(`${input.name} must be text.`);
  }

  if (input.value.length === 0) {
    throw new BadDataException(`${input.name} cannot be empty.`);
  }

  if (input.value.length > MAX_KEY_VALUE_DELIMITER_LENGTH) {
    throw new BadDataException(
      `${input.name} cannot be longer than ${MAX_KEY_VALUE_DELIMITER_LENGTH} characters.`,
    );
  }

  for (const reserved of RESERVED_DELIMITER_CHARACTERS) {
    if (input.value.includes(reserved)) {
      throw new BadDataException(
        `${input.name} cannot contain quotes or backslashes - those mark quoted values.`,
      );
    }
  }

  return input.value;
}

/*
 * Check a processor's delimiters and fill in the defaults. Throws
 * BadDataException with a message meant for the person configuring the
 * processor: save-time validation and the dashboard form both show it,
 * and the ingest path refuses to run a configuration that fails it.
 */
export function resolveKeyValueParserOptions(
  options?: KeyValueParserOptions | null | undefined,
): ResolvedKeyValueParserOptions {
  const pairDelimiter: string | null = readDelimiter({
    value: options?.pairDelimiter,
    name: "Pair delimiter",
  });

  const keyValueDelimiter: string =
    readDelimiter({
      value: options?.keyValueDelimiter,
      name: "Key-value delimiter",
    }) ?? DEFAULT_KEY_VALUE_DELIMITER;

  /*
   * An all-whitespace key-value delimiter would turn every space of the
   * line into one - there would be nothing left to separate the pairs.
   */
  if (!VISIBLE_CHARACTER_REGEX.test(keyValueDelimiter)) {
    throw new BadDataException(
      "Key-value delimiter must contain a visible character, such as = or :.",
    );
  }

  if (pairDelimiter !== null) {
    if (pairDelimiter === keyValueDelimiter) {
      throw new BadDataException(
        "Pair delimiter and key-value delimiter must be different.",
      );
    }

    /*
     * `,` and `,=` (or `=` and `==`) leave it ambiguous which one a run
     * of characters is, so the line would split differently depending on
     * where the parser happened to look first.
     */
    if (
      pairDelimiter.includes(keyValueDelimiter) ||
      keyValueDelimiter.includes(pairDelimiter)
    ) {
      throw new BadDataException(
        "Pair delimiter and key-value delimiter cannot contain one another.",
      );
    }
  }

  return {
    pairDelimiter: pairDelimiter,
    keyValueDelimiter: keyValueDelimiter,
  };
}

/*
 * The key a raw token stands for, or null when it cannot be one.
 *
 * A token that is not a key as a whole may still END in one: a syslog
 * priority or a tag can be glued to the front of the first pair
 * (`<30>device_name`, `kernel:action`). The trailing run of key
 * characters is tried before the token is given up on.
 */
function toKey(rawKey: string): string | null {
  if (rawKey.length === 0) {
    return null;
  }

  let key: string = rawKey;

  if (!KEY_REGEX.test(key)) {
    let start: number = key.length;

    while (start > 0 && KEY_CHARACTER_REGEX.test(key.charAt(start - 1))) {
      start--;
    }

    key = key.slice(start);

    if (!KEY_REGEX.test(key)) {
      return null;
    }
  }

  if (key.length > MAX_KEY_VALUE_KEY_LENGTH) {
    return null;
  }

  /*
   * The result is a plain object and so are the attributes it is merged
   * into: assigning "__proto__" would replace the prototype instead of
   * adding an attribute.
   */
  if (key === "__proto__") {
    return null;
  }

  return key;
}

function capValue(value: string): string {
  if (value.length <= MAX_KEY_VALUE_VALUE_LENGTH) {
    return value;
  }

  let end: number = MAX_KEY_VALUE_VALUE_LENGTH;

  // Never end on the first half of a surrogate pair, such as an emoji.
  const lastCharCode: number = value.charCodeAt(end - 1);

  if (lastCharCode >= 0xd800 && lastCharCode <= 0xdbff) {
    end -= 1;
  }

  return value.slice(0, end);
}

/*
 * Read a quoted value whose opening quote has already been consumed.
 * Returns the unescaped value and the index just past the closing quote -
 * or the end of the input, when the quote is never closed.
 */
function readQuotedValue(input: {
  text: string;
  start: number;
  quote: string;
}): { value: string; end: number } {
  let value: string = "";
  let index: number = input.start;

  while (index < input.text.length) {
    const character: string = input.text.charAt(index);

    if (character === "\\" && index + 1 < input.text.length) {
      const next: string = input.text.charAt(index + 1);

      if (next === input.quote || next === "\\") {
        value += next;
        index += 2;
        continue;
      }
    }

    if (character === input.quote) {
      return { value: value, end: index + 1 };
    }

    value += character;
    index++;
  }

  return { value: value, end: index };
}

/*
 * Parse one line into its pairs, in the order they appear. Throws
 * BadDataException only for invalid options (see
 * resolveKeyValueParserOptions); a line that holds no pairs is not an
 * error and returns {}.
 */
export function parseKeyValuePairs(
  input: string,
  options?: KeyValueParserOptions | ResolvedKeyValueParserOptions | null,
): Record<string, string> {
  const resolved: ResolvedKeyValueParserOptions =
    resolveKeyValueParserOptions(options);

  const result: Record<string, string> = {};

  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > MAX_KEY_VALUE_INPUT_LENGTH
  ) {
    return result;
  }

  const pairDelimiter: string | null = resolved.pairDelimiter;
  const keyValueDelimiter: string = resolved.keyValueDelimiter;
  const length: number = input.length;

  // Length of the pair delimiter starting at `at`, or 0 when there is none.
  const pairDelimiterLengthAt: (at: number) => number = (
    at: number,
  ): number => {
    if (pairDelimiter === null) {
      return isWhitespace(input.charAt(at)) ? 1 : 0;
    }

    return input.startsWith(pairDelimiter, at) ? pairDelimiter.length : 0;
  };

  let pairCount: number = 0;
  let index: number = 0;

  while (index < length && pairCount < MAX_KEY_VALUE_PAIRS) {
    /*
     * Step over separators. With a configured delimiter the whitespace
     * padding around it goes too: "a=1, b=2" splits on "," cleanly.
     */
    for (;;) {
      const delimiterLength: number = pairDelimiterLengthAt(index);

      if (delimiterLength > 0) {
        index += delimiterLength;
        continue;
      }

      if (pairDelimiter !== null && isWhitespace(input.charAt(index))) {
        index++;
        continue;
      }

      break;
    }

    if (index >= length) {
      break;
    }

    // The key runs to the key-value delimiter, unless the token ends first.
    const keyStart: number = index;
    let keyValueDelimiterIndex: number = -1;

    while (index < length) {
      if (input.startsWith(keyValueDelimiter, index)) {
        keyValueDelimiterIndex = index;
        break;
      }

      if (pairDelimiterLengthAt(index) > 0) {
        break;
      }

      index++;
    }

    /*
     * A token with no key-value delimiter in it: free text before the
     * first pair, a syslog header, a stray word. Skip it and carry on
     * from the separator it stopped at.
     */
    if (keyValueDelimiterIndex === -1) {
      continue;
    }

    const rawKey: string = input.slice(keyStart, keyValueDelimiterIndex);
    index = keyValueDelimiterIndex + keyValueDelimiter.length;

    if (pairDelimiter !== null) {
      while (
        index < length &&
        pairDelimiterLengthAt(index) === 0 &&
        isWhitespace(input.charAt(index))
      ) {
        index++;
      }
    }

    let value: string;
    const firstValueCharacter: string = input.charAt(index);

    if (QUOTE_CHARACTERS.includes(firstValueCharacter)) {
      const quoted: { value: string; end: number } = readQuotedValue({
        text: input,
        start: index + 1,
        quote: firstValueCharacter,
      });

      value = quoted.value;
      index = quoted.end;

      // Anything glued to the closing quote (`a="x"y`) is not part of it.
      while (index < length && pairDelimiterLengthAt(index) === 0) {
        index++;
      }
    } else {
      const valueStart: number = index;

      while (index < length && pairDelimiterLengthAt(index) === 0) {
        index++;
      }

      value = input.slice(valueStart, index);

      if (pairDelimiter !== null) {
        value = value.trim();
      }
    }

    const key: string | null = toKey(
      pairDelimiter !== null ? rawKey.trim() : rawKey,
    );

    if (key === null) {
      continue;
    }

    // First value wins - a later duplicate never replaces it.
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      continue;
    }

    result[key] = capValue(value);
    pairCount++;
  }

  return result;
}

export default {
  parseKeyValuePairs,
  resolveKeyValueParserOptions,
};
