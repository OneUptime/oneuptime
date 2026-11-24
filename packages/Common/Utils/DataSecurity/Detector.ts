import DataConfidence from "../../Types/DataSecurity/DataConfidence";
import { digitValueOf } from "./DigitReadings";

/*
 * HOW ONE DATA TYPE IS FOUND IN TEXT.
 *
 * A detector is data, not code that loops: a pattern that finds candidates,
 * an optional normalizer and validator that decide whether a candidate is
 * real, the words that confirm it when they sit nearby, and how sure a
 * validated candidate is on its own. TextScanner.ts runs every detector the
 * same way, so what makes a finding - and what keeps one out - is the same
 * for a log line, a CSV cell and a field of a database row.
 *
 * Rules every pattern keeps (DetectorCatalog.test.ts checks them):
 *
 *  - It is global (g) and every quantifier is bounded ({1,64}, never + or
 *    *), so no candidate runs on without end and V8's backtracking stack
 *    stays shallow on megabyte-long values (Docs/notifications/README.md,
 *    "Megabyte-long values"). TextScanner also hands it bounded windows.
 *  - It cannot match inside a longer token: it starts and ends with a
 *    look-around (`(?<![A-Za-z0-9])` ... `(?![A-Za-z0-9])`) or a literal that
 *    no token can continue, so 4111111111111111 is not found inside
 *    94111111111111111.
 *  - The value is the whole match, or the capture group `valueGroup` names.
 */

export interface DataTypeDetector {
  // The data type it finds (DataTypeCatalog.ts).
  dataTypeId: string;

  /*
   * A cheap test that rules out text that cannot hold a match - a literal
   * every match carries ("@", "AKIA", "-----BEGIN"), or a digit - run before
   * the pattern, on the window's lower-cased copy when `quickCheckLowerCase`
   * is set and on the window itself otherwise.
   */
  quickCheck?: ((text: string) => boolean) | undefined;
  quickCheckLowerCase?: boolean | undefined;

  // Finds candidates: global, bounded, never inside a longer token.
  pattern: RegExp;

  // The capture group that holds the value; the whole match when absent.
  valueGroup?: number | undefined;

  /*
   * Turns a candidate into the form it is validated, compared and counted
   * in: a card number without its spaces, an email in lower case.
   */
  normalize?: ((value: string) => string) | undefined;

  /*
   * Whether a candidate is real: a checksum, a range, a real date. Gets the
   * normalized value and the text as matched. A refused candidate is no
   * finding at all.
   */
  validate?: ((normalized: string, raw: string) => boolean) | undefined;

  /*
   * Lower-case words that, near a candidate (CONTEXT_BEFORE characters
   * before it or CONTEXT_AFTER after it), say what it is. A field whose name
   * matches one of the type's name hints counts the same.
   */
  keywords?: ReadonlyArray<string> | undefined;

  /*
   * Lower-case words that, near a candidate, say it is something else - an
   * order number, a tracking ID - and drop its confidence a level.
   */
  negativeKeywords?: ReadonlyArray<string> | undefined;

  /*
   * Whether a candidate counts only with context: nine digits are too
   * common to be a routing number on their own.
   */
  requiresContext?: boolean | undefined;

  /*
   * How sure a validated candidate is with nothing around it. Context raises
   * it one level, to High at most.
   */
  confidenceWithoutContext: DataConfidence;

  /*
   * How much the detector's own rules prove, from 1 (a shape) to 3 (a
   * checksum and a fixed prefix). When two types claim the same characters,
   * the surer finding wins; on a tie the one its own words confirm, then the
   * more specific detector.
   */
  specificity: 1 | 2 | 3;

  // Known test and example values, normalized: counted apart, never findings.
  isTestValue?: ((normalized: string) => boolean) | undefined;

