import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The /64 rule every IP-keyed rate limit counts by, against a real Valkey.
 * ClientRateLimitCounter.test.ts holds the rule to a stand-in; here Redis
 * itself answers: INCR's counts, GET's string answers for the /64's peek,
 * EXPIRE's TTLs, and pipelines' answers. Then each limit that counts a client
 * address is driven through the call its route makes, by a host that sends
 * from address after address of one /64.
 *
 * It needs Valkey: CI's test-setup.sh starts one on localhost:6310. Locally,
 * a disposable one:
 *
 *   docker run -d --rm -p 16395:6379 valkey/valkey:9.1-alpine
 *   CLIENT_RATE_LIMIT_TEST_REDIS_URL=redis://localhost:16395 \
 *     npx jest Tests/Server/Utils/RateLimit/ClientRateLimitCounterValkey.test.ts
 *
 * Every client here is in a /64 of this run's own, and every account,
 * dashboard and form is a fresh id, so no other suite's keys are touched;
 * the keys this suite wrote are removed after each test.
 */

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import Redis from "../../../../Server/Infrastructure/Redis";
import { getIpv6NetworkRateLimit } from "../../../../Server/Utils/ClientIp";
import ClientRateLimitCounter, {
  ClientRateLimitRefusal,
} from "../../../../Server/Utils/RateLimit/ClientRateLimitCounter";
import IdentityRateLimit, {
  IdentityRateLimitBucket,
  IdentityRateLimitDecision,
  IdentityRateLimitOutcome,
  IdentityRateLimitScope,
} from "../../../../Server/Middleware/IdentityRateLimit";
import VerificationCodeRateLimit, {
  VerificationCodeRateLimitBucket,
  VerificationCodeRateLimitOutcome,
} from "../../../../Server/Middleware/VerificationCodeRateLimit";
import PublicDashboardRateLimit, {
  PublicDashboardRateLimitBucket,
  PublicDashboardRateLimitOutcome,
} from "../../../../Server/Middleware/PublicDashboardRateLimit";
import FormRateLimit, {
  FormRateLimitBucket,
  FormRateLimitOutcome,
} from "../../../../Server/Middleware/FormRateLimit";
import OnCallCalendarFeedRateLimit, {
  OnCallCalendarFeedRateLimitOutcome,
} from "../../../../Server/Middleware/OnCallCalendarFeedRateLimit";
import McpOAuthRateLimit, {
  McpOAuthRateLimitBucket,
  McpOAuthRateLimitOutcome,
} from "../../../../Server/Middleware/McpOAuthRateLimit";
import RunbookWebhookRateLimit, {
  RunbookWebhookRateLimitOutcome,
} from "../../../../Server/Utils/Runbook/RunbookWebhookRateLimit";
import { RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE } from "../../../../Types/Runbook/RunbookWebhook";
import { ExpressRequest } from "../../../../Server/Utils/Express";
import {
  TestRedisClient,
  connectTestRedis,
} from "../../TestingUtils/Redis/TestRedisClient";

let client: TestRedisClient;

/*
 * This run's own /64s, in the documentation range: random, so two runs
 * against one Valkey never count each other's requests.
 */
const RUN_HIGH: number = Math.floor(Math.random() * 0xffff);
const RUN_LOW: number = Math.floor(Math.random() * 0xfffe);
const RUN: string = `${RUN_HIGH.toString(16)}:${RUN_LOW.toString(16)}`;
const PREFIX: string = `2001:db8:${RUN}`;
const NETWORK: string = `${PREFIX}::/64`;

// Another /64 of this run's: the next one.
const OTHER_PREFIX: string = `2001:db8:${RUN_HIGH.toString(16)}:${(
  RUN_LOW + 1
).toString(16)}`;

// Host `index` of this run's /64.
function hostOf(index: number, prefix: string = PREFIX): string {
  return `${prefix}:${(index >> 16).toString(16)}:${(index & 0xffff).toString(16)}:a:b`;
}

