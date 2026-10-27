import ResourceAiAccessService, {
  ResourceAiAccessProjectGates,
  ResourceAiAccessRow,
} from "../../../Server/Services/ResourceAiAccessService";
import CloudAccountService from "../../../Server/Services/CloudAccountService";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType, {
  CLOUD_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGap,
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A cloud account's AI access: an investigation reads the account live on
 * the server, through its read-only connection, so it needs the
 * connection and not the agent; fixes run on the Cloud AI agent, so they
 * need the agent. Incidents and alerts reach an account through the cloud
 * resources they link.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ACCOUNT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const GATES: ResourceAiAccessProjectGates = {
  isAiEnabled: true,
  hasLlmProvider: true,
  aiBalanceBlocker: null,
} as unknown as ResourceAiAccessProjectGates;

function row(
  resourceType: AiResourceType,
  overrides: Partial<ResourceAiAccessRow> = {},
): ResourceAiAccessRow {
  return {
    resourceType,
    id: ACCOUNT_ID,
    projectId: PROJECT_ID,
    name: "prod",
    identifier: "123456789012",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Disabled,
    aiCommandAllowlist: [],
    isArchived: false,
    hasCloudConnection: true,
    ...overrides,
  };
}

function codes(status: ResourceAiAccessStatus): Array<string> {
  return status.gaps.map((gap: ResourceAiAccessGap): string => {
    return gap.code;
  });
}

function build(
  resource: ResourceAiAccessRow,
  agentRow: ResourceAiAgent | null = null,
): ResourceAiAccessStatus {
  return ResourceAiAccessService.buildStatus({
    resource,
    agentRow,
    gates: GATES,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a cloud account's readiness", () => {
  test.each(CLOUD_AI_RESOURCE_TYPES)(
    "%s: investigates without an agent, through its connection",
    (type: AiResourceType) => {
      const status: ResourceAiAccessStatus = build(row(type));

      expect(status.isInvestigationReady).toBe(true);
      expect(status.isRemediationReady).toBe(false);

      const agentGap: ResourceAiAccessGap | undefined = status.gaps.find(
        (gap: ResourceAiAccessGap): boolean => {
          return gap.code === "ai_agent_not_connected";
        },
      );

      // The missing agent blocks only fixes.
      expect(agentGap?.blocksInvestigation).toBe(false);
      expect(agentGap?.blocksRemediation).toBe(true);
      expect(agentGap?.nextStep).toContain('"Let AI fix problems"');
    },
  );

  test("without a connection, an investigation has nothing to read with", () => {
    const status: ResourceAiAccessStatus = build(
      row(AiResourceType.AwsAccount, { hasCloudConnection: false }),
    );

    expect(codes(status)).toContain("cloud_connection_missing");
    expect(status.isInvestigationReady).toBe(false);

    const gap: ResourceAiAccessGap = status.gaps.find(
      (candidate: ResourceAiAccessGap): boolean => {
        return candidate.code === "cloud_connection_missing";
      },
    )!;

    expect(gap.blocksInvestigation).toBe(true);
    expect(gap.blocksRemediation).toBe(false);
    expect(gap.title).toBe("No cloud connection reads this AWS account");
    expect(gap.nextStep).toContain("Cloud → Connect");
  });

  test("an agent offline blocks fixes, never the investigation", () => {
    const agent: ResourceAiAgent = new ResourceAiAgent();
    agent.id = ObjectID.generate();
    agent._id = agent.id.toString();
    agent.projectId = PROJECT_ID;
    agent.resourceType = AiResourceType.AwsAccount;
    agent.resourceId = ACCOUNT_ID;
    agent.connectionStatus = "connected";
    agent.lastAliveAt = new Date(Date.now() - 60 * 60 * 1000);

    const status: ResourceAiAccessStatus = build(
      row(AiResourceType.AwsAccount, {
        aiRemediationMode: ResourceAiRemediationMode.Automatic,
      }),
      agent,
    );

    expect(codes(status)).toContain("ai_agent_offline");
    expect(status.isInvestigationReady).toBe(true);
    expect(status.isRemediationReady).toBe(false);
  });

  test("a resource of another kind still needs its agent to investigate", () => {
    const status: ResourceAiAccessStatus = build(
      row(AiResourceType.DockerHost, { hasCloudConnection: undefined }),
    );

    expect(status.isInvestigationReady).toBe(false);
    expect(codes(status)).not.toContain("cloud_connection_missing");
  });
});

describe("the cloud accounts of the cloud resources a subject links", () => {
  function resource(
    id: string,
    provider: string,
    accountId: string,
  ): CloudResource {
    const model: CloudResource = new CloudResource();
    model.id = new ObjectID(id);
    model._id = id;
    model.cloudProvider = provider;
    model.cloudAccountId = accountId;
    return model;
  }

  function account(id: ObjectID, accountId: string): CloudAccount {
    const model: CloudAccount = new CloudAccount();
    model.id = id;
    model._id = id.toString();
    model.accountId = accountId;
    return model;
  }

  test("are each resource's account of its cloud, each once, in the order they are named", async () => {
    const awsA: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const awsB: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    const azure: ObjectID = new ObjectID(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );

    jest
      .spyOn(CloudResourceService, "findBy")
      .mockResolvedValue([
        resource("11111111-0000-4000-8000-000000000001", "aws", "222222222222"),
        resource("11111111-0000-4000-8000-000000000002", "aws", "111111111111"),
        resource("11111111-0000-4000-8000-000000000003", "aws", "222222222222"),
        resource(
          "11111111-0000-4000-8000-000000000004",
          "azure",
          "00000000-0000-0000-0000-0000000000AB",
        ),
        resource("11111111-0000-4000-8000-000000000005", "", ""),
      ]);
    const accountFind: jest.SpiedFunction<typeof CloudAccountService.findBy> =
      jest
        .spyOn(CloudAccountService, "findBy")
        .mockImplementation(
          async (data: {
            query: Record<string, unknown>;
          }): Promise<Array<CloudAccount>> => {
            return data.query["provider"] === "aws"
              ? [account(awsA, "111111111111"), account(awsB, "222222222222")]
              : [account(azure, "00000000-0000-0000-0000-0000000000ab")];
          },
        );

    const byType: Map<
      AiResourceType,
      Array<string>
    > = await ResourceAiAccessService.getCloudAccountsOfResources({
      projectId: PROJECT_ID,
      cloudResourceIds: [
        "11111111-0000-4000-8000-000000000001",
        "11111111-0000-4000-8000-000000000002",
        "11111111-0000-4000-8000-000000000003",
        "11111111-0000-4000-8000-000000000004",
        "11111111-0000-4000-8000-000000000005",
        "not-an-id",
      ],
    });

    expect(byType.get(AiResourceType.AwsAccount)).toEqual([
      awsB.toString(),
      awsA.toString(),
    ]);
    // The account's id read from a resource in another case is its account still.
    expect(byType.get(AiResourceType.AzureSubscription)).toEqual([
      azure.toString(),
    ]);
    expect(byType.has(AiResourceType.GoogleCloudProject)).toBe(false);

    // One read per cloud with accounts, in the subject's project, as root.
    expect(accountFind).toHaveBeenCalledTimes(2);
    for (const call of accountFind.mock.calls) {
      expect(call[0].query["projectId"]).toBe(PROJECT_ID);
      expect(call[0].props).toEqual({ isRoot: true });
    }
  });

  test("no resources, no reads", async () => {
    const resourceFind: jest.SpiedFunction<typeof CloudResourceService.findBy> =
      jest.spyOn(CloudResourceService, "findBy");

    const byType: Map<
      AiResourceType,
      Array<string>
    > = await ResourceAiAccessService.getCloudAccountsOfResources({
      projectId: PROJECT_ID,
      cloudResourceIds: [],
    });

    expect(byType.size).toBe(0);
    expect(resourceFind).not.toHaveBeenCalled();
  });
});

describe("a cloud account's row", () => {
  test("is read among its cloud's accounts only, from a table without an archive", async () => {
    const find: jest.SpiedFunction<typeof CloudAccountService.findBy> = jest
      .spyOn(CloudAccountService, "findBy")
      .mockResolvedValue([]);

    await ResourceAiAccessService.loadResources({
      projectId: PROJECT_ID,
      resources: [
        {
          resourceType: AiResourceType.GoogleCloudProject,
          resourceId: ACCOUNT_ID.toString(),
        },
      ],
      excludeArchived: true,
    });

    const query: Record<string, unknown> = find.mock.calls[0]![0]
      .query as Record<string, unknown>;
    const select: Record<string, unknown> = find.mock.calls[0]![0]
      .select as Record<string, unknown>;

    expect(query["provider"]).toBe("gcp");
    expect(query["isArchived"]).toBeUndefined();
    expect(select["isArchived"]).toBeUndefined();
    expect(select["accountId"]).toBe(true);
    expect(select["cloudConnectionId"]).toBe(true);
  });

  test("names the account, identifies it by its cloud's id, and knows its connection", () => {
    const parsed: ResourceAiAccessRow | null = ResourceAiAccessService.toRow(
      AiResourceType.AwsAccount,
      {
        _id: ACCOUNT_ID.toString(),
        projectId: PROJECT_ID,
        name: "prod",
        accountId: "123456789012",
        cloudConnectionId: ObjectID.generate(),
        isAiInvestigationEnabled: true,
        aiRemediationMode: "Automatic",
      },
      { projectId: PROJECT_ID },
    );

    expect(parsed?.identifier).toBe("123456789012");
    expect(parsed?.hasCloudConnection).toBe(true);
    expect(parsed?.aiRemediationMode).toBe(ResourceAiRemediationMode.Automatic);
  });
});
