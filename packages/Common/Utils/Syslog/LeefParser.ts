/*
 * Log Event Extended Format (LEEF) reader.
 *
 * LEEF is IBM QRadar's line format, which firewalls, proxies, WAFs and
 * endpoint products export their events in beside (or instead of) CEF -
 * Palo Alto Networks, Zscaler, Imperva, Check Point, Trend Micro:
 *
 *   LEEF:1.0|Microsoft|MSExchange|4.0 SP1|15345|src=10.50.1.1	dst=2.10.20.20	spt=1200
 *   LEEF:2.0|Lancope|StealthWatch|1.0|41|^|src=10.0.1.8^dst=10.0.0.5^sev=5
 *
 * Five header fields between pipes - format version, vendor, product,
 * product version, event id - and then the attributes: key=value pairs,
 * separated by a tab in LEEF 1.0. LEEF 2.0 adds a sixth header field that
 * names the separator: one character ("^"), or its code in hex ("x09",
 * "0x5E"); left empty, it is a tab.
 *
 * The rules, each pinned by LeefParser.test.ts:
 *
 *   - The message starts at "LEEF:" and a version, at the start of the
 *     line, after a space or right after a syslog priority
 *     ("<13>LEEF:1.0|"). Whatever comes before it is not part of it.
 *   - In the header a pipe inside a field is written "\|" and a backslash
 *     "\\", as CEF writes them; the header must be complete.
 *   - An attribute's value runs to the next separator. A product that
 *     says it separates with a tab and has none in its attributes
 *     separates them with spaces, as many do: its values then run to the
 *     next " key=", as CEF's do.
 *   - Values are always text. A key that repeats keeps its FIRST value.
 *
 * This runs on text whoever can reach the syslog port controls. Every
 * dimension is bounded - the input, the number of pairs, the length of a
 * key and of a value - and the walk is a single pass with no regular
 * expression over the message.
 */

/** Longest message that is parsed, as for CEF. */
export const MAX_LEEF_INPUT_LENGTH: number = 32768;

/** Most attributes one message may add. */
export const MAX_LEEF_ATTRIBUTES: number = 100;

/** Longest attribute key that is kept. Longer ones are skipped. */
export const MAX_LEEF_KEY_LENGTH: number = 256;

/** Longest value that is kept whole. Longer ones are truncated. */
export const MAX_LEEF_VALUE_LENGTH: number = 4096;

/** How far into a line "LEEF:" is looked for (past a syslog header). */
export const MAX_LEEF_PREFIX_LENGTH: number = 512;

const LEEF_MARKER: string = "LEEF:";

const TAB: string = "\t";

export interface ParsedLeef {
  // The format's own version: "1.0" or "2.0".
  version: string;
  vendor: string;
  product: string;
  productVersion: string;
  eventId: string;
  // The character the attributes are separated by.
  delimiter: string;
  // The attributes, in the order they appear.
  attributes: Record<string, string>;
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isWhitespace(character: string): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
}

function isHexDigit(character: string): boolean {
  return (
    isDigit(character) ||
    (character >= "a" && character <= "f") ||
    (character >= "A" && character <= "F")
  );
}

/*
 * A character an attribute key may hold: letters, digits and the few signs
 * vendors use in keys (srcPort, devTimeFormat, identHostName, cs1_label).
 */
function isKeyCharacter(character: string): boolean {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    isDigit(character) ||
    character === "_" ||
    character === "." ||
    character === "-"
  );
}

/*
 * Where a LEEF message starts in a line, or -1 when the line holds none:
 * "LEEF:", a version of digits and dots and a pipe, at the start, after a
 * space or after a syslog priority, within the first MAX_LEEF_PREFIX_LENGTH
 * characters.
 */
