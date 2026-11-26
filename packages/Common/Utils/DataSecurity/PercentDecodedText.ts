/*
 * A TEXT AS ITS PERCENT-ESCAPES READ, AND WHERE EACH PART OF IT IS WRITTEN
 * (#10467).
 *
 * An application often logs a URL or a query string as it arrived - a
 * redirect target, a callback, a proxied request - with its reserved
 * characters percent-encoded: target=http%3A%2F%2F%5B2001%3Adb8%3A%3A1%5D%2F.
 * An IPv6 address there has no colon a pattern can read, so Data Security's
 * IP address detectors found nothing in it, and an IP Address scrub rule,
 * which finds with the same detectors, hid nothing.
 *
 * This reads such a text as a URL is read: each escape of an ASCII
 * character (%3A, %2f, %5B ...) as the character it stands for, and each
 * run of escapes that spells one character in UTF-8 (%C3%A9 is é, #11032)
 * as that character - so jos%C3%A9%40example.com reads josé@example.com.
 * A text whose escapes were escaped again (%253A: a URL inside a query
 * string inside another URL's) is read again, up to MAX_PERCENT_DECODINGS
 * times. And it says where each position of what it read is written, so a
 * match found in the reading is placed on the very characters it was
 * written with - 2001%3Adb8%3A%3A1, its first character to its last, and
 * not the escaped brackets around it; jos%C3%A9, every escape of the é
 * whole - the way ScrubJsonText places a match found in a JSON text with
 * its escapes read.
 *
 * Left as written: escapes of bytes that spell no character in UTF-8 - a
 * byte that cannot start one (%A9, %C0, %F5), a character cut short
 * (%C3 alone, %E2%82 then no third), an overlong spelling (%C0%AF, %E0%80%AF),
 * a surrogate (%ED%A0%80) or a code point beyond U+10FFFF (%F4%90%80%80):
 * each byte as it is written; a "%" not followed by two hex digits (100%,
 * %zz, a "%" at the very end), which is no escape; and a "+", which only a
 * form's body reads as a space.
 *
 * In time in line with the text's length: each reading is one pass, a
 * character's bytes read once, and a position is placed by a binary search
 * over the characters read.
 */

// How many times a text whose escapes were themselves escaped is read again.
export const MAX_PERCENT_DECODINGS: number = 3;

const PERCENT: string = "%";

// A hex digit's value, or -1 for any other character.
function hexValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code - 0x30;
  }

  if (code >= 0x41 && code <= 0x46) {
    return code - 0x41 + 10;
  }

  if (code >= 0x61 && code <= 0x66) {
    return code - 0x61 + 10;
  }

  return -1;
}

/*
 * One reading of a text: the text with each escaped character read, and
 * for each such character - in order - where in what it read it starts,
 * how many UTF-16 units it reads as (two for one beyond U+FFFF), how many
 * characters it was written with (three an escape), and how many more
 * characters were written than read up to its end; and which of them are
 * a "%" - an escape escaped again starts there, and only there.
 */
interface Decoding {
  readable: string;
  starts: Array<number>;
  units: Array<number>;
  writtenLengths: Array<number>;
  extraUpTo: Array<number>;
  percents: Array<number>;
}

// An escape's byte: the two hex digits after a "%", or -1 for none.
function escapedByteAt(text: string, at: number): number {
  if (at + 2 >= text.length) {
    return -1;
  }

  const high: number = hexValue(text.charCodeAt(at + 1));
  const low: number = hexValue(text.charCodeAt(at + 2));

  return high < 0 || low < 0 ? -1 : high * 16 + low;
}

/*
 * How many bytes the UTF-8 spelling of a character is that starts with
 * this byte: 2, 3 or 4 - or 0 for a byte that starts none (a continuation
 * byte, C0 and C1 which could only spell ASCII again, F5 and above).
 */
