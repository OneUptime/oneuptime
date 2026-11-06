import ResourceAiAgentService, {
  CLOUD_AGENT_REGISTRATION_ERROR_PREFIX,
  ResourceAiAgentRegistrationRefusedException,
} from "../../../Server/Services/ResourceAiAgentService";
import CloudAccountService from "../../../Server/Services/CloudAccountService";
import CloudAccountFeedService from "../../../Server/Services/CloudAccountFeedService";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import {
  CLOUD_AI_AGENT_INGESTION_KEY_REFUSED_MESSAGE,
  CloudAiAgentKeys,
} from "../../../Types/CloudConnection/CloudAiAgentKey";
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
 * one. Its setup command pins the account it was written for - and a key
 * of the account's own names it; the cloud still decides, and an agent that
 * runs somewhere else is refused with the reason kept on the account it was
 * meant for, and said once on that account's feed. Once the account's agent
 * connects with a key of its own, the project's ingestion key no longer
 * connects it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROD_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const STAGING_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

interface ResolveData {
  projectId: ObjectID;
  resourceType: AiResourceType;
  identifier: string;
  resourceId: unknown;
  registration?: { isOwnKey: boolean; agentVersion?: string } | undefined;
}

type Resolve = (data: ResolveData) => Promise<ObjectID>;

const resolveCloudAccountId: (data: Required<ResolveData>) => Promise<ObjectID> =
  (
    ResourceAiAgentService as unknown as {
      resolveCloudAccountId: (data: Required<ResolveData>) => Promise<ObjectID>;
    }
  ).resolveCloudAccountId.bind(ResourceAiAgentService);

// As registration calls it: with the project's ingestion key unless said otherwise.
const resolve: Resolve = (data: ResolveData): Promise<ObjectID> => {
  return resolveCloudAccountId({
    ...data,
    registration: data.registration || { isOwnKey: false },
  });
};

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
  account.projectId = PROJECT_ID;
  return account;
}

let accounts: Array<CloudAccount>;
// The keys each account keeps, by its id (none: set up before keys of their own).
let keysOf: Record<string, CloudAiAgentKeys | null>;
let findAccount: ReturnType<typeof jest.spyOn>;
let updateOne: ReturnType<typeof jest.spyOn>;
let updateBy: ReturnType<typeof jest.spyOn>;
let create: ReturnType<typeof jest.spyOn>;
let feed: ReturnType<typeof jest.spyOn>;

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
  keysOf = {};
  jest
    .spyOn(CloudAccountService, "findAccountOfAgentKey")
    .mockImplementation(
      async (
        id: ObjectID,
      ): Promise<{ account: CloudAccount; keys: CloudAiAgentKeys | null } | null> => {
        const account: CloudAccount | undefined = accounts.find(
          (row: CloudAccount): boolean => {
            return row._id === id.toString();
          },
        );

        return account
          ? { account, keys: keysOf[id.toString()] || null }
          : null;
      },
    );
  updateOne = jest
    .spyOn(CloudAccountService, "updateOneById")
    .mockImplementation(
      async (data: {
        id: ObjectID;
        data: Record<string, unknown>;
      }): Promise<void> => {
        // What the account keeps, as a later read of it sees it.
        const account: CloudAccount | undefined = accounts.find(
          (row: CloudAccount): boolean => {
            return row._id === data.id.toString();
          },
        );

        if (account && typeof data.data["aiAccessLastError"] === "string") {
          account.aiAccessLastError = data.data["aiAccessLastError"];
        }
      },
    );
  feed = jest
    .spyOn(CloudAccountFeedService, "createCloudAccountFeedItem")
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

/*
 * A refused Cloud AI agent is noted where an admin looks: the account it
 * was set up for keeps why (its AI agent page and card show it) and says so
 * on its feed - once for each reason, however often the agent retries, and
 * with nothing a key could be read from.
 */
