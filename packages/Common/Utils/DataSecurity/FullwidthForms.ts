import { digitZeroOf } from "./DigitReadings";

/*
 * A TEXT WITH A NUMBER'S FULLWIDTH SIGNS AND SEPARATORS READ AS ASCII
 * (#11115).
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
 * This reads each of those forms as the ASCII character it is the
 * fullwidth form of, and every other character as it is: the reading a
 * detector of a number asks for (Detector.ts, readsFullwidthForms), beside
 * the text as written, and with every script's digits read in it too
 * (TextReadings). A form is one UTF-16 unit, and so is the character it is
 * read as, so the reading is as long as the text, and a match found in it
 * is on the very characters the text writes it with.
 *
 * Only a text with a form right beside a digit of any script - a number's
 * sign or one of its separators - is read so. CJK prose sets its
 * sentences apart by ideographic spaces and writes its asides in fullwidth
 * parentheses; read again, such a text would find nothing more, at the
 * cost of a reading for every detector that asks. A text that holds one is
 * read with every form in it folded.
 *
 * Fullwidth letters (Ａ to ｚ) and the other fullwidth punctuation are
 * left as they are: no detector of a number reads a letter where it reads a
 * digit, and the words a detector looks for beside a value are ASCII
 * words. In time in line with the text's length: a pass to find a form
 * beside a digit, and a pass to fold.
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

// The lowest of the forms: no character before it is one.
const LOWEST_FORM: number = 0x3000;

// Whether a UTF-16 unit is one of the fullwidth forms read.
export function isFullwidthForm(code: number): boolean {
  return code >= LOWEST_FORM && ASCII_OF_FULLWIDTH_FORM.has(code);
}

// Whether the unit at `at` is a decimal digit of any script (DigitReadings' 37).
function isDigitAt(text: string, at: number): boolean {
  return at >= 0 && at < text.length && digitZeroOf(text.charCodeAt(at)) >= 0;
}

/*
 * Whether a text holds a fullwidth form right beside a digit of any
 * script, before or after it: a number's sign or separator, and so a text
 * the reading reads.
 */
export function holdsFullwidthFormOfANumber(text: string): boolean {
  if (!text) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    if (
      isFullwidthForm(text.charCodeAt(index)) &&
      (isDigitAt(text, index - 1) || isDigitAt(text, index + 1))
    ) {
      return true;
    }
  }

  return false;
}

/*
 * The text with every fullwidth form written as its ASCII character, and
 * every other character as it is: "＋８１ ３－１２３４" is "+８１ ３-１２３４".
 * A value a rule found reads so, for its mask and its token (ScrubAction).
 */
export function foldFullwidthForms(text: string): string {
  let folded: string | null = null;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    const ascii: string | undefined =
      code >= LOWEST_FORM ? ASCII_OF_FULLWIDTH_FORM.get(code) : undefined;

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
 * fullwidth form folded (foldFullwidthForms) - or null when the text holds
 * no form beside a digit, so it has nothing more to read
 * (holdsFullwidthFormOfANumber). As long as the text.
 */
export function readFullwidthForms(text: string): string | null {
  return holdsFullwidthFormOfANumber(text) ? foldFullwidthForms(text) : null;
}
