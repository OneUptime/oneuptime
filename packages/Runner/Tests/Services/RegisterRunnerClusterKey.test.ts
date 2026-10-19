/*
 * ---------------------------------------------------------------------------
 * The shared Runner's registration: its own key, and a cluster key only from
 * a deployment of an earlier release.
 *
 * The installation's shared Runner registers as the global agent every
 * project shares (POST /api/ai-agent/register) with its ONEUPTIME_RUNNER_KEY,
 * which the app holds too. Its deployment marks it with
 * ONEUPTIME_RUNNER_SHARED=true and gives it no cluster key, so it sends none:
 * no clusterkey header, and nothing in the URL or the body but its own key.
 *
 * A Runner whose deployment still gives it ONEUPTIME_SECRET (the
 * docker-compose.yml or Helm chart of an earlier release) is the shared
 * Runner too. It sends that key as well, URI-encoded as ever, in the
 * clusterkey request header - never in the URL or the request body - so it
 * keeps registering with an app that does not hold its key yet, and says
 * once that it does not need it. A value the repository ships for
 * ONEUPTIME_SECRET ("secret", a "please-change-this-to-random-value"
 * placeholder) is never sent: that Runner registers with its own key alone.
 *
 * Each Runner here is a fresh module registry loaded with the environment
 * it names; API.post and the sleeps are recorded, not performed.
 * ---------------------------------------------------------------------------
 */

import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";

const postMock: jest.Mock = jest.fn();

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
    },
  };
});

const sleepsInMs: Array<number> = [];

jest.mock("Common/Types/Sleep", () => {
  return {
    __esModule: true,
    default: {
      sleep: async (ms: number): Promise<void> => {
        sleepsInMs.push(ms);
      },
    },
  };
});

const errorLog: Array<string> = [];
const warnLog: Array<string> = [];

jest.mock("Common/Server/Utils/Logger", () => {
  const asText: (value: unknown) => string = (value: unknown): string => {
    return value instanceof Error ? value.message : String(value);
  };

  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: (value: unknown) => {
        warnLog.push(asText(value));
      },
      error: (value: unknown) => {
        errorLog.push(asText(value));
      },
    },
  };
});

type RegisterModule = typeof import("../../Services/RegisterRunner");
type ConfigModule = typeof import("../../Config");

// The key the shared Runner registers with, as npm start or the chart makes it.
const RUNNER_KEY: string =
  "5e8b1d4f7a0c3e6b9d2f5a8c1e4b7d0a3f6c9e2b5d8a1f4c7e0b3d6a9f2c5e8b";

const SHIPPED_CLUSTER_KEYS: Array<[string, string]> = [
  [
    "the placeholder config.example.env ships",
    "please-change-this-to-random-value",
  ],
  [
    "the placeholder padded with spaces",
    " please-change-this-to-random-value ",
  ],
  [
    "a global probe's placeholder",
    "probe-1-please-change-this-to-random-value",
  ],
  ['the code\'s old fallback "secret"', "secret"],
  ['"secret" padded with spaces', "  secret  "],
  ["blank", "   "],
];

const OPERATOR_CLUSTER_KEYS: Array<[string, string]> = [
  [
    "64 hex characters",
    "3b9f1c7e5a2d48f6b0e9c3a7d1f5b8e2c6a4d0f9e3b7c1a5d8f2e6b0c4a9d3f7",
  ],
  ["one with characters that travel encoded", "p@ss/w0rd?&=+%#"],
];

const REGISTERED: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
  200,
  { _id: "2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182" },
  {},
);

interface RunnerEnvironment {
  // ONEUPTIME_RUNNER_SHARED, or undefined for none.
  shared: string | undefined;
  // ONEUPTIME_SECRET, or undefined for none.
  clusterKey: string | undefined;
}

const VARIABLES: Array<string> = [
  "ONEUPTIME_RUNNER_SHARED",
  "ONEUPTIME_SECRET",
  "ONEUPTIME_RUNNER_KEY",
];

