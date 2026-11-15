import {
  CompiledPromQLRegex,
  compilePromQLRegex,
  describePromQLPatternProblem,
  MAX_WRITTEN_PATTERN_LENGTH,
  PromQLRegexMatch,
} from "../../../Utils/PromQL/PromQLRegex";
import { MAX_ASTRAL_CLASSES } from "../../../Utils/PromQL/RE2CharacterClass";
import { MAX_PATTERN_LENGTH } from "../../../Utils/LinearRegExp/LinearRegExp";
import {
  clearLinearRegExpCache,
  getCachedPatternCount,
} from "../../../Utils/LinearRegExp/PatternCache";
import {
  PatternProblemError,
  PatternProblemReason,
} from "../../../Utils/LinearRegExp/PatternProblem";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { v8Tests } from "../../Helpers/V8RegExpAnswers";
import { describe, expect, test } from "@jest/globals";

/*
 * Characters beyond U+FFFF in PromQL label patterns (issue #8215), and
 * patterns longer once written out for JavaScript (issue #8218).
 *
 * RE2 reads UTF-8, where an emoji is one character; JavaScript's RegExp
 * without u reads UTF-16 code units, where it is two. "." and a negated
 * class read it as two before, so ^.$ did not match "😀" and ^..$ did. The
 * text a pattern reads is now written with each such character as one code
 * unit (AstralAlphabet), and a lone surrogate as U+FFFD, as Go reads a byte
 * that is not UTF-8. Every answer marked as Prometheus' is what Prometheus
 * v0.316.0's label matcher (labels.NewFastRegexMatcher) or label_replace()'s
 * regexp (github.com/grafana/regexp) answered, built with Go 1.27.4; a lone
 * surrogate was sent to it as JSON, which Go reads as U+FFFD.
 */

