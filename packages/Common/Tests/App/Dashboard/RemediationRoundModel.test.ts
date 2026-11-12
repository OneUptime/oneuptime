import { describe, expect, test } from "@jest/globals";
import {
  getCurrentRemediationRound,
  getRemediationRoundRetryWait,
  hasRemediationRoundDetails,
  isRemediationRoundLive,
  isRemediationRoundUnfinished,
  parseRemediationRoundView,
  RemediationRoundView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationRoundView";
import { getRemediationRoundApprovalLine } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationRoundDetails";
import {
  getRemediationFixSteps,
  RemediationFixStep,
  RemediationFixStepSuggestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationFixSteps";
import {
  getRemediationFixFacts,
  getRemediationStepStatus,
  REMEDIATION_STEP_STATUS_TEXT,
  RemediationFixFacts,
  RemediationStepStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepStatus";
import {
  REMEDIATION_FIX_STEP_COPY,
  REMEDIATION_ROUND_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import { formatAiRunTime } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiRunFailureWords";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import {
  AIRunAttemptOutcome,
  AIRunFailureKind,
} from "../../../Types/AI/AIRunAttempt";
import {
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import { RemediationRoundAppliedSteps } from "../../../Types/AutoRemediation/RemediationRound";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * A ROUND OF AN AI FIX, AS THE REMEDIATION STEP READS IT (issues #6436,
 * #6487): the server's answer read into the step's model, which round is
 * the fix's own, when it stopped rather than found nothing, when it is at
 * work or waits to try again on its own, and how the fix's plan step, its
 * fact and the step's pill say it.
 */

const FIX_ID: string = "0193c0de-6666-4aaa-8bbb-000000000081";
const RUN_ID: string = "0193c0de-7777-4aaa-8bbb-000000000082";
const OTHER_RUN_ID: string = "0193c0de-7777-4aaa-8bbb-000000000083";
const AT_PLANNED: string = "2026-11-09T10:00:00.000Z";
const AT_ENDED: string = "2026-11-09T10:06:00.000Z";

const NOTHING_APPLIED: RemediationRoundAppliedSteps = {
  commandCount: 0,
  changeCount: 0,
  isRunbookStarted: false,
};

function runEvent(
  eventType: AIRunEventType,
  resultSummary: JSONObject = {},
): AIRunEvent {
  return Object.assign(new AIRunEvent(), { eventType, resultSummary });
}

function round(data: {
  runStatus?: AIRunStatus | null;
  events?: Array<AIRunEvent>;
  errorMessage?: string;
  extra?: Partial<RemediationRoundView>;
}): RemediationRoundView {
  return {
    suggestionId: FIX_ID,
    aiRunId: RUN_ID,
    run:
      data.runStatus === null
        ? null
        : Object.assign(new AIRun(), {
            status: data.runStatus || AIRunStatus.Error,
            completedAt: new Date(AT_ENDED),
            ...(data.errorMessage ? { errorMessage: data.errorMessage } : {}),
          }),
    events: data.events || [],
    checks: [],
    otherCheckCount: 0,
    explanation: null,
    appliedSteps: NOTHING_APPLIED,
    mayTryAgain: false,
    ...(data.extra || {}),
  };
}

function gaveUp(failureKind: AIRunFailureKind): AIRunEvent {
  return runEvent(AIRunEventType.RunFailed, {
    attemptEnd: {
      outcome: AIRunAttemptOutcome.GaveUp,
      failureKind,
      attempt: 1,
      maxAttempts: 1,
    },
  });
}

function fix(
  status: AutoRemediationSuggestionStatus,
  extra: JSONObject = {},
): RemediationFixStepSuggestion {
  return {
    _id: FIX_ID,
    status,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    createdAt: new Date(AT_PLANNED),
    ...extra,
  } as unknown as RemediationFixStepSuggestion;
}

function stepsOf(
  suggestion: RemediationFixStepSuggestion,
  view: RemediationRoundView | undefined,
): Array<RemediationFixStep> {
  return getRemediationFixSteps({ suggestion, round: view });
}

describe("parseRemediationRoundView: the server's answer, read", () => {
  test("reads the run, its events, its checks, the explanation, what it changed and whether the reader may try it again", () => {
    const view: RemediationRoundView = parseRemediationRoundView({
      suggestionId: FIX_ID,
      aiRunId: RUN_ID,
      json: {
        run: {
          _id: RUN_ID,
          status: AIRunStatus.Error,
          errorMessage: "timed out",
          completedAt: { _type: "DateTime", value: AT_ENDED },
        },
        events: [
          { eventType: AIRunEventType.RunStarted, sequence: 1 },
          {
            eventType: AIRunEventType.RunFailed,
            sequence: 2,
            resultSummary: { errorMessage: "timed out" },
          },
        ],
        checks: [
          {
            command: "kubectl get pods",
            why: "",
            status: "ran",
            at: AT_PLANNED,
            error: "",
          },
          // Anything this build cannot read is left out.
          { command: "kubectl get nodes", status: "exploded" },
        ],
        otherCheckCount: 4,
        explanation: {
          reason: "Nothing safe applies.",
          ruledOutFixes: [{ fix: "Restart", whyNot: "No effect." }],
        },
        appliedSteps: { commandCount: 0, changeCount: 0 },
        mayTryAgain: true,
      },
    });

    expect(view.suggestionId).toBe(FIX_ID);
    expect(view.aiRunId).toBe(RUN_ID);
    expect(view.run?.status).toBe(AIRunStatus.Error);
    expect(view.run?.errorMessage).toBe("timed out");
    expect(view.run?.completedAt).toEqual(new Date(AT_ENDED));
    expect(
      view.events.map((event: AIRunEvent): AIRunEventType | undefined => {
        return event.eventType;
      }),
    ).toEqual([AIRunEventType.RunStarted, AIRunEventType.RunFailed]);
    expect(view.checks).toEqual([
      {
        command: "kubectl get pods",
        why: "",
        status: "ran",
        at: AT_PLANNED,
        error: "",
      },
    ]);
    expect(view.otherCheckCount).toBe(4);
    expect(view.explanation).toEqual({
      reason: "Nothing safe applies.",
      ruledOutFixes: [{ fix: "Restart", commands: [], whyNot: "No effect." }],
    });
    expect(view.appliedSteps).toEqual(NOTHING_APPLIED);
    expect(view.mayTryAgain).toBe(true);
  });

  test("an answer it cannot read reads as a round with nothing in it, that may not be tried again", () => {
    for (const json of [
      {},
      {
        run: "a run",
        events: "events",
        checks: { command: "x" },
        otherCheckCount: "3",
        explanation: [],
        appliedSteps: null,
        mayTryAgain: "true",
      },
    ] as Array<JSONObject>) {
      expect(
        parseRemediationRoundView({
          json,
          suggestionId: FIX_ID,
          aiRunId: RUN_ID,
        }),
      ).toEqual({
        suggestionId: FIX_ID,
        aiRunId: RUN_ID,
        run: null,
        events: [],
        checks: [],
        otherCheckCount: 0,
        explanation: null,
        appliedSteps: NOTHING_APPLIED,
        mayTryAgain: false,
      });
    }
  });

  test("a count is a whole number, never below none", () => {
    for (const [written, read] of [
      [2.7, 2],
      [-3, 0],
      [Number.POSITIVE_INFINITY, 0],
    ] as Array<[number, number]>) {
      expect(
        parseRemediationRoundView({
          json: { otherCheckCount: written },
          suggestionId: FIX_ID,
          aiRunId: RUN_ID,
        }).otherCheckCount,
      ).toBe(read);
    }
  });
});

describe("getCurrentRemediationRound: a round is its run's", () => {
  const rounds: Map<string, RemediationRoundView> = new Map<
    string,
    RemediationRoundView
  >([[FIX_ID, round({})]]);

  test("the round read for the fix's run is its round", () => {
    expect(
      getCurrentRemediationRound(rounds, {
        _id: FIX_ID,
        aiRunId: new ObjectID(RUN_ID),
      } as AutoRemediationSuggestion),
    ).toBe(rounds.get(FIX_ID));
  });

  test("one read for its older run is not - the fix was tried again since", () => {
    expect(
      getCurrentRemediationRound(rounds, {
        _id: FIX_ID,
        aiRunId: new ObjectID(OTHER_RUN_ID),
      } as AutoRemediationSuggestion),
    ).toBeUndefined();
  });

  test("another fix has none", () => {
    expect(
      getCurrentRemediationRound(rounds, {
        _id: "0193c0de-6666-4aaa-8bbb-000000000099",
        aiRunId: new ObjectID(RUN_ID),
      } as AutoRemediationSuggestion),
    ).toBeUndefined();
  });
});

describe("isRemediationRoundUnfinished: it stopped, rather than found nothing", () => {
  test.each([
    [AutoRemediationSuggestionStatus.NoneApplicable, AIRunStatus.Error, true],
    [AutoRemediationSuggestionStatus.NoneApplicable, AIRunStatus.Stale, true],
    [
      AutoRemediationSuggestionStatus.NoneApplicable,
      AIRunStatus.Cancelled,
      true,
    ],
    [AutoRemediationSuggestionStatus.Planning, AIRunStatus.Error, true],
    // It finished: what it found stands.
    [
      AutoRemediationSuggestionStatus.NoneApplicable,
      AIRunStatus.Completed,
      false,
    ],
    [
      AutoRemediationSuggestionStatus.NoneApplicable,
      AIRunStatus.NoFixFound,
      false,
    ],
    // It is at work, or waits to try again on its own.
    [AutoRemediationSuggestionStatus.Planning, AIRunStatus.Running, false],
    [AutoRemediationSuggestionStatus.Planning, AIRunStatus.Queued, false],
    // A fix that got its answer is never "did not finish".
    [AutoRemediationSuggestionStatus.Suggested, AIRunStatus.Error, false],
    [AutoRemediationSuggestionStatus.AutoExecuted, AIRunStatus.Stale, false],
    [AutoRemediationSuggestionStatus.Dismissed, AIRunStatus.Error, false],
  ])(
    "a fix that is %s with a run that is %s: %s",
    (
      status: AutoRemediationSuggestionStatus,
      runStatus: AIRunStatus,
      expected: boolean,
    ) => {
      expect(
        isRemediationRoundUnfinished({ status, round: round({ runStatus }) }),
      ).toBe(expected);
    },
  );

  test("a round not read yet, or with no run, is not said to have stopped", () => {
    expect(
      isRemediationRoundUnfinished({
        status: AutoRemediationSuggestionStatus.NoneApplicable,
        round: undefined,
      }),
    ).toBe(false);
    expect(
      isRemediationRoundUnfinished({
        status: AutoRemediationSuggestionStatus.NoneApplicable,
        round: round({ runStatus: null }),
      }),
    ).toBe(false);
  });
});

describe("isRemediationRoundLive and getRemediationRoundRetryWait: a round at work", () => {
  test("a fix being worked out is live until its run ends", () => {
    for (const [runStatus, expected] of [
      [AIRunStatus.Queued, true],
      [AIRunStatus.Running, true],
      [AIRunStatus.WaitingForApproval, true],
      [AIRunStatus.Error, false],
      [AIRunStatus.Completed, false],
    ] as Array<[AIRunStatus, boolean]>) {
      expect(
        isRemediationRoundLive({
          status: AutoRemediationSuggestionStatus.Planning,
          round: round({ runStatus }),
        }),
      ).toBe(expected);
    }

    // Not read yet: it is read until it says.
    expect(
      isRemediationRoundLive({
        status: AutoRemediationSuggestionStatus.Planning,
        round: undefined,
      }),
    ).toBe(true);
    expect(
      isRemediationRoundLive({
        status: AutoRemediationSuggestionStatus.NoneApplicable,
        round: round({ runStatus: AIRunStatus.Running }),
      }),
    ).toBe(false);
  });

  const nextAttemptAt: string = "2026-11-09T10:15:00.000Z";

  function willRetry(): AIRunEvent {
    return runEvent(AIRunEventType.AttemptEnded, {
      attemptEnd: {
        outcome: AIRunAttemptOutcome.WillRetry,
        failureKind: AIRunFailureKind.ProviderUnavailable,
        attempt: 1,
        maxAttempts: 3,
        nextAttemptAt,
      },
    });
  }

  test("a queued run whose last attempt will be tried again says when", () => {
    expect(
      getRemediationRoundRetryWait(
        round({
          runStatus: AIRunStatus.Queued,
          events: [runEvent(AIRunEventType.RunStarted), willRetry()],
        }),
      ),
    ).toMatchObject({
      outcome: AIRunAttemptOutcome.WillRetry,
      nextAttemptAt,
    });
  });

  test("an attempt started since, a run not queued, or no attempt that ended, has no wait", () => {
    expect(
      getRemediationRoundRetryWait(
        round({
          runStatus: AIRunStatus.Queued,
          events: [willRetry(), runEvent(AIRunEventType.RunStarted)],
        }),
      ),
    ).toBeNull();
    expect(
      getRemediationRoundRetryWait(
        round({ runStatus: AIRunStatus.Running, events: [willRetry()] }),
      ),
    ).toBeNull();
    expect(
      getRemediationRoundRetryWait(
        round({ runStatus: AIRunStatus.Queued, events: [] }),
      ),
    ).toBeNull();
    expect(
      getRemediationRoundRetryWait(
        round({
          runStatus: AIRunStatus.Queued,
          events: [gaveUp(AIRunFailureKind.Other)],
        }),
      ),
    ).toBeNull();
    expect(getRemediationRoundRetryWait(undefined)).toBeNull();
  });
});

describe("hasRemediationRoundDetails", () => {
  test("a round has details once it checked something or explained itself", () => {
    expect(hasRemediationRoundDetails(undefined)).toBe(false);
    expect(hasRemediationRoundDetails(round({}))).toBe(false);
    expect(
      hasRemediationRoundDetails(
        round({
          extra: {
            checks: [
              {
                command: "kubectl get pods",
                why: "",
                status: "ran",
                at: "",
                error: "",
              },
            ],
          },
        }),
      ),
    ).toBe(true);
    expect(
      hasRemediationRoundDetails(round({ extra: { otherCheckCount: 1 } })),
    ).toBe(true);
    expect(
      hasRemediationRoundDetails(
        round({ extra: { explanation: { reason: "x", ruledOutFixes: [] } } }),
      ),
    ).toBe(true);
  });
});

describe("getRemediationRoundApprovalLine: did anything run, was anyone asked", () => {
  test.each([
    [
      "a fix that found none",
      AutoRemediationSuggestionStatus.NoneApplicable,
      false,
      false,
      REMEDIATION_ROUND_COPY.nothingAskedNoFix,
    ],
    [
      "a runbook pick that found none",
      AutoRemediationSuggestionStatus.NoneApplicable,
      true,
      false,
      REMEDIATION_ROUND_COPY.nothingAskedNoRunbook,
    ],
    [
      "a fix that stopped",
      AutoRemediationSuggestionStatus.NoneApplicable,
      false,
      true,
      REMEDIATION_ROUND_COPY.nothingAskedUnfinished,
    ],
    [
      "a runbook pick that stopped",
      AutoRemediationSuggestionStatus.Planning,
      true,
      true,
      REMEDIATION_ROUND_COPY.nothingAskedUnfinishedRunbook,
    ],
    [
      "a fix waiting for approval",
      AutoRemediationSuggestionStatus.Suggested,
      false,
      false,
      null,
    ],
    [
      "a fix being worked out",
      AutoRemediationSuggestionStatus.Planning,
      false,
      false,
      null,
    ],
    [
      "a fix that ran",
      AutoRemediationSuggestionStatus.AutoExecuted,
      false,
      false,
      null,
    ],
  ])(
    "%s",
    (
      _label: string,
      status: AutoRemediationSuggestionStatus,
      isRunbook: boolean,
      isUnfinished: boolean,
      expected: string | null,
    ) => {
      expect(
        getRemediationRoundApprovalLine({ status, isRunbook, isUnfinished }),
      ).toBe(expected);
    },
  );

  test("a round that made a change is never said to have run nothing", () => {
    for (const isUnfinished of [true, false]) {
      expect(
        getRemediationRoundApprovalLine({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          isRunbook: false,
          isUnfinished,
          hasAppliedSteps: true,
        }),
      ).toBeNull();
    }
  });

  test("the words say no fix ran and nobody was asked, and when approval is asked", () => {
    expect(REMEDIATION_ROUND_COPY.nothingAskedNoFix).toBe(
      "No fix ran, and nobody was asked to approve one: OneUptime AI asks for approval only when it proposes a fix.",
    );
    /*
     * The step's title already says it stopped before it found a fix:
     * the line does not say it again.
     */
    expect(REMEDIATION_ROUND_COPY.nothingAskedUnfinished).toBe(
      "No fix ran, and nobody was asked to approve one.",
    );
    expect(REMEDIATION_ROUND_COPY.nothingAskedUnfinishedRunbook).toBe(
      "No runbook ran, and nobody was asked to approve one.",
    );
  });
});

describe("getRemediationFixSteps: the plan step of a fix with a round", () => {
  test("a fix whose round stopped says so, and why, as its only step - never that it found no safe fix", () => {
    const steps: Array<RemediationFixStep> = stepsOf(
      fix(AutoRemediationSuggestionStatus.NoneApplicable, {
        rationaleMarkdown:
          "The AI fix did not finish — the planning run failed.",
      }),
      round({
        runStatus: AIRunStatus.Error,
        events: [
          runEvent(AIRunEventType.RunStarted),
          gaveUp(AIRunFailureKind.ProviderUnavailable),
        ],
      }),
    );

    expect(steps).toEqual([
      {
        kind: "plan",
        tone: "failed",
        title: REMEDIATION_ROUND_COPY.unfinishedFix,
        summary:
          "The LLM provider could not be reached, or was too busy to answer.",
        isSummaryWritten: false,
        // Its notice starts with the same words: the open step says them once.
        isSummaryInDetails: true,
        at: new Date(AT_ENDED),
        hasDetails: true,
      },
    ]);
    expect(steps[0]!.title).toBe("Stopped before it found a fix");
  });

  test("a runbook pick that stopped says it stopped before it picked one", () => {
    expect(
      stepsOf(
        fix(AutoRemediationSuggestionStatus.NoneApplicable, {
          suggestionType: AutoRemediationSuggestionType.Runbook,
        }),
        round({ runStatus: AIRunStatus.Stale }),
      )[0]!.title,
    ).toBe("Stopped before it picked a runbook");
  });

  test("a failure its events do not name is read from the run's error", () => {
    expect(
      stepsOf(
        fix(AutoRemediationSuggestionStatus.NoneApplicable),
        round({
          runStatus: AIRunStatus.Error,
          errorMessage:
            "OpenAI API request failed: 401 Incorrect API key provided",
        }),
      )[0]!.summary,
    ).toBe(
      "The LLM provider refused the request: its API key or model may be wrong, or its account may lack access or credit.",
    );
  });

  test("a fix that found none says why in the AI's words, over its longer reasoning", () => {
    const steps: Array<RemediationFixStep> = stepsOf(
      fix(AutoRemediationSuggestionStatus.NoneApplicable, {
        rationaleMarkdown: "A long answer.",
      }),
      round({
        runStatus: AIRunStatus.Completed,
        extra: {
          explanation: {
            reason: "Every pod is Pending: the cluster has no free memory.",
            ruledOutFixes: [],
          },
        },
      }),
    );

    expect(steps[0]).toMatchObject({
      kind: "plan",
      tone: "idle",
      title: REMEDIATION_FIX_STEP_COPY.noSafeFix,
      summary: "Every pod is Pending: the cluster has no free memory.",
      isSummaryWritten: true,
      hasDetails: true,
    });
  });

  test("a fix that found none without a round, or with no explanation, reads its reasoning - and always opens", () => {
    for (const view of [
      undefined,
      round({ runStatus: AIRunStatus.Completed }),
    ]) {
      expect(
        stepsOf(
          fix(AutoRemediationSuggestionStatus.NoneApplicable, {
            rationaleMarkdown: "Nothing safe to change.",
          }),
          view,
        )[0],
      ).toMatchObject({
        title: REMEDIATION_FIX_STEP_COPY.noSafeFix,
        summary: "Nothing safe to change.",
        hasDetails: true,
      });
    }

    // With nothing written at all, it still opens: nothing ran, nobody was asked.
    expect(
      stepsOf(
        fix(AutoRemediationSuggestionStatus.NoneApplicable),
        undefined,
      )[0],
    ).toMatchObject({ summary: null, hasDetails: true });
  });

  test("a fix being worked out opens to what it checked so far; one waiting to try again says why and when", () => {
    const working: RemediationFixStep = stepsOf(
      fix(AutoRemediationSuggestionStatus.Planning),
      round({
        runStatus: AIRunStatus.Running,
        extra: { otherCheckCount: 2 },
      }),
    )[0]!;

    expect(working).toMatchObject({
      kind: "plan",
      tone: "live",
      title: REMEDIATION_FIX_STEP_COPY.composing,
      summary: null,
      hasDetails: true,
    });

    const nextAttemptAt: Date = new Date("2026-11-09T10:15:00.000Z");
    const waiting: RemediationFixStep = stepsOf(
      fix(AutoRemediationSuggestionStatus.Planning),
      round({
        runStatus: AIRunStatus.Queued,
        events: [
          runEvent(AIRunEventType.RunStarted),
          runEvent(AIRunEventType.AttemptEnded, {
            attemptEnd: {
              outcome: AIRunAttemptOutcome.WillRetry,
              failureKind: AIRunFailureKind.ProviderTimeout,
              timeoutInSeconds: 90,
              attempt: 1,
              maxAttempts: 3,
              nextAttemptAt: nextAttemptAt.toISOString(),
            },
          }),
        ],
      }),
    )[0]!;

    expect(waiting.tone).toBe("live");
    expect(waiting.summary).toBe(
      `Did not finish: The LLM provider did not answer within 90 seconds. Trying again at ${formatAiRunTime(nextAttemptAt)}.`,
    );
    // Nothing checked yet: nothing to open.
    expect(waiting.hasDetails).toBe(false);
  });

  test("negative control: a fix being worked out with no round read has nothing to open", () => {
    expect(
      stepsOf(fix(AutoRemediationSuggestionStatus.Planning), undefined)[0],
    ).toMatchObject({ tone: "live", summary: null, hasDetails: false });
  });

  /*
   * A round tried again (issue #6487) started well after its fix was
   * first worked out: "Working out a fix…" said the first time.
   */
  test("the plan step says when its round started: a round tried again, when it started again", () => {
    const AT_TRIED_AGAIN: string = "2026-11-09T11:30:00.000Z";
    const triedAgain: RemediationRoundView = round({
      runStatus: AIRunStatus.Running,
      extra: {
        run: Object.assign(new AIRun(), {
          status: AIRunStatus.Running,
          createdAt: new Date(AT_TRIED_AGAIN),
        }),
      },
    });

    expect(
      stepsOf(fix(AutoRemediationSuggestionStatus.Planning), triedAgain)[0]!.at,
    ).toEqual(new Date(AT_TRIED_AGAIN));
    expect(
      stepsOf(
        fix(AutoRemediationSuggestionStatus.NoneApplicable),
        Object.assign({}, triedAgain, {
          run: Object.assign(new AIRun(), {
            status: AIRunStatus.Completed,
            createdAt: new Date(AT_TRIED_AGAIN),
          }),
        }),
      )[0]!.at,
    ).toEqual(new Date(AT_TRIED_AGAIN));

    // Negative control: before its round is read, the fix's own time.
    expect(
      stepsOf(fix(AutoRemediationSuggestionStatus.Planning), undefined)[0]!.at,
    ).toEqual(new Date(AT_PLANNED));
  });
});

describe("the fix's facts and the step's pill", () => {
  function factsOf(
    status: AutoRemediationSuggestionStatus,
    view: RemediationRoundView | undefined,
  ): RemediationFixFacts {
    return getRemediationFixFacts(
      Object.assign(new AutoRemediationSuggestion(), {
        _id: FIX_ID,
        status,
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
      }),
      { round: view },
    );
  }

  function pillOf(fixes: Array<RemediationFixFacts>): RemediationStepStatus {
    return getRemediationStepStatus({
      isLoaded: true,
      decision: {
        stage: AutoRemediationDecisionStage.Evaluated,
        entries: [
          {
            lane: AutoRemediationDecisionLane.Rule,
            reason: AutoRemediationDecisionReason.NoRulesConfigured,
          },
        ],
      },
      lines: [],
      fixes,
      investigationStage: "reported",
      codeFix: null,
      isOffByChoice: false,
    });
  }

  const stopped: RemediationRoundView = round({ runStatus: AIRunStatus.Error });

  test("a fix whose round stopped did not finish, and is not in progress", () => {
    expect(
      factsOf(AutoRemediationSuggestionStatus.Planning, stopped),
    ).toMatchObject({ isUnfinished: true, isInProgress: false });
    expect(
      factsOf(AutoRemediationSuggestionStatus.NoneApplicable, stopped),
    ).toMatchObject({ isUnfinished: true, isInProgress: false });
  });

  test("negative control: one at work is in progress; one that found none, or not read, says nothing more", () => {
    expect(
      factsOf(
        AutoRemediationSuggestionStatus.Planning,
        round({ runStatus: AIRunStatus.Running }),
      ),
    ).toMatchObject({ isInProgress: true });
    expect(
      factsOf(
        AutoRemediationSuggestionStatus.Planning,
        round({ runStatus: AIRunStatus.Running }),
      ),
    ).not.toHaveProperty("isUnfinished");
    expect(
      factsOf(
        AutoRemediationSuggestionStatus.NoneApplicable,
        round({ runStatus: AIRunStatus.Completed }),
      ),
    ).not.toHaveProperty("isUnfinished");
    expect(
      factsOf(AutoRemediationSuggestionStatus.NoneApplicable, undefined),
    ).not.toHaveProperty("isUnfinished");
  });

  test("the pill says it did not finish when nothing was fixed and a round stopped", () => {
    const didNotFinish: RemediationStepStatus = pillOf([
      factsOf(AutoRemediationSuggestionStatus.NoneApplicable, stopped),
    ]);

    expect(didNotFinish).toEqual({
      tone: "failed",
      text: REMEDIATION_STEP_STATUS_TEXT.didNotFinish,
    });
    expect(REMEDIATION_STEP_STATUS_TEXT.didNotFinish).toBe("Did not finish");

    // With a round that found none beside it, too.
    expect(
      pillOf([
        factsOf(
          AutoRemediationSuggestionStatus.NoneApplicable,
          round({ runStatus: AIRunStatus.Completed }),
        ),
        factsOf(AutoRemediationSuggestionStatus.NoneApplicable, stopped),
      ]).text,
    ).toBe(REMEDIATION_STEP_STATUS_TEXT.didNotFinish);
  });

  test("negative control: rounds that all found none say no fix was found", () => {
    expect(
      pillOf([
        factsOf(
          AutoRemediationSuggestionStatus.NoneApplicable,
          round({ runStatus: AIRunStatus.Completed }),
        ),
      ]).text,
    ).toBe(REMEDIATION_STEP_STATUS_TEXT.noFixFound);
  });

  test("negative control: a fix waiting for approval beside a stopped round says it waits", () => {
    const pill: RemediationStepStatus = pillOf([
      factsOf(AutoRemediationSuggestionStatus.Suggested, undefined),
      factsOf(AutoRemediationSuggestionStatus.NoneApplicable, stopped),
    ]);

    expect(pill.text).not.toBe(REMEDIATION_STEP_STATUS_TEXT.didNotFinish);
  });
});
