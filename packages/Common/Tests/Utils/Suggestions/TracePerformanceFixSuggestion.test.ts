import { describe, expect, test } from "@jest/globals";
import {
  PerformanceFinding,
  PerformanceFindingType,
} from "../../../Types/AI/CodeFixTaskContext";
import { CodeTaskBlockerType } from "../../../Types/AI/CodeTask";
import { JSONObject } from "../../../Types/JSON";
import { FinishedFixOutcome } from "../../../Utils/Suggestions/CodeFixSuggestion";
import { SuggestionBlocker } from "../../../Utils/Suggestions/SuggestionBlocker";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import {
  MAX_TRACE_PERFORMANCE_FIX_REPOSITORIES,
  NO_TRACE_PERFORMANCE_FIX_SUGGESTION,
  PICK_A_REPOSITORY_FOR_THE_FIX_MESSAGE,
  PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE,
  TRACE_NOT_WORTH_FIXING_MESSAGE,
  TracePerformanceFixOffer,
  TracePerformanceFixSuggestion,
  WORTH_FIXING_MIN_MS,
  WORTH_FIXING_MIN_PERCENT_OF_TRACE,
  getFindingOperationName,
  getFindingsWorthFixing,
  getTracePerformanceFixOffer,
  isDatabaseFinding,
  isFindingWorthFixing,
  parsePerformanceFinding,
  parseTracePerformanceFixRepositories,
  parseTracePerformanceFixSuggestion,
  tracePerformanceFixSuggestionToJSON,
} from "../../../Utils/Suggestions/TracePerformanceFixSuggestion";
import SpanTreeAnalyzer from "../../../Utils/Traces/SpanTreeAnalyzer";
import {
  FAST_CLEAN_REQUEST,
  FAST_REQUEST_WITH_N_PLUS_ONE,
  HEALTH_CHECK,
  LONG_BATCH_WITH_A_SMALL_N_PLUS_ONE,
  NOT_WORTH_FIXING_TRACES,
  ORDINARY_EXTERNAL_CALL,
  SLOW_CALLS_ONE_AFTER_ANOTHER,
  SLOW_CHECKOUT_WITH_N_PLUS_ONE,
  SLOW_REQUEST_WITHOUT_A_PATTERN,
  SLOW_SINGLE_QUERY,
  SLOW_SINGLE_SPAN,
  TraceFixture,
  WORTH_FIXING_TRACES,
} from "./TraceFixtures";

/*
 * "Fix performance with AI" is offered only on a trace worth fixing: the
 * span-tree analysis must find a known pattern that costs the request real
 * time. These tests run the real analysis on realistic span trees (a slow
 * checkout with an N+1, a fast request with the same loop, a health check,
 * a slow request with no pattern, ...) and hold the rule, its thresholds,
 * the offer that follows from AI, a repository, a fix in flight or done,
 * and what Code's gate says, and the wire format the trace page reads.
 */

// What Code's gate says when the project's AI credits are used up.
const NO_CREDITS: SuggestionBlocker = {
  type: CodeTaskBlockerType.NoAiCredits,
  message: "This project's AI credits are used up.",
};

// The Runner the repository picks is not online, by name.
const RUNNER_OFFLINE: SuggestionBlocker = {
  type: CodeTaskBlockerType.RunnerNotOnline,
  message: 'The Runner "build-box" this repository picks is not online.',
  runnerName: "build-box",
  repositoryId: "50000000-0000-4000-8000-000000000005",
};

function analyze(trace: TraceFixture): Array<PerformanceFinding> {
  return SpanTreeAnalyzer.analyzeTrace(trace.spans);
}

function finding(
  overrides: Partial<PerformanceFinding> = {},
): PerformanceFinding {
  return {
    findingType: PerformanceFindingType.NPlusOneQuery,
    headline: 'N+1: 14× "SELECT shop.products"',
    evidence: "14 sibling spans ...",
    spanCount: 14,
    combinedDurationMs: 840,
    traceDurationMs: 1600,
    percentOfTrace: 52.5,
    normalizedSpanName: "SELECT shop.products",
    parentSpanName: "POST /api/v1/checkout",
    normalizedDbStatement: "SELECT * FROM products WHERE id = ?",
    dbSystem: "postgresql",
    implicatedSpans: [
      { spanId: "query-0", name: "SELECT shop.products", durationMs: 60 },
      { spanId: "query-1", name: "SELECT shop.products", durationMs: 60 },
    ],
    ...overrides,
  };
}

