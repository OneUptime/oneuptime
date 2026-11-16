import { describe, expect, test } from "@jest/globals";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import {
  SLO_REQUEST_COUNT_CHUNK_MINUTES,
  SLO_REQUEST_MAX_BACKFILL_CHUNKS,
  SLO_REQUEST_RESTATE_STEPS,
  SLO_REQUEST_SETTLE_MINUTES,
  SLO_REQUEST_STEP_MILLISECONDS,
  SLO_REQUEST_STEP_MINUTES,
  SloEventErrorBudget,
  SloEventSliResult,
  SloRequestCountingPlan,
  SloRequestCountingRange,
  SloRequestCountSeries,
  computeEventBurnRate,
  computeEventSli,
  floorToRequestStep,
  formatRequestBudget,
  formatRequestCount,
  getBadRequestKind,
  getCountedWindowStart,
  getEventErrorBudget,
  getRequestCountingWindowFill,
  getSettledRequestStepEnd,
  isEventSliType,
  isRequestSliType,
  listRequestStepStarts,
  planRequestCounting,
} from "../../../Utils/Slo/SloRequestSli";

/*
 * Request SLIs: what an evaluation counts, and the maths on the counts.
 *
 * The plan is the part that is easy to get subtly wrong - a step counted
 * twice, a gap nobody counts, a restart that keeps counts of something the
 * SLO no longer measures - so it is pinned branch by branch, with the clock
 * fixed at a step boundary plus a few seconds.
 */

const STEP: number = SLO_REQUEST_STEP_MILLISECONDS;
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;
const CHUNK: number = SLO_REQUEST_COUNT_CHUNK_MINUTES * MINUTE;

// 12:07:30 UTC, so the newest settled step is 12:00-12:05.
const NOW: Date = new Date("2026-07-19T12:07:30.000Z");

// now - 2 minutes = 12:05:30, floored to its step: 12:05.
const SETTLED_END: Date = new Date("2026-07-19T12:05:00.000Z");

function at(milliseconds: number): Date {
  return new Date(milliseconds);
}

function rangeOf(from: number, to: number): SloRequestCountingRange {
  return { from: at(from), to: at(to) };
}

describe("SloRequestSli constants", () => {
  test("a step is 5 minutes, and the settle time and restate steps are what the docs say", () => {
    expect(SLO_REQUEST_STEP_MINUTES).toBe(5);
    expect(SLO_REQUEST_STEP_MILLISECONDS).toBe(5 * MINUTE);
    expect(SLO_REQUEST_SETTLE_MINUTES).toBe(2);
    expect(SLO_REQUEST_RESTATE_STEPS).toBe(2);
    expect(SLO_REQUEST_COUNT_CHUNK_MINUTES).toBe(6 * 60);
    expect(SLO_REQUEST_MAX_BACKFILL_CHUNKS).toBe(4);
  });

  test("the SloHistory series names are the ones SloHistory reserved for event SLIs", () => {
    // Persisted names: renaming one would orphan every count already kept.
    expect(SloRequestCountSeries.Good).toBe("good.count");
    expect(SloRequestCountSeries.Total).toBe("total.count");
  });
});

describe("isRequestSliType", () => {
  test("is true for Request Success and Request Latency only", () => {
    expect(isRequestSliType(SliType.RequestSuccess)).toBe(true);
    expect(isRequestSliType(SliType.RequestLatency)).toBe(true);
    expect(isRequestSliType(SliType.MonitorUptime)).toBe(false);
    expect(isRequestSliType(SliType.Metric)).toBe(false);
    expect(isRequestSliType(undefined)).toBe(false);
    expect(isRequestSliType(null)).toBe(false);
    expect(isRequestSliType("Request success")).toBe(false);
  });

  test("the stored values never change", () => {
    expect(SliType.RequestSuccess).toBe("Request Success");
    expect(SliType.RequestLatency).toBe("Request Latency");
    expect(SliType.MonitorUptime).toBe("Monitor Uptime");
  });
});

