import { describe, expect, test } from "@jest/globals";
import { RemediationRoundView } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationRoundView";
import {
  getRemediationFixFacts,
  RemediationFixFacts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepStatus";
import {
  describeRemediationStepSummary,
  getRemediationStepSummary,
  REMEDIATION_STEP_SUMMARY_COPY,
  RemediationStepSummary,
  RemediationStepSummaryKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepSummary";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import {
  AiRemediationCommandPolicyVerdict,
  AiRemediationPlanExecutionStatus,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { RemediationRoundAppliedSteps } from "../../../Types/AutoRemediation/RemediationRound";
import { JSONObject } from "../../../Types/JSON";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { FinishedFixOutcome } from "../../../Utils/Suggestions/CodeFixSuggestion";
import {
  InvestigationCodeFixSuggestion,
  NO_INVESTIGATION_CODE_FIX_SUGGESTION,
} from "../../../Utils/Suggestions/InvestigationCodeFixSuggestion";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import {
  seededRandom,
  SeededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

/*
 * THE REMEDIATION STEP'S FIRST SENTENCE (issue #6860).
 *
 * "Can we make this UI 10x better? Please make it natural to understand."
 * The step read as a log - a line per lane the engine checked, then a block
 * per fix with its own status - and the reader pieced together what
 * happened. It now opens with the answer: what came of fixing this
 * incident or alert, and what, if anything, waits for the reader. These
 * tests hold each answer to the facts it is read from, in the order the
 * step's pill reads them, so the sentence and the pill never disagree.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

function facts(
  overrides: Partial<RemediationFixFacts> = {},
): RemediationFixFacts {
  return {
    status: AutoRemediationSuggestionStatus.Suggested,
    isUnapprovable: false,
    isInProgress: false,
    hasRun: false,
    hasFailed: false,
    isVerified: false,
    isFirstApprovedByReader: false,
    ...overrides,
  };
}

const WAITING: RemediationFixFacts = facts();
const RAN: RemediationFixFacts = facts({
  status: AutoRemediationSuggestionStatus.AutoExecuted,
  hasRun: true,
});
const RECOVERED: RemediationFixFacts = facts({
  status: AutoRemediationSuggestionStatus.AutoExecuted,
  hasRun: true,
  isVerified: true,
});
const DID_NOT_RECOVER: RemediationFixFacts = facts({
  status: AutoRemediationSuggestionStatus.AutoExecuted,
  hasRun: true,
  hasFailed: true,
  didNotRecover: true,
});
const RUN_FAILED: RemediationFixFacts = facts({
  status: AutoRemediationSuggestionStatus.Approved,
  hasRun: true,
  hasFailed: true,
});
const NO_FIX: RemediationFixFacts = facts({
  status: AutoRemediationSuggestionStatus.NoneApplicable,
});
const DISMISSED: RemediationFixFacts = facts({
  status: AutoRemediationSuggestionStatus.Dismissed,
});
const STOPPED: RemediationFixFacts = facts({
  status: AutoRemediationSuggestionStatus.NoneApplicable,
  isUnfinished: true,
});
const STOPPED_PARTWAY: RemediationFixFacts = facts({
  status: AutoRemediationSuggestionStatus.Planning,
  isUnfinished: true,
  hasAppliedSteps: true,
});
const PLANNING: RemediationFixFacts = facts({
  status: AutoRemediationSuggestionStatus.Planning,
  isInProgress: true,
  progress: "planning",
});
const RUNNING: RemediationFixFacts = facts({
  status: AutoRemediationSuggestionStatus.Approved,
  isInProgress: true,
  progress: "running",
});
const VERIFYING: RemediationFixFacts = facts({
  status: AutoRemediationSuggestionStatus.AutoExecuted,
  isInProgress: true,
  progress: "verifying",
});

function kindOf(
  fixes: Array<RemediationFixFacts>,
  extra: {
    mayApprove?: boolean;
    codeFix?: InvestigationCodeFixSuggestion | null;
  } = {},
): RemediationStepSummaryKind | null {
  return getRemediationStepSummary({ fixes, ...extra })?.kind || null;
}

function codeFix(
  offer: SuggestionOffer,
  fixOutcome: FinishedFixOutcome | null = null,
): InvestigationCodeFixSuggestion {
  return { ...NO_INVESTIGATION_CODE_FIX_SUGGESTION, offer, fixOutcome };
}

describe("what the step's first sentence says", () => {
  test("nothing, with no fix: the decision's lines say why", () => {
    expect(getRemediationStepSummary({ fixes: [] })).toBeNull();
  });

  test.each([
    ["needsYourApproval", [WAITING]],
    ["planning", [PLANNING]],
    ["running", [RUNNING]],
    ["verifying", [VERIFYING]],
    ["recovered", [RECOVERED]],
    ["didNotRecover", [DID_NOT_RECOVER]],
    ["runFailed", [RUN_FAILED]],
    ["ran", [RAN]],
    ["dismissed", [DISMISSED]],
    ["stopped", [STOPPED]],
    ["stoppedPartway", [STOPPED_PARTWAY]],
    ["noFix", [NO_FIX]],
  ] as Array<[RemediationStepSummaryKind, Array<RemediationFixFacts>]>)(
    "%s",
    (kind: RemediationStepSummaryKind, fixes: Array<RemediationFixFacts>) => {
      expect(kindOf(fixes)).toBe(kind);
    },
  );

  test("a fix that waits for an approval nobody can give does not wait for the reader", () => {
    expect(kindOf([facts({ isUnapprovable: true }), NO_FIX])).toBe(
      "nothingRan",
    );
  });

  test("a fix that waits for someone else's approval says so to a reader who may not approve it", () => {
    const summary: RemediationStepSummary | null = getRemediationStepSummary({
      fixes: [WAITING, WAITING, RAN],
      mayApprove: false,
    });

    expect(summary).toEqual({ kind: "needsSomeonesApproval", count: 2 });
  });

  test("the reader's first approval of a riskier fix waits for a second person", () => {
    expect(kindOf([facts({ isFirstApprovedByReader: true })])).toBe(
      "needsSecondApproval",
    );
  });

  test("a fix the reader may still approve is counted, the one they approved is not", () => {
    expect(
      getRemediationStepSummary({
        fixes: [facts({ isFirstApprovedByReader: true }), WAITING, WAITING],
      }),
    ).toEqual({ kind: "needsYourApproval", count: 2 });
  });

  test("running is said before verifying, verifying before planning", () => {
    expect(kindOf([PLANNING, VERIFYING, RUNNING])).toBe("running");
    expect(kindOf([PLANNING, VERIFYING])).toBe("verifying");
    expect(kindOf([PLANNING, RECOVERED])).toBe("planning");
  });

  test("a fix in progress whose facts do not say what it does is being worked out", () => {
    expect(
      kindOf([
        facts({
          isInProgress: true,
          status: AutoRemediationSuggestionStatus.Planning,
        }),
      ]),
    ).toBe("planning");
  });

  test("the best outcome of the fixes that ran is said first", () => {
    expect(kindOf([DID_NOT_RECOVER, RECOVERED, RUN_FAILED, RAN])).toBe(
      "recovered",
    );
    expect(kindOf([RUN_FAILED, DID_NOT_RECOVER, RAN])).toBe("didNotRecover");
    expect(kindOf([RAN, RUN_FAILED])).toBe("runFailed");
    expect(kindOf([NO_FIX, DISMISSED, RAN])).toBe("ran");
  });

  test("dismissed only when every fix was, and counted", () => {
    expect(
      getRemediationStepSummary({ fixes: [DISMISSED, DISMISSED, DISMISSED] }),
    ).toEqual({
      kind: "dismissed",
      count: 3,
    });
    expect(kindOf([DISMISSED, NO_FIX])).toBe("nothingRan");
  });

  test("a round that changed something before it stopped is never said to have changed nothing", () => {
    expect(kindOf([STOPPED_PARTWAY, NO_FIX])).toBe("stoppedPartway");
    expect(kindOf([STOPPED, STOPPED_PARTWAY])).toBe("stoppedPartway");
    expect(kindOf([STOPPED_PARTWAY, DISMISSED])).toBe("stoppedPartway");
  });

  test("stopped when the rounds that did not stop found no fix", () => {
    expect(kindOf([STOPPED, NO_FIX, NO_FIX])).toBe("stopped");
    expect(kindOf([STOPPED, DISMISSED])).toBe("nothingRan");
  });

  test("found no fix only when no round found one", () => {
    expect(kindOf([NO_FIX, NO_FIX])).toBe("noFix");
    expect(kindOf([NO_FIX, DISMISSED])).toBe("nothingRan");
  });

  test("a pull request being written, or opened, is the story: its own line says it", () => {
    for (const fix of [
      codeFix(SuggestionOffer.InProgress),
      codeFix(SuggestionOffer.Done, FinishedFixOutcome.Fixed),
      codeFix(SuggestionOffer.Done, FinishedFixOutcome.WaitingForYou),
    ]) {
      expect(kindOf([NO_FIX], { codeFix: fix })).toBeNull();
      expect(kindOf([RAN], { codeFix: fix })).toBeNull();
    }
  });

  test("a pull request that found nothing to change, or none at all, leaves the sentence", () => {
    for (const fix of [
      null,
      NO_INVESTIGATION_CODE_FIX_SUGGESTION,
      codeFix(SuggestionOffer.Act),
      codeFix(SuggestionOffer.Done, FinishedFixOutcome.NothingToChange),
    ]) {
      expect(kindOf([NO_FIX], { codeFix: fix })).toBe("noFix");
    }
  });

  test("what waits for the reader, or moves, is said whatever the pull request", () => {
    const writing: InvestigationCodeFixSuggestion = codeFix(
      SuggestionOffer.InProgress,
    );

    expect(kindOf([WAITING, NO_FIX], { codeFix: writing })).toBe(
      "needsYourApproval",
    );
    expect(kindOf([RUNNING], { codeFix: writing })).toBe("running");
  });
});

describe("the precedence holds for any order and mix of fixes", () => {
  const ALL: Array<RemediationFixFacts> = [
    WAITING,
    PLANNING,
    RUNNING,
    VERIFYING,
    RECOVERED,
    DID_NOT_RECOVER,
    RUN_FAILED,
    RAN,
    DISMISSED,
    STOPPED,
    STOPPED_PARTWAY,
    NO_FIX,
  ];

  // The answer, read the long way: the first rule a fix in the mix meets.
  function expectedKind(
    fixes: Array<RemediationFixFacts>,
  ): RemediationStepSummaryKind {
    const has: (fix: RemediationFixFacts) => boolean = (
      fix: RemediationFixFacts,
    ): boolean => {
      return fixes.includes(fix);
    };

    if (has(WAITING)) {
      return "needsYourApproval";
    }

    if (has(RUNNING)) {
      return "running";
    }

    if (has(VERIFYING)) {
      return "verifying";
    }

    if (has(PLANNING)) {
      return "planning";
    }

    if (has(RECOVERED)) {
      return "recovered";
    }

    if (has(DID_NOT_RECOVER)) {
      return "didNotRecover";
    }

    if (has(RUN_FAILED)) {
      return "runFailed";
    }

    if (has(RAN)) {
      return "ran";
    }

    if (
      fixes.every((fix: RemediationFixFacts) => {
        return fix === DISMISSED;
      })
    ) {
      return "dismissed";
    }

    if (has(STOPPED_PARTWAY)) {
      return "stoppedPartway";
    }

    if (
      has(STOPPED) &&
      fixes.every((fix: RemediationFixFacts) => {
        return fix === STOPPED || fix === NO_FIX;
      })
    ) {
      return "stopped";
    }

    if (
      fixes.every((fix: RemediationFixFacts) => {
        return fix === NO_FIX;
      })
    ) {
      return "noFix";
    }

    return "nothingRan";
  }

  test("2,000 seeded mixes", () => {
    const random: SeededRandom = seededRandom(6860);
    const seen: Set<RemediationStepSummaryKind> = new Set();

    for (let draw: number = 0; draw < 2000; draw++) {
      const size: number = 1 + random(4);
      const fixes: Array<RemediationFixFacts> = shuffled(
        Array.from({ length: size }, (): RemediationFixFacts => {
          return ALL[random(ALL.length)]!;
        }),
        random,
      );
      const kind: RemediationStepSummaryKind | null = kindOf(fixes);
      // The mix's place in ALL, so a failure names the fixes it drew.
      const drawn: Array<number> = fixes.map(
        (fix: RemediationFixFacts): number => {
          return ALL.indexOf(fix);
        },
      );

      expect({ fixes: drawn, kind }).toEqual({
        fixes: drawn,
        kind: expectedKind(fixes),
      });
      seen.add(kind!);
    }

    // Every answer came up: the mixes reached each rule.
    expect(seen.size).toBe(13);
  });
});

describe("the sentence, in English", () => {
  function say(
    summary: RemediationStepSummary,
    signal: "incident" | "alert" = "alert",
  ): string {
    return describeRemediationStepSummary(summary, {
      translator: ENGLISH,
      signal,
    });
  }

  test("each kind reads as a whole sentence about the record", () => {
    expect(say({ kind: "noFix", count: 1 })).toBe(
      "OneUptime AI found no fix for this alert, so nothing was changed.",
    );
    expect(say({ kind: "noFix", count: 1 }, "incident")).toBe(
      "OneUptime AI found no fix for this incident, so nothing was changed.",
    );
    expect(say({ kind: "recovered", count: 1 }, "incident")).toBe(
      "A fix ran, and this incident recovered.",
    );
    expect(say({ kind: "verifying", count: 1 })).toBe(
      "A fix ran. OneUptime is checking whether this alert recovers.",
    );
    expect(say({ kind: "stoppedPartway", count: 1 })).toBe(
      "OneUptime AI stopped partway through a fix for this alert. Check what it changed.",
    );
  });

  test("one fix waiting is 'a fix', more are counted", () => {
    expect(say({ kind: "needsYourApproval", count: 1 })).toBe(
      "A fix is ready for this alert. It runs once you approve it.",
    );
    expect(say({ kind: "needsYourApproval", count: 3 })).toBe(
      "3 fixes are ready for this alert. Each runs once you approve it.",
    );
    expect(say({ kind: "needsSomeonesApproval", count: 1 }, "incident")).toBe(
      "A fix is ready for this incident. It runs once someone who may approve fixes approves it.",
    );
    expect(say({ kind: "dismissed", count: 2 })).toBe(
      "The 2 fixes for this alert were dismissed, so nothing ran.",
    );
    expect(say({ kind: "dismissed", count: 1 })).toBe(
      "The fix for this alert was dismissed, so nothing ran.",
    );
  });

  test("every kind names the record and has no placeholder left", () => {
    for (const kind of Object.keys(
      REMEDIATION_STEP_SUMMARY_COPY,
    ) as Array<RemediationStepSummaryKind>) {
      for (const count of [1, 2, 21]) {
        for (const signal of ["incident", "alert"] as const) {
          const sentence: string = say({ kind, count }, signal);

          expect(sentence).toContain(`this ${signal}`);
          expect(sentence).not.toMatch(/\{\{|\}\}/);
          expect(sentence).toMatch(/[.]$/);
        }
      }
    }
  });
});

describe("the sentence, in other languages", () => {
  test("German names the record in its own word, with the count the German way", () => {
    const german: Translator = dashboardTranslator("de");
    const incident: string = german.translateTerm("Incident", {
      inSentence: true,
    });

    expect(
      describeRemediationStepSummary(
        { kind: "needsYourApproval", count: 1200 },
        { translator: german, signal: "incident" },
      ),
    ).toBe(
      `1.200 Korrekturen für diesen Eintrag (${incident}) sind bereit. Jede läuft, sobald Sie sie genehmigen.`,
    );
    expect(
      describeRemediationStepSummary(
        { kind: "needsYourApproval", count: 1 },
        { translator: german, signal: "incident" },
      ),
    ).toBe(
      `Eine Korrektur für diesen Eintrag (${incident}) ist bereit. Sie läuft, sobald Sie sie genehmigen.`,
    );
  });

  test("Russian's 21 is never read as 'one fix'", () => {
    const russian: Translator = dashboardTranslator("ru");
    const sentence: string = describeRemediationStepSummary(
      { kind: "dismissed", count: 21 },
      { translator: russian, signal: "alert" },
    );

    expect(sentence).toContain("21");
    expect(sentence).not.toBe(
      describeRemediationStepSummary(
        { kind: "dismissed", count: 1 },
        { translator: russian, signal: "alert" },
      ),
    );
  });

  // A placeholder left unfilled, or the English sentence's own words.
  const ENGLISH_LEFT: RegExp = /\{\{|this incident|fix(es)? (is|are|ran)/;

  test("no language leaves English words or a placeholder in any sentence", () => {
    for (const language of ["fr", "es", "ja", "zh-CN", "fa", "ar", "hi"]) {
      const translator: Translator = dashboardTranslator(language);

      for (const kind of Object.keys(
        REMEDIATION_STEP_SUMMARY_COPY,
      ) as Array<RemediationStepSummaryKind>) {
        for (const count of [1, 2, 5]) {
          const sentence: string = describeRemediationStepSummary(
            { kind, count },
            { translator, signal: "incident" },
          );

          expect({
            language,
            kind,
            count,
            isEnglishLeft: ENGLISH_LEFT.test(sentence),
          }).toEqual({ language, kind, count, isEnglishLeft: false });
        }
      }
    }
  });
});

/*
 * The facts the sentence reads, from a fix as the step reads it: what a
 * fix in progress is doing, that it did not recover, and that its round
 * made a change before it stopped.
 */
describe("the facts the sentence reads", () => {
  const AGENT_ID: string = "0193c0de-7777-4aaa-8bbb-000000000027";
  const CLUSTER_ID: string = "0193c0de-5555-4aaa-8bbb-000000000025";

  function plan(
    executionStatus?: AiRemediationPlanExecutionStatus,
  ): JSONObject {
    return {
      ...(executionStatus ? { executionStatus } : {}),
      commands: [
        {
          sequence: 1,
          stepType: RunbookStepType.Kubectl,
          runnerId: AGENT_ID,
          runnerNameSnapshot: "Kubernetes AI agent",
          kubernetesClusterId: CLUSTER_ID,
          kubernetesClusterNameSnapshot: "prod-east",
          kubectlTier: KubectlCommandTier.SafeWrite,
          command: "kubectl rollout restart deployment/web -n web",
          timeoutInMs: 60000,
          rationale: "r",
          expectedEffect: "e",
          policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
        },
      ],
    };
  }

  function fix(
    status: AutoRemediationSuggestionStatus,
    overrides: Partial<Record<string, unknown>> = {},
  ): AutoRemediationSuggestion {
    return Object.assign(new AutoRemediationSuggestion(), {
      status,
      suggestionType: AutoRemediationSuggestionType.CommandPlan,
      commandPlan: plan(),
      ...overrides,
    });
  }

  function round(
    runStatus: AIRunStatus,
    applied: Partial<RemediationRoundAppliedSteps> = {},
  ): RemediationRoundView {
    const run: AIRun = new AIRun();
    run.status = runStatus;

    return {
      suggestionId: "0193c0de-6666-4aaa-8bbb-000000000026",
      aiRunId: "0193c0de-9999-4aaa-8bbb-000000000029",
      run,
      events: [],
      checks: [],
      otherCheckCount: 0,
      explanation: null,
      appliedSteps: {
        commandCount: 0,
        changeCount: 0,
        isRunbookStarted: false,
        ...applied,
      },
      mayTryAgain: true,
    };
  }

  test("a fix being worked out is planning", () => {
    expect(
      getRemediationFixFacts(fix(AutoRemediationSuggestionStatus.Planning))
        .progress,
    ).toBe("planning");
  });

  test("an approved plan not yet started, or running, is running", () => {
    for (const executionStatus of [
      AiRemediationPlanExecutionStatus.NotStarted,
      AiRemediationPlanExecutionStatus.Running,
    ]) {
      expect(
        getRemediationFixFacts(
          fix(AutoRemediationSuggestionStatus.Approved, {
            commandPlan: plan(executionStatus),
          }),
        ).progress,
      ).toBe("running");
    }
  });

  test("a plan that ran, while its recovery is checked, is verifying", () => {
    expect(
      getRemediationFixFacts(
        fix(AutoRemediationSuggestionStatus.AutoExecuted, {
          commandPlan: plan(AiRemediationPlanExecutionStatus.Completed),
          verificationStatus: AutoRemediationVerificationStatus.Pending,
        }),
      ).progress,
    ).toBe("verifying");
  });

  test("a fix that is not moving has no progress at all", () => {
    for (const row of [
      fix(AutoRemediationSuggestionStatus.Suggested),
      fix(AutoRemediationSuggestionStatus.NoneApplicable),
      fix(AutoRemediationSuggestionStatus.AutoExecuted, {
        commandPlan: plan(AiRemediationPlanExecutionStatus.Completed),
        verificationStatus: AutoRemediationVerificationStatus.Verified,
      }),
    ]) {
      expect(getRemediationFixFacts(row)).not.toHaveProperty("progress");
    }
  });

  test("a fix whose record did not recover says so; one that failed to run does not", () => {
    expect(
      getRemediationFixFacts(
        fix(AutoRemediationSuggestionStatus.AutoExecuted, {
          commandPlan: plan(AiRemediationPlanExecutionStatus.Completed),
          verificationStatus: AutoRemediationVerificationStatus.Failed,
        }),
      ).didNotRecover,
    ).toBe(true);

    const failedRun: RemediationFixFacts = getRemediationFixFacts(
      fix(AutoRemediationSuggestionStatus.Approved, {
        commandPlan: plan(AiRemediationPlanExecutionStatus.Failed),
      }),
    );
    expect(failedRun.hasFailed).toBe(true);
    expect(failedRun).not.toHaveProperty("didNotRecover");
  });

  test("a stopped round that ran a command or sent a change, or started a runbook, made a change", () => {
    for (const applied of [
      { commandCount: 1 },
      { changeCount: 2 },
      { isRunbookStarted: true },
    ]) {
      const read: RemediationFixFacts = getRemediationFixFacts(
        fix(AutoRemediationSuggestionStatus.Planning),
        { round: round(AIRunStatus.Error, applied) },
      );

      expect(read.isUnfinished).toBe(true);
      expect(read.hasAppliedSteps).toBe(true);
      expect(getRemediationStepSummary({ fixes: [read] })?.kind).toBe(
        "stoppedPartway",
      );
    }
  });

  test("a stopped round that changed nothing stopped before it found a fix", () => {
    const read: RemediationFixFacts = getRemediationFixFacts(
      fix(AutoRemediationSuggestionStatus.NoneApplicable),
      { round: round(AIRunStatus.Stale) },
    );

    expect(read.isUnfinished).toBe(true);
    expect(read).not.toHaveProperty("hasAppliedSteps");
    expect(getRemediationStepSummary({ fixes: [read] })?.kind).toBe("stopped");
  });

  test("facts read without a round are as they were", () => {
    expect(
      getRemediationFixFacts(fix(AutoRemediationSuggestionStatus.Suggested)),
    ).toEqual({
      status: AutoRemediationSuggestionStatus.Suggested,
      isUnapprovable: false,
      isInProgress: false,
      hasRun: false,
      hasFailed: false,
      isVerified: false,
      isFirstApprovedByReader: false,
    });
  });
});
