import {
  PromQLAggregate,
  PromQLAggregateOperator,
  PromQLBinary,
  PromQLBinaryOperator,
  PromQLCall,
  PromQLExpression,
  PromQLMatchType,
  PromQLMatrixSelector,
  PromQLNodeKind,
  PromQLNumberLiteral,
  PromQLPosition,
  PromQLSubquery,
  PromQLUnary,
  PromQLValueType,
  PromQLVectorMatchCardinality,
  PromQLVectorSelector,
} from "../../../Utils/PromQL/PromQLAst";
import {
  formatPromQLDuration,
  parsePromQLDuration,
} from "../../../Utils/PromQL/PromQLDuration";
import PromQLError, {
  PromQLErrorType,
} from "../../../Utils/PromQL/PromQLError";
import {
  PromQLToken,
  PromQLTokenType,
  tokenizePromQL,
} from "../../../Utils/PromQL/PromQLLexer";
import {
  getPromQLValueType,
  matchesEmptyValue,
  parsePromQL,
} from "../../../Utils/PromQL/PromQLParser";
import {
  CompiledPromQLRegex,
  compilePromQLRegex,
  MAX_PATTERN_STEPS,
  PromQLPatternError,
  readNamedCapture,
} from "../../../Utils/PromQL/PromQLRegex";
import { WIDER_CASE_FOLDS } from "../../../Utils/PromQL/RE2CharacterClass";
import { getCaseVariants } from "../../../Utils/LinearRegExp/CaseCanonicalization";
import LinearRegExp, {
  LinearRegExpMatch,
  MAX_PATTERN_LENGTH,
} from "../../../Utils/LinearRegExp/LinearRegExp";
import { DEFAULT_MAX_STEPS } from "../../../Utils/LinearRegExp/Program";
import {
  clearLinearRegExpCache,
  getCachedPatternCount,
} from "../../../Utils/LinearRegExp/PatternCache";
import {
  PatternProblemError,
  PatternProblemReason,
} from "../../../Utils/LinearRegExp/PatternProblem";
import {
  INHERITED_PROPERTY_NAMES,
  INHERITED_PROPERTY_NAME_SPELLINGS,
} from "../../Helpers/InheritedNames";
import { v8Captures, v8Tests } from "../../Helpers/V8RegExpAnswers";
import { describe, expect, test } from "@jest/globals";

/*
 * The PromQL parser (issue #6796): a query OneUptime accepts is one
 * Prometheus accepts, read the way Prometheus reads it, and a query
 * Prometheus refuses is refused with a sentence that says what to write.
 */

const parseError: (query: string) => PromQLError = (
  query: string,
): PromQLError => {
  try {
    parsePromQL(query);
  } catch (error: unknown) {
    if (error instanceof PromQLError) {
      return error;
    }

    throw error;
  }

  throw new Error(`Expected "${query}" to be refused.`);
};

const types: (query: string) => Array<PromQLTokenType> = (
  query: string,
): Array<PromQLTokenType> => {
  return tokenizePromQL(query).map((token: PromQLToken): PromQLTokenType => {
    return token.type;
  });
};

describe("PromQL durations", () => {
  test.each([
    ["5m", 300000],
    ["1h30m", 5400000],
    ["500ms", 500],
    ["1y", 31536000000],
    ["2w", 1209600000],
    ["1d", 86400000],
    ["0s", 0],
    ["1h0m0s", 3600000],
  ])("%s is %d milliseconds", (text: string, milliseconds: number) => {
    expect(parsePromQLDuration(text)).toBe(milliseconds);
  });

  test.each(["", "5", "5min", "1m1h", "1m1m", "1.5m", "m"])(
    "%j is not a duration",
    (text: string) => {
      expect(parsePromQLDuration(text)).toBeUndefined();
    },
  );

  test.each([
    [0, "0s"],
    [90000, "1m30s"],
    [3600000, "1h"],
    [-300000, "-5m"],
    [1500, "1s500ms"],
    [86400000 * 8, "1w1d"],
  ])("%d milliseconds is written %s", (milliseconds: number, text: string) => {
    expect(formatPromQLDuration(milliseconds)).toBe(text);
  });
});

describe("PromQL lexer", () => {
  test("splits a selector with matchers", () => {
    expect(types('up{job="api",instance!~"a.*"}')).toEqual([
      PromQLTokenType.Identifier,
      PromQLTokenType.LeftBrace,
      PromQLTokenType.Identifier,
      PromQLTokenType.Assign,
      PromQLTokenType.String,
      PromQLTokenType.Comma,
      PromQLTokenType.Identifier,
      PromQLTokenType.RegexNoMatch,
      PromQLTokenType.String,
      PromQLTokenType.RightBrace,
      PromQLTokenType.EOF,
    ]);
  });

  test("reads a recording rule's name, with colons, as one metric identifier", () => {
    const tokens: Array<PromQLToken> = tokenizePromQL(
      "job:http_requests:rate5m",
    );

    expect(tokens[0]).toMatchObject({
      type: PromQLTokenType.MetricIdentifier,
      text: "job:http_requests:rate5m",
    });
  });

  test("reads the colon of a subquery as a separator", () => {
    expect(types("x[5m:1m]")).toEqual([
      PromQLTokenType.Identifier,
      PromQLTokenType.LeftBracket,
      PromQLTokenType.Duration,
      PromQLTokenType.Colon,
      PromQLTokenType.Duration,
      PromQLTokenType.RightBracket,
      PromQLTokenType.EOF,
    ]);
  });

  test.each([
    ["1", "1"],
    ["1.5", "1.5"],
    [".5", ".5"],
    ["1e3", "1e3"],
    ["2.5E-3", "2.5E-3"],
    ["0x1F", "0x1F"],
  ])("reads the number %s", (query: string, text: string) => {
    expect(tokenizePromQL(query)[0]).toMatchObject({
      type: PromQLTokenType.Number,
      text,
    });
  });

  test.each(["5m", "1h30m", "500ms", "2w", "1y2w3d4h5m6s7ms"])(
    "reads the duration %s as one token",
    (query: string) => {
      expect(tokenizePromQL(query)[0]).toMatchObject({
        type: PromQLTokenType.Duration,
        text: query,
      });
    },
  );

  test.each([
    ['"a\\"b"', 'a"b'],
    ["'it\\'s'", "it's"],
    ['"tab\\there"', "tab\there"],
    ['"\\x41\\u00e9\\U0001F600"', "Aé😀"],
    ['"\\101"', "A"],
    ["`raw \\d+ string`", "raw \\d+ string"],
  ])("resolves the escapes of %s", (query: string, value: string) => {
    expect(tokenizePromQL(query)[0]).toMatchObject({
      type: PromQLTokenType.String,
      text: value,
    });
  });

  test("skips comments to the end of the line", () => {
    expect(types("up # the up metric\n + 1")).toEqual([
      PromQLTokenType.Identifier,
      PromQLTokenType.Add,
      PromQLTokenType.Number,
      PromQLTokenType.EOF,
    ]);
  });

  test("reads two-character operators before one-character ones", () => {
    expect(types("a == b != c >= d <= e =~ f !~ g")).toEqual([
      PromQLTokenType.Identifier,
      PromQLTokenType.Eql,
      PromQLTokenType.Identifier,
      PromQLTokenType.Neq,
      PromQLTokenType.Identifier,
      PromQLTokenType.Gte,
      PromQLTokenType.Identifier,
      PromQLTokenType.Lte,
      PromQLTokenType.Identifier,
      PromQLTokenType.RegexMatch,
      PromQLTokenType.Identifier,
      PromQLTokenType.RegexNoMatch,
      PromQLTokenType.Identifier,
      PromQLTokenType.EOF,
    ]);
  });

  test.each([
    ['"unclosed', "is not closed"],
    ["`unclosed", "is not closed"],
    ['"bad \\q escape"', 'Unknown escape "\\q"'],
    ['"\\x4"', "takes 2 hexadecimal digits"],
    ["5min", "is not a number or a duration"],
    ["up $ 1", 'Unexpected character "$"'],
  ])("refuses %s", (query: string, message: string) => {
    expect(() => {
      return tokenizePromQL(query);
    }).toThrow(message);
  });

  test("an error says where it is", () => {
    try {
      tokenizePromQL("up $");
    } catch (error: unknown) {
      expect((error as PromQLError).position).toEqual({ start: 3, end: 4 });
      return;
    }

    throw new Error("Expected the lexer to refuse the query.");
  });
});

