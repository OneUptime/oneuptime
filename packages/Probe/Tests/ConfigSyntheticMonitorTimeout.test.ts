import { MAX_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS } from "../Utils/Monitors/SyntheticRuntime/Limits";

describe("synthetic monitor timeout configuration", () => {
  const originalOneUptimeUrl: string | undefined = process.env["ONEUPTIME_URL"];
  const originalProbeKey: string | undefined = process.env["PROBE_KEY"];
  const originalTimeout: string | undefined =
    process.env["PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS"];
  const proxyEnvironmentKeys: Array<string> = [
    "HTTP_PROXY_URL",
    "HTTPS_PROXY_URL",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "http_proxy",
    "https_proxy",
  ];
  const originalProxyEnvironment: Record<string, string | undefined> =
    Object.fromEntries(
      proxyEnvironmentKeys.map((key: string): [string, string | undefined] => {
        return [key, process.env[key]];
      }),
    );

  beforeAll(() => {
    process.env["ONEUPTIME_URL"] = "http://oneuptime.test";
    process.env["PROBE_KEY"] = "test-probe-key";
  });

  afterAll(() => {
    restoreEnvironment("ONEUPTIME_URL", originalOneUptimeUrl);
    restoreEnvironment("PROBE_KEY", originalProbeKey);
    restoreEnvironment(
      "PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS",
      originalTimeout,
    );
    for (const key of proxyEnvironmentKeys) {
      restoreEnvironment(key, originalProxyEnvironment[key]);
    }
  });

  test.each([
    ["a timeout just above ten minutes", "600001", 600_001],
    [
      "the exact safe upper boundary",
      MAX_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS.toString(),
      MAX_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS,
    ],
  ])("accepts %s", (_name: string, configured: string, expected: number) => {
    expect(loadConfiguredTimeout(configured)).toBe(expected);
  });

  test("rejects a timeout above the safe upper boundary", () => {
    expect(
      loadConfiguredTimeout(
        (MAX_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS + 1).toString(),
      ),
    ).toBe(60_000);
  });

  test("uses conventional uppercase proxy variables as fallbacks", () => {
    expect(
      loadConfiguredProxies({
        HTTP_PROXY: "http://uppercase-http.internal:3128",
        HTTPS_PROXY: "http://uppercase-https.internal:3129",
      }),
    ).toEqual({
      httpProxyUrl: "http://uppercase-http.internal:3128",
      httpsProxyUrl: "http://uppercase-https.internal:3129",
    });
  });

  test("keeps OneUptime proxy URL variables at highest precedence", () => {
    expect(
      loadConfiguredProxies({
        HTTP_PROXY_URL: "http://configured-http.internal:8080",
        HTTPS_PROXY_URL: "http://configured-https.internal:8443",
        HTTP_PROXY: "http://uppercase-http.internal:3128",
        HTTPS_PROXY: "http://uppercase-https.internal:3129",
        http_proxy: "http://lowercase-http.internal:4128",
        https_proxy: "http://lowercase-https.internal:4129",
      }),
    ).toEqual({
      httpProxyUrl: "http://configured-http.internal:8080",
      httpsProxyUrl: "http://configured-https.internal:8443",
    });
  });

  test("preserves lowercase proxy precedence when both conventional forms exist", () => {
    expect(
      loadConfiguredProxies({
        HTTP_PROXY: "http://uppercase-http.internal:3128",
        HTTPS_PROXY: "http://uppercase-https.internal:3129",
        http_proxy: "http://lowercase-http.internal:4128",
        https_proxy: "http://lowercase-https.internal:4129",
      }),
    ).toEqual({
      httpProxyUrl: "http://lowercase-http.internal:4128",
      httpsProxyUrl: "http://lowercase-https.internal:4129",
    });
  });

  function loadConfiguredTimeout(value: string): number {
    process.env["PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS"] = value;
    let timeoutInMs: number = 0;

    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      const config: { PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS: number } =
        require("../Config") as {
          PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS: number;
        };
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      timeoutInMs = config.PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS;
    });

    return timeoutInMs;
  }

  function loadConfiguredProxies(values: Record<string, string>): {
    httpProxyUrl: string | null;
    httpsProxyUrl: string | null;
  } {
    for (const key of proxyEnvironmentKeys) {
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(values)) {
      process.env[key] = value;
    }

    let result: {
      httpProxyUrl: string | null;
      httpsProxyUrl: string | null;
    } = { httpProxyUrl: null, httpsProxyUrl: null };

    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      const config: {
        HTTP_PROXY_URL: string | null;
        HTTPS_PROXY_URL: string | null;
      } = require("../Config") as {
        HTTP_PROXY_URL: string | null;
        HTTPS_PROXY_URL: string | null;
      };
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      result = {
        httpProxyUrl: config.HTTP_PROXY_URL,
        httpsProxyUrl: config.HTTPS_PROXY_URL,
      };
    });

    return result;
  }

  function restoreEnvironment(key: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[key];
      return;
    }
    process.env[key] = value;
  }
});
