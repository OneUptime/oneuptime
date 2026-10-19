import { ClientType } from "../../../../Server/Infrastructure/Redis";
import { getIpv6NetworkRateLimit } from "../../../../Server/Utils/ClientIp";
import ClientRateLimitCounter, {
  ClientRateLimitCounterSpec,
  ClientRateLimitRefusal,
} from "../../../../Server/Utils/RateLimit/ClientRateLimitCounter";
import FakeCounterRedis, {
  FakeCounterCommand,
} from "../../TestingUtils/Redis/FakeCounterRedis";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ClientRateLimitCounter.countDifferent: how a limit on guessing counts what
 * a client tries rather than how often it asks. A client may present so many
 * DIFFERENT values in a window (the different wrong keys it sent); a value it
 * presented before is not counted again; past its limit it is refused
 * whatever it presents, a value it tried before and a bare check (null)
 * included. Counted under the client's address and, for an IPv6 client,
 * under its /64 too, with room for ten addresses, in the order count()
 * counts: a /64 or an address already over its limit is refused before
 * anything is added, and an address over its own limit never spends its
 * /64's allowance.
 *
 * Against the stand-in, which runs the counter's one script the way EVAL
 * does (FakeCounterRedis); ClientRateLimitCounterValkey.test.ts runs the
 * script itself on a real Valkey, and holds the stand-in to it.
 */

type Scope = "wrong key";

const TTL_SECONDS: number = 1800;
const PER_ADDRESS: number = 3;

const NETWORK: string = "2001:db8:5:6::/64";

// The address of host `index` of the /64 2001:db8:5:6::/64.
function hostOf(index: number, prefix: string = "2001:db8:5:6"): string {
  return `${prefix}::${index.toString(16)}`;
}

const counter: ClientRateLimitCounterSpec<Scope> = {
  scope: "wrong key",
  keyFor: (client: string): string => {
    return `t:d:${client}:1`;
  },
  limit: PER_ADDRESS,
};

let redis: FakeCounterRedis;

async function present(
  clientIp: string,
  value: string | null,
  options: { counter?: ClientRateLimitCounterSpec<Scope> } = {},
): Promise<ClientRateLimitRefusal<Scope> | null> {
  return await ClientRateLimitCounter.countDifferent<Scope>({
    redis: redis as unknown as ClientType,
    clientIp: clientIp,
    ttlSeconds: TTL_SECONDS,
    counter: options.counter || counter,
    value: value,
  });
}

// How many of `requests` are let through, sent one after another.
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

