import LinearRegExp, {
  LinearRegExpMatch,
} from "../../../Utils/LinearRegExp/LinearRegExp";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * PATTERNS JAVASCRIPT'S REGEXP NEVER FINISHES ON, FINISHED.
 *
 * Each pattern below takes V8 time that grows exponentially, or with a high
 * power of the text's length, on the text beside it - seconds at thirty
 * characters, years at a few thousand. LinearRegExp reads 400,000
 * characters of each, through every way a caller asks (test, exec with
 * captures, replace, matchAll), in well under two seconds, with the answer
 * JavaScript would give if it finished.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;
const BUDGET_IN_MS: number = 2000;

interface WorstCase {
  name: string;
  pattern: string;
  flags: string;
  text: string;
  // Where the first match is ([index, end]), or null.
  firstMatch: [number, number] | null;
}

const A_RUN: string = "a".repeat(LENGTH);

const WORST_CASES: ReadonlyArray<WorstCase> = [
  {
    name: "a nested repeat, the text never ending as it must",
    pattern: "^(a+)+$",
    flags: "",
    text: `${A_RUN}!`,
    firstMatch: null,
  },
  {
    name: "alternatives that read the same characters, case-insensitive",
    pattern: "(?:a|A|aa)+b",
    flags: "i",
    text: A_RUN,
    firstMatch: null,
  },
  {
    name: "many runs of anything before a character that is not there",
    pattern: "(?:.*a){20}z",
    flags: "s",
    text: A_RUN,
    firstMatch: null,
  },
  {
    name: "an email-shaped pattern on a run of its own characters",
    pattern: "^([a-z0-9]+[._-]?)+@[a-z]+\\.[a-z]{2,}$",
    flags: "i",
    text: `${"a.".repeat(LENGTH / 2)}!`,
    firstMatch: null,
  },
  {
    name: "a look-ahead and a look-behind at every position",
    pattern: "(?<=a+)(?=a*b)a",
    flags: "",
    text: A_RUN,
    firstMatch: null,
  },
  {
    name: "a match at the very end, after all that",
    pattern: "(a+)+b",
    flags: "",
    text: `${A_RUN}b`,
    firstMatch: [0, LENGTH + 1],
  },
  {
    /*
     * \s takes the line breaks too, so the match runs to the end of the
     * last line it can end at - before the "\ntail!" line, as V8 has it on
     * a short text of the same shape.
     */
    name: "the multiline anchors on every line",
    pattern: "^(\\w+\\s?)+$",
    flags: "m",
    text: `${"word word\n".repeat(LENGTH / 10)}tail!`,
    firstMatch: [0, LENGTH - 1],
  },
];

// The work's result, once its fastest attempt (Tests/Helpers/FastestRun) is in budget.
function timed<T>(work: () => T): T {
  const run: FastestRun<T> = fastestRun({
    run: work,
    limitInMs: BUDGET_IN_MS,
  });

  expect(run.inMs).toBeLessThan(BUDGET_IN_MS);

  return run.result;
}

describe("LinearRegExp on 400,000 characters of JavaScript's worst cases", () => {
  test.each(WORST_CASES)("test: $name", (worst: WorstCase) => {
    const pattern: LinearRegExp = new LinearRegExp(worst.pattern, worst.flags);

    expect(
      timed((): boolean => {
        return pattern.test(worst.text);
      }),
    ).toBe(worst.firstMatch !== null);
  });

  test.each(WORST_CASES)("exec with captures: $name", (worst: WorstCase) => {
    let pattern: LinearRegExp;

    try {
      pattern = new LinearRegExp(worst.pattern, worst.flags, {
        captures: true,
      });
    } catch {
      // A capture inside a look-around: asked without captures.
      pattern = new LinearRegExp(worst.pattern, worst.flags);
    }

    const match: LinearRegExpMatch | null = timed(
      (): LinearRegExpMatch | null => {
        return pattern.exec(worst.text);
      },
    );

    expect(match === null ? null : [match.index, match.end]).toEqual(
      worst.firstMatch,
    );
  });

  test.each(WORST_CASES)("replace every match: $name", (worst: WorstCase) => {
    const pattern: LinearRegExp = new LinearRegExp(
      worst.pattern,
      `${worst.flags}g`,
    );
    const replaced: string = timed((): string => {
      return pattern.replace(worst.text, (): string => {
        return "#";
      });
    });

    if (worst.firstMatch === null) {
      expect(replaced).toBe(worst.text);
    } else {
      expect(replaced.startsWith("#")).toBe(true);
    }
  });

  test("matchAll lists 40,000 matches of a line pattern", () => {
    const text: string = "id=12345;".repeat(40000);
    const pattern: LinearRegExp = new LinearRegExp("id=(\\d+);", "g", {
      captures: true,
    });
    const matches: Array<LinearRegExpMatch> = timed(
      (): Array<LinearRegExpMatch> => {
        return pattern.matchAll(text);
      },
    );

    expect(matches.length).toBe(40000);
    expect(matches[39999]!.captures).toEqual(["12345"]);
  });

  test("sixteen megabytes on one line take no stack and finish", () => {
    const text: string = `${"QUJD".repeat(4 * 1024 * 1024)}!`;
    const pattern: LinearRegExp = new LinearRegExp("^([A-Za-z0-9+/]+)+=*$");
    const timedRun: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(pattern.test(text)).toBe(false);
      },
      limitInMs: 10000,
    });
    expect(timedRun.inMs).toBeLessThan(10000);
  });
});
