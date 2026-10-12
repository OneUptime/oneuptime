import LogAggregationService, {
  HistogramRequest,
  LogAttributeFilterValue,
} from "../../../Server/Services/LogAggregationService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  escapeWildcards,
  hasWildcard,
  toLikePattern,
  unescapeWildcards,
} from "../../../Types/BaseDatabase/WildcardPattern";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SearchToken,
  SearchTokenType,
  SearchValueOperator,
  SearchValuePredicate,
  buildSearchTokenGlob,
  buildSearchTokenValue,
  parseSearchQuery,
  predicateToSerializedValue,
} from "../../../Types/Telemetry/TelemetrySearchQuery";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * VALUES AND GLOBS WRITTEN INTO THE TELEMETRY SEARCH LANGUAGE.
 *
 * A value clicked in a facet, copied off a log row or pinned on a resource
 * page is written back into a search string with buildSearchTokenValue, and
 * a glob from an attribute filter form with buildSearchTokenGlob. The search
 * bar then parses the string, and the explorers compile what it means into
 * ClickHouse queries whose values are bound as parameters.
 *
 *   - A literal escapes, in one pass, every character the value grammar
 *     reads as syntax wherever it sits - "\", "*", "?" and the quote - then
 *     a leading operator character and a wrapping bracket pair. The output
 *     is byte for byte what it was before (escapeWildcards, then the quotes),
 *     proven here on 20,000 generated values.
 *   - A glob keeps its own escapes and wildcards, escapes every other quote,
 *     and doubles a backslash that ends it. Its locked filter chips used to
 *     escape quotes only: a glob holding an escaped quote ("a\"b c*") or
 *     ending in a literal backslash with a space in it ("a b\") gave a token
 *     whose closing quote was escaped, so the token ran on into the filters
 *     after it.
 *
 *   - Both quote a token that leaves a bracket open ("f(x", ":)("): the
 *     tokenizer counts brackets wherever they are, so such a token took the
 *     space after it, and the filters after that, into itself.
 *
 * Every token is held to its meaning by parsing it back in a search string
 * with another filter after it: the value or glob means what it meant, and
 * the filter after it is still its own.
 */

const KEY: string = "k8s.ns";
const AFTER: string = "severity:error";
const LOG_FIELD_KEYS: Set<string> = new Set<string>(["severity"]);
const LOG_ALIASES: Record<string, string> = { severity: "severityText" };

// The tokens a search string parses into, as the logs explorer reads it.
function parse(search: string): Array<SearchToken> {
  return parseSearchQuery(search, {
    knownFieldKeys: LOG_FIELD_KEYS,
    fieldAliases: LOG_ALIASES,
  });
}

/*
 * What a glob means: a pattern (the LIKE pattern it compiles to) when it has
 * a wildcard, otherwise the literal text its escapes stand for.
 */
function globMeaning(glob: string): [string, string] {
  return hasWildcard(glob)
    ? ["pattern", toLikePattern(glob)]
    : ["text", unescapeWildcards(glob)];
}

// What a parsed predicate means, read the same way.
function predicateMeaning(predicate: SearchValuePredicate): [string, string] {
  if (predicate.operator === SearchValueOperator.Wildcard) {
    return ["pattern", toLikePattern(predicate.value)];
  }

  if (predicate.operator === SearchValueOperator.Equals) {
    return ["text", predicate.value];
  }

  return [predicate.operator, predicate.value];
}

/*
 * The token spelled the way it was before this change, as an independent
 * oracle: escapeWildcards, then every quote, then the leading operator and
 * the wrapping brackets, then quotes around whitespace. Written with split
 * and join, and the position checks by hand.
 */
const OLD_LEADING_OPERATORS: string = "-~!<>";
const WHITESPACE: RegExp = /\s/;

function oldPositioned(escaped: string): string {
  let token: string = escaped;

  if (token.length > 0 && OLD_LEADING_OPERATORS.includes(token[0]!)) {
    token = `\\${token}`;
  }

  const wrapped: boolean =
    token.length >= 2 &&
    !token.includes("\n") &&
    !token.includes("\r") &&
    !token.includes(String.fromCharCode(0x2028)) &&
    !token.includes(String.fromCharCode(0x2029)) &&
    ((token.startsWith("(") && token.endsWith(")")) ||
      (token.startsWith("[") && token.endsWith("]")));

  if (wrapped) {
    token = `\\${token}`;
  }

  return WHITESPACE.test(token) ? `"${token}"` : token;
}

function oldLiteralToken(literal: string): string {
  return oldPositioned(escapeWildcards(literal).split('"').join('\\"'));
}

function oldGlobToken(glob: string): string {
  return oldPositioned(glob.split('"').join('\\"'));
}

const BRACKET: RegExp = /[()[\]]/;

// Whether a token, followed by another filter, reads back as `meaning`.
function readsBackAs(token: string, meaning: [string, string]): boolean {
  const tokens: Array<SearchToken> = parse(`@${KEY}:${token} ${AFTER}`);

  return (
    tokens.length === 2 &&
    tokens[0]!.key === KEY &&
    JSON.stringify(predicateMeaning(tokens[0]!.predicate)) ===
      JSON.stringify(meaning) &&
    tokens[1]!.key === "severityText" &&
    tokens[1]!.predicate.value === "error"
  );
}

const LITERAL_ALPHABET: ReadonlyArray<string> = [
  "a",
  "B",
  "7",
  " ",
  "\\",
  "*",
  "?",
  '"',
  "~",
  "!",
  "<",
  ">",
  "-",
  "(",
  ")",
  "[",
  "]",
  ",",
  " OR ",
  ":",
  "@",
  "%",
  "_",
  "\t",
  "é",
];

const GLOB_ALPHABET: ReadonlyArray<string> = [
  ...LITERAL_ALPHABET,
  "\\*",
  "\\?",
  '\\"',
  "\\\\",
];

describe("buildSearchTokenValue - a literal value", () => {
  test("ordinary values are spelled as they always were", () => {
    const expected: Record<string, string> = {
      "web-01": "web-01",
      "/api/*": "/api/\\*",
      "a b": '"a b"',
      '"foo"': '\\"foo\\"',
      "~foo": "\\~foo",
      "!foo": "\\!foo",
      "-foo": "\\-foo",
      "(foo)": "\\(foo)",
      "[foo]": "\\[foo]",
      "a?b": "a\\?b",
      "100%": "100%",
      "C:\\Temp\\": "C:\\\\Temp\\\\",
      'say "hi" now': '"say \\"hi\\" now"',
      "svc~canary": "svc~canary",
      "": "",
    };

    for (const [literal, token] of Object.entries(expected)) {
      expect([literal, buildSearchTokenValue(literal)]).toEqual([
        literal,
        token,
      ]);
    }
  });

  test("every generated value is spelled byte for byte as before, wherever that spelling read back", () => {
    const changed: Array<string> = [];

    for (const literal of generatedTexts(20000, 7777, LITERAL_ALPHABET, 12)) {
      if (literal.trim().length === 0) {
        continue;
      }

      const oldToken: string = oldLiteralToken(literal);

      if (readsBackAs(oldToken, ["text", literal])) {
        expect([literal, buildSearchTokenValue(literal)]).toEqual([
          literal,
          oldToken,
        ]);
        continue;
      }

      changed.push(literal);
    }

    // Only values that left a bracket open, or ended in ":", read back wrong.
    expect(changed.length).toBeGreaterThan(0);

    for (const literal of changed) {
      expect([literal, BRACKET.test(literal) || literal.endsWith(":")]).toEqual(
        [literal, true],
      );
      expect([literal, buildSearchTokenValue(literal)]).toEqual([
        literal,
        `"${oldLiteralToken(literal)}"`,
      ]);
    }
  });

  test("a value ending in a colon is quoted, so it cannot take the next word as its own", () => {
    expect(buildSearchTokenValue("Error:")).toBe('"Error:"');
    expect(buildSearchTokenValue(":")).toBe('":"');
    expect(buildSearchTokenValue("a:b")).toBe("a:b");

    for (const literal of ["Error:", ":", "http://", "C:\\:"]) {
      expect(
        readsBackAs(buildSearchTokenValue(literal), ["text", literal]),
      ).toBe(true);
    }
  });

  test("a bracket pair wraps a value only when no line ending is inside it, as before", () => {
    expect(buildSearchTokenValue("(a b)")).toBe('"\\(a b)"');
    expect(buildSearchTokenValue("(a\nb)")).toBe('"(a\nb)"');
    expect(buildSearchTokenValue("[a\rb]")).toBe('"[a\rb]"');
    expect(buildSearchTokenValue(`(a${String.fromCharCode(0x2028)}b)`)).toBe(
      `"(a${String.fromCharCode(0x2028)}b)"`,
    );
    expect(buildSearchTokenValue("()")).toBe("\\()");
    expect(buildSearchTokenValue("(")).toBe('"("');
  });

  test("a value that leaves a bracket open is quoted, and a balanced one is not", () => {
    expect(buildSearchTokenValue("f(x")).toBe('"f(x"');
    expect(buildSearchTokenValue(":)(")).toBe('":)("');
    expect(buildSearchTokenValue("a[b")).toBe('"a[b"');
    expect(buildSearchTokenValue("items(1)")).toBe("items(1)");
    expect(buildSearchTokenValue("a)b")).toBe("a)b");
    expect(buildSearchTokenValue("(x)")).toBe("\\(x)");

    for (const literal of ["f(x", ":)(", "a[b", "x(y[z"]) {
      expect(
        readsBackAs(buildSearchTokenValue(literal), ["text", literal]),
      ).toBe(true);
    }
  });

  test("every generated value parses back as itself, and the filter after it stays its own", () => {
    for (const literal of generatedTexts(20000, 9999, LITERAL_ALPHABET, 12)) {
      if (literal.trim().length === 0) {
        continue;
      }

      const tokens: Array<SearchToken> = parse(
        `@${KEY}:${buildSearchTokenValue(literal)} ${AFTER}`,
      );

      expect([literal, tokens.length]).toEqual([literal, 2]);
      expect([literal, tokens[0]!.type, tokens[0]!.key]).toEqual([
        literal,
        SearchTokenType.Attribute,
        KEY,
      ]);
      expect([literal, predicateMeaning(tokens[0]!.predicate)]).toEqual([
        literal,
        ["text", literal],
      ]);
      expect([literal, tokens[1]!.key, tokens[1]!.predicate.value]).toEqual([
        literal,
        "severityText",
        "error",
      ]);
    }
  });

  test("a value ending in a backslash cannot escape the quote that closes it", () => {
    const token: string = buildSearchTokenValue("C:\\Program Files\\");
    const tokens: Array<SearchToken> = parse(`@${KEY}:${token} ${AFTER}`);

    expect(token).toBe('"C:\\\\Program Files\\\\"');
    expect(tokens).toHaveLength(2);
    expect(tokens[0]!.predicate.value).toBe("C:\\Program Files\\");
    expect(tokens[1]!.predicate.value).toBe("error");
  });
});

describe("buildSearchTokenGlob - a glob", () => {
  test("a glob is spelled as before wherever that spelling read back as the glob", () => {
    let unchanged: number = 0;

    for (const glob of generatedTexts(20000, 31337, GLOB_ALPHABET, 12)) {
      if (glob.trim().length === 0 || glob.trim() === "*") {
        continue;
      }

      const oldToken: string = oldGlobToken(glob);

      if (readsBackAs(oldToken, globMeaning(glob))) {
        expect([glob, buildSearchTokenGlob(glob)]).toEqual([glob, oldToken]);
        unchanged++;
      }
    }

    expect(unchanged).toBeGreaterThan(10000);
  });

  test("a glob that leaves a bracket open is quoted", () => {
    expect(buildSearchTokenGlob("f(*")).toBe('"f(*"');
    expect(buildSearchTokenGlob("f(*)")).toBe("f(*)");
    expect(readsBackAs(buildSearchTokenGlob("f(*"), globMeaning("f(*"))).toBe(
      true,
    );
  });

  test("ordinary globs keep their wildcards and escapes", () => {
    expect(buildSearchTokenGlob("api-*")).toBe("api-*");
    expect(buildSearchTokenGlob("web-?")).toBe("web-?");
    expect(buildSearchTokenGlob("a b*")).toBe('"a b*"');
    expect(buildSearchTokenGlob("a\\*b*")).toBe("a\\*b*");
    expect(buildSearchTokenGlob("~tmp*")).toBe("\\~tmp*");
    expect(buildSearchTokenGlob("(x)*")).toBe("(x)*");
    expect(buildSearchTokenGlob("(x*)")).toBe("\\(x*)");
  });

  test("an escaped quote stays one escape, and a bare quote is escaped", () => {
    expect(buildSearchTokenGlob('a\\"b c*')).toBe('"a\\"b c*"');
    expect(buildSearchTokenGlob('a"b c*')).toBe('"a\\"b c*"');
  });

  test("a backslash that ends a glob is doubled", () => {
    expect(buildSearchTokenGlob("a b\\")).toBe('"a b\\\\"');
    expect(buildSearchTokenGlob("*\\")).toBe("*\\\\");
    expect(buildSearchTokenGlob("*\\\\")).toBe("*\\\\");
  });

  test("the two globs the old spelling broke now leave the next filter its own", () => {
    for (const glob of ['a\\"b c*', "a b\\", '*x\\" y', "C:\\Temp *\\"]) {
      const tokens: Array<SearchToken> = parse(
        `@${KEY}:${buildSearchTokenGlob(glob)} ${AFTER}`,
      );
      const oldTokens: Array<SearchToken> = parse(
        `@${KEY}:${oldGlobToken(glob)} ${AFTER}`,
      );

      expect([glob, tokens.length]).toEqual([glob, 2]);
      expect([glob, predicateMeaning(tokens[0]!.predicate)]).toEqual([
        glob,
        globMeaning(glob),
      ]);
      expect([glob, tokens[1]!.predicate.value]).toEqual([glob, "error"]);

      // As it was spelled before, the filter after it was lost or misread.
      const oldKeptBoth: boolean =
        oldTokens.length === 2 &&
        JSON.stringify(predicateMeaning(oldTokens[0]!.predicate)) ===
          JSON.stringify(globMeaning(glob)) &&
        oldTokens[1]!.predicate.value === "error";

      expect([glob, oldKeptBoth]).toEqual([glob, false]);
    }
  });

  test("every generated glob means what it meant, and the filter after it stays its own", () => {
    for (const glob of generatedTexts(20000, 2024, GLOB_ALPHABET, 12)) {
      // "*" alone reads as "the key has a value", as it always has.
      if (glob.trim().length === 0 || glob.trim() === "*") {
        continue;
      }

      const tokens: Array<SearchToken> = parse(
        `@${KEY}:${buildSearchTokenGlob(glob)} ${AFTER}`,
      );

      expect([glob, tokens.length]).toEqual([glob, 2]);
      expect([glob, predicateMeaning(tokens[0]!.predicate)]).toEqual([
        glob,
        globMeaning(glob),
      ]);
      expect([glob, tokens[1]!.predicate.value]).toEqual([glob, "error"]);
    }
  });
});

describe("the values a search string carries reach ClickHouse as bound parameters", () => {
  const PROJECT_ID: ObjectID = ObjectID.generate();

  function histogramFor(value: unknown): Statement {
    const request: HistogramRequest = {
      projectId: PROJECT_ID,
      startTime: new Date("2026-03-01T00:00:00.000Z"),
      endTime: new Date("2026-03-12T00:00:00.000Z"),
      bucketSizeInMinutes: 60,
      attributes: { [KEY]: value as LogAttributeFilterValue },
    };

    return (LogAggregationService as any).buildHistogramStatement(request);
  }

  const MARKER: string = "zq'\\\"x";

  test.each([
    [
      "a literal",
      (text: string): string => {
        return buildSearchTokenValue(text);
      },
    ],
    [
      "a glob",
      (text: string): string => {
        return buildSearchTokenGlob(`${escapeWildcards(text)}*`);
      },
    ],
    [
      "a contains",
      (text: string): string => {
        return `~${buildSearchTokenValue(text)}`;
      },
    ],
  ] as Array<[string, (text: string) => string]>)(
    "%s: the text is in the parameters, never in the query",
    (_name: string, spell: (text: string) => string) => {
      const text: string = `a ${MARKER} b`;
      const tokens: Array<SearchToken> = parse(`@${KEY}:${spell(text)}`);

      expect(tokens).toHaveLength(1);

      const value: JSONObject | string = predicateToSerializedValue(
        tokens[0]!.predicate,
      );
      const statement: Statement = histogramFor(value);
      const parameters: string = JSON.stringify(
        Object.values(statement.query_params),
      );

      expect(statement.query).not.toContain("zq");
      expect(parameters).toContain("zq'");
    },
  );
});
