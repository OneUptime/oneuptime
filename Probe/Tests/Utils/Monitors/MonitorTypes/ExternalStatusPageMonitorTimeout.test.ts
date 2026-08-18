process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

interface AxiosRequestOptions {
  timeout?: number | undefined;
}

const axiosCalls: Array<{ url: string; timeout: number | undefined }> = [];

jest.mock("axios", () => {
  return {
    __esModule: true,
    default: {
      get: (url: string, options: AxiosRequestOptions): unknown => {
        axiosCalls.push({ url: url, timeout: options?.timeout });

        return Promise.resolve({
          status: 200,
          data: {
            status: { indicator: "none", description: "All Systems Go" },
            components: [],
            incidents: [],
          },
        });
      },
    },
  };
});

import ExternalStatusPageMonitorUtil from "../../../../Utils/Monitors/MonitorTypes/ExternalStatusPageMonitor";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import MonitorStepExternalStatusPageMonitor from "Common/Types/Monitor/MonitorStepExternalStatusPageMonitor";

/*
 * Follow-up to https://github.com/OneUptime/oneuptime/issues/3225.
 *
 * The provider fetchers read `config.timeout || options.timeout`, so the
 * per-step timeout could never win over the type-specific config default.
 */

function buildConfig(timeout: number): MonitorStepExternalStatusPageMonitor {
  return {
    statusPageUrl: "https://status.example.com",
    provider: ExternalStatusPageProviderType.AtlassianStatuspage,
    timeout: timeout,
    retries: 3,
  };
}

beforeEach(() => {
  axiosCalls.length = 0;
});

describe("ExternalStatusPageMonitorUtil timeout precedence", () => {
  test("prefers an explicitly supplied options.timeout over the config default", async () => {
    await ExternalStatusPageMonitorUtil.fetch(buildConfig(10000), {
      timeout: 1234,
      isOnlineCheckRequest: true,
    });

    expect(axiosCalls.length).toBeGreaterThan(0);
    for (const call of axiosCalls) {
      expect(call.timeout).toBe(1234);
    }
  });

  test("falls back to the config timeout when the caller supplies none", async () => {
    await ExternalStatusPageMonitorUtil.fetch(buildConfig(2500), {
      isOnlineCheckRequest: true,
    });

    expect(axiosCalls.length).toBeGreaterThan(0);
    for (const call of axiosCalls) {
      expect(call.timeout).toBe(2500);
    }
  });
});
