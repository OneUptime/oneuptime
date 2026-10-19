/*
 * ---------------------------------------------------------------------------
 * A Runner a project created, and the key it presents.
 *
 * A Runner installed from Runbooks > Runners proves who it is with the id
 * and key the dashboard issued (ONEUPTIME_RUNNER_ID, ONEUPTIME_RUNNER_KEY),
 * first with a heartbeat to /runner-ingest/heartbeat. OneUptime refuses a
 * value its repository ships ("secret", a "please-change-this-to-random-value"
 * placeholder, a blank key) as a Runner key wherever one is presented, and
 * never stores one as a Runner's key, so a Runner holding one:
 *
 *   - sends nothing - not the shipped value;
 *   - says once, at error level, exactly what to do, and then quietly;
 *   - keeps the container up, retrying at its slowest interval, because only
 *     a new key from the dashboard and a restart help.
 *
 * A Runner with the key the dashboard issued registers with exactly that.
 *
 * Each Runner here is a fresh module registry loaded with the environment it
 * names; API.post and the sleeps are recorded, not performed.
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

const RUNNER_ID: string = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";

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
  ["blank", "   "],
];

const ISSUED_RUNNER_KEYS: Array<[string, string]> = [
  ["a key the dashboard issued", "7c1e9a3b-5d2f-4e8a-9b6c-0d4f2a8e6b1c"],
  ["one that only starts like the old fallback", "secretive-runner-key-17"],
];

// A Runner a project created, started with this ONEUPTIME_RUNNER_KEY.
function loadRunner(runnerKey: string): RegisterModule {
  const saved: Record<string, string | undefined> = {
    ONEUPTIME_SECRET: process.env["ONEUPTIME_SECRET"],
    ONEUPTIME_RUNNER_ID: process.env["ONEUPTIME_RUNNER_ID"],
    ONEUPTIME_RUNNER_KEY: process.env["ONEUPTIME_RUNNER_KEY"],
  };

  // No cluster key: a project's Runner, with the id the dashboard issued.
  delete process.env["ONEUPTIME_SECRET"];
  process.env["ONEUPTIME_RUNNER_ID"] = RUNNER_ID;
  process.env["ONEUPTIME_RUNNER_KEY"] = runnerKey;

  let loaded: RegisterModule | null = null;

  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      loaded = require("../../Services/RegisterRunner");
    });
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
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
  "a project's Runner whose ONEUPTIME_RUNNER_KEY is %s",
  (_label: string, runnerKey: string) => {
    test("sends nothing, and gives up the round without exiting", async () => {
      const runner: RegisterModule = loadRunner(runnerKey);

      await expect(
        runner.default.tryRegisterRunner({ maxAttempts: 4 }),
      ).resolves.toBe(false);

      expect(postMock).not.toHaveBeenCalled();
    });

    test("says once, at error level, what to do - and then only at debug level", async () => {
      const runner: RegisterModule = loadRunner(runnerKey);

      await runner.default.tryRegisterRunner({ maxAttempts: 4 });

      const told: Array<string> = errorLog.filter((line: string) => {
        return line === runner.SHIPPED_PROJECT_RUNNER_KEY_MESSAGE;
      });

      expect(told).toHaveLength(1);
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
          error: new runner.ShippedProjectRunnerKeyError(),
          isKubernetesAgent: false,
        }),
      ).toBe(300);
    });
  },
);

describe.each(ISSUED_RUNNER_KEYS)(
  "a project's Runner whose ONEUPTIME_RUNNER_KEY is %s",
  (_label: string, runnerKey: string) => {
    test("sends its heartbeat with exactly that key, and registers", async () => {
      postMock.mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));

      const runner: RegisterModule = loadRunner(runnerKey);

      await expect(
        runner.default.tryRegisterRunner({ maxAttempts: 1 }),
      ).resolves.toBe(true);

      expect(postMock).toHaveBeenCalledTimes(1);

      const request: JSONObject = postMock.mock.calls[0]![0] as JSONObject;
      const data: JSONObject = request["data"] as JSONObject;

      expect(new URL(String(request["url"])).pathname).toBe(
        "/runner-ingest/heartbeat",
      );
      expect(data["agentId"]).toBe(RUNNER_ID);
      expect(data["agentKey"]).toBe(runnerKey);
      expect(errorLog).toEqual([]);
    });
  },
);

describe("the error a shipped key raises", () => {
  test("names the setting, says where a new key comes from, and is treated like the other shipped settings", () => {
    const runner: RegisterModule = loadRunner(ISSUED_RUNNER_KEYS[0]![1]);
    const error: Error = new runner.ShippedProjectRunnerKeyError();

    expect(error).toBeInstanceOf(runner.ShippedSecretSettingError);
    expect(
      (error as InstanceType<typeof runner.ShippedSecretSettingError>).setting,
    ).toBe("ONEUPTIME_RUNNER_KEY");
    expect(error.message).toBe(runner.SHIPPED_PROJECT_RUNNER_KEY_MESSAGE);
    expect(runner.SHIPPED_PROJECT_RUNNER_KEY_MESSAGE).toContain(
      "Runbooks > Runners",
    );
    expect(runner.SHIPPED_PROJECT_RUNNER_KEY_MESSAGE).toContain(
      "reset its key",
    );
  });
});
