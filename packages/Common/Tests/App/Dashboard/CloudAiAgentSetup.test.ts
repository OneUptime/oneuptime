import {
  CLOUD_AI_AGENT_ASK_FIRST_TITLE,
  CLOUD_AI_AGENT_FIX_SAFE_TITLE,
  CLOUD_SHELL_NAMES,
  CloudAiAgentSetupChoices,
  getCloudAccountAiResourceType,
  getCloudAiAgentFixesMode,
  getCloudAiAgentLogsCommand,
  getCloudAiAgentSetupOptions,
  getDefaultCloudAiAgentSetupChoices,
  parseProtectedTargets,
  readCloudProvider,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiAgentSetup";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudAiAgentSetupOptions,
  describeCloudAiAgentSetupProblem,
  getCloudAiAgentChangeOperations,
  getCloudAiAgentSetupCommand,
} from "../../../Types/CloudConnection/CloudAiAgentSetupCommands";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  CLOUD_AI_DEFAULT_REQUIRED_TAG,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { describe, expect, test } from "@jest/globals";

/*
 * "Let AI fix problems" on a cloud account asks one question — how far may
 * AI go — and builds one command for the cloud's shell. Everything else has
 * a safe default under Advanced: every change (their tiers still apply), no
 * protected resources, no required tag, logs unread, approvals not
 * bypassed.
 */

const ACCOUNT_ROW_ID: string = "22222222-2222-4222-8222-222222222222";

function options(
  provider: CloudProvider,
  choices: CloudAiAgentSetupChoices,
): CloudAiAgentSetupOptions {
  return getCloudAiAgentSetupOptions({
    provider,
    choices,
    oneuptimeUrl: "https://oneuptime.example.com",
    ingestionKey: "0f3c2b1a-1111-4111-8111-111111111111",
    cloudAccountId: ACCOUNT_ROW_ID,
    accountId:
      provider === CloudProvider.AWS
        ? "123456789012"
        : provider === CloudProvider.Azure
          ? "00000000-0000-0000-0000-0000000000ab"
          : "my-project",
  });
}

describe("the one question", () => {
  test("defaults to Ask me first, with every change on", () => {
    for (const provider of Object.values(CloudProvider)) {
      const choices: CloudAiAgentSetupChoices =
        getDefaultCloudAiAgentSetupChoices({ provider });

      expect(choices).toEqual({
        fixSafeProblemsAlone: false,
        bypassApproval: false,
        enabledOperations: getCloudAiAgentChangeOperations(provider),
        protectedTargetsText: "",
        onlyTaggedResources: false,
      });
      expect(getCloudAiAgentFixesMode(choices)).toBe("RequireApproval");
    }
  });

  test("opens on what the agent runs with now", () => {
    expect(
      getDefaultCloudAiAgentSetupChoices({
        provider: CloudProvider.AWS,
        currentMode: ResourceAiRemediationMode.Automatic,
      }).fixSafeProblemsAlone,
    ).toBe(true);

    const bypass: CloudAiAgentSetupChoices = getDefaultCloudAiAgentSetupChoices(
      {
        provider: CloudProvider.AWS,
        currentMode: ResourceAiRemediationMode.BypassApproval,
      },
    );

    expect(bypass.fixSafeProblemsAlone).toBe(true);
    expect(bypass.bypassApproval).toBe(true);
    // Off reads as Ask me first: opening the dialog asks for fixes.
    expect(
      getDefaultCloudAiAgentSetupChoices({
        provider: CloudProvider.AWS,
        currentMode: ResourceAiRemediationMode.Disabled,
      }).fixSafeProblemsAlone,
    ).toBe(false);
  });

  test("its answers map to the agent's fixes setting", () => {
    const base: CloudAiAgentSetupChoices = getDefaultCloudAiAgentSetupChoices({
      provider: CloudProvider.GCP,
    });

    expect(
      getCloudAiAgentFixesMode({ ...base, fixSafeProblemsAlone: true }),
    ).toBe("Automatic");
    expect(
      getCloudAiAgentFixesMode({
        ...base,
        fixSafeProblemsAlone: true,
        bypassApproval: true,
      }),
    ).toBe("BypassApproval");
    expect(CLOUD_AI_AGENT_ASK_FIRST_TITLE).toBe("Ask me first");
    expect(CLOUD_AI_AGENT_FIX_SAFE_TITLE).toBe("Fix safe problems on its own");
  });
});

