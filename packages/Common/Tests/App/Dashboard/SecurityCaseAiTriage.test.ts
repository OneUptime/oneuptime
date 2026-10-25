import {
  SecurityCaseAiCopy,
  SecurityCaseAiResult,
  SecurityCaseAiStage,
  SecurityCaseAiTriageAccess,
  SecurityCaseTriageNotStartedCode,
  SecurityCaseTriageStatusView,
  canStartTriage,
  didLatestTriageNotFinish,
  getSecurityCaseAiBadge,
  getSecurityCaseAiCreditsAction,
  getSecurityCaseAiReasonAction,
  getSecurityCaseAiStage,
  getSecurityCaseAiTriageAccess,
  getSuggestedPlaybookRunInProgress,
  getSecurityCaseAiStepLabel,
  getSecurityCaseAiVerdictSentence,
  isBlockingTriageReason,
  isTriageOnItsWay,
  isTriageRunActive,
  parseSecurityCaseTriageStatus,
  readSecurityCaseAiResult,
  shouldOfferSuggestedPriority,
  getFailedTriageDescription,
  withoutTriageInjectionLead,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseAiTriage";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import SecurityCaseAiVerdict from "../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import { TEST_PRIORITY_IDS } from "../../Helpers/SecurityCaseValues";
import SecurityPlaybookRunStatus from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SECURITY_CASE_TRIAGE_INJECTION_LEAD_PREFIX } from "../../../Utils/AI/InvestigationReport";
import { describe, expect, test } from "@jest/globals";

/*
 * The case's AI card, as data: what the server's answer and the case's own
 * ai* columns say, the stage the card draws, and every word it uses - so a
 * plain test pins every state.
 */

const RUN_ID: string = "11111111-1111-4111-8111-111111111111";

function status(
  overrides: Partial<SecurityCaseTriageStatusView> = {},
): SecurityCaseTriageStatusView {
  return {
    run: null,
    steps: [],
    isReportPending: false,
    finishedWithoutReport: false,
    evidence: [],
    notStartedCode: null,
    isAutomaticTriageOn: true,
    ...overrides,
  };
}

function run(statusValue: AIRunStatus): SecurityCaseTriageStatusView["run"] {
  return {
    id: RUN_ID,
    status: statusValue,
    toolCallCount: 3,
    totalTokens: 1200,
  };
}

const NOTHING: SecurityCaseAiResult = { promptInjectionSuspected: false };

const TRIAGED: SecurityCaseAiResult = {
  verdict: SecurityCaseAiVerdict.LikelyMalicious,
  report: "## 🧠 AI — Security Case Triage\n\n**Summary**\nBad.",
  promptInjectionSuspected: false,
};

describe("parseSecurityCaseTriageStatus", () => {
  test("reads the server's answer, the run, its steps and its evidence", () => {
    const parsed: SecurityCaseTriageStatusView = parseSecurityCaseTriageStatus({
      run: {
        _id: RUN_ID,
        status: AIRunStatus.Completed,
        createdAt: "2026-10-14T11:00:00.000Z",
        completedAt: "2026-10-14T11:02:00.000Z",
        toolCallCount: 4,
        totalTokens: 5120,
        errorMessage: null,
      },
      steps: [
        { toolName: "lookup_threat_intel", failed: false, rowCount: 1 },
        { toolName: "search_security_events", failed: true },
      ],
      isReportPending: false,
      finishedWithoutReport: false,
      evidence: [
        {
          citationId: "C1",
          toolName: "lookup_threat_intel",
          label: "Threat intel lookup",
          rowCount: 1,
          queryArguments: { values: ["203.0.113.9"] },
          canLoadRows: true,
        },
      ],
      notStartedReason: null,
      isAutomaticTriageOn: true,
    });

    expect(parsed.run).toMatchObject({
      id: RUN_ID,
      status: AIRunStatus.Completed,
      toolCallCount: 4,
      totalTokens: 5120,
    });
    expect(parsed.run?.completedAt?.toISOString()).toBe(
      "2026-10-14T11:02:00.000Z",
    );
    expect(parsed.steps).toEqual([
      { toolName: "lookup_threat_intel", failed: false, rowCount: 1 },
      { toolName: "search_security_events", failed: true },
    ]);
    expect(parsed.evidence).toHaveLength(1);
    expect(parsed.evidence[0]!.citationId).toBe("C1");
    expect(parsed.isAutomaticTriageOn).toBe(true);
  });

  test("a field an older server left out, or of the wrong shape, reads as nothing", () => {
    expect(parseSecurityCaseTriageStatus(null)).toEqual(
      status({
        isAutomaticTriageOn: false,
      }),
    );
    expect(
      parseSecurityCaseTriageStatus({
        run: "not a run",
        steps: [{ nope: true }, "x", { toolName: 5 }],
        evidence: "nope",
        notStartedReason: { code: "made_up" },
        isAutomaticTriageOn: "yes",
      }),
    ).toEqual(status({ isAutomaticTriageOn: false }));
    expect(
      parseSecurityCaseTriageStatus({
        run: { status: "Exploded", toolCallCount: -4, totalTokens: "many" },
      }).run,
    ).toMatchObject({ status: null, toolCallCount: 0, totalTokens: 0 });
  });

  test("each reason the server can give is read by its code", () => {
    const codes: Array<SecurityCaseTriageNotStartedCode> = [
      "ai_disabled",
      "automatic_triage_disabled",
      "provider_missing",
      "insufficient_ai_balance",
      "project_daily_limit_reached",
      "already_triaging",
      "not_enqueued",
      "eligibility_check_failed",
    ];

    for (const code of codes) {
      expect(
        parseSecurityCaseTriageStatus({
          notStartedReason: { code, message: "x" },
        }).notStartedCode,
      ).toBe(code);
      // Every code has its own sentence on the card.
      expect(SecurityCaseAiCopy.reasons[code]).toMatch(/\.$/);
    }
  });
});

