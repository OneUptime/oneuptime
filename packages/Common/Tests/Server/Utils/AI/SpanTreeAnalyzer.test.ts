import SpanTreeAnalyzer, {
  AnalyzableSpan,
} from "../../../../Server/Utils/AI/PerfEvidence/SpanTreeAnalyzer";
import {
  PerformanceFinding,
  PerformanceFindingType,
} from "../../../../Types/AI/CodeFixTaskContext";
import { describe, expect, test } from "@jest/globals";

/*
 * The deterministic span-tree analyzer behind the FixPerformance recipe —
 * the recipe's verifier-grade evidence. These tests lock in the three
 * detectors' thresholds, the name/statement normalization that makes
 * "near-identical" mechanical, the self-time semantics that keep the root
 * span from trivially dominating, the N+1-suppresses-sequential rule, and
 * that healthy traces produce NO findings (the trigger's honesty gate).
 */

type SpanArgs = {
  id: string;
  parent?: string;
  name: string;
  start?: number;
  end?: number;
  durationMs?: number;
  attributes?: Record<string, string>;
};

function span(args: SpanArgs): AnalyzableSpan {
  return {
    spanId: args.id,
    parentSpanId: args.parent,
    name: args.name,
    startMs: args.start,
    endMs: args.end,
    durationMs: args.durationMs,
    attributes: args.attributes,
  };
}

describe("SpanTreeAnalyzer.normalizeSpanName", () => {
  test("digit runs normalize so per-item operations compare equal", () => {
    expect(SpanTreeAnalyzer.normalizeSpanName("GET /users/42")).toBe(
      SpanTreeAnalyzer.normalizeSpanName("GET /users/9917"),
    );
  });

  test("uuids collapse to a single placeholder", () => {
    expect(
      SpanTreeAnalyzer.normalizeSpanName(
        "process 3f2b8c4d-1a2b-4c3d-9e8f-112233445566",
      ),
    ).toBe("process {id}");
  });

  test("long hex ids collapse before digit-run replacement can shred them", () => {
    expect(SpanTreeAnalyzer.normalizeSpanName("span abcdef12345678")).toBe(
      "span {id}",
    );
  });

  test("whitespace is collapsed", () => {
    expect(SpanTreeAnalyzer.normalizeSpanName("  SELECT   users  ")).toBe(
      "SELECT users",
    );
  });
});

describe("SpanTreeAnalyzer.normalizeDbStatement", () => {
  test("numeric literals normalize so id-only differences compare equal", () => {
    expect(
      SpanTreeAnalyzer.normalizeDbStatement(
        "SELECT * FROM users WHERE id = 42",
      ),
    ).toBe(
      SpanTreeAnalyzer.normalizeDbStatement(
        "SELECT * FROM users WHERE id = 97",
      ),
    );
  });

  test("string literals normalize", () => {
    expect(
      SpanTreeAnalyzer.normalizeDbStatement(
        "SELECT * FROM users WHERE name = 'alice'",
      ),
    ).toBe(
      SpanTreeAnalyzer.normalizeDbStatement(
        "SELECT * FROM users WHERE name = 'bob'",
      ),
    );
  });

  test("IN lists of different lengths compare equal", () => {
    expect(
      SpanTreeAnalyzer.normalizeDbStatement(
        "SELECT * FROM t WHERE id IN (1, 2, 3)",
      ),
    ).toBe(
      SpanTreeAnalyzer.normalizeDbStatement("SELECT * FROM t WHERE id IN (5)"),
    );
  });
});