const ASTRAL_ROWS: ReadonlyArray<[string, string, boolean]> = [
  [".", "\u{1F600}", true],
  [".", "a", true],
  [".", "", false],
  [".", "\u{10400}", true],
  [".", "\u{10FFFF}", true],
  [".", "\u{1F600}\u{1F600}", false],
  ["..", "\u{1F600}", false],
  ["..", "\u{1F600}\u{1F600}", true],
  ["..", "a\u{1F600}", true],
  ["..", "ab", true],
  ["...", "\u{1F600}\u{1F600}", false],
  ["...", "a\u{1F600}b", true],
  ["a.b", "a\u{1F600}b", true],
  ["a.b", "a\u{1F600}\u{1F600}b", false],
  ["a.b", "axb", true],
  [".{2}", "\u{1F600}", false],
  [".{2}", "\u{1F600}\u{1F600}", true],
  [".{2}", "\u{1F600}a", true],
  [".{1,2}", "\u{1F600}", true],
  [".{1,2}", "\u{1F600}\u{1F600}", true],
  [".{1,2}", "\u{1F600}\u{1F600}\u{1F600}", false],
  [".{2,}", "\u{1F600}", false],
  [".{2,}", "\u{1F600}\u{1F600}", true],
  ["^.$", "\u{1F600}", true],
  [".?", "\u{1F600}", true],
  [".?", "\u{1F600}\u{1F600}", false],
  [".*", "\u{1F600}\u{1F600}\u{1F600}", true],
  [".*", "", true],
  [".+", "\u{1F600}", true],
  [".+.+", "\u{1F600}", false],
  [".+.+", "\u{1F600}\u{1F600}", true],
  ["(?-s).", "\u{1F600}", true],
  ["(?-s).", "\n", false],
  ["(?-s)..", "\u{1F600}", false],
  ["[^a]", "\u{1F600}", true],
  ["[^a]", "a", false],
  ["[^a]{2}", "\u{1F600}", false],
  ["[^a]{2}", "\u{1F600}\u{1F600}", true],
  ["[^a]+", "\u{1F600}a", false],
  ["[^a]+", "\u{1F600}\u{1F600}", true],
  ["\\S", "\u{1F600}", true],
  ["\\S\\S", "\u{1F600}", false],
  ["\\W", "\u{1F600}", true],
  ["\\W{2}", "\u{1F600}", false],
  ["\\D", "\u{1F600}", true],
  ["[[:^alpha:]]", "\u{1F600}", true],
  ["[[:^alpha:]]{2}", "\u{1F600}", false],
  ["[^\\x{1F600}]", "\u{1F600}", false],
  ["[^\\x{1F600}]", "\u{1F601}", true],
  ["[^\\x{1F600}]", "a", true],
  ["[^\\x{1F600}]{2}", "\u{1F601}\u{1F601}", true],
  ["[^\\x{1F600}]{2}", "\u{1F601}", false],
  ["[^\\x{1F600}]{2}", "\u{1F601}a", true],
  ["\\x{1F600}", "\u{1F600}", true],
  ["\\x{1F600}", "\u{1F601}", false],
  ["\\x{1F600}.", "\u{1F600}\u{1F600}", true],
  ["\\x{1F600}.", "\u{1F600}a", true],
  ["\\x{1F600}.", "\u{1F600}", false],
  [".\\x{1F600}", "a\u{1F600}", true],
  [".\\x{1F600}", "\u{1F600}\u{1F600}", true],
  [".\\x{1F600}", "\u{1F600}", false],
  ["[\\x{1F600}-\\x{1F64F}].", "\u{1F603}\u{1F603}", true],
  ["[\\x{1F600}-\\x{1F64F}].", "\u{1F603}", false],
  ["\\x{10400}", "\u{10400}", true],
  ["\\x{10400}", "\u{10428}", false],
  ["(?i)\\x{10400}", "\u{10400}", true],
  ["(?i)\\x{10400}", "\u{10428}", true],
  ["(?i)\\x{10400}", "\u{10401}", false],
  ["(?i)[\\x{10400}-\\x{10427}]", "\u{10428}", true],
  ["(?i)[\\x{10400}-\\x{10427}]", "\u{1044F}", true],
  ["(?i)[\\x{10400}-\\x{10427}]", "\u{10450}", false],
  ["(?i)[^\\x{10400}]", "\u{10428}", false],
  ["(?i)[^\\x{10400}]", "\u{10400}", false],
  ["(?i)[^\\x{10400}]", "a", true],
  ["\\b.\\b", "\u{1F600}", false],
  ["\\b.\\b", "a", true],
  ["\\B.\\B", "\u{1F600}", true],
  ["\\B.\\B", "a", false],
  ["a\\B.", "a\u{1F600}", false],
  ["(?m)^.$", "\u{1F600}", true],
  ["(?m)^.$", "\u{1F600}\n\u{1F600}", false],
  ["(?m)^.$\\n^.$", "\u{1F600}\n\u{1F600}", true],
  ["(?m)^.$\\n^.$", "a\nb", true],
  ["[\\x{10000}-\\x{10FFFF}]+", "\u{1F600}\u{10400}\u{10FFFF}", true],
  ["[^\\x{10000}-\\x{10FFFF}]", "\u{1F600}", false],
  ["[^\\x{10000}-\\x{10FFFF}]", "a", true],
  ["[a\\x{1F600}]{2}", "a\u{1F600}", true],
  ["[a\\x{1F600}]{2}", "\u{1F600}\u{1F600}", true],
  ["\\x{FFFD}", "\u{D83D}", true],
  ["\\x{FFFD}", "\u{DE00}", true],
  ["\\x{FFFD}", "\u{FFFD}", true],
  [".", "\u{D83D}", true],
  [".", "\u{DE00}", true],
  ["..", "\u{D83D}\u{D83D}", true],
  ["..", "\u{DE00}\u{D83D}", true],
  ["..", "a\u{DE00}", true],
  ["..", "\u{1F600}", false],
  ["[^a]", "\u{D83D}", true],
  ["\\pL", "\u{10400}", true],
  ["\\pL", "\u{1F600}", false],
  ["\\PL", "\u{1F600}", true],
  ["\\PL", "\u{10400}", false],
  ["\\PL{2}", "\u{1F600}", false],
  ["[^\\pL]", "\u{1F600}", true],
  ["\\p{So}", "\u{1F600}", true],
  ["\\p{So}", "a", false],
  ["\u{1F600}.", "\u{1F600}\u{1F600}", true],
  ["\u{1F600}.", "\u{1F600}", false],
  ["[\u{1F600}-\u{1F603}]", "\u{1F601}", true],
  ["[\u{1F600}-\u{1F603}]", "\u{1F604}", false],
];