  /*
   * How far around a candidate this type's context words are looked for,
   * when the defaults reach too far: "account number" five words before a
   * nine-digit number says nothing about it.
   */
  contextBefore?: number | undefined;
  contextAfter?: number | undefined;

  /*
   * For a field whose name hints at this type: the shape a whole value of
   * that field must have to count (anchored, not global), when the value
   * has nothing the pattern could find on its own - a column named `cvv`
   * holding "123".
   */
  fieldValuePattern?: RegExp | undefined;

  /*
   * Whether the text is also read with its percent-escapes read
   * (PercentDecodedText.ts): an IP address in a URL's query string has its
   * colons written %3A (#10467), an email address its "@" %40 (#10935). A
   * candidate found so is validated as it reads and placed on the
   * characters it is written with, so the finding - and what a scrub rule
   * hides - is the encoded value whole (TextReadings.ts).
   */
  readsPercentEncoded?: boolean | undefined;

  /*
   * Whether the text is also read with every script's decimal digits read
   * as the ASCII digits of their values (DigitReadings.ts): a card number
   * written in fullwidth, Arabic-Indic or Persian digits (#10960). Each
   * script's digits are read alone first, so another script's digit beside
   * a value is no part of it, then all of them together, so a number typed
   * in two scripts is read whole. A digit is one character either way, so a
   * candidate found so is on the very characters it is written with.
   */
  readsDigitsOfEveryScript?: boolean | undefined;

  /*
   * What a database search narrows by for this detector, as an RE2
   * expression that matches at least every text its pattern matches - for
   * a pattern DetectorPrefilter cannot write itself, one with the u flag.
   * More is fine, never less.
   */
  prefilter?: string | undefined;
}

// How far around a candidate its context words are looked for.
export const CONTEXT_BEFORE: number = 64;
export const CONTEXT_AFTER: number = 32;

// A digit somewhere in the text: the quick check of every numeric type.
export function hasDigit(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code >= 48 && code <= 57) {
      return true;
    }
  }

  return false;
}

// A quick check that passes when the text holds any of these literals.
export function containsAny(
  literals: ReadonlyArray<string>,
): (text: string) => boolean {
  return (text: string): boolean => {
    for (const literal of literals) {
      if (text.includes(literal)) {
        return true;
      }
    }

    return false;
  };
}

/*
 * Only the digits of a value, in ASCII: "4111 1111-1111 1111" becomes
 * "4111111111111111", and so does "４１１１ １１１１ １１１１ １１１１" - a digit of
 * any script of DigitReadings is read by its value (#10960).
 */
export function digitsOnly(value: string): string {
  let digits: string = "";

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code >= 48 && code <= 57) {
      digits += value[index];
    } else if (code > 0x7f) {
      const digit: number = digitValueOf(code);

      if (digit >= 0) {
        digits += String(digit);
      }
    }
  }

  return digits;
}

// Letters and digits only, upper-cased: "ab 12-cd" becomes "AB12CD".
export function alphanumericUpper(value: string): string {
  let kept: string = "";

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122)
    ) {
      kept += value[index];
    }
  }

  return kept.toUpperCase();
}

/*
 * Whether a run of digits is a placeholder rather than a number someone
 * holds: one digit repeated (000000000, 1111111111111111) or a straight run
 * up or down (123456789, 987654321). Every numeric detector refuses these.
 */
export function isPlaceholderDigits(digits: string): boolean {
  if (digits.length < 4) {
    return false;
  }

  let allSame: boolean = true;
  let ascending: boolean = true;
  let descending: boolean = true;

  for (let index: number = 1; index < digits.length; index++) {
    const previous: number = digits.charCodeAt(index - 1) - 48;
    const current: number = digits.charCodeAt(index) - 48;

    if (current !== previous) {
      allSame = false;
    }

    if (current !== (previous + 1) % 10) {
      ascending = false;
    }

    if (current !== (previous + 9) % 10) {
      descending = false;
    }
  }

  return allSame || ascending || descending;
}
