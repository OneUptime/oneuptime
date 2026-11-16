import FakeCounterRedis from "../../TestingUtils/Redis/FakeCounterRedis";
import WrongIncomingRequestSecretLimit, {
  WRONG_INCOMING_REQUEST_SECRET_DIGEST_LABEL,
  WRONG_INCOMING_REQUEST_SECRETS_MESSAGE,
  WRONG_INCOMING_REQUEST_SECRETS_PER_ADDRESS,
  WRONG_INCOMING_REQUEST_SECRET_WINDOW_SECONDS,
} from "../../../../Server/Utils/RateLimit/WrongIncomingRequestSecretLimit";
import { WrongKeyRefusal } from "../../../../Server/Utils/RateLimit/WrongKeyLimit";
import { getIpv6NetworkRateLimit } from "../../../../Server/Utils/ClientIp";
import { ExpressRequest } from "../../../../Server/Utils/Express";
import TokenSigningKey from "../../../../Server/Utils/TokenSigningKey";
import IncomingRequestSecretRequest from "../../../../Server/Utils/Monitor/IncomingRequestSecretRequest";
import { JSONObject } from "../../../../Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import crypto from "crypto";

/*
 * WRONG INCOMING REQUEST SECRETS ARE COUNTED FOR THE CLIENT AND THE MONITOR
 * (issue #8499), by the rule every wrong-key limit keeps (WrongKeyLimit),
 * driven against a Redis that runs the counter's script as Valkey does:
 *
 *   - ten different wrong secrets to one monitor from one address, each
 *     answered as wrong; the next is refused, and so is every request that
 *     address sends that monitor with a secret until the window ends;
 *   - the real sender, at another address, is never refused for it: an
 *     attacker cannot lock it out from anywhere else;
 *   - nor is the over-limit address refused for another monitor;
 *   - one old secret sent again and again is one wrong secret, never a
 *     refusal;
 *   - a request packing several guesses counts each;
 *   - a private network address is never counted; Valkey away, nothing is;
 *   - what Valkey keeps is an HMAC under the installation's key, never the
 *     secret or its hash.
 */

const mockRedisState: { client: FakeCounterRedis | null; connected: boolean } =
  { client: null, connected: false };

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return mockRedisState.client;
      },
      isConnected: (): boolean => {
        return mockRedisState.connected;
      },
    },
  };
});

const mockWarnings: Array<string> = [];

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: (): void => {},
      info: (): void => {},
      warn: (message: unknown): void => {
        mockWarnings.push(
          message instanceof Error ? message.message : String(message),
        );
      },
      error: (): void => {},
    },
    getLogAttributesFromRequest: (): JSONObject => {
      return {};
    },
  };
});

const MONITOR: string = "b0b0b0b0-0000-4000-8000-0000000000b0";
const OTHER_MONITOR: string = "c0c0c0c0-0000-4000-8000-0000000000c0";

const ATTACKER: string = "203.0.113.7";
const REAL_SENDER: string = "198.51.100.23";
const NETWORK_PREFIX: string = "2001:db8:51:7";

function hostOf(index: number): string {
  return `${NETWORK_PREFIX}:${(index >> 16).toString(16)}:${(index & 0xffff).toString(16)}:c:d`;
}

// A request as it reaches the app through the bundled Nginx.
function requestFrom(address: string): ExpressRequest {
  return {
    headers: { "x-forwarded-for": address },
    socket: { remoteAddress: "10.0.0.2" },
    query: {},
    params: {},
    body: {},
  } as unknown as ExpressRequest;
}

// The hash of the index-th guess, as a request presents it.
function guess(index: number): string {
  return IncomingRequestSecretRequest.hashSecret(`a-guess-at-it-${index}`);
}

async function sendWrong(data: {
  from: string;
  monitorId?: string;
  values: Array<string>;
}): Promise<WrongKeyRefusal | null> {
  return await WrongIncomingRequestSecretLimit.countWrong({
    req: requestFrom(data.from),
    monitorId: data.monitorId ?? MONITOR,
    wrongValues: data.values,
  });
}

