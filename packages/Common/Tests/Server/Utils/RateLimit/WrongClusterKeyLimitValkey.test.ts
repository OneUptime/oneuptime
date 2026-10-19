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
 * The different values a client presents, counted by Valkey itself:
 * ClientRateLimitCounter.countDifferent's one script (DIFFERENT_VALUES_SCRIPT)
 * run by a real server - its sets, SCARD's answers, the TTL it gives a set
 * once - then the limit on wrong cluster keys driven through the real
 * cluster key check. ClientRateLimitCounterDifferentValues.test.ts and
 * ClusterKeyWrongKeys.test.ts hold the same rules to the stand-in
 * (FakeCounterRedis); here the stand-in is held to the server as well, on a
 * long seeded run of both.
 *
 * It needs Valkey: CI's test-setup.sh starts one on localhost:6310. Locally,
 * a disposable one:
 *
 *   docker run -d --rm -p 16395:6379 valkey/valkey:9.1-alpine
 *   CLIENT_RATE_LIMIT_TEST_REDIS_URL=redis://localhost:16395 \
 *     npx jest Tests/Server/Utils/RateLimit/WrongClusterKeyLimitValkey.test.ts
 *
 * Every client here is in an IPv6 /64 of this run's own, or an IPv4 address
 * drawn for this run, and the keys this suite wrote are removed after each
 * test.
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

import Redis, { ClientType } from "../../../../Server/Infrastructure/Redis";
import { getIpv6NetworkRateLimit } from "../../../../Server/Utils/ClientIp";
import ClientRateLimitCounter, {
  ClientRateLimitCounterSpec,
  ClientRateLimitRefusal,
} from "../../../../Server/Utils/RateLimit/ClientRateLimitCounter";
import ClusterKeyAuthorization from "../../../../Server/Middleware/ClusterKeyAuthorization";
import {
  WRONG_CLUSTER_KEYS_MESSAGE,
  WRONG_CLUSTER_KEYS_PER_ADDRESS,
  WRONG_CLUSTER_KEY_WINDOW_SECONDS,
} from "../../../../Server/Utils/RateLimit/WrongClusterKeyLimit";
import { JSONObject } from "../../../../Types/JSON";
import FakeCounterRedis from "../../TestingUtils/Redis/FakeCounterRedis";
import {
  TestRedisClient,
  connectTestRedis,
} from "../../TestingUtils/Redis/TestRedisClient";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

let client: TestRedisClient;

/*
 * This run's own /64s, in the documentation range, and an IPv4 range of its
 * own in 198.18.0.0/15: random, so two runs against one Valkey never count
 * each other's values.
 */
const RUN_HIGH: number = Math.floor(Math.random() * 0xffff);
const RUN_LOW: number = Math.floor(Math.random() * 0xfffe);
const RUN: string = `${RUN_HIGH.toString(16)}:${RUN_LOW.toString(16)}`;
const PREFIX: string = `2001:db8:${RUN}`;
const NETWORK: string = `${PREFIX}::/64`;
const OTHER_PREFIX: string = `2001:db8:${RUN_HIGH.toString(16)}:${(
  RUN_LOW + 1
).toString(16)}`;
const IPV4_RUN: number = Math.floor(Math.random() * 512);

// Host `index` of this run's /64.
function hostOf(index: number, prefix: string = PREFIX): string {
  return `${prefix}:${(index >> 16).toString(16)}:${(index & 0xffff).toString(16)}:a:b`;
}

// IPv4 address `index` (below 256) of this run's own.
function ipv4Of(index: number): string {
  return `198.${18 + (IPV4_RUN >> 8)}.${IPV4_RUN & 0xff}.${index}`;
}

// The clock stands at the start of a window: the whole test counts in one.
const NOW: number =
  Date.now() - (Date.now() % (WRONG_CLUSTER_KEY_WINDOW_SECONDS * 1000)) + 1000;

const TTL_SECONDS: number = 120;
const PER_ADDRESS: number = 4;

