import LinearRegExp, {
  MAX_PATTERN_LENGTH,
} from "../../../Utils/LinearRegExp/LinearRegExp";
import {
  clearKeptAutomata,
  computeLookaroundTables,
  getAnchoredWorkspaceSize,
  getKeptAutomataBytes,
  getKeptAutomataCount,
  MAX_AUTOMATON_BYTES,
  MAX_KEPT_AUTOMATA_BYTES,
  newPositionBits,
  positionBit,
  setPositionBit,
  WORK_PER_CODE_UNIT,
  WORK_PER_STEP,
  WorkMeter,
} from "../../../Utils/LinearRegExp/Matcher";
import {
  clearLinearRegExpCache,
  getCachedPatternSteps,
  getLinearRegExp,
  MAX_CACHED_PATTERN_STEPS,
  MAX_CACHED_PATTERNS,
} from "../../../Utils/LinearRegExp/PatternCache";
import {
  clearGrokCompileCache,
  compileGrokPatternCached,
  getCachedGrokSteps,
  MAX_CACHED_GROK_STEPS,
} from "../../../Utils/Grok/Grok";
import { MAX_GROUP_NESTING } from "../../../Utils/LinearRegExp/Parser";
import {
  CompiledPattern,
  MAX_EMPTY_REPEAT_NESTING,
  MAX_LOOKAROUNDS,
} from "../../../Utils/LinearRegExp/Program";
import {
  PatternProblemError,
  PatternProblemReason,
  PatternWorkLimitError,
} from "../../../Utils/LinearRegExp/PatternProblem";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * WHAT ONE PATTERN MAY COST: TO COMPILE, TO KEEP, AND TO ASK.
 *
 * The patterns LinearRegExp runs are written by the people of a project,
 * and run on servers, workers and ingest every project shares. Time in line
 * with the text is not the whole bound: a pattern can also be built to take
 * long to compile, to hold a great deal of memory between questions, or to
 * cost much per character of a short text. Each of those is bounded, and
 * each bound is held here - a pattern past one is refused as too large, or
 * the work stops with PatternWorkLimitError, and the memory kept never
 * passes its limit.
 * ---------------------------------------------------------------------------
 */

function refusalOf(source: string, flags: string = ""): unknown {
  try {
    new LinearRegExp(source, flags);
  } catch (error: unknown) {
    return error;
  }

  return null;
}

function expectTooLarge(source: string, flags: string = ""): void {
  const refusal: unknown = refusalOf(source, flags);

  expect(refusal).toBeInstanceOf(PatternProblemError);
  expect((refusal as PatternProblemError).reason).toBe(
    PatternProblemReason.TooLarge,
  );
}

// The engine's module as require() hands it over: its default export the class.
type Loaded = { default: typeof LinearRegExp };

const ENGINE_MODULE: string = "../../../Utils/LinearRegExp/LinearRegExp";

function compiledOf(pattern: LinearRegExp): CompiledPattern {
  return (pattern as unknown as { compiled: CompiledPattern }).compiled;
}

function randomText(length: number, alphabet: string, seed: number): string {
  const random: SeededRandom = seededRandom(seed);
  let text: string = "";

  for (let index: number = 0; index < length; index++) {
    text += alphabet[random(alphabet.length)];
  }

  return text;
}

function hex(codeUnit: number): string {
  return codeUnit.toString(16).padStart(4, "0");
}

