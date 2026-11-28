import { digitZeroOf } from "./DigitReadings";

/*
 * A TEXT WITH A NUMBER'S FULLWIDTH SIGNS AND SEPARATORS READ AS ASCII
 * (#11115), THE DASHES BETWEEN ITS DIGITS READ AS HYPHENS, AND A VALUE
 * TYPED IN FULLWIDTH LETTERS READ AS ASCII (#11385).
 *
 * Japanese and Chinese text often types a number wholly in fullwidth
 * forms, as an input method in fullwidth mode writes every character: a
 * phone number's plus sign ＋ (U+FF0B), its hyphens － (U+FF0D) and its
 * parentheses （ ） (U+FF08, U+FF09), the ideographic space between its
 * groups (U+3000), and the full stop ． (U+FF0E) and solidus ／ (U+FF0F)
 * a Social Security number or a date is set apart by:
 * ＋８１ ３－１２３４－５６７８, ５３６－２２－８７３１, １９８５／０３／１２. Its
 * digits are read by their values (DigitReadings), but every detector's
 * pattern sets a value's groups apart, and signs it, with ASCII characters
 * alone, so such a number was neither found nor hidden.
 *
 * And a number's groups are set apart by other dashes (#11385): Japanese
 * text types the prolonged sound mark ー (U+30FC, ｰ U+FF70 in halfwidth
 * katakana) for a hyphen, ０３ー１２３４ー５６７８, and typeset text a hyphen
 * ‐ (U+2010), a non-breaking hyphen ‑ (U+2011), a figure dash ‒ (U+2012),
 * the dash made the width of a digit for a number's groups, an en dash –
 * (U+2013) or a minus sign − (U+2212): 536–22–8731. Each is read as a "-",
 * but only between two digits of any script: ー in a katakana word
 * (サーバー), a minus before a number (−5), a dash of a sentence are no
 * number's.
 *
 * This reads each of those forms as the ASCII character it is the
 * fullwidth form of, each of those dashes between two digits as a "-", a
 * fullwidth Latin letter as its ASCII letter - so a number glued to a word
 * typed in fullwidth is a longer token, as in ASCII: ｅ＋７７７… is no phone
 * number, as e+777… is none (#11385) - and every other character as it is:
 * the reading a detector of a number asks for (Detector.ts,
 * readsFullwidthForms), beside the text as written,
 * and with every script's digits read in it too (TextReadings). A form and
 * a dash are each one UTF-16 unit, and so is the character it is read as,
 * so the reading is as long as the text, and a match found in it is on the
 * very characters the text writes it with.
 *
 * Only a text with a form right beside a digit of any script - a number's
 * sign or one of its separators - or a dash between two is read so. CJK
 * prose sets its sentences apart by ideographic spaces and writes its
 * asides in fullwidth parentheses; read again, such a text would find
 * nothing more, at the cost of a reading for every detector that asks. A
 * text that holds one is read with every form in it folded.
 *
 * A VALUE TYPED IN FULLWIDTH LETTERS (#11385). An input method in
 * fullwidth mode types a value's letters in fullwidth too: an IBAN
 * ＤＥ８９ ３７０４ …, a UK postcode ＳＷ１Ａ ２ＡＡ, an email address
 * ｊａｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ - and the words beside a number, ＴＥＬ, ＳＳＮ.
 * A second reading folds every character of the fullwidth ASCII block
 * (U+FF01 to U+FF5E: its letters, digits, signs and punctuation) to the
 * ASCII character it is the form of, as NFKC folds it, the ideographic
 * space to a space, and the dashes between two digits as above
 * (readsFullwidthLetters, for the detectors of values with letters, and
 * those that read a number typed in fullwidth, for its words). Nothing
 * else NFKC would fold is folded: a kana, a kanji, a halfwidth katakana, a
 * CJK punctuation mark (、。「」) stays as it is. And only a text that holds
 * a fullwidth Latin letter beside another, beside a fullwidth digit or
 * beside ＠, or ＠ beside a letter or a digit - some of a value typed in
 * fullwidth - is read so: CJK prose, with its fullwidth punctuation and
 * digits, is never read again.
 *
 * In time in line with the text's length: a pass to find a form or a dash
 * beside a digit, or a letter of a value, and a pass to fold.
 */

// Each fullwidth form a number is written with, and the ASCII character it is the form of.
const ASCII_OF_FULLWIDTH_FORM: ReadonlyMap<number, string> = new Map<
  number,
  string
