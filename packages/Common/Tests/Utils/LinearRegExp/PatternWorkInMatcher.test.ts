import LinearRegExp, {
  LinearRegExpMatch,
} from "../../../Utils/LinearRegExp/LinearRegExp";
import {
  clearKeptAutomata,
  WORK_PER_CODE_UNIT,
} from "../../../Utils/LinearRegExp/Matcher";
import {
  clearLinearRegExpCache,
  getCachedPatternCount,
  getLinearRegExp,
  LinearRegExpHandle,
} from "../../../Utils/LinearRegExp/PatternCache";
import {
  PatternProblemError,
  PatternWorkAllowanceSpentError,
  PatternWorkLimitError,
} from "../../../Utils/LinearRegExp/PatternProblem";
import {
  AUTOMATON_WORK,
  COMPILE_WORK,
  COMPILE_WORK_PER_STEP,
  getStoppedPatternQuestions,
  PatternWorkAllowance,
  providePatternWorkAllowance,
  QUESTION_WORK,
} from "../../../Utils/LinearRegExp/PatternWork";
import { DEFAULT_MAX_STEPS } from "../../../Utils/LinearRegExp/Program";
import {
  clearGrokCompileCache,
  compileGrokPatternCached,
  getCachedGrokPatternCount,
  matchGrokPattern,
} from "../../../Utils/Grok/Grok";
import BadDataException from "../../../Types/Exception/BadDataException";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { drawPattern, drawText, DrawnPattern } from "./PatternFuzzing";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * EVERY QUESTION OF A PIECE OF WORK COUNTS AGAINST ITS ALLOWANCE.
 *
 * Inside a piece of work with an allowance (PatternWork.ts) - one evaluation
 * of a project's rules, one batch of telemetry - the matcher counts what
 * each question does against it: a fixed cost, every character each reading
 * reads, every step visited, building automata, and compiling. Once it is
 * spent, nothing more is compiled and every question stops at once. These
 * hold that through the matcher's own questions - and that inside an
 * allowance large enough, every answer is the one given without one.
 * ---------------------------------------------------------------------------
 */

let current: PatternWorkAllowance | undefined = undefined;

beforeEach(() => {
  current = undefined;
  providePatternWorkAllowance((): PatternWorkAllowance | undefined => {
    return current;
  });
});

afterEach(() => {
  current = undefined;
});

// Runs `work` with this allowance as the one under way.
function within<T>(allowance: PatternWorkAllowance, work: () => T): T {
  const outer: PatternWorkAllowance | undefined = current;
  current = allowance;

  try {
    return work();
  } finally {
    current = outer;
  }
}

function errorOf(work: () => unknown): unknown {
  try {
    work();
  } catch (error: unknown) {
    return error;
  }

  return null;
}

function generous(): PatternWorkAllowance {
  return new PatternWorkAllowance({ pool: 1e15 });
}

// Written to need many steps per character on a's and b's (LinearRegExp.test.ts).
const EXPLODING: string = "(?:[ab]*a[ab]{14}|[ab]{0,2000})Q";

function randomAb(length: number, seed: number): string {
  const random: SeededRandom = seededRandom(seed);
  let text: string = "";

  for (let index: number = 0; index < length; index++) {
    text += random(2) === 0 ? "a" : "b";
  }

  return text;
}