describe("which traces are worth Fix performance with AI", () => {
  test.each(
    WORTH_FIXING_TRACES.map((trace: TraceFixture): [string, TraceFixture] => {
      return [trace.title, trace];
    }),
  )("worth fixing: %s", (_title: string, trace: TraceFixture) => {
    const findings: Array<PerformanceFinding> = analyze(trace);

    expect(getFindingsWorthFixing(findings).length).toBeGreaterThan(0);
  });

  test.each(
    NOT_WORTH_FIXING_TRACES.map(
      (trace: TraceFixture): [string, TraceFixture] => {
        return [trace.title, trace];
      },
    ),
  )("not worth fixing: %s", (_title: string, trace: TraceFixture) => {
    expect(getFindingsWorthFixing(analyze(trace))).toEqual([]);
  });

  test("a slow checkout with an N+1 names the N+1: 14 queries, 840 ms of the 1.6 s request", () => {
    const worth: Array<PerformanceFinding> = getFindingsWorthFixing(
      analyze(SLOW_CHECKOUT_WITH_N_PLUS_ONE),
    );

    expect(worth).toHaveLength(1);
    expect(worth[0]!.findingType).toBe(PerformanceFindingType.NPlusOneQuery);
    expect(worth[0]!.spanCount).toBe(14);
    expect(worth[0]!.combinedDurationMs).toBe(840);
    expect(worth[0]!.traceDurationMs).toBe(1600);
    expect(worth[0]!.parentSpanName).toBe("POST /api/v1/checkout");
    expect(isDatabaseFinding(worth[0]!)).toBe(true);
    expect(getFindingOperationName(worth[0]!)).toBe(
      "SELECT products WHERE id = $1",
    );
  });

  test("the fast request has the same loop - the analysis sees it, the rule does not offer it", () => {
    const findings: Array<PerformanceFinding> = analyze(
      FAST_REQUEST_WITH_N_PLUS_ONE,
    );

    expect(
      findings.map((item: PerformanceFinding) => {
        return item.findingType;
      }),
    ).toContain(PerformanceFindingType.NPlusOneQuery);
    expect(getFindingsWorthFixing(findings)).toEqual([]);
  });

  test("a health check of one span is 'one span taking all of it' to the analysis, and nothing to fix", () => {
    const findings: Array<PerformanceFinding> = analyze(HEALTH_CHECK);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.findingType).toBe(PerformanceFindingType.DominantSpan);
    expect(findings[0]!.percentOfTrace).toBe(100);
    expect(isFindingWorthFixing(findings[0]!)).toBe(false);
  });

  test("a slow request with no known pattern has no finding at all, so nothing is offered", () => {
    expect(analyze(SLOW_REQUEST_WITHOUT_A_PATTERN)).toEqual([]);
    expect(analyze(FAST_CLEAN_REQUEST)).toEqual([]);
  });

  test("calls made one after another are offered with what they cost", () => {
    const worth: Array<PerformanceFinding> = getFindingsWorthFixing(
      analyze(SLOW_CALLS_ONE_AFTER_ANOTHER),
    );

    expect(worth).toHaveLength(1);
    expect(worth[0]!.findingType).toBe(
      PerformanceFindingType.SequentialSiblings,
    );
    expect(worth[0]!.spanCount).toBe(4);
    expect(worth[0]!.combinedDurationMs).toBe(600);
    expect(worth[0]!.parentSpanName).toBe("reserve stock");
    expect(isDatabaseFinding(worth[0]!)).toBe(false);
    // Their names differ by an id: the normalized name names them all.
    expect(getFindingOperationName(worth[0]!)).toBe("GET /inventory/{n}");
  });

  test("one slow query is offered; an ordinary 300 ms payment call is not", () => {
    const slowQuery: Array<PerformanceFinding> = getFindingsWorthFixing(
      analyze(SLOW_SINGLE_QUERY),
    );
    expect(slowQuery).toHaveLength(1);
    expect(slowQuery[0]!.findingType).toBe(PerformanceFindingType.DominantSpan);
    expect(slowQuery[0]!.combinedDurationMs).toBe(2100);

    const payment: Array<PerformanceFinding> = analyze(ORDINARY_EXTERNAL_CALL);
    expect(payment).toHaveLength(1);
    expect(payment[0]!.findingType).toBe(PerformanceFindingType.DominantSpan);
    expect(isFindingWorthFixing(payment[0]!)).toBe(false);
  });

  test("a long batch's small N+1 is too small a share of the run", () => {
    const findings: Array<PerformanceFinding> = analyze(
      LONG_BATCH_WITH_A_SMALL_N_PLUS_ONE,
    );
    const nPlusOne: PerformanceFinding | undefined = findings.find(
      (item: PerformanceFinding) => {
        return item.findingType === PerformanceFindingType.NPlusOneQuery;
      },
    );

    expect(nPlusOne?.spanCount).toBe(50);
    expect(nPlusOne?.combinedDurationMs).toBe(150);
    expect(nPlusOne!.combinedDurationMs).toBeGreaterThanOrEqual(
      WORTH_FIXING_MIN_MS[PerformanceFindingType.NPlusOneQuery],
    );
    expect(nPlusOne!.percentOfTrace).toBeLessThan(
      WORTH_FIXING_MIN_PERCENT_OF_TRACE,
    );
    expect(getFindingsWorthFixing(findings)).toEqual([]);
  });

  test("a single span that is slow on its own is worth a look", () => {
    const worth: Array<PerformanceFinding> = getFindingsWorthFixing(
      analyze(SLOW_SINGLE_SPAN),
    );

    expect(worth).toHaveLength(1);
    expect(worth[0]!.findingType).toBe(PerformanceFindingType.DominantSpan);
    expect(getFindingOperationName(worth[0]!)).toBe("POST /api/v1/import");
  });
});

