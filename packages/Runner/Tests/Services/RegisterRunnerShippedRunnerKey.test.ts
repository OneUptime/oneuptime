/*
 * ---------------------------------------------------------------------------
 * The in-cluster Runner's registration, and the agent key it presents.
 *
 * The installation's shared Runner (ONEUPTIME_RUNNER_SHARED=true) registers
 * as the global agent every project shares (POST /api/ai-agent/register),
 * with and under its ONEUPTIME_RUNNER_KEY. OneUptime refuses a value its
 * repository ships
 * ("secret", a "please-change-this-to-random-value" placeholder) as an
 * agent key, so a Runner holding one:
 *
 *   - sends nothing - not the shipped value;
 *   - says once, at error level, exactly what to set, and then quietly;
 *   - keeps the container up, retrying at its slowest interval, because
 *     only an operator setting ONEUPTIME_RUNNER_KEY and restarting it helps.
 *
 * A Runner given a key of the operator's own registers with exactly that.
 * The check is the in-cluster Runner's: a Runner a project created in the
 * dashboard proves itself with the id and key the dashboard issued.
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
const debugLog: Array<string> = [];

jest.mock("Common/Server/Utils/Logger", () => {
  const asText: (value: unknown) => string = (value: unknown): string => {
    return value instanceof Error ? value.message : String(value);
  };

  return {
    __esModule: true,
    default: {
      debug: (value: unknown) => {
        debugLog.push(asText(value));
      },
      info: jest.fn(),
      warn: jest.fn(),
      error: (value: unknown) => {
        errorLog.push(asText(value));
      },
    },
  };
});

type RegisterModule = typeof import("../../Services/RegisterRunner");

const SHIPPED_RUNNER_KEYS: Array<[string, string]> = [
  [
    "the placeholder config.example.env ships",
    "please-change-this-to-random-value",
  ],
  [
    "the placeholder padded with spaces",
    "  please-change-this-to-random-value ",
  ],
  ["a partially edited placeholder", "please-change-this-to-random-value-2"],
  ['the old fallback "secret"', "secret"],
  ['"secret" padded with spaces', " secret  "],
  ["blank", "   "],
];

const OPERATOR_RUNNER_KEYS: Array<[string, string]> = [
  [
    "64 hex characters",
    "5e8b1d4f7a0c3e6b9d2f5a8c1e4b7d0a3f6c9e2b5d8a1f4c7e0b3d6a9f2c5e8b",
  ],
  ["one that only starts like the old fallback", "secretive-runner-key-17"],
];

// The shared Runner, started with this ONEUPTIME_RUNNER_KEY and no cluster key.
function loadRunner(runnerKey: string): RegisterModule {
  const savedClusterKey: string | undefined = process.env["ONEUPTIME_SECRET"];
  const savedShared: string | undefined =
    process.env["ONEUPTIME_RUNNER_SHARED"];
  const savedRunnerKey: string | undefined =
    process.env["ONEUPTIME_RUNNER_KEY"];
  delete process.env["ONEUPTIME_SECRET"];
  process.env["ONEUPTIME_RUNNER_SHARED"] = "true";
  process.env["ONEUPTIME_RUNNER_KEY"] = runnerKey;

  let loaded: RegisterModule | null = null;

  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      loaded = require("../../Services/RegisterRunner");
    });
  } finally {
    if (savedClusterKey === undefined) {
      delete process.env["ONEUPTIME_SECRET"];
    } else {
      process.env["ONEUPTIME_SECRET"] = savedClusterKey;
    }

    if (savedShared === undefined) {
      delete process.env["ONEUPTIME_RUNNER_SHARED"];
    } else {
      process.env["ONEUPTIME_RUNNER_SHARED"] = savedShared;
    }

    if (savedRunnerKey === undefined) {
      delete process.env["ONEUPTIME_RUNNER_KEY"];
    } else {
      process.env["ONEUPTIME_RUNNER_KEY"] = savedRunnerKey;
    }
  }

  return loaded!;
}

beforeEach(() => {
  postMock.mockReset();
  sleepsInMs.length = 0;
  errorLog.length = 0;
  debugLog.length = 0;
});

describe.each(SHIPPED_RUNNER_KEYS)(
  "an in-cluster Runner whose ONEUPTIME_RUNNER_KEY is %s",
  (_label: string, runnerKey: string) => {
    test("sends nothing, and gives up the round without exiting", async () => {
      const runner: RegisterModule = loadRunner(runnerKey);

      await expect(
        runner.default.tryRegisterRunner({ maxAttempts: 4 }),
      ).resolves.toBe(false);

      expect(postMock).not.toHaveBeenCalled();
    });

    test("says once, at error level, what to set - and then only at debug level", async () => {
      const runner: RegisterModule = loadRunner(runnerKey);

      await runner.default.tryRegisterRunner({ maxAttempts: 4 });

      const told: Array<string> = errorLog.filter((line: string) => {
        return line === runner.SHIPPED_RUNNER_KEY_RUNNER_MESSAGE;
      });

      expect(told).toHaveLength(1);
      expect(runner.SHIPPED_RUNNER_KEY_RUNNER_MESSAGE).toContain(
        "Set ONEUPTIME_RUNNER_KEY to the same long random value on this Runner and the OneUptime app",
      );
      expect(
        errorLog.some((line: string) => {
          return line.includes(
            "nothing is sent until an operator sets ONEUPTIME_RUNNER_KEY",
          );
        }),
      ).toBe(true);
      expect(
        debugLog.filter((line: string) => {
          return line.includes("Registration still refused");
        }).length,
      ).toBe(3);
    });

    test("waits its slowest interval between attempts: nothing changes until a restart", async () => {
      const runner: RegisterModule = loadRunner(runnerKey);

      await runner.default.tryRegisterRunner({ maxAttempts: 4 });

      expect(sleepsInMs).toEqual([300000, 300000, 300000]);
      expect(
        runner.default.getRetryDelaySeconds({
          attempt: 1,
          error: new runner.ShippedRunnerKeyError(),
          isKubernetesAgent: false,
        }),
      ).toBe(300);
    });
  },
);

describe.each(OPERATOR_RUNNER_KEYS)(
  "an in-cluster Runner whose operator set ONEUPTIME_RUNNER_KEY to %s",
  (_label: string, runnerKey: string) => {
    test("registers with exactly that key at /api/ai-agent/register", async () => {
      postMock.mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          { _id: "2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182" },
          {},
        ),
      );

      const runner: RegisterModule = loadRunner(runnerKey);

      await expect(
        runner.default.tryRegisterRunner({ maxAttempts: 1 }),
      ).resolves.toBe(true);

      expect(postMock).toHaveBeenCalledTimes(1);

      const request: JSONObject = postMock.mock.calls[0]![0] as JSONObject;
      const data: JSONObject = request["data"] as JSONObject;

      expect(new URL(String(request["url"])).pathname).toBe(
        "/api/ai-agent/register",
      );
      expect(data["aiAgentKey"]).toBe(runnerKey);
      expect(errorLog).toEqual([]);
    });
  },
);

describe("the errors a setting the repository ships raises", () => {
  test("name the setting an operator sets, and are treated alike", () => {
    const runner: RegisterModule = loadRunner(OPERATOR_RUNNER_KEYS[0]![1]);

    const runnerKeyError: Error = new runner.ShippedRunnerKeyError();
    const projectRunnerKeyError: Error =
      new runner.ShippedProjectRunnerKeyError();

    expect(runnerKeyError).toBeInstanceOf(runner.ShippedSecretSettingError);
    expect(projectRunnerKeyError).toBeInstanceOf(
      runner.ShippedSecretSettingError,
    );
    expect(
      (runnerKeyError as InstanceType<typeof runner.ShippedSecretSettingError>)
        .setting,
    ).toBe("ONEUPTIME_RUNNER_KEY");
    expect(runnerKeyError.message).toBe(
      runner.SHIPPED_RUNNER_KEY_RUNNER_MESSAGE,
    );

    /*
     * A shipped ONEUPTIME_SECRET is no such setting any more: the Runner
     * registers with its own key and sends no cluster key it may not send.
     */
    expect(Object.keys(runner)).not.toContain("ShippedClusterKeyError");
    expect(Object.keys(runner)).not.toContain(
      "SHIPPED_CLUSTER_KEY_RUNNER_MESSAGE",
    );
  });
});