describe("a character beyond U+FFFF is one character, as in Prometheus", () => {
  test.each(ASTRAL_ROWS)(
    "%s matching %j is %s, as in Prometheus",
    (pattern: string, value: string, matches: boolean) => {
      const compiled: CompiledPromQLRegex = compilePromQLRegex(pattern);

      expect(compiled.test(value)).toBe(matches);
      // JavaScript's own RegExp reads the written pattern the same way.
      expect(
        v8Tests({
          source: compiled.regex.source,
          flags: compiled.regex.flags,
          text: compiled.textOf(value),
          expected: matches,
        }),
      ).toBe(matches);
    },
  );

  test('the issue\'s table: ".", "..", [^a]{2} and a.b', () => {
    const emoji: string = "\u{1F600}";

    expect(compilePromQLRegex(".").test(emoji)).toBe(true);
    expect(compilePromQLRegex("..").test(emoji)).toBe(false);
    expect(compilePromQLRegex("[^a]{2}").test(emoji)).toBe(false);
    expect(compilePromQLRegex("a.b").test(`a${emoji}b`)).toBe(true);
    // .*, .+ and [^a]* match any run of characters, however they are counted.
    expect(compilePromQLRegex(".*").test(`a${emoji}`)).toBe(true);
    expect(compilePromQLRegex(".+").test(emoji)).toBe(true);
    expect(compilePromQLRegex("[^a]*").test(`${emoji}${emoji}`)).toBe(true);
  });

  test("a value is read as one code unit per character beyond U+FFFF, a lone surrogate as U+FFFD", () => {
    const compiled: CompiledPromQLRegex = compilePromQLRegex("\\x{1F600}.");

    expect(compiled.textOf("a\u{1F600}b")).toHaveLength(3);
    expect(compiled.textOf("\u{D83D}")).toBe("\u{FFFD}");
    expect(compiled.textOf("\u{DE00}x\u{D83D}")).toBe("\u{FFFD}x\u{FFFD}");
    // The character the pattern names, and the others, read as two code units apart.
    expect(compiled.textOf("\u{1F600}")).not.toBe(compiled.textOf("\u{1F601}"));
    expect(compiled.textOf("\u{1F601}")).toBe(compiled.textOf("\u{10FFFF}"));
  });

  test("a value without a surrogate is read as it is, not copied", () => {
    const value: string = "host-1:9100 \u{E9}\u{FFFF}";

    expect(compilePromQLRegex(".*").textOf(value)).toBe(value);
    expect(compilePromQLRegex("\\x{1F600}").textOf(value)).toBe(value);
  });

  test("a character beyond U+FFFF is one step to a repeat, so a count of it compiles as Prometheus' does", () => {
    // Refused before: three alternatives a character, over 10,000 steps.
    expect(compilePromQLRegex("[^\\x{1F600}]{1000}").regex.steps).toBe(
      compilePromQLRegex("[^a]{1000}").regex.steps,
    );
    expect(
      compilePromQLRegex("[^\\x{1F600}]{1000}").test("\u{1F601}".repeat(1000)),
    ).toBe(true);
    expect(compilePromQLRegex("\\x{1F600}{1000}").regex.steps).toBe(
      compilePromQLRegex("a{1000}").regex.steps,
    );
    expect(compilePromQLRegex(".{1000}").regex.steps).toBe(
      compilePromQLRegex("[ab]{1000}").regex.steps,
    );
  });

  /*
   * A pattern tells apart the characters beyond U+FFFF its sets name, each
   * kind read as one code unit of the 2,048 surrogates: one that names more
   * than that, written as single characters, is too large to run.
   */
  test("a pattern may tell apart up to 2,048 kinds of characters beyond U+FFFF", () => {
    const characters: (count: number) => Array<string> = (
      count: number,
    ): Array<string> => {
      const list: Array<string> = [];

      for (let index: number = 0; index < count; index++) {
        list.push(String.fromCodePoint(0x20000 + index));
      }

      return list;
    };

    // Each character apart, and the rest: one kind more than the characters.
    const most: Array<string> = characters(MAX_ASTRAL_CLASSES - 1);
    const compiled: CompiledPromQLRegex = compilePromQLRegex(most.join("|"));

    expect(compiled.test(most[0]!)).toBe(true);
    expect(compiled.test(most[most.length - 1]!)).toBe(true);
    expect(compiled.test(String.fromCodePoint(0x20000 + most.length))).toBe(
      false,
    );
    expect(compiled.test("\u{1F600}")).toBe(false);

    let refusal: unknown = null;

    try {
      compilePromQLRegex(characters(MAX_ASTRAL_CLASSES).join("|"));
    } catch (error: unknown) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(PatternProblemError);
    expect((refusal as PatternProblemError).reason).toBe(
      PatternProblemReason.TooLarge,
    );
    expect(describePromQLPatternProblem(refusal)).toBe(
      "is too large to run. Shorten it, or repeat its parts fewer times.",
    );
    // A range of them is one kind, however many it holds.
    expect(
      compilePromQLRegex("[\\x{20000}-\\x{2A6DF}]+").test(
        characters(3000).join(""),
      ),
    ).toBe(true);
  });
});

