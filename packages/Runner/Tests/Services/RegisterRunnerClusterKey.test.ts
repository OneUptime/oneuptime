/*
 * ---------------------------------------------------------------------------
 * The in-cluster Runner's registration, and the cluster key it presents.
 *
 * A Runner given ONEUPTIME_SECRET registers as the Runner that fixes code
 * for every project (POST /api/ai-agent/register), proving it is one of the
 * installation's own services with that key. OneUptime refuses a value its
 * repository ships ("secret", a "please-change-this-to-random-value"
 * placeholder) from every caller, so a Runner holding one:
 *
 *   - sends nothing - not the shipped value, and not a key of its own
 *     making (it cannot derive the one an installation that kept a shipped
 *     value uses: that comes from the installation's database);
 *   - says once, at error level, exactly what to set, and then quietly;
 *   - keeps the container up, retrying at its slowest interval, because
 *     only an operator setting ONEUPTIME_SECRET and restarting it helps.
 *
 * A Runner given a key of the operator's own registers with exactly that,
 * URI-encoded as ever.
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

const SHIPPED_VALUES: Array<[string, string]> = [
  ["the placeholder config.example.env ships", "please-change-this-to-random-value"],
  ["the placeholder padded with spaces", " please-change-this-to-random-value "],
  ["a global probe's placeholder", "probe-1-please-change-this-to-random-value"],
  ['the code\'s old fallback "secret"', "secret"],
  ['"secret" padded with spaces', "  secret  "],
  ["blank", "   "],
];

const OPERATOR_KEYS: Array<[string, string]> = [
  [
    "64 hex characters",
    "3b9f1c7e5a2d48f6b0e9c3a7d1f5b8e2c6a4d0f9e3b7c1a5d8f2e6b0c4a9d3f7",
  ],
  ["one with characters that travel encoded", "p@ss/w0rd?&=+%#"],
];

// A Runner started with this ONEUPTIME_SECRET, in cluster-scoped mode.
function loadRunner(clusterKey: string): RegisterModule {
  const saved: string | undefined = process.env["ONEUPTIME_SECRET"];
  process.env["ONEUPTIME_SECRET"] = clusterKey;

  let loaded: RegisterModule | null = null;

  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      loaded = require("../../Services/RegisterRunner");
    });
  } finally {
    if (saved === undefined) {
      delete process.env["ONEUPTIME_SECRET"];
    } else {
      process.env["ONEUPTIME_SECRET"] = saved;
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

describe.each(SHIPPED_VALUES)(
  "an in-cluster Runner whose ONEUPTIME_SECRET is %s",
  (_label: string, clusterKey: string) => {
    test("sends nothing, and gives up the round without exiting", async () => {
      const runner: RegisterModule = loadRunner(clusterKey);

      await expect(
        runner.default.tryRegisterRunner({ maxAttempts: 4 }),
      ).resolves.toBe(false);

      expect(postMock).not.toHaveBeenCalled();
    });

    test("says once, at error level, what to set - and then only at debug level", async () => {
      const runner: RegisterModule = loadRunner(clusterKey);

      await runner.default.tryRegisterRunner({ maxAttempts: 4 });

      const told: Array<string> = errorLog.filter((line: string) => {
        return line === runner.SHIPPED_CLUSTER_KEY_RUNNER_MESSAGE;
      });

      expect(told).toHaveLength(1);
      expect(runner.SHIPPED_CLUSTER_KEY_RUNNER_MESSAGE).toContain(
        "Set ONEUPTIME_SECRET to the same long random value on the OneUptime app and this Runner",
      );
      expect(
        errorLog.some((line: string) => {
          return line.includes(
            "nothing is sent until an operator sets ONEUPTIME_SECRET",
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
      const runner: RegisterModule = loadRunner(clusterKey);

      await runner.default.tryRegisterRunner({ maxAttempts: 4 });

      expect(sleepsInMs).toEqual([300000, 300000, 300000]);
      expect(
        runner.default.getRetryDelaySeconds({
          attempt: 1,
          error: new runner.ShippedClusterKeyError(),
          isKubernetesAgent: false,
        }),
      ).toBe(300);
    });
  },
);

describe.each(OPERATOR_KEYS)(
  "an in-cluster Runner whose operator set ONEUPTIME_SECRET to %s",
  (_label: string, clusterKey: string) => {
    test("registers with exactly that key, URI-encoded, at /api/ai-agent/register", async () => {
      postMock.mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          { _id: "2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182" },
          {},
        ),
      );

      const runner: RegisterModule = loadRunner(clusterKey);

      await expect(
        runner.default.tryRegisterRunner({ maxAttempts: 1 }),
      ).resolves.toBe(true);

      expect(postMock).toHaveBeenCalledTimes(1);

      const request: JSONObject = postMock.mock.calls[0]![0] as JSONObject;
      const data: JSONObject = request["data"] as JSONObject;

      expect(new URL(String(request["url"])).pathname).toBe(
        "/api/ai-agent/register",
      );
      expect(data["clusterKey"]).toBe(encodeURIComponent(clusterKey));
      expect(data["aiAgentKey"]).toBe(process.env["ONEUPTIME_RUNNER_KEY"]);
      expect(errorLog).toEqual([]);
    });

    test("a refusal from the server is retried with the usual backoff, not the slowest interval", async () => {
      postMock.mockResolvedValue(
        new HTTPResponse<JSONObject>(
          400,
          { message: "Invalid cluster key provided" },
          {},
        ),
      );

      const runner: RegisterModule = loadRunner(clusterKey);

      await expect(
        runner.default.tryRegisterRunner({ maxAttempts: 2 }),
      ).resolves.toBe(false);

      expect(postMock).toHaveBeenCalledTimes(2);
      expect(sleepsInMs).toEqual([30000]);
    });
  },
);