describe("PromQL regular expressions", () => {
  // What a refused pattern threw, or null.
  const refusalOf: (pattern: string) => unknown = (
    pattern: string,
  ): unknown => {
    try {
      compilePromQLRegex(pattern);
    } catch (error: unknown) {
      return error;
    }

    return null;
  };

  test("run on the linear-time matcher, as every pattern a project's people write does", () => {
    expect(compilePromQLRegex("api").regex).toBeInstanceOf(LinearRegExp);
    expect(
      compilePromQLRegex("api", { captures: true }).regex.capturesGroups,
    ).toBe(true);
  });

  test("are anchored at both ends, as in Prometheus", () => {
    const regex: LinearRegExp = compilePromQLRegex("api").regex;

    expect(regex.test("api")).toBe(true);
    expect(regex.test("api-2")).toBe(false);
    expect(regex.test("my-api")).toBe(false);
    // Around the whole pattern, not only its first and last alternative.
    expect(compilePromQLRegex("a|b").regex.test("ab")).toBe(false);
    expect(compilePromQLRegex("a|b").regex.test("b")).toBe(true);
  });

  test("read RE2's (?i) flag group inside the anchors, as Prometheus compiles ^(?s:(?i)error)$", () => {
    const regex: LinearRegExp = compilePromQLRegex("(?i)error").regex;

    // The flag applies inside the group, not to the whole pattern.
    expect(regex.flags).toBe("");
    expect(regex.source).toBe("^(?s:(?i:error))$");
    expect(regex.test("ERROR")).toBe(true);
    expect(regex.test("errors")).toBe(false);
  });

  test("read RE2's named groups, their names kept beside the pattern", () => {
    const compiled: CompiledPromQLRegex = compilePromQLRegex(
      "(?P<host>[a-z]+):\\d+",
      { captures: true },
    );
    const match: LinearRegExpMatch | null = compiled.regex.exec("web:80");

    expect(match?.captures).toEqual(["web"]);
    expect(compiled.groupNames).toEqual(["host"]);
    expect(
      readNamedCapture({
        captures: match!.captures,
        groupNames: compiled.groupNames,
        name: "host",
      }),
    ).toBe("web");
    // JavaScript's groups have no names: RE2 takes names it does not.
    expect(compiled.regex.source).toBe("^(?s:([a-z]+):[0-9]+)$");
  });

  /*
   * RE2 takes a group name of letters, digits and _, a digit first too,
   * and two groups of one name (isValidCaptureName, parse.go); $name reads
   * the first of them that took part (Go's Regexp.Expand).
   */
  test("read RE2's group names JavaScript does not take", () => {
    const digitFirst: CompiledPromQLRegex = compilePromQLRegex("(?P<1a>x)", {
      captures: true,
    });

    expect(digitFirst.groupNames).toEqual(["1a"]);
    expect(digitFirst.regex.exec("x")?.captures).toEqual(["x"]);

    const twice: CompiledPromQLRegex = compilePromQLRegex(
      "(?P<h>a)-(?P<h>b)|(?<h>c)",
      { captures: true },
    );

    expect(twice.groupNames).toEqual(["h", "h", "h"]);

    for (const [value, expected] of [
      ["a-b", "a"],
      ["c", "c"],
    ]) {
      expect(
        readNamedCapture({
          captures: twice.regex.exec(value!)!.captures,
          groupNames: twice.groupNames,
          name: "h",
        }),
      ).toBe(expected);
    }

    expect(
      readNamedCapture({
        captures: twice.regex.exec("c")!.captures,
        groupNames: twice.groupNames,
        name: "nosuch",
      }),
    ).toBeUndefined();
  });

  test("read POSIX classes", () => {
    expect(compilePromQLRegex("[[:digit:]]+").regex.test("123")).toBe(true);
    expect(compilePromQLRegex("[[:digit:]]+").regex.test("12a")).toBe(false);
  });

  /*
   * RE2 reads a POSIX class's name between "[:" and the first ":]" after
   * it, and refuses a name it does not have: "invalid character class
   * range: [:nosuch:]" (parseNamedClass, parse.go). Names are lowercase,
   * and a name every object inherits (constructor, and any of them as a
   * reader that folds case spells it) is a name no class has: refused, as
   * [[:nosuch:]] is, never read as the inherited function's source text or
   * as the letters it is written with.
   */
  test.each(INHERITED_PROPERTY_NAME_SPELLINGS)(
    "[[:%s:]] names no POSIX class: refused, as Prometheus refuses it",
    (name: string) => {
      for (const [pattern, written] of [
        [`[[:${name}:]]`, `[:${name}:]`],
        [`[^[:${name}:]]`, `[:${name}:]`],
        [`[[:^${name}:]]`, `[:^${name}:]`],
        [`[[:digit:][:${name}:]]`, `[:${name}:]`],
      ]) {
        const refusal: unknown = refusalOf(pattern!);

        expect(refusal).toBeInstanceOf(PromQLPatternError);
        expect((refusal as PromQLPatternError).problem).toContain(
          `names the character class ${written}, which Prometheus does not read either.`,
        );
      }
    },
  );

  test.each([
    ["[[:nosuch:]]", "[:nosuch:]"],
    ["[[:constructor:]]", "[:constructor:]"],
    ["[[:toString:]]", "[:toString:]"],
    // RE2's names are case-sensitive.
    ["[[:DIGIT:]]", "[:DIGIT:]"],
    ["[[:Alpha:]]", "[:Alpha:]"],
    // The name runs to the first ":]", wherever it is.
    ["[[:al]pha:]]", "[:al]pha:]"],
    ["[[:a:]b:]]", "[:a:]"],
    ["[[::]]", "[::]"],
    ["[[:^:]]", "[:^:]"],
    ["[[: digit:]]", "[: digit:]"],
  ])(
    "%s, a POSIX class RE2 does not have, is refused with its name",
    (pattern: string, written: string) => {
      const refusal: unknown = refusalOf(pattern);

      expect(refusal).toBeInstanceOf(PromQLPatternError);
      expect((refusal as PromQLPatternError).problem).toBe(
        `names the character class ${written}, which Prometheus does not read either. The classes are [:alnum:], [:alpha:], [:ascii:], [:blank:], [:cntrl:], [:digit:], [:graph:], [:lower:], [:print:], [:punct:], [:space:], [:upper:], [:word:] and [:xdigit:], written in lowercase, and [:^digit:] matches every character [:digit:] does not.`,
      );
    },
  );

  /*
   * RE2's 14 POSIX classes (posixGroup, perl_groups.go), each with a
   * character it holds and one it does not, and [:^name:] for the rest.
   */
  test.each([
    ["alnum", "a", "-"],
    ["alpha", "Z", "1"],
    ["ascii", "\u007f", "\u0080"],
    ["blank", "\t", "\n"],
    ["cntrl", "\u001f", " "],
    ["digit", "7", "a"],
    ["graph", "~", " "],
    ["lower", "q", "Q"],
    ["print", " ", "\u007f"],
    ["punct", "!", "a"],
    ["space", "\u000b", "a"],
    ["upper", "Q", "q"],
    ["word", "_", "-"],
    ["xdigit", "F", "G"],
  ])(
    "[[:%s:]] holds %j and not %j, and its negation the other way round",
    (name: string, member: string, other: string) => {
      const positive: LinearRegExp = compilePromQLRegex(`[[:${name}:]]`).regex;
      const negative: LinearRegExp = compilePromQLRegex(`[[:^${name}:]]`).regex;

      expect(positive.test(member)).toBe(true);
      expect(positive.test(other)).toBe(false);
      expect(negative.test(member)).toBe(false);
      expect(negative.test(other)).toBe(true);
      // A negated class holds what no class names: a newline, "é".
      expect(negative.test("\u00e9")).toBe(true);
    },
  );

  /*
   * Each answer is Prometheus': a label matcher is compiled by
   * NewFastRegexMatcher (model/labels/regexp.go), which reads the pattern
   * with RE2's Perl flags and DotNL (syntax.Parse(v, syntax.Perl |
   * syntax.DotNL)) and runs "^(?s:" + the pattern + ")$". The functions
   * named below are those of regexp/syntax, Go's, which Prometheus' regexp
   * (github.com/grafana/regexp) copies. Each row was also asked of
   * Prometheus' own matcher, which answered the same. JavaScript's RegExp
   * answers the same for the pattern compiled here.
   */
  test.each([
    // [pattern, value, whether it matches]
    ["(?i)error", "Error", true],
    ["(?s)a.b", "a\nb", true],
    ["(?m)a$\\n^b", "a\nb", true],
    ["(?is)A.B", "a\nb", true],
    ["(?U)a+", "aaa", true],
    ["(?P<host>[a-z]+):(?P<port>\\d+)", "web:80", true],
    ["(?i:GET)|post", "get", true],
    ["(?i:GET)|post", "POST", false],
    ["[[:alpha:]_][[:word:]]*", "http_requests_total", true],
    ["[[:xdigit:]]{4}", "beEF", true],
    ["[^[:digit:]]+", "abc", true],
    ["[^[:digit:]]+", "a1", false],
    ["[[:upper:][:digit:]]+", "AB12", true],
    ["/api/v[0-9]+/.*", "/api/v2/users", true],
    ["\\d+\\.\\d+", "1.5", true],
    ["café|naïve", "naïve", true],
    // DotNL: "." matches "\n" too, with no flag written.
    ["a.b", "a\nb", true],
    ["(?i)A.B", "a\nb", true],
    /*
     * (?m) applies inside the group the pattern is compiled in, so the ^
     * and $ around it still mean the whole value.
     */
    ["(?m)api", "x\napi", false],
    ["(?m)api", "api", true],
    /*
     * (?-s): "." is OpAnyCharNotNL (parse, parse.go), anything but "\n" -
     * "\r" included.
     */
    ["(?-s)a.b", "a\nb", false],
    ["(?-s)a.b", "a\rb", true],
    /*
     * (?m): ^ and $ are OpBeginLine and OpEndLine, which match next to a
     * "\n" only (EmptyOpContext, prog.go), not next to a "\r".
     */
    ["(?m)a$.*", "a\nb", true],
    ["(?m)a$.*", "a\rb", false],
    ["(?m).*^b", "a\rb", false],
    /*
     * A flag group in the middle sets its flags from where it stands to the
     * end of the group that holds it (parsePerlFlags, parse.go), later
     * alternatives included - "|" leaves them as they are - and that
     * group's ")" puts back the flags it opened with (parseRightParen).
     */
    ["api(?i)SERVER", "apiServer", true],
    ["api(?i)SERVER", "APIserver", false],
    ["a(?i)b|c", "C", true],
    ["a(?i)b|c", "AB", false],
    ["(a(?i)b)c", "aBc", true],
    ["(a(?i)b)c", "aBC", false],
    ["(?i)a(?-i)b", "Ab", true],
    ["(?i)a(?-i)b", "AB", false],
    // Each later alternative starts under the flags the one before it set.
    ["(?i)a|(?-i)b|c", "A", true],
    ["(?i)a|(?-i)b|c", "B", false],
    ["(?i)a|(?-i)b|c", "C", false],
    ["(?i)a|(?-i)b|c", "c", true],
    ["a(?i)b|c(?-i)d|e", "aB", true],
    ["a(?i)b|c(?-i)d|e", "Cd", true],
    ["a(?i)b|c(?-i)d|e", "CD", false],
    ["a(?i)b|c(?-i)d|e", "E", false],
    // A group's ")" ends its flag groups, and its alternatives share them.
    ["(?i)(a(?-i)b|c)d", "AbD", true],
    ["(?i)(a(?-i)b|c)d", "ABd", false],
    ["(?i)(a(?-i)b|c)d", "Cd", false],
    ["((?i)a|b)c", "Bc", true],
    ["((?i)a|b)c", "aC", false],
    ["(?:(?i)a)b", "Ab", true],
    ["(?:(?i)a)b", "AB", false],
    // A flag group inside (?flags: ... ) ends at that group's ")".
    ["x(?i:a(?-i)b)c", "xAbc", true],
    ["x(?i:a(?-i)b)c", "xABc", false],
    ["x(?i:a(?-i)b)c", "xAbC", false],
    ["(?-s)a(?s:.)b.", "a\nbc", true],
    ["(?-s)a(?s:.)b.", "a\nb\n", false],
    // Set then cleared: cleared (parsePerlFlags).
    ["(?i-i)a", "A", false],
    // No flags at all: nothing changes (parsePerlFlags).
    ["a(?)b", "ab", true],
    // A "]" first in a bracket is a character (parseClass, parse.go).
    ["[]a]+", "]a", true],
    ["[^]a]", "]", false],
    ["[^]a]", "b", true],
    // A POSIX class is one inside a bracket only: this is the bracket ":digt".
    ["[:digit:]+", "dig", true],
    ["[:digit:]+", "0-9", false],
    // Inside a bracket, "(?P<" is four characters.
    ["[(?P<]+", "P", true],
  ])(
    "%s matching %j is %s, as in Prometheus",
    (pattern: string, value: string, matches: boolean) => {
      const regex: LinearRegExp = compilePromQLRegex(pattern).regex;

      expect(regex.test(value)).toBe(matches);
      // JavaScript's own engine reads the compiled pattern the same way.
      expect(
        v8Tests({
          source: regex.source,
          flags: regex.flags,
          text: value,
          expected: matches,
        }),
      ).toBe(matches);
    },
  );

  /*
   * What label_replace() reads in each group: Prometheus' evalLabelReplace
   * (promql/functions.go) compiles "^(?s:" + the pattern + ")$", and (?U)
   * makes x* lazy and x*? greedy from where it stands to the end of its
   * group (repeat, parse.go). Prometheus' regexp answered the same for each.
   */
  test.each([
    // [pattern, value, what the groups capture]
    ["(?U)(a+)(a*)", "aaa", ["a", "aa"]],
    ["(?U)(a+?)(a*)", "aaa", ["aaa", ""]],
    ["((?U)a+)(a*)(a*)", "aaaa", ["a", "aaa", ""]],
    ["(?U:a+)(a*)(a*)", "aaaa", ["aaa", ""]],
    ["(a+)(?U)(a*)(a*)", "aaaa", ["aaaa", "", ""]],
    ["(?U)(a{1,3})(a*)", "aaaa", ["a", "aaa"]],
    ["(?U)(a{1,3}?)(a*)", "aaaa", ["aaa", "a"]],
    ["(?U)(a??)(a*)", "aa", ["a", "a"]],
    ["(?U)(a+)(?-U)(a+)", "aaa", ["a", "aa"]],
    ["(?U)(a+)(?-U:(a+))(a*)", "aaaa", ["a", "aaa", ""]],
    // (?U) between an atom and its repeat: the repeat is lazy.
    ["(a(?U)*)(a*)", "aaa", ["", "aaa"]],
    ["(a(?i)b|c)d", "Cd", ["C"]],
    ["(.*)", "a\nb", ["a\nb"]],
    // Names RE2 takes and JavaScript does not: two of one name, a digit first.
    ["(?P<a>x)(?P<a>y)", "xy", ["x", "y"]],
    ["(?P<a>x)|(?P<a>y)", "y", [undefined, "y"]],
    ["(?P<1a>x)", "x", ["x"]],
    // A repeat after a flag group repeats what is before it.
    ["(a)(?i)*", "aa", ["a"]],
    ["(a*)(?i)*(a)", "aa", ["a", "a"]],
    // ... a repeat too: (?:(a)*)? under (?U), where ?? is greedy.
    ["(a)*(?U)??(a*)", "aa", ["a", ""]],
  ])(
    "%s on %j captures %j, as in Prometheus",
    (pattern: string, value: string, captures: Array<string | undefined>) => {
      const regex: LinearRegExp = compilePromQLRegex(pattern, {
        captures: true,
      }).regex;

      expect(regex.exec(value)?.captures).toEqual(captures);
      expect(
        v8Captures({
          source: regex.source,
          flags: regex.flags,
          text: value,
          expected: captures,
        }),
      ).toEqual(captures);
    },
  );

  test("a flag group at an alternative's start covers the alternatives after it once, not once each", () => {
    const hosts: Array<string> = [];

    for (let index: number = 0; index < 200; index++) {
      hosts.push(`host-${index}`);
    }

    const pattern: string = `(?i)${hosts.join("|")}`;
    const regex: LinearRegExp = compilePromQLRegex(pattern).regex;

    // Each "s" holds the long s too, which JavaScript's i flag leaves out.
    expect(regex.source).toBe(
      `^(?s:(?i:${hosts.join("|").split("s").join("[s\u017f]")}))$`,
    );
    expect(regex.test("HOST-199")).toBe(true);
    expect(regex.test("ho\u017ft-199")).toBe(true);
    expect(regex.test("host-200")).toBe(false);
  });

  /*
   * RE2 refuses a repeat of a repeat: "invalid nested repetition operator"
   * (repeat, parse.go). Under (?U) the "?" that swaps a repeat's greed is
   * written or left out, so x*??? would otherwise reach JavaScript as the
   * one lazy repeat x*?.
   */
  test.each([
    "a**",
    "a+*",
    "a{2}{3}",
    "a*??",
    "(?U)a*???",
    "(?U)a+??",
    "(?U)a{1,2}???",
    "(a)(?U)*???",
  ])(
    "%s, a repeat of a repeat, is refused as RE2 refuses it",
    (pattern: string) => {
      const refusal: unknown = refusalOf(pattern);

      expect(refusal).toBeInstanceOf(PromQLPatternError);
      expect((refusal as PromQLPatternError).problem).toMatch(
        /^repeats a repeat with \S+ right after it, which Prometheus does not read either\./,
      );
    },
  );

  test("a repeat after a flag group after a repeat repeats the repeat, as RE2 reads it", () => {
    /*
     * RE2 reads x*(?U)?? as (?:x*)?, the ?? greedy under (?U). Read as the
     * one lazy repeat x*?, the groups after it would capture otherwise: on
     * "aa", Prometheus' (a)*(?U)??(a*) captures "a" and "", and (a)*?(a*)
     * captures nothing and "aa" (the captures table above).
     */
    expect(compilePromQLRegex("a*(?U)??").regex.source).toBe("^(?s:(?:a*)?)$");
    expect(compilePromQLRegex("a*(?i)*").regex.source).toBe(
      "^(?s:(?:a*)*(?i:))$",
    );
    expect(compilePromQLRegex("a*\\Q\\E+").regex.source).toBe("^(?s:(?:a*)+)$");
  });

  test("a repeat after an atom, a group or a bar is read", () => {
    expect(compilePromQLRegex("(a*)*").regex.test("aa")).toBe(true);
    expect(compilePromQLRegex("a*(b)*").regex.test("aab")).toBe(true);
    expect(compilePromQLRegex("a*|b*").regex.test("bb")).toBe(true);
    expect(compilePromQLRegex("a*|b*").regex.test("ab")).toBe(false);
    // (?U) writes nothing of its own: the repeat after it repeats the "a".
    expect(compilePromQLRegex("a(?U)*").regex.source).toBe("^(?s:a*?)$");
  });

  /*
   * RE2's spellings that JavaScript reads otherwise or not at all (issue
   * #8028), each answer Prometheus' own: a label matcher's reading
   * (NewFastRegexMatcher's syntax.Parse, then ^(?s:...)$ compiled), asked
   * of Prometheus v0.316.0 built with Go 1.27, where every row agrees with
   * the regexp label_replace() compiles. JavaScript's own RegExp reads the
   * compiled pattern the same way.
   */
  test.each([
    // \A and \z: the value's start and end, under (?m) too (OpBeginText, OpEndText).
    ["\\Aa", "a", true],
    ["a\\A", "a", false],
    ["(?m)a\\n\\Ab", "a\nb", false],
    ["(?m)a\\n^b", "a\nb", true],
    ["a\\z\\n", "a\n", false],
    ["(?m)a$\\n", "a\n", true],
    ["(?m)a\\z\\n", "a\n", false],
    // \Q...\E: its text, to the end of the pattern when no \E follows.
    ["\\Qa.b\\E+", "a.b", true],
    ["\\Qa.b\\E+", "a.bb", true],
    ["\\Qa.b\\E+", "axb", false],
    ["\\Qa.b", "a.b", true],
    ["\\Qa.b", "axb", false],
    ["\\Q(?i)\\E", "(?i)", true],
    ["\\Q(?i)\\E", "", false],
    ["(?i)\\QaB\\E", "AB", true],
    ["(?i)\\QaB\\E", "aC", false],
    ["\\Q\\\\E", "\\", true],
    ["\\Q\\\\E", "\\\\", false],
    ["a\\Q\\E*", "", true],
    ["a\\Q\\E*", "aa", true],
    // \x41 and \x{41}: a code point; \x{1F600} one beyond U+FFFF.
    ["\\x41", "A", true],
    ["\\x41", "x41", false],
    ["\\x{41}", "A", true],
    ["\\x{41}", "x{41}", false],
    ["\\x{0041}", "A", true],
    ["\\x{1F600}", "\ud83d\ude00", true],
    ["\\x{1F600}", "\ud83d", false],
    ["\\x{1F600}+", "\ud83d\ude00\ud83d\ude00", true],
    ["\\x{1F600}+", "\ud83d\ude00\ude00", false],
    ["[\\x{1F600}-\\x{1F64F}]", "\ud83d\ude03", true],
    ["[\\x{1F600}-\\x{1F64F}]", "\ud83d\ude50", false],
    ["[\\x{1F600}-\\x{1F64F}]", "a", false],
    ["[a\\x{1F600}]{2}", "a\ud83d\ude00", true],
    ["[a\\x{1F600}]{2}", "\ud83d\ude00\ud83d\ude00", true],
    ["[a\\x{1F600}]{2}", "aa", true],
    // Octal: \0 and up to two more digits, or \1 to \7 and one or two more; \a is the bell.
    ["\\101", "A", true],
    ["\\0", "\u0000", true],
    ["\\0", "0", false],
    ["\\08", "\u00008", true],
    ["\\0123", "\n3", true],
    ["\\0123", "S", false],
    ["\\400", "\u0100", true],
    ["\\400", " 0", false],
    ["\\777", "\u01ff", true],
    ["\\a", "\u0007", true],
    ["\\a", "a", false],
    // RE2's \s is [\t\n\f\r ]: not \v, U+00A0 or the other spaces JavaScript's holds.
    ["\\s", "\u000b", false],
    ["\\s", "\u00a0", false],
    ["\\s", "\ufeff", false],
    ["\\s", " ", true],
    ["\\s", "\t", true],
    ["\\s", "\n", true],
    ["\\s", "\f", true],
    ["\\s", "\r", true],
    ["[\\s]", "\u000b", false],
    ["[\\s]", " ", true],
    ["\\S", "\u000b", true],
    ["\\S", "\u00a0", true],
    ["\\S", " ", false],
    ["[^\\s]", "\u000b", true],
    ["[^\\s]", " ", false],
    ["[a\\S]", "\u000b", true],
    ["[a\\S]", " ", false],
    ["[a\\S]", "a", true],
    // [[:space:]] is not \s: it holds \v.
    ["[[:space:]]", "\u000b", true],
    ["[[:space:]]", "\u00a0", false],
    // A {n} RE2 cannot read as a repeat - a leading zero, no first number - is a "{".
    ["a{01}", "a{01}", true],
    ["a{01}", "a", false],
    ["a{00}", "a{00}", true],
    ["a{00}", "", false],
    ["a{1,02}", "a{1,02}", true],
    ["a{1,02}", "a", false],
    ["a{,5}", "a{,5}", true],
    ["a{,5}", "a", false],
    ["a{0}", "", true],
    ["a{0}", "a{0}", false],
    ["a{2,}", "aa", true],
    ["a{2,}", "a", false],
    // Repeats over 1000 in all are refused; these are not.
    ["a{1000}", "a", false],
    ["(a{100}){10}", "a", false],
    ["((a{10}){10}){10}", "a", false],
    ["(a{2}){500}", "a", false],
    ["(a{1000}){1}", "a", false],
    ["(a{1000}){0}", "", true],
    ["(a{1000}){0,1}", "", true],
    ["(a{600})*", "", true],
    ["((a{600}){0}){2}", "", true],
    ["(a{40}){5}(?i){5}", "", false],
    // A repeat after a flag group repeats what came before it (repeat, parse.go).
    ["a(?i)*", "", true],
    ["a(?i)*", "aa", true],
    ["a(?i)*", "A", false],
    ["a(?i)+?", "aa", true],
    ["ab(?i)*c", "abbc", true],
    ["ab(?i)*c", "ac", true],
    ["ab(?i)*c", "abBc", false],
    ["a(?i)b(?-i)*c", "aBBc", true],
    ["a(?i)b(?-i)*c", "abbc", true],
    ["a(?i)b(?-i)*c", "aBbc", true],
    ["[ab](?m)*", "ab", true],
    ["[ab](?m)*", "abab", true],
    // ... a repeat with a flag group or \Q\E between repeats the repeat.
    ["a*(?i)*", "aa", true],
    ["a*(?i)*", "A", false],
    ["a*\\Q\\E*", "", true],
    ["a*\\Q\\E*", "aa", true],
    ["a*(?U)??", "", true],
    ["a*(?U)??", "aa", true],
    // ... and an assertion repeats as any other part.
    ["^*", "", true],
    ["^*", "a", false],
    ["$+", "", true],
    ["a\\b*", "a", true],
    ["\\A+a", "a", true],
    ["a\\z?", "a", true],
    ["(?m)a^*", "a", true],
    ["^{2}", "", true],
    // (?i) joins what Go's case folding joins: the Kelvin sign with k, the long s with s, ...
    ["(?i)k", "k", true],
    ["(?i)k", "K", true],
    ["(?i)k", "\u212a", true],
    ["(?i)s", "s", true],
    ["(?i)s", "S", true],
    ["(?i)s", "\u017f", true],
    ["(?i)K", "\u212a", true],
    ["(?i)[k]", "\u212a", true],
    ["(?i)[^k]", "\u212a", false],
    ["(?i)[^k]", "K", false],
    ["(?i)[^k]", "x", true],
    ["(?i)[a-z]", "\u212a", true],
    ["(?i)[a-z]", "\u017f", true],
    ["(?i)[^a-z]", "\u212a", false],
    ["(?i)[^a-z]", "\u017f", false],
    ["(?i)[^a-z]", "1", true],
    ["(?i)\\w", "\u212a", true],
    ["(?i)\\w", "\u017f", true],
    ["(?i)\\W", "\u212a", false],
    ["(?i)\\W", "\u017f", false],
    ["(?i)\\W", "-", true],
    ["(?i)[\\W]", "\u212a", false],
    ["(?i)[\\W]", "-", true],
    ["(?i)\u00df", "\u1e9e", true],
    ["(?i)\u00df", "ss", false],
    ["(?i)\u212b", "\u00e5", true],
    ["(?i)\u212b", "\u00c5", true],
    ["(?i)\u00e5", "\u212b", true],
    ["(?i)\u03b8", "\u03f4", true],
    ["(?i)\u03b8", "\u03d1", true],
    ["(?i)\u03b8", "\u0398", true],
    ["(?i)\u2126", "\u03c9", true],
    ["(?i)\u1f80", "\u1f88", true],
    ["(?i)\u00e9", "\u00c9", true],
    ["(?i)\u00e9", "e", false],
    ["(?i)\\x{10400}", "\ud801\udc28", true],
    ["(?i)\\x{10400}", "\ud801\udc00", true],
    ["(?i)[\\x{10400}-\\x{10402}]", "\ud801\udc29", true],
    ["(?i)[\\x{10400}-\\x{10402}]", "\ud801\udc2b", false],
    ["(?i)\\QKs\\E", "\u212a\u017f", true],
    ["(?i)[[:upper:]]", "a", true],
    ["(?i)[[:upper:]]", "A", true],
    ["(?i)[[:upper:]]", "\u017f", true],
    ["(?i)[[:upper:]]", "\u212a", true],
    ["(?i)[[:^upper:]]", "a", false],
    ["(?i)[[:^upper:]]", "1", true],
    ["(?i)[[:^upper:]]", "\u017f", false],
    ["(?i)[[:^upper:]]", "\u212a", false],
    ["(?i)[[:^lower:]]", "A", false],
    ["(?i)[[:^lower:]]", "1", true],
    // A range's ends are single characters: [\d-z] is \d, "-" and "z".
    ["[\\d-z]", "5", true],
    ["[\\d-z]", "-", true],
    ["[\\d-z]", "z", true],
    ["[\\d-z]", "y", false],
    ["[A-[:digit:]]", "B]", true],
    ["[A-[:digit:]]", "B", false],
    ["[A-[:digit:]]", "[", false],
    ["[%-[:digit:]]+", "%]", true],
    ["[%-[:digit:]]+", "5]", true],
    ["[%-[:digit:]]+", "d]", true],
    ["[a-]", "-", true],
    ["[a-]", "a", true],
    ["[-a]", "-", true],
    ["[-a]", "a", true],
  ])(
    "RE2's spelling: %s matching %j is %s, as in Prometheus",
    (pattern: string, value: string, matches: boolean) => {
      const compiled: CompiledPromQLRegex = compilePromQLRegex(pattern);
      const regex: LinearRegExp = compiled.regex;

      expect(compiled.test(value)).toBe(matches);
      // JavaScript's own engine reads the text the pattern reads the same way.
      expect(
        v8Tests({
          source: regex.source,
          flags: regex.flags,
          text: compiled.textOf(value),
          expected: matches,
        }),
      ).toBe(matches);
    },
  );

  /*
   * What Prometheus refuses, refused here too, each with the sentence the
   * query's error says after "The pattern ... for the label ...".
   */
  test.each([
    [
      "\\C",
      "uses \\C, one byte of a character, which Prometheus does not read either. Use . to match any one character.",
    ],
    ["[\\C]", "uses \\C, an escape which Prometheus does not read either."],
    [
      "(?=b)",
      "uses the look-ahead (?=, which Prometheus does not read either. Match the text itself instead, or leave values out with a second matcher that uses !~.",
    ],
    ["(?!a)b", "uses the look-ahead (?!,"],
    ["(?<=a)b", "uses the look-behind (?<=,"],
    ["(?<!a)b", "uses the look-behind (?<!,"],
    [
      "a{1001}",
      "repeats a part more than 1000 times ({1001}), counting a repeat inside another as the two counts multiplied, and Prometheus repeats a part at most 1000 times. Repeat it fewer times, or use * or + for any number of times.",
    ],
    ["a{0,1001}", "more than 1000 times ({0,1001})"],
    ["a{1001,}", "more than 1000 times ({1001,})"],
    // The count is refused first, before what it would repeat is read.
    ["{1001}", "more than 1000 times ({1001})"],
    ["a*{1001}", "more than 1000 times ({1001})"],
    ["a{99999999999}", "more than 1000 times ({99999999999})"],
    ["^{1001}", "more than 1000 times ({1001})"],
    ["(a*){1001}", "more than 1000 times ({1001})"],
    // A repeat inside a repeat counts both (repeatIsValid, parse.go).
    ["(a{100}){11}", "more than 1000 times ({11})"],
    ["((a{10}){10}){11}", "more than 1000 times ({11})"],
    ["(a{2}){501}", "more than 1000 times ({501})"],
    ["((a{600})*){2}", "more than 1000 times ({2})"],
    ["(a{600}|b){2}", "more than 1000 times ({2})"],
    ["(a{1000}){1,2}", "more than 1000 times ({1,2})"],
    ["a{2}(?i){501}", "more than 1000 times ({501})"],
    [
      "a{2,1}",
      "repeats a part {2,1} times, the least more than the most, which Prometheus does not read either. Write the smaller count first, as in {1,2}.",
    ],
    [
      "\\e",
      "uses \\e, an escape which Prometheus does not read either. Write the character itself, or its code as \\x{...}, such as \\x{41} for A.",
    ],
    ["\\cA", "uses \\c, an escape"],
    ["\\u0041", "uses \\u, an escape"],
    ["\\Z", "uses \\Z, an escape"],
    ["\\G", "uses \\G, an escape"],
    ["\\\u00e9", "uses \\\u00e9, an escape"],
    ["\\x{110000}", "uses \\x{110000}, an escape"],
    ["\\x{}", "uses \\x{}, an escape"],
    ["\\x4", "uses \\x4, an escape"],
    ["\\xZZ", "uses \\xZZ, an escape"],
    ["\\x{41", "uses \\x{41, an escape"],
    ["[\\b]", "uses \\b, an escape"],
    ["[\\Q]", "uses \\Q, an escape"],
    ["[\\A]", "uses \\A, an escape"],
    ["[\\z]", "uses \\z, an escape"],
    [
      "[a-\\d]",
      "ends the range a-\\d with a class, which Prometheus does not read either: a range runs from one character to another. Write the class beside the range, as in [a-z\\d].",
    ],
    ["[a-\\pL]", "ends the range a-\\p with a class"],
    [
      "[z-a]",
      "holds the range z-a, whose end comes before its start, which Prometheus does not read either. Write the lower character first.",
    ],
    [
      "[\\x{5A}-A]",
      "holds the range \\x{5A}-A, whose end comes before its start",
    ],
    [
      "(?P<>x)",
      'names a group (?P<>, which Prometheus does not read either. A group\'s name is letters, digits and _, closed by ">": (?P<host>...).',
    ],
    ["(?P<a-b>x)", "names a group (?P<a-b>,"],
    ["(?P<\u00e9>x)", "names a group (?P<\u00e9>,"],
    ["(?<a$>x)", "names a group (?<a$>,"],
    ["(?P<a", "names a group (?P<a,"],
    [
      "(?'a'x)",
      "opens a group with (?', which Prometheus does not read either. A group is (...), (?:...) or (?P<name>...), and a flag group (?i), (?m), (?s) or (?U), or (?i:...) for a part.",
    ],
    ["(?#c)", "opens a group with (?#,"],
    ["(?P=a)", "opens a group with (?P,"],
    ["(?>a)", "opens a group with (?>,"],
    ["(?i-)a", "opens a group with (?i-),"],
    [
      "\\Q\\E*",
      "has the repeat * with nothing before it to repeat, which Prometheus does not read either. Write \\* to match the character itself.",
    ],
    ["(?i)*", "has the repeat * with nothing before it"],
    ["a|+", "has the repeat + with nothing before it"],
    ["(*)", "has the repeat * with nothing before it"],
    [
      "{2}",
      "has the repeat {2} with nothing before it to repeat, which Prometheus does not read either. Write \\{ to match the character itself.",
    ],
    // A Unicode class Go has no table for (unicodeTable, parse.go).
    [
      "\\p{Nosuch}",
      "uses the Unicode class \\p{Nosuch}, which Prometheus does not read either. A Unicode class names a general category, such as \\pL or \\p{Lu}, or a script, such as \\p{Greek} or \\p{Han}.",
    ],
    ["\\pX", "uses the Unicode class \\pX, which Prometheus does not"],
    ["\\p", "uses the Unicode class \\p, which Prometheus does not"],
    ["a\\P", "uses the Unicode class \\P, which Prometheus does not"],
    ["\\p{}", "uses the Unicode class \\p{}, which Prometheus does not"],
    ["\\p{^}", "uses the Unicode class \\p{^}, which Prometheus does not"],
    ["\\p^L", "uses the Unicode class \\p^, which Prometheus does not"],
    ["[\\p{Nosuch}]", "uses the Unicode class \\p{Nosuch},"],
    ["[a\\PX]", "uses the Unicode class \\PX,"],
    // A script's ISO 15924 code is no name Go reads, in label_replace() either.
    ["\\p{Grek}", "uses the Unicode class \\p{Grek}, which Prometheus does"],
    ["\\p{Zzzz}", "uses the Unicode class \\p{Zzzz}, which Prometheus does"],
    ["\\p{L&}", "uses the Unicode class \\p{L&}, which Prometheus does"],
    [
      "\\p{Greek",
      'uses the Unicode class \\p{Greek without the "}" that ends its name, which Prometheus does not read either. Write a class as \\pL or \\p{Greek}.',
    ],
    ["[\\p{L]", 'uses the Unicode class \\p{L] without the "}"'],
    /*
     * Names Go 1.25 and later read, as Prometheus' label_replace() does, and
     * its label matchers' older copy of regexp/syntax does not: the sentence
     * names the class as a matcher writes it.
     */
    [
      "\\p{Letter}",
      "uses the Unicode class \\p{Letter}, which Prometheus reads in label_replace() but not in a label matcher, where a class has the name Go's Unicode tables give it. Write \\p{L} instead.",
    ],
    ["\\P{Letter}", "Write \\P{L} instead."],
    ["\\p{^Letter}", "Write \\P{L} instead."],
    ["\\P{^Letter}", "Write \\p{L} instead."],
    ["\\p{greek}", "Write \\p{Greek} instead."],
    ["\\p{GREEK}", "Write \\p{Greek} instead."],
    ["\\p{old italic}", "Write \\p{Old_Italic} instead."],
    ["\\p{OldItalic}", "Write \\p{Old_Italic} instead."],
    ["\\p{Uppercase_Letter}", "Write \\p{Lu} instead."],
    ["\\p{lu}", "Write \\p{Lu} instead."],
    ["\\p{lc}", "Write \\p{LC} instead."],
    ["\\p{Lc}", "Write \\p{LC} instead."],
    ["\\p{digit}", "Write \\p{Nd} instead."],
    ["\\p{any}", "Write \\p{Any} instead."],
    ["\\p{Assigned}", "Write \\P{Cn} instead."],
    ["\\P{Assigned}", "Write \\p{Cn} instead."],
    ["\\p{ASCII}", "Write [[:ascii:]] instead."],
    ["\\P{ascii}", "Write [[:^ascii:]] instead."],
    ["[\\p{Letter}\\d]", "Write \\p{L} instead."],
    ["\\pl", "uses the Unicode class \\pl, which Prometheus reads in"],
  ])(
    "%s is refused, as Prometheus refuses it, with a sentence",
    (pattern: string, problem: string) => {
      const refusal: unknown = refusalOf(pattern);

      expect(refusal).toBeInstanceOf(PromQLPatternError);
      expect((refusal as PromQLPatternError).problem).toContain(problem);
      // A SyntaxError still, and a sentence of its own.
      expect(refusal).toBeInstanceOf(SyntaxError);
      expect((refusal as PromQLPatternError).message).toBe(
        `The pattern "${pattern}" ${(refusal as PromQLPatternError).problem}`,
      );
    },
  );

  test("\\Q ... \\E is its text: its characters, its letters folded under (?i)", () => {
    expect(compilePromQLRegex("\\Q.*+?()[]{}|^$\\E").regex.source).toBe(
      "^(?s:\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\^\\$)$",
    );
    expect(
      compilePromQLRegex("\\Q.*+?()[]{}|^$\\E").regex.test(".*+?()[]{}|^$"),
    ).toBe(true);
    // \E ends it at its first \E; what follows is a pattern again.
    expect(compilePromQLRegex("\\Qa|b\\E|c").regex.test("c")).toBe(true);
    expect(compilePromQLRegex("\\Qa|b\\E|c").regex.test("a")).toBe(false);
  });

  /*
   * A bracket that names characters beyond U+FFFF matches each whole, as
   * RE2 does, even when it names all of them. Its surrogates, which RE2
   * matches in no text, match no half of one either. Prometheus answered
   * each row.
   */
  test.each([
    ["[\\x{10000}-\\x{10FFFF}]", "😃", true],
    ["[\\x{10000}-\\x{10FFFF}]", "a", false],
    ["[\\x{10000}-\\x{10FFFF}]", "😃😃", false],
    ["[a\\x{10000}-\\x{10FFFF}]{2}", "a😃", true],
    ["[a\\x{10000}-\\x{10FFFF}]{2}", "aa", true],
    ["[a\\x{10000}-\\x{10FFFF}]{2}", "a", false],
    ["[\\x{D7FF}-\\x{E000}]+", "퟿", true],
    ["[\\x{D7FF}-\\x{E000}]+", "😀", false],
    ["[^\\x{1F600}]+", "😀", false],
    ["[^\\x{1F600}]+", "😁😂", true],
    ["[^\\x{1F600}]+", "a😀", false],
  ])(
    "%s matching %j is %s, each character beyond U+FFFF one, as in Prometheus",
    (pattern: string, value: string, matches: boolean) => {
      const compiled: CompiledPromQLRegex = compilePromQLRegex(pattern);
      const regex: LinearRegExp = compiled.regex;

      expect(compiled.test(value)).toBe(matches);
      expect(
        v8Tests({
          source: regex.source,
          flags: regex.flags,
          text: compiled.textOf(value),
          expected: matches,
        }),
      ).toBe(matches);
    },
  );

  test("a code point beyond U+FFFF is one character to a repeat, as in RE2", () => {
    /*
     * Read as one code unit, a surrogate no other character is
     * (AstralAlphabet): repeated as any one character is.
     */
    expect(compilePromQLRegex("\\x{1F600}{2}").regex.source).toBe(
      "^(?s:\\ud801{2})$",
    );
    expect(
      compilePromQLRegex("\\x{1F600}{2}").test("\ud83d\ude00\ud83d\ude00"),
    ).toBe(true);
    expect(compilePromQLRegex("\\x{1F600}{2}").test("\ud83d\ude00")).toBe(
      false,
    );
    // Written in the pattern itself, it is one character as well.
    expect(
      compilePromQLRegex("\ud83d\ude00+").test("\ud83d\ude00\ud83d\ude00"),
    ).toBe(true);
    expect(compilePromQLRegex("\ud83d\ude00+").test("\ud83d\ude00\ude00")).toBe(
      false,
    );
  });

  /*
   * Decided, not matched as Prometheus does (PromQLRegex.ts's header): a
   * repeat whose iteration can match nothing captures as JavaScript's does,
   * and a surrogate named by its code matches nothing.
   */
  test("what still differs from Prometheus, as decided", () => {
    // Prometheus captures "xx": its automaton leaves the repeat for "".
    expect(
      compilePromQLRegex("(?:|x)+(\\w*)", { captures: true }).exec("xx")
        ?.captures,
    ).toEqual([""]);
    // Prometheus matches \x{D83D} with U+FFFD, and .\x{D83D} with nothing.
    expect(compilePromQLRegex("\\x{D83D}").test("\ufffd")).toBe(false);
    expect(compilePromQLRegex("\\x{D83D}").test("\ud83d")).toBe(false);
    expect(compilePromQLRegex(".\\x{D83D}").test("a\ufffd")).toBe(false);
  });

  /*
   * WIDER_CASE_FOLDS holds the orbits of Go's case folding that
   * JavaScript's i flag, without u, does not join whole. Held to the
   * running engine, so a Node release that changes its case mappings
   * fails here rather than folding otherwise unseen: each orbit is one
   * JavaScript splits, and holds every code point JavaScript joins to one
   * of its members; and every other letter's cases, by JavaScript's own
   * lower and upper case, are ones JavaScript's i flag joins.
   */
  test("the case folds written out are those JavaScript's i flag does not make", () => {
    const listed: Map<number, ReadonlyArray<number>> = new Map<
      number,
      ReadonlyArray<number>
    >();

    for (const orbit of WIDER_CASE_FOLDS) {
      const joined: Set<number> = new Set<number>(getCaseVariants(orbit[0]!));

      expect(
        orbit.every((codePoint: number): boolean => {
          return joined.has(codePoint);
        }),
      ).toBe(false);

      for (const codePoint of orbit) {
        expect(codePoint).toBeLessThanOrEqual(0xffff);

        for (const variant of getCaseVariants(codePoint)) {
          expect(orbit).toContain(variant);
        }

        listed.set(codePoint, orbit);
      }
    }

    /*
     * The dotless i's upper case is I, and Go keeps it apart from I and i
     * (caseOrbit, unicode/tables.go), as JavaScript does.
     */
    const keptApart: ReadonlySet<number> = new Set<number>([0x0131]);
    const unjoined: Array<string> = [];

    for (let codeUnit: number = 0; codeUnit <= 0xffff; codeUnit++) {
      if (codeUnit >= 0xd800 && codeUnit <= 0xdfff) {
        continue;
      }

      const character: string = String.fromCharCode(codeUnit);
      const variants: Set<number> = new Set<number>(getCaseVariants(codeUnit));

      for (const other of [character.toLowerCase(), character.toUpperCase()]) {
        if (other.length !== 1) {
          continue;
        }

        const otherCodeUnit: number = other.charCodeAt(0);

        if (
          !variants.has(otherCodeUnit) &&
          !(listed.get(codeUnit) ?? []).includes(otherCodeUnit) &&
          !keptApart.has(codeUnit)
        ) {
          unjoined.push(
            `U+${codeUnit.toString(16)} and U+${otherCodeUnit.toString(16)}`,
          );
        }
      }
    }

    expect(unjoined).toEqual([]);
  });

  test("a pattern that is not a regular expression throws a SyntaxError", () => {
    expect(refusalOf("(")).toBeInstanceOf(SyntaxError);
    expect(refusalOf("[[:digit:]")).toBeInstanceOf(SyntaxError);
    expect(refusalOf("a{2,1}")).toBeInstanceOf(SyntaxError);
    // Prometheus refuses these too: "unexpected )", and a "-" with no flag.
    expect(refusalOf("a)|(b")).toBeInstanceOf(SyntaxError);
    // The refusal names the ")" that closes nothing, not the "(" after it.
    expect((refusalOf("a)|(b") as SyntaxError).message).toContain(
      "Unmatched ')'",
    );
    expect(refusalOf("(?i-)a")).toBeInstanceOf(SyntaxError);
  });

  test.each([
    ["(a)\\1", PatternProblemReason.BackReference],
    ["(?P<x>a)\\k<x>", PatternProblemReason.BackReference],
    // RE2 has no back-references: \1 and \8 without a group are refused too.
    ["\\1", PatternProblemReason.BackReference],
    ["\\8", PatternProblemReason.BackReference],
    // Forty-one repeats of 1000, each one Prometheus reads: past MAX_PATTERN_STEPS.
    [".{1000}".repeat(41), PatternProblemReason.TooLarge],
  ])(
    "%s is refused by the linear-time matcher",
    (pattern: string, reason: PatternProblemReason) => {
      const refusal: unknown = refusalOf(pattern);

      expect(refusal).toBeInstanceOf(PatternProblemError);
      expect((refusal as PatternProblemError).reason).toBe(reason);
    },
  );

  /*
   * An alternation of hundreds of values, as a Grafana variable writes one
   * for "All", is about a step a character: past about 9,000 characters it
   * was refused as too large (issue #8464), where Prometheus reads it. A
   * pattern may compile to MAX_PATTERN_STEPS, twice MAX_PATTERN_LENGTH, so
   * any pattern with no repeat in it compiles.
   */
  describe("a long alternation compiles, as Prometheus reads it", () => {
    // Values `${prefix}0`, `${prefix}1`, ..., as many as fit in `length`.
    const valuesUpTo: (prefix: string, length: number) => Array<string> = (
      prefix: string,
      length: number,
    ): Array<string> => {
      const values: Array<string> = [];

      for (let index: number = 0; ; index++) {
        const value: string = `${prefix}${String(index).padStart(4, "0")}`;

        if ([...values, value].join("|").length > length) {
          return values;
        }

        values.push(value);
      }
    };

    test("1,000 host names, the issue's case", () => {
      const hosts: Array<string> = valuesUpTo("web-server-", 16000).slice(
        0,
        1000,
      );
      const compiled: CompiledPromQLRegex = compilePromQLRegex(hosts.join("|"));

      expect(hosts).toHaveLength(1000);
      expect(compiled.test("web-server-0000")).toBe(true);
      expect(compiled.test("web-server-0500")).toBe(true);
      expect(compiled.test("web-server-0999")).toBe(true);
      expect(compiled.test("web-server-1000")).toBe(false);
      expect(compiled.test("web-server-0999x")).toBe(false);
      expect(compiled.test("")).toBe(false);
      // Refused before: more than DEFAULT_MAX_STEPS.
      expect(compiled.regex.steps).toBeGreaterThan(2 * DEFAULT_MAX_STEPS);
    });

    test("one as long as a pattern may be, case-insensitive and with captures too", () => {
      const hosts: Array<string> = valuesUpTo(
        "kube-system-svc-",
        MAX_PATTERN_LENGTH - 6,
      );
      const pattern: string = `(?i)(${hosts.join("|")})`;

      expect(pattern.length).toBeLessThanOrEqual(MAX_PATTERN_LENGTH);
      expect(compilePromQLRegex(pattern).test(hosts[0]!.toUpperCase())).toBe(
        true,
      );
      expect(
        compilePromQLRegex(pattern, { captures: true }).exec(
          hosts[hosts.length - 1]!,
        )?.captures,
      ).toEqual([hosts[hosts.length - 1]]);
    });

    test("the widest alternation, one character each, compiles", () => {
      const characters: Array<string> = [];

      while (characters.join("|").length + 2 <= MAX_PATTERN_LENGTH) {
        characters.push(String.fromCharCode(0x4e00 + characters.length));
      }

      const compiled: CompiledPromQLRegex = compilePromQLRegex(
        characters.join("|"),
      );

      expect(compiled.test(characters[characters.length - 1]!)).toBe(true);
      expect(compiled.test("a")).toBe(false);
    });

    test("a pattern that compiles to more steps than MAX_PATTERN_STEPS is still refused, saying so", () => {
      expect(MAX_PATTERN_STEPS).toBe(2 * MAX_PATTERN_LENGTH);
      // Each .{1000} is a thousand steps: 39 of them fit, 41 do not.
      expect(
        compilePromQLRegex(".{1000}".repeat(39)).test("a".repeat(39000)),
      ).toBe(true);

      const refusal: unknown = refusalOf(".{1000}".repeat(41));

      expect(refusal).toBeInstanceOf(PatternProblemError);
      expect((refusal as Error).message).toBe(
        `The pattern is too large: it would take more than ${MAX_PATTERN_STEPS} steps to run.`,
      );
    });
  });

  test("are compiled once and kept, by the pattern", () => {
    clearLinearRegExpCache();

    const regex: LinearRegExp = compilePromQLRegex("api|web").regex;

    expect(compilePromQLRegex("api|web").regex).toBe(regex);
    expect(getCachedPatternCount()).toBe(1);
    // label_replace() reads what the groups capture: compiled apart.
    expect(compilePromQLRegex("api|web", { captures: true }).regex).not.toBe(
      regex,
    );
    expect(getCachedPatternCount()).toBe(2);
  });

  test("keep the pattern for engines that speak RE2, anchored as Prometheus anchors it", () => {
    expect(compilePromQLRegex("a|b").anchoredPattern).toBe("^(?s:a|b)$");
    expect(compilePromQLRegex("(?m)api").anchoredPattern).toBe(
      "^(?s:(?m)api)$",
    );
  });
});

