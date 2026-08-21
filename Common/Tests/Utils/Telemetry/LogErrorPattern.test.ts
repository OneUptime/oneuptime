import {
  LOG_ERROR_PATTERN_MAX_LENGTH,
  LOG_ERROR_PATTERN_PLACEHOLDERS,
  LOG_ERROR_PATTERN_RULES,
  LogErrorPatternRule,
  getErrorPatternSearchText,
  normalizeLogBodyToErrorPattern,
  truncateErrorPattern,
} from "../../../Utils/Telemetry/LogErrorPattern";
import { describe, expect, test } from "@jest/globals";

/*
 * These rules decide which log lines count as "the same error" on the
 * Insights page. Grouping too aggressively merges unrelated failures under
 * one headline; grouping too little scatters one incident across dozens of
 * one-count rows. Each test below pins one of those two failure directions.
 */

describe("normalizeLogBodyToErrorPattern — variable spans collapse", () => {
  test("collapses occurrences that differ only in their variable parts", () => {
    const first: string = normalizeLogBodyToErrorPattern(
      "connection refused to 10.0.0.14:5432 after 1200ms (attempt 3)",
    );
    const second: string = normalizeLogBodyToErrorPattern(
      "connection refused to 10.0.2.99:6543 after 87ms (attempt 11)",
    );

    expect(first).toBe(second);
    expect(first).toBe(
      "connection refused to <ip>:<num> after <num>ms (attempt <num>)",
    );
  });

  test("masks ISO timestamps before the numeric rule can shred them", () => {
    expect(
      normalizeLogBodyToErrorPattern("2026-08-21T10:15:30.123Z job failed"),
    ).toBe("<timestamp> job failed");

    // Space-separated and offset-suffixed forms are the same shape.
    expect(
      normalizeLogBodyToErrorPattern("2026-08-21 10:15:30+05:30 job failed"),
    ).toBe("<timestamp> job failed");
  });

  test("masks uuids, emails and long hex ids", () => {
    expect(
      normalizeLogBodyToErrorPattern(
        "user 3f2504e0-4f89-41d3-9a0c-0305e82c3301 not found",
      ),
    ).toBe("user <uuid> not found");

    expect(
      normalizeLogBodyToErrorPattern("bounce for alice.smith@example.co.uk"),
    ).toBe("bounce for <email>");

    expect(
      normalizeLogBodyToErrorPattern("trace 4bf92f3577b34da6a3ce929d0e0e4736"),
    ).toBe("trace <hex>");
  });

  test("masks whole URLs rather than their pieces", () => {
    /*
     * URL before email/ip matters: a URL carrying credentials and a host
     * would otherwise be rewritten into a mix of placeholders that no
     * longer reads as "a URL".
     */
    expect(
      normalizeLogBodyToErrorPattern(
        "GET https://user@10.0.0.1:8080/api/v2/items?id=9 failed",
      ),
    ).toBe("GET <url> failed");
  });

  test("masks double-quoted values but leaves apostrophes alone", () => {
    expect(
      normalizeLogBodyToErrorPattern('unknown field "customerRef" in payload'),
    ).toBe('unknown field "<str>" in payload');

    /*
     * A single-quote rule would pair the apostrophe in "can't" with the
     * quote before db and destroy the stable half of the message. Pinned so
     * nobody adds one back.
     */
    expect(normalizeLogBodyToErrorPattern("can't reach 'db-primary'")).toBe(
      "can't reach 'db-primary'",
    );
  });

  test("flattens a multi-line stack trace onto one groupable line", () => {
    const stack: string = [
      "TypeError: Cannot read properties of undefined",
      "    at handler (/srv/app/routes/order.js:42:17)",
      "    at process (/srv/app/lib/queue.js:118:9)",
    ].join("\n");

    expect(normalizeLogBodyToErrorPattern(stack)).toBe(
      "TypeError: Cannot read properties of undefined at handler (/srv/app/routes/order.js:<num>:<num>) at process (/srv/app/lib/queue.js:<num>:<num>)",
    );
  });

  test("truncates to the maximum pattern length and trims the cut edge", () => {
    const long: string = `boom ${"x".repeat(LOG_ERROR_PATTERN_MAX_LENGTH * 2)}`;

    const pattern: string = normalizeLogBodyToErrorPattern(long);

    expect(pattern.length).toBe(LOG_ERROR_PATTERN_MAX_LENGTH);
    expect(pattern.startsWith("boom ")).toBe(true);
  });

  test("two stack traces sharing a prefix but differing deep down still group", () => {
    const prefix: string = `${"NullPointerException at com.example.Very.Long.Frame.Name.method ".repeat(
      6,
    )}`;

    const a: string = normalizeLogBodyToErrorPattern(
      `${prefix} at first.frame`,
    );
    const b: string = normalizeLogBodyToErrorPattern(
      `${prefix} at second.frame`,
    );

    // The differing tail lies past the truncation point.
    expect(a).toBe(b);
  });
});

