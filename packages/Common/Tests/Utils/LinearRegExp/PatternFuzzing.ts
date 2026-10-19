import { SeededRandom } from "../../Helpers/SeededRandom";

/*
 * RANDOM PATTERNS, AND THE SAME PATTERNS AS AN ORACLE WRITES THEM.
 *
 * For the suites that hold the linear-time matcher to JavaScript's own
 * engine: a pattern is drawn as a small tree - characters, classes, escapes,
 * groups, look-arounds, repeats greedy and lazy, alternatives - over a small
 * alphabet, so that random texts of the same alphabet match it often, and in
 * many ways.
 *
 * Each pattern is drawn twice over: as the matcher reads it, and as V8 is
 * asked about it. They differ in one thing. V8 has bugs the matcher does
 * not copy, found by this very fuzzing, and the oracle writes the pattern so
 * it does not reach them:
 *
 *  - A ^ or $ after something that reads text (such as (?:[^])*?]^) makes
 *    V8 decide the whole pattern can only match at the start, and miss
 *    matches of its other alternatives. The oracle writes ^ as (?<![^]) and
 *    $ as (?![^]) - with the m flag, as look-arounds for a line terminator -
 *    which mean the same and are not read as anchors.
 *  - Alternatives that differ only in case, such as k|K|k with the i flag,
 *    make V8 drop the Kelvin sign (U+212A) from what the alternation
 *    matches. The patterns hold no Kelvin sign and no long s (U+017F); the
 *    texts do, and the case tables are held to V8 code unit by code unit
 *    (CaseCanonicalization.test.ts).
 *  - Modifier groups ((?i:...)) lose their flag inside some alternations.
 *    They are drawn on their own, around a whole pattern, and the oracle is
 *    the pattern itself under the flags they set.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export interface DrawnPattern {
  pattern: string;
  // The same pattern, written so that V8's answer is the specification's.
  oracle: string;
}

const ATOMS: ReadonlyArray<string> = [
  "a",
  "b",
  "c",
  "A",
  "B",
  "0",
  " ",
  "-",
  "_",
  "\\n",
  "\\.",
  "\\-",
  "\\/",
  ".",
  "\\d",
  "\\D",
  "\\w",
  "\\W",
  "\\s",
  "\\S",
  "[ab]",
  "[^a]",
  "[a-c]",
  "[\\d]",
  "[\\w-]",
  "[^\\s]",
  "[]",
  "[^]",
  "[A-Z]",
  "[^a-c]",
  "[\\Wa]",
  "\\x61",
  "\\u0042",
  "\\0",
  "\\cA",
  "\\c",
  "[\\b]",
  "\\k",
  "{",
  "}",
  "]",
  "x{",
  "\\101",
  "\\8",
  "k",
  "s",
  "K",
  "S",
  "[\\c]",
  "[\\c1]",
  "\\p",
  "[^]]",
];

const QUANTIFIERS: ReadonlyArray<string> = [
  "*",
  "+",
  "?",
  "{2}",
  "{0,2}",
  "{1,3}",
  "{2,}",
  "{0,1}",
  "{0}",
  "{1}",
  "{0,3}",
];

export const FUZZ_TEXT_CHARACTERS: ReadonlyArray<string> = [
  "a",
  "b",
  "c",
  "A",
  "B",
  "0",
  "1",
  " ",
  "\n",
  "\r",
  "-",
  "_",
  ".",
  "k",
  "K",
  "s",
  "S",
  "x",
  "{",
  "}",
  "]",
  "\\",
  String.fromCharCode(0x017f),
  String.fromCharCode(0x212a),
  String.fromCharCode(0x2028),
  String.fromCharCode(0x0001),
  String.fromCharCode(0x0008),
  String.fromCharCode(0x00a0),
  String.fromCharCode(0xfeff),
];

function pick<T>(random: SeededRandom, items: ReadonlyArray<T>): T {
  return items[random(items.length)]!;
}

function anchor(kind: "^" | "$", multiline: boolean): string {
  if (kind === "^") {
    return multiline ? "(?<![^\\n\\r\\u2028\\u2029])" : "(?<![^])";
  }

  return multiline ? "(?![^\\n\\r\\u2028\\u2029])" : "(?![^])";
}

function both(text: string): DrawnPattern {
  return { pattern: text, oracle: text };
}

// A random pattern, up to `maxDepth` levels of nesting.
export function drawPattern(
  random: SeededRandom,
  maxDepth: number,
  multiline: boolean,
  depth: number = 0,
): DrawnPattern {
  const roll: number = random(100);

  if (depth >= maxDepth || roll < 30) {
    if (random(10) < 2) {
      const assertion: string = pick(random, ["^", "$", "\\b", "\\B"]);

      if (assertion === "^" || assertion === "$") {
        return { pattern: assertion, oracle: anchor(assertion, multiline) };
      }

      return both(assertion);
    }

    return both(pick(random, ATOMS));
  }

  const inner: () => DrawnPattern = (): DrawnPattern => {
    return drawPattern(random, maxDepth, multiline, depth + 1);
  };

  if (roll < 45) {
    const parts: Array<DrawnPattern> = [];
    const count: number = 2 + random(3);

    for (let index: number = 0; index < count; index++) {
      parts.push(inner());
    }

    return {
      pattern: parts
        .map((part: DrawnPattern): string => {
          return part.pattern;
        })
        .join(""),
      oracle: parts
        .map((part: DrawnPattern): string => {
          return part.oracle;
        })
        .join(""),
    };
  }

  if (roll < 55) {
    const options: Array<DrawnPattern> = [];
    const count: number = 2 + random(2);

    for (let index: number = 0; index < count; index++) {
      options.push(random(6) === 0 ? both("") : inner());
    }

    return {
      pattern: `(?:${options
        .map((option: DrawnPattern): string => {
          return option.pattern;
        })
        .join("|")})`,
      oracle: `(?:${options
        .map((option: DrawnPattern): string => {
          return option.oracle;
        })
        .join("|")})`,
    };
  }

  if (roll < 75) {
    const body: DrawnPattern = inner();
    const open: string = random(2) === 0 ? "(" : "(?:";
    const quantifier: string =
      pick(random, QUANTIFIERS) + (random(3) === 0 ? "?" : "");

    return {
      pattern: `${open}${body.pattern})${quantifier}`,
      oracle: `${open}${body.oracle})${quantifier}`,
    };
  }

  if (roll < 82) {
    const body: DrawnPattern = inner();
    const open: string = random(5) === 0 ? `(?<n${depth}>` : "(";

    return {
      pattern: `${open}${body.pattern})`,
      oracle: `${open}${body.oracle})`,
    };
  }

  if (roll < 94) {
    const kind: string = pick(random, ["(?=", "(?!", "(?<=", "(?<!"]);
    const body: DrawnPattern = inner();
    const quantifier: string =
      (kind === "(?=" || kind === "(?!") && random(4) === 0
        ? pick(random, ["*", "+", "?", "{2}", "{0,2}"])
        : "";

    return {
      pattern: `${kind}${body.pattern})${quantifier}`,
      oracle: `${kind}${body.oracle})${quantifier}`,
    };
  }

  const body: DrawnPattern = inner();

  return { pattern: `(?:${body.pattern})`, oracle: `(?:${body.oracle})` };
}

export function drawText(random: SeededRandom, longest: number): string {
  let text: string = "";
  const length: number = random(longest + 1);

  for (let index: number = 0; index < length; index++) {
    text += pick(random, FUZZ_TEXT_CHARACTERS);
  }

  return text;
}

/*
 * Pieces of pattern syntax, for patterns drawn as text rather than as a
 * tree: most of what they make is not a pattern at all, and of what is, the
 * parser has to read every piece the way JavaScript does.
 */