function counterOf(
  name: string,
  limit: number = PER_ADDRESS,
): ClientRateLimitCounterSpec<string> {
  return {
    scope: name,
    keyFor: (clientKey: string): string => {
      return `valkey-different-${RUN}:${name}:${clientKey}`;
    },
    limit: limit,
  };
}

async function present(
  clientIp: string,
  value: string | null,
  counter: ClientRateLimitCounterSpec<string> = counterOf("values"),
  redis: unknown = client,
): Promise<ClientRateLimitRefusal<string> | null> {
  return await ClientRateLimitCounter.countDifferent<string>({
    redis: redis as ClientType,
    clientIp: clientIp,
    ttlSeconds: TTL_SECONDS,
    counter: counter,
    value: value,
  });
}

async function removeWrittenKeys(): Promise<void> {
  for (const pattern of [
    `valkey-different-${RUN}:*`,
    `cluster-key:wrong-keys:*${PREFIX}*`,
    `cluster-key:wrong-keys:*${OTHER_PREFIX}*`,
    `cluster-key:wrong-keys:198.${18 + (IPV4_RUN >> 8)}.${IPV4_RUN & 0xff}.*`,
  ]) {
    const keys: Array<string> = await client.keys(pattern);

    if (keys.length > 0) {
      await client.del(...keys);
    }
  }
}

let nowSpy: ReturnType<typeof jest.spyOn>;

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
});

afterEach(async () => {
  nowSpy.mockRestore();
  await removeWrittenKeys();
});

afterAll(async () => {
  await removeWrittenKeys();
  client?.disconnect();
});

