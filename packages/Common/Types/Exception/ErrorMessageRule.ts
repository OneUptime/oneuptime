/*
 * What an error message a person reads must be (#6836, the rule in
 * Docs/ux/README.md#errors): a sentence that says what happened and what to
 * do next. This file holds the two checks a program can make of that:
 *
 * - it is not one of the empty phrases on its own - "Server Error",
 *   "Something went wrong", "Invalid request" - which say that something
 *   failed and nothing else;
 * - it is a sentence: it starts with a capital letter (or a value) and ends
 *   with a full stop, a question mark or an exclamation mark.
 *
 * The UI uses the first to treat an empty answer from the server as one the
 * server did not explain (API.getFriendlyMessage), and ErrorMessagesGuard
 * holds every message the code throws to both. React-free and server-safe.
 */

/*
 * The phrases that say only that something failed. Compared without case,
 * without the punctuation around them and without a trailing "Please try
 * again", so "Server Error. Please try again" and "Internal Server Error"
 * count as well.
 */
export const EMPTY_ERROR_PHRASES: ReadonlyArray<string> = [
  "server error",
  "internal server error",
  "something went wrong",
  "oops something went wrong",
  "sorry something went wrong",
  "invalid request",
  "bad request",
  "an error occurred",
  "an error has occurred",
  "an unexpected error occurred",
  "an unexpected error has occurred",
  "unknown error",
  "error",
  "request failed",
  "failed",
  "bad gateway",
  "service unavailable",
];

// A request to try again that adds nothing to an empty phrase.
const TRAILING_TRY_AGAIN: ReadonlyArray<string> = [
  "please try again later",
  "please try again",
  "try again later",
  "try again",
];

const isLetter: (character: string) => boolean = (
  character: string,
): boolean => {
  return character.toLowerCase() !== character.toUpperCase();
};

/*
 * The words of a message, lower case, with everything that is not a letter,
 * a digit or a space turned into a space and the spaces squeezed: "Oops,
 * something went wrong." reads "oops something went wrong".
 */
const toWords: (message: string) => string = (message: string): string => {
  let words: string = "";

  for (const character of message.toLowerCase()) {
    const isWordCharacter: boolean =
      isLetter(character) || (character >= "0" && character <= "9");

    words += isWordCharacter ? character : " ";
  }

  return words.split(" ").filter(Boolean).join(" ");
};

/*
 * Whether the message is one of the empty phrases and nothing else - also
 * an empty message, which says even less.
 */
export const isEmptyErrorPhrase: (
  message: string | undefined | null,
) => boolean = (message: string | undefined | null): boolean => {
  let words: string = toWords(message || "");

  for (const tryAgain of TRAILING_TRY_AGAIN) {
    if (words === tryAgain) {
      // "Please try again" alone says nothing about what happened either.
      return true;
    }

    if (words.endsWith(` ${tryAgain}`)) {
      words = words.substring(0, words.length - tryAgain.length - 1);
      break;
    }
  }

  return words.length === 0 || EMPTY_ERROR_PHRASES.includes(words);
};

// What may close a sentence after its full stop: a quote or a bracket.
const CLOSING_MARKS: string = `"'”’)]»`;

// What may open a sentence before its first word.
const OPENING_MARKS: string = `"'“‘([«¿¡`;

// The marks a sentence may end with.
const SENTENCE_ENDS: string = ".!?…。！？";

/*
 * Whether the message is a sentence: it starts with a capital letter, a
 * digit or a value, and ends with a full stop, a question mark or an
 * exclamation mark (a closing quote or bracket may follow it). A value is
 * written as {{name}} or ${...}: "{{name}} is already taken." is a sentence.
 * A message that is several sentences counts as one when its first starts
 * and its last ends that way.
 */
export const isErrorSentence: (
  message: string | undefined | null,
) => boolean = (message: string | undefined | null): boolean => {
  const text: string = (message || "").trim();

  if (!text) {
    return false;
  }

  // The first character that is not an opening mark.
  let start: number = 0;

  while (start < text.length && OPENING_MARKS.includes(text[start] as string)) {
    start++;
  }

  const rest: string = text.substring(start);

  const startsWithValue: boolean =
    rest.startsWith("{{") || rest.startsWith("${");

  const first: string = rest.charAt(0);

  const startsRight: boolean =
    startsWithValue ||
    (first >= "0" && first <= "9") ||
    (isLetter(first) && first === first.toUpperCase());

  if (!startsRight) {
    return false;
  }

  /*
   * A value after a full stop is a sentence of its own - another message,
   * passed on: "The code was not sent to {{number}}. {{reason}}".
   */
  for (const value of ["${value}", "{{reason}}", "{{error}}", "{{message}}"]) {
    if (text.endsWith(`. ${value}`)) {
      return true;
    }
  }

  // The last character that is not a closing mark.
  let end: number = text.length - 1;

  while (end >= 0 && CLOSING_MARKS.includes(text[end] as string)) {
    end--;
  }

  return end >= 0 && SENTENCE_ENDS.includes(text[end] as string);
};

/*
 * Whether a message meets what a program can check of the rule: a sentence,
 * and more than an empty phrase.
 */
export const meetsErrorMessageRule: (
  message: string | undefined | null,
) => boolean = (message: string | undefined | null): boolean => {
  return !isEmptyErrorPhrase(message) && isErrorSentence(message);
};
