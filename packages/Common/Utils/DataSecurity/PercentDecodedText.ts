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
 * character (%3A, %2f, %5B ...) as the character it stands for. A text
 * whose escapes were escaped again (%253A: a URL inside a query string
 * inside another URL's) is read again, up to MAX_PERCENT_DECODINGS times.
 * And it says where each position of what it read is written, so a match
 * found in the reading is placed on the very characters it was written
 * with - 2001%3Adb8%3A%3A1, its first character to its last, and not the
 * escaped brackets around it - the way ScrubJsonText places a match found
 * in a JSON text with its escapes read.
 *
 * Left as written: an escape of a byte beyond ASCII (%C3%A9, part of a
 * character of another script), which is never part of an address; a "%"
 * not followed by two hex digits (100%, %zz, a "%" at the very end), which
 * is no escape; and a "+", which only a form's body reads as a space.
 *
 * In time in line with the text's length: each reading is one pass, and a
 * position is placed by a binary search over the escapes read.
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
 * One reading of a text: the text with each escape of an ASCII character
 * read, where in what it read each such character sits, and which of them
 * are a "%" - an escape escaped again starts there, and only there.
 */
interface Decoding {
  readable: string;
  escapes: Array<number>;
  percents: Array<number>;
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
 * The text with its ASCII escapes read once, or null when it holds none.
 * `starts`: the "%"s an escape may start at, in order - every one of the
 * text as written; in a reading, only those an escaped "%" (%25) was read
 * as, so a "%" written before an escape (%%41, %2%41) never joins what
 * the escape is read as into one more escape.
 */
function decodeOnce(text: string, starts: Array<number>): Decoding | null {
  const pieces: Array<string> = [];
  const escapes: Array<number> = [];
  const percents: Array<number> = [];
  // The text before this is in pieces already.
  let copiedUpTo: number = 0;
  // How long pieces are together.
  let readableLength: number = 0;

  for (const at of starts) {
    if (at + 2 >= text.length) {
      break;
    }

    const high: number = hexValue(text.charCodeAt(at + 1));
    const low: number = hexValue(text.charCodeAt(at + 2));

    // No escape, or one of a byte beyond ASCII: left as written.
    if (high < 0 || low < 0 || high > 7) {
      continue;
    }

    const code: number = high * 16 + low;

    pieces.push(text.slice(copiedUpTo, at));
    readableLength += at - copiedUpTo;
    escapes.push(readableLength);

    if (code === 0x25) {
      percents.push(readableLength);
    }

    pieces.push(String.fromCharCode(code));
    readableLength += 1;
    copiedUpTo = at + 3;
  }

  if (escapes.length === 0) {
    return null;
  }

  pieces.push(text.slice(copiedUpTo));

  return { readable: pieces.join(""), escapes: escapes, percents: percents };
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
 * escape read before it was three characters written, one read.
 */
function writtenPositionIn(decoding: Decoding, position: number): number {
  return position + 2 * countBelow(decoding.escapes, position);
}

export type PercentDecodedRange = [number, number];

export default class PercentDecodedText {
  // The text as it is written.
  public readonly written: string;
  // The text as it reads: every ASCII escape read, as many times as it was escaped.
  public readonly readable: string;
  // Each reading, the first (of the written text) first.
  private readonly decodings: Array<Decoding>;

  private constructor(written: string, decodings: Array<Decoding>) {
    this.written = written;
    this.decodings = decodings;
    this.readable = decodings[decodings.length - 1]!.readable;
  }

  /*
   * The text as its escapes read, or null when it holds no escape of an
   * ASCII character: then it reads as it is written.
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