describe("getSecurityCaseAiStage", () => {
  test("not triaged: no run, no read", () => {
    expect(getSecurityCaseAiStage({ status: status(), result: NOTHING })).toBe(
      SecurityCaseAiStage.NotTriaged,
    );
    // Before the server answers, too.
    expect(getSecurityCaseAiStage({ status: null, result: NOTHING })).toBe(
      SecurityCaseAiStage.NotTriaged,
    );
  });

  test("triaging: a run queued or running, or finished with its report not yet on the case", () => {
    for (const value of [AIRunStatus.Queued, AIRunStatus.Running]) {
      expect(
        getSecurityCaseAiStage({
          status: status({ run: run(value) }),
          result: TRIAGED,
        }),
      ).toBe(SecurityCaseAiStage.Triaging);
    }

    expect(
      getSecurityCaseAiStage({
        status: status({
          run: run(AIRunStatus.Completed),
          isReportPending: true,
        }),
        result: NOTHING,
      }),
    ).toBe(SecurityCaseAiStage.Triaging);
  });

  test("triaged: a read on the case, whatever happened to a later run", () => {
    expect(
      getSecurityCaseAiStage({
        status: status({ run: run(AIRunStatus.Completed) }),
        result: TRIAGED,
      }),
    ).toBe(SecurityCaseAiStage.Triaged);
    expect(
      getSecurityCaseAiStage({
        status: status({ run: run(AIRunStatus.Error) }),
        result: TRIAGED,
      }),
    ).toBe(SecurityCaseAiStage.Triaged);
  });

  test("failed: the only run did not finish, or finished with nothing to say", () => {
    for (const value of [
      AIRunStatus.Error,
      AIRunStatus.Cancelled,
      AIRunStatus.Stale,
    ]) {
      expect(
        getSecurityCaseAiStage({
          status: status({ run: run(value) }),
          result: NOTHING,
        }),
      ).toBe(SecurityCaseAiStage.Failed);
    }

    expect(
      getSecurityCaseAiStage({
        status: status({
          run: run(AIRunStatus.Completed),
          finishedWithoutReport: true,
        }),
        result: NOTHING,
      }),
    ).toBe(SecurityCaseAiStage.Failed);
  });
});

