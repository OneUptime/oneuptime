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

  /*
   * The probe's egress policy, as the supervisor hands it to the worker
   * (GHSA-9rx7-vwfj-whp7). Anything that is not exactly that shape is
   * refused, so a malformed value can never be read as a looser policy.
   */
  test.each([
    {
      label: "private addresses allowed, no hint",
      egressPolicy: {
        allowPrivateNetworkAddresses: true,
        privateNetworkHint: "",
      },
    },
    {
      label: "private addresses refused, with the probe's hint",
      egressPolicy: {
        allowPrivateNetworkAddresses: false,
        privateNetworkHint:
          " Set PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true on the probe running this monitor to allow it.",
      },
    },
    { label: "left out", egressPolicy: undefined },
  ])(
    "accepts the egress policy: $label",
    ({ egressPolicy }: { label: string; egressPolicy: unknown }) => {
      expect(
        isSyntheticMonitorWorkerConfig({ ...validConfig(), egressPolicy }),
      ).toBe(true);
    },
  );

  test.each([
    {
      label: "a string flag",
      egressPolicy: {
        allowPrivateNetworkAddresses: "true",
        privateNetworkHint: "",
      },
    },
    { label: "a missing flag", egressPolicy: { privateNetworkHint: "" } },
    {
      label: "a missing hint",
      egressPolicy: { allowPrivateNetworkAddresses: false },
    },
    {
      label: "a hint that is not text",
      egressPolicy: {
        allowPrivateNetworkAddresses: false,
        privateNetworkHint: 1,
      },
    },
    {
      label: "an unknown field",
      egressPolicy: {
        allowPrivateNetworkAddresses: false,
        privateNetworkHint: "",
        allowLoopback: true,
      },
    },
    {
      label: "an overlong hint",
      egressPolicy: {
        allowPrivateNetworkAddresses: false,
        privateNetworkHint: "x".repeat(2_001),
      },
    },
    { label: "not an object", egressPolicy: true },
    { label: "null", egressPolicy: null },
  ])(
    "refuses an egress policy with $label",
    ({ egressPolicy }: { label: string; egressPolicy: unknown }) => {
      expect(
        isSyntheticMonitorWorkerConfig({ ...validConfig(), egressPolicy }),
      ).toBe(false);
    },
  );

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
