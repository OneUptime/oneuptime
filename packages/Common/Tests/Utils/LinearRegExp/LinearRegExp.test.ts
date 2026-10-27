import LinearRegExp, {
  LinearRegExpMatch,
} from "../../../Utils/LinearRegExp/LinearRegExp";
import {
  describePatternProblemReason,
  PatternProblemError,
  PatternProblemReason,
  PatternWorkLimitError,
} from "../../../Utils/LinearRegExp/PatternProblem";
import { RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN } from "../../../Types/Rules/RuleCriteria";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * LinearRegExp: a JavaScript regular expression, matched in time in line
 * with the text. What it answers, what it refuses, and the corners of
 * JavaScript's semantics it keeps - each held to V8's own answer where V8
 * gets it right (LinearRegExpAgreesWithJavaScript.test.ts holds the rest
 * on random patterns).
 * ---------------------------------------------------------------------------
 */

function linear(
  source: string,
  flags: string = "",
  captures: boolean = true,
): LinearRegExp {
  return new LinearRegExp(source, flags, { captures: captures });
}

function asArray(match: LinearRegExpMatch | null): Array<unknown> | null {
  return match === null ? null : [match.index, match.value, ...match.captures];
}

function javascript(
  source: string,
  flags: string,
  text: string,
): Array<unknown> | null {
  const match: RegExpExecArray | null = new RegExp(source, flags).exec(text);

  return match === null ? null : [match.index, ...match];
}

function refusalOf(source: string, captures: boolean = false): unknown {
  try {
    linear(source, "", captures);
  } catch (error: unknown) {
    return error;
  }

  return null;
}

describe("what it answers", () => {
  const CASES: ReadonlyArray<[string, string, string]> = [
    // [pattern, flags, text]
    ["^api-", "i", "API-gateway"],
    ["db-(\\d+)", "", "primary db-03 replica db-04"],
    ["(?<name>[a-z]+)-(?<number>\\d+)", "", "x checkout-12"],
    ["a|ab|abc", "", "abc"],
    ["(a|ab)(c|bcd)(d*)", "", "abcd"],
    ["a*?b", "", "aaab"],
    ["(a*)+", "", "aaa"],
    ["(a*)*b", "", "aab"],
    ["(?:(a)|b)+", "", "ab"],
    ["(a)?(b)?", "", "b"],
    ["(a?)?", "", ""],
    ["(?:|a)?(?:a|ab)", "", "aab"],
    ["(?:(\\D)*?)+", "", "SBK"],
    ["^$", "m", "a\n\nb"],
    ["^b$", "m", "a\r\nb"],
    ["a.c", "", "a\nc"],
    ["a.c", "s", "a\nc"],
    ["\\bword\\b", "", "a word here"],
    ["\\Bor\\B", "", "word"],
    ["[^]", "", "\n"],
    ["[]", "", "anything"],
    ["\\s+", "", `a\u00a0\ufeff\u2028b`],
    ["(?<=\\$)\\d+", "", "cost $42"],
    ["(?<!\\$)\\b\\d+", "", "$42 and 7"],
    ["\\d+(?=%)", "", "50 and 75%"],
    ["\\d+(?!%)\\b", "", "75% and 50"],
    ["(?=a)*a", "", "a"],
    ["(?!(b))a", "", "a"],
    ["x{2,3}", "", "xxxx"],
    ["x{2,3}?", "", "xxxx"],
    ["a{,2}", "", "a{,2}"],
    ["\\x41\\u0042\\103", "", "ABC"],
    ["\\cJ", "", "\n"],
    ["\\c", "", "\\c"],
    ["[\\b]", "", "\b"],
    ["\\8\\9", "", "89"],
    ["\\k", "", "k"],
    ["\\1", "", "\u0001"],
  ];

  test.each(CASES)(
    "%s with flags %s finds what JavaScript finds",
    (source: string, flags: string, text: string) => {
      expect(asArray(linear(source, flags).exec(text))).toEqual(
        javascript(source, flags, text),
      );
      expect(linear(source, flags, false).test(text)).toBe(
        new RegExp(source, flags).test(text),
      );
    },
  );

  test("exec from a position is exec with lastIndex there", () => {
    const pattern: LinearRegExp = linear("\\d+");
    const text: string = "a1 b22 c333";

    for (let from: number = 0; from <= text.length + 1; from++) {
      const expected: RegExp = new RegExp("\\d+", "g");
      expected.lastIndex = from;

      expect(asArray(pattern.exec(text, from))).toEqual(
        (() => {
          const match: RegExpExecArray | null = expected.exec(text);
          return match === null ? null : [match.index, ...match];
        })(),
      );
    }
  });

  test("names the groups that are named", () => {
    const match: LinearRegExpMatch | null = linear(
      "(?<word>[a-z]+)(?:-(?<number>\\d+))?",
    ).exec("checkout");

    expect(match?.groups).toEqual({ word: "checkout", number: undefined });
  });

  test("a group name used twice gives the value of the one that took part", () => {
    const pattern: string = "(?<side>left)|(?<side>right)";
    const match: LinearRegExpMatch | null = linear(pattern).exec("right");

    expect(match?.groups).toEqual({ side: "right" });
    expect(match?.groups).toEqual({
      ...new RegExp(pattern).exec("right")?.groups,
    });
  });

  test("replaces every match as String.prototype.replace does", () => {
    for (const [source, flags, text] of [
      ["x*", "g", "abc"],
      ["\\d", "g", "a1b22"],
      ["(?=b)", "g", "abab"],
      ["", "g", "ab"],
      ["a|", "g", "aab"],
      ["[A-Z]{2}\\d{6}", "g", "id AB123456 and CD654321."],
    ] as Array<[string, string, string]>) {
      const wrap: (text: string) => string = (matched: string): string => {
        return `<${matched}>`;
      };

      expect(linear(source, flags).replace(text, wrap)).toBe(
        text.replace(new RegExp(source, flags), wrap),
      );
    }
  });

  test("returns the very text when nothing matches", () => {
    const text: string = "nothing to see";

    expect(linear("\\d", "g").replace(text, String)).toBe(text);
  });

  test("lists every match as matchAll does", () => {
    const text: string = "a1 b22 c333";
    const expected: Array<Array<unknown>> = Array.from(
      text.matchAll(/(\w)(\d+)/g),
    ).map((match: RegExpMatchArray): Array<unknown> => {
      return [match.index, ...match];
    });

    expect(
      linear("(\\w)(\\d+)", "g")
        .matchAll(text)
        .map((match: LinearRegExpMatch): Array<unknown> | null => {
          return asArray(match);
        }),
    ).toEqual(expected);
  });

  test("never matches (?!), the pattern older workers are shown for criteria rules", () => {
    const never: LinearRegExp = linear(
      RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
    );

    expect(never.test("")).toBe(false);
    expect(never.test("anything at all")).toBe(false);
  });
});

