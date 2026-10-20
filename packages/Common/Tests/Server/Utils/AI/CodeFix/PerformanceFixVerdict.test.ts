import { describe, expect, test } from "@jest/globals";
import {
  PERFORMANCE_FIX_THRESHOLDS,
  PerformanceMeasure,
  decidePerformanceBaseline,
  decidePerformanceVerdict,
  describeOperation,
  operationOfFinding,
} from "../../../../../Server/Utils/AI/CodeFix/PerformanceFixVerdict";
import { FixProductionVerdict } from "../../../../../Server/Utils/AI/CodeFix/FixProductionVerdict";
import {
  PerformanceFinding,
  PerformanceFindingType,
} from "../../../../../Types/AI/CodeFixTaskContext";
import FixProductionStatus from "../../../../../Types/AI/FixProductionStatus";
import { seededRandom, SeededRandom } from "../../../../Helpers/SeededRandom";

/*
 * A performance fix is merged, not faster. These pin when the operation it
 * names counts as faster in production (a p99 at least a fifth lower after
 * a whole day on enough spans), as not faster (a p99 no lower at all), and
 * as impossible to tell (too few spans, or too small a change by the end of
 * the week) - and which operation a trace's finding is measured by.
 */

const HOUR: number = 60 * 60 * 1000;
const DEPLOYED_AT: Date = new Date("2026-10-20T10:00:00.000Z");
const GRACE: number =
  PERFORMANCE_FIX_THRESHOLDS.rolloutGraceMinutes * 60 * 1000;
const BASELINE: PerformanceMeasure = { spanCount: 4200, p99Ms: 2400 };

// `hours` of watched time after the rollout grace.
function watched(hours: number): Date {
  return new Date(DEPLOYED_AT.getTime() + GRACE + hours * HOUR);
}

function decide(data: {
  now: Date;
  sinceDeploy: PerformanceMeasure | null;
  baseline?: PerformanceMeasure;
}): FixProductionVerdict {
  return decidePerformanceVerdict({
    deployedAt: DEPLOYED_AT,
    now: data.now,
    baseline: data.baseline || BASELINE,
    sinceDeploy: data.sinceDeploy,
    deployLabel: "version 2.3.2",
    operationLabel: '"GET /orders"',
  });
}

function finding(overrides: Partial<PerformanceFinding>): PerformanceFinding {
  return {
    findingType: PerformanceFindingType.NPlusOneQuery,
    headline: 'N+1: 27× "SELECT users" under "GET /orders"',
    evidence: "27 sibling spans",
    spanCount: 27,
    combinedDurationMs: 1800,
    traceDurationMs: 2400,
    percentOfTrace: 75,
    normalizedSpanName: "SELECT users",
    parentSpanName: "GET /orders",
    implicatedSpans: [{ spanId: "s1", name: "SELECT users", durationMs: 66 }],
    ...overrides,
  };
}

describe("thresholds", () => {
  test("are pinned", () => {
    expect(PERFORMANCE_FIX_THRESHOLDS).toEqual({
      rolloutGraceMinutes: 10,
      minWatchHours: 24,
      maxWatchDays: 7,
      baselineDays: 7,
      minSpans: 100,
      minImprovement: 0.2,
    });
  });
});

describe("which operation a trace's finding is measured by", () => {
  test("an N+1 is measured by the parent its repeated spans run under", () => {
    expect(operationOfFinding(finding({}))).toBe("GET /orders");
  });

  test("sequential siblings are measured by their parent", () => {
    expect(
      operationOfFinding(
        finding({
          findingType: PerformanceFindingType.SequentialSiblings,
          parentSpanName: "POST /checkout",
        }),
      ),
    ).toBe("POST /checkout");
  });

  test("a dominant span is measured by itself, as its span is named", () => {
    expect(
      operationOfFinding(
        finding({
          findingType: PerformanceFindingType.DominantSpan,
          parentSpanName: undefined,
          normalizedSpanName: "GET /users/{n}",
          implicatedSpans: [
            { spanId: "s9", name: "GET /users/42", durationMs: 1900 },
          ],
        }),
      ),
    ).toBe("GET /users/42");
  });

  test("a finding without the span it slows names nothing", () => {
    expect(operationOfFinding(undefined)).toBeUndefined();
    expect(
      operationOfFinding(finding({ parentSpanName: undefined })),
    ).toBeUndefined();
    expect(operationOfFinding(finding({ parentSpanName: "  " }))).toBeUndefined();
    expect(
      operationOfFinding(
        finding({
          findingType: PerformanceFindingType.DominantSpan,
          implicatedSpans: [],
        }),
      ),
    ).toBeUndefined();
  });

  test("the operation is quoted; a whole service is named by its spans", () => {
    expect(describeOperation({ spanName: "GET /orders" })).toBe(
      '"GET /orders"',
    );
    expect(describeOperation({ serviceName: "checkout" })).toBe(
      'the spans of "checkout"',
    );
    expect(describeOperation({})).toBe("the service's spans");
  });
});

describe("a baseline too thin to compare with", () => {
  test("fewer than 100 spans in the week before the merge is Unverifiable at once", () => {
    expect(
      decidePerformanceBaseline({
        baseline: { spanCount: 12, p99Ms: 900 },
        operationLabel: '"GET /orders"',
      }),
    ).toEqual({
      status: FixProductionStatus.Unverifiable,
      summary:
        '"GET /orders" ran 12 times in the 7 days before the fix merged: too few to measure its p99 against.',
    });
  });

  test("100 spans are enough", () => {
    expect(
      decidePerformanceBaseline({
        baseline: { spanCount: 100, p99Ms: 900 },
        operationLabel: '"GET /orders"',
      }),
    ).toBeNull();
  });
});

