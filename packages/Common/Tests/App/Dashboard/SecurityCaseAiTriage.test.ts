import {
  SecurityCaseAiCopy,
  SecurityCaseAiResult,
  SecurityCaseAiStage,
  SecurityCaseTriageNotStartedCode,
  SecurityCaseTriageStatusView,
  canStartTriage,
  didLatestTriageNotFinish,
  getSecurityCaseAiBadge,
  getSecurityCaseAiReasonAction,
  getSecurityCaseAiStage,
  getSecurityCaseAiStepLabel,
  getSecurityCaseAiVerdictSentence,
  isBlockingTriageReason,
  isTriageOnItsWay,
  isTriageRunActive,
  parseSecurityCaseTriageStatus,
  readSecurityCaseAiResult,
  shouldOfferSuggestedPriority,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseAiTriage";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import SecurityCaseAiVerdict from "../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCasePriority from "../../../Types/SecurityCase/SecurityCasePriority";
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
    expect(getSecurityCaseAiReasonAction("insufficient_ai_balance")).toEqual({
      label: "Add AI credits",
      page: PageMap.SETTINGS_AI_CREDITS,
    });
    expect(
      getSecurityCaseAiReasonAction("project_daily_limit_reached")?.page,
    ).toBe(PageMap.SETTINGS_AI_FEATURES);
    expect(getSecurityCaseAiReasonAction("not_enqueued")).toBeNull();
    expect(getSecurityCaseAiReasonAction(null)).toBeNull();
  });

  test("the suggested priority is one click only when the case is at another", () => {
    expect(
      shouldOfferSuggestedPriority({
        suggestedPriority: SecurityCasePriority.Critical,
        currentPriority: SecurityCasePriority.High,
      }),
    ).toBe(true);
    expect(
      shouldOfferSuggestedPriority({
        suggestedPriority: SecurityCasePriority.High,
        currentPriority: SecurityCasePriority.High,
      }),
    ).toBe(false);
    expect(
      shouldOfferSuggestedPriority({
        currentPriority: SecurityCasePriority.High,
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
        aiSuggestedPriority: "Low",
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
      suggestedPriority: SecurityCasePriority.Low,
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
        aiSuggestedPriority: "Urgent",
        aiTriageReport: "   ",
        aiTriagedAt: "not a date",
        aiTriagePromptInjectionSuspected: "true",
      }),
    ).toEqual({
      verdict: undefined,
      suggestedPriority: undefined,
      suggestedPlaybookId: undefined,
      report: undefined,
      triagedAt: undefined,
      promptInjectionSuspected: false,
    });
  });
});