// A fresh id for each account, dashboard or form a test names.
let idCounter: number = 0;
function freshId(): string {
  idCounter++;
  return `00000000-0000-4000-8${RUN.replace(":", "").padStart(3, "0").slice(0, 3)}-${idCounter
    .toString(16)
    .padStart(12, "0")}`;
}

/*
 * Every window here divides an hour, and the clock stands still at the
 * start of this hour: the whole suite counts in one window of each.
 */
const NOW: number = Date.now() - (Date.now() % (60 * 60 * 1000)) + 1000;

const writtenKeyPatterns: Set<string> = new Set<string>();

let nowSpy: ReturnType<typeof jest.spyOn>;

async function removeWrittenKeys(): Promise<void> {
  for (const pattern of writtenKeyPatterns) {
    const keys: Array<string> = await client.keys(pattern);

    if (keys.length > 0) {
      await client.del(...keys);
    }
  }
}

beforeAll(async () => {
  client = await connectTestRedis(
    process.env["CLIENT_RATE_LIMIT_TEST_REDIS_URL"],
  );

  jest
    .mocked(Redis.getClient)
    .mockReturnValue(client as unknown as ReturnType<typeof Redis.getClient>);
  jest.mocked(Redis.isConnected).mockReturnValue(true);
});

beforeEach(() => {
  nowSpy = jest.spyOn(Date, "now").mockReturnValue(NOW);

  // Every key this run writes names one of its /64s or one of its ids.
  writtenKeyPatterns.add(`*${PREFIX}*`);
  writtenKeyPatterns.add(`*${OTHER_PREFIX}*`);
  writtenKeyPatterns.add(`*valkey-run-${RUN}*`);
});

afterEach(async () => {
  nowSpy.mockRestore();
  await removeWrittenKeys();
});

afterAll(async () => {
  await removeWrittenKeys();
  client?.disconnect();
});

function requestFrom(
  address: string,
  extra: Record<string, unknown> = {},
): ExpressRequest {
  return {
    headers: { "x-forwarded-for": address },
    socket: { remoteAddress: "10.0.0.2" },
    params: {},
    body: {},
    ...extra,
  } as unknown as ExpressRequest;
}

describe("the counter, on a real Valkey", () => {
  type Scope = "ip";

  async function count(
    clientIp: string,
    limit: number = 4,
  ): Promise<ClientRateLimitRefusal<Scope> | null> {
    return await ClientRateLimitCounter.count<Scope>({
      redis: client as unknown as Parameters<
        typeof ClientRateLimitCounter.count
      >[0]["redis"],
      clientIp: clientIp,
      ttlSeconds: 120,
      counters: [
        {
          scope: "ip",
          keyFor: (clientKey: string): string => {
            return `valkey-run-${RUN}:i:${clientKey}`;
          },
          limit: limit,
        },
      ],
    });
  }

  test("an IPv4 client is counted under its address alone, its key expiring with its window", async () => {
    const address: string = "203.0.113.77";
    writtenKeyPatterns.add(`valkey-run-${RUN}:i:${address}`);

    for (let attempt: number = 1; attempt <= 4; attempt++) {
      expect(await count(address)).toBeNull();
    }

    expect(await count(address)).toEqual({
      scope: "ip",
      ipv6Network64: undefined,
      isFirstRefusalInWindow: true,
    });

    expect(await client.get(`valkey-run-${RUN}:i:${address}`)).toBe("5");
    expect(await client.ttl(`valkey-run-${RUN}:i:${address}`)).toBeGreaterThan(
      100,
    );
    expect(await client.keys(`valkey-run-${RUN}:i:*/64`)).toEqual([]);
  });

  test("an IPv6 host is held to ten addresses' worth of its /64, read back from Redis as a string", async () => {
    let allowed: number = 0;

    for (let host: number = 1; host <= 60; host++) {
      if ((await count(hostOf(host))) === null) {
        allowed++;
      }
    }

    expect(allowed).toBe(getIpv6NetworkRateLimit(4));
    expect(await client.get(`valkey-run-${RUN}:i:${NETWORK}`)).toBe("41");
    expect(await client.ttl(`valkey-run-${RUN}:i:${NETWORK}`)).toBeGreaterThan(
      100,
    );

    // Refused from then on before anything is counted: no key per address.
    const keysWhenFull: number = (await client.keys(`valkey-run-${RUN}:*`))
      .length;

    for (let host: number = 1000; host < 1100; host++) {
      expect((await count(hostOf(host)))?.ipv6Network64).toBe(NETWORK);
    }

    expect((await client.keys(`valkey-run-${RUN}:*`)).length).toBe(
      keysWhenFull,
    );
    expect(await client.get(`valkey-run-${RUN}:i:${NETWORK}`)).toBe("41");

    // Another /64 is counted on its own.
    expect(await count(hostOf(1, OTHER_PREFIX))).toBeNull();
  });

  test("an address over its own limit leaves its /64 the rest of its allowance", async () => {
    for (let attempt: number = 1; attempt <= 30; attempt++) {
      await count(hostOf(1));
    }

    expect(await client.get(`valkey-run-${RUN}:i:${NETWORK}`)).toBe("4");

    let neighboursAllowed: number = 0;

    for (let host: number = 2; host <= 60; host++) {
      if ((await count(hostOf(host))) === null) {
        neighboursAllowed++;
      }
    }

    expect(neighboursAllowed).toBe(getIpv6NetworkRateLimit(4) - 4);
  });

  test("requests that arrive together are held to the /64's allowance", async () => {
    const refusals: Array<ClientRateLimitRefusal<Scope> | null> =
      await Promise.all(
        Array.from({ length: 120 }, (_value: unknown, index: number) => {
          return count(hostOf(index + 1));
        }),
      );

    expect(
      refusals.filter(
        (refusal: ClientRateLimitRefusal<Scope> | null): boolean => {
          return refusal === null;
        },
      ).length,
    ).toBe(getIpv6NetworkRateLimit(4));
  });
});

