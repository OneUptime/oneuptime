import {
  OPERATOR_CLUSTER_KEYS,
  readExampleEnvPlaceholders,
  restoreClusterKey,
  setClusterKey,
} from "../TestingUtils/ShippedClusterKeys";
import FakeCounterRedis, {
  FakeCounterCommand,
} from "../TestingUtils/Redis/FakeCounterRedis";
import type ClusterKeyAuthorizationType from "../../../Server/Middleware/ClusterKeyAuthorization";
import {
  WRONG_CLUSTER_KEYS_MESSAGE,
  WRONG_CLUSTER_KEYS_PER_ADDRESS,
  WRONG_CLUSTER_KEY_WINDOW_SECONDS,
} from "../../../Server/Utils/RateLimit/WrongClusterKeyLimit";
import { getIpv6NetworkRateLimit } from "../../../Server/Utils/ClientIp";
import { JSONObject } from "../../../Types/JSON";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import crypto from "crypto";

/*
 * THE ROUTES THAT TAKE THE CLUSTER KEY LIMIT THE WRONG KEYS ONE CLIENT TRIES.
 *
 * Every route that takes OneUptime's cluster key goes through one of
 * ClusterKeyAuthorization's two checks, and both go through one place. The
 * rule, driven here through the real checks with requests as they arrive
 * through the bundled Nginx (X-Forwarded-For ending with the address it saw)
 * and a Redis that runs the counter's script as Valkey does:
 *
 *   - a client may present ten different wrong keys in a quarter of an hour,
 *     each answered as wrong (400); the next different wrong key is refused
 *     (429, with Retry-After), and so is every request it makes after that
 *     until the quarter of an hour ends, the right key included - nothing it
 *     sends is answered as right or wrong any more;
 *   - a key it sent before is not counted again: a service holding an old
 *     key sends it on every call and is never refused for it, and is let
 *     through the moment it has the right one;
 *   - the right key is never counted, however many requests carry it;
 *   - requests refused before a key is compared - no key, a key in the URL,
 *     a value this repository ships - count nothing;
 *   - an IPv6 /64 is counted too, with room for ten addresses;
 *   - keys sent together buy no extra tries;
 *   - what Valkey keeps of a wrong key is an HMAC under the installation's
 *     key, never the key;
 *   - with Valkey away, keys are compared as they always were.
 */

/*
 * The Redis the counter is handed, shared by every module registry here:
 * the stand-in, and whether it is connected.
 */
const mockRedisState: { client: FakeCounterRedis | null; connected: boolean } =
  { client: null, connected: false };