describe("what the card offers", () => {
  test("Triage with AI: with nothing in the way, or only the automatic switch off", () => {
    expect(canStartTriage(null)).toBe(false);
    expect(canStartTriage(status())).toBe(true);
    expect(
      canStartTriage(status({ notStartedCode: "automatic_triage_disabled" })),
    ).toBe(true);
    expect(canStartTriage(status({ notStartedCode: "provider_missing" }))).toBe(
      false,
    );
    expect(canStartTriage(status({ run: run(AIRunStatus.Running) }))).toBe(
      false,
    );
    expect(
      canStartTriage(
        status({ run: run(AIRunStatus.Completed), isReportPending: true }),
      ),
    ).toBe(false);
  });

  test("a reason stops a person's triage, except the automatic switch and a triage on its way", () => {
    expect(isBlockingTriageReason(null)).toBe(false);
    expect(isBlockingTriageReason("automatic_triage_disabled")).toBe(false);
    expect(isBlockingTriageReason("already_triaging")).toBe(false);
    for (const code of [
      "ai_disabled",
      "provider_missing",
      "insufficient_ai_balance",
      "project_daily_limit_reached",
      "not_enqueued",
      "eligibility_check_failed",
    ] as Array<SecurityCaseTriageNotStartedCode>) {
      expect(isBlockingTriageReason(code)).toBe(true);
    }
  });

  test("where a reason sends the reader, when somewhere can fix it", () => {
    expect(getSecurityCaseAiReasonAction("provider_missing")).toEqual({
      label: "Set up an LLM provider",
      page: PageMap.SETTINGS_AI_LLM_PROVIDERS,
    });
    // Running out of AI credits is answered by who is reading (below).
    expect(getSecurityCaseAiReasonAction("insufficient_ai_balance")).toBeNull();
    expect(
      getSecurityCaseAiReasonAction("project_daily_limit_reached")?.page,
    ).toBe(PageMap.SETTINGS_AI_FEATURES);
    expect(getSecurityCaseAiReasonAction("not_enqueued")).toBeNull();
    expect(getSecurityCaseAiReasonAction(null)).toBeNull();
  });

  test("out of AI credits: AI Credits for someone who may add them, who can for anyone known not to, nothing while unknown", () => {
    expect(
      getSecurityCaseAiCreditsAction({
        mayAddCredits: true,
        isKnownNotToAdd: false,
      }),
    ).toEqual({ label: "Add AI credits", linksToAiCredits: true });
    expect(
      getSecurityCaseAiCreditsAction({
        mayAddCredits: false,
        isKnownNotToAdd: true,
      }),
    ).toEqual({
      label:
        "A project owner or someone with Manage Billing can add AI credits.",
      linksToAiCredits: false,
    });
    expect(
      getSecurityCaseAiCreditsAction({
        mayAddCredits: false,
        isKnownNotToAdd: false,
      }),
    ).toBeNull();
  });

  test("who may start a triage: yes, no with the gate's reason, or not known while the permissions are on their way", () => {
    expect(getSecurityCaseAiTriageAccess({ isAllowed: true })).toBe(
      SecurityCaseAiTriageAccess.Yes,
    );
    // A reason means the gate knows: a Security Viewer.
    expect(
      getSecurityCaseAiTriageAccess({
        isAllowed: false,
        disabledReason:
          "You do not have permission to update this Security Case.",
      }),
    ).toBe(SecurityCaseAiTriageAccess.No);
    // No reason: nothing honest to say yet, so nothing is offered or refused.
    expect(getSecurityCaseAiTriageAccess({ isAllowed: false })).toBe(
      SecurityCaseAiTriageAccess.NotKnownYet,
    );
    expect(
      getSecurityCaseAiTriageAccess({ isAllowed: false, disabledReason: "" }),
    ).toBe(SecurityCaseAiTriageAccess.NotKnownYet);
    // Who can, said in the incident card's way: a person, not a role.
    expect(SecurityCaseAiCopy.whoCanTriage).toBe(
      "Someone who can edit this case can start a triage.",
    );
  });

  test("a suggested playbook's run still going on the case stands in for Run playbook; a finished one does not", () => {
    // Queued, running or held for an approval: a second run would repeat it.
    expect(
      getSuggestedPlaybookRunInProgress(SecurityPlaybookRunStatus.Queued),
    ).toBe(SecurityPlaybookRunStatus.Queued);
    expect(
      getSuggestedPlaybookRunInProgress(SecurityPlaybookRunStatus.Running),
    ).toBe(SecurityPlaybookRunStatus.Running);
    expect(
      getSuggestedPlaybookRunInProgress(
        SecurityPlaybookRunStatus.WaitingForApproval,
      ),
    ).toBe(SecurityPlaybookRunStatus.WaitingForApproval);
    // Finished, whatever the outcome: Run playbook again.
    for (const finished of [
      SecurityPlaybookRunStatus.Succeeded,
      SecurityPlaybookRunStatus.Failed,
      SecurityPlaybookRunStatus.Cancelled,
    ]) {
      expect(getSuggestedPlaybookRunInProgress(finished)).toBeNull();
    }
    // No run, or a status this Dashboard does not know: nothing stands in.
    expect(getSuggestedPlaybookRunInProgress(undefined)).toBeNull();
    expect(getSuggestedPlaybookRunInProgress(null)).toBeNull();
    expect(getSuggestedPlaybookRunInProgress("")).toBeNull();
    expect(getSuggestedPlaybookRunInProgress("Paused")).toBeNull();
  });

  test("the suggested priority is one click only when the project still has it and the case is at another", () => {
    const critical: string =
      TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical];
    const high: string = TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High];

    expect(
      shouldOfferSuggestedPriority({
        suggestedPriorityId: critical,
        currentPriorityId: high,
        isSuggestedPriorityKnown: true,
      }),
    ).toBe(true);
    expect(
      shouldOfferSuggestedPriority({
        suggestedPriorityId: high,
        currentPriorityId: high,
        isSuggestedPriorityKnown: true,
      }),
    ).toBe(false);
    // One id in two cases is one priority.
    expect(
      shouldOfferSuggestedPriority({
        suggestedPriorityId: high.toUpperCase(),
        currentPriorityId: high,
        isSuggestedPriorityKnown: true,
      }),
    ).toBe(false);
    expect(
      shouldOfferSuggestedPriority({
        currentPriorityId: high,
        isSuggestedPriorityKnown: false,
      }),
    ).toBe(false);
    // A priority the project has since deleted: nothing to set it to.
    expect(
      shouldOfferSuggestedPriority({
        suggestedPriorityId: critical,
        currentPriorityId: high,
        isSuggestedPriorityKnown: false,
      }),
    ).toBe(false);
  });

  test("the badge beside the title says the stage", () => {
    expect(
      getSecurityCaseAiBadge({
        stage: SecurityCaseAiStage.Triaging,
        hasStatus: true,
      }),
    ).toEqual({ text: "Triaging", indicator: "live" });
    expect(
      getSecurityCaseAiBadge({
        stage: SecurityCaseAiStage.Triaged,
        hasStatus: true,
      }),
    ).toEqual({ text: "Triaged", indicator: "done" });
    expect(
      getSecurityCaseAiBadge({
        stage: SecurityCaseAiStage.Failed,
        hasStatus: true,
      }),
    ).toEqual({ text: "Failed", indicator: "failed" });
    expect(
      getSecurityCaseAiBadge({
        stage: SecurityCaseAiStage.NotTriaged,
        hasStatus: true,
      }),
    ).toEqual({ text: "Not triaged", indicator: "idle" });
    expect(
      getSecurityCaseAiBadge({
        stage: SecurityCaseAiStage.NotTriaged,
        hasStatus: false,
      }),
    ).toEqual({ text: "Checking", indicator: "checking" });
  });
});