async function checkFirst(
  from: string,
  monitorId: string = MONITOR,
): Promise<WrongKeyRefusal | null> {
  return await WrongIncomingRequestSecretLimit.checkBeforeComparing({
    req: requestFrom(from),
    monitorId,
  });
}

let redis: FakeCounterRedis;

beforeEach(() => {
  redis = new FakeCounterRedis();
  mockRedisState.client = redis;
  mockRedisState.connected = true;
  mockWarnings.length = 0;
});

afterEach(() => {
  redis.reset();
  mockRedisState.client = null;
  mockRedisState.connected = false;
});

describe("the limit", () => {
  test("is ten different wrong secrets to one monitor from one address in a quarter of an hour", () => {
    expect(WRONG_INCOMING_REQUEST_SECRETS_PER_ADDRESS).toBe(10);
    expect(WRONG_INCOMING_REQUEST_SECRET_WINDOW_SECONDS).toBe(15 * 60);
  });

  test("says what happened and what to do", () => {
    expect(WRONG_INCOMING_REQUEST_SECRETS_MESSAGE).toMatch(/^This address/);
    expect(WRONG_INCOMING_REQUEST_SECRETS_MESSAGE).toContain("Retry-After");
    expect(WRONG_INCOMING_REQUEST_SECRETS_MESSAGE.endsWith(".")).toBe(true);
  });
});

describe("an address guessing a monitor's secret", () => {
  test("gets ten different wrong secrets, then is refused, with when it may try again", async () => {
    for (let index: number = 0; index < 10; index++) {
      expect({
        index,
        refusal: await sendWrong({ from: ATTACKER, values: [guess(index)] }),
      }).toEqual({ index, refusal: null });
    }

    const refusal: WrongKeyRefusal | null = await sendWrong({
      from: ATTACKER,
      values: [guess(10)],
    });

    expect(refusal).not.toBeNull();
    expect(refusal!.retryAfterSeconds).toBeGreaterThan(0);
    expect(refusal!.retryAfterSeconds).toBeLessThanOrEqual(
      WRONG_INCOMING_REQUEST_SECRET_WINDOW_SECONDS,
    );

    // The one refusal that took it over is logged, once.
    expect(
      mockWarnings.filter((warning: string): boolean => {
        return warning.includes(
          "different wrong incoming request secrets for monitor",
        );
      }),
    ).toHaveLength(1);
  });

  test("is then refused before its secrets are compared, whatever it sends, the right one too", async () => {
    for (let index: number = 0; index <= 10; index++) {
      await sendWrong({ from: ATTACKER, values: [guess(index)] });
    }

    expect(await checkFirst(ATTACKER)).not.toBeNull();
    // A secret it sent before, or the right one: refused the same.
    expect(
      await sendWrong({ from: ATTACKER, values: [guess(0)] }),
    ).not.toBeNull();
  });

  test("never refuses the real sender, at its own address, for that monitor", async () => {
    for (let index: number = 0; index <= 20; index++) {
      await sendWrong({ from: ATTACKER, values: [guess(index)] });
    }

    expect(await checkFirst(ATTACKER)).not.toBeNull();
    expect(await checkFirst(REAL_SENDER)).toBeNull();
  });

  test("is not refused for another monitor", async () => {
    for (let index: number = 0; index <= 10; index++) {
      await sendWrong({ from: ATTACKER, values: [guess(index)] });
    }

    expect(await checkFirst(ATTACKER, OTHER_MONITOR)).toBeNull();
    expect(
      await sendWrong({
        from: ATTACKER,
        monitorId: OTHER_MONITOR,
        values: [guess(0)],
      }),
    ).toBeNull();
  });

  test("counts each guess a request packs", async () => {
    const packed: Array<string> = [];

    for (let index: number = 0; index <= 10; index++) {
      packed.push(guess(index));
    }

    expect(await sendWrong({ from: ATTACKER, values: packed })).not.toBeNull();
  });

  test("checking first adds nothing", async () => {
    for (let index: number = 0; index < 100; index++) {
      expect(await checkFirst(ATTACKER)).toBeNull();
    }

    for (let index: number = 0; index < 10; index++) {
      expect(
        await sendWrong({ from: ATTACKER, values: [guess(index)] }),
      ).toBeNull();
    }
  });
});

