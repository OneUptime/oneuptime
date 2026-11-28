import { TextRange } from "../DataSecurity/TextReadings";
import ScrubNestedValuesUtil, {
  SCRUB_MAX_VALUE_DEPTH,
} from "./ScrubNestedValues";

/*
 * A LIST OR A MAP AS THE TABLE STORES IT, AND WHERE EACH OF ITS TEXTS IS IN
 * THAT JSON TEXT (#11383).
 *
 * A record's attributes are stored as texts, a list or a map as its JSON
 * text (ScrubNestedValues), and Data Security reads such a value as that
 * one text (Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner). So
 * the key a map writes before its value is a word right beside it, and a
 * word another of its texts writes is near it too: a contact written as
 * [{"system":"phone","value":"02012345678"}] holds a phone number to Data
 * Security. A scrub rule reads a list or a map text by text, to keep its
 * shape, and so read none of those words. A rule whose type is found by
 * the words around a value reads the value's JSON text too
 * (Utils/Telemetry/ScrubBuiltInPatterns), and what it finds there is
 * placed back on the texts that hold it, here.
 *
 * The JSON text is the one JSON.stringify writes: a list's items in order,
 * a map's keys in Object.keys order with what JSON leaves out left out (a
 * key whose value is undefined, a function), anything else - a number, a
 * date - as JSON writes it. In time in line with the value's size, and only
 * as deep as a rule reads a value (SCRUB_MAX_VALUE_DEPTH).
 *
 * Its numbers are kept with where JSON wrote them too (#11500): a phone
 * number sent as a number in [{"system":"phone","value":2012345678}], or
 * an SSN in [536221234] under `customer.ssn`, is one to Data Security,
 * which reads that same text. What a rule finds there on a number's
 * characters is placed on that number, and the rule writes its text in the
 * number's place, as it does for a number alone under its key.
 */

// One text of a list or a map, and where its characters are in the JSON text.
export interface StoredTextString {
  text: string;
  // Between its quotes: [start, end) of the JSON text.
  start: number;
  end: number;
  // A map's key, which a rule never changes.
  isKey: boolean;
}

// One number of a list or a map, and where JSON wrote it in the JSON text (#11500).
export interface StoredTextNumber {
  // As JSON wrote it, which is how the table stores it and Data Security reads it.
  text: string;
  // [start, end) of the JSON text.
  start: number;
  end: number;
}

export interface StoredText {
  text: string;
  // Every text of the value, keys among them, in the order the JSON text writes them.
  strings: Array<StoredTextString>;
  // Every finite number of the value, in the order the JSON text writes them (#11500).
  numbers: Array<StoredTextNumber>;
}

// A value JSON writes nothing for in a map, and null for in a list.
function isLeftOutByJson(value: unknown): boolean {
  return (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  );
}

class StoredTextWriter {
  public readonly strings: Array<StoredTextString> = [];
  public readonly numbers: Array<StoredTextNumber> = [];
  private readonly pieces: Array<string> = [];
  private length: number = 0;

  public get text(): string {
    return this.pieces.join("");
  }

  private push(piece: string): void {
    this.pieces.push(piece);
    this.length += piece.length;
  }

  private writeString(text: string, isKey: boolean): void {
    const written: string = JSON.stringify(text);

    this.strings.push({
      text,
      start: this.length + 1,
      end: this.length + written.length - 1,
      isKey,
    });
    this.push(written);
  }

