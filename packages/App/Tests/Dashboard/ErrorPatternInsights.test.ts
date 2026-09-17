import { beforeAll, describe, expect, test } from "@jest/globals";
import type {
  ErrorPatternClassification,
  ErrorPatternEvent,
  ErrorPatternEvidence,
  ErrorPatternFinding,
} from "../../FeatureSet/Dashboard/src/Utils/ErrorPatternInsights";
import type {
  ErrorPatternCorrelation,
  SharedAttribute,
  TopErrorPatternRow,
} from "../../FeatureSet/Dashboard/src/Utils/LogsInsights";

/*
 * "What is this error, and what should I do about it?" — the layer the Top
 * Errors drill-down grew so that a user reading an error message is handed a
 * route forward rather than a count.
 *
 * Everything here is deterministic on purpose. An answer a user can point at
 * beats an answer they have to trust, it costs nothing per view, and it
 * works on a project with no AI provider configured; the model is involved
 * only when the user presses the button, and then it is handed this same
 * evidence rather than being asked to guess from the message alone.
 *
 * Two themes. The CLASSIFIER is checked for both recall (real production
 * strings land in the right family) and precedence (a message matching two
 * families lands in the narrower one). The FINDINGS are checked one rule at
 * a time against evidence built to trigger exactly that rule, and — just as
 * importantly — against evidence built to NOT trigger it, because a finding
 * that fires on noise is worse than no finding at all.
 */

type InsightsModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/ErrorPatternInsights");

let Insights: InsightsModule;

const WINDOW_START_MS: number = new Date("2026-08-21T00:00:00.000Z").getTime();
const WINDOW_END_MS: number = new Date("2026-08-21T04:00:00.000Z").getTime();
const MIDPOINT_MS: number = (WINDOW_START_MS + WINDOW_END_MS) / 2;

