import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import CloudAccountFeedService from "../../../Server/Services/CloudAccountFeedService";
import CloudAccountService from "../../../Server/Services/CloudAccountService";
import ResourceAiAgentService, {
  ResourceAiAgentRegistrationKey,
  ResourceAiAgentRegistrationRefusedException,
  ResourceAiAgentRegistrationResult,
} from "../../../Server/Services/ResourceAiAgentService";
import UserService from "../../../Server/Services/UserService";
import CloudAiAgentKeyAuthenticator, {
  CloudAiAgentKeyAuthentication,
} from "../../../Server/Utils/CloudConnection/CloudAiAgentKeyAuthentication";
import CloudAiAgentKeyHashing from "../../../Server/Utils/CloudConnection/CloudAiAgentKeyHashing";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_AI_AGENT_INGESTION_KEY_REFUSED_MESSAGE,
  CLOUD_AI_AGENT_KEY_REFUSED_MESSAGE,
  CloudAiAgentKeyResponse,
  readCloudAiAgentKeys,
} from "../../../Types/CloudConnection/CloudAiAgentKey";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A Cloud AI agent registering with its account's own key, end to end
 * through ResourceAiAgentService.register and resetAgent, over a cloud
 * account and its agent's row kept in memory:
 *
 *  - the key registers that account's agent and nothing else: another
 *    resource type is refused, and the key's account is the registration's
 *    pin whatever the body says - an agent whose cloud names another account
 *    is refused, and the account says so on its feed;
 *  - a pending key becomes the agent's key once its registration is
 *    admitted (never on a refused one), the key it replaced stops working,
 *    the feed says who made the new key, and from then on the project's
 *    ingestion key no longer connects the account's agent;
 *  - Reset agent revokes every key: neither the old key nor the ingestion
 *    key connects the agent again until a new key does;
 *  - a key revoked between its check and the registration's write is
 *    refused like any wrong key, and the agent's row is not re-keyed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ACCOUNT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_ACCOUNT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const INGESTION_KEY_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const AWS_ACCOUNT: string = "111111111111";

interface AccountRow {
  id: ObjectID;
  provider: CloudProvider;
  accountId: string;
  aiAgentKeys: JSONObject | null;
  aiAccessLastError: string | null;
}

let accounts: Array<AccountRow>;
// The account's agent row, once one registered.
let agentRow: ResourceAiAgent | null;
let feedItems: Array<Record<string, unknown>>;

function accountOf(id: unknown): AccountRow | undefined {
  return accounts.find((row: AccountRow): boolean => {
    return row.id.toString() === String(id);
  });
}

function asModel(row: AccountRow): CloudAccount {
  const account: CloudAccount = new CloudAccount();
  account.id = row.id;
  account._id = row.id.toString();
  account.projectId = PROJECT_ID;
  account.provider = row.provider;
  account.accountId = row.accountId;
  account.name = `account ${row.accountId}`;
  account.isAiInvestigationEnabled = true;
  account.aiAccessLastError = row.aiAccessLastError || (undefined as never);
  account.aiAgentKeys = row.aiAgentKeys
    ? (JSON.parse(JSON.stringify(row.aiAgentKeys)) as JSONObject)
    : (undefined as never);
  return account;
}