describe("a deployed performance fix", () => {
  test("is only watched in its first day, whatever its p99 so far", () => {
    expect(decide({ now: watched(23.9), sinceDeploy: null })).toEqual({
      status: FixProductionStatus.Watching,
      summary:
        'Version 2.3.2 shipped the fix. The p99 of "GET /orders" was 2.4 s in the 7 days before it merged; it is compared again once the fix has run for a day.',
    });
    expect(
      decide({
        now: watched(23.9),
        sinceDeploy: { spanCount: 5000, p99Ms: 200 },
      }).status,
    ).toBe(FixProductionStatus.Watching);
  });

  test("a p99 at least a fifth lower after a day is Verified", () => {
    expect(
      decide({
        now: watched(26),
        sinceDeploy: { spanCount: 1204, p99Ms: 310 },
      }),
    ).toEqual({
      status: FixProductionStatus.Verified,
      summary:
        'The p99 of "GET /orders" fell from 2.4 s to 310 ms in the 26 hours since version 2.3.2 shipped the fix (1,204 spans).',
    });
    expect(
      decide({
        now: watched(24),
        sinceDeploy: { spanCount: 100, p99Ms: 1920 },
      }).status,
    ).toBe(FixProductionStatus.Verified);
  });

  test("a p99 no lower at all is Regressed: the fix did not make it faster", () => {
    expect(
      decide({
        now: watched(26),
        sinceDeploy: { spanCount: 900, p99Ms: 2500 },
      }),
    ).toEqual({
      status: FixProductionStatus.Regressed,
      summary:
        'The p99 of "GET /orders" is 2.5 s in the 26 hours since version 2.3.2 shipped the fix (900 spans), against 2.4 s in the 7 days before it merged, so the fix did not make it faster.',
    });
    expect(
      decide({
        now: watched(30),
        sinceDeploy: { spanCount: 900, p99Ms: 2400 },
      }).status,
    ).toBe(FixProductionStatus.Regressed);
  });

  test("too few spans since are watched, and Unverifiable when the week is over", () => {
    expect(
      decide({ now: watched(48), sinceDeploy: { spanCount: 99, p99Ms: 10 } }),
    ).toEqual({
      status: FixProductionStatus.Watching,
      summary:
        'Version 2.3.2 shipped the fix. The p99 of "GET /orders" was 2.4 s in the 7 days before it merged; it has not run often enough since to compare.',
    });
    expect(
      decide({
        now: watched(7 * 24),
        sinceDeploy: { spanCount: 1, p99Ms: 10 },
      }),
    ).toEqual({
      status: FixProductionStatus.Unverifiable,
      summary:
        '"GET /orders" ran once in the 7 days since version 2.3.2 shipped the fix: too few to measure its p99.',
    });
  });

  test("a little faster is watched, and Unverifiable when the week is over", () => {
    const little: PerformanceMeasure = { spanCount: 3000, p99Ms: 2100 };

    expect(decide({ now: watched(30), sinceDeploy: little })).toEqual({
      status: FixProductionStatus.Watching,
      summary:
        'Version 2.3.2 shipped the fix. The p99 of "GET /orders" was 2.4 s in the 7 days before it merged; it is faster since, but not yet by 20%.',
    });
    expect(decide({ now: watched(7 * 24), sinceDeploy: little })).toEqual({
      status: FixProductionStatus.Unverifiable,
      summary:
        'The p99 of "GET /orders" fell from 2.4 s to 2.1 s in the 7 days since version 2.3.2 shipped the fix (3,000 spans): 13% faster, too little to tell the fix from a quieter week.',
    });
  });

  test("the watch's words do not change from one check to the next", () => {
    const early: FixProductionVerdict = decide({
      now: watched(1),
      sinceDeploy: null,
    });

    expect(decide({ now: watched(20), sinceDeploy: null })).toEqual(early);
  });

  test("a summary never outgrows its column, however long the operation's name", () => {
    const verdict: FixProductionVerdict = decidePerformanceVerdict({
      deployedAt: DEPLOYED_AT,
      now: watched(26),
      baseline: BASELINE,
      sinceDeploy: { spanCount: 1000, p99Ms: 100 },
      deployLabel: `version ${"9".repeat(100)}`,
      operationLabel: `"${"x".repeat(400)}"`,
    });

    expect(verdict.summary.length).toBeLessThanOrEqual(500);
  });

  test("Verified always means a p99 at least a fifth lower, on enough spans, after a day", () => {
    const random: SeededRandom = seededRandom(5094);

    for (let draw: number = 0; draw < 2000; draw++) {
      const baseline: PerformanceMeasure = {
        spanCount: 100 + random(5000),
        p99Ms: 1 + random(10000),
      };
      const since: PerformanceMeasure = {
        spanCount: random(400),
        p99Ms: random(12000),
      };
      const hours: number = random(8 * 24);
      const verdict: FixProductionVerdict = decide({
        now: watched(hours),
        baseline,
        sinceDeploy: hours >= 24 ? since : null,
      });

      if (verdict.status === FixProductionStatus.Verified) {
        expect(hours).toBeGreaterThanOrEqual(24);
        expect(since.spanCount).toBeGreaterThanOrEqual(100);
        expect(since.p99Ms).toBeLessThanOrEqual(baseline.p99Ms * 0.8);
      }

      if (verdict.status === FixProductionStatus.Regressed) {
        expect(hours).toBeGreaterThanOrEqual(24);
        expect(since.spanCount).toBeGreaterThanOrEqual(100);
        expect(since.p99Ms).toBeGreaterThanOrEqual(baseline.p99Ms);
      }

      if (hours >= 7 * 24) {
        expect(verdict.status).not.toBe(FixProductionStatus.Watching);
      }
    }
  });
});
