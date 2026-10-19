import LinearRegExp, {
  LinearRegExpMatch,
} from "../../../Utils/LinearRegExp/LinearRegExp";
import {
  PatternProblemError,
  PatternProblemReason,
} from "../../../Utils/LinearRegExp/PatternProblem";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  DrawnPattern,
  drawPattern,
  drawSyntax,
  drawText,
} from "./PatternFuzzing";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * THE LINEAR-TIME MATCHER GIVES JAVASCRIPT'S ANSWERS.
 *
 * The rule engines, scrub rules, grok parsers, metric filters and LIKE
 * filters used to run the patterns people wrote with JavaScript's RegExp;
 * they run them with LinearRegExp now. Nothing a pattern matched may change,
 * so this holds the matcher to V8 itself on thousands of random patterns -
 * every construct a pattern can use, case-insensitive and multiline and
 * dot-all, look-arounds, captures, lazy and counted repeats - and random
 * texts: test, exec (where the match starts, what it is, what every group
 * captured) and replacing every match must come out the same.
 *
 * The patterns are drawn in PatternFuzzing.ts, which says how the oracle is
 * written around three V8 bugs. The same draws run millions of times outside
 * CI found no other difference.
 * ---------------------------------------------------------------------------
 */

interface Comparable {
  index: number;
  value: string;
  captures: Array<string | undefined>;
}

function fromJavaScript(match: RegExpExecArray | null): Comparable | null {
  if (match === null) {
    return null;
  }

  return {
    index: match.index,
    value: match[0],
    captures: match.slice(1),
  };
}

function fromLinear(match: LinearRegExpMatch | null): Comparable | null {
  if (match === null) {
    return null;
  }

  return { index: match.index, value: match.value, captures: match.captures };
}

const FLAG_SETS: ReadonlyArray<string> = [
  "",
  "i",
  "m",
  "s",
  "im",
  "is",
  "ms",
  "ims",
];

interface Mismatch {
  pattern: string;
  flags: string;
  text: string;
  what: string;
  javascript: unknown;
  linear: unknown;
}

const wrap: (text: string) => string = (text: string): string => {
  return `<${text}>`;
};

/*
 * Compares the matcher with V8 on `texts` for one pattern; the oracle is
 * what V8 is asked. Returns what differed.
 */
function compare(data: {
  pattern: string;
  flags: string;
  oracle: string;
  oracleFlags: string;
  texts: ReadonlyArray<string>;
}): Array<Mismatch> {
  const mismatches: Array<Mismatch> = [];
  let withCaptures: LinearRegExp | null = null;
  let withoutCaptures: LinearRegExp;

  try {
    withCaptures = new LinearRegExp(data.pattern, data.flags, {
      captures: true,
    });
    withoutCaptures = withCaptures;
  } catch (error: unknown) {
    if (
      !(error instanceof PatternProblemError) ||
      error.reason !== PatternProblemReason.CaptureInsideLookaround
    ) {
      throw error;
    }

    withoutCaptures = new LinearRegExp(data.pattern, data.flags);
  }

  const global: LinearRegExp = new LinearRegExp(data.pattern, `${data.flags}g`);

  for (const text of data.texts) {
    const expectedTest: boolean = new RegExp(
      data.oracle,
      data.oracleFlags,
    ).test(text);
    const linearTest: boolean = withoutCaptures.test(text);

    if (expectedTest !== linearTest) {
      mismatches.push({
        pattern: data.pattern,
        flags: data.flags,
        text: text,
        what: "test",
        javascript: expectedTest,
        linear: linearTest,
      });
      continue;
    }

    if (withCaptures !== null) {
      const expectedExec: Comparable | null = fromJavaScript(
        new RegExp(data.oracle, data.oracleFlags).exec(text),
      );
      const linearExec: Comparable | null = fromLinear(withCaptures.exec(text));

      if (JSON.stringify(expectedExec) !== JSON.stringify(linearExec)) {
        mismatches.push({
          pattern: data.pattern,
          flags: data.flags,
          text: text,
          what: "exec",
          javascript: expectedExec,
          linear: linearExec,
        });
        continue;
      }
    }

    const expectedReplace: string = text.replace(
      new RegExp(data.oracle, `${data.oracleFlags}g`),
      wrap,
    );
    const linearReplace: string = global.replace(text, wrap);

    if (expectedReplace !== linearReplace) {
      mismatches.push({
        pattern: data.pattern,
        flags: data.flags,
        text: text,
        what: "replace",
        javascript: expectedReplace,
        linear: linearReplace,
      });
    }
  }

  return mismatches;
}

function isPattern(source: string, flags: string): boolean {
  try {
    RegExp(source, flags);
    return true;
  } catch {
    return false;
  }
}