export function findLeefStart(text: unknown): number {
  if (typeof text !== "string" || text.length === 0) {
    return -1;
  }

  let from: number = 0;

  while (from <= MAX_LEEF_PREFIX_LENGTH) {
    const at: number = text.indexOf(LEEF_MARKER, from);

    if (at === -1 || at > MAX_LEEF_PREFIX_LENGTH) {
      return -1;
    }

    const before: string = at === 0 ? "" : text.charAt(at - 1);
    const isAtWordStart: boolean =
      at === 0 || isWhitespace(before) || before === ">";
    let index: number = at + LEEF_MARKER.length;
    const versionStart: number = index;

    while (
      index < text.length &&
      index - versionStart <= 4 &&
      (isDigit(text.charAt(index)) || text.charAt(index) === ".")
    ) {
      index++;
    }

    if (
      isAtWordStart &&
      index > versionStart &&
      isDigit(text.charAt(versionStart)) &&
      text.charAt(index) === "|"
    ) {
      return at;
    }

    from = at + LEEF_MARKER.length;
  }

  return -1;
}

function capValue(value: string): string {
  if (value.length <= MAX_LEEF_VALUE_LENGTH) {
    return value;
  }

  let end: number = MAX_LEEF_VALUE_LENGTH;

  // Never end on the first half of a surrogate pair.
  const lastCharCode: number = value.charCodeAt(end - 1);

  if (lastCharCode >= 0xd800 && lastCharCode <= 0xdbff) {
    end -= 1;
  }

  return value.slice(0, end);
}

// A header field as it was meant: "\|" is a pipe and "\\" a backslash.
function unescapeHeaderField(value: string): string {
  if (!value.includes("\\")) {
    return value;
  }

  let output: string = "";

  for (let index: number = 0; index < value.length; index++) {
    const character: string = value.charAt(index);

    if (character === "\\" && index + 1 < value.length) {
      const next: string = value.charAt(index + 1);

      if (next === "|" || next === "\\") {
        output += next;
        index++;
        continue;
      }
    }

    output += character;
  }

  return output;
}

/*
 * The separator a LEEF 2.0 header names: one character as written, or a
 * character code in hex ("x09", "0x09", "X5E"). Empty, or anything else,
 * is the default tab.
 */
export function readLeefDelimiter(field: string): string {
  const value: string = field;

  if (value.length === 1) {
    return value;
  }

  let hex: string = value.trim();

  if (hex.startsWith("0x") || hex.startsWith("0X")) {
    hex = hex.slice(2);
  } else if (hex.startsWith("x") || hex.startsWith("X")) {
    hex = hex.slice(1);
  } else {
    return TAB;
  }

  if (hex.length === 0 || hex.length > 4) {
    return TAB;
  }

  for (let index: number = 0; index < hex.length; index++) {
    if (!isHexDigit(hex.charAt(index))) {
      return TAB;
    }
  }

  const code: number = parseInt(hex, 16);

  // A printable separator, or a tab: never a character that ends a line.
  if (code === 9 || (code >= 32 && code !== 127 && code <= 0xffff)) {
    return String.fromCharCode(code);
  }

  return TAB;
}

/*
 * The attributes, split at the separator: each part is one key=value
 * pair, its key everything before the first "=".
 */
function parseDelimitedAttributes(
  text: string,
  delimiter: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  let pairCount: number = 0;
  let start: number = 0;

  while (start <= text.length && pairCount < MAX_LEEF_ATTRIBUTES) {
    const end: number = text.indexOf(delimiter, start);
    const part: string = text.slice(start, end === -1 ? text.length : end);
    const equals: number = part.indexOf("=");

    if (equals > 0) {
      const key: string = part.slice(0, equals).trim();

      if (
        key &&
        key.length <= MAX_LEEF_KEY_LENGTH &&
        key !== "__proto__" &&
        !Object.prototype.hasOwnProperty.call(result, key)
      ) {
        result[key] = capValue(part.slice(equals + 1).trim());
        pairCount++;
      }
    }

    if (end === -1) {
      break;
    }

    start = end + delimiter.length;
  }

  return result;
}

interface AttributeKey {
  key: string;
  keyStart: number;
  valueStart: number;
}