export const SYNTAX_PIECES: ReadonlyArray<string> = [
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "\\",
  "\\",
  "\\",
  "^",
  "$",
  ".",
  "*",
  "+",
  "?",
  "|",
  "-",
  ",",
  "0",
  "1",
  "2",
  "3",
  "7",
  "8",
  "9",
  "a",
  "b",
  "c",
  "k",
  "u",
  "x",
  "d",
  "w",
  "s",
  "B",
  "D",
  "W",
  "S",
  "f",
  "n",
  "r",
  "t",
  "v",
  "p",
  "P",
  "<",
  ">",
  "=",
  "!",
  ":",
  "?:",
  "(?:",
  "(?=",
  "(?!",
  "(?<=",
  "(?<!",
  "(?<n>",
  "\\k<n>",
  "{1}",
  "{1,}",
  "{1,2}",
  "{2,1}",
  "{,1}",
  "\\c",
  "\\cA",
  "\\c1",
  "\\x4",
  "\\x41",
  "\\u004",
  "\\u0041",
  "\\u{41}",
  "\\0",
  "\\01",
  "\\08",
  "\\377",
  "\\400",
  "\\8",
  "\\9",
  "\\12",
  "A",
  "_",
  " ",
  "[^",
  "[\\",
  "]]",
];

export function drawSyntax(random: SeededRandom): string {
  let text: string = "";
  const pieces: number = 1 + random(8);

  for (let index: number = 0; index < pieces; index++) {
    text += pick(random, SYNTAX_PIECES);
  }

  return text;
}
