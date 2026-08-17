import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import {
  SyntheticMonitorWorkerConfig,
  SyntheticMonitorWorkerResult,
  isSyntheticMonitorWorkerConfig,
  isSyntheticMonitorWorkerResult,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticMonitorWorkerTypes";
import { MAX_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS } from "../../../../Utils/Monitors/SyntheticRuntime/Limits";

function validConfig(): SyntheticMonitorWorkerConfig {
  return {
    code: "return { data: true };",
    browserType: BrowserType.Chromium,
    screenSizeType: ScreenSizeType.Desktop,
    executablePath: "/usr/bin/chromium",
    viewport: { width: 1_920, height: 1_080 },
    timeoutInMs: 60_000,
    chromiumSandboxEnabled: true,
    args: { region: "eu-west" },
  };
}

function validResult(): SyntheticMonitorWorkerResult {
  return {
    returnValue: { data: true },
    logMessages: ["started"],
    capturedMetrics: [
      {
        name: "latency",
        value: 12.5,
        attributes: { route: "checkout" },
      },
    ],
    screenshots: {
      page: Buffer.from("synthetic-image").toString("base64"),
    },
  };
}

describe("SyntheticMonitorWorkerTypes", () => {
  test("accepts a bounded production worker configuration", () => {
    expect(isSyntheticMonitorWorkerConfig(validConfig())).toBe(true);
    expect(
      isSyntheticMonitorWorkerConfig({
        ...validConfig(),
        browserType: BrowserType.Firefox,
        proxy: {
          server: "http://proxy.internal:8080",
          username: "probe",
          password: "secret",
          bypass: "localhost",
        },
      }),
    ).toBe(true);
  });

  test("rejects unknown configuration fields and non-copyable arguments", () => {
    expect(
      isSyntheticMonitorWorkerConfig({
        ...validConfig(),
        unexpectedHostOption: true,
      }),
    ).toBe(false);

    const cyclicArgs: Record<string, unknown> = {};
    cyclicArgs["self"] = cyclicArgs;
    expect(
      isSyntheticMonitorWorkerConfig({
        ...validConfig(),
        args: cyclicArgs,
      }),
    ).toBe(false);
  });

  test("rejects unsafe executable, viewport, proxy, and deadline values", () => {
    expect(
      isSyntheticMonitorWorkerConfig({
        ...validConfig(),
        executablePath: "chromium",
      }),
    ).toBe(false);
    expect(
      isSyntheticMonitorWorkerConfig({
        ...validConfig(),
        viewport: { width: 1_920, height: 1_080, deviceScaleFactor: 4 },
      }),
    ).toBe(false);
    expect(
      isSyntheticMonitorWorkerConfig({
        ...validConfig(),
        timeoutInMs: MAX_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS + 1,
      }),
    ).toBe(false);
    expect(
      isSyntheticMonitorWorkerConfig({
        ...validConfig(),
        proxy: { server: "socks5://127.0.0.1:1080" },
      }),
    ).toBe(false);
  });

  test("accepts legacy long timeouts through the exact safe boundary", () => {
    expect(
      isSyntheticMonitorWorkerConfig({
        ...validConfig(),
        timeoutInMs: 600_001,
      }),
    ).toBe(true);
    expect(
      isSyntheticMonitorWorkerConfig({
        ...validConfig(),
        timeoutInMs: MAX_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS,
      }),
    ).toBe(true);
  });

  test("accepts a bounded copied worker result", () => {
    expect(isSyntheticMonitorWorkerResult(validResult())).toBe(true);
  });

  test("rejects oversized logs, errors, and non-transferable return values", () => {
    expect(
      isSyntheticMonitorWorkerResult({
        ...validResult(),
        logMessages: ["x".repeat(1_000_001)],
      }),
    ).toBe(false);
    expect(
      isSyntheticMonitorWorkerResult({
        ...validResult(),
        scriptError: "x".repeat(4_001),
      }),
    ).toBe(false);

    const cyclicReturnValue: Record<string, unknown> = {};
    cyclicReturnValue["self"] = cyclicReturnValue;
    expect(
      isSyntheticMonitorWorkerResult({
        ...validResult(),
        returnValue: cyclicReturnValue,
      }),
    ).toBe(false);
  });

  test("rejects metric count, shape, and attribute quota violations", () => {
    expect(
      isSyntheticMonitorWorkerResult({
        ...validResult(),
        capturedMetrics: Array.from(
          { length: 101 },
          (_value: unknown, index: number) => {
            return { name: `metric-${index}`, value: index };
          },
        ),
      }),
    ).toBe(false);
    expect(
      isSyntheticMonitorWorkerResult({
        ...validResult(),
        capturedMetrics: [
          { name: "metric", value: 1, attributes: { route: false } },
        ],
      }),
    ).toBe(false);
  });

  test("rejects malformed and excessively aliased screenshot payloads", () => {
    expect(
      isSyntheticMonitorWorkerResult({
        ...validResult(),
        screenshots: { page: "not base64" },
      }),
    ).toBe(false);

    const screenshots: Record<string, string> = {};
    for (let index: number = 0; index < 21; index++) {
      screenshots[`alias-${index}`] = Buffer.from(String(index)).toString(
        "base64",
      );
    }
    expect(
      isSyntheticMonitorWorkerResult({ ...validResult(), screenshots }),
    ).toBe(false);
  });

  test("rejects unknown result fields", () => {
    expect(
      isSyntheticMonitorWorkerResult({
        ...validResult(),
        hostHandle: { applySync: true },
      }),
    ).toBe(false);
  });
});