describe("the thresholds", () => {
  test("are 100 ms for repeated and one-after-another calls, 500 ms for one slow call, and a tenth of the request", () => {
    expect(WORTH_FIXING_MIN_MS).toEqual({
      [PerformanceFindingType.NPlusOneQuery]: 100,
      [PerformanceFindingType.SequentialSiblings]: 100,
      [PerformanceFindingType.DominantSpan]: 500,
    });
    expect(WORTH_FIXING_MIN_PERCENT_OF_TRACE).toBe(10);
  });

  test.each([
    [PerformanceFindingType.NPlusOneQuery, 100],
    [PerformanceFindingType.SequentialSiblings, 100],
    [PerformanceFindingType.DominantSpan, 500],
  ])(
    "%s: exactly the floor is worth fixing, a tenth of a millisecond less is not",
    (findingType: PerformanceFindingType, floorMs: number) => {
      expect(
        isFindingWorthFixing(
          finding({
            findingType,
            combinedDurationMs: floorMs,
            percentOfTrace: 60,
          }),
        ),
      ).toBe(true);
      expect(
        isFindingWorthFixing(
          finding({
            findingType,
            combinedDurationMs: floorMs - 0.1,
            percentOfTrace: 60,
          }),
        ),
      ).toBe(false);
    },
  );

  test("exactly a tenth of the request is worth fixing, less is not", () => {
    expect(
      isFindingWorthFixing(
        finding({ percentOfTrace: 10, combinedDurationMs: 900 }),
      ),
    ).toBe(true);
    expect(
      isFindingWorthFixing(
        finding({ percentOfTrace: 9.9, combinedDurationMs: 900 }),
      ),
    ).toBe(false);
  });

  test("a pattern this build does not know, or numbers that are not numbers, are never offered", () => {
    expect(
      isFindingWorthFixing(
        finding({ findingType: "SomethingNew" as PerformanceFindingType }),
      ),
    ).toBe(false);
    expect(
      isFindingWorthFixing(finding({ combinedDurationMs: Number.NaN })),
    ).toBe(false);
    expect(
      isFindingWorthFixing(
        finding({ percentOfTrace: Number.POSITIVE_INFINITY }),
      ),
    ).toBe(false);
  });

  test("getFindingsWorthFixing keeps the analysis' order, the costliest first", () => {
    const big: PerformanceFinding = finding({ combinedDurationMs: 900 });
    const tooSmall: PerformanceFinding = finding({ combinedDurationMs: 20 });
    const smaller: PerformanceFinding = finding({
      findingType: PerformanceFindingType.SequentialSiblings,
      combinedDurationMs: 300,
    });

    expect(getFindingsWorthFixing([big, tooSmall, smaller])).toEqual([
      big,
      smaller,
    ]);
  });

  test("the server's refusal states the same rule, with the same numbers", () => {
    expect(TRACE_NOT_WORTH_FIXING_MESSAGE).toBe(
      "Nothing in this trace is worth an AI performance fix. Fix performance with AI acts on a known pattern that costs the request real time: the same call made 5 or more times (100 ms or more together), 3 or more calls made one after another that could run together (100 ms or more together), or one call that takes most of the request on its own (500 ms or more) - in every case at least 10% of the request.",
    );
  });
});

