import { describe, expect, test } from "@jest/globals";
import AIRunStatus, { AIRunStatusHelper } from "../../../Types/AI/AIRunStatus";
import { CodeTaskStateInput } from "../../../Types/AI/CodeTask";
import { isAiOffered } from "../../../Utils/Suggestions/AiSuggestion";
import {
  CodeFixSuggestionInput,
  FINISHED_FIX_STATUSES,
  FinishedFixOutcome,
  getCodeFixOffer,
  getFinishedFixOutcome,
  parseFinishedFixOutcome,
} from "../../../Utils/Suggestions/CodeFixSuggestion";
import SuggestionOffer, {
  parseSuggestionOffer,
} from "../../../Utils/Suggestions/SuggestionOffer";

/*
 * The shared vocabulary of every suggestion: what a page may draw (None,
 * Act, SetUp, InProgress, Done), whether AI actions are drawn at all (the
 * one AI switch), and the decision every "AI opens a pull request"
 * suggestion shares once its own rule has said whether it applies.
 */

describe("SuggestionOffer", () => {
  test("has the five answers a page can draw", () => {
    expect(Object.values(SuggestionOffer)).toEqual([
      "None",
      "Act",
      "SetUp",
      "InProgress",
      "Done",
    ]);
  });

  test.each(["None", "Act", "SetUp", "InProgress", "Done"])(
    "reads %s off the wire",
    (value: string) => {
      expect(parseSuggestionOffer(value)).toBe(value);
    },
  );

  test.each([
    ["an unknown value", "Maybe"],
    ["a lower-case value", "act"],
    ["a lower-case done", "done"],
    ["a number", 1],
    ["nothing", undefined],
    ["null", null],
    ["an object", { offer: "Act" }],
  ])(
    "reads %s as None, so it never draws an action",
    (_label: string, value: unknown) => {
      expect(parseSuggestionOffer(value)).toBe(SuggestionOffer.None);
    },
  );
});

describe("isAiOffered", () => {
  test("AI switched off: no AI action is drawn", () => {
    expect(isAiOffered({ enableAi: false })).toBe(false);
  });

  test("AI switched on: AI actions are drawn", () => {
    expect(isAiOffered({ enableAi: true })).toBe(true);
  });

  test("an unknown value is read as on, as every server read of the switch is", () => {
    expect(isAiOffered({})).toBe(true);
    expect(isAiOffered({ enableAi: undefined })).toBe(true);
    expect(isAiOffered(null)).toBe(true);
    expect(isAiOffered(undefined)).toBe(true);
  });
});

describe("getCodeFixOffer", () => {
  const applies: CodeFixSuggestionInput = {
    isAiEnabled: true,
    applies: true,
    hasActiveFix: false,
    hasConnectedRepository: true,
    isBackedByEvidence: true,
  };

  test("applies, AI on, a repository, nothing in flight: the action", () => {
    expect(getCodeFixOffer(applies)).toBe(SuggestionOffer.Act);
  });

  test("AI off: nothing, whatever else is true", () => {
    expect(getCodeFixOffer({ ...applies, isAiEnabled: false })).toBe(
      SuggestionOffer.None,
    );
    expect(
      getCodeFixOffer({
        ...applies,
        isAiEnabled: false,
        hasActiveFix: true,
        hasConnectedRepository: false,
      }),
    ).toBe(SuggestionOffer.None);
  });

  test("does not apply: nothing, whatever else is true", () => {
    expect(getCodeFixOffer({ ...applies, applies: false })).toBe(
      SuggestionOffer.None,
    );
    expect(
      getCodeFixOffer({ ...applies, applies: false, hasActiveFix: true }),
    ).toBe(SuggestionOffer.None);
  });

  test("a fix already in flight: a link to it, before any repository question", () => {
    expect(getCodeFixOffer({ ...applies, hasActiveFix: true })).toBe(
      SuggestionOffer.InProgress,
    );
    expect(
      getCodeFixOffer({
        ...applies,
        hasActiveFix: true,
        hasConnectedRepository: false,
      }),
    ).toBe(SuggestionOffer.InProgress);
  });

  test("no repository, with evidence on screen: a quiet way to connect one", () => {
    expect(getCodeFixOffer({ ...applies, hasConnectedRepository: false })).toBe(
      SuggestionOffer.SetUp,
    );
  });

  test("no repository, with no evidence on screen: nothing - a setup link on every page would be noise", () => {
    expect(
      getCodeFixOffer({
        ...applies,
        hasConnectedRepository: false,
        isBackedByEvidence: false,
      }),
    ).toBe(SuggestionOffer.None);
  });

  test("a fix that already did its work: how it came out, before any repository or gate question", () => {
    expect(getCodeFixOffer({ ...applies, hasFinishedFix: true })).toBe(
      SuggestionOffer.Done,
    );
    expect(
      getCodeFixOffer({
        ...applies,
        hasFinishedFix: true,
        hasConnectedRepository: false,
        isBlocked: true,
      }),
    ).toBe(SuggestionOffer.Done);
  });

  test("a fix in flight comes before a finished one", () => {
    expect(
      getCodeFixOffer({ ...applies, hasActiveFix: true, hasFinishedFix: true }),
    ).toBe(SuggestionOffer.InProgress);
  });

  test("Code's gate says something stops the fix: the step that clears it with evidence on screen, nothing without", () => {
    expect(getCodeFixOffer({ ...applies, isBlocked: true })).toBe(
      SuggestionOffer.SetUp,
    );
    expect(
      getCodeFixOffer({
        ...applies,
        isBlocked: true,
        isBackedByEvidence: false,
      }),
    ).toBe(SuggestionOffer.None);
  });

  test("the new inputs left out read as no finished fix and no blocker, as every suggestion before them", () => {
    expect(getCodeFixOffer(applies)).toBe(SuggestionOffer.Act);
    expect(
      getCodeFixOffer({
        ...applies,
        hasFinishedFix: undefined,
        isBlocked: undefined,
      }),
    ).toBe(SuggestionOffer.Act);
  });

  test("every combination of the seven inputs gives one of the five answers, and Act only when everything lines up", () => {
    const booleans: Array<boolean> = [true, false];

    for (const isAiEnabled of booleans) {
      for (const doesApply of booleans) {
        for (const hasActiveFix of booleans) {
          for (const hasFinishedFix of booleans) {
            for (const hasConnectedRepository of booleans) {
              for (const isBlocked of booleans) {
                for (const isBackedByEvidence of booleans) {
                  const offer: SuggestionOffer = getCodeFixOffer({
                    isAiEnabled,
                    applies: doesApply,
                    hasActiveFix,
                    hasFinishedFix,
                    hasConnectedRepository,
                    isBlocked,
                    isBackedByEvidence,
                  });

                  expect(Object.values(SuggestionOffer)).toContain(offer);
                  expect(offer === SuggestionOffer.Act).toBe(
                    isAiEnabled &&
                      doesApply &&
                      !hasActiveFix &&
                      !hasFinishedFix &&
                      hasConnectedRepository &&
                      !isBlocked,
                  );
                  expect(offer === SuggestionOffer.Done).toBe(
                    isAiEnabled && doesApply && !hasActiveFix && hasFinishedFix,
                  );
                  // A set-up step only where evidence on screen earns it.
                  if (offer === SuggestionOffer.SetUp) {
                    expect(isBackedByEvidence).toBe(true);
                  }

                  if (!isAiEnabled || !doesApply) {
                    expect(offer).toBe(SuggestionOffer.None);
                  }
                }
              }
            }
          }
        }
      }
    }
  });
});