describe("JavaScript's corners, kept", () => {
  test("reads a string as UTF-16 code units, as JavaScript does without the u flag", () => {
    const emoji: string = String.fromCodePoint(0x1f600);
    const oneUnit: RegExp = /^.$/;
    const twoUnits: RegExp = /^..$/;

    expect(linear("^.$").test(emoji)).toBe(oneUnit.test(emoji));
    expect(linear("^..$").test(emoji)).toBe(twoUnits.test(emoji));
    expect(linear("^[^a]{2}$").test(emoji)).toBe(true);
    expect(linear(`^${emoji}$`).test(emoji)).toBe(true);
  });

  test("folds case the way the i flag does without u", () => {
    const kelvin: string = String.fromCharCode(0x212a);
    const longS: string = String.fromCharCode(0x017f);
    const sharpS: string = String.fromCharCode(0x00df);

    const cases: ReadonlyArray<[string, string]> = [
      ["k", kelvin],
      [kelvin, "k"],
      [kelvin, kelvin],
      ["s", longS],
      [longS, "S"],
      [sharpS, "SS"],
      ["\u00e9", "\u00c9"],
      ["\u03c3", "\u03a3"],
      ["\u03c2", "\u03a3"],
      ["[a-z]", kelvin],
      ["[^k]", kelvin],
      ["\\W", "k"],
      ["\\w", longS],
    ];

    for (const [source, text] of cases) {
      expect({ source, text, matches: linear(source, "i").test(text) }).toEqual(
        { source, text, matches: new RegExp(source, "i").test(text) },
      );
    }
  });

  test("a modifier group changes the flags of what it holds, and only that", () => {
    expect(linear("(?i:a)b").test("Ab")).toBe(true);
    expect(linear("(?i:a)b").test("AB")).toBe(false);
    expect(linear("(?-i:a)b", "i").test("aB")).toBe(true);
    expect(linear("(?-i:a)b", "i").test("AB")).toBe(false);
    expect(linear("(?s:.)", "").test("\n")).toBe(true);
    expect(linear("(?m:^b)", "").test("a\nb")).toBe(true);
    expect(linear("^b", "").test("a\nb")).toBe(false);
  });

  test("forgets a group's capture at every repetition, as JavaScript does", () => {
    expect(asArray(linear("(?:(a)|(b))+").exec("ab"))).toEqual(
      javascript("(?:(a)|(b))+", "", "ab"),
    );
    expect(asArray(linear("(?:(a)|b)*c").exec("abc"))).toEqual([
      0,
      "abc",
      undefined,
    ]);
  });
});

