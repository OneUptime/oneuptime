import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getRemediationFixApprovals,
  getRemediationFixSteps,
  RemediationFixApprovals,
  RemediationFixStep,
  RemediationFixStepKind,
  RemediationFixStepSuggestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationFixSteps";
import {
  REMEDIATION_ALREADY_APPROVED_FIRST_REFUSED,
  REMEDIATION_FIX_STEP_COPY,
  REMEDIATION_TWO_APPROVALS_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import {
  getRemediationFixFacts,
  getRemediationStepStatus,
  REMEDIATION_STEP_STATUS_TEXT,
  RemediationFixFacts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepStatus";
import { getActionErrorTitle } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationApprovalSource from "../../../Types/AutoRemediation/AutoRemediationApprovalSource";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import { ALREADY_APPROVED_FIRST_MESSAGE } from "../../../Types/AutoRemediation/RemediationApprovals";
import { JSONObject } from "../../../Types/JSON";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { createTranslator, Translator } from "../../../Types/Translator";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * TWO PEOPLE APPROVE A RISKIER FIX, ON THE AI CARD (#6148's follow-up).
 *
 * Where the project asks two people to approve a fix that holds a riskier
 * change, the card says it before anyone approves, shows the first approval
 * as a step of its own - who, where, when - and then that a second person
 * is needed; it says "you" to the reader who approved first, why their own
 * press would do nothing, and the pill and the fact beside the fix say the
 * same. A fix one approval runs reads as it always has.
 */

const MAYA: string = "0193c0de-aaaa-4aaa-8bbb-0000000000aa";
const SAM: string = "0193c0de-bbbb-4aaa-8bbb-0000000000bb";
const AT_PLANNED: string = "2026-11-06T09:00:00.000Z";
const AT_FIRST: string = "2026-11-06T09:02:00.000Z";
const AT_SECOND: string = "2026-11-06T09:05:00.000Z";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function translatorFor(language: string): Translator {
  const words: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;

  return createTranslator((text: string): string | undefined => {
    return words[text];
  }, language);
}

function command(tier: KubectlCommandTier): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.Kubectl,
    runnerId: "0193c0de-1111-4aaa-8bbb-000000000001",
    runnerNameSnapshot: "Kubernetes AI agent",
    kubernetesClusterId: "0193c0de-2222-4aaa-8bbb-000000000002",
    kubernetesClusterNameSnapshot: "prod-east",
    kubectlTier: tier,
    command:
      tier === KubectlCommandTier.RiskyWrite
        ? "kubectl scale deployment/web --replicas=0 -n web"
        : "kubectl rollout restart deployment/web -n web",
    timeoutInMs: 60000,
    rationale: "the old pods hold the bad config",
    expectedEffect: "fresh pods",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
  };
}

function fix(
  data: Partial<RemediationFixStepSuggestion> & JSONObject = {},
): RemediationFixStepSuggestion {
  return {
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: { commands: [command(KubectlCommandTier.RiskyWrite)] },
    createdAt: new Date(AT_PLANNED),
    ...data,
  } as unknown as RemediationFixStepSuggestion;
}

// Maya approved it first, from Slack.
function approvedFirstByMaya(
  data: Partial<RemediationFixStepSuggestion> & JSONObject = {},
): RemediationFixStepSuggestion {
  return fix({
    firstApprovedByUserId: new ObjectID(MAYA),
    firstApprovedByUser: { name: "Maya Chen" } as never,
    firstApprovedAt: new Date(AT_FIRST),
    firstApprovedFrom: AutoRemediationApprovalSource.Slack,
    ...data,
  });
}

function stepsFor(data: {
  suggestion: RemediationFixStepSuggestion;
  isTwoApprovalsRuleOn?: boolean | undefined;
  readerUserId?: string | undefined;
  mayApprove?: boolean | undefined;
  translator?: Translator | undefined;
}): Array<RemediationFixStep> {
  return getRemediationFixSteps({
    suggestion: data.suggestion,
    isTwoApprovalsRuleOn: data.isTwoApprovalsRuleOn,
    readerUserId: data.readerUserId,
    mayApprove: data.mayApprove,
    translator: data.translator,
  });
}

function kinds(
  steps: Array<RemediationFixStep>,
): Array<RemediationFixStepKind> {
  return steps.map((step: RemediationFixStep): RemediationFixStepKind => {
    return step.kind;
  });
}

function stepOf(
  steps: Array<RemediationFixStep>,
  kind: RemediationFixStepKind,
): RemediationFixStep {
  const found: RemediationFixStep | undefined = steps.find(
    (step: RemediationFixStep): boolean => {
      return step.kind === kind;
    },
  );

  if (!found) {
    throw new Error(`No ${kind} step in ${kinds(steps).join(", ")}`);
  }

  return found;
}

describe("before anyone approves a riskier fix two people must approve", () => {
  test("the approval step says two people must approve it, and that the reader's is the first", () => {
    const steps: Array<RemediationFixStep> = stepsFor({
      suggestion: fix(),
      isTwoApprovalsRuleOn: true,
      readerUserId: MAYA,
    });

    expect(kinds(steps)).toEqual(["plan", "approval"]);
    expect(stepOf(steps, "approval")).toMatchObject({
      tone: "attention",
      title: REMEDIATION_FIX_STEP_COPY.waitingForApproval,
      summary: "Two people must approve this riskier fix. Yours is the first.",
      isSummaryWritten: false,
    });
  });

  test("to a reader who may not approve it: two people must, nothing about theirs", () => {
    const step: RemediationFixStep = stepOf(
      stepsFor({
        suggestion: fix(),
        isTwoApprovalsRuleOn: true,
        readerUserId: MAYA,
        mayApprove: false,
      }),
      "approval",
    );

    expect(step.title).toBe(
      REMEDIATION_FIX_STEP_COPY.waitingForSomeonesApproval,
    );
    expect(step.summary).toBe("Two people must approve this riskier fix.");
  });

  test("nothing is said of two with the rule off, unread, or for a fix of safe changes", () => {
    for (const each of [
      { suggestion: fix(), isTwoApprovalsRuleOn: false },
      { suggestion: fix(), isTwoApprovalsRuleOn: undefined },
      {
        suggestion: fix({
          commandPlan: { commands: [command(KubectlCommandTier.SafeWrite)] },
        }),
        isTwoApprovalsRuleOn: true,
      },
      {
        suggestion: fix({
          suggestionType: AutoRemediationSuggestionType.Runbook,
          commandPlan: undefined,
        }),
        isTwoApprovalsRuleOn: true,
      },
    ]) {
      const step: RemediationFixStep = stepOf(
        stepsFor({ ...each, readerUserId: MAYA }),
        "approval",
      );

      expect(step.title).toBe(REMEDIATION_FIX_STEP_COPY.waitingForApproval);
      expect(step.summary).toBeNull();
    }
  });
});

describe("after the first of two approvals", () => {
  test("the first approval is a step of its own - who, where, when - then a second person is needed", () => {
    const steps: Array<RemediationFixStep> = stepsFor({
      suggestion: approvedFirstByMaya(),
      isTwoApprovalsRuleOn: true,
      readerUserId: SAM,
    });

    expect(kinds(steps)).toEqual(["plan", "firstApproval", "approval"]);
    expect(stepOf(steps, "firstApproval")).toMatchObject({
      tone: "done",
      summary: null,
      hasDetails: false,
    });
    expect(withoutIsolateMarks(stepOf(steps, "firstApproval").title)).toBe(
      "Approved by Maya Chen in Slack",
    );
    expect(stepOf(steps, "firstApproval").at?.toISOString()).toBe(AT_FIRST);
    expect(stepOf(steps, "approval")).toMatchObject({
      tone: "attention",
      title: "Needs a second approval",
      summary:
        "Two people must approve this riskier fix. Your approval runs it.",
    });
  });

  test("the reader who approved first is told it runs once someone else approves it too", () => {
    const step: RemediationFixStep = stepOf(
      stepsFor({
        suggestion: approvedFirstByMaya(),
        isTwoApprovalsRuleOn: true,
        readerUserId: MAYA.toUpperCase(),
      }),
      "approval",
    );

    expect(step.title).toBe("Needs a second approval");
    expect(step.summary).toBe(
      "You approved it first. It runs once someone else approves it too.",
    );
  });

  test("a reader who may not approve reads that two people must", () => {
    const step: RemediationFixStep = stepOf(
      stepsFor({
        suggestion: approvedFirstByMaya(),
        isTwoApprovalsRuleOn: true,
        readerUserId: SAM,
        mayApprove: false,
      }),
      "approval",
    );

    expect(step.title).toBe("Needs a second approval");
    expect(step.summary).toBe("Two people must approve this riskier fix.");
  });

  test("before the rule is read, a recorded first approval still says a second is needed", () => {
    expect(
      kinds(
        stepsFor({
          suggestion: approvedFirstByMaya(),
          readerUserId: SAM,
        }),
      ),
    ).toEqual(["plan", "firstApproval", "approval"]);
  });

  test("once the rule reads off, one approval runs it: no first approval step, the usual approval line", () => {
    const steps: Array<RemediationFixStep> = stepsFor({
      suggestion: approvedFirstByMaya(),
      isTwoApprovalsRuleOn: false,
      readerUserId: MAYA,
    });

    expect(kinds(steps)).toEqual(["plan", "approval"]);
    expect(stepOf(steps, "approval").title).toBe(
      REMEDIATION_FIX_STEP_COPY.waitingForApproval,
    );
    expect(stepOf(steps, "approval").summary).toBeNull();
  });

  test("a first approval from the card, or by someone whose name cannot be read, reads like a lone one", () => {
    const fromCard: RemediationFixStep = stepOf(
      stepsFor({
        suggestion: approvedFirstByMaya({
          firstApprovedFrom: AutoRemediationApprovalSource.Dashboard,
        }),
        isTwoApprovalsRuleOn: true,
      }),
      "firstApproval",
    );
    expect(withoutIsolateMarks(fromCard.title)).toBe("Approved by Maya Chen");

    const nameless: RemediationFixStep = stepOf(
      stepsFor({
        suggestion: approvedFirstByMaya({
          firstApprovedByUser: undefined,
          firstApprovedFrom: AutoRemediationApprovalSource.MicrosoftTeams,
        }),
        isTwoApprovalsRuleOn: true,
      }),
      "firstApproval",
    );
    expect(nameless.title).toBe("Approved in Microsoft Teams");
  });
});

describe("once a fix two people approved is decided", () => {
  test("approved a second time: both approvals, in the order they happened, then the run", () => {
    const steps: Array<RemediationFixStep> = stepsFor({
      suggestion: approvedFirstByMaya({
        status: AutoRemediationSuggestionStatus.Approved,
        approvedByUserId: new ObjectID(SAM),
        approvedByUser: { name: "Sam Lee" } as never,
        approvedAt: new Date(AT_SECOND),
        approvedFrom: AutoRemediationApprovalSource.Dashboard,
      }),
      isTwoApprovalsRuleOn: true,
      readerUserId: MAYA,
    });

    expect(kinds(steps).slice(0, 4)).toEqual([
      "plan",
      "firstApproval",
      "approval",
      "run",
    ]);
    expect(withoutIsolateMarks(stepOf(steps, "firstApproval").title)).toBe(
      "Approved by Maya Chen in Slack",
    );
    expect(withoutIsolateMarks(stepOf(steps, "approval").title)).toBe(
      "Approved by Sam Lee",
    );
    expect(stepOf(steps, "approval").at?.toISOString()).toBe(AT_SECOND);
    // Decided: nothing waits, nothing is said of two any more.
    expect(stepOf(steps, "approval").summary).toBeNull();
  });

  test("approved by the first approver alone, after the rule went off: one approval step", () => {
    const steps: Array<RemediationFixStep> = stepsFor({
      suggestion: approvedFirstByMaya({
        status: AutoRemediationSuggestionStatus.Approved,
        approvedByUserId: new ObjectID(MAYA),
        approvedByUser: { name: "Maya Chen" } as never,
        approvedAt: new Date(AT_SECOND),
      }),
    });

    expect(
      kinds(steps).filter((kind: string): boolean => {
        return kind === "firstApproval";
      }),
    ).toEqual([]);
  });

  test("dismissed after a first approval: the first approval stays in its story", () => {
    const steps: Array<RemediationFixStep> = stepsFor({
      suggestion: approvedFirstByMaya({
        status: AutoRemediationSuggestionStatus.Dismissed,
        dismissedByUser: { name: "Sam Lee" } as never,
        dismissedAt: new Date(AT_SECOND),
      }),
    });

    expect(kinds(steps)).toEqual(["plan", "firstApproval", "approval"]);
    expect(withoutIsolateMarks(stepOf(steps, "approval").title)).toBe(
      "Dismissed by Sam Lee",
    );
  });
});

describe("getRemediationFixApprovals", () => {
  test("only a command plan that waits for approval can need two", () => {
    const none: RemediationFixApprovals = {
      isWaitingForSecondApproval: false,
      needsTwoApprovals: false,
      isFirstApprovedByReader: false,
    };

    for (const status of [
      AutoRemediationSuggestionStatus.Approved,
      AutoRemediationSuggestionStatus.Dismissed,
      AutoRemediationSuggestionStatus.Planning,
      AutoRemediationSuggestionStatus.AutoExecuted,
    ]) {
      expect(
        getRemediationFixApprovals({
          suggestion: approvedFirstByMaya({ status }),
          isTwoApprovalsRuleOn: true,
          readerUserId: MAYA,
        }),
      ).toEqual(none);
    }

    expect(
      getRemediationFixApprovals({
        suggestion: approvedFirstByMaya({
          suggestionType: AutoRemediationSuggestionType.McpToolCalls,
        }),
        isTwoApprovalsRuleOn: true,
        readerUserId: MAYA,
      }),
    ).toEqual(none);
  });

  test("a plan that can no longer be approved waits for nobody", () => {
    expect(
      getRemediationFixApprovals({
        suggestion: approvedFirstByMaya({
          commandPlan: {
            commands: [
              {
                ...command(KubectlCommandTier.RiskyWrite),
                stepType: RunbookStepType.SSH,
              },
            ],
          },
        }),
        isTwoApprovalsRuleOn: true,
        readerUserId: MAYA,
      }).needsTwoApprovals,
    ).toBe(false);
  });

  test("the reader's own first approval, and someone else's", () => {
    expect(
      getRemediationFixApprovals({
        suggestion: approvedFirstByMaya(),
        isTwoApprovalsRuleOn: true,
        readerUserId: MAYA,
      }),
    ).toEqual({
      isWaitingForSecondApproval: true,
      needsTwoApprovals: true,
      isFirstApprovedByReader: true,
    });
    expect(
      getRemediationFixApprovals({
        suggestion: approvedFirstByMaya(),
        isTwoApprovalsRuleOn: true,
        readerUserId: SAM,
      }).isFirstApprovedByReader,
    ).toBe(false);
    // Nobody signed in is nobody's first approval.
    expect(
      getRemediationFixApprovals({
        suggestion: approvedFirstByMaya(),
        isTwoApprovalsRuleOn: true,
        readerUserId: "",
      }).isFirstApprovedByReader,
    ).toBe(false);
  });
});

describe("the pill and the fact beside the fix", () => {
  function facts(
    suggestion: RemediationFixStepSuggestion,
    readerUserId: string,
  ): RemediationFixFacts {
    return getRemediationFixFacts(suggestion as never, {
      isTwoApprovalsRuleOn: true,
      readerUserId,
    });
  }

  function pill(
    fixes: Array<RemediationFixFacts>,
    mayApprove?: boolean | undefined,
  ): string {
    return getRemediationStepStatus({
      isLoaded: true,
      decision: null,
      lines: [],
      fixes,
      investigationStage: "reported",
      isOffByChoice: false,
      mayApprove,
    }).text;
  }

  test("the reader who approved first reads that a second approval is needed", () => {
    expect(pill([facts(approvedFirstByMaya(), MAYA)])).toBe(
      REMEDIATION_STEP_STATUS_TEXT.needsSecondApproval,
    );
    expect(REMEDIATION_STEP_STATUS_TEXT.needsSecondApproval).toBe(
      "Needs a second approval",
    );
  });

  test("anyone else whose approval would run it reads that it needs theirs", () => {
    expect(pill([facts(approvedFirstByMaya(), SAM)])).toBe(
      REMEDIATION_STEP_STATUS_TEXT.needsApproval,
    );
  });

  test("a reader who may not approve reads that it needs approval, as before", () => {
    expect(pill([facts(approvedFirstByMaya(), MAYA)], false)).toBe(
      REMEDIATION_STEP_STATUS_TEXT.needsSomeonesApproval,
    );
  });

  test("another fix that waits for the reader still needs their approval", () => {
    expect(pill([facts(approvedFirstByMaya(), MAYA), facts(fix(), MAYA)])).toBe(
      REMEDIATION_STEP_STATUS_TEXT.needsApproval,
    );
  });
});

describe("a refused press of the first approver", () => {
  test("is headed by what happened: their approval was already recorded", () => {
    expect(
      getActionErrorTitle(
        "approve",
        AutoRemediationSuggestionStatus.Suggested,
        true,
      ),
    ).toBe(REMEDIATION_TWO_APPROVALS_COPY.alreadyApprovedTitle);
    // Anyone else's refusal reads as before.
    expect(
      getActionErrorTitle(
        "approve",
        AutoRemediationSuggestionStatus.Suggested,
        false,
      ),
    ).toBe(
      "Could not save your action: the fix was not approved and nothing ran",
    );
  });

  test("the server's refusal and the card's key are the same words, so it reads in the reader's language", () => {
    expect(REMEDIATION_ALREADY_APPROVED_FIRST_REFUSED).toBe(
      ALREADY_APPROVED_FIRST_MESSAGE,
    );
  });
});

describe("in the reader's language", () => {
  const SENTENCES: Array<string> = [
    REMEDIATION_TWO_APPROVALS_COPY.needsSecondApproval,
    REMEDIATION_TWO_APPROVALS_COPY.waitingForSecondApproval,
    REMEDIATION_TWO_APPROVALS_COPY.yoursIsTheFirst,
    REMEDIATION_TWO_APPROVALS_COPY.yoursRunsIt,
    REMEDIATION_TWO_APPROVALS_COPY.youApprovedFirst,
    REMEDIATION_TWO_APPROVALS_COPY.twoPeopleMustApprove,
    REMEDIATION_TWO_APPROVALS_COPY.firstApprovalNote,
    REMEDIATION_TWO_APPROVALS_COPY.alreadyApprovedTitle,
    REMEDIATION_ALREADY_APPROVED_FIRST_REFUSED,
  ];

  const LANGUAGES: Array<string> = [
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ja",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
  ];

  test.each(LANGUAGES)(
    "%s words every sentence, none left English",
    (language: string) => {
      const translator: Translator = translatorFor(language);

      for (const sentence of SENTENCES) {
        const translated: string | undefined =
          translator.translateText(sentence);

        expect({ sentence, translated }).toEqual({
          sentence,
          translated: expect.any(String),
        });
        expect(translated).not.toBe(sentence);
      }
    },
  );

  test("the steps read in German and in Persian, the name set apart", () => {
    const german: Array<RemediationFixStep> = stepsFor({
      suggestion: approvedFirstByMaya(),
      isTwoApprovalsRuleOn: true,
      readerUserId: MAYA,
      translator: translatorFor("de"),
    });

    expect(withoutIsolateMarks(stepOf(german, "firstApproval").title)).toBe(
      "Genehmigt von Maya Chen in Slack",
    );
    expect(stepOf(german, "approval").title).toBe("Zweite Genehmigung nötig");
    expect(stepOf(german, "approval").summary).toBe(
      "Sie haben zuerst genehmigt. Die Korrektur läuft, sobald auch jemand anderes sie genehmigt.",
    );

    const persian: Array<RemediationFixStep> = stepsFor({
      suggestion: approvedFirstByMaya(),
      isTwoApprovalsRuleOn: true,
      readerUserId: SAM,
      translator: translatorFor("fa"),
    });

    expect(stepOf(persian, "approval").title).toBe("نیازمند تأیید دوم");
    expect(stepOf(persian, "approval").summary).toBe(
      "این اصلاح پرخطرتر را باید دو نفر تأیید کنند. تأیید شما آن را اجرا می‌کند.",
    );
    // Maya's name keeps its own direction in a right-to-left sentence.
    expect(stepOf(persian, "firstApproval").title).toContain(
      "\u{2068}Maya Chen\u{2069}",
    );
  });
});