describe("request steps", () => {
  test("floorToRequestStep aligns to 5-minute steps of the Unix epoch", () => {
    expect(floorToRequestStep(new Date("2026-07-19T12:04:59.999Z"))).toEqual(
      new Date("2026-07-19T12:00:00.000Z"),
    );
    expect(floorToRequestStep(new Date("2026-07-19T12:05:00.000Z"))).toEqual(
      new Date("2026-07-19T12:05:00.000Z"),
    );
    expect(floorToRequestStep(new Date(0))).toEqual(new Date(0));
  });

  test("a step settles two minutes after it ends", () => {
    expect(getSettledRequestStepEnd(NOW)).toEqual(SETTLED_END);

    // 12:06:59 - 2 minutes = 12:04:59, so 12:00-12:05 has not settled yet.
    expect(
      getSettledRequestStepEnd(new Date("2026-07-19T12:06:59.000Z")),
    ).toEqual(new Date("2026-07-19T12:00:00.000Z"));

    expect(
      getSettledRequestStepEnd(new Date("2026-07-19T12:07:00.000Z")),
    ).toEqual(new Date("2026-07-19T12:05:00.000Z"));
  });

  test("listRequestStepStarts lists every step start in [from, to), oldest first", () => {
    const starts: Array<Date> = listRequestStepStarts(
      rangeOf(SETTLED_END.getTime() - 3 * STEP, SETTLED_END.getTime()),
    );

    expect(
      starts.map((start: Date): string => {
        return start.toISOString();
      }),
    ).toEqual([
      "2026-07-19T11:50:00.000Z",
      "2026-07-19T11:55:00.000Z",
      "2026-07-19T12:00:00.000Z",
    ]);
  });

  test("an empty or inverted range lists no steps", () => {
    expect(
      listRequestStepStarts(
        rangeOf(SETTLED_END.getTime(), SETTLED_END.getTime()),
      ),
    ).toEqual([]);
    expect(
      listRequestStepStarts(
        rangeOf(SETTLED_END.getTime(), SETTLED_END.getTime() - STEP),
      ),
    ).toEqual([]);
  });

  test("a range that does not start on a step starts at the step it is in", () => {
    const starts: Array<Date> = listRequestStepStarts(
      rangeOf(SETTLED_END.getTime() - STEP - 30 * 1000, SETTLED_END.getTime()),
    );

    expect(starts).toHaveLength(2);
    expect(starts[0]).toEqual(at(SETTLED_END.getTime() - 2 * STEP));
  });
});