describe("the run, read", () => {
  test("on its way and not finished", () => {
    expect(isTriageRunActive(run(AIRunStatus.Queued))).toBe(true);
    expect(isTriageRunActive(run(AIRunStatus.Completed))).toBe(false);
    expect(isTriageRunActive(null)).toBe(false);
    expect(isTriageOnItsWay(null)).toBe(false);
    expect(
      isTriageOnItsWay(
        status({ run: run(AIRunStatus.Completed), isReportPending: true }),
      ),
    ).toBe(true);
    expect(
      didLatestTriageNotFinish(status({ run: run(AIRunStatus.Stale) })),
    ).toBe(true);
    expect(
      didLatestTriageNotFinish(
        status({
          run: run(AIRunStatus.Completed),
          finishedWithoutReport: true,
        }),
      ),
    ).toBe(true);
    expect(
      didLatestTriageNotFinish(status({ run: run(AIRunStatus.Completed) })),
    ).toBe(false);
  });

  test("a check reads as every AI report's evidence words it", () => {
    expect(getSecurityCaseAiStepLabel("lookup_threat_intel")).toBe(
      "Checked threat intel",
    );
    expect(getSecurityCaseAiStepLabel("search_security_events")).toBe(
      "Searched security events",
    );
    expect(getSecurityCaseAiStepLabel("query_security_cases")).toBe(
      "Read security cases",
    );
    // A tool it does not know is still worded, never shown as code.
    expect(getSecurityCaseAiStepLabel("mcp_edr__lookup_host")).not.toContain(
      "_",
    );
  });

  test("each read has its sentence; no read, none", () => {
    expect(
      getSecurityCaseAiVerdictSentence(SecurityCaseAiVerdict.LikelyMalicious),
    ).toBe("The evidence points at malicious or unauthorized activity.");
    expect(getSecurityCaseAiVerdictSentence(undefined)).toBe("");
  });
});

