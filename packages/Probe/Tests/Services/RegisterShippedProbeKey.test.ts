/*
 * ---------------------------------------------------------------------------
 * A probe's registration, and the keys it presents.
 *
 * A probe registers itself as a global probe with REGISTER_PROBE_KEY, or
 * proves it is a probe a project created with PROBE_ID, and presents its
 * own PROBE_KEY on every request after. OneUptime refuses a value its
 * repository ships ("secret", a "please-change-this-to-random-value"
 * placeholder, blank) for either key, so a probe holding one:
 *
 *   - sends nothing - not the shipped value;
 *   - says, at error level, exactly what to set, and stops at once instead
 *     of retrying a refusal no retry clears - as it does for a key that is
 *     not set at all.
 *
 * A probe given keys of the operator's own registers with exactly those.
 *
 * Each probe here is a fresh module registry loaded with the environment it
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

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: (): void => {},
      info: (): void => {},
      warn: (): void => {},
      error: (value: unknown): void => {
        errorLog.push(value instanceof Error ? value.message : String(value));
      },
    },
  };
});

type RegisterModule = typeof import("../../Services/Register");

const OPERATOR_REGISTER_PROBE_KEY: string =
  "8c1e4b7d0a3f6c9e2b5d8a1f4c7e0b3d6a9f2c5e";
const OPERATOR_PROBE_KEY: string = "2f5a8c1e4b7d0a3f6c9e2b5d8a1f4c7e0b3d6a9f";
const PROBE_ID: string = "11111111-2222-4333-8444-555555555555";

const SHIPPED_VALUES: Array<[string, string]> = [
  [
    "the placeholder config.example.env ships",
    "please-change-this-to-random-value",
  ],
  [
    "a global probe's placeholder",
    "probe-1-please-change-this-to-random-value",
  ],
  ["a padded placeholder", "  probe-2-please-change-this-to-random-value "],
  ['the old fallback "secret"', "secret"],
  ["blank", "   "],
];

const ENVIRONMENT_NAMES: Array<string> = [
  "ONEUPTIME_URL",
  "PROBE_KEY",
  "PROBE_ID",
  "REGISTER_PROBE_KEY",
  "PROBE_NAME",
];

const savedEnvironment: Record<string, string | undefined> = {};

// A probe started with this environment (unset where a value is undefined).
function loadProbe(environment: {
  probeKey: string;
  registerProbeKey?: string;
  probeId?: string;
}): RegisterModule {
  for (const name of ENVIRONMENT_NAMES) {
    savedEnvironment[name] = process.env[name];
  }

  process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
  process.env["PROBE_KEY"] = environment.probeKey;
  process.env["PROBE_NAME"] = "Probe-1";

  if (environment.registerProbeKey === undefined) {
    delete process.env["REGISTER_PROBE_KEY"];
  } else {
    process.env["REGISTER_PROBE_KEY"] = environment.registerProbeKey;
  }

  if (environment.probeId === undefined) {
    delete process.env["PROBE_ID"];
  } else {
    process.env["PROBE_ID"] = environment.probeId;
  }

  let loaded: RegisterModule | null = null;

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    loaded = require("../../Services/Register");
  });

  return loaded!;
}

beforeEach(() => {
  postMock.mockReset();
  sleepsInMs.length = 0;
  errorLog.length = 0;
});

afterEach(() => {
  for (const name of ENVIRONMENT_NAMES) {
    if (savedEnvironment[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = savedEnvironment[name];
    }
  }
});

async function expectRefusedAtOnce(
  probe: RegisterModule,
  message: string,
): Promise<void> {
  await expect(probe.default.registerProbe()).rejects.toBeInstanceOf(
    probe.ShippedProbeKeyError,
  );

  expect(postMock).not.toHaveBeenCalled();
  expect(sleepsInMs).toEqual([]);
  expect(errorLog).toContain(message);
}

describe.each(SHIPPED_VALUES)(
  "a key of the probe's that is %s",
  (_label: string, shippedValue: string) => {
    test("as REGISTER_PROBE_KEY: sends nothing, says what to set, and stops", async () => {
      const probe: RegisterModule = loadProbe({
        probeKey: OPERATOR_PROBE_KEY,
        registerProbeKey: shippedValue,
      });

      await expectRefusedAtOnce(
        probe,
        probe.SHIPPED_REGISTER_PROBE_KEY_PROBE_MESSAGE,
      );
    });

    test("as the PROBE_KEY of a probe registering itself: sends nothing, says what to set, and stops", async () => {
      const probe: RegisterModule = loadProbe({
        probeKey: shippedValue,
        registerProbeKey: OPERATOR_REGISTER_PROBE_KEY,
      });

      await expectRefusedAtOnce(probe, probe.SHIPPED_PROBE_KEY_PROBE_MESSAGE);
    });

    test("as the PROBE_KEY of a probe a project created: sends nothing, says what to set, and stops", async () => {
      const probe: RegisterModule = loadProbe({
        probeKey: shippedValue,
        probeId: PROBE_ID,
      });

      await expectRefusedAtOnce(probe, probe.SHIPPED_PROBE_KEY_PROBE_MESSAGE);
    });
  },
);

describe("a probe given keys of the operator's own", () => {
  test("registers itself with exactly those keys at /probe-ingest/register", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { _id: PROBE_ID }, {}),
    );

    const probe: RegisterModule = loadProbe({
      probeKey: OPERATOR_PROBE_KEY,
      registerProbeKey: OPERATOR_REGISTER_PROBE_KEY,
    });

    await expect(probe.default.registerProbe()).resolves.toBeUndefined();

    expect(postMock).toHaveBeenCalledTimes(1);
    const request: JSONObject = postMock.mock.calls[0]![0] as JSONObject;
    const data: JSONObject = request["data"] as JSONObject;

    expect(new URL(String(request["url"])).pathname).toBe(
      "/probe-ingest/register",
    );
    expect(data["probeKey"]).toBe(OPERATOR_PROBE_KEY);
    expect(data["registerProbeKey"]).toBe(OPERATOR_REGISTER_PROBE_KEY);
    expect(data["probeName"]).toBe("Probe-1");
    expect(errorLog).toEqual([]);
  });

  test("proves a probe a project created with its id and key at /probe-ingest/alive", async () => {
    postMock.mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));

    const probe: RegisterModule = loadProbe({
      probeKey: OPERATOR_PROBE_KEY,
      probeId: PROBE_ID,
    });

    await expect(probe.default.registerProbe()).resolves.toBeUndefined();

    expect(postMock).toHaveBeenCalledTimes(1);
    const request: JSONObject = postMock.mock.calls[0]![0] as JSONObject;

    expect(new URL(String(request["url"])).pathname).toBe(
      "/probe-ingest/alive",
    );
    expect((request["data"] as JSONObject)["probeKey"]).toBe(
      OPERATOR_PROBE_KEY,
    );
    expect(probe.default.getShippedKeyRefusal()).toBeNull();
  });

  test("a refusal from the server is still retried, as before", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(400, { message: "Invalid" }, {}),
    );

    const probe: RegisterModule = loadProbe({
      probeKey: OPERATOR_PROBE_KEY,
      registerProbeKey: OPERATOR_REGISTER_PROBE_KEY,
    });

    await expect(probe.default.registerProbe()).rejects.toThrow(
      "Unable to register probe after 10 attempts",
    );

    expect(postMock).toHaveBeenCalledTimes(10);
    expect(sleepsInMs).toHaveLength(10);
  });
});