beforeEach(() => {
  accounts = [
    {
      id: ACCOUNT_ID,
      provider: CloudProvider.AWS,
      accountId: AWS_ACCOUNT,
      aiAgentKeys: null,
      aiAccessLastError: null,
    },
    {
      id: OTHER_ACCOUNT_ID,
      provider: CloudProvider.AWS,
      accountId: "222222222222",
      aiAgentKeys: null,
      aiAccessLastError: null,
    },
  ];
  agentRow = null;
  feedItems = [];

  // ---- The cloud accounts ------------------------------------------------------
  jest
    .spyOn(CloudAccountService, "findAccount")
    .mockImplementation(
      async (data: {
        provider: CloudProvider;
        accountId: string;
      }): Promise<CloudAccount | null> => {
        const row: AccountRow | undefined = accounts.find(
          (account: AccountRow): boolean => {
            return (
              account.provider === data.provider &&
              account.accountId === data.accountId.trim()
            );
          },
        );

        return row ? asModel(row) : null;
      },
    );
  jest
    .spyOn(CloudAccountService, "findOneBy")
    .mockImplementation(
      async (data: { query: Record<string, unknown> }): Promise<
        CloudAccount | null
      > => {
        const row: AccountRow | undefined = accountOf(data.query["_id"]);
        return row ? asModel(row) : null;
      },
    );
  jest
    .spyOn(CloudAccountService, "findOneById")
    .mockImplementation(
      async (data: { id: ObjectID }): Promise<CloudAccount | null> => {
        const row: AccountRow | undefined = accountOf(data.id);
        return row ? asModel(row) : null;
      },
    );
  jest
    .spyOn(CloudAccountService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation(
      async (data: {
        id: ObjectID;
        data: Record<string, unknown>;
        expectedData: Record<string, unknown>;
      }): Promise<boolean> => {
        const row: AccountRow | undefined = accountOf(data.id);

        if (
          !row ||
          JSON.stringify(data.expectedData["aiAgentKeys"] ?? null) !==
            JSON.stringify(row.aiAgentKeys)
        ) {
          return false;
        }

        row.aiAgentKeys = data.data["aiAgentKeys"] as JSONObject;
        return true;
      },
    );
  jest
    .spyOn(CloudAccountService, "updateColumnsByIdWithoutHooks")
    .mockImplementation(
      async (data: {
        id: ObjectID;
        data: Record<string, unknown>;
      }): Promise<void> => {
        const row: AccountRow | undefined = accountOf(data.id);

        if (row && "aiAgentKeys" in data.data) {
          row.aiAgentKeys = data.data["aiAgentKeys"] as JSONObject;
        }
      },
    );
  jest
    .spyOn(CloudAccountService, "updateOneById")
    .mockImplementation(
      async (data: {
        id: ObjectID;
        data: Record<string, unknown>;
      }): Promise<void> => {
        const row: AccountRow | undefined = accountOf(data.id);

        if (row && typeof data.data["aiAccessLastError"] === "string") {
          row.aiAccessLastError = data.data["aiAccessLastError"];
        }
      },
    );
  jest
    .spyOn(CloudAccountService, "updateBy")
    .mockImplementation(
      async (data: { query: Record<string, unknown> }): Promise<number> => {
        const row: AccountRow | undefined = accountOf(data.query["_id"]);

        if (row) {
          row.aiAccessLastError = null;
        }

        return 1;
      },
    );
  // The first-connection defaults: nothing to change here.
  jest.spyOn(CloudAccountService, "updateOneBy").mockResolvedValue(0 as never);
  jest
    .spyOn(CloudAccountFeedService, "createCloudAccountFeedItem")
    .mockImplementation(async (item: unknown): Promise<void> => {
      feedItems.push(item as Record<string, unknown>);
    });
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(FeedMarkdown.asMarkdown("[Maya Chen](/users/maya)") as never);
  jest
    .spyOn(AutoRemediationRuleEngineService, "onAgentConnected")
    .mockResolvedValue(undefined as never);
  jest.spyOn(GlobalCache, "incrementIfBelow").mockResolvedValue(1 as never);

  // ---- The account's agent row -----------------------------------------------
  jest
    .spyOn(ResourceAiAgentService, "findOneBy")
    .mockImplementation(async (): Promise<ResourceAiAgent | null> => {
      return agentRow;
    });
  jest
    .spyOn(ResourceAiAgentService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  jest
    .spyOn(ResourceAiAgentService, "create")
    .mockImplementation(
      async (data: { data: ResourceAiAgent }): Promise<ResourceAiAgent> => {
        const row: ResourceAiAgent = data.data;
        row.id = new ObjectID("77777777-7777-4777-8777-777777777777");
        row._id = row.id.toString();
        agentRow = row;
        return row;
      },
    );
  jest
    .spyOn(ResourceAiAgentService, "updateOneById")
    .mockImplementation(
      async (data: { data: Record<string, unknown> }): Promise<void> => {
        if (agentRow) {
          Object.assign(agentRow, data.data);
        }
      },
    );
  jest
    .spyOn(ResourceAiAgentService, "updateColumnsByIdWithoutHooks")
    .mockImplementation(
      async (data: { data: Record<string, unknown> }): Promise<void> => {
        if (agentRow) {
          Object.assign(agentRow, data.data);
        }
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function makeKey(): Promise<string> {
  const made: CloudAiAgentKeyResponse = await CloudAccountService.makeAiAgentKey(
    {
      cloudAccountId: ACCOUNT_ID,
      userId: USER_ID,
      now: new Date(),
    },
  );

  return made.agentKey;
}

// What the registration middleware hands the service for a key.
async function keyOf(key: string): Promise<ResourceAiAgentRegistrationKey> {
  const checked: CloudAiAgentKeyAuthentication =
    await CloudAiAgentKeyAuthenticator.authenticate({
      key,
      now: new Date(),
    });

  if (!checked.isAuthorized) {
    throw new Error(`the key was refused: ${checked.message}`);
  }

  return {
    cloudAccountId: checked.cloudAccountId,
    keyHash: checked.keyHash,
    match: checked.match,
  };
}

async function register(data: {
  key?: ResourceAiAgentRegistrationKey | undefined;
  identifier?: string | undefined;
  resourceType?: AiResourceType | undefined;
  resourceId?: string | undefined;
  previousAgentKey?: string | undefined;
}): Promise<ResourceAiAgentRegistrationResult> {
  return await ResourceAiAgentService.register({
    projectId: PROJECT_ID,
    resourceType: data.resourceType || AiResourceType.AwsAccount,
    resourceIdentifier: data.identifier || AWS_ACCOUNT,
    resourceId: data.resourceId,
    agentVersion: "14.0.110",
    previousAgentKey: data.previousAgentKey,
    posture: {},
    ...(data.key
      ? { cloudAiAgentKey: data.key }
      : { ingestionKeyId: INGESTION_KEY_ID }),
  });
}

async function refusalOf(
  registration: Promise<unknown>,
): Promise<ResourceAiAgentRegistrationRefusedException> {
  try {
    await registration;
  } catch (error) {
    expect(error).toBeInstanceOf(ResourceAiAgentRegistrationRefusedException);
    return error as ResourceAiAgentRegistrationRefusedException;
  }

  throw new Error("the registration was not refused");
}

// The agent stopped: its row reads as signed off, so the next one is admitted.
function signOff(): void {
  if (agentRow) {
    agentRow.connectionStatus = "disconnected";
  }
}

describe("a key registers its account's agent, and nothing else", () => {
  test("the account's agent connects with it, and nothing of an ingestion key is kept", async () => {
    const result: ResourceAiAgentRegistrationResult = await register({
      key: await keyOf(await makeKey()),
    });

    expect(result.resourceId).toEqual(ACCOUNT_ID);
    expect(result.admission).toBe("created");
    expect(agentRow?.registeredWithIngestionKeyId).toBeUndefined();
  });

  test.each([
    AiResourceType.DockerHost,
    AiResourceType.Host,
    AiResourceType.DatabaseServer,
  ])("an agent that says it serves a %s is refused", async (type: AiResourceType) => {
    const refused: ResourceAiAgentRegistrationRefusedException = await refusalOf(
      register({ key: await keyOf(await makeKey()), resourceType: type }),
    );

    expect(refused.reason).toBe("resource_type_invalid");
    expect(refused.message).toContain("made for a cloud account's Cloud AI agent");
    expect(agentRow).toBeNull();
  });

  test("the key's account is the pin, whatever the body says it was set up for", async () => {
    const result: ResourceAiAgentRegistrationResult = await register({
      key: await keyOf(await makeKey()),
      resourceId: OTHER_ACCOUNT_ID.toString(),
    });

    expect(result.resourceId).toEqual(ACCOUNT_ID);
  });

  test("an agent whose cloud names another account is refused, and the key's account says so on its feed", async () => {
    const refused: ResourceAiAgentRegistrationRefusedException = await refusalOf(
      register({ key: await keyOf(await makeKey()), identifier: "222222222222" }),
    );

    expect(refused.reason).toBe("resource_not_found");
    expect(refused.message).toContain("AWS account 222222222222");
    expect(feedItems).toHaveLength(1);
    expect(feedItems[0]!["cloudAccountId"]).toEqual(ACCOUNT_ID);
    expect(String(feedItems[0]!["moreInformationInMarkdown"])).toContain(
      "a key made for this account's agent",
    );
    expect(accountOf(ACCOUNT_ID)?.aiAccessLastError).toContain(
      "AWS account 222222222222",
    );
    // Not the agent's key yet: a refused registration takes nothing.
    expect(readCloudAiAgentKeys(accountOf(ACCOUNT_ID)?.aiAgentKeys)?.current).toBeNull();
  });
});

describe("a new key becomes the agent's key once it connects", () => {
  test("the key it replaced no longer connects, the ingestion key neither, and the feed says who made the new one", async () => {
    const first: string = await makeKey();
    await register({ key: await keyOf(first) });
    signOff();

    const second: string = await makeKey();

    // The first still works until the second connects: opening the dialog disconnects nothing.
    expect(
      (await CloudAiAgentKeyAuthenticator.authenticate({ key: first, now: new Date() }))
        .isAuthorized,
    ).toBe(true);

    const result: ResourceAiAgentRegistrationResult = await register({
      key: await keyOf(second),
    });

    expect(result.admission).toBe("signed_off");
    expect(
      readCloudAiAgentKeys(accountOf(ACCOUNT_ID)?.aiAgentKeys)?.current?.hash,
    ).toBe(CloudAiAgentKeyHashing.hash(second));
    expect(
      (await CloudAiAgentKeyAuthenticator.authenticate({ key: first, now: new Date() }))
        .isAuthorized,
    ).toBe(false);

    const keyItem: Record<string, unknown> | undefined = feedItems.find(
      (item: Record<string, unknown>): boolean => {
        return String(item["feedInfoInMarkdown"]).startsWith("🔑");
      },
    );

    expect(String(keyItem?.["feedInfoInMarkdown"])).toBe(
      "🔑 The Cloud AI agent connected with a new key, made by **[Maya Chen](/users/maya)**. The key it connected with before no longer works.",
    );

    // And the project's ingestion key no longer connects it.
    signOff();
    const refused: ResourceAiAgentRegistrationRefusedException = await refusalOf(
      register({}),
    );
    expect(refused.reason).toBe("agent_key_required");
    expect(refused.message).toBe(CLOUD_AI_AGENT_INGESTION_KEY_REFUSED_MESSAGE);
  });

  test("an agent moving from the ingestion key to its own: the feed says the ingestion key no longer connects it", async () => {
    // Set up before keys of their own.
    await register({});
    expect(agentRow?.registeredWithIngestionKeyId).toEqual(INGESTION_KEY_ID);
    signOff();

    await register({ key: await keyOf(await makeKey()) });

    expect(agentRow?.registeredWithIngestionKeyId).toBeNull();
    expect(
      feedItems
        .map((item: Record<string, unknown>): string => {
          return String(item["feedInfoInMarkdown"]);
        })
        .find((text: string): boolean => {
          return text.startsWith("🔑");
        }),
    ).toBe(
      "🔑 The Cloud AI agent now connects with a key of its own, made by **[Maya Chen](/users/maya)**, which connects this agent and nothing else. The project's telemetry ingestion key no longer connects it.",
    );
  });

  test("an account's first agent says it connected once, with no second item about its key", async () => {
    await register({ key: await keyOf(await makeKey()) });

    expect(
      feedItems.filter((item: Record<string, unknown>): boolean => {
        return String(item["feedInfoInMarkdown"]).startsWith("🔑");
      }),
    ).toEqual([]);
  });

  test("a registration refused as a second live agent takes nothing: the pending key stays pending", async () => {
    await register({ key: await keyOf(await makeKey()) });

    // The first agent still answers; a second, with a newer key, is refused its place.
    const newer: string = await makeKey();
    const refused: ResourceAiAgentRegistrationRefusedException = await refusalOf(
      register({ key: await keyOf(newer) }),
    );

    expect(refused.reason).toBe("previous_instance_online");
    expect(
      readCloudAiAgentKeys(accountOf(ACCOUNT_ID)?.aiAgentKeys)?.pending.map(
        (record: { hash: string }): string => {
          return record.hash;
        },
      ),
    ).toContain(CloudAiAgentKeyHashing.hash(newer));
  });

  test("a key revoked between its check and the write is refused, and the agent's row is not re-keyed", async () => {
    const first: string = await makeKey();
    await register({ key: await keyOf(first) });
    signOff();

    const checked: ResourceAiAgentRegistrationKey = await keyOf(first);
    const keyHashBefore: unknown = agentRow?.keyHash;

    // Reset agent lands after the middleware checked the key.
    await CloudAccountService.revokeAiAgentKeys({
      cloudAccountId: ACCOUNT_ID,
      now: new Date(),
    });

    await expect(register({ key: checked })).rejects.toThrow(
      NotAuthenticatedException,
    );
    await expect(register({ key: checked })).rejects.toThrow(
      CLOUD_AI_AGENT_KEY_REFUSED_MESSAGE,
    );
    expect(agentRow?.keyHash).toBe(keyHashBefore);
  });
});

describe("Reset agent", () => {
  test("revokes the agent's key: neither it nor the ingestion key connects the agent again, and the feed says how it comes back", async () => {
    const key: string = await makeKey();
    await register({ key: await keyOf(key) });

    await ResourceAiAgentService.resetAgent({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      resourceId: ACCOUNT_ID,
      userId: USER_ID,
    });

    expect(agentRow?.keyHash).toBeNull();
    expect(
      (await CloudAiAgentKeyAuthenticator.authenticate({ key, now: new Date() }))
        .isAuthorized,
    ).toBe(false);
    expect((await refusalOf(register({}))).reason).toBe("agent_key_required");

    const reset: Record<string, unknown> | undefined = feedItems.find(
      (item: Record<string, unknown>): boolean => {
        return String(item["feedInfoInMarkdown"]).startsWith("🔄");
      },
    );

    expect(String(reset?.["feedInfoInMarkdown"])).toBe(
      "🔄 The Cloud AI agent was reset by **[Maya Chen](/users/maya)**. Its key no longer works, and it stays disconnected until its setup command runs again: Change on the AWS account's AI agent page shows it, with a new key.",
    );

    // A new key connects it again.
    const result: ResourceAiAgentRegistrationResult = await register({
      key: await keyOf(await makeKey()),
    });
    expect(result.admission).toBe("reset");
  });

  test("an agent set up before keys of their own: reset, the ingestion key no longer connects it either", async () => {
    await register({});

    await ResourceAiAgentService.resetAgent({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      resourceId: ACCOUNT_ID,
      userId: USER_ID,
    });

    expect((await refusalOf(register({}))).reason).toBe("agent_key_required");
    expect(readCloudAiAgentKeys(accountOf(ACCOUNT_ID)?.aiAgentKeys)).toMatchObject({
      current: null,
      pending: [],
      isOwnKeyRequired: true,
    });
  });
});
