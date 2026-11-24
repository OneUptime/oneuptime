/*
 * HOW MANY REQUESTS A GROUPED INCOMING REQUEST MONITOR KEEPS WAITING, AND HOW
 * MANY ONE JOB EVALUATES, AS A SELF-HOSTED INSTALL SETS THEM (#10652).
 *
 * Three settings of the Telemetry worker (Telemetry/Config), each a whole
 * number with a default - the limit OneUptime always kept - and bounds:
 *
 *   INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR    1000, 10 to 100000
 *   INCOMING_REQUEST_MAX_PENDING_MEGABYTES_PER_MONITOR   16, 1 to 512
 *   INCOMING_REQUEST_MAX_REQUESTS_PER_JOB                100, 1 to 1000
 *
 * Unset or empty, a setting is its default. Within its bounds, it is what the
 * operator set. Anything else - out of range, not a whole number - is
 * refused: the default is used, and the log says so, naming the variable.
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import {
  BoundedIntegerReading,
  BoundedIntegerSetting,
  INCOMING_REQUEST_MAX_PENDING_MEGABYTES_PER_MONITOR_SETTING,
  INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR_SETTING,
  INCOMING_REQUEST_MAX_REQUESTS_PER_JOB_SETTING,
  readBoundedInteger,
} from "../../FeatureSet/Telemetry/Config";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const SETTINGS: ReadonlyArray<BoundedIntegerSetting> = [
  INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR_SETTING,
  INCOMING_REQUEST_MAX_PENDING_MEGABYTES_PER_MONITOR_SETTING,
  INCOMING_REQUEST_MAX_REQUESTS_PER_JOB_SETTING,
];

const BY_NAME: Array<[string, BoundedIntegerSetting]> = SETTINGS.map(
  (setting: BoundedIntegerSetting): [string, BoundedIntegerSetting] => {
    return [setting.envKey, setting];
  },
);

describe("the settings", () => {
  test("are today's limits by default, within bounds that keep them sane", () => {
    expect(
      SETTINGS.map((setting: BoundedIntegerSetting) => {
        return [setting.envKey, setting.defaultValue, setting.min, setting.max];
      }),
    ).toEqual([
      ["INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR", 1000, 10, 100000],
      ["INCOMING_REQUEST_MAX_PENDING_MEGABYTES_PER_MONITOR", 16, 1, 512],
      ["INCOMING_REQUEST_MAX_REQUESTS_PER_JOB", 100, 1, 1000],
    ]);
  });
});

describe.each(BY_NAME)(
  "%s",
  (_envKey: string, setting: BoundedIntegerSetting) => {
    test("unset or empty: the default, and nothing to say", () => {
      for (const rawValue of [undefined, "", "   "]) {
        expect(readBoundedInteger(setting, rawValue)).toEqual({
          value: setting.defaultValue,
        });
      }
    });

    test("at its bounds, and between them: as set", () => {
      for (const value of [
        setting.min,
        setting.min + 1,
        setting.defaultValue,
        setting.max - 1,
        setting.max,
      ]) {
        expect(readBoundedInteger(setting, String(value))).toEqual({
          value: value,
        });
      }
    });

    test("written with space around it: as set", () => {
      expect(readBoundedInteger(setting, ` ${setting.max} `)).toEqual({
        value: setting.max,
      });
    });

    test("just outside its bounds: refused, with the default and why", () => {
      for (const value of [setting.min - 1, setting.max + 1]) {
        const reading: BoundedIntegerReading = readBoundedInteger(
          setting,
          String(value),
        );

        expect(reading.value).toBe(setting.defaultValue);
        expect(reading.refusal).toBe(
          `${setting.envKey} is "${value}", which is not a whole number from ${setting.min} to ${setting.max}, so the default, ${setting.defaultValue}, is used.`,
        );
      }
    });

    test("not a whole number: refused, never read as part of one", () => {
      for (const rawValue of [
        "abc",
        "12.5",
        "-5",
        "+20",
        "1e3",
        "0x10",
        "20 requests",
        "10,000",
        "99999999999999999999",
      ]) {
        const reading: BoundedIntegerReading = readBoundedInteger(
          setting,
          rawValue,
        );

        expect({ rawValue, value: reading.value }).toEqual({
          rawValue,
          value: setting.defaultValue,
        });
        expect(reading.refusal).toContain(setting.envKey);
        expect(reading.refusal).toContain(`"${rawValue}"`);
      }
    });
  },
);

describe("read from the environment as the server starts", () => {
  const ENV_KEYS: Array<string> = SETTINGS.map(
    (setting: BoundedIntegerSetting): string => {
      return setting.envKey;
    },
  );
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  interface Loaded {
    config: typeof import("../../FeatureSet/Telemetry/Config");
    store: typeof import("../../FeatureSet/Telemetry/Utils/IncomingRequestPendingStore");
    warnings: Array<unknown>;
  }

  // Config and the store, loaded afresh as a server starting with this env.
  function load(env: Record<string, string>): Loaded {
    Object.assign(process.env, env);

    let loaded: Loaded | undefined = undefined;

    jest.isolateModules(() => {
      const logger: { warn: jest.Mock } = (
        jest.requireMock("Common/Server/Utils/Logger") as {
          default: { warn: jest.Mock };
        }
      ).default;
      logger.warn.mockClear();

      loaded = {
        config: jest.requireActual(
          "../../FeatureSet/Telemetry/Config",
        ) as Loaded["config"],
        store: jest.requireActual(
          "../../FeatureSet/Telemetry/Utils/IncomingRequestPendingStore",
        ) as Loaded["store"],
        warnings: logger.warn.mock.calls.map((call: Array<unknown>) => {
          return call[0];
        }),
      };
    });

    return loaded!;
  }

  test("nothing set: today's limits, and nothing in the log", () => {
    const { config, store, warnings } = load({});

    expect(config.INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR).toBe(1000);
    expect(config.INCOMING_REQUEST_MAX_PENDING_MEGABYTES_PER_MONITOR).toBe(16);
    expect(config.INCOMING_REQUEST_MAX_REQUESTS_PER_JOB).toBe(100);
    expect(store.MAX_PENDING_REQUESTS_PER_MONITOR).toBe(1000);
    expect(store.MAX_PENDING_BYTES_PER_MONITOR).toBe(16 * 1024 * 1024);
    expect(warnings).toEqual([]);
  });

  test("values within bounds: the store keeps what the operator set", () => {
    const { config, store, warnings } = load({
      INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR: "25000",
      INCOMING_REQUEST_MAX_PENDING_MEGABYTES_PER_MONITOR: "128",
      INCOMING_REQUEST_MAX_REQUESTS_PER_JOB: "500",
    });

    expect(config.INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR).toBe(
      25000,
    );
    expect(config.INCOMING_REQUEST_MAX_PENDING_MEGABYTES_PER_MONITOR).toBe(128);
    expect(config.INCOMING_REQUEST_MAX_REQUESTS_PER_JOB).toBe(500);
    expect(store.MAX_PENDING_REQUESTS_PER_MONITOR).toBe(25000);
    expect(store.MAX_PENDING_BYTES_PER_MONITOR).toBe(128 * 1024 * 1024);
    // The defaults stay what the docs give, whatever is set.
    expect(store.DEFAULT_MAX_PENDING_REQUESTS_PER_MONITOR).toBe(1000);
    expect(store.DEFAULT_MAX_PENDING_BYTES_PER_MONITOR).toBe(16 * 1024 * 1024);
    expect(warnings).toEqual([]);
  });

  test("the bounds themselves are taken", () => {
    const lowest: Loaded = load({
      INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR: "10",
      INCOMING_REQUEST_MAX_PENDING_MEGABYTES_PER_MONITOR: "1",
      INCOMING_REQUEST_MAX_REQUESTS_PER_JOB: "1",
    });

    expect(lowest.store.MAX_PENDING_REQUESTS_PER_MONITOR).toBe(10);
    expect(lowest.store.MAX_PENDING_BYTES_PER_MONITOR).toBe(1024 * 1024);
    expect(lowest.config.INCOMING_REQUEST_MAX_REQUESTS_PER_JOB).toBe(1);
    expect(lowest.warnings).toEqual([]);

    const highest: Loaded = load({
      INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR: "100000",
      INCOMING_REQUEST_MAX_PENDING_MEGABYTES_PER_MONITOR: "512",
      INCOMING_REQUEST_MAX_REQUESTS_PER_JOB: "1000",
    });

    expect(highest.store.MAX_PENDING_REQUESTS_PER_MONITOR).toBe(100000);
    expect(highest.store.MAX_PENDING_BYTES_PER_MONITOR).toBe(512 * 1024 * 1024);
    expect(highest.config.INCOMING_REQUEST_MAX_REQUESTS_PER_JOB).toBe(1000);
    expect(highest.warnings).toEqual([]);
  });

  test("a value refused is the default, and the log names the variable once", () => {
    const { config, store, warnings } = load({
      INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR: "5",
      INCOMING_REQUEST_MAX_PENDING_MEGABYTES_PER_MONITOR: "2048",
      INCOMING_REQUEST_MAX_REQUESTS_PER_JOB: "lots",
    });

    expect(config.INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR).toBe(1000);
    expect(config.INCOMING_REQUEST_MAX_PENDING_MEGABYTES_PER_MONITOR).toBe(16);
    expect(config.INCOMING_REQUEST_MAX_REQUESTS_PER_JOB).toBe(100);
    expect(store.MAX_PENDING_REQUESTS_PER_MONITOR).toBe(1000);
    expect(store.MAX_PENDING_BYTES_PER_MONITOR).toBe(16 * 1024 * 1024);
    expect(warnings).toEqual([
      'INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR is "5", which is not a whole number from 10 to 100000, so the default, 1000, is used.',
      'INCOMING_REQUEST_MAX_PENDING_MEGABYTES_PER_MONITOR is "2048", which is not a whole number from 1 to 512, so the default, 16, is used.',
      'INCOMING_REQUEST_MAX_REQUESTS_PER_JOB is "lots", which is not a whole number from 1 to 1000, so the default, 100, is used.',
    ]);
  });

  test("one refused value leaves the others as set", () => {
    const { config, warnings } = load({
      INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR: "2500",
      INCOMING_REQUEST_MAX_REQUESTS_PER_JOB: "0",
    });

    expect(config.INCOMING_REQUEST_MAX_PENDING_REQUESTS_PER_MONITOR).toBe(2500);
    expect(config.INCOMING_REQUEST_MAX_PENDING_MEGABYTES_PER_MONITOR).toBe(16);
    expect(config.INCOMING_REQUEST_MAX_REQUESTS_PER_JOB).toBe(100);
    expect(warnings).toHaveLength(1);
  });
});
