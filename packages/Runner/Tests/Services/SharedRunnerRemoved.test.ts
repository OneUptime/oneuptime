/*
 * ---------------------------------------------------------------------------
 * There is no shared Runner any more.
 *
 * Earlier releases ran a shared Runner (the runner service of Docker Compose
 * and the Helm chart, ONEUPTIME_RUNNER_SHARED=true, or a Runner whose
 * deployment gave it the cluster key) that registered itself at
 * /api/ai-agent/register to serve every project's AI code fixes. Global
 * Runners take that work now, so:
 *
 *   - a Runner still started with ONEUPTIME_RUNNER_SHARED=true says what to
 *     do instead, and stops, before it sends anything;
 *   - a cluster key in a Runner's environment changes nothing: it registers
 *     with the id and key it was given, on the Runner work mount, and never
 *     presents the cluster key;
 *   - nothing of the shared Runner's registration is left to call.
 *
 * Each Runner here is a fresh module registry loaded with the environment
 * it names; API.post is recorded, not performed.
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

jest.mock("Common/Types/Sleep", () => {
  return {
    __esModule: true,
    default: {
      sleep: async (): Promise<void> => {},
    },
  };
});

const errorLog: Array<string> = [];

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: (value: unknown) => {
        errorLog.push(value instanceof Error ? value.message : String(value));
      },
    },
  };
});

type ConfigModule = typeof import("../../Config");
type RegisterModule = typeof import("../../Services/RegisterRunner");

const RUNNER_ID: string = "2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182";
const RUNNER_KEY: string =
  "5e8b1d4f7a0c3e6b9d2f5a8c1e4b7d0a3f6c9e2b5d8a1f4c7e0b3d6a9f2c5e8b";
const CLUSTER_KEY: string = "Q7dVk2LmX9pR4tWz8NcB1sHf6JyG3uAe";

const ENVIRONMENT: Array<string> = [
  "ONEUPTIME_RUNNER_SHARED",
  "ONEUPTIME_SECRET",
  "ONEUPTIME_RUNNER_ID",
  "ONEUPTIME_RUNNER_KEY",
];

const savedEnvironment: Record<string, string | undefined> = {};

for (const name of ENVIRONMENT) {
  savedEnvironment[name] = process.env[name];
}

class ExitCalled extends Error {
  public readonly code: number | undefined;

  public constructor(code: number | undefined) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

/*
 * Loads the Runner's modules with this environment, process.exit turned
 * into a throw so a Runner that stops can be seen stopping.
 */
function load<T>(env: Record<string, string>, modulePath: string): T {
  for (const name of ENVIRONMENT) {
    delete process.env[name];
  }

  process.env["ONEUPTIME_RUNNER_ID"] = RUNNER_ID;
  process.env["ONEUPTIME_RUNNER_KEY"] = RUNNER_KEY;

  for (const [name, value] of Object.entries(env)) {
    process.env[name] = value;
  }

  jest.spyOn(process, "exit").mockImplementation(((
    code?: number,
  ): never => {
    throw new ExitCalled(code);
  }) as never);

  let loaded: T | null = null;

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    loaded = require(modulePath);
  });

  return loaded!;
}

beforeEach(() => {
  postMock.mockReset();
  errorLog.length = 0;
});

afterEach(() => {
  jest.restoreAllMocks();

  for (const name of ENVIRONMENT) {
    if (savedEnvironment[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = savedEnvironment[name];
    }
  }
});

describe("a Runner still started as the shared Runner", () => {
  test.each(["true", "TRUE", " True "])(
    "ONEUPTIME_RUNNER_SHARED=%p: says what to do instead, and stops before it sends anything",
    (value: string) => {
      let thrown: unknown = null;

      try {
        load<ConfigModule>({ ONEUPTIME_RUNNER_SHARED: value }, "../../Config");
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ExitCalled);
      expect((thrown as ExitCalled).code).toBe(1);
      expect(errorLog).toHaveLength(1);
      expect(errorLog[0]).toContain(
        "OneUptime no longer runs a shared Runner: its global Runners take AI code fixes now",
      );
      expect(errorLog[0]).toContain("Remove this Runner from your deployment");
      expect(postMock).not.toHaveBeenCalled();
    },
  );

  test.each(["false", "", "yes", "1"])(
    "ONEUPTIME_RUNNER_SHARED=%p is not the switch: the Runner starts as any other",
    (value: string) => {
      const config: ConfigModule = load<ConfigModule>(
        { ONEUPTIME_RUNNER_SHARED: value },
        "../../Config",
      );

      expect(config.RUNNER_ID?.toString()).toBe(RUNNER_ID);
      expect(errorLog).toEqual([]);
    },
  );

  test("the message names the services that replaced it", () => {
    const config: ConfigModule = load<ConfigModule>({}, "../../Config");

    expect(config.SHARED_RUNNER_REMOVED_MESSAGE).toContain(
      "the global-runner service of Docker Compose",
    );
    expect(config.SHARED_RUNNER_REMOVED_MESSAGE).toContain(
      "the globalRunner deployment of the Helm chart",
    );
  });
});

describe("a Runner given the cluster key", () => {
  test("registers with the id and key it was given, on the Runner work mount, and never sends the cluster key", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          status: "ok",
          capabilities: {
            canRunRunbooks: true,
            canRunCodeFixTasks: false,
            canRunAiCommands: false,
          },
        },
        {},
      ),
    );

    const runner: RegisterModule = load<RegisterModule>(
      { ONEUPTIME_SECRET: CLUSTER_KEY },
      "../../Services/RegisterRunner",
    );

    await expect(
      runner.default.tryRegisterRunner({ maxAttempts: 1 }),
    ).resolves.toBe(true);

    expect(postMock).toHaveBeenCalledTimes(1);

    const request: JSONObject = postMock.mock.calls[0]![0] as JSONObject;

    expect(new URL(String(request["url"])).pathname).toBe(
      "/runner-ingest/heartbeat",
    );
    expect((request["data"] as JSONObject)["agentId"]).toBe(RUNNER_ID);
    expect((request["data"] as JSONObject)["agentKey"]).toBe(RUNNER_KEY);
    expect(JSON.stringify(request)).not.toContain(CLUSTER_KEY);
    expect(JSON.stringify(request)).not.toContain("/api/ai-agent/register");
  });
});

describe("what is left of the shared Runner's registration", () => {
  test("nothing: no check, no message and no error of its own", () => {
    const runner: RegisterModule = load<RegisterModule>(
      {},
      "../../Services/RegisterRunner",
    );
    const config: ConfigModule = load<ConfigModule>({}, "../../Config");

    expect(Object.keys(runner)).not.toEqual(
      expect.arrayContaining(["ShippedRunnerKeyError"]),
    );
    expect(Object.keys(runner)).not.toContain(
      "SHIPPED_RUNNER_KEY_RUNNER_MESSAGE",
    );
    expect(Object.keys(runner)).not.toContain(
      "CLUSTER_KEY_IN_RUNNER_ENVIRONMENT_MESSAGE",
    );
    expect(
      (runner.default as unknown as Record<string, unknown>)["holdsClusterKey"],
    ).toBeUndefined();

    for (const removed of [
      "IS_SHARED_RUNNER",
      "IS_CLUSTER_SCOPED",
      "CLUSTER_ENABLE_CODE_FIXES",
      "RUNS_PROJECT_AUTHORED_COMMANDS",
    ]) {
      expect(Object.keys(config)).not.toContain(removed);
    }
  });
});
