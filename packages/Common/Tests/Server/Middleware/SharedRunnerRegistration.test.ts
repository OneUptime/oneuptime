import {
  OPERATOR_CLUSTER_KEYS,
  readExampleEnvPlaceholders,
  restoreClusterKey,
  setClusterKey,
} from "../TestingUtils/ShippedClusterKeys";
import {
  OPERATOR_RUNNER_KEY,
  OTHER_INSTALLATION_RUNNER_KEY,
  restoreSharedRunnerKey,
  setSharedRunnerKey,
} from "../TestingUtils/SharedRunnerKeys";
import FakeCounterRedis from "../TestingUtils/Redis/FakeCounterRedis";
import type ClusterKeyAuthorizationType from "../../../Server/Middleware/ClusterKeyAuthorization";
import { WRONG_COMPONENT_KEYS_PER_ADDRESS } from "../../../Server/Utils/RateLimit/WrongComponentKeyLimit";
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
import type { SpiedFunction } from "jest-mock";

/*
 * THE SHARED RUNNER REGISTERS WITH ITS OWN KEY, AND HOLDS NO CLUSTER KEY.
 *
 * The shared Runner's registration (POST /api/ai-agent/register) is
 * ClusterKeyAuthorization.isAuthorizedRunnerRegistrationMiddleware. Driven
 * here as a request reaches it through the bundled Nginx, in a fresh copy of
 * the product loaded with the operator's own ONEUPTIME_SECRET and the
 * ONEUPTIME_RUNNER_KEY its deployment gives the app, against a Redis that
 * runs the counter's script as Valkey does:
 *
 *   - a request that carries no cluster key - in a header, an earlier
 *     release's body field or the URL - is let through when the key it
 *     registers with (aiAgentKey) is the one the app holds, compared in
 *     constant time and never a value the repository ships;
 *   - a wrong one is refused, and counted for the client: ten different
 *     wrong keys, then every registration it sends is refused until the
 *     window ends, the right key too; a Runner that keeps sending one old
 *     key is never refused for it;
 *   - an app that holds no key of its own lets no Runner register with one;
 *   - a request that carries a cluster key is decided by it, as before: a
 *     Runner of an earlier release, or one whose deployment still gives it
 *     ONEUPTIME_SECRET, registers with it and the app logs that it should be
 *     updated; a cluster key in a URL is refused whatever else is sent.
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

interface Installation {
  ClusterKeyAuthorization: ClusterKeyAuthorizationClass;
  messages: Record<string, string>;
}

const OPERATOR_CLUSTER_KEY: string = OPERATOR_CLUSTER_KEYS[0]!.value!;

const CLIENT: string = "203.0.113.70";
const OTHER_CLIENT: string = "198.51.100.71";

/*
 * One app process, with this ONEUPTIME_RUNNER_KEY (undefined for none) and
 * the operator's own ONEUPTIME_SECRET.
 */
function loadInstallation(runnerKey: string | undefined): Installation {
  setClusterKey(OPERATOR_CLUSTER_KEY);
  setSharedRunnerKey(runnerKey);

  let loaded: Installation | null = null;

  try {
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      const middleware: JSONObject = require("../../../Server/Middleware/ClusterKeyAuthorization");
      const runnerKeyModule: JSONObject = require("../../../Server/Middleware/SharedRunnerKeyAuthorization");
      const limits: JSONObject = require("../../../Server/Utils/RateLimit/WrongComponentKeyLimit");
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

      loaded = {
        ClusterKeyAuthorization: middleware[
          "default"
        ] as unknown as ClusterKeyAuthorizationClass,
        messages: {
          notSet: runnerKeyModule[
            "SHARED_RUNNER_KEY_NOT_SET_MESSAGE"
          ] as string,
          missing: runnerKeyModule[
            "SHARED_RUNNER_KEY_MISSING_MESSAGE"
          ] as string,
          shipped: runnerKeyModule[
            "SHIPPED_SHARED_RUNNER_KEY_MESSAGE"
          ] as string,
          wrong: runnerKeyModule["WRONG_SHARED_RUNNER_KEY_MESSAGE"] as string,
          tooMany: limits["WRONG_SHARED_RUNNER_KEYS_MESSAGE"] as string,
          invalidClusterKey: middleware[
            "INVALID_CLUSTER_KEY_MESSAGE"
          ] as string,
          clusterKeyInUrl: middleware["CLUSTER_KEY_IN_URL_MESSAGE"] as string,
          runnerClusterKey: middleware["RUNNER_CLUSTER_KEY_MESSAGE"] as string,
          olderRunner: middleware["OLDER_RUNNER_CLUSTER_KEY_MESSAGE"] as string,
        },
      };
    });
  } finally {
    restoreClusterKey();
    restoreSharedRunnerKey();
  }

  return loaded!;
}

