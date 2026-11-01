import {
  CLOUD_AI_AGENT_ASK_FIRST_TITLE,
  CLOUD_AI_AGENT_FIX_SAFE_TITLE,
  CLOUD_SHELL_NAMES,
  CloudAiAgentSetupChoices,
  getCloudAccountAiResourceType,
  getCloudAiAgentFixesMode,
  getCloudAiAgentLogsCommand,
  getCloudAiAgentReportedChoices,
  getCloudAiAgentSetupOptions,
  getDefaultCloudAiAgentSetupChoices,
  getProtectedTargetsProblem,
  parseProtectedTargets,
  readCloudProvider,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiAgentSetup";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudAiAgentSetupOptions,
  describeCloudAiAgentSetupProblem,
  getCloudAiAgentChangeOperations,
  getCloudAiAgentMaxProtectedTargets,
  getCloudAiAgentSetupCommand,
} from "../../../Types/CloudConnection/CloudAiAgentSetupCommands";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { getCloudAiAgentOwnTargets } from "../../../Types/ResourceAiAgent/CloudAiAgentNames";
import {
  CLOUD_AI_DEFAULT_REQUIRED_TAG,
  ResourceAiAgentPosture,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { describe, expect, test } from "@jest/globals";

/*
 * "Let AI fix problems" on a cloud account asks one question — how far may
 * AI go — and builds one command for the cloud's shell. Everything else has
 * a safe default under More fields: every change (their tiers still apply), no
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

/*
 * Change on a connected agent opens the dialog on what the agent reports it
 * runs with - the changes turned on, the tag it requires and the resources
 * a person protected - so running the command again keeps every earlier
 * choice. Starting from the defaults instead would have turned back on a
 * change someone turned off, and dropped a protected resource or the tag.
 */
describe("opened for an agent that connected", () => {
  const AWS_ACCOUNT: string = "123456789012";

  function posture(
    overrides: Partial<ResourceAiAgentPosture> = {},
  ): ResourceAiAgentPosture {
    return {
      resourceType: AiResourceType.AwsAccount,
      resourceIdentifier: AWS_ACCOUNT,
      allowWrites: true,
      writeTargets: [],
      protectedTargets: [],
      reachable: true,
      details: {
        cloudProvider: "aws",
        cloudAccountId: AWS_ACCOUNT,
        enabledOperations: "restart-service,scale-out,start-instance",
        requiredTag: "oneuptime-ai=allow",
      },
      ...overrides,
    };
  }

  test("starts from the changes, the tag and the protected resources it reports", () => {
    const choices: CloudAiAgentSetupChoices =
      getDefaultCloudAiAgentSetupChoices({
        provider: CloudProvider.AWS,
        currentMode: ResourceAiRemediationMode.Automatic,
        accountId: AWS_ACCOUNT,
        posture: posture({
          protectedTargets: [
            "*prod-db*",
            "arn:aws:rds:us-east-1:123456789012:db:orders",
            ...getCloudAiAgentOwnTargets({
              provider: "aws",
              accountId: AWS_ACCOUNT,
            }),
            // What it found of itself where it runs.
            "arn:aws:ecs:us-east-1:123456789012:task/oneuptime-ai-agent/0f3c9a2b",
          ],
        }),
      });

    expect(choices).toEqual({
      fixSafeProblemsAlone: true,
      bypassApproval: false,
      // In the catalog's order, whatever order it reported them in.
      enabledOperations: ["restart-service", "start-instance", "scale-out"],
      protectedTargetsText:
        "*prod-db*\narn:aws:rds:us-east-1:123456789012:db:orders",
      onlyTaggedResources: true,
    });

    // And the command it writes keeps all of it.
    const written: CloudAiAgentSetupOptions = options(
      CloudProvider.AWS,
      choices,
    );
    expect(written.enabledOperations).toEqual([
      "restart-service",
      "start-instance",
      "scale-out",
    ]);
    expect(written.protectedTargets).toEqual([
      "*prod-db*",
      "arn:aws:rds:us-east-1:123456789012:db:orders",
    ]);
    expect(written.requiredTag).toBe(CLOUD_AI_DEFAULT_REQUIRED_TAG);
    expect(written.fixesMode).toBe("Automatic");
  });

  test("never lists the agent's own stack, roles, service or task as a person's", () => {
    for (const provider of Object.values(CloudProvider)) {
      const accountId: string =
        provider === CloudProvider.AWS
          ? AWS_ACCOUNT
          : provider === CloudProvider.Azure
            ? "00000000-0000-0000-0000-0000000000ab"
            : "my-project";

      expect(
        getCloudAiAgentReportedChoices({
          provider,
          accountId,
          posture: posture({
            protectedTargets: [
              ...getCloudAiAgentOwnTargets({
                provider: provider as string as "aws" | "azure" | "gcp",
                accountId,
              }),
              "//run.googleapis.com/projects/my-project/locations/us-central1/services/oneuptime-ai-agent",
              "arn:aws:iam::123456789012:role/OneUptimeAiAgentWrite",
            ],
          }),
        }).protectedTargetsText,
      ).toBe("");
    }
  });

  test("a change the agent does not report stays off; one this cloud lacks is ignored", () => {
    const reported: Partial<CloudAiAgentSetupChoices> =
      getCloudAiAgentReportedChoices({
        provider: CloudProvider.AWS,
        accountId: AWS_ACCOUNT,
        posture: posture({
          details: {
            enabledOperations: " scale-out , drop-database,restart-service",
            requiredTag: null,
          },
        }),
      });

    expect(reported.enabledOperations).toEqual([
      "restart-service",
      "scale-out",
    ]);
    // No tag reported: it changes resources whatever their tags.
    expect(reported.onlyTaggedResources).toBe(false);
  });

  test("what the agent does not report keeps its default", () => {
    // No agent yet: the defaults.
    expect(
      getCloudAiAgentReportedChoices({
        provider: CloudProvider.AWS,
        accountId: AWS_ACCOUNT,
        posture: null,
      }),
    ).toEqual({});

    // An agent that names no change, or none of this cloud's: every change.
    for (const details of [
      {},
      { enabledOperations: "" },
      { enabledOperations: "drop-database" },
      { enabledOperations: 3 },
    ]) {
      const choices: CloudAiAgentSetupChoices =
        getDefaultCloudAiAgentSetupChoices({
          provider: CloudProvider.AWS,
          accountId: AWS_ACCOUNT,
          posture: posture({ details }),
        });

      expect(choices.enabledOperations).toEqual(
        getCloudAiAgentChangeOperations(CloudProvider.AWS),
      );
      expect(choices.onlyTaggedResources).toBe(false);
      expect(choices.protectedTargetsText).toBe("");
    }
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

  test("the choices under More fields reach the command", () => {
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

  test("a protected pattern the agent cannot read is named, before the command is written", () => {
    for (const text of ["my prod db", '*prod*\n"web"', "it's-prod"]) {
      const problem: ReturnType<typeof getProtectedTargetsProblem> =
        getProtectedTargetsProblem({
          provider: CloudProvider.AWS,
          accountId: "123456789012",
          text,
        });

      expect(problem?.kind).toBe("unreadable");

      // The command module refuses the same pattern.
      expect(
        describeCloudAiAgentSetupProblem(
          options(CloudProvider.AWS, {
            ...getDefaultCloudAiAgentSetupChoices({
              provider: CloudProvider.AWS,
            }),
            protectedTargetsText: text,
          }),
        ),
      ).not.toBeNull();
    }

    expect(
      getProtectedTargetsProblem({
        provider: CloudProvider.AWS,
        accountId: "123456789012",
        text: "*prod-db*\narn:aws:ecs:*:*:service/payments/*",
      }),
    ).toBeNull();
  });

  test("more protected patterns than the agent takes are named with the most it takes", () => {
    const most: number = getCloudAiAgentMaxProtectedTargets(
      CloudProvider.Azure,
      "00000000-0000-0000-0000-0000000000ab",
    );
    const text: string = Array.from(
      { length: most + 1 },
      (_value: unknown, index: number): string => {
        return `*vm-${index}*`;
      },
    ).join("\n");

    expect(
      getProtectedTargetsProblem({
        provider: CloudProvider.Azure,
        accountId: "00000000-0000-0000-0000-0000000000ab",
        text,
      }),
    ).toEqual({ kind: "too-many", most });
    expect(
      getProtectedTargetsProblem({
        provider: CloudProvider.Azure,
        accountId: "00000000-0000-0000-0000-0000000000ab",
        text: text.split("\n").slice(0, most).join("\n"),
      }),
    ).toBeNull();
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
    expect(getCloudAiAgentLogsCommand(CloudProvider.GCP)).toBe(
      'gcloud run services logs read oneuptime-ai-agent --region "$(gcloud run services list --filter "metadata.name=oneuptime-ai-agent" --format "value(region)" | head -1)" --limit 100',
    );
  });
});
