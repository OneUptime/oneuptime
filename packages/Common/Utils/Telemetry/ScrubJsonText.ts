import ScrubNestedValuesUtil from "./ScrubNestedValues";

/*
 * A PATTERN RULE OVER THE JSON TEXT OF A LIST OR A MAP: IT STAYS JSON.
 *
 * Telemetry stores many texts that are JSON: a log body sent as a map or a
 * list (an OTLP key-value list or list, a Fluentd record's map) is stored as
 * its JSON text, a JSON log line is one, and so is an attribute an
 * application wrote as JSON - an AI call's messages, a request's body - or
 * one held as its JSON text because it was too large to read value by value
 * (ScrubNestedValues.ts). A pattern rule - a built-in one or a custom regex
 * (App/FeatureSet/Telemetry/Services/LogScrubRuleService.ts and
 * TraceScrubRuleService.ts) - read such a text as plain text, and replaced
 * what it found wherever it was. That went wrong two ways (#8923):
 *
 *   - The text was no longer JSON. A match right after an escape took the
 *     escape's letter with it: in `line one\nada@example.com` an address
 *     rule matched `nada@example.com`, and its replacement left
 *     `\[REDACTED]`, an escape JSON does not have. A match on a number
 *     (`"phone":5551234567`) left `[REDACTED]` where a value goes, and a
 *     custom pattern could take quotes, commas and braces with it. The Logs
 *     page then showed such a body as raw text, and anything reading it as
 *     JSON - the Kubernetes object views - could not.
 *   - What came right after an escape was not scrubbed at all. A card
 *     number, a Social Security number, a phone number and an IP address
 *     are matched as whole words, and in the JSON text one at the start of
 *     a line follows the `n` of `\n` - a letter - so `\n4111 1111 1111 1111`
 *     held no card number. Nor did an address whose @ was written as an
 *     escape hold an address.
 *
 * So a rule's pattern now reads such a text as it reads: the JSON text with
 * each string's escapes read as the characters they stand for - the text
 * the application wrote, its keys, quotes and punctuation in place, so a
 * pattern written against the JSON text (`"password":"[^"]*"`) still
 * matches it. A built-in pattern reads only that, as it reads the same text
 * sent as an attribute. A custom pattern - which a person may have written
 * against the text as it is stored, escapes and all - reads the text as it
 * is written too, as it always did, and what either reading finds is
 * scrubbed. (Read as written, a built-in pattern would find what the
 * application never wrote: `\n+1 555 123 4567` has a word boundary before
 * the +, and `11205...` ends a number at the backslash.)
 *
 * A match is then replaced inside the values it covers, and only there: the
 * part of each string - a key or a value - it covers, and each number, true,
 * false or null it touches, which becomes a string holding what the rule
 * left of it. Quotes, commas, colons, brackets and spaces are kept, so the
 * text stays JSON with the same lists and maps, and the same number of
 * values in each. A match never splits a character: one that starts inside
 * an escape or between the two halves of a surrogate pair starts after it,
 * and one that ends inside one ends after it, hiding it whole. Each part is
 * replaced by what the rule makes of the text it stands for - escapes read -
 * written back as JSON writes it.
 *
 * A string that is itself the JSON text of a list or a map - a Fluentd
 * record's `log` holding the application's JSON line, a Kubernetes object's
 * last applied configuration - is read the same way, as a JSON text of its
 * own, and stays JSON too, up to MAX_JSON_TEXTS_INSIDE_STRINGS deep.
 *
 * What a rule finds in a value it finds as it would in the same text sent
 * as an attribute, and the parts of the text no match covers are kept as
 * they were written, escapes included. A key is a text like any other: a
 * match inside it is hidden too, so two keys can come out the same.
 */

// One match, or the part of one inside one value: [start, end).
type TextRange = [number, number];

/*
 * How many JSON texts deep, each one a string of the one around it, a rule
 * reads as JSON. Each level escapes the quotes of the one inside it again,
 * so a text grows fast with every level, and real ones hold one or two.
 */
export const MAX_JSON_TEXTS_INSIDE_STRINGS: number = 4;

const QUOTE: number = 0x22;
const BACKSLASH: number = 0x5c;
const LOWER_U: number = 0x75;

// What JSON reads as space: a space, a tab, a line feed, a return.
function isJsonSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