describe("an IPv4 client's different values", () => {
  const address: string = "203.0.113.7";
  const key: string = "t:d:203.0.113.7:1";

  test("are checked and added in one round trip: one script, naming the address's set alone", async () => {
    expect(await present(address, "value-1")).toBeNull();

    expect(redis.sent).toEqual([
      [{ name: "eval", key: key, keys: [key] }],
    ]);
    expect(redis.membersOf(key)).toEqual(["value-1"]);
  });

  test("it may present its limit of them; the next different one is refused, the first refusal of the window told apart", async () => {
    for (let value: number = 1; value <= PER_ADDRESS; value++) {
      expect(await present(address, `value-${value}`)).toBeNull();
    }

    expect(await present(address, "value-4")).toEqual({
      scope: "wrong key",
      ipv6Network64: undefined,
      isFirstRefusalInWindow: true,
    });
    expect(await present(address, "value-5")).toEqual({
      scope: "wrong key",
      ipv6Network64: undefined,
      isFirstRefusalInWindow: false,
    });
  });

  test("a value it presented before is not counted again: one value a thousand times never refuses it", async () => {
    for (let attempt: number = 1; attempt <= 1000; attempt++) {
      expect(await present(address, "the-old-key")).toBeNull();
    }

    expect(redis.membersOf(key)).toEqual(["the-old-key"]);

    // Its allowance is all there: one value is one of PER_ADDRESS.
    for (let value: number = 2; value <= PER_ADDRESS; value++) {
      expect(await present(address, `value-${value}`)).toBeNull();
    }
  });

  test("once it is over its limit it is refused whatever it presents - a value it tried before, a new one, or nothing - and nothing more is kept", async () => {
    for (let value: number = 1; value <= PER_ADDRESS + 1; value++) {
      await present(address, `value-${value}`);
    }

    const refusedLater: ClientRateLimitRefusal<Scope> = {
      scope: "wrong key",
      ipv6Network64: undefined,
      isFirstRefusalInWindow: false,
    };

    expect(await present(address, "value-1")).toEqual(refusedLater);
    expect(await present(address, "value-99")).toEqual(refusedLater);
    expect(await present(address, null)).toEqual(refusedLater);

    for (let value: number = 100; value < 600; value++) {
      await present(address, `value-${value}`);
    }

    // One value past the limit, the one that went over: never more.
    expect(redis.membersOf(key)).toHaveLength(PER_ADDRESS + 1);
  });

  test("a check (null) adds nothing and makes no set", async () => {
    for (let attempt: number = 1; attempt <= 20; attempt++) {
      expect(await present(address, null)).toBeNull();
    }

    expect(redis.keys()).toEqual([]);
    expect(redis.commandsSent("eval")).toHaveLength(20);
  });

  test("a check is refused once the client is over its limit", async () => {
    for (let value: number = 1; value <= PER_ADDRESS; value++) {
      await present(address, `value-${value}`);
    }

    expect(await present(address, null)).toBeNull();

    await present(address, "one-too-many");

    expect((await present(address, null))?.scope).toBe("wrong key");
  });

  test("the set expires once, from the call that made it, however many values it holds", async () => {
    for (let value: number = 1; value <= PER_ADDRESS + 5; value++) {
      await present(address, `value-${value}`);
    }

    expect(redis.expiries.get(key)).toEqual([TTL_SECONDS]);
  });

  test("another address has its own allowance, even next door", async () => {
    for (let value: number = 1; value <= PER_ADDRESS + 2; value++) {
      await present(address, `value-${value}`);
    }

    expect(await present("203.0.113.8", "value-1")).toBeNull();
    expect(await present("203.0.113.8", null)).toBeNull();
  });

  test("an IPv4 host however it is written - mapped, 6to4, Teredo, through a translator - is that address, with no /64", async () => {
    const spellings: Array<string> = [
      "203.0.113.7",
      "::ffff:203.0.113.7",
      "::ffff:cb00:7107",
      "2002:cb00:7107:1::1",
      "64:ff9b::203.0.113.7",
      "2001:0:1:2:8000:ffff:34ff:8ef8",
    ];

    for (const spelling of spellings) {
      expect(
        await present(spelling, `value-from-${spelling}`, {
          counter: { ...counter, limit: spellings.length },
        }),
      ).toBeNull();
    }

    expect(redis.keys()).toEqual([key]);
    expect(redis.keysHolding("/64")).toEqual([]);
    expect(redis.membersOf(key)).toHaveLength(spellings.length);

    // One host: the next different value, however written, is one too many.
    expect(
      (
        await present("2002:cb00:7107:ffff::1", "one-too-many", {
          counter: { ...counter, limit: spellings.length },
        })
      )?.isFirstRefusalInWindow,
    ).toBe(true);
  });

  test("callers that cannot be placed share one set, with no /64", async () => {
    expect(await present("unknown", "value-1")).toBeNull();

    expect(redis.keys()).toEqual(["t:d:unknown:1"]);
  });
});