describe("how large a pattern it compiles", () => {
  function nested(depth: number, open: string, inner: string): string {
    return `${open.repeat(depth)}${inner}${")".repeat(depth)}`;
  }

  test("groups nested deeper than the limit are refused as too large, though JavaScript takes them", () => {
    const tooDeep: string = nested(MAX_GROUP_NESTING + 1, "(?:", "a");

    expect(new RegExp(tooDeep).test("a")).toBe(true);
    expectTooLarge(tooDeep);
    expectTooLarge(nested(MAX_GROUP_NESTING + 1, "(", "a"));
    expectTooLarge(nested(MAX_GROUP_NESTING + 1, "(?=", "a"));
    expectTooLarge(nested(20000, "(?:", "a"));
  });

  test("groups nested to the limit compile, and answer as JavaScript does", () => {
    const deepest: string = nested(MAX_GROUP_NESTING, "(?:", "a");

    expect(new LinearRegExp(deepest).test("xax")).toBe(true);
    expect(new LinearRegExp(deepest).test("xbx")).toBe(false);
  });

  test("repeats that can match nothing, nested deeper than the limit, are refused", () => {
    // a* inside (?:...)* inside (?:...)* ...: every outer body can match nothing.
    const atLimit: string = `${"(?:".repeat(MAX_EMPTY_REPEAT_NESTING)}a*${")*".repeat(MAX_EMPTY_REPEAT_NESTING)}`;
    const pastLimit: string = `(?:${atLimit})*`;

    expect(new RegExp(pastLimit).test("aa")).toBe(true);
    expectTooLarge(pastLimit);

    // At the limit: JavaScript's answers, empty matches and all.
    const pattern: LinearRegExp = new LinearRegExp(atLimit, "g");

    for (const text of ["", "a", "aaa b aa", "baab", "b a b"]) {
      expect(
        pattern.replace(text, (match: string): string => {
          return `<${match}>`;
        }),
      ).toBe(
        text.replace(new RegExp(atLimit, "g"), (match: string): string => {
          return `<${match}>`;
        }),
      );
    }
  });

  test("a pattern of more look-arounds than the limit is refused; one written many times counts once", () => {
    const distinct: (count: number) => string = (count: number): string => {
      let source: string = "";

      for (let index: number = 1; index <= count; index++) {
        source += `(?!x{${index}})`;
      }

      return `${source}a`;
    };

    expectTooLarge(distinct(MAX_LOOKAROUNDS + 1));

    const atLimit: LinearRegExp = new LinearRegExp(distinct(MAX_LOOKAROUNDS));
    expect(atLimit.test("xxa")).toBe(
      new RegExp(distinct(MAX_LOOKAROUNDS)).test("xxa"),
    );
    expect(atLimit.test("a")).toBe(true);

    // The grok library's (?<![0-9]) beside every IP address: one look-around.
    const repeated: string = "(?<![0-9])\\d+(?![0-9])\\.".repeat(100);
    const sameOnes: LinearRegExp = new LinearRegExp(repeated);
    const text: string = "1.".repeat(100);

    expect(sameOnes.test(text)).toBe(new RegExp(repeated).test(text));
    expect(compiledOf(sameOnes).lookarounds.length).toBe(2);
  });

  test("a pattern longer than the limit is refused; one as long as the limit compiles", () => {
    // (?:) compiles to no step at all: only the length decides.
    const atLimit: string = "(?:)".repeat(MAX_PATTERN_LENGTH / 4);

    expect(atLimit.length).toBe(MAX_PATTERN_LENGTH);
    expect(new LinearRegExp(atLimit).test("anything")).toBe(true);
    expectTooLarge(`${atLimit}x`);
  });

  test("a pattern longer than the limit is refused before anything reads it, valid or not", () => {
    // Megabytes of pattern, as a filter's JSON could carry: refused at once.
    const startedAt: number = Date.now();

    expectTooLarge(`(${"a".repeat(5_000_000)}`);
    expectTooLarge("a".repeat(5_000_000));
    expect(Date.now() - startedAt).toBeLessThan(500);

    // Shorter than the limit, what is not a regular expression says so.
    expect(refusalOf("(abc")).toBeInstanceOf(SyntaxError);
  });

  test("a pattern of the largest case-insensitive classes, each new, compiles quickly", () => {
    /*
     * Closing a class over case reads every code unit with a case variant
     * it spans; written 1,300 times, all different, at the longest a pattern
     * may be. It took close to two seconds; it takes a few dozen
     * milliseconds.
     */
    let source: string = "";
    let first: number = 0x100;

    while (source.length + 15 <= MAX_PATTERN_LENGTH) {
      source += `[\\u${hex(first)}-\\u${hex(0xfff0 - (first % 7))}]`;
      first++;
    }

    expect(first - 0x100).toBeGreaterThan(1200);

    const startedAt: number = Date.now();
    const pattern: LinearRegExp = new LinearRegExp(source, "i");

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(pattern.test("short text")).toBe(false);
  });

  test("a stack too deep for compiling is a pattern too large, not an error of the engine", () => {
    jest.isolateModules(() => {
      jest.doMock("../../../Utils/LinearRegExp/Parser", () => {
        return {
          __esModule: true,
          parsePattern: (): never => {
            throw new RangeError("Maximum call stack size exceeded");
          },
        };
      });

      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const isolated: Loaded = require(ENGINE_MODULE) as Loaded;
      let refusal: unknown = null;

      try {
        new isolated.default("abc");
      } catch (error: unknown) {
        refusal = error;
      }

      expect((refusal as Error).name).toBe("PatternProblemError");
      expect((refusal as PatternProblemError).reason).toBe(
        PatternProblemReason.TooLarge,
      );
    });
  });
});