describe("SpanTreeAnalyzer.analyzeTrace — N+1 detection", () => {
  function nPlusOneTrace(childCount: number): Array<AnalyzableSpan> {
    // Root 0..1000; children sequential 100ms each starting at 0.
    const spans: Array<AnalyzableSpan> = [
      span({ id: "root", name: "GET /orders", start: 0, end: 1000 }),
    ];
    for (let i: number = 0; i < childCount; i++) {
      spans.push(
        span({
          id: `child-${i}`,
          parent: "root",
          name: `SELECT users ${i}`,
          start: i * 100,
          end: i * 100 + 100,
          attributes: {
            "db.system": "postgresql",
            "db.statement": `SELECT * FROM users WHERE id = ${i}`,
          },
        }),
      );
    }
    return spans;
  }

  test("5+ near-identical siblings with near-identical statements fire exactly one N+1 finding", () => {
    const findings: Array<PerformanceFinding> = SpanTreeAnalyzer.analyzeTrace(
      nPlusOneTrace(5),
    );

    expect(findings).toHaveLength(1);
    const finding: PerformanceFinding = findings[0]!;
    expect(finding.findingType).toBe(PerformanceFindingType.NPlusOneQuery);
    expect(finding.spanCount).toBe(5);
    expect(finding.combinedDurationMs).toBe(500);
    expect(finding.percentOfTrace).toBe(50);
    expect(finding.parentSpanName).toBe("GET /orders");
    expect(finding.normalizedSpanName).toBe("SELECT users {n}");
    expect(finding.normalizedDbStatement).toBe(
      "SELECT * FROM users WHERE id = ?",
    );
    expect(finding.dbSystem).toBe("postgresql");
    // Evidence carries the real numbers.
    expect(finding.evidence).toContain("5 sibling spans");
    expect(finding.evidence).toContain("500ms");
    expect(finding.implicatedSpans).toHaveLength(5);
  });

  test("the same sequential group is NOT double-reported as SequentialSiblings", () => {
    // 5 sequential siblings, combined 500ms of the 1000ms parent (>=50%).
    const findings: Array<PerformanceFinding> = SpanTreeAnalyzer.analyzeTrace(
      nPlusOneTrace(5),
    );

    expect(
      findings.filter((finding: PerformanceFinding): boolean => {
        return (
          finding.findingType === PerformanceFindingType.SequentialSiblings
        );
      }),
    ).toHaveLength(0);
  });

  test("4 siblings stay under the threshold — no findings at all", () => {
    /*
     * Overlapping (already-parallel) 300ms children so neither the
     * sequential detector nor root self-time (200ms of 800ms) can fire —
     * this test isolates the N+1 sibling-count threshold.
     */
    const spans: Array<AnalyzableSpan> = [
      span({ id: "root", name: "GET /orders", start: 0, end: 800 }),
    ];
    for (let i: number = 0; i < 4; i++) {
      spans.push(
        span({
          id: `child-${i}`,
          parent: "root",
          name: `SELECT users ${i}`,
          start: i * 100,
          end: i * 100 + 300,
        }),
      );
    }

    expect(SpanTreeAnalyzer.analyzeTrace(spans)).toHaveLength(0);
  });

  test("different normalized statements split the sibling group — no N+1", () => {
    const spans: Array<AnalyzableSpan> = [
      span({ id: "root", name: "GET /orders", start: 0, end: 2000 }),
    ];
    for (let i: number = 0; i < 6; i++) {
      spans.push(
        span({
          id: `child-${i}`,
          parent: "root",
          name: "query",
          start: i * 100,
          end: i * 100 + 100,
          attributes: {
            "db.statement":
              i % 2 === 0
                ? "SELECT * FROM users WHERE id = 1"
                : "SELECT * FROM orders JOIN items ON 1 = 1",
          },
        }),
      );
    }

    expect(
      SpanTreeAnalyzer.analyzeTrace(spans).filter(
        (finding: PerformanceFinding): boolean => {
          return finding.findingType === PerformanceFindingType.NPlusOneQuery;
        },
      ),
    ).toHaveLength(0);
  });

  test("same-name spans under DIFFERENT parents do not merge into one group", () => {
    const spans: Array<AnalyzableSpan> = [
      span({ id: "root", name: "GET /orders", start: 0, end: 2000 }),
      span({ id: "p1", parent: "root", name: "step one", start: 0, end: 400 }),
      span({
        id: "p2",
        parent: "root",
        name: "step two",
        start: 400,
        end: 800,
      }),
    ];
    for (let i: number = 0; i < 3; i++) {
      spans.push(
        span({
          id: `a-${i}`,
          parent: "p1",
          name: `SELECT users ${i}`,
          start: i * 100,
          end: i * 100 + 100,
        }),
        span({
          id: `b-${i}`,
          parent: "p2",
          name: `SELECT users ${i}`,
          start: 400 + i * 100,
          end: 400 + i * 100 + 100,
        }),
      );
    }

    expect(
      SpanTreeAnalyzer.analyzeTrace(spans).filter(
        (finding: PerformanceFinding): boolean => {
          return finding.findingType === PerformanceFindingType.NPlusOneQuery;
        },
      ),
    ).toHaveLength(0);
  });

  test("duration-only spans (no timestamps) still support N+1 detection", () => {
    const spans: Array<AnalyzableSpan> = [
      span({ id: "root", name: "GET /orders", durationMs: 1000 }),
    ];
    for (let i: number = 0; i < 5; i++) {
      spans.push(
        span({
          id: `child-${i}`,
          parent: "root",
          name: `SELECT users ${i}`,
          durationMs: 100,
        }),
      );
    }

    const findings: Array<PerformanceFinding> =
      SpanTreeAnalyzer.analyzeTrace(spans);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.findingType).toBe(PerformanceFindingType.NPlusOneQuery);
    // Trace duration falls back to the longest span.
    expect(findings[0]!.traceDurationMs).toBe(1000);
  });
});