describe("planRequestCounting", () => {
  const settled: number = SETTLED_END.getTime();

  test("a new SLO counts the newest 6 hours, then older pieces back to what it needs", () => {
    const plan: SloRequestCountingPlan = planRequestCounting({
      now: NOW,
      neededFrom: at(settled - 30 * DAY),
      isSameCounting: false,
    });

    expect(plan.isRestart).toBe(true);
    expect(plan.forward).toEqual(rangeOf(settled - CHUNK, settled));
    expect(plan.lastAccumulatedBucketEndAt).toEqual(SETTLED_END);
    expect(plan.firstAccumulatedBucketStartAt).toEqual(at(settled - CHUNK));

    // Four older pieces, newest first, each ending where the previous starts.
    expect(plan.backfill).toEqual([
      rangeOf(settled - 2 * CHUNK, settled - CHUNK),
      rangeOf(settled - 3 * CHUNK, settled - 2 * CHUNK),
      rangeOf(settled - 4 * CHUNK, settled - 3 * CHUNK),
      rangeOf(settled - 5 * CHUNK, settled - 4 * CHUNK),
    ]);
  });

  test("a new SLO whose window is younger than 6 hours counts only the window", () => {
    // A calendar month that started 90 minutes ago.
    const plan: SloRequestCountingPlan = planRequestCounting({
      now: NOW,
      neededFrom: at(settled - 90 * MINUTE),
      isSameCounting: true,
    });

    expect(plan.isRestart).toBe(true);
    expect(plan.forward).toEqual(rangeOf(settled - 90 * MINUTE, settled));
    expect(plan.backfill).toEqual([]);
  });

  test("the needed start is floored to its step, so no step is half counted", () => {
    const plan: SloRequestCountingPlan = planRequestCounting({
      now: NOW,
      neededFrom: at(settled - 90 * MINUTE + 61 * 1000),
      isSameCounting: false,
    });

    expect(plan.forward?.from).toEqual(at(settled - 90 * MINUTE));
  });

  test("the last backfill piece stops at the needed start", () => {
    const plan: SloRequestCountingPlan = planRequestCounting({
      now: NOW,
      neededFrom: at(settled - CHUNK - 2 * HOUR),
      isSameCounting: false,
    });

    expect(plan.backfill).toEqual([
      rangeOf(settled - CHUNK - 2 * HOUR, settled - CHUNK),
    ]);
  });

  test("an evaluation carries on: the steps settled since, with the last two counted again", () => {
    const first: number = settled - 30 * DAY;
    const last: number = settled - STEP;

    const plan: SloRequestCountingPlan = planRequestCounting({
      now: NOW,
      neededFrom: at(settled - 30 * DAY),
      firstAccumulatedBucketStartAt: at(first),
      lastAccumulatedBucketEndAt: at(last),
      isSameCounting: true,
    });

    expect(plan.isRestart).toBe(false);
    expect(plan.forward).toEqual(rangeOf(last - 2 * STEP, settled));
    expect(plan.lastAccumulatedBucketEndAt).toEqual(SETTLED_END);
    expect(plan.firstAccumulatedBucketStartAt).toEqual(at(first));
    // The window is covered already: nothing older to count.
    expect(plan.backfill).toEqual([]);
  });

  test("the restate never reaches before the oldest counted step", () => {
    const plan: SloRequestCountingPlan = planRequestCounting({
      now: NOW,
      neededFrom: at(settled - STEP),
      firstAccumulatedBucketStartAt: at(settled - STEP),
      lastAccumulatedBucketEndAt: at(settled - STEP),
      isSameCounting: true,
    });

    expect(plan.forward).toEqual(rangeOf(settled - STEP, settled));
  });

  test("nothing new settled since the last evaluation: no forward count", () => {
    const plan: SloRequestCountingPlan = planRequestCounting({
      now: NOW,
      neededFrom: at(settled - 30 * DAY),
      firstAccumulatedBucketStartAt: at(settled - 30 * DAY),
      lastAccumulatedBucketEndAt: SETTLED_END,
      isSameCounting: true,
    });

    expect(plan.isRestart).toBe(false);
    expect(plan.forward).toBeNull();
    expect(plan.backfill).toEqual([]);
    expect(plan.lastAccumulatedBucketEndAt).toEqual(SETTLED_END);
  });

  test("while the window is not covered yet, every evaluation counts older pieces too", () => {
    const first: number = settled - 2 * CHUNK;

    const plan: SloRequestCountingPlan = planRequestCounting({
      now: NOW,
      neededFrom: at(settled - 30 * DAY),
      firstAccumulatedBucketStartAt: at(first),
      lastAccumulatedBucketEndAt: at(settled - STEP),
      isSameCounting: true,
    });

    expect(plan.backfill).toHaveLength(SLO_REQUEST_MAX_BACKFILL_CHUNKS);
    expect(plan.backfill[0]).toEqual(rangeOf(first - CHUNK, first));
    // The cursors say what is counted once forward is; backfill moves first.
    expect(plan.firstAccumulatedBucketStartAt).toEqual(at(first));
  });

  test("a change to what the SLO counts starts again, whatever the cursors say", () => {
    const plan: SloRequestCountingPlan = planRequestCounting({
      now: NOW,
      neededFrom: at(settled - 30 * DAY),
      firstAccumulatedBucketStartAt: at(settled - 30 * DAY),
      lastAccumulatedBucketEndAt: at(settled - STEP),
      isSameCounting: false,
    });

    expect(plan.isRestart).toBe(true);
    expect(plan.forward).toEqual(rangeOf(settled - CHUNK, settled));
    expect(plan.firstAccumulatedBucketStartAt).toEqual(at(settled - CHUNK));
  });

  test("a gap of more than 6 hours starts again from now, newest first", () => {
    const plan: SloRequestCountingPlan = planRequestCounting({
      now: NOW,
      neededFrom: at(settled - 30 * DAY),
      firstAccumulatedBucketStartAt: at(settled - 30 * DAY),
      lastAccumulatedBucketEndAt: at(settled - CHUNK - STEP),
      isSameCounting: true,
    });

    expect(plan.isRestart).toBe(true);
    expect(plan.forward).toEqual(rangeOf(settled - CHUNK, settled));
  });

  test("a gap of exactly 6 hours is caught up in one count", () => {
    const plan: SloRequestCountingPlan = planRequestCounting({
      now: NOW,
      neededFrom: at(settled - 30 * DAY),
      firstAccumulatedBucketStartAt: at(settled - 30 * DAY),
      lastAccumulatedBucketEndAt: at(settled - CHUNK),
      isSameCounting: true,
    });

    expect(plan.isRestart).toBe(false);
    expect(plan.forward).toEqual(rangeOf(settled - CHUNK - 2 * STEP, settled));
  });

  test("a cursor ahead of the clock, or cursors the wrong way round, start again", () => {
    const ahead: SloRequestCountingPlan = planRequestCounting({
      now: NOW,
      neededFrom: at(settled - DAY),
      firstAccumulatedBucketStartAt: at(settled - DAY),
      lastAccumulatedBucketEndAt: at(settled + STEP),
      isSameCounting: true,
    });

    expect(ahead.isRestart).toBe(true);
    expect(ahead.lastAccumulatedBucketEndAt).toEqual(SETTLED_END);

    const inverted: SloRequestCountingPlan = planRequestCounting({
      now: NOW,
      neededFrom: at(settled - DAY),
      firstAccumulatedBucketStartAt: at(settled - STEP),
      lastAccumulatedBucketEndAt: at(settled - 2 * STEP),
      isSameCounting: true,
    });

    expect(inverted.isRestart).toBe(true);
  });

  test("only one cursor set starts again", () => {
    expect(
      planRequestCounting({
        now: NOW,
        neededFrom: at(settled - DAY),
        lastAccumulatedBucketEndAt: at(settled - STEP),
        isSameCounting: true,
      }).isRestart,
    ).toBe(true);

    expect(
      planRequestCounting({
        now: NOW,
        neededFrom: at(settled - DAY),
        firstAccumulatedBucketStartAt: at(settled - DAY),
        isSameCounting: true,
      }).isRestart,
    ).toBe(true);
  });

  test("counted ranges never overlap and leave no gap", () => {
    const plan: SloRequestCountingPlan = planRequestCounting({
      now: NOW,
      neededFrom: at(settled - 30 * DAY),
      isSameCounting: false,
    });

    const ranges: Array<SloRequestCountingRange> = [
      plan.forward!,
      ...plan.backfill,
    ];

    for (let index: number = 1; index < ranges.length; index++) {
      expect(ranges[index]!.to).toEqual(ranges[index - 1]!.from);
      expect(ranges[index]!.from.getTime()).toBeLessThan(
        ranges[index]!.to.getTime(),
      );
    }
  });
});

