import ResourceAiAgentService, {
  CLOUD_AGENT_REGISTRATION_ERROR_PREFIX,
  ResourceAiAgentRegistrationRefusedException,
} from "../../../Server/Services/ResourceAiAgentService";
import CloudAccountService from "../../../Server/Services/CloudAccountService";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A Cloud AI agent binds to a cloud account that is already connected, by
 * the id its own cloud reports (STS GetCallerIdentity, the subscription
 * its identity may read, the metadata server's project), and never creates
 * one. Its setup command pins the account it was written for; the cloud
 * still decides, and an agent that runs somewhere else is refused with the
 * reason kept on the account it was meant for.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROD_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const STAGING_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

type Resolve = (data: {
  projectId: ObjectID;
  resourceType: AiResourceType;
  identifier: string;
  resourceId: unknown;
}) => Promise<ObjectID>;

const resolve: Resolve = (
  ResourceAiAgentService as unknown as { resolveCloudAccountId: Resolve }
).resolveCloudAccountId.bind(ResourceAiAgentService);

function row(data: {
  id: ObjectID;
  provider: string;
  accountId: string;
  name?: string;
}): CloudAccount {
  const account: CloudAccount = new CloudAccount();
  account.id = data.id;
  account._id = data.id.toString();
  account.provider = data.provider as never;
  account.accountId = data.accountId;
  account.name = data.name || data.accountId;
  return account;
}

let accounts: Array<CloudAccount>;
let findAccount: jest.SpiedFunction<typeof CloudAccountService.findAccount>;
let updateOne: jest.SpiedFunction<typeof CloudAccountService.updateOneById>;
let updateBy: jest.SpiedFunction<typeof CloudAccountService.updateBy>;
let create: jest.SpiedFunction<typeof CloudAccountService.create>;

beforeEach(() => {
  accounts = [
    row({
      id: PROD_ID,
      provider: "aws",
      accountId: "111111111111",
      name: "prod",
    }),
    row({
      id: STAGING_ID,
      provider: "azure",
      accountId: "00000000-0000-0000-0000-0000000000ab",
    }),
  ];

  findAccount = jest
    .spyOn(CloudAccountService, "findAccount")
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        provider: string;
        accountId: string;
      }): Promise<CloudAccount | null> => {
        return (
          accounts.find((account: CloudAccount): boolean => {
            return (
              account.provider === data.provider &&
              (account.accountId || "").toLowerCase() ===
                data.accountId.toLowerCase()
            );
          }) || null
        );
      },
    );
  jest
    .spyOn(CloudAccountService, "findOneBy")
    .mockImplementation(
      async (data: {
        query: Record<string, unknown>;
      }): Promise<CloudAccount | null> => {
        return (
          accounts.find((account: CloudAccount): boolean => {
            return account._id === data.query["_id"];
          }) || null
        );
      },
    );
  updateOne = jest
    .spyOn(CloudAccountService, "updateOneById")
    .mockResolvedValue(undefined as never);
  updateBy = jest
    .spyOn(CloudAccountService, "updateBy")
    .mockResolvedValue(1 as never);
  create = jest.spyOn(CloudAccountService, "create");
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function refusal(
  data: Partial<Parameters<Resolve>[0]>,
): Promise<ResourceAiAgentRegistrationRefusedException> {
  try {
    await resolve({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      identifier: "111111111111",
      resourceId: undefined,
      ...data,
    });
  } catch (error) {
    expect(error).toBeInstanceOf(ResourceAiAgentRegistrationRefusedException);
    return error as ResourceAiAgentRegistrationRefusedException;
  }

  throw new Error("the registration was not refused");
}

