/*
 * Token colouring for one line of pretty-printed JSON (JSON.stringify with
 * an indent), for the attribute JSON view. Rendered as React text, never as
 * HTML, so a value such as `<img onerror=...>` is shown and not parsed.
 *
 * JSON.stringify escapes every newline inside a string, so a line never
 * starts or ends inside a string and each line can be read on its own.
 */

export type JSONTokenKind =
  | "key"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "punctuation";

export interface JSONToken {
  text: string;
  kind: JSONTokenKind;
}

/*
 * A string (with any escaped character, including an escaped quote),
 * optionally followed by the colon that makes it a key; a literal; a number.
 * The leftmost match wins, so digits inside a string never read as a number.
 */
const TOKEN_PATTERN: RegExp =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\b(null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

export function tokenizeJSONLine(line: string): Array<JSONToken> {
  const tokens: Array<JSONToken> = [];
  let cursor: number = 0;

  const pushPunctuation: (text: string) => void = (text: string): void => {
    if (text) {
      tokens.push({ text, kind: "punctuation" });
    }
  };

  TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = TOKEN_PATTERN.exec(line);

  while (match) {
    pushPunctuation(line.slice(cursor, match.index));

    if (match[1] !== undefined) {
      tokens.push({ text: match[1], kind: match[2] ? "key" : "string" });

      if (match[2]) {
        pushPunctuation(match[2]);
      }
    } else if (match[3] !== undefined) {
      tokens.push({ text: match[3], kind: "boolean" });
    } else if (match[4] !== undefined) {
      tokens.push({ text: match[4], kind: "null" });
    } else {
      tokens.push({ text: match[0], kind: "number" });
    }

    cursor = match.index + match[0].length;
    match = TOKEN_PATTERN.exec(line);
  }

  pushPunctuation(line.slice(cursor));

  return tokens;
}

export const JSON_TOKEN_CLASS_NAMES: Readonly<Record<JSONTokenKind, string>> = {
  key: "text-indigo-700",
  string: "text-emerald-700",
  number: "text-amber-700",
  boolean: "text-sky-700",
  null: "italic text-gray-400",
  punctuation: "text-gray-400",
};
