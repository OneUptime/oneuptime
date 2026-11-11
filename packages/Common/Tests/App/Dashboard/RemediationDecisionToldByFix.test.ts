import { describe, expect, test } from "@jest/globals";
import {
  getRemediationDecisionLines,
  isRemediationDecisionEntryToldByFixes,
  RemediationDecisionFix,
  RemediationDecisionLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionLines";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import { DEFAULT_RUNBOOK_PICK_NAME } from "../../../Types/AutoRemediation/AutoRemediationFix";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import { getClusterRoundNameSnapshot } from "../../../Types/AutoRemediation/RemediationRoundName";
import ObjectID from "../../../Types/ObjectID";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * A LINE THE FIX BELOW IT TELLS IS NOT DRAWN (issue #6860).
 *
 * The issue's screenshot opened with 'OneUptime AI is fixing cluster
 * "oneuptime-test". Approvals are bypassed on this cluster, so its fixes
 * run on their own.', 'Rule "All alerts" matched: OneUptime AI is fixing
 * this alert.' and 'Rule "All alerts" matched: OneUptime AI is picking the
 * runbook that fits this alert.' - in the present tense, long after both
 * fixes had ended, over the two fixes that said the same: the cluster's
 * round, and the rule's runbook pick. Such a line is marked, and the step
 * leaves it out; a line that says what no fix does stays.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const CLUSTER_ID: string = "0193c0de-5555-4aaa-8bbb-000000000025";
const OTHER_CLUSTER_ID: string = "0193c0de-5555-4aaa-8bbb-000000000035";
const RESOURCE_ID: string = "0193c0de-4444-4aaa-8bbb-000000000024";
const OTHER_RESOURCE_ID: string = "0193c0de-4444-4aaa-8bbb-000000000034";
const RULE_ID: string = "0193c0de-8888-4aaa-8bbb-000000000028";
const OTHER_RULE_ID: string = "0193c0de-8888-4aaa-8bbb-000000000038";
const RUNBOOK_ID: string = "0193c0de-9999-4aaa-8bbb-000000000029";
const OTHER_RUNBOOK_ID: string = "0193c0de-9999-4aaa-8bbb-000000000039";

function fix(
  overrides: Partial<Record<string, unknown>>,
): RemediationDecisionFix {
  return Object.assign(new AutoRemediationSuggestion(), overrides);
}

function entry(
  reason: AutoRemediationDecisionReason,
  fields: Partial<AutoRemediationDecisionEntry> = {},
): AutoRemediationDecisionEntry {
  return {
    lane: AutoRemediationDecisionLane.Rule,
    reason,
    ...fields,
  } as AutoRemediationDecisionEntry;
}

const CLUSTER_ROUND: RemediationDecisionFix = fix({
  suggestionType: AutoRemediationSuggestionType.CommandPlan,
  kubernetesClusterId: new ObjectID(CLUSTER_ID),
  ruleNameSnapshot: getClusterRoundNameSnapshot("oneuptime-test", 1),
});
const DELETED_CLUSTER_ROUND: RemediationDecisionFix = fix({
  suggestionType: AutoRemediationSuggestionType.CommandPlan,
  ruleNameSnapshot: getClusterRoundNameSnapshot("oneuptime-test", 1),
});
const RESOURCE_ROUND: RemediationDecisionFix = fix({
  suggestionType: AutoRemediationSuggestionType.CommandPlan,
  resourceId: new ObjectID(RESOURCE_ID),
});
const RULE_RUNBOOK: RemediationDecisionFix = fix({
  suggestionType: AutoRemediationSuggestionType.Runbook,
  autoRemediationRuleId: new ObjectID(RULE_ID),
  ruleNameSnapshot: "All alerts",
  runbookId: new ObjectID(RUNBOOK_ID),
  runbookNameSnapshot: "Restart checkout",
});
const RULE_PLAN: RemediationDecisionFix = fix({
  suggestionType: AutoRemediationSuggestionType.CommandPlan,
  autoRemediationRuleId: new ObjectID(RULE_ID),
  ruleNameSnapshot: "All alerts",
});
const RULE_MCP: RemediationDecisionFix = fix({
  suggestionType: AutoRemediationSuggestionType.McpToolCalls,
  autoRemediationRuleId: new ObjectID(RULE_ID),
  ruleNameSnapshot: "All alerts",
});
const PROJECT_PICK: RemediationDecisionFix = fix({
  suggestionType: AutoRemediationSuggestionType.Runbook,
  ruleNameSnapshot: DEFAULT_RUNBOOK_PICK_NAME,
});
const PROJECT_MCP: RemediationDecisionFix = fix({
  suggestionType: AutoRemediationSuggestionType.McpToolCalls,
  ruleNameSnapshot: DEFAULT_RUNBOOK_PICK_NAME,
});

function isTold(
  decisionEntry: AutoRemediationDecisionEntry,
  fixes: Array<RemediationDecisionFix>,
): boolean {
  return isRemediationDecisionEntryToldByFixes(decisionEntry, fixes);
}

describe("a cluster's or a resource's round", () => {
  const started: AutoRemediationDecisionEntry = entry(
    AutoRemediationDecisionReason.ClusterRoundStarted,
    {
      lane: AutoRemediationDecisionLane.KubernetesCluster,
      kubernetesClusterId: CLUSTER_ID,
      kubernetesClusterName: "oneuptime-test",
    },
  );

  test("the line that says it started is the round's fix", () => {
    expect(isTold(started, [CLUSTER_ROUND])).toBe(true);
    expect(
      isTold(
        entry(AutoRemediationDecisionReason.ClusterAlreadyHasRound, {
          lane: AutoRemediationDecisionLane.KubernetesCluster,
          kubernetesClusterId: CLUSTER_ID,
        }),
        [CLUSTER_ROUND],
      ),
    ).toBe(true);
  });

  test("a round whose cluster was deleted since is matched by its name", () => {
    expect(isTold(started, [DELETED_CLUSTER_ROUND])).toBe(true);
    expect(
      isTold(
        entry(AutoRemediationDecisionReason.ClusterRoundStarted, {
          lane: AutoRemediationDecisionLane.KubernetesCluster,
          kubernetesClusterId: OTHER_CLUSTER_ID,
          kubernetesClusterName: "another-cluster",
        }),
        [DELETED_CLUSTER_ROUND],
      ),
    ).toBe(false);
  });

  test("another cluster's round, or no round, tells nothing", () => {
    expect(
      isTold(
        entry(AutoRemediationDecisionReason.ClusterRoundStarted, {
          lane: AutoRemediationDecisionLane.KubernetesCluster,
          kubernetesClusterId: OTHER_CLUSTER_ID,
        }),
        [CLUSTER_ROUND],
      ),
    ).toBe(false);
    expect(isTold(started, [])).toBe(false);
    expect(isTold(started, [RULE_RUNBOOK, PROJECT_PICK, RESOURCE_ROUND])).toBe(
      false,
    );
  });

  test("a resource's round is matched by its resource", () => {
    const resourceStarted: AutoRemediationDecisionEntry = entry(
      AutoRemediationDecisionReason.ResourceRoundStarted,
      { lane: AutoRemediationDecisionLane.Resource, resourceId: RESOURCE_ID },
    );

    expect(isTold(resourceStarted, [RESOURCE_ROUND])).toBe(true);
    expect(
      isTold(
        entry(AutoRemediationDecisionReason.ResourceRoundStarted, {
          lane: AutoRemediationDecisionLane.Resource,
          resourceId: OTHER_RESOURCE_ID,
        }),
        [RESOURCE_ROUND],
      ),
    ).toBe(false);
    expect(isTold(resourceStarted, [CLUSTER_ROUND])).toBe(false);
  });

  test("the rule that matched is named under a round", () => {
    for (const reason of [
      AutoRemediationDecisionReason.RuleMatchedAiFix,
      AutoRemediationDecisionReason.RuleMatchedAiFixAsks,
    ]) {
      const matched: AutoRemediationDecisionEntry = entry(reason, {
        ruleName: "All alerts",
      });

      expect(isTold(matched, [CLUSTER_ROUND])).toBe(true);
      expect(isTold(matched, [RESOURCE_ROUND])).toBe(true);
      expect(isTold(matched, [DELETED_CLUSTER_ROUND])).toBe(true);
      // No round to name it under: the line says it.
      expect(isTold(matched, [RULE_RUNBOOK, PROJECT_PICK])).toBe(false);
      expect(isTold(matched, [])).toBe(false);
    }
  });
});

describe("a rule's own fix", () => {
  test("the rule's runbook pick, by the rule's id or its name", () => {
    expect(
      isTold(
        entry(AutoRemediationDecisionReason.RuleAiPickingRunbook, {
          ruleId: RULE_ID,
          ruleName: "Renamed since",
        }),
        [RULE_RUNBOOK],
      ),
    ).toBe(true);
    expect(
      isTold(
        entry(AutoRemediationDecisionReason.RuleAiPickingRunbook, {
          ruleName: "All alerts",
        }),
        [RULE_RUNBOOK],
      ),
    ).toBe(true);
    expect(
      isTold(
        entry(AutoRemediationDecisionReason.RuleAiPickingRunbook, {
          ruleId: OTHER_RULE_ID,
          ruleName: "All alerts",
        }),
        [RULE_RUNBOOK],
      ),
    ).toBe(false);
    // The rule composed commands, not a runbook pick: not this line.
    expect(
      isTold(
        entry(AutoRemediationDecisionReason.RuleAiPickingRunbook, {
          ruleId: RULE_ID,
        }),
        [RULE_PLAN],
      ),
    ).toBe(false);
  });

  test("the rule's commands, and its fix through MCP servers", () => {
    expect(
      isTold(
        entry(AutoRemediationDecisionReason.RuleAiComposingCommands, {
          ruleId: RULE_ID,
        }),
        [RULE_PLAN],
      ),
    ).toBe(true);
    expect(
      isTold(
        entry(AutoRemediationDecisionReason.RuleAiComposingCommands, {
          ruleId: RULE_ID,
        }),
        [RULE_MCP, RULE_RUNBOOK],
      ),
    ).toBe(false);
    expect(
      isTold(
        entry(AutoRemediationDecisionReason.RuleAiFixingThroughMcpServers, {
          ruleId: RULE_ID,
        }),
        [RULE_MCP],
      ),
    ).toBe(true);
    expect(
      isTold(
        entry(AutoRemediationDecisionReason.RuleAiFixingThroughMcpServers, {
          ruleId: RULE_ID,
        }),
        [RULE_PLAN],
      ),
    ).toBe(false);
  });

  test("the runbook a rule proposed or started, by its id or its name", () => {
    for (const reason of [
      AutoRemediationDecisionReason.RuleRunbookProposed,
      AutoRemediationDecisionReason.RuleRunbookStarted,
    ]) {
      expect(
        isTold(
          entry(reason, {
            ruleId: RULE_ID,
            runbookId: RUNBOOK_ID,
            runbookName: "Renamed since",
          }),
          [RULE_RUNBOOK],
        ),
      ).toBe(true);
      expect(
        isTold(
          entry(reason, {
            ruleName: "All alerts",
            runbookName: "Restart checkout",
          }),
          [RULE_RUNBOOK],
        ),
      ).toBe(true);
      expect(
        isTold(
          entry(reason, {
            ruleId: RULE_ID,
            runbookId: OTHER_RUNBOOK_ID,
            runbookName: "Restart checkout",
          }),
          [RULE_RUNBOOK],
        ),
      ).toBe(false);
      expect(
        isTold(
          entry(reason, { ruleName: "All alerts", runbookName: "Scale out" }),
          [RULE_RUNBOOK],
        ),
      ).toBe(false);
      // A line that names no runbook is never matched by a name it lacks.
      expect(
        isTold(entry(reason, { ruleName: "All alerts" }), [RULE_RUNBOOK]),
      ).toBe(false);
    }
  });

  test("a rule's fix already proposed is the fix on the step", () => {
    expect(
      isTold(
        entry(AutoRemediationDecisionReason.RuleAlreadyProposed, {
          ruleId: RULE_ID,
        }),
        [RULE_PLAN],
      ),
    ).toBe(true);
    expect(
      isTold(
        entry(AutoRemediationDecisionReason.RuleAlreadyProposed, {
          ruleId: OTHER_RULE_ID,
        }),
        [RULE_PLAN],
      ),
    ).toBe(false);
  });

  test("a rule's name is never matched to a round or to the project's pick", () => {
    const named: AutoRemediationDecisionEntry = entry(
      AutoRemediationDecisionReason.RuleAiPickingRunbook,
      { ruleName: DEFAULT_RUNBOOK_PICK_NAME },
    );

    expect(isTold(named, [PROJECT_PICK])).toBe(false);
    expect(
      isTold(
        entry(AutoRemediationDecisionReason.RuleAlreadyProposed, {
          ruleName: getClusterRoundNameSnapshot("oneuptime-test", 1),
        }),
        [DELETED_CLUSTER_ROUND],
      ),
    ).toBe(false);
  });
});

describe("the project's own fix, with no rule", () => {
  test("its runbook pick and its fix through MCP servers", () => {
    expect(
      isTold(entry(AutoRemediationDecisionReason.AiPickingRunbook), [
        PROJECT_PICK,
      ]),
    ).toBe(true);
    expect(
      isTold(entry(AutoRemediationDecisionReason.AiPickingRunbook), [
        PROJECT_MCP,
        RULE_RUNBOOK,
      ]),
    ).toBe(false);
    expect(
      isTold(entry(AutoRemediationDecisionReason.AiFixingThroughMcpServers), [
        PROJECT_MCP,
      ]),
    ).toBe(true);
    expect(
      isTold(entry(AutoRemediationDecisionReason.AiFixingThroughMcpServers), [
        PROJECT_PICK,
        RULE_MCP,
      ]),
    ).toBe(false);
  });
});

describe("what no fix says stays", () => {
  test.each([
    AutoRemediationDecisionReason.RuleRunbookProposedByCircuitBreaker,
    AutoRemediationDecisionReason.RuleRunbookNotStarted,
    AutoRemediationDecisionReason.SuggestionLimitReached,
    AutoRemediationDecisionReason.NoRulesConfigured,
    AutoRemediationDecisionReason.ClusterNoneLinked,
    AutoRemediationDecisionReason.ResourceNoneLinked,
    AutoRemediationDecisionReason.ClusterRoundNotStarted,
    AutoRemediationDecisionReason.EnableAiOff,
    AutoRemediationDecisionReason.RemediationOff,
  ])("%s", (reason: AutoRemediationDecisionReason) => {
    expect(
      isTold(
        entry(reason, {
          ruleId: RULE_ID,
          ruleName: "All alerts",
          runbookId: RUNBOOK_ID,
          runbookName: "Restart checkout",
          kubernetesClusterId: CLUSTER_ID,
          kubernetesClusterName: "oneuptime-test",
          resourceId: RESOURCE_ID,
        }),
        [
          CLUSTER_ROUND,
          DELETED_CLUSTER_ROUND,
          RESOURCE_ROUND,
          RULE_RUNBOOK,
          RULE_PLAN,
          RULE_MCP,
          PROJECT_PICK,
          PROJECT_MCP,
        ],
      ),
    ).toBe(false);
  });
});

describe("the lines of the issue's screenshot", () => {
  // The alert of the screenshot: a cluster's round and the rule's runbook pick.
  const ENTRIES: Array<AutoRemediationDecisionEntry> = [
    entry(AutoRemediationDecisionReason.ClusterRoundStarted, {
      lane: AutoRemediationDecisionLane.KubernetesCluster,
      kubernetesClusterId: CLUSTER_ID,
      kubernetesClusterName: "oneuptime-test",
      remediationMode: "BypassApproval",
    }),
    entry(AutoRemediationDecisionReason.RuleMatchedAiFix, {
      ruleId: RULE_ID,
      ruleName: "All alerts",
    }),
    entry(AutoRemediationDecisionReason.RuleAiPickingRunbook, {
      ruleId: RULE_ID,
      ruleName: "All alerts",
    }),
  ];

  function linesFor(
    fixes?: Array<RemediationDecisionFix>,
  ): Array<RemediationDecisionLine> {
    return getRemediationDecisionLines({
      decision: {
        stage: AutoRemediationDecisionStage.Evaluated,
        entries: ENTRIES,
      },
      signal: "alert",
      translator: ENGLISH,
      ...(fixes ? { fixes } : {}),
    });
  }

  const RULE_PICK_THAT_FOUND_NONE: RemediationDecisionFix = fix({
    suggestionType: AutoRemediationSuggestionType.Runbook,
    autoRemediationRuleId: new ObjectID(RULE_ID),
    ruleNameSnapshot: "All alerts",
  });

  test("every line is marked once its fixes are on the step", () => {
    const lines: Array<RemediationDecisionLine> = linesFor([
      CLUSTER_ROUND,
      RULE_PICK_THAT_FOUND_NONE,
    ]);

    expect(lines).toHaveLength(3);
    expect(
      lines.map((line: RemediationDecisionLine) => {
        return Boolean(line.isToldByFix);
      }),
    ).toEqual([true, true, true]);
  });

  test("the same lines, with no fix to tell them, are as they were", () => {
    const lines: Array<RemediationDecisionLine> = linesFor();

    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).not.toHaveProperty("isToldByFix");
    }
    expect(
      lines.map((line: RemediationDecisionLine) => {
        return line.text;
      }),
    ).toEqual(
      linesFor([]).map((line: RemediationDecisionLine) => {
        return line.text;
      }),
    );
  });

  test("a fix not on the step yet leaves its line drawn", () => {
    const lines: Array<RemediationDecisionLine> = linesFor([CLUSTER_ROUND]);

    expect(
      lines.map((line: RemediationDecisionLine) => {
        return Boolean(line.isToldByFix);
      }),
    ).toEqual([true, true, false]);
    expect(lines[2]!.text).toContain('Rule "All alerts"');
  });
});