describe("what a question counts", () => {
  test("every character a reading reads, and a fixed cost, besides the steps it visits", () => {
    const pattern: LinearRegExp = new LinearRegExp("zzz");
    const text: string = "a".repeat(100_000);
    const allowance: PatternWorkAllowance = generous();

    // Warm: the automaton is built and its states met once.
    within(allowance, (): boolean => {
      return pattern.test(text);
    });

    const before: number = allowance.usedWork;
    const answer: boolean = within(allowance, (): boolean => {
      return pattern.test(text);
    });
    const used: number = allowance.usedWork - before;

    expect(answer).toBe(false);
    // One reading of the whole text: a unit a character, and the question's cost.
    expect(used).toBeGreaterThanOrEqual(text.length + QUESTION_WORK);
    expect(used).toBeLessThan(text.length + QUESTION_WORK + 1000);
  });

  test("a reading that stops at a match counts what it read up to there", () => {
    const pattern: LinearRegExp = new LinearRegExp("needle");
    const text: string = `${"x".repeat(10)}needle${"y".repeat(1_000_000)}`;
    const allowance: PatternWorkAllowance = generous();

    within(allowance, (): boolean => {
      return pattern.test(text);
    });

    const before: number = allowance.usedWork;

    expect(
      within(allowance, (): boolean => {
        return pattern.test(text);
      }),
    ).toBe(true);
    expect(allowance.usedWork - before).toBeLessThan(1000);
  });

  test("a pattern whose look-around is worked out for the whole text reads it once more", () => {
    const pattern: LinearRegExp = new LinearRegExp("(?<=key=)zz");
    const text: string = "a".repeat(50_000);
    const allowance: PatternWorkAllowance = generous();

    within(allowance, (): boolean => {
      return pattern.test(text);
    });

    const before: number = allowance.usedWork;

    within(allowance, (): boolean => {
      return pattern.test(text);
    });

    expect(allowance.usedWork - before).toBeGreaterThanOrEqual(2 * text.length);
  });

  test("a new automaton counts what building it costs, and keeping its first states", () => {
    const pattern: LinearRegExp = new LinearRegExp("prod-[0-9]+");
    const allowance: PatternWorkAllowance = generous();

    clearKeptAutomata();

    within(allowance, (): boolean => {
      return pattern.test("prod-42");
    });

    const cold: number = allowance.usedWork;
    const before: number = allowance.usedWork;

    within(allowance, (): boolean => {
      return pattern.test("prod-42");
    });

    const warm: number = allowance.usedWork - before;

    expect(cold).toBeGreaterThan(warm + 500);
  });

  test("building a new automaton is counted once, by the first question that uses it", () => {
    const pattern: LinearRegExp = new LinearRegExp("x");
    const allowance: PatternWorkAllowance = generous();

    clearKeptAutomata();

    within(allowance, (): boolean => {
      return pattern.test("");
    });

    const cold: number = allowance.usedWork;

    within(allowance, (): boolean => {
      return pattern.test("");
    });

    const warm: number = allowance.usedWork - cold;

    // Its tables and arrays, besides the question and its one state.
    expect(cold - warm).toBeGreaterThanOrEqual(AUTOMATON_WORK);
    expect(warm).toBeLessThan(AUTOMATON_WORK);
  });

  test("every question of an exec or a replace is counted, its own and those it asks", () => {
    const pattern: LinearRegExp = new LinearRegExp("(\\d+)-(\\d+)", "g", {
      captures: true,
    });
    const text: string = "10-20 and 30-40 and 50-60";
    const allowance: PatternWorkAllowance = generous();
    const matches: Array<LinearRegExpMatch> = within(
      allowance,
      (): Array<LinearRegExpMatch> => {
        return pattern.matchAll(text);
      },
    );

    expect(
      matches.map((match: LinearRegExpMatch): string => {
        return match.value;
      }),
    ).toEqual(["10-20", "30-40", "50-60"]);
    // A test, then the reading of every match: more than two questions.
    expect(allowance.usedWork).toBeGreaterThan(2 * QUESTION_WORK + text.length);
  });
});

describe("a long stretch with nothing that can start a match is read in counted pieces", () => {
  /*
   * A reading skips the code units that cannot start a match a piece at a
   * time, so a long stretch of them is counted as it is read; where a piece
   * ends is no place a match starts or ends, and every answer is the same.
   */
  const STRETCH: number = 3 * 65_536 + 17;

  test("a match after the stretch is found, by test, exec and replace", () => {
    const text: string = `${"x".repeat(STRETCH)}needle${"y".repeat(10)}`;
    const pattern: LinearRegExp = new LinearRegExp("need(le)", "g", {
      captures: true,
    });
    const match: LinearRegExpMatch | null = pattern.exec(text);

    expect(pattern.test(text)).toBe(true);
    expect(match?.index).toBe(STRETCH);
    expect(match?.captures).toEqual(["le"]);
    expect(
      pattern.replace(text, (): string => {
        return "[X]";
      }),
    ).toBe(`${"x".repeat(STRETCH)}[X]${"y".repeat(10)}`);
  });

  test("a match before the stretch is found where it starts, read backwards over the stretch", () => {
    const text: string = `ab needle${"x".repeat(STRETCH)}`;
    const pattern: LinearRegExp = new LinearRegExp("needle");

    expect(pattern.exec(text)?.index).toBe(3);
  });

  test("word boundaries at the ends of the stretch hold as before", () => {
    const glued: string = `${"x".repeat(STRETCH)}needle`;
    const spaced: string = `${"x".repeat(STRETCH)} needle `;
    const pattern: LinearRegExp = new LinearRegExp("\\bneedle\\b");

    expect(pattern.test(glued)).toBe(new RegExp("\\bneedle\\b").test(glued));
    expect(pattern.test(spaced)).toBe(true);
    expect(pattern.exec(spaced)?.index).toBe(STRETCH + 1);
  });

  test("look-arounds over the stretch hold as before", () => {
    const text: string = `key=${"x".repeat(STRETCH)}value${"x".repeat(STRETCH)}`;

    for (const source of [
      "(?<=x)value(?=x)",
      "(?<=key=x+)value",
      "value(?![^x])",
      "(?<!y)value",
    ]) {
      expect({
        source,
        answer: new LinearRegExp(source).exec(text)?.index,
      }).toEqual({ source, answer: new RegExp(source).exec(text)?.index });
    }
  });
});

