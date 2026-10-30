import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  AwsCloudCommandPolicy,
  AzureCloudCommandPolicy,
  GcpCloudCommandPolicy,
} from "../../../../Utils/AiRemediation/Resource/CloudCommandPolicy";
import {
  ResourceAutoExecutionVerdict,
  ResourceCommandPolicyResult,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  CLOUD_AI_RESOURCE_TYPES,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { getCloudAiAgentOwnTargets } from "../../../../Types/ResourceAiAgent/CloudAiAgentNames";
import { RESOURCE_AI_ALLOWLIST_EXAMPLES } from "../../../../Types/AI/ResourceAiAccessPermissions";
import { AiRemediationCommandPolicyVerdict } from "../../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — the cloud command policy, as every caller reaches
 * it: through ResourceCommandPolicy for an AwsAccount, an
 * AzureSubscription or a GoogleCloudProject.
 *
 * - Each cloud's resource type gets its own cloud's grammar and guides.
 * - Tiers come from the catalog per kind of resource; three changes always
 *   ask a person; a change's target is its resource id (lowercased on
 *   Azure); reads and whoami change nothing and name no target.
 * - The shared rules hold: the auto-execution ladder, the allowlist, and
 *   the agent's write scope, which protects what the agent's own setup
 *   command created.
 */

const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";
const EC2: string =
  "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc1234def567890";
const AGENT_SERVICE: string =
  "arn:aws:ecs:us-east-1:123456789012:service/oneuptime-ai-agent/oneuptime-ai-agent";
const SITE: string =
  "/subscriptions/00000000-0000-0000-0000-0000000000AB/resourceGroups/Prod/providers/Microsoft.Web/sites/web";
const RUN: string =
  "//run.googleapis.com/projects/my-project/locations/us-central1/services/web";

function evaluate(
  resourceType: AiResourceType,
  command: string,
): ResourceCommandPolicyResult {
  return ResourceCommandPolicy.evaluateCommand({ resourceType, command });
}

function verdict(
  resourceType: AiResourceType,
  command: string,
  options: { bypassApproval?: boolean; allowlist?: Array<string> } = {},
): ResourceAutoExecutionVerdict {
  return ResourceCommandPolicy.evaluateForAutoExecution({
    resourceType,
    command,
    allowlistPatterns: options.allowlist || [],
    bypassApproval: options.bypassApproval === true,
  });
}

describe("each cloud's resource type reads its own cloud", () => {
  test("the dispatcher hands each type its cloud's policy", () => {
    expect(ResourceCommandPolicy.getToolPolicy(AiResourceType.AwsAccount)).toBe(
      AwsCloudCommandPolicy,
    );
    expect(
      ResourceCommandPolicy.getToolPolicy(AiResourceType.AzureSubscription),
    ).toBe(AzureCloudCommandPolicy);
    expect(
      ResourceCommandPolicy.getToolPolicy(AiResourceType.GoogleCloudProject),
    ).toBe(GcpCloudCommandPolicy);
  });

  test("every cloud type runs only cloud, and its test command is a read", () => {
    for (const type of CLOUD_AI_RESOURCE_TYPES) {
      expect(AI_RESOURCE_TYPE_INFO[type].programs).toEqual(["cloud"]);

      for (const command of AI_RESOURCE_TYPE_INFO[type].testCommands) {
        expect(evaluate(type, command).tier).toBe(ResourceCommandTier.Read);
      }
    }
  });

  test("an id of another cloud is refused", () => {
    expect(
      evaluate(AiResourceType.AwsAccount, `cloud describe ${SITE}`).tier,
    ).toBe(ResourceCommandTier.Denied);
    expect(
      evaluate(AiResourceType.AzureSubscription, `cloud describe ${ECS}`).tier,
    ).toBe(ResourceCommandTier.Denied);
    expect(
      evaluate(AiResourceType.GoogleCloudProject, `cloud describe ${ECS}`).tier,
    ).toBe(ResourceCommandTier.Denied);
  });

  test("the real CLIs are not programs a cloud agent runs", () => {
    for (const command of [
      "aws ecs update-service --cluster prod --service web --force-new-deployment",
      "az webapp restart --name web --resource-group prod",
      "gcloud run services update web --min-instances 2",
    ]) {
      const result: ResourceCommandPolicyResult = evaluate(
        AiResourceType.AwsAccount,
        command,
      );

      expect(result.tier).toBe(ResourceCommandTier.Denied);
      expect(result.reason).toMatch(/not a program the Cloud AI agent runs/);
    }
  });

  test("shell syntax is refused before the grammar reads anything", () => {
    expect(
      evaluate(AiResourceType.AwsAccount, `cloud describe ${ECS} | cat`).tier,
    ).toBe(ResourceCommandTier.Denied);
    expect(
      evaluate(AiResourceType.AwsAccount, `cloud describe $(echo ${ECS})`).tier,
    ).toBe(ResourceCommandTier.Denied);
  });

  test("the guides are written for the cloud", () => {
    expect(
      ResourceCommandPolicy.getReadCommandGuide(AiResourceType.AwsAccount),
    ).toContain("ARN");
    expect(
      ResourceCommandPolicy.getReadCommandGuide(
        AiResourceType.AzureSubscription,
      ),
    ).toContain("Azure resource ID");
    expect(
      ResourceCommandPolicy.getWriteCommandGuide(
        AiResourceType.GoogleCloudProject,
      ),
    ).toContain("Cloud Run service");
  });
});