describe("what the matcher keeps between questions", () => {
  test("the automata kept together never hold more than their limit, and drop the least recently read", () => {
    clearKeptAutomata();

    /*
     * Each pattern meets thousands of states of hundreds of steps each on
     * these texts: far more than the limit, together.
     */
    const text: string = randomText(30000, "ab", 7);
    let largest: number = 0;

    for (let index: number = 0; index < 24; index++) {
      const pattern: LinearRegExp = new LinearRegExp(
        `(?:[ab]*a[ab]{9}|[ab]{0,${600 + index}})Q`,
      );

      try {
        pattern.test(text);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(PatternWorkLimitError);
      }

      largest = Math.max(largest, getKeptAutomataBytes());
      expect(getKeptAutomataBytes()).toBeLessThanOrEqual(
        MAX_KEPT_AUTOMATA_BYTES,
      );
    }

    // They did fill it: what was kept reached near the limit.
    expect(largest).toBeGreaterThan(MAX_KEPT_AUTOMATA_BYTES / 2);
    // And some were dropped to stay within it.
    expect(getKeptAutomataCount()).toBeLessThan(24);
  });

  test("one automaton never holds more than its own limit", () => {
    clearKeptAutomata();

    /*
     * Few kinds of code unit - a-z, and "_", which the word boundary tells
     * apart anyway - so the automaton may keep thousands of states, and
     * each holds up to three thousand steps: some twenty megabytes, kept.
     */
    const pattern: LinearRegExp = new LinearRegExp("[a-z]{0,3000}_");

    try {
      pattern.test(randomText(400000, "abcdefghijklmnopqrstuvwxyz", 11));
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(PatternWorkLimitError);
    }

    // test() reads with one automaton: the pattern read forwards.
    expect(getKeptAutomataCount()).toBe(1);
    expect(getKeptAutomataBytes()).toBeLessThanOrEqual(MAX_AUTOMATON_BYTES);
    expect(getKeptAutomataBytes()).toBeGreaterThan(MAX_AUTOMATON_BYTES * 0.9);
  });

  test("a pattern whose automaton was dropped answers as before", () => {
    clearKeptAutomata();

    const sources: Array<string> = [
      "^api-\\d+$",
      "(?<=user=)\\w+",
      "error.{0,40}timeout",
      "\\bdb-(?!test)\\w+",
    ];
    const texts: Array<string> = [
      "api-12",
      "login user=ada ok",
      "error: the call ran into a timeout",
      "db-prod db-test",
      "nothing here",
    ];
    const answers: () => Array<boolean> = (): Array<boolean> => {
      const result: Array<boolean> = [];

      for (const source of sources) {
        for (const text of texts) {
          result.push(new LinearRegExp(source, "i").test(text));
        }
      }

      return result;
    };

    const before: Array<boolean> = answers();
    const javascript: Array<boolean> = [];

    for (const source of sources) {
      for (const text of texts) {
        javascript.push(new RegExp(source, "i").test(text));
      }
    }

    expect(before).toEqual(javascript);

    clearKeptAutomata();
    expect(getKeptAutomataCount()).toBe(0);
    expect(answers()).toEqual(javascript);
  });

  test("one set of the ordered machine's arrays serves every pattern", () => {
    let largestNeed: number = 0;

    // Largest first: the arrays it grew to serve every smaller pattern after.
    for (let size: number = 200; size >= 1; size--) {
      const pattern: LinearRegExp = new LinearRegExp(
        `(?:x|y){0,${size}}z`,
        "g",
      );
      const compiled: CompiledPattern = compiledOf(pattern);

      largestNeed = Math.max(
        largestNeed,
        compiled.main.ops.length * compiled.main.scopeWidth,
      );

      expect(
        pattern.replace("xyxz yz z", (): string => {
          return "_";
        }),
      ).toBe("xyxz yz z".replace(new RegExp(`(?:x|y){0,${size}}z`, "g"), "_"));
    }

    /*
     * Kept per program, the arrays of 200 patterns would add up to many
     * times the largest one's.
     */
    expect(getAnchoredWorkspaceSize()).toBeGreaterThanOrEqual(largestNeed);
    expect(getAnchoredWorkspaceSize()).toBeLessThan(largestNeed * 2 + 100000);
  });
});