describe("each limit that counts a client address, on a real Valkey", () => {
  test("sign-in: second-factor guesses against one account from one /64", async () => {
    const account: string = `person-${freshId()}@example.com`;
    writtenKeyPatterns.add(`*${account}*`);

    let allowed: number = 0;
    let last: IdentityRateLimitDecision | null = null;

    for (let host: number = 1; host <= 140; host++) {
      last = await IdentityRateLimit.consume({
        accountKey: account,
        clientIp: IdentityRateLimit.resolveClientIp(requestFrom(hostOf(host))),
        bucket: IdentityRateLimitBucket.TwoFactor,
      });

      if (last.outcome === IdentityRateLimitOutcome.Allowed) {
        allowed++;
      }
    }

    expect(allowed).toBe(getIpv6NetworkRateLimit(10));
    expect(last).toEqual({
      outcome: IdentityRateLimitOutcome.RateLimited,
      retryAfterSeconds: expect.any(Number),
      scope: IdentityRateLimitScope.Account,
      ipv6Network64: NETWORK,
      isFirstRejectionInWindow: false,
    });

    // The account's owner, elsewhere, is not locked out.
    expect(
      (
        await IdentityRateLimit.consume({
          accountKey: account,
          clientIp: hostOf(1, OTHER_PREFIX),
          bucket: IdentityRateLimitBucket.TwoFactor,
        })
      ).outcome,
    ).toBe(IdentityRateLimitOutcome.Allowed);
  });

  test("notification channel verification: codes asked for from one /64", async () => {
    let allowed: number = 0;
    const perIp: number = VerificationCodeRateLimit.getBucketConfig(
      VerificationCodeRateLimitBucket.Resend,
    ).perIpLimit;

    for (
      let host: number = 1;
      host <= getIpv6NetworkRateLimit(perIp) + 20;
      host++
    ) {
      const user: string = freshId();
      writtenKeyPatterns.add(`*${user}*`);

      const decision: { outcome: VerificationCodeRateLimitOutcome } =
        await VerificationCodeRateLimit.consume({
          itemKey: freshId(),
          userKey: user,
          clientIp: hostOf(host),
          bucket: VerificationCodeRateLimitBucket.Resend,
        });

      if (decision.outcome === VerificationCodeRateLimitOutcome.Allowed) {
        allowed++;
      }
    }

    expect(allowed).toBe(getIpv6NetworkRateLimit(perIp));
  });

  test("dashboard and status page master passwords: guesses from one /64", async () => {
    for (const bucket of [
      PublicDashboardRateLimitBucket.MasterPassword,
      PublicDashboardRateLimitBucket.StatusPageMasterPassword,
    ]) {
      const resource: string = `id:${freshId()}`;
      writtenKeyPatterns.add(`*${resource}*`);
      let allowed: number = 0;

      for (let host: number = 1; host <= 200; host++) {
        const decision: { outcome: PublicDashboardRateLimitOutcome } =
          await PublicDashboardRateLimit.consume({
            resourceKey: resource,
            clientIp: hostOf(host),
            bucket: bucket,
          });

        if (decision.outcome === PublicDashboardRateLimitOutcome.Allowed) {
          allowed++;
        }
      }

      expect(allowed).toBe(getIpv6NetworkRateLimit(15));
      await removeWrittenKeys();
    }
  });

  test("form submissions to one form from one /64", async () => {
    const form: string = FormRateLimit.getFormKey(freshId());
    writtenKeyPatterns.add(`*${form}*`);
    let allowed: number = 0;

    for (let host: number = 1; host <= 150; host++) {
      const decision: { outcome: FormRateLimitOutcome } =
        await FormRateLimit.consume({
          formKey: form,
          clientIp: hostOf(host),
          bucket: FormRateLimitBucket.Submit,
        });

      if (decision.outcome === FormRateLimitOutcome.Allowed) {
        allowed++;
      }
    }

    expect(allowed).toBe(
      getIpv6NetworkRateLimit(
        FormRateLimit.getBucketConfig(FormRateLimitBucket.Submit)
          .perFormAndIpLimit,
      ),
    );
  });

  test("calendar feed fetches of one link from one /64", async () => {
    const link: string = OnCallCalendarFeedRateLimit.hashToken(freshId());
    writtenKeyPatterns.add(`*${link}*`);
    const perToken: number =
      OnCallCalendarFeedRateLimit.getConfig().perTokenLimit;
    let allowed: number = 0;

    for (
      let host: number = 1;
      host <= getIpv6NetworkRateLimit(perToken) + 30;
      host++
    ) {
      const decision: { outcome: OnCallCalendarFeedRateLimitOutcome } =
        await OnCallCalendarFeedRateLimit.consume({
          tokenKey: link,
          clientIp: hostOf(host),
        });

      if (decision.outcome === OnCallCalendarFeedRateLimitOutcome.Allowed) {
        allowed++;
      }
    }

    expect(allowed).toBe(getIpv6NetworkRateLimit(perToken));
  });

  test("MCP OAuth client registrations from one /64", async () => {
    const limit: number = McpOAuthRateLimit.getLimit(
      McpOAuthRateLimitBucket.Register,
    );
    let allowed: number = 0;

    for (
      let host: number = 1;
      host <= getIpv6NetworkRateLimit(limit) + 30;
      host++
    ) {
      const decision: { outcome: McpOAuthRateLimitOutcome } =
        await McpOAuthRateLimit.consume({
          bucket: McpOAuthRateLimitBucket.Register,
          clientIp: McpOAuthRateLimit.resolveClientIp(
            requestFrom(hostOf(host)),
          ),
        });

      if (decision.outcome === McpOAuthRateLimitOutcome.Allowed) {
        allowed++;
      }
    }

    expect(allowed).toBe(getIpv6NetworkRateLimit(limit));
  });

  test("runbook webhook calls from one /64", async () => {
    let allowed: number = 0;

    for (
      let host: number = 1;
      host <=
      getIpv6NetworkRateLimit(RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE) +
        30;
      host++
    ) {
      const decision: { outcome: RunbookWebhookRateLimitOutcome } =
        await RunbookWebhookRateLimit.consumeForAddress(
          requestFrom(hostOf(host)),
        );

      if (decision.outcome === RunbookWebhookRateLimitOutcome.Allowed) {
        allowed++;
      }
    }

    expect(allowed).toBe(
      getIpv6NetworkRateLimit(RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE),
    );
  });
});
