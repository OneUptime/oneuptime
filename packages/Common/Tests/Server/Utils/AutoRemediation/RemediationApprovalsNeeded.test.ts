import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Project from "../../../../Models/DatabaseModels/Project";
import ProjectService from "../../../../Server/Services/ProjectService";
import {
  getFixApprovalsNeeded,
  hasRiskierChangeNow,
  isRiskierChangeNow,
  readTwoApprovalsRule,
} from "../../../../Server/Utils/AutoRemediation/RemediationApprovalsNeeded";
import {
  AiRemediationCommand,
  AiRemediationCommandPolicyVerdict,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import { KubectlCommandTier } from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import KubectlPolicy from "../../../../Utils/AiRemediation/KubectlPolicy";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";

/*
 * HOW MANY PEOPLE APPROVE A FIX, ON THE SERVER (RemediationApprovalsNeeded,
 * #6148's follow-up).
 *
 * A command counts as a riskier change when its stored tier says so, or
 * when the policies tier it RiskyWrite now - so a plan whose stored tier is
 * out of date never runs on one approval where the project asks for two.
 * The project's rule is read as a best-effort fact for what the chats say;
 * a read that fails reads as unknown, never as on or off.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9a000000-0000-4000-8000-000000000001",
);

const STOP_INSTANCE: string =
  "cloud stop-instance arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0";
const SCALE_OUT: string =
  "cloud scale-out arn:aws:ecs:us-east-1:123456789012:service/prod/web --count 8";
const KUBECTL_RESTART: string = "kubectl rollout restart deployment/web -n web";
const KUBECTL_SCALE_TO_ZERO: string =
  "kubectl scale deployment/web --replicas=0 -n web";

function kubectl(
  commandText: string,
  tier: KubectlCommandTier | undefined,
): AiRemediationCommand {
  return {
    sequence: 1,
    stepType: RunbookStepType.Kubectl,
    runnerId: "9a000000-0000-4000-8000-000000000002",
    runnerNameSnapshot: "Kubernetes AI agent",
    kubernetesClusterId: "9a000000-0000-4000-8000-000000000003",
    kubernetesClusterNameSnapshot: "prod-eu-west-1",
    kubectlTier: tier,
    command: commandText,
    timeoutInMs: 60000,
    rationale: "r",
    expectedEffect: "e",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
  };
}

function cloud(
  commandText: string,
  tier: ResourceCommandTier | undefined,
): AiRemediationCommand {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: "9a000000-0000-4000-8000-000000000004",
    runnerNameSnapshot: "Cloud AI agent",
    resourceType: AiResourceType.AwsAccount,
    resourceId: "9a000000-0000-4000-8000-000000000005",
    resourceNameSnapshot: "prod",
    resourceCommandTier: tier,
    command: commandText,
    timeoutInMs: 60000,
    rationale: "r",
    expectedEffect: "e",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the commands this suite tiers, as the policies tier them", () => {
  test("stopping an instance and scaling a deployment to zero are riskier; scaling out and a rollout restart are safe", () => {
    expect(
      ResourceCommandPolicy.evaluateCommand({
        resourceType: AiResourceType.AwsAccount,
        command: STOP_INSTANCE,
      }).tier,
    ).toBe(ResourceCommandTier.RiskyWrite);
    expect(
      ResourceCommandPolicy.evaluateCommand({
        resourceType: AiResourceType.AwsAccount,
        command: SCALE_OUT,
      }).tier,
    ).toBe(ResourceCommandTier.SafeWrite);
    expect(KubectlPolicy.evaluateCommand(KUBECTL_SCALE_TO_ZERO).tier).toBe(
      KubectlCommandTier.RiskyWrite,
    );
    expect(KubectlPolicy.evaluateCommand(KUBECTL_RESTART).tier).toBe(
      KubectlCommandTier.SafeWrite,
    );
  });
});

describe("isRiskierChangeNow", () => {
  test("a stored RiskyWrite tier counts, whatever the command", () => {
    expect(
      isRiskierChangeNow(kubectl(KUBECTL_RESTART, KubectlCommandTier.RiskyWrite)),
    ).toBe(true);
    expect(
      isRiskierChangeNow(cloud(SCALE_OUT, ResourceCommandTier.RiskyWrite)),
    ).toBe(true);
  });

  test("a command the policies tier riskier now counts, whatever its stored tier says", () => {
    expect(
      isRiskierChangeNow(
        kubectl(KUBECTL_SCALE_TO_ZERO, KubectlCommandTier.SafeWrite),
      ),
    ).toBe(true);
    expect(isRiskierChangeNow(kubectl(KUBECTL_SCALE_TO_ZERO, undefined))).toBe(
      true,
    );
    expect(
      isRiskierChangeNow(cloud(STOP_INSTANCE, ResourceCommandTier.SafeWrite)),
    ).toBe(true);
    expect(isRiskierChangeNow(cloud(STOP_INSTANCE, undefined))).toBe(true);
  });

  test("a safe change stored and tiered safe now is not one", () => {
    expect(
      isRiskierChangeNow(kubectl(KUBECTL_RESTART, KubectlCommandTier.SafeWrite)),
    ).toBe(false);
    expect(
      isRiskierChangeNow(cloud(SCALE_OUT, ResourceCommandTier.SafeWrite)),
    ).toBe(false);
  });

  test("a Runner's Bash command is never one, and a resource of no known type is not asked about", () => {
    expect(
      isRiskierChangeNow({
        ...kubectl("systemctl stop nginx", undefined),
        stepType: RunbookStepType.Bash,
        kubernetesClusterId: undefined,
      }),
    ).toBe(false);
    expect(
      isRiskierChangeNow({
        ...cloud(STOP_INSTANCE, undefined),
        resourceType: "NotAResource" as AiResourceType,
      }),
    ).toBe(false);
  });

  test("a plan holds one when any of its commands is one", () => {
    expect(
      hasRiskierChangeNow({
        commands: [
          kubectl(KUBECTL_RESTART, KubectlCommandTier.SafeWrite),
          {
            ...cloud(STOP_INSTANCE, ResourceCommandTier.RiskyWrite),
            sequence: 2,
          },
        ],
      }),
    ).toBe(true);
    expect(
      hasRiskierChangeNow({
        commands: [kubectl(KUBECTL_RESTART, KubectlCommandTier.SafeWrite)],
      }),
    ).toBe(false);
    expect(hasRiskierChangeNow(null)).toBe(false);
    expect(hasRiskierChangeNow(undefined)).toBe(false);
  });
});

describe("getFixApprovalsNeeded", () => {
  const riskier: { commands: Array<AiRemediationCommand> } = {
    commands: [cloud(STOP_INSTANCE, ResourceCommandTier.RiskyWrite)],
  };
  const safe: { commands: Array<AiRemediationCommand> } = {
    commands: [cloud(SCALE_OUT, ResourceCommandTier.SafeWrite)],
  };

  test("two for a riskier command plan where the project asks for two", () => {
    expect(
      getFixApprovalsNeeded({
        project: { requireTwoApprovalsForRiskierFixes: true },
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        plan: riskier,
      }),
    ).toBe(2);
  });

  test("one with the rule off, unread, or for safe changes, a runbook or MCP changes", () => {
    expect(
      getFixApprovalsNeeded({
        project: { requireTwoApprovalsForRiskierFixes: false },
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        plan: riskier,
      }),
    ).toBe(1);
    expect(
      getFixApprovalsNeeded({
        project: {},
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        plan: riskier,
      }),
    ).toBe(1);
    expect(
      getFixApprovalsNeeded({
        project: null,
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        plan: riskier,
      }),
    ).toBe(1);
    expect(
      getFixApprovalsNeeded({
        project: { requireTwoApprovalsForRiskierFixes: true },
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        plan: safe,
      }),
    ).toBe(1);

    for (const suggestionType of [
      AutoRemediationSuggestionType.Runbook,
      AutoRemediationSuggestionType.McpToolCalls,
    ]) {
      expect(
        getFixApprovalsNeeded({
          project: { requireTwoApprovalsForRiskierFixes: true },
          suggestionType,
          plan: riskier,
        }),
      ).toBe(1);
    }
  });
});

describe("readTwoApprovalsRule", () => {
  test("reads the project's rule as OneUptime, the column alone", async () => {
    const find: jest.SpiedFunction<typeof ProjectService.findOneById> = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({
        requireTwoApprovalsForRiskierFixes: true,
      } as unknown as Project);

    expect(await readTwoApprovalsRule(PROJECT_ID)).toBe(true);

    const args: Record<string, unknown> = find.mock.calls[0]![0] as never;
    expect(String(args["id"])).toBe(PROJECT_ID.toString());
    expect(args["select"]).toEqual({
      _id: true,
      requireTwoApprovalsForRiskierFixes: true,
    });
    expect(args["props"]).toEqual({ isRoot: true });
  });

  test("off is off, and a column a row does not hold reads as off", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      requireTwoApprovalsForRiskierFixes: false,
    } as unknown as Project);
    expect(await readTwoApprovalsRule(PROJECT_ID)).toBe(false);

    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({} as unknown as Project);
    expect(await readTwoApprovalsRule(PROJECT_ID)).toBe(false);
  });

  test("a project that is not there, or a read that fails, is unknown", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null);
    expect(await readTwoApprovalsRule(PROJECT_ID)).toBeNull();

    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("database not connected"));
    expect(await readTwoApprovalsRule(PROJECT_ID)).toBeNull();
  });
});
