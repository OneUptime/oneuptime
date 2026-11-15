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
 * holds every message the code throws to both. Both read a message in any
 * script: a message in Persian, Japanese or Hindi says something (#7536).
 * React-free and server-safe.
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

/*
 * A letter of any script (#7536). It used to be a character whose upper and
 * lower case differ, which only Latin, Greek, Cyrillic and a few other
 * scripts have: a message written in Arabic, Persian, Hebrew, Chinese,
 * Japanese, Korean, Hindi or Thai had no letters at all, so it read as an
 * empty message and was replaced with the English sentence for a failure
 * nobody explained. Each test reads one character, in linear time.
 */
const LETTER: RegExp = /^\p{L}$/u;

// A digit of any script: "404", Arabic-Indic "٤٠٤", full-width "５０３".
const DIGIT: RegExp = /^\p{Nd}$/u;

/*
 * What else a word is written with: any other number ("½", "Ⅻ") and the
 * marks a letter carries (Hindi's and Thai's vowel signs, Arabic's
 * harakat), so a word in those scripts is not cut in pieces.
 */
const NUMBER_OR_MARK: RegExp = /^[\p{N}\p{M}]$/u;

const isLetter: (character: string) => boolean = (
  character: string,
): boolean => {
  return LETTER.test(character);
};

const isDigit: (character: string) => boolean = (
  character: string,
): boolean => {
  return DIGIT.test(character);
};

/*
 * The words of a message, lower case, with everything that is not a letter,
 * a number, a mark or a space turned into a space and the spaces squeezed:
 * "Oops, something went wrong." reads "oops something went wrong". A message
 * of punctuation and symbols alone ("...", "—", "❌") has no words, so it
 * says nothing in any language.
 */
const toWords: (message: string) => string = (message: string): string => {
  let words: string = "";

  for (const character of message.toLowerCase()) {
    const isWordCharacter: boolean =
      isLetter(character) || NUMBER_OR_MARK.test(character);

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

/*
 * What a proxy, a gateway or a web server says on its own for a 413, when
 * it says anything but a page: its status, in the words of whichever RFC or
 * product it follows - nginx's and HAProxy's "Request Entity Too Large",
 * RFC 7231's "Payload Too Large", RFC 9110's "Content Too Large", Amazon
 * API Gateway's "Request Too Long", Go's "http: request body too large",
 * Kong's "Request size limit exceeded". Compared as isEmptyErrorPhrase
 * compares, after a leading "413" or "Error 413".
 */
export const TOO_LARGE_PHRASES: ReadonlyArray<string> = [
  "request entity too large",
  "payload too large",
  "content too large",
  "entity too large",
  "request too large",
  "request too long",
  "request body too large",
  "http request body too large",
  "body too large",
  "request size limit exceeded",
  "request body size limit exceeded",
  "request content length exceeded",
];

// What may come before a 413's own phrase: "413", "Error 413", "HTTP 413".
const TOO_LARGE_STATUS_PREFIXES: ReadonlyArray<string> = [
  "error 413 ",
  "http 413 ",
  "status 413 ",
  "413 ",
];

/*
 * Whether the message is only what a proxy says for a 413 (TOO_LARGE_PHRASES),
 * which says that it was too large and nothing about what to do. A message
 * OneUptime wrote for a 413 is a sentence that says more ("Request body too
 * large. The gzip body of a gzip-encoded request may not exceed 4194304
 * bytes.") and is not one.
 */
export const isTooLargePhrase: (
  message: string | undefined | null,
) => boolean = (message: string | undefined | null): boolean => {
  let words: string = toWords(message || "");

  for (const prefix of TOO_LARGE_STATUS_PREFIXES) {
    if (words.startsWith(prefix)) {
      words = words.substring(prefix.length);
      break;
    }
  }

  return TOO_LARGE_PHRASES.includes(words);
};

/*
 * Whether the "message" is a page rather than a message: the HTML (or XML)
 * a gateway, a proxy or a web server answers with - nginx's "<html><head>
 * <title>502 Bad Gateway</title>...", a load balancer's 503, a CDN's error
 * page, the app's own index.html on a route that is not the API's. It
 * starts with a tag or a doctype and ends with a tag. Its words are markup
 * and a server's name, nothing a person can act on, so the UI says what
 * happened instead (API.getFriendlyMessage). A message that only starts
 * with a tag ("<script> is not allowed in a name.") is a message.
 */
export const isErrorPage: (message: string | undefined | null) => boolean = (
  message: string | undefined | null,
): boolean => {
  const text: string = (message || "").trim();

  if (!text.startsWith("<") || !text.endsWith(">")) {
    return false;
  }

  const second: string = text.charAt(1);

  return (
    second === "!" ||
    second === "?" ||
    (second.toLowerCase() >= "a" && second.toLowerCase() <= "z")
  );
};

// What may close a sentence after its full stop: a quote or a bracket.
const CLOSING_MARKS: string = `"'”’)]»」』`;

// What may open a sentence before its first word.
const OPENING_MARKS: string = `"'“‘„([«¿¡「『`;

/*
 * The marks a sentence may end with, in the scripts OneUptime is read in:
 * also Japanese's and Chinese's full stops, Arabic's and Persian's question
 * mark, Urdu's full stop and Hindi's danda.
 */
const SENTENCE_ENDS: string = ".!?…。！？．｡؟۔।॥";

/*
 * Whether the message is a sentence: it starts with a capital letter, a
 * digit or a value, and ends with a full stop, a question mark or an
 * exclamation mark (a closing quote or bracket may follow it). A value is
 * written as {{name}} or ${...}: "{{name}} is already taken." is a sentence.
 * A message that is several sentences counts as one when its first starts
 * and its last ends that way. A letter of a script with no capitals (Arabic,
 * Chinese, Hindi) starts a sentence as a capital does (#7536):
 * ErrorMessagesGuard still holds OneUptime's own English messages to a
 * capital, since a lower-case Latin letter is not one.
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

  // The whole first character, also one outside the Basic Multilingual Plane.
  const firstCodePoint: number | undefined = rest.codePointAt(0);

  const first: string =
    firstCodePoint === undefined ? "" : String.fromCodePoint(firstCodePoint);

  const startsRight: boolean =
    startsWithValue ||
    isDigit(first) ||
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
