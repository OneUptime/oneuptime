import ProcessRunner from "../../../../Utils/Monitors/SyntheticRuntime/ProcessRunner";
import {
  SyntheticMonitorWorkerConfig,
  SyntheticMonitorWorkerResult,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticMonitorWorkerTypes";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import { RetryAttempt } from "Common/Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";

interface SyntheticMonitorClass {
  execute(options: {
    script: string;
    browserTypes: BrowserType[];
    screenSizeTypes: ScreenSizeType[];
    retryCountOnError?: number;
  }): Promise<SyntheticMonitorResponse[] | null>;
  getChromeExecutablePath(): Promise<string>;
  getFirefoxExecutablePath(): Promise<string>;
}

interface ProxyConfigClass {
  isProxyConfigured(): boolean;
  getHttpProxyUrl(): string | null;
  getHttpsProxyUrl(): string | null;
}

interface JsonSafeResultCase {
  name: string;
  data: unknown;
}

describe("SyntheticMonitor secure worker orchestration", () => {
  const originalOneUptimeUrl: string | undefined = process.env["ONEUPTIME_URL"];
  const originalProbeKey: string | undefined = process.env["PROBE_KEY"];
  let SyntheticMonitor: SyntheticMonitorClass;
  let runSpy: jest.SpyInstance;
  let chromePathSpy: jest.SpyInstance;
  let firefoxPathSpy: jest.SpyInstance;
  let ProxyConfig: ProxyConfigClass;
  let noProxy: Array<string>;
  let originalNoProxy: Array<string>;

  beforeAll(() => {
    process.env["ONEUPTIME_URL"] = "http://oneuptime.test";
    process.env["PROBE_KEY"] = "test-probe-key";
    runSpy = jest.spyOn(ProcessRunner.prototype, "run");
    SyntheticMonitor = jest.requireActual<{
      default: SyntheticMonitorClass;
    }>("../../../../Utils/Monitors/MonitorTypes/SyntheticMonitor").default;
    chromePathSpy = jest
      .spyOn(SyntheticMonitor, "getChromeExecutablePath")
      .mockResolvedValue("/playwright/chromium");
    firefoxPathSpy = jest
      .spyOn(SyntheticMonitor, "getFirefoxExecutablePath")
      .mockResolvedValue("/playwright/firefox");
    ProxyConfig = jest.requireActual<{
      default: ProxyConfigClass;
    }>("../../../../Utils/ProxyConfig").default;
    noProxy = jest.requireActual<{ NO_PROXY: Array<string> }>(
      "../../../../Config",
    ).NO_PROXY;
    originalNoProxy = [...noProxy];
  });

  beforeEach(() => {
    runSpy.mockReset();
    chromePathSpy.mockClear();
    firefoxPathSpy.mockClear();
  });

  afterAll(() => {
    noProxy.splice(0, noProxy.length, ...originalNoProxy);
    jest.restoreAllMocks();
    if (originalOneUptimeUrl === undefined) {
      delete process.env["ONEUPTIME_URL"];
    } else {
      process.env["ONEUPTIME_URL"] = originalOneUptimeUrl;
    }
    if (originalProbeKey === undefined) {
      delete process.env["PROBE_KEY"];
    } else {
      process.env["PROBE_KEY"] = originalProbeKey;
    }
  });

  test("maps copied worker output to the monitor response", async () => {
    runSpy.mockResolvedValue(
      workerRunResult({
        returnValue: { data: { status: "ok" } },
        logMessages: ["started", "complete"],
        capturedMetrics: [
          { name: "checkout_latency", value: 42, attributes: { route: "/" } },
        ],
        screenshots: { home: "cG5n" },
      }),
    );

    const responses: SyntheticMonitorResponse[] | null =
      await SyntheticMonitor.execute({
        script: "return { data: { status: 'ok' } };",
        browserTypes: [BrowserType.Chromium],
        screenSizeTypes: [ScreenSizeType.Desktop],
      });

    expect(responses).toHaveLength(1);
    expect(responses?.[0]).toMatchObject({
      result: { status: "ok" },
      logMessages: ["started", "complete"],
      capturedMetrics: [
        { name: "checkout_latency", value: 42, attributes: { route: "/" } },
      ],
      screenshots: { home: "cG5n" },
      browserType: BrowserType.Chromium,
      screenSizeType: ScreenSizeType.Desktop,
      totalAttempts: 1,
    });
    expect(responses?.[0]?.retryAttempts).toBeUndefined();

    const payload: SyntheticMonitorWorkerConfig = runSpy.mock.calls[0]?.[0]
      .payload as SyntheticMonitorWorkerConfig;
    expect(payload).toMatchObject({
      code: "return { data: { status: 'ok' } };",
      browserType: BrowserType.Chromium,
      screenSizeType: ScreenSizeType.Desktop,
      executablePath: "/playwright/chromium",
      viewport: { width: 1920, height: 1080 },
      args: {},
    });
    expect(typeof payload.chromiumSandboxEnabled).toBe("boolean");
    expect(runSpy.mock.calls[0]?.[0].validateResult).toEqual(
      expect.any(Function),
    );
  });

  const jsonSafeResultCases: Array<JsonSafeResultCase> = [
    {
      name: "an array with mixed nested values",
      data: [1, "two", true, null, { nested: ["value", null] }],
    },
    { name: "an explicit null", data: null },
    {
      name: "nested objects and arrays",
      data: { outer: { items: [{ ok: true }, [1, 2, 3]], empty: null } },
    },
  ];

  test.each(jsonSafeResultCases)(
    "preserves JSON-safe returned data: $name",
    async ({ data }: JsonSafeResultCase) => {
      runSpy.mockResolvedValue(
        workerRunResult({
          returnValue: { data },
          logMessages: [],
          capturedMetrics: [],
          screenshots: {},
        }),
      );

      const responses: SyntheticMonitorResponse[] | null =
        await SyntheticMonitor.execute({
          script: "return { data: null };",
          browserTypes: [BrowserType.Chromium],
          screenSizeTypes: [ScreenSizeType.Desktop],
        });

      expect(responses?.[0]?.result).toEqual(data);
    },
  );

  test("passes the configured NO_PROXY list to the browser proxy", async () => {
    const configuredSpy: jest.SpyInstance = jest
      .spyOn(ProxyConfig, "isProxyConfigured")
      .mockReturnValue(true);
    const httpsProxySpy: jest.SpyInstance = jest
      .spyOn(ProxyConfig, "getHttpsProxyUrl")
      .mockReturnValue("http://proxy.internal:8080");
    const httpProxySpy: jest.SpyInstance = jest
      .spyOn(ProxyConfig, "getHttpProxyUrl")
      .mockReturnValue(null);
    noProxy.splice(
      0,
      noProxy.length,
      "localhost",
      "127.0.0.1",
      ".internal.example",
    );
    runSpy.mockResolvedValue(
      workerRunResult({
        returnValue: { data: true },
        logMessages: [],
        capturedMetrics: [],
        screenshots: {},
      }),
    );

    try {
      await SyntheticMonitor.execute({
        script: "return { data: true };",
        browserTypes: [BrowserType.Chromium],
        screenSizeTypes: [ScreenSizeType.Desktop],
      });

      const payload: SyntheticMonitorWorkerConfig = runSpy.mock.calls[0]?.[0]
        .payload as SyntheticMonitorWorkerConfig;
      expect(payload.proxy).toEqual({
        server: "http://proxy.internal:8080",
        bypass: "localhost,127.0.0.1,.internal.example",
      });
    } finally {
      noProxy.splice(0, noProxy.length, ...originalNoProxy);
      configuredSpy.mockRestore();
      httpsProxySpy.mockRestore();
      httpProxySpy.mockRestore();
    }
  });

  test("preserves browser-outer, screen-inner matrix ordering and viewports", async () => {
    runSpy.mockImplementation(
      async (input: {
        payload: SyntheticMonitorWorkerConfig;
      }): Promise<ReturnType<typeof workerRunResult>> => {
        return workerRunResult({
          returnValue: {
            data: `${input.payload.browserType}:${input.payload.screenSizeType}`,
          },
          logMessages: [],
          capturedMetrics: [],
          screenshots: {},
        });
      },
    );

    const responses: SyntheticMonitorResponse[] | null =
      await SyntheticMonitor.execute({
        script: "return { data: true };",
        browserTypes: [BrowserType.Chromium, BrowserType.Firefox],
        screenSizeTypes: [
          ScreenSizeType.Desktop,
          ScreenSizeType.Mobile,
          ScreenSizeType.Tablet,
        ],
      });

    expect(
      responses?.map((response: SyntheticMonitorResponse) => {
        return response.result;
      }),
    ).toEqual([
      "Chromium:Desktop",
      "Chromium:Mobile",
      "Chromium:Tablet",
      "Firefox:Desktop",
      "Firefox:Mobile",
      "Firefox:Tablet",
    ]);
    expect(
      runSpy.mock.calls.map((call: unknown[]) => {
        const config: SyntheticMonitorWorkerConfig = (
          call[0] as { payload: SyntheticMonitorWorkerConfig }
        ).payload;
        return config.viewport;
      }),
    ).toEqual([
      { width: 1920, height: 1080 },
      { width: 360, height: 640 },
      { width: 1024, height: 768 },
      { width: 1920, height: 1080 },
      { width: 360, height: 640 },
      { width: 1024, height: 768 },
    ]);
    expect(chromePathSpy).toHaveBeenCalledTimes(3);
    expect(firefoxPathSpy).toHaveBeenCalledTimes(3);
  });

  test("retries script errors, stops after success, and records attempt history", async () => {
    const timeoutSpy: jest.SpyInstance = jest
      .spyOn(global, "setTimeout")
      .mockImplementation(((callback: () => void): NodeJS.Timeout => {
        callback();
        return {} as NodeJS.Timeout;
      }) as typeof setTimeout);
    runSpy
      .mockResolvedValueOnce(
        workerRunResult({
          logMessages: ["first"],
          capturedMetrics: [],
          screenshots: { first: "Zmlyc3Q=" },
          scriptError: "first failure",
        }),
      )
      .mockResolvedValueOnce(
        workerRunResult({
          returnValue: { data: "recovered" },
          logMessages: ["second"],
          capturedMetrics: [],
          screenshots: { second: "c2Vjb25k" },
        }),
      );

    try {
      const responses: SyntheticMonitorResponse[] | null =
        await SyntheticMonitor.execute({
          script: "return { data: 'recovered' };",
          browserTypes: [BrowserType.Chromium],
          screenSizeTypes: [ScreenSizeType.Mobile],
          retryCountOnError: 3,
        });

      expect(runSpy).toHaveBeenCalledTimes(2);
      expect(responses?.[0]).toMatchObject({
        result: "recovered",
        totalAttempts: 2,
        retryAttempts: [
          { attemptNumber: 1, scriptError: "first failure" },
          { attemptNumber: 2, scriptError: undefined },
        ],
      });
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  test("stops at the configured retry limit when every attempt fails", async () => {
    const timeoutSpy: jest.SpyInstance = jest
      .spyOn(global, "setTimeout")
      .mockImplementation(((callback: () => void): NodeJS.Timeout => {
        callback();
        return {} as NodeJS.Timeout;
      }) as typeof setTimeout);
    runSpy
      .mockResolvedValueOnce(
        workerRunResult({
          logMessages: [],
          capturedMetrics: [],
          screenshots: {},
          scriptError: "failure 1",
        }),
      )
      .mockResolvedValueOnce(
        workerRunResult({
          logMessages: [],
          capturedMetrics: [],
          screenshots: {},
          scriptError: "failure 2",
        }),
      )
      .mockResolvedValueOnce(
        workerRunResult({
          logMessages: [],
          capturedMetrics: [],
          screenshots: {},
          scriptError: "failure 3",
        }),
      );

    try {
      const responses: SyntheticMonitorResponse[] | null =
        await SyntheticMonitor.execute({
          script: "throw new Error('failure');",
          browserTypes: [BrowserType.Firefox],
          screenSizeTypes: [ScreenSizeType.Tablet],
          retryCountOnError: 2,
        });

      expect(runSpy).toHaveBeenCalledTimes(3);
      expect(responses?.[0]?.scriptError).toBe("failure 3");
      expect(responses?.[0]?.totalAttempts).toBe(3);
      expect(
        responses?.[0]?.retryAttempts?.map((attempt: RetryAttempt) => {
          return attempt.scriptError;
        }),
      ).toEqual(["failure 1", "failure 2", "failure 3"]);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  test("turns worker infrastructure failures into a monitor script error", async () => {
    runSpy.mockRejectedValue(new Error("worker launch failed"));

    const responses: SyntheticMonitorResponse[] | null =
      await SyntheticMonitor.execute({
        script: "return { data: true };",
        browserTypes: [BrowserType.Chromium],
        screenSizeTypes: [ScreenSizeType.Desktop],
      });

    expect(responses?.[0]).toMatchObject({
      logMessages: [],
      capturedMetrics: [],
      screenshots: {},
      scriptError: "worker launch failed",
      totalAttempts: 1,
    });
  });
});

function workerRunResult(result: SyntheticMonitorWorkerResult): {
  result: SyntheticMonitorWorkerResult;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
} {
  return {
    result,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}