interface Outcome {
  passed: boolean;
  status: number | null;
  message: string | null;
  retryAfter: string | null;
}

interface FakeRequest {
  headers?: JSONObject;
  body?: unknown;
  query?: JSONObject;
  params?: JSONObject;
}

// A registration as it reaches the app through the bundled Nginx.
async function register(
  installation: Installation,
  from: string,
  request: FakeRequest,
): Promise<Outcome> {
  let passed: boolean = false;
  let status: number | null = null;
  let body: JSONObject | null = null;
  const responseHeaders: Record<string, string> = {};

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
      responseHeaders[name] = value;
    },
  } as unknown as JSONObject;

  await installation.ClusterKeyAuthorization.isAuthorizedRunnerRegistrationMiddleware(
    {
      headers: { "x-forwarded-for": from, ...(request.headers || {}) },
      socket: { remoteAddress: "10.0.0.2" },
      query: request.query || {},
      params: request.params || {},
      body: request.body === undefined ? {} : request.body,
    } as never,
    res as never,
    (): void => {
      passed = true;
    },
  );

  return {
    passed: passed,
    status: status,
    message: body ? ((body as JSONObject)["message"] as string) : null,
    retryAfter: responseHeaders["Retry-After"] || null,
  };
}

function withRunnerKey(key: unknown): FakeRequest {
  return {
    body: {
      aiAgentKey: key,
      runnerName: "shared-runner",
      aiAgentDescription: "The shared Runner",
    },
  };
}

const LET_THROUGH: Outcome = {
  passed: true,
  status: null,
  message: null,
  retryAfter: null,
};

function refusedWith(message: string): Outcome {
  return { passed: false, status: 400, message: message, retryAfter: null };
}

let redis: FakeCounterRedis;

beforeEach(() => {
  redis = new FakeCounterRedis();
  mockRedisState.client = redis;
  mockRedisState.connected = true;
  mockWarnings.length = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  restoreClusterKey();
  restoreSharedRunnerKey();
});

