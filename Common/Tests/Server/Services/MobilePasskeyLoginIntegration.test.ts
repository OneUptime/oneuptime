import MobilePasskeyLoginService, {
  MobilePasskeyContext,
} from "../../../Server/Services/MobilePasskeyLoginService";
import Redis from "../../../Server/Infrastructure/Redis";
import ObjectID from "../../../Types/ObjectID";
import getTestRedisConnectionOptions from "../TestingUtils/Redis/TestRedisOptions";
import { Redis as RedisClient } from "ioredis";
import { createHash, randomBytes } from "crypto";
import { URL } from "url";

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    Host: "self-hosted.example:8443",
    HttpProtocol: "https://",
  };
});
jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
  };
});

const userId: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const verifier: string = randomBytes(32).toString("base64url");
const state: string = randomBytes(32).toString("base64url");
const context: MobilePasskeyContext = {
  codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
  codeChallengeMethod: "S256",
  state,
  serverOrigin: "https://self-hosted.example:8443",
};
let client: RedisClient;
let keys: Set<string>;

// Use the shared test Redis by default; a disposable local Redis can be selected.
const redisUrl: string | undefined =
  process.env["MOBILE_PASSKEY_TEST_REDIS_URL"];

beforeAll(async () => {
  client = redisUrl
    ? new RedisClient(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        retryStrategy: () => {
          return null;
        },
      })
    : new RedisClient({
        ...getTestRedisConnectionOptions(),
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        retryStrategy: () => {
          return null;
        },
      });
  await client.connect();
  jest.mocked(Redis.getClient).mockReturnValue(client);
  jest.mocked(Redis.isConnected).mockReturnValue(true);
});

beforeEach(() => {
  keys = new Set();
});

afterEach(async () => {
  // Only remove the random challenge/code keys created by this test.
  if (keys.size > 0) {
    await client.del(...keys);
  }
});

afterAll(async () => {
  client?.disconnect();
});

function rememberKey(prefix: string, value: string): string {
  const key: string = `${prefix}${createHash("sha256").update(value).digest("base64url")}`;
  keys.add(key);
  return key;
}

async function issueCode(): Promise<{ code: string; key: string }> {
  const callback: URL = new URL(
    await MobilePasskeyLoginService.createAuthorizationCode({
      userId,
      context,
    }),
  );
  const code: string = callback.searchParams.get("code")!;
  return { code, key: rememberKey("mobile-passkey-code-", code) };
}

async function exchange(
  code: string,
  override: Record<string, unknown> = {},
): Promise<ObjectID> {
  return MobilePasskeyLoginService.exchangeAuthorizationCode({
    code,
    codeVerifier: verifier,
    state,
    ...override,
  });
}

describe("mobile passkey handoff with real Redis Lua and cryptography", () => {
  it("consumes challenge metadata only once and leaves another attempt alone", async () => {
    const first: string = randomBytes(32).toString("base64url");
    const second: string = randomBytes(32).toString("base64url");
    rememberKey("mobile-passkey-challenge-", first);
    rememberKey("mobile-passkey-challenge-", second);
    await MobilePasskeyLoginService.storeChallengeContext(first, context);
    await MobilePasskeyLoginService.storeChallengeContext(second, context);
    await expect(
      MobilePasskeyLoginService.consumeChallengeContext(first),
    ).resolves.toEqual(context);
    await expect(
      MobilePasskeyLoginService.consumeChallengeContext(first),
    ).resolves.toBeNull();
    await expect(
      MobilePasskeyLoginService.consumeChallengeContext(second),
    ).resolves.toEqual(context);
  });

  it("sets short server-side expiries on both kinds of handoff state", async () => {
    const challengeId: string = randomBytes(32).toString("base64url");
    const challengeKey: string = rememberKey(
      "mobile-passkey-challenge-",
      challengeId,
    );
    await MobilePasskeyLoginService.storeChallengeContext(challengeId, context);
    const { key } = await issueCode();
    expect(await client.ttl(challengeKey)).toBeGreaterThan(290);
    expect(await client.ttl(challengeKey)).toBeLessThanOrEqual(300);
    expect(await client.ttl(key)).toBeGreaterThan(110);
    expect(await client.ttl(key)).toBeLessThanOrEqual(120);
  });

  it("returns the verified account once and rejects replay", async () => {
    const { code } = await issueCode();
    await expect(exchange(code)).resolves.toEqual(userId);
    await expect(exchange(code)).rejects.toThrow();
  });

  it("allows exactly one of twenty concurrent exchanges to issue a session", async () => {
    const { code } = await issueCode();
    const results: Array<PromiseSettledResult<ObjectID>> =
      await Promise.allSettled(
        Array.from({ length: 20 }, () => {
          return exchange(code);
        }),
      );
    expect(
      results.filter((result: PromiseSettledResult<ObjectID>) => {
        return result.status === "fulfilled";
      }),
    ).toHaveLength(1);
    expect(
      results.filter((result: PromiseSettledResult<ObjectID>) => {
        return result.status === "rejected";
      }),
    ).toHaveLength(19);
  });

  it.each([
    { codeVerifier: "wrong".repeat(13) },
    { state: "wrong".repeat(13) },
  ])(
    "rejects an intercepted code without burning the valid attempt: %p",
    async (override: Record<string, unknown>) => {
      const { code } = await issueCode();
      await expect(exchange(code, override)).rejects.toThrow();
      await expect(exchange(code)).resolves.toEqual(userId);
    },
  );

  it.each([
    { serverOrigin: "https://other.example" },
    { serverOrigin: "https://self-hosted.example" },
    { codeChallengeMethod: "plain" },
    { userId: null },
  ])(
    "rejects stored issuer/purpose corruption: %p",
    async (override: Record<string, unknown>) => {
      const { code, key } = await issueCode();
      await client.set(
        key,
        JSON.stringify({ ...context, userId: userId.toString(), ...override }),
        "EX",
        120,
      );
      await expect(exchange(code)).rejects.toThrow();
    },
  );

  it("does not accept a browser challenge as an authorization code", async () => {
    const challengeId: string = randomBytes(32).toString("base64url");
    rememberKey("mobile-passkey-challenge-", challengeId);
    await MobilePasskeyLoginService.storeChallengeContext(challengeId, context);
    await expect(exchange(challengeId)).rejects.toThrow();
    await expect(
      MobilePasskeyLoginService.consumeChallengeContext(challengeId),
    ).resolves.toEqual(context);
  });

  it("rejects expired codes and metadata using the Redis clock", async () => {
    const challengeId: string = randomBytes(32).toString("base64url");
    const challengeKey: string = rememberKey(
      "mobile-passkey-challenge-",
      challengeId,
    );
    await MobilePasskeyLoginService.storeChallengeContext(challengeId, context);
    const { code, key } = await issueCode();
    await client.pexpireat(key, Date.now() - 1);
    await client.pexpireat(challengeKey, Date.now() - 1);
    await expect(exchange(code)).rejects.toThrow();
    await expect(
      MobilePasskeyLoginService.consumeChallengeContext(challengeId),
    ).resolves.toBeNull();
  });

  it.each(["broken-json", "null", "false", "[]"])(
    "rejects malformed storage values safely: %s",
    async (value: string) => {
      const { code, key } = await issueCode();
      await client.set(key, value, "EX", 120);
      await expect(exchange(code)).rejects.toThrow();
    },
  );
});