// Runs `load` with the Runner's environment set, and puts it back after.
function withEnvironment<T>(environment: RunnerEnvironment, load: () => T): T {
  const saved: Record<string, string | undefined> = {};

  for (const name of VARIABLES) {
    saved[name] = process.env[name];
  }

  const set: (name: string, value: string | undefined) => void = (
    name: string,
    value: string | undefined,
  ): void => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  };

  set("ONEUPTIME_RUNNER_SHARED", environment.shared);
  set("ONEUPTIME_SECRET", environment.clusterKey);
  set("ONEUPTIME_RUNNER_KEY", RUNNER_KEY);

  try {
    return load();
  } finally {
    for (const name of VARIABLES) {
      set(name, saved[name]);
    }
  }
}

function loadRunner(environment: RunnerEnvironment): RegisterModule {
  return withEnvironment(environment, (): RegisterModule => {
    let loaded: RegisterModule | null = null;

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      loaded = require("../../Services/RegisterRunner");
    });

    return loaded!;
  });
}

function loadConfig(environment: RunnerEnvironment): ConfigModule {
  return withEnvironment(environment, (): ConfigModule => {
    let loaded: ConfigModule | null = null;

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      loaded = require("../../Config");
    });

    return loaded!;
  });
}

// The one request a registration sent, with its parts read back.
function sentRequest(): {
  url: URL;
  headers: unknown;
  data: JSONObject;
  whole: string;
} {
  expect(postMock).toHaveBeenCalledTimes(1);

  const request: JSONObject = postMock.mock.calls[0]![0] as JSONObject;

  return {
    url: new URL(String(request["url"])),
    headers: request["headers"],
    data: request["data"] as JSONObject,
    whole: JSON.stringify({
      url: String(request["url"]),
      headers: request["headers"] ?? null,
      data: request["data"],
    }),
  };
}

beforeEach(() => {
  postMock.mockReset();
  sleepsInMs.length = 0;
  errorLog.length = 0;
  warnLog.length = 0;
});

describe("the shared Runner of this release: ONEUPTIME_RUNNER_SHARED, and no cluster key", () => {
  test("registers with its own key alone, at /api/ai-agent/register, with no clusterkey header", async () => {
    postMock.mockResolvedValue(REGISTERED);

    const runner: RegisterModule = loadRunner({
      shared: "true",
      clusterKey: undefined,
    });

    await expect(
      runner.default.tryRegisterRunner({ maxAttempts: 1 }),
    ).resolves.toBe(true);

    const sent: ReturnType<typeof sentRequest> = sentRequest();

    expect(sent.url.pathname).toBe("/api/ai-agent/register");
    expect(sent.url.search).toBe("");
    expect(sent.headers).toBeUndefined();
    expect(Object.keys(sent.data).sort()).toStrictEqual([
      "aiAgentDescription",
      "aiAgentKey",
      "runnerName",
    ]);
    expect(sent.data["aiAgentKey"]).toBe(RUNNER_KEY);
    expect(sent.whole).not.toMatch(/clusterkey/i);
  });

  test("says nothing about a cluster key, and logs no error once registered", async () => {
    postMock.mockResolvedValue(REGISTERED);

    const runner: RegisterModule = loadRunner({
      shared: "true",
      clusterKey: undefined,
    });

    await runner.default.tryRegisterRunner({ maxAttempts: 1 });

    expect(warnLog).toStrictEqual([]);
    expect(errorLog).toStrictEqual([]);
    expect(runner.default.holdsClusterKey()).toBe(false);
  });

  test("is the shared Runner: cluster scope, which runs no repository's commands", () => {
    const config: ConfigModule = loadConfig({
      shared: "true",
      clusterKey: undefined,
    });

    expect(config.IS_SHARED_RUNNER).toBe(true);
    expect(config.IS_CLUSTER_SCOPED).toBe(true);
    expect(config.RUNS_PROJECT_AUTHORED_COMMANDS).toBe(false);
    expect(config.IS_KUBERNETES_AGENT_MODE).toBe(false);
  });

  test("a refusal from the server - a wrong key, or too many - is retried with the usual backoff, and logged", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        400,
        {
          message:
            "This Runner's ONEUPTIME_RUNNER_KEY is not the one the OneUptime app holds",
        },
        {},
      ),
    );

    const runner: RegisterModule = loadRunner({
      shared: "true",
      clusterKey: undefined,
    });

    await expect(
      runner.default.tryRegisterRunner({ maxAttempts: 3 }),
    ).resolves.toBe(false);

    expect(postMock).toHaveBeenCalledTimes(3);
    expect(sleepsInMs).toEqual([30000, 60000]);
    expect(
      errorLog.some((line: string): boolean => {
        return line.includes("Failed to register Runner. Status: 400");
      }),
    ).toBe(true);

    for (const call of postMock.mock.calls) {
      expect((call[0] as JSONObject)["headers"]).toBeUndefined();
    }
  });
});

