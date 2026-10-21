import { ClientType } from "../../../../Server/Infrastructure/Redis";
import {
  getIpv6NetworkRateLimit,
  IPV6_NETWORK_RATE_LIMIT_ROOM_IN_ADDRESSES,
} from "../../../../Server/Utils/ClientIp";
import ClientRateLimitCounter, {
  ClientRateLimitCounterSpec,
  ClientRateLimitRefusal,
  FixedRateLimitCounterSpec,
} from "../../../../Server/Utils/RateLimit/ClientRateLimitCounter";
import FakeCounterRedis, {
  FakeCounterCommand,
} from "../../TestingUtils/Redis/FakeCounterRedis";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ClientRateLimitCounter: how every rate limit that counts a client address
 * counts it. Each counter keyed on the client is counted under the client's
 * address, at the limit the caller sets; for an IPv6 client, under its /64
 * as well, with room for ten addresses - one host can send from every
 * address of its /64, and a /64 is as often an office's network as one
 * host's. In order: a /64 already over a limit is refused before anything is
 * counted; then the address (and the counters not keyed on the client);
 * then, only if those let the request through, the /64.
 *
 * Against a counter store that does what Redis does (FakeCounterRedis), so
 * the arithmetic is the counter's own. The real-Valkey suite next to this
 * one runs the same rules against a real server.
 */

type Scope = "account" | "ip" | "user";

const TTL_SECONDS: number = 1800;
const PER_ACCOUNT: number = 3;
const PER_IP: number = 5;

const NETWORK: string = "2001:db8:5:6::/64";
const OTHER_NETWORK: string = "2001:db8:5:7::/64";

// The address of host `index` of the /64 2001:db8:5:6::/64.
function hostOf(index: number, prefix: string = "2001:db8:5:6"): string {
  return `${prefix}::${index.toString(16)}`;
}

let redis: FakeCounterRedis;

function accountCounter(account: string): ClientRateLimitCounterSpec<Scope> {
  return {
    scope: "account",
    keyFor: (client: string): string => {
      return `t:a:${account}:${client}:1`;
    },
    limit: PER_ACCOUNT,
  };
}

const ipCounter: ClientRateLimitCounterSpec<Scope> = {
  scope: "ip",
  keyFor: (client: string): string => {
    return `t:i:${client}:1`;
  },
  limit: PER_IP,
};

async function count(
  clientIp: string,
  options: {
    account?: string;
    counters?: Array<ClientRateLimitCounterSpec<Scope>>;
    fixedCounters?: Array<FixedRateLimitCounterSpec<Scope>>;
  } = {},
): Promise<ClientRateLimitRefusal<Scope> | null> {
  return await ClientRateLimitCounter.count<Scope>({
    redis: redis as unknown as ClientType,
    clientIp: clientIp,
    ttlSeconds: TTL_SECONDS,
    counters: options.counters || [
      accountCounter(options.account || "bob"),
      ipCounter,
    ],
    fixedCounters: options.fixedCounters,
  });
}

// How many of `requests` the counter lets through, sent one after another.
async function allowedOf(
  requests: Array<() => Promise<ClientRateLimitRefusal<Scope> | null>>,
): Promise<number> {
  let allowed: number = 0;

  for (const request of requests) {
    if ((await request()) === null) {
      allowed++;
    }
  }

  return allowed;
}

beforeEach(() => {
  redis = new FakeCounterRedis();
});

describe("how much room a /64 gets", () => {
  test("ten addresses' worth, for every limit", () => {
    expect(IPV6_NETWORK_RATE_LIMIT_ROOM_IN_ADDRESSES).toBe(10);
    expect(getIpv6NetworkRateLimit(1)).toBe(10);
    expect(getIpv6NetworkRateLimit(15)).toBe(150);
    expect(getIpv6NetworkRateLimit(150)).toBe(1500);
  });
});