describe("what a compile counts", () => {
  beforeEach(() => {
    clearLinearRegExpCache();
  });

  test("a compile counts a fixed part, the pattern's length and each step it compiles to", () => {
    const source: string = "[a-z]{0,100}x";
    const allowance: PatternWorkAllowance = generous();
    const pattern: LinearRegExp = within(allowance, (): LinearRegExp => {
      return new LinearRegExp(source, "i");
    });

    expect(allowance.usedWork).toBe(
      COMPILE_WORK + source.length + COMPILE_WORK_PER_STEP * pattern.steps,
    );
  });

  test("a compiled pattern found in the cache is not counted again", () => {
    const allowance: PatternWorkAllowance = generous();

    within(allowance, (): LinearRegExp => {
      return getLinearRegExp("cached+pattern");
    });

    const before: number = allowance.usedWork;

    within(allowance, (): LinearRegExp => {
      return getLinearRegExp("cached+pattern");
    });

    expect(allowance.usedWork).toBe(before);
  });

  test("a pattern refused as too large counts as one compiled to the most steps there may be, twice", () => {
    const source: string = "a{0,9000}b{0,9000}";
    const allowance: PatternWorkAllowance = generous();
    const refusal: unknown = within(allowance, (): unknown => {
      return errorOf((): LinearRegExp => {
        return new LinearRegExp(source);
      });
    });

    expect(refusal).toBeInstanceOf(PatternProblemError);
    expect(allowance.usedWork).toBe(
      COMPILE_WORK +
        source.length +
        COMPILE_WORK_PER_STEP * 2 * DEFAULT_MAX_STEPS,
    );
  });

  test("a pattern that is not a regular expression counts its reading only", () => {
    const allowance: PatternWorkAllowance = generous();
    const refusal: unknown = within(allowance, (): unknown => {
      return errorOf((): LinearRegExp => {
        return new LinearRegExp("(unclosed");
      });
    });

    expect(refusal).toBeInstanceOf(SyntaxError);
    expect(allowance.usedWork).toBe(COMPILE_WORK + "(unclosed".length);
  });
});

