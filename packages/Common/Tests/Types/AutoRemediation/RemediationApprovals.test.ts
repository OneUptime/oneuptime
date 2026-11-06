import { describe, expect, test } from "@jest/globals";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPolicyVerdict,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  ALREADY_APPROVED_FIRST_MESSAGE,
  APPROVALS_FOR_A_RISKIER_FIX,
  getRemediationApprovalsNeeded,
  getRiskierRemediationCommands,
  isRiskierRemediationCommand,
  isSameApprover,
} from "../../../Types/AutoRemediation/RemediationApprovals";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";

/*
 * TWO PEOPLE APPROVE A RISKIER FIX (#6148's follow-up): the rule as the
 * server and the Dashboard share it (Types/AutoRemediation/
 * RemediationApprovals).
 *
 *  - a riskier change is what the policies tier RiskyWrite, on a cluster or
 *    a resource; a safe change, a read, a Runner's Bash command and an SSH
 *    command from before credentials were removed are not;
 *  - two approvals are needed exactly where the project asks for them and
 *    the fix is a command plan holding a riskier change - never for a
 *    runbook or a fix through MCP servers;
 *  - "the same person" is the same id, whatever its case;
 *  - why a first approver's second press does nothing, in one sentence.
 */

function command(
  overrides: Partial<AiRemediationCommand> = {},
): AiRemediationCommand {
  return {
    sequence: 1,
    stepType: RunbookStepType.Kubectl,
    runnerId: "0193c0de-1111-4aaa-8bbb-0000000000d1",
    runnerNameSnapshot: "Kubernetes AI agent",
    kubernetesClusterId: "0193c0de-2222-4aaa-8bbb-0000000000d2",
    kubernetesClusterNameSnapshot: "prod-eu-west-1",
    kubectlTier: KubectlCommandTier.SafeWrite,
    command: "kubectl rollout restart deployment/web -n web",
    timeoutInMs: 60000,
    rationale: "stale config",
    expectedEffect: "fresh pods",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...overrides,
  };
}

function resourceCommand(
  tier: ResourceCommandTier | undefined,
): AiRemediationCommand {
  return command({
    stepType: RunbookStepType.ResourceCommand,
    kubernetesClusterId: undefined,
    kubernetesClusterNameSnapshot: undefined,
    kubectlTier: undefined,
    resourceType: AiResourceType.AwsAccount,
    resourceId: "0193c0de-3333-4aaa-8bbb-0000000000d3",
    resourceNameSnapshot: "prod",
    resourceCommandTier: tier,
    command:
      "cloud stop-instance arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0",
  });
}

describe("what a riskier change is", () => {
  test("a kubectl command tiered RiskyWrite is one; SafeWrite, Read and no tier are not", () => {
    expect(
      isRiskierRemediationCommand(
        command({ kubectlTier: KubectlCommandTier.RiskyWrite }),
      ),
    ).toBe(true);

    for (const tier of [
      KubectlCommandTier.SafeWrite,
      KubectlCommandTier.Read,
      undefined,
    ]) {
      expect(isRiskierRemediationCommand(command({ kubectlTier: tier }))).toBe(
        false,
      );
    }
  });

  test("a resource command tiered RiskyWrite is one - a cloud account's included; SafeWrite and no tier are not", () => {
    expect(
      isRiskierRemediationCommand(
        resourceCommand(ResourceCommandTier.RiskyWrite),
      ),
    ).toBe(true);
    expect(
      isRiskierRemediationCommand(
        resourceCommand(ResourceCommandTier.SafeWrite),
      ),
    ).toBe(false);
    expect(isRiskierRemediationCommand(resourceCommand(undefined))).toBe(
      false,
    );
  });

  test("a tier is read for its own kind of step only", () => {
    // A resource tier on a kubectl step, and the other way round, say nothing.
    expect(
      isRiskierRemediationCommand(
        command({
          kubectlTier: KubectlCommandTier.SafeWrite,
          resourceCommandTier: ResourceCommandTier.RiskyWrite,
        }),
      ),
    ).toBe(false);
    expect(
      isRiskierRemediationCommand({
        ...resourceCommand(ResourceCommandTier.SafeWrite),
        kubectlTier: KubectlCommandTier.RiskyWrite,
      }),
    ).toBe(false);
  });

  test("a Runner's Bash command and an SSH command have no tier, and are not one", () => {
    for (const stepType of [RunbookStepType.Bash, RunbookStepType.SSH]) {
      expect(
        isRiskierRemediationCommand(
          command({
            stepType,
            kubectlTier: KubectlCommandTier.RiskyWrite,
            resourceCommandTier: ResourceCommandTier.RiskyWrite,
          }),
        ),
      ).toBe(false);
    }
  });

  test("a plan's riskier commands, in their order", () => {
    const plan: AiRemediationCommandPlan = {
      commands: [
        command({ sequence: 1 }),
        command({
          sequence: 2,
          kubectlTier: KubectlCommandTier.RiskyWrite,
          command: "kubectl scale deployment/web --replicas=0 -n web",
        }),
        { ...resourceCommand(ResourceCommandTier.RiskyWrite), sequence: 3 },
      ],
    };

    expect(
      getRiskierRemediationCommands(plan).map(
        (each: AiRemediationCommand): number => {
          return each.sequence;
        },
      ),
    ).toEqual([2, 3]);
    expect(getRiskierRemediationCommands(null)).toEqual([]);
    expect(getRiskierRemediationCommands(undefined)).toEqual([]);
    expect(
      getRiskierRemediationCommands({ commands: [command()] }),
    ).toHaveLength(0);
  });
});