>([
  [0xff0b, "+"],
  [0xff0d, "-"],
  [0xff08, "("],
  [0xff09, ")"],
  [0xff0e, "."],
  [0xff0f, "/"],
  [0x3000, " "],
]);

/*
 * The fullwidth forms read, as the code points they are: what a database
 * search narrows by beside a digit (DetectorPrefilter), and what the tests
 * write numbers in.
 */
export const FULLWIDTH_FORMS: ReadonlyArray<number> = Array.from(
  ASCII_OF_FULLWIDTH_FORM.keys(),
);

/*
 * The dashes a number's groups are set apart by besides the hyphen-minus
 * and its fullwidth form, read as "-" between two digits (#11385): the
 * prolonged sound mark and its halfwidth form, the hyphen, the
 * non-breaking hyphen, the figure dash, the en dash and the minus sign.
 */
export const NUMBER_DASHES: ReadonlyArray<number> = [
  0x30fc, 0xff70, 0x2010, 0x2011, 0x2012, 0x2013, 0x2212,
];

const NUMBER_DASH_SET: ReadonlySet<number> = new Set<number>(NUMBER_DASHES);

// The lowest of the forms and dashes: no character before it is one.
const LOWEST_FORM: number = 0x2010;

// The first and last characters of the fullwidth ASCII block, ！ and ～, and how far each is from its ASCII one.
const FULLWIDTH_BLOCK_FIRST: number = 0xff01;
const FULLWIDTH_BLOCK_LAST: number = 0xff5e;
const FULLWIDTH_TO_ASCII: number = 0xfee0;
const IDEOGRAPHIC_SPACE: number = 0x3000;
const FULLWIDTH_COMMERCIAL_AT: number = 0xff20;

// Whether a UTF-16 unit is a fullwidth Latin letter: Ａ to Ｚ, ａ to ｚ.
export function isFullwidthLetter(code: number): boolean {
  return (
    (code >= 0xff21 && code <= 0xff3a) || (code >= 0xff41 && code <= 0xff5a)
  );
}

// Whether a UTF-16 unit is one of the fullwidth forms read.
export function isFullwidthForm(code: number): boolean {
  return code >= LOWEST_FORM && ASCII_OF_FULLWIDTH_FORM.has(code);
}

// Whether a UTF-16 unit is one of the dashes read between two digits.
export function isNumberDash(code: number): boolean {
  return code >= LOWEST_FORM && NUMBER_DASH_SET.has(code);
}

// Whether the unit at `at` is a decimal digit of any script (DigitReadings' 37).
function isDigitAt(text: string, at: number): boolean {
  return at >= 0 && at < text.length && digitZeroOf(text.charCodeAt(at)) >= 0;
}

// Whether the dash at `at` sits between two digits of any script.
function isDashBetweenDigitsAt(text: string, at: number): boolean {
  return isDigitAt(text, at - 1) && isDigitAt(text, at + 1);
}

/*
 * Whether a text holds a fullwidth form right beside a digit of any
 * script, before or after it - a number's sign or separator - or one of
 * the dashes between two digits: a text the reading reads.
 */
export function holdsFullwidthFormOfANumber(text: string): boolean {
  if (!text) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < LOWEST_FORM) {
      continue;
    }

    if (
      isFullwidthForm(code) &&
      (isDigitAt(text, index - 1) || isDigitAt(text, index + 1))
    ) {
      return true;
    }

    if (isNumberDash(code) && isDashBetweenDigitsAt(text, index)) {
      return true;
    }
  }

  return false;
}

/*
 * The text with every fullwidth form written as its ASCII character, each
 * dash between two digits as "-", and every other character as it is:
 * "＋８１ ３ー１２３４" is "+８１ ３-１２３４". A fullwidth Latin letter is
 * read as its ASCII letter too (#11385), so a number glued to a word typed
 * in fullwidth is a longer token, as in ASCII - ｅ＋７７７… is no phone
 * number, as e+777… is none - and the word's letters are no part of a
 * number either way. A value a rule found reads so, for its mask and its
 * token (ScrubAction).
 */
export function foldFullwidthForms(text: string): string {
  let folded: string | null = null;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    let ascii: string | undefined = undefined;

    if (code >= LOWEST_FORM) {
      ascii = ASCII_OF_FULLWIDTH_FORM.get(code);

      if (
        ascii === undefined &&
        isNumberDash(code) &&
        isDashBetweenDigitsAt(text, index)
      ) {
        ascii = "-";
      } else if (ascii === undefined && isFullwidthLetter(code)) {
        ascii = String.fromCharCode(code - FULLWIDTH_TO_ASCII);
      }
    }

    if (ascii !== undefined) {
      // The text before the first form, as it is.
      folded = (folded === null ? text.slice(0, index) : folded) + ascii;
    } else if (folded !== null) {
      folded += text[index];
    }
  }

  return folded === null ? text : folded;
}

