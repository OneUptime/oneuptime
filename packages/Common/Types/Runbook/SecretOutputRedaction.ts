/*
 * SECRET VARIABLES NEVER SHOW IN A STEP'S OUTPUT.
 *
 * A step that runs with a secret runbook variable - a script that names one,
 * an SSH step's key or password, a kubectl step's kubeconfig - gets the
 * value itself, and what the step prints is kept with the run, where
 * everyone who may read the runbook's runs reads it. So before output or an
 * error message is stored, every secret the step was given is replaced with
 * [REDACTED], the word workflow logs use for their secret variables: by the
 * Runner, before the text leaves its host, and again by the server before it
 * stores the text, whatever the Runner sent (an older Runner does not know
 * to).
 *
 * What is looked for, for each secret:
 *
 *   - the whole value (white space around it aside);
 *   - for a value of several lines - a private key, a kubeconfig - each line
 *     that is one long word (a key's base64 lines, a token), and each long
 *     word after a "name:" or "name=" (a kubeconfig's token or
 *     client-key-data). A program that prints one line of a key, or the
 *     token alone, prints part of the secret, not the whole value. An
 *     address (http://, https://) is not a secret and is left alone, so an
 *     error that names the API server still says which one.
 *
 * A value shorter than MIN_REDACTED_SECRET_LENGTH is not looked for: every
 * output holds two or three characters somewhere, and replacing them would
 * make it unreadable. Longer pieces are replaced first, so one secret that
 * holds another is never left half shown.
 *
 * Plain string searches, no patterns: the time grows with the output's
 * length and the number of pieces, never with their square.
 */

export const REDACTED_SECRET_TEXT: string = "[REDACTED]";

// A whole value shorter than this is not looked for.
export const MIN_REDACTED_SECRET_LENGTH: number = 4;

// A piece of a value of several lines shorter than this is not looked for.
export const MIN_REDACTED_SECRET_PIECE_LENGTH: number = 24;

function isWhiteSpace(code: number): boolean {
  return (
    code === 32 || // space
    code === 9 || // tab
    code === 10 || // line feed
    code === 13 || // carriage return
    code === 11 || // vertical tab
    code === 12 // form feed
  );
}

function isOneWord(text: string): boolean {
  if (!text) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    if (isWhiteSpace(text.charCodeAt(index))) {
      return false;
    }
  }

  return true;
}

function isAddress(text: string): boolean {
  const lower: string = text.toLowerCase();

  return lower.startsWith("http://") || lower.startsWith("https://");
}

function withoutQuotes(text: string): string {
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")))
  ) {
    return text.slice(1, -1);
  }

  return text;
}

/*
 * The long word after the first ":" or "=" of a line - "token: eyJ...",
 * "client-key-data: LS0t...", "PASSWORD=..." - or "" when there is none.
 */
function getAssignedWord(line: string): string {
  const colon: number = line.indexOf(":");
  const equals: number = line.indexOf("=");

  let at: number = -1;

  if (colon !== -1 && (equals === -1 || colon < equals)) {
    at = colon;
  } else if (equals !== -1) {
    at = equals;
  }

  if (at === -1) {
    return "";
  }

  return withoutQuotes(line.slice(at + 1).trim());
}

// The pieces of one secret to look for, longest first.
export function getSecretPieces(value: string): Array<string> {
  if (typeof value !== "string") {
    return [];
  }

  const pieces: Set<string> = new Set<string>();
  const whole: string = value.trim();

  if (whole.length >= MIN_REDACTED_SECRET_LENGTH) {
    pieces.add(whole);
  }

  if (whole.indexOf("\n") !== -1) {
    for (const rawLine of whole.split("\n")) {
      const line: string = rawLine.trim();

      if (
        line.length >= MIN_REDACTED_SECRET_PIECE_LENGTH &&
        isOneWord(line) &&
        !isAddress(line)
      ) {
        pieces.add(line);
      }

      const word: string = getAssignedWord(line);

      if (
        word.length >= MIN_REDACTED_SECRET_PIECE_LENGTH &&
        isOneWord(word) &&
        !isAddress(word)
      ) {
        pieces.add(word);
      }
    }
  }

  return [...pieces];
}

// Every piece of every secret, each once, longest first.
export function getSecretPiecesForRedaction(
  values: Array<string | null | undefined>,
): Array<string> {
  const pieces: Set<string> = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    for (const piece of getSecretPieces(value)) {
      pieces.add(piece);
    }
  }

  return [...pieces].sort((first: string, second: string): number => {
    return second.length - first.length;
  });
}

function replaceEvery(text: string, piece: string): string {
  let at: number = text.indexOf(piece);

  if (at === -1) {
    return text;
  }

  const parts: Array<string> = [];
  let from: number = 0;

  while (at !== -1) {
    parts.push(text.slice(from, at), REDACTED_SECRET_TEXT);
    from = at + piece.length;
    at = text.indexOf(piece, from);
  }

  parts.push(text.slice(from));

  return parts.join("");
}

/*
 * `text` with every piece of every secret in `secretValues` replaced by
 * [REDACTED].
 */
export function redactSecretValues(
  text: string,
  secretValues: Array<string | null | undefined>,
): string {
  if (typeof text !== "string" || !text) {
    return text;
  }

  let redacted: string = text;

  for (const piece of getSecretPiecesForRedaction(secretValues)) {
    redacted = replaceEvery(redacted, piece);
  }

  return redacted;
}
