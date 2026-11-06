/*
 * WHERE A LONG NAME MAY BREAK. Text OneUptime shows often names what a
 * service named: a metric ("http.server.request.count"), an attribute
 * ("user.id"), an operation ("POST /orders/{id}"). On a narrow screen a
 * long one must break, and left to the browser (overflow-wrap: anywhere)
 * it broke at whatever letter filled the line - "request.coun" / "t".
 * Split here, a long name may break after its own separators first - a dot
 * or a slash inside it, before a letter or a placeholder - so it wraps as
 * "http.server.request." / "count"; a part still too long for its line
 * breaks anywhere, as before. A name with neither, as Prometheus and StatsD
 * write a metric's, breaks after its underscores instead:
 * "http_server_request_" / "duration_seconds", where it broke at whatever
 * letter filled the line. A name with dots keeps its underscores whole -
 * "container.blockio." / "io_service_bytes_recursive" - its dots say where
 * its words are. Callers put a <wbr> between the parts: it adds no
 * character, so copying, searching and screen readers read the text as
 * written.
 *
 * Only a long name gets the breaks (NAME_BREAKS_FROM_LENGTH): a short one
 * ("user.id") fits on a line of its own, and breaking it would only split
 * it where a space before it would have done. A name alone in a narrow box
 * - a top-5 row beside its value - has no space before it, so its caller
 * passes a shorter length (fromLength) and an 18-letter host's name breaks
 * as "esx02.acme." / "example", never "esx02.acme.exampl" / "e". A number's
 * decimal point ("4.8") and a sentence's full stop are left whole: neither
 * is followed by a letter inside a word.
 */

// The shortest name that may break inside: about half a phone's line.
export const NAME_BREAKS_FROM_LENGTH: number = 20;

/*
 * What a name's parts are separated by, in the order they are tried: its
 * dots and slashes, and - in a name that has neither to break at - its
 * underscores.
 */
const NAME_SEPARATORS: ReadonlyArray<ReadonlyArray<string>> = [
  [".", "/"],
  ["_"],
];

// What may start the part after a separator: a letter, or a "{id}".
const NAME_PART_START: RegExp = /[\p{L}{]/u;
const WHITESPACE: RegExp = /\s/u;

/*
 * A word's parts at these separators, each but the last ending in one. A
 * part holds more than separators: the dot of ".env", the slash of "/root"
 * and the underscores of "__private" start their word, never end a part of
 * it. Linear.
 */
function splitWordAt(
  word: string,
  separators: ReadonlyArray<string>,
): Array<string> {
  const parts: Array<string> = [];
  let current: string = "";
  let isNamed: boolean = false;

  for (let index: number = 0; index < word.length; index++) {
    const character: string = word.charAt(index);
    const next: string = word.charAt(index + 1);
    const isSeparator: boolean = separators.includes(character);

    current += character;

    if (!isSeparator) {
      isNamed = true;
    } else if (isNamed && next !== "" && NAME_PART_START.test(next)) {
      parts.push(current);
      current = "";
      isNamed = false;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

// One word's parts, at the first separators it breaks at.
function splitWord(word: string, fromLength: number): Array<string> {
  if (word.length < fromLength) {
    return [word];
  }

  for (const separators of NAME_SEPARATORS) {
    const parts: Array<string> = splitWordAt(word, separators);

    if (parts.length > 1) {
      return parts;
    }
  }

  return [word];
}

/*
 * The text in parts, each but the last ending in a separator. Linear. A
 * word shorter than fromLength stays whole.
 */
export function splitAtNameBreaks(
  text: string,
  fromLength: number = NAME_BREAKS_FROM_LENGTH,
): Array<string> {
  const parts: Array<string> = [];
  let current: string = "";
  let word: string = "";

  const endWord: () => void = (): void => {
    if (!word) {
      return;
    }

    const wordParts: Array<string> = splitWord(word, fromLength);

    // The word's first part joins what came before it on the same part.
    current += wordParts[0];

    for (const part of wordParts.slice(1)) {
      parts.push(current);
      current = part;
    }

    word = "";
  };

  for (let index: number = 0; index < text.length; index++) {
    const character: string = text.charAt(index);

    if (WHITESPACE.test(character)) {
      endWord();
      current += character;
    } else {
      word += character;
    }
  }

  endWord();

  if (current) {
    parts.push(current);
  }

  return parts;
}
