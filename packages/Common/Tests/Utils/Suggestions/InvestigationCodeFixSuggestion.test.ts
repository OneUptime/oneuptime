import { describe, expect, test } from "@jest/globals";
import { AutomaticFixPullRequestBlocker } from "../../../Types/AI/AutomaticFixPullRequests";
import { CodeTaskBlockerType } from "../../../Types/AI/CodeTask";
import { JSONObject } from "../../../Types/JSON";
import { FinishedFixOutcome } from "../../../Utils/Suggestions/CodeFixSuggestion";
import {
  AUTOMATIC_CODE_FIX_BLOCKER_BY_RULE_BLOCKER,
  AutomaticCodeFixBlocker,
  getInvestigationCodeFixSuggestion,
  InvestigationCodeFixSuggestion,
  InvestigationCodeFixSuggestionInput,
  investigationCodeFixSuggestionToJSON,
  NO_INVESTIGATION_CODE_FIX_SUGGESTION,
  parseAutomaticCodeFixBlocker,
  parseInvestigationCodeFixSuggestion,
} from "../../../Utils/Suggestions/InvestigationCodeFixSuggestion";
import { SuggestionBlocker } from "../../../Utils/Suggestions/SuggestionBlocker";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";

/*
 * The fix in the code an investigation recommends, on the Remediation step
 * of an incident's or alert's AI card (block 43). OneUptime AI used to open
 * it on its own or stop silently - a debug line - so an investigation that
 * blamed the code was followed by nothing anyone could see. These tests hold
 * what the step is told, in the order a person meets the answers:
 *
 *   - nothing while AI is off or the investigation recommended no change;
 *   - the pull request being written, then done, and who asked for it;
 *   - the one setup step in the way, a repository before Code's gate;
 *   - otherwise ready to open - with why OneUptime AI did not open it on
 *     its own, which only goes with an offer to open one;
 *
 * and the wire format, which never draws an action or a dead link it does
 * not fully name.
 */

const RUN_ID: string = "10000000-0000-4000-8000-000000000001";
const OTHER_RUN_ID: string = "10000000-0000-4000-8000-000000000002";

const NO_CREDITS: SuggestionBlocker = {
  type: CodeTaskBlockerType.NoAiCredits,
  message: "This project's AI credits are used up.",
};

function input(
  overrides: Partial<InvestigationCodeFixSuggestionInput> = {},
): InvestigationCodeFixSuggestionInput {
  return {
    isAiEnabled: true,
    isCodeFixRecommended: true,
    activeFix: null,
    finishedFix: null,
    hasConnectedRepository: true,
    blocker: null,
    automaticBlocker: AutomaticCodeFixBlocker.FixOff,
    ...overrides,
  };
}