describe("how a deployment says a Runner is the shared Runner", () => {
  test.each([["true"], ["TRUE"], [" True "]])(
    "ONEUPTIME_RUNNER_SHARED=%p makes it the shared Runner",
    (value: string) => {
      expect(
        loadConfig({ shared: value, clusterKey: undefined }).IS_CLUSTER_SCOPED,
      ).toBe(true);
    },
  );

  test.each([["false"], ["1"], ["yes"], ["on"], [""], ["   "], ["truthy"]])(
    "ONEUPTIME_RUNNER_SHARED=%p leaves a Runner that needs its id from the dashboard",
    (value: string) => {
      const config: ConfigModule = loadConfig({
        shared: value,
        clusterKey: undefined,
      });

      expect(config.IS_SHARED_RUNNER).toBe(false);
      expect(config.IS_CLUSTER_SCOPED).toBe(false);
      expect(config.RUNS_PROJECT_AUTHORED_COMMANDS).toBe(true);
    },
  );

  test("a deployment of an earlier release says so with the cluster key, and still does", () => {
    const config: ConfigModule = loadConfig({
      shared: undefined,
      clusterKey: OPERATOR_CLUSTER_KEYS[0]![1],
    });

    expect(config.IS_SHARED_RUNNER).toBe(false);
    expect(config.IS_CLUSTER_SCOPED).toBe(true);
    expect(config.RUNS_PROJECT_AUTHORED_COMMANDS).toBe(false);
  });

  test("a Runner with neither registers as the Runner its id names, never as the shared Runner", async () => {
    postMock.mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));

    const runner: RegisterModule = loadRunner({
      shared: undefined,
      clusterKey: undefined,
    });

    await expect(
      runner.default.tryRegisterRunner({ maxAttempts: 1 }),
    ).resolves.toBe(true);

    const sent: ReturnType<typeof sentRequest> = sentRequest();

    expect(sent.url.pathname).toBe("/runner-ingest/heartbeat");
    expect(sent.data["agentKey"]).toBe(RUNNER_KEY);
  });
});

