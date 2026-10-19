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
 * Wrong probe, Runner and AI agent keys, counted by Valkey itself.
 *
 * WrongComponentKeyLimit's sets on a real server: a component's sets, under
 * its id in a hash tag, given their lifetime once; the different wrong keys
 * a client presents for one component counted apart from every other
 * component's; the right key never counted, and refused once the client is
 * over the limit; an IPv6 /64 counted with room for ten addresses; nothing of
 * a key but its digest kept. And a connection that stops answering - its
 * socket open, nothing coming back, as a stalled Valkey or a dead proxy
 * leaves it - is not waited for past WRONG_KEY_COUNT_TIMEOUT_MS: keys are
 * compared as always meanwhile, and counted again on a Valkey that answers.
 * WrongComponentKeyLimit.test.ts holds the same rules to the stand-in.
 *
 * It needs Valkey: CI's test-setup.sh starts one on localhost:6310. Locally,
 * a disposable one:
 *
 *   docker run -d --rm -p 16395:6379 valkey/valkey:9.1-alpine
 *   CLIENT_RATE_LIMIT_TEST_REDIS_URL=redis://localhost:16395 \
 *     npx jest Tests/Server/Utils/RateLimit/WrongComponentKeyLimitValkey.test.ts
 *
 * Every client here is an address or a /64 of this run's own, and every
 * component an id of this run's own; the keys this suite wrote are removed
 * after each test.
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
import { ExpressRequest } from "../../../../Server/Utils/Express";
import WrongComponentKeyLimit, {
  ComponentKeyKind,
  WRONG_COMPONENT_KEYS_PER_ADDRESS,
  WRONG_COMPONENT_KEY_WINDOW_SECONDS,
} from "../../../../Server/Utils/RateLimit/WrongComponentKeyLimit";
import {
  WRONG_KEY_COUNT_TIMEOUT_MS,
  WrongKeyRefusal,
} from "../../../../Server/Utils/RateLimit/WrongKeyLimit";
import {
  TestRedisClient,
  connectTestRedis,
} from "../../TestingUtils/Redis/TestRedisClient";
import getTestRedisConnectionOptions from "../../TestingUtils/Redis/TestRedisOptions";
import { Redis as IoRedis, RedisOptions } from "ioredis";
import net from "net";

let client: TestRedisClient;

/*
 * This run's own /64 in the documentation range, IPv4 addresses of its own
 * in 198.18.0.0/15, and component ids of its own: random, so two runs
 * against one Valkey never count each other's keys.
 */
const RUN_HIGH: number = Math.floor(Math.random() * 0xffff);
const RUN_LOW: number = Math.floor(Math.random() * 0xfffe);
const PREFIX: string = `2001:db8:${RUN_HIGH.toString(16)}:${RUN_LOW.toString(16)}`;
const IPV4_RUN: number = Math.floor(Math.random() * 512);
const ID_RUN: string = Math.floor(Math.random() * 0xffffffff)
  .toString(16)
  .padStart(8, "0");

function hostOf(index: number): string {
  return `${PREFIX}:${(index >> 16).toString(16)}:${(index & 0xffff).toString(16)}:c:d`;
}

function ipv4Of(index: number): string {
  return `198.${18 + (IPV4_RUN >> 8)}.${IPV4_RUN & 0xff}.${index}`;
}