describe("a sender holding an old secret", () => {
  test("sends one wrong secret however often it calls, and is never refused for it", async () => {
    for (let index: number = 0; index < 50; index++) {
      expect(
        await sendWrong({
          from: REAL_SENDER,
          values: [guess(0)],
        }),
      ).toBeNull();
    }

    expect(await checkFirst(REAL_SENDER)).toBeNull();
  });

  test("a monitor's id in any spelling is one monitor", async () => {
    for (let index: number = 0; index <= 10; index++) {
      await sendWrong({
        from: ATTACKER,
        monitorId: index % 2 === 0 ? MONITOR : MONITOR.toUpperCase(),
        values: [guess(index)],
      });
    }

    expect(await checkFirst(ATTACKER, MONITOR)).not.toBeNull();
  });
});

describe("what is never counted", () => {
  test("a private network address: the bundled probes and the installation's own senders call from one", async () => {
    for (const address of ["10.0.0.9", "192.168.1.20", "127.0.0.1"]) {
      for (let index: number = 0; index <= 20; index++) {
        expect(
          await sendWrong({ from: address, values: [guess(index)] }),
        ).toBeNull();
      }

      expect(await checkFirst(address)).toBeNull();
    }

    expect(redis.sent).toHaveLength(0);
  });

  test("anything while Valkey is away: the secret keeps out everyone else", async () => {
    mockRedisState.connected = false;

    expect(WrongIncomingRequestSecretLimit.isCounting()).toBe(false);

    for (let index: number = 0; index <= 20; index++) {
      expect(
        await sendWrong({ from: ATTACKER, values: [guess(index)] }),
      ).toBeNull();
    }

    expect(redis.sent).toHaveLength(0);
  });

  test("a request with no monitor id", async () => {
    expect(
      await sendWrong({
        from: ATTACKER,
        monitorId: "not-a-monitor",
        values: [guess(0)],
      }),
    ).toBeNull();
    expect(redis.sent).toHaveLength(0);
  });
});

describe("an IPv6 network", () => {
  test("is counted too, with room for ten addresses", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(
      WRONG_INCOMING_REQUEST_SECRETS_PER_ADDRESS,
    );

    let refusedAt: number | null = null;

    for (let index: number = 0; index <= networkLimit + 1; index++) {
      const refusal: WrongKeyRefusal | null = await sendWrong({
        from: hostOf(index),
        values: [guess(index)],
      });

      if (refusal && refusedAt === null) {
        refusedAt = index;
      }
    }

    expect(refusedAt).toBe(networkLimit);
  });
});

describe("what Valkey keeps", () => {
  test("is an HMAC of the monitor and the guess under the installation's key, never the guess", async () => {
    await sendWrong({ from: ATTACKER, values: [guess(0)] });

    const members: Array<string> = redis
      .keys()
      .flatMap((key: string): Array<string> => {
        return redis.membersOf(key);
      });

    expect(members).toEqual([
      crypto
        .createHmac(
          "sha256",
          TokenSigningKey.deriveKey(WRONG_INCOMING_REQUEST_SECRET_DIGEST_LABEL),
        )
        .update(`${MONITOR}\n${guess(0)}`, "utf8")
        .digest("hex"),
    ]);

    for (const key of redis.keys()) {
      expect(key).toContain(`{${MONITOR}}`);
      expect(key).not.toContain(guess(0));
    }

    expect(members[0]).not.toBe(guess(0));
  });
});
