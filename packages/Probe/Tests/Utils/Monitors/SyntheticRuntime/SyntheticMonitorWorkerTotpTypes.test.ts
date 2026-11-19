import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import {
  MAX_TOTP_SECRETS_PER_STEP,
  TotpAlgorithm,
  TotpParameters,
  TotpSecrets,
} from "Common/Utils/Totp/TotpParameters";
import {
  SyntheticMonitorWorkerConfig,
  SyntheticMonitorWorkerResult,
  isSyntheticMonitorWorkerConfig,
  isSyntheticMonitorWorkerResult,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticMonitorWorkerTypes";
import { MAX_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS } from "../../../../Utils/Monitors/SyntheticRuntime/Limits";

/*
 * What crosses into a synthetic worker process for one-time codes (issue
 * #9703): the TOTP secrets the script references, held to exactly what a
 * monitor step may carry, and, on the way back, how long the run waited
 * for codes about to expire - a bounded count of milliseconds.
 */

const LOGIN: TotpParameters = {
  secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  algorithm: TotpAlgorithm.SHA256,
  digits: 8,
  periodInSeconds: 60,
};

function config(totpSecrets: unknown): SyntheticMonitorWorkerConfig {
  return {
    code: 'await oneuptime.getTotpCode("LoginCode");',
    browserType: BrowserType.Chromium,
    screenSizeType: ScreenSizeType.Desktop,
    executablePath: "/usr/bin/chromium",
    viewport: { width: 1_920, height: 1_080 },
    timeoutInMs: 60_000,
    chromiumSandboxEnabled: true,
    args: {},
    totpSecrets: totpSecrets as TotpSecrets,
  };
}

function result(totpWaitInMs: unknown): SyntheticMonitorWorkerResult {
  return {
    returnValue: { data: "******" },
    logMessages: ["typed ******"],
    capturedMetrics: [],
    screenshots: {},
    totpWaitInMs: totpWaitInMs as number,
  };
}

describe("a synthetic worker's TOTP secrets", () => {
  test("are accepted when each is a name and the parameters a code is made from", () => {
    expect(isSyntheticMonitorWorkerConfig(config({ LoginCode: LOGIN }))).toBe(
      true,
    );
    expect(
      isSyntheticMonitorWorkerConfig(
        config({ LoginCode: LOGIN, Billing: { ...LOGIN, digits: 6 } }),
      ),
    ).toBe(true);
    expect(isSyntheticMonitorWorkerConfig(config(undefined))).toBe(true);
    expect(isSyntheticMonitorWorkerConfig(config({}))).toBe(true);
  });

  test("are refused when anything else rides along", () => {
    for (const totpSecrets of [
      "otpauth://totp/x?secret=GEZDGNBVGY3TQOJQ",
      [LOGIN],
      null,
      { LoginCode: { ...LOGIN, issuer: "extra" } },
      { LoginCode: { ...LOGIN, digits: 7 } },
      { LoginCode: { ...LOGIN, secret: "not base32!" } },
      { "": LOGIN },
      { ["x".repeat(201)]: LOGIN },
      { LoginCode: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" },
    ]) {
      expect({
        totpSecrets,
        accepted: isSyntheticMonitorWorkerConfig(config(totpSecrets)),
      }).toEqual({ totpSecrets, accepted: false });
    }
  });

  test("are no more than a step may hold", () => {
    const many: TotpSecrets = {};

    for (let index: number = 0; index <= MAX_TOTP_SECRETS_PER_STEP; index++) {
      many[`Code${index}`] = LOGIN;
    }

    expect(isSyntheticMonitorWorkerConfig(config(many))).toBe(false);

    delete many[`Code${MAX_TOTP_SECRETS_PER_STEP}`];

    expect(isSyntheticMonitorWorkerConfig(config(many))).toBe(true);
  });
});

describe("the time a synthetic run waited for codes", () => {
  test("comes back as a whole, bounded number of milliseconds", () => {
    expect(isSyntheticMonitorWorkerResult(result(undefined))).toBe(true);
    expect(isSyntheticMonitorWorkerResult(result(0))).toBe(true);
    expect(isSyntheticMonitorWorkerResult(result(4_999))).toBe(true);
  });

  test("is refused when it is anything else", () => {
    for (const totpWaitInMs of [
      -1,
      1.5,
      "5000",
      MAX_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS + 1,
      Number.NaN,
    ]) {
      expect({
        totpWaitInMs,
        accepted: isSyntheticMonitorWorkerResult(result(totpWaitInMs)),
      }).toEqual({ totpWaitInMs, accepted: false });
    }
  });
});
