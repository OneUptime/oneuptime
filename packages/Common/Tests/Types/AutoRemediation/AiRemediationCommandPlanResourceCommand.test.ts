import {
  AI_COMMAND_STEP_TYPES,
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — ResourceCommand steps in a stored command plan.
 *
 * A ResourceCommand step runs through an infrastructure resource's own AI
 * agent. Mirroring a Kubectl step aimed at the Kubernetes AI agent (whose
 * runnerId is the KubernetesAiAgent row id and runnerNameSnapshot is
 * "Kubernetes AI agent"), its runnerId holds the ResourceAiAgent row id and
 * runnerNameSnapshot the type's agent display name ("Docker AI agent").
 *
 * parse() fails closed: the executor and the verifier act on what it
 * returns, so a ResourceCommand step without a valid resourceType and
 * resourceId, with any credential or cluster field, or with a Denied (or
 * unknown) tier makes the WHOLE plan null. Plans stored before this step
 * type existed must parse exactly as they did.
 */

const AGENT_ID: string = "11111111-1111-4111-8111-111111111111";
const RESOURCE_ID: string = "22222222-2222-4222-8222-222222222222";

function resourceStep(overrides: JSONObject = {}): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: AGENT_ID,
    runnerNameSnapshot: "Docker AI agent",
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    resourceNameSnapshot: "prod-web-1",
    resourceCommandTier: ResourceCommandTier.SafeWrite,
    command: "docker restart web",
    timeoutInMs: 30000,
    rationale: "web is wedged",
    expectedEffect: "web serves again",
    rollbackCommand: "docker start web",
    policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
    ...overrides,
  };
}

function parseOne(step: JSONObject): AiRemediationCommand | null {
  const plan: AiRemediationCommandPlan | null =
    AiRemediationCommandPlanUtil.parse({ commands: [step] });

  return plan ? plan.commands[0] || null : null;
}

describe("AI_COMMAND_STEP_TYPES admits ResourceCommand", () => {
  test("ResourceCommand is an AI command step type", () => {
    expect(AI_COMMAND_STEP_TYPES).toContain(RunbookStepType.ResourceCommand);
  });
});

describe("AiRemediationCommandPlanUtil.parse — ResourceCommand steps", () => {
  test("keeps the resource fields and the agent as the step's target", () => {
    const command: AiRemediationCommand | null = parseOne(resourceStep());

    expect(command).not.toBeNull();
    expect(command?.stepType).toBe(RunbookStepType.ResourceCommand);
    expect(command?.runnerId).toBe(AGENT_ID);
    expect(command?.runnerNameSnapshot).toBe("Docker AI agent");
    expect(command?.resourceType).toBe(AiResourceType.DockerHost);
    expect(command?.resourceId).toBe(RESOURCE_ID);
    expect(command?.resourceNameSnapshot).toBe("prod-web-1");
    expect(command?.resourceCommandTier).toBe(ResourceCommandTier.SafeWrite);
    expect(command?.command).toBe("docker restart web");
    expect(command?.rollbackCommand).toBe("docker start web");
    expect(command?.credentialId).toBeUndefined();
    expect(command?.kubernetesClusterId).toBeUndefined();
  });

  test("survives a toJSON round trip unchanged", () => {
    const plan: AiRemediationCommandPlan | null =
      AiRemediationCommandPlanUtil.parse({ commands: [resourceStep()] });

    expect(plan).not.toBeNull();
    expect(
      AiRemediationCommandPlanUtil.parse(
        AiRemediationCommandPlanUtil.toJSON(plan!),
      ),
    ).toEqual(plan);
  });

  test.each(
    Object.values(AiResourceType).map((type: AiResourceType) => {
      return [type];
    }),
  )("accepts resourceType %s", (type: AiResourceType) => {
    expect(parseOne(resourceStep({ resourceType: type }))?.resourceType).toBe(
      type,
    );
  });

  test.each([
    ResourceCommandTier.Read,
    ResourceCommandTier.SafeWrite,
    ResourceCommandTier.RiskyWrite,
  ])("accepts the %s tier", (tier: ResourceCommandTier) => {
    expect(
      parseOne(resourceStep({ resourceCommandTier: tier }))
        ?.resourceCommandTier,
    ).toBe(tier);
  });

  test("an absent tier is allowed (it is informational; execution re-evaluates)", () => {
    const withoutTier: JSONObject = resourceStep();
    delete withoutTier["resourceCommandTier"];

    const command: AiRemediationCommand | null = parseOne(withoutTier);

    expect(command).not.toBeNull();
    expect(command?.resourceCommandTier).toBeUndefined();
    expect(
      parseOne(resourceStep({ resourceCommandTier: null })),
    ).not.toBeNull();
  });

  test("defaults a missing runnerNameSnapshot to the type's agent name", () => {
    const withoutName: JSONObject = resourceStep({
      resourceType: AiResourceType.CephCluster,
    });
    delete withoutName["runnerNameSnapshot"];

    expect(parseOne(withoutName)?.runnerNameSnapshot).toBe(
      AI_RESOURCE_TYPE_INFO[AiResourceType.CephCluster].agentDisplayName,
    );
  });

  describe("fails closed", () => {
    test.each([
      ["no resourceType", { resourceType: undefined }],
      ["a null resourceType", { resourceType: null }],
      ["an alias instead of the enum value", { resourceType: "docker" }],
      ["a lowercased enum value", { resourceType: "dockerhost" }],
      ["Kubernetes", { resourceType: "KubernetesCluster" }],
      ["a numeric resourceType", { resourceType: 3 }],
      ["no resourceId", { resourceId: undefined }],
      ["a blank resourceId", { resourceId: "   " }],
      ["a numeric resourceId", { resourceId: 42 }],
      [
        "a credentialId",
        { credentialId: "33333333-3333-4333-8333-333333333333" },
      ],
      ["an empty credentialId", { credentialId: "" }],
      ["a credentialNameSnapshot", { credentialNameSnapshot: "prod ssh key" }],
      ["a resolved credential", { credential: { password: "hunter2" } }],
      ["a cluster", { kubernetesClusterId: RESOURCE_ID }],
      ["a Denied tier", { resourceCommandTier: ResourceCommandTier.Denied }],
      ["an unknown tier", { resourceCommandTier: "Safe" }],
      ["a lowercased tier", { resourceCommandTier: "safewrite" }],
      ["a numeric tier", { resourceCommandTier: 1 }],
      ["no runnerId (the agent)", { runnerId: "" }],
      ["a Denied verdict", { policyVerdict: "Denied" }],
    ])(
      "%s makes the whole plan null",
      (_label: string, overrides: JSONObject) => {
        const step: JSONObject = resourceStep();

        for (const [key, value] of Object.entries(overrides)) {
          if (value === undefined) {
            delete step[key];
          } else {
            step[key] = value;
          }
        }

        expect(
          AiRemediationCommandPlanUtil.parse({
            commands: [
              {
                sequence: 1,
                stepType: RunbookStepType.Bash,
                runnerId: AGENT_ID,
                command: "uptime",
                policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
              },
              { ...step, sequence: 2 },
            ],
          }),
        ).toBeNull();
      },
    );
  });

  test("resource fields on a non-resource step are ignored, not trusted", () => {
    const plan: AiRemediationCommandPlan | null =
      AiRemediationCommandPlanUtil.parse({
        commands: [
          {
            sequence: 1,
            stepType: RunbookStepType.Kubectl,
            runnerId: AGENT_ID,
            kubernetesClusterId: RESOURCE_ID,
            kubectlTier: KubectlCommandTier.SafeWrite,
            resourceType: AiResourceType.DockerHost,
            resourceId: RESOURCE_ID,
            resourceCommandTier: ResourceCommandTier.Denied,
            command: "kubectl rollout restart deployment/web -n web",
            policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
          },
        ],
      });

    expect(plan).not.toBeNull();
    expect(plan?.commands[0]).not.toHaveProperty("resourceType");
    expect(plan?.commands[0]).not.toHaveProperty("resourceId");
    expect(plan?.commands[0]).not.toHaveProperty("resourceCommandTier");
  });
});