describe("what the trace page offers", () => {
  const slowFindings: Array<PerformanceFinding> = analyze(
    SLOW_CHECKOUT_WITH_N_PLUS_ONE,
  );

  test("a trace worth fixing, AI on, a repository connected: the fix, naming the costliest finding", () => {
    const offer: TracePerformanceFixOffer = getTracePerformanceFixOffer({
      findings: slowFindings,
      isAiEnabled: true,
      hasActiveFix: false,
      hasConnectedRepository: true,
    });

    expect(offer.offer).toBe(SuggestionOffer.Act);
    expect(offer.finding?.findingType).toBe(
      PerformanceFindingType.NPlusOneQuery,
    );
    expect(offer.findingCount).toBe(1);
  });

  test("no repository: a quiet way to connect one, still naming what was found", () => {
    const offer: TracePerformanceFixOffer = getTracePerformanceFixOffer({
      findings: slowFindings,
      isAiEnabled: true,
      hasActiveFix: false,
      hasConnectedRepository: false,
    });

    expect(offer.offer).toBe(SuggestionOffer.SetUp);
    expect(offer.finding?.spanCount).toBe(14);
  });

  test("a fix already on its way: a link to it, not a second fix", () => {
    const offer: TracePerformanceFixOffer = getTracePerformanceFixOffer({
      findings: slowFindings,
      isAiEnabled: true,
      hasActiveFix: true,
      hasConnectedRepository: false,
    });

    expect(offer.offer).toBe(SuggestionOffer.InProgress);
    expect(offer.finding).not.toBeNull();
  });

  test("AI off: nothing at all, whatever the trace", () => {
    expect(
      getTracePerformanceFixOffer({
        findings: slowFindings,
        isAiEnabled: false,
        hasActiveFix: true,
        finishedFix: FinishedFixOutcome.Fixed,
        hasConnectedRepository: true,
        blocker: NO_CREDITS,
      }),
    ).toEqual({
      offer: SuggestionOffer.None,
      finding: null,
      findingCount: 0,
      fixOutcome: null,
      blocker: null,
    });
  });

  test.each([
    FinishedFixOutcome.Fixed,
    FinishedFixOutcome.NothingToChange,
    FinishedFixOutcome.WaitingForYou,
  ])(
    "a fix that already did its work (%s): how it came out, not a second fix",
    (outcome: FinishedFixOutcome) => {
      const offer: TracePerformanceFixOffer = getTracePerformanceFixOffer({
        findings: slowFindings,
        isAiEnabled: true,
        hasActiveFix: false,
        finishedFix: outcome,
        hasConnectedRepository: true,
      });

      expect(offer.offer).toBe(SuggestionOffer.Done);
      expect(offer.fixOutcome).toBe(outcome);
      // The finding is still named: it is what the fix was about.
      expect(offer.finding?.spanCount).toBe(14);
      expect(offer.blocker).toBeNull();
    },
  );

  test("a fix in flight comes before one that is done: a reply under way is work in progress", () => {
    const offer: TracePerformanceFixOffer = getTracePerformanceFixOffer({
      findings: slowFindings,
      isAiEnabled: true,
      hasActiveFix: true,
      finishedFix: FinishedFixOutcome.Fixed,
      hasConnectedRepository: true,
    });

    expect(offer.offer).toBe(SuggestionOffer.InProgress);
    expect(offer.fixOutcome).toBeNull();
  });

  test("a finished fix is said even when the repository is gone or Code's gate says something now", () => {
    expect(
      getTracePerformanceFixOffer({
        findings: slowFindings,
        isAiEnabled: true,
        hasActiveFix: false,
        finishedFix: FinishedFixOutcome.NothingToChange,
        hasConnectedRepository: false,
        blocker: NO_CREDITS,
      }),
    ).toMatchObject({
      offer: SuggestionOffer.Done,
      fixOutcome: FinishedFixOutcome.NothingToChange,
      blocker: null,
    });
  });

  test("a finished fix on a trace that is not worth fixing is nothing: the rule comes first", () => {
    expect(
      getTracePerformanceFixOffer({
        findings: analyze(HEALTH_CHECK),
        isAiEnabled: true,
        hasActiveFix: false,
        finishedFix: FinishedFixOutcome.Fixed,
        hasConnectedRepository: true,
      }).offer,
    ).toBe(SuggestionOffer.None);
  });

  test.each([
    ["the AI credits are used up", NO_CREDITS],
    ["the repository's Runner is not online", RUNNER_OFFLINE],
  ])(
    "Code's gate says %s: the step that clears it, in Code's words, and no button",
    (_label: string, blocker: SuggestionBlocker) => {
      const offer: TracePerformanceFixOffer = getTracePerformanceFixOffer({
        findings: slowFindings,
        isAiEnabled: true,
        hasActiveFix: false,
        hasConnectedRepository: true,
        blocker,
      });

      expect(offer.offer).toBe(SuggestionOffer.SetUp);
      expect(offer.blocker).toEqual(blocker);
      expect(offer.finding?.spanCount).toBe(14);
    },
  );

  test("no repository and a blocker: the repository first - Code's gate needs one to ask about", () => {
    const offer: TracePerformanceFixOffer = getTracePerformanceFixOffer({
      findings: slowFindings,
      isAiEnabled: true,
      hasActiveFix: false,
      hasConnectedRepository: false,
      blocker: NO_CREDITS,
    });

    expect(offer.offer).toBe(SuggestionOffer.SetUp);
    expect(offer.blocker).toBeNull();
  });

  test("a fix in flight is linked whatever Code's gate says now", () => {
    expect(
      getTracePerformanceFixOffer({
        findings: slowFindings,
        isAiEnabled: true,
        hasActiveFix: true,
        hasConnectedRepository: true,
        blocker: RUNNER_OFFLINE,
      }),
    ).toMatchObject({ offer: SuggestionOffer.InProgress, blocker: null });
  });

  test("the fix itself carries neither an outcome nor a blocker", () => {
    expect(
      getTracePerformanceFixOffer({
        findings: slowFindings,
        isAiEnabled: true,
        hasActiveFix: false,
        finishedFix: null,
        hasConnectedRepository: true,
        blocker: null,
      }),
    ).toMatchObject({
      offer: SuggestionOffer.Act,
      fixOutcome: null,
      blocker: null,
    });
  });

  test.each(
    NOT_WORTH_FIXING_TRACES.map(
      (trace: TraceFixture): [string, TraceFixture] => {
        return [trace.title, trace];
      },
    ),
  )(
    "nothing worth fixing (%s): nothing at all, even with AI on and a repository",
    (_title: string, trace: TraceFixture) => {
      expect(
        getTracePerformanceFixOffer({
          findings: analyze(trace),
          isAiEnabled: true,
          hasActiveFix: false,
          hasConnectedRepository: true,
        }),
      ).toEqual({
        offer: SuggestionOffer.None,
        finding: null,
        findingCount: 0,
        fixOutcome: null,
        blocker: null,
      });
    },
  );

  test("only the findings worth fixing are counted, and the first of them is named", () => {
    const small: PerformanceFinding = finding({
      findingType: PerformanceFindingType.SequentialSiblings,
      combinedDurationMs: 40,
    });
    const large: PerformanceFinding = finding({ combinedDurationMs: 700 });
    const medium: PerformanceFinding = finding({
      findingType: PerformanceFindingType.DominantSpan,
      combinedDurationMs: 600,
      percentOfTrace: 70,
    });

    const offer: TracePerformanceFixOffer = getTracePerformanceFixOffer({
      findings: [small, large, medium],
      isAiEnabled: true,
      hasActiveFix: false,
      hasConnectedRepository: true,
    });

    expect(offer.finding).toBe(large);
    expect(offer.findingCount).toBe(2);
  });
});