/*
 * The reading of a text a detector of a number reads beside it: every
 * fullwidth form folded and each dash between two digits read as "-"
 * (foldFullwidthForms) - or null when the text holds no form beside a
 * digit and no such dash, so it has nothing more to read
 * (holdsFullwidthFormOfANumber). As long as the text.
 */
export function readFullwidthForms(text: string): string | null {
  return holdsFullwidthFormOfANumber(text) ? foldFullwidthForms(text) : null;
}

// THE FULLWIDTH ASCII BLOCK, AS NFKC FOLDS IT (#11385).

// Whether a UTF-16 unit is a fullwidth digit, ０ to ９.
function isFullwidthDigit(code: number): boolean {
  return code >= 0xff10 && code <= 0xff19;
}

// Whether a UTF-16 unit is an ASCII letter or digit.
function isAsciiLetterOrDigit(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a)
  );
}

/*
 * Whether two neighbouring units are some of a value typed in fullwidth:
 * a fullwidth letter beside a fullwidth letter, a fullwidth digit or ＠, or
 * ＠ beside a letter or a digit of either width (jane＠example.com).
 */
function isPairOfAValue(left: number, right: number): boolean {
  if (isFullwidthLetter(left)) {
    return (
      isFullwidthLetter(right) ||
      isFullwidthDigit(right) ||
      right === FULLWIDTH_COMMERCIAL_AT
    );
  }

  if (isFullwidthLetter(right)) {
    return isFullwidthDigit(left) || left === FULLWIDTH_COMMERCIAL_AT;
  }

  return (
    (left === FULLWIDTH_COMMERCIAL_AT &&
      (isAsciiLetterOrDigit(right) || isFullwidthDigit(right))) ||
    (right === FULLWIDTH_COMMERCIAL_AT &&
      (isAsciiLetterOrDigit(left) || isFullwidthDigit(left)))
  );
}

/*
 * Whether a text holds some of a value typed in fullwidth letters
 * (isPairOfAValue): a text the letters' reading reads. CJK prose - kana,
 * kanji, its fullwidth punctuation and digits - holds none.
 */
export function holdsFullwidthLettersOfAValue(text: string): boolean {
  if (!text) {
    return false;
  }

  for (let index: number = 1; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    const previous: number = text.charCodeAt(index - 1);

    if (
      (code >= FULLWIDTH_COMMERCIAL_AT ||
        previous >= FULLWIDTH_COMMERCIAL_AT) &&
      isPairOfAValue(previous, code)
    ) {
      return true;
    }
  }

  return false;
}

/*
 * The text with every character of the fullwidth ASCII block written as
 * the ASCII character it is the form of (ｊａｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ is
 * jane@example.com), the ideographic space as a space, each dash between
 * two digits as "-", and every other character as it is. A value a rule
 * found reads so, for its mask and its token (ScrubAction).
 */
export function foldFullwidthLetters(text: string): string {
  let folded: string | null = null;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    let ascii: string | undefined = undefined;

    if (code >= FULLWIDTH_BLOCK_FIRST && code <= FULLWIDTH_BLOCK_LAST) {
      ascii = String.fromCharCode(code - FULLWIDTH_TO_ASCII);
    } else if (code === IDEOGRAPHIC_SPACE) {
      ascii = " ";
    } else if (isNumberDash(code) && isDashBetweenDigitsAt(text, index)) {
      ascii = "-";
    }

    if (ascii !== undefined) {
      // The text before the first folded character, as it is.
      folded = (folded === null ? text.slice(0, index) : folded) + ascii;
    } else if (folded !== null) {
      folded += text[index];
    }
  }

  return folded === null ? text : folded;
}

/*
 * The reading of a text a detector of a value with letters reads beside
 * it: the fullwidth ASCII block folded (foldFullwidthLetters) - or null
 * when the text holds no value typed in fullwidth letters
 * (holdsFullwidthLettersOfAValue). As long as the text.
 */
export function readFullwidthLetters(text: string): string | null {
  return holdsFullwidthLettersOfAValue(text)
    ? foldFullwidthLetters(text)
    : null;
}