describe("an IPv4 client is counted as it always was", () => {
  test("under its address only, in one round trip, and nothing is read first", async () => {
    expect(await count("203.0.113.7")).toBeNull();

    expect(redis.sent).toEqual([
      [
        { name: "incr", key: "t:a:bob:203.0.113.7:1" },
        { name: "incr", key: "t:i:203.0.113.7:1" },
      ],
      [
        { name: "expire", key: "t:a:bob:203.0.113.7:1" },
        { name: "expire", key: "t:i:203.0.113.7:1" },
      ],
    ]);
    expect(redis.commandsSent("get")).toEqual([]);
  });

  test("is refused past its address's limit, the first refusal of the window told apart", async () => {
    for (let attempt: number = 1; attempt <= PER_ACCOUNT; attempt++) {
      expect(await count("203.0.113.7")).toBeNull();
    }

    expect(await count("203.0.113.7")).toEqual({
      scope: "account",
      ipv6Network64: undefined,
      isFirstRefusalInWindow: true,
    });
    expect(await count("203.0.113.7")).toEqual({
      scope: "account",
      ipv6Network64: undefined,
      isFirstRefusalInWindow: false,
    });
  });

  test("another IPv4 address has its own allowance, even next door", async () => {
    for (let attempt: number = 1; attempt <= PER_ACCOUNT + 2; attempt++) {
      await count("203.0.113.7");
    }

    expect(await count("203.0.113.8")).toBeNull();
  });

  test("an IPv4 address handed over IPv4-mapped is that IPv4 address, with no /64", async () => {
    expect(await count("::ffff:203.0.113.9")).toBeNull();
    expect(await count("::ffff:cb00:7109")).toBeNull();
    expect(await count("203.0.113.9")).toBeNull();

    expect(redis.keys()).toEqual([
      "t:a:bob:203.0.113.9:1",
      "t:i:203.0.113.9:1",
    ]);
    expect(redis.count("t:i:203.0.113.9:1")).toBe(3);
    expect(redis.commandsSent("get")).toEqual([]);
  });

  test("IPv4 clients reaching the server through a translator (64:ff9b::/96) are each their own IPv4 address, with no shared /64", async () => {
    for (let host: number = 1; host <= 200; host++) {
      expect(
        await count(`64:ff9b::198.51.100.${host}`, { counters: [ipCounter] }),
      ).toBeNull();
    }

    expect(redis.keysHolding("/64")).toEqual([]);
    expect(redis.count("t:i:198.51.100.7:1")).toBe(1);
    expect(redis.commandsSent("get")).toEqual([]);
  });

  test("an IPv4 host sending over 6to4 from every /64 of its /48 is held to its one IPv4 allowance", async () => {
    // 203.0.113.7's 6to4 /48 is 2002:cb00:7107::/48: 65,536 /64s.
    const allowed: number = await allowedOf(
      Array.from({ length: 400 }, (_value: unknown, subnet: number) => {
        return (): Promise<ClientRateLimitRefusal<Scope> | null> => {
          return count(`2002:cb00:7107:${subnet.toString(16)}::1`);
        };
      }),
    );

    expect(allowed).toBe(PER_ACCOUNT);
    expect(redis.keysHolding("/64")).toEqual([]);
    expect(redis.keys()).toEqual([
      "t:a:bob:203.0.113.7:1",
      "t:i:203.0.113.7:1",
    ]);
    expect(redis.commandsSent("get")).toEqual([]);

    // The host's plain IPv4 requests are the same host's.
    expect(await count("203.0.113.7")).toEqual({
      scope: "account",
      ipv6Network64: undefined,
      isFirstRefusalInWindow: false,
    });
  });

  test("an IPv4 host sending over Teredo, naming server after server, is held to its one IPv4 allowance", async () => {
    // Client 203.0.113.7 (cb00:7107), its bits inverted (34ff:8ef8), behind any server.
    const allowed: number = await allowedOf(
      Array.from({ length: 400 }, (_value: unknown, server: number) => {
        return (): Promise<ClientRateLimitRefusal<Scope> | null> => {
          return count(
            `2001:0:${(server >> 4).toString(16)}:${(server & 0xf).toString(16)}:8000:${(
              0xffff - server
            ).toString(16)}:34ff:8ef8`,
          );
        };
      }),
    );

    expect(allowed).toBe(PER_ACCOUNT);
    expect(redis.keysHolding("/64")).toEqual([]);
    expect(redis.keys()).toEqual([
      "t:a:bob:203.0.113.7:1",
      "t:i:203.0.113.7:1",
    ]);
  });

  test("callers that cannot be placed share one count, with no /64", async () => {
    expect(await count("unknown")).toBeNull();

    expect(redis.keys()).toEqual(["t:a:bob:unknown:1", "t:i:unknown:1"]);
    expect(redis.commandsSent("get")).toEqual([]);
  });

  test("a key that is not an address at all is counted as itself", async () => {
    expect(await count("telegram-chat:4242")).toBeNull();

    expect(redis.keys()).toEqual([
      "t:a:bob:telegram-chat:4242:1",
      "t:i:telegram-chat:4242:1",
    ]);
  });
});

