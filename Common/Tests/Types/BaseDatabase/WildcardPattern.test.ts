import {
  escapeWildcards,
  hasWildcard,
  toLikePattern,
  unescapeWildcards,
} from "../../../Types/BaseDatabase/WildcardPattern";
import { describe, expect, test } from "@jest/globals";

/*
 * Glob → LIKE translation. This is the load-bearing piece of the whole
 * wildcard feature: it is the ONE place that decides which `%` and `_` in a
 * pattern are wildcards the user asked for and which are literal characters
 * that happened to be in their data.
 *
 * Getting the order wrong is silent in both directions — escaping after
 * substitution neuters the wildcards (every search matches nothing), escaping
 * never (the pre-existing bug in the aggregation builders) turns a value like
 * "100%" into a match-anything pattern. Both look like working code.
 */

describe("toLikePattern - wildcards", () => {
  test("a trailing star becomes a prefix match", () => {
    expect(toLikePattern("a*")).toBe("a%");
  });

  test("a leading star becomes a suffix match", () => {
    expect(toLikePattern("*a")).toBe("%a");
  });

  test("an infix star keeps both anchors", () => {
    expect(toLikePattern("a*b")).toBe("a%b");
  });

  test("several stars each translate", () => {
    expect(toLikePattern("*a*b*")).toBe("%a%b%");
  });

  test("a bare star matches anything", () => {
    expect(toLikePattern("*")).toBe("%");
  });

  test("a question mark is exactly one character", () => {
    expect(toLikePattern("a?c")).toBe("a_c");
  });

  test("a value with no metacharacters is unchanged", () => {
    expect(toLikePattern("abc")).toBe("abc");
  });

  test("the empty glob is the empty pattern, not a match-anything", () => {
    expect(toLikePattern("")).toBe("");
  });
});

describe("toLikePattern - LIKE metacharacters in the user's own text", () => {
  test("a literal percent is escaped, so 100% does not match everything", () => {
    expect(toLikePattern("100%")).toBe("100\\%");
  });

  test("a literal underscore is escaped, so req_id does not match reqXid", () => {
    expect(toLikePattern("req_id")).toBe("req\\_id");
  });

  test("a literal backslash is escaped", () => {
    expect(toLikePattern("a\\\\b")).toBe("a\\\\b");
  });

  test("metacharacters and wildcards coexist in one pattern", () => {
    expect(toLikePattern("100%*")).toBe("100\\%%");
  });
});

describe("toLikePattern - escapes", () => {
  test("an escaped star is a literal asterisk", () => {
    expect(toLikePattern("a\\*b")).toBe("a*b");
  });

  test("an escaped question mark is a literal question mark", () => {
    expect(toLikePattern("a\\?b")).toBe("a?b");
  });

  test("an escaped backslash is one literal backslash, escaped for LIKE", () => {
    expect(toLikePattern("a\\\\b")).toBe("a\\\\b");
  });

  test("an escaped percent is still a literal percent", () => {
    expect(toLikePattern("a\\%b")).toBe("a\\%b");
  });

  test("a trailing lone backslash is the user's own backslash", () => {
    expect(toLikePattern("a\\")).toBe("a\\\\");
  });

  test("escaping does not leak into the next character", () => {
    expect(toLikePattern("\\**")).toBe("*%");
  });
});

describe("hasWildcard", () => {
  test.each([
    ["a*", true],
    ["*a", true],
    ["a*b", true],
    ["*", true],
    ["a?b", true],
    ["abc", false],
    ["", false],
    ["100%", false],
    ["req_id", false],
  ])("hasWildcard(%p) is %p", (value: string, expected: boolean) => {
    expect(hasWildcard(value)).toBe(expected);
  });

  test("an escaped star is NOT a wildcard", () => {
    expect(hasWildcard("a\\*b")).toBe(false);
  });

  test("an escaped star followed by a real one still is", () => {
    expect(hasWildcard("a\\**")).toBe(true);
  });

  test("a lone trailing backslash does not read past the end", () => {
    expect(hasWildcard("a\\")).toBe(false);
  });
});

describe("escapeWildcards / unescapeWildcards", () => {
  test("escaping makes a data value glob-inert", () => {
    expect(hasWildcard(escapeWildcards("/api/*"))).toBe(false);
  });

  test("an escaped data value compiles back to itself", () => {
    expect(toLikePattern(escapeWildcards("/api/*"))).toBe("/api/*");
  });

  test("unescape recovers the literal the user meant", () => {
    expect(unescapeWildcards("a\\*b")).toBe("a*b");
  });

  test("escape then unescape is the identity", () => {
    for (const value of ["a*b", "a?b", "a\\b", "plain", "/api/*", "100%"]) {
      expect(unescapeWildcards(escapeWildcards(value))).toBe(value);
    }
  });

  test("unescaping a value with no escapes changes nothing", () => {
    expect(unescapeWildcards("plain value")).toBe("plain value");
  });
});