describe("how a fix that did its work came out", () => {
  function turn(
    status: AIRunStatus,
    needsUserInput: boolean = false,
  ): CodeTaskStateInput {
    return { status, needsUserInput };
  }

  test("the runs that did their work are the ones that finished it: a pull request, or nothing to change", () => {
    expect([...FINISHED_FIX_STATUSES]).toEqual([
      AIRunStatus.Completed,
      AIRunStatus.NoFixFound,
    ]);

    // Both are over: the dedupe of runs in flight never sees them.
    for (const status of FINISHED_FIX_STATUSES) {
      expect(AIRunStatusHelper.isTerminalStatus(status)).toBe(true);
    }

    // A run that failed or was stopped did not: its fix may be asked again.
    for (const status of [
      AIRunStatus.Error,
      AIRunStatus.Cancelled,
      AIRunStatus.Stale,
    ]) {
      expect(FINISHED_FIX_STATUSES).not.toContain(status);
    }
  });

  test("nobody replied: the fix's own result", () => {
    const fixed: CodeTaskStateInput = turn(AIRunStatus.Completed);
    const nothing: CodeTaskStateInput = turn(AIRunStatus.NoFixFound);

    expect(getFinishedFixOutcome({ fix: fixed, latestTurn: fixed })).toBe(
      FinishedFixOutcome.Fixed,
    );
    expect(getFinishedFixOutcome({ fix: nothing, latestTurn: nothing })).toBe(
      FinishedFixOutcome.NothingToChange,
    );
  });

  test("the fix stopped with a question: waiting for an answer", () => {
    const asked: CodeTaskStateInput = turn(AIRunStatus.Completed, true);

    expect(getFinishedFixOutcome({ fix: asked, latestTurn: asked })).toBe(
      FinishedFixOutcome.WaitingForYou,
    );
  });

  test.each([
    AIRunStatus.Queued,
    AIRunStatus.Running,
    AIRunStatus.WaitingForApproval,
  ])(
    "a reply in Code is under way (%s): no outcome - the task is working again",
    (status: AIRunStatus) => {
      expect(
        getFinishedFixOutcome({
          fix: turn(AIRunStatus.Completed, true),
          latestTurn: turn(status),
        }),
      ).toBeNull();
    },
  );

  test("a reply that asked again: waiting for an answer, whatever the fix found", () => {
    expect(
      getFinishedFixOutcome({
        fix: turn(AIRunStatus.NoFixFound),
        latestTurn: turn(AIRunStatus.Completed, true),
      }),
    ).toBe(FinishedFixOutcome.WaitingForYou);
  });

  test.each([AIRunStatus.Error, AIRunStatus.Stale, AIRunStatus.Cancelled])(
    "a reply that ended without finishing (%s) leaves the fix as it came out",
    (status: AIRunStatus) => {
      expect(
        getFinishedFixOutcome({
          fix: turn(AIRunStatus.Completed),
          latestTurn: turn(status),
        }),
      ).toBe(FinishedFixOutcome.Fixed);
      expect(
        getFinishedFixOutcome({
          fix: turn(AIRunStatus.NoFixFound),
          latestTurn: turn(status),
        }),
      ).toBe(FinishedFixOutcome.NothingToChange);
    },
  );

  test("reads an outcome off the wire; anything else is none", () => {
    for (const outcome of Object.values(FinishedFixOutcome)) {
      expect(parseFinishedFixOutcome(outcome)).toBe(outcome);
    }

    for (const value of ["fixed", "Merged", "", 1, null, undefined, {}]) {
      expect(parseFinishedFixOutcome(value)).toBeNull();
    }
  });
});
