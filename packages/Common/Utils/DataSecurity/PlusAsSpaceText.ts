import PercentDecodedText from "./PercentDecodedText";

/*
 * A TEXT AS A URL'S QUERY STRING READS IT: A "+" FOR A SPACE (#11199).
 *
 * A form - and URLSearchParams, and most code that builds a query string -
 * writes each space of a value as "+": a card typed in its groups is
 * card=4111+1111+1111+1111, an IBAN iban=DE44+5001+0517+5407+3249+31, a
 * postcode postcode=SW1A+1AA, and a phone number, its own "+" escaped,
 * phone=%2B44+20+7946+0958. A URL inside another's query string - a
 * redirect's next=, a callback's return_to= - has those "+"s escaped once
 * more: next=%2Fpay%3Fcard%3D4111%2B1111%2B1111%2B1111. Read as written,
 * or with its escapes read alone (PercentDecodedText, which leaves a "+"
 * as it is: a "+" is a "+" everywhere but in a query string), the groups
 * of such a value are joined by a character no detector's pattern sets
 * groups apart with, so it was neither found nor hidden.
 *
 * This reads such a text as a query string is read:
 *
 *   1. each "+" written in it is a space - as a form writes every space,
 *      beside a value's groups (4111+1111) and beside punctuation alike
 *      (%3A+%22, a form's ": \"") - but for a number's own sign, a "+"
 *      with a digit of any script after it and nothing of a value before
 *      it (the text's start, a space, "=", "(", a quote...), and a "+" of
 *      a run of them (C++, ++44): phone=+44+20+7946+0958 reads
 *      phone=+44 20 7946 0958, and (+44), tz=+05:30 and ++41 keep theirs;
 *   2. then its escapes are read, as PercentDecodedText reads them - so in
 *      a text a form wrote, an escaped "+" (%2B) is the "+" it escaped:
 *      phone=%2B44+20+7946+0958 reads +44 20 7946 0958, and a centenarian's
 *      Swedish personnummer, pnr=19991231%2B1234, keeps its own "+";
 *   3. in a text with no "+" a form wrote for a space, a "+" an escape was
 *      read as between two characters of a value - a letter, a digit or a
 *      closing parenthesis before it, a letter, a digit or an opening
 *      parenthesis after it - is the space of a query string inside the
 *      URL: the card in next=... above reads 4111 1111 1111 1111. A
 *      number's sign has nothing of a value before it, so it stays. (One
 *      that is the "+" a flat query string escaped is still read so where
 *      the text is read with its escapes alone: TextReadings reads both.)
 *
 * A space for a "+" is one character for one, so a position of the
 * reading is where the reading of its escapes places it, and a match found
 * in it is placed on the characters it is written with, "+"s and escapes
 * and all.
 *
 * A reading beside the text as written and as its escapes read, for the
 * detectors that read a value written in groups or the words before one
 * (Detector.ts, readsPlusAsSpace; TextReadings), a Custom Regex rule
 * (Types/Telemetry/ScrubRule) and the built-in rules built on the
 * detectors (Utils/Telemetry/ScrubBuiltInPatterns). In time in line with
 * the text's length: a pass, one reading of the escapes, a pass.
 */

const PLUS: string = "+";
const PLUS_CODE: number = 0x2b;
const OPENING_PARENTHESIS_CODE: number = 0x28;
const CLOSING_PARENTHESIS_CODE: number = 0x29;
const CLOSING_BRACKET_CODE: number = 0x5d;
const HIGH_SURROGATE_FIRST: number = 0xd800;
const LOW_SURROGATE_FIRST: number = 0xdc00;
const LOW_SURROGATE_LAST: number = 0xdfff;
const NONE: number = -1;

// A letter or a digit of any script: what a value is made of.
const LETTER_OR_DIGIT: RegExp = /^[\p{L}\p{N}]$/u;

// A decimal digit of any script: what a number's sign comes before.
const DECIMAL_DIGIT: RegExp = /^\p{Nd}$/u;

function isLetterOrDigit(codePoint: number): boolean {
  if (codePoint < 0x80) {
    return (
      (codePoint >= 0x30 && codePoint <= 0x39) ||
      (codePoint >= 0x41 && codePoint <= 0x5a) ||
      (codePoint >= 0x61 && codePoint <= 0x7a)
    );
  }

  return LETTER_OR_DIGIT.test(String.fromCodePoint(codePoint));
}

function isDecimalDigit(codePoint: number): boolean {
  if (codePoint < 0x80) {
    return codePoint >= 0x30 && codePoint <= 0x39;
  }

  return DECIMAL_DIGIT.test(String.fromCodePoint(codePoint));
}

// What may end a value's group: a letter, a digit, a closing parenthesis or bracket.
function endsAValue(codePoint: number): boolean {
  return (
    codePoint === CLOSING_PARENTHESIS_CODE ||
    codePoint === CLOSING_BRACKET_CODE ||
    isLetterOrDigit(codePoint)
  );
}

// What may start a value's group: a letter, a digit, an opening parenthesis.
function startsAValue(codePoint: number): boolean {
  return codePoint === OPENING_PARENTHESIS_CODE || isLetterOrDigit(codePoint);
}

// The character that ends right before `at` - a pair's whole code point - or NONE at the start.
function codePointBefore(text: string, at: number): number {
  if (at <= 0) {
    return NONE;
  }

  const last: number = text.charCodeAt(at - 1);

  if (last >= LOW_SURROGATE_FIRST && last <= LOW_SURROGATE_LAST && at >= 2) {
    const high: number = text.charCodeAt(at - 2);

    if (high >= HIGH_SURROGATE_FIRST && high < LOW_SURROGATE_FIRST) {
      return text.codePointAt(at - 2)!;
    }
  }

  return last;
}

