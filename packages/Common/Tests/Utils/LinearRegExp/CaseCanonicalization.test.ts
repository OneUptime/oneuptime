import {
  canonicalize,
  closeOverCase,
  getCaseVariants,
} from "../../../Utils/LinearRegExp/CaseCanonicalization";
import CharacterSet from "../../../Utils/LinearRegExp/CharacterSet";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * THE i FLAG'S CASE PAIRS, CODE UNIT BY CODE UNIT, AS V8 HAS THEM.
 *
 * A case-insensitive pattern matches a code unit when it has the same
 * canonical form as one the pattern names. The matcher computes the forms
 * once from toUpperCase, as the specification says; this holds the result
 * to V8's own case-insensitive matching for every code unit that has a case
 * variant anywhere, and for a sample of those that have none.
 * ---------------------------------------------------------------------------
 */

const ALL_CODE_UNITS: string = (() => {
  const codeUnits: Array<number> = [];

  for (let codeUnit: number = 0; codeUnit <= 0xffff; codeUnit++) {
    codeUnits.push(codeUnit);
  }

  // A string of every code unit, lone surrogates included, in order.
  let text: string = "";

  for (let start: number = 0; start < codeUnits.length; start += 4096) {
    text += String.fromCharCode(...codeUnits.slice(start, start + 4096));
  }

  return text;
})();

function hex4(codeUnit: number): string {
  return codeUnit.toString(16).padStart(4, "0");
}

// Every code unit V8's /[c]/i matches: one pass of matchAll over all of them.
function variantsByJavaScript(codeUnit: number): Array<number> {
  const pattern: RegExp = new RegExp(`[\\u${hex4(codeUnit)}]`, "gi");
  const found: Array<number> = [];

  for (const match of ALL_CODE_UNITS.matchAll(pattern)) {
    found.push(match.index!);
  }

  return found;
}

// Every code unit whose case changes, or that another's upper case is.
function codeUnitsWithAnyCase(): Array<number> {
  const found: Set<number> = new Set<number>();

  for (let codeUnit: number = 0; codeUnit <= 0xffff; codeUnit++) {
    const character: string = String.fromCharCode(codeUnit);
    const upper: string = character.toUpperCase();
    const lower: string = character.toLowerCase();

    if (upper !== character || lower !== character) {
      found.add(codeUnit);
    }

    if (upper !== character && upper.length === 1) {
      found.add(upper.charCodeAt(0));
    }

    if (lower !== character && lower.length === 1) {
      found.add(lower.charCodeAt(0));
    }
  }

  return Array.from(found).sort((left: number, right: number): number => {
    return left - right;
  });
}

describe("the case variants of a code unit", () => {
  test("are V8's for every code unit with any case", () => {
    const differences: Array<string> = [];

    for (const codeUnit of codeUnitsWithAnyCase()) {
      const expected: Array<number> = variantsByJavaScript(codeUnit);
      const got: Array<number> = getCaseVariants(codeUnit).sort(
        (left: number, right: number): number => {
          return left - right;
        },
      );

      if (JSON.stringify(expected) !== JSON.stringify(got)) {
        differences.push(
          `U+${hex4(codeUnit)}: V8 ${expected.map(hex4).join(",")} matcher ${got
            .map(hex4)
            .join(",")}`,
        );
      }
    }

    expect(differences.slice(0, 10)).toEqual([]);
  });

  test("are the code unit alone for a sample of those without case, as in V8", () => {
    const random: SeededRandom = seededRandom(2718);
    const withCase: Set<number> = new Set<number>(codeUnitsWithAnyCase());
    let checked: number = 0;

    while (checked < 600) {
      const codeUnit: number = random(0x10000);

      if (withCase.has(codeUnit)) {
        continue;
      }

      checked++;
      expect(getCaseVariants(codeUnit)).toEqual([codeUnit]);
      expect(variantsByJavaScript(codeUnit)).toEqual([codeUnit]);
    }
  });

  test("keep the two rules JavaScript adds without the u flag", () => {
    // Upper case of more than one code unit: the code unit stays itself.
    expect(canonicalize(0x00df)).toBe(0x00df);
    // Never from 128 and above down into ASCII: long s and the Kelvin sign.
    expect(canonicalize(0x017f)).toBe(0x017f);
    expect(canonicalize(0x212a)).toBe(0x212a);
    expect(getCaseVariants(0x6b)).toEqual([0x4b, 0x6b]);
  });
});

describe("a case-insensitive class", () => {
  test("holds every member's variants, and only those", () => {
    const closed: CharacterSet = closeOverCase(
      CharacterSet.fromPairs([0x61, 0x63, 0x3c3, 0x3c3]),
    );

    // Final sigma upper-cases to the same capital as sigma.
    for (const codeUnit of [
      0x61, 0x62, 0x63, 0x41, 0x42, 0x43, 0x3c3, 0x3a3, 0x3c2,
    ]) {
      expect(closed.has(codeUnit)).toBe(true);
    }

    for (const codeUnit of [0x64, 0x44, 0x212a]) {
      expect(closed.has(codeUnit)).toBe(false);
    }
  });

  test("matches what V8's matches, for every range of letters the tests know", () => {
    for (const [first, last] of [
      [0x61, 0x7a],
      [0x41, 0x5a],
      [0xc0, 0xff],
      [0x391, 0x3c9],
      [0x400, 0x45f],
    ] as Array<[number, number]>) {
      const closed: CharacterSet = closeOverCase(
        CharacterSet.fromPairs([first, last]),
      );
      const pattern: RegExp = new RegExp(
        `[\\u${hex4(first)}-\\u${hex4(last)}]`,
        "gi",
      );
      const expected: Array<number> = [];

      for (const match of ALL_CODE_UNITS.matchAll(pattern)) {
        expected.push(match.index!);
      }

      const got: Array<number> = [];

      for (let codeUnit: number = 0; codeUnit <= 0xffff; codeUnit++) {
        if (closed.has(codeUnit)) {
          got.push(codeUnit);
        }
      }

      expect(got).toEqual(expected);
    }
  });

  test("matches what V8's matches for random ranges, from the smallest to all of them", () => {
    const random: SeededRandom = seededRandom(4242);

    for (let round: number = 0; round < 12; round++) {
      const first: number = round === 0 ? 0 : random(0xfff0);
      const last: number =
        round === 0
          ? 0xffff
          : Math.min(0xffff, first + random(round % 2 === 0 ? 0x40 : 0x4000));
      const closed: CharacterSet = closeOverCase(
        CharacterSet.fromPairs([first, last]),
      );
      const pattern: RegExp = new RegExp(
        `[\\u${hex4(first)}-\\u${hex4(last)}]`,
        "gi",
      );
      const expected: Array<number> = [];

      for (const match of ALL_CODE_UNITS.matchAll(pattern)) {
        expected.push(match.index!);
      }

      const got: Array<number> = [];

      for (let codeUnit: number = 0; codeUnit <= 0xffff; codeUnit++) {
        if (closed.has(codeUnit)) {
          got.push(codeUnit);
        }
      }

      expect({ first, last, got }).toEqual({ first, last, got: expected });
    }
  });

  test("is closed once per class: the same members give the very same set", () => {
    // Written twice, in two patterns or twice in one, the class is one set.
    const once: CharacterSet = closeOverCase(
      CharacterSet.fromPairs([0x100, 0x24f, 0x370, 0x3ff]),
    );
    const again: CharacterSet = closeOverCase(
      CharacterSet.fromPairs([0x370, 0x3ff, 0x100, 0x24f]),
    );

    expect(again).toBe(once);
  });
});
