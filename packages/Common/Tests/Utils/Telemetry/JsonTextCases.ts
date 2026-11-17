/*
 * JSON TEXTS TO SCRUB: A SEEDED GENERATOR, AND A READER OF THEIR TOKENS.
 *
 * For the property tests of Utils/Telemetry/ScrubJsonText.ts (#8923) here
 * and of the scrub rules over real records in App/Tests/Telemetry: random
 * lists and maps whose texts hold what makes a JSON text hard to scrub -
 * every character JSON writes as an escape, accented letters, Chinese, a
 * surrogate pair, U+2028 - with secrets (addresses, card, Social Security
 * and phone numbers, IP addresses) at every boundary: the first and last
 * thing in a text, right after and right before each of those characters,
 * as a key, as a number, and inside a JSON text held in a string. Each is
 * written three ways: as JSON.stringify writes it, indented, and the way
 * other producers do (Python's ensure_ascii, PHP's escaped slash, letters
 * written as \u escapes).
 *
 * The reader is written apart from the scrubber on purpose - a regular
 * expression over the text, not the scrubber's own walk - so a test that
 * compares what both read is not the scrubber agreeing with itself.
 */

import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

// The suites' one seeded generator (mulberry32): the same cases every run.
export type Random = SeededRandom;

export { seededRandom };

export function pick<T>(random: Random, items: ReadonlyArray<T>): T {
  return items[Math.floor(random() * items.length)]!;
}

// What each built-in scrub rule finds, written as an application would.
export const SECRETS: Readonly<Record<string, ReadonlyArray<string>>> = {
  email: [
    "ada@example.com",
    "grace.hopper+ops@navy.example.mil",
    "x_y-z@sub.example.co",
  ],
  creditCard: [
    "4111 1111 1111 1111",
    "5500-0000-0000-0004",
    "4012888888881881",
  ],
  ssn: ["123-45-6789", "078-05-1120"],
  phoneNumber: ["555-123-4567", "(555) 123-4567", "+1 555.123.4567"],
  ipAddress: ["10.0.0.12", "192.168.1.1", "8.8.8.8"],
};

// Numbers a rule finds when a JSON text holds them as numbers.
export const SECRET_NUMBERS: ReadonlyArray<number> = [
  5551234567, 4111111111111111, -5551234567, 15551234567,
];

/*
 * The characters next to which a match is hard to place: each one JSON
 * writes as an escape (and the slash, which it may), a letter or a digit
 * after an escape, accented, Chinese and astral characters, the line
 * separator, and JSON's own punctuation inside a text.
 */
export const HARD_CHARACTERS: ReadonlyArray<string> = [
  "\n",
  "\t",
  "\r",
  "\b",
  "\f",
  '"',
  "\\",
  "/",
  "\u0000",
  "\u0007",
  "\u001f",
  "\u007f",
  "é",
  "中",
  "😀",
  // The line separator: JSON.stringify writes it as it is.
  String.fromCharCode(0x2028),
  " ",
  ",",
  ":",
  "{",
  "}",
  "[",
  "]",
  "x",
  "9",
  "-",
  ".",
  "@",
];

const WORDS: ReadonlyArray<string> = [
  "line",
  "user",
  "card",
  "retry",
  "ok",
  "café",
  "日本語",
  "token",
  "a",
  "",
];

export interface CaseOptions {
  // How many JSON texts deep a string may hold another.
  jsonInsideStrings: number;
}

// A text with secrets at every kind of boundary, and hard characters.
export function randomText(random: Random): string {
  const pieces: Array<string> = [];
  const count: number = Math.floor(random() * 6);

  for (let index: number = 0; index < count; index++) {
    const roll: number = random();

    if (roll < 0.3) {
      pieces.push(pick(random, SECRETS[pick(random, Object.keys(SECRETS))]!));
    } else if (roll < 0.7) {
      pieces.push(pick(random, HARD_CHARACTERS));
    } else {
      pieces.push(pick(random, WORDS));
    }
  }

  return pieces.join("");
}

