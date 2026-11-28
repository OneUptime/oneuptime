/*
 * A TEXT WITH EVERY SCRIPT'S DIGITS READ BY THEIR VALUES (#10960).
 *
 * Japanese text often writes a card number in fullwidth digits
 * (４１１１ １１１１ １１１１ １１１１), Arabic and Persian text in their own
 * (٤١١١١١١١١١١١١١١١, ۴۱۱۱-۱۱۱۱-۱۱۱۱-۱۱۱۱). Data Security's card patterns say
 * [0-9], so such a card was neither found nor hidden. This reads a text as
 * those patterns can: each decimal digit of the 37 scripts whose digits
 * Unicode's Basic Multilingual Plane holds written as the ASCII digit of its
 * value - as the OneUptime Android agent's redactor reads one
 * (Utils/Host/AndroidAgentRedactor.ts, #10937), so the detectors and the
 * redactor agree on what a card is.
 *
 * Each script's digits are read alone first, every other script's digits
 * read as no digit at all, so a digit of another script right beside a card
 * is no part of it: a Persian card with an Arabic-Indic digit after it is
 * still the card. Then every script's digits are read together, so a
 * number typed in two scripts is read whole: ４１１１ 1111 1111 1111, or a
 * Persian card typed with a few Arabic-Indic digits. ASCII digits alone are
 * the text as it is written, which every detector reads anyway. A script is
 * read alone only where it holds a run of the shortest number's digits at
 * least (MIN_DIGITS_OF_A_SCRIPT_READ_ALONE: a card, a Social Security or
 * phone number, an IBAN, a national ID number, #11030, #11033), and at most
 * four are - a text of every script's digits costs a few readings, not one
 * for each of the 37: every script is still read in the reading of all of
 * them.
 *
 * A digit is one UTF-16 unit in either form, so a reading is exactly as
 * long as the text, and a match found in it is on the very characters the
 * text writes it with. Only the Basic Multilingual Plane's digits: theirs
 * have not changed since Unicode 7, and the few scripts whose digits
 * Unicode put beyond it (Adlam, Chakma, Hanifi Rohingya, ...) are left, as
 * the redactor leaves them.
 *
 * In time in line with the text's length: a reading is one pass, and a
 * text holds at most 37 scripts' digits.
 */

/*
 * The first of each script's ten decimal digits in the Basic Multilingual
 * Plane (its zero), in order: ASCII, Arabic-Indic, Persian (Extended
 * Arabic-Indic), NKo, Devanagari, Bengali, Gurmukhi, Gujarati, Oriya,
 * Tamil, Telugu, Kannada, Malayalam, Sinhala, Thai, Lao, Tibetan, Myanmar
 * and Myanmar Shan, Khmer, Mongolian, Limbu, New Tai Lue, Tai Tham (two),
 * Balinese, Sundanese, Lepcha, Ol Chiki, Vai, Saurashtra, Kayah Li,
 * Javanese, Myanmar Tai Laing, Cham, Meetei Mayek and fullwidth. The
 * redactor's DIGIT_ZEROS, the same 37.
 */
export const DIGIT_ZEROS: ReadonlyArray<number> = [
  0x0030, 0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66,
  0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040,
  0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0,
  0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0,
  0xff10,
];

const ASCII_ZERO: number = 0x30;

/*
 * The digits of every script but ASCII, as a regular expression's class
 * holds them (without its brackets): what a code of letters and digits -
 * a BIC - is never cut at, written in another script's digits, since such
 * a digit is as much a part of it as an ASCII one (#11200).
 */
export const DIGITS_BEYOND_ASCII_CLASS: string = DIGIT_ZEROS.filter(
  (zero: number): boolean => {
    return zero !== ASCII_ZERO;
  },
)
  .map((zero: number): string => {
    const first: string = zero.toString(16).toUpperCase().padStart(4, "0");
    const last: string = (zero + 9).toString(16).toUpperCase().padStart(4, "0");

    return `\\u${first}-\\u${last}`;
  })
  .join("");

// What a digit of another script reads as in one script's reading: no digit, no letter, no separator.
const NOT_A_DIGIT: string = "\u0000";

/*
 * The zero of the script whose ten decimal digits a UTF-16 unit is one of,
 * or -1 when it is none of DIGIT_ZEROS' digits.
 */
