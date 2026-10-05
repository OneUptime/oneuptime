import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionHelper,
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
  MAX_DECISION_MONITORS,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

/*
 * A decision's entries live in a JSON column the dashboard reads back. A
 * row can be written by a newer server than the one reading it, or be
 * damaged, so reading is defensive: an entry this build does not know is
 * left out, and a field of the wrong type is dropped, never drawn as
 * something it is not. Storing drops what is not there.
 */

describe("AutoRemediationDecisionHelper.parseEntries", () => {
  it("reads a well-formed entry with every field", () => {
    const entries: Array<AutoRemediationDecisionEntry> =
      AutoRemediationDecisionHelper.parseEntries([
        {
          lane: "KubernetesCluster",
          reason: "ClusterNotReady",
          kubernetesClusterId: "c-1",
          kubernetesClusterName: "prod-east",
          remediationMode: "RequireApproval",
          gaps: [
            {
              code: "ai_agent_not_connected",
              title: "The AI agent is not connected",
              description: "It never registered.",
              nextStep: "Upgrade the chart.",
            },
          ],
        },
        {
          lane: "Rule",
          reason: "RuleRunbookProposed",
          ruleId: "r-1",
          ruleName: "Restart checkout",
          runbookId: "b-1",
          runbookName: "Restart pods",
        },
        {
          lane: "Rule",
          reason: "NoRuleMatched",
          rulesChecked: 4,
        },
      ]);

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      lane: AutoRemediationDecisionLane.KubernetesCluster,
      reason: AutoRemediationDecisionReason.ClusterNotReady,
      kubernetesClusterId: "c-1",
      kubernetesClusterName: "prod-east",
      remediationMode: "RequireApproval",
      gaps: [
        {
          code: "ai_agent_not_connected",
          title: "The AI agent is not connected",
          description: "It never registered.",
          nextStep: "Upgrade the chart.",
        },
      ],
    });
    expect(entries[1]).toMatchObject({
      ruleId: "r-1",
      ruleName: "Restart checkout",
      runbookId: "b-1",
      runbookName: "Restart pods",
    });
    expect(entries[2]!.rulesChecked).toBe(4);
  });

  it("leaves out entries with an unknown lane or reason, and anything not an entry", () => {
    expect(
      AutoRemediationDecisionHelper.parseEntries([
        { lane: "Spaceship", reason: "ClusterFixesOff" },
        { lane: "KubernetesCluster", reason: "SomethingNewer" },
        { lane: "KubernetesCluster" },
        { reason: "ClusterFixesOff" },
        null,
        "ClusterFixesOff",
        42,
        { lane: "Project", reason: "EnableAiOff" },
      ]),
    ).toEqual([
      expect.objectContaining({
        lane: AutoRemediationDecisionLane.Project,
        reason: AutoRemediationDecisionReason.EnableAiOff,
      }),
    ]);
  });

  it("reads anything but a list as no entries", () => {
    expect(AutoRemediationDecisionHelper.parseEntries(undefined)).toEqual([]);
    expect(AutoRemediationDecisionHelper.parseEntries(null)).toEqual([]);
    expect(AutoRemediationDecisionHelper.parseEntries({})).toEqual([]);
    expect(AutoRemediationDecisionHelper.parseEntries("[]")).toEqual([]);
  });

  it("drops fields of the wrong type", () => {
    const [entry] = AutoRemediationDecisionHelper.parseEntries([
      {
        lane: "KubernetesCluster",
        reason: "ClusterFixesOff",
        kubernetesClusterId: 12,
        kubernetesClusterName: { name: "x" },
        remediationMode: "",
      },
    ]);

    expect(entry!.kubernetesClusterId).toBeUndefined();
    expect(entry!.kubernetesClusterName).toBeUndefined();
    expect(entry!.remediationMode).toBeUndefined();
  });

  it("keeps only gaps with a code and a title", () => {
    const [entry] = AutoRemediationDecisionHelper.parseEntries([
      {
        lane: "Resource",
        reason: "ResourceNotReady",
        gaps: [
          { code: "agent_offline", title: "The agent is offline" },
          { code: "no_title" },
          { title: "No code" },
          "agent_offline",
          null,
        ],
      },
    ]);

    expect(entry!.gaps).toEqual([
      {
        code: "agent_offline",
        title: "The agent is offline",
        description: undefined,
        nextStep: "",
      },
    ]);
  });

  it("keeps only monitors with an id, and at most a handful", () => {
    const monitors: Array<JSONObject> = Array.from(
      { length: MAX_DECISION_MONITORS + 3 },
      (_value: unknown, index: number): JSONObject => {
        return { id: `m-${index}`, name: `Monitor ${index}` };
      },
    );

    const [entry] = AutoRemediationDecisionHelper.parseEntries([
      {
        lane: "KubernetesCluster",
        reason: "ClusterNoneLinked",
        monitors: [{ name: "No id" }, ...monitors, { id: "m-x" }],
      },
    ]);

    expect(entry!.monitors).toHaveLength(MAX_DECISION_MONITORS);
    expect(entry!.monitors![0]).toEqual({ id: "m-0", name: "Monitor 0" });
  });

  it("reads a rules count only as a whole number from zero up", () => {
    const read: (value: unknown) => number | undefined = (
      value: unknown,
    ): number | undefined => {
      return AutoRemediationDecisionHelper.parseEntries([
        { lane: "Rule", reason: "NoRuleMatched", rulesChecked: value },
      ])[0]!.rulesChecked;
    };

    expect(read(3)).toBe(3);
    expect(read(0)).toBe(0);
    expect(read(2.7)).toBe(2);
    expect(read(-1)).toBeUndefined();
    expect(read("3")).toBeUndefined();
    expect(read(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe("AutoRemediationDecisionHelper.toJSON", () => {
  it("stores only what the entry says", () => {
    expect(
      AutoRemediationDecisionHelper.toJSON({
        lane: AutoRemediationDecisionLane.KubernetesCluster,
        reason: AutoRemediationDecisionReason.ClusterNoneLinked,
        kubernetesClusterId: undefined,
        monitors: [],
        gaps: [],
      }),
    ).toEqual({
      lane: "KubernetesCluster",
      reason: "ClusterNoneLinked",
    });
  });

  it("round-trips through parseEntries", () => {
    const entry: AutoRemediationDecisionEntry = {
      lane: AutoRemediationDecisionLane.Resource,
      reason: AutoRemediationDecisionReason.ResourceRoundStarted,
      resourceType: "DockerHost",
      resourceId: "r-1",
      resourceName: "web-1",
      remediationMode: "Automatic",
    };

    expect(
      AutoRemediationDecisionHelper.parseEntries([
        AutoRemediationDecisionHelper.toJSON(entry),
      ])[0],
    ).toMatchObject(entry);
  });
});

describe("AutoRemediationDecisionHelper classification", () => {
  function entry(
    reason: AutoRemediationDecisionReason,
  ): AutoRemediationDecisionEntry {
    return { lane: AutoRemediationDecisionLane.Rule, reason };
  }

  it("counts only proposing or starting a fix as acting", () => {
    for (const reason of [
      AutoRemediationDecisionReason.ClusterRoundStarted,
      AutoRemediationDecisionReason.ResourceRoundStarted,
      AutoRemediationDecisionReason.RuleAiComposingCommands,
      AutoRemediationDecisionReason.RuleAiPickingRunbook,
      AutoRemediationDecisionReason.RuleRunbookProposed,
      AutoRemediationDecisionReason.RuleRunbookProposedByCircuitBreaker,
      AutoRemediationDecisionReason.RuleRunbookStarted,
    ]) {
      expect(AutoRemediationDecisionHelper.isActed(entry(reason))).toBe(true);
    }

    for (const reason of [
      AutoRemediationDecisionReason.ClusterFixesOff,
      AutoRemediationDecisionReason.ClusterRoundNotStarted,
      AutoRemediationDecisionReason.NoRuleMatched,
      AutoRemediationDecisionReason.RuleRunbookNotStarted,
    ]) {
      expect(AutoRemediationDecisionHelper.isActed(entry(reason))).toBe(false);
    }
  });

  it("flags what a reader can fix, and not what is a deliberate choice", () => {
    for (const reason of [
      AutoRemediationDecisionReason.EnableAiOff,
      AutoRemediationDecisionReason.ClusterNotReady,
      AutoRemediationDecisionReason.ResourceNotReady,
      AutoRemediationDecisionReason.RuleSkippedNoLlmProvider,
      AutoRemediationDecisionReason.RuleRunbookNotStarted,
      AutoRemediationDecisionReason.RuleHasNoRunbooks,
    ]) {
      expect(AutoRemediationDecisionHelper.needsAttention(entry(reason))).toBe(
        true,
      );
    }

    for (const reason of [
      AutoRemediationDecisionReason.ClusterFixesOff,
      AutoRemediationDecisionReason.NoRulesConfigured,
      AutoRemediationDecisionReason.ClusterRoundStarted,
    ]) {
      expect(AutoRemediationDecisionHelper.needsAttention(entry(reason))).toBe(
        false,
      );
    }
  });
});