// What sits between the values of a JSON text: punctuation and space.
function isBetweenValues(code: number): boolean {
  return (
    code === 0x7b || // {
    code === 0x7d || // }
    code === 0x5b || // [
    code === 0x5d || // ]
    code === 0x3a || // :
    code === 0x2c || // ,
    isJsonSpace(code)
  );
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/*
 * A value of the JSON text a match can cover: a string - a key or a value
 * - whose characters sit between its quotes, or a number, true, false or
 * null, all of whose characters are the value.
 */
interface JsonTextValue {
  // Where it is in the JSON text, a string's quotes included.
  start: number;
  end: number;
  // Where it is in the text as a pattern reads it.
  readableStart: number;
  readableEnd: number;
  isString: boolean;
  /*
   * A string's text as it reads, when it holds an escape: what a pattern
   * reads, and what a rule replaces a part of. Else it reads as written.
   */
  read: string | undefined;
}

/*
 * Where each character of a string's text starts - in the JSON text, and in
 * its text as it reads - and where the text ends. An escape, a surrogate
 * pair and a pair written as two escapes are each one character: a match
 * never ends or starts inside one.
 */
interface StringCharacters {
  written: Array<number>;
  read: Array<number>;
}

// The code unit an escape or a written character stands for, and the next.
function readCodeUnit(jsonText: string, at: number): [number, number] {
  const code: number = jsonText.charCodeAt(at);

  if (code !== BACKSLASH) {
    return [code, at + 1];
  }

  if (jsonText.charCodeAt(at + 1) === LOWER_U) {
    return [parseInt(jsonText.slice(at + 2, at + 6), 16), at + 6];
  }

  // \" \\ \/ \b \f \n \r \t: none stands for half of a surrogate pair.
  return [0, at + 2];
}

// The first index of a sorted list whose entry is at least `target`.
function firstAtOrAfter(sorted: Array<number>, target: number): number {
  let low: number = 0;
  let high: number = sorted.length - 1;

  while (low < high) {
    const middle: number = (low + high) >> 1;

    if (sorted[middle]! < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

/*
 * The text a pattern reads of a JSON text, and where each of its values is
 * in both. Read only from a JSON text JSON.parse takes: the text of a list
 * or a map (ScrubNestedValuesUtil.readJsonListOrMap).
 */
class JsonTextReading {
  public readonly jsonText: string;
  // The JSON text with each string's escapes read: what a pattern reads.
  public readonly readable: string;
  public readonly values: Array<JsonTextValue> = [];
  private readonly characters: Map<JsonTextValue, StringCharacters> = new Map<
    JsonTextValue,
    StringCharacters
  >();

  public constructor(jsonText: string) {
    this.jsonText = jsonText;

    const readablePieces: Array<string> = [];
    // The JSON text before this is in readablePieces already.
    let copiedUpTo: number = 0;
    // How long readablePieces are together.
    let readableLength: number = 0;
    const length: number = jsonText.length;
    let at: number = 0;

    while (at < length) {
      const code: number = jsonText.charCodeAt(at);

      if (isBetweenValues(code)) {
        at++;
        continue;
      }

      let end: number = at + 1;

      if (code !== QUOTE) {
        // A number, true, false or null: up to what comes after a value.
        while (
          end < length &&
          !isBetweenValues(jsonText.charCodeAt(end)) &&
          jsonText.charCodeAt(end) !== QUOTE
        ) {
          end++;
        }

        const readableStart: number = readableLength + (at - copiedUpTo);

        this.values.push({
          start: at,
          end: end,
          readableStart: readableStart,
          readableEnd: readableStart + (end - at),
          isString: false,
          read: undefined,
        });

        at = end;
        continue;
      }

      // A string ends at its first quote that no backslash escapes.
      let hasEscape: boolean = false;

      while (end < length) {
        const inside: number = jsonText.charCodeAt(end);

        if (inside === BACKSLASH) {
          hasEscape = true;
          end += 2;
        } else if (inside === QUOTE) {
          break;
        } else {
          end++;
        }
      }

      end = Math.min(end + 1, length);

      if (!hasEscape) {
        const readableStart: number = readableLength + (at - copiedUpTo);

        this.values.push({
          start: at,
          end: end,
          readableStart: readableStart,
          readableEnd: readableStart + (end - at),
          isString: true,
          read: undefined,
        });
      } else {
        // Everything up to its opening quote, as it is.
        readablePieces.push(jsonText.slice(copiedUpTo, at + 1));
        readableLength += at + 1 - copiedUpTo;

        const read: string = JSON.parse(jsonText.slice(at, end)) as string;
        const readableStart: number = readableLength - 1;

        readablePieces.push(read, '"');
        readableLength += read.length + 1;
        copiedUpTo = end;

        this.values.push({
          start: at,
          end: end,
          readableStart: readableStart,
          readableEnd: readableLength,
          isString: true,
          read: read,
        });
      }

      at = end;
    }

    if (copiedUpTo === 0) {
      this.readable = jsonText;
    } else {
      readablePieces.push(jsonText.slice(copiedUpTo));
      this.readable = readablePieces.join("");
    }
  }

  // A string's text as it reads: what a pattern and a rule read of it.
  public textOf(value: JsonTextValue): string {
    return value.read !== undefined
      ? value.read
      : this.jsonText.slice(value.start + 1, value.end - 1);
  }

  /*
   * Where a position of the readable text is in the JSON text: inside a
   * string's text, at the start of the character it falls in, or after it
   * when it falls inside one (a surrogate pair).
   */
  public toWritten(readablePosition: number): number {
    const value: JsonTextValue | undefined = this.valueAt(
      readablePosition,
      true,
    );

    // Before the first value, both texts are the same.
    if (value === undefined) {
      return readablePosition;
    }

    // Punctuation and spaces after the value are written as they read.
    if (readablePosition >= value.readableEnd) {
      return value.end + (readablePosition - value.readableEnd);
    }

    const offset: number = readablePosition - value.readableStart;

    // A number, true, false or null reads as it is written.
    if (!value.isString || offset === 0) {
      return value.start + offset;
    }

    // The closing quote.
    if (readablePosition === value.readableEnd - 1) {
      return value.end - 1;
    }

    if (value.read === undefined) {
      return this.afterSplitPair(value.start + offset, value);
    }

    // The character the position falls in, or the one after it.
    const characters: StringCharacters = this.charactersOf(value);

    return characters.written[firstAtOrAfter(characters.read, offset - 1)]!;
  }

  /*
   * A position of the JSON text, moved on past the character it falls
   * inside - an escape, a surrogate pair - when it falls inside one.
   */
  public toCharacterStart(writtenPosition: number): number {
    const value: JsonTextValue | undefined = this.valueAt(
      writtenPosition,
      false,
    );

    if (
      value === undefined ||
      !value.isString ||
      writtenPosition <= value.start + 1 ||
      writtenPosition >= value.end - 1
    ) {
      return writtenPosition;
    }

    if (value.read === undefined) {
      return this.afterSplitPair(writtenPosition, value);
    }

    const characters: StringCharacters = this.charactersOf(value);

    return characters.written[
      firstAtOrAfter(characters.written, writtenPosition)
    ]!;
  }

  /*
   * Where a character start of a string's text, in the JSON text, is in the
   * string's text as it reads.
   */
  public toOffsetInText(value: JsonTextValue, writtenPosition: number): number {
    if (value.read === undefined) {
      return writtenPosition - (value.start + 1);
    }

    const characters: StringCharacters = this.charactersOf(value);

    return characters.read[
      firstAtOrAfter(characters.written, writtenPosition)
    ]!;
  }

  // A position between the halves of a pair written as it is moves on one.
  private afterSplitPair(position: number, value: JsonTextValue): number {
    if (
      position > value.start + 1 &&
      position < value.end - 1 &&
      isHighSurrogate(this.jsonText.charCodeAt(position - 1)) &&
      isLowSurrogate(this.jsonText.charCodeAt(position))
    ) {
      return position + 1;
    }

    return position;
  }

  /*
   * The last value starting at or before a position (of the readable text,
   * or of the JSON text): the one it falls in, or the one before the
   * punctuation it falls in.
   */
  private valueAt(
    position: number,
    readable: boolean,
  ): JsonTextValue | undefined {
    let low: number = 0;
    let high: number = this.values.length - 1;
    let found: JsonTextValue | undefined = undefined;

    while (low <= high) {
      const middle: number = (low + high) >> 1;
      const value: JsonTextValue = this.values[middle]!;
      const start: number = readable ? value.readableStart : value.start;

      if (start <= position) {
        found = value;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return found;
  }

  /*
   * Where each character of a string's text starts, from the opening
   * quote's next: worked out the first time a match ends or starts in it.
   */
  private charactersOf(value: JsonTextValue): StringCharacters {
    const known: StringCharacters | undefined = this.characters.get(value);

    if (known !== undefined) {
      return known;
    }

    const written: Array<number> = [];
    const read: Array<number> = [];
    const textEnd: number = value.end - 1;
    let at: number = value.start + 1;
    let readOffset: number = 0;

    while (at < textEnd) {
      written.push(at);
      read.push(readOffset);

      const [code, next] = readCodeUnit(this.jsonText, at);

      if (isHighSurrogate(code) && next < textEnd) {
        const [low, afterLow] = readCodeUnit(this.jsonText, next);

        if (isLowSurrogate(low)) {
          at = afterLow;
          readOffset += 2;
          continue;
        }
      }

      at = next;
      readOffset += 1;
    }

    written.push(textEnd);
    read.push(readOffset);

    const characters: StringCharacters = { written: written, read: read };

    this.characters.set(value, characters);

    return characters;
  }
}

/*
 * Sorted lists of matches as one: matches that overlap become one, matches
 * that only touch stay two - each is replaced, as two matches side by side
 * always were. Empty ones are left out: a match of no text hides nothing,
 * and a pattern that matches none is refused when it is saved.
 */
function mergeMatches(lists: Array<Array<TextRange>>): Array<TextRange> {
  const all: Array<TextRange> = ([] as Array<TextRange>)
    .concat(...lists)
    .filter((range: TextRange): boolean => {
      return range[1] > range[0];
    })
    .sort((a: TextRange, b: TextRange): number => {
      return a[0] - b[0] || a[1] - b[1];
    });
  const merged: Array<TextRange> = [];

  for (const range of all) {
    const last: TextRange | undefined = merged[merged.length - 1];

    if (last !== undefined && range[0] < last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }

  return merged;
}

// A text as it is written inside a JSON string.
function toJsonStringText(text: string): string {
  const written: string = JSON.stringify(text);

  return written.slice(1, written.length - 1);
}

interface ScrubJsonTextRule {
  findMatches: (text: string) => Array<TextRange>;
  replaceMatch: (matchedText: string) => string;
  // A custom pattern, which reads a text as it is written too.
  readsAsWritten: boolean;
  jsonTexts: ScrubJsonTexts;
}

/*
 * One rule over a JSON text, `depth` JSON texts inside the one it was
 * handed. `alreadyMatched`: for a string of a JSON text, the matches the
 * text around it found in it - in this text as it is written, which is
 * what the text around it reads of the string - so that reading is not
 * asked again.
 */
function scrubJsonTextAt(data: {
  jsonText: string;
  rule: ScrubJsonTextRule;
  depth: number;
  alreadyMatched: Array<TextRange> | null;
}): string {
  const jsonText: string = data.jsonText;
  const rule: ScrubJsonTextRule = data.rule;
  const hasEscape: boolean = jsonText.indexOf("\\") !== -1;
  /*
   * The matches in the text as it is written. Without an escape that is
   * the text as it reads too. With one, a built-in pattern does not read
   * it so: what it would find there the application never wrote.
   */
  let asWritten: Array<TextRange> = [];

  if (!hasEscape || rule.readsAsWritten) {
    asWritten =
      data.alreadyMatched !== null
        ? data.alreadyMatched
        : rule.findMatches(jsonText);
  }

  /*
   * Without an escape the text reads as it is written, and so does every
   * string in it: nothing more to find, and nothing to replace without a
   * match.
   */
  if (!hasEscape && asWritten.length === 0) {
    return jsonText;
  }

  const reading: JsonTextReading = new JsonTextReading(jsonText);
  const asRead: Array<TextRange> = hasEscape
    ? rule.findMatches(reading.readable)
    : [];
  const matches: Array<TextRange> = mergeMatches([
    asRead.map((match: TextRange): TextRange => {
      return [reading.toWritten(match[0]), reading.toWritten(match[1])];
    }),
    asWritten.map((match: TextRange): TextRange => {
      return [
        reading.toCharacterStart(match[0]),
        reading.toCharacterStart(match[1]),
      ];
    }),
  ]);

  return rewriteValues(reading, matches, rule, data.depth);
}

/*
 * The text of a string that is read as a JSON text of its own - the JSON
 * text of a list or a map, not too deep - or null. Only a string a match
 * reaches into, or whose text holds an escape of its own, is asked: in any
 * other the text around it read every character as this one would.
 */
function jsonTextInside(
  reading: JsonTextReading,
  value: JsonTextValue,
  hasParts: boolean,
  rule: ScrubJsonTextRule,
  depth: number,
): string | null {
  if (
    !value.isString ||
    depth >= MAX_JSON_TEXTS_INSIDE_STRINGS ||
    !(hasParts || (value.read !== undefined && value.read.indexOf("\\") !== -1))
  ) {
    return null;
  }

  const text: string = reading.textOf(value);

  return rule.jsonTexts.isJsonListOrMap(text) ? text : null;
}

/*
 * The JSON text with each match - ranges of the JSON text, none splitting
 * a character - replaced inside the values it covers, and each string that
 * is a JSON text of its own scrubbed as one.
 */
function rewriteValues(
  reading: JsonTextReading,
  matches: Array<TextRange>,
  rule: ScrubJsonTextRule,
  depth: number,
): string {
  const jsonText: string = reading.jsonText;
  const pieces: Array<string> = [];
  // The JSON text before this is in pieces already.
  let copiedUpTo: number = 0;
  let matchIndex: number = 0;

  for (const value of reading.values) {
    // A string's text sits between its quotes, which stay.
    const textStart: number = value.isString ? value.start + 1 : value.start;
    const textEnd: number = value.isString ? value.end - 1 : value.end;
    const parts: Array<TextRange> = [];

    // The matches that end before this value are behind it for good.
    while (
      matchIndex < matches.length &&
      matches[matchIndex]![1] <= textStart
    ) {
      matchIndex++;
    }

    for (
      let index: number = matchIndex;
      index < matches.length && matches[index]![0] < textEnd;
      index++
    ) {
      const partStart: number = Math.max(matches[index]![0], textStart);
      const partEnd: number = Math.min(matches[index]![1], textEnd);

      if (partEnd > partStart) {
        parts.push([partStart, partEnd]);
      }
    }

    const inside: string | null = jsonTextInside(
      reading,
      value,
      parts.length > 0,
      rule,
      depth,
    );

    if (inside !== null) {
      const scrubbed: string = scrubJsonTextAt({
        jsonText: inside,
        rule: rule,
        depth: depth + 1,
        alreadyMatched: parts.map((part: TextRange): TextRange => {
          return [
            reading.toOffsetInText(value, part[0]),
            reading.toOffsetInText(value, part[1]),
          ];
        }),
      });

      if (scrubbed !== inside) {
        rule.jsonTexts.rememberJson(scrubbed);
        pieces.push(
          jsonText.slice(copiedUpTo, textStart),
          toJsonStringText(scrubbed),
        );
        copiedUpTo = textEnd;
      }

      continue;
    }

    if (parts.length === 0) {
      continue;
    }

    // Each part replaced by what the rule makes of the text it stands for.
    const replaced: Array<string> = [];
    let resumesAt: number = textStart;

    for (const [partStart, partEnd] of parts) {
      const writtenPart: string = jsonText.slice(partStart, partEnd);
      const partText: string =
        value.read !== undefined
          ? (JSON.parse('"' + writtenPart + '"') as string)
          : writtenPart;

      replaced.push(
        jsonText.slice(resumesAt, partStart),
        toJsonStringText(rule.replaceMatch(partText)),
      );
      resumesAt = partEnd;
    }

    replaced.push(jsonText.slice(resumesAt, textEnd));

    /*
     * Written back between its quotes. A number, true, false or null
     * becomes a string of what is left of it: its characters - digits,
     * letters, . + and - - need no escape.
     */
    pieces.push(
      jsonText.slice(copiedUpTo, value.start),
      '"' + replaced.join("") + '"',
    );
    copiedUpTo = value.end;
  }

  if (pieces.length === 0) {
    return jsonText;
  }

  pieces.push(jsonText.slice(copiedUpTo));

  return pieces.join("");
}

/*
 * Which texts of one record are the JSON text of a list or a map, each
 * worked out once however many rules read it: a record's rules run one
 * after another over the same texts, and a text a rule rewrote as JSON is
 * JSON. One for each record, and dropped with it.
 */
export class ScrubJsonTexts {
  private readonly known: Map<string, boolean> = new Map<string, boolean>();

  public isJsonListOrMap(text: string): boolean {
    if (!ScrubJsonTextUtil.mayBeJsonListOrMap(text)) {
      return false;
    }

    const known: boolean | undefined = this.known.get(text);

    if (known !== undefined) {
      return known;
    }

    const isJson: boolean =
      ScrubNestedValuesUtil.readJsonListOrMap(text) !== null;

    this.known.set(text, isJson);

    return isJson;
  }

  // A text scrubJsonText wrote: JSON, as the text it was made from.
  public rememberJson(text: string): void {
    this.known.set(text, true);
  }
}

export default class ScrubJsonTextUtil {
  /*
   * Whether a text may be the JSON text of a list or a map: its first
   * character past JSON's spaces opens one. Cheap, and a text it says no
   * to is not one; readJsonListOrMap says for sure.
   */
  public static mayBeJsonListOrMap(text: string): boolean {
    for (let at: number = 0; at < text.length; at++) {
      const code: number = text.charCodeAt(at);

      if (!isJsonSpace(code)) {
        return code === 0x7b || code === 0x5b;
      }
    }

    return false;
  }

  /*
   * One pattern rule over the JSON text of a list or a map - the caller
   * made sure it is one (ScrubNestedValuesUtil.readJsonListOrMap) - kept
   * JSON, as the module comment says. `findMatches` answers where the
   * rule's pattern matches a text (ScrubRegExp.matchRanges); it is asked
   * about the text as it reads and, for a custom pattern
   * (`readsAsWritten`), as it is written too. `replaceMatch` makes the
   * rule's replacement of the text a match covers in one value. The very
   * text comes back when nothing matched.
   */
  public static scrubJsonText(data: {
    jsonText: string;
    findMatches: (text: string) => Array<TextRange>;
    replaceMatch: (matchedText: string) => string;
    readsAsWritten: boolean;
    jsonTexts?: ScrubJsonTexts | undefined;
  }): string {
    return scrubJsonTextAt({
      jsonText: data.jsonText,
      rule: {
        findMatches: data.findMatches,
        replaceMatch: data.replaceMatch,
        readsAsWritten: data.readsAsWritten,
        jsonTexts: data.jsonTexts || new ScrubJsonTexts(),
      },
      depth: 0,
      alreadyMatched: null,
    });
  }

  /*
   * One pattern rule over one text a record stores: the JSON text of a
   * list or a map as scrubJsonText scrubs it, kept JSON, and any other text
   * with each match replaced, as ScrubRegExp.replace does. `jsonTexts` is
   * the record's (ScrubJsonTexts).
   */
  public static scrubText(data: {
    text: string;
    findMatches: (text: string) => Array<TextRange>;
    replaceMatch: (matchedText: string) => string;
    readsAsWritten: boolean;
    jsonTexts: ScrubJsonTexts;
  }): string {
    const text: string = data.text;

    if (data.jsonTexts.isJsonListOrMap(text)) {
      const scrubbed: string = ScrubJsonTextUtil.scrubJsonText({
        jsonText: text,
        findMatches: data.findMatches,
        replaceMatch: data.replaceMatch,
        readsAsWritten: data.readsAsWritten,
        jsonTexts: data.jsonTexts,
      });

      data.jsonTexts.rememberJson(scrubbed);

      return scrubbed;
    }

    const matches: Array<TextRange> = data.findMatches(text);

    if (matches.length === 0) {
      return text;
    }

    const pieces: Array<string> = [];
    let copiedUpTo: number = 0;

    for (const [start, end] of matches) {
      pieces.push(
        text.slice(copiedUpTo, start),
        data.replaceMatch(text.slice(start, end)),
      );
      copiedUpTo = end;
    }

    pieces.push(text.slice(copiedUpTo));

    return pieces.join("");
  }
}