describe("the operation a finding names", () => {
  test("the spans' own name when they all share it", () => {
    expect(getFindingOperationName(finding())).toBe("SELECT shop.products");
  });

  test("the normalized name when their names differ by an id", () => {
    expect(
      getFindingOperationName(
        finding({
          normalizedSpanName: "GET /users/{n}",
          implicatedSpans: [
            { spanId: "a", name: "GET /users/1", durationMs: 50 },
            { spanId: "b", name: "GET /users/2", durationMs: 50 },
          ],
        }),
      ),
    ).toBe("GET /users/{n}");
  });

  test("the normalized name when no span is listed", () => {
    expect(
      getFindingOperationName(
        finding({ normalizedSpanName: "fetch {id}", implicatedSpans: [] }),
      ),
    ).toBe("fetch {id}");
  });

  test("database work is database work by its system or its statement", () => {
    expect(isDatabaseFinding(finding())).toBe(true);
    expect(
      isDatabaseFinding(
        finding({ dbSystem: undefined, normalizedDbStatement: "SELECT 1" }),
      ),
    ).toBe(true);
    expect(
      isDatabaseFinding(
        finding({ dbSystem: "redis", normalizedDbStatement: undefined }),
      ),
    ).toBe(true);
    expect(
      isDatabaseFinding(
        finding({ dbSystem: undefined, normalizedDbStatement: undefined }),
      ),
    ).toBe(false);
  });
});

