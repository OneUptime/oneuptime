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

  test("leaves quotes and apostrophes alone", () => {
    /*
     * A single-quote rule would pair the apostrophe in "can't" with the
     * quote before db and destroy the stable half of the message. Pinned so
     * nobody adds one back.
     */
    expect(normalizeLogBodyToErrorPattern("can't reach 'db-primary'")).toBe(
      "can't reach 'db-primary'",
    );

    // ...and no double-quote rule either — see the JSON/logfmt tests below.
    expect(
      normalizeLogBodyToErrorPattern('unknown field "customerRef" in payload'),
    ).toBe('unknown field "customerRef" in payload');
  });

  test("a quoted value that genuinely varies still collapses, via its own rule", () => {
    /*
     * This is why no blanket quoted-span rule is needed: the specific rules
     * already mask the varying content, and more informatively — `"<uuid>"`
     * says more than `"<str>"`.
     */
    expect(
      normalizeLogBodyToErrorPattern(
        'user "3f2504e0-4f89-41d3-9a0c-0305e82c3301" not found',
      ),
    ).toBe('user "<uuid>" not found');

    expect(normalizeLogBodyToErrorPattern('column "user_id_42" missing')).toBe(
      'column "user_id_<num>" missing',
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

describe("normalizeLogBodyToErrorPattern — structured logs keep their message", () => {
  /*
   * In JSON and logfmt the human-readable message is a double-quoted VALUE.
   * A blanket `"[^"]*"` -> `"<str>"` rule therefore masks the only part
   * that identifies the error, merging unrelated failures into one Top
   * Errors row headed by whichever sample body argMax happened to pick.
   * These are the regression guards for that.
   */
  test("two different JSON errors stay two patterns", () => {
    const refused: string = normalizeLogBodyToErrorPattern(
      '{"level":"error","msg":"connection refused","attempt":3}',
    );
    const denied: string = normalizeLogBodyToErrorPattern(
      '{"level":"error","msg":"permission denied","attempt":3}',
    );

    expect(refused).not.toBe(denied);
    expect(refused).toContain("connection refused");
    expect(denied).toContain("permission denied");
  });

  test("the same JSON error at different attempt counts still collapses to one", () => {
    expect(
      normalizeLogBodyToErrorPattern(
        '{"level":"error","msg":"connection refused","attempt":3}',
      ),
    ).toBe(
      normalizeLogBodyToErrorPattern(
        '{"level":"error","msg":"connection refused","attempt":17}',
      ),
    );
  });

  test("two different logfmt errors stay two patterns", () => {
    const timeout: string = normalizeLogBodyToErrorPattern(
      'level=error msg="upstream timeout" upstream=10.0.0.1:8080',
    );
    const down: string = normalizeLogBodyToErrorPattern(
      'level=error msg="db down" upstream=10.0.0.2:5432',
    );

    expect(timeout).not.toBe(down);
    // ...while the host and port, which do vary, are still masked.
    expect(timeout).toContain("<ip>:<num>");
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

describe("getErrorPatternSearchText — the needle must exist in the raw body", () => {
  /*
   * A pattern is NOT a substring of the body it came from: the last rule
   * collapses `\s+` to one space, so any run spanning a line break reads
   * with a space where the body has `\n\t`. Handing that to
   * `body ILIKE '%...%'` matches nothing — the deep link lands the user on
   * an empty list, which is the precise failure this function exists to
   * avoid.
   */
  const STACK: string = [
    'java.lang.NullPointerException: Cannot invoke "OrderService.get()" because "order" is null',
    "\tat com.example.OrderService.process(OrderService.java:42)",
    "\tat com.example.Main.run(Main.java:11)",
  ].join("\n");

  test("a multi-line body yields a needle that is genuinely contained in it", () => {
    const needle: string = getErrorPatternSearchText(
      normalizeLogBodyToErrorPattern(STACK),
    );

    expect(needle.length).toBeGreaterThan(0);
    expect(STACK).toContain(needle);
  });

  test("a needle never spans a collapsed whitespace boundary unverified", () => {
    /*
     * Without a sample body to check against, only whitespace-free tokens
     * are safe — anything with a space in it might have been a newline.
     */
    const needle: string = getErrorPatternSearchText(
      normalizeLogBodyToErrorPattern(STACK),
    );

    expect(needle).not.toMatch(/\s/);
  });

  test("a sample body unlocks the longer multi-word needle when it really survives", () => {
    const singleLine: string = "connection refused to 10.0.0.1:5432";
    const pattern: string = normalizeLogBodyToErrorPattern(singleLine);

    // Verified against a real body, the stronger multi-word run is used.
    expect(getErrorPatternSearchText(pattern, { sampleBody: singleLine })).toBe(
      "connection refused to",
    );

    // ...and is still a genuine substring.
    expect(singleLine).toContain(
      getErrorPatternSearchText(pattern, { sampleBody: singleLine }),
    );
  });

  test("a sample body that does NOT contain the run falls back to a safe token", () => {
    const pattern: string = normalizeLogBodyToErrorPattern(STACK);

    const needle: string = getErrorPatternSearchText(pattern, {
      sampleBody: STACK,
    });

    expect(STACK).toContain(needle);
  });

  test("every candidate it can return is a substring of the body, across shapes", () => {
    const bodies: Array<string> = [
      STACK,
      "connection refused to 10.0.0.1:5432 after 30ms",
      'Traceback (most recent call last):\n  File "app.py", line 42, in run\n    raise ValueError("boom")',
      "nginx: [error] 1234#0: *5 upstream timed out while reading response header",
      '{"level":"error","msg":"connection refused","attempt":3}',
    ];

    for (const body of bodies) {
      const pattern: string = normalizeLogBodyToErrorPattern(body);

      for (const needle of [
        getErrorPatternSearchText(pattern),
        getErrorPatternSearchText(pattern, { sampleBody: body }),
      ]) {
        if (needle.length > 0) {
          expect(body).toContain(needle);
        }
      }
    }
  });
});

describe("getErrorPatternSearchText", () => {
  test("without a sample body, returns the longest SAFE (whitespace-free) run", () => {
    /*
     * "connection refused to" is longer, but a multi-word run is only
     * returned once a sample body proves it survived the whitespace
     * collapse — see the suite above.
     */
    expect(
      getErrorPatternSearchText(
        "connection refused to <ip>:<num> after <num>ms",
      ),
    ).toBe("connection");
  });

  test("strips the punctuation a placeholder leaves behind", () => {
    expect(
      getErrorPatternSearchText("<timestamp>: upstream timed out", {
        sampleBody: "2026-08-21T10:00:00Z: upstream timed out",
      }),
    ).toBe("upstream timed out");
  });

  test("returns empty when nothing selective survives", () => {
    // All placeholders — every literal run is punctuation.
    expect(getErrorPatternSearchText("<timestamp> <uuid> <num>")).toBe("");
    // Literal runs shorter than the minimum are not selective enough.
    expect(getErrorPatternSearchText("<num> ms <num>")).toBe("");
    expect(getErrorPatternSearchText("")).toBe("");
    expect(getErrorPatternSearchText(undefined)).toBe("");
  });

  test("honours a caller-supplied minimum length, in both call forms", () => {
    // Legacy positional form.
    expect(getErrorPatternSearchText("<num> ms <num>", 2)).toBe("ms");
    // ...and the options form.
    expect(
      getErrorPatternSearchText("<num> ms <num>", { minimumLength: 2 }),
    ).toBe("ms");
  });

  test("a placeholder-free pattern yields its longest safe token, or the whole run when verified", () => {
    expect(getErrorPatternSearchText("connection reset by peer")).toBe(
      "connection",
    );

    expect(
      getErrorPatternSearchText("connection reset by peer", {
        sampleBody: "connection reset by peer",
      }),
    ).toBe("connection reset by peer");
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
