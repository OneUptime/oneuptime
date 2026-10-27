import ApiKeyService, {
  ResolvedApiKey,
} from "../../../Server/Services/ApiKeyService";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN API KEY STOPS WORKING WHEN IT EXPIRES.
 *
 * Every API-key request resolves its key through an in-process cache that
 * keeps a key for a minute (ApiKeyService.findApiKey). The cache kept no
 * expiry: a key that expired while cached kept working for up to a minute
 * after it. And a change to a key cleared the cache before it was written,
 * so a request in between cached the key as it was - a regenerated key's
 * old value - for another minute. Now a cached key carries its expiry, and
 * the cache is cleared again once a change is written.
 */

const API_KEY: ObjectID = new ObjectID("12000000-0000-4000-8000-000000000001");
const KEY_ID: ObjectID = new ObjectID("12000000-0000-4000-8000-000000000002");
const PROJECT_ID: ObjectID = new ObjectID(
  "12000000-0000-4000-8000-000000000003",
);

function keyExpiringAt(expiresAt: Date): ApiKey {
  const key: ApiKey = new ApiKey();
  key.id = KEY_ID;
  key.projectId = PROJECT_ID;
  key.name = "Deploys";
  key.expiresAt = expiresAt;
  return key;
}

let now: number = Date.UTC(2026, 9, 27, 12, 0, 0);

beforeEach(() => {
  now = Date.UTC(2026, 9, 27, 12, 0, 0);
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });

  // Every test starts with nothing cached.
  (
    ApiKeyService as unknown as { apiKeyCache: { clear: () => void } }
  ).apiKeyCache.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a cached API key", () => {
  test("is looked up again, and refused, once it expires", async () => {
    jest
      .spyOn(ApiKeyService, "findOneBy")
      .mockResolvedValueOnce(keyExpiringAt(new Date(now + 20 * 1000)) as never)
      // Looked up again past its expiry: the query finds no live key.
      .mockResolvedValueOnce(null as never);

    const first: ResolvedApiKey | null = await ApiKeyService.findApiKey(API_KEY);
    expect(first?.id.toString()).toBe(KEY_ID.toString());

    // Within its expiry: served from the cache.
    now += 10 * 1000;
    expect(
      (await ApiKeyService.findApiKey(API_KEY))?.id.toString(),
    ).toBe(KEY_ID.toString());
    expect(ApiKeyService.findOneBy).toHaveBeenCalledTimes(1);

    // Past it, though the cache would keep it for most of a minute more.
    now += 15 * 1000;
    expect(await ApiKeyService.findApiKey(API_KEY)).toBeNull();
    expect(ApiKeyService.findOneBy).toHaveBeenCalledTimes(2);
  });

  test("is forgotten once a change to a key is written, as well as before", async () => {
    jest
      .spyOn(ApiKeyService, "findOneBy")
      .mockResolvedValue(
        keyExpiringAt(new Date(now + 60 * 60 * 1000)) as never,
      );

    await ApiKeyService.findApiKey(API_KEY);
    expect(ApiKeyService.findOneBy).toHaveBeenCalledTimes(1);

    await (
      ApiKeyService as unknown as {
        onUpdateSuccess: (onUpdate: unknown, ids: Array<ObjectID>) => unknown;
      }
    ).onUpdateSuccess({ updateBy: {}, carryForward: null }, []);

    await ApiKeyService.findApiKey(API_KEY);
    expect(ApiKeyService.findOneBy).toHaveBeenCalledTimes(2);

    await (
      ApiKeyService as unknown as {
        onDeleteSuccess: (onDelete: unknown, ids: Array<ObjectID>) => unknown;
      }
    ).onDeleteSuccess({ deleteBy: {}, carryForward: null }, []);

    await ApiKeyService.findApiKey(API_KEY);
    expect(ApiKeyService.findOneBy).toHaveBeenCalledTimes(3);
  });
});