/*
 * OneUptimeDate pulls in Common/UI/Config transitively, which reads `window`
 * on load, so the browser stub has to exist before the deferred import.
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  Insights = await import(
    "../../FeatureSet/Dashboard/src/Utils/ErrorPatternInsights"
  );
});

function pattern(
  overrides: Partial<TopErrorPatternRow> = {},
): TopErrorPatternRow {
  return {
    pattern: "connection to <ip> failed",
    sampleBody: "connection to 10.0.0.4 failed",
    count: 40,
    firstSeenAt: new Date(MIDPOINT_MS),
    lastSeenAt: new Date(WINDOW_END_MS),
    resourceCount: 2,
    resourceIds: ["svc-a", "svc-b"],
    severities: ["Error"],
    traceCount: 3,
    sampleTraceIds: ["trace-1"],
    ...overrides,
  };
}

function correlation(
  overrides: Partial<ErrorPatternCorrelation> = {},
): ErrorPatternCorrelation {
  return {
    pattern: "connection to <ip> failed",
    bucketSizeInMinutes: 5,
    timeline: [
      { time: new Date(WINDOW_START_MS + 60_000), count: 20 },
      { time: new Date(MIDPOINT_MS + 60_000), count: 20 },
    ],
    coOccurringPatterns: [],
    attributes: [],
    resources: [
      {
        resourceId: "svc-a",
        resourceType: "Service",
        count: 25,
        lastSeenAt: null,
      },
      {
        resourceId: "svc-b",
        resourceType: "Service",
        count: 15,
        lastSeenAt: null,
      },
    ],
    traces: [],
    samples: [],
    ...overrides,
  };
}

function evidence(
  overrides: Partial<ErrorPatternEvidence> = {},
): ErrorPatternEvidence {
  return {
    pattern: pattern(),
    correlation: correlation(),
    trend: {
      direction: "steady",
      changePercent: 0,
      recentCount: 20,
      previousCount: 20,
    },
    sharedAttributes: [],
    occurrenceTotal: 40,
    windowStartMs: WINDOW_START_MS,
    windowEndMs: WINDOW_END_MS,
    events: [],
    resourceLabel: (resourceId: string): string => {
      return resourceId === "svc-a" ? "checkout-api" : resourceId;
    },
    ...overrides,
  };
}

function findingTexts(input: ErrorPatternEvidence): Array<string> {
  return Insights.buildErrorPatternFindings(input).map(
    (finding: ErrorPatternFinding): string => {
      return finding.text;
    },
  );
}

describe("classifyErrorPattern", () => {
  test.each([
    ["connect ETIMEDOUT 10.0.0.4:5432", "timeout"],
    ["context deadline exceeded", "timeout"],
    ["Error: socket hang up", "timeout"],
    ["connect ECONNREFUSED 127.0.0.1:6379", "connection-refused"],
    ["read ECONNRESET", "connection-refused"],
    ["getaddrinfo ENOTFOUND payments.internal", "dns"],
    ["dial tcp: lookup api: no such host", "dns"],
    ["x509: certificate has expired or is not yet valid", "tls"],
    ["SSL handshake failed", "tls"],
    ["401 Unauthorized", "auth"],
    ["permission denied while opening /var/lib/data", "auth"],
    ["429 Too Many Requests", "rate-limited"],
    ["JavaScript heap out of memory", "oom"],
    ["Container was OOMKilled", "oom"],
    ["write /tmp/upload: no space left on device", "disk-full"],
    ["FATAL: sorry, too many clients already", "db-capacity"],
    ["deadlock detected", "db-capacity"],
    ["502 Bad Gateway", "upstream-5xx"],
    [
      "upstream connect error or disconnect/reset before headers",
      "upstream-5xx",
    ],
    [
      "TypeError: Cannot read properties of undefined (reading 'id')",
      "null-dereference",
    ],
    ["java.lang.NullPointerException", "null-dereference"],
    [
      "runtime error: invalid memory address or nil pointer dereference",
      "null-dereference",
    ],
    ["SyntaxError: Unexpected token < in JSON at position 0", "parse"],
    [
      "ENOENT: no such file or directory, open '/etc/app/config.yml'",
      "not-found",
    ],
    ["panic: runtime error", "crash"],
    ["Unhandled rejection at Promise", "crash"],
  ])("classifies %j as %s", (message: string, expectedId: string) => {
    expect(Insights.classifyErrorPattern(message).id).toBe(expectedId);
  });

  /*
   * The negative table. An incidental digit run must never decide the family.
   *
   * The classifier reads the RAW sample body — the normalized pattern has
   * every number rewritten to a placeholder — so any line carrying a request
   * id, a duration, a byte count, an epoch-millisecond timestamp, a port, an
   * offset or a line number is exposed. Bare "429"/"500"/"404" substrings
   * used to steal those lines from the family that actually described them,
   * and the wrong family then reached both the panel and the Ask AI prompt.
   */
  test.each([
    ["Unhandled exception processing request 0HMQ9A4292BC", "crash"],
    [
      "Error: Cannot read properties of undefined (reading 'id') at line 4293",
      "null-dereference",
    ],
    ["panic: runtime error at offset 4040404", "crash"],
    ["java.lang.NullPointerException in worker 5002", "null-dereference"],
    ["Order 500123 not found in database", "not-found"],
  ])(
    "an incidental digit run in %j does not decide the family",
    (message: string, expectedId: string) => {
      expect(Insights.classifyErrorPattern("", message).id).toBe(expectedId);
    },
  );

  test("a line whose only signal is a bare number is left unclassified", () => {
    /*
     * Better to say "unrecognized" and offer the shape-based questions than
     * to assert a family off a duration that happens to read like a status.
     */
    expect(
      Insights.classifyErrorPattern("", "Job failed after 15000 ms").id,
    ).toBe("unclassified");
  });

  test.each([429, 500, 502, 503, 504, 401, 403, 404])(
    "a %s embedded in a longer number never classifies as its family",
    (code: number) => {
      const classification: ErrorPatternClassification =
        Insights.classifyErrorPattern(
          "",
          `connect ECONNREFUSED 10.0.0.4:${code}00`,
        );

      // The textual needle wins; the digits are part of a port.
      expect(classification.id).toBe("connection-refused");
    },
  );

  test("textual needles are tried before any status code", () => {
    /*
     * Two passes, and the order between them matters more than the order
     * within either: a line that says what went wrong in words is describing
     * itself, while a three-digit number is at best circumstantial.
     */
    expect(
      Insights.classifyErrorPattern("", "panic: runtime error, status 500").id,
    ).toBe("crash");
  });

  describe("matchesStatusCode", () => {
    test("requires the digits to stand alone", () => {
      expect(Insights.matchesStatusCode("status 429", 429)).toBe(true);
      expect(Insights.matchesStatusCode("status 14290", 429)).toBe(false);
      expect(Insights.matchesStatusCode("status 1429", 429)).toBe(false);
    });

    test("accepts the code beside its own reason phrase, with no keyword", () => {
      expect(Insights.matchesStatusCode("429 too many requests", 429)).toBe(
        true,
      );
      expect(Insights.matchesStatusCode("502 bad gateway", 502)).toBe(true);
    });

    test("accepts a status-ish word anywhere on the line", () => {
      expect(Insights.matchesStatusCode("http 503 from billing", 503)).toBe(
        true,
      );
      expect(Insights.matchesStatusCode("returned 404 for /orders", 404)).toBe(
        true,
      );
    });

    test("rejects a standalone number with no reason to read it as a status", () => {
      expect(Insights.matchesStatusCode("retried 429 times", 429)).toBe(false);
      expect(Insights.matchesStatusCode("processed 500 rows", 500)).toBe(false);
    });
  });

  test("prefers the narrower family when a message matches two", () => {
    /*
     * "connection timed out" is both a connection failure and a timeout. The
     * timeout reading is the actionable one — the target was reachable and
     * simply slow — so it has to win, which is what the rule ordering
     * encodes.
     */
    expect(Insights.classifyErrorPattern("connection timed out").id).toBe(
      "timeout",
    );
  });

  test("reads the real sample body in preference to the normalized pattern", () => {
    /*
     * Normalization replaces numbers and ids with placeholders, so a pattern
     * is a strictly worse haystack than the line it came from — "<num> Too
     * Many Requests" has lost the 429.
     */
    expect(
      Insights.classifyErrorPattern(
        "<num> too many requests for <str>",
        "429 Too Many Requests for /api/orders",
      ).id,
    ).toBe("rate-limited");
  });

  test("falls back to a usable answer for a message it does not recognize", () => {
    const classification: ErrorPatternClassification =
      Insights.classifyErrorPattern("widget frobnicator returned sad");

    expect(classification.id).toBe("unclassified");
    // The fallback still has to route the user somewhere.
    expect(classification.likelyCauses.length).toBeGreaterThan(0);
    expect(classification.whatToCheck.length).toBeGreaterThan(0);
  });

  test("survives an empty message rather than throwing out of render", () => {
    expect(Insights.classifyErrorPattern("").id).toBe("unclassified");
    expect(
      Insights.classifyErrorPattern(undefined as unknown as string).id,
    ).toBe("unclassified");
  });

  test("every family carries both causes and checks", () => {
    /*
     * The panel renders two columns from these. A family with an empty one
     * would render a heading over nothing.
     */
    for (const message of [
      "ETIMEDOUT",
      "ECONNREFUSED",
      "ENOTFOUND",
      "x509: certificate",
      "401 unauthorized",
      "429 too many requests",
      "out of memory",
      "no space left on device",
      "too many connections",
      "502 bad gateway",
      "NullPointerException",
      "unexpected token",
      "ENOENT",
      "panic:",
    ]) {
      const classification: ErrorPatternClassification =
        Insights.classifyErrorPattern(message);

      expect(classification.id).not.toBe("unclassified");
      expect(classification.summary.length).toBeGreaterThan(0);
      expect(classification.likelyCauses.length).toBeGreaterThan(0);
      expect(classification.whatToCheck.length).toBeGreaterThan(0);
    }
  });
});