// The character that starts right after `at`, or NONE at the end.
function codePointAfter(text: string, at: number): number {
  return at + 1 < text.length ? text.codePointAt(at + 1)! : NONE;
}

/*
 * Whether the "+" written at `at` is the space a query string writes one
 * as (step 1 of the module comment): any but a number's own sign - a digit
 * after it, nothing that ends a value before it - and one of a run of "+"s.
 */
export function isWrittenPlusASpace(text: string, at: number): boolean {
  if (at < 0 || at >= text.length || text.charCodeAt(at) !== PLUS_CODE) {
    return false;
  }

  const before: number = codePointBefore(text, at);
  const after: number = codePointAfter(text, at);

  if (before === PLUS_CODE || after === PLUS_CODE) {
    return false;
  }

  return !(isDecimalDigit(after) && !endsAValue(before));
}

/*
 * Whether a "+" an escape was read as, at `at` of the text as its escapes
 * read, is the space of a query string inside the URL (step 3): between
 * two characters of a value.
 */
export function isEscapedPlusASpace(readable: string, at: number): boolean {
  if (
    at < 0 ||
    at >= readable.length ||
    readable.charCodeAt(at) !== PLUS_CODE
  ) {
    return false;
  }

  return (
    endsAValue(codePointBefore(readable, at)) &&
    startsAValue(codePointAfter(readable, at))
  );
}

/*
 * The text with each "+" `isSpace` says is a space written as one, and
 * every other character as it is - as long as the text - or null when it
 * holds no such "+".
 */
function withSpaces(
  text: string,
  isSpace: (text: string, at: number) => boolean,
): string | null {
  let at: number = text ? text.indexOf(PLUS) : -1;

  if (at === -1) {
    return null;
  }

  const pieces: Array<string> = [];
  let copiedUpTo: number = 0;
  let isAnySpace: boolean = false;

  for (; at !== -1; at = text.indexOf(PLUS, at + 1)) {
    if (isSpace(text, at)) {
      pieces.push(text.slice(copiedUpTo, at), " ");
      copiedUpTo = at + 1;
      isAnySpace = true;
    }
  }

  if (!isAnySpace) {
    return null;
  }

  pieces.push(text.slice(copiedUpTo));

  return pieces.join("");
}

// The text with each "+" written as the space a query string writes it for (step 1), or null.
export function withWrittenPlusesAsSpaces(text: string): string | null {
  return withSpaces(text, isWrittenPlusASpace);
}

function samePosition(position: number): number {
  return position;
}

export default class PlusAsSpaceText {
  // The text as it is written.
  public readonly written: string;
  // The text as a query string reads it: its "+"s for spaces as spaces, its escapes read.
  public readonly readable: string;
  /*
   * Whether a form wrote it: a "+" written in it is read as a space (step
   * 1), and an escaped one as the "+" it is. Else only a "+" an escape was
   * read as is (step 3), the space of a query string inside the URL.
   */
  public readonly isFormWritten: boolean;
  // Where a position of the reading is written.
  private readonly placeOf: (position: number) => number;

  private constructor(data: {
    written: string;
    readable: string;
    isFormWritten: boolean;
    placeOf: (position: number) => number;
  }) {
    this.written = data.written;
    this.readable = data.readable;
    this.isFormWritten = data.isFormWritten;
    this.placeOf = data.placeOf;
  }

  /*
   * The text as a query string reads it (the module comment's three
   * steps), or null when it holds no "+" a query string means a space by,
   * written or escaped: then it reads as its escapes read
   * (PercentDecodedText), which another reading reads already. A space
   * for a "+" is one character for one, so the reading of the escapes
   * places every position.
   */
  public static read(text: string): PlusAsSpaceText | null {
    // A "+" is written, or an escape may be read as one (%2B).
    if (!text || (text.indexOf(PLUS) === -1 && text.indexOf("%") === -1)) {
      return null;
    }

    const spaced: string | null = withWrittenPlusesAsSpaces(text);

    // A form wrote it: its "+"s are spaces, an escaped one the "+" it escaped (steps 1 and 2).
    if (spaced !== null) {
      const decoded: PercentDecodedText | null =
        PercentDecodedText.read(spaced);

      return new PlusAsSpaceText({
        written: text,
        readable: decoded ? decoded.readable : spaced,
        isFormWritten: true,
        placeOf: decoded
          ? (position: number): number => {
              return decoded.toWritten(position);
            }
          : samePosition,
      });
    }

    // A query string inside the URL: an escaped "+" between two characters of a value (step 3).
    const decoded: PercentDecodedText | null = PercentDecodedText.read(text);
    const nested: string | null = decoded
      ? withSpaces(decoded.readable, isEscapedPlusASpace)
      : null;

    if (!decoded || nested === null) {
      return null;
    }

    return new PlusAsSpaceText({
      written: text,
      readable: nested,
      isFormWritten: false,
      placeOf: (position: number): number => {
        return decoded.toWritten(position);
      },
    });
  }

  /*
   * Where a position of the reading - a character's start, or the end of
   * the text - is written: a space starts where its "+" is, a character
   * an escape stood for at its "%".
   */
  public toWritten(position: number): number {
    return this.placeOf(position);
  }

  /*
   * A text as a query string reads it - each "+" for a space a space, its
   * escapes read - or as its escapes read when it holds no such "+": the
   * value a match written so reads as, for its mask and its token.
   */
  public static readableOf(text: string): string {
    const read: PlusAsSpaceText | null = PlusAsSpaceText.read(text);

    return read ? read.readable : PercentDecodedText.readableOf(text);
  }
}
