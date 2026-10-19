import CharacterSet, {
  MAX_CODE_UNIT,
} from "../../../Utils/LinearRegExp/CharacterSet";
import LinearRegExp from "../../../Utils/LinearRegExp/LinearRegExp";
import {
  clearLinearRegExpCache,
  describePatternProblem,
  getLinearRegExp,
  MAX_CACHED_PATTERNS,
  tryGetLinearRegExp,
} from "../../../Utils/LinearRegExp/PatternCache";
import {
  PatternProblemError,
  PatternProblemReason,
} from "../../../Utils/LinearRegExp/PatternProblem";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * The two small pieces the matcher stands on: a set of code units (what a
 * class, an escape or a case-insensitive letter matches) and the cache of
 * compiled patterns the rule engines read from.
 */

describe("CharacterSet", () => {
  test("holds exactly the code units of its ranges, however they were given", () => {
    const random: SeededRandom = seededRandom(1618);

    for (let round: number = 0; round < 200; round++) {
      const pairs: Array<number> = [];
      const expected: Set<number> = new Set<number>();
      const ranges: number = 1 + random(6);

      for (let index: number = 0; index < ranges; index++) {
        // Ranges near ASCII's edge, and above it, overlapping or not.
        const first: number =
          random(2) === 0 ? random(200) : 0x300 + random(400);
        const last: number = first + random(40);
        pairs.push(first, last);

        for (let codeUnit: number = first; codeUnit <= last; codeUnit++) {
          expected.add(codeUnit);
        }
      }

      const set: CharacterSet = CharacterSet.fromPairs(pairs);
      const wrong: Array<number> = [];

      for (let codeUnit: number = 0; codeUnit < 0x800; codeUnit++) {
        if (set.has(codeUnit) !== expected.has(codeUnit)) {
          wrong.push(codeUnit);
        }
      }

      expect({ pairs, wrong }).toEqual({ pairs, wrong: [] });
      expect(set.size()).toBe(expected.size);
    }
  });

  test("merges touching ranges, and its complement holds the rest", () => {
    const set: CharacterSet = CharacterSet.fromPairs([5, 9, 10, 12, 0, 2]);

    expect(set.ranges).toEqual([0, 2, 5, 12]);
    expect(set.complement().ranges).toEqual([3, 4, 13, MAX_CODE_UNIT]);
    expect(CharacterSet.all().complement().isEmpty()).toBe(true);
    expect(CharacterSet.empty().complement().size()).toBe(0x10000);
  });

  test("knows when it is one code unit", () => {
    expect(CharacterSet.of(65).singleCodeUnit()).toBe(65);
    expect(CharacterSet.fromPairs([65, 66]).singleCodeUnit()).toBeNull();
    expect(CharacterSet.empty().singleCodeUnit()).toBeNull();
  });

  test("gives one key to sets with the same code units", () => {
    expect(CharacterSet.fromPairs([1, 3, 4, 6]).key()).toBe(
      CharacterSet.fromCodeUnits([6, 5, 4, 3, 2, 1]).key(),
    );
  });
});

describe("the cache of compiled patterns", () => {
  test("compiles a pattern once and hands out the same matcher", () => {
    clearLinearRegExpCache();

    const first: LinearRegExp = getLinearRegExp("^db-\\d+", "i");
    const second: LinearRegExp = getLinearRegExp("^db-\\d+", "i");

    expect(second).toBe(first);
    expect(getLinearRegExp("^db-\\d+", "")).not.toBe(first);
    expect(getLinearRegExp("^db-\\d+", "i", { captures: true })).not.toBe(
      first,
    );
  });

  test("keeps a refusal too, and throws it each time", () => {
    clearLinearRegExpCache();

    let firstError: unknown = null;
    let secondError: unknown = null;

    try {
      getLinearRegExp("(a)\\1", "i");
    } catch (error: unknown) {
      firstError = error;
    }

    try {
      getLinearRegExp("(a)\\1", "i");
    } catch (error: unknown) {
      secondError = error;
    }

    expect(firstError).toBeInstanceOf(PatternProblemError);
    expect(secondError).toBe(firstError);
    expect(tryGetLinearRegExp("(a)\\1", "i")).toBeNull();
    expect(tryGetLinearRegExp("(", "i")).toBeNull();
  });

  test("stays bounded, dropping the least recently used", () => {
    clearLinearRegExpCache();

    const kept: LinearRegExp = getLinearRegExp("kept-0", "i");
    const dropped: LinearRegExp = getLinearRegExp("pattern-1", "i");

    for (let index: number = 2; index <= MAX_CACHED_PATTERNS + 10; index++) {
      getLinearRegExp(`pattern-${index}`, "i");

      // Used now and then: it stays.
      if (index % 50 === 0) {
        getLinearRegExp("kept-0", "i");
      }
    }

    expect(getLinearRegExp("kept-0", "i")).toBe(kept);
    // Not used since it was compiled: dropped, and compiled again.
    expect(getLinearRegExp("pattern-1", "i")).not.toBe(dropped);
  });

  test("words a refusal for the person who wrote the pattern, and nothing else", () => {
    expect(
      describePatternProblem(
        new PatternProblemError(PatternProblemReason.BackReference, "x"),
      ),
    ).toContain("back-reference");
    expect(describePatternProblem(new SyntaxError("x"))).toBeNull();
    expect(describePatternProblem("x")).toBeNull();
  });
});