describe("PromQL selectors", () => {
  test("a metric name is a matcher on __name__", () => {
    const selector: PromQLVectorSelector = parsePromQL(
      "up",
    ) as PromQLVectorSelector;

    expect(selector.kind).toBe(PromQLNodeKind.VectorSelector);
    expect(selector.name).toBe("up");
    expect(selector.matchers).toEqual([
      { name: "__name__", type: PromQLMatchType.Equal, value: "up" },
    ]);
  });

  test("reads every matcher type", () => {
    const selector: PromQLVectorSelector = parsePromQL(
      'http_requests_total{job="api", code!="200", method=~"GET|POST", path!~"/health.*",}',
    ) as PromQLVectorSelector;

    expect(selector.matchers).toEqual([
      {
        name: "__name__",
        type: PromQLMatchType.Equal,
        value: "http_requests_total",
      },
      { name: "job", type: PromQLMatchType.Equal, value: "api" },
      { name: "code", type: PromQLMatchType.NotEqual, value: "200" },
      { name: "method", type: PromQLMatchType.RegexMatch, value: "GET|POST" },
      { name: "path", type: PromQLMatchType.RegexNoMatch, value: "/health.*" },
    ]);
  });

  test("reads a selector with no metric name", () => {
    const selector: PromQLVectorSelector = parsePromQL(
      '{job="api"}',
    ) as PromQLVectorSelector;

    expect(selector.name).toBeUndefined();
    expect(selector.matchers).toEqual([
      { name: "job", type: PromQLMatchType.Equal, value: "api" },
    ]);
  });

  test("reads Prometheus 3's quoted names, for OpenTelemetry's dotted names", () => {
    const selector: PromQLVectorSelector = parsePromQL(
      '{"http.server.request.duration", "service.name"="api"}',
    ) as PromQLVectorSelector;

    expect(selector.name).toBe("http.server.request.duration");
    expect(selector.matchers).toEqual([
      {
        name: "__name__",
        type: PromQLMatchType.Equal,
        value: "http.server.request.duration",
      },
      { name: "service.name", type: PromQLMatchType.Equal, value: "api" },
    ]);
  });

  test("label names may be keywords", () => {
    const selector: PromQLVectorSelector = parsePromQL(
      'x{on="a", by="b", offset="c"}',
    ) as PromQLVectorSelector;

    expect(
      selector.matchers.map((matcher: { name: string }): string => {
        return matcher.name;
      }),
    ).toEqual(["__name__", "on", "by", "offset"]);
  });

  test.each([
    ['{job=""}', "needs a metric name or a label matcher"],
    ['{job=~".*"}', "needs a metric name or a label matcher"],
    ['{job!="x"}', "needs a metric name or a label matcher"],
    ['up{__name__="down"}', "The metric name is written twice"],
    ['{"a", "b"}', "The metric name is written twice"],
    ['up{job="api"', '"," or "}"'],
    ["up{job}", '"=", "!=", "=~" or "!~"'],
    ["up{job=api}", 'a quoted value for the label "job"'],
    ['up{job=~"("}', "is not a regular expression"],
  ])("refuses %s", (query: string, message: string) => {
    expect(parseError(query).message).toContain(message);
  });

  test("a pattern that is not a regular expression is refused where it is written", () => {
    const error: PromQLError = parseError('up{job=~"("}');

    expect(error.message).toBe(
      '"(" is not a regular expression the label "job" can be matched with.',
    );
    expect(error.errorType).toBe(PromQLErrorType.BadData);
    expect(error.position).toEqual({ start: 8, end: 11 });
  });

  test.each([
    [
      'up{job=~"(a)\\\\1"}',
      'The pattern "(a)\\1" for the label "job" refers back to what an earlier group matched (\\1 or \\k<name>). Patterns are run in time that grows only in line with the text they read, which a back-reference cannot do. Write the pattern without it.',
      { start: 8, end: 16 },
    ],
    [
      `up{path!~"${".{1000}".repeat(41)}"}`,
      `The pattern "${".{1000}".repeat(41)}" for the label "path" is too large to run. Shorten it, or repeat its parts fewer times.`,
      { start: 9, end: 298 },
    ],
    [
      'up{job=~"[[:nosuch:]]"}',
      'The pattern "[[:nosuch:]]" for the label "job" names the character class [:nosuch:], which Prometheus does not read either. The classes are [:alnum:], [:alpha:], [:ascii:], [:blank:], [:cntrl:], [:digit:], [:graph:], [:lower:], [:print:], [:punct:], [:space:], [:upper:], [:word:] and [:xdigit:], written in lowercase, and [:^digit:] matches every character [:digit:] does not.',
      { start: 8, end: 22 },
    ],
    [
      'up{job=~"a{1001}"}',
      'The pattern "a{1001}" for the label "job" repeats a part more than 1000 times ({1001}), counting a repeat inside another as the two counts multiplied, and Prometheus repeats a part at most 1000 times. Repeat it fewer times, or use * or + for any number of times.',
      { start: 8, end: 17 },
    ],
  ])(
    "a pattern the linear-time matcher cannot run is refused with a sentence: %s",
    (query: string, message: string, position: PromQLPosition) => {
      const error: PromQLError = parseError(query);

      expect(error.message).toBe(message);
      expect(error.errorType).toBe(PromQLErrorType.BadData);
      expect(error.position).toEqual(position);
    },
  );

  test("a selector that matches a non-empty value selects something", () => {
    expect(() => {
      return parsePromQL('{job=~".+"}');
    }).not.toThrow();
  });

  test("knows which matchers accept a missing label", () => {
    expect(
      matchesEmptyValue({ name: "a", type: PromQLMatchType.Equal, value: "" }),
    ).toBe(true);
    expect(
      matchesEmptyValue({
        name: "a",
        type: PromQLMatchType.RegexMatch,
        value: "x|",
      }),
    ).toBe(true);
    expect(
      matchesEmptyValue({
        name: "a",
        type: PromQLMatchType.RegexNoMatch,
        value: "",
      }),
    ).toBe(false);
  });
});