describe("an IPv6 client is counted under its address and its /64", () => {
  test("the /64 is read first, then the address counted, then the /64, each key expiring from the request that made it", async () => {
    expect(await count(hostOf(1))).toBeNull();

    expect(redis.sent).toEqual([
      [
        { name: "get", key: `t:a:bob:${NETWORK}:1` },
        { name: "get", key: `t:i:${NETWORK}:1` },
      ],
      [
        { name: "incr", key: "t:a:bob:2001:db8:5:6::1:1" },
        { name: "incr", key: "t:i:2001:db8:5:6::1:1" },
      ],
      [
        { name: "expire", key: "t:a:bob:2001:db8:5:6::1:1" },
        { name: "expire", key: "t:i:2001:db8:5:6::1:1" },
      ],
      [
        { name: "incr", key: `t:a:bob:${NETWORK}:1` },
        { name: "incr", key: `t:i:${NETWORK}:1` },
      ],
      [
        { name: "expire", key: `t:a:bob:${NETWORK}:1` },
        { name: "expire", key: `t:i:${NETWORK}:1` },
      ],
    ]);

    expect(redis.expiries.get(`t:i:${NETWORK}:1`)).toEqual([TTL_SECONDS]);
  });

  test("however the address is spelled, it is one address", async () => {
    for (const spelling of [
      "2001:db8:5:6::1",
      "2001:DB8:5:6::1",
      "2001:0db8:0005:0006:0000:0000:0000:0001",
      "2001:db8:5:6:0:0:0:1",
    ]) {
      expect(await count(spelling, { counters: [ipCounter] })).toBeNull();
    }

    expect(redis.count("t:i:2001:db8:5:6::1:1")).toBe(4);
    expect(redis.count(`t:i:${NETWORK}:1`)).toBe(4);
    expect(redis.keysHolding("t:i:")).toEqual([
      "t:i:2001:db8:5:6::1:1",
      `t:i:${NETWORK}:1`,
    ]);
  });

  test("one address is still held to its own limit", async () => {
    for (let attempt: number = 1; attempt <= PER_ACCOUNT; attempt++) {
      expect(await count(hostOf(1))).toBeNull();
    }

    expect(await count(hostOf(1))).toEqual({
      scope: "account",
      ipv6Network64: undefined,
      isFirstRefusalInWindow: true,
    });
  });

  test("a host that sends each request from another address of its /64 is held to ten addresses' worth", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(PER_ACCOUNT);

    const refusals: Array<ClientRateLimitRefusal<Scope> | null> = [];

    for (let host: number = 1; host <= 200; host++) {
      refusals.push(await count(hostOf(host)));
    }

    const allowed: number = refusals.filter(
      (refusal: ClientRateLimitRefusal<Scope> | null): boolean => {
        return refusal === null;
      },
    ).length;

    expect(networkLimit).toBe(30);
    expect(allowed).toBe(networkLimit);

    // The first refusal is the one that went over, and says so once.
    expect(refusals[networkLimit]).toEqual({
      scope: "account",
      ipv6Network64: NETWORK,
      isFirstRefusalInWindow: true,
    });

    for (const later of refusals.slice(networkLimit + 1)) {
      expect(later).toEqual({
        scope: "account",
        ipv6Network64: NETWORK,
        isFirstRefusalInWindow: false,
      });
    }
  });

  test("once its /64 is over, a host's new addresses are refused without a counter being left behind for each", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(PER_ACCOUNT);

    for (let host: number = 1; host <= networkLimit + 1; host++) {
      await count(hostOf(host));
    }

    const keysWhenFull: number = redis.keys().length;
    const incrementsWhenFull: number = redis.commandsSent("incr").length;

    for (let host: number = 1000; host < 1500; host++) {
      expect((await count(hostOf(host)))?.ipv6Network64).toBe(NETWORK);
    }

    expect(redis.keys().length).toBe(keysWhenFull);
    expect(redis.commandsSent("incr").length).toBe(incrementsWhenFull);
  });

  test("the address limit counts first: an address over its own limit never spends its /64's allowance", async () => {
    // A noisy neighbour hammers from one address of a shared /64.
    for (let attempt: number = 1; attempt <= 500; attempt++) {
      await count(hostOf(1), { account: "victim" });
    }

    // Its address was let through PER_ACCOUNT times; only those reached the /64.
    expect(redis.count(`t:a:victim:${NETWORK}:1`)).toBe(PER_ACCOUNT);

    // Everybody else in the /64 keeps the rest of its allowance.
    const networkLimit: number = getIpv6NetworkRateLimit(PER_ACCOUNT);
    const othersAllowed: number = await allowedOf(
      Array.from({ length: networkLimit }, (_value: unknown, index: number) => {
        return (): Promise<ClientRateLimitRefusal<Scope> | null> => {
          return count(hostOf(100 + index), { account: "victim" });
        };
      }),
    );

    expect(othersAllowed).toBe(networkLimit - PER_ACCOUNT);
  });

  test("a full /64 refuses only itself: another /64, and IPv4, keep their allowance", async () => {
    for (let host: number = 1; host <= 100; host++) {
      await count(hostOf(host));
    }

    expect((await count(hostOf(101)))?.ipv6Network64).toBe(NETWORK);
    expect(await count(hostOf(1, "2001:db8:5:7"))).toBeNull();
    expect(await count("203.0.113.7")).toBeNull();
    expect(redis.count(`t:i:${OTHER_NETWORK}:1`)).toBe(1);
  });

  test("a counter keyed on more than the client counts the /64 for that alone: another account from the same /64 is not refused", async () => {
    for (let host: number = 1; host <= 100; host++) {
      await count(hostOf(host), {
        account: "victim",
        counters: [accountCounter("victim")],
      });
    }

    expect(
      (
        await count(hostOf(500), {
          account: "victim",
          counters: [accountCounter("victim")],
        })
      )?.ipv6Network64,
    ).toBe(NETWORK);

    expect(
      await count(hostOf(501), {
        account: "someone-else",
        counters: [accountCounter("someone-else")],
      }),
    ).toBeNull();
  });

  test("the per-client counter's /64 refuses every account from that /64 once it is over", async () => {
    // Rotating the account as well as the address: the ip counter's /64 holds.
    const networkLimit: number = getIpv6NetworkRateLimit(PER_IP);
    let allowed: number = 0;
    let lastRefusal: ClientRateLimitRefusal<Scope> | null = null;

    for (let host: number = 1; host <= 400; host++) {
      const refusal: ClientRateLimitRefusal<Scope> | null = await count(
        hostOf(host),
        { account: `account-${host}` },
      );

      if (refusal === null) {
        allowed++;
      } else {
        lastRefusal = refusal;
      }
    }

    expect(allowed).toBe(networkLimit);
    expect(lastRefusal).toEqual({
      scope: "ip",
      ipv6Network64: NETWORK,
      isFirstRefusalInWindow: false,
    });
  });

  test("a caller may give a /64 its own limit", async () => {
    const counters: Array<ClientRateLimitCounterSpec<Scope>> = [
      { ...ipCounter, limit: 5, ipv6NetworkLimit: 7 },
    ];

    const allowed: number = await allowedOf(
      Array.from({ length: 50 }, (_value: unknown, index: number) => {
        return (): Promise<ClientRateLimitRefusal<Scope> | null> => {
          return count(hostOf(index + 1), { counters: counters });
        };
      }),
    );

    expect(allowed).toBe(7);
  });

  test("requests that arrive together are still held to the /64's allowance", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(PER_IP);

    const refusals: Array<ClientRateLimitRefusal<Scope> | null> =
      await Promise.all(
        Array.from({ length: 300 }, (_value: unknown, index: number) => {
          return count(hostOf(index + 1), {
            counters: [ipCounter],
          });
        }),
      );

    expect(
      refusals.filter(
        (refusal: ClientRateLimitRefusal<Scope> | null): boolean => {
          return refusal === null;
        },
      ).length,
    ).toBe(networkLimit);

    expect(
      refusals.filter(
        (refusal: ClientRateLimitRefusal<Scope> | null): boolean => {
          return refusal?.isFirstRefusalInWindow === true;
        },
      ).length,
    ).toBe(1);
  });

  test("each /64 key expires once, from the request that created it, however many requests it counts", async () => {
    for (let host: number = 1; host <= 40; host++) {
      await count(hostOf(host), { counters: [ipCounter] });
    }

    expect(redis.expiries.get(`t:i:${NETWORK}:1`)).toEqual([TTL_SECONDS]);
    expect(redis.expiries.get("t:i:2001:db8:5:6::1:1")).toEqual([TTL_SECONDS]);
  });
});