describe("getCountedWindowStart", () => {
  test("the window's own start once the counting covers it", () => {
    expect(
      getCountedWindowStart({
        windowStart: at(SETTLED_END.getTime() - 30 * DAY),
        firstAccumulatedBucketStartAt: at(SETTLED_END.getTime() - 40 * DAY),
      }),
    ).toEqual(at(SETTLED_END.getTime() - 30 * DAY));
  });

  test("the oldest counted step while the counting has not reached it", () => {
    expect(
      getCountedWindowStart({
        windowStart: at(SETTLED_END.getTime() - 30 * DAY),
        firstAccumulatedBucketStartAt: at(SETTLED_END.getTime() - DAY),
      }),
    ).toEqual(at(SETTLED_END.getTime() - DAY));
  });

  test("a window start between steps reads from the step it is in", () => {
    expect(
      getCountedWindowStart({
        windowStart: new Date("2026-07-01T00:03:20.000Z"),
        firstAccumulatedBucketStartAt: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ).toEqual(new Date("2026-07-01T00:00:00.000Z"));
  });
});

describe("computeEventSli", () => {
  test("good over total", () => {
    const sli: SloEventSliResult = computeEventSli({
      goodCount: 999,
      totalCount: 1000,
    });

    expect(sli).toEqual({
      goodEventCount: 999,
      totalEventCount: 1000,
      badEventCount: 1,
      sliPercentage: 99.9,
    });
  });

  test("nothing counted reads 100, for the caller to treat as no data", () => {
    expect(computeEventSli({ goodCount: 0, totalCount: 0 })).toEqual({
      goodEventCount: 0,
      totalEventCount: 0,
      badEventCount: 0,
      sliPercentage: 100,
    });
  });

  test("more good than total is held to the total", () => {
    const sli: SloEventSliResult = computeEventSli({
      goodCount: 12,
      totalCount: 10,
    });

    expect(sli.goodEventCount).toBe(10);
    expect(sli.badEventCount).toBe(0);
    expect(sli.sliPercentage).toBe(100);
  });

  test("negative, non-finite and string counts are read as counts", () => {
    expect(
      computeEventSli({
        goodCount: "7" as unknown as number,
        totalCount: "10" as unknown as number,
      }).sliPercentage,
    ).toBe(70);

    expect(
      computeEventSli({ goodCount: -5, totalCount: Number.NaN })
        .totalEventCount,
    ).toBe(0);
  });
});

describe("getEventErrorBudget", () => {
  test("the budget is the bad requests the target allows", () => {
    const budget: SloEventErrorBudget = getEventErrorBudget({
      sli: computeEventSli({ goodCount: 99950, totalCount: 100000 }),
      targetPercentage: 99.9,
    });

    expect(budget.budgetTotalEvents).toBeCloseTo(100, 6);
    expect(budget.budgetConsumedEvents).toBe(50);
    expect(budget.budgetRemainingEvents).toBeCloseTo(50, 6);
    expect(budget.budgetRemainingPercentage).toBeCloseTo(50, 6);
  });

  test("an overspent budget is negative", () => {
    const budget: SloEventErrorBudget = getEventErrorBudget({
      sli: computeEventSli({ goodCount: 980, totalCount: 1000 }),
      targetPercentage: 99,
    });

    expect(budget.budgetRemainingEvents).toBeCloseTo(-10, 6);
    expect(budget.budgetRemainingPercentage).toBeCloseTo(-100, 6);
  });

  test("a target out of range throws, as it does for time", () => {
    expect(() => {
      getEventErrorBudget({
        sli: computeEventSli({ goodCount: 1, totalCount: 1 }),
        targetPercentage: 100,
      });
    }).toThrow();
  });
});

describe("computeEventBurnRate", () => {
  test("1x when the bad share equals what the target allows", () => {
    expect(
      computeEventBurnRate({
        counts: { goodCount: 999, totalCount: 1000 },
        targetPercentage: 99.9,
      }),
    ).toBeCloseTo(1, 6);
  });

  test("14.4x on a 1.44% error rate against 99.9%", () => {
    expect(
      computeEventBurnRate({
        counts: { goodCount: 9856, totalCount: 10000 },
        targetPercentage: 99.9,
      }),
    ).toBeCloseTo(14.4, 6);
  });

  test("0 when nothing was counted: no evidence of burn", () => {
    expect(
      computeEventBurnRate({
        counts: { goodCount: 0, totalCount: 0 },
        targetPercentage: 99.9,
      }),
    ).toBe(0);
  });
});

describe("getRequestCountingWindowFill", () => {
  const windowEnd: Date = SETTLED_END;
  const windowStart: Date = at(SETTLED_END.getTime() - 30 * DAY);

  test("full once the counting reaches the start of the window", () => {
    expect(
      getRequestCountingWindowFill({
        windowStart: windowStart,
        windowEnd: windowEnd,
        firstAccumulatedBucketStartAt: at(windowStart.getTime() - DAY),
      }),
    ).toBe(1);
  });

  test("the share covered while it is still counting older requests", () => {
    expect(
      getRequestCountingWindowFill({
        windowStart: windowStart,
        windowEnd: windowEnd,
        firstAccumulatedBucketStartAt: at(windowEnd.getTime() - 3 * DAY),
      }),
    ).toBeCloseTo(0.1, 6);
  });

  test("null before anything is counted, or for an empty window", () => {
    expect(
      getRequestCountingWindowFill({
        windowStart: windowStart,
        windowEnd: windowEnd,
        firstAccumulatedBucketStartAt: null,
      }),
    ).toBeNull();

    expect(
      getRequestCountingWindowFill({
        windowStart: windowEnd,
        windowEnd: windowEnd,
        firstAccumulatedBucketStartAt: windowStart,
      }),
    ).toBeNull();
  });
});

describe("request budget words", () => {
  test("a Request Success SLO's bad requests failed, a Request Latency SLO's were slow", () => {
    expect(getBadRequestKind(SliType.RequestSuccess)).toBe("failed");
    expect(getBadRequestKind(SliType.RequestLatency)).toBe("slow");
    expect(getBadRequestKind(undefined)).toBe("failed");
  });

  test("counts are whole requests, grouped by thousands, never signed", () => {
    expect(formatRequestCount(1234567)).toBe("1,234,567");
    expect(formatRequestCount(12.345)).toBe("12");
    expect(formatRequestCount(12.5)).toBe("13");
    expect(formatRequestCount(-42.4)).toBe("42");
    expect(formatRequestCount(-0.4)).toBe("0");
    expect(formatRequestCount(Number.NaN)).toBe("");
  });

  test("a budget names its requests in the singular or the plural", () => {
    expect(
      formatRequestBudget({
        sliType: SliType.RequestSuccess,
        remainingEvents: 1234,
      }),
    ).toBe("1,234 failed requests");

    expect(
      formatRequestBudget({
        sliType: SliType.RequestLatency,
        remainingEvents: 1,
      }),
    ).toBe("1 slow request");

    expect(
      formatRequestBudget({
        sliType: SliType.RequestLatency,
        remainingEvents: 0.2,
      }),
    ).toBe("0 slow requests");

    expect(
      formatRequestBudget({
        sliType: SliType.RequestSuccess,
        remainingEvents: Number.POSITIVE_INFINITY,
      }),
    ).toBe("");
  });
});

/*
 * An SLO counted in events (#8445): a request SLO from traces, or a Metric
 * SLO from a metric. Its budget is in events, never minutes.
 */
describe("isEventSliType", () => {
  test("is a request SLI or a metric, never monitor uptime", () => {
    expect(isEventSliType(SliType.RequestSuccess)).toBe(true);
    expect(isEventSliType(SliType.RequestLatency)).toBe(true);
    expect(isEventSliType(SliType.Metric)).toBe(true);
    expect(isEventSliType(SliType.MonitorUptime)).toBe(false);
    expect(isEventSliType(undefined)).toBe(false);
    expect(isEventSliType(null)).toBe(false);
  });

  test("a Metric SLO's budget is in bad events, in the singular or the plural", () => {
    expect(
      formatRequestBudget({ sliType: SliType.Metric, remainingEvents: 1234 }),
    ).toBe("1,234 bad events");
    expect(
      formatRequestBudget({ sliType: SliType.Metric, remainingEvents: 1 }),
    ).toBe("1 bad event");
  });
});
