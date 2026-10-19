import SamlAssertionOneTimeUse, {
  SAML_RESPONSE_ALREADY_USED_MESSAGE,
  SamlProviderKind,
} from "../../../FeatureSet/Identity/Utils/SamlAssertionOneTimeUse";
import { VerifiedSamlResponse } from "../../../FeatureSet/Identity/Utils/SSO";
import Redis from "Common/Server/Infrastructure/Redis";
import Email from "Common/Types/Email";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import ObjectID from "Common/Types/ObjectID";
import {
  TestRedisClient,
  connectTestRedis,
} from "Common/Tests/Server/TestingUtils/Redis/TestRedisClient";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * One sign-in per SAML response, against a real Valkey: the SET NX that
 * decides which of two posts of the same response wins is Redis's own, and so
 * is the expiry that forgets a used assertion once it could no longer be
 * accepted anyway. SamlAssertionOneTimeUse.test.ts reads what is asked of the
 * cache; this suite shows Redis answering it.
 *
 * It needs Valkey: CI's test-setup.sh starts one on localhost:6310. Locally,
 * a disposable one:
 *
 *   docker run -d --rm -p 16391:6379 valkey/valkey:9.1-alpine
 *   SAML_ONE_TIME_USE_TEST_REDIS_URL=redis://localhost:16391 \
 *     npx jest Tests/FeatureSet/Identity/SamlAssertionOneTimeUseValkey.test.ts
 *
 * Every provider here is a fresh random id, and the keys this suite writes are
 * removed after each test.
 */

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
  };
});

let client: TestRedisClient;
const writtenKeys: Set<string> = new Set();

beforeAll(async () => {
  client = await connectTestRedis(
    process.env["SAML_ONE_TIME_USE_TEST_REDIS_URL"],
  );

  jest.mocked(Redis.getClient).mockReturnValue(client);
  jest.mocked(Redis.isConnected).mockReturnValue(true);
});

afterEach(async () => {
  if (writtenKeys.size > 0) {
    await client.del(...writtenKeys);
    writtenKeys.clear();
  }
});

afterAll(() => {
  client?.disconnect();
});

function assertion(
  assertionId: string,
  secondsLeft: number = 7 * 60,
): VerifiedSamlResponse {
  return {
    issuerUrl: "https://idp.example.com",
    email: new Email("monica.reyes@example.com"),
    name: null,
    objectId: null,
    assertionId,
    acceptableUntil: new Date(Date.now() + secondsLeft * 1000),
  };
}

// The Redis key a provider's use of an assertion is kept under.
function storedKey(data: {
  providerKind: SamlProviderKind;
  providerId: string;
  assertionId: string;
}): string {
  const key: string = `${SamlAssertionOneTimeUse.CACHE_NAMESPACE}-${SamlAssertionOneTimeUse.getCacheKey(
    data,
  )}`;

  writtenKeys.add(key);

  return key;
}

async function claim(data: {
  providerKind: SamlProviderKind;
  providerId: string;
  assertion: VerifiedSamlResponse;
}): Promise<void> {
  storedKey({
    providerKind: data.providerKind,
    providerId: data.providerId,
    assertionId: data.assertion.assertionId,
  });

  await SamlAssertionOneTimeUse.claim(data);
}

describe("one sign-in per SAML response, in Valkey", () => {
  test("the first use goes through and the second is refused", async () => {
    const providerId: string = ObjectID.generate().toString();
    const used: VerifiedSamlResponse = assertion("_valkey_once");

    await expect(
      claim({
        providerKind: SamlProviderKind.ProjectSso,
        providerId,
        assertion: used,
      }),
    ).resolves.toBeUndefined();

    await expect(
      claim({
        providerKind: SamlProviderKind.ProjectSso,
        providerId,
        assertion: used,
      }),
    ).rejects.toThrow(SAML_RESPONSE_ALREADY_USED_MESSAGE);
  });

  test("is remembered for as long as the assertion could be accepted, plus the margin, and then forgotten", async () => {
    const providerId: string = ObjectID.generate().toString();

    await claim({
      providerKind: SamlProviderKind.GlobalSso,
      providerId,
      assertion: assertion("_valkey_ttl", 5 * 60),
    });

    const ttl: number = await client.ttl(
      storedKey({
        providerKind: SamlProviderKind.GlobalSso,
        providerId,
        assertionId: "_valkey_ttl",
      }),
    );

    const expected: number = 5 * 60 + 3 * 60;

    // Redis counts down from the moment it was written.
    expect(ttl).toBeGreaterThan(expected - 5);
    expect(ttl).toBeLessThanOrEqual(expected);
  });

  test("of twenty-five posts of the same response arriving together, exactly one gets through", async () => {
    const providerId: string = ObjectID.generate().toString();
    const raced: VerifiedSamlResponse = assertion("_valkey_race");

    const results: Array<PromiseSettledResult<void>> = await Promise.allSettled(
      Array.from({ length: 25 }, (): Promise<void> => {
        return claim({
          providerKind: SamlProviderKind.StatusPageSso,
          providerId,
          assertion: raced,
        });
      }),
    );

    const fulfilled: Array<PromiseSettledResult<void>> = results.filter(
      (result: PromiseSettledResult<void>): boolean => {
        return result.status === "fulfilled";
      },
    );

    // Why each of the others was refused.
    const refusals: Array<unknown> = results
      .filter((result: PromiseSettledResult<void>): boolean => {
        return result.status === "rejected";
      })
      .map((result: PromiseSettledResult<void>): unknown => {
        return (result as { reason: unknown }).reason;
      });

    expect(fulfilled).toHaveLength(1);
    expect(refusals).toHaveLength(24);

    for (const refusal of refusals) {
      expect(refusal).toBeInstanceOf(BadRequestException);
      expect((refusal as BadRequestException).message).toBe(
        SAML_RESPONSE_ALREADY_USED_MESSAGE,
      );
    }
  });

  test("another provider keeps its own record of the same assertion ID", async () => {
    const firstProvider: string = ObjectID.generate().toString();
    const secondProvider: string = ObjectID.generate().toString();
    const shared: VerifiedSamlResponse = assertion("_valkey_shared_id");

    await claim({
      providerKind: SamlProviderKind.ProjectSso,
      providerId: firstProvider,
      assertion: shared,
    });

    await expect(
      claim({
        providerKind: SamlProviderKind.ProjectSso,
        providerId: secondProvider,
        assertion: shared,
      }),
    ).resolves.toBeUndefined();
  });

  test("once its record has expired the same ID can be recorded again - which is why it is kept as long as the assertion could be accepted", async () => {
    const providerId: string = ObjectID.generate().toString();
    const key: string = storedKey({
      providerKind: SamlProviderKind.ProjectSso,
      providerId,
      assertionId: "_valkey_forgotten",
    });

    await claim({
      providerKind: SamlProviderKind.ProjectSso,
      providerId,
      assertion: assertion("_valkey_forgotten"),
    });

    expect(await client.exists(key)).toBe(1);

    // What expiry does when the time comes.
    await client.del(key);

    await expect(
      claim({
        providerKind: SamlProviderKind.ProjectSso,
        providerId,
        assertion: assertion("_valkey_forgotten"),
      }),
    ).resolves.toBeUndefined();
  });
});
