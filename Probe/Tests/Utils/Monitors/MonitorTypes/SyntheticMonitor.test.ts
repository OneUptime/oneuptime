import ProcessRunner, {
  SyntheticProcessRunnerError,
} from "../../../../Utils/Monitors/SyntheticRuntime/ProcessRunner";
import { SYNTHETIC_RUNTIME_FAULT_KIND } from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticRuntimeFault";
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

interface LoggerClass {
  error(message: unknown, attributes?: unknown): void;
}

interface RuntimeFaultDiagnostics {
  internalDetail?: string | undefined;
  remoteStack?: string | undefined;
}

interface RuntimeFaultDetailCase {
  name: string;
  diagnostics: RuntimeFaultDiagnostics;
  expectedDetail: string | undefined;
}

interface FakeHrtimeClock {
  readonly advanceByMs: (milliseconds: number) => void;
  readonly restore: () => void;
}

type WorkerRunResult = ReturnType<typeof workerRunResult>;

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
  let logger: LoggerClass;

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
    logger = jest.requireActual<{ default: LoggerClass }>(
      "Common/Server/Utils/Logger",
    ).default;
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

  test("sanitizes non-JSON-safe leaves instead of discarding the whole result", async () => {
    runSpy.mockResolvedValue(
      workerRunResult({
        returnValue: {
          data: {
            ratio: 0.5,
            count: NaN,
            infinite: Infinity,
            when: new Date("2026-01-02T03:04:05.000Z"),
            missing: undefined,
            callback: () => {
              return true;
            },
            items: [1, NaN, "two"],
          },
        },
        logMessages: [],
        capturedMetrics: [],
        screenshots: {},
      }),
    );

    const responses: SyntheticMonitorResponse[] | null =
      await SyntheticMonitor.execute({
        script: "return { data: {} };",
        browserTypes: [BrowserType.Chromium],
        screenSizeTypes: [ScreenSizeType.Desktop],
      });

    expect(responses?.[0]?.result).toEqual({
      ratio: 0.5,
      count: null,
      infinite: null,
      when: "2026-01-02T03:04:05.000Z",
      items: [1, null, "two"],
    });
    expect(responses?.[0]?.scriptError).toBeUndefined();
  });

  test("drops only genuinely unserializable return values", async () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    runSpy.mockResolvedValue(
      workerRunResult({
        returnValue: { data: circular },
        logMessages: [],
        capturedMetrics: [],
        screenshots: {},
      }),
    );

    const responses: SyntheticMonitorResponse[] | null =
      await SyntheticMonitor.execute({
        script: "return { data: {} };",
        browserTypes: [BrowserType.Chromium],
        screenSizeTypes: [ScreenSizeType.Desktop],
      });

    expect(responses?.[0]?.result).toBeUndefined();
    expect(responses?.[0]?.scriptError).toBeUndefined();
  });

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
        /*
         * The sandbox's own controller origin leads the list, ahead of the
         * operator's entries: the internal bootstrap navigation must never
         * depend on their proxy being reachable.
         */
        bypass:
          "synthetic-runtime.oneuptime.invalid,localhost,127.0.0.1,.internal.example",
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

  /*
   * A probe that cannot start its own browser has not learned anything about
   * the customer's site. Everything below is about keeping those two apart:
   * the customer who reported this was handed a Playwright timeout on an
   * internal `.invalid` URL as though their script had failed, on the first
   * and only attempt, because Retry Count On Error defaults to zero.
   */
  function runtimeFault(
    message: string,
    diagnostics: RuntimeFaultDiagnostics = {},
  ): SyntheticProcessRunnerError {
    const error: SyntheticProcessRunnerError = Object.create(
      SyntheticProcessRunnerError.prototype,
    ) as SyntheticProcessRunnerError;
    Object.assign(error, {
      name: "SyntheticProcessRunnerError",
      message,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      kind: SYNTHETIC_RUNTIME_FAULT_KIND,
      remoteStack: `${message}\n    at WorkerController.execute (/usr/src/app/Utils/Monitors/SyntheticRuntime/WorkerController.ts:148:28)`,
      ...diagnostics,
    });
    return error;
  }

  const RUNTIME_FAULT_MESSAGE: string =
    "Synthetic monitor could not start on this probe: the browser runtime did not finish starting up after 3 attempt(s) of up to 20000 ms. The monitored page was never opened, so this does not reflect the health of the monitored site.";
  const BOOTSTRAP_DIAGNOSIS: string = [
    "Bootstrap attempt 1/3 failed after 20004 ms of its 20000 ms budget. Reached: page opened, route installed, binding installed, navigation started. Error: page.goto: Timeout 20000ms exceeded.",
    "Bootstrap attempt 2/3 failed after 20001 ms of its 20000 ms budget. Reached: page opened, route installed, binding installed, navigation started. Error: page.goto: Timeout 20000ms exceeded.",
    "Bootstrap attempt 3/3 failed after 20002 ms of its 20000 ms budget. Reached: page opened. Error: page.route did not settle within the attempt deadline.",
    "Last error: page.goto: Timeout 20000ms exceeded.\n    at https://synthetic-runtime.oneuptime.invalid/3f0c9d",
  ].join("\n");
  const WORKER_STACK: string = `SyntheticRuntimeFault: ${RUNTIME_FAULT_MESSAGE}\n    at WorkerController.openControllerPage (/usr/src/app/Utils/Monitors/SyntheticRuntime/WorkerController.ts:212:13)`;

  function runRetryDelaysImmediately(): jest.SpyInstance {
    return jest.spyOn(global, "setTimeout").mockImplementation(((
      callback: () => void,
    ): NodeJS.Timeout => {
      callback();
      return {} as NodeJS.Timeout;
    }) as typeof setTimeout);
  }

  function silenceErrorLog(): jest.SpyInstance {
    return jest.spyOn(logger, "error").mockImplementation((): void => {});
  }

  function loggedErrors(errorSpy: jest.SpyInstance): Array<unknown> {
    return errorSpy.mock.calls.map((call: unknown[]): unknown => {
      return call[0];
    });
  }

  function indexesOfLoggedErrors(
    errorSpy: jest.SpyInstance,
    matches: (entry: unknown) => boolean,
  ): Array<number> {
    return loggedErrors(errorSpy).reduce(
      (
        indexes: Array<number>,
        entry: unknown,
        index: number,
      ): Array<number> => {
        if (matches(entry)) {
          indexes.push(index);
        }
        return indexes;
      },
      [],
    );
  }

  function runtimeFaultLogLine(executionTimeInMS: number): string {
    return `Synthetic Monitor runtime fault after ${executionTimeInMS} ms (browser: ${BrowserType.Chromium}, screen size: ${ScreenSizeType.Desktop}): ${RUNTIME_FAULT_MESSAGE}`;
  }

  /*
   * process.hrtime is the monitor's only clock. Driving it by hand makes each
   * attempt's duration exact, so a test can tell a real measurement from the
   * 0 a failed run used to report, and one attempt's duration from another's.
   */
  function installFakeHrtime(): FakeHrtimeClock {
    let nowInNs: number = 7_000_000_000;
    const spy: jest.SpyInstance = jest
      .spyOn(process, "hrtime")
      .mockImplementation(((previous?: [number, number]): [number, number] => {
        const elapsedInNs: number = previous
          ? nowInNs - (previous[0] * 1_000_000_000 + previous[1])
          : nowInNs;
        return [
          Math.floor(elapsedInNs / 1_000_000_000),
          elapsedInNs % 1_000_000_000,
        ];
      }) as unknown as typeof process.hrtime);

    return {
      advanceByMs: (milliseconds: number): void => {
        nowInNs += milliseconds * 1_000_000;
      },
      restore: (): void => {
        spy.mockRestore();
      },
    };
  }

  function failAfter(
    clock: FakeHrtimeClock,
    milliseconds: number,
    error: Error,
  ): () => Promise<WorkerRunResult> {
    return async (): Promise<WorkerRunResult> => {
      clock.advanceByMs(milliseconds);
      throw error;
    };
  }

  function succeedAfter(
    clock: FakeHrtimeClock,
    milliseconds: number,
    result: SyntheticMonitorWorkerResult,
  ): () => Promise<WorkerRunResult> {
    return async (): Promise<WorkerRunResult> => {
      clock.advanceByMs(milliseconds);
      return workerRunResult(result);
    };
  }

  test("retries a probe runtime fault even when the tenant asked for no retries", async () => {
    const timeoutSpy: jest.SpyInstance = jest
      .spyOn(global, "setTimeout")
      .mockImplementation(((callback: () => void): NodeJS.Timeout => {
        callback();
        return {} as NodeJS.Timeout;
      }) as typeof setTimeout);
    runSpy
      .mockRejectedValueOnce(
        runtimeFault("Synthetic monitor could not start on this probe: ..."),
      )
      .mockResolvedValueOnce(
        workerRunResult({
          returnValue: { data: "recovered" },
          logMessages: [],
          capturedMetrics: [],
          screenshots: {},
        }),
      );

    try {
      const responses: SyntheticMonitorResponse[] | null =
        await SyntheticMonitor.execute({
          script: "return { data: 'recovered' };",
          browserTypes: [BrowserType.Chromium],
          screenSizeTypes: [ScreenSizeType.Desktop],
          // Deliberately absent: this is the default every monitor ships with.
        });

      expect(runSpy).toHaveBeenCalledTimes(2);
      expect(responses?.[0]).toMatchObject({
        result: "recovered",
        scriptError: undefined,
        totalAttempts: 2,
      });
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  test("does not retry a tenant script error the tenant chose not to retry", async () => {
    runSpy.mockResolvedValue(
      workerRunResult({
        logMessages: [],
        capturedMetrics: [],
        screenshots: {},
        scriptError: "TypeError: page.clickk is not a function",
      }),
    );

    const responses: SyntheticMonitorResponse[] | null =
      await SyntheticMonitor.execute({
        script: "await page.clickk('#buy');",
        browserTypes: [BrowserType.Chromium],
        screenSizeTypes: [ScreenSizeType.Desktop],
      });

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(responses?.[0]?.totalAttempts).toBe(1);
  });

  test("stops after one extra attempt when the runtime fault persists", async () => {
    const timeoutSpy: jest.SpyInstance = jest
      .spyOn(global, "setTimeout")
      .mockImplementation(((callback: () => void): NodeJS.Timeout => {
        callback();
        return {} as NodeJS.Timeout;
      }) as typeof setTimeout);
    runSpy.mockRejectedValue(
      runtimeFault(
        "Synthetic monitor could not start on this probe: the browser runtime did not finish starting up after 3 attempt(s) of 30000 ms. The monitored page was never opened, so this does not reflect the health of the monitored site.",
      ),
    );

    try {
      const responses: SyntheticMonitorResponse[] | null =
        await SyntheticMonitor.execute({
          script: "return { data: true };",
          browserTypes: [BrowserType.Chromium],
          screenSizeTypes: [ScreenSizeType.Desktop],
        });

      expect(runSpy).toHaveBeenCalledTimes(2);
      expect(responses?.[0]?.totalAttempts).toBe(2);
      /*
       * A persistent fault still has to be reported -- silently reporting a
       * monitor as healthy would be worse than a confusing message.
       */
      expect(responses?.[0]?.scriptError).toContain(
        "could not start on this probe",
      );
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  test("keeps OneUptime internals out of the error the tenant is shown", async () => {
    const timeoutSpy: jest.SpyInstance = jest
      .spyOn(global, "setTimeout")
      .mockImplementation(((callback: () => void): NodeJS.Timeout => {
        callback();
        return {} as NodeJS.Timeout;
      }) as typeof setTimeout);
    runSpy.mockRejectedValue(
      runtimeFault(
        "Synthetic monitor could not start on this probe: the browser runtime did not finish starting up after 3 attempt(s) of 30000 ms. The monitored page was never opened, so this does not reflect the health of the monitored site.",
      ),
    );

    try {
      const responses: SyntheticMonitorResponse[] | null =
        await SyntheticMonitor.execute({
          script: "return { data: true };",
          browserTypes: [BrowserType.Chromium],
          screenSizeTypes: [ScreenSizeType.Desktop],
        });

      const scriptError: string = responses?.[0]?.scriptError as string;
      expect(scriptError).not.toContain("synthetic-runtime.oneuptime.invalid");
      expect(scriptError).not.toContain("WorkerController.ts");
      expect(scriptError).not.toContain("page.goto");
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  test("retries the runtime fault per browser and screen-size combination", async () => {
    const timeoutSpy: jest.SpyInstance = jest
      .spyOn(global, "setTimeout")
      .mockImplementation(((callback: () => void): NodeJS.Timeout => {
        callback();
        return {} as NodeJS.Timeout;
      }) as typeof setTimeout);
    runSpy
      .mockRejectedValueOnce(runtimeFault("probe runtime fault"))
      .mockResolvedValueOnce(
        workerRunResult({
          returnValue: { data: "chromium-desktop" },
          logMessages: [],
          capturedMetrics: [],
          screenshots: {},
        }),
      )
      .mockResolvedValueOnce(
        workerRunResult({
          returnValue: { data: "firefox-desktop" },
          logMessages: [],
          capturedMetrics: [],
          screenshots: {},
        }),
      );

    try {
      const responses: SyntheticMonitorResponse[] | null =
        await SyntheticMonitor.execute({
          script: "return { data: true };",
          browserTypes: [BrowserType.Chromium, BrowserType.Firefox],
          screenSizeTypes: [ScreenSizeType.Desktop],
        });

      expect(runSpy).toHaveBeenCalledTimes(3);
      expect(
        responses?.map((response: SyntheticMonitorResponse) => {
          return response.result;
        }),
      ).toEqual(["chromium-desktop", "firefox-desktop"]);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  test("logs how long a runtime fault took, then one entry with the worker's diagnosis ahead of its stack", async () => {
    /*
     * The fault's message is written for the tenant and names no cause, so
     * this log is the probe operator's only account of one. The stack alone
     * points at WorkerController; the diagnosis says which bootstrap step
     * stalled and what Playwright reported, so it leads -- and both land in
     * one record instead of two that other checks' logs can pull apart.
     */
    const clock: FakeHrtimeClock = installFakeHrtime();
    const timeoutSpy: jest.SpyInstance = runRetryDelaysImmediately();
    const errorSpy: jest.SpyInstance = silenceErrorLog();
    runSpy
      .mockImplementationOnce(
        failAfter(
          clock,
          1500,
          runtimeFault(RUNTIME_FAULT_MESSAGE, {
            internalDetail: BOOTSTRAP_DIAGNOSIS,
            remoteStack: WORKER_STACK,
          }),
        ),
      )
      .mockImplementationOnce(
        succeedAfter(clock, 900, {
          returnValue: { data: "recovered" },
          logMessages: [],
          capturedMetrics: [],
          screenshots: {},
        }),
      );

    try {
      await SyntheticMonitor.execute({
        script: "return { data: 'recovered' };",
        browserTypes: [BrowserType.Chromium],
        screenSizeTypes: [ScreenSizeType.Desktop],
      });

      /*
       * The two entries are picked out by what they say, not by counting every
       * error logged: an unrelated entry elsewhere in the run must not fail
       * this, while a missing, duplicated or reordered one still does.
       */
      const errors: Array<unknown> = loggedErrors(errorSpy);
      const faultLineIndexes: Array<number> = indexesOfLoggedErrors(
        errorSpy,
        (entry: unknown): boolean => {
          return entry === runtimeFaultLogLine(1500);
        },
      );
      const diagnosisIndexes: Array<number> = indexesOfLoggedErrors(
        errorSpy,
        (entry: unknown): boolean => {
          return (
            typeof entry === "string" && entry.includes(BOOTSTRAP_DIAGNOSIS)
          );
        },
      );
      const stackIndexes: Array<number> = indexesOfLoggedErrors(
        errorSpy,
        (entry: unknown): boolean => {
          return typeof entry === "string" && entry.includes(WORKER_STACK);
        },
      );

      expect(faultLineIndexes).toHaveLength(1);
      expect(diagnosisIndexes).toHaveLength(1);
      // One record: the stack is logged only inside the diagnosis entry.
      expect(stackIndexes).toEqual(diagnosisIndexes);

      const faultLineIndex: number = faultLineIndexes[0] ?? -1;
      const detailIndex: number = diagnosisIndexes[0] ?? -1;
      expect(faultLineIndex).toBeLessThan(detailIndex);

      const detail: string = String(errors[detailIndex]);
      expect(detail.indexOf(BOOTSTRAP_DIAGNOSIS)).toBeLessThan(
        detail.indexOf(WORKER_STACK),
      );
      // Ours, not the tenant's: neither entry is tagged as an external fault.
      expect(errorSpy.mock.calls[faultLineIndex]?.[1]).toBeUndefined();
      expect(errorSpy.mock.calls[detailIndex]?.[1]).toBeUndefined();
    } finally {
      errorSpy.mockRestore();
      timeoutSpy.mockRestore();
      clock.restore();
    }
  });

  const runtimeFaultDetailCases: Array<RuntimeFaultDetailCase> = [
    {
      name: "a stack but no diagnosis",
      diagnostics: { remoteStack: WORKER_STACK },
      expectedDetail: WORKER_STACK,
    },
    {
      name: "a diagnosis but no stack",
      diagnostics: {
        internalDetail: BOOTSTRAP_DIAGNOSIS,
        remoteStack: undefined,
      },
      expectedDetail: BOOTSTRAP_DIAGNOSIS,
    },
    {
      name: "neither a diagnosis nor a stack",
      diagnostics: { remoteStack: undefined },
      expectedDetail: undefined,
    },
  ];

  test.each(runtimeFaultDetailCases)(
    "logs whatever detail a runtime fault carried: $name",
    async ({ diagnostics, expectedDetail }: RuntimeFaultDetailCase) => {
      /*
       * Half a diagnosis is logged as it is: no "undefined" standing in for
       * the missing half, and no empty entry when there is nothing to add.
       */
      const timeoutSpy: jest.SpyInstance = runRetryDelaysImmediately();
      const errorSpy: jest.SpyInstance = silenceErrorLog();
      runSpy
        .mockRejectedValueOnce(runtimeFault(RUNTIME_FAULT_MESSAGE, diagnostics))
        .mockResolvedValueOnce(
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

        const errors: Array<unknown> = loggedErrors(errorSpy);
        expect(String(errors[0])).toMatch(/^Synthetic Monitor runtime fault /);
        expect(String(errors[0])).toContain(RUNTIME_FAULT_MESSAGE);
        expect(errors.slice(1)).toEqual(
          expectedDetail === undefined ? [] : [expectedDetail],
        );
      } finally {
        errorSpy.mockRestore();
        timeoutSpy.mockRestore();
      }
    },
  );

  test("times every attempt of a runtime fault on its own", async () => {
    /*
     * A failed run used to report 0 ms, so a bootstrap that stalled for a
     * minute and a browser that failed at once looked identical. Each attempt
     * is a fresh worker with a duration of its own, and the attempt history
     * has to show each one -- not one number twice, nor the 0 it started at.
     */
    const clock: FakeHrtimeClock = installFakeHrtime();
    const timeoutSpy: jest.SpyInstance = runRetryDelaysImmediately();
    const errorSpy: jest.SpyInstance = silenceErrorLog();
    const fault: SyntheticProcessRunnerError = runtimeFault(
      RUNTIME_FAULT_MESSAGE,
      { internalDetail: BOOTSTRAP_DIAGNOSIS },
    );
    runSpy
      .mockImplementationOnce(failAfter(clock, 1500, fault))
      .mockImplementationOnce(failAfter(clock, 2750, fault));

    try {
      const responses: SyntheticMonitorResponse[] | null =
        await SyntheticMonitor.execute({
          script: "return { data: true };",
          browserTypes: [BrowserType.Chromium],
          screenSizeTypes: [ScreenSizeType.Desktop],
        });

      expect(runSpy).toHaveBeenCalledTimes(2);
      expect(responses?.[0]?.totalAttempts).toBe(2);
      expect(responses?.[0]?.executionTimeInMS).toBe(2750);
      expect(
        responses?.[0]?.retryAttempts?.map((attempt: RetryAttempt): number => {
          return attempt.executionTimeInMS;
        }),
      ).toEqual([1500, 2750]);
      expect(
        loggedErrors(errorSpy).filter((entry: unknown): boolean => {
          return String(entry).startsWith("Synthetic Monitor runtime fault");
        }),
      ).toEqual([runtimeFaultLogLine(1500), runtimeFaultLogLine(2750)]);
    } finally {
      errorSpy.mockRestore();
      timeoutSpy.mockRestore();
      clock.restore();
    }
  });

  test("times every attempt of an ordinary worker failure on its own", async () => {
    const clock: FakeHrtimeClock = installFakeHrtime();
    const timeoutSpy: jest.SpyInstance = runRetryDelaysImmediately();
    const errorSpy: jest.SpyInstance = silenceErrorLog();
    runSpy
      .mockImplementationOnce(
        failAfter(clock, 820, new Error("worker launch failed")),
      )
      .mockImplementationOnce(
        failAfter(clock, 640, new Error("worker launch failed")),
      );

    try {
      const responses: SyntheticMonitorResponse[] | null =
        await SyntheticMonitor.execute({
          script: "return { data: true };",
          browserTypes: [BrowserType.Firefox],
          screenSizeTypes: [ScreenSizeType.Mobile],
          retryCountOnError: 1,
        });

      expect(runSpy).toHaveBeenCalledTimes(2);
      expect(responses?.[0]).toMatchObject({
        scriptError: "worker launch failed",
        executionTimeInMS: 640,
        totalAttempts: 2,
      });
      expect(
        responses?.[0]?.retryAttempts?.map((attempt: RetryAttempt): number => {
          return attempt.executionTimeInMS;
        }),
      ).toEqual([820, 640]);
    } finally {
      errorSpy.mockRestore();
      timeoutSpy.mockRestore();
      clock.restore();
    }
  });

  test("still times a run that completes", async () => {
    const clock: FakeHrtimeClock = installFakeHrtime();
    runSpy.mockImplementationOnce(
      succeedAfter(clock, 1234, {
        returnValue: { data: true },
        logMessages: [],
        capturedMetrics: [],
        screenshots: {},
      }),
    );

    try {
      const responses: SyntheticMonitorResponse[] | null =
        await SyntheticMonitor.execute({
          script: "return { data: true };",
          browserTypes: [BrowserType.Chromium],
          screenSizeTypes: [ScreenSizeType.Desktop],
        });

      expect(responses?.[0]?.result).toBe(true);
      expect(responses?.[0]?.executionTimeInMS).toBe(1234);
    } finally {
      clock.restore();
    }
  });

  test("keeps the worker's diagnosis out of every field of the monitor response", async () => {
    /*
     * The diagnosis names internal URLs, Playwright calls and source paths; it
     * exists for the probe operator's log. The tenant is shown the fault's own
     * message -- on the response and on every attempt in its history -- and
     * nothing else the worker sent.
     */
    const timeoutSpy: jest.SpyInstance = runRetryDelaysImmediately();
    const errorSpy: jest.SpyInstance = silenceErrorLog();
    runSpy.mockRejectedValue(
      runtimeFault(RUNTIME_FAULT_MESSAGE, {
        internalDetail: BOOTSTRAP_DIAGNOSIS,
        remoteStack: WORKER_STACK,
      }),
    );

    try {
      const responses: SyntheticMonitorResponse[] | null =
        await SyntheticMonitor.execute({
          script: "return { data: true };",
          browserTypes: [BrowserType.Chromium],
          screenSizeTypes: [ScreenSizeType.Desktop],
        });

      expect(responses).toHaveLength(1);
      expect(responses?.[0]?.scriptError).toBe(RUNTIME_FAULT_MESSAGE);
      expect(
        responses?.[0]?.retryAttempts?.map(
          (attempt: RetryAttempt): string | undefined => {
            return attempt.scriptError;
          },
        ),
      ).toEqual([RUNTIME_FAULT_MESSAGE, RUNTIME_FAULT_MESSAGE]);

      const serializedResponses: string = JSON.stringify(responses);
      const internalMarkers: Array<string> = [
        "Bootstrap attempt",
        "Last error:",
        "synthetic-runtime.oneuptime.invalid",
        "page.goto",
        "page.route",
        "WorkerController.ts",
        "SyntheticRuntimeFault",
      ];
      for (const marker of internalMarkers) {
        expect(serializedResponses).not.toContain(marker);
      }
    } finally {
      errorSpy.mockRestore();
      timeoutSpy.mockRestore();
    }
  });
  test.each([0, 1, 3])(
    "honors retryCountOnError=%s for a script timeout",
    async (retryCountOnError: number) => {
      const timeoutSpy: jest.SpyInstance = runRetryDelaysImmediately();
      runSpy.mockResolvedValue(
        workerRunResult({
          logMessages: [],
          capturedMetrics: [],
          screenshots: {},
          scriptError: "Script execution timed out.",
        }),
      );
      try {
        const responses: SyntheticMonitorResponse[] | null =
          await SyntheticMonitor.execute({
            script: "await new Promise(() => {});",
            browserTypes: [BrowserType.Chromium],
            screenSizeTypes: [ScreenSizeType.Desktop],
            retryCountOnError,
          });
        expect(runSpy).toHaveBeenCalledTimes(retryCountOnError + 1);
        expect(responses?.[0]?.totalAttempts).toBe(retryCountOnError + 1);
        expect(responses?.[0]?.scriptError).toBe("Script execution timed out.");
      } finally {
        timeoutSpy.mockRestore();
      }
    },
  );
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