/*
 * Declared out of line: the linter rejects a bare regex literal used with
 * .exec() inline (wrap-regex), and wrapping it in parens fights prettier.
 */
const BURST_SHARE_PERCENT: RegExp = /(\d+)%/;

describe("buildErrorPatternFindings", () => {
  test("leads with a deploy that landed as the error first appeared", () => {
    /*
     * The correlation the issue asked for by name. It is first in the list
     * because a deploy next to an onset is the single most narrowing fact
     * available on the page.
     */
    const findings: Array<ErrorPatternFinding> =
      Insights.buildErrorPatternFindings(
        evidence({
          events: [
            {
              kind: "change",
              label: "Deploy: checkout-api v412",
              timeMs: MIDPOINT_MS - 4 * 60_000,
            },
          ],
        }),
      );

    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.text).toContain("Deploy: checkout-api v412");
    expect(findings[0]?.text).toContain("4 minutes before");
  });

  test("reports a deploy far from the onset as context, not as a lead", () => {
    /*
     * Still worth a line — it is what the user would otherwise go looking
     * for by hand — but calling an hour-old deploy the cause would be a
     * finding that reads confident and is usually wrong.
     */
    const findings: Array<ErrorPatternFinding> =
      Insights.buildErrorPatternFindings(
        evidence({
          events: [
            {
              kind: "change",
              label: "Deploy: unrelated-service v9",
              timeMs: WINDOW_START_MS,
            },
          ],
        }),
      );

    const deployFinding: ErrorPatternFinding | undefined = findings.find(
      (finding: ErrorPatternFinding): boolean => {
        return finding.text.includes("unrelated-service");
      },
    );

    expect(deployFinding?.severity).toBe("info");
    expect(deployFinding?.text).toContain(
      "not close to when the error started",
    );
  });

  test("says nothing about deploy proximity when the error has no first-seen time", () => {
    const findings: Array<string> = findingTexts(
      evidence({
        pattern: pattern({ firstSeenAt: null }),
        events: [
          {
            kind: "change",
            label: "Deploy: checkout-api v412",
            timeMs: MIDPOINT_MS,
          },
        ],
      }),
    );

    expect(findings.join(" ")).not.toContain(
      "before this error was first seen",
    );
    // It is still surfaced as context rather than dropped.
    expect(findings.join(" ")).toContain("Deploy: checkout-api v412");
  });

  test("calls out an error that is new in this window", () => {
    expect(
      findingTexts(
        evidence({
          trend: {
            direction: "rising",
            changePercent: 100,
            recentCount: 40,
            previousCount: 0,
          },
        }),
      ).join(" "),
    ).toContain("New in this window");
  });

  test("calls out a meaningful rise, and stays quiet about drift", () => {
    expect(
      findingTexts(
        evidence({
          trend: {
            direction: "rising",
            changePercent: 220,
            recentCount: 32,
            previousCount: 10,
          },
        }),
      ).join(" "),
    ).toContain("Getting worse");

    /*
     * Rising by 12% is inside the noise band for a low-volume pattern. A
     * finding here would train the user to ignore the section.
     */
    expect(
      findingTexts(
        evidence({
          trend: {
            direction: "rising",
            changePercent: 12,
            recentCount: 21,
            previousCount: 19,
          },
        }),
      ).join(" "),
    ).not.toContain("Getting worse");
  });

  test("says so when an error is easing off", () => {
    expect(
      findingTexts(
        evidence({
          trend: {
            direction: "falling",
            changePercent: -60,
            recentCount: 8,
            previousCount: 20,
          },
        }),
      ).join(" "),
    ).toContain("Easing off");
  });

  test("distinguishes a burst from a steady trickle", () => {
    const bursty: string = findingTexts(
      evidence({
        correlation: correlation({
          timeline: [
            { time: new Date(WINDOW_START_MS + 60_000), count: 2 },
            { time: new Date(MIDPOINT_MS), count: 36 },
            { time: new Date(MIDPOINT_MS + 60_000), count: 2 },
          ],
        }),
      }),
    ).join(" ");

    expect(bursty).toContain("Bursty, not steady");
    expect(bursty).toContain("90%");

    // The default evidence is two even buckets — not a burst.
    expect(findingTexts(evidence()).join(" ")).not.toContain("Bursty");
  });

  test("reads a spike confined to a single bucket as the burst it is", () => {
    /*
     * The timeline query has no zero-fill, so an error that fired inside one
     * bucket comes back as exactly one row. Both shape rules used to skip
     * that case, so the SHARPEST possible spike produced strictly weaker
     * output than a blunter one — "Not enough data" and "steady, spread
     * out", which was then forwarded to the model in the Ask AI prompt.
     */
    const findings: string = findingTexts(
      evidence({
        occurrenceTotal: 500,
        pattern: pattern({ count: 500 }),
        trend: {
          direction: "rising",
          changePercent: 100,
          recentCount: 500,
          previousCount: 0,
        },
        correlation: correlation({
          timeline: [{ time: new Date(MIDPOINT_MS), count: 500 }],
        }),
      }),
    ).join(" ");

    expect(findings).toContain("Bursty, not steady");
    expect(findings).toContain("100%");
    expect(findings).not.toContain("Nothing about this error's shape");
  });

  test("concentration is monotonic: one bucket is never weaker than two", () => {
    /*
     * The property behind the bug, rather than the one example. For a fixed
     * occurrence count and window, concentrating the occurrences harder must
     * never produce a smaller burst share — and must never fall off the
     * finding entirely.
     */
    function burstShareOf(
      timeline: Array<{ time: Date; count: number }>,
    ): number {
      const text: string | undefined = findingTexts(
        evidence({
          occurrenceTotal: 500,
          pattern: pattern({ count: 500 }),
          correlation: correlation({ timeline }),
        }),
      ).find((finding: string): boolean => {
        return finding.startsWith("Bursty, not steady");
      });

      expect(text).toBeDefined();

      return Number(BURST_SHARE_PERCENT.exec(text as string)?.[1]);
    }

    const oneBucket: number = burstShareOf([
      { time: new Date(MIDPOINT_MS), count: 500 },
    ]);
    const twoBuckets: number = burstShareOf([
      { time: new Date(MIDPOINT_MS), count: 480 },
      { time: new Date(MIDPOINT_MS + 60_000), count: 20 },
    ]);

    expect(oneBucket).toBe(100);
    expect(oneBucket).toBeGreaterThanOrEqual(twoBuckets);
  });

  test("says it cannot read the shape rather than calling it steady", () => {
    /*
     * The honest fallback. Too few occurrences to judge is a different
     * statement from "steady and spread out", and the old text asserted the
     * second whenever it meant the first.
     */
    const findings: Array<ErrorPatternFinding> =
      Insights.buildErrorPatternFindings(
        evidence({
          occurrenceTotal: 2,
          pattern: pattern({ count: 2, traceCount: 1 }),
          correlation: correlation({
            timeline: [{ time: new Date(MIDPOINT_MS), count: 2 }],
            resources: [
              {
                resourceId: "a",
                resourceType: "Service",
                count: 1,
                lastSeenAt: null,
              },
              {
                resourceId: "b",
                resourceType: "Service",
                count: 1,
                lastSeenAt: null,
              },
            ],
          }),
        }),
      );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.text).toContain("not enough of this error");
    expect(findings[0]?.text).not.toContain("steady, spread out");
  });

  test("does not read a burst out of a handful of occurrences", () => {
    /*
     * With four occurrences, "all of them in one bucket" is what a rare
     * error looks like, not a signal.
     */
    expect(
      findingTexts(
        evidence({
          occurrenceTotal: 4,
          pattern: pattern({ count: 4 }),
          correlation: correlation({
            timeline: [
              { time: new Date(MIDPOINT_MS), count: 4 },
              { time: new Date(MIDPOINT_MS + 60_000), count: 0 },
            ],
          }),
        }),
      ).join(" "),
    ).not.toContain("Bursty");
  });

  test("names the single source an error is confined to", () => {
    expect(
      findingTexts(
        evidence({
          correlation: correlation({
            resources: [
              {
                resourceId: "svc-a",
                resourceType: "Service",
                count: 40,
                lastSeenAt: null,
              },
            ],
          }),
        }),
      ).join(" "),
    ).toContain("Confined to one source, checkout-api");
  });

  test("reads a spread across many sources as a shared cause", () => {
    expect(
      findingTexts(
        evidence({
          correlation: correlation({
            resources: [
              {
                resourceId: "a",
                resourceType: "Service",
                count: 15,
                lastSeenAt: null,
              },
              {
                resourceId: "b",
                resourceType: "Service",
                count: 13,
                lastSeenAt: null,
              },
              {
                resourceId: "c",
                resourceType: "Service",
                count: 12,
                lastSeenAt: null,
              },
            ],
          }),
        }),
      ).join(" "),
    ).toContain("Spread across 3 sources");
  });

  test("surfaces an attribute present on every occurrence", () => {
    const universal: SharedAttribute = {
      key: "host.name",
      value: "web-3",
      count: 40,
      coveragePercent: 100,
      isUniversal: true,
    };

    expect(
      findingTexts(evidence({ sharedAttributes: [universal] })).join(" "),
    ).toContain("Every occurrence carries host.name = web-3");
  });

  test("stays quiet about an attribute only some occurrences carry", () => {
    const partial: SharedAttribute = {
      key: "http.route",
      value: "/checkout",
      count: 12,
      coveragePercent: 30,
      isUniversal: false,
    };

    expect(
      findingTexts(evidence({ sharedAttributes: [partial] })).join(" "),
    ).not.toContain("Every occurrence carries");
  });

  test("pairs an error with something substantial firing alongside it", () => {
    expect(
      findingTexts(
        evidence({
          correlation: correlation({
            coOccurringPatterns: [
              {
                pattern: "pool exhausted",
                sampleBody: "connection pool exhausted",
                count: 30,
              },
            ],
          }),
        }),
      ).join(" "),
    ).toContain("connection pool exhausted");
  });

  test("ignores an incidental co-occurrence", () => {
    expect(
      findingTexts(
        evidence({
          correlation: correlation({
            coOccurringPatterns: [
              { pattern: "debug ping", sampleBody: "debug ping", count: 2 },
            ],
          }),
        }),
      ).join(" "),
    ).not.toContain("Fires alongside");
  });

  test("points out when there is no trace context to open at all", () => {
    expect(
      findingTexts(evidence({ pattern: pattern({ traceCount: 0 }) })).join(" "),
    ).toContain("no request context");

    expect(findingTexts(evidence()).join(" ")).not.toContain(
      "no request context",
    );
  });

  test("mentions incidents and alerts open at the time", () => {
    const findings: string = findingTexts(
      evidence({
        events: [
          {
            kind: "incident",
            label: "Incident: Checkout degraded",
            timeMs: MIDPOINT_MS,
          },
          {
            kind: "alert",
            label: "Alert: p95 latency",
            timeMs: MIDPOINT_MS,
          },
        ],
      }),
    ).join(" ");

    expect(findings).toContain("Incident: Checkout degraded");
    expect(findings).toContain("Alert: p95 latency");
  });

  test("says something honest when nothing stands out", () => {
    const findings: Array<ErrorPatternFinding> =
      Insights.buildErrorPatternFindings(
        evidence({
          correlation: correlation({
            resources: [
              {
                resourceId: "a",
                resourceType: "Service",
                count: 20,
                lastSeenAt: null,
              },
              {
                resourceId: "b",
                resourceType: "Service",
                count: 20,
                lastSeenAt: null,
              },
            ],
          }),
        }),
      );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.text).toContain("Nothing about this error's shape");
  });

  test("survives a correlation whose arrays are missing entirely", () => {
    /*
     * Every field arrives as untyped JSON from ClickHouse. A dashboard must
     * degrade, never throw out of render.
     */
    expect(() => {
      return Insights.buildErrorPatternFindings(
        evidence({
          correlation: {
            pattern: "x",
            bucketSizeInMinutes: 5,
          } as unknown as ErrorPatternCorrelation,
          sharedAttributes: undefined as unknown as Array<SharedAttribute>,
          events: undefined as unknown as Array<ErrorPatternEvent>,
        }),
      );
    }).not.toThrow();
  });
});