describe("what the Remediation step offers for an investigation's code fix", () => {
  test("nothing while AI is off, whatever else holds", () => {
    expect(
      getInvestigationCodeFixSuggestion(
        input({
          isAiEnabled: false,
          activeFix: { aiRunId: RUN_ID, isAutomatic: true },
        }),
      ),
    ).toEqual(NO_INVESTIGATION_CODE_FIX_SUGGESTION);
  });

  test("nothing when the investigation recommended no change in the code", () => {
    expect(
      getInvestigationCodeFixSuggestion(
        input({ isCodeFixRecommended: false, hasConnectedRepository: false }),
      ),
    ).toEqual(NO_INVESTIGATION_CODE_FIX_SUGGESTION);
  });

  test("a pull request being written is linked, with who asked for it", () => {
    expect(
      getInvestigationCodeFixSuggestion(
        input({ activeFix: { aiRunId: RUN_ID, isAutomatic: true } }),
      ),
    ).toEqual({
      offer: SuggestionOffer.InProgress,
      fixOutcome: null,
      blocker: null,
      aiRunId: RUN_ID,
      isAutomatic: true,
      automaticBlocker: null,
    });

    expect(
      getInvestigationCodeFixSuggestion(
        input({ activeFix: { aiRunId: RUN_ID, isAutomatic: false } }),
      ).isAutomatic,
    ).toBe(false);
  });

  test("a finished pull request says how it came out, and links its task", () => {
    for (const outcome of Object.values(FinishedFixOutcome)) {
      expect(
        getInvestigationCodeFixSuggestion(
          input({
            finishedFix: { aiRunId: RUN_ID, isAutomatic: false, outcome },
          }),
        ),
      ).toEqual({
        offer: SuggestionOffer.Done,
        fixOutcome: outcome,
        blocker: null,
        aiRunId: RUN_ID,
        isAutomatic: false,
        automaticBlocker: null,
      });
    }
  });

  test("a reply in Code under way on a finished fix is work in progress again", () => {
    expect(
      getInvestigationCodeFixSuggestion(
        input({
          finishedFix: { aiRunId: RUN_ID, isAutomatic: true, outcome: null },
        }),
      ),
    ).toEqual({
      offer: SuggestionOffer.InProgress,
      fixOutcome: null,
      blocker: null,
      aiRunId: RUN_ID,
      isAutomatic: true,
      automaticBlocker: null,
    });
  });

  test("the active fix wins over an older finished one", () => {
    const suggestion: InvestigationCodeFixSuggestion =
      getInvestigationCodeFixSuggestion(
        input({
          activeFix: { aiRunId: RUN_ID, isAutomatic: false },
          finishedFix: {
            aiRunId: OTHER_RUN_ID,
            isAutomatic: true,
            outcome: FinishedFixOutcome.Fixed,
          },
        }),
      );

    expect(suggestion.offer).toBe(SuggestionOffer.InProgress);
    expect(suggestion.aiRunId).toBe(RUN_ID);
    expect(suggestion.isAutomatic).toBe(false);
  });

  test("no repository: the one step is connecting one - Code's gate is not asked about", () => {
    expect(
      getInvestigationCodeFixSuggestion(
        input({
          hasConnectedRepository: false,
          blocker: NO_CREDITS,
          automaticBlocker: AutomaticCodeFixBlocker.NoRepository,
        }),
      ),
    ).toEqual({
      offer: SuggestionOffer.SetUp,
      fixOutcome: null,
      blocker: null,
      aiRunId: null,
      isAutomatic: false,
      automaticBlocker: AutomaticCodeFixBlocker.NoRepository,
    });
  });

  test("a repository, and Code's gate in the way: its words are the step", () => {
    expect(
      getInvestigationCodeFixSuggestion(
        input({
          blocker: NO_CREDITS,
          automaticBlocker: AutomaticCodeFixBlocker.ChangedSince,
        }),
      ),
    ).toEqual({
      offer: SuggestionOffer.SetUp,
      fixOutcome: null,
      blocker: NO_CREDITS,
      aiRunId: null,
      isAutomatic: false,
      automaticBlocker: AutomaticCodeFixBlocker.ChangedSince,
    });
  });

  test("ready to open, with why OneUptime AI did not open it on its own", () => {
    for (const automaticBlocker of Object.values(AutomaticCodeFixBlocker)) {
      expect(
        getInvestigationCodeFixSuggestion(input({ automaticBlocker })),
      ).toEqual({
        offer: SuggestionOffer.Act,
        fixOutcome: null,
        blocker: null,
        aiRunId: null,
        isAutomatic: false,
        automaticBlocker,
      });
    }
  });

  test("the fixing rule's blockers each have the step's name", () => {
    expect(AUTOMATIC_CODE_FIX_BLOCKER_BY_RULE_BLOCKER).toEqual({
      [AutomaticFixPullRequestBlocker.FixOff]: AutomaticCodeFixBlocker.FixOff,
      [AutomaticFixPullRequestBlocker.RulesUnreadable]:
        AutomaticCodeFixBlocker.RulesUnreadable,
      [AutomaticFixPullRequestBlocker.NoMatchingRule]:
        AutomaticCodeFixBlocker.NoMatchingRule,
      [AutomaticFixPullRequestBlocker.PullRequestOff]:
        AutomaticCodeFixBlocker.PullRequestOff,
    });

    for (const blocker of Object.values(AutomaticFixPullRequestBlocker)) {
      expect(AUTOMATIC_CODE_FIX_BLOCKER_BY_RULE_BLOCKER[blocker]).toBeDefined();
    }
  });
});

