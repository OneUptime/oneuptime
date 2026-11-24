/*
 * AN ERROR NOBODY EXPLAINED, AS THE APP SAYS IT (#7275).
 *
 * When OneUptime's server fails in a way no message describes, it answers
 * with a sentence that says what happened and what to do next, and a
 * reference - the start of the request's id, which one of its log lines
 * names - in a field of its own (Common/Server/Utils/UnexplainedServerError).
 * The Dashboard turns every failure nobody explained into one of a few
 * sentences (Common/Types/Exception/UnexplainedError): the server failed,
 * the server did not answer, OneUptime could not be reached, what was sent
 * was too large, or the page failed. The app said "Error connecting to
 * server", "Internal server error" and "Server error (502)" instead, and
 * could not copy the reference.
 *
 * The app imports nothing from Common at run time, so the sentences, the
 * empty phrases and the reference's shape are copied here, and
 * src/utils/unexplainedError.test.ts holds them to Common's word for word.
 * The app speaks English only, so these are its words in every language it
 * has.
 */

// The field of an error answer that holds the reference (ERROR_REFERENCE_FIELD).
export const ERROR_REFERENCE_FIELD: string = "reference";

// How many characters of the request's id the reference keeps.
export const ERROR_REFERENCE_LENGTH: number = 8;

// The sentences the server and the Dashboard say (UNEXPLAINED_ERROR_MESSAGES).
export const UNEXPLAINED_ERROR_MESSAGES: Readonly<{
  serverWithReference: string;
  server: string;
  unreachable: string;
  page: string;
  tooLarge: string;
  tooLargeForOneUptime: string;
}> = {
  serverWithReference:
    "The server ran into a problem it could not explain, so this did not finish. Try again, and if it keeps failing, give this reference to your administrator or OneUptime support: {{reference}}.",
  server:
    "The server ran into a problem it could not explain, so this did not finish. Try again in a moment.",
  unreachable:
    "OneUptime could not be reached, so this did not finish. Check your internet connection, then try again.",
  page: "This page ran into a problem, so this did not finish. Reload the page, then try again.",
  tooLarge:
    "What was sent was too large for the server to accept, so this did not finish. Try again with less at once, such as a smaller file.",
  tooLargeForOneUptime:
    "What was sent is larger than the 50 MB OneUptime takes in one request, so this did not finish. Try again with less at once, such as a smaller file.",
};

/*
 * A gateway's 502 or 504: the server is down or restarting. The Dashboard
 * says it in two parts (UnexplainedErrorWords.serverDownWhy and
 * serverDownNext); the app, which has one line, says both.
 */
export const SERVER_DOWN_WORDS: Readonly<{ why: string; next: string }> = {
  why: "The OneUptime server did not answer.",
  next: "It may be starting or restarting. Try again in a few minutes.",
};

export const SERVER_DOWN_SENTENCE: string = `${SERVER_DOWN_WORDS.why} ${SERVER_DOWN_WORDS.next}`;

/*
 * The phrases that say only that something failed (EMPTY_ERROR_PHRASES):
 * a server answer that is one of these, and nothing else, is said as the
 * server's sentence instead.
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

const TRAILING_TRY_AGAIN: ReadonlyArray<string> = [
  "please try again later",
  "please try again",
  "try again later",
  "try again",
];

/*
 * The words of a message, lower case, with everything but letters and
 * digits turned into spaces and the spaces squeezed: "Oops, something went
 * wrong." reads "oops something went wrong".
 */
function toWords(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
}

// Whether the message is one of the empty phrases and nothing else.
export function isEmptyErrorPhrase(
  message: string | undefined | null,
): boolean {
  let words: string = toWords(message || "");

  for (const tryAgain of TRAILING_TRY_AGAIN) {
    if (words === tryAgain) {
      return true;
    }

    if (words.endsWith(` ${tryAgain}`)) {
      words = words.substring(0, words.length - tryAgain.length - 1);
      break;
    }
  }

  return words.length === 0 || EMPTY_ERROR_PHRASES.includes(words);
}

/*
 * Whether the "message" is a page rather than a message (isErrorPage): the
 * HTML a gateway or a proxy answers with - nginx's "<html><head><title>502
 * Bad Gateway</title>..." - whose words are markup, nothing to act on.
 */
export function isErrorPage(message: string | undefined | null): boolean {
  const text: string = (message || "").trim();

  if (!text.startsWith("<") || !text.endsWith(">")) {
    return false;
  }

  const second: string = text.charAt(1).toLowerCase();

  return second === "!" || second === "?" || (second >= "a" && second <= "z");
}

// Lower-case hex digits and nothing else; named, as wrap-regex wants.
const LOWER_CASE_HEX: RegExp = /^[0-9a-f]+$/;

// Whether a value is a reference: eight lower-case hex digits.
export function isErrorReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === ERROR_REFERENCE_LENGTH &&
    LOWER_CASE_HEX.test(value)
  );
}

// The server's sentence for a failure it could not explain.
export function getUnexplainedServerErrorMessage(
  reference: string | null | undefined,
): string {
  return isErrorReference(reference)
    ? UNEXPLAINED_ERROR_MESSAGES.serverWithReference.replace(
        "{{reference}}",
        reference,
      )
    : UNEXPLAINED_ERROR_MESSAGES.server;
}