describe("the script, on a real Valkey", () => {
  const key: (clientKey: string) => string = (clientKey: string): string => {
    return counterOf("values").keyFor(clientKey);
  };

  test("an IPv4 client: its limit of different values, then the first refusal of the window, then refusals", async () => {
    const address: string = ipv4Of(1);

    for (let value: number = 1; value <= PER_ADDRESS; value++) {
      expect(await present(address, `value-${value}`)).toBeNull();
    }

    expect(await present(address, "one-too-many")).toEqual({
      scope: "values",
      ipv6Network64: undefined,
      isFirstRefusalInWindow: true,
    });
    expect(await present(address, "value-1")).toEqual({
      scope: "values",
      ipv6Network64: undefined,
      isFirstRefusalInWindow: false,
    });
    expect(await present(address, null)).toEqual({
      scope: "values",
      ipv6Network64: undefined,
      isFirstRefusalInWindow: false,
    });

    // A Valkey set, one value past the limit and never more, with no /64.
    for (let value: number = 100; value < 300; value++) {
      await present(address, `value-${value}`);
    }

    expect(await client.type(key(address))).toBe("set");
    expect(await client.scard(key(address))).toBe(PER_ADDRESS + 1);
    expect(await client.keys(`valkey-different-${RUN}:*/64`)).toEqual([]);
  });

  test("a value sent again is one value", async () => {
    const address: string = ipv4Of(2);

    for (let call: number = 1; call <= 200; call++) {
      expect(await present(address, "the-old-key")).toBeNull();
    }

    expect(await client.smembers(key(address))).toEqual(["the-old-key"]);
  });

  test("a set's lifetime is given by the call that made it, and never again", async () => {
    const address: string = ipv4Of(3);

    await present(address, "value-1");

    const ttl: number = await client.ttl(key(address));

    expect(ttl).toBeGreaterThan(TTL_SECONDS - 5);
    expect(ttl).toBeLessThanOrEqual(TTL_SECONDS);

    // Lengthened by hand: a later value must leave it as it is.
    await client.expire(key(address), 5000);
    await present(address, "value-2");
    await present(address, "value-3");

    expect(await client.ttl(key(address))).toBeGreaterThan(4990);
  });

  test("a check adds nothing and makes no set", async () => {
    for (let call: number = 1; call <= 20; call++) {
      expect(await present(ipv4Of(4), null)).toBeNull();
      expect(await present(hostOf(call), null)).toBeNull();
    }

    expect(await client.keys(`valkey-different-${RUN}:*`)).toEqual([]);
  });

  test("an IPv6 host presenting from address after address of its /64 is held to ten addresses' worth, and new addresses leave no set behind", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(PER_ADDRESS);
    let allowed: number = 0;

    for (let host: number = 1; host <= networkLimit + 20; host++) {
      if ((await present(hostOf(host), `value-${host}`)) === null) {
        allowed++;
      }
    }

    expect(allowed).toBe(networkLimit);
    expect(await client.scard(key(NETWORK))).toBe(networkLimit + 1);

    const setsWhenFull: number = (
      await client.keys(`valkey-different-${RUN}:*`)
    ).length;

    for (let host: number = 1000; host < 1100; host++) {
      expect(
        (await present(hostOf(host), `value-${host}`))?.ipv6Network64,
      ).toBe(NETWORK);
    }

    expect((await client.keys(`valkey-different-${RUN}:*`)).length).toBe(
      setsWhenFull,
    );
    expect(await present(hostOf(1, OTHER_PREFIX), "value-1")).toBeNull();
  });

  test("an address over its own limit leaves its /64 the rest of its allowance", async () => {
    for (let value: number = 1; value <= 30; value++) {
      await present(hostOf(1), `noisy-${value}`);
    }

    expect(await client.scard(key(NETWORK))).toBe(PER_ADDRESS);

    let neighboursAllowed: number = 0;

    for (let host: number = 2; host <= 60; host++) {
      if ((await present(hostOf(host), `neighbour-${host}`)) === null) {
        neighboursAllowed++;
      }
    }

    expect(neighboursAllowed).toBe(
      getIpv6NetworkRateLimit(PER_ADDRESS) - PER_ADDRESS,
    );
  });

  test("values sent together are held to the limit, and a check sent after them is refused", async () => {
    const address: string = ipv4Of(5);

    const answers: Array<ClientRateLimitRefusal<string> | null> =
      await Promise.all([
        ...Array.from({ length: 40 }, (_value: unknown, index: number) => {
          return present(address, `burst-${index}`);
        }),
        present(address, null),
      ]);

    expect(
      answers
        .slice(0, 40)
        .filter((answer: ClientRateLimitRefusal<string> | null): boolean => {
          return answer === null;
        }).length,
    ).toBe(PER_ADDRESS);
    expect(answers[answers.length - 1]?.scope).toBe("values");
    expect(await client.scard(key(address))).toBe(PER_ADDRESS + 1);
  });

  test("the stand-in answers every call as the server does, on a long seeded run", async () => {
    const random: SeededRandom = seededRandom(20261019);
    const fake: FakeCounterRedis = new FakeCounterRedis();
    const clients: Array<string> = [
      ipv4Of(10),
      ipv4Of(11),
      ...Array.from({ length: 12 }, (_value: unknown, index: number) => {
        return hostOf(index + 1);
      }),
      hostOf(1, OTHER_PREFIX),
    ];
    const counter: ClientRateLimitCounterSpec<string> = counterOf("seeded", 3);
    const answers: Array<string> = [];
    const fakeAnswers: Array<string> = [];

    for (let call: number = 0; call < 600; call++) {
      const clientIp: string = clients[random(clients.length)]!;
      const roll: number = random(10);
      const value: string | null =
        roll === 0 ? null : `value-${random(roll < 5 ? 4 : 40)}`;

      answers.push(JSON.stringify(await present(clientIp, value, counter)));
      fakeAnswers.push(
        JSON.stringify(await present(clientIp, value, counter, fake)),
      );
    }

    expect(fakeAnswers).toEqual(answers);

    // And they hold the same values.
    for (const setKey of await client.keys(
      `valkey-different-${RUN}:seeded:*`,
    )) {
      expect((await client.smembers(setKey)).sort()).toEqual(
        fake.membersOf(setKey).sort(),
      );
    }

    // Both refused somebody, and let somebody through.
    expect(answers).toContain("null");
    expect(
      answers.some((answer: string): boolean => {
        return answer.includes('"isFirstRefusalInWindow":true');
      }),
    ).toBe(true);
  });
});