describe("buildErrorPatternPrompt", () => {
  function promptFor(input: ErrorPatternEvidence): string {
    const findings: Array<ErrorPatternFinding> =
      Insights.buildErrorPatternFindings(input);

    return Insights.buildErrorPatternPrompt(
      input,
      findings,
      Insights.classifyErrorPattern(
        input.pattern.pattern,
        input.pattern.sampleBody,
      ),
    );
  }

  test("carries the whole evidence pack, so the user re-describes nothing", () => {
    /*
     * The issue's actual ask: an AI answer about this error and this window
     * "without needing to separately open Ask AI and re-describe the
     * problem". Every section below is something the user would otherwise
     * have had to type back in by hand.
     */
    const prompt: string = promptFor(
      evidence({
        sharedAttributes: [
          {
            key: "host.name",
            value: "web-3",
            count: 40,
            coveragePercent: 100,
            isUniversal: true,
          },
        ],
        correlation: correlation({
          coOccurringPatterns: [
            {
              pattern: "pool exhausted",
              sampleBody: "connection pool exhausted",
              count: 30,
            },
          ],
          samples: [
            {
              logId: "1",
              time: new Date(MIDPOINT_MS),
              body: "connection to 10.0.0.4 failed",
              severityText: "Error",
              resourceId: "svc-a",
              traceId: "t1",
              spanId: "s1",
            },
          ],
        }),
        events: [
          {
            kind: "change",
            label: "Deploy: checkout-api v412",
            timeMs: MIDPOINT_MS - 60_000,
          },
        ],
      }),
    );

    expect(prompt).toContain("connection to 10.0.0.4 failed");
    expect(prompt).toContain("Where it happens:");
    expect(prompt).toContain("checkout-api");
    expect(prompt).toContain("Attributes the occurrences share:");
    expect(prompt).toContain("host.name = web-3");
    expect(prompt).toContain("Other errors in the same time buckets:");
    expect(prompt).toContain("connection pool exhausted");
    expect(prompt).toContain("What else happened in this window:");
    expect(prompt).toContain("Deploy: checkout-api v412");
    expect(prompt).toContain("Sample log lines:");
    expect(prompt).toContain("What already stands out:");
    expect(prompt).toContain(
      "What is the most likely root cause, and what should I check or change next?",
    );
  });

  test("states the family when the message was recognized, and stays silent when not", () => {
    expect(
      promptFor(
        evidence({
          pattern: pattern({
            sampleBody: "connect ETIMEDOUT 10.0.0.4:5432",
          }),
        }),
      ),
    ).toContain('It looks like a "Timed out" failure');

    expect(
      promptFor(
        evidence({
          pattern: pattern({ sampleBody: "widget frobnicator returned sad" }),
        }),
      ),
    ).not.toContain("It looks like a");
  });

  test("omits the sections it has nothing for rather than printing empty headings", () => {
    const prompt: string = promptFor(
      evidence({
        correlation: correlation({ resources: [], samples: [] }),
        events: [],
      }),
    );

    expect(prompt).not.toContain("Where it happens:");
    expect(prompt).not.toContain("Sample log lines:");
    expect(prompt).not.toContain("What else happened in this window:");
  });

  test("reports the occurrence count the correlation accounts for", () => {
    /*
     * Not the count the Top Errors list reported: the list and the drill-down
     * resolve a preset window against `now` independently, so on a short
     * preset the two can genuinely cover different windows.
     */
    expect(
      promptFor(
        evidence({ occurrenceTotal: 37, pattern: pattern({ count: 40 }) }),
      ),
    ).toContain("It occurred 37 times");
  });
});

describe("readEventKindFromLabel", () => {
  test("reads the kind back out of the marker label", () => {
    expect(Insights.readEventKindFromLabel("Incident: Checkout down")).toBe(
      "incident",
    );
    expect(Insights.readEventKindFromLabel("Alert: p95 latency")).toBe("alert");
    expect(Insights.readEventKindFromLabel("Deploy: api v9")).toBe("change");
    expect(Insights.readEventKindFromLabel("Config change: flags")).toBe(
      "change",
    );
  });

  test("treats anything unrecognized as a change rather than throwing", () => {
    expect(Insights.readEventKindFromLabel("")).toBe("change");
    expect(
      Insights.readEventKindFromLabel(undefined as unknown as string),
    ).toBe("change");
  });
});
