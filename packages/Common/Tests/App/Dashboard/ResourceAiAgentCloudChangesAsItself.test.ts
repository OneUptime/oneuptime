import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_AGENT_CHANGES_AS_ITSELF_STEP_TEXTS,
  ResourceAiAttention,
  getResourceAiAttention,
  parseResourceAiAccessStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatus";
import { getResourceAiAgentStatusSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatusSummary";
import {
  ResourceAiAgentDescriptor,
  getResourceAiAgentDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import ResourceAiAccessService, {
  CLOUD_WRITE_PATH_DETAILS,
  ResourceAiAccessProjectGates,
  ResourceAiAccessRow,
  getResourceAiAgentPage,
  isChangingAsItself,
} from "../../../Server/Services/ResourceAiAccessService";
import AutoRemediationDecisionRecorder from "../../../Server/Utils/AutoRemediation/AutoRemediationDecisionRecorder";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
  CLOUD_AI_RESOURCE_TYPES,
  isCloudAiResourceType,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGap,
  ResourceAiAccessStatus,
  ResourceAiAgentPosture,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";

/*
 * A Cloud AI agent set up before its cloud's setup command made a write
 * role, identity or account for its changes (Azure's before #6190, Google
 * Cloud's before #6148) still makes its changes as the identity it reads
 * with, which holds the changes' role. Its owners are told to run the
 * setup command again, which moves the role to the write identity - and
 * told only while that is so (#6212):
 *
 *  - the server's status says it as advice: a gap that blocks neither
 *    investigation nor fixes, so no verdict, no AI context and no
 *    "why AI did not fix this" ever counts it;
 *  - only while the agent itself says so: it reports its cloud's details,
 *    is online and reaches its account, makes changes at all, has no
 *    setting it cannot use, and names no write path. Once it reports a
 *    write role, identity or account - after the command ran again - the
 *    advice is gone;
 *  - the AI agent page says it in its own words, a step with Show how
 *    (the setup dialog) - and, when nothing else needs attention, a
 *    headline of its own, never "can't do all of its job".
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const AGENT_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";

const READY_GATES: ResourceAiAccessProjectGates = {
  isAiEnabled: true,
  hasLlmProvider: true,
  aiBalanceBlocker: null,
};

const CLOUD_PROVIDERS: Readonly<Record<string, string>> = {
  [AiResourceType.AwsAccount]: "aws",
  [AiResourceType.AzureSubscription]: "azure",
  [AiResourceType.GoogleCloudProject]: "gcp",
};

// What each cloud's agent reports of its write path once it has one.
const WRITE_PATHS: Readonly<Record<string, string>> = {
  [AiResourceType.AwsAccount]:
    "arn:aws:iam::123456789012:role/OneUptimeAiAgentWrite",
  [AiResourceType.AzureSubscription]: `/subscriptions/${SUBSCRIPTION}/resourceGroups/oneuptime-ai-agent/providers/Microsoft.ManagedIdentity/userAssignedIdentities/oneuptime-ai-agent-write`,
  [AiResourceType.GoogleCloudProject]:
    "oneuptime-ai-agent-write@shop-prod-1234.iam.gserviceaccount.com",
};

function row(
  type: AiResourceType,
  overrides: Partial<ResourceAiAccessRow> = {},
): ResourceAiAccessRow {
  return {
    resourceType: type,
    id: RESOURCE_ID,
    projectId: PROJECT_ID,
    name: "prod",
    identifier: "prod",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlist: [],
    isArchived: false,
    ...(isCloudAiResourceType(type) ? { hasCloudConnection: true } : {}),
    ...overrides,
  };
}

/*
 * An agent of this cloud as its CloudExecutor reports itself: its cloud's
 * details, and its write path when it has one.
 */
function cloudPosture(
  type: AiResourceType,
  data: {
    writePath?: boolean;
    details?: Record<string, string | number | boolean | null>;
    overrides?: Partial<ResourceAiAgentPosture>;
  } = {},
): Record<string, unknown> {
  const details: Record<string, string | number | boolean | null> = {
    cloudProvider: CLOUD_PROVIDERS[type] || null,
    cloudAccountId: RESOURCE_ID.toString(),
    enabledOperations: "restart-service",
    requiredTag: null,
  };

  if (data.writePath) {
    details[CLOUD_WRITE_PATH_DETAILS[type] as string] = WRITE_PATHS[
      type
    ] as string;
  }

  return {
    resourceType: type,
    resourceIdentifier: "prod",
    allowWrites: true,
    writeTargets: [],
    protectedTargets: [],
    reachable: true,
    details: { ...details, ...(data.details || {}) },
    ...(data.overrides || {}),
  };
}

function agentRow(
  type: AiResourceType,
  posture: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): ResourceAiAgent {
  return {
    id: AGENT_ID,
    _id: AGENT_ID.toString(),
    projectId: PROJECT_ID,
    resourceType: type,
    resourceId: RESOURCE_ID,
    resourceIdentifier: "prod",
    agentVersion: "14.3.0",
    connectionStatus: "connected",
    lastAliveAt: OneUptimeDate.getCurrentDate(),
    posture,
    ...overrides,
  } as unknown as ResourceAiAgent;
}

// The status as the page receives it: built by the server, sent as JSON, read back.
function statusOf(
  resource: ResourceAiAccessRow,
  agent: ResourceAiAgent | null,
): ResourceAiAccessStatus {
  const parsed: ResourceAiAccessStatus | null = parseResourceAiAccessStatus(
    JSON.parse(
      JSON.stringify(
        ResourceAiAccessService.buildStatus({
          resource,
          agentRow: agent,
          gates: READY_GATES,
        }),
      ),
    ),
  );

  if (!parsed) {
    throw new Error("The page could not read the server's status.");
  }

  return parsed;
}

function advice(status: ResourceAiAccessStatus): ResourceAiAccessGap | null {
  return (
    status.gaps.find((gap: ResourceAiAccessGap): boolean => {
      return gap.code === "cloud_agent_changes_as_itself";
    }) || null
  );
}

describe.each(CLOUD_AI_RESOURCE_TYPES)(
  "%s: an agent that makes its changes as the identity it reads with",
  (type: AiResourceType) => {
    const descriptor: ResourceAiAgentDescriptor =
      getResourceAiAgentDescriptor(type);

    test("is told to run the setup command again: advice, which blocks nothing", () => {
      const status: ResourceAiAccessStatus = statusOf(
        row(type),
        agentRow(type, cloudPosture(type)),
      );
      const gap: ResourceAiAccessGap | null = advice(status);

      expect(gap).not.toBeNull();
      expect(gap!.blocksInvestigation).toBe(false);
      expect(gap!.blocksRemediation).toBe(false);
      expect(gap!.title).toBe(
        "The Cloud AI agent makes its changes as the identity it reads with",
      );
      expect(gap!.nextStep).toContain("Run its setup command again");
      expect(gap!.nextStep).toContain(getResourceAiAgentPage(type));
      // Nothing it does is held back by it.
      expect(status.isInvestigationReady).toBe(true);
      expect(status.isRemediationReady).toBe(true);
      expect(
        AutoRemediationDecisionRecorder.getResourceRemediationGaps(status),
      ).toEqual([]);
    });

    test("only while that is so: an agent that reports its write path is told nothing", () => {
      const before: ResourceAiAccessStatus = statusOf(
        row(type),
        agentRow(type, cloudPosture(type)),
      );
      const after: ResourceAiAccessStatus = statusOf(
        row(type),
        agentRow(type, cloudPosture(type, { writePath: true })),
      );

      expect(advice(before)).not.toBeNull();
      expect(advice(after)).toBeNull();
      expect(getResourceAiAttention(after, descriptor)).toBeNull();
    });

    test.each<[string, Record<string, unknown>]>([
      ["it makes no change at all", { overrides: { allowWrites: false } }],
      [
        "a setting it cannot use, which refuses every change",
        {
          details: {
            settingsProblem:
              'ONEUPTIME_AI_AZURE_WRITE_IDENTITY="nope" is not the resource ID of a user-assigned managed identity.',
          },
        },
      ],
      ["it says nothing of its cloud", { details: { cloudProvider: null } }],
      [
        "it cannot reach its account",
        { overrides: { reachable: false, reachError: "denied" } },
      ],
    ])(
      "nothing is said when %s",
      (_name: string, data: Record<string, unknown>) => {
        const status: ResourceAiAccessStatus = statusOf(
          row(type),
          agentRow(
            type,
            cloudPosture(type, data as Parameters<typeof cloudPosture>[1]),
          ),
        );

        expect(advice(status)).toBeNull();
      },
    );

    test("nothing is said of an agent that is offline, or of none", () => {
      const hourAgo: Date = OneUptimeDate.addRemoveMinutes(
        OneUptimeDate.getCurrentDate(),
        -60,
      );

      expect(
        advice(
          statusOf(
            row(type),
            agentRow(type, cloudPosture(type), { lastAliveAt: hourAgo }),
          ),
        ),
      ).toBeNull();
      expect(advice(statusOf(row(type), null))).toBeNull();
    });

    test("an empty write path is none", () => {
      const status: ResourceAiAccessStatus = statusOf(
        row(type),
        agentRow(
          type,
          cloudPosture(type, {
            details: { [CLOUD_WRITE_PATH_DETAILS[type] as string]: "  " },
          }),
        ),
      );

      expect(advice(status)).not.toBeNull();
    });

    test('the page: a headline of its own, its own step, and Show how - never "can\'t do all of its job"', () => {
      const attention: ResourceAiAttention | null = getResourceAiAttention(
        statusOf(row(type), agentRow(type, cloudPosture(type))),
        descriptor,
      );

      expect(attention).not.toBeNull();
      expect(attention!.title).toBe(
        "The Cloud AI agent makes its changes as the identity it reads with",
      );
      expect(attention!.title).not.toContain("can't");
      expect(attention!.steps).toHaveLength(1);
      expect(attention!.steps[0]!.text).toBe(
        CLOUD_AGENT_CHANGES_AS_ITSELF_STEP_TEXTS[type],
      );
      expect(attention!.steps[0]!.text).toMatch(
        /^Run the setup command again\. It moves the changes to a write (role|identity|service account) of their own/,
      );
      // The page's own words: never the page it is on.
      expect(attention!.steps[0]!.text).not.toContain(
        getResourceAiAgentPage(type),
      );
      expect(attention!.steps[0]!.action).toBe("show_cloud_agent_setup");
      // The Overview's card says the same.
      expect(
        getResourceAiAgentStatusSummary(
          statusOf(row(type), agentRow(type, cloudPosture(type))),
          descriptor,
        ).attention,
      ).toBe(attention!.title);
    });

    test("beside a gap that blocks something, it is one more step, under that gap's headline", () => {
      const attention: ResourceAiAttention | null = getResourceAiAttention(
        statusOf(
          row(type, { isAiInvestigationEnabled: false }),
          agentRow(type, cloudPosture(type)),
        ),
        descriptor,
      );

      expect(attention!.title).toBe(
        `OneUptime AI can't investigate this ${descriptor.noun}`,
      );
      expect(
        attention!.steps.map((step: { gap: ResourceAiAccessGap }): string => {
          return step.gap.code;
        }),
      ).toEqual(["investigation_disabled", "cloud_agent_changes_as_itself"]);
    });
  },
);

describe("never said of anything but a cloud account", () => {
  test.each(
    ALL_AI_RESOURCE_TYPES.filter((type: AiResourceType): boolean => {
      return !isCloudAiResourceType(type);
    }),
  )("%s", (type: AiResourceType) => {
    const posture: Record<string, unknown> = {
      ...cloudPosture(type),
      details: { cloudProvider: "azure" },
    };

    expect(
      isChangingAsItself({
        type,
        posture: posture as unknown as ResourceAiAgentPosture,
      }),
    ).toBe(false);
    expect(advice(statusOf(row(type), agentRow(type, posture)))).toBeNull();
  });

  test("the three clouds name their write paths as their agents report them", () => {
    expect(CLOUD_WRITE_PATH_DETAILS).toEqual({
      [AiResourceType.AwsAccount]: "awsWriteRoleArn",
      [AiResourceType.AzureSubscription]: "azureWriteIdentity",
      [AiResourceType.GoogleCloudProject]: "gcpWriteServiceAccount",
    });
  });
});