describe("the cluster key check, on a real Valkey", () => {
  const RIGHT_KEY: string = ClusterKeyAuthorization.getClusterKey();

  interface Outcome {
    passed: boolean;
    status: number | null;
    message: string | null;
    retryAfter: string | null;
  }

  async function presentKey(address: string, key: string): Promise<Outcome> {
    let passed: boolean = false;
    let status: number | null = null;
    let message: string | null = null;
    let retryAfter: string | null = null;

    const res: JSONObject = {
      status: (code: number): JSONObject => {
        status = code;
        return res;
      },
      send: (body: JSONObject): JSONObject => {
        message = (body["message"] as string) || null;
        return res;
      },
      setHeader: (name: string, value: string): void => {
        if (name === "Retry-After") {
          retryAfter = value;
        }
      },
    } as unknown as JSONObject;

    await ClusterKeyAuthorization.isAuthorizedServiceMiddleware(
      {
        headers: { "x-forwarded-for": address, clusterkey: key },
        socket: { remoteAddress: "10.0.0.2" },
        query: {},
        params: {},
        body: {},
      } as never,
      res as never,
      (): void => {
        passed = true;
      },
    );

    return { passed, status, message, retryAfter };
  }

  test("ten different wrong keys are answered as wrong, the next is refused with Retry-After, and so is the right key after it", async () => {
    const address: string = ipv4Of(20);

    for (
      let guess: number = 1;
      guess <= WRONG_CLUSTER_KEYS_PER_ADDRESS;
      guess++
    ) {
      expect((await presentKey(address, `guess-${guess}`)).status).toBe(400);
    }

    const refused: Outcome = await presentKey(address, "guess-11");

    expect(refused).toEqual({
      passed: false,
      status: 429,
      message: WRONG_CLUSTER_KEYS_MESSAGE,
      retryAfter: String(WRONG_CLUSTER_KEY_WINDOW_SECONDS - 1),
    });
    expect((await presentKey(address, RIGHT_KEY)).status).toBe(429);

    // Valkey holds digests of the wrong keys, and nothing of the right one.
    const sets: Array<string> = await client.keys(
      `cluster-key:wrong-keys:${address}:*`,
    );

    expect(sets).toHaveLength(1);
    expect(await client.ttl(sets[0]!)).toBeGreaterThan(
      WRONG_CLUSTER_KEY_WINDOW_SECONDS,
    );

    const kept: Array<string> = await client.smembers(sets[0]!);

    expect(kept).toHaveLength(WRONG_CLUSTER_KEYS_PER_ADDRESS + 1);

    for (const value of kept) {
      expect(value).toMatch(/^[0-9a-f]{64}$/);
      expect(value).not.toContain("guess");
      expect(value).not.toBe(RIGHT_KEY);
    }
  });

  test("the right key from a client that sent only an old one is let through, and an IPv6 /64 is counted together", async () => {
    for (let call: number = 1; call <= 50; call++) {
      expect((await presentKey(ipv4Of(21), "the-old-key")).status).toBe(400);
    }

    expect((await presentKey(ipv4Of(21), RIGHT_KEY)).passed).toBe(true);

    const networkLimit: number = getIpv6NetworkRateLimit(
      WRONG_CLUSTER_KEYS_PER_ADDRESS,
    );

    for (let host: number = 1; host <= networkLimit; host++) {
      expect((await presentKey(hostOf(host), `guess-${host}`)).status).toBe(
        400,
      );
    }

    // Its limit reached, not passed: the right key is still let through.
    expect((await presentKey(hostOf(4999), RIGHT_KEY)).passed).toBe(true);

    expect(
      (await presentKey(hostOf(networkLimit + 1), "one-too-many")).status,
    ).toBe(429);
    expect((await presentKey(hostOf(5000), RIGHT_KEY)).status).toBe(429);
    expect((await presentKey(hostOf(1, OTHER_PREFIX), RIGHT_KEY)).passed).toBe(
      true,
    );
  });
});