describe("plans stored before ResourceCommand parse exactly as before", () => {
  /*
   * The shape of every key parse produces for an old step — no resource
   * keys added, and the Runner default name kept.
   */
  test("a Bash, an SSH and a Kubectl step keep their exact parsed shape", () => {
    const plan: AiRemediationCommandPlan | null =
      AiRemediationCommandPlanUtil.parse({
        commands: [
          {
            sequence: 1,
            stepType: RunbookStepType.Bash,
            runnerId: AGENT_ID,
            command: "systemctl restart nginx",
            timeoutInMs: 30000,
            rationale: "r",
            expectedEffect: "e",
            policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
          },
          {
            sequence: 2,
            stepType: RunbookStepType.SSH,
            runnerId: AGENT_ID,
            runnerNameSnapshot: "office-runner",
            credentialId: "44444444-4444-4444-8444-444444444444",
            credentialNameSnapshot: "db ssh",
            command: "uptime",
            timeoutInMs: 30000,
            rationale: "r",
            expectedEffect: "e",
            policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
          },
          {
            sequence: 3,
            stepType: RunbookStepType.Kubectl,
            runnerId: AGENT_ID,
            runnerNameSnapshot: "Kubernetes AI agent",
            kubernetesClusterId: RESOURCE_ID,
            kubernetesClusterNameSnapshot: "prod-us",
            kubectlTier: KubectlCommandTier.SafeWrite,
            command: "kubectl rollout restart deployment/web -n web",
            timeoutInMs: 30000,
            rationale: "r",
            expectedEffect: "e",
            policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
          },
        ],
      });

    expect(plan).not.toBeNull();

    const expectedKeys: Array<string> = [
      "command",
      "credentialId",
      "credentialNameSnapshot",
      "execution",
      "expectedEffect",
      "kubectlTier",
      "kubernetesClusterId",
      "kubernetesClusterNameSnapshot",
      "policyVerdict",
      "rationale",
      "rollbackCommand",
      "rollbackExecution",
      "runnerId",
      "runnerNameSnapshot",
      "sequence",
      "stepType",
      "timeoutInMs",
      "wasAutoExecuted",
    ];

    for (const command of plan!.commands) {
      expect(Object.keys(command).sort()).toEqual(expectedKeys);
    }

    expect(plan!.commands[0]?.runnerNameSnapshot).toBe("Runner");
    expect(plan!.commands[2]?.kubectlTier).toBe(KubectlCommandTier.SafeWrite);
  });
});