describe("the setup command's options", () => {
  test("by default name no operation list, no protected resource and no tag", () => {
    const built: CloudAiAgentSetupOptions = options(
      CloudProvider.AWS,
      getDefaultCloudAiAgentSetupChoices({ provider: CloudProvider.AWS }),
    );

    expect(built.fixesMode).toBe("RequireApproval");
    expect(built.enabledOperations).toBeUndefined();
    expect(built.protectedTargets).toBeUndefined();
    expect(built.requiredTag).toBeNull();
    expect(built.cloudAccountId).toBe(ACCOUNT_ROW_ID);
    expect(describeCloudAiAgentSetupProblem(built)).toBeNull();
  });

  test("Advanced choices reach the command", () => {
    const choices: CloudAiAgentSetupChoices = {
      ...getDefaultCloudAiAgentSetupChoices({ provider: CloudProvider.AWS }),
      enabledOperations: ["restart-service", "scale-out"],
      protectedTargetsText:
        "*prod-db*\n  arn:aws:ecs:*:*:service/payments/* \n\n*prod-db*",
      onlyTaggedResources: true,
      fixSafeProblemsAlone: true,
    };
    const built: CloudAiAgentSetupOptions = options(CloudProvider.AWS, choices);

    expect(built.fixesMode).toBe("Automatic");
    expect(built.enabledOperations).toEqual(["restart-service", "scale-out"]);
    expect(built.protectedTargets).toEqual([
      "*prod-db*",
      "arn:aws:ecs:*:*:service/payments/*",
    ]);
    expect(built.requiredTag).toBe(CLOUD_AI_DEFAULT_REQUIRED_TAG);

    const command: string = getCloudAiAgentSetupCommand(built);

    expect(command).toContain("ONEUPTIME_AI_CLOUD_OPERATIONS");
    expect(command).toContain("restart-service,scale-out");
    expect(command).toContain("oneuptime-ai=allow");
  });

  test("operations keep the catalog's order and drop what the cloud lacks", () => {
    const built: CloudAiAgentSetupOptions = options(CloudProvider.Azure, {
      ...getDefaultCloudAiAgentSetupChoices({ provider: CloudProvider.Azure }),
      // redrive-queue is AWS only.
      enabledOperations: ["scale-out", "redrive-queue", "restart-service"],
    });

    expect(built.enabledOperations).toEqual(["restart-service", "scale-out"]);
  });

  test("each cloud's command is one the setup builds without a problem", () => {
    for (const provider of Object.values(CloudProvider)) {
      const built: CloudAiAgentSetupOptions = options(
        provider,
        getDefaultCloudAiAgentSetupChoices({ provider }),
      );

      expect(describeCloudAiAgentSetupProblem(built)).toBeNull();
      expect(getCloudAiAgentSetupCommand(built).length).toBeGreaterThan(100);
    }
  });
});

describe("the dialog's pieces", () => {
  test("protected resources are read one per line or comma, without blanks or repeats", () => {
    expect(parseProtectedTargets(" a , b\n\nc\na ")).toEqual(["a", "b", "c"]);
    expect(parseProtectedTargets("")).toEqual([]);
  });

  test("each cloud's account is its own AI resource type", () => {
    expect(getCloudAccountAiResourceType(CloudProvider.AWS)).toBe(
      AiResourceType.AwsAccount,
    );
    expect(getCloudAccountAiResourceType(CloudProvider.Azure)).toBe(
      AiResourceType.AzureSubscription,
    );
    expect(getCloudAccountAiResourceType(CloudProvider.GCP)).toBe(
      AiResourceType.GoogleCloudProject,
    );
    expect(getCloudAccountAiResourceType("oracle")).toBeNull();
    expect(readCloudProvider("aws")).toBe(CloudProvider.AWS);
    expect(readCloudProvider("AWS")).toBeNull();
  });

  test("each cloud's shell and the agent's logs there", () => {
    expect(CLOUD_SHELL_NAMES[CloudProvider.AWS]).toBe("AWS CloudShell");
    expect(getCloudAiAgentLogsCommand(CloudProvider.AWS)).toBe(
      "aws logs tail /oneuptime/oneuptime-ai-agent --since 30m",
    );
    expect(getCloudAiAgentLogsCommand(CloudProvider.Azure)).toContain(
      "az containerapp logs show --name oneuptime-ai-agent --resource-group oneuptime-ai-agent",
    );
    expect(getCloudAiAgentLogsCommand(CloudProvider.GCP)).toContain(
      "gcloud run services logs read oneuptime-ai-agent",
    );
  });
});