describe("normalizeLogBodyToErrorPattern — things that must NOT collapse", () => {
  test("keeps genuinely different messages apart", () => {
    expect(normalizeLogBodyToErrorPattern("connection refused")).not.toBe(
      normalizeLogBodyToErrorPattern("connection reset by peer"),
    );
  });

  test("short hex-looking words survive as themselves", () => {
    // 8 chars — below the 16-char floor the hex rule fires at.
    expect(normalizeLogBodyToErrorPattern("cache key deadbeef missed")).toBe(
      "cache key deadbeef missed",
    );
  });

  test("returns the empty pattern for absent, empty or whitespace bodies", () => {
    expect(normalizeLogBodyToErrorPattern(undefined)).toBe("");
    expect(normalizeLogBodyToErrorPattern(null)).toBe("");
    expect(normalizeLogBodyToErrorPattern("")).toBe("");
    expect(normalizeLogBodyToErrorPattern("   \n\t  ")).toBe("");
  });

  test("a body that is entirely a dollar-sign replacement pattern is inserted verbatim", () => {
    /*
     * String.replace treats `$&` in a replacement string specially. The
     * normalizer uses a replacer function so ClickHouse and JavaScript
     * insert identical text; this pins that the source text's own `$&`
     * survives untouched.
     */
    expect(normalizeLogBodyToErrorPattern("cost $& 42 usd")).toBe(
      "cost $& <num> usd",
    );
  });

  test("is idempotent — normalizing a pattern again changes nothing", () => {
    const pattern: string = normalizeLogBodyToErrorPattern(
      "timeout talking to 10.0.0.1:5432 after 30s",
    );

    expect(normalizeLogBodyToErrorPattern(pattern)).toBe(pattern);
  });
});

describe("LOG_ERROR_PATTERN_RULES — cross-engine constraints", () => {
  test("every rule compiles as a JavaScript regular expression", () => {
    for (const rule of LOG_ERROR_PATTERN_RULES) {
      expect(() => {
        return new RegExp(rule.pattern, "g");
      }).not.toThrow();
    }
  });

  test("no rule uses syntax RE2 cannot parse", () => {
    /*
     * ClickHouse's replaceRegexpAll runs on RE2, which has no lookaround
     * and no backreferences. A rule using either would work in the test
     * suite and throw in production, so the constraint is pinned here
     * rather than discovered on a dashboard.
     */
    for (const rule of LOG_ERROR_PATTERN_RULES) {
      expect(rule.pattern).not.toMatch(/\(\?=/);
      expect(rule.pattern).not.toMatch(/\(\?!/);
      expect(rule.pattern).not.toMatch(/\(\?<[=!]/);
      expect(rule.pattern).not.toMatch(/\\[1-9]/);
    }
  });

  test("no replacement contains a character either engine treats specially", () => {
    for (const rule of LOG_ERROR_PATTERN_RULES) {
      expect(rule.replacement).not.toContain("$");
      expect(rule.replacement).not.toContain("\\");
    }
  });

  test("rule names are unique", () => {
    const names: Array<string> = LOG_ERROR_PATTERN_RULES.map(
      (rule: LogErrorPatternRule): string => {
        return rule.name;
      },
    );

    expect(new Set(names).size).toBe(names.length);
  });

  test("whitespace collapse is last, so it flattens every earlier rewrite", () => {
    const last: LogErrorPatternRule =
      LOG_ERROR_PATTERN_RULES[LOG_ERROR_PATTERN_RULES.length - 1]!;

    expect(last.name).toBe("whitespace");
  });

  test("the url rule precedes the email and ip rules", () => {
    const indexOf: (name: string) => number = (name: string): number => {
      return LOG_ERROR_PATTERN_RULES.findIndex(
        (rule: LogErrorPatternRule): boolean => {
          return rule.name === name;
        },
      );
    };

    expect(indexOf("url")).toBeLessThan(indexOf("email"));
    expect(indexOf("url")).toBeLessThan(indexOf("ip"));
    expect(indexOf("timestamp")).toBeLessThan(indexOf("number"));
    expect(indexOf("hex")).toBeLessThan(indexOf("number"));
  });

  test("the exported placeholder list matches the rules that emit one", () => {
    expect(LOG_ERROR_PATTERN_PLACEHOLDERS).toEqual([
      "<timestamp>",
      "<uuid>",
      "<url>",
      "<email>",
      "<ip>",
      "<hex>",
      "<num>",
    ]);
  });
});

describe("getErrorPatternSearchText", () => {
  test("returns the longest literal run, which is what a body search can match", () => {
    expect(
      getErrorPatternSearchText(
        "connection refused to <ip>:<num> after <num>ms",
      ),
    ).toBe("connection refused to");
  });

  test("strips the punctuation a placeholder leaves behind", () => {
    expect(getErrorPatternSearchText("<timestamp>: upstream timed out")).toBe(
      "upstream timed out",
    );
  });

  test("returns empty when nothing selective survives", () => {
    // All placeholders — every literal run is punctuation.
    expect(getErrorPatternSearchText("<timestamp> <uuid> <num>")).toBe("");
    // Literal runs shorter than the minimum are not selective enough.
    expect(getErrorPatternSearchText("<num> ms <num>")).toBe("");
    expect(getErrorPatternSearchText("")).toBe("");
    expect(getErrorPatternSearchText(undefined)).toBe("");
  });

  test("honours a caller-supplied minimum length", () => {
    expect(getErrorPatternSearchText("<num> ms <num>", 2)).toBe("ms");
  });

  test("a pattern with no placeholders is its own search text", () => {
    expect(getErrorPatternSearchText("connection reset by peer")).toBe(
      "connection reset by peer",
    );
  });
});

describe("truncateErrorPattern", () => {
  test("collapses whitespace and appends an ellipsis past the limit", () => {
    expect(truncateErrorPattern("a very  long\nmessage here", 12)).toBe(
      "a very long...",
    );
  });

  test("leaves a short pattern untouched", () => {
    expect(truncateErrorPattern("short", 12)).toBe("short");
  });

  test("degrades safely on non-string input and non-positive limits", () => {
    expect(truncateErrorPattern(undefined, 10)).toBe("");
    expect(truncateErrorPattern("keep me", 0)).toBe("keep me");
  });
});