describe.each(OPERATOR_CLUSTER_KEYS)(
  "a shared Runner whose deployment still gives it ONEUPTIME_SECRET, %s",
  (_label: string, clusterKey: string) => {
    test("registers with its own key, and sends that cluster key, URI-encoded, in the clusterkey header and nowhere else", async () => {
      postMock.mockResolvedValue(REGISTERED);

      const runner: RegisterModule = loadRunner({
        shared: undefined,
        clusterKey: clusterKey,
      });

      await expect(
        runner.default.tryRegisterRunner({ maxAttempts: 1 }),
      ).resolves.toBe(true);

      const sent: ReturnType<typeof sentRequest> = sentRequest();

      expect(sent.url.pathname).toBe("/api/ai-agent/register");
      expect(sent.url.search).toBe("");
      expect(sent.headers).toStrictEqual({
        clusterkey: encodeURIComponent(clusterKey),
      });
      expect(Object.keys(sent.data).sort()).toStrictEqual([
        "aiAgentDescription",
        "aiAgentKey",
        "runnerName",
      ]);
      expect(sent.data["aiAgentKey"]).toBe(RUNNER_KEY);
      expect(errorLog).toStrictEqual([]);
    });

    test("with ONEUPTIME_RUNNER_SHARED set as well, it does the same", async () => {
      postMock.mockResolvedValue(REGISTERED);

      const runner: RegisterModule = loadRunner({
        shared: "true",
        clusterKey: clusterKey,
      });

      await runner.default.tryRegisterRunner({ maxAttempts: 1 });

      expect(sentRequest().headers).toStrictEqual({
        clusterkey: encodeURIComponent(clusterKey),
      });
    });

    test("says once, however often it registers, that it holds a cluster key it does not need", async () => {
      postMock.mockResolvedValue(
        new HTTPResponse<JSONObject>(503, { message: "Not yet" }, {}),
      );

      const runner: RegisterModule = loadRunner({
        shared: undefined,
        clusterKey: clusterKey,
      });

      await runner.default.tryRegisterRunner({ maxAttempts: 4 });

      expect(postMock).toHaveBeenCalledTimes(4);
      expect(
        warnLog.filter((line: string): boolean => {
          return line === runner.CLUSTER_KEY_IN_RUNNER_ENVIRONMENT_MESSAGE;
        }),
      ).toHaveLength(1);
      expect(runner.CLUSTER_KEY_IN_RUNNER_ENVIRONMENT_MESSAGE).toContain(
        "take ONEUPTIME_SECRET out of the Runner",
      );
      // The message names the setting, never its value.
      expect(warnLog.join("\n")).not.toContain(clusterKey);
      expect(warnLog.join("\n")).not.toContain(
        encodeURIComponent(clusterKey),
      );
    });

    test("a refusal from the server is retried with the usual backoff, not the slowest interval", async () => {
      postMock.mockResolvedValue(
        new HTTPResponse<JSONObject>(
          400,
          { message: "Invalid cluster key provided" },
          {},
        ),
      );

      const runner: RegisterModule = loadRunner({
        shared: undefined,
        clusterKey: clusterKey,
      });

      await expect(
        runner.default.tryRegisterRunner({ maxAttempts: 2 }),
      ).resolves.toBe(false);

      expect(postMock).toHaveBeenCalledTimes(2);
      expect(sleepsInMs).toEqual([30000]);
    });
  },
);

describe.each(SHIPPED_CLUSTER_KEYS)(
  "a shared Runner whose deployment gives it the ONEUPTIME_SECRET %s",
  (_label: string, clusterKey: string) => {
    test("never sends that value: it registers with its own key alone", async () => {
      postMock.mockResolvedValue(REGISTERED);

      const runner: RegisterModule = loadRunner({
        shared: undefined,
        clusterKey: clusterKey,
      });

      await expect(
        runner.default.tryRegisterRunner({ maxAttempts: 1 }),
      ).resolves.toBe(true);

      const sent: ReturnType<typeof sentRequest> = sentRequest();

      expect(sent.url.pathname).toBe("/api/ai-agent/register");
      expect(sent.headers).toBeUndefined();
      expect(sent.data["aiAgentKey"]).toBe(RUNNER_KEY);

      if (clusterKey.trim()) {
        expect(sent.whole).not.toContain(clusterKey.trim());
      }
    });

    test("does not say it holds a cluster key: it sends none", async () => {
      postMock.mockResolvedValue(REGISTERED);

      const runner: RegisterModule = loadRunner({
        shared: undefined,
        clusterKey: clusterKey,
      });

      await runner.default.tryRegisterRunner({ maxAttempts: 1 });

      expect(runner.default.holdsClusterKey()).toBe(false);
      expect(warnLog).toStrictEqual([]);
    });
  },
);
