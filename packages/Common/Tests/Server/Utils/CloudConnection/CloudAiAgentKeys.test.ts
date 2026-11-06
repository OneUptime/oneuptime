import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import CloudAccountService, {
  CLOUD_AI_AGENT_KEY_WRITE_ATTEMPTS,
} from "../../../../Server/Services/CloudAccountService";
import CloudAiAgentKeyAuthenticator, {
  CLOUD_AI_AGENT_REGISTRATIONS_PER_MINUTE,
  CLOUD_AI_AGENT_REGISTRATIONS_THROTTLED_MESSAGE,
  CloudAiAgentKeyAuthentication,
} from "../../../../Server/Utils/CloudConnection/CloudAiAgentKeyAuthentication";
import CloudAiAgentKeyHashing from "../../../../Server/Utils/CloudConnection/CloudAiAgentKeyHashing";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_AI_AGENT_KEY_REFUSED_MESSAGE,
  CloudAiAgentKeyResponse,
  CloudAiAgentKeyTaken,
  CloudAiAgentKeys,
  parseCloudAiAgentKey,
  readCloudAiAgentKeys,
} from "../../../../Types/CloudConnection/CloudAiAgentKey";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import crypto from "crypto";

/*
 * A Cloud AI agent's key on the server: made from 32 random bytes and kept
 * only as its hash (CloudAiAgentKeyHashing); made, used and revoked on the
 * account with a compare-and-set write, so no key two admins made at once
 * is lost and none is used after it was revoked (CloudAccountService); and
 * checked when the agent registers - the account's key or a pending one
 * that still works, held to its account's registrations a minute
 * (CloudAiAgentKeyAuthenticator). Postgres is replaced by one row in
 * memory, written only through the compare-and-set the service makes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ACCOUNT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const NOW: Date = new Date("2026-11-06T12:00:00.000Z");

function hoursLater(count: number): Date {
  return new Date(NOW.getTime() + count * 60 * 60 * 1000);
}

// The account's row as Postgres holds it, and every write that reached it.
let stored: { exists: boolean; aiAgentKeys: JSONObject | null };
let writes: Array<JSONObject | null>;
// Writes that find the row changed first: the next n compare-and-sets lose.
let losingWrites: number;
let incrementIfBelow: ReturnType<typeof jest.spyOn>;

function storedKeys(): CloudAiAgentKeys | null {
  return readCloudAiAgentKeys(stored.aiAgentKeys);
}

beforeEach(() => {
  stored = { exists: true, aiAgentKeys: null };
  writes = [];
  losingWrites = 0;

  jest.spyOn(CloudAccountService, "findOneById").mockImplementation(
    async (): Promise<CloudAccount | null> => {
      if (!stored.exists) {
        return null;
      }

      const account: CloudAccount = new CloudAccount();
      account.id = ACCOUNT_ID;
      account._id = ACCOUNT_ID.toString();
      account.projectId = PROJECT_ID;
      account.provider = CloudProvider.AWS;
      account.accountId = "111111111111";
      account.name = "prod";
      // A copy, as a read is: the write is what changes the row.
      account.aiAgentKeys = stored.aiAgentKeys
        ? (JSON.parse(JSON.stringify(stored.aiAgentKeys)) as JSONObject)
        : (undefined as never);
      return account;
    },
  );

  jest
    .spyOn(CloudAccountService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation(
      async (data: {
        data: Record<string, unknown>;
        expectedData: Record<string, unknown>;
      }): Promise<boolean> => {
        if (losingWrites > 0) {
          losingWrites--;
          return false;
        }

        // Written only over the very value the write was worked out from.
        if (
          JSON.stringify(data.expectedData["aiAgentKeys"] ?? null) !==
          JSON.stringify(stored.aiAgentKeys)
        ) {
          return false;
        }

        stored.aiAgentKeys = data.data["aiAgentKeys"] as JSONObject;
        writes.push(stored.aiAgentKeys);
        return true;
      },
    );

  jest
    .spyOn(CloudAccountService, "updateColumnsByIdWithoutHooks")
    .mockImplementation(
      async (data: { data: Record<string, unknown> }): Promise<void> => {
        stored.aiAgentKeys = data.data["aiAgentKeys"] as JSONObject;
        writes.push(stored.aiAgentKeys);
      },
    );

  incrementIfBelow = jest
    .spyOn(GlobalCache, "incrementIfBelow")
    .mockResolvedValue(1 as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function makeKey(
  now: Date = NOW,
): Promise<CloudAiAgentKeyResponse> {
  return await CloudAccountService.makeAiAgentKey({
    cloudAccountId: ACCOUNT_ID,
    userId: USER_ID,
    now,
  });
}

async function authenticate(
  key: unknown,
  now: Date = NOW,
): Promise<CloudAiAgentKeyAuthentication> {
  return await CloudAiAgentKeyAuthenticator.authenticate({ key, now });
}

async function connect(
  key: string,
  now: Date = NOW,
): Promise<CloudAiAgentKeyTaken> {
  return await CloudAccountService.useAiAgentKey({
    cloudAccountId: ACCOUNT_ID,
    hash: CloudAiAgentKeyHashing.hash(key),
    now,
  });
}

describe("a key is made from 32 random bytes, and only its hash is kept", () => {
  test("it names its account, holds 64 hex digits, and its hash is its SHA-256", () => {
    const made: { key: string; hash: string } =
      CloudAiAgentKeyHashing.generate(ACCOUNT_ID);

    expect(parseCloudAiAgentKey(made.key)).toEqual({
      cloudAccountId: ACCOUNT_ID.toString(),
      secret: expect.stringMatching(/^[0-9a-f]{64}$/) as never,
    });
    expect(made.hash).toBe(
      crypto.createHash("sha256").update(made.key, "utf8").digest("hex"),
    );
    expect(CloudAiAgentKeyHashing.generate(ACCOUNT_ID).key).not.toBe(made.key);
  });

  test("a presented key is compared with every hash, timing-safe, and found by it alone", () => {
    const first: { key: string; hash: string } =
      CloudAiAgentKeyHashing.generate(ACCOUNT_ID);
    const second: { key: string; hash: string } =
      CloudAiAgentKeyHashing.generate(ACCOUNT_ID);
    const compare: ReturnType<typeof jest.spyOn> = jest.spyOn(
      crypto,
      "timingSafeEqual",
    );
    const hashes: Array<{ hash: string; match: "current" | "pending" }> = [
      { hash: first.hash, match: "current" },
      { hash: "not a hash", match: "pending" },
      { hash: second.hash, match: "pending" },
    ];

    expect(CloudAiAgentKeyHashing.findMatch(first.key, hashes)).toEqual(
      hashes[0],
    );
    // Both sound hashes were compared, whichever matched.
    expect(compare).toHaveBeenCalledTimes(2);
    expect(CloudAiAgentKeyHashing.findMatch(second.key, hashes)).toEqual(
      hashes[2],
    );
    expect(
      CloudAiAgentKeyHashing.findMatch(
        CloudAiAgentKeyHashing.generate(ACCOUNT_ID).key,
        hashes,
      ),
    ).toBeNull();
    for (const notAKey of [undefined, null, 7, ""]) {
      expect(CloudAiAgentKeyHashing.findMatch(notAKey, hashes)).toBeNull();
    }
  });
});

describe("making a key for the account's agent", () => {
  test("shows it once, keeps its hash alone, pending, made by the person who asked, for a day", async () => {
    const made: CloudAiAgentKeyResponse = await makeKey();
    const keys: CloudAiAgentKeys | null = storedKeys();

    expect(parseCloudAiAgentKey(made.agentKey)?.cloudAccountId).toBe(
      ACCOUNT_ID.toString(),
    );
    expect(made.worksUntilConnectedBy).toBe(hoursLater(24).toISOString());
    expect(keys).toEqual({
      current: null,
      pending: [
        {
          hash: CloudAiAgentKeyHashing.hash(made.agentKey),
          madeAt: NOW.toISOString(),
          madeByUserId: USER_ID.toString(),
        },
      ],
      isOwnKeyRequired: false,
    });
    // The key itself is nowhere in what is kept.
    expect(JSON.stringify(stored.aiAgentKeys)).not.toContain(made.agentKey);
    expect(JSON.stringify(stored.aiAgentKeys)).not.toContain(
      parseCloudAiAgentKey(made.agentKey)!.secret,
    );
  });

  test("leaves the agent's own key working until a new one connects", async () => {
    const first: CloudAiAgentKeyResponse = await makeKey();
    await connect(first.agentKey);
    await makeKey(hoursLater(1));

    expect(
      (await authenticate(first.agentKey, hoursLater(1))).isAuthorized,
    ).toBe(true);
  });

  test("two admins making a key at the same moment both keep theirs", async () => {
    // The first write finds the row changed by the other admin's.
    losingWrites = 1;

    const mine: CloudAiAgentKeyResponse = await makeKey();
    const theirs: CloudAiAgentKeyResponse = await makeKey();

    expect(storedKeys()?.pending).toHaveLength(2);
    expect((await authenticate(mine.agentKey)).isAuthorized).toBe(true);
    expect((await authenticate(theirs.agentKey)).isAuthorized).toBe(true);
  });

  test("a run of writes at the very same instant is told to try again, and writes nothing", async () => {
    losingWrites = CLOUD_AI_AGENT_KEY_WRITE_ATTEMPTS;

    await expect(makeKey()).rejects.toThrow(BadDataException);
    expect(writes).toEqual([]);
  });

  test("for an account that is gone, nothing", async () => {
    stored.exists = false;

    await expect(makeKey()).rejects.toThrow("The cloud account no longer exists.");
  });
});

describe("an agent connecting with one of the account's keys", () => {
  test("a pending key becomes the agent's key: the one it replaced stops working, and the ingestion key with it", async () => {
    const first: CloudAiAgentKeyResponse = await makeKey();

    expect(await connect(first.agentKey)).toEqual({
      isUsable: true,
      isNewKey: true,
      replacedAgentKey: false,
      madeByUserId: USER_ID.toString(),
    });
    expect(storedKeys()?.isOwnKeyRequired).toBe(true);

    const second: CloudAiAgentKeyResponse = await makeKey(hoursLater(2));

    expect(await connect(second.agentKey, hoursLater(2))).toEqual({
      isUsable: true,
      isNewKey: true,
      replacedAgentKey: true,
      madeByUserId: USER_ID.toString(),
    });

    const refused: CloudAiAgentKeyAuthentication = await authenticate(
      first.agentKey,
      hoursLater(2),
    );

    expect(refused).toEqual({
      isAuthorized: false,
      status: 401,
      message: CLOUD_AI_AGENT_KEY_REFUSED_MESSAGE,
    });
  });

  test("the agent's own key again: nothing is written", async () => {
    const made: CloudAiAgentKeyResponse = await makeKey();
    await connect(made.agentKey);
    const before: number = writes.length;

    expect(await connect(made.agentKey, hoursLater(30))).toEqual({
      isUsable: true,
      isNewKey: false,
      replacedAgentKey: false,
    });
    expect(writes).toHaveLength(before);
  });

  test("a key revoked since it was checked, or never the account's, connects nothing and writes nothing", async () => {
    const made: CloudAiAgentKeyResponse = await makeKey();

    await CloudAccountService.revokeAiAgentKeys({
      cloudAccountId: ACCOUNT_ID,
      now: NOW,
    });

    const before: number = writes.length;

    expect((await connect(made.agentKey)).isUsable).toBe(false);
    expect(
      (await connect(CloudAiAgentKeyHashing.generate(ACCOUNT_ID).key)).isUsable,
    ).toBe(false);
    expect(writes).toHaveLength(before);
  });

  test("a pending key a day old connects nothing", async () => {
    const made: CloudAiAgentKeyResponse = await makeKey();

    expect((await connect(made.agentKey, hoursLater(24))).isUsable).toBe(false);
    expect((await authenticate(made.agentKey, hoursLater(24))).isAuthorized).toBe(
      false,
    );
  });

  test("an account set up before keys of their own has none to connect with", async () => {
    expect(
      (await connect(CloudAiAgentKeyHashing.generate(ACCOUNT_ID).key)).isUsable,
    ).toBe(false);
  });
});

describe("Reset agent", () => {
  test("revokes the agent's key and every pending one at once, and keeps the ingestion key out", async () => {
    const current: CloudAiAgentKeyResponse = await makeKey();
    await connect(current.agentKey);
    const pending: CloudAiAgentKeyResponse = await makeKey(hoursLater(1));

    await CloudAccountService.revokeAiAgentKeys({
      cloudAccountId: ACCOUNT_ID,
      now: hoursLater(1),
    });

    expect((await authenticate(current.agentKey, hoursLater(1))).isAuthorized).toBe(
      false,
    );
    expect((await authenticate(pending.agentKey, hoursLater(1))).isAuthorized).toBe(
      false,
    );
    expect(storedKeys()).toEqual({
      current: null,
      pending: [],
      isOwnKeyRequired: true,
      revokedAt: hoursLater(1).toISOString(),
    });
  });

  test("a key made after it connects the agent again", async () => {
    await CloudAccountService.revokeAiAgentKeys({
      cloudAccountId: ACCOUNT_ID,
      now: NOW,
    });

    const made: CloudAiAgentKeyResponse = await makeKey(hoursLater(1));

    expect((await authenticate(made.agentKey, hoursLater(1))).isAuthorized).toBe(
      true,
    );
  });
});

describe("who a registration with a key is from", () => {
  test("the account's key: its project and account, which the key names, and which of its keys it is", async () => {
    const made: CloudAiAgentKeyResponse = await makeKey();

    expect(await authenticate(made.agentKey)).toEqual({
      isAuthorized: true,
      projectId: PROJECT_ID,
      cloudAccountId: ACCOUNT_ID,
      provider: CloudProvider.AWS,
      accountId: "111111111111",
      keyHash: CloudAiAgentKeyHashing.hash(made.agentKey),
      match: "pending",
    });

    await connect(made.agentKey);

    expect((await authenticate(made.agentKey)) as unknown).toMatchObject({
      isAuthorized: true,
      match: "current",
    });
  });

  test.each([
    ["no key", undefined],
    ["a telemetry ingestion key", "0b5f2c1e-1111-4111-8111-222233334444"],
    ["a key that is not of its shape", "ouca_nope"],
  ])("%s: refused before anything is read", async (_what: string, key: unknown) => {
    const read: ReturnType<typeof jest.spyOn> = jest.spyOn(
      CloudAccountService,
      "findAccountOfAgentKey",
    );

    expect(await authenticate(key)).toEqual({
      isAuthorized: false,
      status: 401,
      message: CLOUD_AI_AGENT_KEY_REFUSED_MESSAGE,
    });
    expect(read).not.toHaveBeenCalled();
  });

  test("a key of a removed account is refused: removing the account revokes it", async () => {
    const made: CloudAiAgentKeyResponse = await makeKey();

    stored.exists = false;

    expect((await authenticate(made.agentKey)).isAuthorized).toBe(false);
  });

  test("a wrong key costs its account nothing: the minute's registrations are counted for right keys alone", async () => {
    await makeKey();

    const wrong: string = CloudAiAgentKeyHashing.generate(ACCOUNT_ID).key;

    for (let attempt: number = 0; attempt < 5; attempt++) {
      expect((await authenticate(wrong)).isAuthorized).toBe(false);
    }

    expect(incrementIfBelow).not.toHaveBeenCalled();
  });

  test("past its account's registrations a minute, a right key waits, told for how long", async () => {
    const made: CloudAiAgentKeyResponse = await makeKey();

    incrementIfBelow.mockResolvedValue(null as never);

    const throttled: CloudAiAgentKeyAuthentication = await authenticate(
      made.agentKey,
      new Date("2026-11-06T12:00:45.000Z"),
    );

    expect(throttled).toEqual({
      isAuthorized: false,
      status: 429,
      message: CLOUD_AI_AGENT_REGISTRATIONS_THROTTLED_MESSAGE,
      retryAfterSeconds: 15,
    });
    expect(CLOUD_AI_AGENT_REGISTRATIONS_PER_MINUTE).toBe(30);
    expect(incrementIfBelow.mock.calls[0]![0]).toBe("cloud-ai-agent-registration");
    expect(incrementIfBelow.mock.calls[0]![1]).toBe(
      `${ACCOUNT_ID.toString()}:${Math.floor(
        Date.parse("2026-11-06T12:00:45.000Z") / 60000,
      )}`,
    );
    expect(incrementIfBelow.mock.calls[0]![2]).toEqual({
      limit: 30,
      expiresInSeconds: 120,
    });
  });

  test("a cache that cannot be reached counts nothing: the right key still connects", async () => {
    const made: CloudAiAgentKeyResponse = await makeKey();

    incrementIfBelow.mockRejectedValue(new Error("Cache is not connected") as never);

    expect((await authenticate(made.agentKey)).isAuthorized).toBe(true);
  });
});
