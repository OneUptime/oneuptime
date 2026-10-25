/*
 * WHERE A LONG NAME MAY BREAK. Text OneUptime shows often names what a
 * service named: a metric ("http.server.request.count"), an attribute
 * ("user.id"), an operation ("POST /orders/{id}"). On a narrow screen a
 * long one must break, and left to the browser (overflow-wrap: anywhere)
 * it broke at whatever letter filled the line - "request.coun" / "t".
 * Split here, a long name may break after its own separators first - a dot
 * or a slash inside it, before a letter or a placeholder - so it wraps as
 * "http.server.request." / "count"; a part still too long for its line
 * breaks anywhere, as before. Callers put a <wbr> between the parts: it
 * adds no character, so copying, searching and screen readers read the text
 * as written.
 *
 * Only a long name gets the breaks (NAME_BREAKS_FROM_LENGTH): a short one
 * ("user.id") fits on a line of its own, and breaking it would only split
 * it where a space before it would have done. A number's decimal point
 * ("4.8") and a sentence's full stop are left whole: neither is followed by
 * a letter inside a word.
 */

// The shortest name that may break inside: about half a phone's line.
export const NAME_BREAKS_FROM_LENGTH: number = 20;

// What may start the part after a separator: a letter, or a "{id}".
const NAME_PART_START: RegExp = /[\p{L}{]/u;
const WHITESPACE: RegExp = /\s/u;

// One word's parts, each but the last ending in a separator.
function splitWord(word: string): Array<string> {
  if (word.length < NAME_BREAKS_FROM_LENGTH) {
    return [word];
  }

  const parts: Array<string> = [];
  let current: string = "";

  for (let index: number = 0; index < word.length; index++) {
    const character: string = word.charAt(index);
    const next: string = word.charAt(index + 1);

    current += character;

    if (
      (character === "." || character === "/") &&
      index > 0 &&
      next !== "" &&
      NAME_PART_START.test(next)
    ) {
      parts.push(current);
      current = "";
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

// The text in parts, each but the last ending in a separator. Linear.
export function splitAtNameBreaks(text: string): Array<string> {
  const parts: Array<string> = [];
  let current: string = "";
  let word: string = "";

  const endWord: () => void = (): void => {
    if (!word) {
      return;
    }

    const wordParts: Array<string> = splitWord(word);

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