function utf8LengthOf(lead: number): number {
  if (lead >= 0xc2 && lead <= 0xdf) {
    return 2;
  }

  if (lead >= 0xe0 && lead <= 0xef) {
    return 3;
  }

  return lead >= 0xf0 && lead <= 0xf4 ? 4 : 0;
}

/*
 * Whether a character's second byte may follow its first: never an
 * overlong spelling (E0 below A0, F0 below 90), a surrogate (ED from A0)
 * or a code point beyond U+10FFFF (F4 from 90).
 */
function isSecondByteOf(lead: number, second: number): boolean {
  if (second < 0x80 || second > 0xbf) {
    return false;
  }

  switch (lead) {
    case 0xe0:
      return second >= 0xa0;
    case 0xed:
      return second <= 0x9f;
    case 0xf0:
      return second >= 0x90;
    case 0xf4:
      return second <= 0x8f;
    default:
      return true;
  }
}

/*
 * The character a run of escapes starting at `starts[index]` spells, and
 * how many escapes it takes: one for ASCII, two to four for UTF-8 - each
 * the next of `starts`, three characters on. Null when they spell none.
 */
function escapedCharacterAt(
  text: string,
  starts: Array<number>,
  index: number,
): { codePoint: number; escapes: number } | null {
  const at: number = starts[index]!;
  const lead: number = escapedByteAt(text, at);

  if (lead < 0) {
    return null;
  }

  if (lead < 0x80) {
    return { codePoint: lead, escapes: 1 };
  }

  const length: number = utf8LengthOf(lead);

  if (length === 0) {
    return null;
  }

  // The lead byte's own bits: five of 110xxxxx, four of 1110xxxx, three of 11110xxx.
  let codePoint: number =
    lead & (length === 2 ? 0x1f : length === 3 ? 0x0f : 0x07);

  for (let next: number = 1; next < length; next++) {
    const nextAt: number = at + 3 * next;

    // The next byte's escape must be right after, and one a byte may start at.
    if (starts[index + next] !== nextAt) {
      return null;
    }

    const byte: number = escapedByteAt(text, nextAt);

    if (
      byte < 0 ||
      (next === 1 ? !isSecondByteOf(lead, byte) : byte < 0x80 || byte > 0xbf)
    ) {
      return null;
    }

    codePoint = codePoint * 64 + (byte & 0x3f);
  }

  return { codePoint, escapes: length };
}

// Every "%" of a text, in order.
function percentsOf(text: string): Array<number> {
  const percents: Array<number> = [];

  for (
    let at: number = text.indexOf(PERCENT);
    at !== -1;
    at = text.indexOf(PERCENT, at + 1)
  ) {
    percents.push(at);
  }

  return percents;
}

/*
 * The text with its escaped characters read once, or null when it holds
 * none. `starts`: the "%"s an escape may start at, in order - every one of
 * the text as written; in a reading, only those an escaped "%" (%25) was
 * read as, so a "%" written before an escape (%%41, %2%41) never joins
 * what the escape is read as into one more escape. A character's UTF-8
 * bytes are each such an escape, one right after another.
 */
function decodeOnce(text: string, starts: Array<number>): Decoding | null {
  const pieces: Array<string> = [];
  const decoding: Decoding = {
    readable: "",
    starts: [],
    units: [],
    writtenLengths: [],
    extraUpTo: [],
    percents: [],
  };
  // The text before this is in pieces already.
  let copiedUpTo: number = 0;
  // How long pieces are together.
  let readableLength: number = 0;
  // How many more characters were written than read so far.
  let extra: number = 0;

  for (let index: number = 0; index < starts.length; index++) {
    const at: number = starts[index]!;

    if (at + 2 >= text.length) {
      break;
    }

    const character: { codePoint: number; escapes: number } | null =
      escapedCharacterAt(text, starts, index);

    // No escape, or bytes that spell no character: left as written.
    if (!character) {
      continue;
    }

    const read: string = String.fromCodePoint(character.codePoint);
    const writtenLength: number = 3 * character.escapes;

    pieces.push(text.slice(copiedUpTo, at), read);
    readableLength += at - copiedUpTo;
    decoding.starts.push(readableLength);

    if (character.codePoint === 0x25) {
      decoding.percents.push(readableLength);
    }

    readableLength += read.length;
    extra += writtenLength - read.length;
    decoding.units.push(read.length);
    decoding.writtenLengths.push(writtenLength);
    decoding.extraUpTo.push(extra);
    copiedUpTo = at + writtenLength;
    // The character's other bytes are read: their "%"s start no escape of their own.
    index += character.escapes - 1;
  }

  if (decoding.starts.length === 0) {
    return null;
  }

  pieces.push(text.slice(copiedUpTo));
  decoding.readable = pieces.join("");

  return decoding;
}

