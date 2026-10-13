/*
 * Common Event Format (CEF) reader.
 *
 * CEF is the line format security products and controllers export events
 * in - UniFi Network, MikroTik RouterOS (from 7.18), FortiGate when asked:
 *
 *   CEF:0|Ubiquiti|UniFi Network|9.3.33|401|WiFi Client Disconnected|2|UNIFIcategory=Monitoring UNIFIhost=Office UDM Pro msg=Apple Watch disconnected.
 *
 * Seven header fields between pipes - format version, device vendor,
 * device product, device version, event class id, name, severity - and
 * then the extension: key=value pairs separated by spaces.
 *
 * The rules, each pinned by CefParser.test.ts:
 *
 *   - The message starts at "CEF:" and a number, at the start of the
 *     line, after a space or right after a syslog priority ("<134>CEF:0|").
 *     Whatever comes before it (a syslog header, a host name) is not part
 *     of it.
 *   - In the header, a pipe inside a field is written "\|" and a backslash
 *     "\\". The seventh pipe and the extension may be missing.
 *   - In the extension a value runs up to the next " key=", so it may hold
 *     spaces without quotes ("UNIFIhost=Office UDM Pro"). An equals sign
 *     inside a value is written "\=", a backslash "\\", a line break "\n"
 *     or "\r".
 *   - Values are always text. A key that repeats keeps its FIRST value,
 *     the rule the key=value parser follows.
 *
 * This runs on text whoever can reach the syslog port controls, once per
 * message. Every dimension is bounded - the input, the number of pairs,
 * the length of a key and of a value - and the walk is a single pass with
 * no regular expression over the message.
 */

/** Longest message that is parsed. The key=value parser's ceiling. */
export const MAX_CEF_INPUT_LENGTH: number = 32768;

/** Most extension pairs one message may add. */
export const MAX_CEF_EXTENSIONS: number = 100;

/** Longest extension key that is kept. Longer ones are skipped. */
export const MAX_CEF_KEY_LENGTH: number = 256;

/** Longest value that is kept whole. Longer ones are truncated. */
export const MAX_CEF_VALUE_LENGTH: number = 4096;

/** How far into a line "CEF:" is looked for (past a syslog header). */
export const MAX_CEF_PREFIX_LENGTH: number = 512;

const CEF_MARKER: string = "CEF:";

const HEADER_FIELD_COUNT: number = 7;

export interface ParsedCef {
  // The format's own version: "0" or "1".
  version: string;
  deviceVendor: string;
  deviceProduct: string;
  deviceVersion: string;
  deviceEventClassId: string;
  name: string;
  // As sent: a number from 0 to 10, or a word such as "High".
  severity: string;
  // The extension's pairs, in the order they appear.
  extensions: Record<string, string>;
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

/*
 * A character an extension key may hold: letters, digits and the few signs
 * vendors use in keys (cs1Label, ad.field, UNIFIhost, device_id).
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
 * Where a CEF message starts in a line, or -1 when the line holds none:
 * "CEF:", a number and a pipe, at the start, after a space or after a
 * syslog priority, within the first MAX_CEF_PREFIX_LENGTH characters.
 */
export function findCefStart(text: unknown): number {
  if (typeof text !== "string" || text.length === 0) {
    return -1;
  }

  let from: number = 0;

  while (from <= MAX_CEF_PREFIX_LENGTH) {
    const at: number = text.indexOf(CEF_MARKER, from);

    if (at === -1 || at > MAX_CEF_PREFIX_LENGTH) {
      return -1;
    }

    const before: string = at === 0 ? "" : text.charAt(at - 1);
    const isAtWordStart: boolean =
      at === 0 || isWhitespace(before) || before === ">";
    let index: number = at + CEF_MARKER.length;
    const firstDigit: number = index;

    while (index < text.length && isDigit(text.charAt(index))) {
      index++;
    }

    if (
      isAtWordStart &&
      index > firstDigit &&
      index - firstDigit <= 2 &&
      text.charAt(index) === "|"
    ) {
      return at;
    }

    from = at + CEF_MARKER.length;
  }

  return -1;
}

function capValue(value: string): string {
  if (value.length <= MAX_CEF_VALUE_LENGTH) {
    return value;
  }

  let end: number = MAX_CEF_VALUE_LENGTH;

  // Never end on the first half of a surrogate pair.
  const lastCharCode: number = value.charCodeAt(end - 1);

  if (lastCharCode >= 0xd800 && lastCharCode <= 0xdbff) {
    end -= 1;
  }

  return value.slice(0, end);
}

/*
 * A header field as it was meant: "\|" is a pipe and "\\" a backslash.
 * Any other backslash is kept as written.
 */
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

// An extension value as it was meant: "\=", "\\", "\|", "\n" and "\r".
function unescapeExtensionValue(value: string): string {
  if (!value.includes("\\")) {
    return value;
  }

  let output: string = "";

  for (let index: number = 0; index < value.length; index++) {
    const character: string = value.charAt(index);

    if (character === "\\" && index + 1 < value.length) {
      const next: string = value.charAt(index + 1);

      if (next === "=" || next === "\\" || next === "|") {
        output += next;
        index++;
        continue;
      }

      if (next === "n") {
        output += "\n";
        index++;
        continue;
      }

      if (next === "r") {
        output += "\r";
        index++;
        continue;
      }
    }

    output += character;
  }

  return output;
}

interface ExtensionKey {
  key: string;
  keyStart: number;
  valueStart: number;
}

/*
 * Where each pair of an extension starts: a run of key characters at the
 * start of the text or after whitespace, followed by "=". One forward
 * pass; an equals sign a value escaped ("\=") never follows a key
 * character, so it is not taken for one.
 */
function findExtensionKeys(extension: string): Array<ExtensionKey> {
  const keys: Array<ExtensionKey> = [];
  const length: number = extension.length;
  let index: number = 0;

  while (index < length) {
    const isAtWordStart: boolean =
      index === 0 || isWhitespace(extension.charAt(index - 1));

    if (!isAtWordStart || !isKeyCharacter(extension.charAt(index))) {
      index++;
      continue;
    }

    let end: number = index;

    while (end < length && isKeyCharacter(extension.charAt(end))) {
      end++;
    }

    if (extension.charAt(end) === "=") {
      keys.push({
        key: extension.slice(index, end),
        keyStart: index,
        valueStart: end + 1,
      });
      index = end + 1;
      continue;
    }

    // A word of the value before it, not a key.
    index = end > index ? end : index + 1;
  }

  return keys;
}

function parseExtensions(extension: string): Record<string, string> {
  const result: Record<string, string> = {};
  const keys: Array<ExtensionKey> = findExtensionKeys(extension);
  let pairCount: number = 0;

  for (let at: number = 0; at < keys.length; at++) {
    if (pairCount >= MAX_CEF_EXTENSIONS) {
      break;
    }

    const current: ExtensionKey = keys[at]!;
    const next: ExtensionKey | undefined = keys[at + 1];
    const valueEnd: number = next ? next.keyStart : extension.length;

    /*
     * The result is a plain object, merged into a log's attributes:
     * "__proto__" would replace a prototype instead of naming a field.
     */
    if (
      current.key.length > MAX_CEF_KEY_LENGTH ||
      current.key === "__proto__"
    ) {
      continue;
    }

    // First value wins - a later duplicate never replaces it.
    if (Object.prototype.hasOwnProperty.call(result, current.key)) {
      continue;
    }

    const rawValue: string = extension
      .slice(current.valueStart, valueEnd)
      .trim();

    result[current.key] = capValue(unescapeExtensionValue(rawValue));
    pairCount++;
  }

  return result;
}

/*
 * Reads the CEF message in a line, or returns null when the line holds
 * none or it is not complete (fewer than the seven header fields). Never
 * throws.
 */
export function parseCef(text: unknown): ParsedCef | null {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }

  const start: number = findCefStart(text);

  if (start === -1) {
    return null;
  }

  const message: string = text.slice(start, start + MAX_CEF_INPUT_LENGTH);

  // The header: seven fields, split at pipes that are not escaped.
  const fields: Array<string> = [];
  let fieldStart: number = CEF_MARKER.length;
  let index: number = fieldStart;
  let extensionStart: number = -1;

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

      if (fields.length === HEADER_FIELD_COUNT) {
        extensionStart = index + 1;
        break;
      }
    }

    index++;
  }

  // No seventh pipe: the severity is the rest of the line, with no extension.
  if (fields.length === HEADER_FIELD_COUNT - 1 && extensionStart === -1) {
    fields.push(message.slice(fieldStart));
  }

  if (fields.length < HEADER_FIELD_COUNT) {
    return null;
  }

  const header: Array<string> = fields.map((field: string): string => {
    return capValue(unescapeHeaderField(field).trim());
  });

  return {
    version: header[0]!,
    deviceVendor: header[1]!,
    deviceProduct: header[2]!,
    deviceVersion: header[3]!,
    deviceEventClassId: header[4]!,
    name: header[5]!,
    severity: header[6]!,
    extensions:
      extensionStart === -1 ? {} : parseExtensions(message.slice(extensionStart)),
  };
}

const NUMERIC_SEVERITY: RegExp = /^\d{1,2}$/;

/*
 * A CEF severity as a syslog one (0 emergency ... 7 debug), for a message
 * that came without a syslog priority; undefined when it says nothing
 * usable. CEF counts the other way: 0-3 is low, 4-6 medium, 7-8 high and
 * 9-10 very high, or the same four as words.
 */
export function cefSeverityToSyslogSeverity(
  severity: unknown,
): number | undefined {
  if (typeof severity !== "string") {
    return undefined;
  }

  const value: string = severity.trim().toLowerCase();

  if (NUMERIC_SEVERITY.test(value)) {
    const level: number = parseInt(value, 10);

    if (level > 10) {
      return undefined;
    }

    if (level <= 3) {
      return 6;
    }

    if (level <= 6) {
      return 4;
    }

    if (level <= 8) {
      return 3;
    }

    return 2;
  }

  switch (value) {
    case "low":
      return 6;
    case "medium":
      return 4;
    case "high":
      return 3;
    case "very-high":
    case "very high":
      return 2;
    default:
      return undefined;
  }
}

export default {
  findCefStart,
  parseCef,
  cefSeverityToSyslogSeverity,
};