  // False for a value deeper than a rule reads: the text is not written.
  public write(value: unknown, depth: number): boolean {
    if (typeof value === "string") {
      this.writeString(value, false);
      return true;
    }

    if (!ScrubNestedValuesUtil.isNested(value)) {
      const written: string | undefined = JSON.stringify(value);

      // A number JSON writes as one: NaN and Infinity it writes as null.
      if (typeof value === "number" && Number.isFinite(value) && written) {
        this.numbers.push({
          text: written,
          start: this.length,
          end: this.length + written.length,
        });
      }

      this.push(written === undefined ? "null" : written);
      return true;
    }

    if (depth >= SCRUB_MAX_VALUE_DEPTH) {
      return false;
    }

    if (Array.isArray(value)) {
      this.push("[");

      for (let index: number = 0; index < value.length; index++) {
        if (index > 0) {
          this.push(",");
        }

        const item: unknown = value[index];

        if (isLeftOutByJson(item)) {
          this.push("null");
        } else if (!this.write(item, depth + 1)) {
          return false;
        }
      }

      this.push("]");
      return true;
    }

    const map: Record<string, unknown> = value as Record<string, unknown>;
    let isFirst: boolean = true;

    this.push("{");

    for (const key of Object.keys(map)) {
      const item: unknown = map[key];

      if (isLeftOutByJson(item)) {
        continue;
      }

      if (!isFirst) {
        this.push(",");
      }

      isFirst = false;
      this.writeString(key, true);
      this.push(":");

      if (!this.write(item, depth + 1)) {
        return false;
      }
    }

    this.push("}");
    return true;
  }
}

/*
 * A list's or a map's JSON text, and where each of its texts is in it - or
 * null for any other value, one JSON cannot write (a bigint), or one
 * deeper than a rule reads value by value.
 */
export function readStoredText(value: unknown): StoredText | null {
  if (!ScrubNestedValuesUtil.isNested(value)) {
    return null;
  }

  const writer: StoredTextWriter = new StoredTextWriter();

  try {
    if (!writer.write(value, 0)) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    text: writer.text,
    strings: writer.strings,
    numbers: writer.numbers,
  };
}

const QUOTE: number = 0x22;
const BACKSLASH: number = 0x5c;
const SHORT_ESCAPES: ReadonlySet<number> = new Set([
  0x08, 0x09, 0x0a, 0x0c, 0x0d,
]);

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/*
 * Where JSON writes each code unit of a text, counted from its opening
 * quote's next character, and where the text ends: a quote and a
 * backslash take two characters (\" \\), a control character two or six
 * (\n, \u0001), half of a surrogate pair one, a lone one six (\ud800), any
 * other one. Null when they do not add up to what JSON.stringify wrote, so
 * no position is ever guessed.
 */
function writtenStartsOf(text: string): Array<number> | null {
  const starts: Array<number> = [];
  let written: number = 0;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    let length: number = 1;

    if (code === QUOTE || code === BACKSLASH) {
      length = 2;
    } else if (code < 0x20) {
      length = SHORT_ESCAPES.has(code) ? 2 : 6;
    } else if (isHighSurrogate(code)) {
      length = isLowSurrogate(text.charCodeAt(index + 1)) ? 1 : 6;
    } else if (isLowSurrogate(code)) {
      length = isHighSurrogate(text.charCodeAt(index - 1)) ? 1 : 6;
    }

    starts.push(written);
    written += length;
  }

  starts.push(written);

  return written + 2 === JSON.stringify(text).length ? starts : null;
}

/*
 * Where a position of a text's JSON form, counted from its opening quote's
 * next character, is in the text: null when it falls inside an escape.
 */