describe("once the allowance is spent", () => {
  beforeEach(() => {
    clearLinearRegExpCache();
    clearGrokCompileCache();
  });

  test("nothing is compiled, and the refusal is not kept: it says nothing of the pattern", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 10,
    });

    allowance.charge(11);

    const countBefore: number = getCachedPatternCount();
    const refusal: unknown = within(allowance, (): unknown => {
      return errorOf((): LinearRegExp => {
        return getLinearRegExp("never+compiled+here");
      });
    });

    expect(refusal).toBeInstanceOf(PatternWorkAllowanceSpentError);
    expect(getCachedPatternCount()).toBe(countBefore);

    // The next piece of work compiles it.
    expect(
      getLinearRegExp("never+compiled+here").test("never compiled here"),
    ).toBe(false);
    expect(
      getLinearRegExp("never+compiled+here").test("neverrcompiledhere"),
    ).toBe(true);
  });

  test("a grok pattern is not compiled, and not kept as an invalid one", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 10,
    });

    allowance.charge(11);

    const refusal: unknown = within(allowance, (): unknown => {
      return errorOf((): unknown => {
        return compileGrokPatternCached("%{IPV4:client} %{WORD:method}");
      });
    });

    expect(refusal).toBeInstanceOf(PatternWorkLimitError);
    expect(refusal).not.toBeInstanceOf(BadDataException);
    expect(getCachedGrokPatternCount()).toBe(0);

    expect(
      matchGrokPattern(
        compileGrokPatternCached("%{IPV4:client} %{WORD:method}"),
        "10.0.0.1 GET",
      ),
    ).toEqual({ client: "10.0.0.1", method: "GET" });
  });

  test("an invalid grok pattern is still kept as invalid while the allowance holds", () => {
    const allowance: PatternWorkAllowance = generous();
    const refusal: unknown = within(allowance, (): unknown => {
      return errorOf((): unknown => {
        return compileGrokPatternCached("%{NOT_A_KNOWN_PATTERN:x}");
      });
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(getCachedGrokPatternCount()).toBe(1);
  });

  test("a grok line stays unparsed, without a lookup", () => {
    const compiled: ReturnType<typeof compileGrokPatternCached> =
      compileGrokPatternCached("%{IPV4:client}");
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 10,
    });

    allowance.charge(11);

    expect(
      within(allowance, (): unknown => {
        return matchGrokPattern(compiled, "10.0.0.1");
      }),
    ).toBeNull();
    expect(allowance.stoppedQuestions).toBe(1);
  });

  test("a pattern built to take far more work than real ones spends it, and every question after stops too", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 2_000_000,
    });
    const exploding: LinearRegExp = new LinearRegExp(EXPLODING);
    const plain: LinearRegExp = new LinearRegExp("plain");
    const stopped: Array<unknown> = [];

    for (let question: number = 0; question < 20; question++) {
      stopped.push(
        within(allowance, (): unknown => {
          return errorOf((): boolean => {
            return exploding.test(randomAb(2000, question));
          });
        }),
      );
    }

    expect(allowance.isSpent).toBe(true);
    expect(
      stopped.some((error: unknown): boolean => {
        return error instanceof PatternWorkAllowanceSpentError;
      }),
    ).toBe(true);
    expect(
      within(allowance, (): unknown => {
        return errorOf((): boolean => {
          return plain.test("a plain text");
        });
      }),
    ).toBeInstanceOf(PatternWorkAllowanceSpentError);

    // Without the allowance, the plain question answers.
    expect(plain.test("a plain text")).toBe(true);
  });

  test("a long text stops partway rather than being read to the end", () => {
    const pattern: LinearRegExp = new LinearRegExp("zzz");
    const text: string = "a".repeat(20_000_000);
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 200_000,
    });

    pattern.test("warm");

    const error: unknown = within(allowance, (): unknown => {
      return errorOf((): boolean => {
        return pattern.test(text);
      });
    });

    expect(error).toBeInstanceOf(PatternWorkAllowanceSpentError);
    /*
     * Counted as it reads, a few tens of thousands of characters at a time:
     * stopped within a few of those past the allowance, not at the end of
     * the twenty million.
     */
    expect(allowance.usedWork).toBeLessThan(1_000_000);
  });
});

describe("questions with no answer are counted", () => {
  test("one that stops at its own limit, inside an allowance, is counted there", () => {
    const allowance: PatternWorkAllowance = generous();
    const exploding: LinearRegExp = new LinearRegExp(EXPLODING);
    const outsideBefore: number = getStoppedPatternQuestions();

    const error: unknown = within(allowance, (): unknown => {
      return errorOf((): boolean => {
        return exploding.test(randomAb(50_000, 7));
      });
    });

    expect(error).toBeInstanceOf(PatternWorkLimitError);
    expect(error).not.toBeInstanceOf(PatternWorkAllowanceSpentError);
    expect(allowance.stoppedQuestions).toBe(1);
    expect(getStoppedPatternQuestions()).toBe(outsideBefore);
  });

  test("one that stops at its own limit outside any allowance is counted for the process", () => {
    const exploding: LinearRegExp = new LinearRegExp(EXPLODING);
    const before: number = getStoppedPatternQuestions();

    expect(
      errorOf((): boolean => {
        return exploding.test(randomAb(50_000, 8));
      }),
    ).toBeInstanceOf(PatternWorkLimitError);
    expect(getStoppedPatternQuestions()).toBe(before + 1);
  });

  test("an answered question counts no stop", () => {
    const allowance: PatternWorkAllowance = generous();

    within(allowance, (): boolean => {
      return new LinearRegExp("a+b").test("aaab");
    });

    expect(allowance.stoppedQuestions).toBe(0);
  });
});