/*
 * Attributes a product separated with spaces: each pair starts with a run
 * of key characters at the start of the text or after whitespace,
 * followed by "=". One forward pass, as CEF's extension is read.
 */
function parseSpaceSeparatedAttributes(text: string): Record<string, string> {
  const keys: Array<AttributeKey> = [];
  const length: number = text.length;
  let index: number = 0;

  while (index < length) {
    const isAtWordStart: boolean =
      index === 0 || isWhitespace(text.charAt(index - 1));

    if (!isAtWordStart || !isKeyCharacter(text.charAt(index))) {
      index++;
      continue;
    }

    let end: number = index;

    while (end < length && isKeyCharacter(text.charAt(end))) {
      end++;
    }

    if (text.charAt(end) === "=") {
      keys.push({
        key: text.slice(index, end),
        keyStart: index,
        valueStart: end + 1,
      });
      index = end + 1;
      continue;
    }

    index = end > index ? end : index + 1;
  }

  const result: Record<string, string> = {};
  let pairCount: number = 0;

  for (let at: number = 0; at < keys.length; at++) {
    if (pairCount >= MAX_LEEF_ATTRIBUTES) {
      break;
    }

    const current: AttributeKey = keys[at]!;
    const next: AttributeKey | undefined = keys[at + 1];
    const valueEnd: number = next ? next.keyStart : text.length;

    if (
      current.key.length > MAX_LEEF_KEY_LENGTH ||
      current.key === "__proto__" ||
      Object.prototype.hasOwnProperty.call(result, current.key)
    ) {
      continue;
    }

    result[current.key] = capValue(
      text.slice(current.valueStart, valueEnd).trim(),
    );
    pairCount++;
  }

  return result;
}

/*
 * Reads the LEEF message in a line, or returns null when the line holds
 * none or its header is not complete. Never throws.
 */
export function parseLeef(text: unknown): ParsedLeef | null {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }

  const start: number = findLeefStart(text);

  if (start === -1) {
    return null;
  }

  const message: string = text.slice(start, start + MAX_LEEF_INPUT_LENGTH);
  const versionEnd: number = message.indexOf("|", LEEF_MARKER.length);
  const version: string = message.slice(LEEF_MARKER.length, versionEnd);
  const isVersionTwo: boolean = version.startsWith("2");
  // Vendor, product, product version, event id - and the separator in 2.0.
  const fieldCount: number = isVersionTwo ? 5 : 4;

  const fields: Array<string> = [];
  let fieldStart: number = versionEnd + 1;
  let index: number = fieldStart;
  let attributesStart: number = -1;

  while (index < message.length) {
    const character: string = message.charAt(index);

    if (character === "\\" && index + 1 < message.length) {
      // Whatever follows a backslash belongs to the field.
      index += 2;
      continue;
    }

    if (character === "|") {
      fields.push(message.slice(fieldStart, index));
      fieldStart = index + 1;

      if (fields.length === fieldCount) {
        attributesStart = index + 1;
        break;
      }
    }

    index++;
  }

  if (fields.length < fieldCount) {
    return null;
  }

  const header: Array<string> = fields.map((field: string): string => {
    return capValue(unescapeHeaderField(field).trim());
  });

  // The separator field is read as written: a space is a separator too.
  const delimiter: string = isVersionTwo
    ? readLeefDelimiter(fields[4] || "")
    : TAB;
  const attributesText: string =
    attributesStart === -1 ? "" : message.slice(attributesStart);

  const attributes: Record<string, string> =
    delimiter === TAB && !attributesText.includes(TAB)
      ? parseSpaceSeparatedAttributes(attributesText)
      : parseDelimitedAttributes(attributesText, delimiter);

  return {
    version,
    vendor: header[0]!,
    product: header[1]!,
    productVersion: header[2]!,
    eventId: header[3]!,
    delimiter,
    attributes,
  };
}

export default {
  findLeefStart,
  parseLeef,
  readLeefDelimiter,
};