// How many of a sorted list's entries are below `target`.
function countBelow(sorted: Array<number>, target: number): number {
  let low: number = 0;
  let high: number = sorted.length;

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
 * Where a position of a reading is in the text it was read from: each
 * character read before it was written with as many more characters as
 * its escapes held. A position inside a character read as two UTF-16
 * units - one beyond U+FFFF, between its halves - is placed after its
 * escapes, so a range that ends there takes the whole character.
 */
function writtenPositionIn(decoding: Decoding, position: number): number {
  const before: number = countBelow(decoding.starts, position);

  if (before === 0) {
    return position;
  }

  const last: number = before - 1;
  const start: number = decoding.starts[last]!;

  if (position < start + decoding.units[last]!) {
    const extraBefore: number = last > 0 ? decoding.extraUpTo[last - 1]! : 0;

    return start + extraBefore + decoding.writtenLengths[last]!;
  }

  return position + decoding.extraUpTo[last]!;
}

export type PercentDecodedRange = [number, number];

export default class PercentDecodedText {
  // The text as it is written.
  public readonly written: string;
  // The text as it reads: every escaped character read, as many times as it was escaped.
  public readonly readable: string;
  // Each reading, the first (of the written text) first.
  private readonly decodings: Array<Decoding>;

  private constructor(written: string, decodings: Array<Decoding>) {
    this.written = written;
    this.decodings = decodings;
    this.readable = decodings[decodings.length - 1]!.readable;
  }

  /*
   * The text as its escapes read, or null when it holds no escape that
   * spells a character: then it reads as it is written.
   */
  public static read(text: string): PercentDecodedText | null {
    if (!text || text.indexOf(PERCENT) === -1) {
      return null;
    }

    const decodings: Array<Decoding> = [];
    let current: string = text;
    let starts: Array<number> = percentsOf(text);

    while (decodings.length < MAX_PERCENT_DECODINGS && starts.length > 0) {
      const decoding: Decoding | null = decodeOnce(current, starts);

      if (decoding === null) {
        break;
      }

      decodings.push(decoding);
      current = decoding.readable;
      starts = decoding.percents;
    }

    return decodings.length > 0
      ? new PercentDecodedText(text, decodings)
      : null;
  }

  /*
   * Where a position of the reading - a character's start, or the end of
   * the text - is written: a character an escape stood for starts at its
   * "%".
   */
  public toWritten(position: number): number {
    let written: number = position;

    for (let index: number = this.decodings.length - 1; index >= 0; index--) {
      written = writtenPositionIn(this.decodings[index]!, written);
    }

    return written;
  }

  /*
   * A range of the reading - [start, end) - as the characters it is
   * written with: from the first character's first written character to
   * the last's last, every escape inside it whole.
   */
  public rangeToWritten(range: PercentDecodedRange): PercentDecodedRange {
    return [this.toWritten(range[0]), this.toWritten(range[1])];
  }

  // A text as it reads: the text itself when it holds no escape to read.
  public static readableOf(text: string): string {
    const read: PercentDecodedText | null = PercentDecodedText.read(text);

    return read ? read.readable : text;
  }
}