// Component `index` of this run.
function componentOf(index: number): string {
  return `${ID_RUN}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

// The clock stands at the start of a window: the whole test counts in one.
const NOW: number =
  Date.now() -
  (Date.now() % (WRONG_COMPONENT_KEY_WINDOW_SECONDS * 1000)) +
  1000;

function requestFrom(address: string): ExpressRequest {
  return {
    headers: { "x-forwarded-for": address },
    socket: { remoteAddress: "10.0.0.2" },
    query: {},
    params: {},
    body: {},
  } as unknown as ExpressRequest;
}

async function present(data: {
  from: string;
  component: string;
  key: string;
  isKeyRight: boolean;
  kind?: ComponentKeyKind.Probe | ComponentKeyKind.Agent;
}): Promise<WrongKeyRefusal | null> {
  return await WrongComponentKeyLimit.checkComponentKey({
    req: requestFrom(data.from),
    kind: data.kind ?? ComponentKeyKind.Probe,
    componentId: data.component,
    presentedKey: data.key,
    isKeyRight: data.isKeyRight,
    componentExists: async (): Promise<boolean> => {
      return true;
    },
  });
}

async function removeWrittenKeys(): Promise<void> {
  for (const pattern of [
    `probe-key:wrong-keys:{${ID_RUN}-*`,
    `agent-key:wrong-keys:{${ID_RUN}-*`,
  ]) {
    const keys: Array<string> = await client.keys(pattern);

    if (keys.length > 0) {
      await client.del(...keys);
    }
  }
}

/*
 * Where the real Valkey is, and how to sign in to it, as connectTestRedis
 * connects.
 */
function upstreamConnectionOptions(): RedisOptions {
  const url: string | undefined =
    process.env["CLIENT_RATE_LIMIT_TEST_REDIS_URL"];

  if (!url) {
    return getTestRedisConnectionOptions();
  }

  const parsed: URL = new URL(url);

  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    ...(parsed.username
      ? { username: decodeURIComponent(parsed.username) }
      : {}),
    ...(parsed.password
      ? { password: decodeURIComponent(parsed.password) }
      : {}),
  };
}

interface FreezableProxy {
  port: number;
  // From now on nothing is passed on, either way.
  freeze: () => void;
  close: () => Promise<void>;
}

// A TCP proxy in front of the real Valkey, for one connection of this suite's own.
async function startFreezableProxy(): Promise<FreezableProxy> {
  const upstream: RedisOptions = upstreamConnectionOptions();
  const sockets: Array<net.Socket> = [];
  let frozen: boolean = false;

  const server: net.Server = net.createServer((downstream: net.Socket) => {
    const valkey: net.Socket = net.connect(
      Number(upstream.port),
      String(upstream.host),
    );

    sockets.push(downstream, valkey);

    downstream.on("data", (chunk: Buffer) => {
      if (!frozen) {
        valkey.write(chunk);
      }
    });
    valkey.on("data", (chunk: Buffer) => {
      if (!frozen) {
        downstream.write(chunk);
      }
    });

    for (const socket of [downstream, valkey]) {
      socket.on("error", (): void => {});
    }

    downstream.on("close", () => {
      valkey.destroy();
    });
    valkey.on("close", () => {
      downstream.destroy();
    });
  });

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as net.AddressInfo).port,
    freeze: (): void => {
      frozen = true;
    },
    close: async (): Promise<void> => {
      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
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

describe("a component's wrong keys, on a real Valkey", () => {
  test("ten different wrong keys for a probe, the next refused, its right key too; another probe and another client are not", async () => {
    const address: string = ipv4Of(30);
    const probe: string = componentOf(1);

    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      expect(
        await present({
          from: address,
          component: probe,
          key: `guess-${index}`,
          isKeyRight: false,
        }),
      ).toBeNull();
    }

    const refused: WrongKeyRefusal | null = await present({
      from: address,
      component: probe,
      key: "guess-eleven",
      isKeyRight: false,
    });

    expect(refused).toEqual({
      retryAfterSeconds: WRONG_COMPONENT_KEY_WINDOW_SECONDS - 1,
    });
    expect(
      await present({
        from: address,
        component: probe,
        key: "right",
        isKeyRight: true,
      }),
    ).not.toBeNull();
    expect(
      await present({
        from: address,
        component: componentOf(2),
        key: "right",
        isKeyRight: true,
      }),
    ).toBeNull();
    expect(
      await present({
        from: ipv4Of(31),
        component: probe,
        key: "right",
        isKeyRight: true,
      }),
    ).toBeNull();

    // One set, under the probe's id in a hash tag, with its lifetime, holding digests.
    const sets: Array<string> = await client.keys(
      `probe-key:wrong-keys:{${probe}}:${address}:*`,
    );

    expect(sets).toHaveLength(1);

    const ttl: number = await client.ttl(sets[0]!);

    expect(ttl).toBeGreaterThan(WRONG_COMPONENT_KEY_WINDOW_SECONDS);
    expect(ttl).toBeLessThanOrEqual(WRONG_COMPONENT_KEY_WINDOW_SECONDS * 2);

    const kept: Array<string> = await client.smembers(sets[0]!);

    expect(kept).toHaveLength(WRONG_COMPONENT_KEYS_PER_ADDRESS + 1);

    for (const value of kept) {
      expect(value).toMatch(/^[0-9a-f]{64}$/);
      expect(value).not.toContain("guess");
    }
  });

  test("one old key, again and again, is one value: never refused", async () => {
    const address: string = ipv4Of(32);
    const agent: string = componentOf(3);

    for (let call: number = 0; call < 60; call++) {
      expect(
        await present({
          from: address,
          component: agent,
          kind: ComponentKeyKind.Agent,
          key: "the-key-before-the-reset",
          isKeyRight: false,
        }),
      ).toBeNull();
    }

    const sets: Array<string> = await client.keys(
      `agent-key:wrong-keys:{${agent}}:${address}:*`,
    );

    expect(await client.scard(sets[0]!)).toBe(1);
  });

  test("keys from a private network address, where OneUptime's own probes call from, write nothing and are never refused", async () => {
    const probe: string = componentOf(6);

    for (const address of ["172.18.0.1", "10.42.0.17", "fd00:12:34::8"]) {
      for (
        let index: number = 0;
        index < WRONG_COMPONENT_KEYS_PER_ADDRESS * 3;
        index++
      ) {
        expect(
          await present({
            from: address,
            component: probe,
            key: `guess-${index}`,
            isKeyRight: false,
          }),
        ).toBeNull();
      }

      expect(
        await present({
          from: address,
          component: probe,
          key: "right",
          isKeyRight: true,
        }),
      ).toBeNull();
    }

    expect(
      await client.keys(`probe-key:wrong-keys:{${probe}}:*`),
    ).toStrictEqual([]);
  });

  test("many different wrong keys at once: exactly ten get past the limit, the set holds one value past it, and the right key after them is refused", async () => {
    const address: string = ipv4Of(35);
    const probe: string = componentOf(7);

    const results: Array<WrongKeyRefusal | null> = await Promise.all(
      Array.from({ length: 40 }, (_unused: unknown, index: number) => {
        return present({
          from: address,
          component: probe,
          key: `burst-${index}`,
          isKeyRight: false,
        });
      }),
    );

    expect(
      results.filter((result: WrongKeyRefusal | null): boolean => {
        return result === null;
      }),
    ).toHaveLength(WRONG_COMPONENT_KEYS_PER_ADDRESS);

    const sets: Array<string> = await client.keys(
      `probe-key:wrong-keys:{${probe}}:${address}:*`,
    );

    expect(sets).toHaveLength(1);
    expect(await client.scard(sets[0]!)).toBe(
      WRONG_COMPONENT_KEYS_PER_ADDRESS + 1,
    );
    expect(
      await present({
        from: address,
        component: probe,
        key: "right",
        isKeyRight: true,
      }),
    ).not.toBeNull();
  });

  test("the right key writes nothing", async () => {
    const address: string = ipv4Of(33);

    for (let call: number = 0; call < 40; call++) {
      await present({
        from: address,
        component: componentOf(4),
        key: "right",
        isKeyRight: true,
      });
    }

    expect(
      await client.keys(`probe-key:wrong-keys:{${componentOf(4)}}:*`),
    ).toStrictEqual([]);
  });

  test("an IPv6 host rotating through its /64 is held to ten addresses' worth, for one probe", async () => {
    const probe: string = componentOf(5);
    const perNetwork: number = getIpv6NetworkRateLimit(
      WRONG_COMPONENT_KEYS_PER_ADDRESS,
    );
    let firstRefused: number | null = null;

    for (let index: number = 0; index < perNetwork + 20; index++) {
      const refusal: WrongKeyRefusal | null = await present({
        from: hostOf(index + 1),
        component: probe,
        key: `guess-${index}`,
        isKeyRight: false,
      });

      if (refusal && firstRefused === null) {
        firstRefused = index;
      }
    }

    expect(firstRefused).toBe(perNetwork);
    expect(
      await client.keys(`probe-key:wrong-keys:{${probe}}:*/64:*`),
    ).toHaveLength(1);
  });
});

describe("a connection that stops answering", () => {
  test(`is not waited for past ${WRONG_KEY_COUNT_TIMEOUT_MS} ms: the key is compared as always, and counting goes on with a Valkey that answers`, async () => {
    const address: string = ipv4Of(34);
    const probe: string = componentOf(6);

    /*
     * A connection of its own to the real Valkey, through a proxy that,
     * once frozen, passes nothing on: the socket stays open and every
     * command waits, as with a stalled Valkey - for this connection alone.
     */
    const proxy: FreezableProxy = await startFreezableProxy();
    const stalled: IoRedis = new IoRedis({
      ...upstreamConnectionOptions(),
      host: "127.0.0.1",
      port: proxy.port,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: (): null => {
        return null;
      },
    });

    try {
      await stalled.connect();
      proxy.freeze();

      jest
        .mocked(Redis.getClient)
        .mockReturnValue(
          stalled as unknown as ReturnType<typeof Redis.getClient>,
        );

      for (const isKeyRight of [true, false]) {
        const started: number = performance.now();
        const answer: WrongKeyRefusal | null = await present({
          from: address,
          component: probe,
          key: isKeyRight ? "right" : "a-wrong-key",
          isKeyRight: isKeyRight,
        });
        const waited: number = performance.now() - started;

        expect(answer).toBeNull();
        expect(waited).toBeGreaterThanOrEqual(WRONG_KEY_COUNT_TIMEOUT_MS - 50);
        expect(waited).toBeLessThan(WRONG_KEY_COUNT_TIMEOUT_MS + 900);
      }
    } finally {
      jest
        .mocked(Redis.getClient)
        .mockReturnValue(
          client as unknown as ReturnType<typeof Redis.getClient>,
        );
      stalled.disconnect();
      await proxy.close();
    }

    // On a Valkey that answers: wrong keys are counted, and the limit holds.
    for (
      let index: number = 0;
      index <= WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      await present({
        from: address,
        component: probe,
        key: `guess-${index}`,
        isKeyRight: false,
      });
    }

    expect(
      await present({
        from: address,
        component: probe,
        key: "right",
        isKeyRight: true,
      }),
    ).not.toBeNull();
  }, 30000);
});