jest.mock("../../../Server/Infrastructure/Redis", () => {
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

// What the installation's logger was asked to warn about.
const mockWarnings: Array<string> = [];

jest.mock("../../../Server/Utils/Logger", () => {
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

type ClusterKeyAuthorizationClass = typeof ClusterKeyAuthorizationType;

type Check =
  | "isAuthorizedServiceMiddleware"
  | "isAuthorizedRunnerRegistrationMiddleware";

const OPERATOR_KEY: string = OPERATOR_CLUSTER_KEYS[0]!.value!;

const INVALID_KEY_MESSAGE: string = "Invalid cluster key provided";

const NETWORK_PREFIX: string = "2001:db8:7:8";
const NETWORK: string = "2001:db8:7:8::/64";

function hostOf(index: number, prefix: string = NETWORK_PREFIX): string {
  return `${prefix}:${(index >> 16).toString(16)}:${(index & 0xffff).toString(16)}:a:b`;
}

// The installation: the real check, loaded with the operator's own key.
function loadClusterKeyAuthorization(): ClusterKeyAuthorizationClass {
  setClusterKey(OPERATOR_KEY);

  let loaded: ClusterKeyAuthorizationClass | null = null;

  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      loaded = require("../../../Server/Middleware/ClusterKeyAuthorization")
        .default as ClusterKeyAuthorizationClass;
    });
  } finally {
    restoreClusterKey();
  }

  return loaded!;
}

const ClusterKeyAuthorization: ClusterKeyAuthorizationClass =
  loadClusterKeyAuthorization();

// The key the installation's own services send.
const RIGHT_KEY: string = ClusterKeyAuthorization.getClusterKey();

interface Outcome {
  passed: boolean;
  status: number | null;
  message: string | null;
  retryAfter: string | null;
}

// A request as it reaches the app through the bundled Nginx.
function requestFrom(
  address: string,
  carries: {
    header?: unknown;
    body?: unknown;
    query?: JSONObject;
    params?: JSONObject;
  },
): JSONObject {
  const headers: JSONObject = { "x-forwarded-for": address };

  if (carries.header !== undefined) {
    headers["clusterkey"] = carries.header as string;
  }

  return {
    headers: headers,
    socket: { remoteAddress: "10.0.0.2" } as unknown as JSONObject,
    query: carries.query || {},
    params: carries.params || {},
    body: (carries.body as JSONObject) || {},
  };
}

async function send(
  request: JSONObject,
  check: Check = "isAuthorizedServiceMiddleware",
): Promise<Outcome> {
  let passed: boolean = false;
  let status: number | null = null;
  let body: JSONObject | null = null;
  const headers: Record<string, string> = {};

  const res: JSONObject = {
    status: (code: number): JSONObject => {
      status = code;
      return res;
    },
    send: (sent: JSONObject): JSONObject => {
      body = sent;
      return res;
    },
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
  } as unknown as JSONObject;

  await ClusterKeyAuthorization[check](
    request as never,
    res as never,
    (): void => {
      passed = true;
    },
  );

  return {
    passed: passed,
    status: status,
    message: ((body as JSONObject | null)?.["message"] as string) ?? null,
    retryAfter: headers["Retry-After"] ?? null,
  };
}

// A key in the clusterkey header, from `address`.
async function present(
  address: string,
  key: unknown,
  check: Check = "isAuthorizedServiceMiddleware",
): Promise<Outcome> {
  return await send(requestFrom(address, { header: key }), check);
}

const WRONG: Outcome = {
  passed: false,
  status: 400,
  message: INVALID_KEY_MESSAGE,
  retryAfter: null,
};

const LET_THROUGH: Outcome = {
  passed: true,
  status: null,
  message: null,
  retryAfter: null,
};

function refusedFor(secondsLeft: number): Outcome {
  return {
    passed: false,
    status: 429,
    message: WRONG_CLUSTER_KEYS_MESSAGE,
    retryAfter: String(secondsLeft),
  };
}

let redis: FakeCounterRedis;
let now: number;
let testIndex: number = 0;

// The start of a window, a day further on for each test.
function windowStart(): number {
  return Date.UTC(2031, 0, 1) + testIndex * 24 * 60 * 60 * 1000;
}

beforeEach(() => {
  testIndex++;
  redis = new FakeCounterRedis();
  mockRedisState.client = redis;
  mockRedisState.connected = true;
  mockWarnings.length = 0;

  now = windowStart();
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  mockRedisState.client = null;
  mockRedisState.connected = false;
});

describe("a client that sends wrong cluster keys", () => {
  const address: string = "203.0.113.20";

  test("the right key is let through, in one round trip that counts nothing", async () => {
    expect(await present(address, RIGHT_KEY)).toEqual(LET_THROUGH);

    expect(redis.sent).toEqual([
      [
        {
          name: "eval",
          key: `cluster-key:wrong-keys:${address}:${Math.floor(now / (WRONG_CLUSTER_KEY_WINDOW_SECONDS * 1000))}`,
          keys: [
            `cluster-key:wrong-keys:${address}:${Math.floor(now / (WRONG_CLUSTER_KEY_WINDOW_SECONDS * 1000))}`,
          ],
        },
      ],
    ]);
    expect(redis.keys()).toEqual([]);
  });

  test("ten different wrong keys are each answered as wrong; the next is one too many, and from then on the right key is refused too", async () => {
    for (
      let guess: number = 1;
      guess <= WRONG_CLUSTER_KEYS_PER_ADDRESS;
      guess++
    ) {
      expect(await present(address, `guess-${guess}`)).toEqual(WRONG);
    }

    expect(await present(address, "guess-11")).toEqual(
      refusedFor(WRONG_CLUSTER_KEY_WINDOW_SECONDS),
    );

    // Nothing it sends is answered as right or wrong any more.
    expect(await present(address, RIGHT_KEY)).toEqual(
      refusedFor(WRONG_CLUSTER_KEY_WINDOW_SECONDS),
    );
    expect(await present(address, "guess-1")).toEqual(
      refusedFor(WRONG_CLUSTER_KEY_WINDOW_SECONDS),
    );
    expect(await present(address, "guess-12")).toEqual(
      refusedFor(WRONG_CLUSTER_KEY_WINDOW_SECONDS),
    );
  });

  test("Retry-After counts down to the end of the window, and the next window lets the right key through", async () => {
    for (
      let guess: number = 1;
      guess <= WRONG_CLUSTER_KEYS_PER_ADDRESS + 1;
      guess++
    ) {
      await present(address, `guess-${guess}`);
    }

    now += 10 * 60 * 1000 + 500;

    expect(await present(address, RIGHT_KEY)).toEqual(refusedFor(5 * 60));

    now = windowStart() + WRONG_CLUSTER_KEY_WINDOW_SECONDS * 1000;

    expect(await present(address, RIGHT_KEY)).toEqual(LET_THROUGH);
    expect(await present(address, "guess-12")).toEqual(WRONG);
  });

  test("an old key sent a thousand times never refuses its sender, which is let through the moment it sends the right key", async () => {
    for (let call: number = 1; call <= 1000; call++) {
      expect(await present(address, "the-key-before-it-was-changed")).toEqual(
        WRONG,
      );
    }

    expect(await present(address, RIGHT_KEY)).toEqual(LET_THROUGH);
  });

  test("while ONEUPTIME_SECRET changes, a service that sends the old key and then the new one is never refused", async () => {
    for (let call: number = 1; call <= 300; call++) {
      expect(await present(address, "the-old-key")).toEqual(WRONG);
      expect(await present(address, "the-new-key")).toEqual(WRONG);
    }

    expect(await present(address, RIGHT_KEY)).toEqual(LET_THROUGH);
  });

  test("the right key is never counted, however many requests carry it", async () => {
    for (let call: number = 1; call <= 5000; call++) {
      expect((await present(address, RIGHT_KEY)).passed).toBe(true);
    }

    expect(redis.keys()).toEqual([]);

    // Its allowance for wrong keys is untouched.
    for (
      let guess: number = 1;
      guess <= WRONG_CLUSTER_KEYS_PER_ADDRESS;
      guess++
    ) {
      expect(await present(address, `guess-${guess}`)).toEqual(WRONG);
    }
  });

  test("another address keeps its own allowance", async () => {
    for (
      let guess: number = 1;
      guess <= WRONG_CLUSTER_KEYS_PER_ADDRESS + 5;
      guess++
    ) {
      await present(address, `guess-${guess}`);
    }

    expect(await present("203.0.113.21", RIGHT_KEY)).toEqual(LET_THROUGH);
    expect(await present("203.0.113.21", "guess-1")).toEqual(WRONG);
  });

  test("the address that went over is logged once, without any key it sent", async () => {
    for (let guess: number = 1; guess <= 40; guess++) {
      await present(address, `guess-${guess}`);
    }

    await present(address, RIGHT_KEY);

    expect(mockWarnings).toHaveLength(1);
    expect(mockWarnings[0]).toBe(
      `ClusterKeyAuthorization: ${address} sent more than 10 different wrong cluster keys in 15 minutes, so its requests are refused until the window ends (wrong cluster key limit)`,
    );

    for (const line of mockWarnings) {
      expect(line).not.toContain("guess-");
      expect(line).not.toContain(RIGHT_KEY);
    }
  });

  test("keys sent together buy no extra tries: the right key sent after a burst of wrong ones is refused", async () => {
    const outcomes: Array<Outcome> = await Promise.all([
      ...Array.from({ length: 30 }, (_value: unknown, index: number) => {
        return present(address, `burst-${index}`);
      }),
      present(address, RIGHT_KEY),
    ]);

    expect(outcomes.slice(0, WRONG_CLUSTER_KEYS_PER_ADDRESS)).toEqual(
      Array.from({ length: WRONG_CLUSTER_KEYS_PER_ADDRESS }, () => {
        return WRONG;
      }),
    );
    expect(outcomes[outcomes.length - 1]).toEqual(
      refusedFor(WRONG_CLUSTER_KEY_WINDOW_SECONDS),
    );
  });

  test("the right key sent before the burst is let through", async () => {
    const outcomes: Array<Outcome> = await Promise.all([
      present(address, RIGHT_KEY),
      ...Array.from({ length: 30 }, (_value: unknown, index: number) => {
        return present(address, `burst-${index}`);
      }),
    ]);

    expect(outcomes[0]).toEqual(LET_THROUGH);
  });
});

describe("one count for every route", () => {
  const address: string = "203.0.113.30";

  test("wrong keys sent to every route and the Runner's registration, header or body, are one client's wrong keys", async () => {
    for (
      let guess: number = 1;
      guess <= WRONG_CLUSTER_KEYS_PER_ADDRESS;
      guess++
    ) {
      const outcome: Outcome =
        guess % 3 === 0
          ? await present(address, `guess-${guess}`)
          : guess % 3 === 1
            ? await present(
                address,
                `guess-${guess}`,
                "isAuthorizedRunnerRegistrationMiddleware",
              )
            : await send(
                requestFrom(address, {
                  body: { clusterKey: `guess-${guess}` },
                }),
                "isAuthorizedRunnerRegistrationMiddleware",
              );

      expect(outcome).toEqual(WRONG);
    }

    expect(
      await send(
        requestFrom(address, {
          body: { clusterKey: "guess-from-an-old-runner" },
        }),
        "isAuthorizedRunnerRegistrationMiddleware",
      ),
    ).toEqual(refusedFor(WRONG_CLUSTER_KEY_WINDOW_SECONDS));

    expect(
      await present(
        address,
        RIGHT_KEY,
        "isAuthorizedRunnerRegistrationMiddleware",
      ),
    ).toEqual(refusedFor(WRONG_CLUSTER_KEY_WINDOW_SECONDS));
    expect(await present(address, RIGHT_KEY)).toEqual(
      refusedFor(WRONG_CLUSTER_KEY_WINDOW_SECONDS),
    );
  });

  test("an older Runner's body key is let through as before, and counts nothing", async () => {
    expect(
      await send(
        requestFrom(address, { body: { clusterKey: RIGHT_KEY } }),
        "isAuthorizedRunnerRegistrationMiddleware",
      ),
    ).toEqual(LET_THROUGH);
    expect(redis.keys()).toEqual([]);
  });

  test("a body key that is not text is one wrong key, whatever it holds", async () => {
    for (const notText of [
      { the: "key" },
      ["a", "b"],
      12345,
      true,
      { clusterkey: RIGHT_KEY },
      [RIGHT_KEY],
    ]) {
      for (let call: number = 1; call <= 20; call++) {
        expect(
          await send(
            requestFrom(address, { body: { clusterKey: notText } }),
            "isAuthorizedRunnerRegistrationMiddleware",
          ),
        ).toEqual(WRONG);
      }
    }

    const sets: Array<string> = redis.keysHolding("cluster-key:wrong-keys:");

    expect(sets).toHaveLength(1);
    expect(redis.membersOf(sets[0]!)).toEqual(["not-text"]);
  });
});

describe("what is refused before a key is compared counts nothing", () => {
  const address: string = "203.0.113.40";

  test("no key, a key in the URL, or a value this repository ships", async () => {
    const shipped: Array<string> = ["secret", ...readExampleEnvPlaceholders()];

    for (let call: number = 0; call < 50; call++) {
      expect((await send(requestFrom(address, {}))).status).toBe(400);
      expect(
        (
          await send(
            requestFrom(address, {
              header: `guess-${call}`,
              query: { clusterKey: `guess-${call}` },
            }),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await send(
            requestFrom(address, {
              header: `guess-${call}`,
              params: { clusterkey: `guess-${call}` },
            }),
          )
        ).status,
      ).toBe(400);
      expect(
        (await present(address, shipped[call % shipped.length])).status,
      ).toBe(400);
    }

    expect(redis.sent).toEqual([]);
    expect(await present(address, RIGHT_KEY)).toEqual(LET_THROUGH);
  });
});

describe("an IPv6 client", () => {
  test("different wrong keys from address after address of one /64: ten addresses' worth, then the /64 is refused, the right key too", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(
      WRONG_CLUSTER_KEYS_PER_ADDRESS,
    );

    for (let host: number = 1; host <= networkLimit; host++) {
      expect(await present(hostOf(host), `guess-${host}`)).toEqual(WRONG);
    }

    expect(await present(hostOf(networkLimit + 1), "one-too-many")).toEqual(
      refusedFor(WRONG_CLUSTER_KEY_WINDOW_SECONDS),
    );
    expect(await present(hostOf(99999), RIGHT_KEY)).toEqual(
      refusedFor(WRONG_CLUSTER_KEY_WINDOW_SECONDS),
    );

    expect(
      mockWarnings.filter((line: string): boolean => {
        return line.includes(`wrong cluster key limit of ${NETWORK}`);
      }),
    ).toHaveLength(1);

    // Another /64, and IPv4, are let through.
    expect(await present(hostOf(1, "2001:db8:7:9"), RIGHT_KEY)).toEqual(
      LET_THROUGH,
    );
    expect(await present("203.0.113.50", RIGHT_KEY)).toEqual(LET_THROUGH);
  });

  test("an address over its own limit leaves its /64 the rest of its allowance", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(
      WRONG_CLUSTER_KEYS_PER_ADDRESS,
    );
    let noisyAnsweredWrong: number = 0;

    for (let guess: number = 1; guess <= 50; guess++) {
      if ((await present(hostOf(1), `noisy-${guess}`)).status === 400) {
        noisyAnsweredWrong++;
      }
    }

    expect(noisyAnsweredWrong).toBe(WRONG_CLUSTER_KEYS_PER_ADDRESS);

    let neighboursAnsweredWrong: number = 0;

    for (let host: number = 2; host <= networkLimit + 20; host++) {
      if ((await present(hostOf(host), `neighbour-${host}`)).status === 400) {
        neighboursAnsweredWrong++;
      }
    }

    expect(neighboursAnsweredWrong).toBe(
      networkLimit - WRONG_CLUSTER_KEYS_PER_ADDRESS,
    );
  });

  test("an old key from every pod of a /64 is one key", async () => {
    for (let host: number = 1; host <= 500; host++) {
      expect(await present(hostOf(host), "the-old-key")).toEqual(WRONG);
    }

    expect(await present(hostOf(501), RIGHT_KEY)).toEqual(LET_THROUGH);
  });
});

