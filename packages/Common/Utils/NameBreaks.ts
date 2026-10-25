/*
 * WHERE A LONG NAME MAY BREAK. Text OneUptime shows often names what a
 * service named: a metric ("http.server.request.count"), an attribute
 * ("user.id"), an operation ("POST /orders/{id}"). On a narrow screen those
 * long words must break, and left to the browser (overflow-wrap: anywhere)
 * one broke at whatever letter filled the line - "request.coun" / "t".
 * Split here, a name may break after its own separators first - a dot or a
 * slash inside a word, before a letter or a placeholder - so it wraps as
 * "http.server.request." / "count"; a part still too long for its line
 * breaks anywhere, as before. Callers put a <wbr> between the parts: it
 * adds no character, so copying, searching and screen readers read the text
 * as written.
 *
 * A number's decimal point ("4.8") and a sentence's full stop are left
 * whole: neither is followed by a letter inside a word.
 */

// What may start the part after a separator: a letter, or a "{id}".
const NAME_PART_START: RegExp = /[\p{L}{]/u;
const WHITESPACE: RegExp = /\s/u;

// The text in parts, each but the last ending in a separator. Linear.
export function splitAtNameBreaks(text: string): Array<string> {
  const parts: Array<string> = [];
  let current: string = "";

  for (let index: number = 0; index < text.length; index++) {
    const character: string = text.charAt(index);
    const previous: string = text.charAt(index - 1);
    const next: string = text.charAt(index + 1);

    current += character;

    if (
      (character === "." || character === "/") &&
      previous !== "" &&
      !WHITESPACE.test(previous) &&
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
