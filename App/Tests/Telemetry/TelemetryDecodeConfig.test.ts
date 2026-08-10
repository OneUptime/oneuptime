import { describe, expect, test } from "@jest/globals";

/*
 * Env parsing for the decode thread pool knobs:
 *
 *   - TELEMETRY_DECODE_THREADS: default 0 (pool DISABLED — the
 *     load-bearing default: shipping this feature must not change any
 *     deployment's behavior until it is explicitly opted into), 0 is a
 *     VALID explicit value (the strictly-positive parseBatchSize would
 *     have made "off" unexpressable), negatives/garbage fall back.
 *   - TELEMETRY_DECODE_MIN_PAYLOAD_BYTES: default 8192, 0 valid
 *     ("no minimum, route everything"), negatives/garbage fall back.
 *
 * The config module reads env at import time, so each case re-imports
 * it in isolation (same pattern as ClickhouseKeepAliveOptions.test.ts).
 */

type TelemetryConfigModule = {
  TELEMETRY_DECODE_THREADS: number;
  TELEMETRY_DECODE_MIN_PAYLOAD_BYTES: number;
};

const CONFIG_ENV_KEYS: Array<string> = [
  "TELEMETRY_DECODE_THREADS",
  "TELEMETRY_DECODE_MIN_PAYLOAD_BYTES",
];

function withEnv<T>(
  env: Record<string, string | undefined>,
  callback: () => T,
): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of CONFIG_ENV_KEYS) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function loadConfig(
  env: Record<string, string | undefined>,
): TelemetryConfigModule {
  let loaded: TelemetryConfigModule | undefined = undefined;

  jest.isolateModules(() => {
    withEnv(env, () => {
      /* eslint-disable @typescript-eslint/no-var-requires */
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = require("../../FeatureSet/Telemetry/Config");
      /* eslint-enable @typescript-eslint/no-var-requires */
    });
  });

  return loaded!;
}

describe("TELEMETRY_DECODE_THREADS parsing", () => {
  test("defaults to 0 (pool disabled) when unset", () => {
    const config: TelemetryConfigModule = loadConfig({});
    expect(config.TELEMETRY_DECODE_THREADS).toBe(0);
  });

  test("a valid positive override is honored", () => {
    const config: TelemetryConfigModule = loadConfig({
      TELEMETRY_DECODE_THREADS: "4",
    });
    expect(config.TELEMETRY_DECODE_THREADS).toBe(4);
  });

  test("an explicit 0 is accepted (NOT treated as invalid-falls-back)", () => {
    const config: TelemetryConfigModule = loadConfig({
      TELEMETRY_DECODE_THREADS: "0",
    });
    expect(config.TELEMETRY_DECODE_THREADS).toBe(0);
  });

  test("a negative value falls back to the default", () => {
    const config: TelemetryConfigModule = loadConfig({
      TELEMETRY_DECODE_THREADS: "-2",
    });
    expect(config.TELEMETRY_DECODE_THREADS).toBe(0);
  });

  test("a non-numeric value falls back to the default", () => {
    const config: TelemetryConfigModule = loadConfig({
      TELEMETRY_DECODE_THREADS: "many",
    });
    expect(config.TELEMETRY_DECODE_THREADS).toBe(0);
  });
});

describe("TELEMETRY_DECODE_MIN_PAYLOAD_BYTES parsing", () => {
  test("defaults to 8192 when unset", () => {
    const config: TelemetryConfigModule = loadConfig({});
    expect(config.TELEMETRY_DECODE_MIN_PAYLOAD_BYTES).toBe(8192);
  });

  test("a valid override is honored", () => {
    const config: TelemetryConfigModule = loadConfig({
      TELEMETRY_DECODE_MIN_PAYLOAD_BYTES: "65536",
    });
    expect(config.TELEMETRY_DECODE_MIN_PAYLOAD_BYTES).toBe(65536);
  });

  test("an explicit 0 is accepted (route everything to the pool)", () => {
    const config: TelemetryConfigModule = loadConfig({
      TELEMETRY_DECODE_MIN_PAYLOAD_BYTES: "0",
    });
    expect(config.TELEMETRY_DECODE_MIN_PAYLOAD_BYTES).toBe(0);
  });

  test("a negative value falls back to the default", () => {
    const config: TelemetryConfigModule = loadConfig({
      TELEMETRY_DECODE_MIN_PAYLOAD_BYTES: "-8192",
    });
    expect(config.TELEMETRY_DECODE_MIN_PAYLOAD_BYTES).toBe(8192);
  });

  test("a non-numeric value falls back to the default", () => {
    const config: TelemetryConfigModule = loadConfig({
      TELEMETRY_DECODE_MIN_PAYLOAD_BYTES: "big",
    });
    expect(config.TELEMETRY_DECODE_MIN_PAYLOAD_BYTES).toBe(8192);
  });

  test("both knobs parse independently in one load", () => {
    const config: TelemetryConfigModule = loadConfig({
      TELEMETRY_DECODE_THREADS: "2",
      TELEMETRY_DECODE_MIN_PAYLOAD_BYTES: "1024",
    });
    expect(config.TELEMETRY_DECODE_THREADS).toBe(2);
    expect(config.TELEMETRY_DECODE_MIN_PAYLOAD_BYTES).toBe(1024);
  });
});