describe("counters that are not keyed on the client", () => {
  const fixed: (limit: number) => Array<FixedRateLimitCounterSpec<Scope>> = (
    limit: number,
  ): Array<FixedRateLimitCounterSpec<Scope>> => {
    return [{ scope: "user", key: "t:u:alice:1", limit: limit }];
  };

  test("are counted with the address, in the same round trip, and reported first", async () => {
    expect(
      await count(hostOf(1), {
        counters: [ipCounter],
        fixedCounters: fixed(1),
      }),
    ).toBeNull();

    expect(redis.sent[1]).toEqual([
      { name: "incr", key: "t:u:alice:1" },
      { name: "incr", key: "t:i:2001:db8:5:6::1:1" },
    ]);

    expect(
      await count(hostOf(1), {
        counters: [ipCounter],
        fixedCounters: fixed(1),
      }),
    ).toEqual({
      scope: "user",
      ipv6Network64: undefined,
      isFirstRefusalInWindow: true,
    });
  });

  test("are never counted per /64", async () => {
    await count(hostOf(1), { counters: [ipCounter], fixedCounters: fixed(9) });

    expect(redis.keysHolding("/64")).toEqual([`t:i:${NETWORK}:1`]);
    expect(redis.count("t:u:alice:1")).toBe(1);
  });

  test("a request one of them refuses is not counted against the /64", async () => {
    for (let attempt: number = 1; attempt <= 20; attempt++) {
      await count(hostOf(attempt), {
        counters: [ipCounter],
        fixedCounters: fixed(2),
      });
    }

    expect(redis.count(`t:i:${NETWORK}:1`)).toBe(2);
  });

  test("a /64 already over its limit is refused before they are counted", async () => {
    for (let host: number = 1; host <= 51; host++) {
      await count(hostOf(host), { counters: [ipCounter] });
    }

    expect(
      await count(hostOf(999), {
        counters: [ipCounter],
        fixedCounters: fixed(100),
      }),
    ).toEqual({
      scope: "ip",
      ipv6Network64: NETWORK,
      isFirstRefusalInWindow: false,
    });
    expect(redis.count("t:u:alice:1")).toBe(0);
  });

  test("countFixed counts them alone, with no client at all", async () => {
    const counters: Array<FixedRateLimitCounterSpec<Scope>> = [
      { scope: "user", key: "t:f:form:1", limit: 2 },
    ];

    expect(
      await ClientRateLimitCounter.countFixed<Scope>({
        redis: redis as unknown as ClientType,
        ttlSeconds: TTL_SECONDS,
        counters: counters,
      }),
    ).toBeNull();
    expect(
      await ClientRateLimitCounter.countFixed<Scope>({
        redis: redis as unknown as ClientType,
        ttlSeconds: TTL_SECONDS,
        counters: counters,
      }),
    ).toBeNull();
    expect(
      await ClientRateLimitCounter.countFixed<Scope>({
        redis: redis as unknown as ClientType,
        ttlSeconds: TTL_SECONDS,
        counters: counters,
      }),
    ).toEqual({
      scope: "user",
      ipv6Network64: undefined,
      isFirstRefusalInWindow: true,
    });

    expect(redis.keys()).toEqual(["t:f:form:1"]);
    expect(redis.expiries.get("t:f:form:1")).toEqual([TTL_SECONDS]);
  });
});