describe("an app whose deployment gave it the shared Runner's key", () => {
  const app: Installation = loadInstallation(OPERATOR_RUNNER_KEY);

  test("lets the Runner of this release register with that key, with no cluster key, and says nothing", async () => {
    expect(
      await register(app, CLIENT, withRunnerKey(OPERATOR_RUNNER_KEY)),
    ).toStrictEqual(LET_THROUGH);
    expect(mockWarnings).toStrictEqual([]);
  });

  test("compares the key in constant time, over digests of the same length", async () => {
    const compare: SpiedFunction<typeof crypto.timingSafeEqual> = jest.spyOn(
      crypto,
      "timingSafeEqual",
    );

    await register(app, CLIENT, withRunnerKey("a-short-wrong-key"));
    await register(app, CLIENT, withRunnerKey(OPERATOR_RUNNER_KEY));

    expect(compare).toHaveBeenCalledTimes(2);

    for (const call of compare.mock.calls) {
      expect((call[0] as Buffer).length).toBe(32);
      expect((call[1] as Buffer).length).toBe(32);
    }
  });

  test("refuses another key: another installation's, a near miss, another case, padded", async () => {
    for (const wrong of [
      OTHER_INSTALLATION_RUNNER_KEY,
      OPERATOR_RUNNER_KEY.slice(0, -1),
      `${OPERATOR_RUNNER_KEY}0`,
      OPERATOR_RUNNER_KEY.toUpperCase(),
      ` ${OPERATOR_RUNNER_KEY}`,
      encodeURIComponent(` ${OPERATOR_RUNNER_KEY}`),
    ]) {
      expect(
        await register(app, OTHER_CLIENT, withRunnerKey(wrong)),
      ).toStrictEqual(refusedWith(app.messages.wrong!));
    }
  });

  test("ten different wrong keys from one client, then every registration it sends is refused until the window ends, the right key too", async () => {
    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      expect(
        await register(app, CLIENT, withRunnerKey(`guess-${index}`)),
      ).toStrictEqual(refusedWith(app.messages.wrong!));
    }

    for (const key of ["guess-eleven", "guess-0", OPERATOR_RUNNER_KEY]) {
      const outcome: Outcome = await register(app, CLIENT, withRunnerKey(key));

      expect(outcome.passed).toBe(false);
      expect(outcome.status).toBe(429);
      expect(outcome.message).toBe(app.messages.tooMany);
      expect(Number(outcome.retryAfter)).toBeGreaterThanOrEqual(1);
    }

    // Another client, with the right key: let through.
    expect(
      await register(app, OTHER_CLIENT, withRunnerKey(OPERATOR_RUNNER_KEY)),
    ).toStrictEqual(LET_THROUGH);
  });

  test("its right key is never counted: a Runner that registers again and again leaves its address all ten of its wrong keys", async () => {
    for (let call: number = 0; call < 50; call++) {
      expect(
        await register(app, CLIENT, withRunnerKey(OPERATOR_RUNNER_KEY)),
      ).toStrictEqual(LET_THROUGH);
    }

    expect(redis.sets.size).toBe(0);

    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      expect(
        await register(app, CLIENT, withRunnerKey(`guess-${index}`)),
      ).toStrictEqual(refusedWith(app.messages.wrong!));
    }

    // Ten wrong ones, and no more: the right key still registers.
    expect(
      await register(app, CLIENT, withRunnerKey(OPERATOR_RUNNER_KEY)),
    ).toStrictEqual(LET_THROUGH);
  });

  test("a Runner that keeps sending one old key is never refused for it, and registers the moment it has the right one", async () => {
    for (let call: number = 0; call < 200; call++) {
      expect(
        await register(app, CLIENT, withRunnerKey("the-key-before-it-changed")),
      ).toStrictEqual(refusedWith(app.messages.wrong!));
    }

    expect(
      await register(app, CLIENT, withRunnerKey(OPERATOR_RUNNER_KEY)),
    ).toStrictEqual(LET_THROUGH);
  });

  test("a value the repository ships is refused before it is compared, and never counted", async () => {
    const shipped: Array<string> = [
      "secret",
      "  secret ",
      ...readExampleEnvPlaceholders(),
    ];

    for (const value of shipped) {
      expect(await register(app, CLIENT, withRunnerKey(value))).toStrictEqual(
        refusedWith(app.messages.shipped!),
      );
    }

    expect(redis.sets.size).toBe(0);
    expect(
      await register(app, CLIENT, withRunnerKey(OPERATOR_RUNNER_KEY)),
    ).toStrictEqual(LET_THROUGH);
  });

  test("a missing key, or one that is not text, is answered as missing, and never counted", async () => {
    for (const request of [
      { body: {} },
      { body: [] },
      { body: "aiAgentKey" },
      { body: null },
      withRunnerKey(""),
      withRunnerKey(12345),
      withRunnerKey([OPERATOR_RUNNER_KEY]),
      withRunnerKey({ key: OPERATOR_RUNNER_KEY }),
    ] as Array<FakeRequest>) {
      expect(await register(app, CLIENT, request)).toStrictEqual(
        refusedWith(app.messages.missing!),
      );
    }

    expect(redis.sets.size).toBe(0);
  });

  test("reads the Runner's key from the body alone: never from a header or the URL", async () => {
    for (const request of [
      { headers: { aiagentkey: OPERATOR_RUNNER_KEY } },
      { query: { aiAgentKey: OPERATOR_RUNNER_KEY } },
      { params: { aiAgentKey: OPERATOR_RUNNER_KEY } },
    ] as Array<FakeRequest>) {
      expect(await register(app, CLIENT, request)).toStrictEqual(
        refusedWith(app.messages.missing!),
      );
    }
  });

  test("a Runner of an earlier release registers with the cluster key in the header, whatever its own key, and the app says to update it", async () => {
    for (const ownKey of [OPERATOR_RUNNER_KEY, "an-older-runner-key", ""]) {
      mockWarnings.length = 0;

      expect(
        await register(app, CLIENT, {
          headers: {
            clusterkey: encodeURIComponent(OPERATOR_CLUSTER_KEY),
          },
          body: { aiAgentKey: ownKey },
        }),
      ).toStrictEqual(LET_THROUGH);
      expect(mockWarnings).toStrictEqual([app.messages.runnerClusterKey]);
    }

    // Its own key was never compared, so nothing was counted for it.
    expect(redis.keysHolding("shared-runner-key:")).toStrictEqual([]);
  });

  test("the oldest Runners, with the cluster key in the body, register too, and are told to update", async () => {
    expect(
      await register(app, CLIENT, {
        body: {
          aiAgentKey: "an-older-runner-key",
          clusterKey: encodeURIComponent(OPERATOR_CLUSTER_KEY),
        },
      }),
    ).toStrictEqual(LET_THROUGH);
    expect(mockWarnings).toStrictEqual([app.messages.olderRunner]);
  });

  test("a request that carries a cluster key is decided by it: a wrong one is refused, the right Runner key beside it changes nothing", async () => {
    expect(
      await register(app, CLIENT, {
        headers: { clusterkey: "a-wrong-cluster-key" },
        body: { aiAgentKey: OPERATOR_RUNNER_KEY },
      }),
    ).toStrictEqual(refusedWith(app.messages.invalidClusterKey!));
    expect(
      await register(app, CLIENT, {
        body: {
          aiAgentKey: OPERATOR_RUNNER_KEY,
          clusterKey: "a-wrong-cluster-key",
        },
      }),
    ).toStrictEqual(refusedWith(app.messages.invalidClusterKey!));
  });

  test("a cluster key in the URL is refused, whatever else the request carries", async () => {
    for (const request of [
      {
        query: { clusterkey: encodeURIComponent(OPERATOR_CLUSTER_KEY) },
        body: { aiAgentKey: OPERATOR_RUNNER_KEY },
      },
      {
        params: { clusterKey: "anything" },
        body: { aiAgentKey: OPERATOR_RUNNER_KEY },
      },
    ] as Array<FakeRequest>) {
      expect(await register(app, CLIENT, request)).toStrictEqual(
        refusedWith(app.messages.clusterKeyInUrl!),
      );
    }
  });

  test("with Valkey away, keys are compared as always: never refused for how many were wrong", async () => {
    mockRedisState.connected = false;

    for (let index: number = 0; index < 50; index++) {
      expect(
        await register(app, CLIENT, withRunnerKey(`guess-${index}`)),
      ).toStrictEqual(refusedWith(app.messages.wrong!));
    }

    expect(
      await register(app, CLIENT, withRunnerKey(OPERATOR_RUNNER_KEY)),
    ).toStrictEqual(LET_THROUGH);
  });
});

