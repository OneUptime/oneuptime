import { describe, expect, test } from "@jest/globals";
import { compareCodePoints } from "../../../Types/Topology/TopologyTypeRules";

/*
 * compareCodePoints is how the Dashboard breaks the ties the server breaks
 * with COLLATE "C" (code-point order on a UTF-8 database). It must equal
 * JavaScript's `<` for every string made of characters up to U+FFFF, and
 * order characters beyond U+FFFF (surrogate pairs) after U+E000-U+FFFF,
 * which `<` does not.
 */

function sign(value: number): number {
  return value < 0 ? -1 : value > 0 ? 1 : 0;
}

/* An independent reference: compare the strings' code points one by one. */
function referenceCompare(a: string, b: string): number {
  const left: Array<number> = Array.from(a).map((char: string): number => {
    return char.codePointAt(0)!;
  });
  const right: Array<number> = Array.from(b).map((char: string): number => {
    return char.codePointAt(0)!;
  });
  const length: number = Math.min(left.length, right.length);
  for (let index: number = 0; index < length; index++) {
    if (left[index] !== right[index]) {
      return left[index]! < right[index]! ? -1 : 1;
    }
  }
  return sign(left.length - right.length);
}

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* A small deterministic generator, so a failure names its inputs. */
function makeRandom(seed: number): () => number {
  let state: number = seed >>> 0;
  return (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/* Characters from the ranges where the two orders meet or part ways. */
const ALPHABET: Array<string> = [
  "a",
  "b",
  "z",
  "0",
  "-",
  "é",
  "中",
  "퟿",
  "",
  "",
  "ﬁ",
  "�",
  "￿",
  "\u{10000}",
  "\u{1F600}",
  "\u{1F601}",
  "\u{10FFFF}",
];

function randomString(random: () => number, alphabet: Array<string>): string {
  const length: number = Math.floor(random() * 5);
  let out: string = "";
  for (let index: number = 0; index < length; index++) {
    out += alphabet[Math.floor(random() * alphabet.length)]!;
  }
  return out;
}

describe("compareCodePoints", () => {
  test("equal strings compare equal", () => {
    expect(compareCodePoints("", "")).toBe(0);
    expect(compareCodePoints("node-a", "node-a")).toBe(0);
    expect(compareCodePoints("\u{1F600}", "\u{1F600}")).toBe(0);
  });

  test("inside the Basic Multilingual Plane it orders exactly like `<`", () => {
    const pairs: Array<[string, string]> = [
      ["a", "b"],
      ["node-a", "node-b"],
      ["node", "node-a"],
      ["", "a"],
      ["Z", "a"],
      ["a", "é"],
      ["퟿", ""],
      ["", "�"],
      ["�", "￿"],
      ["0123456789abcdef", "0123456789abcdf0"],
    ];
    for (const [a, b] of pairs) {
      expect(compareCodePoints(a, b)).toBe(-1);
      expect(compareCodePoints(b, a)).toBe(1);
      expect(sign(compareCodePoints(a, b))).toBe(codeUnitCompare(a, b));
    }
  });

  test("a character beyond U+FFFF sorts after U+E000..U+FFFF, where `<` puts it before", () => {
    for (const high of ["", "", "�", "￿"]) {
      for (const astral of ["\u{10000}", "\u{1F600}", "\u{10FFFF}"]) {
        expect(compareCodePoints(high, astral)).toBe(-1);
        expect(compareCodePoints(astral, high)).toBe(1);
        expect(compareCodePoints(`node-${high}`, `node-${astral}`)).toBe(-1);
        expect(compareCodePoints(`node-${astral}x`, `node-${high}`)).toBe(1);
        /* The order `<` gives, which is what this exists to correct. */
        expect(codeUnitCompare(high, astral)).toBe(1);
      }
    }
  });

  test("a character beyond U+FFFF still sorts after everything below U+D800", () => {
    expect(compareCodePoints("퟿", "\u{10000}")).toBe(-1);
    expect(compareCodePoints("z", "\u{1F600}")).toBe(-1);
    expect(compareCodePoints("\u{1F600}", "z")).toBe(1);
  });

  test("two characters beyond U+FFFF compare by code point, high or low half", () => {
    /* Different high surrogates (U+10000 is D800 DC00, U+1F600 is D83D DE00). */
    expect(compareCodePoints("\u{10000}", "\u{1F600}")).toBe(-1);
    /* Same high surrogate, different low surrogates. */
    expect(compareCodePoints("\u{1F600}", "\u{1F601}")).toBe(-1);
    expect(compareCodePoints("x\u{1F601}", "x\u{1F600}")).toBe(1);
  });

  test("a prefix sorts first", () => {
    expect(compareCodePoints("node", "node-\u{1F600}")).toBe(-1);
    expect(compareCodePoints("node-\u{1F600}", "node")).toBe(1);
    expect(compareCodePoints("\u{1F600}", "\u{1F600}")).toBe(-1);
  });

  test("agrees with a code-point reference on thousands of mixed strings", () => {
    const random: () => number = makeRandom(3973);
    let disagreementsWithCodeUnits: number = 0;
    for (let round: number = 0; round < 20000; round++) {
      const a: string = randomString(random, ALPHABET);
      const b: string = randomString(random, ALPHABET);
      const expected: number = referenceCompare(a, b);
      if (sign(compareCodePoints(a, b)) !== expected) {
        throw new Error(
          `compareCodePoints(${JSON.stringify(a)}, ${JSON.stringify(b)}) should be ${expected}`,
        );
      }
      if (codeUnitCompare(a, b) !== expected) {
        disagreementsWithCodeUnits++;
      }
    }
    /* The inputs really did reach the cases where `<` is wrong. */
    expect(disagreementsWithCodeUnits).toBeGreaterThan(100);
  });

  test('sorts a list the way COLLATE "C" would', () => {
    const keys: Array<string> = [
      "node-\u{1F600}",
      "node-�",
      "node-b",
      "node-",
      "node-a",
      "node-\u{10000}",
      "node",
    ];
    expect([...keys].sort(compareCodePoints)).toEqual([
      "node",
      "node-a",
      "node-b",
      "node-",
      "node-�",
      "node-\u{10000}",
      "node-\u{1F600}",
    ]);
  });
});