/*
 * What label_replace() captures, from values with characters beyond U+FFFF
 * and lone surrogates: each row is what Prometheus' regexp captured (null:
 * no match). A capture is the value's own text, a lone surrogate in it as
 * U+FFFD, as Go holds it.
 */
const CAPTURE_ROWS: ReadonlyArray<
  [string, string, Array<string | undefined> | null]
> = [
  ["(.)(.*)", "\u{1F600}ab", ["\u{1F600}", "ab"]],
  ["(.)(.*)", "a\u{1F600}b", ["a", "\u{1F600}b"]],
  ["(.)(.*)", "\u{1F600}", ["\u{1F600}", ""]],
  ["(.*)(.)", "ab\u{1F600}", ["ab", "\u{1F600}"]],
  ["(.*)(.)", "\u{1F600}\u{1F600}", ["\u{1F600}", "\u{1F600}"]],
  ["(.+?)(.+)", "\u{1F600}\u{1F600}", ["\u{1F600}", "\u{1F600}"]],
  ["(.+?)(.+)", "\u{1F600}a", ["\u{1F600}", "a"]],
  ["(.+?)(.+)", "a\u{1F600}", ["a", "\u{1F600}"]],
  ["(.+)(.+)", "\u{1F600}\u{1F600}", ["\u{1F600}", "\u{1F600}"]],
  [
    "(.+)(.+)",
    "\u{1F600}\u{1F600}\u{1F600}",
    ["\u{1F600}\u{1F600}", "\u{1F600}"],
  ],
  ["(.*?)(.*)", "\u{1F600}", ["", "\u{1F600}"]],
  ["([^a])([^a])", "\u{1F600}\u{1F601}", ["\u{1F600}", "\u{1F601}"]],
  ["(\\S+)\\s(\\S+)", "\u{1F600} \u{1F601}b", ["\u{1F600}", "\u{1F601}b"]],
  ["(.)-(\\x{1F600}+)", "x-\u{1F600}\u{1F600}", ["x", "\u{1F600}\u{1F600}"]],
  ["(\\pL+)(\\PL*)", "h\u{E9}llo\u{1F600}!", ["h\u{E9}llo", "\u{1F600}!"]],
  [
    "(\\pL+)(\\PL*)",
    "\u{10400}\u{10428}\u{1F600}",
    ["\u{10400}\u{10428}", "\u{1F600}"],
  ],
  [
    "(\\p{Han}+)(.*)",
    "\u{4E2D}\u{6587}\u{1F600}",
    ["\u{4E2D}\u{6587}", "\u{1F600}"],
  ],
  ["(?i)(\\x{10400}+)(.*)", "\u{10428}\u{10400}x", ["\u{10428}\u{10400}", "x"]],
  ["(.)(.)", "\u{1F600}", null],
  ["(.)(.)", "a\u{D83D}", ["a", "\u{FFFD}"]],
  ["(.)(.)", "\u{D83D}a", ["\u{FFFD}", "a"]],
  ["(.*)", "a\u{D83D}b", ["a\u{FFFD}b"]],
  ["(.*)", "\u{DE00}", ["\u{FFFD}"]],
  ["host-(.)(.*):(\\d+)", "host-\u{1F600}x:9100", ["\u{1F600}", "x", "9100"]],
  [
    "(?P<emoji>[\\x{1F600}-\\x{1F64F}])(?P<rest>.*)",
    "\u{1F603} hi",
    ["\u{1F603}", " hi"],
  ],
];