describe("what Valkey keeps of a wrong key", () => {
  test("an HMAC of it under the installation's key: never the key, nor a plain hash of it", async () => {
    const address: string = "203.0.113.60";
    const wrongKeys: Array<string> = [
      "guess-1",
      `${OPERATOR_KEY.slice(0, -1)}0`,
      encodeURIComponent("p@ss/w0rd?&=+%#;: with spaces"),
    ];

    for (const wrongKey of wrongKeys) {
      await present(address, wrongKey);
    }

    const sets: Array<string> = redis.keysHolding(address);

    expect(sets).toHaveLength(1);

    const kept: Array<string> = redis.membersOf(sets[0]!);

    expect(kept).toEqual(
      wrongKeys.map((wrongKey: string): string => {
        return crypto
          .createHmac("sha256", RIGHT_KEY)
          .update(wrongKey, "utf8")
          .digest("hex");
      }),
    );

    for (const value of kept) {
      expect(value).toMatch(/^[0-9a-f]{64}$/);
      expect(wrongKeys).not.toContain(value);
      expect(value).not.toBe(RIGHT_KEY);
      expect(wrongKeys.map(sha256)).not.toContain(value);
    }
  });
});

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

describe("when the count cannot be made, keys are compared as they always were", () => {
  const address: string = "203.0.113.70";

  test("Valkey not connected: no limit, no warning", async () => {
    mockRedisState.connected = false;

    for (let guess: number = 1; guess <= 100; guess++) {
      expect(await present(address, `guess-${guess}`)).toEqual(WRONG);
    }

    expect(await present(address, RIGHT_KEY)).toEqual(LET_THROUGH);
    expect(redis.sent).toEqual([]);
    expect(mockWarnings).toEqual([]);
  });

  test("no Valkey client at all: the same", async () => {
    mockRedisState.client = null;

    expect(await present(address, "guess-1")).toEqual(WRONG);
    expect(await present(address, RIGHT_KEY)).toEqual(LET_THROUGH);
  });

  test("a count that fails: the key is compared, and the failure logged once a minute", async () => {
    redis.failCommand = (command: FakeCounterCommand): Error | null => {
      return command.name === "eval" ? new Error("LOADING dataset") : null;
    };

    for (let guess: number = 1; guess <= 30; guess++) {
      expect(await present(address, `guess-${guess}`)).toEqual(WRONG);
    }

    expect(await present(address, RIGHT_KEY)).toEqual(LET_THROUGH);

    const failures: Array<string> = mockWarnings.filter(
      (line: string): boolean => {
        return line.includes("the wrong cluster key count failed");
      },
    );

    expect(failures).toHaveLength(1);

    now += 61 * 1000;
    await present(address, "guess-31");

    expect(
      mockWarnings.filter((line: string): boolean => {
        return line.includes("the wrong cluster key count failed");
      }),
    ).toHaveLength(2);
  });

  test("an answer that is not the counter's: the key is compared", async () => {
    redis.answerNextExecWith = "OK";

    expect(await present(address, RIGHT_KEY)).toEqual(LET_THROUGH);
  });
});