describe("readSecurityCaseAiResult", () => {
  test("the case's ai* columns, as the card reads them", () => {
    expect(
      readSecurityCaseAiResult({
        aiVerdict: "Likely Benign",
        aiSuggestedSecurityCasePriorityId: {
          toString: () => {
            return TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Low];
          },
        },
        aiSuggestedPlaybookId: {
          toString: () => {
            return "pb-id";
          },
        },
        aiTriageReport: "Report.",
        aiTriagedAt: "2026-10-14T11:00:00.000Z",
        aiTriagePromptInjectionSuspected: true,
      }),
    ).toEqual({
      verdict: SecurityCaseAiVerdict.LikelyBenign,
      suggestedPriorityId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Low],
      suggestedPlaybookId: "pb-id",
      report: "Report.",
      triagedAt: new Date("2026-10-14T11:00:00.000Z"),
      promptInjectionSuspected: true,
    });
  });

  test("anything that is not one of its values reads as nothing", () => {
    expect(
      readSecurityCaseAiResult({
        aiVerdict: "Safe",
        aiSuggestedSecurityCasePriorityId: "",
        aiTriageReport: "   ",
        aiTriagedAt: "not a date",
        aiTriagePromptInjectionSuspected: "true",
      }),
    ).toEqual({
      verdict: undefined,
      suggestedPriorityId: undefined,
      suggestedPlaybookId: undefined,
      report: undefined,
      triagedAt: undefined,
      promptInjectionSuspected: false,
    });
  });
});

/*
 * The report the card draws for a case whose data held text written to
 * steer an AI: the card says so first, in the reader's language, so the
 * runner's own heads-up - under the brand heading, in its own words - is
 * left out. Nothing the model wrote is touched.
 */
describe("withoutTriageInjectionLead", () => {
  const HEADING: string = "## 🧠 AI — Security Case Triage";
  const LEAD: string = [
    SECURITY_CASE_TRIAGE_INJECTION_LEAD_PREFIX,
    " - a sign of an attempt to steer the triage. OneUptime AI treated it as data and leaves the call to a person.",
  ].join("");
  const BODY: string = "**Summary**\nA brute force from 203.0.113.9.";

  test("drops the runner's heads-up under the heading, and the blank line after it", () => {
    expect(
      withoutTriageInjectionLead([HEADING, "", LEAD, "", BODY].join("\n")),
    ).toBe([HEADING, "", BODY].join("\n"));
  });

  test("drops it from the top of a report with no heading", () => {
    expect(withoutTriageInjectionLead([LEAD, "", BODY].join("\n"))).toBe(BODY);
  });

  test("a report without it is left as it is", () => {
    const report: string = [HEADING, "", BODY].join("\n");

    expect(withoutTriageInjectionLead(report)).toBe(report);
    expect(withoutTriageInjectionLead("")).toBe("");
  });

  test("the same words further down are the model's, and stay", () => {
    const report: string = [HEADING, "", BODY, "", LEAD].join("\n");

    expect(withoutTriageInjectionLead(report)).toBe(report);
  });

  test("a first paragraph in other words stays", () => {
    const report: string = [
      HEADING,
      "",
      "**Heads up:** the model's own note.",
      "",
      BODY,
    ].join("\n");

    expect(withoutTriageInjectionLead(report)).toBe(report);
  });

  // The server's words, from one constant both read.
  test("the prefix is the runner's opening", () => {
    expect(SECURITY_CASE_TRIAGE_INJECTION_LEAD_PREFIX).toBe(
      "**Heads up:** some text in this case's data reads like instructions to an AI",
    );
  });
});

describe("getFailedTriageDescription", () => {
  test("why the run stopped, as the server recorded it", () => {
    expect(
      getFailedTriageDescription(
        status({
          run: {
            ...run(AIRunStatus.Error)!,
            errorMessage: "The LLM provider did not answer in time.",
          },
        }),
      ),
    ).toBe("The LLM provider did not answer in time.");
  });

  test("the card's own sentence when nothing was recorded", () => {
    expect(
      getFailedTriageDescription(status({ run: run(AIRunStatus.Error) })),
    ).toBe(SecurityCaseAiCopy.failedDescription);
    expect(getFailedTriageDescription(null)).toBe(
      SecurityCaseAiCopy.failedDescription,
    );
  });
});

describe("the card's words for a steered case and the close dialog", () => {
  test("a short title, what was done under it, and the read over the verdicts", () => {
    expect(SecurityCaseAiCopy.promptInjectionTitle).toBe(
      "Text in this case reads like instructions to an AI",
    );
    expect(SecurityCaseAiCopy.promptInjectionDescription).toBe(
      "OneUptime AI treated it as data and leaves the call to you.",
    );
    expect(SecurityCaseAiCopy.closeVerdictHint).toBe(
      "OneUptime AI read this case as {{read}}. Pick what you found.",
    );
  });
});