describe("label_replace() captures characters beyond U+FFFF whole, as Prometheus does", () => {
  test.each(CAPTURE_ROWS)(
    "%s on %j captures %j, as in Prometheus",
    (
      pattern: string,
      value: string,
      captures: Array<string | undefined> | null,
    ) => {
      const match: PromQLRegexMatch | null = compilePromQLRegex(pattern, {
        captures: true,
        unicodeClassAliases: true,
      }).exec(value);

      expect(match === null ? null : match.captures).toEqual(captures);
    },
  );

  test("the whole match is the value's own text", () => {
    const compiled: CompiledPromQLRegex = compilePromQLRegex("(.)(.*)", {
      captures: true,
    });

    expect(compiled.exec("\u{1F600}x\u{10400}")?.value).toBe(
      "\u{1F600}x\u{10400}",
    );
    expect(compiled.exec("a\u{D83D}")?.value).toBe("a\u{FFFD}");
    expect(compiled.exec("plain")).toEqual({
      value: "plain",
      captures: ["p", "lain"],
    });
  });

  test("a group that took no part is undefined, beside characters beyond U+FFFF", () => {
    expect(
      compilePromQLRegex("(\\x{1F600})|(b)", { captures: true }).exec(
        "\u{1F600}",
      )?.captures,
    ).toEqual(["\u{1F600}", undefined]);
    expect(
      compilePromQLRegex("(\\x{1F600})|(b)", { captures: true }).exec("b")
        ?.captures,
    ).toEqual([undefined, "b"]);
  });
});

/*
 * A pattern Prometheus reads, under 20,000 characters, is no longer refused
 * because the JavaScript written from it is longer (issue #8218): (?i)
 * writes each s as [s\u{17F}] and each k as [k\u{212A}], (?m) each ^ as a
 * look-behind. The pattern a person wrote is still held to
 * MAX_PATTERN_LENGTH before it is read, and what it is written as to
 * MAX_WRITTEN_PATTERN_LENGTH.
 */