describe("uncountFixed: a request taken back off the counters it was counted under", () => {
  const counters: Array<FixedRateLimitCounterSpec<Scope>> = [
    { scope: "user", key: "t:f:contact-a:1", limit: 2 },
    { scope: "user", key: "t:f:contact-b:1", limit: 2 },
  ];

  async function countFixed(): Promise<ClientRateLimitRefusal<Scope> | null> {
    return await ClientRateLimitCounter.countFixed<Scope>({
      redis: redis as unknown as ClientType,
      ttlSeconds: TTL_SECONDS,
      counters: counters,
    });
  }

  async function uncountFixed(keys: Array<string>): Promise<void> {
    await ClientRateLimitCounter.uncountFixed({
      redis: redis as unknown as ClientType,
      keys: keys,
      ttlSeconds: TTL_SECONDS,
    });
  }

  test("one count off each key, in one round trip, their expiries left as they were", async () => {
    await countFixed();
    await countFixed();

    const sentBefore: number = redis.sent.length;

    await uncountFixed(["t:f:contact-a:1", "t:f:contact-b:1"]);

    expect(redis.sent.length - sentBefore).toBe(1);
    expect(redis.commandsSent("decr")).toEqual([
      { name: "decr", key: "t:f:contact-a:1" },
      { name: "decr", key: "t:f:contact-b:1" },
    ]);
    expect(redis.count("t:f:contact-a:1")).toBe(1);
    expect(redis.count("t:f:contact-b:1")).toBe(1);
    expect(redis.expiries.get("t:f:contact-a:1")).toEqual([TTL_SECONDS]);
  });

  test("a counter taken back is counted from where it was: its limit is whole again", async () => {
    await countFixed();
    await countFixed();
    await uncountFixed(["t:f:contact-a:1", "t:f:contact-b:1"]);
    await uncountFixed(["t:f:contact-a:1", "t:f:contact-b:1"]);

    expect(await countFixed()).toBeNull();
    expect(await countFixed()).toBeNull();
    expect(await countFixed()).toEqual({
      scope: "user",
      ipv6Network64: undefined,
      isFirstRefusalInWindow: true,
    });
  });

  test("a key Redis no longer holds is given an expiry, so it is not left behind without one", async () => {
    await uncountFixed(["t:f:lost:1"]);

    expect(redis.count("t:f:lost:1")).toBe(-1);
    expect(redis.expiries.get("t:f:lost:1")).toEqual([TTL_SECONDS]);
  });

  test("nothing to take back sends nothing", async () => {
    await uncountFixed([]);

    expect(redis.sent).toEqual([]);
  });

  test("a DECR that fails, or an answer that is not one, is an error for the caller to handle", async () => {
    redis.failCommand = (command: FakeCounterCommand): Error | null => {
      return command.name === "decr" ? new Error("READONLY replica") : null;
    };

    await expect(uncountFixed(["t:f:contact-a:1"])).rejects.toThrow(
      "READONLY replica",
    );

    redis.failCommand = null;
    redis.answerNextExecWith = null;

    await expect(uncountFixed(["t:f:contact-a:1"])).rejects.toThrow(
      "Rate limit pipeline returned no result",
    );
  });
});