describe("PromQL ranges, offsets, @ and subqueries", () => {
  test("a range turns a selector into a range vector", () => {
    const matrix: PromQLMatrixSelector = parsePromQL(
      "http_requests_total[5m]",
    ) as PromQLMatrixSelector;

    expect(matrix.kind).toBe(PromQLNodeKind.MatrixSelector);
    expect(matrix.rangeMs).toBe(300000);
    expect(getPromQLValueType(matrix)).toBe(PromQLValueType.RangeVector);
  });

  test("a bare number in a range is seconds", () => {
    expect((parsePromQL("x[90]") as PromQLMatrixSelector).rangeMs).toBe(90000);
  });

  test("an offset after a range lives on its selector", () => {
    const matrix: PromQLMatrixSelector = parsePromQL(
      "x[5m] offset 1h",
    ) as PromQLMatrixSelector;

    expect(matrix.vectorSelector.offsetMs).toBe(3600000);
  });

  test("an offset can be negative", () => {
    expect((parsePromQL("x offset -5m") as PromQLVectorSelector).offsetMs).toBe(
      -300000,
    );
  });

  test("reads @ with a timestamp, start() and end(), before or after offset", () => {
    const fixed: PromQLVectorSelector = parsePromQL(
      "x @ 1700000000.5 offset 1m",
    ) as PromQLVectorSelector;

    expect(fixed.at).toEqual({ kind: "timestamp", timestampMs: 1700000000500 });
    expect(fixed.offsetMs).toBe(60000);

    expect(
      (parsePromQL("x offset 1m @ start()") as PromQLVectorSelector).at,
    ).toEqual({ kind: "start" });
    expect(
      (parsePromQL("x[5m] @ end()") as PromQLMatrixSelector).vectorSelector.at,
    ).toEqual({ kind: "end" });
  });

  test("a subquery takes a range and an optional step", () => {
    const subquery: PromQLSubquery = parsePromQL(
      "rate(x[1m])[30m:1m] offset 5m",
    ) as PromQLSubquery;

    expect(subquery.kind).toBe(PromQLNodeKind.Subquery);
    expect(subquery.rangeMs).toBe(1800000);
    expect(subquery.stepMs).toBe(60000);
    expect(subquery.offsetMs).toBe(300000);
    expect((subquery.expression as PromQLCall).functionName).toBe("rate");

    expect((parsePromQL("x[1h:]") as PromQLSubquery).stepMs).toBeUndefined();
  });

  test.each([
    ["sum(x)[5m]", "A range such as [5m] only goes after a selector"],
    ["x offset 1h[5m]", "Write the offset after the range"],
    ["x @ 100 [5m]", "Write @ after the range"],
    ["x offset 1m offset 2m", "The offset is written twice"],
    ["x @ 1 @ 2", "@ is written twice"],
    ["sum(x) offset 5m", "An offset only goes after a selector"],
    ["sum(x) @ 5", "@ only goes after a selector"],
    ["x[5m][5m:1m]", "needs an instant vector before it"],
    ["x[0s]", "The range must be longer than zero"],
    ["x[5m:0s]", "The subquery step must be longer than zero"],
    ["x[5min]", "is not a number or a duration"],
    ["x @ foo", "a Unix timestamp in seconds"],
  ])("refuses %s", (query: string, message: string) => {
    expect(parseError(query).message).toContain(message);
  });
});