describe.each([
  ["none", undefined],
  ["blank", "  "],
  ["secret", "secret"],
  ["the config.example.env placeholder", "please-change-this-to-random-value"],
])(
  "an app whose ONEUPTIME_RUNNER_KEY is %s",
  (_label: string, configured: string | undefined) => {
    const app: Installation = loadInstallation(configured);

    test("lets no Runner register with a key of its own, whatever it presents, and counts nothing", async () => {
      for (const presented of [
        OPERATOR_RUNNER_KEY,
        "secret",
        "please-change-this-to-random-value",
        configured === undefined ? "" : configured,
      ]) {
        expect(
          await register(app, CLIENT, withRunnerKey(presented)),
        ).toStrictEqual(refusedWith(app.messages.notSet!));
      }

      expect(redis.sets.size).toBe(0);
      expect(app.messages.notSet).toContain("ONEUPTIME_RUNNER_KEY");
    });

    test("still lets a Runner register with the cluster key, as Runners of earlier releases do", async () => {
      expect(
        await register(app, CLIENT, {
          headers: {
            clusterkey: encodeURIComponent(OPERATOR_CLUSTER_KEY),
          },
          body: { aiAgentKey: OPERATOR_RUNNER_KEY },
        }),
      ).toStrictEqual(LET_THROUGH);
    });
  },
);
