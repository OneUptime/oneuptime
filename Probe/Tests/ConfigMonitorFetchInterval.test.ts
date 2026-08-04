// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS is the ceiling on how fast any
 * monitor can be checked, so the value has to turn into a cron expression
 * that fires on an even grid. Only divisors of 60 do: "*\/45 * * * * *" fires
 * at :00 and :45, alternating 45- and 15-second gaps, which would make a
 * "20 second" monitor anything but. Anything else falls back to the default
 * rather than quietly producing a lumpy schedule.
 *
 * Config.ts reads the environment once at module load, so each case has to
 * reset the module registry and re-require it.
 */

interface MonitorFetchConfig {
  PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS: number;
  PROBE_MONITOR_FETCH_CRON: string;
  PROBE_MONITOR_FETCH_JITTER_IN_MS: number;
}

function loadConfigWithInterval(value: string | undefined): MonitorFetchConfig {
  jest.resetModules();

  if (value === undefined) {
    delete process.env["PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS"];
  } else {
    process.env["PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS"] = value;
  }

  /*
   * A plain require, not an import: Config.ts reads process.env once at module
   * load, so each case has to force a fresh evaluation.
   */
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  return require("../Config") as MonitorFetchConfig;
}

afterEach(() => {
  delete process.env["PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS"];
  jest.restoreAllMocks();
  jest.resetModules();
});

describe("probe monitor fetch interval configuration", () => {
  test("defaults to ten seconds so sub-minute monitors work out of the box", () => {
    const config: MonitorFetchConfig = loadConfigWithInterval(undefined);

    expect(config.PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS).toBe(10);
    expect(config.PROBE_MONITOR_FETCH_CRON).toBe("*/10 * * * * *");
  });

  const supportedCases: Array<[string, number, string]> = [
    ["10", 10, "*/10 * * * * *"],
    ["12", 12, "*/12 * * * * *"],
    ["15", 15, "*/15 * * * * *"],
    ["20", 20, "*/20 * * * * *"],
    ["30", 30, "*/30 * * * * *"],
    // Sixty restores exactly the cadence the probe had before this feature.
    ["60", 60, "* * * * *"],
  ];

  test.each(supportedCases)(
    "%s seconds maps to %s and the cron %s",
    (envValue: string, expectedInterval: number, expectedCron: string) => {
      const config: MonitorFetchConfig = loadConfigWithInterval(envValue);

      expect(config.PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS).toBe(
        expectedInterval,
      );
      expect(config.PROBE_MONITOR_FETCH_CRON).toBe(expectedCron);
    },
  );

  const outOfRangeValues: Array<string> = [
    "1",
    "5",
    "9",
    "0",
    "-5",
    "61",
    "120",
    "notanumber",
  ];

  test.each(outOfRangeValues)(
    "%s is outside the supported range and falls back to ten seconds",
    (envValue: string) => {
      const config: MonitorFetchConfig = loadConfigWithInterval(envValue);

      expect(config.PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS).toBe(10);
      expect(config.PROBE_MONITOR_FETCH_CRON).toBe("*/10 * * * * *");
    },
  );

  const unevenValues: Array<string> = ["11", "13", "25", "45", "50"];

  test.each(unevenValues)(
    "%s does not divide 60 evenly and falls back to ten seconds",
    (envValue: string) => {
      const config: MonitorFetchConfig = loadConfigWithInterval(envValue);

      expect(config.PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS).toBe(
        Number(envValue),
      );
      expect(config.PROBE_MONITOR_FETCH_CRON).toBe("*/10 * * * * *");
    },
  );

  test.each(supportedCases)(
    "jitter for %s seconds stays at a tenth of one tick",
    (envValue: string) => {
      const config: MonitorFetchConfig = loadConfigWithInterval(envValue);

      expect(config.PROBE_MONITOR_FETCH_JITTER_IN_MS).toBe(
        (config.PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS * 1000) / 10,
      );

      // Always strictly inside one tick, so it can never cause a missed tick.
      expect(config.PROBE_MONITOR_FETCH_JITTER_IN_MS).toBeLessThan(
        config.PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS * 1000,
      );

      // And always far below the 45 seconds this used to be.
      expect(config.PROBE_MONITOR_FETCH_JITTER_IN_MS).toBeLessThanOrEqual(6000);
    },
  );
});
