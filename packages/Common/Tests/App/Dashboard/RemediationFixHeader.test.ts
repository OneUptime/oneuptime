import { describe, expect, test } from "@jest/globals";
import {
  getRemediationFixSource,
  getRemediationFixTitle,
  getRemediationRoundRuleName,
  isRemediationRoundFix,
  RemediationFixHeaderSuggestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationFixHeader";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import { DEFAULT_RUNBOOK_PICK_NAME } from "../../../Types/AutoRemediation/AutoRemediationFix";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  getClusterRoundNameSnapshot,
  getResourceRoundNameSnapshot,
} from "../../../Types/AutoRemediation/RemediationRoundName";
import { JSONObject } from "../../../Types/JSON";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A FIX'S NAME AND WHERE IT CAME FROM (issue #6860).
 *
 * The issue's screenshot headed its two fixes "AI kubectl fix" over 'AI
 * remediation for cluster "oneuptime-test"' and "No runbook" over "Rule:
 * All alerts". A fix is now named for what it is and where it works, and
 * the line under it says why OneUptime AI tried it.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const CLUSTER_ID: string = "0193c0de-5555-4aaa-8bbb-000000000025";
const OTHER_CLUSTER_ID: string = "0193c0de-5555-4aaa-8bbb-000000000035";
const RESOURCE_ID: string = "0193c0de-4444-4aaa-8bbb-000000000024";
const RULE_ID: string = "0193c0de-8888-4aaa-8bbb-000000000028";
const AGENT_ID: string = "0193c0de-7777-4aaa-8bbb-000000000027";

function kubectl(
  clusterName?: string,
  clusterId: string = CLUSTER_ID,
): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.Kubectl,
    runnerId: AGENT_ID,
    runnerNameSnapshot: "Kubernetes AI agent",
    kubernetesClusterId: clusterId,
    ...(clusterName ? { kubernetesClusterNameSnapshot: clusterName } : {}),
    kubectlTier: KubectlCommandTier.SafeWrite,
    command: "kubectl rollout restart deployment/web -n web",
    timeoutInMs: 60000,
    rationale: "r",
    expectedEffect: "e",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
  };
}

function resourceCommand(
  resourceType: AiResourceType,
  resourceName?: string,
): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: AGENT_ID,
    runnerNameSnapshot: "Resource AI agent",
    resourceType,
    resourceId: RESOURCE_ID,
    ...(resourceName ? { resourceNameSnapshot: resourceName } : {}),
    resourceCommandTier: "SafeWrite",
    command: "systemctl restart web",
    timeoutInMs: 60000,
    rationale: "r",
    expectedEffect: "e",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
  };
}

function bash(): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.Bash,
    runnerId: AGENT_ID,
    runnerNameSnapshot: "Runner",
    command: "./restart.sh",
    timeoutInMs: 60000,
    rationale: "r",
    expectedEffect: "e",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
  };
}

function suggestion(
  overrides: Partial<Record<string, unknown>>,
): RemediationFixHeaderSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), overrides);
}