describe("what it refuses", () => {
  test("what is not a pattern, with the running engine's own SyntaxError", () => {
    for (const source of ["(", "[a-", "a{2,1}", "*abc", "(?<name", "ab\\"]) {
      let javascriptMessage: string = "";

      try {
        RegExp(source);
      } catch (error: unknown) {
        javascriptMessage = (error as Error).message;
      }

      const error: unknown = refusalOf(source);

      expect(error).toBeInstanceOf(SyntaxError);
      expect((error as Error).message).toBe(javascriptMessage);
    }
  });

  test("a back-reference, numbered or named: it cannot run in linear time", () => {
    for (const source of [
      "(a)\\1",
      "(a)(b)\\2",
      "(?<word>\\w+) \\k<word>",
      "([\"'])value\\1",
    ]) {
      const error: unknown = refusalOf(source);

      expect(error).toBeInstanceOf(PatternProblemError);
      expect((error as PatternProblemError).reason).toBe(
        PatternProblemReason.BackReference,
      );
    }
  });

  test("but not what only looks like one", () => {
    // \1 with no group 1 is an octal escape; \k with no named group is "k".
    expect(linear("\\1").test("\u0001")).toBe(true);
    expect(linear("\\12").test("\n")).toBe(true);
    expect(linear("\\k<x>").test("k<x>")).toBe(true);
    expect(linear("[\\1]").test("\u0001")).toBe(true);
  });

  test("a pattern that compiles to more steps than it may", () => {
    for (const source of ["a{20000}", "(?:a{0,100}){0,200}", ".{0,9999}x"]) {
      const error: unknown = refusalOf(source);

      expect(error).toBeInstanceOf(PatternProblemError);
      expect((error as PatternProblemError).reason).toBe(
        PatternProblemReason.TooLarge,
      );
    }

    expect(() => {
      return new LinearRegExp("a{20000}", "", { maxSteps: 30000 });
    }).not.toThrow();
  });

  test("a count of no steps is not a reason to refuse", () => {
    expect(linear("(?:){1000000000}x").test("x")).toBe(true);
  });

  test("a capture inside a look-ahead or look-behind, when captures are read", () => {
    for (const source of ["(?=(a))a", "(?<=(a))b", "(?=(?<x>a))a"]) {
      const error: unknown = refusalOf(source, true);

      expect(error).toBeInstanceOf(PatternProblemError);
      expect((error as PatternProblemError).reason).toBe(
        PatternProblemReason.CaptureInsideLookaround,
      );
      expect(refusalOf(source, false)).toBeNull();
    }

    // A negative look-around captures nothing JavaScript would keep.
    expect(refusalOf("(?!(a))b", true)).toBeNull();
  });

  test("flags it was not built for", () => {
    for (const flags of ["u", "v", "y", "d"]) {
      expect(() => {
        return new LinearRegExp("a", flags);
      }).toThrow(/does not support/);
    }
  });

  test("says why in words for the person who wrote the pattern", () => {
    expect(
      describePatternProblemReason(PatternProblemReason.BackReference),
    ).toContain("back-reference");
    expect(
      describePatternProblemReason(PatternProblemReason.TooLarge),
    ).toContain("too large");
    expect(
      describePatternProblemReason(
        PatternProblemReason.CaptureInsideLookaround,
      ),
    ).toContain("(?:...)");
  });
});

describe("how much work one question may take", () => {
  // A pattern whose automaton meets a new state at nearly every position.
  const EXPLODING: string = "(?:[ab]*a[ab]{14}|[ab]{0,2000})Q";

  function randomAb(length: number): string {
    const random: SeededRandom = seededRandom(31);
    let text: string = "";

    for (let index: number = 0; index < length; index++) {
      text += random(2) === 0 ? "a" : "b";
    }

    return text;
  }

  test("a pattern built to need many steps per character is stopped, quickly", () => {
    const text: string = randomAb(200000);
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(() => {
          return linear(EXPLODING, "", false).test(text);
        }).toThrow(PatternWorkLimitError);
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("the same pattern answers a short text: the allowance for its size covers a large pattern's first states", () => {
    expect(linear(EXPLODING, "", false).test(`${randomAb(300)}Q`)).toBe(true);
  });

  test("a replace that would read the text over for every match is stopped", () => {
    const text: string = "a".repeat(100000);
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        /*
         * Each "a" is a match, but only once the first alternative - a run to a
         * "c" that is never there - has read on to the end of the text: the
         * square of its length in all.
         */
        expect(() => {
          return linear("(?:a.*c|a)", "g").replace(text, String);
        }).toThrow(PatternWorkLimitError);
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("a replace of a hundred thousand matches is not", () => {
    const text: string = "a".repeat(100000);

    expect(
      linear("a", "g").replace(text, (): string => {
        return "b";
      }),
    ).toBe("b".repeat(100000));
  });

  test("but a short text is never stopped, however the pattern reads it", () => {
    expect(
      linear("(?:a.*c|a)", "g").replace("aaaaaa", (): string => {
        return "x";
      }),
    ).toBe("xxxxxx");
  });
});