describe("how many approvals a fix needs", () => {
  test("two where the project asks for two and a command plan holds a riskier change", () => {
    expect(APPROVALS_FOR_A_RISKIER_FIX).toBe(2);
    expect(
      getRemediationApprovalsNeeded({
        isTwoApprovalsRuleOn: true,
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        hasRiskierChange: true,
      }),
    ).toBe(2);
  });

  test("one in every other case: the rule off, safe changes only, a runbook, a fix through MCP servers, no type", () => {
    const cases: Array<{
      isTwoApprovalsRuleOn: boolean;
      suggestionType: AutoRemediationSuggestionType | undefined;
      hasRiskierChange: boolean;
    }> = [
      {
        isTwoApprovalsRuleOn: false,
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        hasRiskierChange: true,
      },
      {
        isTwoApprovalsRuleOn: true,
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        hasRiskierChange: false,
      },
      {
        isTwoApprovalsRuleOn: true,
        suggestionType: AutoRemediationSuggestionType.Runbook,
        hasRiskierChange: true,
      },
      {
        isTwoApprovalsRuleOn: true,
        suggestionType: AutoRemediationSuggestionType.McpToolCalls,
        hasRiskierChange: true,
      },
      {
        isTwoApprovalsRuleOn: true,
        suggestionType: undefined,
        hasRiskierChange: true,
      },
    ];

    for (const each of cases) {
      expect({ ...each, needed: getRemediationApprovalsNeeded(each) }).toEqual(
        { ...each, needed: 1 },
      );
    }
  });
});

describe("the same person", () => {
  test("is the same id, whatever its case or the shape it is in", () => {
    const id: string = "0193c0de-4444-4aaa-8bbb-0000000000d4";

    expect(isSameApprover(id, id.toUpperCase())).toBe(true);
    expect(isSameApprover(new ObjectID(id), id)).toBe(true);
    expect(isSameApprover(` ${id} `, new ObjectID(id))).toBe(true);
  });

  test("two people are never one, and an unknown person is nobody", () => {
    expect(
      isSameApprover(
        "0193c0de-4444-4aaa-8bbb-0000000000d4",
        "0193c0de-5555-4aaa-8bbb-0000000000d5",
      ),
    ).toBe(false);
    expect(isSameApprover(undefined, undefined)).toBe(false);
    expect(isSameApprover(null, "0193c0de-4444-4aaa-8bbb-0000000000d4")).toBe(
      false,
    );
    expect(isSameApprover("", "")).toBe(false);
    expect(isSameApprover("   ", "   ")).toBe(false);
  });
});

describe("why a first approver's second press does nothing", () => {
  test("says they approved, why the fix waits, and what runs it", () => {
    expect(ALREADY_APPROVED_FIRST_MESSAGE).toBe(
      "You already approved this fix. It holds a riskier change, and this project asks two people to approve one, so it runs once someone else approves it too.",
    );
  });
});