function plan(
  commands: Array<JSONObject>,
  overrides: Partial<Record<string, unknown>> = {},
): RemediationFixHeaderSuggestion {
  return suggestion({
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: { commands } as JSONObject,
    ...overrides,
  });
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

function title(
  row: RemediationFixHeaderSuggestion,
  entries?: Array<AutoRemediationDecisionEntry>,
  translator: Translator = ENGLISH,
): string {
  return getRemediationFixTitle({ suggestion: row, translator, entries });
}

function source(
  row: RemediationFixHeaderSuggestion,
  entries?: Array<AutoRemediationDecisionEntry>,
  translator: Translator = ENGLISH,
): string {
  return getRemediationFixSource({ suggestion: row, translator, entries });
}

describe("a fix's name", () => {
  test("a cluster's round is named for its cluster, as its name says it", () => {
    expect(
      title(
        plan([kubectl("other-name")], {
          kubernetesClusterId: new ObjectID(CLUSTER_ID),
          ruleNameSnapshot: getClusterRoundNameSnapshot("oneuptime-test", 1),
        }),
      ),
    ).toBe('Fix on cluster "oneuptime-test"');
  });

  test("a later round says which round it is", () => {
    expect(
      title(
        plan([kubectl("prod")], {
          kubernetesClusterId: new ObjectID(CLUSTER_ID),
          ruleNameSnapshot: getClusterRoundNameSnapshot("prod", 3),
        }),
      ),
    ).toBe('Fix on cluster "prod" (round 3)');
  });

  test("a round whose cluster was deleted since is still the cluster's", () => {
    const row: RemediationFixHeaderSuggestion = plan([kubectl()], {
      ruleNameSnapshot: getClusterRoundNameSnapshot("old-cluster", 2),
    });

    expect(title(row)).toBe('Fix on cluster "old-cluster" (round 2)');
    expect(isRemediationRoundFix(row)).toBe(true);
  });

  test("a round whose name cannot be read is named by its changes' cluster, then by the decision", () => {
    expect(
      title(
        plan([kubectl("prod-east"), kubectl("prod-east")], {
          kubernetesClusterId: new ObjectID(CLUSTER_ID),
          ruleNameSnapshot: "AI remediation for cluster",
        }),
      ),
    ).toBe('Fix on cluster "prod-east"');

    expect(
      title(
        plan([kubectl()], {
          kubernetesClusterId: new ObjectID(CLUSTER_ID),
          ruleNameSnapshot: "AI remediation for cluster",
        }),
        [
          entry(AutoRemediationDecisionReason.ClusterRoundStarted, {
            lane: AutoRemediationDecisionLane.KubernetesCluster,
            kubernetesClusterId: OTHER_CLUSTER_ID,
            kubernetesClusterName: "not-this-one",
          }),
          entry(AutoRemediationDecisionReason.ClusterRoundStarted, {
            lane: AutoRemediationDecisionLane.KubernetesCluster,
            kubernetesClusterId: CLUSTER_ID,
            kubernetesClusterName: "from-the-decision",
          }),
        ],
      ),
    ).toBe('Fix on cluster "from-the-decision"');
  });

  test("with nothing that names it, a cluster's fix is a Kubernetes cluster's", () => {
    expect(
      title(
        plan([kubectl()], {
          kubernetesClusterId: new ObjectID(CLUSTER_ID),
        }),
      ),
    ).toBe("Fix on a Kubernetes cluster");
  });

  test("a rule's plan on two clusters names neither", () => {
    expect(
      title(
        plan([kubectl("east"), kubectl("west", OTHER_CLUSTER_ID)], {
          autoRemediationRuleId: new ObjectID(RULE_ID),
          ruleNameSnapshot: "Fix pods",
        }),
      ),
    ).toBe("Fix on a Kubernetes cluster");
  });

  test("a rule's plan on one cluster names it", () => {
    expect(
      title(
        plan([kubectl("east")], {
          autoRemediationRuleId: new ObjectID(RULE_ID),
          ruleNameSnapshot: "Fix pods",
        }),
      ),
    ).toBe('Fix on cluster "east"');
  });

  test("a rule named like a cluster's round names no cluster while it has its rule", () => {
    expect(
      title(
        plan([bash()], {
          autoRemediationRuleId: new ObjectID(RULE_ID),
          ruleNameSnapshot: getClusterRoundNameSnapshot("prod", 1),
        }),
      ),
    ).toBe("Fix with commands");
  });

  test("a resource's round names its kind and its name, and which round", () => {
    expect(
      title(
        plan([resourceCommand(AiResourceType.DockerHost, "web-1")], {
          resourceId: new ObjectID(RESOURCE_ID),
          resourceType: AiResourceType.DockerHost,
          ruleNameSnapshot: getResourceRoundNameSnapshot(
            AiResourceType.DockerHost,
            "web-1",
            1,
          ),
        }),
      ),
    ).toBe('Fix on Docker host "web-1"');

    expect(
      title(
        plan([resourceCommand(AiResourceType.AwsAccount, "prod")], {
          resourceId: new ObjectID(RESOURCE_ID),
          resourceType: AiResourceType.AwsAccount,
          ruleNameSnapshot: getResourceRoundNameSnapshot(
            AiResourceType.AwsAccount,
            "prod",
            2,
          ),
        }),
      ),
    ).toBe('Fix on AWS account "prod" (round 2)');
  });

  test("a resource's round whose name cannot be read is named by its changes, then by the decision", () => {
    expect(
      title(
        plan([resourceCommand(AiResourceType.Host, "web-2")], {
          resourceId: new ObjectID(RESOURCE_ID),
          resourceType: AiResourceType.Host,
          ruleNameSnapshot: "AI remediation",
        }),
      ),
    ).toBe('Fix on host "web-2"');

    expect(
      title(
        plan([resourceCommand(AiResourceType.Host)], {
          resourceId: new ObjectID(RESOURCE_ID),
          ruleNameSnapshot: "AI remediation",
        }),
        [
          entry(AutoRemediationDecisionReason.ResourceRoundStarted, {
            lane: AutoRemediationDecisionLane.Resource,
            resourceId: RESOURCE_ID,
            resourceName: "db-1",
            resourceType: AiResourceType.DatabaseServer,
          }),
        ],
      ),
    ).toBe('Fix on host "db-1"');
  });

  test("with nothing that names it, a resource's fix is on your infrastructure", () => {
    expect(
      title(
        plan([resourceCommand(AiResourceType.Host)], {
          resourceId: new ObjectID(RESOURCE_ID),
        }),
      ),
    ).toBe("Fix on your infrastructure");
  });

  test("commands of its own, through MCP servers, or a runbook", () => {
    expect(title(plan([bash()]))).toBe("Fix with commands");
    expect(title(plan([]))).toBe("Fix with commands");
    expect(
      title(
        suggestion({
          suggestionType: AutoRemediationSuggestionType.McpToolCalls,
          kubernetesClusterId: new ObjectID(CLUSTER_ID),
        }),
      ),
    ).toBe("Fix through MCP servers");
    expect(
      title(
        suggestion({
          suggestionType: AutoRemediationSuggestionType.Runbook,
          runbookNameSnapshot: "Restart checkout",
        }),
      ),
    ).toBe('Runbook "Restart checkout"');
    // A runbook pick that found none, or one with no type yet, is a runbook.
    expect(title(suggestion({}))).toBe("Runbook");
  });

  test("never the engine's words for it", () => {
    const rows: Array<RemediationFixHeaderSuggestion> = [
      plan([kubectl("a")], {
        kubernetesClusterId: new ObjectID(CLUSTER_ID),
        ruleNameSnapshot: getClusterRoundNameSnapshot("a", 1),
      }),
      plan([resourceCommand(AiResourceType.CephCluster, "c")], {
        resourceId: new ObjectID(RESOURCE_ID),
        resourceType: AiResourceType.CephCluster,
      }),
      plan([bash()]),
      suggestion({
        suggestionType: AutoRemediationSuggestionType.McpToolCalls,
      }),
      suggestion({ suggestionType: AutoRemediationSuggestionType.Runbook }),
    ];

    for (const row of rows) {
      expect(title(row)).not.toMatch(/\bAI\b|kubectl|remediation|No runbook/i);
    }
  });
});

describe("where a fix came from", () => {
  test("the project's own runbook pick is OneUptime AI's", () => {
    expect(
      source(
        suggestion({
          suggestionType: AutoRemediationSuggestionType.Runbook,
          ruleNameSnapshot: DEFAULT_RUNBOOK_PICK_NAME,
        }),
      ),
    ).toBe("From OneUptime AI");
  });

  test("a rule's fix names its rule, even once the rule is deleted", () => {
    expect(
      source(
        suggestion({
          autoRemediationRuleId: new ObjectID(RULE_ID),
          ruleNameSnapshot: "All alerts",
        }),
      ),
    ).toBe('From AI rule "All alerts"');
    expect(source(suggestion({ ruleNameSnapshot: "All alerts" }))).toBe(
      'From AI rule "All alerts"',
    );
    expect(source(suggestion({}))).toBe('From AI rule "Unknown"');
  });

  test("a round is from the rule its decision names, else from OneUptime AI", () => {
    const round: RemediationFixHeaderSuggestion = plan([kubectl("prod")], {
      kubernetesClusterId: new ObjectID(CLUSTER_ID),
      ruleNameSnapshot: getClusterRoundNameSnapshot("prod", 1),
    });

    expect(source(round)).toBe("From OneUptime AI");
    expect(source(round, [])).toBe("From OneUptime AI");
    expect(
      source(round, [
        entry(AutoRemediationDecisionReason.ClusterRoundStarted, {
          lane: AutoRemediationDecisionLane.KubernetesCluster,
          kubernetesClusterId: CLUSTER_ID,
        }),
        entry(AutoRemediationDecisionReason.RuleMatchedAiFix, {
          ruleName: "All alerts",
        }),
      ]),
    ).toBe('From AI rule "All alerts"');
  });

  test("the round's own name is never read as a rule's", () => {
    expect(
      source(
        plan([kubectl("prod")], {
          ruleNameSnapshot: getClusterRoundNameSnapshot("prod", 1),
        }),
      ),
    ).not.toContain("AI remediation");
  });
});

describe("the rule a round came from", () => {
  const cluster: RemediationFixHeaderSuggestion = plan([kubectl("prod")], {
    kubernetesClusterId: new ObjectID(CLUSTER_ID),
  });
  const resource: RemediationFixHeaderSuggestion = plan(
    [resourceCommand(AiResourceType.Host, "web")],
    { resourceId: new ObjectID(RESOURCE_ID) },
  );

  test("the rule that asked for the round on this cluster comes first", () => {
    expect(
      getRemediationRoundRuleName({
        suggestion: cluster,
        entries: [
          entry(AutoRemediationDecisionReason.RuleMatchedAiFix, {
            ruleName: "Matched first",
          }),
          entry(AutoRemediationDecisionReason.ClusterRoundStarted, {
            lane: AutoRemediationDecisionLane.KubernetesCluster,
            kubernetesClusterId: OTHER_CLUSTER_ID,
            ruleName: "Another cluster's",
          }),
          entry(AutoRemediationDecisionReason.ClusterRoundStarted, {
            lane: AutoRemediationDecisionLane.KubernetesCluster,
            kubernetesClusterId: CLUSTER_ID,
            ruleName: "Asked first",
          }),
        ],
      }),
    ).toBe("Asked first");
  });

  test("the rule that asked for the round on this resource comes first", () => {
    expect(
      getRemediationRoundRuleName({
        suggestion: resource,
        entries: [
          entry(AutoRemediationDecisionReason.RuleMatchedAiFixAsks, {
            ruleName: "Matched first",
          }),
          entry(AutoRemediationDecisionReason.ResourceRoundStarted, {
            lane: AutoRemediationDecisionLane.Resource,
            resourceId: RESOURCE_ID,
            ruleName: "Asked first",
          }),
        ],
      }),
    ).toBe("Asked first");
  });

  test("else the first AI rule that matched and fixes", () => {
    expect(
      getRemediationRoundRuleName({
        suggestion: cluster,
        entries: [
          entry(AutoRemediationDecisionReason.RuleAlreadyProposed, {
            ruleName: "Not a match",
          }),
          entry(AutoRemediationDecisionReason.RuleMatchedAiFixAsks, {
            ruleName: "Asks",
          }),
          entry(AutoRemediationDecisionReason.RuleMatchedAiFix, {
            ruleName: "Later",
          }),
        ],
      }),
    ).toBe("Asks");
  });

  test("none when no rule matched", () => {
    expect(
      getRemediationRoundRuleName({
        suggestion: cluster,
        entries: [
          entry(AutoRemediationDecisionReason.NoRulesConfigured),
          entry(AutoRemediationDecisionReason.ClusterRoundStarted, {
            lane: AutoRemediationDecisionLane.KubernetesCluster,
            kubernetesClusterId: CLUSTER_ID,
          }),
        ],
      }),
    ).toBe("");
  });
});

describe("which fixes are rounds", () => {
  test("one with a cluster or a resource, or a deleted cluster's name and no rule", () => {
    expect(
      isRemediationRoundFix({ kubernetesClusterId: new ObjectID(CLUSTER_ID) }),
    ).toBe(true);
    expect(
      isRemediationRoundFix({ resourceId: new ObjectID(RESOURCE_ID) }),
    ).toBe(true);
    expect(
      isRemediationRoundFix({
        ruleNameSnapshot: getClusterRoundNameSnapshot("gone", 1),
      }),
    ).toBe(true);
  });

  test("never a rule's fix, whatever it is named", () => {
    expect(
      isRemediationRoundFix({
        autoRemediationRuleId: new ObjectID(RULE_ID),
        ruleNameSnapshot: getClusterRoundNameSnapshot("prod", 1),
      }),
    ).toBe(false);
    expect(isRemediationRoundFix({ ruleNameSnapshot: "All alerts" })).toBe(
      false,
    );
    expect(isRemediationRoundFix({})).toBe(false);
  });
});

describe("in the reader's language", () => {
  test("Persian sets an English name apart, and writes the round its own way", () => {
    const persian: Translator = dashboardTranslator("fa");
    const said: string = title(
      plan([kubectl("prod")], {
        kubernetesClusterId: new ObjectID(CLUSTER_ID),
        ruleNameSnapshot: getClusterRoundNameSnapshot("prod", 2),
      }),
      [],
      persian,
    );

    expect(said).toContain(isolated("prod"));
    expect(withoutIsolateMarks(said)).toBe("اصلاح روی خوشه «prod» (دور ۲)");
    expect(
      withoutIsolateMarks(
        source(
          suggestion({
            autoRemediationRuleId: new ObjectID(RULE_ID),
            ruleNameSnapshot: "All alerts",
          }),
          [],
          persian,
        ),
      ),
    ).toBe("از قاعده هوش مصنوعی «All alerts»");
  });

  test("German words the kind of resource with the sentence", () => {
    const german: Translator = dashboardTranslator("de");

    expect(
      title(
        plan([resourceCommand(AiResourceType.DockerHost, "web-1")], {
          resourceId: new ObjectID(RESOURCE_ID),
          resourceType: AiResourceType.DockerHost,
        }),
        [],
        german,
      ),
    ).toBe(
      `Korrektur auf ${german.translateTerm("Docker host", { inSentence: true })} „web-1“`,
    );
    expect(
      title(
        suggestion({
          suggestionType: AutoRemediationSuggestionType.McpToolCalls,
        }),
        [],
        german,
      ),
    ).toBe("Korrektur über MCP-Server");
    expect(
      source(
        suggestion({ ruleNameSnapshot: DEFAULT_RUNBOOK_PICK_NAME }),
        [],
        german,
      ),
    ).toBe("Von OneUptime AI");
  });
});