describe("a refused Cloud AI agent is noted on the account it was set up for", () => {
  // The same refusal as above: it runs in another account than its command was for.
  async function refuseAnotherAccount(
    registration: { isOwnKey: boolean; agentVersion?: string } = {
      isOwnKey: true,
      agentVersion: "14.0.110",
    },
  ): Promise<ResourceAiAgentRegistrationRefusedException> {
    return await refusal({
      identifier: "222222222222",
      resourceId: PROD_ID.toString(),
      registration,
    });
  }

  beforeEach(() => {
    accounts.push(
      row({ id: STAGING_ID, provider: "aws", accountId: "222222222222" }),
    );
  });

  test("with a feed entry that says what was refused and why", async () => {
    const refused: ResourceAiAgentRegistrationRefusedException =
      await refuseAnotherAccount();

    expect(feed).toHaveBeenCalledTimes(1);
    const item: Record<string, unknown> = feed.mock.calls[0]![0] as never;

    expect(item["cloudAccountId"]).toEqual(PROD_ID);
    expect(item["projectId"]).toEqual(PROJECT_ID);
    expect(String(item["feedInfoInMarkdown"])).toContain(
      "OneUptime refused a Cloud AI agent that tried to connect as this account's agent",
    );
    // The refusal's own words: where it runs, and what to do.
    expect(String(item["feedInfoInMarkdown"])).toContain("AWS account 222222222222");
    expect(String(item["feedInfoInMarkdown"])).toContain("AWS account 111111111111");
    expect(refused.message.length).toBeGreaterThan(0);

    const more: string = String(item["moreInformationInMarkdown"]);

    expect(more).toContain("**Where it says it runs**: AWS account 222222222222");
    expect(more).toContain("**Connected with**: a key made for this account's agent");
    expect(more).toContain("**Agent version**: 14.0.110");
  });

  test("an agent with the project's ingestion key is said to have come with it", async () => {
    await refuseAnotherAccount({ isOwnKey: false });

    const more: string = String(
      (feed.mock.calls[0]![0] as Record<string, unknown>)[
        "moreInformationInMarkdown"
      ],
    );

    expect(more).toContain(
      "**Connected with**: the project's telemetry ingestion key",
    );
    expect(more).toContain("**Agent version**: unknown");
  });

  test("once for each reason: the agent retrying the same refusal writes nothing more", async () => {
    await refuseAnotherAccount();
    await refuseAnotherAccount();
    await refuseAnotherAccount();

    expect(feed).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  test("a new reason is noted again", async () => {
    await refuseAnotherAccount();

    // The agent moved on to a third account: a different refusal.
    accounts.push(
      row({
        id: new ObjectID("55555555-5555-4555-8555-555555555555"),
        provider: "aws",
        accountId: "333333333333",
      }),
    );
    await refusal({
      identifier: "333333333333",
      resourceId: PROD_ID.toString(),
      registration: { isOwnKey: true },
    });

    expect(feed).toHaveBeenCalledTimes(2);
  });

  test("nothing that reads like a key reaches the feed", async () => {
    await refuseAnotherAccount();
    await refuseAnotherAccount({ isOwnKey: false });

    for (const call of feed.mock.calls) {
      const text: string = JSON.stringify(call[0]);

      expect(text).not.toContain("ouca_");
      expect(text).not.toContain("agentKey");
      expect(text).not.toContain("x-oneuptime-token");
    }
  });

  test("a feed that cannot be written never turns the refusal into a 500", async () => {
    feed.mockRejectedValue(new Error("feed is down") as never);

    const refused: ResourceAiAgentRegistrationRefusedException =
      await refuseAnotherAccount();

    expect(refused.reason).toBe("resource_not_found");
  });
});

/*
 * Since agents have keys of their own, the project's telemetry ingestion
 * key connects a cloud account's agent only while that account's agent
 * never connected with one: an agent set up before keeps working until its
 * setup command runs again. Once one connected - or the agent was reset -
 * the ingestion key is refused for the account, whoever holds it.
 */
describe("the project's ingestion key, once the account's agent has a key of its own", () => {
  test("still connects an agent set up before keys of their own", async () => {
    await expect(resolve({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      identifier: "111111111111",
      resourceId: PROD_ID.toString(),
    })).resolves.toEqual(PROD_ID);
  });

  test("still connects while a key was only made, and never connected", async () => {
    keysOf[PROD_ID.toString()] = {
      current: null,
      pending: [
        { hash: "a".repeat(64), madeAt: new Date().toISOString() },
      ],
      isOwnKeyRequired: false,
    };

    await expect(resolve({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      identifier: "111111111111",
      resourceId: PROD_ID.toString(),
    })).resolves.toEqual(PROD_ID);
  });

  test.each([
    [
      "a key of its own connected",
      {
        current: { hash: "b".repeat(64), madeAt: new Date().toISOString() },
        pending: [],
        isOwnKeyRequired: true,
      },
    ],
    [
      "the agent was reset",
      {
        current: null,
        pending: [],
        isOwnKeyRequired: true,
        revokedAt: new Date().toISOString(),
      },
    ],
  ])(
    "is refused once %s, and the account says so",
    async (_what: string, keys: CloudAiAgentKeys) => {
      keysOf[PROD_ID.toString()] = keys;

      const refused: ResourceAiAgentRegistrationRefusedException = await refusal(
        { identifier: "111111111111", resourceId: PROD_ID.toString() },
      );

      expect(refused.reason).toBe("agent_key_required");
      expect(refused.message).toBe(CLOUD_AI_AGENT_INGESTION_KEY_REFUSED_MESSAGE);
      expect(refused.message).toContain("Change on the account's AI agent page");
      expect(feed).toHaveBeenCalledTimes(1);
      expect(
        String((feed.mock.calls[0]![0] as Record<string, unknown>)["moreInformationInMarkdown"]),
      ).toContain("the project's telemetry ingestion key");
      // The account keeps why: its page shows it.
      expect(
        accounts.find((account: CloudAccount): boolean => {
          return account._id === PROD_ID.toString();
        })?.aiAccessLastError,
      ).toBe(
        `${CLOUD_AGENT_REGISTRATION_ERROR_PREFIX}${CLOUD_AI_AGENT_INGESTION_KEY_REFUSED_MESSAGE}`,
      );
      // And no earlier error of its is cleared.
      expect(updateBy).not.toHaveBeenCalled();
    },
  );

  test("whatever the agent says it was set up for: the account its cloud names decides", async () => {
    keysOf[PROD_ID.toString()] = {
      current: { hash: "b".repeat(64), madeAt: new Date().toISOString() },
      pending: [],
      isOwnKeyRequired: true,
    };

    // No pin at all: the account is found by the cloud's identity, and still refused.
    expect(
      (await refusal({ identifier: "111111111111" })).reason,
    ).toBe("agent_key_required");
  });

  test("the account's own key is never refused by this rule", async () => {
    keysOf[PROD_ID.toString()] = {
      current: { hash: "b".repeat(64), madeAt: new Date().toISOString() },
      pending: [],
      isOwnKeyRequired: true,
    };

    await expect(resolve({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      identifier: "111111111111",
      resourceId: PROD_ID.toString(),
      registration: { isOwnKey: true },
    })).resolves.toEqual(PROD_ID);
  });

  test("another account's own key does not change it: each account is its own", async () => {
    keysOf[STAGING_ID.toString()] = {
      current: { hash: "b".repeat(64), madeAt: new Date().toISOString() },
      pending: [],
      isOwnKeyRequired: true,
    };

    await expect(resolve({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      identifier: "111111111111",
      resourceId: PROD_ID.toString(),
    })).resolves.toEqual(PROD_ID);
  });
});
