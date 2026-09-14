interface DiscoveryConcurrencyConfig {
  PROBE_DISCOVERY_MAX_CONCURRENT_SCANS: number;
  PROBE_DISCOVERY_SCAN_CONCURRENCY: number;
}

describe("discovery scan concurrency configuration", () => {
  const environmentKeys: Array<string> = [
    "ONEUPTIME_URL",
    "PROBE_KEY",
    "PROBE_DISCOVERY_MAX_CONCURRENT_SCANS",
    "PROBE_DISCOVERY_SCAN_CONCURRENCY",
  ];
  const originalEnvironment: Record<string, string | undefined> =
    Object.fromEntries(
      environmentKeys.map((key: string): [string, string | undefined] => {
        return [key, process.env[key]];
      }),
    );

  beforeEach(() => {
    process.env["ONEUPTIME_URL"] = "http://oneuptime.test";
    process.env["PROBE_KEY"] = "test-probe-key";
    delete process.env["PROBE_DISCOVERY_MAX_CONCURRENT_SCANS"];
    delete process.env["PROBE_DISCOVERY_SCAN_CONCURRENCY"];
  });

  afterAll(() => {
    for (const key of environmentKeys) {
      const value: string | undefined = originalEnvironment[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("defaults to four scans and preserves automatic per-host concurrency", () => {
    expect(loadConfig()).toEqual({
      PROBE_DISCOVERY_MAX_CONCURRENT_SCANS: 4,
      PROBE_DISCOVERY_SCAN_CONCURRENCY: 0,
    });
  });

  test.each([
    ["one scan", "1", 1],
    ["two scans", "2", 2],
    ["the default explicitly", "4", 4],
    ["a larger pool", "8", 8],
    ["the maximum allowed pool", "16", 16],
    ["surrounding whitespace", " 3 ", 3],
  ])("accepts %s", (_name: string, configured: string, expected: number) => {
    process.env["PROBE_DISCOVERY_MAX_CONCURRENT_SCANS"] = configured;
    expect(loadConfig().PROBE_DISCOVERY_MAX_CONCURRENT_SCANS).toBe(expected);
  });

  test.each([
    ["an empty value", ""],
    ["whitespace", " "],
    ["zero", "0"],
    ["a negative number", "-1"],
    ["a value above the maximum", "17"],
    ["an excessive value", "999999"],
    ["text", "invalid"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
  ])("falls back to four for %s", (_name: string, configured: string) => {
    process.env["PROBE_DISCOVERY_MAX_CONCURRENT_SCANS"] = configured;
    expect(loadConfig().PROBE_DISCOVERY_MAX_CONCURRENT_SCANS).toBe(4);
  });

  test("changing simultaneous scans leaves the per-host setting at its default", () => {
    process.env["PROBE_DISCOVERY_MAX_CONCURRENT_SCANS"] = "2";
    expect(loadConfig()).toEqual({
      PROBE_DISCOVERY_MAX_CONCURRENT_SCANS: 2,
      PROBE_DISCOVERY_SCAN_CONCURRENCY: 0,
    });
  });

  test("changing per-host concurrency leaves the simultaneous scan default intact", () => {
    process.env["PROBE_DISCOVERY_SCAN_CONCURRENCY"] = "64";
    expect(loadConfig()).toEqual({
      PROBE_DISCOVERY_MAX_CONCURRENT_SCANS: 4,
      PROBE_DISCOVERY_SCAN_CONCURRENCY: 64,
    });
  });

  test("operators can set independent scan and host limits", () => {
    process.env["PROBE_DISCOVERY_MAX_CONCURRENT_SCANS"] = "3";
    process.env["PROBE_DISCOVERY_SCAN_CONCURRENCY"] = "128";
    expect(loadConfig()).toEqual({
      PROBE_DISCOVERY_MAX_CONCURRENT_SCANS: 3,
      PROBE_DISCOVERY_SCAN_CONCURRENCY: 128,
    });
  });

  test("an invalid scan limit does not discard a valid per-host override", () => {
    process.env["PROBE_DISCOVERY_MAX_CONCURRENT_SCANS"] = "17";
    process.env["PROBE_DISCOVERY_SCAN_CONCURRENCY"] = "1024";
    expect(loadConfig()).toEqual({
      PROBE_DISCOVERY_MAX_CONCURRENT_SCANS: 4,
      PROBE_DISCOVERY_SCAN_CONCURRENCY: 1024,
    });
  });

  function loadConfig(): DiscoveryConcurrencyConfig {
    let result: DiscoveryConcurrencyConfig | undefined;
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      const config: DiscoveryConcurrencyConfig =
        require("../Config") as DiscoveryConcurrencyConfig;
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      result = {
        PROBE_DISCOVERY_MAX_CONCURRENT_SCANS:
          config.PROBE_DISCOVERY_MAX_CONCURRENT_SCANS,
        PROBE_DISCOVERY_SCAN_CONCURRENCY:
          config.PROBE_DISCOVERY_SCAN_CONCURRENCY,
      };
    });

    if (!result) {
      throw new Error("Probe configuration did not load");
    }
    return result;
  }
});