function offsetInText(
  writtenStarts: ReadonlyArray<number>,
  writtenOffset: number,
): number | null {
  let low: number = 0;
  let high: number = writtenStarts.length - 1;

  while (low <= high) {
    const middle: number = (low + high) >> 1;
    const start: number = writtenStarts[middle]!;

    if (start === writtenOffset) {
      return middle;
    }

    if (start < writtenOffset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return null;
}

// The first text whose characters end after a position, by its end.
function firstStringEndingAfter(
  strings: ReadonlyArray<StoredTextString>,
  position: number,
): number {
  let low: number = 0;
  let high: number = strings.length;

  while (low < high) {
    const middle: number = (low + high) >> 1;

    if (strings[middle]!.end <= position) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

/*
 * Ranges of the JSON text placed on the texts of the value they cover, by
 * each text: [start, end) of the text as the list or the map holds it. A
 * range across a key and its value - a pattern written against the JSON
 * text, `"api_key":"..."`, or one whose words sit in the key, `"cvv":"123"`
 * (#11502) - is placed on the part of each value's text it covers: a rule
 * changes no key of a list or a map. A number's ranges are placed on it
 * apart (placeRangesOnNumbers, #11500). A part that starts or ends inside
 * an escape is left out.
 */
export function placeRangesOnStrings(
  stored: StoredText,
  ranges: ReadonlyArray<TextRange>,
): Map<string, Array<TextRange>> {
  const placed: Map<string, Array<TextRange>> = new Map<
    string,
    Array<TextRange>
  >();
  const writtenStarts: Map<StoredTextString, Array<number> | null> = new Map<
    StoredTextString,
    Array<number> | null
  >();

  for (const [start, end] of ranges) {
    if (end <= start) {
      continue;
    }

    for (
      let index: number = firstStringEndingAfter(stored.strings, start);
      index < stored.strings.length && stored.strings[index]!.start < end;
      index++
    ) {
      const holder: StoredTextString = stored.strings[index]!;

      if (holder.isKey) {
        continue;
      }

      let textStart: number = Math.max(start, holder.start) - holder.start;
      let textEnd: number = Math.min(end, holder.end) - holder.start;

      if (textEnd <= textStart) {
        continue;
      }

      // Written with an escape: its positions are read one character at a time.
      if (holder.end - holder.start !== holder.text.length) {
        if (!writtenStarts.has(holder)) {
          writtenStarts.set(holder, writtenStartsOf(holder.text));
        }

        const starts: Array<number> | null | undefined =
          writtenStarts.get(holder);
        const readStart: number | null = starts
          ? offsetInText(starts, textStart)
          : null;
        const readEnd: number | null = starts
          ? offsetInText(starts, textEnd)
          : null;

        if (readStart === null || readEnd === null || readEnd <= readStart) {
          continue;
        }

        textStart = readStart;
        textEnd = readEnd;
      }

      const known: Array<TextRange> = placed.get(holder.text) || [];

      known.push([textStart, textEnd]);
      placed.set(holder.text, known);
    }
  }

  return placed;
}

// The first number whose characters end after a position, by its end.
function firstNumberEndingAfter(
  numbers: ReadonlyArray<StoredTextNumber>,
  position: number,
): number {
  let low: number = 0;
  let high: number = numbers.length;

  while (low < high) {
    const middle: number = (low + high) >> 1;

    if (numbers[middle]!.end <= position) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

/*
 * Ranges of the JSON text placed on the numbers of the value they cover
 * (#11500), by each number as JSON writes it: [start, end) of that text.
 * A range that covers part of a number - a coordinate's "-" before it, a
 * pair of coordinates across two numbers and the comma between them - is
 * placed on the part of each number it covers, so a number a rule hides is
 * hidden whatever the range holds around it. What no number holds is left
 * out: placeRangesOnStrings places the rest.
 */
export function placeRangesOnNumbers(
  stored: StoredText,
  ranges: ReadonlyArray<TextRange>,
): Map<string, Array<TextRange>> {
  const placed: Map<string, Array<TextRange>> = new Map<
    string,
    Array<TextRange>
  >();

  for (const [start, end] of ranges) {
    for (
      let index: number = firstNumberEndingAfter(stored.numbers, start);
      index < stored.numbers.length && stored.numbers[index]!.start < end;
      index++
    ) {
      const number: StoredTextNumber = stored.numbers[index]!;
      const from: number = Math.max(start, number.start) - number.start;
      const to: number = Math.min(end, number.end) - number.start;

      if (to <= from) {
        continue;
      }

      const known: Array<TextRange> = placed.get(number.text) || [];

      known.push([from, to]);
      placed.set(number.text, known);
    }
  }

  return placed;
}