describe("what the caches of compiled patterns keep", () => {
  test("the patterns cached together hold at most so many steps, however few characters each is", () => {
    clearLinearRegExpCache();

    // Nine characters, about sixteen thousand steps with its backwards copy.
    for (let index: number = 0; index < 120; index++) {
      const pattern: LinearRegExp = getLinearRegExp(`.{0,4000}x${index}`);

      expect(pattern.steps).toBeGreaterThan(15000);
      expect(getCachedPatternSteps()).toBeLessThanOrEqual(
        MAX_CACHED_PATTERN_STEPS,
      );
    }

    // The least recently used were dropped; the most recent is still kept.
    const kept: LinearRegExp = getLinearRegExp(".{0,4000}x119");
    expect(getLinearRegExp(".{0,4000}x119")).toBe(kept);
    expect(getCachedPatternSteps()).toBeGreaterThan(
      MAX_CACHED_PATTERN_STEPS / 2,
    );

    clearLinearRegExpCache();
    expect(getCachedPatternSteps()).toBe(0);
  });

  test("small patterns are kept by the thousand", () => {
    clearLinearRegExpCache();

    const first: LinearRegExp = getLinearRegExp("^api-0$", "i");

    for (let index: number = 1; index < MAX_CACHED_PATTERNS; index++) {
      getLinearRegExp(`^api-${index}$`, "i");
    }

    // All of them fit: the first is still the one compiled.
    expect(getLinearRegExp("^api-0$", "i")).toBe(first);
    clearLinearRegExpCache();
  });

  test("the grok patterns cached together hold at most so many steps", () => {
    clearGrokCompileCache();

    for (let index: number = 0; index < 160; index++) {
      compileGrokPatternCached(`%{EMAILADDRESS:a} n${index}`);
      expect(getCachedGrokSteps()).toBeLessThanOrEqual(MAX_CACHED_GROK_STEPS);
    }

    expect(getCachedGrokSteps()).toBeGreaterThan(MAX_CACHED_GROK_STEPS / 2);
    clearGrokCompileCache();
    expect(getCachedGrokSteps()).toBe(0);
  });
});