export function randomJsonValue(
  random: Random,
  depth: number,
  options: CaseOptions,
): unknown {
  const roll: number = random();

  if (depth > 0 && roll < 0.35) {
    const map: Record<string, unknown> = {};
    const size: number = Math.floor(random() * 4);

    for (let index: number = 0; index < size; index++) {
      // A key is a text too: a secret can be one.
      map[random() < 0.8 ? pick(random, WORDS) + index : randomText(random)] =
        randomJsonValue(random, depth - 1, options);
    }

    return map;
  }

  if (depth > 0 && roll < 0.55) {
    const size: number = Math.floor(random() * 4);
    const list: Array<unknown> = [];

    for (let index: number = 0; index < size; index++) {
      list.push(randomJsonValue(random, depth - 1, options));
    }

    return list;
  }

  if (roll < 0.62 && options.jsonInsideStrings > 0) {
    // A JSON text held in a string: a Fluentd record's `log`.
    return JSON.stringify(
      randomJsonValue(random, 2, {
        jsonInsideStrings: options.jsonInsideStrings - 1,
      }),
    );
  }

  if (roll < 0.68) {
    return pick(random, SECRET_NUMBERS);
  }

  if (roll < 0.72) {
    return pick(random, [0, -1.5, 3e21, 42, 7.25e-3]);
  }

  if (roll < 0.76) {
    return pick(random, [true, false, null]);
  }

  return randomText(random);
}

// A list or a map at the top, as a structured body is.
export function randomJsonListOrMap(
  random: Random,
  options: CaseOptions,
): unknown {
  for (;;) {
    const value: unknown = randomJsonValue(random, 4, options);

    if (value !== null && typeof value === "object") {
      return value;
    }
  }
}

export type JsonStyle = "compact" | "indented" | "escaped";

export const JSON_STYLES: ReadonlyArray<JsonStyle> = [
  "compact",
  "indented",
  "escaped",
];

// What the escaped style writes as a \u escape now and then.
const ESCAPED_SOMETIMES: RegExp = /[A-Za-z0-9@.]/;

function unicodeEscape(code: number): string {
  return "\\u" + code.toString(16).padStart(4, "0");
}

/*
 * A string token as other producers write it: every character past ASCII
 * as a \u escape (each half of a surrogate pair its own, as Python does),
 * the slash escaped (as PHP does), and some letters and digits as \u
 * escapes too. The escapes it holds already are kept as they are.
 */
function escapeStringToken(token: string, random: Random): string {
  const pieces: Array<string> = ['"'];
  let at: number = 1;

  while (at < token.length - 1) {
    const character: string = token.charAt(at);

    if (character === "\\") {
      const length: number = token.charAt(at + 1) === "u" ? 6 : 2;

      pieces.push(token.slice(at, at + length));
      at += length;
      continue;
    }

    const code: number = token.charCodeAt(at);

    if (code > 0x7e) {
      pieces.push(unicodeEscape(code));
    } else if (character === "/") {
      pieces.push("\\/");
    } else if (ESCAPED_SOMETIMES.test(character) && random() < 0.15) {
      pieces.push(unicodeEscape(code));
    } else {
      pieces.push(character);
    }

    at++;
  }

  pieces.push('"');

  return pieces.join("");
}

export function writeJson(
  value: unknown,
  style: JsonStyle,
  random: Random,
): string {
  if (style === "indented") {
    return JSON.stringify(value, null, 2);
  }

  const compact: string = JSON.stringify(value);

  if (style === "compact") {
    return compact;
  }

  return readJsonTokens(compact)
    .map((token: JsonToken): string => {
      return token.kind === "string"
        ? escapeStringToken(token.text, random)
        : token.text;
    })
    .join("");
}

export interface JsonToken {
  // A string - a key or a value - a number, true, false or null, or the rest.
  kind: "string" | "scalar" | "punctuation" | "space";
  text: string;
}

const TOKEN: RegExp =
  /"(?:[^"\\]|\\.)*"|[{}[\]:,]|[ \t\n\r]+|[^ \t\n\r{}[\]:,"]+/y;

/*
 * The tokens of a JSON text, read with a regular expression over it - not
 * with the scrubber's walk. Throws on what is not a JSON text's token.
 */
export function readJsonTokens(jsonText: string): Array<JsonToken> {
  const tokens: Array<JsonToken> = [];

  TOKEN.lastIndex = 0;

  while (TOKEN.lastIndex < jsonText.length) {
    const at: number = TOKEN.lastIndex;
    const match: RegExpExecArray | null = TOKEN.exec(jsonText);

    if (match === null || match.index !== at) {
      throw new Error(`No JSON token at ${at} of ${jsonText}`);
    }

    const text: string = match[0];
    const first: string = text.charAt(0);

    tokens.push({
      kind:
        first === '"'
          ? "string"
          : "{}[]:,".includes(first)
            ? "punctuation"
            : " \t\n\r".includes(first)
              ? "space"
              : "scalar",
      text: text,
    });
  }

  return tokens;
}

// Whether a text has half of a surrogate pair without the other half.
export function hasLoneSurrogate(text: string): boolean {
  for (let at: number = 0; at < text.length; at++) {
    const code: number = text.charCodeAt(at);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next: number = text.charCodeAt(at + 1);

      if (next >= 0xdc00 && next <= 0xdfff) {
        at++;
        continue;
      }

      return true;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }

  return false;
}