describe("the code fix suggestion on the wire", () => {
  const SAMPLES: Array<InvestigationCodeFixSuggestion> = [
    NO_INVESTIGATION_CODE_FIX_SUGGESTION,
    getInvestigationCodeFixSuggestion(
      input({ activeFix: { aiRunId: RUN_ID, isAutomatic: true } }),
    ),
    getInvestigationCodeFixSuggestion(
      input({
        finishedFix: {
          aiRunId: RUN_ID,
          isAutomatic: false,
          outcome: FinishedFixOutcome.WaitingForYou,
        },
      }),
    ),
    getInvestigationCodeFixSuggestion(
      input({
        blocker: {
          type: CodeTaskBlockerType.RunnerNotOnline,
          message: 'The Runner "build-box" this repository picks is not online.',
          runnerName: "build-box",
          repositoryId: "50000000-0000-4000-8000-000000000005",
        },
      }),
    ),
    getInvestigationCodeFixSuggestion(
      input({ automaticBlocker: AutomaticCodeFixBlocker.DailyLimit }),
    ),
  ];

  test("round-trips everything the step draws", () => {
    for (const sample of SAMPLES) {
      expect(
        parseInvestigationCodeFixSuggestion(
          JSON.parse(
            JSON.stringify(investigationCodeFixSuggestionToJSON(sample)),
          ),
        ),
      ).toEqual(sample);
    }
  });

  test("anything it cannot draw reads as nothing to offer", () => {
    for (const value of [
      undefined,
      null,
      "Act",
      [],
      {},
      { offer: "Later" },
      { offer: 7 },
    ]) {
      expect(parseInvestigationCodeFixSuggestion(value)).toEqual(
        NO_INVESTIGATION_CODE_FIX_SUGGESTION,
      );
    }
  });

  test("a fix in progress or done with no task to link is never drawn", () => {
    for (const offer of [SuggestionOffer.InProgress, SuggestionOffer.Done]) {
      for (const aiRunId of [undefined, null, "", "not-an-id", 12]) {
        expect(
          parseInvestigationCodeFixSuggestion({
            offer,
            aiRunId,
            fixOutcome: FinishedFixOutcome.Fixed,
          } as JSONObject),
        ).toEqual(NO_INVESTIGATION_CODE_FIX_SUGGESTION);
      }
    }
  });

  test("only what goes with an offer is read: no stray reason, link or setup step", () => {
    expect(
      parseInvestigationCodeFixSuggestion({
        offer: SuggestionOffer.InProgress,
        aiRunId: RUN_ID,
        isAutomatic: true,
        automaticBlocker: AutomaticCodeFixBlocker.FixOff,
        blocker: { type: CodeTaskBlockerType.NoAiCredits, message: "No." },
        fixOutcome: FinishedFixOutcome.Fixed,
      }),
    ).toEqual({
      offer: SuggestionOffer.InProgress,
      fixOutcome: null,
      blocker: null,
      aiRunId: RUN_ID,
      isAutomatic: true,
      automaticBlocker: null,
    });

    expect(
      parseInvestigationCodeFixSuggestion({
        offer: SuggestionOffer.Act,
        aiRunId: RUN_ID,
        isAutomatic: true,
        automaticBlocker: AutomaticCodeFixBlocker.PullRequestOff,
        blocker: { type: CodeTaskBlockerType.NoAiCredits, message: "No." },
      }),
    ).toEqual({
      offer: SuggestionOffer.Act,
      fixOutcome: null,
      blocker: null,
      aiRunId: null,
      isAutomatic: false,
      automaticBlocker: AutomaticCodeFixBlocker.PullRequestOff,
    });
  });

  test("a reason this build does not know reads as none", () => {
    expect(parseAutomaticCodeFixBlocker("SomethingNew")).toBeNull();
    expect(parseAutomaticCodeFixBlocker(undefined)).toBeNull();

    for (const blocker of Object.values(AutomaticCodeFixBlocker)) {
      expect(parseAutomaticCodeFixBlocker(blocker)).toBe(blocker);
    }

    expect(
      parseInvestigationCodeFixSuggestion({
        offer: SuggestionOffer.Act,
        automaticBlocker: "SomethingNew",
      }).automaticBlocker,
    ).toBeNull();
  });
});