describe("a pattern kept by a handle", () => {
  beforeEach(() => {
    clearLinearRegExpCache();
  });

  test("finds the compiled pattern in the cache: the one getLinearRegExp gives", () => {
    const handle: LinearRegExpHandle = new LinearRegExpHandle(
      "secret-\\d+",
      "g",
    );

    expect(handle.get()).toBe(getLinearRegExp("secret-\\d+", "g"));
    expect(handle.source).toBe("secret-\\d+");
    expect(handle.flags).toBe("g");
  });

  test("keeps no compiled pattern itself: dropped from the cache, it is compiled again and answers the same", () => {
    const handle: LinearRegExpHandle = new LinearRegExpHandle(
      "token=\\w+",
      "g",
    );
    const first: LinearRegExp = handle.get();

    for (const value of Object.values(handle)) {
      expect(value).not.toBeInstanceOf(LinearRegExp);
    }

    clearLinearRegExpCache();

    const second: LinearRegExp = handle.get();

    expect(second).not.toBe(first);
    expect(
      second.replace("a token=abc b", (): string => {
        return "[X]";
      }),
    ).toBe("a [X] b");
  });

  test("compiling it again counts against the piece of work under way", () => {
    const handle: LinearRegExpHandle = new LinearRegExpHandle(
      "token=\\w+",
      "g",
    );

    handle.get();
    clearLinearRegExpCache();

    const allowance: PatternWorkAllowance = generous();

    within(allowance, (): LinearRegExp => {
      return handle.get();
    });

    expect(allowance.usedWork).toBeGreaterThanOrEqual(COMPILE_WORK);
  });

  test("a pattern longer than any that can run is refused when the handle is made", () => {
    expect(
      errorOf((): LinearRegExpHandle => {
        return new LinearRegExpHandle("a".repeat(30_000));
      }),
    ).toBeInstanceOf(PatternProblemError);
  });

  test("a pattern that is not a regular expression throws what getLinearRegExp throws, when asked", () => {
    const handle: LinearRegExpHandle = new LinearRegExpHandle("(unclosed");

    expect(
      errorOf((): LinearRegExp => {
        return handle.get();
      }),
    ).toBeInstanceOf(SyntaxError);
  });
});

describe("inside an allowance large enough, every answer is the one given without one", () => {
  test("test, exec with every group and replace agree on thousands of drawn patterns and texts", () => {
    const random: SeededRandom = seededRandom(20261020);
    let compared: number = 0;

    for (let index: number = 0; index < 1500; index++) {
      const flags: string = ["", "i", "m", "s", "im"][random(5)]!;
      const drawn: DrawnPattern = drawPattern(random, 3, flags.includes("m"));
      const texts: Array<string> = [];

      for (let text: number = 0; text < 4; text++) {
        texts.push(drawText(random, 14));
      }

      let without: LinearRegExp;

      try {
        without = new LinearRegExp(drawn.pattern, `g${flags}`, {
          captures: true,
        });
      } catch {
        continue;
      }

      const allowance: PatternWorkAllowance = generous();
      const withAllowance: LinearRegExp = within(
        allowance,
        (): LinearRegExp => {
          return new LinearRegExp(drawn.pattern, `g${flags}`, {
            captures: true,
          });
        },
      );

      for (const text of texts) {
        const expected: unknown = [
          without.test(text),
          without.exec(text),
          without.replace(text, (matched: string): string => {
            return `<${matched}>`;
          }),
        ];
        const actual: unknown = within(allowance, (): unknown => {
          return [
            withAllowance.test(text),
            withAllowance.exec(text),
            withAllowance.replace(text, (matched: string): string => {
              return `<${matched}>`;
            }),
          ];
        });

        expect({ pattern: drawn.pattern, flags, text, answer: actual }).toEqual(
          {
            pattern: drawn.pattern,
            flags,
            text,
            answer: expected,
          },
        );
        compared++;
      }

      expect(allowance.stoppedQuestions).toBe(0);
    }

    expect(compared).toBeGreaterThan(4000);
  });

  test("a long text a question may read with its own limit is read inside a rule evaluation's allowance too", () => {
    const allowance: PatternWorkAllowance =
      PatternWorkAllowance.forRuleEvaluation();
    const description: string = `${"lorem ipsum ".repeat(400_000)}needle`;

    expect(
      within(allowance, (): boolean => {
        return new LinearRegExp(".{0,30}needle").test(description);
      }),
    ).toBe(true);
    expect(allowance.stoppedQuestions).toBe(0);
    // The text's share is what one pattern alone may take on it.
    expect(allowance.allowedWork).toBeGreaterThanOrEqual(
      WORK_PER_CODE_UNIT * description.length,
    );
  });
});