describe("tiers and targets", () => {
  test("a rolling ECS restart is safe and names the service", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      AiResourceType.AwsAccount,
      `cloud restart-service ${ECS}`,
    );

    expect(result.tier).toBe(ResourceCommandTier.SafeWrite);
    expect(result.program).toBe("cloud");
    expect(result.verb).toBe("restart-service");
    expect(result.args).toEqual(["restart-service", ECS]);
    expect(result.targets).toEqual([ECS]);
    expect(result.reason).toMatch(/ecs:UpdateService with forceNewDeployment/);
    expect(result.requiresHuman).toBeUndefined();
  });

  test("restarting an App Service is riskier, and its target is the lowercased id", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      AiResourceType.AzureSubscription,
      `cloud restart-service ${SITE}`,
    );

    expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
    expect(result.targets).toEqual([SITE.toLowerCase()]);
  });

  test("the three changes a person always approves say so", () => {
    for (const [type, command] of [
      [AiResourceType.AwsAccount, `cloud stop-instance ${EC2}`],
      [
        AiResourceType.AwsAccount,
        "cloud fail-over-database arn:aws:rds:us-east-1:123456789012:cluster:orders",
      ],
      [
        AiResourceType.AwsAccount,
        "cloud redrive-queue arn:aws:sqs:us-east-1:123456789012:orders-dlq",
      ],
    ] as Array<[AiResourceType, string]>) {
      const result: ResourceCommandPolicyResult = evaluate(type, command);

      expect(result.tier).toBe(ResourceCommandTier.RiskyWrite);
      expect(result.requiresHuman).toBe(true);
    }
  });

  test("reads and whoami change nothing and name no target", () => {
    for (const command of [
      `cloud describe ${ECS}`,
      `cloud recent-events ${ECS} --hours 2`,
      `cloud quota-usage ${ECS}`,
      `cloud read-logs ${ECS} --filter error`,
      "cloud whoami",
    ]) {
      const result: ResourceCommandPolicyResult = evaluate(
        AiResourceType.AwsAccount,
        command,
      );

      expect(result.tier).toBe(ResourceCommandTier.Read);
      expect(result.targets).toEqual([]);
    }

    expect(
      ResourceCommandPolicy.isReadOnly({
        resourceType: AiResourceType.GoogleCloudProject,
        command: `cloud describe ${RUN}`,
      }),
    ).toBe(true);
  });

  test("the display command round-trips and carries the canonical flags", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      AiResourceType.GoogleCloudProject,
      `cloud read-logs ${RUN} --minutes=30 --filter "deadline exceeded"`,
    );

    expect(result.displayCommand).toBe(
      `cloud read-logs ${RUN} --filter 'deadline exceeded' --minutes 30`,
    );
    expect(
      evaluate(AiResourceType.GoogleCloudProject, result.displayCommand).args,
    ).toEqual(result.args);
  });

  test("a change on a kind its operation lacks is denied with what it works on", () => {
    const result: ResourceCommandPolicyResult = evaluate(
      AiResourceType.AwsAccount,
      `cloud restart-service ${EC2}`,
    );

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.reason).toMatch(/ECS service/);
  });
});