describe("SpanTreeAnalyzer.analyzeTrace — dominant span detection", () => {
  function dominantTrace(childEnd: number): Array<AnalyzableSpan> {
    return [
      span({ id: "root", name: "GET /report", start: 0, end: 1000 }),
      span({
        id: "big",
        parent: "root",
        name: "SELECT big_table",
        start: 0,
        end: childEnd,
        attributes: {
          "db.statement": "SELECT * FROM big_table WHERE created_at > '2026'",
        },
      }),
    ];
  }

  test("a leaf span at 70% of the trace fires — and its parent does not", () => {
    const findings: Array<PerformanceFinding> = SpanTreeAnalyzer.analyzeTrace(
      dominantTrace(700),
    );

    expect(findings).toHaveLength(1);
    const finding: PerformanceFinding = findings[0]!;
    expect(finding.findingType).toBe(PerformanceFindingType.DominantSpan);
    expect(finding.normalizedSpanName).toBe("SELECT big_table");
    expect(finding.percentOfTrace).toBe(70);
    expect(finding.normalizedDbStatement).toBe(
      "SELECT * FROM big_table WHERE created_at > ?",
    );
    expect(finding.evidence).toContain("700ms");
    expect(finding.evidence).toContain("70%");
  });

  test("exactly 60% fires (threshold is inclusive)", () => {
    const findings: Array<PerformanceFinding> = SpanTreeAnalyzer.analyzeTrace(
      dominantTrace(600),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.findingType).toBe(PerformanceFindingType.DominantSpan);
  });

  test("59% does not fire", () => {
    expect(SpanTreeAnalyzer.analyzeTrace(dominantTrace(590))).toHaveLength(0);
  });

  test("dominance is SELF time: a root whose children cover it never fires", () => {
    // Root fully covered by two children, each under 60%.
    const spans: Array<AnalyzableSpan> = [
      span({ id: "root", name: "GET /home", start: 0, end: 1000 }),
      span({ id: "a", parent: "root", name: "step a", start: 0, end: 500 }),
      span({ id: "b", parent: "root", name: "step b", start: 500, end: 1000 }),
    ];

    expect(SpanTreeAnalyzer.analyzeTrace(spans)).toHaveLength(0);
  });

  test("a single-span trace is trivially dominant — documented behavior", () => {
    const findings: Array<PerformanceFinding> = SpanTreeAnalyzer.analyzeTrace([
      span({ id: "only", name: "cron job", start: 0, end: 300 }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.findingType).toBe(PerformanceFindingType.DominantSpan);
    expect(findings[0]!.percentOfTrace).toBe(100);
  });
});

describe("SpanTreeAnalyzer.analyzeTrace — sequential sibling detection", () => {
  function sequentialTrace(data: {
    starts: Array<number>;
    durationMs: number;
    parentEnd?: number;
  }): Array<AnalyzableSpan> {
    const spans: Array<AnalyzableSpan> = [
      span({
        id: "root",
        name: "checkout",
        start: 0,
        end: data.parentEnd ?? 1000,
      }),
    ];
    data.starts.forEach((start: number, index: number) => {
      spans.push(
        span({
          id: `fetch-${index}`,
          parent: "root",
          name: `HTTP GET /price/${index}`,
          start,
          end: start + data.durationMs,
        }),
      );
    });
    return spans;
  }

  test("3 strictly sequential same-name siblings at 60% of the parent fire", () => {
    const findings: Array<PerformanceFinding> = SpanTreeAnalyzer.analyzeTrace(
      sequentialTrace({ starts: [10, 250, 500], durationMs: 200 }),
    );

    expect(findings).toHaveLength(1);
    const finding: PerformanceFinding = findings[0]!;
    expect(finding.findingType).toBe(PerformanceFindingType.SequentialSiblings);
    expect(finding.spanCount).toBe(3);
    expect(finding.combinedDurationMs).toBe(600);
    expect(finding.percentOfParent).toBe(60);
    expect(finding.parentSpanName).toBe("checkout");
    expect(finding.evidence).toContain("strictly sequentially");
    expect(finding.evidence).toContain("600ms");
  });

  test("back-to-back spans (next starts exactly at previous end) still count as sequential", () => {
    const findings: Array<PerformanceFinding> = SpanTreeAnalyzer.analyzeTrace(
      sequentialTrace({ starts: [0, 200, 400], durationMs: 200 }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.findingType).toBe(
      PerformanceFindingType.SequentialSiblings,
    );
  });

  test("overlapping siblings (already parallel) do not fire", () => {
    // Second span starts before the first ends.
    expect(
      SpanTreeAnalyzer.analyzeTrace(
        sequentialTrace({ starts: [10, 100, 500], durationMs: 200 }),
      ),
    ).toHaveLength(0);
  });

  test("combined duration under 50% of the parent does not fire", () => {
    /*
     * 3 x 100ms = 300ms of a 700ms parent (42.9% < 50%); the parent is
     * kept at 700ms so its own self time (400ms, 57%) stays under the
     * dominant-span threshold too.
     */
    expect(
      SpanTreeAnalyzer.analyzeTrace(
        sequentialTrace({
          starts: [10, 250, 500],
          durationMs: 100,
          parentEnd: 700,
        }),
      ),
    ).toHaveLength(0);
  });

  test("2 sequential siblings stay under the threshold", () => {
    expect(
      SpanTreeAnalyzer.analyzeTrace(
        sequentialTrace({ starts: [10, 400], durationMs: 300 }),
      ),
    ).toHaveLength(0);
  });
});

describe("SpanTreeAnalyzer.analyzeTrace — no-finding traces and ordering", () => {
  test("an empty span list produces no findings", () => {
    expect(SpanTreeAnalyzer.analyzeTrace([])).toHaveLength(0);
  });

  test("a healthy balanced trace produces no findings", () => {
    const spans: Array<AnalyzableSpan> = [
      span({ id: "root", name: "GET /dashboard", start: 0, end: 1000 }),
      span({ id: "auth", parent: "root", name: "auth", start: 0, end: 150 }),
      // Two parallel queries with different statements.
      span({
        id: "q1",
        parent: "root",
        name: "SELECT widgets",
        start: 150,
        end: 550,
      }),
      span({
        id: "q2",
        parent: "root",
        name: "SELECT layout",
        start: 150,
        end: 500,
      }),
      span({
        id: "render",
        parent: "root",
        name: "render",
        start: 550,
        end: 1000,
      }),
    ];

    expect(SpanTreeAnalyzer.analyzeTrace(spans)).toHaveLength(0);
  });

  test("zero-duration traces produce no findings (no percentage evidence possible)", () => {
    expect(
      SpanTreeAnalyzer.analyzeTrace([
        span({ id: "a", name: "instant", start: 100, end: 100 }),
      ]),
    ).toHaveLength(0);
  });

  test("findings are ordered by measured cost, biggest first", () => {
    const spans: Array<AnalyzableSpan> = [
      span({ id: "root", name: "GET /slow", start: 0, end: 1000 }),
      // Dominant leaf: 620ms self time (62%).
      span({
        id: "big",
        parent: "root",
        name: "big query",
        start: 0,
        end: 620,
      }),
    ];
    // N+1: 5 siblings x 70ms = 350ms combined (35%).
    for (let i: number = 0; i < 5; i++) {
      spans.push(
        span({
          id: `n-${i}`,
          parent: "root",
          name: `SELECT items ${i}`,
          start: 630 + i * 70,
          end: 630 + i * 70 + 70,
        }),
      );
    }

    const findings: Array<PerformanceFinding> =
      SpanTreeAnalyzer.analyzeTrace(spans);

    expect(findings).toHaveLength(2);
    expect(findings[0]!.findingType).toBe(PerformanceFindingType.DominantSpan);
    expect(findings[0]!.combinedDurationMs).toBe(620);
    expect(findings[1]!.findingType).toBe(PerformanceFindingType.NPlusOneQuery);
    expect(findings[1]!.combinedDurationMs).toBe(350);
  });
});

describe("SpanTreeAnalyzer.renderFindingsMarkdown", () => {
  test("renders headline, evidence, statement fence and implicated spans", () => {
    const spans: Array<AnalyzableSpan> = [
      span({ id: "root", name: "GET /orders", start: 0, end: 1000 }),
    ];
    for (let i: number = 0; i < 5; i++) {
      spans.push(
        span({
          id: `child-${i}`,
          parent: "root",
          name: `SELECT users ${i}`,
          start: i * 100,
          end: i * 100 + 100,
          attributes: {
            "db.system": "postgresql",
            "db.statement": `SELECT * FROM users WHERE id = ${i}`,
          },
        }),
      );
    }

    const findings: Array<PerformanceFinding> =
      SpanTreeAnalyzer.analyzeTrace(spans);
    const markdown: string = SpanTreeAnalyzer.renderFindingsMarkdown(findings);

    expect(markdown).toContain("### Finding 1:");
    expect(markdown).toContain("N+1");
    expect(markdown).toContain("5 sibling spans");
    expect(markdown).toContain("```sql");
    expect(markdown).toContain("SELECT * FROM users WHERE id = ?");
    expect(markdown).toContain("Implicated spans");
    expect(markdown).toContain('"SELECT users 0" — 100ms (spanId child-0)');
  });
});
