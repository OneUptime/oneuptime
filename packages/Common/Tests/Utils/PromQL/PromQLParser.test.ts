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
import { compilePromQLRegex } from "../../../Utils/PromQL/PromQLRegex";
import LinearRegExp, {
  LinearRegExpMatch,
} from "../../../Utils/LinearRegExp/LinearRegExp";
import {
  clearLinearRegExpCache,
  getCachedPatternCount,
} from "../../../Utils/LinearRegExp/PatternCache";
import {
  PatternProblemError,
  PatternProblemReason,
} from "../../../Utils/LinearRegExp/PatternProblem";
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

  test("read RE2's (?i) flag group", () => {
    const regex: LinearRegExp = compilePromQLRegex("(?i)error").regex;

    expect(regex.flags).toBe("i");
    expect(regex.test("ERROR")).toBe(true);
    expect(regex.test("errors")).toBe(false);
  });

  test("read RE2's named groups", () => {
    const match: LinearRegExpMatch | null = compilePromQLRegex(
      "(?P<host>[a-z]+):\\d+",
      { captures: true },
    ).regex.exec("web:80");

    expect(match?.groups["host"]).toBe("web");
    expect(match?.captures).toEqual(["web"]);
  });

  test("read POSIX classes", () => {
    expect(compilePromQLRegex("[[:digit:]]+").regex.test("123")).toBe(true);
    expect(compilePromQLRegex("[[:digit:]]+").regex.test("12a")).toBe(false);
  });

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
  ])(
    "%s matching %j is %s, as JavaScript's RegExp answered for it",
    (pattern: string, value: string, matches: boolean) => {
      const regex: LinearRegExp = compilePromQLRegex(pattern).regex;

      expect(regex.test(value)).toBe(matches);
      expect(new RegExp(regex.source, regex.flags).test(value)).toBe(matches);
    },
  );

  test("a pattern that is not a regular expression throws a SyntaxError", () => {
    expect(refusalOf("(")).toBeInstanceOf(SyntaxError);
    expect(refusalOf("[[:digit:]")).toBeInstanceOf(SyntaxError);
    expect(refusalOf("a{2,1}")).toBeInstanceOf(SyntaxError);
  });

  test.each([
    ["(a)\\1", PatternProblemReason.BackReference],
    ["(?P<x>a)\\k<x>", PatternProblemReason.BackReference],
    [".{0,50000}", PatternProblemReason.TooLarge],
  ])(
    "%s is refused by the linear-time matcher",
    (pattern: string, reason: PatternProblemReason) => {
      const refusal: unknown = refusalOf(pattern);

      expect(refusal).toBeInstanceOf(PatternProblemError);
      expect((refusal as PatternProblemError).reason).toBe(reason);
    },
  );

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

  test("keep the pattern for engines that speak RE2", () => {
    expect(compilePromQLRegex("a|b").anchoredPattern).toBe("^(?:a|b)$");
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
      'up{path!~".{0,50000}"}',
      'The pattern ".{0,50000}" for the label "path" is too large to run. Shorten it, or repeat its parts fewer times.',
      { start: 9, end: 21 },
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
  });

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