describe("the auto-execution ladder", () => {
  test("a safe change runs on its own", () => {
    expect(
      verdict(AiResourceType.AwsAccount, `cloud scale-out ${ECS} --count 4`)
        .verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
  });

  test("a riskier change asks unless approvals are bypassed or it is allowlisted", () => {
    const command: string = `cloud scale-in ${ECS} --count 2`;

    expect(verdict(AiResourceType.AwsAccount, command).verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(
      verdict(AiResourceType.AwsAccount, command, { bypassApproval: true })
        .verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    expect(
      verdict(AiResourceType.AwsAccount, command, {
        allowlist: [`cloud scale-in ${ECS} --count *`],
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
  });

  test("a change a person always approves asks even with approvals bypassed", () => {
    const result: ResourceAutoExecutionVerdict = verdict(
      AiResourceType.AwsAccount,
      `cloud stop-instance ${EC2}`,
      { bypassApproval: true, allowlist: [`cloud stop-instance ${EC2}`] },
    );

    expect(result.verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(result.requiresHuman).toBe(true);
  });

  test("a denied command never runs", () => {
    expect(
      verdict(AiResourceType.AwsAccount, `cloud delete ${EC2}`, {
        bypassApproval: true,
      }).verdict,
    ).toBe(AiRemediationCommandPolicyVerdict.Denied);
  });
});

describe("the allowlist", () => {
  test("each cloud's example entry is a valid one", () => {
    for (const type of CLOUD_AI_RESOURCE_TYPES) {
      expect(
        ResourceCommandPolicy.describeAllowlistPatternProblem({
          resourceType: type,
          pattern: RESOURCE_AI_ALLOWLIST_EXAMPLES[type],
        }),
      ).toBeNull();
    }
  });

  test("a * for the resource is a valid entry, and a broad one", () => {
    for (const [type, pattern] of [
      [AiResourceType.AwsAccount, "cloud restart-service *"],
      [AiResourceType.AwsAccount, "cloud scale-in * --count *"],
      [AiResourceType.AzureSubscription, "cloud reboot-instance *"],
      [AiResourceType.GoogleCloudProject, "cloud roll-back-service *"],
    ] as Array<[AiResourceType, string]>) {
      expect(
        ResourceCommandPolicy.describeAllowlistPatternProblem({
          resourceType: type,
          pattern,
        }),
      ).toBeNull();
      expect(
        ResourceCommandPolicy.isBroadAllowlistPattern({
          resourceType: type,
          pattern,
        }),
      ).toBe(true);
    }

    // A * in the count names the same service whatever it is.
    expect(
      ResourceCommandPolicy.isBroadAllowlistPattern({
        resourceType: AiResourceType.AwsAccount,
        pattern: `cloud scale-in ${ECS} --count *`,
      }),
    ).toBe(false);
  });

  test("a * matches a real command word for word", () => {
    expect(
      ResourceCommandPolicy.matchesAllowlist({
        resourceType: AiResourceType.AwsAccount,
        command: `cloud scale-in ${ECS} --count 3`,
        patterns: ["cloud scale-in * --count *"],
      }),
    ).toBe(true);
    expect(
      ResourceCommandPolicy.matchesAllowlist({
        resourceType: AiResourceType.AwsAccount,
        command: `cloud scale-in ${ECS} --count 3`,
        patterns: ["cloud scale-in *"],
      }),
    ).toBe(false);
  });

  test("a read pre-approves nothing, and a * for the operation is refused", () => {
    expect(
      ResourceCommandPolicy.describeAllowlistPatternProblem({
        resourceType: AiResourceType.AwsAccount,
        pattern: `cloud describe ${ECS}`,
      }),
    ).toMatch(/read-only/);
    expect(
      ResourceCommandPolicy.describeAllowlistPatternProblem({
        resourceType: AiResourceType.AwsAccount,
        pattern: `cloud * ${ECS}`,
      }),
    ).toMatch(/where the command goes/);
  });
});

describe("the agent's write scope", () => {
  const ownTargets: Array<string> = getCloudAiAgentOwnTargets({
    provider: "aws",
    accountId: "123456789012",
  });

  function scope(
    command: string,
    data: { writeTargets?: Array<string>; allowWrites?: boolean } = {},
  ): string | null {
    return ResourceCommandPolicy.getWriteScopeRefusal({
      result: evaluate(AiResourceType.AwsAccount, command),
      allowWrites: data.allowWrites !== false,
      writeTargets: data.writeTargets || [],
      protectedTargets: ownTargets,
      resourceType: AiResourceType.AwsAccount,
    });
  }

  test("the agent never changes its own service", () => {
    expect(scope(`cloud restart-service ${AGENT_SERVICE}`)).toMatch(/protects/);
    expect(scope(`cloud restart-service ${ECS}`)).toBeNull();
  });

  test("write targets narrow what it may change", () => {
    expect(
      scope(`cloud restart-service ${ECS}`, {
        writeTargets: ["arn:aws:ecs:*:123456789012:service/staging/*"],
      }),
    ).toMatch(/outside the targets/);
    expect(
      scope(`cloud restart-service ${ECS}`, {
        writeTargets: ["arn:aws:ecs:*:123456789012:service/prod/*"],
      }),
    ).toBeNull();
  });

  test("a read-only agent changes nothing", () => {
    expect(
      scope(`cloud restart-service ${ECS}`, { allowWrites: false }),
    ).toMatch(/read-only/);
  });

  test("the agent's own Azure resource group and Cloud Run service are protected too", () => {
    expect(
      ResourceCommandPolicy.getWriteScopeRefusal({
        result: evaluate(
          AiResourceType.AzureSubscription,
          "cloud restart-service /subscriptions/00000000-0000-0000-0000-0000000000ab/resourceGroups/oneuptime-ai-agent/providers/Microsoft.App/containerApps/oneuptime-ai-agent",
        ),
        allowWrites: true,
        writeTargets: [],
        protectedTargets: getCloudAiAgentOwnTargets({
          provider: "azure",
          accountId: "00000000-0000-0000-0000-0000000000AB",
        }),
        resourceType: AiResourceType.AzureSubscription,
      }),
    ).toMatch(/protects/);

    expect(
      ResourceCommandPolicy.getWriteScopeRefusal({
        result: evaluate(
          AiResourceType.GoogleCloudProject,
          "cloud scale-out //run.googleapis.com/projects/my-project/locations/us-central1/services/oneuptime-ai-agent --count 2",
        ),
        allowWrites: true,
        writeTargets: [],
        protectedTargets: getCloudAiAgentOwnTargets({
          provider: "gcp",
          accountId: "my-project",
        }),
        resourceType: AiResourceType.GoogleCloudProject,
      }),
    ).toMatch(/protects/);
  });
});