describe("an IPv6 client's different values", () => {
  test("are checked and added under its address and its /64, in one round trip", async () => {
    expect(await present(hostOf(1), "value-1")).toBeNull();

    expect(redis.sent).toEqual([
      [
        {
          name: "eval",
          key: "t:d:2001:db8:5:6::1:1",
          keys: ["t:d:2001:db8:5:6::1:1", `t:d:${NETWORK}:1`],
        },
      ],
    ]);
    expect(redis.membersOf("t:d:2001:db8:5:6::1:1")).toEqual(["value-1"]);
    expect(redis.membersOf(`t:d:${NETWORK}:1`)).toEqual(["value-1"]);
    expect(redis.expiries.get(`t:d:${NETWORK}:1`)).toEqual([TTL_SECONDS]);
  });

  test("however the address is spelled, it is one address", async () => {
    for (const spelling of [
      "2001:db8:5:6::1",
      "2001:DB8:5:6::1",
      "2001:0db8:0005:0006:0000:0000:0000:0001",
      "2001:db8:5:6:0:0:0:1",
    ]) {
      await present(spelling, `value-from-${spelling}`);
    }

    expect(redis.keysHolding("t:d:")).toEqual([
      "t:d:2001:db8:5:6::1:1",
      `t:d:${NETWORK}:1`,
    ]);
    expect(redis.membersOf("t:d:2001:db8:5:6::1:1")).toHaveLength(4);
  });

  test("one address is still held to its own limit", async () => {
    for (let value: number = 1; value <= PER_ADDRESS; value++) {
      expect(await present(hostOf(1), `value-${value}`)).toBeNull();
    }

    expect(await present(hostOf(1), "value-4")).toEqual({
      scope: "wrong key",
      ipv6Network64: undefined,
      isFirstRefusalInWindow: true,
    });
  });

  test("a host that presents each value from another address of its /64 is held to ten addresses' worth", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(PER_ADDRESS);
    const refusals: Array<ClientRateLimitRefusal<Scope> | null> = [];

    for (let host: number = 1; host <= 200; host++) {
      refusals.push(await present(hostOf(host), `value-${host}`));
    }

    expect(networkLimit).toBe(30);
    expect(
      refusals.filter(
        (refusal: ClientRateLimitRefusal<Scope> | null): boolean => {
          return refusal === null;
        },
      ).length,
    ).toBe(networkLimit);
    expect(refusals[networkLimit]).toEqual({
      scope: "wrong key",
      ipv6Network64: NETWORK,
      isFirstRefusalInWindow: true,
    });

    for (const later of refusals.slice(networkLimit + 1)) {
      expect(later).toEqual({
        scope: "wrong key",
        ipv6Network64: NETWORK,
        isFirstRefusalInWindow: false,
      });
    }
  });

  test("one value from address after address of a /64 is one value of the /64's", async () => {
    for (let host: number = 1; host <= 200; host++) {
      expect(await present(hostOf(host), "the-old-key")).toBeNull();
    }

    expect(redis.membersOf(`t:d:${NETWORK}:1`)).toEqual(["the-old-key"]);
  });

  test("once its /64 is over, its new addresses are refused without a set being made for each", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(PER_ADDRESS);

    for (let host: number = 1; host <= networkLimit + 1; host++) {
      await present(hostOf(host), `value-${host}`);
    }

    const keysWhenFull: number = redis.keys().length;

    for (let host: number = 1000; host < 1500; host++) {
      expect((await present(hostOf(host), `value-${host}`))?.ipv6Network64).toBe(
        NETWORK,
      );
      expect((await present(hostOf(host), null))?.ipv6Network64).toBe(NETWORK);
    }

    expect(redis.keys().length).toBe(keysWhenFull);
    expect(redis.membersOf(`t:d:${NETWORK}:1`)).toHaveLength(networkLimit + 1);
  });

  test("the address counts first: an address over its own limit never spends its /64's allowance", async () => {
    // A noisy neighbour tries value after value from one address.
    for (let value: number = 1; value <= 500; value++) {
      await present(hostOf(1), `noisy-${value}`);
    }

    // Only the values its address was let through reached the /64.
    expect(redis.membersOf(`t:d:${NETWORK}:1`)).toHaveLength(PER_ADDRESS);

    const networkLimit: number = getIpv6NetworkRateLimit(PER_ADDRESS);
    const othersAllowed: number = await allowedOf(
      Array.from({ length: networkLimit }, (_value: unknown, index: number) => {
        return (): Promise<ClientRateLimitRefusal<Scope> | null> => {
          return present(hostOf(100 + index), `other-${index}`);
        };
      }),
    );

    expect(othersAllowed).toBe(networkLimit - PER_ADDRESS);
  });

  test("a full /64 refuses only itself: another /64, and IPv4, keep their allowance", async () => {
    for (let host: number = 1; host <= 100; host++) {
      await present(hostOf(host), `value-${host}`);
    }

    expect((await present(hostOf(101), "value-101"))?.ipv6Network64).toBe(
      NETWORK,
    );
    expect(await present(hostOf(1, "2001:db8:5:7"), "value-1")).toBeNull();
    expect(await present("203.0.113.7", "value-1")).toBeNull();
  });

  test("a caller may give a /64 its own limit", async () => {
    const allowed: number = await allowedOf(
      Array.from({ length: 50 }, (_value: unknown, index: number) => {
        return (): Promise<ClientRateLimitRefusal<Scope> | null> => {
          return present(hostOf(index + 1), `value-${index}`, {
            counter: { ...counter, ipv6NetworkLimit: 7 },
          });
        };
      }),
    );

    expect(allowed).toBe(7);
  });

  test("values that arrive together are held to the /64's allowance: the check and the add are one step", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(PER_ADDRESS);

    const refusals: Array<ClientRateLimitRefusal<Scope> | null> =
      await Promise.all(
        Array.from({ length: 300 }, (_value: unknown, index: number) => {
          return present(hostOf(index + 1), `value-${index}`);
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

  test("a check sent with a burst of values is answered after the values sent before it", async () => {
    const answers: Array<ClientRateLimitRefusal<Scope> | null> =
      await Promise.all([
        ...Array.from({ length: PER_ADDRESS + 1 }, (_value: unknown, index) => {
          return present("203.0.113.9", `burst-${index}`);
        }),
        present("203.0.113.9", null),
      ]);

    expect(answers[answers.length - 1]?.scope).toBe("wrong key");
  });
});

describe("a count that cannot be made is an error for the caller to handle", () => {
  test("a script that fails, as a dropped connection does", async () => {
    redis.failNextExec = new Error("connection reset");

    await expect(present("203.0.113.7", "value-1")).rejects.toThrow(
      "connection reset",
    );
  });

  test("a script Valkey refuses to run", async () => {
    redis.failCommand = (command: FakeCounterCommand): Error | null => {
      return command.name === "eval" ? new Error("NOSCRIPT") : null;
    };

    await expect(present(hostOf(1), null)).rejects.toThrow("NOSCRIPT");
  });

  test.each([
    ["no answer", null],
    ["nothing in it", []],
    ["one number", [0]],
    ["three numbers", [0, 0, 0]],
    ["text", ["0", "0"]],
    ["a fraction", [0.5, 0]],
    ["a refusal by nothing it names", [3, 1]],
  ])(
    "an answer that is not the script's: %s",
    async (_label: string, answer: unknown) => {
      redis.answerNextExecWith = answer;

      await expect(present(hostOf(1), "value-1")).rejects.toThrow(
        "The different values counter answered something else",
      );
    },
  );

  test("a refusal by a /64 for a client that has none is not the script's either", async () => {
    redis.answerNextExecWith = [2, 1];

    await expect(present("203.0.113.7", "value-1")).rejects.toThrow(
      "The different values counter answered something else",
    );
  });

  test("an empty value is refused before anything is sent: it would read as a check", async () => {
    await expect(present("203.0.113.7", "")).rejects.toThrow(
      "An empty value cannot be counted as a different one",
    );
    expect(redis.sent).toEqual([]);
  });
});