describe("the wire format the trace page reads", () => {
  const suggestion: TracePerformanceFixSuggestion = {
    offer: SuggestionOffer.Act,
    finding: finding(),
    findingCount: 2,
    fixOutcome: null,
    blocker: null,
    aiRunId: null,
    repositories: [],
  };

  test("round-trips through JSON unchanged", () => {
    const json: JSONObject = JSON.parse(
      JSON.stringify(tracePerformanceFixSuggestionToJSON(suggestion)),
    ) as JSONObject;

    expect(parseTracePerformanceFixSuggestion(json)).toEqual(suggestion);
  });

  test("an in-progress offer carries the run to link to", () => {
    const inProgress: TracePerformanceFixSuggestion = {
      ...suggestion,
      offer: SuggestionOffer.InProgress,
      aiRunId: "70000000-0000-4000-8000-000000000009",
    };

    expect(
      parseTracePerformanceFixSuggestion(
        tracePerformanceFixSuggestionToJSON(inProgress),
      ),
    ).toEqual(inProgress);
  });

  test.each([
    FinishedFixOutcome.Fixed,
    FinishedFixOutcome.NothingToChange,
    FinishedFixOutcome.WaitingForYou,
  ])(
    "a done offer carries its run and how it came out (%s), through JSON",
    (outcome: FinishedFixOutcome) => {
      const done: TracePerformanceFixSuggestion = {
        ...suggestion,
        offer: SuggestionOffer.Done,
        fixOutcome: outcome,
        aiRunId: "70000000-0000-4000-8000-000000000010",
      };

      expect(
        parseTracePerformanceFixSuggestion(
          JSON.parse(
            JSON.stringify(tracePerformanceFixSuggestionToJSON(done)),
          ) as JSONObject,
        ),
      ).toEqual(done);
    },
  );

  test.each([
    ["the AI credits are used up", NO_CREDITS],
    ["a named Runner of one repository is not online", RUNNER_OFFLINE],
  ])(
    "a set-up step carries Code's blocker (%s), through JSON",
    (_label: string, blocker: SuggestionBlocker) => {
      const setUp: TracePerformanceFixSuggestion = {
        ...suggestion,
        offer: SuggestionOffer.SetUp,
        blocker,
      };

      expect(
        parseTracePerformanceFixSuggestion(
          JSON.parse(
            JSON.stringify(tracePerformanceFixSuggestionToJSON(setUp)),
          ) as JSONObject,
        ),
      ).toEqual(setUp);
    },
  );

  test("a set-up step with no blocker is a repository to connect, as servers before blockers answered", () => {
    const parsed: TracePerformanceFixSuggestion =
      parseTracePerformanceFixSuggestion({
        offer: "SetUp",
        finding: finding(),
        findingCount: 1,
        aiRunId: null,
      });

    expect(parsed.offer).toBe(SuggestionOffer.SetUp);
    expect(parsed.blocker).toBeNull();
  });

  test("an outcome or a blocker on an offer that does not carry one is dropped", () => {
    const parsed: TracePerformanceFixSuggestion =
      parseTracePerformanceFixSuggestion({
        offer: "Act",
        finding: finding(),
        findingCount: 1,
        fixOutcome: FinishedFixOutcome.Fixed,
        blocker: { type: CodeTaskBlockerType.NoAiCredits, message: "Out." },
        aiRunId: null,
      });

    expect(parsed.offer).toBe(SuggestionOffer.Act);
    expect(parsed.fixOutcome).toBeNull();
    expect(parsed.blocker).toBeNull();
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", []],
    ["a string", "Act"],
    ["no offer", { finding: finding() }],
    ["an unknown offer", { offer: "Maybe", finding: finding() }],
    ["None", { offer: "None", finding: finding() }],
    ["an offer with no finding", { offer: "Act" }],
    [
      "a finding of a kind this build does not know",
      { offer: "Act", finding: { ...finding(), findingType: "Other" } },
    ],
    [
      "a finding with no numbers",
      { offer: "Act", finding: { ...finding(), combinedDurationMs: "840" } },
    ],
    [
      "a finding the rule would not offer",
      { offer: "Act", finding: finding({ combinedDurationMs: 12 }) },
    ],
    [
      "in progress with no run",
      { offer: "InProgress", finding: finding(), aiRunId: "" },
    ],
    [
      "done with no run",
      { offer: "Done", finding: finding(), fixOutcome: "Fixed" },
    ],
    [
      "done that does not say how it came out",
      {
        offer: "Done",
        finding: finding(),
        aiRunId: "70000000-0000-4000-8000-000000000010",
      },
    ],
    [
      "done with an outcome this build does not know",
      {
        offer: "Done",
        finding: finding(),
        fixOutcome: "Merged",
        aiRunId: "70000000-0000-4000-8000-000000000010",
      },
    ],
    [
      "a set-up step whose blocker is of a kind this build does not know",
      {
        offer: "SetUp",
        finding: finding(),
        blocker: { type: "MoonPhase", message: "Not tonight." },
      },
    ],
    [
      "a set-up step whose blocker says nothing",
      {
        offer: "SetUp",
        finding: finding(),
        blocker: { type: CodeTaskBlockerType.NoAiCredits, message: "  " },
      },
    ],
    [
      "a set-up step whose blocker is not an object",
      { offer: "SetUp", finding: finding(), blocker: "NoAiCredits" },
    ],
  ])("%s reads as no suggestion", (_label: string, value: unknown) => {
    expect(parseTracePerformanceFixSuggestion(value)).toEqual(
      NO_TRACE_PERFORMANCE_FIX_SUGGESTION,
    );
  });

  test("a run id on an offer that is not in progress is dropped", () => {
    expect(
      parseTracePerformanceFixSuggestion({
        offer: "Act",
        finding: finding(),
        findingCount: 1,
        aiRunId: "70000000-0000-4000-8000-000000000009",
      }).aiRunId,
    ).toBeNull();
  });

  test("a missing or odd count reads as one finding", () => {
    expect(
      parseTracePerformanceFixSuggestion({ offer: "SetUp", finding: finding() })
        .findingCount,
    ).toBe(1);
    expect(
      parseTracePerformanceFixSuggestion({
        offer: "SetUp",
        finding: finding(),
        findingCount: -3,
      }).findingCount,
    ).toBe(1);
  });

  test("a finding keeps only well-formed implicated spans and optional fields", () => {
    const parsed: PerformanceFinding | null = parsePerformanceFinding({
      ...finding(),
      implicatedSpans: [
        { spanId: "a", name: "SELECT 1", durationMs: 4 },
        { spanId: "b", name: 7, durationMs: 4 },
        "not a span",
      ],
      parentSpanName: "",
      httpUrl: "https://inventory.internal/items",
      percentOfParent: 75,
    });

    expect(parsed?.implicatedSpans).toEqual([
      { spanId: "a", name: "SELECT 1", durationMs: 4 },
    ]);
    expect(parsed?.parentSpanName).toBeUndefined();
    expect(parsed?.httpUrl).toBe("https://inventory.internal/items");
    expect(parsed?.percentOfParent).toBe(75);
  });
});