describe("a counter that cannot be read is an error for the caller to handle", () => {
  test("a pipeline that fails", async () => {
    redis.failNextExec = new Error("connection reset");

    await expect(count("203.0.113.7")).rejects.toThrow("connection reset");
  });

  test("an INCR that fails", async () => {
    redis.failCommand = (command: FakeCounterCommand): Error | null => {
      return command.name === "incr" ? new Error("READONLY replica") : null;
    };

    await expect(count(hostOf(1))).rejects.toThrow("READONLY replica");
  });

  test("a GET of the /64 that fails, before anything is counted", async () => {
    redis.failCommand = (command: FakeCounterCommand): Error | null => {
      return command.name === "get" ? new Error("LOADING dataset") : null;
    };

    await expect(count(hostOf(1))).rejects.toThrow("LOADING dataset");
    expect(redis.commandsSent("incr")).toEqual([]);
  });

  test("an EXPIRE that fails: a key that would never be removed", async () => {
    redis.failCommand = (command: FakeCounterCommand): Error | null => {
      return command.name === "expire" ? new Error("OOM") : null;
    };

    await expect(count("203.0.113.7")).rejects.toThrow("OOM");
  });

  test.each([
    ["no answer", null],
    ["too few answers", [[null, 1]]],
    [
      "an INCR that answers a string",
      [
        [null, "1"],
        [null, 1],
      ],
    ],
    [
      "an INCR that answers nothing",
      [
        [null, null],
        [null, 1],
      ],
    ],
  ])(
    "an answer that is not a count: %s",
    async (_label: string, answer: unknown) => {
      redis.answerNextExecWith = answer;

      await expect(count("203.0.113.7")).rejects.toThrow();
    },
  );

  test("a /64 counter that holds something other than a count", async () => {
    redis.storedValues.set(`t:i:${NETWORK}:1`, "not a number");

    await expect(count(hostOf(1))).rejects.toThrow(
      "Rate limit counter holds a non-numeric value",
    );
  });
});

describe("what a log line calls the limit that refused", () => {
  test("the limit, and the /64 when the /64 went over it", () => {
    expect(ClientRateLimitCounter.describeLimit("ip")).toBe("ip limit");
    expect(ClientRateLimitCounter.describeLimit("ip", undefined)).toBe(
      "ip limit",
    );
    expect(ClientRateLimitCounter.describeLimit("account", NETWORK)).toBe(
      "account limit of 2001:db8:5:6::/64",
    );
  });
});