export function digitZeroOf(code: number): number {
  if (code < ASCII_ZERO) {
    return -1;
  }

  let low: number = 0;
  let high: number = DIGIT_ZEROS.length - 1;

  /*
   * The last zero at or before the code. The middle is halved in integers,
   * reading no global: this runs for every character of every reading, and
   * where the code runs in a context of its own (a test runner's), each
   * read of a global such as Math costs some thirty times a local's.
   */
  while (low < high) {
    const middle: number = (low + high + 1) >> 1;

    if (DIGIT_ZEROS[middle]! <= code) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  const zero: number = DIGIT_ZEROS[low]!;

  return code >= zero && code - zero <= 9 ? zero : -1;
}

// A digit's value, whatever its script, or -1 for any other character.
export function digitValueOf(code: number): number {
  const zero: number = digitZeroOf(code);

  return zero < 0 ? -1 : code - zero;
}

// Whether a text holds a digit of a script other than ASCII.
export function hasDigitBeyondAscii(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    // No digit of another script comes before Arabic-Indic's zero.
    if (code >= DIGIT_ZEROS[1]! && digitZeroOf(code) > ASCII_ZERO) {
      return true;
    }
  }

  return false;
}

/*
 * The text with every digit of the 37 scripts written as the ASCII digit
 * of its value, and every other character as it is: "４１１１" is "4111".
 */
export function foldDigits(text: string): string {
  if (!hasDigitBeyondAscii(text)) {
    return text;
  }

  let folded: string = "";

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    const zero: number = digitZeroOf(code);

    folded +=
      zero > ASCII_ZERO
        ? String.fromCharCode(ASCII_ZERO + code - zero)
        : text[index];
  }

  return folded;
}

/*
 * One script's reading: its digits written as ASCII ones, every other
 * script's digits - ASCII's among them - as no digit at all.
 */
function readingOfScript(text: string, scriptZero: number): string {
  let reading: string = "";

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    const zero: number = digitZeroOf(code);

    if (zero < 0) {
      reading += text[index];
    } else if (zero === scriptZero) {
      reading += String.fromCharCode(ASCII_ZERO + code - zero);
    } else {
      reading += NOT_A_DIGIT;
    }
  }

  return reading;
}

/*
 * The fewest digits of one script, each group apart by at most one space
 * or dash, a value read alone in that script's digits can be: a card has
 * twelve at least, and the shortest of the other numbers read in every
 * script's digits (#11033) - a DEA number's, a phone number's - seven. A
 * script with no such run has no reading of its own - nothing to find in
 * one - and is read with every other's.
 */
export const MIN_DIGITS_OF_A_SCRIPT_READ_ALONE: number = 7;

/*
 * The most scripts read alone in one text, the first to hold such a run
 * first: every script's digits are still read together, so a text of more
 * - none a person writes - costs a few readings, never one for each of
 * the 37 scripts.
 */
export const MAX_SCRIPTS_READ_ALONE: number = 4;

/*
 * The zeros of the scripts a text holds digits of, in the order they
 * appear, and of those beyond ASCII the ones that hold a run of
 * MIN_DIGITS_OF_A_SCRIPT_READ_ALONE digits of their own - a digit of
 * another script, two separators or anything else ends a run.
 */
function scriptsOf(text: string): {
  zeros: Array<number>;
  withRuns: Array<number>;
} {
  const zeros: Array<number> = [];
  const withRuns: Array<number> = [];
  let runZero: number = -1;
  let runLength: number = 0;
  let afterSeparator: boolean = false;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    const zero: number = digitZeroOf(code);

    if (zero < 0) {
      if (
        (code === 0x20 || code === 0x2d) &&
        runLength > 0 &&
        !afterSeparator
      ) {
        afterSeparator = true;
      } else {
        runLength = 0;
        afterSeparator = false;
      }

      continue;
    }

    if (!zeros.includes(zero)) {
      zeros.push(zero);
    }

    runLength = zero === runZero && runLength > 0 ? runLength + 1 : 1;
    runZero = zero;
    afterSeparator = false;

    if (
      runLength === MIN_DIGITS_OF_A_SCRIPT_READ_ALONE &&
      zero !== ASCII_ZERO &&
      !withRuns.includes(zero)
    ) {
      withRuns.push(zero);
    }
  }

  return { zeros, withRuns };
}

/*
 * The readings of a text a detector of every script's digits reads beside
 * the text itself: each script beyond ASCII that holds a run of a value's
 * digits alone (at most MAX_SCRIPTS_READ_ALONE of them), then all of them
 * together - unless that one script's reading is every digit's already.
 * None when the text holds no digit beyond ASCII. Each is as long as the
 * text.
 */
export function readDigitsOfEveryScript(text: string): Array<string> {
  if (!text || !hasDigitBeyondAscii(text)) {
    return [];
  }

  const { zeros, withRuns } = scriptsOf(text);
  const readings: Array<string> = withRuns
    .slice(0, MAX_SCRIPTS_READ_ALONE)
    .map((zero: number): string => {
      return readingOfScript(text, zero);
    });

  // One script's digits alone, read alone already: that is every digit's reading.
  if (!(zeros.length === 1 && readings.length === 1)) {
    readings.push(foldDigits(text));
  }

  return readings;
}