/*
 * The repositories the trace page offers to pick from, when several are
 * connected and none was found to hold the trace's code for certain.
 */
describe("the repositories to pick the fix's repository from", () => {
  const ACT: TracePerformanceFixSuggestion = {
    offer: SuggestionOffer.Act,
    finding: finding(),
    findingCount: 1,
    fixOutcome: null,
    blocker: null,
    aiRunId: null,
    repositories: [
      { id: "51000000-0000-4000-8000-000000000002", name: "billing" },
      { id: "51000000-0000-4000-8000-000000000001", name: "checkout-api" },
    ],
  };

  function wire(
    suggestion: TracePerformanceFixSuggestion,
    repositories?: unknown,
  ): JSONObject {
    const json: JSONObject = JSON.parse(
      JSON.stringify(tracePerformanceFixSuggestionToJSON(suggestion)),
    ) as JSONObject;

    if (repositories !== undefined) {
      json["repositories"] = repositories as JSONObject;
    }

    return json;
  }

  test("an offer of the fix carries them, in the server's order, through JSON", () => {
    expect(parseTracePerformanceFixSuggestion(wire(ACT))).toEqual(ACT);
  });

  test("one repository is no choice: read as none", () => {
    expect(
      parseTracePerformanceFixSuggestion(
        wire(ACT, [
          { id: "51000000-0000-4000-8000-000000000002", name: "billing" },
        ]),
      ).repositories,
    ).toEqual([]);
  });

  test("an entry that is not whole is left out, and each repository is listed once", () => {
    expect(
      parseTracePerformanceFixSuggestion(
        wire(ACT, [
          { id: "51000000-0000-4000-8000-000000000002", name: "billing" },
          {
            id: "51000000-0000-4000-8000-000000000002".toUpperCase(),
            name: "billing again",
          },
          { id: "", name: "no id" },
          { id: "51000000-0000-4000-8000-000000000004", name: "  " },
          { id: 7, name: "a number" },
          "checkout-api",
          null,
          {
            id: " 51000000-0000-4000-8000-000000000001 ",
            name: " checkout-api ",
          },
        ]),
      ).repositories,
    ).toEqual([
      { id: "51000000-0000-4000-8000-000000000002", name: "billing" },
      { id: "51000000-0000-4000-8000-000000000001", name: "checkout-api" },
    ]);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["an object", { id: "x", name: "y" }],
    ["a string", "billing"],
  ])("%s is no list", (_name: string, value: unknown) => {
    const json: JSONObject = wire(ACT);
    json["repositories"] = value as JSONObject;

    expect(parseTracePerformanceFixSuggestion(json).repositories).toEqual([]);
  });

  test("at most MAX_TRACE_PERFORMANCE_FIX_REPOSITORIES are read", () => {
    const many: Array<JSONObject> = [];

    for (
      let index: number = 0;
      index < MAX_TRACE_PERFORMANCE_FIX_REPOSITORIES + 50;
      index++
    ) {
      many.push({
        id: `51000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        name: `repository-${index}`,
      });
    }

    expect(
      parseTracePerformanceFixSuggestion(wire(ACT, many)).repositories,
    ).toHaveLength(MAX_TRACE_PERFORMANCE_FIX_REPOSITORIES);
  });

  test.each([
    [
      SuggestionOffer.InProgress,
      { aiRunId: "70000000-0000-4000-8000-000000000009" },
    ],
    [
      SuggestionOffer.Done,
      {
        aiRunId: "70000000-0000-4000-8000-000000000010",
        fixOutcome: FinishedFixOutcome.Fixed,
      },
    ],
    [SuggestionOffer.SetUp, { blocker: NO_CREDITS }],
  ])(
    "an offer that is not the fix (%s) carries none, whatever was sent",
    (offer: SuggestionOffer, extra: Partial<TracePerformanceFixSuggestion>) => {
      const other: TracePerformanceFixSuggestion = {
        ...ACT,
        ...extra,
        offer,
      };

      expect(
        parseTracePerformanceFixSuggestion(wire(other)).repositories,
      ).toEqual([]);
    },
  );

  test("no suggestion offers none", () => {
    expect(NO_TRACE_PERFORMANCE_FIX_SUGGESTION.repositories).toEqual([]);
    expect(
      parseTracePerformanceFixRepositories([
        { id: "a", name: "one" },
        { id: "b", name: "two" },
      ]),
    ).toEqual([
      { id: "a", name: "one" },
      { id: "b", name: "two" },
    ]);
  });

  test("the server's refusals say what to do", () => {
    expect(PICK_A_REPOSITORY_FOR_THE_FIX_MESSAGE).toBe(
      "Several repositories are connected, and none could be matched to this trace's service or code. Pick the one that holds this code.",
    );
    expect(PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE).toBe(
      "That repository is not one of this project's connected repositories OneUptime AI can work in. Pick another, or connect it in Code.",
    );
  });
});