describe("a yes or no for every position of a text", () => {
  test("takes a bit a position, not a byte", () => {
    const bits: Uint8Array = newPositionBits(1000);

    expect(bits.length).toBe(126);

    for (const position of [0, 1, 7, 8, 9, 500, 999, 1000]) {
      expect(positionBit(bits, position)).toBe(0);
      setPositionBit(bits, position);
      expect(positionBit(bits, position)).toBe(1);
    }

    expect(positionBit(bits, 2)).toBe(0);
    expect(positionBit(bits, 998)).toBe(0);
  });

  test("a pattern of the most look-arounds reads a long text in a bit per position per look-around", () => {
    let source: string = "";

    for (let index: number = 1; index <= MAX_LOOKAROUNDS; index++) {
      source += `(?<!y{${index}})`;
    }

    source += "x";

    const pattern: LinearRegExp = new LinearRegExp(source, "g");
    const compiled: CompiledPattern = compiledOf(pattern);
    const text: string = `${"ab".repeat(1000000)}x`;
    const meter: WorkMeter = WorkMeter.forText(
      text.length,
      compiled.totalSteps,
    );
    const tables: Array<Uint8Array> = computeLookaroundTables(
      compiled,
      text,
      meter,
    );

    expect(tables.length).toBe(MAX_LOOKAROUNDS);

    for (const table of tables) {
      expect(table.length).toBe((text.length >>> 3) + 1);
    }

    expect(
      pattern.replace(text, (): string => {
        return "!";
      }),
    ).toBe(`${"ab".repeat(1000000)}!`);
  });
});

describe("the work one question may take", () => {
  test("is in line with the text, plus an allowance in line with the pattern's size", () => {
    const meter: WorkMeter = WorkMeter.forText(1000, 50);
    const limit: number = WORK_PER_CODE_UNIT * 1001 + WORK_PER_STEP * 50;

    meter.spend(limit);
    expect(() => {
      meter.spend(1);
    }).toThrow(PatternWorkLimitError);
  });

  test("a short text with the deepest pattern a person may write answers quickly", () => {
    /*
     * Repeats that can match nothing, nested a thousand deep, took seconds
     * on an eleven-character text; they are refused, and the deepest
     * allowed answers in a moment.
     */
    const deep: string = `${"(?:".repeat(1000)}a*${")*".repeat(1000)}`;

    expectTooLarge(deep);

    const allowed: string = `${"(?:".repeat(MAX_EMPTY_REPEAT_NESTING)}a*${")*".repeat(MAX_EMPTY_REPEAT_NESTING)}`;
    const startedAt: number = Date.now();

    for (let run: number = 0; run < 200; run++) {
      new LinearRegExp(allowed, "g").replace("aaaa b aaaa", String);
    }

    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  test("copying what ways captured counts as work: many groups do not hold a short text", () => {
    /*
     * At every position each of 1,500 alternatives saves where its group
     * starts, copying what all 1,500 groups captured. Uncounted, the copies
     * took a second and a half on two thousand characters; counted, the
     * question stops within its work.
     */
    const groups: string = `(?:${Array.from({ length: 1500 }, (): string => {
      return "(a)";
    }).join("|")})*!`;
    const pattern: LinearRegExp = new LinearRegExp(groups, "", {
      captures: true,
    });
    const text: string = `${"a".repeat(2000)}!`;
    const startedAt: number = Date.now();

    for (let run: number = 0; run < 3; run++) {
      try {
        pattern.exec(text);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(PatternWorkLimitError);
      }
    }

    expect(Date.now() - startedAt).toBeLessThan(1500);
  });

  test("a large pattern on many short texts stops within its allowance each time", () => {
    // About 8,000 steps whose automaton meets a new large state at each character.
    const pattern: LinearRegExp = new LinearRegExp(
      "(?:[ab]*a[ab]{12}|[ab]{0,3900})Q",
    );
    const random: SeededRandom = seededRandom(5);
    const startedAt: number = Date.now();

    for (let text: number = 0; text < 200; text++) {
      let short: string = "";

      for (let index: number = 0; index < 40; index++) {
        short += random(2) === 0 ? "a" : "b";
      }

      try {
        expect(pattern.test(short)).toBe(false);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(PatternWorkLimitError);
      }
    }

    expect(Date.now() - startedAt).toBeLessThan(10000);
  });
});