describe("LinearRegExp against V8, on random patterns and texts", () => {
  test.each([
    [101, 3],
    [202, 4],
    [303, 5],
  ])(
    "seed %i, %i levels deep: test, exec and replace agree",
    (seed: number, depth: number) => {
      const random: SeededRandom = seededRandom(seed);
      const mismatches: Array<Mismatch> = [];
      let compared: number = 0;

      for (let round: number = 0; round < 1500; round++) {
        const flags: string = FLAG_SETS[random(FLAG_SETS.length)]!;
        const drawn: DrawnPattern = drawPattern(
          random,
          depth,
          flags.includes("m"),
        );
        const texts: Array<string> = [];

        for (let index: number = 0; index < 6; index++) {
          texts.push(drawText(random, 12));
        }

        if (!isPattern(drawn.oracle, flags)) {
          continue;
        }

        compared++;
        mismatches.push(
          ...compare({
            pattern: drawn.pattern,
            flags: flags,
            oracle: drawn.oracle,
            oracleFlags: flags,
            texts: texts,
          }),
        );
      }

      expect(compared).toBeGreaterThan(1200);
      expect(mismatches.slice(0, 5)).toEqual([]);
    },
  );

  test("longer texts agree too", () => {
    const random: SeededRandom = seededRandom(404);
    const mismatches: Array<Mismatch> = [];

    for (let round: number = 0; round < 600; round++) {
      const flags: string = FLAG_SETS[random(FLAG_SETS.length)]!;
      const drawn: DrawnPattern = drawPattern(random, 3, flags.includes("m"));
      const texts: Array<string> = [];

      for (let index: number = 0; index < 3; index++) {
        texts.push(drawText(random, 28));
      }

      if (!isPattern(drawn.oracle, flags)) {
        continue;
      }

      mismatches.push(
        ...compare({
          pattern: drawn.pattern,
          flags: flags,
          oracle: drawn.oracle,
          oracleFlags: flags,
          texts: texts,
        }),
      );
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  /*
   * (?X:p) under flags F reads as p under F with X; (?-X:p) as p under F
   * without it.
   */
  test("a modifier group around a pattern reads as the pattern under its flags", () => {
    const random: SeededRandom = seededRandom(505);
    const mismatches: Array<Mismatch> = [];

    for (let round: number = 0; round < 1200; round++) {
      const flag: string = ["i", "m", "s"][random(3)]!;
      const adds: boolean = random(2) === 0;
      const base: string = FLAG_SETS[random(FLAG_SETS.length)]!.replace(
        flag,
        "",
      );
      const outer: string = adds ? base : base + flag;
      const inner: string = adds ? base + flag : base;
      const drawn: DrawnPattern = drawPattern(random, 3, inner.includes("m"));
      const texts: Array<string> = [];

      for (let index: number = 0; index < 5; index++) {
        texts.push(drawText(random, 12));
      }

      const pattern: string = `(?${adds ? "" : "-"}${flag}:${drawn.pattern})`;

      if (!isPattern(drawn.oracle, inner) || !isPattern(pattern, outer)) {
        continue;
      }

      mismatches.push(
        ...compare({
          pattern: pattern,
          flags: outer,
          oracle: drawn.oracle,
          oracleFlags: inner,
          texts: texts,
        }),
      );
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});

describe("LinearRegExp reads pattern text the way JavaScript does", () => {
  /*
   * Patterns drawn as text, mostly not patterns at all: what V8 refuses the
   * matcher refuses with V8's own SyntaxError; what V8 takes the matcher
   * takes - unless it refers back to a group - and matches alike.
   */
  test("accepts, refuses and matches like V8 on 20,000 drawn texts", () => {
    const random: SeededRandom = seededRandom(606);
    const problems: Array<unknown> = [];
    let accepted: number = 0;
    let backReferences: number = 0;

    for (let round: number = 0; round < 20000; round++) {
      const source: string = drawSyntax(random);
      const flags: string = ["", "i", "m", "s", "ims"][random(5)]!;
      let javascriptError: unknown = null;

      try {
        RegExp(source, flags);
      } catch (error: unknown) {
        javascriptError = error;
      }

      let linear: LinearRegExp | null = null;
      let linearError: unknown = null;

      try {
        linear = new LinearRegExp(source, flags);
      } catch (error: unknown) {
        linearError = error;
      }

      if (javascriptError !== null) {
        if (
          !(linearError instanceof SyntaxError) ||
          linearError.message !== (javascriptError as Error).message
        ) {
          problems.push({ source, flags, kind: "refusal differs" });
        }

        continue;
      }

      accepted++;

      if (linearError !== null) {
        if (
          linearError instanceof PatternProblemError &&
          linearError.reason === PatternProblemReason.BackReference
        ) {
          backReferences++;
          continue;
        }

        problems.push({ source, flags, kind: String(linearError) });
        continue;
      }

      // An anchor after text that can be read meets V8's anchoring bug.
      if (source.includes("^") || source.includes("$")) {
        continue;
      }

      for (let index: number = 0; index < 4; index++) {
        const text: string = drawText(random, 8);
        const expected: Comparable | null = fromJavaScript(
          new RegExp(source, flags).exec(text),
        );
        const match: LinearRegExpMatch | null = linear!.exec(text);
        const got: { index: number; value: string } | null = match
          ? { index: match.index, value: match.value }
          : null;

        if (
          JSON.stringify(
            expected ? { index: expected.index, value: expected.value } : null,
          ) !== JSON.stringify(got)
        ) {
          problems.push({ source, flags, text, expected, got });
          break;
        }
      }
    }

    expect(accepted).toBeGreaterThan(8000);
    expect(backReferences).toBeGreaterThanOrEqual(0);
    expect(problems.slice(0, 5)).toEqual([]);
  });
});
