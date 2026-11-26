import {
  DataSecurityAiAskReason,
  DataSecurityAiProposalKind,
  DataSecurityAiWork,
} from "../../../Types/DataSecurity/DataSecurityAi";
import {
  DataSecurityAiDecisionEntry,
  DataSecurityAiDecisionHelper,
  DataSecurityAiDecisionReason,
  DataSecurityAiIssueSkipReason,
  isDataSecurityAiIssueSkipReason,
  MAX_DECISION_DETAIL_LENGTH,
} from "../../../Types/DataSecurity/DataSecurityAiDecision";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * Why OneUptime AI did, or did not, act on a Data Security issue (#10364):
 * the entries a record keeps are reason codes and names, read back
 * defensively, and never carry text an action did not mean to keep.
 */

describe("a decision's entries, read back", () => {
  test("keep what each kind of work did, with its rule and proposal", () => {
    const entries: Array<DataSecurityAiDecisionEntry> =
      DataSecurityAiDecisionHelper.parseEntries([
        {
          work: "Contain",
          reason: "Proposed",
          kind: "ScrubTelemetry",
          proposalId: "proposal-1",
          ruleId: "rule-1",
          ruleName: "Telemetry",
          askReason: "NotProvenSafe",
        },
        { work: "Analyze", reason: "Analyzed" },
      ]);

    expect(entries).toEqual([
      {
        work: DataSecurityAiWork.Contain,
        reason: DataSecurityAiDecisionReason.Proposed,
        kind: DataSecurityAiProposalKind.ScrubTelemetry,
        proposalId: "proposal-1",
        ruleId: "rule-1",
        ruleName: "Telemetry",
        askReason: DataSecurityAiAskReason.NotProvenSafe,
        detail: undefined,
      },
      {
        work: DataSecurityAiWork.Analyze,
        reason: DataSecurityAiDecisionReason.Analyzed,
        kind: undefined,
        proposalId: undefined,
        ruleId: undefined,
        ruleName: undefined,
        askReason: undefined,
        detail: undefined,
      },
    ]);
  });

  test("leave out an entry a newer build wrote, or one that is not an entry", () => {
    expect(
      DataSecurityAiDecisionHelper.parseEntries([
        { work: "Contain", reason: "SomethingNew" },
        { work: "Teleport", reason: "Proposed" },
        "Proposed",
        null,
        { reason: "Analyzed" },
      ]),
    ).toEqual([]);
    expect(DataSecurityAiDecisionHelper.parseEntries("not a list")).toEqual([]);
  });

  test("drop a kind or an ask reason this build does not know, and keep the rest", () => {
    const [entry] = DataSecurityAiDecisionHelper.parseEntries([
      {
        work: "Fix",
        reason: "NothingToPropose",
        kind: "OpenAPortal",
        askReason: "BecauseISaidSo",
      },
    ]);

    expect(entry?.kind).toBeUndefined();
    expect(entry?.askReason).toBeUndefined();
    expect(entry?.reason).toBe(DataSecurityAiDecisionReason.NothingToPropose);
  });
});

describe("a detail code", () => {
  test.each([
    ["not-telemetry", "not-telemetry"],
    ["Already-Scrubbed", "already-scrubbed"],
    ["  could-not-plan  ", "could-not-plan"],
  ])("%s is kept as %s", (raw: string, kept: string) => {
    expect(DataSecurityAiDecisionHelper.readDetail(raw)).toBe(kept);
  });

  test.each([
    ["a sentence", "The bucket acme-cards is public."],
    ["a value", "4111-1111-1111-1111 "],
    ["a value with a word in front", "card-4111-1111"],
    ["a key path", "attributes.user.email"],
    ["too long", "a".repeat(MAX_DECISION_DETAIL_LENGTH + 1)],
    ["empty", ""],
  ])(
    "%s is never kept: an entry carries only a short code",
    (_name: string, raw: string) => {
      expect(DataSecurityAiDecisionHelper.readDetail(raw)).toBeUndefined();
    },
  );

  test("is not kept in a stored entry when it is not a code", () => {
    const json: JSONObject = DataSecurityAiDecisionHelper.toJSON({
      work: DataSecurityAiWork.Contain,
      reason: DataSecurityAiDecisionReason.ApplyFailed,
      detail: "card 4111 1111 1111 1111 was in the log",
    });

    expect(json).toEqual({ work: "Contain", reason: "ApplyFailed" });
  });
});

describe("a stored entry", () => {
  test("holds only what it says", () => {
    expect(
      DataSecurityAiDecisionHelper.toJSON({
        work: DataSecurityAiWork.Analyze,
        reason: DataSecurityAiDecisionReason.WorkOff,
        ruleId: undefined,
        ruleName: "",
        detail: "severity-medium",
      }),
    ).toEqual({
      work: "Analyze",
      reason: "WorkOff",
      detail: "severity-medium",
    });
  });
});

describe("whether OneUptime AI acted", () => {
  test("an analysis, a proposal and a change made without asking are acting", () => {
    for (const reason of [
      DataSecurityAiDecisionReason.Analyzed,
      DataSecurityAiDecisionReason.Proposed,
      DataSecurityAiDecisionReason.AppliedWithoutAsking,
    ]) {
      expect(
        DataSecurityAiDecisionHelper.isActed({
          work: DataSecurityAiWork.Contain,
          reason,
        }),
      ).toBe(true);
    }
  });

  test("anything else is not, and an evaluation of only those did nothing", () => {
    const notActing: Array<DataSecurityAiDecisionReason> = Object.values(
      DataSecurityAiDecisionReason,
    ).filter((reason: DataSecurityAiDecisionReason): boolean => {
      return ![
        DataSecurityAiDecisionReason.Analyzed,
        DataSecurityAiDecisionReason.Proposed,
        DataSecurityAiDecisionReason.AppliedWithoutAsking,
      ].includes(reason);
    });
    const entries: Array<DataSecurityAiDecisionEntry> = notActing.map(
      (reason: DataSecurityAiDecisionReason): DataSecurityAiDecisionEntry => {
        return { work: DataSecurityAiWork.Fix, reason };
      },
    );

    expect(DataSecurityAiDecisionHelper.didAct(entries)).toBe(false);
    expect(
      DataSecurityAiDecisionHelper.didAct([
        ...entries,
        {
          work: DataSecurityAiWork.Analyze,
          reason: DataSecurityAiDecisionReason.Analyzed,
        },
      ]),
    ).toBe(true);
  });

  test("a missing provider, no credits, the daily limit and a failure need a person", () => {
    for (const reason of [
      DataSecurityAiDecisionReason.NoLlmProvider,
      DataSecurityAiDecisionReason.NoAiCredits,
      DataSecurityAiDecisionReason.AiDailyLimitReached,
      DataSecurityAiDecisionReason.AnalysisFailed,
      DataSecurityAiDecisionReason.ProofFailed,
      DataSecurityAiDecisionReason.ApplyFailed,
    ]) {
      expect(
        DataSecurityAiDecisionHelper.needsAttention({
          work: DataSecurityAiWork.Analyze,
          reason,
        }),
      ).toBe(true);
    }

    expect(
      DataSecurityAiDecisionHelper.needsAttention({
        work: DataSecurityAiWork.Analyze,
        reason: DataSecurityAiDecisionReason.WorkOff,
      }),
    ).toBe(false);
  });
});

describe("why nothing was done for a whole issue", () => {
  test("the stored reasons are a wire contract", () => {
    expect(Object.values(DataSecurityAiIssueSkipReason)).toEqual([
      "RulesUnreadable",
      "NoRuleMatched",
      "StoreDailyLimitReached",
      "ProjectDailyLimitReached",
      "NothingToDo",
      "EvaluationFailed",
    ]);
    expect(isDataSecurityAiIssueSkipReason("NoRuleMatched")).toBe(true);
    expect(isDataSecurityAiIssueSkipReason("Bored")).toBe(false);
  });
});
