import { describe, expect, test } from "@jest/globals";
import CpuCount from "Common/Server/Utils/CpuCount";

/*
 * Env parsing for the decode thread pool knobs:
 *
 *   - TELEMETRY_DECODE_THREADS: default ADAPTIVE — the pool is ENABLED
 *     BY DEFAULT, sized clamp(effectiveCpuCount - 1, 0, 4) where
 *     effectiveCpuCount is cgroup-aware (Common/Server/Utils/CpuCount).
 *     One core stays reserved for the event loop, so a 1-effective-CPU
 *     pod adapts to 0 threads (pool off, inline decode — no regression
 *     for the smallest pods). 0 is a VALID explicit value and is the
 *     hard-off switch (the strictly-positive parseBatchSize would have
 *     made "off" unexpressable); a positive value pins the count;
 *     negatives/garbage fall back to the ADAPTIVE default — NOT to 0 —
 *     so an operator typo cannot silently disable a default-on
 *     subsystem.
 *   - TELEMETRY_DECODE_MIN_PAYLOAD_BYTES: default 8192, 0 valid
 *     ("no minimum, route everything"), negatives/garbage fall back.
 *
 * The config module reads env at import time, so each case re-imports
 * it in isolation (same pattern as ClickhouseKeepAliveOptions.test.ts).
 * The adaptive cases inject a fake CpuCount via jest.doMock inside the
 * isolated registry, which makes the CPU-dependent expectations
 * deterministic on any test machine.
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
  options?: {
    /*
     * When provided, the isolated registry gets a fake CpuCount whose
     * getEffectiveCpuCount returns exactly this value — the adaptive-
     * default cases would otherwise depend on the test machine's (and
     * its cgroup's) real CPU count.
     */
    effectiveCpuCount?: number;
  },
): TelemetryConfigModule {
  let loaded: TelemetryConfigModule | undefined = undefined;

  jest.isolateModules(() => {
    if (options?.effectiveCpuCount !== undefined) {
      jest.doMock("Common/Server/Utils/CpuCount", () => {
        return {
          __esModule: true,
          default: {
            getEffectiveCpuCount: (): number => {
              return options.effectiveCpuCount as number;
            },
          },
        };
      });
    }

    try {
      withEnv(env, () => {
        /* eslint-disable @typescript-eslint/no-var-requires */
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        loaded = require("../../FeatureSet/Telemetry/Config");
        /* eslint-enable @typescript-eslint/no-var-requires */
      });
    } finally {
      if (options?.effectiveCpuCount !== undefined) {
        // Keep the mock scoped to THIS isolated load only.
        jest.dontMock("Common/Server/Utils/CpuCount");
      }
    }
  });

  return loaded!;
}

describe("TELEMETRY_DECODE_THREADS parsing", () => {
  describe("unset -> adaptive default: clamp(effectiveCpuCount - 1, 0, 4)", () => {
    /*
     * The full clamp table. 1 CPU -> 0 is the load-bearing row: the
     * smallest pods keep the exact pre-pool inline behavior; the >= 5
     * rows pin the memory-bounding cap of 4.
     */
    const clampTable: Array<{ cpus: number; threads: number }> = [
      { cpus: 1, threads: 0 },
      { cpus: 2, threads: 1 },
      { cpus: 3, threads: 2 },
      { cpus: 4, threads: 3 },
      { cpus: 5, threads: 4 },
      { cpus: 8, threads: 4 },
      { cpus: 64, threads: 4 },
    ];

    for (const row of clampTable) {
      test(`${row.cpus} effective CPU(s) -> ${row.threads} thread(s)`, () => {
        const config: TelemetryConfigModule = loadConfig(
          {},
          { effectiveCpuCount: row.cpus },
        );
        expect(config.TELEMETRY_DECODE_THREADS).toBe(row.threads);
      });
    }

    test("unlimited cgroup (real CpuCount, no mock) -> min(4, hostCpus - 1)", () => {
      /*
       * Same computation Config.ts performs, fed from the REAL utility
       * on this machine — pins that the config actually consults
       * CpuCount rather than some other CPU source. (On an unlimited /
       * non-cgroup machine getEffectiveCpuCount() is the host
       * parallelism, so the expectation is min(4, host - 1).)
       */
      const expected: number = Math.min(
        4,
        Math.max(0, CpuCount.getEffectiveCpuCount() - 1),
      );
      const config: TelemetryConfigModule = loadConfig({});
      expect(config.TELEMETRY_DECODE_THREADS).toBe(expected);
    });
  });

  test("a valid positive override pins the count (beats the adaptive default)", () => {
    const config: TelemetryConfigModule = loadConfig(
      {
        TELEMETRY_DECODE_THREADS: "6",
      },
      { effectiveCpuCount: 2 },
    );
    expect(config.TELEMETRY_DECODE_THREADS).toBe(6);
  });

  test("an explicit 0 hard-disables — even on a many-CPU machine", () => {
    const config: TelemetryConfigModule = loadConfig(
      {
        TELEMETRY_DECODE_THREADS: "0",
      },
      { effectiveCpuCount: 8 },
    );
    expect(config.TELEMETRY_DECODE_THREADS).toBe(0);
  });

  test("a negative value falls back to the ADAPTIVE default (not 0)", () => {
    const config: TelemetryConfigModule = loadConfig(
      {
        TELEMETRY_DECODE_THREADS: "-2",
      },
      { effectiveCpuCount: 8 },
    );
    expect(config.TELEMETRY_DECODE_THREADS).toBe(4);
  });

  test("a non-numeric value falls back to the ADAPTIVE default (not 0)", () => {
    const config: TelemetryConfigModule = loadConfig(
      {
        TELEMETRY_DECODE_THREADS: "many",
      },
      { effectiveCpuCount: 3 },
    );
    expect(config.TELEMETRY_DECODE_THREADS).toBe(2);
  });

  test("invalid on a 1-CPU pod still resolves to 0 (adaptive, pool off)", () => {
    const config: TelemetryConfigModule = loadConfig(
      {
        TELEMETRY_DECODE_THREADS: "garbage",
      },
      { effectiveCpuCount: 1 },
    );
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