describe("a Cloud AI agent binds to its connected account", () => {
  test("by the id its cloud reported", async () => {
    await expect(
      resolve({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.AwsAccount,
        identifier: "111111111111",
        resourceId: undefined,
      }),
    ).resolves.toEqual(PROD_ID);

    expect(findAccount.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      provider: "aws",
      accountId: "111111111111",
    });
  });

  test("an Azure subscription id in any case", async () => {
    await expect(
      resolve({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.AzureSubscription,
        identifier: "00000000-0000-0000-0000-0000000000AB",
        resourceId: undefined,
      }),
    ).resolves.toEqual(STAGING_ID);
  });

  test("a connection error left by an earlier refused agent is cleared, and only that one", async () => {
    await resolve({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      identifier: "111111111111",
      resourceId: PROD_ID.toString(),
    });

    expect(updateBy).toHaveBeenCalledTimes(1);
    const clear: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
    } = updateBy.mock.calls[0]![0] as never;
    expect(clear.query["_id"]).toBe(PROD_ID.toString());
    // Held to a registration error: a failed command's error stays.
    expect(clear.query["aiAccessLastError"]).toBeDefined();
    expect(clear.data).toEqual({ aiAccessLastError: null });
  });
});

describe("a Cloud AI agent is refused", () => {
  test("for an account no connection reads — and never creates one", async () => {
    const refused: ResourceAiAgentRegistrationRefusedException = await refusal({
      identifier: "999999999999",
    });

    expect(refused.reason).toBe("resource_not_found");
    expect(refused.message).toContain("AWS account 999999999999");
    expect(refused.message).toContain("Cloud → Connect");
    expect(refused.message).toContain("never adds one");
    expect(create).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  test("for an account of another cloud with the same id", async () => {
    const refused: ResourceAiAgentRegistrationRefusedException = await refusal({
      resourceType: AiResourceType.GoogleCloudProject,
      identifier: "prod-project-1",
    });

    expect(refused.reason).toBe("resource_not_found");
    expect(refused.message).toContain("Google Cloud project prod-project-1");
  });

  test.each([
    [AiResourceType.AwsAccount, "12345"],
    [AiResourceType.AwsAccount, "arn:aws:iam::111111111111:root"],
    [AiResourceType.AzureSubscription, "not-a-guid"],
    [AiResourceType.GoogleCloudProject, "Prod_Project"],
  ])(
    "%s with an identity %p that is not an account id",
    async (resourceType: AiResourceType, identifier: string) => {
      const refused: ResourceAiAgentRegistrationRefusedException =
        await refusal({ resourceType, identifier });

      expect(refused.reason).toBe("resource_identifier_invalid");
      expect(findAccount).not.toHaveBeenCalled();
    },
  );

  test("when it runs in another account than its command was written for, and that account says why", async () => {
    accounts.push(
      row({ id: STAGING_ID, provider: "aws", accountId: "222222222222" }),
    );

    const refused: ResourceAiAgentRegistrationRefusedException = await refusal({
      identifier: "222222222222",
      resourceId: PROD_ID.toString(),
    });

    expect(refused.reason).toBe("resource_not_found");
    expect(refused.message).toContain("AWS account 222222222222");
    expect(refused.message).toContain("AWS account 111111111111");
    expect(refused.message).toContain('("prod")');

    // The account it was meant for keeps the reason, for its page.
    expect(updateOne).toHaveBeenCalledTimes(1);
    const kept: { id: ObjectID; data: Record<string, unknown> } = updateOne.mock
      .calls[0]![0] as never;
    expect(kept.id).toEqual(PROD_ID);
    expect(String(kept.data["aiAccessLastError"])).toMatch(
      new RegExp(`^${CLOUD_AGENT_REGISTRATION_ERROR_PREFIX}`),
    );
    expect(updateBy).not.toHaveBeenCalled();
  });

  test("when the account it was set up for is gone", async () => {
    const refused: ResourceAiAgentRegistrationRefusedException = await refusal({
      identifier: "111111111111",
      resourceId: "44444444-4444-4444-8444-444444444444",
    });

    expect(refused.reason).toBe("resource_not_found");
    expect(refused.message).toContain("no longer in this OneUptime project");
    expect(updateOne).not.toHaveBeenCalled();
  });

  test("a pinned id that is not an id is no pin: the cloud's account decides", async () => {
    await expect(
      resolve({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.AwsAccount,
        identifier: "111111111111",
        resourceId: "prod",
      }),
    ).resolves.toEqual(PROD_ID);
  });
});