describe("a pattern written out longer than the pattern limit still runs", () => {
  test("the issue's case: (?i) and 6,000 s, 6,004 characters", () => {
    const pattern: string = `(?i)${"s".repeat(6000)}`;
    const compiled: CompiledPromQLRegex = compilePromQLRegex(pattern);

    expect(pattern).toHaveLength(6004);
    expect(compiled.regex.source.length).toBeGreaterThan(MAX_PATTERN_LENGTH);
    expect(compiled.test("S".repeat(6000))).toBe(true);
    expect(compiled.test("\u{17F}".repeat(6000))).toBe(true);
    expect(compiled.test("s".repeat(5999))).toBe(false);
  });

  /*
   * An alternation of names under (?i) whose letters are mostly s and k:
   * each written out four times as long, within the steps a pattern may
   * compile to (DEFAULT_MAX_STEPS), which still bound how long a pattern
   * can be.
   */
  test("a (?i) alternation of names written out past the pattern limit", () => {
    const names: Array<string> = [];

    for (let index: number = 0; names.join("|").length < 8500; index++) {
      names.push(`sk${"s".repeat(4)}${"k".repeat(4)}-${index}`);
    }

    const pattern: string = `(?i)${names.join("|")}`;
    const compiled: CompiledPromQLRegex = compilePromQLRegex(pattern);

    expect(pattern.length).toBeLessThan(MAX_PATTERN_LENGTH);
    expect(compiled.regex.source.length).toBeGreaterThan(MAX_PATTERN_LENGTH);
    expect(compiled.test(names[names.length - 1]!.toUpperCase())).toBe(true);
    expect(
      compiled.test(
        `\u{17F}\u{212A}${"\u{17F}".repeat(4)}${"\u{212A}".repeat(4)}-0`,
      ),
    ).toBe(true);
    expect(compiled.test(`${names[0]!}x`)).toBe(false);
  });

  test("a pattern a person wrote longer than MAX_PATTERN_LENGTH is refused before it is read", () => {
    let refusal: unknown = null;

    try {
      compilePromQLRegex("a".repeat(MAX_PATTERN_LENGTH + 1));
    } catch (error: unknown) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(PatternProblemError);
    expect((refusal as Error).message).toBe(
      `The pattern is longer than ${MAX_PATTERN_LENGTH} characters.`,
    );
    // At the limit, it is read.
    expect(
      compilePromQLRegex(`[${"b".repeat(MAX_PATTERN_LENGTH - 2)}]`).test("b"),
    ).toBe(true);
  });

  test("one written out longer than MAX_WRITTEN_PATTERN_LENGTH is refused as too large, as soon as it is", () => {
    // (?m) writes each ^ as ^ and a look-behind, 22 characters.
    const pattern: string = `(?m)${"^".repeat(MAX_PATTERN_LENGTH - 4)}`;
    const refused: FastestRun<unknown> = fastestRun({
      run: (): unknown => {
        // Each attempt compiles the pattern again, kept or not.
        clearLinearRegExpCache();

        try {
          compilePromQLRegex(pattern);
        } catch (error: unknown) {
          return error;
        }

        return null;
      },
      limitInMs: 5000,
    });
    const refusal: unknown = refused.result;

    expect(refusal).toBeInstanceOf(PatternProblemError);
    expect((refusal as PatternProblemError).reason).toBe(
      PatternProblemReason.TooLarge,
    );
    expect((refusal as Error).message).toBe(
      `The pattern, written out for the matcher, is longer than ${MAX_WRITTEN_PATTERN_LENGTH} characters.`,
    );
    expect(refused.inMs).toBeLessThan(5000);
    // A tenth of them reads.
    expect(compilePromQLRegex(`(?m)${"^".repeat(2000)}a`).test("a")).toBe(true);
  });

  test("a long written pattern is compiled once and kept, as any is", () => {
    clearLinearRegExpCache();

    const pattern: string = `(?i)${"s".repeat(6000)}`;
    const first: CompiledPromQLRegex = compilePromQLRegex(pattern);

    expect(compilePromQLRegex(pattern).regex).toBe(first.regex);
    expect(getCachedPatternCount()).toBe(1);
  });
});