describe("PromQL operators", () => {
  test("multiplication binds tighter than addition", () => {
    const binary: PromQLBinary = parsePromQL("a + b * c") as PromQLBinary;

    expect(binary.operator).toBe(PromQLBinaryOperator.Add);
    expect((binary.rhs as PromQLBinary).operator).toBe(
      PromQLBinaryOperator.Mul,
    );
  });

  test("^ is right-associative", () => {
    const binary: PromQLBinary = parsePromQL("2 ^ 3 ^ 2") as PromQLBinary;

    expect(binary.operator).toBe(PromQLBinaryOperator.Pow);
    expect((binary.lhs as PromQLNumberLiteral).value).toBe(2);
    expect((binary.rhs as PromQLBinary).operator).toBe(
      PromQLBinaryOperator.Pow,
    );
  });

  test("subtraction is left-associative", () => {
    const binary: PromQLBinary = parsePromQL("a - b - c") as PromQLBinary;

    expect((binary.lhs as PromQLBinary).operator).toBe(
      PromQLBinaryOperator.Sub,
    );
    expect((binary.rhs as PromQLVectorSelector).name).toBe("c");
  });

  test("or binds loosest, then and and unless, then comparisons", () => {
    const binary: PromQLBinary = parsePromQL(
      "a > 1 and b or c unless d",
    ) as PromQLBinary;

    expect(binary.operator).toBe(PromQLBinaryOperator.Or);
    expect((binary.lhs as PromQLBinary).operator).toBe(
      PromQLBinaryOperator.And,
    );
    expect(((binary.lhs as PromQLBinary).lhs as PromQLBinary).operator).toBe(
      PromQLBinaryOperator.Gtr,
    );
    expect((binary.rhs as PromQLBinary).operator).toBe(
      PromQLBinaryOperator.Unless,
    );
  });

  test("a unary minus on a number is the negative number", () => {
    const literal: PromQLNumberLiteral = parsePromQL(
      "-1.5",
    ) as PromQLNumberLiteral;

    expect(literal.kind).toBe(PromQLNodeKind.NumberLiteral);
    expect(literal.value).toBe(-1.5);
  });

  test("-2 ^ 2 is -(2 ^ 2), as in Prometheus", () => {
    const unary: PromQLUnary = parsePromQL("-2 ^ 2") as PromQLUnary;

    expect(unary.kind).toBe(PromQLNodeKind.Unary);
    expect((unary.expression as PromQLBinary).operator).toBe(
      PromQLBinaryOperator.Pow,
    );
  });

  test("-a * b is (-a) * b", () => {
    const binary: PromQLBinary = parsePromQL("-a * b") as PromQLBinary;

    expect(binary.operator).toBe(PromQLBinaryOperator.Mul);
    expect(binary.lhs.kind).toBe(PromQLNodeKind.Unary);
  });

  test("keyword operators are read in any case", () => {
    expect((parsePromQL("a AND b") as PromQLBinary).operator).toBe(
      PromQLBinaryOperator.And,
    );
    expect((parsePromQL("a Or b") as PromQLBinary).operator).toBe(
      PromQLBinaryOperator.Or,
    );
    expect((parsePromQL("a atan2 b") as PromQLBinary).operator).toBe(
      PromQLBinaryOperator.Atan2,
    );
    expect((parsePromQL("a UNLESS b") as PromQLBinary).operator).toBe(
      PromQLBinaryOperator.Unless,
    );
    expect((parsePromQL("a aTaN2 b") as PromQLBinary).operator).toBe(
      PromQLBinaryOperator.Atan2,
    );
  });

  /*
   * A word after an expression is an operator only when it is one of the
   * keyword operators. The words are looked up by what the query wrote, in
   * lower case: a name every object inherits (constructor, __proto__, and
   * the rest, in any case) is a word no operator is, so it is refused as
   * "a b" is, as Prometheus refuses it ("unexpected identifier"). Read from
   * a plain object, `up constructor up` was an operation whose operator was
   * a function, refused only when it ran, with the function's source text.
   */
  test.each(INHERITED_PROPERTY_NAME_SPELLINGS)(
    'refuses "a %s b" as it refuses "a b"',
    (name: string) => {
      const error: PromQLError = parseError(`a ${name} b`);

      expect(error.message).toBe(
        `Unexpected "${name}" at position 3: expected an operator or the end of the query.`,
      );
      expect(error.message).not.toContain("native code");
      expect(error.message).not.toContain("[object Object]");
      expect(error.position).toEqual({ start: 2, end: 2 + name.length });
      expect(parseError(`a ${name}`).message).toBe(error.message);
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "reads %s as a metric name on either side of an operator",
    (name: string) => {
      for (const [query, operator] of [
        [`${name} and ${name}`, PromQLBinaryOperator.And],
        [`${name} / on (job) ${name}`, PromQLBinaryOperator.Div],
        [`up or ${name}`, PromQLBinaryOperator.Or],
        [`${name} unless up`, PromQLBinaryOperator.Unless],
      ] as Array<[string, PromQLBinaryOperator]>) {
        const binary: PromQLBinary = parsePromQL(query) as PromQLBinary;

        expect({ query, operator: binary.operator }).toEqual({
          query,
          operator,
        });
      }

      const both: PromQLBinary = parsePromQL(
        `${name} and ${name}`,
      ) as PromQLBinary;

      expect((both.lhs as PromQLVectorSelector).name).toBe(name);
      expect((both.rhs as PromQLVectorSelector).name).toBe(name);
    },
  );

  test("reads bool, on, ignoring, group_left and group_right", () => {
    const comparison: PromQLBinary = parsePromQL(
      "a > bool on (job) b",
    ) as PromQLBinary;

    expect(comparison.returnBool).toBe(true);
    expect(comparison.matching).toEqual({
      cardinality: PromQLVectorMatchCardinality.OneToOne,
      on: true,
      matchingLabels: ["job"],
      include: [],
    });

    const left: PromQLBinary = parsePromQL(
      "a * ignoring (code) group_left (team, owner) b",
    ) as PromQLBinary;

    expect(left.matching).toEqual({
      cardinality: PromQLVectorMatchCardinality.ManyToOne,
      on: false,
      matchingLabels: ["code"],
      include: ["team", "owner"],
    });

    const right: PromQLBinary = parsePromQL(
      "a / on (instance) group_right b",
    ) as PromQLBinary;

    expect(right.matching?.cardinality).toBe(
      PromQLVectorMatchCardinality.OneToMany,
    );
    expect(right.matching?.include).toEqual([]);
  });

  test("set operators match many to many", () => {
    expect((parsePromQL("a and on (job) b") as PromQLBinary).matching).toEqual({
      cardinality: PromQLVectorMatchCardinality.ManyToMany,
      on: true,
      matchingLabels: ["job"],
      include: [],
    });
  });

  test("an operation with a number on one side has no vector matching", () => {
    expect((parsePromQL("a * 2") as PromQLBinary).matching).toBeUndefined();
  });

  test("two numbers make a number; anything with a vector makes a vector", () => {
    expect(getPromQLValueType(parsePromQL("1 + 2"))).toBe(
      PromQLValueType.Scalar,
    );
    expect(getPromQLValueType(parsePromQL("1 + a"))).toBe(
      PromQLValueType.InstantVector,
    );
    expect(getPromQLValueType(parsePromQL("2 > bool 1"))).toBe(
      PromQLValueType.Scalar,
    );
  });

  test.each([
    ["1 > 2", 'needs the bool modifier: write "> bool"'],
    ["a + bool b", "The bool modifier only goes after a comparison"],
    ["a and 1", "works between two instant vectors, not with a number"],
    ["1 or a", "works between two instant vectors, not with a number"],
    ["a * on (job) 2", "only works between two instant vectors"],
    ["a and on (job) group_left b", "takes no group_left or group_right"],
    [
      "a * on (job) group_left (job) b",
      'The label "job" is in both on(...) and group_left/group_right(...)',
    ],
    ["a[5m] + 1", "not on a range vector"],
    ['"text" + 1', "not on a string"],
    ["-a[5m]", "not on a range vector"],
    ["a +", "Unexpected the end of the query"],
    ["a b", 'Unexpected "b"'],
    ["(a", 'expected ")"'],
    ["a * group_left b", 'Unexpected "b"'],
  ])("refuses %s", (query: string, message: string) => {
    expect(parseError(query).message).toContain(message);
  });
});

describe("PromQL aggregations", () => {
  test("reads by before the arguments", () => {
    const aggregate: PromQLAggregate = parsePromQL(
      "sum by (job, instance) (rate(x[5m]))",
    ) as PromQLAggregate;

    expect(aggregate.kind).toBe(PromQLNodeKind.Aggregate);
    expect(aggregate.operator).toBe(PromQLAggregateOperator.Sum);
    expect(aggregate.grouping).toEqual(["job", "instance"]);
    expect(aggregate.without).toBe(false);
  });

  test("reads without after the arguments", () => {
    const aggregate: PromQLAggregate = parsePromQL(
      "avg(x) without (instance,)",
    ) as PromQLAggregate;

    expect(aggregate.operator).toBe(PromQLAggregateOperator.Avg);
    expect(aggregate.grouping).toEqual(["instance"]);
    expect(aggregate.without).toBe(true);
  });

  test("reads aggregation keywords in any case", () => {
    expect((parsePromQL("SUM(x)") as PromQLAggregate).operator).toBe(
      PromQLAggregateOperator.Sum,
    );
  });

  test("topk, bottomk, quantile and count_values take a parameter", () => {
    const topk: PromQLAggregate = parsePromQL(
      "topk(5, x) by (job)",
    ) as PromQLAggregate;

    expect((topk.parameter as PromQLNumberLiteral).value).toBe(5);
    expect((topk.expression as PromQLVectorSelector).name).toBe("x");

    const countValues: PromQLAggregate = parsePromQL(
      'count_values("version", build_info)',
    ) as PromQLAggregate;

    expect(countValues.parameter?.kind).toBe(PromQLNodeKind.StringLiteral);
  });

  test("an aggregation keyword with no brackets is a metric name", () => {
    expect((parsePromQL("sum") as PromQLVectorSelector).name).toBe("sum");
  });

  test.each([
    ["sum(x, y)", "sum(...) takes 1 argument, but the query gives it 2"],
    ["topk(x)", "topk(...) takes 2 arguments, but the query gives it 1"],
    [
      "sum(x[5m])",
      "The expression in sum(...) must be an instant vector, but it is a range vector",
    ],
    ['topk("5", x)', "must be a scalar, but it is a string"],
    ["count_values(5, x)", "must be a string, but it is a scalar"],
    ["sum by job (x)", 'expected "("'],
  ])("refuses %s", (query: string, message: string) => {
    expect(parseError(query).message).toContain(message);
  });
});

describe("PromQL function calls", () => {
  test("reads a call and its arguments", () => {
    const call: PromQLCall = parsePromQL(
      "histogram_quantile(0.99, sum by (le) (rate(x_bucket[5m])))",
    ) as PromQLCall;

    expect(call.kind).toBe(PromQLNodeKind.Call);
    expect(call.functionName).toBe("histogram_quantile");
    expect(call.args).toHaveLength(2);
  });

  test("optional and repeated arguments", () => {
    expect((parsePromQL("round(x)") as PromQLCall).args).toHaveLength(1);
    expect((parsePromQL("round(x, 0.5)") as PromQLCall).args).toHaveLength(2);
    expect((parsePromQL("hour()") as PromQLCall).args).toHaveLength(0);
    expect(
      (parsePromQL('label_join(x, "d", ",", "a", "b", "c")') as PromQLCall)
        .args,
    ).toHaveLength(6);
  });

  test("a function's return type decides the expression's type", () => {
    expect(getPromQLValueType(parsePromQL("time()"))).toBe(
      PromQLValueType.Scalar,
    );
    expect(getPromQLValueType(parsePromQL("scalar(x)"))).toBe(
      PromQLValueType.Scalar,
    );
    expect(getPromQLValueType(parsePromQL("rate(x[5m])"))).toBe(
      PromQLValueType.InstantVector,
    );
  });

  test.each([
    [
      "rate(x)",
      "Argument 1 of rate() must be a range vector, but it is an instant vector. Add a range, such as [5m], after the selector.",
    ],
    ["abs(x[5m])", "must be an instant vector, but it is a range vector"],
    [
      "round(x, 1, 2)",
      "round() takes at most 2 arguments, but the query gives it 3",
    ],
    ["label_join(x)", "label_join() takes at least 3 arguments"],
    ["time(1)", "time() takes 0 arguments, but the query gives it 1"],
    ["clamp(x, 1)", "clamp() takes 3 arguments, but the query gives it 2"],
    ["nope(x)", 'Unknown function "nope"'],
    ["histogram_count(x)", "reads Prometheus native histograms"],
    [
      'label_replace(x, "a", "b", "c", 1)',
      "must be a string, but it is a scalar",
    ],
  ])("refuses %s", (query: string, message: string) => {
    expect(parseError(query).message).toContain(message);
  });
});

describe("PromQL literals and the whole query", () => {
  test.each([
    ["Inf", Infinity],
    ["-inf", -Infinity],
    ["0x10", 16],
    ["1e2", 100],
  ])("%s is the number %d", (query: string, value: number) => {
    expect((parsePromQL(query) as PromQLNumberLiteral).value).toBe(value);
  });

  test("NaN is a number", () => {
    expect(
      Number.isNaN((parsePromQL("NaN") as PromQLNumberLiteral).value),
    ).toBe(true);
  });

  test("a string is a string", () => {
    expect(getPromQLValueType(parsePromQL('"hello"'))).toBe(
      PromQLValueType.String,
    );
  });

  test("brackets keep their contents together", () => {
    const binary: PromQLBinary = parsePromQL("(a + b) * c") as PromQLBinary;

    expect(binary.operator).toBe(PromQLBinaryOperator.Mul);
    expect(binary.lhs.kind).toBe(PromQLNodeKind.Paren);
  });

  test("an empty query says what to write", () => {
    expect(parseError("   ").message).toContain("The query is empty.");
  });

  test("an error carries the position of the mistake", () => {
    const error: PromQLError = parseError("sum(rate(x[5m])) by job");

    expect(error.position).toEqual({ start: 20, end: 23 });
  });

  test("a long real-world query parses", () => {
    const query: string = `
      # p99 latency per route, from a histogram
      histogram_quantile(
        0.99,
        sum by (le, route) (
          rate(http_server_duration_seconds_bucket{job=~"api|web", route!=""}[5m])
        )
      ) > on (route) group_left ()
        (avg_over_time(slo_target{kind="latency"}[1h]) * 1.1)
    `;
    const expression: PromQLExpression = parsePromQL(query);

    expect(expression.kind).toBe(PromQLNodeKind.Binary);
  });

  test("a bracket right after group_left lists labels, as in Prometheus", () => {
    // Prometheus reads `group_left (x)` as the label x, never as an operand.
    expect(
      (parsePromQL("a > on (route) group_left (team) b") as PromQLBinary)
        .matching?.include,
    ).toEqual(["team"]);
    expect(parseError("a > on (route) group_left (b * 2)").message).toContain(
      '"," or ")"',
    );
  });
});
